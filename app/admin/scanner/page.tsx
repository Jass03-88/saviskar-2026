"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Html5Qrcode } from "html5-qrcode";
import { supabase } from "@/lib/supabase";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  LogOut,
  QrCode,
  RotateCcw,
  ShieldCheck,
  User,
  XCircle,
} from "lucide-react";
import { evaluateEventPaymentStatus } from "@/lib/admin/check-in-rules";
import { getCanonicalStayLabel } from "@/lib/accommodation-dates";

function SearchIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function UsersIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function ChevronDownIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ChevronUpIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

function AlertTriangleIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function BuildingIcon({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01" />
      <path d="M16 6h.01" />
      <path d="M12 6h.01" />
      <path d="M12 10h.01" />
      <path d="M12 14h.01" />
      <path d="M16 10h.01" />
      <path d="M16 14h.01" />
      <path d="M8 10h.01" />
      <path d="M8 14h.01" />
    </svg>
  );
}

export type Participant = {
  id?: string;
  participantId: string;
  participant_id?: string;
  name: string;
  college: string;
  email: string;
  phone: string;
  gender: string;
  state: string;
  idCardUrl: string | null;
};

export type FacultyIncharge = {
  id: string;
  registrationGroupId: string;
  name: string;
  college: string;
  email: string;
  phone: string;
  gender: string;
  state: string;
  idCardUrl: string | null;
};

export type TeamMemberAccommodation = {
  hasBooking: boolean;
  bookingStatus: string | null;
  planName: string | null;
  durationDays: number | null;
  startDate: string | null;
  endDate: string | null;
  checkoutDate: string | null;
  stayLabel: string | null;
  amountDue: number | null;
  amountPaid: number | null;
  balance: number | null;
  paymentStatus: string | null;
  checkedIn: boolean;
  checkedInAt: string | null;
  checkedOut: boolean;
  checkedOutAt: string | null;
  hostelName: string | null;
  roomNumber: string | null;
  floorNumber: string | null;
};

export type TeamRosterMember = {
  id: string;
  participantRecordId?: string | null;
  participantId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  college?: string | null;
  gender?: string | null;
  state?: string | null;
  isTeamLeader: boolean;
  isScannedParticipant: boolean;
  eventRegistrationStatus?: string | null;
  eventPaymentStatus?: string | null;
  eventCheckedIn?: boolean;
  eventCheckedInAt?: string | null;
  mainCheckedIn?: boolean;
  mainCheckedInAt?: string | null;
  accommodation: TeamMemberAccommodation | null;
};

export type TeamRoster = {
  teamName: string | null;
  leaderParticipantId: string | null;
  leaderName: string | null;
  members: TeamRosterMember[];
};

export type ParticipantEvent = {
  participantEventId: string;
  eventId: string;
  eventName: string;
  eventCategory?: string | null;
  registrationFee?: number | null;
  paymentType?: string | null;
  paymentUnit?: string | null;
  registrationType?: string | null;
  registrationStatus: string | null;
  paymentStatus: string | null;
  paymentAmount: number | null;
  teamName: string | null;
  checkedIn: boolean;
  checkedInAt: string | null;
  mainCheckedIn: boolean;
  mainCheckedInAt: string | null;
  registrationGroupId?: string | null;
  isTeamEvent?: boolean;
  userRole?: "leader" | "member" | "individual";
  amountDue?: number;
  amountPaid?: number;
  balance?: number;
  team?: TeamRoster | null;
};

export type ParticipantAccommodation = {
  id: string;
  status: string;
  start_date: string;
  end_date: string;
  checkout_date?: string;
  duration_days: number;
  stayLabel?: string;
  amountDue?: number;
  amountPaid?: number;
  balance?: number;
  paymentStatus?: string;
  checked_in: boolean;
  checked_in_at: string | null;
  checked_out: boolean;
  checked_out_at: string | null;
  planName: string;
  hostelName: string | null;
  roomNumber: string | null;
  floorNumber: string | null;
  paymentOrderId?: string | null;
  paymentOrderReference?: string | null;
};

export type ScannerWarning = {
  id: string;
  type: "warning" | "info" | "review";
  title: string;
  message: string;
};

export type ScannerMode = "main" | "event" | "accommodation";

