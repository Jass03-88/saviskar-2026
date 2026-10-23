import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import { ArrowLeft, Mail, Phone, Sparkles } from "lucide-react";
import MouseSpotlight from "@/components/ui/MouseSpotlight";
import RegistrationFlowManager from "@/components/registration/RegistrationFlowManager";
import { getRegistrationSession } from "@/lib/auth/session";
import Footer from "@/components/ui/Footer";
import Navbar from "@/components/ui/Navbar";
import TerminalPlaceholder from "@/components/ui/TerminalPlaceholder";
import { getSiteAccess } from "@/lib/config/site-access";

export const metadata: Metadata = {
  title: "Register & Claim Passes | CGC Saviskar 2026 — CGC University Mohali",
  description:
    "Official registration and digital pass accreditation portal for Saviskar 2026: Aevorian Reverie at CGC University, Mohali. Claim delegate passes for 50+ competitions across RoboWars, 24h Hackathons, Battle of the Bands, and Star Night concerts.",
  keywords: [
    "Saviskar Registration 2026",
    "CGC Fest Passes",
    "CGC University Fest Registration",
    "Claim Saviskar Pass",
    "RoboWars Registration CGC",
    "Hackathon Registration Mohali",
    "CGC Landran Fest Entry",
    "Saviskar 2026 Student Passes",
    "Aevorian Reverie Pass",
  ],
  alternates: {
    canonical: "/register",
  },
  openGraph: {
    title: "Register & Claim Passes | CGC Saviskar 2026",
    description:
      "Claim your official passes for Saviskar 2026: Aevorian Reverie at CGC University, Mohali. Compete across 50+ realms with ₹20L+ prize pool.",
    images: ["/images/concert-stadium.webp"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Register & Claim Passes | CGC Saviskar 2026",
    description:
      "Claim your official passes for Saviskar 2026: Aevorian Reverie at CGC University, Mohali. Compete across 50+ realms with ₹20L+ prize pool.",
    images: ["/images/concert-stadium.webp"],
  },
};

function RegistrationFormLoading() {
  return (
    <section className="px-6 py-24 md:px-10">
      <div className="mx-auto max-w-[1200px] text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
        <p className="mt-4 text-sm text-white/40">Loading registration portal...</p>
      </div>
    </section>
  );
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const siteAccess = await getSiteAccess();
  if (!siteAccess.REGISTRATIONS_ENABLED) {
    return (
      <TerminalPlaceholder
        moduleCode="ACCREDITATION.SYS"
        moduleName="Official Registration Portal"
        category="ACCREDITATION PROTOCOL"
        classification="ACCESS RESTRICTED // PHASE 2 OPENING"
        estimatedRelease="REGISTRATIONS OPENING SOON"
        summary="Online registrations and digital accreditation passes for 50+ competitions across Technical, Non-Technical, Cultural, and AIvishkar realms at CGC University, Mohali will go live shortly. Explore the competitive realms and download rulebooks in the meantime."
      />
    );
  }

  const params = await searchParams;
  const fromAdmin = params.from === "admin";
  const session = await getRegistrationSession();

  return (
    <main className="relative min-h-screen w-full bg-black text-white selection:bg-white selection:text-black">
      {/* 1. FIXED FULL-BLEED PANORAMIC STADIUM BACKGROUND */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <Image
          src="/images/realms-page-bg.webp"
          alt="Saviskar 2026 Festival Amphitheater Stadium Canopy"
          fill
          priority
          sizes="100vw"
          className="object-cover object-center opacity-40 will-change-transform"
        />

        {/* Multi-layered cinematic gradient vignettes */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/90 via-black/55 to-black/95" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.25)_0%,rgba(0,0,0,0.85)_100%)]" />

        {/* Subtle celestial stardust grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_70%_50%_at_50%_35%,#000_60%,transparent_100%)] pointer-events-none" />

        {/* Subtle Ambient Cosmic Haze */}
        <div className="absolute left-[15%] top-[12%] h-[650px] w-[650px] rounded-full bg-violet-600/15 blur-[180px]" />
        <div className="absolute right-[10%] top-[35%] h-[550px] w-[550px] rounded-full bg-cyan-500/10 blur-[170px]" />
        <div className="absolute left-[20%] bottom-[15%] h-[600px] w-[600px] rounded-full bg-fuchsia-600/10 blur-[180px]" />
      </div>

      {/* Interactive Cursor Spotlight */}
      <div className="pointer-events-none fixed inset-0 z-10">
        <MouseSpotlight />
      </div>

      {/* Universal Site Navbar */}
      <Navbar />

      {/* Hero */}
      <section className="relative z-10 px-6 pb-12 pt-28 md:px-10 md:pb-16 md:pt-36">
        <div className="mx-auto max-w-[1200px]">
          {fromAdmin && (
            <div className="mb-6">
              <Link
                href="/admin"
                className="liquid-glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-white/80 transition-all hover:bg-white/10 hover:text-white hover:scale-105"
              >
                <ArrowLeft size={14} />
                <span>Back to Admin</span>
              </Link>
            </div>
          )}
          <div className="liquid-glass mb-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.3em] text-violet-300 shadow-[0_0_20px_rgba(168,85,247,0.2)]">
            <Sparkles size={12} className="text-violet-300 animate-spin" />
            <span>OFFICIAL ACCREDITATION PORTAL // SAVISKAR 2026</span>
          </div>

          <h1 className="max-w-[1100px] text-[clamp(3.5rem,9.5vw,9rem)] font-light leading-[0.84] tracking-tight text-white drop-shadow-[0_4px_30px_rgba(0,0,0,0.9)]">
            Your stage <br />
            <span className="font-editorial text-violet-300 font-normal italic drop-shadow-[0_4px_30px_rgba(168,85,247,0.4)]">
              starts here.
            </span>
          </h1>

          <div className="mt-8 flex flex-col md:flex-row md:items-end md:justify-between gap-6 border-t border-white/12 pt-8">
            <p className="max-w-2xl text-sm leading-relaxed text-zinc-300 md:text-base font-normal">
              Select your competitive realms, add team members, lock in your squad, and claim your official accreditation pass for Saviskar 2026. Open to delegates from 500+ universities nationwide.
            </p>

            <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-violet-300/80">
              <span className="liquid-glass rounded-full px-3 py-1 border border-violet-500/20">
                50+ Competitions
              </span>
              <span className="liquid-glass rounded-full px-3 py-1 border border-violet-500/20">
                Instant QR Pass
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Form & Auth Flow Area */}
      <div className="relative z-10">
        <Suspense fallback={<RegistrationFormLoading />}>
          <RegistrationFlowManager
            initialAuthenticated={session.authenticated}
            initialEmail={session.email || ""}
          />
        </Suspense>
      </div>

      {/* Official Help & Helpline Bottom Section */}
      <section className="relative z-10 border-t border-white/10 bg-black/60 backdrop-blur-xl px-6 py-20 text-white md:px-10 md:py-28">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div>
            <span className="text-[10px] uppercase tracking-[0.3em] text-violet-400">
              Registration Support
            </span>

            <h2 className="mt-2 text-3xl font-light tracking-tight text-white md:text-4xl">
              Need assistance with <span className="font-editorial text-violet-300 font-normal">your entry?</span>
            </h2>

            <p className="mt-3 max-w-md text-sm leading-6 text-white/50">
              Our student coordinators are available daily to assist with bulk university delegations, solo registrations, and payment confirmations.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <a
              href="mailto:saviskar@cgcuniversity.in"
              className="liquid-glass flex items-center gap-3 rounded-2xl border border-white/10 p-4 transition hover:border-violet-400 hover:bg-white/10"
            >
              <Mail size={18} className="text-violet-300" />
              <div>
                <p className="text-[9px] uppercase tracking-wider text-white/40">Email</p>
                <p className="text-xs font-medium text-white">saviskar@cgcuniversity.in</p>
              </div>
            </a>

            <a
              href="tel:+917667340235"
              className="liquid-glass flex items-center gap-3 rounded-2xl border border-white/10 p-4 transition hover:border-violet-400 hover:bg-white/10"
            >
              <Phone size={18} className="text-violet-300" />
              <div>
                <p className="text-[9px] uppercase tracking-wider text-white/40">Helpline Numbers</p>
                <p className="text-xs font-medium text-white">+91 76673 40235 • +91 6280039126</p>
              </div>
            </a>
          </div>
        </div>
      </section>

      {/* Verified CGC University Mohali Footer */}
      <Footer />
    </main>
  );
}
