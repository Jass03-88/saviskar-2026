"use client";

import Image from "next/image";
import { motion } from "motion/react";

type ArtistSectionProps = {
  year: string;
  artist: string;
  tagline: string;
  attendance: string;
  image: string;
  index: number;
};

export default function ArtistSection({
  year,
  artist,
  tagline,
  attendance,
  image,
  index,
}: ArtistSectionProps) {
  return (
    <section className="relative h-[100svh] min-h-[700px] w-full overflow-hidden bg-black text-white">
      {/* Background image */}
      <motion.div
        initial={{ scale: 1.08 }}
        whileInView={{ scale: 1 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
        className="absolute inset-0"
      >
        <Image
          src={image}
          alt={`${artist} Star Night ${year}`}
          fill
          sizes="100vw"
          className="object-cover"
          priority={index === 0}
        />
      </motion.div>

      {/* Dark cinematic overlay */}
      <div className="absolute inset-0 bg-black/45" />

      {/* Purple ambient glow */}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 0.55 }}
        viewport={{ once: true }}
        transition={{ duration: 1.2 }}
        className="absolute left-[-15%] top-[25%] h-[500px] w-[500px] rounded-full bg-purple-700/30 blur-[160px]"
      />

      {/* Bottom gradient */}
      <div className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black via-black/45 to-transparent" />

      {/* Giant year */}
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 0.16, y: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 1, delay: 0.15 }}
        className="absolute right-[4vw] top-[8vh] select-none text-[20vw] font-semibold leading-none tracking-[-0.08em]"
      >
        {year}
      </motion.div>

      {/* Content */}
      <div className="relative z-10 flex h-full w-full items-end px-6 pb-16 sm:px-10 sm:pb-20 lg:px-16 lg:pb-24">
        <div className="max-w-4xl">
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="mb-4 text-xs font-medium uppercase tracking-[0.45em] text-purple-300"
          >
            Star Night {year}
          </motion.p>

          <motion.h2
            initial={{ opacity: 0, y: 35 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="font-serif text-6xl leading-[0.9] tracking-[-0.04em] sm:text-7xl lg:text-[8rem]"
          >
            {artist}
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="mt-6 max-w-xl text-lg text-white/75 sm:text-xl"
          >
            {tagline}
          </motion.p>

          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.35 }}
            className="mt-8 text-sm uppercase tracking-[0.3em] text-white/50"
          >
            {attendance} Audience
          </motion.p>
        </div>
      </div>

      {/* Scroll indicator */}
      {index === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 1 }}
          className="absolute bottom-8 right-8 z-20 hidden items-center gap-3 text-[10px] uppercase tracking-[0.35em] text-white/50 sm:flex"
        >
          Scroll
          <span className="h-px w-10 bg-white/30" />
        </motion.div>
      )}
    </section>
  );
}