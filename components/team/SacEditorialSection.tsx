"use client";

import React from "react";
import {
  OVERALL_HEADS,
  BILLS_BUDGET_TEAM,
  WEBSITE_TEAM,
  BRANDING_TEAM,
  CREATIVITY_TEAM,
  SPONSORSHIP_TEAM,
  CALLING_TEAM,
  STATE_HEADS_DIRECTORY,
  SacMember,
  StateHeadEntry,
} from "@/data/teamData";
import {
  Crown,
  Code2,
  Palette,
  Lightbulb,
  BadgeDollarSign,
  PhoneCall,
  MapPin,
  Users,
} from "lucide-react";
import ProfileCard from "@/components/ProfileCard";

// ============================================================
// AVATAR RESOLVER
// ============================================================
function getMemberAvatar(member: SacMember): string {
  if (member.image && member.image.trim().length > 0) {
    return encodeURI(decodeURI(member.image));
  }
  return member.avatarVariant === "female"
    ? "/images/team/avatar-female.webp"
    : "/images/team/avatar-male.webp";
}

// ============================================================
// TIER CONFIG
// Golden/Amber: leads  |  Cyan: core  |  Violet: members
// ============================================================
type Tier = "lead" | "core" | "member";

interface TierConf {
  className: string;
  behindGlowColor: string;
  behindGlowSize: string;
  innerGradient: string;
  badgeLabel: string;
}

const TIER_CONF: Record<Tier, TierConf> = {
  lead: {
    className: "pc-lead",
    // Golden amber — distinguishes all heads/leads at a glance
    behindGlowColor: "rgba(245, 158, 11, 0.80)",
    behindGlowSize: "38%",
    innerGradient:
      "linear-gradient(145deg, rgba(245,158,11,0.32) 0%, rgba(180,83,9,0.20) 45%, rgba(10,5,0,0.97) 100%)",
    badgeLabel: "Head",
  },
  core: {
    className: "pc-core",
    // Neon cyan/teal — matches global cyan accent
    behindGlowColor: "rgba(6, 182, 212, 0.65)",
    behindGlowSize: "30%",
    innerGradient:
      "linear-gradient(145deg, rgba(6,182,212,0.45) 0%, rgba(14,116,144,0.26) 40%, rgba(3,12,20,0.97) 100%)",
    badgeLabel: "Core",
  },
  member: {
    className: "pc-member",
    // Soft electric blue
    behindGlowColor: "rgba(59, 130, 246, 0.45)",
    behindGlowSize: "25%",
    innerGradient:
      "linear-gradient(145deg, rgba(59,130,246,0.35) 0%, rgba(37,99,235,0.18) 40%, rgba(5,8,20,0.97) 100%)",
    badgeLabel: "Member",
  },
};

// ============================================================
// SINGLE PROFILE CARD (exact React Bits component)
// ============================================================
interface SacCardProps {
  member: SacMember;
  tier: Tier;
}

function SacProfileCard({ member, tier }: SacCardProps) {
  const conf = TIER_CONF[tier];
  const avatar = getMemberAvatar(member);
  const handle = (member.wing || "sac").toLowerCase().replace(/[^a-z0-9]/g, "");
  const statusText = member.personDetail || tier.toUpperCase();

  return (
    <div id={`member-${member.id}`} className="flex justify-center flex-shrink-0">
      <ProfileCard
        name={member.name}
        title={member.role || "Student Advisory Council (SAC)"}
        handle={handle}
        status={statusText}
        contactText={conf.badgeLabel}
        avatarUrl={avatar}
        miniAvatarUrl={avatar}
        className={conf.className}
        showUserInfo={false}
        enableTilt={true}
        enableMobileTilt={false}
        onContactClick={() => { }}
        behindGlowEnabled={true}
        behindGlowColor={conf.behindGlowColor}
        behindGlowSize={conf.behindGlowSize}
        innerGradient={conf.innerGradient}
      />
    </div>
  );
}

