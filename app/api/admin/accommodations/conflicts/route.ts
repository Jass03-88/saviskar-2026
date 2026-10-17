import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) return null;

  return createSupabaseClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * GET /api/admin/accommodations/conflicts
 *
 * Dedicated admin endpoint to retrieve late payment settlement conflicts
 * where a payment order was confirmed on the gateway, but the requested
 * accommodation dates could not be safely confirmed due to an overlap conflict.
 *
 * Access: Master Admins or Admins with Accommodation Access.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin();

    if (auth.error) {
      return NextResponse.json(
        {
          success: false,
          error:
            auth.error === "MFA_REQUIRED"
              ? "Master Admin MFA verification required."
              : auth.error,
        },
        { status: auth.status }
      );
    }

    if (auth.role !== "master" && !auth.accommodation_access) {
      return NextResponse.json(
        {
          success: false,
          error: "Forbidden: Accommodation access required to view conflict records.",
        },
        { status: 403 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json(
        { success: false, error: "Database service not configured." },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // 1. Query conflict audit logs recorded during payment settlement
    const { data: logs, count, error: logsError } = await supabaseAdmin
      .from("admin_audit_logs")
      .select("id, action_type, target_id, details, created_at", {
        count: "exact",
      })
      .eq("action_type", "ACCOMMODATION_PAYMENT_OVERLAP_CONFLICT")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (logsError) {
      console.error("Failed to query accommodation conflict audit logs:", logsError);
      return NextResponse.json(
        { success: false, error: "Could not load conflict records." },
        { status: 500 }
      );
    }

    const conflictLogs = logs ?? [];
    if (conflictLogs.length === 0) {
      return NextResponse.json({
        success: true,
        conflicts: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0,
      });
    }

    // 2. Collect IDs for batched authoritative lookups
    const participantUuids = new Set<string>();
    const paymentOrderIds = new Set<string>();
    const accommodationIds = new Set<string>();

    for (const log of conflictLogs) {
      if (log.target_id) accommodationIds.add(log.target_id);
      const details = (log.details || {}) as Record<string, any>;
      if (details.participant_id) participantUuids.add(details.participant_id);
      if (details.payment_order_id) paymentOrderIds.add(details.payment_order_id);
    }

    // 3. Batched Queries for Enriched Participant, Order, and Accommodation Information
    const [participantsRes, ordersRes, accRes] = await Promise.all([
      participantUuids.size > 0
        ? supabaseAdmin
            .from("participants")
            .select("id, participant_id, name, email, phone, college")
            .in("id", Array.from(participantUuids))
        : { data: [] },
      paymentOrderIds.size > 0
        ? supabaseAdmin
            .from("payment_orders")
            .select("id, order_reference, status, amount, currency, created_at")
            .in("id", Array.from(paymentOrderIds))
        : { data: [] },
      participantUuids.size > 0
        ? supabaseAdmin
            .from("participant_accommodations")
            .select(`
              id,
              participant_id,
              status,
              start_date,
              end_date,
              duration_days,
              amount,
              hostel_id,
              room_id,
              hostels ( name ),
              hostel_rooms ( room_number ),
              accommodation_plans (
                name,
                slug,
                duration
              )
            `)
            .in("participant_id", Array.from(participantUuids))
        : { data: [] },
    ]);

    const participantsById = new Map<string, any>(
      (participantsRes.data || []).map((p: any) => [p.id, p])
    );
    const ordersById = new Map<string, any>(
      (ordersRes.data || []).map((o: any) => [o.id, o])
    );
    const accById = new Map<string, any>(
      (accRes.data || []).map((a: any) => [a.id, a])
    );

    const activeAccsByParticipantId = new Map<string, any[]>();
    for (const a of (accRes.data || [])) {
      if (a.participant_id && (a.status === "paid" || a.status === "confirmed")) {
        const list = activeAccsByParticipantId.get(a.participant_id) || [];
        list.push(a);
        activeAccsByParticipantId.set(a.participant_id, list);
      }
    }

    // 4. Construct Sanitized, Enriched Conflict Records
    const conflicts = conflictLogs.map((log) => {
      const details = (log.details || {}) as Record<string, any>;
      const participant = details.participant_id
        ? participantsById.get(details.participant_id)
        : null;
      const order = details.payment_order_id
        ? ordersById.get(details.payment_order_id)
        : null;
      const acc = log.target_id ? accById.get(log.target_id) : null;

      const rawPlan = acc?.accommodation_plans;
      const plan = Array.isArray(rawPlan) ? rawPlan[0] : rawPlan;

      // Conservative Resolution Status Determination (No Speculation)
      const participantActiveStays = participant?.id
        ? activeAccsByParticipantId.get(participant.id) || []
        : [];
      const separateActiveAcc = participantActiveStays.find((a) => a.id !== log.target_id);

      const separateStay = separateActiveAcc
        ? {
            id: separateActiveAcc.id,
            planName:
              (Array.isArray(separateActiveAcc.accommodation_plans)
                ? separateActiveAcc.accommodation_plans[0]?.name
                : separateActiveAcc.accommodation_plans?.name) || "Accommodation Stay",
            startDate: separateActiveAcc.start_date,
            endDate: separateActiveAcc.end_date,
            status: separateActiveAcc.status,
            roomNumber:
              (Array.isArray(separateActiveAcc.hostel_rooms)
                ? separateActiveAcc.hostel_rooms[0]?.room_number
                : separateActiveAcc.hostel_rooms?.room_number) || null,
            hostelName:
              (Array.isArray(separateActiveAcc.hostels)
                ? separateActiveAcc.hostels[0]?.name
                : separateActiveAcc.hostels?.name) || null,
          }
        : null;

      const resolutionStatus = "REQUIRES_MANUAL_VERIFICATION";
      let resolutionNotes =
        "Payment captured on gateway. Accommodation stay unconfirmed due to date conflict. Staff must review the original requested dates and payment amount to determine if an alternative stay or a PayU refund is required.";

      if (separateStay) {
        resolutionNotes =
          "Another accommodation booking exists for this participant. Staff must verify the dates and determine whether this conflict requires an alternative stay or a refund.";
        if (order?.status === "refunded") {
          resolutionNotes +=
            " Note: Payment order is marked refunded in database; gateway refund must be independently verified on the PayU Merchant Dashboard.";
        }
      } else if (order?.status === "refunded") {
        resolutionNotes =
          "Payment order is marked refunded in database. Gateway refund must be independently verified on the PayU Merchant Dashboard.";
      }

      return {
        id: log.id,
        conflictDetectedAt: log.created_at,
        reason:
          details.reason ||
          "Late payment captured on gateway, but stay dates conflict with another booking.",
        resolutionStatus,
        resolutionNotes,
        separateStay,
        participant: participant
          ? {
              id: participant.id,
              participantId: participant.participant_id,
              name: participant.name,
              email: participant.email,
              phone: participant.phone,
              college: participant.college,
            }
          : {
              id: details.participant_id || "unknown",
              participantId: "Unknown",
              name: "Unknown Participant",
              email: null,
              phone: null,
              college: null,
            },
        paymentOrder: order
          ? {
              id: order.id,
              orderReference: order.order_reference,
              status: order.status,
              amount: Number(order.amount),
              currency: order.currency || "INR",
              createdAt: order.created_at,
            }
          : {
              id: details.payment_order_id || "unknown",
              orderReference: "Unknown",
              status: "paid",
              amount: Number(details.amount) || 0,
              currency: "INR",
              createdAt: log.created_at,
            },
        accommodation: {
          id: log.target_id,
          status: acc?.status || "cancelled",
          planName: plan?.name || "Accommodation Stay",
          startDate: acc?.start_date || details.start_date || "2026-10-28",
          endDate: acc?.end_date || details.end_date || "2026-10-29",
          durationDays: acc?.duration_days || (plan as any)?.duration || 1,
          amount: Number(acc?.amount) || Number(details.amount) || 0,
          hostelId: acc?.hostel_id || null,
          roomId: acc?.room_id || null,
        },
      };
    });

    const total = count ?? conflicts.length;

    return NextResponse.json({
      success: true,
      conflicts,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    console.error("Unhandled error in admin accommodation conflicts endpoint:", err);
    return NextResponse.json(
      { success: false, error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
