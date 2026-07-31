import Link from "next/link";
import { notFound } from "next/navigation";
import {
  
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  MapPin,
  Users,
  Trophy,
} from "lucide-react";
import Image from "next/image";
import { supabase } from "@/lib/supabase";

export default async function EventPage({
  params,
}: {
  params: Promise<{
    category: string;
    event: string;
  }>;
}) {
  const { category, event } = await params;

  // Fetch event directly from Supabase
  const { data: currentEvent, error } = await supabase
    .from("events")
    .select("*")
    .eq("category", category)
    .eq("slug", event)
    .eq("active", true)
    .single();

  if (error || !currentEvent) {
    console.error("EVENT FETCH ERROR:", error);
    notFound();
  }

  const formattedDate = currentEvent.event_date
    ? new Date(`${currentEvent.event_date}T00:00:00`).toLocaleDateString(
        "en-IN",
        {
          day: "numeric",
          month: "long",
          year: "numeric",
        }
      )
    : "To be announced";

  const teamDetails =
    currentEvent.registration_type === "team"
      ? currentEvent.min_team_size && currentEvent.max_team_size
        ? `${currentEvent.min_team_size}–${currentEvent.max_team_size} members`
        : "Team event"
      : "Individual";

const eventHeroImages: Record<string, string> = {
  hackathon: "/gallery/technical.jpg",
  roborace: "/gallery/technical.jpg",
  dronathon: "/gallery/technical.jpg",

  dance: "/gallery/cultural.jpg",
  singing: "/gallery/cultural.jpg",

  sports: "/gallery/sports.jpg",

  default: "/gallery/hero.jpg",
};

const heroImage =
  eventHeroImages[currentEvent.slug] ??
  eventHeroImages.default;
  return (
    <main className="min-h-screen bg-black text-white">

      {/* HERO */}
      <section className="relative flex min-h-screen flex-col">
{/* Hero background image */}
<div className="absolute inset-0 overflow-hidden">
  <Image
    src={heroImage}
    alt={currentEvent.name}
    fill
    priority
    className="object-cover scale-110 animate-[slowZoom_20s_linear_infinite_alternate]"
  />
<div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/35 to-transparent" />
  <div className="absolute inset-0 bg-black/72" />
  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-black/10" />
</div>
        {/* Subtle background glow */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[80vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.035] blur-[130px]" />

        {/* Top navigation */}
        <div className="relative z-10 mx-auto flex w-full max-w-[1400px] items-center justify-between px-6 py-8 md:px-10">

          <Link
            href={`/events/${category}`}
            className="flex items-center gap-2 text-sm text-white/50 transition hover:text-white"
          >
            <ArrowLeft size={15} />
            {formatCategory(category)}
          </Link>

          <span className="text-[10px] font-medium uppercase tracking-[0.25em] text-white/35">
            Saviskar 2026
          </span>

        </div>

        {/* Hero content */}
        <div className="relative z-10 mx-auto flex w-full max-w-[1400px] flex-1 flex-col justify-center px-6 py-20 md:px-10">

          <div className="max-w-[1200px]">

            <p className="mb-7 text-[11px] font-medium uppercase tracking-[0.25em] text-white/35">
              {formatCategory(category)} Event
            </p>

            <div className="inline-block rounded-3xl border border-white/10 bg-black/25 backdrop-blur-xl px-8 py-5 shadow-2xl">
  <h1 className="text-6xl md:text-8xl font-semibold tracking-tight text-white">
    {currentEvent.name}
  </h1>
</div>

            {currentEvent.description && (
              <div className="mt-10 max-w-2xl rounded-3xl border border-white/10 bg-black/25 backdrop-blur-xl p-8 shadow-2xl">

  <p className="text-lg leading-8 text-white/80">
    {currentEvent.description}
  </p>

</div>
            )}

          </div>

        </div>

        {/* Hero bottom */}
        <div className="relative z-10 mx-auto w-full max-w-[1400px] px-6 pb-10 md:px-10">

          <div className="flex flex-col gap-7 border-t border-white/15 pt-7 md:flex-row md:items-center md:justify-between">

            <div className="flex flex-wrap gap-x-8 gap-y-4 text-sm text-white/45">

              <div className="flex items-center gap-2">
                <CalendarDays size={15} />
                {formattedDate}
              </div>

              <div className="flex items-center gap-2">
                <MapPin size={15} />
                {currentEvent.venue || "CGC University, Mohali"}
              </div>

            </div>

            {currentEvent.registration_open ? (
              <a
                href="#register"
                className="flex w-fit items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.03]"
              >
                Register
                <ArrowUpRight size={15} />
              </a>
            ) : (
              <span className="rounded-full border border-white/15 px-6 py-3 text-sm text-white/40">
                Registration closed
              </span>
            )}

          </div>

        </div>

      </section>

      {/* DETAILS */}
      <section className="bg-[#f5f5f7] px-6 py-28 text-black md:px-10 md:py-40">

        <div className="mx-auto max-w-[1200px]">

          <p className="mb-7 text-[11px] font-semibold uppercase tracking-[0.22em] text-black/35">
            About the event
          </p>

          <div className="grid gap-14 md:grid-cols-[1.3fr_0.7fr] md:gap-24">

            <div>

              <h2 className="text-[clamp(3rem,6vw,6rem)] font-semibold leading-[0.9] tracking-[-0.06em]">
                Ready for the
                <br />
                challenge?
              </h2>

              <p className="mt-10 max-w-2xl text-base leading-7 text-black/50 md:text-lg md:leading-8">
                {currentEvent.description ||
                  "Full event details, eligibility, competition format and official rules will be available here."}
              </p>

            </div>

            {/* Quick information */}
            <div className="border-t border-black/10">

              <InfoRow
                icon={<Users size={17} />}
                label="Team"
                value={teamDetails}
              />

              <InfoRow
                icon={<Trophy size={17} />}
                label="Registration"
                value={
                  currentEvent.registration_open
                    ? "Open"
                    : "Closed"
                }
              />

              <InfoRow
                icon={<CalendarDays size={17} />}
                label="Date"
                value={formattedDate}
              />

              {currentEvent.start_time && (
                <InfoRow
                  icon={<CalendarDays size={17} />}
                  label="Time"
                  value={formatTime(currentEvent.start_time)}
                />
              )}

              <InfoRow
                icon={<MapPin size={17} />}
                label="Venue"
                value={
                  currentEvent.venue ||
                  "CGC University, Mohali"
                }
              />

            </div>

          </div>

        </div>

      </section>

      {/* RULES */}
      <section className="bg-white px-6 py-28 text-black md:px-10 md:py-40">

        <div className="mx-auto max-w-[1200px]">

          <div className="grid gap-12 md:grid-cols-2">

            <div>

              <p className="mb-6 text-[11px] font-semibold uppercase tracking-[0.22em] text-black/35">
                Before you compete
              </p>

              <h2 className="text-[clamp(3rem,6vw,6rem)] font-semibold leading-[0.9] tracking-[-0.06em]">
                Know the
                <br />
                rules.
              </h2>

            </div>

            <div className="flex flex-col justify-end">

              <p className="max-w-lg text-base leading-7 text-black/45">
                Official eligibility requirements, competition rules,
                judging criteria and event-specific instructions will be
                published here.
              </p>

              <button
                disabled
                className="mt-8 flex w-fit cursor-not-allowed items-center gap-2 rounded-full border border-black/15 px-6 py-3 text-sm text-black/35"
              >
                Rulebook coming soon
              </button>

            </div>

          </div>

        </div>

      </section>

      {/* REGISTRATION CTA */}
      <section
        id="register"
        className="bg-black px-6 py-28 text-white md:px-10 md:py-40"
      >

        <div className="mx-auto max-w-[1200px]">

          <p className="mb-7 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/35">
            Registration
          </p>

          <h2 className="max-w-[1000px] text-[clamp(3.5rem,8vw,8rem)] font-semibold leading-[0.86] tracking-[-0.07em]">
            Think you
            <br />
            have what it takes?
          </h2>

          <div className="mt-14 flex flex-col gap-8 border-t border-white/15 pt-8 md:flex-row md:items-center md:justify-between">

            {currentEvent.registration_open ? (
              <>
                <p className="max-w-md text-sm leading-6 text-white/40 md:text-base">
                  Register for {currentEvent.name} and become part of
                  Saviskar 2026.
                </p>

                <Link
                  href={`/register?event=${currentEvent.id}`}
                  className="flex w-fit items-center gap-2 rounded-full bg-white px-7 py-4 text-sm font-medium text-black transition-transform hover:scale-[1.03]"
                >
                  Register for {currentEvent.name}
                  <ArrowUpRight size={15} />
                </Link>
              </>
            ) : (
              <>
                <p className="max-w-md text-sm leading-6 text-white/40 md:text-base">
                  Registration for {currentEvent.name} is currently closed.
                </p>

                <span className="rounded-full border border-white/15 px-7 py-4 text-sm text-white/40">
                  Registration closed
                </span>
              </>
            )}

          </div>

        </div>

      </section>

    </main>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-5 border-b border-black/10 py-6">

      <div className="flex items-center gap-3 text-black/40">
        {icon}

        <span className="text-sm">
          {label}
        </span>
      </div>

      <span className="text-right text-sm font-medium">
        {value}
      </span>

    </div>
  );
}

function formatCategory(category: string) {
  return category
    .split("-")
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1)
    )
    .join(" ");
}

function formatTime(time: string) {
  const [hours, minutes] = time.split(":");

  const date = new Date();
  date.setHours(Number(hours));
  date.setMinutes(Number(minutes));

  return date.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}