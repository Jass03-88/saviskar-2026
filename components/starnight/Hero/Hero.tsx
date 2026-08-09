"use client";

import HeroBackground from "./HeroBackground";
import HeroContent from "./HeroContent";
import { motion } from "motion/react";
import { ChevronDown } from "lucide-react";

export default function Hero() {
  return (
    <section className="relative min-h-screen overflow-hidden bg-black">

      {/* Background */}
      <HeroBackground />

      {/* Hero Content */}
      <HeroContent />

      {/* Scroll Indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{
          opacity: 1,
          y: [0, 10, 0],
        }}
        transition={{
          delay: 2,
          duration: 2,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="
        absolute
        bottom-10
        left-1/2
        z-30
        -translate-x-1/2
        text-center
        "
      >
        <p
          className="
          mb-2
          text-[10px]
          uppercase
          tracking-[0.45em]
          text-white/40
          "
        >
          Scroll
        </p>

        <ChevronDown
          size={18}
          className="mx-auto text-white/50"
        />
      </motion.div>

    </section>
  );
}