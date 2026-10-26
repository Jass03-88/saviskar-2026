import { NextRequest, NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/supabase/server";
import {
  getHostedRegistrationReadClient,
  getBroadcastStorageClient,
  isHybridDevelopmentModeActive,
  isPreviewDeployment,
  getBroadcastOperationalMode,
} from "@/lib/broadcast/supabase-admin";
import {
  resolveGeneralBroadcastRecipients,
  resolveCertificateCandidates,
} from "@/lib/broadcast/recipient-resolver";
import {
  SYNTHETIC_GENERAL_RECIPIENTS,
  SYNTHETIC_CERTIFICATE_CANDIDATES,
} from "@/lib/broadcast/hybrid-fixtures";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
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
    const isHybridMode = isHybridDevelopmentModeActive();
    const isPreview = isPreviewDeployment(request);
    const mode = getBroadcastOperationalMode(request);

    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get("type") || "general";

    if (isPreview) {
      if (type === "certificate") {
        const candidates = SYNTHETIC_CERTIFICATE_CANDIDATES;
        const eligibleCount = candidates.filter((c) => c.certificateEligible).length;
        const ineligibleCount = candidates.length - eligibleCount;

        return NextResponse.json({
          type: "certificate",
          mode: "preview",
          isPreviewMode: true,
          isLiveProduction: false,
          isHybridMode: false,
          total: candidates.length,
          eligibleCount,
          ineligibleCount,
          recipients: candidates,
        });
      }

      const recipients = SYNTHETIC_GENERAL_RECIPIENTS;
      const validCount = recipients.filter((r) => r.isValidEmail).length;
      const invalidCount = recipients.length - validCount;

      return NextResponse.json({
        type: "general",
        mode: "preview",
        isPreviewMode: true,
        isLiveProduction: false,
        isHybridMode: false,
        total: recipients.length,
        validCount,
        invalidCount,
        recipients,
      });
    }

    const registrationClient = isHybridMode
      ? getHostedRegistrationReadClient()
      : getBroadcastStorageClient();

    if (type === "certificate") {
      const eventId = searchParams.get("eventId") || undefined;
      let candidates = await resolveCertificateCandidates(registrationClient, { eventId });

      if (isHybridMode) {
        // Prepend synthetic fixtures for safe local testing
        candidates = [...SYNTHETIC_CERTIFICATE_CANDIDATES, ...candidates];
      }

      const eligibleCount = candidates.filter((c) => c.certificateEligible).length;
      const ineligibleCount = candidates.length - eligibleCount;

      return NextResponse.json({
        type: "certificate",
        isHybridMode,
        total: candidates.length,
        eligibleCount,
        ineligibleCount,
        recipients: candidates,
      });
    }

    // Default: General broadcast recipients
    let recipients = await resolveGeneralBroadcastRecipients(registrationClient);
    if (isHybridMode) {
      recipients = [...SYNTHETIC_GENERAL_RECIPIENTS, ...recipients];
    }

    const validCount = recipients.filter((r) => r.isValidEmail).length;
    const invalidCount = recipients.length - validCount;

    return NextResponse.json({
      type: "general",
      isHybridMode,
      total: recipients.length,
      validCount,
      invalidCount,
      recipients,
    });
  } catch (err: any) {
    console.error("[API BROADCAST RECIPIENTS ERROR]:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to resolve broadcast recipients" },
      { status: 500 }
    );
  }
}
