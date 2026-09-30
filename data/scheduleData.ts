export interface CampusVenue {
  id: string;
  name: string;
  shortName: string;
  buildingCode: string;
  tagline: string;
  category: "technical" | "cultural" | "sports" | "non-technical" | "general" | "starnight";
  coordinates: {
    x: number; // percentage from left (0 to 100)
    y: number; // percentage from top (0 to 100)
  };
  capacity?: string;
  description: string;
  facilities: string[];
  accentColor: string; // Tailwind color token
  glowColor: string;
  pinBadge: string;
}

export interface ScheduleEvent {
  id: string;
  slug: string;
  name: string;
  category: "technical" | "cultural" | "sports" | "non-technical";
  venueId: string;
  venueName: string;
  room?: string;
  day: 1 | 2;
  date: string; // "2026-10-28" or "2026-10-29"
  startTime: string; // "10:00 AM"
  endTime: string; // "01:00 PM"
  timeSlot: string; // "Morning", "Afternoon", "Evening", "Night"
  description: string;
  prizePool?: string;
  registrationOpen: boolean;
  featured?: boolean;
}

// ============================================================================
// OFFICIAL CGC UNIVERSITY MOHALI CAMPUS VENUES (Spatial Map Overlay Registry)
// ============================================================================
export const CAMPUS_VENUES: CampusVenue[] = [
  {
    id: "block-1",
    name: "Block 1 — Academic Complex & Executive Conclave",
    shortName: "Block 1",
    buildingCode: "B-01",
    tagline: "Executive Conclaves, Syndicate Halls & VIP Receptions",
    category: "general",
    coordinates: { x: 47.0, y: 36.5 },
    capacity: "1,500+ Capacity",
    description: "The prominent central academic wing of CGC University Mohali. Hosts executive inaugurations, syndicate paper presentations, administrative conclaves, and VIP dignitary receptions.",
    facilities: ["Main Syndicate Hall", "VIP Conclave Chamber", "Accreditation Desk", "High-Speed Wi-Fi Zone"],
    accentColor: "amber",
    glowColor: "rgba(245, 158, 11, 0.45)",
    pinBadge: "BLOCK 1 // ACADEMIC",
  },
  {
    id: "block-2",
    name: "Block 2 — Main Auditorium & Tech Arena",
    shortName: "Block 2 (Auditorium)",
    buildingCode: "B-02",
    tagline: "Main Auditorium, Cultural Stage & RoboWars Arena",
    category: "cultural",
    coordinates: { x: 20.5, y: 44.0 },
    capacity: "1,200+ Capacity",
    description: "State-of-the-art auditorium and engineering arena located between Ivory Hall and Block 1. Centerstage for Mr & Ms Saviskar, Nachda Punjab, Footloose Western Dance, and the RoboWars combat cage.",
    facilities: ["Air-Conditioned Main Auditorium", "RoboWars Combat Cage", "Green Rooms & Make-up Bay", "Acoustic Surround PA"],
    accentColor: "rose",
    glowColor: "rgba(244, 63, 94, 0.45)",
    pinBadge: "BLOCK 2 // AUDITORIUM",
  },
  {
    id: "ivory-hall",
    name: "Ivory Hall (Girls Hostel)",
    shortName: "Ivory Hall",
    buildingCode: "IVORY",
    tagline: "Residential Commons & Floodlit Basketball Court",
    category: "cultural",
    coordinates: { x: 12.0, y: 56.5 },
    capacity: "800+ Residents",
    description: "Premier campus residential hostel pavilion on the western quad. Features outdoor floodlit basketball courts hosting Spin & Dance along with student residential commons.",
    facilities: ["Floodlit Basketball Court", "Student Activity Lounge", "First-Aid Response Desk", "24/7 Security Command"],
    accentColor: "fuchsia",
    glowColor: "rgba(217, 70, 239, 0.45)",
    pinBadge: "IVORY HALL // RESIDENCE",
  },
  {
    id: "block-3",
    name: "Block 3 — Media, E-Sports & 6th Floor Studios",
    shortName: "Block 3",
    buildingCode: "B-03",
    tagline: "Open Mic, Short Film Contests & Digital Media Labs",
    category: "non-technical",
    coordinates: { x: 27.5, y: 65.5 },
    capacity: "800+ Students",
    description: "Multi-storey academic block with red-brick accents. Dedicated 6th-floor studios host Open Mic, The Opinion Exchange, Visual Storytelling Challenge, and LAN gaming tournaments.",
    facilities: ["6th Floor Studio Theater", "Digital Media Suite", "LAN Tournament Stage", "1 Gbps Dedicated Fiber"],
    accentColor: "cyan",
    glowColor: "rgba(6, 182, 212, 0.45)",
    pinBadge: "BLOCK 3 // STUDIOS",
  },
  {
    id: "block-4",
    name: "Block 4 — Main Academic & Convention Block",
    shortName: "Block 4 (Convention)",
    buildingCode: "B-04",
    tagline: "Convention Hall, Sur Sagar, Gully War & Talent Showcase",
    category: "cultural",
    coordinates: { x: 45.0, y: 72.5 },
    capacity: "1,500+ Seated",
    description: "The grand frontage architectural pavilion of CGC Jhanjeri. Equipped with a high-capacity Convention Hall hosting Sur Sagar, Gully War, and Saviskar Got Talent.",
    facilities: ["Convention Hall Stage", "Concert Line-Array PA", "VIP Reception Suite", "High-Resolution Display Wall"],
    accentColor: "violet",
    glowColor: "rgba(168, 85, 247, 0.5)",
    pinBadge: "BLOCK 4 // CONVENTION",
  },
  {
    id: "block-5",
    name: "Block 5 — Innovation Center & Seminar Halls",
    shortName: "Block 5",
    buildingCode: "B-05",
    tagline: "Corporate Conclaves, The Case Mystique & Management",
    category: "non-technical",
    coordinates: { x: 59.0, y: 63.5 },
    capacity: "1,000+ Visitors",
    description: "Modern business and management hub featuring tiered seminar halls. Home to The Case Mystique, corporate case-study presentations, and venture pitch panels.",
    facilities: ["Tiered Seminar Hall", "Venture Pitch Stage", "Corporate Boardrooms", "Interactive Audio-Visual System"],
    accentColor: "violet",
    glowColor: "rgba(139, 92, 246, 0.45)",
    pinBadge: "BLOCK 5 // SEMINAR",
  },
  {
    id: "block-6",
    name: "Block 6 — Advanced Computing Labs (401/501)",
    shortName: "Block 6 Labs",
    buildingCode: "B-06",
    tagline: "Code Circuit, Web-Dev Sprint & IT Computer Centers",
    category: "technical",
    coordinates: { x: 70.0, y: 53.5 },
    capacity: "600+ Workstations",
    description: "Comprehensive computing infrastructure housing Lab 401, Lab 404, Lab 501, and Lab 504. Hosts Code Circuit, Web-Dev Sprint, AI challenges, and 24-hour hackathon coding tracks.",
    facilities: ["Labs 401 & 404 (High-Spec PCs)", "Labs 501 & 504 (Full-Stack Dev)", "Dedicated Cloud Server Access", "24/7 Hacker Lounge"],
    accentColor: "cyan",
    glowColor: "rgba(6, 182, 212, 0.45)",
    pinBadge: "BLOCK 6 // LABS",
  },
  {
    id: "block-7",
    name: "Block 7 — Research Towers & Moot Court",
    shortName: "Block 7 (Research)",
    buildingCode: "B-07",
    tagline: "Research Towers, Moot Court, Ad-Mad & Brand Battle",
    category: "technical",
    coordinates: { x: 71.0, y: 22.0 },
    capacity: "600+ Delegates",
    description: "Advanced multi-storey academic and research tower. Features dedicated Moot Court chambers, medical diagnostic research labs, and seminar halls hosting Ad-Mad Show and Brand Battle.",
    facilities: ["Official Moot Court Chamber", "Seminar Hall", "Medical Diagnostic Labs", "Research Presentation Screens"],
    accentColor: "emerald",
    glowColor: "rgba(16, 185, 129, 0.45)",
    pinBadge: "BLOCK 7 // RESEARCH",
  },
  {
    id: "rosewood-hall",
    name: "Rosewood Hall (Girls Hostel)",
    shortName: "Rosewood Hall",
    buildingCode: "ROSEWOOD",
    tagline: "Campus Student Commons & Residential Complex",
    category: "general",
    coordinates: { x: 67.5, y: 34.0 },
    capacity: "1,000+ Residents",
    description: "Prominent residential hostel located between Block 1 and Block 7. Features tranquil student commons, landscaped courtyards, and campus residence facilities.",
    facilities: ["Hostel Reception", "Green Courtyards", "Student Reading Lounge", "First-Aid Response Point"],
    accentColor: "amber",
    glowColor: "rgba(245, 158, 11, 0.4)",
    pinBadge: "ROSEWOOD // RESIDENCE",
  },
  {
    id: "concert-arena",
    name: "Concert Arena & Festival Grounds",
    shortName: "Concert Arena",
    buildingCode: "ARENA",
    tagline: "Star Nights, Live Headliners & Clash of Chords",
    category: "starnight",
    coordinates: { x: 42.0, y: 19.5 },
    capacity: "35,000+ Spectators",
    description: "Colossal open-air festival ground situated directly behind Block 2 and Ivory Hall. Host to electrifying midnight Star Night concerts, Clash of Chords band battles, and massive festival crowds.",
    facilities: ["Main Festival Concert Stage", "Meyer Sound Line-Array Towers", "Laser & Pyrotechnic Rigging", "VIP Delegate Enclosure"],
    accentColor: "fuchsia",
    glowColor: "rgba(217, 70, 239, 0.5)",
    pinBadge: "CONCERT ARENA // STAR NIGHT",
  },
  {
    id: "central-lawn",
    name: "Central Promenade & Amphitheatre (OAT)",
    shortName: "Central Lawn (OAT)",
    buildingCode: "OAT",
    tagline: "Open Air Theater, Street Natak & Live Art Corridors",
    category: "cultural",
    coordinates: { x: 37.0, y: 52.0 },
    capacity: "3,500+ Attendees",
    description: "The vibrant green heart of campus surrounded by fountains and landscaped gardens. Centerstage for street theatre (Nukkad Natak), Canvas Art, Doodle Art, Face Painting, and Chill N Grill.",
    facilities: ["360° Amphitheatre Seating", "Paved Street Natak Arena", "Illuminated Fountain Plaza", "Fine Arts Canvas Corridor"],
    accentColor: "emerald",
    glowColor: "rgba(16, 185, 129, 0.45)",
    pinBadge: "OAT // STREET PLAY",
  },
  {
    id: "transit-hub",
    name: "Main Entrance & Arrival Hub",
    shortName: "Arrival Hub",
    buildingCode: "GATE-01",
    tagline: "Fast-Track Entry, QR Passes & Helpdesk",
    category: "general",
    coordinates: { x: 21.5, y: 89.0 },
    capacity: "10,000+ Daily Footfall",
    description: "The official gate of entry for all participating university teams. Features automated QR digital pass scanning, wristband exchange desks, bus transit pickups, and tourist assistance.",
    facilities: ["Automated Turnstile QR Gates", "Helpdesk & Baggage Cloakroom", "Inter-State Bus Shuttle Terminal", "Ambulance & Security Command Post"],
    accentColor: "cyan",
    glowColor: "rgba(6, 182, 212, 0.4)",
    pinBadge: "ARRIVAL // CHECK-IN",
  },
];

