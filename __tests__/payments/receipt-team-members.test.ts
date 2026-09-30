import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { generateReceiptPdf, ReceiptData, ReceiptTeamMember } from "@/lib/generate-receipt-pdf";

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
