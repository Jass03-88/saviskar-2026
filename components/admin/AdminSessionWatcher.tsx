"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const EXEMPT_PATHS = [
  "/admin/login",
  "/admin/login/mfa",
  "/admin/invite",
  "/admin/accept-invite",
  "/admin/reset-password",
  "/admin/forgot-password",
];

export function AdminSessionWatcher() {
  const router = useRouter();
  const pathname = usePathname();
  const checkingRef = useRef(false);

  useEffect(() => {
    // Only monitor protected admin routes
    const isExempt = EXEMPT_PATHS.some(
      (exempt) => pathname === exempt || pathname?.startsWith(`${exempt}/`)
    );
    if (isExempt) return;

    const supabase = createClient();

    // 1. Listen for Supabase auth state change events across tabs (e.g. manual logout)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        router.replace("/admin/login");
      }
    });

    // 2. Authoritatively verify session validity against the server
    async function checkServerSession() {
      if (checkingRef.current) return;
      checkingRef.current = true;
      try {
        const res = await fetch("/api/admin/session", {
          cache: "no-store",
          headers: { "Cache-Control": "no-store" },
        });

        if (res.status === 401 || res.status === 403) {
          try {
            await supabase.auth.signOut();
          } catch {
            // Ignore signOut network failure
          }
          router.replace("/admin/login");
        }
      } catch {
        // Network blip; server-side APIs will continue enforcing on action
      } finally {
        checkingRef.current = false;
      }
    }

    // Check periodically every 60 seconds
    const interval = setInterval(checkServerSession, 60_000);

    // Check when tab becomes visible or receives focus
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void checkServerSession();
      }
    }

    function onFocus() {
      void checkServerSession();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);

    return () => {
      subscription.unsubscribe();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [pathname, router]);

  return null;
}