// ============================================================================
// CURATED FESTIVAL EVENTS SCHEDULE (Days 1 & 2 across All Campus Venues)
// ============================================================================
export const FESTIVAL_SCHEDULE: ScheduleEvent[] = [
  // ── DAY 1: 28 OCTOBER 2026 ──────────────────────────────────────────────
  {
    id: "sch-01",
    slug: "grand-inauguration",
    name: "Aevorian Reverie: Grand Inauguration Ceremony",
    category: "cultural",
    venueId: "block-2",
    venueName: "Block 2 — Main Auditorium",
    room: "Main Auditorium Hall",
    day: 1,
    date: "2026-10-28",
    startTime: "09:30 AM",
    endTime: "11:00 AM",
    timeSlot: "Morning",
    description: "The ceremonial commencement of Saviskar 2026 with lighting of the lamp by Chancellor Mr. Rashpal Singh Dhaliwal, patron addresses, classical invocations, and unveiling of the Aevorian trophy.",
    registrationOpen: true,
    featured: true,
  },
  {
    id: "sch-02",
    slug: "hackathon-kickoff",
    name: "CodePulse 24-Hour National Hackathon",
    category: "technical",
    venueId: "block-6",
    venueName: "Block 6 — Computer Labs (401 & 501)",
    room: "High Performance Computing Lab 401 & 404",
    day: 1,
    date: "2026-10-28",
    startTime: "11:30 AM",
    endTime: "11:30 AM (Day 2)",
    timeSlot: "Morning",
    description: "24-hour non-stop code marathon tackling national problem statements in AI agents, Web3, FinTech, and healthcare robotics. ₹1,50,000 cash pool + angel grants.",
    prizePool: "₹1,50,000",
    registrationOpen: true,
    featured: true,
  },
  {
    id: "sch-03",
    slug: "aivishkar-expo-open",
    name: "AIvishkar: National AI & Robotics Expo (Day 1 Showcase)",
    category: "technical",
    venueId: "block-5",
    venueName: "Block 5 — Innovation Center & Seminar Halls",
    room: "Exhibition Concourse",
    day: 1,
    date: "2026-10-28",
    startTime: "11:30 AM",
    endTime: "05:00 PM",
    timeSlot: "Afternoon",
    description: "Interactive showcases of generative AI hardware, self-navigating rovers, LLM agents, and deep tech prototypes by engineering teams from 11 states.",
    prizePool: "₹5,00,000 in Grants",
    registrationOpen: true,
    featured: true,
  },
  {
    id: "sch-04",
    slug: "nukkad-natak-clash",
    name: "Bolti Deewarein — Street Theatre (Nukkad Natak)",
    category: "cultural",
    venueId: "central-lawn",
    venueName: "Central Promenade & Amphitheatre (OAT)",
    room: "Central Fountain Stage",
    day: 1,
    date: "2026-10-28",
    startTime: "12:00 PM",
    endTime: "03:30 PM",
    timeSlot: "Afternoon",
    description: "Raw, rhythmic, and high-decibel street theatre performances addressing pressing social paradigms. Judged by distinguished theatre artists.",
    prizePool: "₹60,000",
    registrationOpen: true,
  },
  {
    id: "sch-05",
    slug: "valorant-championship",
    name: "Saviskar E-Clash: Valorant 5v5 Championship",
    category: "non-technical",
    venueId: "block-3",
    venueName: "Block 3 — Media, E-Sports & 6th Floor Studios",
    room: "LAN Arena Room 104",
    day: 1,
    date: "2026-10-28",
    startTime: "12:30 PM",
    endTime: "06:00 PM",
    timeSlot: "Afternoon",
    description: "High-stakes double elimination tactical shooter tournament on 240Hz monitors with live caster commentary on campus projection screens.",
    prizePool: "₹50,000",
    registrationOpen: true,
  },
  {
    id: "sch-06",
    slug: "battle-of-bands-prelims",
    name: "Symphony of Chaos — Battle of the Bands (Prelims)",
    category: "cultural",
    venueId: "block-2",
    venueName: "Block 2 — Main Auditorium",
    room: "Main Auditorium Hall",
    day: 1,
    date: "2026-10-28",
    startTime: "02:00 PM",
    endTime: "06:30 PM",
    timeSlot: "Afternoon",
    description: "Collegiate rock, indie, and fusion bands duel on the concert soundstage. Top 4 teams qualify for the Day 2 Grand Finale.",
    prizePool: "₹1,00,000",
    registrationOpen: true,
  },
  {
    id: "sch-07",
    slug: "national-quiz-open",
    name: "The Chakravyuh — National General Quiz",
    category: "non-technical",
    venueId: "block-7",
    venueName: "Block 7 — Research Towers & Moot Court",
    room: "Seminar Hall",
    day: 1,
    date: "2026-10-28",
    startTime: "02:30 PM",
    endTime: "05:00 PM",
    timeSlot: "Afternoon",
    description: "Battle of intellects spanning geopolitics, pop culture, sci-fi lore, and Indian history conducted by prominent quizmasters.",
    prizePool: "₹40,000",
    registrationOpen: true,
  },
  {
    id: "sch-08",
    slug: "roborace-heat-1",
    name: "Nitro Circuit — High-Speed RoboRace",
    category: "technical",
    venueId: "block-2",
    venueName: "Block 2 — Arena Track",
    room: "Arena Block 2 Track",
    day: 1,
    date: "2026-10-28",
    startTime: "03:00 PM",
    endTime: "06:00 PM",
    timeSlot: "Afternoon",
    description: "Custom-built RC rovers race through oil slicks, gravel, hairpin ramps, and bridge hazards in a timed multi-lap circuit.",
    prizePool: "₹50,000",
    registrationOpen: true,
  },
  {
    id: "sch-09",
    slug: "starnight-day-1",
    name: "Star Night (Day 1) — Sufi & Indie Fusion Concert",
    category: "cultural",
    venueId: "concert-arena",
    venueName: "Concert Arena & Festival Grounds",
    room: "Main Concert Arena",
    day: 1,
    date: "2026-10-28",
    startTime: "07:30 PM",
    endTime: "11:00 PM",
    timeSlot: "Night",
    description: "Stadium-shaking headline concert under the Mohali night sky featuring top-tier headlining artists, laser shows, and 35,000+ student voices.",
    registrationOpen: true,
    featured: true,
  },

  // ── DAY 2: 29 OCTOBER 2026 ──────────────────────────────────────────────
  {
    id: "sch-10",
    slug: "hackathon-judgment",
    name: "CodePulse 24h Hackathon Finale & Jury Pitch",
    category: "technical",
    venueId: "block-6",
    venueName: "Block 6 — Computer Labs (401 & 501)",
    room: "Computing Hub Lab 501",
    day: 2,
    date: "2026-10-29",
    startTime: "11:30 AM",
    endTime: "02:00 PM",
    timeSlot: "Morning",
    description: "Surviving teams demonstrate functional MVPs to industry engineering leaders from Google, Microsoft, and leading Indian tech unicorns.",
    prizePool: "₹1,50,000",
    registrationOpen: false,
  },
  {
    id: "sch-11",
    slug: "robowars-clash",
    name: "Metal Mayhem — Combat RoboWars (15kg & 30kg Category)",
    category: "technical",
    venueId: "block-2",
    venueName: "Block 2 — Combat Arena",
    room: "Heavy Armor Arena Cage",
    day: 2,
    date: "2026-10-29",
    startTime: "10:30 AM",
    endTime: "03:30 PM",
    timeSlot: "Morning",
    description: "Tough battle bots equipped with spinning drum blades, pneumatic flippers, and wedge chassis duel in a bulletproof polycarbonate arena.",
    prizePool: "₹1,20,000",
    registrationOpen: true,
    featured: true,
  },
  {
    id: "sch-12",
    slug: "choreonite-dance",
    name: "Footloose — Western & Thematic Group Dance Showcase",
    category: "cultural",
    venueId: "block-2",
    venueName: "Block 2 — Main Auditorium",
    room: "Main Auditorium Hall",
    day: 2,
    date: "2026-10-29",
    startTime: "11:00 AM",
    endTime: "03:00 PM",
    timeSlot: "Morning",
    description: "Synchronized hip-hop, contemporary, and theatrical western dance routines competing under concert-calibrated dynamic lighting.",
    prizePool: "₹80,000",
    registrationOpen: true,
  },
  {
    id: "sch-13",
    slug: "venture-pitch-deck",
    name: "Founders Arena — Angel Pitch & Venture Conclave",
    category: "technical",
    venueId: "block-1",
    venueName: "Block 1 — Academic Complex & Executive Conclave",
    room: "Executive Syndicate Hall",
    day: 2,
    date: "2026-10-29",
    startTime: "12:00 PM",
    endTime: "03:30 PM",
    timeSlot: "Afternoon",
    description: "Student tech innovators pitch functional startups to venture capitalists and startup accelerators for direct investment and mentoring.",
    prizePool: "₹2,50,000 Seed Grants",
    registrationOpen: true,
  },
  {
    id: "sch-14",
    slug: "fashion-vista",
    name: "Aevorian Vogue — The National Fashion Runway",
    category: "cultural",
    venueId: "block-4",
    venueName: "Block 4 — Main Academic & Convention Block",
    room: "Convention Hall Stage",
    day: 2,
    date: "2026-10-29",
    startTime: "03:30 PM",
    endTime: "06:00 PM",
    timeSlot: "Afternoon",
    description: "High-concept couture runway competition celebrating avant-garde aesthetics, sustainable garments, and runway choreography.",
    prizePool: "₹1,00,000",
    registrationOpen: true,
    featured: true,
  },
  {
    id: "sch-15",
    slug: "futsal-grand-finale",
    name: "Saviskar Champions Cup — Inter-College Futsal Finale",
    category: "sports",
    venueId: "concert-arena",
    venueName: "Concert Arena & Festival Grounds",
    room: "All-Weather Turf Ground",
    day: 2,
    date: "2026-10-29",
    startTime: "03:00 PM",
    endTime: "05:30 PM",
    timeSlot: "Afternoon",
    description: "Fast-paced 5v5 floodlit futsal championship match determining North India's collegiate champions.",
    prizePool: "₹50,000",
    registrationOpen: true,
  },
  {
    id: "sch-16",
    slug: "starnight-grand-finale",
    name: "The Grand Finale Star Night & Valedictory Gala",
    category: "cultural",
    venueId: "concert-arena",
    venueName: "Concert Arena & Festival Grounds",
    room: "Main Festival Concert Arena",
    day: 2,
    date: "2026-10-29",
    startTime: "07:00 PM",
    endTime: "11:30 PM",
    timeSlot: "Night",
    description: "The supreme festival climax of Saviskar 2026! Valedictory trophy presentations followed by the national headliner concert and stadium laser celebration.",
    registrationOpen: true,
    featured: true,
  },
];

