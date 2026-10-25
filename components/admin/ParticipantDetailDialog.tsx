"use client";

import { useEffect, useState, useCallback } from "react";
import {
  X,
  User,
  Mail,
  Phone,
  GraduationCap,
  CheckCircle2,
  AlertCircle,
  FileText,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { useBodyScrollLock } from "@/lib/admin/useBodyScrollLock";
import type { AccommodationRecord } from "@/lib/admin/accommodation-grouping";

interface ParticipantDetailDialogProps {
  acc: AccommodationRecord;
  onClose: () => void;
}

interface FetchedParticipantData {
  participantId?: string;
  name?: string;
  college?: string | null;
  email?: string;
  phone?: string | null;
  gender?: string | null;
  state?: string | null;
  idCardUrl?: string | null;
}

interface FetchedEvent {
  participantEventId?: string;
  eventId?: string;
  eventName?: string;
  eventCategory?: string | null;
  registrationFee?: number;
  paymentType?: string;
  registrationStatus?: string | null;
  paymentStatus?: string | null;
  paymentAmount?: number | null;
  teamName?: string | null;
  checkedIn?: boolean;
  checkedInAt?: string | null;
  mainCheckedIn?: boolean;
  mainCheckedInAt?: string | null;
  registrationGroupId?: string | null;
}

interface FetchedFaculty {
  id: string;
  name?: string | null;
  college?: string | null;
  email?: string | null;
  phone?: string | null;
  idCardUrl?: string | null;
}

interface FetchedAccommodation {
  id?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  duration_days?: number;
  planName?: string;
  hostelName?: string | null;
  roomNumber?: string | null;
  floorNumber?: number | null;
  checked_in?: boolean;
  checked_in_at?: string | null;
  checked_out?: boolean;
  checked_out_at?: string | null;
}

export function ParticipantDetailDialog({ acc, onClose }: ParticipantDetailDialogProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [participant, setParticipant] = useState<FetchedParticipantData | null>(null);
  const [events, setEvents] = useState<FetchedEvent[]>([]);
  const [faculty, setFaculty] = useState<FetchedFaculty[]>([]);
  const [accommodations, setAccommodations] = useState<FetchedAccommodation[]>([]);

  // Lock background scrolling while dialog is open
  useBodyScrollLock(true);

  // Keyboard navigation: Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const participantLookupId =
    acc.participants?.participant_id || acc.participant_id;

  const fetchParticipantDetails = useCallback(async () => {
    if (!participantLookupId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/participants/${encodeURIComponent(participantLookupId)}`,
        { cache: "no-store" }
      );
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Unable to load participant details.");
      }

      setParticipant(data.participant || null);
      setEvents(data.events || []);
      setFaculty(data.faculty || []);
      setAccommodations(data.accommodations || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load details.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [participantLookupId]);

  useEffect(() => {
    fetchParticipantDetails();
  }, [fetchParticipantDetails]);

  // Fallback participant info from the accommodation record itself
  const displayName = participant?.name || acc.participants?.name || "Participant";
  const displayId =
    participant?.participantId ||
    acc.participants?.participant_id ||
    acc.participant_id;
  const displayCollege = participant?.college || acc.participants?.college || "—";
  const displayEmail = participant?.email || acc.participants?.email || "";
  const displayPhone = participant?.phone || acc.participants?.phone || "";
  const displayGender = participant?.gender || acc.participants?.gender || "—";
  const displayState = participant?.state || acc.participants?.state || "—";

  return (
    <div
      className="fixed inset-0 z-[999999] flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      data-lenis-prevent="true"
      aria-labelledby="participant-detail-modal-title"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Dialog Content */}
      <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-black/10 overflow-hidden flex flex-col max-h-[90vh] z-10 animate-in fade-in-0 zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/10 bg-zinc-50/80">
          <div>
            <h2
              id="participant-detail-modal-title"
              className="text-base font-semibold text-black flex items-center gap-2"
            >
              <User size={18} className="text-black/60" />
              <span>Participant Details</span>
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-mono text-xs font-semibold text-black/60">
                {displayId}
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                  acc.status === "paid"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-amber-50 text-amber-700 border-amber-200"
                }`}
              >
                🏨 Stay: {acc.status === "paid" ? "Paid" : "Pending"}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 text-black/40 hover:text-black hover:bg-black/5 rounded-full transition focus:outline-none focus:ring-2 focus:ring-black/20"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <AlertCircle size={18} className="mt-0.5 flex-shrink-0 text-red-600" />
                <div>
                  <p className="font-medium">Notice</p>
                  <p className="text-xs text-red-600/90 mt-0.5">{error}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={fetchParticipantDetails}
                className="px-3 py-1 bg-red-600 text-white rounded-full text-xs font-medium hover:bg-red-700 transition flex items-center gap-1"
              >
                <RefreshCw size={12} />
                <span>Retry</span>
              </button>
            </div>
          )}

          {/* Profile Overview Card */}
          <div className="rounded-2xl bg-black p-5 text-white shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xl font-bold tracking-tight">{displayName}</p>
                <p className="text-xs text-white/60 mt-0.5 flex items-center gap-1.5">
                  <GraduationCap size={14} className="text-white/40" />
                  <span>{displayCollege}</span>
                </p>
              </div>

              {acc.participants?.is_faculty ? (
                <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-orange-500/20 text-orange-300 border border-orange-500/30">
                  Faculty
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  Participant
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-4 border-t border-white/10 text-xs">
              <div className="flex items-center gap-2 text-white/80">
                <Mail size={14} className="text-white/40 flex-shrink-0" />
                <span className="truncate">{displayEmail || "No email"}</span>
              </div>
              <div className="flex items-center gap-2 text-white/80">
                <Phone size={14} className="text-white/40 flex-shrink-0" />
                <span>{displayPhone || "No phone"}</span>
              </div>
            </div>
          </div>

          {/* Personal Information Grid */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-black/40 mb-2.5">
              Personal Information
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="rounded-xl border border-black/10 bg-zinc-50/50 p-3">
                <p className="text-[10px] uppercase font-semibold text-black/40">Gender</p>
                <p className="text-sm font-medium text-black mt-0.5 capitalize">
                  {displayGender}
                </p>
              </div>
              <div className="rounded-xl border border-black/10 bg-zinc-50/50 p-3">
                <p className="text-[10px] uppercase font-semibold text-black/40">State</p>
                <p className="text-sm font-medium text-black mt-0.5">
                  {displayState}
                </p>
              </div>
              <div className="rounded-xl border border-black/10 bg-zinc-50/50 p-3 col-span-2 sm:col-span-1">
                <p className="text-[10px] uppercase font-semibold text-black/40">Team Affiliation</p>
                <p className="text-sm font-medium text-black mt-0.5 truncate">
                  {acc.team_name || "Independent"}
                </p>
              </div>
            </div>
          </div>

          {/* Documents Section */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-black/40 mb-2.5">
              Identity Verification Document
            </h3>
            <div className="rounded-2xl border border-black/10 bg-white p-4">
              {loading ? (
                <div className="flex items-center gap-2 text-xs text-black/50 py-2">
                  <RefreshCw size={14} className="animate-spin text-black/40" />
                  <span>Checking document records...</span>
                </div>
              ) : participant?.idCardUrl ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-indigo-50 text-indigo-700">
                      <FileText size={18} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-black">Participant ID Card</p>
                      <p className="text-[10px] text-black/50">Verified student / faculty identity credential</p>
                    </div>
                  </div>
                  <a
                    href={participant.idCardUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-black text-white rounded-full text-xs font-medium hover:bg-black/80 transition"
                  >
                    <span>View Document</span>
                    <ExternalLink size={12} />
                  </a>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-black/40 py-1">
                  <FileText size={16} className="text-black/30" />
                  <span>No ID card document uploaded for this participant.</span>
                </div>
              )}
            </div>
          </div>

          {/* Faculty in Charge (if any) */}
          {faculty.length > 0 && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-black/40 mb-2.5">
                Faculty In-Charge ({faculty.length})
              </h3>
              <div className="space-y-2">
                {faculty.map((f) => (
                  <div
                    key={f.id}
                    className="rounded-2xl border border-black/10 bg-zinc-50/50 p-4 flex flex-wrap items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-black">{f.name || "Faculty Member"}</p>
                      <p className="text-black/50 text-[11px] mt-0.5">
                        {f.college || "College"} • {f.email || "No email"} • {f.phone || "No phone"}
                      </p>
                    </div>
                    {f.idCardUrl && (
                      <a
                        href={f.idCardUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline"
                      >
                        <span>Faculty ID</span>
                        <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Event Registrations */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-black/40 mb-2.5">
              Event Registrations {events.length > 0 && `(${events.length})`}
            </h3>
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-black/50 py-3">
                <RefreshCw size={14} className="animate-spin text-black/40" />
                <span>Loading registration details...</span>
              </div>
            ) : events.length === 0 ? (
              <div className="rounded-xl border border-black/10 bg-zinc-50/30 p-4 text-xs text-black/40 text-center">
                No event registrations found (Accommodation-only delegate).
              </div>
            ) : (
              <div className="space-y-2">
                {events.map((ev, idx) => (
                  <div
                    key={ev.participantEventId || idx}
                    className="rounded-2xl border border-black/10 bg-white p-3.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-black">{ev.eventName || "Event"}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-black/50">
                        {ev.eventCategory && <span>Category: {ev.eventCategory}</span>}
                        {ev.teamName && (
                          <span className="font-medium text-indigo-700">
                            Team: {ev.teamName}
                          </span>
                        )}
                        <span>Fee: ₹{ev.registrationFee ?? 0}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                          ev.paymentStatus === "confirmed" || ev.paymentStatus === "paid" || ev.registrationFee === 0
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-amber-50 text-amber-700 border-amber-200"
                        }`}
                      >
                        {ev.paymentStatus || "confirmed"}
                      </span>
                      {ev.checkedIn && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1">
                          <CheckCircle2 size={10} />
                          Checked In
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Accommodation Booking Summary */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-black/40 mb-2.5">
              Campus Accommodation Record{accommodations.length > 1 ? ` (${accommodations.length} Stays)` : ""}
            </h3>
            {accommodations.length > 1 ? (
              <div className="space-y-3">
                {accommodations.map((a, idx) => (
                  <div
                    key={a.id || idx}
                    className={`rounded-2xl border p-4 space-y-3 text-xs ${
                      a.id === acc.id
                        ? "border-indigo-300 bg-indigo-50/30"
                        : "border-black/10 bg-zinc-50/50"
                    }`}
                  >
                    <div className="flex items-center justify-between pb-2 border-b border-black/5">
                      <span className="font-semibold text-black">
                        {a.planName || "Campus Stay"}{" "}
                        {a.id === acc.id && (
                          <span className="ml-1 text-[10px] text-indigo-600 font-mono">(Current Row)</span>
                        )}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                          a.status === "paid"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-amber-50 text-amber-700 border-amber-200"
                        }`}
                      >
                        {a.status === "paid" ? "Paid" : "Pending"}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div>
                        <p className="text-[10px] uppercase font-semibold text-black/40">Duration</p>
                        <p className="font-semibold text-black mt-0.5">{a.duration_days ?? 1} Day(s)</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase font-semibold text-black/40">Check-in Date</p>
                        <p className="font-semibold text-black mt-0.5">{a.start_date || "—"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase font-semibold text-black/40">Check-out Date</p>
                        <p className="font-semibold text-black mt-0.5">{a.end_date || "—"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase font-semibold text-black/40">Room / Bed</p>
                        <p className="font-semibold text-black mt-0.5">{a.roomNumber ? `Room ${a.roomNumber}` : "Awaiting"}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-black/10 bg-zinc-50/50 p-4 space-y-3 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <p className="text-[10px] uppercase font-semibold text-black/40">Status</p>
                    <p className="font-semibold text-black mt-0.5 uppercase">{acc.status}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-semibold text-black/40">Duration</p>
                    <p className="font-semibold text-black mt-0.5">{acc.duration_days} Day(s)</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-semibold text-black/40">Check-in Date</p>
                    <p className="font-semibold text-black mt-0.5">{acc.start_date || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-semibold text-black/40">Check-out Date</p>
                    <p className="font-semibold text-black mt-0.5">{acc.end_date || "—"}</p>
                  </div>
                </div>

                <div className="pt-3 border-t border-black/10 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="text-black/50">Room Assignment: </span>
                    <span className="font-semibold text-black">
                      {acc.room_id ? "Assigned" : "Awaiting Room Allocation"}
                    </span>
                  </div>
                  <div>
                    <span className="text-black/50">Hostel Lifecycle: </span>
                    <span className="font-semibold text-black">
                      {acc.checked_out ? "Checked Out" : acc.checked_in ? "Checked In" : "Not Checked In"}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-black/10 bg-zinc-50/80 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-black text-white rounded-full text-xs font-semibold hover:bg-black/80 transition shadow-sm"
          >
            Close Details
          </button>
        </div>
      </div>
    </div>
  );
}
