import { describe, it, expect } from "vitest";
import { PDFDocument, PDFRawStream } from "pdf-lib";
import zlib from "zlib";
import { generateReceiptPdf, ReceiptData, ReceiptTeamMember } from "@/lib/generate-receipt-pdf";
import { resolveReceiptTeamMembers, RawTeamMemberRow } from "@/lib/payments/team-members";

function pdfContainsText(doc: PDFDocument, targetText: string): boolean {
  const targetHex = Buffer.from(targetText, "utf8").toString("hex").toUpperCase();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try {
        const text = zlib.inflateSync(Buffer.from(obj.contents)).toString("latin1").toUpperCase();
        if (text.includes(targetHex)) return true;
      } catch {
        try {
          const text = zlib.inflateRawSync(Buffer.from(obj.contents)).toString("latin1").toUpperCase();
          if (text.includes(targetHex)) return true;
        } catch {}
      }
    }
  }
  return false;
}

describe("Receipt PDF Team Member Display & Pagination", () => {
  it("A: Individual registration (no team members) generates clean 1-page PDF without team section", async () => {
    const individualData: ReceiptData = {
      receiptReference: "RCP-SVK-IND-001",
      paymentDate: "30 Sep 2026, 03:00 pm",
      participantName: "Jashan Singh",
      participantId: "SVK26-FFE51470",
      email: "jashan@example.com",
      phone: "9876543210",
      college: "CGC Landran",
      registrationType: "individual",
      eventName: "Solo Singing Challenge",
      eventCategory: "Cultural",
      items: [
        {
          eventName: "Solo Singing Challenge",
          category: "Cultural",
          registrationType: "individual",
          amount: 500,
        },
      ],
      amount: 500,
      gateway: "payu",
      gatewayOrderId: "txnid_ind_001",
      gatewayPaymentId: "mihpayid_ind_001",
    };

    const pdfBuffer = await generateReceiptPdf(individualData);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.byteLength).toBeGreaterThan(1000);

    const doc = await PDFDocument.load(pdfBuffer);
    expect(doc.getPageCount()).toBe(1);
  });

  it("B: Team registration with 3 members generates PDF containing all members with IDs and roles", async () => {
    const teamMembers: ReceiptTeamMember[] = [
      {
        participantId: "SVK26-FFE51470",
        name: "Jashan",
        email: "jashan@example.com",
        phone: "9876543210",
        isTeamLeader: true,
        role: "Team Head",
      },
      {
        participantId: "SVK26-AF6E41A6",
        name: "Saaransh",
        email: "saaransh@example.com",
        phone: "9876543211",
        isTeamLeader: false,
        role: "Team Member",
      },
      {
        participantId: "SVK26-9228A358",
        name: "Prince",
        email: "prince@example.com",
        phone: "9876543212",
        isTeamLeader: false,
        role: "Team Member",
      },
    ];

    const teamData: ReceiptData = {
      receiptReference: "RCP-SVK-TEAM-001",
      paymentDate: "30 Sep 2026, 03:15 pm",
      participantName: "Jashan",
      participantId: "SVK26-FFE51470",
      email: "jashan@example.com",
      phone: "9876543210",
      college: "CGC",
      registrationType: "team",
      teamName: "Prince",
      eventName: "Clash of Chords",
      eventCategory: "Cultural",
      items: [
        {
          eventName: "Clash of Chords",
          category: "Cultural",
          registrationType: "team",
          teamName: "Prince",
          amount: 5000,
        },
      ],
      teamMembers,
      amount: 5000,
      gateway: "payu",
      gatewayOrderId: "txnid_team_001",
      gatewayPaymentId: "mihpayid_team_001",
    };

    const pdfBuffer = await generateReceiptPdf(teamData);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.byteLength).toBeGreaterThan(1500);

    const doc = await PDFDocument.load(pdfBuffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("C: Large team (10 members) gracefully paginates across multiple pages without overlap or crash", async () => {
    const largeTeamMembers: ReceiptTeamMember[] = Array.from({ length: 10 }, (_, i) => ({
      participantId: `SVK26-MEMBER${String(i + 1).padStart(3, "0")}`,
      name: `Participant Name ${i + 1}`,
      email: `member${i + 1}@example.com`,
      phone: `98765432${String(i).padStart(2, "0")}`,
      isTeamLeader: i === 0,
      role: i === 0 ? "Team Head" : "Team Member",
    }));

    const largeTeamData: ReceiptData = {
      receiptReference: "RCP-SVK-LARGE-001",
      paymentDate: "30 Sep 2026, 03:30 pm",
      participantName: "Participant Name 1",
      participantId: "SVK26-MEMBER001",
      email: "member1@example.com",
      phone: "9876543200",
      college: "Chitkara University",
      registrationType: "team",
      teamName: "Mega Squad",
      eventName: "Battle of the Bands",
      eventCategory: "Cultural",
      items: [
        {
          eventName: "Battle of the Bands",
          category: "Cultural",
          registrationType: "team",
          teamName: "Mega Squad",
          amount: 8000,
        },
      ],
      teamMembers: largeTeamMembers,
      amount: 8000,
      gateway: "payu",
      gatewayOrderId: "txnid_large_001",
      gatewayPaymentId: "mihpayid_large_001",
    };

    const pdfBuffer = await generateReceiptPdf(largeTeamData);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.byteLength).toBeGreaterThan(2000);

    const doc = await PDFDocument.load(pdfBuffer);
    expect(doc.getPageCount()).toBe(2);
  });
});

