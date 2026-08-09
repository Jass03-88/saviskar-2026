"use client";

import { motion } from "motion/react";

export default function LightsOut() {
  return (
    <section className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-black text-white">
      {/* Almost invisible purple atmosphere */}
      <motion.div
        initial={{ scale: 0.35, opacity: 0 }}
        whileInView={{ scale: 1.45, opacity: 0.18 }}
        viewport={{ once: true }}
        transition={{ duration: 2.4, ease: [0.22, 1, 0.36, 1] }}
        className="pointer-events-none absolute left-1/2 top-1/2 h-[800px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#8A2EFF] blur-[220px]"
      />

      {/* Moving final spotlight */}
      <motion.div
        initial={{ x: "-120%", opacity: 0, rotate: -18 }}
        whileInView={{ x: "120%", opacity: 0.48 }}
        viewport={{ once: true }}
        transition={{
          delay: 0.9,
          duration: 1.8,
          ease: "easeInOut",
        }}
        className="pointer-events-none absolute left-[-10%] top-[-20%] h-[170%] w-[30%] blur-[32px]"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(190,130,255,.45), transparent)",
        }}
      />

      {/* Tiny stage particles */}
      <div className="pointer-events-none absolute inset-0">
        <span className="absolute left-[18%] top-[30%] h-1 w-1 rounded-full bg-purple-200/30" />
        <span className="absolute left-[72%] top-[22%] h-1 w-1 rounded-full bg-white/20" />
        <span className="absolute left-[82%] top-[63%] h-1 w-1 rounded-full bg-purple-200/25" />
        <span className="absolute left-[29%] top-[70%] h-1 w-1 rounded-full bg-white/15" />
      </div>

      {/* Main blackout message */}
      <motion.div
        initial={{ opacity: 0, y: 35 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ delay: 0.45, duration: 1 }}
        className="relative z-20 px-6 text-center"
      >
        <motion.p
          initial={{ opacity: 0, letterSpacing: "0.7em" }}
          whileInView={{ opacity: 1, letterSpacing: "0.5em" }}
          viewport={{ once: true }}
          transition={{ delay: 0.55, duration: 1 }}
          className="mb-8 text-[9px] uppercase text-white/35 sm:text-xs"
        >
          THE MOMENT BEFORE EVERYTHING CHANGES
        </motion.p>

        <h2 className="font-serif text-[clamp(4rem,10vw,9rem)] font-medium leading-[0.78] tracking-[-0.06em]">
          THE LIGHTS
          <br />
          <span className="text-purple-200">GO OUT.</span>
        </h2>

        <motion.div
          initial={{ opacity: 0, scaleX: 0 }}
          whileInView={{ opacity: 1, scaleX: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 1.35, duration: 0.8 }}
          className="mx-auto mt-10 h-px w-28 bg-gradient-to-r from-transparent via-purple-300/60 to-transparent"
        />

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 1.7, duration: 0.9 }}
          className="mt-7 text-[9px] uppercase tracking-[0.42em] text-white/20"
        >
          Stay in the dark.
        </motion.p>
      </motion.div>

      {/* Bottom fade prepares the next reveal */}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ delay: 2.2, duration: 1.2 }}
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black via-black/70 to-transparent"
      />
    </section>
  );
}