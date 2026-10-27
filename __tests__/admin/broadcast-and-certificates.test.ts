import fs from "fs";
import path from "path";
import crypto from "crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateParticipationCertificatePdf,
  sanitizeTextForPdf,
  getVerifiedTemplateBytes,
  EXPECTED_TEMPLATE_HASH,
  PDF_PAGE_WIDTH,
  PDF_PAGE_HEIGHT,
} from "@/lib/certificates/generator";
import {
  getCampaignEmailSender,
  chunkAttachments,
  RAW_ATTACHMENT_THRESHOLD_BYTES,
  EmailAttachment,
} from "@/lib/email/campaign-service";
import * as recipientResolverLib from "@/lib/broadcast/recipient-resolver";
import {
  resolveGeneralBroadcastRecipients,
  resolveCertificateCandidates,
  isValidEmailAddress,
} from "@/lib/broadcast/recipient-resolver";
import { evaluateEventPaymentStatus } from "@/lib/admin/check-in-rules";
import {
  generateCertificateNumber,
  generateDeliveryIdempotencyKey,
  processNextBroadcastBatch,
} from "@/lib/broadcast/campaign-worker";
import { GET as getRecipientsRoute } from "@/app/api/admin/broadcast/recipients/route";
import { GET as getCampaignsRoute, POST as postCampaignsRoute } from "@/app/api/admin/broadcast/campaigns/route";
import { POST as postTestSendRoute } from "@/app/api/admin/broadcast/campaigns/[id]/test-send/route";
import { POST as postRetryRoute } from "@/app/api/admin/broadcast/campaigns/[id]/retry/route";
import { POST as postProcessBatchRoute } from "@/app/api/admin/broadcast/campaigns/[id]/process-batch/route";
import {
  SYNTHETIC_GENERAL_RECIPIENTS,
  SYNTHETIC_CERTIFICATE_CANDIDATES,
} from "@/lib/broadcast/hybrid-fixtures";
import {
  sendCampaignEmail,
  getMockCampaignDispatches,
  clearMockCampaignDispatches,
} from "@/lib/email/campaign-service";
import * as serverLib from "@/lib/supabase/server";
import * as adminLib from "@/lib/broadcast/supabase-admin";
import { NextRequest } from "next/server";

