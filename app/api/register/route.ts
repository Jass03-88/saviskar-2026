import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendRegistrationEmail } from "@/lib/send-registration-email";
import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";
import { generatePaymentResumeUrl } from "@/lib/payments/resume-token";
import { getRegistrationSession } from "@/lib/auth/session";
import { SITE_ACCESS } from "@/lib/config/site-access";
import { calculateStayDates } from "@/lib/accommodation-dates";
import { formatAccommodationOverlapError } from "@/lib/accommodation-expiration";

type MemberInput = {
  name?: unknown;
  college?: unknown;
  email?: unknown;
  phone?: unknown;
  gender?: unknown;
  state?: unknown;
  idCardStoragePath?: unknown;
};

type EventRegistrationInput = {
  eventId?: unknown;
  team?: unknown;
  isTeamHead?: unknown;
  members?: unknown;
};

type AccommodationRegistrationInput = {
  email?: unknown;
  planSlug?: unknown;
  selectedDate?: unknown;
  extraDays?: unknown;
};

type RegistrationInput = {
  participantId?: unknown;

  name?: unknown;
  college?: unknown;
  email?: unknown;
  phone?: unknown;
  gender?: unknown;
  state?: unknown;
  idCardStoragePath?: unknown;

  events?: unknown;
  accommodations?: unknown;
  faculty?: unknown;

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
  status: number,
  code?: string
) {
  return NextResponse.json(
    {
      success: false,
      error: message,
      ...(code ? { code } : {}),
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
        gender: cleanString(member.gender, 20).toLowerCase(),
        state: cleanString(member.state, 100),
        idCardStoragePath: cleanString(member.idCardStoragePath, 255),
        index,
      };
    }
  );
}

