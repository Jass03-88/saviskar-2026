"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useModalScrollLock } from "./useModalScrollLock";
import {
  X,
  Bed,
  Users,
  ShieldCheck,
  CreditCard,
  Plus,
  Calendar,
  Building2,
  CheckCircle2,
  Clock,
  AlertCircle,
  ArrowRight,
  ExternalLink,
} from "lucide-react";

export interface DetailPanelEvent {
  participantEventId: string;
  eventId: string;
  eventName: string;
  category: string | null;
  registrationType: string;
  teamName: string | null;
  isTeamLeader: boolean;
  paymentStatus: string | null;
  paymentAmount: number | null;
  registrationStatus: string | null;
  checkedIn: boolean;
  teamMembers?: Array<{
    id: string;
    name: string;
    email: string;
    phone: string;
    isTeamLeader: boolean;
    participantId: string | null;
    college: string | null;
    accommodations: Array<{
      id: string;
      planName: string;
      planSlug: string;
      startDate: string;
      endDate: string;
      durationDays: number;
      amount: number;
      status: string;
    }>;
  }>;
}

export interface DetailPanelAccommodation {
  id: string;
  planName: string;
  planSlug: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  amount: number;
  currency?: string;
  status: string;
  allocationStatus?: string;
  hostelName?: string | null;
  roomNumber?: string | null;
  checkedIn?: boolean;
  checkedInAt?: string | null;
  checkedOut?: boolean;
  checkedOutAt?: string | null;
}

export interface RegistrationDetailPanelProps {
  participant: {
    participantId: string;
    name: string;
    college: string | null;
    email: string;
    phone?: string | null;
    gender?: string | null;
    state?: string | null;
  };
  event: DetailPanelEvent;
  allEvents: DetailPanelEvent[];
  accommodations: DetailPanelAccommodation[];
  isOpen: boolean;
  onClose: () => void;
  onOpenAddAccommodation: () => void;
  onOpenTeamAccommodation: () => void;
  onPaymentRecovery?: (event: DetailPanelEvent) => void;
}

