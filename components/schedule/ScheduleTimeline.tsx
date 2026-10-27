"use client";

import { useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Clock3,
  MapPin,
  ArrowUpRight,
} from "lucide-react";
import {
  motion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import BlurText from "@/components/reactbits/BlurText";

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

type Props = {
  events: Event[];
};

const categoryStyles: Record<
  string,
  { label: string; accent: string }
> = {
  technical: {
    label: "TECH",
    accent: "from-violet-500/25 via-violet-300/10 to-transparent",
  },
  cultural: {
    label: "CULTURAL",
    accent: "from-fuchsia-500/20 via-pink-300/10 to-transparent",
  },
  sports: {
    label: "SPORTS",
    accent: "from-blue-500/20 via-cyan-300/10 to-transparent",
  },
  "non-technical": {
    label: "NON-TECH",
    accent: "from-amber-500/15 via-orange-300/10 to-transparent",
  },
};

function categoryMeta(category: string | null) {
  const key = (category ?? "").toLowerCase().trim();

  return (
    categoryStyles[key] ?? {
      label: key
        ? key.replace(/-/g, " ").toUpperCase()
        : "EVENT",
      accent: "from-black/10 via-black/5 to-transparent",
    }
  );
}

function formatTime(value: string | null) {
  if (!value) return "TIME TBA";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return "TIME TBA";
  if (trimmed.includes("AM") || trimmed.includes("PM")) return trimmed.toUpperCase();

  const [hourText, minuteText] = trimmed.slice(0, 5).split(":");
  const hour = Number(hourText);
  const minute = minuteText ?? "00";

  if (isNaN(hour)) return "TIME TBA";

  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;

  return `${displayHour}:${minute} ${suffix}`;
}

function formatDate(value: string | null) {
  if (!value || value === "tba") return "DATE TBA";

  try {
    const d = new Date(`${value}T00:00:00`);
    if (isNaN(d.getTime())) return "DATE TBA";
    return d
      .toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      })
      .toUpperCase();
  } catch {
    return "DATE TBA";
  }
}

function dayLabel(value: string | null) {
  if (!value || value === "tba") return "Date To Be Announced";

  try {
    const d = new Date(`${value}T00:00:00`);
    if (isNaN(d.getTime())) return "Date To Be Announced";
    return d.toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return "Date To Be Announced";
  }
}

