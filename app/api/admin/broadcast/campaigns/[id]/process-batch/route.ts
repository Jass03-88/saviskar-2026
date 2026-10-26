import { NextRequest, NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/supabase/server";
import {
  getBroadcastSupabaseAdmin,
  isHybridDevelopmentModeActive,
  isLiveBroadcastEnabled,
  isPreviewDeployment,
  isProductionReadOnlyEnabled,
} from "@/lib/broadcast/supabase-admin";
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
    const isPreview = isPreviewDeployment(request);
    if (isPreview) {
      return NextResponse.json(
        {
          error: "Batch queue processing is disabled in Preview Mode.",
          code: "PREVIEW_MODE_PROCESSING_DISABLED",
        },
        { status: 403 }
      );
    }

    const isReadOnly = isProductionReadOnlyEnabled(request);
    if (isReadOnly) {
      return NextResponse.json(
        {
          error: "Batch queue processing is disabled in Production Read-Only Mode.",
          code: "PRODUCTION_READONLY_MODE_PROCESSING_DISABLED",
        },
        { status: 403 }
      );
    }

    if (!isLiveBroadcastEnabled(request) && !isHybridDevelopmentModeActive()) {
      return NextResponse.json(
        {
          error: "Batch queue processing is disabled because live broadcast mode is not enabled in this deployment.",
          code: "LIVE_BROADCAST_DISABLED",
        },
        { status: 403 }
      );
    }

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
