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
      console.warn(`[ACCOMMODATION REALLOCATE] Unauthorized access attempt: status=${auth.status} error=${auth.error}`);
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
    
    if (!reason || reason.trim() === "") {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Reason is required for reallocation." } },
        { status: 400 }
      );
    }

    // Use authenticated admin client with cookies so PostgreSQL auth.uid() evaluates to auth.user.id
    const rpcClient = (auth.supabase && typeof auth.supabase.rpc === "function") ? auth.supabase : supabaseAdmin;

    // Executes RPC with authenticated admin (fallback: supabaseAdmin.rpc("allocate_accommodation"))
    const { data, error } = await rpcClient.rpc("allocate_accommodation", {
      p_participant_accommodation_id: primaryAccId,
      p_hostel_id: hostelId,
      p_room_id: roomId,
      p_reason: reason.trim(),
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
      } else if (/NOT_FOUND/i.test(msg)) {
        code = "NOT_FOUND";
        status = 404;
      }

      console.warn(`[ACCOMMODATION REALLOCATE] Reallocation failed for booking ${primaryAccId}: code=${code} message=${error.message}`);
      return NextResponse.json({ success: false, error: { code, message: error.message } }, { status });
    }

    // Reallocate any sibling paid orders for the same participant to the new room
    let participantId: string | null = null;
    try {
      const primaryQuery = supabaseAdmin.from?.("participant_accommodations")?.select?.("participant_id")?.eq?.("id", primaryAccId)?.single?.();
      const primaryRes = primaryQuery ? await primaryQuery : null;
      participantId = primaryRes?.data?.participant_id || null;

      if (participantId) {
        const siblingQuery = supabaseAdmin
          .from?.("participant_accommodations")
          ?.select?.("id, status, room_id")
          ?.eq?.("participant_id", participantId)
          ?.eq?.("status", "paid")
          ?.neq?.("id", primaryAccId);

        const siblingRes = siblingQuery ? await siblingQuery : null;
        const siblingOrders = siblingRes?.data;

        if (siblingOrders && siblingOrders.length > 0) {
          for (const sibling of siblingOrders) {
            if (sibling.room_id !== roomId) {
              await supabaseAdmin
                .from?.("participant_accommodations")
                ?.update?.({
                  hostel_id: hostelId,
                  room_id: roomId,
                  updated_at: new Date().toISOString(),
                })
                ?.eq?.("id", sibling.id);

              await supabaseAdmin
                .from?.("accommodation_allocations")
                ?.update?.({ status: "reassigned", deallocated_at: new Date().toISOString() })
                ?.eq?.("participant_accommodation_id", sibling.id)
                ?.eq?.("status", "active");

              await supabaseAdmin
                .from?.("accommodation_allocations")
                ?.insert?.({
                  participant_accommodation_id: sibling.id,
                  hostel_id: hostelId,
                  room_id: roomId,
                  status: "active",
                  allocated_by: auth.user.id,
                  reason: reason.trim(),
                });
            }
          }
        }
      }
    } catch (siblingErr) {
      console.warn("[ACCOMMODATION REALLOCATE] Sibling order reallocation warning:", siblingErr);
    }

    if (auth.user?.id) {
      try {
        await supabaseAdmin.from?.("admin_audit_logs")?.insert?.({
          admin_id: auth.user.id,
          action_type: "ACCOMMODATION_REALLOCATE",
          target_id: primaryAccId,
          details: {
            hostel_id: hostelId,
            room_id: roomId,
            reason: reason.trim(),
            participant_id: participantId || null,
          },
        });
      } catch (auditErr) {
        console.error("Failed to write audit log for reallocate:", auditErr);
      }
    }

    console.log(`[ACCOMMODATION REALLOCATE] Successfully reallocated booking ${primaryAccId} to room ${roomId} by admin ${auth.user?.id}`);
    return NextResponse.json({ success: true, data });

  } catch (err: any) {
    console.error("[ACCOMMODATION REALLOCATE] Server error:", err?.message || err);
    return NextResponse.json({ success: false, error: { code: "SERVER_ERROR", message: "Internal server error" } }, { status: 500 });
  }
}
