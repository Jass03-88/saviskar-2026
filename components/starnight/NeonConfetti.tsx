"use client";

import { useEffect, useRef, useCallback } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  shape: "rect" | "circle" | "ribbon" | "star";
  rotation: number;
  rotationSpeed: number;
  wobble: number;
  wobbleSpeed: number;
  opacity: number;
  decay: number;
}

// Saviskar 2026 Star Night neon festival palette
const THEME_CONFETTI_COLORS = [
  "#8A2EFF", // Deep Electric Purple
  "#A855F7", // Neon Violet
  "#C084FC", // Lilac Glow
  "#06B6D4", // Electric Cyan
  "#22D3EE", // Sky Cyan Glow
  "#EC4899", // Vivid Magenta
  "#F43F5E", // Rose Laser
  "#F59E0B", // Amber Gold
  "#FACC15", // Star Gold
  "#10B981", // Emerald Neon
  "#FFFFFF", // Pure White Sparkle
];

interface NeonConfettiProps {
  active: boolean;
  onComplete?: () => void;
  durationMs?: number;
}

export default function NeonConfetti({
  active,
  onComplete,
  durationMs = 5000,
}: NeonConfettiProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animIdRef = useRef<number | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const isRunningRef = useRef<boolean>(false);

  const spawnBurst = useCallback(
    (originXPercent: number, originYPercent: number, angleDeg: number, count: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const originX = canvas.width * originXPercent;
      const originY = canvas.height * originYPercent;

      const angleRad = (angleDeg * Math.PI) / 180;
      const spreadRad = (60 * Math.PI) / 180;

      for (let i = 0; i < count; i++) {
        const pAngle = angleRad + (Math.random() - 0.5) * spreadRad;
        const speed = 12 + Math.random() * 22;
        const color =
          THEME_CONFETTI_COLORS[
            Math.floor(Math.random() * THEME_CONFETTI_COLORS.length)
          ];

        const shapes: ("rect" | "circle" | "ribbon" | "star")[] = [
          "rect",
          "ribbon",
          "circle",
          "star",
        ];
        const shape = shapes[Math.floor(Math.random() * shapes.length)];

        particlesRef.current.push({
          x: originX,
          y: originY,
          vx: Math.cos(pAngle) * speed,
          vy: Math.sin(pAngle) * speed,
          size: 6 + Math.random() * 8,
          color,
          shape,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.25,
          wobble: Math.random() * Math.PI * 2,
          wobbleSpeed: 0.08 + Math.random() * 0.12,
          opacity: 1,
          decay: 0.0035 + Math.random() * 0.004,
        });
      }
    },
    []
  );

  const startConfetti = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Double cannon stadium explosion (Left and Right corners + center fountain)
    spawnBurst(0.12, 0.75, -55, 65);
    spawnBurst(0.88, 0.75, -125, 65);
    spawnBurst(0.5, 0.65, -90, 80);

    // Second staggered burst for realistic stadium encore feel
    setTimeout(() => {
      spawnBurst(0.2, 0.7, -50, 45);
      spawnBurst(0.8, 0.7, -130, 45);
    }, 400);

    setTimeout(() => {
      spawnBurst(0.35, 0.65, -75, 40);
      spawnBurst(0.65, 0.65, -105, 40);
    }, 850);
  }, [spawnBurst]);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.scale(dpr, dpr);
    };

    resize();
    window.addEventListener("resize", resize);

    isRunningRef.current = true;
    startConfetti();

    const startTime = performance.now();

    const loop = (currentTime: number) => {
      if (!isRunningRef.current) return;

      const elapsed = currentTime - startTime;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      const gravity = 0.42;
      const drag = 0.965;
      const particles = particlesRef.current;

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

        p.vx *= drag;
        p.vy = p.vy * drag + gravity;
        p.x += p.vx;
        p.y += p.vy;

        p.wobble += p.wobbleSpeed;
        p.rotation += p.rotationSpeed;
        p.opacity -= p.decay;

        if (p.opacity <= 0 || p.y > window.innerHeight + 50) {
          particles.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.fillStyle = p.color;
        ctx.strokeStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = p.opacity > 0.6 ? 8 : 2;

        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);

        const xWobble = Math.sin(p.wobble) * p.size;

        if (p.shape === "rect") {
          ctx.fillRect(-p.size / 2, -p.size / 2, xWobble, p.size);
        } else if (p.shape === "ribbon") {
          ctx.beginPath();
          ctx.rect(-p.size * 0.7, -p.size * 0.25, xWobble * 1.5, p.size * 0.5);
          ctx.fill();
        } else if (p.shape === "circle") {
          ctx.beginPath();
          ctx.arc(0, 0, Math.abs(xWobble) * 0.5, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.shape === "star") {
          const s = Math.abs(xWobble) * 0.7;
          ctx.beginPath();
          ctx.moveTo(0, -s);
          ctx.lineTo(s * 0.3, -s * 0.3);
          ctx.lineTo(s, 0);
          ctx.lineTo(s * 0.3, s * 0.3);
          ctx.lineTo(0, s);
          ctx.lineTo(-s * 0.3, s * 0.3);
          ctx.lineTo(-s, 0);
          ctx.lineTo(-s * 0.3, -s * 0.3);
          ctx.closePath();
          ctx.fill();
        }

        ctx.restore();
      }

      if (particles.length > 0 && elapsed < durationMs) {
        animIdRef.current = requestAnimationFrame(loop);
      } else {
        isRunningRef.current = false;
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        if (onComplete) onComplete();
      }
    };

    animIdRef.current = requestAnimationFrame(loop);

    return () => {
      isRunningRef.current = false;
      if (animIdRef.current) cancelAnimationFrame(animIdRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [active, startConfetti, durationMs, onComplete]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-[9999] h-full w-full"
      style={{ width: "100vw", height: "100vh" }}
    />
  );
}
