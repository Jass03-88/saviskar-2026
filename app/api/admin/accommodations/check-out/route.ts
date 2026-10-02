import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireAccommodationAdmin } from "@/lib/supabase/server";

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
 * POST /api/admin/accommodations/check-out
 *
 * Atomically marks a checked-in participant as checked out of accommodation.
 *
 * Invariants:
 * 1. Admin must have accommodation_access = true.
 * 2. Participant accommodation record must exist and status must be 'paid'.
 * 3. Participant must be currently checked in (checked_in = true).
 * 4. Participant must not be already checked out (checked_out = false).
 * 5. Does NOT modify room allocation, hostel, payment, or event check-ins.
 * 6. Checkout is atomic and safe against concurrent duplicate requests.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAccommodationAdmin();
    if (auth.error) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message:
              auth.error === "MFA_REQUIRED"
                ? "Master Admin MFA verification required."
                : auth.error,
          },
        },
        { status: auth.status }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "SERVER_ERROR", message: "Admin service not configured." },
        },
        { status: 500 }
      );
    }

    let body: { participantAccommodationId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: { code: "INVALID_REQUEST", message: "Invalid JSON request body." },
        },
        { status: 400 }
      );
    }

    const { participantAccommodationId } = body;
    if (!participantAccommodationId || typeof participantAccommodationId !== "string" || !participantAccommodationId.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "INVALID_INPUT", message: "participantAccommodationId is required." },
        },
        { status: 400 }
      );
    }

    const cleanAccId = participantAccommodationId.trim();

    // 1. Fetch accommodation booking record
    const { data: acc, error: accError } = await supabaseAdmin
      .from("participant_accommodations")
      .select(`
        id,
        participant_id,
        status,
        hostel_id,
        room_id,
        checked_in,
        checked_in_at,
        checked_out,
        checked_out_at
      `)
      .eq("id", cleanAccId)
      .maybeSingle();

    if (accError || !acc) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "Participant accommodation record not found." },
        },
        { status: 404 }
      );
    }

    // 2. Validate Paid Status
    if (acc.status !== "paid") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "UNPAID",
            message: `Accommodation payment status is '${acc.status}'. Only paid accommodation can check out.`,
          },
        },
        { status: 400 }
      );
    }

    // 3. Validate Checked-In Status (must be checked in first)
    if (!acc.checked_in) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "NOT_CHECKED_IN",
            message: "Participant has not checked in to accommodation yet. Check-in must occur before checkout.",
          },
        },
        { status: 400 }
      );
    }

    // 4. Validate Checked-Out Status (cannot check out twice)
    if (acc.checked_out) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "ALREADY_CHECKED_OUT",
            message: "Participant has already checked out of accommodation.",
          },
        },
        { status: 409 }
      );
    }

    // 5. Atomic Conditional Update
    const nowIso = new Date().toISOString();
    const { data: updatedRows, error: updateError } = await supabaseAdmin
      .from("participant_accommodations")
      .update({
        checked_out: true,
        checked_out_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", cleanAccId)
      .eq("checked_in", true)
      .eq("checked_out", false)
      .eq("status", "paid")
      .select(`
        id,
        participant_id,
        status,
        hostel_id,
        room_id,
        checked_in,
        checked_in_at,
        checked_out,
        checked_out_at,
        updated_at
      `);

    if (updateError) {
      console.error("Checkout update error:", updateError);
      return NextResponse.json(
        {
          success: false,
          error: { code: "UPDATE_FAILED", message: "Failed to record accommodation checkout." },
        },
        { status: 500 }
      );
    }

    if (!updatedRows || updatedRows.length === 0) {
      // Row was modified concurrently
      const { data: recheck } = await supabaseAdmin
        .from("participant_accommodations")
        .select("checked_in, checked_out")
        .eq("id", cleanAccId)
        .maybeSingle();

      if (recheck?.checked_out) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "ALREADY_CHECKED_OUT",
              message: "Participant has already checked out of accommodation.",
            },
          },
          { status: 409 }
        );
      }

      if (!recheck?.checked_in) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "NOT_CHECKED_IN",
              message: "Participant has not checked in to accommodation yet.",
            },
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        {
          success: false,
          error: { code: "CONCURRENT_CONFLICT", message: "Checkout state changed concurrently." },
        },
        { status: 409 }
      );
    }

    const updatedRecord = updatedRows[0];

    // 6. Audit Trail in admin_audit_logs
    if (auth.user?.id) {
      try {
        await supabaseAdmin.from("admin_audit_logs").insert({
          admin_id: auth.user.id,
          action_type: "ACCOMMODATION_CHECK_OUT",
          target_id: cleanAccId,
          details: {
            participant_id: acc.participant_id,
            hostel_id: acc.hostel_id,
            room_id: acc.room_id,
            checked_out_at: nowIso,
          },
        });
      } catch (auditErr) {
        console.error("Accommodation checkout audit failed:", auditErr);
      }
    }

    return NextResponse.json({
      success: true,
      data: updatedRecord,
      message: "Accommodation checkout completed successfully.",
    });
  } catch (err: unknown) {
    console.error("UNHANDLED ACCOMMODATION CHECK-OUT ERROR:", err);
    return NextResponse.json(
      {
        success: false,
        error: { code: "SERVER_ERROR", message: "Internal server error during checkout." },
      },
      { status: 500 }
    );
  }
}
