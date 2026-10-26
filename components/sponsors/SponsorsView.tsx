"use client";

import React, { useState, useId } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Building2,
  Mail,
  ShieldCheck,
  Sparkles,
  Handshake,
  TrendingUp,
  Compass,
} from "lucide-react";
import Navbar from "@/components/ui/Navbar";
import Footer from "@/components/ui/Footer";
import {
  PARTNERS_DATA,
  FESTIVAL_IMPACT_METRICS,
  PARTNERSHIP_TEAM_CONTACTS,
  StrategicPartner,
} from "@/data/sponsorsData";

// ============================================================
// SVG EMBLEM FALLBACKS (Used if image fails)
// ============================================================

function SponsorEmblem({
  symbolType,
  hexColor,
  className = "w-16 h-16",
}: {
  symbolType: StrategicPartner["symbolType"];
  hexColor: string;
  className?: string;
}) {
  const gradientId = useId();

  switch (symbolType) {
    case "coke":
      return (
        <svg viewBox="0 0 100 100" className={className} fill="none" aria-label="Coca-Cola Emblem">
          <circle cx="50" cy="50" r="44" fill="#E60000" />
          <path d="M22 54C30 46 38 60 54 50C64 44 74 40 82 43C82 47 74 52 56 58C40 64 28 58 22 54Z" fill="white" />
          <text x="50" y="53" textAnchor="middle" fill="white" fontSize="12" fontWeight="900" fontFamily="sans-serif">Coke</text>
        </svg>
      );
    case "oppo":
      return (
        <svg viewBox="0 0 100 100" className={className} fill="none" aria-label="OPPO Emblem">
          <circle cx="50" cy="50" r="44" fill="#031F14" stroke="#04A85B" strokeWidth="2" />
          <ellipse cx="38" cy="50" rx="14" ry="18" stroke="#10B981" strokeWidth="3" />
          <ellipse cx="62" cy="50" rx="14" ry="18" stroke="#34D399" strokeWidth="3" />
          <circle cx="50" cy="50" r="6" fill="#10B981" />
        </svg>
      );
    case "qilver":
      return (
        <svg viewBox="0 0 100 100" className={className} fill="none" aria-label="QILVER Jewelry Emblem">
          <circle cx="50" cy="50" r="44" fill="#082032" stroke="#38BDF8" strokeWidth="1.5" />
          <path d="M26 62L30 42L40 52L50 34L60 52L70 42L74 62H26Z" fill="#38BDF8" stroke="#BAE6FD" strokeWidth="1.5" />
          <circle cx="50" cy="34" r="3" fill="white" />
        </svg>
      );
    case "pl":
      return (
        <svg viewBox="0 0 100 100" className={className} fill="none" aria-label="P.L. Industries Emblem">
          <circle cx="50" cy="50" r="44" fill="#490E12" stroke="#E65300" strokeWidth="3" />
          <rect x="22" y="56" width="56" height="12" rx="2" fill="#E65300" />
          <text x="50" y="65" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold" fontFamily="sans-serif">P.L. INDUSTRIES</text>
          <text x="50" y="44" textAnchor="middle" fill="#FFF4B2" fontSize="16" fontWeight="bold" fontFamily="serif">कृti</text>
        </svg>
      );
    case "bake":
      return (
        <svg viewBox="0 0 100 100" className={className} fill="none" aria-label="BAKE Skin Care Emblem">
          <circle cx="50" cy="50" r="44" fill="#250912" stroke="#FB7185" strokeWidth="1.5" />
          <path d="M50 26C50 26 66 46 66 58C66 67 59 74 50 74C41 74 34 67 34 58C34 46 50 26 50 26Z" fill="#FB7185" />
        </svg>
      );
    case "livup":
      return (
        <svg viewBox="0 0 100 100" className={className} fill="none" aria-label="Liv Up Emblem">
          <circle cx="50" cy="50" r="44" fill="#041E28" stroke="#06B6D4" strokeWidth="2" />
          <path d="M52 24L38 46H50L44 66L62 42H50L56 24H52Z" fill="#06B6D4" />
        </svg>
      );
    case "secrettemptation":
      return (
        <svg viewBox="0 0 100 100" className={className} fill="none" aria-label="Secret Temptation Emblem">
          <circle cx="50" cy="50" r="44" fill="#1E072D" stroke="#C084FC" strokeWidth="2" />
          <rect x="36" y="44" width="28" height="26" rx="5" fill="#C084FC" />
          <rect x="44" y="36" width="12" height="8" rx="2" fill="#F472B6" />
        </svg>
      );
    default:
      return <Building2 className={className} style={{ color: hexColor }} />;
  }
}

