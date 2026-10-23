import Link from "next/link";
import { ArrowLeft, Building2, ExternalLink, Mail, Phone, ShieldCheck, Sparkles, Trophy, Handshake } from "lucide-react";
import Navbar from "@/components/ui/Navbar";
import Footer from "@/components/ui/Footer";

interface Sponsor {
  name: string;
  category: string;
  tagline: string;
  tier: "title" | "poweredBy" | "associate" | "partner";
  accent: string;
}

const FEATURED_SPONSORS: Sponsor[] = [
  {
    name: "CGC University Innovation Directorate",
    category: "Title Partner & Host Institutional Patron",
    tagline: "Empowering 35,000+ engineers, creators, and innovators across India.",
    tier: "title",
    accent: "from-amber-500/20 via-orange-500/10 to-transparent",
  },
  {
    name: "NextGen Cloud & Compute Labs",
    category: "Powered By // High-Performance Infrastructure",
    tagline: "Zero-latency cloud computing and GPU clusters for AIvishkar Hackathon 2026.",
    tier: "poweredBy",
    accent: "from-violet-500/20 via-purple-500/10 to-transparent",
  },
  {
    name: "Aevorian Autonomous Robotics",
    category: "RoboWars 2026 Title Partner",
    tagline: "Combat arena hydraulics, telemetry systems, and autonomous robotics gear.",
    tier: "associate",
    accent: "from-cyan-500/20 via-blue-500/10 to-transparent",
  },
  {
    name: "SoundCrafters Audio & Stage Rigging",
    category: "Star Night 2026 Stage & Production Partner",
    tagline: "35,000-watt acoustic engineering and festival stadium laser arrays.",
    tier: "partner",
    accent: "from-rose-500/20 via-pink-500/10 to-transparent",
  },
  {
    name: "Tricity Media & Broadcast Syndicate",
    category: "Official Media & Livestream Partner",
    tagline: "HD 4K multi-cam festival livestreaming across North India.",
    tier: "partner",
    accent: "from-emerald-500/20 via-teal-500/10 to-transparent",
  },
  {
    name: "Punjab Tech Hub & Startups Alliance",
    category: "E-Summit & Venture Pitch Sponsor",
    tagline: "Seed capital awards and incubator fast-track for winning syndicates.",
    tier: "associate",
    accent: "from-yellow-500/20 via-amber-500/10 to-transparent",
  },
];

export default function SponsorsView() {
  return (
    <div className="relative min-h-screen bg-black text-white selection:bg-violet-500 selection:text-white">
      <Navbar />

      <main className="relative z-10 pt-28 pb-20">
        {/* Ambient Radial Background Glow */}
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[650px] overflow-hidden">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[450px] w-[800px] rounded-full bg-violet-600/10 blur-[130px]" />
          <div className="absolute top-1/3 left-1/3 h-[300px] w-[500px] rounded-full bg-indigo-600/10 blur-[120px]" />
        </div>

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* Back link & breadcrumb */}
          <div className="mb-8 flex items-center justify-between">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-mono tracking-wider text-zinc-400 backdrop-blur-md transition-all hover:border-white/25 hover:text-white"
            >
              <ArrowLeft size={14} />
              <span>RETURN TO MAIN RADAR</span>
            </Link>

            <span className="inline-flex items-center gap-2 font-mono text-[11px] text-zinc-500 uppercase tracking-widest">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
              PARTNERSHIP MATRIX // ACTIVE
            </span>
          </div>

          {/* Header */}
          <div className="mb-14 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-1.5 text-xs font-mono font-medium tracking-widest text-violet-300">
              <Building2 size={13} className="text-violet-400" />
              <span>CORPORATE ALLIES & PATRONS</span>
            </div>

            <h1 className="mt-4 text-4xl sm:text-6xl font-black tracking-tight text-white uppercase font-sans">
              Powering <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 via-purple-300 to-indigo-400">Saviskar 2026</span>
            </h1>

            <p className="mx-auto mt-4 max-w-2xl text-base sm:text-lg text-zinc-400 leading-relaxed">
              We express profound gratitude to the industry pioneers, technology innovators, and corporate leaders whose visionary partnership elevates CGC Saviskar: Aevorian Reverie into North India's benchmark university festival.
            </p>
          </div>

          {/* Sponsors Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
            {FEATURED_SPONSORS.map((sponsor, idx) => (
              <div
                key={idx}
                className="group relative rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-7 backdrop-blur-md transition-all duration-300 hover:border-violet-500/40 hover:-translate-y-1 shadow-lg"
              >
                <div className={`absolute inset-0 -z-10 rounded-2xl bg-gradient-to-br ${sponsor.accent} opacity-0 transition-opacity duration-300 group-hover:opacity-100`} />
                
                <div className="flex items-start justify-between mb-4">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-300">
                    <ShieldCheck size={12} className="text-violet-400" />
                    {sponsor.tier.toUpperCase()}
                  </span>
                  <Building2 size={18} className="text-zinc-500 group-hover:text-violet-400 transition-colors" />
                </div>

                <h3 className="text-xl font-bold text-white tracking-tight group-hover:text-violet-200 transition-colors">
                  {sponsor.name}
                </h3>

                <p className="mt-1 font-mono text-xs text-violet-400/90 font-medium">
                  {sponsor.category}
                </p>

                <p className="mt-4 text-sm text-zinc-400 leading-relaxed">
                  {sponsor.tagline}
                </p>
              </div>
            ))}
          </div>

          {/* Partnership CTA Banner */}
          <div className="rounded-3xl border border-violet-500/30 bg-gradient-to-br from-violet-950/40 via-zinc-950 to-black p-8 sm:p-12 text-center relative overflow-hidden backdrop-blur-xl">
            <div className="pointer-events-none absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-violet-600/20 blur-[80px]" />

            <div className="mx-auto max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-mono text-violet-300">
                <Handshake size={14} />
                <span>SPONSORSHIP & BRAND ACTIVATION</span>
              </div>

              <h2 className="mt-4 text-2xl sm:text-4xl font-bold tracking-tight text-white">
                Partner with North India's Grandest Campus Festival
              </h2>

              <p className="mt-3 text-sm sm:text-base text-zinc-400 leading-relaxed">
                Reach over 35,000+ enthusiastic collegiate delegates, 50+ competition tracks, and massive digital impressions across Punjab, Chandigarh, Haryana, and beyond.
              </p>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                <a
                  href="mailto:saviskar@cgcuniversity.in"
                  className="inline-flex items-center gap-2 rounded-full bg-violet-500 px-6 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:bg-violet-400 hover:scale-105"
                >
                  <Mail size={16} />
                  <span>Request Partnership Deck</span>
                </a>

                <Link
                  href="/team"
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 py-3 text-sm font-medium text-zinc-300 transition-all hover:border-white/40 hover:text-white"
                >
                  <Phone size={16} />
                  <span>Contact SAC Sponsorship Wing</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
