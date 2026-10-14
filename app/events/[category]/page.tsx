"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, FileDown, Lock, Search, Sparkles, X } from "lucide-react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Navbar from "@/components/ui/Navbar";
import { SITE_ACCESS } from "@/lib/config/site-access";
import { getEventRulebook } from "@/lib/events/rulebooks";

const categories = {
  technical: {
    number: "01",
    title: "Technical",
    tagline: "Build. Invent. Compete.",
    description:
      "Where cutting-edge code meets robotics and mechanical ingenuity. Compete across futuristic realms designed for builders and hackers.",
    image: "/images/realm-technical-v2.webp",
    rulebookUrl: "/rulebooks/saviskar-2026-technical-rulebook.pdf",
  },
  "non-technical": {
    number: "02",
    title: "Non-Technical",
    tagline: "Create. Think. Express.",
    description:
      "Strategic simulations, visual arts, filmmaking, debates, and creative expression designed beyond the classroom.",
    image: "/images/realm-nontech-v2.webp",
    rulebookUrl: "/rulebooks/saviskar-2026-non-technical-rulebook.pdf",
  },
  cultural: {
    number: "03",
    title: "Cultural",
    tagline: "Dance. Music. Performance.",
    description:
      "High-voltage music, choreography, theatre, and grand performances taking over the central Saviskar concert mainstage.",
    image: "/images/realm-cultural-v2.webp",
    rulebookUrl: "/rulebooks/saviskar-2026-cultural-rulebook.pdf",
  },
  aivishkar: {
    number: "04",
    title: "AIvishkar: An AI Tech Expo",
    tagline: "Autonomous. Neural. Beyond Human Frontier.",
    description:
      "Flagship National AI Exposition featuring autonomous humanoid robotics, neural agent showcases, computer vision labs, and tech startup venture demo pitches.",
    image: "/images/realm-aivishkar-ai.webp",
    rulebookUrl: "/rulebooks/saviskar-2026-aivishkar-rulebook.pdf",
  },
  avishkar: {
    number: "04",
    title: "AIvishkar: An AI Tech Expo",
    tagline: "Autonomous. Neural. Beyond Human Frontier.",
    description:
      "Flagship National AI Exposition featuring autonomous humanoid robotics, neural agent showcases, computer vision labs, and tech startup venture demo pitches.",
    image: "/images/realm-aivishkar-ai.webp",
    rulebookUrl: "/rulebooks/saviskar-2026-aivishkar-rulebook.pdf",
  },
  sports: {
    number: "05",
    title: "Sports",
    tagline: "Play. Push. Win.",
    description:
      "Under towering stadium floodlights and electric realm energy, bring unstoppable athletic stamina and compete for glory.",
    image: "/images/realm-sports.webp",
    rulebookUrl: "/rulebooks/saviskar-2026-sports-rulebook.pdf",
  },
};

type Category = keyof typeof categories;

type Event = {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
  event_date: string | null;
  start_time: string | null;
  venue: string | null;
  registration_type: string;
  min_team_size: number | null;
  max_team_size: number | null;
  registration_limit: number | null;
  registration_open: boolean;
  active: boolean;
};

