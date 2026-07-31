"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";

export default function StarNight() {
  return (
    <section className="relative min-h-screen overflow-hidden bg-black text-white">
      <Image
        src="/images/concert.JPG"
        alt="Saviskar Star Night"
        fill
        sizes="100vw"
        className="object-cover object-center"
      />

      <div className="absolute inset-0 bg-black/40" />

      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/80" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-[1400px] flex-col justify-between px-6 py-16 md:px-10 md:py-20">
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mt-10 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/60"
        >
          When the lights go down
        </motion.p>

        <div className="pb-8">
          <motion.h2
            initial={{ opacity: 0, y: 60 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{
              duration: 1,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="text-[clamp(4rem,11vw,11rem)] font-semibold leading-[0.78] tracking-[-0.075em]"
          >
            STAR
            <br />
            NIGHT.
          </motion.h2>

          <motion.div
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.15 }}
            className="mt-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between"
          >
            <p className="max-w-md text-sm leading-6 text-white/60 md:text-base">
              Thousands of voices. One stage.
              <br />
              The night Saviskar becomes unforgettable.
            </p>

            <a
              href="#"
              className="flex w-fit items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.03]"
            >
              Explore Star Night
              <ArrowUpRight size={15} />
            </a>
          </motion.div>
        </div>
      </div>
    </section>
  );
}