"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useModalScrollLock } from "./useModalScrollLock";
import {
  X,
  Bed,
  Check,
  AlertCircle,
  ArrowRight,
  Calendar,
  ShieldCheck,
} from "lucide-react";
import {
  calculateStayDates,
} from "@/lib/accommodation-dates";

export interface ExistingStay {
  id: string;
  planName?: string;
  startDate: string;
  endDate: string;
  durationDays?: number;
  amount?: number;
  status: string;
}

export interface AddAccommodationModalProps {
  isOpen: boolean;
  onClose: () => void;
  participantEmail: string;
  participantName: string;
  existingStays: ExistingStay[];
  onProceedToPayment: (paymentOrderId: string, participantId?: string) => Promise<void>;
  isAccommodationLocked?: boolean;
}

export default function AddAccommodationModal({
  isOpen,
  onClose,
  participantEmail,
  participantName,
  existingStays,
  onProceedToPayment,
  isAccommodationLocked = false,
}: AddAccommodationModalProps) {
  const [mounted, setMounted] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useModalScrollLock({
    isOpen,
    onClose,
    focusRef: closeButtonRef,
  });
  const [planSlug, setPlanSlug] = useState("1_day");
  const [selectedDate, setSelectedDate] = useState("2026-10-28");
  const [extraDays, setExtraDays] = useState<"none" | "before_27" | "after_30" | "both">("none");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // Calculate stay dates
  const { effectiveSlug, effectiveDate, startDate, endDate, durationDays, price } = useMemo(() => {
    let effSlug = planSlug;
    let effDate = selectedDate;

    if (planSlug === "2_days") {
      if (extraDays === "before_27") {
        effSlug = "3_days";
        effDate = "2026-10-27";
      } else if (extraDays === "after_30") {
        effSlug = "3_days";
        effDate = "2026-10-28";
      } else if (extraDays === "both") {
        effSlug = "4_days";
        effDate = "2026-10-27";
      } else {
        effDate = selectedDate === "2026-10-30" ? "2026-10-30" : "2026-10-28";
      }
    } else if (planSlug === "3_days") {
      if (selectedDate === "2026-10-29") {
        effDate = "2026-10-29";
      } else if (extraDays === "before_27" || selectedDate === "2026-10-27") {
        effDate = "2026-10-27";
      } else {
        effDate = "2026-10-28";
      }
    } else if (planSlug === "4_days") {
      if (selectedDate === "2026-10-28") {
        effDate = "2026-10-28";
      } else {
        effDate = "2026-10-27";
      }
    }

    const dates = calculateStayDates(effSlug, effDate, extraDays);

    let p = 499;
    if (effSlug === "2_days") p = 999;
    else if (effSlug === "3_days") p = 1498;
    else if (effSlug === "4_days") p = 1997;

    return {
      effectiveSlug: effSlug,
      effectiveDate: effDate,
      startDate: dates.startDate,
      endDate: dates.endDate,
      durationDays: dates.durationDays,
      price: p,
    };
  }, [planSlug, selectedDate, extraDays]);

  // Check overlap with existing confirmed stays (unpaid pending holds do not block re-booking)
  const conflictMessage = useMemo(() => {
    for (const stay of existingStays) {
      if (stay.status === "paid") {
        if (startDate < stay.endDate && endDate > stay.startDate) {
          return `Accommodation is already booked for these dates (${stay.startDate} to ${stay.endDate}). Please choose different dates or review your existing stay.`;
        }
      }
    }
    return null;
  }, [existingStays, startDate, endDate]);

  const handleSubmit = async () => {
    if (isAccommodationLocked) {
      setErrorMessage("Campus Accommodation Booking Paused — Hostel allocations are temporarily closed by administration. Event registrations remain open.");
      return;
    }

    if (conflictMessage) {
      setErrorMessage(conflictMessage);
      return;
    }

    setLoading(true);
    setErrorMessage("");

    try {
      const res = await fetch("/api/team/accommodation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          bookings: [
            {
              email: participantEmail,
              planSlug,
              selectedDate: startDate,
              extraDays,
            },
          ],
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to book accommodation.");
      }

      onClose();
      await onProceedToPayment(data.paymentOrderId, data.participantId);
    } catch (err: any) {
      console.error("Solo accommodation booking error:", err);
      setErrorMessage(err.message || "Failed to book accommodation.");
    } finally {
      setLoading(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[999999] flex items-center justify-center p-3 sm:p-5 md:p-6 overflow-hidden overscroll-none"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-accommodation-title"
          data-lenis-prevent="true"
        >
          <div
            onClick={onClose}
            className="fixed inset-0 bg-black/85 backdrop-blur-md cursor-pointer"
            aria-hidden="true"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="relative flex flex-col w-full max-w-xl max-h-[min(90vh,calc(100dvh-2rem))] overflow-hidden rounded-3xl border border-emerald-500/30 bg-gradient-to-b from-zinc-950 via-zinc-900 to-black text-white shadow-2xl backdrop-blur-xl"
            data-lenis-prevent="true"
          >
            {/* Header (Pinned) */}
            <div className="shrink-0 flex items-start justify-between gap-4 border-b border-white/10 p-5 sm:p-6 md:px-8 bg-zinc-950/70 backdrop-blur-md">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400 text-black shadow-[0_0_10px_#34d399]">
                    <Bed size={12} />
                  </span>
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">
                    Campus Stay Extension
                  </span>
                </div>
                <h2 id="add-accommodation-title" className="mt-2 text-xl sm:text-2xl font-bold tracking-tight text-white">
                  Add Accommodation Stay
                </h2>
                <p className="mt-1 text-xs text-white/60">
                  Book an additional non-overlapping stay for {participantName}.
                </p>
              </div>

              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                className="rounded-xl border border-white/10 bg-white/5 p-2 text-white/60 hover:bg-white/10 hover:text-white transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-400"
                aria-label="Close modal"
                title="Close (Esc)"
              >
                <X size={18} />
              </button>
            </div>

            {/* Scrollable Body Content */}
            <div
              className="flex-1 overflow-y-auto p-5 sm:p-6 md:p-8 space-y-6 overscroll-contain"
              data-lenis-prevent="true"
            >

          {/* Accommodation Locked Banner */}
          {isAccommodationLocked && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
              <div className="flex items-start gap-2.5">
                <AlertCircle size={16} className="shrink-0 text-amber-400 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-amber-200">Campus Accommodation Booking Paused</h4>
                  <p className="mt-0.5 text-amber-300/80 leading-relaxed">
                    Hostel allocations are temporarily closed by administration. Event registrations remain open.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Existing Stays Reminder */}
          {existingStays.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-2">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-white/40">
                Your Existing Stays
              </span>
              <div className="flex flex-wrap gap-2">
                {existingStays.map((s) => (
                  <span
                    key={s.id}
                    className="font-mono text-xs rounded-lg border border-emerald-500/30 bg-emerald-950/40 px-2.5 py-1 text-emerald-300"
                  >
                    {s.startDate} to {s.endDate} ({s.status})
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-950/30 p-3.5 text-xs text-red-300">
              <AlertCircle size={16} className="shrink-0 text-red-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Plan & Date Selection */}
          <div className="space-y-4">
            <div>
              <label className="block font-mono text-xs font-semibold uppercase tracking-wider text-white/60 mb-2">
                Accommodation Plan
              </label>
              <select
                value={planSlug}
                onChange={(e) => {
                  const newPlan = e.target.value;
                  setPlanSlug(newPlan);
                  setExtraDays("none");
                  if (newPlan === "4_days") {
                    setSelectedDate("2026-10-27");
                  } else {
                    setSelectedDate("2026-10-28");
                  }
                  setErrorMessage("");
                }}
                className="w-full rounded-xl border border-white/15 bg-zinc-900 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400 font-mono"
              >
                <option value="1_day">1 Day Pass — ₹499</option>
                <option value="2_days">2 Days Pass — ₹999</option>
                <option value="3_days">3 Days Pass — ₹1,498</option>
                <option value="4_days">4 Days Full Festival — ₹1,997</option>
              </select>
            </div>

            <div>
              <label className="block font-mono text-xs font-semibold uppercase tracking-wider text-white/60 mb-2">
                Stay Date / Timing
              </label>
              {planSlug === "1_day" && (
                <select
                  value={selectedDate}
                  onChange={(e) => {
                    setSelectedDate(e.target.value);
                    setErrorMessage("");
                  }}
                  className="w-full rounded-xl border border-white/15 bg-zinc-900 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400 font-mono"
                >
                  <option value="2026-10-27">27 Oct (Day Before)</option>
                  <option value="2026-10-28">28 Oct (Day 1)</option>
                  <option value="2026-10-29">29 Oct (Day 2)</option>
                  <option value="2026-10-30">30 Oct (Day After)</option>
                  <option value="2026-10-31">31 Oct (Day 4 • Checkout 1 Nov)</option>
                </select>
              )}

              {planSlug === "2_days" && (
                <select
                  value={selectedDate === "2026-10-30" ? "2026-10-30" : "2026-10-28"}
                  onChange={(e) => {
                    setSelectedDate(e.target.value);
                    setExtraDays("none");
                    setErrorMessage("");
                  }}
                  className="w-full rounded-xl border border-white/15 bg-zinc-900 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400 font-mono"
                >
                  <option value="2026-10-28">28–29 Oct (Standard 2 Days • Checkout 30 Oct) — ₹999</option>
                  <option value="2026-10-30">30–31 Oct (Weekend Extended • Checkout 1 Nov) — ₹999</option>
                </select>
              )}

              {planSlug === "3_days" && (
                <select
                  value={selectedDate === "2026-10-29" ? "2026-10-29" : selectedDate === "2026-10-27" ? "2026-10-27" : "2026-10-28"}
                  onChange={(e) => {
                    const dt = e.target.value;
                    setSelectedDate(dt);
                    setExtraDays(dt === "2026-10-27" ? "before_27" : dt === "2026-10-28" ? "after_30" : "none");
                    setErrorMessage("");
                  }}
                  className="w-full rounded-xl border border-white/15 bg-zinc-900 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400 font-mono"
                >
                  <option value="2026-10-27">27–29 Oct (Early Arrival • Checkout 30 Oct) — ₹1,498</option>
                  <option value="2026-10-28">28–30 Oct (Fest + Day After • Checkout 31 Oct) — ₹1,498</option>
                  <option value="2026-10-29">29–31 Oct (Extended Stay • Checkout 1 Nov) — ₹1,498</option>
                </select>
              )}

              {planSlug === "4_days" && (
                <select
                  value={selectedDate === "2026-10-28" ? "2026-10-28" : "2026-10-27"}
                  onChange={(e) => {
                    const dt = e.target.value;
                    setSelectedDate(dt);
                    setExtraDays(dt === "2026-10-27" ? "both" : "none");
                    setErrorMessage("");
                  }}
                  className="w-full rounded-xl border border-white/15 bg-zinc-900 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400 font-mono"
                >
                  <option value="2026-10-27">27–30 Oct (Full Fest Stay • Checkout 31 Oct) — ₹1,997</option>
                  <option value="2026-10-28">28–31 Oct (Extended Full Stay • Checkout 1 Nov) — ₹1,997</option>
                </select>
              )}
            </div>

            {/* Stay Preview Card */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 flex items-center justify-between text-xs">
              <div>
                <p className="text-white/40 font-mono uppercase">Calculated Stay</p>
                <p className="font-semibold text-white mt-0.5">
                  {startDate} to {endDate} ({durationDays} Day{durationDays > 1 ? "s" : ""})
                </p>
              </div>
              <div className="text-right">
                <p className="text-white/40 font-mono uppercase">Fee</p>
                <p className="font-bold text-base font-mono text-emerald-400 mt-0.5">
                  ₹{price}
                </p>
              </div>
            </div>

            {/* Conflict Warning */}
            {conflictMessage && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-950/40 p-3 text-xs text-red-200">
                <AlertCircle size={15} className="shrink-0 text-red-400" />
                <span>{conflictMessage}</span>
              </div>
            )}
          </div>
          {/* End of Form Sections */}
        </div>
        {/* End of Scrollable Body Content */}

        {/* Action Button (Pinned Footer) */}
        <div className="shrink-0 flex items-center justify-between border-t border-white/10 p-4 sm:p-5 md:px-8 bg-zinc-950/70 backdrop-blur-md">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/20"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={loading || Boolean(conflictMessage) || isAccommodationLocked}
            onClick={handleSubmit}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-2.5 text-xs font-semibold text-white shadow-[0_0_20px_rgba(16,185,129,0.35)] transition-all hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-400"
          >
            {loading ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                <span>Connecting Gateway...</span>
              </>
            ) : (
              <>
                <span>Proceed to Pay (₹{price})</span>
                <ArrowRight size={14} />
              </>
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )}
</AnimatePresence>,
document.body
);
}
