export interface FacultyMember {
  id: string;
  name: string;
  designation: string;
  department: string;
  tier: "tier1" | "tier2";
  image?: string;
  bio?: string;
  quote?: string;
  honorific?: string;
  badges: string[];
}

export interface SacMember {
  id: string;
  name: string;
  role: string;
  wing:
    | "Office Bearers"
    | "Core Committee"
    | "Technical & AI"
    | "Cultural & Stage"
    | "Media & PR"
    | "Logistics & Hospitality"
    | "Creative & Design"
    | "Corporate & Sponsorship"
    | "Overall"
    | "Bills & Budget"
    | "Website"
    | "Branding"
    | "Creativity"
    | "Sponsorship"
    | "Calling Team";
  tier: "office_bearer" | "core" | "council";
  department: string;
  year?: string;
  image?: string;
  avatarVariant?: "male" | "female";
  initials?: string;
  memberType?: "lead" | "core" | "member" | "office_bearer";
  personDetail?: string;
  isSpotlightLead?: boolean;
}

export interface QuoteByte {
  tierLabel: string;
  quote: string;
  attribution: string;
  designation: string;
}

export interface EditorialSpreadData {
  titleBadge: string;
  deskTitle: string;
  dropCap: string;
  paragraphs: string[];
  signeeName: string;
  signeeRole: string;
  initials?: string;
  image?: string;
  accent: "amber" | "cyan" | "violet" | "emerald";
  secondarySignees?: { name: string; role: string; initials?: string }[];
}

export interface StateHeadEntry {
  region: string;
  heads: string;
}

// ==========================================
// CANVA EDITORIAL SPREAD MANIFESTOS (100% SAVISKAR THEMED)
// ==========================================
export const EDITORIAL_DIRECTOR: EditorialSpreadData = {
  titleBadge: "CHIEF PATRON MANIFESTO",
  deskTitle: "DIRECTOR — STUDENT AFFAIRS",
  dropCap: "S",
  paragraphs: [
    "Saviskar 2026 is a celebration of fearless imagination, youthful tenacity, and intellectual wonder. When 35,000+ passionate students converge at CGC University, Mohali, tomorrow begins to exist.",
    "Aevorian Reverie is not merely a date on our academic calendar—it is a proving ground where bold concepts transform into living realities. Across technical arenas, research hackathons, and stadium-scale cultural showcases, our students demonstrate that youth is not just preparing for the future; they are actively architecting it.",
    "To every competitor, visionary, and guest stepping onto our campus: immerse yourselves completely. Let curiosity guide your inquiries, let passion fuel your performances, and let the camaraderie forged here endure for a lifetime.",
    "I applaud our Student Advisory Council (SAC) and fest leadership whose tireless devotion elevates Saviskar into an unforgettable national benchmark.",
  ],
  signeeName: "Mrs. Bismin Dhaliwal",
  signeeRole: "Director Students Affairs // Chief Patron, Saviskar 2026",
  initials: "BD",
  image: "/images/faculty/bismin-dhaliwal.webp",
  accent: "amber",
};

export const EDITORIAL_DEAN: EditorialSpreadData = {
  titleBadge: "OPERATIONS & CULTURAL PATRON",
  deskTitle: "DEAN — STUDENT AFFAIRS",
  dropCap: "F",
  paragraphs: [
    "From grand illuminated arena stages to seamless campus logistics, our mission is to craft an electrifying, world-class festival experience that sets a gold standard for university techno-cultural fests nationwide.",
    "Saviskar 2026 operates on precision, safety, and boundless artistic ambition. Our campus transforms into a multi-realm ecosystem where cutting-edge artificial intelligence symposiums harmonize with high-energy theatrical and musical showcases.",
    "Behind every spotlight, smooth registration queue, and roaring crowd stands an army of student builders and faculty mentors working around the clock. Their relentless spirit is the heartbeat of this festival.",
    "My warmest congratulations to the entire organizing cadre. Together, let us make Saviskar 2026 an extraordinary memory for all.",
  ],
  signeeName: "Dr. Sachin Sharma",
  signeeRole: "Dean Student Affairs & Patron, Saviskar 2026",
  initials: "SS",
  image: "/images/faculty/sachin-sharma.webp",
  accent: "cyan",
};

