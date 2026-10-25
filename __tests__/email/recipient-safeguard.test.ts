import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock QRCode before importing modules
vi.mock("qrcode", () => ({
  default: {
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("mock-qr")),
  },
}));

// Mock Resend
const mockSend = vi.fn();
vi.mock("resend", () => {
  return {
    Resend: class {
      emails = {
        send: mockSend,
      };
    },
  };
});

// Mock email-sender for OTP
vi.mock("@/lib/email-sender", () => ({
  getEmailSender: vi.fn(() => ({
    success: true,
    from: "Saviskar 2026 <no-reply@saviskar.cgc.ac.in>",
  })),
}));

import {
  sendRegistrationEmail,
  isTestRecipientGuardActive,
} from "@/lib/send-registration-email";
import {
  sendOtpEmail,
  isTestRecipientGuardActive as isOtpGuardActive,
} from "@/lib/auth/send-otp-email";

describe("Email Recipient Safeguard & Environment-Aware Routing", () => {
  const originalEnv = { ...process.env };
  const setNodeEnv = (val: string) => {
    (process.env as Record<string, string | undefined>).NODE_ENV = val;
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockSend.mockReset();
    process.env = { ...originalEnv };
    delete process.env.E2E_EMAIL_TRANSPORT;
    delete process.env.MAILPIT_API_URL;
    delete process.env.ENABLE_TEST_RECIPIENT_GUARD;
    delete process.env.APPROVED_TEST_EMAIL;
    process.env.RESEND_API_KEY = "re_test_key_mock";
    process.env.RESEND_FROM_EMAIL = "Saviskar 2026 <no-reply@saviskar.cgc.ac.in>";
  });

  afterEach(() => {
    mockSend.mockReset();
    process.env = { ...originalEnv };
  });

  describe("Guard Activation Logic (isTestRecipientGuardActive)", () => {
    it("is INACTIVE in production by default when no test guard flag is set", () => {
      setNodeEnv("production");
      delete process.env.ENABLE_TEST_RECIPIENT_GUARD;
      delete process.env.APPROVED_TEST_EMAIL;

      expect(isTestRecipientGuardActive()).toBe(false);
      expect(isOtpGuardActive()).toBe(false);
    });

    it("prevents accidental test mode in production: APPROVED_TEST_EMAIL alone does NOT trigger test mode in production", () => {
      setNodeEnv("production");
      delete process.env.ENABLE_TEST_RECIPIENT_GUARD;
      process.env.APPROVED_TEST_EMAIL = "jashan.cgcu@gmail.com";

      expect(isTestRecipientGuardActive()).toBe(false);
      expect(isOtpGuardActive()).toBe(false);
    });

    it("activates in production ONLY when ENABLE_TEST_RECIPIENT_GUARD='true' is explicitly set", () => {
      setNodeEnv("production");
      process.env.ENABLE_TEST_RECIPIENT_GUARD = "true";
      process.env.APPROVED_TEST_EMAIL = "jashan.cgcu@gmail.com";

      expect(isTestRecipientGuardActive()).toBe(true);
      expect(isOtpGuardActive()).toBe(true);
    });

    it("activates in non-production when APPROVED_TEST_EMAIL is provided", () => {
      setNodeEnv("development");
      delete process.env.ENABLE_TEST_RECIPIENT_GUARD;
      process.env.APPROVED_TEST_EMAIL = "jashan.cgcu@gmail.com";

      expect(isTestRecipientGuardActive()).toBe(true);
      expect(isOtpGuardActive()).toBe(true);
    });

    it("activates in non-production when ENABLE_TEST_RECIPIENT_GUARD='true' is set", () => {
      setNodeEnv("test");
      process.env.ENABLE_TEST_RECIPIENT_GUARD = "true";

      expect(isTestRecipientGuardActive()).toBe(true);
      expect(isOtpGuardActive()).toBe(true);
    });
  });

  describe("sendRegistrationEmail behavior", () => {
    const baseRegistrationData = {
      participantId: "SVK26-12345678",
      eventName: "Roborace Championship",
      name: "Normal Participant",
      college: "CGC Landran",
      email: "real.student@cgc.edu.in",
      phone: "+919876543210",
    };

    it("delivers normally to legitimate recipient when safeguard is disabled (production)", async () => {
      setNodeEnv("production");
      delete process.env.ENABLE_TEST_RECIPIENT_GUARD;
      delete process.env.APPROVED_TEST_EMAIL;

      mockSend.mockResolvedValueOnce({
        data: { id: "msg_prod_123" },
        error: null,
      });

      const result = await sendRegistrationEmail(baseRegistrationData);

      expect(result.success).toBe(true);
      expect(result.emailsSent).toBe(1);
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ["real.student@cgc.edu.in"],
        })
      );
    });

    it("delivers to multiple team members normally when safeguard is disabled", async () => {
      setNodeEnv("production");
      delete process.env.ENABLE_TEST_RECIPIENT_GUARD;
      delete process.env.APPROVED_TEST_EMAIL;

      mockSend
        .mockResolvedValueOnce({ data: { id: "msg_team_1" }, error: null })
        .mockResolvedValueOnce({ data: { id: "msg_team_2" }, error: null });

      const teamData = {
        ...baseRegistrationData,
        isTeamEvent: true,
        isTeamHead: true,
        members: [
          {
            participantId: "SVK26-TEAMMATE1",
            name: "Teammate One",
            college: "CGC Landran",
            email: "teammate1@cgc.edu.in",
          },
        ],
      };

      const result = await sendRegistrationEmail(teamData);

      expect(result.success).toBe(true);
      expect(result.emailsSent).toBe(2);
      expect(mockSend).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ to: ["real.student@cgc.edu.in"] })
      );
      expect(mockSend).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ to: ["teammate1@cgc.edu.in"] })
      );
    });

    it("fails closed when guard is enabled but APPROVED_TEST_EMAIL is missing", async () => {
      process.env.ENABLE_TEST_RECIPIENT_GUARD = "true";
      delete process.env.APPROVED_TEST_EMAIL;

      const result = await sendRegistrationEmail(baseRegistrationData);

      expect(result.success).toBe(false);
      expect(result.emailsSent).toBe(0);
      expect(mockSend).not.toHaveBeenCalled();
      expect(result.error).toContain("test recipient safeguard is active");
    });

    it("fails closed when guard is enabled but APPROVED_TEST_EMAIL does not match hardcoded address", async () => {
      process.env.ENABLE_TEST_RECIPIENT_GUARD = "true";
      process.env.APPROVED_TEST_EMAIL = "unauthorized.tester@example.com";

      const result = await sendRegistrationEmail(baseRegistrationData);

      expect(result.success).toBe(false);
      expect(result.emailsSent).toBe(0);
      expect(mockSend).not.toHaveBeenCalled();
      expect(result.error).toContain("unauthorized");
    });

    it("suppresses non-approved recipients when guard is enabled with authorized configuration", async () => {
      process.env.ENABLE_TEST_RECIPIENT_GUARD = "true";
      process.env.APPROVED_TEST_EMAIL = "jashan.cgcu@gmail.com";

      // Attempting to send to a non-approved address
      const result = await sendRegistrationEmail({
        ...baseRegistrationData,
        email: "other.student@cgc.edu.in",
      });

      expect(result.success).toBe(false);
      expect(result.emailsSent).toBe(0);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("dispatches only to approved tester address when guard is active", async () => {
      process.env.ENABLE_TEST_RECIPIENT_GUARD = "true";
      process.env.APPROVED_TEST_EMAIL = "jashan.cgcu@gmail.com";

      mockSend.mockResolvedValueOnce({
        data: { id: "msg_test_123" },
        error: null,
      });

      const result = await sendRegistrationEmail({
        ...baseRegistrationData,
        email: "jashan.cgcu@gmail.com",
      });

      expect(result.success).toBe(true);
      expect(result.emailsSent).toBe(1);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ["jashan.cgcu@gmail.com"],
        })
      );
    });

    it("handles 403 domain unverified fallback retry and preserves recipient address", async () => {
      setNodeEnv("production");
      delete process.env.ENABLE_TEST_RECIPIENT_GUARD;
      delete process.env.APPROVED_TEST_EMAIL;

      // First call fails with 403 domain is not verified
      mockSend
        .mockResolvedValueOnce({
          data: null,
          error: { statusCode: 403, message: "domain is not verified" },
        })
        .mockResolvedValueOnce({
          data: { id: "msg_fallback_456" },
          error: null,
        });

      const result = await sendRegistrationEmail(baseRegistrationData);

      expect(result.success).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          from: "Saviskar 2026 <onboarding@resend.dev>",
          to: ["real.student@cgc.edu.in"],
        })
      );
    });
  });

  describe("sendOtpEmail behavior", () => {
    it("delivers OTP normally to legitimate user when safeguard is disabled (production)", async () => {
      setNodeEnv("production");
      delete process.env.ENABLE_TEST_RECIPIENT_GUARD;
      delete process.env.APPROVED_TEST_EMAIL;

      mockSend.mockResolvedValueOnce({
        data: { id: "otp_prod_msg_1" },
        error: null,
      });

      const result = await sendOtpEmail("real.student@cgc.edu.in", "123456");

      expect(result.success).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ["real.student@cgc.edu.in"],
        })
      );
    });

    it("fails closed when guard is enabled and APPROVED_TEST_EMAIL is missing", async () => {
      process.env.ENABLE_TEST_RECIPIENT_GUARD = "true";
      delete process.env.APPROVED_TEST_EMAIL;

      const result = await sendOtpEmail("jashan.cgcu@gmail.com", "123456");

      expect(result.success).toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
      expect(result.error).toContain("safeguard is active");
    });

    it("fails closed when guard is enabled and recipient is unauthorized", async () => {
      process.env.ENABLE_TEST_RECIPIENT_GUARD = "true";
      process.env.APPROVED_TEST_EMAIL = "jashan.cgcu@gmail.com";

      const result = await sendOtpEmail("random.user@gmail.com", "123456");

      expect(result.success).toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
      expect(result.error).toContain("safeguard is active");
    });

    it("dispatches OTP only to authorized tester address when guard is active", async () => {
      process.env.ENABLE_TEST_RECIPIENT_GUARD = "true";
      process.env.APPROVED_TEST_EMAIL = "jashan.cgcu@gmail.com";

      mockSend.mockResolvedValueOnce({
        data: { id: "otp_test_msg_99" },
        error: null,
      });

      const result = await sendOtpEmail("jashan.cgcu@gmail.com", "654321");

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("otp_test_msg_99");
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ["jashan.cgcu@gmail.com"],
        })
      );
    });
  });
});
