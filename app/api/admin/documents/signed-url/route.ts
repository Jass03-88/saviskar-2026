import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    return null;
  }

  return createSupabaseClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();

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

    const body = (await request.json().catch(() => null)) as { path?: unknown } | null;

    if (!body || typeof body.path !== "string" || !body.path.trim()) {
      return NextResponse.json(
        { error: "Document path is required." },
        { status: 400 }
      );
    }

    const cleanPath = body.path.trim();

    // Prevent path traversal and malicious characters
    if (
      cleanPath.includes("..") ||
      cleanPath.startsWith("/") ||
      cleanPath.startsWith("\\") ||
      cleanPath.includes("\0")
    ) {
      return NextResponse.json(
        { error: "Invalid document path." },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      console.error("Storage service is not configured.");
      return NextResponse.json(
        { error: "Storage service is not configured." },
        { status: 500 }
      );
    }

    // Security Gate: Verify that the requested storage path exactly matches an
    // id_card_storage_path stored in the database for an existing participant.
    // Reject any arbitrary or unverified storage paths.
    const { data: matchedParticipant, error: dbError } = await supabaseAdmin
      .from("participants")
      .select("id")
      .eq("id_card_storage_path", cleanPath)
      .limit(1);

    if (dbError) {
      console.error("Database error verifying document path:", dbError);
      return NextResponse.json(
        { error: "Could not verify document path." },
        { status: 500 }
      );
    }

    if (!matchedParticipant || matchedParticipant.length === 0) {
      return NextResponse.json(
        { error: "Unauthorized or unregistered document path." },
        { status: 403 }
      );
    }

    // Generate short-lived signed URL (15 minutes expiry)
    const { data: signedData, error: signError } = await supabaseAdmin.storage
      .from("id_cards")
      .createSignedUrl(cleanPath, 60 * 15);

    if (signError || !signedData?.signedUrl) {
      console.error("Error creating signed URL from storage:", signError);
      return NextResponse.json(
        { error: "Document could not be retrieved from storage. The file may be missing or inaccessible." },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { signedUrl: signedData.signedUrl },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    console.error("Unhandled error in documents signed-url route:", err);
    return NextResponse.json(
      { error: "Internal Server Error." },
      { status: 500 }
    );
  }
}