export default function ScannerPage() {
  const router = useRouter();

  // Crucial: Keep hook indices 0..10 matching existing test mock sequence
  const scannerRef = useRef<Html5Qrcode | null>(null); // 0
  const processingRef = useRef(false); // 1

  const [scannerMode, setScannerMode] = useState<ScannerMode>("main"); // 2
  const [participant, setParticipant] = useState<Participant | null>(null); // 3
  const [participantEvents, setParticipantEvents] = useState<ParticipantEvent[]>([]); // 4
  const [accommodations, setAccommodations] = useState<ParticipantAccommodation[]>([]); // 5
  const [faculty, setFaculty] = useState<FacultyIncharge[]>([]); // 6

  const [loading, setLoading] = useState(false); // 7
  const [scannerStarted, setScannerStarted] = useState(false); // 8
  const [error, setError] = useState(""); // 9
  const [success, setSuccess] = useState(""); // 10

  // Enhanced state variables (indices 11+)
  const [manualInput, setManualInput] = useState(""); // 11
  const [manualError, setManualError] = useState(""); // 12
  const [expandedTeams, setExpandedTeams] = useState<Record<string, boolean>>({}); // 13
  const [warnings, setWarnings] = useState<ScannerWarning[]>([]); // 14

  const checkAdmin = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      router.replace("/admin/login");
    }
  }, [router]);

  async function startScanner() {
    setError("");
    setSuccess("");
    setManualError("");
    setParticipant(null);
    setParticipantEvents([]);
    setAccommodations([]);
    setFaculty([]);
    setWarnings([]);

    try {
      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const qrEdge = Math.max(180, Math.floor(minEdge * 0.72));
            return { width: qrEdge, height: qrEdge };
          },
        },
        async (decodedText) => {
          if (processingRef.current) return;
          processingRef.current = true;
          await stopScanner();
          await findRegistration(decodedText);
          processingRef.current = false;
        },
        () => {}
      );

      setScannerStarted(true);
    } catch (err) {
      console.error("SCANNER ERROR:", err);
      setError("Camera could not be started. Please allow camera permission and try again.");
    }
  }

  async function stopScanner() {
    const scanner = scannerRef.current;
    if (!scanner) return;

    try {
      if (scanner.isScanning) {
        await scanner.stop();
      }
      scanner.clear();
    } catch {
      console.log("Scanner already stopped.");
    }

    scannerRef.current = null;
    setScannerStarted(false);
  }

  useEffect(() => {
    void checkAdmin();

    return () => {
      void stopScanner();
    };
  }, [checkAdmin]);

  // Read-only registration lookup by QR or manual input
  async function findRegistration(scannedValue: string) {
    setLoading(true);
    setError("");
    setSuccess("");
    setManualError("");
    setParticipantEvents([]);
    setAccommodations([]);
    setFaculty([]);
    setWarnings([]);

    try {
      let registrationId = scannedValue.trim();

      if (registrationId.startsWith("SAVISKAR:")) {
        registrationId = registrationId.replace("SAVISKAR:", "").trim();
      }

      const normalizedId = registrationId.toUpperCase();

      if (/^SVK26-[A-Z0-9]{8}$/i.test(normalizedId)) {
        const lookupResponse = await fetch(
          `/api/admin/participants/${encodeURIComponent(normalizedId)}`,
          { cache: "no-store" }
        );
        const lookup = (await lookupResponse.json()) as {
          success?: boolean;
          error?: string;
          participant?: Participant;
          faculty?: FacultyIncharge[];
          events?: ParticipantEvent[];
          accommodations?: ParticipantAccommodation[];
          warnings?: ScannerWarning[];
        };

        if (!lookupResponse.ok || !lookup.success || !lookup.participant) {
          setParticipant(null);
          setError(lookup.error || "Participant not found. Invalid ID or QR code.");
          return;
        }

        const foundEvents = lookup.events ?? [];
        const foundAccommodations = lookup.accommodations ?? [];
        const foundFaculty = lookup.faculty ?? [];
        const foundWarnings = lookup.warnings ?? [];

        setParticipant(lookup.participant);
        setParticipantEvents(foundEvents);
        setAccommodations(foundAccommodations);
        setFaculty(foundFaculty);
        setWarnings(foundWarnings);

        if (foundEvents.length === 0 && foundAccommodations.length === 0) {
          setError("Participant found, but they are not registered for any events and have no accommodation.");
        }

        return;
      } else {
        setParticipant(null);
        setError("Invalid participant ID format. Expected format: SVK26-XXXXXXXX");
        return;
      }
    } catch (err) {
      console.error("VERIFY ERROR:", err);
      setError("Unable to verify this registration.");
    } finally {
      setLoading(false);
    }
  }

  function handleManualSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setManualError("");

    const trimmed = manualInput.trim();
    if (!trimmed) {
      setManualError("Please enter a participant ID.");
      return;
    }

    let normalized = trimmed;
    if (normalized.startsWith("SAVISKAR:")) {
      normalized = normalized.replace("SAVISKAR:", "").trim();
    }
    normalized = normalized.toUpperCase();

    if (!/^SVK26-[A-Z0-9]{8}$/i.test(normalized)) {
      setManualError("Invalid format. Expected format: SVK26-XXXXXXXX (e.g. SVK26-D74CC75C).");
      return;
    }

    void stopScanner();
    void findRegistration(normalized);
  }

  function toggleTeamRoster(eventId: string) {
    setExpandedTeams((prev) => ({
      ...prev,
      [eventId]: !prev[eventId],
    }));
  }

  // Explicit check-in mutations
  async function handleCheckIn(
    participantEventId: string,
    eventName: string,
    teamName: string | null,
    type: "event" | "main"
  ) {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantEventId,
          action: type === "main" ? "main_check_in" : "check_in",
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Could not check in.");
      }

      const targetEvent = participantEvents.find((e) => e.participantEventId === participantEventId);
      const groupId = targetEvent?.registrationGroupId;

      setParticipantEvents((events) =>
        events.map((event) => {
          if (type === "main") {
            if (
              (groupId && event.registrationGroupId === groupId) ||
              (!groupId && event.participantEventId === participantEventId)
            ) {
              return { ...event, mainCheckedIn: true, mainCheckedInAt: result.main_checked_in_at };
            }
          } else {
            if (event.participantEventId === participantEventId) {
              return { ...event, checkedIn: true, checkedInAt: result.checked_in_at };
            }
          }
          return event;
        })
      );

      setSuccess(
        teamName
          ? `${teamName} has been successfully checked in for ${
              type === "main" ? "Main Registration" : eventName
            }.`
          : `${participant?.name} has been successfully checked in for ${
              type === "main" ? "Main Registration" : eventName
            }.`
      );
    } catch (err) {
      console.error("CHECK-IN ERROR:", err);
      setError(err instanceof Error ? err.message : "Could not check in participant.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckOut(
    participantEventId: string,
    eventName: string,
    teamName: string | null,
    type: "event" | "main"
  ) {
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/admin/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantEventId,
          action: type === "main" ? "main_check_out" : "check_out",
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Could not check out.");
      }

      const targetEvent = participantEvents.find((e) => e.participantEventId === participantEventId);
      const groupId = targetEvent?.registrationGroupId;

      setParticipantEvents((events) =>
        events.map((event) => {
          if (type === "main") {
            if (
              (groupId && event.registrationGroupId === groupId) ||
              (!groupId && event.participantEventId === participantEventId)
            ) {
              return { ...event, mainCheckedIn: false, mainCheckedInAt: null };
            }
          } else {
            if (event.participantEventId === participantEventId) {
              return { ...event, checkedIn: false, checkedInAt: null };
            }
          }
          return event;
        })
      );

      setSuccess(
        teamName
          ? `${teamName} has been successfully checked out of ${
              type === "main" ? "Main Registration" : eventName
            }.`
          : `${participant?.name} has been successfully checked out of ${
              type === "main" ? "Main Registration" : eventName
            }.`
      );
    } catch (err) {
      console.error("CHECK-OUT ERROR:", err);
      setError(err instanceof Error ? err.message : "Could not check out participant.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAccommodationCheckIn(participantAccommodationId: string, planName: string) {
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/admin/accommodations/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantAccommodationId }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error?.message || result.error || "Could not check in to accommodation."
        );
      }

      setAccommodations((accs) =>
        accs.map((acc) => {
          if (acc.id === participantAccommodationId) {
            return { ...acc, checked_in: true, checked_in_at: result.data.checked_in_at };
          }
          return acc;
        })
      );

      setSuccess(`${participant?.name} has been successfully checked in for ${planName} Accommodation.`);
    } catch (err) {
      console.error("ACCOMMODATION CHECK-IN ERROR:", err);
      setError(err instanceof Error ? err.message : "Could not check in to accommodation.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAccommodationCheckOut(participantAccommodationId: string, planName: string) {
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/admin/accommodations/check-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantAccommodationId }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error?.message || result.error || "Could not check out of accommodation."
        );
      }

      setAccommodations((accs) =>
        accs.map((acc) => {
          if (acc.id === participantAccommodationId) {
            return { ...acc, checked_out: true, checked_out_at: result.data.checked_out_at };
          }
          return acc;
        })
      );

      setSuccess(`${participant?.name} has been successfully checked out of ${planName} Accommodation.`);
    } catch (err) {
      console.error("ACCOMMODATION CHECK-OUT ERROR:", err);
      setError(err instanceof Error ? err.message : "Could not check out of accommodation.");
    } finally {
      setLoading(false);
    }
  }

  async function scanAnother() {
    setParticipant(null);
    setParticipantEvents([]);
    setAccommodations([]);
    setFaculty([]);
    setWarnings([]);
    setManualInput("");
    setManualError("");
    setError("");
    setSuccess("");

    processingRef.current = false;
    await startScanner();
  }

  return (
    <main className="min-h-screen bg-[#f5f5f5] px-4 py-6 sm:px-6 md:px-8 lg:px-10 xl:px-12">
      <div className="mx-auto max-w-[1480px]">
        {/* HEADER */}
        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-black/40">
              Saviskar 2026
            </p>

            <h1 className="text-3xl font-bold tracking-tight text-black md:text-4xl">
              Entry Scanner
            </h1>

            <p className="mt-1 text-xs md:text-sm text-black/50">
              Verify participant identities, team rosters, event passes, and campus accommodations.
            </p>
          </div>

          <button
            onClick={() => router.push("/admin")}
            className="self-start md:self-auto flex items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2.5 text-xs sm:text-sm font-medium text-black transition hover:bg-black hover:text-white shadow-sm"
          >
            <ArrowLeft size={15} />
            Dashboard
          </button>
        </div>

        {/* SCANNER MODE SELECTOR */}
        <div className="mb-6 flex overflow-x-auto rounded-2xl bg-black/[0.04] p-1 border border-black/5">
          <button
            onClick={() => {
              setScannerMode("main");
              setParticipant(null);
              setParticipantEvents([]);
              setAccommodations([]);
              setFaculty([]);
              setWarnings([]);
              setError("");
              setSuccess("");
            }}
            className={`flex-1 whitespace-nowrap rounded-xl px-4 py-2 text-xs sm:text-sm font-medium transition ${
              scannerMode === "main" ? "bg-white text-black shadow-sm" : "text-black/60 hover:text-black"
            }`}
          >
            Main Registration
          </button>
          <button
            onClick={() => {
              setScannerMode("event");
              setParticipant(null);
              setParticipantEvents([]);
              setAccommodations([]);
              setFaculty([]);
              setWarnings([]);
              setError("");
              setSuccess("");
            }}
            className={`flex-1 whitespace-nowrap rounded-xl px-4 py-2 text-xs sm:text-sm font-medium transition ${
              scannerMode === "event" ? "bg-white text-black shadow-sm" : "text-black/60 hover:text-black"
            }`}
          >
            Event Check-in
          </button>
          <button
            onClick={() => {
              setScannerMode("accommodation");
              setParticipant(null);
              setParticipantEvents([]);
              setAccommodations([]);
              setFaculty([]);
              setWarnings([]);
              setError("");
              setSuccess("");
            }}
            className={`flex-1 whitespace-nowrap rounded-xl px-4 py-2 text-xs sm:text-sm font-medium transition ${
              scannerMode === "accommodation" ? "bg-white text-black shadow-sm" : "text-black/60 hover:text-black"
            }`}
          >
            Accommodation
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[380px_1fr] xl:grid-cols-[410px_1fr] items-start">
          {/* LEFT PANEL: CAMERA & MANUAL SEARCH */}
          <div className="flex flex-col gap-5 lg:sticky lg:top-6 lg:self-start">
            {/* MANUAL PARTICIPANT ID SEARCH CARD */}
            <div className="rounded-2xl border border-black/10 bg-white p-4 sm:p-5 shadow-sm">
              <div className="mb-3.5 flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-black/5 text-black">
                  <SearchIcon size={16} />
                </div>
                <div>
                  <h3 className="font-semibold text-zinc-900 text-sm">Manual Participant ID Search</h3>
                  <p className="text-xs text-zinc-500">Search permanent ID (e.g. SVK26-D74CC75C)</p>
                </div>
              </div>

              <form onSubmit={handleManualSubmit} className="space-y-3">
                <div className="relative">
                  <input
                    type="text"
                    value={manualInput}
                    onChange={(e) => {
                      setManualInput(e.target.value);
                      if (manualError) setManualError("");
                    }}
                    placeholder="Enter Participant ID (e.g. SVK26-XXXXXXXX)"
                    className="w-full rounded-xl border border-black/15 bg-zinc-50 px-3.5 py-2.5 font-mono text-xs sm:text-sm uppercase text-black placeholder:normal-case placeholder:font-sans placeholder:text-zinc-400 focus:border-black focus:bg-white focus:outline-none"
                    disabled={loading}
                  />
                  {manualInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setManualInput("");
                        setManualError("");
                      }}
                      className="absolute right-3 top-2.5 text-zinc-400 hover:text-black"
                    >
                      <XCircle size={16} />
                    </button>
                  )}
                </div>

                {manualError && (
                  <p className="text-xs font-medium text-red-600 pl-1">{manualError}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-black py-2.5 text-xs sm:text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      Searching...
                    </>
                  ) : (
                    <>
                      <SearchIcon size={15} />
                      Verify Participant ID
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* QR SCANNER CARD */}
            <div className="rounded-2xl bg-black p-4 sm:p-5 text-white shadow-sm">
              <div className="mb-3.5 flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10">
                  <QrCode size={17} />
                </div>

                <div>
                  <p className="font-semibold text-sm">QR Scanner</p>
                  <p className="text-xs text-white/50">Point camera at registration QR</p>
                </div>
              </div>

              <div
                id="qr-reader"
                className="w-full max-w-full overflow-hidden rounded-xl bg-black [&_video]:w-full [&_video]:max-w-full [&_video]:rounded-xl [&_video]:object-cover [&_canvas]:max-w-full"
              />

              {!scannerStarted && !participant && (
                <div className="flex min-h-[220px] flex-col items-center justify-center text-center p-3">
                  <QrCode size={40} className="mb-4 text-white/20" />
                  <p className="mb-1 text-sm font-semibold">Ready to scan</p>
                  <p className="mb-5 max-w-xs text-xs text-white/50">
                    Start the camera to scan participant passes, or use the manual search above.
                  </p>

                  <button
                    onClick={startScanner}
                    className="rounded-full bg-white px-6 py-2.5 text-xs sm:text-sm font-semibold text-black transition hover:scale-[1.02] shadow-sm"
                  >
                    Start camera
                  </button>
                </div>
              )}

              {scannerStarted && (
                <p className="mt-3 text-center text-xs text-white/50 animate-pulse">Looking for QR code...</p>
              )}
            </div>
          </div>

          {/* RIGHT PANEL: VERIFICATION & AUDIT PANEL */}
          <div className="min-w-0 rounded-2xl bg-white p-5 sm:p-6 lg:p-7 shadow-[0_10px_40px_rgba(0,0,0,0.04)] border border-black/5">
            <div className="mb-5 flex items-center justify-between border-b border-black/10 pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-zinc-600" />
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-600">
                  Verification Record
                </p>
              </div>
              <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider bg-black/5 px-2.5 py-0.5 rounded-full">
                Mode: {scannerMode === "main" ? "Main" : scannerMode === "event" ? "Event" : "Accommodation"}
              </span>
            </div>

            {loading && (
              <div aria-live="polite" className="flex min-h-[300px] items-center justify-center">
                <div className="text-center">
                  <Loader2 size={26} className="mx-auto mb-3 animate-spin text-zinc-700" />
                  <p className="text-zinc-600 text-sm font-medium">Verifying participant records...</p>
                </div>
              </div>
            )}

            {!loading && !participant && !error && (
              <div className="flex min-h-[300px] flex-col items-center justify-center text-center">
                <ShieldCheck size={36} className="mb-4 text-zinc-300" />
                <p className="text-zinc-900 font-semibold text-base">Waiting for participant</p>
                <p className="text-zinc-500 text-xs sm:text-sm mt-1 max-w-sm">
                  Scan a QR code or enter a permanent ID to inspect full records.
                </p>
              </div>
            )}

            {error && (
              <div
                role="alert"
                aria-live="assertive"
                className="flex min-h-[300px] flex-col items-center justify-center text-center p-4"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
                  <XCircle size={24} />
                </div>

                <p className="font-semibold text-zinc-900 text-base">Verification failed</p>
                <p className="mt-1.5 max-w-sm text-xs sm:text-sm text-zinc-600">{error}</p>

                <button
                  onClick={scanAnother}
                  className="mt-6 flex items-center gap-2 rounded-full bg-black px-5 py-2.5 text-xs sm:text-sm font-medium text-white shadow-sm"
                >
                  <RotateCcw size={14} />
                  Scan again
                </button>
              </div>
            )}

            {!loading && participant && (
              <div className="!text-black space-y-6">
                {/* 1. SCANNED PARTICIPANT PROFILE */}
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-black/[0.05] text-black">
                        <User size={20} />
                      </div>

                      <div>
                        <p className="text-lg sm:text-xl font-bold text-black">{participant.name}</p>
                        <p className="text-xs sm:text-sm text-black/60">{participant.college}</p>
                      </div>
                    </div>

                    {participant.idCardUrl && (
                      <a
                        href={participant.idCardUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl bg-violet-50 px-3.5 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-100 transition border border-violet-200"
                      >
                        View Official ID Document
                      </a>
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 border-t border-black/10 pt-4">
                    <Detail label="Permanent ID" value={participant.participantId} mono />
                    <Detail label="Email" value={participant.email} />
                    <Detail label="Phone" value={participant.phone} />
                    <Detail label="Gender" value={participant.gender} />
                    <Detail label="State" value={participant.state} />
                  </div>

                  {faculty.length > 0 && (
                    <div className="mt-4 border-t border-black/10 pt-4">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-black/60">
                        Faculty Incharge
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {faculty.map((f) => (
                          <div
                            key={f.id}
                            className="rounded-xl border border-black/[0.08] bg-zinc-50/70 p-3"
                          >
                            <p className="text-sm font-semibold">{f.name}</p>
                            <p className="text-xs text-black/60">{f.college}</p>
                            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                              <Detail label="Email" value={f.email} />
                              <Detail label="Phone" value={f.phone} />
                            </div>
                            {f.idCardUrl && (
                              <div className="mt-2.5">
                                <a
                                  href={f.idCardUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 border border-violet-200"
                                >
                                  View Faculty ID Card
                                </a>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. WARNINGS & ITEMS REQUIRING STAFF REVIEW */}
                {warnings.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5">
                    <div className="mb-2 flex items-center gap-2 text-amber-800">
                      <AlertTriangleIcon size={15} />
                      <h4 className="text-xs font-bold uppercase tracking-wider">
                        Staff Review Notices ({warnings.length})
                      </h4>
                    </div>
                    <ul className="space-y-1 text-xs text-amber-900">
                      {warnings.map((w) => (
                        <li key={w.id} className="flex items-start gap-1.5">
                          <span className="text-amber-500 font-bold leading-relaxed">•</span>
                          <span>
                            <strong className="font-semibold">{w.title}:</strong> {w.message}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 3. REGISTERED EVENTS SECTION (With Expandable Team Roster) */}
                {participantEvents.length > 0 && (
                  <div className="border-t border-black/10 pt-5">
                    <div className="mb-3.5 flex items-center justify-between">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-black/60">
                        Registered Events ({participantEvents.length})
                      </p>
                    </div>

                    <div className="space-y-4">
                      {participantEvents.map((event) => {
                        const paymentDecision = evaluateEventPaymentStatus({
                          registrationFee: event.registrationFee,
                          paymentType: event.paymentType,
                          paymentAmount: event.paymentAmount,
                          paymentStatus: event.paymentStatus,
                          registrationStatus: event.registrationStatus,
                        });

                        const isUnpaid = !paymentDecision.canCheckIn;
                        const isExpanded = Boolean(expandedTeams[event.participantEventId]);
                        const team = event.team;
                        const feeDue =
                          typeof event.amountDue === "number"
                            ? event.amountDue
                            : (event.registrationFee ?? 0);
                        const feePaid =
                          typeof event.amountPaid === "number"
                            ? event.amountPaid
                            : isUnpaid
                            ? 0
                            : (event.paymentAmount ?? 0);
                        const balance =
                          typeof event.balance === "number"
                            ? event.balance
                            : (paymentDecision.isFree ? 0 : (isUnpaid ? feeDue : 0));

                        return (
                          <div
                            key={event.participantEventId}
                            className={`rounded-2xl border p-4 sm:p-5 transition ${
                              isUnpaid
                                ? "border-red-200 bg-red-50/30"
                                : "border-black/[0.08] bg-black/[0.01]"
                            }`}
                          >
                            {/* EVENT HEADER */}
                            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-3.5">
                              <div>
                                <p className="text-base font-bold text-black">{event.eventName}</p>
                                {event.teamName ? (
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                    <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 rounded-full">
                                      Team: {event.teamName}
                                    </span>
                                    {event.userRole === "leader" && (
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full">
                                        Team Leader
                                      </span>
                                    )}
                                    {event.userRole === "member" && (
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                                        Team Member
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <p className="mt-0.5 text-xs text-black/60">Individual Registration</p>
                                )}
                              </div>

                              {/* STATUS BADGES */}
                              <div className="flex flex-wrap items-center gap-1.5">
                                {paymentDecision.isFree ? (
                                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700 whitespace-nowrap">
                                    FREE EVENT
                                  </span>
                                ) : isUnpaid ? (
                                  <span className="rounded-full border border-red-200 bg-red-100 px-2.5 py-0.5 text-[10px] font-semibold text-red-700 whitespace-nowrap">
                                    {paymentDecision.badgeLabel || `UNPAID (${event.paymentStatus || "unpaid"})`}
                                  </span>
                                ) : (
                                  <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-[10px] font-semibold text-green-700 whitespace-nowrap">
                                    PAID
                                  </span>
                                )}

                                <span
                                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${
                                    event.mainCheckedIn
                                      ? "bg-blue-50 text-blue-700 border border-blue-200"
                                      : "bg-black/[0.05] text-black/50"
                                  }`}
                                >
                                  Main: {event.mainCheckedIn ? "Checked in" : "Pending"}
                                </span>
                                <span
                                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${
                                    event.checkedIn
                                      ? "bg-green-50 text-green-700 border border-green-200"
                                      : "bg-black/[0.05] text-black/50"
                                  }`}
                                >
                                  Event: {event.checkedIn ? "Checked in" : "Pending"}
                                </span>
                              </div>
                            </div>

                            {/* SEPARATE EVENT FINANCIAL SUMMARY */}
                            <div className="mb-3.5 rounded-xl border border-black/5 bg-white p-3 text-xs shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
                              <div className="grid grid-cols-3 gap-2">
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-black/40 block">
                                    Fee Due
                                  </span>
                                  <span className="font-semibold text-black text-sm">
                                    {paymentDecision.isFree ? "₹0 (Free)" : `₹${feeDue}`}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-black/40 block">
                                    Amount Paid
                                  </span>
                                  <span className="font-semibold text-emerald-700 text-sm">₹{feePaid}</span>
                                </div>
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-black/40 block">
                                    Event Balance
                                  </span>
                                  <span
                                    className={`font-semibold text-sm ${
                                      balance > 0 ? "text-red-600" : "text-black/70"
                                    }`}
                                  >
                                    ₹{balance}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* CHECK-IN ACTION BUTTONS */}
                            <div className="mb-3">
                              {isUnpaid ? (
                                <div className="w-full">
                                  <button
                                    disabled
                                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-black/10 py-2.5 text-xs sm:text-sm font-medium text-black/40 cursor-not-allowed"
                                  >
                                    <XCircle size={15} />
                                    Check in Disabled (Payment Required)
                                  </button>
                                  <p className="mt-1.5 text-center text-xs font-medium text-red-600">
                                    {paymentDecision.rejectionReason ||
                                      `Payment is incomplete (${event.paymentStatus}). Participant cannot be checked in.`}
                                  </p>
                                </div>
                              ) : (
                                <div className="grid grid-cols-1 gap-2">
                                  {scannerMode === "main" && (
                                    <>
                                      {!event.mainCheckedIn ? (
                                        <button
                                          onClick={() =>
                                            handleCheckIn(
                                              event.participantEventId,
                                              event.eventName,
                                              event.teamName,
                                              "main"
                                            )
                                          }
                                          disabled={loading}
                                          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-xs sm:text-sm font-semibold !text-white transition hover:bg-blue-700 disabled:opacity-50 shadow-sm"
                                        >
                                          <CheckCircle2 size={15} />
                                          Main Check-in
                                        </button>
                                      ) : (
                                        <button
                                          onClick={() =>
                                            handleCheckOut(
                                              event.participantEventId,
                                              event.eventName,
                                              event.teamName,
                                              "main"
                                            )
                                          }
                                          disabled={loading}
                                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 py-2.5 text-xs sm:text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
                                        >
                                          <LogOut size={15} />
                                          Main Check-out
                                        </button>
                                      )}
                                    </>
                                  )}

                                  {scannerMode === "event" && (
                                    <>
                                      {!event.checkedIn ? (
                                        <button
                                          onClick={() =>
                                            handleCheckIn(
                                              event.participantEventId,
                                              event.eventName,
                                              event.teamName,
                                              "event"
                                            )
                                          }
                                          disabled={loading}
                                          className="flex w-full items-center justify-center gap-2 rounded-xl bg-black py-2.5 text-xs sm:text-sm font-semibold !text-white transition hover:bg-zinc-800 disabled:opacity-50 shadow-sm"
                                        >
                                          <CheckCircle2 size={15} />
                                          Event Check-in
                                        </button>
                                      ) : (
                                        <button
                                          onClick={() =>
                                            handleCheckOut(
                                              event.participantEventId,
                                              event.eventName,
                                              event.teamName,
                                              "event"
                                            )
                                          }
                                          disabled={loading}
                                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 py-2.5 text-xs sm:text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                                        >
                                          <LogOut size={15} />
                                          Event Check-out
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* EXPANDABLE TEAM ROSTER */}
                            {team && team.members && team.members.length > 0 && (
                              <div className="mt-3 border-t border-black/10 pt-3">
                                <button
                                  type="button"
                                  onClick={() => toggleTeamRoster(event.participantEventId)}
                                  className="flex w-full items-center justify-between rounded-xl bg-zinc-100/80 px-3.5 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-200/80 transition"
                                >
                                  <span className="flex items-center gap-2">
                                    <UsersIcon size={15} className="text-zinc-500" />
                                    <span>
                                      {isExpanded
                                        ? "Hide team roster"
                                        : `View full team (${team.members.length} members)`}
                                    </span>
                                  </span>
                                  {isExpanded ? (
                                    <ChevronUpIcon size={15} />
                                  ) : (
                                    <ChevronDownIcon size={15} />
                                  )}
                                </button>

                                {isExpanded && (
                                  <div className="mt-3 space-y-2.5">
                                    <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1 flex items-center justify-between">
                                      <span>Team Roster ({team.teamName || "Team"})</span>
                                      {team.leaderName && <span>Leader: {team.leaderName}</span>}
                                    </div>

                                    {team.members.map((member) => (
                                      <div
                                        key={member.id}
                                        className={`rounded-xl border p-3 text-xs ${
                                          member.isScannedParticipant
                                            ? "border-blue-200 bg-blue-50/50"
                                            : "border-black/10 bg-white"
                                        }`}
                                      >
                                        <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1.5">
                                          <div className="flex items-center gap-1.5">
                                            <span className="font-semibold text-zinc-900">{member.name}</span>
                                            {member.isTeamLeader && (
                                              <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-bold text-purple-700">
                                                LEADER
                                              </span>
                                            )}
                                            {member.isScannedParticipant && (
                                              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">
                                                SCANNED
                                              </span>
                                            )}
                                          </div>
                                          <span className="font-mono text-[10px] text-zinc-500">
                                            {member.participantId || "Unlinked ID"}
                                          </span>
                                        </div>

                                        {(member.email || member.phone || member.college) && (
                                          <div className="text-[11px] text-zinc-600 mb-2 flex flex-wrap gap-x-3 gap-y-0.5">
                                            {member.college && <span>{member.college}</span>}
                                            {member.email && <span>{member.email}</span>}
                                            {member.phone && <span>{member.phone}</span>}
                                          </div>
                                        )}

                                        {/* Member accommodation status */}
                                        <div className="rounded-lg bg-zinc-50 p-2 text-[11px] text-zinc-700 border border-zinc-200/60">
                                          <span className="font-semibold text-zinc-500 block mb-0.5 text-[9px] uppercase tracking-wider">
                                            Accommodation
                                          </span>
                                          {member.accommodation && member.accommodation.hasBooking ? (
                                            <div className="flex flex-wrap items-center justify-between gap-1">
                                              <span>
                                                {member.accommodation.planName} (
                                                {member.accommodation.stayLabel ||
                                                  `${member.accommodation.durationDays} Days`}
                                                )
                                              </span>
                                              <span
                                                className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                                                  member.accommodation.bookingStatus === "paid"
                                                    ? "bg-green-100 text-green-700"
                                                    : "bg-red-100 text-red-700"
                                                }`}
                                              >
                                                {member.accommodation.bookingStatus === "paid"
                                                  ? "PAID"
                                                  : `UNPAID (${member.accommodation.bookingStatus})`}
                                              </span>
                                            </div>
                                          ) : (
                                            <span className="text-zinc-500 italic">
                                              No accommodation booked
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 4. CAMPUS ACCOMMODATION SECTION (Separated Details & Date Correctness) */}
                <div className="border-t border-black/10 pt-5">
                  <div className="mb-3.5 flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-black/60">
                      Campus Accommodation Record
                    </p>
                  </div>

                  {accommodations.length > 0 ? (
                    <div className="space-y-4">
                      {accommodations.map((acc) => {
                        const isUnpaid = acc.status !== "paid";
                        const isAllocated = Boolean(acc.hostelName && acc.roomNumber);
                        const stayLabel =
                          acc.stayLabel || getCanonicalStayLabel(acc.start_date, acc.duration_days);
                        const checkoutDate = acc.checkout_date || acc.end_date;
                        const amtDue = typeof acc.amountDue === "number" ? acc.amountDue : 0;
                        const amtPaid =
                          typeof acc.amountPaid === "number" ? acc.amountPaid : isUnpaid ? 0 : amtDue;
                        const balance =
                          typeof acc.balance === "number" ? acc.balance : isUnpaid ? amtDue : 0;

                        return (
                          <div
                            key={acc.id}
                            className={`rounded-2xl border p-4 sm:p-5 transition ${
                              isUnpaid
                                ? "border-red-200 bg-red-50/30"
                                : "border-black/[0.08] bg-black/[0.01]"
                            }`}
                          >
                            {/* ACC HEADER */}
                            <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 mb-3.5">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-base font-bold text-black">{acc.planName}</p>
                                  {stayLabel && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 text-xs font-medium">
                                      {stayLabel}
                                    </span>
                                  )}
                                </div>

                                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-black/70">
                                  <span>
                                    <strong>Stay:</strong> {acc.start_date} to {acc.end_date}
                                  </span>
                                  <span>
                                    <strong>Checkout:</strong> {checkoutDate} (Morning)
                                  </span>
                                </div>

                                {isAllocated ? (
                                  <p className="mt-1.5 text-xs font-semibold text-zinc-900 flex items-center gap-1.5">
                                    <BuildingIcon size={14} className="text-zinc-500" />
                                    {acc.hostelName} - Floor {acc.floorNumber || "1"}, Room {acc.roomNumber}
                                  </p>
                                ) : (
                                  <p className="mt-1.5 text-xs text-orange-700 font-medium">
                                    Room not allocated yet
                                  </p>
                                )}
                              </div>

                              {/* ACC BADGES */}
                              <div className="flex flex-wrap items-center gap-1.5">
                                {isUnpaid ? (
                                  <span className="rounded-full border border-red-200 bg-red-100 px-2.5 py-0.5 text-[10px] font-semibold text-red-700 whitespace-nowrap">
                                    UNPAID ({acc.status})
                                  </span>
                                ) : (
                                  <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-[10px] font-semibold text-green-700 whitespace-nowrap">
                                    PAID
                                  </span>
                                )}

                                {!isAllocated && !isUnpaid && (
                                  <span className="rounded-full border border-orange-200 bg-orange-100 px-2.5 py-0.5 text-[10px] font-semibold text-orange-700 whitespace-nowrap">
                                    PENDING ALLOCATION
                                  </span>
                                )}

                                <span
                                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${
                                    acc.checked_in && !acc.checked_out
                                      ? "bg-green-50 text-green-700 border border-green-200"
                                      : acc.checked_out
                                      ? "bg-purple-50 text-purple-700 border border-purple-200"
                                      : "bg-black/[0.05] text-black/50"
                                  }`}
                                >
                                  Status:{" "}
                                  {acc.checked_out
                                    ? "Checked out"
                                    : acc.checked_in
                                    ? "Checked in"
                                    : "Pending"}
                                </span>
                              </div>
                            </div>

                            {/* SEPARATE ACCOMMODATION FINANCIAL SUMMARY */}
                            <div className="mb-3.5 rounded-xl border border-black/5 bg-white p-3 text-xs shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
                              <div className="grid grid-cols-3 gap-2">
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-black/40 block">
                                    Amount Due
                                  </span>
                                  <span className="font-semibold text-black text-sm">₹{amtDue}</span>
                                </div>
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-black/40 block">
                                    Amount Paid
                                  </span>
                                  <span className="font-semibold text-emerald-700 text-sm">₹{amtPaid}</span>
                                </div>
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-black/40 block">
                                    Outstanding
                                  </span>
                                  <span
                                    className={`font-semibold text-sm ${
                                      balance > 0 ? "text-red-600" : "text-black/70"
                                    }`}
                                  >
                                    ₹{balance}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* ACCOMMODATION ACTIONS (Active only in Accommodation mode) */}
                            {scannerMode === "accommodation" && (
                              <div className="flex flex-col gap-2.5">
                                {isUnpaid ? (
                                  <div className="w-full">
                                    <button
                                      disabled
                                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-black/10 py-2.5 text-xs sm:text-sm font-medium text-black/40 cursor-not-allowed"
                                    >
                                      <XCircle size={15} />
                                      Check in Disabled (Payment Required)
                                    </button>
                                    <p className="mt-1.5 text-center text-xs font-medium text-red-600">
                                      Payment is incomplete ({acc.status}). Participant cannot be checked in.
                                    </p>
                                  </div>
                                ) : !isAllocated ? (
                                  <div className="w-full">
                                    <button
                                      disabled
                                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-black/10 py-2.5 text-xs sm:text-sm font-medium text-black/40 cursor-not-allowed"
                                    >
                                      <XCircle size={15} />
                                      Check in Disabled (Allocation Required)
                                    </button>
                                    <p className="mt-1.5 text-center text-xs font-medium text-orange-600">
                                      Room is not allocated yet. Assign a room from the admin dashboard first.
                                    </p>
                                  </div>
                                ) : (
                                  <div className="grid grid-cols-2 gap-3">
                                    {!acc.checked_in ? (
                                      <button
                                        onClick={() => handleAccommodationCheckIn(acc.id, acc.planName)}
                                        disabled={loading}
                                        className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-green-600 py-2.5 text-xs sm:text-sm font-semibold !text-white transition hover:bg-green-700 disabled:opacity-50 shadow-sm"
                                      >
                                        <CheckCircle2 size={15} />
                                        Check In
                                      </button>
                                    ) : !acc.checked_out ? (
                                      <button
                                        onClick={() => handleAccommodationCheckOut(acc.id, acc.planName)}
                                        disabled={loading}
                                        className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-purple-200 bg-purple-50 py-2.5 text-xs sm:text-sm font-semibold text-purple-700 transition hover:bg-purple-100 disabled:opacity-50"
                                      >
                                        <LogOut size={15} />
                                        Check Out
                                      </button>
                                    ) : (
                                      <button
                                        disabled
                                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-black/10 py-2.5 text-xs sm:text-sm font-medium text-black/40 cursor-not-allowed col-span-2"
                                      >
                                        <CheckCircle2 size={15} />
                                        Accommodation Completed
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* EXPLICIT NO ACCOMMODATION BOOKED */
                    <div className="rounded-2xl border border-black/[0.08] bg-black/[0.01] p-5 text-center text-black">
                      <p className="text-sm font-semibold">No accommodation booked</p>
                      <p className="mt-1 text-xs text-black/50">
                        No accommodation found: This participant did not register for any accommodation plan.
                      </p>
                    </div>
                  )}
                </div>

                {success && (
                  <div className="rounded-xl bg-green-50 border border-green-200 p-3.5 text-xs sm:text-sm text-green-700 flex items-center gap-2">
                    <CheckCircle2 size={16} />
                    <span>{success}</span>
                  </div>
                )}

                {/* SCAN NEXT PARTICIPANT ACTION */}
                <button
                  onClick={scanAnother}
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-black/10 bg-white py-3 text-xs sm:text-sm font-semibold !text-black transition hover:bg-black hover:text-white shadow-sm disabled:opacity-50"
                >
                  <QrCode size={16} />
                  Scan next participant
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  return (
    <div className="col-span-1">
      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] !text-black/50">
        {label}
      </p>
      <p className={`!text-black text-xs sm:text-sm font-medium ${mono ? "break-all font-mono" : ""}`}>
        {value || "—"}
      </p>
    </div>
  );
}