// ============================================================
// PARTNER LOGO (Loads actual /sponsors/<name>.png cleanly)
// ============================================================

function PartnerLogo({ partner }: { partner: StrategicPartner }) {
  const [imageError, setImageError] = useState(false);
  const isQilver = partner.id === "qilver";

  if (imageError || !partner.logoImage) {
    return (
      <div className="flex h-24 w-full items-center justify-center p-2">
        <SponsorEmblem
          symbolType={partner.symbolType}
          hexColor={partner.hexColor}
          className="h-20 w-20"
        />
      </div>
    );
  }

  return (
    <div className="relative flex h-28 w-full items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/80 p-3 shadow-inner transition-all duration-300 group-hover:border-white/25 group-hover:bg-zinc-900/90">
      {/* Subtle brand glow behind logo */}
      <div
        className="pointer-events-none absolute inset-0 opacity-15 blur-xl transition-opacity duration-300 group-hover:opacity-30"
        style={{ backgroundColor: partner.hexColor }}
      />

      <div className="relative h-full w-full transition-transform duration-300 group-hover:scale-105">
        <Image
          src={partner.logoImage}
          alt={`${partner.name} Logo`}
          fill
          sizes="(max-width: 768px) 100vw, 360px"
          className={`object-contain p-1.5 drop-shadow-[0_4px_12px_rgba(0,0,0,0.6)] ${
            isQilver ? "brightness-0 invert drop-shadow-[0_0_15px_rgba(56,189,248,0.4)]" : ""
          }`}
          onError={() => setImageError(true)}
        />
      </div>
    </div>
  );
}

// ============================================================
// MAIN PARTNERS DISPLAY VIEW
// ============================================================

