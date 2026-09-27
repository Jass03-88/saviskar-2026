"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  Compass,
  Clock,
  Sparkles,
  ArrowUpRight,
} from "lucide-react";
import { motion, useScroll, useSpring } from "motion/react";
import { supabase } from "@/lib/supabase";
import Navbar from "@/components/ui/Navbar";
import ScheduleTimeline from "@/components/schedule/ScheduleTimeline";
import ThomsoReplicaMap from "@/components/schedule/ThomsoReplicaMap";
import {
  CAMPUS_VENUES,
  FESTIVAL_SCHEDULE,
  ScheduleEvent,
  mapDbEventToScheduleEvent,
  resolveVenueId,
} from "@/data/scheduleData";

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
  const [viewMode, setViewMode] = useState<"map" | "timeline">("map");

  // Check URL query on mount for direct timeline link
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("view") === "timeline") {
        setViewMode("timeline");
      }
    }
  }, []);

  useEffect(() => {
    async function loadSchedule() {
      try {
        const { data, error } = await supabase
          .from("events")
          .select(
            "id, slug, name, category, description, event_date, start_time, venue, active, registration_open"
          )
          .eq("active", true)
          .order("event_date", { ascending: true })
          .order("start_time", { ascending: true });

        if (error || !data || data.length === 0) {
          const mappedFallback: Event[] = FESTIVAL_SCHEDULE.map((s) => ({
            id: s.id,
            slug: s.slug,
            name: s.name,
            category: s.category,
            description: s.description,
            event_date: s.date,
            start_time: s.startTime,
            venue: s.venueName,
            active: true,
            registration_open: s.registrationOpen,
          }));
          setEvents(mappedFallback);
        } else {
          // Normalize venue display for events so null/TBD venues resolve to proper pavilion names
          const enrichedEvents: Event[] = (data as Event[]).map((ev) => {
            const vId = resolveVenueId(ev.venue, ev.name, ev.category);
            const matchedVenue = CAMPUS_VENUES.find((v) => v.id === vId);
            return {
              ...ev,
              venue: ev.venue && ev.venue !== "TBD" ? ev.venue : (matchedVenue?.name || "CGC Campus"),
            };
          });
          setEvents(enrichedEvents);
        }
      } catch {
        const mappedFallback: Event[] = FESTIVAL_SCHEDULE.map((s) => ({
          id: s.id,
          slug: s.slug,
          name: s.name,
          category: s.category,
          description: s.description,
          event_date: s.date,
          start_time: s.startTime,
          venue: s.venueName,
          active: true,
          registration_open: s.registrationOpen,
        }));
        setEvents(mappedFallback);
      } finally {
        setLoading(false);
      }
    }

    loadSchedule();
  }, []);

  // Compute live mapped ScheduleEvents from backend database rows
  const mappedScheduleEvents = useMemo<ScheduleEvent[]>(() => {
    if (events.length === 0) return FESTIVAL_SCHEDULE;
    return events.map((ev) => mapDbEventToScheduleEvent(ev));
  }, [events]);

  const dayCount = useMemo(
    () =>
      new Set(
        events
          .map((event) => event.event_date)
          .filter(Boolean)
      ).size || 2,
    [events]
  );

  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, {
    stiffness: 90,
    damping: 25,
  });

  return (
    <main className="w-full min-h-screen bg-[#030306] text-white selection:bg-violet-500 selection:text-white">
      {/* Universal Site Navbar (Logo, Center Pill, Orbital Singularity Disc Trigger) */}
      <Navbar />

      {/* View Mode 1: Exact Replica Thomso Map Experience with Saviskar 2026 Liquid Glass Theme */}
      {viewMode === "map" ? (
        <div className="w-full h-screen overflow-hidden">
          <ThomsoReplicaMap
            onSwitchToTimeline={() => setViewMode("timeline")}
            externalEvents={mappedScheduleEvents}
          />
        </div>
      ) : (
        /* View Mode 2: Chronological Hour-by-Hour Timeline Matrix */
        <div className="min-h-screen overflow-x-hidden bg-[#030306] text-white pt-24">
          {/* Top progress bar */}
          <motion.div
            style={{ scaleX: progress }}
            className="fixed left-0 right-0 top-0 z-[100] h-[3px] origin-left bg-violet-400 shadow-[0_0_12px_#a855f7]"
          />

          {/* Subheader Navigation */}
          <header className="sticky top-20 z-30 mx-auto flex max-w-[1440px] items-center justify-between px-5 py-4 border-b border-white/10 bg-black/70 backdrop-blur-xl md:px-10">
            <Link
              href="/"
              className="group flex items-center gap-1.5 text-xs font-medium text-white/60 transition-colors hover:text-white"
            >
              <ArrowLeft size={14} className="transition-transform group-hover:-translate-x-0.5" />
              <span>Back to Home</span>
            </Link>

            {/* Quick Switch to Map */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setViewMode("map")}
                className="flex items-center gap-2 rounded-full border border-violet-500/40 bg-violet-500/10 px-4 py-1.5 font-mono text-xs uppercase tracking-wider text-violet-300 hover:bg-violet-500/20 hover:scale-105 transition-all shadow-[0_0_15px_rgba(168,85,247,0.25)]"
              >
                <Compass size={14} className="text-violet-400" />
                <span>Interactive Campus Map</span>
              </button>

              <Link
                href="/events"
                className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black hover:bg-violet-100 transition-all shadow-[0_0_15px_rgba(255,255,255,0.3)]"
              >
                Explore Realms
              </Link>
            </div>
          </header>

          {/* Timeline Hero Intro */}
          <section className="relative px-6 pt-12 pb-12 md:px-10 lg:px-14 border-b border-white/[0.08]">
            <div className="mx-auto max-w-[1350px]">
              <div className="grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
                <div>
                  <div className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.3em] uppercase text-violet-400 mb-3 bg-violet-500/10 border border-violet-500/30 px-3 py-1 rounded-full">
                    <Clock size={12} />
                    <span>CHRONOLOGICAL MATRIX // HOUR BY HOUR</span>
                  </div>
                  <h1 className="font-editorial text-4xl sm:text-6xl md:text-7xl font-bold text-white tracking-tight leading-[1.0]">
                    Festival Schedule<br />
                    <span className="italic font-normal bg-gradient-to-r from-violet-200 via-fuchsia-300 to-cyan-300 bg-clip-text text-transparent">
                      Chronological Matrix
                    </span>
                  </h1>
                  <p className="mt-4 text-base sm:text-lg text-zinc-400 font-light leading-relaxed max-w-2xl">
                    Browse every verified competition across the 48-hour festival runway at CGC University, Mohali. Switch back to the interactive campus map at any time.
                  </p>
                </div>

                <div className="flex items-center gap-8 border-t border-white/10 pt-5 md:border-t-0 md:border-l md:pl-8">
                  <div>
                    <p className="font-editorial text-4xl text-white font-bold">{events.length}</p>
                    <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.25em] text-zinc-400">
                      EVENTS
                    </p>
                  </div>
                  <div>
                    <p className="font-editorial text-4xl text-violet-300 font-bold">{dayCount}</p>
                    <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.25em] text-zinc-400">
                      FESTIVAL DAYS
                    </p>
                  </div>
                  <div>
                    <p className="font-editorial text-4xl text-cyan-400 font-bold">
                      {CAMPUS_VENUES.length}
                    </p>
                    <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.25em] text-zinc-400">
                      VENUES
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Timeline Events List */}
          <section className="relative px-6 py-16 md:px-10 lg:px-14">
            <div className="mx-auto max-w-[1350px]">
              {loading ? (
                <div className="space-y-6">
                  {[1, 2, 3].map((item) => (
                    <div
                      key={item}
                      className="h-44 animate-pulse rounded-[28px] bg-white/[0.04]"
                    />
                  ))}
                </div>
              ) : (
                <ScheduleTimeline events={events} />
              )}
            </div>
          </section>

          {/* Call to action & Return to Map */}
          <section className="relative overflow-hidden bg-black px-6 py-20 text-white md:px-10 lg:px-14 border-t border-white/[0.08]">
            <div className="relative z-10 mx-auto max-w-[1200px] text-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/40 bg-violet-500/10 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.3em] text-violet-300 mb-6 shadow-[0_0_15px_rgba(168,85,247,0.25)]">
                <Sparkles size={12} />
                <span>SAVISKAR 2026 // AEVORIAN REVERIE</span>
              </div>

              <h2 className="font-editorial text-4xl sm:text-6xl font-bold tracking-tight text-white leading-tight">
                Explore the Grounds in 3D
              </h2>
              <p className="mt-4 text-sm sm:text-base text-zinc-400 max-w-xl mx-auto leading-relaxed font-light">
                Switch back to our interactive aerial campus map to fly between Hackathon labs, the amphitheatre lawn, and Star Night stadium grounds.
              </p>

              <div className="mt-8 flex flex-wrap justify-center gap-4">
                <button
                  onClick={() => setViewMode("map")}
                  className="flex items-center gap-2 rounded-full bg-violet-500 px-8 py-3.5 text-sm font-semibold text-white transition-all hover:bg-violet-400 hover:scale-105 shadow-[0_0_25px_rgba(168,85,247,0.4)]"
                >
                  <Compass size={16} />
                  <span>Launch Interactive Campus Map</span>
                </button>

                <Link
                  href="/register"
                  className="group flex items-center gap-2 rounded-full border border-white/20 bg-white/[0.04] px-8 py-3.5 text-sm text-white/80 transition-all hover:border-white/40 hover:text-white"
                >
                  <span>Get Digital Pass</span>
                  <ArrowUpRight size={15} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </Link>
              </div>
            </div>
          </section>

          {/* Footer bar */}
          <div className="flex items-center justify-center border-t border-white/[0.06] bg-zinc-950 px-6 py-6">
            <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.25em] text-zinc-500">
              <CalendarDays size={12} className="text-violet-400" />
              <span>CGC University, Mohali &bull; 28–29 October 2026 &bull; Official Spatial Schedule</span>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
