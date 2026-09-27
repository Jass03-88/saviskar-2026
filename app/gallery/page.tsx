"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Film,
  Image as ImageIcon,
  Play,
  Radio,
  Sparkles,
  Tv,
  X,
  Layers,
  MapPin,
  Flame,
  Volume2,
} from "lucide-react";

function YoutubeIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

/**
 * High-performance gallery image with animated shimmer placeholder,
 * asynchronous decoding, and graceful fade-in
 */
function GalleryCardImage({
  src,
  alt,
  className = "",
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="relative h-full w-full overflow-hidden bg-neutral-900/80">
      {/* Animated violet/neutral shimmer skeleton while downloading */}
      {!loaded && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-gradient-to-r from-neutral-900 via-violet-950/25 to-neutral-900 animate-pulse">
          <ImageIcon size={26} className="text-white/20 animate-pulse" />
        </div>
      )}
      <Image
        src={src}
        alt={alt}
        fill
        unoptimized
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        onLoad={() => setLoaded(true)}
        className={`${className} transition-all duration-500 ease-out ${
          loaded ? "opacity-100 scale-100 blur-0" : "opacity-0 scale-105 blur-sm"
        }`}
      />
    </div>
  );
}

import Navbar from "@/components/ui/Navbar";
import Preloader from "@/components/ui/Preloader";
import {
  GALLERY_IMAGES,
  GALLERY_VIDEOS,
  PHOTO_CATEGORIES,
  VIDEO_CATEGORIES,
  YOUTUBE_CHANNEL_META,
  type GalleryImage,
  type GalleryVideo,
} from "@/data/galleryData";

type MediaTypeTab = "all" | "photos" | "videos";
const PAGE_SIZE = 18;

