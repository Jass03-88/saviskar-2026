"use client";

import {
  FormEvent,
  ReactNode,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  AlertCircle,
  Check,
  ChevronDown,
  Plus,
  QrCode,
  Trash2,
  Users,
  X,
  Sparkles,
  ShieldCheck,
  Search,
  CreditCard,
  ExternalLink,
} from "lucide-react";
import QRCode from "qrcode";
import { supabase } from "@/lib/supabase";
import TermsConditionsModal from "./TermsConditionsModal";
import { INDIAN_STATES_AND_UT } from "@/lib/states";
import { ImageUploader } from "@/components/ui/image-uploader";

export function formatAccommodationDate(duration: number) {
  if (duration === 1) return "28 Oct";
  if (duration === 2) return "28–29 Oct";
  if (duration === 3) return "28–30 Oct";
  return "28 Oct onwards";
}

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
  college: string;
  email: string;
  phone: string;
  gender: string;
  state: string;
  idCardStoragePath: string;
  accommodationPlanSlug: string;
};

type AccommodationPlan = {
  id: string;
  slug: string;
  name: string;
  price: number;
  duration: number;
  currency: string;
};

type EventRegistrationState = {
  teamName: string;
  isTeamHead: boolean;
  members: TeamMember[];
};

type RegistrationResponse = {
  success?: boolean;
  error?: string;
  participantId?: string;
  paymentRequired?: boolean;
  totalAmount?: number;
  paymentOrder?: {
    id: string;
    orderReference: string;
    amount: number;
    currency: string;
    status: string;
  } | null;
  teamMembers?: Array<{
    participantId: string;
    name: string;
    college: string | null;
    email: string;
    phone: string | null;
    isTeamHead: boolean;
  }>;
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

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

interface RegistrationFormProps {
  sessionEmail?: string;
  onSignOut?: () => void;
}

export default function RegistrationForm({
  sessionEmail = "",
  onSignOut,
}: RegistrationFormProps = {}) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const normalizedSessionEmail = sessionEmail.trim().toLowerCase();

  const selectedEventParam = searchParams.get("event") ?? "";
  const fromAdmin = searchParams.get("from") === "admin";

  const [eventOptions, setEventOptions] = useState<EventOption[]>([]);
  const [accommodationPlans, setAccommodationPlans] = useState<AccommodationPlan[]>([]);
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventSearch, setEventSearch] = useState("");
  const [eventCategory, setEventCategory] = useState("All");
  const [eventState, setEventState] = useState<
    Record<string, EventRegistrationState>
  >({});
  const [mainAccommodationSlug, setMainAccommodationSlug] = useState("");
  const [mainIdCardStoragePath, setMainIdCardStoragePath] = useState("");

  const [facultyEnabled, setFacultyEnabled] = useState(false);
  const [facultyState, setFacultyState] = useState({
    name: "",
    college: "",
    email: "",
    phone: "",
    gender: "",
    state: "",
    idCardStoragePath: "",
    accommodationPlanSlug: ""
  });

  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [participantId, setParticipantId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [teamMembers, setTeamMembers] = useState<
    NonNullable<RegistrationResponse["teamMembers"]>
  >([]);

  /*
   * Payment state.
   */
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [paymentPending, setPaymentPending] = useState(false);
  const [pendingPaymentOrderId, setPendingPaymentOrderId] = useState("");
  const [pendingPaymentAmount, setPendingPaymentAmount] = useState(0);

  /*
   * Optional existing participant ID.
   *
   * This allows us to support the future flow where someone already
   * has a Saviskar participant ID and wants to add another event.
   */
  const [existingParticipantId, setExistingParticipantId] = useState("");
  const [existingParticipantEmail, setExistingParticipantEmail] = useState(normalizedSessionEmail);

  useEffect(() => {
    if (normalizedSessionEmail) {
      setExistingParticipantEmail(normalizedSessionEmail);
    }
  }, [normalizedSessionEmail]);

  const [participantLookupLoading, setParticipantLookupLoading] = useState(false);
  const [participantLookup, setParticipantLookup] = useState<
    ParticipantLookupResponse["participant"] | null
  >(null);
  const [participantLookupEvents, setParticipantLookupEvents] = useState<
    ParticipantLookupEvent[]
  >([]);
  const [termsModalOpen, setTermsModalOpen] = useState(false);

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

      const { data: accData } = await supabase
        .from("accommodation_plans")
        .select("*")
        .eq("is_active", true)
        .order("price", { ascending: true });

      if (accData) {
        setAccommodationPlans(accData as AccommodationPlan[]);
      }

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

  const hasTeamEvent = useMemo(
    () => selectedEvents.some((event) => isTeamEvent(event)),
    [selectedEvents]
  );

  const firstTeamEventId = useMemo(
    () =>
      selectedEvents.find((event) => isTeamEvent(event))?.id ?? null,
    [selectedEvents]
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
   * COMPACT EVENT BROWSER
   *
   * By default only the first 3 events are shown. Clicking "View all"
   * expands the list to all matching events. Whenever filters change,
   * the list collapses back to the first 3 events.
   */
  const [showAllEvents, setShowAllEvents] = useState(false);

  const visibleEvents =
    showAllEvents
      ? filteredEvents
      : filteredEvents.slice(0, 3);


  /*
   * (Event state initialization handled directly in toggleEvent)
   */

  async function findParticipant() {
    const cleanId = existingParticipantId.trim().toUpperCase();
    const cleanEmail = (normalizedSessionEmail || existingParticipantEmail).trim().toLowerCase();

    if (!cleanId) {
      setParticipantLookup(null);
      setParticipantLookupEvents([]);
      setErrorMessage("Enter your Participant ID first.");
      return;
    }

    if (!cleanEmail) {
      setParticipantLookup(null);
      setParticipantLookupEvents([]);
      setErrorMessage("Enter your registered email address.");
      return;
    }

    if (
      normalizedSessionEmail &&
      existingParticipantEmail.trim() &&
      existingParticipantEmail.trim().toLowerCase() !== normalizedSessionEmail
    ) {
      setParticipantLookup(null);
      setParticipantLookupEvents([]);
      setErrorMessage(
        `Participant lookup must match your authenticated session email (${normalizedSessionEmail}).`
      );
      return;
    }

    setParticipantLookupLoading(true);
    setErrorMessage("");
    setParticipantLookup(null);
    setParticipantLookupEvents([]);

    try {
      const response = await fetch(
        `/api/participants/${encodeURIComponent(cleanId)}?email=${encodeURIComponent(cleanEmail)}`,
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

  const getTeamState = useCallback((eventId: string): EventRegistrationState => {
    return (
      eventState[eventId] ?? {
        teamName: "",
        isTeamHead: false,
        members: [],
      }
    );
  }, [eventState]);

  function updateTeamName(eventId: string, value: string) {
    setEventState((current) => ({
      ...current,
      [eventId]: {
        ...getTeamState(eventId),
        teamName: value,
      },
    }));
  }
  function updateTeamHead(
    eventId: string,
    value: boolean
  ) {
    setEventState((current) => ({
      ...current,
      [eventId]: {
        ...getTeamState(eventId),
        isTeamHead: value,
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
            college: "",
            email: "",
            phone: "",
            gender: "",
            state: "",
            idCardStoragePath: "",
            accommodationPlanSlug: "",
          },
        ],
      },
    }));
  }

  function removeTeamMember(eventId: string, index: number) {
    const event = eventOptions.find((e) => e.id === eventId);
    const currentMembers = getTeamState(eventId).members;

    /*
     * Don't allow removal below the minimum required members.
     * Leader = member 1, so minimum additional = min_team_size - 1.
     */
    if (
      event?.min_team_size &&
      currentMembers.length <= event.min_team_size - 1
    ) {
      return;
    }

    setEventState((current) => ({
      ...current,
      [eventId]: {
        ...getTeamState(eventId),
        members: currentMembers.filter(
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

      /*
       * When a team event is first selected, pre-populate the
       * minimum required member slots so the user immediately
       * sees how many teammates they need to fill in.
       *
       * Leader counts as member 1, so we create
       * (min_team_size - 1) empty slots.
       */
      const event = eventOptions.find((e) => e.id === eventId);

      if (
        event &&
        event.registration_type === "team" &&
        event.min_team_size &&
        event.min_team_size > 1
      ) {
        const existingMembers =
          eventState[eventId]?.members ?? [];

        const requiredAdditional =
          event.min_team_size - 1;

        if (existingMembers.length < requiredAdditional) {
          const slotsToAdd =
            requiredAdditional - existingMembers.length;

          const newMembers: TeamMember[] = Array.from(
            { length: slotsToAdd },
            () => ({
              name: "",
              college: "",
              email: "",
              phone: "",
              gender: "",
              state: "",
              idCardStoragePath: "",
              accommodationPlanSlug: "",
            })
          );

          setEventState((currentState) => ({
            ...currentState,
            [eventId]: {
              ...(currentState[eventId] ?? {
                teamName: "",
                isTeamHead: false,
                members: [],
              }),
              members: [
                ...existingMembers,
                ...newMembers,
              ],
            },
          }));
        }
      }

      setEventState((currentState) => {
        if (currentState[eventId]) return currentState;
        return {
          ...currentState,
          [eventId]: {
            teamName: "",
            isTeamHead: false,
            members: [],
          },
        };
      });

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
    let accommodationCostTotal = 0;
    const accEmailsCharged = new Set<string>();

    // Main participant accommodation
    if (mainAccommodationSlug) {
      const plan = accommodationPlans.find((p) => p.slug === mainAccommodationSlug);
      if (plan) accommodationCostTotal += plan.price;
    }

    // Faculty accommodation
    if (facultyEnabled && facultyState.accommodationPlanSlug) {
      const plan = accommodationPlans.find((p) => p.slug === facultyState.accommodationPlanSlug);
      if (plan) {
        accommodationCostTotal += plan.price;
        const facEmail = facultyState.email.trim().toLowerCase();
        if (facEmail) accEmailsCharged.add(facEmail);
      }
    }

    // Team members accommodations
    selectedEvents.forEach((event) => {
      if (isTeamEvent(event)) {
        const state = getTeamState(event.id);
        state.members.forEach((m) => {
          if (m.accommodationPlanSlug) {
            const memberEmail = m.email.trim().toLowerCase();
            // Deduplicate accommodation charges for the same team member across multiple events
            if (!memberEmail || !accEmailsCharged.has(memberEmail)) {
              const plan = accommodationPlans.find((p) => p.slug === m.accommodationPlanSlug);
              if (plan) {
                accommodationCostTotal += plan.price;
                if (memberEmail) accEmailsCharged.add(memberEmail);
              }
            }
          }
        });
      }
    });

    const eventsCost = selectedEvents.reduce((total, event) => {
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
        const teamMembersCount = eventState[event.id]?.members?.length ?? 0;
        const teamSize = 1 + teamMembersCount;

        return total + fee * teamSize;
      }

      return total + fee;
    }, 0);
    
    return eventsCost + accommodationCostTotal;
  }, [selectedEvents, eventState, accommodationPlans, mainAccommodationSlug, getTeamState, facultyEnabled, facultyState]);

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
        throw new ValidationError(
          "Please select at least one event before continuing."
        );
      }

      const form = event.currentTarget;
      const formData = new FormData(form);

      const name = String(formData.get("name") ?? "").trim();
      const college = String(
        formData.get("college") ?? ""
      ).trim();
      const rawEmail = String(
        formData.get("email") ?? ""
      )
        .trim()
        .toLowerCase();

      const email =
        normalizedSessionEmail ||
        (existingParticipantId.trim() && existingParticipantEmail.trim()
          ? existingParticipantEmail.trim().toLowerCase()
          : rawEmail);

      const phone = String(
        formData.get("phone") ?? ""
      ).trim();

      const gender = String(
        formData.get("gender") ?? ""
      ).trim();

      const stateLocation = String(
        formData.get("state") ?? ""
      ).trim();

      const mainAccSlug = String(
        formData.get("accommodationPlanSlug") ?? ""
      ).trim();

      const accommodationsPayload: Array<{ email: string; planSlug: string }> = [];

      if (mainAccSlug) {
        accommodationsPayload.push({
          email,
          planSlug: mainAccSlug,
        });
      }

      if (!mainIdCardStoragePath) {
        throw new ValidationError("Please upload your ID Card.");
      }

      if (facultyEnabled) {
        if (!facultyState.name.trim() || !facultyState.email.trim() || !facultyState.phone.trim() || !facultyState.gender || !facultyState.state.trim() || !facultyState.idCardStoragePath) {
          throw new ValidationError("Please complete all Faculty Incharge details (including ID card).");
        }
        if (facultyState.accommodationPlanSlug) {
          accommodationsPayload.push({
            email: facultyState.email.trim().toLowerCase(),
            planSlug: facultyState.accommodationPlanSlug,
          });
        }
      }

      /*
       * Validate each selected event.
       */
      const eventPayload = selectedEvents.map((selectedEvent) => {
        const state = getTeamState(selectedEvent.id);

        if (isTeamEvent(selectedEvent)) {
          if (!state.teamName.trim()) {
            throw new ValidationError(
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
            throw new ValidationError(
              `${selectedEvent.name} requires at least ${selectedEvent.min_team_size} team members.`
            );
          }

          if (
            selectedEvent.max_team_size &&
            totalTeamSize > selectedEvent.max_team_size
          ) {
            throw new ValidationError(
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
              !member.phone.trim() ||
              !member.gender.trim() ||
              !member.state.trim() ||
              !member.idCardStoragePath.trim()
            ) {
              throw new ValidationError(
                `Please complete all member details (including ID Card) for ${selectedEvent.name}.`
              );
            }

            if (member.accommodationPlanSlug) {
              accommodationsPayload.push({
                email: member.email.trim().toLowerCase(),
                planSlug: member.accommodationPlanSlug,
              });
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
            throw new ValidationError(
              `Each member of ${selectedEvent.name} must use a different email address.`
            );
          }
        }

        return {
          eventId: selectedEvent.id,
          team: isTeamEvent(selectedEvent)
            ? state.teamName.trim()
            : null,

          isTeamHead: isTeamEvent(selectedEvent)
            ? state.isTeamHead
            : false,

          members: isTeamEvent(selectedEvent)
            ? state.members.map((member) => ({
              name: member.name.trim(),
              college: college || participantLookup?.college || "",
              email: member.email.trim().toLowerCase(),
              phone: member.phone.trim(),
              gender: member.gender.trim(),
              state: member.state.trim(),
              idCardStoragePath: member.idCardStoragePath.trim(),
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
          gender,
          state: stateLocation,
          idCardStoragePath: mainIdCardStoragePath,

          events: eventPayload,
          accommodations: accommodationsPayload,
          faculty: facultyEnabled ? {
            name: facultyState.name.trim(),
            college: facultyState.college.trim() || college,
            email: facultyState.email.trim(),
            phone: facultyState.phone.trim(),
            gender: facultyState.gender.trim(),
            state: facultyState.state.trim(),
            idCardStoragePath: facultyState.idCardStoragePath.trim(),
          } : undefined,
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
       * Store participant info immediately —
       * needed for both free and paid paths.
       */
      setParticipantId(result.participantId);
      setTeamMembers(result.teamMembers ?? []);

      /*
       * PAYMENT FLOW
       *
       * If the registration includes paid events, open the
       * payment gateway checkout before showing the success screen.
       * Free events proceed directly to QR/success.
       */
      if (
        result.paymentRequired &&
        result.paymentOrder?.id &&
        Number(result.totalAmount) > 0
      ) {
        form.reset();
        setSelectedEventIds([]);
        setEventState({});
        setExistingParticipantId("");

        setPendingPaymentOrderId(result.paymentOrder.id);
        setPendingPaymentAmount(Number(result.totalAmount));

        await initiatePaymentCheckout(
          result.paymentOrder.id,
          result.participantId
        );
        return;
      }

      /*
       * FREE EVENT PATH — no payment needed.
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

      setQrCode(generatedQr);
      setSubmitted(true);

      form.reset();

      setSelectedEventIds([]);
      setEventState({});
      setExistingParticipantId("");
    } catch (error) {
      if (error instanceof ValidationError) {
        setErrorMessage(error.message);
      } else {
        console.error("Registration error:", error);
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "We couldn't complete your registration. Please try again."
        );
      }
    } finally {
      setLoading(false);
    }
  }

  /*
   * (Removed PayU Script Loader)
   */

  /*
   * PAYMENT CHECKOUT
   *
   * Creates a gateway order via /api/payments/create,
   * then opens the PayU overlay.
   *
   * On success: verifies server-side via /api/payments/verify,
   * then shows QR/success screen.
   *
   * On dismiss/failure: shows payment pending screen with retry.
   */
  async function initiatePaymentCheckout(
    paymentOrderId: string,
    currentParticipantId: string
  ) {
    setPaymentProcessing(true);
    setErrorMessage("");

    try {
      // 1. Create gateway order
      const createResponse = await fetch("/api/payments/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ paymentOrderId }),
      });

      let createResult: {
        success?: boolean;
        error?: string;
        code?: string;
        alreadyPaid?: boolean;
        participantId?: string;
        paymentOrderId?: string;
        checkoutConfig?: {
          postUrl?: string;
          options?: Record<string, unknown>;
        };
      } | null = null;

      try {
        const text = await createResponse.text();
        if (text && text.trim().length > 0) {
          createResult = JSON.parse(text);
        }
      } catch {
        createResult = null;
      }

      if (!createResponse.ok || !createResult?.success) {
        if (
          createResult?.code === "VERIFICATION_UNAVAILABLE" ||
          createResponse.status === 503 ||
          createResponse.status === 502
        ) {
          throw new Error(
            "Payment verification is temporarily unavailable. Please try again in a few moments."
          );
        }
        if (
          createResult?.code === "PAYMENT_PENDING" ||
          createResponse.status === 409
        ) {
          throw new Error(
            createResult?.error ||
              "A payment attempt is currently being processed by the gateway. Please complete it on your payment app or wait a few moments before retrying."
          );
        }
        throw new Error(
          createResult?.error ||
          "Could not initialize payment. Please try again."
        );
      }

      // Check if order was already paid
      if (createResult.alreadyPaid) {
        const confirmedId = createResult.participantId || currentParticipantId || participantId;
        if (confirmedId) {
          setParticipantId(confirmedId);
          try {
            const qrData = await QRCode.toDataURL(confirmedId, {
              width: 500,
              margin: 2,
              errorCorrectionLevel: "H",
            });
            setQrCode(qrData);
          } catch (qrErr) {
            console.error("QR generation error:", qrErr);
          }
        }
        setSubmitted(true);
        setPaymentPending(false);
        setPaymentProcessing(false);
        return;
      }

      // Update pending payment order ID if a fresh order attempt was created on retry
      if (createResult.paymentOrderId) {
        setPendingPaymentOrderId(createResult.paymentOrderId);
      }

      // 2. Submit PayU Hosted Checkout form
      const checkoutConfig = createResult.checkoutConfig;
      const options = checkoutConfig?.options ?? {};
      const postUrl = checkoutConfig?.postUrl;

      if (!postUrl || !options.hash) {
        throw new Error(
          "Payment gateway configuration is missing or invalid."
        );
      }

      const checkoutForm = document.createElement("form");
      checkoutForm.method = "POST";
      checkoutForm.action = postUrl;
      checkoutForm.style.display = "none";

      for (const [key, value] of Object.entries(options)) {
        if (value !== undefined && value !== null) {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = key;
          input.value = String(value);
          checkoutForm.appendChild(input);
        }
      }

      document.body.appendChild(checkoutForm);
      checkoutForm.submit();
      
      // Do not set paymentProcessing to false, because we are navigating away.
      return;
    } catch (error) {
      console.error("Payment checkout error:", error);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Payment could not be processed. Please try again."
      );
      setPaymentPending(true);
    } finally {
      setPaymentProcessing(false);
      setLoading(false);
    }
  }

  /*
   * PAYMENT RECOVERY
   */
  async function handlePaymentRecovery(item: ParticipantLookupEvent) {
    if (!participantLookup) return;

    try {
      setPaymentProcessing(true);
      setErrorMessage("");

      const recoveryResponse = await fetch("/api/payments/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: participantLookup.participantId,
          participantEventId: item.participantEventId,
        }),
      });

      let recoveryPayload: {
        success?: boolean;
        paymentOrderId?: string;
        error?: string;
      } | null = null;

      try {
        const text = await recoveryResponse.text();
        if (text && text.trim().length > 0) {
          recoveryPayload = JSON.parse(text);
        }
      } catch {
        recoveryPayload = null;
      }

      if (!recoveryResponse.ok || !recoveryPayload) {
        throw new Error(
          recoveryPayload?.error || "Could not initialize payment recovery. Please try again."
        );
      }

      const { paymentOrderId } = recoveryPayload;

      if (!paymentOrderId) {
        throw new Error("Invalid payment order returned.");
      }

      setPendingPaymentOrderId(paymentOrderId);
      setPendingPaymentAmount(item.paymentAmount || 0);

      // Now call the existing checkout function
      await initiatePaymentCheckout(
        paymentOrderId,
        participantLookup.participantId
      );

      // If we got here without throwing, payment was successful. Update UI.
      setParticipantLookupEvents((current) =>
        current.map((e) =>
          e.participantEventId === item.participantEventId
            ? { ...e, paymentStatus: "paid" }
            : e
        )
      );

    } catch (error) {
      console.error("Recovery error:", error);
      setErrorMessage(
        error instanceof Error ? error.message : "Recovery could not be processed."
      );
    } finally {
      // payment processing false is handled inside initiatePaymentCheckout usually,
      // but let's ensure it's off if it threw before
      setPaymentProcessing(false);
      setLoading(false);
    }
  }

  /*
   * PAYMENT PROCESSING SCREEN
   */
  if (paymentProcessing) {
    return (
      <section className="px-6 pb-32 md:px-10 md:pb-44">
        <div className="mx-auto max-w-[1200px]">
          <div className="liquid-glass-card relative overflow-hidden flex min-h-[580px] flex-col items-center justify-center rounded-[36px] border border-white/15 bg-gradient-to-b from-[#0c0916]/80 via-[#07050f]/75 to-[#040208]/85 px-6 py-16 text-center text-white backdrop-blur-2xl shadow-[0_30px_100px_rgba(0,0,0,0.95),0_0_70px_rgba(168,85,247,0.18)]">
            {/* Ambient glows */}
            <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-violet-600/25 blur-[120px]" />
            <div className="pointer-events-none absolute -left-24 -bottom-24 h-80 w-80 rounded-full bg-cyan-600/20 blur-[120px]" />

            <div className="relative z-10 mb-8 flex h-16 w-16 items-center justify-center rounded-full border border-violet-500/30 bg-violet-950/40 shadow-[0_0_30px_rgba(168,85,247,0.3)]">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{
                  repeat: Infinity,
                  duration: 1.2,
                  ease: "linear",
                }}
                className="h-6 w-6 rounded-full border-2 border-violet-400/30 border-t-violet-400"
              />
            </div>

            <div className="liquid-glass relative z-10 mb-4 inline-flex items-center gap-2 rounded-full px-4 py-1 text-[10px] font-mono font-semibold uppercase tracking-[0.25em] text-violet-300">
              <Sparkles size={11} className="animate-spin" />
              <span>SECURE PAYMENT INITIALIZATION</span>
            </div>

            <h2 className="relative z-10 max-w-[700px] text-[clamp(2.5rem,5vw,4.5rem)] font-light leading-tight tracking-tight text-white">
              Almost <span className="font-editorial text-violet-300 font-normal italic">there.</span>
            </h2>

            <p className="relative z-10 mt-4 max-w-md text-sm leading-relaxed text-zinc-300 md:text-base">
              Please complete your registration in the checkout window.
              Keep this browser tab open while processing completes.
            </p>
          </div>
        </div>
      </section>
    );
  }

  /*
   * PAYMENT PENDING SCREEN
   *
   * Shown when the user closed the checkout overlay without
   * completing payment. Allows retrying.
   */
  if (paymentPending && pendingPaymentOrderId) {
    return (
      <section className="px-6 pb-32 md:px-10 md:pb-44">
        <div className="mx-auto max-w-[1200px]">
          <div className="liquid-glass-card relative overflow-hidden flex min-h-[580px] flex-col items-center justify-center rounded-[36px] border border-amber-500/35 bg-gradient-to-b from-[#140e06]/80 via-[#090605]/75 to-[#040208]/85 px-6 py-16 text-center text-white backdrop-blur-2xl shadow-[0_30px_100px_rgba(0,0,0,0.95),0_0_70px_rgba(245,158,11,0.18)]">
            {/* Ambient glows */}
            <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-amber-600/20 blur-[120px]" />
            <div className="pointer-events-none absolute -left-24 -bottom-24 h-80 w-80 rounded-full bg-violet-600/20 blur-[120px]" />

            <div className="relative z-10 mb-8 flex h-16 w-16 items-center justify-center rounded-full border border-amber-500/30 bg-amber-950/40 text-amber-400 shadow-[0_0_30px_rgba(245,158,11,0.25)]">
              <AlertCircle size={26} />
            </div>

            <div className="liquid-glass relative z-10 mb-4 inline-flex items-center gap-2 rounded-full px-4 py-1 text-[10px] font-mono font-semibold uppercase tracking-[0.25em] text-amber-300">
              <span>ACTION REQUIRED</span>
            </div>

            <h2 className="relative z-10 max-w-[700px] text-[clamp(2.5rem,5vw,4.5rem)] font-light leading-tight tracking-tight text-white">
              Payment <span className="font-editorial text-amber-300 font-normal italic">pending.</span>
            </h2>

            <p className="relative z-10 mt-4 max-w-md text-sm leading-relaxed text-zinc-300 md:text-base">
              Your registration slot was saved, but the fee of{" "}
              <span className="font-mono font-bold text-white">
                ₹{pendingPaymentAmount.toLocaleString("en-IN")}
              </span>{" "}
              was not completed. You can resume and retry right now.
            </p>

            {errorMessage && (
              <div className="relative z-10 mt-6 flex items-center gap-2.5 rounded-xl border border-red-500/30 bg-red-950/30 px-5 py-3 text-sm text-red-300">
                <AlertCircle size={15} />
                <span>{errorMessage}</span>
              </div>
            )}

            {participantId && (
              <div className="relative z-10 mt-6 rounded-2xl border border-white/12 bg-white/[0.04] px-6 py-4 backdrop-blur-md">
                <p className="mb-1 text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">
                  Your Participant ID
                </p>
                <p className="break-all font-mono text-sm font-semibold text-violet-300 md:text-base">
                  {participantId}
                </p>
                <p className="mt-2 text-[11px] text-zinc-400">
                  Save this ID. If your network blocks online checkout, support can verify your fee using this ID at{" "}
                  <a href="mailto:support@saviskar.co.in" className="text-violet-300 underline underline-offset-2">
                    support@saviskar.co.in
                  </a>
                  .
                </p>
              </div>
            )}

            <div className="relative z-10 mt-8 flex flex-wrap items-center justify-center gap-4">
              <button
                type="button"
                disabled={paymentProcessing}
                onClick={async () => {
                  setErrorMessage("");
                  setPaymentPending(false);
                  await initiatePaymentCheckout(
                    pendingPaymentOrderId,
                    participantId
                  );
                }}
                className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-black transition-all hover:scale-105 hover:bg-violet-100 shadow-[0_10px_25px_rgba(255,255,255,0.25)] disabled:opacity-50"
              >
                <CreditCard size={15} />
                <span>{paymentProcessing ? "Opening checkout..." : "Retry Payment Now"}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setPaymentPending(false);
                  setPendingPaymentOrderId("");
                  setPendingPaymentAmount(0);
                  setParticipantId("");
                  setTeamMembers([]);
                  setQrCode("");
                  setErrorMessage("");
                }}
                className="liquid-glass inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-sm font-medium text-white/80 transition-all hover:bg-white/10 hover:text-white"
              >
                <span>Start a new registration</span>
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  /*
   * CONFIRMATION SCREEN
   */
  if (submitted) {
    return (
      <section className="px-6 pb-32 md:px-10 md:pb-44">
        <div className="mx-auto max-w-[1200px]">
          <div className="liquid-glass-card relative overflow-hidden flex min-h-[650px] flex-col items-center justify-center rounded-[36px] border border-violet-500/35 bg-gradient-to-b from-violet-950/45 via-[#080512]/75 to-[#040208]/85 px-6 py-16 text-center text-white backdrop-blur-2xl shadow-[0_30px_100px_rgba(0,0,0,0.95),0_0_80px_rgba(168,85,247,0.22)]">
            {/* Ambient glows */}
            <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-violet-600/30 blur-[130px]" />
            <div className="pointer-events-none absolute -left-24 -bottom-24 h-96 w-96 rounded-full bg-cyan-600/20 blur-[130px]" />

            <div className="relative z-10 mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-white text-black shadow-[0_0_30px_rgba(255,255,255,0.4)]">
              <Check size={26} />
            </div>

            <div className="liquid-glass relative z-10 mb-4 inline-flex items-center gap-2 rounded-full px-4 py-1 text-[10px] font-mono font-semibold uppercase tracking-[0.25em] text-violet-300">
              <Sparkles size={12} className="text-violet-300" />
              <span>REGISTRATION CONFIRMED // SAVISKAR 2026</span>
            </div>

            <h2 className="relative z-10 max-w-[800px] text-[clamp(3rem,7vw,6.5rem)] font-light leading-[0.88] tracking-tight text-white">
              You&apos;re <span className="font-editorial text-violet-300 font-normal italic">in.</span>
            </h2>

            <p className="relative z-10 mt-4 max-w-md text-sm leading-relaxed text-zinc-300 md:text-base">
              Your Saviskar 2026 registration has been successfully verified and entered into the championship roster.
            </p>

            {qrCode && (
              <div className="relative z-10 mt-8 flex flex-col items-center">
                <div className="rounded-[28px] bg-white p-5 shadow-[0_20px_50px_rgba(0,0,0,0.8)] border border-white/20">
                  <Image
                    src={qrCode}
                    alt="Official Entry QR Code"
                    width={230}
                    height={230}
                    className="h-[200px] w-[200px] md:h-[230px] md:w-[230px]"
                    unoptimized
                  />
                </div>

                <div className="mt-4 flex items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-violet-300">
                  <QrCode size={14} />
                  <span>OFFICIAL DIGITAL ENTRY PASS</span>
                </div>
              </div>
            )}

            {participantId && (
              <div className="relative z-10 mt-6 rounded-2xl border border-violet-500/30 bg-violet-950/40 px-6 py-4 shadow-[0_0_20px_rgba(168,85,247,0.15)]">
                <p className="mb-1 text-[10px] font-mono uppercase tracking-[0.2em] text-white/50">
                  Permanent Participant ID
                </p>
                <p className="break-all font-mono text-sm font-bold text-white md:text-base">
                  {participantId}
                </p>
              </div>
            )}

            {teamMembers.length > 0 && (
              <div className="relative z-10 mt-6 w-full max-w-xl rounded-2xl border border-white/12 bg-white/[0.03] p-5 text-left backdrop-blur-md">
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-violet-300 font-semibold mb-3">
                  Squad Participant IDs
                </p>

                <div className="space-y-2.5">
                  {teamMembers.map((member) => (
                    <div
                      key={member.participantId}
                      className="flex flex-col gap-1 rounded-xl border border-white/10 bg-black/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="text-sm font-medium text-white">
                          {member.name}
                          {member.isTeamHead ? (
                            <span className="ml-2 rounded-full border border-violet-500/30 bg-violet-950/50 px-2 py-0.5 text-[9px] font-mono text-violet-300 uppercase">
                              Team Head
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-white/45">
                          {member.email}
                        </p>
                      </div>

                      <p className="font-mono text-xs font-semibold text-white/80">
                        {member.participantId}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="relative z-10 mt-6 max-w-md text-xs leading-relaxed text-white/40">
              Present this QR code on your phone at the festival accreditation desks upon arrival at CGC University Mohali.
            </p>

            <div className="relative z-10 mt-8 flex flex-wrap items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => {
                  setSubmitted(false);
                  setParticipantId("");
                  setQrCode("");
                  setErrorMessage("");
                }}
                className="liquid-glass inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium text-white transition-all hover:bg-white/10 hover:border-violet-400"
              >
                <span>Register another participant</span>
              </button>

              {fromAdmin && (
                <button
                  type="button"
                  onClick={() => router.push("/admin")}
                  className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-all hover:bg-violet-100"
                >
                  <span>← Back to Admin Panel</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  /*
   * MAIN FORM
   */
  return (
    <section className="px-5 pb-32 md:px-10 md:pb-44">
      <div className="mx-auto max-w-[1240px]">
        <div className="liquid-glass-card relative overflow-hidden rounded-[32px] sm:rounded-[44px] border border-white/15 bg-gradient-to-b from-[#0c0916]/80 via-[#07050f]/75 to-[#040208]/85 p-6 sm:p-10 md:p-14 lg:p-16 backdrop-blur-2xl shadow-[0_30px_100px_rgba(0,0,0,0.95),0_0_80px_rgba(168,85,247,0.16)]">
          {/* Ambient stage backlights blending with festival canopy */}
          <div className="pointer-events-none absolute -right-32 -top-32 h-[600px] w-[600px] rounded-full bg-violet-600/20 blur-[180px]" />
          <div className="pointer-events-none absolute -left-32 top-1/3 h-[550px] w-[550px] rounded-full bg-cyan-600/15 blur-[170px]" />
          <div className="pointer-events-none absolute right-10 bottom-20 h-[500px] w-[500px] rounded-full bg-fuchsia-600/15 blur-[170px]" />

          {/* Subtle celestial grid texture that fades in */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_70%_50%_at_50%_0%,#000_70%,transparent_100%)]" />

          {/* Soft specular top-rim lighting */}
          <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 h-px w-3/4 bg-gradient-to-r from-transparent via-violet-400/50 to-transparent" />

          {/* Form Header */}
          <div className="relative z-10 mb-12 border-b border-white/10 pb-10">
            <div className="liquid-glass mb-4 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[10px] sm:text-[11px] font-mono font-semibold uppercase tracking-[0.25em] text-violet-300 shadow-[0_0_20px_rgba(168,85,247,0.2)]">
              <Sparkles size={12} className="text-violet-300 animate-spin" />
              <span>OFFICIAL DELEGATE ENTRY FORM</span>
            </div>

            <h2 className="text-3xl sm:text-5xl lg:text-6xl font-light tracking-tight text-white">
              Tell us about <span className="font-editorial text-violet-300 font-normal italic">yourself.</span>
            </h2>

            <p className="mt-4 max-w-2xl text-sm sm:text-base leading-relaxed text-zinc-300 font-normal">
              Select one or more competitive realms. You only need to register once — your verified Saviskar Participant ID remains linked across all your solo and team competitions.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="relative z-10 space-y-12">
            <datalist id="indian-states">
              {INDIAN_STATES_AND_UT.map((state) => (
                <option key={state} value={state} />
              ))}
            </datalist>
            {/* VERIFIED SESSION BANNER */}
            {normalizedSessionEmail && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-500/30 bg-violet-950/30 px-5 py-3.5 backdrop-blur-xl">
                <div className="flex items-center gap-2.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs text-white/60">Verified Registration Session:</span>
                  <span className="font-mono text-xs font-semibold text-violet-300">
                    {normalizedSessionEmail}
                  </span>
                </div>
                {onSignOut && (
                  <button
                    type="button"
                    onClick={onSignOut}
                    className="text-xs font-medium text-violet-400 hover:text-violet-200 transition-colors underline"
                  >
                    Switch Account
                  </button>
                )}
              </div>
            )}

            {/* EXISTING PARTICIPANT ID (ACCREDITATION SYNC) */}
            <div className="rounded-[24px] border border-white/12 bg-gradient-to-b from-white/[0.04] to-white/[0.015] p-6 md:p-8 backdrop-blur-xl transition-all hover:border-violet-500/30 shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)]">
              <div className="flex items-start gap-4 sm:gap-5">
                <div className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-violet-500/30 bg-violet-950/40 text-violet-300 shadow-[0_0_20px_rgba(168,85,247,0.2)]">
                  <Users size={19} />
                </div>

                <div className="w-full min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">
                      Already Registered?
                    </span>
                    <span className="text-white/20">•</span>
                    <span className="text-xs text-white/50">
                      Accreditation Sync
                    </span>
                  </div>

                  <h3 className="mt-1.5 text-lg sm:text-xl font-medium tracking-tight text-white">
                    Add another competition to your Participant ID.
                  </h3>

                  <p className="mt-1 text-xs sm:text-sm text-white/60">
                    If this is your first event registration at Saviskar 2026, leave this section blank and proceed below.
                  </p>

                  <div className="mt-6 flex flex-col gap-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                      <div>
                        <label className="mb-2 block font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">
                          Participant ID
                        </label>
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
                          className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3.5 font-mono text-sm uppercase text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">
                          Registered Email
                        </label>
                        <input
                          type="email"
                          value={existingParticipantEmail}
                          onChange={(e) => {
                            setExistingParticipantEmail(e.target.value);
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
                          readOnly={Boolean(normalizedSessionEmail)}
                          placeholder="name@example.com"
                          className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3.5 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40 read-only:opacity-80"
                        />
                        {normalizedSessionEmail && (
                          <p className="mt-1 font-mono text-[10px] text-white/40">
                            Locked to verified email session.
                          </p>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => void findParticipant()}
                        disabled={participantLookupLoading || !existingParticipantId.trim() || !(existingParticipantEmail || normalizedSessionEmail).trim()}
                        className="inline-flex h-[48px] items-center justify-center gap-2 rounded-xl bg-white px-6 text-xs font-semibold text-black transition-all hover:bg-violet-100 hover:scale-[1.02] shadow-[0_0_20px_rgba(255,255,255,0.25)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {participantLookupLoading ? (
                          <>
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" />
                            <span>Verifying</span>
                          </>
                        ) : (
                          <>
                            <span>Find Participant</span>
                            <ArrowRight size={14} />
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {participantLookup && (
                    <div className="mt-5 rounded-2xl border border-emerald-500/30 bg-emerald-950/30 p-5 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(52,211,153,0.15)]">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400 text-black shadow-[0_0_10px_#34d399]">
                              <Check size={12} />
                            </span>
                            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">
                              Participant Verified
                            </p>
                          </div>
                          <h4 className="mt-2 text-lg font-semibold text-white">
                            {participantLookup.name}
                          </h4>
                          <p className="mt-0.5 text-xs text-white/60">
                            {participantLookup.email}
                          </p>
                        </div>
                        <p className="font-mono text-xs font-semibold text-emerald-300/90 rounded-full border border-emerald-500/20 bg-emerald-950/40 px-3 py-1 self-start sm:self-auto">
                          {participantLookup.participantId}
                        </p>
                      </div>

                      <div className="mt-5 border-t border-white/10 pt-4">
                        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40 mb-3">
                          Current Registered Events
                        </p>

                        {participantLookupEvents.length === 0 ? (
                          <p className="text-xs text-white/50">
                            No active event registrations currently tied to this ID.
                          </p>
                        ) : (
                          <div className="grid gap-2.5 sm:grid-cols-2">
                            {participantLookupEvents.map((item) => (
                              <div
                                key={item.participantEventId}
                                className="flex flex-col justify-between gap-2 rounded-xl border border-white/10 bg-black/40 p-3.5"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <p className="font-medium text-sm text-white">{item.eventName}</p>
                                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider ${item.paymentStatus === "paid"
                                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                      : item.paymentStatus === "pending"
                                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                        : "bg-white/10 text-white/70 border border-white/10"
                                    }`}>
                                    {item.paymentStatus ? item.paymentStatus.replace(/_/g, " ") : "FREE"}
                                  </span>
                                </div>

                                {item.paymentAmount ? (
                                  <span className="text-xs font-mono text-white/60">₹{item.paymentAmount}</span>
                                ) : null}

                                {item.paymentStatus === "pending" && (item.paymentAmount || 0) > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => handlePaymentRecovery(item)}
                                    className="mt-1 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black hover:bg-violet-100 transition-all self-start"
                                  >
                                    Complete Payment
                                  </button>
                                )}
                              </div>
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
            <div className="space-y-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-white/10 pb-5">
                <div>
                  <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-300">
                    <Sparkles size={11} />
                    <span>SELECT YOUR COMPETITIONS</span>
                  </div>

                  <h3 className="mt-2 text-2xl sm:text-3xl font-light tracking-tight text-white">
                    What are you <span className="font-editorial text-violet-300 font-normal italic">joining?</span>
                  </h3>

                  <p className="mt-1 text-sm text-zinc-300 font-normal">
                    Search and choose as many competitions across all 4 realms as you want.
                  </p>
                </div>

                <AnimatePresence mode="popLayout">
                  {selectedEvents.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.96 }}
                      className="w-fit rounded-full border border-violet-500/30 bg-violet-950/50 px-4 py-2 font-mono text-xs font-semibold text-violet-300 shadow-[0_0_15px_rgba(168,85,247,0.25)]"
                    >
                      {selectedEvents.length}{" "}
                      {selectedEvents.length === 1 ? "Event" : "Events"} Selected
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {eventsLoading ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-12 text-center text-sm text-white/50 backdrop-blur-md">
                  <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-violet-400 border-t-transparent mb-3" />
                  <p>Loading competitive realms...</p>
                </div>
              ) : (
                <>
                  {participantLookup && (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-white backdrop-blur-md">
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">
                        Add Another Event
                      </p>
                      <p className="mt-1 text-xs sm:text-sm text-white/70">
                        Competitions already registered to this Participant ID are excluded from the list below.
                      </p>
                    </div>
                  )}

                  {/* SEARCH & REALM PILLS */}
                  <div className="rounded-2xl border border-white/12 bg-gradient-to-b from-white/[0.04] to-white/[0.015] p-3 sm:p-4 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
                    <div className="flex items-center gap-3 rounded-xl border border-white/12 bg-black/40 px-4 py-3 focus-within:border-violet-400/60 focus-within:ring-1 focus-within:ring-violet-400/30 focus-within:bg-black/60 transition-all">
                      <Search className="h-4 w-4 shrink-0 text-white/40" />

                      <input
                        type="search"
                        value={eventSearch}
                        onChange={(e) => {
                          setEventSearch(e.target.value);
                          setShowAllEvents(false);
                        }}
                        placeholder="Search competitions (e.g. RoboWars, Hackathon, Dance, AI Expo)..."
                        className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/35 outline-none"
                        aria-label="Search events"
                      />

                      {eventSearch && (
                        <button
                          type="button"
                          onClick={() => {
                            setEventSearch("");
                            setShowAllEvents(false);
                          }}
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-white/60 transition hover:bg-white/20 hover:text-white"
                          aria-label="Clear event search"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>

                    {/* CATEGORY FILTERS */}
                    <div className="mt-3 flex gap-2 overflow-x-auto px-0.5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {eventCategories.map((category) => {
                        const active = eventCategory === category;

                        return (
                          <button
                            key={category}
                            type="button"
                            onClick={() => {
                              setEventCategory(category);
                              setShowAllEvents(false);
                            }}
                            className={`shrink-0 rounded-full px-4 py-2 text-xs font-medium tracking-wide transition-all ${active
                                ? "bg-white text-black font-semibold shadow-[0_0_15px_rgba(255,255,255,0.35)]"
                                : "border border-white/10 bg-white/[0.03] text-white/70 hover:border-white/20 hover:bg-white/10 hover:text-white"
                              }`}
                          >
                            {category}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* SELECTED EVENTS DRAWER */}
                  <AnimatePresence initial={false}>
                    {selectedEvents.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="rounded-2xl border border-violet-500/35 bg-gradient-to-br from-violet-950/40 via-[#0a0714]/70 to-[#05030a]/85 p-5 md:p-6 backdrop-blur-2xl shadow-[0_0_45px_rgba(168,85,247,0.18),inset_0_1px_1px_rgba(255,255,255,0.12)]">
                          <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
                            <div>
                              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">
                                Chosen Competitions
                              </p>
                              <p className="text-xs text-white/60">
                                Details for these will be configured below.
                              </p>
                            </div>

                            <p className="font-mono text-sm font-bold text-violet-300">
                              {totalPrice > 0
                                ? `Total: ₹${totalPrice.toLocaleString("en-IN")}`
                                : "Total: Free"}
                            </p>
                          </div>

                          <div className="mt-3 divide-y divide-white/10">
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
                                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-400 text-black shadow-[0_0_10px_#c084fc]">
                                    <Check size={13} />
                                  </div>

                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-white">
                                      {event.name}
                                    </p>
                                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
                                      {event.category}
                                      {isTeam ? " · Team" : " · Solo"}
                                    </p>
                                  </div>

                                  <span className="shrink-0 font-mono text-xs font-medium text-violet-200">
                                    {amount > 0
                                      ? `₹${amount.toLocaleString("en-IN")}`
                                      : "Free"}
                                  </span>

                                  <button
                                    type="button"
                                    onClick={() => removeSelectedEvent(event.id)}
                                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/40 transition hover:bg-red-500/20 hover:text-red-400"
                                    aria-label={`Remove ${event.name}`}
                                  >
                                    <X size={13} />
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
                  <div className="overflow-hidden rounded-2xl border border-white/12 bg-gradient-to-b from-white/[0.03] to-black/40 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
                    <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-5 py-3.5">
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">
                        {filteredEvents.length}{" "}
                        {filteredEvents.length === 1 ? "competition" : "competitions"} available
                      </p>

                      {eventSearch || eventCategory !== "All" ? (
                        <button
                          type="button"
                          onClick={() => {
                            setEventSearch("");
                            setEventCategory("All");
                            setShowAllEvents(false);
                          }}
                          className="font-mono text-[10px] font-medium text-violet-300 underline-offset-4 hover:underline"
                        >
                          Reset filters
                        </button>
                      ) : null}
                    </div>

                    {filteredEvents.length === 0 ? (
                      <div className="px-6 py-14 text-center">
                        <p className="text-sm font-medium text-white">No competitions found.</p>
                        <p className="mt-1 text-xs text-white/40">
                          Try searching for keywords like &quot;Robotics&quot;, &quot;Dance&quot;, &quot;Hackathon&quot;, or change the realm filter.
                        </p>
                      </div>
                    ) : (
                      <>
                        <div
                          id="available-events-list"
                          className="divide-y divide-white/[0.06]"
                        >
                          <AnimatePresence initial={false}>
                            {visibleEvents.map((event, index) => {
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
                                  exit={{ opacity: 0, height: 0, overflow: "hidden" }}
                                  transition={{
                                    duration: 0.2,
                                    delay: Math.min(index * 0.015, 0.15),
                                  }}
                                  key={event.id}
                                  type="button"
                                  onClick={() => toggleEvent(event.id)}
                                  className={`group flex w-full items-center gap-4 px-5 py-4 text-left transition-all ${selected
                                      ? "bg-violet-950/35 border-l-4 border-l-violet-400 hover:bg-violet-950/45 shadow-[inset_0_0_30px_rgba(168,85,247,0.08)]"
                                      : "border-l-4 border-l-transparent hover:bg-white/[0.04]"
                                    }`}
                                >
                                  {/* CHECK */}
                                  <div
                                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all ${selected
                                        ? "bg-violet-400 text-black shadow-[0_0_12px_#c084fc]"
                                        : "border border-white/20 text-transparent group-hover:border-white/40"
                                      }`}
                                  >
                                    <Check size={13} />
                                  </div>

                                  {/* NAME */}
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                                      <h4 className="truncate text-[15px] font-medium tracking-tight text-white md:text-base">
                                        {event.name}
                                      </h4>

                                      <span
                                        className={`rounded-full px-2.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider border border-white/10 ${selected
                                            ? "bg-violet-500/20 text-violet-300 border-violet-500/30"
                                            : "bg-white/[0.04] text-white/50"
                                          }`}
                                      >
                                        {event.category}
                                      </span>
                                    </div>

                                    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-white/45">
                                      <span>
                                        {team ? "Team Event" : "Individual Event"}
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
                                  <div className="hidden shrink-0 text-right sm:block font-mono">
                                    <p className="text-[9px] uppercase tracking-wider text-white/40">
                                      Fee
                                    </p>
                                    <p className={`mt-0.5 text-xs font-semibold ${fee > 0 ? "text-white" : "text-emerald-400"}`}>
                                      {fee > 0
                                        ? `₹${fee.toLocaleString("en-IN")}`
                                        : "FREE"}
                                    </p>
                                  </div>

                                  <ArrowRight
                                    size={14}
                                    className={`shrink-0 transition-transform ${selected
                                        ? "text-violet-300"
                                        : "text-white/20 group-hover:translate-x-1 group-hover:text-white/60"
                                      }`}
                                  />
                                </motion.button>
                              );
                            })}
                          </AnimatePresence>
                        </div>

                        {/* VIEW ALL / SHOW LESS — when >3 events */}
                        {filteredEvents.length > 3 && (
                          <div className="border-t border-white/[0.06]">
                            <button
                              type="button"
                              onClick={() => setShowAllEvents((prev) => !prev)}
                              aria-expanded={showAllEvents}
                              aria-controls="available-events-list"
                              className="group flex w-full items-center justify-center gap-2 px-5 py-3.5 text-sm font-medium text-violet-300 transition-all hover:bg-white/[0.04] hover:text-violet-200"
                            >
                              {showAllEvents ? (
                                <>
                                  <ChevronDown size={15} className="rotate-180 transition-transform" />
                                  <span>Show less</span>
                                </>
                              ) : (
                                <>
                                  <Plus size={14} />
                                  <span>
                                    View all {filteredEvents.length}{" "}
                                    {filteredEvents.length === 1
                                      ? "competition"
                                      : "competitions"}
                                  </span>
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* SELECTED EVENT CONFIGURATION */}
            {selectedEvents.length > 0 && (
              <div className="space-y-8 border-t border-white/10 pt-12">
                <div>
                  <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-300">
                    <Sparkles size={11} />
                    <span>EVENT CONFIGURATION</span>
                  </div>

                  <h3 className="mt-2 text-2xl sm:text-3xl font-light tracking-tight text-white">
                    Complete your <span className="font-editorial text-violet-300 font-normal italic">selections.</span>
                  </h3>
                </div>

                {selectedEvents.map((event, eventIndex) => {
                  const team = isTeamEvent(event);
                  const state = getTeamState(event.id);

                  return (
                    <div
                      key={event.id}
                      className="rounded-[28px] border border-white/12 bg-gradient-to-b from-white/[0.04] to-white/[0.015] p-6 md:p-8 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)]"
                    >
                      {/* EVENT HEADER */}
                      <div className="flex items-start justify-between gap-6 border-b border-white/10 pb-6">
                        <div>
                          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">
                            Competition {String(eventIndex + 1).padStart(2, "0")}
                          </p>

                          <h4 className="mt-2 text-2xl md:text-3xl font-light text-white">
                            {event.name}
                          </h4>

                          <p className="mt-1 text-xs sm:text-sm text-white/60">
                            {team
                              ? "Specify squad name and teammate roster below."
                              : "Solo competition — personal accreditation details below apply."}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeSelectedEvent(event.id)}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 text-white/40 transition hover:border-red-400/40 hover:bg-red-500/20 hover:text-red-400"
                          aria-label={`Remove ${event.name}`}
                        >
                          <X size={15} />
                        </button>
                      </div>

                      {/* TEAM EVENT CONFIGURATION */}
                      {team && (
                        <div className="mt-8 space-y-8">
                          <Field label="Squad / Team Name">
                            <input
                              type="text"
                              value={state.teamName}
                              onChange={(e) => updateTeamName(event.id, e.target.value)}
                              placeholder="e.g. CyberVanguard CGC"
                              required
                              className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3.5 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40"
                            />
                          </Field>

                          {event.id === firstTeamEventId && (
                            <div className="rounded-2xl border border-white/12 bg-black/40 p-6 md:p-8 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
                              <div className="mb-6 border-b border-white/10 pb-4">
                                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">
                                  Member 01 — Lead Participant Details
                                </p>

                                <h5 className="mt-1 text-lg font-medium text-white">
                                  Your Personal Details
                                </h5>

                                <p className="mt-1 text-xs text-white/60">
                                  You are Member 01 and the primary delegate for this squad. These details anchor your official pass.
                                </p>
                              </div>

                              <div className="grid gap-6 md:grid-cols-2">
                                <Field label="Full Name">
                                  <input
                                    key={`team-name-${participantLookup?.participantId ?? "new"}`}
                                    type="text"
                                    name="name"
                                    defaultValue={participantLookup?.name ?? ""}
                                    placeholder="Your full name"
                                    required
                                    minLength={2}
                                    readOnly={Boolean(participantLookup)}
                                    className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3.5 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40 read-only:opacity-60"
                                  />
                                </Field>

                                <Field label="College / University">
                                  <input
                                    key={`team-college-${participantLookup?.participantId ?? "new"}`}
                                    type="text"
                                    name="college"
                                    defaultValue={participantLookup?.college ?? ""}
                                    placeholder="e.g. CGC University Mohali"
                                    required
                                    minLength={2}
                                    readOnly={Boolean(participantLookup)}
                                    className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3.5 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40 read-only:opacity-60"
                                  />
                                </Field>

                                <Field label="Email Address">
                                  <input
                                    key={`team-email-${participantLookup?.participantId ?? "new"}`}
                                    type="email"
                                    name="email"
                                    defaultValue={normalizedSessionEmail || participantLookup?.email || ""}
                                    placeholder="you@example.com"
                                    required
                                    readOnly={Boolean(normalizedSessionEmail || participantLookup)}
                                    className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3.5 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40 read-only:opacity-60"
                                  />
                                </Field>

                                <Field label="Phone / WhatsApp Number">
                                  <input
                                    key={`team-phone-${participantLookup?.participantId ?? "new"}`}
                                    type="tel"
                                    name="phone"
                                    defaultValue={participantLookup?.phone ?? ""}
                                    placeholder="+91 98765 43210"
                                    required
                                    pattern="[0-9+\-\s]{10,18}"
                                    readOnly={Boolean(participantLookup)}
                                    className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3.5 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40 read-only:opacity-60"
                                  />
                                </Field>
                              </div>

                              <div className="mt-6 grid gap-6 md:grid-cols-2">
                                <Field label="Gender">
                                  <div className="flex gap-5 px-1 py-3.5 text-sm text-white">
                                    <label className="flex items-center gap-2 cursor-pointer transition hover:text-violet-300">
                                      <input type="radio" name="gender" value="Male" className="accent-violet-500 scale-110 cursor-pointer" required /> Male
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer transition hover:text-violet-300">
                                      <input type="radio" name="gender" value="Female" className="accent-violet-500 scale-110 cursor-pointer" required /> Female
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer transition hover:text-violet-300">
                                      <input type="radio" name="gender" value="Other" className="accent-violet-500 scale-110 cursor-pointer" required /> Other
                                    </label>
                                  </div>
                                </Field>

                                <Field label="State / UT">
                                  <input
                                    type="text"
                                    name="state"
                                    list="indian-states"
                                    placeholder="Select State"
                                    required
                                    autoComplete="off"
                                    className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3.5 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40"
                                  />
                                </Field>
                              </div>

                              <div className="mt-6">
                                <ImageUploader
                                  label="Your Official ID Card (College/University)"
                                  existingPath={mainIdCardStoragePath}
                                  onUploadSuccess={setMainIdCardStoragePath}
                                  onRemove={() => setMainIdCardStoragePath("")}
                                />
                              </div>

                              {accommodationPlans.length > 0 && (
                                <div className="mt-6">
                                  <Field label="Accommodation (Optional)">
                                    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                                      <label className="relative flex cursor-pointer flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-all hover:border-violet-400/40 has-[:checked]:border-violet-500 has-[:checked]:bg-violet-500/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)]">
                                        <input
                                          type="radio"
                                          name="accommodationPlanSlug"
                                          value=""
                                          checked={!mainAccommodationSlug}
                                          onChange={(e) => setMainAccommodationSlug(e.target.value)}
                                          className="peer sr-only"
                                        />
                                        <span className="font-medium text-white text-sm">No Accommodation</span>
                                        <span className="font-mono text-xs text-white/50">₹0</span>
                                      </label>
                                      {accommodationPlans.map((plan) => (
                                        <label key={plan.id} className="relative flex cursor-pointer flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-all hover:border-violet-400/40 has-[:checked]:border-violet-500 has-[:checked]:bg-violet-500/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)]">
                                          <input
                                            type="radio"
                                            name="accommodationPlanSlug"
                                            value={plan.slug}
                                            checked={mainAccommodationSlug === plan.slug}
                                            onChange={(e) => setMainAccommodationSlug(e.target.value)}
                                            className="peer sr-only"
                                          />
                                          <span className="font-medium text-white text-sm leading-tight">{plan.name}</span>
                                          <span className="font-mono text-xs font-semibold text-emerald-400">₹{plan.price}</span>
                                          <span className="text-[10px] font-mono text-white/40 mt-1">{formatAccommodationDate(plan.duration)}</span>
                                        </label>
                                      ))}
                                    </div>
                                  </Field>
                                </div>
                              )}

                              <div className="mt-6 border-t border-white/10 pt-5">
                                <label
                                  htmlFor={`team-head-${event.id}`}
                                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-violet-400/40"
                                >
                                  <input
                                    id={`team-head-${event.id}`}
                                    type="checkbox"
                                    checked={state.isTeamHead}
                                    onChange={(e) => updateTeamHead(event.id, e.target.checked)}
                                    className="mt-0.5 h-4 w-4 cursor-pointer accent-violet-500"
                                  />

                                  <div>
                                    <span className="block text-sm font-medium text-white">
                                      I am the Team Head / Squad Captain
                                    </span>
                                    <span className="mt-0.5 block text-xs text-white/50">
                                      Select this if you are leading and representing this squad at Saviskar 2026.
                                    </span>
                                  </div>
                                </label>
                              </div>
                            </div>
                          )}

                          {/* SQUAD MEMBERS LIST */}
                          <div className="border-t border-white/10 pt-6">
                            <div className="flex items-end justify-between gap-4">
                              <div>
                                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-300">
                                  Team Members
                                </p>

                                <h5 className="mt-1 text-lg font-medium text-white">
                                  Add your teammates.
                                </h5>

                                <p className="mt-0.5 text-xs text-white/50">
                                  Fill in the verified contact details of remaining squad members.
                                </p>
                              </div>

                              {event.max_team_size && (
                                <span className="font-mono text-xs text-violet-300 rounded-full border border-violet-500/30 bg-violet-950/40 px-3 py-1">
                                  {state.members.length + 1} / {event.max_team_size} Members
                                </span>
                              )}
                            </div>

                            <div className="mt-5 space-y-4">
                              {state.members.map((member, index) => (
                                <div
                                  key={index}
                                  className="rounded-2xl border border-white/12 bg-black/40 p-5 md:p-6 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]"
                                >
                                  <div className="mb-5 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-xs font-semibold text-violet-300">
                                        Member 0{index + 2}
                                      </span>
                                      {event.min_team_size && state.members.length <= event.min_team_size - 1 ? (
                                        <span className="rounded-full border border-amber-500/30 bg-amber-950/30 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-amber-300">
                                          Required
                                        </span>
                                      ) : null}
                                    </div>

                                    {!(event.min_team_size && state.members.length <= event.min_team_size - 1) && (
                                      <button
                                        type="button"
                                        onClick={() => removeTeamMember(event.id, index)}
                                        className="flex h-8 w-8 items-center justify-center rounded-full border border-red-500/20 text-red-400 transition hover:bg-red-500/20"
                                        aria-label="Remove team member"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    )}
                                  </div>

                                  <div className="grid gap-5 md:grid-cols-3">
                                    <Field label="Member Full Name">
                                      <input
                                        type="text"
                                        value={member.name}
                                        onChange={(e) => updateTeamMember(event.id, index, "name", e.target.value)}
                                        placeholder="Full name"
                                        required
                                        className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40"
                                      />
                                    </Field>

                                    <Field label="Member Email">
                                      <input
                                        type="email"
                                        value={member.email}
                                        onChange={(e) => updateTeamMember(event.id, index, "email", e.target.value)}
                                        placeholder="member@example.com"
                                        required
                                        className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40"
                                      />
                                    </Field>

                                    <Field label="Member Phone">
                                      <input
                                        type="tel"
                                        value={member.phone}
                                        onChange={(e) => updateTeamMember(event.id, index, "phone", e.target.value)}
                                        placeholder="+91 98765 43210"
                                        required
                                        className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40"
                                      />
                                    </Field>
                                  </div>

                                  <div className="mt-5 grid gap-5 md:grid-cols-2">
                                    <Field label="Member Gender">
                                      <div className="flex gap-5 px-1 py-3 text-sm text-white">
                                        <label className="flex items-center gap-2 cursor-pointer transition hover:text-violet-300">
                                          <input 
                                            type="radio" 
                                            name={`gender-${event.id}-${index}`} 
                                            value="Male" 
                                            checked={member.gender === "Male"}
                                            onChange={(e) => updateTeamMember(event.id, index, "gender", e.target.value)}
                                            className="accent-violet-500 scale-110 cursor-pointer" 
                                            required 
                                          /> Male
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer transition hover:text-violet-300">
                                          <input 
                                            type="radio" 
                                            name={`gender-${event.id}-${index}`} 
                                            value="Female" 
                                            checked={member.gender === "Female"}
                                            onChange={(e) => updateTeamMember(event.id, index, "gender", e.target.value)}
                                            className="accent-violet-500 scale-110 cursor-pointer" 
                                            required 
                                          /> Female
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer transition hover:text-violet-300">
                                          <input 
                                            type="radio" 
                                            name={`gender-${event.id}-${index}`} 
                                            value="Other" 
                                            checked={member.gender === "Other"}
                                            onChange={(e) => updateTeamMember(event.id, index, "gender", e.target.value)}
                                            className="accent-violet-500 scale-110 cursor-pointer" 
                                            required 
                                          /> Other
                                        </label>
                                      </div>
                                    </Field>

                                    <Field label="Member State / UT">
                                      <input
                                        type="text"
                                        value={member.state}
                                        onChange={(e) => updateTeamMember(event.id, index, "state", e.target.value)}
                                        list="indian-states"
                                        placeholder="Select State"
                                        required
                                        autoComplete="off"
                                        className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40"
                                      />
                                    </Field>
                                  </div>

                                  <div className="mt-5">
                                    <ImageUploader
                                      label={`Member 0${index + 2} Official ID Card`}
                                      existingPath={member.idCardStoragePath}
                                      onUploadSuccess={(path) => updateTeamMember(event.id, index, "idCardStoragePath", path)}
                                      onRemove={() => updateTeamMember(event.id, index, "idCardStoragePath", "")}
                                    />
                                  </div>

                                  {accommodationPlans.length > 0 && (
                                    <div className="mt-5">
                                      <Field label="Member Accommodation (Optional)">
                                        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                                          <label className="relative flex cursor-pointer flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-all hover:border-violet-400/40 has-[:checked]:border-violet-500 has-[:checked]:bg-violet-500/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)]">
                                            <input
                                              type="radio"
                                              name={`accommodationPlanSlug-${event.id}-${index}`}
                                              value=""
                                              checked={!member.accommodationPlanSlug}
                                              onChange={(e) => updateTeamMember(event.id, index, "accommodationPlanSlug", e.target.value)}
                                              className="peer sr-only"
                                            />
                                            <span className="font-medium text-white text-sm">No Accommodation</span>
                                            <span className="font-mono text-xs text-white/50">₹0</span>
                                          </label>
                                          {accommodationPlans.map((plan) => (
                                            <label key={plan.id} className="relative flex cursor-pointer flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-all hover:border-violet-400/40 has-[:checked]:border-violet-500 has-[:checked]:bg-violet-500/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)]">
                                              <input
                                                type="radio"
                                                name={`accommodationPlanSlug-${event.id}-${index}`}
                                                value={plan.slug}
                                                checked={member.accommodationPlanSlug === plan.slug}
                                                onChange={(e) => updateTeamMember(event.id, index, "accommodationPlanSlug", e.target.value)}
                                                className="peer sr-only"
                                              />
                                              <span className="font-medium text-white text-sm leading-tight">{plan.name}</span>
                                              <span className="font-mono text-xs font-semibold text-emerald-400">₹{plan.price}</span>
                                              <span className="text-[10px] font-mono text-white/40 mt-1">{formatAccommodationDate(plan.duration)}</span>
                                            </label>
                                          ))}
                                        </div>
                                      </Field>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>

                            {event.max_team_size && state.members.length + 1 < event.max_team_size && (
                              <button
                                type="button"
                                onClick={() => addTeamMember(event)}
                                className="mt-5 inline-flex items-center gap-2 rounded-full border border-violet-400/40 bg-violet-950/30 px-5 py-2.5 text-xs font-semibold text-violet-200 hover:bg-violet-900/40 hover:border-violet-400 transition-all shadow-[0_0_15px_rgba(168,85,247,0.15)]"
                              >
                                <Plus size={15} />
                                <span>Add Team Member</span>
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

            {/* PERSONAL INFORMATION — shown separately for individual/solo registration. */}
            {!hasTeamEvent && (
              <div className="space-y-6 border-t border-white/10 pt-10">
                <div>
                  <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-300">
                    <Sparkles size={11} />
                    <span>DELEGATE ACCREDITATION</span>
                  </div>

                  <h3 className="mt-2 text-2xl sm:text-3xl font-light tracking-tight text-white">
                    Your <span className="font-editorial text-violet-300 font-normal italic">information.</span>
                  </h3>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <Field label="Full Name">
                    <input
                      key={`name-${participantLookup?.participantId ?? "new"}`}
                      type="text"
                      name="name"
                      defaultValue={participantLookup?.name ?? ""}
                      placeholder="Your full name"
                      required
                      minLength={2}
                      readOnly={Boolean(participantLookup)}
                      className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3.5 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40 read-only:opacity-60"
                    />
                  </Field>

                  <Field label="College / University">
                    <input
                      key={`college-${participantLookup?.participantId ?? "new"}`}
                      type="text"
                      name="college"
                      defaultValue={participantLookup?.college ?? ""}
                      placeholder="e.g. CGC University Mohali"
                      required
                      minLength={2}
                      readOnly={Boolean(participantLookup)}
                      className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3.5 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40 read-only:opacity-60"
                    />
                  </Field>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <Field label="Email Address">
                    <input
                      key={`email-${participantLookup?.participantId ?? "new"}`}
                      type="email"
                      name="email"
                      defaultValue={normalizedSessionEmail || participantLookup?.email || ""}
                      placeholder="you@example.com"
                      required
                      readOnly={Boolean(normalizedSessionEmail || participantLookup)}
                      className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3.5 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40 read-only:opacity-60"
                    />
                  </Field>

                  <Field label="Phone / WhatsApp Number">
                    <input
                      key={`phone-${participantLookup?.participantId ?? "new"}`}
                      type="tel"
                      name="phone"
                      defaultValue={participantLookup?.phone ?? ""}
                      placeholder="+91 98765 43210"
                      required
                      pattern="[0-9+\-\s]{10,18}"
                      readOnly={Boolean(participantLookup)}
                      className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3.5 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40 read-only:opacity-60"
                    />
                  </Field>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <Field label="Gender">
                    <div className="flex gap-5 px-1 py-3.5 text-sm text-white">
                      <label className="flex items-center gap-2 cursor-pointer transition hover:text-violet-300">
                        <input type="radio" name="gender" value="Male" className="accent-violet-500 scale-110 cursor-pointer" required /> Male
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer transition hover:text-violet-300">
                        <input type="radio" name="gender" value="Female" className="accent-violet-500 scale-110 cursor-pointer" required /> Female
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer transition hover:text-violet-300">
                        <input type="radio" name="gender" value="Other" className="accent-violet-500 scale-110 cursor-pointer" required /> Other
                      </label>
                    </div>
                  </Field>

                  <Field label="State / UT">
                    <input
                      type="text"
                      name="state"
                      list="indian-states"
                      placeholder="Select State"
                      required
                      autoComplete="off"
                      className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3.5 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40"
                    />
                  </Field>
                </div>

                <div className="mt-6">
                  <ImageUploader
                    label="Your Official ID Card (College/University)"
                    existingPath={mainIdCardStoragePath}
                    onUploadSuccess={setMainIdCardStoragePath}
                    onRemove={() => setMainIdCardStoragePath("")}
                  />
                </div>

                {accommodationPlans.length > 0 && (
                  <div>
                    <Field label="Accommodation (Optional)">
                      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                        <label className="relative flex cursor-pointer flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-all hover:border-violet-400/40 has-[:checked]:border-violet-500 has-[:checked]:bg-violet-500/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)]">
                          <input
                            type="radio"
                            name="accommodationPlanSlug"
                            value=""
                            checked={!mainAccommodationSlug}
                            onChange={(e) => setMainAccommodationSlug(e.target.value)}
                            className="peer sr-only"
                          />
                          <span className="font-medium text-white text-sm">No Accommodation</span>
                          <span className="font-mono text-xs text-white/50">₹0</span>
                        </label>
                        {accommodationPlans.map((plan) => (
                          <label key={plan.id} className="relative flex cursor-pointer flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-all hover:border-violet-400/40 has-[:checked]:border-violet-500 has-[:checked]:bg-violet-500/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)]">
                            <input
                              type="radio"
                              name="accommodationPlanSlug"
                              value={plan.slug}
                              checked={mainAccommodationSlug === plan.slug}
                              onChange={(e) => setMainAccommodationSlug(e.target.value)}
                              className="peer sr-only"
                            />
                            <span className="font-medium text-white text-sm leading-tight">{plan.name}</span>
                            <span className="font-mono text-xs font-semibold text-emerald-400">₹{plan.price}</span>
                            <span className="text-[10px] font-mono text-white/40 mt-1">{formatAccommodationDate(plan.duration)}</span>
                          </label>
                        ))}
                      </div>
                    </Field>
                  </div>
                )}
              </div>
            )}

            {/* FACULTY INCHARGE (OPTIONAL) */}
            {selectedEvents.length > 0 && (
              <div className="space-y-6 border-t border-white/10 pt-10">
                <div>
                  <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-300">
                    <Sparkles size={11} />
                    <span>FACULTY ACCREDITATION</span>
                  </div>

                  <h3 className="mt-2 text-2xl sm:text-3xl font-light tracking-tight text-white">
                    Faculty <span className="font-editorial text-violet-300 font-normal italic">Incharge.</span>
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm text-white/60">
                    A single faculty member can accompany your team.
                  </p>
                </div>

                <div className="rounded-[28px] border border-white/12 bg-gradient-to-b from-white/[0.04] to-white/[0.015] p-6 md:p-8 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)]">
                  <label
                    htmlFor="faculty-enabled"
                    className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-violet-400/40"
                  >
                    <input
                      id="faculty-enabled"
                      type="checkbox"
                      checked={facultyEnabled}
                      onChange={(e) => setFacultyEnabled(e.target.checked)}
                      className="mt-0.5 h-4 w-4 cursor-pointer accent-violet-500"
                    />
                    <div>
                      <span className="block text-sm font-medium text-white">
                        Add a Faculty Incharge (Optional)
                      </span>
                      <span className="mt-0.5 block text-xs text-white/50">
                        Select this if a faculty member is accompanying your contingent to the event.
                      </span>
                    </div>
                  </label>

                  {facultyEnabled && (
                    <motion.div
                      initial={{ opacity: 0, y: -10, height: 0 }}
                      animate={{ opacity: 1, y: 0, height: "auto" }}
                      className="mt-8 space-y-6 overflow-hidden"
                    >
                      <div className="grid gap-6 md:grid-cols-2">
                        <Field label="Faculty Full Name">
                          <input
                            type="text"
                            value={facultyState.name}
                            onChange={(e) => setFacultyState({ ...facultyState, name: e.target.value })}
                            placeholder="Faculty Name"
                            required={facultyEnabled}
                            className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40"
                          />
                        </Field>

                        <Field label="College / University">
                          <input
                            type="text"
                            value={facultyState.college}
                            onChange={(e) => setFacultyState({ ...facultyState, college: e.target.value })}
                            placeholder="College Name"
                            className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40"
                          />
                        </Field>
                      </div>

                      <div className="grid gap-6 md:grid-cols-2">
                        <Field label="Email Address">
                          <input
                            type="email"
                            value={facultyState.email}
                            onChange={(e) => setFacultyState({ ...facultyState, email: e.target.value })}
                            placeholder="faculty@example.com"
                            required={facultyEnabled}
                            className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40"
                          />
                        </Field>

                        <Field label="Phone Number">
                          <input
                            type="tel"
                            value={facultyState.phone}
                            onChange={(e) => setFacultyState({ ...facultyState, phone: e.target.value })}
                            placeholder="+91 98765 43210"
                            required={facultyEnabled}
                            className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40"
                          />
                        </Field>
                      </div>

                      <div className="grid gap-6 md:grid-cols-2">
                        <Field label="Gender">
                          <div className="flex gap-5 px-1 py-3 text-sm text-white">
                            <label className="flex items-center gap-2 cursor-pointer transition hover:text-violet-300">
                              <input 
                                type="radio" 
                                name="faculty-gender" 
                                value="Male" 
                                checked={facultyState.gender === "Male"}
                                onChange={(e) => setFacultyState({ ...facultyState, gender: e.target.value })}
                                className="accent-violet-500 scale-110 cursor-pointer" 
                                required={facultyEnabled} 
                              /> Male
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer transition hover:text-violet-300">
                              <input 
                                type="radio" 
                                name="faculty-gender" 
                                value="Female" 
                                checked={facultyState.gender === "Female"}
                                onChange={(e) => setFacultyState({ ...facultyState, gender: e.target.value })}
                                className="accent-violet-500 scale-110 cursor-pointer" 
                                required={facultyEnabled} 
                              /> Female
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer transition hover:text-violet-300">
                              <input 
                                type="radio" 
                                name="faculty-gender" 
                                value="Other" 
                                checked={facultyState.gender === "Other"}
                                onChange={(e) => setFacultyState({ ...facultyState, gender: e.target.value })}
                                className="accent-violet-500 scale-110 cursor-pointer" 
                                required={facultyEnabled} 
                              /> Other
                            </label>
                          </div>
                        </Field>

                        <Field label="State / UT">
                          <input
                            type="text"
                            value={facultyState.state}
                            onChange={(e) => setFacultyState({ ...facultyState, state: e.target.value })}
                            list="indian-states"
                            placeholder="Select State"
                            required={facultyEnabled}
                            autoComplete="off"
                            className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40"
                          />
                        </Field>
                      </div>

                      <div className="mt-6">
                        <ImageUploader
                          label="Faculty Official ID Card"
                          existingPath={facultyState.idCardStoragePath}
                          onUploadSuccess={(path) => setFacultyState({ ...facultyState, idCardStoragePath: path })}
                          onRemove={() => setFacultyState({ ...facultyState, idCardStoragePath: "" })}
                          required={facultyEnabled}
                        />
                      </div>

                      {accommodationPlans.length > 0 && (
                        <div className="mt-6">
                          <Field label="Accommodation (Optional)">
                            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                              <label className="relative flex cursor-pointer flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-all hover:border-violet-400/40 has-[:checked]:border-violet-500 has-[:checked]:bg-violet-500/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)]">
                                <input
                                  type="radio"
                                  name="facultyAccommodationPlanSlug"
                                  value=""
                                  checked={!facultyState.accommodationPlanSlug}
                                  onChange={(e) => setFacultyState({ ...facultyState, accommodationPlanSlug: e.target.value })}
                                  className="peer sr-only"
                                />
                                <span className="font-medium text-white text-sm">No Accommodation</span>
                                <span className="font-mono text-xs text-white/50">₹0</span>
                              </label>
                              {accommodationPlans.map((plan) => (
                                <label key={plan.id} className="relative flex cursor-pointer flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-all hover:border-violet-400/40 has-[:checked]:border-violet-500 has-[:checked]:bg-violet-500/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)]">
                                  <input
                                    type="radio"
                                    name="facultyAccommodationPlanSlug"
                                    value={plan.slug}
                                    checked={facultyState.accommodationPlanSlug === plan.slug}
                                    onChange={(e) => setFacultyState({ ...facultyState, accommodationPlanSlug: e.target.value })}
                                    className="peer sr-only"
                                  />
                                  <span className="font-medium text-white text-sm leading-tight">{plan.name}</span>
                                  <span className="font-mono text-xs font-semibold text-emerald-400">₹{plan.price}</span>
                                  <span className="text-[10px] font-mono text-white/40 mt-1">{formatAccommodationDate(plan.duration)}</span>
                                </label>
                              ))}
                            </div>
                          </Field>
                        </div>
                      )}
                    </motion.div>
                  )}
                </div>
              </div>
            )}

            {/* PAYMENT SUMMARY & CHECKOUT TERMINAL */}
            {selectedEvents.length > 0 && (
              <div className="rounded-[28px] border border-violet-500/35 bg-gradient-to-br from-violet-950/40 via-[#0b0816]/75 to-[#040208]/90 p-6 sm:p-8 md:p-10 backdrop-blur-2xl shadow-[0_20px_70px_rgba(168,85,247,0.2),inset_0_1px_1px_rgba(255,255,255,0.12)]">
                <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between border-b border-white/10 pb-6">
                  <div>
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-300">
                      REGISTRATION SUMMARY
                    </p>

                    <h3 className="mt-2 text-2xl sm:text-3xl font-light tracking-tight text-white">
                      {selectedEvents.length}{" "}
                      {selectedEvents.length === 1 ? "Competition" : "Competitions"}{" "}
                      Selected
                    </h3>

                    <div className="mt-5 space-y-2">
                      {selectedEvents.map((event) => {
                        const state = getTeamState(event.id);
                        let amount = 0;

                        if (event.payment_type === "paid") {
                          const fee = Number(event.registration_fee || 0);

                          if (event.payment_unit === "per_team") {
                            amount = fee;
                          } else if (isTeamEvent(event)) {
                            amount = fee * (1 + state.members.length);
                          } else {
                            amount = fee;
                          }
                        }

                        return (
                          <div
                            key={event.id}
                            className="flex items-center justify-between gap-6 text-sm"
                          >
                            <span className="text-zinc-300">
                              {event.name}
                            </span>

                            <span className="font-mono text-sm font-medium text-white">
                              {amount > 0 ? `₹${amount.toLocaleString("en-IN")}` : "Free"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="md:text-right">
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-violet-300">
                      Total Payable
                    </p>

                    <p className={`mt-1 text-3xl sm:text-5xl font-bold font-mono tracking-tight ${totalPrice > 0 ? "text-white" : "text-emerald-400"}`}>
                      {totalPrice > 0 ? `₹${totalPrice.toLocaleString("en-IN")}` : "FREE"}
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-white/50 font-mono">
                  <span className="flex items-center gap-1.5 text-violet-300">
                    <ShieldCheck size={14} />
                    <span>Official UGC Certified Passes</span>
                  </span>
                  <span>•</span>
                  <span>Instant PayU Processing</span>
                  <span>•</span>
                  <span>Live QR Pass Generated</span>
                </div>
              </div>
            )}

            {/* REGISTRATION IDENTITY ADVISORY */}
            <div className="flex items-start gap-3 rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-4 text-xs sm:text-sm leading-relaxed text-zinc-300 backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-violet-400" />
              <div>
                <span className="font-semibold text-white">Important Advisory: </span>
                <span>
                  All participants must carry their valid college/university ID card and a valid identity proof with them at the event venue. Participants may be required to present these documents for verification.
                </span>
              </div>
            </div>

            {/* CODE OF CONDUCT & TERMS AGREEMENT */}
            <div className="flex items-start gap-3.5 rounded-2xl border border-white/10 bg-white/[0.025] p-4 sm:p-5 transition hover:border-violet-400/30 backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <input
                id="delegate-agreement"
                type="checkbox"
                name="agreement"
                required
                className="mt-1 h-4 w-4 cursor-pointer accent-violet-500 rounded border-white/20 focus:ring-2 focus:ring-violet-400 focus:outline-none"
              />

              <div className="max-w-2xl text-xs sm:text-sm leading-relaxed text-zinc-300">
                <label
                  htmlFor="delegate-agreement"
                  className="cursor-pointer"
                >
                  I confirm that all delegate information provided above is authentic and I agree to strictly adhere to the official Saviskar 2026{" "}
                </label>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setTermsModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1 font-semibold text-violet-300 underline underline-offset-4 decoration-violet-400/50 hover:text-white hover:decoration-white transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-violet-400 focus:ring-offset-2 focus:ring-offset-black rounded-sm"
                  aria-label="View official Saviskar 2026 Terms & Conditions (opens in document viewer)"
                  aria-haspopup="dialog"
                >
                  <span>Terms &amp; Conditions</span>
                  <ExternalLink size={12} className="inline shrink-0 opacity-70" aria-hidden="true" />
                </button>
                <label
                  htmlFor="delegate-agreement"
                  className="cursor-pointer"
                >
                  , Code of Conduct and applicable event rules.
                </label>
              </div>
            </div>

            {errorMessage && (
              <div className="flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-950/40 px-5 py-4 text-sm text-red-300 shadow-[0_0_20px_rgba(239,68,68,0.15)]">
                <AlertCircle size={18} className="shrink-0 text-red-400" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* SUBMIT & CHECKOUT ACTION */}
            <div className="flex flex-col items-stretch justify-between gap-6 border-t border-white/10 pt-8 sm:flex-row sm:items-center">
              <div>
                <p className="font-mono text-xs text-white/60">
                  {selectedEvents.length === 0
                    ? "Select at least one competition to continue."
                    : `${selectedEvents.length} event${selectedEvents.length === 1 ? "" : "s"} ready for registration.`}
                </p>

                {totalPrice > 0 && (
                  <p className="mt-1 font-mono text-sm font-semibold text-violet-300">
                    Grand Total: ₹{totalPrice.toLocaleString("en-IN")}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || eventsLoading || selectedEventIds.length === 0}
                className="group flex min-w-[240px] items-center justify-center gap-3 rounded-full bg-white px-8 py-4 text-sm font-semibold text-black transition-all hover:scale-105 hover:bg-violet-100 shadow-[0_10px_35px_rgba(255,255,255,0.3)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" />
                    <span>Processing Registration...</span>
                  </>
                ) : (
                  <>
                    <span>
                      {totalPrice > 0 ? "Proceed to Checkout" : "Confirm Official Registration"}
                    </span>
                    <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Official Terms & Conditions Controlled PDF Modal Viewer */}
          <TermsConditionsModal
            isOpen={termsModalOpen}
            onClose={() => setTermsModalOpen(false)}
          />
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block space-y-2 ${className}`}>
      <span className="block font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300/80">
        {label}
      </span>
      {children}
    </label>
  );
}