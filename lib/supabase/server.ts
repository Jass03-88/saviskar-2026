import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export type AdminRole = "master" | "admin";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },

        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components cannot always write cookies.
            // proxy.ts refreshes auth cookies before protected routes render.
          }
        },
      },
    }
  );
}

/**
 * Require an authenticated admin.
 *
 * Normal admins can authenticate with password only.
 * Master admins must have completed TOTP MFA (AAL2).
 */
export async function requireAdmin() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      supabase,
      user: null,
      role: null,
      error: "Unauthorized" as const,
      status: 401,
    };
  }

  const { data: admin, error: adminError } = await supabase
    .from("admins")
    .select("user_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (adminError || !admin) {
    return {
      supabase,
      user,
      role: null,
      error: "Forbidden" as const,
      status: 403,
    };
  }

  const role = (admin.role ?? "admin") as AdminRole;

  // Master admins MUST complete Google Authenticator MFA.
  if (role === "master") {
    const {
      data: assurance,
      error: assuranceError,
    } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (
      assuranceError ||
      assurance?.currentLevel !== "aal2"
    ) {
      return {
        supabase,
        user,
        role,
        error: "MFA_REQUIRED" as const,
        status: 403,
      };
    }
  }

  return {
    supabase,
    user,
    role,
    error: null,
    status: 200,
  };
}

/**
 * Require a Master Admin specifically.
 *
 * Used for event management and admin management APIs.
 */
export async function requireMasterAdmin() {
  const auth = await requireAdmin();

  if (auth.error) {
    return auth;
  }

  if (auth.role !== "master") {
    return {
      ...auth,
      error: "Master Admin access required" as const,
      status: 403,
    };
  }

  return auth;
}