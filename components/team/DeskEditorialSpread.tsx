"use client";

import React, { useState } from "react";
import Image from "next/image";

export interface DeskEditorialSpreadProps {
  deskTitle: string;
  titleBadge?: string;
  paragraphs: string[];
  signeeName: string;
  signeeRole: string;
  image?: string;
  initials?: string;
  /** Visual accent: drives glow color and eyebrow color */
  accentColor?: "violet" | "cyan" | "emerald" | "amber";
  align?: "left" | "right";
  secondarySignees?: { name: string; role: string; initials?: string }[];
  imageAspect?: "portrait" | "group";
}

const ACCENT_TOKENS_MAP = {
  violet: {
    eyebrow: "text-violet-400",
    glow: "rgba(139, 92, 246, 0.18)",
    glowRing: "rgba(139,92,246,0.06)",
    signeeRole: "text-violet-400/70",
    cornerBorder: "border-violet-500/35",
    ghostText: "text-violet-300",
  },
  cyan: {
    eyebrow: "text-cyan-400",
    glow: "rgba(34, 211, 238, 0.14)",
    glowRing: "rgba(34,211,238,0.05)",
    signeeRole: "text-cyan-400/70",
    cornerBorder: "border-cyan-500/35",
    ghostText: "text-cyan-300",
  },
  emerald: {
    eyebrow: "text-emerald-400",
    glow: "rgba(52, 211, 153, 0.14)",
    glowRing: "rgba(52,211,153,0.05)",
    signeeRole: "text-emerald-400/70",
    cornerBorder: "border-emerald-500/35",
    ghostText: "text-emerald-300",
  },
  amber: {
    eyebrow: "text-amber-400",
    glow: "rgba(245, 158, 11, 0.14)",
    glowRing: "rgba(245,158,11,0.05)",
    signeeRole: "text-amber-400/70",
    cornerBorder: "border-amber-500/35",
    ghostText: "text-amber-300",
  },
};

