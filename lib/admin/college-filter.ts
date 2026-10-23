/**
 * Institutional detection utilities to categorize participants and registrations
 * as internal (CGC campuses) vs external institutions.
 */

/**
 * Returns true if the given institution or email matches CGC campuses:
 * - CGC University, Mohali
 * - Chandigarh Group of Colleges (Landran / Jhanjeri)
 * - Chandigarh Engineering College (CEC)
 * - School of Pharmaceutical Sciences, CGC
 * - Any cgc.edu.in / cgc.ac.in / cgcu / cgcuniversity email or name
 */
export function isCgcInstitution(
  college?: string | null,
  email?: string | null
): boolean {
  if (email) {
    const e = email.toLowerCase().trim();
    if (
      e.includes("@cgc.") ||
      e.includes(".cgc.") ||
      e.includes("@cgcu.") ||
      e.includes("@cgcuniversity.")
    ) {
      return true;
    }
  }

  if (!college) return false;
  const c = college.toLowerCase().trim();

  // 1. Direct acronym or word boundary match
  if (
    c === "cgc" ||
    c === "cgcu" ||
    c === "c.g.c" ||
    c === "c.g.c." ||
    /\bcgc\b/i.test(c) ||
    /\bcgcu\b/i.test(c) ||
    c.includes("cgc")
  ) {
    return true;
  }

  // 2. Full official titles
  if (c.includes("chandigarh group")) {
    return true;
  }

  if (c.includes("chandigarh engineering college")) {
    return true;
  }

  // 3. CGC specific campus locations (Landran / Jhanjeri)
  if (c.includes("landran") || c.includes("jhanjeri")) {
    return true;
  }

  return false;
}

/**
 * Returns true if the participant/registration is from an external institution (excluding CGC).
 */
export function isExternalInstitution(
  college?: string | null,
  email?: string | null
): boolean {
  return !isCgcInstitution(college, email);
}
