import { NextRequest, NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/supabase/server";
import { generateParticipationCertificatePdf } from "@/lib/certificates/generator";

export const dynamic = "force-dynamic";

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
    const body = await request.json().catch(() => ({}));
    const recipientName = body.recipientName || "Jashandeep Singh";
    const eventName = body.eventName || "RoboWars: National Championship 2026";

    const { pdfBytes, templateHash } = await generateParticipationCertificatePdf({
      recipientName,
      eventName,
      certificateNumber: "SAV26-PREVIEW-001",
    });

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="Saviskar_Certificate_Preview.pdf"',
        "X-Template-Hash": templateHash,
      },
    });
  } catch (err: any) {
    console.error("[CERTIFICATE PREVIEW ERROR]:", err);
    return NextResponse.json({ error: err?.message || "Failed to generate certificate preview" }, { status: 500 });
  }
}
