"use client";

import Image from "next/image";
import {
  motion,
  useScroll,
  useTransform,
} from "motion/react";
import { useRef } from "react";

export default function Story() {
  const sectionRef = useRef<HTMLElement>(null);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });

  // Container expands into the screen
  const scale = useTransform(
    scrollYProgress,
    [0, 0.3, 0.7],
    [0.82, 1, 1]
  );

  const radius = useTransform(
    scrollYProgress,
    [0, 0.32],
    ["36px", "0px"]
  );

  // Slow cinematic image zoom
  const imageScale = useTransform(
    scrollYProgress,
    [0, 0.75],
    [1.16, 1]
  );

  // Slight vertical parallax
  const imageY = useTransform(
    scrollYProgress,
    [0, 1],
    ["-3%", "3%"]
  );

  // Small label
  const labelOpacity = useTransform(
    scrollYProgress,
    [0.2, 0.34, 0.7],
    [0, 1, 1]
  );

  const labelY = useTransform(
    scrollYProgress,
    [0.2, 0.38],
    [25, 0]
  );

  // Main heading
  const headingOpacity = useTransform(
    scrollYProgress,
    [0.27, 0.43, 0.75],
    [0, 1, 1]
  );

  const headingY = useTransform(
    scrollYProgress,
    [0.27, 0.46],
    [70, 0]
  );

  const headingScale = useTransform(
    scrollYProgress,
    [0.27, 0.46],
    [0.94, 1]
  );

  // Darkens image slightly as text enters
  const overlayOpacity = useTransform(
    scrollYProgress,
    [0.15, 0.45],
    [0.2, 0.48]
  );

  return (
    <section
      ref={sectionRef}
      id="story"
      className="relative h-[190vh] bg-black"
    >
      <div className="sticky top-0 flex h-screen items-center justify-center overflow-hidden">

        <motion.div
          style={{
            scale,
            borderRadius: radius,
          }}
          className="relative h-[84vh] w-[92vw] max-w-[1500px] overflow-hidden"
        >

          {/* Concert Image */}
          <motion.div
            style={{
              scale: imageScale,
              y: imageY,
            }}
            className="absolute -inset-[5%]"
          >
            <Image
              src="/images/hero.jpg"
              alt="Saviskar live concert"
              fill
              priority
              sizes="100vw"
              className="object-cover object-center"
            />
          </motion.div>

          {/* Dynamic dark overlay */}
          <motion.div
            style={{ opacity: overlayOpacity }}
            className="absolute inset-0 bg-black"
          />

          {/* Cinematic gradients */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/25" />

          <div className="absolute inset-0 bg-gradient-to-r from-black/20 via-transparent to-black/20" />

          {/* Subtle vignette */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              boxShadow:
                "inset 0 0 140px 30px rgba(0,0,0,0.35)",
            }}
          />

          {/* Story Text */}
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-white">
            <div>

              <motion.p
                style={{
                  opacity: labelOpacity,
                  y: labelY,
                }}
                className="mb-5 text-[10px] font-medium uppercase tracking-[0.3em] text-white/55 md:text-[11px]"
              >
                One campus. One experience.
              </motion.p>

              <motion.h2
                style={{
                  opacity: headingOpacity,
                  y: headingY,
                  scale: headingScale,
                }}
                className="text-[clamp(3.5rem,8vw,8rem)] font-semibold leading-[0.85] tracking-[-0.065em]"
              >
                This is
                <br />
                Saviskar.
              </motion.h2>

            </div>
          </div>

          {/* Bottom detail */}
          <motion.div
            style={{ opacity: headingOpacity }}
            className="absolute bottom-7 left-0 flex w-full justify-between px-7 text-[9px] uppercase tracking-[0.2em] text-white/35 md:px-10 md:text-[10px]"
          >
            <span>CGC University</span>
            <span>Mohali</span>
          </motion.div>

        </motion.div>
      </div>
    </section>
  );
}