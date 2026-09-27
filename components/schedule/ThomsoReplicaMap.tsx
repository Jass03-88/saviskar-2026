"use client";

import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Compass,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Calendar,
  Clock,
  Trophy,
  ArrowUpRight,
  ChevronRight,
  Building2,
  CalendarDays,
  ListFilter,
  X,
  Sparkles,
  Search,
} from "lucide-react";
import {
  CampusVenue,
  ScheduleEvent,
  CAMPUS_VENUES,
  FESTIVAL_SCHEDULE,
} from "@/data/scheduleData";
import "./ThomsoMap.css";

interface ThomsoReplicaMapProps {
  onSwitchToTimeline?: () => void;
  externalEvents?: ScheduleEvent[];
  initialVenueId?: string | null;
}

export default function ThomsoReplicaMap({
  onSwitchToTimeline,
  externalEvents,
  initialVenueId = null,
}: ThomsoReplicaMapProps) {
  // Use passed events or fallback to festival schedule
  const allEvents = useMemo(() => {
    return externalEvents && externalEvents.length > 0
      ? externalEvents
      : FESTIVAL_SCHEDULE;
  }, [externalEvents]);

  // Active / Selected venue state
  const [activeVenue, setActiveVenue] = useState<CampusVenue | null>(() => {
    if (initialVenueId) {
      return CAMPUS_VENUES.find((v) => v.id === initialVenueId) || null;
    }
    return null;
  });
  const [hoveredVenueId, setHoveredVenueId] = useState<string | null>(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);
  const [selectedDay, setSelectedDay] = useState<number | "all">("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [isRailOpen, setIsRailOpen] = useState<boolean>(true);

  // Camera Zoom & Position (using exact camera math)
  // { tx: translateX %, ty: translateY %, z: zoom scale }
  const [camera, setCamera] = useState<{ tx: number; ty: number; z: number }>({
    tx: 0,
    ty: 0,
    z: 1,
  });

  // Manual pan offset for dragging
  const [manualPan, setManualPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const venueDrawerRef = useRef<HTMLButtonElement>(null);

  // ── 1. CAMERA GLIDE MATH ENGINE ──────────────────────────────────────────
  const calculateCamera = useCallback(
    (venue: CampusVenue, targetZ: number, originX: number = 50, originY: number = 50) => {
      const limit = 50 * (targetZ - 1);
      const clamp = (val: number) => Math.max(-limit, Math.min(limit, val));
      return {
        tx: clamp(originX - 50 - targetZ * (venue.coordinates.x - 50)),
        ty: clamp(originY - 50 - targetZ * (venue.coordinates.y - 50)),
        z: targetZ,
      };
    },
    []
  );

  // Focus camera when active venue changes or hovers
  useEffect(() => {
    if (activeVenue) {
      // Side drawer logic: If building is on left (x < 50), drawer is on right side
      // Shift building towards right (originX = 26) so it's not obscured by the drawer
      const originX = activeVenue.coordinates.x < 50 ? 26 : 74;
      setCamera(calculateCamera(activeVenue, 1.7, originX, 50));
      setManualPan({ x: 0, y: 0 });
      // Focus back button for accessibility
      setTimeout(() => {
        venueDrawerRef.current?.focus();
      }, 300);
    } else if (hoveredVenueId) {
      const v = CAMPUS_VENUES.find((ven) => ven.id === hoveredVenueId);
      if (v) {
        setCamera(calculateCamera(v, 1.4, 50, 50));
      }
    } else {
      setCamera({ tx: 0, ty: 0, z: 1 });
    }
  }, [activeVenue, hoveredVenueId, calculateCamera]);

  // ── 2. MOUSE PARALLAX ENGINE ─────────────────────────────────────────────
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let lastTime = performance.now();
    let animId: number;

    const handlePointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      targetX = (e.clientX / window.innerWidth - 0.5) * 2;
      targetY = (e.clientY / window.innerHeight - 0.5) * 2;
    };

    const handlePointerLeave = () => {
      targetX = 0;
      targetY = 0;
    };

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      const decay = 1 - Math.exp(-7 * dt);
      currentX += (targetX - currentX) * decay;
      currentY += (targetY - currentY) * decay;

      root.style.setProperty("--px", currentX.toFixed(4));
      root.style.setProperty("--py", currentY.toFixed(4));
      animId = requestAnimationFrame(loop);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    document.addEventListener("pointerleave", handlePointerLeave);
    animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, []);

  // ── 3. FILTERED EVENTS & VENUE COUNTERS ────────────────────────────────────
  const filteredEvents = useMemo(() => {
    return allEvents.filter((ev) => {
      if (selectedDay !== "all" && ev.day !== selectedDay) return false;
      if (selectedCategory !== "all" && ev.category !== selectedCategory) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = ev.name.toLowerCase().includes(q);
        const matchesVenue = ev.venueName.toLowerCase().includes(q);
        const matchesDesc = ev.description.toLowerCase().includes(q);
        const matchesCat = ev.category.toLowerCase().includes(q);
        if (!matchesName && !matchesVenue && !matchesDesc && !matchesCat) return false;
      }
      return true;
    });
  }, [allEvents, selectedDay, selectedCategory, searchQuery]);

  // Venue event counts
  const venueEventCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredEvents.forEach((ev) => {
      counts[ev.venueId] = (counts[ev.venueId] || 0) + 1;
    });
    return counts;
  }, [filteredEvents]);

  // Search matching venue IDs for pin highlight/dim
  const matchingVenueIds = useMemo(() => {
    if (!searchQuery.trim()) return null;
    return new Set(filteredEvents.map((ev) => ev.venueId));
  }, [filteredEvents, searchQuery]);

  // Autocomplete suggestions
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return allEvents
      .filter((ev) => {
        const q = searchQuery.toLowerCase();
        return (
          ev.name.toLowerCase().includes(q) ||
          ev.venueName.toLowerCase().includes(q) ||
          ev.category.toLowerCase().includes(q)
        );
      })
      .slice(0, 8);
  }, [allEvents, searchQuery]);

  // ── 4. PANNING & ZOOMING INTERACTION HANDLERS ─────────────────────────────
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - manualPan.x, y: e.clientY - manualPan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setManualPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleZoomIn = () => {
    setCamera((prev) => ({ ...prev, z: Math.min(prev.z + 0.35, 2.6) }));
  };

  const handleZoomOut = () => {
    setCamera((prev) => ({ ...prev, z: Math.max(prev.z - 0.35, 0.8) }));
  };

  const handleResetCamera = () => {
    setActiveVenue(null);
    setHoveredVenueId(null);
    setManualPan({ x: 0, y: 0 });
    setCamera({ tx: 0, ty: 0, z: 1 });
  };

  // Keyboard shortcut: Escape to close venue drawer or search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (activeVenue) {
          setActiveVenue(null);
        } else if (isSearchFocused) {
          setIsSearchFocused(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeVenue, isSearchFocused]);

  // Fly to venue on click
  const handleFlyToVenue = (venue: CampusVenue) => {
    setActiveVenue(venue);
    setIsSearchFocused(false);
    setSearchQuery("");
  };

  // Active venue events
  const activeVenueEvents = useMemo(() => {
    if (!activeVenue) return [];
    return allEvents.filter((ev) => ev.venueId === activeVenue.id);
  }, [activeVenue, allEvents]);

  // Determine drawer orientation based on venue coordinates
  const isDrawerOnRight = activeVenue ? activeVenue.coordinates.x < 50 : false;

  const getVenueAccent = (venue: CampusVenue) => {
    switch (venue.accentColor) {
      case "amber":
        return { color: "#f59e0b", glow: "rgba(245, 158, 11, 0.45)" };
      case "cyan":
        return { color: "#06b6d4", glow: "rgba(6, 182, 212, 0.45)" };
      case "emerald":
        return { color: "#10b981", glow: "rgba(16, 185, 129, 0.45)" };
      case "rose":
        return { color: "#f43f5e", glow: "rgba(244, 63, 94, 0.45)" };
      case "fuchsia":
        return { color: "#d946ef", glow: "rgba(217, 70, 239, 0.45)" };
      default:
        return { color: "#a855f7", glow: "rgba(168, 85, 247, 0.45)" };
    }
  };

  return (
    <div
      ref={rootRef}
      className={`camp-root ${activeVenue ? "is-open" : ""} ${
        isRailOpen ? "has-rail" : ""
      }`}
      style={
        {
          "--z": camera.z,
        } as React.CSSProperties
      }
    >
      {/* ══════════════════════════════════════════════════════════
          1. FLOATING LIQUID-GLASS COMMAND & FILTER BAR
          Sits centered beneath the site's top Navbar
      ══════════════════════════════════════════════════════════ */}
      {!activeVenue && (
        <div className="camp__control-bar">
          {/* Centered Search Input Pill */}
          <div className="camp__search" role="search">
            <label className="camp__field">
              <span className="camp__icon" aria-hidden="true">
                <Search size={15} className="text-violet-400" />
              </span>
              <input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                placeholder="Search an Event or Venue..."
                aria-label="Search festival events"
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="camp__clear"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear search"
                >
                  &times;
                </button>
              )}
            </label>

            {/* Live Autocomplete Results */}
            {isSearchFocused && searchQuery.trim() && (
              <div
                className="camp__results"
                onMouseDown={(e) => e.preventDefault()}
              >
                {searchResults.length === 0 ? (
                  <p className="camp__none">
                    No competitions or venues match &ldquo;{searchQuery}&rdquo;
                  </p>
                ) : (
                  <ul>
                    {searchResults.map((item) => {
                      const venue = CAMPUS_VENUES.find((v) => v.id === item.venueId);
                      return (
                        <li key={`search-${item.id}`}>
                          <button
                            type="button"
                            onClick={() => {
                              if (venue) handleFlyToVenue(venue);
                            }}
                          >
                            <span className="camp__hitTitle">{item.name}</span>
                            <span className="camp__hitDay">Day {item.day}</span>
                            <span className="camp__hitAt">{item.venueName}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Day Filter Pills */}
          <div className="hidden sm:flex items-center rounded-full border border-white/15 bg-black/60 p-1 backdrop-blur-xl shadow-lg pointer-events-auto">
            {[
              { id: "all", label: "All Days" },
              { id: 1, label: "Day 1 (28 Oct)" },
              { id: 2, label: "Day 2 (29 Oct)" },
            ].map((d) => (
              <button
                key={d.id}
                onClick={() => setSelectedDay(d.id as number | "all")}
                className={`rounded-full px-3 py-1 font-mono text-[9px] uppercase tracking-wider transition-all duration-300 ${
                  selectedDay === d.id
                    ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-bold shadow-[0_0_12px_rgba(168,85,247,0.5)] scale-105"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>

          {/* Toggle "What's on" Rail Drawer */}
          <button
            onClick={() => setIsRailOpen(!isRailOpen)}
            className={`pointer-events-auto flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 font-mono text-[9.5px] uppercase tracking-wider backdrop-blur-xl transition-all ${
              isRailOpen
                ? "border-violet-400/60 bg-violet-950/40 text-violet-300 shadow-[0_0_15px_rgba(168,85,247,0.3)]"
                : "border-white/15 bg-black/60 text-zinc-300 hover:text-white"
            }`}
          >
            <ListFilter size={12} className="text-violet-400" />
            <span className="hidden sm:inline">What&apos;s On</span>
            <span className="rounded-full bg-white/10 px-1.5 py-0.2 text-[8.5px] font-bold">
              {filteredEvents.length}
            </span>
          </button>

          {/* Timeline View Switcher Button */}
          {onSwitchToTimeline && (
            <button
              onClick={onSwitchToTimeline}
              className="pointer-events-auto hidden md:flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-3.5 py-1.5 font-mono text-[9.5px] uppercase tracking-wider text-zinc-300 backdrop-blur-xl hover:text-white hover:border-violet-400/40 transition-all"
            >
              <CalendarDays size={12} className="text-violet-400" />
              <span>Timeline Matrix</span>
            </button>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          2. MAIN MAP CONTAINER (Full Viewport + Plains Setting)
      ══════════════════════════════════════════════════════════ */}
      <div className="relative flex-1 w-full h-full overflow-hidden">
        {/* ── A. FLOATING LEFT "WHAT'S ON" RAIL (.rail) ── */}
        {isRailOpen && !activeVenue && (
          <aside className="rail" aria-label="Events happening around the campus">
            <p className="rail__head">
              <span className="rail__pulse" aria-hidden="true" />
              <span>What&apos;s on ({filteredEvents.length})</span>
              <Link href="/events" className="rail__all">
                <span>Realms</span>
                <span aria-hidden="true">&rarr;</span>
              </Link>
            </p>

            {/* Quick Category Filter Pills in Rail */}
            <div className="pointer-events-auto flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
              {[
                { id: "all", label: "All" },
                { id: "technical", label: "Tech" },
                { id: "cultural", label: "Arts" },
                { id: "non-technical", label: "Non-Tech" },
                { id: "sports", label: "Sports" },
              ].map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCategory(c.id)}
                  className={`flex-shrink-0 rounded-full px-2.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wider transition-all ${
                    selectedCategory === c.id
                      ? "bg-violet-500 text-white font-bold shadow-[0_0_10px_rgba(168,85,247,0.5)]"
                      : "bg-black/60 border border-white/10 text-zinc-400 hover:text-white"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Drifting Viewport */}
            <div className="rail__viewport">
              <ul
                className="rail__track"
                style={
                  {
                    "--rail-dur": `${Math.max(35, filteredEvents.length * 4.5)}s`,
                    "--rail-copies": 2,
                  } as React.CSSProperties
                }
              >
                {filteredEvents.map((ev, idx) => {
                  const venue = CAMPUS_VENUES.find((v) => v.id === ev.venueId);
                  const accent = venue ? getVenueAccent(venue) : { color: "#a855f7", glow: "rgba(168,85,247,0.4)" };

                  return (
                    <li key={`track-1-${ev.id}-${idx}`} className="rail__item">
                      <button
                        type="button"
                        className="rail__card"
                        style={
                          {
                            "--accent": accent.color,
                            "--accent-glow": accent.glow,
                          } as React.CSSProperties
                        }
                        onClick={() => {
                          if (venue) handleFlyToVenue(venue);
                        }}
                        onMouseEnter={() => setHoveredVenueId(ev.venueId)}
                        onMouseLeave={() => setHoveredVenueId(null)}
                      >
                        <span className="rail__top">
                          <span className="rail__dot" aria-hidden="true" />
                          <span className="rail__kind">{ev.category}</span>
                          <span className="rail__day">Day {ev.day}</span>
                        </span>
                        <span className="rail__title">{ev.name}</span>
                        <span className="rail__where">{ev.venueName}</span>
                      </button>
                    </li>
                  );
                })}

                {/* Duplicated list for infinite seamless loop */}
                {filteredEvents.map((ev, idx) => {
                  const venue = CAMPUS_VENUES.find((v) => v.id === ev.venueId);
                  const accent = venue ? getVenueAccent(venue) : { color: "#a855f7", glow: "rgba(168,85,247,0.4)" };

                  return (
                    <li key={`track-2-${ev.id}-${idx}`} className="rail__item">
                      <button
                        type="button"
                        className="rail__card"
                        style={
                          {
                            "--accent": accent.color,
                            "--accent-glow": accent.glow,
                          } as React.CSSProperties
                        }
                        onClick={() => {
                          if (venue) handleFlyToVenue(venue);
                        }}
                        onMouseEnter={() => setHoveredVenueId(ev.venueId)}
                        onMouseLeave={() => setHoveredVenueId(null)}
                      >
                        <span className="rail__top">
                          <span className="rail__dot" aria-hidden="true" />
                          <span className="rail__kind">{ev.category}</span>
                          <span className="rail__day">Day {ev.day}</span>
                        </span>
                        <span className="rail__title">{ev.name}</span>
                        <span className="rail__where">{ev.venueName}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </aside>
        )}

        {/* ── B. INTERACTIVE MAP STAGE & PURE HTML OVERLAYS ── */}
        <div
          className="camp__frame"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ cursor: isDragging ? "grabbing" : "grab" }}
        >
          {/* Day Scene Ambient Elements: Sunlight beam, plains grid & cosmic nebula */}
          <div className="camp__sunbeam" aria-hidden="true" />
          <div className="camp__nebula" aria-hidden="true" />
          <div className="camp__plains-grid" aria-hidden="true" />

          {/* Map Stage Frame */}
          <div className="camp__fit">
            <div
              ref={stageRef}
              className="camp__stage"
              style={{
                transform: `translate(${camera.tx}%, ${camera.ty}%) scale(${camera.z}) translate(${manualPan.x}px, ${manualPan.y}px)`,
              }}
            >
              {/* 
                STRICT CONSTRAINT: 
                "DONOT WRITE ANYTHING OVER IMAGE USE HTML OR ANY LANGUAGE TO GIVE NAMES AND OTHER ELEMNTS OVER THE IMAGE."
                The image below is 100% clean with ZERO baked text.
              */}
              <Image
                src="/images/map/cgc-campus-map.webp"
                alt="CGC University Mohali Campus Grounds"
                width={1024}
                height={692}
                priority
                className="camp__film"
                unoptimized
              />

              {/* ══════════════════════════════════════════════════════════
                  PURE HTML/CSS VENUE PINS (.pin)
                  Liquid glass capsule, neon indicator dot, serif name
              ══════════════════════════════════════════════════════════ */}
              <div
                className="camp__pins"
                onPointerLeave={() => setHoveredVenueId(null)}
              >
                {CAMPUS_VENUES.map((venue) => {
                  const eventCount = venueEventCounts[venue.id] || 0;
                  const isHovered = hoveredVenueId === venue.id;
                  const isWalked = activeVenue?.id === venue.id;
                  const isFlipped = venue.coordinates.x > 55;

                  // Search reactive states
                  const isFound = matchingVenueIds ? matchingVenueIds.has(venue.id) : false;
                  const isDim = matchingVenueIds ? !matchingVenueIds.has(venue.id) : false;

                  const accent = getVenueAccent(venue);

                  return (
                    <button
                      key={venue.id}
                      type="button"
                      style={
                        {
                          left: `${venue.coordinates.x}%`,
                          top: `${venue.coordinates.y}%`,
                          "--accent": accent.color,
                          "--accent-glow": accent.glow,
                        } as React.CSSProperties
                      }
                      className={`pin ${isFlipped ? "is-flipped" : ""} ${
                        isFound ? "is-found" : ""
                      } ${isDim ? "is-dim" : ""} ${isHovered ? "is-hot" : ""} ${
                        isWalked ? "is-walked" : ""
                      }`}
                      onPointerEnter={(e) => {
                        if (e.pointerType !== "touch") setHoveredVenueId(venue.id);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFlyToVenue(venue);
                      }}
                      aria-label={`${venue.name} — ${eventCount} events`}
                    >
                      {/* Central Glowing Dot */}
                      <span className="pin__dot" aria-hidden="true" />

                      {/* Liquid Glass Capsule Tag */}
                      <span className="pin__label">
                        <span className="pin__name">{venue.shortName}</span>
                        {eventCount > 0 && (
                          <span className="pin__count">{eventCount}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Vignette */}
          <div className="camp__vignette" aria-hidden="true" />

          {/* Bottom Hint */}
          <p
            className={`camp__hint ${
              activeVenue || hoveredVenueId || searchQuery ? "is-spent" : ""
            }`}
          >
            Hover a venue to fly to it &middot; Click to walk in
          </p>

          {/* ── C. MAP CONTROLS HUD (Zoom In, Zoom Out, Recenter) ── */}
          <div className="absolute bottom-6 left-6 z-30 flex flex-col gap-2">
            <div className="flex flex-col rounded-2xl border border-white/15 bg-black/80 p-1 shadow-2xl backdrop-blur-xl">
              <button
                type="button"
                onClick={handleZoomIn}
                title="Zoom In"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-white/80 hover:bg-violet-600/30 hover:text-white transition-all"
              >
                <ZoomIn size={16} />
              </button>
              <div className="h-px w-full bg-white/10 my-0.5" />
              <button
                type="button"
                onClick={handleZoomOut}
                title="Zoom Out"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-white/80 hover:bg-violet-600/30 hover:text-white transition-all"
              >
                <ZoomOut size={16} />
              </button>
              <div className="h-px w-full bg-white/10 my-0.5" />
              <button
                type="button"
                onClick={handleResetCamera}
                title="Recenter Campus Grounds"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-white/80 hover:bg-violet-600/30 hover:text-white transition-all"
              >
                <RotateCcw size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════
            3. VENUE SIDE DRAWER (.venue & .venue--right)
            Slides in opposite to building with event schedule matrix
        ══════════════════════════════════════════════════════════ */}
        {activeVenue && (
          <div
            className={`venue ${isDrawerOnRight ? "venue--right" : ""}`}
            style={
              {
                "--accent": getVenueAccent(activeVenue).color,
                "--accent-glow": getVenueAccent(activeVenue).glow,
              } as React.CSSProperties
            }
            onClick={() => setActiveVenue(null)}
          >
            <div
              className="venue__body"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Back to Campus Button */}
              <button
                ref={venueDrawerRef}
                type="button"
                className="venue__back"
                onClick={() => setActiveVenue(null)}
              >
                <span aria-hidden="true">&larr;</span>
                <span>The Campus</span>
              </button>

              {/* Venue Header */}
              <header className="venue__head">
                <p className="venue__role">{activeVenue.pinBadge}</p>
                <h2 className="venue__name">{activeVenue.name}</h2>
                <p className="venue__tagline">{activeVenue.tagline}</p>
                <p className="venue__count">
                  {activeVenueEvents.length}{" "}
                  {activeVenueEvents.length === 1 ? "Competition" : "Competitions"}{" "}
                  Scheduled
                </p>
              </header>

              {/* Competitions List */}
              <ol className="venue__list">
                {activeVenueEvents.length === 0 ? (
                  <li className="py-8 text-center text-zinc-500 font-mono text-xs">
                    No competitions scheduled in this pavilion yet.
                  </li>
                ) : (
                  activeVenueEvents.map((ev) => (
                    <li key={`venue-event-${ev.id}`} className="venue__row">
                      {/* When: Day & Time */}
                      <div className="venue__when">
                        <span className="venue__day">Day {ev.day}</span>
                        <span className="venue__time">{ev.startTime}</span>
                      </div>

                      {/* What: Title, Category, Description */}
                      <div className="venue__what">
                        <h3>{ev.name}</h3>
                        <div className="flex items-center gap-2 flex-wrap mt-0.5">
                          <p className="venue__kind">{ev.category}</p>
                          {ev.room && (
                            <span className="font-mono text-[10px] text-zinc-300 bg-white/[0.08] px-2 py-0.5 rounded-full border border-white/10">
                              📍 {ev.room}
                            </span>
                          )}
                        </div>
                        {ev.description && (
                          <p className="venue__blurb">{ev.description}</p>
                        )}
                        {ev.prizePool && (
                          <div className="mt-2 inline-flex items-center gap-1.5 font-mono text-[10px] text-amber-300">
                            <Trophy size={11} className="text-amber-400" />
                            <span>Prize Pool: {ev.prizePool}</span>
                          </div>
                        )}
                      </div>

                      {/* Register Button */}
                      <Link
                        href={`/events/${ev.category}/${ev.slug}`}
                        className="venue__add"
                      >
                        Register &rarr;
                      </Link>
                    </li>
                  ))
                )}
              </ol>

              {/* Building Facilities Footer */}
              {activeVenue.facilities && (
                <div className="mt-8 pt-6 border-t border-white/10">
                  <div className="font-mono text-[9px] uppercase tracking-widest text-zinc-400 mb-2">
                    Pavilion Facilities
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {activeVenue.facilities.map((fac, i) => (
                      <span
                        key={i}
                        className="rounded-full bg-white/[0.05] border border-white/10 px-2.5 py-0.5 font-mono text-[9px] text-zinc-300"
                      >
                        {fac}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
