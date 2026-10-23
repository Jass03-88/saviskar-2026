"use client";

import {
  FormEvent,
  ReactNode,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
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
  X,
  Sparkles,
  ShieldCheck,
  Search,
  CreditCard,
  ExternalLink,
  LogOut,
  Calendar,
  RefreshCw,
} from "lucide-react";
import QRCode from "qrcode";
import { supabase } from "@/lib/supabase";
import TermsConditionsModal from "./TermsConditionsModal";
import RegistrationDetailPanel from "./RegistrationDetailPanel";
import TeamAccommodationModal from "./TeamAccommodationModal";
import AddAccommodationModal from "./AddAccommodationModal";
import { INDIAN_STATES_AND_UT } from "@/lib/states";
import { ImageUploader } from "@/components/ui/image-uploader";
import { calculateStayDates } from "@/lib/accommodation-dates";
import { submitPayUCheckoutForm } from "@/lib/payments/checkout-form";

export function formatAccommodationDate(
  duration: number,
  selectedDate?: string,
  extraDays?: string
) {
  if (duration === 1) {
    if (selectedDate === "2026-10-27") return "27 Oct (Day Before)";
    if (selectedDate === "2026-10-28") return "28 Oct (Day 1)";
    if (selectedDate === "2026-10-29") return "29 Oct (Day 2)";
    if (selectedDate === "2026-10-30") return "30 Oct (Day After)";
    return "28 or 29 Oct";
  }
  if (duration === 2) {
    if (extraDays === "before_27") return "27–29 Oct (3 Days)";
    if (extraDays === "after_30") return "28–30 Oct (3 Days)";
    if (extraDays === "both") return "27–30 Oct (4 Days)";
    return "28–29 Oct";
  }
  if (duration === 3) {
    if (selectedDate === "2026-10-27" || extraDays === "before_27") return "27–29 Oct (3 Days)";
    if (selectedDate === "2026-10-30" || selectedDate === "2026-10-28" || extraDays === "after_30") return "28–30 Oct (3 Days)";
    return "27th or 30th Oct";
  }
  if (duration === 4) return "27–30 Oct (4 Days)";
  return "28 Oct onwards";
}

export function resolveAccommodationSelection(
  baseSlug: string,
  selectedDate?: string,
  extraDays?: "none" | "before_27" | "after_30" | "both"
): { planSlug: string; selectedDate: string; extraDays: string } {
  if (baseSlug === "1_day") {
    const validDates = ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"];
    const date = validDates.includes(selectedDate || "") ? (selectedDate as string) : "2026-10-28";
    return { planSlug: "1_day", selectedDate: date, extraDays: "none" };
  }
  if (baseSlug === "2_days") {
    if (extraDays === "before_27") {
      return { planSlug: "3_days", selectedDate: "2026-10-27", extraDays: "before_27" };
    }
    if (extraDays === "after_30") {
      return { planSlug: "3_days", selectedDate: "2026-10-30", extraDays: "after_30" };
    }
    if (extraDays === "both") {
      return { planSlug: "4_days", selectedDate: "2026-10-27", extraDays: "both" };
    }
    return { planSlug: "2_days", selectedDate: "2026-10-28", extraDays: "none" };
  }
  if (baseSlug === "3_days") {
    const is30 = selectedDate === "2026-10-30" || extraDays === "after_30";
    if (is30) {
      return { planSlug: "3_days", selectedDate: "2026-10-30", extraDays: "after_30" };
    }
    return { planSlug: "3_days", selectedDate: "2026-10-27", extraDays: "before_27" };
  }
  if (baseSlug === "4_days") {
    return { planSlug: "4_days", selectedDate: "2026-10-27", extraDays: "both" };
  }
  return { planSlug: baseSlug, selectedDate: selectedDate || "2026-10-28", extraDays: extraDays || "none" };
}

export function isDateBookedByParticipant(
  dateStr: string,
  accommodations: Array<{ startDate?: string; endDate?: string; status?: string }>
): boolean {
  return accommodations.some((acc) => {
    if (!acc.startDate || !acc.endDate) return false;
    const status = (acc.status || "").toLowerCase();
    if (status === "cancelled" || status === "failed") return false;
    return dateStr >= acc.startDate && dateStr < acc.endDate;
  });
}

