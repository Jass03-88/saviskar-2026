"use client";

import { useEffect, useRef, useState } from "react";
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
  participantId: string;
  name: string;
  college: string;
  email: string;
  phone: string;
};

type ParticipantEvent = {
  participantEventId: string;
  eventId: string;
  eventName: string;
  registrationStatus: string | null;
  paymentStatus: string | null;
  teamName: string | null;
  checkedIn: boolean;
  checkedInAt: string | null;
};

export default function ScannerPage() {
  const router = useRouter();

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingRef = useRef(false);

  const [participant, setParticipant] = useState<Participant | null>(null);
  const [participantEvents, setParticipantEvents] = useState<ParticipantEvent[]>([]);

  const [loading, setLoading] = useState(false);
  const [scannerStarted, setScannerStarted] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function checkAdmin() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      router.replace("/admin/login");
    }
  }

  async function startScanner() {
    setError("");
    setSuccess("");
    setParticipant(null);
    setParticipantEvents([]);

    try {
      const scanner = new Html5Qrcode("qr-reader");

      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: {
            width: 250,
            height: 250,
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
    checkAdmin();

    return () => {
      stopScanner();
    };
  }, []);

  async function findRegistration(scannedValue: string) {
    setLoading(true);
    setError("");
    setSuccess("");
    setParticipantEvents([]);

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
          events?: ParticipantEvent[];
        };

        if (!lookupResponse.ok || !lookup.success || !lookup.participant) {
          setParticipant(null);
          setError(lookup.error || "Participant not found. Invalid QR code.");
          return;
        }

        const foundEvents = lookup.events ?? [];

        setParticipant(lookup.participant);
        setParticipantEvents(foundEvents);
        
        if (foundEvents.length === 0) {
          setError("Participant found, but they are not registered for any events.");
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

  async function checkInParticipant(participantEventId: string, eventName: string, teamName: string | null) {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantEventId, action: "check_in" }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Could not check in.");
      }

      setParticipantEvents((events) =>
        events.map((event) =>
          event.participantEventId === participantEventId
            ? { ...event, checkedIn: true, checkedInAt: result.checked_in_at }
            : event
        )
      );

      setSuccess(
        teamName
          ? `${teamName} has been successfully checked in for ${eventName}.`
          : `${participant?.name} has been successfully checked in for ${eventName}.`
      );
    } catch (err) {
      console.error("CHECK-IN ERROR:", err);
      setError(err instanceof Error ? err.message : "Could not check in participant.");
    } finally {
      setLoading(false);
    }
  }

  async function checkOutParticipant(participantEventId: string, eventName: string, teamName: string | null) {
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/admin/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantEventId, action: "check_out" }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Could not check out.");
      }

      setParticipantEvents((events) =>
        events.map((event) =>
          event.participantEventId === participantEventId
            ? { ...event, checkedIn: false, checkedInAt: null }
            : event
        )
      );

      setSuccess(
        teamName
          ? `${teamName} has been successfully checked out of ${eventName}.`
          : `${participant?.name} has been successfully checked out of ${eventName}.`
      );
    } catch (err) {
      console.error("CHECK-OUT ERROR:", err);
      setError(err instanceof Error ? err.message : "Could not check out participant.");
    } finally {
      setLoading(false);
    }
  }

  async function scanAnother() {
    setParticipant(null);
    setParticipantEvents([]);
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

            <div id="qr-reader" className="overflow-hidden rounded-[22px] bg-white" />

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
            <p className="mb-7 text-[10px] font-semibold uppercase tracking-[0.22em] text-black/35">
              Verification
            </p>

            {loading && (
              <div className="flex min-h-[400px] items-center justify-center">
                <div className="text-center">
                  <Loader2 size={28} className="mx-auto mb-4 animate-spin" />
                  <p className="!text-black/60 text-sm">Verifying registration...</p>
                </div>
              </div>
            )}

            {!loading && !participant && !error && (
              <div className="flex min-h-[400px] flex-col items-center justify-center text-center">
                <ShieldCheck size={38} className="mb-5 text-black/15" />
                <p className="text-black">Waiting for scan</p>
                <p className="text-black">Registration details will appear here.</p>
              </div>
            )}

            {error && (
              <div className="flex min-h-[400px] flex-col items-center justify-center text-center">
                <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-600">
                  <XCircle size={26} />
                </div>

                <p className="font-semibold">Verification failed</p>
                <p className="mt-2 max-w-xs text-sm leading-6 text-black/45">{error}</p>

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
                  <Detail label="Participant ID" value={participant.participantId} mono />
                </div>

                {participantEvents.length > 0 && (
                  <div className="mt-7 border-t border-black/10 pt-6 !text-black">
                    <p className="mb-4 text-[9px] font-semibold uppercase tracking-[0.18em] !text-black/60">
                      Registered events
                    </p>
                    <div className="space-y-4">
                      {participantEvents.map((event) => (
                        <div
                          key={event.participantEventId}
                          className="rounded-[20px] border border-black/[0.08] p-5 bg-black/[0.01]"
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
                            <span
                              className={`rounded-full px-2.5 py-1 text-[10px] font-medium whitespace-nowrap ${
                                event.checkedIn
                                  ? "bg-green-50 text-green-700"
                                  : "bg-black/[0.05] text-black/50"
                              }`}
                            >
                              {event.checkedIn ? "Checked in" : "Not checked in"}
                            </span>
                          </div>

                          <div className="flex items-center gap-3">
                            {!event.checkedIn ? (
                              <button
                                onClick={() => checkInParticipant(event.participantEventId, event.eventName, event.teamName)}
                                disabled={loading}
                                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-black py-3 text-sm font-medium !text-white transition hover:scale-[1.01] disabled:opacity-50"
                              >
                                <CheckCircle2 size={16} />
                                Check in
                              </button>
                            ) : (
                              <button
                                onClick={() => checkOutParticipant(event.participantEventId, event.eventName, event.teamName)}
                                disabled={loading}
                                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 py-3 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                              >
                                <LogOut size={16} />
                                Check out
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
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
