export type SaviskarEvent = {
  id: string;
  title: string;
  category: "technical" | "cultural" | "non-technical" | "sports";
  tagline: string;
  featured?: boolean;

  // Registration & payment settings
  // Leave these unset until event details are confirmed.
  isPaid?: boolean;
  price?: number;
  registrationRequired?: boolean;
  registrationLimit?: number;
  registrationOpen?: boolean;
};

export const events: SaviskarEvent[] = [
  {
    id: "best-manager",
    title: "The Best Manager",
    category: "technical",
    tagline: "Lead, strategize, and prove your managerial edge.",
  },
  {
    id: "investopitch",
    title: "InvestoPitch",
    category: "technical",
    tagline: "Pitch your portfolio and outsmart the market.",
  },
  {
    id: "case-competition",
    title: "Case Competition Challenge",
    category: "technical",
    tagline: "Crack real-world cases with smart solutions.",
  },
  {
    id: "mobile-app-development",
    title: "Mobile App Development",
    category: "technical",
    tagline: "Innovate, code, and build the next-gen app.",
  },
  {
    id: "dronathon",
    title: "Dronathon",
    category: "technical",
    tagline: "Fly high and compete with your drone skills.",
    featured: true,
  },
  {
    id: "ad-o-mania",
    title: "Ad-o-Mania",
    category: "technical",
    tagline: "Unleash your creativity in advertising.",
  },
  {
    id: "forensic-evidence-search",
    title: "Forensic Evidence Search",
    category: "technical",
    tagline: "Step into the shoes of a crime investigator.",
  },
  {
    id: "formulation",
    title: "Formulation",
    category: "technical",
    tagline: "Mix, measure, and master pharmaceutical innovation.",
  },
  {
    id: "revive-to-survive",
    title: "Revive to Survive",
    category: "technical",
    tagline: "Learn lifesaving CPR and BLS techniques hands-on.",
  },
  {
    id: "roborace",
    title: "RoboRace",
    category: "technical",
    tagline: "Race your robot to victory.",
    featured: true,
  },
  {
    id: "hackathon",
    title: "Hackathon",
    category: "technical",
    tagline: "Code your way to innovation.",
    featured: true,
  },
  {
    id: "bug-hunt",
    title: "BUG Hunt",
    category: "technical",
    tagline: "Debug, solve, and conquer the coding challenge.",
  },
  {
    id: "thinkathon",
    title: "Thinkathon 2.0",
    category: "technical",
    tagline: "Forge sustainable ideas for a better tomorrow.",
  },
  {
    id: "techxhibit",
    title: "TechXhibit",
    category: "technical",
    tagline: "Showcase your innovations to the world.",
    featured: true,
  },
  {
    id: "diagnostic-challenge",
    title: "Diagnostic Challenge",
    category: "technical",
    tagline: "Test your medical diagnosis expertise.",
  },
  {
    id: "microscopy-marathon",
    title: "Microscopy Marathon",
    category: "technical",
    tagline: "Dive deep into the microscopic world.",
  },
  {
    id: "prayog",
    title: "Prayog",
    category: "technical",
    tagline: "Hands-on experiments that spark discovery.",
  },
];