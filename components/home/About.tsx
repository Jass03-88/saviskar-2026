"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "motion/react";
import { Sparkles, Trophy, Building2, Calendar, Infinity as InfinityIcon } from "lucide-react";

function Counter({
  target,
  suffix = "",
  duration = 1500,
}: {
  target: number;
  suffix?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: false, amount: 0.3 });
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!inView) {
      const resetFrame = requestAnimationFrame(() => {
        setCount(0);
      });
      return () => cancelAnimationFrame(resetFrame);
    }

    let startTime: number | null = null;
    let frame: number;

    const animate = (time: number) => {
      if (!startTime) startTime = time;
      const progress = Math.min((time - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * target));

      if (progress < 1) {
        frame = requestAnimationFrame(animate);
      } else {
        setCount(target);
      }
    };

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [inView, target, duration]);

  return (
    <span ref={ref}>
      {count}
      {suffix}
    </span>
  );
}

const EVENT_START = new Date("2026-10-28T00:00:00+05:30").getTime();

function Countdown() {
  const [timeLeft, setTimeLeft] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });

  useEffect(() => {
    const updateCountdown = () => {
      const difference = Math.max(EVENT_START - Date.now(), 0);
      setTimeLeft({
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((difference / (1000 * 60)) % 60),
        seconds: Math.floor((difference / 1000) % 60),
      });
    };

    updateCountdown();
    const interval = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const units = [
    { value: timeLeft.days, label: "Days" },
    { value: timeLeft.hours, label: "Hours" },
    { value: timeLeft.minutes, label: "Minutes" },
    { value: timeLeft.seconds, label: "Seconds" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: false, amount: 0.2 }}
      transition={{ duration: 0.8 }}
      className="liquid-glass-card relative overflow-hidden rounded-[28px] border border-white/15 bg-black/65 backdrop-blur-2xl p-7 md:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.7)]"
    >
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full bg-violet-400 animate-pulse shadow-[0_0_8px_#c084fc]" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/80">
            The Countdown
          </span>
        </div>
        <span className="font-mono text-xs font-medium text-violet-300">OCTOBER 28–29, 2026</span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {units.map((unit) => (
          <motion.div
            key={unit.label}
            whileHover={{ scale: 1.04, y: -3, borderColor: "rgba(168,85,247,0.5)" }}
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.2 }}
            className="rounded-2xl border border-white/10 bg-black/40 p-4 text-center transition-colors"
          >
            <div className="font-mono text-3xl font-bold tracking-tight text-white md:text-4xl drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
              {String(unit.value).padStart(2, "0")}
            </div>
            <div className="mt-2 text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-300">
              {unit.label}
            </div>
          </motion.div>
        ))}
      </div>

      <p className="mt-6 text-center text-xs font-medium tracking-wider text-zinc-300 md:text-sm">
        Until stadium floodlights illuminate Saviskar 2026 at CGC University, Mohali.
      </p>
    </motion.div>
  );
}

const stats = [
  {
    type: "counter",
    target: 50,
    suffix: "+",
    label: "Competitive Realms",
    desc: "Across tech, culture, non-tech & exhibitions",
    icon: Trophy,
  },
  {
    type: "counter",
    target: 500,
    suffix: "+",
    label: "Colleges & Universities",
    desc: "From premier institutions nationwide",
    icon: Building2,
  },
  {
    type: "counter",
    target: 2,
    suffix: "",
    label: "Action-Packed Days",
    desc: "48 hours of non-stop realm battles",
    icon: Calendar,
  },
  {
    type: "counter",
    target: 35000,
    suffix: "+",
    label: "Attending Participants",
    desc: "Where creators and champions unite",
    icon: InfinityIcon,
  },
];

