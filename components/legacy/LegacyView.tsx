"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import DeskEditorialSpread from "@/components/team/DeskEditorialSpread";
import Navbar from "@/components/ui/Navbar";

// ============================================================
// DIGNITARIES DATA
// Sequence: 1. Rashpal, 2. Arsh, 3. Bismin, 4. Simran, 5. Sushil, 6. Vinay, 7. Anish
// ============================================================
const DIGNITARIES = [
  {
    id: "chancellor-rashpal",
    titleBadge: "INSTITUTIONAL FOUNDER // CHANCELLOR",
    deskTitle: "MR. RASHPAL SINGH DHALIWAL",
    dropCap: "T",
    paragraphs: [
      "he story of Saviskar begins here — with a single unwavering belief that education must ignite, not merely inform. Mr. Rashpal Singh Dhaliwal, Chancellor of CGC University, transformed a vision of academic excellence into one of North India's most dynamic university ecosystems.",
      "Under his stewardship, CGC has grown into a nationally ranked institution where technical brilliance meets cultural vitality. Saviskar 2026 — Aevorian Reverie — is the living proof of that founding philosophy: that a university campus should be a stage for the boldest ideas and the most fearless human expression.",
      "His legacy is not built in stone. It is built in every student who steps onto this campus, finds their calling, and carries it forward.",
    ],
    signeeName: "Mr. Rashpal Singh Dhaliwal",
    signeeRole: "Chancellor // CGC Group of Colleges",
    initials: "RD",
    accent: "amber" as const,
    align: "left" as const,
    image: "/images/legacy/rashpal-singh-dhaliwal-v2.webp",
  },
  {
    id: "md-arsh-dhaliwal",
    titleBadge: "EXECUTIVE LEADERSHIP // MANAGING DIRECTOR",
    deskTitle: "MR. ARSH DHALIWAL",
    dropCap: "A",
    paragraphs: [
      "new generation of leadership defines the modern university — one that speaks fluently in both the language of industry and the language of aspiration. Mr. Arsh Dhaliwal, Worthy Managing Director, brings this duality with remarkable clarity and drive.",
      "His conviction that student achievement is the highest institutional metric has shaped every strategic decision at CGC University. Saviskar 2026 stands as his direct mandate: an invitation to 35,000+ participants to prove that student-led excellence can rival any professional production in scale, quality, and imagination.",
      "The arena is set. The directive is clear. Aevorian Reverie is his challenge to every student who dares to be extraordinary.",
    ],
    signeeName: "Mr. Arsh Dhaliwal",
    signeeRole: "Worthy Managing Director // CGC University",
    initials: "AD",
    accent: "violet" as const,
    align: "right" as const,
    image: "/images/legacy/arsh-dhaliwal-v2.webp",
  },
  {
    id: "director-bismin",
    titleBadge: "CHIEF PATRON MANIFESTO // DIRECTOR STUDENT AFFAIRS",
    deskTitle: "MRS. BISMIN DHALIWAL",
    dropCap: "S",
    paragraphs: [
      "aviskar 2026 is a celebration of fearless imagination, youthful tenacity, and intellectual wonder. When 35,000+ passionate students converge at CGC University, Mohali, tomorrow begins to exist.",
      "Aevorian Reverie is not merely a date on our academic calendar — it is a proving ground where bold concepts transform into living realities. Across technical arenas, research hackathons, and stadium-scale cultural showcases, our students demonstrate that youth is not just preparing for the future; they are actively architecting it.",
      "To every competitor, visionary, and guest stepping onto our campus: immerse yourselves completely. Let curiosity guide your inquiries, let passion fuel your performances, and let the camaraderie forged here endure for a lifetime. I applaud our Student Advisory Council whose tireless devotion elevates Saviskar into an unforgettable national benchmark.",
    ],
    signeeName: "Mrs. Bismin Dhaliwal",
    signeeRole: "Director Students Affairs // Chief Patron, Saviskar 2026",
    initials: "BD",
    accent: "emerald" as const,
    align: "left" as const,
    image: "/images/legacy/bismin-dhaliwal-v2.webp",
  },
  {
    id: "director-simran-dhaliwal",
    titleBadge: "GLOBAL ENGAGEMENT // DIRECTOR INTERNATIONAL AFFAIRS",
    deskTitle: "MS. SIMRAN DHALIWAL",
    dropCap: "G",
    paragraphs: [
      "lobal horizons and cross-cultural dialogue define the frontier of contemporary university education. Ms. Simran Dhaliwal, Director of International Affairs, champions this global perspective, connecting CGC University with premier international institutions, research collaboratives, and cultural networks worldwide.",
      "Her leadership has fostered global partnerships that enrich the academic and creative journey of our students, bringing global benchmarks directly to our campus in Mohali. Saviskar 2026 reflects this internationalized outlook — elevating Aevorian Reverie into a truly cosmopolitan celebration welcoming diverse talents, global delegates, and world-class standards.",
      "Through her dedication to international immersion, cultural diplomacy, and student empowerment, Ms. Dhaliwal inspires young minds to represent CGC University on the global stage with poise, ambition, and distinction.",
    ],
    signeeName: "Ms. Simran Dhaliwal",
    signeeRole: "Director International Affairs // CGC University, Mohali",
    initials: "SD",
    accent: "cyan" as const,
    align: "right" as const,
    image: "/images/legacy/simran-dhaliwal-v2.webp",
  },
  {
    id: "evp-shushil-prashar",
    titleBadge: "EXECUTIVE GOVERNANCE // EXECUTIVE VICE PRESIDENT",
    deskTitle: "DR. SHUSHIL PRASHAR",
    dropCap: "S",
    paragraphs: [
      "trategic vision and administrative excellence form the bedrock upon which world-class educational institutions thrive. Dr. Shushil Prashar, Executive Vice President of CGC University, Mohali, steers institutional operations with an extraordinary blend of visionary acumen and pragmatic leadership.",
      "His stewardship across academic infrastructure, campus development, and stakeholder synergy ensures CGC University remains at the cutting edge of higher education in North India. In Saviskar 2026: Aevorian Reverie, Dr. Prashar's commitment to creating an unmatched student experience is evident across every competitive arena, grand stage, and delegate facilitation gateway.",
      "By empowering faculty and student bodies alike to think beyond traditional confines, he champions an institutional environment where innovation is celebrated and collegiate milestones are continually surpassed.",
    ],
    signeeName: "Dr. Shushil Prashar",
    signeeRole: "Executive Vice President // CGC University, Mohali",
    initials: "SP",
    accent: "amber" as const,
    align: "left" as const,
    image: "/images/legacy/shushil-prashar-v2.webp",
  },
  {
    id: "vc-vinay-goyal",
    titleBadge: "ACADEMIC APEX // VICE CHANCELLOR",
    deskTitle: "DR. VINAY GOYAL",
    dropCap: "E",
    paragraphs: [
      "xcellence in academia is not a destination — it is a daily practice, a commitment renewed in every lecture hall, every laboratory, and every competitive arena. Dr. Vinay Goyal, Vice Chancellor of CGC University, embodies this philosophy with quiet, relentless purpose.",
      "His tenure has been defined by a singular ambition: to align academic rigour with the real demands of a rapidly evolving world. Saviskar 2026 is the most visible expression of that alignment — where students compete not just for prizes, but for the experience of operating at a professional standard.",
      "In every event at Aevorian Reverie, the standards he has set for CGC University are reflected. The pursuit of excellence is non-negotiable. The opportunity to achieve it, unlimited.",
    ],
    signeeName: "Dr. Vinay Goyal",
    signeeRole: "Vice Chancellor // CGC University, Mohali",
    initials: "VG",
    accent: "cyan" as const,
    align: "right" as const,
    image: "/images/legacy/vinay-goyal-v2.webp",
  },
  {
    id: "provc-anish-goyal",
    titleBadge: "ACADEMIC GOVERNANCE // PRO VICE CHANCELLOR",
    deskTitle: "DR. ANISH GOYAL",
    dropCap: "T",
    paragraphs: [
      "he architecture of a great academic institution is built on two pillars: the rigour of its curriculum and the spirit of its community. Dr. Anish Goyal, Pro Vice Chancellor (Academics), holds both with unwavering dedication and a deep understanding of what it means to lead a modern university.",
      "His academic governance has ensured that CGC University's programmes evolve in step with industry demands, and that the student experience remains the centrepiece of every institutional decision. Saviskar 2026 is the annual crystallisation of that student-centred philosophy.",
      "From admissions to alumni, from the classroom to the concert stage, Dr. Goyal's influence shapes the CGC ecosystem that makes an Aevorian Reverie not just possible — but inevitable.",
    ],
    signeeName: "Dr. Anish Goyal",
    signeeRole: "Pro Vice Chancellor (Academics) // CGC University",
    initials: "AG",
    accent: "violet" as const,
    align: "left" as const,
    image: "/images/legacy/anish-goyal-v2.webp",
  },
] as const;

