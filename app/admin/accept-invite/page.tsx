"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Step = "loading" | "password" | "mfa-setup" | "mfa-verify" | "success" | "error";

export function validatePassword(password: string, confirmPassword: string) {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(password)) return "Password must contain at least one uppercase letter.";
  if (!/[a-z]/.test(password)) return "Password must contain at least one lowercase letter.";
  if (!/[0-9]/.test(password)) return "Password must contain at least one number.";
  if (password !== confirmPassword) return "Passwords do not match.";
  return "";
}

export function parseInviteHash(hash: string) {
  if (!hash) return { error: "missing_hash" };
  const cleanHash = hash.startsWith("#") ? hash.substring(1) : hash;
  if (!cleanHash) return { error: "empty_hash" };
  
  const params = new URLSearchParams(cleanHash);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  
  if (!accessToken || !refreshToken) {
    return { error: "invalid_tokens" };
  }
  
  return { accessToken, refreshToken };
}

export function getMfaAction(factors: { all: any[], totp: any[] }) {
  const verifiedTotp = factors.totp.find((f) => f.status === "verified");
  if (verifiedTotp) {
    return { action: "verify" as const, factorId: verifiedTotp.id };
  }
  const unverifiedTotp = factors.all.find((f) => f.factor_type === "totp" && f.status === "unverified");
  return { 
    action: "enroll" as const, 
    unenrollId: unverifiedTotp ? unverifiedTotp.id : undefined 
  };
}

export function validateMfaCodeInput(code: string) {
  const cleanCode = code.replace(/\D/g, "");
  if (cleanCode.length !== 6) {
    return { error: "Enter the 6-digit code from your authenticator app.", cleanCode };
  }
  return { error: "", cleanCode };
}

