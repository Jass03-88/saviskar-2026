"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, ArrowUpRight, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

const images = [
  {
    src: "/gallery/crowd.jpg",
    title: "One Stage. Thousands of Stories.",
    category: "Main Stage",
    size: "md:col-span-2 md:row-span-2",
  },
  {
    src: "/gallery/star 2.jpg",
    title: "Live. Loud. Unforgettable.",
    category: "Live",
    size: "md:row-span-2",
  },
  {
    src: "/gallery/star 3.jpg",
    title: "Voices That Stay With You",
    category: "Music",
    size: "",
  },
  {
    src: "/gallery/car show.jpg",
    title: "Built to Turn Heads",
    category: "Showcase",
    size: "",
  },
  {
    src: "/gallery/entry.jpg",
    title: "The Experience Begins",
    category: "Arrivals",
    size: "md:col-span-2",
  },
  {
    src: "/gallery/star 5.jpg",
    title: "Under the Lights",
    category: "Main Stage",
    size: "md:row-span-2",
  },
  {
    src: "/gallery/gate.jpg",
    title: "Welcome to Saviskar",
    category: "Campus",
    size: "",
  },
  {
    src: "/gallery/decor.jpg",
    title: "A Campus Transformed",
    category: "Atmosphere",
    size: "",
  },
  {
    src: "/gallery/car.jpg",
    title: "Machines Meet Culture",
    category: "Showcase",
    size: "md:col-span-2",
  },
  {
    src: "/gallery/registration.jpg",
    title: "Where It All Begins",
    category: "Behind the Scenes",
    size: "",
  },
  {
    src: "/gallery/non tech.jpg",
    title: "Ideas Beyond the Classroom",
    category: "Non-Technical",
    size: "",
  },
  {
    src: "/gallery/dance.jpg",
    title: "Stories in Motion",
    category: "Culture",
    size: "",
  },
  {
    src: "/gallery/flash mob.jpg",
    title: "Move Together",
    category: "Campus",
    size: "md:col-span-2",
  },
  {
    src: "/gallery/gallery-3.jpg",
    title: "When the Night Takes Over",
    category: "Night",
    size: "md:col-span-2",
  },
  {
    src: "/gallery/sports.jpg",
    title: "Play. Push. Win.",
    category: "Sports",
    size: "",
  },
  {
    src: "/gallery/technical.jpg",
    title: "Build. Invent. Compete.",
    category: "Technical",
    size: "",
  },
  {
    src: "/gallery/cultural.jpg",
    title: "Culture Takes the Stage",
    category: "Cultural",
    size: "md:col-span-2",
  },
  {
    src: "/gallery/gallery-2.jpg",
    title: "Create Without Limits",
    category: "Non-Technical",
    size: "",
  },
  {
    src: "/gallery/hero.jpg",
    title: "The Stage Is Yours.",
    category: "Performance",
    size: "md:col-span-2 md:row-span-2",
  },
  {
    src: "/gallery/concert.jpg",
    title: "Made for the Spotlight",
    category: "Concert",
    size: "",
  },
  {
    src: "/gallery/star 1.jpg",
    title: "Every Voice Matters",
    category: "Live",
    size: "md:row-span-2",
  },
  {
    src: "/gallery/star 4.jpg",
    title: "In Her Element",
    category: "Live",
    size: "",
  },
  {
    src: "/gallery/team.jpg",
    title: "People Make the Festival",
    category: "Community",
    size: "md:col-span-2",
  },
  {
    src: "/gallery/gallery-1.jpg",
    title: "This Is Saviskar.",
    category: "Experience",
    size: "md:col-span-2",
  },
];

