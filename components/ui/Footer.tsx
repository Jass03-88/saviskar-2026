"use client";
import { ArrowUpRight, Mail, Phone, X } from "lucide-react";
import { useState } from "react";

export default function Footer() {
  const [contactOpen, setContactOpen] = useState(false);

  return (
    <footer className="bg-black px-6 py-14 text-white md:px-10">
      <div className="mx-auto max-w-[1400px]">
        <div className="flex flex-col gap-12 border-b border-white/10 pb-14 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-2xl font-semibold tracking-[-0.05em]">
              SAVISKAR
            </div>

            <p className="mt-4 max-w-xs text-sm leading-6 text-white/35">
              The annual techno-cultural celebration of
              CGC University, Mohali.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-16 gap-y-4 text-sm text-white/50 md:grid-cols-3">
            <a href="#about" className="hover:text-white">
              About
            </a>

            <a href="#events" className="hover:text-white">
              Events
            </a>

            <a href="#gallery" className="hover:text-white">
              Gallery
            </a>

            <a href="/register" className="hover:text-white">
              Register
            </a>

            <button
              type="button"
              onClick={() => setContactOpen(true)}
              className="text-left hover:text-white"
            >
              Contact
            </button>

            <a
              href="https://www.instagram.com/saviskar.cgcuniversity/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-white"
            >
              Instagram
              <ArrowUpRight size={13} />
            </a>
          </div>
        </div>

        <div className="flex flex-col gap-3 pt-7 text-[11px] text-white/25 md:flex-row md:justify-between">
          <p>© 2026 Saviskar. All rights reserved.</p>

          <p>CGC University, Mohali</p>
        </div>
      </div>

      {contactOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm"
          onClick={() => setContactOpen(false)}
        >
          <div
            className="relative w-full max-w-md rounded-[28px] bg-white p-7 text-black shadow-2xl md:p-9"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setContactOpen(false)}
              className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-black/[0.06] transition hover:bg-black hover:text-white"
              aria-label="Close contact"
            >
              <X size={16} />
            </button>

            <p className="text-[9px] uppercase tracking-[0.3em] text-black/40">
              Saviskar 2026
            </p>

            <h2 className="mt-3 font-serif text-4xl tracking-[-0.04em]">
              Contact us
            </h2>

            <p className="mt-3 max-w-sm text-sm leading-6 text-black/45">
              Have a question about Saviskar? Reach out to the team.
            </p>

            <div className="mt-8 space-y-3">
              <a
                href="mailto:saviskar@cgcuniversity.in"
                className="flex items-center gap-4 rounded-2xl border border-black/10 p-4 transition hover:bg-black hover:text-white"
              >
                <Mail size={18} />
                <div>
                  <p className="text-[9px] uppercase tracking-[0.2em] opacity-45">
                    Email
                  </p>
                  <p className="mt-1 text-sm font-medium">
                    saviskar@cgcuniversity.in
                  </p>
                </div>
              </a>

              <a
                href="tel:+919999999999"
                className="flex items-center gap-4 rounded-2xl border border-black/10 p-4 transition hover:bg-black hover:text-white"
              >
                <Phone size={18} />
                <div>
                  <p className="text-[9px] uppercase tracking-[0.2em] opacity-45">
                    Phone
                  </p>
                  <p className="mt-1 text-sm font-medium">
                    +91 99999 99999
                  </p>
                </div>
              </a>

              <a
                href="tel:+918888888888"
                className="flex items-center gap-4 rounded-2xl border border-black/10 p-4 transition hover:bg-black hover:text-white"
              >
                <Phone size={18} />
                <div>
                  <p className="text-[9px] uppercase tracking-[0.2em] opacity-45">
                    Phone
                  </p>
                  <p className="mt-1 text-sm font-medium">
                    +91 88888 88888
                  </p>
                </div>
              </a>
            </div>

            <p className="mt-6 text-center text-[9px] uppercase tracking-[0.2em] text-black/25">
              Phone numbers are temporary and can be changed later.
            </p>
          </div>
        </div>
      )}
    </footer>
  );
}