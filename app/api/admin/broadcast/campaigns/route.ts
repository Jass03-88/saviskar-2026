import { NextRequest, NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/supabase/server";
import {
  getBroadcastStorageClient,
  getBroadcastSupabaseAdmin,
  getHostedRegistrationReadClient,
  isHybridDevelopmentModeActive,
  isSyntheticTestEmail,
  isLiveBroadcastEnabled,
  isPreviewDeployment,
  isProductionReadOnlyEnabled,
  getBroadcastOperationalMode,
  HYBRID_READONLY_ERROR,
  PREVIEW_READONLY_ERROR,
  PRODUCTION_READONLY_ERROR,
} from "@/lib/broadcast/supabase-admin";
import {
  createGeneralBroadcastCampaign,
  createCertificateCampaign,
  processNextBroadcastBatch,
  updateCampaignProgressAndStatus,
} from "@/lib/broadcast/campaign-worker";
import {
  resolveGeneralBroadcastRecipients,
  resolveCertificateCandidates,
} from "@/lib/broadcast/recipient-resolver";
import {
  SYNTHETIC_GENERAL_RECIPIENTS,
  SYNTHETIC_CERTIFICATE_CANDIDATES,
} from "@/lib/broadcast/hybrid-fixtures";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse>;
export async function GET(request: Request): Promise<NextResponse>;
export async function GET(request?: Request): Promise<NextResponse> {
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

  try {
    const isPreview = isPreviewDeployment(request);
    const isProductionReadOnly = isProductionReadOnlyEnabled(request);
    const isLiveProduction = isLiveBroadcastEnabled(request);
    const mode = getBroadcastOperationalMode(request);

    if (isPreview) {
      return NextResponse.json({
        campaigns: [],
        mode: "preview",
        isPreviewMode: true,
        isProductionReadOnly: false,
        isLiveProduction: false,
        isHybridMode: false,
        schemaReady: false,
        note: "Preview Mode: Campaign storage is unmounted to protect production database.",
      });
    }

    const storageClient = getBroadcastSupabaseAdmin();
    const { data: campaigns, error } = await storageClient
      .from("broadcast_campaigns")
      .select(`
        id,
        title,
        subject,
        campaign_type,
        status,
        target_filters,
        total_recipients,
        total_deliveries,
        sent_count,
        delivered_count,
        failed_count,
        created_at,
        completed_at,
        created_by
      `)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[CAMPAIGN HISTORY API ERROR]:", error);
      const isMissingTable = error.code === "PGRST205" || error.code === "42P01";
      return NextResponse.json(
        {
          error: isMissingTable
            ? "Database table 'broadcast_campaigns' not found. Verify that migration 20261026000001_broadcast_and_certificates.sql is applied."
            : error.message || "Failed to load campaigns",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      campaigns: campaigns || [],
      mode,
      isProductionReadOnly,
      isLiveProduction,
      isHybridMode: isHybridDevelopmentModeActive(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to load campaigns" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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

  try {
    const isPreview = isPreviewDeployment(request);
    if (isPreview) {
      return NextResponse.json(
        {
          error: "Campaign creation is disabled in Preview Mode. Preview deployments cannot write campaign records to the production database.",
          code: "PREVIEW_MODE_READ_ONLY",
        },
        { status: 403 }
      );
    }

    const isReadOnly = isProductionReadOnlyEnabled(request);
    if (isReadOnly) {
      return NextResponse.json(
        {
          error: "Campaign creation is disabled in Production Read-Only Mode. Database schema mutations and email dispatches are prevented.",
          code: "PRODUCTION_READONLY_MODE_MUTATION_DENIED",
        },
        { status: 403 }
      );
    }

    if (!isLiveBroadcastEnabled(request) && !isHybridDevelopmentModeActive()) {
      return NextResponse.json(
        {
          error: "Campaign creation is disabled because live broadcast mode is not enabled in this deployment.",
          code: "LIVE_BROADCAST_DISABLED",
        },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      title,
      subject,
      bodyHtml,
      bodyText,
      campaignType,
      selectedEmails,
      selectedItemKeys,
      sendIndividual = true,
      sendTeamBackup = true,
      dispatchImmediately = false,
    } = body;

    if (!title || !subject || !bodyHtml) {
      return NextResponse.json(
        { error: "Title, subject, and bodyHtml are required fields." },
        { status: 400 }
      );
    }

    const isHybridMode = isHybridDevelopmentModeActive();
    const adminId = auth.user.id;
    const adminEmail = auth.user.email;

    if (campaignType === "general") {
      if (!Array.isArray(selectedEmails) || selectedEmails.length === 0) {
        return NextResponse.json(
          { error: "At least one recipient email must be selected for general broadcast." },
          { status: 400 }
        );
      }

      // Hybrid mode security guard: refuse campaign creation if any recipient is not a synthetic .test address
      if (isHybridMode) {
        const hasRealRecipients = selectedEmails.some((e: string) => !isSyntheticTestEmail(e));
        if (hasRealRecipients) {
          return NextResponse.json({ error: HYBRID_READONLY_ERROR }, { status: 400 });
        }
      }

      const registrationClient = isHybridMode
        ? getHostedRegistrationReadClient()
        : getBroadcastSupabaseAdmin();

      // Authoritative recipient resolution
      let authoritativeRecipients = await resolveGeneralBroadcastRecipients(registrationClient);
      if (isHybridMode) {
        authoritativeRecipients = [...SYNTHETIC_GENERAL_RECIPIENTS, ...authoritativeRecipients];
      }

      const validEmailSet = new Set(
        authoritativeRecipients.filter((r) => r.isValidEmail).map((r) => r.normalizedEmail)
      );

      const verifiedEmails = selectedEmails
        .map((e: string) => e.trim().toLowerCase())
        .filter((e: string) => validEmailSet.has(e));

      if (verifiedEmails.length === 0) {
        return NextResponse.json(
          { error: "None of the selected emails correspond to valid active participants." },
          { status: 400 }
        );
      }

      const storageClient = getBroadcastSupabaseAdmin();
      const result = await createGeneralBroadcastCampaign(storageClient, {
        title,
        subject,
        bodyHtml,
        bodyText,
        selectedEmails: verifiedEmails,
        adminId,
        adminEmail,
      });

      let batchResult = { processedCount: 0, successCount: 0, failureCount: 0 };
      let campaignStatus = "queued";

      // Dispatch behavior: enqueue only by default; begin dispatch immediately only upon explicit request
      if (dispatchImmediately) {
        batchResult = await processNextBroadcastBatch(storageClient, {
          batchSize: 25,
          campaignId: result.campaignId,
        });
        const progress = await updateCampaignProgressAndStatus(storageClient, result.campaignId);
        campaignStatus = progress.status;
      }

      return NextResponse.json({
        success: true,
        campaignId: result.campaignId,
        totalDeliveries: result.totalDeliveries,
        campaignStatus,
        processedCount: batchResult.processedCount,
        successCount: batchResult.successCount,
        failureCount: batchResult.failureCount,
      });
    }

    if (campaignType === "certificate") {
      if (!Array.isArray(selectedItemKeys) || selectedItemKeys.length === 0) {
        return NextResponse.json(
          { error: "At least one certificate recipient must be selected." },
          { status: 400 }
        );
      }

      // Authoritative candidate resolution
      const registrationClient = isHybridMode
        ? getHostedRegistrationReadClient()
        : getBroadcastSupabaseAdmin();
      let authoritativeCandidates = await resolveCertificateCandidates(registrationClient);
      if (isHybridMode) {
        authoritativeCandidates = [...SYNTHETIC_CERTIFICATE_CANDIDATES, ...authoritativeCandidates];
      }

      // Hybrid mode security guard: refuse certificate creation if ANY selected candidate is not a synthetic test candidate
      if (isHybridMode) {
        for (const k of selectedItemKeys) {
          const cand = authoritativeCandidates.find((c) => c.issueSourceKey === k);
          if (!cand) {
            return NextResponse.json({ error: HYBRID_READONLY_ERROR }, { status: 400 });
          }
          const isRecipientSynthetic = isSyntheticTestEmail(cand.recipientEmail);
          const isTeamSynthetic = !cand.teamContactEmail || isSyntheticTestEmail(cand.teamContactEmail);
          if (!isRecipientSynthetic || !isTeamSynthetic) {
            return NextResponse.json({ error: HYBRID_READONLY_ERROR }, { status: 400 });
          }
        }
      }

      const eligibleKeySet = new Set(
        authoritativeCandidates.filter((c) => c.certificateEligible).map((c) => c.issueSourceKey)
      );

      const verifiedKeys = selectedItemKeys.filter((k: string) => eligibleKeySet.has(k));
      if (verifiedKeys.length === 0) {
        return NextResponse.json(
          { error: "None of the selected registrations qualify for certificates under main check-in and payment rules." },
          { status: 400 }
        );
      }

      const storageClient = getBroadcastSupabaseAdmin();
      const result = await createCertificateCampaign(
        storageClient,
        {
          title,
          subject,
          bodyHtml,
          bodyText,
          selectedItemKeys: verifiedKeys,
          sendIndividual: !!sendIndividual,
          sendTeamBackup: !!sendTeamBackup,
          adminId,
          adminEmail,
        },
        authoritativeCandidates
      );

      let batchResult = { processedCount: 0, successCount: 0, failureCount: 0 };
      let campaignStatus = "queued";

      // Dispatch behavior: enqueue only by default; begin dispatch immediately only upon explicit request
      if (dispatchImmediately) {
        batchResult = await processNextBroadcastBatch(storageClient, {
          batchSize: 25,
          campaignId: result.campaignId,
        });
        const progress = await updateCampaignProgressAndStatus(storageClient, result.campaignId);
        campaignStatus = progress.status;
      }

      return NextResponse.json({
        success: true,
        campaignId: result.campaignId,
        totalDeliveries: result.totalDeliveries,
        totalCertificates: result.totalCertificates,
        campaignStatus,
        processedCount: batchResult.processedCount,
        successCount: batchResult.successCount,
        failureCount: batchResult.failureCount,
      });
    }

    return NextResponse.json({ error: "Invalid campaignType specified." }, { status: 400 });
  } catch (err: any) {
    console.error("[API CREATE CAMPAIGN ERROR]:", err);
    return NextResponse.json({ error: err?.message || "Failed to create campaign" }, { status: 500 });
  }
}
