export type PaymentUnit = "free" | "per_student" | "per_team" | "tbd";

export type EventPricing = {
  price: number;
  paymentUnit: PaymentUnit;
  minTeamSize?: number;
  maxTeamSize?: number;
};

/**
 * Pricing supplied for Saviskar 2026.
 * Mime is intentionally marked TBD because the supplied sheet gives ₹1,000
 * but does not specify whether that is per student or per team.
 */
export const eventPricing: Record<string, EventPricing> = {
  "The Best Manager": { price: 100, paymentUnit: "per_student" },
  "Code Cracker (Bug Hunt)": { price: 0, paymentUnit: "free" },
  "Face Painting": { price: 0, paymentUnit: "free" },
  "Doodle Art": { price: 0, paymentUnit: "free" },
  "Open Mic": { price: 100, paymentUnit: "per_student" },
  "Photography Competition": { price: 500, paymentUnit: "per_student" },
  "Step Stars: Solo Western Dance": { price: 500, paymentUnit: "per_student" },
  "Solo Singing": { price: 500, paymentUnit: "per_student" },
  "Gully War: Rap Battle": { price: 300, paymentUnit: "per_student" },
  "Saviskar Got Talent": { price: 500, paymentUnit: "per_student" },
  "Mr. & Ms. Saviskar (Solo Ramp Walk)": { price: 500, paymentUnit: "per_student" },

  "InvestoPitch - The Portfolio Challenge": {
    price: 100,
    paymentUnit: "per_student",
    minTeamSize: 2,
    maxTeamSize: 3,
  },
  "Case Competition Challenge": {
    price: 0,
    paymentUnit: "free",
    minTeamSize: 4,
    maxTeamSize: 5,
  },
  "Mobile App Development": {
    price: 0,
    paymentUnit: "free",
    minTeamSize: 2,
    maxTeamSize: 5,
  },
  Dronathon: { price: 0, paymentUnit: "free" },
  "Ad-o-Mania (Creative Advertising)": {
    price: 0,
    paymentUnit: "free",
    minTeamSize: 3,
    maxTeamSize: 4,
  },
  "Forensic Evidence Search": {
    price: 0,
    paymentUnit: "free",
    minTeamSize: 1,
    maxTeamSize: 3,
  },
  Formulation: { price: 0, paymentUnit: "free", minTeamSize: 2, maxTeamSize: 2 },
  "Frame Making Workshop & Competition / Eye Modelling Competitions": {
    price: 0,
    paymentUnit: "free",
    minTeamSize: 2,
    maxTeamSize: 3,
  },
  RoboRace: { price: 0, paymentUnit: "free", minTeamSize: 3, maxTeamSize: 3 },
  "Thinkathon 2.0": { price: 0, paymentUnit: "free", minTeamSize: 2, maxTeamSize: 4 },
  "TechXhibit: Project Display": {
    price: 0,
    paymentUnit: "free",
    minTeamSize: 2,
    maxTeamSize: 5,
  },
  "Diagnostic Challenge": {
    price: 0,
    paymentUnit: "free",
    minTeamSize: 2,
    maxTeamSize: 4,
  },
  "Microscopy Marathon": {
    price: 0,
    paymentUnit: "free",
    minTeamSize: 2,
    maxTeamSize: 4,
  },
  "Revive to Survive (CPR & BLS Drill)": { price: 0, paymentUnit: "free" },
  "Prayog: The Experiment to Experience": { price: 0, paymentUnit: "free" },
  "Short Film Contest": {
    price: 500,
    paymentUnit: "per_student",
    minTeamSize: 4,
    maxTeamSize: 5,
  },
  "Best Out of Waste": { price: 0, paymentUnit: "free", minTeamSize: 2, maxTeamSize: 3 },
  "Reel Making/Social Media Campaign": {
    price: 500,
    paymentUnit: "per_student",
    minTeamSize: 2,
    maxTeamSize: 3,
  },
  "Squid Games (Science Edition)": { price: 0, paymentUnit: "free" },
  "Chill & Grill: Without Fire (Fireless Cooking)": {
    price: 0,
    paymentUnit: "free",
    minTeamSize: 2,
    maxTeamSize: 4,
  },
  "Nritya-e-Bharat : Indian Folk": { price: 3000, paymentUnit: "per_team", minTeamSize: 5, maxTeamSize: 20 },
  "Nachda Punjab : Punjabi Folk": { price: 3000, paymentUnit: "per_team", minTeamSize: 6, maxTeamSize: 12 },
  "Step It Up : Western Dance Crew": { price: 5000, paymentUnit: "per_team", minTeamSize: 3, maxTeamSize: 15 },
  "Spin & Dance : Street Dance Battle": { price: 200, paymentUnit: "per_student", minTeamSize: 3, maxTeamSize: 10 },
  "Battle of Bands": { price: 5000, paymentUnit: "per_team", minTeamSize: 4, maxTeamSize: 10 },
  "Nukkad Natak": { price: 1000, paymentUnit: "per_team", minTeamSize: 9, maxTeamSize: 9 },
  Mime: { price: 1000, paymentUnit: "tbd" },
};

export function getEventPricing(name: string | null | undefined): EventPricing {
  if (!name) return { price: 0, paymentUnit: "free" };
  return eventPricing[name] ?? { price: 0, paymentUnit: "free" };
}

export function formatEventPrice(pricing: EventPricing): string {
  if (pricing.paymentUnit === "free") return "Free";
  if (pricing.paymentUnit === "tbd") return `₹${pricing.price.toLocaleString("en-IN")} · payment unit TBD`;
  const suffix = pricing.paymentUnit === "per_team" ? "per team" : "per student";
  return `₹${pricing.price.toLocaleString("en-IN")} ${suffix}`;
}