// ============================================================
// TEAM DSA GROUP SPREAD DATA
// ============================================================
const DSA_BIO = [
  "he Department of Student Affairs at CGC University is the living engine of Saviskar 2026. Behind every event announcement, every registration window, every artist liaison, and every logistical triumph is this department — a cohesive, relentless team of faculty and professional staff who transform institutional vision into on-ground reality.",
  "From coordinating national outreach campaigns across 11 states to managing the operational choreography of a 35,000-strong festival, Team DSA operates with a precision that is rarely visible and always essential. They are the unseen architecture of Aevorian Reverie.",
  "Saviskar 2026 is a student festival, built by students. But it stands on the institutional foundation that Team DSA pours every year — with expertise, commitment, and an extraordinary belief in what young people can achieve when given the right stage.",
];

// ============================================================
// ALUMNI DIGNITARIES DATA (DeskEditorialSpread format)
// ============================================================
const ALUMNI_DIGNITARIES = [
  {
    id: "alumni-abrar-nazir",
    titleBadge: "EXECUTIVE STEWARD // DSA ALUMNUS & MENTOR",
    deskTitle: "MR. ABRAR NAZIR",
    paragraphs: [
      "Behind every grand festival is an unseen operational anchor who transforms complex logistics into flawless execution. Mr. Abrar Nazir, Ex-Assistant Manager, Department of Student Affairs, was that foundational force during the formative editions of Saviskar at CGC University, Mohali.",
      "His operational stewardship and calm resolve under the intense pressure of multi-day festival schedules provided a steady rudder for successive student organising bodies. From coordinating late-night stage technical setups and multi-contingent university hospitality to unblocking urgent on-ground roadblocks, his dedication to the student community set the benchmark for collegiate festival management.",
      "Mr. Nazir's legacy is etched into the very DNA of Saviskar's ground operations. The protocols he established, the student leaders he mentored, and the institutional standards he championed continue to guide and inspire Team DSA as Saviskar 2026 scales to national heights.",
    ],
    signeeName: "Mr. Abrar Nazir",
    signeeRole: "Ex-Assistant Manager // Department of Student Affairs (DSA)",
    initials: "AN",
    accent: "amber" as const,
    align: "left" as const,
  },
  {
    id: "alumni-sac-2024-2025",
    titleBadge: "COUNCIL ARCHITECTS // GRADUATING BATCH 2024–2025",
    deskTitle: "PASSED OUT STUDENTS OF SAC (2024–2025)",
    paragraphs: [
      "A generation of student leaders whose audacity redefined the limits of what a university festival could achieve. The passed-out council members of the Student Advisory Council (SAC 2024–2025) inherited a growing tradition and transformed it into a stadium-scale national powerhouse.",
      "Under their leadership, Saviskar expanded across 11 states, drawing thousands of incoming delegates, integrating cutting-edge combat robotics arenas, and staging unforgettable Star Night headliners that shook the Mohali grounds. Their relentless hustle in securing brand sponsorships, curating multi-genre realms, and managing backstage choreography proved that student leadership can rival any professional event production.",
      "To the graduating cohort of SAC 2024–2025: your passion, late-night war room sessions, and unbreakable bond of camaraderie built the immediate runway from which Saviskar 2026: Aevorian Reverie now takes flight. We salute your enduring contribution.",
    ],
    signeeName: "Passed Out Students of SAC (2024–2025)",
    signeeRole: "Graduating Core Leads & Council Members // Student Advisory Council",
    initials: "SAC",
    accent: "violet" as const,
    align: "right" as const,
    image: "/images/legacy/sac-2024-2025-v2.webp",
    imageAspect: "group" as const,
  },
  {
    id: "alumni-sac-2023-2024",
    titleBadge: "INAUGURAL TRAILBLAZERS // FOUNDING BATCH 2023–2024",
    deskTitle: "PASSED OUT STUDENTS OF SAC (2023–2024)",
    paragraphs: [
      "Every grand legacy starts with the courageous few who dare to build where nothing stood before. The passed-out students of the Student Advisory Council (SAC 2023–2024) were the pioneers who laid the very cornerstone of the Saviskar phenomenon at CGC University.",
      "With no existing blueprint and unprecedented challenges, this founding council authored the original governance charter, conceived the realm structures, and worked through freezing nights and blazing afternoons to turn an institutional dream into living reality. They laid the physical cables, carried the stage gear, and inspired their peers to believe in the vision of a national mega-festival.",
      "Without the courage of SAC 2023–2024 to take that inaugural leap of faith, there would be no Aevorian Reverie today. Their names, sacrifices, and foundational grit remain permanently enshrined in the institutional memory of CGC University, Mohali.",
    ],
    signeeName: "Passed Out Students of SAC (2023–2024)",
    signeeRole: "Founding Council & Pioneering Core Leads // Student Advisory Council",
    initials: "SAC",
    accent: "cyan" as const,
    align: "left" as const,
    image: "/images/legacy/sac-2023-2024-v2.webp",
    imageAspect: "group" as const,
  },
] as const;

