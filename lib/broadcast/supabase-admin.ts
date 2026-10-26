import fs from "fs";
import { createClient as createSupabaseClient, SupabaseClient } from "@supabase/supabase-js";
import * as selfModule from "./supabase-admin";

export const HYBRID_READONLY_ERROR =
  "Hybrid development mode is read-only for real participants. Use synthetic test recipients to test delivery. No campaign was created.";

export const PREVIEW_READONLY_ERROR =
  "Preview deployment mode is active. Live participant rosters, campaign mutations, and email dispatches are disabled to protect production data and participant privacy.";

export const PRODUCTION_READONLY_ERROR =
  "Production read-only mode is active. Real participant lists and campaign history are readable, but campaign creation, certificate issuance writes, queue processing, retries, and email dispatches are disabled.";

export type BroadcastOperationalMode =
  | "live_production"
  | "production_readonly"
  | "hybrid_development"
  | "preview";

export const CANONICAL_PRODUCTION_HOSTS: ReadonlySet<string> = new Set([
  "saviskar.co.in",
  "www.saviskar.co.in",
]);

/**
 * Extracts normalized hostname from incoming HTTP request headers or NextUrl.
 * Supports standard Request, NextRequest, or mock objects with headers.
 */
export function extractHostFromRequest(req?: Request | any): string | null {
  if (!req) return null;

  // 1. Inspect underlying resolved request URL if available (e.g. from NextRequest).
  // If the server physically received the request on a non-canonical host (e.g. Hostinger preview),
  // an incoming x-forwarded-host header claiming saviskar.co.in must NEVER authorize production!
  const nextUrlHost = req.nextUrl?.hostname ? req.nextUrl.hostname.toLowerCase() : null;
  if (nextUrlHost && !isCanonicalProductionHost(nextUrlHost)) {
    return nextUrlHost;
  }

  // 2. Inspect headers
  const forwarded = req.headers?.get?.("x-forwarded-host");
  const hostHeader = req.headers?.get?.("host");
  const raw = forwarded || hostHeader || nextUrlHost || null;
  if (!raw || typeof raw !== "string") return null;

  const first = raw.split(",")[0].trim().toLowerCase();
  if (!first) return "malformed_empty_host";

  // Strings starting with colon (e.g. ":::malformed" or ":3000") are malformed host headers
  if (first.startsWith(":")) {
    return "malformed_host";
  }

  // Strip trailing port if present (e.g., "saviskar.co.in:443" -> "saviskar.co.in")
  const hostPart = first.includes(":") ? first.split(":")[0] : first;
  return hostPart || "malformed_host";
}

/**
 * Extracts normalized hostname from configured NEXT_PUBLIC_SITE_URL.
 */
export function extractHostFromSiteUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const host = parsed.hostname.toLowerCase();
    return host || "malformed_site_url";
  } catch {
    return "malformed_site_url";
  }
}

/**
 * Checks whether the host matches an exact canonical production host.
 */
export function isCanonicalProductionHost(host: string | null): boolean {
  if (!host) return false;
  return CANONICAL_PRODUCTION_HOSTS.has(host.trim().toLowerCase());
}

/**
 * Checks whether Live Broadcast Mode is explicitly enabled.
 * Strictly fails closed:
 * 1. Fails closed if any preview or non-production environment indicator is present.
 * 2. Requires deliberate explicit activation ONLY via SAVISKAR_BROADCAST_LIVE_ENABLED="true".
 * 3. Requires the actual request host (if present) to match the canonical production domain (saviskar.co.in).
 * 4. In production runtime, requires NEXT_PUBLIC_SITE_URL (if set) to match canonical production domain.
 * Missing or unknown configuration always defaults to false (Preview Mode).
 */
