import type { Metadata } from "next";
import TerminalPlaceholder from "@/components/ui/TerminalPlaceholder";
import SponsorsView from "@/components/sponsors/SponsorsView";
import { getSiteAccess } from "@/lib/config/site-access";

export const metadata: Metadata = {
  title: "Corporate Sponsors & Allies | CGC Saviskar 2026 — CGC University Mohali",
  description:
    "Corporate partners, tech sponsors, automotive partners, and associates backing Saviskar 2026: Aevorian Reverie at CGC University, Mohali.",
  openGraph: {
    title: "Corporate Sponsors & Allies | CGC Saviskar 2026",
    description:
      "Corporate partners and strategic allies powering North India's benchmark festival at CGC University, Mohali.",
    images: ["/images/concert-stadium.webp"],
  },
};

export default async function SponsorsPage() {
  const siteAccess = await getSiteAccess();

  if (!siteAccess.SPONSORS_ENABLED) {
    return (
      <TerminalPlaceholder
        moduleCode="ALLIES.SYS"
        moduleName="Sponsors & Partners"
        category="PARTNERSHIP PROTOCOL"
        classification="CORPORATE ALLIES // TIER 1 MATRIX"
        estimatedRelease="CORPORATE REVEAL STAGE"
        summary="Title sponsors, technology partners, automotive showcases, and realm titleholders powering the 50+ competitions and stadium headliners at CGC University, Mohali."
      />
    );
  }

  return <SponsorsView />;
}