export const EDITORIAL_PRESIDENCY: EditorialSpreadData = {
  titleBadge: "STUDENT EXECUTIVE COMMAND",
  deskTitle: "STUDENT ADVISORY COUNCIL PRESIDENCY",
  dropCap: "W",
  paragraphs: [
    "We are the student architects of Aevorian Reverie. What began months ago as whiteboard brainstorms and midnight design iterations has evolved into Northern India's most ambitious student-led celebration.",
    "Saviskar 2026 is built by students, for students. From coordinating national contingents across 11 states to engineering responsive digital platforms and sculpting immersive stage sets, this festival reflects our collective determination and limitless creativity.",
    "Step into the arena, celebrate fearlessly, and welcome to our university and our shared dream: Saviskar 2026.",
  ],
  signeeName: "Lakshita & Aadit Bhardwaj",
  signeeRole: "President & Vice President // Student Advisory Council (SAC)",
  initials: "LK",
  image: "/images/SAC/SAC-26-27.png",
  accent: "violet",
  secondarySignees: [
    { name: "Lakshita", role: "President, Student Advisory Council (SAC)", initials: "LK" },
    { name: "Aadit Bhardwaj", role: "Vice President, Student Advisory Council (SAC)", initials: "AB" },
    { name: "Samarth Kumar", role: "Overall Head", initials: "SK" },
  ],
};

export const TIER_1_BYTE: QuoteByte = {
  tierLabel: "EXECUTIVE PATRON BYTE",
  quote:
    "Saviskar 2026 is a celebration of fearless imagination, youthful tenacity, and intellectual wonder. When 35,000+ passionate students converge at CGC University, Mohali, tomorrow begins to exist.",
  attribution: "Mrs. Bismin Dhaliwal",
  designation: "Director Students Affairs // Chief Patron, Saviskar 2026",
};

export const TIER_2_BYTE: QuoteByte = {
  tierLabel: "DEAN & CULTURAL DIRECTORATE OPERATIONS BYTE",
  quote:
    "From grand illuminated arena stages to seamless campus logistics, our mission is to craft an electrifying, world-class festival experience that sets a gold standard for university techno-cultural fests nationwide.",
  attribution: "Dr. Sachin Sharma & Cultural Directorate",
  designation: "Dean Student Affairs & Department of Arts, Culture & Fest Operations",
};

export const SAC_COLLECTIVE_BYTE: QuoteByte = {
  tierLabel: "STUDENT ADVISORY COUNCIL (SAC) COLLECTIVE MANIFESTO",
  quote:
    "From initial sketches to the roaring stadium crowd, we are the student builders, creators, and organizers of Aevorian Reverie. Welcome to our university, our festival, and an experience built by students, for students.",
  attribution: "Student Advisory Council (SAC)",
  designation: "Student Architects & Committee Leads // Saviskar 2026 Organizing Council",
};

// ==========================================
// TIER 1: APEX EXECUTIVE LEADERSHIP (BISMIN MAM)
// ==========================================
export const FACULTY_LEADERSHIP: FacultyMember[] = [
  {
    id: "dir-bismin-dhaliwal",
    name: "Mrs. Bismin Dhaliwal",
    honorific: "DIRECTOR STUDENTS AFFAIRS",
    designation: "Director Students Affairs",
    department: "Directorate of Student Affairs, CGC University",
    tier: "tier1",
    bio: "Chief Patron & Executive Director steering institutional vision, student leadership, and holistic university welfare across national platforms.",
    badges: ["Apex Leadership", "Patron-in-Chief", "Student Welfare", "CGC Directorate"],
    image: "/images/faculty/bismin-dhaliwal.webp",
  },
];

