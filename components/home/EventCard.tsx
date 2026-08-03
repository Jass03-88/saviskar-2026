"use client";

import Image from "next/image";
import Link from "next/link";
import {
  motion,
  useMotionValue,
  useMotionTemplate,
  useSpring,
} from "motion/react";
import { ArrowUpRight } from "lucide-react";

type Event = {
  number: string;
  title: string;
  slug: string;
  subtitle: string;
  description: string;
  image: string;
};

interface Props {
  event: Event;
  index: number;
  ease: readonly [number, number, number, number];
}

export default function EventCard({
  event,
  index,
  ease,
}: Props) {
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const springX = useSpring(rotateX, {
    stiffness: 250,
    damping: 25,
  });

  const springY = useSpring(rotateY, {
    stiffness: 250,
    damping: 25,
  });

  const spotlight = useMotionTemplate`
    radial-gradient(
      260px circle at ${mouseX}px ${mouseY}px,
      rgba(138,46,255,.22),
      rgba(138,46,255,.08) 45%,
      transparent 72%
    )
  `;

  function handleMove(
    e: React.MouseEvent<HTMLAnchorElement>
  ) {
    const rect =
      e.currentTarget.getBoundingClientRect();

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    mouseX.set(x);
    mouseY.set(y);

    const rx =
      ((y - rect.height / 2) / rect.height) * -8;

    const ry =
      ((x - rect.width / 2) / rect.width) * 8;

    rotateX.set(rx);
    rotateY.set(ry);
  }

  function reset() {
    rotateX.set(0);
    rotateY.set(0);
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: 55 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{
        duration: .8,
        delay: index * .08,
        ease,
      }}
      style={{
        rotateX: springX,
        rotateY: springY,
        transformPerspective: 1400,
        transformStyle: "preserve-3d",
      }}
    >
      <Link
        href={`/events/${event.slug}`}
        onMouseMove={handleMove}
        onMouseLeave={reset}
        className="
          group
          relative
          block
          h-[520px]
          overflow-hidden
          rounded-[28px]
          bg-black
          md:h-[690px]
        "
      >
        <Image
          src={event.image}
          alt={event.title}
          fill
          className="
            object-cover
            transition-transform
            duration-[1200ms]
            ease-out
            group-hover:scale-110
          "
        />

        <motion.div
          style={{
            background: spotlight,
          }}
          className="
            absolute
            inset-0
            opacity-0
            transition-opacity
            duration-300
            group-hover:opacity-100
          "
        />

        <div
          className="
            absolute
            inset-0
            rounded-[28px]
            border
            border-white/10
            transition-all
            duration-500
            group-hover:border-[#8A2EFF]/50
            group-hover:shadow-[inset_0_0_80px_rgba(138,46,255,.18)]
          "
        />

        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent"/>

        <div className="absolute top-8 left-8 right-8 flex justify-between">

          <span className="text-white/55 text-xs tracking-[.25em]">
            {event.number}
          </span>

          <motion.span
            whileHover={{ scale: 1.08 }}
            className="
              rounded-full
              border
              border-white/20
              bg-white/10
              px-3
              py-1.5
              text-[10px]
              uppercase
              backdrop-blur-xl
              text-white/75
            "
          >
            Arena
          </motion.span>

        </div>

        <div className="absolute bottom-0 w-full p-8 text-white">

          <p className="mb-3 text-sm text-white/55">
            {event.subtitle}
          </p>

          <div className="flex items-end justify-between">

            <h3
              className="
                font-serif
                text-[clamp(3rem,5vw,5.7rem)]
                leading-none
                tracking-[-.06em]
              "
            >
              {event.title}
            </h3>

            <motion.div
              whileHover={{
                rotate: 315,
                scale: 1.18,
              }}
              className="
                flex
                h-14
                w-14
                items-center
                justify-center
                rounded-full
                bg-white
                text-black
              "
            >
              <ArrowUpRight size={20}/>
            </motion.div>

          </div>

          <motion.div
            initial={false}
            className="
              mt-6
              overflow-hidden
              max-h-0
              group-hover:max-h-32
              transition-all
              duration-500
            "
          >
            <p
              className="
                border-t
                border-white/20
                pt-5
                text-sm
                leading-6
                text-white/65
              "
            >
              {event.description}
            </p>
          </motion.div>

        </div>
      </Link>
    </motion.article>
  );
}