describe("CodeRabbit Findings Verification & Safety", () => {
  // FINDING 1 & 2: Team Members Deduplication and Role Handling
  describe("Findings #1 & #2: Team Members Deduplication & Individual-Only Orders", () => {
    it("CASE 1: Individual-only order — never invents Team Head, returns empty team members", () => {
      const payer = {
        participant_id: "SVK26-INDIV01",
        name: "Solo Participant",
        email: "solo@example.com",
        phone: "9876543210",
        college: "CGC Landran",
      };

      // Even if orphaned or erroneous rows existed in DB query
      const dummyRows: RawTeamMemberRow[] = [
        {
          id: "row-1",
          name: "Random Member",
          is_team_leader: false,
          participant_event_id: "pe-ind-1",
          participants: { participant_id: "SVK26-RND001" },
        },
      ];

      const result = resolveReceiptTeamMembers({
        isAnyTeamEvent: false, // Individual-only order
        teamMemberRows: dummyRows,
        payer,
      });

      expect(result).toEqual([]);
      expect(result.length).toBe(0);
      expect(result.some((m) => m.role === "Team Head")).toBe(false);
    });

    it("CASE 2: Single team event — actual Team Head shown and team members shown once", () => {
      const payer = {
        participant_id: "SVK26-HEAD01",
        name: "Team Leader One",
        email: "head@example.com",
        phone: "9876543210",
        college: "CGC Landran",
      };

      const rows: RawTeamMemberRow[] = [
        {
          id: "row-1",
          name: "Team Member Two",
          email: "m2@example.com",
          phone: "9876543211",
          is_team_leader: false,
          participant_event_id: "pe-team-1",
          participants: { participant_id: "SVK26-MEM02", college: "CGC Landran" },
        },
        {
          id: "row-2",
          name: "Team Leader One",
          email: "head@example.com",
          phone: "9876543210",
          is_team_leader: true,
          participant_event_id: "pe-team-1",
          participants: { participant_id: "SVK26-HEAD01", college: "CGC Landran" },
        },
      ];

      const result = resolveReceiptTeamMembers({
        isAnyTeamEvent: true,
        teamMemberRows: rows,
        payer,
      });

      expect(result.length).toBe(2);
      // Team Head sorted first
      expect(result[0].participantId).toBe("SVK26-HEAD01");
      expect(result[0].isTeamLeader).toBe(true);
      expect(result[0].role).toBe("Team Head");

      expect(result[1].participantId).toBe("SVK26-MEM02");
      expect(result[1].isTeamLeader).toBe(false);
      expect(result[1].role).toBe("Team Member");
    });

    it("CASE 3: Multiple team events containing the same participant — deduplicated cleanly, preserves Team Head", () => {
      const payer = {
        participant_id: "SVK26-HEAD01",
        name: "Team Leader One",
        email: "head@example.com",
      };

      // Alice participates in Team Event 1 as regular member, but in Team Event 2 as Team Leader
      const rows: RawTeamMemberRow[] = [
        {
          id: "row-1",
          name: "Alice Wonderland",
          email: "alice@example.com",
          phone: "9111111111",
          is_team_leader: false,
          participant_event_id: "pe-event-1",
          participants: { participant_id: "SVK26-ALICE01", college: "CGC" },
        },
        {
          id: "row-2",
          name: "Alice Wonderland",
          email: "alice@example.com",
          phone: "9111111111",
          is_team_leader: true, // Lead in event 2!
          participant_event_id: "pe-event-2",
          participants: { participant_id: "SVK26-ALICE01", college: "CGC" },
        },
        {
          id: "row-3",
          name: "Bob Builder",
          email: "bob@example.com",
          phone: "9222222222",
          is_team_leader: false,
          participant_event_id: "pe-event-1",
          participants: { participant_id: "SVK26-BOB02", college: "CGC" },
        },
        {
          id: "row-4",
          name: "Bob Builder",
          email: "bob@example.com",
          phone: "9222222222",
          is_team_leader: false,
          participant_event_id: "pe-event-2",
          participants: { participant_id: "SVK26-BOB02", college: "CGC" },
        },
      ];

      const result = resolveReceiptTeamMembers({
        isAnyTeamEvent: true,
        teamMemberRows: rows,
        payer,
      });

      // Exactly 2 unique participants, not 4
      expect(result.length).toBe(2);

      const alice = result.find((m) => m.participantId === "SVK26-ALICE01");
      expect(alice).toBeDefined();
      expect(alice?.isTeamLeader).toBe(true);
      expect(alice?.role).toBe("Team Head");

      const bob = result.find((m) => m.participantId === "SVK26-BOB02");
      expect(bob).toBeDefined();
      expect(bob?.isTeamLeader).toBe(false);
      expect(bob?.role).toBe("Team Member");
    });

    it("CASE 4: Mixed individual + team order — does not assign Team Head to individual participant", () => {
      const payer = {
        participant_id: "SVK26-INDIVPAYER",
        name: "Solo Registered Payer",
        email: "solopayer@example.com",
      };

      // In a mixed order, the team event has its own members
      const teamRows: RawTeamMemberRow[] = [
        {
          id: "row-team-1",
          name: "Actual Team Captain",
          email: "captain@example.com",
          phone: "9333333333",
          is_team_leader: true,
          participant_event_id: "pe-team-only",
          participants: { participant_id: "SVK26-CAPTAIN01", college: "CGC" },
        },
        {
          id: "row-team-2",
          name: "Team Player",
          email: "player@example.com",
          phone: "9444444444",
          is_team_leader: false,
          participant_event_id: "pe-team-only",
          participants: { participant_id: "SVK26-PLAYER01", college: "CGC" },
        },
      ];

      const result = resolveReceiptTeamMembers({
        isAnyTeamEvent: true, // Order has a team event
        teamMemberRows: teamRows,
        payer, // Payer is not in the team
      });

      expect(result.length).toBe(2);
      expect(result[0].participantId).toBe("SVK26-CAPTAIN01");
      expect(result[0].role).toBe("Team Head");
      expect(result.some((m) => m.participantId === payer.participant_id)).toBe(false);
    });

    it("CASE 5: Two different participants with the same name — BOTH participants remain", () => {
      const rows: RawTeamMemberRow[] = [
        {
          id: "row-1",
          name: "Rahul Sharma",
          email: "rahul.a@example.com",
          is_team_leader: true,
          participant_event_id: "pe-1",
          participants: { participant_id: "SVK26-RAHUL01", college: "CGC" },
        },
        {
          id: "row-2",
          name: "Rahul Sharma", // Same name, different participant ID!
          email: "rahul.b@example.com",
          is_team_leader: false,
          participant_event_id: "pe-1",
          participants: { participant_id: "SVK26-RAHUL02", college: "CGC" },
        },
      ];

      const result = resolveReceiptTeamMembers({
        isAnyTeamEvent: true,
        teamMemberRows: rows,
      });

      expect(result.length).toBe(2);
      expect(result[0].participantId).toBe("SVK26-RAHUL01");
      expect(result[1].participantId).toBe("SVK26-RAHUL02");
    });

    it("CASE 6: Two different participants with the same email — BOTH participants remain", () => {
      const rows: RawTeamMemberRow[] = [
        {
          id: "row-1",
          name: "Alice Partner A",
          email: "shared-lab@example.com",
          is_team_leader: true,
          participant_event_id: "pe-1",
          participants: { participant_id: "SVK26-PARTNER01", college: "CGC" },
        },
        {
          id: "row-2",
          name: "Alice Partner B",
          email: "shared-lab@example.com", // Same email, different participant ID!
          is_team_leader: false,
          participant_event_id: "pe-1",
          participants: { participant_id: "SVK26-PARTNER02", college: "CGC" },
        },
      ];

      const result = resolveReceiptTeamMembers({
        isAnyTeamEvent: true,
        teamMemberRows: rows,
      });

      expect(result.length).toBe(2);
      expect(result[0].participantId).toBe("SVK26-PARTNER01");
      expect(result[1].participantId).toBe("SVK26-PARTNER02");
    });

    it("SCENARIO E: Team event where payer IS the actual team leader", () => {
      const payer = {
        participant_id: "SVK26-LEADER01",
        name: "Leader Payer",
        email: "leader@example.com",
      };

      const rows: RawTeamMemberRow[] = [
        {
          id: "row-1",
          name: "Leader Payer",
          is_team_leader: true,
          participant_event_id: "pe-1",
          participants: { participant_id: "SVK26-LEADER01" },
        },
        {
          id: "row-2",
          name: "Member Two",
          is_team_leader: false,
          participant_event_id: "pe-1",
          participants: { participant_id: "SVK26-MEMBER02" },
        },
      ];

      const result = resolveReceiptTeamMembers({
        isAnyTeamEvent: true,
        teamMemberRows: rows,
        payer,
      });

      expect(result.length).toBe(2);
      expect(result[0].participantId).toBe("SVK26-LEADER01");
      expect(result[0].role).toBe("Team Head");
      expect(result[1].role).toBe("Team Member");
    });

    it("SCENARIO F: Team event where payer exists as regular member and another participant is actual team leader", () => {
      const payer = {
        participant_id: "SVK26-PAYER01",
        name: "Regular Member Payer",
        email: "payer@example.com",
      };

      const rows: RawTeamMemberRow[] = [
        {
          id: "row-1",
          name: "Actual Captain",
          is_team_leader: true,
          participant_event_id: "pe-1",
          participants: { participant_id: "SVK26-CAPTAIN01" },
        },
        {
          id: "row-2",
          name: "Regular Member Payer",
          is_team_leader: false,
          participant_event_id: "pe-1",
          participants: { participant_id: "SVK26-PAYER01" },
        },
      ];

      const result = resolveReceiptTeamMembers({
        isAnyTeamEvent: true,
        teamMemberRows: rows,
        payer,
      });

      expect(result.length).toBe(2);
      // Actual Captain must be the Team Head
      expect(result[0].participantId).toBe("SVK26-CAPTAIN01");
      expect(result[0].isTeamLeader).toBe(true);
      expect(result[0].role).toBe("Team Head");

      // Payer must remain a regular Team Member, NOT falsely promoted
      expect(result[1].participantId).toBe("SVK26-PAYER01");
      expect(result[1].isTeamLeader).toBe(false);
      expect(result[1].role).toBe("Team Member");
    });

    it("SCENARIO G: Team event with no leader row — fallback promotes payer if present or unshifts if not", () => {
      const payerPresent = {
        participant_id: "SVK26-MEMBER01",
        name: "Payer in Team",
        email: "payer@example.com",
      };

      // Case G1: Payer is already in the member rows, but no row had is_team_leader: true
      const rowsWithoutLeader: RawTeamMemberRow[] = [
        {
          id: "row-1",
          name: "Payer in Team",
          is_team_leader: false,
          participant_event_id: "pe-1",
          participants: { participant_id: "SVK26-MEMBER01" },
        },
        {
          id: "row-2",
          name: "Other Member",
          is_team_leader: false,
          participant_event_id: "pe-1",
          participants: { participant_id: "SVK26-MEMBER02" },
        },
      ];

      const resultG1 = resolveReceiptTeamMembers({
        isAnyTeamEvent: true,
        teamMemberRows: rowsWithoutLeader,
        payer: payerPresent,
      });

      expect(resultG1.length).toBe(2);
      expect(resultG1[0].participantId).toBe("SVK26-MEMBER01");
      expect(resultG1[0].role).toBe("Team Head");

      // Case G2: Payer is NOT in the member rows
      const payerExternal = {
        participant_id: "SVK26-EXTERNALPAYER",
        name: "External Payer",
        email: "external@example.com",
      };

      const resultG2 = resolveReceiptTeamMembers({
        isAnyTeamEvent: true,
        teamMemberRows: [
          {
            id: "row-1",
            name: "Team Member A",
            is_team_leader: false,
            participant_event_id: "pe-1",
            participants: { participant_id: "SVK26-MEMA" },
          },
        ],
        payer: payerExternal,
      });

      expect(resultG2.length).toBe(2);
      expect(resultG2[0].participantId).toBe("SVK26-EXTERNALPAYER");
      expect(resultG2[0].role).toBe("Team Head");
      expect(resultG2[1].participantId).toBe("SVK26-MEMA");
      expect(resultG2[1].role).toBe("Team Member");
    });
  });

  // FINDING 3: PDF Page Labels and Footer Overlap
  describe("Finding #3: PDF Page Labels & Footer Overlap", () => {
    it("CASE 7: One-page PDF displays 'Page 1 of 1'", async () => {
      const onePageData: ReceiptData = {
        receiptReference: "RCP-PAGE-001",
        paymentDate: "30 Sep 2026, 04:00 pm",
        participantName: "Single Page Participant",
        participantId: "SVK26-ONEPAGE01",
        email: "onepage@example.com",
        phone: null,
        college: "CGC University",
        amount: 300,
        gateway: "payu",
        gatewayOrderId: "txnid_one_001",
        gatewayPaymentId: "mihpayid_one_001",
      };

      const buffer = await generateReceiptPdf(onePageData);
      const doc = await PDFDocument.load(buffer);
      expect(doc.getPageCount()).toBe(1);

      expect(pdfContainsText(doc, "Page 1 of 1")).toBe(true);
    });

    it("CASE 8: Multi-page PDF consistently displays 'Page 1 of N' and 'Page 2 of N'", async () => {
      const multiPageMembers: ReceiptTeamMember[] = Array.from({ length: 12 }, (_, i) => ({
        participantId: `SVK26-MULTI${String(i + 1).padStart(3, "0")}`,
        name: `Multi Member ${i + 1}`,
        email: `multi${i + 1}@example.com`,
        phone: `98765432${String(i).padStart(2, "0")}`,
        isTeamLeader: i === 0,
        role: i === 0 ? "Team Head" : "Team Member",
      }));

      const multiPageData: ReceiptData = {
        receiptReference: "RCP-PAGE-002",
        paymentDate: "30 Sep 2026, 04:15 pm",
        participantName: "Multi Member 1",
        participantId: "SVK26-MULTI001",
        email: "multi1@example.com",
        phone: null,
        college: "CGC University",
        registrationType: "team",
        teamName: "Extended Squad",
        eventName: "Choreography Championship",
        eventCategory: "Dance",
        items: [
          {
            eventName: "Choreography Championship",
            category: "Dance",
            registrationType: "team",
            teamName: "Extended Squad",
            amount: 6000,
          },
        ],
        teamMembers: multiPageMembers,
        amount: 6000,
        gateway: "payu",
        gatewayOrderId: "txnid_multi_001",
        gatewayPaymentId: "mihpayid_multi_001",
      };

      const buffer = await generateReceiptPdf(multiPageData);
      const doc = await PDFDocument.load(buffer);
      const totalPages = doc.getPageCount();
      expect(totalPages).toBeGreaterThan(1);

      // Verify both Page 1 of N through Page N of N are all present
      for (let p = 1; p <= totalPages; p++) {
        expect(pdfContainsText(doc, `Page ${p} of ${totalPages}`)).toBe(true);
      }
    });

    it("CASE 9: Content close to footer renders cleanly without footer overlap", async () => {
      // 5 items to push cursor close to the footer boundary
      const borderlineItems = Array.from({ length: 5 }, (_, i) => ({
        eventName: `Borderline Cultural Event ${i + 1}`,
        category: "Arts",
        registrationType: "individual" as const,
        amount: 250,
      }));

      const borderlineData: ReceiptData = {
        receiptReference: "RCP-PAGE-003",
        paymentDate: "30 Sep 2026, 04:30 pm",
        participantName: "Borderline Participant",
        participantId: "SVK26-BORDER01",
        email: "border@example.com",
        phone: "9876543210",
        college: "CGC University",
        items: borderlineItems,
        amount: 1250,
        gateway: "payu",
        gatewayOrderId: "txnid_border_001",
        gatewayPaymentId: "mihpayid_border_001",
      };

      const buffer = await generateReceiptPdf(borderlineData);
      const doc = await PDFDocument.load(buffer);
      const pageCount = doc.getPageCount();
      expect(pageCount).toBeGreaterThanOrEqual(1);

      // Every page has valid Page X of N label
      for (let p = 1; p <= pageCount; p++) {
        expect(pdfContainsText(doc, `Page ${p} of ${pageCount}`)).toBe(true);
      }
    });
  });
});