// ==========================================
// TIER 2: DEAN & CULTURAL DIRECTORATE (DR. SACHIN SHARMA & TEAM)
// ==========================================
export const FACULTY_DIRECTORATE: FacultyMember[] = [
  {
    id: "dean-sachin-sharma",
    name: "Dr. Sachin Sharma",
    honorific: "DEAN STUDENT AFFAIRS",
    designation: "Dean Student Affairs",
    department: "Department of Student Affairs, CGC University",
    tier: "tier2",
    bio: "Distinguished Academician and Dean supervising council governance, national youth engagement, and festival execution protocols.",
    badges: ["Dean Leadership", "Council Governance", "Academic Patron"],
    image: "/images/faculty/sachin-sharma.webp",
  },
  {
    id: "ad-vaibhav-kelay",
    name: "Mr. Vaibhav Kelay",
    honorific: "ASSISTANT DIRECTOR CULTURAL",
    designation: "Assistant Director Cultural",
    department: "Department of Cultural Affairs & Student Development",
    tier: "tier2",
    bio: "Head curator of cultural showcases, national fine arts competitions, and headline stadium concert production.",
    badges: ["Cultural Command", "Production Lead", "Stage Director"],
    image: "/images/faculty/vaibhav-kelay.webp",
  },
  {
    id: "mgr-monika-dhaliwal",
    name: "Mrs. Monika Dhaliwal",
    honorific: "SENIOR MANAGER DSA",
    designation: "Senior Manager DSA",
    department: "Department of Student Affairs, CGC University",
    tier: "tier2",
    bio: "Directing multi-genre artistic curation, theatrical productions, and national festival fine arts pavilions.",
    badges: ["Arts & Culture", "Curatorial Lead", "Creative Direction"],
    image: "/images/faculty/monika-dhaliwal.webp",
  },
  {
    id: "ops-anand-kumar",
    name: "Mr. Anand Kumar",
    honorific: "OPERATIONS COMMAND",
    designation: "Operations Command",
    department: "Festival Logistics & Infrastructure Management",
    tier: "tier2",
    bio: "Chief coordinator for arena infrastructure, technical staging, electrical grids, and security protocols.",
    badges: ["Operations Lead", "Arena Command", "Infrastructure"],
    image: "/images/faculty/anand-kumar.avif",
  },
  {
    id: "ops-aditya",
    name: "Mr. Aditya",
    honorific: "ANCHOR & YOUTH ENGAGEMENT",
    designation: "Anchor",
    department: "Student Engagement & Stage Protocol",
    tier: "tier2",
    bio: "Lead stage presenter, protocol anchor, and student delegate liaison across flagship festival events.",
    badges: ["Stage Anchor", "Youth Engagement", "Protocol"],
    image: "/images/faculty/aditya.webp",
  },
];

export const LEVEL_1_DIRECTOR = FACULTY_LEADERSHIP[0];
export const LEVEL_2_DEAN = FACULTY_DIRECTORATE[0];
export const LEVEL_3_CULTURAL_DIRECTORATE = [
  FACULTY_DIRECTORATE[1],
  FACULTY_DIRECTORATE[2],
];
export const LEVEL_4_OPERATIONS_COMMAND = [
  FACULTY_DIRECTORATE[3],
  FACULTY_DIRECTORATE[4],
];

// ==========================================
// TIER 3: SAC OFFICE BEARERS (PRESIDENT & VICE PRESIDENT)
// ==========================================
export const SAC_OFFICE_BEARERS: SacMember[] = [
  {
    id: "sac-ob-lakshita",
    name: "Lakshita",
    role: "President, Student Advisory Council (SAC)",
    wing: "Office Bearers",
    tier: "office_bearer",
    memberType: "office_bearer",
    personDetail: "President",
    department: "Student Advisory Council (SAC)",
    year: "Executive Head",
    initials: "LK",
    image: "/images/SAC/LAKSHITA.webp",
  },
  {
    id: "sac-ob-aadit-bhardwaj",
    name: "Aadit Bhardwaj",
    role: "Vice President, Student Advisory Council (SAC)",
    wing: "Office Bearers",
    tier: "office_bearer",
    memberType: "office_bearer",
    personDetail: "Vice President",
    department: "Student Advisory Council (SAC)",
    year: "Executive Head",
    initials: "AB",
    image: "/images/SAC/AADIT BHARDWAJ.webp",
  },
];

export const LEVEL_5_SAC_OFFICE_BEARERS = SAC_OFFICE_BEARERS;

