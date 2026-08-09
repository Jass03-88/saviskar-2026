"use client";

import { motion } from "motion/react";
import { ArrowDown, Sparkles } from "lucide-react";

const starNight2026 = {
  status: "TO BE ANNOUNCED",
  artist: "HEADLINER",
  tagline: "The next chapter is about to begin.",
  image: "",
};

export default function StarNightReveal() {
  return (
    <section className="relative min-h-screen w-full overflow-hidden bg-black text-white">
      {/* Blackout atmosphere */}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.4 }}
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_70%,rgba(124,58,237,0.16),transparent_55%)]"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.7 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 2, delay: 0.4 }}
        className="absolute left-1/2 top-[62%] h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-700/10 blur-[160px]"
      />

      {/* Dust / stars */}
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <span className="absolute left-[18%] top-[28%] h-1 w-1 rounded-full bg-purple-200/50" />
        <span className="absolute left-[72%] top-[22%] h-1 w-1 rounded-full bg-white/30" />
        <span className="absolute left-[82%] top-[55%] h-1 w-1 rounded-full bg-purple-200/40" />
        <span className="absolute left-[27%] top-[68%] h-1 w-1 rounded-full bg-white/25" />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 py-28 text-center">
        {/* 01 — blackout */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.9 }}
        >
          <p className="text-[9px] uppercase tracking-[0.5em] text-white/30">
            THE MOMENT AFTER THE LIGHTS GO OUT
          </p>

          <h2 className="mt-7 font-serif text-[clamp(4rem,10vw,10rem)] font-medium leading-[0.78] tracking-[-0.06em]">
            AND THEN...
          </h2>
        </motion.div>

        {/* 02 — year */}
        <motion.div
          initial={{ opacity: 0, scale: 0.88, y: 30 }}
          whileInView={{ opacity: 1, scale: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 1.2, delay: 0.45 }}
          className="mt-16"
        >
          <p className="text-[10px] uppercase tracking-[0.55em] text-purple-300/60">
            THE NEXT CHAPTER
          </p>

          <div className="mt-3 font-serif text-[clamp(6rem,18vw,16rem)] leading-[0.72] tracking-[-0.07em] text-white">
            2026
          </div>

          <div className="mx-auto mt-7 h-px w-28 bg-gradient-to-r from-transparent via-purple-300/70 to-transparent" />

          <p className="mt-6 text-xs uppercase tracking-[0.45em] text-white/35">
            STAR NIGHT
          </p>
        </motion.div>

        {/* 03 — placeholder headliner */}
        <motion.div
          initial={{ opacity: 0, y: 45 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 1, delay: 0.9 }}
          className="mt-24 w-full max-w-6xl"
        >
          <div className="relative overflow-hidden border-y border-white/10 py-16 md:py-20">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(139,92,246,0.10),transparent_55%)]" />

            <div className="relative z-10">
              <p className="text-[9px] uppercase tracking-[0.5em] text-purple-300/65">
                STAR NIGHT 2026 · HEADLINER
              </p>

              <h3 className="mt-7 font-serif text-[clamp(4rem,9vw,9rem)] leading-[0.8] tracking-[-0.06em]">
                {starNight2026.artist}
              </h3>

              <p className="mt-7 text-sm text-white/45 md:text-base">
                {starNight2026.tagline}
              </p>

              <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
                <span className="rounded-full border border-purple-300/25 bg-purple-500/5 px-5 py-2 text-[9px] uppercase tracking-[0.3em] text-purple-200/70">
                  {starNight2026.status}
                </span>

                <span className="rounded-full border border-white/10 px-5 py-2 text-[9px] uppercase tracking-[0.3em] text-white/35">
                  ANNOUNCEMENT COMING SOON
                </span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* 04 — future CTA placeholder */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 1.2 }}
          className="mt-16 flex flex-col items-center"
        >
          <p className="text-[9px] uppercase tracking-[0.45em] text-white/25">
            SAVE THE NIGHT
          </p>

          <button
            type="button"
            disabled
            className="mt-5 inline-flex cursor-not-allowed items-center gap-3 rounded-full border border-white/10 px-7 py-3 text-xs text-white/30"
          >
            EXPLORE STAR NIGHT
            <ArrowDown size={14} className="-rotate-90" />
          </button>

          <div className="mt-12 flex items-center gap-3 text-purple-300/35">
            <Sparkles size={12} />
            <span className="text-[8px] uppercase tracking-[0.4em]">
              Details will be revealed soon
            </span>
            <Sparkles size={12} />
          </div>
        </motion.div>
      </div>
    </section>
  );
}