"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "motion/react";

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
  const inView = useInView(ref, { once: true, amount: 0.7 });
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!inView) return;

    let startTime: number | null = null;
    let frame: number;

    const animate = (time: number) => {
      if (!startTime) startTime = time;

      const progress = Math.min((time - startTime) / duration, 1);

      // Smooth ease-out
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


const EVENT_START = new Date("2026-10-24T00:00:00+05:30").getTime();

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
      viewport={{ once: true, amount: 0.5 }}
      transition={{
        duration: 0.9,
        ease: [0.22, 1, 0.36, 1],
      }}
      className="max-w-[650px]"
    >
      <div className="mb-8 flex items-center gap-3">
        <span className="h-[5px] w-[5px] rounded-full bg-black" />
        <span className="text-[10px] uppercase tracking-[0.28em] text-black/45">
          The countdown
        </span>
      </div>

      <div className="grid grid-cols-2 border-t border-black/10 sm:grid-cols-4">
        {units.map((unit, index) => (
          <motion.div
            key={unit.label}
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{
              duration: 0.6,
              delay: index * 0.08,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="border-b border-black/10 py-7 sm:border-b-0 sm:border-r sm:px-5 sm:first:pl-0 sm:last:border-r-0"
          >
            <div className="font-serif text-5xl font-semibold leading-none tracking-[-0.065em] md:text-6xl">
              {String(unit.value).padStart(2, "0")}
            </div>

            <div className="mt-4 flex items-center gap-2">
              <span className="h-[4px] w-[4px] rounded-full bg-black" />
              <span className="text-[10px] uppercase tracking-[0.18em] text-black/40">
                {unit.label}
              </span>
            </div>
          </motion.div>
        ))}
      </div>

      <p className="mt-7 font-serif text-lg tracking-[-0.02em] text-black/45 md:text-xl">
        Until Saviskar 2026 begins.
      </p>
    </motion.div>
  );
}

const stats = [
  {
    type: "counter",
    target: 50,
    suffix: "+",
    label: "Events",
  },
  {
    type: "counter",
    target: 100,
    suffix: "+",
    label: "Colleges",
  },
  {
    type: "counter",
    target: 2,
    suffix: "",
    label: "Days",
  },
  {
    type: "infinity",
    label: "Possibilities",
  },
];

export default function About() {
  const sectionRef = useRef<HTMLElement>(null);

  const statsInView = useInView(sectionRef, {
    once: true,
    amount: 0.35,
  });

  return (
    <section
      ref={sectionRef}
      id="about"
      className="relative overflow-hidden bg-[#f5f5f7] text-black"
    >
      <div className="mx-auto max-w-[1200px] px-6 py-28 md:px-8 md:py-36 lg:py-44">

        {/* SECTION LABEL */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.8 }}
          transition={{
            duration: 0.7,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="mb-10 text-[10px] uppercase tracking-[0.28em] text-black/45"
        >
          About Saviskar
        </motion.div>

        {/* MAIN CONTENT */}
        <div className="grid gap-14 md:grid-cols-2 md:gap-20">

          {/* LEFT HEADING */}
          <motion.div
            initial={{ opacity: 0, y: 45 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{
              duration: 0.9,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <h2 className="max-w-[620px] font-serif text-[clamp(4rem,7vw,7.5rem)] font-semibold leading-[0.84] tracking-[-0.065em]">
              <span className="block">More than</span>

              <motion.span
                initial={{ opacity: 0, y: 35 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{
                  duration: 0.9,
                  delay: 0.12,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="block"
              >
                a college fest.
              </motion.span>
            </h2>
          </motion.div>

          {/* RIGHT DESCRIPTION */}
          <motion.div
            initial={{ opacity: 0, x: 35 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{
              duration: 0.9,
              delay: 0.2,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="flex items-end md:pb-2"
          >
            <p className="max-w-[520px] font-serif text-xl leading-[1.45] tracking-[-0.025em] text-black/50 md:text-2xl">
              Saviskar brings technology, culture, creativity and competition
              together in one unforgettable experience — creating a stage for
              ideas, talent and people to collide.
            </p>
          </motion.div>
        </div>

        {/* ANIMATED DIVIDER */}
        <motion.div
          initial={{ scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true, amount: 0.8 }}
          transition={{
            duration: 1.2,
            delay: 0.15,
            ease: [0.22, 1, 0.36, 1],
          }}
          style={{ transformOrigin: "left" }}
          className="mt-24 h-px w-full bg-black/10 md:mt-32"
        />

        {/* STATS */}
        <div className="grid grid-cols-2 md:grid-cols-4">
          {stats.map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{
                opacity: 0,
                y: 35,
              }}
              animate={
                statsInView
                  ? {
                      opacity: 1,
                      y: 0,
                    }
                  : {}
              }
              transition={{
                duration: 0.75,
                delay: index * 0.1,
                ease: [0.22, 1, 0.36, 1],
              }}
              whileHover={{
                y: -7,
              }}
              className="
                group
                border-b border-black/10
                py-10
                md:border-b-0
                md:py-14
              "
            >
              {/* NUMBER */}
              <div className="overflow-hidden">
                {stat.type === "counter" ? (
                  <div className="font-serif text-6xl font-semibold leading-none tracking-[-0.065em] md:text-7xl">
                    <Counter
                      target={stat.target!}
                      suffix={stat.suffix}
                      duration={
                        stat.target === 2
                          ? 900
                          : stat.target === 50
                            ? 1400
                            : 1700
                      }
                    />
                  </div>
                ) : (
                  <motion.div
                    initial={{
                      opacity: 0,
                      scale: 0.5,
                      rotate: -15,
                    }}
                    animate={
                      statsInView
                        ? {
                            opacity: 1,
                            scale: 1,
                            rotate: 0,
                          }
                        : {}
                    }
                    transition={{
                      duration: 0.9,
                      delay: 0.35,
                      type: "spring",
                      stiffness: 100,
                    }}
                    className="font-serif text-6xl leading-none tracking-[-0.06em] md:text-7xl"
                  >
                    ∞
                  </motion.div>
                )}
              </div>

              {/* LABEL */}
              <div className="mt-6 flex items-center gap-2">
                <motion.span
                  className="h-[5px] w-[5px] rounded-full bg-black"
                  initial={{ scale: 0 }}
                  animate={
                    statsInView
                      ? {
                          scale: 1,
                        }
                      : {}
                  }
                  transition={{
                    delay: 0.45 + index * 0.08,
                  }}
                />

                <span className="text-xs tracking-[-0.01em] text-black/45 transition-colors duration-300 group-hover:text-black">
                  {stat.label}
                </span>
              </div>
            </motion.div>
          ))}
        </div>

        {/* COUNTDOWN + BOTTOM STATEMENT */}
        <div className="mt-24 grid gap-16 md:mt-32 md:grid-cols-2 md:items-end md:gap-20">
          <Countdown />

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.7 }}
            transition={{
              duration: 0.9,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="flex justify-start md:justify-end"
          >
            <p className="max-w-[500px] font-serif text-2xl leading-[1.25] tracking-[-0.04em] md:text-4xl">
              Two days.
              <br />
              Hundreds of moments.
              <br />
              <span className="text-black/35">
                One stage.
              </span>
            </p>
          </motion.div>
        </div>

      </div>
    </section>
  );
}