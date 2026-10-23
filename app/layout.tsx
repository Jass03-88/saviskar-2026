import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import SmoothScrollProvider from "@/components/providers/SmoothScrollProvider";
import "./globals.css";


export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
  preload: false,
  fallback: ["system-ui", "-apple-system", "sans-serif"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
  fallback: ["monospace"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
  preload: false,
  fallback: ["serif"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://saviskar.co.in"),
  applicationName: "Saviskar 2026 — CGC University Mohali",
  referrer: "origin-when-cross-origin",
  title: {
    default: "CGC University Mohali | Saviskar 2026 (Official CGC Fest) — Aevorian Reverie",
    template: "%s | CGC Saviskar 2026 — CGC University, Mohali",
  },
  description:
    "Official portal for Saviskar 2026: Aevorian Reverie — Where Tomorrow Dreams Awake. North India's flagship Annual National Techno-Cultural University Festival at CGC University, Mohali (CGC). 50+ Realms of Experience, 500+ Universities, 35,000+ Students, Endless Possibilities, Cash Prizes Upto ₹20 LACS, and Stadium Star Night Concerts. Two Days. Countless Stories. One Campus. Infinite Ways To Make Your Mark.",
  keywords: [
    // 1. Primary Fest Brands & Typo / Phonetic Search Variations
    "Saviskar 2026",
    "Saviskar",
    "Savishkar",
    "Savishkar 2026",
    "Sawiskar",
    "Sawishkar",
    "Saviskar '26",
    "Saviskar26",
    "Savishkar26",
    "Saviskar-26",
    "Saviskar Fest",
    "Savishkar Fest",
    "Saviskar co in",
    "www saviskar co in",

    // 2. CGC / University Dominance Queries (To Outrank the College Website)
    "CGC",
    "CGC University",
    "CGC Mohali",
    "CGC Landran",
    "CGC Jhanjeri",
    "Chandigarh Group of Colleges",
    "Chandigarh Group of Colleges Mohali",
    "Chandigarh Group of Colleges Landran",
    "CGC Chandigarh",
    "CGC Fest",
    "CGC Fest 2026",
    "CGC University Fest",
    "CGC Mohali Fest",
    "CGC Landran Fest",
    "CGC Jhanjeri Fest",
    "CGC Annual Fest",
    "CGC Tech Fest",
    "CGC Cultural Fest",
    "CGC Star Night",
    "CGC Hackathon",
    "CGC RoboWars",
    "CGC Events",
    "CGC Campus",
    "CGC Admissions Fest",
    "CGC Student Affairs",
    "CGC DSA",
    "CGC SAC",
    "CGC Saviskar",
    "Saviskar CGC",
    "CGC University Mohali Fest 2026",
    "CGC Official Portal",

    // 3. Theme Name, Etymology, Meaning & Phonetic Spelling Resiliency
    "Aevorian Reverie",
    "Aevorian Reviere",
    "Aevorian Revire",
    "Aevorian Revrie",
    "Aevorian Reveire",
    "Evorian Reverie",
    "Aeovorian Reverie",
    "Aevorian Reveri",
    "Aevorian Riviere",
    "Aevorian Reverie meaning",
    "Aevorian Reverie theme",
    "Aevorian Reverie etymology",
    "Where Tomorrow Dreams Awake",
    "A future imagined so vividly it begins to exist",
    "Two Days Countless Stories",
    "One Campus Infinite Ways To Make Your Mark",
    "Endless Possibilities",
    "500+ Universities",
    "35000 Students",
    "35,000+ Students",
    "Cash Prizes Upto 20 Lacs",
    "Ms Lakshita 8572815510",
    "Mr Saaransh Sharma 6239124013",
    "Saviskar theme meaning",
    "Saviskar etymology",
    "Srijan",
    "Avishkar",

    // 4. Nearby Areas, Local Tricity & Regional Proximity Clusters
    "Mohali",
    "SAS Nagar",
    "Sahibzada Ajit Singh Nagar",
    "Chandigarh",
    "The City Beautiful",
    "Panchkula",
    "Tricity",
    "Kharar",
    "Landran",
    "Sirhind Road",
    "State Highway 12A Punjab",
    "Punjab college fest",
    "Chandigarh college fest 2026",
    "Tricity college fests",
    "Mohali college fest 2026",
    "College fests near Chandigarh University CU",
    "College fests near Chitkara University",
    "College fests near Thapar University Patiala",
    "College fests near PEC Chandigarh",
    "College fests near Panjab University PU",
    "College fests near Rayat Bahra",
    "College fests near IIT Ropar",
    "Best college fest in Punjab",
    "Best university fest in North India",
    "North India biggest techno-cultural fest",
    "Engineering college fests North India",

    // 5. Individual Event Competitions & Realms (All 50+ Competitions)
    "RoboWars",
    "Combat RoboWars 15kg 30kg",
    "RoboWars CGC Mohali",
    "RoboWars Punjab",
    "Nitro Circuit RoboRace",
    "CodePulse 24h Hackathon",
    "National Hackathons 2026",
    "Hackathon CGC Mohali",
    "Web3 and AI Hackathon",
    "Saviskar E-Clash Valorant 5v5",
    "BGMI Championship CGC",
    "Esports Tournament Mohali",
    "FIFA LAN Gaming Championship",
    "Symphony of Chaos Battle of the Bands",
    "Battle of the Bands Punjab",
    "Vibrato Music Competition",
    "Footloose Western Dance Showcase",
    "Choreonite Dance Competition",
    "Nachda Punjab Bhangra Giddha Championship",
    "Folk Dance Competition Punjab",
    "Runway of the Future Fashion Show",
    "Inter-College Fashion Pageant",
    "Mr & Ms Saviskar 2026",
    "AIvishkar AI Tech Expo",
    "Autonomous Humanoid Robotics",
    "Founders Arena Angel Pitch",
    "Startup Venture Conclave CGC",
    "The Chakravyuh National General Quiz",
    "Street Beat Nukkad Natak",
    "Mono Acting Drama Competition",
    "Star Night Celebrity Concert",
    "Star Night CGC University",
    "Celebrity Star Night Mohali",
    "EDM Night CGC Mohali",
    "Bollywood Live Concert Mohali",
    "College Fest Passes 2026",
    "Saviskar Pass Registration",
    "Festival Prize Pool 20 Lakhs",
  ],
  authors: [
    { name: "CGC University, Mohali", url: "https://cgcuniversity.in" },
    { name: "Team DSA & SAC", url: "https://saviskar.co.in/team" },
  ],
  creator: "CGC University, Mohali",
  publisher: "CGC University, Mohali",
  category: "University Festival & National Competitions",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: ["/favicon.ico"],
  },
  alternates: {
    canonical: "/",
    languages: {
      "en-IN": "/",
    },
  },
  openGraph: {
    title: "CGC University Mohali | Saviskar 2026 (Official CGC Fest) — Aevorian Reverie",
    description:
      "Where Tomorrow Dreams Awake. North India's flagship Annual National Techno-Cultural University Festival at CGC University, Mohali. 50+ Realms of Experience, 500+ Universities, 35,000+ Students, Endless Possibilities, Cash Prizes Upto ₹20 LACS.",
    url: "https://saviskar.co.in",
    siteName: "Saviskar 2026 — CGC University Mohali",
    locale: "en_IN",
    type: "website",
    images: [
      {
        url: "/images/concert-stadium.webp",
        width: 1920,
        height: 1080,
        alt: "Saviskar 2026 Aevorian Reverie Mainstage Stadium Realm at CGC University, Mohali",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CGC University Mohali | Saviskar 2026 (Official CGC Fest) — Aevorian Reverie",
    description:
      "Where Tomorrow Dreams Awake. North India's flagship Annual National Techno-Cultural University Festival at CGC University, Mohali. 50+ Realms of Experience, 500+ Universities, 35,000+ Students, Endless Possibilities, Cash Prizes Upto ₹20 LACS.",
    images: ["/images/concert-stadium.webp"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    google: "googlee9e943df092cfddf",
    other: {
      "google-site-verification": ["googlee9e943df092cfddf.html", "googlee9e943df092cfddf"],
    },
  },
  other: {
    "geo.region": "IN-PB",
    "geo.placename": "Mohali, Chandigarh, Punjab, India",
    "geo.position": "30.6942;76.6653",
    "ICBM": "30.6942, 76.6653",
    "DC.title": "CGC University Mohali | Saviskar 2026 (Official CGC Fest) — Aevorian Reverie",
    "DC.creator": "CGC University, Mohali",
    "DC.subject": "CGC University Fest, Saviskar 2026, Aevorian Reverie, RoboWars, Hackathons, Star Night Concerts, College Fests in Punjab Chandigarh Mohali",
  },
};

// Rich Structured Data (JSON-LD) Schemas

// 1. Google Sitelinks / Expanded Search Architecture (SiteNavigationElement)
const jsonLdSiteNavigation = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SiteNavigationElement",
      "@id": "https://saviskar.co.in/#nav-register",
      name: "Register / Claim Passes",
      description:
        "Official registration and digital pass accreditation for 50+ national collegiate competitions at CGC University Mohali.",
      url: "https://saviskar.co.in/register",
    },
    {
      "@type": "SiteNavigationElement",
      "@id": "https://saviskar.co.in/#nav-events",
      name: "50+ Events & Realms",
      description:
        "Explore 50+ competitions across Technical, Cultural, Non-Technical, and AIvishkar with cash prizes upto ₹20 LACS across 500+ universities.",
      url: "https://saviskar.co.in/events",
    },
    {
      "@type": "SiteNavigationElement",
      "@id": "https://saviskar.co.in/#nav-schedule",
      name: "Campus Map & Schedule",
      description:
        "48-hour live competition itinerary and interactive campus map for CGC University Mohali across Block 1, Block 2 Auditorium, and Concert Grounds.",
      url: "https://saviskar.co.in/schedule",
    },
    {
      "@type": "SiteNavigationElement",
      "@id": "https://saviskar.co.in/#nav-starnight",
      name: "Star Night Concerts",
      description:
        "Headline celebrity concerts, laser pyrotechnics, and stadium pro-nights under the Mohali night sky.",
      url: "https://saviskar.co.in/starnight",
    },
    {
      "@type": "SiteNavigationElement",
      "@id": "https://saviskar.co.in/#nav-gallery",
      name: "Dome Gallery & Archives",
      description:
        "Interactive 3D Dome Gallery and visual archive capturing 35,000+ creators, hackers, and performers across 500+ universities.",
      url: "https://saviskar.co.in/gallery",
    },
    {
      "@type": "SiteNavigationElement",
      "@id": "https://saviskar.co.in/#nav-team",
      name: "Organising Team & SAC",
      description:
        "Executive leadership, Student Advisory Council (SAC), and Department of Student Affairs (DSA) at CGC University Mohali.",
      url: "https://saviskar.co.in/team",
    },
  ],
};

// 2. BreadcrumbList Schema for Google Search Hierarchy
const jsonLdBreadcrumbs = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: "https://saviskar.co.in",
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "50+ Events & Realms",
      item: "https://saviskar.co.in/events",
    },
    {
      "@type": "ListItem",
      position: 3,
      name: "Campus Map & Schedule",
      item: "https://saviskar.co.in/schedule",
    },
    {
      "@type": "ListItem",
      position: 4,
      name: "Star Night",
      item: "https://saviskar.co.in/starnight",
    },
    {
      "@type": "ListItem",
      position: 5,
      name: "Register / Passes",
      item: "https://saviskar.co.in/register",
    },
  ],
};

