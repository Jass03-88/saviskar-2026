import { describe, it, expect } from "vitest";
import dotenv from "dotenv";
dotenv.config({ path: ".env.e2e.local" });

import { ensurePaymentConfirmationSent } from "@/lib/payments/post-payment";

describe("Live Mailpit Receipt Delivery E2E", () => {
  it("delivers full PDF receipt attachment with correct order reference, plan, amount, and PAID status to local Mailpit", async () => {
    // 1. Invoke payment confirmation for the settled accommodation order
    await ensurePaymentConfirmationSent("b60cc90e-22e4-4947-91c4-9e8881775913");

    // 2. Fetch the message from local Mailpit
    const messagesRes = await fetch("http://127.0.0.1:54324/api/v1/messages");
    expect(messagesRes.ok).toBe(true);
    const { messages } = await messagesRes.json();

    const receiptMsgMeta = messages.find((m: any) =>
      m.Subject.includes("Payment Confirmed — Saviskar 2026 | Receipt SVK26-550BF103")
    );
    expect(receiptMsgMeta).toBeDefined();

    // 3. Fetch detailed message payload
    const detailRes = await fetch(`http://127.0.0.1:54324/api/v1/message/${receiptMsgMeta.ID}`);
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
      `http://127.0.0.1:54324/api/v1/message/${receiptMsgMeta.ID}/part/${pdfPartMeta.PartID}`
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
    expect(decodedText).toContain("SVK26-550BF103");
    expect(decodedText).toMatch(/RCP-SVK-SVK26-550BF103-\d+-[A-F0-9]+/);
    expect(decodedText).toContain("1 Day Accommodation");
    expect(decodedText).toContain("Accommodation");
    expect(decodedText).toContain("499");
    expect(decodedText).toContain("PAID");
  });
});
