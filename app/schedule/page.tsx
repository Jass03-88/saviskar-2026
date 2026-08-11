"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUpRight, CalendarDays } from "lucide-react";
import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { supabase } from "@/lib/supabase";
import ScheduleTimeline from "@/components/schedule/ScheduleTimeline";

type Event = {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
  event_date: string | null;
  start_time: string | null;
  venue: string | null;
  active: boolean;
  registration_open: boolean;
};

export default function SchedulePage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSchedule() {
      const { data } = await supabase
        .from("events")
        .select(
          "id, slug, name, category, description, event_date, start_time, venue, active, registration_open"
        )
        .eq("active", true)
        .order("event_date", { ascending: true })
        .order("start_time", { ascending: true });

      setEvents((data ?? []) as Event[]);
      setLoading(false);
    }

    loadSchedule();
  }, []);

  const dayCount = useMemo(
    () =>
      new Set(
        events
          .map((event) => event.event_date)
          .filter(Boolean)
      ).size,
    [events]
  );

  const heroRef = useRef<HTMLElement | null>(null);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, {
    stiffness: 90,
    damping: 25,
  });
  const heroY = useTransform(progress, [0, 0.18], [0, -80]);

  return (
    <main className="min-h-screen overflow-hidden bg-[#f5f2eb] text-black">
      <motion.div
        style={{ scaleX: progress }}
        className="fixed left-0 right-0 top-0 z-[100] h-[2px] origin-left bg-black"
      />

      {/* React Bits-style animated background layer + Motion parallax */}
      <section
        ref={heroRef}
        className="relative flex min-h-[88vh] items-end overflow-hidden bg-black text-white"
      >
        <motion.div
          style={{ y: heroY }}
          className="pointer-events-none absolute inset-0"
        >
          <div className="absolute left-[10%] top-[18%] h-[42vw] w-[42vw] rounded-full bg-violet-600/20 blur-[150px]" />
          <div className="absolute right-[2%] top-[8%] h-[38vw] w-[38vw] rounded-full bg-fuchsia-600/15 blur-[150px]" />

          {/* React Bits-inspired animated dot field */}
          <motion.div
            animate={{ backgroundPosition: ["0px 0px", "80px 40px"] }}
            transition={{ duration: 16, repeat: Infinity, ease: "linear" }}
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "radial-gradient(circle, rgba(255,255,255,0.22) 1px, transparent 1px)",
              backgroundSize: "34px 34px",
            }}
          />

          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_45%,transparent_0%,rgba(0,0,0,0.28)_45%,#000_90%)]" />
        </motion.div>

        <div className="relative z-10 mx-auto w-full max-w-[1600px] px-6 pb-16 pt-40 md:px-10 md:pb-24 lg:px-14">
          <div className="flex items-end justify-between gap-8">
            <div>
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7 }}
                className="mb-7 text-[10px] uppercase tracking-[0.5em] text-white/45"
              >
                SAVISKAR 2026 / SCHEDULE
              </motion.p>

              <motion.h1
                initial={{ opacity: 0, y: 40, filter: "blur(14px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
                className="max-w-[1000px] font-serif text-[clamp(4.5rem,11vw,11rem)] leading-[0.78] tracking-[-0.07em]"
              >
                THE TWO
                <br />
                DAYS.
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35, duration: 0.8 }}
                className="mt-10 max-w-xl text-base leading-7 text-white/50 md:text-lg"
              >
                Everything between the first arrival and the final applause.
                Follow the journey through every competition, performance and
                moment that makes Saviskar.
              </motion.p>
            </div>

            <motion.div
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.6, duration: 0.8, type: "spring" }}
              className="hidden shrink-0 md:block"
            >
              <ArrowDown className="animate-bounce text-white/30" size={28} />
            </motion.div>
          </div>
        </div>
      </section>

      <section className="relative px-6 py-24 md:px-10 md:py-32 lg:px-14">
        <div className="mx-auto max-w-[1350px]">
          <div className="mb-20 grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <p className="text-[9px] uppercase tracking-[0.35em] text-black/35">
                FOLLOW THE TIMELINE
              </p>
              <h2 className="mt-5 max-w-3xl font-serif text-[clamp(3rem,6vw,6.5rem)] leading-[0.84] tracking-[-0.06em]">
                WHEN IT
                <br />
                HAPPENS.
              </h2>
            </div>

            <div className="flex items-center gap-8 border-t border-black/10 pt-5 md:border-t-0 md:border-l md:pl-8">
              <div>
                <p className="font-serif text-4xl">{events.length}</p>
                <p className="mt-1 text-[8px] uppercase tracking-[0.25em] text-black/35">
                  EVENTS
                </p>
              </div>
              <div>
                <p className="font-serif text-4xl">{dayCount || "—"}</p>
                <p className="mt-1 text-[8px] uppercase tracking-[0.25em] text-black/35">
                  DAYS
                </p>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="space-y-6">
              {[1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="h-44 animate-pulse rounded-[28px] bg-black/[0.05]"
                />
              ))}
            </div>
          ) : (
            <ScheduleTimeline events={events} />
          )}
        </div>
      </section>

      <section className="relative overflow-hidden bg-black px-6 py-32 text-white md:px-10 lg:px-14">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1 }}
          className="absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-600/20 blur-[150px]"
        />

        <div className="relative z-10 mx-auto max-w-[1200px] text-center">
          <p className="text-[9px] uppercase tracking-[0.4em] text-white/35">
            SAVISKAR 2026
          </p>
          <h2 className="mt-6 font-serif text-[clamp(4rem,10vw,10rem)] leading-[0.78] tracking-[-0.07em]">
            SEE YOU
            <br />
            THERE.
          </h2>

          <div className="mt-12 flex flex-wrap justify-center gap-3">
            <Link
              href="/register"
              className="group flex items-center gap-2 rounded-full bg-white px-7 py-4 text-sm font-medium text-black transition-transform hover:scale-[1.03]"
            >
              Register for Saviskar
              <ArrowUpRight
                size={16}
                className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </Link>

            <Link
              href="/"
              className="rounded-full border border-white/15 px-7 py-4 text-sm text-white/65 transition hover:border-white/35 hover:text-white"
            >
              Back to home
            </Link>
          </div>
        </div>
      </section>

      <div className="flex items-center justify-center border-t border-black/10 bg-[#f5f2eb] px-6 py-8">
        <div className="flex items-center gap-2 text-[8px] uppercase tracking-[0.3em] text-black/25">
          <CalendarDays size={12} />
          Schedule updates automatically from the live event list
        </div>
      </div>
    </main>
  );
}
