"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import QRCode from "qrcode";

import {
  AlertCircle,
  Check,
  ChevronRight,
  CreditCard,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import Footer from "@/components/ui/Footer";
import Navbar from "@/components/ui/Navbar";

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
    <div className="min-h-screen bg-black text-white selection:bg-white selection:text-black">
      {/* Universal Site Navbar */}
      <Navbar />

      <main className="mx-auto max-w-3xl px-6 pt-32 pb-24 md:pt-40 md:pb-32">
        {loading ? (
          <div className="flex min-h-[400px] flex-col items-center justify-center rounded-[32px] border border-white/10 bg-white/[0.02] p-12 text-center">
            <Loader2 className="mb-4 h-8 w-8 animate-spin text-white/40" />
            <p className="text-sm uppercase tracking-widest text-white/50">
              Loading payment details...
            </p>
          </div>
        ) : errorMessage ? (
          <div className="flex min-h-[450px] flex-col items-center justify-center rounded-[32px] border border-red-500/20 bg-red-500/[0.03] p-12 text-center">
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 text-red-400">
              <AlertCircle size={26} />
            </div>

            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-red-400">
              Payment Status Notice
            </p>

            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              Unable to Complete Payment
            </h1>

            <p className="mt-4 max-w-md text-sm leading-6 text-white/60">
              {errorMessage}
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              {data && (
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage("");
                    fetchOrderDetails();
                  }}
                  className="rounded-full bg-white px-8 py-3.5 text-xs font-semibold uppercase tracking-wider text-black transition hover:bg-white/90"
                >
                  Check Status Again
                </button>
              )}
              <button
                type="button"
                onClick={() => router.push("/register")}
                className="rounded-full border border-white/20 px-8 py-3.5 text-xs font-semibold uppercase tracking-wider text-white transition hover:bg-white/10"
              >
                Go to Registration
              </button>
            </div>
          </div>
        ) : paymentCompleted ? (
          <div className="flex min-h-[500px] flex-col items-center justify-center rounded-[32px] border border-white/10 bg-white/[0.03] p-8 text-center md:p-14">
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
              <Check size={28} />
            </div>

            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-emerald-400">
              Payment Confirmed
            </p>

            <h1 className="text-3xl font-bold tracking-tight md:text-5xl">
              You&apos;re in.
            </h1>

            <p className="mt-4 max-w-md text-sm text-white/60">
              Your payment of{" "}
              <span className="font-semibold text-white">
                ₹{data?.amount?.toLocaleString("en-IN")}
              </span>{" "}
              has been successfully verified and your registration is confirmed.
            </p>

            {data?.participant?.participantId && (
              <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.05] px-6 py-3">
                <p className="text-[9px] uppercase tracking-[0.2em] text-white/40">
                  Participant ID
                </p>
                <p className="font-mono text-sm font-bold text-white">
                  {data.participant.participantId}
                </p>
              </div>
            )}

            {qrCodeUrl && (
              <div className="mt-8 rounded-2xl bg-white p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrCodeUrl}
                  alt="Entry QR Code"
                  className="h-44 w-44 md:h-52 md:w-52"
                />
                <p className="mt-2 text-center text-[10px] font-medium text-black/60 uppercase tracking-widest">
                  Present at Entry
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => router.push("/")}
              className="mt-8 rounded-full border border-white/20 px-8 py-3 text-xs font-semibold uppercase tracking-wider text-white transition hover:bg-white hover:text-black"
            >
              Back to Home
            </button>
          </div>
        ) : (
          <div className="rounded-[32px] border border-white/10 bg-white/[0.02] p-8 md:p-12">
            <div className="flex items-center gap-2 text-amber-400">
              <ShieldCheck size={18} />
              <span className="text-[10px] font-bold uppercase tracking-[0.25em]">
                SAVISKAR 2026 &bull; SECURE CHECKOUT
              </span>
            </div>

            <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-5xl">
              Complete Payment
            </h1>

            <p className="mt-3 text-sm text-white/50">
              Your registration details are securely saved. Complete your payment below to confirm your entry pass.
            </p>

            {/* Participant Profile Card */}
            {data?.participant && (
              <div className="mt-8 grid grid-cols-1 gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-white/40">
                    Participant Name
                  </p>
                  <p className="mt-1 font-medium text-white">
                    {data.participant.name}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-white/40">
                    Participant ID
                  </p>
                  <p className="mt-1 font-mono text-sm font-semibold text-white/90">
                    {data.participant.participantId}
                  </p>
                </div>
                {data.participant.college && (
                  <div className="sm:col-span-2">
                    <p className="text-[10px] uppercase tracking-wider text-white/40">
                      College / University
                    </p>
                    <p className="mt-1 text-sm text-white/80">
                      {data.participant.college}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Line Items Breakdown */}
            <div className="mt-8">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/40">
                Registered Events Summary
              </p>

              <div className="mt-4 divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/[0.01]">
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
                          <p className="text-xs text-white/40 capitalize">
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
                <div className="flex items-center justify-between bg-white/[0.03] p-5">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-white/60">
                      Total Payable
                    </p>
                    <p className="text-[11px] text-white/35">Inclusive of all fees</p>
                  </div>
                  <p className="font-mono text-2xl font-bold text-white">
                    ₹{data?.amount?.toLocaleString("en-IN")}
                  </p>
                </div>
              </div>
            </div>

            {/* Action */}
            <div className="mt-10 flex flex-col items-center gap-4">
              <button
                type="button"
                disabled={processingPayment}
                onClick={handleCheckout}
                className="flex w-full items-center justify-center gap-3 rounded-full bg-white py-4 text-sm font-bold uppercase tracking-wider text-black transition hover:bg-white/90 disabled:opacity-50"
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
          <Loader2 className="h-8 w-8 animate-spin text-white/40" />
        </div>
      }
    >
      <PaymentResumeContent />
    </Suspense>
  );
}
