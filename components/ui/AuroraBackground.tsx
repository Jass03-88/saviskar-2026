"use client";

import { motion } from "motion/react";

export default function AuroraBackground() {
  const stars = Array.from({ length: 70 }, (_, i) => ({
    id: i,
    left: (i * 37) % 100,
    top: (i * 53) % 100,
    delay: (i * 0.15) % 5,
  }));

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">

      {/* Base */}
      <div className="absolute inset-0 bg-black" />

      {/* Aurora 1 */}
      <motion.div
        animate={{
          x: [-80, 80, -80],
          y: [-40, 30, -40],
          scale: [1, 1.15, 1],
        }}
        transition={{
          duration: 18,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="absolute left-1/2 top-1/2 h-[900px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-600/20 blur-[220px]"
      />

      {/* Aurora 2 */}
      <motion.div
        animate={{
          x: [50, -50, 50],
          y: [40, -30, 40],
          scale: [1, 1.2, 1],
        }}
        transition={{
          duration: 24,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="absolute left-[25%] top-[30%] h-[700px] w-[700px] rounded-full bg-fuchsia-500/15 blur-[200px]"
      />

      {/* Aurora 3 */}
      <motion.div
        animate={{
          x: [-60, 60, -60],
          y: [20, -20, 20],
          scale: [1, 1.25, 1],
        }}
        transition={{
          duration: 28,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="absolute left-1/2 top-[15%] h-[820px] w-[820px] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-[250px]"
      />

      {/* Stars */}
      <div className="absolute inset-0">
        {stars.map((star) => (
          <motion.div
            key={star.id}
            className="absolute h-[2px] w-[2px] rounded-full bg-white"
            style={{
              left: `${star.left}%`,
              top: `${star.top}%`,
            }}
            animate={{
              opacity: [0.2, 1, 0.2],
              scale: [1, 1.5, 1],
            }}
            transition={{
              duration: 3,
              delay: star.delay,
              repeat: Infinity,
            }}
          />
        ))}
      </div>

      {/* Grid */}
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,.15) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,.15) 1px, transparent 1px)
          `,
          backgroundSize: "80px 80px",
        }}
      />

      {/* Noise */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "url('https://grainy-gradients.vercel.app/noise.svg')",
        }}
      />
    </div>
  );
}