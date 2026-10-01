"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  ChevronDown,
  ChevronUp,
  FileText,
  ShieldCheck,
  RotateCcw,
  Loader2,
  Sparkles,
} from "lucide-react";
import Navbar from "@/components/ui/Navbar";
import Footer from "@/components/ui/Footer";

export default function TermsViewerPage() {
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

  // Load PDF.js engine dynamically from public vendor folder
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

  const renderPage = useCallback(
    async (pageNumber: number, pdfDoc: any, currentZoom: number) => {
      const canvas = canvasRefs.current.get(pageNumber);
      if (!canvas || !pdfDoc) return;

      const existingTask = renderTasksRef.current.get(pageNumber);
      if (existingTask && typeof existingTask.cancel === "function") {
        try {
          existingTask.cancel();
        } catch {
          // ignore
        }
      }

      try {
        const page = await pdfDoc.getPage(pageNumber);
        const unscaledViewport = page.getViewport({ scale: 1 });

        const maxStandardWidth = 840;
        const screenWidth = typeof window !== "undefined" ? window.innerWidth - 32 : 840;
        const baseWidth = Math.min(screenWidth, maxStandardWidth);
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

  useEffect(() => {
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
      renderTasksRef.current.forEach((task) => {
        try {
          task.cancel();
        } catch {
          // ignore
        }
      });
      renderTasksRef.current.clear();
    };
  }, [loadPdfEngine, renderPage]);

  useEffect(() => {
    if (!pdfDocRef.current || loading) return;

    const doc = pdfDocRef.current;
    for (let i = 1; i <= doc.numPages; i++) {
      void renderPage(i, doc, zoom);
    }
  }, [zoom, loading, renderPage]);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const containerTop = containerRef.current.getBoundingClientRect().top;

    let current = 1;
    for (let i = 1; i <= numPages; i++) {
      const pageEl = pageRefs.current.get(i);
      if (pageEl) {
        const rect = pageEl.getBoundingClientRect();
        if (rect.top - containerTop <= 200) {
          current = i;
        }
      }
    }
    setActivePage(current);
  }, [numPages]);

  const scrollToPage = (pageNumber: number) => {
    const pageEl = pageRefs.current.get(pageNumber);
    if (pageEl) {
      pageEl.scrollIntoView({ behavior: "smooth", block: "start" });
      setActivePage(pageNumber);
    }
  };

  return (
    <main className="relative min-h-screen w-full bg-black text-white selection:bg-white selection:text-black">
      <Navbar />

      <section className="relative z-10 px-4 pt-28 pb-12 sm:px-6 md:px-10 md:pt-36">
        <div className="mx-auto max-w-5xl">
          {/* Back to Registration Navigation */}
          <div className="mb-6 flex items-center justify-between">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-medium text-white/80 transition-all hover:bg-white/15 hover:text-white"
            >
              <ArrowLeft size={14} />
              <span>Back to Registration</span>
            </Link>

            <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-950/40 px-3.5 py-1 text-[10px] font-mono font-semibold uppercase tracking-wider text-violet-300">
              <Sparkles size={11} className="text-violet-400" />
              <span>Official Document</span>
            </div>
          </div>

          {/* Heading */}
          <div className="mb-8">
            <h1 className="text-3xl sm:text-5xl font-light tracking-tight text-white">
              Official <span className="font-editorial text-violet-300 font-normal italic">Terms &amp; Conditions</span>
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              Rules, Regulations and Participant Code of Conduct for Saviskar 2026: Aevorian Reverie.
            </p>
          </div>

          {/* Viewer Card */}
          <div className="relative rounded-[28px] border border-white/15 bg-gradient-to-b from-[#0e0a1a] via-[#090712] to-[#040208] shadow-[0_30px_100px_rgba(0,0,0,0.9)] overflow-hidden">
            {/* Sticky Floating Control Bar */}
            <div className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-black/75 px-4 py-3 sm:px-6 sm:py-3.5 backdrop-blur-md">
              <div className="flex items-center gap-2 font-mono text-xs text-white/80">
                <FileText size={16} className="text-violet-400" />
                <span>SAVISKAR 2K26</span>
                <span className="text-white/30">•</span>
                <span className="text-violet-300 font-semibold">Page {activePage} of {numPages}</span>
              </div>

              <div className="flex items-center gap-2">
                {/* Page Jump buttons */}
                <div className="flex items-center rounded-lg border border-white/10 bg-white/5 p-0.5">
                  <button
                    type="button"
                    onClick={() => scrollToPage(Math.max(activePage - 1, 1))}
                    disabled={activePage <= 1}
                    className="flex h-7 w-7 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 transition"
                    aria-label="Previous Page"
                  >
                    <ChevronUp size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollToPage(Math.min(activePage + 1, numPages))}
                    disabled={activePage >= numPages}
                    className="flex h-7 w-7 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 transition"
                    aria-label="Next Page"
                  >
                    <ChevronDown size={15} />
                  </button>
                </div>

                {/* Zoom Controls */}
                <div className="flex items-center rounded-lg border border-white/10 bg-white/5 p-0.5">
                  <button
                    type="button"
                    onClick={() => setZoom((prev) => Math.max(Number((prev - 0.15).toFixed(2)), 0.7))}
                    disabled={zoom <= 0.7}
                    className="flex h-7 w-7 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 transition"
                    aria-label="Zoom Out"
                  >
                    <ZoomOut size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom(1.0)}
                    className="px-2 font-mono text-[11px] text-white/60 hover:text-white"
                    aria-label="Reset Zoom"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom((prev) => Math.min(Number((prev + 0.15).toFixed(2)), 1.75))}
                    disabled={zoom >= 1.75}
                    className="flex h-7 w-7 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 transition"
                    aria-label="Zoom In"
                  >
                    <ZoomIn size={13} />
                  </button>
                </div>
              </div>
            </div>

            {/* Canvas Scroll Body */}
            <div
              ref={containerRef}
              onScroll={handleScroll}
              className="max-h-[80vh] overflow-y-auto overflow-x-auto p-4 sm:p-8 bg-[#06040a]/90 select-text scrollbar-thin scrollbar-thumb-white/15"
            >
              {loading && (
                <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 text-center">
                  <Loader2 size={28} className="animate-spin text-violet-400" />
                  <p className="font-mono text-xs text-white/60">
                    Loading 7 pages of Saviskar 2K26 Terms &amp; Conditions...
                  </p>
                </div>
              )}

              {loadError && (
                <div className="mx-auto my-12 max-w-md rounded-2xl border border-red-500/30 bg-red-950/40 p-6 text-center text-red-200">
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
                      className="relative flex flex-col items-center"
                    >
                      <div className="mb-2 flex items-center justify-between w-full max-w-[840px] px-2 text-[10px] font-mono text-white/40">
                        <span className="uppercase">SAVISKAR 2K26 // SECTION {pageNum}</span>
                        <span>Page {pageNum} of {numPages}</span>
                      </div>

                      <div className="overflow-hidden rounded-xl border border-white/20 bg-white shadow-[0_15px_40px_rgba(0,0,0,0.8)]">
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

            {/* Footer banner */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 bg-black/60 px-4 py-3.5 sm:px-6 backdrop-blur-md">
              <div className="flex items-center gap-2 text-xs text-white/50 font-mono">
                <ShieldCheck size={14} className="text-violet-400" />
                <span>SAVISKAR 2K26 Official Participant Code of Conduct</span>
              </div>
              <Link
                href="/register"
                className="inline-flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-950/40 px-5 py-2 text-xs font-semibold text-violet-200 hover:bg-violet-900/50 hover:border-violet-400 transition"
              >
                <span>Return to Registration</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
