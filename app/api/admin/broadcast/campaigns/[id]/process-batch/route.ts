import { NextRequest, NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/supabase/server";
import { getBroadcastSupabaseAdmin } from "@/lib/broadcast/supabase-admin";
import { processNextBroadcastBatch } from "@/lib/broadcast/campaign-worker";

export const dynamic = "force-dynamic";

export async function POST(
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
  try {
    let batchSize = 10;
    try {
      const body = await request.json();
      if (typeof body?.batchSize === "number" && body.batchSize > 0) {
        batchSize = Math.min(body.batchSize, 25);
      }
    } catch {
      // Body is optional
    }

    const supabaseAdmin = getBroadcastSupabaseAdmin();
    const result = await processNextBroadcastBatch(supabaseAdmin, batchSize);

    // Update campaign status if all deliveries are finished
    const { data: remaining } = await supabaseAdmin
      .from("broadcast_deliveries")
      .select("status")
      .eq("campaign_id", id)
      .in("status", ["queued", "sending"]);

    if (remaining && remaining.length === 0) {
      const { data: counts } = await supabaseAdmin
        .from("broadcast_deliveries")
        .select("status")
        .eq("campaign_id", id);

      const total = counts?.length || 0;
      const sent = counts?.filter((c) => c.status === "sent" || c.status === "delivered").length || 0;
      const failed = counts?.filter((c) => c.status === "failed" || c.status === "manual_review").length || 0;

      await supabaseAdmin
        .from("broadcast_campaigns")
        .update({
          status: sent === total ? "completed" : "failed",
          sent_count: sent,
          failed_count: failed,
          completed_at: new Date().toISOString(),
        })
        .eq("id", id);
    }

    return NextResponse.json({
      success: true,
      batchSize,
      ...result,
    });
  } catch (err: any) {
    console.error("[PROCESS BATCH ERROR]:", err);
    return NextResponse.json({ error: err?.message || "Batch processing failed" }, { status: 500 });
  }
}
