"use client";

import { useRef } from "react";
import { motion, useInView } from "motion/react";
import Link from "next/link";
import { ArrowUpRight, Sparkles, Eye, Camera } from "lucide-react";
import DomeGallery, { DomeGalleryImage } from "@/components/ui/DomeGallery";
import { GLIMPSE_175_UNIQUE_TILES } from "@/data/gdriveManifest";

// 175 distinct, authentic festival photos streamed directly from Google Drive CDN (zero local storage)
const DOME_175_TILES: DomeGalleryImage[] = GLIMPSE_175_UNIQUE_TILES.map((tile, i) => ({
  src: tile.thumbnailSrc ? tile.thumbnailSrc.replace(/=s\d+$/, "=s400") : tile.src,
  alt: `Saviskar 2026 Festival Realm Frame ${i + 1}`,
}));

export default function GalleryGlimpse() {
  const domeContainerRef = useRef<HTMLDivElement>(null);
  const isDomeInView = useInView(domeContainerRef, {
    once: true,
    margin: "600px 0px",
  });

  return (
    <section
      id="gallery"
      className="relative overflow-hidden bg-transparent py-24 text-white md:py-32"
    >
      {/* Seamless atmospheric scene blend from section above */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/50 via-black/10 to-transparent z-0" />

      {/* Subtle ambient stage haze in background */}
      <div className="pointer-events-none absolute right-[5%] top-[20%] h-[550px] w-[550px] rounded-full bg-violet-600/10 blur-[170px]" />
      <div className="pointer-events-none absolute left-[5%] bottom-[10%] h-[500px] w-[500px] rounded-full bg-fuchsia-600/10 blur-[160px]" />

      <div className="relative z-10 mx-auto max-w-[1400px] px-5 md:px-10">
        {/* Section Header */}
        <div className="mb-10 flex flex-col gap-6 md:mb-16 lg:flex-row lg:items-end lg:justify-between">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: false, amount: 0.2 }}
            transition={{ duration: 0.8 }}
          >
            <div className="liquid-glass mb-4 sm:mb-6 inline-flex items-center gap-2 rounded-full px-3.5 py-1 sm:px-4 sm:py-1.5 text-[9px] sm:text-[10px] font-semibold uppercase tracking-[0.25em] sm:tracking-[0.3em] text-violet-300">
              <Sparkles size={12} />
              VISUAL ARCHIVE // GLIMPSE
            </div>

            <h2 className="text-[clamp(2.5rem,8vw,7.5rem)] font-light leading-[0.88] md:leading-[0.82] tracking-tight text-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.95)]">
              The Sound. <br />
              The Lights. <br />
              <span className="font-editorial text-violet-300 font-normal">The Realm.</span>
            </h2>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: false, amount: 0.2 }}
            transition={{ duration: 0.8, delay: 0.15 }}
            className="lg:max-w-md lg:pb-3 rounded-2xl border border-white/12 bg-black/60 backdrop-blur-xl p-5 sm:p-6 shadow-[0_15px_40px_rgba(0,0,0,0.6)]"
          >
            <p className="text-sm leading-relaxed text-zinc-200 md:text-lg font-normal">
              A pulse-racing glimpse into the ground-shaking bass, laser pyrotechnics, and high-voltage rivalries of Saviskar.
              35,000+ creators, hackers, and performers uniting across 500+ colleges at CGC University Mohali.
            </p>

            <div className="mt-3.5 sm:mt-4 flex items-center gap-2.5 font-mono text-[10px] sm:text-[11px] font-medium tracking-wider sm:tracking-widest text-violet-300 uppercase">
              <Camera size={13} />
              <span>175 UNIQUE 8K FRAMES // ZERO REPEATS</span>
            </div>
          </motion.div>
        </div>
      </div>

      {/* 3D Spherical Dome Gallery - Blending seamlessly into page background without separate container */}
      <div className="relative z-10 w-full overflow-hidden my-2 sm:my-4 md:my-8">
        {/* Soft atmospheric stage halo behind the dome */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[750px] w-full max-w-[1500px] rounded-full bg-gradient-to-r from-violet-600/15 via-fuchsia-600/10 to-indigo-600/15 blur-[180px] -z-10" />

        <div
          ref={domeContainerRef}
          className="relative h-[560px] w-full sm:h-[680px] md:h-[780px] lg:h-[860px]"
        >
          {isDomeInView ? (
            <DomeGallery
              images={DOME_175_TILES}
              fit={0.76}
              fitBasis="width"
              minRadius={540}
              maxRadius={Infinity}
              overlayBlurColor="transparent"
              grayscale={false}
              openedImageWidth="min(480px, 86vw)"
              openedImageHeight="min(380px, 65vh)"
              imageBorderRadius="30px"
              openedImageBorderRadius="24px"
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center">
              <div className="h-8 w-8 rounded-full border-2 border-violet-500/20 border-t-violet-400 animate-spin" />
            </div>
          )}

          {/* Floating Interactive Glass Prompt */}
          <div className="pointer-events-none absolute bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 rounded-full border border-white/15 bg-black/80 px-4 py-1.5 sm:px-5 sm:py-2 text-[11px] sm:text-xs font-medium text-white/90 backdrop-blur-md shadow-[0_10px_25px_rgba(0,0,0,0.6)] whitespace-nowrap max-w-[92vw]">
            <span className="h-2 w-2 shrink-0 rounded-full bg-violet-400 animate-pulse shadow-[0_0_8px_#c084fc]" />
            <span className="hidden sm:inline">Drag or swipe to rotate 3D sphere • Click any frame to enlarge</span>
            <span className="sm:hidden">Drag to rotate • Tap to enlarge</span>
          </div>
        </div>
      </div>

      <div className="relative z-10 mx-auto max-w-[1400px] px-5 md:px-10">

        {/* Big High-Impact "Explore Complete Gallery" CTA Banner */}
        <motion.div
          initial={{ opacity: 0, y: 25 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: false, amount: 0.2 }}
          transition={{ duration: 0.8 }}
          className="liquid-glass-card mt-12 flex flex-col items-center justify-between gap-6 rounded-[30px] border border-white/15 bg-black/65 backdrop-blur-2xl p-8 md:mt-16 md:flex-row md:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.7)]"
        >
          <div className="flex flex-col gap-1.5 text-center md:text-left">
            <div className="flex items-center justify-center gap-2 md:justify-start font-mono text-[11px] font-semibold uppercase tracking-[0.3em] text-violet-300">
              <Eye size={13} />
              <span>EXPAND ARCHIVE // COMPLETE REALM GALLERY</span>
            </div>
            <h3 className="text-2xl font-light text-white md:text-3xl drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
              Want to see <span className="font-editorial text-violet-300 font-normal">the entire journey?</span>
            </h3>
            <p className="max-w-xl text-xs leading-relaxed text-zinc-300 md:text-sm font-normal">
              Explore the full interactive photo archive featuring crowd panoramas, celebrity star nights, and stage celebrations.
            </p>
          </div>

          <motion.div
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            transition={{ duration: 0.2 }}
          >
            <Link
              href="/gallery"
              className="group flex items-center gap-3 rounded-full bg-white px-8 py-4 text-sm font-semibold tracking-wide text-black shadow-[0_0_30px_rgba(255,255,255,0.35)] transition-all hover:bg-violet-100 hover:shadow-[0_0_45px_rgba(255,255,255,0.55)]"
            >
              <span>Explore Complete Gallery</span>
              <ArrowUpRight
                size={16}
                className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </Link>
          </motion.div>
        </motion.div>
      </div>

      {/* Seamless scene blend into continuous Footer */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/70 via-black/25 to-transparent z-0" />
    </section>
  );
}