export async function POST(
  request: NextRequest
) {
  // =====================================================
  // 0. ACCESS GATE
  // =====================================================
  if (!SITE_ACCESS.REGISTRATIONS_ENABLED) {
    return errorResponse(
      "Online registrations are currently closed or in preview mode.",
      403
    );
  }

  // =====================================================
  // 1. REGISTRATION SESSION AUTHENTICATION
  // =====================================================

  const session = await getRegistrationSession();

  if (!session.authenticated || !session.email) {
    return errorResponse(
      "Registration authentication required.",
      401
    );
  }

  const authenticatedEmail = session.email.toLowerCase();

  // =====================================================
  // 2. RATE LIMIT
  // =====================================================

  const clientIp =
    getClientIp(request);

  const rateLimit =
    await checkRateLimitAsync(
      `register:${clientIp}`,
      20,
      60 * 1000
    );

  if (!rateLimit.allowed) {
    return rateLimitResponse(
      rateLimit.retryAfter
    );
  }

  // =====================================================
  // 3. REQUEST SIZE
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

  const gender =
    cleanString(
      body.gender,
      20
    ).toLowerCase();

  const state =
    cleanString(
      body.state,
      100
    );

  const idCardStoragePath =
    cleanString(
      body.idCardStoragePath,
      255
    );

  if (idCardStoragePath && !idCardStoragePath.startsWith(`${authenticatedEmail}/`)) {
    return errorResponse("Invalid ID card storage path ownership.", 403);
  }

  if (!email || email !== authenticatedEmail) {
    return errorResponse(
      "Submitted email does not match authenticated session.",
      403
    );
  }

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

  const rawAccommodations = Array.isArray(body.accommodations)
    ? body.accommodations
    : [];

  if (
    rawEvents.length === 0 &&
    rawAccommodations.length === 0
  ) {
    return errorResponse(
      "Please select at least one event or accommodation.",
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
        eventId:
          event.eventId,

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
              gender:
                member.gender,
              state:
                member.state,
              id_card_storage_path:
                (member.idCardStoragePath && !member.idCardStoragePath.startsWith(`${authenticatedEmail}/`)) 
                  ? null 
                  : member.idCardStoragePath,
            })
          ),
      })
    );

  // =====================================================
  // 10B. NORMALIZE FACULTY FOR DATABASE RPC
  // =====================================================
  let rpcFaculty = null;
  if (body.faculty) {
    const rawFac = body.faculty as MemberInput;
    const facEmail = cleanEmail(rawFac.email);
    if (!facEmail || !EMAIL_PATTERN.test(facEmail)) {
      return errorResponse("Invalid faculty email address.", 400);
    }

    if (facEmail === email) {
      return errorResponse("Faculty In-Charge email cannot be the same as the participant email.", 400);
    }

    for (const ev of events) {
      for (const m of ev.members) {
        if (m.email === facEmail) {
          return errorResponse("Faculty In-Charge email cannot match any team member email.", 400);
        }
      }
    }

    const facIdCardStoragePath = cleanString(rawFac.idCardStoragePath, 255);
    
    if (facIdCardStoragePath && !facIdCardStoragePath.startsWith(`${authenticatedEmail}/`)) {
      return errorResponse("Invalid faculty ID card storage path ownership.", 403);
    }

    rpcFaculty = {
      name: cleanString(rawFac.name, 120),
      college: cleanString(rawFac.college, 180),
      email: facEmail,
      phone: cleanPhone(rawFac.phone),
      gender: cleanString(rawFac.gender, 20).toLowerCase(),
      state: cleanString(rawFac.state, 100),
      id_card_storage_path: facIdCardStoragePath,
    };

    console.log("[Registration] Faculty details verified:", {
      hasFaculty: true,
      hasIdCardPath: Boolean(facIdCardStoragePath),
    });
  }

  // =====================================================
  // 10A. NORMALIZE ACCOMMODATIONS FOR DATABASE RPC
  // =====================================================

  const rpcAccommodations: Array<{
    email: string;
    plan_slug: string;
    selected_date?: string;
    extra_days?: string;
  }> = [];

  if (Array.isArray(body.accommodations) && body.accommodations.length > 0) {
    if (body.accommodations.length > 50) {
      return errorResponse("Too many accommodation selections.", 400);
    }

    // Map each delegate email to their list of accepted stays in this payload
    const participantStays = new Map<
      string,
      Array<{
        startDate: string;
        endDate: string;
        planSlug: string;
      }>
    >();

    for (const rawAcc of body.accommodations) {
      const acc = (rawAcc ?? {}) as AccommodationRegistrationInput;
      const accEmail = cleanEmail(acc.email);
      const accPlanSlug = cleanString(acc.planSlug, 50);
      const rawDate = cleanString(acc.selectedDate, 20);
      const rawExtraDays = cleanString(acc.extraDays, 20);

      if (!accEmail || !EMAIL_PATTERN.test(accEmail)) {
        return errorResponse("Invalid accommodation delegate email address.", 400);
      }
      if (!accPlanSlug) {
        return errorResponse("Accommodation plan is required.", 400);
      }

      let selectedDate = "2026-10-28";
      if (rawDate === "2026-10-27" || rawDate?.includes("27")) {
        selectedDate = "2026-10-27";
      } else if (rawDate === "2026-10-29" || rawDate === "29" || rawDate?.includes("29")) {
        selectedDate = "2026-10-29";
      } else if (rawDate === "2026-10-30" || rawDate?.includes("30")) {
        selectedDate = "2026-10-30";
      }

      let effectivePlanSlug = accPlanSlug;
      if (accPlanSlug === "2_days") {
        if (rawExtraDays === "before_27") {
          effectivePlanSlug = "3_days";
          selectedDate = "2026-10-27";
        } else if (rawExtraDays === "after_30") {
          effectivePlanSlug = "3_days";
          selectedDate = "2026-10-30";
        } else if (rawExtraDays === "both") {
          effectivePlanSlug = "4_days";
          selectedDate = "2026-10-27";
        }
      } else if (accPlanSlug === "3_days") {
        if (rawExtraDays === "before_27" || selectedDate === "2026-10-27") {
          selectedDate = "2026-10-27";
        } else {
          selectedDate = "2026-10-30";
        }
      }

      const { startDate, endDate } = calculateStayDates(
        effectivePlanSlug,
        selectedDate,
        rawExtraDays
      );

      const existingStays = participantStays.get(accEmail) || [];

      // Check against previously accepted stays for this delegate in this payload
      let isDuplicateRepresentation = false;
      for (const existing of existingStays) {
        // Case 1: Exact duplicate representation of the same stay (e.g. teammate repeated across events)
        if (existing.startDate === startDate && existing.endDate === endDate) {
          isDuplicateRepresentation = true;
          break;
        }

        // Case 2: Overlapping stay interval [start, end)
        if (startDate < existing.endDate && endDate > existing.startDate) {
          return errorResponse(
            `Accommodation stays for delegate ${accEmail} overlap (${startDate} to ${endDate} conflicts with ${existing.startDate} to ${existing.endDate}). Please select non-overlapping dates.`,
            400
          );
        }
      }

      // If this is a duplicate entry for an identical stay for this teammate, skip cleanly
      if (isDuplicateRepresentation) {
        continue;
      }

      // Record this distinct, non-overlapping stay for this delegate
      existingStays.push({
        startDate,
        endDate,
        planSlug: effectivePlanSlug,
      });
      participantStays.set(accEmail, existingStays);

      rpcAccommodations.push({
        email: accEmail,
        plan_slug: effectivePlanSlug,
        selected_date: selectedDate,
        extra_days: rawExtraDays || undefined,
      });
    }
  }

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

        p_accommodations:
          rpcAccommodations,

        p_faculty:
          rpcFaculty,

        p_gender:
          gender || null,

        p_state:
          state || null,

        p_id_card_storage_path:
          idCardStoragePath || null,
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
    if (code === "SVK01" || code === "SVK02") {
      return errorResponse("Invalid participant identification or email.", 400);
    }
    if (code === "SVK03" || code === "SVK04" || code === "SVK05") {
      return errorResponse(message, 400);
    }
    if (code === "SVK06") {
      return errorResponse("Please enter your team name.", 400);
    }
    if (code === "SVK11") {
      const formatted = formatAccommodationOverlapError(rpcError);
      return errorResponse(formatted.message || message, 400, formatted.code);
    }
    if (code === "SVK07" || code === "SVK08" || code === "SVK09" || code === "SVK10") {
      return errorResponse(message, 400);
    }

    if (
      code === "23P01" ||
      message.includes("participant_accommodations_no_overlap") ||
      message.includes("exclusion constraint")
    ) {
      return errorResponse(
        "The selected accommodation dates conflict with an existing booking or active checkout in progress. Please choose different dates.",
        400,
        "ACCOMMODATION_OVERLAP_CONFLICT"
      );
    }

    // 2. Backward Compatibility Fallbacks (Text Matching)
    if (
      message.includes("Participant ID was not found") ||
      message.includes("The provided email does not match this Participant ID")
    ) {
      return errorResponse(
        "Invalid participant identification or email.",
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

  type RpcEventResult = {
    participant_id?: string;
    participant_event_id?: string;
    event_id?: string;
    event_name?: string;
    status?: string;
    message?: string;
    payment_order_id?: string;
  };

  type ParticipantEventJoinedRow = {
    id: string;
    participant_id: string;
    event_id: string;
    registration_status: string | null;
    payment_status: string | null;
    payment_amount: number | null;
    payment_id: string | null;
    team_name: string | null;
    checked_in: boolean | null;
    checked_in_at: string | null;
    events:
      | {
          id?: string;
          name?: string;
          category?: string | null;
          registration_type?: string | null;
          registration_fee?: number | null;
          payment_type?: string | null;
          payment_unit?: string | null;
        }
      | {
          id?: string;
          name?: string;
          category?: string | null;
          registration_type?: string | null;
          registration_fee?: number | null;
          payment_type?: string | null;
          payment_unit?: string | null;
        }[]
      | null;
  };

  type TeamMemberJoinedRow = {
    participant_event_id: string;
    participant_id: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
    is_team_leader: boolean | null;
    participants: {
      participant_id?: string | null;
      college?: string | null;
    } | null;
  };

  const results = (
    Array.isArray(rpcData)
      ? rpcData
      : []
  ) as unknown as RpcEventResult[];

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

  const returnedPaymentOrderId = results[0]?.payment_order_id;

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
  // 12A. UPDATE PARTICIPANT GENDER AND STATE
  // =====================================================

  const participantUpdates: { email: string; gender: string; state: string }[] = [];

  if (email && (gender || state)) {
    participantUpdates.push({ email, gender, state });
  }

  for (const event of events) {
    for (const member of event.members) {
      if (member.email && (member.gender || member.state)) {
        participantUpdates.push({
          email: member.email,
          gender: member.gender,
          state: member.state,
        });
      }
    }
  }

  if (participantUpdates.length > 0) {
    // We update in series; there are usually very few members (1-10)
    for (const update of participantUpdates) {
      const updatePayload: Record<string, string> = {};
      
      // Strict validation for allowed gender values
      if (update.gender && ["male", "female", "other"].includes(update.gender)) {
        updatePayload.gender = update.gender;
      }
      if (update.state) {
        updatePayload.state = update.state;
      }

      if (Object.keys(updatePayload).length > 0) {
        await supabaseAdmin
          .from("participants")
          .update(updatePayload)
          .eq("email", update.email);
      }
    }
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

  // 13B. SYNC ACCOMMODATION DATES & DURATION
  if (rpcAccommodations.length > 0) {
    for (const accItem of rpcAccommodations) {
      const { data: accParticipant } = await supabaseAdmin
        .from("participants")
        .select("id")
        .eq("email", accItem.email)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (accParticipant?.id) {
        const { startDate, endDate, durationDays } = calculateStayDates(
          accItem.plan_slug,
          accItem.selected_date,
          accItem.extra_days
        );

        const updatePayload = {
          start_date: startDate,
          end_date: endDate,
          duration_days: durationDays,
        };

        if (returnedPaymentOrderId) {
          const { data: participantOrderAccs } = await supabaseAdmin
            .from("participant_accommodations")
            .select("id, start_date")
            .eq("participant_id", accParticipant.id)
            .eq("payment_order_id", returnedPaymentOrderId);

          if (participantOrderAccs && participantOrderAccs.length > 0) {
            if (participantOrderAccs.length === 1) {
              await supabaseAdmin
                .from("participant_accommodations")
                .update(updatePayload)
                .eq("id", participantOrderAccs[0].id);
            } else {
              const targetAcc =
                participantOrderAccs.find(
                  (a) =>
                    a.start_date === startDate ||
                    a.start_date === accItem.selected_date
                ) || participantOrderAccs[0];
              await supabaseAdmin
                .from("participant_accommodations")
                .update(updatePayload)
                .eq("id", targetAcc.id);
            }
          } else {
            await supabaseAdmin
              .from("participant_accommodations")
              .update(updatePayload)
              .eq("participant_id", accParticipant.id)
              .eq("payment_order_id", returnedPaymentOrderId);
          }
        } else {
          const { data: latestAcc } = await supabaseAdmin
            .from("participant_accommodations")
            .select("id")
            .eq("participant_id", accParticipant.id)
            .in("status", ["pending", "unpaid"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (latestAcc?.id) {
            await supabaseAdmin
              .from("participant_accommodations")
              .update(updatePayload)
              .eq("id", latestAcc.id);
          }
        }
      }
    }
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
      (result) => ({
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
          (result) =>
            result.status ===
            "added"
        )
        .map(
          (result) =>
            String(
              result.event_id
            )
        )
    );

  let totalAmount = 0;

  const paymentEvents = (
    Array.isArray(
      participantEventRows
    )
      ? participantEventRows
      : []
  ) as unknown as ParticipantEventJoinedRow[];

  for (
    const row of paymentEvents
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

  type PaymentOrderInfo = {
    id: string;
    order_reference: string;
    amount: number;
    currency: string;
    status: string;
  };

  let paymentOrder: PaymentOrderInfo | null = null;

  if (returnedPaymentOrderId) {
    const { data: orderData, error: orderLookupError } = await supabaseAdmin
      .from("payment_orders")
      .select("id, order_reference, amount, currency, status")
      .eq("id", returnedPaymentOrderId)
      .limit(1)
      .maybeSingle();

    if (orderLookupError) {
      console.error("Payment order lookup error:", orderLookupError);
    }

    if (orderData) {
      paymentOrder = orderData as unknown as PaymentOrderInfo;
      totalAmount = Number(orderData.amount) || totalAmount;
      console.log(
        "Atomic payment order retrieved:",
        {
          orderReference: orderData.order_reference,
          amount: orderData.amount,
        }
      );
    }
  } else if (rpcAccommodations.length > 0 && participant?.id) {
    const { data: itemData } = await supabaseAdmin
      .from("payment_order_items")
      .select("payment_order_id")
      .eq("participant_id", participant.id)
      .eq("item_type", "accommodation")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (itemData?.payment_order_id) {
      const { data: orderData } = await supabaseAdmin
        .from("payment_orders")
        .select("id, order_reference, amount, currency, status")
        .eq("id", itemData.payment_order_id)
        .limit(1)
        .maybeSingle();

      if (orderData) {
        paymentOrder = orderData as unknown as PaymentOrderInfo;
        totalAmount = Number(orderData.amount) || totalAmount;
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
  const peRows = (
    Array.isArray(
      participantEventRows
    )
      ? participantEventRows
      : []
  ) as unknown as ParticipantEventJoinedRow[];

  const addedParticipantEventIds =
    peRows
      .filter((row) =>
        addedEventIds.has(String(row.event_id))
      )
      .map((row) => row.id)
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

  after(async () => {
    for (const result of results) {
      if (result.status !== "added") {
        continue;
      }

      /*
       * Find the matching participant_events row
       * to get the UUID (registrationId) and
       * joined event metadata.
       */
      const peRow = peRows.find(
        (row) => String(row.event_id) === String(result.event_id)
      );

      if (!peRow) {
        console.error(
          "Could not find participant_events row for email:",
          result.event_id
        );
        continue;
      }

      const rawEventMeta = Array.isArray(peRow.events) ? peRow.events[0] : peRow.events;
      const eventMeta = rawEventMeta ?? {};

      // DO NOT dispatch Entry QR email for events requiring payment that are not yet paid
      if (eventMeta.payment_type === "paid" && peRow.payment_status !== "paid") {
        console.log(
          `[REGISTER EMAIL] Withholding Entry QR pass for unpaid event ${result.event_id} (payment_status: ${peRow.payment_status}). Pass will be issued upon payment verification.`
        );
        // We do not continue here. The email will still be sent as 'Payment Pending' and the QR will be omitted.
      }

      const isTeam = eventMeta.registration_type === "team";

      /*
       * Match the original event payload to get
       * team name and member details.
       */
      const matchedEvent = events.find(
        (e) => e.eventId === String(result.event_id)
      );

      try {
        const teamRows = (Array.isArray(teamMemberRows)
          ? (teamMemberRows as unknown as TeamMemberJoinedRow[])
          : []
        );
        const teamRowsForEvent = teamRows.filter(
          (row) => String(row.participant_event_id) === String(peRow.id)
        );

        const mainParticipantId = returnedParticipantId;

        const emailMembers = isTeam
          ? teamRowsForEvent
            .filter(
              (row) =>
                String(row.participant_id) !== String(participant?.id ?? "")
            )
            .map((row) => ({
              participantId: String(row.participants?.participant_id ?? ""),
              name: String(row.name ?? ""),
              college: String(row.participants?.college ?? ""),
              email: String(row.email ?? ""),
              phone: String(row.phone ?? ""),
              isTeamLeader: row.is_team_leader === true,
            }))
          : [];

        const hasPendingOrder = Number(totalAmount) > 0 && !!paymentOrder?.id;
        const requiresPayment = eventMeta.payment_type === "paid" || hasPendingOrder;

        let paymentResumeUrl: string | null = null;
        if (
          requiresPayment &&
          paymentOrder?.id &&
          participant?.id
        ) {
          try {
            paymentResumeUrl = generatePaymentResumeUrl({
              paymentOrderId: paymentOrder.id,
              participantId: mainParticipantId,
              payerParticipantUuid: participant.id,
            });
          } catch (tokenErr) {
            console.error("Failed to generate payment resume URL:", tokenErr);
          }
        }

        const emailResult = await sendRegistrationEmail({
          registrationId: String(peRow.id),
          participantId: mainParticipantId,
          eventName: result.event_name || eventMeta.name || "Event",
          eventCategory: eventMeta.category || null,
          name: name || "Participant",
          college: college || "",
          requiresPayment,
          paymentResumeUrl,
          email: email || "",
          phone: phone || "",
          team: isTeam ? (matchedEvent?.team || peRow.team_name || "") : null,
          isTeamEvent: isTeam,
          isTeamHead: isTeam ? matchedEvent?.isTeamHead === true : false,
          members: emailMembers,
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
  });

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

  const { data: participantAccommodations } = participant?.id
    ? await supabaseAdmin
      .from("participant_accommodations")
      .select(
        `
        id,
        accommodation_plan_id,
        start_date,
        end_date,
        duration_days,
        amount,
        currency,
        status,
        accommodation_plans (
          id,
          name,
          slug,
          duration,
          price
        )
      `
      )
      .eq("participant_id", participant.id)
      .order("created_at", { ascending: false })
    : { data: [] };

  const accommodations = (participantAccommodations ?? []).map((acc) => {
    const rawPlan = acc.accommodation_plans;
    const plan = Array.isArray(rawPlan) ? rawPlan[0] : rawPlan;
    return {
      id: acc.id,
      planName: plan?.name ?? "Accommodation",
      planSlug: plan?.slug ?? "",
      startDate: acc.start_date,
      endDate: acc.end_date,
      durationDays: acc.duration_days,
      amount: Number(acc.amount) || 0,
      currency: acc.currency || "INR",
      status: acc.status,
    };
  });

  return NextResponse.json(
    {
      success: true,

      participantId:
        returnedParticipantId,

      events:
        eventResults,

      addedEvents,

      alreadyRegisteredEvents,

      accommodations,

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
          ? (teamMemberRows as unknown as TeamMemberJoinedRow[]).map(
            (row) => ({
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