import { NextRequest, NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/supabase/server";
import { getBroadcastSupabaseAdmin } from "@/lib/broadcast/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireMasterAdmin();

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

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing campaign id" }, { status: 400 });
  }

  try {
    const supabaseAdmin = getBroadcastSupabaseAdmin();

    const { data: campaign, error: campErr } = await supabaseAdmin
      .from("broadcast_campaigns")
      .select("*")
      .eq("id", id)
      .single();

    if (campErr || !campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const { data: deliveries, error: delErr } = await supabaseAdmin
      .from("broadcast_deliveries")
      .select(`
        id,
        recipient_email,
        recipient_name,
        channel,
        part_number,
        total_parts,
        status,
        attempts,
        provider_message_id,
        error_message,
        error_code,
        sent_at,
        created_at,
        broadcast_delivery_attachments (
          id,
          filename,
          size_bytes,
          participation_certificates (
            recipient_name,
            event_name,
            certificate_number
          )
        )
      `)
      .eq("campaign_id", id)
      .order("created_at", { ascending: true });

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    return NextResponse.json({
      campaign,
      deliveries: deliveries || [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to load campaign details" }, { status: 500 });
  }
}