export default function AcceptInvitePage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [step, setStep] = useState<Step>("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // MFA state
  const [factorId, setFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    let mounted = true;

    async function handleHashSession() {
      if (!mounted) return;

      const hash = typeof window !== "undefined" ? window.location.hash : "";
      const parsed = parseInviteHash(hash);
      
      if (parsed.error === "missing_hash") {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user && mounted) {
          setEmail(session.user.email ?? "");
          setStep("password");
        } else if (mounted) {
          setError("This link is missing or has expired. Please request a new invitation.");
          setStep("error");
        }
        return;
      }
      
      if (parsed.error || !parsed.accessToken || !parsed.refreshToken) {
        if (mounted) {
          setError("Invalid invitation link format.");
          setStep("error");
        }
        return;
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: parsed.accessToken,
        refresh_token: parsed.refreshToken,
      });

      if (sessionError) {
        if (mounted) {
          setError("This invitation link is invalid or has expired.");
          setStep("error");
        }
        return;
      }

      // Clean URL only after successful session establishment
      window.history.replaceState({}, document.title, window.location.pathname);

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user && mounted) {
        setEmail(session.user.email ?? "");
        setStep("password");
      }
    }

    handleHashSession();

    return () => {
      mounted = false;
    };
  }, [supabase]);

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const validationError = validatePassword(password, confirmPassword);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.user) {
        throw new Error("Your session is no longer valid. Please request a new invitation.");
      }

      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      // Start MFA setup
      const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
      if (factorsError) throw factorsError;

      const mfaAction = getMfaAction(factors);

      if (mfaAction.action === "verify") {
        setFactorId(mfaAction.factorId);
        setStep("mfa-verify");
        setLoading(false);
        return;
      }

      if (mfaAction.unenrollId) {
        const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: mfaAction.unenrollId });
        if (unenrollError) throw unenrollError;
      }

      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        issuer: "Saviskar 2026",
        friendlyName: "Saviskar Admin",
      });

      if (enrollError) throw enrollError;

      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      setStep("mfa-setup");

    } catch (err) {
      console.error("Password setup error:", err);
      setError(err instanceof Error ? err.message : "Could not set your password.");
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const validation = validateMfaCodeInput(code);
    if (validation.error) {
      setError(validation.error);
      return;
    }

    setLoading(true);

    try {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: validation.cleanCode,
      });

      if (verifyError) throw verifyError;

      await supabase.auth.refreshSession();
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Verification failed.");

      // Check admin status server side via proxy using redirect behavior, but to be sure we can check db
      const { data: adminRow, error: adminError } = await supabase
        .from("admins")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      if (adminError || !adminRow) {
        await supabase.auth.signOut();
        throw new Error("Your account is not authorized as an administrator.");
      }

      setStep("success");
      setTimeout(() => {
        router.replace("/admin");
      }, 1500);

    } catch (err) {
      console.error("MFA verify error:", err);
      setError(err instanceof Error ? err.message : "Invalid code. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (step === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-5">
        <div className="text-center">
          <div className="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2 border-black/20 border-t-black" />
          <p>Processing invitation...</p>
        </div>
      </main>
    );
  }

  if (step === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-5">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-black">Invalid Link</h1>
          <p className="mt-3 text-sm text-red-600">{error}</p>
          <button onClick={() => router.replace("/admin/login")} className="mt-6 w-full rounded-lg bg-black px-4 py-3 text-white">
            Go to Login
          </button>
        </div>
      </main>
    );
  }

  if (step === "success") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-5">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <CheckCircle2 size={32} className="mx-auto text-green-600" />
          <h1 className="mt-4 text-2xl font-semibold text-black">Onboarding Complete</h1>
          <p className="mt-2 text-sm text-black/60">Redirecting to your dashboard...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-5 py-10">
      <div className="w-full max-w-lg">
        {step === "password" && (
          <div className="rounded-[28px] bg-white p-7 shadow-sm md:p-9">
            <h1 className="text-3xl font-semibold text-black mb-2">Set Password</h1>
            <p className="text-sm text-black/60 mb-6">Create a secure password for {email}</p>
            {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <label className="mb-2 block text-xs font-medium text-black/60">New password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border bg-black/[0.02] p-3 pl-4 pr-10 text-sm outline-none focus:border-black/30"
                    required
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2">
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-2 block text-xs font-medium text-black/60">Confirm password</label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-xl border bg-black/[0.02] p-3 pl-4 pr-10 text-sm outline-none focus:border-black/30"
                    required
                  />
                  <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-1/2 -translate-y-1/2">
                    {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={loading} className="w-full rounded-xl bg-black py-3 text-sm font-medium text-white disabled:opacity-50">
                {loading ? "Saving..." : "Save and Continue"}
              </button>
            </form>
          </div>
        )}

        {(step === "mfa-setup" || step === "mfa-verify") && (
          <div className="rounded-[28px] bg-white p-7 shadow-sm md:p-9">
            <h1 className="text-3xl font-semibold text-black mb-2">Secure your account</h1>
            <p className="text-sm text-black/60 mb-6">
              {step === "mfa-setup" ? "Scan the QR code with your authenticator app." : "Enter the code from your authenticator app."}
            </p>
            {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
            
            {step === "mfa-setup" && qrCode && (
              <div className="mb-6 flex justify-center">
                <img src={qrCode} alt="QR Code" className="h-48 w-48" />
              </div>
            )}

            {step === "mfa-setup" && secret && (
              <div className="mb-6 rounded-lg border p-3 text-center text-xs font-mono">
                {secret}
              </div>
            )}

            <form onSubmit={handleMfaVerify} className="space-y-4">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                maxLength={6}
                className="w-full rounded-xl border bg-black/[0.02] p-3 text-center text-xl tracking-[0.4em] outline-none focus:border-black/30"
                required
              />
              <button type="submit" disabled={loading || code.length !== 6} className="w-full rounded-xl bg-black py-3 text-sm font-medium text-white disabled:opacity-50">
                {loading ? "Verifying..." : "Verify"}
              </button>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}
