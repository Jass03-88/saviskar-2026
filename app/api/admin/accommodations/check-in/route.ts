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
 * POST /api/admin/accommodations/check-in
 *
 * Atomically marks an allocated participant as checked in to accommodation.
 *
 * Invariants:
 * 1. Admin must have accommodation_access = true.
 * 2. Participant accommodation record must exist and status must be 'paid'.
 * 3. An active allocation must exist for the participant.
 * 4. Allocated hostel, floor, and room must exist and be active.
 * 5. Participant must not be already checked in.
 * 6. Participant must not be already checked out.
 * 7. Check-in is atomic and safe against concurrent duplicate requests.
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
        checked_out_at,
        start_date,
        end_date
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
            message: `Accommodation payment status is '${acc.status}'. Only paid accommodation can check in.`,
          },
        },
        { status: 400 }
      );
    }

    // 3. Validate Lifecycle States (not checked out, not already checked in)
    if (acc.checked_out) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "ALREADY_CHECKED_OUT",
            message: "Participant has already checked out of accommodation.",
          },
        },
        { status: 400 }
      );
    }

    if (acc.checked_in) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "ALREADY_CHECKED_IN",
            message: "Participant has already checked in to accommodation.",
          },
        },
        { status: 409 }
      );
    }

    // 4. Validate Active Allocation Exists
    if (!acc.hostel_id || !acc.room_id) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "UNALLOCATED",
            message: "Participant accommodation is awaiting room allocation.",
          },
        },
        { status: 400 }
      );
    }

    const { data: activeAlloc, error: allocError } = await supabaseAdmin
      .from("accommodation_allocations")
      .select("id, status, hostel_id, room_id")
      .eq("participant_accommodation_id", cleanAccId)
      .eq("status", "active")
      .maybeSingle();

    if (allocError || !activeAlloc || activeAlloc.room_id !== acc.room_id) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "NO_ACTIVE_ALLOCATION",
            message: "No active room allocation found for this accommodation.",
          },
        },
        { status: 400 }
      );
    }

    // 5. Validate Allocated Hostel Is Active
    const { data: hostel, error: hostelError } = await supabaseAdmin
      .from("hostels")
      .select("id, is_active")
      .eq("id", acc.hostel_id)
      .maybeSingle();

    if (hostelError || !hostel || !hostel.is_active) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "HOSTEL_INACTIVE",
            message: "Allocated hostel is inactive or not found.",
          },
        },
        { status: 400 }
      );
    }

    // 6. Validate Allocated Room and Floor Are Active
    const { data: room, error: roomError } = await supabaseAdmin
      .from("hostel_rooms")
      .select(`
        id,
        is_active,
        floor_id,
        hostel_floors (
          id,
          is_active
        )
      `)
      .eq("id", acc.room_id)
      .maybeSingle();

    if (roomError || !room || !room.is_active) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "ROOM_INACTIVE",
            message: "Allocated room is inactive or not found.",
          },
        },
        { status: 400 }
      );
    }

    type FloorRelation = { id: string; is_active: boolean };
    const floor = (
      Array.isArray(room.hostel_floors)
        ? room.hostel_floors[0]
        : room.hostel_floors
    ) as FloorRelation | null | undefined;

    if (!floor || !floor.is_active) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FLOOR_INACTIVE",
            message: "Allocated floor is inactive or not found.",
          },
        },
        { status: 400 }
      );
    }

    // Optional: read configured dates from festival_config
    const { data: festConfig } = await supabaseAdmin
      .from("festival_config")
      .select("accommodation_start_date, accommodation_end_date")
      .eq("id", "current")
      .maybeSingle();

    // 7. Atomic Conditional Update
    const nowIso = new Date().toISOString();
    const { data: updatedRows, error: updateError } = await supabaseAdmin
      .from("participant_accommodations")
      .update({
        checked_in: true,
        checked_in_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", cleanAccId)
      .eq("checked_in", false)
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
      console.error("Check-in update error:", updateError);
      return NextResponse.json(
        {
          success: false,
          error: { code: "UPDATE_FAILED", message: "Failed to record accommodation check-in." },
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

      if (recheck?.checked_in) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "ALREADY_CHECKED_IN",
              message: "Participant has already checked in to accommodation.",
            },
          },
          { status: 409 }
        );
      }

      if (recheck?.checked_out) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "ALREADY_CHECKED_OUT",
              message: "Participant has already checked out of accommodation.",
            },
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        {
          success: false,
          error: { code: "CONCURRENT_CONFLICT", message: "Check-in state changed concurrently." },
        },
        { status: 409 }
      );
    }

    const updatedRecord = updatedRows[0];

    // 8. Audit Trail in admin_audit_logs
    if (auth.user?.id) {
      try {
        await supabaseAdmin.from("admin_audit_logs").insert({
          admin_id: auth.user.id,
          action_type: "ACCOMMODATION_CHECK_IN",
          target_id: cleanAccId,
          details: {
            participant_id: acc.participant_id,
            hostel_id: acc.hostel_id,
            room_id: acc.room_id,
            checked_in_at: nowIso,
            festival_config_start: festConfig?.accommodation_start_date ?? null,
            festival_config_end: festConfig?.accommodation_end_date ?? null,
          },
        });
      } catch (auditErr) {
        console.error("Accommodation check-in audit failed:", auditErr);
      }
    }

    return NextResponse.json({
      success: true,
      data: updatedRecord,
      message: "Accommodation check-in completed successfully.",
    });
  } catch (err: unknown) {
    console.error("UNHANDLED ACCOMMODATION CHECK-IN ERROR:", err);
    return NextResponse.json(
      {
        success: false,
        error: { code: "SERVER_ERROR", message: "Internal server error during check-in." },
      },
      { status: 500 }
    );
  }
}
