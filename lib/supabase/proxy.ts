import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({ request });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // getUser() validates the access token with Supabase Auth.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAdminPath =
    pathname === "/admin" || pathname.startsWith("/admin/");
  const isLoginPath = pathname === "/admin/login";

  if (!isAdminPath) {
    return response;
  }

  const isInviteAcceptPath = pathname === "/admin/accept-invite";
  const isInvitePath = pathname === "/admin/invite";
  const isResetPath = pathname === "/admin/reset-password";
  const isMfaPath = pathname === "/admin/login/mfa";
  const isExemptPath = isLoginPath || isInvitePath || isResetPath || isMfaPath || isInviteAcceptPath;

  if (!user) {
    if (!isExemptPath) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      url.search = "";
      return NextResponse.redirect(url);
    }

    return response;
  }

  const { data: adminRow, error: adminError } = await supabase
    .from("admins")
    .select("user_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  const authorized = !adminError && Boolean(adminRow);

  if (!authorized) {
    await supabase.auth.signOut();

    if (!isExemptPath) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      url.search = "";
      const redirect = NextResponse.redirect(url);

      // Copy any auth-cookie changes produced by signOut().
      response.cookies.getAll().forEach((cookie) => {
        redirect.cookies.set(cookie);
      });

      return redirect;
    }

    return response;
  }

  if (adminRow?.role === "master" && !isExemptPath) {
    const { data: mfaData, error: mfaError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (mfaError || mfaData?.currentLevel !== "aal2") {
      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  if (isLoginPath) {
    // If an authenticated user hits /admin/login, we do NOT redirect them server-side.
    // If they are clicking a password recovery link, the hash (#access_token) is
    // only available on the client. Redirecting them here would drop the hash
    // and break the recovery flow.
    return response;
  }

  return response;
}
