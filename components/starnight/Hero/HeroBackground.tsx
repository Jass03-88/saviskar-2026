"use client";

import Image from "next/image";
import { motion } from "motion/react";
import MouseSpotlight from "@/components/ui/MouseSpotlight";

export default function HeroBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden">

      {/* Background Image */}
      <motion.div
        initial={{ scale: 1 }}
        animate={{ scale: 1.12 }}
        transition={{
          duration: 25,
          repeat: Infinity,
          repeatType: "reverse",
          ease: "linear",
        }}
        className="absolute inset-0"
      >
        <Image
          src="/images/concert.jpg"
          alt="Star Night"
          fill
          priority
          className="object-cover object-center"
        />
      </motion.div>

      {/* Mouse Spotlight */}
      <div className="absolute inset-0 opacity-10">
        <MouseSpotlight />
      </div>

      {/* Purple Ambient Glow */}
      <motion.div
        animate={{
          scale: [1, 1.08, 1],
          opacity: [0.18, 0.26, 0.18],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="
          absolute
          left-1/2
          top-1/2
          h-[1100px]
          w-[1100px]
          -translate-x-1/2
          -translate-y-1/2
          rounded-full
          bg-[#8A2EFF]
          blur-[240px]
        "
      />

      {/* Top Gradient */}
      <div className="absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-black via-black/50 to-transparent" />

      {/* Bottom Gradient */}
      <div className="absolute inset-x-0 bottom-0 h-80 bg-gradient-to-t from-black via-black/70 to-transparent" />

      {/* Side Vignette */}
      <div className="absolute inset-y-0 left-0 w-60 bg-gradient-to-r from-black to-transparent" />
      <div className="absolute inset-y-0 right-0 w-60 bg-gradient-to-l from-black to-transparent" />

      {/* Film Grain */}
      <div
        className="
          pointer-events-none
          absolute
          inset-0
          opacity-[0.05]
          mix-blend-soft-light
        "
        style={{
          backgroundImage:
            "radial-gradient(circle, white 1px, transparent 1px)",
          backgroundSize: "5px 5px",
        }}
      />
    </div>
  );
}