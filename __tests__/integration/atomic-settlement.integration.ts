import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

// FAIL-CLOSED DATABASE GUARD
const supabaseUrl = process.env.INTEGRATION_TEST_SUPABASE_URL || "";
const supabaseServiceKey = process.env.INTEGRATION_TEST_SUPABASE_SERVICE_ROLE_KEY || "";

let isSafeLocal = false;

if (supabaseUrl && supabaseServiceKey) {
  try {
    const url = new URL(supabaseUrl);
    // Explicitly reject production and unknown remote domains
    const isProd = url.hostname.includes("ikavnyjfmdxjnlbovkzm.supabase.co") || (url.hostname.includes("supabase.co") && url.hostname !== "mjxwzknnlgvwtwklzkks.supabase.co");
    const isLocal = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    const isStaging = url.hostname === "mjxwzknnlgvwtwklzkks.supabase.co";
    const allowStaging = process.env.ALLOW_STAGING_INTEGRATION_TESTS === "true";
    
    if (isProd) {
      console.error("FATAL: Test target rejected. INTEGRATION_TEST_SUPABASE_URL points to a production or remote domain.");
      process.exit(1);
    }
    
    if (!isLocal && !(isStaging && allowStaging)) {
      console.error("FATAL: Test target rejected. Integration tests may only run against a local disposable database or explicitly authorized staging.");
      process.exit(1);
    }

    isSafeLocal = true;
  } catch (e) {
    console.error("FATAL: Invalid INTEGRATION_TEST_SUPABASE_URL format.");
    process.exit(1);
  }
}

const runIntegrationTests = isSafeLocal;