function EventCard({
  event,
  index,
}: {
  event: Event;
  index: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.82", "center 0.48"],
  });

  const opacity = useTransform(
    scrollYProgress,
    [0, 0.45, 1],
    [0.3, 1, 1]
  );

  const x = useTransform(
    scrollYProgress,
    [0, 0.65, 1],
    [index % 2 === 0 ? -45 : 45, 0, 0]
  );

  const scale = useTransform(
    scrollYProgress,
    [0, 0.7, 1],
    [0.96, 1, 1]
  );

  const smoothOpacity = useSpring(opacity, {
    stiffness: 120,
    damping: 24,
  });

  const smoothX = useSpring(x, {
    stiffness: 120,
    damping: 24,
  });

  const smoothScale = useSpring(scale, {
    stiffness: 120,
    damping: 24,
  });

  const meta = categoryMeta(event.category);

  return (
    <motion.article
      ref={ref}
      style={{
        opacity: smoothOpacity,
        x: smoothX,
        scale: smoothScale,
      }}
      className="
        relative
        grid
        grid-cols-[42px_minmax(0,1fr)]
        gap-5
        md:grid-cols-[110px_42px_minmax(0,1fr)]
        md:gap-7
      "
    >
      {/* TIME */}
      <div className="hidden pt-8 text-right md:block">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-violet-300/80">
          {formatTime(event.start_time)}
        </p>
      </div>

      {/* TIMELINE DOT */}
      <div className="relative flex justify-center">
        <motion.div
          whileHover={{
            scale: 1.25,
          }}
          className="
            relative
            z-20
            mt-8
            h-4
            w-4
            rounded-full
            border
            border-violet-400/40
            bg-black
            shadow-[0_0_10px_rgba(168,85,247,0.5)]
          "
        >
          <motion.span
            initial={{ scale: 0 }}
            whileInView={{ scale: 1 }}
            viewport={{ once: true }}
            transition={{
              delay: 0.15,
              type: "spring",
              stiffness: 260,
            }}
            className="
              absolute
              inset-[3px]
              rounded-full
              bg-violet-400
            "
          />
        </motion.div>
      </div>

      {/* EVENT CARD */}
      <motion.div
        whileHover={{
          y: -5,
        }}
        transition={{
          duration: 0.3,
        }}
        className="
          liquid-glass
          group
          relative
          mb-8
          w-full
          overflow-hidden
          rounded-[28px]
          border
          border-white/12
          p-6
          text-left
          text-white
          shadow-[0_18px_60px_rgba(0,0,0,0.8)]
          transition-all
          hover:border-violet-500/40
          hover:shadow-[0_20px_50px_rgba(168,85,247,0.18)]
          md:p-8
        "
      >
        {/* CATEGORY GRADIENT */}
        <div
          className={`
            pointer-events-none
            absolute
            inset-0
            bg-gradient-to-br
            ${meta.accent}
            opacity-30
            transition-opacity
            duration-500
            group-hover:opacity-60
          `}
        />

        {/* SUBTLE HOVER LIGHT */}
        <motion.div
          initial={{
            opacity: 0,
          }}
          whileHover={{
            opacity: 1,
          }}
          className="
            pointer-events-none
            absolute
            -right-24
            -top-24
            h-64
            w-64
            rounded-full
            bg-violet-500/20
            blur-3xl
          "
        />

        <div className="relative">
          {/* TOP META */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="font-mono text-[10px] tracking-[0.25em] text-violet-300/80">
                {String(index + 1).padStart(2, "0")}
              </span>

              <span
                className="
                  liquid-glass
                  rounded-full
                  px-3
                  py-1
                  text-[9px]
                  uppercase
                  tracking-[0.2em]
                  text-white/70
                "
              >
                {meta.label}
              </span>
            </div>

            <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-white/40">
              SAVISKAR 2026
            </span>
          </div>

          {/* MAIN CONTENT GRID */}
          <div className="mt-6 grid gap-8 md:grid-cols-[1.15fr_0.85fr] md:items-end">
            {/* LEFT */}
            <div>
              <BlurText
                text={event.name}
                delay={0.05}
                className="
                  max-w-3xl
                  font-sans
                  text-[clamp(1.8rem,3.5vw,3.5rem)]
                  font-semibold
                  leading-[0.96]
                  tracking-tight
                  text-white
                "
              />

              {/* EVENT META */}
              <div
                className="
                  mt-6
                  flex
                  flex-wrap
                  gap-x-6
                  gap-y-3
                  text-[10px]
                  uppercase
                  tracking-[0.18em]
                  text-white/50
                "
              >
                <span className="flex items-center gap-2 text-violet-300">
                  <Clock3 size={12} />
                  {formatTime(event.start_time)}
                </span>

                <span className="flex items-center gap-2">
                  <CalendarDays size={12} />
                  {formatDate(event.event_date)}
                </span>

                <span className="flex items-center gap-2 text-zinc-300">
                  <MapPin size={12} className="text-violet-400 shrink-0" />
                  <span>{event.venue || "CGC University, Mohali"}</span>
                </span>
              </div>
            </div>

            {/* RIGHT DESCRIPTION */}
            <motion.div
              initial={{
                opacity: 0,
                y: 20,
              }}
              whileInView={{
                opacity: 1,
                y: 0,
              }}
              viewport={{
                once: true,
                amount: 0.4,
              }}
              transition={{
                duration: 0.6,
                delay: 0.12,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="
                border-l
                border-white/10
                pl-6
                md:pl-8
              "
            >
              <p className="
                mb-3
                text-[9px]
                uppercase
                tracking-[0.3em]
                text-violet-400
              ">
                ABOUT THE EVENT
              </p>

              <p className="
                max-w-md
                text-sm
                leading-7
                text-white/60
                md:text-[15px]
              ">
                {event.description ||
                  "Event details will be announced soon. Check back for the latest schedule information."}
              </p>
            </motion.div>
          </div>

          {/* BOTTOM ACTIONS */}
          <div
            className="
              mt-8
              flex
              flex-wrap
              items-center
              justify-between
              gap-4
              border-t
              border-white/10
              pt-5
            "
          >
            <span
              className="
                liquid-glass
                rounded-full
                px-4
                py-1.5
                text-[9px]
                uppercase
                tracking-[0.2em]
                text-white/70
              "
            >
              {event.registration_open
                ? "Registration Open"
                : "Registration Closed"}
            </span>

            <a
              href={`/events/${event.category ?? "events"}/${event.slug}`}
              onClick={(e) => e.stopPropagation()}
              className="
                liquid-glass
                flex
                items-center
                gap-2
                rounded-full
                px-4
                py-2
                text-[10px]
                uppercase
                tracking-[0.2em]
                text-white
                transition-all
                duration-300
                hover:border-violet-400
                hover:bg-white/10
              "
            >
              Explore Event
              <ArrowUpRight size={13} />
            </a>
          </div>
        </div>
      </motion.div>
    </motion.article>
  );
}

function DayTimeline({
  date,
  events,
  dayNumber,
}: {
  date: string;
  events: Event[];
  dayNumber: number;
}) {
  const sectionRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start 0.55", "end 0.55"],
  });

  const lineScale = useSpring(
    useTransform(scrollYProgress, [0, 1], [0, 1]),
    {
      stiffness: 100,
      damping: 22,
    }
  );

  return (
    <section ref={sectionRef} className="relative">
      {/* DAY HEADER */}
      <div
        className="
          mb-14
          grid
          gap-5
          md:grid-cols-[150px_1fr]
          md:items-end
        "
      >
        <div>
          <p
            className="
              font-mono
              text-[10px]
              uppercase
              tracking-[0.35em]
              text-violet-300
            "
          >
            DAY {String(dayNumber).padStart(2, "0")}
          </p>

          <p
            className="
              mt-2
              text-2xl
              font-light
              tracking-tight
              text-white
            "
          >
            {dayLabel(date)}
          </p>
        </div>

        <div className="h-px bg-white/10" />
      </div>

      {/* TIMELINE */}
      <div className="relative">
        {/* BACKGROUND LINE */}
        <div
          className="
            absolute
            bottom-0
            left-[20px]
            top-0
            w-px
            bg-white/10
            md:left-[171px]
          "
        />

        {/* ANIMATED LINE */}
        <motion.div
          style={{
            scaleY: lineScale,
          }}
          className="
            absolute
            left-[20px]
            top-0
            h-full
            w-[2px]
            origin-top
            bg-violet-400
            shadow-[0_0_10px_#a855f7]
            md:left-[171px]
          "
        />

        {events.map((event, index) => (
          <EventCard
            key={event.id}
            event={event}
            index={index}
          />
        ))}
      </div>
    </section>
  );
}

export default function ScheduleTimeline({
  events,
}: Props) {
  const days = useMemo(() => {
    const groups = new Map<string, Event[]>();

    [...events]
      .filter((event) => event.active)
      .sort((a, b) => {
        const dateA = a.event_date ?? "9999-12-31";
        const dateB = b.event_date ?? "9999-12-31";

        if (dateA !== dateB) {
          return dateA.localeCompare(dateB);
        }

        // Put events with confirmed start_time first in chronological order
        if (a.start_time && !b.start_time) return -1;
        if (!a.start_time && b.start_time) return 1;
        if (a.start_time && b.start_time) {
          const diff = a.start_time.localeCompare(b.start_time);
          if (diff !== 0) return diff;
        }

        return (a.name || "").localeCompare(b.name || "");
      })
      .forEach((event) => {
        const key = event.event_date ?? "tba";

        groups.set(key, [
          ...(groups.get(key) ?? []),
          event,
        ]);
      });

    return [...groups.entries()];
  }, [events]);

  const [activeDay, setActiveDay] = useState(0);

  const getDayTabTitle = (dateKey: string, idx: number) => {
    if (dateKey === "2026-10-28") return "DAY 01 (28 OCT)";
    if (dateKey === "2026-10-29") return "DAY 02 (29 OCT)";
    if (dateKey === "tba" || !dateKey) return "DATES TBA";
    return `DAY ${String(idx + 1).padStart(2, "0")}`;
  };

  return (
    <div className="relative">
      {/* DAY NAVIGATION */}
      <div
        className="
          sticky
          top-24
          z-30
          mb-12
          flex
          justify-center
          md:justify-end
        "
      >
        <div
          className="
            liquid-glass
            flex
            flex-wrap
            rounded-full
            border
            border-white/15
            bg-black/80
            p-1.5
            shadow-[0_15px_40px_rgba(0,0,0,0.8)]
            backdrop-blur-xl
          "
        >
          {days.map(([date], index) => (
            <button
              key={date}
              type="button"
              onClick={() => {
                setActiveDay(index);

                document
                  .getElementById(`day-${index}`)
                  ?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  });
              }}
              className={`
                rounded-full
                px-5
                py-2
                font-mono
                text-[10px]
                uppercase
                tracking-[0.2em]
                transition-all
                duration-300
                ${
                  activeDay === index
                    ? "bg-white text-black font-bold shadow-[0_0_15px_rgba(255,255,255,0.4)]"
                    : "text-white/50 hover:text-white"
                }
              `}
            >
              {getDayTabTitle(date, index)}
            </button>
          ))}
        </div>
      </div>

      {/* DAYS */}
      <div className="space-y-32">
        {days.length === 0 ? (
          <div
            className="
              liquid-glass
              rounded-[28px]
              border
              border-white/10
              p-12
              text-center
              text-white
            "
          >
            <p className="text-2xl font-light">
              The schedule is taking shape.
            </p>

            <p className="mt-3 text-sm text-white/50">
              Event timings will appear here as they are officially verified.
            </p>
          </div>
        ) : (
          days.map(([date, dayEvents], index) => (
            <div
              id={`day-${index}`}
              key={date}
              className="scroll-mt-28"
            >
              <DayTimeline
                date={date}
                events={dayEvents}
                dayNumber={index + 1}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}