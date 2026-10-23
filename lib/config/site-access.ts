/**
 * Central site access and page locking configuration for Saviskar 2026.
 *
 * This allows Primary Master Admins to dynamically lock and unlock specific
 * public pages on the site directly from the admin panel.
 */

export const DEFAULT_SITE_ACCESS = {
  // Registrations portal (/register and POST /api/register)
  REGISTRATIONS_ENABLED: true,

  // Festival schedule and campus map (/schedule)
  SCHEDULE_ENABLED:
    process.env.NEXT_PUBLIC_ENABLE_SCHEDULE === "true",

  // Sponsors & partners showcase (/sponsors)
  SPONSORS_ENABLED:
    process.env.NEXT_PUBLIC_ENABLE_SPONSORS === "true",

  // Star Night concert lineup (/starnight)
  STARNIGHT_ENABLED: true,

  // Individual event detail dossiers (/events/[category]/[event])
  EVENT_DETAILS_ENABLED: true,

  // Institutional legacy & alumni citations (/legacy)
  LEGACY_ENABLED:
    process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_ENABLE_LEGACY === "true",

  // Organising Team & Student Advisory Council (/team)
  TEAM_ENABLED: true,

  // Campus media & highlight gallery (/gallery)
  GALLERY_ENABLED: true,
};

export type SitePageKey = keyof typeof DEFAULT_SITE_ACCESS;
export type SiteAccessConfig = Record<SitePageKey, boolean>;

export const SITE_PAGE_DEFINITIONS: Record<
  SitePageKey,
  {
    name: string;
    path: string;
    category: string;
    description: string;
    moduleCode: string;
    classification: string;
    estimatedRelease: string;
    summary: string;
  }
> = {
  REGISTRATIONS_ENABLED: {
    name: "Registration Portal",
    path: "/register",
    category: "Accreditation",
    description: "Public event registration, squad onboarding, ticket passes, and registration API.",
    moduleCode: "ACCREDITATION.SYS",
    classification: "ACCESS RESTRICTED // PHASE 2 OPENING",
    estimatedRelease: "REGISTRATIONS OPENING SOON",
    summary: "Online registrations and digital accreditation passes for 50+ competitions across Technical, Non-Technical, Cultural, and AIvishkar realms at CGC University, Mohali will go live shortly. Explore the competitive realms and download rulebooks in the meantime.",
  },
  SCHEDULE_ENABLED: {
    name: "Festival Schedule & Radar",
    path: "/schedule",
    category: "Timeline & Radar",
    description: "Hourly competition schedules, campus stage coordinates, and event timeline.",
    moduleCode: "CHRONO.SYS",
    classification: "CLASSIFIED // CLEARANCE LEVEL 4",
    estimatedRelease: "PHASE 2 RELEASE",
    summary: "Hourly competition schedules, campus stage coordinates, syndicate paper slots, and stadium headline concert timelines for Saviskar 2026 at CGC University, Mohali are undergoing final operational synchronization.",
  },
  STARNIGHT_ENABLED: {
    name: "Star Night 2026",
    path: "/starnight",
    category: "Concert Arena",
    description: "Celebrity headliner concert drops (Asees Kaur & Ranjit Bawa), past stages, lights out.",
    moduleCode: "STARNIGHT.SYS",
    classification: "TOP SECRET // ARTIST LOCKDOWN",
    estimatedRelease: "HEADLINER DROP STAGE",
    summary: "Chart-topping headline concert reveals, celebrity artists, stadium lights, and stadium pass allocations for Saviskar 2026 at CGC University, Mohali will be decrypted soon.",
  },
  EVENT_DETAILS_ENABLED: {
    name: "Event Detail Dossiers",
    path: "/events/[category]/[event]",
    category: "Competition Rules",
    description: "50+ competition detail pages, rules, prize pool manifests, direct registration CTA.",
    moduleCode: "DOSSIER.SYS",
    classification: "RESTRICTED ACCESS // IN REVIEW",
    estimatedRelease: "DOSSIERS FINALIZING",
    summary: "Official competition rulebooks, evaluation rubrics, prize pool allocations, and registration slots are undergoing final domain scrutiny.",
  },
  SPONSORS_ENABLED: {
    name: "Sponsors & Partners",
    path: "/sponsors",
    category: "Corporate Allies",
    description: "Title partners, brand showcase, associate partners, corporate tier matrix.",
    moduleCode: "ALLIES.SYS",
    classification: "CORPORATE ALLIES // TIER 1 MATRIX",
    estimatedRelease: "CORPORATE REVEAL STAGE",
    summary: "Title sponsors, technology partners, automotive showcases, and realm titleholders powering the 50+ competitions and stadium headliners at CGC University, Mohali.",
  },
  LEGACY_ENABLED: {
    name: "Institutional Legacy",
    path: "/legacy",
    category: "Patron Citations",
    description: "Founder manifests, chancellor archive, patron citations, and alumni heritage.",
    moduleCode: "LEGACY.ARCHIVE",
    classification: "RESTRICTED // PROTOCOL LEVEL 3",
    estimatedRelease: "PHASE 2 RELEASE",
    summary: "The institutional leadership chronicles, founder manifests, and cherished alumni citations for Saviskar 2026 at CGC University, Mohali are undergoing final presidential review.",
  },
  TEAM_ENABLED: {
    name: "Organising Team & SAC",
    path: "/team",
    category: "Executive Council",
    description: "Faculty leadership, domain heads, 54-member Student Advisory Council (SAC).",
    moduleCode: "COUNCIL.SYS",
    classification: "EXECUTIVE ROSTER // LEVEL 2",
    estimatedRelease: "ROSTER ANNOUNCEMENT",
    summary: "The Student Advisory Council directory, faculty leadership manifests, and executive organizers for Saviskar 2026 are currently undergoing official administrative curation.",
  },
  GALLERY_ENABLED: {
    name: "Campus Media Gallery",
    path: "/gallery",
    category: "Visual Vault",
    description: "Festival photos, cinematic recap films, stage highlights, and media vaults.",
    moduleCode: "VAULT.SYS",
    classification: "MEDIA ARCHIVE // ENCRYPTION ACTIVE",
    estimatedRelease: "MEDIA DROP STAGE",
    summary: "High-definition photo archives, cinematic aftermovies, and historical celebration reels for Saviskar 2026 at CGC University, Mohali are undergoing media mastering.",
  },
};

