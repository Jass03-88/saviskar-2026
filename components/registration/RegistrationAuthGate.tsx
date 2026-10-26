"use client";

import React, { useState, useRef, useEffect, FormEvent, ClipboardEvent, KeyboardEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Sparkles,
  ArrowRight,
  Mail,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  ArrowLeft,
} from "lucide-react";

interface RegistrationAuthGateProps {
  initialEmail?: string;
  onAuthenticated: (email: string) => void;
  isRegistrationLocked?: boolean;
}

export default function RegistrationAuthGate({
  initialEmail = "",
  onAuthenticated,
  isRegistrationLocked = false,
}: RegistrationAuthGateProps) {
  const [step, setStep] = useState<"email" | "otp" | "success">("email");
  const [email, setEmail] = useState(initialEmail);
  const [otpDigits, setOtpDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [cooldown, setCooldown] = useState(0);

  const otpInputsRef = useRef<(HTMLInputElement | null)[]>([]);

  // Cooldown timer effect
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Focus first OTP input when transitioning to OTP step
  useEffect(() => {
    if (step === "otp") {
      setTimeout(() => {
        otpInputsRef.current[0]?.focus();
      }, 100);
    }
  }, [step]);

  /* ------------------------------------------------------------------
   * STEP 1: SUBMIT EMAIL FOR OTP
   * ------------------------------------------------------------------ */
  const handleEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    if (isRegistrationLocked) {
      setErrorMessage("Participant registration is temporarily paused by administration. Please check back shortly.");
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!cleanEmail || !emailPattern.test(cleanEmail)) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        setErrorMessage(
          data?.error || "Unable to send verification code. Please try again."
        );
        if (data?.retryAfter) {
          setCooldown(data.retryAfter);
        }
        setLoading(false);
        return;
      }

      setStep("otp");
      setCooldown(60); // 60s cooldown for resend
      setOtpDigits(["", "", "", "", "", ""]);
    } catch {
      setErrorMessage("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  /* ------------------------------------------------------------------
   * RESEND CODE
   * ------------------------------------------------------------------ */
  const handleResendOtp = async () => {
    if (cooldown > 0 || loading) return;
    setErrorMessage("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        setErrorMessage(
          data?.error || "Unable to resend verification code. Please try again."
        );
        if (data?.retryAfter) {
          setCooldown(data.retryAfter);
        }
        setLoading(false);
        return;
      }

      setCooldown(60);
      setOtpDigits(["", "", "", "", "", ""]);
      setTimeout(() => {
        otpInputsRef.current[0]?.focus();
      }, 50);
    } catch {
      setErrorMessage("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  /* ------------------------------------------------------------------
   * OTP INPUT HANDLING (Segmented 6-digit box with auto-advance & paste)
   * ------------------------------------------------------------------ */
  const handleOtpDigitChange = (index: number, val: string) => {
    // Only accept numeric digit
    const digit = val.replace(/\D/g, "").slice(-1);
    const newDigits = [...otpDigits];
    newDigits[index] = digit;
    setOtpDigits(newDigits);
    setErrorMessage("");

    // Auto-advance to next box if digit entered
    if (digit && index < 5) {
      otpInputsRef.current[index + 1]?.focus();
    }

    // Auto-verify if all 6 digits are filled
    if (digit && index === 5 && newDigits.every((d) => d !== "")) {
      verifyOtpCode(newDigits.join(""));
    }
  };

  const handleOtpKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otpDigits[index] && index > 0) {
      // Backspace on empty field moves to previous
      otpInputsRef.current[index - 1]?.focus();
    } else if (e.key === "ArrowLeft" && index > 0) {
      otpInputsRef.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < 5) {
      otpInputsRef.current[index + 1]?.focus();
    }
  };

  const handleOtpPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;

    const newDigits = [...otpDigits];
    for (let i = 0; i < 6; i++) {
      newDigits[i] = pasted[i] || "";
    }
    setOtpDigits(newDigits);
    setErrorMessage("");

    // Focus appropriate input
    const nextEmptyIndex = newDigits.findIndex((d) => d === "");
    if (nextEmptyIndex !== -1) {
      otpInputsRef.current[nextEmptyIndex]?.focus();
    } else {
      otpInputsRef.current[5]?.focus();
      verifyOtpCode(newDigits.join(""));
    }
  };

  /* ------------------------------------------------------------------
   * STEP 2: VERIFY OTP
   * ------------------------------------------------------------------ */
  const verifyOtpCode = async (code: string) => {
    if (code.length !== 6 || loading) return;
    setErrorMessage("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          otp: code,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        setErrorMessage(data?.error || "Invalid or expired verification code.");
        setLoading(false);
        return;
      }

      setStep("success");
      setTimeout(() => {
        onAuthenticated(email.trim().toLowerCase());
      }, 700);
    } catch {
      setErrorMessage("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = (e: FormEvent) => {
    e.preventDefault();
    verifyOtpCode(otpDigits.join(""));
  };

  return (
    <div className="relative z-20 w-full max-w-lg mx-auto px-4 py-8 sm:py-12">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/70 p-6 sm:p-10 backdrop-blur-2xl shadow-[0_0_60px_rgba(168,85,247,0.18)]"
      >
        {/* Glow ambient accent within the card */}
        <div className="pointer-events-none absolute -top-24 -right-24 h-48 w-48 rounded-full bg-violet-600/20 blur-[80px]" />
        <div className="pointer-events-none absolute -bottom-24 -left-24 h-48 w-48 rounded-full bg-cyan-500/15 blur-[80px]" />

        {/* Top Branding Pill */}
        <div className="flex justify-center mb-6">
          <div className="liquid-glass inline-flex items-center gap-2 rounded-full px-3.5 py-1 text-[10px] font-mono font-semibold uppercase tracking-[0.25em] text-violet-300 shadow-[0_0_15px_rgba(168,85,247,0.25)]">
            <Sparkles size={11} className="text-violet-300" />
            <span>SAVISKAR 2026 // ACCREDITATION</span>
          </div>
        </div>

        {/* Card Heading & Subtext */}
        <div className="text-center mb-8">
          <h2 className="text-3xl sm:text-4xl font-light tracking-tight text-white">
            Claim Your{" "}
            <span className="font-editorial text-violet-300 font-normal italic">
              Pass
            </span>
          </h2>
          <p className="mt-2 text-sm text-zinc-400 font-normal leading-relaxed max-w-sm mx-auto">
            {step === "email"
              ? "Sign in or create your registration account using your email."
              : step === "otp"
              ? "We sent a 6-digit verification code to your email."
              : "Authentication confirmed. Preparing registration portal..."}
          </p>
        </div>

        {/* Error Notification Banner */}
        <AnimatePresence>
          {errorMessage && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-6 flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-950/40 p-3.5 text-xs text-red-200"
              role="alert"
            >
              <AlertCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 leading-relaxed">{errorMessage}</div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Registration Locked Banner */}
        {isRegistrationLocked && (
          <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
            <div className="flex items-start gap-2.5">
              <AlertCircle size={16} className="text-amber-400 mt-0.5 shrink-0" />
              <div>
                <h4 className="font-semibold text-amber-200">Registration Temporarily Paused</h4>
                <p className="mt-0.5 text-amber-300/80 leading-relaxed">
                  Online participant registrations and onboarding are temporarily paused by administration. Please check back shortly.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* --------------------------------------------------------
            STEP 1: EMAIL ENTRY FORM
            -------------------------------------------------------- */}
        {step === "email" && (
          <form onSubmit={handleEmailSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="auth-email-input"
                className="block text-xs font-mono font-medium uppercase tracking-wider text-zinc-300 mb-2"
              >
                Email Address
              </label>
              <div className="relative">
                <input
                  id="auth-email-input"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@university.edu"
                  autoComplete="email"
                  disabled={loading || isRegistrationLocked}
                  className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-3.5 pl-11 text-sm text-white placeholder-zinc-500 transition-all focus:border-violet-400 focus:bg-black/80 focus:outline-none focus:ring-2 focus:ring-violet-400/40 disabled:opacity-50"
                />
                <Mail
                  size={16}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !email.trim() || isRegistrationLocked}
              className="group relative flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-3.5 text-sm font-semibold text-white shadow-[0_0_25px_rgba(168,85,247,0.35)] transition-all hover:from-violet-500 hover:to-indigo-500 hover:scale-[1.01] active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw size={16} className="animate-spin text-white" />
                  <span>Sending Code...</span>
                </>
              ) : (
                <>
                  <span>Continue with Email</span>
                  <ArrowRight
                    size={16}
                    className="transition-transform group-hover:translate-x-1"
                  />
                </>
              )}
            </button>

            <p className="text-center text-[11px] text-zinc-500 leading-relaxed pt-2">
              By continuing, you agree to the Saviskar 2026 festival participation
              guidelines and university delegate code of conduct.
            </p>
          </form>
        )}

        {/* --------------------------------------------------------
            STEP 2: OTP 6-DIGIT VERIFICATION FORM
            -------------------------------------------------------- */}
        {step === "otp" && (
          <form onSubmit={handleOtpSubmit} className="space-y-6">
            {/* Display Active Email */}
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2">
              <span className="font-mono text-xs text-zinc-300 truncate max-w-[240px] sm:max-w-[280px]">
                {email}
              </span>
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setErrorMessage("");
                }}
                className="text-xs font-medium text-violet-300 hover:text-violet-200 transition-colors inline-flex items-center gap-1"
              >
                <ArrowLeft size={12} />
                <span>Change</span>
              </button>
            </div>

            {/* 6-Digit Segmented OTP Input */}
            <div>
              <label className="block text-center text-xs font-mono font-medium uppercase tracking-wider text-zinc-400 mb-3">
                Enter 6-Digit Verification Code
              </label>
              <div
                className="grid grid-cols-6 gap-2 sm:gap-3"
                onPaste={handleOtpPaste}
              >
                {otpDigits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => {
                      otpInputsRef.current[idx] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="one-time-code"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpDigitChange(idx, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    disabled={loading}
                    aria-label={`Digit ${idx + 1}`}
                    className="h-12 sm:h-14 w-full rounded-xl border border-white/15 bg-black/60 text-center font-mono text-xl sm:text-2xl font-bold text-white transition-all focus:border-violet-400 focus:bg-violet-950/20 focus:outline-none focus:ring-2 focus:ring-violet-400/50 disabled:opacity-50"
                  />
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || otpDigits.some((d) => d === "")}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-3.5 text-sm font-semibold text-white shadow-[0_0_25px_rgba(168,85,247,0.35)] transition-all hover:from-violet-500 hover:to-indigo-500 hover:scale-[1.01] active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw size={16} className="animate-spin text-white" />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <ShieldCheck size={16} />
                  <span>Verify Email</span>
                </>
              )}
            </button>

            {/* Resend Action with Cooldown */}
            <div className="flex items-center justify-center gap-1.5 text-xs text-zinc-400">
              <span>Didn&apos;t receive the code?</span>
              {cooldown > 0 ? (
                <span className="font-mono text-zinc-500">
                  Resend in {cooldown}s
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={loading}
                  className="font-medium text-violet-300 hover:text-violet-200 transition-colors underline disabled:opacity-50"
                >
                  Resend code
                </button>
              )}
            </div>
          </form>
        )}

        {/* --------------------------------------------------------
            STEP 3: SUCCESS ANIMATION
            -------------------------------------------------------- */}
        {step === "success" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="py-8 text-center space-y-3"
          >
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-violet-600/20 border border-violet-500/40 text-violet-300 shadow-[0_0_30px_rgba(168,85,247,0.4)]">
              <CheckCircle2 size={32} className="text-violet-400" />
            </div>
            <h3 className="text-xl font-semibold text-white">Verification Confirmed</h3>
            <p className="text-xs text-zinc-400 font-mono">
              Redirecting to official registration...
            </p>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