export default function SponsorsView() {
  return (
    <div className="relative min-h-screen bg-black text-white selection:bg-violet-500 selection:text-white">
      <Navbar />

      <main className="relative z-10 pt-24 sm:pt-28 pb-24 overflow-hidden">
        {/* ============================================================ */}
        {/* HERO ARENA BACKGROUND */}
        {/* ============================================================ */}
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[650px] overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/85 to-black z-10" />
          <Image
            src="/images/sponsors-arena-bg.jpg"
            alt="Saviskar 2026 Arena Background"
            fill
            priority
            className="object-cover object-center opacity-40 blur-[1px] transform scale-105"
          />
          {/* Radial ambient glow orbs */}
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[450px] w-[800px] rounded-full bg-violet-600/20 blur-[140px] z-20" />
          <div className="absolute top-1/3 left-1/4 h-[350px] w-[500px] rounded-full bg-cyan-600/15 blur-[130px] z-20" />
        </div>

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* ============================================================ */}
          {/* TOP BREADCRUMB & STATUS */}
          {/* ============================================================ */}
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-mono tracking-wider text-zinc-400 backdrop-blur-md transition-all hover:border-white/30 hover:bg-white/[0.08] hover:text-white"
            >
              <ArrowLeft size={14} />
              <span>RETURN TO MAIN RADAR</span>
            </Link>

            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 font-mono text-[11px] font-semibold text-emerald-400 uppercase tracking-widest backdrop-blur-md">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                ALLIANCE MATRIX // 7 OFFICIAL PARTNERS
              </span>
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-[11px] text-zinc-400">
                <Compass size={12} className="text-violet-400" />
                AEVORIAN PROTOCOL
              </span>
            </div>
          </div>

          {/* ============================================================ */}
          {/* HERO BANNER */}
          {/* ============================================================ */}
          <div className="mb-14 text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-1.5 text-xs font-mono font-medium tracking-widest text-violet-300 shadow-[0_0_20px_rgba(139,92,246,0.2)]">
              <Sparkles size={13} className="text-violet-400 animate-pulse" />
              <span>OFFICIAL PARTNERS & STRATEGIC ALLIES</span>
            </div>

            <h1 className="mt-5 text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight text-white uppercase font-sans">
              Powering{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 via-fuchsia-300 to-cyan-400">
                Saviskar 2026
              </span>
            </h1>

            <p className="mt-5 text-base sm:text-lg lg:text-xl text-zinc-300 leading-relaxed font-sans font-light">
              We proudly celebrate the premier industry leaders, iconic consumer brands, and visionary corporate patrons fueling North India&rsquo;s benchmark university festival at CGC University, Mohali.
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2 sm:gap-3 text-xs font-mono text-zinc-400">
              <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1">28–29 OCTOBER 2026</span>
              <span className="text-zinc-600">•</span>
              <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1">CGC UNIVERSITY MOHALI</span>
              <span className="text-zinc-600">•</span>
              <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 px-2.5 py-1 font-semibold">
                ALL 7 OFFICIAL PARTNERS ACTIVE
              </span>
            </div>
          </div>

          {/* ============================================================ */}
          {/* FESTIVAL IMPACT METRICS BAR */}
          {/* ============================================================ */}
          <div className="mb-16 grid grid-cols-2 lg:grid-cols-4 gap-4">
            {FESTIVAL_IMPACT_METRICS.map((metric, idx) => (
              <div
                key={idx}
                className="group relative rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] via-white/[0.02] to-transparent p-5 backdrop-blur-xl transition-all duration-300 hover:border-violet-500/40 hover:-translate-y-1 shadow-lg"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-[10px] tracking-widest text-zinc-400 uppercase">
                    METRIC // 0{idx + 1}
                  </span>
                  <TrendingUp size={14} className="text-violet-400 opacity-70" />
                </div>
                <div className="text-2xl sm:text-3xl font-black tracking-tight text-white font-mono group-hover:text-violet-200 transition-colors">
                  {metric.number}
                </div>
                <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-zinc-200">
                  {metric.label}
                </div>
                <div className="mt-1 text-[11px] text-zinc-400 leading-snug">
                  {metric.detail}
                </div>
              </div>
            ))}
          </div>

          {/* ============================================================ */}
          {/* PARTNERS DISPLAY GRID (Clean Showcase of All 7 Brands) */}
          {/* ============================================================ */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-7 mb-20">
            {PARTNERS_DATA.map((partner, idx) => (
              <motion.div
                key={partner.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: idx * 0.05 }}
                className={`group relative flex flex-col justify-between rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.04] via-zinc-950/70 to-black p-6 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 shadow-xl ${partner.borderGlow}`}
              >
                {/* Glowing background gradient on hover */}
                <div
                  className={`absolute inset-0 -z-10 rounded-3xl bg-gradient-to-br ${partner.gradient} opacity-0 transition-opacity duration-300 group-hover:opacity-10 blur-xl`}
                />

                <div>
                  {/* Top Designation Badge */}
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider ${partner.badgeBg}`}
                    >
                      <ShieldCheck size={12} />
                      {partner.badgeText}
                    </span>

                    <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                      0{idx + 1}
                    </span>
                  </div>

                  {/* Logo Container (Clean & Prominent) */}
                  <div className="mb-5">
                    <PartnerLogo partner={partner} />
                  </div>

                  {/* Brand Name & Title */}
                  <div className="mb-3">
                    <h3 className="text-2xl font-black tracking-tight text-white group-hover:text-white transition-colors font-sans">
                      {partner.name}
                    </h3>
                    <p className="font-mono text-xs font-semibold text-zinc-400 mt-0.5">
                      {partner.officialTitle}
                    </p>
                  </div>

                  {/* Tagline */}
                  <div
                    className="mb-3 rounded-xl border border-white/5 bg-white/[0.02] p-2.5 text-xs italic text-zinc-300 font-sans border-l-2"
                    style={{ borderLeftColor: partner.hexColor }}
                  >
                    &ldquo;{partner.tagline}&rdquo;
                  </div>

                  {/* Narrative Description */}
                  <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed font-sans">
                    {partner.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* ============================================================ */}
          {/* PARTNERSHIP & ALLIANCE INQUIRY CTA DECK */}
          {/* ============================================================ */}
          <div className="rounded-3xl border border-violet-500/30 bg-gradient-to-br from-violet-950/40 via-zinc-950 to-black p-8 sm:p-12 relative overflow-hidden backdrop-blur-2xl shadow-2xl">
            <div className="pointer-events-none absolute -right-24 -bottom-24 h-80 w-80 rounded-full bg-violet-600/20 blur-[100px]" />
            <div className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-cyan-600/15 blur-[100px]" />

            <div className="relative z-10 max-w-3xl mx-auto text-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/10 px-4 py-1.5 text-xs font-mono text-violet-300">
                <Handshake size={14} className="text-violet-400" />
                <span>SAC CORPORATE ALLIANCES & PARTNERSHIPS</span>
              </div>

              <h2 className="mt-5 text-3xl sm:text-5xl font-black tracking-tight text-white font-sans uppercase">
                Collaborate With North India&rsquo;s Flagship Festival
              </h2>

              <p className="mt-4 text-sm sm:text-base text-zinc-300 leading-relaxed font-sans font-light">
                Position your brand before 35,000+ top engineering, management, design, and biotechnology students across 200+ universities. Experience bespoke experiential marketing, high-octane stage integrations, and multi-channel digital exposure.
              </p>

              {/* Partnership Team Contacts */}
              <div className="mt-8 flex justify-center max-w-sm mx-auto">
                {PARTNERSHIP_TEAM_CONTACTS.map((contact, cIdx) => (
                  <div
                    key={cIdx}
                    className="w-full flex items-center gap-3.5 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 backdrop-blur-md text-left"
                  >
                    <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-full border border-violet-500/30 bg-violet-900/40">
                      <Image
                        src={contact.avatar}
                        alt={contact.name}
                        fill
                        className="object-cover"
                      />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-white">{contact.name}</div>
                      <div className="text-[11px] text-zinc-400 leading-tight">{contact.role}</div>
                      <div className="font-mono text-[10px] text-violet-400 mt-0.5">{contact.wing}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                <a
                  href="mailto:saviskar@cgcuniversity.in?subject=Saviskar%202026%20Partnership%20Inquiry"
                  className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-7 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:from-violet-500 hover:to-indigo-500 hover:scale-105"
                >
                  <Mail size={16} />
                  <span>Request 2026 Partnership Deck</span>
                </a>

                <Link
                  href="/team"
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 py-3 text-sm font-medium text-zinc-300 transition-all hover:border-white/40 hover:text-white hover:bg-white/10"
                >
                  <Building2 size={16} />
                  <span>Meet Full SAC Council</span>
                </Link>
              </div>

              <div className="mt-6 text-center font-mono text-xs text-zinc-500">
                Direct Inquiries:{" "}
                <a
                  href="mailto:saviskar@cgcuniversity.in"
                  className="text-violet-400 hover:underline"
                >
                  saviskar@cgcuniversity.in
                </a>{" "}
                • CGC University Mohali, Punjab
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
