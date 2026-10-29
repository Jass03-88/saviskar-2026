/**
 * app/api/admin/accommodations/export/route.ts
 *
 * Server-Side Accommodation Export Endpoint.
 *
 * Retrieves EVERY authorized accommodation record directly from Supabase
 * in paginated batches of 1,000, completely bypassing browser UI limits and
 * pagination caps.
 *
 * Features:
 * - Strictly authorized via requireAccommodationAdmin().
 * - Supports scope="all" (complete database dataset) and scope="filtered" (active filter criteria).
 * - Supports format="xlsx" (direct binary Excel stream) and format="json".
 * - Never alters or deletes database records (Read-Only).
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireAccommodationAdmin } from "@/lib/supabase/server";
import { buildAccommodationWorkbook } from "@/lib/admin/accommodation-excel-export";

export const dynamic = "force-dynamic";

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    return null;
  }

  return createSupabaseClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

const DB_BATCH_SIZE = 1000;

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
        { error: "Admin service is not configured." },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const scope = (searchParams.get("scope") || "all").toLowerCase();
    const format = (searchParams.get("format") || "xlsx").toLowerCase();

    // Filter params (applied when scope === "filtered")
    const filterStatus = searchParams.get("status") || "all";
    const filterGender = searchParams.get("gender") || "all";
    const filterType = searchParams.get("type") || "all";
    const filterState = searchParams.get("state") || "all";
    const filterDuration = searchParams.get("duration") || "all";
    const filterDate = searchParams.get("date") || "all";
    const filterStartDate = searchParams.get("startDate") || "all";
    const filterCheckoutDate = searchParams.get("checkoutDate") || "all";
    const filterCheckIn = searchParams.get("checkIn") || "all";
    const filterHostel = searchParams.get("hostelId") || "all";
    const filterRoom = searchParams.get("roomId") || "all";
    const search = searchParams.get("search")?.trim() || "";

    // 1. Fetch auxiliary reference tables (Hostels, Floors, Rooms, Plans)
    const [hostelsRes, floorsRes, roomsRes, plansRes] = await Promise.all([
      supabaseAdmin.from("hostels").select("*").order("name", { ascending: true }),
      supabaseAdmin.from("hostel_floors").select("*").order("floor_number", { ascending: true }),
      supabaseAdmin.from("hostel_rooms").select("*").order("room_number", { ascending: true }),
      supabaseAdmin.from("accommodation_plans").select("*").order("price", { ascending: true }),
    ]);

    const hostels = hostelsRes.data || [];
    const floors = floorsRes.data || [];
    const rooms = roomsRes.data || [];
    const plans = plansRes.data || [];

    // 2. Keyset-Paginated Fetch of Accommodation Records
    // Uses UUID primary-key cursor (.order("id", { ascending: true }).limit(DB_BATCH_SIZE))
    // advancing via .gt("id", lastSeenId) to eliminate offset-pagination drift.
    // Bound by an upper ceiling (.lte("created_at", exportSnapshotTime)) to prevent new
    // insertions from shifting the query during iteration.
    // Note: Keyset pagination on UUID primary key provides insertion-drift immunity, but
    // is not an MVCC repeatable-read snapshot; concurrent in-place updates or deletions
    // occurring across separate HTTP requests remain subject to PostgreSQL Read Committed semantics.
    const exportSnapshotTime = new Date().toISOString();
    const allAccommodations: any[] = [];
    const seenIds = new Set<string>();
    let lastSeenId: string | null = null;
    let hasMore = true;

    while (hasMore) {
      let query = supabaseAdmin
        .from("participant_accommodations")
        .select(`
          id,
          participant_id,
          accommodation_plan_id,
          payment_order_id,
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
          payment_orders (
            order_reference,
            gateway_payment_id,
            status
          ),
          participants (
            participant_id,
            name,
            email,
            phone,
            gender,
            state,
            college,
            faculty_incharges ( id, registration_group_id ),
            participant_events (
              id,
              team_name,
              registration_group_id,
              participant_id,
              participants ( participant_id, name )
            ),
            participant_event_members (
              id,
              participant_event_id,
              is_team_leader,
              participant_events (
                id,
                team_name,
                registration_group_id,
                participant_id,
                participants ( participant_id, name )
              )
            )
          )
        `)
        .lte("created_at", exportSnapshotTime)
        .order("id", { ascending: true })
        .limit(DB_BATCH_SIZE);

      if (lastSeenId) {
        query = query.gt("id", lastSeenId);
      }

      const { data: batchData, error: batchError } = await query;

      if (batchError) {
        console.error("Accommodation export batch error:", batchError);
        return NextResponse.json(
          { error: `Database error during accommodation export: ${batchError.message}` },
          { status: 500 }
        );
      }

      if (!batchData || batchData.length === 0) {
        hasMore = false;
      } else {
        for (const item of batchData) {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            allAccommodations.push(item);
          }
        }
        if (batchData.length < DB_BATCH_SIZE) {
          hasMore = false;
        } else {
          lastSeenId = batchData[batchData.length - 1].id;
        }
      }
    }

    // Deterministic sort: canonical created_at DESC, id DESC
    allAccommodations.sort((a, b) => {
      const timeDiff = new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      if (timeDiff !== 0) return timeDiff;
      return String(b.id || "").localeCompare(String(a.id || ""));
    });

    // Populate computed participant attributes (e.g. is_faculty) aligned with dashboard logic
    for (const acc of allAccommodations) {
      if (acc.participants) {
        const facultyCount = acc.participants.faculty_incharges?.length ?? 0;
        const eventCount =
          (acc.participants.participant_events?.length ?? 0) +
          (acc.participants.participant_event_members?.length ?? 0);
        acc.participants.is_faculty = facultyCount > 0 && eventCount === 0;
      }
    }

    // 3. Filter Application (if scope === "filtered")
    let targetRecords = allAccommodations;

    if (scope === "filtered") {
      targetRecords = allAccommodations.filter((acc) => {
        const p = acc.participants;
        if (!p) return false;

        const q = search.trim().toLowerCase();
        const qDigits = q.replace(/\D/g, "");
        const room = rooms.find((r) => r.id === acc.room_id);
        const hostel = hostels.find((h) => h.id === acc.hostel_id);

        const hasTeamMatch =
          p.participant_events?.some((pe: any) => pe.team_name?.toLowerCase().includes(q)) ||
          p.participant_event_members?.some((pem: any) =>
            pem.participant_events?.team_name?.toLowerCase().includes(q)
          );

        const matchesSearch =
          !q ||
          p.name?.toLowerCase().includes(q) ||
          p.email?.toLowerCase().includes(q) ||
          p.participant_id?.toLowerCase().includes(q) ||
          (p.college && p.college.toLowerCase().includes(q)) ||
          (p.state && p.state.toLowerCase().includes(q)) ||
          (p.phone &&
            (p.phone.toLowerCase().includes(q) ||
              (qDigits.length >= 3 && p.phone.replace(/\D/g, "").includes(qDigits)))) ||
          room?.room_number?.toLowerCase().includes(q) ||
          hostel?.name?.toLowerCase().includes(q) ||
          Boolean(hasTeamMatch);

        const po = Array.isArray(acc.payment_orders) ? acc.payment_orders[0] : acc.payment_orders;
        const poStatus = po?.status ? String(po.status).toLowerCase() : "";
        const accStatus = acc.status ? String(acc.status).toLowerCase() : "";

        let matchesStatus = true;
        if (filterStatus === "all") {
          // "Active Only": exclude cancelled, failed, and refunded bookings
          matchesStatus =
            accStatus !== "cancelled" &&
            accStatus !== "failed" &&
            accStatus !== "refunded" &&
            poStatus !== "refunded" &&
            poStatus !== "failed" &&
            poStatus !== "cancelled";
        } else if (filterStatus === "all_statuses") {
          matchesStatus = true;
        } else if (filterStatus === "paid") {
          matchesStatus =
            (accStatus === "paid" || poStatus === "paid" || poStatus === "completed") &&
            accStatus !== "refunded" &&
            poStatus !== "refunded" &&
            accStatus !== "cancelled" &&
            poStatus !== "cancelled";
        } else if (filterStatus === "pending") {
          matchesStatus =
            (accStatus === "pending" || poStatus === "pending" || poStatus === "initiated") &&
            accStatus !== "paid" &&
            poStatus !== "paid" &&
            poStatus !== "completed" &&
            accStatus !== "cancelled" &&
            accStatus !== "failed" &&
            accStatus !== "refunded" &&
            poStatus !== "refunded";
        } else if (filterStatus === "unpaid") {
          matchesStatus =
            accStatus === "unpaid" &&
            poStatus !== "paid" &&
            poStatus !== "completed";
        } else if (filterStatus === "partially_paid") {
          matchesStatus = accStatus === "partially_paid" || poStatus === "partially_paid";
        } else if (filterStatus === "cancelled") {
          matchesStatus =
            (accStatus === "cancelled" || poStatus === "cancelled") &&
            accStatus !== "refunded" &&
            poStatus !== "refunded";
        } else if (filterStatus === "failed") {
          matchesStatus = accStatus === "failed" || poStatus === "failed";
        } else if (filterStatus === "refunded") {
          matchesStatus =
            (accStatus === "refunded" || poStatus === "refunded") &&
            accStatus !== "cancelled";
        } else {
          matchesStatus = accStatus === filterStatus.toLowerCase();
        }

        const rawGender = p.gender ? String(p.gender).trim().toLowerCase() : "";
        const isKnownGender = rawGender === "male" || rawGender === "female" || rawGender === "other";

        const matchesGender =
          filterGender === "all"
            ? true
            : filterGender === "unspecified"
            ? !rawGender ||
              rawGender === "unspecified" ||
              rawGender === "not_specified" ||
              rawGender === "none" ||
              rawGender === "unknown" ||
              !isKnownGender
            : rawGender === filterGender.toLowerCase();

        const matchesState = filterState === "all" || p.state === filterState;
        const matchesDuration =
          filterDuration === "all" || acc.duration_days === Number(filterDuration);

        const normStart = acc.start_date ? String(acc.start_date).slice(0, 10) : "";
        const normEnd = acc.end_date ? String(acc.end_date).slice(0, 10) : "";

        const matchesStartDate =
          filterStartDate === "all" || normStart === filterStartDate;

        const matchesCheckoutDate =
          filterCheckoutDate === "all" || normEnd === filterCheckoutDate;

        let matchesCheckIn = true;
        if (filterCheckIn === "not_allocated") {
          matchesCheckIn = !acc.room_id;
        } else if (filterCheckIn === "allocated") {
          matchesCheckIn = !!acc.room_id;
        } else if (filterCheckIn === "not_checked_in") {
          matchesCheckIn = acc.status === "paid" && !!acc.room_id && !acc.checked_in;
        } else if (filterCheckIn === "checked_in") {
          matchesCheckIn = acc.checked_in && !acc.checked_out;
        } else if (filterCheckIn === "checked_out") {
          matchesCheckIn = acc.checked_out;
        }

        const matchesHostel = filterHostel === "all" || acc.hostel_id === filterHostel;
        const matchesRoom = filterRoom === "all" || acc.room_id === filterRoom;
        const matchesType =
          filterType === "all" || (filterType === "faculty" ? !!p.is_faculty : !p.is_faculty);

        let matchesDate = true;
        if (filterDate === "27") {
          matchesDate = normStart === "2026-10-27" && acc.duration_days === 1;
        } else if (filterDate === "28") {
          matchesDate = normStart === "2026-10-28" && acc.duration_days === 1;
        } else if (filterDate === "29") {
          matchesDate = normStart === "2026-10-29" && acc.duration_days === 1;
        } else if (filterDate === "30") {
          matchesDate = normStart === "2026-10-30" && acc.duration_days === 1;
        } else if (filterDate === "31") {
          matchesDate = normStart === "2026-10-31" && acc.duration_days === 1;
        } else if (filterDate === "2_days") {
          matchesDate = acc.duration_days === 2 && normStart === "2026-10-28";
        } else if (filterDate === "2_days_30") {
          matchesDate = acc.duration_days === 2 && normStart === "2026-10-30";
        } else if (filterDate === "3_days_27") {
          matchesDate = acc.duration_days === 3 && normStart === "2026-10-27";
        } else if (filterDate === "3_days_30") {
          matchesDate = acc.duration_days === 3 && (normStart === "2026-10-28" || normStart === "2026-10-30");
        } else if (filterDate === "3_days_29") {
          matchesDate = acc.duration_days === 3 && normStart === "2026-10-29";
        } else if (filterDate === "4_days") {
          matchesDate = acc.duration_days === 4 && normStart === "2026-10-27";
        } else if (filterDate === "4_days_28") {
          matchesDate = acc.duration_days === 4 && normStart === "2026-10-28";
        } else if (filterDate === "both" || filterDate === "multi") {
          matchesDate = acc.duration_days >= 2;
        }

        return (
          matchesSearch &&
          matchesStatus &&
          matchesGender &&
          matchesState &&
          matchesDuration &&
          matchesStartDate &&
          matchesCheckoutDate &&
          matchesCheckIn &&
          matchesHostel &&
          matchesRoom &&
          matchesType &&
          matchesDate
        );
      });
    }

    // 4. Output Generation (XLSX binary or JSON)
    if (format === "json") {
      return NextResponse.json({
        accommodations: targetRecords,
        hostels,
        floors,
        rooms,
        plans,
        totalCount: targetRecords.length,
      });
    }

    // Build Excel Workbook
    const workbook = buildAccommodationWorkbook({
      accommodations: targetRecords,
      hostels,
      floors,
      rooms,
      plans,
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `saviskar-accommodations-${scope}-${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    console.error("Accommodation Export Route Exception:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate accommodation export." },
      { status: 500 }
    );
  }
}
