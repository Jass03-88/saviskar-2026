import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  getBroadcastSupabaseAdmin,
  isHybridDevelopmentModeActive,
  isLiveBroadcastEnabled,
  isPreviewDeployment,
  isProductionReadOnlyEnabled,
} from "@/lib/broadcast/supabase-admin";
import {
  isBroadcastEmergencyStopActive,
  processActiveBroadcastQueue,
} from "@/lib/broadcast/campaign-worker";

export const dynamic = "force-dynamic";

/**
 * Validates the cron authorization header against BROADCAST_CRON_SECRET.
 * Uses crypto.timingSafeEqual to prevent timing attacks.
 * Never logs secret values.
 */
function isCronAuthorized(request: NextRequest): boolean {
  const configuredSecret = process.env.BROADCAST_CRON_SECRET?.trim();
  if (!configuredSecret) {
    // If no secret configured in environment, fail closed immediately
    return false;
  }

  const authHeader = request.headers.get("authorization");
  const xCronHeader = request.headers.get("x-broadcast-cron-secret");

  let providedSecret = "";
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    providedSecret = authHeader.slice(7).trim();
  } else if (xCronHeader) {
    providedSecret = xCronHeader.trim();
  }

  if (!providedSecret) {
    return false;
  }

  const providedBuf = Buffer.from(providedSecret, "utf-8");
  const configuredBuf = Buffer.from(configuredSecret, "utf-8");

  if (providedBuf.length !== configuredBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuf, configuredBuf);
}

/**
 * GET: Safe, authenticated readiness and health check probe.
 * Authenticates the secret token and reports operational status without
 * mutating database records, acquiring leases, claiming deliveries, or sending emails.
 *
 * When live broadcast sending is disabled (SAVISKAR_BROADCAST_LIVE_ENABLED=false/unset),
 * returns HTTP 200 with status: "standby" to confirm endpoint & auth health.
 * When live broadcast sending is enabled, returns HTTP 200 with status: "ready".
 */
export async function GET(request: NextRequest) {
  // 1. Authenticate scheduler request
  if (!isCronAuthorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid or missing cron secret." },
      { status: 401 }
    );
  }

  // 2. Evaluate operational flags for diagnostic reporting
  const isLive = isLiveBroadcastEnabled(request) || isHybridDevelopmentModeActive();
  const isPreview = isPreviewDeployment(request);
  const isReadOnly = isProductionReadOnlyEnabled(request);
  const isEmergencyStopped = isBroadcastEmergencyStopActive();

  let status: "ready" | "standby" | "emergency_stopped" = "ready";
  let message =
    "Cron scheduler endpoint is healthy and authenticated. Ready to process queue via POST.";

  if (isEmergencyStopped) {
    status = "emergency_stopped";
    message =
      "Cron scheduler endpoint is healthy and authenticated, but background processing is halted by emergency stop (SAVISKAR_BROADCAST_EMERGENCY_STOP=true).";
  } else if (!isLive) {
    status = "standby";
    message =
      "Cron scheduler endpoint is healthy and authenticated. Live broadcast sending is disabled (standby). POST queue processing will be rejected until enabled.";
  } else if (isPreview) {
    status = "standby";
    message =
      "Cron scheduler endpoint is healthy and authenticated. Queue processing is disabled in Preview Mode.";
  } else if (isReadOnly) {
    status = "standby";
    message =
      "Cron scheduler endpoint is healthy and authenticated. Queue processing is disabled in Production Read-Only Mode.";
  }

  return NextResponse.json({
    success: true,
    status,
    authenticated: true,
    liveBroadcastEnabled: isLive && !isPreview && !isReadOnly,
    emergencyStopActive: isEmergencyStopped,
    message,
    timestamp: new Date().toISOString(),
  });
}

/**
 * POST: Scheduled queue processing execution handler.
 * Strictly enforces all fail-closed operational guards (preview, read-only, live broadcast,
 * emergency stop) before acquiring worker leases or dispatching deliveries.
 */
export async function POST(request: NextRequest) {
  // 1. Authenticate scheduler request
  if (!isCronAuthorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid or missing cron secret." },
      { status: 401 }
    );
  }

  // 2. Fail-closed operational guards
  if (isPreviewDeployment(request)) {
    return NextResponse.json(
      {
        error: "Automatic queue processing is disabled in Preview Mode.",
        code: "PREVIEW_MODE_PROCESSING_DISABLED",
      },
      { status: 403 }
    );
  }

  if (isProductionReadOnlyEnabled(request)) {
    return NextResponse.json(
      {
        error: "Automatic queue processing is disabled in Production Read-Only Mode.",
        code: "PRODUCTION_READONLY_MODE_PROCESSING_DISABLED",
      },
      { status: 403 }
    );
  }

  if (!isLiveBroadcastEnabled(request) && !isHybridDevelopmentModeActive()) {
    return NextResponse.json(
      {
        error: "Automatic queue processing is disabled because live broadcast mode is not enabled in this deployment.",
        code: "LIVE_BROADCAST_DISABLED",
      },
      { status: 403 }
    );
  }

  // 3. Emergency stop check
  if (isBroadcastEmergencyStopActive()) {
    return NextResponse.json({
      success: true,
      status: "emergency_stopped",
      message: "Queue processing halted by emergency stop (SAVISKAR_BROADCAST_EMERGENCY_STOP=true).",
      batchesExecuted: 0,
      totalClaimed: 0,
      totalSent: 0,
      totalFailed: 0,
      durationMs: 0,
      activeCampaignsProcessed: [],
    });
  }

  // 4. Parse optional execution parameters with strict bounding
  let timeBudgetMs = 20000; // 20s default budget
  let batchSize = 10;
  let throttleMs = 100;

  try {
    const url = new URL(request.url);
    const budgetParam = url.searchParams.get("budgetMs");
    const batchParam = url.searchParams.get("batchSize");
    const throttleParam = url.searchParams.get("throttleMs");

    if (budgetParam && !isNaN(Number(budgetParam))) {
      timeBudgetMs = Math.max(5000, Math.min(Number(budgetParam), 25000));
    }
    if (batchParam && !isNaN(Number(batchParam))) {
      batchSize = Math.max(1, Math.min(Number(batchParam), 25));
    }
    if (throttleParam && !isNaN(Number(throttleParam))) {
      throttleMs = Math.max(0, Math.min(Number(throttleParam), 1000));
    }

    try {
      const body = await request.json();
      if (typeof body?.timeBudgetMs === "number") {
        timeBudgetMs = Math.max(5000, Math.min(body.timeBudgetMs, 25000));
      }
      if (typeof body?.batchSize === "number") {
        batchSize = Math.max(1, Math.min(body.batchSize, 25));
      }
      if (typeof body?.throttleMs === "number") {
        throttleMs = Math.max(0, Math.min(body.throttleMs, 1000));
      }
    } catch {
      // Body is optional
    }
  } catch {
    // Ignore URL/JSON parsing fallback to defaults
  }

  try {
    const supabaseAdmin = getBroadcastSupabaseAdmin();
    const result = await processActiveBroadcastQueue(supabaseAdmin, {
      timeBudgetMs,
      batchSize,
      throttleMs,
    });

    return NextResponse.json({
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[CRON QUEUE WORKER EXCEPTION]:", err?.message || String(err));
    return NextResponse.json(
      {
        success: false,
        status: "error",
        error: err?.message || "Internal queue processing error",
      },
      { status: 500 }
    );
  }
}
