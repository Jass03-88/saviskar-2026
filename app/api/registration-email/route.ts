import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

const resend = new Resend(process.env.RESEND_API_KEY);

type RegistrationEmailBody = {
  registrationId?: unknown;
};

type TeamMember = {
  name: string;
  email: string;
  phone?: string | null;
};

type RegistrationRow = {
  id: string;
  event_id: string;
  name: string;
  college: string;
  email: string;
  phone: string | null;
  team: string | null;
  confirmation_email_sent_at: string | null;
  confirmation_email_sending_at: string | null;
};

type EventRow = {
  id: string;
  name: string;
  category: string | null;
  registration_type: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_BODY_BYTES = 8 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 6;
const EMAIL_LOCK_TTL_MS = 5 * 60_000;

type RateEntry = { count: number; resetAt: number };
const rateLimitStore = new Map<string, RateEntry>();

function getClientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function checkRateLimit(ip: string) {
  const now = Date.now();

  if (rateLimitStore.size > 1000) {
    for (const [key, value] of rateLimitStore) {
      if (value.resetAt <= now) rateLimitStore.delete(key);
    }
  }

  const current = rateLimitStore.get(ip);

  if (!current || current.resetAt <= now) {
    rateLimitStore.set(ip, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return { allowed: true, retryAfter: 0 };
  }

  if (current.count >= RATE_LIMIT_MAX) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  return { allowed: true, retryAfter: 0 };
}

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
    const ip = getClientIp(request);
    const rate = checkRateLimit(ip);

    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many email requests. Please try again shortly." },
        {
          status: 429,
          headers: { "Retry-After": String(rate.retryAfter) },
        }
      );
    }

    const contentLength = request.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
      return NextResponse.json(
        { success: false, error: "Request body is too large." },
        { status: 413 }
      );
    }
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

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

    if (!supabaseUrl || !supabaseSecretKey) {
      console.error(
        "NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY is missing."
      );

      return NextResponse.json(
        {
          success: false,
          error: "Server database access is not configured.",
        },
        { status: 500 }
      );
    }

    const rawBody = await request.text();

    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { success: false, error: "Request body is too large." },
        { status: 413 }
      );
    }

    let body: RegistrationEmailBody;

    try {
      body = JSON.parse(rawBody) as RegistrationEmailBody;
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON request." },
        { status: 400 }
      );
    }

    const registrationId =
      typeof body.registrationId === "string"
        ? body.registrationId.trim()
        : "";

    if (!registrationId || !UUID_PATTERN.test(registrationId)) {
      return NextResponse.json(
        {
          success: false,
          error: "A valid registration ID is required.",
        },
        { status: 400 }
      );
    }

    /*
     * IMPORTANT:
     * This client exists only inside this server route.
     * SUPABASE_SECRET_KEY bypasses RLS and must never be exposed
     * to client-side code or use a NEXT_PUBLIC_ prefix.
     */
    const supabaseAdmin = createClient(
      supabaseUrl,
      supabaseSecretKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    );

    /*
     * Fetch the authoritative registration from the database.
     * The browser is NOT trusted for name/email/event/team details.
     */
    const {
      data: registrationData,
      error: registrationError,
    } = await supabaseAdmin
      .from("registrations")
      .select(
        "id, event_id, name, college, email, phone, team, confirmation_email_sent_at, confirmation_email_sending_at"
      )
      .eq("id", registrationId)
      .maybeSingle();

    if (registrationError) {
      console.error(
        "Registration lookup failed:",
        registrationError
      );

      return NextResponse.json(
        {
          success: false,
          error: "Could not verify the registration.",
        },
        { status: 500 }
      );
    }

    if (!registrationData) {
      return NextResponse.json(
        {
          success: false,
          error: "Registration not found.",
        },
        { status: 404 }
      );
    }

    const registration = registrationData as RegistrationRow;

    // Permanent duplicate-email protection.
    if (registration.confirmation_email_sent_at) {
      console.log(
        "Confirmation email already sent; skipping duplicate:",
        registrationId,
        registration.confirmation_email_sent_at
      );

      return NextResponse.json({
        success: true,
        alreadySent: true,
        sentAt: registration.confirmation_email_sent_at,
        emailId: null,
      });
    }

    const sendingAt = registration.confirmation_email_sending_at;
    const sendingIsFresh =
      !!sendingAt &&
      Date.now() - new Date(sendingAt).getTime() < EMAIL_LOCK_TTL_MS;

    if (sendingIsFresh) {
      return NextResponse.json(
        {
          success: false,
          error: "Confirmation email is already being processed.",
        },
        { status: 409 }
      );
    }

    // Claim this send before contacting Resend. The conditional filters ensure
    // only a row that is still unsent and not actively locked can be claimed.
    const lockCutoff = new Date(Date.now() - EMAIL_LOCK_TTL_MS).toISOString();
    const claimTime = new Date().toISOString();

    let claimQuery = supabaseAdmin
      .from("registrations")
      .update({ confirmation_email_sending_at: claimTime })
      .eq("id", registrationId)
      .is("confirmation_email_sent_at", null);

    if (sendingAt) {
      claimQuery = claimQuery.lt("confirmation_email_sending_at", lockCutoff);
    } else {
      claimQuery = claimQuery.is("confirmation_email_sending_at", null);
    }

    const { data: claimedRows, error: claimError } = await claimQuery
      .select("id")
      .limit(1);

    if (claimError) {
      console.error("Could not claim confirmation email send:", claimError);
      return NextResponse.json(
        { success: false, error: "Could not prepare confirmation email." },
        { status: 500 }
      );
    }

    if (!claimedRows || claimedRows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Confirmation email is already being processed or has been sent.",
        },
        { status: 409 }
      );
    }

    const releaseEmailLock = async () => {
      const { error: releaseError } = await supabaseAdmin
        .from("registrations")
        .update({ confirmation_email_sending_at: null })
        .eq("id", registrationId)
        .eq("confirmation_email_sending_at", claimTime)
        .is("confirmation_email_sent_at", null);

      if (releaseError) {
        console.error("Could not release confirmation email lock:", releaseError);
      }
    };

    const {
      data: eventData,
      error: eventError,
    } = await supabaseAdmin
      .from("events")
      .select("id, name, category, registration_type")
      .eq("id", registration.event_id)
      .maybeSingle();

    if (eventError) {
      console.error("Event lookup failed:", eventError);

      await releaseEmailLock();

      return NextResponse.json(
        {
          success: false,
          error: "Could not load the registered event.",
        },
        { status: 500 }
      );
    }

    if (!eventData) {
      await releaseEmailLock();

      return NextResponse.json(
        {
          success: false,
          error: "Registered event not found.",
        },
        { status: 404 }
      );
    }

    const selectedEvent = eventData as EventRow;
    const isTeamEvent =
      selectedEvent.registration_type
        ?.toLowerCase()
        .trim() === "team";

    let members: TeamMember[] = [];

    if (isTeamEvent) {
      const {
        data: memberData,
        error: memberError,
      } = await supabaseAdmin
        .from("registration_members")
        .select("name, email, phone")
        .eq("registration_id", registrationId);

      if (memberError) {
        console.error(
          "Registration member lookup failed:",
          memberError
        );

        await releaseEmailLock();

      return NextResponse.json(
          {
            success: false,
            error: "Could not load the registered team.",
          },
          { status: 500 }
        );
      }

      members = (memberData ?? []) as TeamMember[];
    }

    const eventName = selectedEvent.name;
    const eventCategory = selectedEvent.category;
    const name = registration.name;
    const college = registration.college;
    const email = registration.email;
    const phone = registration.phone ?? "";
    const team = registration.team;

    if (!eventName || !name || !college || !email) {
      console.error(
        "Verified registration is missing required email fields:",
        registrationId
      );

      await releaseEmailLock();

      return NextResponse.json(
        {
          success: false,
          error: "Registration data is incomplete.",
        },
        { status: 500 }
      );
    }

    /*
     * IMPORTANT:
     * Your scanner currently reads the registration UUID
     * directly from the QR code.
     *
     * Therefore the QR generated in this email contains ONLY:
     *
     * registrationId
     *
     * Do not change this to a URL unless the scanner is also
     * changed later.
     */
    const qrUrl =
      "https://api.qrserver.com/v1/create-qr-code/?" +
      new URLSearchParams({
        size: "500x500",
        data: registrationId,
        margin: "10",
      }).toString();

    const safeName = escapeHtml(name);
    const safeEventName = escapeHtml(eventName);
    const safeCollege = escapeHtml(college);
    const safeEmail = escapeHtml(email);
    const safePhone = escapeHtml(phone);
    const safeTeam = escapeHtml(team);
    const safeCategory = escapeHtml(eventCategory);
    const safeRegistrationId = escapeHtml(registrationId);

    const teamMembersHtml =
      isTeamEvent && members.length > 0
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

            ${members
              .map(
                (member, index) => `
                  <div
                    style="
                      border: 1px solid #eeeeee;
                      border-radius: 14px;
                      padding: 15px 17px;
                      margin-bottom: 10px;
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
                      Member ${index + 2}
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
                  </div>
                `
              )
              .join("")}
          </div>
        `
        : "";

    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,

      to: [email],

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

                  <div
                    style="
                      margin-top: 32px;
                      border-top: 1px solid #eeeeee;
                      padding-top: 28px;
                    "
                  >

                    ${
                      isTeamEvent
                        ? `
                          <div style="margin-bottom: 22px;">
                            <div
                              style="
                                font-size: 9px;
                                letter-spacing: 1.5px;
                                text-transform: uppercase;
                                color: #aaaaaa;
                              "
                            >
                              Team Leader
                            </div>

                            <div
                              style="
                                margin-top: 6px;
                                font-size: 16px;
                                font-weight: 600;
                              "
                            >
                              ${safeName}
                            </div>
                          </div>
                        `
                        : `
                          <div style="margin-bottom: 22px;">
                            <div
                              style="
                                font-size: 9px;
                                letter-spacing: 1.5px;
                                text-transform: uppercase;
                                color: #aaaaaa;
                              "
                            >
                              Participant
                            </div>

                            <div
                              style="
                                margin-top: 6px;
                                font-size: 16px;
                                font-weight: 600;
                              "
                            >
                              ${safeName}
                            </div>
                          </div>
                        `
                    }

                    ${
                      safeTeam
                        ? `
                          <div style="margin-bottom: 22px;">
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

                    <div style="margin-bottom: 22px;">
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

                    <div style="margin-bottom: 22px;">
                      <div
                        style="
                          font-size: 9px;
                          letter-spacing: 1.5px;
                          text-transform: uppercase;
                          color: #aaaaaa;
                        "
                      >
                        Email
                      </div>

                      <div
                        style="
                          margin-top: 6px;
                          font-size: 15px;
                        "
                      >
                        ${safeEmail}
                      </div>
                    </div>

                    ${
                      safePhone
                        ? `
                          <div>
                            <div
                              style="
                                font-size: 9px;
                                letter-spacing: 1.5px;
                                text-transform: uppercase;
                                color: #aaaaaa;
                              "
                            >
                              Phone
                            </div>

                            <div
                              style="
                                margin-top: 6px;
                                font-size: 15px;
                              "
                            >
                              ${safePhone}
                            </div>
                          </div>
                        `
                        : ""
                    }

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
    }, {
      idempotencyKey: `saviskar-registration-confirmation/${registrationId}`,
    });

    if (error) {
      console.error("RESEND FULL ERROR:", error);
      await releaseEmailLock();

      return NextResponse.json(
        {
          success: false,
          error: "Confirmation email could not be sent.",
        },
        { status: 502 }
      );
    }

    // Resend accepted the email. Save a permanent duplicate-send marker.
    const sentAt = new Date().toISOString();

    const { error: sentAtError } = await supabaseAdmin
      .from("registrations")
      .update({
        confirmation_email_sent_at: sentAt,
        confirmation_email_sending_at: null,
      })
      .eq("id", registrationId)
      .eq("confirmation_email_sending_at", claimTime)
      .is("confirmation_email_sent_at", null);

    if (sentAtError) {
      // The email was already accepted by Resend, so do not report it as failed.
      console.error(
        "Email sent, but confirmation_email_sent_at could not be saved:",
        sentAtError
      );

      return NextResponse.json({
        success: true,
        alreadySent: false,
        emailId: data?.id ?? null,
        sentAt: null,
        warning:
          "Email sent, but the permanent duplicate-send marker could not be saved.",
      });
    }

    console.log(
      "Confirmation email sent and permanently marked:",
      registrationId,
      sentAt
    );

    return NextResponse.json({
      success: true,
      alreadySent: false,
      emailId: data?.id ?? null,
      sentAt,
    });
  } catch (error) {
    console.error("Registration email API error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Unexpected email service error.",
      },
      { status: 500 }
    );
  }
}