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

    let limit = 50;
    let participantAccommodationIds: string[] | undefined = undefined;
    try {
      const body = await request.json();
      if (body.limit && typeof body.limit === "number") {
        limit = Math.min(100, Math.max(1, body.limit));
      }
      if (Array.isArray(body.participantAccommodationIds)) {
        participantAccommodationIds = body.participantAccommodationIds;
      }
    } catch {
      // Body might be empty, that's fine
    }

    // 1. Fetch unallocated, paid accommodations
    let query = supabaseAdmin
      .from("participant_accommodations")
      .select(`
        id,
        participant_id,
        status,
        participants ( participant_id, gender )
      `)
      .eq("status", "paid")
      .is("hostel_id", null)
      .is("room_id", null)
      .order("created_at", { ascending: true });

    if (participantAccommodationIds && participantAccommodationIds.length > 0) {
      query = query.in("id", participantAccommodationIds);
    } else {
      query = query.limit(limit);
    }

    const { data: unallocated, error: unallocErr } = await query;

    if (unallocErr) {
      return NextResponse.json({ success: false, error: { code: "DB_ERROR", message: unallocErr.message } }, { status: 500 });
    }

    if (!unallocated || unallocated.length === 0) {
      return NextResponse.json({ success: true, data: { allocated: 0, skipped: 0, failed: 0, results: [] } });
    }

    // 2. Fetch Active Hostels
    const { data: hostels, error: hostelsErr } = await supabaseAdmin
      .from("hostels")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true });

    // 3. Fetch Active Floors
    const { data: floors, error: floorsErr } = await supabaseAdmin
      .from("hostel_floors")
      .select("*")
      .eq("is_active", true)
      .order("floor_number", { ascending: true });

    // 4. Fetch Active Rooms
    const { data: rooms, error: roomsErr } = await supabaseAdmin
      .from("hostel_rooms")
      .select("*")
      .eq("is_active", true)
      .order("room_number", { ascending: true });

    if (hostelsErr || floorsErr || roomsErr) {
      return NextResponse.json({ success: false, error: { code: "DB_ERROR", message: "Failed to load hostels/floors/rooms." } }, { status: 500 });
    }

    // 5. Calculate Current Occupancies
    const { data: activeAllocations, error: allocErr } = await supabaseAdmin
      .from("accommodation_allocations")
      .select("room_id")
      .eq("status", "active");

    if (allocErr) {
      return NextResponse.json({ success: false, error: { code: "DB_ERROR", message: "Failed to load occupancies." } }, { status: 500 });
    }

    const occupancyMap = new Map<string, number>();
    for (const alloc of activeAllocations || []) {
      occupancyMap.set(alloc.room_id, (occupancyMap.get(alloc.room_id) || 0) + 1);
    }

    // Build hierarchical map: Hostel -> Floor -> Room[]
    const activeFloorMap = new Map<string, typeof floors>();
    for (const f of floors || []) {
      const list = activeFloorMap.get(f.hostel_id) || [];
      list.push(f);
      activeFloorMap.set(f.hostel_id, list);
    }

    const activeRoomMap = new Map<string, typeof rooms>();
    for (const r of rooms || []) {
      if (!r.floor_id) continue;
      const list = activeRoomMap.get(r.floor_id) || [];
      list.push(r);
      activeRoomMap.set(r.floor_id, list);
    }

    const results: { participantAccommodationId: string; participantId: string | undefined; status: string; reason: string }[] = [];
    let allocated = 0;
    let skipped = 0;
    let failed = 0;

    // 6. Process allocations
    for (const acc of unallocated) {
      const participantArr = acc.participants as unknown as { participant_id: string; gender: string }[] | null;
      const participant = Array.isArray(participantArr) ? participantArr[0] : participantArr;
      const gender = participant?.gender ? participant.gender.trim().toLowerCase() : null;

      const pushResult = (status: string, reason: string) => {
        results.push({
          participantAccommodationId: acc.id,
          participantId: participant?.participant_id,
          status,
          reason
        });
        if (status === "ALLOCATED") allocated++;
        else if (status === "SKIPPED") skipped++;
        else failed++;
      };

      if (!gender) {
        pushResult("SKIPPED", "MISSING_GENDER");
        continue;
      }
      
      if (gender === "other") {
        pushResult("SKIPPED", "UNSUPPORTED_GENDER");
        continue;
      }

      // Filter eligible hostels
      const eligibleHostels = (hostels || []).filter(h => {
        return h.gender_eligibility === "any" || h.gender_eligibility === "mixed" || h.gender_eligibility === gender;
      });

      if (eligibleHostels.length === 0) {
        pushResult("SKIPPED", "NO_ELIGIBLE_HOSTEL");
        continue;
      }

      // Find available room by hierarchical traversal: Hostel -> Floor -> Room
      let selectedRoom = null;
      let selectedHostelId = null;

      for (const h of eligibleHostels) {
        const hostelFloors = activeFloorMap.get(h.id) || [];
        for (const fl of hostelFloors) {
          const floorRooms = activeRoomMap.get(fl.id) || [];
          for (const rm of floorRooms) {
            const currentOcc = occupancyMap.get(rm.id) || 0;
            if (currentOcc < rm.capacity) {
              selectedRoom = rm;
              selectedHostelId = h.id;
              break;
            }
          }
          if (selectedRoom) break;
        }
        if (selectedRoom) break;
      }

      if (!selectedRoom || !selectedHostelId) {
        pushResult("SKIPPED", "NO_AVAILABLE_ROOM");
        continue;
      }

      // 7. Call RPC
      const { error: rpcError } = await supabaseAdmin.rpc("allocate_accommodation", {
        p_participant_accommodation_id: acc.id,
        p_hostel_id: selectedHostelId,
        p_room_id: selectedRoom.id,
        p_reason: "Auto-allocated",
      });

      if (rpcError) {
        pushResult("FAILED", rpcError.message);
        continue;
      }

      // Successfully allocated, increment local occupancy map
      occupancyMap.set(selectedRoom.id, (occupancyMap.get(selectedRoom.id) || 0) + 1);
      pushResult("ALLOCATED", "ALLOCATED");
    }

    let auditSuccess = true;
    if (auth.user?.id) {
      const successfulAllocations = results.filter(r => r.status === "ALLOCATED");
      if (successfulAllocations.length > 0) {
        const auditLogs = successfulAllocations.map(r => ({
          admin_id: auth.user!.id,
          action_type: "ACCOMMODATION_AUTO_ALLOCATE",
          target_id: r.participantAccommodationId,
          details: {
            reason: "Auto-allocated",
          },
        }));
        
        const { error: auditErr } = await supabaseAdmin.from("admin_audit_logs").insert(auditLogs);
        if (auditErr) {
          console.error("Failed to write audit logs for auto-allocate:", auditErr);
          auditSuccess = false;
        }
      }
    }

    return NextResponse.json({
      success: true,
      auditSuccess,
      data: { allocated, skipped, failed, results }
    });

  } catch (err: unknown) {
    console.error("AUTO ALLOCATE ERROR:", err);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Internal server error" } }, { status: 500 });
  }
}
