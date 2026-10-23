import type { Metadata } from "next";
import TerminalPlaceholder from "@/components/ui/TerminalPlaceholder";
import { getSiteAccess } from "@/lib/config/site-access";
import GalleryView from "@/components/gallery/GalleryView";

export const metadata: Metadata = {
  title: "Campus Media & Film Archive | CGC Saviskar 2026 — CGC University Mohali",
  description:
    "Explore high-definition festival photographs, cinematic recap films, stage highlights, and stadium pro-night archives from Saviskar 2026: Aevorian Reverie at CGC University, Mohali.",
  openGraph: {
    title: "Campus Media & Film Archive | CGC Saviskar 2026",
    description:
      "High-definition photography and official festival aftermovies from Saviskar 2026 at CGC University, Mohali.",
    images: ["/images/concert-stadium.webp"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Campus Media & Film Archive | CGC Saviskar 2026",
    description:
      "High-definition photography and official festival aftermovies from Saviskar 2026 at CGC University, Mohali.",
    images: ["/images/concert-stadium.webp"],
  },
};

export default async function GalleryPage() {
  const siteAccess = await getSiteAccess();

  if (!siteAccess.GALLERY_ENABLED) {
    return (
      <TerminalPlaceholder
        moduleCode="VAULT.SYS"
        moduleName="Campus Media & Film Archive"
        category="VISUAL PROTOCOL"
        classification="MEDIA ARCHIVE // ENCRYPTION ACTIVE"
        estimatedRelease="MEDIA DROP STAGE"
        summary="High-definition photo archives, cinematic aftermovies, and historical celebration reels for Saviskar 2026 at CGC University, Mohali are undergoing media mastering."
      />
    );
  }

  return <GalleryView />;
}
