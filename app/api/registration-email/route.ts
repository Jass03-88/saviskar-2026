import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

type TeamMember = {
  name: string;
  email: string;
  phone?: string;
};

type RegistrationEmailBody = {
  registrationId: string;
  eventName: string;
  eventCategory?: string | null;

  name: string;
  college: string;
  email: string;
  phone?: string;

  team?: string | null;
  isTeamEvent?: boolean;
  members?: TeamMember[];
};

function escapeHtml(value: string | null | undefined) {
  if (!value) return "";

  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function POST(request: NextRequest) {
  try {
    if (!process.env.RESEND_API_KEY) {
      console.error("RESEND_API_KEY is missing.");

      return NextResponse.json(
        {
          success: false,
          error: "Email service is not configured.",
        },
        { status: 500 }
      );
    }

    if (!process.env.RESEND_FROM_EMAIL) {
      console.error("RESEND_FROM_EMAIL is missing.");

      return NextResponse.json(
        {
          success: false,
          error: "Sender email is not configured.",
        },
        { status: 500 }
      );
    }

    const body = (await request.json()) as RegistrationEmailBody;

    const {
      registrationId,
      eventName,
      eventCategory,
      name,
      college,
      email,
      phone,
      team,
      isTeamEvent = false,
      members = [],
    } = body;

    if (
      !registrationId ||
      !eventName ||
      !name ||
      !college ||
      !email
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required registration information.",
        },
        { status: 400 }
      );
    }

    /*
     * IMPORTANT
     *
     * The scanner reads the registration UUID directly
     * from the QR code.
     *
     * Therefore the QR contains ONLY registrationId.
     */
    const qrUrl =
      "https://api.qrserver.com/v1/create-qr-code/?" +
      new URLSearchParams({
        size: "500x500",
        data: registrationId,
        margin: "10",
      }).toString();

    const safeEventName = escapeHtml(eventName);
    const safeCollege = escapeHtml(college);
    const safeTeam = escapeHtml(team);
    const safeCategory = escapeHtml(eventCategory);
    const safeRegistrationId = escapeHtml(registrationId);

    /*
     * Build the complete team list.
     *
     * Leader is always Member 1.
     * Additional members come from members[].
     */
    const allTeamMembers: TeamMember[] = isTeamEvent
      ? [
          {
            name,
            email,
            phone,
          },
          ...members,
        ]
      : [];

    /*
     * Every team member gets an individual email.
     *
     * The leader is always included.
     * For a non-team event only the participant receives email.
     */
    const recipients = isTeamEvent
      ? [
          {
            name,
            email,
            phone,
            role: "Team Leader",
          },
          ...members.map((member) => ({
            name: member.name,
            email: member.email,
            phone: member.phone,
            role: "Team Member",
          })),
        ]
      : [
          {
            name,
            email,
            phone,
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

    const results = [];

    /*
     * Send a separate personalized email to every recipient.
     */
    for (const recipient of uniqueRecipients) {
      const safeRecipientName = escapeHtml(recipient.name);
      const safeRecipientEmail = escapeHtml(recipient.email);
      const safeRecipientPhone = escapeHtml(recipient.phone);

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
                .map(
                  (member, index) => {
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
                            index === 0
                              ? "Member 1 · Team Leader"
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

                      </div>
                    `;
                  }
                )
                .join("")}
            </div>
          `
          : "";

      const { data, error } = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL,
        to: [recipient.email],

        subject: `You're in — ${eventName} | Saviskar 2026`,

        html: `
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
                      ${safeRegistrationId}
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
        `,
      });

      if (error) {
        console.error(
          `RESEND ERROR FOR ${recipient.email}:`,
          error
        );

        return NextResponse.json(
          {
            success: false,
            error:
              error.message ||
              `Failed to send email to ${recipient.email}.`,
            failedRecipient: recipient.email,
          },
          { status: 500 }
        );
      }

      results.push({
        email: recipient.email,
        emailId: data?.id ?? null,
      });
    }

    /*
     * Everything succeeded.
     */
    return NextResponse.json({
      success: true,
      emailsSent: results.length,
      recipients: results,
    });
  } catch (error) {
    console.error(
      "Registration email API error:",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unexpected email service error.";

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}