// 3. Festival / Event Schema (With Typos, College Keywords & Every Single Event)
const jsonLdFestival = {
  "@context": "https://schema.org",
  "@type": "Festival",
  "@id": "https://saviskar.co.in/#festival",
  name: "Saviskar 2026: Aevorian Reverie (Official CGC Fest)",
  alternateName: [
    "CGC Fest",
    "CGC Fest 2026",
    "CGC University Fest",
    "CGC Mohali Fest",
    "CGC Landran Fest",
    "CGC Jhanjeri Fest",
    "Chandigarh Group of Colleges Fest",
    "CGC Saviskar",
    "Saviskar CGC",
    "Saviskar 2026",
    "Saviskar",
    "Savishkar",
    "Savishkar 2026",
    "Sawiskar",
    "Sawishkar",
    "Saviskar '26",
    "Saviskar26",
    "Saviskar-26",
    "Aevorian Reverie",
    "Aevorian Reviere",
    "Aevorian Revire",
    "Aevorian Revrie",
    "Where Tomorrow Dreams Awake",
    "CGC Annual Fest",
    "CGC Tech Fest",
    "CGC Cultural Fest",
    "CGC Star Night",
  ],
  description:
    "Where Tomorrow Dreams Awake. North India's flagship Annual National Techno-Cultural University Festival at CGC University, Mohali (CGC). A future imagined so vividly, it begins to exist. Featuring 50+ competitive realms across technology, cultural arts, national hackathons, combat robotics, and headline Star Night concerts.",
  url: "https://saviskar.co.in",
  image: [
    "https://saviskar.co.in/images/concert-stadium.webp",
    "https://saviskar.co.in/images/saviskar-logo.png",
  ],
  startDate: "2026-10-28T09:00:00+05:30",
  endDate: "2026-10-29T23:59:59+05:30",
  eventStatus: "https://schema.org/EventScheduled",
  eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
  location: {
    "@type": "Place",
    name: "CGC University, Mohali",
    alternateName: [
      "CGC",
      "CGC University",
      "CGC Mohali",
      "CGC Landran",
      "Chandigarh Group of Colleges",
    ],
    address: {
      "@type": "PostalAddress",
      streetAddress: "State Highway 12A, Chandigarh-Sirhind Road",
      addressLocality: "Mohali (Sahibzada Ajit Singh Nagar)",
      addressRegion: "Punjab",
      postalCode: "140307",
      addressCountry: "IN",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: 30.6942,
      longitude: 76.6653,
    },
  },
  organizer: {
    "@type": "CollegeOrUniversity",
    name: "CGC University, Mohali",
    alternateName: [
      "CGC",
      "CGC University",
      "CGC Mohali",
      "CGC Landran",
      "CGC Jhanjeri",
      "Chandigarh Group of Colleges",
    ],
    url: "https://cgcuniversity.in",
    sameAs: [
      "https://cgcuniversity.in",
      "https://www.cgc.edu.in",
      "https://www.instagram.com/saviskar_cgc/",
      "https://www.instagram.com/saviskar.cgcuniversity/",
    ],
  },
  offers: {
    "@type": "AggregateOffer",
    priceCurrency: "INR",
    lowPrice: "0",
    highPrice: "1500",
    offerCount: "50+",
    url: "https://saviskar.co.in/register",
    availability: "https://schema.org/InStock",
    validFrom: "2026-09-01T00:00:00+05:30",
  },
  subEvent: [
    {
      "@type": "Event",
      name: "Metal Mayhem — Combat RoboWars (15kg & 30kg Category)",
      description: "Bulletproof polycarbonate arena battles featuring pneumatic flippers, spinning drum blades, and wedge chassis battlebots at CGC Mohali Block 2.",
      url: "https://saviskar.co.in/events/technical",
    },
    {
      "@type": "Event",
      name: "CodePulse 24-Hour National Hackathon",
      description: "Flagship overnight national software development hackathon solving AI, Web3, FinTech, and healthcare challenges evaluated by Google and Microsoft tech leads.",
      url: "https://saviskar.co.in/events/technical",
    },
    {
      "@type": "Event",
      name: "Nitro Circuit — High-Speed RoboRace",
      description: "Custom-built RC rovers racing through timed hairpin turns, ramps, and sand hazards at the CGC arena track.",
      url: "https://saviskar.co.in/events/technical",
    },
    {
      "@type": "Event",
      name: "Saviskar E-Clash: Valorant 5v5 Championship",
      description: "High-stakes tactical shooter collegiate tournament on 240Hz monitors with live caster commentary at Block 3 LAN Arena.",
      url: "https://saviskar.co.in/events/non-technical",
    },
    {
      "@type": "Event",
      name: "BGMI Mobile Battlegrounds National Championship",
      description: "Battlegrounds Mobile India inter-college tournament live-streamed with cash prizes and esports trophies.",
      url: "https://saviskar.co.in/events/non-technical",
    },
    {
      "@type": "Event",
      name: "Symphony of Chaos — Battle of the Bands",
      description: "Premier collegiate rock, indie, and fusion bands dueling live on the CGC concert mainstage for ₹1,00,000+ prize pool.",
      url: "https://saviskar.co.in/events/cultural",
    },
    {
      "@type": "Event",
      name: "Footloose — Western & Thematic Group Dance Showcase",
      description: "Synchronized hip-hop, contemporary, and theatrical dance crews competing under concert lighting at CGC Main Auditorium.",
      url: "https://saviskar.co.in/events/cultural",
    },
    {
      "@type": "Event",
      name: "Nachda Punjab — Bhangra & Giddha Folk Dance Championship",
      description: "High-energy authentic Punjabi folk dance competition celebrating regional heritage on the grand amphitheater stage.",
      url: "https://saviskar.co.in/events/cultural",
    },
    {
      "@type": "Event",
      name: "Runway of the Future — Haute Couture Fashion Show",
      description: "Futuristic and avant-garde couture fashion walk judging elegance, theme interpretation, and runway choreography.",
      url: "https://saviskar.co.in/events/cultural",
    },
    {
      "@type": "Event",
      name: "AIvishkar: Flagship AI Tech Expo & Humanoid Robotics",
      description: "National AI expo featuring autonomous robotics, neural computer vision demos, prompt engineering arenas, and startup venture grants.",
      url: "https://saviskar.co.in/events/aivishkar",
    },
    {
      "@type": "Event",
      name: "Founders Arena — Angel Pitch & Startup Venture Conclave",
      description: "Student startup founders pitch to angel investors, venture capitalists, and incubator partners for seed checks and grants.",
      url: "https://saviskar.co.in/events/technical",
    },
    {
      "@type": "Event",
      name: "The Chakravyuh — National General Quiz",
      description: "Inter-university intellect duel spanning geopolitics, sci-fi, history, pop culture, and business lore.",
      url: "https://saviskar.co.in/events/non-technical",
    },
    {
      "@type": "Event",
      name: "Street Beat — Nukkad Natak Drama Competition",
      description: "Open-air street play competition delivering powerful social messages with live dhol beats and vocal choruses.",
      url: "https://saviskar.co.in/events/cultural",
    },
    {
      "@type": "Event",
      name: "Mr & Ms Saviskar 2026 Personality Pageant",
      description: "The definitive personality, talent, wit, and runway contest crowning the student ambassadors of CGC University Mohali.",
      url: "https://saviskar.co.in/events/cultural",
    },
    {
      "@type": "MusicEvent",
      name: "Star Night (Day 1) — Live in Concert: Asees Kaur",
      description: "Headline concert in the CGC Concert Arena featuring Bollywood sensation Asees Kaur, live instrumental bands, and 35,000+ attendee crowd.",
      performer: {
        "@type": "Person",
        name: "Asees Kaur",
      },
      url: "https://saviskar.co.in/starnight",
    },
    {
      "@type": "MusicEvent",
      name: "Star Night (Day 2) — Grand Finale: Ranjit Bawa",
      description: "Grand stadium finale with Punjabi folk icon Ranjit Bawa, live dhol ensemble, pyrotechnic displays, and laser lighting.",
      performer: {
        "@type": "Person",
        name: "Ranjit Bawa",
      },
      url: "https://saviskar.co.in/starnight",
    },
  ],
};

