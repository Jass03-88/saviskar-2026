"use client";

import { useEffect, useState } from "react";
import {
  X,
  Mail,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  FileText,
  Receipt,
  BellRing,
  Send,
  Building2,
  Calendar,
  Layers,
  ChevronRight,
  ShieldAlert,
} from "lucide-react";
import {
  EmailTemplateType,
  ResendPreviewResult,
  ResendSendResult,
} from "@/lib/admin/email-resend";
import { useBodyScrollLock } from "@/lib/admin/useBodyScrollLock";

interface ResendEmailDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedParticipantIds: string[];
}

export function ResendEmailDialog({
  isOpen,
  onClose,
  selectedParticipantIds,
}: ResendEmailDialogProps) {
  const [templateType, setTemplateType] = useState<EmailTemplateType>("registration_summary");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [previewData, setPreviewData] = useState<ResendPreviewResult | null>(null);
  const [sendResult, setSendResult] = useState<ResendSendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);

  // Background body scroll lock with cleanup on close/unmount
  useBodyScrollLock(isOpen);

  // Load preview when dialog opens or template changes
  useEffect(() => {
    if (!isOpen || selectedParticipantIds.length === 0) {
      setPreviewData(null);
      setSendResult(null);
      setError(null);
      setConfirmSendOpen(false);
      return;
    }

    let isMounted = true;
    async function loadPreview() {
      setLoadingPreview(true);
      setError(null);
      setSendResult(null);
      setConfirmSendOpen(false);

      try {
        const res = await fetch("/api/admin/registrations/resend-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "preview",
            participantIds: selectedParticipantIds,
            templateType,
          }),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || `Failed to load email preview (HTTP ${res.status})`);
        }

        const json = await res.json();
        if (isMounted) {
          setPreviewData(json);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to load email preview.");
        }
      } finally {
        if (isMounted) {
          setLoadingPreview(false);
        }
      }
    }

    loadPreview();
    return () => {
      isMounted = false;
    };
  }, [isOpen, selectedParticipantIds, templateType]);

  // Handle ESC key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen && !sending) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, sending]);

  const handleSendEmails = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/registrations/resend-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          participantIds: selectedParticipantIds,
          templateType,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Email dispatch failed (HTTP ${res.status})`);
      }

      const json = await res.json();
      setSendResult(json);
      setConfirmSendOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send emails.");
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="resend-email-title"
      data-lenis-prevent="true"
      data-lenis-prevent-wheel="true"
      className="fixed inset-0 z-[999999] flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      style={{ overscrollBehavior: "contain" }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !sending) onClose();
      }}
    >
      <div
        data-lenis-prevent="true"
        data-lenis-prevent-wheel="true"
        className="relative w-full max-w-4xl h-[min(90vh,calc(100dvh-2rem))] flex flex-col rounded-3xl bg-white shadow-2xl border border-black/10 overflow-hidden"
        style={{ overscrollBehavior: "contain" }}
      >
        {/* HEADER */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.08] bg-black/[0.02] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600/10 border border-blue-600/20 flex items-center justify-center text-blue-600 shrink-0">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="resend-email-title"
                className="text-base sm:text-lg font-bold tracking-tight text-black"
              >
                Resend Registration & Payment Emails
              </h2>
              <p className="text-xs text-black/50">
                Preview-first email generation with authoritative financial gating
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="w-9 h-9 rounded-full bg-black/5 flex items-center justify-center text-black/50 hover:bg-black/10 hover:text-black transition disabled:opacity-30"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* TEMPLATE TYPE SELECTOR */}
        <div className="px-6 py-3 border-b border-black/[0.06] bg-black/[0.01] flex flex-wrap gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setTemplateType("registration_summary")}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
              templateType === "registration_summary"
                ? "bg-black text-white shadow-sm"
                : "bg-black/5 text-black/70 hover:bg-black/10"
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Registration Summary</span>
          </button>

          <button
            type="button"
            onClick={() => setTemplateType("payment_receipt")}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
              templateType === "payment_receipt"
                ? "bg-black text-white shadow-sm"
                : "bg-black/5 text-black/70 hover:bg-black/10"
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>Payment Receipt (Paid Only)</span>
          </button>

          <button
            type="button"
            onClick={() => setTemplateType("payment_status_update")}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
              templateType === "payment_status_update"
                ? "bg-black text-white shadow-sm"
                : "bg-black/5 text-black/70 hover:bg-black/10"
            }`}
          >
            <BellRing className="w-3.5 h-3.5" />
            <span>Payment Status Update</span>
          </button>
        </div>

        {/* BODY */}
        <div
          data-lenis-prevent="true"
          data-lenis-prevent-wheel="true"
          className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6"
          style={{ overscrollBehavior: "contain" }}
        >
          {loadingPreview && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <RefreshCw className="w-7 h-7 text-blue-600 animate-spin mb-3" />
              <p className="text-sm font-semibold text-black">
                Generating email previews for {selectedParticipantIds.length} recipient(s)...
              </p>
              <p className="text-xs text-black/40 mt-1 max-w-sm">
                Calculating event fees, accommodation statuses, and payment invariants.
              </p>
            </div>
          )}

          {error && !loadingPreview && (
            <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-800 text-xs">
              <div className="flex items-center gap-2 font-bold mb-1">
                <AlertCircle className="w-4 h-4" />
                <span>Operation Error</span>
              </div>
              <p>{error}</p>
            </div>
          )}

          {/* DISPATCH RESULTS VIEW */}
          {sendResult && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div
                className={`p-4 rounded-2xl border ${
                  sendResult.success
                    ? "bg-emerald-50/80 border-emerald-200 text-emerald-900"
                    : "bg-amber-50/80 border-amber-200 text-amber-900"
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-sm">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>
                    Email Dispatch Processed: {sendResult.sentCount} Dispatched,{" "}
                    {sendResult.skippedCount} Skipped, {sendResult.failedCount} Failed
                  </span>
                </div>
                {sendResult.isLocalSimulation && (
                  <p className="text-xs text-emerald-800/80 mt-1">
                    <strong>Local Simulation Mode:</strong> Messages were safely validated and simulated
                    locally. No real network emails were dispatched to avoid accidental spam during testing.
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-black/[0.08] bg-white overflow-hidden">
                <div className="px-4 py-3 bg-black/[0.02] border-b border-black/[0.06] text-xs font-bold uppercase tracking-wider text-black/60">
                  Per-Recipient Outcomes
                </div>
                <div className="divide-y divide-black/[0.06]">
                  {sendResult.results.map((r, i) => (
                    <div
                      key={r.participantId || i}
                      className="p-3.5 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-black">{r.email}</span>
                        <span className="text-black/40 text-[10px]">({r.message})</span>
                      </div>
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                          r.status === "sent" || r.status === "simulated"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : r.status === "skipped"
                            ? "bg-zinc-100 text-zinc-700 border-zinc-200"
                            : "bg-rose-50 text-rose-700 border-rose-200"
                        }`}
                      >
                        {r.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* PREVIEW CONTENT */}
          {previewData && !loadingPreview && !sendResult && (
            <div className="space-y-5">
              {/* STATUS & ELIGIBILITY BAR */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-black/[0.02] border border-black/[0.06]">
                <div className="flex items-center gap-4 text-xs">
                  <div>
                    <span className="text-black/40 uppercase text-[9px] font-bold block">
                      Recipients
                    </span>
                    <span className="font-bold text-black text-sm">
                      {previewData.totalRecipients}
                    </span>
                  </div>
                  <div>
                    <span className="text-emerald-700/60 uppercase text-[9px] font-bold block">
                      Eligible
                    </span>
                    <span className="font-bold text-emerald-800 text-sm">
                      {previewData.eligibleRecipients}
                    </span>
                  </div>
                  {previewData.ineligibleRecipients > 0 && (
                    <div>
                      <span className="text-rose-700/60 uppercase text-[9px] font-bold block">
                        Blocked / Ineligible
                      </span>
                      <span className="font-bold text-rose-800 text-sm">
                        {previewData.ineligibleRecipients}
                      </span>
                    </div>
                  )}
                </div>

                <div className="text-right">
                  <span className="text-[10px] text-black/50 block font-medium">
                    Strict Financial Invariant:
                  </span>
                  <span className="text-[11px] font-semibold text-black/80">
                    {templateType === "payment_receipt"
                      ? "Requires Verified Settlement"
                      : "Accurately reports events & stay fees"}
                  </span>
                </div>
              </div>

              {/* RECIPIENT PREVIEW CARDS */}
              <div className="space-y-4">
                {previewData.recipients.map((rec) => (
                  <div
                    key={rec.participantId}
                    className={`rounded-2xl border p-5 transition ${
                      rec.eligible
                        ? "bg-white border-black/[0.08] shadow-sm"
                        : "bg-rose-50/20 border-rose-200"
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-black/[0.06] pb-3 mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-black text-sm">{rec.name}</span>
                          <span className="font-mono text-xs text-black/40">
                            {rec.publicParticipantId}
                          </span>
                        </div>
                        <span className="text-xs text-blue-600 font-mono">{rec.email}</span>
                      </div>

                      <div className="text-right">
                        {rec.eligible ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>Eligible for Send</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-800 border border-rose-200">
                            <ShieldAlert className="w-3 h-3 text-rose-600" />
                            <span>Sending Blocked</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* EMAIL SUBJECT & BANNER PREVIEW */}
                    <div className="space-y-2 mb-3.5 bg-black/[0.02] p-3 rounded-xl border border-black/[0.04] text-xs">
                      <div>
                        <span className="text-black/40 text-[10px] uppercase font-bold block">
                          Preview Subject Line:
                        </span>
                        <span className="font-semibold text-black">{rec.previewSubject}</span>
                      </div>
                      <div>
                        <span className="text-black/40 text-[10px] uppercase font-bold block">
                          Status Banner in Email Body:
                        </span>
                        <span
                          className={`font-semibold inline-block mt-0.5 px-2.5 py-1 rounded-md text-xs ${
                            rec.previewBannerStyle === "success"
                              ? "bg-emerald-100/70 text-emerald-900 border border-emerald-200"
                              : rec.previewBannerStyle === "partial"
                              ? "bg-amber-100/70 text-amber-900 border border-amber-200"
                              : rec.previewBannerStyle === "pending"
                              ? "bg-rose-100/70 text-rose-900 border border-rose-200"
                              : "bg-zinc-100 text-zinc-900 border border-zinc-200"
                          }`}
                        >
                          {rec.previewBannerText}
                        </span>
                      </div>
                    </div>

                    {/* INELIGIBILITY EXPLANATION */}
                    {!rec.eligible && rec.ineligibilityReason && (
                      <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900 mb-3">
                        <strong className="block mb-0.5">Policy Restriction:</strong>
                        {rec.ineligibilityReason}
                      </div>
                    )}

                    {/* ITEMIZED FACTUAL BREAKDOWN */}
                    <div className="space-y-1.5 text-xs">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-black/40 block">
                        Registered Events & Accommodations Included
                      </span>
                      {rec.events.map((e, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2 rounded-lg bg-black/[0.02]"
                        >
                          <span className="text-black/80 font-medium">
                            {e.name}{" "}
                            {e.paymentType === "free" && (
                              <span className="text-[10px] text-black/40 font-normal">
                                (Free Event)
                              </span>
                            )}
                          </span>
                          <span className="font-mono text-[11px] text-black/60">
                            {e.status} {e.fee > 0 && `(₹${e.fee})`}
                          </span>
                        </div>
                      ))}

                      {rec.accommodations.map((a, idx) => (
                        <div
                          key={`acc-${idx}`}
                          className="flex items-center justify-between p-2 rounded-lg bg-purple-50/50 border border-purple-100"
                        >
                          <div className="flex items-center gap-1.5 text-purple-950 font-medium">
                            <Building2 className="w-3 h-3 text-purple-600" />
                            <span>
                              {a.planName} ({a.dates})
                            </span>
                          </div>
                          <span className="font-mono text-[11px] text-purple-900 font-semibold">
                            Stay: {a.status} (₹{a.amount})
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="px-6 py-4 border-t border-black/[0.08] bg-black/[0.02] flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-black/60 hover:text-black transition"
          >
            {sendResult ? "Done" : "Cancel"}
          </button>

          {!sendResult && previewData && previewData.eligibleRecipients > 0 && (
            <div className="flex items-center gap-3">
              {confirmSendOpen ? (
                <div className="flex items-center gap-2 animate-in fade-in">
                  <span className="text-xs text-black/60 font-medium">
                    Confirm dispatch to {previewData.eligibleRecipients} recipient(s)?
                  </span>
                  <button
                    type="button"
                    onClick={handleSendEmails}
                    disabled={sending}
                    className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 transition shadow-sm inline-flex items-center gap-1.5 disabled:opacity-40"
                  >
                    {sending ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    <span>Yes, Resend Now</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmSendOpen(false)}
                    disabled={sending}
                    className="px-3 py-2 rounded-xl bg-black/5 text-xs text-black/60 hover:bg-black/10 transition"
                  >
                    Back
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmSendOpen(true)}
                  disabled={sending}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 transition shadow-sm inline-flex items-center gap-2"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Proceed to Send ({previewData.eligibleRecipients})</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
