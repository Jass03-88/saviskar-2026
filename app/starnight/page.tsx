import type { Metadata } from "next";
import dynamic from "next/dynamic";
import Navbar from "@/components/ui/Navbar";
import Hero from "@/components/starnight/Hero/Hero";
import PastPerformances from "@/components/starnight/PastPerformances/PastPerformances";
import TerminalPlaceholder from "@/components/ui/TerminalPlaceholder";
import { getSiteAccess } from "@/lib/config/site-access";

const GuessArtist = dynamic(
  () => import("@/components/starnight/GuessArtist/GuessArtist")
);
const LightsOut = dynamic(
  () => import("@/components/starnight/LightsOut/LightsOut")
);
const StarNightReveal = dynamic(
  () => import("@/components/starnight/StarNightReveal")
);

export const metadata: Metadata = {
  title: "Star Night Celebrity Concerts | CGC Saviskar 2026 — CGC University Mohali",
  description:
    "Experience the iconic Star Night stadium concerts at CGC University Mohali for Saviskar 2026: Aevorian Reverie. Headline Bollywood vocalists, Punjabi music icons, laser pyrotechnics, and 35,000+ attendee stadium pro-nights.",
  keywords: [
    "Asees Kaur Star Night CGC",
    "Ranjit Bawa Live Concert CGC Mohali",
    "Star Night CGC University",
    "Celebrity Star Night Mohali",
    "CGC Mohali Concert 2026",
    "CGC Landran Star Night",
    "Saviskar Concert Passes",
    "Saviskar 2026 Star Night",
    "Bollywood Live Concert Mohali",
    "Punjabi Singer Fest Chandigarh",
    "EDM Night Punjab Tricity",
    "CGC Fest Star Night Passes",
    "Aevorian Reverie Concert",
  ],
  alternates: {
    canonical: "/starnight",
  },
  openGraph: {
    title: "Star Night Celebrity Concerts | CGC Saviskar 2026",
    description:
      "Headline concerts featuring Asees Kaur & Ranjit Bawa, laser pyrotechnics, and 35,000+ voices singing as one at CGC University, Mohali.",
    images: ["/images/concert-stadium.webp"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Star Night Celebrity Concerts | CGC Saviskar 2026",
    description:
      "Headline concerts featuring Asees Kaur & Ranjit Bawa, laser pyrotechnics, and 35,000+ voices singing as one at CGC University, Mohali.",
    images: ["/images/concert-stadium.webp"],
  },
};

const jsonLdStarNight = {
  "@context": "https://schema.org",
  "@type": "MusicFestival",
  name: "Saviskar 2026 Star Night Stadium Concerts",
  alternateName: ["CGC Star Night", "CGC Fest Pro Night", "Saviskar Celebrity Night"],
  description:
    "Two consecutive stadium headline concerts featuring chart-topping Bollywood sensation Asees Kaur (Day 1) and Punjabi folk legend Ranjit Bawa (Day 2), laser shows, and 35,000+ attendee crowd at CGC University Mohali.",
  url: "https://saviskar.co.in/starnight",
  startDate: "2026-10-28T19:30:00+05:30",
  endDate: "2026-10-29T23:00:00+05:30",
  performer: [
    {
      "@type": "Person",
      name: "Asees Kaur",
      jobTitle: "Playback Singer",
    },
    {
      "@type": "Person",
      name: "Ranjit Bawa",
      jobTitle: "Punjabi Singer & Performer",
    },
  ],
  location: {
    "@type": "Place",
    name: "CGC Main Concert Arena & Festival Grounds",
    address: {
      "@type": "PostalAddress",
      streetAddress: "State Highway 12A, Chandigarh-Sirhind Road",
      addressLocality: "Mohali (Sahibzada Ajit Singh Nagar)",
      addressRegion: "Punjab",
      postalCode: "140307",
      addressCountry: "IN",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: 30.6942,
      longitude: 76.6653,
    },
  },
  organizer: {
    "@type": "CollegeOrUniversity",
    name: "CGC University, Mohali",
    url: "https://cgcuniversity.in",
  },
};

export default async function StarNightPage() {
  const siteAccess = await getSiteAccess();
  const schemaScript = (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdStarNight) }}
    />
  );

  if (!siteAccess.STARNIGHT_ENABLED) {
    return (
      <>
        {schemaScript}
        <TerminalPlaceholder
          moduleCode="STARNIGHT.SYS"
          moduleName="Star Night Concerts"
          category="ARTIST PROTOCOL"
          classification="TOP SECRET // ARTIST LOCKDOWN"
          estimatedRelease="HEADLINER DROP STAGE"
          summary="Chart-topping headline concert reveals, celebrity artists, stadium lights, and stadium pass allocations for Saviskar 2026 at CGC University, Mohali will be decrypted soon."
        />
      </>
    );
  }

  return (
    <main className="w-full overflow-x-hidden bg-black">
      {schemaScript}
      <Navbar />
      <Hero />

      <PastPerformances />

      <GuessArtist />

      <LightsOut />

      <StarNightReveal />
    </main>
  );
}