// 4. Definitive Institutional University Entity (Dominate "CGC" Searches & Outrank College Domain)
const jsonLdUniversity = {
  "@context": "https://schema.org",
  "@type": "CollegeOrUniversity",
  "@id": "https://cgcuniversity.in/#cgc-university",
  name: "CGC University, Mohali",
  alternateName: [
    "CGC",
    "CGC University",
    "CGC Mohali",
    "CGC Landran",
    "CGC Jhanjeri",
    "Chandigarh Group of Colleges",
    "Chandigarh Group of Colleges University, Mohali",
    "Chandigarh Group of Colleges Landran",
    "CGC Chandigarh",
    "CGC Campus",
    "CGC Fest Host",
    "CGC University Punjab",
    "CGC Student Affairs",
    "CGC DSA",
    "CGC SAC",
  ],
  disambiguatingDescription:
    "CGC (Chandigarh Group of Colleges / CGC University, Mohali) is a leading higher education institution in North India and official host of the annual national techno-cultural university festival Saviskar 2026: Aevorian Reverie.",
  url: "https://cgcuniversity.in",
  logo: "https://saviskar.co.in/images/saviskar-logo.png",
  image: "https://saviskar.co.in/images/concert-stadium.webp",
  address: {
    "@type": "PostalAddress",
    streetAddress: "State Highway 12A, Chandigarh-Sirhind Road",
    addressLocality: "Mohali (Sahibzada Ajit Singh Nagar)",
    addressRegion: "Punjab",
    postalCode: "140307",
    addressCountry: "IN",
  },
  geo: {
    "@type": "GeoCoordinates",
    latitude: 30.6942,
    longitude: 76.6653,
  },
  hasOfferCatalog: {
    "@type": "OfferCatalog",
    name: "Saviskar 2026 Competitive Realms & Events",
    itemListElement: [
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Event",
          name: "Saviskar 2026: Aevorian Reverie (CGC Fest)",
          url: "https://saviskar.co.in",
        },
      },
    ],
  },
  event: {
    "@id": "https://saviskar.co.in/#festival",
  },
  contactPoint: {
    "@type": "ContactPoint",
    email: "saviskar@cgcuniversity.in",
    contactType: "Student Affairs & Festival Secretariat",
    areaServed: "IN",
    availableLanguage: ["English", "Hindi", "Punjabi"],
  },
  sameAs: [
    "https://cgcuniversity.in",
    "https://www.cgc.edu.in",
    "https://www.instagram.com/saviskar_cgc/",
    "https://www.instagram.com/cgc_landran/",
    "https://www.instagram.com/saviskar.cgcuniversity/",
  ],
};

