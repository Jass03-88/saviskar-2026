"use client";

import { motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
export default function RegisterCTA() {
  return (
    <section
      id="register"
      className="flex min-h-[85vh] items-center bg-[#f5f5f7] px-6 py-24 text-black md:px-10"
    >
      <div className="mx-auto w-full max-w-[1200px]">
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-8 text-[11px] font-semibold uppercase tracking-[0.2em] text-black/40"
        >
          Saviskar 2026
        </motion.p>

        <motion.h2
          initial={{ opacity: 0, y: 50 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{
            duration: 1,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="max-w-[1000px] text-[clamp(4rem,9vw,9rem)] font-semibold leading-[0.86] tracking-[-0.07em]"
        >
          This time,
          <br />
          be in it.
        </motion.h2>

        <div className="mt-14 flex flex-col gap-8 border-t border-black/10 pt-8 md:flex-row md:items-center md:justify-between">
          <p className="max-w-md text-base leading-7 text-black/45">
            Compete. Perform. Build. Create.
            <br />
            Your Saviskar story starts here.
          </p>

          <Link
  href="/register"
  className="flex items-center gap-2 rounded-full bg-black px-7 py-4 text-sm font-medium text-white transition-transform hover:scale-[1.03]"
>
  Register for Saviskar
  <ArrowUpRight size={15} />
</Link>
        </div>
      </div>
    </section>
  );
}