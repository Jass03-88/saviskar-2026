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

export async function POST(request: Request) {
  try {
    const auth = await requireAccommodationAdmin();
    if (auth.error) {
      return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: auth.error } }, { status: auth.status });
    }

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Admin service not configured." } }, { status: 500 });
    }

    const body = await request.json();
    const { participantAccommodationId, hostelId, roomId, reason } = body;

    if (!participantAccommodationId || !hostelId || !roomId) {
      return NextResponse.json({ success: false, error: { code: "INVALID_INPUT", message: "Missing required UUIDs." } }, { status: 400 });
    }
    
    if (!reason || reason.trim() === "") {
      return NextResponse.json({ success: false, error: { code: "INVALID_INPUT", message: "Reason is required for reallocation." } }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.rpc("allocate_accommodation", {
      p_participant_accommodation_id: participantAccommodationId,
      p_hostel_id: hostelId,
      p_room_id: roomId,
      p_reason: reason.trim(),
    });

    if (error) {
      let code = "ALLOCATION_FAILED";
      let status = 400;
      if (error.message.includes("Capacity exceeded")) code = "ROOM_FULL";
      if (error.message.includes("GENDER_MISMATCH")) code = "GENDER_MISMATCH";
      if (error.message.includes("UNSUPPORTED_GENDER")) code = "UNSUPPORTED_GENDER";
      if (error.message.includes("Status must be paid")) code = "UNPAID";
      
      return NextResponse.json({ success: false, error: { code, message: error.message } }, { status });
    }

    if (auth.user?.id) {
      try {
        await supabaseAdmin.from("admin_audit_logs").insert({
          admin_id: auth.user.id,
          action_type: "ACCOMMODATION_REALLOCATE",
          target_id: participantAccommodationId,
          details: {
            hostel_id: hostelId,
            room_id: roomId,
            reason: reason.trim(),
          },
        });
      } catch (auditErr) {
        console.error("Failed to write audit log for reallocate:", auditErr);
      }
    }

    return NextResponse.json({ success: true, data });

  } catch (err: any) {
    console.error("REALLOCATE ERROR:", err);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Internal server error" } }, { status: 500 });
  }
}
