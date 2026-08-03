"use client";

import { motion } from "motion/react";
import MouseSpotlight from "@/components/ui/MouseSpotlight";
import { ArrowDown, ArrowRight } from "lucide-react";
import SplitText from "@/components/SplitText";
import Lightfall from "@/components/ui/Lightfall";
import AuroraBackground from "@/components/ui/AuroraBackground";
export default function Hero() {
  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden bg-transparent text-white">
{/* Mouse Spotlight */}
<div className="absolute inset-0 z-10">
  <MouseSpotlight />
</div>
      {/* Animated Background */}
      {/* Aurora */}
<div className="absolute inset-0 z-0">
  <AuroraBackground />
</div>

{/* Lightfall */}
<div className="absolute inset-0 z-10 opacity-70">
  <Lightfall
  colors={[
  "#FFFFFF",
  "#F8F4FF",
  "#E9D5FF",
  "#C084FC",
  "#8B5CF6",
]}

backgroundColor="#12061F"

opacity={0.5}
glow={0.8}
speed={0.2}
density={1.0}
streakWidth={0.5}
streakLength={1.25}
mouseStrength={0.08}
/>
</div>

      <div className="relative z-30 ... mx-auto flex w-full max-w-7xl flex-col items-center px-6 text-center">

        <motion.p
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: .7 }}
          className="mb-8 text-xs uppercase tracking-[0.45em] text-white/50"
        >
          CGC UNIVERSITY • MOHALI
        </motion.p>

        <SplitText
          text="SAVISKAR"
          className="text-[clamp(5rem,15vw,12rem)] font-black tracking-[-0.08em] leading-none drop-shadow-[0_0_50px_rgba(255,255,255,0.18)]"
          delay={55}
          duration={1}
          splitType="chars"
          from={{ opacity: 0, y: 140 }}
          to={{ opacity: 1, y: 0 }} onLetterAnimationComplete={undefined}        />

        <motion.h2
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.1 }}
          className="mt-8 text-3xl md:text-6xl font-semibold tracking-tight"
        >
          The Stage is Yours.
        </motion.h2>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.3 }}
          className="mt-8 max-w-2xl text-lg leading-8 text-white/55"
        >
          Technology, Culture, Innovation and Competition —
          brought together into one unforgettable experience.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.5 }}
          className="mt-14 flex flex-wrap items-center justify-center gap-5"
        >

          <a
            href="#events"
            className="group rounded-full bg-white px-8 py-4 text-black font-medium transition-all duration-300 hover:scale-105"
          >
            <span className="flex items-center gap-3">
              Explore Events
              <ArrowRight
                size={18}
                className="transition group-hover:translate-x-1"
              />
            </span>
          </a>

          <a
            href="/register"
            className="rounded-full border border-white/20 bg-white/5 backdrop-blur-xl px-8 py-4 font-medium transition-all duration-300 hover:border-white/40 hover:bg-white/10"
          >
            Register Now
          </a>

        </motion.div>

      </div>

      <motion.div
        animate={{
          y: [0, 10, 0],
        }}
        transition={{
          repeat: Infinity,
          duration: 2,
        }}
        className="absolute bottom-10 left-1/2 -translate-x-1/2 text-white/35"
      >
        <ArrowDown size={18} />
      </motion.div>
{/* Bottom fade */}
<div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-b from-transparent via-black/40 to-black" />
{/* Hero → Gallery Fade */}
<div
  className="
    absolute
    bottom-0
    left-0
    w-full
    h-64
    pointer-events-none
    bg-gradient-to-b
    from-transparent
    via-[#12051f]/50
    to-black
  "
/>
    </section>
  );
}