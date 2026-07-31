import { ArrowUpRight } from "lucide-react";

export default function Footer() {
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

            <a href="#register" className="hover:text-white">
              Register
            </a>

            <a href="#" className="hover:text-white">
              Contact
            </a>

            <a
              href="#"
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
    </footer>
  );
}