// ==========================================
// TIER 4: SAC CORE MEMBERS (19 MEMBERS)
// ==========================================
export const SAC_CORE_LEADS: SacMember[] = [
  {
    id: "sac-core-abhay-vishwakarma",
    name: "Abhay Vishwakarma",
    role: "Core Member, Student Advisory Council (SAC)",
    wing: "Creativity",
    tier: "core",
    memberType: "lead",
    personDetail: "Team Lead",
    department: "Student Advisory Council (SAC)",
    initials: "AV",
    image: "/images/SAC/ABHAY.webp",
  },
  {
    id: "sac-core-anmol-agarwal",
    name: "Anmol Agarwal",
    role: "Core Member, Student Advisory Council (SAC)",
    wing: "Sponsorship",
    tier: "core",
    memberType: "lead",
    personDetail: "Team Lead",
    department: "Student Advisory Council (SAC)",
    initials: "AA",
    image: "/images/SAC/ANMOL AGARWAL.webp",
  },
  {
    id: "sac-core-avneet-kour",
    name: "Avneet Kour",
    role: "Core Member, Student Advisory Council (SAC)",
    wing: "Creativity",
    tier: "core",
    memberType: "core",
    personDetail: "Core Member",
    department: "Student Advisory Council (SAC)",
    initials: "AK",
    image: "/images/SAC/AVNEET KOUR.webp",
  },
  {
    id: "sac-core-ayush-choudhary",
    name: "Ayush Choudhary",
    role: "Core Member, Student Advisory Council (SAC)",
    wing: "Branding",
    tier: "core",
    memberType: "lead",
    personDetail: "Team Lead",
    department: "Student Advisory Council (SAC)",
    initials: "AC",
    image: "/images/SAC/AYUSH CHOUDHARY.webp",
  },
  {
    id: "sac-core-chahat",
    name: "Chahat",
    role: "Core Member, Student Advisory Council (SAC)",
    wing: "Creativity",
    tier: "core",
    memberType: "core",
    personDetail: "Core Member",
    department: "Student Advisory Council (SAC)",
    initials: "CH",
    image: "/images/SAC/CHAHAT.webp",
  },
  {
    id: "sac-core-dhruv-kumar",
    name: "Dhruv Kumar",
    role: "Core Member, Student Advisory Council (SAC)",
    wing: "Sponsorship",
    tier: "core",
    memberType: "lead",
    personDetail: "Team Lead",
    department: "Student Advisory Council (SAC)",
    initials: "DK",
    image: "/images/SAC/DHRUV KUMAR.webp",
  },
  {
    id: "sac-core-goutam-bajaj",
    name: "Goutam Bajaj",
    role: "Core Member, Student Advisory Council (SAC)",
    wing: "Calling Team",
    tier: "core",
    memberType: "core",
    personDetail: "Core Member",
    department: "Student Advisory Council (SAC)",
    initials: "GB",
    image: "/images/SAC/GOUTAM BAJAJ.webp",
  },
  {
    id: "sac-core-gurkeerat-singh",
    name: "Gurkeerat Singh",
    role: "Core Member, Student Advisory Council (SAC)",
    wing: "Creativity",
    tier: "core",
    memberType: "core",
    personDetail: "Core Member",
    department: "Student Advisory Council (SAC)",
    initials: "GS",
    image: "/images/SAC/GURKEERAT SINGH.webp",
  },
  {
    id: "sac-core-jashan-jot-singh",
    name: "Jashan Jot Singh",
    role: "Core Member, Student Advisory Council (SAC)",
    wing: "Website",
    tier: "core",
    memberType: "core",
    personDetail: "Core Member",
    department: "Student Advisory Council (SAC)",
    initials: "JJ",
    image: "/images/SAC/JASHAN JOT.webp",
  },
  {
    id: "sac-core-krishna-jaswal",
    name: "Krishna Jaswal",
    role: "Core Member, Student Advisory Council (SAC)",
    wing: "Branding",
    tier: "core",
    memberType: "core",
    personDetail: "Core Member",
    department: "Student Advisory Council (SAC)",
    initials: "KJ",
    image: "/images/SAC/KRISHNA JASWAL.webp",
  },
  {
    id: "sac-core-kush-dethliya",
    name: "Kush Dethliya",
    role: "Core Member, Student Advisory Council (SAC)",
    wing: "Bills & Budget",
    tier: "core",
    memberType: "core",
    personDetail: "Core Member",
    department: "Student Advisory Council (SAC)",
    initials: "KD",
    image: "/images/SAC/KUSH DETHLIYA.webp",
  },
  {
    id: "sac-core-nitin-kumar",
    name: "Nitin Kumar",
    role: "Core Member, Student Advisory Council (SAC)",
    wing: "Creativity",
    tier: "core",
    memberType: "lead",
    personDetail: "Team Lead",
    department: "Student Advisory Council (SAC)",
    initials: "NK",
    image: "/images/SAC/NITIN KUMAR.webp",
  },
  {
    id: "sac-core-prabneet-kaur",
    name: "Prabneet Kaur",
    role: "Core Member, Student Advisory Council (SAC)",
    wing: "Calling Team",
    tier: "core",
    memberType: "lead",
    personDetail: "Team Lead",
    department: "Student Advisory Council (SAC)",
    initials: "PK",
    image: "/images/SAC/PRABNEET KAUR.webp",
  },
  {
    id: "sac-core-prajval-kaur",
    name: "Prajval Kaur",
    role: "Core Member, Student Advisory Council (SAC)",
    wing: "Sponsorship",
    tier: "core",
    memberType: "lead",
    personDetail: "Team Lead",
    department: "Student Advisory Council (SAC)",
    initials: "PJ",
    image: "/images/SAC/PRAJVAL KAUR.webp",
  },
  {
    id: "sac-core-prince",
    name: "Prince",
    role: "Core Member, Student Advisory Council (SAC)",
    wing: "Calling Team",
    tier: "core",
    memberType: "core",
    personDetail: "Core Member",
    department: "Student Advisory Council (SAC)",
    initials: "PR",
    image: "/images/SAC/PRINCE.webp",
  },
  {
    id: "sac-core-saaransh-sharma",
    name: "Saaransh Sharma",
    role: "Core Member, Student Advisory Council (SAC)",
    wing: "Calling Team",
    tier: "core",
    memberType: "lead",
    personDetail: "Team Lead",
    department: "Student Advisory Council (SAC)",
    initials: "SS",
    image: "/images/SAC/SAARANSH SHARMA.webp",
  },
  {
    id: "sac-core-samarth-kumar",
    name: "Samarth Kumar",
    role: "Core Member, Student Advisory Council (SAC)",
    wing: "Overall",
    tier: "core",
    memberType: "core",
    personDetail: "Overall Head",
    department: "Student Advisory Council (SAC)",
    initials: "SK",
    image: "/images/SAC/SAMARTH KUMAR.webp",
  },
  {
    id: "sac-core-sukhdeep-singh",
    name: "Sukhdeep Singh",
    role: "Core Member, Student Advisory Council (SAC)",
    wing: "Branding",
    tier: "core",
    memberType: "lead",
    personDetail: "Team Lead",
    department: "Student Advisory Council (SAC)",
    initials: "SD",
    image: "/images/SAC/SUKHDEEP SINGH.webp",
  },
  {
    id: "sac-core-vinay-verma",
    name: "Vinay Verma",
    role: "Core Member, Student Advisory Council (SAC)",
    wing: "Creativity",
    tier: "core",
    memberType: "core",
    personDetail: "Core Member",
    department: "Student Advisory Council (SAC)",
    initials: "VV",
    image: "/images/SAC/VINAY VERMA.webp",
  },
];

