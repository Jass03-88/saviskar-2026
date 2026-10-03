import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireAccommodationAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    return null;
  }

  return createSupabaseClient(
    supabaseUrl,
    supabaseSecretKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

export async function GET(request: Request) {
  try {
    const auth = await requireAccommodationAdmin();

    if (auth.error) {
      return NextResponse.json(
        {
          error:
            auth.error === "MFA_REQUIRED"
              ? "Master Admin MFA verification required."
              : auth.error,
        },
        { status: auth.status }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    if (!supabaseAdmin) {
      return NextResponse.json(
        {
          error: "Admin service is not configured.",
        },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(5000, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)));
    const offset = (page - 1) * pageSize;

    const { data: hostels, error: hostelsError } = await supabaseAdmin
      .from("hostels")
      .select("*")
      .order("name", { ascending: true });

    // Load Floors
    const { data: floors, error: floorsError } = await supabaseAdmin
      .from("hostel_floors")
      .select("*")
      .order("floor_number", { ascending: true });

    // Load Rooms
    const { data: rooms, error: roomsError } = await supabaseAdmin
      .from("hostel_rooms")
      .select("*")
      .order("room_number", { ascending: true });

    // Load Plans
    const { data: plans, error: plansError } = await supabaseAdmin
      .from("accommodation_plans")
      .select("*")
      .order("price", { ascending: true });

    // Load Accommodations + Participant Data
    const { data: accommodations, count, error: accError } = await supabaseAdmin
      .from("participant_accommodations")
      .select(`
        id,
        participant_id,
        accommodation_plan_id,
        start_date,
        end_date,
        duration_days,
        amount,
        currency,
        status,
        hostel_id,
        room_id,
        checked_in,
        checked_in_at,
        checked_out,
        checked_out_at,
        created_at,
        participants (
          participant_id,
          name,
          email,
          phone,
          gender,
          state
        )
      `, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (hostelsError || roomsError || plansError || accError) {
      console.error("Accommodation Dashboard Error", { hostelsError, floorsError, roomsError, plansError, accError });
      return NextResponse.json({ error: "Failed to load dashboard data." }, { status: 500 });
    }

    // Now compute occupancy efficiently across Room, Floor, and Hostel
    const { data: activeAllocations, error: allocError } = await supabaseAdmin
      .from("accommodation_allocations")
      .select("hostel_id, room_id")
      .eq("status", "active");

    if (allocError) {
      console.error("Accommodation Allocations Load Error", allocError);
      return NextResponse.json({ error: "Failed to load occupancy data." }, { status: 500 });
    }

    const roomOccupancy = new Map<string, number>();
    const floorOccupancy = new Map<string, number>();
    const hostelOccupancy = new Map<string, number>();

    const roomToFloor = new Map<string, string>();
    if (rooms) {
      for (const r of rooms) {
        if (r.floor_id) roomToFloor.set(r.id, r.floor_id);
      }
    }

    if (activeAllocations) {
      for (const a of activeAllocations) {
        if (a.room_id) {
          roomOccupancy.set(a.room_id, (roomOccupancy.get(a.room_id) ?? 0) + 1);
          const floorId = roomToFloor.get(a.room_id);
          if (floorId) {
            floorOccupancy.set(floorId, (floorOccupancy.get(floorId) ?? 0) + 1);
          }
        }
        if (a.hostel_id) {
          hostelOccupancy.set(a.hostel_id, (hostelOccupancy.get(a.hostel_id) ?? 0) + 1);
        }
      }
    }

    // Calculate total accommodation stats including check-in/out
    const { data: statusStats } = await supabaseAdmin
      .from("participant_accommodations")
      .select("status, checked_in, checked_out, room_id");

    let total = 0, paid = 0, pending = 0, cancelled = 0, checkedIn = 0, checkedOut = 0;
    let allocated = 0, awaitingAllocation = 0;
    if (statusStats) {
      for (const s of statusStats) {
        total++;
        if (s.status === "paid") {
          paid++;
          if (s.room_id) allocated++;
          else awaitingAllocation++;
        }
        else if (s.status === "pending" || s.status === "unpaid") pending++;
        else if (s.status === "cancelled" || s.status === "failed") cancelled++;
        
        if (s.checked_out) checkedOut++;
        else if (s.checked_in) checkedIn++;
      }
    }

    let totalCapacity = 0;
    if (rooms) {
      for (const r of rooms) {
        if (r.is_active) totalCapacity += r.capacity;
      }
    }
    const occupiedCapacity = activeAllocations?.length ?? 0;

    return NextResponse.json(
      {
        accommodations: accommodations ?? [],
        hostels: hostels ?? [],
        floors: floors ?? [],
        rooms: rooms ?? [],
        plans: plans ?? [],
        roomOccupancy: Object.fromEntries(roomOccupancy),
        floorOccupancy: Object.fromEntries(floorOccupancy),
        hostelOccupancy: Object.fromEntries(hostelOccupancy),
        stats: { total, paid, pending, cancelled, checkedIn, checkedOut, allocated, awaitingAllocation, totalCapacity, occupiedCapacity },
        page,
        pageSize,
        totalCount: count ?? 0,
        role: auth.role,
      },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (err) {
    console.error("UNHANDLED ACCOMMODATION DASHBOARD GET ERROR:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