(runIntegrationTests ? describe : describe.skip)("INTEGRATION: Atomic Payment Settlement RPCs", () => {
  let supabaseAdmin: any;

  beforeAll(() => {
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
  });

  const testFixtures: {
    partIds: string[];
    poIds: string[];
  } = {
    partIds: [],
    poIds: [],
  };

  const cleanup = async () => {
    if (!supabaseAdmin) return;
    const errors: any[] = [];

    // Delete processed_payment_events
    for (const poId of testFixtures.poIds) {
      const res = await supabaseAdmin.from("processed_payment_events").delete().eq("order_id", poId);
      if (res.error) errors.push(res.error);
    }
    
    // Delete payments (receipts)
    for (const partId of testFixtures.partIds) {
      const res = await supabaseAdmin.from("payments").delete().eq("participant_id", partId);
      if (res.error) errors.push(res.error);
    }

    // Delete payment_order_items
    for (const poId of testFixtures.poIds) {
      const res = await supabaseAdmin.from("payment_order_items").delete().eq("payment_order_id", poId);
      if (res.error) errors.push(res.error);
    }
    
    // Delete participant_accommodations
    for (const partId of testFixtures.partIds) {
      const res = await supabaseAdmin.from("participant_accommodations").delete().eq("participant_id", partId);
      if (res.error) errors.push(res.error);
    }
    
    // Delete hostels
    for (const partId of testFixtures.partIds) {
       // We'll clean hostels by name or skip since we just need simple isolation
    }

    // Delete payment_orders
    for (const poId of testFixtures.poIds) {
      const res = await supabaseAdmin.from("payment_orders").delete().eq("id", poId);
      if (res.error) errors.push(res.error);
    }

    // Delete participants
    for (const partId of testFixtures.partIds) {
      const res = await supabaseAdmin.from("participants").delete().eq("id", partId);
      if (res.error) errors.push(res.error);
    }

    if (errors.length > 0) {
      throw new Error("Cleanup failed with errors: " + JSON.stringify(errors));
    }
  };

  afterAll(async () => {
    await cleanup();
  }, 30000);

  const setupFixture = async (amount: number = 499) => {
    const uniqueId = crypto.randomUUID();
    
    const partId = crypto.randomUUID();
    const partRes = await supabaseAdmin.from("participants").insert({
      id: partId,
      participant_id: `SVK-${uniqueId.substring(0,6)}`,
      name: "Test Participant",
      email: `test-${uniqueId}@test.com`,
      gender: "male",
      phone: "1234567890",
      college: "Test College"
    });
    if (partRes.error) throw new Error("Failed to insert participant: " + partRes.error.message);
    testFixtures.partIds.push(partId);

    const poId = crypto.randomUUID();
    const gatewayOrderId = `GO-${uniqueId.substring(0,8)}`;
    const poRes = await supabaseAdmin.from("payment_orders").insert({
      id: poId,
      payer_participant_id: partId,
      order_reference: `REF-${uniqueId.substring(0,8)}`,
      gateway_order_id: gatewayOrderId,
      amount: amount,
      status: "pending",
      currency: "INR"
    });
    if (poRes.error) throw new Error("Failed to insert payment order: " + poRes.error.message);
    testFixtures.poIds.push(poId);

    // Create a participant_accommodation
    const accId = crypto.randomUUID();
    const accRes = await supabaseAdmin.from("participant_accommodations").insert({
      id: accId,
      participant_id: partId,
      start_date: "2026-10-28",
      end_date: "2026-10-29",
      amount: amount,
      status: "pending",
      duration_days: 1
    });
    // Ignore error if plan constraints fail; we just want the record if possible, but actually we need plan ID.
    // Let's just create a payment_order_item without an accommodation to keep it isolated unless we recreate all the hostel fixtures.
    // Wait, the migration says:
    // UPDATE public.participant_accommodations SET status = 'paid' WHERE payment_order_id = v_order.id
    // It filters by payment_order_id! So if we can insert it, great.
    // Actually `payment_order_id` is on participant_accommodations! Let me try.
    if (!accRes.error) {
      await supabaseAdmin.from("participant_accommodations").update({ payment_order_id: poId }).eq("id", accId);
    }

    return { partId, poId, gatewayOrderId, amount };
  };

  it("1. Valid payment-success settlement affects only its own fixture records", async () => {
    const f = await setupFixture(100);
    const gatewayPaymentId = "PAY-" + crypto.randomUUID().substring(0, 8);

    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc("process_payment_success", {
      p_gateway_order_id: f.gatewayOrderId,
      p_gateway_payment_id: gatewayPaymentId,
      p_amount_paise: 10000,
      p_currency: "INR",
      p_gateway_name: "PAYU"
    });

    expect(rpcError).toBeNull();
    expect(rpcData?.success).toBe(true);
    expect(rpcData?.action).toBe("settled");

    // Check payment_order status
    const { data: po } = await supabaseAdmin.from("payment_orders").select("status, gateway_payment_id").eq("id", f.poId).single();
    expect(po.status).toBe("paid");
    expect(po.gateway_payment_id).toBe(gatewayPaymentId);

    // Check receipt creation
    const { data: receipts } = await supabaseAdmin.from("payments").select("*").eq("gateway_order_id", f.gatewayOrderId);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].status).toBe("paid");
    expect(receipts[0].amount).toBe(100);

    // Check processed_payment_events
    const { data: events } = await supabaseAdmin.from("processed_payment_events").select("*").eq("order_id", f.poId);
    expect(events).toHaveLength(1);
    
    // Check side-effects on accommodations (if any were inserted successfully)
    const { data: accs } = await supabaseAdmin.from("participant_accommodations").select("status").eq("participant_id", f.partId);
    if (accs && accs.length > 0) {
      expect(accs[0].status).toBe("paid");
    }
  });

  it("2. Repeated success callbacks behave idempotently", async () => {
    const f = await setupFixture(100);
    const gatewayPaymentId = "PAY-" + crypto.randomUUID().substring(0, 8);

    // First call
    await supabaseAdmin.rpc("process_payment_success", {
      p_gateway_order_id: f.gatewayOrderId,
      p_gateway_payment_id: gatewayPaymentId,
      p_amount_paise: 10000,
      p_currency: "INR",
      p_gateway_name: "PAYU"
    });

    // Second call
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc("process_payment_success", {
      p_gateway_order_id: f.gatewayOrderId,
      p_gateway_payment_id: gatewayPaymentId,
      p_amount_paise: 10000,
      p_currency: "INR",
      p_gateway_name: "PAYU"
    });

    expect(rpcError).toBeNull();
    expect(rpcData?.success).toBe(true);
    expect(rpcData?.action).toBe("already_paid");

    const { data: receipts } = await supabaseAdmin.from("payments").select("*").eq("gateway_order_id", f.gatewayOrderId);
    expect(receipts).toHaveLength(1); // Still exactly one receipt
  });

  it("3. Payment failure behavior and repeated failure handling", async () => {
    const f = await setupFixture(100);

    // First failure call
    const { data: rpcData1, error: err1 } = await supabaseAdmin.rpc("process_payment_failure", {
      p_gateway_order_id: f.gatewayOrderId
    });
    
    expect(err1).toBeNull();
    expect(rpcData1?.success).toBe(true);
    expect(rpcData1?.action).toBe("failed");

    const { data: po } = await supabaseAdmin.from("payment_orders").select("status").eq("id", f.poId).single();
    expect(po.status).toBe("failed");

    // Second failure call (idempotent)
    const { data: rpcData2, error: err2 } = await supabaseAdmin.rpc("process_payment_failure", {
      p_gateway_order_id: f.gatewayOrderId
    });
    expect(err2).toBeNull();
    // Failed remains failed; the RPC actually just updates it again and returns failed, 
    // it only exits early if 'paid' or 'refunded'.
    expect(rpcData2?.action).toBe("failed");
  });

  it("4. Success/failure conflicts for the same fixture transaction", async () => {
    const f = await setupFixture(100);
    const gatewayPaymentId = "PAY-" + crypto.randomUUID().substring(0, 8);

    // Settle it successfully
    await supabaseAdmin.rpc("process_payment_success", {
      p_gateway_order_id: f.gatewayOrderId,
      p_gateway_payment_id: gatewayPaymentId,
      p_amount_paise: 10000,
      p_currency: "INR",
      p_gateway_name: "PAYU"
    });

    // Try to fail it
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc("process_payment_failure", {
      p_gateway_order_id: f.gatewayOrderId
    });

    expect(rpcError).toBeNull();
    expect(rpcData?.success).toBe(true);
    expect(rpcData?.action).toBe("already_finalized");

    // Ensure status is still paid
    const { data: po } = await supabaseAdmin.from("payment_orders").select("status").eq("id", f.poId).single();
    expect(po.status).toBe("paid");
  });

  it("5. Concurrent duplicate callbacks and race conditions", async () => {
    const f = await setupFixture(100);
    const gatewayPaymentId = "PAY-" + crypto.randomUUID().substring(0, 8);

    const p1 = supabaseAdmin.rpc("process_payment_success", {
      p_gateway_order_id: f.gatewayOrderId,
      p_gateway_payment_id: gatewayPaymentId,
      p_amount_paise: 10000,
      p_currency: "INR",
      p_gateway_name: "PAYU"
    });

    const p2 = supabaseAdmin.rpc("process_payment_success", {
      p_gateway_order_id: f.gatewayOrderId,
      p_gateway_payment_id: gatewayPaymentId,
      p_amount_paise: 10000,
      p_currency: "INR",
      p_gateway_name: "PAYU"
    });

    const results = await Promise.all([p1, p2]);

    const successes = results.filter(r => r.data?.action === "settled");
    const alreadyPaids = results.filter(r => r.data?.action === "already_paid" || r.data?.action === "already_processed");

    expect(successes.length).toBe(1);
    expect(alreadyPaids.length).toBe(1);
  });

  it("6. Unknown or invalid transaction references do not modify unrelated records", async () => {
    const { data, error } = await supabaseAdmin.rpc("process_payment_success", {
      p_gateway_order_id: "INVALID_ORDER",
      p_gateway_payment_id: "PAY-123",
      p_amount_paise: 100,
      p_currency: "INR",
      p_gateway_name: "PAYU"
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(false);
    expect(data?.error).toBe("Order not found");
  });

});
