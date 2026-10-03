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

type Participant = {
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

type FacultyIncharge = {
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

type ParticipantEvent = {
  participantEventId: string;
  eventId: string;
  eventName: string;
  registrationStatus: string | null;
  paymentStatus: string | null;
  paymentAmount: number | null;
  teamName: string | null;
  checkedIn: boolean;
  checkedInAt: string | null;
  mainCheckedIn: boolean;
  mainCheckedInAt: string | null;
  registrationGroupId?: string | null;
};

type ParticipantAccommodation = {
  id: string;
  status: string;
  start_date: string;
  end_date: string;
  duration_days: number;
  checked_in: boolean;
  checked_in_at: string | null;
  checked_out: boolean;
  checked_out_at: string | null;
  planName: string;
  hostelName: string | null;
  roomNumber: string | null;
  floorNumber: string | null;
};

type ScannerMode = "main" | "event" | "accommodation";

export default function ScannerPage() {
  const router = useRouter();

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingRef = useRef(false);

  const [scannerMode, setScannerMode] = useState<ScannerMode>("main");

  const [participant, setParticipant] = useState<Participant | null>(null);
  const [participantEvents, setParticipantEvents] = useState<ParticipantEvent[]>([]);
  const [accommodations, setAccommodations] = useState<ParticipantAccommodation[]>([]);
  const [faculty, setFaculty] = useState<FacultyIncharge[]>([]);

  const [loading, setLoading] = useState(false);
  const [scannerStarted, setScannerStarted] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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
    setParticipant(null);
    setParticipantEvents([]);
    setAccommodations([]);
    setFaculty([]);

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

      setError(
        "Camera could not be started. Please allow camera permission and try again."
      );
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

  async function findRegistration(scannedValue: string) {
    setLoading(true);
    setError("");
    setSuccess("");
    setParticipantEvents([]);
    setAccommodations([]);
    setFaculty([]);

    try {
      let registrationId = scannedValue.trim();

      if (registrationId.startsWith("SAVISKAR:")) {
        registrationId = registrationId.replace("SAVISKAR:", "").trim();
      }

      if (/^SVK26-[A-Z0-9]{8}$/i.test(registrationId)) {
        const lookupResponse = await fetch(
          `/api/admin/participants/${encodeURIComponent(registrationId)}`,
          { cache: "no-store" }
        );
        const lookup = (await lookupResponse.json()) as {
          success?: boolean;
          error?: string;
          participant?: Participant;
          faculty?: FacultyIncharge[];
          events?: ParticipantEvent[];
          accommodations?: ParticipantAccommodation[];
        };

        if (!lookupResponse.ok || !lookup.success || !lookup.participant) {
          setParticipant(null);
          setError(lookup.error || "Participant not found. Invalid QR code.");
          return;
        }

        const foundEvents = lookup.events ?? [];
        const foundAccommodations = lookup.accommodations ?? [];
        const foundFaculty = lookup.faculty ?? [];

        setParticipant(lookup.participant);
        setParticipantEvents(foundEvents);
        setAccommodations(foundAccommodations);
        setFaculty(foundFaculty);
        
        if (foundEvents.length === 0 && foundAccommodations.length === 0) {
          setError("Participant found, but they are not registered for any events and have no accommodation.");
        }
        
        return;
      } else {
        setParticipant(null);
        setError("Invalid QR code format. Expected a Saviskar participant ID.");
        return;
      }
    } catch (err) {
      console.error("VERIFY ERROR:", err);
      setError("Unable to verify this registration.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckIn(participantEventId: string, eventName: string, teamName: string | null, type: "event" | "main") {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantEventId, action: type === "main" ? "main_check_in" : "check_in" }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Could not check in.");
      }

      // Find the target event to get its registrationGroupId
      const targetEvent = participantEvents.find(e => e.participantEventId === participantEventId);
      const groupId = targetEvent?.registrationGroupId;

      setParticipantEvents((events) =>
        events.map((event) => {
          if (type === "main") {
            // If it's a main check-in, update ALL events that share the same registration group!
            // If there's no group ID (migration not applied), fallback to just updating the one event.
            if (
              (groupId && event.registrationGroupId === groupId) || 
              (!groupId && event.participantEventId === participantEventId)
            ) {
              return { ...event, mainCheckedIn: true, mainCheckedInAt: result.main_checked_in_at };
            }
          } else {
            // Event check-ins strictly update only the scanned pass
            if (event.participantEventId === participantEventId) {
              return { ...event, checkedIn: true, checkedInAt: result.checked_in_at };
            }
          }
          return event;
        })
      );

      setSuccess(
        teamName
          ? `${teamName} has been successfully checked in for ${type === "main" ? "Main Registration" : eventName}.`
          : `${participant?.name} has been successfully checked in for ${type === "main" ? "Main Registration" : eventName}.`
      );
    } catch (err) {
      console.error("CHECK-IN ERROR:", err);
      setError(err instanceof Error ? err.message : "Could not check in participant.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckOut(participantEventId: string, eventName: string, teamName: string | null, type: "event" | "main") {
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/admin/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantEventId, action: type === "main" ? "main_check_out" : "check_out" }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Could not check out.");
      }

      // Find the target event to get its registrationGroupId
      const targetEvent = participantEvents.find(e => e.participantEventId === participantEventId);
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
          ? `${teamName} has been successfully checked out of ${type === "main" ? "Main Registration" : eventName}.`
          : `${participant?.name} has been successfully checked out of ${type === "main" ? "Main Registration" : eventName}.`
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
        throw new Error(result.error?.message || result.error || "Could not check in to accommodation.");
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
        throw new Error(result.error?.message || result.error || "Could not check out of accommodation.");
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
    setError("");
    setSuccess("");

    processingRef.current = false;

    await startScanner();
  }

  return (
    <main className="min-h-screen bg-[#f5f5f5] px-5 py-8 md:px-10 lg:px-16">
      <div className="mx-auto max-w-[1100px]">
        {/* HEADER */}
        <div className="mb-10 flex items-center justify-between">
          <div>
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-black/40">
              Saviskar 2026
            </p>

            <h1 className="text-4xl font-semibold tracking-[-0.05em] text-black md:text-6xl">
              Entry Scanner
            </h1>

            <p className="mt-4 text-sm text-black/45">
              Scan participant or team QR codes to verify entry.
            </p>
          </div>

          <button
            onClick={() => router.push("/admin")}
            className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm text-black transition hover:bg-black hover:text-white"
          >
            <ArrowLeft size={15} />
            Dashboard
          </button>
        </div>

        {/* SCANNER MODE SELECTOR */}
        <div className="mb-8 flex overflow-x-auto rounded-full bg-black/5 p-1">
          <button
            onClick={() => {
              setScannerMode("main");
              setParticipant(null);
              setParticipantEvents([]);
              setAccommodations([]);
              setFaculty([]);
              setError("");
              setSuccess("");
            }}
            className={`flex-1 whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-medium transition ${
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
              setError("");
              setSuccess("");
            }}
            className={`flex-1 whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-medium transition ${
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
              setError("");
              setSuccess("");
            }}
            className={`flex-1 whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-medium transition ${
              scannerMode === "accommodation" ? "bg-white text-black shadow-sm" : "text-black/60 hover:text-black"
            }`}
          >
            Accommodation
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_0.85fr]">
          {/* SCANNER */}
          <div className="rounded-[30px] bg-black p-6 text-white md:p-8">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10">
                <QrCode size={19} />
              </div>

              <div>
                <p className="font-medium">QR Scanner</p>
                <p className="text-xs text-white/40">Point camera at registration QR</p>
              </div>
            </div>

            <div
              id="qr-reader"
              className="w-full max-w-full overflow-hidden rounded-[22px] bg-black [&_video]:w-full [&_video]:max-w-full [&_video]:rounded-[22px] [&_video]:object-cover [&_canvas]:max-w-full"
            />

            {!scannerStarted && !participant && (
              <div className="flex min-h-[330px] flex-col items-center justify-center text-center">
                <QrCode size={45} className="mb-5 text-white/20" />
                <p className="mb-2 font-medium">Ready to scan</p>
                <p className="mb-7 max-w-xs text-sm leading-6 text-white/40">
                  Start the camera and scan the QR code displayed on the registration confirmation.
                </p>

                <button
                  onClick={startScanner}
                  className="rounded-full bg-white px-7 py-3 text-sm font-medium text-black transition hover:scale-[1.02]"
                >
                  Start camera
                </button>
              </div>
            )}

            {scannerStarted && (
              <p className="mt-5 text-center text-xs text-white/40">Looking for QR code...</p>
            )}
          </div>

          {/* RESULT */}
          <div className="rounded-[30px] bg-white p-6 shadow-[0_20px_80px_rgba(0,0,0,0.05)] md:p-8">
            <p className="mb-7 text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
              Verification
            </p>

            {loading && (
              <div aria-live="polite" className="flex min-h-[400px] items-center justify-center">
                <div className="text-center">
                  <Loader2 size={28} className="mx-auto mb-4 animate-spin text-zinc-700" />
                  <p className="text-zinc-600 text-sm font-medium">Verifying registration...</p>
                </div>
              </div>
            )}

            {!loading && !participant && !error && (
              <div className="flex min-h-[400px] flex-col items-center justify-center text-center">
                <ShieldCheck size={38} className="mb-5 text-zinc-300" />
                <p className="text-zinc-900 font-medium">Waiting for scan</p>
                <p className="text-zinc-600 text-sm mt-1">Registration details will appear here.</p>
              </div>
            )}

            {error && (
              <div role="alert" aria-live="assertive" className="flex min-h-[400px] flex-col items-center justify-center text-center">
                <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-600">
                  <XCircle size={26} />
                </div>

                <p className="font-semibold text-zinc-900">Verification failed</p>
                <p className="mt-2 max-w-xs text-sm leading-6 text-zinc-600">{error}</p>

                <button
                  onClick={scanAnother}
                  className="mt-7 flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm text-white"
                >
                  <RotateCcw size={15} />
                  Scan again
                </button>
              </div>
            )}

            {!loading && participant && (
              <div className="!text-black">
                {/* PARTICIPANT */}
                <div className="mb-7 flex items-center gap-4 !text-black">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/[0.05]">
                    <User size={20} />
                  </div>

                  <div>
                    <p className="!text-black text-xl font-semibold">{participant.name}</p>
                    <p className="!text-black/60 text-sm">{participant.college}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-5 border-t border-black/10 pt-6 !text-black">
                  <Detail label="Email" value={participant.email} />
                  <Detail label="Phone" value={participant.phone} />
                  <Detail label="Gender" value={participant.gender} />
                  <Detail label="State" value={participant.state} />
                  <Detail label="Participant ID" value={participant.participantId} mono />
                </div>

                {participant.idCardUrl && (
                  <div className="mt-6 border-t border-black/10 pt-6">
                    <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] !text-black/60">
                      Participant ID Card
                    </p>
                    <a href={participant.idCardUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-violet-50 px-4 py-2.5 text-sm font-medium text-violet-700 hover:bg-violet-100 transition">
                      View ID Card Document
                    </a>
                  </div>
                )}

                {faculty.length > 0 && (
                  <div className="mt-7 border-t border-black/10 pt-6 !text-black">
                    <p className="mb-4 text-[9px] font-semibold uppercase tracking-[0.18em] !text-black/60">
                      Faculty Incharge
                    </p>
                    <div className="space-y-4">
                      {faculty.map((f) => (
                        <div key={f.id} className="rounded-[20px] border border-black/[0.08] bg-black/[0.01] p-5">
                          <p className="text-base font-semibold">{f.name}</p>
                          <p className="mt-1 text-sm text-black/60">{f.college}</p>
                          <div className="mt-4 grid grid-cols-2 gap-4">
                            <Detail label="Email" value={f.email} />
                            <Detail label="Phone" value={f.phone} />
                            <Detail label="Gender" value={f.gender} />
                            <Detail label="State" value={f.state} />
                          </div>
                          {f.idCardUrl && (
                            <div className="mt-4">
                              <a href={f.idCardUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-violet-50 px-4 py-2.5 text-xs font-medium text-violet-700 hover:bg-violet-100 transition">
                                View Faculty ID Card
                              </a>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {scannerMode !== "accommodation" && participantEvents.length > 0 && (
                  <div className="mt-7 border-t border-black/10 pt-6 !text-black">
                    <p className="mb-4 text-[9px] font-semibold uppercase tracking-[0.18em] !text-black/60">
                      Registered events
                    </p>
                    <div className="space-y-4">
                      {participantEvents.map((event) => {
                        const isUnpaid = Boolean(
                          event.paymentStatus &&
                          event.paymentStatus !== "paid" &&
                          event.paymentStatus !== "not_required"
                        );

                        return (
                          <div
                            key={event.participantEventId}
                            className={`rounded-[20px] border p-5 ${
                              isUnpaid
                                ? "border-red-200 bg-red-50/40"
                                : "border-black/[0.08] bg-black/[0.01]"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-4 mb-4">
                              <div>
                                <p className="!text-black text-base font-semibold">{event.eventName}</p>
                                {event.teamName ? (
                                  <p className="mt-1 !text-black/60 text-sm font-medium">Team: {event.teamName}</p>
                                ) : (
                                  <p className="mt-1 !text-black/60 text-sm">Individual Registration</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {isUnpaid && (
                                  <span className="rounded-full border border-red-200 bg-red-100 px-2.5 py-1 text-[10px] font-semibold text-red-700 whitespace-nowrap">
                                    UNPAID ({event.paymentStatus})
                                  </span>
                                )}
                                  <span
                                    className={`rounded-full px-2.5 py-1 text-[10px] font-medium whitespace-nowrap ${
                                      event.mainCheckedIn
                                        ? "bg-blue-50 text-blue-700"
                                        : "bg-black/[0.05] text-black/50"
                                    }`}
                                  >
                                    Main: {event.mainCheckedIn ? "Checked in" : "Pending"}
                                  </span>
                                  <span
                                    className={`rounded-full px-2.5 py-1 text-[10px] font-medium whitespace-nowrap ${
                                      event.checkedIn
                                        ? "bg-green-50 text-green-700"
                                        : "bg-black/[0.05] text-black/50"
                                    }`}
                                  >
                                    Event: {event.checkedIn ? "Checked in" : "Pending"}
                                  </span>
                                </div>
                              </div>

                            <div className="flex flex-col gap-3">
                              {isUnpaid ? (
                                <div className="w-full">
                                  <button
                                    disabled
                                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-black/10 py-3 text-sm font-medium text-black/40 cursor-not-allowed"
                                  >
                                    <XCircle size={16} />
                                    Check in Disabled (Payment Required)
                                  </button>
                                  <p className="mt-2 text-center text-xs font-medium text-red-600">
                                    Payment is incomplete ({event.paymentStatus}). Participant cannot be checked in.
                                  </p>
                                </div>
                              ) : (
                                <div className="grid grid-cols-1 gap-3">
                                  {scannerMode === "main" && (
                                    <>
                                      {!event.mainCheckedIn ? (
                                        <button
                                          onClick={() => handleCheckIn(event.participantEventId, event.eventName, event.teamName, "main")}
                                          disabled={loading}
                                          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-medium !text-white transition hover:scale-[1.01] disabled:opacity-50"
                                        >
                                          <CheckCircle2 size={16} />
                                          Main Check-in
                                        </button>
                                      ) : (
                                        <button
                                          onClick={() => handleCheckOut(event.participantEventId, event.eventName, event.teamName, "main")}
                                          disabled={loading}
                                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 py-3 text-sm font-medium text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
                                        >
                                          <LogOut size={16} />
                                          Main Check-out
                                        </button>
                                      )}
                                    </>
                                  )}
                                  
                                  {scannerMode === "event" && (
                                    <>
                                      {!event.checkedIn ? (
                                        <button
                                          onClick={() => handleCheckIn(event.participantEventId, event.eventName, event.teamName, "event")}
                                          disabled={loading}
                                          className="flex w-full items-center justify-center gap-2 rounded-xl bg-black py-3 text-sm font-medium !text-white transition hover:scale-[1.01] disabled:opacity-50"
                                        >
                                          <CheckCircle2 size={16} />
                                          Event Check-in
                                        </button>
                                      ) : (
                                        <button
                                          onClick={() => handleCheckOut(event.participantEventId, event.eventName, event.teamName, "event")}
                                          disabled={loading}
                                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 py-3 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                                        >
                                          <LogOut size={16} />
                                          Event Check-out
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {scannerMode === "accommodation" && accommodations.length > 0 && (
                  <div className="mt-7 border-t border-black/10 pt-6 !text-black">
                    <p className="mb-4 text-[9px] font-semibold uppercase tracking-[0.18em] !text-black/60">
                      Accommodation
                    </p>
                    <div className="space-y-4">
                      {accommodations.map((acc) => {
                        const isUnpaid = acc.status !== "paid";
                        const isAllocated = acc.hostelName && acc.roomNumber;

                        return (
                          <div
                            key={acc.id}
                            className={`rounded-[20px] border p-5 ${
                              isUnpaid
                                ? "border-red-200 bg-red-50/40"
                                : "border-black/[0.08] bg-black/[0.01]"
                            }`}
                          >
                            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
                              <div>
                                <p className="!text-black text-base font-semibold">{acc.planName}</p>
                                {isAllocated ? (
                                  <p className="mt-1 !text-black/60 text-sm font-medium">
                                    {acc.hostelName} - Floor {acc.floorNumber}, Room {acc.roomNumber}
                                  </p>
                                ) : (
                                  <p className="mt-1 !text-black/60 text-sm">Not allocated yet</p>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {isUnpaid && (
                                  <span className="rounded-full border border-red-200 bg-red-100 px-2.5 py-1 text-[10px] font-semibold text-red-700 whitespace-nowrap">
                                    UNPAID ({acc.status})
                                  </span>
                                )}
                                {!isAllocated && !isUnpaid && (
                                  <span className="rounded-full border border-orange-200 bg-orange-100 px-2.5 py-1 text-[10px] font-semibold text-orange-700 whitespace-nowrap">
                                    PENDING ALLOCATION
                                  </span>
                                )}
                                <span
                                  className={`rounded-full px-2.5 py-1 text-[10px] font-medium whitespace-nowrap ${
                                    acc.checked_in && !acc.checked_out
                                      ? "bg-green-50 text-green-700"
                                      : acc.checked_out
                                      ? "bg-purple-50 text-purple-700"
                                      : "bg-black/[0.05] text-black/50"
                                  }`}
                                >
                                  Status: {acc.checked_out ? "Checked out" : acc.checked_in ? "Checked in" : "Pending"}
                                </span>
                              </div>
                            </div>

                            <div className="flex flex-col gap-3">
                              {isUnpaid ? (
                                <div className="w-full">
                                  <button
                                    disabled
                                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-black/10 py-3 text-sm font-medium text-black/40 cursor-not-allowed"
                                  >
                                    <XCircle size={16} />
                                    Check in Disabled (Payment Required)
                                  </button>
                                  <p className="mt-2 text-center text-xs font-medium text-red-600">
                                    Payment is incomplete ({acc.status}). Participant cannot be checked in.
                                  </p>
                                </div>
                              ) : !isAllocated ? (
                                <div className="w-full">
                                  <button
                                    disabled
                                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-black/10 py-3 text-sm font-medium text-black/40 cursor-not-allowed"
                                  >
                                    <XCircle size={16} />
                                    Check in Disabled (Allocation Required)
                                  </button>
                                  <p className="mt-2 text-center text-xs font-medium text-orange-600">
                                    Room is not allocated yet. Assign a room from the admin dashboard first.
                                  </p>
                                </div>
                              ) : (
                                <div className="grid grid-cols-2 gap-3">
                                  {!acc.checked_in ? (
                                    <button
                                      onClick={() => handleAccommodationCheckIn(acc.id, acc.planName)}
                                      disabled={loading}
                                      className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-green-600 py-3 text-sm font-medium !text-white transition hover:scale-[1.01] disabled:opacity-50"
                                    >
                                      <CheckCircle2 size={16} />
                                      Check In
                                    </button>
                                  ) : !acc.checked_out ? (
                                    <button
                                      onClick={() => handleAccommodationCheckOut(acc.id, acc.planName)}
                                      disabled={loading}
                                      className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-purple-200 bg-purple-50 py-3 text-sm font-medium text-purple-700 transition hover:bg-purple-100 disabled:opacity-50"
                                    >
                                      <LogOut size={16} />
                                      Check Out
                                    </button>
                                  ) : (
                                    <button
                                      disabled
                                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-black/10 py-3 text-sm font-medium text-black/40 cursor-not-allowed col-span-2"
                                    >
                                      <CheckCircle2 size={16} />
                                      Accommodation Completed
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {scannerMode === "accommodation" && accommodations.length === 0 && (
                  <div className="mt-7 rounded-[20px] border border-black/[0.08] bg-black/[0.01] p-6 text-center !text-black">
                    <p className="text-sm font-medium">No accommodation found</p>
                    <p className="mt-1 text-xs text-black/50">This participant did not register for any accommodation plan.</p>
                  </div>
                )}

                {success && (
                  <div className="mt-7 rounded-[20px] bg-green-50 p-4 text-sm text-green-700">
                    {success}
                  </div>
                )}

                <button
                  onClick={scanAnother}
                  disabled={loading}
                  className="mt-8 flex w-full items-center justify-center gap-2 rounded-full border border-black/10 bg-white py-4 text-sm font-medium !text-black transition hover:bg-black/[0.02] disabled:opacity-50"
                >
                  <QrCode size={17} />
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
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="col-span-2 sm:col-span-1">
      <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.18em] !text-black/60">
        {label}
      </p>
      <p
        className={`!text-black text-sm ${
          mono ? "break-all font-mono text-xs" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
