"use client";

import { useEffect, useState, useMemo } from "react";
import {
  X,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  AlertCircle,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Building2,
  Layers,
  ShieldCheck,
  Info,
  RotateCcw,
  Mail,
} from "lucide-react";
import {
  VerificationResponse,
  OrderVerificationResult,
  ReconciliationOutcome,
  LinkedItemDetail,
  DiagnosticFinding,
  formatIndianTimestamp,
  PaymentAuditScope,
  getReconciliationConfirmationSummary,
} from "@/lib/admin/payment-verification";
import { useBodyScrollLock } from "@/lib/admin/useBodyScrollLock";

interface PaymentVerificationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedParticipantIds: string[];
  initialMode?: "selected" | "audit";
}

export function PaymentVerificationDialog({
  isOpen,
  onClose,
  selectedParticipantIds,
  initialMode,
}: PaymentVerificationDialogProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<VerificationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  // Tab & Proactive Audit State
  const [activeTab, setActiveTab] = useState<"selected" | "audit">("selected");
  const [auditScope, setAuditScope] = useState<PaymentAuditScope | null>(null);
  const [loadingScope, setLoadingScope] = useState(false);
  const [runningAudit, setRunningAudit] = useState(false);

  // Reconciliation & Email Retry State
  const [reconciliationTarget, setReconciliationTarget] = useState<OrderVerificationResult | null>(null);

  // Authoritative Confirmation Summary Derived from Reconciliation Target
  const confirmSummary = useMemo(
    () => getReconciliationConfirmationSummary(reconciliationTarget),
    [reconciliationTarget]
  );
  const [reconciling, setReconciling] = useState(false);
  const [reconciliationResults, setReconciliationResults] = useState<
    Record<
      string,
      {
        success: boolean;
        action?: string;
        error?: string;
        emailResult?: {
          attempted: boolean;
          sent: boolean;
          status: string;
          message: string;
        };
      }
    >
  >({});
  const [retryingEmailOrderId, setRetryingEmailOrderId] = useState<string | null>(null);

  // Background body scroll lock with automatic cleanup on close or unmount
  useBodyScrollLock(isOpen);

  const executeReconciliation = async (target: OrderVerificationResult) => {
    setReconciling(true);
    try {
      const res = await fetch("/api/admin/payments/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reconcile",
          paymentOrderId: target.orderId,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.success) {
        setReconciliationResults((prev) => ({
          ...prev,
          [target.orderId]: {
            success: false,
            error: json.error || `Reconciliation failed with HTTP ${res.status}`,
          },
        }));
      } else {
        setReconciliationResults((prev) => ({
          ...prev,
          [target.orderId]: {
            success: true,
            action: json.action,
            emailResult: json.emailResult,
          },
        }));

        // Update local dataset to reflect authoritative settlement
        setData((prevData) => {
          if (!prevData) return prevData;
          return {
            ...prevData,
            orders: prevData.orders.map((o) => {
              if (o.orderId === target.orderId) {
                return {
                  ...o,
                  localOrderStatus: "paid",
                  outcome: "MATCHED_PAID" as ReconciliationOutcome,
                  outcomeMessage: "Reconciliation successful. Idempotent settlement confirmed.",
                  linkedItems: o.linkedItems.map((li) => ({
                    ...li,
                    localStatus: "paid",
                  })),
                };
              }
              return o;
            }),
            summary: {
              ...prevData.summary,
              matchedPaid: prevData.summary.matchedPaid + 1,
              gatewayPaidLocalPending: Math.max(0, prevData.summary.gatewayPaidLocalPending - 1),
            },
          };
        });
      }
    } catch (err) {
      setReconciliationResults((prev) => ({
        ...prev,
        [target.orderId]: {
          success: false,
          error: err instanceof Error ? err.message : "Reconciliation failed.",
        },
      }));
    } finally {
      setReconciling(false);
      setReconciliationTarget(null);
    }
  };

  const handleRetryEmail = async (orderId: string) => {
    setRetryingEmailOrderId(orderId);
    try {
      const res = await fetch("/api/admin/payments/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "retry_email",
          paymentOrderId: orderId,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (json.emailResult) {
        setReconciliationResults((prev) => {
          const current = prev[orderId] || { success: true };
          return {
            ...prev,
            [orderId]: {
              ...current,
              emailResult: json.emailResult,
            },
          };
        });
      }
    } catch (err) {
      console.error("Retry email failed:", err);
    } finally {
      setRetryingEmailOrderId(null);
    }
  };

  useEffect(() => {
    if (isOpen) {
      if (initialMode) {
        setActiveTab(initialMode);
      } else if (selectedParticipantIds.length > 0) {
        setActiveTab("selected");
      } else {
        setActiveTab("audit");
      }
    }
  }, [isOpen, initialMode, selectedParticipantIds.length]);

  useEffect(() => {
    if (!isOpen || activeTab !== "audit") return;
    let isMounted = true;
    async function loadAuditScope() {
      setLoadingScope(true);
      try {
        const res = await fetch("/api/admin/payments/audit");
        if (res.ok) {
          const json = await res.json();
          if (isMounted && json.scope) {
            setAuditScope(json.scope);
          }
        }
      } catch (err) {
        console.warn("Failed to load audit scope:", err);
      } finally {
        if (isMounted) setLoadingScope(false);
      }
    }
    loadAuditScope();
    return () => {
      isMounted = false;
    };
  }, [isOpen, activeTab]);

  const handleRunAudit = async () => {
    setRunningAudit(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payments/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 25 }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Audit run failed with HTTP ${res.status}`);
      }

      const json = await res.json();
      setData({
        success: true,
        summary: json.summary,
        orders: json.orders || [],
        unlinkedItems: json.unlinkedItems || [],
        findings: json.findings || [],
      });
      if (json.scope) {
        setAuditScope(json.scope);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run payment audit.");
    } finally {
      setRunningAudit(false);
    }
  };

  useEffect(() => {
    if (!isOpen || activeTab !== "selected" || selectedParticipantIds.length === 0) {
      if (activeTab === "selected" && selectedParticipantIds.length === 0) {
        setData(null);
      }
      return;
    }

    let isMounted = true;
    async function runVerification() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/payments/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantIds: selectedParticipantIds }),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || `Verification failed with HTTP ${res.status}`);
        }

        const json: VerificationResponse = await res.json();
        if (isMounted) {
          setData(json);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to run verification.");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    runVerification();
    return () => {
      isMounted = false;
    };
  }, [isOpen, activeTab, selectedParticipantIds]);

  // Handle ESC key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const toggleExpand = (orderId: string) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const outcomeBadge = (outcome: ReconciliationOutcome, isLocalPreview?: boolean) => {
    const prefix = isLocalPreview ? "Simulated " : "";
    const suffix = isLocalPreview ? " (Preview)" : "";

    switch (outcome) {
      case "MATCHED_PAID":
        return {
          label: `${prefix}Match${suffix}`,
          color: "bg-emerald-50 text-emerald-800 border-emerald-200",
          icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />,
        };
      case "GATEWAY_PAID_LOCAL_PENDING":
        return {
          label: `${prefix}Gateway Paid / Local Pending`,
          color: "bg-amber-50 text-amber-800 border-amber-200",
          icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />,
        };
      case "LOCAL_PAID_GATEWAY_NOT_CONFIRMED":
        return {
          label: `${prefix}Local Paid / Gateway Unconfirmed`,
          color: "bg-rose-50 text-rose-800 border-rose-200",
          icon: <AlertCircle className="w-3.5 h-3.5 text-rose-600" />,
        };
      case "AMOUNT_MISMATCH":
        return {
          label: `${prefix}Amount Mismatch`,
          color: "bg-orange-50 text-orange-800 border-orange-200",
          icon: <AlertTriangle className="w-3.5 h-3.5 text-orange-600" />,
        };
      case "ORDER_LINKAGE_MISMATCH":
        return {
          label: `${prefix}Order Linkage Mismatch`,
          color: "bg-purple-50 text-purple-800 border-purple-200",
          icon: <Layers className="w-3.5 h-3.5 text-purple-600" />,
        };
      case "PAYMENT_PENDING":
        return {
          label: `${prefix}Pending${suffix}`,
          color: "bg-blue-50 text-blue-800 border-blue-200",
          icon: <Clock className="w-3.5 h-3.5 text-blue-600" />,
        };
      case "PAYMENT_FAILED":
        return {
          label: `${prefix}Failed${suffix}`,
          color: "bg-red-50 text-red-800 border-red-200",
          icon: <AlertCircle className="w-3.5 h-3.5 text-red-600" />,
        };
      case "ORDER_NOT_FOUND":
        return {
          label: `${prefix}Order Not Found`,
          color: "bg-zinc-100 text-zinc-700 border-zinc-200",
          icon: <Info className="w-3.5 h-3.5 text-zinc-500" />,
        };
      case "GATEWAY_UNAVAILABLE":
        return {
          label: "Gateway Unavailable",
          color: "bg-yellow-50 text-yellow-800 border-yellow-200",
          icon: <AlertTriangle className="w-3.5 h-3.5 text-yellow-600" />,
        };
      case "GATEWAY_REFERENCE_MISMATCH":
        return {
          label: `${prefix}Reference Mismatch`,
          color: "bg-red-50 text-red-800 border-red-200",
          icon: <AlertCircle className="w-3.5 h-3.5 text-red-600" />,
        };
      case "CONFLICTING_ITEM_MAPPING":
        return {
          label: `${prefix}Conflicting Mapping`,
          color: "bg-rose-50 text-rose-800 border-rose-200",
          icon: <AlertCircle className="w-3.5 h-3.5 text-rose-600" />,
        };
      case "MISSING_ACCOMMODATION_LINK":
        return {
          label: `${prefix}Missing Link`,
          color: "bg-amber-50 text-amber-800 border-amber-200",
          icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />,
        };
      case "INCOMPLETE_LOCAL_ITEM_MAPPING":
        return {
          label: `${prefix}Incomplete Mapping`,
          color: "bg-purple-50 text-purple-800 border-purple-200",
          icon: <Layers className="w-3.5 h-3.5 text-purple-600" />,
        };
      default:
        return {
          label: `${prefix}Inconclusive`,
          color: "bg-zinc-100 text-zinc-600 border-zinc-200",
          icon: <Info className="w-3.5 h-3.5 text-zinc-400" />,
        };
    }
  };

  // Group orders by participant to preserve multi-order identity and prevent duplicate assumptions
  const participantGroups = useMemo(() => {
    if (!data) return [];
    const map = new Map<
      string,
      {
        participantId: string;
        name: string;
        publicId: string;
        email: string;
        orders: OrderVerificationResult[];
        unlinked: LinkedItemDetail[];
      }
    >();

    data.orders.forEach((o) => {
      const existing = map.get(o.payerParticipantId) || {
        participantId: o.payerParticipantId,
        name: o.payerName,
        publicId: o.payerPublicId,
        email: o.payerEmail,
        orders: [],
        unlinked: [],
      };
      existing.orders.push(o);
      map.set(o.payerParticipantId, existing);
    });

    // Attach unlinked items to their participant
    (data.unlinkedItems || []).forEach((ui) => {
      const finding = (data.findings || []).find((f) => f.itemId === ui.id);
      const pId = finding?.participantId;
      if (pId && map.has(pId)) {
        map.get(pId)!.unlinked.push(ui);
      }
    });

    return Array.from(map.values());
  }, [data]);

  const copyableDiagnosticReport = useMemo(() => {
    if (!data) return "";
    const isSim = Boolean(data.summary.isLocalPreview);
    const lines = [
      `# SAVISKAR 2026 - PAYMENT VERIFICATION REPORT`,
      `Environment: ${isSim ? "LOCAL SIMULATION PREVIEW (Local Isolated)" : "PRODUCTION PAYU GATEWAY"}`,
      isSim
        ? `⚠️ DISCLAIMER: Generated in local test/preview mode. All results are simulated deterministically from local records. This diagnostic report must NOT be submitted to Accounts or PayU as proof of settlement. Live PayU APIs were not contacted.`
        : `Authoritative PayU gateway verification.`,
      `Verified At: ${data.summary.verifiedAt}`,
      `Total Participants: ${data.summary.totalParticipants} | Total Orders: ${data.summary.totalOrders}`,
      `Summary: Matched Paid: ${data.summary.matchedPaid} | Gateway Paid / Local Pending: ${data.summary.gatewayPaidLocalPending} | Amount Mismatch: ${data.summary.amountMismatch} | Pending/Unverified: ${data.summary.pendingUnverified}`,
      ``,
    ];

    if (data.findings && data.findings.length > 0) {
      lines.push(`--- DIAGNOSTIC FINDINGS (${data.findings.length}) ---`);
      data.findings.forEach((f) => {
        lines.push(`[${f.severity.toUpperCase()}] ${f.title}: ${f.description}`);
      });
      lines.push(``);
    }

    lines.push(`--- ITEMIZED ORDERS ---`);
    data.orders.forEach((o, idx) => {
      lines.push(`Order #${idx + 1}: ${o.orderReference} (${o.orderId})`);
      lines.push(`Participant: ${o.payerName} [${o.payerPublicId}] (${o.payerEmail})`);
      lines.push(`Amount Breakdown:`);
      lines.push(`  - Local Order Amount (payment_orders.amount): ₹${o.expectedAmount.toFixed(2)}`);
      lines.push(`  - Gateway Base Amount (PayU amt / transaction_amount): ${o.gatewayReportedAmount != null ? `₹${o.gatewayReportedAmount.toFixed(2)}` : "Not returned by PayU"}`);
      lines.push(`  - Additional Charge Reported by PayU (additional_charges): ${o.additionalCharges != null && o.additionalCharges > 0 ? `₹${o.additionalCharges.toFixed(2)}` : "Not returned by PayU"}`);
      lines.push(`  - Customer Debit (Calculated/Reported): ${o.customerTransactionAmount != null ? `₹${o.customerTransactionAmount.toFixed(2)}` : "Not returned by PayU"}`);
      lines.push(`  - Merchant Settlement (amount_settled): ${o.settlementAmount != null ? `₹${o.settlementAmount.toFixed(2)}` : "Not returned by PayU"}`);
      lines.push(`  - Gateway Deductions / Fees (PayU disc): ${o.deductions != null ? `₹${o.deductions.toFixed(2)}` : "₹0.00"}`);
      if (o.payuAmt != null || o.payuTransactionAmount != null) {
        lines.push(`  - PayU Raw Fields: amt=${o.payuAmt != null ? o.payuAmt.toFixed(2) : "N/A"}, transaction_amount=${o.payuTransactionAmount != null ? o.payuTransactionAmount.toFixed(2) : "N/A"}`);
      }
      if (o.amountAmbiguityReason) {
        lines.push(`  - ⚠️ Amount Ambiguity: ${o.amountAmbiguityReason}`);
      }
      lines.push(`Local Status: ${o.localOrderStatus} | Gateway Status: ${o.authoritativeGatewayStatus}${o.diagnostics.isLocalPreview ? " [SIMULATED]" : ""}`);
      lines.push(`Outcome: ${o.outcome} - ${o.outcomeMessage}`);
      lines.push(`Order Created: ${formatIndianTimestamp(o.orderCreatedAt)}`);
      lines.push(`Gateway Transaction Time: ${formatIndianTimestamp(o.gatewayTransactionTime)}`);
      lines.push(`Verified At: ${formatIndianTimestamp(o.verifiedAt)}`);
      if (o.diagnosticFindings && o.diagnosticFindings.length > 0) {
        o.diagnosticFindings.forEach((df) => {
          lines.push(`  Finding [${df.severity.toUpperCase()}]: ${df.title} — ${df.description}`);
        });
      }
      if (o.linkedItems && o.linkedItems.length > 0) {
        lines.push(`Linked Items:`);
        o.linkedItems.forEach((li) => {
          lines.push(`  - [${li.itemType.toUpperCase()}] ${li.title}: Expected ₹${li.expectedAmount} (Status: ${li.localStatus})`);
        });
      }
      lines.push(``);
    });

    if (data.unlinkedItems && data.unlinkedItems.length > 0) {
      lines.push(`--- UNLINKED PAYABLE REGISTRATIONS ---`);
      data.unlinkedItems.forEach((ui) => {
        lines.push(`- [${ui.itemType.toUpperCase()}] ${ui.title}: Expected ₹${ui.expectedAmount} (Status: ${ui.localStatus}) [NO PAYMENT ORDER LINK]`);
      });
    }

    return lines.join("\n");
  }, [data]);

  const handleCopyDiagnostic = () => {
    if (!copyableDiagnosticReport) return;
    navigator.clipboard.writeText(copyableDiagnosticReport);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-verification-title"
      data-lenis-prevent="true"
      data-lenis-prevent-wheel="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      style={{ overscrollBehavior: "contain" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-lenis-prevent="true"
        data-lenis-prevent-wheel="true"
        className="relative w-full max-w-5xl h-[min(90vh,calc(100dvh-2rem))] flex flex-col rounded-3xl bg-white shadow-2xl border border-black/10 overflow-hidden"
        style={{ overscrollBehavior: "contain" }}
      >
        {/* HEADER - Constrained, shrink-0 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.08] bg-black/[0.02] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-900/10 border border-amber-900/20 flex items-center justify-center text-amber-900 shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2
                  id="payment-verification-title"
                  className="text-base sm:text-lg font-bold tracking-tight text-black"
                >
                  Payment Verification
                </h2>
                {data?.summary.isLocalPreview && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-900 border border-amber-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-pulse" />
                    Simulation Preview
                  </span>
                )}
              </div>
              <p className="text-xs text-black/50">
                Authoritative read-only reconciliation against PayU gateway
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* TAB SELECTOR */}
            <div className="flex items-center gap-1 p-1 bg-black/[0.05] rounded-xl text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveTab("selected")}
                className={`px-3 py-1.5 rounded-lg transition ${
                  activeTab === "selected"
                    ? "bg-white text-black shadow-sm"
                    : "text-black/50 hover:text-black"
                }`}
              >
                Selected ({selectedParticipantIds.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("audit")}
                className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
                  activeTab === "audit"
                    ? "bg-white text-black shadow-sm"
                    : "text-black/50 hover:text-black"
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5 text-amber-800" />
                <span>Reconciliation Audit</span>
                {auditScope && auditScope.totalCandidateOrders > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold">
                    {auditScope.totalCandidateOrders}
                  </span>
                )}
              </button>
            </div>

            {data && (
              <button
                type="button"
                onClick={handleCopyDiagnostic}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-black/10 bg-white text-xs font-medium text-black/70 hover:bg-black/5 hover:text-black transition"
                title="Copy diagnostic report for Accounts / PayU"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Diagnostic</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-black/5 flex items-center justify-center text-black/50 hover:bg-black/10 hover:text-black transition"
              aria-label="Close dialog"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* CENTRAL SCROLLABLE BODY - flex-1 min-h-0 with overscroll-contain & Lenis prevention */}
        <div
          data-lenis-prevent="true"
          data-lenis-prevent-wheel="true"
          className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6"
          style={{ overscrollBehavior: "contain" }}
        >
          {/* AUDIT WORKFLOW CONTROL PANEL */}
          {activeTab === "audit" && (
            <div className="p-5 rounded-2xl bg-amber-50/70 border border-amber-200/90 text-amber-950 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-amber-800 shrink-0" />
                    <h3 className="text-sm font-bold text-amber-950">
                      Payment Reconciliation Audit Engine
                    </h3>
                  </div>
                  <p className="text-xs text-amber-900/70 mt-1 max-w-xl">
                    Discovers pending checkouts, locally failed retries, and unlinked bookings across the database without manual PayU dashboard logins.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={runningAudit || loadingScope || (auditScope?.totalCandidateOrders === 0 && !data)}
                  onClick={handleRunAudit}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white text-xs font-semibold shadow-sm transition active:scale-95 cursor-pointer"
                >
                  {runningAudit ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-4 h-4 text-amber-200" />
                  )}
                  <span>
                    {runningAudit
                      ? "Auditing Gateway Records..."
                      : `Run Payment Audit (${auditScope?.totalCandidateOrders ?? 0} Candidates)`}
                  </span>
                </button>
              </div>

              {auditScope && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-amber-200/60 text-xs">
                  <div className="p-2.5 rounded-xl bg-white/80 border border-amber-200/50">
                    <span className="text-[10px] uppercase font-bold text-black/40 block">Pending Orders</span>
                    <span className="font-mono font-bold text-amber-900 text-sm">{auditScope.breakdown.pendingOrdersCount}</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white/80 border border-amber-200/50">
                    <span className="text-[10px] uppercase font-bold text-black/40 block">Failed Retries</span>
                    <span className="font-mono font-bold text-amber-900 text-sm">{auditScope.breakdown.failedOrdersCount}</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white/80 border border-amber-200/50">
                    <span className="text-[10px] uppercase font-bold text-black/40 block">Pending Acc. Orders</span>
                    <span className="font-mono font-bold text-amber-900 text-sm">{auditScope.breakdown.pendingAccommodationsWithOrdersCount}</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white/80 border border-amber-200/50">
                    <span className="text-[10px] uppercase font-bold text-black/40 block">Unsettled Receipts</span>
                    <span className="font-mono font-bold text-amber-900 text-sm">{auditScope.breakdown.paidOrdersWithoutReceiptCount}</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white/80 border border-amber-200/50">
                    <span className="text-[10px] uppercase font-bold text-black/40 block">Total Candidates</span>
                    <span className="font-mono font-bold text-amber-900 text-sm">{auditScope.totalCandidateOrders}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* EMPTY SELECTION NOTICE */}
          {activeTab === "selected" && selectedParticipantIds.length === 0 && (
            <div className="p-12 text-center text-xs text-black/50 rounded-2xl border border-dashed border-black/15 bg-black/[0.01]">
              <ShieldCheck className="w-8 h-8 text-black/20 mx-auto mb-2" />
              <p className="font-bold text-black text-sm">No Participants Selected</p>
              <p className="mt-1 max-w-sm mx-auto">
                Select one or more participants in the table to verify their specific orders, or switch to the <strong>Reconciliation Audit</strong> tab to audit unresolved orders across the festival database.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab("audit")}
                className="mt-4 px-4 py-2 rounded-xl bg-amber-900/10 text-amber-950 font-semibold hover:bg-amber-900/20 transition cursor-pointer"
              >
                Switch to Reconciliation Audit
              </button>
            </div>
          )}

          {/* AUDIT WAITING FOR RUN */}
          {activeTab === "audit" && !data && !runningAudit && !loadingScope && (
            <div className="p-10 text-center text-xs text-black/40 rounded-2xl border border-black/[0.06] bg-black/[0.01]">
              <p className="font-medium text-black/70">
                Audit Scope loaded ({auditScope?.totalCandidateOrders ?? 0} candidate order records discovered).
              </p>
              <p className="mt-1">
                Click <strong>Run Payment Audit</strong> above to execute server-side verification across candidate orders.
              </p>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <RefreshCw className="w-8 h-8 text-amber-900 animate-spin mb-3" />
              <p className="text-sm font-semibold text-black">
                Verifying {selectedParticipantIds.length} participant record(s)...
              </p>
              <p className="text-xs text-black/40 mt-1 max-w-sm">
                Fetching authoritative gateway records from PayU and cross-referencing order items.
              </p>
            </div>
          )}

          {runningAudit && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <RefreshCw className="w-8 h-8 text-amber-900 animate-spin mb-3" />
              <p className="text-sm font-semibold text-black">
                Auditing candidate payment orders with PayU...
              </p>
              <p className="text-xs text-black/40 mt-1 max-w-sm">
                Executing bounded read-only verification across pending, failed, and accommodation checkout attempts.
              </p>
            </div>
          )}

          {error && !loading && !runningAudit && (
            <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-800 text-xs">
              <div className="flex items-center gap-2 font-bold mb-1">
                <AlertCircle className="w-4 h-4" />
                <span>Verification Error</span>
              </div>
              <p>{error}</p>
            </div>
          )}

          {data && !loading && (
            <>
              {/* SUMMARY CARDS */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-100 flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700/70">
                    {data.summary.isLocalPreview ? "Simulated Match" : "Matched Paid"}
                  </span>
                  <span className="text-2xl font-mono font-bold text-emerald-900 mt-1">
                    {data.summary.matchedPaid}
                  </span>
                  <span className="text-[10px] text-emerald-700/60 mt-0.5">
                    Order & items verified
                  </span>
                </div>

                <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-100 flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700/70">
                    Gateway Paid / Local Pending
                  </span>
                  <span className="text-2xl font-mono font-bold text-amber-900 mt-1">
                    {data.summary.gatewayPaidLocalPending}
                  </span>
                  <span className="text-[10px] text-amber-700/60 mt-0.5">
                    Needs atomic settlement
                  </span>
                </div>

                <div className="p-4 rounded-2xl bg-orange-50/70 border border-orange-100 flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-orange-700/70">
                    Amount Mismatch
                  </span>
                  <span className="text-2xl font-mono font-bold text-orange-900 mt-1">
                    {data.summary.amountMismatch}
                  </span>
                  <span className="text-[10px] text-orange-700/60 mt-0.5">
                    Order vs Gateway diff
                  </span>
                </div>

                <div className="p-4 rounded-2xl bg-blue-50/70 border border-blue-100 flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700/70">
                    Pending / Unverified
                  </span>
                  <span className="text-2xl font-mono font-bold text-blue-900 mt-1">
                    {data.summary.pendingUnverified}
                  </span>
                  <span className="text-[10px] text-blue-700/60 mt-0.5">
                    Awaiting checkout
                  </span>
                </div>
              </div>

              {/* LOCAL PREVIEW NOTICE BANNER */}
              {data.summary.isLocalPreview && (
                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200/90 text-amber-950 flex items-start gap-3 shadow-sm">
                  <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                  <div className="text-xs space-y-1">
                    <div className="font-bold text-amber-950 text-sm">
                      LOCAL SIMULATION PREVIEW (Local Isolated)
                    </div>
                    <p className="text-amber-800 leading-relaxed">
                      All PayU verification results below are deterministically simulated from local database records.
                      Live network calls to PayU are disabled in this environment to protect credentials and prevent accidental production requests.
                    </p>
                    <p className="font-semibold text-amber-900">
                      ⚠️ DO NOT use this preview report as official proof of bank settlement for Accounts or PayU reconciliation.
                    </p>
                  </div>
                </div>
              )}

              {/* PARTICIPANT GROUPS & ITEMIZED ORDERS */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-black/60">
                    Associated Payment Orders by Participant ({data.orders.length} orders across {participantGroups.length} participants)
                  </span>
                  <span className="text-[10px] font-mono text-black/40">
                    Timestamp: {new Date(data.summary.verifiedAt).toLocaleTimeString("en-IN")}
                  </span>
                </div>

                {participantGroups.length === 0 ? (
                  <div className="p-8 text-center text-xs text-black/40 rounded-2xl border border-black/[0.08] bg-white">
                    No payment orders or registrations were discovered for the selected participants.
                  </div>
                ) : (
                  participantGroups.map((group) => (
                    <div
                      key={group.participantId}
                      className="rounded-2xl border border-black/[0.08] bg-white overflow-hidden shadow-sm"
                    >
                      {/* PARTICIPANT HEADER */}
                      <div className="px-5 py-3.5 bg-black/[0.02] border-b border-black/[0.08] flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-amber-900/10 text-amber-950 font-bold flex items-center justify-center text-xs">
                            {group.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-black">{group.name}</span>
                              <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-black/5 text-black/60">
                                {group.publicId}
                              </span>
                            </div>
                            <span className="text-xs text-black/40">{group.email}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-black/5 text-black/70">
                            {group.orders.length} Payment {group.orders.length === 1 ? "Order" : "Orders"}
                          </span>
                        </div>
                      </div>

                      {/* NOTICE IF PARTICIPANT HAS MULTIPLE ORDERS (E.G. MUN GENERAL ASSEMBLY VS SECURITY COUNCIL) */}
                      {group.orders.length > 1 && (
                        <div className="p-3.5 bg-blue-50/70 border-b border-blue-100 flex items-start gap-2.5 text-blue-900 text-xs">
                          <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-700" />
                          <div>
                            <span className="font-bold">Multiple Independent Orders: </span>
                            This participant has {group.orders.length} distinct checkout orders.
                            Each checkout is independent; a completed payment for one event does NOT imply or settle another order.
                          </div>
                        </div>
                      )}

                      {/* UNLINKED PAYABLE REGISTRATIONS IF FOUND */}
                      {group.unlinked.length > 0 && (
                        <div className="p-3.5 bg-amber-50/80 border-b border-amber-200 text-amber-950 text-xs space-y-2">
                          <div className="flex items-center gap-2 font-bold text-amber-900">
                            <AlertTriangle className="w-4 h-4 text-amber-700" />
                            <span>Unlinked Payable Registrations Found ({group.unlinked.length})</span>
                          </div>
                          <p className="text-[11px] text-amber-800">
                            The following registrations do not have an associated payment order record in the database:
                          </p>
                          <div className="space-y-1">
                            {group.unlinked.map((ui) => (
                              <div
                                key={ui.id}
                                className="flex items-center justify-between p-2 rounded-lg bg-white border border-amber-200 text-xs"
                              >
                                <span className="font-medium text-black">{ui.title}</span>
                                <span className="font-mono text-amber-900 font-semibold">
                                  Expected: ₹{ui.expectedAmount} (Status: {ui.localStatus})
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* ORDERS LIST */}
                      <div className="divide-y divide-black/[0.06]">
                        {group.orders.map((order) => {
                          const badge = outcomeBadge(order.outcome, order.diagnostics.isLocalPreview);
                          const isExpanded = expandedOrders.has(order.orderId);

                          return (
                            <div key={order.orderId} className="transition hover:bg-black/[0.01]">
                              <div
                                onClick={() => toggleExpand(order.orderId)}
                                className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 cursor-pointer select-none"
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                                    <span className="font-mono text-xs font-bold text-black">
                                      {order.orderReference}
                                    </span>
                                    <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-black/5 text-black/60">
                                      {order.gateway.toUpperCase()}
                                    </span>
                                    <span
                                      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${badge.color}`}
                                    >
                                      {badge.icon}
                                      <span>{badge.label}</span>
                                    </span>
                                    <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-black/5 text-black/70">
                                      Local: {order.localOrderStatus.toUpperCase()}
                                    </span>
                                  </div>

                                  <p className="text-xs text-black/70 italic">
                                    {order.outcomeMessage}
                                  </p>

                                  {/* ORDER FINDINGS PILLS */}
                                  {order.diagnosticFindings &&
                                    order.diagnosticFindings.filter((df) => df.type !== "SEPARATE_ORDER_NOTICE").length > 0 && (
                                      <div className="mt-2 space-y-1">
                                        {order.diagnosticFindings
                                          .filter((df) => df.type !== "SEPARATE_ORDER_NOTICE")
                                          .map((df, idx) => (
                                            <div
                                              key={idx}
                                              className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-md border mr-1.5 ${
                                                df.severity === "error"
                                                  ? "bg-rose-50 text-rose-800 border-rose-200"
                                                  : "bg-amber-50 text-amber-800 border-amber-200"
                                              }`}
                                            >
                                              <AlertCircle className="w-3 h-3 shrink-0" />
                                              <span>{df.title}: {df.description}</span>
                                            </div>
                                          ))}
                                      </div>
                                    )}

                                  {/* RECONCILIATION ACTION BUTTON (GENUINELY ELIGIBLE ORDERS ONLY) */}
                                  {order.outcome === "GATEWAY_PAID_LOCAL_PENDING" && order.localOrderStatus !== "paid" && (
                                    <div className="mt-3 flex flex-wrap items-center gap-2 pt-2 border-t border-black/[0.04]">
                                      {data.summary.isLocalPreview ? (
                                        <>
                                          <button
                                            type="button"
                                            disabled
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-300 bg-amber-50/80 text-[11px] font-semibold text-amber-800 cursor-not-allowed opacity-75"
                                            title="Reconciliation is disabled in local preview mode. Simulated gateway results cannot authorize database mutations."
                                          >
                                            <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                                            <span>Reconcile (Disabled in Preview)</span>
                                          </button>
                                          <span className="text-[10px] text-amber-800/80">
                                            Simulation preview mode protects financial records. Settle payments only with authoritative live verification.
                                          </span>
                                        </>
                                      ) : (
                                        <>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setReconciliationTarget(order);
                                            }}
                                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-semibold shadow-sm transition active:scale-95"
                                          >
                                            <ShieldCheck className="w-3.5 h-3.5" />
                                            <span>Reconcile Payment</span>
                                          </button>
                                          <span className="text-[10px] text-black/50">
                                            Authoritative gateway payment confirmed. Click to review and settle.
                                          </span>
                                        </>
                                      )}
                                    </div>
                                  )}

                                  {/* RECONCILIATION OUTCOME BANNER & EMAIL STATUS */}
                                  {reconciliationResults[order.orderId] && (
                                    <div
                                      className={`mt-3 p-3 rounded-xl border text-xs flex flex-col gap-1.5 ${
                                        reconciliationResults[order.orderId].success
                                          ? "bg-emerald-50 border-emerald-200 text-emerald-950"
                                          : "bg-rose-50 border-rose-200 text-rose-950"
                                      }`}
                                    >
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 font-bold">
                                          {reconciliationResults[order.orderId].success ? (
                                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                          ) : (
                                            <AlertCircle className="w-4 h-4 text-rose-600" />
                                          )}
                                          <span>
                                            {reconciliationResults[order.orderId].success
                                              ? "Payment Reconciled & Settled"
                                              : "Reconciliation Failed"}
                                          </span>
                                        </div>
                                        {reconciliationResults[order.orderId].action && (
                                          <span className="font-mono text-[10px] uppercase px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                                            Action: {reconciliationResults[order.orderId].action}
                                          </span>
                                        )}
                                      </div>

                                      {reconciliationResults[order.orderId].error && (
                                        <p className="text-[11px] text-rose-800">
                                          {reconciliationResults[order.orderId].error}
                                        </p>
                                      )}

                                      {reconciliationResults[order.orderId].emailResult && (
                                        <div className="pt-2 border-t border-emerald-200/60 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                          <div className="flex items-center gap-1.5">
                                            <Mail className="w-3.5 h-3.5 text-emerald-700" />
                                            <span>{reconciliationResults[order.orderId].emailResult?.message}</span>
                                          </div>
                                          {!reconciliationResults[order.orderId].emailResult?.sent && (
                                            <button
                                              type="button"
                                              disabled={retryingEmailOrderId === order.orderId}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleRetryEmail(order.orderId);
                                              }}
                                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium text-[10px] transition"
                                            >
                                              {retryingEmailOrderId === order.orderId ? (
                                                <RefreshCw className="w-3 h-3 animate-spin" />
                                              ) : (
                                                <RotateCcw className="w-3 h-3" />
                                              )}
                                              <span>Retry Email Dispatch</span>
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {/* AMOUNTS & EXPAND TRIGGER */}
                                <div className="flex items-center gap-6 shrink-0">
                                  <div className="text-right space-y-0.5">
                                    <div className="text-xs font-mono font-bold text-black">
                                      Local Order: ₹{order.expectedAmount.toFixed(2)}
                                    </div>
                                    <div className="text-[11px] font-mono text-black/60">
                                      Gateway Base:{" "}
                                      {order.gatewayReportedAmount != null
                                        ? `₹${order.gatewayReportedAmount.toFixed(2)}`
                                        : "Not returned by PayU"}
                                      {order.diagnostics.isLocalPreview && " (Simulated)"}
                                    </div>
                                    {order.additionalCharges != null && order.additionalCharges > 0 && (
                                      <div className="text-[10px] text-amber-800 font-mono">
                                        PayU Surcharge: +₹{order.additionalCharges.toFixed(2)}
                                      </div>
                                    )}
                                    {order.customerTransactionAmount != null && (
                                      <div className="text-[10px] text-black/50 font-mono">
                                        Customer Debit: ₹{order.customerTransactionAmount.toFixed(2)}
                                      </div>
                                    )}
                                  </div>

                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleExpand(order.orderId);
                                    }}
                                    className="w-8 h-8 rounded-full border border-black/10 flex items-center justify-center text-black/40 hover:text-black hover:bg-black/5 transition"
                                    aria-label="Expand order details"
                                  >
                                    {isExpanded ? (
                                      <ChevronUp className="w-4 h-4" />
                                    ) : (
                                      <ChevronDown className="w-4 h-4" />
                                    )}
                                  </button>
                                </div>
                              </div>

                              {/* EXPANDED DIAGNOSTIC DETAILS (Flows naturally in scroll container without nested scrollbars) */}
                              {isExpanded && (
                                <div className="px-5 pb-5 pt-2 bg-black/[0.015] border-t border-black/[0.04] space-y-4">
                                  {/* TECHNICAL IDS & REFERENCES */}
                                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-[11px] bg-white p-3.5 rounded-xl border border-black/[0.06]">
                                    <div>
                                      <span className="text-black/40 block text-[9px] uppercase font-bold">
                                        Payment Order UUID
                                      </span>
                                      <span className="font-mono text-black/80 truncate block">
                                        {order.orderId}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-black/40 block text-[9px] uppercase font-bold">
                                        Gateway Order ID (txnid)
                                      </span>
                                      <span className="font-mono text-black/80 truncate block">
                                        {order.gatewayOrderId}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-black/40 block text-[9px] uppercase font-bold">
                                        Gateway Payment ID (mihpayid)
                                      </span>
                                      <span className="font-mono text-black/80 truncate block">
                                        {order.gatewayPaymentId || "None recorded"}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-black/40 block text-[9px] uppercase font-bold">
                                        Canonical Receipt Record
                                      </span>
                                      <span className="font-mono text-black/80 capitalize block">
                                        {order.settlementReceiptStatus.replace(/_/g, " ")}
                                      </span>
                                    </div>
                                  </div>

                                  {/* AMOUNT NORMALIZATION & SETTLEMENT BREAKDOWN */}
                                  <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-black/50 block">
                                      Amount Normalization & Settlement Breakdown
                                    </span>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 text-[11px] bg-white p-3.5 rounded-xl border border-black/[0.06]">
                                      <div>
                                        <span className="text-black/40 block text-[9px] uppercase font-bold">
                                          Local Order Amount
                                        </span>
                                        <span className="font-mono text-black/90 font-semibold block mt-0.5">
                                          ₹{order.expectedAmount.toFixed(2)}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-black/40 block text-[9px] uppercase font-bold">
                                          Gateway Base Amount
                                        </span>
                                        <span className="font-mono text-black/80 block mt-0.5">
                                          {order.gatewayReportedAmount != null
                                            ? `₹${order.gatewayReportedAmount.toFixed(2)}`
                                            : "Not returned by PayU"}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-black/40 block text-[9px] uppercase font-bold">
                                          Additional Charge (PayU)
                                        </span>
                                        <span className="font-mono text-black/80 block mt-0.5">
                                          {order.additionalCharges != null && order.additionalCharges > 0
                                            ? `₹${order.additionalCharges.toFixed(2)}`
                                            : "Not returned by PayU"}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-black/40 block text-[9px] uppercase font-bold">
                                          Customer Debit
                                        </span>
                                        <span className="font-mono text-black/80 block mt-0.5">
                                          {order.customerTransactionAmount != null
                                            ? `₹${order.customerTransactionAmount.toFixed(2)}`
                                            : "Not returned by PayU"}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-black/40 block text-[9px] uppercase font-bold">
                                          Merchant Settlement
                                        </span>
                                        <span className="font-mono text-black/80 block mt-0.5">
                                          {order.settlementAmount != null
                                            ? `₹${order.settlementAmount.toFixed(2)}`
                                            : "Not returned by PayU"}
                                        </span>
                                      </div>
                                    </div>
                                    {order.amountAmbiguityReason && (
                                      <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2">
                                        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                                        <div>
                                          <span className="font-bold">Unresolved Amount Discrepancy: </span>
                                          {order.amountAmbiguityReason}
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  {/* AUTHORITATIVE BANK & GATEWAY METADATA */}
                                  {(order.bankRefNum || order.udf1 || order.deductions != null || order.payuAmt != null || order.payuTransactionAmount != null) && (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-[11px] bg-white p-3.5 rounded-xl border border-black/[0.06]">
                                      <div>
                                        <span className="text-black/40 block text-[9px] uppercase font-bold">
                                          Bank Reference (UPI RRN)
                                        </span>
                                        <span className="font-mono text-black/80 truncate block">
                                          {order.bankRefNum || "None reported"}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-black/40 block text-[9px] uppercase font-bold">
                                          Echoed UDF1 (Order Ref)
                                        </span>
                                        <span className="font-mono text-black/80 truncate block">
                                          {order.udf1 || "None reported"}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-black/40 block text-[9px] uppercase font-bold">
                                          Gateway Deductions / Fees
                                        </span>
                                        <span className="font-mono text-black/80 block">
                                          {order.deductions != null ? `₹${order.deductions.toFixed(2)}` : "₹0.00"}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-black/40 block text-[9px] uppercase font-bold">
                                          PayU Raw Fields
                                        </span>
                                        <span className="font-mono text-black/80 block truncate">
                                          amt: {order.payuAmt != null ? `₹${order.payuAmt.toFixed(2)}` : "—"}
                                          {order.payuTransactionAmount != null ? ` | txn_amt: ₹${order.payuTransactionAmount.toFixed(2)}` : ""}
                                        </span>
                                      </div>
                                    </div>
                                  )}

                                  {/* DISTINCT TIMESTAMPS (NO SILENT CROSS-SUBSTITUTION) */}
                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px] bg-white p-3.5 rounded-xl border border-black/[0.06]">
                                    <div>
                                      <span className="text-black/40 block text-[9px] uppercase font-bold">
                                        Order Created (payment_orders)
                                      </span>
                                      <span className="font-mono text-black/80 block mt-0.5">
                                        {formatIndianTimestamp(order.orderCreatedAt)}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-black/40 block text-[9px] uppercase font-bold">
                                        Gateway Transaction Time (PayU addedon)
                                      </span>
                                      <span className="font-mono text-black/80 block mt-0.5">
                                        {formatIndianTimestamp(order.gatewayTransactionTime)}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-black/40 block text-[9px] uppercase font-bold">
                                        Verified At (Current Verification)
                                      </span>
                                      <span className="font-mono text-black/80 block mt-0.5">
                                        {formatIndianTimestamp(order.verifiedAt)}
                                      </span>
                                    </div>
                                  </div>

                                  {/* LINKED ITEMS BREAKDOWN */}
                                  <div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-black/50 block mb-2">
                                      Linked Items in this Order ({order.linkedItems.length})
                                    </span>
                                    <div className="space-y-1.5">
                                      {order.linkedItems.map((item, liIdx) => (
                                        <div
                                          key={item.id || liIdx}
                                          className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-black/[0.06] text-xs"
                                        >
                                          <div className="flex items-center gap-2">
                                            {item.itemType === "accommodation" ? (
                                              <Building2 className="w-3.5 h-3.5 text-purple-600" />
                                            ) : (
                                              <CreditCard className="w-3.5 h-3.5 text-blue-600" />
                                            )}
                                            <span className="font-medium text-black">{item.title}</span>
                                            {item.dates && (
                                              <span className="text-[10px] text-black/40">
                                                ({item.dates})
                                              </span>
                                            )}
                                          </div>

                                          <div className="flex items-center gap-3">
                                            <span className="font-mono font-semibold text-black/80">
                                              ₹{item.expectedAmount.toLocaleString("en-IN")}
                                            </span>
                                            <span
                                              className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                                                item.localStatus === "paid"
                                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                                  : "bg-amber-50 text-amber-700 border-amber-200"
                                              }`}
                                            >
                                              {item.localStatus}
                                            </span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* FOOTER - Constrained, shrink-0 */}
        <div className="px-6 py-4 border-t border-black/[0.08] bg-black/[0.02] flex items-center justify-between shrink-0">
          <p className="text-xs text-black/40">
            Read-only verification does not alter any payment or registration record.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-black text-white text-xs font-semibold hover:bg-black/80 transition"
          >
            Close
          </button>
        </div>
      </div>

      {/* RECONCILIATION CONFIRMATION MODAL */}
      {reconciliationTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-reconciliation-title"
          data-lenis-prevent="true"
          data-lenis-prevent-wheel="true"
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget && !reconciling) {
              setReconciliationTarget(null);
            }
          }}
        >
          <div
            data-lenis-prevent="true"
            data-lenis-prevent-wheel="true"
            className="relative w-full max-w-lg rounded-3xl bg-white shadow-2xl border border-black/10 overflow-hidden flex flex-col p-6 space-y-4"
          >
            {/* Header */}
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-700 shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 id="confirm-reconciliation-title" className="text-base font-bold text-black">
                  Confirm Payment Reconciliation
                </h3>
                <p className="text-xs text-black/50 mt-0.5">
                  Idempotent production settlement for confirmed gateway payment
                </p>
              </div>
              {!reconciling && (
                <button
                  type="button"
                  onClick={() => setReconciliationTarget(null)}
                  className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center text-black/40 hover:bg-black/10 hover:text-black transition"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

                        {/* Order & Linked Items Summary */}
            <div className="p-4 rounded-2xl bg-black/[0.02] border border-black/[0.06] space-y-3 text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-black/[0.06]">
                <span className="text-black/50">Saviskar Order Reference (UDF1)</span>
                <span className="font-mono font-bold text-black">{confirmSummary.saviskarOrderRef}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-black/[0.06]">
                <span className="text-black/50">PayU Merchant Transaction Reference (txnid)</span>
                <span className="font-mono text-black/80">{confirmSummary.merchantTxnRef}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-black/[0.06]">
                <span className="text-black/50">PayU Payment ID (mihpayid)</span>
                <span className="font-mono text-black/80">{confirmSummary.payuPaymentId}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-black/[0.06]">
                <span className="text-black/50">Expected Base Amount</span>
                <span className="font-mono font-bold text-emerald-800">
                  ₹{confirmSummary.expectedAmountINR.toFixed(2)} INR
                </span>
              </div>

              {/* Affected Status Records Summary */}
              <div className="space-y-1.5 pt-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-black/50 block">
                  Affected Status Records ({confirmSummary.transitions.filter((t) => !t.isUnchanged).length})
                </span>
                {confirmSummary.transitions.map((t, idx) => (
                  <div
                    key={idx}
                    className="flex justify-between items-center text-[11px] p-2.5 rounded-lg bg-white border border-black/[0.04]"
                  >
                    <span className="font-medium text-black truncate max-w-[240px]">{t.recordName}</span>
                    <span
                      className={`font-mono font-semibold ${
                        t.requiresReview
                          ? "text-rose-700 font-bold"
                          : t.isUnchanged
                          ? "text-black/40"
                          : "text-emerald-700"
                      }`}
                    >
                      {t.transitionDisplay}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* If settlement blocked, show prominent alert */}
            {!confirmSummary.canSettle && (
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] text-rose-900 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="block font-bold">Confirmation Blocked:</strong>
                  <span>{confirmSummary.blockReason}</span>
                </div>
              </div>
            )}

            {/* Disclosure */}
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 leading-relaxed">
              <strong>Reconciliation Safety Disclosure:</strong>
              <p className="mt-1">
                This operation reloads the authoritative order on the server, verifies PayU settlement status, and invokes the idempotent <code className="font-mono bg-amber-100 px-1 py-0.5 rounded">process_payment_success</code> stored procedure. It will NOT duplicate transactions or alter unrelated checkouts. An updated confirmation email will be dispatched automatically.
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={reconciling}
                onClick={() => setReconciliationTarget(null)}
                className="px-4 py-2 rounded-xl border border-black/10 text-xs font-semibold text-black/70 hover:bg-black/5 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={reconciling || !confirmSummary.canSettle}
                onClick={() => executeReconciliation(reconciliationTarget)}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-sm transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {reconciling ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Reconciling & Settling...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Confirm & Settle Payment</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
