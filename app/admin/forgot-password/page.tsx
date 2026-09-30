"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Mail, AlertCircle, CheckCircle2 } from "lucide-react";

export default function AdminForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setErrorMessage("");
    setSuccess(false);

    try {
      const response = await fetch("/api/admin/auth/forgot-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!response.ok) {
        throw new Error("Failed to request password reset.");
      }

      setSuccess(true);
    } catch (error: any) {
      setErrorMessage(error.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-6 py-16">
      <div className="w-full max-w-[480px]">
        <div className="mb-8 text-center">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.3em] text-black">
            Saviskar 2026
          </p>

          <h1 className="text-4xl font-semibold tracking-[-0.05em] text-black md:text-5xl">
            Recovery.
          </h1>

          <p className="mt-4 text-sm text-black/40">
            Forgot password? Enter your administrator email and we'll send you a secure password-reset link.
          </p>
        </div>

        <div className="rounded-[32px] bg-white p-7 shadow-[0_30px_100px_rgba(0,0,0,0.06)] md:p-10">
          <div className="mb-10 flex h-12 w-12 items-center justify-center rounded-full bg-black text-white">
            <Mail size={18} />
          </div>

          {success ? (
            <div className="space-y-8">
              <div className="flex items-start gap-4 rounded-2xl bg-green-50 p-5 text-green-800">
                <CheckCircle2 size={24} className="mt-0.5 shrink-0" />
                <div className="space-y-2">
                  <p className="text-sm font-medium">Request Received</p>
                  <p className="text-sm opacity-90">
                    If an administrator account exists for this email, a password reset link has been sent.
                  </p>
                </div>
              </div>

              <a
                href="/admin/login"
                className="group flex w-full items-center justify-center gap-3 rounded-full bg-black px-6 py-4 text-sm font-medium text-white transition hover:scale-[1.01]"
              >
                Back to login
              </a>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-8">
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

              {errorMessage && (
                <div className="flex items-center gap-3 rounded-2xl bg-red-50 px-4 py-4 text-sm text-red-700">
                  <AlertCircle size={17} />
                  <span>{errorMessage}</span>
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
                    Sending
                  </>
                ) : (
                  <>
                    Send reset link
                    <ArrowRight
                      size={16}
                      className="transition-transform group-hover:translate-x-1"
                    />
                  </>
                )}
              </button>
            </form>
          )}
        </div>

        {!success && (
          <div className="mt-6 text-center">
            <a
              href="/admin/login"
              className="text-[10px] font-medium uppercase tracking-wider text-black/40 transition hover:text-black"
            >
              Back to login
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
