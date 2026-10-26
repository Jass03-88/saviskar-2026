import { NextRequest, NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/supabase/server";
import { getBroadcastSupabaseAdmin } from "@/lib/broadcast/supabase-admin";
import {
  processNextBroadcastBatch,
  updateCampaignProgressAndStatus,
} from "@/lib/broadcast/campaign-worker";

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

    // 1. Atomically process batch strictly scoped to this specific campaign
    const result = await processNextBroadcastBatch(supabaseAdmin, {
      batchSize,
      campaignId: id,
    });

    // 2. Authoritatively reconcile campaign status and counters adhering to check constraints
    const progress = await updateCampaignProgressAndStatus(supabaseAdmin, id);

    return NextResponse.json({
      success: true,
      batchSize,
      campaignStatus: progress.status,
      remainingCount: progress.remainingCount,
      ...result,
    });
  } catch (err: any) {
    console.error("[PROCESS BATCH ERROR]:", err);
    return NextResponse.json(
      {
        success: false,
        error: err?.message || "Batch processing failed",
      },
      { status: 500 }
    );
  }
}