export default function About() {
  return (
    <section
      id="about"
      className="relative overflow-hidden bg-transparent px-4 py-16 sm:px-6 sm:py-24 md:px-10 md:py-36 text-white"
    >
      {/* Subtle stage haze accent in background */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-600/10 blur-[160px]" />

      <div className="relative z-10 mx-auto max-w-[1350px]">
        {/* Section Pill */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: false, amount: 0.2 }}
          transition={{ duration: 0.6 }}
          className="liquid-glass mb-6 sm:mb-8 inline-flex items-center gap-2 rounded-full px-3.5 py-1 sm:px-4 sm:py-1.5 text-[9px] sm:text-[10px] font-semibold uppercase tracking-[0.25em] sm:tracking-[0.3em] text-violet-300"
        >
          <Sparkles size={12} />
          The Experience • Aevorian Reverie
        </motion.div>

        {/* Headings Grid */}
        <div className="grid gap-8 sm:gap-10 lg:grid-cols-2 lg:items-end md:gap-16">
          <motion.div
            initial={{ opacity: 0, y: 35 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: false, amount: 0.2 }}
            transition={{ duration: 0.8 }}
          >
            <h2 className="text-[clamp(2.4rem,7vw,6.8rem)] font-light leading-[0.95] md:leading-[0.88] tracking-tight text-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.95)]">
              Beyond an event. <br />
              <span className="font-editorial text-violet-300 font-normal">A cultural revolution.</span>
            </h2>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: false, amount: 0.2 }}
            transition={{ duration: 0.8, delay: 0.15 }}
            className="rounded-3xl border border-white/15 bg-black/65 backdrop-blur-2xl p-5 sm:p-6 md:p-8 shadow-[0_15px_40px_rgba(0,0,0,0.7)]"
          >
            <p className="text-sm leading-relaxed text-zinc-200 md:text-lg md:leading-8 font-normal">
              Ignited by <span className="font-editorial text-violet-300 not-italic font-normal">Aevorian Reverie</span> — where tomorrow dreams awake. Born from the roots of Srijan (creation) and Avishkar (invention), Saviskar&apos;s landmark 3rd edition unifies 35,000+ coders, artists, athletes, and performers across 500+ colleges nationwide onto one thunderous stage at CGC University, Mohali.
            </p>
          </motion.div>
        </div>

        {/* Live Metrics Cards Grid */}
        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4 md:mt-24">
          {stats.map((stat, index) => {
            const IconComponent = stat.icon;
            return (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 35 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: false, amount: 0.2 }}
                transition={{ duration: 0.7, delay: index * 0.1 }}
                whileHover={{ y: -6, transition: { duration: 0.2 } }}
                className="liquid-glass-card group relative overflow-hidden rounded-[26px] border border-white/15 bg-black/65 backdrop-blur-2xl p-6 sm:p-8 transition-all hover:border-violet-500/40 hover:bg-black/80 hover:shadow-[0_20px_50px_rgba(168,85,247,0.2)]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-violet-300 transition-colors group-hover:bg-violet-500/20">
                    <IconComponent size={20} />
                  </div>
                  <span className="font-mono text-xs font-semibold text-white/50">0{index + 1}</span>
                </div>

                <div className="mt-6 sm:mt-8">
                  {stat.type === "counter" ? (
                    <div className="font-sans text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">
                      <Counter target={stat.target!} suffix={stat.suffix} />
                    </div>
                  ) : (
                    <div className="font-sans text-4xl font-bold tracking-tight text-violet-300 sm:text-5xl md:text-6xl drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">
                      ∞
                    </div>
                  )}

                  <h3 className="mt-3 sm:mt-4 text-base font-semibold text-white">
                    {stat.label}
                  </h3>
                  <p className="mt-1.5 text-xs text-zinc-300 font-medium leading-relaxed">
                    {stat.desc}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Countdown & Final Stage Statement */}
        <div className="mt-14 grid gap-8 sm:gap-10 lg:grid-cols-2 lg:items-center md:mt-24">
          <Countdown />

          <motion.div
            initial={{ opacity: 0, x: 25 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: false, amount: 0.2 }}
            transition={{ duration: 0.8 }}
            className="liquid-glass-card relative flex flex-col justify-center overflow-hidden rounded-[28px] border border-white/15 bg-black/65 backdrop-blur-2xl p-6 sm:p-8 md:p-12 shadow-[0_20px_50px_rgba(0,0,0,0.7)]"
          >
            <div className="inline-flex items-center gap-2 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.25em] sm:tracking-[0.3em] text-violet-300">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
              The Landmark 3rd Edition
            </div>
            <h3 className="mt-3 sm:mt-4 text-2xl sm:text-3xl font-light leading-tight text-white md:text-4xl drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">
              Two days. <br />
              Fifty realms. <br />
              <span className="font-editorial text-violet-300 font-normal">One dreamscape.</span>
            </h3>
            <p className="mt-3 sm:mt-4 text-sm leading-relaxed text-zinc-200 md:text-base font-normal">
              CGC University, Mohali sets the gold standard for India&apos;s biggest student battleground.
              Step into the realms, claim the spotlight, and turn adrenaline into legacy.
            </p>
          </motion.div>
        </div>
      </div>

      {/* Subtle depth haze blend into Gallery Glimpse */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-b from-transparent to-black/20" />
    </section>
  );
}