import type { Metadata } from "next";
import TerminalPlaceholder from "@/components/ui/TerminalPlaceholder";
import { getSiteAccess } from "@/lib/config/site-access";
import ScheduleView from "@/components/schedule/ScheduleView";
import { supabase } from "@/lib/supabase";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Festival Schedule & Campus Radar | CGC Saviskar 2026 — CGC University Mohali",
  description:
    "Official spatial timetable and interactive 3D campus radar for Saviskar 2026: Aevorian Reverie at CGC University, Mohali. Hourly competition stages, Hackathon slots, and Star Night pro-nights.",
  openGraph: {
    title: "Festival Schedule & Campus Radar | CGC Saviskar 2026",
    description:
      "Interactive 3D campus map and chronological matrix for 50+ competitions across 28–29 October 2026 at CGC University, Mohali.",
    images: ["/images/concert-stadium.webp"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Festival Schedule & Campus Radar | CGC Saviskar 2026",
    description:
      "Interactive 3D campus map and chronological matrix for 50+ competitions at CGC University, Mohali.",
    images: ["/images/concert-stadium.webp"],
  },
};

export default async function SchedulePage() {
  const siteAccess = await getSiteAccess();

  if (!siteAccess.SCHEDULE_ENABLED) {
    return (
      <TerminalPlaceholder
        moduleCode="CHRONO.SYS"
        moduleName="Festival Schedule & Spatial Radar"
        category="TIMELINE PROTOCOL"
        classification="CLASSIFIED // CLEARANCE LEVEL 4"
        estimatedRelease="PHASE 2 RELEASE"
        summary="Hourly competition schedules, campus stage coordinates, syndicate paper slots, and stadium headline concert timelines for Saviskar 2026 at CGC University, Mohali are undergoing final operational synchronization."
      />
    );
  }

  // Fetch all active event timings and venues from the events table in DB as fetched in event display
  const { data: dbEvents } = await supabase
    .from("events")
    .select(
      "id, slug, name, category, description, event_date, start_time, venue, active, registration_open"
    )
    .eq("active", true)
    .order("event_date", { ascending: true })
    .order("start_time", { ascending: true });

  return <ScheduleView initialEvents={dbEvents ?? []} />;
}
