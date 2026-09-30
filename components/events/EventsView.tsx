"use client";

import React, { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowUpRight,
  FileDown,
  Sparkles,
  Bot,
  Flame,
  Palette,
  Cpu,
  Search,
  Trophy,
  ShieldCheck,
  CheckCircle2,
  X,
  Compass,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import Navbar from "@/components/ui/Navbar";

export interface EventItem {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
  event_date: string | null;
  start_time: string | null;
  venue: string | null;
  active: boolean;
  registration_open?: boolean;
}

export interface Realm {
  id: string;
  slug: string;
  number: string;
  badge: string;
  title: string;
  tagline: string;
  description: string;
  image: string;
  rulebookUrl: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accentColor: string;
  accentBorder: string;
  accentGlow: string;
  prizePool: string;
  highlightChips?: string[];
}

export const REALMS_DATA: Realm[] = [
  {
    id: "technical",
    slug: "technical",
    number: "REALM 01",
    badge: "COMPUTATION & HARDWARE",
    title: "Technical",
    tagline: "Build. Invent. Compete.",
    description:
      "Where algorithmic brilliance clashes with high-torque combat robotics and mechanical adrenaline. Compete inside illuminated battle arenas and hackathons engineered for builders, hackers, and cybernetic innovators.",
    image: "/images/realm-technical-v2.webp",
    rulebookUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf",
    icon: Cpu,
    accentColor: "text-cyan-400",
    accentBorder: "hover:border-cyan-500/50",
    accentGlow: "rgba(6,182,212,0.25)",
    prizePool: "₹3,50,000",
  },
  {
    id: "non-technical",
    slug: "non-technical",
    number: "REALM 02",
    badge: "STRATEGY & CREATIVE EXPRESSION",
    title: "Non-Technical",
    tagline: "Create. Think. Express.",
    description:
      "High-stakes mock stock trading floors, intense parliamentary debate chambers, live graffiti mural battles, digital cinema filmmaking, and unfiltered creative visual storytelling beyond the classroom.",
    image: "/images/realm-nontech-v2.webp",
    rulebookUrl: "/rulebooks/saviskar-2026-non-technical-rulebook.pdf",
    icon: Palette,
    accentColor: "text-amber-400",
    accentBorder: "hover:border-amber-500/50",
    accentGlow: "rgba(245,158,11,0.25)",
    prizePool: "₹2,50,000",
  },
  {
    id: "cultural",
    slug: "cultural",
    number: "REALM 03",
    badge: "PERFORMANCE & MAINSTAGE",
    title: "Cultural",
    tagline: "Dance. Music. Performance.",
    description:
      "Thunderous stadium sound rigs, blazing pyrotechnic fountains, battle of the bands rock face-offs, synchronized Western & traditional crew choreography, and solo vocal showdowns rocking the central Saviskar amphitheater.",
    image: "/images/realm-cultural-v2.webp",
    rulebookUrl: "/rulebooks/saviskar-2026-cultural-rulebook.pdf",
    icon: Flame,
    accentColor: "text-fuchsia-400",
    accentBorder: "hover:border-fuchsia-500/50",
    accentGlow: "rgba(217,70,239,0.25)",
    prizePool: "₹4,00,000",
  },
  {
    id: "aivishkar",
    slug: "aivishkar",
    number: "REALM 04",
    badge: "FEATURED FLAGSHIP EXPOSITION // NEURAL FRONTIER",
    title: "AIvishkar: An AI Tech Expo",
    tagline: "Autonomous. Neural. Beyond Human Frontier.",
    description:
      "North India's flagship Collegiate Artificial Intelligence Exposition. Witness autonomous humanoid robotics live demos, state-of-the-art generative agent showcases, neural computer vision labs, and student-founder venture pitches evaluated by premier technology venture capitalists.",
    image: "/images/realm-aivishkar-ai.webp",
    rulebookUrl: "/rulebooks/saviskar-2026-aivishkar-rulebook.pdf",
    icon: Bot,
    accentColor: "text-violet-400",
    accentBorder: "hover:border-violet-500/60",
    accentGlow: "rgba(168,85,247,0.35)",
    prizePool: "₹5,00,000+ in Grants",
    highlightChips: [
      "Autonomous Humanoid Robotics Arena",
      "Generative AI & LLM Agent Showcase",
      "Computer Vision & Neural Hardware",
      "AI Startup Pitch Deck & VC Grants",
    ],
  },
];

export const METRICS = [
  { label: "PREMIER REALMS", value: "04", subtitle: "Technical, Non-Tech, Cultural, AIvishkar" },
  { label: "COMPETITIONS", value: "50+", subtitle: "Certified Inter-University Events" },
  { label: "PRIZE POOL", value: "₹10L+", subtitle: "Cash Rewards, Trophies & AI Grants" },
  { label: "COLLEGES", value: "500+", subtitle: "Universities Across All India" },
];

export function matchesRealm(eventCategory: string | null | undefined, realmId: string): boolean {
  if (!eventCategory) return false;
  const cat = eventCategory.trim().toLowerCase();
  if (realmId === "aivishkar") {
    return cat === "aivishkar" || cat === "avishkar";
  }
  return cat === realmId.toLowerCase();
}

export function matchesSearch(event: EventItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    event.name,
    event.description,
    event.venue,
  ].some((field) => Boolean(field && field.toLowerCase().includes(q)));
}

