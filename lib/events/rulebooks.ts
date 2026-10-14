export interface EventRulebookInfo {
  slug: string;
  name: string;
  category: "technical" | "non-technical" | "cultural";
  pdfUrl: string;
  realmPdfUrl: string;
  startPage: number;
  endPage: number;
  pageCount: number;
}

export const EVENT_RULEBOOKS: Record<string, EventRulebookInfo> = {
  // Cultural Realm (11 events)
  "footlose-solo-western-dance": {
    slug: "footlose-solo-western-dance",
    name: "Footlose - Solo Western dance",
    category: "cultural",
    pdfUrl: "/rulebooks/events/footlose-solo-western-dance.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-cultural-rulebook.pdf#page=4",
    startPage: 4,
    endPage: 4,
    pageCount: 1,
  },
  "footlose-crew-western-dance": {
    slug: "footlose-crew-western-dance",
    name: "Footlose - Crew Western Dance",
    category: "cultural",
    pdfUrl: "/rulebooks/events/footlose-crew-western-dance.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-cultural-rulebook.pdf#page=5",
    startPage: 5,
    endPage: 5,
    pageCount: 1,
  },
  "nritya-e-bharat-folk-dance": {
    slug: "nritya-e-bharat-folk-dance",
    name: "Nritya-e-bharat",
    category: "cultural",
    pdfUrl: "/rulebooks/events/nritya-e-bharat-folk-dance.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-cultural-rulebook.pdf#page=6",
    startPage: 6,
    endPage: 6,
    pageCount: 1,
  },
  "nachda-punjab-punjabi-folk": {
    slug: "nachda-punjab-punjabi-folk",
    name: "Nachda Punjab",
    category: "cultural",
    pdfUrl: "/rulebooks/events/nachda-punjab-punjabi-folk.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-cultural-rulebook.pdf#page=7",
    startPage: 7,
    endPage: 7,
    pageCount: 1,
  },
  "sur-sagar-sing-your-story": {
    slug: "sur-sagar-sing-your-story",
    name: "Sur Sagar",
    category: "cultural",
    pdfUrl: "/rulebooks/events/sur-sagar-sing-your-story.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-cultural-rulebook.pdf#page=8",
    startPage: 8,
    endPage: 8,
    pageCount: 1,
  },
  "gully-war-rap-battle": {
    slug: "gully-war-rap-battle",
    name: "Gully war",
    category: "cultural",
    pdfUrl: "/rulebooks/events/gully-war-rap-battle.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-cultural-rulebook.pdf#page=9",
    startPage: 9,
    endPage: 9,
    pageCount: 1,
  },
  "spin-dance-freestyle-street-dance": {
    slug: "spin-dance-freestyle-street-dance",
    name: "Spin & Dance",
    category: "cultural",
    pdfUrl: "/rulebooks/events/spin-dance-freestyle-street-dance.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-cultural-rulebook.pdf#page=10",
    startPage: 10,
    endPage: 10,
    pageCount: 1,
  },
  "mr-ms-saviskar": {
    slug: "mr-ms-saviskar",
    name: "Mr & Ms Saviskar",
    category: "cultural",
    pdfUrl: "/rulebooks/events/mr-ms-saviskar.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-cultural-rulebook.pdf#page=11",
    startPage: 11,
    endPage: 11,
    pageCount: 1,
  },
  "saviskar-got-talent": {
    slug: "saviskar-got-talent",
    name: "Saviskar Got Talent",
    category: "cultural",
    pdfUrl: "/rulebooks/events/saviskar-got-talent.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-cultural-rulebook.pdf#page=12",
    startPage: 12,
    endPage: 12,
    pageCount: 1,
  },
  "battle-of-bands": {
    slug: "battle-of-bands",
    name: "Clash of Chords",
    category: "cultural",
    pdfUrl: "/rulebooks/events/battle-of-bands.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-cultural-rulebook.pdf#page=13",
    startPage: 13,
    endPage: 13,
    pageCount: 1,
  },
  "nukkad-natak": {
    slug: "nukkad-natak",
    name: "Nukkad Natak",
    category: "cultural",
    pdfUrl: "/rulebooks/events/nukkad-natak.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-cultural-rulebook.pdf#page=14",
    startPage: 14,
    endPage: 14,
    pageCount: 1,
  },

  // Non-Technical Realm (16 events)
  "ad-mad-show": {
    slug: "ad-mad-show",
    name: "Ad-Mad Show",
    category: "non-technical",
    pdfUrl: "/rulebooks/events/ad-mad-show.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-non-technical-rulebook.pdf#page=4",
    startPage: 4,
    endPage: 7,
    pageCount: 4,
  },
  "brand-battle": {
    slug: "brand-battle",
    name: "Brand Battle",
    category: "non-technical",
    pdfUrl: "/rulebooks/events/brand-battle.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-non-technical-rulebook.pdf#page=8",
    startPage: 8,
    endPage: 11,
    pageCount: 4,
  },
  "the-case-mystique": {
    slug: "the-case-mystique",
    name: "The Case Mystique",
    category: "non-technical",
    pdfUrl: "/rulebooks/events/the-case-mystique.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-non-technical-rulebook.pdf#page=12",
    startPage: 12,
    endPage: 14,
    pageCount: 3,
  },
  "dose-diaries": {
    slug: "dose-diaries",
    name: "Dose Diaries",
    category: "non-technical",
    pdfUrl: "/rulebooks/events/dose-diaries.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-non-technical-rulebook.pdf#page=15",
    startPage: 15,
    endPage: 17,
    pageCount: 3,
  },
  "chill-n-grill": {
    slug: "chill-n-grill",
    name: "Chill N Grill",
    category: "non-technical",
    pdfUrl: "/rulebooks/events/chill-n-grill.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-non-technical-rulebook.pdf#page=18",
    startPage: 18,
    endPage: 21,
    pageCount: 4,
  },
  "reel-ity-check": {
    slug: "reel-ity-check",
    name: "Reel-ity Check",
    category: "non-technical",
    pdfUrl: "/rulebooks/events/reel-ity-check.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-non-technical-rulebook.pdf#page=22",
    startPage: 22,
    endPage: 26,
    pageCount: 5,
  },
  "face-painting": {
    slug: "face-painting",
    name: "Face Painting",
    category: "non-technical",
    pdfUrl: "/rulebooks/events/face-painting.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-non-technical-rulebook.pdf#page=27",
    startPage: 27,
    endPage: 28,
    pageCount: 2,
  },
  "canvas-art": {
    slug: "canvas-art",
    name: "Canvas Art",
    category: "non-technical",
    pdfUrl: "/rulebooks/events/canvas-art.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-non-technical-rulebook.pdf#page=29",
    startPage: 29,
    endPage: 30,
    pageCount: 2,
  },
  "doodle-art": {
    slug: "doodle-art",
    name: "Doodle Art",
    category: "non-technical",
    pdfUrl: "/rulebooks/events/doodle-art.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-non-technical-rulebook.pdf#page=31",
    startPage: 31,
    endPage: 32,
    pageCount: 2,
  },
  "photography-competition": {
    slug: "photography-competition",
    name: "Photography Competition",
    category: "non-technical",
    pdfUrl: "/rulebooks/events/photography-competition.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-non-technical-rulebook.pdf#page=33",
    startPage: 33,
    endPage: 37,
    pageCount: 5,
  },
  "short-film-contest": {
    slug: "short-film-contest",
    name: "Short Film Contest",
    category: "non-technical",
    pdfUrl: "/rulebooks/events/short-film-contest.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-non-technical-rulebook.pdf#page=38",
    startPage: 38,
    endPage: 44,
    pageCount: 7,
  },
  "visual-storytelling-challenge": {
    slug: "visual-storytelling-challenge",
    name: "Visual Storytelling Challenge",
    category: "non-technical",
    pdfUrl: "/rulebooks/events/visual-storytelling-challenge.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-non-technical-rulebook.pdf#page=45",
    startPage: 45,
    endPage: 50,
    pageCount: 6,
  },
  "open-mic": {
    slug: "open-mic",
    name: "Open Mic",
    category: "non-technical",
    pdfUrl: "/rulebooks/events/open-mic.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-non-technical-rulebook.pdf#page=51",
    startPage: 51,
    endPage: 58,
    pageCount: 8,
  },
  "the-opinion-exchange": {
    slug: "the-opinion-exchange",
    name: "The Opinion Exchange",
    category: "non-technical",
    pdfUrl: "/rulebooks/events/the-opinion-exchange.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-non-technical-rulebook.pdf#page=59",
    startPage: 59,
    endPage: 72,
    pageCount: 14,
  },
  "vlog-making": {
    slug: "vlog-making",
    name: "Vlog Making",
    category: "non-technical",
    pdfUrl: "/rulebooks/events/vlog-making.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-non-technical-rulebook.pdf#page=73",
    startPage: 73,
    endPage: 75,
    pageCount: 3,
  },
  "business-quiz": {
    slug: "business-quiz",
    name: "Business Quiz",
    category: "non-technical",
    pdfUrl: "/rulebooks/events/business-quiz.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-non-technical-rulebook.pdf#page=76",
    startPage: 76,
    endPage: 78,
    pageCount: 3,
  },

  // Technical Realm (22 events)
  "web-dev-sprint": {
    slug: "web-dev-sprint",
    name: "Web-Dev Sprint",
    category: "technical",
    pdfUrl: "/rulebooks/events/web-dev-sprint.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf#page=4",
    startPage: 4,
    endPage: 7,
    pageCount: 4,
  },
  "code-circuit-pass-the-code-beat-the-clock": {
    slug: "code-circuit-pass-the-code-beat-the-clock",
    name: "Code Circuit",
    category: "technical",
    pdfUrl: "/rulebooks/events/code-circuit-pass-the-code-beat-the-clock.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf#page=8",
    startPage: 8,
    endPage: 13,
    pageCount: 6,
  },
  "roborace": {
    slug: "roborace",
    name: "RoboRace",
    category: "technical",
    pdfUrl: "/rulebooks/events/roborace.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf#page=14",
    startPage: 14,
    endPage: 16,
    pageCount: 3,
  },
  "bug-hunt-coding-contest": {
    slug: "bug-hunt-coding-contest",
    name: "Bug Hunt",
    category: "technical",
    pdfUrl: "/rulebooks/events/bug-hunt-coding-contest.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf#page=17",
    startPage: 17,
    endPage: 23,
    pageCount: 7,
  },
  "thrust-powered-vehicle-challenge": {
    slug: "thrust-powered-vehicle-challenge",
    name: "Thrust Powered Vehicle Challenge",
    category: "technical",
    pdfUrl: "/rulebooks/events/thrust-powered-vehicle-challenge.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf#page=24",
    startPage: 24,
    endPage: 28,
    pageCount: 5,
  },
  "graviton": {
    slug: "graviton",
    name: "Graviton",
    category: "technical",
    pdfUrl: "/rulebooks/events/graviton.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf#page=29",
    startPage: 29,
    endPage: 34,
    pageCount: 6,
  },
  "formularx": {
    slug: "formularx",
    name: "FormulaRx",
    category: "technical",
    pdfUrl: "/rulebooks/events/formularx.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf#page=35",
    startPage: 35,
    endPage: 39,
    pageCount: 5,
  },
  "prayog": {
    slug: "prayog",
    name: "Prayog",
    category: "technical",
    pdfUrl: "/rulebooks/events/prayog.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf#page=40",
    startPage: 40,
    endPage: 42,
    pageCount: 3,
  },
  "labx": {
    slug: "labx",
    name: "LabX",
    category: "technical",
    pdfUrl: "/rulebooks/events/labx.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf#page=43",
    startPage: 43,
    endPage: 46,
    pageCount: 4,
  },
  "mun-international-press": {
    slug: "mun-international-press",
    name: "MUN - International Press",
    category: "technical",
    pdfUrl: "/rulebooks/events/mun-international-press.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf#page=47",
    startPage: 47,
    endPage: 54,
    pageCount: 8,
  },
  "mun-united-nation-general-assembly": {
    slug: "mun-united-nation-general-assembly",
    name: "MUN - United Nation General Assembly",
    category: "technical",
    pdfUrl: "/rulebooks/events/mun-united-nation-general-assembly.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf#page=47",
    startPage: 47,
    endPage: 54,
    pageCount: 8,
  },
  "mun-united-nation-human-rights": {
    slug: "mun-united-nation-human-rights",
    name: "MUN - United Nation Human Rights",
    category: "technical",
    pdfUrl: "/rulebooks/events/mun-united-nation-human-rights.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf#page=47",
    startPage: 47,
    endPage: 54,
    pageCount: 8,
  },
  "mun-united-nation-security-council": {
    slug: "mun-united-nation-security-council",
    name: "MUN - United Nation Security Council",
    category: "technical",
    pdfUrl: "/rulebooks/events/mun-united-nation-security-council.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf#page=47",
    startPage: 47,
    endPage: 54,
    pageCount: 8,
  },
  "crime-scenece": {
    slug: "crime-scenece",
    name: "Crime Scenece",
    category: "technical",
    pdfUrl: "/rulebooks/events/crime-scenece.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf#page=55",
    startPage: 55,
    endPage: 59,
    pageCount: 5,
  },
  "diagnostic-challenge": {
    slug: "diagnostic-challenge",
    name: "Diagnostic Challenge",
    category: "technical",
    pdfUrl: "/rulebooks/events/diagnostic-challenge.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf#page=60",
    startPage: 60,
    endPage: 70,
    pageCount: 11,
  },
  "optovation-build-a-smart-eye": {
    slug: "optovation-build-a-smart-eye",
    name: "Optovation-Build a smart eye",
    category: "technical",
    pdfUrl: "/rulebooks/events/optovation-build-a-smart-eye.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf#page=71",
    startPage: 71,
    endPage: 74,
    pageCount: 4,
  },
  "assessment-of-posture-education": {
    slug: "assessment-of-posture-education",
    name: "Assessment of posture education",
    category: "technical",
    pdfUrl: "/rulebooks/events/assessment-of-posture-education.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf#page=75",
    startPage: 75,
    endPage: 77,
    pageCount: 3,
  },
  "incubation-and-airway-management-simulation": {
    slug: "incubation-and-airway-management-simulation",
    name: "Incubation and Airway management simulation",
    category: "technical",
    pdfUrl: "/rulebooks/events/incubation-and-airway-management-simulation.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf#page=78",
    startPage: 78,
    endPage: 79,
    pageCount: 2,
  },
  "vision-hack-train-your-own-ai": {
    slug: "vision-hack-train-your-own-ai",
    name: "VISION HACK — Train Your Own AI",
    category: "technical",
    pdfUrl: "/rulebooks/events/vision-hack-train-your-own-ai.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf#page=80",
    startPage: 80,
    endPage: 81,
    pageCount: 2,
  },
  "ai-video-meme-challenge": {
    slug: "ai-video-meme-challenge",
    name: "AI Video & Meme Challenge",
    category: "technical",
    pdfUrl: "/rulebooks/events/ai-video-meme-challenge.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf#page=82",
    startPage: 82,
    endPage: 84,
    pageCount: 3,
  },
  "ai-game-maker-challenge": {
    slug: "ai-game-maker-challenge",
    name: "AI Game Maker Challenge",
    category: "technical",
    pdfUrl: "/rulebooks/events/ai-game-maker-challenge.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf#page=85",
    startPage: 85,
    endPage: 87,
    pageCount: 3,
  },
  "the-best-manager": {
    slug: "the-best-manager",
    name: "The Best Manager",
    category: "technical",
    pdfUrl: "/rulebooks/events/the-best-manager.pdf",
    realmPdfUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf#page=88",
    startPage: 88,
    endPage: 93,
    pageCount: 6,
  },
};

