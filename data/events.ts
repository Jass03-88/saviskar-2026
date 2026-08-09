export type SaviskarEvent = {
  id: string;
  title: string;
  category: "technical" | "cultural" | "non-technical" | "sports";
  tagline: string;
  featured?: boolean;
};

export const events: SaviskarEvent[] = [
  { id: "best-manager", title: "The Best Manager", category: "technical", tagline: "Lead, strategize, and prove your managerial edge." },
  { id: "bug-hunt", title: "Code Cracker (Bug Hunt)", category: "technical", tagline: "Debug, solve, and conquer the coding challenge." },
  { id: "dronathon", title: "Dronathon", category: "technical", tagline: "Fly high and compete with your drone skills.", featured: true },
  { id: "investopitch", title: "InvestoPitch - The Portfolio Challenge", category: "technical", tagline: "Pitch your portfolio and outsmart the market." },
  { id: "case-competition", title: "Case Competition Challenge", category: "technical", tagline: "Crack real-world cases with smart solutions." },
  { id: "mobile-app-development", title: "Mobile App Development", category: "technical", tagline: "Innovate, code, and build the next-gen app." },
  { id: "ad-o-mania", title: "Ad-o-Mania (Creative Advertising)", category: "technical", tagline: "Unleash your creativity in advertising." },
  { id: "forensic-evidence-search", title: "Forensic Evidence Search", category: "technical", tagline: "Step into the shoes of a crime investigator." },
  { id: "formulation", title: "Formulation", category: "technical", tagline: "Mix, measure, and master pharmaceutical innovation." },
  { id: "roborace", title: "RoboRace", category: "technical", tagline: "Race your robot to victory.", featured: true },
  { id: "thinkathon", title: "Thinkathon 2.0", category: "technical", tagline: "Forge sustainable ideas for a better tomorrow." },
  { id: "techxhibit", title: "TechXhibit: Project Display", category: "technical", tagline: "Showcase your innovations to the world.", featured: true },
  { id: "diagnostic-challenge", title: "Diagnostic Challenge", category: "technical", tagline: "Test your medical diagnosis expertise." },
  { id: "microscopy-marathon", title: "Microscopy Marathon", category: "technical", tagline: "Dive deep into the microscopic world." },
  { id: "revive-to-survive", title: "Revive to Survive (CPR & BLS Drill)", category: "technical", tagline: "Learn lifesaving CPR and BLS techniques hands-on." },
  { id: "prayog", title: "Prayog: The Experiment to Experience", category: "technical", tagline: "Hands-on experiments that spark discovery." },

  { id: "face-painting", title: "Face Painting", category: "non-technical", tagline: "Turn creativity into expression." },
  { id: "doodle-art", title: "Doodle Art", category: "non-technical", tagline: "Create without limits." },
  { id: "open-mic", title: "Open Mic", category: "non-technical", tagline: "Your voice. Your stage." },
  { id: "photography", title: "Photography Competition", category: "non-technical", tagline: "Capture the moment." },
  { id: "short-film", title: "Short Film Contest", category: "non-technical", tagline: "Tell a story worth watching." },
  { id: "best-out-of-waste", title: "Best Out of Waste", category: "non-technical", tagline: "Create more. Waste less." },
  { id: "reel-making", title: "Reel Making/Social Media Campaign", category: "non-technical", tagline: "Create content that moves." },
  { id: "squid-games", title: "Squid Games (Science Edition)", category: "non-technical", tagline: "Think fast. Compete smart." },
  { id: "chill-grill", title: "Chill & Grill: Without Fire (Fireless Cooking)", category: "non-technical", tagline: "Cook without the flame." },
  { id: "frame-making", title: "Frame Making Workshop & Competition / Eye Modelling Competitions", category: "non-technical", tagline: "Build it. Frame it. Create it." },

  { id: "step-stars", title: "Step Stars: Solo Western Dance", category: "cultural", tagline: "Own the stage." },
  { id: "solo-singing", title: "Solo Singing", category: "cultural", tagline: "Let your voice lead." },
  { id: "gully-war", title: "Gully War: Rap Battle", category: "cultural", tagline: "Bars. Beats. Battle." },
  { id: "saviskar-got-talent", title: "Saviskar Got Talent", category: "cultural", tagline: "Bring your talent to the spotlight." },
  { id: "mr-ms-saviskar", title: "Mr. & Ms. Saviskar (Solo Ramp Walk)", category: "cultural", tagline: "Walk with confidence." },
  { id: "nritya-e-bharat", title: "Nritya-e-Bharat : Indian Folk", category: "cultural", tagline: "Tradition takes the stage." },
  { id: "nachda-punjab", title: "Nachda Punjab : Punjabi Folk", category: "cultural", tagline: "Punjab in motion." },
  { id: "step-it-up", title: "Step It Up : Western Dance Crew", category: "cultural", tagline: "Move as one." },
  { id: "spin-dance", title: "Spin & Dance : Street Dance Battle", category: "cultural", tagline: "Street energy. One stage." },
  { id: "battle-of-bands", title: "Battle of Bands", category: "cultural", tagline: "Turn it up." },
  { id: "nukkad-natak", title: "Nukkad Natak", category: "cultural", tagline: "Stories that belong to everyone." },
  { id: "mime", title: "Mime", category: "cultural", tagline: "Speak without words." },
];
