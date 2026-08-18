"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "loading" | "setup" | "verify" | "error";

export default function AdminMfaPage() {
  const router = useRouter();
  const supabase = createClient();

  const [mode, setMode] = useState<Mode>("loading");
  const [factorId, setFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        setError("");

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          throw sessionError;
        }

        if (!session?.user) {
          router.replace("/admin/login");
          return;
        }

        const { data: aal, error: aalError } =
          await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

        if (aalError) {
          throw aalError;
        }

        if (aal.currentLevel === "aal2") {
          router.replace("/admin");
          return;
        }

        const { data: factors, error: factorsError } =
          await supabase.auth.mfa.listFactors();

        if (factorsError) {
          throw factorsError;
        }

        // Check whether a verified TOTP factor already exists.
        const verifiedTotp = factors.totp.find(
          (factor) => factor.status === "verified"
        );

        if (verifiedTotp) {
          if (!cancelled) {
            setFactorId(verifiedTotp.id);
            setMode("verify");
          }

          return;
        }

        // We previously started enrollment but did not finish it.
        // Remove that incomplete factor before creating a fresh one.
        const unverifiedTotp = factors.all.find(
          (factor) =>
            factor.factor_type === "totp" &&
            factor.status === "unverified"
        );

        if (unverifiedTotp) {
          const { error: unenrollError } =
            await supabase.auth.mfa.unenroll({
              factorId: unverifiedTotp.id,
            });

          if (unenrollError) {
            throw unenrollError;
          }
        }

        setLoading(true);

        // Create a fresh TOTP factor.
        const { data, error: enrollError } =
          await supabase.auth.mfa.enroll({
            factorType: "totp",
            issuer: "Saviskar 2026",
            friendlyName: "Saviskar Master Admin",
          });

        if (enrollError) {
          throw enrollError;
        }

        if (!cancelled) {
          setFactorId(data.id);
          setQrCode(data.totp.qr_code);
          setSecret(data.totp.secret);
          setMode("setup");
        }
      } catch (err) {
        console.error("MFA initialization error:", err);

        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to initialize Google Authenticator."
          );

          setMode("error");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanCode = code.replace(/\D/g, "");

    if (cleanCode.length !== 6) {
      setError("Enter the 6-digit code from Google Authenticator.");
      return;
    }

    if (!factorId) {
      setError("MFA factor is missing. Please refresh the page.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { data, error: challengeError } =
        await supabase.auth.mfa.challenge({
          factorId,
        });

      if (challengeError) {
        throw challengeError;
      }

      const { error: verifyError } =
        await supabase.auth.mfa.verify({
          factorId,
          challengeId: data.id,
          code: cleanCode,
        });

      if (verifyError) {
        throw verifyError;
      }

      await supabase.auth.refreshSession();

      router.replace("/admin");
      router.refresh();
    } catch (err) {
      console.error("MFA verification error:", err);

      setError(
        err instanceof Error
          ? err.message
          : "Invalid Google Authenticator code."
      );
    } finally {
      setLoading(false);
    }
  }

  if (mode === "loading") {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2 border-black/20 border-t-black" />
          <p>Checking security...</p>
        </div>
      </main>
    );
  }

  if (mode === "error") {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border bg-white p-8">
          <h1 className="text-2xl font-semibold text-black">
            Security setup error
          </h1>

          <p className="mt-3 text-sm text-red-600">
            {error}
          </p>

          <button
            onClick={() => window.location.reload()}
            className="mt-6 w-full rounded-lg bg-black px-4 py-3 text-white"
          >
            Try again
          </button>

          <button
            onClick={() => router.replace("/admin/login")}
            className="mt-3 w-full rounded-lg border px-4 py-3 text-black"
          >
            Back to login
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border bg-white p-8">
        {mode === "setup" ? (
          <>
            <h1 className="text-2xl font-semibold text-black">
              Set up Google Authenticator
            </h1>

            <p className="mt-2 text-sm text-black/60">
              Scan this QR code with Google Authenticator on your phone.
            </p>

            {qrCode && (
              <div className="mt-6 flex justify-center rounded-xl bg-white p-4">
                <img
                  src={qrCode}
                  alt="Google Authenticator setup QR code"
                  className="h-56 w-56"
                />
              </div>
            )}

            {secret && (
              <div className="mt-5">
                <p className="text-xs text-black/60">
                  Can't scan the QR code? Enter this setup key manually:
                </p>

                <code className="mt-2 block break-all rounded-lg border p-3 text-xs text-black">
                  {secret}
                </code>
              </div>
            )}

            <form onSubmit={verifyCode} className="mt-6">
              <label className="text-sm font-medium text-black">
                6-digit verification code
              </label>

              <input
                value={code}
                onChange={(e) =>
                  setCode(
                    e.target.value.replace(/\D/g, "").slice(0, 6)
                  )
                }
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                className="mt-2 w-full rounded-lg border px-4 py-3 text-center text-xl tracking-[0.4em] text-black outline-none focus:border-black"
              />

              {error && (
                <p className="mt-3 text-sm text-red-500">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="mt-5 w-full rounded-lg bg-black px-4 py-3 font-medium text-white disabled:opacity-50"
              >
                {loading
                  ? "Verifying..."
                  : "Enable Google Authenticator"}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-black">
              Google Authenticator
            </h1>

            <p className="mt-2 text-sm text-black/60">
              Enter the 6-digit code from Google Authenticator to
              continue.
            </p>

            <form onSubmit={verifyCode} className="mt-6">
              <input
                value={code}
                onChange={(e) =>
                  setCode(
                    e.target.value.replace(/\D/g, "").slice(0, 6)
                  )
                }
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                autoFocus
                className="w-full rounded-lg border px-4 py-3 text-center text-2xl tracking-[0.5em] text-black outline-none focus:border-black"
              />

              {error && (
                <p className="mt-3 text-sm text-red-500">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="mt-5 w-full rounded-lg bg-black px-4 py-3 font-medium text-white disabled:opacity-50"
              >
                {loading ? "Verifying..." : "Verify & Continue"}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}