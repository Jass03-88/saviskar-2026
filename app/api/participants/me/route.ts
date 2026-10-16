/**
 * GET /api/participants/me
 *
 * Authenticated participant lookup for current registration session.
 *
 * Automatically resolves the logged-in participant using the cryptographically
 * verified svk_reg_session HTTP-only cookie. No participant ID parameter required
 * from the client, eliminating manual ID typing.
 *
 * Rate limited to 30 requests/minute per IP.
 * PII is masked and response is minimized to only the fields consumed by the frontend.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";
import { getRegistrationSession } from "@/lib/auth/session";
import { getPaymentGateway } from "@/lib/payments";

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function maskEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex <= 1) {
    return `***${email.slice(atIndex)}`;
  }
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex);
  return `${local[0]}***${domain}`;
}

function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const cleaned = phone.replace(/\s+/g, "");
  if (cleaned.length >= 6) {
    return `${cleaned.slice(0, 2)}*****${cleaned.slice(-2)}`;
  }
  return "******";
}

export async function GET(request: NextRequest) {
  // ─── Rate Limiting (30 requests per minute per IP) ──────
  const clientIp = getClientIp(request);
  const rateLimit = await checkRateLimitAsync(`lookup-me:${clientIp}`, 30, 60 * 1000);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: "Too many lookup attempts. Please wait a moment and try again.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfter),
          "Cache-Control": "no-store",
        },
      }
    );
  }

  // ─── Session Verification ──────────────────────────────
  const session = await getRegistrationSession();

  if (!session.authenticated || !session.email) {
    return jsonResponse(
      {
        success: false,
        error: "Registration authentication required.",
      },
      401
    );
  }

  const normalizedEmail = session.email.trim().toLowerCase();

  // ─── Supabase Admin ─────────────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    console.error("Authenticated participant lookup: Missing Supabase config.");
    return jsonResponse(
      {
        success: false,
        error: "Participant service is not configured.",
      },
      500
    );
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  // ─── Look Up Participant by Session Email ────────────────
  const { data, error } = await supabaseAdmin
    .from("participants")
    .select(
      `
      id,
      participant_id,
      name,
      college,
      email,
      phone,
      participant_events (
        id,
        event_id,
        registration_status,
        payment_status,
        payment_amount,
        team_name,
        checked_in,
        checked_in_at,
        is_archived,
        events (
          id,
          name,
          category,
          registration_type,
          registration_fee,
          payment_type,
          payment_unit
        )
      ),
      participant_event_members (
        id,
        participant_event_id,
        is_team_leader,
        participant_events (
          id,
          event_id,
          registration_status,
          payment_status,
          payment_amount,
          team_name,
          checked_in,
          checked_in_at,
          is_archived,
          events (
            id,
            name,
            category,
            registration_type,
            registration_fee,
            payment_type,
            payment_unit
          )
        )
      ),
      participant_accommodations (
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
      )
    `
    )
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (error) {
    console.error("Session participant lookup failed:", error);
    return jsonResponse(
      {
        success: false,
        error: "Unable to retrieve participant details.",
      },
      500
    );
  }

  // If no record found, this is an authenticated user who hasn't registered yet
  if (!data) {
    return jsonResponse({
      success: true,
      found: false,
    });
  }

  // ─── Format Events (Minimizing to only UI-required fields) ───
  type RawEventRecord = {
    id: string;
    event_id: string;
    registration_status?: string | null;
    payment_status: string | null;
    payment_amount: number | null;
    team_name?: string | null;
    checked_in?: boolean | null;
    checked_in_at?: string | null;
    is_archived?: boolean | null;
    events:
      | {
          id?: string;
          name: string | null;
          category?: string | null;
          registration_type?: string | null;
          registration_fee?: number | null;
          payment_type?: string | null;
        }
      | {
          id?: string;
          name: string | null;
          category?: string | null;
          registration_type?: string | null;
          registration_fee?: number | null;
          payment_type?: string | null;
        }[]
      | null;
  };

  const directEvents = (data.participant_events as RawEventRecord[] | null) ?? [];
  const memberRows =
    (data.participant_event_members as Array<{
      id: string;
      participant_event_id: string;
      is_team_leader?: boolean | null;
      participant_events: RawEventRecord | RawEventRecord[] | null;
    }> | null) ?? [];

  const eventsByParticipantEventId = new Map<
    string,
    {
      participantEventId: string;
      eventId: string;
      eventName: string;
      category: string | null;
      registrationType: string;
      teamName: string | null;
      isTeamLeader: boolean;
      paymentStatus: string | null;
      paymentAmount: number | null;
      registrationStatus: string | null;
      checkedIn: boolean;
    }
  >();

  // 1. Process direct events (individual or team events where this participant is the registrant/leader)
  for (const event of directEvents) {
    if (!event || event.is_archived === true) continue;
    const rawEvt = Array.isArray(event.events) ? event.events[0] : event.events;
    const eventName = rawEvt?.name ?? "Unknown event";
    const category = rawEvt?.category ?? null;
    const registrationType = rawEvt?.registration_type ?? (event.team_name ? "team" : "individual");
    const isTeamLeader = registrationType === "team";

    eventsByParticipantEventId.set(event.id, {
      participantEventId: event.id,
      eventId: event.event_id,
      eventName,
      category,
      registrationType,
      teamName: event.team_name ?? null,
      isTeamLeader,
      paymentStatus: event.payment_status,
      paymentAmount: event.payment_amount,
      registrationStatus: event.registration_status ?? "confirmed",
      checkedIn: Boolean(event.checked_in),
    });
  }

  // 2. Process team member events (events where this participant is registered as a team member)
  for (const memberRow of memberRows) {
    const event = Array.isArray(memberRow.participant_events)
      ? memberRow.participant_events[0]
      : memberRow.participant_events;

    if (!event || event.is_archived === true) continue;
    if (eventsByParticipantEventId.has(event.id)) continue;

    const rawEvt = Array.isArray(event.events) ? event.events[0] : event.events;
    const eventName = rawEvt?.name ?? "Unknown event";
    const category = rawEvt?.category ?? null;
    const registrationType = rawEvt?.registration_type ?? "team";
    const isTeamLeader = memberRow.is_team_leader === true;

    eventsByParticipantEventId.set(event.id, {
      participantEventId: event.id,
      eventId: event.event_id,
      eventName,
      category,
      registrationType,
      teamName: event.team_name ?? null,
      isTeamLeader,
      paymentStatus: event.payment_status,
      paymentAmount: event.payment_amount,
      registrationStatus: event.registration_status ?? "confirmed",
      checkedIn: Boolean(event.checked_in),
    });
  }

  // ─── Format Accommodations ──────────────────────────────
  type RawAccRecord = {
    id: string;
    start_date: string;
    end_date: string;
    duration_days: number;
    amount: number;
    currency: string | null;
    status: string;
    accommodation_plans:
      | { name: string; slug: string; duration?: number; price?: number }
      | { name: string; slug: string; duration?: number; price?: number }[]
      | null;
  };

  const rawAccs = (data.participant_accommodations as RawAccRecord[] | null) ?? [];
  let accommodations = rawAccs
    .filter((acc) => acc && acc.status !== "cancelled")
    .map((acc) => {
      const rawPlan = Array.isArray(acc.accommodation_plans)
        ? acc.accommodation_plans[0]
        : acc.accommodation_plans;
      return {
        id: acc.id,
        planName: rawPlan?.name ?? "Accommodation",
        planSlug: rawPlan?.slug ?? "",
        startDate: acc.start_date,
        endDate: acc.end_date,
        durationDays: acc.duration_days,
        amount: Number(acc.amount) || 0,
        currency: acc.currency || "INR",
        status: acc.status,
      };
    });

  // ─── Auto-Reconcile Pending Orders with Gateway ───────────
  // If the participant has pending events OR pending accommodation, check if any pending payment order has already
  // been captured on the gateway (e.g. attendee completed payment on phone, or webhook was delayed).
  const hasPendingItems =
    Array.from(eventsByParticipantEventId.values()).some((e) => e.paymentStatus === "pending") ||
    accommodations.some((a) => a.status === "pending" || a.status === "unpaid");

  if (hasPendingItems) {
    try {
      const { data: pendingOrders } = await supabaseAdmin
        .from("payment_orders")
        .select("id, gateway_order_id, gateway, amount")
        .eq("payer_participant_id", data.id)
        .eq("status", "pending")
        .not("gateway_order_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(3);

      if (pendingOrders && pendingOrders.length > 0) {
        for (const pOrder of pendingOrders) {
          if (!pOrder.gateway_order_id) continue;
          const gateway = getPaymentGateway(pOrder.gateway ?? undefined);
          try {
            const details = await gateway.fetchPaymentDetails(pOrder.gateway_order_id);
            if (details.status === "paid") {
              const fetchedGatewayPaymentId = details.gatewayPaymentId;

              const { data: eventClaim, error: claimError } = await supabaseAdmin
                .from("processed_payment_events")
                .insert({
                  order_id: pOrder.id,
                  payment_id: fetchedGatewayPaymentId,
                  event_type: "payment.captured.recovery",
                })
                .select("id")
                .maybeSingle();

              const isDuplicate = claimError?.code === "23505" || (!claimError && !eventClaim);

              if (!isDuplicate) {
                await supabaseAdmin
                  .from("payment_orders")
                  .update({
                    status: "paid",
                    gateway_payment_id: fetchedGatewayPaymentId,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", pOrder.id);

                await supabaseAdmin
                  .from("participant_accommodations")
                  .update({
                    status: "paid",
                    updated_at: new Date().toISOString(),
                  })
                  .eq("payment_order_id", pOrder.id);

                // Update in-memory accommodations
                accommodations = accommodations.map((acc) => ({
                  ...acc,
                  status: "paid",
                }));

                const { data: orderItems } = await supabaseAdmin
                  .from("payment_order_items")
                  .select("participant_event_id, participant_id")
                  .eq("payment_order_id", pOrder.id);

                const participantEventIds = (orderItems ?? [])
                  .map((item) => item.participant_event_id)
                  .filter(Boolean) as string[];

                if (participantEventIds.length > 0) {
                  await supabaseAdmin
                    .from("participant_events")
                    .update({
                      payment_status: "paid",
                      payment_id: fetchedGatewayPaymentId,
                      updated_at: new Date().toISOString(),
                    })
                    .in("id", participantEventIds);

                  for (const peId of participantEventIds) {
                    const existing = eventsByParticipantEventId.get(peId);
                    if (existing) {
                      existing.paymentStatus = "paid";
                    }
                  }
                }

                await supabaseAdmin
                  .from("payments")
                  .insert({
                    participant_id: data.id,
                    participant_event_id: participantEventIds[0] ?? null,
                    amount: Number(pOrder.amount),
                    status: "paid",
                    gateway: gateway.name,
                    gateway_payment_id: fetchedGatewayPaymentId,
                    gateway_order_id: pOrder.gateway_order_id,
                  });

                const { ensurePaymentConfirmationSent } = await import("@/lib/payments/post-payment");
                void ensurePaymentConfirmationSent(pOrder.id);
              }
            }
          } catch (fetchErr) {
            console.warn("Participant me gateway check skipped:", fetchErr);
          }
        }
      }
    } catch (reconcileErr) {
      console.warn("Participant me auto-reconcile error:", reconcileErr);
    }
  }

  // ─── Summary Totals ──────────────────────────────────────
  let totalPayable = 0;
  let totalPaid = 0;
  let totalPending = 0;

  for (const ev of eventsByParticipantEventId.values()) {
    const amt = Number(ev.paymentAmount) || 0;
    if (amt > 0) {
      totalPayable += amt;
      if (ev.paymentStatus === "paid") {
        totalPaid += amt;
      } else if (ev.paymentStatus === "pending") {
        totalPending += amt;
      }
    }
  }

  for (const acc of accommodations) {
    const amt = Number(acc.amount) || 0;
    if (amt > 0) {
      totalPayable += amt;
      if (acc.status === "paid") {
        totalPaid += amt;
      } else if (acc.status === "pending" || acc.status === "unpaid") {
        totalPending += amt;
      }
    }
  }

  return jsonResponse({
    success: true,
    found: true,
    participant: {
      participantId: data.participant_id,
      name: data.name,
      college: data.college,
      email: data.email,
      phone: data.phone,
    },
    events: Array.from(eventsByParticipantEventId.values()),
    accommodations,
    summary: {
      totalPayable,
      totalPaid,
      totalPending,
    },
  });
}
