import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";

const migrationFilePath = path.resolve(
  __dirname,
  "../../supabase/migrations/20261015000000_fix_register_accommodation_ambiguity.sql"
);

describe("P0: Fix Ambiguous participant_id in Accommodation Registration", () => {
  const sqlContent = fs.readFileSync(migrationFilePath, "utf8");

  describe("1. SQL Migration Structural & Safety Invariants", () => {
    it("A. Migration file exists and is non-empty", () => {
      expect(fs.existsSync(migrationFilePath)).toBe(true);
      expect(sqlContent.length).toBeGreaterThan(1000);
    });

    it("B. Does not drop historical overloads to preserve backward compatibility", () => {
      expect(sqlContent).not.toContain('DROP FUNCTION');
    });

    it("C. Preserves exact 11-parameter RPC signature matching application route", () => {
      expect(sqlContent).toContain('CREATE OR REPLACE FUNCTION "public"."register_participant_events"(');
      expect(sqlContent).toContain('"p_participant_id" "text" DEFAULT NULL::"text"');
      expect(sqlContent).toContain('"p_name" "text" DEFAULT NULL::"text"');
      expect(sqlContent).toContain('"p_college" "text" DEFAULT NULL::"text"');
      expect(sqlContent).toContain('"p_email" "text" DEFAULT NULL::"text"');
      expect(sqlContent).toContain('"p_phone" "text" DEFAULT NULL::"text"');
      expect(sqlContent).toContain('"p_events" "jsonb" DEFAULT \'[]\'::"jsonb"');
      expect(sqlContent).toContain('"p_accommodations" "jsonb" DEFAULT \'[]\'::"jsonb"');
      expect(sqlContent).toContain('"p_faculty" "jsonb" DEFAULT NULL::"jsonb"');
      expect(sqlContent).toContain('"p_gender" "text" DEFAULT NULL::"text"');
      expect(sqlContent).toContain('"p_state" "text" DEFAULT NULL::"text"');
      expect(sqlContent).toContain('"p_id_card_storage_path" "text" DEFAULT NULL::"text"');
      expect(sqlContent).toContain('RETURNS TABLE(');
      expect(sqlContent).toContain('"participant_id" "text"');
      expect(sqlContent).toContain('"participant_event_id" "uuid"');
      expect(sqlContent).toContain('"event_id" "uuid"');
      expect(sqlContent).toContain('"event_name" "text"');
      expect(sqlContent).toContain('"status" "text"');
      expect(sqlContent).toContain('"payment_order_id" "uuid"');
    });

    it("D. Preserves SECURITY DEFINER and SET search_path TO 'public'", () => {
      expect(sqlContent).toContain('SECURITY DEFINER');
      expect(sqlContent).toContain("SET \"search_path\" TO 'public'");
    });

    it("E. Qualifies participant_accommodations columns with table alias 'pa' to resolve error 42702", () => {
      // Must NOT contain unqualified participant_accommodations update WHERE participant_id = ...
      expect(sqlContent).not.toMatch(
        /update\s+public\.participant_accommodations\s+set\s+status\s*=\s*'cancelled'[\s\S]+?where\s+participant_id\s*=/i
      );

      // Must contain alias 'pa' and fully qualified 'pa.participant_id' and 'pa.status'
      expect(sqlContent).toMatch(
        /update\s+public\.participant_accommodations\s+pa\s+set\s+status\s*=\s*'cancelled',\s*updated_at\s*=\s*now\(\)\s+where\s+pa\.participant_id\s*=\s*v_acc_participant_uuid/i
      );
      expect(sqlContent).toMatch(
        /and\s+pa\.status\s+in\s+\('pending',\s*'unpaid'\)/i
      );
      expect(sqlContent).toMatch(
        /and\s+pa\.updated_at\s*<\s*now\(\)\s*-\s*interval\s*'1 hour'/i
      );
    });

    it("F. Qualifies payment_order_id update on participant_accommodations with alias 'pa'", () => {
      expect(sqlContent).toMatch(
        /update\s+public\.participant_accommodations\s+pa\s+set\s+payment_order_id\s*=\s*v_payment_order_id,\s*updated_at\s*=\s*now\(\)\s+where\s+pa\.id\s*=\s*v_new_pa_ids\[v_idx\]/i
      );
    });

    it("G. Preserves dynamic accommodation date resolution from selected_date and festival_config", () => {
      expect(sqlContent).toContain("v_acc_start_date := v_acc_base_start_date;");
      expect(sqlContent).toContain("v_accommodation->>'selected_date'");
      expect(sqlContent).toContain("v_acc_end_date := (v_acc_start_date + v_acc_plan.duration);");
    });

    it("H. Preserves secure grants (service_role only, revoked from PUBLIC/anon/authenticated)", () => {
      expect(sqlContent).toContain('REVOKE ALL ON FUNCTION "public"."register_participant_events"');
      expect(sqlContent).toContain('FROM PUBLIC');
      expect(sqlContent).toContain('FROM anon');
      expect(sqlContent).toContain('FROM authenticated');
      expect(sqlContent).toContain('GRANT ALL ON FUNCTION "public"."register_participant_events"');
      expect(sqlContent).toContain('TO "service_role"');
    });

    it("I. Preserves structured application error codes SVK01 through SVK11", () => {
      for (let i = 1; i <= 11; i++) {
        const code = `SVK${String(i).padStart(2, "0")}`;
        expect(sqlContent).toContain(code);
      }
    });
  });

  describe("2. Database Functional Regression (Live Local PostgreSQL)", () => {
    const SUPABASE_URL = process.env.LOCAL_SUPABASE_URL || process.env.INTEGRATION_TEST_SUPABASE_URL || "http://127.0.0.1:54321";
    const SERVICE_KEY =
      process.env.LOCAL_SUPABASE_SERVICE_KEY ||
      process.env.INTEGRATION_TEST_SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      "";

    let dbAvailable = false;
    let freeEventId: string;
    let paidEventId: string;
    let teamEventId: string;
    let testPlanSlug: string;
    let testPlanPrice = 499;

    async function callRpc(body: Record<string, unknown>) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/register_participant_events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      return { status: res.status, ok: res.ok, data };
    }

    async function queryTable(pathWithQuery: string) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathWithQuery}`, {
        method: "GET",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      });
      return await res.json();
    }

    async function insertTable(table: string, body: Record<string, unknown> | Array<Record<string, unknown>>) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          Prefer: "return=representation",
        },
        body: JSON.stringify(body),
      });
      return await res.json();
    }

    async function patchTable(pathWithQuery: string, body: Record<string, unknown>) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathWithQuery}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          Prefer: "return=representation",
        },
        body: JSON.stringify(body),
      });
      return await res.json();
    }

    beforeAll(async () => {
      try {
        if (!SERVICE_KEY) return;
        const check = await fetch(`${SUPABASE_URL}/rest/v1/events?limit=5`, {
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
        });
        if (check.ok) {
          const events = await check.json();
          if (events && events.length > 0) {
            freeEventId = events[0].id;

            // Check or insert a paid event for mixed registration test
            const paid = events.find((e: any) => e.payment_type === "paid");
            if (paid) {
              paidEventId = paid.id;
            } else {
              const inserted = await insertTable("events", [{
                name: "RoboWars Paid Battle",
                slug: `robowars-paid-${Date.now()}`,
                category: "Robotics",
                registration_type: "individual",
                payment_type: "paid",
                registration_fee: 300,
                payment_unit: "per_student",
                active: true,
                registration_open: true,
              }]);
              if (inserted && inserted.length > 0) {
                paidEventId = inserted[0].id;
              }
            }

            // Check or insert a team event
            const teamEv = events.find((e: any) => e.registration_type === "team");
            if (teamEv) {
              teamEventId = teamEv.id;
            } else {
              const insertedTeam = await insertTable("events", [{
                name: "Hackathon Team Challenge",
                slug: `hackathon-team-${Date.now()}`,
                category: "Technical",
                registration_type: "team",
                min_team_size: 2,
                max_team_size: 4,
                payment_type: "free",
                registration_fee: 0,
                payment_unit: "per_student",
                active: true,
                registration_open: true,
              }]);
              if (insertedTeam && insertedTeam.length > 0) {
                teamEventId = insertedTeam[0].id;
              }
            }

            const plans = await queryTable("accommodation_plans?limit=1");
            if (plans && plans.length > 0) {
              testPlanSlug = plans[0].slug;
              testPlanPrice = plans[0].price;
              dbAvailable = true;
            }
          }
        }
      } catch {
        dbAvailable = false;
      }
    });

    it("A. Proves registration WITHOUT accommodation succeeds and generates permanent ID", async () => {
      if (!dbAvailable) return;

      const email = `test_no_acc_reg_${Date.now()}@example.com`;
      const result = await callRpc({
        p_name: "No Accommodation Participant",
        p_college: "Engineering College",
        p_email: email,
        p_phone: "9876543201",
        p_events: [{ event_id: freeEventId }],
        p_accommodations: [],
      });

      expect(result.status).toBe(200);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data[0].participant_id).toMatch(/^SVK26-[A-Z0-9]{8}$/);
      expect(result.data[0].status).toBe("added");
      expect(result.data[0].payment_order_id).toBeNull();
    });

    it("B. Proves registration WITH accommodation succeeds without 42702 ambiguity error", async () => {
      if (!dbAvailable) return;

      const email = `test_with_acc_reg_${Date.now()}@example.com`;
      const result = await callRpc({
        p_name: "With Accommodation Participant",
        p_college: "Technology Institute",
        p_email: email,
        p_phone: "9876543202",
        p_events: [{ event_id: freeEventId }],
        p_accommodations: [
          {
            email,
            plan_slug: testPlanSlug,
            selected_date: "2026-10-28",
          },
        ],
      });

      expect(result.status).toBe(200);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
      const row = result.data[0];
      expect(row.participant_id).toMatch(/^SVK26-[A-Z0-9]{8}$/);
      expect(row.status).toBe("added");
      // Paid accommodation must create a payment order
      expect(row.payment_order_id).not.toBeNull();
      expect(typeof row.payment_order_id).toBe("string");
    });

    it("C. Proves mixed event and accommodation registration creates single atomic payment order", async () => {
      if (!dbAvailable || !paidEventId) return;

      const email = `test_mixed_reg_${Date.now()}@example.com`;
      const result = await callRpc({
        p_name: "Mixed Registration Participant",
        p_college: "National Institute of Technology",
        p_email: email,
        p_phone: "9876543208",
        p_events: [{ event_id: paidEventId }],
        p_accommodations: [
          {
            email,
            plan_slug: testPlanSlug,
            selected_date: "2026-10-28",
          },
        ],
      });

      expect(result.status).toBe(200);
      expect(Array.isArray(result.data)).toBe(true);
      const paymentOrderId = result.data[0].payment_order_id;
      expect(paymentOrderId).toBeTruthy();

      // Inspect payment_orders in database: total amount must equal event fee (300) + accommodation (499) = 799
      const orders = await queryTable(`payment_orders?id=eq.${paymentOrderId}`);
      expect(orders.length).toBe(1);
      expect(orders[0].amount).toBe(300 + testPlanPrice);
      expect(orders[0].status).toBe("pending");

      // Verify line items include both 'event' and 'accommodation'
      const items = await queryTable(`payment_order_items?payment_order_id=eq.${paymentOrderId}`);
      expect(items.length).toBe(2);
      const eventItem = items.find((i: any) => i.item_type === "event");
      const accItem = items.find((i: any) => i.item_type === "accommodation");
      expect(eventItem).toBeTruthy();
      expect(eventItem.amount).toBe(300);
      expect(accItem).toBeTruthy();
      expect(accItem.amount).toBe(testPlanPrice);
    });

    it("D. Proves existing participants retain their permanent IDs across registrations", async () => {
      if (!dbAvailable) return;

      const email = `test_retain_id_${Date.now()}@example.com`;
      // Step 1: Initial registration
      const firstReg = await callRpc({
        p_name: "ID Retention Participant",
        p_college: "State College",
        p_email: email,
        p_phone: "9876543203",
        p_events: [{ event_id: freeEventId }],
        p_accommodations: [],
      });

      expect(firstReg.status).toBe(200);
      const permanentId = firstReg.data[0].participant_id;

      // Step 2: Register again for the same event with accommodation
      const secondReg = await callRpc({
        p_participant_id: permanentId,
        p_name: "ID Retention Participant",
        p_college: "State College",
        p_email: email,
        p_phone: "9876543203",
        p_events: [{ event_id: freeEventId }],
        p_accommodations: [
          {
            email,
            plan_slug: testPlanSlug,
          },
        ],
      });

      expect(secondReg.status).toBe(200);
      // Permanent ID must be strictly preserved
      expect(secondReg.data[0].participant_id).toBe(permanentId);
      expect(secondReg.data[0].status).toBe("already_registered");
      expect(secondReg.data[0].payment_order_id).not.toBeNull();
    });

    it("E. Proves paid registrations create pending payment orders without initiating real payments", async () => {
      if (!dbAvailable) return;

      const email = `test_payment_order_${Date.now()}@example.com`;
      const reg = await callRpc({
        p_name: "Pending Order Participant",
        p_college: "Science University",
        p_email: email,
        p_phone: "9876543204",
        p_events: [{ event_id: freeEventId }],
        p_accommodations: [
          {
            email,
            plan_slug: testPlanSlug,
          },
        ],
      });

      expect(reg.status).toBe(200);
      const paymentOrderId = reg.data[0].payment_order_id;
      expect(paymentOrderId).toBeTruthy();

      // Inspect payment_orders in database
      const orders = await queryTable(`payment_orders?id=eq.${paymentOrderId}`);
      expect(orders.length).toBe(1);
      expect(orders[0].status).toBe("pending");
      expect(orders[0].amount).toBeGreaterThan(0);
      expect(orders[0].currency).toBe("INR");

      // Verify payment order item exists for accommodation
      const items = await queryTable(`payment_order_items?payment_order_id=eq.${paymentOrderId}`);
      expect(items.length).toBeGreaterThan(0);
      const accItem = items.find((i: any) => i.item_type === "accommodation");
      expect(accItem).toBeTruthy();
      expect(accItem.participant_accommodation_id).toBeTruthy();
    });

    it("F. Proves active checkout guard protects existing pending records within 1 hour", async () => {
      if (!dbAvailable) return;

      const email = `test_active_checkout_${Date.now()}@example.com`;
      // First booking
      const firstReg = await callRpc({
        p_name: "Active Checkout Participant",
        p_college: "Medical College",
        p_email: email,
        p_phone: "9876543205",
        p_events: [{ event_id: freeEventId }],
        p_accommodations: [
          {
            email,
            plan_slug: testPlanSlug,
          },
        ],
      });
      expect(firstReg.status).toBe(200);

      // Immediate second booking attempt within 1 hour must be rejected
      const secondReg = await callRpc({
        p_name: "Active Checkout Participant",
        p_college: "Medical College",
        p_email: email,
        p_phone: "9876543205",
        p_events: [{ event_id: freeEventId }],
        p_accommodations: [
          {
            email,
            plan_slug: testPlanSlug,
          },
        ],
      });

      expect(secondReg.status).toBe(400);
      expect(secondReg.data.message).toContain("Active checkout in progress");
    });

    it("G. Proves accommodation retry after 1 hour safely cancels stale record and proceeds", async () => {
      if (!dbAvailable) return;

      const email = `test_stale_retry_${Date.now()}@example.com`;
      // 1. Initial registration with accommodation
      const initialReg = await callRpc({
        p_name: "Stale Retry Participant",
        p_college: "Law College",
        p_email: email,
        p_phone: "9876543206",
        p_events: [{ event_id: freeEventId }],
        p_accommodations: [
          {
            email,
            plan_slug: testPlanSlug,
          },
        ],
      });
      expect(initialReg.status).toBe(200);
      const staleOrderId = initialReg.data[0].payment_order_id;
      expect(staleOrderId).toBeTruthy();

      // 2. Fetch the created participant accommodation ID
      const items = await queryTable(`payment_order_items?payment_order_id=eq.${staleOrderId}`);
      const staleAccId = items[0].participant_accommodation_id;

      // 3. Artificially backdate updated_at by 2 hours on both accommodation and payment order
      const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
      await patchTable(`participant_accommodations?id=eq.${staleAccId}`, {
        updated_at: twoHoursAgo,
      });
      await patchTable(`payment_orders?id=eq.${staleOrderId}`, {
        updated_at: twoHoursAgo,
      });

      // 4. Retry registration for the same participant with accommodation
      const retryReg = await callRpc({
        p_name: "Stale Retry Participant",
        p_college: "Law College",
        p_email: email,
        p_phone: "9876543206",
        p_events: [{ event_id: freeEventId }],
        p_accommodations: [
          {
            email,
            plan_slug: testPlanSlug,
          },
        ],
      });

      expect(retryReg.status).toBe(200);
      const newOrderId = retryReg.data[0].payment_order_id;
      expect(newOrderId).toBeTruthy();
      expect(newOrderId).not.toBe(staleOrderId);

      // 5. Verify the stale accommodation record was cleanly cancelled by the qualified pa update
      const staleAccRecord = await queryTable(`participant_accommodations?id=eq.${staleAccId}`);
      expect(staleAccRecord[0].status).toBe("cancelled");

      // 6. Verify stale payment order was also cancelled
      const staleOrderRecord = await queryTable(`payment_orders?id=eq.${staleOrderId}`);
      expect(staleOrderRecord[0].status).toBe("cancelled");
    });

    it("H. Proves team registration with members creates leader and member participant records", async () => {
      if (!dbAvailable || !teamEventId) return;

      const leaderEmail = `test_leader_${Date.now()}@example.com`;
      const memberEmail = `test_member_${Date.now()}@example.com`;

      const result = await callRpc({
        p_name: "Team Alpha Leader",
        p_college: "Tech University",
        p_email: leaderEmail,
        p_phone: "9876543217",
        p_events: [
          {
            event_id: teamEventId,
            team: "Alpha Squad",
            is_team_head: true,
            members: [
              {
                name: "Team Member One",
                email: memberEmail,
                phone: "9876543218",
                college: "Tech University",
              },
            ],
          },
        ],
        p_accommodations: [],
      });

      expect(result.status).toBe(200);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data[0].status).toBe("added");
      expect(result.data[0].participant_id).toMatch(/^SVK26-[A-Z0-9]{8}$/);

      // Verify leader and member exist in participants table
      const leader = await queryTable(`participants?email=eq.${leaderEmail}`);
      expect(leader.length).toBe(1);
      const member = await queryTable(`participants?email=eq.${memberEmail}`);
      expect(member.length).toBe(1);
      expect(member[0].participant_id).toMatch(/^SVK26-[A-Z0-9]{8}$/);
    });

    it("I. Proves registration with multiple selected events creates records for all events", async () => {
      if (!dbAvailable || !paidEventId) return;

      const email = `test_multi_event_${Date.now()}@example.com`;
      const result = await callRpc({
        p_name: "Multi Event Participant",
        p_college: "Multi College",
        p_email: email,
        p_phone: "9876543219",
        p_events: [
          { event_id: freeEventId },
          { event_id: paidEventId },
        ],
        p_accommodations: [],
      });

      expect(result.status).toBe(200);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBe(2);
      expect(result.data[0].status).toBe("added");
      expect(result.data[1].status).toBe("added");
      // Paid event triggers payment order
      expect(result.data[1].payment_order_id).toBeTruthy();
    });
  });
});
