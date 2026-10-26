"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Mail,
  Award,
  Clock,
  Send,
  Eye,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  ShieldAlert,
  ArrowLeft,
  ChevronRight,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

interface GeneralRecipient {
  normalizedEmail: string;
  originalEmail: string;
  name: string;
  sources: Array<"event" | "team_member" | "accommodation">;
  details: {
    eventIds?: string[];
    teamNames?: string[];
    accommodationIds?: string[];
  };
  isValidEmail: boolean;
}

interface CertificateCandidate {
  participantEventId: string;
  memberId?: string | null;
  participantId?: string | null;
  recipientName: string;
  recipientEmail?: string | null;
  isValidEmail: boolean;
  eventId: string;
  eventName: string;
  isTeam: boolean;
  teamName?: string | null;
  teamContactEmail?: string | null;
  isTeamLeader?: boolean;
  mainCheckedIn: boolean;
  mainCheckedInAt: string | null;
  eventCheckedIn: boolean;
  paymentStatus: string | null;
  paymentAmount: number | null;
  isFree: boolean;
  isPaymentComplete: boolean;
  certificateEligible: boolean;
  ineligibilityReason?: string | null;
  issueSourceKey: string;
}

interface CampaignItem {
  id: string;
  title: string;
  subject: string;
  campaign_type: "general" | "certificate";
  status: string;
  total_recipients: number;
  total_deliveries: number;
  sent_count: number;
  delivered_count: number;
  failed_count: number;
  created_at: string;
}

