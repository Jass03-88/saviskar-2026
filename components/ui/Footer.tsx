"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Mail, Phone, X, MapPin } from "lucide-react";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { createPortal } from "react-dom";

export default function Footer() {
  const [contactOpen, setContactOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll and handle Escape key when contact modal is active
  useEffect(() => {
    if (!contactOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContactOpen(false);
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contactOpen]);

  return (
    <>
      <motion.footer
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.05 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 border-t border-white/10 bg-neutral-950/90 backdrop-blur-2xl text-white px-5 py-12 sm:px-8 sm:py-16 md:px-12 md:py-20"
      >
        {/* Ambient Stadium Fireworks Subtle Backdrop */}
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="relative h-full w-full">
            <Image
              src="/images/scene-finale-celebration.webp"
              alt="Saviskar 2026 Concert Stadium Celebration Continuation"
              fill
              sizes="100vw"
              className="object-cover object-bottom opacity-15"
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-neutral-950 via-neutral-950/90 to-neutral-950 pointer-events-none" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(168,85,247,0.12)_0%,transparent_70%)] pointer-events-none" />
        </div>

        <div className="relative z-10 mx-auto max-w-[1400px]">
          {/* Main Footer Grid */}
          <div className="flex flex-col gap-12 border-b border-white/10 pb-16 lg:flex-row lg:items-start lg:justify-between">
            {/* Brand & Mission Column */}
            <div className="max-w-md">
              <div className="flex items-center gap-2.5 text-2xl font-bold tracking-[0.15em] text-white">
                <span className="h-2.5 w-2.5 rounded-full bg-violet-400 shadow-[0_0_12px_rgba(168,85,247,1)]" />
                SAVISKAR 2026
              </div>

              <p className="mt-4 text-sm leading-relaxed text-zinc-300">
                North India&apos;s flagship Annual National Techno-Cultural University Festival at CGC University, Mohali. Born from the roots of Srijan and Avishkar, uniting 35,000+ creators across 500+ colleges under Aevorian Reverie.
              </p>

              <div className="mt-6 flex flex-col gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-3.5 backdrop-blur-md">
                <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-violet-400 font-semibold">
                  Theme: Aevorian Reverie
                </span>
                <span className="text-xs text-zinc-400 italic">
                  Where Tomorrow Dreams Awake • &ldquo;A future imagined so vividly, it begins to exist.&rdquo;
                </span>
              </div>
            </div>

            {/* Organized Navigation Columns */}
            <div className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 sm:gap-x-12 lg:gap-x-16">
              {/* Column 1: Explore */}
              <div className="flex flex-col gap-3">
                <h3 className="font-mono text-xs uppercase tracking-[0.25em] text-violet-400 font-semibold mb-1">
                  Explore
                </h3>
                <Link
                  href="/#about"
                  className="text-sm text-zinc-400 transition-colors hover:text-white"
                >
                  About Festival
                </Link>
                <Link
                  href="/events"
                  className="text-sm text-zinc-400 transition-colors hover:text-white"
                >
                  Realms & Events
                </Link>
                <Link
                  href="/starnight"
                  className="text-sm text-zinc-400 transition-colors hover:text-white"
                >
                  Star Night
                </Link>
                <Link
                  href="/gallery"
                  className="text-sm text-zinc-400 transition-colors hover:text-white"
                >
                  Photo Gallery
                </Link>
                <Link
                  href="/schedule"
                  className="text-sm text-zinc-400 transition-colors hover:text-white"
                >
                  Festival Schedule
                </Link>
                <Link
                  href="/sponsors"
                  className="text-sm text-zinc-400 transition-colors hover:text-white"
                >
                  Our Sponsors
                </Link>
              </div>

              {/* Column 2: Participate */}
              <div className="flex flex-col gap-3">
                <h3 className="font-mono text-xs uppercase tracking-[0.25em] text-violet-400 font-semibold mb-1">
                  Participate
                </h3>
                <Link
                  href="/register"
                  className="text-sm font-medium text-violet-300 transition-colors hover:text-white flex items-center gap-1"
                >
                  <span>Register Online</span>
                  <ArrowUpRight size={13} className="opacity-70" />
                </Link>
                <Link
                  href="/events"
                  className="text-sm text-zinc-400 transition-colors hover:text-white flex items-center gap-1"
                >
                  <span>Event Rulebooks</span>
                  <ArrowUpRight size={13} className="opacity-70" />
                </Link>
                <Link
                  href="/team"
                  className="text-sm text-zinc-400 transition-colors hover:text-white"
                >
                  Organising Team (SAC)
                </Link>
                <Link
                  href="/#gallery"
                  className="text-sm text-zinc-400 transition-colors hover:text-white"
                >
                  Glimpse Dome
                </Link>
              </div>

              {/* Column 3: Help & Connect */}
              <div className="flex flex-col gap-3">
                <h3 className="font-mono text-xs uppercase tracking-[0.25em] text-violet-400 font-semibold mb-1">
                  Connect & Help
                </h3>

                {/* Primary Interactive Contact Button */}
                <button
                  type="button"
                  onClick={() => setContactOpen(true)}
                  className="inline-flex items-center justify-between gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3.5 py-2 text-xs font-semibold text-violet-300 backdrop-blur-md transition-all hover:border-violet-400 hover:bg-violet-500/20 hover:text-white hover:shadow-[0_0_20px_rgba(168,85,247,0.3)] active:scale-95 cursor-pointer text-left w-fit mb-1"
                >
                  <span className="flex items-center gap-2">
                    <Phone size={13} className="text-violet-400" />
                    <span>Contact Team</span>
                  </span>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                </button>

                <a
                  href="https://www.instagram.com/saviskar.cgcuniversity/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-zinc-400 transition-colors hover:text-white flex items-center gap-1"
                >
                  <span>Instagram</span>
                  <ArrowUpRight size={13} className="opacity-70" />
                </a>

                <a
                  href="https://www.youtube.com/@SaviskarCGCU"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-zinc-400 transition-colors hover:text-white flex items-center gap-1"
                >
                  <span>YouTube</span>
                  <ArrowUpRight size={13} className="opacity-70" />
                </a>

                <a
                  href="https://www.linkedin.com/company/cgcuniversitymohali/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-zinc-400 transition-colors hover:text-white flex items-center gap-1"
                >
                  <span>LinkedIn</span>
                  <ArrowUpRight size={13} className="opacity-70" />
                </a>

                <a
                  href="mailto:saviskar@cgcuniversity.in"
                  className="text-sm text-zinc-400 transition-colors hover:text-white flex items-center gap-1"
                >
                  <span>Email Helpline</span>
                  <ArrowUpRight size={13} className="opacity-70" />
                </a>
              </div>
            </div>
          </div>

          {/* Bottom Bar: Address, Copyright & Creator Credits */}
          <div className="flex flex-col gap-6 pt-8 text-xs text-zinc-400 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-2 max-w-lg">
              <MapPin size={15} className="text-violet-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-zinc-200">CGC University, Mohali</p>
                <p className="mt-0.5 text-[11px] text-zinc-400">
                  State Highway 12A, Chandigarh-Sirhind Road, Sahibzada Ajit Singh Nagar, Punjab 140307
                </p>
              </div>
            </div>

            <div className="flex flex-col items-start gap-1.5 md:items-end">
              <p className="font-mono text-[11px] tracking-wider text-zinc-400">
                © 2026 SAVISKAR • CGC UNIVERSITY MOHALI • ALL RIGHTS RESERVED
              </p>
              <p className="text-[11px] text-zinc-300 flex items-center gap-1">
                <span>Made by</span>
                <a
                  href="https://www.amadhav.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-violet-300 transition-colors hover:text-white underline underline-offset-2 inline-flex items-center gap-0.5"
                >
                  <span>Madhav Vashisht</span>
                  <ArrowUpRight size={11} className="inline opacity-70" />
                </a>
              </p>
            </div>
          </div>
        </div>
      </motion.footer>

      {/* Official Helpline Modal Rendered Directly via Portal (Eliminates Container Trapping) */}
      {mounted &&
        createPortal(
          <AnimatePresence>
            {contactOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/85 p-4 sm:p-6 backdrop-blur-xl"
                onClick={() => setContactOpen(false)}
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.92, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.94, y: 15 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="relative max-h-[90vh] overflow-y-auto w-full max-w-lg rounded-[28px] sm:rounded-[32px] border border-white/20 bg-neutral-950 p-6 sm:p-8 text-white shadow-[0_25px_80px_rgba(0,0,0,0.95),0_0_50px_rgba(168,85,247,0.25)] md:p-9 scrollbar-thin scrollbar-thumb-white/10"
                  onClick={(event) => event.stopPropagation()}
                >
                  {/* Close Button */}
                  <button
                    type="button"
                    onClick={() => setContactOpen(false)}
                    className="absolute right-4 top-4 sm:right-6 sm:top-6 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/80 transition-all hover:bg-white/20 hover:text-white hover:scale-105 active:scale-95 cursor-pointer"
                    aria-label="Close contact modal"
                  >
                    <X size={16} />
                  </button>

                  <p className="text-[10px] uppercase font-mono tracking-[0.3em] text-violet-400 font-semibold">
                    CGC UNIVERSITY • MOHALI
                  </p>

                  <h2 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-white">
                    Official <span className="text-violet-300 font-serif italic">Helpline</span>
                  </h2>

                  <p className="mt-2 text-xs sm:text-sm leading-relaxed text-zinc-300">
                    Have questions regarding event registrations, university delegations, schedules, or campus venue? Contact our student coordinators directly.
                  </p>

                  {/* Contact Channels Grid */}
                  <div className="mt-6 space-y-3">
                    {/* Official Email */}
                    <a
                      href="mailto:saviskar@cgcuniversity.in"
                      className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition-all hover:border-violet-500/50 hover:bg-violet-950/20 group"
                    >
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300 group-hover:scale-110 transition-transform">
                        <Mail size={19} />
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-400 font-mono">
                          Official Email
                        </p>
                        <p className="mt-0.5 text-sm font-semibold text-white group-hover:text-violet-200 transition-colors">
                          saviskar@cgcuniversity.in
                        </p>
                      </div>
                    </a>

                    {/* Phone Desks Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Convenor Desk */}
                      <a
                        href="tel:+917667340235"
                        className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 transition-all hover:border-violet-500/50 hover:bg-violet-950/20 group"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300 group-hover:scale-110 transition-transform">
                          <Phone size={16} />
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-[0.2em] text-zinc-400 font-mono">
                            Convenor Desk
                          </p>
                          <p className="mt-0.5 text-xs font-semibold text-white group-hover:text-violet-200 transition-colors">
                            +91 76673 40235
                          </p>
                        </div>
                      </a>

                      {/* Technical & Realm Ops */}
                      <a
                        href="tel:+916280039126"
                        className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 transition-all hover:border-violet-500/50 hover:bg-violet-950/20 group"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300 group-hover:scale-110 transition-transform">
                          <Phone size={16} />
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-[0.2em] text-zinc-400 font-mono">
                            Technical & Realms
                          </p>
                          <p className="mt-0.5 text-xs font-semibold text-white group-hover:text-violet-200 transition-colors">
                            +91 62800 39126
                          </p>
                        </div>
                      </a>

                      {/* Hospitality Desk */}
                      <a
                        href="tel:+917347250314"
                        className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 transition-all hover:border-violet-500/50 hover:bg-violet-950/20 group"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300 group-hover:scale-110 transition-transform">
                          <Phone size={16} />
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-[0.2em] text-zinc-400 font-mono">
                            Hospitality Desk
                          </p>
                          <p className="mt-0.5 text-xs font-semibold text-white group-hover:text-violet-200 transition-colors">
                            +91 73472 50314
                          </p>
                        </div>
                      </a>

                      {/* Registrations */}
                      <a
                        href="tel:+918572815510"
                        className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 transition-all hover:border-violet-500/50 hover:bg-violet-950/20 group"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300 group-hover:scale-110 transition-transform">
                          <Phone size={16} />
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-[0.2em] text-zinc-400 font-mono">
                            Registrations Desk
                          </p>
                          <p className="mt-0.5 text-xs font-semibold text-white group-hover:text-violet-200 transition-colors">
                            +91 85728 15510
                          </p>
                        </div>
                      </a>
                    </div>
                  </div>

                  {/* Campus Venue Footnote */}
                  <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-center text-[11px] text-zinc-400">
                    Campus Venue: CGC University, Sector 112, Landran, Mohali, Punjab - 140307, India
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}