export function isLiveBroadcastEnabled(req?: Request | any): boolean {
  if (
    process.env.VERCEL_ENV === "preview" ||
    process.env.APP_ENV === "preview" ||
    process.env.NEXT_PUBLIC_APP_ENV === "preview" ||
    process.env.SAVISKAR_PREVIEW === "true" ||
    process.env.HOSTINGER_PREVIEW === "true"
  ) {
    return false;
  }

  const isExplicitFlagTrue =
    process.env.SAVISKAR_BROADCAST_LIVE_ENABLED === "true";

  if (!isExplicitFlagTrue) {
    return false;
  }

  // Inspect actual request host if available
  const requestHost = extractHostFromRequest(req);
  if (requestHost) {
    if (!isCanonicalProductionHost(requestHost)) {
      return false;
    }
  }

  // Inspect NEXT_PUBLIC_SITE_URL host
  const siteUrlHost = extractHostFromSiteUrl();
  if (siteUrlHost && !isCanonicalProductionHost(siteUrlHost)) {
    return false;
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "").toLowerCase();
  if (
    siteUrl.includes("preview") ||
    siteUrl.includes("hostinger") ||
    siteUrl.includes("vercel.app") ||
    siteUrl.includes("ngrok") ||
    siteUrl.includes("trycloudflare")
  ) {
    return false;
  }

  if (process.env.NODE_ENV === "test") {
    if (requestHost && !isCanonicalProductionHost(requestHost)) {
      return false;
    }
    return isExplicitFlagTrue;
  }

  // In production runtime, must have verified canonical host:
  if (requestHost && !isCanonicalProductionHost(requestHost)) {
    return false;
  }
  if (!requestHost && (!siteUrlHost || !isCanonicalProductionHost(siteUrlHost))) {
    return false;
  }

  return process.env.NODE_ENV === "production" && isExplicitFlagTrue;
}

/**
 * Checks whether Production Read-Only Mode is explicitly enabled:
 * 1. Fails closed if any preview or non-production environment indicator is present.
 * 2. Requires deliberate explicit activation: SAVISKAR_BROADCAST_PRODUCTION_READONLY_ENABLED="true".
 * 3. Only permitted on the verified canonical production host (saviskar.co.in, www.saviskar.co.in).
 * 4. Preview hosts must never enter this mode, even if they inherit production environment variables or send spoofed forwarded-host headers.
 * 5. Does NOT grant permission to mutate data, issue certificates, or send emails (strictly read-only).
 */
export function isProductionReadOnlyEnabled(req?: Request | any): boolean {
  if (
    process.env.VERCEL_ENV === "preview" ||
    process.env.APP_ENV === "preview" ||
    process.env.NEXT_PUBLIC_APP_ENV === "preview" ||
    process.env.SAVISKAR_PREVIEW === "true" ||
    process.env.HOSTINGER_PREVIEW === "true"
  ) {
    return false;
  }

  const isFlagTrue =
    process.env.SAVISKAR_BROADCAST_PRODUCTION_READONLY_ENABLED === "true";

  if (!isFlagTrue) {
    return false;
  }

  // Inspect actual request host if available
  const requestHost = extractHostFromRequest(req);
  if (requestHost) {
    if (!isCanonicalProductionHost(requestHost)) {
      return false;
    }
  }

  // Inspect NEXT_PUBLIC_SITE_URL host
  const siteUrlHost = extractHostFromSiteUrl();
  if (siteUrlHost && !isCanonicalProductionHost(siteUrlHost)) {
    return false;
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "").toLowerCase();
  if (
    siteUrl.includes("preview") ||
    siteUrl.includes("hostinger") ||
    siteUrl.includes("vercel.app") ||
    siteUrl.includes("ngrok") ||
    siteUrl.includes("trycloudflare")
  ) {
    return false;
  }

  if (process.env.NODE_ENV === "test") {
    if (requestHost && !isCanonicalProductionHost(requestHost)) {
      return false;
    }
    return isFlagTrue;
  }

  // In production runtime, must have verified canonical host:
  if (requestHost && !isCanonicalProductionHost(requestHost)) {
    return false;
  }
  if (!requestHost && (!siteUrlHost || !isCanonicalProductionHost(siteUrlHost))) {
    return false;
  }

  return process.env.NODE_ENV === "production" && isFlagTrue;
}

/**
 * Checks whether Preview Deployment Mode is active.
 * Fail-closed safety invariants:
 * 1. Forced into preview if any preview indicator is present.
 * 2. Forced into preview if the request host is not the canonical production domain (e.g. firebrick-caterpillar-749126.hostingersite.com).
 * 3. Forced into preview if NEXT_PUBLIC_SITE_URL is a preview domain.
 * 4. In production (NODE_ENV === "production"), defaults to preview unless Live Broadcast or Production Read-Only is explicitly enabled on canonical host.
 * 5. In development (NODE_ENV === "development"), defaults to preview unless Docker Supabase is active (hybrid mode).
 */
