"use client";

import { motion } from "motion/react";
import { ArrowDown } from "lucide-react";

export default function HeroContent() {
  return (
    <div className="relative z-20 flex min-h-screen flex-col items-center justify-center px-6 text-center text-white">

      {/* Eyebrow */}
      <motion.p
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          delay: 0.2,
          duration: 0.8,
          ease: [0.22, 1, 0.36, 1],
        }}
        className="
        mb-8
        text-[11px]
        uppercase
        tracking-[0.45em]
        text-white/55
        "
      >
        WHEN THE LIGHTS GO DOWN
      </motion.p>

      {/* Main Title */}

      <motion.h1
        initial={{
          opacity: 0,
          y: 70,
          filter: "blur(16px)",
        }}
        animate={{
          opacity: 1,
          y: 0,
          filter: "blur(0px)",
        }}
        transition={{
          delay: .45,
          duration: 1.2,
          ease: [0.16,1,.3,1],
        }}
        className="
        text-[clamp(5rem,15vw,13rem)]
        leading-[0.82]
        tracking-[-0.08em]
        font-semibold
        "
      >
        STAR
        <br />
        NIGHT.
      </motion.h1>

      {/* Subtitle */}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{
          delay: 1.15,
          duration: .8,
        }}
        className="mt-10 max-w-xl"
      >
        <p className="text-lg leading-8 text-white/70">
          Thousands of voices.
          <br />
          One stage.
          <br />
          One unforgettable night.
        </p>
      </motion.div>

      {/* CTA */}

      <motion.button
        initial={{
          opacity:0,
          y:30,
        }}
        animate={{
          opacity:1,
          y:0,
        }}
        transition={{
          delay:1.5,
          duration:.7,
        }}
        className="
        group
        mt-14
        rounded-full
        border
        border-white/10
        bg-white/10
        px-8
        py-4
        backdrop-blur-xl
        transition-all
        duration-500
        hover:border-[#8A2EFF]
        hover:bg-[#8A2EFF]/20
        hover:shadow-[0_0_50px_rgba(138,46,255,.25)]
        "
      >
        <span className="flex items-center gap-3">

          BEGIN THE JOURNEY

          <ArrowDown
            size={16}
            className="
            transition-transform
            duration-500
            group-hover:translate-y-1
            "
          />

        </span>
      </motion.button>

    </div>
  );
}