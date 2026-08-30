import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendRegistrationEmail } from "@/lib/send-registration-email";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

type MemberInput = {
  name?: unknown;
  college?: unknown;
  email?: unknown;
  phone?: unknown;
};

type EventRegistrationInput = {
  eventId?: unknown;
  team?: unknown;
  isTeamHead?: unknown;
  members?: unknown;
};

type RegistrationInput = {
  participantId?: unknown;

  name?: unknown;
  college?: unknown;
  email?: unknown;
  phone?: unknown;

  events?: unknown;

  // Legacy single-event compatibility
  eventId?: unknown;
  team?: unknown;
  members?: unknown;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PARTICIPANT_ID_PATTERN =
  /^SVK26-[A-Z0-9]{8}$/i;

const EMAIL_PATTERN =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_REQUEST_BYTES = 48_000;

function cleanString(
  value: unknown,
  maxLength: number
) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

function cleanEmail(value: unknown) {
  return cleanString(value, 254).toLowerCase();
}

function cleanPhone(value: unknown) {
  return cleanString(value, 30);
}

function errorResponse(
  message: string,
  status: number
) {
  return NextResponse.json(
    {
      success: false,
      error: message,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

function rateLimitResponse(
  retryAfter: number
) {
  return NextResponse.json(
    {
      success: false,
      error:
        "Too many registration attempts. Please wait a moment and try again.",
    },
    {
      status: 429,
      headers: {
        "Retry-After":
          String(retryAfter),
        "Cache-Control":
          "no-store",
      },
    }
  );
}

function normalizeMembers(
  raw: unknown
) {
  const rawMembers =
    Array.isArray(raw)
      ? raw
      : [];

  if (rawMembers.length > 50) {
    throw new Error(
      "Too many team members were submitted."
    );
  }

  return rawMembers.map(
    (rawMember, index) => {
      const member =
        (rawMember ??
          {}) as MemberInput;

      return {
        name: cleanString(member.name, 120),
        college: cleanString(member.college, 180),
        email: cleanEmail(member.email),
        phone: cleanPhone(member.phone),
        index,
      };
    }
  );
}

export async function POST(
  request: NextRequest
) {
  // =====================================================
  // 1. RATE LIMIT
  // =====================================================

  const clientIp =
    getClientIp(request);

  const rateLimit =
    checkRateLimit(
      `register:${clientIp}`
    );

  if (!rateLimit.allowed) {
    return rateLimitResponse(
      rateLimit.retryAfter
    );
  }

  // =====================================================
  // 2. REQUEST SIZE
  // =====================================================

  const contentLength =
    request.headers.get(
      "content-length"
    );

  if (contentLength) {
    const parsedLength =
      Number(contentLength);

    if (
      Number.isFinite(
        parsedLength
      ) &&
      parsedLength >
      MAX_REQUEST_BYTES
    ) {
      return errorResponse(
        "Registration request is too large.",
        413
      );
    }
  }

  // =====================================================
  // 3. SUPABASE SERVER CONFIG
  // =====================================================

  const supabaseUrl =
    process.env
      .NEXT_PUBLIC_SUPABASE_URL;

  const supabaseSecretKey =
    process.env
      .SUPABASE_SECRET_KEY;

  if (
    !supabaseUrl ||
    !supabaseSecretKey
  ) {
    console.error(
      "Registration API is missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY."
    );

    return errorResponse(
      "Registration service is not configured.",
      500
    );
  }

  const supabaseAdmin =
    createClient(
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

  // =====================================================
  // 4. PARSE REQUEST
  // =====================================================

  let body: RegistrationInput;

  try {
    const rawBody =
      await request.text();

    if (
      new TextEncoder()
        .encode(rawBody)
        .byteLength >
      MAX_REQUEST_BYTES
    ) {
      return errorResponse(
        "Registration request is too large.",
        413
      );
    }

    body =
      JSON.parse(
        rawBody
      ) as RegistrationInput;
  } catch {
    return errorResponse(
      "Invalid registration request.",
      400
    );
  }

  // =====================================================
  // 5. PARTICIPANT ID
  // =====================================================

  const participantId =
    cleanString(
      body.participantId,
      40
    ).toUpperCase();

  if (
    participantId &&
    !PARTICIPANT_ID_PATTERN.test(
      participantId
    )
  ) {
    return errorResponse(
      "Invalid Participant ID.",
      400
    );
  }

  // =====================================================
  // 6. PERSONAL INFORMATION
  // =====================================================

  const name =
    cleanString(
      body.name,
      120
    );

  const college =
    cleanString(
      body.college,
      180
    );

  const email =
    cleanEmail(
      body.email
    );

  const phone =
    cleanPhone(
      body.phone
    );

  /*
   * New participant:
   * all personal details are required.
   *
   * Existing participant:
   * Participant ID identifies the person.
   * We also require their email as an additional verification layer.
   * The supplied personal details are still passed
   * to the database function for compatibility.
   */
  if (!participantId) {
    if (
      !name ||
      !college ||
      !email ||
      !phone
    ) {
      return errorResponse(
        "Please complete your name, college, email and phone number.",
        400
      );
    }
  } else {
    if (!email) {
      return errorResponse(
        "Please confirm your email address.",
        400
      );
    }
  }

  if (
    !EMAIL_PATTERN.test(
      email
    )
  ) {
    return errorResponse(
      "Please enter a valid email address.",
      400
    );
  }

  // =====================================================
  // 7. BUILD EVENT LIST
  // =====================================================

  let rawEvents: unknown[];

  if (
    Array.isArray(
      body.events
    )
  ) {
    rawEvents =
      body.events;
  } else if (
    body.eventId
  ) {
    /*
     * Legacy single-event request.
     */
    rawEvents = [
      {
        eventId:
          body.eventId,

        team:
          body.team,

        members:
          body.members,
      },
    ];
  } else {
    rawEvents = [];
  }

  if (
    rawEvents.length === 0
  ) {
    return errorResponse(
      "Please select at least one event.",
      400
    );
  }

  if (
    rawEvents.length > 20
  ) {
    return errorResponse(
      "You can select a maximum of 20 events.",
      400
    );
  }

  // =====================================================
  // 8. NORMALIZE EVENTS
  // =====================================================

  type NormalizedEvent = {
    eventId: string;
    team: string;
    isTeamHead: boolean;
    members: ReturnType<typeof normalizeMembers>;
  };

  let events: NormalizedEvent[];

  try {
    events =
      rawEvents.map(
        (
          rawEvent,
          eventIndex
        ) => {
          const event =
            (rawEvent ??
              {}) as EventRegistrationInput;

          const eventId =
            cleanString(
              event.eventId,
              64
            );

          if (
            !UUID_PATTERN.test(
              eventId
            )
          ) {
            throw new Error(
              `Please select a valid event for selection ${eventIndex + 1
              }.`
            );
          }

          const team =
            cleanString(
              event.team,
              120
            );

          const members =
            normalizeMembers(
              event.members
            );

          return {
            eventId,
            team,
            isTeamHead:
              event.isTeamHead === true,
            members,
          };
        }
      );
  } catch (error) {
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Invalid event information.",
      400
    );
  }

  // =====================================================
  // 9. PREVENT DUPLICATE EVENTS
  // =====================================================

  const uniqueEventIds =
    new Set(
      events.map(
        (event) =>
          event.eventId.toLowerCase()
      )
    );

  if (
    uniqueEventIds.size !==
    events.length
  ) {
    return errorResponse(
      "The same event cannot be selected more than once.",
      400
    );
  }

  // =====================================================
  // 10. NORMALIZE FOR DATABASE RPC
  // =====================================================

  const rpcEvents =
    events.map(
      (event) => ({
        event_id:
          event.eventId,

        team:
          event.team,

        is_team_head:
          event.isTeamHead,

        members:
          event.members.map(
            (member) => ({
              name:
                member.name,

              college:
                member.college,

              email:
                member.email,

              phone:
                member.phone,
            })
          ),
      })
    );

  // =====================================================
  // 11. ATOMIC MULTI-EVENT REGISTRATION
  // =====================================================

  const {
    data: rpcData,
    error: rpcError,
  } =
    await supabaseAdmin.rpc(
      "register_participant_events",
      {
        p_participant_id:
          participantId || null,

        p_name:
          name || null,

        p_college:
          college || null,

        p_email:
          email || null,

        p_phone:
          phone || null,

        p_events:
          rpcEvents,
      }
    );

  if (rpcError) {
    console.error(
      "Multi-event registration RPC failed:",
      {
        code:
          rpcError.code,

        message:
          rpcError.message,

        details:
          rpcError.details,

        hint:
          rpcError.hint,
      }
    );

    const message =
      rpcError.message ||
      "We couldn't save your registration.";
    const code = rpcError.code || "";

    // 1. Structured Error Codes (SVK01 - SVK11)
    if (code === "SVK01") {
      return errorResponse("That Participant ID was not found.", 404);
    }
    if (code === "SVK02") {
      return errorResponse("The provided email does not match this Participant ID.", 400);
    }
    if (code === "SVK03" || code === "SVK04" || code === "SVK05") {
      return errorResponse(message, 400);
    }
    if (code === "SVK06") {
      return errorResponse("Please enter your team name.", 400);
    }
    if (code === "SVK07" || code === "SVK08" || code === "SVK09" || code === "SVK10" || code === "SVK11") {
      return errorResponse(message, 400);
    }

    // 2. Backward Compatibility Fallbacks (Text Matching)
    if (
      message.includes(
        "Participant ID was not found"
      )
    ) {
      return errorResponse(
        "That Participant ID was not found.",
        404
      );
    }

    if (
      message.includes(
        "The provided email does not match this Participant ID"
      )
    ) {
      return errorResponse(
        "The provided email does not match this Participant ID.",
        400
      );
    }

    if (
      message.includes(
        "Please enter your team name"
      )
    ) {
      return errorResponse(
        "Please enter your team name.",
        400
      );
    }

    if (
      message.includes(
        "requires at least"
      )
    ) {
      return errorResponse(
        message,
        400
      );
    }

    if (
      message.includes(
        "allows a maximum"
      )
    ) {
      return errorResponse(
        message,
        400
      );
    }

    if (
      message.includes(
        "different email"
      )
    ) {
      return errorResponse(
        message,
        400
      );
    }

    if (
      message.includes(
        "Registration limit reached"
      ) ||
      message.includes(
        "limit reached"
      )
    ) {
      return errorResponse(
        message,
        400
      );
    }

    if (
      message.includes(
        "registration"
      ) &&
      message.includes(
        "closed"
      )
    ) {
      return errorResponse(
        message,
        400
      );
    }

    if (
      message.includes(
        "not active"
      ) ||
      message.includes(
        "unavailable"
      )
    ) {
      return errorResponse(
        message,
        400
      );
    }

    return errorResponse(
      "We couldn't save your registration. Please try again.",
      500
    );
  }

  // =====================================================
  // 12. NORMALIZE RPC RESPONSE
  // =====================================================

  const results =
    Array.isArray(rpcData)
      ? rpcData
      : [];

  if (
    results.length === 0
  ) {
    return errorResponse(
      "No registration was created.",
      500
    );
  }

  const returnedParticipantId =
    cleanString(
      results[0]?.participant_id,
      40
    );

  if (
    !returnedParticipantId
  ) {
    console.error(
      "Registration RPC returned no participant ID:",
      results
    );

    return errorResponse(
      "Registration was processed but no Participant ID was returned.",
      500
    );
  }

  // =====================================================
  // 13. GET CREATED EVENT RECORDS
  // =====================================================

  const eventIds =
    events.map(
      (event) =>
        event.eventId
    );

  const {
    data: participant,
    error:
    participantLookupError,
  } =
    await supabaseAdmin
      .from("participants")
      .select("id")
      .eq(
        "participant_id",
        returnedParticipantId
      )
      .maybeSingle();

  if (
    participantLookupError
  ) {
    console.error(
      "Participant lookup after registration failed:",
      participantLookupError
    );
  }

  const {
    data:
    participantEventRows,
    error:
    participantEventsError,
  } =
    participant?.id
      ? await supabaseAdmin
        .from(
          "participant_events"
        )
        .select(
          `
              id,
              participant_id,
              event_id,
              registration_status,
              payment_status,
              payment_amount,
              payment_id,
              team_name,
              checked_in,
              checked_in_at,
              events (
                id,
                name,
                category,
                registration_type,
                registration_fee,
                payment_type,
                payment_unit
              )
            `
        )
        .eq(
          "participant_id",
          participant.id
        )
        .in(
          "event_id",
          eventIds
        )
      : {
        data: [],
        error: null,
      };

  if (
    participantEventsError
  ) {
    /*
     * Registration has already succeeded.
     * Do not tell the user it failed.
     */
    console.error(
      "Participant event lookup after registration failed:",
      participantEventsError
    );
  }

  // =====================================================
  // 14. BUILD EVENT RESULTS
  // =====================================================

  const eventResults =
    results.map(
      (result: any) => ({
        participantEventId:
          result.participant_event_id,

        eventId:
          result.event_id,

        eventName:
          result.event_name,

        status:
          result.status,
      })
    );

  // =====================================================
  // 15. CALCULATE NEW PAYMENT TOTAL
  // =====================================================

  const addedEventIds =
    new Set(
      results
        .filter(
          (result: any) =>
            result.status ===
            "added"
        )
        .map(
          (result: any) =>
            String(
              result.event_id
            )
        )
    );

  let totalAmount = 0;

  const paymentEvents =
    Array.isArray(
      participantEventRows
    )
      ? participantEventRows
      : [];

  for (
    const row of paymentEvents as any[]
  ) {
    if (
      addedEventIds.has(
        String(
          row.event_id
        )
      )
    ) {
      totalAmount +=
        Number(
          row.payment_amount
        ) || 0;
    }
  }
  // =====================================================
  // 15.1 RETRIEVE ATOMICALLY CREATED PAYMENT ORDER
  // =====================================================

  let paymentOrder: {
    id: string;
    order_reference: string;
    amount: number;
    currency: string;
    status: string;
  } | null = null;

  if (
    totalAmount > 0 &&
    participant?.id &&
    addedEventIds.size > 0
  ) {
    const newPaidEvents = (
      paymentEvents as any[]
    ).filter(
      (row: any) =>
        addedEventIds.has(
          String(row.event_id)
        ) &&
        Number(row.payment_amount) > 0
    );

    const paidPeIds = newPaidEvents.map((r) => r.id).filter(Boolean);

    if (paidPeIds.length > 0) {
      const { data: itemRow, error: itemLookupError } = await supabaseAdmin
        .from("payment_order_items")
        .select(`
          payment_order_id,
          payment_orders (
            id,
            order_reference,
            amount,
            currency,
            status
          )
        `)
        .in("participant_event_id", paidPeIds)
        .limit(1)
        .maybeSingle();

      if (itemLookupError) {
        console.error("Payment order lookup error:", itemLookupError);
      }

      const rawOrder = itemRow?.payment_orders;
      const orderData = Array.isArray(rawOrder) ? rawOrder[0] : rawOrder;
      if (orderData) {
        paymentOrder = orderData as any;
        console.log(
          "Atomic payment order retrieved:",
          {
            orderReference: orderData.order_reference,
            amount: orderData.amount,
          }
        );
      }
    }
  }
  // =====================================================
  // 15.5 SEND CONFIRMATION EMAILS
  // =====================================================

  /*
   * For each newly added event, send a confirmation
   * email with QR code directly via Resend SDK.
   *
   * This calls Resend directly (not via HTTP self-fetch)
   * to avoid Next.js dev/serverless self-call deadlocks.
   *
   * Errors are logged but never block the user response.
   */
  const peRows =
    Array.isArray(
      participantEventRows
    )
      ? (participantEventRows as any[])
      : [];

  const addedParticipantEventIds =
    peRows
      .filter((row: any) =>
        addedEventIds.has(String(row.event_id))
      )
      .map((row: any) => row.id)
      .filter(Boolean);

  const {
    data: teamMemberRows,
    error: teamMemberLookupError,
  } =
    addedParticipantEventIds.length > 0
      ? await supabaseAdmin
        .from("participant_event_members")
        .select(
          `
            participant_event_id,
            participant_id,
            name,
            email,
            phone,
            is_team_leader,
            participants (
              participant_id,
              college
            )
          `
        )
        .in(
          "participant_event_id",
          addedParticipantEventIds
        )
      : {
        data: [],
        error: null,
      };

  if (teamMemberLookupError) {
    console.error(
      "Team member lookup after registration failed:",
      teamMemberLookupError
    );
  }

  for (const result of results as any[]) {
    if (
      result.status !== "added"
    ) {
      continue;
    }

    /*
     * Find the matching participant_events row
     * to get the UUID (registrationId) and
     * joined event metadata.
     */
    const peRow = peRows.find(
      (row: any) =>
        String(row.event_id) ===
        String(result.event_id)
    );

    if (!peRow) {
      console.error(
        "Could not find participant_events row for email:",
        result.event_id
      );
      continue;
    }

    const eventMeta =
      peRow.events ?? {};

    const isTeam =
      eventMeta.registration_type ===
      "team";

    /*
     * Match the original event payload to get
     * team name and member details.
     */
    const matchedEvent =
      events.find(
        (e) =>
          e.eventId ===
          String(result.event_id)
      );

    try {
      const teamRowsForEvent =
        (Array.isArray(teamMemberRows)
          ? (teamMemberRows as any[])
          : []
        ).filter(
          (row: any) =>
            String(row.participant_event_id) ===
            String(peRow.id)
        );

      const mainParticipantId =
        returnedParticipantId;

      const emailMembers =
        isTeam
          ? teamRowsForEvent
            .filter(
              (row: any) =>
                String(
                  row.participant_id
                ) !== String(
                  participant?.id ?? ""
                )
            )
            .map(
              (row: any) => ({
                participantId:
                  String(
                    row.participants?.participant_id ??
                    ""
                  ),
                name:
                  String(row.name ?? ""),
                college:
                  String(
                    row.participants?.college ??
                    ""
                  ),
                email:
                  String(row.email ?? ""),
                phone:
                  String(row.phone ?? ""),
                isTeamLeader:
                  row.is_team_leader === true,
              })
            )
          : [];

      const emailResult =
        await sendRegistrationEmail({
          registrationId:
            String(peRow.id),

          participantId:
            mainParticipantId,

          eventName:
            result.event_name ||
            eventMeta.name ||
            "Event",

          eventCategory:
            eventMeta.category || null,

          name:
            name || "Participant",

          college:
            college || "",
            
          requiresPayment:
            eventMeta.payment_type === "paid",

          email:
            email || "",

          phone:
            phone || "",

          team: isTeam
            ? (matchedEvent?.team ||
              peRow.team_name ||
              "")
            : null,

          isTeamEvent: isTeam,

          isTeamHead:
            isTeam
              ? matchedEvent?.isTeamHead === true
              : false,

          members:
            emailMembers,
        });

      console.log("[REGISTER] sendRegistrationEmail completed with result:", emailResult);

      if (!emailResult.success) {
        console.error(
          "[REGISTER EMAIL ERROR] Confirmation email failed for event:",
          result.event_id,
          emailResult.error
        );
      } else {
        console.log(
          "Confirmation email sent for event:",
          result.event_name,
          "to",
          emailResult.emailsSent,
          "recipient(s)"
        );
      }
    } catch (emailError) {
      console.error(
        "Confirmation email exception for event:",
        result.event_id,
        emailError
      );
    }
  }

  // =====================================================
  // 16. RESPONSE
  // =====================================================

  const addedEvents =
    eventResults.filter(
      (event) =>
        event.status ===
        "added"
    );

  const alreadyRegisteredEvents =
    eventResults.filter(
      (event) =>
        event.status ===
        "already_registered"
    );

  return NextResponse.json(
    {
      success: true,

      participantId:
        returnedParticipantId,

      events:
        eventResults,

      addedEvents,

      alreadyRegisteredEvents,

      totalAmount,

paymentRequired:
  totalAmount > 0,

paymentOrder:
  paymentOrder
    ? {
        id:
          paymentOrder.id,

        orderReference:
          paymentOrder.order_reference,

        amount:
          Number(
            paymentOrder.amount
          ),

        currency:
          paymentOrder.currency,

        status:
          paymentOrder.status,
      }
    : null,

      /*
       * Payment is deliberately not started here.
       * Step 6 will handle payment creation,
       * gateway redirection and webhook verification.
       */
      paymentStatus:
        totalAmount > 0
          ? "pending"
          : "not_required",

      teamMembers:
        Array.isArray(teamMemberRows)
          ? (teamMemberRows as any[]).map(
            (row: any) => ({
              participantId:
                row.participants?.participant_id ??
                null,
              name:
                row.name ?? "",
              email:
                row.email ?? "",
              isTeamLeader:
                row.is_team_leader === true,
              participantEventId:
                row.participant_event_id ?? null,
            })
          )
          : [],
    },
    {
      status: 201,

      headers: {
        "Cache-Control":
          "no-store",
      },
    }
  );
}