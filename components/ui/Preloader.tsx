"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { FastForward, Disc3, ShieldCheck, Activity } from "lucide-react";

import { GLIMPSE_175_UNIQUE_TILES, MAIN_GALLERY_GDRIVE_IMAGES } from "@/data/gdriveManifest";

interface PreloaderProps {
  onComplete?: () => void;
  minDurationSeconds?: number;
  mode?: "all" | "landing" | "gallery";
}

// Retrieve all critical landing page assets to load & decode before entering
const getLandingAssets = (): string[] => {
  if (typeof window === "undefined") return [];
  const isMobile = window.innerWidth < 768;

  // 1. 3D Stadium amphitheater textures used by ScrollEngine3D WebGL pipeline
  const stadiumTextures = isMobile
    ? [
        "/images/mobile/concert-stadium.webp",
        "/images/mobile/firework-launch.webp",
        "/images/mobile/scene-realms-stage.webp",
        "/images/mobile/scene-starnight-show.webp",
        "/images/mobile/scene-finale-celebration.webp",
      ]
    : [
        "/images/concert-stadium.webp",
        "/images/firework-launch.webp",
        "/images/scene-realms-stage.webp",
        "/images/scene-starnight-show.webp",
        "/images/scene-finale-celebration.webp",
      ];

  // 2. Critical UI, Hero & Realm visual assets
  const coreVisuals = [
    "/images/hero.webp",
    "/images/concert-mission-centerstage.webp",
    "/logo.png",
    "/PreLoader/preloader.webp",
    "/images/realm-technical-v2.webp",
    "/images/realm-cultural-v2.webp",
    "/images/realm-nontech-v2.webp",
    "/images/realm-sports.webp",
    "/images/realm-aivishkar-ai.webp",
  ];

  // 3. All 175 Unique 3D Dome Glimpse Gallery Tiles (Google Drive CDN thumbnails)
  const domeTiles = GLIMPSE_175_UNIQUE_TILES.map((t) =>
    t.thumbnailSrc ? t.thumbnailSrc.replace(/=s\d+$/, "=s400") : t.src
  );

  return [...stadiumTextures, ...coreVisuals, ...domeTiles];
};

const getGalleryAssets = (): string[] => {
  if (typeof window === "undefined") return [];
  // Main Gallery photos (Google Drive CDN thumbnails)
  const mainGalleryPhotos = MAIN_GALLERY_GDRIVE_IMAGES.map((img) =>
    img.thumbnailSrc ? img.thumbnailSrc.replace(/=s\d+$/, "=s800") : img.src
  );
  return ["/logo.png", ...mainGalleryPhotos];
};

const STATUS_STEPS = [
  { at: 0, text: "INITIALIZING AEVORIAN FREQUENCIES // CGC UNIVERSITY MOHALI" },
  { at: 18, text: "FETCHING HIGH-RES STADIUM MESH & 3D VENUE TEXTURES" },
  { at: 38, text: "STREAMING GOOGLE DRIVE CDN MEDIA & 175 DOME TILES" },
  { at: 62, text: "CALIBRATING 50+ REALMS & STAGE PYROTECHNICS" },
  { at: 80, text: "PRIMING FESTIVAL ARCHIVE & HIGH-FIDELITY ASSETS" },
  { at: 92, text: "ALL SYSTEMS PRIMED • AWAKENING FESTIVAL REALM" },
  { at: 99, text: "AEVORIAN REVERIE UNLOCKED • ENTERING SAVISKAR 2026" },
];

