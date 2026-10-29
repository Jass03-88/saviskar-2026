import { Resend } from "resend";
import QRCode from "qrcode";
import { isTestEmailTransportActive, sendViaTestTransport } from "@/lib/email/test-transport";

/**
 * RECIPIENT SAFEGUARD POLICY:
 * 1. Production Mode (Default): When ENABLE_TEST_RECIPIENT_GUARD is not "true",
 *    emails are delivered normally to legitimate participant addresses.
 *    A generic development variable (like APPROVED_TEST_EMAIL alone) will NOT activate
 *    test mode in production.
 * 2. Testing Mode: When ENABLE_TEST_RECIPIENT_GUARD="true" (or in non-production when
 *    APPROVED_TEST_EMAIL is provided), outbound dispatches are fail-closed and strictly
 *    restricted to the hardcoded approved test address.
 */
const HARDCODED_PERMITTED_TEST_EMAIL = "jashan.cgcu@gmail.com";

export function isTestRecipientGuardActive(): boolean {
  if (process.env.ENABLE_TEST_RECIPIENT_GUARD === "true") {
    return true;
  }
  // In production, require the explicit ENABLE_TEST_RECIPIENT_GUARD="true" flag;
  // a generic/stray variable must never accidentally trigger test mode in production.
  if (process.env.NODE_ENV === "production") {
    return false;
  }
  return !!process.env.APPROVED_TEST_EMAIL;
}

export type TeamMember = {
  participantId: string;
  name: string;
  college?: string;
  email: string;
  phone?: string;
  isTeamLeader?: boolean;
};

export type AccommodationEmailDetails = {
  planName: string;
  participantName: string;
  dates: string;
  amount: number;
  durationDays?: number;
  checkoutDate?: string;
  orderReference?: string;
  paymentId?: string;
};

export type RegistrationEmailData = {
  registrationId?: string;
  participantId: string;
  eventName: string;
  eventCategory?: string | null;

  name: string;
  college: string;
  email: string;
  phone?: string;

  team?: string | null;
  isTeamEvent?: boolean;
  isTeamHead?: boolean;
  members?: TeamMember[];
  
  requiresPayment?: boolean;
  paymentResumeUrl?: string | null;
  
  receiptPdf?: {
    buffer: Buffer;
    filename: string;
  } | null;

  accommodationDetails?: AccommodationEmailDetails[] | null;
  idempotencyKey?: string;
};

export type SendResult = {
  success: boolean;
  emailsSent: number;
  recipients: Array<{
    email: string;
    emailId: string | null;
  }>;
  error?: string;
};

