"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

const categories = {
  cultural: {
    number: "01",
    title: "Cultural",
    tagline: "Dance. Music. Performance.",
    description:
      "A stage for expression, rhythm and performances that turn moments into memories.",
    image: "/images/cultural.jpg",
  },

  technical: {
    number: "02",
    title: "Technical",
    tagline: "Build. Invent. Compete.",
    description:
      "Where ideas meet engineering. Build, solve and compete through technology-driven challenges.",
    image: "/images/technical.jpg",
  },

  "non-technical": {
    number: "03",
    title: "Non-Technical",
    tagline: "Create. Think. Express.",
    description:
      "Creativity, strategy and unconventional challenges designed to test more than technical skill.",
    image: "/images/gallery-2.jpg",
  },

  sports: {
    number: "04",
    title: "Sports",
    tagline: "Play. Push. Win.",
    description:
      "Bring the energy, represent your team and compete for the win.",
    image: "/images/sports.jpg",
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

  const categoryInfo =
    categories[category as Category];

  useEffect(() => {
    if (!categoryInfo) return;

    loadEvents();
  }, [category, categoryInfo]);

  async function loadEvents() {
    setLoading(true);

    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("category", category)
      .eq("active", true)
      .order("event_date", { ascending: true });

    if (error) {
      console.error("EVENT FETCH ERROR:", error);
      setCategoryEvents([]);
      setLoading(false);
      return;
    }

    setCategoryEvents(data || []);
    setLoading(false);
  }

  if (!categoryInfo) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        <div className="text-center">
          <h1 className="text-5xl font-semibold">
            Category not found
          </h1>

          <Link
            href="/events"
            className="mt-6 inline-block text-white/50 hover:text-white"
          >
            Back to events
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white">

      {/* HERO */}
      <section className="relative min-h-screen overflow-hidden">

        <Image
          src={categoryInfo.image}
          alt={`${categoryInfo.title} events at Saviskar`}
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />

        <div className="absolute inset-0 bg-black/45" />

        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/15 to-black/35" />

        {/* Navigation */}
        <div className="absolute left-0 top-0 z-20 w-full">

          <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-8 md:px-10">

            <Link
              href="/events"
              className="flex items-center gap-2 text-sm text-white/60 transition hover:text-white"
            >
              <ArrowLeft size={15} />
              All Events
            </Link>

            <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/50">
              Saviskar 2026
            </span>

          </div>

        </div>

        {/* Hero content */}
        <div className="relative z-10 mx-auto flex min-h-screen max-w-[1400px] flex-col justify-end px-6 pb-14 md:px-10 md:pb-20">

          <span className="mb-5 text-[11px] tracking-[0.25em] text-white/50">
            {categoryInfo.number}
          </span>

          <h1 className="text-[clamp(4.5rem,13vw,13rem)] font-semibold leading-[0.78] tracking-[-0.075em]">
            {categoryInfo.title}.
          </h1>

          <div className="mt-10 flex flex-col gap-8 border-t border-white/20 pt-7 md:flex-row md:items-end md:justify-between">

            <div>

              <p className="text-lg font-medium">
                {categoryInfo.tagline}
              </p>

              <p className="mt-3 max-w-lg text-sm leading-6 text-white/50 md:text-base">
                {categoryInfo.description}
              </p>

            </div>

            <a
              href="#competitions"
              className="flex w-fit items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.03]"
            >
              Explore events
              <ArrowUpRight size={15} />
            </a>

          </div>

        </div>

      </section>

      {/* EVENTS */}
      <section
        id="competitions"
        className="bg-[#f5f5f7] px-6 py-28 text-black md:px-10 md:py-40"
      >

        <div className="mx-auto max-w-[1200px]">

          <p className="mb-6 text-[11px] font-semibold uppercase tracking-[0.22em] text-black/35">
            {categoryInfo.title} Events
          </p>

          <h2 className="max-w-[900px] text-[clamp(3.5rem,7vw,7rem)] font-semibold leading-[0.88] tracking-[-0.065em]">
            Pick your
            <br />
            challenge.
          </h2>

          <div className="mt-20 border-t border-black/10">

            {/* Loading */}
            {loading && (
              <div className="py-14">
                <p className="text-sm text-black/40">
                  Loading events...
                </p>
              </div>
            )}

            {/* Events */}
            {!loading &&
              categoryEvents.length > 0 &&
              categoryEvents.map((item, index) => (

                <Link
                  key={item.id}
                  href={`/events/${category}/${item.slug}`}
                  className="group flex items-center justify-between gap-6 border-b border-black/10 py-7 md:py-9"
                >

                  <div className="flex items-start gap-5 md:gap-10">

                    <span className="mt-2 min-w-[25px] text-[11px] text-black/70">
                      {String(index + 1).padStart(2, "0")}
                    </span>

                    <div>

                      <h3 className="text-[clamp(1.7rem,3vw,3rem)] font-semibold tracking-[-0.045em] transition-transform duration-300 group-hover:translate-x-2">
                        {item.name}
                      </h3>

                      {item.description && (
                        <p className="mt-2 max-w-xl text-sm leading-6 text-black/40">
                          {item.description}
                        </p>
                      )}

                      <div className="mt-4 flex flex-wrap gap-2">

                        {item.registration_open ? (
                          <span className="rounded-full bg-green-100 px-3 py-1 text-[10px] font-medium text-green-700">
                            Registration open
                          </span>
                        ) : (
                          <span className="rounded-full bg-black/5 px-3 py-1 text-[10px] font-medium text-black/40">
                            Registration closed
                          </span>
                        )}

                        {item.registration_type && (
                          <span className="rounded-full bg-black px-3 py-1 text-[10px] font-medium capitalize text-white">
                            {item.registration_type}
                          </span>
                        )}

                      </div>

                    </div>

                  </div>

                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/15 transition-all duration-300 group-hover:rotate-45 group-hover:bg-black group-hover:text-white md:h-12 md:w-12">
                    <ArrowUpRight size={16} />
                  </div>

                </Link>

              ))}

            {/* Empty state */}
            {!loading && categoryEvents.length === 0 && (

              <div className="py-14">

                <p className="text-lg font-medium">
                  Events coming soon.
                </p>

                <p className="mt-2 max-w-md text-sm leading-6 text-black/40">
                  The official{" "}
                  {categoryInfo.title.toLowerCase()} event lineup
                  will appear here.
                </p>

              </div>

            )}

          </div>

          {!loading && categoryEvents.length > 0 && (

            <div className="mt-10 flex items-center justify-between text-xs text-black/35">

              <span>
                {categoryEvents.length}{" "}
                {categoryEvents.length === 1
                  ? "event"
                  : "events"}
              </span>

              <span>Saviskar 2026</span>

            </div>

          )}

        </div>

      </section>

    </main>
  );
}