// ==========================================
// TIER 5: SAC COUNCIL MEMBERS (32 MEMBERS)
// ==========================================
export const SAC_COUNCIL_MEMBERS: SacMember[] = [
  {
    id: "sac-mem-akshit-sharma",
    name: "Akshit Sharma",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Branding",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "AS",
    image: "/images/SAC/AKSHIT SHARMA.webp",
  },
  {
    id: "sac-mem-anmol",
    name: "Anmol Ratan",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Sponsorship",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "AR",
    image: "/images/SAC/ANMOL RATAN.webp",
  },
  {
    id: "sac-mem-ayush-raj",
    name: "Ayush Raj",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Sponsorship",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "AR",
    image: "/images/SAC/AYUSH RAJ.webp",
  },
  {
    id: "sac-mem-ayush-sharma",
    name: "Ayush Sharma",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Calling Team",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "AS",
    image: "/images/SAC/AYUSH SHARMA.webp",
  },
  {
    id: "sac-mem-ayushi-bhatia",
    name: "Ayushi Bhatia",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Calling Team",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "AB",
    image: "/images/SAC/AYUSHI BHATIA.webp",
  },
  {
    id: "sac-mem-deepak-kumar",
    name: "Deepak Kumar",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Calling Team",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "DK",
    image: "/images/SAC/DEEPAK KUMAR.webp",
  },
  {
    id: "sac-mem-ekta",
    name: "Ekta Kaushal",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Creativity",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "EK",
    image: "/images/SAC/EKTA KAUSHAL.webp",
  },
  {
    id: "sac-mem-gursimran-singh-sidhu",
    name: "Gursimran Singh Sidhu",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Branding",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "GS",
    image: "/images/SAC/GURSIMRAN.webp",
  },
  {
    id: "sac-mem-harshita",
    name: "Harshita",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Sponsorship",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "HR",
    image: "/images/SAC/HARSHITA.webp",
  },
  {
    id: "sac-mem-himesh-yadav",
    name: "Himesh Yadav",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Calling Team",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "HY",
    image: "/images/SAC/HIMESH YADAV.webp",
  },
  {
    id: "sac-mem-jatin-kumar",
    name: "Jatin Kumar",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Sponsorship",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "JK",
    image: "/images/SAC/JATIN KUMAR.webp",
  },
  {
    id: "sac-mem-krishna-malviya",
    name: "Krishna Malviya",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Branding",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "KM",
    image: "/images/SAC/KRISHNA MALVIYA.webp",
  },
  {
    id: "sac-mem-lakshay",
    name: "Lakshay",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Branding",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "LK",
    image: "/images/SAC/LAKSHAY.webp",
  },
  {
    id: "sac-mem-madhav-vashisht",
    name: "Madhav Vashisht",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Website",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "MV",
    image: "/images/SAC/MADHAV VASHISHT.webp",
    isSpotlightLead: false,
  },
  {
    id: "sac-mem-manjot",
    name: "Manjot Kaur",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Creativity",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "MJ",
    image: "/images/SAC/MANJOT KAUR.webp",
  },
  {
    id: "sac-mem-manraj-sharma",
    name: "Manraj Sharma",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Creativity",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "MS",
    image: "/images/SAC/MANRAJ SHARMA.webp",
  },
  {
    id: "sac-mem-megha",
    name: "Megha",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Creativity",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "MG",
    image: "/images/SAC/MEGHA.webp",
  },
  {
    id: "sac-mem-mehul-bhati",
    name: "Mehul Bhati",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Calling Team",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "MB",
    image: "/images/SAC/MEHUL BHATI.webp",
  },
  {
    id: "sac-mem-muskaan-kalia",
    name: "Muskaan Kalia",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Calling Team",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "MK",
    image: "/images/SAC/MUSKAAN KALIA.webp",
  },
  {
    id: "sac-mem-muskan",
    name: "Muskan",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Creativity",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "MK",
    image: "/images/SAC/MUSKAN.webp",
  },
  {
    id: "sac-mem-nikhil",
    name: "Nikhil Kumar",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Creativity",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "NK",
    image: "/images/SAC/NIKHIL KUMAR.webp",
  },
  {
    id: "sac-mem-prianshi",
    name: "Prianshi Katoch",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Calling Team",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "PR",
    image: "/images/SAC/PRIANSHI KATOCH.webp",
  },
  {
    id: "sac-mem-prikishit",
    name: "Prikishit",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Creativity",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "PK",
    image: "/images/SAC/PRIKSHIT.webp",
  },
  {
    id: "sac-mem-rohan-mishra",
    name: "Rohan Mishra",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Creativity",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "RM",
    image: "/images/SAC/ROHAN MISHRA.webp",
  },
  {
    id: "sac-mem-rohit-kumar",
    name: "Rohit Kumar",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Calling Team",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "RK",
    image: "/images/SAC/ROHIT KUMAR.webp",
  },
  {
    id: "sac-mem-shivani",
    name: "Shivani",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Creativity",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "SH",
    image: "/images/SAC/SHIVANI.webp",
  },
  {
    id: "sac-mem-sugandh",
    name: "Sugandh",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Calling Team",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "SG",
    image: "/images/SAC/SUGANDH.webp",
  },
  {
    id: "sac-mem-suraj-kumar",
    name: "Suraj Kumar",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Sponsorship",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "SK",
    image: "/images/SAC/SURAJ KUMAR.webp",
  },
  {
    id: "sac-mem-vani",
    name: "Vani",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Calling Team",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "VN",
    image: "/images/SAC/VANI.webp",
  },
  {
    id: "sac-mem-vishal",
    name: "Vishal Thakur",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Calling Team",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "VS",
    image: "/images/SAC/VISHAL THAKUR.webp",
  },
  {
    id: "sac-mem-yash-sharma",
    name: "Yash Sharma",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Branding",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "YS",
    image: "/images/SAC/YASH SHARMA.webp",
  },
  {
    id: "sac-mem-yuvraj",
    name: "Yuvraj Singh",
    role: "Council Member, Student Advisory Council (SAC)",
    wing: "Calling Team",
    tier: "council",
    memberType: "member",
    personDetail: "Member",
    department: "Student Advisory Council (SAC)",
    initials: "YV",
    image: "/images/SAC/YUVRAJ SINGH.webp",
  },
];

