"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "motion/react";
import { ArrowRight, Sparkles, Ticket, CheckCircle2 } from "lucide-react";

function YoutubeIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

const headliners2026Teaser = [
  {
    dayBadge: "DAY 01 HEADLINER",
    artist: "ASEES KAUR",
    image: "/images/artists/artist-5-2026-day1.webp",
    imagePosition: "object-top",
    genre: "Bollywood Playback Powerhouse • Romantic Anthems & Pop Soul",
    tagline:
      "The award-winning voice behind Bollywood chart-busters 'Raataan Lambiyan', 'Makhna', 'Bolna', and 'Ve Maahi'. Turning 35,000+ voices into an electric ocean under the stadium sky.",
    status: "CONFIRMED • 28 OCT 2026",
    stage: "CGC MAINSTAGE ARENA",
  },
  {
    dayBadge: "DAY 02 GRAND FINALE",
    artist: "RANJIT BAWA",
    image: "/images/artists/artist-6-2026-day2.webp",
    imagePosition: "object-center",
    genre: "High-Octane Punjabi Folk • Bhangra Legend • Thumping Live Dhol",
    tagline:
      "The powerhouse pride of Punjab with legendary stadium anthems like 'Yaari Chandigarh Waliye', 'Jatt Di Akal', and 'Sher Marna' commanding the Saviskar 2026 Grand Finale.",
    status: "CONFIRMED • 29 OCT 2026",
    stage: "CGC MAINSTAGE ARENA",
  },
];