// ============================================================================
// VENUE RESOLUTION & DATABASE EVENT SYNCHRONIZATION HELPERS
// ============================================================================

/**
 * Deterministically resolves arbitrary database venue strings and event names
 * to one of the 12 canonical campus venue IDs.
 */
export function resolveVenueId(
  venueStr: string | null | undefined,
  eventName?: string | null,
  category?: string | null
): string {
  const v = (venueStr || "").toLowerCase().trim();
  const n = (eventName || "").toLowerCase().trim();
  const c = (category || "").toLowerCase().trim();

  // 1. Direct venue string matching
  if (v.includes("block 1") || v.includes("block-1") || v.includes("b-01") || v.includes("b1")) return "block-1";
  if (v.includes("block 2") || v.includes("block-2") || v.includes("b-02") || v.includes("b2") || v.includes("auditorium")) return "block-2";
  if (v.includes("block 3") || v.includes("block-3") || v.includes("b-03") || v.includes("b3")) return "block-3";
  if (v.includes("block 4") || v.includes("block-4") || v.includes("b-04") || v.includes("b4") || v.includes("convention")) return "block-4";
  if (v.includes("block 5") || v.includes("block-5") || v.includes("b-05") || v.includes("b5")) return "block-5";
  if (v.includes("block 6") || v.includes("block-6") || v.includes("b-06") || v.includes("b6") || v.includes("lab")) return "block-6";
  if (v.includes("block 7") || v.includes("block-7") || v.includes("b-07") || v.includes("b7") || v.includes("research") || v.includes("mooc")) return "block-7";
  if (v.includes("ivory")) return "ivory-hall";
  if (v.includes("rosewood")) return "rosewood-hall";
  if (v.includes("applebee") || v.includes("stadium") || v.includes("arena") || v.includes("concert")) return "concert-arena";
  if (v.includes("oat") || v.includes("lawn") || v.includes("promenade") || v.includes("amphitheatre")) return "central-lawn";
  if (v.includes("gate") || v.includes("transit") || v.includes("arrival")) return "transit-hub";

  // 2. Legacy venue ID aliases
  if (v === "block-1-admin") return "block-1";
  if (v === "block-2-tech") return "block-2";
  if (v === "block-3-esports") return "block-3";
  if (v === "block-4-auditorium") return "block-4";
  if (v === "block-5-aivishkar") return "block-5";
  if (v === "block-6-humanities") return "block-6";
  if (v === "concert-stadium") return "concert-arena";
  if (v === "research-towers") return "block-7";

  // 3. Fallback inference by event name
  if (n.includes("nukkad") || n.includes("street") || n.includes("canvas") || n.includes("doodle") || n.includes("painting") || n.includes("grill")) {
    return "central-lawn";
  }
  if (n.includes("hack") || n.includes("web") || n.includes("code") || n.includes("circuit") || n.includes("bug")) {
    return "block-6";
  }
  if (n.includes("vlog") || n.includes("reel") || n.includes("film") || n.includes("photo") || n.includes("mic") || n.includes("opinion")) {
    return "block-3";
  }
  if (n.includes("sagar") || n.includes("talent") || n.includes("gully")) {
    return "block-4";
  }
  if (n.includes("dance") || n.includes("western") || n.includes("nachda") || n.includes("saviskar") || n.includes("bharat")) {
    return "block-2";
  }
  if (n.includes("manager") || n.includes("mun") || n.includes("quiz") || n.includes("business")) {
    return "block-1";
  }
  if (n.includes("case") || n.includes("mystique")) {
    return "block-5";
  }
  if (n.includes("clash") || n.includes("chord") || n.includes("star") || n.includes("night") || n.includes("futsal")) {
    return "concert-arena";
  }
  if (
    n.includes("prayog") ||
    n.includes("labx") ||
    n.includes("crime") ||
    n.includes("diagnostic") ||
    n.includes("eye") ||
    n.includes("airway") ||
    n.includes("posture") ||
    n.includes("ad-mad") ||
    n.includes("brand")
  ) {
    return "block-7";
  }
  if (n.includes("robo") || n.includes("thrust") || n.includes("formula") || n.includes("techxhibit")) {
    return "block-2";
  }

  // 4. Fallback by broad category
  if (c === "technical") return "block-6";
  if (c === "cultural") return "block-2";
  return "block-1";
}