export default function RedesignedGalleryPage() {
  const [mediaTab, setMediaTab] = useState<MediaTypeTab>("all");
  const [photoCategory, setPhotoCategory] = useState<string>("All");
  const [videoCategory, setVideoCategory] = useState<string>("All");
  const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE);
  const [isLightboxLoaded, setIsLightboxLoaded] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Dynamic Google Drive Photos State
  const [photos, setPhotos] = useState<GalleryImage[]>(GALLERY_IMAGES);
  const [isDriveStreaming, setIsDriveStreaming] = useState<boolean>(false);

  useEffect(() => {
    fetch("/api/gallery/drive?source=main")
      .then((res) => res.json())
      .then((data) => {
        if (data && data.items && Array.isArray(data.items) && data.items.length > 0) {
          setPhotos(data.items);
          if (data.isExternal) {
            setIsDriveStreaming(true);
          }
        }
      })
      .catch((err) => console.error("Error fetching drive gallery:", err));
  }, []);

  // Reset pagination on category or media tab change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [mediaTab, photoCategory, videoCategory]);

  // Lightbox & Theater Modals
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [activeTheaterVideo, setActiveTheaterVideo] = useState<GalleryVideo | null>(null);

  // Reset lightbox loading status on photo navigation
  useEffect(() => {
    setIsLightboxLoaded(false);
  }, [selectedPhotoIndex]);

  // Infinite scroll intersection observer sentinel
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => prev + PAGE_SIZE);
        }
      },
      { rootMargin: "600px 0px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [mediaTab, photoCategory, videoCategory]);

  // Filtered Media
  const filteredPhotos = useMemo(() => {
    if (photoCategory === "All") return photos;
    return photos.filter((img) => img.category === photoCategory);
  }, [photos, photoCategory]);

  const filteredVideos = useMemo(() => {
    if (videoCategory === "All") return GALLERY_VIDEOS;
    return GALLERY_VIDEOS.filter((vid) => vid.category === videoCategory);
  }, [videoCategory]);

  // Combined Media Items for "All" Tab
  type CombinedItem =
    | { type: "photo"; data: GalleryImage; index: number }
    | { type: "video"; data: GalleryVideo; index: number };

  const combinedItems = useMemo<CombinedItem[]>(() => {
    const list: CombinedItem[] = [];
    let pIdx = 0;
    let vIdx = 0;

    // Interleave with priority on high-impact rhythm: 2 photos, 1 video
    while (pIdx < filteredPhotos.length || vIdx < filteredVideos.length) {
      if (pIdx < filteredPhotos.length) {
        list.push({ type: "photo", data: filteredPhotos[pIdx], index: pIdx });
        pIdx++;
      }
      if (pIdx < filteredPhotos.length) {
        list.push({ type: "photo", data: filteredPhotos[pIdx], index: pIdx });
        pIdx++;
      }
      if (vIdx < filteredVideos.length) {
        list.push({ type: "video", data: filteredVideos[vIdx], index: vIdx });
        vIdx++;
      }
    }
    return list;
  }, [filteredPhotos, filteredVideos]);

  // Sliced lists for progressive fast rendering
  const visibleCombinedItems = useMemo(
    () => combinedItems.slice(0, visibleCount),
    [combinedItems, visibleCount]
  );

  const visiblePhotos = useMemo(
    () => filteredPhotos.slice(0, visibleCount),
    [filteredPhotos, visibleCount]
  );

  const visibleVideos = useMemo(
    () => filteredVideos.slice(0, visibleCount),
    [filteredVideos, visibleCount]
  );

  const currentTotal =
    mediaTab === "all"
      ? combinedItems.length
      : mediaTab === "photos"
      ? filteredPhotos.length
      : filteredVideos.length;

  const currentVisible = Math.min(visibleCount, currentTotal);

  // Selected photo for Lightbox
  const activePhoto =
    selectedPhotoIndex !== null ? filteredPhotos[selectedPhotoIndex] : null;

  const nextPhoto = useCallback(() => {
    setSelectedPhotoIndex((prev) => {
      if (prev === null) return null;
      return (prev + 1) % filteredPhotos.length;
    });
  }, [filteredPhotos.length]);

  const prevPhoto = useCallback(() => {
    setSelectedPhotoIndex((prev) => {
      if (prev === null) return null;
      return (prev - 1 + filteredPhotos.length) % filteredPhotos.length;
    });
  }, [filteredPhotos.length]);

  // Next / Prev Video in Theater
  const nextVideo = useCallback(() => {
    if (!activeTheaterVideo) return;
    const currentIndex = GALLERY_VIDEOS.findIndex((v) => v.id === activeTheaterVideo.id);
    const nextIdx = (currentIndex + 1) % GALLERY_VIDEOS.length;
    setActiveTheaterVideo(GALLERY_VIDEOS[nextIdx]);
  }, [activeTheaterVideo]);

  const prevVideo = useCallback(() => {
    if (!activeTheaterVideo) return;
    const currentIndex = GALLERY_VIDEOS.findIndex((v) => v.id === activeTheaterVideo.id);
    const prevIdx = (currentIndex - 1 + GALLERY_VIDEOS.length) % GALLERY_VIDEOS.length;
    setActiveTheaterVideo(GALLERY_VIDEOS[prevIdx]);
  }, [activeTheaterVideo]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedPhotoIndex(null);
        setActiveTheaterVideo(null);
      }
      if (selectedPhotoIndex !== null) {
        if (e.key === "ArrowRight") nextPhoto();
        if (e.key === "ArrowLeft") prevPhoto();
      }
      if (activeTheaterVideo !== null) {
        if (e.key === "ArrowRight") nextVideo();
        if (e.key === "ArrowLeft") prevVideo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedPhotoIndex, activeTheaterVideo, nextPhoto, prevPhoto, nextVideo, prevVideo]);

  return (
    <main className="relative min-h-screen bg-[#040407] text-white selection:bg-violet-500 selection:text-white">
      {/* Cinematic Asset Preloader for Gallery Archive */}
      <Preloader mode="gallery" minDurationSeconds={1.2} />

      {/* Universal Navigation */}
      <Navbar />

      {/* Atmospheric Volumetric Nebula Lighting */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div className="absolute -top-32 left-[10%] h-[700px] w-[700px] rounded-full bg-violet-600/12 blur-[190px]" />
        <div className="absolute top-[35%] right-[5%] h-[650px] w-[650px] rounded-full bg-fuchsia-600/10 blur-[180px]" />
        <div className="absolute bottom-[10%] left-[25%] h-[600px] w-[600px] rounded-full bg-cyan-600/10 blur-[190px]" />
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: `radial-gradient(rgba(255, 255, 255, 0.4) 1px, transparent 1px)`,
            backgroundSize: "28px 28px",
          }}
        />
      </div>

      {/* Hero Header Section */}
      <section className="relative z-10 mx-auto max-w-[1440px] px-6 pt-28 md:px-12 md:pt-36">
        {/* Navigation & Telemetry Badges */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/"
            className="group inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium text-white/70 backdrop-blur-md transition-all hover:border-violet-400/50 hover:bg-white/[0.08] hover:text-white"
          >
            <ArrowLeft size={14} className="transition-transform group-hover:-translate-x-0.5" />
            <span>Return to Command</span>
          </Link>

          <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-950/30 px-3.5 py-1.5 font-mono text-[11px] tracking-wider text-violet-300 backdrop-blur-md">
            <Radio size={12} className="animate-pulse text-cyan-400" />
            <span>
              {isDriveStreaming
                ? "GOOGLE DRIVE CDN STREAM // ACTIVE"
                : "AEVORIAN ARCHIVES // LIVE DISPATCH"}
            </span>
          </div>
        </div>

        {/* Title & Headline */}
        <div className="mt-8 max-w-4xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-violet-300">
            <Sparkles size={12} className="text-violet-400" />
            Official Visual &amp; Cinematic Chronicle
          </div>

          <h1 className="mt-4 text-4xl font-extralight tracking-tight text-white sm:text-6xl md:text-7xl lg:text-8xl">
            Moments in <br className="hidden sm:inline" />
            <span className="font-semibold bg-gradient-to-r from-violet-200 via-fuchsia-300 to-cyan-300 bg-clip-text text-transparent">
              Perpetual Motion.
            </span>
          </h1>

          <p className="mt-6 max-w-2xl text-base leading-relaxed text-white/60 md:text-lg">
            Immerse yourself in high-definition chronicles of stadium concerts, combat robotics realms,
            automotive exhibitions, and official video dispatches from North India&apos;s flagship
            techno-cultural university festival at CGC University, Mohali.
          </p>
        </div>

        {/* Telemetry Stat Counters */}
        <div className="mt-10 grid grid-cols-2 gap-3 border-y border-white/10 py-6 sm:grid-cols-4 md:gap-6">
          <div className="border-l border-violet-500/40 pl-4">
            <div className="font-mono text-2xl font-bold text-white md:text-3xl">
              {photos.length}+
            </div>
            <div className="text-xs uppercase tracking-wider text-white/40">Curated Stills</div>
          </div>
          <div className="border-l border-fuchsia-500/40 pl-4">
            <div className="font-mono text-2xl font-bold text-white md:text-3xl">08</div>
            <div className="text-xs uppercase tracking-wider text-white/40">Cinematic Dispatches</div>
          </div>
          <div className="border-l border-cyan-500/40 pl-4">
            <div className="font-mono text-2xl font-bold text-white md:text-3xl">50+</div>
            <div className="text-xs uppercase tracking-wider text-white/40">Realms Captured</div>
          </div>
          <div className="border-l border-amber-500/40 pl-4">
            <div className="font-mono text-2xl font-bold text-white md:text-3xl">25K+</div>
            <div className="text-xs uppercase tracking-wider text-white/40">Audience Pulse</div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════
            OFFICIAL YOUTUBE BROADCAST SPOTLIGHT
        ═══════════════════════════════════════════════════════ */}
        <div className="mt-10 relative overflow-hidden rounded-[28px] border border-red-500/25 bg-gradient-to-br from-red-950/20 via-black/80 to-violet-950/20 p-6 md:p-8 backdrop-blur-xl">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-red-600/10 blur-[80px]" />

          <div className="relative z-10 flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-red-600 text-white shadow-[0_0_20px_rgba(220,38,38,0.5)]">
                  <YoutubeIcon size={18} />
                </span>
                <span className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-red-400">
                  {YOUTUBE_CHANNEL_META.badge}
                </span>
              </div>

              <h2 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
                {YOUTUBE_CHANNEL_META.name}{" "}
                <span className="text-sm font-normal text-white/40">({YOUTUBE_CHANNEL_META.handle})</span>
              </h2>

              <p className="mt-2 text-sm leading-relaxed text-white/60">
                {YOUTUBE_CHANNEL_META.description}
              </p>

              <div className="mt-3 flex items-center gap-4 text-xs font-mono text-white/40">
                <span className="flex items-center gap-1.5">
                  <Flame size={13} className="text-red-400" />
                  {YOUTUBE_CHANNEL_META.stats}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setMediaTab("videos");
                  setActiveTheaterVideo(GALLERY_VIDEOS[0]);
                }}
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-xs font-semibold text-black shadow-[0_0_25px_rgba(255,255,255,0.3)] transition-all hover:bg-neutral-200 hover:scale-[1.02]"
              >
                <Play size={14} className="fill-black" />
                <span>Play Anthem Reel</span>
              </button>

              <a
                href={YOUTUBE_CHANNEL_META.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-red-500/40 bg-red-950/30 px-5 py-2.5 text-xs font-semibold text-red-200 transition-all hover:border-red-400 hover:bg-red-900/50 hover:text-white"
              >
                <YoutubeIcon size={14} />
                <span>Subscribe on YouTube</span>
                <ExternalLink size={12} className="opacity-70" />
              </a>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════
            PRIMARY MEDIA TYPE SWITCHER
        ═══════════════════════════════════════════════════════ */}
        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6">
          <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1 backdrop-blur-md">
            <button
              type="button"
              onClick={() => setMediaTab("all")}
              className={`flex items-center gap-2 rounded-full px-5 py-2 text-xs font-medium transition-all ${
                mediaTab === "all"
                  ? "bg-white text-black font-semibold shadow-[0_0_20px_rgba(255,255,255,0.4)]"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <Layers size={14} />
              <span>All Media ({GALLERY_IMAGES.length + GALLERY_VIDEOS.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setMediaTab("photos")}
              className={`flex items-center gap-2 rounded-full px-5 py-2 text-xs font-medium transition-all ${
                mediaTab === "photos"
                  ? "bg-white text-black font-semibold shadow-[0_0_20px_rgba(255,255,255,0.4)]"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <ImageIcon size={14} />
              <span>Photographs ({GALLERY_IMAGES.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setMediaTab("videos")}
              className={`flex items-center gap-2 rounded-full px-5 py-2 text-xs font-medium transition-all ${
                mediaTab === "videos"
                  ? "bg-red-500 text-white font-semibold shadow-[0_0_25px_rgba(239,68,68,0.5)]"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <Film size={14} />
              <span>Cinematic Videos ({GALLERY_VIDEOS.length})</span>
            </button>
          </div>

          <div className="font-mono text-xs text-white/40">
            {mediaTab === "photos" && `${currentVisible} of ${filteredPhotos.length} FRAMES VISIBLE`}
            {mediaTab === "videos" && `${currentVisible} of ${filteredVideos.length} REELS VISIBLE`}
            {mediaTab === "all" && `${currentVisible} of ${combinedItems.length} ARTIFACTS VISIBLE`}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════
            SECONDARY CATEGORY PILL FILTER
        ═══════════════════════════════════════════════════════ */}
        {mediaTab === "photos" && (
          <div className="mt-6 flex flex-wrap gap-2">
            {PHOTO_CATEGORIES.map((cat) => {
              const active = photoCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setPhotoCategory(cat)}
                  className={`rounded-full px-4 py-1.5 text-xs transition-all ${
                    active
                      ? "border border-violet-400 bg-violet-500/20 text-white font-medium shadow-[0_0_15px_rgba(168,85,247,0.3)]"
                      : "border border-white/10 bg-white/[0.02] text-white/50 hover:border-white/20 hover:text-white"
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        )}

        {mediaTab === "videos" && (
          <div className="mt-6 flex flex-wrap gap-2">
            {VIDEO_CATEGORIES.map((cat) => {
              const active = videoCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setVideoCategory(cat)}
                  className={`rounded-full px-4 py-1.5 text-xs transition-all ${
                    active
                      ? "border border-red-500 bg-red-500/20 text-white font-medium shadow-[0_0_15px_rgba(239,68,68,0.3)]"
                      : "border border-white/10 bg-white/[0.02] text-white/50 hover:border-white/20 hover:text-white"
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════
          SHOWCASE GRID (FAST PROGRESSIVE RENDERING)
      ═══════════════════════════════════════════════════════ */}
      <section className="relative z-10 mx-auto max-w-[1440px] px-6 py-12 md:px-12 md:py-16">
        {/* ALL MEDIA TAB */}
        {mediaTab === "all" && (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {visibleCombinedItems.map((item, idx) => {
              if (item.type === "photo") {
                const img = item.data;
                const isWide = img.featured || img.aspectRatio === "wide";
                return (
                  <motion.div
                    key={`photo-${img.id}`}
                    layout
                    initial={{ opacity: 0, y: 25 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: (idx % 9) * 0.03, duration: 0.35 }}
                    onClick={() => {
                      const actualIdx = filteredPhotos.findIndex((p) => p.id === img.id);
                      setSelectedPhotoIndex(actualIdx >= 0 ? actualIdx : 0);
                    }}
                    className={`group relative cursor-pointer overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.02] transition-all duration-300 hover:border-violet-500/50 hover:shadow-[0_15px_40px_rgba(139,92,246,0.2)] ${
                      isWide ? "sm:col-span-2 lg:col-span-2" : "col-span-1"
                    }`}
                  >
                    <div className="relative h-80 w-full overflow-hidden sm:h-96">
                      <GalleryCardImage
                        src={img.thumbnailSrc || img.src}
                        alt={img.title}
                        className="object-cover group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/35 to-transparent transition-opacity group-hover:opacity-90 z-20 pointer-events-none" />

                      {/* Top Badges */}
                      <div className="absolute left-5 top-5 z-30 flex items-center gap-2">
                        <span className="rounded-full border border-white/20 bg-black/60 px-3 py-1 font-mono text-[10px] tracking-wider text-violet-300 backdrop-blur-md">
                          {img.category}
                        </span>
                        {img.location && (
                          <span className="hidden items-center gap-1 rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-[10px] text-white/60 backdrop-blur-md sm:flex">
                            <MapPin size={10} />
                            {img.location}
                          </span>
                        )}
                      </div>

                      {/* Bottom Info */}
                      <div className="absolute inset-x-0 bottom-0 p-6 z-30">
                        <h3 className="text-xl font-semibold text-white transition-colors group-hover:text-violet-200">
                          {img.title}
                        </h3>
                        <p className="mt-1.5 line-clamp-2 text-xs text-white/60">
                          {img.description}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                );
              } else {
                // Video card
                const vid = item.data;
                return (
                  <motion.div
                    key={`vid-${vid.id}`}
                    layout
                    initial={{ opacity: 0, y: 25 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: (idx % 9) * 0.03, duration: 0.35 }}
                    className="group relative overflow-hidden rounded-[26px] border border-red-500/20 bg-gradient-to-b from-red-950/15 via-white/[0.02] to-black/80 transition-all duration-300 hover:border-red-500/60 hover:shadow-[0_15px_40px_rgba(239,68,68,0.25)]"
                  >
                    <div
                      className="relative h-56 w-full cursor-pointer overflow-hidden sm:h-64"
                      onClick={() => setActiveTheaterVideo(vid)}
                    >
                      <GalleryCardImage
                        src={vid.thumbnailUrl}
                        alt={vid.title}
                        className="object-cover group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent z-20 pointer-events-none" />

                      {/* Play Button Trigger */}
                      <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
                        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-red-500/60 bg-red-600/90 text-white shadow-[0_0_30px_rgba(220,38,38,0.7)] backdrop-blur-md transition-transform duration-300 group-hover:scale-110">
                          <Play size={24} className="ml-1 fill-white" />
                        </div>
                      </div>

                      {/* Category & Badge */}
                      <div className="absolute left-5 top-5 z-30 flex items-center gap-2">
                        <span className="flex items-center gap-1 rounded-full border border-red-500/40 bg-red-950/70 px-2.5 py-1 font-mono text-[10px] font-semibold text-red-300 backdrop-blur-md">
                          <Tv size={10} />
                          {vid.dateBadge}
                        </span>
                      </div>

                      {/* Audio Pulse Visualizer */}
                      <div className="absolute bottom-4 right-5 z-30 flex items-center gap-1 text-white/70">
                        <Volume2 size={14} className="text-red-400" />
                        <span className="flex items-end gap-0.5 h-3">
                          <span className="w-0.5 h-2 bg-red-400 animate-pulse" />
                          <span className="w-0.5 h-3 bg-red-400 animate-pulse delay-75" />
                          <span className="w-0.5 h-1.5 bg-red-400 animate-pulse delay-150" />
                        </span>
                      </div>
                    </div>

                    <div className="p-6">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-red-400">
                        {vid.category}
                      </span>
                      <h3
                        onClick={() => setActiveTheaterVideo(vid)}
                        className="mt-1 cursor-pointer text-lg font-semibold text-white transition-colors hover:text-red-200"
                      >
                        {vid.title}
                      </h3>
                      <p className="mt-1.5 line-clamp-2 text-xs text-white/50">
                        {vid.description}
                      </p>

                      <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-4">
                        <button
                          type="button"
                          onClick={() => setActiveTheaterVideo(vid)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-red-300 hover:text-red-200"
                        >
                          <Play size={12} className="fill-red-300" />
                          <span>Watch in Theater</span>
                        </button>

                        <a
                          href={vid.youtubeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-white/40 hover:text-white"
                        >
                          <span>YouTube</span>
                          <ExternalLink size={11} />
                        </a>
                      </div>
                    </div>
                  </motion.div>
                );
              }
            })}
          </div>
        )}

        {/* PHOTOGRAPHS ONLY TAB */}
        {mediaTab === "photos" && (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {visiblePhotos.map((img, idx) => {
              const isWide = img.featured || img.aspectRatio === "wide";
              return (
                <motion.div
                  key={img.id}
                  layout
                  initial={{ opacity: 0, y: 25 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: (idx % 9) * 0.03, duration: 0.35 }}
                  onClick={() => {
                    const actualIdx = filteredPhotos.findIndex((p) => p.id === img.id);
                    setSelectedPhotoIndex(actualIdx >= 0 ? actualIdx : 0);
                  }}
                  className={`group relative cursor-pointer overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.02] transition-all duration-300 hover:border-violet-500/50 hover:shadow-[0_15px_40px_rgba(139,92,246,0.2)] ${
                    isWide ? "sm:col-span-2 lg:col-span-2" : "col-span-1"
                  }`}
                >
                  <div className="relative h-80 w-full overflow-hidden sm:h-96">
                    <GalleryCardImage
                      src={img.thumbnailSrc || img.src}
                      alt={img.title}
                      className="object-cover group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/35 to-transparent transition-opacity group-hover:opacity-90 z-20 pointer-events-none" />

                    <div className="absolute left-5 top-5 z-30 flex items-center gap-2">
                      <span className="rounded-full border border-white/20 bg-black/60 px-3 py-1 font-mono text-[10px] tracking-wider text-violet-300 backdrop-blur-md">
                        {img.category}
                      </span>
                      {img.location && (
                        <span className="hidden items-center gap-1 rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-[10px] text-white/60 backdrop-blur-md sm:flex">
                          <MapPin size={10} />
                          {img.location}
                        </span>
                      )}
                    </div>

                    <div className="absolute inset-x-0 bottom-0 p-6 z-30">
                      <h3 className="text-xl font-semibold text-white transition-colors group-hover:text-violet-200">
                        {img.title}
                      </h3>
                      <p className="mt-1.5 line-clamp-2 text-xs text-white/60">
                        {img.description}
                      </p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* VIDEOS ONLY TAB */}
        {mediaTab === "videos" && (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {visibleVideos.map((vid, idx) => (
              <motion.div
                key={vid.id}
                layout
                initial={{ opacity: 0, y: 25 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04, duration: 0.35 }}
                className="group relative overflow-hidden rounded-[26px] border border-red-500/20 bg-gradient-to-b from-red-950/15 via-white/[0.02] to-black/80 transition-all duration-300 hover:border-red-500/60 hover:shadow-[0_15px_40px_rgba(239,68,68,0.25)]"
              >
                <div
                  className="relative h-56 w-full cursor-pointer overflow-hidden sm:h-64"
                  onClick={() => setActiveTheaterVideo(vid)}
                >
                  <GalleryCardImage
                    src={vid.thumbnailUrl}
                    alt={vid.title}
                    className="object-cover group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent z-20 pointer-events-none" />

                  <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full border border-red-500/60 bg-red-600/90 text-white shadow-[0_0_30px_rgba(220,38,38,0.7)] backdrop-blur-md transition-transform duration-300 group-hover:scale-110">
                      <Play size={24} className="ml-1 fill-white" />
                    </div>
                  </div>

                  <div className="absolute left-5 top-5 z-30 flex items-center gap-2">
                    <span className="flex items-center gap-1 rounded-full border border-red-500/40 bg-red-950/70 px-2.5 py-1 font-mono text-[10px] font-semibold text-red-300 backdrop-blur-md">
                      <Tv size={10} />
                      {vid.dateBadge}
                    </span>
                  </div>

                  <div className="absolute bottom-4 right-5 z-30 flex items-center gap-1 text-white/70">
                    <Volume2 size={14} className="text-red-400" />
                    <span className="flex items-end gap-0.5 h-3">
                      <span className="w-0.5 h-2 bg-red-400 animate-pulse" />
                      <span className="w-0.5 h-3 bg-red-400 animate-pulse delay-75" />
                      <span className="w-0.5 h-1.5 bg-red-400 animate-pulse delay-150" />
                    </span>
                  </div>
                </div>

                <div className="p-6">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-red-400">
                    {vid.category}
                  </span>
                  <h3
                    onClick={() => setActiveTheaterVideo(vid)}
                    className="mt-1 cursor-pointer text-lg font-semibold text-white transition-colors hover:text-red-200"
                  >
                    {vid.title}
                  </h3>
                  <p className="mt-1.5 line-clamp-2 text-xs text-white/50">
                    {vid.description}
                  </p>

                  <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-4">
                    <button
                      type="button"
                      onClick={() => setActiveTheaterVideo(vid)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-red-300 hover:text-red-200"
                    >
                      <Play size={12} className="fill-red-300" />
                      <span>Watch in Theater</span>
                    </button>

                    <a
                      href={vid.youtubeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-white/40 hover:text-white"
                    >
                      <span>YouTube</span>
                      <ExternalLink size={11} />
                    </a>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Load More & Infinite Scroll Controls */}
        {visibleCount < currentTotal && (
          <div className="mt-14 flex flex-col items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
              className="group inline-flex items-center gap-2.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-6 py-3 text-xs font-semibold uppercase tracking-widest text-violet-300 backdrop-blur-md transition-all hover:border-violet-400 hover:bg-violet-500/20 hover:text-white hover:shadow-[0_0_30px_rgba(168,85,247,0.35)] active:scale-95 cursor-pointer"
            >
              <Sparkles size={14} className="text-violet-400 group-hover:rotate-12 transition-transform" />
              <span>Load More Artifacts ({currentVisible} of {currentTotal})</span>
            </button>
            <span className="font-mono text-[11px] text-white/40">
              Showing {currentVisible} of {currentTotal} curated artifacts • Streaming smoothly
            </span>
          </div>
        )}
        <div ref={sentinelRef} className="h-10 w-full pointer-events-none" />
      </section>

      {/* ═══════════════════════════════════════════════════════
          GOOGLE DRIVE & MEDIA CONTRIBUTION CALLOUT
      ═══════════════════════════════════════════════════════ */}
      <section className="relative z-10 mx-auto max-w-[1440px] px-6 pb-28 md:px-12">
        <div className="relative overflow-hidden rounded-[28px] border border-cyan-500/20 bg-gradient-to-r from-cyan-950/20 via-black to-violet-950/20 p-8 md:p-12">
          <div className="max-w-2xl">
            <span className="font-mono text-xs uppercase tracking-[0.25em] text-cyan-400">
              MEDIA CO-CREATION & DRIVE SYNC
            </span>
            <h2 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">
              Have High-Resolution Stills or Videos in Google Drive?
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/60">
              Student photographers and realm coordinators can provide Google Drive folders
              with public link access. Files are automatically indexed and streamed in full original camera quality directly to the official Saviskar archive.
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════
          INTERACTIVE CINEMATIC THEATER MODAL (YOUTUBE PLAYER)
      ═══════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {activeTheaterVideo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/95 p-4 backdrop-blur-2xl md:p-8"
            onClick={() => setActiveTheaterVideo(null)}
          >
            {/* Ambient Aura behind player */}
            <div className="pointer-events-none absolute h-[500px] w-[500px] rounded-full bg-red-600/20 blur-[140px]" />

            {/* Close Button */}
            <button
              type="button"
              onClick={() => setActiveTheaterVideo(null)}
              className="absolute right-6 top-6 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition hover:bg-white/20 hover:scale-105"
              aria-label="Close video player"
            >
              <X size={20} />
            </button>

            {/* Prev / Next Video buttons */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                prevVideo();
              }}
              className="hidden md:flex absolute left-6 top-1/2 -translate-y-1/2 z-10 h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-black/70 text-white backdrop-blur-md transition hover:bg-white/20"
              aria-label="Previous video"
            >
              <ArrowLeft size={20} />
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                nextVideo();
              }}
              className="hidden md:flex absolute right-6 top-1/2 -translate-y-1/2 z-10 h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-black/70 text-white backdrop-blur-md transition hover:bg-white/20"
              aria-label="Next video"
            >
              <ArrowRight size={20} />
            </button>

            {/* Video Card Container */}
            <div
              className="relative w-full max-w-5xl overflow-hidden rounded-[28px] border border-white/15 bg-neutral-950 p-4 md:p-6 shadow-[0_25px_80px_rgba(0,0,0,0.9)]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Responsive 16:9 Iframe Wrapper */}
              <div className="relative aspect-video w-full overflow-hidden rounded-[18px] bg-black">
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${activeTheaterVideo.id}?autoplay=1&rel=0&modestbranding=1`}
                  title={activeTheaterVideo.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  className="h-full w-full border-0"
                />
              </div>

              {/* Theater Video Meta Footer */}
              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-red-400">
                      {activeTheaterVideo.category}
                    </span>
                    <span className="text-white/30">•</span>
                    <span className="font-mono text-[10px] text-white/50">
                      {activeTheaterVideo.dateBadge}
                    </span>
                  </div>
                  <h2 className="mt-1 text-lg font-semibold text-white sm:text-xl">
                    {activeTheaterVideo.title}
                  </h2>
                  <p className="mt-1 text-xs text-white/60">
                    {activeTheaterVideo.description}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <a
                    href={activeTheaterVideo.youtubeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-red-500/40 bg-red-950/40 px-4 py-2 text-xs font-semibold text-red-200 transition-all hover:bg-red-900/60 hover:text-white"
                  >
                    <YoutubeIcon size={14} />
                    <span>Watch on YouTube</span>
                    <ExternalLink size={12} />
                  </a>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════
          PHOTOGRAPHIC LIGHTBOX MODAL
      ═══════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {activePhoto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/95 p-4 backdrop-blur-2xl md:p-8"
            onClick={() => setSelectedPhotoIndex(null)}
          >
            {/* Close Button */}
            <button
              type="button"
              onClick={() => setSelectedPhotoIndex(null)}
              className="absolute right-6 top-6 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition hover:bg-white/20 hover:scale-105"
              aria-label="Close lightbox"
            >
              <X size={20} />
            </button>

            {/* Prev / Next Buttons */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                prevPhoto();
              }}
              className="absolute left-6 top-1/2 -translate-y-1/2 z-10 flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-black/70 text-white backdrop-blur-md transition hover:bg-white/20"
              aria-label="Previous photo"
            >
              <ArrowLeft size={20} />
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                nextPhoto();
              }}
              className="absolute right-6 top-1/2 -translate-y-1/2 z-10 flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-black/70 text-white backdrop-blur-md transition hover:bg-white/20"
              aria-label="Next photo"
            >
              <ArrowRight size={20} />
            </button>

            {/* Lightbox Content Card */}
            <div
              className="relative max-h-[90vh] max-w-5xl overflow-hidden rounded-[28px] border border-white/15 bg-neutral-950 p-4 md:p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative h-[65vh] w-[82vw] max-w-4xl overflow-hidden rounded-[20px] bg-black/90 flex items-center justify-center">
                {!isLightboxLoaded && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-neutral-950/80">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500/20 border-t-violet-400" />
                    <span className="font-mono text-[10px] tracking-widest text-violet-300 uppercase">
                      STREAMING 2K MASTER
                    </span>
                  </div>
                )}
                <Image
                  src={activePhoto.src}
                  alt={activePhoto.title}
                  fill
                  unoptimized
                  onLoad={() => setIsLightboxLoaded(true)}
                  className={`object-contain transition-opacity duration-500 ${
                    isLightboxLoaded ? "opacity-100" : "opacity-0"
                  }`}
                  priority
                />
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] tracking-widest text-violet-400 uppercase">
                      {activePhoto.category}
                    </span>
                    {activePhoto.location && (
                      <>
                        <span className="text-white/30">•</span>
                        <span className="font-mono text-[10px] text-white/50">
                          {activePhoto.location}
                        </span>
                      </>
                    )}
                  </div>
                  <h2 className="mt-1 text-lg font-semibold text-white sm:text-xl">
                    {activePhoto.title}
                  </h2>
                  <p className="text-xs text-white/60">
                    {activePhoto.description}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href={activePhoto.src.replace(/=s\d+$/, "=s0")}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-mono text-zinc-300 hover:border-violet-400 hover:bg-violet-500/20 hover:text-white transition-all"
                  >
                    <ExternalLink size={12} />
                    <span>Download 8K RAW</span>
                  </a>

                  <span className="font-mono text-xs text-white/40">
                    FRAME {(selectedPhotoIndex ?? 0) + 1} / {filteredPhotos.length}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
