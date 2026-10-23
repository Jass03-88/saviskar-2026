import type { Metadata } from "next";
import LegacyView from "@/components/legacy/LegacyView";
import TerminalPlaceholder from "@/components/ui/TerminalPlaceholder";
import { getSiteAccess } from "@/lib/config/site-access";

export const metadata: Metadata = {
  title: "The Legacy | Saviskar 2026 — Aevorian Reverie",
  description:
    "The institutional leadership, founders, and cherished alumni powering Saviskar 2026: Aevorian Reverie at CGC University, Mohali.",
  openGraph: {
    title: "The Legacy | Saviskar 2026",
    description:
      "Honoring the chancellor, leadership, and cherished alumni behind Saviskar 2026 at CGC University, Mohali.",
    images: ["/images/concert-stadium.webp"],
  },
};

export default async function LegacyPage() {
  const siteAccess = await getSiteAccess();

  if (!siteAccess.LEGACY_ENABLED) {
    return (
      <TerminalPlaceholder
        moduleCode="LEGACY.ARCHIVE"
        moduleName="Institutional Legacy & Patron Citations"
        category="HERITAGE PROTOCOL"
        classification="RESTRICTED // PROTOCOL LEVEL 3"
        estimatedRelease="PHASE 2 RELEASE"
        summary="The institutional leadership chronicles, founder manifests, and cherished alumni citations for Saviskar 2026 at CGC University, Mohali are undergoing final presidential review."
      />
    );
  }

  return <LegacyView />;
}
