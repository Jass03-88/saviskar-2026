import { NextRequest, NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/supabase/server";
import {
  getBroadcastSupabaseAdmin,
  isPreviewDeployment,
  isProductionReadOnlyEnabled,
} from "@/lib/broadcast/supabase-admin";

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

  const isPreview = isPreviewDeployment(request);
  if (isPreview) {
    return NextResponse.json(
      {
        error: "Campaign details are unavailable in Preview Mode.",
        code: "PREVIEW_MODE_UNAVAILABLE",
      },
      { status: 404 }
    );
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

export async function DELETE(
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

  const isPreview = isPreviewDeployment(request);
  if (isPreview) {
    return NextResponse.json(
      { error: "Campaign deletion is disabled in Preview Mode." },
      { status: 403 }
    );
  }

  const isReadOnly = isProductionReadOnlyEnabled(request);
  if (isReadOnly) {
    return NextResponse.json(
      { error: "Campaign deletion is disabled in Production Read-Only Mode." },
      { status: 403 }
    );
  }

  try {
    const supabaseAdmin = getBroadcastSupabaseAdmin();

    const { data: campaign, error: campErr } = await supabaseAdmin
      .from("broadcast_campaigns")
      .select("id, status, sent_count, total_deliveries")
      .eq("id", id)
      .single();

    if (campErr || !campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    // Safety guard: only allow deleting campaigns that have not sent any emails
    if (campaign.sent_count > 0) {
      return NextResponse.json(
        { error: "Cannot delete a campaign that has already sent emails." },
        { status: 400 }
      );
    }

    const { error: delErr } = await supabaseAdmin
      .from("broadcast_campaigns")
      .delete()
      .eq("id", id);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, deletedCampaignId: id });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to delete campaign" }, { status: 500 });
  }
}
