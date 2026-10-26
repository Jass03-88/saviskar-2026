import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as adminLib from "@/lib/broadcast/supabase-admin";
import {
  createCertificateCampaign,
  processNextBroadcastBatch,
} from "@/lib/broadcast/campaign-worker";
import {
  sendCampaignEmail,
  getMockCampaignDispatches,
  clearMockCampaignDispatches,
} from "@/lib/email/campaign-service";

/**
 * DETERMINISTIC UNIT TEST SUITE: Hybrid Safeguards & Creator Identity
 *
 * Verifies domain protection, mock provider isolation, creator identity audit resolution,
 * and failure rollback mechanics using fast in-memory mocks.
 * Runs in default CI without requiring Docker, local Supabase, or .env files.
 */
describe("Hybrid Creator Identity & Domain Protection (Deterministic Unit Suite)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    clearMockCampaignDispatches();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("1. Identity resolver in production/standard mode preserves 1:1 author identity with full audit trail", async () => {
    (process.env as any).NODE_ENV = "test";
    const mockStorageClient = {} as any;
    const authorId = "00000000-0000-4000-8000-000000000001";
    const authorEmail = "master.admin@saviskar.co.in";

    const resolved = await adminLib.resolveCampaignCreatorIdentity(
      mockStorageClient,
      authorId,
      authorEmail
    );

    expect(resolved.effectiveCreatedBy).toBe(authorId);
    expect(resolved.targetFilters.audit.initiating_actor_id).toBe(authorId);
    expect(resolved.targetFilters.audit.initiating_actor_email).toBe(authorEmail);
    expect(resolved.targetFilters.audit.identity_source).toBe("authoritative_auth_session");
    expect(resolved.targetFilters.audit.mode).toBe("production");
    expect(resolved.targetFilters.audit.storage_actor_id).toBe(authorId);
  });

  it("2. Identity resolver in hybrid mode maps hosted admin to local master admin with audit metadata", async () => {
    (process.env as any).NODE_ENV = "development";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock-hosted.supabase.co";
    process.env.LOCAL_BROADCAST_STORAGE_URL = "http://127.0.0.1:54321";
    process.env.LOCAL_BROADCAST_STORAGE_KEY = "mock-storage-key";

    expect(adminLib.isHybridDevelopmentModeActive()).toBe(true);

    const mockAdminRow = { user_id: "db9424cb-b505-4cfd-b310-25c230138ca7", role: "master" };
    const mockStorageClient = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
            limit: () => ({
              maybeSingle: () => Promise.resolve({ data: mockAdminRow, error: null }),
            }),
          }),
        }),
      }),
    } as any;

    const hostedAdminId = "99999999-aaaa-bbbb-cccc-111111111111";
    const hostedAdminEmail = "hosted.master@saviskar.test";

    const resolved = await adminLib.resolveCampaignCreatorIdentity(
      mockStorageClient,
      hostedAdminId,
      hostedAdminEmail
    );

    expect(resolved.effectiveCreatedBy).toBe("db9424cb-b505-4cfd-b310-25c230138ca7");
    expect(resolved.targetFilters.audit.initiating_actor_id).toBe(hostedAdminId);
    expect(resolved.targetFilters.audit.initiating_actor_email).toBe(hostedAdminEmail);
    expect(resolved.targetFilters.audit.identity_source).toBe("hosted_supabase_session");
    expect(resolved.targetFilters.audit.mode).toBe("hybrid_development");
  });

  it("3. sendCampaignEmail strictly blocks @test.com, real domains, and any unapproved domain in hybrid mode", async () => {
    vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(true);

    // 1. @test.com
    const resTestCom = await sendCampaignEmail({
      to: "concurr_0@test.com",
      subject: "Test Subject",
      html: "<p>Test</p>",
    });
    expect(resTestCom.success).toBe(false);
    expect(resTestCom.errorCode).toBe("UNAPPROVED_HYBRID_RECIPIENT_DOMAIN");

    // 2. Real domain (@gmail.com)
    const resGmail = await sendCampaignEmail({
      to: "student.participant@gmail.com",
      subject: "Real Domain Attempt",
      html: "<p>Test</p>",
    });
    expect(resGmail.success).toBe(false);
    expect(resGmail.errorCode).toBe("UNAPPROVED_HYBRID_RECIPIENT_DOMAIN");

    // 3. Educational domain (@cgc.edu.in)
    const resEdu = await sendCampaignEmail({
      to: "student@cgc.edu.in",
      subject: "Edu Domain Attempt",
      html: "<p>Test</p>",
    });
    expect(resEdu.success).toBe(false);
    expect(resEdu.errorCode).toBe("UNAPPROVED_HYBRID_RECIPIENT_DOMAIN");

    // Verify zero dispatches recorded
    const dispatches = getMockCampaignDispatches();
    expect(dispatches).toHaveLength(0);
  });

  it("4. sendCampaignEmail permits valid @saviskar.test fixtures through mock provider without outbound request", async () => {
    vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(true);

    const res = await sendCampaignEmail({
      to: "synthetic.candidate@saviskar.test",
      subject: "Valid Mock Dispatch Test",
      html: "<p>Hello Synthetic</p>",
      idempotencyKey: `mock_test_${Date.now()}`,
    });

    expect(res.success).toBe(true);
    expect(res.messageId).toMatch(/^mock_/);

    const dispatches = getMockCampaignDispatches();
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].toDomain).toBe("saviskar.test");
    expect(dispatches[0].recipientRedacted).toBe("synthetic.candidate@saviskar.test");
  });

  it("5. Controlled failure in certificate campaign creation triggers compensating rollback", async () => {
    let campaignDeleted = false;
    let certificatesDeleted = false;

    const mockAdmin = {
      from: (table: string) => {
        if (table === "broadcast_campaigns") {
          return {
            insert: () => ({
              select: () => ({
                single: () => Promise.resolve({ data: { id: "camp-rollback-id" }, error: null }),
              }),
            }),
            delete: () => ({
              eq: () => {
                campaignDeleted = true;
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
            insert: () => ({
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: { id: "cert-1", certificate_number: "SAV26-CERT-123" },
                    error: null,
                  }),
              }),
            }),
            delete: () => ({
              eq: () => {
                certificatesDeleted = true;
                return Promise.resolve({ error: null });
              },
              in: () => {
                certificatesDeleted = true;
                return Promise.resolve({ error: null });
              },
            }),
          };
        }
        if (table === "broadcast_deliveries") {
          return {
            insert: () =>
              Promise.resolve({
                error: { message: "SIMULATED_CONTROLLED_DELIVERY_FAILURE" },
              }),
          };
        }
        // Fallback for participant_events, participants, events
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        };
      },
    } as any;

    const candidate = {
      issueSourceKey: "key-1",
      participantEventId: "00000000-0000-4000-8000-000000000001",
      certificateEligible: true,
      recipientEmail: "synthetic.candidate@saviskar.test",
      isValidEmail: true,
      recipientName: "Test Participant",
      eventName: "Hackathon",
      isTeam: false,
    };

    await expect(
      createCertificateCampaign(
        mockAdmin,
        {
          title: "Rollback Test Campaign",
          subject: "Subject",
          bodyHtml: "<p>Text</p>",
          selectedItemKeys: ["key-1"],
          sendIndividual: true,
          sendTeamBackup: false,
          adminId: "admin-uuid",
        },
        [candidate]
      )
    ).rejects.toThrow(/Failed to enqueue certificate deliveries: SIMULATED_CONTROLLED_DELIVERY_FAILURE/);

    expect(campaignDeleted).toBe(true);
    expect(certificatesDeleted).toBe(true);
  });

  it("6. Batch worker in hybrid mode strictly marks deliveries with @test.com or real addresses as failed with HYBRID_READONLY_PROTECTION", async () => {
    vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(true);

    let updatedStatus = "";
    let updatedErrorCode = "";

    const mockAdmin = {
      rpc: () =>
        Promise.resolve({
          data: [
            {
              id: "del-prohibited",
              campaign_id: "c-1",
              recipient_email: "forbidden_runner@test.com",
              recipient_name: "Prohibited",
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
    expect(updatedStatus).toBe("failed");
    expect(updatedErrorCode).toBe("HYBRID_READONLY_PROTECTION");
  });

  it("7. Synthetic candidate delivery completes end-to-end via mock batch worker and transport", async () => {
    vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(true);

    let updatedStatus = "";
    let updatedMessageId = "";

    const mockAdmin = {
      rpc: () =>
        Promise.resolve({
          data: [
            {
              id: "del-synthetic",
              campaign_id: "c-1",
              recipient_email: "synthetic.candidate@saviskar.test",
              recipient_name: "Synthetic Candidate",
              channel: "general",
              part_number: 1,
              total_parts: 1,
              subject: "Batch Subject",
              body_html: "<p>Batch</p>",
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
            updatedMessageId = payload.provider_message_id;
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
    expect(result.successCount).toBe(1);
    expect(updatedStatus).toBe("sent");
    expect(updatedMessageId).toMatch(/^mock_/);

    const dispatches = getMockCampaignDispatches();
    const match = dispatches.find((d) => d.recipientRedacted === "synthetic.candidate@saviskar.test");
    expect(match).toBeDefined();
  });
});
