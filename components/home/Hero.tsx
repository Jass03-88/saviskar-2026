"use client";

import Image from "next/image";
import { motion } from "motion/react";
import MouseSpotlight from "@/components/ui/MouseSpotlight";
import { ArrowDown, ArrowRight } from "lucide-react";
import { useSmoothScroll } from "@/components/providers/SmoothScrollProvider";

export default function Hero() {
  const { scrollTo } = useSmoothScroll();
  return (
    <section className="relative flex min-h-screen min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-transparent text-white">
      {/* Theatrical Concert Atmospheric Overlays (ScrollEngine3D provides the crisp 8K stadium scene) */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        {/* Deep Violet Stage Haze Accent */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(168,85,247,0.18)_0%,rgba(0,0,0,0.3)_60%,transparent_100%)]" />

        {/* Volumetric Stage Smoke Gradient - Seamless transition into Story */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-transparent pointer-events-none" />

        {/* Soft Spotlight Rim Lighting from top */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 h-[500px] w-[80vw] bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.12)_0%,transparent_70%)] blur-[90px] pointer-events-none" />
      </div>

      {/* Mouse Spotlight */}
      <div className="pointer-events-none absolute inset-0 z-10">
        <MouseSpotlight />
      </div>

      {/* Content Container - Perfectly Centered */}
      <div className="relative z-30 mx-auto flex w-full max-w-5xl flex-col items-center px-4 sm:px-6 pt-16 sm:pt-20 pb-8 text-center justify-center">
        {/* University Badge - Previous Location above Logo */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: false, amount: 0.2 }}
          transition={{ duration: 0.8 }}
          className="liquid-glass mb-2 sm:mb-3 inline-flex items-center gap-2 sm:gap-2.5 rounded-full px-3.5 py-1.5 sm:px-4 sm:py-2 text-[10px] sm:text-xs font-semibold uppercase tracking-wider sm:tracking-[0.35em] text-white/85 shadow-[0_0_20px_rgba(168,85,247,0.2)] max-w-[92vw] overflow-hidden"
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400 animate-pulse shadow-[0_0_8px_#c084fc]" />
          <span className="truncate">CGC UNIVERSITY • MOHALI</span>
          <span className="text-white/30">|</span>
          <span className="text-violet-300 shrink-0">AEVORIAN REVERIE</span>
        </motion.div>

        {/* Unified Official Fest Logo & Theme Lockup — Centered Viewport Focal Point */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 25 }}
          whileInView={{ opacity: 1, scale: 1, y: 0 }}
          viewport={{ once: false, amount: 0.2 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="relative flex flex-col items-center justify-center w-full max-w-3xl px-2 mt-4 sm:mt-6 mb-2 sm:mb-3"
        >
          {/* Ambient Glow Aura behind entire logo lockup */}
          <div className="pointer-events-none absolute inset-0 -inset-x-12 -inset-y-6 bg-gradient-to-r from-violet-600/25 via-fuchsia-500/20 to-cyan-500/20 blur-3xl opacity-65" />
          
          <Image
            src="/logo.png"
            alt="Saviskar 2026 — Aevorian Reverie"
            width={1448}
            height={307}
            unoptimized
            priority
            className="relative z-10 w-full max-w-[360px] sm:max-w-[480px] md:max-w-[580px] lg:max-w-[650px] h-auto object-contain filter drop-shadow-[0_0_35px_rgba(168,85,247,0.45)] select-none"
          />

          {/* Sub-Lockup: Seamlessly integrated directly into the logo mark */}
          <div className="relative z-10 -mt-1 sm:-mt-2 flex flex-col items-center gap-0.5 sm:gap-1 text-center select-none">
            <div className="flex items-center justify-center gap-2 sm:gap-3">
              <span className="h-[1px] w-6 sm:w-14 bg-gradient-to-r from-transparent via-violet-400/80 to-violet-300" />
              <span className="font-mono text-[11px] sm:text-xs md:text-sm uppercase tracking-[0.45em] sm:tracking-[0.55em] text-violet-200 font-bold drop-shadow-[0_0_14px_rgba(168,85,247,0.95)]">
                AEVORIAN REVERIE
              </span>
              <span className="h-[1px] w-6 sm:w-14 bg-gradient-to-l from-transparent via-violet-400/80 to-violet-300" />
            </div>
            <span className="font-editorial text-xs sm:text-sm md:text-base text-white/85 tracking-widest font-normal italic drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)]">
              Where Tomorrow Dreams Awake
            </span>
          </div>
        </motion.div>

        {/* Editorial Punchline Accent */}
        <motion.h2
          initial={{ opacity: 0, y: 25 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: false, amount: 0.2 }}
          transition={{ delay: 0.25, duration: 0.8 }}
          className="mt-3 sm:mt-4 text-xl sm:text-2xl md:text-3xl lg:text-[38px] font-light tracking-tight text-white leading-tight drop-shadow-[0_4px_16px_rgba(0,0,0,0.95)]"
        >
          A future imagined so vividly, <br />
          <span className="font-editorial text-violet-300 font-normal italic">it begins to exist.</span>
        </motion.h2>

        {/* Live Metrics Pill Showcase */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: false, amount: 0.2 }}
          transition={{ delay: 0.45, duration: 0.8 }}
          className="mt-3.5 sm:mt-4 flex flex-wrap items-center justify-center gap-2 sm:gap-2.5 text-[10px] sm:text-xs tracking-wider uppercase text-white/90 font-medium"
        >
          {["50+ Realms", "500+ Colleges", "35,000+ Students", "2 Epic Days (Oct 28–29)"].map((item) => (
            <motion.div
              key={item}
              whileHover={{ scale: 1.08, y: -3, borderColor: "rgba(168,85,247,0.5)" }}
              whileTap={{ scale: 0.96 }}
              className="liquid-glass cursor-default rounded-full px-3.5 py-1 sm:px-4 sm:py-1.5 transition-colors"
            >
              {item}
            </motion.div>
          ))}
          <motion.div
            whileHover={{ scale: 1.08, y: -3, borderColor: "rgba(168,85,247,0.8)" }}
            whileTap={{ scale: 0.96 }}
            className="liquid-glass cursor-default rounded-full px-3.5 py-1 sm:px-4 sm:py-1.5 text-violet-300 transition-colors"
          >
            ∞ Possibilities
          </motion.div>
        </motion.div>

        {/* Call to Actions (with ON hover/tap animations) */}
        <motion.div
          initial={{ opacity: 0, y: 25 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: false, amount: 0.2 }}
          transition={{ delay: 0.55, duration: 0.8 }}
          className="mt-5 sm:mt-6 flex flex-wrap items-center justify-center gap-3 sm:gap-4"
        >
          <motion.a
            href="/events"
            whileHover={{
              scale: 1.05,
              boxShadow: "0 0 45px rgba(255,255,255,0.5)",
            }}
            whileTap={{ scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="group rounded-full bg-white px-7 py-3 sm:px-8 sm:py-3.5 text-xs sm:text-sm font-semibold tracking-wide text-black shadow-[0_0_30px_rgba(255,255,255,0.35)] transition-colors hover:bg-violet-100"
          >
            <span className="flex items-center gap-3">
              Explore Realms
              <ArrowRight
                size={16}
                className="transition-transform group-hover:translate-x-1"
              />
            </span>
          </motion.a>

          <motion.a
            href="/register"
            whileHover={{
              scale: 1.05,
              borderColor: "rgba(168,85,247,0.6)",
              backgroundColor: "rgba(255,255,255,0.12)",
            }}
            whileTap={{ scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="liquid-glass-interactive rounded-full px-7 py-3 sm:px-8 sm:py-3.5 text-xs sm:text-sm font-medium tracking-wide text-white transition-all"
          >
            Claim Your Pass
          </motion.a>
        </motion.div>
      </div>

      {/* Ambient Scroll Down Indicator */}
      <motion.button
        type="button"
        onClick={() => scrollTo("#story", { duration: 1.4 })}
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: false }}
        animate={{
          y: [0, 8, 0],
        }}
        transition={{
          repeat: Infinity,
          duration: 2.2,
          ease: "easeInOut",
        }}
        className="hidden xl:flex absolute bottom-4 left-1/2 -translate-x-1/2 text-white/35 hover:text-white/80 transition-colors flex-col items-center gap-1 cursor-pointer focus:outline-none z-30"
        aria-label="Scroll down to Story"
      >
        <span className="text-[9px] uppercase tracking-[0.3em]">Scroll</span>
        <ArrowDown size={14} />
      </motion.button>

      {/* Multi-stop Continuous Atmosphere Blend into Next Section */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent via-black/70 to-black" />
    </section>
  );
}