// 5. DefinedTerm Schema: Aevorian Reverie (Theme Meaning & Typo Disambiguation)
const jsonLdDefinedTermTheme = {
  "@context": "https://schema.org",
  "@type": "DefinedTerm",
  "@id": "https://saviskar.co.in/#aevorian-reverie",
  name: "Aevorian Reverie",
  alternateName: [
    "Aevorian Reviere",
    "Aevorian Revire",
    "Aevorian Revrie",
    "Aevorian Reveire",
    "Evorian Reverie",
    "Aeovorian Reverie",
    "Aevorian Reveri",
    "Aevorian Riviere",
    "Where Tomorrow Dreams Awake",
    "A future imagined so vividly it begins to exist",
  ],
  termCode: "AEVORIAN-REVERIE",
  description:
    "The official conceptual theme of Saviskar 2026 at CGC University, Mohali. Philosophy: 'A future imagined so vividly, it begins to exist.' Etymology: 'Aevorian' evokes aeon (eternity, timeless endurance) and aurora (a new dawn of luminous intelligence). 'Reverie' signifies a state of waking dream where bold human imagination crosses into physical reality. For Saviskar's third edition, it manifests as a dream core orbiting through luminous intelligence, uniting human creativity, AI, art, and technology in one dreamscape under the banner 'Where Tomorrow Dreams Awake'.",
  inDefinedTermSet: {
    "@type": "DefinedTermSet",
    name: "Saviskar Conceptual Lexicon",
    url: "https://saviskar.co.in",
  },
};

