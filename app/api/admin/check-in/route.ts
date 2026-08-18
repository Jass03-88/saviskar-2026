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
    action?: "check_in" | "check_out";
  };

  try {
    body = await request.json();
  } catch {
    return response({ success: false, error: "Invalid request body." }, 400);
  }

  const { participantEventId, action } = body;

  if (!participantEventId || (action !== "check_in" && action !== "check_out")) {
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

  const checkInTime = action === "check_in" ? new Date().toISOString() : null;

  const { error } = await supabaseAdmin
    .from("participant_events")
    .update({
      checked_in: action === "check_in",
      checked_in_at: checkInTime,
    })
    .eq("id", participantEventId)
    .select()
    .single();

  if (error) {
    console.error("Check-in update failed:", error);
    return response({ success: false, error: "Could not update check-in status." }, 500);
  }

  return response({
    success: true,
    checked_in: action === "check_in",
    checked_in_at: checkInTime,
  });
}
