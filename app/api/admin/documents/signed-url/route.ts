import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();

    if (auth.error) {
      return NextResponse.json(
        { error: auth.error === "MFA_REQUIRED" ? "Master Admin MFA verification required." : auth.error },
        { status: auth.status }
      );
    }

    const { path } = await request.json();

    if (!path) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !supabaseSecretKey) {
      return NextResponse.json({ error: "Storage configuration error." }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey);

    const { data, error } = await supabaseAdmin.storage
      .from("id_cards")
      .createSignedUrl(path, 60 * 5); // 5 minutes

    if (error) {
      console.error("Signed URL generation error:", error);
      return NextResponse.json({ error: "Failed to generate signed URL." }, { status: 500 });
    }

    return NextResponse.json({ signedUrl: data.signedUrl });
  } catch (err) {
    console.error("Signed URL error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
