"use client";

import { motion } from "motion/react";

type BlurTextProps = {
  text: string;
  className?: string;
  delay?: number;
};

export default function BlurText({
  text,
  className = "",
  delay = 0,
}: BlurTextProps) {
  return (
    <span className={`inline-flex flex-wrap ${className}`} aria-label={text}>
      {text.split(" ").map((word, index) => (
        <motion.span
          key={`${word}-${index}`}
          initial={{ opacity: 0, filter: "blur(12px)", y: 18 }}
          whileInView={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{
            duration: 0.65,
            delay: delay + index * 0.055,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="mr-[0.25em] inline-block"
        >
          {word}
        </motion.span>
      ))}
    </span>
  );
}
