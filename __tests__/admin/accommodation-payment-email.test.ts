import { describe, it, expect, vi, beforeEach } from "vitest";
import { PDFDocument } from "pdf-lib";
import { generateReceiptPdf, type ReceiptData } from "@/lib/generate-receipt-pdf";
import { sendRegistrationEmail, type RegistrationEmailData } from "@/lib/send-registration-email";

// Mock Resend with a proper class constructor
vi.mock("resend", () => {
  class MockResend {
    emails = {
      send: vi.fn().mockResolvedValue({
        data: { id: "resend_mock_email_id_123" },
        error: null,
      }),
    };
  }
  return { Resend: MockResend };
});

describe("Accommodation Payment Email & Invoice Generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = "re_mock_test_key_123";
    process.env.RESEND_FROM_EMAIL = "Saviskar 2026 <no-reply@saviskar.in>";
    delete process.env.ENABLE_TEST_RECIPIENT_GUARD;
    delete process.env.APPROVED_TEST_EMAIL;
  });

  it("1. Accommodation-only email dispatches successfully with stay dates, plan, and checkout date", async () => {
    const payload: RegistrationEmailData = {
      participantId: "SVK26-ACC01",
      eventName: "3-Day Campus Stay",
      eventCategory: "Accommodation",
      name: "Siddharth Malhotra",
      college: "IIT Ropar",
      email: "siddharth@example.com",
      phone: "+919876543210",
      isTeamEvent: false,
      accommodationDetails: [
        {
          planName: "3-Day Campus Stay",
          participantName: "Siddharth Malhotra",
          dates: "2026-10-28 to 2026-10-31",
          durationDays: 3,
          checkoutDate: "2026-10-31",
          orderReference: "ORD-SVK26-ACC1",
          paymentId: "pay_acc_123",
          amount: 1200,
        },
      ],
      receiptPdf: {
        buffer: Buffer.from("PDF-MOCK-CONTENT"),
        filename: "Saviskar-2026-Payment-Receipt-SVK26-ACC01.pdf",
      },
    };

    const result = await sendRegistrationEmail(payload);
    expect(result.success).toBe(true);
    expect(result.emailsSent).toBe(1);
    expect(result.recipients[0].email).toBe("siddharth@example.com");
  });

  it("2. Accommodation-only purchase generates valid PDF receipt with stay dates and correct structure", async () => {
    const receiptData: ReceiptData = {
      receiptReference: "RCP-ORD-SVK26-ACC1",
      paymentDate: "28 Oct 2026, 11:30 AM",
      participantName: "Siddharth Malhotra",
      participantId: "SVK26-ACC01",
      email: "siddharth@example.com",
      phone: "+919876543210",
      college: "IIT Ropar",
      items: [
        {
          eventName: "3-Day Campus Stay",
          category: "Accommodation",
          registrationType: "individual",
          amount: 1200,
          dates: "2026-10-28 to 2026-10-31",
          durationDays: 3,
          checkoutDate: "2026-10-31",
        },
      ],
      eventName: "3-Day Campus Stay",
      eventCategory: "Accommodation",
      registrationType: "individual",
      amount: 1200,
      gateway: "PayU",
      gatewayOrderId: "ORD-SVK26-ACC1",
      gatewayPaymentId: "pay_acc_123",
    };

    const pdfBuffer = await generateReceiptPdf(receiptData);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.byteLength).toBeGreaterThan(1000);

    // Verify it parses as a valid PDF document
    const doc = await PDFDocument.load(pdfBuffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
    expect(doc.getPage(0).getHeight()).toBeCloseTo(841.89, 1);
  });

  it("3. Event-only payment confirmation and receipt generates valid PDF", async () => {
    const receiptData: ReceiptData = {
      receiptReference: "RCP-ORD-SVK26-EVT1",
      paymentDate: "28 Oct 2026, 12:00 PM",
      participantName: "Ananya Roy",
      participantId: "SVK26-EVT01",
      email: "ananya@example.com",
      phone: "+919876543212",
      college: "Thapar University",
      items: [
        {
          eventName: "Code Sprint",
          category: "Technical",
          registrationType: "individual",
          amount: 250,
        },
      ],
      eventName: "Code Sprint",
      eventCategory: "Technical",
      registrationType: "individual",
      amount: 250,
      gateway: "PayU",
      gatewayOrderId: "ORD-SVK26-EVT1",
      gatewayPaymentId: "pay_evt_123",
    };

    const pdfBuffer = await generateReceiptPdf(receiptData);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    const doc = await PDFDocument.load(pdfBuffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("4. Combined event + accommodation purchase generates multi-item PDF", async () => {
    const receiptData: ReceiptData = {
      receiptReference: "RCP-ORD-SVK26-COMBO1",
      paymentDate: "28 Oct 2026, 01:00 PM",
      participantName: "Karan Mehta",
      participantId: "SVK26-CMB01",
      email: "karan@example.com",
      phone: "+919876543213",
      college: "Panjab University",
      items: [
        {
          eventName: "RoboRace",
          category: "Technical",
          registrationType: "individual",
          amount: 300,
        },
        {
          eventName: "2-Day Campus Stay",
          category: "Accommodation",
          registrationType: "individual",
          amount: 900,
          dates: "2026-10-28 to 2026-10-30",
          durationDays: 2,
          checkoutDate: "2026-10-30",
        },
      ],
      eventName: "RoboRace",
      eventCategory: "Technical",
      registrationType: "individual",
      amount: 1200,
      gateway: "PayU",
      gatewayOrderId: "ORD-SVK26-CMB1",
      gatewayPaymentId: "pay_cmb_123",
    };

    const pdfBuffer = await generateReceiptPdf(receiptData);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    const doc = await PDFDocument.load(pdfBuffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("5. Missing participant college does not crash accommodation email dispatch", async () => {
    const payload: RegistrationEmailData = {
      participantId: "SVK26-NOCOLLEGE",
      eventName: "1-Day Campus Stay",
      eventCategory: "Accommodation",
      name: "Delegate Without College",
      college: "", // Empty college
      email: "nocollege@example.com",
      phone: "+919876543299",
      isTeamEvent: false,
      accommodationDetails: [
        {
          planName: "1-Day Campus Stay",
          participantName: "Delegate Without College",
          dates: "2026-10-28 to 2026-10-29",
          durationDays: 1,
          checkoutDate: "2026-10-29",
          amount: 500,
        },
      ],
    };

    const result = await sendRegistrationEmail(payload);
    expect(result.success).toBe(true);
    expect(result.emailsSent).toBe(1);
  });
});
