"use client";

import { motion } from "motion/react";
import { ArrowDown } from "lucide-react";
import SplitText from "@/components/SplitText";

export default function Hero() {
  return (
    <section className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-black px-5 text-white">
      {/* Subtle background atmosphere */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[55%] h-[38rem] w-[38rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.025] blur-3xl" />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-white/[0.025] to-transparent" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-[1400px] flex-col items-center justify-center text-center">
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="mb-7 text-[10px] font-medium uppercase tracking-[0.32em] text-white/45 md:text-xs"
        >
          CGC UNIVERSITY, MOHALI
        </motion.p>

        <div className="w-full overflow-hidden">
          <SplitText
            text="SAVISKAR"
            className="text-[clamp(4rem,15vw,13rem)] font-semibold leading-[0.76] tracking-[-0.075em] text-white"
            delay={70}
            duration={1.1}
            ease="power3.out"
            splitType="chars"
            from={{ opacity: 0, y: 100 }}
            to={{ opacity: 1, y: 0 }}
            threshold={0.1}
            rootMargin="-50px"
            textAlign="center"
            onLetterAnimationComplete={() => {}}
          />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 1.05 }}
          className="mt-12 flex flex-col items-center md:mt-14"
        >
          <h1 className="text-3xl font-medium tracking-[-0.04em] md:text-5xl">
            The stage is yours.
          </h1>

          <p className="mt-5 max-w-lg text-sm leading-6 text-white/45 md:text-base md:leading-7">
            Technology. Culture. Competition. Creativity.
            <br className="hidden sm:block" />
            One experience that brings it all together.
          </p>

          <motion.a
            href="#story"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.98 }}
            className="group mt-8 inline-flex items-center gap-3 rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition-opacity hover:opacity-90"
          >
            Discover Saviskar
            <ArrowDown
              size={15}
              className="transition-transform duration-300 group-hover:translate-y-0.5"
            />
          </motion.a>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 1.6 }}
        className="absolute bottom-7 left-1/2 -translate-x-1/2 text-[9px] uppercase tracking-[0.28em] text-white/25"
      >
        Scroll to explore
      </motion.div>
    </section>
  );
}
