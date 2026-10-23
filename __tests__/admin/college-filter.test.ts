import { describe, it, expect } from "vitest";
import { isCgcInstitution, isExternalInstitution } from "@/lib/admin/college-filter";

describe("College Origin Categorization", () => {
  it("identifies various CGC campus names as CGC", () => {
    const cgcNames = [
      "CGC",
      "cgc",
      "CGC University",
      "CGC University Mohali",
      "CGC UNIVERSITY MOHALI",
      "Cgc university",
      "CGC landran",
      "Cgc landran",
      "CGC LANDRAN",
      "Chandigarh Group of Colleges Jhanjeri Mohali",
      "Chandigarh group of colleges landran",
      "Chandigarh Engineering College, Jhanjeri",
      "School of Pharmaceutical Sciences, CGC University Mohali",
      "Cgcu",
      "CGC, landran",
      "CGC mohali",
      "CGC University Mohali, Punjab.",
    ];

    for (const name of cgcNames) {
      expect(isCgcInstitution(name), `Expected "${name}" to be CGC`).toBe(true);
      expect(isExternalInstitution(name), `Expected "${name}" NOT to be external`).toBe(false);
    }
  });

  it("identifies CGC email domains even if college name is informal or omitted", () => {
    expect(isCgcInstitution("Some Dept", "student@cgc.edu.in")).toBe(true);
    expect(isCgcInstitution(null, "user@cgcuniversity.in")).toBe(true);
    expect(isCgcInstitution("", "test@cgcu.ac.in")).toBe(true);
  });

  it("identifies non-CGC institutions as external (including other universities in Punjab)", () => {
    const externalNames = [
      "Chitkara University",
      "Chandigarh University", // CU Gharuan is external
      "Thapar Institute of Engineering and Technology",
      "IIT Ropar",
      "PEC Chandigarh",
      "PIET",
      "ABES ENGINEERING COLLEGE",
      "SRI AUROBINDO COLLEGE",
      "DAV College",
      "RIMT UNIVERSITY",
      "Graphic Era Hill University",
      "Shoolini University",
      "Baba Farid Law College",
      "Manipal University Jaipur",
      "Islamic University of Science and Technology",
    ];

    for (const name of externalNames) {
      expect(isCgcInstitution(name), `Expected "${name}" NOT to be CGC`).toBe(false);
      expect(isExternalInstitution(name), `Expected "${name}" to be external`).toBe(true);
    }
  });

  it("handles null, undefined, or empty values as external", () => {
    expect(isCgcInstitution(null, null)).toBe(false);
    expect(isExternalInstitution(null, null)).toBe(true);
    expect(isCgcInstitution("", "")).toBe(false);
    expect(isExternalInstitution("", "")).toBe(true);
  });
});

describe("Event-wise origin filtering logic", () => {
  const mockRegistrations = [
    {
      registration: { id: "r1", event_id: "ev-ad-mad", is_archived: false, payment_status: "paid", payment_amount: 500 },
      participant: { id: "p1", college: "CGC University Mohali", email: "p1@cgc.edu.in" },
      members: [],
    },
    {
      registration: { id: "r2", event_id: "ev-ad-mad", is_archived: false, payment_status: "paid", payment_amount: 500 },
      participant: { id: "p2", college: "Chitkara University", email: "p2@chitkara.edu.in" },
      members: [],
    },
    {
      registration: { id: "r3", event_id: "ev-ad-mad", is_archived: false, payment_status: "pending", payment_amount: 500, team_name: "Hackers" },
      participant: { id: "p3", college: "Thapar Institute", email: "p3@thapar.edu" },
      members: [
        { participant_id: "m1", participants: { college: "Thapar Institute" } },
        { participant_id: "m2", participants: { college: "PEC Chandigarh" } },
      ],
    },
    {
      registration: { id: "r4", event_id: "ev-bug-hunt", is_archived: false, payment_status: "free", payment_amount: 0 },
      participant: { id: "p4", college: "CEC Jhanjeri", email: "p4@cgc.edu.in" },
      members: [],
    },
  ];

  it("calculates event-wise counts for external only correctly", () => {
    const isCgcReg = (item: typeof mockRegistrations[0]) =>
      isCgcInstitution(item.participant.college, item.participant.email) ||
      Boolean(item.members?.some((m) => isCgcInstitution(m.participants?.college)));

    const allAdMad = mockRegistrations.filter((r) => r.registration.event_id === "ev-ad-mad");
    const externalRegs = mockRegistrations.filter((r) => !isCgcReg(r));
    const cgcRegs = mockRegistrations.filter((r) => isCgcReg(r));

    const adMadExternal = externalRegs.filter((r) => r.registration.event_id === "ev-ad-mad");
    const bugHuntExternal = externalRegs.filter((r) => r.registration.event_id === "ev-bug-hunt");

    expect(allAdMad.length).toBe(3);
    expect(adMadExternal.length).toBe(2); // r2 (Chitkara) and r3 (Thapar + PEC team)
    expect(bugHuntExternal.length).toBe(0); // r4 is CEC Jhanjeri
    expect(cgcRegs.length).toBe(2); // r1 (CGC Mohali) and r4 (CEC Jhanjeri)

    // Verify external delegates (headcount) for Ad-Mad:
    // r2 (solo = 1) + r3 (team = 3 members including leader) = 4 external delegates
    const externalDelegates = adMadExternal.reduce((sum, item) => {
      if (item.members && item.members.length > 0) return sum + item.members.length + 1;
      return sum + 1;
    }, 0);
    expect(externalDelegates).toBe(4);
  });
});

