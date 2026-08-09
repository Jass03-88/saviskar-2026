"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ArrowRight, Lock, AlertCircle } from "lucide-react";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setErrorMessage("");

    const supabase = createClient();

    const { error } = await supabase.auth.signInWithPassword({
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
      setErrorMessage("Unable to verify this account.");
      setLoading(false);
      return;
    }

    const { data: adminRow, error: adminError } = await supabase
      .from("admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (adminError || !adminRow) {
      await supabase.auth.signOut();
      setErrorMessage("This account is not authorized for admin access.");
      setLoading(false);
      return;
    }

    router.replace("/admin");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-6 py-16">
      <div className="w-full max-w-[480px]">
        <div className="mb-8 text-center">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.3em] text-black">
            Saviskar 2026
          </p>
          <h1 className="text-4xl font-semibold tracking-[-0.05em] md:text-5xl text-black">
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

          <form onSubmit={handleLogin} className="space-y-8">
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/40">
                Email
              </span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
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
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                className="mt-2 w-full border-b border-black/15 bg-transparent py-4 text-black outline-none transition placeholder:text-black/20 focus:border-black"
              />
            </label>

            {errorMessage && (
              <div className="flex items-center gap-3 rounded-2xl bg-red-50 px-4 py-4 text-sm text-red-700">
                <AlertCircle size={17} />
                {errorMessage}
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
