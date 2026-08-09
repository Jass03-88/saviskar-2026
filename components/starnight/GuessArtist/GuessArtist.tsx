"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowDown,
  LockKeyhole,
  Music2,
  Sparkles,
  Star,
} from "lucide-react";

export default function GuessArtist() {
  const [clue, setClue] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const clues = [
    "The voice has already echoed across millions of playlists.",
    "Their songs have turned ordinary nights into unforgettable ones.",
    "The next Star Night stage is waiting for them.",
  ];

  return (
    <section className="relative min-h-screen w-full overflow-hidden bg-black text-white">
      {/* Ambient purple light */}
      <motion.div
        className="pointer-events-none absolute left-1/2 top-[42%] h-[720px] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-700/15 blur-[180px]"
        animate={{
          scale: [1, 1.12, 1],
          opacity: [0.25, 0.45, 0.25],
        }}
        transition={{
          duration: 7,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(124,58,237,0.10),transparent_40%)]" />

      {/* Grain */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.025] [background-image:url('data:image/svg+xml,%3Csvg viewBox=%220 0 180 180%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22n%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%22.9%22 numOctaves=%224%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22 opacity=%22.8%22/%3E%3C/svg%3E')]" />

      <div className="relative mx-auto flex min-h-screen w-full flex-col px-5 py-20 sm:px-8 md:px-12 lg:px-16">
        {/* Continuation marker */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-7 flex items-center justify-center gap-4 text-[9px] uppercase tracking-[0.42em] sm:text-[10px]"
        >
          <span className="h-px w-16 bg-white/10" />
          <span className="text-purple-300/60">THE STORY CONTINUES</span>
          <span className="h-px w-16 bg-white/10" />
        </motion.div>

        {/* Heading */}
        <div className="text-center">
          <motion.p
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="mb-4 text-[10px] uppercase tracking-[0.45em] text-purple-300/75 sm:text-xs"
          >
            THE STAGE HAS SEEN LEGENDS.
          </motion.p>

          <motion.h2
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="mx-auto max-w-6xl font-serif text-[clamp(3.2rem,7vw,7rem)] font-medium leading-[0.9] tracking-[-0.055em]"
          >
            WHO&apos;S <span className="text-purple-300">NEXT?</span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="mx-auto mt-6 max-w-xl text-sm leading-7 text-white/45 md:text-base"
          >
            The legends have taken the stage.
            <br />
            Now the spotlight turns to 2026.
          </motion.p>
        </div>

        {/* Section divider */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 0.25 }}
          className="mx-auto mt-12 flex w-full items-center gap-4 text-[9px] uppercase tracking-[0.35em]"
        >
          <span className="h-px flex-1 bg-white/10" />
          <span className="text-purple-300/60">STAR NIGHT 2026</span>
          <span className="h-px flex-1 bg-white/10" />
        </motion.div>

        {/* FULL-WIDTH MYSTERY STAGE
            No rounded box/card around the crown */}
        <motion.div
          initial={{ opacity: 0, y: 35 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.9, delay: 0.2 }}
          className="relative mt-5 min-h-[570px] w-full overflow-hidden border-y border-white/[0.08] bg-[#050208] sm:min-h-[620px] md:min-h-[680px]"
        >
          {/* Full-width stage atmosphere */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(124,58,237,0.18),transparent_52%)]" />

          <div className="absolute inset-x-0 bottom-0 h-[45%] bg-gradient-to-t from-purple-950/35 via-purple-950/10 to-transparent" />

          {/* Stage glow */}
          <motion.div
            className="absolute bottom-[-30px] left-1/2 h-52 w-[65%] -translate-x-1/2 rounded-full bg-purple-600/25 blur-[100px]"
            animate={{
              opacity: [0.3, 0.6, 0.3],
              scaleX: [0.9, 1.08, 0.9],
            }}
            transition={{
              duration: 4,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />

          {/* Vertical stage lights */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center gap-[18%] opacity-20">
            <div className="h-[430px] w-px bg-purple-300 blur-sm" />
            <div className="h-[520px] w-px bg-white blur-sm" />
            <div className="h-[400px] w-px bg-purple-300 blur-sm" />
          </div>

          {/* Left copy */}
          <div className="absolute left-7 top-8 z-30 max-w-[260px] sm:left-12 sm:top-12 md:left-16">
            <p className="mb-2 text-[9px] uppercase tracking-[0.4em] text-purple-300/75">
              NEXT HEADLINER
            </p>

            <h3 className="font-serif text-3xl leading-[0.95] sm:text-4xl md:text-5xl">
              IDENTITY
              <br />
              <span className="text-purple-300">CLASSIFIED</span>
            </h3>

            <div className="mt-6 flex items-center gap-2 text-xs text-white/45">
              <LockKeyhole size={13} />
              <span>The next legend is locked in.</span>
            </div>

            <p className="mt-1 pl-5 text-xs text-white/30">
              Can you guess who it is?
            </p>
          </div>

          {/* Large question marks */}
          <motion.div
            animate={{ opacity: [0.06, 0.16, 0.06] }}
            transition={{ duration: 3, repeat: Infinity }}
            className="absolute right-[7%] top-[13%] font-serif text-[8rem] leading-none text-purple-300/15 sm:text-[11rem] md:text-[13rem]"
          >
            ?
          </motion.div>

          <motion.div
            animate={{ opacity: [0.05, 0.12, 0.05] }}
            transition={{ duration: 4, repeat: Infinity, delay: 1 }}
            className="absolute left-[8%] bottom-[16%] font-serif text-[7rem] leading-none text-purple-300/10 sm:text-[9rem] md:text-[11rem]"
          >
            ?
          </motion.div>

          {/* Crown */}
          <motion.div
            animate={{ y: [0, -5, 0] }}
            transition={{
              duration: 4.5,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="absolute left-1/2 top-[54%] z-20 h-[260px] w-[390px] -translate-x-1/2 -translate-y-1/2 sm:h-[330px] sm:w-[500px] md:h-[390px] md:w-[620px] lg:h-[430px] lg:w-[680px]"
          >
            {/* Wide crown glow */}
            <div
              className="absolute inset-[-35px] bg-purple-500/20 blur-[45px]"
              style={{
                clipPath:
                  "polygon(0% 10%, 15% 28%, 28% 0%, 50% 28%, 72% 0%, 85% 28%, 100% 10%, 89% 100%, 11% 100%)",
              }}
            />

            {/* Outer crown border */}
            <div
              className="absolute inset-0 bg-purple-300 shadow-[0_0_40px_rgba(192,132,252,0.7)]"
              style={{
                clipPath:
                  "polygon(0% 8%, 15% 26%, 28% 0%, 50% 27%, 72% 0%, 85% 26%, 100% 8%, 89% 100%, 11% 100%)",
              }}
            />

            {/* Black crown */}
            <div
              className="absolute inset-[4px] bg-black"
              style={{
                clipPath:
                  "polygon(0% 8%, 15% 26%, 28% 0%, 50% 27%, 72% 0%, 85% 26%, 100% 8%, 89% 100%, 11% 100%)",
              }}
            />

            {/* Subtle inner purple reflection */}
            <div
              className="absolute inset-[7px] bg-purple-400/5"
              style={{
                clipPath:
                  "polygon(0% 8%, 15% 26%, 28% 0%, 50% 27%, 72% 0%, 85% 26%, 100% 8%, 89% 100%, 11% 100%)",
              }}
            />

            {/* Crown base */}
            <div className="absolute bottom-[1%] left-[11%] right-[11%] h-[3px] bg-purple-200 shadow-[0_0_25px_rgba(216,180,254,0.95)]" />
          </motion.div>

          {/* Bottom identity */}
          <div className="absolute bottom-8 left-7 right-7 z-30 flex items-end justify-between sm:left-12 sm:right-12 md:left-16 md:right-16">
            <div>
              <p className="mb-1 text-[8px] uppercase tracking-[0.4em] text-purple-300/70">
                STAR NIGHT 2026
              </p>
              <h3 className="font-serif text-3xl sm:text-4xl md:text-5xl">
                {revealed ? "THE SECRET" : "?????"}
              </h3>
            </div>

            <div className="text-right">
              <p className="text-[9px] uppercase tracking-[0.25em] text-white/30">
                NEXT HEADLINER
              </p>
              <p className="mt-1 text-xs text-white/55">
                {revealed ? "Announcement coming soon" : "IDENTITY CLASSIFIED"}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Clues - separate from the hero, not inside the box */}
        <motion.div
          initial={{ opacity: 0, y: 25 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="grid w-full border-b border-white/10 md:grid-cols-4"
        >
          <div className="border-b border-white/10 p-6 md:border-b-0 md:border-r md:p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-purple-300/20 bg-purple-500/10 text-purple-300">
                <Sparkles size={19} />
              </div>
              <div>
                <p className="text-[9px] uppercase tracking-[0.25em] text-white/65">
                  CLUE 1
                </p>
                <p className="mt-2 text-sm leading-5 text-white/45">
                  The voice has already echoed across millions of playlists.
                </p>
              </div>
            </div>
          </div>

          <div className="border-b border-white/10 p-6 md:border-b-0 md:border-r md:p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-purple-300/20 bg-purple-500/10 text-purple-300">
                <Music2 size={19} />
              </div>
              <div>
                <p className="text-[9px] uppercase tracking-[0.25em] text-white/65">
                  CLUE 2
                </p>
                <p className="mt-2 text-sm leading-5 text-white/45">
                  Their songs have turned ordinary nights into unforgettable ones.
                </p>
              </div>
            </div>
          </div>

          <div className="border-b border-white/10 p-6 md:border-b-0 md:border-r md:p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-purple-300/20 bg-purple-500/10 text-purple-300">
                <Star size={19} />
              </div>
              <div>
                <p className="text-[9px] uppercase tracking-[0.25em] text-white/65">
                  CLUE 3
                </p>
                <p className="mt-2 text-sm leading-5 text-white/45">
                  The next Star Night stage is waiting for them.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center p-6 md:p-8">
            <div className="w-full text-center">
              <p className="text-[9px] uppercase tracking-[0.25em] text-white/40">
                TAKE YOUR GUESS
              </p>
              <button
                onClick={() => setRevealed(true)}
                className="mt-4 inline-flex items-center gap-3 rounded-full border border-purple-400/60 px-7 py-3 text-sm text-purple-100 transition-all duration-300 hover:scale-[1.03] hover:bg-purple-500/10"
              >
                Guess Now
                <ArrowDown size={15} className="-rotate-90" />
              </button>
            </div>
          </div>
        </motion.div>

        {/* Active clue */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 0.4 }}
          className="mx-auto mt-10 w-full max-w-2xl text-center"
        >
          <div className="mb-4 flex items-center justify-center gap-3 text-purple-300/60">
            <Sparkles size={13} />
            <span className="text-[9px] uppercase tracking-[0.35em]">
              Clue {clue + 1} of {clues.length}
            </span>
            <Sparkles size={13} />
          </div>

          <AnimatePresence mode="wait">
            <motion.p
              key={clue}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35 }}
              className="min-h-7 text-sm leading-6 text-white/45 md:text-base"
            >
              {clues[clue]}
            </motion.p>
          </AnimatePresence>

          <div className="mt-6">
            {clue < clues.length - 1 ? (
              <button
                onClick={() => setClue((current) => current + 1)}
                className="group inline-flex items-center gap-3 rounded-full bg-white px-6 py-3 text-xs font-medium text-black transition-all duration-300 hover:scale-[1.03]"
              >
                Reveal Next Clue
                <ArrowDown
                  size={14}
                  className="transition-transform duration-300 group-hover:translate-y-1"
                />
              </button>
            ) : (
              <button
                onClick={() => setRevealed(true)}
                className="group inline-flex items-center gap-3 rounded-full bg-purple-500 px-6 py-3 text-xs font-medium text-white transition-all duration-300 hover:scale-[1.03] hover:bg-purple-400"
              >
                Make Your Guess
                <Sparkles
                  size={14}
                  className="transition-transform duration-300 group-hover:rotate-12"
                />
              </button>
            )}
          </div>
        </motion.div>

        {/* Cinematic handoff into Lights Out */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 1 }}
          className="relative mt-20 flex min-h-[32vh] w-full items-center justify-center overflow-hidden bg-black"
        >
          <motion.div
            className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-700/10 blur-[140px]"
            animate={{ opacity: [0.15, 0.35, 0.15], scale: [0.9, 1.05, 0.9] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
          />
          <div className="relative z-10 flex w-full max-w-2xl flex-col items-center px-6 text-center">
            <div className="flex w-full items-center gap-4">
              <span className="h-px flex-1 bg-gradient-to-r from-transparent to-purple-400/20" />
              <span className="text-[9px] uppercase tracking-[0.42em] text-white/30">ONE STAGE · ONE NIGHT · ONE NAME</span>
              <span className="h-px flex-1 bg-gradient-to-l from-transparent to-purple-400/20" />
            </div>
            <p className="mt-10 text-[10px] uppercase tracking-[0.45em] text-purple-300/55">The moment before everything changes</p>
            <motion.div
              initial={{ opacity: 0, scaleX: 0.5 }}
              whileInView={{ opacity: 1, scaleX: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="mt-4 h-px w-24 bg-gradient-to-r from-transparent via-purple-300/60 to-transparent"
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}