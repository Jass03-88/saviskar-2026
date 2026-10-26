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
});
