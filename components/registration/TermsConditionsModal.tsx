"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  FileText,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";

interface TermsConditionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface PageRenderStatus {
  pageNumber: number;
  rendered: boolean;
  error?: string;
}

declare global {
  interface Window {
    pdfjsLib?: any;
  }
}

export default function TermsConditionsModal({
  isOpen,
  onClose,
}: TermsConditionsModalProps) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(7);
  const [activePage, setActivePage] = useState(1);
  const [zoom, setZoom] = useState(1.0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const pdfDocRef = useRef<any>(null);
  const renderTasksRef = useRef<Map<number, any>>(new Map());
  const modalCloseButtonRef = useRef<HTMLButtonElement | null>(null);

  // Mount detection for React portal
  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll and listen for Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    // Initial focus on modal close button for accessibility
    const timer = setTimeout(() => {
      modalCloseButtonRef.current?.focus();
    }, 120);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      clearTimeout(timer);
    };
  }, [isOpen, onClose]);

  // Load PDF.js library dynamically from public vendor folder
  const loadPdfEngine = useCallback(async () => {
    if (typeof window === "undefined") return null;

    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "/vendor/pdfjs/pdf.worker.min.js";
      return window.pdfjsLib;
    }

    return new Promise((resolve, reject) => {
      const existing = document.querySelector(
        'script[src="/vendor/pdfjs/pdf.min.js"]'
      ) as HTMLScriptElement | null;

      if (existing) {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            "/vendor/pdfjs/pdf.worker.min.js";
          resolve(window.pdfjsLib);
          return;
        }
        existing.addEventListener("load", () => {
          if (window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
              "/vendor/pdfjs/pdf.worker.min.js";
            resolve(window.pdfjsLib);
          } else {
            reject(new Error("pdfjsLib not available after script load"));
          }
        });
        existing.addEventListener("error", () =>
          reject(new Error("Failed to load PDF.js engine script"))
        );
        return;
      }

      const script = document.createElement("script");
      script.src = "/vendor/pdfjs/pdf.min.js";
      script.async = true;
      script.onload = () => {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            "/vendor/pdfjs/pdf.worker.min.js";
          resolve(window.pdfjsLib);
        } else {
          reject(new Error("pdfjsLib undefined after script load"));
        }
      };
      script.onerror = () =>
        reject(new Error("Failed to load /vendor/pdfjs/pdf.min.js"));
      document.head.appendChild(script);
    });
  }, []);

  // Render a specific page to its canvas
  const renderPage = useCallback(
    async (pageNumber: number, pdfDoc: any, currentZoom: number) => {
      const canvas = canvasRefs.current.get(pageNumber);
      if (!canvas || !pdfDoc) return;

      // Cancel any ongoing render task for this canvas
      const existingTask = renderTasksRef.current.get(pageNumber);
      if (existingTask && typeof existingTask.cancel === "function") {
        try {
          existingTask.cancel();
        } catch {
          // ignore task cancellation errors
        }
      }

      try {
        const page = await pdfDoc.getPage(pageNumber);
        const unscaledViewport = page.getViewport({ scale: 1 });

        // Calculate target width based on container width and zoom level
        const containerWidth = containerRef.current
          ? Math.max(containerRef.current.clientWidth - 48, 300)
          : 760;

        // Base width fits nicely within standard reading column
        const maxStandardWidth = 820;
        const baseWidth = Math.min(containerWidth, maxStandardWidth);
        const targetWidth = baseWidth * currentZoom;
        const scale = targetWidth / unscaledViewport.width;

        const viewport = page.getViewport({ scale });
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

        canvas.width = Math.round(viewport.width * dpr);
        canvas.height = Math.round(viewport.height * dpr);
        canvas.style.width = `${Math.round(viewport.width)}px`;
        canvas.style.height = `${Math.round(viewport.height)}px`;

        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const renderContext = {
          canvasContext: ctx,
          viewport: viewport,
        };

        const renderTask = page.render(renderContext);
        renderTasksRef.current.set(pageNumber, renderTask);

        await renderTask.promise;
      } catch (err: any) {
        if (err?.name !== "RenderingCancelledException") {
          console.error(`Error rendering page ${pageNumber}:`, err);
        }
      }
    },
    []
  );

  // Load document and render all pages
  useEffect(() => {
    if (!isOpen) return;

    let isCancelled = false;
    setLoading(true);
    setLoadError(null);

    async function init() {
      try {
        const pdfjs = await loadPdfEngine();
        if (isCancelled || !pdfjs) return;

        const loadingTask = pdfjs.getDocument({
          url: "/SAVISKAR_2K26_Official_Terms_Conditions.pdf",
        });

        const doc = await loadingTask.promise;
        if (isCancelled) return;

        pdfDocRef.current = doc;
        setNumPages(doc.numPages);
        setLoading(false);

        // Render all pages
        for (let i = 1; i <= doc.numPages; i++) {
          if (isCancelled) break;
          void renderPage(i, doc, zoom);
        }
      } catch (err: any) {
        if (!isCancelled) {
          console.error("Failed to load Terms & Conditions PDF:", err);
          setLoadError(
            err?.message || "Failed to load Terms & Conditions document."
          );
          setLoading(false);
        }
      }
    }

    void init();

    return () => {
      isCancelled = true;
      // Cancel all active render tasks
      renderTasksRef.current.forEach((task) => {
        try {
          task.cancel();
        } catch {
          // ignore
        }
      });
      renderTasksRef.current.clear();
    };
  }, [isOpen, loadPdfEngine, renderPage]);

  // Re-render pages when zoom changes
  useEffect(() => {
    if (!isOpen || !pdfDocRef.current || loading) return;

    const doc = pdfDocRef.current;
    for (let i = 1; i <= doc.numPages; i++) {
      void renderPage(i, doc, zoom);
    }
  }, [zoom, isOpen, loading, renderPage]);

  // Track active page while scrolling
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const containerTop = containerRef.current.getBoundingClientRect().top;

    let current = 1;
    for (let i = 1; i <= numPages; i++) {
      const pageEl = pageRefs.current.get(i);
      if (pageEl) {
        const rect = pageEl.getBoundingClientRect();
        if (rect.top - containerTop <= 180) {
          current = i;
        }
      }
    }
    setActivePage(current);
  }, [numPages]);

  // Smooth scroll to a specific page
  const scrollToPage = (pageNumber: number) => {
    const pageEl = pageRefs.current.get(pageNumber);
    if (pageEl) {
      pageEl.scrollIntoView({ behavior: "smooth", block: "start" });
      setActivePage(pageNumber);
    }
  };

  const zoomIn = () => {
    setZoom((prev) => Math.min(Number((prev + 0.15).toFixed(2)), 1.75));
  };

  const zoomOut = () => {
    setZoom((prev) => Math.max(Number((prev - 0.15).toFixed(2)), 0.7));
  };

  const resetZoom = () => {
    setZoom(1.0);
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/85 p-2 sm:p-4 md:p-6 backdrop-blur-xl"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby="terms-dialog-title"
          aria-describedby="terms-dialog-desc"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex flex-col h-full max-h-[96vh] sm:max-h-[92vh] w-full max-w-5xl rounded-[24px] sm:rounded-[32px] border border-white/15 bg-gradient-to-b from-[#0e0a1a] via-[#090712] to-[#040208] text-white shadow-[0_30px_100px_rgba(0,0,0,0.95),0_0_80px_rgba(168,85,247,0.2)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── TOP HEADER / TOOLBAR ── */}
            <div className="relative z-20 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-black/50 px-4 py-3 sm:px-6 sm:py-4 backdrop-blur-md">
              {/* Document Identity */}
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 border border-violet-500/30 text-violet-300">
                  <FileText size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-violet-400 font-semibold">
                      SAVISKAR 2K26
                    </span>
                    <span className="hidden sm:inline-block h-1 w-1 rounded-full bg-white/30" />
                    <span className="hidden sm:inline-block font-mono text-[10px] text-white/50">
                      OFFICIAL HANDBOOK
                    </span>
                  </div>
                  <h3
                    id="terms-dialog-title"
                    className="text-sm sm:text-base font-medium text-white tracking-tight"
                  >
                    Terms &amp; Conditions
                  </h3>
                </div>
              </div>

              {/* Central Navigation & Zoom Controls */}
              <div className="flex items-center gap-1.5 sm:gap-2">
                {/* Page Indicator and Jump Controls */}
                <div className="flex items-center rounded-xl border border-white/10 bg-white/[0.04] px-2 py-1">
                  <span className="font-mono text-xs font-medium text-white/80 px-1">
                    Page <span className="text-violet-300 font-semibold">{activePage}</span> of {numPages}
                  </span>
                  <div className="ml-1 flex items-center border-l border-white/10 pl-1">
                    <button
                      type="button"
                      onClick={() => scrollToPage(Math.max(activePage - 1, 1))}
                      disabled={activePage <= 1}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
                      aria-label="Previous Page"
                      title="Previous Page"
                    >
                      <ChevronUp size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => scrollToPage(Math.min(activePage + 1, numPages))}
                      disabled={activePage >= numPages}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
                      aria-label="Next Page"
                      title="Next Page"
                    >
                      <ChevronDown size={15} />
                    </button>
                  </div>
                </div>

                {/* Zoom Controls */}
                <div className="hidden sm:flex items-center rounded-xl border border-white/10 bg-white/[0.04] p-0.5">
                  <button
                    type="button"
                    onClick={zoomOut}
                    disabled={zoom <= 0.7}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
                    aria-label="Zoom Out"
                    title="Zoom Out"
                  >
                    <ZoomOut size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={resetZoom}
                    className="px-2 font-mono text-[11px] text-white/60 hover:text-white transition cursor-pointer"
                    aria-label="Reset Zoom"
                    title="Reset Zoom to 100%"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <button
                    type="button"
                    onClick={zoomIn}
                    disabled={zoom >= 1.75}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
                    aria-label="Zoom In"
                    title="Zoom In"
                  >
                    <ZoomIn size={14} />
                  </button>
                </div>

                {/* Close Button */}
                <button
                  ref={modalCloseButtonRef}
                  type="button"
                  onClick={onClose}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/80 hover:bg-white/20 hover:text-white hover:scale-105 active:scale-95 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-violet-400"
                  aria-label="Close Terms & Conditions"
                  title="Close (Esc)"
                >
                  <X size={17} />
                </button>
              </div>
            </div>

            {/* Hidden accessibility description */}
            <p id="terms-dialog-desc" className="sr-only">
              Official Saviskar 2K26 Terms and Conditions, Rules, Regulations, and Participant Code of Conduct. Contains 7 pages.
            </p>

            {/* ── PDF DOCUMENT CANVAS SCROLL BODY ── */}
            <div
              ref={containerRef}
              onScroll={handleScroll}
              className="relative flex-1 overflow-y-auto overflow-x-auto p-4 sm:p-8 bg-[#06040a]/90 select-text scrollbar-thin scrollbar-thumb-white/15 scrollbar-track-transparent"
              tabIndex={0}
              aria-label="Terms and Conditions document pages"
            >
              {/* Loading State */}
              {loading && (
                <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full border border-violet-500/30 bg-violet-950/40 text-violet-400 shadow-[0_0_25px_rgba(168,85,247,0.3)]">
                    <Loader2 size={24} className="animate-spin text-violet-300" />
                  </div>
                  <div>
                    <p className="font-mono text-xs uppercase tracking-widest text-violet-300">
                      Loading Official Document
                    </p>
                    <p className="mt-1 text-sm text-white/60">
                      Rendering 7 pages of Saviskar 2K26 Terms &amp; Conditions...
                    </p>
                  </div>
                </div>
              )}

              {/* Load Error State */}
              {loadError && (
                <div className="mx-auto my-12 max-w-md rounded-2xl border border-red-500/30 bg-red-950/40 p-6 text-center text-red-200">
                  <AlertCircle size={28} className="mx-auto mb-3 text-red-400" />
                  <h4 className="text-base font-semibold">Unable to load document</h4>
                  <p className="mt-1 text-xs text-red-300/80">{loadError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setLoading(true);
                      setLoadError(null);
                      void loadPdfEngine();
                    }}
                    className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-xs font-semibold text-black hover:bg-violet-100 transition"
                  >
                    <RotateCcw size={13} />
                    <span>Try Again</span>
                  </button>
                </div>
              )}

              {/* Document Pages Rendering (All 7 Pages) */}
              <div
                className={`flex flex-col items-center gap-6 sm:gap-8 transition-opacity duration-300 ${
                  loading ? "opacity-0 pointer-events-none" : "opacity-100"
                }`}
              >
                {Array.from({ length: numPages }, (_, index) => {
                  const pageNum = index + 1;
                  return (
                    <div
                      key={pageNum}
                      ref={(el) => {
                        if (el) pageRefs.current.set(pageNum, el);
                        else pageRefs.current.delete(pageNum);
                      }}
                      className="relative flex flex-col items-center group"
                    >
                      {/* Page Label / Header Pill */}
                      <div className="mb-2 flex items-center justify-between w-full max-w-[820px] px-2 text-[10px] font-mono text-white/40">
                        <span className="uppercase tracking-wider">
                          SAVISKAR 2K26 // SECTION {pageNum}
                        </span>
                        <span>Page {pageNum} of {numPages}</span>
                      </div>

                      {/* Crisp Canvas Display */}
                      <div className="overflow-hidden rounded-xl border border-white/20 bg-white shadow-[0_15px_40px_rgba(0,0,0,0.8),0_0_20px_rgba(255,255,255,0.05)] transition-all">
                        <canvas
                          ref={(el) => {
                            if (el) canvasRefs.current.set(pageNum, el);
                            else canvasRefs.current.delete(pageNum);
                          }}
                          className="block max-w-full"
                          aria-label={`Official Terms & Conditions Page ${pageNum}`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── BOTTOM FOOTER CONTROLS ── */}
            <div className="relative z-20 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 bg-black/60 px-4 py-3 sm:px-6 sm:py-3.5 backdrop-blur-md">
              <div className="flex items-center gap-2 text-xs text-white/50 font-mono">
                <ShieldCheck size={14} className="text-violet-400 shrink-0" />
                <span className="hidden sm:inline">Official CGC University Saviskar 2K26 Guidelines</span>
                <span className="sm:hidden">Official Guidelines</span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-950/40 px-5 py-2 text-xs font-semibold text-violet-200 hover:bg-violet-900/50 hover:border-violet-400 transition-all cursor-pointer shadow-[0_0_15px_rgba(168,85,247,0.15)] active:scale-95"
                >
                  <CheckCircle2 size={14} className="text-violet-400" />
                  <span>Done Reading • Return to Form</span>
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
