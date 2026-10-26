import fs from "fs";
import { describe, it, expect, beforeAll } from "vitest";
import {
  isHybridDevelopmentModeActive,
  isSyntheticTestEmail,
  HYBRID_READONLY_ERROR,
  getHostedRegistrationReadClient,
  getBroadcastStorageClient,
  getBroadcastSupabaseAdmin,
  createReadOnlySupabaseClient,
} from "@/lib/broadcast/supabase-admin";
import {
  resolveGeneralBroadcastRecipients,
  resolveCertificateCandidates,
} from "@/lib/broadcast/recipient-resolver";
import {
  SYNTHETIC_GENERAL_RECIPIENTS,
  SYNTHETIC_CERTIFICATE_CANDIDATES,
} from "@/lib/broadcast/hybrid-fixtures";
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

describe("Live Hybrid Mode End-to-End Integration", () => {
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
  it("Verifies hybrid mode is active against local development environment", () => {
    const isHybrid = isHybridDevelopmentModeActive();
    expect(isHybrid).toBe(true);
  });

  it("Reads real hosted participant records without mutation using read-only client", async () => {
    const hostedClient = getHostedRegistrationReadClient();
    const { data: realParticipants, error: realPartErr } = await hostedClient
      .from("participants")
      .select("id, name, email")
      .limit(5);

    expect(realPartErr).toBeNull();
    expect(realParticipants).not.toBeNull();
    expect(realParticipants!.length).toBeGreaterThan(0);

    // Mutation operation must throw immediately via Proxy
    expect(() => hostedClient.from("participants").insert({ name: "Malicious Injection" })).toThrow(
      /Forbidden mutation operation 'insert' attempted on table 'participants'/
    );
  });

  it("Queries local Docker Supabase broadcast tables without PGRST205 errors", async () => {
    const localStorageClient = getBroadcastStorageClient();
    const { data: campaigns, error: campErr } = await localStorageClient
      .from("broadcast_campaigns")
      .select("id, title, status, created_at")
      .limit(5);

    expect(campErr).toBeNull();
    expect(campaigns).not.toBeNull();
  });

  it("Resolves real hosted participants and combines them with synthetic test fixtures", async () => {
    const hostedClient = getHostedRegistrationReadClient();
    const realRecipients = await resolveGeneralBroadcastRecipients(hostedClient);
    expect(realRecipients.length).toBeGreaterThan(0);

    const combinedRecipients = [...SYNTHETIC_GENERAL_RECIPIENTS, ...realRecipients];
    expect(combinedRecipients.length).toBeGreaterThan(realRecipients.length);

    const realCandidates = await resolveCertificateCandidates(hostedClient);
    expect(realCandidates.length).toBeGreaterThan(0);

    const combinedCandidates = [...SYNTHETIC_CERTIFICATE_CANDIDATES, ...realCandidates];
    expect(combinedCandidates.length).toBeGreaterThan(realCandidates.length);

    // Verify synthetic candidate eligibility
    const freeSynth = combinedCandidates.find((c) => c.issueSourceKey === "solo:00000000-0000-4000-8000-000000000001");
    expect(freeSynth?.certificateEligible).toBe(true);

    const paidSynth = combinedCandidates.find((c) => c.issueSourceKey === "solo:00000000-0000-4000-8000-000000000002");
    expect(paidSynth?.certificateEligible).toBe(true);

    const pendingSynth = combinedCandidates.find((c) => c.issueSourceKey === "solo:00000000-0000-4000-8000-000000000003");
    expect(pendingSynth?.certificateEligible).toBe(false);
  }, 30000);

  it("Creates a synthetic certificate campaign into local Docker Supabase and processes via mock provider", async () => {
    const localStorageClient = getBroadcastStorageClient();
    const hostedClient = getHostedRegistrationReadClient();
    const realCandidates = await resolveCertificateCandidates(hostedClient);
    const combinedCandidates = [...SYNTHETIC_CERTIFICATE_CANDIDATES, ...realCandidates];

    const campaignTitle = `Live Integration Hybrid Campaign ${Date.now()}`;
    const campaignResult = await createCertificateCampaign(
      localStorageClient,
      {
        title: campaignTitle,
        subject: "Your Official Certificate of Participation - Saviskar 2026",
        bodyHtml: "<p>Live hybrid test certificate</p>",
        bodyText: "Live hybrid test certificate",
        selectedItemKeys: ["solo:00000000-0000-4000-8000-000000000001"],
        sendIndividual: true,
        sendTeamBackup: false,
        adminId: "db9424cb-b505-4cfd-b310-25c230138ca7",
      },
      combinedCandidates
    );

    expect(campaignResult.campaignId).toBeDefined();
    expect(campaignResult.totalDeliveries).toBe(1);
    expect(campaignResult.totalCertificates).toBe(1);

    clearMockCampaignDispatches();
    const batchResult = await processNextBroadcastBatch(localStorageClient, 5);
    expect(batchResult.processedCount).toBeGreaterThanOrEqual(1);

    const dispatches = getMockCampaignDispatches();
    expect(dispatches.length).toBeGreaterThanOrEqual(1);
    expect(dispatches[0].recipientRedacted).toMatch(/@saviskar\.test$/);
    expect(dispatches[0].attachmentCount).toBe(1);
  }, 30000);
  it("Executes full certificate campaign creation against local Supabase DB using synthetic candidate", async () => {
    // Connect to the verified local test Supabase instance
    const localUrl = "http://127.0.0.1:54321";
    const localKey =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

    const { createClient } = await import("@supabase/supabase-js");
    const localAdmin = createClient(localUrl, localKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Resolve candidates from real local database
    const candidates = await resolveCertificateCandidates(localAdmin);
    expect(candidates.length).toBeGreaterThan(0);

    const eligible = candidates.filter((c) => c.certificateEligible);
    expect(eligible.length).toBeGreaterThanOrEqual(1);

    const freeCandidate = eligible.find((c) => c.recipientName === "Synthetic Eligible Candidate");
    expect(freeCandidate).toBeDefined();
    expect(freeCandidate?.mainCheckedIn).toBe(true);
    expect(freeCandidate?.certificateEligible).toBe(true);

    // 2. Prepare certificate campaign for the synthetic free candidate
    const campaignTitle = `Synthetic Test Certificate Campaign ${Date.now()}`;
    const { createCertificateCampaign } = await import("@/lib/broadcast/campaign-worker");

    const result = await createCertificateCampaign(
      localAdmin,
      {
        title: campaignTitle,
        subject: "Your Official Certificate of Participation - Saviskar 2026",
        bodyHtml: "<p>Congratulations on your participation!</p>",
        bodyText: "Congratulations on your participation!",
        selectedItemKeys: [freeCandidate!.issueSourceKey],
        sendIndividual: true,
        sendTeamBackup: false,
        adminId: "db9424cb-b505-4cfd-b310-25c230138ca7",
      },
      candidates
    );

    expect(result.campaignId).toBeDefined();
    expect(result.totalDeliveries).toBe(1);
    expect(result.totalCertificates).toBe(1);

    // 3. Verify persistence in broadcast_campaigns
    const { data: campaignRow, error: campErr } = await localAdmin
      .from("broadcast_campaigns")
      .select("*")
      .eq("id", result.campaignId)
      .single();

    expect(campErr).toBeNull();
    expect(campaignRow).toBeDefined();
    expect(campaignRow.title).toBe(campaignTitle);
    expect(campaignRow.campaign_type).toBe("certificate");
    expect(campaignRow.status).toBe("queued");
    expect(campaignRow.total_recipients).toBe(1);
    expect(campaignRow.total_deliveries).toBe(1);

    // 4. Verify persistence in participation_certificates
    const { data: certRow, error: certErr } = await localAdmin
      .from("participation_certificates")
      .select("*")
      .eq("issue_source_key", freeCandidate!.issueSourceKey)
      .single();

    expect(certErr).toBeNull();
    expect(certRow).toBeDefined();
    expect(certRow.recipient_name).toBe("Synthetic Eligible Candidate");
    expect(certRow.event_name).toBe("Hackathon 2026");
    expect(certRow.certificate_number).toMatch(/^SAV26-/);

    // 5. Verify persistence in broadcast_deliveries & attachments
    const { data: deliveryRows, error: delErr } = await localAdmin
      .from("broadcast_deliveries")
      .select("*, broadcast_delivery_attachments(*)")
      .eq("campaign_id", result.campaignId);

    expect(delErr).toBeNull();
    expect(deliveryRows).not.toBeNull();
    expect(deliveryRows).toHaveLength(1);
    const firstDelivery = deliveryRows![0];
    expect(firstDelivery.recipient_email).toBe("synthetic.candidate@saviskar.test");
    expect(firstDelivery.status).toBe("queued");
    expect(firstDelivery.broadcast_delivery_attachments).toHaveLength(1);
    expect(firstDelivery.broadcast_delivery_attachments[0].certificate_id).toBe(certRow.id);
  }, 30000);
});