export const SITE_ACCESS_AUDIT_TARGET_ID = "00000000-0000-0000-0000-000000000001";

let cachedAccess: { data: SiteAccessConfig; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5000; // 5s in-memory cache

/**
 * Dynamically queries the latest site access configuration from Supabase admin_audit_logs,
 * falling back gracefully to DEFAULT_SITE_ACCESS.
 */
export async function getSiteAccess(): Promise<SiteAccessConfig> {
  const now = Date.now();
  if (cachedAccess && cachedAccess.expiresAt > now) {
    return cachedAccess.data;
  }

  // In automated test environments without a live DB, return fallback defaults immediately
  if (process.env.NODE_ENV === "test" && process.env.TEST_LIVE_DB !== "true") {
    const fallback = { ...DEFAULT_SITE_ACCESS };
    cachedAccess = { data: fallback, expiresAt: now + CACHE_TTL_MS };
    return fallback;
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

    if (supabaseUrl && supabaseSecretKey) {
      const { createClient } = await import("@supabase/supabase-js");
      const client = createClient(supabaseUrl, supabaseSecretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const queryPromise = client
        .from("admin_audit_logs")
        .select("details")
        .eq("action_type", "SITE_PAGE_LOCKS_UPDATE")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const timeoutPromise = new Promise<{ data: null }>((resolve) =>
        setTimeout(() => resolve({ data: null }), 1500)
      );

      const result = await Promise.race([queryPromise, timeoutPromise]);
      const data = result?.data;

      if (data?.details?.locks && typeof data.details.locks === "object") {
        const merged: SiteAccessConfig = {
          ...DEFAULT_SITE_ACCESS,
          ...data.details.locks,
        };
        cachedAccess = { data: merged, expiresAt: now + CACHE_TTL_MS };
        return merged;
      }
    }
  } catch (err) {
    console.warn("Failed to fetch dynamic site access, using defaults:", err);
  }

  const fallback = { ...DEFAULT_SITE_ACCESS };
  cachedAccess = { data: fallback, expiresAt: now + CACHE_TTL_MS };
  return fallback;
}

/**
 * Clears the in-memory cache so subsequent requests read the updated state immediately.
 */
export function clearSiteAccessCache() {
  cachedAccess = null;
}

// Synchronous fallback export for legacy backwards compatibility
export const SITE_ACCESS = DEFAULT_SITE_ACCESS;
