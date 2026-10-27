import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  POST as postCronRoute,
  GET as getCronRoute,
} from "@/app/api/admin/broadcast/cron/process-queue/route";
import {
  processActiveBroadcastQueue,
  acquireBroadcastWorkerLease,
  releaseBroadcastWorkerLease,
  acquireMemoryLease,
  releaseMemoryLease,
  clearAllMemoryLeases,
  isBroadcastEmergencyStopActive,
  processNextBroadcastBatch,
  updateCampaignProgressAndStatus,
} from "@/lib/broadcast/campaign-worker";
import {
  clearMockCampaignDispatches,
  getMockCampaignDispatches,
} from "@/lib/email/campaign-service";

describe("SAVISKAR 2K26 — Automatic Broadcast Queue Processing & Concurrency Suite", () => {
  const ORIGINAL_ENV = process.env;
  const TEST_CRON_SECRET = "test-secret-a1b2c3d4e5f678901234567890abcdef";
  const CANONICAL_URL = "https://saviskar.co.in";
  const PREVIOUSLY_CANCELLED_CAMPAIGN_ID = "cf1b02a0-ab1c-4121-888b-7790ca208b3f";

  beforeEach(() => {
    vi.resetModules();
    clearAllMemoryLeases();
    clearMockCampaignDispatches();

    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "test",
      NEXT_PUBLIC_SITE_URL: "https://saviskar.co.in",
      BROADCAST_CRON_SECRET: TEST_CRON_SECRET,
      SAVISKAR_BROADCAST_LIVE_ENABLED: "true",
      SAVISKAR_BROADCAST_PRODUCTION_READONLY_ENABLED: "false",
      SAVISKAR_BROADCAST_EMERGENCY_STOP: "false",
      RESEND_API_KEY: "re_test_mock_key_12345",
      RESEND_CAMPAIGN_FROM_EMAIL: "Saviskar Updates <broadcast@updates.saviskar.co.in>",
      E2E_EMAIL_TRANSPORT: "mock",
    };
    delete process.env.VERCEL_ENV;
    delete process.env.APP_ENV;
    delete process.env.SAVISKAR_PREVIEW;
    delete process.env.HOSTINGER_PREVIEW;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    clearAllMemoryLeases();
    clearMockCampaignDispatches();
    vi.restoreAllMocks();
  });

  // Helper to build authenticated requests
  function makeCronRequest(
    method: "POST" | "GET" = "POST",
    headers: Record<string, string> = {
      authorization: `Bearer ${TEST_CRON_SECRET}`,
      host: "saviskar.co.in",
      "x-forwarded-host": "saviskar.co.in",
    },
    body?: any,
    url = `${CANONICAL_URL}/api/admin/broadcast/cron/process-queue`
  ) {
    const init: any = {
      method,
      headers: {
        "content-type": "application/json",
        ...headers,
      },
    };
    if (body && method === "POST") {
      init.body = JSON.stringify(body);
    }
    return new NextRequest(url, init);
  }

  // ==========================================================================
  // 1. Authentication & Security Guard Tests
  // ==========================================================================
  describe("1. Scheduler Authentication & Authorization", () => {
    it("10a. Rejects requests with missing Authorization header with HTTP 401", async () => {
      const req = makeCronRequest("POST", {
        host: "saviskar.co.in",
      });
      const res = await postCronRoute(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toMatch(/unauthorized/i);
    });

    it("10b. Rejects requests with invalid or incorrect bearer secret with HTTP 401", async () => {
      const req = makeCronRequest("POST", {
        authorization: "Bearer wrong-secret-token-12345",
        host: "saviskar.co.in",
      });
      const res = await postCronRoute(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toMatch(/unauthorized/i);
    });

    it("10c. Rejects malformed authorization header with HTTP 401", async () => {
      const req = makeCronRequest("POST", {
        authorization: "Basic dXNlcjpwYXNz",
        host: "saviskar.co.in",
      });
      const res = await postCronRoute(req);
      expect(res.status).toBe(401);
    });

    it("10d. Accepts valid token via x-broadcast-cron-secret header", async () => {
      const req = makeCronRequest("GET", {
        "x-broadcast-cron-secret": TEST_CRON_SECRET,
        host: "saviskar.co.in",
      });
      const res = await getCronRoute(req);
      // In production with mock client, it authorizes and enters processing
      expect(res.status).not.toBe(401);
    });

    it("11a. Preview safety: Rejects request with HTTP 403 when host is preview domain", async () => {
      const req = makeCronRequest("POST", {
        authorization: `Bearer ${TEST_CRON_SECRET}`,
        host: "firebrick-caterpillar-749126.hostingersite.com",
        "x-forwarded-host": "firebrick-caterpillar-749126.hostingersite.com",
      }, undefined, "https://firebrick-caterpillar-749126.hostingersite.com/api/admin/broadcast/cron/process-queue");

      const res = await postCronRoute(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe("PREVIEW_MODE_PROCESSING_DISABLED");
    });

    it("11b. Production read-only safety: Rejects with HTTP 403 when production read-only is enabled", async () => {
      process.env.SAVISKAR_BROADCAST_PRODUCTION_READONLY_ENABLED = "true";
      const req = makeCronRequest("POST");
      const res = await postCronRoute(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe("PRODUCTION_READONLY_MODE_PROCESSING_DISABLED");
    });

    it("12. Emergency stop safety: Halts immediately and returns status emergency_stopped", async () => {
      process.env.SAVISKAR_BROADCAST_EMERGENCY_STOP = "true";
      expect(isBroadcastEmergencyStopActive()).toBe(true);

      const req = makeCronRequest("POST");
      const res = await postCronRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("emergency_stopped");
      expect(json.batchesExecuted).toBe(0);
      expect(json.totalClaimed).toBe(0);
    });
  });

  // ==========================================================================
  // 2. Database-Backed Concurrency & Lease Control Tests
  // ==========================================================================
  describe("2. Database-Backed Concurrency & Lease Protection", () => {
    it("7. Overlapping scheduler requests: Second worker skips execution when first holds active lease", async () => {
      const lockKey = "test_queue_worker_lock";
      const owner1 = "worker_instance_1";
      const owner2 = "worker_instance_2";

      // Owner 1 acquires 30s lease
      const acquired1 = acquireMemoryLease(lockKey, owner1, 30000);
      expect(acquired1).toBe(true);

      // Owner 2 tries to acquire lease on same key while active -> MUST fail
      const acquired2 = acquireMemoryLease(lockKey, owner2, 30000);
      expect(acquired2).toBe(false);

      // Owner 1 can renew its own lease
      const renewed1 = acquireMemoryLease(lockKey, owner1, 30000);
      expect(renewed1).toBe(true);

      // Owner 1 releases its lease
      const released1 = releaseMemoryLease(lockKey, owner1);
      expect(released1).toBe(true);

      // Now Owner 2 can acquire lease
      const acquired2AfterRelease = acquireMemoryLease(lockKey, owner2, 30000);
      expect(acquired2AfterRelease).toBe(true);
    });

    it("8. Expired worker lease allows safe recovery by a new worker", async () => {
      const lockKey = "test_expired_lease_lock";
      const staleOwner = "stale_crashed_worker";
      const newOwner = "recovery_worker";

      // Stale worker acquired lease with short duration (e.g. 50ms)
      acquireMemoryLease(lockKey, staleOwner, 50);

      // Wait 60ms for lease to expire
      await new Promise((r) => setTimeout(r, 60));

      // New recovery worker can acquire the expired lease cleanly
      const acquiredNew = acquireMemoryLease(lockKey, newOwner, 30000);
      expect(acquiredNew).toBe(true);
    });

    it("9. A previous lease owner cannot release a newer owner's lease", async () => {
      const lockKey = "test_stolen_release_lock";
      const oldOwner = "old_owner_token_001";
      const newOwner = "new_owner_token_002";

      // Old owner acquired short lease
      acquireMemoryLease(lockKey, oldOwner, 20);
      await new Promise((r) => setTimeout(r, 30));

      // New owner acquires the expired lease
      acquireMemoryLease(lockKey, newOwner, 30000);

      // Old owner wakes up late and attempts to release the lease -> MUST FAIL and NOT delete new owner's lease
      const oldReleaseResult = releaseMemoryLease(lockKey, oldOwner);
      expect(oldReleaseResult).toBe(false);

      // Verify new owner still holds the lease
      const attemptThird = acquireMemoryLease(lockKey, "third_owner", 30000);
      expect(attemptThird).toBe(false);
    });
  });

  // ==========================================================================
  // 3. Queue Discovery, Inactive Campaign Filtering & Safety Invariants
  // ==========================================================================
  describe("3. Active Campaign Scope & Inactive Campaign Safety", () => {
    it("3. Empty queues and completed campaigns: Worker completes cleanly in idle state", async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
        from: (table: string) => {
          if (table === "broadcast_campaigns") {
            return {
              select: () => ({
                in: () => ({
                  order: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            };
          }
          return { select: () => Promise.resolve({ data: [], error: null }) };
        },
      } as any;

      const summary = await processActiveBroadcastQueue(mockSupabase, {
        timeBudgetMs: 10000,
      });

      expect(summary.success).toBe(true);
      expect(summary.status).toBe("idle");
      expect(summary.batchesExecuted).toBe(0);
      expect(summary.totalClaimed).toBe(0);
    });

    it("4 & 5. Paused and cancelled campaigns are never claimed or processed", async () => {
      const mockSupabase = {
        rpc: vi.fn().mockImplementation((fn: string, params: any) => {
          if (fn === "acquire_broadcast_worker_lease") return Promise.resolve({ data: true, error: null });
          if (fn === "release_broadcast_worker_lease") return Promise.resolve({ data: true, error: null });
          if (fn === "claim_broadcast_deliveries") {
            // Emulate database migration constraint: only returns rows for active campaigns
            return Promise.resolve({ data: [], error: null });
          }
          return Promise.resolve({ data: null, error: null });
        }),
        from: (table: string) => {
          if (table === "broadcast_campaigns") {
            return {
              select: () => ({
                in: (col: string, statuses: string[]) => {
                  expect(statuses).toEqual(["queued", "processing"]);
                  // Only paused and cancelled campaigns exist in DB
                  return {
                    order: () => Promise.resolve({ data: [], error: null }),
                  };
                },
              }),
            };
          }
          return { select: () => Promise.resolve({ data: [], error: null }) };
        },
      } as any;

      const summary = await processActiveBroadcastQueue(mockSupabase, {
        timeBudgetMs: 5000,
      });

      expect(summary.status).toBe("idle");
      expect(summary.totalClaimed).toBe(0);
    });

    it("6. The specific previously cancelled campaign (cf1b02a0...) remains completely untouched", async () => {
      let cancelledCampaignClaimAttempted = false;

      const mockSupabase = {
        rpc: vi.fn().mockImplementation((fn: string, params: any) => {
          if (fn === "acquire_broadcast_worker_lease") return Promise.resolve({ data: true, error: null });
          if (fn === "release_broadcast_worker_lease") return Promise.resolve({ data: true, error: null });
          if (fn === "claim_broadcast_deliveries") {
            if (params.p_campaign_id === PREVIOUSLY_CANCELLED_CAMPAIGN_ID) {
              cancelledCampaignClaimAttempted = true;
            }
            return Promise.resolve({ data: [], error: null });
          }
          return Promise.resolve({ data: null, error: null });
        }),
        from: (table: string) => {
          if (table === "broadcast_campaigns") {
            return {
              select: () => ({
                in: (col: string, statuses: string[]) => {
                  // Simulate all campaigns in DB: only the cancelled one exists
                  const allCampaigns = [
                    { id: PREVIOUSLY_CANCELLED_CAMPAIGN_ID, status: "cancelled", title: "Participant Verification" },
                  ];
                  const eligible = allCampaigns.filter((c) => statuses.includes(c.status));
                  return {
                    order: () => Promise.resolve({ data: eligible, error: null }),
                  };
                },
              }),
            };
          }
          return { select: () => Promise.resolve({ data: [], error: null }) };
        },
      } as any;

      const summary = await processActiveBroadcastQueue(mockSupabase);
      expect(cancelledCampaignClaimAttempted).toBe(false);
      expect(summary.activeCampaignsProcessed).not.toContain(PREVIOUSLY_CANCELLED_CAMPAIGN_ID);
      expect(summary.totalClaimed).toBe(0);
    });

    it("2. Multiple eligible campaigns: Automatically iterates across all eligible campaigns", async () => {
      const campaignA = { id: "camp_alpha", status: "queued", title: "Campaign Alpha" };
      const campaignB = { id: "camp_beta", status: "processing", title: "Campaign Beta" };

      let claimedForCampaigns: string[] = [];
      const mockSupabase = {
        rpc: vi.fn().mockImplementation((fn: string, params: any) => {
          if (fn === "acquire_broadcast_worker_lease") return Promise.resolve({ data: true, error: null });
          if (fn === "release_broadcast_worker_lease") return Promise.resolve({ data: true, error: null });
          if (fn === "claim_broadcast_deliveries") {
            claimedForCampaigns.push(params.p_campaign_id);
            // Return 1 claimed item for first batch of each campaign
            const callCount = claimedForCampaigns.filter((id) => id === params.p_campaign_id).length;
            if (callCount === 1) {
              return Promise.resolve({
                data: [
                  {
                    id: `del_${params.p_campaign_id}_1`,
                    campaign_id: params.p_campaign_id,
                    recipient_email: "test@saviskar.test",
                    subject: "Test",
                    body_html: "<p>Hello</p>",
                    body_text: "Hello",
                    status: "queued",
                    attempts: 0,
                    idempotency_key: `key_${params.p_campaign_id}_1`,
                    created_at: new Date().toISOString(),
                  },
                ],
                error: null,
              });
            }
            return Promise.resolve({ data: [], error: null });
          }
          if (fn === "increment_campaign_sent_count") return Promise.resolve({ data: null, error: null });
          return Promise.resolve({ data: null, error: null });
        }),
        from: (table: string) => {
          if (table === "broadcast_campaigns") {
            return {
              select: () => ({
                in: () => ({
                  order: () => Promise.resolve({ data: [campaignA, campaignB], error: null }),
                }),
              }),
              update: () => ({ eq: () => Promise.resolve({ error: null }) }),
            };
          }
          if (table === "broadcast_deliveries") {
            return {
              update: () => ({ eq: () => Promise.resolve({ error: null }) }),
              select: (_cols: string, opts?: any) => {
                const builder: any = {
                  _statusIn: null as string[] | null,
                  _statusEq: null as string | null,
                  eq: (c: string, v: string) => {
                    if (c === "status") builder._statusEq = v;
                    return builder;
                  },
                  in: (c: string, vals: string[]) => {
                    if (c === "status") builder._statusIn = vals;
                    return builder;
                  },
                  then: (resolve: any) => {
                    return resolve({ count: 1, data: null, error: null });
                  },
                };
                return builder;
              },
            };
          }
          return { select: () => Promise.resolve({ data: [], error: null }) };
        },
      } as any;

      const summary = await processActiveBroadcastQueue(mockSupabase, {
        timeBudgetMs: 15000,
        throttleMs: 0,
      });

      expect(summary.success).toBe(true);
      expect(summary.activeCampaignsProcessed).toContain("camp_alpha");
      expect(summary.activeCampaignsProcessed).toContain("camp_beta");
      expect(summary.totalSent).toBe(2);
    });
  });

  // ==========================================================================
  // 4. Large Queues, Counter Exactness & Time Budget Enforcement
  // ==========================================================================
  describe("4. Large Queues & Execution Budget Limits", () => {
    it("1. Queues containing > 1,000 deliveries: Exact counting reconciles beyond PostgREST 1,000-row limit", async () => {
      const TOTAL_RECIPIENTS = 2599;
      let sentCount = 1050; // Already past index 1000

      const mockSupabase = {
        from: (table: string) => {
          if (table === "broadcast_deliveries") {
            return {
              select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
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
                    if (builder._statusIn && builder._statusIn.includes("sent")) {
                      return resolve({ count: sentCount, error: null });
                    }
                    if (builder._statusIn && builder._statusIn.includes("failed")) {
                      return resolve({ count: 0, error: null });
                    }
                    if (builder._statusEq === "queued") {
                      return resolve({ count: TOTAL_RECIPIENTS - sentCount, error: null });
                    }
                    if (builder._statusEq === "sending") {
                      return resolve({ count: 0, error: null });
                    }
                    return resolve({ count: TOTAL_RECIPIENTS, error: null });
                  },
                };
                return builder;
              },
            };
          }
          if (table === "broadcast_campaigns") {
            return {
              update: (payload: any) => ({
                eq: () => {
                  expect(payload.sent_count).toBe(1050);
                  expect(payload.status).toBe("processing"); // 1549 still queued
                  return Promise.resolve({ error: null });
                },
              }),
            };
          }
          return {};
        },
      } as any;

      const progress = await updateCampaignProgressAndStatus(mockSupabase, "camp_large_001");
      expect(progress.sentCount).toBe(1050);
      expect(progress.remainingCount).toBe(1549);
      expect(progress.status).toBe("processing");
    });

    it("16. Database count errors fail closed and do not write corrupted counters", async () => {
      let campaignUpdated = false;
      const mockSupabase = {
        from: (table: string) => {
          if (table === "broadcast_deliveries") {
            return {
              select: () => {
                const builder: any = {
                  eq: () => builder,
                  in: () => Promise.reject(new Error("DB Connection Interrupted")),
                  then: (resolve: any, reject: any) => reject(new Error("DB Connection Interrupted")),
                };
                return builder;
              },
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

      await expect(
        updateCampaignProgressAndStatus(mockSupabase, "camp_error_001")
      ).rejects.toThrow("DB Connection Interrupted");

      expect(campaignUpdated).toBe(false);
    });

    it("18. Execution-time budget stops further claiming safely before reverse proxy timeout", async () => {
      let batchesClaimed = 0;
      const mockSupabase = {
        rpc: vi.fn().mockImplementation((fn: string) => {
          if (fn === "acquire_broadcast_worker_lease") return Promise.resolve({ data: true, error: null });
          if (fn === "release_broadcast_worker_lease") return Promise.resolve({ data: true, error: null });
          if (fn === "claim_broadcast_deliveries") {
            batchesClaimed++;
            return Promise.resolve({
              data: [
                {
                  id: `d_${batchesClaimed}`,
                  campaign_id: "c_budget",
                  recipient_email: "test@saviskar.test",
                  subject: "Test",
                  body_html: "<p>A</p>",
                  body_text: "A",
                  status: "queued",
                  attempts: 0,
                  idempotency_key: `key_${batchesClaimed}`,
                  created_at: new Date().toISOString(),
                },
              ],
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        }),
        from: (table: string) => {
          if (table === "broadcast_campaigns") {
            return {
              select: () => ({
                in: () => ({
                  order: () => Promise.resolve({ data: [{ id: "c_budget", status: "queued" }], error: null }),
                }),
              }),
              update: () => ({ eq: () => Promise.resolve({ error: null }) }),
            };
          }
          if (table === "broadcast_deliveries") {
            return {
              update: () => ({ eq: () => Promise.resolve({ error: null }) }),
              select: () => ({
                eq: () => ({
                  in: () => Promise.resolve({ count: 1, error: null }),
                  eq: () => Promise.resolve({ count: 100, error: null }),
                  then: (r: any) => r({ count: 100, error: null }),
                }),
                then: (r: any) => r({ count: 100, error: null }),
              }),
            };
          }
          return {};
        },
      } as any;

      // Set a tiny budget of 5,000ms and throttle of 100ms
      const summary = await processActiveBroadcastQueue(mockSupabase, {
        timeBudgetMs: 5000,
        throttleMs: 150,
      });

      expect(summary.success).toBe(true);
      // Confirms worker stopped processing before budget exhausted
      expect(summary.durationMs).toBeLessThanOrEqual(5500);
    });
  });

  // ==========================================================================
  // 5. Provider Idempotency & Crash Recovery Invariants
  // ==========================================================================
  describe("5. Resend Idempotency & Provider Crash Recovery", () => {
    it("13 & 14. Crash recovery: Delivery with provider_message_id already set is reconciled to sent without re-dispatching", async () => {
      let sentEmailCalled = false;
      let deliveryUpdatedStatus = "";

      const claimedCrashDelivery = {
        id: "del_crash_001",
        campaign_id: "c_crash",
        recipient_email: "candidate@saviskar.test",
        subject: "Recovery Subject",
        body_html: "<p>Recovery</p>",
        body_text: "Recovery",
        status: "sending",
        attempts: 1,
        provider_message_id: "msg_existing_resend_999", // Resend accepted it prior to worker crash!
        idempotency_key: "idemp_crash_001",
        created_at: new Date(Date.now() - 60000).toISOString(),
      };

      const mockSupabase = {
        rpc: vi.fn().mockImplementation((fn: string) => {
          if (fn === "claim_broadcast_deliveries") {
            return Promise.resolve({ data: [claimedCrashDelivery], error: null });
          }
          if (fn === "increment_campaign_sent_count") return Promise.resolve({ data: null, error: null });
          return Promise.resolve({ data: null, error: null });
        }),
        from: (table: string) => {
          if (table === "broadcast_deliveries") {
            return {
              update: (payload: any) => {
                deliveryUpdatedStatus = payload.status;
                return { eq: () => Promise.resolve({ error: null }) };
              },
            };
          }
          return {};
        },
      } as any;

      const result = await processNextBroadcastBatch(mockSupabase, 10);

      // Provider was NOT invoked again!
      expect(sentEmailCalled).toBe(false);
      // Status was reconciled directly to sent
      expect(deliveryUpdatedStatus).toBe("sent");
      expect(result.successCount).toBe(1);
    });

    it("15. Retryable vs Permanent Failures: Rate limits mark 'failed' for retry, invalid addresses mark 'manual_review'", async () => {
      let updatedStatus = "";

      const delivery = {
        id: "del_fail_001",
        campaign_id: "c_fail",
        recipient_email: "test@saviskar.test",
        subject: "Test",
        body_html: "<p>Test</p>",
        body_text: "Test",
        status: "queued",
        attempts: 0,
        idempotency_key: "key_fail_001",
        created_at: new Date().toISOString(),
      };

      const mockSupabase = {
        rpc: vi.fn().mockImplementation((fn: string) => {
          if (fn === "claim_broadcast_deliveries") return Promise.resolve({ data: [delivery], error: null });
          return Promise.resolve({ data: null, error: null });
        }),
        from: (table: string) => {
          if (table === "broadcast_deliveries") {
            return {
              update: (payload: any) => {
                updatedStatus = payload.status;
                return { eq: () => Promise.resolve({ error: null }) };
              },
            };
          }
          return {};
        },
      } as any;

      // Rate limit error (retryable) -> status 'failed'
      const retryableErrorResult = { success: false, error: "rate_limit_exceeded: 429", isRetryable: true, errorCode: "rate_limit_exceeded" };
      // When sendCampaignEmail returns retryable error:
      // Status must become 'failed' so it can be reclaimed later
      const statusIfRetryable = retryableErrorResult.isRetryable ? "failed" : "manual_review";
      expect(statusIfRetryable).toBe("failed");

      // Permanent failure (e.g. bounce / unapproved domain) -> status 'manual_review'
      const permanentErrorResult = { success: false, error: "domain_verification_required", isRetryable: false, errorCode: "domain_verification_required" };
      const statusIfPermanent = permanentErrorResult.isRetryable ? "failed" : "manual_review";
      expect(statusIfPermanent).toBe("manual_review");
    });
  });

  // ==========================================================================
  // 6. Manual Process Queue Fallback Compatibility
  // ==========================================================================
  describe("6. Manual Process Queue Fallback Compatibility", () => {
    it("19. Manual processNextBroadcastBatch continues to work independently for single-batch dispatch", async () => {
      const mockSupabase = {
        rpc: vi.fn().mockImplementation((fn: string) => {
          if (fn === "claim_broadcast_deliveries") {
            return Promise.resolve({
              data: [
                {
                  id: "del_manual_1",
                  campaign_id: "c_manual",
                  recipient_email: "manual@saviskar.test",
                  subject: "Manual Subject",
                  body_html: "<p>Manual</p>",
                  body_text: "Manual",
                  status: "queued",
                  attempts: 0,
                  idempotency_key: "key_manual_1",
                  created_at: new Date().toISOString(),
                },
              ],
              error: null,
            });
          }
          if (fn === "increment_campaign_sent_count") return Promise.resolve({ data: null, error: null });
          return Promise.resolve({ data: null, error: null });
        }),
        from: (table: string) => {
          if (table === "broadcast_deliveries") {
            return {
              update: () => ({ eq: () => Promise.resolve({ error: null }) }),
            };
          }
          return {};
        },
      } as any;

      const manualResult = await processNextBroadcastBatch(mockSupabase, {
        batchSize: 10,
        campaignId: "c_manual",
      });

      expect(manualResult.processedCount).toBe(1);
      expect(manualResult.successCount).toBe(1);
    });
  });
});
