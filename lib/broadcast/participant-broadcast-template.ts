/**
 * SAVISKAR 2K26 — Official Participant Document Verification Broadcast Template
 *
 * Visually matches the established registration confirmation and payment email design:
 * - Strictly Black & White aesthetic
 * - Black hero header (#050505) with white heading and subtle grey subtext
 * - White main content area (#ffffff) on neutral grey background (#f3f3f3)
 * - Minimal dividers (#eeeeee / #eaeaea)
 * - Structured document checklist cards (#fafafa with 1px solid #eeeeee)
 * - Notice card for Registration Desk verification
 * - Email-client compatible table layout with inline styles
 * - Zero dynamic registration-specific tokens (no QR codes, participant IDs, or amounts)
 */

export const PARTICIPANT_BROADCAST_SUBJECT =
  "Important: Documents Required for SAVISKAR 2K26 Verification";

export const PARTICIPANT_BROADCAST_CAMPAIGN_TITLE =
  "SAVISKAR 2K26 – Participant Document Verification Instructions";

export interface ParticipantBroadcastOptions {
  recipientName?: string;
  participantName?: string;
  previewText?: string;
}

/**
 * Escapes HTML characters to prevent injection.
 */
export function escapeHtml(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Renders the production-quality black-and-white HTML broadcast email.
 */
export function renderParticipantVerificationBroadcastHtml(
  options?: ParticipantBroadcastOptions
): string {
  const nameInput = (options?.recipientName || options?.participantName)?.trim();
  const safeRecipientName = nameInput ? escapeHtml(nameInput) : "Participant";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${escapeHtml(PARTICIPANT_BROADCAST_SUBJECT)}</title>
</head>
<body
  style="
    margin: 0;
    padding: 0;
    background: #f3f3f3;
    font-family: Arial, Helvetica, sans-serif;
    color: #111111;
    -webkit-font-smoothing: antialiased;
  "
>
  <!-- Preheader Preview Text (Hidden in body, visible in email client preview) -->
  <div
    style="
      display: none;
      font-size: 1px;
      color: #f3f3f3;
      line-height: 1px;
      max-height: 0px;
      max-width: 0px;
      opacity: 0;
      overflow: hidden;
    "
  >
    Important document verification instructions for all registered SAVISKAR 2K26 participants arriving at CGC University, Mohali.
  </div>

  <table
    role="presentation"
    width="100%"
    cellspacing="0"
    cellpadding="0"
    border="0"
    style="
      background: #f3f3f3;
      padding: 40px 15px;
      box-sizing: border-box;
    "
  >
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table
          role="presentation"
          width="100%"
          cellspacing="0"
          cellpadding="0"
          border="0"
          style="
            max-width: 620px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 24px;
            overflow: hidden;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
          "
        >
          <!-- BLACK HERO HEADER -->
          <tr>
            <td
              style="
                background: #050505;
                color: #ffffff;
                padding: 42px 38px;
                text-align: left;
              "
            >
              <div
                style="
                  font-size: 10px;
                  letter-spacing: 3px;
                  text-transform: uppercase;
                  color: #888888;
                  font-weight: 700;
                "
              >
                SAVISKAR 2K26
              </div>

              <div
                style="
                  margin-top: 32px;
                  font-size: 11px;
                  letter-spacing: 2px;
                  text-transform: uppercase;
                  color: #777777;
                  font-weight: 600;
                "
              >
                Participant Instructions
              </div>

              <h1
                style="
                  margin: 10px 0 0;
                  font-size: 40px;
                  line-height: 1.15;
                  letter-spacing: -1.5px;
                  color: #ffffff;
                  font-weight: 700;
                "
              >
                Important: Documents Required.
              </h1>

              <p
                style="
                  margin: 22px 0 0;
                  max-width: 480px;
                  font-size: 14px;
                  line-height: 1.7;
                  color: #999999;
                "
              >
                Official document verification and entry guidelines for SAVISKAR 2K26 at CGC University, Mohali.
              </p>
            </td>
          </tr>

          <!-- WHITE MAIN CONTENT AREA -->
          <tr>
            <td
              style="
                padding: 38px;
                background: #ffffff;
                text-align: left;
              "
            >
              <!-- Greeting & Welcome -->
              <div
                style="
                  font-size: 15px;
                  line-height: 1.7;
                  color: #222222;
                "
              >
                <p style="margin: 0 0 16px 0; font-weight: 600; color: #111111;">
                  Dear ${safeRecipientName},
                </p>

                <p style="margin: 0 0 16px 0;">
                  Greetings from Team SAVISKAR 2K26!
                </p>

                <p style="margin: 0 0 16px 0; color: #444444;">
                  Thank you for registering for SAVISKAR 2K26, the techno-cultural fest of CGC University, Mohali. We are delighted to welcome you and look forward to an exciting and memorable fest experience.
                </p>

                <p style="margin: 0 0 0 0; color: #444444;">
                  To ensure a smooth verification process upon your arrival, please carry the following documents:
                </p>
              </div>

              <!-- SECTION DIVIDER -->
              <div
                style="
                  margin-top: 32px;
                  border-top: 1px solid #eeeeee;
                  padding-top: 28px;
                "
              >
                <div
                  style="
                    font-size: 10px;
                    letter-spacing: 2px;
                    text-transform: uppercase;
                    color: #999999;
                    font-weight: 700;
                    margin-bottom: 18px;
                  "
                >
                  DOCUMENTS REQUIRED
                </div>

                <!-- Document 1: Valid ID Proof -->
                <div
                  style="
                    border: 1px solid #eeeeee;
                    border-radius: 14px;
                    padding: 18px 20px;
                    margin-bottom: 12px;
                    background: #fafafa;
                  "
                >
                  <div
                    style="
                      font-size: 9px;
                      letter-spacing: 1.5px;
                      text-transform: uppercase;
                      color: #aaaaaa;
                      margin-bottom: 5px;
                      font-weight: 700;
                    "
                  >
                    REQUIREMENT 1
                  </div>
                  <div
                    style="
                      font-size: 16px;
                      font-weight: 700;
                      color: #111111;
                    "
                  >
                    1. Valid ID Proof
                  </div>
                  <div
                    style="
                      font-size: 13px;
                      line-height: 1.6;
                      color: #555555;
                      margin-top: 6px;
                    "
                  >
                    Carry one valid identification document: Aadhaar Card, College/University ID Card, or PAN Card.
                  </div>
                </div>

                <!-- Document 2: Passport-Size Photograph -->
                <div
                  style="
                    border: 1px solid #eeeeee;
                    border-radius: 14px;
                    padding: 18px 20px;
                    margin-bottom: 12px;
                    background: #fafafa;
                  "
                >
                  <div
                    style="
                      font-size: 9px;
                      letter-spacing: 1.5px;
                      text-transform: uppercase;
                      color: #aaaaaa;
                      margin-bottom: 5px;
                      font-weight: 700;
                    "
                  >
                    REQUIREMENT 2
                  </div>
                  <div
                    style="
                      font-size: 16px;
                      font-weight: 700;
                      color: #111111;
                    "
                  >
                    2. Passport-Size Photograph
                  </div>
                  <div
                    style="
                      font-size: 13px;
                      line-height: 1.6;
                      color: #555555;
                      margin-top: 6px;
                    "
                  >
                    Carry one recent passport-size photograph.
                  </div>
                </div>

                <!-- Document 3: Printed Documents -->
                <div
                  style="
                    border: 1px solid #eeeeee;
                    border-radius: 14px;
                    padding: 18px 20px;
                    margin-bottom: 12px;
                    background: #fafafa;
                  "
                >
                  <div
                    style="
                      font-size: 9px;
                      letter-spacing: 1.5px;
                      text-transform: uppercase;
                      color: #aaaaaa;
                      margin-bottom: 5px;
                      font-weight: 700;
                    "
                  >
                    REQUIREMENT 3
                  </div>
                  <div
                    style="
                      font-size: 16px;
                      font-weight: 700;
                      color: #111111;
                    "
                  >
                    3. Printed Documents
                  </div>
                  <div
                    style="
                      font-size: 13px;
                      line-height: 1.6;
                      color: #555555;
                      margin-top: 6px;
                    "
                  >
                    Carry a hard copy of your ID proof and payment receipt, if applicable.
                  </div>
                </div>
              </div>

              <!-- NOTICE CARD: REGISTRATION DESK VERIFICATION -->
              <div
                style="
                  margin-top: 26px;
                  border: 1px solid #111111;
                  background: #050505;
                  border-radius: 18px;
                  padding: 24px 22px;
                  color: #ffffff;
                "
              >
                <div
                  style="
                    font-size: 10px;
                    letter-spacing: 2px;
                    text-transform: uppercase;
                    color: #888888;
                    font-weight: 700;
                    margin-bottom: 8px;
                  "
                >
                  IMPORTANT NOTICE
                </div>

                <div
                  style="
                    font-size: 15px;
                    font-weight: 700;
                    color: #ffffff;
                    margin-bottom: 10px;
                    letter-spacing: 0.5px;
                  "
                >
                  IMPORTANT: VERIFICATION AT THE REGISTRATION DESK
                </div>

                <p
                  style="
                    margin: 0 0 10px 0;
                    font-size: 13px;
                    line-height: 1.6;
                    color: #d1d5db;
                  "
                >
                  Please keep your applicable documents ready and present them to the verification team at the registration desk upon arrival. This will help us complete the verification process smoothly and efficiently.
                </p>

                <p
                  style="
                    margin: 0;
                    font-size: 13px;
                    line-height: 1.6;
                    color: #9ca3af;
                  "
                >
                  Ensure that you carry the required documents to avoid unnecessary delays during verification.
                </p>
              </div>

              <!-- CLOSING NOTE -->
              <div
                style="
                  margin-top: 30px;
                  font-size: 14px;
                  line-height: 1.7;
                  color: #444444;
                "
              >
                We appreciate your cooperation and enthusiasm. We look forward to welcoming you to SAVISKAR 2K26 and making this celebration of talent, creativity, and innovation memorable.
              </div>

              <!-- SIGNATURE BLOCK -->
              <div
                style="
                  margin-top: 32px;
                  border-top: 1px solid #eeeeee;
                  padding-top: 24px;
                "
              >
                <div
                  style="
                    font-size: 14px;
                    color: #555555;
                    margin-bottom: 6px;
                  "
                >
                  Best wishes,
                </div>
                <div
                  style="
                    font-size: 16px;
                    font-weight: 700;
                    color: #111111;
                  "
                >
                  Team SAVISKAR 2K26
                </div>
                <div
                  style="
                    font-size: 13px;
                    color: #777777;
                    margin-top: 3px;
                  "
                >
                  CGC University, Mohali
                </div>
              </div>
            </td>
          </tr>
        </table>

        <!-- FOOTER OUTSIDE CARD -->
        <div
          style="
            max-width: 620px;
            margin: 22px auto 0;
            text-align: center;
            font-size: 10px;
            color: #aaaaaa;
            letter-spacing: 1px;
            text-transform: uppercase;
          "
        >
          SAVISKAR 2K26 · CGC UNIVERSITY, MOHALI · OFFICIAL PARTICIPANT UPDATE
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Renders the exact plain-text alternative of the participant broadcast email.
 */
export function renderParticipantVerificationBroadcastText(
  options?: ParticipantBroadcastOptions
): string {
  const recipientName =
    (options?.recipientName || options?.participantName)?.trim() || "Participant";

  return `Dear ${recipientName},

Greetings from Team SAVISKAR 2K26!

Thank you for registering for SAVISKAR 2K26, the techno-cultural fest of CGC University, Mohali. We are delighted to welcome you and look forward to an exciting and memorable fest experience.

To ensure a smooth verification process upon your arrival, please carry the following documents:

DOCUMENTS REQUIRED

1. Valid ID Proof
Carry one valid identification document: Aadhaar Card, College/University ID Card, or PAN Card.

2. Passport-Size Photograph
Carry one recent passport-size photograph.

3. Printed Documents
Carry a hard copy of your ID proof and payment receipt, if applicable.

IMPORTANT: VERIFICATION AT THE REGISTRATION DESK

Please keep your applicable documents ready and present them to the verification team at the registration desk upon arrival. This will help us complete the verification process smoothly and efficiently.

Ensure that you carry the required documents to avoid unnecessary delays during verification.

We appreciate your cooperation and enthusiasm. We look forward to welcoming you to SAVISKAR 2K26 and making this celebration of talent, creativity, and innovation memorable.

Best wishes,

Team SAVISKAR 2K26
CGC University, Mohali
`;
}

/**
 * Verified server-side initial dispatch batch size limit.
 * Source: app/api/admin/broadcast/campaigns/route.ts (batchSize: 25)
 * and claim_broadcast_deliveries (p_batch_size: 25).
 * In general broadcast campaigns, 1 delivery = 1 recipient email.
 */
export const BROADCAST_IMMEDIATE_DISPATCH_BATCH_SIZE = 25;

/**
 * Returns precise, verified warning copy for immediate dispatch mode based on selected recipient count.
 */
export function getImmediateDispatchWarningCopy(recipientCount: number): string {
  if (recipientCount <= BROADCAST_IMMEDIATE_DISPATCH_BATCH_SIZE) {
    return `You have enabled Begin dispatch immediately upon creation. All ${recipientCount} ${
      recipientCount === 1 ? "email" : "emails"
    } will be dispatched immediately through Resend upon campaign creation. This action cannot be paused or undone.`;
  }
  const remainder = recipientCount - BROADCAST_IMMEDIATE_DISPATCH_BATCH_SIZE;
  return `You have enabled Begin dispatch immediately upon creation. The first batch of ${BROADCAST_IMMEDIATE_DISPATCH_BATCH_SIZE} deliveries will be dispatched immediately through Resend, and the remaining ${remainder} ${
    remainder === 1 ? "delivery" : "deliveries"
  } will remain safely queued in the database for subsequent batch processing. Outbound dispatch starts immediately and cannot be undone.`;
}

export interface GeneralBroadcastValidationInput {
  title: string;
  subject: string;
  bodyHtml: string;
  recipientCount: number;
  isPreviewMode?: boolean;
  isProductionReadOnly?: boolean;
}

export interface GeneralBroadcastValidationResult {
  isValid: boolean;
  errorMessage?: string;
}

export function validateGeneralBroadcastInput(
  input: GeneralBroadcastValidationInput
): GeneralBroadcastValidationResult {
  if (!input.title.trim() || !input.subject.trim() || !input.bodyHtml.trim()) {
    return {
      isValid: false,
      errorMessage: "Please enter campaign title, subject, and message body.",
    };
  }
  if (input.recipientCount === 0) {
    return {
      isValid: false,
      errorMessage: "Please select at least one recipient email.",
    };
  }
  if (input.isPreviewMode) {
    return {
      isValid: false,
      errorMessage: "Campaign creation is disabled in Preview Mode.",
    };
  }
  if (input.isProductionReadOnly) {
    return {
      isValid: false,
      errorMessage: "Campaign creation is disabled in Production Read-Only Mode.",
    };
  }
  return { isValid: true };
}

export interface GeneralCampaignPayloadParams {
  title: string;
  subject: string;
  bodyHtml: string;
  selectedEmails: string[];
  dispatchImmediately: boolean;
}

export function buildGeneralCampaignPayload(params: GeneralCampaignPayloadParams) {
  const bodyText =
    params.title === PARTICIPANT_BROADCAST_CAMPAIGN_TITLE &&
    params.bodyHtml === renderParticipantVerificationBroadcastHtml()
      ? renderParticipantVerificationBroadcastText()
      : params.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  return {
    title: params.title.trim(),
    subject: params.subject.trim(),
    bodyHtml: params.bodyHtml,
    bodyText,
    campaignType: "general" as const,
    selectedEmails: params.selectedEmails,
    dispatchImmediately: params.dispatchImmediately,
  };
}
