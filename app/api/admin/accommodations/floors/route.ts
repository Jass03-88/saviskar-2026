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

// GET FLOORS
export async function GET(request: Request) {
  try {
    const auth = await requireAccommodationAdmin();
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) return NextResponse.json({ error: "No admin config" }, { status: 500 });

    const { searchParams } = new URL(request.url);
    const hostelId = searchParams.get("hostel_id");

    let query = supabaseAdmin
      .from("hostel_floors")
      .select("*")
      .order("floor_number", { ascending: true });

    if (hostelId) {
      query = query.eq("hostel_id", hostelId);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: "Could not fetch floors" }, { status: 500 });
    }

    return NextResponse.json({ floors: data ?? [] }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}

// CREATE FLOOR
export async function POST(request: Request) {
  try {
    const auth = await requireAccommodationAdmin();
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) return NextResponse.json({ error: "No admin config" }, { status: 500 });

    const body = await request.json();
    const { hostel_id, floor_number, name, is_active } = body;

    if (!hostel_id || floor_number === undefined || floor_number === null || typeof floor_number !== "number" || floor_number < 0) {
      return NextResponse.json({ error: "Hostel ID and a non-negative floor number are required." }, { status: 400 });
    }

    // Verify hostel exists and is active
    const { data: hostel, error: hostelErr } = await supabaseAdmin
      .from("hostels")
      .select("id, is_active")
      .eq("id", hostel_id)
      .single();

    if (hostelErr || !hostel) {
      return NextResponse.json({ error: "Hostel not found." }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin
      .from("hostel_floors")
      .insert({
        hostel_id,
        floor_number,
        name: name?.trim() || null,
        is_active: is_active ?? true,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "Floor number already exists in this hostel." }, { status: 409 });
      }
      return NextResponse.json({ error: "Could not create floor." }, { status: 500 });
    }

    return NextResponse.json({ floor: data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}

// UPDATE FLOOR
export async function PATCH(request: Request) {
  try {
    const auth = await requireAccommodationAdmin();
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) return NextResponse.json({ error: "No admin config" }, { status: 500 });

    const body = await request.json();
    const { id, floor_number, name, is_active } = body;

    if (!id) return NextResponse.json({ error: "Floor ID is required." }, { status: 400 });
    if (floor_number !== undefined && (typeof floor_number !== "number" || floor_number < 0)) {
      return NextResponse.json({ error: "Floor number must be a non-negative integer." }, { status: 400 });
    }

    // If deactivating, check if floor has active allocations
    if (is_active === false) {
      // Find rooms on this floor
      const { data: floorRooms } = await supabaseAdmin
        .from("hostel_rooms")
        .select("id")
        .eq("floor_id", id);

      if (floorRooms && floorRooms.length > 0) {
        const roomIds = floorRooms.map((r) => r.id);
        const { data: activeAllocs } = await supabaseAdmin
          .from("accommodation_allocations")
          .select("id")
          .in("room_id", roomIds)
          .eq("status", "active")
          .limit(1);

        if (activeAllocs && activeAllocs.length > 0) {
          return NextResponse.json(
            { error: "Cannot deactivate a floor that currently has active participant allocations." },
            { status: 400 }
          );
        }
      }
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (floor_number !== undefined) updatePayload.floor_number = floor_number;
    if (name !== undefined) updatePayload.name = name?.trim() || null;
    if (is_active !== undefined) updatePayload.is_active = is_active;

    const { data, error } = await supabaseAdmin
      .from("hostel_floors")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "Floor number already exists in this hostel." }, { status: 409 });
      }
      return NextResponse.json({ error: "Could not update floor." }, { status: 500 });
    }

    return NextResponse.json({ floor: data }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}

// DELETE FLOOR (RESTRICTED IF ROOMS EXIST)
export async function DELETE(request: Request) {
  try {
    const auth = await requireAccommodationAdmin();
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) return NextResponse.json({ error: "No admin config" }, { status: 500 });

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) return NextResponse.json({ error: "Floor ID is required." }, { status: 400 });

    // Check if any rooms exist on this floor
    const { data: rooms } = await supabaseAdmin
      .from("hostel_rooms")
      .select("id")
      .eq("floor_id", id)
      .limit(1);

    if (rooms && rooms.length > 0) {
      return NextResponse.json(
        { error: "Cannot delete floor with existing rooms. Deactivate the floor instead." },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("hostel_floors")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: "Could not delete floor." }, { status: 500 });
    }

    await supabaseAdmin.from("admin_audit_logs").insert({
      admin_id: auth.user.id,
      action_type: "DELETE_ACCOMMODATION_FLOOR",
      target_id: id,
      details: { deleted_at: new Date().toISOString() },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
