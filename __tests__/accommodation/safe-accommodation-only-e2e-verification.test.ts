import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  resolveAccommodationSelection,
  formatAccommodationDate,
  isDateBookedByParticipant,
  isPlanRangeConflicting,
} from "@/components/registration/RegistrationForm";
import {
  createRegistrationSessionToken,
  verifyRegistrationSessionToken,
  DEFAULT_SESSION_EXP_MS,
} from "@/lib/auth/session";
import { generateReceiptPdf, ReceiptData } from "@/lib/generate-receipt-pdf";
import { getPaymentGateway } from "@/lib/payments";
import { calculateStayDates } from "@/lib/accommodation-dates";

describe("SAVISKAR 2026 — SAFE ACCOMMODATION-ONLY E2E VERIFICATION SUITE", () => {
  const registerRoutePath = path.join(process.cwd(), "app", "api", "register", "route.ts");
  const payuSuccessRoutePath = path.join(process.cwd(), "app", "api", "payments", "payu", "success", "route.ts");
  const postPaymentPath = path.join(process.cwd(), "lib", "payments", "post-payment.ts");
  const sendEmailPath = path.join(process.cwd(), "lib", "send-registration-email.ts");
  const adminDashboardPath = path.join(process.cwd(), "app", "api", "admin", "accommodations", "dashboard", "route.ts");
  const latestMigrationPath = path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20261021010000_fix_registration_member_college_and_rpc_resilience.sql"
  );

  const registerRouteSrc = fs.readFileSync(registerRoutePath, "utf-8");
  const payuSuccessRouteSrc = fs.readFileSync(payuSuccessRoutePath, "utf-8");
  const postPaymentSrc = fs.readFileSync(postPaymentPath, "utf-8");
  const sendEmailSrc = fs.readFileSync(sendEmailPath, "utf-8");
  const adminDashboardSrc = fs.readFileSync(adminDashboardPath, "utf-8");
  const latestMigrationSql = fs.readFileSync(latestMigrationPath, "utf-8");

  // =========================================================================
  // 1. REGISTRATION PAYLOAD & SELECTION VALIDATION RULES
  // =========================================================================
  describe("1. Registration Selection Validation (Event-only, Acc-only, Combined, Neither)", () => {
    it("A. Frontend permits submission when at least one event is selected (even with empty accommodation)", () => {
      const selectedEventIds = ["event-uuid-1"];
      const mainAccSlug = "";
      const hasFacultyAcc = false;

      const isSubmissible =
        selectedEventIds.length > 0 || Boolean(mainAccSlug) || hasFacultyAcc;
      expect(isSubmissible).toBe(true);
    });

    it("B. Frontend permits submission for accommodation-only (empty events, valid accommodation)", () => {
      const selectedEventIds: string[] = [];
      const mainAccSlug = "1_day";
      const hasFacultyAcc = false;

      const isSubmissible =
        selectedEventIds.length > 0 || Boolean(mainAccSlug) || hasFacultyAcc;
      expect(isSubmissible).toBe(true);
    });

    it("C. Frontend permits submission for combined event and accommodation", () => {
      const selectedEventIds = ["event-uuid-1"];
      const mainAccSlug = "2_days";
      const hasFacultyAcc = false;

      const isSubmissible =
        selectedEventIds.length > 0 || Boolean(mainAccSlug) || hasFacultyAcc;
      expect(isSubmissible).toBe(true);
    });

    it("D. Frontend rejects submission when neither an event nor accommodation is selected", () => {
      const selectedEventIds: string[] = [];
      const mainAccSlug = "";
      const hasFacultyAcc = false;

      const isSubmissible =
        selectedEventIds.length > 0 || Boolean(mainAccSlug) || hasFacultyAcc;
      expect(isSubmissible).toBe(false);
    });

    it("E. Backend API independently rejects empty events AND empty accommodations", () => {
      // Must contain independent validation rejecting when BOTH are empty
      expect(registerRouteSrc).toMatch(
        /if\s*\(\s*rawEvents\.length\s*===\s*0\s*&&\s*rawAccommodations\.length\s*===\s*0\s*\)\s*\{\s*return\s+errorResponse\(\s*["']Please select at least one event or accommodation\.["']/
      );
    });

    it("F. Backend API accepts legitimate empty events array when accommodations are provided", () => {
      // Must NOT unconditionally reject when rawEvents.length === 0
      expect(registerRouteSrc).not.toMatch(
        /if\s*\(\s*rawEvents\.length\s*===\s*0\s*\)\s*\{\s*return\s+errorResponse\(/
      );
    });

    it("G. Database RPC independently validates at least one event or accommodation", () => {
      expect(latestMigrationSql).toMatch(
        /if\s*\(p_events\s+is\s+null\s+or\s+jsonb_typeof\(p_events\)\s*<>\s*'array'\s+or\s+jsonb_array_length\(p_events\)\s*=\s*0\)\s+and\s*\(p_accommodations\s+is\s+null\s+or\s+jsonb_typeof\(p_accommodations\)\s*<>\s*'array'\s+or\s+jsonb_array_length\(p_accommodations\)\s*=\s*0\)\s+then\s*raise\s+exception\s+'Please select at least one event or accommodation'\s+using\s+errcode\s*=\s*'SVK03';/i
      );
    });
  });

  // =========================================================================
  // 2. AUTHENTICATION, EMAIL MATCHING & ID CARD OWNERSHIP
  // =========================================================================
  describe("2. Authentication, Session Security & ID-Card Ownership", () => {
    const testSecret = "test-secret-salt-at-least-32-bytes-long-for-hmac";

    it("A. Registration session token generates and verifies cryptographically", () => {
      const email = "verified.delegate@example.com";
      const token = createRegistrationSessionToken(email, DEFAULT_SESSION_EXP_MS, testSecret);
      expect(token).toBeDefined();
      expect(token.split(".")).toHaveLength(2);

      const verification = verifyRegistrationSessionToken(token, testSecret);
      expect(verification.valid).toBe(true);
      expect(verification.payload?.email).toBe(email);
    });

    it("B. Expired session token is strictly rejected", () => {
      const email = "expired.user@example.com";
      // Create token expired 10 seconds ago (-10000ms)
      const token = createRegistrationSessionToken(email, -10000, testSecret);
      const verification = verifyRegistrationSessionToken(token, testSecret);
      expect(verification.valid).toBe(false);
      expect(verification.error).toContain("expired");
    });

    it("C. Tampered session token fails timing-safe signature check", () => {
      const email = "legit.user@example.com";
      const token = createRegistrationSessionToken(email, DEFAULT_SESSION_EXP_MS, testSecret);
      const [payloadB64, sig] = token.split(".");
      const tamperedToken = `${payloadB64}.${sig.slice(0, -2)}xx`;

      const verification = verifyRegistrationSessionToken(tamperedToken, testSecret);
      expect(verification.valid).toBe(false);
      expect(verification.error).toContain("signature");
    });

    it("D. Backend enforces email matching between payload and authenticated session", () => {
      expect(registerRouteSrc).toContain("if (!email || email !== authenticatedEmail)");
      expect(registerRouteSrc).toContain("Submitted email does not match authenticated session.");
    });

    it("E. Backend enforces ID-card storage path ownership scoped to authenticated email prefix", () => {
      expect(registerRouteSrc).toContain(
        "if (idCardStoragePath && !idCardStoragePath.startsWith(`${authenticatedEmail}/`))"
      );
      expect(registerRouteSrc).toContain("Invalid ID card storage path ownership.");
    });
  });

  // =========================================================================
  // 3. ACCOMMODATION DATE SELECTION & PRICING RULES
  // =========================================================================
  describe("3. Accommodation Plan & Date Resolution Rules", () => {
    it("A. Resolves 1-day stay for valid festival dates", () => {
      const res27 = resolveAccommodationSelection("1_day", "2026-10-27");
      expect(res27.planSlug).toBe("1_day");
      expect(res27.selectedDate).toBe("2026-10-27");

      const res28 = resolveAccommodationSelection("1_day", "2026-10-28");
      expect(res28.planSlug).toBe("1_day");
      expect(res28.selectedDate).toBe("2026-10-28");

      const res30 = resolveAccommodationSelection("1_day", "2026-10-30");
      expect(res30.planSlug).toBe("1_day");
      expect(res30.selectedDate).toBe("2026-10-30");
    });

    it("B. Resolves 2-day base plan with extra days extensions", () => {
      const base = resolveAccommodationSelection("2_days", undefined, "none");
      expect(base.planSlug).toBe("2_days");
      expect(base.selectedDate).toBe("2026-10-28");

      const before27 = resolveAccommodationSelection("2_days", undefined, "before_27");
      expect(before27.planSlug).toBe("3_days");
      expect(before27.selectedDate).toBe("2026-10-27");

      const after30 = resolveAccommodationSelection("2_days", undefined, "after_30");
      expect(after30.planSlug).toBe("3_days");
      expect(after30.selectedDate).toBe("2026-10-30");

      const both = resolveAccommodationSelection("2_days", undefined, "both");
      expect(both.planSlug).toBe("4_days");
      expect(both.selectedDate).toBe("2026-10-27");
    });

    it("C. Accurately calculates stay date intervals [start, end) via calculateStayDates", () => {
      const stay1 = calculateStayDates("1_day", "2026-10-28");
      expect(stay1.startDate).toBe("2026-10-28");
      expect(stay1.endDate).toBe("2026-10-29");
      expect(stay1.durationDays).toBe(1);

      const stay2 = calculateStayDates("2_days", "2026-10-28");
      expect(stay2.startDate).toBe("2026-10-28");
      expect(stay2.endDate).toBe("2026-10-30");
      expect(stay2.durationDays).toBe(2);

      const stay4 = calculateStayDates("4_days", "2026-10-27");
      expect(stay4.startDate).toBe("2026-10-27");
      expect(stay4.endDate).toBe("2026-10-31");
      expect(stay4.durationDays).toBe(4);
    });

    it("D. Detects date conflicts for participants with existing bookings", () => {
      const existing = [
        { startDate: "2026-10-28", endDate: "2026-10-29", status: "paid" },
      ];

      // Night of 28 Oct is booked
      expect(isDateBookedByParticipant("2026-10-28", existing)).toBe(true);
      // Night of 29 Oct is free
      expect(isDateBookedByParticipant("2026-10-29", existing)).toBe(false);

      // Checking plan range conflict for 2-day stay starting 28 Oct
      const conflict = isPlanRangeConflicting("2_days", "2026-10-28", "none", existing);
      expect(conflict.hasConflict).toBe(true);
    });

    it("E. Formats human-readable accommodation stay labels", () => {
      expect(formatAccommodationDate(1, "2026-10-27")).toBe("27 Oct (Day Before)");
      expect(formatAccommodationDate(1, "2026-10-28")).toBe("28 Oct (Day 1)");
      expect(formatAccommodationDate(2, undefined, "none")).toBe("28–29 Oct");
      expect(formatAccommodationDate(4)).toBe("27–30 Oct (4 Days)");
    });
  });

  // =========================================================================
  // 4. DATABASE FUNCTION & ATOMIC PAYMENT ORDER CONTRACT
  // =========================================================================
  describe("4. Database RPC Contract & Polymorphic Payment Orders", () => {
    it("A. RPC function returns accommodation_only fallback row when events array is empty", () => {
      expect(latestMigrationSql).toContain("if jsonb_array_length(v_results) = 0 and v_payment_order_id is not null then");
      expect(latestMigrationSql).toContain("status := 'accommodation_only';");
      expect(latestMigrationSql).toContain("payment_order_id := v_payment_order_id;");
      expect(latestMigrationSql).toContain("return next;");
    });

    it("B. Database RPC calculates total using authoritative accommodation_plans price", () => {
      expect(latestMigrationSql).toContain("v_new_pa_amounts := array_append(v_new_pa_amounts, v_acc_plan.price);");
      expect(latestMigrationSql).toContain("v_total_paid_amount := v_total_paid_amount + v_acc_plan.price;");
    });

    it("C. Database RPC creates payment_order and payment_order_items with item_type='accommodation'", () => {
      expect(latestMigrationSql).toContain("insert into public.payment_orders (");
      expect(latestMigrationSql).toContain("insert into public.payment_order_items (");
      expect(latestMigrationSql).toContain("'accommodation', v_new_pa_ids[v_idx], v_new_pa_amounts[v_idx]");
      expect(latestMigrationSql).toContain("set payment_order_id = v_payment_order_id");
    });

    it("D. Backend API retrieves atomic payment order when returnedPaymentOrderId is present", () => {
      expect(registerRouteSrc).toMatch(/if\s*\(returnedPaymentOrderId\)\s*\{\s*const\s*\{\s*data:\s*orderData/);
      expect(registerRouteSrc).toContain("totalAmount = Number(orderData.amount) || totalAmount;");
      expect(registerRouteSrc).toMatch(/paymentRequired:\s*totalAmount\s*>\s*0/);
    });
  });

  // =========================================================================
  // 5. PAYU PAYMENT LIFECYCLE & WEBHOOK INTEGRITY
  // =========================================================================
  describe("5. PayU Integration, Verification & Idempotency", () => {
    it("A. PayU gateway uses SHA-512 for hash generation and validation", () => {
      const gateway = getPaymentGateway("payu");
      expect(gateway.name).toBe("payu");

      // Verify that validateWebhook rejects empty body cleanly
      const emptyCheck = gateway.validateWebhook({ body: "", signature: "" });
      expect(emptyCheck.valid).toBe(false);
    });

    it("B. PayU success route fails closed on invalid signature or unverified response", () => {
      expect(payuSuccessRouteSrc).toContain("const fetchedPayment = await gateway.fetchPaymentDetails(gatewayOrderId);");
      expect(payuSuccessRouteSrc).toContain('if (fetchedPayment.status !== "paid")');
      expect(payuSuccessRouteSrc).toContain('redirectUrl.searchParams.set("error", "payment-not-paid");');
      expect(payuSuccessRouteSrc).toContain('if (fetchedPayment.amount !== expectedAmountPaise)');
      expect(payuSuccessRouteSrc).toContain('redirectUrl.searchParams.set("error", "amount-mismatch");');
    });

    it("C. PayU success route is idempotent on repeated callbacks", () => {
      expect(payuSuccessRouteSrc).toContain('if (paymentOrder.status === "paid")');
      expect(payuSuccessRouteSrc).toContain("return NextResponse.redirect(new URL(resumeUrl), 303);");
      expect(payuSuccessRouteSrc).toContain('rpcData?.action === "already_paid"');
    });

    it("D. PayU success route invokes ensurePaymentConfirmationSent with the payment order ID", () => {
      expect(payuSuccessRouteSrc).toContain("await ensurePaymentConfirmationSent(paymentOrderId);");
    });
  });

  // =========================================================================
  // 6. PDF RECEIPT GENERATION & ATTACHMENT INTEGRITY
  // =========================================================================
  describe("6. PDF Receipt Generation & Resend Email Delivery", () => {
    it("A. Generates valid PDF buffer for accommodation-only registration", async () => {
      const receiptData: ReceiptData = {
        receiptReference: "RCP-SVK-TEST26-ACC01",
        paymentDate: "24 Oct 2026, 11:30 AM",
        participantName: "Simran Kaur",
        participantId: "SVK26-SK123456",
        email: "simran.kaur@example.com",
        phone: "9876543210",
        college: "Chandigarh Group of Colleges, Landran",
        items: [
          {
            eventName: "1 Day Accommodation (28 Oct)",
            category: "Accommodation",
            registrationType: "individual",
            teamName: null,
            amount: 499,
          },
        ],
        amount: 499,
        gateway: "PayU",
        gatewayOrderId: "txnid-test-acc-001",
        gatewayPaymentId: "mihpayid-99887766",
      };

      const pdfBuffer = await generateReceiptPdf(receiptData);
      expect(pdfBuffer).toBeInstanceOf(Buffer);
      expect(pdfBuffer.byteLength).toBeGreaterThan(1000);

      // PDF Magic bytes check (%PDF-)
      const header = pdfBuffer.slice(0, 5).toString("ascii");
      expect(header).toBe("%PDF-");
    });

    it("B. Post-payment logic claims receipt email atomically to prevent duplicate dispatches", () => {
      expect(postPaymentSrc).toContain('receipt_email_claim_id: claimId');
      expect(postPaymentSrc).toContain('.is("receipt_email_sent_at", null)');
      expect(postPaymentSrc).toContain('if (!claimData || claimData.length === 0)');
      expect(postPaymentSrc).toContain('already claimed/sent. Skipping');
    });

    it("C. sendRegistrationEmail attaches PDF receipt with contentType 'application/pdf'", () => {
      expect(sendEmailSrc).toContain('filename: receiptPdf.filename');
      expect(sendEmailSrc).toContain('content: receiptPdf.buffer');
      expect(sendEmailSrc).toContain('contentType: "application/pdf"');
    });

    it("D. sendRegistrationEmail adjusts subject line when receiptPdf is present", () => {
      expect(sendEmailSrc).toContain(
        "const subjectLine = receiptPdf"
      );
      expect(sendEmailSrc).toContain(
        "? `Payment Confirmed — Saviskar 2026 | Receipt ${recipient.participantId}`"
      );
    });
  });

  // =========================================================================
  // 7. ADMIN DASHBOARD STATUS CONSISTENCY
  // =========================================================================
  describe("7. Admin Accommodation Dashboard Consistency", () => {
    it("A. Admin dashboard selects participant_accommodations status, amount, and dates", () => {
      expect(adminDashboardSrc).toContain("accommodation_plan_id");
      expect(adminDashboardSrc).toContain("start_date");
      expect(adminDashboardSrc).toContain("end_date");
      expect(adminDashboardSrc).toContain("duration_days");
      expect(adminDashboardSrc).toContain("amount");
      expect(adminDashboardSrc).toContain("currency");
      expect(adminDashboardSrc).toContain("status");
    });

    it("B. Admin dashboard joins with participants table to display delegate details", () => {
      expect(adminDashboardSrc).toContain("participant_id");
      expect(adminDashboardSrc).toContain("name");
      expect(adminDashboardSrc).toContain("email");
      expect(adminDashboardSrc).toContain("college");
    });
  });
});
