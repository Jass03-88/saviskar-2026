"use client";

import { useEffect, type RefObject } from "react";

let activeModalCount = 0;
let previousBodyOverflow = "";
let previousHtmlOverflow = "";
let previousBodyPaddingRight = "";
let savedScrollPosition = 0;

export interface UseModalScrollLockOptions {
  isOpen: boolean;
  onClose: () => void;
  focusRef?: RefObject<HTMLElement | null>;
}

export function useModalScrollLock({
  isOpen,
  onClose,
  focusRef,
}: UseModalScrollLockOptions) {
  useEffect(() => {
    if (!isOpen) return;
    if (typeof document === "undefined") return;

    // 1. Lock scroll on the first active modal open
    if (activeModalCount === 0) {
      savedScrollPosition = window.scrollY || window.pageYOffset || 0;
      previousBodyOverflow = document.body.style.overflow;
      previousHtmlOverflow = document.documentElement.style.overflow;
      previousBodyPaddingRight = document.body.style.paddingRight;

      const scrollbarWidth =
        window.innerWidth - document.documentElement.clientWidth;
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      }

      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";

      // Pause Lenis smooth scrolling if running
      const globalLenis = (
        window as unknown as {
          __lenis?: { stop: () => void; start: () => void; resize: () => void };
        }
      ).__lenis;
      if (globalLenis && typeof globalLenis.stop === "function") {
        globalLenis.stop();
      }
    }
    activeModalCount++;

    // 2. Escape key listener
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    // 3. Prevent scroll intrusion when focusing modal close button
    const focusTimer = setTimeout(() => {
      if (focusRef?.current) {
        focusRef.current.focus({ preventScroll: true });
      }
    }, 50);

    // 4. Cleanup when this modal unmounts or closes
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);

      activeModalCount = Math.max(0, activeModalCount - 1);
      if (activeModalCount === 0) {
        document.body.style.overflow = previousBodyOverflow;
        document.documentElement.style.overflow = previousHtmlOverflow;
        document.body.style.paddingRight = previousBodyPaddingRight;

        // Resume Lenis smooth scrolling
        const globalLenis = (
          window as unknown as {
            __lenis?: { stop: () => void; start: () => void; resize: () => void };
          }
        ).__lenis;
        if (globalLenis && typeof globalLenis.start === "function") {
          globalLenis.start();
          if (typeof globalLenis.resize === "function") {
            globalLenis.resize();
          }
        }

        // Restore exact scroll position
        window.scrollTo({
          top: savedScrollPosition,
          behavior: "instant",
        });
      }
    };
  }, [isOpen, onClose, focusRef]);
}
