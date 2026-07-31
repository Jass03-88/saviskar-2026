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

type Registration = {
  id: string;
  created_at: string;
  event_id: string;
  name: string;
  college: string;
  email: string;
  phone: string;
  team: string | null;
  checked_in: boolean;
  checked_in_at: string | null;
};

type EventRecord = {
  id: string;
  name: string;
};

type RegistrationMember = {
  id: string;
  created_at: string;
  registration_id: string;
  name: string;
  email: string;
  phone: string;
  is_team_leader: boolean;
};

export default function ScannerPage() {
  const router = useRouter();

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingRef = useRef(false);

  const [registration, setRegistration] =
    useState<Registration | null>(null);

  const [eventName, setEventName] = useState("");
  const [members, setMembers] = useState<RegistrationMember[]>([]);

  const [loading, setLoading] = useState(false);
  const [scannerStarted, setScannerStarted] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    checkAdmin();

    return () => {
      stopScanner();
    };
  }, []);

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
    setRegistration(null);
    setEventName("");
    setMembers([]);

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
    } catch (err) {
      console.log("Scanner already stopped.");
    }

    scannerRef.current = null;
    setScannerStarted(false);
  }

  async function findRegistration(scannedValue: string) {
    setLoading(true);
    setError("");
    setSuccess("");
    setEventName("");
    setMembers([]);

    try {
      let registrationId = scannedValue.trim();

      // Supports both the current UUID-only QR format and
      // a future SAVISKAR:<uuid> format.
      if (registrationId.startsWith("SAVISKAR:")) {
        registrationId = registrationId.replace("SAVISKAR:", "").trim();
      }

      const { data, error: registrationError } = await supabase
        .from("registrations")
        .select("*")
        .eq("id", registrationId)
        .maybeSingle();

      if (registrationError || !data) {
        if (registrationError) {
          console.warn("REGISTRATION LOOKUP:", registrationError.message);
        }
        setRegistration(null);
        setError("Registration not found. Invalid QR code.");
        return;
      }

      const foundRegistration = data as Registration;
      setRegistration(foundRegistration);

      // Resolve UUID event IDs safely. Older registrations may contain
      // legacy text/slug values such as "hackathon"; never send those to
      // PostgreSQL as a UUID comparison.
      const UUID_RE =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      if (UUID_RE.test(foundRegistration.event_id)) {
        const { data: eventData, error: eventError } = await supabase
          .from("events")
          .select("id, name")
          .eq("id", foundRegistration.event_id)
          .maybeSingle();

        if (eventError) {
          console.error("EVENT LOOKUP ERROR:", eventError);
          setEventName(foundRegistration.event_id);
        } else if (eventData) {
          setEventName((eventData as EventRecord).name);
        } else {
          setEventName(foundRegistration.event_id);
        }
      } else {
        // Legacy registrations stored event text instead of an event UUID.
        // Keep the scanner usable without triggering Postgres error 22P02.
        const readableLegacyName = foundRegistration.event_id
          .replace(/-/g, " ")
          .replace(/\b\w/g, (char) => char.toUpperCase());

        setEventName(readableLegacyName);
      }

      // Team members are child rows linked by registration_id.
      if (foundRegistration.team) {
        const { data: memberData, error: memberError } = await supabase
          .from("registration_members")
          .select(
            "id, created_at, registration_id, name, email, phone, is_team_leader"
          )
          .eq("registration_id", foundRegistration.id)
          .order("created_at", { ascending: true });

        if (memberError) {
          console.error("MEMBER LOOKUP ERROR:", memberError);
          // Registration is still valid even if member details cannot be read.
        } else {
          setMembers((memberData as RegistrationMember[]) || []);
        }
      }
    } catch (err) {
      console.error("VERIFY ERROR:", err);
      setError("Unable to verify this registration.");
    } finally {
      setLoading(false);
    }
  }

  async function checkInParticipant() {
    if (!registration) return;

    if (registration.checked_in) {
      setError(
        registration.team
          ? "This team has already checked in."
          : "This participant has already checked in."
      );
      return;
    }

    setLoading(true);
    setError("");

    const checkInTime = new Date().toISOString();

    const { data, error } = await supabase
      .from("registrations")
      .update({
        checked_in: true,
        checked_in_at: checkInTime,
      })
      .eq("id", registration.id)
      .select()
      .single();

    if (error) {
      console.error("CHECK-IN ERROR:", error);

      setError(
        registration.team
          ? "Could not check in this team."
          : "Could not check in participant."
      );
      setLoading(false);
      return;
    }

    setRegistration(data as Registration);

    setSuccess(
      registration.team
        ? `${registration.team} has been successfully checked in.`
        : `${data.name} has been successfully checked in.`
    );

    setLoading(false);
  }

  async function checkOutParticipant() {
    if (!registration || !registration.checked_in) return;

    setLoading(true);
    setError("");
    setSuccess("");

    const { data, error } = await supabase
      .from("registrations")
      .update({
        checked_in: false,
        checked_in_at: null,
      })
      .eq("id", registration.id)
      .select()
      .single();

    if (error) {
      console.error("CHECK-OUT ERROR:", error);
      setError(
        registration.team
          ? "Could not check out this team."
          : "Could not check out participant."
      );
      setLoading(false);
      return;
    }

    setRegistration(data as Registration);
    setSuccess(
      registration.team
        ? `${registration.team} has been successfully checked out.`
        : `${data.name} has been successfully checked out.`
    );
    setLoading(false);
  }

  async function scanAnother() {
    setRegistration(null);
    setEventName("");
    setMembers([]);
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

            <h1 className="text-4xl font-semibold tracking-[-0.05em] md:text-6xl">
              Entry Scanner
            </h1>

            <p className="mt-4 text-sm text-black/45">
              Scan participant or team QR codes to verify entry.
            </p>
          </div>

          <button
            onClick={() => router.push("/admin")}
            className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm transition hover:bg-black hover:text-white"
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
                <p className="font-medium">
                  QR Scanner
                </p>

                <p className="text-xs text-white/40">
                  Point camera at registration QR
                </p>
              </div>

            </div>

            <div
              id="qr-reader"
              className="overflow-hidden rounded-[22px] bg-white"
            />

            {!scannerStarted && !registration && (
              <div className="flex min-h-[330px] flex-col items-center justify-center text-center">

                <QrCode
                  size={45}
                  className="mb-5 text-white/20"
                />

                <p className="mb-2 font-medium">
                  Ready to scan
                </p>

                <p className="mb-7 max-w-xs text-sm leading-6 text-white/40">
                  Start the camera and scan the QR code
                  displayed on the registration
                  confirmation.
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
              <p className="mt-5 text-center text-xs text-white/40">
                Looking for QR code...
              </p>
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

                  <Loader2
                    size={28}
                    className="mx-auto mb-4 animate-spin"
                  />

                  <p className="text-sm text-black/40">
                    Verifying registration...
                  </p>

                </div>

              </div>
            )}

            {!loading && !registration && !error && (
              <div className="flex min-h-[400px] flex-col items-center justify-center text-center">

                <ShieldCheck
                  size={38}
                  className="mb-5 text-black/15"
                />

                <p className="font-medium">
                  Waiting for scan
                </p>

                <p className="mt-2 text-sm text-black/40">
                  Registration details will appear here.
                </p>

              </div>
            )}

            {error && (
              <div className="flex min-h-[400px] flex-col items-center justify-center text-center">

                <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-600">
                  <XCircle size={26} />
                </div>

                <p className="font-semibold">
                  Verification failed
                </p>

                <p className="mt-2 max-w-xs text-sm leading-6 text-black/45">
                  {error}
                </p>

                <button
                  onClick={scanAnother}
                  className="mt-7 flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm text-white"
                >
                  <RotateCcw size={15} />
                  Scan again
                </button>

              </div>
            )}

            {!loading && registration && (
              <div>

                {/* STATUS */}

                {registration.checked_in ? (

                  <div className="mb-7 rounded-[22px] bg-green-50 p-5">

                    <div className="flex items-center gap-3 text-green-700">

                      <CheckCircle2 size={21} />

                      <div>
                        <p className="font-semibold">
                          Already checked in
                        </p>

                        <p className="mt-1 text-xs opacity-70">
                          {registration.checked_in_at
                            ? new Date(
                                registration.checked_in_at
                              ).toLocaleString()
                            : ""}
                        </p>
                      </div>

                    </div>

                  </div>

                ) : (

                  <div className="mb-7 rounded-[22px] bg-black p-5 text-white">

                    <div className="flex items-center gap-3">

                      <ShieldCheck size={21} />

                      <div>
                        <p className="font-semibold">
                          Valid registration
                        </p>

                        <p className="mt-1 text-xs text-white/45">
                          Registration is cleared for check-in.
                        </p>
                      </div>

                    </div>

                  </div>

                )}

                {/* PARTICIPANT */}

                <div className="mb-7 flex items-center gap-4">

                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/[0.05]">
                    <User size={20} />
                  </div>

                  <div>
                    <p className="text-xl font-semibold">
                      {registration.name}
                    </p>

                    <p className="text-sm text-black/40">
                      {registration.college}
                    </p>
                  </div>

                </div>

                <div className="space-y-5 border-t border-black/10 pt-6">

                  <Detail
                    label="Event"
                    value={eventName || registration.event_id}
                  />

                  <Detail
                    label="Team"
                    value={registration.team || "Individual"}
                  />

                  <Detail
                    label="Email"
                    value={registration.email}
                  />

                  <Detail
                    label="Phone"
                    value={registration.phone}
                  />

                  <Detail
                    label="Registration ID"
                    value={registration.id}
                    mono
                  />

                </div>

                {registration.team && (
                  <div className="mt-7 border-t border-black/10 pt-6">
                    <div className="mb-4 flex items-end justify-between gap-4">
                      <div>
                        <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-black/35">
                          Team roster
                        </p>
                        <p className="mt-1 font-semibold">
                          {registration.team}
                        </p>
                      </div>

                      <span className="rounded-full bg-black/[0.05] px-3 py-1.5 text-xs text-black/50">
                        {members.length + 1} total
                      </span>
                    </div>

                    <div className="rounded-[18px] bg-black/[0.035] p-4">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-black/35">
                        Team leader
                      </p>
                      <p className="mt-2 text-sm font-medium">
                        {registration.name}
                      </p>
                      <p className="mt-1 text-xs text-black/40">
                        {registration.email} · {registration.phone}
                      </p>
                    </div>

                    {members.length > 0 ? (
                      <div className="mt-3 space-y-3">
                        {members.map((member, index) => (
                          <div
                            key={member.id}
                            className="rounded-[18px] border border-black/[0.08] p-4"
                          >
                            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-black/35">
                              {member.is_team_leader
                                ? "Team leader"
                                : `Member ${index + 2}`}
                            </p>
                            <p className="mt-2 text-sm font-medium">
                              {member.name}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-black/40">
                              {member.email || "—"} · {member.phone || "—"}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-black/40">
                        No additional team members are stored.
                      </p>
                    )}
                  </div>
                )}

                {success && (
                  <div className="mt-7 rounded-[20px] bg-green-50 p-4 text-sm text-green-700">
                    {success}
                  </div>
                )}

                {!registration.checked_in ? (

                  <button
                    onClick={checkInParticipant}
                    disabled={loading}
                    className="mt-8 flex w-full items-center justify-center gap-2 rounded-full bg-black py-4 text-sm font-medium text-white transition hover:scale-[1.01] disabled:opacity-50"
                  >
                    <CheckCircle2 size={17} />
                    {registration.team ? "Check in team" : "Check in participant"}
                  </button>

                ) : (

                  <div className="mt-8 space-y-3">
                    <button
                      onClick={checkOutParticipant}
                      disabled={loading}
                      className="flex w-full items-center justify-center gap-2 rounded-full border border-red-200 bg-red-50 py-4 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                    >
                      <LogOut size={17} />
                      {registration.team ? "Check out team" : "Check out participant"}
                    </button>

                    <button
                      onClick={scanAnother}
                      disabled={loading}
                      className="flex w-full items-center justify-center gap-2 rounded-full bg-black py-4 text-sm font-medium text-white transition hover:scale-[1.01] disabled:opacity-50"
                    >
                      <QrCode size={17} />
                      Scan next participant
                    </button>
                  </div>

                )}

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
    <div>

      <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-black/35">
        {label}
      </p>

      <p
        className={`text-sm ${
          mono
            ? "break-all font-mono text-xs"
            : ""
        }`}
      >
        {value}
      </p>

    </div>
  );
}