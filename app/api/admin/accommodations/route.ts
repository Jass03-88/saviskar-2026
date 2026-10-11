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

/**
 * DELETE /api/admin/accommodations
 *
 * Permanently removes a participant's accommodation booking.
 * Releases any room allocation, unlinks/cleans up associated order items,
 * writes an audit log, and removes the accommodation record.
 *
 * Query params or JSON body:
 * - id OR participantAccommodationId: UUID of the accommodation record
 */
export async function DELETE(request: Request) {
  try {
    const auth = await requireAccommodationAdmin();
    if (auth.error) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message:
              auth.error === "MFA_REQUIRED"
                ? "Master Admin MFA verification required."
                : auth.error,
          },
        },
        { status: auth.status }
      );
    }

    const url = new URL(request.url);
    let accommodationId =
      url.searchParams.get("id") ||
      url.searchParams.get("participantAccommodationId");

    if (!accommodationId && request.headers.get("content-type")?.includes("application/json")) {
      const body = await request.json().catch(() => null);
      if (body) {
        accommodationId = body.id || body.participantAccommodationId;
      }
    }

    if (!accommodationId || typeof accommodationId !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "BAD_REQUEST",
            message: "Missing accommodation record ID.",
          },
        },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "SERVER_ERROR",
            message: "Admin service not configured.",
          },
        },
        { status: 500 }
      );
    }

    // Attempt the atomic RPC for safe cancellation / deletion
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
      "delete_accommodation_permanently",
      {
        p_accommodation_id: accommodationId,
        p_admin_id: auth.user.id,
      }
    );

    if (rpcError) {
      console.error("delete_accommodation_permanently RPC failed:", rpcError);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "DELETE_FAILED",
            message: rpcError.message || "Failed to process accommodation deletion.",
          },
        },
        { status: 500 }
      );
    }

    const action = rpcData?.action || "deleted";
    
    return NextResponse.json({
      success: true,
      message: action === "cancelled" 
        ? "Accommodation cancelled and room released. Financial history preserved."
        : "Accommodation record deleted successfully.",
    });
  } catch (err: any) {
    console.error("DELETE /api/admin/accommodations exception:", err);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SERVER_ERROR",
          message: err?.message || "Internal server error.",
        },
      },
      { status: 500 }
    );
  }
}
