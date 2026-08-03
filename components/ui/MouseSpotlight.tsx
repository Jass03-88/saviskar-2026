"use client";

import { motion, useMotionValue, useSpring } from "motion/react";
import { useEffect } from "react";

export default function MouseSpotlight() {
  const mx = useMotionValue(-300);
  const my = useMotionValue(-300);

  const x = useSpring(mx,{stiffness:120,damping:22,mass:0.3});
  const y = useSpring(my,{stiffness:120,damping:22,mass:0.3});

  useEffect(()=>{
    const move=(e:MouseEvent)=>{
      mx.set(e.clientX-260);
      my.set(e.clientY-260);
    };
    window.addEventListener("mousemove",move,{passive:true});
    return ()=>window.removeEventListener("mousemove",move);
  },[mx,my]);

  return (
    <motion.div
      aria-hidden
      style={{x,y}}
      className="pointer-events-none fixed left-0 top-0 z-0 h-[520px] w-[520px] rounded-full opacity-60"
    >
      <div className="h-full w-full rounded-full bg-[radial-gradient(circle,rgba(138,46,255,0.18)_0%,rgba(138,46,255,0.08)_35%,transparent_72%)] blur-3xl"/>
    </motion.div>
  );
}