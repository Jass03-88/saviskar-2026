"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useModalScrollLock } from "./useModalScrollLock";
import {
  X,
  Bed,
  Users,
  Check,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  Calendar,
  Sparkles,
} from "lucide-react";
import { calculateStayDates } from "@/lib/accommodation-dates";

export interface TeamMemberForModal {
  id: string;
  name: string;
  email: string;
  phone?: string;
  isTeamLeader: boolean;
  participantId: string | null;
  college: string | null;
  accommodations?: Array<{
    id: string;
    planName: string;
    planSlug: string;
    startDate: string;
    endDate: string;
    durationDays: number;
    amount: number;
    status: string;
  }>;
}

export interface TeamAccommodationModalProps {
  isOpen: boolean;
  onClose: () => void;
  participantEventId: string;
  teamName: string;
  eventName: string;
  members: TeamMemberForModal[];
  onProceedToPayment: (paymentOrderId: string, participantId?: string) => Promise<void>;
}

interface MemberBookingSelection {
  selected: boolean;
  planSlug: string;
  selectedDate: string;
  extraDays: "none" | "before_27" | "after_30" | "both";
}

export default function TeamAccommodationModal({
  isOpen,
  onClose,
  participantEventId,
  teamName,
  eventName,
  members,
  onProceedToPayment,
}: TeamAccommodationModalProps) {
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

  // Map of member email -> selection state (defaulting to festival standard: 2_days, 28th-30th Oct)
  const [selections, setSelections] = useState<Record<string, MemberBookingSelection>>(() => {
    const initial: Record<string, MemberBookingSelection> = {};
    for (const m of members) {
      initial[m.email] = {
        selected: false,
        planSlug: "2_days",
        selectedDate: "2026-10-28",
        extraDays: "none",
      };
    }
    return initial;
  });

  // Keep selections map synchronized whenever the verified members roster prop updates:
  // Preserves existing user selections when members roster refreshes asynchronously,
  // while automatically deselecting any member who becomes confirmed paid in the interim.
  useEffect(() => {
    setSelections((prev) => {
      let changed = false;
      const updated = { ...prev };
      for (const m of members) {
        const isPaid = m.accommodations?.some((a) => a.status === "paid");
        if (!updated[m.email]) {
          updated[m.email] = {
            selected: false,
            planSlug: "2_days",
            selectedDate: "2026-10-28",
            extraDays: "none",
          };
          changed = true;
        } else if (isPaid && updated[m.email].selected) {
          updated[m.email] = {
            ...updated[m.email],
            selected: false,
          };
          changed = true;
        }
      }
      return changed ? updated : prev;
    });
  }, [members]);

  // Bulk selection handlers
  const handleSelectAll = () => {
    setSelections((prev) => {
      const updated = { ...prev };
      for (const m of members) {
        // Only skip if already has a confirmed paid stay
        const isPaid = m.accommodations?.some((a) => a.status === "paid");
        if (!isPaid) {
          updated[m.email] = {
            ...(updated[m.email] || {
              planSlug: "2_days",
              selectedDate: "2026-10-28",
              extraDays: "none",
            }),
            selected: true,
          };
        }
      }
      return updated;
    });
    setErrorMessage("");
  };

  const handleDeselectAll = () => {
    setSelections((prev) => {
      const updated = { ...prev };
      for (const m of members) {
        if (updated[m.email]) {
          updated[m.email] = {
            ...updated[m.email],
            selected: false,
          };
        }
      }
      return updated;
    });
    setErrorMessage("");
  };

  const handleApplyBulkPlan = (bulkPlanSlug: string) => {
    setSelections((prev) => {
      const updated = { ...prev };
      for (const m of members) {
        if (updated[m.email]?.selected) {
          updated[m.email] = {
            ...updated[m.email],
            planSlug: bulkPlanSlug,
            extraDays: "none",
            selectedDate: bulkPlanSlug === "4_days" ? "2026-10-27" : "2026-10-28",
          };
        }
      }
      return updated;
    });
  };

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // Update selection helper
  const updateMemberSelection = (email: string, patch: Partial<MemberBookingSelection>) => {
    setSelections((prev) => ({
      ...prev,
      [email]: {
        ...(prev[email] || {
          selected: false,
          planSlug: "1_day",
          selectedDate: "2026-10-28",
          extraDays: "none",
        }),
        ...patch,
      },
    }));
    setErrorMessage("");
  };

  // Calculate costs, stay dates, and check conflicts for every member
  const calculatedItems = useMemo(() => {
    const items: Array<{
      member: TeamMemberForModal;
      selection: MemberBookingSelection;
      startDate: string;
      endDate: string;
      durationDays: number;
      price: number;
      conflictMessage: string | null;
      pendingHoldNotice: string | null;
    }> = [];

    for (const m of members) {
      const sel = selections[m.email] || {
        selected: false,
        planSlug: "1_day",
        selectedDate: "2026-10-28",
        extraDays: "none",
      };

      if (!sel.selected) continue;

      let effectiveSlug = sel.planSlug;
      let effectiveDate = sel.selectedDate || "2026-10-28";

      if (sel.planSlug === "2_days") {
        if (sel.extraDays === "before_27") {
          effectiveSlug = "3_days";
          effectiveDate = "2026-10-27";
        } else if (sel.extraDays === "after_30") {
          effectiveSlug = "3_days";
          effectiveDate = "2026-10-28";
        } else if (sel.extraDays === "both") {
          effectiveSlug = "4_days";
          effectiveDate = "2026-10-27";
        } else {
          effectiveDate = sel.selectedDate === "2026-10-30" ? "2026-10-30" : "2026-10-28";
        }
      } else if (sel.planSlug === "3_days") {
        if (sel.selectedDate === "2026-10-29") {
          effectiveDate = "2026-10-29";
        } else if (sel.extraDays === "before_27" || sel.selectedDate === "2026-10-27") {
          effectiveDate = "2026-10-27";
        } else {
          effectiveDate = "2026-10-28";
        }
      } else if (sel.planSlug === "4_days") {
        if (sel.selectedDate === "2026-10-28") {
          effectiveDate = "2026-10-28";
        } else {
          effectiveDate = "2026-10-27";
        }
      }

      const { startDate, endDate, durationDays } = calculateStayDates(
        effectiveSlug,
        effectiveDate,
        sel.extraDays
      );

      // Determine price
      let price = 499;
      if (effectiveSlug === "2_days") price = 999;
      else if (effectiveSlug === "3_days") price = 1498;
      else if (effectiveSlug === "4_days") price = 1997;

      // Check conflict with member's existing stays
      let conflictMessage: string | null = null;
      let pendingHoldNotice: string | null = null;
      if (m.accommodations && m.accommodations.length > 0) {
        for (const existing of m.accommodations) {
          if (startDate < existing.endDate && endDate > existing.startDate) {
            if (existing.status === "paid") {
              // Confirmed paid stays are hard immutable conflicts
              conflictMessage = `Already has confirmed paid stay (${existing.startDate} to ${existing.endDate})`;
              break;
            } else if (existing.status === "pending" || existing.status === "unpaid") {
              // Uncompleted pending holds are superseded by the new combined order; do NOT block selection!
              pendingHoldNotice = `Has uncompleted pending stay (₹${existing.amount}) — will be covered by this combined order`;
            }
          }
        }
      }

      items.push({
        member: m,
        selection: sel,
        startDate,
        endDate,
        durationDays,
        price,
        conflictMessage,
        pendingHoldNotice,
      });
    }

    return items;
  }, [members, selections]);

  const totalCombinedAmount = useMemo(() => {
    return calculatedItems.reduce((sum, item) => sum + item.price, 0);
  }, [calculatedItems]);

  const hasAnyConflict = useMemo(() => {
    return calculatedItems.some((item) => item.conflictMessage !== null);
  }, [calculatedItems]);

  const handleSubmit = async () => {
    if (calculatedItems.length === 0) {
      setErrorMessage("Please select at least one team member for accommodation.");
      return;
    }

    if (hasAnyConflict) {
      setErrorMessage("Please resolve date conflicts before proceeding to payment.");
      return;
    }

    setLoading(true);
    setErrorMessage("");

    try {
      const payloadBookings = calculatedItems.map((item) => ({
        email: item.member.email,
        planSlug: item.selection.planSlug,
        selectedDate: item.startDate,
        extraDays: item.selection.extraDays,
      }));

      const res = await fetch("/api/team/accommodation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          participantEventId,
          bookings: payloadBookings,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to create team accommodation order.");
      }

      // Close modal and launch payment gateway for the combined payment order
      onClose();
      await onProceedToPayment(data.paymentOrderId, data.participantId);
    } catch (err: any) {
      console.error("Team accommodation booking error:", err);
      setErrorMessage(err.message || "Failed to initiate combined team accommodation payment.");
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
          aria-labelledby="team-accommodation-title"
          data-lenis-prevent="true"
        >
          {/* Backdrop */}
          <div
            onClick={onClose}
            className="fixed inset-0 bg-black/85 backdrop-blur-md cursor-pointer"
            aria-hidden="true"
          />

          {/* Modal Window */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="relative flex flex-col w-full max-w-3xl max-h-[min(90vh,calc(100dvh-2rem))] overflow-hidden rounded-3xl border border-violet-500/30 bg-gradient-to-b from-zinc-950 via-zinc-900 to-black text-white shadow-2xl backdrop-blur-xl"
            data-lenis-prevent="true"
          >
            {/* Header (Pinned) */}
            <div className="shrink-0 flex items-start justify-between gap-4 border-b border-white/10 p-5 sm:p-6 md:px-8 bg-zinc-950/70 backdrop-blur-md">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-400 text-black shadow-[0_0_10px_#a855f7]">
                    <Bed size={12} />
                  </span>
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">
                    Team Leader Portal
                  </span>
                </div>
                <h2 id="team-accommodation-title" className="mt-2 text-xl sm:text-2xl font-bold tracking-tight text-white">
                  Manage Team Accommodation
                </h2>
                <p className="mt-1 text-xs text-white/60">
                  Arrange accommodation for verified members of team &quot;{teamName}&quot; ({eventName}).
                  One combined payment covers all selected delegates.
                </p>
              </div>

              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                className="rounded-xl border border-white/10 bg-white/5 p-2 text-white/60 hover:bg-white/10 hover:text-white transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-violet-400"
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

          {/* Error Banner */}
          {errorMessage && (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-950/30 p-3.5 text-xs text-red-300">
              <AlertCircle size={16} className="shrink-0 text-red-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Members List */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-white/10 pb-3">
              <div>
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  Eligible Verified Members ({members.length})
                </span>
                <p className="text-[11px] text-white/50 mt-0.5">
                  Select delegates needing campus stay
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[11px] font-mono font-medium text-violet-300 hover:bg-violet-500/20 transition-all cursor-pointer"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={handleDeselectAll}
                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-mono text-white/60 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
                >
                  Deselect All
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {members.map((m) => {
                const sel = selections[m.email] || {
                  selected: false,
                  planSlug: "1_day",
                  selectedDate: "2026-10-28",
                  extraDays: "none",
                };

                const calc = calculatedItems.find((c) => c.member.email === m.email);

                return (
                  <div
                    key={m.id}
                    className={`rounded-2xl border transition-all p-4 ${
                      sel.selected
                        ? calc?.conflictMessage
                          ? "border-red-500/40 bg-red-950/20"
                          : "border-violet-500/40 bg-violet-950/25"
                        : "border-white/10 bg-white/[0.02]"
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      {/* Member Info & Selection Toggle */}
                      <label className="flex items-start gap-3 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={sel.selected}
                          onChange={(e) =>
                            updateMemberSelection(m.email, { selected: e.target.checked })
                          }
                          className="mt-1 h-4 w-4 rounded border-white/20 bg-white/5 text-violet-600 focus:ring-violet-500"
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-white">{m.name}</span>
                            <span
                              className={`rounded-full px-2 py-0.2 text-[8px] font-mono font-bold uppercase tracking-wider border ${
                                m.isTeamLeader
                                  ? "bg-amber-500/20 border-amber-500/30 text-amber-300"
                                  : "bg-white/10 border-white/20 text-white/60"
                              }`}
                            >
                              {m.isTeamLeader ? "Leader" : "Member"}
                            </span>
                          </div>
                          <p className="font-mono text-xs text-white/50 mt-0.5">
                            {m.participantId ? `${m.participantId} • ` : ""}
                            {m.email}
                          </p>

                          {/* Existing Stays Display */}
                          {m.accommodations && m.accommodations.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <span className="text-[10px] text-white/40">Existing stay:</span>
                              {m.accommodations.map((a) => (
                                <span
                                  key={a.id}
                                  className="font-mono text-[9px] rounded border border-emerald-500/30 bg-emerald-950/30 px-1.5 py-0.5 text-emerald-300"
                                >
                                  {a.startDate} to {a.endDate} ({a.status})
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </label>

                      {/* Cost pill if selected */}
                      {sel.selected && calc && (
                        <div className="text-right shrink-0">
                          <span className="font-mono text-sm font-bold text-emerald-400">
                            ₹{calc.price}
                          </span>
                          <p className="font-mono text-[10px] text-white/40">
                            {calc.durationDays} Day{calc.durationDays > 1 ? "s" : ""}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Plan & Date Selectors when checked */}
                    {sel.selected && (
                      <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {/* Plan Selection */}
                          <div>
                            <label className="block font-mono text-[10px] font-semibold uppercase tracking-wider text-white/50 mb-1">
                              Accommodation Plan
                            </label>
                            <select
                              value={sel.planSlug}
                              onChange={(e) => {
                                const newPlan = e.target.value;
                                updateMemberSelection(m.email, {
                                  planSlug: newPlan,
                                  extraDays: "none",
                                  selectedDate: newPlan === "4_days" ? "2026-10-27" : "2026-10-28",
                                });
                              }}
                              className="w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-xs text-white outline-none focus:border-violet-400 font-mono"
                            >
                              <option value="1_day">1 Day Pass — ₹499</option>
                              <option value="2_days">2 Days Pass — ₹999</option>
                              <option value="3_days">3 Days Pass — ₹1,498</option>
                              <option value="4_days">4 Days Full Festival — ₹1,997</option>
                            </select>
                          </div>

                          {/* Date Selection */}
                          <div>
                            <label className="block font-mono text-[10px] font-semibold uppercase tracking-wider text-white/50 mb-1">
                              Stay Date / Option
                            </label>
                            {sel.planSlug === "1_day" && (
                              <select
                                value={sel.selectedDate}
                                onChange={(e) =>
                                  updateMemberSelection(m.email, { selectedDate: e.target.value })
                                }
                                className="w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-xs text-white outline-none focus:border-violet-400 font-mono"
                              >
                                <option value="2026-10-27">27 Oct (Day Before)</option>
                                <option value="2026-10-28">28 Oct (Day 1)</option>
                                <option value="2026-10-29">29 Oct (Day 2)</option>
                                <option value="2026-10-30">30 Oct (Day After)</option>
                                <option value="2026-10-31">31 Oct (Day 4 • Checkout 1 Nov)</option>
                              </select>
                            )}

                            {sel.planSlug === "2_days" && (
                              <select
                                value={sel.selectedDate === "2026-10-30" ? "2026-10-30" : "2026-10-28"}
                                onChange={(e) =>
                                  updateMemberSelection(m.email, {
                                    selectedDate: e.target.value,
                                    extraDays: "none",
                                  })
                                }
                                className="w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-xs text-white outline-none focus:border-violet-400 font-mono"
                              >
                                <option value="2026-10-28">28–29 Oct (Standard 2 Days • Checkout 30 Oct) — ₹999</option>
                                <option value="2026-10-30">30–31 Oct (Weekend Extended • Checkout 1 Nov) — ₹999</option>
                              </select>
                            )}

                            {sel.planSlug === "3_days" && (
                              <select
                                value={sel.selectedDate === "2026-10-29" ? "2026-10-29" : sel.selectedDate === "2026-10-27" ? "2026-10-27" : "2026-10-28"}
                                onChange={(e) => {
                                  const dt = e.target.value;
                                  updateMemberSelection(m.email, {
                                    selectedDate: dt,
                                    extraDays: dt === "2026-10-27" ? "before_27" : dt === "2026-10-28" ? "after_30" : "none",
                                  });
                                }}
                                className="w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-xs text-white outline-none focus:border-violet-400 font-mono"
                              >
                                <option value="2026-10-27">27–29 Oct (Early Arrival • Checkout 30 Oct) — ₹1,498</option>
                                <option value="2026-10-28">28–30 Oct (Fest + Day After • Checkout 31 Oct) — ₹1,498</option>
                                <option value="2026-10-29">29–31 Oct (Extended Stay • Checkout 1 Nov) — ₹1,498</option>
                              </select>
                            )}

                            {sel.planSlug === "4_days" && (
                              <select
                                value={sel.selectedDate === "2026-10-28" ? "2026-10-28" : "2026-10-27"}
                                onChange={(e) => {
                                  const dt = e.target.value;
                                  updateMemberSelection(m.email, {
                                    selectedDate: dt,
                                    extraDays: dt === "2026-10-27" ? "both" : "none",
                                  });
                                }}
                                className="w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-xs text-white outline-none focus:border-violet-400 font-mono"
                              >
                                <option value="2026-10-27">27–30 Oct (Full Fest Stay • Checkout 31 Oct) — ₹1,997</option>
                                <option value="2026-10-28">28–31 Oct (Extended Full Stay • Checkout 1 Nov) — ₹1,997</option>
                              </select>
                            )}
                          </div>
                        </div>

                        {/* Calculated stay range */}
                        {calc && (
                          <div className="flex items-center justify-between text-xs text-white/60 font-mono">
                            <span>
                              Stay: {calc.startDate} to {calc.endDate} ({calc.durationDays} Day
                              {calc.durationDays > 1 ? "s" : ""})
                            </span>
                          </div>
                        )}

                        {/* Conflict warning (confirmed paid stay) */}
                        {calc?.conflictMessage && (
                          <div className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-950/40 p-2 text-xs text-red-200">
                            <AlertCircle size={14} className="shrink-0 text-red-400" />
                            <span>
                              {calc.conflictMessage}. Please choose different dates for this member.
                            </span>
                          </div>
                        )}

                        {/* Pending hold notice (uncompleted attempt that will be replaced) */}
                        {!calc?.conflictMessage && calc?.pendingHoldNotice && (
                          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-950/20 p-2 text-xs text-amber-300 font-mono">
                            <ShieldCheck size={14} className="shrink-0 text-amber-400" />
                            <span>{calc.pendingHoldNotice}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Summary & Combined Payment Action */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-mono text-xs font-semibold uppercase tracking-wider text-white/50">
                  Combined Total
                </span>
                <p className="text-xl font-bold font-mono text-white mt-0.5">
                  ₹{totalCombinedAmount.toLocaleString()}
                </p>
                <p className="text-xs text-white/50 mt-0.5">
                  {calculatedItems.length} delegate{calculatedItems.length === 1 ? "" : "s"} selected
                </p>
              </div>
            </div>
            {/* End of Members List and Scrollable Content */}
          </div>
          {/* End of Scrollable Body */}
          </div>

          {/* Summary & Combined Payment Action (Pinned Footer) */}
          <div className="shrink-0 border-t border-white/10 p-4 sm:p-5 md:px-8 bg-zinc-950/70 backdrop-blur-md">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-mono text-xs font-semibold uppercase tracking-wider text-white/50">
                  Combined Total
                </span>
                <p className="text-xl font-bold font-mono text-white mt-0.5">
                  ₹{totalCombinedAmount.toLocaleString()}
                </p>
                <p className="text-xs text-white/50 mt-0.5">
                  {calculatedItems.length} delegate{calculatedItems.length === 1 ? "" : "s"} selected
                </p>
              </div>

              <button
                type="button"
                disabled={loading || calculatedItems.length === 0 || hasAnyConflict}
                onClick={handleSubmit}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 to-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_0_25px_rgba(168,85,247,0.35)] transition-all hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer focus:outline-none focus:ring-2 focus:ring-violet-400"
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    <span>Preparing Payment...</span>
                  </>
                ) : (
                  <>
                    <span>Pay Combined Amount (₹{totalCombinedAmount})</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>,
  document.body
);
}
