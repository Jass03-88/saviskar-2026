"use client";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import EventCard from "@/components/home/EventCard";
import { motion } from "motion/react";

const events = [
  {
    number: "01",
    title: "Cultural",
    slug: "cultural",
    subtitle: "Dance. Music. Performance.",
    description:
      "Take the stage and turn every performance into a moment worth remembering.",
    image: "/images/cultural.jpg",
  },
  {
    number: "02",
    title: "Technical",
    slug: "technical",
    subtitle: "Build. Invent. Compete.",
    description:
      "Ideas meet engineering through challenges built for creators and problem solvers.",
    image: "/images/technical.jpg",
  },
  {
    number: "03",
    title: "Non-Technical",
    slug: "non-technical",
    subtitle: "Create. Think. Express.",
    description:
      "Strategy, creativity and experiences that go beyond the conventional.",
    image: "/images/gallery-2.jpg",
  },
  {
    number: "04",
    title: "Sports",
    slug: "sports",
    subtitle: "Play. Push. Win.",
    description:
      "Bring the energy, represent your team and compete beyond the stage.",
    image: "/images/sports.jpg",
  },
];

const ease = [0.16, 1, 0.3, 1] as const;

export default function Events() {
  return (
    <section
      id="events"
      className="relative overflow-hidden bg-[#f5f5f7] px-4 pb-28 pt-24 text-black md:px-8 md:pb-44 md:pt-36"
    >
      <div className="mx-auto max-w-[1400px]">
        <div className="mb-14 px-2 md:mb-20">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.8 }}
            transition={{ duration: 0.6, ease }}
            className="mb-7 flex items-center justify-between border-b border-black/10 pb-5"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-black/40 md:text-[11px]">
              Explore Saviskar
            </p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-black/70">
              04 Arenas
            </p>
          </motion.div>

          <div className="grid gap-10 md:grid-cols-[1.5fr_0.5fr] md:items-end">
            <motion.h2
              initial={{ opacity: 0, y: 50 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.35 }}
              transition={{ duration: 0.95, ease }}
              className="font-serif text-[clamp(4.2rem,9vw,9rem)] font-semibold leading-[0.78] tracking-[-0.075em]"
            >
              Find your
              <br />
              arena.
            </motion.h2>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.5 }}
              transition={{ duration: 0.8, delay: 0.12, ease }}
              className="md:pb-2"
            >
              <p className="max-w-sm text-sm leading-6 text-black/45 md:text-[15px]">
                From code to choreography. From the field to the stage. Find
                the space where your talent belongs.
              </p>

              <Link
                href="/events"
                className="group mt-6 inline-flex items-center gap-2 text-sm font-medium"
              >
                Explore all events
                <ArrowUpRight
                  size={14}
                  className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                />
              </Link>
            </motion.div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {events.map((event, index) => (
            <EventCard
  key={event.slug}
  event={event}
  index={index}
  ease={ease}
/>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease }}
          className="mt-12 flex items-center justify-between border-t border-black/10 pt-6 md:mt-16"
        >
          <p className="max-w-xs text-xs leading-5 text-black/35">
            Four arenas. Dozens of events. One place to make your mark.
          </p>

          <Link
            href="/events"
            className="group flex h-12 w-12 items-center justify-center rounded-full border border-black/15 transition-colors hover:bg-black hover:text-white md:h-14 md:w-14"
            aria-label="Explore all Saviskar events"
          >
            <ArrowUpRight
              size={17}
              className="transition-transform duration-300 group-hover:rotate-45"
            />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