// 6. FAQPage Schema: Google AI Overviews, Featured Snippets & College Ranking Accelerator
const jsonLdFAQ = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What is CGC and why is CGC University Mohali famous for Saviskar?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "CGC (Chandigarh Group of Colleges / CGC University, Mohali / CGC Landran) is one of North India's foremost higher education institutions. CGC is internationally renowned for hosting Saviskar, its flagship annual national techno-cultural university festival. Drawing over 35,000 students from 500+ universities across India with endless possibilities, Saviskar features cash prizes upto ₹20 LACS (20 Lakhs), national robotics (RoboRace, Graviton), 24h coding hackathons, battle of the bands (Clash of Chords), and stadium-scale Star Night celebrity concerts.",
      },
    },
    {
      "@type": "Question",
      name: "What is the meaning and story behind Aevorian Reverie (or Aevorian Reviere)?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Aevorian Reverie is the official conceptual theme of Saviskar 2026 at CGC University, Mohali. Its guiding philosophy is 'A future imagined so vividly, it begins to exist.' Etymologically, 'Aevorian' evokes aeon (eternity, timeless endurance) and aurora (a luminous new dawn of intelligence). 'Reverie' is a state of waking dream where visionary human imagination crosses into physical reality. For Saviskar's 3rd landmark edition, it represents a world where every cycle births a more evolved reality—unifying human creativity, artificial intelligence, artistic expression, and advanced engineering into one transcendent dreamscape under the motto 'Where Tomorrow Dreams Awake. Two Days. Countless Stories. One Campus. Infinite Ways To Make Your Mark.'",
      },
    },
    {
      "@type": "Question",
      name: "What are the major competitions and events happening at CGC Saviskar 2026?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "CGC Saviskar 2026 hosts over 50 marquee competitions across 4 realms: 1. Technical (Think. Build. Challenge. Conquer.): Web-Dev Sprint, Code Circuit, Thrust Powered Vehicle Challenge, FormulaRx, LabX, Crime Scene, VISION HACK, AI Game Maker, Optovation, RoboRace, Graviton, Bug Hunt: Code Cracker, TechXhibit, Diagnostic Challenge, Prayog, National MUN; 2. Cultural (Own the stage. Set the rhythm. Make your moment.): Nritya-E-Bharat Folk Dance, Clash of Chords Battle of Bands, Mr. & Ms. Saviskar, Saviskar Got Talent (SGT), Footlose Solo & Western Dance, Sur Sagar Sing Your Story, Gully War Rap Battle, Nachda Punjab Punjabi Folk, Spin & Dance; 3. Non-Technical (Create without limits. Play beyond the ordinary.): Face Painting, Doodle Art, Short Film Contest, Open Mic, Business Quiz, Photography, Chill & Grill Fireless Cooking, Ad-Mad Show, Brand Battle, The Opinion Exchange, The Case Mystique, Reel-ity Check, Canvas Art, Visual Storytelling Challenge, Vlog Making; plus stadium-shaking Star Night celebrity concerts.",
      },
    },
    {
      "@type": "Question",
      name: "How do I reach CGC University Mohali from Chandigarh, Delhi, and the Tricity?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "CGC University Mohali is situated on State Highway 12A, Chandigarh-Sirhind Road, Landran, Mohali (SAS Nagar), Punjab 140307. It is easily accessible: 25 minutes from Chandigarh International Airport (IXC), 20 minutes from Mohali Railway Station, and 15 minutes from Sector 43 ISBT Bus Terminus in Chandigarh. Local cabs (Uber, Ola) and direct buses connect from across Chandigarh, Panchkula, Kharar, Zirakpur, and Patiala directly to the CGC campus gates.",
      },
    },
    {
      "@type": "Question",
      name: "How is Saviskar spelled, and is it Saviskar or Savishkar?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "The official name of the festival is Saviskar (also written as Saviskar 2026 or Saviskar '26), commonly searched and phonetically written as Savishkar or Sawiskar. The name is historically derived from the fusion of 'Srijan' (creation) and 'Avishkar' (invention), celebrating the spirit of collegiate innovation, technology, and culture at CGC University, Mohali.",
      },
    },
    {
      "@type": "Question",
      name: "Who can register for Saviskar 2026 passes and what is the prize pool?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Undergraduate and postgraduate students from over 500+ recognized universities, engineering colleges, management institutes, and arts colleges across India are eligible to register. Registrations are available online at https://saviskar.co.in/register. Cash prizes are upto ₹20 LACS (₹20,00,000) across all 50+ competitions, with dedicated trophies, cash awards, certificates of merit, and startup grants. Student Coordinators: Ms. Lakshita (+91 85728 15510), Mr. Saaransh Sharma (+91 62391 24013).",
      },
    },
  ],
};

