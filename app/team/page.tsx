import type { Metadata } from "next";
import TeamView from "@/components/team/TeamView";
import TerminalPlaceholder from "@/components/ui/TerminalPlaceholder";
import { getSiteAccess } from "@/lib/config/site-access";

export const metadata: Metadata = {
  title: "Organising Team & Student Council (SAC) | CGC Saviskar 2026 — CGC University Mohali",
  description:
    "Meet the visionary faculty directorate, executive leadership, and the 54-member Student Advisory Council (SAC) organizing Saviskar 2026: Aevorian Reverie at CGC University, Mohali.",
  keywords: [
    "Saviskar 2026 Organising Team",
    "Student Advisory Council CGC",
    "SAC CGC University Mohali",
    "Department of Student Affairs DSA CGC",
    "CGC Fest Organisers",
    "Saviskar Student Leads",
    "Saviskar Core Committee",
  ],
  alternates: {
    canonical: "/team",
  },
  openGraph: {
    title: "Organising Team & SAC Roster | Saviskar 2026",
    description:
      "Honoring the faculty leaders, domain heads, and the 54-member Student Advisory Council (SAC) behind Saviskar 2026 at CGC University, Mohali.",
    images: ["/images/concert-stadium.webp"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Organising Team & SAC Roster | Saviskar 2026",
    description:
      "Meet the 54-member Student Advisory Council and faculty leadership orchestrating Saviskar 2026 at CGC University, Mohali.",
    images: ["/images/concert-stadium.webp"],
  },
};

export default async function TeamPage() {
  const siteAccess = await getSiteAccess();

  if (!siteAccess.TEAM_ENABLED) {
    return (
      <TerminalPlaceholder
        moduleCode="COUNCIL.SYS"
        moduleName="Organising Team & SAC Roster"
        category="EXECUTIVE PROTOCOL"
        classification="EXECUTIVE ROSTER // LEVEL 2"
        estimatedRelease="ROSTER ANNOUNCEMENT"
        summary="The Student Advisory Council directory, faculty leadership manifests, and executive organizers for Saviskar 2026 at CGC University, Mohali are currently undergoing official administrative curation."
      />
    );
  }

  return <TeamView />;
}
