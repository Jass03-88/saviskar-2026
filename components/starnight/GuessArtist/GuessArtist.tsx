"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import {
  Radio,
  Volume2,
  VolumeX,
  Zap,
  Sparkles,
  Lock,
  CheckCircle2,
  Music,
  Flame,
  ArrowRight,
} from "lucide-react";
import NeonConfetti from "../NeonConfetti";

const TARGET_FREQ = 102.6;
const FREQ_MIN = 88.0;
const FREQ_MAX = 108.0;

export default function GuessArtist() {
  const [frequency, setFrequency] = useState<number>(93.4);
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [stageIgnited, setStageIgnited] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(false);
  const [showConfetti, setShowConfetti] = useState<boolean>(false);
  const confettiFiredRef = useRef<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Calculate alignment proximity: 0 (far) to 1 (perfect lock)
  const diff = Math.abs(frequency - TARGET_FREQ);
  const alignment = Math.max(0, 1 - diff / 4.5);
  const isTargetClose = diff <= 0.45;

  // Track locked status & trigger reveal confetti
  useEffect(() => {
    if (isTargetClose) {
      setIsLocked(true);
      if (!confettiFiredRef.current) {
        confettiFiredRef.current = true;
        setStageIgnited(true);
        setShowConfetti(true);
      }
    }
  }, [isTargetClose]);

  // Web Audio synth tone for subtle auditory feedback
  const startAudio = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      if (!audioCtxRef.current) {
        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        audioCtxRef.current = new AudioContextClass();
      }
      if (audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume();
      }

      if (!oscRef.current && audioCtxRef.current) {
        const ctx = audioCtxRef.current;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(220 + alignment * 440, ctx.currentTime);
        gain.gain.setValueAtTime(0.04, ctx.currentTime);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();

        oscRef.current = osc;
        gainRef.current = gain;
      }
    } catch {
      // AudioContext policy
    }
  }, [alignment]);

  const stopAudio = useCallback(() => {
    if (oscRef.current) {
      try {
        oscRef.current.stop();
        oscRef.current.disconnect();
      } catch {
        // ignore
      }
      oscRef.current = null;
    }
  }, []);

  // Toggle sound
  const toggleSound = () => {
    if (!soundEnabled) {
      setSoundEnabled(true);
      startAudio();
    } else {
      setSoundEnabled(false);
      stopAudio();
    }
  };

  // Adjust pitch with frequency when sound is on
  useEffect(() => {
    if (soundEnabled && oscRef.current && audioCtxRef.current) {
      const targetPitch = 180 + alignment * 520;
      oscRef.current.frequency.setTargetAtTime(
        targetPitch,
        audioCtxRef.current.currentTime,
        0.05
      );
      if (gainRef.current) {
        const vol = 0.02 + alignment * 0.08;
        gainRef.current.gain.setTargetAtTime(
          vol,
          audioCtxRef.current.currentTime,
          0.05
        );
      }
    }
  }, [frequency, alignment, soundEnabled]);

  useEffect(() => {
    return () => {
      stopAudio();
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, [stopAudio]);

  // Real-time oscilloscope canvas animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let phase = 0;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      // Background grid lines
      ctx.strokeStyle = "rgba(168, 85, 247, 0.08)";
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 30) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 30) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Draw primary wave (Purple)
      ctx.beginPath();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = isLocked
        ? "rgba(192, 132, 252, 0.95)"
        : `rgba(168, 85, 247, ${0.4 + alignment * 0.5})`;

      const noiseAmount = Math.max(0.05, (1 - alignment) * 18);
      const waveFreq = 0.015 + alignment * 0.025;
      const amp = 15 + alignment * 45;

      for (let x = 0; x < width; x += 2) {
        const noise = (Math.random() - 0.5) * noiseAmount;
        const y =
          centerY +
          Math.sin(x * waveFreq + phase) * amp +
          Math.cos(x * 0.008 - phase * 0.6) * (amp * 0.35) +
          noise;

        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Secondary wave (Cyan ghost)
      ctx.beginPath();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(56, 189, 248, ${0.2 + alignment * 0.6})`;
      for (let x = 0; x < width; x += 3) {
        const noise = (Math.random() - 0.5) * (noiseAmount * 0.6);
        const y =
          centerY +
          Math.sin(x * (waveFreq * 1.2) - phase * 1.3) * (amp * 0.75) +
          noise;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      phase += 0.06 + alignment * 0.08;
      animFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [alignment, isLocked]);

  const handleIgnite = () => {
    setStageIgnited(true);
    setShowConfetti(false);
    setTimeout(() => setShowConfetti(true), 30);
  };

  return (
    <section
      id="reveal-console"
      className="relative min-h-screen w-full overflow-hidden bg-black py-24 text-white md:py-32"
    >
      {/* Stadium Celebration Confetti Layer */}
      <NeonConfetti
        active={showConfetti}
        onComplete={() => setShowConfetti(false)}
      />
      {/* Stadium core ambient background glow */}
      <motion.div
        animate={{
          scale: stageIgnited ? [1, 1.35, 1.2] : [1, 1.08, 1],
          opacity: stageIgnited ? 0.35 : [0.12, 0.22, 0.12],
        }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        className="pointer-events-none absolute left-1/2 top-1/2 h-[900px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#8A2EFF]/20 blur-[220px]"
      />

      <div className="relative z-10 mx-auto max-w-[1550px] px-6 md:px-10 lg:px-14">
        {/* Section Header */}
        <div className="mx-auto max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 rounded-full border border-violet-400/40 bg-violet-500/15 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.35em] text-violet-300"
          >
            <Radio size={13} className="animate-pulse text-violet-400" />
            AEVORIAN CONCERT FREQUENCY DECRYPTOR
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="mt-6 text-[clamp(2.5rem,6.5vw,6rem)] font-bold leading-[0.9] tracking-tight text-white"
          >
            WHO TAKES THE STAGE
            <br />
            <span className="bg-gradient-to-r from-violet-300 via-purple-300 to-indigo-300 bg-clip-text text-transparent">
              IN 2026?
            </span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.15, duration: 0.7 }}
            className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-white/60 md:text-lg"
          >
            The 2026 headline transmission is encrypted across stadium airwaves.
            Tune the master soundboard to{" "}
            <span className="font-mono font-semibold text-violet-300">
              102.6 MHz
            </span>{" "}
            to calibrate the sonic lock and ignite the stadium reveal.
          </motion.p>
        </div>

        {/* Master Console Container */}
        <div
          className="relative mt-14 overflow-hidden border border-white/20 bg-gradient-to-b from-white/[0.07] to-black/90 p-6 backdrop-blur-2xl md:p-10 shadow-[0_30px_90px_rgba(0,0,0,0.85)]"
          style={{
            clipPath:
              "polygon(0 24px, 24px 0, calc(100% - 24px) 0, 100% 24px, 100% calc(100% - 24px), calc(100% - 24px) 100%, 24px 100%, 0 calc(100% - 24px))",
          }}
        >
          {/* Sci-Fi Corner Brackets */}
          <div className="pointer-events-none absolute left-2 top-2 h-4 w-4 border-l-2 border-t-2 border-violet-400" />
          <div className="pointer-events-none absolute right-2 top-2 h-4 w-4 border-r-2 border-t-2 border-violet-400" />
          <div className="pointer-events-none absolute bottom-2 left-2 h-4 w-4 border-b-2 border-l-2 border-violet-400" />
          <div className="pointer-events-none absolute bottom-2 right-2 h-4 w-4 border-b-2 border-r-2 border-violet-400" />

          {/* Top Console Status Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span
                  className={`absolute inline-flex h-full w-full rounded-full ${
                    isTargetClose
                      ? "animate-ping bg-emerald-400 opacity-75"
                      : "bg-violet-400 opacity-40"
                  }`}
                />
                <span
                  className={`relative inline-flex h-3 w-3 rounded-full ${
                    isTargetClose ? "bg-emerald-500" : "bg-violet-500"
                  }`}
                />
              </span>
              <span className="font-mono text-xs uppercase tracking-widest text-white/80">
                {isTargetClose
                  ? "SIGNAL LOCKED • BROADCAST ACTIVE"
                  : "SCANNING FREQUENCY SPECTRUM..."}
              </span>
            </div>

            <div className="flex items-center gap-3">
              {/* Audio feedback button */}
              <button
                type="button"
                onClick={toggleSound}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 font-mono text-[11px] text-white/70 transition-colors hover:border-violet-400/50 hover:text-white"
                title="Toggle sonic synthesizer tone"
              >
                {soundEnabled ? (
                  <>
                    <Volume2 size={13} className="text-violet-400" />
                    <span>AUDIO ON</span>
                  </>
                ) : (
                  <>
                    <VolumeX size={13} className="text-white/40" />
                    <span>SYNTH SOUND OFF</span>
                  </>
                )}
              </button>

              {/* Quick auto-tune preset */}
              <button
                type="button"
                onClick={() => setFrequency(TARGET_FREQ)}
                className="rounded-full border border-violet-400/30 bg-violet-500/10 px-4 py-1.5 font-mono text-[11px] text-violet-300 transition-colors hover:bg-violet-500/20"
              >
                AUTO-TUNE 102.6
              </button>
            </div>
          </div>

          {/* Center Soundboard: Live Waveform Oscilloscope */}
          <div className="relative mt-8 h-48 w-full overflow-hidden rounded-2xl border border-white/10 bg-black/80 md:h-64">
            <canvas
              ref={canvasRef}
              width={1400}
              height={260}
              className="h-full w-full object-cover"
            />

            {/* Oscilloscope HUD Overlays */}
            <div className="pointer-events-none absolute left-5 top-5 font-mono text-[10px] uppercase tracking-wider text-violet-300/80">
              CH-01: ACOUSTIC / BEAT HARMONIC
              <br />
              CH-02: SYNTH RESONANCE • {Math.round(alignment * 100)}%
            </div>

            <div className="pointer-events-none absolute right-5 top-5 text-right font-mono text-[10px] uppercase tracking-wider text-white/50">
              TARGET: 102.6 MHz
              <br />
              <span
                className={
                  isTargetClose ? "text-emerald-400" : "text-amber-400"
                }
              >
                DELTA: {diff.toFixed(2)} MHz
              </span>
            </div>

            {/* Big center frequency readout */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <span className="font-mono text-4xl font-extrabold tracking-tight text-white/90 drop-shadow-[0_0_30px_rgba(168,85,247,0.5)] sm:text-6xl md:text-7xl">
                  {frequency.toFixed(1)}{" "}
                  <span className="text-xl font-normal text-violet-400 sm:text-2xl">
                    MHz
                  </span>
                </span>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.35em] text-white/50">
                  {isTargetClose
                    ? "★ HARMONIC RESONANCE ESTABLISHED ★"
                    : "CALIBRATE SLIDER TO 102.6 MHz"}
                </p>
              </div>
            </div>
          </div>

          {/* Interactive Tuning Fader Slider */}
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
            <div className="flex items-center justify-between text-xs font-mono text-white/60">
              <span>{FREQ_MIN.toFixed(1)} MHz</span>
              <span className="text-violet-300 font-bold">
                102.6 MHz (SAVISKAR MAINSTAGE)
              </span>
              <span>{FREQ_MAX.toFixed(1)} MHz</span>
            </div>

            <div className="relative mt-4 flex items-center">
              <input
                type="range"
                min={FREQ_MIN}
                max={FREQ_MAX}
                step={0.1}
                value={frequency}
                onChange={(e) => setFrequency(parseFloat(e.target.value))}
                className="h-3 w-full cursor-pointer appearance-none rounded-lg bg-white/10 accent-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-400/50"
              />
            </div>

            {/* Preset frequency buttons */}
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2 sm:gap-4">
              {[89.2, 94.5, 98.8, 102.6, 105.4].map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFrequency(f)}
                  className={`rounded-full px-4 py-1.5 font-mono text-xs transition-all ${
                    frequency === f
                      ? "border border-violet-400 bg-violet-500 text-white shadow-[0_0_20px_rgba(168,85,247,0.5)]"
                      : "border border-white/10 bg-white/5 text-white/60 hover:border-white/25 hover:text-white"
                  }`}
                >
                  {f === 102.6 ? "★ 102.6 MHz (Target)" : `${f} MHz`}
                </button>
              ))}
            </div>
          </div>

          {/* Reveal & Ignition Trigger */}
          <div className="mt-8 flex flex-col items-center justify-center border-t border-white/10 pt-8 text-center">
            {isTargetClose ? (
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="flex flex-col items-center"
              >
                <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-emerald-500/15 border border-emerald-400/30 px-4 py-1.5 font-mono text-xs text-emerald-300">
                  <CheckCircle2 size={14} />
                  100% SIGNAL MATCH • FREQUENCY DECRYPTED
                </div>

                <button
                  type="button"
                  onClick={handleIgnite}
                  className="group relative inline-flex items-center gap-3 overflow-hidden rounded-full border border-violet-400 bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 px-9 py-4 font-mono text-sm font-bold uppercase tracking-wider text-white shadow-[0_0_50px_rgba(168,85,247,0.45)] transition-all hover:scale-105 hover:shadow-[0_0_80px_rgba(168,85,247,0.7)]"
                >
                  <Zap
                    size={18}
                    className="transition-transform group-hover:rotate-12"
                  />
                  <span>IGNITE STADIUM LIGHTS</span>
                  <Flame
                    size={18}
                    className="text-amber-300 transition-transform group-hover:scale-125"
                  />
                </button>
              </motion.div>
            ) : (
              <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-white/40">
                <Lock size={14} />
                <span>ALIGN SLIDER TO 102.6 MHz TO UNLOCK STAGE IGNITION</span>
              </div>
            )}
          </div>
        </div>

        {/* Revealed Stage & Teasers */}
        <AnimatePresence>
          {stageIgnited && (
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
              className="mt-16"
            >
              <div className="mb-8 text-center">
                <span className="font-mono text-xs uppercase tracking-[0.4em] text-violet-400">
                  TRANSMISSION DECRYPTED • CGC MAINSTAGE LINEUP
                </span>
                <h3 className="mt-2 text-3xl font-bold tracking-tight text-white md:text-5xl">
                  SAVISKAR 2026 HEADLINER DOSSIER
                </h3>
              </div>

              {/* Day 1 & Day 2 Official Headliner Cards */}
              <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                {/* Day 1 Card: Asees Kaur */}
                <div
                  className="group relative overflow-hidden border border-violet-400/40 bg-gradient-to-b from-white/[0.08] to-black/85 p-6 backdrop-blur-xl transition-all duration-500 hover:border-violet-400/70 hover:shadow-[0_0_50px_rgba(168,85,247,0.3)] md:p-8"
                  style={{
                    clipPath:
                      "polygon(0 18px, 18px 0, calc(100% - 18px) 0, 100% 18px, 100% calc(100% - 18px), calc(100% - 18px) 100%, 18px 100%, 0 calc(100% - 18px))",
                  }}
                >
                  <div className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 border-l-2 border-t-2 border-violet-400" />
                  <div className="pointer-events-none absolute right-2 top-2 h-3.5 w-3.5 border-r-2 border-t-2 border-violet-400" />
                  <div className="pointer-events-none absolute bottom-2 left-2 h-3.5 w-3.5 border-b-2 border-l-2 border-violet-400" />
                  <div className="pointer-events-none absolute bottom-2 right-2 h-3.5 w-3.5 border-b-2 border-r-2 border-violet-400" />

                  {/* Top Badge & Confirmed Status */}
                  <div className="flex items-center justify-between">
                    <span className="border border-violet-400/40 bg-violet-500/20 px-3.5 py-1 font-mono text-xs font-semibold text-violet-200">
                      [DAY 01 // HEADLINER]
                    </span>
                    <span className="flex items-center gap-1.5 font-mono text-[11px] text-emerald-400">
                      <CheckCircle2 size={12} />
                      TRANSMISSION CONFIRMED
                    </span>
                  </div>

                  {/* Artist Photo Spotlight */}
                  <div className="relative mt-5 aspect-[16/10] w-full overflow-hidden rounded-xl border border-violet-400/30 bg-black/80">
                    <Image
                      src="/images/artists/artist-5-2026-day1.webp"
                      alt="Asees Kaur live headline performance at CGC Saviskar 2026 Star Night"
                      fill
                      sizes="(max-width: 768px) 100vw, 50vw"
                      className="object-cover object-top transition-transform duration-700 group-hover:scale-105"
                      priority
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/25 to-transparent" />
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_60%,rgba(0,0,0,0.5)_100%)]" />

                    {/* Corner Reticles */}
                    <div className="pointer-events-none absolute left-2 top-2 h-2.5 w-2.5 border-l border-t border-violet-400" />
                    <div className="pointer-events-none absolute right-2 top-2 h-2.5 w-2.5 border-r border-t border-violet-400" />
                    <div className="pointer-events-none absolute bottom-2 left-2 h-2.5 w-2.5 border-b border-l border-violet-400" />
                    <div className="pointer-events-none absolute bottom-2 right-2 h-2.5 w-2.5 border-b border-r border-violet-400" />

                    <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full border border-violet-400/50 bg-black/80 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-violet-200 backdrop-blur-md">
                      <Sparkles size={11} className="text-violet-400" />
                      <span>LIVE IN CONCERT • 28 OCT 2026</span>
                    </div>
                  </div>

                  <h4 className="mt-5 text-2xl font-bold tracking-tight text-white md:text-3xl">
                    ASEES KAUR
                  </h4>
                  <p className="mt-1 text-xs uppercase tracking-wider text-violet-300 font-mono">
                    [GENRE: BOLLYWOOD_PLAYBACK // ROMANTIC_POP_SOUL]
                  </p>

                  <div className="mt-6 space-y-3 font-mono text-xs text-white/70">
                    <div className="flex items-start gap-2">
                      <Sparkles size={14} className="mt-0.5 text-violet-400 shrink-0" />
                      <span>Award-winning playback powerhouse behind chartbusters: &ldquo;Raataan Lambiyan&rdquo;, &ldquo;Makhna&rdquo;, &ldquo;Bolna&rdquo;, and &ldquo;Ve Maahi&rdquo;.</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Music size={14} className="mt-0.5 text-violet-400 shrink-0" />
                      <span>Commanding 35,000+ collegiate voices in a sea of flashlight beams and soulful chorus on Day 01.</span>
                    </div>
                  </div>

                  <div className="mt-8 border border-white/15 bg-black/60 p-4 font-mono">
                    <span className="text-[10px] uppercase text-white/40">
                      {"// OFFICIAL STATUS"}
                    </span>
                    <p className="mt-1 text-xs text-emerald-400">
                      CONFIRMED HEADLINER • LIVE ON STAGE 28 OCTOBER 2026
                    </p>
                  </div>
                </div>

                {/* Day 2 Card: Ranjit Bawa */}
                <div
                  className="group relative overflow-hidden border border-cyan-400/40 bg-gradient-to-b from-white/[0.08] to-black/85 p-6 backdrop-blur-xl transition-all duration-500 hover:border-cyan-400/70 hover:shadow-[0_0_50px_rgba(6,182,212,0.3)] md:p-8"
                  style={{
                    clipPath:
                      "polygon(0 18px, 18px 0, calc(100% - 18px) 0, 100% 18px, 100% calc(100% - 18px), calc(100% - 18px) 100%, 18px 100%, 0 calc(100% - 18px))",
                  }}
                >
                  <div className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 border-l-2 border-t-2 border-cyan-400" />
                  <div className="pointer-events-none absolute right-2 top-2 h-3.5 w-3.5 border-r-2 border-t-2 border-cyan-400" />
                  <div className="pointer-events-none absolute bottom-2 left-2 h-3.5 w-3.5 border-b-2 border-l-2 border-cyan-400" />
                  <div className="pointer-events-none absolute bottom-2 right-2 h-3.5 w-3.5 border-b-2 border-r-2 border-cyan-400" />

                  {/* Top Badge & Confirmed Status */}
                  <div className="flex items-center justify-between">
                    <span className="border border-cyan-400/40 bg-cyan-500/20 px-3.5 py-1 font-mono text-xs font-semibold text-cyan-200">
                      [DAY 02 // GRAND FINALE]
                    </span>
                    <span className="flex items-center gap-1.5 font-mono text-[11px] text-emerald-400">
                      <CheckCircle2 size={12} />
                      TRANSMISSION CONFIRMED
                    </span>
                  </div>

                  {/* Artist Photo Spotlight */}
                  <div className="relative mt-5 aspect-[16/10] w-full overflow-hidden rounded-xl border border-cyan-400/30 bg-black/80">
                    <Image
                      src="/images/artists/artist-6-2026-day2.webp"
                      alt="Ranjit Bawa Grand Finale live performance at CGC Saviskar 2026 Star Night"
                      fill
                      sizes="(max-width: 768px) 100vw, 50vw"
                      className="object-cover object-center transition-transform duration-700 group-hover:scale-105"
                      priority
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/25 to-transparent" />
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_60%,rgba(0,0,0,0.5)_100%)]" />

                    {/* Corner Reticles */}
                    <div className="pointer-events-none absolute left-2 top-2 h-2.5 w-2.5 border-l border-t border-cyan-400" />
                    <div className="pointer-events-none absolute right-2 top-2 h-2.5 w-2.5 border-r border-t border-cyan-400" />
                    <div className="pointer-events-none absolute bottom-2 left-2 h-2.5 w-2.5 border-b border-l border-cyan-400" />
                    <div className="pointer-events-none absolute bottom-2 right-2 h-2.5 w-2.5 border-b border-r border-cyan-400" />

                    <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full border border-cyan-400/50 bg-black/80 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-cyan-200 backdrop-blur-md">
                      <Sparkles size={11} className="text-cyan-400" />
                      <span>GRAND FINALE • 29 OCT 2026</span>
                    </div>
                  </div>

                  <h4 className="mt-5 text-2xl font-bold tracking-tight text-white md:text-3xl">
                    RANJIT BAWA
                  </h4>
                  <p className="mt-1 text-xs uppercase tracking-wider text-cyan-300 font-mono">
                    [GENRE: PUNJABI_FOLK // BHANGRA_ANTHEMS]
                  </p>

                  <div className="mt-6 space-y-3 font-mono text-xs text-white/70">
                    <div className="flex items-start gap-2">
                      <Sparkles size={14} className="mt-0.5 text-cyan-400 shrink-0" />
                      <span>The iconic voice of Punjabi folk &amp; Bhangra: &ldquo;Yaari Chandigarh Waliye&rdquo;, &ldquo;Jatt Di Akal&rdquo;, &ldquo;Sher Marna&rdquo;, and &ldquo;Tareek&rdquo;.</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Music size={14} className="mt-0.5 text-cyan-400 shrink-0" />
                      <span>High-octane stadium energy backed by raw live dhol, earth-quaking bass, and massive festival euphoria.</span>
                    </div>
                  </div>

                  <div className="mt-8 border border-white/15 bg-black/60 p-4 font-mono">
                    <span className="text-[10px] uppercase text-white/40">
                      {"// OFFICIAL STATUS"}
                    </span>
                    <p className="mt-1 text-xs text-emerald-400">
                      CONFIRMED HEADLINER • GRAND FINALE 29 OCTOBER 2026
                    </p>
                  </div>
                </div>
              </div>

              {/* Star Night Celebration & Passes Banner (Replaces Guess Form) */}
              <div
                className="relative mt-12 overflow-hidden border border-violet-400/30 bg-gradient-to-r from-violet-950/40 via-black/85 to-indigo-950/40 p-8 text-center backdrop-blur-xl md:p-10 shadow-[0_20px_60px_rgba(0,0,0,0.8)]"
                style={{
                  clipPath:
                    "polygon(0 20px, 20px 0, calc(100% - 20px) 0, 100% 20px, 100% calc(100% - 20px), calc(100% - 20px) 100%, 20px 100%, 0 calc(100% - 20px))",
                }}
              >
                <div className="pointer-events-none absolute left-2 top-2 h-4 w-4 border-l-2 border-t-2 border-violet-400" />
                <div className="pointer-events-none absolute right-2 top-2 h-4 w-4 border-r-2 border-t-2 border-violet-400" />
                <div className="pointer-events-none absolute bottom-2 left-2 h-4 w-4 border-b-2 border-l-2 border-violet-400" />
                <div className="pointer-events-none absolute bottom-2 right-2 h-4 w-4 border-b-2 border-r-2 border-violet-400" />

                <span className="font-mono text-xs uppercase tracking-[0.3em] text-violet-300">
                  [SYS.TRANSMISSION // ALL HEADLINERS DECRYPTED]
                </span>
                <h4 className="mt-2 text-2xl font-bold uppercase tracking-tight text-white md:text-3xl">
                  Ready For The Biggest Concert of 2026?
                </h4>
                <p className="mx-auto mt-2 max-w-xl font-mono text-xs text-white/60 sm:text-sm">
                  &gt; 35,000+ collegiate voices singing as one. Ground-shaking bass and stadium pyrotechnics across 2 monumental headline nights.
                </p>

                <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                  {/* Theme Confetti Trigger */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowConfetti(false);
                      setTimeout(() => setShowConfetti(true), 50);
                    }}
                    className="inline-flex items-center gap-2.5 rounded-full border border-violet-400/60 bg-violet-600/30 px-7 py-3.5 font-mono text-xs font-semibold uppercase tracking-wider text-violet-200 transition-all hover:bg-violet-600/50 hover:shadow-[0_0_35px_rgba(168,85,247,0.45)] hover:scale-105 active:scale-95"
                  >
                    <Sparkles size={15} className="text-amber-300 animate-spin" />
                    <span>Celebrate with Stadium Confetti</span>
                  </button>

                  {/* Register link */}
                  <Link
                    href="/register"
                    className="inline-flex items-center gap-2.5 rounded-full border border-white/20 bg-white/10 px-7 py-3.5 font-mono text-xs font-semibold uppercase tracking-wider text-white transition-all hover:bg-white/20 hover:scale-105 active:scale-95"
                  >
                    <span>Get Passes</span>
                    <ArrowRight size={14} />
                  </Link>
                </div>

                <div className="mt-6 flex flex-wrap items-center justify-center gap-6 font-mono text-xs text-white/40">
                  <span>★ 35,000+ Attendees</span>
                  <span>•</span>
                  <span>CGC Mainstage Concert Arena</span>
                  <span>•</span>
                  <span>28–29 October 2026</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}