/**
 * Normalized lookup dictionary mapping event names (lowercased & cleaned) to rulebooks
 */
const NORMALIZED_NAME_MAP = new Map<string, EventRulebookInfo>();

for (const item of Object.values(EVENT_RULEBOOKS)) {
  const normSlug = item.slug.toLowerCase().trim();
  const normName = item.name.toLowerCase().trim();
  NORMALIZED_NAME_MAP.set(normSlug, item);
  NORMALIZED_NAME_MAP.set(normName, item);
  // Also index without punctuation/dashes
  const cleanName = normName.replace(/[^a-z0-9]/g, "");
  NORMALIZED_NAME_MAP.set(cleanName, item);
}

/**
 * Retrieves the event-specific rulebook for a given event slug or event name.
 * Falls back to the realm category rulebook if an unknown event is provided.
 */
export function getEventRulebook(
  identifier?: string | null,
  categoryFallback?: string | null
): EventRulebookInfo {
  if (identifier) {
    const trimmed = identifier.trim().toLowerCase();
    const clean = trimmed.replace(/[^a-z0-9]/g, "");

    const found =
      EVENT_RULEBOOKS[trimmed] ||
      NORMALIZED_NAME_MAP.get(trimmed) ||
      NORMALIZED_NAME_MAP.get(clean);

    if (found) {
      return found;
    }

    // Fuzzy contains lookup
    for (const [key, value] of NORMALIZED_NAME_MAP.entries()) {
      if (key.length > 3 && (trimmed.includes(key) || key.includes(trimmed))) {
        return value;
      }
    }
  }

  // Graceful fallback to realm master rulebook
  const cat = (categoryFallback || "technical").toLowerCase();
  const realmCategory = (
    cat.includes("cult") ? "cultural" : cat.includes("non") ? "non-technical" : "technical"
  ) as "technical" | "non-technical" | "cultural";

  return {
    slug: identifier || "general",
    name: identifier || "Saviskar 2026 Event",
    category: realmCategory,
    pdfUrl: `/rulebooks/saviskar-2026-${realmCategory}-rulebook.pdf`,
    realmPdfUrl: `/rulebooks/saviskar-2026-${realmCategory}-rulebook.pdf`,
    startPage: 1,
    endPage: 1,
    pageCount: 1,
  };
}