// ============================================================
// LEGACY VIEW
// ============================================================
export default function LegacyView() {
  return (
    <div className="relative min-h-screen bg-black text-white selection:bg-white selection:text-black overflow-x-hidden">

      {/* ── Subtle background ambient field ── */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(168,85,247,0.07)_0%,transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom-right,rgba(6,182,212,0.05)_0%,transparent_50%)]" />
      </div>

      {/* ── UNIVERSAL SITE NAVBAR ── */}
      <Navbar />

      {/* ══════════════════════════════════════════════════════
          PAGE HERO — pure typographic opener
      ══════════════════════════════════════════════════════ */}
      <section className="relative z-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pt-28 pb-16 md:pt-36">
        <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-violet-400 mb-4">
          Institutional Patrons // Festival Heritage
        </div>
        <h1 className="font-editorial text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold text-white tracking-tight leading-[1.0]">
          The Legacy
        </h1>
        <p className="mt-5 text-base sm:text-lg text-zinc-400 font-light leading-relaxed max-w-2xl">
          The visionaries who built the institution, defined its mission, and made Saviskar 2026 — Aevorian Reverie — possible. Rendered here as they deserve: in full.
        </p>
        <div className="mt-8 flex items-center gap-4">
          <span className="h-px flex-1 bg-white/[0.05]" />
          <span className="font-mono text-[9px] tracking-[0.3em] text-white/20 uppercase flex-shrink-0">
            {DIGNITARIES.length} Distinguished Patrons // CGC University
          </span>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          DIGNITY SPREADS — one per person, alternating
      ══════════════════════════════════════════════════════ */}
      <div className="relative z-20">
        {DIGNITARIES.map((person) => (
          <div
            key={person.id}
            style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
          >
            <DeskEditorialSpread
              titleBadge={person.titleBadge}
              deskTitle={person.deskTitle}
              paragraphs={[
                (person.dropCap || "") + person.paragraphs[0],
                ...person.paragraphs.slice(1),
              ]}
              signeeName={person.signeeName}
              signeeRole={person.signeeRole}
              initials={person.initials}
              image={"image" in person && person.image ? person.image : ""}
              accentColor={person.accent ?? "violet"}
              align={person.align}
            />
          </div>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════
          8. TEAM DSA GROUP FEATURE
      ══════════════════════════════════════════════════════ */}
      <section
        className="relative z-20 mt-8"
        style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
      >
        {/* Section header */}
        <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pt-16 pb-10">
          <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-emerald-400 mb-3">
            Department of Student Affairs // Institutional Engine
          </div>
          <h2 className="font-editorial text-4xl sm:text-5xl md:text-6xl font-bold text-white tracking-tight leading-[1.0]">
            Team DSA
          </h2>
          <p className="mt-3 text-sm sm:text-base text-zinc-400 font-light leading-relaxed max-w-xl">
            The faculty and professional staff whose expertise, coordination, and institutional authority underpin every moment of Saviskar 2026.
          </p>
        </div>

        {/* Full-bleed group photo banner */}
        <div className="relative w-full overflow-hidden bg-zinc-950" style={{ height: "clamp(300px, 45vw, 580px)" }}>
          <Image
            src="/images/legacy/team-dsa-group-v2.webp"
            alt="Team DSA — Department of Student Affairs"
            fill
            unoptimized
            className="object-cover object-center opacity-40 hover:opacity-70 transition-opacity duration-700"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-emerald-950/40 via-black/60 to-black/80">
            {/* Scan texture */}
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.02]"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(255,255,255,0.9) 3px,rgba(255,255,255,0.9) 4px)",
              }}
            />
            <div className="flex flex-col items-center gap-4 select-none relative z-10">
              <span
                className="font-editorial font-black text-white leading-none tracking-tighter"
                style={{ fontSize: "clamp(4rem, 15vw, 12rem)", opacity: 0.08 }}
                aria-hidden="true"
              >
                DSA
              </span>
              <div className="liquid-glass inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[10px] font-mono tracking-[0.25em] text-emerald-300 uppercase shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Department of Student Affairs // Institutional Engine</span>
              </div>
            </div>
          </div>
          {/* Bottom gradient fade */}
          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black to-transparent" />
        </div>

        {/* Description block — full editorial text */}
        <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto py-16">
          <div className="max-w-4xl">
            {/* Drop-cap first paragraph */}
            <div className="text-base sm:text-lg md:text-xl text-zinc-200 leading-relaxed font-light text-justify">
              <span className="float-left font-editorial font-bold text-[5.5rem] sm:text-[6.5rem] leading-[0.82] pr-3 pt-1 select-none text-emerald-400">
                T
              </span>
              {DSA_BIO[0].slice(1)}
            </div>

            {/* Remaining paragraphs */}
            <div className="mt-6 space-y-5 text-sm sm:text-base text-zinc-300/80 leading-[1.85] font-light text-justify">
              {DSA_BIO.slice(1).map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>

            {/* DSA attribution */}
            <div className="mt-10 pt-6" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="font-editorial text-2xl sm:text-3xl font-semibold text-white leading-tight">
                Department of Student Affairs
              </div>
              <div className="font-mono text-[10px] tracking-widest uppercase mt-2 text-emerald-300/70">
                Institutional Operations &amp; Student Welfare // CGC University, Mohali
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          OUR ALUMNI & MENTORS — EDITORIAL SPREADS
      ══════════════════════════════════════════════════════ */}
      <section
        className="relative z-20 mt-16"
        style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
      >
        {/* Section Header */}
        <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pt-20 pb-12">
          <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-amber-400 mb-3 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse shadow-[0_0_8px_#f59e0b]" />
            <span>THE FOUNDATIONAL CORPS // CHERISHED MENTORS &amp; COHORTS</span>
          </div>
          <h2 className="font-editorial text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white tracking-tight leading-[1.05]">
            Our Alumni &amp; Mentors
          </h2>
          <p className="mt-4 text-base sm:text-lg text-zinc-400 font-light leading-relaxed max-w-2xl">
            Rendered in full honour: the foundational leadership, mentors, and graduating student councils whose grit, imagination, and tireless devotion built the bedrock on which Saviskar 2026 stands.
          </p>
          <div className="mt-8 flex items-center gap-4">
            <span className="h-px flex-1 bg-white/[0.05]" />
            <span className="font-mono text-[9px] tracking-[0.3em] text-white/20 uppercase flex-shrink-0">
              3 Distinguished Citations // CGC University &amp; SAC
            </span>
          </div>
        </div>

        {/* Editorial Spreads — identical format to MD, VC, and Pro-VC */}
        <div className="relative z-20">
          {ALUMNI_DIGNITARIES.map((person) => (
            <div
              key={person.id}
              style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
            >
              <DeskEditorialSpread
                titleBadge={person.titleBadge}
                deskTitle={person.deskTitle}
                paragraphs={person.paragraphs as unknown as string[]}
                signeeName={person.signeeName}
                signeeRole={person.signeeRole}
                initials={person.initials}
                image={"image" in person && person.image ? person.image : ""}
                accentColor={person.accent ?? "amber"}
                align={person.align}
                imageAspect={"imageAspect" in person ? person.imageAspect : "portrait"}
              />
            </div>
          ))}
        </div>

        {/* Alumni Manifesto Banner */}
        <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto py-16">
          <div className="relative overflow-hidden rounded-3xl border border-amber-500/20 bg-gradient-to-br from-amber-950/20 via-zinc-950/90 to-black p-8 sm:p-12 backdrop-blur-xl">
            <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-amber-500/10 blur-[100px]" />
            <div className="pointer-events-none absolute -left-20 -bottom-20 h-72 w-72 rounded-full bg-violet-500/10 blur-[100px]" />

            <div className="relative z-10 max-w-4xl mx-auto text-center">
              <span className="font-editorial text-6xl text-amber-400/40 select-none leading-none">“</span>
              <p className="font-editorial text-xl sm:text-2xl md:text-3xl text-zinc-100 font-light leading-snug -mt-4">
                We poured our hearts into the foundation so that you could touch the stars.
                Saviskar was never just an annual festival — it was our forge, our family, and our rite of passage.
                Seeing it illuminate the nation today is the greatest legacy we could have ever dreamed of.
              </p>
              <div className="mt-6 flex items-center justify-center gap-3">
                <div className="h-0.5 w-8 bg-amber-400" />
                <div className="font-mono text-xs uppercase tracking-wider text-amber-300">
                  The Alumni Council &amp; Past Organising Committees // CGC University
                </div>
                <div className="h-0.5 w-8 bg-amber-400" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          FOOTER CTA
      ══════════════════════════════════════════════════════ */}
      <section className="relative z-20 border-t border-white/[0.06] bg-gradient-to-b from-transparent to-black py-16 px-4 text-center">
        <div className="mx-auto max-w-2xl flex flex-col items-center">
          <div className="font-mono text-[9px] tracking-[0.3em] text-white/20 uppercase mb-4">
            Saviskar 2026 // Aevorian Reverie
          </div>
          <h3 className="text-3xl sm:text-4xl font-light text-white tracking-tight">
            Experience the{" "}
            <span className="font-editorial text-violet-300 font-normal italic">
              Festival
            </span>
          </h3>
          <p className="mt-3 text-sm text-white/40 leading-relaxed max-w-md">
            50+ competitive realms, stadium concerts, and 35,000+ participants. The stage is set at CGC University, Mohali.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/events"
              className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-all hover:bg-violet-100 hover:scale-105 shadow-[0_0_25px_rgba(255,255,255,0.2)]"
            >
              Explore Realms
            </Link>
            <Link
              href="/team"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 px-6 py-3 text-sm font-medium text-white/60 transition-all hover:text-white hover:border-white/20"
            >
              Meet the Team
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
