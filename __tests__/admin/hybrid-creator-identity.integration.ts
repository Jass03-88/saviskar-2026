import fs from "fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  isHybridDevelopmentModeActive,
  resolveCampaignCreatorIdentity,
  getBroadcastStorageClient,
  getHostedRegistrationReadClient,
} from "@/lib/broadcast/supabase-admin";
import {
  createGeneralBroadcastCampaign,
  createCertificateCampaign,
  processNextBroadcastBatch,
} from "@/lib/broadcast/campaign-worker";
import {
  sendCampaignEmail,
  getMockCampaignDispatches,
  clearMockCampaignDispatches,
} from "@/lib/email/campaign-service";
import {
  resolveCertificateCandidates,
} from "@/lib/broadcast/recipient-resolver";
import {
  SYNTHETIC_CERTIFICATE_CANDIDATES,
} from "@/lib/broadcast/hybrid-fixtures";

describe("Phase 5: Hybrid Campaign Creator Identity & Atomic Rollback Tests", () => {
  const hostedMockAdminId = "99999999-aaaa-bbbb-cccc-111111111111"; // Hosted Supabase Auth UUID (does NOT exist in local Docker admins)
  const hostedMockAdminEmail = "hosted.master.admin@saviskar.test";
  const createdCampaignIdsToClean: string[] = [];
  const createdCertIdsToClean: string[] = [];

  beforeAll(() => {
    (process.env as any).NODE_ENV = "development";
    if (fs.existsSync(".env.local")) {
      const lines = fs.readFileSync(".env.local", "utf-8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const eq = trimmed.indexOf("=");
          if (eq > 0) {
            const k = trimmed.slice(0, eq).trim();
            let v = trimmed.slice(eq + 1).trim();
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
              v = v.slice(1, -1);
            }
            process.env[k] = v;
          }
        }
      }
    }
  });

  afterAll(async () => {
    const storageClient = getBroadcastStorageClient();
    for (const cId of createdCampaignIdsToClean) {
      await storageClient.from("broadcast_campaigns").delete().eq("id", cId);
    }
    for (const certId of createdCertIdsToClean) {
      await storageClient.from("participation_certificates").delete().eq("id", certId);
    }
  });

  it("Confirms Hybrid Development Mode is active", () => {
    expect(isHybridDevelopmentModeActive()).toBe(true);
  });

  it("1. Identity resolver maps hosted admin to local master admin and records audit metadata", async () => {
    const storageClient = getBroadcastStorageClient();
    const resolved = await resolveCampaignCreatorIdentity(
      storageClient,
      hostedMockAdminId,
      hostedMockAdminEmail
    );

    expect(resolved.effectiveCreatedBy).toBe("db9424cb-b505-4cfd-b310-25c230138ca7");
    expect(resolved.targetFilters.audit.initiating_actor_id).toBe(hostedMockAdminId);
    expect(resolved.targetFilters.audit.initiating_actor_email).toBe(hostedMockAdminEmail);
    expect(resolved.targetFilters.audit.identity_source).toBe("hosted_supabase_session");
    expect(resolved.targetFilters.audit.mode).toBe("hybrid_development");
  });

  it("2. General broadcast creates campaign satisfying local FK with full initiating actor audit", async () => {
    const storageClient = getBroadcastStorageClient();
    const title = `Phase 5 General Broadcast ${Date.now()}`;

    const result = await createGeneralBroadcastCampaign(storageClient, {
      title,
      subject: "Official Hybrid Announcement - Saviskar 2026",
      bodyHtml: "<p>General broadcast test body</p>",
      selectedEmails: ["synthetic.candidate@saviskar.test"],
      adminId: hostedMockAdminId,
      adminEmail: hostedMockAdminEmail,
    });

    expect(result.campaignId).toBeDefined();
    expect(result.totalDeliveries).toBe(1);
    createdCampaignIdsToClean.push(result.campaignId);

    // Verify campaign row
    const { data: campaign, error: campErr } = await storageClient
      .from("broadcast_campaigns")
      .select("id, title, status, created_by, target_filters")
      .eq("id", result.campaignId)
      .single();

    expect(campErr).toBeNull();
    expect(campaign).not.toBeNull();
    // Valid local master admin satisfies FK constraint broadcast_campaigns_created_by_fkey
    expect(campaign!.created_by).toBe("db9424cb-b505-4cfd-b310-25c230138ca7");
    // Auditable attribution preserved
    expect(campaign!.target_filters?.audit?.initiating_actor_id).toBe(hostedMockAdminId);
    expect(campaign!.target_filters?.audit?.initiating_actor_email).toBe(hostedMockAdminEmail);
    expect(campaign!.target_filters?.audit?.mode).toBe("hybrid_development");

    // Verify delivery row
    const { data: dels, error: delErr } = await storageClient
      .from("broadcast_deliveries")
      .select("id, recipient_email, status, channel")
      .eq("campaign_id", result.campaignId);

    expect(delErr).toBeNull();
    expect(dels).toHaveLength(1);
    expect(dels![0].recipient_email).toBe("synthetic.candidate@saviskar.test");
    expect(dels![0].status).toBe("queued");
  });

  it("3. Certificate campaign creation stores valid local creator reference, immutable snapshot, and delivery attachment", async () => {
    const storageClient = getBroadcastStorageClient();
    const hostedClient = getHostedRegistrationReadClient();
    const realCandidates = await resolveCertificateCandidates(hostedClient);
    const combinedCandidates = [...SYNTHETIC_CERTIFICATE_CANDIDATES, ...realCandidates];

    // Select genuinely eligible synthetic candidate
    const eligibleSyntheticKey = "solo:00000000-0000-4000-8000-000000000001";
    const title = `Phase 5 Certificate Campaign ${Date.now()}`;

    const result = await createCertificateCampaign(
      storageClient,
      {
        title,
        subject: "Your Official Certificate of Participation - Saviskar 2026",
        bodyHtml: "<p>Official Certificate</p>",
        selectedItemKeys: [eligibleSyntheticKey],
        sendIndividual: true,
        sendTeamBackup: false,
        adminId: hostedMockAdminId,
        adminEmail: hostedMockAdminEmail,
      },
      combinedCandidates
    );

    expect(result.campaignId).toBeDefined();
    expect(result.totalDeliveries).toBe(1);
    expect(result.totalCertificates).toBe(1);
    createdCampaignIdsToClean.push(result.campaignId);

    // Verify campaign in database
    const { data: campaign, error: campErr } = await storageClient
      .from("broadcast_campaigns")
      .select("id, title, status, created_by, target_filters")
      .eq("id", result.campaignId)
      .single();

    expect(campErr).toBeNull();
    expect(campaign).not.toBeNull();
    expect(campaign!.created_by).toBe("db9424cb-b505-4cfd-b310-25c230138ca7");
    expect(campaign!.target_filters?.audit?.initiating_actor_id).toBe(hostedMockAdminId);

    // Verify participation certificate record
    const { data: cert, error: certErr } = await storageClient
      .from("participation_certificates")
      .select("id, certificate_number, issue_source_key, recipient_name")
      .eq("issue_source_key", eligibleSyntheticKey)
      .single();

    expect(certErr).toBeNull();
    expect(cert).not.toBeNull();
    expect(cert!.certificate_number).toMatch(/^SAV26-CERT-/);

    // Verify delivery and attachment
    const { data: dels, error: delErr } = await storageClient
      .from("broadcast_deliveries")
      .select(`
        id,
        recipient_email,
        channel,
        status,
        broadcast_delivery_attachments (
          id,
          certificate_id,
          filename
        )
      `)
      .eq("campaign_id", result.campaignId);

    expect(delErr).toBeNull();
    expect(dels).toHaveLength(1);
    expect(dels![0].recipient_email).toBe("synthetic.free@saviskar.test");
    expect(dels![0].broadcast_delivery_attachments).toHaveLength(1);
    expect(dels![0].broadcast_delivery_attachments[0].certificate_id).toBe(cert!.id);
  });

  it("4. Controlled failure triggers atomic compensating rollback leaving zero orphaned records", async () => {
    const storageClient = getBroadcastStorageClient();
    const rollbackCandidateKey = `solo:test-rollback-${Date.now()}`;
    const rollbackCandidate = {
      issueSourceKey: rollbackCandidateKey,
      participantEventId: "00000000-0000-4000-8000-000000000001",
      participantId: "00000000-0000-4000-8000-000000000002",
      recipientName: "Test Rollback Participant",
      recipientEmail: "synthetic.candidate@saviskar.test",
      eventName: "Rollback Test Event",
      isTeam: false,
      teamName: null,
      certificateEligible: true,
      isValidEmail: true,
    };

    // Proxy storageClient to inject failure during delivery insertion
    let failureInjected = false;
    const failingClient = new Proxy(storageClient, {
      get(target, prop, receiver) {
        if (prop === "from") {
          return (table: string) => {
            if (table === "broadcast_deliveries") {
              const builder = (target as any).from(table);
              return new Proxy(builder, {
                get(bTarget, bProp, bReceiver) {
                  if (bProp === "insert") {
                    return () => {
                      failureInjected = true;
                      return Promise.resolve({
                        error: { message: "SIMULATED_CONTROLLED_DELIVERY_FAILURE" },
                      });
                    };
                  }
                  return Reflect.get(bTarget, bProp, bReceiver);
                },
              });
            }
            return (target as any).from(table);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as any;

    await expect(
      createCertificateCampaign(
        failingClient,
        {
          title: "Rollback Invariant Campaign",
          subject: "Certificate Test Subject",
          bodyHtml: "<p>Certificate</p>",
          selectedItemKeys: [rollbackCandidateKey],
          sendIndividual: true,
          sendTeamBackup: false,
          adminId: hostedMockAdminId,
          adminEmail: hostedMockAdminEmail,
        },
        [rollbackCandidate]
      )
    ).rejects.toThrow(/Failed to enqueue certificate deliveries: SIMULATED_CONTROLLED_DELIVERY_FAILURE/);

    expect(failureInjected).toBe(true);

    // Verify zero orphaned certificates
    const { data: orphanedCerts } = await storageClient
      .from("participation_certificates")
      .select("id")
      .eq("issue_source_key", rollbackCandidateKey);

    expect(orphanedCerts).toHaveLength(0);

    // Verify zero orphaned campaigns
    const { data: orphanedCampaigns } = await storageClient
      .from("broadcast_campaigns")
      .select("id")
      .eq("title", "Rollback Invariant Campaign");

    expect(orphanedCampaigns).toHaveLength(0);
  });

  it("5. sendCampaignEmail strictly blocks @test.com, real domains, and any unapproved domain in hybrid mode", async () => {
    clearMockCampaignDispatches();

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

    // 3. Educational / Other domain (@cgc.edu.in)
    const resEdu = await sendCampaignEmail({
      to: "student@cgc.edu.in",
      subject: "Edu Domain Attempt",
      html: "<p>Test</p>",
    });
    expect(resEdu.success).toBe(false);
    expect(resEdu.errorCode).toBe("UNAPPROVED_HYBRID_RECIPIENT_DOMAIN");

    // Verify nothing was recorded in mockCampaignDispatches
    const dispatches = getMockCampaignDispatches();
    expect(dispatches).toHaveLength(0);
  });

  it("6. sendCampaignEmail permits valid @saviskar.test fixtures through mock provider without outbound request", async () => {
    clearMockCampaignDispatches();

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

  it("7. Synthetic @saviskar.test delivery completes end-to-end via batch worker and mock transport", async () => {
    const storageClient = getBroadcastStorageClient();
    clearMockCampaignDispatches();

    const title = `E2E Mock Batch Test ${Date.now()}`;
    const result = await createGeneralBroadcastCampaign(storageClient, {
      title,
      subject: "E2E Batch Processing Subject",
      bodyHtml: "<p>Batch test</p>",
      selectedEmails: ["synthetic.candidate@saviskar.test"],
      adminId: hostedMockAdminId,
      adminEmail: hostedMockAdminEmail,
    });

    createdCampaignIdsToClean.push(result.campaignId);

    // Process batch
    const batchRes = await processNextBroadcastBatch(storageClient, 5);
    expect(batchRes.processedCount).toBeGreaterThanOrEqual(1);

    // Verify delivery updated in DB to 'sent'
    const { data: dels } = await storageClient
      .from("broadcast_deliveries")
      .select("id, status, provider_message_id, attempts")
      .eq("campaign_id", result.campaignId);

    expect(dels).toHaveLength(1);
    expect(dels![0].status).toBe("sent");
    expect(dels![0].provider_message_id).toMatch(/^mock_/);

    // Verify mock transport captured it
    const dispatches = getMockCampaignDispatches();
    const match = dispatches.find((d) => d.recipientRedacted === "synthetic.candidate@saviskar.test");
    expect(match).toBeDefined();
  });

  it("8. Batch worker strictly marks deliveries with @test.com or real addresses as failed with HYBRID_READONLY_PROTECTION", async () => {
    const storageClient = getBroadcastStorageClient();
    const title = `Prohibited Domain Invariant ${Date.now()}`;

    // Insert a test campaign with a prohibited domain delivery row directly into local DB
    const { data: camp } = await storageClient
      .from("broadcast_campaigns")
      .insert({
        title,
        subject: "Prohibited Test",
        body_html: "<p>Prohibited</p>",
        body_text: "Prohibited",
        campaign_type: "general",
        status: "queued",
        total_recipients: 1,
        total_deliveries: 1,
        created_by: "db9424cb-b505-4cfd-b310-25c230138ca7",
      })
      .select("id")
      .single();

    createdCampaignIdsToClean.push(camp!.id);

    const forbiddenDelId = "00000000-0000-4000-8000-999999999999";
    await storageClient.from("broadcast_deliveries").insert({
      id: forbiddenDelId,
      campaign_id: camp!.id,
      recipient_email: "forbidden_test_runner@test.com",
      channel: "general",
      subject: "Prohibited Test",
      body_html: "<p>Prohibited</p>",
      body_text: "Prohibited",
      status: "queued",
      idempotency_key: `idemp_forbid_${Date.now()}`,
    });

    // Run batch worker
    const batchRes = await processNextBroadcastBatch(storageClient, 5);
    const detail = batchRes.details.find((d) => d.deliveryId === forbiddenDelId);

    expect(detail).toBeDefined();
    expect(detail!.success).toBe(false);

    // Verify database state: status = 'failed', error_code = 'HYBRID_READONLY_PROTECTION'
    const { data: delRow } = await storageClient
      .from("broadcast_deliveries")
      .select("status, error_code, error_message")
      .eq("id", forbiddenDelId)
      .single();

    expect(delRow!.status).toBe("failed");
    expect(delRow!.error_code).toBe("HYBRID_READONLY_PROTECTION");
  });
});