export function sortEvents(events: EventItem[]): EventItem[] {
  return [...events].sort((a, b) => {
    const dateA = a.event_date || "";
    const dateB = b.event_date || "";
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    return (a.name || "").localeCompare(b.name || "");
  });
}

export default function EventsView() {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [actualEvents, setActualEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadEvents() {
      setLoading(true);
      setFetchError(null);

      const { data, error } = await supabase
        .from("events")
        .select(
          "id, slug, name, category, description, event_date, start_time, venue, active, registration_open"
        )
        .eq("active", true)
        .order("event_date", { ascending: true });

      if (!isMounted) return;

      if (error) {
        console.error("EVENT FETCH ERROR:", error);
        setActualEvents([]);
        setFetchError("Unable to load current event lineup. Please try again.");
        setLoading(false);
        return;
      }

      setActualEvents(data || []);
      setLoading(false);
    }

    loadEvents();
    return () => {
      isMounted = false;
    };
  }, []);

  // Compute actual events per realm, matching search, up to 6 chips, and dynamic event counts
  const realmsWithEvents = useMemo(() => {
    const trimmedQuery = searchQuery.trim().toLowerCase();

    return REALMS_DATA.map((realm) => {
      const allRealmEvents = sortEvents(
        actualEvents.filter((event) => matchesRealm(event.category, realm.id))
      );

      const matchingEvents = trimmedQuery
        ? allRealmEvents.filter((event) => matchesSearch(event, trimmedQuery))
        : allRealmEvents;

      const displayedChips = matchingEvents.slice(0, 6);
      const dynamicEventCount = `${allRealmEvents.length} Competition${allRealmEvents.length === 1 ? "" : "s"}`;

      return {
        ...realm,
        allEvents: allRealmEvents,
        matchingEvents,
        displayedChips,
        dynamicEventCount,
      };
    });
  }, [actualEvents, searchQuery]);

  // Filter realms based on tab and search query
  const filteredRealms = useMemo(() => {
    const trimmedQuery = searchQuery.trim().toLowerCase();

    return realmsWithEvents.filter((realm) => {
      const matchesCategory =
        selectedCategory === "all" || realm.id === selectedCategory;

      if (!matchesCategory) return false;

      // During search, a realm card appears only when at least one actual event matches
      if (trimmedQuery) {
        return realm.matchingEvents.length > 0;
      }

      return true;
    });
  }, [realmsWithEvents, selectedCategory, searchQuery]);

  return (
    <div className="relative min-h-screen w-full bg-black text-white selection:bg-white selection:text-black">
      {/* 1. FIXED FULL-BLEED PANORAMIC STADIUM BACKGROUND */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <Image
          src="/images/realms-page-bg.webp"
          alt="Saviskar 2026 Realms Festival Amphitheater Stadium Canopy"
          fill
          priority
          sizes="100vw"
          className="object-cover object-center opacity-40 will-change-transform"
        />

        {/* Multi-layered cinematic gradient vignettes */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/90 via-black/50 to-black/95" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.25)_0%,rgba(0,0,0,0.85)_100%)]" />

        {/* Subtle Ambient Cosmic Haze */}
        <div className="absolute left-[15%] top-[15%] h-[650px] w-[650px] rounded-full bg-violet-600/15 blur-[180px]" />
        <div className="absolute right-[10%] top-[35%] h-[550px] w-[550px] rounded-full bg-cyan-500/10 blur-[170px]" />
        <div className="absolute left-[20%] bottom-[15%] h-[600px] w-[600px] rounded-full bg-fuchsia-600/10 blur-[180px]" />
      </div>

      {/* Universal Site Navbar */}
      <Navbar />

      {/* HERO INTRODUCTION */}
      <section className="relative z-20 mx-auto max-w-[1440px] px-5 pb-10 pt-28 md:px-10 md:pt-36">
        {/* Glowing Badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="liquid-glass mb-6 inline-flex items-center gap-2.5 rounded-full px-4 py-1.5 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.3em] text-violet-300 shadow-[0_0_25px_rgba(168,85,247,0.2)]"
        >
          <Sparkles size={12} className="text-violet-300 animate-spin" />
          <span>SAVISKAR 2026 // 4 MONUMENTAL REALMS</span>
        </motion.div>

        {/* Giant Editorial Heading */}
        <motion.h1
          initial={{ opacity: 0, y: 35 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1 }}
          className="max-w-[1200px] text-[clamp(2.5rem,10vw,9.5rem)] font-light leading-[0.82] tracking-tight text-white drop-shadow-[0_4px_30px_rgba(0,0,0,0.95)]"
        >
          Choose your <br />
          <span className="font-editorial text-violet-300 font-normal italic drop-shadow-[0_4px_35px_rgba(168,85,247,0.5)]">
            realm.
          </span>
        </motion.h1>

        {/* Subtitle & Narrative */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="mt-8 flex flex-col justify-between gap-6 border-t border-white/12 pt-8 md:flex-row md:items-end"
        >
          <p className="max-w-2xl text-sm leading-relaxed text-zinc-300 md:text-lg font-normal">
            Four competitive horizons uniting 35,000+ creators, builders, and performers.
            From battlebot cages and hackathons to electric stadium dance stages, market strategy floors, and the flagship{" "}
            <span className="text-white font-medium">AIvishkar AI Tech Expo</span>.
          </p>

          <div className="flex items-center gap-3 font-mono text-xs text-white/50">
            <ShieldCheck size={16} className="text-violet-400" />
            <span>Official UGC Certified Rulebooks Included</span>
          </div>
        </motion.div>
      </section>

      {/* 4. REALM METRICS STRIP */}
      <section className="relative z-20 mx-auto max-w-[1440px] px-5 py-4 md:px-10">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:gap-4">
          {METRICS.map((metric, idx) => (
            <motion.div
              key={metric.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.15 + idx * 0.05 }}
              className="liquid-glass rounded-2xl border border-white/10 p-4 sm:p-5 transition-all hover:border-white/20"
            >
              <div className="font-mono text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl">
                {metric.value}
              </div>
              <div className="mt-1 font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-widest text-violet-300">
                {metric.label}
              </div>
              <div className="mt-1 text-[11px] text-white/50 hidden sm:block truncate">
                {metric.subtitle}
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* 5. INTERACTIVE REALM FILTER & SEARCH BAR */}
      <section className="sticky top-4 z-30 mx-auto max-w-[1440px] px-5 py-4 md:px-10">
        <div className="liquid-glass flex flex-col gap-3 rounded-2xl border border-white/15 p-2.5 backdrop-blur-2xl shadow-[0_15px_40px_rgba(0,0,0,0.7)] sm:flex-row sm:items-center sm:justify-between">
          {/* Realm Switcher Tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedCategory("all")}
              className={`rounded-full px-4 py-2 text-xs font-medium tracking-wide transition-all ${
                selectedCategory === "all"
                  ? "bg-white text-black font-semibold shadow-[0_0_15px_rgba(255,255,255,0.4)]"
                  : "text-white/70 hover:bg-white/10 hover:text-white"
              }`}
            >
              All Realms (4)
            </button>

            {REALMS_DATA.map((realm) => {
              const isSelected = selectedCategory === realm.id;
              const Icon = realm.icon;
              return (
                <button
                  key={realm.id}
                  type="button"
                  onClick={() => setSelectedCategory(realm.id)}
                  className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-medium tracking-wide transition-all ${
                    isSelected
                      ? "bg-white text-black font-semibold shadow-[0_0_15px_rgba(255,255,255,0.4)]"
                      : "text-white/70 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <Icon size={13} className={isSelected ? "text-black" : realm.accentColor} />
                  <span>{realm.title}</span>
                </button>
              );
            })}
          </div>

          {/* Quick Search */}
          <div className="relative flex items-center">
            <Search size={14} className="pointer-events-none absolute left-3.5 text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search competitions, robotics, dance, AI..."
              aria-label="Search events"
              className="w-full rounded-full border border-white/10 bg-black/40 pl-9 pr-8 py-1.5 text-xs text-white placeholder-white/40 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400/50 sm:w-64"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 text-white/40 hover:text-white"
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* 6. GRAND REALM CARDS SHOWCASE */}
      <section className="relative z-20 mx-auto max-w-[1440px] px-5 pb-28 pt-6 md:px-10">
        <div className="space-y-10 md:space-y-14">
          <AnimatePresence mode="popLayout">
            {loading ? (
              <div className="liquid-glass rounded-3xl border border-white/12 p-12 text-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
                <p className="mt-4 text-sm text-white/60">Loading verified events...</p>
              </div>
            ) : fetchError ? (
              <div className="liquid-glass rounded-3xl border border-red-500/20 p-12 text-center">
                <p className="text-base font-medium text-white">{fetchError}</p>
                <button
                  type="button"
                  onClick={() => {
                    setLoading(true);
                    setFetchError(null);
                    supabase
                      .from("events")
                      .select("id, slug, name, category, description, event_date, start_time, venue, active, registration_open")
                      .eq("active", true)
                      .order("event_date", { ascending: true })
                      .then(({ data, error }) => {
                        if (error) {
                          setFetchError("Unable to load current event lineup. Please try again.");
                        } else {
                          setActualEvents(data || []);
                        }
                        setLoading(false);
                      });
                  }}
                  className="mt-4 rounded-full bg-white/10 px-5 py-2 text-xs font-semibold text-white hover:bg-white/20 transition-all"
                >
                  Retry
                </button>
              </div>
            ) : filteredRealms.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="liquid-glass rounded-3xl border border-white/12 p-12 text-center"
              >
                <Compass size={40} className="mx-auto text-violet-400 mb-4 animate-bounce" />
                <h3 className="text-xl font-semibold text-white">No Competitions Found</h3>
                <p className="mt-2 text-sm text-white/60">
                  No current events match &quot;{searchQuery.trim()}&quot;.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategory("all");
                    setSearchQuery("");
                  }}
                  className="mt-6 rounded-full bg-white px-6 py-2.5 text-xs font-semibold text-black hover:bg-violet-100 transition-all"
                >
                  Clear Search
                </button>
              </motion.div>
            ) : (
              filteredRealms.map((realm, index) => {
                const Icon = realm.icon;
                const isAIvishkar = realm.id === "aivishkar";

                return (
                  <motion.article
                    key={realm.id}
                    initial={{ opacity: 0, y: 35 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.15 }}
                    transition={{ duration: 0.8, delay: index * 0.08 }}
                    className={`liquid-glass group relative overflow-hidden rounded-[32px] sm:rounded-[36px] border border-white/12 p-6 sm:p-8 md:p-12 transition-all duration-500 hover:shadow-[0_25px_70px_rgba(0,0,0,0.8)] ${realm.accentBorder} ${
                      isAIvishkar
                        ? "border-violet-500/30 bg-gradient-to-br from-black/80 via-violet-950/20 to-black/90 shadow-[0_0_50px_rgba(168,85,247,0.15)]"
                        : "bg-black/70"
                    }`}
                  >
                    {/* Ambient Stage Backlight on Hover */}
                    <div
                      className="pointer-events-none absolute -right-20 -top-20 h-96 w-96 rounded-full opacity-0 blur-[130px] transition-opacity duration-700 group-hover:opacity-100"
                      style={{ background: realm.accentGlow }}
                    />

                    <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr] lg:items-center">
                      {/* Left: Realm Intelligence & Highlights */}
                      <div className="relative z-10 flex flex-col justify-between">
                        {/* Header Badges */}
                        <div>
                          <div className="flex flex-wrap items-center gap-2.5">
                            <span className="font-mono text-xs font-semibold tracking-widest text-violet-400">
                              {realm.number}
                            </span>
                            <span className="text-white/25">•</span>
                            <span className="liquid-glass inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[9px] sm:text-[10px] font-semibold uppercase tracking-wider text-white/80">
                              <Icon size={12} className={realm.accentColor} />
                              {realm.badge}
                            </span>
                          </div>

                          {/* Tagline */}
                          <p className="mt-4 font-mono text-[11px] sm:text-xs uppercase tracking-widest text-white/60">
                            {realm.tagline}
                          </p>

                          {/* Main Title */}
                          <h2 className="mt-2 text-[clamp(2.4rem,5.5vw,5rem)] font-light leading-[0.92] tracking-tight text-white">
                            {isAIvishkar ? (
                              <>
                                <span className="font-semibold text-violet-300">AI</span>vishkar
                                <span className="block text-2xl sm:text-3xl md:text-4xl text-white/90 font-light mt-1 font-editorial italic">
                                  An AI Tech Expo
                                </span>
                              </>
                            ) : (
                              realm.title
                            )}
                          </h2>

                          {/* Description */}
                          <p className="mt-5 max-w-xl text-sm sm:text-base leading-relaxed text-zinc-300 font-normal">
                            {realm.description}
                          </p>

                          {/* Special Keynote Spotlight for AIvishkar */}
                          {realm.highlightChips && (
                            <div className="mt-6 rounded-2xl border border-violet-500/25 bg-violet-950/30 p-4 backdrop-blur-md">
                              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-violet-300 font-semibold mb-2.5">
                                <Sparkles size={12} />
                                <span>EXPOSITION SHOWCASE TRACKS</span>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {realm.highlightChips.map((chip) => (
                                  <div
                                    key={chip}
                                    className="flex items-center gap-2 text-xs text-white/85"
                                  >
                                    <CheckCircle2 size={13} className="text-violet-400 shrink-0" />
                                    <span>{chip}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Event Chips */}
                          <div className="mt-6 flex flex-wrap gap-2">
                            {realm.displayedChips.length > 0 ? (
                              realm.displayedChips.map((event) => (
                                <Link
                                  key={event.id}
                                  href={`/events/${realm.slug}/${event.slug}`}
                                  className="rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1 text-xs text-white/75 transition-colors hover:border-violet-400/50 hover:bg-white/10 hover:text-white"
                                >
                                  {event.name}
                                </Link>
                              ))
                            ) : (
                              !loading && (
                                <span className="font-mono text-xs text-white/40 italic">
                                  Lineup announcements in progress
                                </span>
                              )
                            )}
                          </div>
                        </div>

                        {/* CTAs & Metrics */}
                        <div className="mt-8 sm:mt-10 flex flex-wrap items-center gap-4 pt-6 border-t border-white/10">
                          <Link
                            href={`/events/${realm.slug}`}
                            className="group/btn inline-flex items-center gap-2.5 rounded-full bg-white px-7 py-3.5 text-sm font-semibold text-black transition-all hover:scale-105 hover:bg-violet-100 shadow-[0_10px_25px_rgba(255,255,255,0.2)]"
                          >
                            <span>Explore {realm.title.split(":")[0]} Events</span>
                            <ArrowUpRight
                              size={16}
                              className="transition-transform group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5"
                            />
                          </Link>

                          <a
                            href={realm.rulebookUrl}
                            download
                            className="liquid-glass inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-sm font-medium text-white transition-all hover:bg-white/10 hover:border-violet-400"
                          >
                            <FileDown size={15} />
                            <span>Download Rulebook</span>
                          </a>

                          <div className="ml-auto hidden xl:flex items-center gap-4 text-xs font-mono text-white/50">
                            <span>{realm.dynamicEventCount}</span>
                            <span>•</span>
                            <span className="text-violet-300">{realm.prizePool}</span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Cinematic Visual Showcase Card */}
                      <div className="relative aspect-[16/10] sm:aspect-[16/9] lg:h-[400px] w-full overflow-hidden rounded-[24px] border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.7)]">
                        <Image
                          src={realm.image}
                          alt={`${realm.title} arena exhibition at Saviskar 2026`}
                          fill
                          sizes="(max-width: 1024px) 100vw, 45vw"
                          className="object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                        />
                        {/* Edge lighting & label overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                        <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-transparent to-transparent" />

                        {/* Card bottom details */}
                        <div className="absolute bottom-4 left-5 right-5 flex items-center justify-between font-mono text-xs text-white/75">
                          <span className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-violet-400 animate-pulse" />
                            <span>STAGE {realm.number.replace("REALM ", "")}</span>
                          </span>
                          <span className="text-white/60">CGC UNIVERSITY MOHALI</span>
                        </div>
                      </div>
                    </div>
                  </motion.article>
                );
              })
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* 7. BOTTOM STADIUM CTA BANNER */}
      <section className="relative z-20 mx-auto max-w-[1440px] px-5 pb-28 md:px-10">
        <div className="liquid-glass relative overflow-hidden rounded-[32px] border border-white/15 p-8 sm:p-12 md:p-16 text-center shadow-[0_25px_60px_rgba(0,0,0,0.8)]">
          {/* Ambient Glow */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[450px] w-full max-w-[800px] rounded-full bg-violet-600/15 blur-[160px] -z-10" />

          <div className="liquid-glass mb-4 inline-flex items-center gap-2 rounded-full px-4 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-violet-300">
            <Trophy size={13} />
            CHAMPIONSHIP REGISTRATIONS OPEN
          </div>

          <h2 className="mx-auto max-w-2xl text-[clamp(2.2rem,5vw,4.5rem)] font-light leading-tight tracking-tight text-white">
            Ready to claim <br />
            <span className="font-editorial text-violet-300 font-normal italic">your glory?</span>
          </h2>

          <p className="mx-auto mt-4 max-w-xl text-sm sm:text-base text-zinc-300">
            Assemble your team, review verified rulebooks, and secure your official delegate passes for Saviskar 2026.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-black transition-all hover:scale-105 hover:bg-violet-100 shadow-[0_10px_25px_rgba(255,255,255,0.3)]"
            >
              <span>Register Your Squad</span>
              <ArrowUpRight size={16} />
            </Link>

            <Link
              href="/starnight"
              className="liquid-glass inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-sm font-medium text-white transition-all hover:bg-white/10 hover:border-violet-400"
            >
              <span>Explore Star Night Concert</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
