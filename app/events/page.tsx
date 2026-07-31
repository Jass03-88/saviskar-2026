import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";

const categories = [
  {
    number: "01",
    title: "Technical",
    description:
      "Code, build, innovate and compete through technology-driven challenges.",
    image: "/images/technical.jpg",
  },
  {
    number: "02",
    title: "Cultural",
    description:
      "Music, dance, theatre and performances that take over the Saviskar stage.",
    image: "/images/cultural.jpg",
  },
  {
    number: "03",
    title: "Sports",
    description:
      "Competition beyond the stage. Play hard, push limits and represent your team.",
    image: "/images/sports.jpg",
  },
  {
    number: "04",
    title: "Non-Technical",
    description:
      "Creativity, strategy, expression and experiences beyond the conventional.",
    image: "/images/gallery-2.jpg",
  },
];

export default function EventsPage() {
  return (
    <main className="min-h-screen bg-black text-white">

      {/* HEADER */}

      <header className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-8 md:px-10">

        <Link
          href="/"
          className="flex items-center gap-2 text-sm text-white/50 transition hover:text-white"
        >
          <ArrowLeft size={15} />
          Saviskar
        </Link>

        <span className="text-sm font-semibold">
          EVENTS
        </span>

        <Link
          href="/register"
          className="text-sm text-white/50 transition hover:text-white"
        >
          Register
        </Link>

      </header>


      {/* HERO */}

      <section className="mx-auto max-w-[1400px] px-6 pb-28 pt-24 md:px-10 md:pb-40 md:pt-36">

        <p className="mb-8 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/35">
          Saviskar 2026
        </p>

        <h1 className="max-w-[1100px] text-[clamp(5rem,13vw,13rem)] font-semibold leading-[0.78] tracking-[-0.075em]">
          Choose
          <br />
          your arena.
        </h1>

        <div className="mt-16 flex justify-end">
          <p className="max-w-md text-base leading-7 text-white/40">
            Technology. Performance. Creativity. Competition.
            Find where you belong and step into Saviskar.
          </p>
        </div>

      </section>


      {/* EVENT CATEGORIES */}

      <section className="mx-auto max-w-[1400px] px-4 pb-32 md:px-8">

        {categories.map((category) => (

          <Link
            href={`/events/${category.title.toLowerCase()}`}
            key={category.title}
            className="group relative mb-4 block h-[420px] overflow-hidden rounded-[28px] md:h-[620px]"
          >

            <img
              src={category.image}
              alt={category.title}
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-1000 ease-out group-hover:scale-[1.035]"
            />

            <div className="absolute inset-0 bg-black/35 transition group-hover:bg-black/25" />

            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between p-7 md:p-10">

              <div>

                <span className="mb-4 block text-xs text-white/45">
                  {category.number}
                </span>

                <h2 className="text-[clamp(3rem,7vw,7rem)] font-semibold leading-none tracking-[-0.06em]">
                  {category.title}
                </h2>

                <p className="mt-4 max-w-md text-sm leading-6 text-white/55">
                  {category.description}
                </p>

              </div>

              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-black transition duration-300 group-hover:scale-110 md:h-14 md:w-14">

                <ArrowUpRight size={20} />

              </div>

            </div>

          </Link>

        ))}

      </section>

    </main>
  );
}