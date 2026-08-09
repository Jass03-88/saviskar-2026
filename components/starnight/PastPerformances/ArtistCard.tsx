"use client";

import Image from "next/image";
import { motion } from "motion/react";

interface Props {
  year: string;
  artist: string;
  attendance: string;
  tagline: string;
  image: string;
}

export default function ArtistCard({
  year,
  artist,
  attendance,
  tagline,
  image,
}: Props) {
  return (
    <section className="relative h-screen w-full overflow-hidden bg-black">

      {/* Background Image */}
      <motion.div
        initial={{ scale: 1.15 }}
        whileInView={{ scale: 1 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{
          duration: 8,
          ease: "easeOut",
        }}
        className="absolute inset-0"
      >
        <Image
          src={image}
          alt={artist}
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
      </motion.div>

      {/* Dark Overlay */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Top Gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-transparent to-black/80" />

      {/* Purple Glow */}
      <div className="absolute left-1/2 top-1/2 h-[900px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#8A2EFF]/15 blur-[220px]" />

      {/* Side Vignette */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-transparent to-black/55" />

      {/* Huge Background Year */}
      <motion.h2
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 0.09 }}
        viewport={{ once: true }}
        transition={{ duration: 1 }}
        className="pointer-events-none absolute inset-0 flex items-center justify-center text-[26vw] font-black tracking-[-0.08em] text-white select-none"
      >
        {year}
      </motion.h2>

      {/* Content */}
      <motion.div
        initial={{ opacity: 0, y: 70 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.45 }}
        transition={{
          duration: 0.9,
          ease: [0.16, 1, 0.3, 1],
        }}
        className="relative z-20 flex h-full items-end"
      >
        <div className="w-full max-w-7xl mx-auto px-8 md:px-16 pb-20 md:pb-28">

          <p className="mb-5 uppercase tracking-[0.45em] text-[#B26DFF] text-sm">
            STAR NIGHT {year}
          </p>

          <h2 className="text-[clamp(4rem,8vw,8rem)] font-semibold leading-[0.9] tracking-[-0.05em]">
            {artist}
          </h2>

          <p className="mt-6 max-w-2xl text-xl md:text-2xl leading-relaxed text-white/70">
            {tagline}
          </p>

          <div className="mt-10 flex items-center gap-4">
            <div className="h-px w-16 bg-[#B26DFF]" />
            <span className="text-white/60">
              {attendance} Audience
            </span>
          </div>

        </div>
      </motion.div>

    </section>
  );
}