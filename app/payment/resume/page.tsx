"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import QRCode from "qrcode";

import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronRight,
  CreditCard,
  Loader2,
  QrCode,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Footer from "@/components/ui/Footer";
import Navbar from "@/components/ui/Navbar";
import MouseSpotlight from "@/components/ui/MouseSpotlight";

type ResumeTeamMember = {
  participantId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  college?: string | null;
  isTeamLeader: boolean;
  role: string;
};

type ResumeOrderData = {
  success: boolean;
  status: "pending" | "paid";
  paymentOrderId: string;
  orderReference: string;
  amount: number;
  currency: string;
  message?: string;
  participant?: {
    participantId: string;
    name: string;
    college: string;
    email: string;
  };
  items?: Array<{
    itemId: string;
    eventId: string;
    eventName: string;
    category?: string | null;
    amount: number;
  }>;
  teamMembers?: ResumeTeamMember[];
  error?: string;
  code?: string;
};

// Removed PayU types and loadScript

function PaymentResumeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") || "";

  const [loading, setLoading] = useState(() => Boolean(token));
  const [data, setData] = useState<ResumeOrderData | null>(null);
  const [errorMessage, setErrorMessage] = useState(() =>
    token ? "" : "No payment resume token was provided."
  );
  const [processingPayment, setProcessingPayment] = useState(false);
  const [paymentCompleted, setPaymentCompleted] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState("");

  const fetchOrderDetails = useCallback(async () => {
    if (!token) return;

    try {
      setLoading(true);
      setErrorMessage("");

      const res = await fetch(
        `/api/payments/resume?token=${encodeURIComponent(token)}`,
        {
          headers: { Accept: "application/json" },
        }
      );

      let json: ResumeOrderData | null = null;
      try {
        const text = await res.text();
        if (text && text.trim().length > 0) {
          json = JSON.parse(text);
        }
      } catch {
        json = null;
      }

      if (!res.ok || !json?.success) {
        throw new Error(
          json?.error || "This payment link is invalid or has expired."
        );
      }

      setData(json);

      if (json.status === "paid") {
        setPaymentCompleted(true);
        if (json.participant?.participantId) {
          const qr = await QRCode.toDataURL(json.participant.participantId, {
            width: 500,
            margin: 2,
            errorCorrectionLevel: "H",
          });
          setQrCodeUrl(qr);
        }
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Could not load payment information."
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchOrderDetails();
  }, [fetchOrderDetails]);

  async function handleCheckout() {
    if (!data || !data.paymentOrderId) return;

    setProcessingPayment(true);
    setErrorMessage("");

    try {
      // 1. Create gateway order
      const createRes = await fetch("/api/payments/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-payment-resume-token": token,
        },
        body: JSON.stringify({
          paymentOrderId: data.paymentOrderId,
          resumeToken: token,
        }),
      });

      let createJson: {
        success?: boolean;
        error?: string;
        code?: string;
        alreadyPaid?: boolean;
        participantId?: string;
        participant?: {
          participantId?: string;
          name?: string;
          email?: string;
          college?: string;
        };
        paymentOrderId?: string;
        resumeToken?: string;
        checkoutConfig?: {
          postUrl?: string;
          options?: Record<string, unknown>;
        };
      } | null = null;

      try {
        const text = await createRes.text();
        if (text && text.trim().length > 0) {
          createJson = JSON.parse(text);
        }
      } catch {
        createJson = null;
      }

      if (!createRes.ok || !createJson?.success) {
        if (
          createJson?.code === "VERIFICATION_UNAVAILABLE" ||
          createRes.status === 503 ||
          createRes.status === 502
        ) {
          throw new Error(
            "Payment verification is temporarily unavailable. Please try again in a few moments."
          );
        }
        if (
          createJson?.code === "PAYMENT_PENDING" ||
          createRes.status === 409
        ) {
          throw new Error(
            createJson?.error ||
              "A payment attempt is currently being processed by the gateway. Please complete it on your payment app or wait a few moments before retrying."
          );
        }
        throw new Error(
          createJson?.error || "Could not initialize payment with gateway. Please try again."
        );
      }

      // Check if order was already paid
      if (createJson.alreadyPaid) {
        setPaymentCompleted(true);
        const resolvedParticipantId =
          createJson.participantId ||
          createJson.participant?.participantId ||
          data.participant?.participantId;
        if (resolvedParticipantId) {
          setData((prev) =>
            prev
              ? {
                  ...prev,
                  participant: prev.participant
                    ? { ...prev.participant, participantId: resolvedParticipantId }
                    : undefined,
                }
              : prev
          );
          const qr = await QRCode.toDataURL(resolvedParticipantId, {
            width: 500,
            margin: 2,
            errorCorrectionLevel: "H",
          });
          setQrCodeUrl(qr);
        }
        return;
      }

      if (createJson.paymentOrderId && createJson.paymentOrderId !== data.paymentOrderId) {
        setData((prev) => (prev ? { ...prev, paymentOrderId: createJson.paymentOrderId! } : prev));
      }

      if (createJson.resumeToken && typeof window !== "undefined") {
        window.history.replaceState(
          null,
          "",
          `/payment/resume?token=${encodeURIComponent(createJson.resumeToken)}`
        );
      }

      // 2. Submit PayU Hosted Checkout form
      const checkoutConfig = createJson.checkoutConfig;
      const options = checkoutConfig?.options ?? {};
      const postUrl = checkoutConfig?.postUrl;

      if (!postUrl || !options.hash) {
        throw new Error(
          "Payment gateway configuration is missing or invalid."
        );
      }

      const checkoutForm = document.createElement("form");
      checkoutForm.method = "POST";
      checkoutForm.action = postUrl;
      checkoutForm.style.display = "none";

      for (const [key, value] of Object.entries(options)) {
        if (value !== undefined && value !== null) {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = key;
          input.value = String(value);
          checkoutForm.appendChild(input);
        }
      }

      document.body.appendChild(checkoutForm);
      checkoutForm.submit();
      
      // Keep processingPayment as true because we are navigating away.
      return;
    } catch (err) {
      console.error("Resume checkout error:", err);
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Payment could not be processed. Please try again."
      );
    } finally {
      setProcessingPayment(false);
    }
  }

  return (
    <div className="relative min-h-screen w-full bg-black text-white selection:bg-white selection:text-black">
      {/* 1. FIXED FULL-BLEED PANORAMIC STADIUM BACKGROUND */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <Image
          src="/images/realms-page-bg.webp"
          alt="Saviskar 2026 Festival Amphitheater Stadium Canopy"
          fill
          priority
          sizes="100vw"
          className="object-cover object-center opacity-65 will-change-transform"
        />

        {/* Multi-layered cinematic gradient vignettes - balanced for vivid background visibility */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/45 to-black/85" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.15)_0%,rgba(0,0,0,0.75)_100%)]" />

        {/* Subtle celestial stardust grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_70%_50%_at_50%_35%,#000_60%,transparent_100%)] pointer-events-none" />

        {/* Subtle Ambient Cosmic Haze */}
        <div className="absolute left-[15%] top-[12%] h-[650px] w-[650px] rounded-full bg-violet-600/20 blur-[180px]" />
        <div className="absolute right-[10%] top-[35%] h-[550px] w-[550px] rounded-full bg-cyan-500/15 blur-[170px]" />
        <div className="absolute left-[20%] bottom-[15%] h-[600px] w-[600px] rounded-full bg-fuchsia-600/15 blur-[180px]" />
      </div>

      {/* Interactive Cursor Spotlight */}
      <div className="pointer-events-none fixed inset-0 z-10">
        <MouseSpotlight />
      </div>

      {/* Universal Site Navbar */}
      <Navbar />

      <main className="relative z-10 mx-auto max-w-4xl px-4 sm:px-6 pt-24 pb-12 md:pt-28 md:pb-16">
        {loading ? (
          <div className="liquid-glass-card flex min-h-[380px] flex-col items-center justify-center rounded-[32px] border border-white/10 p-12 text-center backdrop-blur-2xl">
            <Loader2 className="mb-4 h-8 w-8 animate-spin text-violet-400" />
            <p className="font-mono text-xs uppercase tracking-widest text-white/60">
              Loading payment details...
            </p>
          </div>
        ) : errorMessage ? (
          <div className="liquid-glass-card flex min-h-[420px] flex-col items-center justify-center rounded-[32px] border border-red-500/25 bg-red-950/20 p-8 text-center backdrop-blur-2xl md:p-12 shadow-[0_0_50px_rgba(239,68,68,0.15)]">
            <div className="mb-5 flex h-13 w-13 items-center justify-center rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
              <AlertCircle size={24} />
            </div>

            <p className="mb-2 text-[10px] font-mono font-semibold uppercase tracking-[0.25em] text-red-400">
              Payment Status Notice
            </p>

            <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">
              Unable to Complete Payment
            </h1>

            <p className="mt-3 max-w-md text-sm leading-6 text-zinc-300">
              {errorMessage}
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              {data && (
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage("");
                    fetchOrderDetails();
                  }}
                  className="rounded-full bg-white px-7 py-3 text-xs font-semibold uppercase tracking-wider text-black transition-all hover:bg-violet-100 hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(255,255,255,0.3)] cursor-pointer"
                >
                  Check Status Again
                </button>
              )}
              <button
                type="button"
                onClick={() => router.push("/register")}
                className="liquid-glass-interactive rounded-full px-7 py-3 text-xs font-semibold uppercase tracking-wider text-white transition-all hover:scale-105 active:scale-95 cursor-pointer"
              >
                Go to Registration
              </button>
            </div>
          </div>
        ) : paymentCompleted ? (
          <div className="liquid-glass-card relative overflow-hidden rounded-[32px] border border-violet-500/35 bg-gradient-to-b from-violet-950/45 via-[#080512]/80 to-[#040208]/90 p-6 sm:p-8 text-center text-white backdrop-blur-2xl shadow-[0_30px_100px_rgba(0,0,0,0.95),0_0_80px_rgba(168,85,247,0.22)]">
            {/* Ambient glows inside card */}
            <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-violet-600/20 blur-[120px]" />
            <div className="pointer-events-none absolute -left-24 -bottom-24 h-80 w-80 rounded-full bg-cyan-600/15 blur-[120px]" />

            {/* Header: Check icon, pill badge, title & subtitle */}
            <div className="relative z-10 flex flex-col items-center">
              <div className="mb-3 flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-full bg-white text-black shadow-[0_0_25px_rgba(255,255,255,0.4)]">
                <Check size={22} className="text-black stroke-[2.5]" />
              </div>

              <div className="liquid-glass mb-2 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-[10px] sm:text-[11px] font-mono font-semibold uppercase tracking-[0.25em] text-violet-300 shadow-[0_0_20px_rgba(168,85,247,0.2)]">
                <Sparkles size={11} className="text-violet-300" />
                <span>PAYMENT CONFIRMED // SAVISKAR 2026</span>
              </div>

              <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-white">
                You&apos;re <span className="font-editorial text-violet-300 font-normal italic">in.</span>
              </h1>

              <p className="mt-1.5 max-w-lg text-xs sm:text-sm text-zinc-300">
                Your payment of{" "}
                <span className="font-semibold text-white font-mono">
                  ₹{data?.amount?.toLocaleString("en-IN")}
                </span>{" "}
                has been successfully verified and your registration is confirmed.
              </p>

              {/* Compact Participant ID block */}
              {data?.participant?.participantId && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-xl border border-violet-500/30 bg-violet-950/45 px-4 py-1.5 shadow-[0_0_20px_rgba(168,85,247,0.15)]">
                  <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/50">
                    PERMANENT PARTICIPANT ID:
                  </span>
                  <span className="font-mono text-xs sm:text-sm font-bold tracking-wider text-white">
                    {data.participant.participantId}
                  </span>
                </div>
              )}
            </div>

            {/* Desktop Two-Column Section: Left (Registered Events) | Right (Digital Pass / QR) */}
            <div className="relative z-10 mt-6 grid grid-cols-1 md:grid-cols-12 gap-4 sm:gap-5 w-full items-stretch">
              {/* Left Column: Registered Events */}
              <div className="md:col-span-7 flex flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5 text-left backdrop-blur-md">
                <div>
                  <div className="flex items-center justify-between border-b border-white/10 pb-2.5 mb-3">
                    <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.25em] text-violet-300">
                      REGISTERED EVENTS
                    </p>
                    <span className="font-mono text-[10px] text-white/40 uppercase">
                      {data?.items?.length || 1} {data?.items?.length === 1 ? "Event" : "Events"}
                    </span>
                  </div>

                  <div className="space-y-2 max-h-[190px] overflow-y-auto pr-1">
                    {data?.items && data.items.length > 0 ? (
                      data.items.map((item, idx) => (
                        <div
                          key={item.itemId || item.eventId || idx}
                          className="flex items-start justify-between gap-3 rounded-xl border border-white/5 bg-black/40 p-2.5 transition-colors hover:border-violet-500/25"
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            <span className="font-mono text-xs font-bold text-violet-400 shrink-0 mt-0.5">
                              {String(idx + 1).padStart(2, "0")}
                            </span>
                            <div className="min-w-0">
                              <p className="text-xs sm:text-sm font-semibold text-white truncate">
                                {item.eventName}
                              </p>
                              {item.category && (
                                <p className="text-[10px] text-zinc-400 capitalize">
                                  {item.category} Realm
                                </p>
                              )}
                            </div>
                          </div>
                          <span className="font-mono text-xs font-semibold text-white/90 shrink-0">
                            ₹{item.amount.toLocaleString("en-IN")}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center justify-between rounded-xl border border-white/5 bg-black/40 p-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-xs font-bold text-violet-400">01</span>
                          <div>
                            <p className="text-xs sm:text-sm font-semibold text-white">Event Registration</p>
                            <p className="text-[10px] text-zinc-400">Official Fest Entry</p>
                          </div>
                        </div>
                        <span className="font-mono text-xs font-semibold text-white/90">
                          ₹{data?.amount?.toLocaleString("en-IN")}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Team Members List (Only for Team Registrations) */}
                  {data?.teamMembers && data.teamMembers.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-white/10">
                      <div className="flex items-center justify-between pb-2 mb-1.5">
                        <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.25em] text-violet-300">
                          TEAM MEMBERS
                        </p>
                        <span className="font-mono text-[10px] text-white/40 uppercase">
                          {data.teamMembers.length} {data.teamMembers.length === 1 ? "Member" : "Members"}
                        </span>
                      </div>

                      <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                        {data.teamMembers.map((member, idx) => (
                          <div
                            key={member.participantId || idx}
                            className="flex items-center justify-between gap-2.5 rounded-xl border border-white/5 bg-black/40 px-3 py-2 transition-colors hover:border-violet-500/25"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-mono text-[10px] font-bold text-violet-400 shrink-0">
                                {String(idx + 1).padStart(2, "0")}
                              </span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className="text-xs sm:text-sm font-semibold text-white truncate">
                                    {member.name}
                                  </p>
                                  {member.isTeamLeader && (
                                    <span className="rounded-full bg-violet-500/20 border border-violet-500/30 px-1.5 py-0.5 text-[9px] font-mono font-medium text-violet-300 shrink-0">
                                      Lead
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <span className="font-mono text-xs font-bold text-violet-200 tracking-wider shrink-0 bg-violet-950/40 px-2 py-0.5 rounded border border-violet-500/20">
                              {member.participantId}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Total Paid & Verification Status */}
                <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between text-xs text-white/60">
                  <span>
                    Total: <strong className="font-mono text-white font-bold">₹{data?.amount?.toLocaleString("en-IN")}</strong>
                  </span>
                  <span className="text-emerald-400 flex items-center gap-1 font-mono text-[10px]">
                    <Check size={12} className="stroke-[3]" /> Verified
                  </span>
                </div>
              </div>

              {/* Right Column: Digital Entry Pass / QR */}
              <div className="md:col-span-5 flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5 text-center backdrop-blur-md">
                <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.25em] text-violet-300 mb-2.5">
                  DIGITAL ENTRY PASS
                </p>

                {qrCodeUrl && (
                  <div className="rounded-2xl bg-white p-3 shadow-[0_15px_35px_rgba(0,0,0,0.8)] border border-white/20">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={qrCodeUrl}
                      alt="Official Entry QR Code"
                      className="h-28 w-28 sm:h-32 sm:w-32 md:h-36 md:w-36"
                    />
                    <p className="mt-1.5 text-center text-[9px] font-bold text-black/75 uppercase tracking-[0.22em]">
                      PRESENT AT ENTRY
                    </p>
                  </div>
                )}

                <div className="mt-2.5 flex items-center justify-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-violet-300/80">
                  <QrCode size={12} />
                  <span>Official Digital Entry Pass</span>
                </div>
              </div>
            </div>

            {/* Action Buttons: In ONE horizontal row on desktop, stacked on mobile */}
            <div className="relative z-10 mt-6 flex flex-col sm:flex-row items-center justify-center gap-3.5 w-full max-w-lg mx-auto">
              <button
                type="button"
                onClick={() => router.push("/register")}
                className="group w-full sm:w-auto rounded-full bg-white px-7 py-3 text-xs sm:text-sm font-semibold tracking-wide text-black shadow-[0_0_25px_rgba(255,255,255,0.3)] transition-all hover:bg-violet-100 hover:scale-105 active:scale-95 inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>REGISTER ANOTHER PARTICIPANT</span>
                <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
              </button>

              <button
                type="button"
                onClick={() => router.push("/")}
                className="liquid-glass-interactive w-full sm:w-auto rounded-full px-7 py-3 text-xs sm:text-sm font-medium tracking-wide text-white transition-all hover:scale-105 active:scale-95 inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>BACK TO HOME</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="liquid-glass-card rounded-[32px] border border-violet-500/25 bg-gradient-to-b from-violet-950/30 via-[#080512]/60 to-[#040208]/80 p-8 md:p-12 backdrop-blur-2xl shadow-[0_20px_60px_rgba(0,0,0,0.8),0_0_50px_rgba(168,85,247,0.12)]">
            <div className="flex items-center gap-2 text-amber-400">
              <ShieldCheck size={18} />
              <span className="text-[10px] font-mono font-bold uppercase tracking-[0.25em]">
                SAVISKAR 2026 &bull; SECURE CHECKOUT
              </span>
            </div>

            <h1 className="mt-4 text-3xl font-light tracking-tight text-white md:text-5xl">
              Complete <span className="font-editorial text-violet-300 font-normal italic">Payment</span>
            </h1>

            <p className="mt-3 text-sm text-zinc-300">
              Your registration details are securely saved. Complete your payment below to confirm your entry pass.
            </p>

            {/* Participant Profile Card */}
            {data?.participant && (
              <div className="mt-8 grid grid-cols-1 gap-4 rounded-2xl border border-violet-500/20 bg-violet-950/30 p-6 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-white/50">
                    Participant Name
                  </p>
                  <p className="mt-1 font-medium text-white">
                    {data.participant.name}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-white/50">
                    Participant ID
                  </p>
                  <p className="mt-1 font-mono text-sm font-semibold text-white/90">
                    {data.participant.participantId}
                  </p>
                </div>
                {data.participant.college && (
                  <div className="sm:col-span-2">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-white/50">
                      College / University
                    </p>
                    <p className="mt-1 text-sm text-zinc-300">
                      {data.participant.college}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Line Items Breakdown */}
            <div className="mt-8">
              <p className="text-xs font-mono font-semibold uppercase tracking-wider text-violet-300">
                Registered Events Summary
              </p>

              <div className="mt-4 divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/[0.02]">
                {data?.items && data.items.length > 0 ? (
                  data.items.map((item) => (
                    <div
                      key={item.itemId || item.eventId}
                      className="flex items-center justify-between p-4 sm:p-5"
                    >
                      <div>
                        <p className="font-semibold text-white">
                          {item.eventName}
                        </p>
                        {item.category && (
                          <p className="text-xs text-zinc-400 capitalize">
                            {item.category} Event
                          </p>
                        )}
                      </div>
                      <p className="font-mono text-sm font-bold text-white">
                        ₹{item.amount.toLocaleString("en-IN")}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center justify-between p-5">
                    <p className="font-semibold text-white">Event Registration</p>
                    <p className="font-mono text-sm font-bold text-white">
                      ₹{data?.amount?.toLocaleString("en-IN")}
                    </p>
                  </div>
                )}

                {/* Total */}
                <div className="flex items-center justify-between bg-violet-950/20 p-5">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-white/70">
                      Total Payable
                    </p>
                    <p className="text-[11px] text-white/40">Inclusive of all fees</p>
                  </div>
                  <p className="font-mono text-2xl font-bold text-white">
                    ₹{data?.amount?.toLocaleString("en-IN")}
                  </p>
                </div>
              </div>
            </div>

            {/* Team Members List (Only for Team Registrations) */}
            {data?.teamMembers && data.teamMembers.length > 0 && (
              <div className="mt-8">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-mono font-semibold uppercase tracking-wider text-violet-300">
                    Team Members ({data.teamMembers.length})
                  </p>
                  <span className="font-mono text-[10px] text-white/50 uppercase tracking-widest">
                    Permanent IDs Assigned
                  </span>
                </div>

                <div className="mt-4 divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/[0.02]">
                  {data.teamMembers.map((member, idx) => (
                    <div
                      key={member.participantId || idx}
                      className="flex items-center justify-between p-3.5 sm:p-4"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono text-xs font-bold text-violet-400">
                          {String(idx + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-white text-xs sm:text-sm">
                              {member.name}
                            </p>
                            {member.isTeamLeader && (
                              <span className="rounded-full bg-violet-500/20 border border-violet-500/30 px-1.5 py-0.5 text-[9px] font-mono font-medium text-violet-300">
                                Team Head
                              </span>
                            )}
                          </div>
                          {member.email && (
                            <p className="text-[11px] text-zinc-400 font-mono">
                              {member.email}
                            </p>
                          )}
                        </div>
                      </div>
                      <span className="font-mono text-xs font-bold text-violet-200 tracking-wider bg-violet-950/40 px-2.5 py-1 rounded border border-violet-500/20">
                        {member.participantId}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action */}
            <div className="mt-10 flex flex-col items-center gap-4">
              <button
                type="button"
                disabled={processingPayment}
                onClick={handleCheckout}
                className="flex w-full items-center justify-center gap-3 rounded-full bg-white py-4 text-sm font-bold uppercase tracking-wider text-black shadow-[0_0_30px_rgba(255,255,255,0.35)] transition-all hover:bg-violet-100 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 cursor-pointer"
              >
                {processingPayment ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Opening Payment Gateway...
                  </>
                ) : (
                  <>
                    <CreditCard size={18} />
                    Complete Payment &bull; ₹{data?.amount?.toLocaleString("en-IN")}
                    <ChevronRight size={16} />
                  </>
                )}
              </button>

              <p className="text-center text-[11px] text-white/40">
                Encrypted and processed securely via PayU. Your receipt will be automatically emailed upon confirmation.
              </p>
            </div>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

export default function PaymentResumePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-black text-white">
          <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
        </div>
      }
    >
      <PaymentResumeContent />
    </Suspense>
  );
}
