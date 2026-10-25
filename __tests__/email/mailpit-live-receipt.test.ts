import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import dotenv from "dotenv";
dotenv.config({ path: ".env.e2e.local" });

const TEST_ORDER_ID = "b60cc90e-22e4-4947-91c4-9e8881775913";
const TEST_PARTICIPANT_ID = "SVK26-550BF103";
const MAILPIT_URL = process.env.MAILPIT_API_URL || "http://127.0.0.1:54324";

const mockOrderData = {
  id: TEST_ORDER_ID,
  order_reference: TEST_PARTICIPANT_ID,
  amount: 499,
  currency: "INR",
  gateway: "PayU",
  gateway_order_id: "payu_test_order_123",
  gateway_payment_id: "payu_test_payment_456",
  payer_participant_id: "part-1",
  status: "paid",
  receipt_email_sent_at: null,
};

const mockParticipantData = {
  id: "part-1",
  participant_id: TEST_PARTICIPANT_ID,
  name: "Jashan Jot Singh",
  email: "jashan.cgcu@gmail.com",
  phone: "+919876543210",
  college: "CGC Landran",
};

const mockOrderItemsData = [
  {
    id: "item-acc-1",
    amount: 499,
    item_type: "accommodation",
    event_id: null,
    participant_event_id: null,
    participant_accommodation_id: "acc-1",
    events: null,
    participant_events: null,
    participant_accommodations: {
      id: "acc-1",
      start_date: "2026-10-28",
      end_date: "2026-10-29",
      duration_days: 1,
      accommodation_plans: {
        name: "1 Day Accommodation",
        slug: "1_day",
      },
      participants: {
        name: "Jashan Jot Singh",
        participant_id: TEST_PARTICIPANT_ID,
      },
    },
  },
];

vi.mock("@supabase/supabase-js", () => {
  return {
    createClient: vi.fn(() => ({
      from: vi.fn((table: string) => {
        let isUpdate = false;
        const builder: any = {
          update: vi.fn(() => {
            isUpdate = true;
            return builder;
          }),
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          is: vi.fn(() => builder),
          or: vi.fn(() => builder),
          limit: vi.fn(() => builder),
          maybeSingle: vi.fn(async () => {
            if (table === "payments") {
              return { data: { created_at: "2026-10-25T01:00:00.000Z" }, error: null };
            }
            return { data: null, error: null };
          }),
          single: vi.fn(async () => {
            if (table === "payment_orders") {
              return { data: mockOrderData, error: null };
            }
            if (table === "participants") {
              return { data: mockParticipantData, error: null };
            }
            return { data: null, error: null };
          }),
          then: (resolve: any) => {
            if (table === "payment_orders") {
              if (isUpdate) {
                return Promise.resolve({
                  data: [{ id: TEST_ORDER_ID }],
                  error: null,
                }).then(resolve);
              }
              return Promise.resolve({
                data: [mockOrderData],
                error: null,
              }).then(resolve);
            }
            if (table === "payment_order_items") {
              return Promise.resolve({
                data: mockOrderItemsData,
                error: null,
              }).then(resolve);
            }
            return Promise.resolve({ data: [], error: null }).then(resolve);
          },
        };
        return builder;
      }),
    })),
  };
});

import { ensurePaymentConfirmationSent } from "@/lib/payments/post-payment";

