import { NextRequest, NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/supabase/server";
import {
  getBroadcastSupabaseAdmin,
  isHybridDevelopmentModeActive,
  isSyntheticTestEmail,
  HYBRID_READONLY_ERROR,
} from "@/lib/broadcast/supabase-admin";
import { sendCampaignEmail } from "@/lib/email/campaign-service";
import { generateParticipationCertificatePdf } from "@/lib/certificates/generator";
import { isValidEmailAddress } from "@/lib/broadcast/recipient-resolver";

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
    const body = await request.json();
    const testEmail = (body.testEmail || body.destinationEmail)?.trim();

    if (!isValidEmailAddress(testEmail)) {
      return NextResponse.json(
        { error: "A valid test recipient email address is required." },
        { status: 400 }
      );
    }

    if (isHybridDevelopmentModeActive() && !isSyntheticTestEmail(testEmail)) {
      return NextResponse.json(
        { error: HYBRID_READONLY_ERROR },
        { status: 400 }
      );
    }

    const supabaseAdmin = getBroadcastSupabaseAdmin();
    const { data: campaign, error: campErr } = await supabaseAdmin
      .from("broadcast_campaigns")
      .select("*")
      .eq("id", id)
      .single();

    if (campErr || !campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    let attachments: any[] = [];
    if (campaign.campaign_type === "certificate") {
      const { pdfBytes } = await generateParticipationCertificatePdf({
        recipientName: "Test Participant (Sample)",
        eventName: "Sample Event 2026",
        certificateNumber: "SAV26-TEST-PREVIEW",
      });

      attachments.push({
        filename: "Saviskar_Certificate_SAMPLE.pdf",
        content: Buffer.from(pdfBytes),
      });
    }

    const sendResult = await sendCampaignEmail({
      to: testEmail,
      subject: `[TEST SEND] ${campaign.subject}`,
      html: `
        <div style="background-color: #f3f4f6; padding: 12px; margin-bottom: 20px; border-left: 4px solid #9333ea; font-family: sans-serif; font-size: 13px; color: #4b5563;">
          <strong>ADMIN TEST DISPATCH</strong>: This is a verified test dispatch for campaign "<em>${campaign.title}</em>". No actual participants were contacted.
        </div>
        ${campaign.body_html}
      `,
      text: `[ADMIN TEST DISPATCH]\n\n${campaign.body_text}`,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    if (!sendResult.success) {
      return NextResponse.json(
        { error: sendResult.error || "Failed to dispatch test email." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      messageId: sendResult.messageId,
      sentTo: testEmail,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Test dispatch failed" }, { status: 500 });
  }
}