export default function Gallery() {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const selected =
    selectedIndex !== null ? images[selectedIndex] : null;

  const next = () => {
    setSelectedIndex((current) =>
      current === null ? 0 : (current + 1) % images.length
    );
  };

  const previous = () => {
    setSelectedIndex((current) =>
      current === null
        ? 0
        : (current - 1 + images.length) % images.length
    );
  };

  useEffect(() => {
    if (selectedIndex === null) return;

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedIndex(null);
      if (event.key === "ArrowRight") next();
      if (event.key === "ArrowLeft") previous();
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKey);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKey);
    };
  }, [selectedIndex]);

  return (
    <>
      <section
        id="gallery"
        className="relative overflow-hidden bg-[#f4f4f2] px-5 py-24 text-black md:px-10 md:py-36"
      >
        <div className="mx-auto max-w-[1200px]">

          {/* HEADER */}
          <div className="mb-16 grid gap-10 md:mb-24 md:grid-cols-2 md:items-end">
            <motion.div
              initial={{ opacity: 0, y: 35 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{
                duration: 0.8,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <p className="mb-6 text-[9px] uppercase tracking-[0.3em] text-black/40">
                24 Frames / One Experience
              </p>

              <h2 className="font-serif text-[clamp(3.7rem,8vw,7.5rem)] leading-[0.82] tracking-[-0.06em]">
                You had
                <br />
                to be there.
              </h2>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 25 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: 0.15 }}
              className="md:justify-self-end"
            >
              <p className="max-w-[410px] font-serif text-lg leading-[1.5] text-black/50 md:text-xl">
                The stages, the people, the competition and everything
                in between. Twenty-four frames from an experience that
                was never meant to stand still.
              </p>
            </motion.div>
          </div>

          <div className="mb-4 h-px bg-black/15" />

          {/* GALLERY */}
          <div className="grid auto-flow-dense auto-rows-[260px] grid-cols-1 gap-3 md:grid-cols-3 md:auto-rows-[310px]">
            {images.map((image, index) => (
              <motion.button
                key={image.src}
                type="button"
                onClick={() => setSelectedIndex(index)}
                initial={{ opacity: 0, y: 45, scale: 0.985 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                viewport={{ once: true, amount: 0.1 }}
                transition={{
                  duration: 0.7,
                  delay: Math.min((index % 6) * 0.04, 0.2),
                  ease: [0.22, 1, 0.36, 1],
                }}
                className={`group relative overflow-hidden rounded-[18px] bg-[#111] text-left ${image.size}`}
              >
                <Image
                  src={image.src}
                  alt={image.title}
                  fill
                  unoptimized
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="object-cover transition-transform duration-[1000ms] ease-out group-hover:scale-[1.055]"
                />

                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/5 to-black/10 transition-all duration-500 group-hover:from-black/95" />

                <span className="absolute left-6 top-6 text-[9px] tracking-[0.25em] text-white/60">
                  {String(index + 1).padStart(2, "0")}
                </span>

                <div className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white text-black transition-all duration-500 group-hover:rotate-45 group-hover:scale-110">
                  <ArrowUpRight size={16} strokeWidth={1.5} />
                </div>

                <div className="absolute inset-x-0 bottom-0 translate-y-1 p-6 transition-transform duration-500 group-hover:translate-y-0 md:p-7">
                  <p className="mb-2 text-[8px] uppercase tracking-[0.28em] text-white/50">
                    {image.category}
                  </p>

                  <h3 className="max-w-[440px] font-serif text-[26px] leading-[0.95] tracking-[-0.035em] text-white md:text-[32px]">
                    {image.title}
                  </h3>
                </div>
              </motion.button>
            ))}
          </div>

          {/* END */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="mt-24 grid gap-8 border-t border-black/15 pt-8 md:grid-cols-2"
          >
            <div>
              <p className="text-[9px] uppercase tracking-[0.3em] text-black/35">
                Saviskar
              </p>

              <p className="mt-3 font-serif text-2xl tracking-[-0.03em]">
                Some moments end. The story doesn't.
              </p>
            </div>

            <p className="self-end text-[9px] uppercase tracking-[0.28em] text-black/35 md:text-right">
              CGC University, Mohali
            </p>
          </motion.div>
        </div>
      </section>

      {/* FULLSCREEN VIEWER */}
      <AnimatePresence>
        {selected && selectedIndex !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={() => setSelectedIndex(null)}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95 p-4 md:p-10"
          >
            {/* CLOSE */}
            <button
              type="button"
              onClick={() => setSelectedIndex(null)}
              className="absolute right-5 top-5 z-50 flex h-11 w-11 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-105 md:right-8 md:top-8"
              aria-label="Close gallery"
            >
              <X size={18} />
            </button>

            {/* PREVIOUS */}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                previous();
              }}
              className="absolute left-4 top-1/2 z-50 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-white hover:text-black md:left-8"
              aria-label="Previous image"
            >
              <ArrowLeft size={18} />
            </button>

            {/* NEXT */}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                next();
              }}
              className="absolute right-4 top-1/2 z-50 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-white hover:text-black md:right-8"
              aria-label="Next image"
            >
              <ArrowRight size={18} />
            </button>

            <motion.div
              key={selected.src}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                duration: 0.4,
                ease: [0.22, 1, 0.36, 1],
              }}
              onClick={(event) => event.stopPropagation()}
              className="relative h-[82vh] w-[88vw] max-w-[1350px]"
            >
              <Image
                src={selected.src}
                alt={selected.title}
                fill
                priority
                sizes="100vw"
                className="object-contain"
              />

              <div className="absolute bottom-2 left-2 rounded-xl bg-black/40 px-4 py-3 text-white backdrop-blur-md">
                <p className="mb-1 text-[8px] uppercase tracking-[0.25em] text-white/50">
                  {String(selectedIndex + 1).padStart(2, "0")} / 24
                  {" — "}
                  {selected.category}
                </p>

                <h3 className="font-serif text-xl tracking-[-0.03em] md:text-3xl">
                  {selected.title}
                </h3>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}