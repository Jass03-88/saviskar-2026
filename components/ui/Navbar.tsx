"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowUpRight, Menu, X } from "lucide-react";

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      // Switch after leaving most of the black hero
      const switchPoint = window.innerHeight * 0.72;
      setScrolled(window.scrollY > switchPoint);
    };

    handleScroll();

    window.addEventListener("scroll", handleScroll, {
      passive: true,
    });

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navItems = [
    { label: "About", href: "#about" },
    { label: "Events", href: "#events" },
    { label: "Gallery", href: "#gallery" },
    { label: "Schedule", href: "#schedule" },
  ];

  return (
    <>
      <motion.nav
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.2 }}
        className="fixed left-0 top-0 z-50 w-full px-3 pt-3 md:px-6"
      >
        <div
          className={`
            mx-auto max-w-[1200px]
            rounded-[24px]
            border
            transition-all
            duration-500
            ${
              scrolled
                ? `
                  border-black/10
                  bg-white/75
                  text-black
                  shadow-[0_8px_40px_rgba(0,0,0,0.08)]
                  backdrop-blur-xl
                `
                : `
                  border-white/10
                  bg-black/20
                  text-white
                  shadow-[0_8px_40px_rgba(0,0,0,0.12)]
                  backdrop-blur-xl
                `
            }
          `}
        >
          <div className="flex h-[64px] items-center justify-between px-5 md:px-7">
            {/* Logo */}
            <Link
              href="/"
              className="relative z-50 font-serif text-[17px] font-semibold tracking-[-0.04em]"
            >
              SAVISKAR
            </Link>

            {/* Desktop Navigation */}
            <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 md:flex">
              {navItems.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`
                    text-[13px]
                    transition-colors
                    duration-300
                    ${
                      scrolled
                        ? "text-black/55 hover:text-black"
                        : "text-white/55 hover:text-white"
                    }
                  `}
                >
                  {item.label}
                </Link>
              ))}
            </div>

            {/* Register */}
            <Link
              href="/register"
              className={`
                hidden items-center gap-1.5
                text-[13px] font-medium
                transition-colors duration-300
                md:flex
                ${
                  scrolled
                    ? "text-black hover:text-black/60"
                    : "text-white hover:text-white/60"
                }
              `}
            >
              Register
              <ArrowUpRight size={14} strokeWidth={1.6} />
            </Link>

            {/* Mobile Menu Button */}
            <button
              type="button"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              onClick={() => setMenuOpen((prev) => !prev)}
              className="relative z-50 flex h-9 w-9 items-center justify-center md:hidden"
            >
              {menuOpen ? (
                <X size={20} strokeWidth={1.5} />
              ) : (
                <Menu size={20} strokeWidth={1.5} />
              )}
            </button>
          </div>
        </div>
      </motion.nav>

      {/* Mobile Menu */}
      <div
        className={`
          fixed inset-0 z-40
          transition-all duration-500
          md:hidden
          ${
            menuOpen
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none opacity-0"
          }
        `}
      >
        {/* Background */}
        <div
          className={`
            absolute inset-0 backdrop-blur-2xl
            transition-colors duration-500
            ${
              scrolled
                ? "bg-white/95 text-black"
                : "bg-black/95 text-white"
            }
          `}
        />

        <div className="relative flex h-full flex-col px-7 pb-10 pt-32">
          {/* Navigation */}
          <div className="flex flex-1 flex-col">
            {navItems.map((item, index) => (
              <motion.div
                key={item.label}
                initial={false}
                animate={
                  menuOpen
                    ? { opacity: 1, y: 0 }
                    : { opacity: 0, y: 15 }
                }
                transition={{
                  duration: 0.35,
                  delay: menuOpen ? index * 0.05 : 0,
                }}
              >
                <Link
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className={`
                    flex items-center justify-between
                    border-b py-5
                    font-serif text-4xl
                    tracking-[-0.05em]
                    ${
                      scrolled
                        ? "border-black/10"
                        : "border-white/10"
                    }
                  `}
                >
                  {item.label}

                  <ArrowUpRight
                    size={19}
                    strokeWidth={1.3}
                    className={
                      scrolled ? "text-black/35" : "text-white/35"
                    }
                  />
                </Link>
              </motion.div>
            ))}
          </div>

          {/* Mobile Register CTA */}
          <Link
            href="/register"
            onClick={() => setMenuOpen(false)}
            className={`
              flex h-14 items-center justify-center gap-2
              rounded-full text-sm font-medium
              transition-colors
              ${
                scrolled
                  ? "bg-black text-white"
                  : "bg-white text-black"
              }
            `}
          >
            Register for Saviskar
            <ArrowUpRight size={16} strokeWidth={1.5} />
          </Link>
        </div>
      </div>
    </>
  );
}