export function isPlanRangeConflicting(
  planSlug: string,
  selectedDate: string | undefined,
  extraDays: string | undefined,
  accommodations: Array<{ startDate?: string; endDate?: string; status?: string }>
): { hasConflict: boolean; isFullyBooked: boolean } {
  const { startDate: start, endDate: end } = calculateStayDates(
    planSlug,
    selectedDate,
    extraDays
  );

  const nights: string[] = [];
  const cur = new Date(start);
  const finish = new Date(end);
  while (cur < finish) {
    nights.push(cur.toISOString().split("T")[0]);
    cur.setDate(cur.getDate() + 1);
  }

  const bookedNights = nights.filter((night) =>
    isDateBookedByParticipant(night, accommodations)
  );

  return {
    hasConflict: bookedNights.length > 0,
    isFullyBooked: bookedNights.length === nights.length && nights.length > 0,
  };
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
  accommodationDate?: string;
  extraDays?: "none" | "before_27" | "after_30" | "both";
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

export type ParticipantLookupEvent = {
  participantEventId: string;
  eventId: string;
  eventName: string;
  category?: string | null;
  registrationType?: string | null;
  isTeamLeader?: boolean;
  registrationStatus: string | null;
  paymentType?: string | null;
  paymentStatus: string | null;
  paymentAmount: number | null;
  paymentId: string | null;
  teamName: string | null;
  checkedIn: boolean;
  checkedInAt: string | null;
  teamMembers?: Array<{
    id: string;
    name: string;
    email: string;
    phone: string;
    isTeamLeader: boolean;
    participantId: string | null;
    college: string | null;
    accommodations: Array<{
      id: string;
      planName: string;
      planSlug: string;
      startDate: string;
      endDate: string;
      durationDays: number;
      amount: number;
      status: string;
    }>;
  }>;
};

export type ParticipantLookupAccommodation = {
  id?: string;
  participantAccommodationId: string;
  planSlug: string;
  planName: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  price: number;
  amount?: number;
  currency?: string;
  status: string;
  assignedEmail?: string;
  allocationStatus?: string | null;
  hostelName?: string | null;
  roomNumber?: string | null;
  checkedIn?: boolean;
  checkedInAt?: string | null;
  checkedOut?: boolean;
  checkedOutAt?: string | null;
};

export type ConfirmedRegistrationData = {
  participantId: string;
  name?: string;
  email?: string;
  college?: string;
  events: Array<{
    name: string;
    category?: string | null;
    registrationType?: string | null;
    teamName?: string | null;
    isTeamLeader?: boolean;
    fee: number;
    paymentType?: string | null;
    paymentStatus?: string;
  }>;
  accommodations: Array<{
    planName: string;
    startDate: string;
    endDate: string;
    durationDays: number;
    price: number;
    status: string;
    assignedEmail?: string;
  }>;
  totalPayable: number;
  totalPaid: number;
  totalPending: number;
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
  accommodations?: ParticipantLookupAccommodation[];
  summary?: {
    totalPayable: number;
    totalPaid: number;
    totalPending: number;
  };
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
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [eventSearch, setEventSearch] = useState("");
  const [eventCategory, setEventCategory] = useState("All");
  const [eventState, setEventState] = useState<
    Record<string, EventRegistrationState>
  >({});
  const [mainAccommodationSlug, setMainAccommodationSlug] = useState("");
  const [mainAccommodationDate, setMainAccommodationDate] = useState<"2026-10-27" | "2026-10-28" | "2026-10-29" | "2026-10-30">("2026-10-28");
  const [mainExtraDays, setMainExtraDays] = useState<"none" | "before_27" | "after_30" | "both">("none");
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
    accommodationPlanSlug: "",
    accommodationDate: "2026-10-28" as "2026-10-27" | "2026-10-28" | "2026-10-29" | "2026-10-30",
    extraDays: "none" as "none" | "before_27" | "after_30" | "both",
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

  /*
   * Reset participant state when session email changes (account switch / logout)
   */
  useEffect(() => {
    if (normalizedSessionEmail !== existingParticipantEmail) {
      setExistingParticipantEmail(normalizedSessionEmail);
      setParticipantLookup(null);
      setParticipantLookupEvents([]);
      setParticipantLookupAccommodations([]);
      setParticipantLookupError(null);
      setSelectedEventIds([]);
      setEventState({});
      setMainAccommodationSlug("");
    }
  }, [normalizedSessionEmail, existingParticipantEmail]);

  const [participantLookupLoading, setParticipantLookupLoading] = useState(false);
  const [participantLookupError, setParticipantLookupError] = useState<string | null>(null);
  const [participantLookup, setParticipantLookup] = useState<
    ParticipantLookupResponse["participant"] | null
  >(null);
  const [participantLookupEvents, setParticipantLookupEvents] = useState<
    ParticipantLookupEvent[]
  >([]);
  const [participantLookupAccommodations, setParticipantLookupAccommodations] = useState<
    ParticipantLookupAccommodation[]
  >([]);
  const [confirmedRegistrationData, setConfirmedRegistrationData] = useState<
    ConfirmedRegistrationData | null
  >(null);
  const [showManualSync, setShowManualSync] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const isSaveOnlyRef = useRef(false);
  const [termsModalOpen, setTermsModalOpen] = useState(false);
  const activeLookupRequestRef = useRef(0);

  /*
   * ACCOMMODATION & REGISTRATION DETAIL MODAL STATES
   */
  const [selectedDetailEvent, setSelectedDetailEvent] = useState<ParticipantLookupEvent | null>(null);
  const [isDetailPanelOpen, setIsDetailPanelOpen] = useState(false);
  const [isAddAccommodationModalOpen, setIsAddAccommodationModalOpen] = useState(false);
  const [isTeamAccommodationModalOpen, setIsTeamAccommodationModalOpen] = useState(false);
  const [activeTeamEventForAccommodation, setActiveTeamEventForAccommodation] = useState<ParticipantLookupEvent | null>(null);

  /*
   * LOAD EVENTS
   */
  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError(null);

    try {
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
        setEventsError(
          "We couldn't load the competition lineup. Please check your connection and retry."
        );
        return;
      }

      const loaded = (data ?? []) as EventOption[];
      setEventOptions(loaded);
      setEventsError(null);

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
    } catch (err) {
      console.error("Exception loading events:", err);
      setEventsError("Unable to load competition lineup. Please retry.");
    } finally {
      setEventsLoading(false);
    }
  }, [selectedEventParam]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

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

  const registeredEventIds = useMemo(() => {
    if (!Array.isArray(participantLookupEvents) || participantLookupEvents.length === 0) {
      return new Set<string>();
    }
    const ids = new Set<string>();
    for (const item of participantLookupEvents) {
      if (item && typeof item.eventId === "string" && item.eventId.trim().length > 0) {
        const regStatus = (item.registrationStatus || "").toLowerCase();
        const payStatus = (item.paymentStatus || "").toLowerCase();
        // Exclude only active registrations; allow re-registration if cancelled or failed
        if (regStatus !== "cancelled" && payStatus !== "failed" && payStatus !== "cancelled") {
          ids.add(item.eventId.trim());
        }
      }
    }
    return ids;
  }, [participantLookupEvents]);

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


  const applyParticipantData = useCallback(
    (
      participant: NonNullable<ParticipantLookupResponse["participant"]>,
      events: ParticipantLookupEvent[] = [],
      accommodations: ParticipantLookupAccommodation[] = []
    ) => {
      if (!participant || typeof participant !== "object") return;

      // Deduplicate and normalize registered events
      const safeEvents = Array.from(
        new Map(
          (Array.isArray(events) ? events : [])
            .filter((e) => e && (e.participantEventId || e.eventId))
            .map((e) => {
              const pId = e.participantEventId || e.eventId;
              return [
                pId,
                {
                  ...e,
                  participantEventId: pId,
                  eventId: e.eventId || pId,
                  eventName: e.eventName || "Competition",
                  category: e.category || null,
                  registrationType: e.registrationType || (e.teamName ? "team" : "individual"),
                  teamName: e.teamName || null,
                  isTeamLeader: e.isTeamLeader ?? Boolean(e.teamName),
                  paymentStatus: e.paymentStatus || null,
                  paymentAmount:
                    typeof e.paymentAmount === "number"
                      ? e.paymentAmount
                      : Number(e.paymentAmount) || 0,
                  registrationStatus: e.registrationStatus || "confirmed",
                  checkedIn: Boolean(e.checkedIn),
                },
              ];
            })
        ).values()
      );

      // Deduplicate and normalize registered accommodations
      const safeAccommodations = Array.from(
        new Map(
          (Array.isArray(accommodations) ? accommodations : [])
            .filter((a) => a && (a.id || a.participantAccommodationId))
            .map((a) => {
              const id = a.id || a.participantAccommodationId || "";
              const price = typeof a.price === "number" ? a.price : (Number(a.amount) || 0);
              const amount = typeof a.amount === "number" ? a.amount : (Number(a.price) || 0);
              return [
                id,
                {
                  ...a,
                  id,
                  participantAccommodationId: id,
                  price,
                  amount,
                  currency: a.currency || "INR",
                  status: a.status || "confirmed",
                },
              ];
            })
        ).values()
      );

      setExistingParticipantId(participant.participantId || "");
      setExistingParticipantEmail(normalizedSessionEmail || participant.email || "");
      setParticipantLookup(participant);
      setParticipantLookupEvents(safeEvents);
      setParticipantLookupAccommodations(safeAccommodations);
      setParticipantLookupError(null);

      // Never keep an event selected if the participant is already registered for it with an active/confirmed registration.
      const registeredIds = new Set(
        safeEvents
          .filter((item) => {
            if (!item || typeof item.eventId !== "string" || !item.eventId.trim()) return false;
            const regStatus = (item.registrationStatus || "").toLowerCase();
            const payStatus = (item.paymentStatus || "").toLowerCase();
            return regStatus !== "cancelled" && payStatus !== "failed" && payStatus !== "cancelled";
          })
          .map((item) => item.eventId.trim())
      );

      setSelectedEventIds((current) =>
        current.filter((eventId) => !registeredIds.has(eventId))
      );
      setEventState((current) => {
        const next = { ...current };
        for (const eventId of registeredIds) delete next[eventId];
        return next;
      });

      // Clear draft accommodation if participant already has confirmed campus stay
      const hasConfirmedAcc = safeAccommodations.some(
        (a) => a && (a.status === "confirmed" || a.status === "approved" || a.status === "paid")
      );
      if (hasConfirmedAcc) {
        setMainAccommodationSlug("");
      }
    },
    [normalizedSessionEmail]
  );

  /*
   * REUSABLE PARTICIPANT HISTORY FETCHER FOR VERIFIED SESSION
   */
  const fetchParticipantHistory = useCallback(async () => {
    if (!normalizedSessionEmail) return;

    const requestId = ++activeLookupRequestRef.current;

    try {
      setParticipantLookupLoading(true);
      setParticipantLookupError(null);
      const response = await fetch("/api/participants/me", {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          setParticipantLookup(null);
          setParticipantLookupEvents([]);
          setParticipantLookupAccommodations([]);
          return;
        }
        throw new Error(`Participant lookup returned status ${response.status}`);
      }

      const result = (await response.json()) as {
        success?: boolean;
        found?: boolean;
        error?: string;
        participant?: ParticipantLookupResponse["participant"];
        events?: ParticipantLookupEvent[];
        accommodations?: ParticipantLookupAccommodation[];
      };

      if (requestId !== activeLookupRequestRef.current) return;

      if (!result.success && result.error) {
        throw new Error(result.error);
      }

      if (result.success && result.found && result.participant) {
        applyParticipantData(
          result.participant,
          result.events ?? [],
          result.accommodations ?? []
        );
      } else if (result.success && result.found === false) {
        setParticipantLookup(null);
        setParticipantLookupEvents([]);
        setParticipantLookupAccommodations([]);
      }
    } catch (err) {
      console.error("Auto participant lookup failed:", err);
      if (requestId === activeLookupRequestRef.current) {
        setParticipantLookupError(
          err instanceof Error ? err.message : "Unable to retrieve registration history."
        );
      }
    } finally {
      if (requestId === activeLookupRequestRef.current) {
        setParticipantLookupLoading(false);
      }
    }
  }, [normalizedSessionEmail, applyParticipantData]);

  useEffect(() => {
    void fetchParticipantHistory();

    function onFocus() {
      if (document.visibilityState === "visible") {
        void fetchParticipantHistory();
      }
    }

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [fetchParticipantHistory]);

  async function findParticipant() {
    const cleanId = existingParticipantId.trim().toUpperCase();
    const cleanEmail = (normalizedSessionEmail || existingParticipantEmail).trim().toLowerCase();

    if (!cleanId) {
      setParticipantLookup(null);
      setParticipantLookupEvents([]);
      setParticipantLookupAccommodations([]);
      setErrorMessage("Enter your Participant ID first.");
      return;
    }

    if (!cleanEmail) {
      setParticipantLookup(null);
      setParticipantLookupEvents([]);
      setParticipantLookupAccommodations([]);
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
      setParticipantLookupAccommodations([]);
      setErrorMessage(
        `Participant lookup must match your authenticated session email (${normalizedSessionEmail}).`
      );
      return;
    }

    setParticipantLookupLoading(true);
    setErrorMessage("");
    setParticipantLookup(null);
    setParticipantLookupEvents([]);
    setParticipantLookupAccommodations([]);

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
      const registeredAccommodations = result.accommodations ?? [];
      applyParticipantData(result.participant, registeredEvents, registeredAccommodations);
    } catch (error) {
      console.error("Participant lookup error:", error);
      setParticipantLookup(null);
      setParticipantLookupEvents([]);
      setParticipantLookupAccommodations([]);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "We couldn't find that Participant ID."
      );
    } finally {
      setParticipantLookupLoading(false);
    }
  }

  const confirmedEvents = useMemo(
    () =>
      participantLookupEvents.filter(
        (item) =>
          item.registrationStatus !== "cancelled" &&
          (item.paymentStatus === "paid" ||
            item.paymentStatus === "free" ||
            item.paymentStatus === "not_required" ||
            !item.paymentStatus ||
            (item.paymentAmount || 0) === 0)
      ),
    [participantLookupEvents]
  );

  const pendingEvents = useMemo(
    () =>
      participantLookupEvents.filter(
        (item) =>
          item.registrationStatus !== "cancelled" &&
          item.paymentStatus === "pending" &&
          (item.paymentAmount || 0) > 0
      ),
    [participantLookupEvents]
  );

  const confirmedAccommodations = useMemo(
    () =>
      participantLookupAccommodations.filter(
        (item) =>
          item.status === "confirmed" ||
          item.status === "approved" ||
          item.status === "paid" ||
          item.price === 0 ||
          item.amount === 0
      ),
    [participantLookupAccommodations]
  );

  const pendingAccommodations = useMemo(
    () =>
      participantLookupAccommodations.filter(
        (item) =>
          (item.status === "pending" || item.status === "unpaid") &&
          ((item.price || item.amount || 0) > 0)
      ),
    [participantLookupAccommodations]
  );

  useEffect(() => {
    if (mainAccommodationSlug === "1_day" && confirmedAccommodations.length > 0) {
      const dates: Array<"2026-10-27" | "2026-10-28" | "2026-10-29" | "2026-10-30"> = [
        "2026-10-28",
        "2026-10-29",
        "2026-10-27",
        "2026-10-30",
      ];
      const currentIsBooked = isDateBookedByParticipant(mainAccommodationDate, confirmedAccommodations);
      if (currentIsBooked) {
        const nextAvailable = dates.find((d) => !isDateBookedByParticipant(d, confirmedAccommodations));
        if (nextAvailable) {
          setMainAccommodationDate(nextAvailable);
        }
      }
    }
  }, [mainAccommodationSlug, confirmedAccommodations, mainAccommodationDate]);

  async function handleSaveAndLogout() {
    if (!onSignOut) return;

    if (selectedEventIds.length === 0) {
      await onSignOut();
      return;
    }

    const formElement = document.getElementById("saviskar-registration-form") as HTMLFormElement | null;
    if (formElement) {
      isSaveOnlyRef.current = true;
      formElement.requestSubmit();
    } else {
      await onSignOut();
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
    setEventState((current) => {
      const prev = current[eventId] ?? {
        teamName: "",
        isTeamHead: false,
        members: [],
      };
      return {
        ...current,
        [eventId]: {
          ...prev,
          teamName: value,
        },
      };
    });
  }
  function updateTeamHead(
    eventId: string,
    value: boolean
  ) {
    setEventState((current) => {
      const prev = current[eventId] ?? {
        teamName: "",
        isTeamHead: false,
        members: [],
      };
      return {
        ...current,
        [eventId]: {
          ...prev,
          isTeamHead: value,
        },
      };
    });
  }
  function addTeamMember(event: EventOption) {
    const maxTeamSize = event.max_team_size;
    if (!maxTeamSize) return;

    setEventState((current) => {
      const prev = current[event.id] ?? {
        teamName: "",
        isTeamHead: false,
        members: [],
      };

      /*
       * Team leader = member 1.
       */
      const currentTotal = 1 + prev.members.length;

      if (currentTotal >= maxTeamSize) return current;

      return {
        ...current,
        [event.id]: {
          ...prev,
          members: [
            ...prev.members,
            {
              name: "",
              college: "",
              email: "",
              phone: "",
              gender: "",
              state: "",
              idCardStoragePath: "",
              accommodationPlanSlug: "",
              accommodationDate: "2026-10-28",
              extraDays: "none",
            },
          ],
        },
      };
    });
  }

  function removeTeamMember(eventId: string, index: number) {
    const event = eventOptions.find((e) => e.id === eventId);

    setEventState((current) => {
      const prev = current[eventId] ?? {
        teamName: "",
        isTeamHead: false,
        members: [],
      };

      /*
       * Don't allow removal below the minimum required members.
       * Leader = member 1, so minimum additional = min_team_size - 1.
       */
      if (
        event?.min_team_size &&
        prev.members.length <= event.min_team_size - 1
      ) {
        return current;
      }

      return {
        ...current,
        [eventId]: {
          ...prev,
          members: prev.members.filter(
            (_, memberIndex) => memberIndex !== index
          ),
        },
      };
    });
  }

  function updateTeamMemberMultiple(
    eventId: string,
    index: number,
    updates: Partial<TeamMember>
  ) {
    setEventState((current) => {
      const prev = current[eventId] ?? {
        teamName: "",
        isTeamHead: false,
        members: [],
      };
      return {
        ...current,
        [eventId]: {
          ...prev,
          members: prev.members.map((member, memberIndex) =>
            memberIndex === index
              ? {
                  ...member,
                  ...updates,
                }
              : member
          ),
        },
      };
    });
  }

  function updateTeamMember(
    eventId: string,
    index: number,
    field: keyof TeamMember,
    value: string
  ) {
    updateTeamMemberMultiple(eventId, index, { [field]: value } as Partial<TeamMember>);
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
              accommodationDate: "2026-10-28",
              extraDays: "none",
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
   * ACCOMMODATION CALCULATIONS & TOTAL PRICE
   */
  const baseAccommodationPlans = useMemo(() => {
    return accommodationPlans;
  }, [accommodationPlans]);

  const getAccommodationCost = useCallback(
    (baseSlug: string, extraDays?: "none" | "before_27" | "after_30" | "both") => {
      if (!baseSlug) return 0;
      if (baseSlug === "1_day") {
        const plan = accommodationPlans.find((p) => p.slug === "1_day");
        return plan?.price ?? 499;
      }
      if (baseSlug === "2_days") {
        if (extraDays === "before_27" || extraDays === "after_30") {
          const plan = accommodationPlans.find((p) => p.slug === "3_days");
          return plan?.price ?? 1498;
        }
        if (extraDays === "both") {
          const plan = accommodationPlans.find((p) => p.slug === "4_days");
          return plan?.price ?? 1997;
        }
        const plan = accommodationPlans.find((p) => p.slug === "2_days");
        return plan?.price ?? 999;
      }
      if (baseSlug === "3_days") {
        const plan = accommodationPlans.find((p) => p.slug === "3_days");
        return plan?.price ?? 1498;
      }
      if (baseSlug === "4_days") {
        const plan = accommodationPlans.find((p) => p.slug === "4_days");
        return plan?.price ?? 1997;
      }
      const plan = accommodationPlans.find((p) => p.slug === baseSlug);
      return plan?.price ?? 0;
    },
    [accommodationPlans]
  );

  const totalPrice = useMemo(() => {
    let accCost = 0;

    // Main participant accommodation
    if (mainAccommodationSlug) {
      accCost += getAccommodationCost(mainAccommodationSlug, mainExtraDays);
    }

    // Faculty accommodation
    if (facultyEnabled && facultyState.accommodationPlanSlug) {
      accCost += getAccommodationCost(facultyState.accommodationPlanSlug, facultyState.extraDays);
    }

    // Team members accommodations
    selectedEvents.forEach((event) => {
      if (isTeamEvent(event)) {
        const state = getTeamState(event.id);
        state.members.forEach((m) => {
          if (m.accommodationPlanSlug) {
            accCost += getAccommodationCost(m.accommodationPlanSlug, m.extraDays);
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
    
    return eventsCost + accCost;
  }, [
    selectedEvents,
    eventState,
    accommodationPlans,
    mainAccommodationSlug,
    mainExtraDays,
    getTeamState,
    facultyEnabled,
    facultyState,
    getAccommodationCost,
  ]);

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
      const form = event.currentTarget;
      const formData = new FormData(form);

      const mainAccSlug = String(
        formData.get("accommodationPlanSlug") ?? ""
      ).trim();
      const hasFacultyAcc = facultyEnabled && Boolean(facultyState.accommodationPlanSlug);

      if (selectedEventIds.length === 0 && !mainAccSlug && !hasFacultyAcc) {
        throw new ValidationError(
          "Please select at least one competition or accommodation before continuing."
        );
      }

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

      const accommodationsPayload: Array<{ email: string; planSlug: string; selectedDate?: string; extraDays?: string }> = [];

      if (mainAccSlug) {
        const resolved = resolveAccommodationSelection(mainAccSlug, mainAccommodationDate, mainExtraDays);
        accommodationsPayload.push({
          email,
          planSlug: resolved.planSlug,
          selectedDate: resolved.selectedDate,
          extraDays: resolved.extraDays,
        });
      }

      if (!mainIdCardStoragePath) {
        throw new ValidationError("Please upload your ID Card.");
      }

      if (facultyEnabled) {
        if (!facultyState.name.trim() || !facultyState.email.trim() || !facultyState.phone.trim() || !facultyState.gender || !facultyState.state.trim() || !facultyState.idCardStoragePath) {
          throw new ValidationError("Please complete all Faculty Incharge details (including ID card).");
        }
        if (facultyState.email.trim().toLowerCase() === email.trim().toLowerCase()) {
          throw new ValidationError("Faculty In-Charge email cannot be the same as the participant email.");
        }
        if (facultyState.accommodationPlanSlug) {
          const resolved = resolveAccommodationSelection(
            facultyState.accommodationPlanSlug,
            facultyState.accommodationDate,
            facultyState.extraDays
          );
          accommodationsPayload.push({
            email: facultyState.email.trim().toLowerCase(),
            planSlug: resolved.planSlug,
            selectedDate: resolved.selectedDate,
            extraDays: resolved.extraDays,
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
              const resolved = resolveAccommodationSelection(
                member.accommodationPlanSlug,
                member.accommodationDate,
                member.extraDays
              );
              accommodationsPayload.push({
                email: member.email.trim().toLowerCase(),
                planSlug: resolved.planSlug,
                selectedDate: resolved.selectedDate,
                extraDays: resolved.extraDays,
              });
            }

            if (facultyEnabled && member.email.trim().toLowerCase() === facultyState.email.trim().toLowerCase()) {
              throw new ValidationError("Faculty In-Charge email cannot match any team member email.");
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
              college: member.college?.trim() || college.trim() || participantLookup?.college?.trim() || "",
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

      // Build confirmed registration data before form clearing
      const eventSummaries = selectedEvents.map((ev) => {
        const state = getTeamState(ev.id);
        const isTeam = isTeamEvent(ev);
        let fee = 0;
        if (ev.payment_type === "paid") {
          const rawFee = Number(ev.registration_fee || 0);
          fee = ev.payment_unit === "per_team" ? rawFee : isTeam ? rawFee * (1 + state.members.length) : rawFee;
        }
        return {
          name: ev.name,
          category: ev.category,
          registrationType: ev.registration_type || "solo",
          teamName: isTeam ? state.teamName : null,
          isTeamLeader: isTeam ? state.isTeamHead : false,
          fee,
          paymentType: ev.payment_type || "free",
          paymentStatus: fee > 0 ? (result.paymentRequired ? "pending" : "paid") : "free",
        };
      });

      const accSummaries: ConfirmedRegistrationData["accommodations"] = [];
      if (mainAccSlug) {
        const plan = accommodationPlans.find((p) => p.slug === mainAccSlug);
        const cost = getAccommodationCost(mainAccSlug, mainExtraDays);
        accSummaries.push({
          planName: plan?.name || "Standard Accommodation",
          startDate: mainAccommodationDate,
          endDate: mainAccommodationDate,
          durationDays: plan?.duration || 1,
          price: cost,
          status: cost > 0 && result.paymentRequired ? "pending" : "confirmed",
          assignedEmail: email,
        });
      }
      if (facultyEnabled && facultyState.accommodationPlanSlug) {
        const plan = accommodationPlans.find((p) => p.slug === facultyState.accommodationPlanSlug);
        const cost = getAccommodationCost(facultyState.accommodationPlanSlug, facultyState.extraDays);
        accSummaries.push({
          planName: `Faculty: ${plan?.name || "Standard Accommodation"}`,
          startDate: facultyState.accommodationDate,
          endDate: facultyState.accommodationDate,
          durationDays: plan?.duration || 1,
          price: cost,
          status: cost > 0 && result.paymentRequired ? "pending" : "confirmed",
          assignedEmail: facultyState.email,
        });
      }

      setConfirmedRegistrationData({
        participantId: result.participantId,
        name,
        email,
        college,
        events: eventSummaries,
        accommodations: accSummaries,
        totalPayable: Number(result.totalAmount || 0),
        totalPaid: result.paymentRequired ? 0 : Number(result.totalAmount || 0),
        totalPending: result.paymentRequired ? Number(result.totalAmount || 0) : 0,
      });

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
        setPendingPaymentOrderId(result.paymentOrder.id);
        setPendingPaymentAmount(Number(result.totalAmount));

        if (isSaveOnlyRef.current) {
          isSaveOnlyRef.current = false;
          if (onSignOut) {
            await onSignOut();
          }
          return;
        }

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
      if (isSaveOnlyRef.current) {
        isSaveOnlyRef.current = false;
        if (onSignOut) {
          await onSignOut();
        }
        return;
      }

      // Reconcile against server records to ensure complete historical integrity
      try {
        const lookupRes = await fetch(
          `/api/participants/${encodeURIComponent(result.participantId)}?email=${encodeURIComponent(email)}`,
          { cache: "no-store", headers: { Accept: "application/json" } }
        );
        if (lookupRes.ok) {
          const lData = (await lookupRes.json()) as ParticipantLookupResponse;
          if (lData.success && lData.participant) {
            applyParticipantData(lData.participant, lData.events ?? [], lData.accommodations ?? []);
            setConfirmedRegistrationData({
              participantId: lData.participant.participantId,
              name: lData.participant.name,
              email: lData.participant.email,
              college: lData.participant.college ?? college,
              events: (lData.events || []).map((e) => ({
                name: e.eventName,
                category: e.category,
                registrationType: e.registrationType,
                teamName: e.teamName,
                isTeamLeader: e.isTeamLeader,
                fee: e.paymentAmount || 0,
                paymentType: e.paymentType,
                paymentStatus: e.paymentStatus || "confirmed",
              })),
              accommodations: (lData.accommodations || []).map((a) => ({
                planName: a.planName,
                startDate: a.startDate,
                endDate: a.endDate,
                durationDays: a.durationDays,
                price: a.price,
                status: a.status,
                assignedEmail: a.assignedEmail,
              })),
              totalPayable: lData.summary?.totalPayable ?? Number(result.totalAmount || 0),
              totalPaid: lData.summary?.totalPaid ?? Number(result.totalAmount || 0),
              totalPending: lData.summary?.totalPending ?? 0,
            });
          }
        }
      } catch (lookupErr) {
        console.warn("Could not enrich confirmed registration data:", lookupErr);
      }

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
      isSaveOnlyRef.current = false;
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

            // Fetch authoritative registration details
            const checkEmail = normalizedSessionEmail || existingParticipantEmail;
            if (checkEmail) {
              const enrichRes = await fetch(
                `/api/participants/${encodeURIComponent(confirmedId)}?email=${encodeURIComponent(checkEmail)}`,
                { cache: "no-store", headers: { Accept: "application/json" } }
              );
              if (enrichRes.ok) {
                const enrData = (await enrichRes.json()) as ParticipantLookupResponse;
                if (enrData.success && enrData.participant) {
                  applyParticipantData(enrData.participant, enrData.events ?? [], enrData.accommodations ?? []);
                  setConfirmedRegistrationData({
                    participantId: enrData.participant.participantId,
                    name: enrData.participant.name,
                    email: enrData.participant.email,
                    college: enrData.participant.college ?? "",
                    events: (enrData.events || []).map((e) => ({
                      name: e.eventName,
                      category: e.category,
                      registrationType: e.registrationType,
                      teamName: e.teamName,
                      isTeamLeader: e.isTeamLeader,
                      fee: e.paymentAmount || 0,
                      paymentType: e.paymentType,
                      paymentStatus: e.paymentStatus || "confirmed",
                    })),
                    accommodations: (enrData.accommodations || []).map((a) => ({
                      planName: a.planName,
                      startDate: a.startDate,
                      endDate: a.endDate,
                      durationDays: a.durationDays,
                      price: a.price,
                      status: a.status,
                      assignedEmail: a.assignedEmail,
                    })),
                    totalPayable: enrData.summary?.totalPayable ?? 0,
                    totalPaid: enrData.summary?.totalPaid ?? 0,
                    totalPending: enrData.summary?.totalPending ?? 0,
                  });
                }
              }
            }
          } catch (qrErr) {
            console.error("QR generation / enrich error:", qrErr);
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
      submitPayUCheckoutForm(createResult.checkoutConfig);
      return;
    } catch (error) {
      console.error("Payment checkout error:", error);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Payment could not be processed. Please try again."
      );
      setPaymentPending(true);
      setPaymentProcessing(false);
      setLoading(false);
      throw error;
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

      // Now call the checkout function to redirect to the PayU hosted checkout
      await initiatePaymentCheckout(
        paymentOrderId,
        participantLookup.participantId
      );
    } catch (error) {
      console.error("Recovery error:", error);
      setErrorMessage(
        error instanceof Error ? error.message : "Recovery could not be processed."
      );
      setPaymentProcessing(false);
      setLoading(false);
    }
  }

  /*
   * ACCOMMODATION PAYMENT RECOVERY
   */
  async function handleAccommodationRecovery(item: ParticipantLookupAccommodation) {
    if (!participantLookup) return;

    try {
      setPaymentProcessing(true);
      setErrorMessage("");

      const recoveryResponse = await fetch("/api/payments/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: participantLookup.participantId,
          participantAccommodationId: item.participantAccommodationId,
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
      setPendingPaymentAmount(item.price || 0);

      await initiatePaymentCheckout(
        paymentOrderId,
        participantLookup.participantId
      );
    } catch (error) {
      console.error("Accommodation recovery error:", error);
      setErrorMessage(
        error instanceof Error ? error.message : "Recovery could not be processed."
      );
      setPaymentProcessing(false);
      setLoading(false);
    }
  }

  /*
   * REGISTRATION DETAIL & ACCOMMODATION MODAL HANDLERS
   */
  const handleOpenDetailPanel = useCallback((event: ParticipantLookupEvent) => {
    setSelectedDetailEvent(event);
    setIsDetailPanelOpen(true);
  }, []);

  const handleOpenAddAccommodation = useCallback(() => {
    setIsDetailPanelOpen(false);
    setIsAddAccommodationModalOpen(true);
  }, []);

  const handleOpenTeamAccommodation = useCallback(
    (event?: ParticipantLookupEvent) => {
      setIsDetailPanelOpen(false);
      const targetEvent =
        event ||
        selectedDetailEvent ||
        participantLookupEvents.find(
          (e) => e.registrationType === "team" && e.isTeamLeader
        ) ||
        null;
      setActiveTeamEventForAccommodation(targetEvent);
      setIsTeamAccommodationModalOpen(true);
    },
    [selectedDetailEvent, participantLookupEvents]
  );

  const handleModalPayment = useCallback(
    async (orderId: string, pId?: string) => {
      const targetPid = pId || participantLookup?.participantId || participantId || "";
      await initiatePaymentCheckout(orderId, targetPid);
    },
    [participantLookup, participantId]
  );

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

            {/* REGISTERED COMPETITIONS (FREE AND PAID) */}
            {confirmedRegistrationData?.events && confirmedRegistrationData.events.length > 0 && (
              <div className="relative z-10 mt-6 w-full max-w-xl rounded-2xl border border-white/12 bg-white/[0.03] p-5 text-left backdrop-blur-md">
                <div className="flex items-center justify-between mb-3 border-b border-white/10 pb-2">
                  <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-violet-300 font-semibold">
                    Registered Competitions ({confirmedRegistrationData.events.length})
                  </p>
                  <span className="font-mono text-[9px] uppercase tracking-wider text-emerald-400 font-semibold">
                    Confirmed
                  </span>
                </div>

                <div className="space-y-2">
                  {confirmedRegistrationData.events.map((ev, idx) => (
                    <div
                      key={`${ev.name}-${idx}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/40 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{ev.name}</p>
                        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/50">
                          {ev.category ? `${ev.category} · ` : ""}
                          {ev.teamName ? `Team: ${ev.teamName}` : "Solo"}
                          {ev.isTeamLeader ? " (Leader)" : ""}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-mono text-xs font-semibold text-violet-200 block">
                          {ev.fee > 0 ? `₹${ev.fee.toLocaleString("en-IN")}` : "Free (₹0)"}
                        </span>
                        <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 text-[8px] font-mono font-bold uppercase tracking-wider text-emerald-300">
                          {ev.paymentStatus === "paid" ? "PAID" : ev.paymentStatus === "pending" ? "PENDING" : "CONFIRMED"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ACCOMMODATION BOOKINGS */}
            {confirmedRegistrationData?.accommodations && confirmedRegistrationData.accommodations.length > 0 && (
              <div className="relative z-10 mt-6 w-full max-w-xl rounded-2xl border border-violet-500/30 bg-violet-950/20 p-5 text-left backdrop-blur-md">
                <div className="flex items-center justify-between mb-3 border-b border-white/10 pb-2">
                  <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-violet-300 font-semibold">
                    Accommodation Booking
                  </p>
                  <span className="font-mono text-[9px] uppercase tracking-wider text-emerald-400 font-semibold">
                    Campus Stay
                  </span>
                </div>

                <div className="space-y-2">
                  {confirmedRegistrationData.accommodations.map((acc, idx) => (
                    <div
                      key={`${acc.planName}-${idx}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/40 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{acc.planName}</p>
                        <p className="font-mono text-[10px] text-white/50">
                          Dates: {acc.startDate === acc.endDate ? acc.startDate : `${acc.startDate} to ${acc.endDate}`} ({acc.durationDays} {acc.durationDays === 1 ? "day" : "days"})
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-mono text-xs font-semibold text-violet-200 block">
                          {acc.price > 0 ? `₹${acc.price.toLocaleString("en-IN")}` : "Free"}
                        </span>
                        <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 text-[8px] font-mono font-bold uppercase tracking-wider text-emerald-300">
                          {acc.status === "confirmed" || acc.status === "approved" ? "CONFIRMED" : acc.status.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* FINANCIAL SUMMARY */}
            {confirmedRegistrationData && (
              <div className="relative z-10 mt-6 w-full max-w-xl rounded-2xl border border-white/12 bg-white/[0.02] p-4 text-left font-mono text-xs space-y-1">
                <div className="flex items-center justify-between text-white/70 py-1">
                  <span>Total Payable:</span>
                  <span className="font-semibold text-white">₹{confirmedRegistrationData.totalPayable.toLocaleString("en-IN")}</span>
                </div>
                <div className="flex items-center justify-between text-emerald-400 py-1">
                  <span>Amount Paid:</span>
                  <span className="font-semibold">₹{confirmedRegistrationData.totalPaid.toLocaleString("en-IN")}</span>
                </div>
                {confirmedRegistrationData.totalPending > 0 && (
                  <div className="flex items-center justify-between text-amber-400 py-1 border-t border-white/10 mt-1 pt-1">
                    <span>Outstanding / Pending:</span>
                    <span className="font-semibold">₹{confirmedRegistrationData.totalPending.toLocaleString("en-IN")}</span>
                  </div>
                )}
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
                  setConfirmedRegistrationData(null);
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

          <form id="saviskar-registration-form" onSubmit={handleSubmit} className="relative z-10 space-y-12">
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
                    className="text-xs font-medium text-violet-400 hover:text-violet-200 transition-colors underline cursor-pointer"
                  >
                    Switch Account
                  </button>
                )}
              </div>
            )}

            {/* UNIFIED REGISTRATION & CART HUB */}
            {participantLookupLoading ? (
              <div className="rounded-[24px] border border-white/12 bg-gradient-to-b from-white/[0.04] to-white/[0.015] p-6 md:p-8 backdrop-blur-xl animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="h-5 w-5 rounded-full bg-violet-400/40" />
                  <div className="h-4 w-56 rounded bg-white/20" />
                </div>
                <div className="mt-4 h-6 w-72 rounded bg-white/10" />
              </div>
            ) : participantLookup ? (
              <div className="rounded-[24px] border border-emerald-500/30 bg-gradient-to-b from-emerald-950/25 via-black/40 to-black/60 p-6 md:p-8 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(52,211,153,0.15)] space-y-6">
                {/* Profile Header */}
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-white/10 pb-5">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400 text-black shadow-[0_0_10px_#34d399]">
                        <Check size={12} />
                      </span>
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">
                        Official Saviskar 2026 Registration Hub
                      </p>
                    </div>
                    <h3 className="mt-2 text-xl sm:text-2xl font-semibold text-white">
                      {participantLookup.name}
                    </h3>
                    <p className="mt-0.5 text-xs text-white/60">
                      {participantLookup.college} • <span className="font-mono">{participantLookup.email}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/60 px-3.5 py-1.5 font-mono text-xs font-semibold text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.15)]">
                      <span>{participantLookup.participantId}</span>
                      <button
                        type="button"
                        onClick={() => {
                          if (participantLookup?.participantId) {
                            navigator.clipboard.writeText(participantLookup.participantId);
                            setCopiedId(true);
                            setTimeout(() => setCopiedId(false), 2000);
                          }
                        }}
                        className="text-emerald-400 hover:text-white transition-colors text-[10px] underline ml-1 cursor-pointer"
                      >
                        {copiedId ? "Copied!" : "Copy"}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => void fetchParticipantHistory()}
                      disabled={participantLookupLoading}
                      title="Refresh registration history"
                      className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 font-mono text-xs text-white/70 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw size={12} className={participantLookupLoading ? "animate-spin text-emerald-400" : ""} />
                      <span className="hidden xs:inline">{participantLookupLoading ? "Syncing..." : "Sync"}</span>
                    </button>
                  </div>
                </div>

                {/* RECOVERABLE ERROR BANNER */}
                {participantLookupError && (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-950/20 px-4 py-3 text-xs text-red-300">
                    <div className="flex items-center gap-2">
                      <AlertCircle size={15} className="shrink-0 text-red-400" />
                      <span>{participantLookupError}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void fetchParticipantHistory()}
                      className="rounded-lg bg-red-500/20 border border-red-500/40 px-3 py-1 text-xs font-semibold text-red-200 hover:bg-red-500/30 transition-colors cursor-pointer"
                    >
                      Retry
                    </button>
                  </div>
                )}

                {/* FORM ERROR BANNER */}
                {errorMessage && (
                  <div className="flex items-center gap-2.5 rounded-xl border border-red-500/30 bg-red-950/30 px-5 py-3 text-sm text-red-300">
                    <AlertCircle size={15} className="shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                {/* SECTION 1: COMPETITION REGISTRATIONS */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-400/90">
                        Your Registrations ({participantLookupEvents.length})
                      </p>
                    </div>
                    <span className="font-mono text-[10px] text-white/40">Verified Competitions</span>
                  </div>

                  {participantLookupLoading && participantLookupEvents.length === 0 ? (
                    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 text-center animate-pulse">
                      <div className="flex items-center justify-center gap-2 text-xs text-white/60">
                        <RefreshCw size={13} className="animate-spin text-emerald-400" />
                        <span>Loading your registered competitions...</span>
                      </div>
                    </div>
                  ) : participantLookupEvents.length === 0 ? (
                    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 text-center">
                      <p className="text-sm font-medium text-white/80">No competitions registered yet</p>
                      <p className="text-xs text-white/40 mt-1">
                        Browse the competitive realms below to register for individual or team events.
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {participantLookupEvents.map((item) => {
                        const isCancelled = item.registrationStatus?.toLowerCase() === "cancelled";
                        const isPaid = item.paymentStatus?.toLowerCase() === "paid";
                        const isFree =
                          item.paymentStatus?.toLowerCase() === "free" ||
                          item.paymentStatus?.toLowerCase() === "not_required" ||
                          !item.paymentStatus ||
                          (item.paymentAmount || 0) === 0;
                        const isPending = item.paymentStatus?.toLowerCase() === "pending";
                        const isFailed = item.paymentStatus?.toLowerCase() === "failed";

                        return (
                          <div
                            key={item.participantEventId || item.eventId}
                            onClick={() => handleOpenDetailPanel(item)}
                            className={`flex flex-col justify-between gap-3 rounded-xl border p-4 transition-all cursor-pointer hover:border-violet-500/50 hover:bg-white/[0.04] ${
                              isPending && !isCancelled
                                ? "border-amber-500/30 bg-amber-950/20"
                                : isCancelled
                                ? "border-white/10 bg-white/[0.02] opacity-75"
                                : "border-emerald-500/20 bg-emerald-950/20"
                            }`}
                          >
                            <div>
                              <div className="flex items-start justify-between gap-2">
                                <h4 className="font-medium text-sm text-white">
                                  {item.eventName}
                                </h4>
                                <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                                  {/* Registration Status Pill */}
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider border ${
                                      isCancelled
                                        ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
                                        : item.registrationStatus?.toLowerCase() === "pending"
                                        ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                                        : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                                    }`}
                                  >
                                    {item.registrationStatus || "CONFIRMED"}
                                  </span>
                                  {/* Payment Status Pill */}
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider border ${
                                      isPaid
                                        ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-300"
                                        : isPending
                                        ? "bg-amber-500/20 border-amber-500/30 text-amber-300"
                                        : isFailed
                                        ? "bg-rose-500/20 border-rose-500/30 text-rose-300"
                                        : "bg-cyan-500/20 border-cyan-500/30 text-cyan-300"
                                    }`}
                                  >
                                    {isPaid ? "PAID" : isPending ? "UNPAID" : isFailed ? "FAILED" : "FREE"}
                                  </span>
                                </div>
                              </div>

                              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/60">
                                {item.category && (
                                  <span className="font-mono text-violet-300/90 font-medium">
                                    {item.category}
                                  </span>
                                )}
                                {item.category && <span className="text-white/20">•</span>}
                                <span className="font-mono text-white/50">
                                  {item.teamName
                                    ? `Team "${item.teamName}" (${item.isTeamLeader ? "Leader" : "Member"})`
                                    : item.registrationType === "team"
                                    ? item.isTeamLeader
                                      ? "Team Leader"
                                      : "Team Member"
                                    : "Individual Entry"}
                                </span>
                                <span className="text-white/20">•</span>
                                <span className="font-mono font-medium text-emerald-400">
                                  {item.paymentAmount && item.paymentAmount > 0
                                    ? `₹${item.paymentAmount}`
                                    : "Free"}
                                </span>
                              </div>
                            </div>

                            {/* Complete Payment Button for Pending Competition */}
                            {!isCancelled && isPending && (item.paymentAmount || 0) > 0 && (
                              <button
                                type="button"
                                disabled={paymentProcessing}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handlePaymentRecovery(item);
                                }}
                                className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-white px-3.5 py-1.5 text-xs font-semibold text-black transition-all hover:bg-amber-100 hover:scale-[1.01] shadow-[0_0_15px_rgba(251,191,36,0.2)] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                              >
                                {paymentProcessing ? (
                                  <>
                                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-black/30 border-t-black" />
                                    <span>Connecting Gateway...</span>
                                  </>
                                ) : (
                                  <>
                                    <span>Pay Now (₹{item.paymentAmount})</span>
                                    <ArrowRight size={13} />
                                  </>
                                )}
                              </button>
                            )}

                            {/* Detail Drawer Hint */}
                            <div className="mt-1 flex items-center justify-between border-t border-white/5 pt-2 text-[10px] text-violet-300/80">
                              <span className="flex items-center gap-1 font-mono">
                                {item.registrationType === "team" || item.teamName
                                  ? "View Roster & Team Stay Options"
                                  : "View Registration Details"}
                              </span>
                              <ArrowRight size={11} className="opacity-60" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* SECTION 2: ACCOMMODATION BOOKINGS */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-400/90">
                        Your Accommodation ({participantLookupAccommodations.length})
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleOpenAddAccommodation}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-mono font-semibold uppercase tracking-wider text-emerald-300 hover:bg-emerald-500/20 transition-all cursor-pointer"
                      >
                        <Plus size={11} />
                        <span>Add Stay</span>
                      </button>
                      <span className="font-mono text-[10px] text-white/40 hidden sm:inline">Campus Stay Verified</span>
                    </div>
                  </div>

                  {participantLookupLoading && participantLookupAccommodations.length === 0 ? (
                    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-center animate-pulse">
                      <div className="flex items-center justify-center gap-2 text-xs text-white/60">
                        <RefreshCw size={13} className="animate-spin text-emerald-400" />
                        <span>Loading accommodation bookings...</span>
                      </div>
                    </div>
                  ) : participantLookupAccommodations.length === 0 ? (
                    <div className="rounded-xl border border-white/5 bg-white/[0.015] px-4 py-3 text-xs text-white/40 flex items-center justify-between">
                      <div>
                        <span>No accommodation booked</span>
                        <span className="block text-[11px] text-white/30">Campus stay optional (₹400/night)</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleOpenAddAccommodation}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition-all cursor-pointer"
                      >
                        <Plus size={13} />
                        <span>Book Campus Stay</span>
                      </button>
                    </div>
                  ) : (
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {participantLookupAccommodations.map((acc) => {
                        const isCancelled = acc.status?.toLowerCase() === "cancelled";
                        const isPaid = acc.status?.toLowerCase() === "paid";
                        const isConfirmed =
                          isPaid ||
                          acc.status?.toLowerCase() === "confirmed" ||
                          acc.status?.toLowerCase() === "approved";
                        const isPending =
                          acc.status?.toLowerCase() === "pending" ||
                          acc.status?.toLowerCase() === "unpaid";
                        const cost = acc.amount || acc.price || 0;

                        return (
                          <div
                            key={acc.id || acc.participantAccommodationId}
                            className={`flex flex-col justify-between gap-3 rounded-xl border p-4 transition-all ${
                              isPending && !isCancelled
                                ? "border-amber-500/30 bg-amber-950/20"
                                : isCancelled
                                ? "border-white/10 bg-white/[0.02] opacity-75"
                                : "border-emerald-500/20 bg-emerald-950/20"
                            }`}
                          >
                            <div>
                              <div className="flex items-start justify-between gap-2">
                                <h4 className="font-medium text-sm text-white">
                                  {acc.planName || "Accommodation"}
                                </h4>
                                <span
                                  className={`rounded-full px-2.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider border ${
                                    isPaid
                                      ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-300"
                                      : isConfirmed
                                      ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-300"
                                      : isPending
                                      ? "bg-amber-500/20 border-amber-500/30 text-amber-300"
                                      : "bg-rose-500/10 border-rose-500/30 text-rose-300"
                                  }`}
                                >
                                  {isPaid
                                    ? "PAID"
                                    : isConfirmed
                                    ? "CONFIRMED"
                                    : isPending
                                    ? "PENDING"
                                    : acc.status?.toUpperCase() || "CONFIRMED"}
                                </span>
                              </div>

                              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/60">
                                <span className="font-mono">
                                  {acc.startDate === acc.endDate
                                    ? acc.startDate
                                    : `${acc.startDate} to ${acc.endDate}`}
                                </span>
                                <span className="text-white/20">•</span>
                                <span className="font-mono">
                                  {acc.durationDays} Day{acc.durationDays > 1 ? "s" : ""}
                                </span>
                                <span className="text-white/20">•</span>
                                <span className="font-mono font-medium text-emerald-400">
                                  {cost > 0 ? `₹${cost}` : "Free"}
                                </span>
                              </div>
                            </div>

                            {/* Complete Payment Button for Pending Accommodation */}
                            {!isCancelled && isPending && cost > 0 && (
                              <button
                                type="button"
                                disabled={paymentProcessing}
                                onClick={() => handleAccommodationRecovery(acc)}
                                className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-white px-3.5 py-1.5 text-xs font-semibold text-black transition-all hover:bg-amber-100 hover:scale-[1.01] shadow-[0_0_15px_rgba(251,191,36,0.2)] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                              >
                                {paymentProcessing ? (
                                  <>
                                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-black/30 border-t-black" />
                                    <span>Connecting Gateway...</span>
                                  </>
                                ) : (
                                  <>
                                    <span>Pay Now (₹{cost})</span>
                                    <ArrowRight size={13} />
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* SECTION 3: IN-SESSION SELECTIONS DRAFT */}
                {selectedEventIds.length > 0 && (
                  <div className="rounded-xl border border-violet-500/30 bg-violet-950/30 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-violet-400" />
                        <p className="font-mono text-xs font-semibold text-violet-300">
                          {selectedEventIds.length} New Competition{selectedEventIds.length > 1 ? "s" : ""} Selected
                        </p>
                      </div>
                      <p className="font-mono text-xs font-semibold text-white">
                        Subtotal: ₹{totalPrice}
                      </p>
                    </div>
                  </div>
                )}

                {/* FOOTER ACTIONS */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      const catalogEl = document.getElementById("competitive-realms-catalog");
                      catalogEl?.scrollIntoView({ behavior: "smooth" });
                    }}
                    className="inline-flex items-center gap-2 text-xs font-semibold text-violet-300 hover:text-white transition-colors cursor-pointer"
                  >
                    <Plus size={14} />
                    <span>Add More Competitions</span>
                  </button>

                  {onSignOut && (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={handleSaveAndLogout}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.05] px-4 py-2 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
                    >
                      <LogOut size={13} />
                      <span>
                        {selectedEventIds.length > 0 ? "Save Registration & Log Out" : "Log Out Safely"}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              /* FIRST-TIME PARTICIPANT WELCOME */
              <div className="rounded-[24px] border border-white/12 bg-gradient-to-b from-white/[0.04] to-white/[0.015] p-6 md:p-8 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)]">
                <div className="flex items-start gap-4 sm:gap-5">
                  <div className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-violet-500/30 bg-violet-950/40 text-violet-300 shadow-[0_0_20px_rgba(168,85,247,0.2)]">
                    <Sparkles size={19} />
                  </div>

                  <div className="w-full min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">
                        New Delegate Registration
                      </span>
                    </div>

                    <h3 className="mt-1.5 text-lg sm:text-xl font-medium tracking-tight text-white">
                      Welcome to Saviskar 2026.
                    </h3>

                    <p className="mt-1 text-xs sm:text-sm text-white/60">
                      Select your competitive realms below. Your permanent Saviskar Participant ID will be generated upon submission.
                    </p>

                    {/* Manual Sync Accordion Toggle (Fallback for offline registrations) */}
                    <div className="mt-4 pt-3 border-t border-white/5">
                      <button
                        type="button"
                        onClick={() => setShowManualSync(!showManualSync)}
                        className="text-xs text-white/40 hover:text-violet-300 transition-colors flex items-center gap-1.5 cursor-pointer font-mono"
                      >
                        <ChevronDown size={13} className={`transition-transform duration-200 ${showManualSync ? "rotate-180" : ""}`} />
                        <span>Already have an offline Participant ID? Click to sync</span>
                      </button>

                      {showManualSync && (
                        <div className="mt-4 pt-3 border-t border-white/10 space-y-4">
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
                            </div>

                            <button
                              type="button"
                              onClick={() => void findParticipant()}
                              disabled={participantLookupLoading || !existingParticipantId.trim() || !(existingParticipantEmail || normalizedSessionEmail).trim()}
                              className="inline-flex h-[48px] items-center justify-center gap-2 rounded-xl bg-white px-6 text-xs font-semibold text-black transition-all hover:bg-violet-100 hover:scale-[1.02] shadow-[0_0_20px_rgba(255,255,255,0.25)] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                            >
                              {participantLookupLoading ? (
                                <>
                                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" />
                                  <span>Verifying</span>
                                </>
                              ) : (
                                <>
                                  <span>Sync ID</span>
                                  <ArrowRight size={14} />
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* EVENT SELECTION */}
            <div id="competitive-realms-catalog" className="space-y-6">
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
              ) : eventsError ? (
                <div className="rounded-2xl border border-red-500/30 bg-red-950/20 p-8 text-center backdrop-blur-md space-y-3">
                  <AlertCircle className="mx-auto h-8 w-8 text-amber-400" />
                  <p className="text-sm font-medium text-white">{eventsError}</p>
                  <p className="text-xs text-white/50">Unable to reach the live competition database.</p>
                  <button
                    type="button"
                    onClick={() => void loadEvents()}
                    className="inline-flex items-center gap-2 rounded-xl bg-violet-600/30 hover:bg-violet-600/50 border border-violet-400/40 px-4 py-2 text-xs font-semibold text-white transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)]"
                  >
                    <RefreshCw size={13} />
                    <span>Retry Loading Competitions</span>
                  </button>
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

                  {/* SELECTED EVENTS & ADDS-ON DRAWER */}
                  <AnimatePresence initial={false}>
                    {(selectedEvents.length > 0 || mainAccommodationSlug || (facultyEnabled && facultyState.accommodationPlanSlug)) && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="rounded-2xl border border-violet-500/35 bg-gradient-to-br from-violet-950/40 via-[#0a0714]/70 to-[#05030a]/85 p-5 md:p-6 backdrop-blur-2xl shadow-[0_0_45px_rgba(168,85,247,0.18),inset_0_1px_1px_rgba(255,255,255,0.12)] space-y-4">
                          <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
                            <div>
                              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">
                                {selectedEvents.length > 0 ? "Chosen Competitions & Add-ons" : "Selected Accommodation Add-on"}
                              </p>
                              <p className="text-xs text-white/60">
                                Details will be configured below.
                              </p>
                            </div>

                            <p className="font-mono text-sm font-bold text-violet-300">
                              {totalPrice > 0
                                ? `Total: ₹${totalPrice.toLocaleString("en-IN")}`
                                : "Total: ₹0 (Free)"}
                            </p>
                          </div>

                          {/* COMPETITIONS LIST */}
                          {selectedEvents.length > 0 && (
                            <div className="divide-y divide-white/10">
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
                                        : "₹0 (Free)"}
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
                          )}

                          {/* ACCOMMODATION ADD-ON ITEM */}
                          {mainAccommodationSlug && (
                            <div className="rounded-xl border border-violet-500/30 bg-violet-950/30 p-3 flex items-center justify-between gap-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400 text-black shadow-[0_0_10px_#34d399]">
                                  <Check size={13} />
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-white">
                                    Campus Accommodation ({accommodationPlans.find((p) => p.slug === mainAccommodationSlug)?.name || mainAccommodationSlug})
                                  </p>
                                  <p className="font-mono text-[10px] text-violet-300/80">
                                    {formatAccommodationDate(
                                      accommodationPlans.find((p) => p.slug === mainAccommodationSlug)?.duration || 1,
                                      mainAccommodationDate,
                                      mainExtraDays
                                    )}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-3 shrink-0">
                                <span className="font-mono text-xs font-medium text-violet-200">
                                  ₹{getAccommodationCost(mainAccommodationSlug, mainExtraDays).toLocaleString("en-IN")}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setMainAccommodationSlug("")}
                                  className="flex h-7 w-7 items-center justify-center rounded-full text-white/40 transition hover:bg-red-500/20 hover:text-red-400"
                                  aria-label="Remove accommodation"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            </div>
                          )}

                          {/* FACULTY ACCOMMODATION ITEM */}
                          {facultyEnabled && facultyState.accommodationPlanSlug && (
                            <div className="rounded-xl border border-violet-500/30 bg-violet-950/30 p-3 flex items-center justify-between gap-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400 text-black shadow-[0_0_10px_#34d399]">
                                  <Check size={13} />
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-white">
                                    Faculty Stay ({accommodationPlans.find((p) => p.slug === facultyState.accommodationPlanSlug)?.name || facultyState.accommodationPlanSlug})
                                  </p>
                                  <p className="font-mono text-[10px] text-violet-300/80">
                                    {formatAccommodationDate(
                                      accommodationPlans.find((p) => p.slug === facultyState.accommodationPlanSlug)?.duration || 1,
                                      facultyState.accommodationDate,
                                      facultyState.extraDays
                                    )}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-3 shrink-0">
                                <span className="font-mono text-xs font-medium text-violet-200">
                                  ₹{getAccommodationCost(facultyState.accommodationPlanSlug, facultyState.extraDays).toLocaleString("en-IN")}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setFacultyState({ ...facultyState, accommodationPlanSlug: "" })}
                                  className="flex h-7 w-7 items-center justify-center rounded-full text-white/40 transition hover:bg-red-500/20 hover:text-red-400"
                                  aria-label="Remove faculty accommodation"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            </div>
                          )}

                          {/* TEAM MEMBER ACCOMMODATION ITEMS */}
                          {selectedEvents.map((event) => {
                            if (!isTeamEvent(event)) return null;
                            const state = getTeamState(event.id);
                            return state.members.map((m, mIdx) => {
                              if (!m.accommodationPlanSlug) return null;
                              const plan = accommodationPlans.find((p) => p.slug === m.accommodationPlanSlug);
                              return (
                                <div key={`floating-member-acc-${event.id}-${mIdx}`} className="rounded-xl border border-violet-500/30 bg-violet-950/30 p-3 flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-3 min-w-0">
                                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400 text-black shadow-[0_0_10px_#34d399]">
                                      <Check size={13} />
                                    </div>
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-medium text-white">
                                        {m.name ? `${m.name}` : `Member 0${mIdx + 2}`} Stay ({plan?.name || m.accommodationPlanSlug})
                                      </p>
                                      <p className="font-mono text-[10px] text-violet-300/80">
                                        {formatAccommodationDate(
                                          plan?.duration || 1,
                                          m.accommodationDate,
                                          m.extraDays
                                        )}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-3 shrink-0">
                                    <span className="font-mono text-xs font-medium text-violet-200">
                                      ₹{getAccommodationCost(m.accommodationPlanSlug, m.extraDays).toLocaleString("en-IN")}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => updateTeamMemberMultiple(event.id, mIdx, { accommodationPlanSlug: "", extraDays: "none" })}
                                      className="flex h-7 w-7 items-center justify-center rounded-full text-white/40 transition hover:bg-red-500/20 hover:text-red-400"
                                      aria-label={`Remove Member 0${mIdx + 2} accommodation`}
                                    >
                                      <X size={13} />
                                    </button>
                                  </div>
                                </div>
                              );
                            });
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* COMPACT EVENT LIST */}
                  <div className="overflow-hidden rounded-2xl border border-white/12 bg-gradient-to-b from-white/[0.03] to-black/40 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
                    <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-5 py-3.5">
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">
                        {eventsLoading
                          ? "Loading competitions..."
                          : eventsError
                            ? "Error loading competitions"
                            : `${filteredEvents.length} ${filteredEvents.length === 1 ? "competition" : "competitions"} available`}
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

                    {eventsLoading ? (
                      <div className="px-6 py-14 text-center">
                        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
                        <p className="mt-3 text-xs font-mono text-white/50">Loading official competition catalogue...</p>
                      </div>
                    ) : eventsError ? (
                      <div className="px-6 py-12 text-center space-y-3">
                        <AlertCircle className="mx-auto h-8 w-8 text-amber-400" />
                        <p className="text-sm font-medium text-white">{eventsError}</p>
                        <button
                          type="button"
                          onClick={() => void loadEvents()}
                          className="inline-flex items-center gap-2 rounded-xl bg-violet-600/30 hover:bg-violet-600/50 border border-violet-400/40 px-4 py-2 text-xs font-semibold text-white transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)]"
                        >
                          <RefreshCw size={13} />
                          <span>Retry Loading Competitions</span>
                        </button>
                      </div>
                    ) : filteredEvents.length === 0 ? (
                      <div className="px-6 py-14 text-center">
                        <p className="text-sm font-medium text-white">No competitions found.</p>
                        <p className="mt-1 text-xs text-white/40">
                          {eventOptions.length === 0
                            ? "No active competitions are currently scheduled."
                            : registeredEventIds.size > 0 && eventOptions.every((e) => registeredEventIds.has(e.id))
                              ? "You have already registered for all available competitions in this selection."
                              : "Try searching for keywords like \"Robotics\", \"Dance\", \"Hackathon\", or change the realm filter."}
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

                                <Field label="COLLEGE STATE / UT">
                                  <input
                                    type="text"
                                    name="state"
                                    list="indian-states"
                                    placeholder="Select college state / UT"
                                    required
                                    autoComplete="off"
                                    className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3.5 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40"
                                  />
                                  <p className="text-xs text-white/50 leading-relaxed">
                                    Select the state/UT where your college or university is located, not your home state.
                                  </p>
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
                                    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
                                      {baseAccommodationPlans.map((plan) => (
                                        <label key={plan.id} className="relative flex cursor-pointer flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-all hover:border-violet-400/40 has-[:checked]:border-violet-500 has-[:checked]:bg-violet-500/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)]">
                                          <input
                                            type="radio"
                                            name="accommodationPlanSlug"
                                            value={plan.slug}
                                            checked={mainAccommodationSlug === plan.slug}
                                            onChange={(e) => {
                                              const val = e.target.value;
                                              setMainAccommodationSlug(val);
                                              if (val === "3_days") {
                                                if (mainAccommodationDate !== "2026-10-27" && mainAccommodationDate !== "2026-10-30") {
                                                  setMainAccommodationDate("2026-10-27");
                                                  setMainExtraDays("before_27");
                                                }
                                              } else if (val === "1_day") {
                                                if (!["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].includes(mainAccommodationDate)) {
                                                  setMainAccommodationDate("2026-10-28");
                                                  setMainExtraDays("none");
                                                }
                                              } else if (val === "2_days") {
                                                setMainAccommodationDate("2026-10-28");
                                                setMainExtraDays("none");
                                              } else if (val === "4_days") {
                                                setMainAccommodationDate("2026-10-27");
                                                setMainExtraDays("both");
                                              }
                                            }}
                                            className="peer sr-only"
                                          />
                                          <div className="flex items-center justify-between gap-1">
                                            <span className="font-medium text-white text-sm leading-tight">{plan.name}</span>
                                            {(() => {
                                              const planStatus = isPlanRangeConflicting(plan.slug, mainAccommodationDate, mainExtraDays, confirmedAccommodations);
                                              if (planStatus.isFullyBooked) {
                                                return (
                                                  <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-1.5 py-0.5 text-[8px] font-mono font-bold uppercase text-emerald-300">
                                                    Booked
                                                  </span>
                                                );
                                              }
                                              if (planStatus.hasConflict && plan.slug !== "1_day") {
                                                return (
                                                  <span className="rounded-full bg-amber-500/20 border border-amber-500/30 px-1.5 py-0.5 text-[8px] font-mono font-bold uppercase text-amber-300">
                                                    Overlap
                                                  </span>
                                                );
                                              }
                                              return null;
                                            })()}
                                          </div>
                                          <span className="font-mono text-xs font-semibold text-emerald-400">
                                            ₹{plan.price}
                                          </span>
                                          <span className="text-[10px] font-mono text-white/40 mt-1">
                                            {formatAccommodationDate(
                                              plan.duration,
                                              mainAccommodationSlug === plan.slug ? mainAccommodationDate : undefined,
                                              mainAccommodationSlug === plan.slug ? mainExtraDays : undefined
                                            )}
                                          </span>
                                        </label>
                                      ))}
                                    </div>
                                    {mainAccommodationSlug === "1_day" && (
                                      <div className="mt-3 p-3.5 rounded-xl border border-violet-500/30 bg-violet-950/20 backdrop-blur-sm">
                                        <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-300 mb-2">
                                          <Calendar size={13} className="text-violet-400" />
                                          <span>Choose Your 1-Day Accommodation Date:</span>
                                        </div>
                                        {(() => {
                                           const is27Booked = isDateBookedByParticipant("2026-10-27", confirmedAccommodations);
                                           const is28Booked = isDateBookedByParticipant("2026-10-28", confirmedAccommodations);
                                           const is29Booked = isDateBookedByParticipant("2026-10-29", confirmedAccommodations);
                                           const is30Booked = isDateBookedByParticipant("2026-10-30", confirmedAccommodations);
                                           return (
                                             <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                                               <label className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs transition-all ${
                                                 is27Booked
                                                   ? "border-emerald-500/20 bg-emerald-950/10 text-white/50 cursor-not-allowed opacity-80"
                                                   : mainAccommodationDate === "2026-10-27"
                                                   ? "border-violet-400 bg-violet-500/20 text-white font-medium cursor-pointer"
                                                   : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20 cursor-pointer"
                                               }`}>
                                                 <input
                                                   type="radio"
                                                   name="mainAccommodationDate"
                                                   value="2026-10-27"
                                                   disabled={is27Booked}
                                                   checked={mainAccommodationDate === "2026-10-27"}
                                                   onChange={() => setMainAccommodationDate("2026-10-27")}
                                                   className="sr-only"
                                                 />
                                                 <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                                                   is27Booked ? "border-emerald-500/50 bg-emerald-500/20" : mainAccommodationDate === "2026-10-27" ? "border-violet-400 bg-violet-500" : "border-white/30"
                                                 }`}>
                                                   {is27Booked ? <Check size={10} className="text-emerald-400" /> : mainAccommodationDate === "2026-10-27" ? <div className="w-1.5 h-1.5 rounded-full bg-white" /> : null}
                                                 </div>
                                                 <div className="flex-1">
                                                   <div className="flex items-center justify-between gap-1">
                                                     <span className="text-xs font-medium">27th Oct (Day Before)</span>
                                                     {is27Booked && (
                                                       <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-1.5 py-0.2 text-[8px] font-mono font-bold uppercase text-emerald-300">
                                                         Booked
                                                       </span>
                                                     )}
                                                   </div>
                                                   <div className="text-[10px] text-white/50">Early arrival • Tue night</div>
                                                 </div>
                                               </label>
                                               <label className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs transition-all ${
                                                 is28Booked
                                                   ? "border-emerald-500/20 bg-emerald-950/10 text-white/50 cursor-not-allowed opacity-80"
                                                   : mainAccommodationDate === "2026-10-28"
                                                   ? "border-violet-400 bg-violet-500/20 text-white font-medium cursor-pointer"
                                                   : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20 cursor-pointer"
                                               }`}>
                                                 <input
                                                   type="radio"
                                                   name="mainAccommodationDate"
                                                   value="2026-10-28"
                                                   disabled={is28Booked}
                                                   checked={mainAccommodationDate === "2026-10-28"}
                                                   onChange={() => setMainAccommodationDate("2026-10-28")}
                                                   className="sr-only"
                                                 />
                                                 <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                                                   is28Booked ? "border-emerald-500/50 bg-emerald-500/20" : mainAccommodationDate === "2026-10-28" ? "border-violet-400 bg-violet-500" : "border-white/30"
                                                 }`}>
                                                   {is28Booked ? <Check size={10} className="text-emerald-400" /> : mainAccommodationDate === "2026-10-28" ? <div className="w-1.5 h-1.5 rounded-full bg-white" /> : null}
                                                 </div>
                                                 <div className="flex-1">
                                                   <div className="flex items-center justify-between gap-1">
                                                     <span className="text-xs font-medium">28th Oct (Day 1)</span>
                                                     {is28Booked && (
                                                       <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-1.5 py-0.2 text-[8px] font-mono font-bold uppercase text-emerald-300">
                                                         Booked
                                                       </span>
                                                     )}
                                                   </div>
                                                   <div className="text-[10px] text-white/50">Fest Day 1 • Wed night</div>
                                                 </div>
                                               </label>
                                               <label className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs transition-all ${
                                                 is29Booked
                                                   ? "border-emerald-500/20 bg-emerald-950/10 text-white/50 cursor-not-allowed opacity-80"
                                                   : mainAccommodationDate === "2026-10-29"
                                                   ? "border-violet-400 bg-violet-500/20 text-white font-medium cursor-pointer"
                                                   : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20 cursor-pointer"
                                               }`}>
                                                 <input
                                                   type="radio"
                                                   name="mainAccommodationDate"
                                                   value="2026-10-29"
                                                   disabled={is29Booked}
                                                   checked={mainAccommodationDate === "2026-10-29"}
                                                   onChange={() => setMainAccommodationDate("2026-10-29")}
                                                   className="sr-only"
                                                 />
                                                 <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                                                   is29Booked ? "border-emerald-500/50 bg-emerald-500/20" : mainAccommodationDate === "2026-10-29" ? "border-violet-400 bg-violet-500" : "border-white/30"
                                                 }`}>
                                                   {is29Booked ? <Check size={10} className="text-emerald-400" /> : mainAccommodationDate === "2026-10-29" ? <div className="w-1.5 h-1.5 rounded-full bg-white" /> : null}
                                                 </div>
                                                 <div className="flex-1">
                                                   <div className="flex items-center justify-between gap-1">
                                                     <span className="text-xs font-medium">29th Oct (Day 2)</span>
                                                     {is29Booked && (
                                                       <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-1.5 py-0.2 text-[8px] font-mono font-bold uppercase text-emerald-300">
                                                         Booked
                                                       </span>
                                                     )}
                                                   </div>
                                                   <div className="text-[10px] text-white/50">Fest Day 2 • Thu night</div>
                                                 </div>
                                               </label>
                                               <label className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs transition-all ${
                                                 is30Booked
                                                   ? "border-emerald-500/20 bg-emerald-950/10 text-white/50 cursor-not-allowed opacity-80"
                                                   : mainAccommodationDate === "2026-10-30"
                                                   ? "border-violet-400 bg-violet-500/20 text-white font-medium cursor-pointer"
                                                   : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20 cursor-pointer"
                                               }`}>
                                                 <input
                                                   type="radio"
                                                   name="mainAccommodationDate"
                                                   value="2026-10-30"
                                                   disabled={is30Booked}
                                                   checked={mainAccommodationDate === "2026-10-30"}
                                                   onChange={() => setMainAccommodationDate("2026-10-30")}
                                                   className="sr-only"
                                                 />
                                                 <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                                                   is30Booked ? "border-emerald-500/50 bg-emerald-500/20" : mainAccommodationDate === "2026-10-30" ? "border-violet-400 bg-violet-500" : "border-white/30"
                                                 }`}>
                                                   {is30Booked ? <Check size={10} className="text-emerald-400" /> : mainAccommodationDate === "2026-10-30" ? <div className="w-1.5 h-1.5 rounded-full bg-white" /> : null}
                                                 </div>
                                                 <div className="flex-1">
                                                   <div className="flex items-center justify-between gap-1">
                                                     <span className="text-xs font-medium">30th Oct (Day After)</span>
                                                     {is30Booked && (
                                                       <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-1.5 py-0.2 text-[8px] font-mono font-bold uppercase text-emerald-300">
                                                         Booked
                                                       </span>
                                                     )}
                                                   </div>
                                                   <div className="text-[10px] text-white/50">Extended stay • Fri night</div>
                                                 </div>
                                               </label>
                                             </div>
                                           );
                                         })()}
                                      </div>
                                    )}
                                    {mainAccommodationSlug === "2_days" && (
                                      <div className="mt-3 p-3 rounded-xl border border-white/10 bg-white/[0.02] flex items-center gap-2.5 text-xs text-white/70">
                                        <Calendar size={14} className="text-violet-400 shrink-0" />
                                        <span>Includes both official fest days: <strong className="text-white">28th &amp; 29th October</strong> (2 Nights • Checkout 30th morning).</span>
                                      </div>
                                    )}
                                    {mainAccommodationSlug === "3_days" && (
                                      <div className="mt-3 p-3.5 rounded-xl border border-violet-500/30 bg-violet-950/20 backdrop-blur-sm">
                                        <div className="flex items-center justify-between gap-1.5 text-xs font-semibold text-violet-300 mb-2">
                                          <div className="flex items-center gap-1.5">
                                            <Calendar size={13} className="text-violet-400" />
                                            <span>Choose Extra Day for 3-Day Accommodation (3 Nights):</span>
                                          </div>
                                          <span className="text-[11px] font-mono text-emerald-400 font-semibold">₹1,498 Total</span>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                          <label className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer text-xs transition-all ${(mainAccommodationDate === "2026-10-27" || mainExtraDays === "before_27") ? "border-violet-400 bg-violet-500/20 text-white font-medium" : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20"}`}>
                                            <input
                                              type="radio"
                                              name="main3DaysOption"
                                              value="2026-10-27"
                                              checked={mainAccommodationDate === "2026-10-27" || mainExtraDays === "before_27"}
                                              onChange={() => {
                                                setMainAccommodationDate("2026-10-27");
                                                setMainExtraDays("before_27");
                                              }}
                                              className="sr-only"
                                            />
                                            <div className={`mt-0.5 w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${(mainAccommodationDate === "2026-10-27" || mainExtraDays === "before_27") ? "border-violet-400 bg-violet-500" : "border-white/30"}`}>
                                              {(mainAccommodationDate === "2026-10-27" || mainExtraDays === "before_27") && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                            </div>
                                            <div className="flex-1">
                                              <div className="flex items-center justify-between">
                                                <span className="font-semibold text-white">27th Oct (Day Before Fest)</span>
                                                <span className="font-mono text-violet-300 text-[11px]">27–29 Oct</span>
                                              </div>
                                              <div className="text-[11px] text-white/50 mt-0.5">Early Arrival • 27th, 28th &amp; 29th Oct (Checkout 30th)</div>
                                            </div>
                                          </label>

                                          <label className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer text-xs transition-all ${(mainAccommodationDate === "2026-10-30" || mainExtraDays === "after_30") ? "border-violet-400 bg-violet-500/20 text-white font-medium" : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20"}`}>
                                            <input
                                              type="radio"
                                              name="main3DaysOption"
                                              value="2026-10-30"
                                              checked={mainAccommodationDate === "2026-10-30" || mainExtraDays === "after_30"}
                                              onChange={() => {
                                                setMainAccommodationDate("2026-10-30");
                                                setMainExtraDays("after_30");
                                              }}
                                              className="sr-only"
                                            />
                                            <div className={`mt-0.5 w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${(mainAccommodationDate === "2026-10-30" || mainExtraDays === "after_30") ? "border-violet-400 bg-violet-500" : "border-white/30"}`}>
                                              {(mainAccommodationDate === "2026-10-30" || mainExtraDays === "after_30") && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                            </div>
                                            <div className="flex-1">
                                              <div className="flex items-center justify-between">
                                                <span className="font-semibold text-white">30th Oct (Day After Fest)</span>
                                                <span className="font-mono text-violet-300 text-[11px]">28–30 Oct</span>
                                              </div>
                                              <div className="text-[11px] text-white/50 mt-0.5">Extended Stay • 28th, 29th &amp; 30th Oct (Checkout 31st)</div>
                                            </div>
                                          </label>
                                        </div>
                                      </div>
                                    )}
                                    {mainAccommodationSlug === "4_days" && (
                                      <div className="mt-3 p-3 rounded-xl border border-white/10 bg-white/[0.02] flex items-center gap-2.5 text-xs text-white/70">
                                        <Calendar size={14} className="text-violet-400 shrink-0" />
                                        <span>Includes all 4 days: <strong className="text-white">27th to 30th October</strong> (4 Nights • Checkout 31st morning). Day before fest + both fest days + day after fest.</span>
                                      </div>
                                    )}
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

                                    <Field label="COLLEGE STATE / UT">
                                      <input
                                        type="text"
                                        value={member.state}
                                        onChange={(e) => updateTeamMember(event.id, index, "state", e.target.value)}
                                        list="indian-states"
                                        placeholder="Select college state / UT"
                                        required
                                        autoComplete="off"
                                        className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40"
                                      />
                                      <p className="text-xs text-white/50 leading-relaxed">
                                        Select the state/UT where your college or university is located, not your home state.
                                      </p>
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
                                        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                                          <label className="relative flex cursor-pointer flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-all hover:border-violet-400/40 has-[:checked]:border-violet-500 has-[:checked]:bg-violet-500/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)]">
                                            <input
                                              type="radio"
                                              name={`accommodationPlanSlug-${event.id}-${index}`}
                                              value=""
                                              checked={!member.accommodationPlanSlug}
                                              onChange={() => {
                                                updateTeamMemberMultiple(event.id, index, {
                                                  accommodationPlanSlug: "",
                                                  extraDays: "none",
                                                });
                                              }}
                                              className="peer sr-only"
                                            />
                                            <span className="font-medium text-white text-sm">No Accommodation</span>
                                            <span className="font-mono text-xs text-white/50">₹0</span>
                                          </label>
                                          {baseAccommodationPlans.map((plan) => (
                                            <label key={plan.id} className="relative flex cursor-pointer flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-all hover:border-violet-400/40 has-[:checked]:border-violet-500 has-[:checked]:bg-violet-500/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)]">
                                              <input
                                                type="radio"
                                                name={`accommodationPlanSlug-${event.id}-${index}`}
                                                value={plan.slug}
                                                checked={member.accommodationPlanSlug === plan.slug}
                                                onChange={(e) => {
                                                  const val = e.target.value;
                                                  if (val === "3_days") {
                                                    const is30 = member.accommodationDate === "2026-10-30" || member.extraDays === "after_30";
                                                    updateTeamMemberMultiple(event.id, index, {
                                                      accommodationPlanSlug: val,
                                                      accommodationDate: is30 ? "2026-10-30" : "2026-10-27",
                                                      extraDays: is30 ? "after_30" : "before_27",
                                                    });
                                                  } else if (val === "1_day") {
                                                    const validDate = ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].includes(member.accommodationDate || "")
                                                      ? (member.accommodationDate as "2026-10-27" | "2026-10-28" | "2026-10-29" | "2026-10-30")
                                                      : "2026-10-28";
                                                    updateTeamMemberMultiple(event.id, index, {
                                                      accommodationPlanSlug: val,
                                                      accommodationDate: validDate,
                                                      extraDays: "none",
                                                    });
                                                  } else if (val === "2_days") {
                                                    updateTeamMemberMultiple(event.id, index, {
                                                      accommodationPlanSlug: val,
                                                      accommodationDate: "2026-10-28",
                                                      extraDays: "none",
                                                    });
                                                  } else if (val === "4_days") {
                                                    updateTeamMemberMultiple(event.id, index, {
                                                      accommodationPlanSlug: val,
                                                      accommodationDate: "2026-10-27",
                                                      extraDays: "both",
                                                    });
                                                  } else {
                                                    updateTeamMemberMultiple(event.id, index, {
                                                      accommodationPlanSlug: "",
                                                      extraDays: "none",
                                                    });
                                                  }
                                                }}
                                                className="peer sr-only"
                                              />
                                              <span className="font-medium text-white text-sm leading-tight">{plan.name}</span>
                                              <span className="font-mono text-xs font-semibold text-emerald-400">
                                                ₹{plan.price}
                                              </span>
                                              <span className="text-[10px] font-mono text-white/40 mt-1">
                                                {formatAccommodationDate(
                                                  plan.duration,
                                                  member.accommodationPlanSlug === plan.slug ? (member.accommodationDate || "2026-10-28") : undefined,
                                                  member.accommodationPlanSlug === plan.slug ? (member.extraDays || "none") : undefined
                                                )}
                                              </span>
                                            </label>
                                          ))}
                                        </div>
                                        {member.accommodationPlanSlug === "1_day" && (
                                          <div className="mt-3 p-3 rounded-xl border border-violet-500/30 bg-violet-950/20 backdrop-blur-sm">
                                            <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-300 mb-2">
                                              <Calendar size={13} className="text-violet-400" />
                                              <span>Choose Member 1-Day Accommodation Date:</span>
                                            </div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                                              <label className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer text-xs transition-all ${(member.accommodationDate || "2026-10-28") === "2026-10-27" ? "border-violet-400 bg-violet-500/20 text-white font-medium" : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20"}`}>
                                                <input
                                                  type="radio"
                                                  name={`memberAccommodationDate-${event.id}-${index}`}
                                                  value="2026-10-27"
                                                  checked={member.accommodationDate === "2026-10-27"}
                                                  onChange={() => updateTeamMemberMultiple(event.id, index, { accommodationDate: "2026-10-27", extraDays: "none" })}
                                                  className="sr-only"
                                                />
                                                <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${member.accommodationDate === "2026-10-27" ? "border-violet-400 bg-violet-500" : "border-white/30"}`}>
                                                  {member.accommodationDate === "2026-10-27" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                                </div>
                                                <div>
                                                  <div className="text-xs font-medium">27th Oct</div>
                                                  <div className="text-[10px] text-white/50">Day Before Fest</div>
                                                </div>
                                              </label>
                                              <label className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer text-xs transition-all ${(member.accommodationDate || "2026-10-28") === "2026-10-28" ? "border-violet-400 bg-violet-500/20 text-white font-medium" : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20"}`}>
                                                <input
                                                  type="radio"
                                                  name={`memberAccommodationDate-${event.id}-${index}`}
                                                  value="2026-10-28"
                                                  checked={(member.accommodationDate || "2026-10-28") === "2026-10-28"}
                                                  onChange={() => updateTeamMemberMultiple(event.id, index, { accommodationDate: "2026-10-28", extraDays: "none" })}
                                                  className="sr-only"
                                                />
                                                <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${(member.accommodationDate || "2026-10-28") === "2026-10-28" ? "border-violet-400 bg-violet-500" : "border-white/30"}`}>
                                                  {(member.accommodationDate || "2026-10-28") === "2026-10-28" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                                </div>
                                                <div>
                                                  <div className="text-xs font-medium">28th Oct</div>
                                                  <div className="text-[10px] text-white/50">Fest Day 1</div>
                                                </div>
                                              </label>
                                              <label className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer text-xs transition-all ${member.accommodationDate === "2026-10-29" ? "border-violet-400 bg-violet-500/20 text-white font-medium" : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20"}`}>
                                                <input
                                                  type="radio"
                                                  name={`memberAccommodationDate-${event.id}-${index}`}
                                                  value="2026-10-29"
                                                  checked={member.accommodationDate === "2026-10-29"}
                                                  onChange={() => updateTeamMemberMultiple(event.id, index, { accommodationDate: "2026-10-29", extraDays: "none" })}
                                                  className="sr-only"
                                                />
                                                <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${member.accommodationDate === "2026-10-29" ? "border-violet-400 bg-violet-500" : "border-white/30"}`}>
                                                  {member.accommodationDate === "2026-10-29" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                                </div>
                                                <div>
                                                  <div className="text-xs font-medium">29th Oct</div>
                                                  <div className="text-[10px] text-white/50">Fest Day 2</div>
                                                </div>
                                              </label>
                                              <label className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer text-xs transition-all ${member.accommodationDate === "2026-10-30" ? "border-violet-400 bg-violet-500/20 text-white font-medium" : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20"}`}>
                                                <input
                                                  type="radio"
                                                  name={`memberAccommodationDate-${event.id}-${index}`}
                                                  value="2026-10-30"
                                                  checked={member.accommodationDate === "2026-10-30"}
                                                  onChange={() => updateTeamMemberMultiple(event.id, index, { accommodationDate: "2026-10-30", extraDays: "none" })}
                                                  className="sr-only"
                                                />
                                                <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${member.accommodationDate === "2026-10-30" ? "border-violet-400 bg-violet-500" : "border-white/30"}`}>
                                                  {member.accommodationDate === "2026-10-30" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                                </div>
                                                <div>
                                                  <div className="text-xs font-medium">30th Oct</div>
                                                  <div className="text-[10px] text-white/50">Day After Fest</div>
                                                </div>
                                              </label>
                                            </div>
                                          </div>
                                        )}
                                        {member.accommodationPlanSlug === "2_days" && (
                                          <div className="mt-3 p-3 rounded-xl border border-white/10 bg-white/[0.02] flex items-center gap-2.5 text-xs text-white/70">
                                            <Calendar size={14} className="text-violet-400 shrink-0" />
                                            <span>Includes both official fest days: <strong className="text-white">28th &amp; 29th October</strong> (2 Nights • Checkout 30th morning).</span>
                                          </div>
                                        )}
                                        {member.accommodationPlanSlug === "3_days" && (
                                          <div className="mt-3 p-3 rounded-xl border border-violet-500/30 bg-violet-950/20 backdrop-blur-sm">
                                            <div className="flex items-center justify-between gap-1.5 text-xs font-semibold text-violet-300 mb-2">
                                              <div className="flex items-center gap-1.5">
                                                <Calendar size={13} className="text-violet-400" />
                                                <span>Choose Member Extra Day (3 Nights):</span>
                                              </div>
                                              <span className="text-[10px] font-mono text-emerald-400 font-semibold">₹1,498 Total</span>
                                            </div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                              <label className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer text-xs transition-all ${(member.accommodationDate === "2026-10-27" || member.extraDays === "before_27") ? "border-violet-400 bg-violet-500/20 text-white font-medium" : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20"}`}>
                                                <input
                                                  type="radio"
                                                  name={`member3DaysOption-${event.id}-${index}`}
                                                  value="2026-10-27"
                                                  checked={member.accommodationDate === "2026-10-27" || member.extraDays === "before_27"}
                                                  onChange={() => {
                                                    updateTeamMemberMultiple(event.id, index, {
                                                      accommodationDate: "2026-10-27",
                                                      extraDays: "before_27",
                                                    });
                                                  }}
                                                  className="sr-only"
                                                />
                                                <div className={`mt-0.5 w-3 h-3 rounded-full border flex items-center justify-center shrink-0 ${(member.accommodationDate === "2026-10-27" || member.extraDays === "before_27") ? "border-violet-400 bg-violet-500" : "border-white/30"}`}>
                                                  {(member.accommodationDate === "2026-10-27" || member.extraDays === "before_27") && <div className="w-1 h-1 rounded-full bg-white" />}
                                                </div>
                                                <div className="flex-1">
                                                  <div className="flex items-center justify-between">
                                                    <span className="font-semibold text-white">27th Oct (Day Before)</span>
                                                    <span className="font-mono text-violet-300 text-[10px]">27–29 Oct</span>
                                                  </div>
                                                  <div className="text-[10px] text-white/50">Early Arrival • Checkout 30th</div>
                                                </div>
                                              </label>
                                              <label className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer text-xs transition-all ${(member.accommodationDate === "2026-10-30" || member.extraDays === "after_30") ? "border-violet-400 bg-violet-500/20 text-white font-medium" : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20"}`}>
                                                <input
                                                  type="radio"
                                                  name={`member3DaysOption-${event.id}-${index}`}
                                                  value="2026-10-30"
                                                  checked={member.accommodationDate === "2026-10-30" || member.extraDays === "after_30"}
                                                  onChange={() => {
                                                    updateTeamMemberMultiple(event.id, index, {
                                                      accommodationDate: "2026-10-30",
                                                      extraDays: "after_30",
                                                    });
                                                  }}
                                                  className="sr-only"
                                                />
                                                <div className={`mt-0.5 w-3 h-3 rounded-full border flex items-center justify-center shrink-0 ${(member.accommodationDate === "2026-10-30" || member.extraDays === "after_30") ? "border-violet-400 bg-violet-500" : "border-white/30"}`}>
                                                  {(member.accommodationDate === "2026-10-30" || member.extraDays === "after_30") && <div className="w-1 h-1 rounded-full bg-white" />}
                                                </div>
                                                <div className="flex-1">
                                                  <div className="flex items-center justify-between">
                                                    <span className="font-semibold text-white">30th Oct (Day After)</span>
                                                    <span className="font-mono text-violet-300 text-[10px]">28–30 Oct</span>
                                                  </div>
                                                  <div className="text-[10px] text-white/50">Extended Stay • Checkout 31st</div>
                                                </div>
                                              </label>
                                            </div>
                                          </div>
                                        )}
                                        {member.accommodationPlanSlug === "4_days" && (
                                          <div className="mt-3 p-3 rounded-xl border border-white/10 bg-white/[0.02] flex items-center gap-2.5 text-xs text-white/70">
                                            <Calendar size={14} className="text-violet-400 shrink-0" />
                                            <span>Includes all 4 days: <strong className="text-white">27th to 30th October</strong> (4 Nights • Checkout 31st morning). Day before fest + both fest days + day after fest.</span>
                                          </div>
                                        )}
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

                  <Field label="COLLEGE STATE / UT">
                    <input
                      type="text"
                      name="state"
                      list="indian-states"
                      placeholder="Select college state / UT"
                      required
                      autoComplete="off"
                      className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3.5 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40"
                    />
                    <p className="text-xs text-white/50 leading-relaxed">
                      Select the state/UT where your college or university is located, not your home state.
                    </p>
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
                                    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
                                      {baseAccommodationPlans.map((plan) => (
                                        <label key={plan.id} className="relative flex cursor-pointer flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-all hover:border-violet-400/40 has-[:checked]:border-violet-500 has-[:checked]:bg-violet-500/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)]">
                                          <input
                                            type="radio"
                                            name="accommodationPlanSlug"
                                            value={plan.slug}
                                            checked={mainAccommodationSlug === plan.slug}
                                            onChange={(e) => {
                                              const val = e.target.value;
                                              setMainAccommodationSlug(val);
                                              if (val === "3_days") {
                                                if (mainAccommodationDate !== "2026-10-27" && mainAccommodationDate !== "2026-10-30") {
                                                  setMainAccommodationDate("2026-10-27");
                                                  setMainExtraDays("before_27");
                                                }
                                              } else if (val === "1_day") {
                                                if (!["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].includes(mainAccommodationDate)) {
                                                  setMainAccommodationDate("2026-10-28");
                                                  setMainExtraDays("none");
                                                }
                                              } else if (val === "2_days") {
                                                setMainAccommodationDate("2026-10-28");
                                                setMainExtraDays("none");
                                              } else if (val === "4_days") {
                                                setMainAccommodationDate("2026-10-27");
                                                setMainExtraDays("both");
                                              }
                                            }}
                                            className="peer sr-only"
                                          />
                                          <span className="font-medium text-white text-sm leading-tight">{plan.name}</span>
                                          <span className="font-mono text-xs font-semibold text-emerald-400">
                                            ₹{plan.price}
                                          </span>
                                          <span className="text-[10px] font-mono text-white/40 mt-1">
                                            {formatAccommodationDate(
                                              plan.duration,
                                              mainAccommodationSlug === plan.slug ? mainAccommodationDate : undefined,
                                              mainAccommodationSlug === plan.slug ? mainExtraDays : undefined
                                            )}
                                          </span>
                                        </label>
                                      ))}
                                    </div>
                                    {mainAccommodationSlug === "1_day" && (
                                      <div className="mt-3 p-3.5 rounded-xl border border-violet-500/30 bg-violet-950/20 backdrop-blur-sm">
                                        <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-300 mb-2">
                                          <Calendar size={13} className="text-violet-400" />
                                          <span>Choose Your 1-Day Accommodation Date:</span>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                                          <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer text-xs transition-all ${mainAccommodationDate === "2026-10-27" ? "border-violet-400 bg-violet-500/20 text-white font-medium" : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20"}`}>
                                            <input
                                              type="radio"
                                              name="mainAccommodationDate"
                                              value="2026-10-27"
                                              checked={mainAccommodationDate === "2026-10-27"}
                                              onChange={() => setMainAccommodationDate("2026-10-27")}
                                              className="sr-only"
                                            />
                                            <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${mainAccommodationDate === "2026-10-27" ? "border-violet-400 bg-violet-500" : "border-white/30"}`}>
                                              {mainAccommodationDate === "2026-10-27" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                            </div>
                                            <div>
                                              <div className="text-xs font-medium">27th Oct (Day Before)</div>
                                              <div className="text-[10px] text-white/50">Early arrival • Tue night</div>
                                            </div>
                                          </label>
                                          <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer text-xs transition-all ${mainAccommodationDate === "2026-10-28" ? "border-violet-400 bg-violet-500/20 text-white font-medium" : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20"}`}>
                                            <input
                                              type="radio"
                                              name="mainAccommodationDate"
                                              value="2026-10-28"
                                              checked={mainAccommodationDate === "2026-10-28"}
                                              onChange={() => setMainAccommodationDate("2026-10-28")}
                                              className="sr-only"
                                            />
                                            <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${mainAccommodationDate === "2026-10-28" ? "border-violet-400 bg-violet-500" : "border-white/30"}`}>
                                              {mainAccommodationDate === "2026-10-28" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                            </div>
                                            <div>
                                              <div className="text-xs font-medium">28th Oct (Day 1)</div>
                                              <div className="text-[10px] text-white/50">Fest Day 1 • Wed night</div>
                                            </div>
                                          </label>
                                          <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer text-xs transition-all ${mainAccommodationDate === "2026-10-29" ? "border-violet-400 bg-violet-500/20 text-white font-medium" : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20"}`}>
                                            <input
                                              type="radio"
                                              name="mainAccommodationDate"
                                              value="2026-10-29"
                                              checked={mainAccommodationDate === "2026-10-29"}
                                              onChange={() => setMainAccommodationDate("2026-10-29")}
                                              className="sr-only"
                                            />
                                            <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${mainAccommodationDate === "2026-10-29" ? "border-violet-400 bg-violet-500" : "border-white/30"}`}>
                                              {mainAccommodationDate === "2026-10-29" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                            </div>
                                            <div>
                                              <div className="text-xs font-medium">29th Oct (Day 2)</div>
                                              <div className="text-[10px] text-white/50">Fest Day 2 • Thu night</div>
                                            </div>
                                          </label>
                                          <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer text-xs transition-all ${mainAccommodationDate === "2026-10-30" ? "border-violet-400 bg-violet-500/20 text-white font-medium" : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20"}`}>
                                            <input
                                              type="radio"
                                              name="mainAccommodationDate"
                                              value="2026-10-30"
                                              checked={mainAccommodationDate === "2026-10-30"}
                                              onChange={() => setMainAccommodationDate("2026-10-30")}
                                              className="sr-only"
                                            />
                                            <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${mainAccommodationDate === "2026-10-30" ? "border-violet-400 bg-violet-500" : "border-white/30"}`}>
                                              {mainAccommodationDate === "2026-10-30" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                            </div>
                                            <div>
                                              <div className="text-xs font-medium">30th Oct (Day After)</div>
                                              <div className="text-[10px] text-white/50">Extended stay • Fri night</div>
                                            </div>
                                          </label>
                                        </div>
                                      </div>
                                    )}
                                    {mainAccommodationSlug === "2_days" && (
                                      <div className="mt-3 p-3 rounded-xl border border-white/10 bg-white/[0.02] flex items-center gap-2.5 text-xs text-white/70">
                                        <Calendar size={14} className="text-violet-400 shrink-0" />
                                        <span>Includes both official fest days: <strong className="text-white">28th &amp; 29th October</strong> (2 Nights • Checkout 30th morning).</span>
                                      </div>
                                    )}
                                    {mainAccommodationSlug === "3_days" && (
                                      <div className="mt-3 p-3.5 rounded-xl border border-violet-500/30 bg-violet-950/20 backdrop-blur-sm">
                                        <div className="flex items-center justify-between gap-1.5 text-xs font-semibold text-violet-300 mb-2">
                                          <div className="flex items-center gap-1.5">
                                            <Calendar size={13} className="text-violet-400" />
                                            <span>Choose Extra Day for 3-Day Accommodation (3 Nights):</span>
                                          </div>
                                          <span className="text-[11px] font-mono text-emerald-400 font-semibold">₹1,498 Total</span>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                          <label className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer text-xs transition-all ${(mainAccommodationDate === "2026-10-27" || mainExtraDays === "before_27") ? "border-violet-400 bg-violet-500/20 text-white font-medium" : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20"}`}>
                                            <input
                                              type="radio"
                                              name="main3DaysOption"
                                              value="2026-10-27"
                                              checked={mainAccommodationDate === "2026-10-27" || mainExtraDays === "before_27"}
                                              onChange={() => {
                                                setMainAccommodationDate("2026-10-27");
                                                setMainExtraDays("before_27");
                                              }}
                                              className="sr-only"
                                            />
                                            <div className={`mt-0.5 w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${(mainAccommodationDate === "2026-10-27" || mainExtraDays === "before_27") ? "border-violet-400 bg-violet-500" : "border-white/30"}`}>
                                              {(mainAccommodationDate === "2026-10-27" || mainExtraDays === "before_27") && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                            </div>
                                            <div className="flex-1">
                                              <div className="flex items-center justify-between">
                                                <span className="font-semibold text-white">27th Oct (Day Before Fest)</span>
                                                <span className="font-mono text-violet-300 text-[11px]">27–29 Oct</span>
                                              </div>
                                              <div className="text-[11px] text-white/50 mt-0.5">Early Arrival • 27th, 28th &amp; 29th Oct (Checkout 30th)</div>
                                            </div>
                                          </label>

                                          <label className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer text-xs transition-all ${(mainAccommodationDate === "2026-10-30" || mainExtraDays === "after_30") ? "border-violet-400 bg-violet-500/20 text-white font-medium" : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20"}`}>
                                            <input
                                              type="radio"
                                              name="main3DaysOption"
                                              value="2026-10-30"
                                              checked={mainAccommodationDate === "2026-10-30" || mainExtraDays === "after_30"}
                                              onChange={() => {
                                                setMainAccommodationDate("2026-10-30");
                                                setMainExtraDays("after_30");
                                              }}
                                              className="sr-only"
                                            />
                                            <div className={`mt-0.5 w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${(mainAccommodationDate === "2026-10-30" || mainExtraDays === "after_30") ? "border-violet-400 bg-violet-500" : "border-white/30"}`}>
                                              {(mainAccommodationDate === "2026-10-30" || mainExtraDays === "after_30") && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                            </div>
                                            <div className="flex-1">
                                              <div className="flex items-center justify-between">
                                                <span className="font-semibold text-white">30th Oct (Day After Fest)</span>
                                                <span className="font-mono text-violet-300 text-[11px]">28–30 Oct</span>
                                              </div>
                                              <div className="text-[11px] text-white/50 mt-0.5">Extended Stay • 28th, 29th &amp; 30th Oct (Checkout 31st)</div>
                                            </div>
                                          </label>
                                        </div>
                                      </div>
                                    )}
                                    {mainAccommodationSlug === "4_days" && (
                                      <div className="mt-3 p-3 rounded-xl border border-white/10 bg-white/[0.02] flex items-center gap-2.5 text-xs text-white/70">
                                        <Calendar size={14} className="text-violet-400 shrink-0" />
                                        <span>Includes all 4 days: <strong className="text-white">27th to 30th October</strong> (4 Nights • Checkout 31st morning). Day before fest + both fest days + day after fest.</span>
                                      </div>
                                    )}
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

                        <Field label="COLLEGE STATE / UT">
                          <input
                            type="text"
                            value={facultyState.state}
                            onChange={(e) => setFacultyState({ ...facultyState, state: e.target.value })}
                            list="indian-states"
                            placeholder="Select college state / UT"
                            required={facultyEnabled}
                            autoComplete="off"
                            className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition-all focus:border-violet-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-violet-400/40"
                          />
                          <p className="text-xs text-white/50 leading-relaxed">
                            Select the state/UT where your college or university is located, not your home state.
                          </p>
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
                                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
                                  {baseAccommodationPlans.map((plan) => (
                                    <label key={plan.id} className="relative flex cursor-pointer flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-all hover:border-violet-400/40 has-[:checked]:border-violet-500 has-[:checked]:bg-violet-500/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)]">
                                      <input
                                        type="radio"
                                        name="facultyAccommodationPlanSlug"
                                        value={plan.slug}
                                        checked={facultyState.accommodationPlanSlug === plan.slug}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          if (val === "3_days") {
                                            const is30 = facultyState.accommodationDate === "2026-10-30";
                                            setFacultyState({
                                              ...facultyState,
                                              accommodationPlanSlug: val,
                                              accommodationDate: is30 ? "2026-10-30" : "2026-10-27",
                                              extraDays: is30 ? "after_30" : "before_27",
                                            });
                                          } else if (val === "1_day") {
                                            const validDate = ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].includes(facultyState.accommodationDate)
                                              ? facultyState.accommodationDate
                                              : "2026-10-28";
                                            setFacultyState({
                                              ...facultyState,
                                              accommodationPlanSlug: val,
                                              accommodationDate: validDate,
                                              extraDays: "none",
                                            });
                                          } else if (val === "2_days") {
                                            setFacultyState({
                                              ...facultyState,
                                              accommodationPlanSlug: val,
                                              accommodationDate: "2026-10-28",
                                              extraDays: "none",
                                            });
                                          } else if (val === "4_days") {
                                            setFacultyState({
                                              ...facultyState,
                                              accommodationPlanSlug: val,
                                              accommodationDate: "2026-10-27",
                                              extraDays: "both",
                                            });
                                          } else {
                                            setFacultyState({
                                              ...facultyState,
                                              accommodationPlanSlug: "",
                                              extraDays: "none",
                                            });
                                          }
                                        }}
                                        className="peer sr-only"
                                      />
                                      <span className="font-medium text-white text-sm leading-tight">{plan.name}</span>
                                      <span className="font-mono text-xs font-semibold text-emerald-400">
                                        ₹{plan.price}
                                      </span>
                                      <span className="text-[10px] font-mono text-white/40 mt-1">
                                        {formatAccommodationDate(
                                          plan.duration,
                                          facultyState.accommodationPlanSlug === plan.slug ? facultyState.accommodationDate : undefined,
                                          facultyState.accommodationPlanSlug === plan.slug ? facultyState.extraDays : undefined
                                        )}
                                      </span>
                                    </label>
                                  ))}
                                </div>
                                {facultyState.accommodationPlanSlug === "1_day" && (
                                  <div className="mt-3 p-3.5 rounded-xl border border-violet-500/30 bg-violet-950/20 backdrop-blur-sm">
                                    <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-300 mb-2">
                                      <Calendar size={13} className="text-violet-400" />
                                      <span>Choose Faculty 1-Day Accommodation Date:</span>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                                      <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer text-xs transition-all ${facultyState.accommodationDate === "2026-10-27" ? "border-violet-400 bg-violet-500/20 text-white font-medium" : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20"}`}>
                                        <input
                                          type="radio"
                                          name="facultyAccommodationDate"
                                          value="2026-10-27"
                                          checked={facultyState.accommodationDate === "2026-10-27"}
                                          onChange={() => setFacultyState({ ...facultyState, accommodationDate: "2026-10-27" })}
                                          className="sr-only"
                                        />
                                        <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${facultyState.accommodationDate === "2026-10-27" ? "border-violet-400 bg-violet-500" : "border-white/30"}`}>
                                          {facultyState.accommodationDate === "2026-10-27" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                        </div>
                                        <div>
                                          <div className="text-xs font-medium">27th Oct (Day Before)</div>
                                          <div className="text-[10px] text-white/50">Early arrival • Tue night</div>
                                        </div>
                                      </label>
                                      <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer text-xs transition-all ${facultyState.accommodationDate === "2026-10-28" ? "border-violet-400 bg-violet-500/20 text-white font-medium" : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20"}`}>
                                        <input
                                          type="radio"
                                          name="facultyAccommodationDate"
                                          value="2026-10-28"
                                          checked={facultyState.accommodationDate === "2026-10-28"}
                                          onChange={() => setFacultyState({ ...facultyState, accommodationDate: "2026-10-28" })}
                                          className="sr-only"
                                        />
                                        <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${facultyState.accommodationDate === "2026-10-28" ? "border-violet-400 bg-violet-500" : "border-white/30"}`}>
                                          {facultyState.accommodationDate === "2026-10-28" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                        </div>
                                        <div>
                                          <div className="text-xs font-medium">28th Oct (Day 1)</div>
                                          <div className="text-[10px] text-white/50">Fest Day 1 • Wed night</div>
                                        </div>
                                      </label>
                                      <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer text-xs transition-all ${facultyState.accommodationDate === "2026-10-29" ? "border-violet-400 bg-violet-500/20 text-white font-medium" : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20"}`}>
                                        <input
                                          type="radio"
                                          name="facultyAccommodationDate"
                                          value="2026-10-29"
                                          checked={facultyState.accommodationDate === "2026-10-29"}
                                          onChange={() => setFacultyState({ ...facultyState, accommodationDate: "2026-10-29" })}
                                          className="sr-only"
                                        />
                                        <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${facultyState.accommodationDate === "2026-10-29" ? "border-violet-400 bg-violet-500" : "border-white/30"}`}>
                                          {facultyState.accommodationDate === "2026-10-29" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                        </div>
                                        <div>
                                          <div className="text-xs font-medium">29th Oct (Day 2)</div>
                                          <div className="text-[10px] text-white/50">Fest Day 2 • Thu night</div>
                                        </div>
                                      </label>
                                      <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer text-xs transition-all ${facultyState.accommodationDate === "2026-10-30" ? "border-violet-400 bg-violet-500/20 text-white font-medium" : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20"}`}>
                                        <input
                                          type="radio"
                                          name="facultyAccommodationDate"
                                          value="2026-10-30"
                                          checked={facultyState.accommodationDate === "2026-10-30"}
                                          onChange={() => setFacultyState({ ...facultyState, accommodationDate: "2026-10-30" })}
                                          className="sr-only"
                                        />
                                        <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${facultyState.accommodationDate === "2026-10-30" ? "border-violet-400 bg-violet-500" : "border-white/30"}`}>
                                          {facultyState.accommodationDate === "2026-10-30" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                        </div>
                                        <div>
                                          <div className="text-xs font-medium">30th Oct (Day After)</div>
                                          <div className="text-[10px] text-white/50">Extended stay • Fri night</div>
                                        </div>
                                      </label>
                                    </div>
                                  </div>
                                )}
                                {facultyState.accommodationPlanSlug === "2_days" && (
                                  <div className="mt-3 p-3 rounded-xl border border-white/10 bg-white/[0.02] flex items-center gap-2.5 text-xs text-white/70">
                                    <Calendar size={14} className="text-violet-400 shrink-0" />
                                    <span>Includes both official fest days: <strong className="text-white">28th &amp; 29th October</strong> (2 Nights • Checkout 30th morning).</span>
                                  </div>
                                )}
                                {facultyState.accommodationPlanSlug === "3_days" && (
                                  <div className="mt-3 p-3.5 rounded-xl border border-violet-500/30 bg-violet-950/20 backdrop-blur-sm">
                                    <div className="flex items-center justify-between gap-1.5 text-xs font-semibold text-violet-300 mb-2">
                                      <div className="flex items-center gap-1.5">
                                        <Calendar size={13} className="text-violet-400" />
                                        <span>Choose Extra Day for Faculty 3-Day Accommodation (3 Nights):</span>
                                      </div>
                                      <span className="text-[11px] font-mono text-emerald-400 font-semibold">₹1,498 Total</span>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                      <label className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer text-xs transition-all ${(facultyState.accommodationDate === "2026-10-27" || facultyState.extraDays === "before_27") ? "border-violet-400 bg-violet-500/20 text-white font-medium" : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20"}`}>
                                        <input
                                          type="radio"
                                          name="faculty3DaysOption"
                                          value="2026-10-27"
                                          checked={facultyState.accommodationDate === "2026-10-27" || facultyState.extraDays === "before_27"}
                                          onChange={() => {
                                            setFacultyState({
                                              ...facultyState,
                                              accommodationDate: "2026-10-27",
                                              extraDays: "before_27",
                                            });
                                          }}
                                          className="sr-only"
                                        />
                                        <div className={`mt-0.5 w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${(facultyState.accommodationDate === "2026-10-27" || facultyState.extraDays === "before_27") ? "border-violet-400 bg-violet-500" : "border-white/30"}`}>
                                          {(facultyState.accommodationDate === "2026-10-27" || facultyState.extraDays === "before_27") && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                        </div>
                                        <div className="flex-1">
                                          <div className="flex items-center justify-between">
                                            <span className="font-semibold text-white">27th Oct (Day Before Fest)</span>
                                            <span className="font-mono text-violet-300 text-[11px]">27–29 Oct</span>
                                          </div>
                                          <div className="text-[11px] text-white/50 mt-0.5">Early Arrival • 27th, 28th &amp; 29th Oct (Checkout 30th)</div>
                                        </div>
                                      </label>

                                      <label className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer text-xs transition-all ${(facultyState.accommodationDate === "2026-10-30" || facultyState.extraDays === "after_30") ? "border-violet-400 bg-violet-500/20 text-white font-medium" : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/20"}`}>
                                        <input
                                          type="radio"
                                          name="faculty3DaysOption"
                                          value="2026-10-30"
                                          checked={facultyState.accommodationDate === "2026-10-30" || facultyState.extraDays === "after_30"}
                                          onChange={() => {
                                            setFacultyState({
                                              ...facultyState,
                                              accommodationDate: "2026-10-30",
                                              extraDays: "after_30",
                                            });
                                          }}
                                          className="sr-only"
                                        />
                                        <div className={`mt-0.5 w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${(facultyState.accommodationDate === "2026-10-30" || facultyState.extraDays === "after_30") ? "border-violet-400 bg-violet-500" : "border-white/30"}`}>
                                          {(facultyState.accommodationDate === "2026-10-30" || facultyState.extraDays === "after_30") && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                        </div>
                                        <div className="flex-1">
                                          <div className="flex items-center justify-between">
                                            <span className="font-semibold text-white">30th Oct (Day After Fest)</span>
                                            <span className="font-mono text-violet-300 text-[11px]">28–30 Oct</span>
                                          </div>
                                          <div className="text-[11px] text-white/50 mt-0.5">Extended Stay • 28th, 29th &amp; 30th Oct (Checkout 31st)</div>
                                        </div>
                                      </label>
                                    </div>
                                  </div>
                                )}
                                {facultyState.accommodationPlanSlug === "4_days" && (
                                  <div className="mt-3 p-3 rounded-xl border border-white/10 bg-white/[0.02] flex items-center gap-2.5 text-xs text-white/70">
                                    <Calendar size={14} className="text-violet-400 shrink-0" />
                                    <span>Includes all 4 days: <strong className="text-white">27th to 30th October</strong> (4 Nights • Checkout 31st morning). Day before fest + both fest days + day after fest.</span>
                                  </div>
                                )}
                          </Field>
                        </div>
                      )}
                    </motion.div>
                  )}
                </div>
              </div>
            )}

            {/* PAYMENT SUMMARY & CHECKOUT TERMINAL */}
            {(selectedEvents.length > 0 || mainAccommodationSlug || (facultyEnabled && facultyState.accommodationPlanSlug)) && (
              <div className="rounded-[28px] border border-violet-500/35 bg-gradient-to-br from-violet-950/40 via-[#0b0816]/75 to-[#040208]/90 p-6 sm:p-8 md:p-10 backdrop-blur-2xl shadow-[0_20px_70px_rgba(168,85,247,0.2),inset_0_1px_1px_rgba(255,255,255,0.12)]">
                <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between border-b border-white/10 pb-6">
                  <div>
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-300">
                      REGISTRATION SUMMARY
                    </p>

                    <h3 className="mt-2 text-2xl sm:text-3xl font-light tracking-tight text-white">
                      {selectedEvents.length > 0
                        ? `${selectedEvents.length} ${selectedEvents.length === 1 ? "Competition" : "Competitions"} Selected`
                        : "Accommodation Add-on Selected"}
                    </h3>

                    <div className="mt-5 space-y-2.5">
                      {/* Competitions Line Items */}
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
                              {amount > 0 ? `₹${amount.toLocaleString("en-IN")}` : "Free (₹0)"}
                            </span>
                          </div>
                        );
                      })}

                      {/* Main Accommodation Line Item */}
                      {mainAccommodationSlug && (
                        <div className="flex items-center justify-between gap-6 text-sm">
                          <div className="min-w-0">
                            <span className="text-zinc-300">
                              Accommodation: {accommodationPlans.find((p) => p.slug === mainAccommodationSlug)?.name || mainAccommodationSlug}
                            </span>
                            <span className="block text-[11px] font-mono text-violet-300/70">
                              {formatAccommodationDate(
                                accommodationPlans.find((p) => p.slug === mainAccommodationSlug)?.duration || 1,
                                mainAccommodationDate,
                                mainExtraDays
                              )}
                            </span>
                          </div>

                          <span className="font-mono text-sm font-medium text-white shrink-0">
                            ₹{getAccommodationCost(mainAccommodationSlug, mainExtraDays).toLocaleString("en-IN")}
                          </span>
                        </div>
                      )}

                      {/* Faculty Accommodation Line Item */}
                      {facultyEnabled && facultyState.accommodationPlanSlug && (
                        <div className="flex items-center justify-between gap-6 text-sm">
                          <div className="min-w-0">
                            <span className="text-zinc-300">
                              Faculty Stay: {accommodationPlans.find((p) => p.slug === facultyState.accommodationPlanSlug)?.name || facultyState.accommodationPlanSlug}
                            </span>
                            <span className="block text-[11px] font-mono text-violet-300/70">
                              {formatAccommodationDate(
                                accommodationPlans.find((p) => p.slug === facultyState.accommodationPlanSlug)?.duration || 1,
                                facultyState.accommodationDate,
                                facultyState.extraDays
                              )}
                            </span>
                          </div>

                          <span className="font-mono text-sm font-medium text-white shrink-0">
                            ₹{getAccommodationCost(facultyState.accommodationPlanSlug, facultyState.extraDays).toLocaleString("en-IN")}
                          </span>
                        </div>
                      )}

                      {/* Team Member Accommodation Line Items */}
                      {selectedEvents.map((event) => {
                        if (!isTeamEvent(event)) return null;
                        const state = getTeamState(event.id);
                        return state.members.map((m, mIdx) => {
                          if (!m.accommodationPlanSlug) return null;
                          const plan = accommodationPlans.find((p) => p.slug === m.accommodationPlanSlug);
                          return (
                            <div key={`summary-member-acc-${event.id}-${mIdx}`} className="flex items-center justify-between gap-6 text-sm">
                              <div className="min-w-0">
                                <span className="text-zinc-300">
                                  {m.name ? `${m.name} (Member 0${mIdx + 2})` : `Member 0${mIdx + 2}`} Stay: {plan?.name || m.accommodationPlanSlug}
                                </span>
                                <span className="block text-[11px] font-mono text-violet-300/70">
                                  {formatAccommodationDate(
                                    plan?.duration || 1,
                                    m.accommodationDate,
                                    m.extraDays
                                  )}
                                </span>
                              </div>

                              <span className="font-mono text-sm font-medium text-white shrink-0">
                                ₹{getAccommodationCost(m.accommodationPlanSlug, m.extraDays).toLocaleString("en-IN")}
                              </span>
                            </div>
                          );
                        });
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
                  {selectedEvents.length === 0 && !mainAccommodationSlug && (!facultyEnabled || !facultyState.accommodationPlanSlug)
                    ? "Select at least one competition or accommodation to continue."
                    : selectedEvents.length > 0 && (mainAccommodationSlug || (facultyEnabled && facultyState.accommodationPlanSlug))
                      ? `${selectedEvents.length} event${selectedEvents.length === 1 ? "" : "s"} + Accommodation ready for registration.`
                      : selectedEvents.length > 0
                        ? `${selectedEvents.length} event${selectedEvents.length === 1 ? "" : "s"} ready for registration.`
                        : "Accommodation booking ready for registration."}
                </p>

                {totalPrice > 0 && (
                  <p className="mt-1 font-mono text-sm font-semibold text-violet-300">
                    Grand Total: ₹{totalPrice.toLocaleString("en-IN")}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={
                  loading ||
                  eventsLoading ||
                  (selectedEventIds.length === 0 && !mainAccommodationSlug && (!facultyEnabled || !facultyState.accommodationPlanSlug))
                }
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

          {/* Registration Detail Panel */}
          {selectedDetailEvent && participantLookup && (
            <RegistrationDetailPanel
              isOpen={isDetailPanelOpen}
              onClose={() => setIsDetailPanelOpen(false)}
              participant={{
                participantId: participantLookup.participantId,
                name: participantLookup.name,
                college: participantLookup.college,
                email: participantLookup.email,
                phone: participantLookup.phone,
                gender: (participantLookup as any).gender,
                state: (participantLookup as any).state,
              }}
              event={{
                participantEventId: selectedDetailEvent.participantEventId,
                eventId: selectedDetailEvent.eventId,
                eventName: selectedDetailEvent.eventName,
                category: selectedDetailEvent.category || null,
                registrationType: selectedDetailEvent.registrationType || (selectedDetailEvent.teamName ? "team" : "individual"),
                teamName: selectedDetailEvent.teamName || null,
                isTeamLeader: Boolean(selectedDetailEvent.isTeamLeader),
                paymentStatus: selectedDetailEvent.paymentStatus || null,
                paymentAmount: selectedDetailEvent.paymentAmount || null,
                registrationStatus: selectedDetailEvent.registrationStatus || null,
                checkedIn: Boolean(selectedDetailEvent.checkedIn),
                teamMembers: selectedDetailEvent.teamMembers,
              }}
              allEvents={participantLookupEvents.map((e) => ({
                participantEventId: e.participantEventId,
                eventId: e.eventId,
                eventName: e.eventName,
                category: e.category || null,
                registrationType: e.registrationType || (e.teamName ? "team" : "individual"),
                teamName: e.teamName || null,
                isTeamLeader: Boolean(e.isTeamLeader),
                paymentStatus: e.paymentStatus || null,
                paymentAmount: e.paymentAmount || null,
                registrationStatus: e.registrationStatus || null,
                checkedIn: Boolean(e.checkedIn),
                teamMembers: e.teamMembers,
              }))}
              accommodations={participantLookupAccommodations.map((a) => ({
                id: a.id || a.participantAccommodationId,
                planName: a.planName,
                planSlug: a.planSlug,
                startDate: a.startDate,
                endDate: a.endDate,
                durationDays: a.durationDays,
                amount: a.amount || a.price || 0,
                currency: a.currency || "INR",
                status: a.status,
                allocationStatus: a.allocationStatus || undefined,
                hostelName: a.hostelName || undefined,
                roomNumber: a.roomNumber || undefined,
                checkedIn: a.checkedIn,
                checkedInAt: (a as any).checkedInAt || undefined,
                checkedOut: a.checkedOut,
                checkedOutAt: (a as any).checkedOutAt || undefined,
              }))}
              onOpenAddAccommodation={handleOpenAddAccommodation}
              onOpenTeamAccommodation={() => handleOpenTeamAccommodation(selectedDetailEvent)}
              onPaymentRecovery={(ev) => {
                const found = participantLookupEvents.find((e) => e.participantEventId === ev.participantEventId);
                if (found) handlePaymentRecovery(found);
              }}
            />
          )}

          {/* Team Accommodation Modal */}
          {isTeamAccommodationModalOpen && activeTeamEventForAccommodation && (
            <TeamAccommodationModal
              isOpen={isTeamAccommodationModalOpen}
              onClose={() => setIsTeamAccommodationModalOpen(false)}
              participantEventId={activeTeamEventForAccommodation.participantEventId}
              teamName={activeTeamEventForAccommodation.teamName || "Team"}
              eventName={activeTeamEventForAccommodation.eventName}
              members={(activeTeamEventForAccommodation.teamMembers || []).map((m) => ({
                id: m.id,
                name: m.name,
                email: m.email,
                phone: m.phone,
                isTeamLeader: m.isTeamLeader,
                participantId: m.participantId,
                college: m.college,
                accommodations: m.accommodations,
              }))}
              onProceedToPayment={handleModalPayment}
            />
          )}

          {/* Individual Add Accommodation Stay Modal */}
          {isAddAccommodationModalOpen && (
            <AddAccommodationModal
              isOpen={isAddAccommodationModalOpen}
              onClose={() => setIsAddAccommodationModalOpen(false)}
              participantEmail={normalizedSessionEmail || existingParticipantEmail || participantLookup?.email || ""}
              participantName={participantLookup?.name || "Participant"}
              existingStays={participantLookupAccommodations.map((a) => ({
                id: a.id || a.participantAccommodationId,
                planName: a.planName,
                startDate: a.startDate,
                endDate: a.endDate,
                durationDays: a.durationDays,
                amount: a.amount || a.price || 0,
                status: a.status,
              }))}
              onProceedToPayment={handleModalPayment}
            />
          )}
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