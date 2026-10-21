"use client";

import { useEffect, type RefObject } from "react";
import {
  lockBodyScroll,
  unlockBodyScroll,
} from "./useBodyScrollLock";

export interface UseModalScrollLockOptions {
  isOpen: boolean;
  onClose?: () => void;
  focusRef?: RefObject<HTMLElement | null>;
}

/**
 * Unified modal scroll lock hook for Admin dialogs.
 * Uses the shared reference counter in useBodyScrollLock to guarantee
 * no conflicting or orphaned locks occur across nested or sequential modals.
 */
export function useModalScrollLock({
  isOpen,
  onClose,
  focusRef,
}: UseModalScrollLockOptions) {
  useEffect(() => {
    if (!isOpen) return;

    lockBodyScroll();

    // Escape key listener
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    // Prevent scroll intrusion when focusing modal
    const focusTimer = setTimeout(() => {
      if (focusRef?.current) {
        focusRef.current.focus({ preventScroll: true });
      }
    }, 50);

    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      unlockBodyScroll();
    };
  }, [isOpen, onClose, focusRef]);
}
