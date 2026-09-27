import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import SmoothScrollProvider from "@/components/providers/SmoothScrollProvider";
import "./globals.css";


export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  referrer: "no-referrer",
  title: {
    default: "Saviskar 2026 | Aevorian Reverie — Annual National University Fest | CGC University, Mohali",
    template: "%s | Saviskar 2026 — Aevorian Reverie | CGC University, Mohali",
  },
  description:
    "Official portal for Saviskar 2026: Aevorian Reverie — Where Tomorrow Dreams Awake. North India's flagship Annual National Techno-Cultural University Festival at CGC University, Mohali. A future imagined so vividly, it begins to exist. Featuring 50+ competitive realms across technology, cultural arts, national hackathons, robotics, sports, and headline Star Night concerts.",
  keywords: [
    "Saviskar 2026",
    "Aevorian Reverie",
    "Where Tomorrow Dreams Awake",
    "A future imagined so vividly it begins to exist",
    "Srijan",
    "Avishkar",
    "CGC University Mohali",
    "CGC Landran",
    "Annual National University Festival",
    "North India University Fest",
    "Techno-Cultural Fest 2026",
    "Star Night CGC University",
    "National Hackathons 2026",
    "Robotics Realm",
    "Inter-University Competitions",
    "Punjab University Festival",
    "Student Festival Registrations"
  ],
  authors: [{ name: "CGC University, Mohali", url: "https://saviskar.co.in" }],
  creator: "CGC University, Mohali",
  publisher: "CGC University, Mohali",
  category: "University Festival & National Competitions",
  metadataBase: new URL("https://saviskar.co.in"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Saviskar 2026: Aevorian Reverie | CGC University, Mohali",
    description:
      "Where Tomorrow Dreams Awake. North India's flagship Annual National Techno-Cultural University Festival at CGC University, Mohali. 50+ Realms, 500+ Colleges & Universities, 25,000+ Participants, 2 Action-Packed Days.",
    url: "https://saviskar.co.in",
    siteName: "Saviskar 2026",
    locale: "en_IN",
    type: "website",
    images: [
      {
        url: "/images/concert-stadium.webp",
        width: 1920,
        height: 1080,
        alt: "Saviskar 2026 Aevorian Reverie Mainstage Stadium Realm at CGC University, Mohali",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Saviskar 2026: Aevorian Reverie | CGC University, Mohali",
    description:
      "Where Tomorrow Dreams Awake. North India's flagship Annual National Techno-Cultural University Festival at CGC University, Mohali.",
    images: ["/images/concert-stadium.webp"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} dark h-full antialiased`}
    >
      <body className="min-h-full w-full max-w-[100vw] overflow-x-clip flex flex-col bg-black text-white selection:bg-white selection:text-black">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-lg focus:bg-violet-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-xl focus:ring-2 focus:ring-white focus:outline-none"
        >
          Skip to main content
        </a>
        <SmoothScrollProvider>
          <div id="main-content" className="flex min-h-full flex-1 flex-col">
            {children}
          </div>
        </SmoothScrollProvider>
      </body>
    </html>
  );
}
