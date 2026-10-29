import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

/**
 * SAVISKAR 2026 — REAL POSTGRESQL CONCURRENCY INTEGRATION TEST
 * File: __tests__/integration/receipt-email-claim-concurrency.integration.ts
 *
 * PURPOSE:
 * Verifies atomic row-level locking on payment_orders during concurrent email claims
 * against a real, live PostgreSQL instance.
 *
 * SAFETY INVARIANT:
 * Fails closed immediately if configured URL points to the production Supabase instance
 * (ikavnyjfmdxjnlbovkzm.supabase.co). Runs ONLY against a local disposable database (localhost/127.0.0.1).
 *
 * HOW TO RUN LOCALLY:
 * 1. Start local Supabase / PostgreSQL:
 *    npx supabase start
 * 2. Set environment variables:
 *    $env:INTEGRATION_TEST_SUPABASE_URL="http://127.0.0.1:54321"
 *    $env:INTEGRATION_TEST_SUPABASE_SERVICE_ROLE_KEY="<local_service_role_key>"
 * 3. Run:
 *    npx vitest run __tests__/integration/receipt-email-claim-concurrency.integration.ts
 */

const supabaseUrl = process.env.INTEGRATION_TEST_SUPABASE_URL || "";
const supabaseServiceKey = process.env.INTEGRATION_TEST_SUPABASE_SERVICE_ROLE_KEY || "";

let isSafeLocalDatabase = false;

if (supabaseUrl && supabaseServiceKey) {
  try {
    const url = new URL(supabaseUrl);
    // Explicitly reject production and unknown remote domains
    const isProduction =
      url.hostname.includes("ikavnyjfmdxjnlbovkzm.supabase.co") ||
      (url.hostname.includes("supabase.co") && url.hostname !== "mjxwzknnlgvwtwklzkks.supabase.co");
    const isLocal = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    const isStaging = url.hostname === "mjxwzknnlgvwtwklzkks.supabase.co";
    const allowStaging = process.env.ALLOW_STAGING_INTEGRATION_TESTS === "true";

    if (isProduction) {
      console.error(
        "FATAL: Test target rejected. INTEGRATION_TEST_SUPABASE_URL points to the production domain. Aborting immediately."
      );
      process.exit(1);
    }

    if (!isLocal && !(isStaging && allowStaging)) {
      console.error(
        "FATAL: Test target rejected. Integration tests may only run against a local disposable database or explicitly authorized staging."
      );
      process.exit(1);
    }

    isSafeLocalDatabase = true;
  } catch {
    console.error("FATAL: Invalid INTEGRATION_TEST_SUPABASE_URL format.");
    process.exit(1);
  }
}

const runIntegration = isSafeLocalDatabase;

