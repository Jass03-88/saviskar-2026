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

  const [hourText, minuteText] = value.slice(0, 5).split(":");
  const hour = Number(hourText);
  const minute = minuteText ?? "00";

  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;

  return `${displayHour}:${minute} ${suffix}`;
}

function formatDate(value: string | null) {
  if (!value) return "DATE TBA";

  return new Date(`${value}T00:00:00`)
    .toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
    })
    .toUpperCase();
}

function dayLabel(value: string | null) {
  if (!value) return "DATE TBA";

  return new Date(`${value}T00:00:00`).toLocaleDateString(
    "en-IN",
    {
      weekday: "long",
      day: "numeric",
      month: "long",
    }
  );
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
        <p className="text-[10px] uppercase tracking-[0.25em] text-black/35">
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
            border-black/20
            bg-[#f5f2eb]
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
              bg-black
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
          group
          relative
          mb-8
          w-full
          overflow-hidden
          rounded-[30px]
          border
          border-black/10
          bg-white/75
          p-6
          text-left
          shadow-[0_18px_70px_rgba(0,0,0,0.07)]
          backdrop-blur-xl
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
            opacity-80
            transition-opacity
            duration-500
            group-hover:opacity-100
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
            bg-white/60
            blur-3xl
          "
        />

        <div className="relative">
          {/* TOP META */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-[9px] uppercase tracking-[0.3em] text-black/35">
                {String(index + 1).padStart(2, "0")}
              </span>

              <span
                className="
                  rounded-full
                  border
                  border-black/10
                  px-3
                  py-1
                  text-[8px]
                  uppercase
                  tracking-[0.25em]
                  text-black/45
                "
              >
                {meta.label}
              </span>
            </div>

            <span className="text-[9px] uppercase tracking-[0.25em] text-black/25">
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
                  font-serif
                  text-[clamp(2rem,4vw,4.2rem)]
                  leading-[0.92]
                  tracking-[-0.05em]
                  text-black
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
                  text-black/40
                "
              >
                <span className="flex items-center gap-2">
                  <Clock3 size={12} />
                  {formatTime(event.start_time)}
                </span>

                <span className="flex items-center gap-2">
                  <CalendarDays size={12} />
                  {formatDate(event.event_date)}
                </span>

                {event.venue && (
                  <span className="flex items-center gap-2">
                    <MapPin size={12} />
                    {event.venue}
                  </span>
                )}
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
                border-black/10
                pl-6
                md:pl-8
              "
            >
              <p className="
                mb-3
                text-[9px]
                uppercase
                tracking-[0.3em]
                text-black/30
              ">
                ABOUT THE EVENT
              </p>

              <p className="
                max-w-md
                text-sm
                leading-7
                text-black/55
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
              border-black/10
              pt-5
            "
          >
            <span
              className="
                rounded-full
                bg-black
                px-4
                py-2
                text-[9px]
                uppercase
                tracking-[0.2em]
                text-white
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
                flex
                items-center
                gap-2
                rounded-full
                border
                border-black/10
                px-4
                py-2
                text-[9px]
                uppercase
                tracking-[0.2em]
                text-black/60
                transition-all
                duration-300
                hover:bg-black
                hover:text-white
              "
            >
              Explore Event
              <ArrowUpRight size={12} />
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
              text-[10px]
              uppercase
              tracking-[0.35em]
              text-black/35
            "
          >
            DAY {String(dayNumber).padStart(2, "0")}
          </p>

          <p
            className="
              mt-2
              font-serif
              text-2xl
              tracking-[-0.04em]
            "
          >
            {dayLabel(date)}
          </p>
        </div>

        <div className="h-px bg-black/10" />
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
            bg-black/10
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
            bg-black
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
  /*
   * Events are automatically sorted by:
   * 1. Event date
   * 2. Start time
   *
   * So when you add events in the admin panel/database,
   * the schedule automatically places them chronologically.
   */
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

        return (a.start_time ?? "99:99").localeCompare(
          b.start_time ?? "99:99"
        );
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
            flex
            rounded-full
            border
            border-black/10
            bg-white/75
            p-1
            shadow-lg
            shadow-black/5
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
                text-[9px]
                uppercase
                tracking-[0.22em]
                transition-all
                duration-300
                ${
                  activeDay === index
                    ? "bg-black text-white"
                    : "text-black/45 hover:text-black"
                }
              `}
            >
              DAY {String(index + 1).padStart(2, "0")}
            </button>
          ))}
        </div>
      </div>

      {/* DAYS */}
      <div className="space-y-32">
        {days.length === 0 ? (
          <div
            className="
              rounded-[30px]
              border
              border-black/10
              bg-white/70
              p-12
              text-center
            "
          >
            <p className="font-serif text-3xl">
              The schedule is taking shape.
            </p>

            <p className="mt-3 text-sm text-black/45">
              Event timings will appear here as they are added.
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