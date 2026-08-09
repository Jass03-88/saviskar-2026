"use client";

import { motion } from "motion/react";
import ArtistCard from "./ArtistCard";
import { artists } from "@/data/starnightArtists";
export default function PastPerformances() {
  return (
    <section className="relative overflow-hidden bg-black py-32 text-white">

      {/* Background Glow */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[700px] w-[700px] -translate-x-1/2 rounded-full bg-[#8A2EFF]/15 blur-[180px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-6">

        <motion.p
          initial={{ opacity: 0, y: 25 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: .6 }}
          className="mb-6 text-xs uppercase tracking-[0.45em] text-[#B26DFF]"
        >
          STAR NIGHT ARCHIVES
        </motion.p>

        <motion.h2
          initial={{ opacity: 0, y: 35 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: .8 }}
          className="max-w-4xl text-[clamp(3rem,7vw,6rem)] leading-[0.9] tracking-[-0.05em] font-semibold"
        >
          THE STAGE HAS
          <br />
          SEEN LEGENDS.
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: .15, duration: .8 }}
          className="mt-8 max-w-2xl text-lg leading-8 text-white/65"
        >
          Every Star Night leaves behind memories that echo long after
          the lights fade. Relive the performances that brought thousands
          together under one unforgettable stage.
        </motion.p>
<div className="mt-32">
  {artists.map((artist) => (
    <ArtistCard
      key={artist.year}
      {...artist}
    />
  ))}
</div>

        {/* Seamless handoff into Guess Artist */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.8 }}
          className="relative mt-24 flex min-h-[30vh] w-full items-center justify-center overflow-hidden bg-black"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(124,58,237,0.13),transparent_62%)]" />
          <div className="relative z-10 flex w-full max-w-3xl flex-col items-center px-6 text-center">
            <div className="flex w-full items-center gap-4">
              <span className="h-px flex-1 bg-gradient-to-r from-transparent to-white/10" />
              <span className="text-[9px] uppercase tracking-[0.4em] text-purple-300/45">THE STORY CONTINUES</span>
              <span className="h-px flex-1 bg-gradient-to-l from-transparent to-white/10" />
            </div>
            <p className="mt-8 font-serif text-2xl text-white/60 sm:text-4xl">The past made its mark.</p>
            <p className="mt-2 text-xs uppercase tracking-[0.3em] text-white/25">Now we turn the page</p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}