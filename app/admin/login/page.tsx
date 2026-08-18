"use client";

import {
  FormEvent,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Lock,
  AlertCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function AdminLoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [checkingRecovery, setCheckingRecovery] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    let mounted = true;
    let handledRecovery = false;

    async function handleRecoverySession() {
      if (!mounted || handledRecovery) return;

      handledRecovery = true;

      /*
       * The recovery link from Supabase contains the tokens
       * in the URL hash:
       *
       * #access_token=...
       * &refresh_token=...
       * &type=recovery
       *
       * The hash is only available in the browser.
       */
      const hash =
        typeof window !== "undefined"
          ? window.location.hash
          : "";

      if (!hash) {
        if (mounted) {
          setCheckingRecovery(false);
        }
        return;
      }

      const params = new URLSearchParams(
        hash.startsWith("#") ? hash.substring(1) : hash
      );

      const type = params.get("type");
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      if (
        type === "recovery" &&
        accessToken &&
        refreshToken
      ) {
        /*
         * Explicitly establish the Supabase recovery session.
         * This prevents the normal login form from trying to
         * authenticate the user with a password that doesn't
         * exist yet.
         */
        const { error } =
          await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

        if (error) {
          if (mounted) {
            setErrorMessage(
              "This password reset link is invalid or has expired. Please request a new one."
            );
            setCheckingRecovery(false);
          }

          return;
        }

        /*
         * Remove the sensitive token hash from the browser URL
         * before navigating away.
         */
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname
        );

        /*
         * Send the user to the actual password setup page.
         */
        router.replace("/admin/reset-password");
        return;
      }

      /*
       * Some Supabase flows may already have established the
       * session before this component checks the URL.
       */
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session && type === "recovery") {
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname
        );

        router.replace("/admin/reset-password");
        return;
      }

      if (session && type !== "recovery") {
        router.replace("/admin");
        return;
      }

      if (mounted) {
        setCheckingRecovery(false);
      }
    }

    /*
     * Listen for Supabase's recovery event as well.
     */
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === "PASSWORD_RECOVERY") {
          handleRecoverySession();
        }
      }
    );

    handleRecoverySession();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [router]);

  /*
   * =====================================================
   * NORMAL LOGIN
   * =====================================================
   */

  async function handleLogin(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setLoading(true);
    setErrorMessage("");

    const supabase = createClient();

    const { error } =
      await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

    if (error) {
      setErrorMessage("Invalid email or password.");
      setLoading(false);
      return;
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      await supabase.auth.signOut();

      setErrorMessage(
        "Unable to verify this account."
      );

      setLoading(false);
      return;
    }

    /*
     * Check Saviskar admin access.
     */
    const {
      data: adminRow,
      error: adminError,
    } = await supabase
      .from("admins")
      .select("user_id, role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (adminError || !adminRow) {
      await supabase.auth.signOut();

      setErrorMessage(
        "This account is not authorized for admin access."
      );

      setLoading(false);
      return;
    }

    /*
     * Master Admin → MFA
     */
    if (adminRow.role === "master") {
      router.replace("/admin/login/mfa");
      router.refresh();
      return;
    }

    /*
     * Normal Admin → Dashboard
     */
    router.replace("/admin");
    router.refresh();
  }

  /*
   * =====================================================
   * RECOVERY CHECK
   * =====================================================
   */

  if (checkingRecovery) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-6 py-16">
        <div className="text-center">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-black text-white">
            <Lock size={18} />
          </div>

          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-black">
            Saviskar 2026
          </p>

          <p className="mt-4 text-sm text-black/40">
            Verifying your invitation...
          </p>
        </div>
      </main>
    );
  }

  /*
   * =====================================================
   * NORMAL LOGIN UI
   * =====================================================
   */

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-6 py-16">
      <div className="w-full max-w-[480px]">

        <div className="mb-8 text-center">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.3em] text-black">
            Saviskar 2026
          </p>

          <h1 className="text-4xl font-semibold tracking-[-0.05em] text-black md:text-5xl">
            Admin.
          </h1>

          <p className="mt-4 text-sm text-black/40">
            Sign in to manage registrations.
          </p>
        </div>

        <div className="rounded-[32px] bg-white p-7 shadow-[0_30px_100px_rgba(0,0,0,0.06)] md:p-10">

          <div className="mb-10 flex h-12 w-12 items-center justify-center rounded-full bg-black text-white">
            <Lock size={18} />
          </div>

          <form
            onSubmit={handleLogin}
            className="space-y-8"
          >

            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/40">
                Email
              </span>

              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) =>
                  setEmail(event.target.value)
                }
                placeholder="admin@example.com"
                className="mt-2 w-full border-b border-black/15 bg-transparent py-4 text-black outline-none transition placeholder:text-black/20 focus:border-black"
              />
            </label>

            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/40">
                Password
              </span>

              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                placeholder="Enter your password"
                className="mt-2 w-full border-b border-black/15 bg-transparent py-4 text-black outline-none transition placeholder:text-black/20 focus:border-black"
              />
            </label>

            {errorMessage && (
              <div className="flex items-center gap-3 rounded-2xl bg-red-50 px-4 py-4 text-sm text-red-700">
                <AlertCircle size={17} />

                <span>
                  {errorMessage}
                </span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="group flex w-full items-center justify-center gap-3 rounded-full bg-black px-6 py-4 text-sm font-medium text-white transition hover:scale-[1.01] disabled:cursor-wait disabled:opacity-50"
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Signing in
                </>
              ) : (
                <>
                  Sign in

                  <ArrowRight
                    size={16}
                    className="transition-transform group-hover:translate-x-1"
                  />
                </>
              )}
            </button>

          </form>
        </div>

        <p className="mt-6 text-center text-[10px] uppercase tracking-[0.18em] text-black/25">
          Authorized access only
        </p>

      </div>
    </main>
  );
}