import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateCertificateNumber,
  generateDeliveryIdempotencyKey,
  createCertificateCampaign,
} from "@/lib/broadcast/campaign-worker";
import {
  resolveCertificateCandidates,
  CertificateEligibleItem,
} from "@/lib/broadcast/recipient-resolver";
import { GET as getCampaignsRoute, POST as postCampaignsRoute } from "@/app/api/admin/broadcast/campaigns/route";
import { DELETE as deleteCampaignRoute } from "@/app/api/admin/broadcast/campaigns/[id]/route";
import * as serverLib from "@/lib/supabase/server";
import { NextRequest } from "next/server";

import * as adminLib from "@/lib/broadcast/supabase-admin";

describe("Participation Certificate Number Allocation, Concurrency & Campaign Enqueue", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.PRODUCTION_READONLY_MODE;
    delete process.env.VERCEL_ENV;
    vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(true);
    // Default authorized Master Admin
    vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
      user: { id: "admin-master-001", email: "master@saviskar.co.in" },
      role: "master",
    } as any);
  });

  // =========================================================================
  // ISSUE 1: Certificate Number Collision, Sequence & Idempotency
  // =========================================================================
  describe("Certificate Numbering & Collision Invariants", () => {
    it("1. generateCertificateNumber produces deterministic 10-hex hash by default, and unique suffix when provided", () => {
      const num1 = generateCertificateNumber("solo:pe-100");
      const num2 = generateCertificateNumber("solo:pe-100");
      expect(num1).toBe(num2);
      expect(num1).toMatch(/^SAV26-CERT-[A-Z0-9]{10}$/);

      // With suffix
      const suffixed = generateCertificateNumber("solo:pe-100", "2045");
      expect(suffixed).toMatch(/^SAV26-CERT-[A-Z0-9]{6}2045$/);
      expect(suffixed).not.toBe(num1);
    });

    it("2. Automatically recovers from duplicate key on participation_certificates_certificate_number_key without failing campaign", async () => {
      let insertAttempts = 0;
      const insertedCerts: any[] = [];

      const mockSupabase = {
        from: (table: string) => {
          if (table === "participation_certificates") {
            return {
              select: () => ({
                eq: (col: string, val: string) => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
              insert: (data: any) => {
                insertAttempts++;
                if (insertAttempts === 1) {
                  // Simulate exact production collision on certificate_number
                  return {
                    select: () => ({
                      single: () =>
                        Promise.resolve({
                          data: null,
                          error: {
                            code: "23505",
                            message: 'duplicate key value violates unique constraint "participation_certificates_certificate_number_key"',
                          },
                        }),
                    }),
                  };
                }
                // Second attempt succeeds with salted sequence number
                insertedCerts.push(data);
                return {
                  select: () => ({
                    single: () =>
                      Promise.resolve({
                        data: { id: "cert-recovered-01", certificate_number: data.certificate_number },
                        error: null,
                      }),
                  }),
                };
              },
            };
          }
          if (table === "broadcast_campaigns") {
            return {
              insert: () => ({
                select: () => ({
                  single: () => Promise.resolve({ data: { id: "camp-collision-test" }, error: null }),
                }),
              }),
              update: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            };
          }
          if (table === "broadcast_deliveries") {
            return {
              select: () => ({
                eq: () => Promise.resolve({ count: 1, data: [], error: null }),
              }),
              upsert: () => Promise.resolve({ error: null }),
            };
          }
          if (table === "broadcast_delivery_attachments") {
            return {
              insert: () => Promise.resolve({ error: null }),
            };
          }
          return {
            select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          };
        },
      } as any;

      const result = await createCertificateCampaign(
        mockSupabase,
        {
          title: "Saviskar 2026 Participation Certificates",
          subject: "Your Certificate",
          bodyHtml: "<p>Congrats</p>",
          selectedItemKeys: ["member:pe-01:mem-gungun"],
          sendIndividual: true,
          sendTeamBackup: false,
          adminId: "admin-master-001",
        },
        [
          {
            issueSourceKey: "member:pe-01:mem-gungun",
            certificateEligible: true,
            recipientEmail: "gungun@example.com",
            isValidEmail: true,
            recipientName: "Gungun Jaswal",
            eventName: "Roborace",
          },
        ]
      );

      expect(insertAttempts).toBe(2);
      expect(result.totalCertificates).toBe(1);
      expect(result.totalDeliveries).toBe(1);
      expect(insertedCerts.length).toBe(1);
      expect(insertedCerts[0].recipient_name).toBe("Gungun Jaswal");
    });

    it("3. Concurrently issued certificate for same participant-event catches issue_source_key conflict and reuses record idempotently", async () => {
      let insertCalled = false;

      const mockSupabase = {
        from: (table: string) => {
          if (table === "participation_certificates") {
            return {
              select: () => ({
                eq: (col: string, val: string) => ({
                  maybeSingle: () => {
                    // First check finds nothing (simulating race before concurrent commit)
                    if (!insertCalled) {
                      return Promise.resolve({ data: null, error: null });
                    }
                    // Re-query after conflict finds the concurrent certificate
                    return Promise.resolve({
                      data: { id: "cert-concurrent-01", certificate_number: "SAV26-CERT-CONCURRENT" },
                      error: null,
                    });
                  },
                }),
              }),
              insert: () => {
                insertCalled = true;
                return {
                  select: () => ({
                    single: () =>
                      Promise.resolve({
                        data: null,
                        error: {
                          code: "23505",
                          message: 'duplicate key value violates unique constraint "participation_certificates_issue_source_key_key"',
                        },
                      }),
                  }),
                };
              },
            };
          }
          if (table === "broadcast_campaigns") {
            return {
              insert: () => ({
                select: () => ({
                  single: () => Promise.resolve({ data: { id: "camp-race-test" }, error: null }),
                }),
              }),
              update: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            };
          }
          if (table === "broadcast_deliveries") {
            return {
              select: () => ({
                eq: () => Promise.resolve({ count: 1, data: [], error: null }),
              }),
              upsert: () => Promise.resolve({ error: null }),
            };
          }
          if (table === "broadcast_delivery_attachments") {
            return {
              insert: () => Promise.resolve({ error: null }),
            };
          }
          return {
            select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          };
        },
      } as any;

      const result = await createCertificateCampaign(
        mockSupabase,
        {
          title: "Saviskar 2026 Participation Certificates",
          subject: "Your Certificate",
          bodyHtml: "<p>Congrats</p>",
          selectedItemKeys: ["solo:pe-concurrent"],
          sendIndividual: true,
          sendTeamBackup: false,
          adminId: "admin-master-001",
        },
        [
          {
            issueSourceKey: "solo:pe-concurrent",
            certificateEligible: true,
            recipientEmail: "concurrent@example.com",
            isValidEmail: true,
            recipientName: "Concurrent Participant",
            eventName: "Web Dev Sprint",
          },
        ]
      );

      expect(result.totalCertificates).toBe(1);
      expect(result.totalDeliveries).toBe(1);
    });

    it("4. Multiple events for one participant produce distinct event-specific certificates with unique numbers", async () => {
      const issuedNumbers = new Set<string>();
      const certRows: any[] = [];

      const mockSupabase = {
        from: (table: string) => {
          if (table === "participation_certificates") {
            return {
              select: () => ({
                eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
              }),
              insert: (record: any) => {
                certRows.push(record);
                issuedNumbers.add(record.certificate_number);
                return {
                  select: () => ({
                    single: () =>
                      Promise.resolve({
                        data: { id: `cert-${record.event_name}`, certificate_number: record.certificate_number },
                        error: null,
                      }),
                  }),
                };
              },
            };
          }
          if (table === "broadcast_campaigns") {
            return {
              insert: () => ({
                select: () => ({
                  single: () => Promise.resolve({ data: { id: "camp-multi-event" }, error: null }),
                }),
              }),
              update: () => ({ eq: () => Promise.resolve({ error: null }) }),
            };
          }
          if (table === "broadcast_deliveries") {
            return {
              select: () => ({ eq: () => Promise.resolve({ count: 1, data: [], error: null }) }),
              upsert: () => Promise.resolve({ error: null }),
            };
          }
          if (table === "broadcast_delivery_attachments") {
            return { insert: () => Promise.resolve({ error: null }) };
          }
          return {
            select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          };
        },
      } as any;

      const candidates = [
        {
          issueSourceKey: "solo:pe-ev-1",
          certificateEligible: true,
          recipientEmail: "multi@example.com",
          isValidEmail: true,
          recipientName: "Active Participant",
          eventName: "Code Circuit",
        },
        {
          issueSourceKey: "solo:pe-ev-2",
          certificateEligible: true,
          recipientEmail: "multi@example.com",
          isValidEmail: true,
          recipientName: "Active Participant",
          eventName: "Bug Hunt",
        },
      ];

      const result = await createCertificateCampaign(
        mockSupabase,
        {
          title: "Multi Event Certificate",
          subject: "Your Certificates",
          bodyHtml: "<p>Congrats</p>",
          selectedItemKeys: ["solo:pe-ev-1", "solo:pe-ev-2"],
          sendIndividual: true,
          sendTeamBackup: false,
          adminId: "admin-master-001",
        },
        candidates
      );

      expect(result.totalCertificates).toBe(2);
      expect(certRows).toHaveLength(2);
      expect(certRows[0].event_name).toBe("Code Circuit");
      expect(certRows[1].event_name).toBe("Bug Hunt");
      expect(issuedNumbers.size).toBe(2);
      // Both certificates attached to the same recipient's individual delivery
      expect(result.totalDeliveries).toBe(1);
    });

    it("5. Retrying a failed campaign preserves existing certificate records and does not alter numbers or IDs", async () => {
      let insertCalled = false;

      const mockSupabase = {
        from: (table: string) => {
          if (table === "participation_certificates") {
            return {
              select: () => ({
                eq: (col: string, val: string) => ({
                  maybeSingle: () => {
                    // Record already exists from initial attempt
                    return Promise.resolve({
                      data: { id: "existing-cert-uuid-777", certificate_number: "SAV26-CERT-PRESERVED" },
                      error: null,
                    });
                  },
                }),
              }),
              insert: () => {
                insertCalled = true;
                return {
                  select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }),
                };
              },
            };
          }
          if (table === "broadcast_campaigns") {
            return {
              insert: () => ({
                select: () => ({ single: () => Promise.resolve({ data: { id: "camp-retry-preservation" }, error: null }) }),
              }),
              update: () => ({ eq: () => Promise.resolve({ error: null }) }),
            };
          }
          if (table === "broadcast_deliveries") {
            return {
              select: () => ({ eq: () => Promise.resolve({ count: 1, data: [], error: null }) }),
              upsert: () => Promise.resolve({ error: null }),
            };
          }
          if (table === "broadcast_delivery_attachments") {
            return { insert: () => Promise.resolve({ error: null }) };
          }
          return {
            select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          };
        },
      } as any;

      const result = await createCertificateCampaign(
        mockSupabase,
        {
          title: "Retry Campaign",
          subject: "Your Certificate",
          bodyHtml: "<p>Congrats</p>",
          selectedItemKeys: ["solo:pe-preservation"],
          sendIndividual: true,
          sendTeamBackup: false,
          adminId: "admin-master-001",
        },
        [
          {
            issueSourceKey: "solo:pe-preservation",
            certificateEligible: true,
            recipientEmail: "preserve@example.com",
            isValidEmail: true,
            recipientName: "Preserved User",
            eventName: "Roborace",
          },
        ]
      );

      // Must NOT attempt insert when record already exists
      expect(insertCalled).toBe(false);
      expect(result.totalCertificates).toBe(1);
    });
  });

  // =========================================================================
  // ISSUE 2: Campaign Enqueue & 3,980 Candidates Resolution
  // =========================================================================
  describe("Campaign Enqueue & Delivery Persistence", () => {
    it("6. Accurately handles selecting all 3,980 eligible certificates and creates deliveries across batches", async () => {
      // Generate 3,980 realistic candidates (3,917 event + 63 stay-only)
      const mockCandidates: CertificateEligibleItem[] = [];
      const selectedKeys: string[] = [];

      for (let i = 1; i <= 3917; i++) {
        const key = `solo:pe-${i}`;
        selectedKeys.push(key);
        mockCandidates.push({
          participantEventId: `pe-${i}`,
          memberId: null,
          participantId: `p-${i}`,
          recipientName: `Participant ${i}`,
          recipientEmail: `user${i}@example.com`,
          isValidEmail: true,
          eventId: `event-${(i % 49) + 1}`,
          eventName: `Event ${(i % 49) + 1}`,
          isTeam: false,
          teamName: null,
          teamContactEmail: null,
          isTeamLeader: false,
          mainCheckedIn: i % 2 === 0,
          mainCheckedInAt: null,
          eventCheckedIn: false,
          paymentStatus: "success",
          paymentAmount: 200,
          isFree: false,
          isPaymentComplete: true,
          certificateEligible: true,
          ineligibilityReason: null,
          issueSourceKey: key,
          isStayOnly: false,
        });
      }

      for (let j = 1; j <= 63; j++) {
        const key = `stay:acc-${j}`;
        selectedKeys.push(key);
        mockCandidates.push({
          participantEventId: `acc-${j}`,
          accommodationId: `acc-${j}`,
          memberId: null,
          participantId: `stay-p-${j}`,
          recipientName: `Stay Guest ${j}`,
          recipientEmail: `stay${j}@example.com`,
          isValidEmail: true,
          eventId: "stay-only",
          eventName: "Saviskar 2026",
          isTeam: false,
          teamName: null,
          teamContactEmail: null,
          isTeamLeader: false,
          mainCheckedIn: false,
          mainCheckedInAt: null,
          eventCheckedIn: false,
          paymentStatus: "confirmed",
          paymentAmount: null,
          isFree: false,
          isPaymentComplete: true,
          certificateEligible: true,
          ineligibilityReason: null,
          issueSourceKey: key,
          isStayOnly: true,
        });
      }

      expect(mockCandidates.length).toBe(3980);
      expect(selectedKeys.length).toBe(3980);

      let totalDeliveriesUpserted = 0;
      let totalAttachmentsInserted = 0;

      const mockSupabase = {
        from: (table: string) => {
          if (table === "participation_certificates") {
            return {
              select: () => ({
                eq: (col: string, val: string) => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: { id: `cert-${val}`, certificate_number: `SAV26-CERT-${val}` },
                      error: null,
                    }),
                }),
              }),
            };
          }
          if (table === "broadcast_campaigns") {
            return {
              insert: () => ({
                select: () => ({
                  single: () => Promise.resolve({ data: { id: "camp-3980-test" }, error: null }),
                }),
              }),
              update: () => ({ eq: () => Promise.resolve({ error: null }) }),
            };
          }
          if (table === "broadcast_deliveries") {
            return {
              select: () => ({ eq: () => Promise.resolve({ count: 3980, data: [], error: null }) }),
              upsert: (rows: any[]) => {
                totalDeliveriesUpserted += rows.length;
                return Promise.resolve({ error: null });
              },
            };
          }
          if (table === "broadcast_delivery_attachments") {
            return {
              insert: (rows: any[]) => {
                totalAttachmentsInserted += rows.length;
                return Promise.resolve({ error: null });
              },
            };
          }
          return {
            select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          };
        },
      } as any;

      const result = await createCertificateCampaign(
        mockSupabase,
        {
          title: "Saviskar 2026 Participation Certificates",
          subject: "Your Official Saviskar 2026 Certificate",
          bodyHtml: "<p>Thank you for participating</p>",
          selectedItemKeys: selectedKeys,
          sendIndividual: true,
          sendTeamBackup: false,
          adminId: "admin-master-001",
        },
        mockCandidates
      );

      expect(result.totalCertificates).toBe(3980);
      expect(result.totalDeliveries).toBe(3980);
      expect(totalDeliveriesUpserted).toBe(3980);
      expect(totalAttachmentsInserted).toBe(3980);
    });

    it("7. Fails closed with HTTP 400 when zero certificate recipients are selected", async () => {
      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Empty Campaign",
          subject: "Subject",
          bodyHtml: "<p>Body</p>",
          campaignType: "certificate",
          selectedItemKeys: [],
        }),
      });

      const res = await postCampaignsRoute(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toMatch(/At least one certificate recipient must be selected/);
    });

    it("8. Missing emails do not remove certificate eligibility and are stored in DB without failing the campaign", async () => {
      const candidates: CertificateEligibleItem[] = [
        {
          issueSourceKey: "solo:pe-valid-email",
          certificateEligible: true,
          recipientEmail: "valid@example.com",
          isValidEmail: true,
          recipientName: "Valid Email Participant",
          eventName: "Brand Battle",
          participantEventId: "pe-valid",
          memberId: null,
          participantId: "p-valid",
          eventId: "ev-1",
          isTeam: false,
          teamName: null,
          teamContactEmail: null,
          isTeamLeader: false,
          mainCheckedIn: true,
          mainCheckedInAt: null,
          eventCheckedIn: true,
          paymentStatus: "success",
          paymentAmount: 200,
          isFree: false,
          isPaymentComplete: true,
          ineligibilityReason: null,
          isStayOnly: false,
        },
        {
          issueSourceKey: "solo:pe-missing-email",
          certificateEligible: true,
          recipientEmail: null, // Missing email
          isValidEmail: false,
          recipientName: "No Email Participant",
          eventName: "Brand Battle",
          participantEventId: "pe-no-email",
          memberId: null,
          participantId: "p-no-email",
          eventId: "ev-1",
          isTeam: false,
          teamName: null,
          teamContactEmail: null,
          isTeamLeader: false,
          mainCheckedIn: true,
          mainCheckedInAt: null,
          eventCheckedIn: true,
          paymentStatus: "success",
          paymentAmount: 200,
          isFree: false,
          isPaymentComplete: true,
          ineligibilityReason: null,
          isStayOnly: false,
        },
      ];

      const insertedDeliveries: any[] = [];
      const mockSupabase = {
        from: (table: string) => {
          if (table === "participation_certificates") {
            return {
              select: () => ({
                eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
              }),
              insert: (d: any) => ({
                select: () => ({
                  single: () => Promise.resolve({ data: { id: `cert-${d.recipient_name}`, certificate_number: d.certificate_number }, error: null }),
                }),
              }),
            };
          }
          if (table === "broadcast_campaigns") {
            return {
              insert: () => ({
                select: () => ({ single: () => Promise.resolve({ data: { id: "camp-missing-email-test" }, error: null }) }),
              }),
              update: () => ({ eq: () => Promise.resolve({ error: null }) }),
            };
          }
          if (table === "broadcast_deliveries") {
            return {
              select: () => ({ eq: () => Promise.resolve({ count: 1, data: [], error: null }) }),
              upsert: (rows: any[]) => {
                insertedDeliveries.push(...rows);
                return Promise.resolve({ error: null });
              },
            };
          }
          if (table === "broadcast_delivery_attachments") {
            return { insert: () => Promise.resolve({ error: null }) };
          }
          return {
            select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          };
        },
      } as any;

      const result = await createCertificateCampaign(
        mockSupabase,
        {
          title: "Certificate Campaign with Missing Email",
          subject: "Your Certificate",
          bodyHtml: "<p>Congrats</p>",
          selectedItemKeys: ["solo:pe-valid-email", "solo:pe-missing-email"],
          sendIndividual: true,
          sendTeamBackup: false,
          adminId: "admin-master-001",
        },
        candidates
      );

      // Both receive certificate records in database
      expect(result.totalCertificates).toBe(2);
      // Only the participant with a valid email receives an email delivery row
      expect(result.totalDeliveries).toBe(1);
      expect(insertedDeliveries.length).toBe(1);
      expect(insertedDeliveries[0].recipient_email).toBe("valid@example.com");
    });

    it("9. DELETE /api/admin/broadcast/campaigns/[id] deletes an empty draft campaign but rejects campaigns with sent deliveries", async () => {
      // Mock Supabase admin returning a draft campaign with 0 sent emails
      const mockSupabase = {
        from: (table: string) => {
          if (table === "broadcast_campaigns") {
            return {
              select: () => ({
                eq: (col: string, val: string) => ({
                  single: () => {
                    if (val === "camp-draft-empty") {
                      return Promise.resolve({
                        data: { id: "camp-draft-empty", status: "draft", sent_count: 0, total_deliveries: 0 },
                        error: null,
                      });
                    }
                    // Campaign that has already sent emails
                    return Promise.resolve({
                      data: { id: "camp-sent-active", status: "processing", sent_count: 10, total_deliveries: 20 },
                      error: null,
                    });
                  },
                }),
              }),
              delete: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            };
          }
          return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) };
        },
      };

      vi.spyOn(await import("@/lib/broadcast/supabase-admin"), "getBroadcastSupabaseAdmin").mockReturnValue(mockSupabase as any);

      // 1. Deleting empty draft campaign succeeds
      const reqDraft = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/camp-draft-empty", {
        method: "DELETE",
      });
      const resDraft = await deleteCampaignRoute(reqDraft, {
        params: Promise.resolve({ id: "camp-draft-empty" }),
      });
      const dataDraft = await resDraft.json();
      expect(resDraft.status).toBe(200);
      expect(dataDraft.success).toBe(true);

      // 2. Deleting campaign with sent emails fails closed with HTTP 400
      const reqSent = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/camp-sent-active", {
        method: "DELETE",
      });
      const resSent = await deleteCampaignRoute(reqSent, {
        params: Promise.resolve({ id: "camp-sent-active" }),
      });
      const dataSent = await resSent.json();
      expect(resSent.status).toBe(400);
      expect(dataSent.error).toMatch(/Cannot delete a campaign that has already sent emails/);
    });

    it("10. Delegates certificate issuance to atomic database RPC issue_or_get_participation_certificate when available", async () => {
      let rpcCalledWith: any = null;
      const mockSupabase = {
        rpc: (fn: string, params: any) => {
          if (fn === "issue_or_get_participation_certificate") {
            rpcCalledWith = params;
            return Promise.resolve({
              data: [
                {
                  id: "cert-rpc-atomic-01",
                  certificate_number: "SAV26-CERT-RPC10001",
                  issue_source_key: params.p_issue_source_key,
                  is_new: true,
                },
              ],
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: { message: "Unknown RPC" } });
        },
        from: (table: string) => {
          if (table === "participation_certificates") {
            return {
              select: () => ({
                eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
              }),
            };
          }
          if (table === "broadcast_campaigns") {
            return {
              insert: () => ({
                select: () => ({ single: () => Promise.resolve({ data: { id: "camp-rpc-test" }, error: null }) }),
              }),
              update: () => ({ eq: () => Promise.resolve({ error: null }) }),
            };
          }
          if (table === "broadcast_deliveries") {
            return {
              select: () => ({ eq: () => Promise.resolve({ count: 1, data: [], error: null }) }),
              upsert: () => Promise.resolve({ error: null }),
            };
          }
          if (table === "broadcast_delivery_attachments") {
            return { insert: () => Promise.resolve({ error: null }) };
          }
          return {
            select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          };
        },
      } as any;

      const result = await createCertificateCampaign(
        mockSupabase,
        {
          title: "Atomic RPC Certificate Campaign",
          subject: "Your Certificate",
          bodyHtml: "<p>Congrats</p>",
          selectedItemKeys: ["solo:pe-rpc-test"],
          sendIndividual: true,
          sendTeamBackup: false,
          adminId: "admin-master-001",
        },
        [
          {
            issueSourceKey: "solo:pe-rpc-test",
            certificateEligible: true,
            recipientEmail: "rpc@example.com",
            isValidEmail: true,
            recipientName: "Atomic RPC Recipient",
            eventName: "Roborace",
          },
        ]
      );

      expect(rpcCalledWith).toBeDefined();
      expect(rpcCalledWith.p_issue_source_key).toBe("solo:pe-rpc-test");
      expect(result.totalCertificates).toBe(1);
      expect(result.totalDeliveries).toBe(1);
    });

    it("11. Reuses and populates an existing draft campaign when campaignId is passed, without creating duplicate campaigns", async () => {
      let campaignsInserted = 0;
      let campaignUpdatedWith: any = null;

      const mockSupabase = {
        from: (table: string) => {
          if (table === "participation_certificates") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: "cert-exist", certificate_number: "SAV26-EXIST" }, error: null }),
                }),
              }),
            };
          }
          if (table === "broadcast_campaigns") {
            return {
              select: () => ({
                eq: (col: string, val: string) => ({
                  single: () => Promise.resolve({ data: { id: "camp-existing-draft-001", status: "draft", total_deliveries: 0 }, error: null }),
                }),
              }),
              insert: () => {
                campaignsInserted++;
                return {
                  select: () => ({ single: () => Promise.resolve({ data: { id: "should-not-be-called" }, error: null }) }),
                };
              },
              update: (patch: any) => {
                campaignUpdatedWith = patch;
                return { eq: () => Promise.resolve({ error: null }) };
              },
            };
          }
          if (table === "broadcast_deliveries") {
            return {
              select: () => ({ eq: () => Promise.resolve({ count: 1, data: [], error: null }) }),
              upsert: () => Promise.resolve({ error: null }),
            };
          }
          if (table === "broadcast_delivery_attachments") {
            return { insert: () => Promise.resolve({ error: null }) };
          }
          return {
            select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          };
        },
      } as any;

      const result = await createCertificateCampaign(
        mockSupabase,
        {
          title: "Saviskar 2026 Participation Certificates",
          subject: "Your Certificate",
          bodyHtml: "<p>Congrats</p>",
          selectedItemKeys: ["solo:pe-resume"],
          sendIndividual: true,
          sendTeamBackup: false,
          adminId: "admin-master-001",
          campaignId: "camp-existing-draft-001", // Recover the existing draft campaign!
        },
        [
          {
            issueSourceKey: "solo:pe-resume",
            certificateEligible: true,
            recipientEmail: "resume@example.com",
            isValidEmail: true,
            recipientName: "Resumed Participant",
            eventName: "Roborace",
          },
        ]
      );

      // Must NOT insert a new campaign
      expect(campaignsInserted).toBe(0);
      expect(result.campaignId).toBe("camp-existing-draft-001");
      expect(campaignUpdatedWith).toBeDefined();
      expect(campaignUpdatedWith.status).toBe("queued");
      expect(campaignUpdatedWith.total_deliveries).toBe(1);
    });

    it("12. Stay-only accommodation resolution generates exactly one 'Saviskar 2026' certificate and excludes participants with event registrations", async () => {
      const mockDb = {
        from: (table: string) => {
          if (table === "participant_events") {
            return {
              select: () => ({
                eq: () => ({
                  range: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: "pe-001",
                          event_id: "ev-dance",
                          participant_id: "p-both-event-and-stay",
                          is_archived: false,
                          payment_status: "success",
                          payment_amount: 100,
                          main_checked_in: false,
                          main_checked_in_at: null,
                          checked_in: false,
                          events: { id: "ev-dance", name: "Footloose", payment_type: "paid", registration_fee: 100 },
                          participants: { id: "p-both-event-and-stay", name: "Dual Participant", email: "dual@example.com" },
                        },
                      ],
                      error: null,
                    }),
                }),
              }),
            };
          }
          if (table === "participant_event_members") {
            return {
              select: () => ({
                in: () => Promise.resolve({ data: [], error: null }),
              }),
            };
          }
          if (table === "participant_accommodations") {
            return {
              select: () => ({
                neq: () => ({
                  range: () =>
                    Promise.resolve({
                      data: [
                        // Participant A: has BOTH event registration and stay -> must NOT get duplicate stay certificate
                        {
                          id: "acc-001",
                          status: "confirmed",
                          participant_id: "p-both-event-and-stay",
                          participants: { id: "p-both-event-and-stay", name: "Dual Participant", email: "dual@example.com" },
                        },
                        // Participant B: STAY-ONLY participant -> MUST get general "Saviskar 2026" certificate
                        {
                          id: "acc-002",
                          status: "confirmed",
                          participant_id: "p-stay-only-guest",
                          participants: { id: "p-stay-only-guest", name: "Pure Stay Guest", email: "stayguest@example.com" },
                        },
                      ],
                      error: null,
                    }),
                }),
              }),
            };
          }
          return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
        },
      } as any;

      const candidates = await resolveCertificateCandidates(mockDb);

      expect(candidates).toHaveLength(2);
      // 1. Dual participant receives event-specific certificate
      const eventCert = candidates.find((c) => c.recipientEmail === "dual@example.com");
      expect(eventCert).toBeDefined();
      expect(eventCert?.eventName).toBe("Footloose");
      expect(eventCert?.isStayOnly).toBe(false);

      // 2. Pure stay guest receives general "Saviskar 2026" certificate
      const stayCert = candidates.find((c) => c.recipientEmail === "stayguest@example.com");
      expect(stayCert).toBeDefined();
      expect(stayCert?.eventName).toBe("Saviskar 2026");
      expect(stayCert?.isStayOnly).toBe(true);
      expect(stayCert?.issueSourceKey).toBe("stay:p-stay-only-guest");
    });
  });
});