export default function AdminBroadcastPage() {
  const router = useRouter();

  // Role & auth state
  const [isAdminChecking, setIsAdminChecking] = useState(true);
  const [isMaster, setIsMaster] = useState(false);
  const [adminUser, setAdminUser] = useState<any>(null);

  // Tabs
  const [activeTab, setActiveTab] = useState<"general" | "certificate" | "history">("general");

  // General Broadcast state
  const [generalTitle, setGeneralTitle] = useState("");
  const [generalDispatchImmediately, setGeneralDispatchImmediately] = useState(false);
  const [certDispatchImmediately, setCertDispatchImmediately] = useState(false);
  const [generalSubject, setGeneralSubject] = useState("");
  const [generalBodyHtml, setGeneralBodyHtml] = useState(
    `<p>Dear Saviskar Participant,</p>\n<p>We are delighted to share key updates regarding Saviskar 2026.</p>\n<p>Best regards,<br/>Department of Student Affairs<br/>CGC University, Mohali</p>`
  );
  const [generalRecipients, setGeneralRecipients] = useState<GeneralRecipient[]>([]);
  const [selectedGeneralEmails, setSelectedGeneralEmails] = useState<Set<string>>(new Set());
  const [generalSearch, setGeneralSearch] = useState("");
  const [generalSourceFilter, setGeneralSourceFilter] = useState<string>("all");
  const [isLoadingRecipients, setIsLoadingRecipients] = useState(false);
  const [generalRecipientsError, setGeneralRecipientsError] = useState<string | null>(null);

  // Certificate state
  const [certTitle, setCertTitle] = useState("Saviskar 2026 Participation Certificates");
  const [certSubject, setCertSubject] = useState("Your Official Certificate of Participation - Saviskar 2026");
  const [certBodyHtml, setCertBodyHtml] = useState(
    `<p>Dear Participant,</p>\n<p>Congratulations on your active participation in Saviskar 2026 at CGC University, Mohali!</p>\n<p>Please find attached your official Certificate of Participation.</p>\n<p>Warm regards,<br/>Organizing Committee, Saviskar 2026</p>`
  );
  const [certCandidates, setCertCandidates] = useState<CertificateCandidate[]>([]);
  const [selectedCertKeys, setSelectedCertKeys] = useState<Set<string>>(new Set());
  const [certSearch, setCertSearch] = useState("");
  const [certEventFilter, setCertEventFilter] = useState<string>("all");
  const [certMainCheckInOnly, setCertMainCheckInOnly] = useState(true);
  const [sendIndividual, setSendIndividual] = useState(true);
  const [sendTeamBackup, setSendTeamBackup] = useState(true);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [certCandidatesError, setCertCandidatesError] = useState<string | null>(null);

  // History & Queue state
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [selectedCampaignDeliveries, setSelectedCampaignDeliveries] = useState<any[]>([]);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [batchResult, setBatchResult] = useState<string | null>(null);
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(false);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [campaignSchemaWarning, setCampaignSchemaWarning] = useState<string | null>(null);

  // Modals & UI Actions
  const [testEmailAddress, setTestEmailAddress] = useState("");
  const [isSubmittingCampaign, setIsSubmittingCampaign] = useState(false);
  const [campaignSuccessMsg, setCampaignSuccessMsg] = useState<string | null>(null);
  const [campaignSubmitError, setCampaignSubmitError] = useState<string | null>(null);
  const [isHybridMode, setIsHybridMode] = useState(false);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [previewPdfLoading, setPreviewPdfLoading] = useState(false);

  // 1. Initial auth check
  useEffect(() => {
    async function checkRole() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          router.replace("/admin/login");
          return;
        }
        setAdminUser(user);

        const { data: adminRecord } = await supabase
          .from("admins")
          .select("role")
          .eq("user_id", user.id)
          .single();

        if (adminRecord?.role === "master") {
          setIsMaster(true);
          if (user.email) setTestEmailAddress(user.email);
        } else {
          setIsMaster(false);
        }
      } catch (err) {
        console.error("Auth check failed:", err);
      } finally {
        setIsAdminChecking(false);
      }
    }
    checkRole();
  }, [router]);

  // 2. Fetch data based on active tab
  useEffect(() => {
    if (!isMaster) return;

    if (activeTab === "general") {
      fetchGeneralRecipients();
    } else if (activeTab === "certificate") {
      fetchCertificateCandidates();
    } else if (activeTab === "history") {
      fetchCampaigns();
    }
  }, [isMaster, activeTab]);

  async function fetchGeneralRecipients() {
    setIsLoadingRecipients(true);
    setGeneralRecipientsError(null);
    try {
      const res = await fetch("/api/admin/broadcast/recipients?type=general");
      const data = await res.json();
      if (res.ok && data.recipients) {
        setGeneralRecipients(data.recipients);
        if (typeof data.isHybridMode === "boolean") {
          setIsHybridMode(data.isHybridMode);
        }
        if (typeof data.isPreviewMode === "boolean") {
          setIsPreviewMode(data.isPreviewMode);
        } else if (data.mode === "preview") {
          setIsPreviewMode(true);
        }
        // Failure F: Newly loaded recipients must start UNSELECTED
        setSelectedGeneralEmails(new Set());
      } else {
        setGeneralRecipientsError(data.error || "Failed to load general broadcast recipients.");
      }
    } catch (err: any) {
      console.error("Failed to load general recipients:", err);
      setGeneralRecipientsError(err?.message || "Failed to load general broadcast recipients.");
    } finally {
      setIsLoadingRecipients(false);
    }
  }

  async function fetchCertificateCandidates() {
    setIsLoadingCandidates(true);
    setCertCandidatesError(null);
    try {
      const res = await fetch("/api/admin/broadcast/recipients?type=certificate");
      const data = await res.json();
      if (res.ok && data.recipients) {
        setCertCandidates(data.recipients);
        if (typeof data.isHybridMode === "boolean") {
          setIsHybridMode(data.isHybridMode);
        }
        if (typeof data.isPreviewMode === "boolean") {
          setIsPreviewMode(data.isPreviewMode);
        } else if (data.mode === "preview") {
          setIsPreviewMode(true);
        }
        // Start unselected for safety
        setSelectedCertKeys(new Set());
      } else {
        setCertCandidatesError(data.error || "Failed to load certificate candidates.");
      }
    } catch (err: any) {
      console.error("Failed to load certificate candidates:", err);
      setCertCandidatesError(err?.message || "Failed to load certificate candidates.");
    } finally {
      setIsLoadingCandidates(false);
    }
  }

  async function fetchCampaigns() {
    setIsLoadingCampaigns(true);
    setCampaignError(null);
    setCampaignSchemaWarning(null);
    try {
      const res = await fetch("/api/admin/broadcast/campaigns");
      const data = await res.json();
      if (res.ok) {
        setCampaigns(data.campaigns || []);
        if (typeof data.isHybridMode === "boolean") {
          setIsHybridMode(data.isHybridMode);
        }
        if (typeof data.isPreviewMode === "boolean") {
          setIsPreviewMode(data.isPreviewMode);
        } else if (data.mode === "preview") {
          setIsPreviewMode(true);
        }
        if (data.schemaWarning) {
          setCampaignSchemaWarning(data.schemaWarning);
        }
      } else {
        setCampaignError(data.error || "Failed to load campaigns.");
      }
    } catch (err: any) {
      console.error("Failed to load campaigns:", err);
      setCampaignError(err?.message || "Failed to load campaigns.");
    } finally {
      setIsLoadingCampaigns(false);
    }
  }

  async function loadCampaignDetails(id: string) {
    setSelectedCampaignId(id);
    try {
      const res = await fetch(`/api/admin/broadcast/campaigns/${id}`);
      const data = await res.json();
      if (data.deliveries) {
        setSelectedCampaignDeliveries(data.deliveries);
      }
    } catch (err) {
      console.error("Failed to load deliveries:", err);
    }
  }

  // Filtered General Recipients
  const filteredGeneralRecipients = useMemo(() => {
    return generalRecipients.filter((r) => {
      if (generalSourceFilter !== "all" && !r.sources.includes(generalSourceFilter as any)) {
        return false;
      }
      if (generalSearch) {
        const query = generalSearch.toLowerCase();
        return (
          r.name.toLowerCase().includes(query) ||
          r.normalizedEmail.toLowerCase().includes(query) ||
          r.originalEmail.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [generalRecipients, generalSourceFilter, generalSearch]);

  // Filtered Certificate Candidates
  const filteredCertCandidates = useMemo(() => {
    return certCandidates.filter((c) => {
      if (certMainCheckInOnly && !c.mainCheckedIn) {
        return false;
      }
      if (certEventFilter !== "all" && c.eventId !== certEventFilter) {
        return false;
      }
      if (certSearch) {
        const query = certSearch.toLowerCase();
        return (
          c.recipientName.toLowerCase().includes(query) ||
          c.eventName.toLowerCase().includes(query) ||
          (c.recipientEmail && c.recipientEmail.toLowerCase().includes(query)) ||
          (c.teamName && c.teamName.toLowerCase().includes(query))
        );
      }
      return true;
    });
  }, [certCandidates, certMainCheckInOnly, certEventFilter, certSearch]);

  // Unique Events for Certificate filter
  const uniqueEvents = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of certCandidates) {
      if (c.eventId && c.eventName) {
        map.set(c.eventId, c.eventName);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [certCandidates]);

  // Create General Campaign
  async function handleCreateGeneralCampaign() {
    if (!generalTitle.trim() || !generalSubject.trim() || !generalBodyHtml.trim()) {
      alert("Please enter campaign title, subject, and message body.");
      return;
    }
    if (selectedGeneralEmails.size === 0) {
      alert("Please select at least one recipient email.");
      return;
    }

    setIsSubmittingCampaign(true);
    setCampaignSuccessMsg(null);
    setCampaignSubmitError(null);
    try {
      const res = await fetch("/api/admin/broadcast/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: generalTitle,
          subject: generalSubject,
          bodyHtml: generalBodyHtml,
          campaignType: "general",
          selectedEmails: Array.from(selectedGeneralEmails),
          dispatchImmediately: generalDispatchImmediately,
        }),
      });

      const data = await res.json();
      if (data.success) {
        const processedInfo =
          typeof data.processedCount === "number" && data.processedCount > 0
            ? ` (${data.successCount}/${data.totalDeliveries} delivered immediately)`
            : " (queued in database)";
        setCampaignSuccessMsg(
          `Campaign "${generalTitle}" created [ID: ${data.campaignId}] with ${data.totalDeliveries} recipient deliveries${processedInfo}.`
        );
        setActiveTab("history");
        fetchCampaigns();
      } else {
        const errMsg = data.error || "Failed to create campaign.";
        setCampaignSubmitError(errMsg);
        alert(errMsg);
      }
    } catch (err: any) {
      const errMsg = err?.message || "Campaign submission failed.";
      setCampaignSubmitError(errMsg);
      alert(errMsg);
    } finally {
      setIsSubmittingCampaign(false);
    }
  }

  // Create Certificate Campaign
  async function handleCreateCertCampaign() {
    if (!certTitle.trim() || !certSubject.trim() || !certBodyHtml.trim()) {
      alert("Please enter title, subject, and message body.");
      return;
    }
    if (selectedCertKeys.size === 0) {
      alert("Please select at least one eligible certificate candidate.");
      return;
    }
    if (!sendIndividual && !sendTeamBackup) {
      alert("Please enable at least one delivery channel (Individual or Team Backup).");
      return;
    }

    setIsSubmittingCampaign(true);
    setCampaignSuccessMsg(null);
    setCampaignSubmitError(null);
    try {
      const res = await fetch("/api/admin/broadcast/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: certTitle,
          subject: certSubject,
          bodyHtml: certBodyHtml,
          campaignType: "certificate",
          selectedItemKeys: Array.from(selectedCertKeys),
          sendIndividual,
          sendTeamBackup,
          dispatchImmediately: certDispatchImmediately,
        }),
      });

      const data = await res.json();
      if (data.success) {
        const processedInfo =
          typeof data.processedCount === "number" && data.processedCount > 0
            ? ` (${data.successCount}/${data.totalDeliveries} delivered immediately)`
            : " (queued in database)";
        setCampaignSuccessMsg(
          `Certificate campaign created [ID: ${data.campaignId}] with ${data.totalCertificates} issued certificates and ${data.totalDeliveries} email deliveries${processedInfo}.`
        );
        setActiveTab("history");
        fetchCampaigns();
      } else {
        const errMsg = data.error || "Failed to create certificate campaign.";
        setCampaignSubmitError(errMsg);
        alert(errMsg);
      }
    } catch (err: any) {
      const errMsg = err?.message || "Certificate campaign submission failed.";
      setCampaignSubmitError(errMsg);
      alert(errMsg);
    } finally {
      setIsSubmittingCampaign(false);
    }
  }

  // Preview Sample Certificate PDF
  async function handlePreviewCertificatePdf() {
    setPreviewPdfLoading(true);
    try {
      const res = await fetch("/api/admin/broadcast/certificates/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientName: "Jashandeep Singh",
          eventName: "RoboWars: National Championship 2026",
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to generate certificate preview.");
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch (err: any) {
      alert(err?.message || "Preview error");
    } finally {
      setPreviewPdfLoading(false);
    }
  }

  // Process Batch Worker
  async function handleProcessBatch(campaignId: string) {
    setIsProcessingBatch(true);
    setBatchResult(null);
    try {
      const res = await fetch(
        `/api/admin/broadcast/campaigns/${campaignId}/process-batch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchSize: 10 }),
        }
      );

      const data = await res.json();
      if (data.success) {
        setBatchResult(
          `Processed ${data.processedCount} deliveries (${data.successCount} sent, ${data.failureCount} failed).`
        );
        loadCampaignDetails(campaignId);
        fetchCampaigns();
      } else {
        alert(data.error || "Batch execution failed.");
      }
    } catch (err: any) {
      alert(err?.message || "Error processing batch");
    } finally {
      setIsProcessingBatch(false);
    }
  }

  // Retry Failed
  async function handleRetryDelivery(campaignId: string, deliveryId: string) {
    try {
      const res = await fetch(
        `/api/admin/broadcast/campaigns/${campaignId}/retry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deliveryIds: [deliveryId],
            action: "retry_failed",
          }),
        }
      );
      const data = await res.json();
      if (data.success) {
        loadCampaignDetails(campaignId);
        fetchCampaigns();
      } else {
        alert(data.error || "Retry failed");
      }
    } catch (err) {
      console.error(err);
    }
  }

  if (isAdminChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f5f3] text-black">
        <div className="flex items-center gap-3 text-sm font-semibold text-black/60 font-mono">
          <RefreshCw className="animate-spin text-black" size={18} />
          <span>Verifying Master Admin Authorization...</span>
        </div>
      </div>
    );
  }

  if (!isMaster) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f5f3] p-6 text-black">
        <div className="max-w-md rounded-3xl border border-black/10 bg-white p-8 text-center text-black shadow-[0_20px_80px_rgba(0,0,0,0.04)]">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-600 border border-rose-100">
            <ShieldAlert size={28} />
          </div>
          <h2 className="text-xl font-semibold text-black">Master Admin Privilege Required</h2>
          <p className="mt-2 text-sm text-black/50 leading-relaxed">
            This module contains privileged email broadcasting and certificate issuance capabilities. Only authorized Master Administrators with verified MFA may access this section.
          </p>
          <button
            onClick={() => router.push("/admin")}
            className="mt-6 rounded-full bg-black px-6 py-2.5 text-xs font-semibold text-white hover:bg-neutral-800 transition"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f5f3] px-5 py-10 text-black md:px-10 lg:px-16 selection:bg-black selection:text-white">
      <div className="mx-auto max-w-[1500px]">
        {/* HEADER */}
        <header className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-black/40">
              Saviskar 2026
            </p>
            <h1 className="text-4xl font-semibold tracking-[-0.06em] md:text-5xl lg:text-6xl text-black">
              Email Broadcast & Certificates
            </h1>
            <p className="mt-4 text-sm text-black/45">
              Authoritative Master Admin campaign dispatch, recipient filtering, and participation certificate issuance.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => router.push("/admin")}
              className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-2.5 text-xs font-semibold text-black/70 shadow-xs transition hover:bg-black/[0.04] hover:text-black"
            >
              <ArrowLeft size={14} />
              <span>Dashboard</span>
            </button>
            <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-black/70 shadow-xs">
              <span className="h-2 w-2 rounded-full bg-black/70" />
              <span>Master Admin Mode</span>
            </div>
          </div>
        </header>

        {/* PREVIEW MODE INDICATOR */}
        {isPreviewMode && (
          <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-5 py-3.5 text-xs text-amber-950 shadow-xs">
            <div className="flex items-center gap-2.5">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="font-semibold tracking-tight">
                PREVIEW DEPLOYMENT — SAFE SYNTHETIC MODE (REAL DATA ACCESS &amp; DISPATCHES DISABLED)
              </span>
            </div>
            <span className="self-start md:self-auto rounded-full border border-amber-500/20 bg-white/80 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-900 shadow-xs">
              Preview Read-Only
            </span>
          </div>
        )}

        {/* HYBRID MODE INDICATOR */}
        {isHybridMode && (
          <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-2xl border border-black/15 bg-black/[0.03] px-5 py-3.5 text-xs font-mono text-black shadow-xs">
            <div className="flex items-center gap-2.5">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-bold tracking-tight">
                DEVELOPMENT MODE — LIVE REGISTRATION DATA (READ ONLY) · LOCAL CAMPAIGN STORAGE · MOCK EMAIL DELIVERY
              </span>
            </div>
            <span className="self-start md:self-auto rounded-full border border-black/10 bg-white px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black/60 shadow-xs">
              Hybrid Safe Mode
            </span>
          </div>
        )}

        {/* TABS PILL BAR */}
        <div className="mb-8 flex flex-wrap items-center gap-2 rounded-full border border-black/10 bg-white p-1.5 shadow-[0_20px_80px_rgba(0,0,0,0.04)]">
          <button
            onClick={() => setActiveTab("general")}
            className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-xs md:text-sm font-semibold transition ${
              activeTab === "general"
                ? "bg-black text-white shadow-sm"
                : "text-black/50 hover:text-black hover:bg-black/[0.04]"
            }`}
          >
            <Mail size={15} />
            <span>General Email Broadcast</span>
          </button>

          <button
            onClick={() => setActiveTab("certificate")}
            className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-xs md:text-sm font-semibold transition ${
              activeTab === "certificate"
                ? "bg-black text-white shadow-sm"
                : "text-black/50 hover:text-black hover:bg-black/[0.04]"
            }`}
          >
            <Award size={15} />
            <span>Participation Certificates</span>
          </button>

          <button
            onClick={() => setActiveTab("history")}
            className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-xs md:text-sm font-semibold transition ${
              activeTab === "history"
                ? "bg-black text-white shadow-sm"
                : "text-black/50 hover:text-black hover:bg-black/[0.04]"
            }`}
          >
            <Clock size={15} />
            <span>Campaign History & Queue</span>
            {campaigns.length > 0 && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  activeTab === "history"
                    ? "bg-white/20 text-white"
                    : "bg-black/5 text-black/60"
                }`}
              >
                {campaigns.length}
              </span>
            )}
          </button>
        </div>

        {/* ALERT FEEDBACK */}
        {campaignSuccessMsg && (
          <div className="mb-6 flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800">
            <div className="flex items-center gap-2.5 font-medium">
              <CheckCircle2 size={18} className="text-emerald-700 shrink-0" />
              <span>{campaignSuccessMsg}</span>
            </div>
            <button
              onClick={() => setCampaignSuccessMsg(null)}
              className="text-xs font-semibold text-emerald-900 hover:underline shrink-0 ml-4"
            >
              Dismiss
            </button>
          </div>
        )}

        {campaignSubmitError && (
          <div className="mb-6 flex items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800">
            <div className="flex items-center gap-2.5 font-medium">
              <XCircle size={18} className="text-rose-700 shrink-0" />
              <span>{campaignSubmitError}</span>
            </div>
            <button
              onClick={() => setCampaignSubmitError(null)}
              className="text-xs font-semibold text-rose-900 hover:underline shrink-0 ml-4"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* TAB 1: GENERAL BROADCAST */}
        {activeTab === "general" && (
          <div className="space-y-6">
            {/* Composer Card */}
            <div className="rounded-3xl border border-black/10 bg-white p-6 md:p-8 shadow-[0_20px_80px_rgba(0,0,0,0.04)]">
              <h2 className="text-base md:text-lg font-semibold text-black mb-1 flex items-center gap-2">
                <FileText size={18} className="text-black/70" />
                <span>Compose General Broadcast</span>
              </h2>
              <p className="text-xs text-black/45 mb-6">
                Send official announcements and notices to verified Saviskar delegates and participants.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-black/60 mb-2">
                    Internal Campaign Title
                  </label>
                  <input
                    type="text"
                    value={generalTitle}
                    onChange={(e) => setGeneralTitle(e.target.value)}
                    placeholder="e.g. Saviskar 2026 Day 1 Schedule & Guidelines"
                    className="w-full rounded-2xl border border-black/10 bg-black/[0.02] px-4 py-2.5 text-sm text-black placeholder:text-black/35 focus:border-black focus:bg-white focus:outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-black/60 mb-2">
                    Email Subject
                  </label>
                  <input
                    type="text"
                    value={generalSubject}
                    onChange={(e) => setGeneralSubject(e.target.value)}
                    placeholder="e.g. Important: Saviskar 2026 General Instructions"
                    className="w-full rounded-2xl border border-black/10 bg-black/[0.02] px-4 py-2.5 text-sm text-black placeholder:text-black/35 focus:border-black focus:bg-white focus:outline-none transition"
                  />
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-black/60 mb-2">
                  Message Content (HTML Supported)
                </label>
                <textarea
                  rows={6}
                  value={generalBodyHtml}
                  onChange={(e) => setGeneralBodyHtml(e.target.value)}
                  className="w-full rounded-2xl border border-black/10 bg-black/[0.02] p-4 font-mono text-xs text-black placeholder:text-black/35 focus:border-black focus:bg-white focus:outline-none transition leading-relaxed"
                />
              </div>

              <div className="mb-3 rounded-2xl border border-black/10 bg-black/[0.02] p-3">
                <label className="flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-black/80 select-none">
                  <input
                    type="checkbox"
                    checked={generalDispatchImmediately}
                    onChange={(e) => setGeneralDispatchImmediately(e.target.checked)}
                    className="h-4 w-4 rounded border-black/20 text-black focus:ring-0 accent-black cursor-pointer"
                  />
                  <span>Begin dispatch immediately upon creation (sends first batch of up to 25 emails)</span>
                </label>
                <p className="mt-1 text-[11px] text-black/50 pl-6">
                  When unchecked, the campaign is enqueued safely in the database for review before manual dispatch via &ldquo;Process Queue&rdquo;.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
                <div className="text-xs text-black/50">
                  Dedicated Sender:{" "}
                  <code className="rounded bg-black/[0.04] px-1.5 py-0.5 font-mono text-black/70 border border-black/5">
                    RESEND_CAMPAIGN_FROM_EMAIL
                  </code>{" "}
                  (Isolated from transactional emails)
                </div>
                <button
                  type="button"
                  onClick={handleCreateGeneralCampaign}
                  disabled={isSubmittingCampaign || isPreviewMode || selectedGeneralEmails.size === 0}
                  className="flex items-center justify-center gap-2 rounded-full bg-black px-6 py-2.5 text-xs md:text-sm font-semibold text-white shadow-sm transition hover:scale-[1.01] hover:bg-neutral-800 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Send size={15} />
                  <span>
                    {isPreviewMode
                      ? "Enqueue Disabled (Preview Mode)"
                      : `Enqueue Campaign (${selectedGeneralEmails.size} Recipients)`}
                  </span>
                </button>
              </div>
            </div>

            {/* Recipient Selection Card */}
            <div className="rounded-3xl border border-black/10 bg-white p-6 md:p-8 shadow-[0_20px_80px_rgba(0,0,0,0.04)]">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-sm md:text-base font-semibold text-black">Select Broadcast Recipients</h3>
                  <p className="text-xs text-black/45 mt-0.5">
                    Includes active event registrants, team members (with or without separate profiles), and active accommodation participants. Deduplicated by normalized email.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-black/10 bg-black/[0.03] px-3 py-1.5 text-xs font-mono font-medium text-black/70">
                    Selected: {selectedGeneralEmails.size} / {filteredGeneralRecipients.length}
                  </span>
                  <button
                    onClick={() => {
                      const valid = new Set(
                        filteredGeneralRecipients.filter((r) => r.isValidEmail).map((r) => r.normalizedEmail)
                      );
                      setSelectedGeneralEmails(valid);
                    }}
                    className="rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs font-semibold text-black/70 shadow-xs hover:bg-black/[0.04] hover:text-black transition"
                  >
                    Select All Valid
                  </button>
                  <button
                    onClick={() => setSelectedGeneralEmails(new Set())}
                    className="rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs font-semibold text-black/70 shadow-xs hover:bg-black/[0.04] hover:text-black transition"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="relative flex-1 min-w-[240px]">
                  <Search size={14} className="absolute left-3.5 top-3 text-black/35" />
                  <input
                    type="text"
                    value={generalSearch}
                    onChange={(e) => setGeneralSearch(e.target.value)}
                    placeholder="Search by participant name or email..."
                    className="w-full rounded-full border border-black/10 bg-black/[0.02] pl-9 pr-4 py-2 text-xs text-black placeholder:text-black/35 focus:border-black focus:bg-white focus:outline-none transition"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-black/45 flex items-center gap-1 mr-1">
                    <Filter size={12} /> Source:
                  </span>
                  {["all", "event", "team_member", "accommodation"].map((source) => {
                    const active = generalSourceFilter === source;
                    return (
                      <button
                        key={source}
                        onClick={() => setGeneralSourceFilter(source)}
                        className={`rounded-full px-3 py-1 text-[11px] font-semibold capitalize transition border ${
                          active
                            ? "border-black bg-black text-white shadow-xs"
                            : "border-black/10 bg-black/[0.02] text-black/60 hover:bg-black/[0.06] hover:text-black"
                        }`}
                      >
                        {source.replace("_", " ")}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Recipients Table */}
              <div className="max-h-96 overflow-y-auto rounded-2xl border border-black/10 bg-white shadow-xs">
                {isLoadingRecipients ? (
                  <div className="py-16 text-center text-xs text-black/50 font-mono flex items-center justify-center gap-2">
                    <RefreshCw className="animate-spin text-black" size={14} />
                    <span>Loading deduplicated recipients across event, team, and accommodation datasets...</span>
                  </div>
                ) : generalRecipientsError ? (
                  <div className="py-8 px-6 text-center text-xs text-rose-600 bg-rose-50/50 rounded-xl m-4 border border-rose-100">
                    <p className="font-semibold">{generalRecipientsError}</p>
                    <button
                      onClick={fetchGeneralRecipients}
                      className="mt-3 rounded-full bg-black px-4 py-1.5 text-[11px] font-semibold text-white hover:bg-neutral-800 transition"
                    >
                      Retry Fetch
                    </button>
                  </div>
                ) : filteredGeneralRecipients.length === 0 ? (
                  <div className="py-16 text-center text-xs text-black/40 font-mono">
                    No broadcast recipients match the selected filters.
                  </div>
                ) : (
                  <table className="w-full text-left text-xs text-black/80">
                    <thead className="sticky top-0 bg-[#fbfbfb] border-b border-black/10 text-[11px] font-bold uppercase tracking-wider text-black/50 z-10">
                      <tr>
                        <th className="p-3.5 w-10 text-center">
                          <input
                            type="checkbox"
                            checked={
                              filteredGeneralRecipients.length > 0 &&
                              filteredGeneralRecipients.every((r) => selectedGeneralEmails.has(r.normalizedEmail))
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                const set = new Set(selectedGeneralEmails);
                                filteredGeneralRecipients.forEach((r) => {
                                  if (r.isValidEmail) set.add(r.normalizedEmail);
                                });
                                setSelectedGeneralEmails(set);
                              } else {
                                const set = new Set(selectedGeneralEmails);
                                filteredGeneralRecipients.forEach((r) => set.delete(r.normalizedEmail));
                                setSelectedGeneralEmails(set);
                              }
                            }}
                            className="h-4 w-4 rounded border-black/20 text-black focus:ring-0 accent-black cursor-pointer"
                          />
                        </th>
                        <th className="p-3.5 w-14 font-bold text-black/50">S. No.</th>
                        <th className="p-3.5 font-bold">Participant Name</th>
                        <th className="p-3.5 font-bold">Email Address</th>
                        <th className="p-3.5 font-bold">Sources</th>
                        <th className="p-3.5 font-bold text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5 bg-white">
                      {filteredGeneralRecipients.map((r, idx) => {
                        const isSelected = selectedGeneralEmails.has(r.normalizedEmail);
                        return (
                          <tr
                            key={r.normalizedEmail}
                            onClick={() => {
                              if (!r.isValidEmail) return;
                              const set = new Set(selectedGeneralEmails);
                              if (isSelected) set.delete(r.normalizedEmail);
                              else set.add(r.normalizedEmail);
                              setSelectedGeneralEmails(set);
                            }}
                            className={`cursor-pointer transition hover:bg-black/[0.015] ${
                              isSelected ? "bg-black/[0.03]" : ""
                            }`}
                          >
                            <td className="p-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={!r.isValidEmail}
                                onChange={() => {
                                  const set = new Set(selectedGeneralEmails);
                                  if (isSelected) set.delete(r.normalizedEmail);
                                  else set.add(r.normalizedEmail);
                                  setSelectedGeneralEmails(set);
                                }}
                                className="h-4 w-4 rounded border-black/20 text-black focus:ring-0 accent-black cursor-pointer"
                              />
                            </td>
                            <td className="p-3.5 text-black/45 font-mono text-xs">{idx + 1}</td>
                            <td className="p-3.5 font-semibold text-black">
                              <div className="flex items-center gap-2">
                                <span>{r.name}</span>
                                {r.normalizedEmail.endsWith("@saviskar.test") ? (
                                  <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[9px] font-bold text-blue-800 uppercase tracking-wide">
                                    Test Fixture
                                  </span>
                                ) : isHybridMode ? (
                                  <span className="inline-flex items-center rounded-full border border-black/10 bg-black/5 px-2 py-0.5 text-[9px] font-medium text-black/50">
                                    Live (Read-Only)
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td className="p-3.5 font-mono text-black/60">{r.originalEmail}</td>
                            <td className="p-3.5">
                              <div className="flex flex-wrap gap-1">
                                {r.sources.map((s) => (
                                  <span
                                    key={s}
                                    className="rounded-md border border-black/10 bg-black/[0.03] px-2 py-0.5 text-[10px] font-semibold text-black/70 capitalize"
                                  >
                                    {s.replace("_", " ")}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="p-3.5 text-right">
                              {r.isValidEmail ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                                  Valid
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[10px] font-bold text-rose-800">
                                  <AlertTriangle size={11} /> Invalid Email
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: PARTICIPATION CERTIFICATES */}
        {activeTab === "certificate" && (
          <div className="space-y-6">
            {/* Header info banner */}
            <div className="rounded-3xl border border-black/10 bg-white p-6 md:p-8 shadow-[0_20px_80px_rgba(0,0,0,0.04)]">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-base md:text-lg font-semibold text-black mb-1 flex items-center gap-2">
                    <Award size={20} className="text-black/70" />
                    <span>Saviskar 2026 Participation Certificate Engine</span>
                  </h2>
                  <p className="text-xs text-black/50 leading-relaxed max-w-2xl">
                    Strictly requires authoritative Main Registration Desk Check-In (
                    <code className="rounded bg-black/[0.04] px-1 py-0.5 font-mono text-black/70 border border-black/5">
                      main_checked_in = true
                    </code>
                    ) and validated payment completion (via{" "}
                    <code className="rounded bg-black/[0.04] px-1 py-0.5 font-mono text-black/70 border border-black/5">
                      evaluateEventPaymentStatus()
                    </code>
                    ). Generates 1 individual PDF per person-event.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handlePreviewCertificatePdf}
                    disabled={previewPdfLoading}
                    className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-2.5 text-xs font-semibold text-black/70 shadow-xs hover:bg-black/[0.04] hover:text-black transition disabled:opacity-50"
                  >
                    {previewPdfLoading ? (
                      <RefreshCw size={14} className="animate-spin text-black" />
                    ) : (
                      <Eye size={14} />
                    )}
                    <span>Preview Certificate PDF</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Campaign Options & Delivery Channels */}
            <div className="rounded-3xl border border-black/10 bg-white p-6 md:p-8 shadow-[0_20px_80px_rgba(0,0,0,0.04)]">
              <h3 className="text-sm md:text-base font-semibold text-black mb-1">
                Delivery Channels & Campaign Parameters
              </h3>
              <p className="text-xs text-black/45 mb-6">
                Configure delivery channels for individual candidates and team backup archives.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-black/60 mb-2">
                    Campaign Title
                  </label>
                  <input
                    type="text"
                    value={certTitle}
                    onChange={(e) => setCertTitle(e.target.value)}
                    className="w-full rounded-2xl border border-black/10 bg-black/[0.02] px-4 py-2.5 text-sm text-black placeholder:text-black/35 focus:border-black focus:bg-white focus:outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-black/60 mb-2">
                    Email Subject
                  </label>
                  <input
                    type="text"
                    value={certSubject}
                    onChange={(e) => setCertSubject(e.target.value)}
                    className="w-full rounded-2xl border border-black/10 bg-black/[0.02] px-4 py-2.5 text-sm text-black placeholder:text-black/35 focus:border-black focus:bg-white focus:outline-none transition"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6 rounded-2xl border border-black/10 bg-black/[0.02] p-4 mb-4">
                <label className="flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-black/80 select-none">
                  <input
                    type="checkbox"
                    checked={sendIndividual}
                    onChange={(e) => setSendIndividual(e.target.checked)}
                    className="h-4 w-4 rounded border-black/20 text-black focus:ring-0 accent-black cursor-pointer"
                  />
                  <span>Send individual PDF to member&apos;s personal email</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-black/80 select-none">
                  <input
                    type="checkbox"
                    checked={sendTeamBackup}
                    onChange={(e) => setSendTeamBackup(e.target.checked)}
                    className="h-4 w-4 rounded border-black/20 text-black focus:ring-0 accent-black cursor-pointer"
                  />
                  <span>Send registered team backup email with all team certificates to team contact</span>
                </label>
              </div>

              <div className="mb-3 rounded-2xl border border-black/10 bg-black/[0.02] p-3">
                <label className="flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-black/80 select-none">
                  <input
                    type="checkbox"
                    checked={certDispatchImmediately}
                    onChange={(e) => setCertDispatchImmediately(e.target.checked)}
                    className="h-4 w-4 rounded border-black/20 text-black focus:ring-0 accent-black cursor-pointer"
                  />
                  <span>Begin dispatch immediately upon creation (sends first batch of up to 25 emails)</span>
                </label>
                <p className="mt-1 text-[11px] text-black/50 pl-6">
                  When unchecked, certificates are generated and queued in the database. You can review certificates before manual dispatch via &ldquo;Process Queue&rdquo;.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
                <div className="text-xs text-black/50">
                  Eligible Selected:{" "}
                  <span className="font-mono font-bold text-black">{selectedCertKeys.size}</span> items
                </div>
                <button
                  type="button"
                  onClick={handleCreateCertCampaign}
                  disabled={isSubmittingCampaign || isPreviewMode || selectedCertKeys.size === 0}
                  className="flex items-center justify-center gap-2 rounded-full bg-black px-6 py-2.5 text-xs md:text-sm font-semibold text-white shadow-sm transition hover:scale-[1.01] hover:bg-neutral-800 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Send size={15} />
                  <span>
                    {isPreviewMode
                      ? "Enqueue Disabled (Preview Mode)"
                      : "Enqueue Certificate Campaign"}
                  </span>
                </button>
              </div>
            </div>

            {/* Candidates Table Card */}
            <div className="rounded-3xl border border-black/10 bg-white p-6 md:p-8 shadow-[0_20px_80px_rgba(0,0,0,0.04)]">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-sm md:text-base font-semibold text-black">
                    Certificate Eligibility & Candidate Roster
                  </h3>
                  <p className="text-xs text-black/45 mt-0.5">
                    Each row represents a distinct person-event certificate. Only registrations marked &ldquo;Eligible&rdquo; qualify.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => {
                      const eligible = new Set(
                        filteredCertCandidates
                          .filter((c) => c.certificateEligible)
                          .map((c) => c.issueSourceKey)
                      );
                      setSelectedCertKeys(eligible);
                    }}
                    className="rounded-full border border-black bg-black px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-neutral-800 transition"
                  >
                    Select All Eligible ({filteredCertCandidates.filter((c) => c.certificateEligible).length})
                  </button>
                  <button
                    onClick={() => setSelectedCertKeys(new Set())}
                    className="rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs font-semibold text-black/70 shadow-xs hover:bg-black/[0.04] hover:text-black transition"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="relative flex-1 min-w-[240px]">
                  <Search size={14} className="absolute left-3.5 top-3 text-black/35" />
                  <input
                    type="text"
                    value={certSearch}
                    onChange={(e) => setCertSearch(e.target.value)}
                    placeholder="Search candidate name, event, team or email..."
                    className="w-full rounded-full border border-black/10 bg-black/[0.02] pl-9 pr-4 py-2 text-xs text-black placeholder:text-black/35 focus:border-black focus:bg-white focus:outline-none transition"
                  />
                </div>

                <select
                  value={certEventFilter}
                  onChange={(e) => setCertEventFilter(e.target.value)}
                  className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-black focus:border-black focus:outline-none cursor-pointer shadow-xs"
                >
                  <option value="all">All Events</option>
                  {uniqueEvents.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name}
                    </option>
                  ))}
                </select>

                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-black/70 rounded-full border border-black/10 bg-white px-4 py-2 shadow-xs select-none">
                  <input
                    type="checkbox"
                    checked={certMainCheckInOnly}
                    onChange={(e) => setCertMainCheckInOnly(e.target.checked)}
                    className="h-4 w-4 rounded border-black/20 text-black focus:ring-0 accent-black cursor-pointer"
                  />
                  <span>Main Checked-In Only</span>
                </label>
              </div>

              {/* Candidates Table */}
              <div className="max-h-96 overflow-y-auto rounded-2xl border border-black/10 bg-white shadow-xs">
                {isLoadingCandidates ? (
                  <div className="py-16 text-center text-xs text-black/50 font-mono flex items-center justify-center gap-2">
                    <RefreshCw className="animate-spin text-black" size={14} />
                    <span>Loading certificate candidates and evaluating authoritative eligibility...</span>
                  </div>
                ) : certCandidatesError ? (
                  <div className="py-8 px-6 text-center text-xs text-rose-600 bg-rose-50/50 rounded-xl m-4 border border-rose-100">
                    <p className="font-semibold">{certCandidatesError}</p>
                    <button
                      onClick={fetchCertificateCandidates}
                      className="mt-3 rounded-full bg-black px-4 py-1.5 text-[11px] font-semibold text-white hover:bg-neutral-800 transition"
                    >
                      Retry Fetch
                    </button>
                  </div>
                ) : filteredCertCandidates.length === 0 ? (
                  <div className="py-16 text-center text-xs text-black/40 font-mono">
                    No certificate candidates match the selected filters.
                  </div>
                ) : (
                  <table className="w-full text-left text-xs text-black/80">
                    <thead className="sticky top-0 bg-[#fbfbfb] border-b border-black/10 text-[11px] font-bold uppercase tracking-wider text-black/50 z-10">
                      <tr>
                        <th className="p-3.5 w-10 text-center">
                          <input
                            type="checkbox"
                            checked={
                              filteredCertCandidates.length > 0 &&
                              filteredCertCandidates
                                .filter((c) => c.certificateEligible)
                                .every((c) => selectedCertKeys.has(c.issueSourceKey))
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                const set = new Set(selectedCertKeys);
                                filteredCertCandidates.forEach((c) => {
                                  if (c.certificateEligible) set.add(c.issueSourceKey);
                                });
                                setSelectedCertKeys(set);
                              } else {
                                const set = new Set(selectedCertKeys);
                                filteredCertCandidates.forEach((c) => set.delete(c.issueSourceKey));
                                setSelectedCertKeys(set);
                              }
                            }}
                            className="h-4 w-4 rounded border-black/20 text-black focus:ring-0 accent-black cursor-pointer"
                          />
                        </th>
                        <th className="p-3.5 w-14 font-bold text-black/50">S. No.</th>
                        <th className="p-3.5 font-bold">Recipient Name</th>
                        <th className="p-3.5 font-bold">Event Name</th>
                        <th className="p-3.5 font-bold">Roster / Team</th>
                        <th className="p-3.5 font-bold">Main Desk Check-In</th>
                        <th className="p-3.5 font-bold">Payment Status</th>
                        <th className="p-3.5 font-bold text-right">Eligibility</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5 bg-white">
                      {filteredCertCandidates.map((c, idx) => {
                        const isSelected = selectedCertKeys.has(c.issueSourceKey);
                        return (
                          <tr
                            key={c.issueSourceKey}
                            onClick={() => {
                              if (!c.certificateEligible) return;
                              const set = new Set(selectedCertKeys);
                              if (isSelected) set.delete(c.issueSourceKey);
                              else set.add(c.issueSourceKey);
                              setSelectedCertKeys(set);
                            }}
                            className={`cursor-pointer transition hover:bg-black/[0.015] ${
                              isSelected ? "bg-black/[0.03]" : ""
                            }`}
                          >
                            <td className="p-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={!c.certificateEligible}
                                onChange={() => {
                                  const set = new Set(selectedCertKeys);
                                  if (isSelected) set.delete(c.issueSourceKey);
                                  else set.add(c.issueSourceKey);
                                  setSelectedCertKeys(set);
                                }}
                                className="h-4 w-4 rounded border-black/20 text-black focus:ring-0 accent-black cursor-pointer"
                              />
                            </td>
                            <td className="p-3.5 text-black/45 font-mono text-xs">{idx + 1}</td>
                            <td className="p-3.5">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-black">{c.recipientName}</span>
                                {c.issueSourceKey.startsWith("synth_") || c.recipientEmail?.endsWith("@saviskar.test") ? (
                                  <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[9px] font-bold text-blue-800 uppercase tracking-wide">
                                    Test Fixture
                                  </span>
                                ) : isHybridMode ? (
                                  <span className="inline-flex items-center rounded-full border border-black/10 bg-black/5 px-2 py-0.5 text-[9px] font-medium text-black/50">
                                    Live (Read-Only)
                                  </span>
                                ) : null}
                              </div>
                              {c.recipientEmail && (
                                <div className="font-mono text-[10px] text-black/50">{c.recipientEmail}</div>
                              )}
                            </td>
                            <td className="p-3.5 font-medium text-black/80">{c.eventName}</td>
                            <td className="p-3.5">
                              {c.isTeam ? (
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-black">{c.teamName}</span>
                                  {c.isTeamLeader && (
                                    <span className="rounded-full border border-black/10 bg-black text-white px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider">
                                      Leader
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-black/40 text-xs">Solo</span>
                              )}
                            </td>
                            <td className="p-3.5">
                              {c.mainCheckedIn ? (
                                <div className="flex flex-col">
                                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800 w-fit">
                                    <CheckCircle2 size={10} /> Checked-In
                                  </span>
                                  {c.mainCheckedInAt && (
                                    <span className="font-mono text-[9px] text-black/45 mt-0.5">
                                      {new Date(c.mainCheckedInAt).toLocaleString(undefined, {
                                        month: "short",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                                  <XCircle size={10} /> {c.eventCheckedIn ? "Arena Only" : "Not Checked-In"}
                                </span>
                              )}
                            </td>
                            <td className="p-3.5">
                              {c.isFree ? (
                                <span className="inline-flex items-center rounded-full border border-black/10 bg-black/5 px-2 py-0.5 text-[10px] font-bold text-black/70">
                                  Free Event
                                </span>
                              ) : c.isPaymentComplete ? (
                                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                                  Paid Complete
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                                  {c.paymentStatus || "Unpaid"}
                                </span>
                              )}
                            </td>
                            <td className="p-3.5 text-right">
                              {c.certificateEligible ? (
                                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-bold text-emerald-800 text-[11px]">
                                  Eligible
                                </span>
                              ) : (
                                <div className="flex flex-col items-end">
                                  <span className="inline-flex items-center rounded-full border border-black/10 bg-black/5 px-2.5 py-0.5 font-semibold text-black/60 text-[10px]">
                                    Ineligible
                                  </span>
                                  {c.ineligibilityReason && (
                                    <span
                                      className="text-[10px] text-rose-600 mt-1 max-w-[220px] text-right font-medium leading-tight"
                                      title={c.ineligibilityReason}
                                    >
                                      {c.ineligibilityReason}
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: CAMPAIGN HISTORY & QUEUE */}
        {activeTab === "history" && (
          <div className="space-y-6">
            <div className="rounded-3xl border border-black/10 bg-white p-6 md:p-8 shadow-[0_20px_80px_rgba(0,0,0,0.04)]">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm md:text-base font-semibold text-black">Broadcast Campaign History</h2>
                  <p className="text-xs text-black/45 mt-0.5">
                    Durable queue state, deliveries and selective worker triggers.
                  </p>
                </div>
                <button
                  onClick={fetchCampaigns}
                  className="flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-black/70 shadow-xs hover:bg-black/[0.04] hover:text-black transition"
                >
                  <RefreshCw size={12} />
                  <span>Refresh Campaigns</span>
                </button>
              </div>

              {campaignSchemaWarning && (
                <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 text-xs font-mono text-amber-900 flex items-start gap-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-700" />
                  <div>
                    <span className="font-bold">Schema Notice: </span>
                    {campaignSchemaWarning}
                  </div>
                </div>
              )}

              {campaignError && (
                <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50/60 p-4 text-xs font-mono text-rose-900 flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <XCircle size={15} className="mt-0.5 shrink-0 text-rose-600" />
                    <div>
                      <span className="font-bold">Campaign API Error: </span>
                      {campaignError}
                    </div>
                  </div>
                  <button
                    onClick={fetchCampaigns}
                    className="rounded-full bg-black px-3 py-1 text-[11px] font-semibold text-white hover:bg-neutral-800 transition shrink-0"
                  >
                    Retry
                  </button>
                </div>
              )}

              {batchResult && (
                <div className="mb-4 rounded-2xl border border-black/10 bg-black/[0.02] p-3 text-xs font-mono text-black">
                  {batchResult}
                </div>
              )}

              {isLoadingCampaigns ? (
                <div className="py-16 text-center text-xs text-black/50 font-mono flex items-center justify-center gap-2">
                  <RefreshCw className="animate-spin text-black" size={14} />
                  <span>Loading campaign history and queue state...</span>
                </div>
              ) : campaigns.length === 0 ? (
                <div className="py-12 text-center text-sm text-black/40 font-mono">
                  No broadcast campaigns created yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {campaigns.map((camp, idx) => (
                    <div
                      key={camp.id}
                      className={`rounded-2xl border p-5 transition ${
                        selectedCampaignId === camp.id
                          ? "border-2 border-black bg-black/[0.015] shadow-sm"
                          : "border-black/10 bg-white shadow-xs hover:border-black/20"
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full border border-black/10 bg-black/5 px-2.5 py-0.5 text-[10px] font-mono text-black/60">
                              #{idx + 1}
                            </span>
                            <h3 className="text-sm font-bold text-black">{camp.title}</h3>
                            <span className="rounded-full border border-black/10 bg-black/5 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black/70">
                              {camp.campaign_type}
                            </span>
                            <span
                              className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${
                                camp.status === "completed"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                  : camp.status === "failed"
                                  ? "border-rose-200 bg-rose-50 text-rose-800"
                                  : "border-amber-200 bg-amber-50 text-amber-800"
                              }`}
                            >
                              {camp.status}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-black/50 font-mono">
                            Subject: &ldquo;{camp.subject}&rdquo; • Created:{" "}
                            {new Date(camp.created_at).toLocaleString()}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <div className="text-right text-xs">
                            <div className="font-semibold text-black">
                              {camp.sent_count} / {camp.total_deliveries} Sent
                            </div>
                            {camp.failed_count > 0 && (
                              <div className="text-rose-600 font-medium">{camp.failed_count} Failed</div>
                            )}
                          </div>

                          <button
                            onClick={() => {
                              if (selectedCampaignId === camp.id) setSelectedCampaignId(null);
                              else loadCampaignDetails(camp.id);
                            }}
                            className="rounded-full border border-black/10 bg-white px-4 py-1.5 text-xs font-semibold text-black/70 shadow-xs hover:bg-black/[0.04] hover:text-black transition"
                          >
                            {selectedCampaignId === camp.id ? "Hide Details" : "View Deliveries"}
                          </button>

                          {camp.status !== "completed" ? (
                            <button
                              onClick={() => handleProcessBatch(camp.id)}
                              disabled={isProcessingBatch || isPreviewMode}
                              className="flex items-center gap-1.5 rounded-full bg-black px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-neutral-800 transition disabled:opacity-40"
                              title={isPreviewMode ? "Queue processing is disabled in Preview Mode" : undefined}
                            >
                              <Send size={12} />
                              <span>{isPreviewMode ? "Queue Locked (Preview)" : "Process Queue"}</span>
                            </button>
                          ) : (
                            <span className="flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-800">
                              <CheckCircle2 size={12} />
                              <span>Delivered</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Expanded Deliveries View */}
                      {selectedCampaignId === camp.id && (
                        <div className="mt-4 pt-4 border-t border-black/10">
                          <h4 className="text-xs font-bold text-black/70 uppercase tracking-wider mb-2">
                            Delivery Manifest & Progress
                          </h4>
                          {selectedCampaignDeliveries.length === 0 ? (
                            <div className="py-4 text-center text-xs text-black/40">Loading deliveries...</div>
                          ) : (
                            <div className="max-h-60 overflow-y-auto rounded-xl border border-black/10 bg-white">
                              <table className="w-full text-left text-xs text-black/80">
                                <thead className="sticky top-0 bg-[#fbfbfb] border-b border-black/10 text-[10px] font-bold uppercase tracking-wider text-black/50">
                                  <tr>
                                    <th className="p-2.5 w-12">S. No.</th>
                                    <th className="p-2.5">Recipient</th>
                                    <th className="p-2.5">Channel</th>
                                    <th className="p-2.5">Status</th>
                                    <th className="p-2.5">Attempts</th>
                                    <th className="p-2.5">Attachments</th>
                                    <th className="p-2.5 text-right">Action</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-black/5 font-mono text-[11px]">
                                  {selectedCampaignDeliveries.map((d, dIdx) => (
                                    <tr key={d.id} className="hover:bg-black/[0.015]">
                                      <td className="p-2.5 text-black/45 font-mono text-[10px]">{dIdx + 1}</td>
                                      <td className="p-2.5 font-medium text-black">{d.recipient_email}</td>
                                      <td className="p-2.5 capitalize">{d.channel}</td>
                                      <td className="p-2.5">
                                        <span
                                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                            d.status === "sent"
                                              ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                                              : d.status === "failed"
                                              ? "border border-rose-200 bg-rose-50 text-rose-800"
                                              : "border border-black/10 bg-black/5 text-black/70"
                                          }`}
                                        >
                                          {d.status}
                                        </span>
                                      </td>
                                      <td className="p-2.5">{d.attempts}</td>
                                      <td className="p-2.5">
                                        {d.broadcast_delivery_attachments?.length || 0} PDF(s)
                                      </td>
                                      <td className="p-2.5 text-right">
                                        {d.status === "failed" && (
                                          <button
                                            onClick={() => handleRetryDelivery(camp.id, d.id)}
                                            className="text-black font-semibold hover:underline"
                                          >
                                            Retry
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
