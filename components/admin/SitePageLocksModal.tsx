"use client";

import { useState, useEffect, useTransition, useMemo } from "react";
import {
  X,
  Lock,
  Unlock,
  ShieldAlert,
  ShieldCheck,
  ExternalLink,
  Search,
  RefreshCw,
  AlertTriangle,
  Sparkles,
  CalendarDays,
  UserCheck,
  Building2,
  FileText,
  Award,
  Users,
  Image as ImageIcon,
  CheckCircle2,
} from "lucide-react";
import {
  DEFAULT_SITE_ACCESS,
  type SitePageKey,
  type SiteAccessConfig,
} from "@/lib/config/site-access";

interface SitePageLocksModalProps {
  isOpen: boolean;
  onClose: () => void;
  isPrimary: boolean;
  siteAccess?: SiteAccessConfig | null;
  onUpdate?: (updatedLocks: SiteAccessConfig) => void;
}

const PAGE_CARDS: Array<{
  key: SitePageKey;
  name: string;
  path: string;
  category: string;
  moduleCode: string;
  description: string;
  icon: typeof Lock;
  color: string;
}> = [
  {
    key: "REGISTRATIONS_ENABLED",
    name: "Registration Portal",
    path: "/register",
    category: "Accreditation",
    moduleCode: "ACCREDITATION.SYS",
    description: "Public event registration, squad checkout, pass issuance, and registration API.",
    icon: UserCheck,
    color: "violet",
  },
  {
    key: "SCHEDULE_ENABLED",
    name: "Festival Schedule & Radar",
    path: "/schedule",
    category: "Timeline & Radar",
    moduleCode: "CHRONO.SYS",
    description: "Hourly competition timetables, campus stage coordinates, and event roadmap.",
    icon: CalendarDays,
    color: "blue",
  },
  {
    key: "STARNIGHT_ENABLED",
    name: "Star Night 2026",
    path: "/starnight",
    category: "Concert Arena",
    moduleCode: "STARNIGHT.SYS",
    description: "Celebrity headliner concert drops (Asees Kaur & Ranjit Bawa), past stages, lights out.",
    icon: Sparkles,
    color: "amber",
  },
  {
    key: "EVENT_DETAILS_ENABLED",
    name: "Event Detail Dossiers",
    path: "/events",
    category: "Competition Rules",
    moduleCode: "DOSSIER.SYS",
    description: "50+ competition detail pages, problem statements, prize pool manifests, direct registration CTA.",
    icon: FileText,
    color: "emerald",
  },
  {
    key: "SPONSORS_ENABLED",
    name: "Sponsors & Partners",
    path: "/sponsors",
    category: "Corporate Allies",
    moduleCode: "ALLIES.SYS",
    description: "Title partners, brand showcase, associate partners, corporate tier matrix.",
    icon: Building2,
    color: "indigo",
  },
  {
    key: "LEGACY_ENABLED",
    name: "Institutional Legacy",
    path: "/legacy",
    category: "Patron Citations",
    moduleCode: "LEGACY.ARCHIVE",
    description: "Founder manifests, chancellor archive, patron citations, and alumni heritage.",
    icon: Award,
    color: "rose",
  },
  {
    key: "TEAM_ENABLED",
    name: "Organising Team & SAC",
    path: "/team",
    category: "Executive Council",
    moduleCode: "COUNCIL.SYS",
    description: "Faculty leadership, domain heads, 54-member Student Advisory Council (SAC).",
    icon: Users,
    color: "cyan",
  },
  {
    key: "GALLERY_ENABLED",
    name: "Campus Media Gallery",
    path: "/gallery",
    category: "Visual Vault",
    moduleCode: "VAULT.SYS",
    description: "Festival photos, cinematic recap films, stage highlights, and media vaults.",
    icon: ImageIcon,
    color: "fuchsia",
  },
];