export default function DeskEditorialSpread({
  deskTitle,
  titleBadge,
  paragraphs,
  signeeName,
  signeeRole,
  image,
  initials,
  accentColor = "violet",
  align = "left",
  secondarySignees,
  imageAspect = "portrait",
}: DeskEditorialSpreadProps) {
  const [imageError, setImageError] = useState(false);

  const displayInitials =
    initials ||
    signeeName
      .split(" ")
      .filter((n) => !["Dr.", "Mrs.", "Mr.", "Ms.", "&"].includes(n))
      .slice(0, 2)
      .map((n) => n[0])
      .join("");

  // Per-accent tokens with guaranteed fallback
  const accentTokens = ACCENT_TOKENS_MAP[accentColor as keyof typeof ACCENT_TOKENS_MAP] || ACCENT_TOKENS_MAP.violet;

  const hasValidImage = Boolean(image && image.trim() !== "" && !imageError);

  // ── Text column ──────────────────────────────────────────────────────────
  const TextContent = (
    <div className="flex flex-col justify-between h-full">
      <div className="space-y-4">
        {paragraphs.map((para, i) => (
          <p
            key={i}
            className="text-sm sm:text-base text-zinc-300 leading-relaxed text-justify"
          >
            {para}
          </p>
        ))}
      </div>

      {/* Signature block */}
      <div className="mt-10 pt-6" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
        {secondarySignees && secondarySignees.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {secondarySignees.map((sig, i) => (
              <div key={i}>
                <div className="text-base sm:text-lg font-semibold text-white leading-tight tracking-wide">
                  {sig.name}
                </div>
                <div className={`text-xs font-mono tracking-widest uppercase mt-1 ${accentTokens.signeeRole}`}>
                  {sig.role}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div>
            <div className="text-xl sm:text-2xl font-semibold text-white leading-tight tracking-wide">
              {signeeName}
            </div>
            <div className={`text-xs font-mono tracking-widest uppercase mt-1.5 ${accentTokens.signeeRole}`}>
              {signeeRole}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // ── Portrait / Group column ───────────────────────────────────────────────
  const VisualContent = (
    <div className="relative flex items-stretch justify-center w-full">
      {/* Ambient glow orb behind portrait */}
      <div
        className="pointer-events-none absolute inset-0 -inset-x-8"
        style={{
          background: `radial-gradient(circle at center, ${accentTokens.glow} 0%, transparent 70%)`,
          filter: "blur(40px)",
        }}
        aria-hidden="true"
      />

      {hasValidImage ? (
        imageAspect === "group" ? (
          <div className="relative w-full my-auto flex flex-col justify-center">
            {/* Ambient backdrop glow */}
            <div
              className="pointer-events-none absolute -inset-4 rounded-3xl opacity-40 blur-2xl"
              style={{
                background: `radial-gradient(ellipse at center, ${accentTokens.glow} 0%, transparent 70%)`,
              }}
            />
            {/* Framed Group Archive Card */}
            <div className="relative w-full aspect-[16/10] sm:aspect-[16/10.5] rounded-2xl border border-white/15 bg-zinc-950/90 overflow-hidden shadow-2xl group transition-all duration-500 hover:border-white/30 touch-pan-y">
              <Image
                src={image!}
                alt={signeeName}
                fill
                unoptimized
                className="object-cover object-center group-hover:scale-[1.02] transition-transform duration-700 pointer-events-none select-none"
                onError={() => setImageError(true)}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent pointer-events-none" />

              {/* Corner badge overlay */}
              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-none">
                <div className="liquid-glass inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[9px] font-mono tracking-widest text-white/80 uppercase">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>COUNCIL ARCHIVE // CGC UNIVERSITY</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div
            className="relative w-full h-[480px] sm:h-[560px] overflow-hidden pointer-events-none select-none touch-pan-y"
            style={{
              WebkitMaskImage: [
                "linear-gradient(to bottom, black 65%, transparent 100%)",
                align === "left"
                  ? "linear-gradient(to right, black 80%, transparent 100%)"
                  : "linear-gradient(to left, black 80%, transparent 100%)",
              ].join(", "),
              WebkitMaskComposite: "destination-in",
              maskImage: [
                "linear-gradient(to bottom, black 65%, transparent 100%)",
                align === "left"
                  ? "linear-gradient(to right, black 80%, transparent 100%)"
                  : "linear-gradient(to left, black 80%, transparent 100%)",
              ].join(", "),
              maskComposite: "intersect",
            }}
          >
            <Image
              src={image!}
              alt={signeeName}
              fill
              unoptimized
              className="object-cover object-top pointer-events-none select-none"
              onError={() => setImageError(true)}
            />
          </div>
        )
      ) : (
        /* Ghost initials placeholder */
        <div className="flex flex-col items-center justify-center py-20 sm:py-28 w-full">
          <div
            className={`font-bold leading-none select-none tracking-tighter ${accentTokens.ghostText}`}
            style={{ fontSize: "clamp(6rem, 18vw, 14rem)", opacity: 0.10 }}
            aria-hidden="true"
          >
            {displayInitials}
          </div>
          <div className="mt-5 font-mono text-[10px] sm:text-xs text-zinc-600 tracking-[0.3em] uppercase">
            Portrait forthcoming
          </div>
        </div>
      )}
    </div>
  );

  // ── Header — clean tech badge style ──────────────────────────────────────
  const Header = (
    <div className="text-center mb-12 sm:mb-16 relative">
      {/* Subtle radial glow behind header */}
      <div
        className="pointer-events-none absolute inset-0 scale-[2]"
        style={{
          background: `radial-gradient(ellipse at center, ${accentTokens.glowRing} 0%, transparent 65%)`,
        }}
        aria-hidden="true"
      />

      {titleBadge && (
        <div className={`relative font-mono text-[10px] uppercase tracking-[0.3em] mb-4 ${accentTokens.eyebrow} flex items-center justify-center gap-2`}>
          <span className="h-px w-8 bg-current opacity-40" />
          {titleBadge}
          <span className="h-px w-8 bg-current opacity-40" />
        </div>
      )}

      {/* Primary: role/title as bold display headline — NO serif, NO italic */}
      <h3 className="relative text-3xl sm:text-4xl md:text-5xl font-bold text-white tracking-tight leading-[1.05]">
        {deskTitle}
      </h3>

      {/* Secondary: person's name as mono subtitle */}
      <p className={`relative mt-3 font-mono text-xs uppercase tracking-[0.2em] ${accentTokens.eyebrow} opacity-80`}>
        {signeeName}
      </p>

      {/* Decorative thin rule */}
      <div className="relative mt-6 flex items-center justify-center gap-3">
        <span className="h-px w-20 sm:w-32 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{
            backgroundColor:
              accentColor === "violet"
                ? "rgba(139,92,246,0.6)"
                : accentColor === "cyan"
                ? "rgba(34,211,238,0.6)"
                : accentColor === "amber"
                ? "rgba(245,158,11,0.6)"
                : "rgba(52,211,153,0.6)",
          }}
        />
        <span className="h-px w-20 sm:w-32 bg-gradient-to-l from-transparent via-white/10 to-transparent" />
      </div>
    </div>
  );

  return (
    <section className="relative z-20 py-12 sm:py-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      {/* Corner bracket accents — top-left */}
      <div className={`absolute top-8 left-4 sm:left-6 lg:left-8 w-5 h-5 border-t border-l ${accentTokens.cornerBorder}`} />
      <div className={`absolute top-8 right-4 sm:right-6 lg:right-8 w-5 h-5 border-t border-r ${accentTokens.cornerBorder}`} />

      {Header}

      {/* Two-column spread — items-stretch keeps both columns equal height */}
      <div className={`grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-16 ${imageAspect === "group" ? "items-center" : "items-stretch"}`}>
        {align === "left" ? (
          <>
            <div className="md:col-span-7 h-full">{TextContent}</div>
            <div className={`md:col-span-5 ${imageAspect === "group" ? "" : "h-full self-stretch"}`}>{VisualContent}</div>
          </>
        ) : (
          <>
            <div className={`md:col-span-5 order-2 md:order-1 ${imageAspect === "group" ? "" : "h-full self-stretch"}`}>{VisualContent}</div>
            <div className="md:col-span-7 order-1 md:order-2 h-full">{TextContent}</div>
          </>
        )}
      </div>
    </section>
  );
}