export function isPreviewDeployment(req?: Request | any): boolean {
  if (
    process.env.VERCEL_ENV === "preview" ||
    process.env.APP_ENV === "preview" ||
    process.env.NEXT_PUBLIC_APP_ENV === "preview" ||
    process.env.SAVISKAR_PREVIEW === "true" ||
    process.env.HOSTINGER_PREVIEW === "true"
  ) {
    return true;
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "").toLowerCase();
  if (
    siteUrl.includes("preview") ||
    siteUrl.includes("hostinger") ||
    siteUrl.includes("vercel.app") ||
    siteUrl.includes("ngrok") ||
    siteUrl.includes("trycloudflare")
  ) {
    return true;
  }

  // Live broadcast on canonical host is not preview
  if (selfModule.isLiveBroadcastEnabled(req)) {
    return false;
  }

  // Production read-only on canonical host is not preview
  if (selfModule.isProductionReadOnlyEnabled(req)) {
    return false;
  }

  // In production runtime (e.g. Hostinger preview or unactivated production):
  if (process.env.NODE_ENV === "production") {
    const requestHost = extractHostFromRequest(req);
    if (requestHost && !isCanonicalProductionHost(requestHost)) {
      return true;
    }

    const siteUrlHost = extractHostFromSiteUrl();
    if (siteUrlHost && !isCanonicalProductionHost(siteUrlHost)) {
      return true;
    }

    return true;
  }

  // In development runtime:
  if (process.env.NODE_ENV === "development") {
    if (selfModule.isHybridDevelopmentModeActive()) {
      return false;
    }
    return true;
  }

  // In test runtime:
  if (selfModule.isHybridDevelopmentModeActive()) {
    return false;
  }

  const requestHost = extractHostFromRequest(req);
  if (requestHost) {
    if (
      requestHost.includes("hostingersite.com") ||
      requestHost.includes("hostinger") ||
      requestHost.includes("vercel.app") ||
      requestHost.includes("preview")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Authoritatively resolves the active broadcast operational mode:
 * - "live_production": Production environment with explicit release activation flag on canonical host.
 * - "production_readonly": Canonical production host with explicit read-only inspection flag enabled.
 * - "hybrid_development": Local development with Docker Supabase on port 54321.
 * - "preview": Cloud preview, staging, or unactivated deployment.
 */
export function getBroadcastOperationalMode(req?: Request | any): BroadcastOperationalMode {
  if (selfModule.isLiveBroadcastEnabled(req)) return "live_production";
  if (selfModule.isProductionReadOnlyEnabled(req)) return "production_readonly";
  if (selfModule.isHybridDevelopmentModeActive()) return "hybrid_development";
  return "preview";
}

export function isSyntheticTestEmail(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith("@saviskar.test");
}

/**
 * Checks whether Hybrid Development Mode is active:
 * 1. Must be local development (process.env.NODE_ENV === "development").
 * 2. Strict cloud indicator guard: fails closed if VERCEL, NETLIFY, FLY_APP_NAME, or RENDER is present.
 * 3. The primary Supabase URL (from .env.local) is hosted (non-loopback).
 * 4. Local Docker Supabase is available via .env.e2e.local on loopback port 54321.
 */
export function isHybridDevelopmentModeActive(): boolean {
  if (process.env.SAVISKAR_HYBRID_MODE === "true") return true;
  if (process.env.NODE_ENV !== "development") return false;
  if (
    Boolean(
      process.env.VERCEL ||
      process.env.NETLIFY ||
      process.env.FLY_APP_NAME ||
      process.env.RENDER
    )
  ) {
    return false;
  }

  const primaryUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  try {
    const parsed = new URL(primaryUrl);
    const isLoopback =
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") &&
      parsed.port === "54321";
    // If primary URL is already loopback, it's full isolated mode, not hybrid
    if (isLoopback) return false;
  } catch {
    return false;
  }

  return getLocalDockerCredentials() !== null;
}

/**
 * Derives local Docker Supabase credentials safely without modifying any environment files on disk.
 * Strictly enforces protocol http, host 127.0.0.1 or localhost, and port 54321.
 */
export function getLocalDockerCredentials(): { url: string; secretKey: string } | null {
  if (process.env.NODE_ENV !== "development") return null;
  if (
    Boolean(
      process.env.VERCEL ||
      process.env.NETLIFY ||
      process.env.FLY_APP_NAME ||
      process.env.RENDER
    )
  ) {
    return null;
  }

  // Check explicit environment variables if set
  if (process.env.LOCAL_BROADCAST_STORAGE_URL && process.env.LOCAL_BROADCAST_STORAGE_KEY) {
    try {
      const u = new URL(process.env.LOCAL_BROADCAST_STORAGE_URL);
      if (
        u.protocol === "http:" &&
        (u.hostname === "127.0.0.1" || u.hostname === "localhost") &&
        u.port === "54321"
      ) {
        return {
          url: process.env.LOCAL_BROADCAST_STORAGE_URL,
          secretKey: process.env.LOCAL_BROADCAST_STORAGE_KEY,
        };
      }
    } catch {}
  }

  // Parse .env.e2e.local safely in-memory without disk alteration
  try {
    if (fs.existsSync(".env.e2e.local")) {
      const content = fs.readFileSync(".env.e2e.local", "utf-8");
      let url = "";
      let secretKey = "";
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const eq = trimmed.indexOf("=");
          if (eq > 0) {
            const key = trimmed.slice(0, eq).trim();
            let val = trimmed.slice(eq + 1).trim();
            if (
              (val.startsWith('"') && val.endsWith('"')) ||
              (val.startsWith("'") && val.endsWith("'"))
            ) {
              val = val.slice(1, -1);
            }
            if (key === "NEXT_PUBLIC_SUPABASE_URL") url = val;
            if (key === "SUPABASE_SECRET_KEY" || key === "SUPABASE_SERVICE_ROLE_KEY") secretKey = val;
          }
        }
      }
      if (url && secretKey) {
        const u = new URL(url);
        if (
          u.protocol === "http:" &&
          (u.hostname === "127.0.0.1" || u.hostname === "localhost") &&
          u.port === "54321"
        ) {
          return { url, secretKey };
        }
      }
    }
  } catch (err) {
    console.warn("[HYBRID LOCAL STORAGE] Could not read .env.e2e.local:", err);
  }

  return null;
}

/**
 * Wraps a SupabaseClient in a strict read-only proxy that forbids any mutation operations (.insert, .update, .upsert, .delete, .rpc).
 * Guarantees that hosted Supabase cannot be modified via broadcast registration code.
 */
export function createReadOnlySupabaseClient(rawClient: SupabaseClient): SupabaseClient {
  return new Proxy(rawClient, {
    get(target, prop, receiver) {
      if (prop === "from") {
        return (table: string) => {
          const queryBuilder = (target as any).from(table);
          return new Proxy(queryBuilder, {
            get(qbTarget, qbProp, qbReceiver) {
              if (
                qbProp === "insert" ||
                qbProp === "update" ||
                qbProp === "upsert" ||
                qbProp === "delete"
              ) {
                throw new Error(
                  `Forbidden mutation operation '${String(qbProp)}' attempted on table '${table}' via read-only hosted registration client.`
                );
              }
              return Reflect.get(qbTarget, qbProp, qbReceiver);
            },
          });
        };
      }
      if (prop === "rpc") {
        throw new Error(
          "Forbidden RPC invocation attempted via read-only hosted registration client."
        );
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Returns the read-only hosted registration client.
 * Connects to the hosted project from .env.local to query real registrations, participants, etc.
 * Wrapped in createReadOnlySupabaseClient to guarantee mutations are strictly rejected.
 * Never used for campaign or certificate writes.
 */
export function getHostedRegistrationReadClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "Missing Supabase registration credentials (NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY)."
    );
  }

  const client = createSupabaseClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  return createReadOnlySupabaseClient(client);
}

/**
 * Returns the local broadcast storage client for campaign persistence, certificate snapshots, deliveries, and queue claims.
 * In hybrid development mode: connects to the local Docker database (port 54321) where broadcast tables exist.
 * Otherwise: connects to the configured admin database.
 * Fails closed if local storage credentials cannot be resolved in hybrid mode.
 */
export function getBroadcastStorageClient(): SupabaseClient {
  if (isHybridDevelopmentModeActive()) {
    const creds = getLocalDockerCredentials();
    if (!creds) {
      throw new Error(
        "Hybrid Development Mode is active, but local Docker Supabase credentials (http://127.0.0.1:54321) could not be resolved. Campaign storage aborted to protect hosted database."
      );
    }
    return createSupabaseClient(creds.url, creds.secretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }

  // Standard non-hybrid mode
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "Missing Supabase admin credentials (NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY)."
    );
  }

  return createSupabaseClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

// Backwards-compatible alias for existing worker/campaign code
export const getBroadcastSupabaseAdmin = getBroadcastStorageClient;

export interface ResolvedCreatorIdentity {
  effectiveCreatedBy: string | null;
  targetFilters: Record<string, any>;
  initiatorAudit: {
    initiating_actor_id: string;
    initiating_actor_email: string | null;
    identity_source: string;
    mode: "hybrid_development" | "production";
    storage_actor_id: string | null;
    note?: string;
    created_at: string;
  };
}

/**
 * Resolves the campaign creator identity and audit trail.
 * In production: preserves 1:1 mapping from verified auth session to public.admins(user_id).
 * In hybrid mode: resolves created_by to a valid local admin row in public.admins to satisfy
 * referential integrity (broadcast_campaigns_created_by_fkey), while immutably recording
 * the initiating Master Admin's hosted actor identity and session source in target_filters.audit.
 */
export async function resolveCampaignCreatorIdentity(
  storageClient: SupabaseClient,
  initiatingAdminId: string,
  initiatingAdminEmail?: string | null,
  existingFilters: Record<string, any> = {}
): Promise<ResolvedCreatorIdentity> {
  const isHybrid = isHybridDevelopmentModeActive();

  if (!isHybrid) {
    const audit = {
      initiating_actor_id: initiatingAdminId,
      initiating_actor_email: initiatingAdminEmail || null,
      identity_source: "authoritative_auth_session",
      mode: "production" as const,
      storage_actor_id: initiatingAdminId,
      created_at: new Date().toISOString(),
    };
    return {
      effectiveCreatedBy: initiatingAdminId,
      targetFilters: {
        ...existingFilters,
        audit,
      },
      initiatorAudit: audit,
    };
  }

  // Hybrid Development Mode:
  // 1. Check if initiatingAdminId exists in local storage DB (e.g. local tests or seeded admin)
  try {
    const { data: directAdmin } = await storageClient
      .from("admins")
      .select("user_id, role")
      .eq("user_id", initiatingAdminId)
      .maybeSingle();

    if (directAdmin) {
      const audit = {
        initiating_actor_id: initiatingAdminId,
        initiating_actor_email: initiatingAdminEmail || null,
        identity_source: "local_admins_match",
        mode: "hybrid_development" as const,
        storage_actor_id: directAdmin.user_id,
        created_at: new Date().toISOString(),
      };
      return {
        effectiveCreatedBy: directAdmin.user_id,
        targetFilters: {
          ...existingFilters,
          audit,
        },
        initiatorAudit: audit,
      };
    }
  } catch (err) {
    console.warn("[HYBRID CREATOR RESOLVER] Error checking local admins:", err);
  }

  // 2. Initiating ID is from hosted Supabase auth session and does not exist in local Docker Supabase.
  // Query local `public.admins` for local master admin to satisfy referential integrity.
  let fallbackLocalAdminId: string | null = null;
  try {
    const { data: localMaster } = await storageClient
      .from("admins")
      .select("user_id, role")
      .eq("role", "master")
      .limit(1)
      .maybeSingle();

    if (localMaster?.user_id) {
      fallbackLocalAdminId = localMaster.user_id;
    } else {
      const { data: anyAdmin } = await storageClient
        .from("admins")
        .select("user_id")
        .limit(1)
        .maybeSingle();
      fallbackLocalAdminId = anyAdmin?.user_id || null;
    }
  } catch (err) {
    console.warn("[HYBRID CREATOR RESOLVER] Error fetching local master admin:", err);
  }

  if (!fallbackLocalAdminId) {
    fallbackLocalAdminId = "db9424cb-b505-4cfd-b310-25c230138ca7";
  }

  const audit = {
    initiating_actor_id: initiatingAdminId,
    initiating_actor_email: initiatingAdminEmail || null,
    identity_source: "hosted_supabase_session",
    mode: "hybrid_development" as const,
    storage_actor_id: fallbackLocalAdminId,
    note: "Hybrid mode: mapped hosted auth actor to local master admin for referential integrity",
    created_at: new Date().toISOString(),
  };

  return {
    effectiveCreatedBy: fallbackLocalAdminId,
    targetFilters: {
      ...existingFilters,
      audit,
    },
    initiatorAudit: audit,
  };
}
