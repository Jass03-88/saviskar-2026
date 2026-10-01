import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/supabase/server";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();

  if (auth.error) {
    return response(
      {
        success: false,
        error:
          auth.error === "MFA_REQUIRED"
            ? "Master Admin MFA verification required."
            : auth.error,
      },
      auth.status
    );
  }

  let body: {
    participantEventId?: string;
    action?: "check_in" | "check_out" | "main_check_in" | "main_check_out";
  };

  try {
    body = await request.json();
  } catch {
    return response({ success: false, error: "Invalid request body." }, 400);
  }

  const { participantEventId, action } = body;

  if (!participantEventId || (action !== "check_in" && action !== "check_out" && action !== "main_check_in" && action !== "main_check_out")) {
    return response({ success: false, error: "Missing or invalid parameters." }, 400);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    console.error("Check-in API is missing Supabase server configuration.");
    return response({ success: false, error: "Check-in service is not configured." }, 500);
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  let participantEvent: any = null;
  const { data: peWithGroup, error: fetchErrorWithGroup } = await supabaseAdmin
    .from("participant_events")
    .select("id, payment_status, payment_amount, team_name, event_id, participant_id, registration_group_id")
    .eq("id", participantEventId)
    .single();

  if (fetchErrorWithGroup) {
    // If the error is about the missing column, fallback to the legacy query
    if (fetchErrorWithGroup.code === "42703") {
      const { data: fallbackData, error: fallbackError } = await supabaseAdmin
        .from("participant_events")
        .select("id, payment_status, payment_amount, team_name, event_id, participant_id")
        .eq("id", participantEventId)
        .single();
        
      if (fallbackError || !fallbackData) {
        return response({ success: false, error: "Participant event not found." }, 404);
      }
      participantEvent = fallbackData;
    } else if (fetchErrorWithGroup.code === "PGRST116" || fetchErrorWithGroup.message === "Not found") {
      return response({ success: false, error: "Participant event not found." }, 404);
    } else {
      console.error("Failed to fetch participant event:", fetchErrorWithGroup);
      return response({ success: false, error: "Could not verify participant event." }, 500);
    }
  } else {
    participantEvent = peWithGroup;
  }

  let paymentAmount = 0;
  let teamName: string | null = null;
  let eventId: string | null = null;

  if (action === "check_in" || action === "main_check_in") {
    const rawAmount = participantEvent.payment_amount;
    const paymentStatus = participantEvent.payment_status;

    if (
      rawAmount === null ||
      rawAmount === undefined ||
      typeof rawAmount !== "number" ||
      Number.isNaN(rawAmount) ||
      rawAmount < 0
    ) {
      return response({ success: false, error: "Inconsistent payment record: invalid amount." }, 400);
    }

    if (rawAmount > 0 && paymentStatus === "not_required") {
      return response({ success: false, error: "Inconsistent payment record." }, 400);
    }

    if (
      (rawAmount > 0 && paymentStatus !== "paid") ||
      (paymentStatus !== "paid" && paymentStatus !== "not_required")
    ) {
      return response(
        {
          success: false,
          error: "Payment not complete",
          paymentStatus: paymentStatus ?? "unpaid",
        },
        402
      );
    }
    paymentAmount = rawAmount;
    teamName = participantEvent.team_name;
    eventId = participantEvent.event_id;
  }

  const isEventCheckIn = action === "check_in";
  const isMainCheckIn = action === "main_check_in";
  const checkInTime = (isEventCheckIn || isMainCheckIn) ? new Date().toISOString() : null;

  let updatePayload: Record<string, any> = {};
  if (action === "check_in" || action === "check_out") {
    updatePayload = {
      checked_in: isEventCheckIn,
      checked_in_at: checkInTime,
    };
  } else {
    updatePayload = {
      main_checked_in: isMainCheckIn,
      main_checked_in_at: checkInTime,
    };
  }

  let updateQuery = supabaseAdmin
    .from("participant_events")
    .update(updatePayload);

  if (isMainCheckIn || action === "main_check_out") {
    // The canonical identity for a Team Registration is its registration_group_id.
    // If the migration is not yet applied, fallback to the specific participantEventId.
    if ("registration_group_id" in participantEvent && participantEvent.registration_group_id) {
      updateQuery = updateQuery.eq("registration_group_id", participantEvent.registration_group_id);
    } else {
      updateQuery = updateQuery.eq("id", participantEventId);
    }
  } else {
    // Event check-in remains strictly specific to the scanned pass.
    updateQuery = updateQuery.eq("id", participantEventId);
  }
  if (isEventCheckIn) {
    updateQuery = updateQuery.eq("checked_in", false);
  }
  if (isMainCheckIn) {
    updateQuery = updateQuery.eq("main_checked_in", false);
  }

  // For check-in on paid events, atomically enforce payment_status = 'paid'
  if ((isEventCheckIn || isMainCheckIn) && paymentAmount > 0) {
    updateQuery = updateQuery.eq("payment_status", "paid");
  }

  let { data: updateData, error } = await updateQuery
    .select("id, checked_in, checked_in_at, main_checked_in, main_checked_in_at");

  if (error && error.code === "42703") {
    if (action === "main_check_in" || action === "main_check_out") {
      return response({ success: false, error: "Main check-in functionality requires a database migration that has not been applied." }, 501);
    }
    
    // Fallback for event check-in
    const fallbackUpdate = await updateQuery.select("id, checked_in, checked_in_at");
    updateData = fallbackUpdate.data as any;
    error = fallbackUpdate.error;
  }
    
  const updatedRecord = Array.isArray(updateData) && updateData.length > 0 ? updateData[0] : null;

  if (error) {
    console.error("Check-in update failed:", error);
    return response({ success: false, error: "Could not update check-in status." }, 500);
  }

  if ((isEventCheckIn || isMainCheckIn) && !updatedRecord) {
    // The conditional update matched 0 rows -> check if already checked in
    let existingRowQuery = supabaseAdmin
      .from("participant_events")
      .select("checked_in, checked_in_at, main_checked_in, main_checked_in_at")
      .eq("id", participantEventId);
      
    let { data: existingRow, error: existingRowError } = await existingRowQuery.maybeSingle();
    
    if (existingRowError && existingRowError.code === "42703") {
        const fallbackQuery = supabaseAdmin
          .from("participant_events")
          .select("checked_in, checked_in_at")
          .eq("id", participantEventId);
        const fallbackExisting = await fallbackQuery.maybeSingle();
        existingRow = fallbackExisting.data as any;
    }

    if (isEventCheckIn && existingRow?.checked_in) {
      const formattedTime = existingRow.checked_in_at
        ? new Date(existingRow.checked_in_at).toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        : "earlier";

      return response(
        {
          success: false,
          error: "ALREADY_CHECKED_IN",
          message: `This pass has already been scanned and checked in for the event (at ${formattedTime}). Gate entry rejected.`,
          checked_in_at: existingRow.checked_in_at,
        },
        409
      );
    }
    
    if (isMainCheckIn && existingRow?.main_checked_in) {
      const formattedTime = existingRow.main_checked_in_at
        ? new Date(existingRow.main_checked_in_at).toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        : "earlier";

      return response(
        {
          success: false,
          error: "ALREADY_MAIN_CHECKED_IN",
          message: `This pass has already been checked in at the Main Registration Desk (at ${formattedTime}).`,
          checked_in_at: existingRow.main_checked_in_at,
        },
        409
      );
    }

    return response({ success: false, error: "Participant event could not be checked in." }, 400);
  }

  if (isMainCheckIn || action === "main_check_out") {
    return response({
      success: true,
      main_checked_in: isMainCheckIn,
      main_checked_in_at: checkInTime,
    });
  }

  return response({
    success: true,
    checked_in: isEventCheckIn,
    checked_in_at: checkInTime,
  });
}