// 7. WebSite Schema with Sitelinks SearchAction
const jsonLdWebSite = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": "https://saviskar.co.in/#website",
  url: "https://saviskar.co.in",
  name: "CGC University Mohali | Saviskar 2026 Official Portal",
  alternateName: [
    "CGC Fest",
    "CGC University Fest",
    "CGC Mohali Fest",
    "Saviskar",
    "Savishkar 2026",
    "Aevorian Reverie",
    "Chandigarh Group of Colleges Fest",
  ],
  description:
    "Official Web Portal for Saviskar 2026: Annual National Techno-Cultural University Festival at CGC University, Mohali (CGC).",
  inLanguage: "en-IN",
  publisher: {
    "@id": "https://cgcuniversity.in/#cgc-university",
  },
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: "https://saviskar.co.in/events?q={search_term_string}",
    },
    "query-input": "required name=search_term_string",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} dark h-full antialiased`}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdSiteNavigation) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdBreadcrumbs) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdFestival) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdUniversity) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdDefinedTermTheme) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdFAQ) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdWebSite) }}
        />
      </head>
      <body className="min-h-full w-full max-w-[100vw] overflow-x-clip flex flex-col bg-black text-white selection:bg-white selection:text-black">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-lg focus:bg-violet-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-xl focus:ring-2 focus:ring-white focus:outline-none"
        >
          Skip to main content
        </a>

        {/* Semantic Knowledge Graph & Search Accessibility Block for Web Crawlers, AI Assistants & Assistive Devices */}
        <section
          aria-label="CGC University Mohali — Saviskar 2026 Festival Overview and Regional Entity Index"
          className="sr-only"
          style={{
            position: "absolute",
            width: "1px",
            height: "1px",
            padding: 0,
            margin: "-1px",
            overflow: "hidden",
            clip: "rect(0, 0, 0, 0)",
            whiteSpace: "nowrap",
            borderWidth: 0,
          }}
        >
          <h1>CGC University Mohali | Saviskar 2026: Aevorian Reverie (Official CGC Fest Portal)</h1>
          <p>
            Saviskar 2026 (also known as Savishkar, Sawiskar, Saviskar &apos;26, or Saviskar26) is the official flagship Annual National Techno-Cultural University Festival organized by CGC (CGC University, Mohali / Chandigarh Group of Colleges / CGC Landran / CGC Jhanjeri). Hosted across the landmark CGC Mohali campus on State Highway 12A, Chandigarh-Sirhind Road, Landran, Punjab 140307.
          </p>

          <h2>CGC University Mohali &amp; Chandigarh Group of Colleges Authority</h2>
          <p>
            CGC University Mohali is a distinguished higher education landmark in North India. Saviskar represents the absolute pinnacle of student innovation, artistic performance, and campus life at CGC, organized under the patronage of the Directorate of Student Affairs (Team DSA) and the Student Advisory Council (SAC). Over 35,000 student attendees representing 500+ universities across India converge at CGC Mohali for two electric days of competition with endless possibilities. Two Days. Countless Stories. One Campus. Infinite Ways To Make Your Mark.
          </p>

          <h2>Nearby Areas, Tricity Proximity &amp; College Vicinity</h2>
          <p>
            Saviskar at CGC University is centrally located in Mohali (Sahibzada Ajit Singh Nagar / SAS Nagar), situated adjacent to Chandigarh (The City Beautiful), Panchkula, Kharar, Landran, Zirakpur, and Kurali. Serving the vibrant collegiate student communities of the Chandigarh Tricity and surrounding premier universities including Chandigarh University (CU), Chitkara University, Thapar Institute of Engineering and Technology (TIET Patiala), Punjab Engineering College (PEC Chandigarh), Panjab University (PU Chandigarh), Rayat Bahra University, and IIT Ropar.
          </p>

          <h2>Theme Identity: Aevorian Reverie (Phonetic: Aevorian Reviere)</h2>
          <p>
            The official festival theme is <strong>Aevorian Reverie</strong> (also searched as <em>aevorian reviere</em>, <em>aevorian revire</em>, <em>evorian reverie</em>, or <em>where tomorrow dreams awake</em>). The theme&apos;s guiding philosophy: &ldquo;A future imagined so vividly, it begins to exist.&rdquo; Etymology: <strong>Aevorian</strong> fuses <em>aeon</em> (timeless eternity, enduring impact) with <em>aurora</em> (the dawn of technological illumination). <strong>Reverie</strong> signifies an active waking dream where bold human creative imagination transforms into physical reality.
          </p>
          <p>
            The name <strong>Saviskar</strong> is the historical synthesis of <em>Srijan</em> (creation) and <em>Avishkar</em> (invention).
          </p>

          <h2>All 50+ Competitive Realms &amp; Signature Events (Cash Prizes Upto ₹20 LACS)</h2>
          <ul>
            <li><strong>Technical Realm (Think. Build. Challenge. Conquer.):</strong> Web-Dev Sprint, Code Circuit - Pass the Code Beat the Clock, Thrust Powered Vehicle Challenge, FormulaRx, LabX, Crime Scene, Assessment of Posture Education, AI Video &amp; Meme Challenge, VISION HACK — Train Your Own AI, AI Game Maker Challenge, Intubation &amp; Airway Management Simulation, Optovation — Build a Smart Eye, RoboRace, Graviton, Bug Hunt: Code Cracker, TechXhibit, Diagnostic Challenge, Prayog, National MUN, The Best Manager.</li>
            <li><strong>Cultural Realm (Own the stage. Set the rhythm. Make your moment.):</strong> Nritya-E-Bharat – Folk Dance, Clash of Chords – Battle of Bands, Mr. &amp; Ms. Saviskar, Saviskar Got Talent (SGT), Footlose– Solo &amp; Western Dance, Sur Sagar – Sing Your Story, Gully War – Rap Battle, Nachda Punjab – Punjabi Folk, Spin &amp; Dance.</li>
            <li><strong>Non-Technical Realm (Create without limits. Play beyond the ordinary.):</strong> Face Painting, Doodle Art, Short Film Contest, Open Mic, Business Quiz, Photography, Chill &amp; Grill – Fireless Cooking, Ad-Mad Show, Brand Battle, The Opinion Exchange, The Case Mystique, Reel-ity Check, Canvas Art, Visual Storytelling Challenge, Vlog Making.</li>
            <li><strong>AIvishkar:</strong> Flagship National AI Tech Expo, Autonomous Humanoid Robotics, Neural Agents, Computer Vision labs, and Founders Arena Angel Pitch Venture Grants.</li>
            <li><strong>Star Night Stadium Concerts:</strong> Two consecutive nights of stadium celebrity concerts, chart-topping headline artists, laser pyrotechnics, and 35,000+ voices singing under the Mohali night sky.</li>
          </ul>

          <h2>CGC Campus Venues &amp; Map Coordinates</h2>
          <p>
            Block 1 Academic Complex &amp; Executive Conclave; Block 2 Main Auditorium &amp; Heavy Armor RoboWars Arena; Block 3 Media Studios &amp; LAN Gaming Center; Ivory Hall Residential Commons &amp; Basketball Courts; Block 6 Computing Hub &amp; Hackathon Labs; Block 7 Research Towers; Main Concert Arena &amp; Festival Grounds. Geo Coordinates: Latitude 30.6942 N, Longitude 76.6653 E.
          </p>

          <h2>Dates, Registration Portal &amp; Student Coordinators</h2>
          <p>
            Festival Dates: October 28 &ndash; October 29, 2026. Official Passes &amp; Competitions Registration: https://saviskar.co.in/register. Contact Email: saviskar@cgcuniversity.in.
            Student Coordinators: Ms. Lakshita (Mobile: +91 85728 15510), Mr. Saaransh Sharma (Mobile: +91 62391 24013).
          </p>
        </section>

        <SmoothScrollProvider>
          <div id="main-content" className="flex min-h-full flex-1 flex-col">
            {children}
          </div>
        </SmoothScrollProvider>
      </body>
    </html>
  );
}