export default function StarNightReveal() {
  return (
    <section className="relative min-h-screen w-full overflow-hidden bg-black text-white py-24 md:py-32">
      {/* Blackout atmosphere */}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.4 }}
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_70%,rgba(168,85,247,0.18),transparent_55%)]"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.7 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 2, delay: 0.4 }}
        className="absolute left-1/2 top-[62%] h-[550px] w-[550px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-700/15 blur-[160px]"
      />

      {/* Dust / stars */}
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <span className="absolute left-[18%] top-[28%] h-1 w-1 rounded-full bg-purple-200/50" />
        <span className="absolute left-[72%] top-[22%] h-1 w-1 rounded-full bg-white/30" />
        <span className="absolute left-[82%] top-[55%] h-1 w-1 rounded-full bg-purple-200/40" />
        <span className="absolute left-[27%] top-[68%] h-1 w-1 rounded-full bg-white/25" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-6 text-center">
        {/* 01 — blackout headline */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.9 }}
        >
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/15 px-4 py-1.5 font-mono text-[9px] uppercase tracking-[0.35em] text-violet-300">
            SAVISKAR 2026 • THE STAGE IGNITES
          </div>

          <h2 className="mt-4 text-[clamp(2.5rem,8vw,7.5rem)] font-extrabold leading-[0.85] tracking-tight text-white">
            AND THEN... <br />
            <span className="bg-gradient-to-r from-violet-300 via-purple-300 to-indigo-300 bg-clip-text text-transparent">
              THE STAGE IGNITES.
            </span>
          </h2>
        </motion.div>

        {/* 02 — year badge */}
        <motion.div
          initial={{ opacity: 0, scale: 0.88, y: 30 }}
          whileInView={{ opacity: 1, scale: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 1.2, delay: 0.3 }}
          className="mt-12"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.55em] text-violet-400">
            SAVISKAR 2026 OFFICIAL LINEUP
          </p>

          <div className="mt-2 font-mono text-[clamp(4rem,14vw,11rem)] font-extrabold leading-[0.75] tracking-tight text-white drop-shadow-[0_0_50px_rgba(255,255,255,0.25)]">
            2026
          </div>

          <div className="mx-auto mt-6 h-px w-36 bg-gradient-to-r from-transparent via-violet-400/80 to-transparent" />
        </motion.div>

        {/* 03 — 2026 Headliners Teaser Showcase */}
        <div className="mt-14 w-full space-y-6 text-left">
          {headliners2026Teaser.map((item, idx) => (
            <motion.div
              key={item.dayBadge}
              initial={{ opacity: 0, y: 35 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: 0.2 + idx * 0.15 }}
              className="group relative overflow-hidden border border-white/20 bg-gradient-to-b from-white/[0.08] to-black/85 p-8 backdrop-blur-xl transition-all hover:border-violet-500/60 hover:shadow-[0_0_50px_rgba(168,85,247,0.25)] md:p-10"
              style={{
                clipPath:
                  "polygon(0 16px, 16px 0, calc(100% - 16px) 0, 100% 16px, 100% calc(100% - 16px), calc(100% - 16px) 100%, 16px 100%, 0 calc(100% - 16px))",
              }}
            >
              {/* Sci-Fi Corner Reticles */}
              <div className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 border-l-2 border-t-2 border-violet-400" />
              <div className="pointer-events-none absolute right-2 top-2 h-3.5 w-3.5 border-r-2 border-t-2 border-violet-400" />
              <div className="pointer-events-none absolute bottom-2 left-2 h-3.5 w-3.5 border-b-2 border-l-2 border-violet-400" />
              <div className="pointer-events-none absolute bottom-2 right-2 h-3.5 w-3.5 border-b-2 border-r-2 border-violet-400" />

              <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                  <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-xl border border-violet-400/40 bg-black/60 sm:h-36 sm:w-36 md:h-40 md:w-40">
                    <Image
                      src={item.image}
                      alt={item.artist}
                      fill
                      sizes="(max-width: 768px) 150px, 200px"
                      className={`object-cover ${item.imagePosition} transition-transform duration-700 group-hover:scale-105`}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="border border-violet-400/50 bg-violet-500/25 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.25em] text-violet-200">
                        [{item.dayBadge}]
                      </span>
                      <span className="flex items-center gap-1.5 border border-emerald-400/40 bg-emerald-500/15 px-3 py-0.5 font-mono text-[10px] uppercase tracking-wider text-emerald-300">
                        <CheckCircle2 size={11} />
                        {item.status}
                      </span>
                    </div>

                    <h3 className="mt-3.5 text-2xl font-bold tracking-tight text-white sm:text-3xl md:text-4xl">
                      {item.artist}
                    </h3>

                    <p className="mt-1.5 text-xs font-medium uppercase tracking-wider text-violet-300/80">
                      {item.genre}
                    </p>

                    <p className="mt-3 text-sm leading-relaxed text-white/65">
                      {item.tagline}
                    </p>
                  </div>
                </div>

                <span className="self-start rounded-full border border-white/15 bg-white/5 px-5 py-2 font-mono text-xs uppercase tracking-wider text-white/80 backdrop-blur-md md:self-auto shrink-0">
                  {item.stage}
                </span>
              </div>
            </motion.div>
          ))}
        </div>

        {/* 04 — CTA Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="mt-14 flex flex-col items-center"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.45em] text-white/40">
            SECURE YOUR ACCESS TO STAR NIGHT 2026
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/register"
              className="inline-flex items-center gap-3 rounded-full border border-violet-400 bg-gradient-to-r from-violet-600 to-purple-600 px-8 py-3.5 font-mono text-xs font-bold uppercase tracking-wider text-white shadow-[0_0_40px_rgba(168,85,247,0.35)] transition-all hover:scale-105 hover:shadow-[0_0_60px_rgba(168,85,247,0.6)]"
            >
              <Ticket size={15} />
              <span>Register & Get Passes</span>
              <ArrowRight size={15} />
            </Link>

            <a
              href="https://www.youtube.com/@SaviskarCGCU"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-7 py-3.5 font-mono text-xs font-medium uppercase tracking-wider text-white transition-all hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-200"
            >
              <YoutubeIcon size={16} className="text-red-400" />
              <span>Watch Previous Concerts</span>
            </a>
          </div>

          <div className="mt-10 flex items-center gap-3 text-purple-300/50">
            <Sparkles size={12} />
            <span className="font-mono text-[9px] uppercase tracking-[0.35em]">
              Star Night entry included with verified Saviskar 2026 registration
            </span>
            <Sparkles size={12} />
          </div>
        </motion.div>
      </div>
    </section>
  );
}