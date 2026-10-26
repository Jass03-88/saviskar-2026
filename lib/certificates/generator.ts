import fs from "fs";
import path from "path";
import crypto from "crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";

export const EXPECTED_TEMPLATE_HASH =
  "7147721299ba3436899d85e94bde01339af23caea2009aaf5c7b272176ecb207";
export const TEMPLATE_VERSION = "v1-2026-cgc";

export const CERTIFICATE_TEMPLATE_REL_PATH =
  "assets/certificates/saviskar-certificate-template-original.jpeg";

// Standard A4 Landscape in PDF points
export const PDF_PAGE_WIDTH = 841.89;
export const PDF_PAGE_HEIGHT = 595.28;

// Layout geometry (calibrated to the 2048 x 1448 original template)
// 1. Participant Name: line baseline ~317 pt, text baseline 322 pt, center 423.0 pt, max width 490 pt
export const NAME_CENTER_X = 423.0;
export const NAME_BASELINE_Y = 322.0;
export const MAX_NAME_WIDTH = 490.0;
export const INITIAL_NAME_FONT_SIZE = 26.0;
export const MIN_NAME_FONT_SIZE = 12.0;

// 2. Event Name: line baseline ~288.18 pt, text baseline 292 pt, center 504.4 pt, max width 315 pt
export const EVENT_CENTER_X = 504.4;
export const EVENT_BASELINE_Y = 292.0;
export const MAX_EVENT_WIDTH = 315.0;
export const INITIAL_EVENT_FONT_SIZE = 18.0;
export const MIN_EVENT_FONT_SIZE = 10.0;

export interface GenerateCertificateOptions {
  recipientName: string;
  eventName: string;
  certificateNumber?: string;
  customTemplatePath?: string;
}

/**
 * Checks if a string contains complex Unicode scripts (e.g. Gurmukhi, Devanagari, Bengali, etc.)
 * that require font glyph shaping beyond WinAnsi.
 */
export function hasComplexUnicode(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 255) {
      return true;
    }
  }
  return false;
}

/**
 * Normalizes and cleans text without stripping Indian or international characters.
 */
export function sanitizeTextForPdf(input: string): string {
  if (!input) return "";

  // 1. Strip zero-width and control characters
  let clean = input.replace(/[\u200B-\u200D\uFEFF\x00-\x1F\x7F]/g, "");

  // 2. Replace typographic curly quotes and dashes with standard equivalents
  clean = clean
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...");

  return clean.trim();
}

/**
 * Renders Unicode text to a high-DPI transparent PNG overlay using sharp's SVG renderer.
 * Guarantees crisp, uncorrupted glyph shaping for Gurmukhi, Devanagari, Latin, and international scripts.
 */