describe("Live Mailpit Receipt Delivery E2E", () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env.E2E_EMAIL_TRANSPORT = "mailpit";
    process.env.ENABLE_TEST_RECIPIENT_GUARD = "true";
    process.env.APPROVED_TEST_EMAIL = "jashan.cgcu@gmail.com";
    process.env.MAILPIT_API_URL = MAILPIT_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    process.env.PAYMENT_CALLBACK_BASE_URL = "http://localhost:3000";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SECRET_KEY = "mock-secret-key-ci";
    process.env.RESEND_FROM_EMAIL = "Saviskar 2026 <noreply@saviskar.co.in>";

    // Reset messages in Mailpit to ensure clean test state
    try {
      await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" });
    } catch {
      // Ignored if service is not yet responding
    }
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
  });

  it(
    "delivers full PDF receipt attachment with correct order reference, plan, amount, and PAID status to local Mailpit",
    async () => {
    // 0. Verify Mailpit HTTP API connectivity
    const healthCheck = await fetch(`${MAILPIT_URL}/api/v1/messages`).catch(() => null);
    expect(
      healthCheck?.ok,
      `Mailpit service must be running and accessible at ${MAILPIT_URL}`
    ).toBe(true);

    // 1. Invoke payment confirmation for the settled accommodation order
    await ensurePaymentConfirmationSent(TEST_ORDER_ID);

    // 2. Poll Mailpit with bounded retry for the freshly delivered message
    let receiptMsgMeta: any = null;
    const maxRetries = 20;
    const retryDelayMs = 250;

    for (let i = 0; i < maxRetries; i++) {
      const messagesRes = await fetch(`${MAILPIT_URL}/api/v1/messages`);
      if (messagesRes.ok) {
        const { messages } = await messagesRes.json();
        receiptMsgMeta = (messages || []).find((m: any) =>
          m.Subject?.includes(`Payment Confirmed — Saviskar 2026 | Receipt ${TEST_PARTICIPANT_ID}`)
        );
        if (receiptMsgMeta) break;
      }
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }

    expect(
      receiptMsgMeta,
      `Fresh receipt email for ${TEST_PARTICIPANT_ID} must be delivered to Mailpit`
    ).toBeDefined();

    // 3. Fetch detailed message payload
    const detailRes = await fetch(`${MAILPIT_URL}/api/v1/message/${receiptMsgMeta.ID}`);
    expect(detailRes.ok).toBe(true);
    const detail = await detailRes.json();

    expect(detail.To[0].Address).toBe("jashan.cgcu@gmail.com");

    const pdfPartMeta = detail.Attachments.find((a: any) =>
      a.FileName.endsWith(".pdf")
    );
    expect(pdfPartMeta).toBeDefined();
    expect(pdfPartMeta.Size).toBeGreaterThan(1000);

    // 4. Download the actual PDF attachment part
    const partRes = await fetch(
      `${MAILPIT_URL}/api/v1/message/${receiptMsgMeta.ID}/part/${pdfPartMeta.PartID}`
    );
    expect(partRes.ok).toBe(true);
    const pdfBuffer = Buffer.from(await partRes.arrayBuffer());

    // 5. Verify PDF structure and metadata
    expect(pdfBuffer.length).toBeGreaterThan(1000);
    expect(pdfBuffer.slice(0, 5).toString("utf8")).toBe("%PDF-");

    const { PDFDocument } = await import("pdf-lib");
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    expect(pdfDoc.getPageCount()).toBeGreaterThanOrEqual(1);

    // Decompress and decode text stream
    const zlib = await import("zlib");
    const rawStr = pdfBuffer.toString("latin1");
    const streamStart = rawStr.indexOf("stream\r\n") !== -1 ? rawStr.indexOf("stream\r\n") + 8 : rawStr.indexOf("stream\n") + 7;
    const streamEnd = rawStr.indexOf("endstream");
    expect(streamStart).toBeGreaterThan(0);
    expect(streamEnd).toBeGreaterThan(streamStart);

    const decompressed = zlib.inflateSync(pdfBuffer.slice(streamStart, streamEnd)).toString("utf-8");
    const decodedText = decompressed.replace(/<([0-9a-fA-F]+)>\s*Tj/g, (_, hex) =>
      Buffer.from(hex, "hex").toString("utf-8")
    );

    // Verify all critical receipt values
    expect(decodedText).toContain(TEST_PARTICIPANT_ID);
    expect(decodedText).toContain(`RCP-${TEST_PARTICIPANT_ID}`);
    expect(decodedText).toContain("1 Day Accommodation");
    expect(decodedText).toContain("Accommodation");
    expect(decodedText).toContain("499");
    expect(decodedText).toContain("PAID");
  }, 15000);
});
