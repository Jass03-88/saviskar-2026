"use client";

import { useEffect } from "react";

let activeLockCount = 0;
let originalOverflow = "";
let originalPaddingRight = "";

/**
 * Locks document.body scrolling and prevents layout shift from scrollbar removal.
 */
export function lockBodyScroll() {
  if (typeof document === "undefined") return;

  if (activeLockCount === 0) {
    originalOverflow = document.body.style.overflow || "";
    originalPaddingRight = document.body.style.paddingRight || "";

    const scrollbarWidth =
      typeof window !== "undefined" && document.documentElement
        ? window.innerWidth - document.documentElement.clientWidth
        : 0;

    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    document.body.style.overflow = "hidden";

    // Pause Lenis smooth scrolling if running so background remains stationary
    if (typeof window !== "undefined") {
      const globalLenis = (
        window as unknown as {
          __lenis?: { stop: () => void; start: () => void; resize: () => void };
        }
      ).__lenis;
      if (globalLenis && typeof globalLenis.stop === "function") {
        globalLenis.stop();
      }
    }
  }

  activeLockCount++;
}

/**
 * Unlocks document.body scrolling and restores prior overflow and padding styles
 * once all active lock references have been released.
 */
export function unlockBodyScroll() {
  if (typeof document === "undefined") return;

  activeLockCount = Math.max(0, activeLockCount - 1);
  if (activeLockCount === 0) {
    document.body.style.overflow = originalOverflow;
    document.body.style.paddingRight = originalPaddingRight;

    // Resume Lenis smooth scrolling once all modals are closed
    if (typeof window !== "undefined") {
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
    }
  }
}

/**
 * Custom React hook that locks document.body scrolling when `isLocked` is true.
 *
 * Invariants:
 * 1. Restores prior overflow and paddingRight styles on close or component unmount.
 * 2. Uses a reference counter so nested or sequential modals do not prematurely unlock the background.
 * 3. Prevents layout shift from scrollbar removal by compensating with paddingRight.
 */
export function useBodyScrollLock(isLocked: boolean) {
  useEffect(() => {
    if (!isLocked) return;
    lockBodyScroll();
    return () => {
      unlockBodyScroll();
    };
  }, [isLocked]);
}

/**
 * Test helper for resetting lock state in unit test environments.
 */
export function resetBodyScrollLockForTesting() {
  activeLockCount = 0;
  originalOverflow = "";
  originalPaddingRight = "";
  if (typeof document !== "undefined") {
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
  }
}

export function getActiveBodyLockCountForTesting(): number {
  return activeLockCount;
}
