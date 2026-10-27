import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PARTICIPANT_BROADCAST_SUBJECT,
  PARTICIPANT_BROADCAST_CAMPAIGN_TITLE,
  renderParticipantVerificationBroadcastHtml,
  renderParticipantVerificationBroadcastText,
  escapeHtml,
} from "@/lib/broadcast/participant-broadcast-template";
import {
  resolveGeneralBroadcastRecipients,
  isValidEmailAddress,
} from "@/lib/broadcast/recipient-resolver";
import {
  generateDeliveryIdempotencyKey,
  createGeneralBroadcastCampaign,
} from "@/lib/broadcast/campaign-worker";
import { getCampaignEmailSender } from "@/lib/email/campaign-service";
import { CANONICAL_SENDER_EMAIL } from "@/lib/email-sender";
import * as serverLib from "@/lib/supabase/server";
import * as adminLib from "@/lib/broadcast/supabase-admin";
import { POST as postCampaignsRoute } from "@/app/api/admin/broadcast/campaigns/route";
import { NextRequest } from "next/server";

describe("Saviskar 2K26 — Participant Verification Broadcast Email Invariants", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Helper to create mock Supabase client adhering to the schema joins in recipient-resolver
  function createMockSupabase(
    peRows: any[] = [],
    memberRows: any[] = [],
    accRows: any[] = []
  ) {
    return {
      from: (table: string) => {
        if (table === "participant_events") {
          const createQuery = () => {
            const p: any = {
              eq: (col: string, val: any) => {
                return {
                  range: (from: number, to: number) => {
                    const filtered = peRows.filter((r) => r[col] === val);
                    const slice = filtered.slice(from, to + 1);
                    return Promise.resolve({ data: slice, error: null });
                  },
                };
              },
              range: (from: number, to: number) => {
                const slice = peRows.slice(from, to + 1);
                return Promise.resolve({ data: slice, error: null });
              },
            };
            return p;
          };
          return {
            select: () => createQuery(),
          };
        }
        if (table === "participant_event_members") {
          const createQuery = () => {
            const p: any = {
              range: (from: number, to: number) => {
                const slice = memberRows.slice(from, to + 1);
                return Promise.resolve({ data: slice, error: null });
              },
            };
            return p;
          };
          return {
            select: () => createQuery(),
          };
        }
        if (table === "participant_accommodations") {
          const createQuery = () => {
            const p: any = {
              neq: (col: string, val: any) => {
                return {
                  range: (from: number, to: number) => {
                    const filtered = accRows.filter((r) => r[col] !== val);
                    const slice = filtered.slice(from, to + 1);
                    return Promise.resolve({ data: slice, error: null });
                  },
                };
              },
            };
            return p;
          };
          return {
            select: () => createQuery(),
          };
        }
        return {
          select: () => ({
            range: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      },
    } as any;
  }

  // =========================================================================
  // REQUIREMENT 1: Branded Black-and-White Email Rendering
  // =========================================================================
  describe("1. Branded Black-and-White Email Rendering", () => {
    it("renders the black hero header, white content card, and neutral background canvas", () => {
      const html = renderParticipantVerificationBroadcastHtml();

      // Outer canvas neutral background
      expect(html).toContain("background: #f3f3f3");
      // Black hero header container
      expect(html).toContain("background: #050505");
      // White content card
      expect(html).toContain("background: #ffffff");
      // Subtle dividers
      expect(html).toContain("border-top: 1px solid #eeeeee");
      // Card items
      expect(html).toContain("background: #fafafa");
      expect(html).toContain("border: 1px solid #eeeeee");
    });

    it("does not contain illegal decorative colors (bottle green, gold, neon, or gradients)", () => {
      const html = renderParticipantVerificationBroadcastHtml();

      // Forbidden color keywords / schemes
      expect(html.toLowerCase()).not.toContain("gold");
      expect(html.toLowerCase()).not.toContain("golden");
      expect(html.toLowerCase()).not.toContain("linear-gradient");
      expect(html.toLowerCase()).not.toContain("radial-gradient");
      expect(html.toLowerCase()).not.toContain("#004d40"); // bottle green
      expect(html.toLowerCase()).not.toContain("#064e3b"); // dark emerald / green
      expect(html.toLowerCase()).not.toContain("#d97706"); // amber / gold
      expect(html.toLowerCase()).not.toContain("#ffd700"); // gold
    });

    it("uses email-client-compatible table structure with inline styling", () => {
      const html = renderParticipantVerificationBroadcastHtml();

      expect(html).toContain('width="100%"');
      expect(html).toContain('cellpadding="0"');
      expect(html).toContain('cellspacing="0"');
      expect(html).toContain("max-width: 620px");
      expect(html).toContain("Arial, Helvetica, sans-serif");
    });
  });

  // =========================================================================
  // REQUIREMENT 2: HTML Escaping & Safe Content Handling
  // =========================================================================
  describe("2. HTML Escaping and Safe Handling", () => {
    it("neutralizes HTML tags and special characters in escapeHtml", () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe(
        "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
      );
      expect(escapeHtml("Participant & Guest's Pass")).toBe(
        "Participant &amp; Guest&#039;s Pass"
      );
    });

    it("escapes dynamic participant name overrides safely", () => {
      const maliciousName = '<img src=x onerror=alert(1)> "Admin" & Friends';
      const html = renderParticipantVerificationBroadcastHtml({
        participantName: maliciousName,
      });

      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; &quot;Admin&quot; &amp; Friends");
    });
  });

  // =========================================================================
  // REQUIREMENT 3: Responsive Structure & Complete Document Checklist
  // =========================================================================
  describe("3. Responsive Structure and Complete Document Checklist", () => {
    it("contains the exact 3 required document checklist items", () => {
      const html = renderParticipantVerificationBroadcastHtml();

      // Heading
      expect(html).toContain("Important: Documents Required.");
      expect(html).toContain("DOCUMENTS REQUIRED");

      // Item 1: Valid ID Proof
      expect(html).toContain("1. Valid ID Proof");
      expect(html).toContain("Aadhaar Card, College/University ID Card, or PAN Card");

      // Item 2: Passport-Size Photograph
      expect(html).toContain("2. Passport-Size Photograph");
      expect(html).toContain("Carry one recent passport-size photograph.");

      // Item 3: Printed Documents
      expect(html).toContain("3. Printed Documents");
      expect(html).toContain("Carry a hard copy of your ID proof and payment receipt, if applicable.");

      // Desk verification banner
      expect(html).toContain("IMPORTANT: VERIFICATION AT THE REGISTRATION DESK");
      expect(html).toContain(
        "Please keep your applicable documents ready and present them to the verification team at the registration desk upon arrival."
      );
    });

    it("does not mention mandatory paid registration or unsupported fee demands", () => {
      const html = renderParticipantVerificationBroadcastHtml();
      const text = renderParticipantVerificationBroadcastText();

      // Ensure no claims that all participants must have paid
      expect(html).not.toContain("must pay");
      expect(html).not.toContain("all participants must have paid");
      expect(text).not.toContain("must pay");
    });
  });

  // =========================================================================
  // REQUIREMENT 4: Correct Subject, Title, and Signatures
  // =========================================================================
  describe("4. Correct Subject, Title, and Signatures", () => {
    it("exports exact approved subject and campaign title constants", () => {
      expect(PARTICIPANT_BROADCAST_SUBJECT).toBe(
        "Important: Documents Required for SAVISKAR 2K26 Verification"
      );
      expect(PARTICIPANT_BROADCAST_CAMPAIGN_TITLE).toBe(
        "SAVISKAR 2K26 – Participant Document Verification Instructions"
      );
    });

    it("includes the official team signature and university affiliation in both HTML and text", () => {
      const html = renderParticipantVerificationBroadcastHtml();
      const text = renderParticipantVerificationBroadcastText();

      expect(html).toContain("Team SAVISKAR 2K26");
      expect(html).toContain("CGC University, Mohali");

      expect(text).toContain("Team SAVISKAR 2K26");
      expect(text).toContain("CGC University, Mohali");
      expect(text).toContain("DOCUMENTS REQUIRED");
      expect(text).toContain("1. Valid ID Proof");
      expect(text).toContain("2. Passport-Size Photograph");
      expect(text).toContain("3. Printed Documents");
    });
  });

  // =========================================================================
  // REQUIREMENT 5: Recipient Pagination and Deduplication (2,000+ Audience)
  // =========================================================================
  describe("5. Recipient Resolution, Pagination & Deduplication", () => {
    it("deduplicates identical emails across event registrants, team members, and accommodations", async () => {
      // Mock Supabase client returning schema-joined records
      const mockPeRows = [
        {
          id: "pe-1",
          is_archived: false,
          team_name: "CodeWarriors",
          participants: { id: "p-1", name: "Student One", email: "student@cgc.edu.in" },
        },
        {
          id: "pe-2",
          is_archived: false,
          team_name: "ByteBusters",
          participants: { id: "p-2", name: "Student One Upper", email: "STUDENT@CGC.EDU.IN " },
        },
      ];
      const mockMemberRows = [
        {
          id: "m-1",
          email: "student@cgc.edu.in",
          name: "Student Member",
          participant_event_id: "pe-1",
          participant_events: { id: "pe-1", is_archived: false, team_name: "CodeWarriors" },
        },
        {
          id: "m-2",
          email: "teammate@college.ac.in",
          name: "Teammate",
          participant_event_id: "pe-1",
          participant_events: { id: "pe-1", is_archived: false, team_name: "CodeWarriors" },
        },
      ];
      const mockAccRows = [
        {
          id: "a-1",
          status: "confirmed",
          participants: { id: "p-1", name: "Student Accommodation", email: "student@cgc.edu.in" },
        },
      ];

      const mockClient = createMockSupabase(mockPeRows, mockMemberRows, mockAccRows);
      const recipients = await resolveGeneralBroadcastRecipients(mockClient);

      // student@cgc.edu.in appeared 4 times across 3 tables with different casings
      // Teammate appeared once
      expect(recipients.length).toBe(2);

      const primary = recipients.find((r) => r.normalizedEmail === "student@cgc.edu.in");
      expect(primary).toBeDefined();
      expect(primary?.sources).toContain("event");
      expect(primary?.sources).toContain("team_member");
      expect(primary?.sources).toContain("accommodation");
    });

    it("paginates past 1000 records without hitting PostgREST 1000-row truncate limit", async () => {
      // Generate 2,200 synthetic distinct records
      const TOTAL_ROWS = 2200;
      const syntheticRows = Array.from({ length: TOTAL_ROWS }, (_, i) => ({
        id: `pe-${i}`,
        is_archived: false,
        team_name: `Team ${i}`,
        participants: {
          id: `p-${i}`,
          name: `Participant ${i}`,
          email: `participant_${i}@domain.com`,
        },
      }));

      const mockClient = createMockSupabase(syntheticRows, [], []);
      const recipients = await resolveGeneralBroadcastRecipients(mockClient);
      expect(recipients.length).toBe(TOTAL_ROWS);
    });
  });

  // =========================================================================
  // REQUIREMENT 6: Suppression and Eligibility Preservation
  // =========================================================================
  describe("6. Suppression & Eligibility Preservation", () => {
    it("excludes archived event registrations and cancelled accommodations", async () => {
      const mockPeRows = [
        {
          id: "pe-archived",
          is_archived: true,
          team_name: "Archived Team",
          participants: { id: "p-arch", name: "Archived Student", email: "archived@cgc.edu.in" },
        },
        {
          id: "pe-active",
          is_archived: false,
          team_name: "Active Team",
          participants: { id: "p-act", name: "Active Student", email: "active@cgc.edu.in" },
        },
      ];
      const mockAccRows = [
        {
          id: "acc-cancelled",
          status: "cancelled",
          participants: { id: "p-canc", name: "Cancelled Acc", email: "cancelled@cgc.edu.in" },
        },
        {
          id: "acc-active",
          status: "confirmed",
          participants: { id: "p-acc", name: "Active Acc", email: "acc_active@cgc.edu.in" },
        },
      ];

      const mockClient = createMockSupabase(mockPeRows, [], mockAccRows);
      const recipients = await resolveGeneralBroadcastRecipients(mockClient);
      const emails = recipients.map((r) => r.normalizedEmail);

      expect(emails).toContain("active@cgc.edu.in");
      expect(emails).toContain("acc_active@cgc.edu.in");
      expect(emails).not.toContain("archived@cgc.edu.in");
      expect(emails).not.toContain("cancelled@cgc.edu.in");
    });

    it("flags invalid email addresses while preserving valid ones", () => {
      expect(isValidEmailAddress("valid.participant@cgc.edu.in")).toBe(true);
      expect(isValidEmailAddress("no-at-sign.com")).toBe(false);
      expect(isValidEmailAddress("spaces in@email.com")).toBe(false);
      expect(isValidEmailAddress("")).toBe(false);
    });

    it("strictly isolates campaign broadcast sender from transactional sender", () => {
      const broadcastSender = getCampaignEmailSender();
      const transactionalSender = CANONICAL_SENDER_EMAIL;

      // Transactional sender is noreply@saviskar.co.in
      expect(transactionalSender).toContain("Saviskar 2026");
      expect(transactionalSender).toContain("noreply@saviskar.co.in");
      // Campaign sender is broadcast@updates.saviskar.co.in
      expect(broadcastSender.success).toBe(true);
      expect(broadcastSender.from).toContain("Saviskar Updates");
      expect(broadcastSender.from).toContain("broadcast@updates.saviskar.co.in");
      expect(broadcastSender.from).not.toEqual(transactionalSender);
    });
  });

  // =========================================================================
  // REQUIREMENT 7: Batch Limits, Retry Safety, and Idempotency
  // =========================================================================
  describe("7. Batch Limits, Retry Safety and Idempotency", () => {
    it("generates deterministic delivery idempotency keys", () => {
      const normalizedEmail = "participant@cgc.edu.in";
      const key1 = generateDeliveryIdempotencyKey(
        "camp-100",
        normalizedEmail,
        "individual"
      );
      const key2 = generateDeliveryIdempotencyKey(
        "camp-100",
        normalizedEmail,
        "individual"
      );
      const differentChannel = generateDeliveryIdempotencyKey(
        "camp-100",
        normalizedEmail,
        "team_backup"
      );

      expect(key1).toBe(key2);
      expect(key1).not.toBe(differentChannel);
      expect(key1.length).toBeGreaterThan(16);
      expect(key1).toContain("camp-100");
      expect(key1).toContain("participant@cgc.edu.in");
    });
  });

  // =========================================================================
  // REQUIREMENT 8: Protection Against Unauthorized Dispatch
  // =========================================================================
  describe("8. Authorization and Safe Mode Protections", () => {
    it("denies campaign creation when caller lacks master admin privileges", async () => {
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
        error: "FORBIDDEN",
        status: 403,
      } as any);

      const request = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns", {
        method: "POST",
        body: JSON.stringify({
          title: PARTICIPANT_BROADCAST_CAMPAIGN_TITLE,
          subject: PARTICIPANT_BROADCAST_SUBJECT,
          bodyHtml: renderParticipantVerificationBroadcastHtml(),
          campaignType: "general",
          selectedEmails: ["test@example.com"],
        }),
      });

      const response = await postCampaignsRoute(request);
      expect(response.status).toBe(403);
    });

    it("blocks campaign mutations in Production Read-Only Mode", async () => {
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
        user: { id: "master-1", email: "admin@saviskar.co.in" },
      } as any);
      vi.spyOn(adminLib, "isProductionReadOnlyEnabled").mockReturnValue(true);

      const request = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns", {
        method: "POST",
        body: JSON.stringify({
          title: PARTICIPANT_BROADCAST_CAMPAIGN_TITLE,
          subject: PARTICIPANT_BROADCAST_SUBJECT,
          bodyHtml: renderParticipantVerificationBroadcastHtml(),
          campaignType: "general",
          selectedEmails: ["test@example.com"],
        }),
      });

      const response = await postCampaignsRoute(request);
      const json = await response.json();

      expect(response.status).toBe(403);
      expect(json.code).toBe("PRODUCTION_READONLY_MODE_MUTATION_DENIED");
    });
  });

  // =========================================================================
  // REQUIREMENT 9: Campaign Queue & History Regression Behavior
  // =========================================================================
  describe("9. Campaign Creation and Storage Invariants", () => {
    it("creates campaign with queued status and stores body_html along with body_text", async () => {
      let insertedCampaign: any = null;
      let insertedDeliveries: any[] = [];

      const mockSupabase = {
        from: (table: string) => ({
          insert: (payload: any) => {
            if (table === "broadcast_campaigns") {
              insertedCampaign = { id: "camp-doc-123", ...payload };
              return {
                select: () => ({
                  single: () => Promise.resolve({ data: insertedCampaign, error: null }),
                }),
              };
            }
            if (table === "broadcast_deliveries") {
              insertedDeliveries = Array.isArray(payload) ? payload : [payload];
              return Promise.resolve({ data: insertedDeliveries, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      } as any;

      const html = renderParticipantVerificationBroadcastHtml();
      const text = renderParticipantVerificationBroadcastText();

      const result = await createGeneralBroadcastCampaign(mockSupabase, {
        title: PARTICIPANT_BROADCAST_CAMPAIGN_TITLE,
        subject: PARTICIPANT_BROADCAST_SUBJECT,
        bodyHtml: html,
        bodyText: text,
        selectedEmails: ["participant1@domain.com", "participant2@domain.com"],
        adminId: "admin-42",
        adminEmail: "admin@saviskar.co.in",
      });

      expect(result.campaignId).toBe("camp-doc-123");
      expect(result.totalDeliveries).toBe(2);
      expect(insertedCampaign.status).toBe("queued");
      expect(insertedCampaign.body_html).toBe(html);
      expect(insertedCampaign.body_text).toBe(text);
      expect(insertedDeliveries.length).toBe(2);
      expect(insertedDeliveries[0].status).toBe("queued");
    });
  });

  // =========================================================================
  // REQUIREMENT 10: Preservation of Existing Transactional & Payment Templates
  // =========================================================================
  describe("10. Preservation of Registration and Payment Templates", () => {
    it("does not leak registration-specific dynamic variables or QR codes into the broadcast template", () => {
      const html = renderParticipantVerificationBroadcastHtml();

      // Ensure no transactional tokens exist
      expect(html).not.toContain("data:image/png;base64"); // QR code data URI
      expect(html).not.toContain("{{qrCode}}");
      expect(html).not.toContain("{{participantId}}");
      expect(html).not.toContain("{{paymentId}}");
      expect(html).not.toContain("{{amount}}");
      expect(html).not.toContain("PAYMENT SUCCESSFUL");
      expect(html).not.toContain("Payment Status:");
    });
  });
});
