import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isTestEmailTransportActive,
  sendViaTestTransport,
} from "@/lib/email/test-transport";
import { sendOtpEmail } from "@/lib/auth/send-otp-email";
import { sendRegistrationEmail } from "@/lib/send-registration-email";

describe("SAVISKAR 2026 — Isolated Mailpit Test Transport Invariants", () => {
  const originalEnv = { ...process.env };

  const setNodeEnv = (val: string) => {
    (process.env as Record<string, string | undefined>).NODE_ENV = val;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Activation Safety Invariants", () => {
    it("fails closed in production environment even if variables are set", () => {
      setNodeEnv("production");
      process.env.E2E_EMAIL_TRANSPORT = "mailpit";
      process.env.ENABLE_TEST_RECIPIENT_GUARD = "true";
      process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
      process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
      process.env.PAYMENT_CALLBACK_BASE_URL = "http://localhost:3000";

      expect(isTestEmailTransportActive()).toBe(false);
    });

    it("fails closed when E2E_EMAIL_TRANSPORT is not mailpit", () => {
      setNodeEnv("test");
      delete process.env.E2E_EMAIL_TRANSPORT;
      process.env.ENABLE_TEST_RECIPIENT_GUARD = "true";
      process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
      process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
      process.env.PAYMENT_CALLBACK_BASE_URL = "http://localhost:3000";

      expect(isTestEmailTransportActive()).toBe(false);
    });

    it("fails closed when ENABLE_TEST_RECIPIENT_GUARD is not true", () => {
      setNodeEnv("test");
      process.env.E2E_EMAIL_TRANSPORT = "mailpit";
      process.env.ENABLE_TEST_RECIPIENT_GUARD = "false";
      process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
      process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
      process.env.PAYMENT_CALLBACK_BASE_URL = "http://localhost:3000";

      expect(isTestEmailTransportActive()).toBe(false);
    });

    it("fails closed when SUPABASE_URL points to remote or production host", () => {
      setNodeEnv("test");
      process.env.E2E_EMAIL_TRANSPORT = "mailpit";
      process.env.ENABLE_TEST_RECIPIENT_GUARD = "true";
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://ikavnyjfmdxjnlbovkzm.supabase.co";
      process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
      process.env.PAYMENT_CALLBACK_BASE_URL = "http://localhost:3000";

      expect(isTestEmailTransportActive()).toBe(false);
    });

    it("activates only when all isolated local conditions are met", () => {
      setNodeEnv("test");
      process.env.E2E_EMAIL_TRANSPORT = "mailpit";
      process.env.ENABLE_TEST_RECIPIENT_GUARD = "true";
      process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
      process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
      process.env.PAYMENT_CALLBACK_BASE_URL = "http://localhost:3000";

      expect(isTestEmailTransportActive()).toBe(true);
    });
  });

  describe("Recipient Safeguards in Test Transport", () => {
    beforeEach(() => {
      setNodeEnv("test");
      process.env.E2E_EMAIL_TRANSPORT = "mailpit";
      process.env.ENABLE_TEST_RECIPIENT_GUARD = "true";
      process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
      process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
      process.env.PAYMENT_CALLBACK_BASE_URL = "http://localhost:3000";
      process.env.APPROVED_TEST_EMAIL = "jashan.cgcu@gmail.com";
    });

    it("suppresses sending to any recipient other than the authorized test mailbox", async () => {
      const result = await sendViaTestTransport({
        from: "Saviskar 2026 <noreply@saviskar.co.in>",
        to: "unauthorized.student@gmail.com",
        subject: "Security check",
        html: "<p>Restricted</p>",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Recipient not permitted");
    });

    it("suppresses sending if APPROVED_TEST_EMAIL does not match hardcoded recipient", async () => {
      process.env.APPROVED_TEST_EMAIL = "attacker@example.com";

      const result = await sendViaTestTransport({
        from: "Saviskar 2026 <noreply@saviskar.co.in>",
        to: "jashan.cgcu@gmail.com",
        subject: "Security check",
        html: "<p>Restricted</p>",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Recipient not permitted");
    });
  });

  describe("Integration with sendOtpEmail and sendRegistrationEmail", () => {
    beforeEach(() => {
      setNodeEnv("test");
      process.env.E2E_EMAIL_TRANSPORT = "mailpit";
      process.env.ENABLE_TEST_RECIPIENT_GUARD = "true";
      process.env.APPROVED_TEST_EMAIL = "jashan.cgcu@gmail.com";
      process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
      process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
      process.env.PAYMENT_CALLBACK_BASE_URL = "http://localhost:3000";
      process.env.RESEND_FROM_EMAIL = "Saviskar 2026 <noreply@saviskar.co.in>";
      delete process.env.RESEND_API_KEY; // Verify Resend key is completely absent
    });

    it("sendOtpEmail dispatches via test transport without requiring RESEND_API_KEY", async () => {
      const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ID: "test-mailpit-otp-msg-123" }),
      } as Response);

      const result = await sendOtpEmail("jashan.cgcu@gmail.com", "123456");

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("test-mailpit-otp-msg-123");
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toContain("54324/api/v1/send");
      const body = JSON.parse(callArgs[1]?.body as string);
      expect(body.To[0].Email).toBe("jashan.cgcu@gmail.com");
      expect(body.Subject).toContain("Saviskar 2026 verification code");
    });

    it("sendRegistrationEmail delivers PDF receipt attachment via test transport", async () => {
      const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ID: "test-mailpit-receipt-msg-456" }),
      } as Response);

      const samplePdfBuffer = Buffer.from("%PDF-1.4 Mock Receipt Buffer");

      const result = await sendRegistrationEmail({
        participantId: "SVK26-ABC99999",
        eventName: "Accommodation Booking",
        eventCategory: "accommodation",
        name: "Test Participant",
        college: "CGC Landran",
        email: "jashan.cgcu@gmail.com",
        phone: "9876543210",
        requiresPayment: true,
        receiptPdf: {
          filename: "Saviskar-2026-Receipt-SVK26-ABC99999.pdf",
          buffer: samplePdfBuffer,
        },
        accommodationDetails: [
          {
            planName: "1 Day Accommodation",
            participantName: "Test Participant",
            dates: "28–29 Oct 2026",
            amount: 499,
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.emailsSent).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string);
      expect(body.To[0].Email).toBe("jashan.cgcu@gmail.com");
      expect(body.Subject).toContain("Payment Confirmed — Saviskar 2026");
      expect(body.Attachments).toBeDefined();
      expect(body.Attachments.length).toBeGreaterThanOrEqual(1);

      const pdfAttachment = body.Attachments.find(
        (att: { Filename: string }) => att.Filename.endsWith(".pdf")
      );
      expect(pdfAttachment).toBeDefined();
      expect(pdfAttachment.Filename).toBe("Saviskar-2026-Receipt-SVK26-ABC99999.pdf");
      expect(pdfAttachment.Content).toBe(samplePdfBuffer.toString("base64"));
    });
  });
});
