"use client";

import {
  FormEvent,
  ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  AlertCircle,
  Check,
  Plus,
  QrCode,
  Trash2,
  Users,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { supabase } from "@/lib/supabase";

type EventOption = {
  id: string;
  name: string;
  slug: string;
  category: string;
  registration_type: string | null;
  min_team_size: number | null;
  max_team_size: number | null;

  payment_type: "free" | "paid" | null;
  registration_fee: number | null;
  payment_unit: "per_student" | "per_team" | null;
};

type TeamMember = {
  name: string;
  email: string;
  phone: string;
};

type EventRegistrationState = {
  teamName: string;
  members: TeamMember[];
};

type RegistrationResponse = {
  success?: boolean;
  error?: string;
  participantId?: string;
};

type ParticipantLookupEvent = {
  participantEventId: string;
  eventId: string;
  eventName: string;
  registrationStatus: string | null;
  paymentStatus: string | null;
  paymentAmount: number | null;
  paymentId: string | null;
  teamName: string | null;
  checkedIn: boolean;
  checkedInAt: string | null;
};

type ParticipantLookupResponse = {
  success?: boolean;
  error?: string;
  participant?: {
    participantId: string;
    name: string;
    college: string | null;
    email: string;
    phone: string | null;
  };
  events?: ParticipantLookupEvent[];
};

export default function RegistrationForm() {
  const searchParams = useSearchParams();
const router = useRouter();

const selectedEventParam = searchParams.get("event") ?? "";
const fromAdmin = searchParams.get("from") === "admin";

  const [eventOptions, setEventOptions] = useState<EventOption[]>([]);
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
const [eventSearch, setEventSearch] = useState("");
const [eventCategory, setEventCategory] = useState("All");
  const [eventState, setEventState] = useState<
    Record<string, EventRegistrationState>
  >({});

  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [participantId, setParticipantId] = useState("");
  const [qrCode, setQrCode] = useState("");

  /*
   * Optional existing participant ID.
   *
   * This allows us to support the future flow where someone already
   * has a Saviskar participant ID and wants to add another event.
   */
  const [existingParticipantId, setExistingParticipantId] = useState("");
  const [participantLookupLoading, setParticipantLookupLoading] = useState(false);
  const [participantLookup, setParticipantLookup] = useState<
    ParticipantLookupResponse["participant"] | null
  >(null);
  const [participantLookupEvents, setParticipantLookupEvents] = useState<
    ParticipantLookupEvent[]
  >([]);

  /*
   * LOAD EVENTS
   */
  useEffect(() => {
    async function loadEvents() {
      setEventsLoading(true);
      setErrorMessage("");

      const { data, error } = await supabase
        .from("events")
        .select(`
          id,
          name,
          slug,
          category,
          registration_type,
          min_team_size,
          max_team_size,
          payment_type,
          registration_fee,
          payment_unit
        `)
        .eq("active", true)
        .order("name", { ascending: true });

      if (error) {
        console.error("EVENT LIST ERROR:", error);

        setErrorMessage(
          "We couldn't load the event list. Please refresh and try again."
        );

        setEventsLoading(false);
        return;
      }

      const loaded = (data ?? []) as EventOption[];

      setEventOptions(loaded);

      /*
       * Preserve old links such as:
       *
       * /register?event=hackathon
       *
       * or:
       *
       * /register?event=<uuid>
       */
      const match = loaded.find(
        (item) =>
          item.id === selectedEventParam ||
          item.slug === selectedEventParam
      );

      if (match) {
        setSelectedEventIds([match.id]);
      }

      setEventsLoading(false);
    }

    loadEvents();
  }, [selectedEventParam]);

  /*
   * SELECTED EVENTS
   */
  const selectedEvents = useMemo(
    () =>
      eventOptions.filter((event) =>
        selectedEventIds.includes(event.id)
      ),
    [eventOptions, selectedEventIds]
  );

  const eventCategories = useMemo(() => {
    const categories = Array.from(
      new Set(
        eventOptions
          .map((event) => event.category?.trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));

    return ["All", ...categories];
  }, [eventOptions]);

  const registeredEventIds = useMemo(
    () => new Set(participantLookupEvents.map((item) => item.eventId)),
    [participantLookupEvents]
  );

  const filteredEvents = useMemo(() => {
    const query = eventSearch.trim().toLowerCase();

    return eventOptions.filter((event) => {
      // Once a participant is found, never show events they already have.
      if (registeredEventIds.has(event.id)) return false;

      const matchesCategory =
        eventCategory === "All" ||
        event.category?.toLowerCase() === eventCategory.toLowerCase();

      const matchesSearch =
        !query ||
        event.name.toLowerCase().includes(query) ||
        event.category?.toLowerCase().includes(query) ||
        event.registration_type?.toLowerCase().includes(query);

      return matchesCategory && matchesSearch;
    });
  }, [eventOptions, eventCategory, eventSearch, registeredEventIds]);


  /*
   * INITIALIZE STATE FOR NEW EVENTS
   */
  useEffect(() => {
    setEventState((current) => {
      const next = { ...current };

      for (const eventId of selectedEventIds) {
        if (!next[eventId]) {
          next[eventId] = {
            teamName: "",
            members: [],
          };
        }
      }

      return next;
    });
  }, [selectedEventIds]);

  async function findParticipant() {
    const cleanId = existingParticipantId.trim().toUpperCase();

    if (!cleanId) {
      setParticipantLookup(null);
      setParticipantLookupEvents([]);
      setErrorMessage("Enter your Participant ID first.");
      return;
    }

    setParticipantLookupLoading(true);
    setErrorMessage("");
    setParticipantLookup(null);
    setParticipantLookupEvents([]);

    try {
      const response = await fetch(
        `/api/participants/${encodeURIComponent(cleanId)}`,
        {
          method: "GET",
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        }
      );

      const contentType =
        response.headers.get("content-type") ?? "";

      if (!contentType.includes("application/json")) {
        const responseText = await response.text();

        console.error(
          "Participant lookup returned non-JSON:",
          response.status,
          responseText.slice(0, 500)
        );

        throw new Error(
          `Participant lookup API returned an unexpected response (${response.status}).`
        );
      }

      const result =
        (await response.json()) as ParticipantLookupResponse;

      if (
        !response.ok ||
        !result.success ||
        !result.participant
      ) {
        throw new Error(
          result.error || "Participant not found."
        );
      }

      const registeredEvents = result.events ?? [];

      setExistingParticipantId(
        result.participant.participantId
      );
      setParticipantLookup(
        result.participant
      );
      setParticipantLookupEvents(
        registeredEvents
      );

      // Never keep an event selected if the participant is already registered for it.
      const registeredIds = new Set(registeredEvents.map((item) => item.eventId));
      setSelectedEventIds((current) =>
        current.filter((eventId) => !registeredIds.has(eventId))
      );
      setEventState((current) => {
        const next = { ...current };
        for (const eventId of registeredIds) delete next[eventId];
        return next;
      });
    } catch (error) {
      console.error("Participant lookup error:", error);
      setParticipantLookup(null);
      setParticipantLookupEvents([]);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "We couldn't find that Participant ID."
      );
    } finally {
      setParticipantLookupLoading(false);
    }
  }

  /*
   * EVENT HELPERS
   */
  function isTeamEvent(event: EventOption) {
    return event.registration_type === "team";
  }

  function getTeamState(eventId: string): EventRegistrationState {
    return (
      eventState[eventId] ?? {
        teamName: "",
        members: [],
      }
    );
  }

  function updateTeamName(eventId: string, value: string) {
    setEventState((current) => ({
      ...current,
      [eventId]: {
        ...getTeamState(eventId),
        teamName: value,
      },
    }));
  }

  function addTeamMember(event: EventOption) {
    if (!event.max_team_size) return;

    const state = getTeamState(event.id);

    /*
     * Team leader = member 1.
     */
    const currentTotal = 1 + state.members.length;

    if (currentTotal >= event.max_team_size) return;

    setEventState((current) => ({
      ...current,
      [event.id]: {
        ...getTeamState(event.id),
        members: [
          ...getTeamState(event.id).members,
          {
            name: "",
            email: "",
            phone: "",
          },
        ],
      },
    }));
  }

  function removeTeamMember(eventId: string, index: number) {
    setEventState((current) => ({
      ...current,
      [eventId]: {
        ...getTeamState(eventId),
        members: getTeamState(eventId).members.filter(
          (_, memberIndex) => memberIndex !== index
        ),
      },
    }));
  }

  function updateTeamMember(
    eventId: string,
    index: number,
    field: keyof TeamMember,
    value: string
  ) {
    setEventState((current) => ({
      ...current,
      [eventId]: {
        ...getTeamState(eventId),
        members: getTeamState(eventId).members.map(
          (member, memberIndex) =>
            memberIndex === index
              ? {
                  ...member,
                  [field]: value,
                }
              : member
        ),
      },
    }));
  }

  /*
   * TOGGLE EVENT
   */
  function toggleEvent(eventId: string) {
    setErrorMessage("");

    setSelectedEventIds((current) => {
      if (current.includes(eventId)) {
        return current.filter((id) => id !== eventId);
      }

      return [...current, eventId];
    });
  }

  function removeSelectedEvent(eventId: string) {
    setSelectedEventIds((current) =>
      current.filter((id) => id !== eventId)
    );
  }

  /*
   * TOTAL PRICE
   */
  const totalPrice = useMemo(() => {
    return selectedEvents.reduce((total, event) => {
      if (event.payment_type !== "paid") {
        return total;
      }

      const fee = Number(event.registration_fee || 0);

      /*
       * Per team = one fee regardless of team size.
       */
      if (event.payment_unit === "per_team") {
        return total + fee;
      }

      /*
       * Per student.
       *
       * Team leader is counted as one participant.
       */
      if (isTeamEvent(event)) {
        const teamSize =
          1 + getTeamState(event.id).members.length;

        return total + fee * teamSize;
      }

      return total + fee;
    }, 0);
  }, [selectedEvents, eventState]);

  /*
   * SUBMIT
   */
  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setLoading(true);
    setErrorMessage("");

    try {
      if (selectedEventIds.length === 0) {
        throw new Error(
          "Please select at least one event before continuing."
        );
      }

      const form = event.currentTarget;
      const formData = new FormData(form);

      const name = String(formData.get("name") ?? "").trim();
      const college = String(
        formData.get("college") ?? ""
      ).trim();
      const email = String(
        formData.get("email") ?? ""
      )
        .trim()
        .toLowerCase();

      const phone = String(
        formData.get("phone") ?? ""
      ).trim();

      /*
       * Validate each selected event.
       */
      const eventPayload = selectedEvents.map((selectedEvent) => {
        const state = getTeamState(selectedEvent.id);

        if (isTeamEvent(selectedEvent)) {
          if (!state.teamName.trim()) {
            throw new Error(
              `Please enter a team name for ${selectedEvent.name}.`
            );
          }

          /*
           * Leader counts as Member 1.
           */
          const totalTeamSize = 1 + state.members.length;

          if (
            selectedEvent.min_team_size &&
            totalTeamSize < selectedEvent.min_team_size
          ) {
            throw new Error(
              `${selectedEvent.name} requires at least ${selectedEvent.min_team_size} team members.`
            );
          }

          if (
            selectedEvent.max_team_size &&
            totalTeamSize > selectedEvent.max_team_size
          ) {
            throw new Error(
              `${selectedEvent.name} allows a maximum of ${selectedEvent.max_team_size} team members.`
            );
          }

          /*
           * Validate every teammate.
           */
          for (const member of state.members) {
            if (
              !member.name.trim() ||
              !member.email.trim() ||
              !member.phone.trim()
            ) {
              throw new Error(
                `Please complete all member details for ${selectedEvent.name}.`
              );
            }
          }

          /*
           * Prevent duplicate emails inside this team.
           */
          const teamEmails = [
            email,
            ...state.members.map((member) => member.email),
          ].map((item) => item.trim().toLowerCase());

          if (
            new Set(teamEmails).size !== teamEmails.length
          ) {
            throw new Error(
              `Each member of ${selectedEvent.name} must use a different email address.`
            );
          }
        }

        return {
          eventId: selectedEvent.id,
          team: isTeamEvent(selectedEvent)
            ? state.teamName.trim()
            : null,

          members: isTeamEvent(selectedEvent)
            ? state.members.map((member) => ({
                name: member.name.trim(),
                email: member.email.trim().toLowerCase(),
                phone: member.phone.trim(),
              }))
            : [],
        };
      });

      /*
       * SEND ONE REGISTRATION REQUEST.
       *
       * The same participant can therefore belong to multiple events.
       */
      const response = await fetch("/api/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          participantId:
            existingParticipantId.trim() || undefined,

          name,
          college,
          email,
          phone,

          events: eventPayload,
        }),
      });

      const contentType =
        response.headers.get("content-type") ?? "";

      if (!contentType.includes("application/json")) {
        const responseText = await response.text();

        console.error(
          "Registration API returned non-JSON:",
          response.status,
          responseText.slice(0, 500)
        );

        throw new Error(
          `Registration API returned an unexpected response (${response.status}).`
        );
      }

      const result =
        (await response.json()) as RegistrationResponse;

      if (
        !response.ok ||
        !result.success ||
        !result.participantId
      ) {
        throw new Error(
          result.error ||
            "Could not complete your registration."
        );
      }

      /*
       * QR contains ONLY the permanent participant ID.
       */
      const generatedQr = await QRCode.toDataURL(
        result.participantId,
        {
          width: 500,
          margin: 2,
          errorCorrectionLevel: "H",
        }
      );

      setParticipantId(result.participantId);
      setQrCode(generatedQr);
      setSubmitted(true);

      form.reset();

      setSelectedEventIds([]);
      setEventState({});
      setExistingParticipantId("");
    } catch (error) {
      console.error("Registration error:", error);

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "We couldn't complete your registration. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  /*
   * CONFIRMATION SCREEN
   */
  if (submitted) {
    return (
      <section className="px-6 pb-32 md:px-10 md:pb-44">
        <div className="mx-auto max-w-[1200px]">
          <div className="flex min-h-[650px] flex-col items-center justify-center rounded-[32px] bg-black px-6 py-16 text-center text-white">
            <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-full bg-white text-black">
              <Check size={22} />
            </div>

            <p className="mb-5 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40">
              Registration confirmed
            </p>

            <h2 className="max-w-[800px] text-[clamp(3rem,7vw,7rem)] font-semibold leading-[0.88] tracking-[-0.065em]">
              You&apos;re in.
            </h2>

            <p className="mt-7 max-w-md text-sm leading-6 text-white/45 md:text-base">
              Your Saviskar registration has been successfully
              received.
            </p>

            {qrCode && (
              <div className="mt-10">
                <div className="rounded-[28px] bg-white p-5 shadow-2xl">
                  <img
                    src={qrCode}
                    alt="Registration QR Code"
                    className="h-[210px] w-[210px] md:h-[240px] md:w-[240px]"
                  />
                </div>

                <div className="mt-5 flex items-center justify-center gap-2 text-white/40">
                  <QrCode size={14} />

                  <p className="text-[10px] uppercase tracking-[0.2em]">
                    Entry QR Code
                  </p>
                </div>
              </div>
            )}

            {participantId && (
              <div className="mt-7 rounded-2xl border border-white/10 bg-white/[0.05] px-6 py-4">
                <p className="mb-2 text-[9px] uppercase tracking-[0.2em] text-white/35">
                  Participant ID
                </p>

                <p className="break-all font-mono text-xs text-white/80 md:text-sm">
                  {participantId}
                </p>
              </div>
            )}

            <p className="mt-6 max-w-sm text-xs leading-5 text-white/35">
              Keep this QR code available on your phone. The same
              participant ID can be used to identify your Saviskar
              registrations.
            </p>

            <button
              type="button"
              onClick={() => {
                setSubmitted(false);
                setParticipantId("");
                setQrCode("");
                setErrorMessage("");
              }}
              className="mt-10 rounded-full border border-white/20 px-6 py-3 text-sm transition hover:bg-white hover:text-black"
            >
              Register another participant
            </button>
            {fromAdmin && (
  <button
    type="button"
    onClick={() => router.push("/admin")}
    className="mt-3 rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition hover:bg-white/90"
  >
    ← Back to Admin Panel
  </button>
)}
          </div>
        </div>
      </section>
    );
  }

  /*
   * MAIN FORM
   */
  return (
    <section className="px-6 pb-32 md:px-10 md:pb-44">
      <div className="mx-auto max-w-[1200px]">
        <div className="rounded-[32px] bg-white p-6 shadow-[0_30px_100px_rgba(0,0,0,0.06)] md:p-12 lg:p-16">
          <div className="mb-14 border-b border-black/10 pb-10">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-black/35">
              Registration form
            </p>

            <h2 className="text-3xl font-semibold tracking-[-0.045em] md:text-5xl">
              Tell us about yourself.
            </h2>

            <p className="mt-4 max-w-2xl text-sm leading-6 text-black/45">
              Select one or more events. You only need to register
              once — your Saviskar Participant ID will stay the same
              across your registrations.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="space-y-12"
          >
            {/* EXISTING PARTICIPANT ID */}
            <div className="rounded-[24px] border border-black/10 bg-black/[0.025] p-6">
              <div className="flex items-start gap-4">
                <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black text-white">
                  <Users size={17} />
                </div>

                <div className="w-full">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-black/35">
                    Already registered?
                  </p>

                  <h3 className="mt-2 text-xl font-semibold tracking-tight">
                    Add another event to your Participant ID.
                  </h3>

                  <p className="mt-2 max-w-xl text-sm leading-6 text-black/40">
                    Leave this empty if this is your first
                    registration.
                  </p>

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
                    <input
                      type="text"
                      value={existingParticipantId}
                      onChange={(e) => {
                        setExistingParticipantId(e.target.value.toUpperCase());
                        setParticipantLookup(null);
                        setParticipantLookupEvents([]);
                        setErrorMessage("");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void findParticipant();
                        }
                      }}
                      placeholder="Example: SVK26-8D25C998"
                      className="w-full border-b border-black/15 bg-transparent py-4 font-mono text-sm uppercase outline-none transition placeholder:text-black/20 focus:border-black"
                    />

                    <button
                      type="button"
                      onClick={() => void findParticipant()}
                      disabled={participantLookupLoading || !existingParticipantId.trim()}
                      className="flex shrink-0 items-center justify-center gap-2 rounded-full bg-black px-6 py-3.5 text-sm font-medium text-white transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {participantLookupLoading ? (
                        <>
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                          Finding
                        </>
                      ) : (
                        <>
                          Find Participant
                          <ArrowRight size={15} />
                        </>
                      )}
                    </button>
                  </div>

                  {participantLookup && (
                    <div className="mt-5 rounded-[20px] border border-black/10 bg-white p-5">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black text-white">
                              <Check size={12} />
                            </span>
                            <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-black/35">
                              Participant found
                            </p>
                          </div>
                          <h4 className="mt-2 text-xl font-semibold">
                            {participantLookup.name}
                          </h4>
                          <p className="mt-1 text-sm text-black/45">
                            {participantLookup.email}
                          </p>
                        </div>
                        <p className="font-mono text-xs text-black/45">
                          {participantLookup.participantId}
                        </p>
                      </div>

                      <div className="mt-5 border-t border-black/10 pt-4">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-black/30">
                          Already registered
                        </p>

                        {participantLookupEvents.length === 0 ? (
                          <p className="mt-2 text-sm text-black/45">
                            No existing event registrations found.
                          </p>
                        ) : (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {participantLookupEvents.map((item) => (
                              <span
                                key={item.participantEventId}
                                className="rounded-full bg-black/[0.05] px-3 py-2 text-xs text-black/60"
                              >
                                {item.eventName}
                                {item.paymentStatus
                                  ? ` · ${item.paymentStatus.replace(/_/g, " ")}`
                                  : ""}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* EVENT SELECTION */}
            <div className="space-y-7">
              <div>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-black/35">
                      Events
                    </p>

                    <h3 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
                      What are you joining?
                    </h3>

                    <p className="mt-2 text-sm text-black/40">
                      Search and select as many events as you want.
                    </p>
                  </div>

                  <AnimatePresence mode="popLayout">
                    {selectedEvents.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.96 }}
                        className="w-fit rounded-full bg-black px-4 py-2 text-xs font-medium text-white"
                      >
                        {selectedEvents.length}{" "}
                        {selectedEvents.length === 1 ? "event" : "events"} selected
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {eventsLoading ? (
                <div className="rounded-[24px] border border-black/10 p-8 text-sm text-black/40">
                  Loading events...
                </div>
              ) : (
                <>
                  {participantLookup && (
                    <div className="rounded-[24px] bg-black p-5 text-white md:p-6">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-white/35">
                        Add another event
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        Events already registered to this Participant ID are hidden. Search below to add another event.
                      </p>
                    </div>
                  )}

                  {/* SEARCH */}
                  <div className="rounded-[24px] border border-black/10 bg-black/[0.018] p-3">
                    <div className="flex items-center gap-3 rounded-[18px] bg-white px-4 py-3">
                      <svg
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        className="h-5 w-5 shrink-0 text-black/35"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      >
                        <circle cx="11" cy="11" r="6.5" />
                        <path d="m16 16 4.5 4.5" />
                      </svg>

                      <input
                        type="search"
                        value={eventSearch}
                        onChange={(e) => setEventSearch(e.target.value)}
                        placeholder="Search events..."
                        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-black/30"
                        aria-label="Search events"
                      />

                      {eventSearch && (
                        <button
                          type="button"
                          onClick={() => setEventSearch("")}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-black/[0.05] text-black/45 transition hover:bg-black hover:text-white"
                          aria-label="Clear event search"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>

                    {/* CATEGORY FILTERS */}
                    <div className="mt-3 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {eventCategories.map((category) => {
                        const active = eventCategory === category;

                        return (
                          <button
                            key={category}
                            type="button"
                            onClick={() => setEventCategory(category)}
                            className={`shrink-0 rounded-full px-4 py-2 text-[11px] font-medium transition ${
                              active
                                ? "bg-black text-white"
                                : "bg-white text-black/45 hover:bg-black/[0.06] hover:text-black"
                            }`}
                          >
                            {category}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* SELECTED EVENTS */}
                  <AnimatePresence initial={false}>
                    {selectedEvents.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="rounded-[24px] bg-black p-5 text-white md:p-6">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-white/35">
                                Selected events
                              </p>
                              <p className="mt-1 text-sm text-white/55">
                                Your choices are saved below.
                              </p>
                            </div>

                            <p className="text-sm font-semibold">
                              {totalPrice > 0
                                ? `₹${totalPrice.toLocaleString("en-IN")}`
                                : "Free"}
                            </p>
                          </div>

                          <div className="mt-4 divide-y divide-white/10">
                            {selectedEvents.map((event) => {
                              const state = getTeamState(event.id);
                              const isTeam = isTeamEvent(event);

                              let amount = 0;

                              if (event.payment_type === "paid") {
                                const fee = Number(event.registration_fee || 0);

                                amount =
                                  event.payment_unit === "per_team"
                                    ? fee
                                    : isTeam
                                      ? fee * (1 + state.members.length)
                                      : fee;
                              }

                              return (
                                <motion.div
                                  layout
                                  key={event.id}
                                  className="flex items-center gap-3 py-3"
                                >
                                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-black">
                                    <Check size={13} />
                                  </div>

                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">
                                      {event.name}
                                    </p>
                                    <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-white/35">
                                      {event.category}
                                      {isTeam ? " · Team" : " · Individual"}
                                    </p>
                                  </div>

                                  <span className="shrink-0 text-xs text-white/55">
                                    {amount > 0
                                      ? `₹${amount.toLocaleString("en-IN")}`
                                      : "Free"}
                                  </span>

                                  <button
                                    type="button"
                                    onClick={() => removeSelectedEvent(event.id)}
                                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/35 transition hover:bg-white hover:text-black"
                                    aria-label={`Remove ${event.name}`}
                                  >
                                    <X size={14} />
                                  </button>
                                </motion.div>
                              );
                            })}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* COMPACT EVENT LIST */}
                  <div className="overflow-hidden rounded-[24px] border border-black/10 bg-white">
                    <div className="flex items-center justify-between border-b border-black/10 px-5 py-4">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-black/30">
                        {filteredEvents.length}{" "}
                        {filteredEvents.length === 1 ? "event" : "events"} found
                      </p>

                      {eventSearch || eventCategory !== "All" ? (
                        <button
                          type="button"
                          onClick={() => {
                            setEventSearch("");
                            setEventCategory("All");
                          }}
                          className="text-[10px] font-medium text-black/40 underline-offset-4 hover:text-black hover:underline"
                        >
                          Reset filters
                        </button>
                      ) : null}
                    </div>

                    {filteredEvents.length === 0 ? (
                      <div className="px-6 py-14 text-center">
                        <p className="text-sm font-medium">No events found.</p>
                        <p className="mt-2 text-xs text-black/40">
                          Try another search or category.
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y divide-black/[0.07]">
                        {filteredEvents.map((event, index) => {
                          const selected = selectedEventIds.includes(event.id);
                          const team = isTeamEvent(event);
                          const fee =
                            event.payment_type === "paid"
                              ? Number(event.registration_fee || 0)
                              : 0;

                          return (
                            <motion.button
                              layout
                              initial={{ opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{
                                duration: 0.22,
                                delay: Math.min(index * 0.018, 0.18),
                              }}
                              key={event.id}
                              type="button"
                              onClick={() => toggleEvent(event.id)}
                              className={`group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors md:px-6 ${
                                selected
                                  ? "bg-black text-white"
                                  : "bg-white hover:bg-black/[0.025]"
                              }`}
                            >
                              {/* CHECK */}
                              <div
                                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all ${
                                  selected
                                    ? "border-white bg-white text-black"
                                    : "border-black/15 text-transparent group-hover:border-black/35"
                                }`}
                              >
                                <Check size={14} />
                              </div>

                              {/* NAME */}
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                  <h4 className="truncate text-[15px] font-semibold tracking-[-0.015em] md:text-base">
                                    {event.name}
                                  </h4>

                                  <span
                                    className={`rounded-full px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.16em] ${
                                      selected
                                        ? "bg-white/10 text-white/50"
                                        : "bg-black/[0.045] text-black/35"
                                    }`}
                                  >
                                    {event.category}
                                  </span>
                                </div>

                                <div
                                  className={`mt-1.5 flex flex-wrap items-center gap-x-2 text-[10px] ${
                                    selected ? "text-white/40" : "text-black/35"
                                  }`}
                                >
                                  <span>
                                    {team ? "Team event" : "Individual event"}
                                  </span>

                                  {team &&
                                    event.min_team_size &&
                                    event.max_team_size && (
                                      <>
                                        <span>•</span>
                                        <span>
                                          {event.min_team_size}–
                                          {event.max_team_size} members
                                        </span>
                                      </>
                                    )}
                                </div>
                              </div>

                              {/* PRICE */}
                              <div className="hidden shrink-0 text-right sm:block">
                                <p
                                  className={`text-[8px] uppercase tracking-[0.16em] ${
                                    selected ? "text-white/30" : "text-black/25"
                                  }`}
                                >
                                  Registration
                                </p>
                                <p className="mt-1 text-sm font-semibold">
                                  {fee > 0
                                    ? `₹${fee.toLocaleString("en-IN")}`
                                    : "Free"}
                                </p>
                              </div>

                              <ArrowRight
                                size={15}
                                className={`shrink-0 transition-all ${
                                  selected
                                    ? "translate-x-0 text-white/45"
                                    : "-translate-x-1 text-black/15 group-hover:translate-x-0 group-hover:text-black/40"
                                }`}
                              />
                            </motion.button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-black/30">
                    Select multiple events here. Their individual details will appear below.
                  </p>
                </>
              )}
            </div>

            {/* SELECTED EVENT CONFIGURATION */}
            {selectedEvents.length > 0 && (
              <div className="space-y-8 border-t border-black/10 pt-12">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-black/35">
                    Event details
                  </p>

                  <h3 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
                    Complete your selections.
                  </h3>
                </div>

                {selectedEvents.map((event, eventIndex) => {
                  const team = isTeamEvent(event);
                  const state = getTeamState(event.id);

                  return (
                    <div
                      key={event.id}
                      className="rounded-[28px] border border-black/10 bg-black/[0.018] p-6 md:p-8"
                    >
                      {/* EVENT HEADER */}
                      <div className="flex items-start justify-between gap-6">
                        <div>
                          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-black/30">
                            Event {String(eventIndex + 1).padStart(2, "0")}
                          </p>

                          <h4 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
                            {event.name}
                          </h4>

                          <p className="mt-2 text-sm text-black/40">
                            {team
                              ? "Add your team information below."
                              : "No additional event information is required."}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            removeSelectedEvent(event.id)
                          }
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/10 text-black/40 transition hover:border-red-200 hover:bg-red-50 hover:text-red-500"
                          aria-label={`Remove ${event.name}`}
                        >
                          <X size={16} />
                        </button>
                      </div>

                      {/* TEAM EVENT */}
                      {team && (
                        <div className="mt-8 space-y-8">
                          <Field label="Team name">
                            <input
                              type="text"
                              value={state.teamName}
                              onChange={(e) =>
                                updateTeamName(
                                  event.id,
                                  e.target.value
                                )
                              }
                              placeholder="Enter your team name"
                              required
                              className="w-full border-b border-black/15 bg-transparent py-4 text-lg outline-none transition placeholder:text-black/25 focus:border-black"
                            />
                          </Field>

                          <div className="border-t border-black/10 pt-8">
                            <div className="flex items-end justify-between gap-4">
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-black/35">
                                  Team members
                                </p>

                                <h5 className="mt-2 text-xl font-semibold">
                                  Add your teammates.
                                </h5>

                                <p className="mt-2 text-sm text-black/40">
                                  You are automatically counted
                                  as Member 1.
                                </p>
                              </div>

                              {event.max_team_size && (
                                <p className="shrink-0 text-sm text-black/40">
                                  {state.members.length + 1} /{" "}
                                  {event.max_team_size}
                                </p>
                              )}
                            </div>

                            <div className="mt-7 space-y-5">
                              {state.members.map(
                                (member, index) => (
                                  <div
                                    key={index}
                                    className="rounded-[22px] border border-black/10 bg-white p-6"
                                  >
                                    <div className="mb-6 flex items-center justify-between">
                                      <div>
                                        <p className="text-[9px] uppercase tracking-[0.2em] text-black/30">
                                          Team member
                                        </p>

                                        <h6 className="mt-1 text-lg font-semibold">
                                          Member{" "}
                                          {index + 2}
                                        </h6>
                                      </div>

                                      <button
                                        type="button"
                                        onClick={() =>
                                          removeTeamMember(
                                            event.id,
                                            index
                                          )
                                        }
                                        className="flex h-9 w-9 items-center justify-center rounded-full border border-red-200 text-red-500 transition hover:bg-red-50"
                                      >
                                        <Trash2
                                          size={15}
                                        />
                                      </button>
                                    </div>

                                    <div className="grid gap-8 md:grid-cols-3">
                                      <Field label="Full name">
                                        <input
                                          type="text"
                                          value={
                                            member.name
                                          }
                                          onChange={(e) =>
                                            updateTeamMember(
                                              event.id,
                                              index,
                                              "name",
                                              e.target.value
                                            )
                                          }
                                          placeholder="Member name"
                                          required
                                          className="w-full border-b border-black/15 bg-transparent py-4 text-lg outline-none transition placeholder:text-black/25 focus:border-black"
                                        />
                                      </Field>

                                      <Field label="Email">
                                        <input
                                          type="email"
                                          value={
                                            member.email
                                          }
                                          onChange={(e) =>
                                            updateTeamMember(
                                              event.id,
                                              index,
                                              "email",
                                              e.target.value
                                            )
                                          }
                                          placeholder="member@example.com"
                                          required
                                          className="w-full border-b border-black/15 bg-transparent py-4 text-lg outline-none transition placeholder:text-black/25 focus:border-black"
                                        />
                                      </Field>

                                      <Field label="Phone">
                                        <input
                                          type="tel"
                                          value={
                                            member.phone
                                          }
                                          onChange={(e) =>
                                            updateTeamMember(
                                              event.id,
                                              index,
                                              "phone",
                                              e.target.value
                                            )
                                          }
                                          placeholder="+91 98765 43210"
                                          required
                                          className="w-full border-b border-black/15 bg-transparent py-4 text-lg outline-none transition placeholder:text-black/25 focus:border-black"
                                        />
                                      </Field>
                                    </div>
                                  </div>
                                )
                              )}
                            </div>

                            {event.max_team_size &&
                              state.members.length + 1 <
                                event.max_team_size && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    addTeamMember(event)
                                  }
                                  className="mt-6 flex items-center gap-2 rounded-full border border-black/15 px-5 py-3 text-sm font-medium transition hover:bg-black hover:text-white"
                                >
                                  <Plus size={16} />
                                  Add team member
                                </button>
                              )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* PERSONAL INFORMATION */}
            <div className="space-y-8 border-t border-black/10 pt-12">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-black/35">
                  Participant details
                </p>

                <h3 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
                  Your information.
                </h3>
              </div>

              <div className="grid gap-10 md:grid-cols-2">
                <Field label="Full name">
                  <input
                    key={`name-${participantLookup?.participantId ?? "new"}`}
                    type="text"
                    name="name"
                    defaultValue={participantLookup?.name ?? ""}
                    placeholder="Your name"
                    required
                    minLength={2}
                    readOnly={Boolean(participantLookup)}
                    className={`w-full border-b border-black/15 bg-transparent py-4 text-lg outline-none transition placeholder:text-black/25 focus:border-black ${participantLookup ? "text-black/55" : ""}`}
                  />
                </Field>

                <Field label="College / University">
                  <input
                    key={`college-${participantLookup?.participantId ?? "new"}`}
                    type="text"
                    name="college"
                    defaultValue={participantLookup?.college ?? ""}
                    placeholder="Your institution"
                    required
                    minLength={2}
                    readOnly={Boolean(participantLookup)}
                    className={`w-full border-b border-black/15 bg-transparent py-4 text-lg outline-none transition placeholder:text-black/25 focus:border-black ${participantLookup ? "text-black/55" : ""}`}
                  />
                </Field>
              </div>

              <div className="grid gap-10 md:grid-cols-2">
                <Field label="Email">
                  <input
                    key={`email-${participantLookup?.participantId ?? "new"}`}
                    type="email"
                    name="email"
                    defaultValue={participantLookup?.email ?? ""}
                    placeholder="you@example.com"
                    required
                    readOnly={Boolean(participantLookup)}
                    className={`w-full border-b border-black/15 bg-transparent py-4 text-lg outline-none transition placeholder:text-black/25 focus:border-black ${participantLookup ? "text-black/55" : ""}`}
                  />
                </Field>

                <Field label="Phone">
                  <input
                    key={`phone-${participantLookup?.participantId ?? "new"}`}
                    type="tel"
                    name="phone"
                    defaultValue={participantLookup?.phone ?? ""}
                    placeholder="+91 98765 43210"
                    required
                    pattern="[0-9+\-\s]{10,18}"
                    readOnly={Boolean(participantLookup)}
                    className={`w-full border-b border-black/15 bg-transparent py-4 text-lg outline-none transition placeholder:text-black/25 focus:border-black ${participantLookup ? "text-black/55" : ""}`}
                  />
                </Field>
              </div>
            </div>

            {/* PAYMENT SUMMARY */}
            {selectedEvents.length > 0 && (
              <div className="rounded-[28px] bg-black p-6 text-white md:p-8">
                <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">
                      Registration summary
                    </p>

                    <h3 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">
                      {selectedEvents.length}{" "}
                      {selectedEvents.length === 1
                        ? "event"
                        : "events"}{" "}
                      selected
                    </h3>

                    <div className="mt-5 space-y-2">
                      {selectedEvents.map((event) => {
                        const state = getTeamState(
                          event.id
                        );

                        let amount = 0;

                        if (
                          event.payment_type === "paid"
                        ) {
                          const fee = Number(
                            event.registration_fee || 0
                          );

                          if (
                            event.payment_unit ===
                            "per_team"
                          ) {
                            amount = fee;
                          } else if (
                            isTeamEvent(event)
                          ) {
                            amount =
                              fee *
                              (1 +
                                state.members.length);
                          } else {
                            amount = fee;
                          }
                        }

                        return (
                          <div
                            key={event.id}
                            className="flex items-center justify-between gap-6 text-sm"
                          >
                            <span className="text-white/50">
                              {event.name}
                            </span>

                            <span className="font-medium text-white/80">
                              {amount > 0
                                ? `₹${amount.toLocaleString(
                                    "en-IN"
                                  )}`
                                : "Free"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="md:text-right">
                    <p className="text-[9px] uppercase tracking-[0.2em] text-white/30">
                      Total
                    </p>

                    <p className="mt-2 text-4xl font-semibold tracking-[-0.04em]">
                      {totalPrice > 0
                        ? `₹${totalPrice.toLocaleString(
                            "en-IN"
                          )}`
                        : "Free"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* AGREEMENT */}
            <label className="flex cursor-pointer items-start gap-3 border-t border-black/10 pt-8">
              <input
                type="checkbox"
                name="agreement"
                required
                className="mt-1 h-4 w-4 accent-black"
              />

              <span className="max-w-2xl text-sm leading-6 text-black/45">
                I confirm that the information provided above
                is correct and I agree to follow the official
                Saviskar event rules.
              </span>
            </label>

            {errorMessage && (
              <div className="flex items-center gap-3 rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700">
                <AlertCircle size={18} />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* SUBMIT */}
            <div className="flex flex-col items-stretch justify-between gap-6 border-t border-black/10 pt-8 sm:flex-row sm:items-center">
              <div>
                <p className="text-xs text-black/35">
                  {selectedEvents.length === 0
                    ? "Select at least one event."
                    : `${selectedEvents.length} event${
                        selectedEvents.length === 1
                          ? ""
                          : "s"
                      } selected`}
                </p>

                {totalPrice > 0 && (
                  <p className="mt-1 text-sm font-medium">
                    Total: ₹
                    {totalPrice.toLocaleString(
                      "en-IN"
                    )}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={
                  loading ||
                  eventsLoading ||
                  selectedEventIds.length === 0
                }
                className="group flex min-w-[220px] items-center justify-center gap-3 rounded-full bg-black px-7 py-4 text-sm font-medium text-white transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Registering
                  </>
                ) : (
                  <>
                    {totalPrice > 0
                      ? "Continue registration"
                      : "Complete registration"}

                    <ArrowRight
                      size={16}
                      className="transition-transform group-hover:translate-x-1"
                    />
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-black/40">
        {label}
      </span>

      {children}
    </label>
  );
}