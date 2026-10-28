/**
 * POST /api/team/accommodation
 *
 * Secure server-side team and individual accommodation booking.
 *
 * Enforces authoritative invariants:
 *   1. Registration session authentication via HTTP-only cookie
 *   2. Authoritative team-leadership verification (leader may only arrange for verified teammates)
 *   3. Individual non-overlapping stay date validation for every delegate
 *   4. Combined atomic payment order creation covering all selected bookings
 *   5. Participant ownership preservation (each booking owned by the delegate, order paid by leader)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRegistrationSession } from "@/lib/auth/session";
import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";
import { calculateStayDates, isValidAccommodationDate } from "@/lib/accommodation-dates";
import { formatAccommodationOverlapError } from "@/lib/accommodation-expiration";
import { getPaymentGateway } from "@/lib/payments";
import { getSiteAccess } from "@/lib/config/site-access";


const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function errorResponse(message: string, status = 400, code?: string) {
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

function cleanString(value: unknown, maxLength = 255): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function cleanEmail(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().slice(0, 255);
}

export interface AccommodationBookingItemInput {
  email: string;
  planSlug: string;
  selectedDate?: string;
  extraDays?: "none" | "before_27" | "after_30" | "both" | string;
}

export interface TeamAccommodationRequest {
  participantEventId?: string | null;
  bookings: AccommodationBookingItemInput[];
}

export async function POST(request: NextRequest) {
  // 1. Session Authentication
  const session = await getRegistrationSession();
  if (!session.authenticated || !session.email) {
    return errorResponse("Registration authentication required.", 401, "UNAUTHORIZED");
  }

  // 1b. Registration & Accommodation Access Gates
  const siteAccess = await getSiteAccess({ bypassCache: true });
  if (!siteAccess.REGISTRATIONS_ENABLED || !siteAccess.REGISTRATION_ENABLED) {
    return errorResponse(
      "Participant registration is temporarily paused by administration. Please check back shortly.",
      403,
      "REGISTRATION_LOCKED"
    );
  }
  if (!siteAccess.ACCOMMODATION_ENABLED) {
    return errorResponse(
      "Campus Accommodation Booking Paused — Hostel allocations are temporarily closed by administration. Event registrations remain open.",
      403,
      "ACCOMMODATION_LOCKED"
    );
  }

  const authenticatedEmail = session.email.toLowerCase().trim();

  // 2. Rate Limiting (10 requests/minute per IP)
  const clientIp = getClientIp(request);
  const rateLimit = await checkRateLimitAsync(`team-acc:${clientIp}`, 10, 60 * 1000);
  if (!rateLimit.allowed) {
    return errorResponse(
      "Too many accommodation booking attempts. Please wait a moment.",
      429,
      "RATE_LIMITED"
    );
  }

  // 3. Supabase Admin Initialization
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseSecretKey) {
    return errorResponse("Accommodation service is not configured.", 500, "CONFIG_ERROR");
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  // 4. Parse Request
  let body: TeamAccommodationRequest;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid accommodation booking request payload.", 400);
  }

  if (!Array.isArray(body.bookings) || body.bookings.length === 0) {
    return errorResponse("Please select at least one accommodation stay.", 400);
  }

  if (body.bookings.length > 50) {
    return errorResponse("Too many accommodation bookings in one request (maximum 50).", 400);
  }

  // 5. Look up Authenticated Payer Record
  const { data: payer, error: payerError } = await supabaseAdmin
    .from("participants")
    .select("id, participant_id, name, email, phone, college")
    .ilike("email", authenticatedEmail)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (payerError || !payer) {
    return errorResponse("Participant not found for the current authenticated session.", 404);
  }

  const participantEventId = cleanString(body.participantEventId, 64) || null;

  // 6. Authoritative Team Membership & Authorization Verification
  const involvesOtherMembers = body.bookings.some(
    (b) => cleanEmail(b.email) !== authenticatedEmail
  );

  const verifiedEmailToMember = new Map<
    string,
    { id: string; email: string; name: string; participantUuid: string | null; participantId: string | null }
  >();

  // Add the payer themselves as authorized
  verifiedEmailToMember.set(authenticatedEmail, {
    id: payer.id,
    email: authenticatedEmail,
    name: payer.name,
    participantUuid: payer.id,
    participantId: payer.participant_id,
  });

  if (involvesOtherMembers) {
    if (!participantEventId) {
      return errorResponse(
        "A verified team event registration is required to arrange team accommodation.",
        400
      );
    }

    // Verify payer is leader of this team event
    const { data: leaderMember } = await supabaseAdmin
      .from("participant_event_members")
      .select("id, is_team_leader")
      .eq("participant_event_id", participantEventId)
      .ilike("email", authenticatedEmail)
      .maybeSingle();

    const { data: directEvent } = await supabaseAdmin
      .from("participant_events")
      .select("id, participant_id, team_name")
      .eq("id", participantEventId)
      .eq("participant_id", payer.id)
      .maybeSingle();

    const isAuthorizedLeader =
      (leaderMember && leaderMember.is_team_leader === true) || Boolean(directEvent);

    if (!isAuthorizedLeader) {
      return errorResponse(
        "You are not authorized to manage accommodation for this team.",
        403,
        "UNAUTHORIZED_TEAM_LEADER"
      );
    }

    // Load all verified members of this team event
    const { data: teamMembers, error: membersError } = await supabaseAdmin
      .from("participant_event_members")
      .select(`
        id,
        name,
        email,
        participant_id,
        participants (
          id,
          participant_id
        )
      `)
      .eq("participant_event_id", participantEventId);

    if (membersError || !teamMembers) {
      return errorResponse("Failed to load verified team members.", 500);
    }

    for (const tm of teamMembers) {
      if (tm.email) {
        const norm = tm.email.toLowerCase().trim();
        const pObj = Array.isArray(tm.participants) ? tm.participants[0] : tm.participants;
        verifiedEmailToMember.set(norm, {
          id: tm.id,
          email: norm,
          name: tm.name,
          participantUuid: tm.participant_id || pObj?.id || null,
          participantId: pObj?.participant_id || null,
        });
      }
    }

    // Validate that every requested booking email belongs to this verified team
    for (const b of body.bookings) {
      const email = cleanEmail(b.email);
      if (!email || !EMAIL_PATTERN.test(email)) {
        return errorResponse("Invalid delegate email address provided.", 400);
      }
      if (!verifiedEmailToMember.has(email)) {
        return errorResponse(
          `Unauthorized: Delegate ${email} is not a verified member of your team.`,
          403,
          "UNAUTHORIZED_MEMBER"
        );
      }
    }
  }

  // 7. Normalize Accommodations & Validate Overlaps
  const rpcAccommodations: Array<{
    email: string;
    plan_slug: string;
    selected_date?: string;
    extra_days?: string;
  }> = [];

  const payloadMemberStays = new Map<
    string,
    Array<{ startDate: string; endDate: string; planSlug: string }>
  >();

  for (const rawBooking of body.bookings) {
    const email = cleanEmail(rawBooking.email);
    const planSlug = cleanString(rawBooking.planSlug, 50);
    const rawDate = cleanString(rawBooking.selectedDate, 20);
    const rawExtraDays = cleanString(rawBooking.extraDays, 20);

    if (!email || !EMAIL_PATTERN.test(email)) {
      return errorResponse("Invalid accommodation delegate email address.", 400);
    }
    if (!planSlug) {
      return errorResponse("Accommodation plan is required for each delegate.", 400);
    }

    let selectedDate = (planSlug === "4_days") ? "2026-10-27" : "2026-10-28";
    if (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      selectedDate = rawDate;
    } else if (rawDate === "27" || rawDate?.includes("27")) {
      selectedDate = "2026-10-27";
    } else if (rawDate === "29" || rawDate?.includes("29")) {
      selectedDate = "2026-10-29";
    } else if (rawDate === "30" || rawDate?.includes("30")) {
      selectedDate = "2026-10-30";
    } else if (rawDate === "31" || rawDate?.includes("31")) {
      selectedDate = "2026-10-31";
    }

    let effectivePlanSlug = planSlug;
    if (planSlug === "2_days") {
      if (rawExtraDays === "before_27") {
        effectivePlanSlug = "3_days";
        selectedDate = "2026-10-27";
      } else if (rawExtraDays === "after_30" && selectedDate !== "2026-10-30") {
        effectivePlanSlug = "3_days";
        selectedDate = "2026-10-28";
      } else if (rawExtraDays === "both") {
        effectivePlanSlug = "4_days";
        selectedDate = "2026-10-27";
      }
    } else if (planSlug === "3_days") {
      if (rawExtraDays === "before_27") {
        selectedDate = "2026-10-27";
      } else if (rawExtraDays === "after_30" || selectedDate === "2026-10-30") {
        selectedDate = "2026-10-28";
      }
    }

    if (!isValidAccommodationDate(effectivePlanSlug, selectedDate)) {
      return errorResponse(
        `Invalid accommodation date ${selectedDate} for plan ${effectivePlanSlug}.`,
        400
      );
    }

    const { startDate, endDate } = calculateStayDates(
      effectivePlanSlug,
      selectedDate,
      rawExtraDays
    );

    // Check payload intra-member overlaps
    const existingStaysInPayload = payloadMemberStays.get(email) || [];
    for (const existing of existingStaysInPayload) {
      if (startDate < existing.endDate && endDate > existing.startDate) {
        const memberInfo = verifiedEmailToMember.get(email);
        const nameDisplay = memberInfo?.name ? `${memberInfo.name} (${email})` : email;
        return errorResponse(
          `Requested accommodation stays for ${nameDisplay} overlap (${startDate} to ${endDate} conflicts with ${existing.startDate} to ${existing.endDate}). Please select non-overlapping dates.`,
          400
        );
      }
    }

    // Check existing database paid stays for this delegate
    const memberInfo = verifiedEmailToMember.get(email);
    let targetParticipantUuid = memberInfo?.participantUuid;

    if (!targetParticipantUuid) {
      const { data: dbPart } = await supabaseAdmin
        .from("participants")
        .select("id")
        .ilike("email", email)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      targetParticipantUuid = dbPart?.id || null;
    }

    if (targetParticipantUuid) {
      const { data: existingPaidStays } = await supabaseAdmin
        .from("participant_accommodations")
        .select("id, start_date, end_date, status")
        .eq("participant_id", targetParticipantUuid)
        .eq("status", "paid")
        .lt("start_date", endDate)
        .gt("end_date", startDate);

      if (existingPaidStays && existingPaidStays.length > 0) {
        const conflict = existingPaidStays[0];
        const nameDisplay = memberInfo?.name ? `${memberInfo.name} (${email})` : email;
        return errorResponse(
          `Accommodation is already booked for these dates (${conflict.start_date} to ${conflict.end_date}) for ${nameDisplay}. Please choose different dates or review the participant's existing stay.`,
          400,
          "OVERLAPPING_STAY"
        );
      }


    }

    existingStaysInPayload.push({
      startDate,
      endDate,
      planSlug: effectivePlanSlug,
    });
    payloadMemberStays.set(email, existingStaysInPayload);

    rpcAccommodations.push({
      email,
      plan_slug: effectivePlanSlug,
      selected_date: startDate,
      extra_days: rawExtraDays || undefined,
    });
  }

  // 7b. Check existing pending/unpaid holds for the delegates being booked:
  //    - Paid stays: Cannot be superseded (handled by validation & RPC).
  //    - Explicitly failed orders: Already safely expirable in register_participant_events RPC under advisory lock.
  //    - Draft orders (gateway_order_id is null): Safely transition to 'failed' so the RPC can atomically expire the hold.
  //    - Orders with gateway_order_id: Authoritatively verify with PayU with separated try/catch:
  //        * Server-to-server gateway lookup errors are distinct from database settlement/failure RPC errors.
  //        * If gateway status is 'paid': reconcile and reject checkout with HTTP 409 (DELEGATE_ALREADY_PAID).
  //        * If definitive terminal failure ('failed', 'usercancelled', 'bounced', 'dropped', 'not_found'): atomically mark order 'failed' via process_payment_failure RPC.
  //        * If active in-flight: REJECT with HTTP 409 (PAYMENT_PENDING) to protect delegate's payment!
  //        * If unknown/ambiguous: FAIL CLOSED with HTTP 409 (PAYMENT_STATUS_AMBIGUOUS).
  for (const accItem of rpcAccommodations) {
    const email = cleanEmail(accItem.email);
    const memberInfo = verifiedEmailToMember.get(email);
    let targetParticipantUuid = memberInfo?.participantUuid;

    if (!targetParticipantUuid) {
      const { data: dbPart } = await supabaseAdmin
        .from("participants")
        .select("id")
        .ilike("email", email)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      targetParticipantUuid = dbPart?.id || null;
    }

    if (targetParticipantUuid) {
      const { startDate, endDate } = calculateStayDates(
        accItem.plan_slug,
        accItem.selected_date,
        accItem.extra_days
      );

      const { data: existingPendingStays } = await supabaseAdmin
        .from("participant_accommodations")
        .select(`
          id,
          status,
          payment_order_id,
          payment_orders (
            id,
            status,
            gateway,
            gateway_order_id,
            gateway_payment_id,
            created_at,
            updated_at
          )
        `)
        .eq("participant_id", targetParticipantUuid)
        .in("status", ["pending", "unpaid"])
        .lt("start_date", endDate)
        .gt("end_date", startDate);

      if (existingPendingStays && existingPendingStays.length > 0) {
        for (const pendingStay of existingPendingStays) {
          const rawPo = (pendingStay as any).payment_orders;
          const po = Array.isArray(rawPo) ? rawPo[0] : rawPo;
          if (!po) continue;

          if (po.status === "paid") {
            return errorResponse(
              `Accommodation for ${email} already has a confirmed paid booking for these dates.`,
              409,
              "DELEGATE_ALREADY_PAID"
            );
          }

          if (po.status === "failed") {
            // Already failed. The register_participant_events RPC will atomically expire this hold under the advisory lock.
            continue;
          }

          if (po.status === "pending") {
            if (!po.gateway_order_id) {
              // Draft order that was never submitted to the payment gateway.
              // Transition the draft order to 'failed' so the RPC can atomically expire the hold under the advisory lock.
              const { error: draftUpdateError } = await supabaseAdmin
                .from("payment_orders")
                .update({ status: "failed", updated_at: new Date().toISOString() })
                .eq("id", po.id)
                .eq("status", "pending")
                .is("gateway_order_id", null);

              if (draftUpdateError) {
                console.error("Failed to transition draft order to failed:", draftUpdateError);
                return errorResponse(
                  `Could not update prior checkout session for ${email}. Please try again.`,
                  500,
                  "DRAFT_ORDER_UPDATE_FAILED"
                );
              }
            } else {
              // 1. Authoritative Gateway Status Lookup (Isolated try/catch for gateway errors)
              let details: any;
              const gateway = getPaymentGateway(po.gateway ?? undefined);
              try {
                details = await gateway.fetchPaymentDetails(po.gateway_order_id);
              } catch (gatewayErr) {
                console.error(`Gateway lookup error for order ${po.gateway_order_id}:`, gatewayErr);
                const orderAgeMs = Date.now() - new Date(po.updated_at || po.created_at || 0).getTime();
                if (orderAgeMs < 15 * 60 * 1000) {
                  return errorResponse(
                    `A recent payment attempt for ${email} cannot be verified with the payment gateway right now. Please wait a few moments before retrying.`,
                    503,
                    "GATEWAY_VERIFICATION_UNAVAILABLE"
                  );
                }
                return errorResponse(
                  `Unable to verify previous payment status for ${email} with the payment gateway. Please try again in a few moments.`,
                  503,
                  "GATEWAY_UNAVAILABLE"
                );
              }

              // 2. Classify Gateway Status & Execute Settlement/Failure Handling
              const rawLower = (details.rawStatus || "").toLowerCase().trim();
              const unmappedLower = (details.unmappedStatus || "").toLowerCase().trim();

              const isTerminalFailure =
                details.status === "failed" &&
                (
                  rawLower === "failure" ||
                  rawLower === "failed" ||
                  rawLower === "bounced" ||
                  rawLower === "usercancelled" ||
                  rawLower === "dropped"
                );

              if (details.status === "paid") {
                // Captured on gateway! Reconcile immediately with separate DB error handling.
                const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc("process_payment_success", {
                  p_gateway_order_id: po.gateway_order_id,
                  p_gateway_payment_id: details.gatewayPaymentId,
                  p_amount_paise: details.amount,
                  p_currency: details.currency || "INR",
                  p_gateway_name: gateway.name,
                });

                if (rpcError || (rpcData && !rpcData.success)) {
                  console.error("Database settlement RPC failed during team checkout reconciliation:", rpcError || rpcData?.error);
                  return errorResponse(
                    `Payment for ${email} was captured on gateway, but database reconciliation failed. Please contact support.`,
                    500,
                    "SETTLEMENT_RPC_FAILED"
                  );
                }

                return errorResponse(
                  `Accommodation for ${email} was already paid on the payment gateway. Please refresh your roster.`,
                  409,
                  "DELEGATE_ALREADY_PAID"
                );
              } else if (isTerminalFailure) {
                // Gateway authoritatively confirms terminal failure. Mark failed via RPC.
                const { data: failRpcData, error: failRpcError } = await supabaseAdmin.rpc("process_payment_failure", {
                  p_gateway_order_id: po.gateway_order_id,
                });

                if (failRpcError || (failRpcData && !failRpcData.success)) {
                  console.error("Database failure RPC failed during team checkout:", failRpcError || failRpcData?.error);
                  return errorResponse(
                    `Could not update prior checkout status for ${email} in database. Please try again.`,
                    500,
                    "FAILURE_RPC_FAILED"
                  );
                }
                // Order is now successfully marked 'failed' in DB; register_participant_events will atomically expire the hold.
              } else if (details.status === "pending") {
                // Active payment method in progress (e.g. awaiting UPI PIN or card OTP).
                // Fail-safe: Protect the delegate's active payment attempt!
                return errorResponse(
                  `A payment attempt for ${email} is currently being processed by the gateway. Please complete it or wait a few moments before retrying.`,
                  409,
                  "PAYMENT_PENDING"
                );
              } else {
                // Gateway returned 'not_found', unknown, or ambiguous state.
                // PayU 'Not Found' does not guarantee that no customer debit occurred.
                // Fail closed: retain existing payment state and protective accommodation holds,
                // and reject conflicting replacement checkout until payment outcome is resolved.
                console.warn("Ambiguous or unresolved gateway status detected during team accommodation checkout:", {
                  email,
                  gatewayOrderId: po.gateway_order_id,
                  details,
                });
                return errorResponse(
                  `Payment status for ${email} is currently ambiguous (${details.status}). Please wait a few moments or contact support.`,
                  409,
                  "PAYMENT_STATUS_AMBIGUOUS"
                );
              }
            }
          }
        }
      }
    }
  }

  // 8. Atomic Registration RPC Execution (Multi-Accommodation)
  const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
    "register_participant_events",
    {
      p_participant_id: payer.participant_id || null,
      p_name: payer.name || null,
      p_college: payer.college || null,
      p_email: payer.email || null,
      p_phone: payer.phone || null,
      p_events: [],
      p_accommodations: rpcAccommodations,
      p_faculty: null,
      p_gender: null,
      p_state: null,
      p_id_card_storage_path: null,
    }
  );

  if (rpcError) {
    console.error("Team accommodation booking RPC error:", rpcError);
    if (
      rpcError.code === "SVK12" ||
      rpcError.message?.includes("ACCOMMODATION_LOCKED") ||
      rpcError.message?.includes("Hostel allocations are temporarily closed")
    ) {
      return errorResponse(
        "Campus Accommodation Booking Paused — Hostel allocations are temporarily closed by administration. Event registrations remain open.",
        403,
        "ACCOMMODATION_LOCKED"
      );
    }
    const formatted = formatAccommodationOverlapError(rpcError);
    return errorResponse(
      formatted.message || "Failed to create team accommodation order.",
      400,
      formatted.code || "RPC_ERROR"
    );
  }

  type RpcResult = {
    participant_id?: string;
    payment_order_id?: string;
    status?: string;
    message?: string;
  };

  const results = (Array.isArray(rpcData) ? rpcData : []) as RpcResult[];
  const returnedPaymentOrderId = results[0]?.payment_order_id || null;

  if (!returnedPaymentOrderId) {
    return errorResponse("Failed to generate payment order for accommodation.", 500);
  }

  // 9. Sync stay dates & duration on newly created accommodation records
  for (const accItem of rpcAccommodations) {
    const email = cleanEmail(accItem.email);
    let targetParticipantUuid = verifiedEmailToMember.get(email)?.participantUuid;

    if (!targetParticipantUuid) {
      const { data: accParticipant } = await supabaseAdmin
        .from("participants")
        .select("id")
        .ilike("email", email)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      targetParticipantUuid = accParticipant?.id || null;
    }

    if (targetParticipantUuid) {
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

      await supabaseAdmin
        .from("participant_accommodations")
        .update(updatePayload)
        .eq("participant_id", targetParticipantUuid)
        .eq("payment_order_id", returnedPaymentOrderId);
    }
  }

  // 10. Fetch Authoritative Payment Order
  const { data: paymentOrder, error: orderError } = await supabaseAdmin
    .from("payment_orders")
    .select("id, order_reference, amount, currency, status")
    .eq("id", returnedPaymentOrderId)
    .maybeSingle();

  if (orderError || !paymentOrder) {
    return errorResponse("Failed to retrieve accommodation payment order.", 500);
  }

  return NextResponse.json(
    {
      success: true,
      participantId: payer.participant_id,
      paymentOrderId: paymentOrder.id,
      orderReference: paymentOrder.order_reference,
      totalAmount: Number(paymentOrder.amount),
      paymentRequired: Number(paymentOrder.amount) > 0,
      paymentOrder: {
        id: paymentOrder.id,
        orderReference: paymentOrder.order_reference,
        amount: Number(paymentOrder.amount),
        currency: paymentOrder.currency,
        status: paymentOrder.status,
      },
      bookings: rpcAccommodations.map((a) => {
        const { startDate, endDate, durationDays } = calculateStayDates(
          a.plan_slug,
          a.selected_date,
          a.extra_days
        );
        return {
          email: a.email,
          planSlug: a.plan_slug,
          startDate,
          endDate,
          durationDays,
        };
      }),
    },
    {
      status: 201,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