/**
 * Format raw database time (e.g. "12:00:00" or "03:02:00") into user-friendly "12:00 PM".
 */
export function formatDatabaseTime(timeStr: string | null | undefined, fallback = "10:00 AM"): string {
  if (!timeStr) return fallback;
  if (timeStr.includes("AM") || timeStr.includes("PM")) return timeStr;

  const parts = timeStr.split(":");
  if (parts.length >= 2) {
    let hour = parseInt(parts[0], 10);
    const minute = parts[1];
    if (!isNaN(hour)) {
      // Fest competitions between 1:00 and 7:00 are PM (afternoon/evening), not 3:00 AM
      const isPm = hour >= 12 || (hour >= 1 && hour <= 7);
      const ampm = isPm ? "PM" : "AM";
      const displayHour = hour % 12 || 12;
      return `${displayHour.toString().padStart(2, "0")}:${minute} ${ampm}`;
    }
  }
  return fallback;
}

/**
 * Maps a raw backend Supabase event record into a rich ScheduleEvent for ThomsoReplicaMap and ScheduleTimeline.
 */
export function mapDbEventToScheduleEvent(
  dbEvent: {
    id: string;
    slug: string;
    name: string;
    category: string | null;
    description: string | null;
    event_date: string | null;
    start_time: string | null;
    venue: string | null;
    active: boolean;
    registration_open: boolean;
  }
): ScheduleEvent {
  const venueId = resolveVenueId(dbEvent.venue, dbEvent.name, dbEvent.category);
  const matchedVenue = CAMPUS_VENUES.find((v) => v.id === venueId);

  // Time & slot computation
  let startTime = "10:00 AM";
  let endTime = "01:00 PM";
  let timeSlot = "Morning";

  if (dbEvent.start_time) {
    startTime = formatDatabaseTime(dbEvent.start_time, "10:00 AM");
    const parts = dbEvent.start_time.split(":");
    if (parts.length >= 2) {
      let hour = parseInt(parts[0], 10);
      const min = parts[1];
      if (!isNaN(hour)) {
        if (hour >= 1 && hour <= 7) hour += 12; // Normalize 3 PM -> 15:00

        if (hour < 12) timeSlot = "Morning";
        else if (hour < 17) timeSlot = "Afternoon";
        else if (hour < 21) timeSlot = "Evening";
        else timeSlot = "Night";

        const endHour = (hour + 2) % 24;
        const endAmpm = endHour >= 12 ? "PM" : "AM";
        const endDisplayHour = endHour % 12 || 12;
        endTime = `${endDisplayHour.toString().padStart(2, "0")}:${min} ${endAmpm}`;
      }
    }
  }

  // Normalize category
  let cat: "technical" | "cultural" | "sports" | "non-technical" = "technical";
  const rawCat = (dbEvent.category || "").toLowerCase();
  if (rawCat.includes("cult")) cat = "cultural";
  else if (rawCat.includes("sport")) cat = "sports";
  else if (rawCat.includes("non")) cat = "non-technical";
  else if (rawCat.includes("tech")) cat = "technical";

  const isDay2 = dbEvent.event_date === "2026-10-29";

  // Check if static schedule has prize pool info for this event
  const staticMatch = FESTIVAL_SCHEDULE.find(
    (s) => s.slug === dbEvent.slug || s.name.toLowerCase() === dbEvent.name.toLowerCase()
  );

  return {
    id: dbEvent.id,
    slug: dbEvent.slug,
    name: dbEvent.name,
    category: cat,
    venueId,
    venueName: dbEvent.venue && dbEvent.venue !== "TBD" ? dbEvent.venue : (matchedVenue?.name || "CGC Campus"),
    room: dbEvent.venue && dbEvent.venue !== "TBD" ? dbEvent.venue : matchedVenue?.shortName,
    day: isDay2 ? 2 : 1,
    date: dbEvent.event_date || (isDay2 ? "2026-10-29" : "2026-10-28"),
    startTime,
    endTime,
    timeSlot,
    description: dbEvent.description && dbEvent.description !== "1234"
      ? dbEvent.description
      : (staticMatch?.description || `${dbEvent.name} — Official Saviskar 2026 Competition at CGC University Mohali.`),
    prizePool: staticMatch?.prizePool,
    registrationOpen: dbEvent.registration_open ?? true,
    featured: staticMatch?.featured ?? false,
  };
}
