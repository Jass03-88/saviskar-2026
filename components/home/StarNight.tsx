"use client";

import { useState } from "react";
import Image from "next/image";
import { motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import { useRouter } from "next/navigation";
import StageTransition from "@/components/ui/StageTransition";

const starNightBackground = [
  {
    src: "/gallery/star 1.jpg",
    alt: "Star Night performance",
    className:
      "left-[2%] top-[14%] h-[34vh] w-[24vw] min-w-[220px] -rotate-[3deg]",
  },
  {
    src: "/gallery/star 2.jpg",
    alt: "Star Night performance",
    className:
      "right-[4%] top-[8%] h-[37vh] w-[25vw] min-w-[230px] rotate-[3deg]",
  },
  {
    src: "/gallery/star 3.jpg",
    alt: "Star Night performance",
    className:
      "left-[29%] top-[7%] h-[32vh] w-[25vw] min-w-[240px] rotate-[1deg]",
  },
  {
    src: "/gallery/star 4.jpg",
    alt: "Star Night performance",
    className:
      "left-[7%] bottom-[7%] h-[31vh] w-[23vw] min-w-[220px] rotate-[2deg]",
  },
  {
    src: "/gallery/star 5.jpg",
    alt: "Star Night performance",
    className:
      "right-[5%] bottom-[5%] h-[35vh] w-[25vw] min-w-[230px] -rotate-[2deg]",
  },
  {
    src: "/gallery/concert.jpg",
    alt: "Star Night concert",
    className:
      "left-[38%] bottom-[3%] h-[30vh] w-[25vw] min-w-[230px] -rotate-[1deg]",
  },
  {
    src: "/gallery/hero.jpg",
    alt: "Star Night stage",
    className:
      "right-[27%] top-[27%] h-[27vh] w-[22vw] min-w-[220px] rotate-[2deg]",
  },
];

export default function StarNight() {
  const [showTransition, setShowTransition] = useState(false);
  const router = useRouter();

  const handleStageTransition = () => {
    setShowTransition(true);
  };

  return (
    <section className="relative min-h-screen overflow-hidden bg-black text-white">
      {/* Atmospheric background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[48%] top-[35%] h-[700px] w-[700px] -translate-x-1/2 rounded-full bg-violet-800/20 blur-[180px]" />

        {/* Star Night photos used as a subtle background layer */}
        <div className="absolute inset-0 opacity-[0.82]">
          {starNightBackground.map((photo, index) => (
            <motion.div
              key={photo.src}
              initial={{ opacity: 0, scale: 1.03 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                duration: 1.2,
                delay: index * 0.08,
                ease: [0.22, 1, 0.36, 1],
              }}
              className={`absolute overflow-hidden rounded-[12px] border border-white/[0.08] shadow-[0_25px_80px_rgba(0,0,0,0.45)] ${photo.className}`}
            >
              <Image
                src={photo.src}
                alt={photo.alt}
                fill
                sizes="30vw"
                className="object-cover"
              />
            </motion.div>
          ))}
        </div>

        {/* Heavy black cinematic treatment */}
        <div className="absolute inset-0 bg-black/[0.14]" />

        {/* Keeps the centre readable while letting the photographs breathe */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.06)_0%,rgba(0,0,0,0.28)_58%,rgba(0,0,0,0.66)_100%)]" />

        {/* Extra fade toward the bottom */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/5 to-black/62" />

        {/* Soft left-side fade behind the typography */}
        <div className="absolute inset-y-0 left-0 w-[68%] bg-gradient-to-r from-black/38 via-black/16 to-transparent" />
      </div>

      {/* Navigation / page content */}
      <div className="relative z-10 mx-auto flex min-h-screen max-w-[1400px] flex-col justify-between px-6 py-16 md:px-10 md:py-20">
        {/* Top label */}
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 }}
          className="mt-10 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/60"
        >
          When the lights go down
        </motion.p>

        {/* Main content */}
        <div className="pb-8">
          <motion.h2
            initial={{ opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 1,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="max-w-[900px] text-[clamp(4rem,11vw,11rem)] font-semibold leading-[0.78] tracking-[-0.075em]"
          >
            STAR
            <br />
            NIGHT.
          </motion.h2>

          <motion.div
            initial={{ opacity: 0, y: 25 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: 0.15,
              duration: 0.8,
            }}
            className="mt-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between"
          >
            {/* Description */}
            <p className="max-w-md text-sm leading-6 text-white/60 md:text-base">
              Thousands of voices. One stage.
              <br />
              The night Saviskar becomes unforgettable.
            </p>

            {/* Explore button */}
            <button
              type="button"
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

      {/* Transition to the full Star Night archive */}
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