(runIntegration ? describe : describe.skip)(
  "INTEGRATION: Real PostgreSQL Receipt-Email Claim Concurrency & Atomic Locking",
  () => {
    let supabaseAdmin: any;
    const testIds = {
      participantId: `part-test-${crypto.randomUUID()}`,
      orderId: crypto.randomUUID(),
      orderReference: `TEST-ORD-${Date.now()}`,
    };

    beforeAll(async () => {
      supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      // Insert disposable participant fixture
      const { error: partErr } = await supabaseAdmin.from("participants").insert({
        id: testIds.participantId,
        participant_id: `SVK-T-${Date.now().toString().slice(-4)}`,
        name: "Concurrency Test Participant",
        email: "concurrency.test@saviskar.local",
        phone: "9999900000",
        college: "Test University",
        gender: "other",
        state: "Punjab",
      });
      if (partErr) throw new Error(`Failed to create test participant: ${partErr.message}`);

      // Insert disposable payment order fixture
      const { error: poErr } = await supabaseAdmin.from("payment_orders").insert({
        id: testIds.orderId,
        order_reference: testIds.orderReference,
        payer_participant_id: testIds.participantId,
        amount: 499,
        currency: "INR",
        status: "paid",
        gateway: "payu",
        receipt_email_sent_at: null,
        receipt_email_claim_id: null,
        receipt_email_claimed_at: null,
      });
      if (poErr) throw new Error(`Failed to create test payment order: ${poErr.message}`);
    });

    afterAll(async () => {
      if (!supabaseAdmin) return;
      // Cleanup disposable fixtures
      await supabaseAdmin.from("payment_orders").delete().eq("id", testIds.orderId);
      await supabaseAdmin.from("participants").delete().eq("id", testIds.participantId);
    });

    it("1. Multiple concurrent claim requests serialize on PostgreSQL row lock: exactly ONE succeeds", async () => {
      const CONCURRENT_WORKERS = 5;
      const staleThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const nowIso = new Date().toISOString();

      const workerClaimIds = Array.from({ length: CONCURRENT_WORKERS }, () => crypto.randomUUID());

      // Fire 5 truly simultaneous HTTP update queries against real PostgreSQL
      const results = await Promise.all(
        workerClaimIds.map(async (claimId) => {
          const { data, error } = await supabaseAdmin
            .from("payment_orders")
            .update({
              receipt_email_claim_id: claimId,
              receipt_email_claimed_at: nowIso,
            })
            .eq("id", testIds.orderId)
            .is("receipt_email_sent_at", null)
            .or(`receipt_email_claim_id.is.null,receipt_email_claimed_at.is.null,receipt_email_claimed_at.lt.${staleThreshold}`)
            .select("id");

          return { claimId, data: data || [], error };
        })
      );

      // Verify no database network/syntax error
      results.forEach((r) => expect(r.error).toBeNull());

      // Count winners and losers
      const winners = results.filter((r) => r.data.length === 1);
      const losers = results.filter((r) => r.data.length === 0);

      expect(winners.length).toBe(1);
      expect(losers.length).toBe(CONCURRENT_WORKERS - 1);

      // Inspect DB state: order must hold the winner's claim ID
      const winningClaimId = winners[0].claimId;
      const { data: currentOrder } = await supabaseAdmin
        .from("payment_orders")
        .select("receipt_email_claim_id, receipt_email_claimed_at, receipt_email_sent_at")
        .eq("id", testIds.orderId)
        .single();

      expect(currentOrder.receipt_email_claim_id).toBe(winningClaimId);
      expect(currentOrder.receipt_email_sent_at).toBeNull();
    });

    it("2. Marking sent successfully clears claim and prevents subsequent claims in real PostgreSQL", async () => {
      const { data: currentOrder } = await supabaseAdmin
        .from("payment_orders")
        .select("receipt_email_claim_id")
        .eq("id", testIds.orderId)
        .single();

      const activeClaimId = currentOrder.receipt_email_claim_id;

      // Mark as sent
      const { data: markData, error: markErr } = await supabaseAdmin
        .from("payment_orders")
        .update({
          receipt_email_sent_at: new Date().toISOString(),
          receipt_email_claim_id: null,
          receipt_email_claimed_at: null,
        })
        .eq("id", testIds.orderId)
        .eq("receipt_email_claim_id", activeClaimId)
        .is("receipt_email_sent_at", null)
        .select("id");

      expect(markErr).toBeNull();
      expect(markData?.length).toBe(1);

      // Subsequent claim attempt MUST fail (0 rows updated)
      const staleThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const newClaimId = crypto.randomUUID();

      const { data: postClaimData } = await supabaseAdmin
        .from("payment_orders")
        .update({
          receipt_email_claim_id: newClaimId,
          receipt_email_claimed_at: new Date().toISOString(),
        })
        .eq("id", testIds.orderId)
        .is("receipt_email_sent_at", null)
        .or(`receipt_email_claim_id.is.null,receipt_email_claimed_at.is.null,receipt_email_claimed_at.lt.${staleThreshold}`)
        .select("id");

      expect(postClaimData?.length || 0).toBe(0);
    });
  }
);
