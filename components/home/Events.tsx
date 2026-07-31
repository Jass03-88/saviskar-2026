"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";

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
            <p className="text-[10px] uppercase tracking-[0.2em] text-black/30">
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
            <motion.article
              key={event.slug}
              initial={{ opacity: 0, y: 55 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.12 }}
              transition={{
                duration: 0.9,
                delay: (index % 2) * 0.08,
                ease,
              }}
            >
              <Link
                href={`/events/${event.slug}`}
                className="group relative block h-[520px] overflow-hidden rounded-[26px] bg-black md:h-[690px]"
              >
                <Image
                  src={event.image}
                  alt={`${event.title} events at Saviskar`}
                  fill
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="object-cover transition-transform duration-[1400ms] ease-out group-hover:scale-[1.055]"
                />

                <div className="absolute inset-0 bg-black/10 transition-colors duration-700 group-hover:bg-black/5" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-black/20" />

                <div className="absolute left-6 right-6 top-6 flex items-center justify-between md:left-8 md:right-8 md:top-8">
                  <span className="text-[10px] font-medium tracking-[0.22em] text-white/60">
                    {event.number}
                  </span>
                  <span className="rounded-full border border-white/20 bg-black/10 px-3 py-1.5 text-[9px] uppercase tracking-[0.18em] text-white/65 backdrop-blur-md">
                    Arena
                  </span>
                </div>

                <div className="absolute inset-x-0 bottom-0 p-7 text-white md:p-9">
                  <motion.div className="mb-5">
                    <p className="mb-3 text-[12px] tracking-[0.02em] text-white/55 md:text-[13px]">
                      {event.subtitle}
                    </p>

                    <div className="flex items-end justify-between gap-5">
                      <h3 className="font-serif text-[clamp(3rem,5vw,5.7rem)] font-semibold leading-[0.82] tracking-[-0.065em]">
                        {event.title}
                      </h3>

                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-black transition-all duration-500 group-hover:rotate-45 group-hover:scale-110 md:h-14 md:w-14">
                        <ArrowUpRight size={19} />
                      </div>
                    </div>
                  </motion.div>

                  <div className="grid grid-rows-[1fr] opacity-100 transition-all duration-500 md:grid-rows-[0fr] md:opacity-0 md:group-hover:grid-rows-[1fr] md:group-hover:opacity-100">
                    <div className="overflow-hidden">
                      <p className="max-w-md border-t border-white/20 pt-5 text-sm leading-6 text-white/60">
                        {event.description}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 h-px w-full origin-left scale-x-0 bg-white/35 transition-transform duration-700 group-hover:scale-x-100" />
                </div>
              </Link>
            </motion.article>
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
