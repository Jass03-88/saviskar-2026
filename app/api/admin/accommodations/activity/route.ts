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
    const filterAction = searchParams.get("action");
    const filterAdmin = searchParams.get("admin");
    const filterParticipant = searchParams.get("participant");
    const filterBulk = searchParams.get("bulk"); // 'true' or 'false'
    
    // Pagination
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(1000, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)));

    const activities: any[] = [];

    // 1. Fetch Allocations
    let allocQuery = supabaseAdmin
      .from("accommodation_allocations")
      .select(`
        id,
        participant_accommodation_id,
        status,
        reason,
        allocated_by,
        allocated_at,
        created_at,
        hostels ( name ),
        hostel_rooms ( room_number, hostel_floors ( floor_number ) ),
        participant_accommodations!inner (
          participants!inner (
            participant_id,
            name
          )
        )
      `);

    if (filterAdmin) allocQuery = allocQuery.eq("allocated_by", filterAdmin);
    if (filterParticipant) {
      allocQuery = allocQuery.or(`participant_id.ilike.%${filterParticipant}%,name.ilike.%${filterParticipant}%`, { foreignTable: "participant_accommodations.participants" });
    }

    const { data: allocations, error: allocErr } = await allocQuery;
    if (allocErr) {
      console.error("Alloc query error:", allocErr);
    }

    // Process Allocations
    for (const alloc of allocations || []) {
      const isRealloc = alloc.status === "reassigned";
      
      if (filterAction && filterAction !== "ALL") {
        if (filterAction === "ALLOCATION" && isRealloc) continue;
        if (filterAction === "REALLOCATION" && !isRealloc) continue;
        if (filterAction === "CHECK_IN" || filterAction === "CHECK_OUT") continue;
      }

      const pa = Array.isArray(alloc.participant_accommodations) ? alloc.participant_accommodations[0] : alloc.participant_accommodations;
      const part = pa?.participants;
      const p = Array.isArray(part) ? part[0] : part;

      if (filterParticipant) {
        const search = filterParticipant.toLowerCase();
        const pId = (p?.participant_id || "").toLowerCase();
        const pName = (p?.name || "").toLowerCase();
        if (!pId.includes(search) && !pName.includes(search)) {
          continue;
        }
      }

      if (filterBulk && filterBulk !== "ALL") {
        // allocations are never bulk in our current data model (rpc is individual)
        if (filterBulk === "true") continue; 
      }

      const r = Array.isArray(alloc.hostel_rooms) ? alloc.hostel_rooms[0] : alloc.hostel_rooms;
      const h = Array.isArray(alloc.hostels) ? alloc.hostels[0] : alloc.hostels;
      const f = r?.hostel_floors ? (Array.isArray(r.hostel_floors) ? r.hostel_floors[0] : r.hostel_floors) : null;

      activities.push({
        id: alloc.id,
        timestamp: alloc.created_at, // use created_at for historical timestamp
        admin_id: alloc.allocated_by,
        action: isRealloc ? "REALLOCATION" : "ALLOCATION",
        participant_accommodation_id: alloc.participant_accommodation_id,
        participant_id: p?.participant_id || "Unknown",
        participant_name: p?.name || "Unknown",
        hostel_name: h?.name || "Unknown",
        floor_number: f?.floor_number || "Unknown",
        room_number: r?.room_number || "Unknown",
        previous_state: isRealloc ? "Previous Room" : "Unallocated",
        new_state: "Allocated",
        reason: alloc.reason || "Initial allocation",
        bulk_operation: false
      });
    }

    // 2. Fetch Audit Logs
    let auditQuery = supabaseAdmin
      .from("admin_audit_logs")
      .select(`id, admin_id, action_type, target_id, details, created_at`)
      .in("action_type", ["ACCOMMODATION_CHECK_IN", "ACCOMMODATION_CHECK_OUT"]);

    if (filterAdmin) auditQuery = auditQuery.eq("admin_id", filterAdmin);
    if (filterAction && filterAction !== "ALL") {
      if (filterAction === "CHECK_IN") auditQuery = auditQuery.eq("action_type", "ACCOMMODATION_CHECK_IN");
      else if (filterAction === "CHECK_OUT") auditQuery = auditQuery.eq("action_type", "ACCOMMODATION_CHECK_OUT");
      else auditQuery = auditQuery.eq("action_type", "NONE"); // force empty
    }

    const { data: audits, error: auditErr } = await auditQuery;
    if (auditErr) {
      console.error("Audit query error:", auditErr);
    }

    // Process Audits (Need related data)
    if (audits && audits.length > 0) {
      const targetIds = audits.map(a => a.target_id);
      
      const { data: paData } = await supabaseAdmin
        .from("participant_accommodations")
        .select(`
          id,
          participants ( participant_id, name ),
          hostels ( name ),
          hostel_rooms ( room_number, hostel_floors ( floor_number ) )
        `)
        .in("id", targetIds);

      const paMap = new Map();
      for (const pa of paData || []) paMap.set(pa.id, pa);

      for (const audit of audits) {
        const isCheckIn = audit.action_type === "ACCOMMODATION_CHECK_IN";
        const isCheckOut = audit.action_type === "ACCOMMODATION_CHECK_OUT";
        if (filterAction && filterAction !== "ALL") {
          if (filterAction === "CHECK_IN" && !isCheckIn) continue;
          if (filterAction === "CHECK_OUT" && !isCheckOut) continue;
          if (filterAction === "ALLOCATION" || filterAction === "REALLOCATION") continue;
        }

        const isBulk = audit.details?.bulk_operation === true;
        if (filterBulk && filterBulk !== "ALL") {
          if (filterBulk === "true" && !isBulk) continue;
          if (filterBulk === "false" && isBulk) continue;
        }

        const pa = paMap.get(audit.target_id);
        
        // Post-fetch participant filter
        const part = pa?.participants;
        const p = Array.isArray(part) ? part[0] : part;
        if (filterParticipant) {
          const search = filterParticipant.toLowerCase();
          const pId = (p?.participant_id || "").toLowerCase();
          const pName = (p?.name || "").toLowerCase();
          if (!pId.includes(search) && !pName.includes(search)) {
            continue;
          }
        }

        const r = pa?.hostel_rooms ? (Array.isArray(pa.hostel_rooms) ? pa.hostel_rooms[0] : pa.hostel_rooms) : null;
        const h = pa?.hostels ? (Array.isArray(pa.hostels) ? pa.hostels[0] : pa.hostels) : null;
        const f = r?.hostel_floors ? (Array.isArray(r.hostel_floors) ? r.hostel_floors[0] : r.hostel_floors) : null;

        activities.push({
          id: audit.id,
          timestamp: audit.created_at,
          admin_id: audit.admin_id,
          action: isCheckIn ? "CHECK_IN" : "CHECK_OUT",
          participant_accommodation_id: audit.target_id,
          participant_id: p?.participant_id || "Unknown",
          participant_name: p?.name || "Unknown",
          hostel_name: h?.name || "Unknown",
          floor_number: f?.floor_number || "Unknown",
          room_number: r?.room_number || "Unknown",
          previous_state: isCheckIn ? "Not Checked In" : "Checked In",
          new_state: isCheckIn ? "Checked In" : "Checked Out",
          reason: isBulk ? "Bulk Operation" : "Individual Operation",
          bulk_operation: isBulk
        });
      }
    }

    // Admin mapping (fetching emails)
    const adminIdsToFetch = new Set<string>();
    activities.forEach(a => { if (a.admin_id) adminIdsToFetch.add(a.admin_id); });
    
    const adminEmailMap = new Map<string, string>();
    if (adminIdsToFetch.size > 0) {
      // In Supabase, mapping auth.users emails can be tricky via normal API. We rely on the admins table for roles, but email is only in auth.users. 
      // We will fetch emails directly using the adminClient:
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      if (usersData?.users) {
        usersData.users.forEach(u => adminEmailMap.set(u.id, u.email || u.id));
      }
    }

    activities.forEach(a => {
      a.admin_email = a.admin_id ? adminEmailMap.get(a.admin_id) || a.admin_id : "System";
    });

    // Sort by timestamp DESC
    activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Pagination
    const totalCount = activities.length;
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedActivities = activities.slice(startIndex, endIndex);

    return NextResponse.json({
      success: true,
      data: {
        activities: paginatedActivities,
        totalCount,
        page,
        pageSize,
        totalPages: Math.ceil(totalCount / pageSize)
      }
    });

  } catch (err: any) {
    console.error("ACTIVITY ERROR:", err);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Internal server error" } }, { status: 500 });
  }
}