export function SitePageLocksModal({
  isOpen,
  onClose,
  isPrimary,
  siteAccess,
  onUpdate,
}: SitePageLocksModalProps) {
  const [locks, setLocks] = useState<SiteAccessConfig>(siteAccess || DEFAULT_SITE_ACCESS);
  const [togglingKey, setTogglingKey] = useState<SitePageKey | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Sync when prop updates
  useEffect(() => {
    if (siteAccess) {
      setLocks(siteAccess);
    }
  }, [siteAccess]);

  // Ensure fresh locks on modal open
  useEffect(() => {
    if (isOpen) {
      fetch("/api/admin/site-access")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.siteAccess) {
            setLocks(data.siteAccess);
            onUpdate?.(data.siteAccess);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, onUpdate]);

  const filteredCards = useMemo(() => {
    if (!searchQuery.trim()) return PAGE_CARDS;
    const q = searchQuery.toLowerCase();
    return PAGE_CARDS.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.path.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.moduleCode.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const lockedCount = useMemo(() => {
    return Object.values(locks).filter((v) => !v).length;
  }, [locks]);

  const unlockedCount = useMemo(() => {
    return Object.values(locks).filter((v) => v).length;
  }, [locks]);

  const handleToggle = async (key: SitePageKey, currentEnabled: boolean) => {
    if (!isPrimary) return;
    const newEnabled = !currentEnabled;
    setTogglingKey(key);
    setStatusMessage(null);

    try {
      const res = await fetch("/api/admin/site-access", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, enabled: newEnabled }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update page lock.");
      }

      const updated = {
        ...locks,
        [key]: newEnabled,
      };
      setLocks(updated);
      onUpdate?.(updated);
      setStatusMessage({
        type: "success",
        text: `${PAGE_CARDS.find((c) => c.key === key)?.name || key} is now ${newEnabled ? "unlocked (live)" : "locked (restricted)"}.`,
      });
    } catch (err: any) {
      console.error("Lock toggle error:", err);
      setStatusMessage({
        type: "error",
        text: err.message || "Failed to toggle page lock.",
      });
    } finally {
      setTogglingKey(null);
    }
  };

  const handleBulkAction = async (unlockAll: boolean) => {
    if (!isPrimary) return;
    setTogglingKey(PAGE_CARDS[0].key);
    setStatusMessage(null);

    const updated: SiteAccessConfig = { ...locks };
    PAGE_CARDS.forEach((c) => {
      updated[c.key] = unlockAll;
    });

    try {
      const res = await fetch("/api/admin/site-access", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locks: updated }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to apply bulk page locks.");
      }

      setLocks(updated);
      onUpdate?.(updated);
      setStatusMessage({
        type: "success",
        text: unlockAll
          ? "All public pages have been unlocked and are now active."
          : "All optional public pages have been locked down.",
      });
    } catch (err: any) {
      console.error("Bulk lock error:", err);
      setStatusMessage({
        type: "error",
        text: err.message || "Failed to apply bulk page locks.",
      });
    } finally {
      setTogglingKey(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="page-locks-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200"
    >
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-[32px] bg-white text-black shadow-2xl overflow-hidden border border-black/10">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black/10 px-6 py-5 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-black text-white shadow-md">
              <Lock size={20} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2
                  id="page-locks-title"
                  className="text-lg font-bold text-black sm:text-xl"
                >
                  Site Page Access & Lock Control
                </h2>
                <span className="rounded-full bg-violet-100 border border-violet-200 px-2.5 py-0.5 text-[10px] font-bold text-violet-800 uppercase tracking-wider">
                  Primary Master Only
                </span>
              </div>
              <p className="text-xs text-black/50">
                Lock or unlock public accessibility for festival sections in real-time.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/5 text-black/60 transition hover:bg-black/10 hover:text-black"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Security Notice Banner */}
        <div className="bg-neutral-900 px-6 py-3.5 text-white sm:px-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-black/10">
          <div className="flex items-center gap-2.5 text-xs text-neutral-300">
            <ShieldCheck size={16} className="text-emerald-400 shrink-0" />
            <span>
              {isPrimary ? (
                <>
                  <strong className="text-white">Primary Master Clearance:</strong>{" "}
                  Your account is authorized to modify production page locks.
                </>
              ) : (
                <>
                  <strong className="text-amber-300">Read-Only Clearance:</strong>{" "}
                  Only Primary Master Admins can toggle page locks.
                </>
              )}
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-full bg-emerald-500/20 px-2.5 py-1 font-mono text-[11px] font-bold text-emerald-300 border border-emerald-500/30">
              {unlockedCount} LIVE
            </span>
            <span className="rounded-full bg-rose-500/20 px-2.5 py-1 font-mono text-[11px] font-bold text-rose-300 border border-rose-500/30">
              {lockedCount} LOCKED
            </span>
          </div>
        </div>

        {/* Status Alert if any */}
        {statusMessage && (
          <div
            className={`px-6 py-2.5 text-xs font-semibold flex items-center gap-2 border-b transition ${
              statusMessage.type === "success"
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : "bg-rose-50 text-rose-800 border-rose-200"
            }`}
          >
            {statusMessage.type === "success" ? (
              <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle size={15} className="text-rose-600 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Controls Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 sm:px-8 border-b border-black/5 bg-black/[0.015]">
          <div className="relative flex-1 max-w-sm">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-black/35" />
            <input
              type="text"
              placeholder="Search festival modules or URLs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-full border border-black/10 bg-white py-1.5 pl-9 pr-4 text-xs text-black placeholder:text-black/35 outline-none focus:border-black/30"
            />
          </div>

          {isPrimary && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleBulkAction(true)}
                disabled={togglingKey !== null}
                className="flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3.5 py-1.5 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50"
              >
                <Unlock size={13} />
                <span>Unlock All</span>
              </button>
              <button
                type="button"
                onClick={() => handleBulkAction(false)}
                disabled={togglingKey !== null}
                className="flex items-center gap-1.5 rounded-full border border-rose-300 bg-rose-50 px-3.5 py-1.5 text-xs font-bold text-rose-800 transition hover:bg-rose-100 disabled:opacity-50"
              >
                <Lock size={13} />
                <span>Lock All</span>
              </button>
            </div>
          )}
        </div>

        {/* Modules Grid */}
        <div className="flex-1 overflow-y-auto px-6 py-5 sm:px-8">
          <div className="grid gap-3.5 sm:grid-cols-2">
            {filteredCards.map((card) => {
              const isUnlocked = locks[card.key] ?? false;
              const isToggling = togglingKey === card.key;
              const CardIcon = card.icon;

              return (
                <div
                  key={card.key}
                  className={`relative flex flex-col justify-between rounded-2xl border p-4 transition ${
                    isUnlocked
                      ? "border-emerald-200 bg-emerald-50/20 hover:border-emerald-300 shadow-xs"
                      : "border-rose-200 bg-rose-50/20 hover:border-rose-300 shadow-xs"
                  }`}
                >
                  <div>
                    {/* Header Row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div
                          className={`flex h-8 w-8 items-center justify-center rounded-xl transition ${
                            isUnlocked
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-rose-100 text-rose-800"
                          }`}
                        >
                          <CardIcon size={16} />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-black">{card.name}</h3>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="font-mono text-[9px] font-bold text-black/40 uppercase">
                              {card.moduleCode}
                            </span>
                            <span className="text-[9px] text-black/25">·</span>
                            <span className="text-[10px] text-black/50 font-medium">
                              {card.category}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Live Link */}
                      <a
                        href={card.path}
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/5 text-black/50 hover:bg-black/10 hover:text-black transition"
                        title={`View ${card.path} in new tab`}
                      >
                        <ExternalLink size={13} />
                      </a>
                    </div>

                    {/* Description */}
                    <p className="mt-2.5 text-xs text-black/60 leading-relaxed">
                      {card.description}
                    </p>
                  </div>

                  {/* Footer & Toggle Action */}
                  <div className="mt-4 flex items-center justify-between border-t border-black/5 pt-3">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${
                          isUnlocked
                            ? "bg-emerald-100/70 border-emerald-300 text-emerald-800"
                            : "bg-rose-100/70 border-rose-300 text-rose-800"
                        }`}
                      >
                        {isUnlocked ? (
                          <>
                            <Unlock size={11} className="text-emerald-700" />
                            <span>Unlocked (Live)</span>
                          </>
                        ) : (
                          <>
                            <Lock size={11} className="text-rose-700" />
                            <span>Locked (Offline)</span>
                          </>
                        )}
                      </span>
                    </div>

                    {isPrimary ? (
                      <button
                        type="button"
                        onClick={() => handleToggle(card.key, isUnlocked)}
                        disabled={isToggling}
                        className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition shadow-xs disabled:opacity-50 ${
                          isUnlocked
                            ? "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50"
                            : "border border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
                        }`}
                      >
                        {isToggling ? (
                          <RefreshCw size={13} className="animate-spin text-current" />
                        ) : isUnlocked ? (
                          <>
                            <Lock size={13} />
                            <span>Lock Page</span>
                          </>
                        ) : (
                          <>
                            <Unlock size={13} />
                            <span>Unlock Page</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <span className="text-[10px] text-black/40 italic">
                        Master required
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-black/10 bg-neutral-50 px-6 py-4 sm:px-8">
          <p className="text-[11px] text-black/45">
            Locked pages automatically display the cybersecurity lockdown matrix (
            <code>TerminalPlaceholder</code>) with classified security badges to visitors.
          </p>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-black px-5 py-2 text-xs font-semibold text-white transition hover:scale-[1.02] shadow-sm"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
