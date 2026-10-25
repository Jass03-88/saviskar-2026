import type { Metadata } from "next";
import TerminalPlaceholder from "@/components/ui/TerminalPlaceholder";
import SponsorsView from "@/components/sponsors/SponsorsView";
import { getSiteAccess } from "@/lib/config/site-access";

export const metadata: Metadata = {
  title: "Official Partners & Strategic Allies | CGC Saviskar 2026 — CGC University Mohali",
  description:
    "Official corporate partners and strategic allies powering Saviskar 2026: Aevorian Reverie at CGC University, Mohali. Featuring Coca-Cola, OPPO, QILVER Jewelry, P.L. Industries, BAKE, Liv Up, and Secret Temptation.",
  openGraph: {
    title: "Official Partners & Strategic Allies | CGC Saviskar 2026",
    description:
      "Coca-Cola, OPPO, QILVER Jewelry, P.L. Industries, BAKE, Liv Up, and Secret Temptation powering North India's benchmark university festival at CGC University, Mohali.",
    images: ["/images/sponsors-arena-bg.jpg"],
  },
};

export default async function SponsorsPage() {
  const siteAccess = await getSiteAccess();

  if (!siteAccess.SPONSORS_ENABLED) {
    return (
      <TerminalPlaceholder
        moduleCode="ALLIES.SYS"
        moduleName="Strategic Partners & Allies"
        category="PARTNERSHIP PROTOCOL"
        classification="CORPORATE ALLIES // TIER 1 MATRIX"
        estimatedRelease="CORPORATE REVEAL STAGE"
        summary="Official beverages, smartphone, fine jewellery, corporate gifting, skin care, hydration, and fragrance partners powering Saviskar 2026: Aevorian Reverie at CGC University, Mohali."
      />
    );
  }

  return <SponsorsView />;
}
