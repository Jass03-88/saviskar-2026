import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  createCertificateCampaign,
  generateDeliveryIdempotencyKey,
} from "@/lib/broadcast/campaign-worker";
import { DELETE as deleteCampaignRoute } from "@/app/api/admin/broadcast/campaigns/[id]/route";
import * as serverLib from "@/lib/supabase/server";
import * as adminLib from "@/lib/broadcast/supabase-admin";
import { NextRequest } from "next/server";

describe("PR #37 Certificate System Corrections — Independent Regression Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.PRODUCTION_READONLY_MODE;
    delete process.env.SAVISKAR_BROADCAST_PRODUCTION_READONLY_ENABLED;
    delete process.env.VERCEL_ENV;
    delete process.env.APP_ENV;
    delete process.env.SAVISKAR_PREVIEW;
    delete process.env.HOSTINGER_PREVIEW;
    vi.spyOn(adminLib, "isHybridDevelopmentModeActive").mockReturnValue(true);
    vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
      user: { id: "master-admin-uuid", email: "master@saviskar.co.in" },
      role: "master",
    } as any);
  });

  // =========================================================================
  // ISSUE 1: Strict Empty-Draft Deletion Protection
  // =========================================================================
  describe("ISSUE 1: Strict Empty-Draft Deletion Protection (DELETE /api/admin/broadcast/campaigns/[id])", () => {
    function setupDeleteMock(campaign: any | null, deleteError: any = null) {
      let deleted = false;
      const mockSupabase = {
        from: (table: string) => {
          if (table === "broadcast_campaigns") {
            return {
              select: () => ({
                eq: (col: string, val: string) => ({
                  single: () =>
                    Promise.resolve(
                      campaign ? { data: campaign, error: null } : { data: null, error: { message: "Not found" } }
                    ),
                }),
              }),
              delete: () => ({
                eq: (col: string, val: string) => {
                  deleted = true;
                  return Promise.resolve({ error: deleteError });
                },
              }),
            };
          }
          return {};
        },
      };

      vi.spyOn(adminLib, "getBroadcastSupabaseAdmin").mockReturnValue(mockSupabase as any);
      return { isDeleted: () => deleted };
    }

    it("1. Empty draft with zero sent and zero deliveries can be deleted", async () => {
      const helper = setupDeleteMock({
        id: "camp-empty-draft",
        status: "draft",
        sent_count: 0,
        total_deliveries: 0,
      });

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/camp-empty-draft", {
        method: "DELETE",
      });
      const res = await deleteCampaignRoute(req, {
        params: Promise.resolve({ id: "camp-empty-draft" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.deletedCampaignId).toBe("camp-empty-draft");
      expect(helper.isDeleted()).toBe(true);
    });

    it("2. Draft with deliveries cannot be deleted (HTTP 400)", async () => {
      const helper = setupDeleteMock({
        id: "camp-draft-with-deliveries",
        status: "draft",
        sent_count: 0,
        total_deliveries: 12,
      });

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/camp-draft-with-deliveries", {
        method: "DELETE",
      });
      const res = await deleteCampaignRoute(req, {
        params: Promise.resolve({ id: "camp-draft-with-deliveries" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Only empty draft campaigns with zero deliveries and zero sent emails can be deleted.");
      expect(helper.isDeleted()).toBe(false);
    });

    it("3. Draft with sent emails cannot be deleted (HTTP 400)", async () => {
      const helper = setupDeleteMock({
        id: "camp-draft-with-sent",
        status: "draft",
        sent_count: 3,
        total_deliveries: 0,
      });

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/camp-draft-with-sent", {
        method: "DELETE",
      });
      const res = await deleteCampaignRoute(req, {
        params: Promise.resolve({ id: "camp-draft-with-sent" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Cannot delete a campaign that has already sent emails.");
      expect(helper.isDeleted()).toBe(false);
    });

    it("4. Queued campaign cannot be deleted (HTTP 400)", async () => {
      const helper = setupDeleteMock({
        id: "camp-queued",
        status: "queued",
        sent_count: 0,
        total_deliveries: 0,
      });

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/camp-queued", {
        method: "DELETE",
      });
      const res = await deleteCampaignRoute(req, {
        params: Promise.resolve({ id: "camp-queued" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Only empty draft campaigns with zero deliveries and zero sent emails can be deleted.");
      expect(helper.isDeleted()).toBe(false);
    });

    it("5. Processing campaign cannot be deleted (HTTP 400)", async () => {
      const helper = setupDeleteMock({
        id: "camp-processing",
        status: "processing",
        sent_count: 0,
        total_deliveries: 0,
      });

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/camp-processing", {
        method: "DELETE",
      });
      const res = await deleteCampaignRoute(req, {
        params: Promise.resolve({ id: "camp-processing" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Only empty draft campaigns with zero deliveries and zero sent emails can be deleted.");
      expect(helper.isDeleted()).toBe(false);
    });

    it("6. Completed campaign cannot be deleted (HTTP 400)", async () => {
      const helper = setupDeleteMock({
        id: "camp-completed",
        status: "completed",
        sent_count: 0,
        total_deliveries: 0,
      });

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/camp-completed", {
        method: "DELETE",
      });
      const res = await deleteCampaignRoute(req, {
        params: Promise.resolve({ id: "camp-completed" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Only empty draft campaigns with zero deliveries and zero sent emails can be deleted.");
      expect(helper.isDeleted()).toBe(false);
    });

    it("7. Failed campaign cannot be deleted (HTTP 400)", async () => {
      const helper = setupDeleteMock({
        id: "camp-failed",
        status: "failed",
        sent_count: 0,
        total_deliveries: 0,
      });

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/camp-failed", {
        method: "DELETE",
      });
      const res = await deleteCampaignRoute(req, {
        params: Promise.resolve({ id: "camp-failed" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Only empty draft campaigns with zero deliveries and zero sent emails can be deleted.");
      expect(helper.isDeleted()).toBe(false);
    });

    it("8. Missing campaign returns HTTP 404", async () => {
      const helper = setupDeleteMock(null);

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/camp-nonexistent", {
        method: "DELETE",
      });
      const res = await deleteCampaignRoute(req, {
        params: Promise.resolve({ id: "camp-nonexistent" }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Campaign not found");
      expect(helper.isDeleted()).toBe(false);
    });

    it("9. MFA and read-only protections remain effective", async () => {
      // 9a: MFA Required
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValueOnce({
        error: "MFA_REQUIRED",
        status: 401,
      } as any);

      const reqMfa = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/camp-mfa", {
        method: "DELETE",
      });
      const resMfa = await deleteCampaignRoute(reqMfa, {
        params: Promise.resolve({ id: "camp-mfa" }),
      });
      expect(resMfa.status).toBe(401);
      const dataMfa = await resMfa.json();
      expect(dataMfa.error).toBe("Master Admin MFA verification required.");

      // 9b: Production Read-Only Mode
      process.env.SAVISKAR_BROADCAST_PRODUCTION_READONLY_ENABLED = "true";
      delete process.env.VERCEL_ENV;
      delete process.env.APP_ENV;
      delete process.env.SAVISKAR_PREVIEW;
      delete process.env.HOSTINGER_PREVIEW;

      const reqRo = new NextRequest("https://saviskar.co.in/api/admin/broadcast/campaigns/camp-ro", {
        method: "DELETE",
        headers: { host: "saviskar.co.in" },
      });
      const resRo = await deleteCampaignRoute(reqRo, {
        params: Promise.resolve({ id: "camp-ro" }),
      });
      expect(resRo.status).toBe(403);
      const dataRo = await resRo.json();
      expect(dataRo.error).toBe("Campaign deletion is disabled in Production Read-Only Mode.");
      delete process.env.SAVISKAR_BROADCAST_PRODUCTION_READONLY_ENABLED;

      // 9c: Preview Mode Guard
      delete process.env.SAVISKAR_BROADCAST_PRODUCTION_READONLY_ENABLED;
      process.env.VERCEL_ENV = "preview";
      const reqPreview = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/camp-prev", {
        method: "DELETE",
      });
      const resPreview = await deleteCampaignRoute(reqPreview, {
        params: Promise.resolve({ id: "camp-prev" }),
      });
      expect(resPreview.status).toBe(403);
      const dataPreview = await resPreview.json();
      expect(dataPreview.error).toBe("Campaign deletion is disabled in Preview Mode.");
      delete process.env.VERCEL_ENV;
    });

    it("10. Rejects campaign deletion when sent_count is negative (-1)", async () => {
      const helper = setupDeleteMock({
        id: "camp-neg-sent",
        status: "draft",
        sent_count: -1,
        total_deliveries: 0,
      });

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/camp-neg-sent", {
        method: "DELETE",
      });
      const res = await deleteCampaignRoute(req, {
        params: Promise.resolve({ id: "camp-neg-sent" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Only empty draft campaigns with zero deliveries and zero sent emails can be deleted.");
      expect(helper.isDeleted()).toBe(false);
    });

    it("11. Rejects campaign deletion when total_deliveries is negative (-1)", async () => {
      const helper = setupDeleteMock({
        id: "camp-neg-del",
        status: "draft",
        sent_count: 0,
        total_deliveries: -1,
      });

      const req = new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/camp-neg-del", {
        method: "DELETE",
      });
      const res = await deleteCampaignRoute(req, {
        params: Promise.resolve({ id: "camp-neg-del" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Only empty draft campaigns with zero deliveries and zero sent emails can be deleted.");
      expect(helper.isDeleted()).toBe(false);
    });

    it("12. Rejects campaign deletion when sent_count or total_deliveries is null", async () => {
      const helperNullSent = setupDeleteMock({
        id: "camp-null-sent",
        status: "draft",
        sent_count: null,
        total_deliveries: 0,
      });

      const resNullSent = await deleteCampaignRoute(
        new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/camp-null-sent", { method: "DELETE" }),
        { params: Promise.resolve({ id: "camp-null-sent" }) }
      );
      expect(resNullSent.status).toBe(400);
      expect(helperNullSent.isDeleted()).toBe(false);

      const helperNullDel = setupDeleteMock({
        id: "camp-null-del",
        status: "draft",
        sent_count: 0,
        total_deliveries: null,
      });

      const resNullDel = await deleteCampaignRoute(
        new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/camp-null-del", { method: "DELETE" }),
        { params: Promise.resolve({ id: "camp-null-del" }) }
      );
      expect(resNullDel.status).toBe(400);
      expect(helperNullDel.isDeleted()).toBe(false);
    });

    it("13. Rejects campaign deletion when sent_count or total_deliveries is non-numeric or malformed", async () => {
      const helperMalformed = setupDeleteMock({
        id: "camp-malformed",
        status: "draft",
        sent_count: "0" as any,
        total_deliveries: NaN as any,
      });

      const resMalformed = await deleteCampaignRoute(
        new NextRequest("http://localhost:3000/api/admin/broadcast/campaigns/camp-malformed", { method: "DELETE" }),
        { params: Promise.resolve({ id: "camp-malformed" }) }
      );
      expect(resMalformed.status).toBe(400);
      expect(helperMalformed.isDeleted()).toBe(false);
    });
  });

  // =========================================================================
  // ISSUE 2: Strict Campaign Resume Validation
  // =========================================================================
  describe("ISSUE 2: Strict Campaign Resume Validation in createCertificateCampaign()", () => {
    function setupResumeMock(campaignRow: any | null) {
      let insertCalled = false;
      let updateCalled = false;
      let deleteCalled = false;
      const persistedDeliveries: any[] = [];
      const persistedAttachments: any[] = [];

      const mockSupabase = {
        from: (table: string) => {
          if (table === "broadcast_campaigns") {
            return {
              select: () => ({
                eq: (col: string, val: string) => ({
                  single: () =>
                    Promise.resolve(
                      campaignRow
                        ? { data: campaignRow, error: null }
                        : { data: null, error: { message: "Campaign not found" } }
                    ),
                }),
              }),
              insert: () => {
                insertCalled = true;
                return { select: () => ({ single: () => Promise.resolve({ data: { id: "camp-new" }, error: null }) }) };
              },
              update: () => {
                updateCalled = true;
                return { eq: () => Promise.resolve({ error: null }) };
              },
              delete: () => {
                deleteCalled = true;
                return { eq: () => Promise.resolve({ error: null }) };
              },
            };
          }
          if (table === "participation_certificates") {
            return {
              select: () => ({
                in: () => Promise.resolve({ data: [], error: null }),
                eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
              }),
              insert: () => {
                insertCalled = true;
                return { select: () => ({ single: () => Promise.resolve({ data: { id: "cert-new", certificate_number: "SAV26-CERT-NEW1" }, error: null }) }) };
              },
              delete: () => {
                deleteCalled = true;
                return { in: () => Promise.resolve({ error: null }) };
              },
            };
          }
          if (table === "broadcast_deliveries") {
            return {
              select: () => ({
                eq: () => ({
                  range: () => Promise.resolve({ data: persistedDeliveries, error: null }),
                  then: (r: any) => r({ count: persistedDeliveries.length, data: persistedDeliveries, error: null }),
                }),
              }),
              upsert: (rows: any[]) => {
                insertCalled = true;
                for (const row of rows) {
                  persistedDeliveries.push({ id: row.id || crypto.randomUUID(), ...row });
                }
                return Promise.resolve({ error: null });
              },
            };
          }
          if (table === "broadcast_delivery_attachments") {
            return {
              select: () => ({
                in: () => Promise.resolve({ data: persistedAttachments, error: null }),
              }),
              upsert: (rows: any[]) => {
                insertCalled = true;
                for (const row of rows) {
                  persistedAttachments.push({ id: row.id || crypto.randomUUID(), ...row });
                }
                return Promise.resolve({ error: null });
              },
              insert: (rows: any[]) => {
                insertCalled = true;
                for (const row of rows) {
                  persistedAttachments.push({ id: row.id || crypto.randomUUID(), ...row });
                }
                return Promise.resolve({ error: null });
              },
            };
          }
          return {
            select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          };
        },
        rpc: (fn: string) => {
          if (fn === "issue_or_get_participation_certificate") {
            return Promise.resolve({
              data: [{ id: "cert-rpc-01", certificate_number: "SAV26-CERT-RPC01", issue_source_key: "solo:pe-1", is_new: true }],
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };

      return {
        mockSupabase,
        hasMutated: () => insertCalled || updateCalled || deleteCalled,
      };
    }

    const testCandidates = [
      {
        issueSourceKey: "solo:pe-1",
        certificateEligible: true,
        recipientEmail: "candidate@example.com",
        isValidEmail: true,
        recipientName: "Test Candidate",
        eventName: "Roborace",
      },
    ];

    const defaultAdmin = {
      adminId: "admin-master-001",
      adminEmail: "master@saviskar.co.in",
    };

    it("1. Empty draft: resume allowed", async () => {
      const { mockSupabase } = setupResumeMock({
        id: "camp-empty-draft",
        status: "draft",
        total_deliveries: 0,
        sent_count: 0,
      });

      const res = await createCertificateCampaign(
        mockSupabase as any,
        {
          ...defaultAdmin,
          title: "Title",
          subject: "Subject",
          bodyHtml: "<p>Hello</p>",
          selectedItemKeys: ["solo:pe-1"],
          sendIndividual: true,
          sendTeamBackup: false,
          campaignId: "camp-empty-draft",
        },
        testCandidates
      );

      expect(res.campaignId).toBe("camp-empty-draft");
      expect(res.totalDeliveries).toBe(1);
    });

    it("2. Draft with deliveries: rejected with zero mutations", async () => {
      const { mockSupabase, hasMutated } = setupResumeMock({
        id: "camp-draft-deliveries",
        status: "draft",
        total_deliveries: 5,
        sent_count: 0,
      });

      await expect(
        createCertificateCampaign(
          mockSupabase as any,
          {
            ...defaultAdmin,
            title: "Title",
            subject: "Subject",
            bodyHtml: "<p>Hello</p>",
            selectedItemKeys: ["solo:pe-1"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: "camp-draft-deliveries",
          },
          testCandidates
        )
      ).rejects.toThrow(/Cannot resume campaign camp-draft-deliveries: only empty draft campaigns/);

      expect(hasMutated()).toBe(false);
    });

    it("3. Draft with sent emails: rejected with zero mutations", async () => {
      const { mockSupabase, hasMutated } = setupResumeMock({
        id: "camp-draft-sent",
        status: "draft",
        total_deliveries: 0,
        sent_count: 2,
      });

      await expect(
        createCertificateCampaign(
          mockSupabase as any,
          {
            ...defaultAdmin,
            title: "Title",
            subject: "Subject",
            bodyHtml: "<p>Hello</p>",
            selectedItemKeys: ["solo:pe-1"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: "camp-draft-sent",
          },
          testCandidates
        )
      ).rejects.toThrow(/Cannot resume campaign camp-draft-sent: only empty draft campaigns/);

      expect(hasMutated()).toBe(false);
    });

    it("4. Queued campaign: rejected with zero mutations", async () => {
      const { mockSupabase, hasMutated } = setupResumeMock({
        id: "camp-queued",
        status: "queued",
        total_deliveries: 0,
        sent_count: 0,
      });

      await expect(
        createCertificateCampaign(
          mockSupabase as any,
          {
            ...defaultAdmin,
            title: "Title",
            subject: "Subject",
            bodyHtml: "<p>Hello</p>",
            selectedItemKeys: ["solo:pe-1"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: "camp-queued",
          },
          testCandidates
        )
      ).rejects.toThrow(/Cannot resume campaign camp-queued: only empty draft campaigns/);

      expect(hasMutated()).toBe(false);
    });

    it("5. Processing campaign: rejected with zero mutations", async () => {
      const { mockSupabase, hasMutated } = setupResumeMock({
        id: "camp-processing",
        status: "processing",
        total_deliveries: 0,
        sent_count: 0,
      });

      await expect(
        createCertificateCampaign(
          mockSupabase as any,
          {
            ...defaultAdmin,
            title: "Title",
            subject: "Subject",
            bodyHtml: "<p>Hello</p>",
            selectedItemKeys: ["solo:pe-1"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: "camp-processing",
          },
          testCandidates
        )
      ).rejects.toThrow(/Cannot resume campaign camp-processing: only empty draft campaigns/);

      expect(hasMutated()).toBe(false);
    });

    it("6. Completed campaign: rejected with zero mutations", async () => {
      const { mockSupabase, hasMutated } = setupResumeMock({
        id: "camp-completed",
        status: "completed",
        total_deliveries: 0,
        sent_count: 0,
      });

      await expect(
        createCertificateCampaign(
          mockSupabase as any,
          {
            ...defaultAdmin,
            title: "Title",
            subject: "Subject",
            bodyHtml: "<p>Hello</p>",
            selectedItemKeys: ["solo:pe-1"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: "camp-completed",
          },
          testCandidates
        )
      ).rejects.toThrow(/Cannot resume campaign camp-completed: only empty draft campaigns/);

      expect(hasMutated()).toBe(false);
    });

    it("7. Failed campaign: rejected with zero mutations", async () => {
      const { mockSupabase, hasMutated } = setupResumeMock({
        id: "camp-failed",
        status: "failed",
        total_deliveries: 0,
        sent_count: 0,
      });

      await expect(
        createCertificateCampaign(
          mockSupabase as any,
          {
            ...defaultAdmin,
            title: "Title",
            subject: "Subject",
            bodyHtml: "<p>Hello</p>",
            selectedItemKeys: ["solo:pe-1"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: "camp-failed",
          },
          testCandidates
        )
      ).rejects.toThrow(/Cannot resume campaign camp-failed: only empty draft campaigns/);

      expect(hasMutated()).toBe(false);
    });

    it("8. Missing campaign: rejected with clear error and zero mutations", async () => {
      const { mockSupabase, hasMutated } = setupResumeMock(null);

      await expect(
        createCertificateCampaign(
          mockSupabase as any,
          {
            ...defaultAdmin,
            title: "Title",
            subject: "Subject",
            bodyHtml: "<p>Hello</p>",
            selectedItemKeys: ["solo:pe-1"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: "camp-missing-123",
          },
          testCandidates
        )
      ).rejects.toThrow(/Target campaign camp-missing-123 not found\./);

      expect(hasMutated()).toBe(false);
    });

    it("9. Rejects resume when sent_count is negative (-1) with zero mutations", async () => {
      const { mockSupabase, hasMutated } = setupResumeMock({
        id: "camp-neg-sent",
        status: "draft",
        total_deliveries: 0,
        sent_count: -1,
      });

      await expect(
        createCertificateCampaign(
          mockSupabase as any,
          {
            ...defaultAdmin,
            title: "Title",
            subject: "Subject",
            bodyHtml: "<p>Hello</p>",
            selectedItemKeys: ["solo:pe-1"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: "camp-neg-sent",
          },
          testCandidates
        )
      ).rejects.toThrow(/Cannot resume campaign camp-neg-sent: only empty draft campaigns/);

      expect(hasMutated()).toBe(false);
    });

    it("10. Rejects resume when total_deliveries is negative (-1) with zero mutations", async () => {
      const { mockSupabase, hasMutated } = setupResumeMock({
        id: "camp-neg-del",
        status: "draft",
        total_deliveries: -1,
        sent_count: 0,
      });

      await expect(
        createCertificateCampaign(
          mockSupabase as any,
          {
            ...defaultAdmin,
            title: "Title",
            subject: "Subject",
            bodyHtml: "<p>Hello</p>",
            selectedItemKeys: ["solo:pe-1"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: "camp-neg-del",
          },
          testCandidates
        )
      ).rejects.toThrow(/Cannot resume campaign camp-neg-del: only empty draft campaigns/);

      expect(hasMutated()).toBe(false);
    });

    it("11. Rejects resume when sent_count or total_deliveries is null with zero mutations", async () => {
      const { mockSupabase: mockNullSent, hasMutated: mutatedNullSent } = setupResumeMock({
        id: "camp-null-sent",
        status: "draft",
        total_deliveries: 0,
        sent_count: null,
      });

      await expect(
        createCertificateCampaign(
          mockNullSent as any,
          {
            ...defaultAdmin,
            title: "Title",
            subject: "Subject",
            bodyHtml: "<p>Hello</p>",
            selectedItemKeys: ["solo:pe-1"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: "camp-null-sent",
          },
          testCandidates
        )
      ).rejects.toThrow(/Cannot resume campaign camp-null-sent: only empty draft campaigns/);

      expect(mutatedNullSent()).toBe(false);

      const { mockSupabase: mockNullDel, hasMutated: mutatedNullDel } = setupResumeMock({
        id: "camp-null-del",
        status: "draft",
        total_deliveries: null,
        sent_count: 0,
      });

      await expect(
        createCertificateCampaign(
          mockNullDel as any,
          {
            ...defaultAdmin,
            title: "Title",
            subject: "Subject",
            bodyHtml: "<p>Hello</p>",
            selectedItemKeys: ["solo:pe-1"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: "camp-null-del",
          },
          testCandidates
        )
      ).rejects.toThrow(/Cannot resume campaign camp-null-del: only empty draft campaigns/);

      expect(mutatedNullDel()).toBe(false);
    });

    it("12. Rejects resume when sent_count or total_deliveries is non-numeric/malformed with zero mutations", async () => {
      const { mockSupabase: mockMalformed, hasMutated: mutatedMalformed } = setupResumeMock({
        id: "camp-malformed",
        status: "draft",
        total_deliveries: NaN as any,
        sent_count: "0" as any,
      });

      await expect(
        createCertificateCampaign(
          mockMalformed as any,
          {
            ...defaultAdmin,
            title: "Title",
            subject: "Subject",
            bodyHtml: "<p>Hello</p>",
            selectedItemKeys: ["solo:pe-1"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: "camp-malformed",
          },
          testCandidates
        )
      ).rejects.toThrow(/Cannot resume campaign camp-malformed: only empty draft campaigns/);

      expect(mutatedMalformed()).toBe(false);
    });
  });

  // =========================================================================
  // ISSUE 3: Certificate Attachment Recovery & Idempotency
  // =========================================================================
  describe("ISSUE 3: Certificate Attachment Recovery & Idempotency (All 13 Scenarios)", () => {
    // Stateful database simulator to test row persistence, relationships, and constraints
    function createDbSimulator(initialState?: {
      campaigns?: any[];
      certificates?: any[];
      deliveries?: any[];
      attachments?: any[];
      failOnAttachmentInsert?: boolean;
    }) {
      const campaigns = [...(initialState?.campaigns || [])];
      const certificates = [...(initialState?.certificates || [])];
      const deliveries = [...(initialState?.deliveries || [])];
      const attachments = [...(initialState?.attachments || [])];
      let failAttachments = initialState?.failOnAttachmentInsert ?? false;

      const mockSupabase = {
        setFailAttachments: (val: boolean) => {
          failAttachments = val;
        },
        getState: () => ({ campaigns, certificates, deliveries, attachments }),
        from: (table: string) => {
          if (table === "broadcast_campaigns") {
            return {
              select: () => ({
                eq: (col: string, val: string) => ({
                  single: () => {
                    const found = campaigns.find((c) => c[col] === val);
                    return Promise.resolve(found ? { data: { ...found }, error: null } : { data: null, error: { message: "Not found" } });
                  },
                }),
              }),
              insert: (data: any) => {
                const row = { id: crypto.randomUUID(), ...data };
                campaigns.push(row);
                return {
                  select: () => ({
                    single: () => Promise.resolve({ data: { ...row }, error: null }),
                  }),
                };
              },
              update: (data: any) => ({
                eq: (col: string, val: string) => {
                  const target = campaigns.find((c) => c[col] === val);
                  if (target) Object.assign(target, data);
                  return Promise.resolve({ error: null });
                },
              }),
              delete: () => ({
                eq: (col: string, val: string) => {
                  const idx = campaigns.findIndex((c) => c[col] === val);
                  if (idx !== -1) campaigns.splice(idx, 1);
                  return Promise.resolve({ error: null });
                },
              }),
            };
          }

          if (table === "participation_certificates") {
            return {
              select: () => ({
                in: (col: string, vals: string[]) => {
                  const matched = certificates.filter((c) => vals.includes(c[col]));
                  return Promise.resolve({ data: matched, error: null });
                },
                eq: (col: string, val: string) => ({
                  maybeSingle: () => {
                    const found = certificates.find((c) => c[col] === val);
                    return Promise.resolve({ data: found ? { ...found } : null, error: null });
                  },
                }),
              }),
              insert: (data: any) => {
                const row = { id: crypto.randomUUID(), ...data };
                certificates.push(row);
                return {
                  select: () => ({
                    single: () => Promise.resolve({ data: { ...row }, error: null }),
                  }),
                };
              },
              delete: () => ({
                in: (col: string, vals: string[]) => {
                  for (let i = certificates.length - 1; i >= 0; i--) {
                    if (vals.includes(certificates[i][col])) certificates.splice(i, 1);
                  }
                  return Promise.resolve({ error: null });
                },
              }),
            };
          }

          if (table === "broadcast_deliveries") {
            return {
              select: (cols: string, opts?: any) => ({
                eq: (col: string, val: string) => {
                  if (opts?.count === "exact" && opts?.head) {
                    const count = deliveries.filter((d) => d[col] === val).length;
                    return Promise.resolve({ count, data: [], error: null });
                  }
                  const res = deliveries.filter((d) => d[col] === val);
                  return {
                    range: (from: number, to: number) =>
                      Promise.resolve({ data: res.slice(from, to + 1), error: null }),
                    then: (resolve: any) => resolve({ data: res, error: null }),
                  };
                },
              }),
              upsert: (rows: any[], opts?: any) => {
                const inserted: any[] = [];
                for (const row of rows) {
                  const idx = deliveries.findIndex((d) => d.idempotency_key === row.idempotency_key);
                  if (idx >= 0) {
                    if (!opts?.ignoreDuplicates) {
                      deliveries[idx] = { ...deliveries[idx], ...row };
                    }
                    inserted.push(deliveries[idx]);
                  } else {
                    const newRow = { ...row, id: row.id || crypto.randomUUID() };
                    deliveries.push(newRow);
                    inserted.push(newRow);
                  }
                }
                return {
                  select: () => Promise.resolve({ data: inserted, error: null }),
                  then: (resolve: any) => resolve({ data: inserted, error: null }),
                };
              },
            };
          }

          if (table === "broadcast_delivery_attachments") {
            return {
              select: (cols: string) => ({
                in: (col: string, vals: string[]) => {
                  const matched = attachments.filter((a) => vals.includes(a[col]));
                  return Promise.resolve({ data: matched, error: null });
                },
              }),
              upsert: (rows: any[], opts?: any) => {
                if (failAttachments) {
                  return Promise.resolve({
                    error: { message: "Simulated database error inserting attachments" },
                  });
                }
                for (const row of rows) {
                  const exists = attachments.some(
                    (a) => a.delivery_id === row.delivery_id && a.certificate_id === row.certificate_id
                  );
                  if (!exists) {
                    attachments.push({ id: crypto.randomUUID(), ...row });
                  }
                }
                return Promise.resolve({ error: null });
              },
              insert: (rows: any[]) => {
                if (failAttachments) {
                  return Promise.resolve({
                    error: { message: "Simulated database error inserting attachments" },
                  });
                }
                for (const row of rows) {
                  const exists = attachments.some(
                    (a) => a.delivery_id === row.delivery_id && a.certificate_id === row.certificate_id
                  );
                  if (exists) {
                    return Promise.resolve({
                      error: {
                        code: "23505",
                        message: 'duplicate key value violates unique constraint "uq_broadcast_delivery_attachments_delivery_cert"',
                      },
                    });
                  }
                  attachments.push({ id: crypto.randomUUID(), ...row });
                }
                return Promise.resolve({ error: null });
              },
            };
          }

          return {
            select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          };
        },
        rpc: (fn: string, params: any) => {
          if (fn === "issue_or_get_participation_certificate") {
            const existing = certificates.find((c) => c.issue_source_key === params.p_issue_source_key);
            if (existing) {
              return Promise.resolve({
                data: [{ id: existing.id, certificate_number: existing.certificate_number, issue_source_key: existing.issue_source_key, is_new: false }],
                error: null,
              });
            }
            const newCert = {
              id: crypto.randomUUID(),
              certificate_number: `SAV26-CERT-${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
              issue_source_key: params.p_issue_source_key,
              recipient_name: params.p_recipient_name,
              recipient_email: params.p_recipient_email,
              event_name: params.p_event_name,
            };
            certificates.push(newCert);
            return Promise.resolve({
              data: [{ id: newCert.id, certificate_number: newCert.certificate_number, issue_source_key: newCert.issue_source_key, is_new: true }],
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };

      return mockSupabase;
    }

    const defaultAdmin = {
      adminId: "admin-master-001",
      adminEmail: "master@saviskar.co.in",
    };

    const singleCandidate = [
      {
        issueSourceKey: "solo:pe-101",
        certificateEligible: true,
        recipientEmail: "alice@example.com",
        isValidEmail: true,
        recipientName: "Alice Wonder",
        eventName: "Roborace",
      },
    ];

    it("1. New delivery and new attachment association", async () => {
      const db = createDbSimulator();
      const res = await createCertificateCampaign(
        db as any,
        {
          ...defaultAdmin,
          title: "Saviskar Certificate Campaign",
          subject: "Your Certificate",
          bodyHtml: "<p>Hello</p>",
          selectedItemKeys: ["solo:pe-101"],
          sendIndividual: true,
          sendTeamBackup: false,
        },
        singleCandidate
      );

      expect(res.totalDeliveries).toBe(1);
      const state = db.getState();
      expect(state.deliveries).toHaveLength(1);
      expect(state.attachments).toHaveLength(1);
      expect(state.attachments[0].delivery_id).toBe(state.deliveries[0].id);
      expect(state.attachments[0].certificate_id).toBe(state.certificates[0].id);
      expect(state.campaigns[0].status).toBe("queued");
    });

    it("2. Existing delivery with existing attachment association is preserved without duplicates", async () => {
      const campId = "camp-existing-01";
      const delId = "del-existing-01";
      const certId = "cert-existing-01";
      const idempKey = generateDeliveryIdempotencyKey(campId, "alice@example.com", "individual");

      const db = createDbSimulator({
        campaigns: [{ id: campId, status: "draft", total_deliveries: 0, sent_count: 0 }],
        certificates: [{ id: certId, certificate_number: "SAV26-CERT-EXIST01", issue_source_key: "solo:pe-101", recipient_email: "alice@example.com", event_name: "Roborace" }],
        deliveries: [{ id: delId, campaign_id: campId, recipient_email: "alice@example.com", channel: "individual", idempotency_key: idempKey }],
        attachments: [{ id: "att-01", delivery_id: delId, certificate_id: certId, filename: "Saviskar_Certificate_Roborace.pdf" }],
      });

      const res = await createCertificateCampaign(
        db as any,
        {
          ...defaultAdmin,
          title: "Saviskar Certificate Campaign",
          subject: "Your Certificate",
          bodyHtml: "<p>Hello</p>",
          selectedItemKeys: ["solo:pe-101"],
          sendIndividual: true,
          sendTeamBackup: false,
          campaignId: campId,
        },
        singleCandidate
      );

      expect(res.campaignId).toBe(campId);
      const state = db.getState();
      expect(state.deliveries).toHaveLength(1);
      expect(state.attachments).toHaveLength(1);
      expect(state.attachments[0].id).toBe("att-01");
      expect(state.attachments[0].delivery_id).toBe(delId);
    });

    it("3. Existing delivery with missing attachment association recovers and attaches PDF without creating new delivery", async () => {
      const campId = "camp-existing-02";
      const delId = "del-existing-02";
      const certId = "cert-existing-02";
      const idempKey = generateDeliveryIdempotencyKey(campId, "alice@example.com", "individual");

      const db = createDbSimulator({
        campaigns: [{ id: campId, status: "draft", total_deliveries: 0, sent_count: 0 }],
        certificates: [{ id: certId, certificate_number: "SAV26-CERT-EXIST02", issue_source_key: "solo:pe-101", recipient_email: "alice@example.com", event_name: "Roborace" }],
        deliveries: [{ id: delId, campaign_id: campId, recipient_email: "alice@example.com", channel: "individual", idempotency_key: idempKey }],
        attachments: [], // MISSING ATTACHMENT
      });

      const res = await createCertificateCampaign(
        db as any,
        {
          ...defaultAdmin,
          title: "Saviskar Certificate Campaign",
          subject: "Your Certificate",
          bodyHtml: "<p>Hello</p>",
          selectedItemKeys: ["solo:pe-101"],
          sendIndividual: true,
          sendTeamBackup: false,
          campaignId: campId,
        },
        singleCandidate
      );

      const state = db.getState();
      expect(state.deliveries).toHaveLength(1);
      expect(state.deliveries[0].id).toBe(delId); // Reused existing delivery
      expect(state.attachments).toHaveLength(1); // Attached missing PDF
      expect(state.attachments[0].delivery_id).toBe(delId);
      expect(state.attachments[0].certificate_id).toBe(certId);
    });

    it("4 & 5. Retry after delivery insertion succeeds but attachment insertion fails successfully repairs the missing attachment", async () => {
      const campId = "camp-retry-flow";
      const db = createDbSimulator({
        campaigns: [{ id: campId, status: "draft", total_deliveries: 0, sent_count: 0 }],
        failOnAttachmentInsert: true, // Step 4: Attachment insert fails
      });

      // Attempt 1: Delivery succeeds, attachment fails -> throws Error
      await expect(
        createCertificateCampaign(
          db as any,
          {
            ...defaultAdmin,
            title: "Saviskar Certificate Campaign",
            subject: "Your Certificate",
            bodyHtml: "<p>Hello</p>",
            selectedItemKeys: ["solo:pe-101"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: campId,
          },
          singleCandidate
        )
      ).rejects.toThrow(/Failed to link certificate attachments/);

      // State after failed attempt 1: delivery persisted, attachment empty, campaign remains draft
      let state = db.getState();
      expect(state.deliveries).toHaveLength(1);
      const deliveryId = state.deliveries[0].id;
      expect(state.attachments).toHaveLength(0);
      expect(state.campaigns[0].status).toBe("draft");

      // Step 5: Attachment insertion resolved, retry runs
      db.setFailAttachments(false);
      const resRetry = await createCertificateCampaign(
        db as any,
        {
          ...defaultAdmin,
          title: "Saviskar Certificate Campaign",
          subject: "Your Certificate",
          bodyHtml: "<p>Hello</p>",
          selectedItemKeys: ["solo:pe-101"],
          sendIndividual: true,
          sendTeamBackup: false,
          campaignId: campId,
        },
        singleCandidate
      );

      expect(resRetry.campaignId).toBe(campId);
      state = db.getState();
      // Delivery was NOT duplicated
      expect(state.deliveries).toHaveLength(1);
      expect(state.deliveries[0].id).toBe(deliveryId);
      // Missing attachment was repaired and attached
      expect(state.attachments).toHaveLength(1);
      expect(state.attachments[0].delivery_id).toBe(deliveryId);
      expect(state.campaigns[0].status).toBe("queued");
    });

    it("6 & 7. Repeated retry does not duplicate delivery rows or attachment rows", async () => {
      const campId = "camp-repeated-retry";
      const db = createDbSimulator({
        campaigns: [{ id: campId, status: "draft", total_deliveries: 0, sent_count: 0 }],
      });

      const callArgs = {
        ...defaultAdmin,
        title: "Saviskar Certificate Campaign",
        subject: "Your Certificate",
        bodyHtml: "<p>Hello</p>",
        selectedItemKeys: ["solo:pe-101"],
        sendIndividual: true,
        sendTeamBackup: false,
        campaignId: campId,
      };

      // Call 1
      await createCertificateCampaign(db as any, callArgs, singleCandidate);
      expect(db.getState().deliveries).toHaveLength(1);
      expect(db.getState().attachments).toHaveLength(1);

      // Reset campaign header status back to draft for simulating another attempt on the same deliveries
      db.getState().campaigns[0].status = "draft";
      db.getState().campaigns[0].total_deliveries = 0;

      // Call 2
      await createCertificateCampaign(db as any, callArgs, singleCandidate);
      expect(db.getState().deliveries).toHaveLength(1); // No duplicate delivery
      expect(db.getState().attachments).toHaveLength(1); // No duplicate attachment

      // Reset once more for Call 3
      db.getState().campaigns[0].status = "draft";
      db.getState().campaigns[0].total_deliveries = 0;

      // Call 3
      await createCertificateCampaign(db as any, callArgs, singleCandidate);
      expect(db.getState().deliveries).toHaveLength(1);
      expect(db.getState().attachments).toHaveLength(1);
    });

    it("8. Existing correct attachment associations remain unchanged", async () => {
      const campId = "camp-assoc-check";
      const delId = "del-keep-01";
      const certId = "cert-keep-01";
      const idempKey = generateDeliveryIdempotencyKey(campId, "alice@example.com", "individual");

      const db = createDbSimulator({
        campaigns: [{ id: campId, status: "draft", total_deliveries: 0, sent_count: 0 }],
        certificates: [{ id: certId, certificate_number: "SAV26-CERT-KEEP01", issue_source_key: "solo:pe-101", recipient_email: "alice@example.com", event_name: "Roborace" }],
        deliveries: [{ id: delId, campaign_id: campId, recipient_email: "alice@example.com", channel: "individual", idempotency_key: idempKey }],
        attachments: [{ id: "att-authoritative-id", delivery_id: delId, certificate_id: certId, filename: "Saviskar_Certificate_Roborace.pdf", size_bytes: 433000 }],
      });

      await createCertificateCampaign(
        db as any,
        {
          ...defaultAdmin,
          title: "Saviskar Certificate Campaign",
          subject: "Your Certificate",
          bodyHtml: "<p>Hello</p>",
          selectedItemKeys: ["solo:pe-101"],
          sendIndividual: true,
          sendTeamBackup: false,
          campaignId: campId,
        },
        singleCandidate
      );

      const state = db.getState();
      expect(state.attachments).toHaveLength(1);
      expect(state.attachments[0].id).toBe("att-authoritative-id");
      expect(state.attachments[0].delivery_id).toBe(delId);
      expect(state.attachments[0].certificate_id).toBe(certId);
    });

    it("9. Certificate belonging to recipient A cannot attach to recipient B (cross-recipient protection)", async () => {
      const db = createDbSimulator();
      // Candidate with mismatched email internally
      const corruptedCandidate = [
        {
          issueSourceKey: "solo:pe-mismatch",
          certificateEligible: true,
          recipientEmail: "alice@example.com",
          isValidEmail: true,
          recipientName: "Alice Wonder",
          eventName: "Roborace",
          // Mismatched internal property
          mismatchedTarget: "bob@example.com",
        },
      ];

      // Test that individual deliveries strictly group and check recipient email
      const res = await createCertificateCampaign(
        db as any,
        {
          ...defaultAdmin,
          title: "Saviskar Certificate Campaign",
          subject: "Your Certificate",
          bodyHtml: "<p>Hello</p>",
          selectedItemKeys: ["solo:pe-mismatch"],
          sendIndividual: true,
          sendTeamBackup: false,
        },
        corruptedCandidate
      );

      const state = db.getState();
      expect(state.deliveries[0].recipient_email).toBe("alice@example.com");
      expect(state.certificates[0].recipient_email).toBe("alice@example.com");
      expect(state.attachments[0].delivery_id).toBe(state.deliveries[0].id);
    });

    it("10. Multiple certificates for one recipient all receive their correct associations", async () => {
      const db = createDbSimulator();
      const multiEventCandidate = [
        {
          issueSourceKey: "solo:pe-ev1",
          certificateEligible: true,
          recipientEmail: "multi@example.com",
          isValidEmail: true,
          recipientName: "Multi Performer",
          eventName: "Roborace",
        },
        {
          issueSourceKey: "solo:pe-ev2",
          certificateEligible: true,
          recipientEmail: "multi@example.com",
          isValidEmail: true,
          recipientName: "Multi Performer",
          eventName: "Hackathon",
        },
      ];

      const res = await createCertificateCampaign(
        db as any,
        {
          ...defaultAdmin,
          title: "Saviskar Certificate Campaign",
          subject: "Your Certificate",
          bodyHtml: "<p>Hello</p>",
          selectedItemKeys: ["solo:pe-ev1", "solo:pe-ev2"],
          sendIndividual: true,
          sendTeamBackup: false,
        },
        multiEventCandidate
      );

      expect(res.totalDeliveries).toBe(1); // Exactly 1 delivery for the participant
      expect(res.totalCertificates).toBe(2); // 2 certificates issued
      const state = db.getState();
      expect(state.deliveries).toHaveLength(1);
      expect(state.certificates).toHaveLength(2);
      expect(state.attachments).toHaveLength(2); // Both certificates attached to the same delivery
      expect(state.attachments[0].delivery_id).toBe(state.deliveries[0].id);
      expect(state.attachments[1].delivery_id).toBe(state.deliveries[0].id);
      expect(state.attachments.map((a) => a.certificate_id).sort()).toEqual(
        state.certificates.map((c) => c.id).sort()
      );
    });

    it("11. Individual delivery recovery: handles mix of existing delivery without attachment and completely new recipient", async () => {
      const campId = "camp-mixed-recov";
      const delId1 = "del-alice-01";
      const certId1 = "cert-alice-01";
      const idempKeyAlice = generateDeliveryIdempotencyKey(campId, "alice@example.com", "individual");

      const db = createDbSimulator({
        campaigns: [{ id: campId, status: "draft", total_deliveries: 0, sent_count: 0 }],
        certificates: [{ id: certId1, certificate_number: "SAV26-CERT-ALICE01", issue_source_key: "solo:pe-alice", recipient_email: "alice@example.com", event_name: "Roborace" }],
        deliveries: [{ id: delId1, campaign_id: campId, recipient_email: "alice@example.com", channel: "individual", idempotency_key: idempKeyAlice }],
        attachments: [], // Alice's attachment was missing
      });

      const twoCandidates = [
        {
          issueSourceKey: "solo:pe-alice",
          certificateEligible: true,
          recipientEmail: "alice@example.com",
          isValidEmail: true,
          recipientName: "Alice",
          eventName: "Roborace",
        },
        {
          issueSourceKey: "solo:pe-bob",
          certificateEligible: true,
          recipientEmail: "bob@example.com",
          isValidEmail: true,
          recipientName: "Bob",
          eventName: "CodeQuest",
        },
      ];

      const res = await createCertificateCampaign(
        db as any,
        {
          ...defaultAdmin,
          title: "Saviskar Certificate Campaign",
          subject: "Your Certificate",
          bodyHtml: "<p>Hello</p>",
          selectedItemKeys: ["solo:pe-alice", "solo:pe-bob"],
          sendIndividual: true,
          sendTeamBackup: false,
          campaignId: campId,
        },
        twoCandidates
      );

      const state = db.getState();
      expect(state.deliveries).toHaveLength(2);
      // Alice's delivery ID was preserved
      const aliceDel = state.deliveries.find((d) => d.recipient_email === "alice@example.com");
      expect(aliceDel?.id).toBe(delId1);
      // Bob's delivery was newly added
      const bobDel = state.deliveries.find((d) => d.recipient_email === "bob@example.com");
      expect(bobDel).toBeDefined();

      // Both have their attachments
      expect(state.attachments).toHaveLength(2);
      const aliceAtt = state.attachments.find((a) => a.delivery_id === delId1);
      expect(aliceAtt).toBeDefined();
      expect(aliceAtt?.certificate_id).toBe(certId1);

      const bobAtt = state.attachments.find((a) => a.delivery_id === bobDel?.id);
      expect(bobAtt).toBeDefined();
    });

    it("12. Team backup delivery recovery: preserves team contact delivery and attaches members' certificates", async () => {
      const campId = "camp-team-recov";
      const teamCandidates = [
        {
          issueSourceKey: "team:pe-team-1:mem-1",
          certificateEligible: true,
          recipientEmail: "member1@example.com",
          isValidEmail: true,
          recipientName: "Team Leader",
          eventName: "RoboWars",
          isTeam: true,
          teamName: "CyberBots",
          teamContactEmail: "leader@cyberbots.com",
          participantEventId: "pe-team-1",
          isTeamLeader: true,
        },
        {
          issueSourceKey: "team:pe-team-1:mem-2",
          certificateEligible: true,
          recipientEmail: "member2@example.com",
          isValidEmail: true,
          recipientName: "Team Member 2",
          eventName: "RoboWars",
          isTeam: true,
          teamName: "CyberBots",
          teamContactEmail: "leader@cyberbots.com",
          participantEventId: "pe-team-1",
          isTeamLeader: false,
        },
      ];

      const db = createDbSimulator();
      const res = await createCertificateCampaign(
        db as any,
        {
          ...defaultAdmin,
          title: "Saviskar Team Campaign",
          subject: "Your Team Certificates",
          bodyHtml: "<p>Hello Team</p>",
          selectedItemKeys: ["team:pe-team-1:mem-1", "team:pe-team-1:mem-2"],
          sendIndividual: false,
          sendTeamBackup: true,
        },
        teamCandidates
      );

      const state = db.getState();
      expect(state.deliveries).toHaveLength(1);
      expect(state.deliveries[0].channel).toBe("team_backup");
      expect(state.deliveries[0].recipient_email).toBe("leader@cyberbots.com");
      // Both certificates attached to the leader's delivery
      expect(state.attachments).toHaveLength(2);
      expect(state.attachments[0].delivery_id).toBe(state.deliveries[0].id);
      expect(state.attachments[1].delivery_id).toBe(state.deliveries[0].id);
    });

    it("13. Partial failure is reported rather than falsely marked successful", async () => {
      const campId = "camp-partial-fail";
      const db = createDbSimulator({
        campaigns: [{ id: campId, status: "draft", total_deliveries: 0, sent_count: 0 }],
        failOnAttachmentInsert: true,
      });

      await expect(
        createCertificateCampaign(
          db as any,
          {
            ...defaultAdmin,
            title: "Saviskar Certificate Campaign",
            subject: "Your Certificate",
            bodyHtml: "<p>Hello</p>",
            selectedItemKeys: ["solo:pe-101"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: campId,
          },
          singleCandidate
        )
      ).rejects.toThrow("Failed to link certificate attachments: Simulated database error inserting attachments");

      // Verify campaign was NOT updated to "queued"
      const state = db.getState();
      expect(state.campaigns[0].status).toBe("draft");
    });

    it("14. Two concurrent requests attempting the same attachment association: only one persists without error", async () => {
      const campId = "camp-concurrent-race";
      const delId = "del-concurrent-race";
      const certId = "cert-concurrent-race";
      const idempKey = generateDeliveryIdempotencyKey(campId, "racer@example.com", "individual");

      const db = createDbSimulator({
        campaigns: [{ id: campId, status: "draft", total_deliveries: 0, sent_count: 0 }],
        certificates: [{ id: certId, certificate_number: "SAV26-CERT-RACE01", issue_source_key: "solo:pe-race", recipient_email: "racer@example.com", event_name: "Roborace" }],
        deliveries: [{ id: delId, campaign_id: campId, recipient_email: "racer@example.com", channel: "individual", idempotency_key: idempKey }],
        attachments: [], // Empty initially
      });

      const candidate = [
        {
          issueSourceKey: "solo:pe-race",
          certificateEligible: true,
          recipientEmail: "racer@example.com",
          isValidEmail: true,
          recipientName: "Racer One",
          eventName: "Roborace",
        },
      ];

      // Simulate two concurrent requests attempting the exact same attachment association
      const [res1, res2] = await Promise.all([
        createCertificateCampaign(
          db as any,
          {
            ...defaultAdmin,
            title: "Saviskar Certificate Campaign",
            subject: "Your Certificate",
            bodyHtml: "<p>Hello</p>",
            selectedItemKeys: ["solo:pe-race"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: campId,
          },
          candidate
        ),
        createCertificateCampaign(
          db as any,
          {
            ...defaultAdmin,
            title: "Saviskar Certificate Campaign",
            subject: "Your Certificate",
            bodyHtml: "<p>Hello</p>",
            selectedItemKeys: ["solo:pe-race"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: campId,
          },
          candidate
        ),
      ]);

      const state = db.getState();
      // Exactly 1 delivery
      expect(state.deliveries).toHaveLength(1);
      // Exactly 1 attachment association persisted (conflict-safe, no duplicates)
      expect(state.attachments).toHaveLength(1);
      expect(state.attachments[0].delivery_id).toBe(delId);
      expect(state.attachments[0].certificate_id).toBe(certId);
      // Final campaign status is queued
      expect(state.campaigns[0].status).toBe("queued");
    });

    it("15. Concurrent insertion of different certificates for the same delivery persists both distinct attachments", async () => {
      const campId = "camp-multi-cert";
      const delId = "del-multi-cert";
      const cert1Id = "cert-multi-1";
      const cert2Id = "cert-multi-2";
      const idempKey = generateDeliveryIdempotencyKey(campId, "polymath@example.com", "individual");

      const db = createDbSimulator({
        campaigns: [{ id: campId, status: "draft", total_deliveries: 0, sent_count: 0 }],
        certificates: [
          { id: cert1Id, certificate_number: "SAV26-CERT-POLY01", issue_source_key: "solo:pe-p1", recipient_email: "polymath@example.com", event_name: "Coding Contest" },
          { id: cert2Id, certificate_number: "SAV26-CERT-POLY02", issue_source_key: "solo:pe-p2", recipient_email: "polymath@example.com", event_name: "Web Dev Sprint" },
        ],
        deliveries: [{ id: delId, campaign_id: campId, recipient_email: "polymath@example.com", channel: "individual", idempotency_key: idempKey }],
        attachments: [],
      });

      const candidate1 = [
        {
          issueSourceKey: "solo:pe-p1",
          certificateEligible: true,
          recipientEmail: "polymath@example.com",
          isValidEmail: true,
          recipientName: "Poly Math",
          eventName: "Coding Contest",
        },
      ];

      const candidate2 = [
        {
          issueSourceKey: "solo:pe-p2",
          certificateEligible: true,
          recipientEmail: "polymath@example.com",
          isValidEmail: true,
          recipientName: "Poly Math",
          eventName: "Web Dev Sprint",
        },
      ];

      // Run concurrent enqueue for candidate1 and candidate2 on the same delivery
      await Promise.all([
        createCertificateCampaign(
          db as any,
          {
            ...defaultAdmin,
            title: "Saviskar Certificate Campaign",
            subject: "Your Certificate",
            bodyHtml: "<p>Hello</p>",
            selectedItemKeys: ["solo:pe-p1"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: campId,
          },
          candidate1
        ),
        createCertificateCampaign(
          db as any,
          {
            ...defaultAdmin,
            title: "Saviskar Certificate Campaign",
            subject: "Your Certificate",
            bodyHtml: "<p>Hello</p>",
            selectedItemKeys: ["solo:pe-p2"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: campId,
          },
          candidate2
        ),
      ]);

      const state = db.getState();
      expect(state.deliveries).toHaveLength(1);
      // Both distinct certificates must be attached to this delivery
      expect(state.attachments).toHaveLength(2);
      const attachedCertIds = state.attachments.map((a) => a.certificate_id);
      expect(attachedCertIds).toContain(cert1Id);
      expect(attachedCertIds).toContain(cert2Id);
      expect(state.attachments[0].delivery_id).toBe(delId);
      expect(state.attachments[1].delivery_id).toBe(delId);
    });

    it("16. Direct 23505 unique constraint violation from concurrent insert is caught and treated as idempotent success", async () => {
      const campId = "camp-23505-idemp";
      const delId = "del-23505";
      const certId = "cert-23505";
      const idempKey = generateDeliveryIdempotencyKey(campId, "conflict@example.com", "individual");

      let upsertCalled = false;
      const campaigns = [{ id: campId, status: "draft", total_deliveries: 0, sent_count: 0 }];
      const deliveries = [{ id: delId, campaign_id: campId, recipient_email: "conflict@example.com", channel: "individual", idempotency_key: idempKey }];
      const certificates = [{ id: certId, certificate_number: "SAV26-CERT-23505", issue_source_key: "solo:pe-c23505", recipient_email: "conflict@example.com", event_name: "Roborace" }];

      const mockSupabase = {
        from: (table: string) => {
          if (table === "broadcast_campaigns") {
            return {
              select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: campaigns[0], error: null }) }) }),
              update: (d: any) => ({
                eq: () => {
                  Object.assign(campaigns[0], d);
                  return Promise.resolve({ error: null });
                },
              }),
            };
          }
          if (table === "participation_certificates") {
            return {
              select: () => ({ in: () => Promise.resolve({ data: certificates, error: null }) }),
            };
          }
          if (table === "broadcast_deliveries") {
            return {
              select: () => ({
                eq: () => ({
                  range: () => Promise.resolve({ data: deliveries, error: null }),
                  then: (r: any) => r({ data: deliveries, error: null }),
                }),
              }),
            };
          }
          if (table === "broadcast_delivery_attachments") {
            let selectCallCount = 0;
            return {
              select: () => ({
                in: () => {
                  selectCallCount++;
                  // First call (prefetch): empty, triggering insert/upsert attempt.
                  // Subsequent call (post-verification): confirms concurrent winner's association exists in DB.
                  if (selectCallCount === 1) {
                    return Promise.resolve({ data: [], error: null });
                  }
                  return Promise.resolve({
                    data: [{ delivery_id: delId, certificate_id: certId, filename: "Roborace.pdf" }],
                    error: null,
                  });
                },
              }),
              upsert: () => {
                upsertCalled = true;
                return Promise.resolve({
                  error: {
                    code: "23505",
                    message: 'duplicate key value violates unique constraint "uq_broadcast_delivery_attachments_delivery_cert"',
                  },
                });
              },
            };
          }
          return {};
        },
        rpc: () =>
          Promise.resolve({
            data: [{ id: certId, certificate_number: "SAV26-CERT-23505", issue_source_key: "solo:pe-c23505", is_new: false }],
            error: null,
          }),
      };

      const res = await createCertificateCampaign(
        mockSupabase as any,
        {
          ...defaultAdmin,
          title: "Conflict Campaign",
          subject: "Subject",
          bodyHtml: "<p>Hello</p>",
          selectedItemKeys: ["solo:pe-c23505"],
          sendIndividual: true,
          sendTeamBackup: false,
          campaignId: campId,
        },
        [
          {
            issueSourceKey: "solo:pe-c23505",
            certificateEligible: true,
            recipientEmail: "conflict@example.com",
            isValidEmail: true,
            recipientName: "Conflict Test",
            eventName: "Roborace",
          },
        ]
      );

      // Verify campaign successfully finalized to queued despite 23505 collision
      expect(res.campaignId).toBe(campId);
      expect(campaigns[0].status).toBe("queued");
      expect(upsertCalled).toBe(true);
    });

    it("17. Campaign cannot become queued until all required associations are persisted (strict gate)", async () => {
      const campId = "camp-gate-test";
      let queuedUpdateAttempted = false;
      const db = createDbSimulator({
        campaigns: [{ id: campId, status: "draft", total_deliveries: 0, sent_count: 0 }],
        failOnAttachmentInsert: true,
      });

      const originalFrom = db.from;
      db.from = (table: string) => {
        const handler = (originalFrom as any)(table);
        if (table === "broadcast_campaigns" && typeof handler.update === "function") {
          const originalUpdate = handler.update.bind(handler);
          handler.update = (data: any) => {
            if (data.status === "queued") {
              queuedUpdateAttempted = true;
            }
            return originalUpdate(data);
          };
        }
        return handler;
      };

      await expect(
        createCertificateCampaign(
          db as any,
          {
            ...defaultAdmin,
            title: "Gate Test",
            subject: "Your Certificate",
            bodyHtml: "<p>Hello</p>",
            selectedItemKeys: ["solo:pe-101"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: campId,
          },
          singleCandidate
        )
      ).rejects.toThrow(/Failed to link certificate attachments/);

      expect(queuedUpdateAttempted).toBe(false);
      expect(db.getState().campaigns[0].status).toBe("draft");
    });

    // =========================================================================
    // SAVISKAR PR #37 — Delivery Resolution Concurrency & Fail-Closed Guard Regression Suite
    // =========================================================================
    describe("Saviskar PR #37 — Delivery Resolution Concurrency & Fail-Closed Guards", () => {
    it("1 & 2. Concurrent delivery enqueue race & losing UUID isolation: both resolve to winner ID and attachments link to winner", async () => {
      const campId = "camp-concurrent-race-1";
      const idempKey = generateDeliveryIdempotencyKey(campId, "racer@example.com", "individual");
      const winningDeliveryId = "del-winner-uuid-1111";

      // DB simulator initialized with draft campaign and the winning delivery already persisted by Request A
      const db = createDbSimulator({
        campaigns: [{ id: campId, status: "draft", total_deliveries: 0, sent_count: 0 }],
        deliveries: [
          {
            id: winningDeliveryId,
            campaign_id: campId,
            recipient_email: "racer@example.com",
            channel: "individual",
            idempotency_key: idempKey,
          },
        ],
      });

      // Request B runs with candidate data for racer@example.com
      const res = await createCertificateCampaign(
        db as any,
        {
          ...defaultAdmin,
          title: "Saviskar 2026 Certificates",
          subject: "Your Certificate",
          bodyHtml: "<p>Congrats</p>",
          selectedItemKeys: ["solo:pe-101"],
          sendIndividual: true,
          sendTeamBackup: false,
          campaignId: campId,
        },
        [
          {
            issueSourceKey: "solo:pe-101",
            certificateEligible: true,
            recipientEmail: "racer@example.com",
            isValidEmail: true,
            recipientName: "Racer Student",
            eventName: "Roborace",
          },
        ]
      );

      expect(res.campaignId).toBe(campId);
      const state = db.getState();
      // Exactly 1 delivery exists and its ID is the winning ID
      expect(state.deliveries).toHaveLength(1);
      expect(state.deliveries[0].id).toBe(winningDeliveryId);

      // Attachment MUST be linked to winningDeliveryId, NEVER any losing UUID
      expect(state.attachments).toHaveLength(1);
      expect(state.attachments[0].delivery_id).toBe(winningDeliveryId);
    });

    it("3. Delivery query failure during reconciliation: Error in Step A.1 throws immediately and preserves campaign as draft", async () => {
      const campId = "camp-reconciliation-err-3";
      const db = createDbSimulator({
        campaigns: [{ id: campId, status: "draft", total_deliveries: 0, sent_count: 0 }],
      });

      // Inject error on delivery select
      const originalFrom = db.from;
      db.from = (table: string) => {
        const handler = (originalFrom as any)(table);
        if (table === "broadcast_deliveries") {
          return {
            ...handler,
            select: () => ({
              eq: () => Promise.resolve({ data: null, error: { message: "Simulated network timeout during delivery prefetch" } }),
            }),
          };
        }
        return handler;
      };

      await expect(
        createCertificateCampaign(
          db as any,
          {
            ...defaultAdmin,
            title: "Reconciliation Error Test",
            subject: "Your Certificate",
            bodyHtml: "<p>Congrats</p>",
            selectedItemKeys: ["solo:pe-101"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: campId,
          },
          singleCandidate
        )
      ).rejects.toThrow(/Failed to query campaign deliveries/);

      expect(db.getState().campaigns[0].status).toBe("draft");
      expect(db.getState().deliveries).toHaveLength(0);
    });

    it("4. Delivery pagination failure: Database error on subsequent page halts reconciliation and fails closed", async () => {
      const campId = "camp-pagination-err-4";
      const db = createDbSimulator({
        campaigns: [{ id: campId, status: "draft", total_deliveries: 0, sent_count: 0 }],
      });

      let pageCallCount = 0;
      const originalFrom = db.from;
      db.from = (table: string) => {
        const handler = (originalFrom as any)(table);
        if (table === "broadcast_deliveries") {
          return {
            ...handler,
            select: () => ({
              eq: () => ({
                range: (from: number, to: number) => {
                  pageCallCount++;
                  if (pageCallCount === 1) {
                    // Page 1 succeeds with 1,000 fake items
                    const items = Array.from({ length: 1000 }, (_, i) => ({
                      id: `del-p1-${i}`,
                      idempotency_key: `idemp-p1-${i}`,
                      recipient_email: `user${i}@example.com`,
                    }));
                    return Promise.resolve({ data: items, error: null });
                  }
                  // Page 2 fails
                  return Promise.resolve({ data: null, error: { message: "Database read failure on page 2" } });
                },
              }),
            }),
          };
        }
        return handler;
      };

      await expect(
        createCertificateCampaign(
          db as any,
          {
            ...defaultAdmin,
            title: "Pagination Error Test",
            subject: "Your Certificate",
            bodyHtml: "<p>Congrats</p>",
            selectedItemKeys: ["solo:pe-101"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: campId,
          },
          singleCandidate
        )
      ).rejects.toThrow(/Failed to query campaign deliveries.*page 2/);

      expect(db.getState().campaigns[0].status).toBe("draft");
    });

    it("5. Mismatched recipient rejection: Persisted delivery with different recipient_email throws integrity error and fails closed", async () => {
      const campId = "camp-mismatch-recip-5";
      const idempKey = generateDeliveryIdempotencyKey(campId, "victim@example.com", "individual");

      // Corrupted DB state: delivery for this idempotency key has attacker's email
      const db = createDbSimulator({
        campaigns: [{ id: campId, status: "draft", total_deliveries: 0, sent_count: 0 }],
        deliveries: [
          {
            id: "del-corrupted-5",
            campaign_id: campId,
            recipient_email: "attacker@malicious.com",
            channel: "individual",
            idempotency_key: idempKey,
          },
        ],
      });

      await expect(
        createCertificateCampaign(
          db as any,
          {
            ...defaultAdmin,
            title: "Recipient Mismatch Test",
            subject: "Your Certificate",
            bodyHtml: "<p>Congrats</p>",
            selectedItemKeys: ["solo:pe-victim"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: campId,
          },
          [
            {
              issueSourceKey: "solo:pe-victim",
              certificateEligible: true,
              recipientEmail: "victim@example.com",
              isValidEmail: true,
              recipientName: "Victim User",
              eventName: "Roborace",
            },
          ]
        )
      ).rejects.toThrow(/Delivery recipient mismatch: Persisted delivery "del-corrupted-5" recipient "attacker@malicious.com" does not match intended recipient "victim@example.com"/);

      expect(db.getState().campaigns[0].status).toBe("draft");
      expect(db.getState().attachments).toHaveLength(0);
    });

    it("6. Delivery channel mismatch rejection: Persisted delivery with different channel throws integrity error and fails closed", async () => {
      const campId = "camp-mismatch-channel-6";
      const idempKey = generateDeliveryIdempotencyKey(campId, "alice@example.com", "individual");

      const db = createDbSimulator({
        campaigns: [{ id: campId, status: "draft", total_deliveries: 0, sent_count: 0 }],
        deliveries: [
          {
            id: "del-channel-mismatch-6",
            campaign_id: campId,
            recipient_email: "alice@example.com",
            channel: "team_backup", // channel mismatch!
            idempotency_key: idempKey,
          },
        ],
      });

      await expect(
        createCertificateCampaign(
          db as any,
          {
            ...defaultAdmin,
            title: "Channel Mismatch Test",
            subject: "Your Certificate",
            bodyHtml: "<p>Congrats</p>",
            selectedItemKeys: ["solo:pe-101"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: campId,
          },
          singleCandidate
        )
      ).rejects.toThrow(/Delivery channel mismatch/);

      expect(db.getState().campaigns[0].status).toBe("draft");
      expect(db.getState().attachments).toHaveLength(0);
    });

    it("7. Missing attachment verification failure: Step B.5 fails closed if any expected association is missing in database", async () => {
      const campId = "camp-missing-att-verify-7";
      const db = createDbSimulator({
        campaigns: [{ id: campId, status: "draft", total_deliveries: 0, sent_count: 0 }],
      });

      // Emulate attachment table dropping records (e.g. simulated DB failure or silent drop)
      const originalFrom = db.from;
      db.from = (table: string) => {
        const handler = (originalFrom as any)(table);
        if (table === "broadcast_delivery_attachments") {
          let callCount = 0;
          return {
            ...handler,
            select: () => ({
              in: () => {
                callCount++;
                if (callCount === 1) {
                  // Step B prefetch: empty
                  return Promise.resolve({ data: [], error: null });
                }
                // Step B.5 verification: returns empty array (associations missing!)
                return Promise.resolve({ data: [], error: null });
              },
            }),
          };
        }
        return handler;
      };

      await expect(
        createCertificateCampaign(
          db as any,
          {
            ...defaultAdmin,
            title: "Missing Attachment Verification Test",
            subject: "Your Certificate",
            bodyHtml: "<p>Congrats</p>",
            selectedItemKeys: ["solo:pe-101"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: campId,
          },
          singleCandidate
        )
      ).rejects.toThrow(/Attachment persistence verification failed/);

      expect(db.getState().campaigns[0].status).toBe("draft");
    });

    it("8. Attachment query failure in Step B.5 throws and prevents campaign from transitioning to queued", async () => {
      const campId = "camp-att-query-err-8";
      const db = createDbSimulator({
        campaigns: [{ id: campId, status: "draft", total_deliveries: 0, sent_count: 0 }],
      });

      const originalFrom = db.from;
      db.from = (table: string) => {
        const handler = (originalFrom as any)(table);
        if (table === "broadcast_delivery_attachments") {
          let callCount = 0;
          return {
            ...handler,
            select: () => ({
              in: () => {
                callCount++;
                if (callCount === 1) {
                  return Promise.resolve({ data: [], error: null });
                }
                // Step B.5 verification fails with DB error
                return Promise.resolve({ data: null, error: { message: "Timeout verifying attachment persistence" } });
              },
            }),
          };
        }
        return handler;
      };

      await expect(
        createCertificateCampaign(
          db as any,
          {
            ...defaultAdmin,
            title: "Attachment Query Error Test",
            subject: "Your Certificate",
            bodyHtml: "<p>Congrats</p>",
            selectedItemKeys: ["solo:pe-101"],
            sendIndividual: true,
            sendTeamBackup: false,
            campaignId: campId,
          },
          singleCandidate
        )
      ).rejects.toThrow(/Failed to verify attachment persistence.*Timeout/);

      expect(db.getState().campaigns[0].status).toBe("draft");
    });

    it("9. Migration idempotency: Migration 20261101000000 preflights duplicates and adds unique constraint safely", () => {
      const migrationPath = path.resolve(
        __dirname,
        "../../supabase/migrations/20261101000000_unique_broadcast_delivery_attachments.sql"
      );
      expect(fs.existsSync(migrationPath)).toBe(true);
      const sql = fs.readFileSync(migrationPath, "utf-8");

      // Verify preflight duplicate check exists
      expect(sql.toUpperCase()).toContain("SELECT COUNT(*)");
      expect(sql.toUpperCase()).toContain("FROM PUBLIC.BROADCAST_DELIVERY_ATTACHMENTS");
      expect(sql.toUpperCase()).toContain("GROUP BY DELIVERY_ID, CERTIFICATE_ID");
      expect(sql.toUpperCase()).toContain("HAVING COUNT(*) > 1");
      expect(sql).toContain("RAISE EXCEPTION");

      // Verify pg_constraint check exists before adding constraint
      expect(sql).toContain("pg_constraint");
      expect(sql).toContain("conname = 'uq_broadcast_delivery_attachments_delivery_cert'");
      expect(sql).toContain("ALTER TABLE public.broadcast_delivery_attachments");
      expect(sql).toContain("ADD CONSTRAINT uq_broadcast_delivery_attachments_delivery_cert");
      expect(sql).toContain("UNIQUE (delivery_id, certificate_id)");

      // Verify no redundant CREATE INDEX statements
      expect(sql).not.toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_broadcast_delivery_attachments_delivery_cert");
    });

    it("10. End-to-end retry idempotency: Multiple retries leave exactly 1 delivery and 1 attachment with zero duplicates", async () => {
      const campId = "camp-e2e-idemp-10";
      const db = createDbSimulator({
        campaigns: [{ id: campId, status: "draft", total_deliveries: 0, sent_count: 0 }],
      });

      const callArgs = {
        ...defaultAdmin,
        title: "Saviskar Certificate Campaign",
        subject: "Your Certificate",
        bodyHtml: "<p>Hello</p>",
        selectedItemKeys: ["solo:pe-101"],
        sendIndividual: true,
        sendTeamBackup: false,
        campaignId: campId,
      };

      // 1st execution
      const res1 = await createCertificateCampaign(db as any, callArgs, singleCandidate);
      expect(res1.campaignId).toBe(campId);
      const state1 = db.getState();
      expect(state1.deliveries).toHaveLength(1);
      expect(state1.attachments).toHaveLength(1);
      const deliveryId = state1.deliveries[0].id;
      const attachmentId = state1.attachments[0].id;
      expect(state1.campaigns[0].status).toBe("queued");

      // Reset campaign status to draft to simulate an interrupted/re-enqueued retry
      state1.campaigns[0].status = "draft";
      state1.campaigns[0].total_deliveries = 0;

      // 2nd execution (retry)
      const res2 = await createCertificateCampaign(db as any, callArgs, singleCandidate);
      expect(res2.campaignId).toBe(campId);
      const state2 = db.getState();
      expect(state2.deliveries).toHaveLength(1);
      expect(state2.deliveries[0].id).toBe(deliveryId);
      expect(state2.attachments).toHaveLength(1);
      expect(state2.attachments[0].id).toBe(attachmentId);
      expect(state2.campaigns[0].status).toBe("queued");

      // Reset once more for 3rd execution
      state2.campaigns[0].status = "draft";
      state2.campaigns[0].total_deliveries = 0;

      // 3rd execution (retry)
      const res3 = await createCertificateCampaign(db as any, callArgs, singleCandidate);
      expect(res3.campaignId).toBe(campId);
      const state3 = db.getState();
      expect(state3.deliveries).toHaveLength(1);
      expect(state3.deliveries[0].id).toBe(deliveryId);
      expect(state3.attachments).toHaveLength(1);
      expect(state3.attachments[0].id).toBe(attachmentId);
      expect(state3.campaigns[0].status).toBe("queued");
    });
  });
});
});
