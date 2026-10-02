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

export async function GET(request: Request) {
  try {
    const auth = await requireAccommodationAdmin();
    if (auth.error) {
      return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: auth.error } }, { status: auth.status });
    }

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Admin service not configured." } }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const participantAccommodationId = searchParams.get("participantAccommodationId");

    let query = supabaseAdmin
      .from("accommodation_allocations")
      .select(`
        id,
        participant_accommodation_id,
        status,
        reason,
        allocated_by,
        allocated_at,
        deallocated_at,
        created_at,
        hostels ( name ),
        hostel_rooms ( room_number ),
        participant_accommodations (
          participants (
            participant_id,
            name,
            gender
          )
        )
      `)
      .order("created_at", { ascending: false });

    if (participantAccommodationId) {
      query = query.eq("participant_accommodation_id", participantAccommodationId);
    } else {
      const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
      const pageSize = Math.min(1000, Math.max(1, parseInt(searchParams.get("pageSize") || "500", 10)));
      const offset = (page - 1) * pageSize;
      query = query.range(offset, offset + pageSize - 1);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ success: false, error: { code: "DB_ERROR", message: error.message } }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });

  } catch (err: any) {
    console.error("HISTORY ERROR:", err);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Internal server error" } }, { status: 500 });
  }
}
