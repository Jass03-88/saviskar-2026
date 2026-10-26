import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  isAdminSessionExpired,
  getAdminSessionMaxAgeSeconds,
  DEFAULT_ADMIN_SESSION_MAX_AGE_SECONDS,
  toAdminSessionCookieOptions,
  isLocalDevelopmentMfaBypassAllowed,
} from "./admin-session";

export {
  isAdminSessionExpired,
  getAdminSessionMaxAgeSeconds,
  DEFAULT_ADMIN_SESSION_MAX_AGE_SECONDS,
  toAdminSessionCookieOptions,
  isLocalDevelopmentMfaBypassAllowed,
};

export type AdminRole = "master" | "admin";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder-project.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key",
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },

        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, toAdminSessionCookieOptions(options));
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

  let user = null;
  let userError = null;

  try {
    const res = await supabase.auth.getUser();
    user = res.data?.user ?? null;
    userError = res.error ?? null;
  } catch (err: any) {
    user = null;
    userError = err;
  }

  if (userError || !user) {
    return {
      supabase,
      user: null,
      role: null,
      accommodation_access: false,
      assigned_category: null,
      assigned_events: [] as string[],
      error: "Unauthorized" as const,
      status: 401,
    };
  }

  // Authoritatively enforce session expiration server-side
  if (isAdminSessionExpired(user)) {
    try {
      await supabase.auth.signOut();
    } catch {
      // Safe fallback if signOut throws
    }

    return {
      supabase,
      user: null,
      role: null,
      accommodation_access: false,
      assigned_category: null,
      assigned_events: [] as string[],
      error: "Session expired" as const,
      status: 401,
    };
  }

  const { data: admin, error: adminError } = await supabase
    .from("admins")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (adminError || !admin) {
    return {
      supabase,
      user,
      role: null,
      accommodation_access: false,
      assigned_category: null,
      assigned_events: [] as string[],
      error: "Forbidden" as const,
      status: 403,
    };
  }

  const role = (admin.role ?? "admin") as AdminRole;

  // Master admins MUST complete Google Authenticator MFA (in production/staging).
  if (role === "master" && !isLocalDevelopmentMfaBypassAllowed()) {
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
        accommodation_access: admin.accommodation_access ?? false,
        assigned_category: null,
        assigned_events: [] as string[],
        error: "MFA_REQUIRED" as const,
        status: 403,
      };
    }
  }

  return {
    supabase,
    user,
    role,
    accommodation_access: admin.accommodation_access ?? false,
    assigned_category: (admin.assigned_category as string | null) ?? null,
    assigned_events: (Array.isArray(admin.assigned_events) ? admin.assigned_events : []) as string[],
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

/**
 * Determines if a given user is one of the Primary Master Admins.
 *
 * Authoritatively checks against:
 * 1. process.env.PRIMARY_ADMIN_USER_IDS or process.env.PRIMARY_ADMIN_USER_ID (comma-separated UUIDs)
 * 2. process.env.PRIMARY_ADMIN_EMAILS or process.env.PRIMARY_ADMIN_EMAIL (comma-separated emails)
 * 3. Designated primary master admin emails (jashan082006@gmail.com, mvashisht911@gmail.com)
 */
export function isPrimaryMaster(
  user: { id?: string; email?: string | null } | null | undefined
): boolean {
  if (!user) return false;

  // 1. Check by configured User IDs
  if (user.id) {
    const configuredUserIds = [
      process.env.PRIMARY_ADMIN_USER_IDS,
      process.env.PRIMARY_ADMIN_USER_ID,
    ]
      .filter(Boolean)
      .join(",")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (configuredUserIds.includes(user.id)) {
      return true;
    }
  }

  // 2. Check by Email
  const userEmail = user.email?.trim().toLowerCase();
  if (userEmail) {
    const defaultPrimaryEmails =
      process.env.NODE_ENV === "test"
        ? []
        : [
            "jashan082006@gmail.com",
            "mvashisht911@gmail.com",
          ];

    const envEmails = [
      process.env.PRIMARY_ADMIN_EMAILS,
      process.env.PRIMARY_ADMIN_EMAIL,
    ]
      .filter(Boolean)
      .join(",")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const allowedEmails = new Set([...defaultPrimaryEmails, ...envEmails]);
    if (allowedEmails.has(userEmail)) {
      return true;
    }
  }

  return false;
}

/**
 * Require the Primary Master Admin (formerly Super Master) specifically.
 *
 * Enforces Master Admin access (including MFA/AAL2) and verifies Primary Master identity.
 * Used for role management and master administrator creation/removal.
 */
export async function requireSuperMasterAdmin() {
  const auth = await requireMasterAdmin();

  if (auth.error) {
    return auth;
  }

  if (!isPrimaryMaster(auth.user)) {
    return {
      ...auth,
      error: "Super Master Admin access required" as const,
      status: 403,
    };
  }

  return auth;
}

export const requirePrimaryMasterAdmin = requireSuperMasterAdmin;

/**
 * Require an admin with Accommodation Access.
 * Both Master and Normal admins must have accommodation_access = true.
 */
export async function requireAccommodationAdmin() {
  const auth = await requireAdmin();

  if (auth.error) {
    return auth;
  }

  if (!auth.accommodation_access) {
    return {
      ...auth,
      error: "Accommodation access required" as const,
      status: 403,
    };
  }

  return auth;
}