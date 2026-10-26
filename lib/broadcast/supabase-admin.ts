import fs from "fs";
import { createClient as createSupabaseClient, SupabaseClient } from "@supabase/supabase-js";

export const HYBRID_READONLY_ERROR =
  "Hybrid development mode is read-only for real participants. Use synthetic test recipients to test delivery. No campaign was created.";

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
