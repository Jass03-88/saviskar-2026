"use client";

import React, { useState, useRef, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Compass,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  MapPin,
  Calendar,
  Clock,
  Trophy,
  ArrowUpRight,
  X,
  Search,
  ChevronRight,
  Building2,
} from "lucide-react";
import {
  CampusVenue,
  ScheduleEvent,
  CAMPUS_VENUES,
  FESTIVAL_SCHEDULE,
} from "@/data/scheduleData";

interface CampusMapProps {
  onSelectEvent?: (event: ScheduleEvent) => void;
  externalEvents?: ScheduleEvent[];
}

export default function CampusMap({ onSelectEvent, externalEvents }: CampusMapProps) {
  // Use passed events or fallback to festival schedule
  const allEvents = useMemo(() => {
    return externalEvents && externalEvents.length > 0
      ? externalEvents
      : FESTIVAL_SCHEDULE;
  }, [externalEvents]);

  // Map Navigation & Transformation State
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Filtering & Selection State
  const [selectedDay, setSelectedDay] = useState<number | "all">("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [hoveredVenueId, setHoveredVenueId] = useState<string | null>(null);
  const [activeVenue, setActiveVenue] = useState<CampusVenue | null>(null);
  const [isScheduleDrawerOpen, setIsScheduleDrawerOpen] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapImageRef = useRef<HTMLDivElement>(null);

  // Filter events based on active filters
  const filteredEvents = useMemo(() => {
    return allEvents.filter((ev) => {
      // Day filter
      if (selectedDay !== "all" && ev.day !== selectedDay) return false;

      // Category filter
      if (selectedCategory !== "all" && ev.category !== selectedCategory) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = ev.name.toLowerCase().includes(q);
        const matchesVenue = ev.venueName.toLowerCase().includes(q);
        const matchesDesc = ev.description.toLowerCase().includes(q);
        if (!matchesName && !matchesVenue && !matchesDesc) return false;
      }

      return true;
    });
  }, [allEvents, selectedDay, selectedCategory, searchQuery]);

  // Compute event counts per venue
  const venueEventCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredEvents.forEach((ev) => {
      counts[ev.venueId] = (counts[ev.venueId] || 0) + 1;
    });
    return counts;
  }, [filteredEvents]);

  // Zoom handlers
  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.3, 2.5));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.3, 0.8));
  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Pan handlers via Mouse / Touch
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only drag on left click and not on interactive buttons
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  // Wheel zoom (ctrl/cmd + wheel or pinch)
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      setZoom((prev) => Math.min(Math.max(prev + delta, 0.8), 2.5));
    }
  };

  // Fly to venue
  const flyToVenue = (venue: CampusVenue) => {
    // Calculate pan offset to center on venue
    // Coordinates are percentages (0-100)
    const targetX = -(venue.coordinates.x - 50) * 8 * zoom;
    const targetY = -(venue.coordinates.y - 50) * 5 * zoom;
    setPan({ x: targetX, y: targetY });
    setZoom((prev) => Math.max(prev, 1.35));
    setActiveVenue(venue);
  };

  // Events taking place at the currently active venue
  const activeVenueEvents = useMemo(() => {
    if (!activeVenue) return [];
    return allEvents.filter((ev) => ev.venueId === activeVenue.id);
  }, [activeVenue, allEvents]);

  return (
    <div className="relative w-full overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 shadow-[0_25px_80px_rgba(0,0,0,0.9)] select-none">
      
      {/* ══════════════════════════════════════════════════════════
          TOP BAR CONTROLS & DAY / REALM FILTER STRIP
      ══════════════════════════════════════════════════════════ */}
      <div className="relative z-30 border-b border-white/[0.08] bg-black/80 px-4 py-3 sm:px-6 backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          
          {/* Left: Map title badge */}
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-600/20 text-violet-400 border border-violet-500/30">
              <Compass size={17} className="animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-violet-300">
                  CGC UNIVERSITY MOHALI // AERIAL 3D MAP
                </span>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" />
              </div>
              <h3 className="font-editorial text-lg sm:text-xl font-bold text-white tracking-wide leading-tight">
                Campus Grounds &amp; Venue Schedule
              </h3>
            </div>
          </div>

          {/* Center / Right: Filter controls */}
          <div className="flex flex-wrap items-center gap-2">
            
            {/* Day Selector */}
            <div className="flex rounded-full border border-white/10 bg-white/[0.04] p-1">
              {[
                { id: "all", label: "All Days" },
                { id: 1, label: "Day 1 (28 Oct)" },
                { id: 2, label: "Day 2 (29 Oct)" },
              ].map((d) => (
                <button
                  key={d.id}
                  onClick={() => setSelectedDay(d.id as number | "all")}
                  className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-all ${
                    selectedDay === d.id
                      ? "bg-violet-600 text-white font-bold shadow-[0_0_12px_rgba(139,92,246,0.5)]"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>

            {/* Realm Selector Dropdown / Pills */}
            <div className="hidden lg:flex rounded-full border border-white/10 bg-white/[0.04] p-1">
              {[
                { id: "all", label: "All Realms" },
                { id: "technical", label: "Technical" },
                { id: "cultural", label: "Cultural" },
                { id: "non-technical", label: "Non-Tech" },
                { id: "sports", label: "Sports" },
              ].map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCategory(c.id)}
                  className={`rounded-full px-3 py-1 font-mono text-[9.5px] uppercase tracking-wider transition-all ${
                    selectedCategory === c.id
                      ? "bg-white text-black font-bold shadow-[0_0_12px_rgba(255,255,255,0.4)]"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Quick Search */}
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Search event or venue..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 w-36 sm:w-48 rounded-full border border-white/10 bg-white/[0.05] pl-8 pr-3 text-xs text-white placeholder-zinc-500 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* "What's On" Drawer Toggle Button */}
            <button
              onClick={() => setIsScheduleDrawerOpen(!isScheduleDrawerOpen)}
              className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-600/20 px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-violet-200 transition-all hover:bg-violet-600 hover:text-white shadow-[0_0_15px_rgba(139,92,246,0.25)]"
            >
              <Calendar size={13} />
              <span>Schedule ({filteredEvents.length})</span>
            </button>
          </div>
        </div>

        {/* Quick Venue Jump Chips Bar */}
        <div className="mt-2.5 flex items-center gap-2 overflow-x-auto no-scrollbar pt-1">
          <span className="font-mono text-[8.5px] uppercase tracking-widest text-zinc-500 flex-shrink-0">
            JUMP TO:
          </span>
          {CAMPUS_VENUES.map((venue) => {
            const count = venueEventCounts[venue.id] || 0;
            const isHovered = hoveredVenueId === venue.id;
            const isActive = activeVenue?.id === venue.id;

            return (
              <button
                key={venue.id}
                onClick={() => flyToVenue(venue)}
                onMouseEnter={() => setHoveredVenueId(venue.id)}
                onMouseLeave={() => setHoveredVenueId(null)}
                className={`flex-shrink-0 flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider transition-all ${
                  isActive
                    ? "bg-violet-600 text-white font-bold ring-1 ring-violet-400 shadow-[0_0_10px_rgba(139,92,246,0.6)]"
                    : isHovered
                    ? "bg-white/15 text-white"
                    : "bg-white/[0.03] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.08]"
                }`}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    backgroundColor:
                      venue.accentColor === "amber"
                        ? "#f59e0b"
                        : venue.accentColor === "cyan"
                        ? "#06b6d4"
                        : venue.accentColor === "emerald"
                        ? "#10b981"
                        : venue.accentColor === "rose"
                        ? "#f43f5e"
                        : "#a855f7",
                  }}
                />
                <span>{venue.shortName}</span>
                {count > 0 && (
                  <span className="rounded bg-black/50 px-1 py-0.2 text-[8px] text-violet-300 font-bold">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          INTERACTIVE 3D MAP CANVAS (Image Base + Pure HTML Overlays)
      ══════════════════════════════════════════════════════════ */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        className={`relative h-[550px] sm:h-[650px] lg:h-[750px] w-full overflow-hidden bg-[#0d160f] cursor-grab active:cursor-grabbing ${
          isDragging ? "cursor-grabbing" : ""
        }`}
      >
        {/* Soft daylight sky gradient overlay at top edge of plains */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-sky-400/10 via-emerald-900/5 to-transparent z-10" />

        {/* Outer vignette glow & perimeter blend */}
        <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_80px_rgba(0,0,0,0.6)] z-10" />

        {/* ── Movable / Zoomable Map Container ── */}
        <div
          ref={mapImageRef}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: isDragging ? "none" : "transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
          className="relative w-full h-full will-change-transform flex items-center justify-center"
        >
          {/* 
            Strict User Rule: "DONOT WRITE ANYTHING OVER IMAGE USE HTML OR ANY LANGUAGE TO GIVE NAMES AND OTHER ELEMNTS OVER THE IMAGE."
            This image is 100% clean with NO baked text.
          */}
          <div className="relative w-full max-w-[1400px] aspect-[1024/708] shadow-2xl">
            <Image
              src="/images/map/cgc-campus-map-2026.webp"
              alt="CGC University Mohali Campus Map"
              fill
              priority
              sizes="(max-width: 1400px) 100vw, 1400px"
              className="object-contain pointer-events-none select-none rounded-2xl"
              unoptimized
            />

            {/* ══════════════════════════════════════════════════════════
                DYNAMIC HTML/CSS VENUE PINS & INTERACTIVE OVERLAYS
            ══════════════════════════════════════════════════════════ */}
            {CAMPUS_VENUES.map((venue) => {
              const eventCount = venueEventCounts[venue.id] || 0;
              const isHovered = hoveredVenueId === venue.id;
              const isActive = activeVenue?.id === venue.id;
              const hasMatchingEvents = eventCount > 0;

              // Accent color mappings
              const colorTokens: Record<string, { bg: string; border: string; text: string; glow: string }> = {
                violet: { bg: "bg-violet-600", border: "border-violet-400", text: "text-violet-300", glow: "#8b5cf6" },
                cyan: { bg: "bg-cyan-600", border: "border-cyan-400", text: "text-cyan-300", glow: "#06b6d4" },
                amber: { bg: "bg-amber-600", border: "border-amber-400", text: "text-amber-300", glow: "#f59e0b" },
                emerald: { bg: "bg-emerald-600", border: "border-emerald-400", text: "text-emerald-300", glow: "#10b981" },
                rose: { bg: "bg-rose-600", border: "border-rose-400", text: "text-rose-300", glow: "#f43f5e" },
                fuchsia: { bg: "bg-fuchsia-600", border: "border-fuchsia-400", text: "text-fuchsia-300", glow: "#d946ef" },
              };
              const c = colorTokens[venue.accentColor] || colorTokens.violet;

              return (
                <div
                  key={venue.id}
                  style={{
                    left: `${venue.coordinates.x}%`,
                    top: `${venue.coordinates.y}%`,
                  }}
                  className="absolute -translate-x-1/2 -translate-y-full z-20"
                >
                  {/* Anchor Pinhead */}
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      flyToVenue(venue);
                    }}
                    onMouseEnter={() => setHoveredVenueId(venue.id)}
                    onMouseLeave={() => setHoveredVenueId(null)}
                    className="group relative cursor-pointer flex flex-col items-center"
                  >
                    {/* Floating Venue Tag Pill */}
                    <div
                      className={`mb-1.5 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-mono tracking-wider uppercase transition-all duration-300 shadow-xl border backdrop-blur-md ${
                        isActive
                          ? "bg-violet-950/95 border-violet-400 text-white shadow-[0_0_20px_rgba(139,92,246,0.8)] scale-110"
                          : isHovered
                          ? "bg-black/95 border-white/40 text-white shadow-[0_0_15px_rgba(255,255,255,0.3)] scale-105"
                          : hasMatchingEvents
                          ? "bg-black/85 border-white/20 text-white/90"
                          : "bg-black/60 border-white/10 text-white/60 opacity-80"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${c.bg} animate-pulse`} />
                      <span className="font-semibold tracking-wide">{venue.shortName}</span>
                      {eventCount > 0 && (
                        <span className="rounded-full bg-white/20 px-1.5 py-0.2 text-[8.5px] font-bold text-white">
                          {eventCount}
                        </span>
                      )}
                    </div>

                    {/* Central Pulsing Marker Dot */}
                    <div className="relative flex items-center justify-center">
                      {/* Outer Ping */}
                      <span
                        className={`absolute h-7 w-7 rounded-full opacity-75 animate-ping`}
                        style={{ backgroundColor: c.glow }}
                      />
                      
                      {/* Main Pin Marker Circle */}
                      <div
                        className={`relative flex h-6 w-6 items-center justify-center rounded-full border-2 text-white shadow-lg transition-transform duration-300 ${c.bg} ${c.border} ${
                          isHovered || isActive ? "scale-125" : "hover:scale-110"
                        }`}
                        style={{ boxShadow: `0 0 16px ${c.glow}` }}
                      >
                        <Building2 size={11} />
                      </div>

                      {/* Bottom pointer tip */}
                      <div
                        className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[6px] -mt-[1px]"
                        style={{ borderTopColor: c.glow }}
                      />
                    </div>

                    {/* ══════════════════════════════════════════════════════════
                        HOVER TOOLTIP PREVIEW CARD
                    ══════════════════════════════════════════════════════════ */}
                    {isHovered && !isActive && (
                      <div
                        className="absolute bottom-full mb-3 w-64 rounded-2xl border border-white/20 bg-black/95 p-3.5 shadow-[0_15px_40px_rgba(0,0,0,0.9)] backdrop-blur-2xl animate-fade-in pointer-events-none z-30"
                        style={{ left: "50%", transform: "translateX(-50%)" }}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className={`font-mono text-[8.5px] uppercase tracking-widest ${c.text}`}>
                            {venue.pinBadge}
                          </span>
                          <span className="font-mono text-[8px] text-zinc-400 bg-white/10 px-1.5 py-0.5 rounded">
                            {venue.buildingCode}
                          </span>
                        </div>
                        <h4 className="font-editorial text-sm font-bold text-white leading-snug">
                          {venue.name}
                        </h4>
                        <p className="mt-1 text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                          {venue.tagline}
                        </p>

                        <div className="mt-2.5 pt-2 border-t border-white/10 flex items-center justify-between text-[9px] font-mono text-zinc-300">
                          <span className="flex items-center gap-1">
                            <Calendar size={10} className="text-violet-400" />
                            <span>{eventCount} {eventCount === 1 ? "Event" : "Events"}</span>
                          </span>
                          <span className="text-violet-300 font-semibold flex items-center gap-0.5">
                            Walk In <ChevronRight size={10} />
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════
            MAP CONTROLS HUD (Zoom In, Zoom Out, Reset, Legend)
        ══════════════════════════════════════════════════════════ */}
        <div className="absolute bottom-4 left-4 z-20 flex flex-col gap-2">
          <div className="flex flex-col rounded-2xl border border-white/15 bg-black/85 p-1 shadow-2xl backdrop-blur-xl">
            <button
              onClick={handleZoomIn}
              title="Zoom In"
              className="flex h-9 w-9 items-center justify-center rounded-xl text-white/80 hover:bg-white/15 hover:text-white transition-all"
            >
              <ZoomIn size={16} />
            </button>
            <div className="h-px w-full bg-white/10 my-0.5" />
            <button
              onClick={handleZoomOut}
              title="Zoom Out"
              className="flex h-9 w-9 items-center justify-center rounded-xl text-white/80 hover:bg-white/15 hover:text-white transition-all"
            >
              <ZoomOut size={16} />
            </button>
            <div className="h-px w-full bg-white/10 my-0.5" />
            <button
              onClick={handleReset}
              title="Reset View"
              className="flex h-9 w-9 items-center justify-center rounded-xl text-white/80 hover:bg-white/15 hover:text-white transition-all"
            >
              <RotateCcw size={15} />
            </button>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/80 px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider text-zinc-400 backdrop-blur-md">
            Zoom: {Math.round(zoom * 100)}%
          </div>
        </div>

        {/* Map Drag Instruction Badge */}
        <div className="absolute bottom-4 right-4 z-20 hidden sm:flex items-center gap-2 rounded-full border border-white/10 bg-black/75 px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-wider text-zinc-400 backdrop-blur-md">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
          <span>Click venue pin to walk in · Drag to pan</span>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          ACTIVE VENUE "WALK IN" SCHEDULE MODAL / DRAWER
      ══════════════════════════════════════════════════════════ */}
      {activeVenue && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 sm:p-6 backdrop-blur-2xl animate-fade-in"
          onClick={() => setActiveVenue(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-3xl border border-violet-500/30 bg-gradient-to-b from-zinc-900 via-zinc-950 to-black shadow-[0_25px_80px_rgba(139,92,246,0.3)] flex flex-col"
          >
            {/* Modal Header */}
            <div className="relative border-b border-white/10 p-6 sm:p-8 bg-zinc-900/60">
              <button
                onClick={() => setActiveVenue(null)}
                aria-label="Close Venue Schedule"
                className="absolute top-6 right-6 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white hover:text-black transition-all"
              >
                <X size={16} />
              </button>

              <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.25em] uppercase text-violet-400 mb-2">
                <Building2 size={13} />
                <span>{activeVenue.buildingCode} {"//"} {activeVenue.pinBadge}</span>
              </div>
              <h3 className="font-editorial text-2xl sm:text-3xl font-bold text-white tracking-tight">
                {activeVenue.name}
              </h3>
              <p className="mt-2 text-sm text-zinc-300 font-light leading-relaxed max-w-2xl">
                {activeVenue.description}
              </p>

              {/* Facilities Chips */}
              <div className="mt-4 flex flex-wrap gap-2">
                {activeVenue.facilities.map((fac, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-400"
                  >
                    {fac}
                  </span>
                ))}
              </div>
            </div>

            {/* Modal Events Body */}
            <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-4">
              <div className="flex items-center justify-between mb-2">
                <div className="font-mono text-[10px] tracking-wider uppercase text-zinc-400">
                  SCHEDULED EVENTS AT THIS VENUE ({activeVenueEvents.length})
                </div>
                <div className="font-mono text-[9px] text-violet-400 uppercase">
                  SAVISKAR 2026 OFFICIAL LINEUP
                </div>
              </div>

              {activeVenueEvents.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-black/40 p-8 text-center text-zinc-400">
                  <Calendar size={28} className="mx-auto text-zinc-600 mb-3" />
                  <p className="text-base font-light text-white">No competitions scheduled at this venue for selected filters.</p>
                  <p className="text-xs text-zinc-500 mt-1">Switch day filters or check the main timeline.</p>
                </div>
              ) : (
                activeVenueEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="group relative rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-all hover:border-violet-500/50 hover:bg-white/[0.06]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-violet-600/30 border border-violet-400/40 px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-violet-300 font-bold">
                          Day {ev.day} • {ev.timeSlot}
                        </span>
                        <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[8.5px] uppercase tracking-wider text-zinc-300">
                          {ev.category}
                        </span>
                      </div>

                      {ev.prizePool && (
                        <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-amber-400">
                          <Trophy size={11} />
                          <span>{ev.prizePool}</span>
                        </span>
                      )}
                    </div>

                    <h4 className="font-editorial text-lg sm:text-xl font-bold text-white group-hover:text-violet-200 transition-colors">
                      {ev.name}
                    </h4>

                    <p className="mt-1.5 text-xs text-zinc-300 leading-relaxed font-light">
                      {ev.description}
                    </p>

                    <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-4 text-zinc-400 font-mono text-[10px]">
                        <span className="flex items-center gap-1 text-violet-300">
                          <Clock size={11} />
                          <span>{ev.startTime} – {ev.endTime}</span>
                        </span>
                        {ev.room && (
                          <span className="flex items-center gap-1">
                            <MapPin size={11} />
                            <span>{ev.room}</span>
                          </span>
                        )}
                      </div>

                      <Link
                        href={`/events/${ev.category}/${ev.slug}`}
                        className="inline-flex items-center gap-1 rounded-full border border-violet-400/40 bg-violet-600/20 px-3.5 py-1 font-mono text-[9.5px] uppercase tracking-wider text-violet-200 hover:bg-violet-600 hover:text-white transition-all"
                      >
                        <span>Event Details</span>
                        <ArrowUpRight size={11} />
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Modal Footer */}
            <div className="border-t border-white/10 bg-black/60 p-4 px-6 sm:px-8 flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-widest text-zinc-500">
                Saviskar 2026 // 28–29 October 2026
              </span>
              <button
                onClick={() => setActiveVenue(null)}
                className="rounded-full bg-white px-4 py-1.5 font-mono text-xs font-semibold text-black hover:bg-violet-100 transition-all"
              >
                Back to Campus Map
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          SIDE SCHEDULE DRAWER ("WHAT'S ON" QUICK EXPLORER)
      ══════════════════════════════════════════════════════════ */}
      {isScheduleDrawerOpen && (
        <div
          className="fixed inset-y-0 right-0 z-50 w-full sm:w-[450px] bg-zinc-950/95 border-l border-white/15 p-6 backdrop-blur-2xl shadow-2xl flex flex-col animate-slide-left"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between pb-4 border-b border-white/10">
            <div>
              <div className="font-mono text-[9.5px] uppercase tracking-widest text-violet-400">
                FESTIVAL ROSTER
              </div>
              <h3 className="font-editorial text-xl font-bold text-white">
                What&apos;s On ({filteredEvents.length})
              </h3>
            </div>
            <button
              onClick={() => setIsScheduleDrawerOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white hover:text-black transition-all"
            >
              <X size={15} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-4 space-y-3">
            {filteredEvents.map((ev) => {
              const venue = CAMPUS_VENUES.find((v) => v.id === ev.venueId);

              return (
                <div
                  key={ev.id}
                  onClick={() => {
                    if (venue) flyToVenue(venue);
                    setIsScheduleDrawerOpen(false);
                  }}
                  className="group cursor-pointer rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-all hover:border-violet-500/60 hover:bg-white/[0.05]"
                >
                  <div className="flex items-center justify-between text-[9px] font-mono text-zinc-400 mb-1">
                    <span className="text-violet-300 font-semibold">
                      Day {ev.day} • {ev.startTime}
                    </span>
                    <span className="uppercase">{ev.category}</span>
                  </div>
                  <h4 className="font-editorial text-base font-bold text-white group-hover:text-violet-300 transition-colors">
                    {ev.name}
                  </h4>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-400 font-mono">
                    <span className="flex items-center gap-1 text-zinc-300">
                      <MapPin size={11} className="text-violet-400" />
                      <span>{ev.venueName}</span>
                    </span>
                    <span className="text-violet-400 group-hover:translate-x-1 transition-transform">
                      Locate on Map &rarr;
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
