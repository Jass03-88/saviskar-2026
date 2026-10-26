import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as getRecipientsRoute } from "@/app/api/admin/broadcast/recipients/route";
import {
  GET as getCampaignsRoute,
  POST as postCampaignsRoute,
} from "@/app/api/admin/broadcast/campaigns/route";
import { POST as postTestSendRoute } from "@/app/api/admin/broadcast/campaigns/[id]/test-send/route";
import { POST as postProcessBatchRoute } from "@/app/api/admin/broadcast/campaigns/[id]/process-batch/route";
import { POST as postRetryRoute } from "@/app/api/admin/broadcast/campaigns/[id]/retry/route";
import { GET as getCampaignDetailsRoute } from "@/app/api/admin/broadcast/campaigns/[id]/route";
import * as adminLib from "@/lib/broadcast/supabase-admin";
import {
  isLiveBroadcastEnabled,
  isPreviewDeployment,
  isProductionReadOnlyEnabled,
  getBroadcastOperationalMode,
  extractHostFromRequest,
  extractHostFromSiteUrl,
  isCanonicalProductionHost,
  CANONICAL_PRODUCTION_HOSTS,
  PRODUCTION_READONLY_ERROR,
} from "@/lib/broadcast/supabase-admin";
import {
  createGeneralBroadcastCampaign,
  createCertificateCampaign,
  processNextBroadcastBatch,
} from "@/lib/broadcast/campaign-worker";
import { sendCampaignEmail } from "@/lib/email/campaign-service";
import * as serverLib from "@/lib/supabase/server";
import * as recipientResolverLib from "@/lib/broadcast/recipient-resolver";
import {
  SYNTHETIC_GENERAL_RECIPIENTS,
  SYNTHETIC_CERTIFICATE_CANDIDATES,
} from "@/lib/broadcast/hybrid-fixtures";

