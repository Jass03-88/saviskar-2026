"use client";

import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  LEVEL_3_CULTURAL_DIRECTORATE,
  LEVEL_4_OPERATIONS_COMMAND,
  EDITORIAL_DIRECTOR,
  EDITORIAL_DEAN,
  EDITORIAL_PRESIDENCY,
} from "@/data/teamData";
import DeskEditorialSpread from "./DeskEditorialSpread";
import SacEditorialSection from "./SacEditorialSection";
import MouseSpotlight from "@/components/ui/MouseSpotlight";
import Navbar from "@/components/ui/Navbar";
import {
  Sparkles,
  ArrowUpRight,
  Crown,
  Layers,
  Maximize2,
  X,
  Download,
} from "lucide-react";

export default function TeamView() {
  const [isPhotoLightboxOpen, setIsPhotoLightboxOpen] = useState(false);

  const telemetryDials = [
    { value: "01", label: "Apex Patron", sub: "Director Student Affairs" },
    { value: "01", label: "Dean Leadership", sub: "Dean Student Affairs" },
    { value: "04", label: "Directorate Leads", sub: "Culture & Operations" },
    { value: "53", label: "Student Advisory Council (SAC)", sub: "Student Architects" },
  ];

  return (
    <div className="relative min-h-screen bg-black text-white selection:bg-violet-500 selection:text-white overflow-x-hidden">

      {/* ── FIXED PANORAMIC STADIUM BACKGROUND ── */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <Image
          src="/images/concert-stadium.webp"
          alt="Saviskar 2026 Festival Arena"
          fill
          priority
          sizes="100vw"
          className="object-cover object-center opacity-25 will-change-transform animate-slow-zoom"
        />

        {/* Primary deep-purple stage overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/85 via-black/60 to-black/95" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.15)_0%,rgba(0,0,0,0.80)_100%)]" />

        {/* Stage haze — violet/purple, matches landing page exactly */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(168,85,247,0.18)_0%,rgba(0,0,0,0.35)_60%,transparent_100%)]" />

        {/* Soft white spotlight rim from top — matches Hero.tsx */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 h-[500px] w-[80vw] bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.10)_0%,transparent_70%)] blur-[90px]" />

        {/* Ambient side glow — violet left, cyan right */}
        <div className="absolute left-[5%] top-[20%] h-[700px] w-[700px] rounded-full bg-violet-900/20 blur-[200px]" />
        <div className="absolute right-[5%] top-[40%] h-[600px] w-[600px] rounded-full bg-cyan-900/15 blur-[180px]" />
        <div className="absolute left-[25%] bottom-[5%] h-[500px] w-[500px] rounded-full bg-violet-950/25 blur-[200px]" />
      </div>

      {/* Mouse Spotlight */}
      <div className="pointer-events-none fixed inset-0 z-10">
        <MouseSpotlight />
      </div>

      {/* ── UNIVERSAL SITE NAVBAR ── */}
      <Navbar />

      {/* ════════════════════════════════════════════════════
          HERO — COMMAND TELEMETRY
      ════════════════════════════════════════════════════ */}
      <section className="relative z-20 pt-28 pb-8 sm:pt-36 sm:pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">

          {/* LEFT */}
          <div className="lg:col-span-7 flex flex-col items-start text-left">
            <div className="liquid-glass inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[10px] font-mono tracking-[0.25em] uppercase text-violet-300 mb-6 shadow-[0_0_20px_rgba(168,85,247,0.25)]">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" />
              <span>SAVISKAR 2026 // ORGANISING COMMAND</span>
            </div>

            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white tracking-tight leading-[1.06]">
              The Architects of{" "}
              <span className="font-editorial italic text-transparent bg-clip-text bg-gradient-to-r from-violet-300 via-fuchsia-300 to-cyan-300">
                Aevorian Reverie
              </span>
            </h1>

            <p className="mt-5 text-sm sm:text-base text-zinc-400 max-w-2xl leading-relaxed">
              Meet the executive patrons, cultural directorate, and student council leaders crafting North India&apos;s premier techno-cultural convergence at CGC University, Mohali.
            </p>

            {/* Telemetry stat row — 4-col grid keeps all stats on one line */}
            <div className="mt-10 grid grid-cols-4 items-start gap-x-0">
              {telemetryDials.map((dial, idx) => (
                <div key={idx} className="flex items-start gap-4">
                  {idx > 0 && (
                    <span className="h-8 w-px bg-white/[0.08] self-center flex-shrink-0" aria-hidden="true" />
                  )}
                  <div className="min-w-0">
                    <div className="text-3xl sm:text-4xl font-bold text-white leading-none tracking-tight tabular-nums">
                      {dial.value}
                    </div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-400 mt-1.5 leading-tight break-words">
                      {dial.label}
                    </div>
                    <div className="font-mono text-[8px] text-white/25 tracking-wider mt-0.5">
                      {dial.sub}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT — atmospheric graphic */}
          <div className="lg:col-span-5 flex justify-center items-center py-8 lg:py-0">
            <div className="relative flex flex-col items-center text-center gap-4">
              <div className="pointer-events-none absolute inset-0 scale-150 bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.12)_0%,transparent_70%)]" aria-hidden="true" />
              <div className="relative z-10 flex flex-col items-center gap-3">
                <Crown size={32} className="text-violet-400/70" />
                <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-violet-400/70">
                  APEX COMMAND // COUNCIL CADRE
                </span>
                <h3 className="text-3xl sm:text-4xl font-bold text-white leading-tight">
                  Saviskar 2026
                </h3>
                <p className="font-editorial text-sm sm:text-base text-zinc-400 italic">
                  Aevorian Reverie • CGC University
                </p>
                <div className="flex items-center gap-2 text-[11px] font-mono text-white/30 tracking-wide mt-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>53 Student Leaders • 7 Wings</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════
          1. DIRECTOR — CHIEF PATRON
      ════════════════════════════════════════════════════ */}
      <div id="patron-director">
        <DeskEditorialSpread
          titleBadge={EDITORIAL_DIRECTOR.titleBadge}
          deskTitle={EDITORIAL_DIRECTOR.deskTitle}
          paragraphs={EDITORIAL_DIRECTOR.paragraphs}
          signeeName={EDITORIAL_DIRECTOR.signeeName}
          signeeRole={EDITORIAL_DIRECTOR.signeeRole}
          initials={EDITORIAL_DIRECTOR.initials}
          image={EDITORIAL_DIRECTOR.image}
          accentColor="violet"
          align="left"
        />
      </div>

      {/* ════════════════════════════════════════════════════
          2. DEAN — STUDENT AFFAIRS
      ════════════════════════════════════════════════════ */}
      <div id="patron-dean">
        <DeskEditorialSpread
          titleBadge={EDITORIAL_DEAN.titleBadge}
          deskTitle={EDITORIAL_DEAN.deskTitle}
          paragraphs={EDITORIAL_DEAN.paragraphs}
          signeeName={EDITORIAL_DEAN.signeeName}
          signeeRole={EDITORIAL_DEAN.signeeRole}
          initials={EDITORIAL_DEAN.initials}
          image={EDITORIAL_DEAN.image}
          accentColor="cyan"
          align="right"
        />
      </div>

      <div id="directorate">
        {/* Section header */}
        <div
          className="relative z-20 pt-16 pb-4 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="absolute top-16 left-4 sm:left-6 lg:left-8 w-4 h-4 border-t border-l border-violet-500/40" />
          <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.3em] uppercase text-violet-400 mb-3">
            <Layers size={11} />
            <span>Festival Directorate // Cultural & Operations Command</span>
          </div>
          <h3 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white tracking-tight leading-[1.0]">
            The Directorate
          </h3>
          <p className="mt-3 text-sm sm:text-base text-zinc-400 leading-relaxed max-w-2xl">
            Faculty leads supervising arena production, cultural competitions, fine arts curation, and campus logistics — the institutional spine of Saviskar 2026.
          </p>
        </div>

        {/* Rich per-person bio copy — 4 paragraphs each to fill vertical space */}
        {(() => {
          const DIRECTORATE_BIOS: Record<string, string[]> = {
            "ad-vaibhav-kelay": [
              "Mr. Vaibhav Kelay is the creative engine behind every cultural spectacle at Saviskar 2026. As Assistant Director Cultural, he architects the full spectrum of artistic programming — from national-level fine arts competitions and classical music recitals to modern dance showcases and spoken-word arenas — ensuring each event carries both cultural authenticity and stadium-scale impact.",
              "His curatorial philosophy centres on discovering and amplifying student talent from across the country. Under his directorship, Saviskar has evolved into one of North India's most sought-after platforms for emerging artists, drawing participants from 11 states who compete, collaborate, and create under a single, electrifying banner.",
              "Mr. Kelay oversees the entire production pipeline for the flagship Star Night headline concerts — from artist liaison and stage design briefs to sound-system engineering and crowd choreography. His attention to the lived experience of every audience member is what transforms a concert into a memory that outlasts the event itself.",
              "Department of Cultural Affairs & Student Development, CGC University — his domain is the heartbeat of Aevorian Reverie, and the roar of the stadium crowd is the truest measure of his craft.",
            ],
            "mgr-monika-dhaliwal": [
              "Mrs. Monika Dhaliwal brings a rare combination of institutional authority and artistic sensitivity to the role of Senior Manager, Department of Student Affairs. Her oversight spans multi-genre fine arts curation, inter-college theatrical productions, craft pavilions, and the cultural co-ordination committees that synchronise dozens of simultaneous festival verticals.",
              "A steadfast advocate for inclusive artistic expression, Mrs. Dhaliwal ensures that every category of cultural competition — from classical Bharatanatyam to contemporary street art installations — is judged, staged, and celebrated with equal rigor and respect. Under her guidance, the Saviskar fine arts pavilion has grown into an exhibition space that rivals dedicated arts festivals in scope and curation.",
              "Her administrative precision ensures that no artist arrives on stage under-rehearsed, no jury convenes without a clear rubric, and no performance goes undocumented. The institutional memory she maintains across departments is what makes Saviskar 2026 feel like a well-oiled creative machine even in its most complex, high-stakes moments.",
              "Department of Student Affairs, CGC University — Mrs. Dhaliwal's contribution is the invisible scaffold on which Aevorian Reverie's cultural grandeur stands.",
            ],
            "ops-anand-kumar": [
              "Mr. Anand Kumar commands the entire operational backbone of Saviskar 2026. As Operations Command, he is responsible for the physical transformation of CGC University's campus — converting open grounds, corridors, and auditoriums into world-class festival venues with precision staging, broadcast-grade electrical grids, and seamless crowd-management infrastructure.",
              "His team deploys and monitors over a dozen simultaneous technical setups across the festival's multi-venue footprint. From PA system calibration in open-air arenas to generator fail-safes and emergency lighting in enclosed theatres, Mr. Kumar's operational playbook leaves nothing to chance. Every contingency has a protocol; every protocol has an owner.",
              "Security architecture is among his most critical responsibilities. Coordinating with university administration, local authorities, and event security contractors, he designs and enforces entry management systems that ensure the safety of 35,000+ delegates without sacrificing the vibrancy of the festival atmosphere. His approach — thorough, calm, and adaptive — sets the professional standard for campus-scale event operations in the region.",
              "Festival Logistics & Infrastructure Management — the infrastructure Mr. Kumar builds over months disappears into the background during the festival, which is precisely the hallmark of exceptional operations leadership.",
            ],
            "ops-aditya": [
              "Mr. Aditya is the living voice of Saviskar 2026. As Lead Stage Anchor and Youth Engagement Director, he commands the microphone at every flagship event — from the opening ceremony that sets the festival's tone to the closing gala that sends thousands of students home with a story worth telling. His stage presence is magnetic, his timing instinctive, and his ability to hold a crowd's attention through technical transitions seamless.",
              "Beyond individual performances, Mr. Aditya designs and runs the student delegate liaison programme — the human bridge between incoming participants from across India and the Saviskar organisational machine. His team ensures that every student who arrives at CGC University for Saviskar 2026 feels informed, welcomed, and energised from the first checkpoint to the final curtain.",
              "He also leads the youth engagement initiatives that build festival anticipation in the months before doors open — hosting campus activations, digital countdown events, and orientation workshops that prime thousands of first-time festival-goers for the Aevorian Reverie experience. His energy is contagious, and it cascades from the stage through the crowd and out into the wider student community.",
              "Student Engagement & Stage Protocol, CGC University — when Mr. Aditya steps to the mic, Saviskar 2026 does not just begin; it ignites.",
            ],
          };

          return [...LEVEL_3_CULTURAL_DIRECTORATE, ...LEVEL_4_OPERATIONS_COMMAND].map((faculty, idx) => {
            const richBio = DIRECTORATE_BIOS[faculty.id];
            const paragraphs = richBio ?? [
              faculty.bio ?? `${faculty.name} oversees a critical domain of Saviskar 2026 — bringing institutional expertise, operational precision, and creative vision to every facet of festival execution.`,
              `${faculty.department ?? "CGC University"} — one of the pillars on which Aevorian Reverie stands.`,
            ];
            return (
              <DeskEditorialSpread
                key={faculty.id}
                titleBadge={`FESTIVAL DIRECTORATE // ${(faculty.honorific ?? "FACULTY").toUpperCase()}`}
                deskTitle={(faculty.designation ?? faculty.honorific ?? "").toUpperCase()}
                paragraphs={paragraphs}
                signeeName={faculty.name ?? ""}
                signeeRole={faculty.designation ?? (faculty.honorific ?? "")}
                initials={(faculty.name ?? "??").split(" ").filter((n) => !["Dr.", "Mrs.", "Mr.", "Ms."].includes(n)).slice(0, 2).map((n) => n[0]).join("")}
                image={faculty.image ?? ""}
                accentColor={idx % 2 === 0 ? "violet" : "cyan"}
                align={idx % 2 === 0 ? "left" : "right"}
              />
            );
          });
        })()}
      </div>

      {/* ════════════════════════════════════════════════════
          4. SAC PRESIDENCY
      ════════════════════════════════════════════════════ */}
      <section
        id="sac-presidency"
        className="relative z-20 py-16 sm:py-20"
        style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="flex flex-col md:flex-row md:items-start min-h-[560px] sm:min-h-[640px]">

          {/* LEFT — text */}
          <div className="flex flex-col px-4 sm:px-6 lg:px-8 md:pl-8 lg:pl-16 md:w-1/2 py-12 md:pt-0">
            <div className="mb-8">
              <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-violet-400 mb-3 flex items-center gap-2">
                <span className="h-px w-6 bg-violet-500/40" />
                {EDITORIAL_PRESIDENCY.titleBadge}
              </div>
              <h2 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white tracking-tight leading-[1.05]">
                Student Advisory<br />Council Presidency
              </h2>
            </div>

            {/* Body — no drop cap, clean sans-serif */}
            <div className="space-y-4 text-sm sm:text-base text-zinc-300 leading-relaxed text-justify">
              {EDITORIAL_PRESIDENCY.paragraphs.map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          </div>

          {/* RIGHT — SAC Group Photo */}
          <div className="relative md:w-1/2 min-h-[420px] md:min-h-full bg-zinc-950 flex-shrink-0 self-stretch group overflow-hidden border-t md:border-t-0 md:border-l border-white/[0.08]">
            {/* Ambient background glow */}
            <div
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(139,92,246,0.2)_0%,transparent_70%)]"
              aria-hidden="true"
            />

            {/* Clickable Image Container */}
            <div
              onClick={() => setIsPhotoLightboxOpen(true)}
              className="relative w-full h-full min-h-[420px] md:min-h-[580px] cursor-pointer overflow-hidden"
              title="Click to view full SAC 2026-2027 group portrait in high resolution"
            >
              <Image
                src="/images/SAC/SAC-26-27.png"
                alt="Student Advisory Council (SAC 2026-2027) Group Photo"
                fill
                priority
                sizes="(max-width: 768px) 100vw, 50vw"
                className="object-cover object-center transition-all duration-700 ease-out group-hover:scale-105"
              />

              {/* Edge Gradient Fades for atmospheric integration */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 pointer-events-none" />
              <div className="hidden md:block absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-black/90 to-transparent pointer-events-none" />

              {/* Top Tech Badge */}
              <div className="absolute top-4 right-4 z-10">
                <div className="liquid-glass inline-flex items-center gap-2 rounded-full px-3 py-1 font-mono text-[9.5px] uppercase tracking-[0.2em] text-violet-300 border border-violet-400/30 bg-black/60 shadow-[0_0_15px_rgba(139,92,246,0.3)] backdrop-blur-md">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>SAC 2026–2027 // OFFICIAL GROUP</span>
                </div>
              </div>

              {/* Bottom Expand Prompt */}
              <div className="absolute bottom-4 left-4 right-4 z-10 flex items-center justify-between pointer-events-none">
                <div className="inline-flex items-center gap-2 rounded-lg bg-black/75 px-3 py-1.5 font-mono text-[10px] tracking-wider text-zinc-300 border border-white/10 backdrop-blur-md">
                  <Maximize2 size={12} className="text-violet-400" />
                  <span>53 Student Leaders // Click to Expand</span>
                </div>
                <span className="font-mono text-[9px] uppercase tracking-widest text-violet-300 bg-violet-950/60 border border-violet-500/30 px-2 py-1 rounded">
                  5.7K MASTER
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════
          5. SAC OPERATIONAL WINGS
      ════════════════════════════════════════════════════ */}
      <div id="sac-wings">
        <SacEditorialSection />
      </div>

      {/* ════════════════════════════════════════════════════
          FOOTER CTA
      ════════════════════════════════════════════════════ */}
      <section className="relative z-20 mt-12 border-t border-white/[0.06] bg-gradient-to-b from-transparent to-black py-16 px-4 text-center">
        <div className="mx-auto max-w-3xl flex flex-col items-center">
          <div className="liquid-glass inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-mono text-violet-300 mb-4 shadow-[0_0_15px_rgba(168,85,247,0.2)]">
            <Sparkles size={12} />
            <span>JOIN 35,000+ PARTICIPANTS NATIONWIDE</span>
          </div>

          <h3 className="text-2xl sm:text-4xl font-bold text-white tracking-tight">
            Ready to Experience{" "}
            <span className="font-editorial italic text-violet-300 font-normal">
              Saviskar 2026?
            </span>
          </h3>

          <p className="mt-3 text-sm text-white/60 leading-relaxed max-w-xl mx-auto">
            50+ realms across technology, national hackathons, cultural arts, and stadium concerts. Register now to secure your digital gate pass.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register"
              className="liquid-glass inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold text-white border-violet-500/50 bg-violet-600/30 transition-all hover:bg-violet-600/40 hover:scale-105 shadow-[0_0_25px_rgba(168,85,247,0.35)]"
            >
              <span>Fast-Track Registration</span>
              <ArrowUpRight size={14} />
            </Link>

            <Link
              href="/events"
              className="liquid-glass-interactive inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white/80 transition-all hover:text-white"
            >
              <span>View All 4 Realms</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ── HIGH RESOLUTION SAC GROUP PHOTO LIGHTBOX MODAL ── */}
      {isPhotoLightboxOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-3 sm:p-6 backdrop-blur-2xl animate-fade-in"
          onClick={() => setIsPhotoLightboxOpen(false)}
        >
          {/* Close button */}
          <button
            onClick={() => setIsPhotoLightboxOpen(false)}
            aria-label="Close Lightbox"
            className="absolute top-5 right-5 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white hover:text-black transition-all"
          >
            <X size={20} />
          </button>

          {/* Modal Header */}
          <div className="absolute top-5 left-5 z-50 flex items-center gap-3 pointer-events-none">
            <div className="liquid-glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-violet-300 border border-violet-400/30 bg-black/80 backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>SAC 2026–2027 // OFFICIAL FULL ARCHITECTURE (53 MEMBERS)</span>
            </div>
          </div>

          {/* Modal Image Display */}
          <div
            className="relative max-h-[85vh] max-w-[95vw] w-full h-full flex items-center justify-center overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative w-full h-full max-w-6xl max-h-[80vh] rounded-2xl overflow-hidden border border-white/15 shadow-[0_0_50px_rgba(139,92,246,0.3)]">
              <Image
                src="/images/SAC/SAC-26-27.png"
                alt="Student Advisory Council (SAC 2026-2027) High Resolution Master"
                fill
                unoptimized
                className="object-contain"
                priority
              />
            </div>
          </div>

          {/* Modal Footer Controls */}
          <div
            className="absolute bottom-5 inset-x-0 flex items-center justify-center gap-3 z-50"
            onClick={(e) => e.stopPropagation()}
          >
            <a
              href="/images/SAC/SAC-26-27.png"
              download="SAC-2026-2027-Full-Group-Photo.png"
              className="liquid-glass inline-flex items-center gap-2 rounded-full px-4 py-2 font-mono text-xs uppercase tracking-wider text-white border border-white/20 bg-white/10 hover:bg-white hover:text-black transition-all shadow-[0_0_20px_rgba(255,255,255,0.2)]"
            >
              <Download size={14} />
              <span>Download Original 5.7K Master</span>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