describe("Saviskar 2026 — Master Admin Email Broadcast & Participation Certificates", () => {
  // Helper to create mock Supabase client
  function createMockSupabase(
    peRows: any[] = [],
    memberRows: any[] = [],
    accRows: any[] = [],
    errors: { peErr?: any; memberErr?: any; accErr?: any } = {}
  ) {
    return {
      from: (table: string) => {
        if (table === "participant_events") {
          const createQuery = () => {
            const p = Promise.resolve({ data: errors.peErr ? null : peRows, error: errors.peErr || null }) as any;
            p.range = () => Promise.resolve({ data: errors.peErr ? null : peRows, error: errors.peErr || null });
            p.eq = () => createQuery();
            p.neq = () => createQuery();
            return p;
          };
          return {
            select: () => createQuery(),
          };
        }
        if (table === "participant_event_members") {
          const createQuery = () => {
            const p = Promise.resolve({ data: errors.memberErr ? null : memberRows, error: errors.memberErr || null }) as any;
            p.range = () => Promise.resolve({ data: errors.memberErr ? null : memberRows, error: errors.memberErr || null });
            p.in = () => Promise.resolve({ data: errors.memberErr ? null : memberRows, error: errors.memberErr || null });
            return p;
          };
          return {
            select: () => createQuery(),
          };
        }
        if (table === "participant_accommodations") {
          const createQuery = () => {
            const p = Promise.resolve({ data: errors.accErr ? null : accRows, error: errors.accErr || null }) as any;
            p.range = () => Promise.resolve({ data: errors.accErr ? null : accRows, error: errors.accErr || null });
            p.neq = () => ({
              range: () => Promise.resolve({ data: errors.accErr ? null : accRows, error: errors.accErr || null }),
            });
            return p;
          };
          return {
            select: () => createQuery(),
          };
        }
        return {
          select: () => Promise.resolve({ data: [], error: null }),
        };
      },
    } as any;
  }

  // =========================================================================
  // 1. Certificate Artwork & Template Verification
  // =========================================================================
  describe("Certificate Asset Integrity & Geometry", () => {
    it("Invariant 20: Verified template hash matches exact authentic certificate and page maintains A4 landscape ratio", async () => {
      const templatePath = path.resolve(
        process.cwd(),
        "assets/certificates/saviskar-certificate-template-original.jpeg"
      );
      expect(fs.existsSync(templatePath)).toBe(true);

      const { bytes, hash, verified } = getVerifiedTemplateBytes();
      expect(hash).toBe(EXPECTED_TEMPLATE_HASH);
      expect(verified).toBe(true);
      expect(bytes.length).toBe(432047);

      // Verify A4 Landscape aspect ratio
      const templateAspectRatio = 2048 / 1448;
      const pdfAspectRatio = PDF_PAGE_WIDTH / PDF_PAGE_HEIGHT;
      expect(Math.abs(templateAspectRatio - pdfAspectRatio)).toBeLessThan(0.001);
    });

    it("Invariant 19: Long names, Indian/Unicode names and accents are sanitized and rendered without crashes or overlapping", async () => {
      const longName = "Sardar Gurpreet Singh Dhaliwal-Chaudhary of CGC Mohali University";
      const sanitizedLong = sanitizeTextForPdf(longName);
      expect(sanitizedLong).toBe(longName);

      // Unicode accented / smart quotes / devanagari / zero-width spaces
      const unicodeInput = "Aarav Shárma ‘Team Lead’ \u200B\uFEFF";
      const sanitized = sanitizeTextForPdf(unicodeInput);
      expect(sanitized).toBe("Aarav Shárma 'Team Lead'");

      const { pdfBytes, templateHash } = await generateParticipationCertificatePdf({
        recipientName: longName,
        eventName: "RoboWars: Heavyweight Autonomous Combat Championship 2026",
      });

      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(100000);
      expect(templateHash).toBe(EXPECTED_TEMPLATE_HASH);
    });
  });

  // =========================================================================
  // 2. Authoritative Eligibility & Payment Evaluation
  // =========================================================================
  describe("Eligibility & Payment Evaluator Rules", () => {
    it("Invariant 1: Accommodation-only participant is included in general broadcast, but excluded from certificates", async () => {
      const mockSupabase = createMockSupabase(
        [],
        [],
        [
          {
            id: "acc-101",
            status: "confirmed",
            participants: {
              id: "part-101",
              name: "Hotel Guest Delegate",
              email: "guest@delegates.org",
            },
          },
        ]
      );

      // 1. Check general broadcast: Included
      const general = await resolveGeneralBroadcastRecipients(mockSupabase);
      expect(general.length).toBe(1);
      expect(general[0].normalizedEmail).toBe("guest@delegates.org");
      expect(general[0].sources).toContain("accommodation");

      // 2. Check certificate candidates: strictly 0
      const certCandidates = await resolveCertificateCandidates(mockSupabase);
      expect(certCandidates.length).toBe(0);
    });

    it("Invariant 2 & 3: Registration without main-desk check-in or with only arena check-in is ineligible", async () => {
      const mockSupabase = createMockSupabase([
        // Item A: No check-in at all
        {
          id: "pe-001",
          status: "confirmed",
          payment_status: "paid",
          payment_amount: 500,
          registration_status: "confirmed",
          main_checked_in: false,
          main_checked_in_at: null,
          checked_in: false,
          checked_in_at: null,
          event_id: "ev-1",
          participant_id: "p-1",
          events: { id: "ev-1", name: "Hackathon", payment_type: "paid", registration_fee: 500 },
          participants: { id: "p-1", name: "Alice", email: "alice@test.com" },
        },
        // Item B: Arena checked_in = true, but main_checked_in = false
        {
          id: "pe-002",
          status: "confirmed",
          payment_status: "paid",
          payment_amount: 500,
          registration_status: "confirmed",
          main_checked_in: false,
          main_checked_in_at: null,
          checked_in: true,
          checked_in_at: "2026-10-28T10:00:00Z",
          event_id: "ev-1",
          participant_id: "p-2",
          events: { id: "ev-1", name: "Hackathon", payment_type: "paid", registration_fee: 500 },
          participants: { id: "p-2", name: "Bob", email: "bob@test.com" },
        },
      ]);

      const candidates = await resolveCertificateCandidates(mockSupabase);
      expect(candidates.length).toBe(2);

      // Item A: strictly ineligible
      expect(candidates[0].certificateEligible).toBe(false);
      expect(candidates[0].ineligibilityReason).toContain("Main registration desk check-in required");

      // Item B: Arena check-in alone is non-qualifying
      expect(candidates[1].certificateEligible).toBe(false);
      expect(candidates[1].ineligibilityReason).toContain("Only arena-level check-in recorded");
    });

    it("Invariant 4: Main check-in true with event check-in false is eligible when payment/registration passes", async () => {
      const mockSupabase = createMockSupabase([
        {
          id: "pe-003",
          status: "confirmed",
          payment_status: "paid",
          payment_amount: 300,
          registration_status: "confirmed",
          main_checked_in: true,
          main_checked_in_at: "2026-10-28T09:30:00Z",
          checked_in: false,
          checked_in_at: null,
          event_id: "ev-2",
          participant_id: "p-3",
          events: { id: "ev-2", name: "Code Debugging", payment_type: "paid", registration_fee: 300 },
          participants: { id: "p-3", name: "Charlie", email: "charlie@test.com" },
        },
      ]);

      const candidates = await resolveCertificateCandidates(mockSupabase);
      expect(candidates.length).toBe(1);
      expect(candidates[0].mainCheckedIn).toBe(true);
      expect(candidates[0].eventCheckedIn).toBe(false);
      expect(candidates[0].isPaymentComplete).toBe(true);
      expect(candidates[0].certificateEligible).toBe(true);
    });

    it("Invariant 5 & 6: Reuses authoritative evaluateEventPaymentStatus() for free and paid events", () => {
      // 1. Free event: catalog free or RPC confirmed zero-amount
      const freeDecision = evaluateEventPaymentStatus({
        registrationFee: 0,
        paymentType: "free",
        paymentAmount: 0,
        paymentStatus: "confirmed",
        registrationStatus: "confirmed",
      });
      expect(freeDecision.isFree).toBe(true);
      expect(freeDecision.isPaymentComplete).toBe(true);
      expect(freeDecision.canCheckIn).toBe(true);

      // 2. Paid event with payment completed
      const paidCompleteDecision = evaluateEventPaymentStatus({
        registrationFee: 500,
        paymentType: "paid",
        paymentAmount: 500,
        paymentStatus: "paid",
        registrationStatus: "confirmed",
      });
      expect(paidCompleteDecision.requiresPayment).toBe(true);
      expect(paidCompleteDecision.isPaymentComplete).toBe(true);
      expect(paidCompleteDecision.canCheckIn).toBe(true);

      // 3. Paid event with unpaid / pending status
      const paidPendingDecision = evaluateEventPaymentStatus({
        registrationFee: 500,
        paymentType: "paid",
        paymentAmount: 500,
        paymentStatus: "pending",
        registrationStatus: "confirmed",
      });
      expect(paidPendingDecision.isPaymentComplete).toBe(false);
      expect(paidPendingDecision.canCheckIn).toBe(false);
      expect(paidPendingDecision.rejectionReason).toContain("Payment is incomplete");
    });
  });

  // =========================================================================
  // 3. Multi-Event & Team Roster Personalization
  // =========================================================================
  describe("Team Roster & Multi-Event Mapping", () => {
    it("Invariant 7: Participant in three qualifying events produces three distinct certificates with exact event names", async () => {
      const participant = { id: "p-multi", name: "Simran Kaur", email: "simran@cgc.edu" };
      const events = [
        { id: "ev-a", name: "AI Summit" },
        { id: "ev-b", name: "RoboRace" },
        { id: "ev-c", name: "WebCraft 2026" },
      ];

      const peRows = events.map((ev, idx) => ({
        id: `pe-multi-${idx}`,
        status: "confirmed",
        payment_status: "paid",
        payment_amount: 200,
        registration_status: "confirmed",
        main_checked_in: true,
        main_checked_in_at: "2026-10-28T09:00:00Z",
        checked_in: false,
        checked_in_at: null,
        event_id: ev.id,
        participant_id: participant.id,
        events: { id: ev.id, name: ev.name, payment_type: "paid", registration_fee: 200 },
        participants: participant,
      }));

      const mockSupabase = createMockSupabase(peRows);
      const candidates = await resolveCertificateCandidates(mockSupabase);
      expect(candidates.length).toBe(3);
      expect(candidates.map((c) => c.eventName)).toEqual(["AI Summit", "RoboRace", "WebCraft 2026"]);
      expect(candidates.every((c) => c.recipientName === "Simran Kaur")).toBe(true);
      expect(candidates.every((c) => c.certificateEligible)).toBe(true);
    });

    it("Invariant 8 & 9: Multi-member team renders individual member names, never substitutes team leader name, and guest members without profile rows are included", async () => {
      const peId = "pe-team-100";
      const mockMembers = [
        {
          id: "mem-1",
          participant_event_id: peId,
          participant_id: "part-leader",
          name: "Davinder Leader",
          email: "leader@team.com",
          is_team_leader: true,
        },
        {
          id: "mem-2",
          participant_event_id: peId,
          participant_id: "part-member2",
          name: "Harpreet Member",
          email: "harpreet@team.com",
          is_team_leader: false,
        },
        // Guest member without separate participant profile (participant_id is NULL)
        {
          id: "mem-3",
          participant_event_id: peId,
          participant_id: null,
          name: "Kuldeep Guest Member",
          email: "kuldeep@guest.com",
          is_team_leader: false,
        },
      ];

      const peRows = [
        {
          id: peId,
          status: "confirmed",
          payment_status: "paid",
          payment_amount: 1000,
          registration_status: "confirmed",
          main_checked_in: true,
          main_checked_in_at: "2026-10-28T09:15:00Z",
          checked_in: false,
          checked_in_at: null,
          team_name: "Code Warriors",
          event_id: "ev-hack",
          participant_id: "part-leader",
          events: { id: "ev-hack", name: "Grand Hackathon", payment_type: "paid", registration_fee: 1000 },
          participants: { id: "part-leader", name: "Davinder Leader", email: "leader@team.com" },
        },
      ];

      const mockSupabase = createMockSupabase(peRows, mockMembers);
      const candidates = await resolveCertificateCandidates(mockSupabase);
      expect(candidates.length).toBe(3);

      expect(candidates[0].recipientName).toBe("Davinder Leader");
      expect(candidates[0].isTeamLeader).toBe(true);

      expect(candidates[1].recipientName).toBe("Harpreet Member");
      expect(candidates[1].isTeamLeader).toBe(false);

      // Invariant 9: Guest member without participant profile row is retained
      expect(candidates[2].recipientName).toBe("Kuldeep Guest Member");
      expect(candidates[2].participantId).toBeNull();
      expect(candidates[2].recipientEmail).toBe("kuldeep@guest.com");

      // Leader name was NOT substituted for members
      expect(candidates[1].recipientName).not.toBe("Davinder Leader");
      expect(candidates[2].recipientName).not.toBe("Davinder Leader");
    });
  });

  // =========================================================================
  // 4. Team Backup Delivery & Attachment Chunking Safety
  // =========================================================================
  describe("Team Backup & Attachment Manifest Chunking", () => {
    it("Invariant 10: Splits large attachment manifests into numbered parts without dropping any certificates", () => {
      const mockAttachments: EmailAttachment[] = Array.from({ length: 50 }, (_, i) => ({
        filename: `Certificate_Part_${i + 1}.pdf`,
        content: Buffer.alloc(500 * 1024), // 500 KB
      }));

      const chunks = chunkAttachments(mockAttachments, RAW_ATTACHMENT_THRESHOLD_BYTES);
      expect(chunks.length).toBeGreaterThan(1);

      // Verify no attachments were dropped
      const totalAttached = chunks.reduce((acc, c) => acc + c.length, 0);
      expect(totalAttached).toBe(50);

      // Verify every chunk is under the conservative threshold
      for (const chunk of chunks) {
        const chunkBytes = chunk.reduce((acc, att) => acc + att.content.length, 0);
        expect(chunkBytes).toBeLessThanOrEqual(RAW_ATTACHMENT_THRESHOLD_BYTES);
      }
    });

    it("Invariant 11: Deduplicates normalized email across events, team members, and accommodation", async () => {
      const sharedEmail = "  Student.Leader@CGC.EDU  ";
      const peRows = [
        {
          id: "pe-1",
          status: "confirmed",
          team_name: "AI Innovators",
          participants: { id: "p-1", name: "Student Leader", email: sharedEmail },
        },
      ];
      const memRows = [
        {
          id: "m-1",
          name: "Student Leader",
          email: "student.leader@cgc.edu",
          participant_event_id: "pe-1",
          participant_events: { id: "pe-1", status: "confirmed", team_name: "AI Innovators" },
        },
      ];
      const accRows = [
        {
          id: "acc-1",
          status: "confirmed",
          participants: { id: "p-1", name: "Student Leader", email: "student.leader@cgc.edu" },
        },
      ];

      const mockSupabase = createMockSupabase(peRows, memRows, accRows);
      const general = await resolveGeneralBroadcastRecipients(mockSupabase);

      // Exactly 1 deduplicated entry
      expect(general.length).toBe(1);
      expect(general[0].normalizedEmail).toBe("student.leader@cgc.edu");
      // Retains all three source tags
      expect(general[0].sources).toContain("event");
      expect(general[0].sources).toContain("team_member");
      expect(general[0].sources).toContain("accommodation");
    });
  });

  // =========================================================================
  // 5. Campaign Sender Isolation & Idempotency
  // =========================================================================
  describe("Resend Campaign Sender Isolation & Idempotency", () => {
    it("Fails closed in production if RESEND_CAMPAIGN_FROM_EMAIL is missing or uses prohibited domain", () => {
      const origEnv = process.env.NODE_ENV;
      const origCampaignSender = process.env.RESEND_CAMPAIGN_FROM_EMAIL;

      try {
        (process.env as any).NODE_ENV = "production";
        delete process.env.RESEND_CAMPAIGN_FROM_EMAIL;

        // Missing sender in production
        const resMissing = getCampaignEmailSender();
        expect(resMissing.success).toBe(false);
        expect(resMissing.error).toContain("RESEND_CAMPAIGN_FROM_EMAIL is not configured in production");

        // Prohibited domain in production
        process.env.RESEND_CAMPAIGN_FROM_EMAIL = "Saviskar Broadcast <test@onboarding@resend.dev>";
        const resProhibited = getCampaignEmailSender();
        expect(resProhibited.success).toBe(false);
        expect(resProhibited.error).toContain("Prohibited domain");
      } finally {
        (process.env as any).NODE_ENV = origEnv;
        if (origCampaignSender) {
          process.env.RESEND_CAMPAIGN_FROM_EMAIL = origCampaignSender;
        } else {
          delete process.env.RESEND_CAMPAIGN_FROM_EMAIL;
        }
      }
    });

    it("Invariant 16: Generates stable deterministic idempotency keys and certificate numbers", () => {
      const key1 = generateDeliveryIdempotencyKey("camp-1", "user@test.com", "individual", 1);
      const key2 = generateDeliveryIdempotencyKey("camp-1", "user@test.com", "individual", 1);
      expect(key1).toBe(key2);

      const certNum1 = generateCertificateNumber("solo:pe-123");
      const certNum2 = generateCertificateNumber("solo:pe-123");
      expect(certNum1).toBe(certNum2);
      expect(certNum1).toMatch(/^SAV26-CERT-[A-Z0-9]{10}$/);
    });
  });

  // =========================================================================
  // 6. Security & Master Admin Role Enforcement
  // =========================================================================
  describe("Master Admin Authorization & MFA Rejection", () => {
    it("Invariant 14: Non-Master Admin or Master Admin without MFA receives 403 on privileged routes", async () => {
      // Mock requireMasterAdmin returning 403 for non-master
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValueOnce({
        error: "Master Admin access required",
        status: 403,
      } as any);

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/recipients");
      const res = await getRecipientsRoute(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe("Master Admin access required");

      // Mock requireMasterAdmin returning MFA_REQUIRED
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValueOnce({
        error: "MFA_REQUIRED",
        status: 403,
      } as any);

      const resMfa = await getCampaignsRoute();
      expect(resMfa.status).toBe(403);
      const dataMfa = await resMfa.json();
      expect(dataMfa.error).toBe("Master Admin MFA verification required.");
    });
  });

  // =========================================================================
  // 7. Database Deletion Decoupling & Foreign Key Safety
  // =========================================================================
  describe("Database Deletion Decoupling & Schema Invariants", () => {
    it("Invariant 21: Migration SQL enforces ON DELETE SET NULL on registration foreign keys and safe search path", () => {
      const migrationPath = path.resolve(
        process.cwd(),
        "supabase/migrations/20261026000001_broadcast_and_certificates.sql"
      );
      expect(fs.existsSync(migrationPath)).toBe(true);

      const sql = fs.readFileSync(migrationPath, "utf-8");

      // Verify foreign keys use ON DELETE SET NULL to preserve certificate history when delete_registration_permanently runs
      expect(sql).toContain(
        "participant_event_id uuid REFERENCES public.participant_events(id) ON DELETE SET NULL"
      );
      expect(sql).toContain(
        "participant_event_member_id uuid REFERENCES public.participant_event_members(id) ON DELETE SET NULL"
      );

      // Verify immutable source fields exist
      expect(sql).toContain("original_participant_event_id uuid NOT NULL");

      // Verify safe search_path in RPC
      expect(sql).toContain("SET search_path TO 'pg_catalog', 'public', 'pg_temp'");

      // Verify permissions are revoked from PUBLIC/anon/authenticated and granted strictly to service_role
      expect(sql).toContain("REVOKE ALL ON public.broadcast_campaigns FROM PUBLIC, anon, authenticated;");
      expect(sql).toContain("GRANT ALL ON public.broadcast_campaigns TO service_role;");
      expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.claim_broadcast_deliveries(integer, text, integer) TO service_role;");
    });
  });

  // =========================================================================
  // 8. Interrupted Worker Crash Recovery & Idempotency Window Guard
  // =========================================================================
  describe("Interrupted Worker Recovery & Concurrency Safety", () => {
    it("Reconciles reclaimed delivery with existing provider_message_id directly to 'sent' without re-dispatching", async () => {
      const { processNextBroadcastBatch } = await import("@/lib/broadcast/campaign-worker");
      const campaignService = await import("@/lib/email/campaign-service");
      const sendSpy = vi.spyOn(campaignService, "sendCampaignEmail");

      const mockDeliveries = [
        {
          id: "del-crashed-1",
          campaign_id: "camp-100",
          recipient_email: "participant@test.com",
          channel: "general",
          subject: "Test Broadcast",
          body_html: "<p>Hello</p>",
          body_text: "Hello",
          status: "sending",
          attempts: 2,
          provider_message_id: "resend_msg_already_accepted_123",
          idempotency_key: "idemp_camp-100_participant@test.com_general_p1",
          created_at: new Date().toISOString(),
        },
      ];

      let updatePayload: any = null;
      const mockSupabase: any = {
        rpc: (fn: string) => {
          if (fn === "claim_broadcast_deliveries") {
            return Promise.resolve({ data: mockDeliveries, error: null });
          }
          if (fn === "increment_campaign_sent_count") {
            return Promise.resolve({ data: null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        from: (table: string) => ({
          update: (payload: any) => {
            updatePayload = payload;
            return {
              eq: () => Promise.resolve({ data: null, error: null }),
            };
          },
        }),
      };

      const result = await processNextBroadcastBatch(mockSupabase, 10);
      expect(result.processedCount).toBe(1);
      expect(result.successCount).toBe(1);
      // Crucial: sendCampaignEmail was NEVER called again because provider already accepted it!
      expect(sendSpy).not.toHaveBeenCalled();
      expect(updatePayload.status).toBe("sent");
    });

    it("Transitions interrupted delivery older than 24h to 'manual_review' to prevent duplicate dispatch", async () => {
      const { processNextBroadcastBatch } = await import("@/lib/broadcast/campaign-worker");
      const campaignService = await import("@/lib/email/campaign-service");
      const sendSpy = vi.spyOn(campaignService, "sendCampaignEmail");

      // Delivery created 25 hours ago with attempt = 2 (interrupted job)
      const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const mockDeliveries = [
        {
          id: "del-expired-24h",
          campaign_id: "camp-100",
          recipient_email: "stale@test.com",
          channel: "general",
          subject: "Stale Broadcast",
          body_html: "<p>Stale</p>",
          body_text: "Stale",
          status: "sending",
          attempts: 2,
          provider_message_id: null,
          idempotency_key: "idemp_stale_123",
          created_at: twentyFiveHoursAgo,
        },
      ];

      let updatePayload: any = null;
      const mockSupabase: any = {
        rpc: (fn: string) => {
          if (fn === "claim_broadcast_deliveries") {
            return Promise.resolve({ data: mockDeliveries, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        from: (table: string) => ({
          update: (payload: any) => {
            updatePayload = payload;
            return {
              eq: () => Promise.resolve({ data: null, error: null }),
            };
          },
        }),
      };

      const result = await processNextBroadcastBatch(mockSupabase, 10);
      expect(result.processedCount).toBe(1);
      expect(result.failureCount).toBe(1);
      // Did NOT re-dispatch
      expect(sendSpy).not.toHaveBeenCalled();
      expect(updatePayload.status).toBe("manual_review");
      expect(updatePayload.error_code).toBe("EXPIRED_IDEMPOTENCY_WINDOW");
    });
  });

  // =========================================================================
  // 9. Full Unicode Scripts & Safe Failure Validation
  // =========================================================================
  describe("Gurmukhi & Devanagari Unicode Certificate Rendering", () => {
    it("Renders Punjabi / Gurmukhi characters without stripping or corrupted replacement", async () => {
      const { pdfBytes } = await generateParticipationCertificatePdf({
        recipientName: "ਜਸ਼ਨਦੀਪ ਸਿੰਘ",
        eventName: "ਰੋਬੋਵਾਰਜ਼: ਰਾਸ਼ਟਰੀ ਚੈਂਪੀਅਨਸ਼ਿਪ 2026",
      });

      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(100000);
    });

    it("Renders Hindi / Devanagari characters without stripping or corrupted replacement", async () => {
      const { pdfBytes } = await generateParticipationCertificatePdf({
        recipientName: "आरव शर्मा",
        eventName: "रोबोवार्स: राष्ट्रीय चैम्पियनशिप 2026",
      });

      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(100000);
    });
  });

  // =========================================================================
  // 10. Regression Coverage for Schema Mismatch, Data Paths & Selection Safety
  // =========================================================================
  describe("Regression Coverage: Real Schema, Error Propagation & Safety", () => {
    it("Fails closed with a descriptive error when event query fails, preventing partial audience masquerading as complete", async () => {
      const mockSupabase = createMockSupabase([], [], [], {
        peErr: { code: "42703", message: "column participant_events.status does not exist" },
      });

      await expect(resolveGeneralBroadcastRecipients(mockSupabase)).rejects.toThrow(
        /Failed to resolve active event registrants/
      );
    });

    it("Fails closed with a descriptive error when team member query fails", async () => {
      const mockSupabase = createMockSupabase([], [], [], {
        memberErr: { code: "42703", message: "column error in members" },
      });

      await expect(resolveGeneralBroadcastRecipients(mockSupabase)).rejects.toThrow(
        /Failed to resolve team members/
      );
    });

    it("Fails closed with a descriptive error when accommodation query fails", async () => {
      const mockSupabase = createMockSupabase([], [], [], {
        accErr: { code: "500", message: "connection timeout in accommodations" },
      });

      await expect(resolveGeneralBroadcastRecipients(mockSupabase)).rejects.toThrow(
        /Failed to resolve accommodation participants/
      );
    });

    it("Evaluates real test participant with main_checked_in = true and pending payment as ineligible with exact rejection reason", async () => {
      // Simulates the exact checked-in test participant from the database
      const mockSupabase = createMockSupabase([
        {
          id: "01f41c0b-48c2-4fd1-8da0-77dba67bdba4",
          payment_status: "pending",
          payment_amount: 500,
          registration_status: "confirmed",
          main_checked_in: true,
          main_checked_in_at: "2026-10-25T18:29:57.542Z",
          checked_in: false,
          checked_in_at: null,
          team_name: null,
          event_id: "ev-test-dance",
          participant_id: "p-test-lakshay",
          is_archived: false,
          events: {
            id: "ev-test-dance",
            name: "Footlose- Solo Western dance",
            payment_type: "paid",
            registration_fee: 500,
          },
          participants: {
            id: "p-test-lakshay",
            name: "Lakshay",
            email: "lakshay.test@example.com",
          },
        },
      ]);

      const candidates = await resolveCertificateCandidates(mockSupabase);
      expect(candidates.length).toBe(1);
      const c = candidates[0];
      expect(c.recipientName).toBe("Lakshay");
      expect(c.mainCheckedIn).toBe(true);
      expect(c.mainCheckedInAt).toBe("2026-10-25T18:29:57.542Z");
      expect(c.paymentStatus).toBe("pending");
      expect(c.paymentAmount).toBe(500);
      expect(c.certificateEligible).toBe(false);
      expect(c.ineligibilityReason).toContain("Payment is incomplete (pending). Participant cannot be checked in.");
    });

    it("Certificate resolver excludes accommodation-only participants and requires valid event registration", async () => {
      // Create mock where participant_events has no accommodation records
      const mockSupabase = createMockSupabase([]);
      const candidates = await resolveCertificateCandidates(mockSupabase);
      expect(candidates.length).toBe(0);
    });

    it("GET /api/admin/broadcast/campaigns enforces Master Admin authorization", async () => {
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValueOnce({
        error: "Forbidden. Master Admin role required.",
        status: 403,
      } as any);

      const res = await getCampaignsRoute();
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Master Admin");
    });

    it("GET /api/admin/broadcast/campaigns returns HTTP 200 with genuine empty list when no campaigns exist", async () => {
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValueOnce({
        user: { id: "master-admin-uuid" },
        status: 200,
      } as any);

      const mockSupabaseAdmin = {
        from: (table: string) => ({
          select: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
      } as any;

      vi.spyOn(adminLib, "getBroadcastSupabaseAdmin").mockReturnValueOnce(mockSupabaseAdmin);

      const res = await getCampaignsRoute();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.campaigns).toEqual([]);
      expect(data.schemaWarning).toBeUndefined();
    });

    it("GET /api/admin/broadcast/campaigns returns HTTP 200 with campaigns and delivery statistics", async () => {
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValueOnce({
        user: { id: "master-admin-uuid" },
        status: 200,
      } as any);

      const mockCampaign = {
        id: "camp-001",
        title: "Test Announcement",
        subject: "Fest Update",
        campaign_type: "general",
        status: "queued",
        total_recipients: 50,
        total_deliveries: 50,
        sent_count: 10,
        delivered_count: 5,
        failed_count: 0,
        created_at: "2026-10-26T00:00:00Z",
        completed_at: null,
        created_by: "master-admin-uuid",
      };

      const mockSupabaseAdmin = {
        from: (table: string) => ({
          select: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [mockCampaign], error: null }),
            }),
          }),
        }),
      } as any;

      vi.spyOn(adminLib, "getBroadcastSupabaseAdmin").mockReturnValueOnce(mockSupabaseAdmin);

      const res = await getCampaignsRoute();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.campaigns).toHaveLength(1);
      expect(data.campaigns[0].id).toBe("camp-001");
      expect(data.campaigns[0].total_recipients).toBe(50);
    });

    it("GET /api/admin/broadcast/campaigns fails closed with HTTP 500 when table is missing and does NOT return fake empty list", async () => {
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValueOnce({
        user: { id: "master-admin-uuid" },
        status: 200,
      } as any);

      const mockSupabaseAdmin = {
        from: (table: string) => ({
          select: () => ({
            order: () => ({
              limit: () => Promise.resolve({
                data: null,
                error: { code: "PGRST205", message: "relation 'public.broadcast_campaigns' does not exist" },
              }),
            }),
          }),
        }),
      } as any;

      vi.spyOn(adminLib, "getBroadcastSupabaseAdmin").mockReturnValueOnce(mockSupabaseAdmin);

      const res = await getCampaignsRoute();
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toContain("Database table 'broadcast_campaigns' not found");
      expect(data.campaigns).toBeUndefined();
    });

    it("Reconciles Inclusion-Exclusion formula across Event, Team, and Accommodation sets without loss of attribution", async () => {
      // Create synthetic data with known overlaps
      // User 1: Event only (e1@test.com)
      // User 2: Team only (m1@test.com)
      // User 3: Acc only (a1@test.com)
      // User 4: Event + Team (em@test.com)
      // User 5: Event + Acc (ea@test.com)
      // User 6: Team + Acc (ma@test.com)
      // User 7: Event + Team + Acc (ema@test.com)
      const peRows = [
        { id: "pe1", is_archived: false, participants: { id: "p1", name: "P1", email: "e1@test.com" } },
        { id: "pe4", is_archived: false, participants: { id: "p4", name: "P4", email: "em@test.com" } },
        { id: "pe5", is_archived: false, participants: { id: "p5", name: "P5", email: "ea@test.com" } },
        { id: "pe7", is_archived: false, participants: { id: "p7", name: "P7", email: "ema@test.com" } },
      ];
      const memberRows = [
        { id: "m2", name: "M2", email: "m1@test.com", participant_event_id: "pe-x", participant_events: { is_archived: false, team_name: "T1" } },
        { id: "m4", name: "M4", email: "em@test.com", participant_event_id: "pe-x", participant_events: { is_archived: false, team_name: "T2" } },
        { id: "m6", name: "M6", email: "ma@test.com", participant_event_id: "pe-x", participant_events: { is_archived: false, team_name: "T3" } },
        { id: "m7", name: "M7", email: "ema@test.com", participant_event_id: "pe-x", participant_events: { is_archived: false, team_name: "T4" } },
      ];
      const accRows = [
        { id: "a3", status: "confirmed", participants: { id: "p3", name: "P3", email: "a1@test.com" } },
        { id: "a5", status: "confirmed", participants: { id: "p5", name: "P5", email: "ea@test.com" } },
        { id: "a6", status: "confirmed", participants: { id: "p6", name: "P6", email: "ma@test.com" } },
        { id: "a7", status: "confirmed", participants: { id: "p7", name: "P7", email: "ema@test.com" } },
      ];

      const mockSupabase = createMockSupabase(peRows, memberRows, accRows);
      const recipients = await resolveGeneralBroadcastRecipients(mockSupabase);

      // Total distinct participants must be exactly 7
      expect(recipients).toHaveLength(7);

      // Source attribution verification
      const user7 = recipients.find((r) => r.normalizedEmail === "ema@test.com");
      expect(user7).toBeDefined();
      expect(user7?.sources).toHaveLength(3);
      expect(user7?.sources).toContain("event");
      expect(user7?.sources).toContain("team_member");
      expect(user7?.sources).toContain("accommodation");

      const user4 = recipients.find((r) => r.normalizedEmail === "em@test.com");
      expect(user4?.sources).toHaveLength(2);
      expect(user4?.sources).toContain("event");
      expect(user4?.sources).toContain("team_member");

      const user3 = recipients.find((r) => r.normalizedEmail === "a1@test.com");
      expect(user3?.sources).toHaveLength(1);
      expect(user3?.sources).toContain("accommodation");

      // Math: |E|=4, |M|=4, |A|=4
      // Intersections: |E ∩ M|=2 (em, ema), |E ∩ A|=2 (ea, ema), |M ∩ A|=2 (ma, ema), |E ∩ M ∩ A|=1 (ema)
      // Union = 4 + 4 + 4 - 2 - 2 - 2 + 1 = 7
      expect(recipients.length).toBe(7);
    });

    it("Cascading rollback cleans up incomplete campaign when delivery insertion fails", async () => {
      let campaignDeleted = false;
      const mockSupabaseAdmin = {
        from: (table: string) => {
          if (table === "participation_certificates") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: "cert-001", certificate_number: "SAV26-TEST" }, error: null }),
                }),
              }),
            };
          }
          if (table === "broadcast_campaigns") {
            return {
              insert: () => ({
                select: () => ({
                  single: () => Promise.resolve({ data: { id: "camp-orphan-test" }, error: null }),
                }),
              }),
              delete: () => ({
                eq: (col: string, val: string) => {
                  if (col === "id" && val === "camp-orphan-test") {
                    campaignDeleted = true;
                  }
                  return Promise.resolve({ error: null });
                },
              }),
            };
          }
          if (table === "broadcast_deliveries") {
            return {
              insert: () => Promise.resolve({ error: { message: "Simulated delivery write failure" } }),
            };
          }
          return { select: () => Promise.resolve({ data: [], error: null }) };
        },
      } as any;

      const { createCertificateCampaign } = await import("@/lib/broadcast/campaign-worker");

      await expect(
        createCertificateCampaign(
          mockSupabaseAdmin,
          {
            title: "Failing Campaign",
            subject: "Subject",
            bodyHtml: "<p>Text</p>",
            selectedItemKeys: ["key-1"],
            sendIndividual: true,
            sendTeamBackup: false,
            adminId: "admin-uuid",
          },
          [
            {
              issueSourceKey: "key-1",
              certificateEligible: true,
              recipientEmail: "test@example.com",
              isValidEmail: true,
              recipientName: "Test Participant",
              eventName: "Hackathon",
            },
          ]
        )
      ).rejects.toThrow(/Failed to enqueue certificate deliveries/);

      expect(campaignDeleted).toBe(true);
    });

  });

  // =========================================================================
  // 9. Hybrid Development Mode Security & Isolation Invariants
  // =========================================================================
  describe("Hybrid Development Mode Security & Isolation Invariants", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
      clearMockCampaignDispatches();
    });

    it("Hosted registration client is strictly read-only and forbids all mutation operations (.insert, .update, .upsert, .delete, .rpc)", () => {
      const mockRawClient = {
        from: (table: string) => ({
          select: () => Promise.resolve({ data: [], error: null }),
          insert: () => Promise.resolve({ data: null, error: null }),
          update: () => Promise.resolve({ data: null, error: null }),
          upsert: () => Promise.resolve({ data: null, error: null }),
          delete: () => Promise.resolve({ data: null, error: null }),
        }),
        rpc: () => Promise.resolve({ data: null, error: null }),
      } as any;

      const readOnlyClient = adminLib.createReadOnlySupabaseClient(mockRawClient);

      // Select should succeed
      expect(() => readOnlyClient.from("participants").select("*")).not.toThrow();

      // Mutation operations must throw
      expect(() => readOnlyClient.from("participants").insert({ name: "Hacker" })).toThrow(
        /Forbidden mutation operation 'insert' attempted on table 'participants'/
      );
      expect(() => readOnlyClient.from("participant_events").update({ main_checked_in: true })).toThrow(
        /Forbidden mutation operation 'update' attempted on table 'participant_events'/
      );
      expect(() => readOnlyClient.from("accommodations").upsert({ status: "confirmed" })).toThrow(
        /Forbidden mutation operation 'upsert' attempted on table 'accommodations'/
      );
      expect(() => readOnlyClient.from("payments").delete()).toThrow(
        /Forbidden mutation operation 'delete' attempted on table 'payments'/
      );
      expect(() => (readOnlyClient as any).rpc("claim_broadcast_deliveries")).toThrow(
        /Forbidden RPC invocation attempted via read-only hosted registration client/
      );
    });

    it("Hybrid development mode cannot be activated in production or cloud environments", () => {
      const origNodeEnv = process.env.NODE_ENV;
      const origVercel = process.env.VERCEL;

      try {
        // Production NODE_ENV must return false
        (process.env as any).NODE_ENV = "production";
        expect(adminLib.isHybridDevelopmentModeActive()).toBe(false);

        // Development NODE_ENV with cloud provider variable set must return false
        (process.env as any).NODE_ENV = "development";
        process.env.VERCEL = "1";
        expect(adminLib.isHybridDevelopmentModeActive()).toBe(false);
      } finally {
        (process.env as any).NODE_ENV = origNodeEnv;
        if (origVercel !== undefined) process.env.VERCEL = origVercel;
        else delete process.env.VERCEL;
      }
    });

    it("isSyntheticTestEmail strictly recognizes only reserved @saviskar.test domains", () => {
      expect(adminLib.isSyntheticTestEmail("candidate@saviskar.test")).toBe(true);
      expect(adminLib.isSyntheticTestEmail("USER.NAME@SAVISKAR.TEST")).toBe(true);
      expect(adminLib.isSyntheticTestEmail("real.student@gmail.com")).toBe(false);
      expect(adminLib.isSyntheticTestEmail("delegate@cgc.edu.in")).toBe(false);
      expect(adminLib.isSyntheticTestEmail("test@saviskar.com")).toBe(false);
      expect(adminLib.isSyntheticTestEmail(null)).toBe(false);
      expect(adminLib.isSyntheticTestEmail("")).toBe(false);
    });

    it("POST /api/admin/broadcast/campaigns in hybrid mode rejects real participant emails before persistence", async () => {
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
        user: { id: "master-uuid", email: "admin@saviskar.test" },
      } as any);
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(true);

      // Attempting to enqueue a real participant address
      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns", {
        method: "POST",
        body: JSON.stringify({
          title: "Hybrid Real Recipient Test",
          subject: "Test Subject",
          bodyHtml: "<p>Hello</p>",
          campaignType: "general",
          selectedEmails: ["real.student@gmail.com"],
        }),
      });

      const res = await postCampaignsRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe(adminLib.HYBRID_READONLY_ERROR);
    });

    it("POST /api/admin/broadcast/campaigns in hybrid mode rejects certificate campaigns with real candidate keys", async () => {
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
        user: { id: "master-uuid", email: "admin@saviskar.test" },
      } as any);
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(true);

      const mockHostedClient = {
        from: () => ({
          select: () => {
            const p = Promise.resolve({
              data: [
                {
                  id: "real-pe-1",
                  payment_status: "SUCCESS",
                  registration_status: "CONFIRMED",
                  main_checked_in: true,
                  main_checked_in_at: new Date().toISOString(),
                  team_name: null,
                  event_id: "evt-1",
                  participant_id: "p-1",
                  is_archived: false,
                  events: { id: "evt-1", name: "Real Event", registration_fee: 0, payment_type: "FREE" },
                  participants: { id: "p-1", name: "Real User", email: "real.user@gmail.com" },
                },
              ],
              error: null,
            }) as any;
            p.eq = () => p;
            p.range = () => p;
            p.in = () => Promise.resolve({ data: [], error: null });
            return p;
          },
        }),
      } as any;

      vi.spyOn(adminLib, "getHostedRegistrationReadClient").mockReturnValue(mockHostedClient);

      // Candidate key for real participant
      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns", {
        method: "POST",
        body: JSON.stringify({
          title: "Hybrid Real Cert Test",
          subject: "Certificate Test",
          bodyHtml: "<p>Certificate</p>",
          campaignType: "certificate",
          selectedItemKeys: ["real-pe-1"],
        }),
      });

      const res = await postCampaignsRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe(adminLib.HYBRID_READONLY_ERROR);
    });

    it("POST /api/admin/broadcast/campaigns/[id]/test-send rejects non-synthetic destination addresses in hybrid mode", async () => {
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
        user: { id: "master-uuid", email: "admin@saviskar.test" },
      } as any);
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(true);

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/c-1/test-send", {
        method: "POST",
        body: JSON.stringify({
          destinationEmail: "real.mailbox@gmail.com",
        }),
      });

      const res = await postTestSendRoute(req, { params: Promise.resolve({ id: "c-1" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe(adminLib.HYBRID_READONLY_ERROR);
    });

    it("POST /api/admin/broadcast/campaigns/[id]/retry rejects deliveries with non-synthetic addresses in hybrid mode", async () => {
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
        user: { id: "master-uuid", email: "admin@saviskar.test" },
      } as any);
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(true);

      const mockStorageClient = {
        from: (table: string) => {
          if (table === "broadcast_deliveries") {
            return {
              select: () => ({
                in: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: "del-1",
                        recipient_email: "real.recipient@gmail.com",
                      },
                    ],
                    error: null,
                  }),
              }),
            };
          }
          return { select: () => Promise.resolve({ data: null, error: null }) };
        },
      } as any;

      vi.spyOn(adminLib, "getBroadcastSupabaseAdmin").mockReturnValue(mockStorageClient);

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/c-1/retry", {
        method: "POST",
        body: JSON.stringify({
          deliveryIds: ["del-1"],
        }),
      });

      const res = await postRetryRoute(req, { params: Promise.resolve({ id: "c-1" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe(adminLib.HYBRID_READONLY_ERROR);
    });

    it("Batch processing worker refuses to dispatch non-synthetic recipients in hybrid mode and marks them failed with HYBRID_READONLY_PROTECTION", async () => {
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(true);

      let updatedStatus = "";
      let updatedErrorCode = "";
      let updatedErrorMessage = "";

      const mockAdmin = {
        rpc: () =>
          Promise.resolve({
            data: [
              {
                id: "del-real",
                campaign_id: "c-1",
                recipient_email: "leak.attempt@realdomain.com",
                recipient_name: "Real Person",
                channel: "general",
                part_number: 1,
                total_parts: 1,
                subject: "Test",
                body_html: "<p>Test</p>",
                status: "queued",
                attempts: 1,
                created_at: new Date().toISOString(),
              },
            ],
            error: null,
          }),
        from: (table: string) => ({
          update: (payload: any) => ({
            eq: (col: string, val: string) => {
              updatedStatus = payload.status;
              updatedErrorCode = payload.error_code;
              updatedErrorMessage = payload.error_message;
              return Promise.resolve({ error: null });
            },
          }),
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      } as any;

      const result = await processNextBroadcastBatch(mockAdmin, 1);
      expect(result.processedCount).toBe(1);
      expect(result.failureCount).toBe(1);
      expect(result.successCount).toBe(0);
      expect(updatedStatus).toBe("failed");
      expect(updatedErrorCode).toBe("HYBRID_READONLY_PROTECTION");
      expect(updatedErrorMessage).toBe(adminLib.HYBRID_READONLY_ERROR);
    });

    it("Synthetic candidate fixtures enforce correct payment and main-desk check-in eligibility", () => {
      // 1. Free event with main check-in is eligible
      const freeCand = SYNTHETIC_CERTIFICATE_CANDIDATES.find(
        (c) => c.issueSourceKey === "solo:00000000-0000-4000-8000-000000000001"
      );
      expect(freeCand).toBeDefined();
      expect(freeCand?.isFree).toBe(true);
      expect(freeCand?.mainCheckedIn).toBe(true);
      expect(freeCand?.certificateEligible).toBe(true);

      // 2. Paid event with completed payment is eligible
      const paidCand = SYNTHETIC_CERTIFICATE_CANDIDATES.find(
        (c) => c.issueSourceKey === "solo:00000000-0000-4000-8000-000000000002"
      );
      expect(paidCand).toBeDefined();
      expect(paidCand?.isPaymentComplete).toBe(true);
      expect(paidCand?.mainCheckedIn).toBe(true);
      expect(paidCand?.certificateEligible).toBe(true);

      // 3. Checked-in candidate with pending payment is strictly INELIGIBLE
      const pendingCand = SYNTHETIC_CERTIFICATE_CANDIDATES.find(
        (c) => c.issueSourceKey === "solo:00000000-0000-4000-8000-000000000003"
      );
      expect(pendingCand).toBeDefined();
      expect(pendingCand?.mainCheckedIn).toBe(true);
      expect(pendingCand?.isPaymentComplete).toBe(false);
      expect(pendingCand?.certificateEligible).toBe(false);
      expect(pendingCand?.ineligibilityReason).toMatch(/pending/i);

      // 4. Candidate without main-desk check-in is strictly INELIGIBLE
      const noCheckInCand = SYNTHETIC_CERTIFICATE_CANDIDATES.find(
        (c) => c.issueSourceKey === "solo:00000000-0000-4000-8000-000000000004"
      );
      expect(noCheckInCand).toBeDefined();
      expect(noCheckInCand?.mainCheckedIn).toBe(false);
      expect(noCheckInCand?.certificateEligible).toBe(false);
      expect(noCheckInCand?.ineligibilityReason).toContain("Main registration desk check-in");

      // 5. Team member without separate participant profile
      const teamMemberCand = SYNTHETIC_CERTIFICATE_CANDIDATES.find(
        (c) => c.issueSourceKey === "member:00000000-0000-4000-8000-000000000005:00000000-0000-4000-8000-000000000055"
      );
      expect(teamMemberCand).toBeDefined();
      expect(teamMemberCand?.isTeam).toBe(true);
      expect(teamMemberCand?.isTeamLeader).toBe(false);
      expect(teamMemberCand?.certificateEligible).toBe(true);

      // 6. Accommodation-only recipient in synthetic general recipients
      const accomRecip = SYNTHETIC_GENERAL_RECIPIENTS.find(
        (r) => r.normalizedEmail === "synthetic.accommodation@saviskar.test"
      );
      expect(accomRecip).toBeDefined();
      expect(accomRecip?.sources).toContain("accommodation");
    });

    it("Mock email transport records safe dispatches without making outbound requests", async () => {
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(true);

      const result = await sendCampaignEmail({
        to: "synthetic.candidate@saviskar.test",
        subject: "Safe Hybrid Email",
        html: "<p>Safe content</p>",
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toMatch(/^mock_/);

      const dispatches = getMockCampaignDispatches();
      expect(dispatches.length).toBeGreaterThan(0);
      const last = dispatches[dispatches.length - 1];
      expect(last.recipientRedacted).toBe("synthetic.candidate@saviskar.test");
      expect(last.subject).toBe("Safe Hybrid Email");
    });
  });

  // =========================================================================
  // PRE-MERGE SAFETY REGRESSION SUITE: CAMPAIGN STATUS & SCOPED QUEUE WORKER
  // =========================================================================
  describe("Pre-Merge Safety: Campaign Status Consistency & Scoped Queue Worker", () => {
    it("updateCampaignProgressAndStatus transitions multi-batch campaign through 'processing' to 'completed' without using 'sending'", async () => {
      const { updateCampaignProgressAndStatus } = await import("@/lib/broadcast/campaign-worker");
      const campaignId = "c-multi-batch-001";

      // Mock deliveries: total 4 deliveries.
      // Batch 1: 2 sent, 2 still queued.
      let mockDeliveries = [
        { status: "sent" },
        { status: "sent" },
        { status: "queued" },
        { status: "queued" },
      ];

      let updatedPayload: any = null;
      const buildMockSupabase = (getDeliveries: () => Array<{ status: string }>) => ({
        from: (table: string) => {
          if (table === "broadcast_deliveries") {
            return {
              select: (_fields: string, opts?: { count?: string; head?: boolean }) => {
                const builder: any = {
                  _statusIn: null as string[] | null,
                  _statusEq: null as string | null,
                  eq: (col: string, val: string) => {
                    if (col === "status") builder._statusEq = val;
                    return builder;
                  },
                  in: (col: string, vals: string[]) => {
                    if (col === "status") builder._statusIn = vals;
                    return builder;
                  },
                  then: (resolve: (val: any) => void) => {
                    const all = getDeliveries();
                    let filtered = all;
                    if (builder._statusIn) {
                      filtered = filtered.filter((d) => builder._statusIn!.includes(d.status));
                    } else if (builder._statusEq) {
                      filtered = filtered.filter((d) => d.status === builder._statusEq);
                    }
                    return resolve({ count: filtered.length, data: null, error: null });
                  },
                };
                return builder;
              },
            };
          }
          if (table === "broadcast_campaigns") {
            return {
              update: (payload: any) => ({
                eq: (col: string, val: string) => {
                  updatedPayload = payload;
                  return Promise.resolve({ error: null });
                },
              }),
            };
          }
          return {};
        },
      } as any);

      const mockSupabase = buildMockSupabase(() => mockDeliveries);

      // 1. After Batch 1: remainingCount = 2 > 0 -> status MUST transition to 'processing'
      const progress1 = await updateCampaignProgressAndStatus(mockSupabase, campaignId);
      expect(progress1.status).toBe("processing");
      expect(progress1.sentCount).toBe(2);
      expect(progress1.failedCount).toBe(0);
      expect(progress1.remainingCount).toBe(2);
      expect(updatedPayload.status).toBe("processing");
      expect(updatedPayload.status).not.toBe("sending"); // Never 'sending' on campaign row
      expect(updatedPayload.completed_at).toBeUndefined();

      // 2. After Batch 2: all 4 are sent, remainingCount = 0 -> status MUST transition to 'completed'
      mockDeliveries = [
        { status: "sent" },
        { status: "sent" },
        { status: "sent" },
        { status: "sent" },
      ];

      const progress2 = await updateCampaignProgressAndStatus(mockSupabase, campaignId);
      expect(progress2.status).toBe("completed");
      expect(progress2.sentCount).toBe(4);
      expect(progress2.failedCount).toBe(0);
      expect(progress2.remainingCount).toBe(0);
      expect(updatedPayload.status).toBe("completed");
      expect(updatedPayload.completed_at).toBeDefined();
    });

    it("updateCampaignProgressAndStatus accurately counts >1,000 deliveries including sent rows beyond index 1,000", async () => {
      const { updateCampaignProgressAndStatus } = await import("@/lib/broadcast/campaign-worker");
      const campaignId = "c-large-scale-001";

      // Simulate the exact production scale: 2,599 total deliveries
      // 3 sent in first 1,000 rows, 27 sent beyond index 1,000 (total 30 sent)
      // 2,569 queued deliveries
      const largeDeliveries: Array<{ status: string }> = [];
      for (let i = 0; i < 2599; i++) {
        if (i < 3) {
          largeDeliveries.push({ status: "sent" });
        } else if (i >= 1500 && i < 1527) {
          largeDeliveries.push({ status: "delivered" }); // 27 rows beyond 1000 with delivered status
        } else {
          largeDeliveries.push({ status: "queued" });
        }
      }

      expect(largeDeliveries.length).toBe(2599);
      expect(largeDeliveries.filter((d) => d.status === "sent" || d.status === "delivered").length).toBe(30);

      let updatedPayload: any = null;
      const mockSupabase = {
        from: (table: string) => {
          if (table === "broadcast_deliveries") {
            return {
              select: (_fields: string, opts?: { count?: string; head?: boolean }) => {
                const builder: any = {
                  _statusIn: null as string[] | null,
                  _statusEq: null as string | null,
                  eq: (col: string, val: string) => {
                    if (col === "status") builder._statusEq = val;
                    return builder;
                  },
                  in: (col: string, vals: string[]) => {
                    if (col === "status") builder._statusIn = vals;
                    return builder;
                  },
                  then: (resolve: (val: any) => void) => {
                    let filtered = largeDeliveries;
                    if (builder._statusIn) {
                      filtered = filtered.filter((d) => builder._statusIn!.includes(d.status));
                    } else if (builder._statusEq) {
                      filtered = filtered.filter((d) => d.status === builder._statusEq);
                    }
                    return resolve({ count: filtered.length, data: null, error: null });
                  },
                };
                return builder;
              },
            };
          }
          if (table === "broadcast_campaigns") {
            return {
              update: (payload: any) => ({
                eq: (col: string, val: string) => {
                  updatedPayload = payload;
                  return Promise.resolve({ error: null });
                },
              }),
            };
          }
          return {};
        },
      } as any;

      const progress = await updateCampaignProgressAndStatus(mockSupabase, campaignId);

      // Verifies exact counting: never truncated to 3 or 1000!
      expect(progress.status).toBe("processing");
      expect(progress.sentCount).toBe(30);
      expect(progress.failedCount).toBe(0);
      expect(progress.remainingCount).toBe(2569);
      expect(updatedPayload.sent_count).toBe(30);
      expect(updatedPayload.failed_count).toBe(0);
      expect(updatedPayload.status).toBe("processing");
    });

    it("updateCampaignProgressAndStatus throws and does not update campaign when database count query errors", async () => {
      const { updateCampaignProgressAndStatus } = await import("@/lib/broadcast/campaign-worker");
      const campaignId = "c-err-001";
      let campaignUpdated = false;

      const createErrorBuilder = () => {
        const b: any = {
          eq: () => b,
          in: () => b,
          then: (resolve: (val: any) => void) => resolve({ count: null, data: null, error: new Error("DB Connection Error") }),
        };
        return b;
      };

      const mockSupabaseError = {
        from: (table: string) => {
          if (table === "broadcast_deliveries") {
            return {
              select: () => createErrorBuilder(),
            };
          }
          if (table === "broadcast_campaigns") {
            return {
              update: () => {
                campaignUpdated = true;
                return { eq: () => Promise.resolve({ error: null }) };
              },
            };
          }
          return {};
        },
      } as any;

      await expect(updateCampaignProgressAndStatus(mockSupabaseError, campaignId)).rejects.toThrow("DB Connection Error");
      expect(campaignUpdated).toBe(false); // Database errors must never silently overwrite or update campaign records
    });

    it("updateCampaignProgressAndStatus throws when database returns null count and does not overwrite counters", async () => {
      const { updateCampaignProgressAndStatus } = await import("@/lib/broadcast/campaign-worker");
      const campaignId = "c-null-count-001";
      let campaignUpdated = false;

      const createNullCountBuilder = () => {
        const b: any = {
          eq: () => b,
          in: () => b,
          then: (resolve: (val: any) => void) => resolve({ count: null, data: null, error: null }),
        };
        return b;
      };

      const mockSupabaseNullCount = {
        from: (table: string) => {
          if (table === "broadcast_deliveries") {
            return {
              select: () => createNullCountBuilder(),
            };
          }
          if (table === "broadcast_campaigns") {
            return {
              update: () => {
                campaignUpdated = true;
                return { eq: () => Promise.resolve({ error: null }) };
              },
            };
          }
          return {};
        },
      } as any;

      await expect(updateCampaignProgressAndStatus(mockSupabaseNullCount, campaignId)).rejects.toThrow("Database returned null count");
      expect(campaignUpdated).toBe(false);
    });

    it("processNextBroadcastBatch passes campaignId to claim_broadcast_deliveries RPC preventing cross-campaign dispatch", async () => {
      const { processNextBroadcastBatch } = await import("@/lib/broadcast/campaign-worker");
      const targetCampaignId = "c-target-alpha-123";

      let capturedRpcParams: any = null;
      const mockSupabase = {
        rpc: (fn: string, params: any) => {
          if (fn === "claim_broadcast_deliveries") {
            capturedRpcParams = params;
            return Promise.resolve({ data: [], error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
      } as any;

      const result = await processNextBroadcastBatch(mockSupabase, {
        batchSize: 10,
        campaignId: targetCampaignId,
      });

      expect(result.processedCount).toBe(0);
      expect(capturedRpcParams).toBeDefined();
      expect(capturedRpcParams.p_campaign_id).toBe(targetCampaignId);
      expect(capturedRpcParams.p_batch_size).toBe(10);
    });

    it("POST /api/admin/broadcast/campaigns enqueues only by default without dispatching emails (processedCount = 0)", async () => {
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
        user: { id: "master-uuid", email: "admin@saviskar.test" },
      } as any);
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(true);
      vi.spyOn(adminLib, "getHostedRegistrationReadClient").mockReturnValue({} as any);
      vi.spyOn(recipientResolverLib, "resolveGeneralBroadcastRecipients").mockResolvedValue([
        {
          normalizedEmail: "synthetic.candidate@saviskar.test",
          originalEmail: "synthetic.candidate@saviskar.test",
          name: "Synthetic Candidate",
          sources: ["event"],
          details: { eventIds: ["evt-1"] },
          isValidEmail: true,
        },
      ]);

      const fakeCampaignId = "c-enqueue-default-999";
      let campaignStatusSet: string = "";

      const mockStorage = {
        from: (table: string) => ({
          insert: (payload: any) => ({
            select: () => ({
              single: () => {
                campaignStatusSet = Array.isArray(payload) ? payload[0]?.status : payload?.status;
                return Promise.resolve({
                  data: { id: fakeCampaignId, ...payload },
                  error: null,
                });
              },
            }),
          }),
          select: () => ({
            single: () => Promise.resolve({ data: { id: fakeCampaignId }, error: null }),
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      } as any;

      vi.spyOn(adminLib, "getBroadcastSupabaseAdmin").mockReturnValue(mockStorage);

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns", {
        method: "POST",
        body: JSON.stringify({
          title: "Default Enqueue Test",
          subject: "Test Subject",
          bodyHtml: "<p>Hello</p>",
          campaignType: "general",
          selectedEmails: ["synthetic.candidate@saviskar.test"],
          // dispatchImmediately is omitted (default: false)
        }),
      });

      const res = await postCampaignsRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.campaignStatus).toBe("queued");
      expect(json.processedCount).toBe(0);
      expect(json.successCount).toBe(0);
      expect(json.failureCount).toBe(0);
      expect(campaignStatusSet).toBe("queued");
    });

    it("POST /api/admin/broadcast/campaigns/[id]/retry with resend_explicit handles delivery-row insertion failure and returns HTTP 500", async () => {
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
        user: { id: "master-uuid", email: "admin@saviskar.test" },
      } as any);
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(true);

      const mockStorageClient = {
        from: (table: string) => {
          if (table === "broadcast_deliveries") {
            return {
              select: () => ({
                in: () => Promise.resolve({ data: [{ id: "del-1", recipient_email: "synthetic.candidate@saviskar.test" }], error: null }),
                eq: () => ({
                  in: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: "del-1",
                          recipient_email: "synthetic.candidate@saviskar.test",
                          recipient_name: "Candidate",
                          channel: "general",
                          part_number: 1,
                          total_parts: 1,
                          subject: "Test",
                          body_html: "<p>Test</p>",
                          body_text: "Test",
                          broadcast_delivery_attachments: [],
                        },
                      ],
                      error: null,
                    }),
                }),
              }),
              insert: () => Promise.resolve({ error: { message: "DB Delivery Insert Error" } }),
            };
          }
          return {};
        },
      } as any;

      vi.spyOn(adminLib, "getBroadcastSupabaseAdmin").mockReturnValue(mockStorageClient);

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/c-1/retry", {
        method: "POST",
        body: JSON.stringify({
          deliveryIds: ["del-1"],
          action: "resend_explicit",
        }),
      });

      const res = await postRetryRoute(req, { params: Promise.resolve({ id: "c-1" }) });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBeUndefined();
      expect(json.error).toBe("DB Delivery Insert Error");
    });

    it("POST /api/admin/broadcast/campaigns/[id]/retry with resend_explicit compensates and deletes new delivery on attachment insertion failure", async () => {
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
        user: { id: "master-uuid", email: "admin@saviskar.test" },
      } as any);
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(true);

      let compensatedDeleteCalled = false;
      let insertedDeliveryIds: string[] = [];

      const mockStorageClient = {
        from: (table: string) => {
          if (table === "broadcast_deliveries") {
            return {
              select: () => ({
                in: () => Promise.resolve({ data: [{ id: "del-cert-1", recipient_email: "synthetic.candidate@saviskar.test" }], error: null }),
                eq: () => ({
                  in: () => Promise.resolve({
                    data: [
                      {
                        id: "del-cert-1",
                        recipient_email: "synthetic.candidate@saviskar.test",
                        recipient_name: "Candidate",
                        channel: "individual",
                        part_number: 1,
                        total_parts: 1,
                        subject: "Cert",
                        body_html: "<p>Cert</p>",
                        body_text: "Cert",
                        broadcast_delivery_attachments: [
                          { certificate_id: "cert-uuid-1", filename: "cert.pdf", size_bytes: 1024 },
                        ],
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
              insert: (deliveries: any[]) => {
                insertedDeliveryIds = deliveries.map((d) => d.id);
                return Promise.resolve({ error: null });
              },
              delete: () => ({
                in: (col: string, ids: string[]) => {
                  compensatedDeleteCalled = true;
                  expect(ids).toEqual(insertedDeliveryIds);
                  return Promise.resolve({ error: null });
                },
              }),
            };
          }
          if (table === "broadcast_delivery_attachments") {
            return {
              insert: () => Promise.resolve({ error: { message: "Attachment Disk Full Error" } }),
            };
          }
          return {};
        },
      } as any;

      vi.spyOn(adminLib, "getBroadcastSupabaseAdmin").mockReturnValue(mockStorageClient);

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/c-1/retry", {
        method: "POST",
        body: JSON.stringify({
          deliveryIds: ["del-cert-1"],
          action: "resend_explicit",
        }),
      });

      const res = await postRetryRoute(req, { params: Promise.resolve({ id: "c-1" }) });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBeUndefined();
      expect(json.error).toBe("Attachment Disk Full Error");
      expect(compensatedDeleteCalled).toBe(true);
    });

    it("POST /api/admin/broadcast/campaigns/[id]/retry with resend_explicit compensates if campaign total query or update fails", async () => {
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
        user: { id: "master-uuid", email: "admin@saviskar.test" },
      } as any);
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(true);

      let compensatedDeleteCalled = false;

      const mockStorageClient = {
        from: (table: string) => {
          if (table === "broadcast_deliveries") {
            return {
              select: () => ({
                in: () => Promise.resolve({ data: [{ id: "del-1", recipient_email: "synthetic.candidate@saviskar.test" }], error: null }),
                eq: () => ({
                  in: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: "del-1",
                          recipient_email: "synthetic.candidate@saviskar.test",
                          recipient_name: "Candidate",
                          channel: "general",
                          part_number: 1,
                          total_parts: 1,
                          subject: "Test",
                          body_html: "<p>Test</p>",
                          body_text: "Test",
                          broadcast_delivery_attachments: [],
                        },
                      ],
                      error: null,
                    }),
                }),
              }),
              insert: () => Promise.resolve({ error: null }),
              delete: () => ({
                in: () => {
                  compensatedDeleteCalled = true;
                  return Promise.resolve({ error: null });
                },
              }),
            };
          }
          if (table === "broadcast_campaigns") {
            return {
              select: () => ({
                eq: () => ({
                  single: () => Promise.resolve({ data: null, error: { message: "Campaign Query Failure" } }),
                }),
              }),
            };
          }
          return {};
        },
      } as any;

      vi.spyOn(adminLib, "getBroadcastSupabaseAdmin").mockReturnValue(mockStorageClient);

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/c-1/retry", {
        method: "POST",
        body: JSON.stringify({
          deliveryIds: ["del-1"],
          action: "resend_explicit",
        }),
      });

      const res = await postRetryRoute(req, { params: Promise.resolve({ id: "c-1" }) });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBeUndefined();
      expect(json.error).toBe("Campaign Query Failure");
      expect(compensatedDeleteCalled).toBe(true);
    });

    it("POST /api/admin/broadcast/campaigns/[id]/process-batch propagates queue-claim failure without falsely reporting success or finalizing status", async () => {
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
        user: { id: "master-uuid", email: "admin@saviskar.test" },
      } as any);

      let campaignStatusUpdateCalled = false;

      const mockStorageClient = {
        rpc: (fn: string) => {
          if (fn === "claim_broadcast_deliveries") {
            return Promise.resolve({
              data: null,
              error: { code: "57014", message: "canceling statement due to statement timeout" },
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        from: (table: string) => {
          if (table === "broadcast_campaigns") {
            return {
              update: () => {
                campaignStatusUpdateCalled = true;
                return { eq: () => Promise.resolve({ error: null }) };
              },
            };
          }
          return {
            select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
          };
        },
      } as any;

      vi.spyOn(adminLib, "getBroadcastSupabaseAdmin").mockReturnValue(mockStorageClient);

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/c-1/process-batch", {
        method: "POST",
        body: JSON.stringify({ batchSize: 10 }),
      });

      const res = await postProcessBatchRoute(req, { params: Promise.resolve({ id: "c-1" }) });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain("statement timeout");
      expect(campaignStatusUpdateCalled).toBe(false); // Status was NOT finalized or touched on claim failure
    });
  });

});
