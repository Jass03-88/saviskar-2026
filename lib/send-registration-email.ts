import { Resend } from "resend";
import QRCode from "qrcode";

export type TeamMember = {
  participantId: string;
  name: string;
  college?: string;
  email: string;
  phone?: string;
  isTeamLeader?: boolean;
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
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!apiKey) {
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

  const {
    registrationId,
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
  } = data;

  if (
    !participantId ||
    !eventName ||
    !name ||
    !college ||
    !email
  ) {
    return {
      success: false,
      emailsSent: 0,
      recipients: [],
      error: "Missing required registration information.",
    };
  }

  const resend = new Resend(apiKey);

  /*
   * Generate QR code as a base64 data URI server-side.
   * This avoids depending on an external API (api.qrserver.com)
   * which could be down or rate-limited during registration spikes.
   */
  let qrUrl: string;
  try {
    qrUrl = await QRCode.toDataURL(participantId, {
      width: 500,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch {
    // Fallback to external API if local generation fails
    qrUrl =
      "https://api.qrserver.com/v1/create-qr-code/?" +
      new URLSearchParams({
        size: "500x500",
        data: participantId,
        margin: "10",
      }).toString();
  }

  const safeEventName = escapeHtml(eventName);
  const safeCollege = escapeHtml(college);
  const safeTeam = escapeHtml(team);
  const safeCategory = escapeHtml(eventCategory);
  const safeParticipantId = escapeHtml(participantId);

  /*
   * Build the complete team list.
   * Leader is always Member 1.
   */
  const allTeamMembers: TeamMember[] = isTeamEvent
    ? [
        {
          participantId,
          name,
          college,
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
          college,
          email,
          phone,
          isTeamLeader: false,
          role: "Team Member",
        },
        ...members.map((member) => ({
          participantId: member.participantId,
          name: member.name,
          college: member.college,
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
          college,
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

  for (const recipient of uniqueRecipients) {
    const safeRecipientName = escapeHtml(recipient.name);
    const safeRecipientEmail = escapeHtml(recipient.email);
    const safeRecipientPhone = escapeHtml(recipient.phone);
    const safeRecipientParticipantId =
      escapeHtml(recipient.participantId);
    const safeRecipientCollege =
      escapeHtml(recipient.college);

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
                Registration Confirmed
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
                You're in.
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
                Your Saviskar 2026 registration has been
                confirmed. Keep this email available and
                present the QR code at entry.
              </p>

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
                Event
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
                      ${safeCategory} Event
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
                  College / University
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

              <!-- QR -->

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

                  <img
                    src="${qrUrl}"
                    width="200"
                    height="200"
                    alt="Saviskar Entry QR"
                    style="
                      display: block;
                      width: 200px;
                      height: 200px;
                    "
                  />

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
      const { data, error } = await resend.emails.send({
        from: fromEmail,
        to: [recipient.email],
        subject: `You're in — ${eventName} | Saviskar 2026`,
        html: emailHtml,
      });

      if (error) {
        console.error(
          `sendRegistrationEmail: RESEND ERROR for ${recipient.email}:`,
          error
        );

        /*
         * Log but continue — don't fail the whole batch
         * because one recipient had an issue.
         */
        continue;
      }

      results.push({
        email: recipient.email,
        emailId: data?.id ?? null,
      });
    } catch (sendError) {
      console.error(
        `sendRegistrationEmail: Exception sending to ${recipient.email}:`,
        sendError
      );
    }
  }

  return {
    success: results.length > 0,
    emailsSent: results.length,
    recipients: results,
  };
}