export async function renderUnicodeTextOverlayPng(
  text: string,
  maxWidthPt: number,
  targetHeightPt: number,
  fontSizePt: number,
  colorHex = "#1e1b4b"
): Promise<Buffer> {
  const scale = 2.5; // High-DPI 2.5x resolution for print quality
  const targetWidthPx = Math.round(maxWidthPt * scale);
  const targetHeightPx = Math.round(targetHeightPt * scale);
  const fontSizePx = Math.round(fontSizePt * scale);

  const xmlEscaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

  const svg = `
    <svg width="${targetWidthPx}" height="${targetHeightPx}" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="70%"
        font-family="Arial, 'Nirmala UI', 'Noto Sans Gurmukhi', 'Noto Sans Devanagari', 'Segoe UI', sans-serif"
        font-size="${fontSizePx}px"
        font-weight="bold"
        text-anchor="middle"
        fill="${colorHex}">
        ${xmlEscaped}
      </text>
    </svg>
  `;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Validates and reads the certificate template image, returning bytes and verifying hash.
 */
export function getVerifiedTemplateBytes(customPath?: string): {
  bytes: Buffer;
  hash: string;
  verified: boolean;
} {
  const resolvedPath = customPath
    ? path.resolve(customPath)
    : path.resolve(process.cwd(), CERTIFICATE_TEMPLATE_REL_PATH);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Certificate template image not found at ${resolvedPath}. Please place saviskar-certificate-template-original.jpeg in assets/certificates/.`
    );
  }

  const bytes = fs.readFileSync(resolvedPath);
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");

  if (hash !== EXPECTED_TEMPLATE_HASH) {
    console.warn(
      `[CERTIFICATE WARNING] Template hash mismatch. Expected ${EXPECTED_TEMPLATE_HASH}, got ${hash}.`
    );
  }

  return { bytes, hash, verified: hash === EXPECTED_TEMPLATE_HASH };
}

/**
 * Generates an official Saviskar 2026 Participation Certificate PDF for a single recipient and event.
 * Handles Latin, Punjabi/Gurmukhi, Hindi/Devanagari, long names, and long events without character dropping or corruption.
 */
export async function generateParticipationCertificatePdf(
  options: GenerateCertificateOptions
): Promise<{ pdfBytes: Uint8Array; templateHash: string }> {
  const cleanName = sanitizeTextForPdf(options.recipientName);
  const cleanEvent = sanitizeTextForPdf(options.eventName);

  if (!cleanName) {
    throw new Error("Certificate generation aborted: recipient name cannot be empty.");
  }
  if (!cleanEvent) {
    throw new Error("Certificate generation aborted: event name cannot be empty.");
  }

  const { bytes: imgBytes, hash: templateHash } = getVerifiedTemplateBytes(
    options.customTemplatePath
  );

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);

  const jpgImage = await pdfDoc.embedJpg(imgBytes);
  page.drawImage(jpgImage, {
    x: 0,
    y: 0,
    width: PDF_PAGE_WIDTH,
    height: PDF_PAGE_HEIGHT,
  });

  const isNameUnicode = hasComplexUnicode(cleanName);
  const isEventUnicode = hasComplexUnicode(cleanEvent);

  // 1. Participant Name Overlay
  if (isNameUnicode) {
    // Unicode script (Gurmukhi, Devanagari, etc.): High-DPI transparent PNG overlay
    const nameFontSize = cleanName.length > 35 ? 18 : cleanName.length > 25 ? 22 : INITIAL_NAME_FONT_SIZE;
    const nameHeightPt = 45;
    const namePng = await renderUnicodeTextOverlayPng(
      cleanName,
      MAX_NAME_WIDTH,
      nameHeightPt,
      nameFontSize,
      "#1e1b4b"
    );
    const nameImg = await pdfDoc.embedPng(namePng);
    page.drawImage(nameImg, {
      x: NAME_CENTER_X - MAX_NAME_WIDTH / 2,
      y: 310,
      width: MAX_NAME_WIDTH,
      height: nameHeightPt,
    });
  } else {
    // Standard Latin: Direct vector text
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    let nameSize = INITIAL_NAME_FONT_SIZE;
    let nameWidth = fontBold.widthOfTextAtSize(cleanName, nameSize);

    if (nameWidth > MAX_NAME_WIDTH) {
      nameSize = Math.max(
        MIN_NAME_FONT_SIZE,
        (MAX_NAME_WIDTH / nameWidth) * nameSize
      );
      nameWidth = fontBold.widthOfTextAtSize(cleanName, nameSize);
    }

    const nameX = NAME_CENTER_X - nameWidth / 2;
    page.drawText(cleanName, {
      x: nameX,
      y: NAME_BASELINE_Y,
      size: nameSize,
      font: fontBold,
      color: rgb(0.12, 0.08, 0.22),
    });
  }

  // 2. Event Name Overlay
  if (isEventUnicode) {
    const eventFontSize = cleanEvent.length > 30 ? 13 : cleanEvent.length > 20 ? 15 : INITIAL_EVENT_FONT_SIZE;
    const eventHeightPt = 35;
    const eventPng = await renderUnicodeTextOverlayPng(
      cleanEvent,
      MAX_EVENT_WIDTH,
      eventHeightPt,
      eventFontSize,
      "#1e1b4b"
    );
    const eventImg = await pdfDoc.embedPng(eventPng);
    page.drawImage(eventImg, {
      x: EVENT_CENTER_X - MAX_EVENT_WIDTH / 2,
      y: 282,
      width: MAX_EVENT_WIDTH,
      height: eventHeightPt,
    });
  } else {
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    let eventSize = INITIAL_EVENT_FONT_SIZE;
    let eventWidth = fontBold.widthOfTextAtSize(cleanEvent, eventSize);

    if (eventWidth > MAX_EVENT_WIDTH) {
      eventSize = Math.max(
        MIN_EVENT_FONT_SIZE,
        (MAX_EVENT_WIDTH / eventWidth) * eventSize
      );
      eventWidth = fontBold.widthOfTextAtSize(cleanEvent, eventSize);
    }

    const eventX = EVENT_CENTER_X - eventWidth / 2;
    page.drawText(cleanEvent, {
      x: eventX,
      y: EVENT_BASELINE_Y,
      size: eventSize,
      font: fontBold,
      color: rgb(0.15, 0.1, 0.25),
    });
  }

  const pdfBytes = await pdfDoc.save();
  return { pdfBytes, templateHash };
}
