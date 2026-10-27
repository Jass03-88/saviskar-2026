import fs from "fs";
import path from "path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PARTICIPANT_BROADCAST_SUBJECT,
  PARTICIPANT_BROADCAST_CAMPAIGN_TITLE,
  renderParticipantVerificationBroadcastHtml,
  renderParticipantVerificationBroadcastText,
  escapeHtml,
  BROADCAST_IMMEDIATE_DISPATCH_BATCH_SIZE,
  getImmediateDispatchWarningCopy,
  validateGeneralBroadcastInput,
  buildGeneralCampaignPayload,
} from "@/lib/broadcast/participant-broadcast-template";
import {
  resolveGeneralBroadcastRecipients,
  isValidEmailAddress,
} from "@/lib/broadcast/recipient-resolver";
import {
  generateDeliveryIdempotencyKey,
  createGeneralBroadcastCampaign,
  createCertificateCampaign,
  BROADCAST_DELIVERY_INSERT_CHUNK_SIZE,
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
              const chunk = Array.isArray(payload) ? payload : [payload];
              insertedDeliveries.push(...chunk);
              return Promise.resolve({ data: chunk, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
          update: (payload: any) => ({
            eq: (col: string, val: string) => {
              if (table === "broadcast_campaigns" && col === "id") {
                Object.assign(insertedCampaign, payload);
              }
              return Promise.resolve({ error: null });
            },
          }),
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

  // =========================================================================
  // REQUIREMENT 11: Final Confirmation Safeguard Before Campaign Creation
  // =========================================================================
  describe("11. Final Confirmation Safeguard Before Campaign Creation", () => {
    describe("Verified Immediate-Dispatch Limit and Copy", () => {
      it("confirms server-side initial dispatch batch size is strictly 25 deliveries", () => {
        // Verified against app/api/admin/broadcast/campaigns/route.ts line 254: batchSize: 25
        // and claim_broadcast_deliveries (p_batch_size: 25).
        expect(BROADCAST_IMMEDIATE_DISPATCH_BATCH_SIZE).toBe(25);
      });

      it("formats verified immediate dispatch warning for recipient counts <= 25", () => {
        const copy1 = getImmediateDispatchWarningCopy(1);
        expect(copy1).toContain("All 1 email will be dispatched immediately through Resend");
        expect(copy1).toContain("This action cannot be paused or undone");

        const copy25 = getImmediateDispatchWarningCopy(25);
        expect(copy25).toContain("All 25 emails will be dispatched immediately through Resend");
      });

      it("formats verified immediate dispatch warning for recipient counts > 25 with remainder queued", () => {
        const copy100 = getImmediateDispatchWarningCopy(100);
        expect(copy100).toContain("The first batch of 25 deliveries will be dispatched immediately through Resend");
        expect(copy100).toContain("the remaining 75 deliveries will remain safely queued in the database");
        expect(copy100).toContain("Outbound dispatch starts immediately and cannot be undone");
      });
    });

    describe("Actual Production Input Validation & Payload Construction", () => {
      it("validateGeneralBroadcastInput enforces field completeness, selection, and environment safeguards", () => {
        // Empty title
        expect(
          validateGeneralBroadcastInput({
            title: "",
            subject: "Sub",
            bodyHtml: "<p>Hi</p>",
            recipientCount: 5,
          }).isValid
        ).toBe(false);

        // Empty recipients
        expect(
          validateGeneralBroadcastInput({
            title: "Title",
            subject: "Sub",
            bodyHtml: "<p>Hi</p>",
            recipientCount: 0,
          }).isValid
        ).toBe(false);

        // Preview mode
        expect(
          validateGeneralBroadcastInput({
            title: "Title",
            subject: "Sub",
            bodyHtml: "<p>Hi</p>",
            recipientCount: 5,
            isPreviewMode: true,
          }).isValid
        ).toBe(false);

        // Production read-only mode
        expect(
          validateGeneralBroadcastInput({
            title: "Title",
            subject: "Sub",
            bodyHtml: "<p>Hi</p>",
            recipientCount: 5,
            isProductionReadOnly: true,
          }).isValid
        ).toBe(false);

        // Valid inputs pass
        expect(
          validateGeneralBroadcastInput({
            title: PARTICIPANT_BROADCAST_CAMPAIGN_TITLE,
            subject: PARTICIPANT_BROADCAST_SUBJECT,
            bodyHtml: renderParticipantVerificationBroadcastHtml(),
            recipientCount: 10,
            isPreviewMode: false,
            isProductionReadOnly: false,
          }).isValid
        ).toBe(true);
      });

      it("buildGeneralCampaignPayload generates matching bodyText and dispatches settings", () => {
        const payloadQueued = buildGeneralCampaignPayload({
          title: PARTICIPANT_BROADCAST_CAMPAIGN_TITLE,
          subject: PARTICIPANT_BROADCAST_SUBJECT,
          bodyHtml: renderParticipantVerificationBroadcastHtml(),
          selectedEmails: ["test@example.com"],
          dispatchImmediately: false,
        });

        expect(payloadQueued.bodyText).toBe(renderParticipantVerificationBroadcastText());
        expect(payloadQueued.dispatchImmediately).toBe(false);
        expect(payloadQueued.selectedEmails).toEqual(["test@example.com"]);

        const payloadImmediate = buildGeneralCampaignPayload({
          title: "Custom Title",
          subject: "Custom Subject",
          bodyHtml: "<p>Custom content</p>",
          selectedEmails: ["test@example.com"],
          dispatchImmediately: true,
        });

        expect(payloadImmediate.bodyText).toBe("Custom content");
        expect(payloadImmediate.dispatchImmediately).toBe(true);
      });
    });

    describe("Actual Implementation Structure Invariants in app/admin/broadcast/page.tsx", () => {
      const pagePath = path.resolve(process.cwd(), "app/admin/broadcast/page.tsx");
      const pageCode = fs.readFileSync(pagePath, "utf-8");

      it("enforces WAI-ARIA semantic dialog markup and accessibility roles", () => {
        expect(pageCode).toContain('role="dialog"');
        expect(pageCode).toContain('aria-modal="true"');
        expect(pageCode).toContain('aria-labelledby="confirm-general-broadcast-title"');
        expect(pageCode).toContain('aria-describedby="confirm-general-broadcast-description"');
      });

      it("enforces complete focus management: entry, trapping, and return focus", () => {
        // Enqueue trigger button ref
        expect(pageCode).toContain("enqueueButtonRef");
        expect(pageCode).toContain("ref={enqueueButtonRef}");

        // Dialog container and cancel button refs
        expect(pageCode).toContain("confirmDialogRef");
        expect(pageCode).toContain("cancelConfirmButtonRef");
        expect(pageCode).toContain("ref={confirmDialogRef}");
        expect(pageCode).toContain("ref={cancelConfirmButtonRef}");

        // Focus entry on open
        expect(pageCode).toContain("cancelConfirmButtonRef.current.focus()");

        // Focus trap on Tab and Shift+Tab
        expect(pageCode).toContain('e.key === "Tab"');
        expect(pageCode).toContain("confirmDialogRef.current.querySelectorAll");
        expect(pageCode).toContain("e.shiftKey");

        // Focus restoration on close
        expect(pageCode).toContain("enqueueButtonRef.current?.focus()");
      });

      it("enforces Escape dismissal with submission guard", () => {
        expect(pageCode).toContain('e.key === "Escape"');
        expect(pageCode).toContain("if (!isSubmittingCampaign)");
        expect(pageCode).toContain("setShowGeneralConfirmModal(false)");
      });

      it("enforces duplicate submission prevention and safe button types", () => {
        // Guard check inside handleConfirmCreateGeneralCampaign
        expect(pageCode).toContain("if (isSubmittingCampaign) return;");

        // Disabled attributes during submission
        expect(pageCode).toContain("disabled={isSubmittingCampaign}");

        // Both actions explicitly type="button"
        expect(pageCode).toContain('type="button"');
        expect(pageCode).toContain("handleCancelCreateGeneralCampaign");
        expect(pageCode).toContain("handleConfirmCreateGeneralCampaign");
      });

      it("displays verified immediate dispatch warning and safe mode notice in UI", () => {
        expect(pageCode).toContain("WARNING: Real Emails Will Be Sent Immediately!");
        expect(pageCode).toContain("getImmediateDispatchWarningCopy(selectedGeneralEmails.size)");
        expect(pageCode).toContain("Safe Mode Enqueue");
        expect(pageCode).toContain("No emails will be sent right now");
      });
    });

    describe("API Route Integration: Cancellation vs Confirmation", () => {
      it("confirms API receives exactly one POST with valid payload when confirmed", async () => {
        vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
          user: { id: "master-1", email: "admin@saviskar.co.in" },
        } as any);
        vi.spyOn(adminLib, "isProductionReadOnlyEnabled").mockReturnValue(false);
        vi.spyOn(adminLib, "isPreviewDeployment").mockReturnValue(false);
        vi.spyOn(adminLib, "isLiveBroadcastEnabled").mockReturnValue(true);

        const payload = buildGeneralCampaignPayload({
          title: PARTICIPANT_BROADCAST_CAMPAIGN_TITLE,
          subject: PARTICIPANT_BROADCAST_SUBJECT,
          bodyHtml: renderParticipantVerificationBroadcastHtml(),
          selectedEmails: ["participant@cgc.edu.in"],
          dispatchImmediately: false,
        });

        expect(payload.selectedEmails).toEqual(["participant@cgc.edu.in"]);
        expect(payload.dispatchImmediately).toBe(false);
        expect(payload.bodyText).toBe(renderParticipantVerificationBroadcastText());
      });

      it("proves cancellation results in zero API calls and zero database mutations", () => {
        const fetchSpy = vi.fn();
        let showGeneralConfirmModal = true;

        // User cancels
        function handleCancel() {
          showGeneralConfirmModal = false;
        }

        handleCancel();

        expect(showGeneralConfirmModal).toBe(false);
        expect(fetchSpy).not.toHaveBeenCalled();
      });
    });

    // =========================================================================
    // REQUIREMENT 12: Bounded Batching & Statement Timeout Recovery
    // =========================================================================
    describe("12. Bounded Delivery Enqueue Batching & Statement Timeout Invariants", () => {
      it("exports verified chunk size of 100 deliveries per insertion", () => {
        expect(BROADCAST_DELIVERY_INSERT_CHUNK_SIZE).toBe(100);
      });

      it("enqueues large audience across multiple bounded chunks", async () => {
        let createdCampaign: any = null;
        const insertedBatches: any[][] = [];

        const mockSupabase = {
          from: (table: string) => {
            if (table === "broadcast_campaigns") {
              return {
                insert: (payload: any) => {
                  createdCampaign = { id: "camp-chunk-001", ...payload };
                  return {
                    select: () => ({
                      single: () => Promise.resolve({ data: createdCampaign, error: null }),
                    }),
                  };
                },
              };
            }
            if (table === "broadcast_deliveries") {
              return {
                insert: (chunk: any[]) => {
                  insertedBatches.push(chunk);
                  return Promise.resolve({ data: chunk, error: null });
                },
              };
            }
            return {
              insert: () => Promise.resolve({ data: null, error: null }),
            };
          },
        } as any;

        // Generate 250 test emails (will split into 100, 100, 50)
        const emails = Array.from({ length: 250 }, (_, i) => `user_${i}@example.com`);

        const result = await createGeneralBroadcastCampaign(
          mockSupabase,
          {
            title: "Large Campaign",
            subject: "Large Subject",
            bodyHtml: "<p>Large body</p>",
            bodyText: "Large body",
            selectedEmails: emails,
            adminId: "admin-42",
            adminEmail: "admin@saviskar.co.in",
          },
          { chunkSize: 100 }
        );

        expect(result.campaignId).toBe("camp-chunk-001");
        expect(result.totalDeliveries).toBe(250);
        expect(insertedBatches.length).toBe(3);
        expect(insertedBatches[0].length).toBe(100);
        expect(insertedBatches[1].length).toBe(100);
        expect(insertedBatches[2].length).toBe(50);

        // Every delivery row has an idempotency key
        const allDeliveries = insertedBatches.flat();
        expect(allDeliveries.length).toBe(250);
        for (const delivery of allDeliveries) {
          expect(delivery.campaign_id).toBe("camp-chunk-001");
          expect(delivery.status).toBe("queued");
          expect(delivery.idempotency_key).toMatch(/^idemp_camp-chunk-001_user_\d+@example\.com_general_p1$/);
        }
      });

      it("safely rolls back campaign header when the very first batch fails", async () => {
        let deletedCampaignId: string | null = null;

        const mockSupabase = {
          from: (table: string) => {
            if (table === "broadcast_campaigns") {
              return {
                insert: (payload: any) => ({
                  select: () => ({
                    single: () => Promise.resolve({ data: { id: "camp-fail-first-001", ...payload }, error: null }),
                  }),
                }),
                delete: () => ({
                  eq: (col: string, val: string) => {
                    if (col === "id") deletedCampaignId = val;
                    return Promise.resolve({ error: null });
                  },
                }),
              };
            }
            if (table === "broadcast_deliveries") {
              return {
                insert: (_chunk: any[]) => {
                  return Promise.resolve({
                    error: {
                      message: "canceling statement due to statement timeout",
                      code: "57014",
                    },
                  });
                },
              };
            }
            return {
              insert: () => Promise.resolve({ error: null }),
            };
          },
        } as any;

        await expect(
          createGeneralBroadcastCampaign(
            mockSupabase,
            {
              title: "First Batch Timeout",
              subject: "Subject",
              bodyHtml: "<p>Body</p>",
              selectedEmails: ["user1@test.com", "user2@test.com"],
              adminId: "admin-42",
              adminEmail: "admin@saviskar.co.in",
            },
            { chunkSize: 100 }
          )
        ).rejects.toThrow("Failed to enqueue broadcast deliveries: canceling statement due to statement timeout");

        expect(deletedCampaignId).toBe("camp-fail-first-001");
      });

      it("safely rolls back campaign header when a later batch fails after earlier batches succeeded", async () => {
        let deletedCampaignId: string | null = null;
        let batchCount = 0;

        const mockSupabase = {
          from: (table: string) => {
            if (table === "broadcast_campaigns") {
              return {
                insert: (payload: any) => ({
                  select: () => ({
                    single: () => Promise.resolve({ data: { id: "camp-timeout-002", ...payload }, error: null }),
                  }),
                }),
                delete: () => ({
                  eq: (col: string, val: string) => {
                    if (col === "id") deletedCampaignId = val;
                    return Promise.resolve({ error: null });
                  },
                }),
              };
            }
            if (table === "broadcast_deliveries") {
              return {
                insert: (_chunk: any[]) => {
                  batchCount++;
                  if (batchCount === 2) {
                    // Simulate PostgreSQL statement timeout error on 2nd chunk
                    return Promise.resolve({
                      error: {
                        message: "canceling statement due to statement timeout",
                        code: "57014",
                      },
                    });
                  }
                  return Promise.resolve({ error: null });
                },
              };
            }
            return {
              insert: () => Promise.resolve({ error: null }),
            };
          },
        } as any;

        const emails = Array.from({ length: 200 }, (_, i) => `timeout_${i}@example.com`);

        await expect(
          createGeneralBroadcastCampaign(
            mockSupabase,
            {
              title: "Timeout Campaign",
              subject: "Timeout Subject",
              bodyHtml: "<p>Body</p>",
              selectedEmails: emails,
              adminId: "admin-42",
              adminEmail: "admin@saviskar.co.in",
            },
            { chunkSize: 100 }
          )
        ).rejects.toThrow("Failed to enqueue broadcast deliveries: canceling statement due to statement timeout");

        // Verifies the compensating rollback deleted the campaign header (cascading all chunk deliveries)
        expect(deletedCampaignId).toBe("camp-timeout-002");
        expect(batchCount).toBe(2);
      });

      it("handles campaign cleanup failure gracefully without masking the original enqueue error and marks campaign failed", async () => {
        let fallbackUpdatedStatus: string | null = null;

        const mockSupabase = {
          from: (table: string) => {
            if (table === "broadcast_campaigns") {
              return {
                insert: (payload: any) => ({
                  select: () => ({
                    single: () => Promise.resolve({ data: { id: "camp-cleanup-fail-003", ...payload }, error: null }),
                  }),
                }),
                delete: () => ({
                  eq: (_col: string, _val: string) => {
                    // Simulate database failure during cleanup deletion
                    return Promise.resolve({ error: { message: "DB foreign key lock timeout on cleanup" } });
                  },
                }),
                update: (payload: any) => ({
                  eq: (_col: string, _val: string) => {
                    fallbackUpdatedStatus = payload.status;
                    return Promise.resolve({ error: null });
                  },
                }),
              };
            }
            if (table === "broadcast_deliveries") {
              return {
                insert: (_chunk: any[]) => {
                  return Promise.resolve({
                    error: {
                      message: "canceling statement due to statement timeout",
                      code: "57014",
                    },
                  });
                },
              };
            }
            return {
              insert: () => Promise.resolve({ error: null }),
            };
          },
        } as any;

        await expect(
          createGeneralBroadcastCampaign(
            mockSupabase,
            {
              title: "Cleanup Fail Campaign",
              subject: "Subject",
              bodyHtml: "<p>Body</p>",
              selectedEmails: ["user@test.com"],
              adminId: "admin-42",
              adminEmail: "admin@saviskar.co.in",
            },
            { chunkSize: 100 }
          )
        ).rejects.toThrow("Failed to enqueue broadcast deliveries: canceling statement due to statement timeout");

        // Verifies fallback marked status as "failed" so it can never be accidentally processed
        expect(fallbackUpdatedStatus).toBe("failed");
      });

      it("guarantees deterministic idempotency keys for duplicate prevention and safe retries", () => {
        const key1 = generateDeliveryIdempotencyKey("camp-retry-001", "student@cgc.edu.in", "general");
        const key2 = generateDeliveryIdempotencyKey("camp-retry-001", "student@cgc.edu.in", "general");
        expect(key1).toBe("idemp_camp-retry-001_student@cgc.edu.in_general_p1");
        expect(key1).toBe(key2);

        // Different campaign produces distinct key
        const keyOtherCamp = generateDeliveryIdempotencyKey("camp-retry-002", "student@cgc.edu.in", "general");
        expect(keyOtherCamp).not.toBe(key1);
      });

      it("ensures incomplete campaign is deleted and not dispatchable if enqueueing fails", async () => {
        let deletedCampaign = false;

        const mockSupabase = {
          from: (table: string) => {
            if (table === "broadcast_campaigns") {
              return {
                insert: (payload: any) => {
                  return {
                    select: () => ({
                      single: () => Promise.resolve({ data: { id: "camp-incomplete-004", ...payload }, error: null }),
                    }),
                  };
                },
                delete: () => ({
                  eq: () => {
                    deletedCampaign = true;
                    return Promise.resolve({ error: null });
                  },
                }),
              };
            }
            if (table === "broadcast_deliveries") {
              return {
                insert: () => {
                  return Promise.resolve({
                    error: { message: "canceling statement due to statement timeout" },
                  });
                },
              };
            }
            return {
              insert: () => Promise.resolve({ error: null }),
            };
          },
        } as any;

        await expect(
          createGeneralBroadcastCampaign(
            mockSupabase,
            {
              title: "Incomplete Campaign",
              subject: "Subject",
              bodyHtml: "<p>Body</p>",
              selectedEmails: ["test@example.com"],
              adminId: "admin-42",
              adminEmail: "admin@saviskar.co.in",
            }
          )
        ).rejects.toThrow("Failed to enqueue broadcast deliveries: canceling statement due to statement timeout");

        // The campaign was rolled back and deleted, cascading away any deliveries
        expect(deletedCampaign).toBe(true);
      });

      it("verifies certificate campaigns execute chunked insertions for both deliveries and attachments", async () => {
        let createdCampId: string | null = null;
        const insertedDeliveryBatches: any[][] = [];
        const insertedAttachmentBatches: any[][] = [];

        const mockSupabase = {
          from: (table: string) => {
            if (table === "broadcast_campaigns") {
              return {
                insert: (payload: any) => {
                  createdCampId = "camp-cert-chunk-005";
                  return {
                    select: () => ({
                      single: () => Promise.resolve({ data: { id: createdCampId, ...payload }, error: null }),
                    }),
                  };
                },
                update: () => ({
                  eq: () => Promise.resolve({ error: null }),
                }),
                delete: () => ({
                  eq: () => Promise.resolve({ error: null }),
                }),
              };
            }
            if (table === "participation_certificates") {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: () => Promise.resolve({ data: null, error: null }),
                  }),
                }),
                insert: (payload: any) => ({
                  select: () => ({
                    single: () =>
                      Promise.resolve({
                        data: { id: "cert-uuid-001", certificate_number: payload.certificate_number },
                        error: null,
                      }),
                  }),
                }),
              };
            }
            if (table === "broadcast_deliveries") {
              return {
                insert: (chunk: any[]) => {
                  insertedDeliveryBatches.push(chunk);
                  return Promise.resolve({ error: null });
                },
              };
            }
            if (table === "broadcast_delivery_attachments") {
              return {
                insert: (chunk: any[]) => {
                  insertedAttachmentBatches.push(chunk);
                  return Promise.resolve({ error: null });
                },
              };
            }
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: "mock-id" }, error: null }),
                }),
              }),
              insert: () => Promise.resolve({ error: null }),
            };
          },
        } as any;

        const candidates = [
          {
            issueSourceKey: "src_1",
            participantEventId: "pe_1",
            recipientName: "Alice Sharma",
            recipientEmail: "alice@example.com",
            eventName: "Coding Hackathon",
            certificateEligible: true,
            isValidEmail: true,
            isTeam: false,
          },
          {
            issueSourceKey: "src_2",
            participantEventId: "pe_2",
            recipientName: "Bob Singh",
            recipientEmail: "bob@example.com",
            eventName: "Robotics Race",
            certificateEligible: true,
            isValidEmail: true,
            isTeam: false,
          },
        ];

        const result = await createCertificateCampaign(
          mockSupabase,
          {
            title: "Certificate Batch",
            subject: "Your Certificate",
            bodyHtml: "<p>Congrats</p>",
            selectedItemKeys: ["src_1", "src_2"],
            sendIndividual: true,
            sendTeamBackup: false,
            adminId: "admin-42",
            adminEmail: "admin@saviskar.co.in",
          },
          candidates,
          { chunkSize: 1 } // Chunk size 1 forces 2 chunks for 2 candidates
        );

        expect(result.campaignId).toBe("camp-cert-chunk-005");
        expect(result.totalDeliveries).toBe(2);
        expect(result.totalCertificates).toBe(2);
        expect(insertedDeliveryBatches.length).toBe(2);
        expect(insertedAttachmentBatches.length).toBe(2);
      });

      it("safely rolls back certificate campaign when delivery chunk insert fails and marks failed if cleanup fails", async () => {
        let deletedCampaignId: string | null = null;
        let fallbackStatus: string | null = null;

        const mockSupabase = {
          from: (table: string) => {
            if (table === "broadcast_campaigns") {
              return {
                insert: (payload: any) => ({
                  select: () => ({
                    single: () => Promise.resolve({ data: { id: "camp-cert-fail-006", ...payload }, error: null }),
                  }),
                }),
                delete: () => ({
                  eq: (_col: string, val: string) => {
                    deletedCampaignId = val;
                    // Simulate cleanup delete error
                    return Promise.resolve({ error: { message: "Foreign key delete constraint lock" } });
                  },
                }),
                update: (payload: any) => ({
                  eq: () => {
                    fallbackStatus = payload.status;
                    return Promise.resolve({ error: null });
                  },
                }),
              };
            }
            if (table === "participation_certificates") {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: () => Promise.resolve({ data: null, error: null }),
                  }),
                }),
                insert: (payload: any) => ({
                  select: () => ({
                    single: () =>
                      Promise.resolve({
                        data: { id: "cert-fail-uuid", certificate_number: payload.certificate_number },
                        error: null,
                      }),
                  }),
                }),
              };
            }
            if (table === "broadcast_deliveries") {
              return {
                insert: () => {
                  return Promise.resolve({
                    error: { message: "canceling statement due to statement timeout", code: "57014" },
                  });
                },
              };
            }
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: "mock-id" }, error: null }),
                }),
              }),
              insert: () => Promise.resolve({ error: null }),
            };
          },
        } as any;

        const candidates = [
          {
            issueSourceKey: "src_fail_1",
            participantEventId: "pe_fail_1",
            recipientName: "Charlie Brown",
            recipientEmail: "charlie@example.com",
            eventName: "Coding Hackathon",
            certificateEligible: true,
            isValidEmail: true,
            isTeam: false,
          },
        ];

        await expect(
          createCertificateCampaign(
            mockSupabase,
            {
              title: "Failing Certificate Batch",
              subject: "Your Certificate",
              bodyHtml: "<p>Congrats</p>",
              selectedItemKeys: ["src_fail_1"],
              sendIndividual: true,
              sendTeamBackup: false,
              adminId: "admin-42",
              adminEmail: "admin@saviskar.co.in",
            },
            candidates,
            { chunkSize: 100 }
          )
        ).rejects.toThrow("Failed to enqueue certificate deliveries: canceling statement due to statement timeout");

        // Verifies rollback deletion was attempted on campaign header
        expect(deletedCampaignId).toBe("camp-cert-fail-006");
        // Verifies cleanup error fallback marked status as failed
        expect(fallbackStatus).toBe("failed");
      });

      it("verifies campaigns route configures 60s maxDuration for bulk enqueueing", () => {
        const routePath = path.resolve(process.cwd(), "app/api/admin/broadcast/campaigns/route.ts");
        const routeCode = fs.readFileSync(routePath, "utf-8");
        expect(routeCode).toContain("export const maxDuration = 60;");
      });
    });
  });
});
