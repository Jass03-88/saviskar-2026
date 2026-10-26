export interface StrategicPartner {
  id: string;
  name: string;
  officialTitle: string;
  shortTitle: string;
  category: "all" | "beverage-energy" | "tech-optical" | "luxury-glamour" | "wellness-care" | "corporate-gifting";
  categoryLabel: string;
  tier: "Exclusive Partner" | "Strategic Partner";
  tagline: string;
  description: string;
  accentColor: string;
  hexColor: string;
  gradient: string;
  borderGlow: string;
  badgeBg: string;
  badgeText: string;
  brandWebsite?: string;
  symbolType: "coke" | "oppo" | "qilver" | "pl" | "bake" | "livup" | "secrettemptation";
  logoImage: string;
  fallbackLogoImages: string[];
}

// Backwards compatibility alias
export type SponsorPartner = StrategicPartner;

export const PARTNERS_DATA: StrategicPartner[] = [
  {
    id: "coke",
    name: "Coca-Cola",
    officialTitle: "Official Beverages Partner",
    shortTitle: "Beverages Partner",
    category: "beverage-energy",
    categoryLabel: "Beverages & Refreshment",
    tier: "Strategic Partner",
    tagline: "Real Magic in Every Sip — Fueling 35,000+ Innovators",
    description:
      "Global beverage titan powering high-energy competition arenas, midnight hackathon coding marathons, and the massive Star Night stadium crowds with chilled, iconic refreshment across the campus grounds.",
    accentColor: "red",
    hexColor: "#F40009",
    gradient: "from-red-600 via-rose-500 to-amber-600",
    borderGlow: "hover:border-red-500/50 hover:shadow-[0_0_35px_rgba(244,0,9,0.25)]",
    badgeBg: "bg-red-500/10 border-red-500/30 text-red-400",
    badgeText: "OFFICIAL BEVERAGES PARTNER",
    symbolType: "coke",
    logoImage: "/sponsors/coke.png",
    fallbackLogoImages: ["/sponsors/coke.png", "/sponsors/COCA COLA.png"],
    brandWebsite: "https://www.coca-colacompany.com",
  },
  {
    id: "oppo",
    name: "OPPO",
    officialTitle: "Official Selfie Partner",
    shortTitle: "Selfie Partner",
    category: "tech-optical",
    categoryLabel: "Smartphones & Imaging",
    tier: "Exclusive Partner",
    tagline: "Inspiration Ahead — Capturing Every Unforgettable Festival Moment in Ultra-HD",
    description:
      "Global smart device and mobile imaging pioneer bringing next-generation AI portrait photography, studio-grade clarity, and flagship smartphone experiences to Saviskar 2026.",
    accentColor: "emerald",
    hexColor: "#04A85B",
    gradient: "from-emerald-500 via-teal-400 to-cyan-400",
    borderGlow: "hover:border-emerald-500/50 hover:shadow-[0_0_35px_rgba(4,168,91,0.25)]",
    badgeBg: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
    badgeText: "OFFICIAL SELFIE PARTNER",
    symbolType: "oppo",
    logoImage: "/sponsors/oppo.png",
    fallbackLogoImages: ["/sponsors/oppo.png", "/sponsors/OPPO.png"],
    brandWebsite: "https://www.oppo.com",
  },
  {
    id: "qilver",
    name: "QILVER Jewelry",
    officialTitle: "Exclusive Jewellery Partner",
    shortTitle: "Exclusive Jewellery Partner",
    category: "luxury-glamour",
    categoryLabel: "Fine Jewelry & Royalty",
    tier: "Exclusive Partner",
    tagline: "Because Basic Isn't You — Crowning the Royalty of Saviskar 2026",
    description:
      "Luxury 925 sterling silver fine jewellery house, curating bespoke royal coronation crowns and silver master medallions for Mr. & Ms. Saviskar and national fashion runway champions.",
    accentColor: "sky",
    hexColor: "#38BDF8",
    gradient: "from-sky-400 via-cyan-300 to-slate-200",
    borderGlow: "hover:border-sky-400/50 hover:shadow-[0_0_35px_rgba(56,189,248,0.25)]",
    badgeBg: "bg-sky-500/10 border-sky-500/30 text-sky-300",
    badgeText: "EXCLUSIVE JEWELLERY PARTNER",
    symbolType: "qilver",
    logoImage: "/sponsors/qilver-white.png",
    fallbackLogoImages: ["/sponsors/qilver-white.png", "/sponsors/qilver.png", "/sponsors/Qilver.png"],
    brandWebsite: "https://qilver.com",
  },
  {
    id: "pl-industries",
    name: "P.L. Industries",
    officialTitle: "Official Gifting Partner",
    shortTitle: "Gifting Partner",
    category: "corporate-gifting",
    categoryLabel: "Corporate Gifting & Honors",
    tier: "Strategic Partner",
    tagline: "Honoring Excellence Since 1965 — Curating Bespoke Tributes for Tomorrow’s Leaders",
    description:
      "Established industrial brand and corporate gifting house (Kriti / P.L. Industries Since 1965), delivering executive gift suites, winner hampers, and commemorative citation packages for national championship squads.",
    accentColor: "orange",
    hexColor: "#E65300",
    gradient: "from-amber-500 via-orange-500 to-red-600",
    borderGlow: "hover:border-orange-500/50 hover:shadow-[0_0_35px_rgba(230,83,0,0.25)]",
    badgeBg: "bg-orange-500/10 border-orange-500/30 text-orange-400",
    badgeText: "OFFICIAL GIFTING PARTNER",
    symbolType: "pl",
    logoImage: "/sponsors/pl.png",
    fallbackLogoImages: ["/sponsors/pl.png", "/sponsors/pl-industries.png", "/sponsors/pi.png", "/sponsors/pi-industry.png"],
    brandWebsite: "https://www.plindustries.com",
  },
  {
    id: "bake",
    name: "BAKE",
    officialTitle: "Official Skin Care Partner",
    shortTitle: "Skin Care Partner",
    category: "wellness-care",
    categoryLabel: "Skin Care & Glow",
    tier: "Strategic Partner",
    tagline: "Science of Radiant Glow — Energizing Freshness Under the Festival Spotlights",
    description:
      "Active dermaceutical and clean beauty brand delivering high-efficacy skincare formulations, hydration mists, and glow essentials for stage performers, runway models, and festival attendees.",
    accentColor: "rose",
    hexColor: "#FB7185",
    gradient: "from-rose-400 via-pink-400 to-amber-300",
    borderGlow: "hover:border-rose-400/50 hover:shadow-[0_0_35px_rgba(251,113,133,0.25)]",
    badgeBg: "bg-rose-500/10 border-rose-500/30 text-rose-300",
    badgeText: "OFFICIAL SKIN CARE PARTNER",
    symbolType: "bake",
    logoImage: "/sponsors/bake.png",
    fallbackLogoImages: ["/sponsors/bake.png", "/sponsors/BAKE.png"],
    brandWebsite: "https://bakecosmetics.com",
  },
  {
    id: "liv-up",
    name: "Liv Up",
    officialTitle: "Official Hydration Partner",
    shortTitle: "Hydration Partner",
    category: "beverage-energy",
    categoryLabel: "Electrolyte & Hydration",
    tier: "Strategic Partner",
    tagline: "Peak Vitality, Zero Slump — Fueling High-Performance Energy Around the Clock",
    description:
      "Dynamic electrolyte and hydration nutrition brand keeping athletes, dancers, and hackathon competitors at peak endurance with rapid-rehydration minerals and zero-fatigue fueling.",
    accentColor: "cyan",
    hexColor: "#06B6D4",
    gradient: "from-cyan-400 via-sky-500 to-teal-400",
    borderGlow: "hover:border-cyan-400/50 hover:shadow-[0_0_35px_rgba(6,182,212,0.25)]",
    badgeBg: "bg-cyan-500/10 border-cyan-500/30 text-cyan-300",
    badgeText: "OFFICIAL HYDRATION PARTNER",
    symbolType: "livup",
    logoImage: "/sponsors/livup.png",
    fallbackLogoImages: ["/sponsors/livup.png", "/sponsors/LIV UP.png"],
    brandWebsite: "https://livupnutrition.com",
  },
  {
    id: "secret-temptation",
    name: "Secret Temptation",
    officialTitle: "Official Fragrance Partner",
    shortTitle: "Fragrance Partner",
    category: "luxury-glamour",
    categoryLabel: "Fragrance & Sensory Luxury",
    tier: "Exclusive Partner",
    tagline: "Leave an Unforgettable Impression — The Signature Scent of Aevorian Reverie",
    description:
      "Celebrated lifestyle and fragrance house bringing captivating aromas, sensory elegance, and luxury perfume gifts to the festival red carpet and cultural showcases.",
    accentColor: "purple",
    hexColor: "#C084FC",
    gradient: "from-purple-500 via-fuchsia-500 to-pink-500",
    borderGlow: "hover:border-purple-400/50 hover:shadow-[0_0_35px_rgba(192,132,252,0.25)]",
    badgeBg: "bg-purple-500/10 border-purple-500/30 text-purple-300",
    badgeText: "OFFICIAL FRAGRANCE PARTNER",
    symbolType: "secrettemptation",
    logoImage: "/sponsors/secret-temptation.png",
    fallbackLogoImages: ["/sponsors/secret-temptation.png", "/sponsors/SECRET TEMPTATION.png"],
    brandWebsite: "https://secrettemptation.com",
  },
];

// Backwards compatibility export
export const SPONSORS_DATA = PARTNERS_DATA;

export const FESTIVAL_IMPACT_METRICS = [
  {
    number: "35,000+",
    label: "Festival Footfall",
    detail: "Students, innovators, and creators across India",
  },
  {
    number: "50+",
    label: "Competition Arenas",
    detail: "Hackathons, RoboWars, Fashion & Cultural stages",
  },
  {
    number: "200+",
    label: "Universities & Colleges",
    detail: "Nationwide delegation across 18+ states",
  },
  {
    number: "5.2M+",
    label: "Digital Reach",
    detail: "Social engagement & live stream impressions",
  },
];

export const PARTNERSHIP_TEAM_CONTACTS = [
  {
    name: "Anmol Agarwal",
    role: "Lead, Corporate Alliances & Partnerships",
    wing: "Student Advisory Council (SAC)",
    email: "saviskar@cgcuniversity.in",
    avatar: "/images/SAC/ANMOL AGARWAL.webp",
  },
];

// Backwards compatibility export
export const SPONSORSHIP_TEAM_CONTACTS = PARTNERSHIP_TEAM_CONTACTS;