// All SAC members combined (Office Bearers + Core Members + Council Members)
export const ALL_SAC_MEMBERS: SacMember[] = [
  ...SAC_OFFICE_BEARERS,
  ...SAC_CORE_LEADS,
  ...SAC_COUNCIL_MEMBERS,
];

// ========================================================
// STRUCTURED OPERATIONAL TEAMS (IN USER REQUESTED SEQUENCE)
// 1. Overall Heads
// 2. Bills & Budget
// 3. Website
// 4. Branding
// 5. Creativity
// 6. Sponsorship Team
// 7. Calling Team (2 Heads + Core -> State Heads -> Members)
// ========================================================

// 1. OVERALL HEADS
export const OVERALL_HEADS: SacMember[] = [
  SAC_OFFICE_BEARERS[0], // Lakshita (President)
  SAC_OFFICE_BEARERS[1], // Aadit Bhardwaj (VP)
  SAC_CORE_LEADS.find((m) => m.id === "sac-core-samarth-kumar")!, // Samarth Kumar (Overall Head)
];

// 2. BILLS & BUDGET (No Leads)
export const BILLS_BUDGET_TEAM: SacMember[] = [
  SAC_CORE_LEADS.find((m) => m.id === "sac-core-kush-dethliya")!, // Kush Dethliya (Core Member)
];