describe("Saviskar 2026 — Fail-Closed Preview Deployment Safety Suite", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    // Default test setup: Master Admin session valid
    vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
      user: { id: "master-uuid", email: "admin@saviskar.test" },
      role: "master",
    } as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // =========================================================================
  // 1. Environment Detection & Default Fail-Closed Invariants
  // =========================================================================
  describe("Deployment Environment Detection Invariants", () => {
    it("Invariant 1: Unconfigured / missing flag defaults to Preview Mode (fail-closed)", () => {
      (process.env as any).NODE_ENV = "production";
      delete process.env.SAVISKAR_BROADCAST_LIVE_ENABLED;
      delete process.env.BROADCAST_LIVE_DISPATCH_ENABLED;
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(false);

      expect(isLiveBroadcastEnabled()).toBe(false);
      expect(isPreviewDeployment()).toBe(true);
      expect(getBroadcastOperationalMode()).toBe("preview");
    });

    it("Invariant 1b: Alternate flag BROADCAST_LIVE_DISPATCH_ENABLED cannot authorize live mode (only SAVISKAR_BROADCAST_LIVE_ENABLED is canonical)", () => {
      (process.env as any).NODE_ENV = "production";
      delete process.env.SAVISKAR_BROADCAST_LIVE_ENABLED;
      process.env.BROADCAST_LIVE_DISPATCH_ENABLED = "true";
      process.env.NEXT_PUBLIC_SITE_URL = "https://saviskar.co.in";
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(false);

      expect(isLiveBroadcastEnabled()).toBe(false);
      expect(isPreviewDeployment()).toBe(true);
      expect(getBroadcastOperationalMode()).toBe("preview");
    });

    it("Invariant 2: Hostinger or Vercel preview environments force Preview Mode even if activation flag is set", () => {
      process.env.SAVISKAR_BROADCAST_LIVE_ENABLED = "true";
      process.env.VERCEL_ENV = "preview";
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(false);

      expect(isLiveBroadcastEnabled()).toBe(false);
      expect(isPreviewDeployment()).toBe(true);
      expect(getBroadcastOperationalMode()).toBe("preview");

      delete process.env.VERCEL_ENV;
      process.env.APP_ENV = "preview";
      expect(isLiveBroadcastEnabled()).toBe(false);
      expect(isPreviewDeployment()).toBe(true);
    });

    it("Invariant 3: Production live mode requires explicit flag and non-preview production environment", () => {
      (process.env as any).NODE_ENV = "production";
      process.env.SAVISKAR_BROADCAST_LIVE_ENABLED = "true";
      process.env.NEXT_PUBLIC_SITE_URL = "https://saviskar.co.in";
      delete process.env.VERCEL_ENV;
      delete process.env.APP_ENV;
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(false);

      expect(isLiveBroadcastEnabled()).toBe(true);
      expect(isPreviewDeployment()).toBe(false);
      expect(getBroadcastOperationalMode()).toBe("live_production");
    });

    it("Invariant 4: Local hybrid development mode is preserved when active", () => {
      process.env.SAVISKAR_HYBRID_MODE = "true";
      delete process.env.SAVISKAR_BROADCAST_LIVE_ENABLED;

      expect(isPreviewDeployment()).toBe(false);
      expect(getBroadcastOperationalMode()).toBe("hybrid_development");
    });

    it("Invariant 5: Hostinger or preview site URL forces Preview Mode even if activation flag is set", () => {
      (process.env as any).NODE_ENV = "production";
      process.env.SAVISKAR_BROADCAST_LIVE_ENABLED = "true";
      process.env.NEXT_PUBLIC_SITE_URL = "https://preview-instance.hostingerapp.com";
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(false);

      expect(isLiveBroadcastEnabled()).toBe(false);
      expect(isPreviewDeployment()).toBe(true);
      expect(getBroadcastOperationalMode()).toBe("preview");
    });
  });

  // =========================================================================
  // 2. Preview Mode Recipient Safety & Data Isolation
  // =========================================================================
  describe("Preview Recipient Read Isolation", () => {
    it("GET /api/admin/broadcast/recipients?type=general returns ONLY synthetic test recipients in preview mode", async () => {
      vi.spyOn(adminLib, "isPreviewDeployment").mockReturnValue(true);
      const resolveSpy = vi.spyOn(recipientResolverLib, "resolveGeneralBroadcastRecipients");

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/recipients?type=general");
      const res = await getRecipientsRoute(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.isPreviewMode).toBe(true);
      expect(json.mode).toBe("preview");
      expect(json.isLiveProduction).toBe(false);

      // Must NEVER query live production tables
      expect(resolveSpy).not.toHaveBeenCalled();

      // All returned recipients must be strictly synthetic @saviskar.test
      expect(json.recipients.length).toBe(SYNTHETIC_GENERAL_RECIPIENTS.length);
      for (const r of json.recipients) {
        expect(r.normalizedEmail).toMatch(/@saviskar\.test$/);
      }
    });

    it("GET /api/admin/broadcast/recipients?type=certificate returns ONLY synthetic candidates in preview mode", async () => {
      vi.spyOn(adminLib, "isPreviewDeployment").mockReturnValue(true);
      const resolveCertSpy = vi.spyOn(recipientResolverLib, "resolveCertificateCandidates");

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/recipients?type=certificate");
      const res = await getRecipientsRoute(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.isPreviewMode).toBe(true);
      expect(json.mode).toBe("preview");

      // Must NEVER query live registration database
      expect(resolveCertSpy).not.toHaveBeenCalled();

      expect(json.recipients.length).toBe(SYNTHETIC_CERTIFICATE_CANDIDATES.length);
      for (const c of json.recipients) {
        if (c.recipientEmail) {
          expect(c.recipientEmail).toMatch(/@saviskar\.test$/);
        }
      }
    });
  });

  // =========================================================================
  // 3. Preview Mode Mutation & Dispatch Denial
  // =========================================================================
  describe("Preview Mode Mutation Denial (Server-Side Enforcement)", () => {
    it("POST /api/admin/broadcast/campaigns is rejected with 403 in preview mode", async () => {
      vi.spyOn(adminLib, "isPreviewDeployment").mockReturnValue(true);
      const storageSpy = vi.spyOn(adminLib, "getBroadcastSupabaseAdmin");

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns", {
        method: "POST",
        body: JSON.stringify({
          title: "Preview Test Campaign",
          subject: "Test Subject",
          bodyHtml: "<p>Hello</p>",
          campaignType: "general",
          selectedEmails: ["synthetic.candidate@saviskar.test"],
        }),
      });

      const res = await postCampaignsRoute(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe("PREVIEW_MODE_READ_ONLY");
      expect(json.error).toContain("disabled in Preview Mode");

      // Storage client must not even be initialized for writing
      expect(storageSpy).not.toHaveBeenCalled();
    });

    it("POST /api/admin/broadcast/campaigns for certificates is rejected with 403 in preview mode", async () => {
      vi.spyOn(adminLib, "isPreviewDeployment").mockReturnValue(true);
      const storageSpy = vi.spyOn(adminLib, "getBroadcastSupabaseAdmin");

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns", {
        method: "POST",
        body: JSON.stringify({
          title: "Certificate Dispatch Campaign",
          subject: "Your Certificate",
          bodyHtml: "<p>Certificate attached</p>",
          campaignType: "certificate",
          selectedCandidates: ["reg-1"],
        }),
      });

      const res = await postCampaignsRoute(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe("PREVIEW_MODE_READ_ONLY");
      expect(storageSpy).not.toHaveBeenCalled();
    });

    it("POST /api/admin/broadcast/campaigns/[id]/test-send is rejected with 403 in preview mode", async () => {
      vi.spyOn(adminLib, "isPreviewDeployment").mockReturnValue(true);

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/c-1/test-send", {
        method: "POST",
        body: JSON.stringify({
          testEmail: "admin@saviskar.test",
        }),
      });

      const res = await postTestSendRoute(req, { params: Promise.resolve({ id: "c-1" }) });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe("PREVIEW_MODE_DISPATCH_DISABLED");
    });

    it("POST /api/admin/broadcast/campaigns/[id]/process-batch is rejected with 403 in preview mode", async () => {
      vi.spyOn(adminLib, "isPreviewDeployment").mockReturnValue(true);

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/c-1/process-batch", {
        method: "POST",
        body: JSON.stringify({ batchSize: 10 }),
      });

      const res = await postProcessBatchRoute(req, { params: Promise.resolve({ id: "c-1" }) });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe("PREVIEW_MODE_PROCESSING_DISABLED");
    });

    it("POST /api/admin/broadcast/campaigns/[id]/retry is rejected with 403 in preview mode", async () => {
      vi.spyOn(adminLib, "isPreviewDeployment").mockReturnValue(true);

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/c-1/retry", {
        method: "POST",
        body: JSON.stringify({ deliveryIds: ["del-1"], action: "retry_failed" }),
      });

      const res = await postRetryRoute(req, { params: Promise.resolve({ id: "c-1" }) });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe("PREVIEW_MODE_RETRY_DISABLED");
    });

    it("GET /api/admin/broadcast/campaigns/[id] returns 404 in preview mode", async () => {
      vi.spyOn(adminLib, "isPreviewDeployment").mockReturnValue(true);

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/c-1");
      const res = await getCampaignDetailsRoute(req, { params: Promise.resolve({ id: "c-1" }) });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.code).toBe("PREVIEW_MODE_UNAVAILABLE");
    });

    it("GET /api/admin/broadcast/campaigns returns 200 with empty list in preview mode without failing on unapplied tables", async () => {
      vi.spyOn(adminLib, "isPreviewDeployment").mockReturnValue(true);

      const res = await getCampaignsRoute();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.campaigns).toEqual([]);
      expect(json.isPreviewMode).toBe(true);
      expect(json.mode).toBe("preview");
    });
  });

  // =========================================================================
  // 4. Transport-Level Dispatch Safety
  // =========================================================================
  describe("Transport-Level Email Dispatch Guard", () => {
    it("sendCampaignEmail strictly fails closed when isPreviewDeployment() is true", async () => {
      vi.spyOn(adminLib, "isPreviewDeployment").mockReturnValue(true);

      const result = await sendCampaignEmail({
        to: "synthetic.candidate@saviskar.test",
        subject: "Preview Test",
        html: "<p>Preview</p>",
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("PREVIEW_DISPATCH_DISABLED");
    });

    it("sendCampaignEmail blocks outbound dispatch if live broadcast is not explicitly enabled in non-mock environments", async () => {
      vi.spyOn(adminLib, "isPreviewDeployment").mockReturnValue(false);
      vi.spyOn(adminLib, "isLiveBroadcastEnabled").mockReturnValue(false);
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(false);
      (process.env as any).NODE_ENV = "production";
      process.env.RESEND_CAMPAIGN_FROM_EMAIL = "Saviskar Updates <broadcast@updates.saviskar.co.in>";

      const result = await sendCampaignEmail({
        to: "student@gmail.com",
        subject: "Live Test",
        html: "<p>Live</p>",
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("LIVE_BROADCAST_DISABLED");
    });
  });

  // =========================================================================
  // 5. Master Admin Authorization Persistence
  // =========================================================================
  describe("Master Admin Authorization Persistence", () => {
    it("Preview routes still strictly enforce requireMasterAdmin()", async () => {
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
        error: "Master Admin access required",
        status: 403,
      } as any);

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/recipients");
      const res = await getRecipientsRoute(req);
      expect(res.status).toBe(403);
    });

    it("Preview routes still strictly enforce MFA requirements", async () => {
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
        error: "MFA_REQUIRED",
        status: 403,
      } as any);

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/recipients");
      const res = await getRecipientsRoute(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("Master Admin MFA verification required.");
    });
  });

  // =========================================================================
  // 6. Hostinger Preview Domain Simulation & Host Validation Suite
  // =========================================================================
  describe("Hostinger Preview Domain Simulation & Host Verification", () => {
    const HOSTINGER_PREVIEW_URL = "https://firebrick-caterpillar-749126.hostingersite.com";
    const HOSTINGER_PREVIEW_HOST = "firebrick-caterpillar-749126.hostingersite.com";

    it("Simulation 1: Actual request host is firebrick-caterpillar-749126.hostingersite.com while NEXT_PUBLIC_SITE_URL is saviskar.co.in and live flag is accidentally present", async () => {
      (process.env as any).NODE_ENV = "production";
      process.env.SAVISKAR_BROADCAST_LIVE_ENABLED = "true";
      process.env.NEXT_PUBLIC_SITE_URL = "https://saviskar.co.in";
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(false);

      const req = new NextRequest(
        `${HOSTINGER_PREVIEW_URL}/api/admin/broadcast/recipients?type=general`,
        {
          headers: {
            host: HOSTINGER_PREVIEW_HOST,
            "x-forwarded-host": HOSTINGER_PREVIEW_HOST,
          },
        }
      );

      // Operational mode must strictly resolve to PREVIEW (fail-closed)
      expect(extractHostFromRequest(req)).toBe(HOSTINGER_PREVIEW_HOST);
      expect(isCanonicalProductionHost(HOSTINGER_PREVIEW_HOST)).toBe(false);
      expect(isLiveBroadcastEnabled(req)).toBe(false);
      expect(isPreviewDeployment(req)).toBe(true);
      expect(getBroadcastOperationalMode(req)).toBe("preview");

      // Verify recipient isolation: NEVER queries production tables
      const resolveSpy = vi.spyOn(recipientResolverLib, "resolveGeneralBroadcastRecipients");
      const res = await getRecipientsRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.isPreviewMode).toBe(true);
      expect(json.mode).toBe("preview");
      expect(resolveSpy).not.toHaveBeenCalled();
      for (const r of json.recipients) {
        expect(r.normalizedEmail).toMatch(/@saviskar\.test$/);
      }
    });

    it("Simulation 2: Campaign mutation rejected with 403 on Hostinger preview host even with live flag set", async () => {
      (process.env as any).NODE_ENV = "production";
      process.env.SAVISKAR_BROADCAST_LIVE_ENABLED = "true";
      process.env.NEXT_PUBLIC_SITE_URL = "https://saviskar.co.in";
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(false);

      const req = new NextRequest(`${HOSTINGER_PREVIEW_URL}/api/admin/broadcast/campaigns`, {
        method: "POST",
        headers: {
          host: HOSTINGER_PREVIEW_HOST,
          "x-forwarded-host": HOSTINGER_PREVIEW_HOST,
        },
        body: JSON.stringify({
          title: "Accidental Live Attempt",
          subject: "Test",
          bodyHtml: "<p>Test</p>",
          campaignType: "general",
          selectedEmails: ["synthetic.candidate@saviskar.test"],
        }),
      });

      const res = await postCampaignsRoute(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe("PREVIEW_MODE_READ_ONLY");
    });

    it("Simulation 3: Batch processing and retry rejected with 403 on Hostinger preview host", async () => {
      (process.env as any).NODE_ENV = "production";
      process.env.SAVISKAR_BROADCAST_LIVE_ENABLED = "true";
      process.env.NEXT_PUBLIC_SITE_URL = "https://saviskar.co.in";
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(false);

      const batchReq = new NextRequest(
        `${HOSTINGER_PREVIEW_URL}/api/admin/broadcast/campaigns/c-1/process-batch`,
        {
          method: "POST",
          headers: { host: HOSTINGER_PREVIEW_HOST },
          body: JSON.stringify({ batchSize: 5 }),
        }
      );
      const batchRes = await postProcessBatchRoute(batchReq, { params: Promise.resolve({ id: "c-1" }) });
      expect(batchRes.status).toBe(403);
      expect((await batchRes.json()).code).toBe("PREVIEW_MODE_PROCESSING_DISABLED");

      const retryReq = new NextRequest(
        `${HOSTINGER_PREVIEW_URL}/api/admin/broadcast/campaigns/c-1/retry`,
        {
          method: "POST",
          headers: { host: HOSTINGER_PREVIEW_HOST },
          body: JSON.stringify({ deliveryIds: ["del-1"] }),
        }
      );
      const retryRes = await postRetryRoute(retryReq, { params: Promise.resolve({ id: "c-1" }) });
      expect(retryRes.status).toBe(403);
      expect((await retryRes.json()).code).toBe("PREVIEW_MODE_RETRY_DISABLED");
    });

    it("Simulation 4: sendCampaignEmail fails closed when request host is Hostinger preview domain", async () => {
      (process.env as any).NODE_ENV = "production";
      process.env.SAVISKAR_BROADCAST_LIVE_ENABLED = "true";
      process.env.NEXT_PUBLIC_SITE_URL = "https://saviskar.co.in";
      process.env.RESEND_CAMPAIGN_FROM_EMAIL = "Saviskar Updates <broadcast@updates.saviskar.co.in>";
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(false);

      const previewReq = new NextRequest(`${HOSTINGER_PREVIEW_URL}/admin/broadcast`, {
        headers: { host: HOSTINGER_PREVIEW_HOST },
      });

      const res = await sendCampaignEmail({
        to: "student@gmail.com",
        subject: "Disallowed Outbound",
        html: "<p>Blocked</p>",
        request: previewReq,
      });

      expect(res.success).toBe(false);
      expect(res.errorCode).toBe("PREVIEW_DISPATCH_DISABLED");
    });

    it("Simulation 5: Preview environment missing deployment-specific env vars defaults to safe Preview Mode", () => {
      (process.env as any).NODE_ENV = "production";
      delete process.env.SAVISKAR_BROADCAST_LIVE_ENABLED;
      delete process.env.BROADCAST_LIVE_DISPATCH_ENABLED;
      delete process.env.NEXT_PUBLIC_SITE_URL;
      delete process.env.VERCEL_ENV;
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(false);

      const req = new NextRequest(`${HOSTINGER_PREVIEW_URL}/admin/broadcast`, {
        headers: { host: HOSTINGER_PREVIEW_HOST },
      });

      expect(isLiveBroadcastEnabled(req)).toBe(false);
      expect(isPreviewDeployment(req)).toBe(true);
      expect(getBroadcastOperationalMode(req)).toBe("preview");
    });

    it("Simulation 6: Actual production host saviskar.co.in authorizes live production when explicitly enabled", () => {
      (process.env as any).NODE_ENV = "production";
      process.env.SAVISKAR_BROADCAST_LIVE_ENABLED = "true";
      process.env.NEXT_PUBLIC_SITE_URL = "https://saviskar.co.in";
      delete process.env.VERCEL_ENV;
      delete process.env.APP_ENV;
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(false);

      const req = new NextRequest("https://saviskar.co.in/api/admin/broadcast/recipients", {
        headers: { host: "saviskar.co.in" },
      });

      expect(extractHostFromRequest(req)).toBe("saviskar.co.in");
      expect(isCanonicalProductionHost("saviskar.co.in")).toBe(true);
      expect(isLiveBroadcastEnabled(req)).toBe(true);
      expect(isPreviewDeployment(req)).toBe(false);
      expect(getBroadcastOperationalMode(req)).toBe("live_production");

      // Also verify www subdomain
      const reqWww = new NextRequest("https://www.saviskar.co.in/api/admin/broadcast/recipients", {
        headers: { host: "www.saviskar.co.in" },
      });
      expect(isLiveBroadcastEnabled(reqWww)).toBe(true);
      expect(isPreviewDeployment(reqWww)).toBe(false);
    });

    it("Simulation 7: Unknown, attacker, or malformed host headers strictly fail closed", () => {
      (process.env as any).NODE_ENV = "production";
      process.env.SAVISKAR_BROADCAST_LIVE_ENABLED = "true";
      process.env.NEXT_PUBLIC_SITE_URL = "https://saviskar.co.in";

      const badHosts = [
        "evil-attacker.com",
        "192.168.1.1",
        "saviskar.co.in.attacker.com",
        ":::malformed",
        "saviskar-staging.otherdomain.net",
      ];

      for (const badHost of badHosts) {
        const req = new NextRequest("https://localhost:3000/admin/broadcast", {
          headers: { host: badHost, "x-forwarded-host": badHost },
        });

        expect(isCanonicalProductionHost(badHost)).toBe(false);
        expect(isLiveBroadcastEnabled(req)).toBe(false);
        expect(isPreviewDeployment(req)).toBe(true);
        expect(getBroadcastOperationalMode(req)).toBe("preview");
      }
    });

    it("Simulation 8: req.nextUrl.hostname is Hostinger preview host but incoming x-forwarded-host claims saviskar.co.in (anti-spoofing guard)", () => {
      (process.env as any).NODE_ENV = "production";
      process.env.SAVISKAR_BROADCAST_LIVE_ENABLED = "true";
      process.env.NEXT_PUBLIC_SITE_URL = "https://saviskar.co.in";
      delete process.env.VERCEL_ENV;
      delete process.env.APP_ENV;
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(false);

      // Request URL is the actual Hostinger preview host, but an incoming header attempts to spoof production
      const req = new NextRequest(
        `${HOSTINGER_PREVIEW_URL}/api/admin/broadcast/recipients?type=general`,
        {
          headers: {
            host: "saviskar.co.in",
            "x-forwarded-host": "saviskar.co.in",
          },
        }
      );

      // Ensure req.nextUrl.hostname is the preview host
      expect(req.nextUrl.hostname).toBe(HOSTINGER_PREVIEW_HOST);

      // The extracted host must resolve to the real preview host, rejecting the spoofed header
      expect(extractHostFromRequest(req)).toBe(HOSTINGER_PREVIEW_HOST);
      expect(isCanonicalProductionHost(extractHostFromRequest(req))).toBe(false);

      // Live mode must be denied and preview mode enforced
      expect(isLiveBroadcastEnabled(req)).toBe(false);
      expect(isPreviewDeployment(req)).toBe(true);
      expect(getBroadcastOperationalMode(req)).toBe("preview");
    });
  });

  // =========================================================================
  // 6. Production Read-Only Mode Safety & Isolation Invariants
  // =========================================================================
  describe("Production Read-Only Mode Safety & Isolation Invariants", () => {
    const PROD_CANONICAL_URL = "https://saviskar.co.in";
    const PROD_CANONICAL_HOST = "saviskar.co.in";

    it("1. isProductionReadOnlyEnabled is true ONLY on canonical host with explicit flag", () => {
      (process.env as any).NODE_ENV = "production";
      process.env.SAVISKAR_BROADCAST_PRODUCTION_READONLY_ENABLED = "true";
      process.env.NEXT_PUBLIC_SITE_URL = PROD_CANONICAL_URL;
      delete process.env.SAVISKAR_BROADCAST_LIVE_ENABLED;
      delete process.env.VERCEL_ENV;
      delete process.env.APP_ENV;
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(false);

      const req = new NextRequest(`${PROD_CANONICAL_URL}/api/admin/broadcast/recipients`, {
        headers: { host: PROD_CANONICAL_HOST },
      });

      expect(isProductionReadOnlyEnabled(req)).toBe(true);
      expect(isLiveBroadcastEnabled(req)).toBe(false);
      expect(isPreviewDeployment(req)).toBe(false);
      expect(getBroadcastOperationalMode(req)).toBe("production_readonly");
    });

    it("2. isProductionReadOnlyEnabled fails closed (false) when flag is missing, empty, or false", () => {
      (process.env as any).NODE_ENV = "production";
      delete process.env.SAVISKAR_BROADCAST_PRODUCTION_READONLY_ENABLED;
      process.env.NEXT_PUBLIC_SITE_URL = PROD_CANONICAL_URL;

      const req = new NextRequest(`${PROD_CANONICAL_URL}/api/admin/broadcast/recipients`, {
        headers: { host: PROD_CANONICAL_HOST },
      });

      expect(isProductionReadOnlyEnabled(req)).toBe(false);

      process.env.SAVISKAR_BROADCAST_PRODUCTION_READONLY_ENABLED = "false";
      expect(isProductionReadOnlyEnabled(req)).toBe(false);

      process.env.SAVISKAR_BROADCAST_PRODUCTION_READONLY_ENABLED = "1";
      expect(isProductionReadOnlyEnabled(req)).toBe(false);
    });

    it("3. isProductionReadOnlyEnabled strictly fails closed on Hostinger preview host even if flag is set in env", () => {
      (process.env as any).NODE_ENV = "production";
      process.env.SAVISKAR_BROADCAST_PRODUCTION_READONLY_ENABLED = "true";
      process.env.NEXT_PUBLIC_SITE_URL = PROD_CANONICAL_URL;
      delete process.env.VERCEL_ENV;
      delete process.env.APP_ENV;
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(false);

      const previewReq = new NextRequest(
        `https://firebrick-caterpillar-749126.hostingersite.com/api/admin/broadcast/recipients`,
        {
          headers: { host: "firebrick-caterpillar-749126.hostingersite.com" },
        }
      );

      // Must strictly deny production read-only on preview hosts
      expect(isProductionReadOnlyEnabled(previewReq)).toBe(false);
      expect(isLiveBroadcastEnabled(previewReq)).toBe(false);
      expect(isPreviewDeployment(previewReq)).toBe(true);
      expect(getBroadcastOperationalMode(previewReq)).toBe("preview");
    });

    it("4. Anti-spoofing: preview request with spoofed x-forwarded-host claiming saviskar.co.in cannot enter read-only mode", () => {
      (process.env as any).NODE_ENV = "production";
      process.env.SAVISKAR_BROADCAST_PRODUCTION_READONLY_ENABLED = "true";
      process.env.NEXT_PUBLIC_SITE_URL = PROD_CANONICAL_URL;
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(false);

      const spoofReq = new NextRequest(
        `https://firebrick-caterpillar-749126.hostingersite.com/api/admin/broadcast/recipients`,
        {
          headers: {
            host: "saviskar.co.in",
            "x-forwarded-host": "saviskar.co.in",
          },
        }
      );

      expect(spoofReq.nextUrl.hostname).toBe("firebrick-caterpillar-749126.hostingersite.com");
      expect(isProductionReadOnlyEnabled(spoofReq)).toBe(false);
      expect(isLiveBroadcastEnabled(spoofReq)).toBe(false);
      expect(isPreviewDeployment(spoofReq)).toBe(true);
      expect(getBroadcastOperationalMode(spoofReq)).toBe("preview");
    });

    it("5. Production read-only mode allows querying real recipient lists on canonical host", async () => {
      (process.env as any).NODE_ENV = "production";
      process.env.SAVISKAR_BROADCAST_PRODUCTION_READONLY_ENABLED = "true";
      process.env.NEXT_PUBLIC_SITE_URL = PROD_CANONICAL_URL;
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(false);
      vi.spyOn(adminLib, "getHostedRegistrationReadClient").mockReturnValue({} as any);

      // Mock real participant records returned from hosted read client
      const realHostedRecipients = [
        {
          id: "real-reg-1",
          fullName: "Real Participant",
          email: "real.participant@university.edu",
          isValidEmail: true,
          college: "Engineering College",
          registrationDate: "2026-10-20",
        },
      ];
      vi.spyOn(recipientResolverLib, "resolveGeneralBroadcastRecipients").mockResolvedValue(
        realHostedRecipients as any
      );

      const req = new NextRequest(`${PROD_CANONICAL_URL}/api/admin/broadcast/recipients?type=general`, {
        headers: { host: PROD_CANONICAL_HOST },
      });

      const res = await getRecipientsRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.mode).toBe("production_readonly");
      expect(json.isProductionReadOnly).toBe(true);
      expect(json.isPreviewMode).toBe(false);
      expect(json.isLiveProduction).toBe(false);
      expect(json.total).toBe(1);
      expect(json.recipients[0].email).toBe("real.participant@university.edu");
      expect(json.recipients[0].email).not.toContain("@saviskar.test");
    });

    it("6. Production read-only mode allows querying real certificate eligibility on canonical host", async () => {
      (process.env as any).NODE_ENV = "production";
      process.env.SAVISKAR_BROADCAST_PRODUCTION_READONLY_ENABLED = "true";
      process.env.NEXT_PUBLIC_SITE_URL = PROD_CANONICAL_URL;
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(false);
      vi.spyOn(adminLib, "getHostedRegistrationReadClient").mockReturnValue({} as any);

      const realCandidates = [
        {
          issueSourceKey: "solo:real-pe-1",
          participantEventId: "real-pe-1",
          recipientName: "Certified Winner",
          recipientEmail: "winner@university.edu",
          isValidEmail: true,
          eventName: "Robotics Championship",
          certificateEligible: true,
          paymentConfirmed: true,
          attendedOrWon: true,
        },
      ];
      vi.spyOn(recipientResolverLib, "resolveCertificateCandidates").mockResolvedValue(
        realCandidates as any
      );

      const req = new NextRequest(
        `${PROD_CANONICAL_URL}/api/admin/broadcast/recipients?type=certificate`,
        { headers: { host: PROD_CANONICAL_HOST } }
      );

      const res = await getRecipientsRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.mode).toBe("production_readonly");
      expect(json.isProductionReadOnly).toBe(true);
      expect(json.isPreviewMode).toBe(false);
      expect(json.recipients[0].recipientEmail).toBe("winner@university.edu");
    });

    it("7. Production read-only mode allows querying real campaign history on canonical host", async () => {
      (process.env as any).NODE_ENV = "production";
      process.env.SAVISKAR_BROADCAST_PRODUCTION_READONLY_ENABLED = "true";
      process.env.NEXT_PUBLIC_SITE_URL = PROD_CANONICAL_URL;
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(false);

      const mockCampaigns = [
        {
          id: "camp-prod-1",
          title: "Production History Campaign",
          subject: "Subject",
          campaign_type: "general",
          status: "completed",
          total_recipients: 150,
          total_deliveries: 150,
          sent_count: 150,
          created_at: "2026-10-25T10:00:00Z",
        },
      ];

      vi.spyOn(adminLib, "getBroadcastSupabaseAdmin").mockReturnValue({
        from: () => ({
          select: () => ({
            order: () => ({
              limit: vi.fn().mockResolvedValue({ data: mockCampaigns, error: null }),
            }),
          }),
        }),
      } as any);

      const req = new NextRequest(`${PROD_CANONICAL_URL}/api/admin/broadcast/campaigns`, {
        headers: { host: PROD_CANONICAL_HOST },
      });

      const res = await getCampaignsRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.mode).toBe("production_readonly");
      expect(json.isProductionReadOnly).toBe(true);
      expect(json.campaigns.length).toBe(1);
      expect(json.campaigns[0].title).toBe("Production History Campaign");
    });

    it("8. POST /api/admin/broadcast/campaigns is strictly rejected with 403 in production read-only mode", async () => {
      (process.env as any).NODE_ENV = "production";
      process.env.SAVISKAR_BROADCAST_PRODUCTION_READONLY_ENABLED = "true";
      process.env.NEXT_PUBLIC_SITE_URL = PROD_CANONICAL_URL;
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(false);

      const storageSpy = vi.spyOn(adminLib, "getBroadcastSupabaseAdmin");

      const req = new NextRequest(`${PROD_CANONICAL_URL}/api/admin/broadcast/campaigns`, {
        method: "POST",
        headers: { host: PROD_CANONICAL_HOST },
        body: JSON.stringify({
          title: "Attempted Read-Only Mutation",
          subject: "Blocked",
          bodyHtml: "<p>Should not save</p>",
          campaignType: "general",
          selectedEmails: ["user@saviskar.co.in"],
        }),
      });

      const res = await postCampaignsRoute(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe("PRODUCTION_READONLY_MODE_MUTATION_DENIED");
      expect(json.error).toContain("disabled in Production Read-Only Mode");

      // No database write client invoked
      expect(storageSpy).not.toHaveBeenCalled();
    });

    it("9. POST test-send, process-batch, and retry are all rejected with 403 in production read-only mode", async () => {
      (process.env as any).NODE_ENV = "production";
      process.env.SAVISKAR_BROADCAST_PRODUCTION_READONLY_ENABLED = "true";
      process.env.NEXT_PUBLIC_SITE_URL = PROD_CANONICAL_URL;
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(false);

      // Test send
      const testSendReq = new NextRequest(
        `${PROD_CANONICAL_URL}/api/admin/broadcast/campaigns/c-1/test-send`,
        {
          method: "POST",
          headers: { host: PROD_CANONICAL_HOST },
          body: JSON.stringify({ testEmail: "tester@saviskar.co.in" }),
        }
      );
      const testRes = await postTestSendRoute(testSendReq, { params: Promise.resolve({ id: "c-1" }) });
      expect(testRes.status).toBe(403);
      expect((await testRes.json()).code).toBe("PRODUCTION_READONLY_MODE_DISPATCH_DISABLED");

      // Process batch
      const batchReq = new NextRequest(
        `${PROD_CANONICAL_URL}/api/admin/broadcast/campaigns/c-1/process-batch`,
        {
          method: "POST",
          headers: { host: PROD_CANONICAL_HOST },
          body: JSON.stringify({ batchSize: 10 }),
        }
      );
      const batchRes = await postProcessBatchRoute(batchReq, { params: Promise.resolve({ id: "c-1" }) });
      expect(batchRes.status).toBe(403);
      expect((await batchRes.json()).code).toBe("PRODUCTION_READONLY_MODE_PROCESSING_DISABLED");

      // Retry
      const retryReq = new NextRequest(
        `${PROD_CANONICAL_URL}/api/admin/broadcast/campaigns/c-1/retry`,
        {
          method: "POST",
          headers: { host: PROD_CANONICAL_HOST },
          body: JSON.stringify({ deliveryIds: ["del-1"] }),
        }
      );
      const retryRes = await postRetryRoute(retryReq, { params: Promise.resolve({ id: "c-1" }) });
      expect(retryRes.status).toBe(403);
      expect((await retryRes.json()).code).toBe("PRODUCTION_READONLY_MODE_RETRY_DISABLED");
    });

    it("10. Email transport and worker functions strictly fail closed in production read-only mode", async () => {
      (process.env as any).NODE_ENV = "production";
      process.env.SAVISKAR_BROADCAST_PRODUCTION_READONLY_ENABLED = "true";
      process.env.NEXT_PUBLIC_SITE_URL = PROD_CANONICAL_URL;
      vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(false);

      const req = new NextRequest(`${PROD_CANONICAL_URL}/admin/broadcast`, {
        headers: { host: PROD_CANONICAL_HOST },
      });

      // Transport dispatch attempt
      const sendResult = await sendCampaignEmail({
        to: "recipient@university.edu",
        subject: "Read Only Test",
        html: "<p>Should be blocked</p>",
        request: req,
      });
      expect(sendResult.success).toBe(false);
      expect(sendResult.errorCode).toBe("PRODUCTION_READONLY_DISPATCH_DISABLED");

      // Worker mutations fail closed
      await expect(
        createGeneralBroadcastCampaign(null as any, {
          title: "Blocked",
          subject: "Blocked",
          bodyHtml: "<p>b</p>",
          selectedEmails: ["a@b.com"],
          adminId: "adm-1",
        })
      ).rejects.toThrow(PRODUCTION_READONLY_ERROR);

      await expect(
        createCertificateCampaign(null as any, {
          title: "Blocked",
          subject: "Blocked",
          bodyHtml: "<p>b</p>",
          selectedItemKeys: ["key-1"],
          sendIndividual: true,
          sendTeamBackup: true,
          adminId: "adm-1",
        }, [])
      ).rejects.toThrow(PRODUCTION_READONLY_ERROR);

      await expect(
        processNextBroadcastBatch(null as any, 10)
      ).rejects.toThrow(PRODUCTION_READONLY_ERROR);
    });
  });
});
