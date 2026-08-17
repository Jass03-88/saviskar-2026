"use client";

import { motion, AnimatePresence } from "motion/react";
import { useEffect, useMemo, useState } from "react";

type StageTransitionProps = {
  onComplete: () => void;
};

export default function StageTransition({
  onComplete,
}: StageTransitionProps) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 120),
      setTimeout(() => setPhase(2), 650),
      setTimeout(() => setPhase(3), 1150),
      setTimeout(() => onComplete(), 1850),
    ];
    return () => timers.forEach(clearTimeout);
  }, [onComplete]);

  const particles = useMemo(
    () =>
      Array.from({ length: 36 }).map((_, i) => ({
        id: i,
        left: (i * 37) % 100,
        top: (i * 53) % 100,
        size: 2 + (i % 4),
        delay: (i % 8) * 0.2,
      })),
    []
  );

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.45 }}
        className="fixed inset-0 z-[9999] overflow-hidden bg-black"
      >
        {/* Ambient Glow */}
        <motion.div
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{
            scale: phase >= 1 ? 2 : 0.4,
            opacity: phase >= 1 ? 0.45 : 0,
          }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
          className="absolute left-1/2 top-1/2 h-[900px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#8A2EFF] blur-[220px]"
        />

        {/* Spotlight */}
        <motion.div
          initial={{ x: "-120%", rotate: -22, opacity: 0 }}
          animate={{
            x: phase >= 2 ? "140%" : "-120%",
            opacity: phase >= 2 ? 0.85 : 0,
          }}
          transition={{ duration: 1.05, ease: "easeInOut" }}
          className="absolute top-[-25%] left-[-20%] h-[170%] w-[30%]"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(190,130,255,.55), transparent)",
            filter: "blur(28px)",
          }}
        />

        {/* Dust */}
        {particles.map((p) => (
          <motion.span
            key={p.id}
            className="absolute rounded-full bg-white/60"
            style={{
              left: `${p.left}%`,
              top: `${p.top}%`,
              width: p.size,
              height: p.size,
            }}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: [0, 0.8, 0], y: -120 }}
            transition={{
              repeat: Infinity,
              duration: 3.5,
              delay: p.delay,
              ease: "linear",
            }}
          />
        ))}

        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: phase >= 2 ? 1 : 0, y: phase >= 2 ? 0 : 20 }}
            transition={{ duration: 0.45 }}
            className="mb-6 text-xs uppercase tracking-[0.6em] text-white/55"
          >
            THE LIGHTS GO OUT
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{
              opacity: phase >= 3 ? 1 : 0,
              scale: phase >= 3 ? 1 : 0.92,
            }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="text-[clamp(4rem,13vw,10rem)] font-semibold leading-[0.82] tracking-[-0.05em] text-white"
          >
            STAR
            <br />
            NIGHT.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: phase >= 3 ? 1 : 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="mt-6 text-sm uppercase tracking-[0.45em] text-white/40"
          >
            One Stage. One Night. Unforgettable.
          </motion.p>
        </div>

        {/* Dissolve overlay */}
        <motion.div
          initial={{ opacity: 1 }}
          animate={{ opacity: phase >= 3 ? 0 : 1 }}
          transition={{ delay: 1.4, duration: 0.5 }}
          className="pointer-events-none absolute inset-0 bg-black"
        />
      </motion.div>
    </AnimatePresence>
  );
}