// 3. WEBSITE TEAM (No direct lead badge, but Madhav Vashisht indirectly spotlighted as Lead Web Architect)
export const WEBSITE_TEAM: SacMember[] = [
  SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-madhav-vashisht")!, // Madhav Vashisht (#1, Lead Web Architect)
  SAC_CORE_LEADS.find((m) => m.id === "sac-core-jashan-jot-singh")!, // Jashan Jot Singh (Core Member)
];

// 4. BRANDING
export const BRANDING_TEAM = {
  leads: [
    SAC_CORE_LEADS.find((m) => m.id === "sac-core-ayush-choudhary")!,
    SAC_CORE_LEADS.find((m) => m.id === "sac-core-sukhdeep-singh")!,
  ],
  core: [
    SAC_CORE_LEADS.find((m) => m.id === "sac-core-krishna-jaswal")!,
  ],
  members: [
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-gursimran-singh-sidhu")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-krishna-malviya")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-akshit-sharma")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-yash-sharma")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-lakshay")!,
  ],
};

// 5. CREATIVITY
export const CREATIVITY_TEAM = {
  leads: [
    SAC_CORE_LEADS.find((m) => m.id === "sac-core-abhay-vishwakarma")!,
    SAC_CORE_LEADS.find((m) => m.id === "sac-core-nitin-kumar")!,
  ],
  core: [
    SAC_CORE_LEADS.find((m) => m.id === "sac-core-vinay-verma")!,
    SAC_CORE_LEADS.find((m) => m.id === "sac-core-gurkeerat-singh")!,
    SAC_CORE_LEADS.find((m) => m.id === "sac-core-chahat")!,
    SAC_CORE_LEADS.find((m) => m.id === "sac-core-avneet-kour")!,
  ],
  members: [
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-shivani")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-prikishit")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-manjot")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-rohan-mishra")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-manraj-sharma")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-muskan")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-ekta")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-megha")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-nikhil")!,
  ],
};

