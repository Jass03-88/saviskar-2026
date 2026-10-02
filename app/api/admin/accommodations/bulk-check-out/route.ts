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

    let participantAccommodationIds: string[] = [];
    try {
      const body = await request.json();
      if (Array.isArray(body.participantAccommodationIds)) {
        participantAccommodationIds = body.participantAccommodationIds;
      }
    } catch {
      return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "Invalid JSON request body." } }, { status: 400 });
    }

    if (!participantAccommodationIds || participantAccommodationIds.length === 0) {
      return NextResponse.json({ success: false, error: { code: "INVALID_INPUT", message: "participantAccommodationIds is required." } }, { status: 400 });
    }

    if (participantAccommodationIds.length > 500) {
      return NextResponse.json({ success: false, error: { code: "LIMIT_EXCEEDED", message: "Cannot process more than 500 records at once." } }, { status: 400 });
    }

    // 1. Fetch accommodation booking records
    const { data: accommodations, error: accError } = await supabaseAdmin
      .from("participant_accommodations")
      .select(`
        id,
        participant_id,
        status,
        hostel_id,
        room_id,
        checked_in,
        checked_out,
        checked_out_at
      `)
      .in("id", participantAccommodationIds);

    if (accError) {
      return NextResponse.json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch accommodation records." } }, { status: 500 });
    }

    const results: { participantAccommodationId: string; participantId: string; status: string; reason: string }[] = [];
    let successCount = 0;
    let failedCount = 0;

    const validIdsToUpdate: string[] = [];
    const validAccs: any[] = [];

    for (const accId of participantAccommodationIds) {
      const acc = accommodations?.find(a => a.id === accId);
      
      const pushResult = (status: string, reason: string) => {
        results.push({
          participantAccommodationId: accId,
          participantId: acc?.participant_id || "unknown",
          status,
          reason
        });
        if (status === "SUCCESS") successCount++;
        else failedCount++;
      };

      if (!acc) {
        pushResult("FAILED", "Record not found");
        continue;
      }

      if (acc.status !== "paid") {
        pushResult("FAILED", "Payment pending/failed");
        continue;
      }

      if (acc.checked_out) {
        pushResult("FAILED", "Already checked out");
        continue;
      }

      if (!acc.checked_in) {
        pushResult("FAILED", "Not checked in");
        continue;
      }

      validIdsToUpdate.push(acc.id);
      validAccs.push(acc);
    }

    if (validIdsToUpdate.length > 0) {
      const nowIso = new Date().toISOString();
      const { data: updatedRows, error: updateError } = await supabaseAdmin
        .from("participant_accommodations")
        .update({
          checked_out: true,
          checked_out_at: nowIso,
          updated_at: nowIso,
        })
        .in("id", validIdsToUpdate)
        .eq("checked_out", false)
        .eq("checked_in", true)
        .eq("status", "paid")
        .select("id");

      if (updateError) {
        return NextResponse.json({ success: false, error: { code: "UPDATE_FAILED", message: "Failed to update records." } }, { status: 500 });
      }

      const updatedIds = new Set((updatedRows || []).map(r => r.id));

      const auditLogs = [];

      for (const acc of validAccs) {
        if (updatedIds.has(acc.id)) {
          results.push({ participantAccommodationId: acc.id, participantId: acc.participant_id || "unknown", status: "SUCCESS", reason: "Checked out successfully" });
          successCount++;
          
          if (auth.user?.id) {
            auditLogs.push({
              admin_id: auth.user.id,
              action_type: "ACCOMMODATION_CHECK_OUT",
              target_id: acc.id,
              details: {
                participant_id: acc.participant_id,
                hostel_id: acc.hostel_id,
                room_id: acc.room_id,
                checked_out_at: nowIso,
                bulk_operation: true
              },
            });
          }
        } else {
          results.push({ participantAccommodationId: acc.id, participantId: acc.participant_id || "unknown", status: "FAILED", reason: "Concurrency conflict or state changed" });
          failedCount++;
        }
      }

      if (auditLogs.length > 0) {
        try {
          await supabaseAdmin.from("admin_audit_logs").insert(auditLogs);
        } catch (auditErr) {
          console.error("Bulk check-out audit failed:", auditErr);
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: { success: successCount, failed: failedCount, results },
    });
  } catch (err: unknown) {
    console.error("BULK CHECK-OUT ERROR:", err);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Internal server error" } }, { status: 500 });
  }
}