export default function RegistrationDetailPanel({
  participant,
  event,
  allEvents,
  accommodations,
  isOpen,
  onClose,
  onOpenAddAccommodation,
  onOpenTeamAccommodation,
  onPaymentRecovery,
}: RegistrationDetailPanelProps) {
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

  const isTeam = event.registrationType === "team" || Boolean(event.teamName);
  const isLeader = event.isTeamLeader;
  const isPaid = event.paymentStatus?.toLowerCase() === "paid";
  const isPending = event.paymentStatus?.toLowerCase() === "pending";
  const isCancelled = event.registrationStatus?.toLowerCase() === "cancelled";
  const teamMembers = event.teamMembers ?? [];

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
          aria-labelledby="detail-panel-title"
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
            className="relative flex flex-col w-full max-w-3xl max-h-[min(90vh,calc(100dvh-2rem))] overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-b from-zinc-950 via-zinc-900 to-black text-white shadow-2xl backdrop-blur-xl"
            data-lenis-prevent="true"
          >
            {/* Header (Pinned) */}
            <div className="shrink-0 flex items-start justify-between gap-4 border-b border-white/10 p-5 sm:p-6 md:px-8 bg-zinc-950/70 backdrop-blur-md">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400 text-black shadow-[0_0_10px_#34d399]">
                    <ShieldCheck size={12} />
                  </span>
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">
                    Verified Registration Dossier
                  </span>
                </div>
                <h2
                  id="detail-panel-title"
                  className="mt-2 text-xl sm:text-2xl font-bold tracking-tight text-white"
                >
                  {event.eventName}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/60">
                  {event.category && (
                    <span className="font-mono text-violet-300 font-medium">
                      {event.category}
                    </span>
                  )}
                  <span>•</span>
                  <span className="font-mono">
                    {isTeam ? `Team Entry: "${event.teamName || "Team"}"` : "Solo Entry"}
                  </span>
                  <span>•</span>
                  <span className="font-mono font-semibold text-emerald-400">
                    {event.paymentAmount && event.paymentAmount > 0
                      ? `₹${event.paymentAmount}`
                      : "Free"}
                  </span>
                </div>
              </div>

              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                className="rounded-xl border border-white/10 bg-white/5 p-2 text-white/60 hover:bg-white/10 hover:text-white transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-violet-400"
                aria-label="Close details"
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

          {/* SECTION 1: PARTICIPANT PERSONAL PROFILE */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-white/40">
                Participant Identity & Profile
              </span>
              <span className="font-mono text-xs font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2.5 py-0.5 rounded-lg">
                {participant.participantId}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-white/40">Full Name</p>
                <p className="font-medium text-white text-sm">{participant.name}</p>
              </div>
              <div>
                <p className="text-white/40">Institution / College</p>
                <p className="font-medium text-white text-sm">{participant.college || "—"}</p>
              </div>
              <div>
                <p className="text-white/40">Official Email</p>
                <p className="font-mono text-white/90">{participant.email}</p>
              </div>
              <div>
                <p className="text-white/40">Phone Number</p>
                <p className="font-mono text-white/90">{participant.phone || "—"}</p>
              </div>
              {participant.gender && (
                <div>
                  <p className="text-white/40">Gender</p>
                  <p className="capitalize text-white/90">{participant.gender}</p>
                </div>
              )}
              {participant.state && (
                <div>
                  <p className="text-white/40">State</p>
                  <p className="text-white/90">{participant.state}</p>
                </div>
              )}
            </div>
          </div>

          {/* SECTION 2: COMPETITION & PAYMENT STATUS */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5 space-y-3">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-white/40">
              Competition Status & Payment Ledger
            </span>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-wider border ${
                    isCancelled
                      ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
                      : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  }`}
                >
                  Registration: {event.registrationStatus || "CONFIRMED"}
                </span>

                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-wider border ${
                    isPaid
                      ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-300"
                      : isPending
                      ? "bg-amber-500/20 border-amber-500/30 text-amber-300"
                      : "bg-cyan-500/20 border-cyan-500/30 text-cyan-300"
                  }`}
                >
                  Payment: {isPaid ? "PAID" : isPending ? "PENDING" : "FREE / NOT REQUIRED"}
                </span>
              </div>

              {isPending && onPaymentRecovery && (event.paymentAmount || 0) > 0 && (
                <button
                  type="button"
                  onClick={() => onPaymentRecovery(event)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-1.5 text-xs font-semibold text-black transition-all hover:bg-amber-100 shadow-[0_0_15px_rgba(251,191,36,0.2)] cursor-pointer"
                >
                  <span>Pay Now (₹{event.paymentAmount})</span>
                  <ArrowRight size={13} />
                </button>
              )}
            </div>
          </div>

          {/* SECTION 3: TEAM MEMBERS (FOR TEAM EVENTS) */}
          {isTeam && (
            <div className="rounded-2xl border border-violet-500/20 bg-violet-950/15 p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users size={16} className="text-violet-400" />
                  <span className="font-mono text-xs font-semibold uppercase tracking-wider text-violet-300">
                    Verified Team Roster ({teamMembers.length || 1})
                  </span>
                </div>

                {isLeader && (
                  <button
                    type="button"
                    onClick={onOpenTeamAccommodation}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-violet-500/40 bg-violet-600/30 px-3 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-600/50 hover:text-white transition-all cursor-pointer shadow-[0_0_15px_rgba(168,85,247,0.2)]"
                  >
                    <Bed size={13} />
                    <span>Manage Team Accommodation</span>
                  </button>
                )}
              </div>

              <div className="divide-y divide-white/5">
                {teamMembers.length > 0 ? (
                  teamMembers.map((member) => (
                    <div
                      key={member.id}
                      className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm text-white">{member.name}</p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider border ${
                              member.isTeamLeader
                                ? "bg-amber-500/20 border-amber-500/30 text-amber-300"
                                : "bg-white/10 border-white/20 text-white/70"
                            }`}
                          >
                            {member.isTeamLeader ? "Leader" : "Member"}
                          </span>
                        </div>
                        <p className="text-xs text-white/40 mt-0.5 font-mono">
                          {member.participantId ? `ID: ${member.participantId} • ` : ""}
                          {member.email}
                        </p>
                      </div>

                      {/* Member's Existing Stays */}
                      <div className="text-xs">
                        {member.accommodations && member.accommodations.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {member.accommodations.map((a) => (
                              <span
                                key={a.id}
                                className="font-mono text-[10px] rounded-lg border border-emerald-500/30 bg-emerald-950/40 px-2 py-0.5 text-emerald-300"
                              >
                                {a.startDate}–{a.endDate} ({a.status})
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-white/30 text-[11px] italic font-mono">
                            No accommodation booked
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-2 text-xs text-white/50">
                    Leader: {participant.name} (Other team member records sync dynamically)
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION 4: PARTICIPANT'S ACCOMMODATION STAYS */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bed size={16} className="text-emerald-400" />
                <span className="font-mono text-xs font-semibold uppercase tracking-wider text-emerald-300">
                  Your Accommodation Stays ({accommodations.length})
                </span>
              </div>

              <button
                type="button"
                onClick={onOpenAddAccommodation}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-600/30 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-600/50 hover:text-white transition-all cursor-pointer shadow-[0_0_15px_rgba(16,185,129,0.2)]"
              >
                <Plus size={13} />
                <span>Add Accommodation</span>
              </button>
            </div>

            {accommodations.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {accommodations.map((acc, accIdx) => {
                  const isPaidStay = acc.status?.toLowerCase() === "paid";
                  const isAllocated =
                    acc.allocationStatus === "allocated" || Boolean(acc.roomNumber || acc.hostelName);

                  return (
                    <div
                      key={acc.id || accIdx}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-sm text-white">
                            {acc.planName || "Campus Stay"}
                          </p>
                          <p className="font-mono text-xs text-white/60">
                            {acc.startDate} to {acc.endDate} ({acc.durationDays} Day
                            {acc.durationDays > 1 ? "s" : ""})
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider border ${
                            isPaidStay
                              ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-300"
                              : "bg-amber-500/20 border-amber-500/30 text-amber-300"
                          }`}
                        >
                          {isPaidStay ? "PAID" : "PENDING"}
                        </span>
                      </div>

                      <div className="pt-2 border-t border-white/5 flex items-center justify-between text-xs">
                        <span className="font-mono text-emerald-400 font-semibold">
                          ₹{acc.amount || 0}
                        </span>

                        <span
                          className={`font-mono text-[10px] px-2 py-0.5 rounded ${
                            isAllocated
                              ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                              : "bg-white/5 text-white/50 border border-white/10"
                          }`}
                        >
                          {isAllocated
                            ? `${acc.hostelName || "Hostel"} - Room ${acc.roomNumber || "Assigned"}`
                            : "Awaiting Allocation"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-white/5 bg-white/[0.015] p-4 text-center text-xs text-white/40">
                <p>No accommodation booked for your profile.</p>
                <p className="mt-1 text-white/30">
                  Campus stay is optional. Click &quot;Add Accommodation&quot; above to book a stay.
                </p>
              </div>
            )}
          </div>
          {/* End of Section 4 */}

          </div>
          {/* End of Scrollable Body Content */}

          {/* Footer Action (Pinned) */}
          <div className="shrink-0 flex items-center justify-end gap-3 border-t border-white/10 px-5 py-4 sm:px-6 md:px-8 bg-zinc-950/70 backdrop-blur-md">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-violet-400"
            >
              Close
            </button>
          </div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>,
  document.body
);
}
