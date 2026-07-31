"use client";

import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

export async function getAuthorizedAdmin() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      authorized: false as const,
      session: null,
      user: null,
    };
  }

  const { data: adminRow, error: adminError } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (adminError || !adminRow) {
    return {
      authorized: false as const,
      session: { user },
      user,
    };
  }

  return {
    authorized: true as const,
    session: { user },
    user,
  };
}

export async function signOutUnauthorizedUser() {
  await supabase.auth.signOut();
}

export async function signOutAdmin() {
  await supabase.auth.signOut();
  window.location.assign("/admin/login");
}
