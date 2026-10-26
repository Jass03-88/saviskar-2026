/**
 * Saviskar 2026 Admin Session Management & Expiration Authority
 *
 * Enforces authoritative server-side absolute session expiration for all
 * admin dashboard requests and admin API routes.
 */

export const DEFAULT_ADMIN_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60; // 8 hours (28,800 seconds)

/**
 * Retrieves the configured maximum admin session lifetime in seconds.
 * Defaults to 28,800 seconds (8 hours) if ADMIN_SESSION_MAX_AGE_SECONDS is not set or invalid.
 */
export function getAdminSessionMaxAgeSeconds(): number {
  const configured = process.env.ADMIN_SESSION_MAX_AGE_SECONDS?.trim();
  if (configured) {
    const parsed = parseInt(configured, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_ADMIN_SESSION_MAX_AGE_SECONDS;
}

/**
 * Authoritatively validates whether a Supabase Auth admin user session has expired.
 *
 * Uses `user.last_sign_in_at` from Supabase Auth as the authoritative session start timestamp.
 * In Supabase Auth, `last_sign_in_at` represents the initial authentication time (password / OTP / OAuth)
 * and is NOT updated on background token refreshes, preventing indefinite session extension.
 */
export function isAdminSessionExpired(
  user: { last_sign_in_at?: string | null } | null | undefined,
  maxAgeSeconds: number = getAdminSessionMaxAgeSeconds()
): boolean {
  if (!user) return true;

  // Fail closed if the user has no recorded authentication timestamp
  if (!user.last_sign_in_at) {
    return true;
  }

  const authTime = new Date(user.last_sign_in_at).getTime();
  if (Number.isNaN(authTime)) {
    return true;
  }

  // Reject future-dated authentication timestamps beyond a reasonable 60s clock skew
  if (authTime > Date.now() + 60000) {
    return true;
  }

  const maxAgeMs = maxAgeSeconds * 1000;
  return Date.now() - authTime > maxAgeMs;
}

/**
 * Transforms cookie options for admin authentication to enforce browser-session scoping.
 *
 * For cookie deletion (maxAge <= 0), the deletion maxAge is preserved so the browser clears the cookie.
 * For active authentication cookies, maxAge and expires are removed (undefined) so that the browser treats
 * the cookie as a session-only cookie that is discarded when the browser process exits.
 */
export function toAdminSessionCookieOptions<
  T extends { maxAge?: number; expires?: Date | number }
>(options: T): T;
export function toAdminSessionCookieOptions<
  T extends { maxAge?: number; expires?: Date | number }
>(options?: T): T | undefined;
export function toAdminSessionCookieOptions<
  T extends { maxAge?: number; expires?: Date | number }
>(options?: T): T | undefined {
  if (!options) return undefined;
  const isDeletion = typeof options.maxAge === "number" && options.maxAge <= 0;
  if (isDeletion) {
    return { ...options };
  }
  const sessionOptions = { ...options };
  delete sessionOptions.maxAge;
  delete sessionOptions.expires;
  return sessionOptions;
}

/**
 * Authoritatively determines whether the Master Admin MFA requirement can be safely bypassed
 * for local development against the disposable local Supabase stack.
 *
 * Strict Security Invariants:
 * 1. Fails closed (returns false) if NODE_ENV is "production", "test", or anything other than "development".
 * 2. Fails closed if any cloud/hosting platform environment variable is set (VERCEL, NETLIFY, FLY_APP_NAME, RENDER).
 * 3. Requires the intended local disposable Supabase stack endpoint: http://127.0.0.1:54321 or http://localhost:54321.
 * 4. Rejects any non-HTTP protocol, non-standard port, or hosted Supabase domain.
 */
export function isLocalDevelopmentMfaBypassAllowed(): boolean {
  // 1. Strict execution context: ONLY explicit local development
  if (process.env.NODE_ENV !== "development") {
    return false;
  }

  // 2. Reject any deployed cloud environment indicators
  if (
    process.env.VERCEL ||
    process.env.VERCEL_ENV ||
    process.env.NETLIFY ||
    process.env.FLY_APP_NAME ||
    process.env.RENDER
  ) {
    return false;
  }

  // 3. Inspect configured Supabase URL
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) {
    return false;
  }

  try {
    const parsed = new URL(supabaseUrl);
    // Protocol must strictly be plain HTTP
    if (parsed.protocol !== "http:") {
      return false;
    }

    // Hostname must strictly be 127.0.0.1 or localhost
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== "127.0.0.1" && hostname !== "localhost") {
      return false;
    }

    // Port must strictly be the designated local Supabase Kong gateway port (54321)
    if (parsed.port !== "54321") {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