export default function Preloader({
  onComplete,
  minDurationSeconds = 1.6,
  mode = "all",
}: PreloaderProps) {
  const [showPreloader, setShowPreloader] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has("nopreloader")) return false;
      } catch {
        // Fallback
      }
    }
    return true;
  });

  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState(STATUS_STEPS[0].text);
  const [isExiting, setIsExiting] = useState(false);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [assetCount, setAssetCount] = useState({ loaded: 0, total: 12 });
  const [timecode, setTimecode] = useState("00:00:00:00");
  const [windowSize, setWindowSize] = useState({ w: 1440, h: 900 });

  const videoRef = useRef<HTMLVideoElement>(null);
  const assetsReadyRef = useRef(false);
  const completedAssetsRef = useRef(0);
  const totalAssetsRef = useRef(12);
  const isExitingRef = useRef(false);

  // Clear any legacy session flag so preloader is never blocked
  useEffect(() => {
    try {
      sessionStorage.removeItem("saviskar26_seen_intro");
    } catch {
      // Ignore
    }
  }, []);

  // Measure window for responsive expansion
  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        w: typeof window !== "undefined" ? window.innerWidth : 1440,
        h: typeof window !== "undefined" ? window.innerHeight : 900,
      });
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const finishLoading = useCallback(() => {
    if (isExitingRef.current) return;
    isExitingRef.current = true;
    setIsExiting(true);
    setTimeout(() => {
      setShowPreloader(false);
      onComplete?.();
    }, 550);
  }, [onComplete]);

  const finishLoadingRef = useRef(finishLoading);
  useEffect(() => {
    finishLoadingRef.current = finishLoading;
  }, [finishLoading]);

  // Real asset preloader: tracks all 3D scene textures, fonts, hero imagery, and document state
  useEffect(() => {
    if (!showPreloader) return;

    let isMounted = true;

    const preloadSingleImage = (src: string, timeoutMs = 4000): Promise<void> => {
      return new Promise<void>((resolve) => {
        let resolved = false;
        const done = () => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        };

        const timer = setTimeout(done, timeoutMs);
        const img = new Image();
        img.referrerPolicy = "no-referrer";
        img.decoding = "async";
        img.src = src;

        if (img.complete) {
          clearTimeout(timer);
          if (typeof img.decode === "function") {
            img.decode().then(done).catch(done);
          } else {
            done();
          }
          return;
        }

        img.onload = () => {
          clearTimeout(timer);
          if (typeof img.decode === "function") {
            img.decode().then(done).catch(done);
          } else {
            done();
          }
        };

        img.onerror = () => {
          clearTimeout(timer);
          // Fast single retry
          const retryImg = new Image();
          retryImg.referrerPolicy = "no-referrer";
          retryImg.decoding = "async";
          retryImg.src = src;
          retryImg.onload = done;
          retryImg.onerror = done;
          setTimeout(done, 1200);
        };
      });
    };

    const fontPromise =
      typeof document !== "undefined" && document.fonts
        ? document.fonts.ready.catch(() => {})
        : Promise.resolve();

    const docPromise =
      typeof document !== "undefined" && document.readyState === "complete"
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            if (typeof window === "undefined") return resolve();
            if (document.readyState === "complete") {
              resolve();
            } else {
              window.addEventListener("load", () => resolve(), { once: true });
              window.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
            }
          });

    const videoPromise = new Promise<void>((resolve) => {
      const vid = videoRef.current;
      if (!vid) {
        resolve();
        return;
      }
      if (vid.readyState >= 2) {
        resolve();
        return;
      }
      const onReady = () => {
        resolve();
        cleanup();
      };
      const cleanup = () => {
        vid.removeEventListener("loadeddata", onReady);
        vid.removeEventListener("canplay", onReady);
        vid.removeEventListener("error", onReady);
      };
      vid.addEventListener("loadeddata", onReady, { once: true });
      vid.addEventListener("canplay", onReady, { once: true });
      vid.addEventListener("error", onReady, { once: true });
      // Video fallback timeout: 4s max in case mobile browser delays video buffering
      setTimeout(onReady, 4000);
    });

    const allImagesToPreload = Array.from(
      new Set(
        mode === "gallery"
          ? getGalleryAssets()
          : mode === "landing"
          ? getLandingAssets()
          : [...getLandingAssets(), ...getGalleryAssets()]
      )
    );

    const totalAssets = allImagesToPreload.length + 3; // + font, doc, video
    totalAssetsRef.current = totalAssets;
    let completedCount = 0;
    completedAssetsRef.current = 0;

    if (isMounted) {
      setAssetCount({ loaded: 0, total: totalAssets });
    }

    const onSingleAssetDone = () => {
      if (!isMounted) return;
      completedCount++;
      completedAssetsRef.current = completedCount;
      setAssetCount({ loaded: completedCount, total: totalAssets });
      if (completedCount >= totalAssets) {
        assetsReadyRef.current = true;
        setAssetsLoaded(true);
      }
    };

    fontPromise.finally(onSingleAssetDone);
    docPromise.finally(onSingleAssetDone);
    videoPromise.finally(onSingleAssetDone);

    // Concurrency queue for images (16 parallel workers)
    const concurrency = 16;
    let queueIdx = 0;

    const worker = async () => {
      while (queueIdx < allImagesToPreload.length) {
        if (!isMounted) break;
        const currentIdx = queueIdx++;
        const url = allImagesToPreload[currentIdx];
        try {
          await preloadSingleImage(url);
        } catch {
          // ignore
        }
        onSingleAssetDone();
      }
    };

    const workerPool = Array.from(
      { length: Math.min(concurrency, allImagesToPreload.length) },
      () => worker()
    );

    Promise.all(workerPool).finally(() => {
      if (!isMounted) return;
      if (completedCount >= totalAssets) {
        assetsReadyRef.current = true;
        setAssetsLoaded(true);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [showPreloader, mode]);

  // Smooth, monotonic cinematic progress engine driven by REAL asset loading
  useEffect(() => {
    if (!showPreloader) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const startTime = performance.now();
    // Minimum duration for cinematic pacing (e.g. 1.6s) even if cached
    const minDurationMs = Math.max(1600, minDurationSeconds * 1000);
    let currentPct = 0;

    const interval = setInterval(() => {
      const now = performance.now();
      const elapsed = now - startTime;
      const timeRatio = Math.min(1, elapsed / minDurationMs);

      // SMPTE timecode calculation
      const totalFrames = Math.floor((elapsed / 1000) * 24);
      const s = Math.floor(elapsed / 1000) % 60;
      const m = Math.floor(elapsed / 60000) % 60;
      const f = totalFrames % 24;
      setTimecode(
        `00:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`
      );

      const isAssetsDone = assetsReadyRef.current;
      const completed = completedAssetsRef.current;
      const total = totalAssetsRef.current;
      const assetRatio = total > 0 ? completed / total : 0;

      let desiredTarget: number;

      if (!isAssetsDone) {
        // While assets are actively downloading, progress is strictly driven by real asset ratio,
        // holding at max 88% until 100% of all textures and assets have fully loaded
        desiredTarget = Math.min(88, assetRatio * 88);
      } else {
        // Once all assets are 100% downloaded, allow progress to glide to 100%,
        // smoothed by the time ratio curve for a polished cinematic release
        const timeSmooth = timeRatio * timeRatio * (3 - 2 * timeRatio) * 100;
        desiredTarget = Math.max(88, timeSmooth);
        if (timeRatio >= 0.98) {
          desiredTarget = 100;
        }
      }

      // Smooth rate-limited interpolation towards desiredTarget
      const delta = desiredTarget - currentPct;
      if (delta > 0) {
        const step = Math.min(1.8, Math.max(0.35, delta * 0.14));
        currentPct = Math.min(100, currentPct + step);
      }

      const displayPct = Math.min(100, Math.floor(currentPct));
      setProgress(displayPct);

      // Telemetry status text update
      if (!isAssetsDone && displayPct >= 80) {
        setStatusText(`SYNCHRONIZING ASSETS (${completed}/${total}) • ALMOST READY`);
      } else {
        for (let i = STATUS_STEPS.length - 1; i >= 0; i--) {
          if (displayPct >= STATUS_STEPS[i].at) {
            setStatusText(STATUS_STEPS[i].text);
            break;
          }
        }
      }

      // Completion reached: hold for 140ms and transition into festival
      if (currentPct >= 99.8 && isAssetsDone) {
        clearInterval(interval);
        setProgress(100);
        setStatusText("AEVORIAN REVERIE UNLOCKED • ENTERING SAVISKAR 2026");
        setTimeout(() => {
          finishLoadingRef.current();
        }, 140);
      }
    }, 24);

    // Watchdog fallback timer: 15s max to prevent permanent hang on dropped network connections
    const watchdogSafetyTimer = setTimeout(() => {
      console.warn("Preloader watchdog timer triggered (15s). Unlocking interface.");
      assetsReadyRef.current = true;
      setAssetsLoaded(true);
      setProgress(100);
      finishLoadingRef.current();
    }, 15000);

    return () => {
      document.body.style.overflow = originalOverflow;
      clearInterval(interval);
      clearTimeout(watchdogSafetyTimer);
    };
  }, [showPreloader, minDurationSeconds]);

  // Video playback management on the mounted element
  useEffect(() => {
    if (!showPreloader) return;
    const vid = videoRef.current;
    if (vid) {
      vid.playbackRate = 1.0;
      vid.play().catch(() => {
        // Autoplay policy fallback (video will show poster/webp)
      });
    }
  }, [showPreloader]);

  if (!showPreloader) return null;

  const handleSkip = () => {
    assetsReadyRef.current = true;
    setAssetsLoaded(true);
    setProgress(100);
    finishLoadingRef.current();
  };

  // Fluid Expansion Calculation:
  // Begins expanding immediately from 0% and reaches 100% full screen by 72%
  // This completely eliminates getting stuck in a small window!
  const expansionProgress = Math.max(0, Math.min(1, progress / 72));
  // Smooth cubic easing for the expansion
  const easedExpansion =
    expansionProgress * expansionProgress * (3 - 2 * expansionProgress);

  const isFullscreen = easedExpansion >= 0.99 || isExiting;

  // Initial cinematic 16:9 aperture in center (responsive)
  const initialWidth = Math.min(780, windowSize.w * 0.82);
  const initialHeight = Math.min(500, windowSize.h * 0.56);

  const currentWidth = isFullscreen
    ? windowSize.w
    : initialWidth + (windowSize.w - initialWidth) * easedExpansion;

  const currentHeight = isFullscreen
    ? windowSize.h
    : initialHeight + (windowSize.h - initialHeight) * easedExpansion;

  const currentRadius = isFullscreen ? 0 : Math.max(0, Math.round(18 * (1 - easedExpansion)));
  const currentBorderOpacity = isFullscreen ? 0 : (1 - easedExpansion) * 0.25;
  const currentShadowSpread = isFullscreen ? 0 : Math.round(80 * (1 - easedExpansion));

  // Progressive color awakening: monochrome transitions smoothly to rich festival color from 50% to 90%
  const colorAwakenRatio = Math.max(0, Math.min(1, (progress - 50) / 40));
  const currentGrayscale = Math.max(0, 1 - colorAwakenRatio);
  const currentSaturate = 1 + colorAwakenRatio * 0.3;

  return (
    <AnimatePresence>
      {!isExiting && (
        <motion.div
          key="saviskar-preloader"
          initial={{ opacity: 1 }}
          exit={{
            opacity: 0,
            scale: 1.03,
            filter: "blur(8px)",
            transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
          }}
          className="fixed inset-0 z-[99999] bg-black text-white select-none overflow-hidden"
          style={{ backgroundColor: "#000000" }}
        >
          {/* Subtle Ambient Back-Glow behind center stage */}
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full blur-[100px] transition-opacity duration-500"
            style={{
              width: `${Math.min(currentWidth * 1.15, windowSize.w)}px`,
              height: `${Math.min(currentHeight * 1.15, windowSize.h)}px`,
              background:
                "radial-gradient(circle, rgba(139, 92, 246, 0.16) 0%, rgba(59, 130, 246, 0.08) 50%, transparent 75%)",
              opacity: 1 - easedExpansion * 0.6,
            }}
          />

          {/* Film Grain & Scanlines */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.035] mix-blend-screen z-30"
            style={{
              backgroundImage:
                "repeating-linear-gradient(0deg, #fff, #fff 1px, transparent 1px, transparent 2px)",
              backgroundSize: "100% 2px",
            }}
          />

          {/* Cinematic Vignette Overlay */}
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.92)_100%)] z-20 transition-opacity duration-300"
            style={{ opacity: 1 - easedExpansion * 0.5 }}
          />

          {/* Top HUD Bar */}
          <div
            className="absolute top-0 left-0 right-0 z-40 flex items-center justify-between px-6 py-5 md:px-12 md:py-8 transition-all duration-300"
            style={{
              transform: `translateY(${
                -20 * easedExpansion * (progress > 85 ? (progress - 85) / 15 : 0)
              }px)`,
            }}
          >
            {/* Festival Badge */}
            <div className="flex items-center gap-3 px-3.5 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 shadow-lg">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
              </span>
              <span className="text-[10px] md:text-[11px] font-mono tracking-[0.25em] uppercase text-white/90">
                SAVISKAR 2026 // MONO ARCHIVE
              </span>
            </div>

            {/* Skip Button */}
            <button
              onClick={handleSkip}
              className="group flex items-center gap-2 rounded-full border border-white/20 bg-black/60 px-4 py-1.5 text-xs font-mono tracking-[0.2em] text-white/90 backdrop-blur-md transition-all hover:border-white/50 hover:bg-white/20 hover:text-white active:scale-95 shadow-lg pointer-events-auto"
            >
              <span>SKIP</span>
              <FastForward className="h-3 w-3 text-violet-400 transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>

          {/* Center Stage: Gradually Expands to Cover Entire Screen */}
          <div
            className={`absolute overflow-hidden z-10 bg-neutral-950 flex items-center justify-center will-change-[width,height,border-radius] transition-[border-radius,box-shadow] duration-200 ${
              isFullscreen
                ? "inset-0 left-0 top-0 translate-x-0 translate-y-0 w-full h-full"
                : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            }`}
            style={{
              width: isFullscreen ? "100%" : `${currentWidth}px`,
              height: isFullscreen ? "100%" : `${currentHeight}px`,
              borderRadius: isFullscreen ? "0px" : `${currentRadius}px`,
              borderWidth: isFullscreen ? "0px" : `${(1 - easedExpansion) * 1.5}px`,
              borderColor: `rgba(255, 255, 255, ${currentBorderOpacity})`,
              boxShadow: isFullscreen ? "none" : `0 0 ${currentShadowSpread}px rgba(0,0,0,0.95)`,
            }}
          >
            {/* Viewfinder Camera HUD (Active during initial expand, gracefully fades on full screen) */}
            <div
              className="pointer-events-none absolute inset-0 z-30 transition-opacity duration-400 p-4 md:p-6 flex flex-col justify-between"
              style={{ opacity: Math.max(0, 1 - easedExpansion * 1.8) }}
            >
              {/* Top Viewfinder Row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3.5 h-3.5 border-t-2 border-l-2 border-white/80" />
                  <span className="hidden sm:inline font-mono text-[9px] tracking-[0.2em] text-white/70">
                    ISO 800 • 24 FPS
                  </span>
                </div>

                <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-md border border-white/10 text-[9px] md:text-[10px] font-mono tracking-widest text-white/80">
                  <Disc3 className="w-3 h-3 text-red-500 animate-spin" />
                  <span>REC • [CINEMA MATRIX]</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="hidden sm:inline font-mono text-[9px] tracking-[0.2em] text-white/70">
                    TC {timecode}
                  </span>
                  <div className="w-3.5 h-3.5 border-t-2 border-r-2 border-white/80" />
                </div>
              </div>

              {/* Center Crosshair Target */}
              <div className="self-center flex items-center justify-center pointer-events-none opacity-40">
                <div className="w-6 h-[1px] bg-white" />
                <div className="h-6 w-[1px] bg-white -ml-[1px]" />
              </div>

              {/* Bottom Viewfinder Row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3.5 h-3.5 border-b-2 border-l-2 border-white/80" />
                  <span className="hidden sm:inline font-mono text-[9px] tracking-[0.2em] text-white/70">
                    AUDIO 48kHz • 24-BIT
                  </span>
                </div>

                <span className="font-mono text-[9px] tracking-[0.25em] text-white/50">
                  FRAME: {String(progress).padStart(3, "0")}/100
                </span>

                <div className="flex items-center gap-2">
                  <span className="hidden sm:inline font-mono text-[9px] tracking-[0.2em] text-white/70">
                    4K RES
                  </span>
                  <div className="w-3.5 h-3.5 border-b-2 border-r-2 border-white/80" />
                </div>
              </div>
            </div>

            {/* Cinema Video Playback: Progressive Monochrome-to-Full-Color Awakening */}
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              loop
              preload="auto"
              className="w-full h-full object-cover transition-all duration-700 ease-out"
              style={{
                transform: `scale(${1 + easedExpansion * 0.04})`,
                filter: `grayscale(${currentGrayscale * 100}%) contrast(1.18) saturate(${currentSaturate})`,
              }}
            >
              <source src="/PreLoader/preloader.mp4" type="video/mp4" />
              <source src="/PreLoader/preloader.webm" type="video/webm" />
              {/* Fallback to Animated WebP */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/PreLoader/preloader.webp"
                alt="Saviskar Festival Preloader"
                className="w-full h-full object-cover"
              />
            </video>

            {/* Inner Ambient Vignette */}
            <div
              className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/60 via-transparent to-black/30 z-20 transition-opacity duration-300"
              style={{ opacity: 1 - easedExpansion * 0.5 }}
            />
          </div>

          {/* Bottom Telemetry & Progress HUD */}
          <div className="absolute bottom-0 left-0 right-0 z-40 flex flex-col items-center px-6 pb-8 md:pb-12 pointer-events-none">
            <div className="w-full max-w-4xl flex flex-col items-center bg-black/60 backdrop-blur-md px-6 py-4 rounded-2xl border border-white/10 shadow-2xl transition-all duration-300">
              {/* Progress Counter & Live Step */}
              <div className="w-full flex items-end justify-between text-xs font-mono mb-2.5">
                <div className="flex flex-col items-start gap-1">
                  <div className="flex items-center gap-2.5">
                    {/* Equalizer Micro-Bars */}
                    <div className="flex items-end gap-[2px] h-3.5 px-1.5 py-0.5 rounded bg-white/5 border border-white/10">
                      {[40, 75, 100, 60, 85, 50, 90, 65].map((h, i) => (
                        <motion.span
                          key={i}
                          className="w-[2px] rounded-full bg-violet-400"
                          animate={{
                            height: [`${h * 0.3}%`, `${h}%`, `${h * 0.4}%`],
                          }}
                          transition={{
                            duration: 0.6 + (i % 3) * 0.15,
                            repeat: Infinity,
                            repeatType: "reverse",
                            ease: "easeInOut",
                          }}
                        />
                      ))}
                    </div>

                    <span className="text-[10px] uppercase tracking-[0.35em] text-violet-400 font-semibold">
                      SYSTEM TELEMETRY
                    </span>

                    {/* Real Asset Status Badge */}
                    {assetsLoaded ? (
                      <span className="inline-flex items-center gap-1 text-[9px] font-mono text-emerald-400 bg-emerald-950/70 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                        <ShieldCheck className="w-3 h-3" />
                        <span>ALL ASSETS PRIMED</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[9px] font-mono text-white/60 bg-white/5 border border-white/10 px-2 py-0.5 rounded-full">
                        <Activity className="w-2.5 h-2.5 text-violet-400 animate-pulse" />
                        <span>{assetCount.loaded}/{assetCount.total} SYNCED</span>
                      </span>
                    )}
                  </div>

                  <span className="text-white/90 tracking-wider text-xs md:text-sm font-medium">
                    {statusText}
                  </span>
                </div>

                {/* Numeric Counter */}
                <div className="flex items-baseline gap-1 font-mono">
                  <span className="text-3xl md:text-4xl font-black tracking-tighter text-white drop-shadow-[0_0_14px_rgba(255,255,255,0.4)]">
                    {String(progress).padStart(2, "0")}
                  </span>
                  <span className="text-xs text-white/50">%</span>
                </div>
              </div>

              {/* Shimmer Progress Bar */}
              <div className="relative w-full h-[4px] bg-white/10 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-violet-600 via-white to-violet-300 shadow-[0_0_14px_rgba(168,85,247,0.9)]"
                  style={{ width: `${progress}%` }}
                  transition={{ ease: "linear" }}
                />
              </div>

              {/* Bottom Meta Badges */}
              <div className="w-full flex items-center justify-between text-[10px] font-mono text-white/40 tracking-[0.25em] mt-2.5">
                <span>AEVORIAN REVERIE</span>
                <span className="hidden sm:inline">
                  {easedExpansion > 0.85
                    ? "FULLSCREEN IMMERSION ACTIVE"
                    : "CALIBRATING STADIUM MATRIX"}
                </span>
                <span>CGC UNIVERSITY MOHALI</span>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