export default function CategoryPage() {
  const params = useParams();
  const category = params.category as string;

  const [categoryEvents, setCategoryEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const categoryInfo = categories[category as Category];

  const [prevCategory, setPrevCategory] = useState(category);
  if (category !== prevCategory) {
    setPrevCategory(category);
    setSearchQuery("");
  }

  const filteredEvents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return categoryEvents;
    }

    return categoryEvents.filter((event) => {
      return [
        event.name,
        event.description,
        event.venue,
        event.registration_type,
      ].some((value) =>
        value?.toLowerCase().includes(query)
      );
    });
  }, [categoryEvents, searchQuery]);

  useEffect(() => {
    if (!categoryInfo) return;

    let isMounted = true;
    async function loadEvents() {
      setLoading(true);

      const { data, error } = await supabase
        .from("events")
        .select("*")
        .eq("category", category)
        .eq("active", true)
        .order("event_date", { ascending: true });

      if (!isMounted) return;

      if (error) {
        console.error("EVENT FETCH ERROR:", error);
        setCategoryEvents([]);
        setLoading(false);
        return;
      }

      setCategoryEvents(data || []);
      setLoading(false);
    }

    loadEvents();
    return () => {
      isMounted = false;
    };
  }, [category, categoryInfo]);

  if (!categoryInfo) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        <div className="text-center">
          <h1 className="text-5xl font-semibold">Realm Not Found</h1>
          <Link
            href="/events"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-violet-200"
          >
            <ArrowLeft size={16} /> Back to Realms
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white selection:bg-white selection:text-black">
      {/* Universal Site Navbar */}
      <Navbar />

      {/* 01. HERO WITH 8K CONCERT STAGE PHOTOGRAPHY */}
      <section className="relative min-h-[92vh] overflow-hidden">
        <Image
          src={categoryInfo.image}
          alt={`${categoryInfo.title} events at Saviskar`}
          fill
          priority
          sizes="100vw"
          className="object-cover brightness-[0.75]"
        />

        {/* Theatrical Lighting Overlays */}
        <div className="absolute inset-0 bg-black/50" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(168,85,247,0.2)_0%,rgba(0,0,0,0.6)_60%,#000000_95%)]" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-black/60 pointer-events-none" />

        {/* Sub-Navigation Actions */}
        <div className="absolute left-0 top-20 md:top-24 z-20 w-full">
          <div className="mx-auto flex max-w-[1440px] items-center justify-between px-6 py-4 md:px-10">
            <Link
              href="/events"
              className="liquid-glass flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-white/80 transition hover:text-white"
            >
              <ArrowLeft size={14} />
              <span>All Realms</span>
            </Link>

            <a
              href={categoryInfo.rulebookUrl}
              target="_blank"
              rel="noopener noreferrer"
              download
              className="liquid-glass flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium text-violet-300 transition hover:bg-white/10"
            >
              <FileDown size={14} />
              <span>Rulebook</span>
            </a>
          </div>
        </div>

        {/* Hero Content */}
        <div className="relative z-10 mx-auto flex min-h-[92vh] max-w-[1440px] flex-col justify-end px-6 pb-16 md:px-10 md:pb-24">
          <span className="mb-4 font-mono text-xs tracking-[0.3em] text-violet-300">
            REALM {categoryInfo.number}
          </span>

          <h1 className="text-[clamp(4rem,12vw,11.5rem)] font-light leading-[0.8] tracking-tight text-white">
            {categoryInfo.title}
          </h1>

          <div className="mt-8 flex flex-col gap-8 border-t border-white/20 pt-8 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="font-sans text-xl font-medium text-violet-300 md:text-2xl">
                {categoryInfo.tagline}
              </p>

              <p className="mt-3 max-w-xl text-sm leading-6 text-white/60 md:text-base">
                {categoryInfo.description}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <a
                href="#competitions"
                className="flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-sm font-semibold text-black transition-all hover:scale-105 hover:bg-violet-100"
              >
                Browse Competitions
                <ArrowUpRight size={16} />
              </a>

              <a
                href={categoryInfo.rulebookUrl}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="liquid-glass flex items-center gap-2 rounded-full px-6 py-3.5 text-sm font-medium text-white transition hover:bg-white/15"
              >
                <FileDown size={16} />
                Download PDF
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* 02. COMPETITIONS IN DARK LIQUID GLASS */}
      <section
        id="competitions"
        className="relative bg-black px-6 py-28 text-white md:px-10 md:py-36"
      >
        <div className="pointer-events-none absolute right-[10%] top-[10%] h-[500px] w-[500px] rounded-full bg-violet-600/10 blur-[160px]" />

        <div className="relative z-10 mx-auto max-w-[1300px]">
          <div className="liquid-glass mb-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-violet-300">
            <Sparkles size={12} />
            Official Lineup
          </div>

          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <h2 className="text-[clamp(3.5rem,7vw,7rem)] font-light leading-[0.88] tracking-tight text-white">
              Pick your <br />
              <span className="font-editorial text-violet-300 font-normal">challenge.</span>
            </h2>

            {!loading && categoryEvents.length > 0 && (
              <div className="w-full md:w-auto md:min-w-[340px] lg:min-w-[400px]">
                <div className="relative w-full">
                  <Search
                    size={18}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/40"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={`Search ${categoryInfo.title} events...`}
                    aria-label="Search events"
                    className="liquid-glass w-full rounded-full py-3.5 pl-11 pr-11 text-sm text-white placeholder-white/40 transition-all duration-300 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      aria-label="Clear event search"
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-white/40 transition hover:bg-white/10 hover:text-white"
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {!SITE_ACCESS.EVENT_DETAILS_ENABLED && (
            <div className="liquid-glass mt-8 flex items-center gap-3 rounded-2xl border border-violet-500/30 bg-violet-950/25 px-5 py-3.5 text-xs text-violet-200">
              <Lock size={14} className="shrink-0 text-violet-400" />
              <span>
                Official competition lineup for {categoryInfo.title}. Individual dossiers, round parameters, and registration gateways will unlock closer to the festival.
              </span>
            </div>
          )}

          <div className="mt-12 space-y-4">
            {/* Loading */}
            {loading && (
              <div className="py-20 text-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
                <p className="mt-4 text-sm text-white/40">
                  Loading verified realm competitions...
                </p>
              </div>
            )}

            {/* Events List */}
            {!loading &&
              filteredEvents.length > 0 &&
              filteredEvents.map((item, index) => {
                const rulebook = getEventRulebook(item.slug || item.name, category);

                return (
                  <div
                    key={item.id}
                    className={`liquid-glass group relative flex flex-col md:flex-row md:items-center md:justify-between gap-6 rounded-[24px] border border-white/10 p-7 transition-all md:p-8 ${
                      SITE_ACCESS.EVENT_DETAILS_ENABLED
                        ? "hover:border-violet-500/40 hover:bg-white/[0.05] hover:shadow-[0_15px_40px_rgba(168,85,247,0.15)]"
                        : "hover:border-white/20 hover:bg-white/[0.03]"
                    }`}
                  >
                    {/* Primary Card Link (when enabled) */}
                    {SITE_ACCESS.EVENT_DETAILS_ENABLED && (
                      <Link
                        href={`/events/${category}/${item.slug}`}
                        className="absolute inset-0 z-0 rounded-[24px]"
                        aria-label={`View ${item.name} details`}
                      />
                    )}

                    {/* Card Content */}
                    <div className="relative z-10 flex flex-1 items-start gap-6 md:gap-10 pointer-events-none">
                      <span className="font-mono text-sm tracking-widest text-violet-400/80 mt-1 shrink-0">
                        {String(index + 1).padStart(2, "0")}
                      </span>

                      <div>
                        <h3 className="text-2xl font-medium tracking-tight text-white transition-colors group-hover:text-violet-200 md:text-3xl">
                          {item.name}
                        </h3>

                        {item.description && (
                          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">
                            {item.description}
                          </p>
                        )}

                        <div className="mt-4 flex flex-wrap items-center gap-2 pointer-events-auto">
                          {!SITE_ACCESS.EVENT_DETAILS_ENABLED ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-violet-300">
                              <Lock size={10} />
                              Dossier Locked
                            </span>
                          ) : item.registration_open ? (
                            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-emerald-300">
                              Registration Open
                            </span>
                          ) : (
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-white/40">
                              Registration Closed
                            </span>
                          )}

                          {item.registration_type && (
                            <span className="liquid-glass rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-violet-300">
                              {item.registration_type}
                            </span>
                          )}

                          {item.venue && (
                            <span className="rounded-full border border-white/10 px-3 py-1 text-[10px] text-white/40">
                              {item.venue}
                            </span>
                          )}

                          <a
                            href={rulebook.pdfUrl}
                            download={`${item.slug}-rulebook.pdf`}
                            className="liquid-glass relative z-20 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-violet-300 transition hover:bg-violet-500/20 hover:border-violet-400"
                            title={`Download ${item.name} Rulebook PDF`}
                          >
                            <FileDown size={11} />
                            <span>Rulebook</span>
                          </a>
                        </div>
                      </div>
                    </div>

                    <div className="relative z-10 pointer-events-none flex items-center gap-2.5 shrink-0">
                      {!SITE_ACCESS.EVENT_DETAILS_ENABLED ? (
                        <>
                          <span className="hidden sm:inline font-mono text-[10px] tracking-wider uppercase text-violet-300/60">
                            Releasing Soon
                          </span>
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-300">
                            <Lock size={16} />
                          </div>
                        </>
                      ) : (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/15 text-white transition-all duration-300 group-hover:scale-110 group-hover:border-white group-hover:bg-white group-hover:text-black">
                          <ArrowUpRight size={18} className="transition-transform group-hover:rotate-45" />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

            {/* Empty Search State */}
            {!loading && categoryEvents.length > 0 && filteredEvents.length === 0 && (
              <div className="liquid-glass rounded-[28px] border border-white/10 p-12 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5 text-violet-300">
                  <Search size={20} />
                </div>
                <p className="text-xl font-semibold text-white">
                  No challenges found
                </p>
                <p className="mt-2 text-sm text-white/50">
                  No events in this realm match &ldquo;{searchQuery.trim()}&rdquo;.
                </p>
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear event search"
                  className="mt-6 inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-violet-300 transition hover:bg-violet-500/20 hover:text-white"
                >
                  Clear Search
                </button>
              </div>
            )}

            {/* Empty State */}
            {!loading && categoryEvents.length === 0 && (
              <div className="liquid-glass rounded-[28px] p-12 text-center">
                <p className="text-xl font-semibold text-white">
                  Events Announcement in Progress
                </p>
                <p className="mt-2 text-sm text-white/50">
                  The verified {categoryInfo.title.toLowerCase()} event lineup will go live shortly. Check back soon.
                </p>
              </div>
            )}
          </div>

          {!loading && categoryEvents.length > 0 && (
            <div className="mt-12 flex items-center justify-between border-t border-white/10 pt-6 text-xs text-white/40 font-mono">
              <span>
                {searchQuery.trim()
                  ? `${filteredEvents.length} OF ${categoryEvents.length} EVENTS`
                  : `${categoryEvents.length} VERIFIED EVENTS`}
              </span>
              <span>CGC UNIVERSITY MOHALI • SAVISKAR 2026</span>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}