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

// CREATE HOSTEL
export async function POST(request: Request) {
  try {
    const auth = await requireAccommodationAdmin();
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
    
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) return NextResponse.json({ error: "No admin config" }, { status: 500 });
    
    const body = await request.json();
    const { name, gender_eligibility, is_active } = body;
    
    if (!name || !gender_eligibility) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from("hostels")
      .insert({ name, gender_eligibility, is_active: is_active ?? true })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Could not create hostel" }, { status: 500 });
    }

    return NextResponse.json({ hostel: data }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}

// UPDATE HOSTEL
export async function PATCH(request: Request) {
  try {
    const auth = await requireAccommodationAdmin();
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
    
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) return NextResponse.json({ error: "No admin config" }, { status: 500 });
    
    const body = await request.json();
    const { id, name, gender_eligibility, is_active } = body;
    
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    // Validate Deactivation safety
    if (is_active === false) {
      // Check if there are active rooms or active allocations
      const { data: activeAllocs } = await supabaseAdmin
        .from("participant_accommodations")
        .select("id")
        .eq("hostel_id", id)
        .not("status", "in", '("cancelled", "failed")')
        .limit(1);

      if (activeAllocs && activeAllocs.length > 0) {
        return NextResponse.json({ error: "Cannot deactivate hostel with active allocations." }, { status: 400 });
      }

      // Also check if any rooms are active (wait, it's safer just to disable rooms independently or warn, let's just do active allocs)
    }

    const { data, error } = await supabaseAdmin
      .from("hostels")
      .update({ name, gender_eligibility, is_active, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Could not update hostel" }, { status: 500 });
    }

    return NextResponse.json({ hostel: data }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}

// DELETE HOSTEL (RESTRICTED IF FLOORS, ROOMS, OR ACTIVE ALLOCATIONS EXIST)
export async function DELETE(request: Request) {
  try {
    const auth = await requireAccommodationAdmin();
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json({ error: "No admin config" }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    let id = searchParams.get("id");

    if (!id && request.headers.get("content-type")?.includes("application/json")) {
      const body = await request.json().catch(() => null);
      if (body) id = body.id;
    }

    if (!id) {
      return NextResponse.json({ error: "Hostel ID is required." }, { status: 400 });
    }

    // 1. Check if any floors exist in this hostel
    const { data: floors } = await supabaseAdmin
      .from("hostel_floors")
      .select("id")
      .eq("hostel_id", id)
      .limit(1);

    if (floors && floors.length > 0) {
      return NextResponse.json(
        { error: "Cannot delete hostel that contains floors. Delete or reassign floors first." },
        { status: 400 }
      );
    }

    // 2. Check if any rooms exist in this hostel
    const { data: rooms } = await supabaseAdmin
      .from("hostel_rooms")
      .select("id")
      .eq("hostel_id", id)
      .limit(1);

    if (rooms && rooms.length > 0) {
      return NextResponse.json(
        { error: "Cannot delete hostel that contains rooms. Delete or reassign rooms first." },
        { status: 400 }
      );
    }

    // 3. Check for active allocations
    const { data: activeAllocs } = await supabaseAdmin
      .from("accommodation_allocations")
      .select("id")
      .eq("hostel_id", id)
      .eq("status", "active")
      .limit(1);

    if (activeAllocs && activeAllocs.length > 0) {
      return NextResponse.json(
        { error: "Cannot delete hostel with active participant allocations." },
        { status: 400 }
      );
    }

    // 4. Check for assigned active bookings
    const { data: bookings } = await supabaseAdmin
      .from("participant_accommodations")
      .select("id")
      .eq("hostel_id", id)
      .not("status", "in", '("cancelled", "failed")')
      .limit(1);

    if (bookings && bookings.length > 0) {
      return NextResponse.json(
        { error: "Cannot delete hostel with assigned participant bookings." },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("hostels")
      .delete()
      .eq("id", id)
      .select("id");

    if (error) {
      if (error.code === "23503") {
        return NextResponse.json(
          { error: "Cannot delete hostel because related records exist. Deactivate the hostel instead." },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: "Could not delete hostel." }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: "Hostel not found or already deleted." }, { status: 404 });
    }

    if (auth.user?.id) {
      try {
        await supabaseAdmin.from("admin_audit_logs").insert({
          admin_id: auth.user.id,
          action_type: "DELETE_ACCOMMODATION_HOSTEL",
          target_id: id,
          details: { deleted_at: new Date().toISOString() },
        });
      } catch (auditErr) {
        console.error("Failed to write audit log for hostel deletion:", auditErr);
      }
    }

    return NextResponse.json({ success: true, message: "Hostel deleted successfully." }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
