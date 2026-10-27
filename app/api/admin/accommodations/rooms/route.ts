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

// CREATE ROOM
export async function POST(request: Request) {
  try {
    const auth = await requireAccommodationAdmin();
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
    
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) return NextResponse.json({ error: "No admin config" }, { status: 500 });
    
    const body = await request.json();
    const { hostel_id, floor_id, room_number, capacity, is_active } = body;
    
    if (!hostel_id || !floor_id || !room_number || !capacity || capacity <= 0) {
      return NextResponse.json({ error: "Hostel, floor, room number, and a positive capacity are required." }, { status: 400 });
    }

    // Verify floor belongs to hostel and is active
    const { data: floor, error: floorErr } = await supabaseAdmin
      .from("hostel_floors")
      .select("id, hostel_id, is_active")
      .eq("id", floor_id)
      .single();

    if (floorErr || !floor) {
      return NextResponse.json({ error: "Floor not found." }, { status: 404 });
    }

    if (floor.hostel_id !== hostel_id) {
      return NextResponse.json({ error: "Selected floor does not belong to the chosen hostel." }, { status: 400 });
    }

    if (!floor.is_active) {
      return NextResponse.json({ error: "Cannot create rooms on an inactive floor." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("hostel_rooms")
      .insert({
        hostel_id,
        floor_id,
        room_number: room_number.trim(),
        capacity,
        is_active: is_active ?? true,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") { // unique constraint violation
        return NextResponse.json({ error: "Room number already exists on this floor." }, { status: 409 });
      }
      return NextResponse.json({ error: "Could not create room." }, { status: 500 });
    }

    return NextResponse.json({ room: data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}

// UPDATE ROOM
export async function PATCH(request: Request) {
  try {
    const auth = await requireAccommodationAdmin();
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
    
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) return NextResponse.json({ error: "No admin config" }, { status: 500 });
    
    const body = await request.json();
    const { id, floor_id, room_number, capacity, is_active } = body;
    
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    if (capacity !== undefined && capacity <= 0) {
      return NextResponse.json({ error: "Capacity must be positive." }, { status: 400 });
    }

    // Fetch existing room
    const { data: existingRoom, error: existingErr } = await supabaseAdmin
      .from("hostel_rooms")
      .select("id, hostel_id, floor_id")
      .eq("id", id)
      .single();

    if (existingErr || !existingRoom) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    // If floor_id is being modified, validate it
    if (floor_id && floor_id !== existingRoom.floor_id) {
      const { data: targetFloor, error: floorErr } = await supabaseAdmin
        .from("hostel_floors")
        .select("id, hostel_id, is_active")
        .eq("id", floor_id)
        .single();

      if (floorErr || !targetFloor) {
        return NextResponse.json({ error: "Target floor not found." }, { status: 404 });
      }

      if (targetFloor.hostel_id !== existingRoom.hostel_id) {
        return NextResponse.json({ error: "Floor does not belong to this room's hostel." }, { status: 400 });
      }

      if (!targetFloor.is_active) {
        return NextResponse.json({ error: "Cannot move room to an inactive floor." }, { status: 400 });
      }
    }

    // Check existing allocations to ensure we don't deactivate an occupied room or reduce capacity below occupancy
    const { data: activeAllocs } = await supabaseAdmin
      .from("accommodation_allocations")
      .select("id")
      .eq("room_id", id)
      .eq("status", "active");

    const occupancy = activeAllocs ? activeAllocs.length : 0;

    if (is_active === false && occupancy > 0) {
      return NextResponse.json({ error: "Cannot deactivate an occupied room." }, { status: 400 });
    }

    if (capacity !== undefined && capacity < occupancy) {
      return NextResponse.json({ error: `Cannot reduce capacity below current occupancy (${occupancy}).` }, { status: 400 });
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (floor_id) updatePayload.floor_id = floor_id;
    if (room_number) updatePayload.room_number = room_number.trim();
    if (capacity !== undefined) updatePayload.capacity = capacity;
    if (is_active !== undefined) updatePayload.is_active = is_active;

    const { data, error } = await supabaseAdmin
      .from("hostel_rooms")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      if (error.code === "23505") { // unique constraint violation
        return NextResponse.json({ error: "Room number already exists on this floor." }, { status: 409 });
      }
      return NextResponse.json({ error: "Could not update room." }, { status: 500 });
    }

    return NextResponse.json({ room: data }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}

// DELETE ROOM (RESTRICTED IF ACTIVE ALLOCATIONS OR ACTIVE BOOKINGS EXIST)
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
      return NextResponse.json({ error: "Room ID is required." }, { status: 400 });
    }

    // 1. Check for active participant allocations in this room
    const { data: activeAllocs } = await supabaseAdmin
      .from("accommodation_allocations")
      .select("id")
      .eq("room_id", id)
      .eq("status", "active")
      .limit(1);

    if (activeAllocs && activeAllocs.length > 0) {
      return NextResponse.json(
        { error: "Cannot delete room with active participant allocations. Deallocate or reassign participants first." },
        { status: 400 }
      );
    }

    // 2. Check for assigned participant bookings
    const { data: bookings } = await supabaseAdmin
      .from("participant_accommodations")
      .select("id")
      .eq("room_id", id)
      .not("status", "in", '("cancelled", "failed")')
      .limit(1);

    if (bookings && bookings.length > 0) {
      return NextResponse.json(
        { error: "Cannot delete room currently assigned to participant bookings." },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("hostel_rooms")
      .delete()
      .eq("id", id)
      .select("id");

    if (error) {
      if (error.code === "23503") {
        return NextResponse.json(
          { error: "Cannot delete room because historical allocation records exist. Deactivate the room instead." },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: "Could not delete room." }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: "Room not found or already deleted." }, { status: 404 });
    }

    if (auth.user?.id) {
      try {
        await supabaseAdmin.from("admin_audit_logs").insert({
          admin_id: auth.user.id,
          action_type: "DELETE_ACCOMMODATION_ROOM",
          target_id: id,
          details: { deleted_at: new Date().toISOString() },
        });
      } catch (auditErr) {
        console.error("Failed to write audit log for room deletion:", auditErr);
      }
    }

    return NextResponse.json({ success: true, message: "Room deleted successfully." }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
