import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRegistrationSession } from "@/lib/auth/session";
import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";

const MAX_UPLOAD_SIZE = 2.5 * 1024 * 1024; // 2.5MB

export async function POST(request: NextRequest) {
  const session = await getRegistrationSession();

  if (!session.authenticated || !session.email) {
    return NextResponse.json({ success: false, error: "Registration session required." }, { status: 401 });
  }

  const clientIp = getClientIp(request);
  const rateLimit = await checkRateLimitAsync(`upload:${clientIp}`, 15, 60 * 1000);
  if (!rateLimit.allowed) {
    return NextResponse.json({ success: false, error: "Too many uploads. Please try again later." }, { status: 429 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    return NextResponse.json({ success: false, error: "Storage configuration error." }, { status: 500 });
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey);

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ success: false, error: "No file provided." }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_SIZE) {
      return NextResponse.json({ success: false, error: "File too large. Maximum size is 2MB." }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ success: false, error: "Only image files are allowed." }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const ext = file.name.split('.').pop() || 'jpg';
    
    // Using standard Node crypto or Math.random as fallback if edge runtime doesn't have crypto.randomUUID
    const uniqueId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
    
    const filename = `${session.email.toLowerCase()}/${uniqueId}.${ext}`;

    const { data, error } = await supabaseAdmin.storage
      .from("id_cards")
      .upload(filename, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (error) {
      console.error("Storage upload error:", error);
      return NextResponse.json({ success: false, error: "Failed to securely save ID card." }, { status: 500 });
    }

    return NextResponse.json({ success: true, path: data.path });
  } catch (err) {
    console.error("Upload handler error:", err);
    return NextResponse.json({ success: false, error: "Upload failed due to a server error." }, { status: 500 });
  }
}
