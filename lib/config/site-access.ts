/**
 * Central site access and page locking configuration for Saviskar 2026.
 *
 * This allows Primary Master Admins to dynamically lock and unlock specific
 * public pages on the site directly from the admin panel.
 */

export const DEFAULT_SITE_ACCESS = {
  // Registrations portal (/register and POST /api/register)
  REGISTRATIONS_ENABLED: true,
  REGISTRATION_ENABLED: true,

  // Festival schedule and campus map (/schedule)
  SCHEDULE_ENABLED:
    process.env.NEXT_PUBLIC_ENABLE_SCHEDULE === "true",

  // Sponsors & partners showcase (/sponsors)
  SPONSORS_ENABLED: true,

  // Star Night concert lineup (/starnight)
  STARNIGHT_ENABLED: true,

  // Individual event detail dossiers (/events/[category]/[event])
  EVENT_DETAILS_ENABLED: true,

  // Institutional legacy & alumni citations (/legacy)
  LEGACY_ENABLED:
    process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_ENABLE_LEGACY === "true",

  // Campus accommodation booking & hostel allocation (/register#accommodation)
  ACCOMMODATION_ENABLED: true,

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
  ACCOMMODATION_ENABLED: {
    name: "Campus Accommodation Booking",
    path: "/register#accommodation",
    category: "Campus Stay & Hospitality",
    description: "On-campus hostel accommodations, bed allocations, and accommodation checkout APIs.",
    moduleCode: "HOSPITALITY.SYS",
    classification: "RESTRICTED ACCESS // INVENTORY CONTROL",
    estimatedRelease: "OPERATIONAL",
    summary: "On-campus hostel accommodations and hospitality booking passes for participants attending Saviskar 2026 competitions at CGC University, Mohali.",
  },
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
  REGISTRATION_ENABLED: {
    name: "Participant Registration Form",
    path: "/register",
    category: "Accreditation",
    description: "Public event registration, squad onboarding, ticket passes, and registration API.",
    moduleCode: "ACCREDITATION.SYS",
    classification: "ACCESS RESTRICTED // REGISTRATION PAUSED",
    estimatedRelease: "TEMPORARILY PAUSED BY ADMINISTRATION",
    summary: "Online registrations and digital accreditation passes for 50+ competitions across Technical, Non-Technical, Cultural, and AIvishkar realms at CGC University, Mohali are temporarily paused by administration.",
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
    name: "Partners & Strategic Allies",
    path: "/sponsors",
    category: "Corporate Allies",
    description: "Official brand partners, corporate patrons, associate allies, tier matrix.",
    moduleCode: "ALLIES.SYS",
    classification: "CORPORATE ALLIES // TIER 1 MATRIX",
    estimatedRelease: "CORPORATE REVEAL STAGE",
    summary: "Official brand partners, technology leaders, luxury allies, and corporate patrons powering the 50+ competitions and stadium headliners at CGC University, Mohali.",
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

export interface GetSiteAccessOptions {
  bypassCache?: boolean;
}

export interface SiteAccessState {
  locks: SiteAccessConfig;
  accommodationLockTimestamp: string | null;
  registrationLockTimestamp: string | null;
}

let cachedAccess: { data: SiteAccessConfig; expiresAt: number } | null = null;
let cachedLockTimestamp: string | null = null;
let cachedRegLockTimestamp: string | null = null;
const CACHE_TTL_MS = 5000; // 5s in-memory cache

let testOverrideLocks: SiteAccessConfig | null = null;
let testOverrideLockTimestamp: string | null = null;
let testOverrideRegLockTimestamp: string | null = null;

/**
 * Test helper to safely simulate lock configurations in unit tests
 */
export function __setTestSiteAccess(
  overrides: Partial<SiteAccessConfig> | null,
  lockTimestamp: string | null = null,
  registrationLockTimestamp: string | null = null
) {
  if (overrides === null) {
    testOverrideLocks = null;
    testOverrideLockTimestamp = null;
    testOverrideRegLockTimestamp = null;
  } else {
    testOverrideLocks = {
      ...DEFAULT_SITE_ACCESS,
      ...overrides,
    };
    // Sync REGISTRATION_ENABLED and REGISTRATIONS_ENABLED if one is provided
    if (overrides.REGISTRATION_ENABLED !== undefined && overrides.REGISTRATIONS_ENABLED === undefined) {
      testOverrideLocks.REGISTRATIONS_ENABLED = overrides.REGISTRATION_ENABLED;
    } else if (overrides.REGISTRATIONS_ENABLED !== undefined && overrides.REGISTRATION_ENABLED === undefined) {
      testOverrideLocks.REGISTRATION_ENABLED = overrides.REGISTRATIONS_ENABLED;
    }
    testOverrideLockTimestamp = lockTimestamp;
    testOverrideRegLockTimestamp = registrationLockTimestamp;
  }
  clearSiteAccessCache();
}

/**
 * Returns the full site access state including lock configuration and
 * authoritative accommodation and registration lock timestamps (if locked).
 */
export async function getSiteAccessState(
  options?: GetSiteAccessOptions
): Promise<SiteAccessState> {
  if (testOverrideLocks) {
    return {
      locks: { ...testOverrideLocks },
      accommodationLockTimestamp: testOverrideLockTimestamp,
      registrationLockTimestamp: testOverrideRegLockTimestamp,
    };
  }

  const now = Date.now();
  if (!options?.bypassCache && cachedAccess && cachedAccess.expiresAt > now) {
    return {
      locks: cachedAccess.data,
      accommodationLockTimestamp: cachedLockTimestamp,
      registrationLockTimestamp: cachedRegLockTimestamp,
    };
  }

  // In automated test environments without a live DB, return fallback defaults immediately
  if (process.env.NODE_ENV === "test" && process.env.TEST_LIVE_DB !== "true") {
    const fallback = { ...DEFAULT_SITE_ACCESS };
    cachedAccess = { data: fallback, expiresAt: now + CACHE_TTL_MS };
    cachedLockTimestamp = null;
    cachedRegLockTimestamp = null;
    return { locks: fallback, accommodationLockTimestamp: null, registrationLockTimestamp: null };
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
        .select("details, created_at")
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

        // Synchronize REGISTRATION_ENABLED and REGISTRATIONS_ENABLED
        if (merged.REGISTRATIONS_ENABLED === false || merged.REGISTRATION_ENABLED === false) {
          merged.REGISTRATIONS_ENABLED = false;
          merged.REGISTRATION_ENABLED = false;
        }

        let accLockTimestamp: string | null = null;
        if (merged.ACCOMMODATION_ENABLED === false) {
          accLockTimestamp =
            data.details?.lock_timestamps?.ACCOMMODATION_ENABLED ||
            data.details?.accommodation_locked_at ||
            null;

          if (!accLockTimestamp) {
            accLockTimestamp =
              data.details?.updated_at || data.created_at || new Date().toISOString();
          }
        }

        let regLockTimestamp: string | null = null;
        if (merged.REGISTRATION_ENABLED === false) {
          regLockTimestamp =
            data.details?.lock_timestamps?.REGISTRATION_ENABLED ||
            data.details?.lock_timestamps?.REGISTRATIONS_ENABLED ||
            data.details?.registration_locked_at ||
            null;

          if (!regLockTimestamp) {
            regLockTimestamp =
              data.details?.updated_at || data.created_at || new Date().toISOString();
          }
        }

        cachedAccess = { data: merged, expiresAt: now + CACHE_TTL_MS };
        cachedLockTimestamp = accLockTimestamp;
        cachedRegLockTimestamp = regLockTimestamp;

        return {
          locks: merged,
          accommodationLockTimestamp: accLockTimestamp,
          registrationLockTimestamp: regLockTimestamp,
        };
      }
    }
  } catch (err) {
    console.warn("Failed to fetch dynamic site access, using defaults:", err);
  }

  const fallback = { ...DEFAULT_SITE_ACCESS };
  cachedAccess = { data: fallback, expiresAt: now + CACHE_TTL_MS };
  cachedLockTimestamp = null;
  cachedRegLockTimestamp = null;
  return { locks: fallback, accommodationLockTimestamp: null, registrationLockTimestamp: null };
}

/**
 * Dynamically queries the latest site access configuration from Supabase admin_audit_logs,
 * falling back gracefully to DEFAULT_SITE_ACCESS.
 */
export async function getSiteAccess(
  options?: GetSiteAccessOptions
): Promise<SiteAccessConfig> {
  const state = await getSiteAccessState(options);
  return state.locks;
}

/**
 * Clears the in-memory cache so subsequent requests read the updated state immediately.
 */
export function clearSiteAccessCache() {
  cachedAccess = null;
  cachedLockTimestamp = null;
  cachedRegLockTimestamp = null;
}

// Synchronous fallback export for legacy backwards compatibility
export const SITE_ACCESS = DEFAULT_SITE_ACCESS;