// ============================================================
// TIER BADGE LABEL
// ============================================================
function TierBadge({
  label,
  count,
  accent = "amber",
}: {
  label: string;
  count: number;
  accent?: string;
}) {
  const palette: Record<string, string> = {
    violet: "text-violet-400 border-violet-400/30 bg-violet-500/[0.06]",
    cyan: "text-cyan-400 border-cyan-400/30 bg-cyan-500/[0.06]",
    blue: "text-blue-400 border-blue-400/30 bg-blue-500/[0.06]",
    amber: "text-amber-400 border-amber-400/30 bg-amber-500/[0.06]",
    emerald: "text-emerald-400 border-emerald-400/30 bg-emerald-500/[0.06]",
    rose: "text-rose-400 border-rose-400/30 bg-rose-500/[0.06]",
    white: "text-white/60 border-white/20 bg-white/[0.04]",
  };
  const cls = palette[accent] || palette.violet;

  return (
    <div className="flex items-center gap-3 my-8 max-w-6xl mx-auto px-4">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[9.5px] uppercase tracking-[0.25em] font-bold border ${cls}`}
      >
        {label}
      </span>
      <span className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
      <span className="font-mono text-[9px] tracking-widest text-white/30 uppercase">
        {count} {count === 1 ? "person" : "members"}
      </span>
    </div>
  );
}

// ============================================================
// CARD ROW — flex-wrap centered (starts from center outward)
// ============================================================
function CardRow({ members, tier }: { members: SacMember[]; tier: Tier }) {
  if (!members || members.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-8 md:gap-10 px-4">
      {members.map((m) => (
        <SacProfileCard key={m.id} member={m} tier={tier} />
      ))}
    </div>
  );
}

// ============================================================
// CATEGORY SECTION
// Layout: description header → leads → core → (state dir) → members
// ============================================================
interface CategoryDef {
  id: string;
  chapter: string;
  eyebrow: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  accentClass: string;
  leads?: SacMember[];
  core?: SacMember[];
  members?: SacMember[];
  leadsLabel?: string;
  stateDirectory?: StateHeadEntry[];
}

function CategorySection({ cat }: { cat: CategoryDef }) {
  const total =
    (cat.leads?.length || 0) + (cat.core?.length || 0) + (cat.members?.length || 0);

  return (
    <section
      id={`wing-${cat.id}`}
      className="relative py-16"
      style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
    >
      {/* ── Description header ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-12">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div>
            <div
              className={`flex items-center gap-2 font-mono text-[10px] tracking-[0.3em] uppercase mb-3 ${cat.accentClass}`}
            >
              {cat.icon}
              <span>{cat.eyebrow}</span>
            </div>
            <h2 className="font-editorial text-4xl sm:text-5xl md:text-6xl font-bold text-white tracking-tight leading-[1.0]">
              {cat.title}
            </h2>
            <p className="mt-4 text-base sm:text-lg text-zinc-400 font-light leading-relaxed max-w-2xl">
              {cat.description}
            </p>
          </div>
          <div className="flex items-center gap-3 self-start lg:self-end">
            <span className="liquid-glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 font-mono text-[10.5px] tracking-wider uppercase text-white/80">
              <Users size={12} className={cat.accentClass} />
              <span>
                {total} {total === 1 ? "member" : "members"}
              </span>
            </span>
            <span className="font-mono text-[9px] tracking-[0.3em] text-white/20 uppercase">
              {cat.chapter}
            </span>
          </div>
        </div>
      </div>

      {/* ── LEADS ── */}
      {cat.leads && cat.leads.length > 0 && (
        <div className="mb-14">
          <TierBadge
            label={cat.leadsLabel || "Team Leads"}
            count={cat.leads.length}
            accent="amber"
          />
          <CardRow members={cat.leads} tier="lead" />
        </div>
      )}

      {/* ── CORE ── */}
      {cat.core && cat.core.length > 0 && (
        <div className="mb-14">
          <TierBadge label="Core Members" count={cat.core.length} accent="cyan" />
          <CardRow members={cat.core} tier="core" />
        </div>
      )}

      {/* ── STATE DIRECTORY (Calling Team only) ── */}
      {cat.stateDirectory && cat.stateDirectory.length > 0 && (
        <div className="mb-14 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-white/[0.08] bg-black/40 p-6 backdrop-blur-xl">
            <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.3em] uppercase text-amber-400 mb-2">
              <MapPin size={11} />
              <span>Regional Allocation Directory</span>
            </div>
            <h4 className="font-editorial text-2xl sm:text-3xl font-bold text-white tracking-tight mb-2">
              State Outreach Heads
            </h4>
            <p className="text-xs text-zinc-400 font-light mb-6">
              Direct state-level outreach coordinators leading delegation drives across key regions.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-8">
              {cat.stateDirectory.map((item, i) => (
                <div
                  key={i}
                  className="flex items-baseline justify-between gap-3 border-b border-white/[0.04] pb-2"
                >
                  <span className="font-mono text-[11px] text-zinc-400 tracking-wide flex-shrink-0">
                    {item.region}
                  </span>
                  <span
                    className="h-px flex-1 bg-white/[0.05] self-center mx-2"
                    aria-hidden="true"
                  />
                  <span className="font-editorial text-sm font-semibold text-white text-right flex-shrink-0">
                    {item.heads}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── MEMBERS ── */}
      {cat.members && cat.members.length > 0 && (
        <div className="mb-10">
          <TierBadge label="Council Members" count={cat.members.length} accent="blue" />
          <CardRow members={cat.members} tier="member" />
        </div>
      )}
    </section>
  );
}

// ============================================================
// MAIN EXPORT
// ============================================================
export default function SacEditorialSection() {
  const categories: CategoryDef[] = [
    {
      id: "overall",
      chapter: "CHAPTER 01",
      eyebrow: "Executive Council Apex",
      title: "Overall Heads",
      description:
        "The supreme student executive command of Saviskar 2026. Presiding over the Student Advisory Council (SAC), anchoring festival governance, inter-wing strategic synchronization, and institutional liaison with university leadership to unite 35,000+ delegates under Aevorian Reverie.",
      icon: <Crown size={14} />,
      accentClass: "text-amber-400",
      leads: OVERALL_HEADS,
      leadsLabel: "Overall Heads",
      core: [],
      members: [],
    },
    {
      id: "budget",
      chapter: "CHAPTER 02",
      eyebrow: "Financial Governance & Audit",
      title: "Bills & Budget Team",
      description:
        "The fiscal stewards of Saviskar 2026. Governing budgetary compliance, procurement transparency, vendor contract reconciliation, and operational resource management to ensure zero-leakage financial discipline across all operational festival wings.",
      icon: <BadgeDollarSign size={14} />,
      accentClass: "text-cyan-400",
      leads: [],
      core: BILLS_BUDGET_TEAM,
      members: [],
    },
    {
      id: "website",
      chapter: "CHAPTER 03",
      eyebrow: "Digital Architecture & Infrastructure",
      title: "Website Team",
      description:
        "The engineering force architecting the digital face of Saviskar 2026. Developing the high-performance responsive web portal, real-time ticket checkout flows, automated registration verification emails, payment gateways, and interactive 3D WebGL scenes across all devices.",
      icon: <Code2 size={14} />,
      accentClass: "text-amber-400",
      leads: WEBSITE_TEAM,        // Both Madhav & Jashan Jot — golden glow
      leadsLabel: "Website Heads",
      core: [],
      members: [],
    },
    {
      id: "branding",
      chapter: "CHAPTER 04",
      eyebrow: "Visual Identity & Aesthetic Direction",
      title: "Branding Team",
      description:
        "The artistic custodians of the festival's aesthetic voice. Shaping motion teasers, official typography, environmental campus banners, social media narrative, and merchandise aesthetics to evoke the cinematic dreamscape of Aevorian Reverie.",
      icon: <Palette size={14} />,
      accentClass: "text-emerald-400",
      leads: BRANDING_TEAM.leads,
      core: BRANDING_TEAM.core,
      members: BRANDING_TEAM.members,
    },
    {
      id: "creativity",
      chapter: "CHAPTER 05",
      eyebrow: "Stage Craft & Experiential Design",
      title: "Creativity Team",
      description:
        "The experiential visionaries transforming the university campus into a living dreamscape. Designing theatrical arena sets, stadium lighting atmospheres, fine arts pavilions, cultural contest stages, and headline Star Night visual experiences.",
      icon: <Lightbulb size={14} />,
      accentClass: "text-violet-400",
      leads: CREATIVITY_TEAM.leads,
      core: CREATIVITY_TEAM.core,
      members: CREATIVITY_TEAM.members,
    },
    {
      id: "sponsorship",
      chapter: "CHAPTER 06",
      eyebrow: "Corporate Alliances & Capital",
      title: "Sponsorship Team",
      description:
        "The alliance builders forging the industry partnerships that make Saviskar 2026 financially and operationally formidable. Through persistent pitch decks, corporate negotiations, and brand partnership frameworks, this wing secures the external backing our festival demands.",
      icon: <BadgeDollarSign size={14} />,
      accentClass: "text-amber-400",
      leads: SPONSORSHIP_TEAM.leads,
      core: [],
      members: SPONSORSHIP_TEAM.members,
    },
    {
      id: "calling",
      chapter: "CHAPTER 07",
      eyebrow: "National Outreach & Delegate Relations",
      title: "Calling Team",
      description:
        "The frontline voice of Saviskar 2026. Through direct student-to-student engagement across states, this wing brings thousands of participants into the Aevorian Reverie arena — turning ambition into footfall and turning a local festival into a national movement.",
      icon: <PhoneCall size={14} />,
      accentClass: "text-cyan-400",
      leads: CALLING_TEAM.leads,
      core: CALLING_TEAM.core,
      members: CALLING_TEAM.members,
      stateDirectory: STATE_HEADS_DIRECTORY,
    },
  ];

  const totalMembers = categories.reduce(
    (acc, cat) =>
      acc + (cat.leads?.length || 0) + (cat.core?.length || 0) + (cat.members?.length || 0),
    0
  );

  return (
    <div className="relative z-20">
      {/* ── Section opener ── */}
      <div
        className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
      >
        <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-violet-400 mb-4 flex items-center gap-2">
          <span className="h-px w-6 bg-violet-500/40" />
          Operational Wings // Student Architects
        </div>
        <h2 className="font-editorial text-5xl sm:text-6xl md:text-7xl font-bold text-white tracking-tight leading-[1.0]">
          The Council<br />Cadre
        </h2>
        <p className="mt-5 text-base sm:text-lg text-zinc-400 font-light leading-relaxed max-w-2xl">
          Every person who built Saviskar 2026 — across seven operational wings, under one shared vision. Aevorian Reverie.
        </p>
        <div className="mt-6 flex items-center gap-3">
          <span className="h-px flex-1 bg-white/[0.06]" />
          <span className="font-mono text-[9px] tracking-widest text-white/20 uppercase">
            {totalMembers} members across 7 wings
          </span>
        </div>
        {/* Tier colour legend */}
        <div className="mt-8 flex flex-wrap gap-3">
          {[
            { label: "Head / Lead", cls: "text-amber-400 border-amber-400/30 bg-amber-500/[0.06]" },
            { label: "Core Member", cls: "text-cyan-400 border-cyan-400/30 bg-cyan-500/[0.06]" },
            { label: "Council Member", cls: "text-blue-400 border-blue-400/30 bg-blue-500/[0.06]" },
          ].map((t) => (
            <span
              key={t.label}
              className={`inline-flex items-center rounded-full px-3 py-1 font-mono text-[9px] uppercase tracking-[0.25em] font-bold border ${t.cls}`}
            >
              {t.label}
            </span>
          ))}
        </div>
      </div>

      {/* ── Per-category sections ── */}
      {categories.map((cat) => (
        <CategorySection key={cat.id} cat={cat} />
      ))}
    </div>
  );
}
