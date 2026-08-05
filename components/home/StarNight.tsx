"use client";

import { useState } from "react";
import Image from "next/image";
import { motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import { useRouter } from "next/navigation";
import StageTransition from "@/components/ui/StageTransition";

export default function StarNight() {
  const [showTransition, setShowTransition] = useState(false);
const router = useRouter();
  const handleStageTransition = () => {
    setShowTransition(true);
  };

  return (
    <section className="relative min-h-screen overflow-hidden bg-black text-white">
      <Image
        src="/images/concert.jpg"
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

            <button
  onClick={handleStageTransition}
  className="group flex w-fit items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition-all duration-300 hover:scale-[1.03] active:scale-95"
>
  Explore Star Night

  <ArrowUpRight
    size={15}
    className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
  />
</button>
          </motion.div>
        </div>
      </div>

      {showTransition && (
        <StageTransition
  onComplete={() => {
    router.push("/starnight");
  }}
/>
      )}
    </section>
  );
}