// 6. SPONSORSHIP TEAM
export const SPONSORSHIP_TEAM = {
  leads: [
    SAC_CORE_LEADS.find((m) => m.id === "sac-core-dhruv-kumar")!,
    SAC_CORE_LEADS.find((m) => m.id === "sac-core-anmol-agarwal")!,
    SAC_CORE_LEADS.find((m) => m.id === "sac-core-prajval-kaur")!,
  ],
  core: [] as SacMember[],
  members: [
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-ayush-raj")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-suraj-kumar")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-jatin-kumar")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-harshita")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-anmol")!,
  ],
};

// 7. CALLING TEAM (2 Heads + Core, State Directory, Calling Members)
export const CALLING_TEAM = {
  leads: [
    SAC_CORE_LEADS.find((m) => m.id === "sac-core-saaransh-sharma")!,
    SAC_CORE_LEADS.find((m) => m.id === "sac-core-prabneet-kaur")!,
  ],
  core: [
    SAC_CORE_LEADS.find((m) => m.id === "sac-core-goutam-bajaj")!,
    SAC_CORE_LEADS.find((m) => m.id === "sac-core-prince")!,
  ],
  members: [
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-himesh-yadav")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-muskaan-kalia")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-ayushi-bhatia")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-ayush-sharma")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-vishal")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-mehul-bhati")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-rohit-kumar")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-prianshi")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-sugandh")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-vani")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-deepak-kumar")!,
    SAC_COUNCIL_MEMBERS.find((m) => m.id === "sac-mem-yuvraj")!,
  ],
};

// State-wise allocation directory
export const STATE_HEADS_DIRECTORY: StateHeadEntry[] = [
  { region: "J&K", heads: "Yuvraj Singh" },
  { region: "Chandigarh + Tricity", heads: "Vishal Thakur" },
  { region: "Punjab", heads: "Deepak Kumar & Vani" },
  { region: "Haryana", heads: "Prince & Ayush Sharma" },
  { region: "Rajasthan", heads: "Mehul Bhati" },
  { region: "Delhi", heads: "Muskaan Kalia" },
  { region: "U.P", heads: "Sugandh" },
  { region: "UK (Uttarakhand)", heads: "Himesh Yadav" },
  { region: "Gujarat", heads: "Ayushi Bhatia" },
  { region: "Himachal Pradesh", heads: "Rohit Kumar & Prianshi Katoch" },
  { region: "General Calling", heads: "Goutam Bajaj" },
];

// Stats Summary
export const TEAM_STATS = {
  facultyTier1Count: FACULTY_LEADERSHIP.length,
  facultyTier2Count: FACULTY_DIRECTORATE.length,
  totalFacultyCount: FACULTY_LEADERSHIP.length + FACULTY_DIRECTORATE.length,
  sacOfficeBearersCount: SAC_OFFICE_BEARERS.length,
  sacCoreLeadsCount: SAC_CORE_LEADS.length,
  totalCoreTeamCount: SAC_OFFICE_BEARERS.length + SAC_CORE_LEADS.length,
  sacCouncilMembersCount: SAC_COUNCIL_MEMBERS.length,
  totalSacCount: ALL_SAC_MEMBERS.length,
  totalOrganisingTeamCount:
    FACULTY_LEADERSHIP.length +
    FACULTY_DIRECTORATE.length +
    ALL_SAC_MEMBERS.length,
};

