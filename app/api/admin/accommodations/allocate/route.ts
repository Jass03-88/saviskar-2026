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
      console.warn(`[ACCOMMODATION ALLOCATE] Unauthorized access attempt: status=${auth.status} error=${auth.error}`);
      return NextResponse.json(
        { success: false, error: { code: auth.status === 403 ? "FORBIDDEN" : "UNAUTHORIZED", message: auth.error } },
        { status: auth.status }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json(
        { success: false, error: { code: "SERVER_ERROR", message: "Admin service not configured." } },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { participantAccommodationId, participantAccommodationIds, hostelId, roomId, reason } = body;

    const primaryAccId = participantAccommodationId || (Array.isArray(participantAccommodationIds) ? participantAccommodationIds[0] : null);

    if (!primaryAccId || !hostelId || !roomId) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Missing required UUIDs." } },
        { status: 400 }
      );
    }

    // Use authenticated admin client with cookies so PostgreSQL auth.uid() evaluates to auth.user.id
    const rpcClient = (auth.supabase && typeof auth.supabase.rpc === "function") ? auth.supabase : supabaseAdmin;

    // Call allocate_accommodation RPC for the primary booking (fallback: supabaseAdmin.rpc("allocate_accommodation"))
    const { data, error } = await rpcClient.rpc("allocate_accommodation", {
      p_participant_accommodation_id: primaryAccId,
      p_hostel_id: hostelId,
      p_room_id: roomId,
      p_reason: reason || null,
    });

    if (error) {
      let code = "ALLOCATION_FAILED";
      let status = 400;

      const msg = error.message || "";
      if (/UNAUTHORIZED|42501/i.test(msg)) {
        code = "UNAUTHORIZED";
        status = 401;
      } else if (/FORBIDDEN/i.test(msg)) {
        code = "FORBIDDEN";
        status = 403;
      } else if (/capacity exceeded|room_full/i.test(msg)) {
        code = "ROOM_FULL";
        status = 400;
      } else if (/GENDER_MISMATCH/i.test(msg)) {
        code = "GENDER_MISMATCH";
        status = 400;
      } else if (/UNSUPPORTED_GENDER/i.test(msg)) {
        code = "UNSUPPORTED_GENDER";
        status = 400;
      } else if (/Status must be paid|UNPAID/i.test(msg)) {
        code = "UNPAID";
        status = 400;
      } else if (/INVALID_BOOKING_DATES/i.test(msg)) {
        code = "INVALID_BOOKING_DATES";
        status = 400;
      } else if (/NOT_FOUND/i.test(msg)) {
        code = "NOT_FOUND";
        status = 404;
      }

      console.warn(`[ACCOMMODATION ALLOCATE] Allocation failed for booking ${primaryAccId}: code=${code} message=${error.message}`);
      return NextResponse.json({ success: false, error: { code, message: error.message } }, { status });
    }

    // Auto-allocate adjacent/consecutive paid sibling orders for the same participant to the same room
    let participantId: string | null = null;
    const siblingResults: Array<{
      id: string;
      success: boolean;
      room_id?: string;
      error?: string;
    }> = [];

    try {
      const primaryQuery = supabaseAdmin.from?.("participant_accommodations")?.select?.("participant_id")?.eq?.("id", primaryAccId)?.single?.();
      const primaryRes = primaryQuery ? await primaryQuery : null;
      participantId = primaryRes?.data?.participant_id || null;

      if (participantId) {
        const siblingQuery = supabaseAdmin
          .from?.("participant_accommodations")
          ?.select?.("id, start_date, end_date, status, room_id")
          ?.eq?.("participant_id", participantId)
          ?.eq?.("status", "paid")
          ?.neq?.("id", primaryAccId);

        const siblingRes = siblingQuery ? await siblingQuery : null;
        const siblingOrders = siblingRes?.data;

        if (siblingOrders && siblingOrders.length > 0) {
          for (const sibling of siblingOrders) {
            if (sibling.room_id !== roomId) {
              const siblingReason = reason
                ? `${reason} (Multi-order participant stay allocation)`
                : "Multi-order participant stay allocation";

              // CRITICAL: Call the authoritative RPC for each sibling order!
              // This guarantees row-level locking (FOR UPDATE on hostel_rooms and participant_accommodations),
              // date-aware capacity validation, gender validation, and safe reallocation history.
              // NO DIRECT WRITES to participant_accommodations or accommodation_allocations!
              const { data: siblingData, error: siblingRpcError } = await rpcClient.rpc(
                "allocate_accommodation",
                {
                  p_participant_accommodation_id: sibling.id,
                  p_hostel_id: hostelId,
                  p_room_id: roomId,
                  p_reason: siblingReason,
                }
              );

              if (siblingRpcError) {
                console.warn(
                  `[ACCOMMODATION ALLOCATE] Sibling booking ${sibling.id} allocation failed: ${siblingRpcError.message}`
                );
                siblingResults.push({
                  id: sibling.id,
                  success: false,
                  error: siblingRpcError.message,
                });
              } else {
                siblingResults.push({
                  id: sibling.id,
                  success: true,
                  room_id: roomId,
                });
              }
            }
          }
        }
      }
    } catch (siblingErr: any) {
      console.warn("[ACCOMMODATION ALLOCATE] Sibling order allocation unexpected error:", siblingErr?.message || siblingErr);
    }

    if (auth.user?.id) {
      try {
        await supabaseAdmin.from?.("admin_audit_logs")?.insert?.({
          admin_id: auth.user.id,
          action_type: "ACCOMMODATION_ALLOCATE",
          target_id: primaryAccId,
          details: {
            hostel_id: hostelId,
            room_id: roomId,
            reason: reason || null,
            participant_id: participantId || null,
            sibling_allocations: siblingResults.length > 0 ? siblingResults : undefined,
          },
        });
      } catch (auditErr) {
        console.error("Failed to write audit log for allocate:", auditErr);
      }
    }

    console.log(`[ACCOMMODATION ALLOCATE] Successfully allocated booking ${primaryAccId} to room ${roomId} by admin ${auth.user?.id}`);

    const hasPartialFailures = siblingResults.some((s) => !s.success);
    const failedCount = siblingResults.filter((s) => !s.success).length;

    return NextResponse.json({
      success: true,
      data,
      siblingAllocations: siblingResults.length > 0 ? siblingResults : undefined,
      partialSuccess: hasPartialFailures ? true : undefined,
      warning: hasPartialFailures
        ? `Primary booking allocated successfully, but ${failedCount} sibling booking(s) could not be allocated to this room: ${siblingResults
            .filter((s) => !s.success)
            .map((s) => `${s.id} (${s.error})`)
            .join("; ")}`
        : undefined,
    });

  } catch (err: any) {
    console.error("[ACCOMMODATION ALLOCATE] Server error:", err?.message || err);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Internal server error" } }, { status: 500 });
  }
}
