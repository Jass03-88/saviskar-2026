import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Phase 1A: Accommodation Payment Architecture Foundation Invariants", () => {
  const migrationPath = path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20261002030000_polymorphic_payment_orders.sql"
  );
  const registerRoutePath = path.join(
    process.cwd(),
    "app",
    "api",
    "register",
    "route.ts"
  );
  const payuSuccessRoutePath = path.join(
    process.cwd(),
    "app",
    "api",
    "payments",
    "payu",
    "success",
    "route.ts"
  );
  const webhookRoutePath = path.join(
    process.cwd(),
    "app",
    "api",
    "payments",
    "webhook",
    "route.ts"
  );
  const postPaymentPath = path.join(
    process.cwd(),
    "lib",
    "payments",
    "post-payment.ts"
  );
  const receiptPdfPath = path.join(
    process.cwd(),
    "lib",
    "generate-receipt-pdf.ts"
  );
  const sendEmailPath = path.join(
    process.cwd(),
    "lib",
    "send-registration-email.ts"
  );
  const resumeRoutePath = path.join(
    process.cwd(),
    "app",
    "api",
    "payments",
    "resume",
    "route.ts"
  );

  const migrationSql = fs.readFileSync(migrationPath, "utf-8");
  const registerRouteContent = fs.readFileSync(registerRoutePath, "utf-8");
  const payuSuccessContent = fs.readFileSync(payuSuccessRoutePath, "utf-8");
  const webhookContent = fs.readFileSync(webhookRoutePath, "utf-8");
  const postPaymentContent = fs.readFileSync(postPaymentPath, "utf-8");
  const receiptPdfContent = fs.readFileSync(receiptPdfPath, "utf-8");
  const sendEmailContent = fs.readFileSync(sendEmailPath, "utf-8");
  const resumeRouteContent = fs.readFileSync(resumeRoutePath, "utf-8");

  describe("1. Database Schema & Polymorphic Line Items", () => {
    it("A. Drops NOT NULL from payment_order_items.event_id safely", () => {
      expect(migrationSql).toMatch(
        /ALTER\s+TABLE\s+public\.payment_order_items\s+ALTER\s+COLUMN\s+event_id\s+DROP\s+NOT\s+NULL;/i
      );
    });

    it("B. Adds item_type with DEFAULT 'event' for 100% backward compatibility", () => {
      expect(migrationSql).toMatch(
        /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+item_type\s+text\s+NOT\s+NULL\s+DEFAULT\s+'event';/i
      );
    });

    it("C. Adds participant_accommodation_id with ON DELETE RESTRICT to protect financial records", () => {
      expect(migrationSql).toMatch(
        /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+participant_accommodation_id\s+uuid;/i
      );
      expect(migrationSql).toContain("payment_order_items_participant_accommodation_id_fkey");
      expect(migrationSql).toMatch(
        /FOREIGN\s+KEY\s*\(participant_accommodation_id\)\s+REFERENCES\s+public\.participant_accommodations\(id\)\s+ON\s+DELETE\s+RESTRICT/i
      );
      // Ensures financial payment records CANNOT be deleted by cascading accommodation deletion
      expect(migrationSql).not.toMatch(
        /FOREIGN\s+KEY\s*\(participant_accommodation_id\)\s+REFERENCES\s+public\.participant_accommodations\(id\)\s+ON\s+DELETE\s+CASCADE/i
      );
    });

    it("D. Enforces strict CHECK constraint on item_type ('event', 'accommodation')", () => {
      expect(migrationSql).toContain("payment_order_items_item_type_check");
      expect(migrationSql).toMatch(
        /CHECK\s*\(\s*item_type\s+IN\s+\('event',\s*'accommodation'\)\s*\)/i
      );
    });

    it("E. Enforces strict polymorphic payload check constraint", () => {
      expect(migrationSql).toContain("payment_order_items_payload_check");
      expect(migrationSql).toMatch(
        /\(item_type\s*=\s*'event'\s+AND\s+event_id\s+IS\s+NOT\s+NULL\s+AND\s+participant_accommodation_id\s+IS\s+NULL\)/i
      );
      expect(migrationSql).toMatch(
        /\(item_type\s*=\s*'accommodation'\s+AND\s+event_id\s+IS\s+NULL\s+AND\s+participant_accommodation_id\s+IS\s+NOT\s+NULL\)/i
      );
    });

    it("F. Creates indexes for polymorphic queries", () => {
      expect(migrationSql).toMatch(
        /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+payment_order_items_pa_id_idx\s+ON\s+public\.payment_order_items\(participant_accommodation_id\);/i
      );
      expect(migrationSql).toMatch(
        /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+payment_order_items_item_type_idx\s+ON\s+public\.payment_order_items\(item_type\);/i
      );
    });

    it("G. Creates configurable festival_config table for event & accommodation dates with strict admin-only RLS", () => {
      expect(migrationSql).toMatch(
        /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.festival_config/i
      );
      expect(migrationSql).toContain("accommodation_start_date date NOT NULL");
      expect(migrationSql).toContain("accommodation_end_date date NOT NULL");
      expect(migrationSql).toContain("event_start_date date NOT NULL");
      expect(migrationSql).toContain("event_end_date date NOT NULL");

      // Verify public read policy is NOT granted
      expect(migrationSql).not.toMatch(
        /CREATE\s+POLICY\s+"Public can read festival config"\s+ON\s+public\.festival_config\s+FOR\s+SELECT\s+TO\s+PUBLIC/i
      );

      // Verify read and update are strictly restricted to authenticated admins
      expect(migrationSql).toMatch(
        /CREATE\s+POLICY\s+"Admins can read festival config"\s+ON\s+public\.festival_config\s+FOR\s+SELECT\s+TO\s+authenticated\s+USING\s+\(public\.is_admin\(\)\)/i
      );
      expect(migrationSql).toMatch(
        /CREATE\s+POLICY\s+"Admins can update festival config"\s+ON\s+public\.festival_config\s+FOR\s+UPDATE\s+TO\s+authenticated\s+USING\s+\(public\.is_admin\(\)\)/i
      );

      // Verify public/anon permissions are explicitly revoked
      expect(migrationSql).toContain("REVOKE ALL ON TABLE public.festival_config FROM PUBLIC, anon;");
      expect(migrationSql).toContain("GRANT ALL ON TABLE public.festival_config TO service_role;");
    });
  });

  describe("2. Atomic Payment Retry RPC Invariants", () => {
    it("A. Locks and validates participant_accommodations during retry", () => {
      expect(migrationSql).toContain("FROM public.participant_accommodations pa");
      expect(migrationSql).toContain("FOR UPDATE");
      expect(migrationSql).toContain("ACCOMMODATION_ALREADY_PAID");
    });

    it("B. Detects concurrent active pending retry attempts for accommodations", () => {
      expect(migrationSql).toMatch(
        /WHERE\s+poi\.participant_accommodation_id\s*=\s*ANY\(v_pa_ids\)/i
      );
      expect(migrationSql).toContain("ACTIVE_ATTEMPT_EXISTS");
    });

    it("C. Copies both event and accommodation line items preserving item_type and links", () => {
      expect(migrationSql).toContain("INSERT INTO public.payment_order_items");
      expect(migrationSql).toMatch(/COALESCE\(poi\.item_type,\s*'event'\)/i);
      expect(migrationSql).toContain("poi.participant_accommodation_id");
    });

    it("D. Repoints participant_accommodations.payment_order_id to new order without creating duplicate bookings", () => {
      expect(migrationSql).toMatch(
        /UPDATE\s+public\.participant_accommodations\s+SET\s+payment_order_id\s*=\s*v_new_order_id/i
      );
      // Ensures retry does NOT insert into participant_accommodations
      const retryBody = migrationSql.substring(
        migrationSql.indexOf("CREATE OR REPLACE FUNCTION public.create_payment_retry_attempt"),
        migrationSql.indexOf("CREATE OR REPLACE FUNCTION \"public\".\"register_participant_events\"")
      );
      expect(retryBody).not.toMatch(/INSERT\s+INTO\s+public\.participant_accommodations/i);
    });
  });

  describe("3. Atomic Registration RPC Invariants", () => {
    it("A. Accepts p_accommodations jsonb parameter with default '[]'", () => {
      expect(migrationSql).toMatch(
        /"p_accommodations"\s+"jsonb"\s+DEFAULT\s+'\[\]'::"jsonb"/i
      );
    });

    it("B. Fetches accommodation price strictly from database accommodation_plans (never trusts client)", () => {
      expect(migrationSql).toMatch(
        /select\s+ap\.id,\s*ap\.name,\s*ap\.duration,\s*ap\.price,\s*ap\.currency/i
      );
      expect(migrationSql).toMatch(
        /from\s+public\.accommodation_plans\s+ap\s+where\s+ap\.slug\s*=\s*v_acc_slug/i
      );
      expect(migrationSql).toContain("v_total_paid_amount := v_total_paid_amount + v_acc_plan.price;");
    });

    it("C. Enforces single active booking per participant", () => {
      expect(migrationSql).toMatch(
        /from\s+public\.participant_accommodations\s+pa\s+where\s+pa\.participant_id\s*=\s*v_acc_participant_uuid\s+and\s+pa\.status\s+not\s+in\s+\('cancelled',\s*'failed'\)/i
      );
    });

    it("D. Links payment_order_id when accommodation items are created", () => {
      expect(migrationSql).toMatch(
        /update\s+public\.participant_accommodations\s+set\s+payment_order_id\s*=\s*v_payment_order_id/i
      );
    });

    it("E. Creates payment_orders when total > 0 even if no event fees exist (Case 3)", () => {
      expect(migrationSql).toMatch(
        /if\s+v_total_paid_amount\s*>\s*0\s+and\s*\(cardinality\(v_new_pe_ids\)\s*>\s*0\s+or\s+cardinality\(v_new_pa_ids\)\s*>\s*0\)\s+then/i
      );
    });

    it("F. Sources accommodation dates from configurable festival_config (not hardcoded in RPC)", () => {
      expect(migrationSql).toMatch(
        /from\s+public\.festival_config\s+fc\s+where\s+fc\.id\s*=\s*'current'/i
      );
      expect(migrationSql).toContain("v_acc_start_date := v_acc_base_start_date;");
      expect(migrationSql).toContain("v_acc_end_date := (v_acc_base_start_date + v_acc_plan.duration);");

      // Verify no hardcoded date assignment literals exist in the RPC body
      const rpcBody = migrationSql.substring(
        migrationSql.indexOf("CREATE OR REPLACE FUNCTION \"public\".\"register_participant_events\"")
      );
      expect(rpcBody).not.toContain("v_acc_start_date := '2026-10-28'");
      expect(rpcBody).not.toContain("v_acc_end_date := '2026-10-29'");
      expect(rpcBody).not.toContain("v_acc_end_date := '2026-10-30'");
    });

    it("G. Snapshots start_date, end_date, and duration_days directly onto participant_accommodations", () => {
      expect(migrationSql).toContain("start_date,");
      expect(migrationSql).toContain("end_date,");
      expect(migrationSql).toContain("duration_days,");
      expect(migrationSql).toContain("v_acc_start_date,");
      expect(migrationSql).toContain("v_acc_end_date,");
      expect(migrationSql).toContain("v_acc_plan.duration,");
    });
  });

  describe("4. Registration API Route (/api/register)", () => {
    it("A. Accepts accommodations array in request body and normalizes plan_slug", () => {
      expect(registerRouteContent).toContain("accommodations?: unknown;");
      expect(registerRouteContent).toContain("AccommodationRegistrationInput");
      expect(registerRouteContent).toContain("rpcAccommodations.push");
    });

    it("B. Passes p_accommodations to register_participant_events RPC", () => {
      expect(registerRouteContent).toMatch(/p_accommodations:\s+rpcAccommodations/);
    });

    it("C. Retrieves payment order for Free Event + Paid Accommodation (Case 3)", () => {
      expect(registerRouteContent).toContain("const returnedPaymentOrderId = results[0]?.payment_order_id;");
      expect(registerRouteContent).toContain('.eq("id", returnedPaymentOrderId)');
      expect(registerRouteContent).toContain("totalAmount = Number(orderData.amount) || totalAmount");
    });

    it("D. Sets paymentRequired = true when totalAmount > 0", () => {
      expect(registerRouteContent).toMatch(/paymentRequired:\s+totalAmount > 0/);
    });
  });

  describe("5. PayU Verification & Webhook Handlers", () => {
    it("A. Strictly compares gateway amount against payment_orders.amount (in paise)", () => {
      expect(payuSuccessContent).toContain("const expectedAmountPaise = Number(paymentOrder.amount) * 100;");
      expect(payuSuccessContent).toContain("if (fetchedPayment.amount !== expectedAmountPaise)");
      expect(webhookContent).toContain("const expectedAmountPaise = Math.round(Number(paymentOrder.amount) * 100);");
      expect(webhookContent).toContain("if (capturedAmount !== expectedAmountPaise)");
    });

    it("B. Marks linked participant_accommodations as paid in PayU success handler", () => {
      expect(payuSuccessContent).toMatch(
        /supabaseAdmin\s*\.from\("participant_accommodations"\)\s*\.update\({\s*status:\s*"paid",/
      );
      expect(payuSuccessContent).toContain('.eq("payment_order_id", paymentOrderId)');
    });

    it("C. Marks linked participant_accommodations as paid in webhook handler", () => {
      expect(webhookContent).toMatch(
        /supabaseAdmin\s*\.from\("participant_accommodations"\)\s*\.update\({\s*status:\s*"paid",/
      );
      expect(webhookContent).toContain('.eq("payment_order_id", paymentOrder.id)');
    });
  });

  describe("6. Receipt PDF & Email Integration", () => {
    it("A. PDF receipt supports accommodation items in registration section", () => {
      expect(receiptPdfContent).toContain("single.category === 'Accommodation'");
      expect(receiptPdfContent).toContain("ACCOMMODATION BOOKING");
      expect(receiptPdfContent).toContain("REGISTRATION & ITEMS");
    });

    it("B. Post-payment resolves accommodation line items and plan names", () => {
      expect(postPaymentContent).toContain("participant_accommodations");
      expect(postPaymentContent).toContain("item.item_type === \"accommodation\"");
      expect(postPaymentContent).toContain("category: \"Accommodation\"");
    });

    it("C. Email template displays accommodation details block when present", () => {
      expect(sendEmailContent).toContain("AccommodationEmailDetails");
      expect(sendEmailContent).toContain("accommodationDetails?: AccommodationEmailDetails[] | null;");
      expect(sendEmailContent).toContain("Accommodation Details");
      expect(postPaymentContent).toContain("accommodationDetails,");
    });

    it("D. Resume route surfaces accommodation line items and plan metadata", () => {
      expect(resumeRouteContent).toContain("participant_accommodations");
      expect(resumeRouteContent).toContain('item.item_type === "accommodation"');
      expect(resumeRouteContent).toContain('itemType: "accommodation"');
      expect(resumeRouteContent).toContain('category: "Accommodation"');
    });
  });
});
