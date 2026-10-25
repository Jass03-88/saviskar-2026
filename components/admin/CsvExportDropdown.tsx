"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Download, ChevronDown, FileText, Users, RefreshCw } from "lucide-react";

export interface CsvExportDropdownProps {
  onExportRegistrations: () => Promise<void> | void;
  onExportParticipants: () => Promise<void> | void;
  totalRegistrations?: number;
  disabled?: boolean;
  className?: string;
  pillShape?: boolean;
}

export function CsvExportDropdown({
  onExportRegistrations,
  onExportParticipants,
  totalRegistrations,
  disabled = false,
  className = "",
  pillShape = false,
}: CsvExportDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Close on Escape & support keyboard navigation
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        buttonRef.current?.focus();
        return;
      }

      if (!isOpen && (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        setIsOpen(true);
        setTimeout(() => itemRefs.current[0]?.focus(), 50);
        return;
      }

      if (isOpen) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          const nextIndex =
            document.activeElement === itemRefs.current[0] ? 1 : 0;
          itemRefs.current[nextIndex]?.focus();
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          const prevIndex =
            document.activeElement === itemRefs.current[1] ? 0 : 1;
          itemRefs.current[prevIndex]?.focus();
        }
      }
    },
    [isOpen]
  );

  async function handleExport(type: "registration" | "participant") {
    if (isExporting) return;
    setIsExporting(true);
    setIsOpen(false);
    try {
      if (type === "registration") {
        await onExportRegistrations();
      } else {
        await onExportParticipants();
      }
    } catch (err: unknown) {
      console.error("Export failed:", err);
      if (typeof window !== "undefined") {
        window.alert(
          err instanceof Error
            ? `Export failed: ${err.message}`
            : "Failed to generate Excel workbook. Please try again."
        );
      }
    } finally {
      setIsExporting(false);
    }
  }

  const roundedClass = pillShape ? "rounded-full" : "rounded-[18px]";

  return (
    <div
      ref={dropdownRef}
      className={`relative inline-block text-left ${className}`}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={buttonRef}
        type="button"
        id="csv-export-dropdown-button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="csv-export-dropdown-menu"
        disabled={disabled || isExporting}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center justify-center gap-2 ${roundedClass} bg-black px-5 py-3 text-sm text-white transition hover:opacity-90 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed shadow-sm`}
        title="Export Excel workbook (.xlsx)"
      >
        {isExporting ? (
          <RefreshCw size={15} className="animate-spin text-white/80" />
        ) : (
          <Download size={15} />
        )}
        <span>{isExporting ? "Exporting..." : "Export Excel"}</span>
        <ChevronDown
          size={14}
          className={`transition-transform duration-200 text-white/70 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div
          id="csv-export-dropdown-menu"
          role="menu"
          aria-labelledby="csv-export-dropdown-button"
          className="absolute right-0 top-full mt-2 z-[100] w-72 sm:w-80 rounded-2xl bg-white p-1.5 shadow-2xl border border-black/10 divide-y divide-black/[0.06] animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="p-1">
            <button
              ref={(el) => {
                itemRefs.current[0] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={0}
              disabled={isExporting}
              onClick={() => handleExport("registration")}
              className="w-full text-left p-3 rounded-xl transition hover:bg-black/[0.04] focus:bg-black/[0.04] focus:outline-none flex items-start gap-3 group"
              aria-label="Export Registrations: One row per registration, including team registration details."
            >
              <div className="mt-0.5 p-2 rounded-lg bg-black/[0.04] text-black/70 group-hover:bg-black group-hover:text-white group-focus:bg-black group-focus:text-white transition">
                <FileText size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-black flex items-center justify-between">
                  <span>Export Registrations</span>
                  {totalRegistrations !== undefined && (
                    <span className="text-[10px] text-black/40 font-mono font-normal">
                      ({totalRegistrations})
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-black/50 mt-0.5 leading-relaxed">
                  One row per registration, including team registration details.
                </p>
              </div>
            </button>
          </div>

          <div className="p-1">
            <button
              ref={(el) => {
                itemRefs.current[1] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={0}
              disabled={isExporting}
              onClick={() => handleExport("participant")}
              className="w-full text-left p-3 rounded-xl transition hover:bg-black/[0.04] focus:bg-black/[0.04] focus:outline-none flex items-start gap-3 group"
              aria-label="Export Participants: One row per individual participant, including team members."
            >
              <div className="mt-0.5 p-2 rounded-lg bg-black/[0.04] text-black/70 group-hover:bg-black group-hover:text-white group-focus:bg-black group-focus:text-white transition">
                <Users size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-black flex items-center justify-between">
                  <span>Export Participants</span>
                  <span className="text-[10px] text-black/40 font-mono font-normal">
                    All attendees
                  </span>
                </div>
                <p className="text-[11px] text-black/50 mt-0.5 leading-relaxed">
                  One row per individual participant, including team members.
                </p>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
