import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireAccommodationAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) return null;
  return createSupabaseClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// CREATE HOSTEL
export async function POST(request: Request) {
  try {
    const auth = await requireAccommodationAdmin();
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
    
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) return NextResponse.json({ error: "No admin config" }, { status: 500 });
    
    const body = await request.json();
    const { name, gender_eligibility, is_active } = body;
    
    if (!name || !gender_eligibility) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from("hostels")
      .insert({ name, gender_eligibility, is_active: is_active ?? true })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Could not create hostel" }, { status: 500 });
    }

    return NextResponse.json({ hostel: data }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}

// UPDATE HOSTEL
export async function PATCH(request: Request) {
  try {
    const auth = await requireAccommodationAdmin();
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
    
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) return NextResponse.json({ error: "No admin config" }, { status: 500 });
    
    const body = await request.json();
    const { id, name, gender_eligibility, is_active } = body;
    
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    // Validate Deactivation safety
    if (is_active === false) {
      // Check if there are active rooms or active allocations
      const { data: activeAllocs } = await supabaseAdmin
        .from("participant_accommodations")
        .select("id")
        .eq("hostel_id", id)
        .not("status", "in", '("cancelled", "failed")')
        .limit(1);

      if (activeAllocs && activeAllocs.length > 0) {
        return NextResponse.json({ error: "Cannot deactivate hostel with active allocations." }, { status: 400 });
      }

      // Also check if any rooms are active (wait, it's safer just to disable rooms independently or warn, let's just do active allocs)
    }

    const { data, error } = await supabaseAdmin
      .from("hostels")
      .update({ name, gender_eligibility, is_active, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Could not update hostel" }, { status: 500 });
    }

    return NextResponse.json({ hostel: data }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
