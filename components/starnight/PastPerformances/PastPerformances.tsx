'use client';

import { motion } from "motion/react";
import Image from "next/image";
import ArtistCard from "./ArtistCard";
import { artists } from "@/data/starnightArtists";

/*
  Cleaner editorial photo mesh:
  - Mixes landscape and portrait crops.
  - Uses much less overlap.
  - Keeps the main text completely clear.
  - Portrait cards use object-cover to create a deliberate 9:16 crop.
*/
const starNightPhotos = [
  {
    src: "/gallery/star 1.jpg",
    alt: "Star Night performance",
    className:
      "left-[2%] top-[4%] h-[310px] w-[205px] -rotate-[3deg] md:h-[390px] md:w-[255px]",
  },
  {
    src: "/gallery/star 2.jpg",
    alt: "Star Night performance",
    className:
      "left-[28%] top-[0%] h-[245px] w-[410px] rotate-[2deg] md:h-[300px] md:w-[500px]",
  },
  {
    src: "/gallery/star 3.jpg",
    alt: "Star Night performance",
    className:
      "right-[1%] top-[6%] h-[310px] w-[205px] rotate-[3deg] md:h-[390px] md:w-[255px]",
  },
  {
    src: "/gallery/star 4.jpg",
    alt: "Star Night performance",
    className:
      "left-[22%] top-[39%] h-[245px] w-[410px] -rotate-[2deg] md:h-[300px] md:w-[500px]",
  },
  {
    src: "/gallery/star 5.jpg",
    alt: "Star Night performance",
    className:
      "right-[2%] top-[43%] h-[310px] w-[205px] -rotate-[3deg] md:h-[390px] md:w-[255px]",
  },
  {
    src: "/gallery/concert.jpg",
    alt: "Star Night concert",
    className:
      "left-[1%] bottom-[2%] h-[245px] w-[410px] rotate-[2deg] md:h-[300px] md:w-[500px]",
  },
  {
    src: "/gallery/hero.jpg",
    alt: "Star Night stage",
    className:
      "right-[28%] bottom-[0%] h-[245px] w-[410px] -rotate-[2deg] md:h-[300px] md:w-[500px]",
  },
];

export default function PastPerformances() {
  return (
    <section className="relative overflow-hidden bg-black py-24 text-white md:py-32">
      {/* Cinematic purple atmosphere */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[62%] top-[18%] h-[700px] w-[700px] -translate-x-1/2 rounded-full bg-[#8A2EFF]/12 blur-[190px]" />
        <div className="absolute right-[-12%] top-[30%] h-[520px] w-[520px] rounded-full bg-[#5B21B6]/10 blur-[170px]" />
        <div className="absolute left-[40%] bottom-[-10%] h-[450px] w-[450px] rounded-full bg-[#7C3AED]/7 blur-[160px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1750px] px-6 md:px-10 lg:px-14">
        <div className="grid items-center gap-12 lg:grid-cols-[0.78fr_1.22fr] lg:gap-8">
          {/* LEFT — editorial heading */}
          <div className="relative z-50 max-w-[610px] lg:pr-8 xl:pr-12">
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="mb-7 text-[10px] uppercase tracking-[0.5em] text-[#B26DFF]"
            >
              STAR NIGHT ARCHIVES
            </motion.p>

            <motion.h2
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="max-w-[610px] text-[clamp(3.2rem,5.2vw,6.5rem)] font-semibold leading-[0.86] tracking-[-0.055em]"
            >
              THE STAGE HAS
              <br />
              SEEN LEGENDS.
            </motion.h2>

            <motion.div
              initial={{ opacity: 0, scaleX: 0 }}
              whileInView={{ opacity: 1, scaleX: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2, duration: 0.65 }}
              className="mt-7 h-px w-10 origin-left bg-[#B26DFF]/70"
            />

            <motion.p
              initial={{ opacity: 0, y: 25 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1, duration: 0.75 }}
              className="mt-7 max-w-[500px] text-base leading-8 text-white/55 md:text-lg"
            >
              Every Star Night leaves behind memories that echo long after
              the lights fade. Relive the performances that brought thousands
              together under one unforgettable stage.
            </motion.p>

            <div className="mt-12 hidden items-center gap-4 lg:flex">
              <span className="h-px w-16 bg-white/10" />
              <span className="text-[8px] uppercase tracking-[0.4em] text-white/25">
                MEMORIES / STAR NIGHT
              </span>
            </div>
          </div>

          {/* RIGHT — open editorial photo mesh */}
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.98 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, amount: 0.15 }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
            className="relative mx-auto h-[760px] w-full max-w-[900px] md:h-[820px]"
          >
            {/* soft halo */}
            <div className="pointer-events-none absolute inset-[10%] rounded-full bg-[#8A2EFF]/10 blur-[130px]" />

            {starNightPhotos.map((photo, index) => (
              <motion.div
                key={photo.src}
                initial={{ opacity: 0, y: 18, scale: 0.96 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                viewport={{ once: true }}
                transition={{
                  duration: 0.65,
                  delay: 0.08 + index * 0.06,
                  ease: [0.22, 1, 0.36, 1],
                }}
                whileHover={{
                  scale: 1.035,
                  rotate: 0,
                  zIndex: 50,
                  transition: { duration: 0.25 },
                }}
                style={{ zIndex: 10 + index }}
                className={`absolute overflow-hidden rounded-[5px] border border-white/[0.16] bg-black p-[3px] shadow-[0_25px_70px_rgba(0,0,0,0.58)] ${photo.className}`}
              >
                <div className="relative h-full w-full overflow-hidden rounded-[2px]">
                  <Image
                    src={photo.src}
                    alt={photo.alt}
                    fill
                    sizes="(max-width: 768px) 90vw, 500px"
                    className="object-cover"
                  />

                  {/* Cinematic dark treatment */}
                  <div className="absolute inset-0 bg-black/[0.20]" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/15" />
                  <div className="absolute inset-0 bg-gradient-to-r from-black/10 via-transparent to-black/10" />
                </div>
              </motion.div>
            ))}

            {/* very subtle outer vignette */}
            <div className="pointer-events-none absolute inset-0 z-[60] bg-[radial-gradient(ellipse_at_center,transparent_63%,rgba(0,0,0,0.28)_100%)]" />
          </motion.div>
        </div>

        {/* Past artists */}
        <div className="mt-20 md:mt-24">
          {artists.map((artist) => (
            <ArtistCard key={artist.year} {...artist} />
          ))}
        </div>

        {/* Closing transition */}
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
              <span className="text-[9px] uppercase tracking-[0.4em] text-purple-300/45">
                THE STORY CONTINUES
              </span>
              <span className="h-px flex-1 bg-gradient-to-l from-transparent to-white/10" />
            </div>

            <p className="mt-8 font-serif text-2xl text-white/60 sm:text-4xl">
              The past made its mark.
            </p>

            <p className="mt-2 text-xs uppercase tracking-[0.3em] text-white/25">
              Now we turn the page
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