function escapeHtml(
  value: string | null | undefined
) {
  if (!value) return "";

  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Sends registration confirmation email(s) with QR code
 * directly via Resend SDK.
 *
 * For team events, every unique team member receives
 * their own personalized email.
 *
 * Returns a result object — never throws.
 */
export async function sendRegistrationEmail(
  data: RegistrationEmailData
): Promise<SendResult> {
  console.log("[REGISTER EMAIL] send-registration-email function entered");
  const testTransportActive = isTestEmailTransportActive();
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  console.log(`[REGISTER EMAIL] RESEND_API_KEY present: ${!!apiKey}, testTransportActive: ${testTransportActive}`);

  if (!apiKey && !testTransportActive) {
    console.error(
      "sendRegistrationEmail: RESEND_API_KEY is missing."
    );
    return {
      success: false,
      emailsSent: 0,
      recipients: [],
      error: "Email service is not configured.",
    };
  }

  if (!fromEmail) {
    console.error(
      "sendRegistrationEmail: RESEND_FROM_EMAIL is missing."
    );
    return {
      success: false,
      emailsSent: 0,
      recipients: [],
      error: "Sender email is not configured.",
    };
  }

  const guardActive = isTestRecipientGuardActive();
  if (guardActive) {
    const configuredTestEmail = process.env.APPROVED_TEST_EMAIL?.trim().toLowerCase();
    if (configuredTestEmail !== HARDCODED_PERMITTED_TEST_EMAIL) {
      console.warn(
        "[SAFEGUARD BLOCKED] Outbound email suppressed: test recipient safeguard is active, but APPROVED_TEST_EMAIL is missing or does not match authorized address."
      );
      return {
        success: false,
        emailsSent: 0,
        recipients: [],
        error: "Outbound email delivery suppressed: test recipient safeguard is active and unconfigured or unauthorized.",
      };
    }
  }

  const {
    participantId,
    eventName,
    eventCategory,
    name,
    college,
    email,
    phone,
    team,
    isTeamEvent = false,
    isTeamHead = false,
    members = [],
    requiresPayment = false,
    paymentResumeUrl,
    receiptPdf,
    accommodationDetails = [],
  } = data;

  const resolvedCollege = college && college.trim() ? college.trim() : "N/A";

  if (
    !participantId ||
    !eventName ||
    !name ||
    !email
  ) {
    return {
      success: false,
      emailsSent: 0,
      recipients: [],
      error: "Missing required registration information.",
    };
  }

  const resend = apiKey ? new Resend(apiKey) : null;

  /*
   * Generate QR code as a PNG buffer for Resend CID inline attachment.
   *
   * Gmail (and many webmail clients) strip base64 data: URIs from
   * email HTML, causing broken images. CID inline attachments are
   * the standard email-compatible way to embed images.
   *
   * The QR encodes ONLY the permanent participant_id (e.g. SVK26-ABC12345).
   * No email, phone, payment ID, event ID, or personal information.
   */
  let qrBuffer: Buffer | null = null;
  try {
    qrBuffer = await QRCode.toBuffer(participantId, {
      width: 500,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch (qrError) {
    console.error(
      "sendRegistrationEmail: QR buffer generation failed:",
      qrError
    );
  }

  // CID reference for HTML — renders the inline QR attachment
  // If QR generation failed, the participant ID text below serves as fallback
  const qrImgSrc = qrBuffer
    ? "cid:saviskar-entry-qr"
    : "";

  const safeEventName = escapeHtml(eventName);
  const safeCollege = escapeHtml(resolvedCollege);
  const safeTeam = escapeHtml(team);
  const safeCategory = escapeHtml(eventCategory);
  const safeParticipantId = escapeHtml(participantId);
  const isAccommodationOnly =
    eventCategory === "Accommodation" ||
    safeCategory.toLowerCase() === "accommodation" ||
    (!isTeamEvent && !team && (eventName.toLowerCase().includes("accommodation") || eventName.toLowerCase().includes("stay")));

  /*
   * Build the complete team list.
   * Leader is always Member 1.
   */
  const allTeamMembers: TeamMember[] = isTeamEvent
    ? [
        {
          participantId,
          name,
          college: resolvedCollege,
          email,
          phone,
          isTeamLeader:
            isTeamHead === true,
        },
        ...members,
      ]
    : [];

  /*
   * Every team member gets an individual email.
   * For a non-team event only the participant receives email.
   */
  const recipients = isTeamEvent
    ? [
        {
          participantId,
          name,
          college: resolvedCollege,
          email,
          phone,
          isTeamLeader: false,
          role: "Team Member",
        },
        ...members.map((member) => ({
          participantId: member.participantId,
          name: member.name,
          college: member.college || resolvedCollege,
          email: member.email,
          phone: member.phone,
          isTeamLeader: member.isTeamLeader,
          role: member.isTeamLeader
            ? "Team Head"
            : "Team Member",
        })),
      ]
    : [
        {
          participantId,
          name,
          college: resolvedCollege,
          email,
          phone,
          isTeamLeader: false,
          role: "Participant",
        },
      ];

  /*
   * Remove accidental duplicate email addresses.
   */
  const uniqueRecipients = recipients.filter(
    (recipient, index, array) =>
      array.findIndex(
        (item) =>
          item.email.trim().toLowerCase() ===
          recipient.email.trim().toLowerCase()
      ) === index
  );

  const results: Array<{
    email: string;
    emailId: string | null;
  }> = [];

  console.log(`[REGISTER EMAIL] uniqueRecipients count: ${uniqueRecipients.length}`);

  for (const recipient of uniqueRecipients) {
    const normalizedRecipient = recipient.email.trim().toLowerCase();
    if (guardActive && normalizedRecipient !== HARDCODED_PERMITTED_TEST_EMAIL) {
      console.warn(
        `[SAFEGUARD BLOCKED] Outbound email suppressed: recipient ${normalizedRecipient} does not match authorized test address.`
      );
      continue;
    }

    const destinationEmail = guardActive ? HARDCODED_PERMITTED_TEST_EMAIL : recipient.email.trim();
    console.log(`[REGISTER EMAIL] processing recipient: ${destinationEmail}`);
    const safeRecipientName = escapeHtml(recipient.name);
    const safeRecipientEmail = escapeHtml(recipient.email);
    const safeRecipientPhone = escapeHtml(recipient.phone);
    const safeRecipientParticipantId =
      escapeHtml(recipient.participantId);

    /*
     * Team member list shown inside EVERY team member's email.
     */
    const teamMembersHtml =
      isTeamEvent && allTeamMembers.length > 0
        ? `
            <div
              style="
                margin-top: 32px;
                border-top: 1px solid #eaeaea;
                padding-top: 28px;
              "
            >
              <div
                style="
                  font-size: 10px;
                  letter-spacing: 2px;
                  text-transform: uppercase;
                  color: #999999;
                  margin-bottom: 16px;
                "
              >
                Team Members
              </div>

              ${allTeamMembers
                .map((member, index) => {
                  const isCurrentRecipient =
                    member.email.trim().toLowerCase() ===
                    recipient.email.trim().toLowerCase();

                  return `
                      <div
                        style="
                          border: 1px solid ${
                            isCurrentRecipient ? "#111111" : "#eeeeee"
                          };
                          border-radius: 14px;
                          padding: 15px 17px;
                          margin-bottom: 10px;
                          background: ${
                            isCurrentRecipient ? "#fafafa" : "#ffffff"
                          };
                        "
                      >

                        <div
                          style="
                            font-size: 9px;
                            letter-spacing: 1.5px;
                            text-transform: uppercase;
                            color: #aaaaaa;
                            margin-bottom: 5px;
                          "
                        >
                          ${
                            member.isTeamLeader
                              ? `Member ${index + 1} · Team Head`
                              : `Member ${index + 1}`
                          }

                          ${
                            isCurrentRecipient
                              ? " · YOU"
                              : ""
                          }
                        </div>

                        <div
                          style="
                            font-size: 15px;
                            font-weight: 600;
                            color: #111111;
                          "
                        >
                          ${escapeHtml(member.name)}
                        </div>

                        <div
                          style="
                            font-size: 12px;
                            color: #777777;
                            margin-top: 4px;
                          "
                        >
                          ${escapeHtml(member.email)}
                        </div>

                        ${
                          member.phone
                            ? `
                              <div
                                style="
                                  font-size: 12px;
                                  color: #777777;
                                  margin-top: 3px;
                                "
                              >
                                ${escapeHtml(member.phone)}
                              </div>
                            `
                            : ""
                        }

                        <div
                          style="
                            margin-top: 8px;
                            font-family: monospace;
                            font-size: 11px;
                            color: #111111;
                            font-weight: 600;
                          "
                        >
                          ${escapeHtml(member.participantId)}
                        </div>

                      </div>
                    `;
                })
                .join("")}
            </div>
          `
        : "";

    const accommodationHtml =
      accommodationDetails && accommodationDetails.length > 0
        ? `
            <div
              style="
                margin-top: 32px;
                border-top: 1px solid #eaeaea;
                padding-top: 28px;
              "
            >
              <div
                style="
                  font-size: 10px;
                  letter-spacing: 2px;
                  text-transform: uppercase;
                  color: #999999;
                  margin-bottom: 16px;
                "
              >
                Accommodation Details
              </div>

              ${accommodationDetails
                .map((acc) => `
                  <div
                    style="
                      border: 1px solid #eeeeee;
                      border-radius: 14px;
                      padding: 15px 17px;
                      margin-bottom: 10px;
                      background: #fafafa;
                    "
                  >
                    <div
                      style="
                        font-size: 15px;
                        font-weight: 600;
                        color: #111111;
                      "
                    >
                      ${escapeHtml(acc.planName)}
                    </div>
                    <div
                      style="
                        font-size: 12px;
                        color: #555555;
                        margin-top: 4px;
                      "
                    >
                      <strong>Participant:</strong> ${escapeHtml(acc.participantName)}
                    </div>
                    <div
                      style="
                        font-size: 12px;
                        color: #555555;
                        margin-top: 2px;
                      "
                    >
                      <strong>Dates:</strong> ${escapeHtml(acc.dates)}
                    </div>
                    ${acc.durationDays ? `
                    <div
                      style="
                        font-size: 12px;
                        color: #555555;
                        margin-top: 2px;
                      "
                    >
                      <strong>Duration:</strong> ${acc.durationDays} ${acc.durationDays === 1 ? 'Day' : 'Days'}
                    </div>
                    ` : ""}
                    ${acc.checkoutDate ? `
                    <div
                      style="
                        font-size: 12px;
                        color: #555555;
                        margin-top: 2px;
                      "
                    >
                      <strong>Check-out:</strong> ${escapeHtml(acc.checkoutDate)}
                    </div>
                    ` : ""}
                    ${acc.orderReference ? `
                    <div
                      style="
                        font-size: 12px;
                        color: #555555;
                        margin-top: 2px;
                      "
                    >
                      <strong>Order Reference:</strong> ${escapeHtml(acc.orderReference)}
                    </div>
                    ` : ""}
                    ${acc.paymentId ? `
                    <div
                      style="
                        font-size: 12px;
                        color: #555555;
                        margin-top: 2px;
                      "
                    >
                      <strong>Payment ID:</strong> ${escapeHtml(acc.paymentId)}
                    </div>
                    ` : ""}
                    <div
                      style="
                        font-size: 12px;
                        color: #111111;
                        font-weight: 600;
                        margin-top: 4px;
                      "
                    >
                      <strong>Amount:</strong> ₹${acc.amount}
                    </div>
                  </div>
                `)
                .join("")}
            </div>
          `
        : "";

    const emailHtml = `
      <!DOCTYPE html>
      <html>

      <head>
        <meta charset="UTF-8" />

        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        />
      </head>

      <body
        style="
          margin: 0;
          padding: 0;
          background: #f3f3f3;
          font-family: Arial, Helvetica, sans-serif;
          color: #111111;
        "
      >

        <div
          style="
            width: 100%;
            background: #f3f3f3;
            padding: 40px 15px;
            box-sizing: border-box;
          "
        >

          <div
            style="
              max-width: 620px;
              margin: 0 auto;
              background: #ffffff;
              border-radius: 24px;
              overflow: hidden;
            "
          >

            <!-- BLACK HEADER -->

            <div
              style="
                background: #050505;
                color: #ffffff;
                padding: 42px 38px;
              "
            >

              <div
                style="
                  font-size: 10px;
                  letter-spacing: 3px;
                  text-transform: uppercase;
                  color: #888888;
                "
              >
                SAVISKAR 2026
              </div>

              <div
                style="
                  margin-top: 32px;
                  font-size: 11px;
                  letter-spacing: 2px;
                  text-transform: uppercase;
                  color: #777777;
                "
              >
                ${receiptPdf ? "Payment Confirmed" : "Registration Confirmed"}
              </div>

              <h1
                style="
                  margin: 10px 0 0;
                  font-size: 54px;
                  line-height: 1;
                  letter-spacing: -2px;
                  color: #ffffff;
                "
              >
                ${receiptPdf ? "Payment Successful." : "You're in."}
              </h1>

              <p
                style="
                  margin: 22px 0 0;
                  max-width: 440px;
                  font-size: 14px;
                  line-height: 1.7;
                  color: #999999;
                "
              >
                ${receiptPdf 
                  ? (isAccommodationOnly
                      ? `Your payment for campus accommodation (${safeEventName}) has been successfully received. Keep this email and present the QR code at the accommodation desk.`
                      : `Your payment for ${safeEventName} has been successfully received.`
                    )
                  : (isAccommodationOnly
                      ? `Your Saviskar 2026 accommodation request has been received. Keep this email available and present the QR code upon arrival.`
                      : `Your Saviskar 2026 registration has been confirmed. Keep this email available and present the QR code at entry.`
                    )
                }
              </p>

              ${!receiptPdf ? `
              <div style="margin-top: 20px; font-size: 14px; color: ${requiresPayment ? '#ff9999' : '#99ff99'}; font-weight: 600;">
                ${requiresPayment ? "Payment: Pending &mdash; Complete your payment to confirm your paid registration." : "Payment: No payment required."}
              </div>

              ${requiresPayment && paymentResumeUrl ? `
              <div style="margin-top: 26px; text-align: left;">
                <a
                  href="${escapeHtml(paymentResumeUrl)}"
                  target="_blank"
                  style="
                    display: inline-block;
                    background: #ffffff;
                    color: #000000;
                    text-decoration: none;
                    font-size: 12px;
                    font-weight: 700;
                    letter-spacing: 1.5px;
                    text-transform: uppercase;
                    padding: 14px 30px;
                    border-radius: 9999px;
                  "
                >
                  COMPLETE PAYMENT
                </a>
                <div style="margin-top: 10px; font-size: 12px; color: #999999;">
                  Your registration is saved, but payment is still pending.
                </div>
              </div>
              ` : ""}
              ` : ""}

            </div>

            <!-- DETAILS -->

            <div style="padding: 38px;">

              <div
                style="
                  font-size: 10px;
                  letter-spacing: 2px;
                  text-transform: uppercase;
                  color: #999999;
                "
              >
                ${isAccommodationOnly ? "Accommodation Plan" : "Event"}
              </div>

              <div
                style="
                  margin-top: 8px;
                  font-size: 28px;
                  font-weight: 700;
                "
              >
                ${safeEventName}
              </div>

              ${
                safeCategory
                  ? `
                    <div
                      style="
                        margin-top: 7px;
                        font-size: 13px;
                        color: #888888;
                        text-transform: capitalize;
                      "
                    >
                      ${isAccommodationOnly ? "Campus Stay Plan" : `${safeCategory} Event`}
                    </div>
                  `
                  : ""
              }

              <!-- RECIPIENT -->

              <div
                style="
                  margin-top: 32px;
                  border-top: 1px solid #eeeeee;
                  padding-top: 28px;
                "
              >

                <div
                  style="
                    font-size: 9px;
                    letter-spacing: 1.5px;
                    text-transform: uppercase;
                    color: #aaaaaa;
                  "
                >
                  ${
                    isTeamEvent
                      ? recipient.role
                      : "Participant"
                  }
                </div>

                <div
                  style="
                    margin-top: 6px;
                    font-size: 20px;
                    font-weight: 600;
                  "
                >
                  ${safeRecipientName}
                </div>

                <div
                  style="
                    margin-top: 5px;
                    font-size: 13px;
                    color: #777777;
                  "
                >
                  ${safeRecipientEmail}
                </div>

                ${
                  safeRecipientPhone
                    ? `
                      <div
                        style="
                          margin-top: 5px;
                          font-size: 13px;
                          color: #777777;
                        "
                      >
                        ${safeRecipientPhone}
                      </div>
                    `
                    : ""
                }

                <div
                  style="
                    margin-top: 10px;
                    font-family: monospace;
                    font-size: 13px;
                    font-weight: 700;
                    color: #111111;
                  "
                >
                  Participant ID: ${safeRecipientParticipantId}
                </div>

              </div>

              <!-- TEAM -->

              ${
                safeTeam
                  ? `
                    <div
                      style="
                        margin-top: 26px;
                        padding-top: 24px;
                        border-top: 1px solid #eeeeee;
                      "
                    >

                      <div
                        style="
                          font-size: 9px;
                          letter-spacing: 1.5px;
                          text-transform: uppercase;
                          color: #aaaaaa;
                        "
                      >
                        Team
                      </div>

                      <div
                        style="
                          margin-top: 6px;
                          font-size: 16px;
                          font-weight: 600;
                        "
                      >
                        ${safeTeam}
                      </div>

                    </div>
                  `
                  : ""
              }

              <!-- COLLEGE -->

              <div
                style="
                  margin-top: 26px;
                  padding-top: 24px;
                  border-top: 1px solid #eeeeee;
                "
              >

                <div
                  style="
                    font-size: 9px;
                    letter-spacing: 1.5px;
                    text-transform: uppercase;
                    color: #aaaaaa;
                  "
                >
                  ${isAccommodationOnly ? "Institution / Organization" : "College / University"}
                </div>

                <div
                  style="
                    margin-top: 6px;
                    font-size: 15px;
                  "
                >
                  ${safeCollege}
                </div>

              </div>

              ${teamMembersHtml}

              ${accommodationHtml}

              ${requiresPayment && paymentResumeUrl && !receiptPdf ? `
              <div
                style="
                  margin-top: 32px;
                  border: 1px solid #ffcccc;
                  background: #fff8f8;
                  border-radius: 18px;
                  padding: 24px 20px;
                  text-align: center;
                "
              >
                <div
                  style="
                    font-size: 11px;
                    letter-spacing: 2px;
                    text-transform: uppercase;
                    color: #d32f2f;
                    font-weight: 700;
                    margin-bottom: 8px;
                  "
                >
                  Payment Pending
                </div>
                <p
                  style="
                    margin: 0 0 18px;
                    font-size: 13px;
                    line-height: 1.6;
                    color: #555555;
                  "
                >
                  Click below to complete your payment with PayU and confirm your participation.
                </p>
                <a
                  href="${escapeHtml(paymentResumeUrl)}"
                  target="_blank"
                  style="
                    display: inline-block;
                    background: #000000;
                    color: #ffffff;
                    text-decoration: none;
                    font-size: 12px;
                    font-weight: 700;
                    letter-spacing: 1.5px;
                    text-transform: uppercase;
                    padding: 14px 30px;
                    border-radius: 9999px;
                  "
                >
                  COMPLETE PAYMENT
                </a>
              </div>
              ` : ""}

              <!-- QR -->
              ${!(requiresPayment && !receiptPdf) ? `
              <div
                style="
                  margin-top: 34px;
                  background: #050505;
                  border-radius: 20px;
                  padding: 34px 20px;
                  text-align: center;
                "
              >

                <div
                  style="
                    font-size: 10px;
                    letter-spacing: 2px;
                    text-transform: uppercase;
                    color: #777777;
                  "
                >
                  Entry QR
                </div>

                <div
                  style="
                    margin: 22px auto 0;
                    background: #ffffff;
                    border-radius: 18px;
                    padding: 15px;
                    width: 230px;
                    box-sizing: border-box;
                  "
                >

                  ${qrImgSrc ? `
                    <img
                      src="${qrImgSrc}"
                      width="200"
                      height="200"
                      alt="Saviskar Entry QR"
                      style="
                        display: block;
                        width: 200px;
                        height: 200px;
                      "
                    />
                  ` : `
                    <div
                      style="
                        width: 200px;
                        height: 60px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-family: monospace;
                        font-size: 16px;
                        font-weight: 700;
                        color: #111111;
                      "
                    >
                      ${safeParticipantId}
                    </div>
                  `}

                </div>

                <div
                  style="
                    margin-top: 20px;
                    font-size: 10px;
                    letter-spacing: 2px;
                    text-transform: uppercase;
                    color: #888888;
                  "
                >
                  Present at entry
                </div>

                <div
                  style="
                    margin-top: 18px;
                    font-family: monospace;
                    font-size: 10px;
                    color: #666666;
                    word-break: break-all;
                  "
                >
                  ${safeParticipantId}
                </div>

              </div>
              ` : ""}

              <!-- FOOTER -->

              <div
                style="
                  margin-top: 30px;
                  text-align: center;
                  font-size: 11px;
                  line-height: 1.6;
                  color: #999999;
                "
              >

                ${
                  isTeamEvent
                    ? "One QR represents the complete registered team."
                    : "This QR is unique to your registration."
                }

                <br />

                Keep this email available on your phone
                for verification at the venue.
                
                ${
                  receiptPdf
                    ? `<br /><br />Your payment receipt is attached to this email.`
                    : ""
                }

              </div>

            </div>

          </div>

          <div
            style="
              max-width: 620px;
              margin: 20px auto 0;
              text-align: center;
              font-size: 10px;
              color: #aaaaaa;
            "
          >
            SAVISKAR 2026 · OFFICIAL REGISTRATION
          </div>

        </div>

      </body>
      </html>
    `;

    try {
      if (guardActive) {
        if (
          (process.env.APPROVED_TEST_EMAIL || "").trim().toLowerCase() !== HARDCODED_PERMITTED_TEST_EMAIL ||
          normalizedRecipient !== HARDCODED_PERMITTED_TEST_EMAIL
        ) {
          console.warn("[SAFEGUARD BLOCKED] Outbound send aborted immediately before Resend SDK call.");
          continue;
        }
      }

      console.log(`[REGISTER EMAIL] about to call Resend.emails.send() for recipient: ${destinationEmail}`);
      const subjectLine = receiptPdf 
        ? `Payment Confirmed — Saviskar 2026 | Receipt ${recipient.participantId}`
        : `You're Registered — Saviskar 2026 | ${recipient.participantId}`;

      const attachments = (qrBuffer || receiptPdf)
        ? [
            ...(qrBuffer
              ? [
                  {
                    filename: "qr.png",
                    content: qrBuffer,
                    contentId: "saviskar-entry-qr",
                    contentType: "image/png",
                  },
                ]
              : []),
            ...(receiptPdf
              ? [
                  {
                    filename: receiptPdf.filename,
                    content: receiptPdf.buffer,
                    contentType: "application/pdf",
                  },
                ]
              : []),
          ]
        : undefined;

      if (testTransportActive) {
        console.log(`[REGISTER EMAIL] Dispatching via test transport (Mailpit) to: ${destinationEmail}`);
        const testRes = await sendViaTestTransport({
          from: fromEmail,
          to: destinationEmail,
          subject: subjectLine,
          html: emailHtml,
          attachments: (qrBuffer || receiptPdf)
            ? [
                ...(qrBuffer
                  ? [
                      {
                        filename: "qr.png",
                        content: qrBuffer,
                        contentType: "image/png",
                      },
                    ]
                  : []),
                ...(receiptPdf
                  ? [
                      {
                        filename: receiptPdf.filename,
                        content: receiptPdf.buffer,
                        contentType: "application/pdf",
                      },
                    ]
                  : []),
              ]
            : undefined,
        });

        if (testRes.success) {
          results.push({
            email: destinationEmail,
            emailId: testRes.messageId || null,
          });
          continue;
        } else {
          console.error(`[REGISTER EMAIL] Test transport error: ${testRes.error}`);
          continue;
        }
      }

      if (!resend) {
        console.error("[REGISTER EMAIL] Resend client is not initialized.");
        continue;
      }

      const recipientIdempKey = data.idempotencyKey
        ? `${data.idempotencyKey}_${recipient.participantId}`
        : undefined;

      let { data: resData, error: resError } = await resend.emails.send(
        {
          from: fromEmail,
          to: [destinationEmail],
          subject: subjectLine,
          html: emailHtml,
          headers: recipientIdempKey ? { "X-Entity-Ref-ID": recipientIdempKey } : undefined,
          ...(attachments ? { attachments } : {}),
        },
        recipientIdempKey ? ({ idempotencyKey: recipientIdempKey } as any) : undefined
      );

      if (resError && (resError as { statusCode?: number; message?: string }).statusCode === 403 && String((resError as { message?: string }).message || "").includes("domain is not verified")) {
        if (guardActive) {
          if (
            (process.env.APPROVED_TEST_EMAIL || "").trim().toLowerCase() !== HARDCODED_PERMITTED_TEST_EMAIL ||
            normalizedRecipient !== HARDCODED_PERMITTED_TEST_EMAIL
          ) {
            console.warn("[SAFEGUARD BLOCKED] Outbound retry aborted immediately before Resend SDK call.");
            continue;
          }
        }

        console.warn(`[REGISTER EMAIL] Domain not verified in Resend. Retrying with onboarding fallback...`);
        const fallbackRes = await resend.emails.send(
          {
            from: "Saviskar 2026 <onboarding@resend.dev>",
            to: [destinationEmail],
            subject: subjectLine,
            html: emailHtml,
            headers: recipientIdempKey ? { "X-Entity-Ref-ID": recipientIdempKey } : undefined,
            ...(attachments ? { attachments } : {}),
          },
          recipientIdempKey ? ({ idempotencyKey: recipientIdempKey } as any) : undefined
        );
        resData = fallbackRes.data;
        resError = fallbackRes.error;
      }

      if (resError) {
        console.error(
          `[REGISTER EMAIL] RESEND ERROR for ${recipient.email}:`,
          resError
        );

        /*
         * Log but continue — don't fail the whole batch
         * because one recipient had an issue.
         */
        continue;
      } else {
        console.log(`[REGISTER EMAIL] Resend response received successfully for: ${recipient.email}`);
        results.push({
          email: recipient.email,
          emailId: resData?.id || null,
        });
      }
    } catch (err) {
      console.error(
        `[REGISTER EMAIL] UNCAUGHT ERROR during email loop for ${recipient.email}:`,
        err
      );
    }
  }

  console.log(`[REGISTER EMAIL] send completed successfully. Sent: ${results.length}`);
  return {
    success: results.length > 0,
    emailsSent: results.length,
    recipients: results,
  };
}