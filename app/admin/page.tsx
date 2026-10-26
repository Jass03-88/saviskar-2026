"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Search,
  RefreshCw,
  LogOut,
  QrCode,
  Download,
  Users,
  UserCheck,
  Clock3,
  CalendarDays,
  X,
  Check,
  Trash2,
  Mail,
  Phone,
  GraduationCap,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Bed,
  Building2,
  SlidersHorizontal,
  BarChart3,
  ShieldCheck,
  Lock,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { INDIAN_STATES_AND_UT } from "@/lib/states";
import { parseAdminCategories } from "@/lib/admin/scope";
import {
  generateRegistrationsCsv,
  generateRegistrationExportCsv,
  generateParticipantExportCsv,
} from "@/lib/admin/csv-export";
import {
  exportRegistrationXlsx,
  exportParticipantXlsx,
} from "@/lib/admin/excel-export";
import { CsvExportDropdown } from "@/components/admin/CsvExportDropdown";
import AdminPageLoader from "@/components/admin/AdminPageLoader";
import { PaymentVerificationDialog } from "@/components/admin/PaymentVerificationDialog";
import { ResendEmailDialog } from "@/components/admin/ResendEmailDialog";
import { SitePageLocksModal } from "@/components/admin/SitePageLocksModal";
import type { SiteAccessConfig } from "@/lib/config/site-access";
import { isCgcInstitution } from "@/lib/admin/college-filter";
import { calculateTeamPaymentSummary } from "@/lib/admin/team-payment-summary";

/* =========================================================
   TYPES
========================================================= */

export type AccommodationDetail = {
  id: string;
  plan_name: string;
  start_date: string;
  end_date: string;
  duration_days: number;
  amount: number;
  currency: string;
  status: string;
  hostel_name: string | null;
  room_number: string | null;
  checked_in: boolean;
  checked_in_at: string | null;
  checked_out: boolean;
  checked_out_at: string | null;
  payment_order_id?: string | null;
  payment_order_reference?: string | null;
  gateway_payment_id?: string | null;
  payment_status?: string | null;
  payment_id?: string | null;
};

type Participant = {
  id: string;
  participant_id: string;
  name: string;
  college: string | null;
  email: string;
  phone: string | null;
  photo_url: string | null;
  gender?: string | null;
  state?: string | null;
  id_card_storage_path?: string | null;
  created_at: string;
  accommodation?: AccommodationDetail | null;
  accommodations?: AccommodationDetail[] | null;
};

type ParticipantEvent = {
  id: string;
  participant_id: string;
  event_id: string;
  registration_status: string | null;
  payment_status: string | null;
  payment_amount: number | null;
  payment_id: string | null;
  team_name: string | null;
  checked_in: boolean | null;
  checked_in_at: string | null;
  main_checked_in: boolean | null;
  main_checked_in_at: string | null;
  registration_group_id?: string | null;
  is_archived: boolean | null;
  created_at: string;
};

type EventRecord = {
  id: string;
  name: string;
  category: string | null;
  payment_type: string | null;
  registration_fee: number | null;
  registration_limit?: number | null;
};

type RegistrationMember = {
  id: string;
  participant_event_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_team_leader: boolean | null;
  participant_id: string | null;
  gender?: string | null;
  state?: string | null;
  id_card_storage_path?: string | null;
  participants: {
    participant_id: string;
    college: string | null;
    gender?: string | null;
    state?: string | null;
    id_card_storage_path?: string | null;
  } | null;
  accommodation?: AccommodationDetail | null;
  accommodations?: AccommodationDetail[] | null;
};

type Registration = {
  participant: Participant;
  event: EventRecord | null;
  registration: ParticipantEvent;
  members?: RegistrationMember[];
  faculty?: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    college: string | null;
    gender?: string | null;
    state?: string | null;
    id_card_storage_path?: string | null;
    idCardStoragePath?: string | null;
  } | null;
  payment_order?: {
    id: string;
    order_reference: string;
    gateway: string | null;
    gateway_order_id: string | null;
    gateway_payment_id: string | null;
    status: string;
    updated_at: string;
  } | null;
  accommodation?: AccommodationDetail | null;
  accommodations?: AccommodationDetail[] | null;
};

type StatusFilter = "all" | "checked-in" | "pending";
type PaymentFilter = "all" | "any_pending" | "paid" | "pending" | "not_required";
type EventTypeFilter = "all" | "paid_events" | "free_events";
type ArchiveFilter = "active" | "archived" | "all";
type AdminRole = "master" | "admin";

/* =========================================================
   HELPERS
========================================================= */

function formatDate(value: string | null | undefined) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAmount(value: number | null) {
  const amount = Number(value || 0);

  return amount > 0
    ? `₹${amount.toLocaleString("en-IN")}`
    : "Free";
}

function paymentLabel(value: string | null) {
  if (!value) return "Unknown";

  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function paymentClass(value: string | null) {
  const status = value?.toLowerCase();

  if (status === "paid") {
    return "bg-green-50 text-green-700 border-green-100";
  }

  if (status === "pending") {
    return "bg-red-50 text-red-700 border-red-100";
  }

  return "bg-black/[0.04] text-black/45 border-black/10";
}

function maskEmail(email: string): string {
  if (!email) return "";
  const atIndex = email.indexOf("@");
  if (atIndex <= 1) return `***${email.slice(atIndex)}`;
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex);
  return `${local[0]}***${domain}`;
}

function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const cleaned = phone.replace(/\s+/g, "");
  if (cleaned.length >= 6) {
    return `${cleaned.slice(0, 2)}*****${cleaned.slice(-2)}`;
  }
  return "******";
}

function escapeCsv(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

/* =========================================================
   PAGE
========================================================= */

let globalDocumentRequestId = 0;

export default function AdminPage() {
  const router = useRouter();

  const [registrations, setRegistrations] =
    useState<Registration[]>([]);

  const [events, setEvents] =
    useState<EventRecord[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [hasLoaded, setHasLoaded] =
    useState(false);

  const [refreshing, setRefreshing] =
    useState(false);

  const [role, setRole] =
    useState<AdminRole | null>(null);

  const [adminIdentity, setAdminIdentity] = useState<{name: string | null, email: string | null, isPrimary: boolean} | null>(null);

  const [accommodationAccess, setAccommodationAccess] =
    useState<boolean>(false);

  const [assignedCategory, setAssignedCategory] =
    useState<string | null>(null);

  const [assignedEvents, setAssignedEvents] =
    useState<string[]>([]);

  const [error, setError] =
    useState("");

  const [search, setSearch] =
    useState("");

  const [eventFilter, setEventFilter] =
    useState("all");

  const [eventTypeFilter, setEventTypeFilter] =
    useState<EventTypeFilter>("all");

  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("all");

  const [paymentFilter, setPaymentFilter] =
    useState<PaymentFilter>("all");

  const [archiveFilter, setArchiveFilter] =
    useState<ArchiveFilter>("active");

  const [filterState, setFilterState] = useState<string>("all");

  const [exceptionFilter, setExceptionFilter] =
    useState<"all" | "payment_failed" | "payment_pending" | "paid_not_checked_in" | "main_checked_in_only" | "registered_unpaid">("all");

  const [paymentOverviewState, setPaymentOverviewState] = useState<"all" | "paid" | "unpaid" | "free">("all");
  const [paymentOverviewCategory, setPaymentOverviewCategory] = useState<"all" | "technical" | "non-technical" | "cultural">("all");
  const [includeAccommodation, setIncludeAccommodation] = useState(false);
  const [accommodationFilter, setAccommodationFilter] = useState<"all" | "with" | "without">("all");
  const [institutionFilter, setInstitutionFilter] = useState<"all" | "external" | "cgc">("all");
  const [serverAccommodationStats, setServerAccommodationStats] = useState<{
    totalBookings: number;
    paidBookings: number;
    pendingBookings: number;
    expectedAmount: number;
    paidAmount: number;
    outstandingAmount: number;
    checkedIn?: number;
  } | null>(null);

  const [selectedParticipantIds, setSelectedParticipantIds] =
    useState<Set<string>>(new Set());

  const [isVerificationOpen, setIsVerificationOpen] =
    useState(false);

  const [verificationMode, setVerificationMode] =
    useState<"selected" | "audit">("selected");

  const [isResendEmailOpen, setIsResendEmailOpen] =
    useState(false);

  const [isBreakdownOpen, setIsBreakdownOpen] = useState(true);
  const [breakdownCategory, setBreakdownCategory] = useState<string>("all");
  const [breakdownPaymentType, setBreakdownPaymentType] = useState<"all" | "paid" | "free">("all");
  const [breakdownSearch, setBreakdownSearch] = useState("");
  const [breakdownOriginFilter, setBreakdownOriginFilter] = useState<"all" | "external" | "cgc">("all");

  const handleInstitutionFilterChange = useCallback((val: "all" | "external" | "cgc") => {
    setInstitutionFilter(val);
    setBreakdownOriginFilter(val);
  }, []);

  useEffect(() => {
    setBreakdownOriginFilter(institutionFilter);
  }, [institutionFilter]);

  const [isPaymentOverviewOpen, setIsPaymentOverviewOpen] = useState(false);
  const [isEventAnalyticsOpen, setIsEventAnalyticsOpen] = useState(false);
  const [isPageLocksOpen, setIsPageLocksOpen] = useState(false);
  const [siteLocks, setSiteLocks] = useState<SiteAccessConfig | null>(null);

  const fetchSiteLocks = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/site-access");
      if (res.ok) {
        const data = await res.json();
        if (data?.siteAccess) {
          setSiteLocks(data.siteAccess);
        }
        if (typeof data?.isPrimary === "boolean") {
          setAdminIdentity((prev) =>
            prev
              ? { ...prev, isPrimary: data.isPrimary }
              : { name: null, email: null, isPrimary: data.isPrimary }
          );
        }
      }
    } catch (err) {
      console.warn("Failed to fetch site locks:", err);
    }
  }, []);

  const [selectedParticipant, setSelectedParticipant] =
    useState<Participant | null>(null);

  const [selectedParticipantEvents, setSelectedParticipantEvents] =
    useState<Registration[]>([]);

  const [updatingId, setUpdatingId] =
    useState<string | null>(null);

  const [deletingId, setDeletingId] =
    useState<string | null>(null);

  const [viewDocumentUrl, setViewDocumentUrl] = useState<string | null>(null);
  const [activeDocumentLabel, setActiveDocumentLabel] = useState<string | null>(null);
  const [activeDocumentPath, setActiveDocumentPath] = useState<string | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);

  const [facultyDocumentUrl, setFacultyDocumentUrl] = useState<string | null>(null);
  const [facultyDocumentLoading, setFacultyDocumentLoading] = useState(false);
  const [facultyDocumentError, setFacultyDocumentError] = useState<string | null>(null);

  const handleViewDocument = useCallback(
    async (
      path: string | null | undefined,
      target: "participant" | "faculty" = "participant",
      label?: string | null
    ) => {
      if (target === "faculty") {
        if (!path || !path.trim()) {
          setFacultyDocumentError("No ID card document was uploaded.");
          return;
        }
        setFacultyDocumentLoading(true);
        setFacultyDocumentError(null);
        setFacultyDocumentUrl(null);
        try {
          const res = await fetch("/api/admin/documents/signed-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: path.trim() }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || "Failed to load document");
          setFacultyDocumentUrl(json.signedUrl);
        } catch (e: any) {
          setFacultyDocumentError(e.message || "Document not available");
        } finally {
          setFacultyDocumentLoading(false);
        }
      } else {
        const requestId = ++globalDocumentRequestId;
        setViewDocumentUrl(null);
        setDocumentError(null);
        setActiveDocumentLabel(label ?? null);
        setActiveDocumentPath(path ?? null);

        if (!path || !path.trim()) {
          setDocumentError(
            label ? `No ID card document was uploaded for ${label}.` : "No ID card document was uploaded."
          );
          return;
        }

        setDocumentLoading(true);

        if (typeof document !== "undefined") {
          document.getElementById("participant-id-card-preview")?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
        }

        try {
          const res = await fetch("/api/admin/documents/signed-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: path.trim() }),
          });
          const json = await res.json();

          if (requestId !== globalDocumentRequestId) {
            return;
          }

          if (!res.ok) throw new Error(json.error || "Failed to load document");
          setViewDocumentUrl(json.signedUrl);
        } catch (e: any) {
          if (requestId !== globalDocumentRequestId) return;
          setDocumentError(e.message || "Document not available");
        } finally {
          if (requestId === globalDocumentRequestId) {
            setDocumentLoading(false);
          }
        }
      }
    },
    []
  );

  const [serverTotal, setServerTotal] = useState<number | null>(null);

  /* =======================================================
     LOAD DATA
  ======================================================= */

  const loadData = useCallback(
    async (refresh = false) => {
      if (refresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError("");

      try {
        const response = await fetch(
          "/api/admin/registrations?pageSize=10000",
          { cache: "no-store" }
        );

        if (
          response.status === 401 ||
          response.status === 403
        ) {
          router.replace("/admin/login");
          return;
        }

        const payload =
          (await response.json()) as {
            registrations?: Registration[];
            events?: EventRecord[];
            role?: AdminRole;
            adminEmail?: string | null;
            adminName?: string | null;
            isPrimary?: boolean;
            accommodation_access?: boolean;
            assigned_category?: string | null;
            assigned_events?: string[] | null;
            total?: number;
            accommodationStats?: {
              totalBookings: number;
              paidBookings: number;
              pendingBookings: number;
              expectedAmount: number;
              paidAmount: number;
              outstandingAmount: number;
            };
            error?: string;
          };

        if (!response.ok) {
          throw new Error(
            payload.error ??
            "Could not load registrations."
          );
        }

        if (typeof payload.total === "number") {
          setServerTotal(payload.total);
        }

        if (payload.accommodationStats) {
          setServerAccommodationStats(payload.accommodationStats);
        }

        setRegistrations(
          payload.registrations ?? []
        );
        setEvents(
          payload.events ?? []
        );
        if (payload.role) {
          setRole(payload.role);
          setAdminIdentity((prev) => ({
            name: payload.adminName || prev?.name || null,
            email: payload.adminEmail || prev?.email || null,
            isPrimary: typeof payload.isPrimary === "boolean" ? payload.isPrimary : !!prev?.isPrimary,
          }));
        }
        if (typeof payload.accommodation_access === "boolean") {
          setAccommodationAccess(payload.accommodation_access);
        }
        if (payload.assigned_category) {
          const cat = payload.assigned_category.trim().toLowerCase();
          setAssignedCategory(cat);
          const parsed = parseAdminCategories(cat);
          if (parsed.length === 1) {
            setPaymentOverviewCategory(parsed[0] as any);
          } else {
            setPaymentOverviewCategory("all");
          }
        } else {
          setAssignedCategory(null);
        }
        if (Array.isArray(payload.assigned_events)) {
          setAssignedEvents(payload.assigned_events);
        } else {
          setAssignedEvents([]);
        }
        setHasLoaded(true);
      } catch (loadError) {
        console.error(
          "ADMIN LOAD ERROR:",
          loadError
        );

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load registrations."
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router]
  );

  /* =======================================================
     INITIAL LOAD
  ======================================================= */

  useEffect(() => {
    let ignore = false;

    // Immediately resolve authenticated email and identity from client session
    supabase.auth.getUser().then(({ data }) => {
      if (!ignore && data?.user?.email) {
        setAdminIdentity((prev) => ({
          name: prev?.name || (data.user.user_metadata?.name as string) || (data.user.user_metadata?.full_name as string) || null,
          email: data.user.email ?? prev?.email ?? null,
          isPrimary: prev?.isPrimary ?? false,
        }));
      }
    }).catch(() => {});

    void loadData(false);

    const participantChannel =
      supabase
        .channel(
          "admin-participants-dashboard"
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "participants",
          },
          () => {
            void loadData(true);
          }
        )
        .subscribe();

    const participantEventChannel =
      supabase
        .channel(
          "admin-participant-events-dashboard"
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "participant_events",
          },
          () => {
            void loadData(true);
          }
        )
        .subscribe();

    const eventChannel =
      supabase
        .channel(
          "admin-events-dashboard"
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "events",
          },
          () => {
            void loadData(true);
          }
        )
        .subscribe();

    return () => {
      ignore = true;
      void supabase.removeChannel(
        participantChannel
      );

      void supabase.removeChannel(
        participantEventChannel
      );

      void supabase.removeChannel(
        eventChannel
      );
    };
  }, [loadData, router]);

  useEffect(() => {
    if (adminIdentity?.isPrimary) {
      void fetchSiteLocks();
    }
  }, [adminIdentity?.isPrimary, fetchSiteLocks]);

  /* =======================================================
     LOGOUT
  ======================================================= */

  async function logout() {
    await supabase.auth.signOut();

    router.replace("/admin/login");
  }

  /* =======================================================
     FILTERS
  ======================================================= */

  const filteredRegistrations =
    useMemo(() => {
      const query =
        search.trim().toLowerCase();
      const queryDigits = query.replace(/\D/g, "");

      return registrations.filter(
        (item) => {
          const participant =
            item.participant;

          const eventName =
            item.event?.name ?? "";

          // Comprehensive search across primary participant and all team members
          const memberMatches = (item.members ?? []).some((m) => {
            const memPart = m.participants;
            const nameMatch = m.name?.toLowerCase().includes(query);
            const emailMatch = m.email?.toLowerCase().includes(query);
            const phoneMatch =
              m.phone?.toLowerCase().includes(query) ||
              (queryDigits.length >= 3 &&
                m.phone &&
                m.phone.replace(/\D/g, "").includes(queryDigits));
            const idMatch =
              m.participant_id?.toLowerCase().includes(query) ||
              memPart?.participant_id?.toLowerCase().includes(query);
            const colMatch =
              memPart?.college?.toLowerCase().includes(query);
            const stateMatch =
              m.state?.toLowerCase().includes(query) ||
              memPart?.state?.toLowerCase().includes(query);

            return (
              nameMatch ||
              emailMatch ||
              phoneMatch ||
              idMatch ||
              colMatch ||
              stateMatch
            );
          });

          const matchesSearch =
            !query ||
            participant.name
              ?.toLowerCase()
              .includes(query) ||
            participant.email
              ?.toLowerCase()
              .includes(query) ||
            participant.phone
              ?.toLowerCase()
              .includes(query) ||
            (queryDigits.length >= 3 &&
              participant.phone &&
              participant.phone.replace(/\D/g, "").includes(queryDigits)) ||
            participant.college
              ?.toLowerCase()
              .includes(query) ||
            participant.participant_id
              ?.toLowerCase()
              .includes(query) ||
            participant.id
              ?.toLowerCase()
              .includes(query) ||
            participant.state
              ?.toLowerCase()
              .includes(query) ||
            eventName
              .toLowerCase()
              .includes(query) ||
            item.registration.team_name
              ?.toLowerCase()
              .includes(query) ||
            memberMatches;

          let matchesEvent = true;

          if (eventTypeFilter === "paid_events") {
            matchesEvent = matchesEvent && item.event?.payment_type === "paid";
          } else if (eventTypeFilter === "free_events") {
            matchesEvent = matchesEvent && item.event?.payment_type === "free";
          }

          if (eventFilter !== "all") {
            matchesEvent = matchesEvent && item.registration.event_id === eventFilter;
          }

          const matchesState = filterState === "all" || participant.state === filterState;

          const matchesStatus =
            statusFilter === "all" ||
            (statusFilter ===
              "checked-in" &&
              item.registration
                .checked_in === true) ||
            (statusFilter ===
              "pending" &&
              item.registration
                .checked_in !== true);

          const matchesPayment = (() => {
            if (paymentFilter === "all") return true;
            if (paymentFilter === "any_pending") {
              const summary = calculateTeamPaymentSummary(item);
              return summary.hasAnyPendingPayment;
            }
            if (paymentFilter === "paid") {
              return item.registration.payment_status?.toLowerCase() === "paid";
            }
            if (paymentFilter === "pending") {
              return (
                item.registration.payment_status?.toLowerCase() === "pending" ||
                item.registration.payment_status?.toLowerCase() === "unpaid"
              );
            }
            if (paymentFilter === "not_required") {
              return (
                item.registration.payment_status?.toLowerCase() === "not_required" ||
                item.event?.payment_type === "free"
              );
            }
            return (
              item.registration.payment_status?.toLowerCase() === paymentFilter
            );
          })();

          const matchesArchive =
            archiveFilter === "all" ||
            (archiveFilter === "archived" &&
              item.registration.is_archived === true) ||
            (archiveFilter === "active" &&
              item.registration.is_archived !== true);

          const matchesException = (() => {
            if (exceptionFilter === "all") return true;
            if (exceptionFilter === "payment_failed") return item.registration.payment_status === "failed";
            if (exceptionFilter === "payment_pending") return item.registration.payment_status === "pending" && item.event?.payment_type === "paid";
            if (exceptionFilter === "paid_not_checked_in") return item.registration.payment_status === "paid" && item.registration.checked_in !== true;
            if (exceptionFilter === "main_checked_in_only") return item.registration.main_checked_in === true && item.registration.checked_in !== true;
            if (exceptionFilter === "registered_unpaid") return item.registration.payment_status !== "paid" && item.event?.payment_type === "paid";
            return true;
          })();

          const matchesAccommodation = (() => {
            if (accommodationFilter === "all") return true;
            const hasAcc = Boolean(item.accommodation) || Boolean(item.members?.some((m) => m.accommodation));
            if (accommodationFilter === "with") return hasAcc;
            if (accommodationFilter === "without") return !hasAcc;
            return true;
          })();

          const matchesInstitution = (() => {
            if (institutionFilter === "all") return true;
            const isCgc =
              isCgcInstitution(participant.college, participant.email) ||
              Boolean(
                item.members?.some((m) =>
                  isCgcInstitution(m.participants?.college)
                )
              );
            if (institutionFilter === "external") return !isCgc;
            if (institutionFilter === "cgc") return isCgc;
            return true;
          })();

          return (
            matchesSearch &&
            matchesEvent &&
            matchesState &&
            matchesStatus &&
            matchesPayment &&
            matchesArchive &&
            matchesException &&
            matchesAccommodation &&
            matchesInstitution
          );
        }
      );
    }, [
      registrations,
      search,
      eventFilter,
      eventTypeFilter,
      statusFilter,
      paymentFilter,
      archiveFilter,
      exceptionFilter,
      filterState,
      accommodationFilter,
      institutionFilter,
    ]);

  const institutionCounts = useMemo(() => {
    let cgc = 0;
    let external = 0;
    for (const item of registrations) {
      if (item.registration.is_archived === true) continue;
      const isCgc =
        isCgcInstitution(item.participant.college, item.participant.email) ||
        Boolean(
          item.members?.some((m) =>
            isCgcInstitution(m.participants?.college)
          )
        );
      if (isCgc) cgc++;
      else external++;
    }
    return { cgc, external, total: cgc + external };
  }, [registrations]);

  /* =======================================================
     STATS
  ======================================================= */

  const stats = useMemo(() => {
    // Active and archived registrations
    const activeRegistrations = registrations.filter(
      (item) => item.registration.is_archived !== true
    );
    const archivedRegistrations = registrations.filter(
      (item) => item.registration.is_archived === true
    );

    const total =
      serverTotal !== null ? serverTotal : registrations.length;

    const activeTotal = activeRegistrations.length;
    const archivedTotal = archivedRegistrations.length;

    const checkedIn =
      activeRegistrations.filter(
        (item) =>
          item.registration
            .checked_in === true
      ).length;

    const activePrimaryParticipantsSet = new Set<string>();
    const uniqueParticipantsSet = new Set<string>();
    activeRegistrations.forEach((item) => {
      activePrimaryParticipantsSet.add(item.participant.id);
      uniqueParticipantsSet.add(item.participant.id);
      item.members?.forEach((m) => {
        if (m.participant_id) uniqueParticipantsSet.add(m.participant_id);
      });
    });
    const activeGroupsTotal = activePrimaryParticipantsSet.size;
    const uniqueParticipants = uniqueParticipantsSet.size;

    const mainCheckedInSet = new Set<string>();
    activeRegistrations
      .filter((item) => item.registration.main_checked_in === true)
      .forEach((item) => {
        mainCheckedInSet.add(item.participant.id);
        item.members?.forEach((m) => {
          if (m.participant_id) mainCheckedInSet.add(m.participant_id);
        });
      });
    const mainCheckedIn = mainCheckedInSet.size;

    const pending =
      activeTotal - checkedIn;
      
    const mainPending =
      uniqueParticipants - mainCheckedIn;

    return {
      total,
      activeTotal,
      activeGroupsTotal,
      archivedTotal,
      checkedIn,
      mainCheckedIn,
      pending,
      mainPending,
      uniqueParticipants,
    };
  }, [registrations, serverTotal]);

  /* =======================================================
     ACCOMMODATION SUMMARY & PAYMENT STATS
  ======================================================= */

  const localAccommodationSummary = useMemo(() => {
    const accMap = new Map<string, AccommodationDetail>();
    registrations.forEach((item) => {
      if (item.accommodation && !accMap.has(item.accommodation.id || item.participant.id)) {
        accMap.set(item.accommodation.id || item.participant.id, item.accommodation);
      }
      item.members?.forEach((m) => {
        if (m.accommodation && !accMap.has(m.accommodation.id || m.participant_id || m.id)) {
          accMap.set(m.accommodation.id || m.participant_id || m.id, m.accommodation);
        }
      });
    });

    const accList = Array.from(accMap.values());
    const totalBookings = accList.length;
    let paidBookings = 0;
    let pendingBookings = 0;
    let expectedAmount = 0;
    let paidAmount = 0;
    let outstandingAmount = 0;
    let checkedIn = 0;

    accList.forEach((acc) => {
      const amt = Number(acc.amount) || 0;
      expectedAmount += amt;
      if (acc.status === "paid") {
        paidBookings++;
        paidAmount += amt;
      } else {
        pendingBookings++;
        outstandingAmount += amt;
      }
      if (acc.checked_in) {
        checkedIn++;
      }
    });

    const globalExpected = serverAccommodationStats?.expectedAmount ?? expectedAmount;
    const globalPaid = serverAccommodationStats?.paidAmount ?? paidAmount;
    const globalOutstanding = serverAccommodationStats?.outstandingAmount ?? outstandingAmount;
    const globalTotal = serverAccommodationStats?.totalBookings ?? totalBookings;
    const globalPaidBookings = serverAccommodationStats?.paidBookings ?? paidBookings;
    const globalPendingBookings = serverAccommodationStats?.pendingBookings ?? pendingBookings;
    const globalCheckedIn = serverAccommodationStats?.checkedIn ?? checkedIn;

    return {
      totalBookings: serverAccommodationStats ? globalTotal : totalBookings,
      paidBookings: serverAccommodationStats ? globalPaidBookings : paidBookings,
      pendingBookings: serverAccommodationStats ? globalPendingBookings : pendingBookings,
      expectedAmount: serverAccommodationStats ? globalExpected : expectedAmount,
      paidAmount: serverAccommodationStats ? globalPaid : paidAmount,
      outstandingAmount: serverAccommodationStats ? globalOutstanding : outstandingAmount,
      checkedIn: globalCheckedIn,
      localEventBookings: totalBookings,
    };
  }, [registrations, serverAccommodationStats]);

  const paymentStats = useMemo(() => {
    let allCount = 0;
    let paidCount = 0;
    let unpaidCount = 0;
    let freeCount = 0;
    let eventExpectedAmount = 0;
    let eventPaidAmount = 0;
    let eventOutstandingAmount = 0;

    const activeRegistrations = registrations.filter(
      (item) => item.registration.is_archived !== true
    );

    activeRegistrations.forEach((item) => {
      const isPaidEvent = item.event?.payment_type === "paid";
      const isSuccess = item.registration.payment_status === "paid";
      const amount = item.registration.payment_amount || 0;

      allCount++;
      if (!isPaidEvent) {
        freeCount++;
      } else {
        eventExpectedAmount += amount;
        if (isSuccess) {
          paidCount++;
          eventPaidAmount += amount;
        } else {
          unpaidCount++;
          eventOutstandingAmount += amount;
        }
      }
    });

    const accExpected = localAccommodationSummary.expectedAmount;
    const accPaid = localAccommodationSummary.paidAmount;
    const accOutstanding = localAccommodationSummary.outstandingAmount;

    const expectedAmount = includeAccommodation
      ? eventExpectedAmount + accExpected
      : eventExpectedAmount;
    const paidAmount = includeAccommodation
      ? eventPaidAmount + accPaid
      : eventPaidAmount;
    const outstandingAmount = includeAccommodation
      ? eventOutstandingAmount + accOutstanding
      : eventOutstandingAmount;

    return {
      all: allCount,
      paid: paidCount,
      unpaid: unpaidCount,
      free: freeCount,
      expectedAmount,
      paidAmount,
      outstandingAmount,
      eventExpectedAmount,
      eventPaidAmount,
      eventOutstandingAmount,
      accExpected,
      accPaid,
      accOutstanding,
      totalAccommodationBookings: localAccommodationSummary.totalBookings,
      paidAccommodationBookings: localAccommodationSummary.paidBookings,
    };
  }, [registrations, includeAccommodation, localAccommodationSummary]);

  /* =======================================================
     EVENT ANALYTICS & BREAKDOWN DATA SOURCE
  ======================================================= */

  const breakdownSourceRegistrations = useMemo(() => {
    if (breakdownOriginFilter === "all") return registrations;
    return registrations.filter((item) => {
      const isCgc =
        isCgcInstitution(item.participant.college, item.participant.email) ||
        Boolean(
          item.members?.some((m) =>
            isCgcInstitution(m.participants?.college)
          )
        );
      if (breakdownOriginFilter === "external") return !isCgc;
      if (breakdownOriginFilter === "cgc") return isCgc;
      return true;
    });
  }, [registrations, breakdownOriginFilter]);

  const breakdownAccommodationSummary = useMemo(() => {
    if (breakdownOriginFilter === "all") {
      return localAccommodationSummary;
    }
    const accMap = new Map<string, AccommodationDetail>();
    breakdownSourceRegistrations.forEach((item) => {
      if (item.accommodation && !accMap.has(item.accommodation.id || item.participant.id)) {
        accMap.set(item.accommodation.id || item.participant.id, item.accommodation);
      }
      item.members?.forEach((m) => {
        if (m.accommodation && !accMap.has(m.accommodation.id || m.participant_id || m.id)) {
          accMap.set(m.accommodation.id || m.participant_id || m.id, m.accommodation);
        }
      });
    });

    const accList = Array.from(accMap.values());
    const totalBookings = accList.length;
    let paidBookings = 0;
    let pendingBookings = 0;
    let expectedAmount = 0;
    let paidAmount = 0;
    let outstandingAmount = 0;
    let checkedIn = 0;

    accList.forEach((acc) => {
      const amt = Number(acc.amount) || 0;
      expectedAmount += amt;
      if (acc.status === "paid") {
        paidBookings++;
        paidAmount += amt;
      } else {
        pendingBookings++;
        outstandingAmount += amt;
      }
      if (acc.checked_in) {
        checkedIn++;
      }
    });

    return {
      totalBookings,
      paidBookings,
      pendingBookings,
      expectedAmount,
      paidAmount,
      outstandingAmount,
      checkedIn,
      localEventBookings: totalBookings,
    };
  }, [breakdownOriginFilter, localAccommodationSummary, breakdownSourceRegistrations]);

  const eventAnalytics =
    useMemo(() => {
      return events
        .map((event) => {
          // Event analytics only count active registrations
          const count =
            breakdownSourceRegistrations.filter(
              (item) =>
                item.registration
                  .event_id ===
                event.id &&
                item.registration.is_archived !== true
            ).length;

          const checked =
            breakdownSourceRegistrations.filter(
              (item) =>
                item.registration.event_id === event.id &&
                item.registration.checked_in === true &&
                item.registration.is_archived !== true
            ).length;

          const mainChecked =
            breakdownSourceRegistrations.filter(
              (item) =>
                item.registration.event_id === event.id &&
                item.registration.main_checked_in === true &&
                item.registration.is_archived !== true
            ).length;

          const paidRegs = breakdownSourceRegistrations.filter(
            (item) =>
              item.registration.event_id === event.id &&
              item.registration.is_archived !== true &&
              item.registration.payment_status === "paid"
          );
          const paidCount = paidRegs.length;
          const paidAmount = paidRegs.reduce(
            (sum, r) => sum + (r.registration.payment_amount || (event.registration_fee || 0)),
            0
          );

          const pendingCount = event.payment_type === "paid" ? count - paidCount : 0;
          const pendingAmount = pendingCount * (event.registration_fee || 0);

          const eventRegs = breakdownSourceRegistrations.filter(
            (item) => item.registration.event_id === event.id && item.registration.is_archived !== true
          );

          const individualCount = eventRegs.filter(
            (item) => !item.registration.team_name
          ).length;

          const teamCount = eventRegs.filter(
            (item) => !!item.registration.team_name
          ).length;

          const headcount = eventRegs.reduce((sum, item) => {
            if (item.members && item.members.length > 0) {
              return sum + item.members.length;
            }
            return sum + 1;
          }, 0);

          return {
            ...event,
            count,
            checked,
            mainChecked,
            paidCount,
            paidAmount,
            pendingCount,
            pendingAmount,
            individualCount,
            teamCount,
            headcount,
          };
        })
        .filter(
          (event) => event.count > 0
        );
    }, [events, breakdownSourceRegistrations]);

  const availableCategories = useMemo(() => {
    if (assignedCategory && assignedCategory.trim()) {
      const parsed = parseAdminCategories(assignedCategory);
      if (parsed.length > 0) return parsed;
    }
    const set = new Set<string>();
    events.forEach((ev) => {
      const c = ev.category?.trim().toLowerCase();
      if (c) set.add(c);
    });
    return Array.from(set);
  }, [assignedCategory, events]);

  /* =======================================================
     PARTICIPANT GROUPING
  ======================================================= */

  const participantGroups =
    useMemo(() => {
      const map =
        new Map<
          string,
          Registration[]
        >();

      for (const registration of filteredRegistrations) {
        const id =
          registration.participant.id;

        const existing =
          map.get(id) ?? [];

        existing.push(registration);

        map.set(id, existing);
      }

      return Array.from(
        map.values()
      );
    }, [filteredRegistrations]);

  const toggleSelectRow = useCallback((participantId: string) => {
    setSelectedParticipantIds((prev) => {
      const next = new Set(prev);
      if (next.has(participantId)) next.delete(participantId);
      else next.add(participantId);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (participantGroups.length === 0) return;
    const allVisibleSelected = participantGroups.every((g) =>
      selectedParticipantIds.has(g[0].participant.id)
    );

    setSelectedParticipantIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        participantGroups.forEach((g) => next.delete(g[0].participant.id));
      } else {
        participantGroups.forEach((g) => next.add(g[0].participant.id));
      }
      return next;
    });
  }, [participantGroups, selectedParticipantIds]);

  const clearSelection = useCallback(() => {
    setSelectedParticipantIds(new Set());
  }, []);

  /* =======================================================
     PARTICIPANT DETAIL
  ======================================================= */

  function openParticipant(
    registrationsForParticipant: Registration[]
  ) {
    if (
      registrationsForParticipant.length ===
      0
    ) {
      return;
    }

    setSelectedParticipant(
      registrationsForParticipant[0]
        .participant
    );

    setSelectedParticipantEvents(
      registrationsForParticipant
    );
    setViewDocumentUrl(null);
    setActiveDocumentLabel(null);
    setActiveDocumentPath(null);
    setDocumentError(null);
    setFacultyDocumentUrl(null);
    setFacultyDocumentError(null);
    globalDocumentRequestId++;
  }

  const closeDrawer = useCallback(() => {
    setSelectedParticipant(null);
    setSelectedParticipantEvents([]);
    setViewDocumentUrl(null);
    setActiveDocumentLabel(null);
    setActiveDocumentPath(null);
    setDocumentError(null);
    setFacultyDocumentUrl(null);
    setFacultyDocumentError(null);
    globalDocumentRequestId++;
  }, []);

  useEffect(() => {
    if (selectedParticipant) {
      const originalOverflow = document.body.style.overflow;
      const originalOverscroll = document.body.style.overscrollBehavior;
      document.body.style.overflow = "hidden";
      document.body.style.overscrollBehavior = "none";
      const globalLenis = (window as unknown as { __lenis?: { stop: () => void; start: () => void } }).__lenis;
      if (globalLenis) {
        globalLenis.stop();
      }
      return () => {
        document.body.style.overflow = originalOverflow;
        document.body.style.overscrollBehavior = originalOverscroll;
        if (globalLenis) {
          globalLenis.start();
        }
      };
    }
  }, [selectedParticipant]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && selectedParticipant) {
        closeDrawer();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedParticipant, closeDrawer]);

  /* =======================================================
     CHECK IN
  ======================================================= */

  async function toggleCheckIn(
    registration: Registration,
    type: "event" | "main" = "event"
  ) {
    const nextEvent = registration.registration.checked_in !== true;
    const nextMain = registration.registration.main_checked_in !== true;

    setUpdatingId(
      registration.registration.id
    );

    try {
      const response = await fetch(
        "/api/admin/registrations",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            participantEventId:
              registration.registration.id,
            ...(type === "main" ? { mainCheckedIn: nextMain } : { checkedIn: nextEvent }),
          }),
        }
      );

      const payload =
        (await response.json()) as {
          registration?: {
            checked_in: boolean;
            checked_in_at: string | null;
            main_checked_in: boolean;
            main_checked_in_at: string | null;
          };
          error?: string;
        };

      if (
        !response.ok ||
        !payload.registration
      ) {
        throw new Error(
          payload.error ??
          "Could not update check-in status."
        );
      }

      setRegistrations((current) =>
        current.map((item) =>
          item.registration.id ===
            registration.registration.id
            ? {
              ...item,
              registration: {
                ...item.registration,
                ...payload.registration,
              },
            }
            : item
        )
      );

      setSelectedParticipantEvents((current) =>
        current.map((item) =>
          item.registration.id ===
            registration.registration.id
            ? {
              ...item,
              registration: {
                ...item.registration,
                ...payload.registration,
              },
            }
            : item
        )
      );
    } catch (updateError) {
      console.error(
        "CHECK-IN ERROR:",
        updateError
      );

      setError(
        updateError instanceof Error
          ? updateError.message
          : "Could not update check-in status."
      );
    } finally {
      setUpdatingId(null);
    }
  }

  /* =======================================================
     ARCHIVE REGISTRATION
  ======================================================= */

  async function archiveRegistration(
    registration: Registration
  ) {
    const eventName =
      registration.event?.name ??
      "this event";

    const confirmed =
      window.confirm(
        `Archive ${registration.participant.name}'s registration for ${eventName}?\n\nThe registration will be removed from the active view, but all payment history and team records will be retained.`
      );

    if (!confirmed) return;

    setDeletingId(
      registration.registration.id
    );

    try {
      const response = await fetch(
        `/api/admin/registrations?participantEventId=${encodeURIComponent(
          registration.registration.id
        )}`,
        { method: "DELETE" }
      );

      const payload =
        (await response.json()) as {
          error?: string;
        };

      if (!response.ok) {
        throw new Error(
          payload.error ??
          "Could not archive the event registration."
        );
      }

      setRegistrations((current) =>
        current.map(
          (item) =>
            item.registration.id ===
              registration.registration.id
              ? { ...item, registration: { ...item.registration, is_archived: true } }
              : item
        )
      );

      setSelectedParticipantEvents((current) =>
        current.map(
          (item) =>
            item.registration.id ===
              registration.registration.id
              ? { ...item, registration: { ...item.registration, is_archived: true } }
              : item
        )
      );
    } catch (deleteError) {
      console.error(
        "REGISTRATION ARCHIVE ERROR:",
        deleteError
      );

      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not archive the event registration."
      );
    } finally {
      setDeletingId(null);
    }
  }

  /* =======================================================
     DELETE REGISTRATION PERMANENTLY
  ======================================================= */

  async function deleteRegistration(
    registration: Registration
  ) {
    const eventName =
      registration.event?.name ??
      "this event";

    const confirmed =
      window.confirm(
        `Are you sure you want to PERMANENTLY DELETE ${registration.participant.name}'s registration for ${eventName}?\n\nThis action cannot be undone. All payment items and team records for this event will be destroyed.`
      );

    if (!confirmed) return;

    setDeletingId(
      registration.registration.id
    );

    try {
      const response = await fetch(
        `/api/admin/registrations?participantEventId=${encodeURIComponent(
          registration.registration.id
        )}&permanent=true`,
        { method: "DELETE" }
      );

      const payload =
        (await response.json()) as {
          error?: string;
        };

      if (!response.ok) {
        throw new Error(
          payload.error ??
          "Could not permanently delete the event registration."
        );
      }

      setRegistrations((current) =>
        current.filter(
          (item) =>
            item.registration.id !==
            registration.registration.id
        )
      );

      setSelectedParticipantEvents((current) =>
        current.filter(
          (item) =>
            item.registration.id !==
            registration.registration.id
        )
      );
    } catch (deleteError) {
      console.error(
        "REGISTRATION DELETE ERROR:",
        deleteError
      );

      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not permanently delete the event registration."
      );
    } finally {
      setDeletingId(null);
    }
  }

  /* =======================================================
     RESTORE REGISTRATION
  ======================================================= */

  async function restoreRegistration(
    registration: Registration
  ) {
    const eventName =
      registration.event?.name ??
      "this event";

    const confirmed =
      window.confirm(
        `Restore ${registration.participant.name}'s registration for ${eventName}?`
      );

    if (!confirmed) return;

    setUpdatingId(
      registration.registration.id
    );

    try {
      const response = await fetch(
        `/api/admin/registrations`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            participantEventId: registration.registration.id
          })
        }
      );

      const payload =
        (await response.json()) as {
          error?: string;
        };

      if (!response.ok) {
        throw new Error(
          payload.error ??
          "Could not restore the event registration."
        );
      }

      setRegistrations((current) =>
        current.map(
          (item) =>
            item.registration.id ===
              registration.registration.id
              ? { ...item, registration: { ...item.registration, is_archived: false } }
              : item
        )
      );

      setSelectedParticipantEvents((current) =>
        current.map(
          (item) =>
            item.registration.id ===
              registration.registration.id
              ? { ...item, registration: { ...item.registration, is_archived: false } }
              : item
        )
      );
    } catch (error) {
      console.error(
        "REGISTRATION RESTORE ERROR:",
        error
      );

      setError(
        error instanceof Error
          ? error.message
          : "Could not restore the event registration."
      );
    } finally {
      setUpdatingId(null);
    }
  }

  /* =======================================================
     EXCEL EXPORT (FOUR-SHEET WORKBOOKS)
  ======================================================= */

  async function exportRegistrationCsv() {
    await exportRegistrationXlsx(
      filteredRegistrations,
      "saviskar-registrations-2026.xlsx"
    );
  }

  async function exportParticipantCsv() {
    await exportParticipantXlsx(
      filteredRegistrations,
      "saviskar-participants-attendees-2026.xlsx"
    );
  }

  function exportCsv() {
    void exportRegistrationCsv();
  }

  /* =======================================================
     RENDER
  ======================================================= */

  if (!hasLoaded) {
    if (error) {
      return (
        <main className="min-h-screen bg-[#f5f5f5] px-5 py-10 md:px-10 lg:px-16 flex items-center justify-center text-black">
          <div className="flex flex-col items-center gap-4 text-center max-w-md bg-white p-8 rounded-3xl border border-black/10 shadow-sm">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600 border border-red-100">
              <RefreshCw size={22} />
            </div>
            <h2 className="text-lg font-bold tracking-tight text-black">Failed to Load Dashboard</h2>
            <p className="text-xs text-black/55 leading-relaxed">{error}</p>
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => loadData(false)}
                className="inline-flex items-center gap-2 rounded-full bg-black px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-black/80 transition active:scale-95"
              >
                <RefreshCw size={14} />
                <span>Retry</span>
              </button>
              <button
                type="button"
                onClick={logout}
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-2.5 text-xs font-semibold text-black/70 hover:bg-black/5 transition"
              >
                <LogOut size={14} />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </main>
      );
    }
    return (
      <AdminPageLoader
        heading="Loading Admin Dashboard..."
        subtext="Fetching registrations and dashboard statistics."
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f5f5] px-5 py-10 md:px-10 lg:px-16">
      <div className="mx-auto max-w-[1500px]">

        {/* HEADER */}

        <div className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          {/* Left section: Title, Description, and Admin Identity */}
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-black/40">
                Saviskar 2026
              </p>

              <h1 className="text-4xl font-semibold tracking-[-0.05em] md:text-6xl text-black">
                Registrations
              </h1>

              <p className="mt-3 text-sm text-black/45">
                Manage registrations and participant entry.
              </p>
            </div>

            {/* Signed-in Administrator Identity Area */}
            <div className="inline-flex flex-col items-start rounded-2xl border border-black/10 bg-white p-4 shadow-sm sm:max-w-md">
              <div className="text-[10px] font-mono font-semibold uppercase tracking-[0.2em] text-black/40">
                Signed in as
              </div>
              <div
                className="mt-1 text-sm font-semibold text-black break-all"
                title={adminIdentity?.email || undefined}
              >
                {adminIdentity?.email || (adminIdentity?.name ? adminIdentity.name : "Authenticated Administrator")}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-black/10 bg-black/5 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black/70">
                  {adminIdentity?.isPrimary
                    ? "Primary Master Admin"
                    : role === "master"
                    ? "Master Admin"
                    : availableCategories.length === 1
                    ? `${availableCategories[0].replace("-", " ").toUpperCase()} Category Admin`
                    : "Admin"}
                </span>
                {adminIdentity?.name && adminIdentity?.email && (
                  <span className="text-xs text-black/45 font-medium">
                    {adminIdentity.name}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right section: Action Buttons in Balanced Responsive Groups */}
          <div className="flex flex-col gap-3 lg:items-end">
            {/* Primary Management Actions */}
            <div className="flex flex-wrap items-center gap-2.5 lg:justify-end">
              {role === "master" && (
                <>
                  <button
                    type="button"
                    onClick={() => router.push("/admin/events")}
                    className="flex items-center gap-2 rounded-full bg-black px-4 py-2.5 text-sm text-white transition hover:scale-[1.02] shadow-sm"
                  >
                    <CalendarDays size={15} />
                    <span>Manage Events</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => router.push("/admin/admins")}
                    className="flex items-center gap-2 rounded-full bg-black px-4 py-2.5 text-sm text-white transition hover:scale-[1.02] shadow-sm"
                  >
                    <Users size={15} />
                    <span>Manage Admins</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => router.push("/admin/logs")}
                    className="flex items-center gap-2 rounded-full bg-black px-4 py-2.5 text-sm text-white transition hover:scale-[1.02] shadow-sm"
                  >
                    <Clock3 size={15} />
                    <span>Audit Logs</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => router.push("/admin/broadcast")}
                    className="flex items-center gap-2 rounded-full bg-black px-4 py-2.5 text-sm text-white transition hover:scale-[1.02] shadow-sm"
                  >
                    <Mail size={15} />
                    <span>Email Broadcast</span>
                  </button>

                  {adminIdentity?.isPrimary && (
                    <button
                      type="button"
                      onClick={() => setIsPageLocksOpen(true)}
                      className="flex items-center gap-2 rounded-full border border-purple-300 bg-purple-50 px-4 py-2.5 text-sm font-semibold text-purple-900 transition hover:bg-purple-100 hover:scale-[1.02] shadow-sm"
                      title="Lock or unlock public pages on the site (Primary Master Admin only)"
                    >
                      <Lock size={15} className="text-purple-700" />
                      <span>Page Locks</span>
                      {siteLocks && (
                        <span className="ml-0.5 rounded-full bg-purple-200/80 px-1.5 py-0.5 text-[10px] font-bold text-purple-900">
                          {Object.values(siteLocks).filter((v) => !v).length} locked
                        </span>
                      )}
                    </button>
                  )}
                </>
              )}

              {(role === "master" || accommodationAccess) && (
                <button
                  type="button"
                  onClick={() => router.push("/admin/accommodations")}
                  className="flex items-center gap-2 rounded-full bg-black px-4 py-2.5 text-sm text-white transition hover:scale-[1.02] shadow-sm"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2 19V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v14" />
                    <path d="M2 19h20" />
                    <path d="M7 19v-9a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v9" />
                    <path d="M12 15h.01" />
                  </svg>
                  <span>Accommodation</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => router.push("/admin/analytics")}
                className="flex items-center gap-2 rounded-full bg-black px-4 py-2.5 text-sm text-white transition hover:scale-[1.02] shadow-sm"
              >
                <BarChart3 size={15} />
                <span>Analytics</span>
              </button>
            </div>

            {/* Registration and Operational Actions */}
            <div className="flex flex-wrap items-center gap-2.5 lg:justify-end">
              <button
                type="button"
                onClick={() => router.push("/register?from=admin")}
                className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2.5 text-sm text-black/70 transition hover:bg-black/[0.03] shadow-sm"
              >
                <ExternalLink size={15} />
                <span>Add Registration</span>
              </button>

              <button
                type="button"
                onClick={() => router.push("/admin/scanner")}
                className="flex items-center gap-2 rounded-full bg-black px-4 py-2.5 text-sm text-white transition hover:scale-[1.02] shadow-sm"
              >
                <QrCode size={15} />
                <span>Entry Scanner</span>
              </button>

              <button
                type="button"
                onClick={() => loadData(true)}
                disabled={refreshing}
                className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2.5 text-sm text-black/70 transition hover:bg-black/[0.03] disabled:opacity-50 shadow-sm"
              >
                <RefreshCw
                  size={15}
                  className={refreshing ? "animate-spin" : ""}
                />
                <span>Refresh</span>
              </button>

              <button
                type="button"
                onClick={logout}
                className="flex items-center gap-2 rounded-full border border-black/10 bg-black px-4 py-2.5 text-sm text-white transition hover:scale-[1.02] shadow-sm"
              >
                <LogOut size={15} />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>

        {/* ERROR */}

        {error && (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700 flex items-center justify-between">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => loadData(true)}
              className="font-semibold text-red-800 underline hover:text-red-950 transition text-xs shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {/* STATS */}

        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">

          <StatCard
            title="Total registrations"
            value={stats.total}
            subtitle={
              <span>
                {stats.activeTotal.toLocaleString()} active across {stats.activeGroupsTotal.toLocaleString()} participant groups
                {stats.archivedTotal > 0 && ` · ${stats.archivedTotal.toLocaleString()} archived`}
              </span>
            }
            icon={
              <CalendarDays
                size={18}
              />
            }
            dark
          />

          <StatCard
            title="Unique Participants"
            value={
              stats.uniqueParticipants
            }
            subtitle="Unique event competitors across squads & solo (1,627 total delegates incl. stay-only)"
            icon={
              <Users size={18} />
            }
            dark
          />

          <StatCard
            title="MAIN CHECK-IN"
            value={
              stats.mainCheckedIn
            }
            icon={
              <UserCheck
                size={18}
              />
            }
          />
          
          <StatCard
            title="MAIN PENDING"
            value={
              stats.mainPending
            }
            icon={
              <Clock3
                size={18}
              />
            }
          />

          <StatCard
            title="EVENT CHECK-IN"
            value={
              stats.checkedIn
            }
            icon={
              <UserCheck
                size={18}
              />
            }
          />

          <StatCard
            title="EVENT PENDING"
            value={
              stats.pending
            }
            icon={
              <Clock3
                size={18}
              />
            }
          />
        </div>

        {/* PAYMENT OVERVIEW */}

        {/* PAYMENT OVERVIEW */}

        <div className="mb-8 rounded-[28px] bg-white p-6 shadow-[0_20px_80px_rgba(0,0,0,0.04)] md:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-black/35">
                Financial Snapshot
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <h2 className="text-xl font-semibold text-black md:text-2xl">
                  Payment Overview
                </h2>
                <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-[10px] font-bold text-black/60">
                  {includeAccommodation ? "Events + Accommodations" : "Events Only"}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Accommodation Toggle */}
              <div className="flex items-center rounded-full bg-black/[0.04] p-1 border border-black/[0.06]">
                <button
                  type="button"
                  onClick={() => setIncludeAccommodation(false)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                    !includeAccommodation
                      ? "bg-white text-black shadow-sm"
                      : "text-black/50 hover:text-black"
                  }`}
                >
                  Events Only
                </button>
                <button
                  type="button"
                  onClick={() => setIncludeAccommodation(true)}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                    includeAccommodation
                      ? "bg-black text-white shadow-sm"
                      : "text-black/50 hover:text-black"
                  }`}
                >
                  <span>With Accommodation</span>
                  {localAccommodationSummary.paidAmount > 0 && (
                    <span className={`rounded-full px-1.5 py-0.2 text-[9px] font-mono font-bold ${
                      includeAccommodation ? "bg-white/20 text-white" : "bg-black/10 text-black/60"
                    }`}>
                      +₹{localAccommodationSummary.paidAmount.toLocaleString()}
                    </span>
                  )}
                </button>
              </div>

              {/* Status Filter Buttons */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setPaymentOverviewState("all")}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${paymentOverviewState === "all" ? "bg-black text-white" : "bg-black/[0.04] text-black/60 hover:bg-black/[0.08]"}`}
                >
                  ALL <span className="opacity-50 font-mono text-[10px]">{paymentStats.all}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentOverviewState("paid")}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${paymentOverviewState === "paid" ? "bg-green-600 text-white" : "bg-green-50 text-green-700 hover:bg-green-100"}`}
                >
                  PAID <span className="opacity-50 font-mono text-[10px]">{paymentStats.paid}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentOverviewState("unpaid")}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${paymentOverviewState === "unpaid" ? "bg-red-600 text-white" : "bg-red-50 text-red-700 hover:bg-red-100"}`}
                >
                  UNPAID <span className="opacity-50 font-mono text-[10px]">{paymentStats.unpaid}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentOverviewState("free")}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${paymentOverviewState === "free" ? "bg-black/60 text-white" : "bg-black/[0.04] text-black/50 hover:bg-black/[0.08]"}`}
                >
                  FREE <span className="opacity-50 font-mono text-[10px]">{paymentStats.free}</span>
                </button>
              </div>
            </div>
          </div>

          {role === "master" && (
            <div className="mt-5 grid gap-4 grid-cols-1 sm:grid-cols-3 pt-5 border-t border-black/5">
              <div className="rounded-2xl bg-black/[0.02] p-4 border border-black/[0.03]">
                <p className="text-[10px] font-bold uppercase tracking-widest text-black/40">Expected Revenue</p>
                <p className="text-2xl font-semibold text-black mt-1">₹{paymentStats.expectedAmount.toLocaleString()}</p>
                {includeAccommodation && (
                  <p className="text-[10px] text-black/45 mt-1 font-medium">
                    Events: ₹{paymentStats.eventExpectedAmount.toLocaleString()} · Acc: ₹{paymentStats.accExpected.toLocaleString()}
                  </p>
                )}
              </div>
              <div className="rounded-2xl bg-green-50/60 p-4 border border-green-100/60">
                <p className="text-[10px] font-bold uppercase tracking-widest text-green-700/70">Paid Revenue</p>
                <p className="text-2xl font-semibold text-green-700 mt-1">₹{paymentStats.paidAmount.toLocaleString()}</p>
                {includeAccommodation && (
                  <p className="text-[10px] text-green-800/60 mt-1 font-medium">
                    Events: ₹{paymentStats.eventPaidAmount.toLocaleString()} · Acc: ₹{paymentStats.accPaid.toLocaleString()}
                  </p>
                )}
              </div>
              <div className="rounded-2xl bg-red-50/60 p-4 border border-red-100/60">
                <p className="text-[10px] font-bold uppercase tracking-widest text-red-700/70">Outstanding</p>
                <p className="text-2xl font-semibold text-red-700 mt-1">₹{paymentStats.outstandingAmount.toLocaleString()}</p>
                {includeAccommodation && (
                  <p className="text-[10px] text-red-800/60 mt-1 font-medium">
                    Events: ₹{paymentStats.eventOutstandingAmount.toLocaleString()} · Acc: ₹{paymentStats.accOutstanding.toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Accommodation Snapshot Banner (when accommodation is toggled ON) */}
          {includeAccommodation && (
            <div className="mt-4 rounded-2xl bg-violet-50/70 border border-violet-100 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in duration-200">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm">
                  <Bed size={18} />
                </div>
                <div>
                  <p className="text-xs font-bold text-violet-950">
                    Campus Accommodation Snapshot
                  </p>
                  <p className="text-[11px] text-violet-700 mt-0.5">
                    {localAccommodationSummary.totalBookings} booked delegates ({localAccommodationSummary.paidBookings} paid, {localAccommodationSummary.pendingBookings} pending) · {localAccommodationSummary.checkedIn} checked in
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAccommodationFilter(accommodationFilter === "with" ? "all" : "with")}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition border ${
                    accommodationFilter === "with"
                      ? "bg-violet-600 text-white border-violet-600"
                      : "bg-white text-violet-800 border-violet-200 hover:bg-violet-100/60"
                  }`}
                >
                  {accommodationFilter === "with" ? "Showing Acc in Table" : "Filter Table by Acc"}
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/admin/accommodations")}
                  className="rounded-full bg-violet-950 text-white px-3.5 py-1.5 text-xs font-semibold hover:bg-black transition flex items-center gap-1.5"
                >
                  <span>Manage Rooms</span>
                  <ExternalLink size={12} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* =========================================================
            BLENDED REGISTRATION & PAYMENT BREAKDOWN
        ========================================================= */}

        <div className="mb-8 rounded-[28px] bg-white p-6 shadow-[0_20px_80px_rgba(0,0,0,0.04)] md:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-black/35">
                Unified Analytics
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2 sm:gap-3">
                <h2 className="text-xl font-semibold text-black md:text-2xl">
                  Registration & Payment Breakdown
                </h2>
                <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-[10px] font-bold text-black/50">
                  {eventAnalytics.length} events
                </span>
                {breakdownOriginFilter === "external" && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                    <Building2 size={11} className="text-emerald-700" />
                    External Only
                  </span>
                )}
                {breakdownOriginFilter === "cgc" && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-2.5 py-0.5 text-[10px] font-bold text-blue-800">
                    <Building2 size={11} className="text-blue-700" />
                    CGC Only
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Quick toggle button in header */}
              <button
                type="button"
                onClick={() =>
                  handleInstitutionFilterChange(
                    breakdownOriginFilter === "external" ? "all" : "external"
                  )
                }
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                  breakdownOriginFilter === "external"
                    ? "border-emerald-500 bg-emerald-600 text-white shadow-xs ring-2 ring-emerald-300"
                    : "border-black/10 bg-black/[0.03] text-black hover:bg-black/[0.06]"
                }`}
                title="Filter event-wise counts and table to only external registrations (excluding CGC)"
              >
                <Building2
                  size={13}
                  className={
                    breakdownOriginFilter === "external"
                      ? "text-white"
                      : "text-emerald-600"
                  }
                />
                <span>
                  {breakdownOriginFilter === "external"
                    ? "External Only (Active)"
                    : "External Only"}
                </span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    breakdownOriginFilter === "external"
                      ? "bg-white/20 text-white"
                      : "bg-emerald-100 text-emerald-800"
                  }`}
                >
                  {institutionCounts.external}
                </span>
              </button>

              {eventFilter !== "all" && (
                <button
                  type="button"
                  onClick={() => setEventFilter("all")}
                  className="rounded-full bg-black/5 px-3 py-1.5 text-xs font-semibold text-black hover:bg-black/10 transition cursor-pointer"
                >
                  Clear event filter
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsBreakdownOpen((prev) => !prev)}
                className="flex items-center gap-2 rounded-full border border-black/10 bg-black/[0.03] hover:bg-black/[0.06] px-4 py-2 text-xs font-semibold text-black transition cursor-pointer"
                aria-expanded={isBreakdownOpen}
              >
                <span>{isBreakdownOpen ? "Hide Breakdown" : "View Breakdown"}</span>
                {isBreakdownOpen ? (
                  <ChevronUp size={15} className="text-black/60" />
                ) : (
                  <ChevronDown size={15} className="text-black/60" />
                )}
              </button>
            </div>
          </div>

          {/* Active Filter Indicator */}
          {eventFilter !== "all" && (
            <div className="mt-4 flex items-center justify-between rounded-xl bg-black/[0.02] border border-black/[0.05] px-4 py-2.5 text-xs">
              <span className="text-black/60">
                Table currently filtered by:{" "}
                <span className="font-bold text-black">
                  {events.find((e) => e.id === eventFilter)?.name || eventFilter}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setEventFilter("all")}
                className="text-xs font-medium text-black underline underline-offset-2 hover:opacity-70"
              >
                Reset to all events
              </button>
            </div>
          )}

          {isBreakdownOpen && (
            <div className="mt-6 pt-2 animate-in fade-in duration-200">
              {/* Category & Status Filter Controls */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-black/[0.05]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setBreakdownCategory("all")}
                    className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition border ${
                      breakdownCategory === "all"
                        ? "border-black bg-black text-white"
                        : "border-black/10 bg-black/[0.02] text-black/60 hover:bg-black/[0.05]"
                    }`}
                  >
                    All Categories
                  </button>
                  {availableCategories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setBreakdownCategory(cat)}
                      className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition border ${
                        breakdownCategory === cat
                          ? "border-black bg-black text-white"
                          : "border-black/10 bg-black/[0.02] text-black/60 hover:bg-black/[0.05]"
                      }`}
                    >
                      {cat.replace("-", " ")}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Origin / Campus Filter */}
                  <div className="flex items-center rounded-full bg-black/[0.03] p-1 border border-black/5">
                    <button
                      type="button"
                      onClick={() => handleInstitutionFilterChange("all")}
                      className={`rounded-full px-3 py-1 text-[10px] font-semibold transition cursor-pointer ${
                        breakdownOriginFilter === "all" ? "bg-white text-black shadow-xs" : "text-black/50 hover:text-black"
                      }`}
                    >
                      All Campuses
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInstitutionFilterChange("external")}
                      className={`rounded-full px-3 py-1 text-[10px] font-semibold transition flex items-center gap-1 cursor-pointer ${
                        breakdownOriginFilter === "external"
                          ? "bg-emerald-600 text-white shadow-xs font-bold"
                          : "text-black/50 hover:text-emerald-700"
                      }`}
                      title="Filter event-wise counts to only external colleges / institutions (excluding CGC)"
                    >
                      <Building2 size={11} className={breakdownOriginFilter === "external" ? "text-white" : "text-emerald-600"} />
                      External Only
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInstitutionFilterChange("cgc")}
                      className={`rounded-full px-3 py-1 text-[10px] font-semibold transition cursor-pointer ${
                        breakdownOriginFilter === "cgc" ? "bg-white text-black shadow-xs font-bold" : "text-black/50 hover:text-black"
                      }`}
                    >
                      CGC Only
                    </button>
                  </div>

                  {/* Payment Type */}
                  <div className="flex items-center rounded-full bg-black/[0.03] p-1 border border-black/5">
                    <button
                      type="button"
                      onClick={() => setBreakdownPaymentType("all")}
                      className={`rounded-full px-3 py-1 text-[10px] font-semibold transition cursor-pointer ${
                        breakdownPaymentType === "all" ? "bg-white text-black shadow-xs" : "text-black/50 hover:text-black"
                      }`}
                    >
                      All Events
                    </button>
                    <button
                      type="button"
                      onClick={() => setBreakdownPaymentType("paid")}
                      className={`rounded-full px-3 py-1 text-[10px] font-semibold transition cursor-pointer ${
                        breakdownPaymentType === "paid" ? "bg-white text-green-700 shadow-xs" : "text-black/50 hover:text-black"
                      }`}
                    >
                      Paid
                    </button>
                    <button
                      type="button"
                      onClick={() => setBreakdownPaymentType("free")}
                      className={`rounded-full px-3 py-1 text-[10px] font-semibold transition cursor-pointer ${
                        breakdownPaymentType === "free" ? "bg-white text-black shadow-xs" : "text-black/50 hover:text-black"
                      }`}
                    >
                      Free
                    </button>
                  </div>

                  <input
                    type="search"
                    value={breakdownSearch}
                    onChange={(e) => setBreakdownSearch(e.target.value)}
                    placeholder="Search breakdown..."
                    className="rounded-full border border-black/10 bg-black/[0.02] px-3.5 py-1 text-xs text-black outline-none placeholder:text-black/30 focus:border-black/30 w-36 sm:w-48"
                  />
                </div>
              </div>

              {/* Grid of Blended Cards */}
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {/* Accommodation Card (if opted or included) */}
                {(includeAccommodation || breakdownAccommodationSummary.totalBookings > 0) &&
                  (breakdownCategory === "all" || breakdownCategory === "hospitality") && (
                    <div
                      onClick={() => setAccommodationFilter(accommodationFilter === "with" ? "all" : "with")}
                      className={`rounded-[20px] p-5 text-left transition cursor-pointer flex flex-col justify-between border ${
                        accommodationFilter === "with"
                          ? "bg-violet-950 text-white border-violet-900 shadow-lg"
                          : "bg-violet-50/70 border-violet-100 hover:border-violet-200 hover:bg-violet-50"
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-[10px] uppercase tracking-[0.16em] font-bold ${
                            accommodationFilter === "with" ? "text-violet-300" : "text-violet-700"
                          }`}>
                            Hospitality
                          </p>
                          <span className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider border ${
                            accommodationFilter === "with"
                              ? "border-violet-400 bg-violet-800 text-white"
                              : "border-violet-200 bg-white text-violet-700"
                          }`}>
                            PASS BASED
                          </span>
                        </div>

                        <p className={`mt-2 truncate text-sm font-semibold ${
                          accommodationFilter === "with" ? "text-white" : "text-black"
                        }`}>
                          Campus Accommodation
                        </p>

                        <div className="mt-3 flex flex-wrap gap-1">
                          <span className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider border ${
                            accommodationFilter === "with"
                              ? "border-green-400 bg-green-500/20 text-white"
                              : "border-green-200 bg-green-50 text-green-700"
                          }`}>
                            Paid: ₹{breakdownAccommodationSummary.paidAmount.toLocaleString()} ({breakdownAccommodationSummary.paidBookings})
                          </span>
                          {breakdownAccommodationSummary.pendingBookings > 0 && (
                            <span className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider border ${
                              accommodationFilter === "with"
                                ? "border-amber-400 bg-amber-500/20 text-white"
                                : "border-amber-200 bg-amber-50 text-amber-700"
                            }`}>
                              Pending: {breakdownAccommodationSummary.pendingBookings}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-5 flex items-end justify-between pt-3 border-t border-black/5">
                        <div>
                          <p className={`text-2xl font-bold ${accommodationFilter === "with" ? "text-white" : "text-black"}`}>
                            {breakdownAccommodationSummary.totalBookings}
                          </p>
                          <p className={`text-[9px] uppercase tracking-wider font-semibold ${
                            accommodationFilter === "with" ? "text-violet-300" : "text-black/40"
                          }`}>
                            {breakdownOriginFilter === "external"
                              ? "Ext. Bookings"
                              : breakdownOriginFilter === "cgc"
                              ? "CGC Bookings"
                              : "Bookings"}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={`text-xs font-semibold ${accommodationFilter === "with" ? "text-white/80" : "text-black/60"}`}>
                            {breakdownAccommodationSummary.checkedIn} checked in
                          </p>
                          <p className={`text-[9px] ${accommodationFilter === "with" ? "text-violet-300" : "text-black/35"}`}>
                            Click to filter table
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                {/* Event Cards */}
                {eventAnalytics
                  .filter((event) => {
                    const isPaidEvent = event.payment_type === "paid";
                    if (breakdownCategory !== "all" && event.category?.toLowerCase() !== breakdownCategory.toLowerCase()) {
                      return false;
                    }
                    if (breakdownPaymentType === "paid" && !isPaidEvent) return false;
                    if (breakdownPaymentType === "free" && isPaidEvent) return false;
                    if (breakdownSearch.trim()) {
                      const q = breakdownSearch.toLowerCase();
                      const matchName = event.name.toLowerCase().includes(q);
                      const matchCat = (event.category || "").toLowerCase().includes(q);
                      if (!matchName && !matchCat) return false;
                    }
                    return true;
                  })
                  .map((event) => {
                    const isPaidEvent = event.payment_type === "paid";
                    const isSelected = eventFilter === event.id;
                    const fee = event.registration_fee != null ? `₹${event.registration_fee}` : "Free";

                    return (
                      <button
                        type="button"
                        key={event.id}
                        onClick={() => setEventFilter(isSelected ? "all" : event.id)}
                        className={`rounded-[20px] p-5 text-left transition flex flex-col justify-between border ${
                          isSelected
                            ? "bg-black text-white border-black shadow-lg"
                            : "bg-black/[0.02] border-black/[0.04] hover:bg-black/[0.05] hover:border-black/10"
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <p className={`truncate text-[10px] uppercase tracking-[0.16em] font-semibold ${
                              isSelected ? "text-white/45" : "text-black/40"
                            }`}>
                              {event.category ?? "Event"}
                            </p>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider border ${
                                isPaidEvent
                                  ? isSelected
                                    ? "border-green-400 bg-green-500/20 text-white"
                                    : "border-green-200 bg-green-50 text-green-700"
                                  : isSelected
                                  ? "border-white/20 text-white/70"
                                  : "border-black/10 text-black/50 bg-black/[0.02]"
                              }`}
                            >
                              {isPaidEvent ? `${fee} · PAID` : "FREE"}
                            </span>
                          </div>

                          <p className={`mt-2 truncate text-sm font-semibold ${isSelected ? "text-white" : "text-black"}`}>
                            {event.name}
                          </p>

                          {/* Financials Pill */}
                          <div className="mt-2.5 flex flex-wrap gap-1">
                            {isPaidEvent ? (
                              <>
                                <span className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider border ${
                                  isSelected
                                    ? "border-green-400 bg-green-500/20 text-white"
                                    : "border-green-200 bg-green-50 text-green-700"
                                }`}>
                                  Paid: ₹{event.paidAmount.toLocaleString()} ({event.paidCount})
                                </span>
                                {event.pendingCount > 0 && (
                                  <span className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider border ${
                                    isSelected
                                      ? "border-red-400 bg-red-500/20 text-white"
                                      : "border-red-200 bg-red-50 text-red-700"
                                  }`}>
                                    Pending: ₹{event.pendingAmount.toLocaleString()} ({event.pendingCount})
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider border ${
                                isSelected ? "border-white/20 text-white/70" : "border-black/10 text-black/50"
                              }`}>
                                Free Event · No Fee
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Counts & Check-in Footer */}
                        <div className="mt-5 flex items-end justify-between pt-3 border-t border-black/5">
                          <div>
                            <p className={`text-2xl font-bold leading-none ${isSelected ? "text-white" : "text-black"}`}>
                              {event.count}
                              {event.registration_limit ? (
                                <span className={`text-sm ml-1 font-normal ${isSelected ? "text-white/40" : "text-black/30"}`}>
                                  /{event.registration_limit}
                                </span>
                              ) : ""}
                            </p>
                            <p className={`mt-1 text-[9px] uppercase tracking-wider font-semibold ${
                              isSelected ? "text-white/40" : "text-black/35"
                            }`}>
                              {breakdownOriginFilter === "external"
                                ? "Ext. Registrations"
                                : breakdownOriginFilter === "cgc"
                                ? "CGC Registrations"
                                : "Registrations"}
                            </p>
                          </div>

                          <div className="text-right">
                            <p className={`text-xs font-semibold ${isSelected ? "text-white/80" : "text-black/60"}`}>
                              Check-In: {event.checked}/{event.count}
                            </p>
                            <p className={`text-[9px] mt-0.5 ${isSelected ? "text-white/40" : "text-black/35"}`}>
                              {event.individualCount} Solo · {event.teamCount} Team
                              {event.headcount > event.count && (
                                <span className={isSelected ? "text-emerald-300 font-semibold" : "text-emerald-700 font-semibold"}>
                                  {" "}· {event.headcount} {breakdownOriginFilter === "external" ? "ext. delegates" : "delegates"}
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </div>

        {/* FILTERS */}

        <div className="mb-5 rounded-[24px] bg-white p-3 shadow-[0_15px_50px_rgba(0,0,0,0.035)]">
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap">

            <label
              htmlFor="admin-search-input"
              className="flex flex-1 min-w-[250px] items-center gap-3 rounded-[18px] bg-black/[0.035] px-4 py-3 cursor-text focus-within:ring-2 focus-within:ring-black/10 transition"
            >
              <Search
                size={17}
                className="text-black/30 pointer-events-none shrink-0"
              />

              <input
                id="admin-search-input"
                type="search"
                value={search}
                onChange={(e) =>
                  setSearch(
                    e.target.value
                  )
                }
                placeholder="Search name, participant ID, event, college, email, phone, team..."
                className="min-w-0 flex-1 bg-transparent text-sm text-black outline-none placeholder:text-black/25"
              />

              {search && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSearch("");
                  }}
                  className="text-black/30 hover:text-black shrink-0"
                  title="Clear search"
                >
                  <X size={15} />
                </button>
              )}
            </label>

            <select
              value={eventFilter}
              onChange={(e) =>
                setEventFilter(
                  e.target.value
                )
              }
              className="rounded-[18px] border border-black/10 bg-black px-4 py-3 text-sm outline-none"
            >
              <option value="all">
                {availableCategories.length === 1
                  ? `All ${availableCategories[0].replace("-", " ")} events`
                  : "All events"}
              </option>

              {events.map(
                (event) => (
                  <option
                    key={event.id}
                    value={event.id}
                  >
                    {event.name}
                  </option>
                )
              )}
            </select>

            <select
              value={exceptionFilter}
              onChange={(e) =>
                setExceptionFilter(
                  e.target.value as any
                )
              }
              className="rounded-[18px] border border-black/10 bg-white px-4 py-3 text-sm text-black outline-none"
            >
              <option value="all">No Exceptions</option>
              <option value="payment_failed">Payment Failed</option>
              <option value="payment_pending">Payment Pending</option>
              <option value="registered_unpaid">Registered, Unpaid</option>
              <option value="paid_not_checked_in">Paid, Not Checked In</option>
              <option value="main_checked_in_only">Main Checked In, No Event Check-In</option>
            </select>

            <select
              value={eventTypeFilter}
              onChange={(e) =>
                setEventTypeFilter(
                  e.target.value as EventTypeFilter
                )
              }
              className="rounded-[18px] border border-black/10 bg-black px-4 py-3 text-sm outline-none"
            >
              <option value="all">
                All event types
              </option>

              <option value="paid_events">
                Paid events
              </option>

              <option value="free_events">
                Free events
              </option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(
                  e.target
                    .value as StatusFilter
                )
              }
              className="rounded-[18px] border border-black/10 bg-black px-4 py-3 text-sm outline-none"
            >
              <option value="all">
                All status
              </option>

              <option value="checked-in">
                Checked in
              </option>

              <option value="pending">
                Pending
              </option>
            </select>

            <select
              value={filterState}
              onChange={(e) => setFilterState(e.target.value)}
              className="rounded-[18px] border border-black/10 bg-black px-4 py-3 text-sm outline-none"
            >
              <option value="all">All States</option>
              {INDIAN_STATES_AND_UT.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            <select
              value={paymentFilter}
              onChange={(e) =>
                setPaymentFilter(
                  e.target
                    .value as PaymentFilter
                )
              }
              className="rounded-[18px] border border-black/10 bg-black px-4 py-3 text-sm outline-none text-white font-medium"
            >
              <option value="all">
                All payments
              </option>

              <option value="any_pending">
                Any payment pending (event or accommodation)
              </option>

              <option value="paid">
                Paid (Event fee)
              </option>

              <option value="pending">
                Payment pending (Event fee)
              </option>

              <option value="not_required">
                Not required
              </option>
            </select>

            <select
              value={accommodationFilter}
              onChange={(e) =>
                setAccommodationFilter(
                  e.target.value as "all" | "with" | "without"
                )
              }
              className="rounded-[18px] border border-black/10 bg-black px-4 py-3 text-sm outline-none text-white"
            >
              <option value="all">All Accommodations</option>
              <option value="with">🏨 Opted Accommodation</option>
              <option value="without">No Accommodation</option>
            </select>

            {/* External Only Direct Toggle Button */}
            <button
              type="button"
              onClick={() =>
                handleInstitutionFilterChange(
                  institutionFilter === "external" ? "all" : "external"
                )
              }
              className={`rounded-[18px] border px-4 py-3 text-sm font-semibold flex items-center gap-2 transition shadow-sm cursor-pointer ${
                institutionFilter === "external"
                  ? "border-emerald-500 bg-emerald-600 text-white shadow-emerald-500/25 ring-2 ring-emerald-400"
                  : "border-black/10 bg-white text-black hover:bg-black/5"
              }`}
              title="Show only external registrations, excluding all CGC campuses (CGC Mohali, Landran, Jhanjeri)"
            >
              <Building2
                size={16}
                className={
                  institutionFilter === "external"
                    ? "text-white"
                    : "text-emerald-600"
                }
              />
              <span>
                {institutionFilter === "external"
                  ? "External Only (Active)"
                  : "External Only"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                  institutionFilter === "external"
                    ? "bg-white/25 text-white"
                    : "bg-emerald-50 text-emerald-800 border border-emerald-200"
                }`}
              >
                {institutionCounts.external}
              </span>
            </button>

            {/* Institution Origin Dropdown */}
            <select
              value={institutionFilter}
              onChange={(e) =>
                handleInstitutionFilterChange(
                  e.target.value as "all" | "external" | "cgc"
                )
              }
              className="rounded-[18px] border border-black/10 bg-black px-4 py-3 text-sm outline-none text-white cursor-pointer"
              title="Filter by institution origin"
            >
              <option value="all">All Institutions ({institutionCounts.total})</option>
              <option value="external">🌐 External Only ({institutionCounts.external})</option>
              <option value="cgc">🏛️ CGC Campuses ({institutionCounts.cgc})</option>
            </select>

            {role === "master" && (
              <select
                value={archiveFilter}
                onChange={(e) =>
                  setArchiveFilter(
                    e.target
                      .value as ArchiveFilter
                  )
                }
                className="rounded-[18px] border border-black/10 bg-black px-4 py-3 text-sm outline-none text-white"
              >
                <option value="active">
                  Active only
                </option>

                <option value="archived">
                  Archived only
                </option>

                <option value="all">
                  All (incl. archived)
                </option>
              </select>
            )}

            <CsvExportDropdown
              onExportRegistrations={exportRegistrationCsv}
              onExportParticipants={exportParticipantCsv}
              totalRegistrations={filteredRegistrations.length}
            />

            <button
              type="button"
              onClick={() => {
                setVerificationMode("audit");
                setIsVerificationOpen(true);
              }}
              className="rounded-[18px] border border-amber-900/40 bg-[#78350f] hover:bg-[#92400e] text-[#fef3c7] px-4 py-3 text-sm font-semibold flex items-center gap-1.5 transition shadow-sm cursor-pointer"
              title="Run payment reconciliation audit across anomalous, pending and retry-chain orders"
            >
              <ShieldCheck size={16} className="text-amber-300" />
              <span>Payment Audit</span>
            </button>

            {selectedParticipantIds.size > 0 && (
              <div
                role="toolbar"
                aria-label="Selection actions"
                className="flex items-center flex-wrap gap-2 animate-in fade-in duration-150"
              >
                <div className="flex items-center gap-1.5 px-3 py-2.5 rounded-[18px] bg-black/[0.05] border border-black/10 text-xs font-semibold text-black">
                  <span>{selectedParticipantIds.size}</span>
                  <span className="font-normal text-black/60">selected</span>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="ml-1 text-[11px] font-medium text-black/40 hover:text-black underline cursor-pointer"
                  >
                    Clear
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setVerificationMode("selected");
                    setIsVerificationOpen(true);
                  }}
                  className="rounded-[18px] border border-amber-900/40 bg-[#78350f] hover:bg-[#92400e] text-[#fef3c7] px-4 py-2.5 text-xs font-semibold flex items-center gap-1.5 transition shadow-sm cursor-pointer"
                >
                  <ShieldCheck size={14} className="text-amber-300" />
                  <span>Verify Payment</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsResendEmailOpen(true)}
                  className="rounded-[18px] border border-blue-700/40 bg-[#1e40af] hover:bg-[#1d4ed8] text-[#dbeafe] px-4 py-2.5 text-xs font-semibold flex items-center gap-1.5 transition shadow-sm cursor-pointer"
                >
                  <Mail size={14} className="text-blue-300" />
                  <span>Resend Email</span>
                </button>
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-2 text-[10px] uppercase tracking-[0.16em] text-black/40">
            <div className="flex flex-wrap items-center gap-2">
              <span>
                Showing{" "}
                <span className="font-semibold text-black/70">
                  {participantGroups.length.toLocaleString()}
                </span>{" "}
                primary participant groups representing{" "}
                <span className="font-semibold text-black/70">
                  {filteredRegistrations.length.toLocaleString()}
                </span>{" "}
                of{" "}
                <span className="font-semibold text-black/70">
                  {stats.activeTotal.toLocaleString()}
                </span>{" "}
                active event registrations
              </span>
              {institutionFilter !== "all" && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-300 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-900 lowercase tracking-normal">
                  <Building2 size={12} className="text-emerald-700" />
                  <span>
                    {institutionFilter === "external"
                      ? "external only (excluding all cgc)"
                      : "cgc campuses only"}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleInstitutionFilterChange("all")}
                    className="ml-0.5 hover:text-black font-bold text-xs"
                    title="Reset to all institutions"
                  >
                    ✕
                  </button>
                </span>
              )}
              {filteredRegistrations.length !== stats.activeTotal && (
                <span className="font-normal text-amber-700/80 lowercase tracking-normal">
                  ({(stats.activeTotal - filteredRegistrations.length).toLocaleString()} registrations / {(stats.activeGroupsTotal - participantGroups.length).toLocaleString()} groups filtered out)
                </span>
              )}
            </div>
            {stats.archivedTotal > 0 && (
              <div className="text-black/30">
                {stats.archivedTotal.toLocaleString()} archived {stats.archivedTotal === 1 ? "record" : "records"}
              </div>
            )}
          </div>
        </div>

        {/* REGISTRATION TABLE */}

        {loading ? (
          <div className="rounded-[28px] bg-white px-6 py-20 text-center">
            <RefreshCw
              size={22}
              className="mx-auto animate-spin text-black/25"
            />

            <p className="mt-4 text-sm text-black/40">
              Loading registrations...
            </p>
          </div>
        ) : participantGroups.length ===
          0 ? (
          <div className="rounded-[28px] bg-white px-6 py-20 text-center">
            <Users
              size={28}
              className="mx-auto text-black/15"
            />

            <p className="mt-4 text-sm font-medium text-black">
              No registrations found
            </p>

            <p className="mt-2 text-xs text-black/35">
              Registrations created through
              the website will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[28px] bg-white shadow-[0_20px_80px_rgba(0,0,0,0.035)]">

            {/* DESKTOP HEADER */}

            <div className="hidden border-b border-black/10 bg-black/[0.025] px-6 py-4 lg:grid lg:grid-cols-[55px_1.25fr_1fr_1.6fr_1fr_1fr_auto] lg:gap-5">
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-black/30">
                Sr. No. (Group)
              </span>

              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-black/30">
                Participant
              </span>

              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-black/30">
                Contact
              </span>

              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-black/30">
                Events
              </span>

              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-black/30">
                Payment
              </span>

              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-black/30">
                Status
              </span>

              <div className="flex items-center justify-end gap-3">
                <input
                  type="checkbox"
                  id="select-all-visible"
                  aria-label="Select all visible participant groups"
                  checked={
                    participantGroups.length > 0 &&
                    participantGroups.every((g) =>
                      selectedParticipantIds.has(g[0].participant.id)
                    )
                  }
                  onChange={toggleSelectAll}
                  className="h-4 w-4 rounded border-black/20 text-black focus:ring-black cursor-pointer"
                  title="Select all visible participant groups"
                />
              </div>
            </div>

            <div className="divide-y divide-black/[0.07]">

              {participantGroups.map(
                (group, index) => {
                  const participant =
                    group[0].participant;

                  const acc = group.find((item) => item.accommodation)?.accommodation;
                  const memberAcc = group.flatMap((item) => item.members ?? []).find((m) => m.accommodation)?.accommodation;
                  const effectiveAcc = acc || memberAcc;
                  const groupSummary = calculateTeamPaymentSummary(group);

                  const checked =
                    group.filter(
                      (item) =>
                        item.registration
                          .checked_in ===
                        true
                    ).length;

                  return (
                    <button
                      type="button"
                      key={
                        participant.id
                      }
                      onClick={() =>
                        openParticipant(
                          group
                        )
                      }
                      className="group grid w-full gap-5 px-6 py-5 text-left transition hover:bg-black/[0.018] lg:grid-cols-[55px_1.25fr_1fr_1.6fr_1fr_1fr_auto] lg:items-center"
                    >
                      {/* SR NO */}
                      <div className="flex items-center text-xs font-mono font-medium text-black/40">
                        <span className="lg:hidden text-[10px] uppercase tracking-wider text-black/30 font-sans mr-2">Group #</span>
                        {index + 1}
                      </div>

                      {/* PARTICIPANT */}

                      <div className="flex min-w-0 items-center gap-3">

                        {participant.photo_url ? (
                          <Image
                            src={
                              participant.photo_url
                            }
                            alt=""
                            width={40}
                            height={40}
                            className="h-10 w-10 shrink-0 rounded-full object-cover"
                            unoptimized
                          />
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black text-xs font-semibold text-white">
                            {participant.name
                              ?.charAt(
                                0
                              )
                              .toUpperCase()}
                          </div>
                        )}

                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-black">
                            {
                              participant.name
                            }
                          </p>

                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            <span className="truncate font-mono text-[9px] text-black/35">
                              {
                                participant.participant_id
                              }
                            </span>
                            {groupSummary.hasAnyStay && (
                              <span
                                className={`inline-flex items-center rounded-full px-1.5 py-0.2 text-[8px] font-bold tracking-tight border ${
                                  groupSummary.stayBadgeVariant === "paid"
                                    ? "bg-violet-50 text-violet-700 border-violet-200"
                                    : groupSummary.stayBadgeVariant === "partial"
                                    ? "bg-purple-50 text-purple-700 border-purple-200"
                                    : "bg-amber-50 text-amber-700 border-amber-200"
                                }`}
                                title={groupSummary.stayBreakdownText || undefined}
                              >
                                🏨 Stay {groupSummary.stayBadgeVariant === "paid" ? "Paid" : groupSummary.stayBadgeVariant === "partial" ? "Partial" : "Pending"}
                                {groupSummary.totalTeamMembers > 1
                                  ? ` (${groupSummary.membersPaidStayCount}/${groupSummary.membersWithStayCount})`
                                  : (!acc && memberAcc ? " (Member)" : "")}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* CONTACT */}

                      <div className="min-w-0">
                        <p className="truncate text-xs text-black/60">
                          {
                            participant.email
                          }
                        </p>

                        <p className="mt-1 truncate text-[10px] text-black/35 font-mono">
                          {participant.phone || "No phone"}
                        </p>

                        <div className="mt-1 flex items-center gap-1.5 truncate text-[10px] text-black/45">
                          <span className="truncate" title={participant.college || undefined}>
                            {participant.college || "No college"}
                          </span>
                          {participant.college && (
                            <span
                              className={`shrink-0 rounded-full px-1.5 py-0.2 text-[8px] font-bold border ${
                                isCgcInstitution(participant.college, participant.email)
                                  ? "bg-purple-50 text-purple-700 border-purple-200"
                                  : "bg-emerald-50 text-emerald-800 border-emerald-200"
                              }`}
                            >
                              {isCgcInstitution(participant.college, participant.email)
                                ? "CGC"
                                : "External"}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* EVENTS */}

                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        {group.length > 1 && (
                          <span
                            className="rounded-full bg-purple-50 text-purple-700 px-2 py-0.5 text-[8.5px] font-bold border border-purple-200 shrink-0"
                            title={`${group.length} event registrations in this group`}
                          >
                            {group.length} events
                          </span>
                        )}
                        {group
                          .slice(0, 3)
                          .map(
                            (item) => (
                              <span
                                key={
                                  item.registration
                                    .id
                                }
                                className="rounded-full bg-black/[0.045] px-3 py-1.5 text-[9px] font-medium text-black/55"
                              >
                                {item.event
                                  ?.name ??
                                  "Unknown event"}
                              </span>
                            )
                          )}

                        {group.length >
                          3 && (
                            <span className="rounded-full bg-black px-3 py-1.5 text-[9px] text-white">
                              +
                              {group.length -
                                3}
                            </span>
                          )}
                      </div>

                      {/* PAYMENT */}

                      <div className="flex min-w-0 flex-wrap gap-1.5">
                        {group.slice(0, 3).map((item) => {
                          const isPaidEvent = item.event?.payment_type === "paid";
                          const fee = item.event?.registration_fee != null ? `₹${item.event.registration_fee}` : "Amount unavailable";
                          const isSuccess = item.registration.payment_status === "paid";

                          let displayClass = "bg-black/[0.04] text-black/45 border-black/10";
                          let displayText = "FREE";

                          if (isPaidEvent) {
                            if (isSuccess) {
                              displayClass = "bg-green-50 text-green-700 border-green-200";
                              displayText = `${fee} · PAID`;
                            } else {
                              displayClass = "bg-red-50 text-red-700 border-red-200";
                              displayText = `${fee} · PAYMENT PENDING`;
                            }
                          }

                          return (
                            <span
                              key={`pay-${item.registration.id}`}
                              className={`rounded-full px-2.5 py-1 text-[9px] font-bold tracking-wider border ${displayClass}`}
                            >
                              {displayText}
                            </span>
                          );
                        })}
                        {group.length > 3 && (
                          <span className="rounded-full bg-black/[0.045] px-3 py-1.5 text-[9px] font-medium text-black/55">
                            +{group.length - 3}
                          </span>
                        )}
                        {groupSummary.hasAnyStay && (
                          <span
                            className={`rounded-full px-2.5 py-1 text-[9px] font-bold tracking-wider border ${
                              groupSummary.stayBadgeVariant === "paid"
                                ? "bg-violet-50 text-violet-700 border-violet-200"
                                : groupSummary.stayBadgeVariant === "partial"
                                ? "bg-purple-50 text-purple-700 border-purple-200"
                                : "bg-amber-50 text-amber-700 border-amber-200"
                            }`}
                            title={groupSummary.stayBreakdownText || undefined}
                          >
                            🏨 {groupSummary.stayBadgeText}
                          </span>
                        )}
                      </div>

                      {/* STATUS */}

                      <div className="flex flex-wrap gap-1.5">
                        <span className="rounded-full border border-black/10 bg-black/[0.035] px-3 py-1.5 text-[9px] font-medium text-black/50">
                          {checked}/
                          {group.length}{" "}
                          checked
                        </span>
                        {acc && (
                          <span className="rounded-full border border-violet-200 bg-violet-50/70 px-2.5 py-1.5 text-[9px] font-medium text-violet-800">
                            Stay: {acc.checked_in ? "Checked In" : "Pending"}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-end gap-3">
                        <input
                          type="checkbox"
                          id={`select-participant-${participant.id}`}
                          aria-label={`Select ${participant.name}`}
                          checked={selectedParticipantIds.has(participant.id)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleSelectRow(participant.id);
                          }}
                          className="h-4 w-4 rounded border-black/20 text-black focus:ring-black cursor-pointer"
                        />
                        <span className="text-lg text-black/15 transition group-hover:translate-x-1 group-hover:text-black">
                          →
                        </span>
                      </div>
                    </button>
                  );
                }
              )}
            </div>
          </div>
        )}
      </div>

      {/* =====================================================
          DETAIL DRAWER
      ===================================================== */}

      {selectedParticipant && (() => {
        const selectedParticipantAccommodations: AccommodationDetail[] = (() => {
          if (Array.isArray(selectedParticipant.accommodations) && selectedParticipant.accommodations.length > 0) {
            return selectedParticipant.accommodations;
          }
          const accs: AccommodationDetail[] = [];
          if (selectedParticipant.accommodation) {
            accs.push(selectedParticipant.accommodation);
          }
          for (const reg of selectedParticipantEvents) {
            if (Array.isArray(reg.accommodations)) {
              for (const a of reg.accommodations) {
                if (!accs.some((existing) => existing.id === a.id)) {
                  accs.push(a);
                }
              }
            } else if (reg.accommodation && !accs.some((existing) => existing.id === reg.accommodation?.id)) {
              accs.push(reg.accommodation);
            }
          }
          return accs;
        })();

        const selectedParticipantAccommodation = selectedParticipantAccommodations[0] ?? null;

        return (
          <div className="fixed inset-0 z-[120] overflow-hidden" data-lenis-prevent="true">

            <button
              type="button"
              aria-label="Close"
              onClick={closeDrawer}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />

            <aside
              data-lenis-prevent="true"
              className="absolute right-0 top-0 z-[130] flex h-full w-full max-w-[620px] flex-col bg-[#f5f5f5] shadow-2xl overscroll-contain"
            >

              {/* DRAWER HEADER */}

              <div className="flex items-center justify-between border-b border-black/10 bg-white px-6 py-5">

                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-black/30">
                    Participant
                  </p>

                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <p className="font-mono text-xs text-black/60 font-semibold">
                      {
                        selectedParticipant.participant_id
                      }
                    </p>
                    {selectedParticipantAccommodation ? (
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[8px] font-bold uppercase tracking-wider border ${
                          selectedParticipantAccommodation.status === "paid"
                            ? "bg-violet-50 text-violet-700 border-violet-200"
                            : "bg-amber-50 text-amber-700 border-amber-200"
                        }`}
                      >
                        🏨 Stay: {selectedParticipantAccommodation.status === "paid" ? "Paid" : "Pending"}
                      </span>
                    ) : (
                      <span className="rounded-full px-2.5 py-0.5 text-[8px] font-medium text-black/35 bg-black/[0.03] border border-black/5">
                        No Stay Opted
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={closeDrawer}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-black text-white hover:bg-black/80 transition"
                >
                  <X size={16} />
                </button>
              </div>

              {/* DRAWER BODY */}

              <div
                data-lenis-prevent="true"
                className="flex-1 overflow-y-auto px-6 py-6 overscroll-contain"
                style={{ overscrollBehavior: "contain" }}
              >

                {/* PROFILE */}

                <div className="rounded-[28px] bg-black p-6 text-white">

                  <div className="flex items-center gap-4">

                    {selectedParticipant.photo_url ? (
                      <Image
                        src={
                          selectedParticipant.photo_url
                        }
                        alt=""
                        width={64}
                        height={64}
                        className="h-16 w-16 rounded-2xl object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-xl font-semibold text-black">
                        {selectedParticipant.name
                          ?.charAt(
                            0
                          )
                          .toUpperCase()}
                      </div>
                    )}

                    <div className="min-w-0">
                      <h2 className="text-2xl font-semibold tracking-[-0.04em]">
                        {
                          selectedParticipant.name
                        }
                      </h2>

                      <p className="mt-1 text-xs text-white/70">
                        {
                          selectedParticipant.college
                        }
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 space-y-3">

                    <DrawerInfo
                      icon={
                        <Mail
                          size={14}
                        />
                      }
                      value={
                        selectedParticipant.email
                      }
                    />

                    <DrawerInfo
                      icon={
                        <Phone
                          size={14}
                        />
                      }
                      value={
                        selectedParticipant.phone ??
                        "No phone"
                      }
                    />

                    <DrawerInfo
                      icon={
                        <GraduationCap
                          size={14}
                        />
                      }
                      value={
                        selectedParticipant.college ??
                        "No college"
                      }
                    />

                    <DrawerInfo
                      icon={
                        <Bed
                          size={14}
                        />
                      }
                      value={
                        selectedParticipantAccommodation
                          ? `Campus Stay: ${selectedParticipantAccommodation.plan_name} (${selectedParticipantAccommodation.status === "paid" ? `Paid · ₹${selectedParticipantAccommodation.amount}` : "Payment Pending"})`
                          : "Campus Stay: Not Opted"
                      }
                    />
                  </div>
                </div>

                {/* PERSONAL DETAILS */}
                <div className="mt-7">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-black/30 mb-2">Personal Details</p>
                  <div className="rounded-[24px] border border-black/10 bg-white p-5 text-black grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <SmallDetail label="Gender" value={selectedParticipant.gender ?? "No gender specified"} />
                    <SmallDetail label="State" value={selectedParticipant.state ?? "No state specified"} />
                    <SmallDetail
                      label="Campus Stay"
                      value={
                        selectedParticipantAccommodation
                          ? `${selectedParticipantAccommodation.plan_name} (${selectedParticipantAccommodation.status === "paid" ? "Paid" : "Pending"})`
                          : "Not Opted"
                      }
                      className={
                        selectedParticipantAccommodation
                          ? selectedParticipantAccommodation.status === "paid"
                            ? "text-violet-700 font-bold"
                            : "text-amber-700 font-bold"
                          : "text-black/40"
                      }
                    />
                  </div>
                </div>

              {/* DOCUMENTS */}
              {(selectedParticipant.photo_url ||
                selectedParticipant.id_card_storage_path ||
                viewDocumentUrl ||
                documentLoading ||
                documentError ||
                selectedParticipantEvents.some((item) =>
                  item.members?.some(
                    (m) =>
                      m.id_card_storage_path ||
                      m.participants?.id_card_storage_path
                  )
                )) && (
                <div id="participant-id-card-preview" className="mt-7">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-black/30 mb-2">Documents</p>
                  <div className="rounded-[24px] border border-black/10 bg-white p-5 text-black">
                      {selectedParticipant.photo_url && (
                        <div>
                          <p className="text-xs font-medium mb-1">Participant Photograph</p>
                          <a href={selectedParticipant.photo_url} target="_blank" rel="noreferrer" className="inline-block text-xs bg-black text-white rounded-full px-4 py-2 hover:bg-black/80 font-semibold transition">
                            View Participant Photograph
                          </a>
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-medium mb-1 mt-3">Participant ID Card</p>
                        {selectedParticipant.id_card_storage_path ? (
                          <button
                            type="button"
                            onClick={() =>
                              handleViewDocument(
                                selectedParticipant.id_card_storage_path,
                                "participant",
                                `${selectedParticipant.name} (Primary)`
                              )
                            }
                            className="text-xs border border-black/10 bg-white text-black hover:bg-black/5 rounded-full px-4 py-2 font-semibold transition"
                            disabled={documentLoading}
                          >
                            {documentLoading && activeDocumentPath === selectedParticipant.id_card_storage_path
                              ? "Loading..."
                              : "View Participant ID Card"}
                          </button>
                        ) : (
                          <p className="text-xs text-black/40 italic">
                            No ID card uploaded for primary participant
                          </p>
                        )}
                      </div>
                    {documentError && <p className="text-red-500 mt-2 text-xs font-medium">{documentError}</p>}
                    {viewDocumentUrl && (
                      <div className="mt-4 space-y-2">
                        {activeDocumentLabel && (
                          <div className="flex items-center justify-between text-xs pb-1 border-b border-black/5">
                            <span className="text-black/60 font-medium">
                              Showing ID Card:{" "}
                              <span className="text-black font-bold">
                                {activeDocumentLabel}
                              </span>
                            </span>
                          </div>
                        )}
                        <div className="border border-black/10 rounded-2xl overflow-hidden relative bg-black/5" style={{ height: "260px" }}>
                          <Image
                            src={viewDocumentUrl}
                            alt={activeDocumentLabel ? `ID Card - ${activeDocumentLabel}` : "Document preview"}
                            fill
                            className="object-contain"
                            unoptimized
                          />
                        </div>
                        <div className="flex items-center justify-between text-xs pt-1">
                          <a href={viewDocumentUrl} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline font-semibold">
                            Open full size in new tab ↗
                          </a>
                          <button
                            type="button"
                            onClick={() => {
                              setViewDocumentUrl(null);
                              setActiveDocumentLabel(null);
                              setActiveDocumentPath(null);
                            }}
                            className="text-black/50 hover:text-black font-medium"
                          >
                            Close preview
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* FACULTY */}
              <div className="mt-7">
                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-black/30 mb-2">Faculty In-Charge</p>
                {(() => {
                  const facultyInCharge = selectedParticipantEvents.find((item) => item.faculty)?.faculty ?? selectedParticipantEvents[0]?.faculty ?? null;
                  const facultyStoragePath = facultyInCharge?.id_card_storage_path || facultyInCharge?.idCardStoragePath;

                  if (!facultyInCharge) {
                    return (
                      <div className="rounded-[24px] border border-black/10 bg-black/5 p-5 text-black/50 text-sm font-medium text-center">
                        No Faculty Information
                      </div>
                    );
                  }

                  return (
                    <div className="rounded-[24px] border border-black/10 bg-white p-5 text-black space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <SmallDetail label="Name" value={facultyInCharge.name} />
                        <SmallDetail label="Email" value={facultyInCharge.email} className="truncate" />
                        <SmallDetail label="Phone" value={facultyInCharge.phone ?? "No phone"} />
                        <SmallDetail label="College / Institution" value={facultyInCharge.college ?? "No college"} />
                      </div>
                      <div className="pt-3 border-t border-black/10 mt-2">
                        <p className="text-xs font-medium mb-2">Faculty ID Card</p>
                        {facultyStoragePath ? (
                          <button
                            type="button"
                            onClick={() => handleViewDocument(facultyStoragePath, "faculty")}
                            className="text-xs border border-black/10 bg-white text-black hover:bg-black/5 rounded-full px-4 py-2 font-semibold transition w-full"
                            disabled={facultyDocumentLoading}
                          >
                            {facultyDocumentLoading ? "Loading..." : "View Faculty ID Card"}
                          </button>
                        ) : (
                          <p className="text-xs text-black/40 italic">No ID card uploaded for faculty member</p>
                        )}
                        {facultyDocumentError && (
                          <p className="text-red-500 mt-2 text-xs font-medium">{facultyDocumentError}</p>
                        )}
                        {facultyDocumentUrl && (
                          <div className="mt-4 space-y-2">
                            <div className="border border-black/10 rounded-2xl overflow-hidden relative bg-black/5" style={{ height: "260px" }}>
                              <Image src={facultyDocumentUrl} alt="Faculty ID Card preview" fill className="object-contain" unoptimized />
                            </div>
                            <div className="flex items-center justify-between text-xs pt-1">
                              <a href={facultyDocumentUrl} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline font-semibold">
                                Open full size in new tab ↗
                              </a>
                              <button type="button" onClick={() => setFacultyDocumentUrl(null)} className="text-black/50 hover:text-black">
                                Close preview
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* CAMPUS ACCOMMODATION */}
              <div className="mt-7">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-black/30">
                        Campus Accommodation ({selectedParticipantAccommodations.length})
                      </p>
                      {selectedParticipantAccommodations.length > 0 && (
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[8px] font-bold uppercase tracking-wider border ${
                            selectedParticipantAccommodations.every((a) => a.status === "paid")
                              ? "border-green-200 bg-green-50 text-green-700"
                              : selectedParticipantAccommodations.some((a) => a.status === "paid")
                              ? "border-blue-200 bg-blue-50 text-blue-700"
                              : "border-amber-200 bg-amber-50 text-amber-700"
                          }`}
                        >
                          {selectedParticipantAccommodations.every((a) => a.status === "paid")
                            ? "All Paid"
                            : selectedParticipantAccommodations.some((a) => a.status === "paid")
                            ? "Partially Paid"
                            : "Payment Pending"}
                        </span>
                      )}
                    </div>

                    {selectedParticipantAccommodations.length > 0 ? (
                      <div className="space-y-3">
                        {selectedParticipantAccommodations.map((acc, accIdx) => (
                          <div key={acc.id || accIdx} className="rounded-[24px] border border-black/10 bg-white p-5 text-black space-y-4">
                            <div className="flex items-center justify-between pb-3 border-b border-black/5">
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-50 text-violet-700 border border-violet-100">
                                  <Bed size={18} />
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <p className="text-sm font-semibold text-black">
                                      {acc.plan_name || "Campus Stay Pass"}
                                    </p>
                                    <span
                                      className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider border ${
                                        acc.status === "paid"
                                          ? "border-green-200 bg-green-50 text-green-700"
                                          : "border-amber-200 bg-amber-50 text-amber-700"
                                      }`}
                                    >
                                      {acc.status === "paid" ? "Paid" : "Pending"}
                                    </span>
                                  </div>
                                  <p className="text-[10px] text-black/40">
                                    {acc.duration_days
                                      ? `${acc.duration_days} Day${
                                          acc.duration_days > 1 ? "s" : ""
                                        } Pass`
                                      : "Standard Stay"}
                                  </p>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-base font-bold text-black">
                                  ₹{(acc.amount || 0).toLocaleString()}
                                </p>
                                <p className="text-[9px] uppercase tracking-wider text-black/40 font-semibold">
                                  Accommodation Fee
                                </p>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <SmallDetail
                                label="Check-in Date"
                                value={formatDate(acc.start_date)}
                              />
                              <SmallDetail
                                label="Check-out Date"
                                value={formatDate(acc.end_date)}
                              />
                              <SmallDetail
                                label="Hostel"
                                value={acc.hostel_name || "To be allocated"}
                              />
                              <SmallDetail
                                label="Room / Bed"
                                value={acc.room_number || "To be allocated"}
                              />
                              <SmallDetail
                                label="Hostel Check-in"
                                value={
                                  acc.checked_in
                                    ? (acc.checked_in_at
                                        ? formatDate(acc.checked_in_at)
                                        : "Checked in")
                                    : "Pending"
                                }
                              />
                              <SmallDetail
                                label="Hostel Check-out"
                                value={
                                  acc.checked_out
                                    ? (acc.checked_out_at
                                        ? formatDate(acc.checked_out_at)
                                        : "Checked out")
                                    : "Pending"
                                }
                              />
                              <SmallDetail
                                label="Payment Reference"
                                value={
                                  acc.payment_order_reference ||
                                  acc.gateway_payment_id ||
                                  (acc.payment_order_id
                                    ? `Order: ${acc.payment_order_id.slice(0, 8)}…`
                                    : "Unlinked / Direct")
                                }
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-[24px] border border-black/10 bg-black/5 p-4 text-black/40 text-xs font-medium text-center">
                        No Accommodation Opted
                      </div>
                    )}
                  </div>

              {/* EVENT REGISTRATIONS */}

              <div className="mt-7">

                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-black/30">
                  Registered events
                </p>

                <h3 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-black">
                  {
                    selectedParticipantEvents.length
                  }{" "}
                  event
                  {selectedParticipantEvents.length ===
                    1
                    ? ""
                    : "s"}
                </h3>

                <div className="mt-4 space-y-3">

                  {selectedParticipantEvents.map(
                    (item) => (
                      <div
                        key={
                          item.registration
                            .id
                        }
                        className="rounded-[24px] border border-black/10 bg-white p-5 text-black"
                      >

                        <div className="flex items-start justify-between gap-4">

                          <div>
                            <p className="text-lg font-semibold">
                              {
                                item.event
                                  ?.name ??
                                "Unknown event"
                              }
                            </p>

                            <p className="mt-1 text-[9px] uppercase tracking-[0.16em] text-black/30">
                              {
                                item.event
                                  ?.category ??
                                "Event"
                              }
                            </p>
                          </div>

                          <div className="flex flex-col items-end gap-2">
                            <span
                              className={`rounded-full border px-3 py-1 text-[9px] font-medium ${item.registration
                                .main_checked_in
                                ? "border-blue-200 bg-blue-50 text-blue-700"
                                : "border-black/10 bg-black/[0.035] text-black/45"
                                }`}
                            >
                              Main: {item.registration
                                .main_checked_in
                                ? "Checked in"
                                : "Pending"}
                            </span>
                            <span
                              className={`rounded-full border px-3 py-1 text-[9px] font-medium ${item.registration
                                .checked_in
                                ? "border-green-200 bg-green-50 text-green-700"
                                : "border-black/10 bg-black/[0.035] text-black/45"
                                }`}
                            >
                              Event: {item.registration
                                .checked_in
                                ? "Checked in"
                                : "Pending"}
                            </span>
                          </div>
                        </div>

                        <div className="mt-5 grid grid-cols-2 gap-2">

                          <SmallDetail
                            label="Payment"
                            value={paymentLabel(
                              item.registration
                                .payment_status
                            )}
                            className={paymentClass(
                              item.registration
                                .payment_status
                            )}
                          />

                          <SmallDetail
                            label="Amount"
                            value={formatAmount(
                              item.registration
                                .payment_amount
                            )}
                          />

                          <SmallDetail
                            label="Team"
                            value={
                              item.registration
                                .team_name ??
                              "Individual"
                            }
                          />

                          <SmallDetail
                            label="Registered"
                            value={formatDate(
                              item.registration
                                .created_at
                            )}
                          />
                        </div>

                        {item.payment_order && item.registration.payment_status !== "not_required" && (
                          <div className="mt-5 border-t border-black/10 pt-4">
                            <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-black/35 mb-3">
                              Payment Gateway Details
                            </p>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              {item.payment_order.gateway && (
                                <SmallDetail
                                  label="Gateway"
                                  value={item.payment_order.gateway}
                                />
                              )}
                              {item.payment_order.gateway_order_id && (
                                <SmallDetail
                                  label="Order ID"
                                  value={item.payment_order.gateway_order_id}
                                />
                              )}
                              {item.payment_order.gateway_payment_id && (
                                <SmallDetail
                                  label="Payment ID"
                                  value={item.payment_order.gateway_payment_id}
                                />
                              )}
                              {item.payment_order.order_reference && (
                                <SmallDetail
                                  label="Internal Ref"
                                  value={item.payment_order.order_reference}
                                />
                              )}
                            </div>
                          </div>
                        )}

                        {item.members && item.members.length > 0 && (
                          <div className="mt-5 border-t border-black/10 pt-4">
                            <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-black/35 mb-3">
                              Team Members
                            </p>
                            <div className="space-y-2">
                              {item.members.map((member) => {
                                const memberPath =
                                  member.id_card_storage_path ||
                                  member.participants?.id_card_storage_path ||
                                  (member.is_team_leader
                                    ? selectedParticipant.id_card_storage_path
                                    : null);
                                const memberLabel = `${member.name}${
                                  member.participants?.participant_id
                                    ? ` (${member.participants.participant_id})`
                                    : member.is_team_leader
                                    ? " (Leader)"
                                    : ""
                                }`;
                                const isCurrentlyLoading =
                                  documentLoading &&
                                  Boolean(memberPath) &&
                                  activeDocumentPath === memberPath;
                                const isCurrentlyActive =
                                  viewDocumentUrl !== null &&
                                  Boolean(memberPath) &&
                                  activeDocumentPath === memberPath;

                                return (
                                  <div
                                    key={member.id}
                                    className="rounded-[18px] border border-black/5 bg-black/[0.01] p-4 text-xs"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2">
                                        <span className="font-semibold text-black">
                                          {member.name}
                                        </span>
                                        {member.is_team_leader ? (
                                          <span className="rounded-full bg-black px-2 py-0.5 text-[8px] font-semibold text-white">
                                            Leader
                                          </span>
                                        ) : (
                                          <span className="font-mono text-[10px] font-bold text-black/45">
                                            {member.participants?.participant_id || "No ID"}
                                          </span>
                                        )}
                                        {member.accommodation && (
                                          <span
                                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[8px] font-bold border ${
                                              member.accommodation.status === "paid"
                                                ? "bg-violet-50 text-violet-700 border-violet-200"
                                                : "bg-amber-50 text-amber-700 border-amber-200"
                                            }`}
                                          >
                                            <Bed size={9} />
                                            <span>Stay: {member.accommodation.status === "paid" ? "Paid" : "Pending"}</span>
                                          </span>
                                        )}
                                      </div>

                                      <div>
                                        {memberPath ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleViewDocument(
                                                memberPath,
                                                "participant",
                                                memberLabel
                                              )
                                            }
                                            disabled={documentLoading}
                                            className={`text-[10px] rounded-full px-2.5 py-1 font-semibold transition border ${
                                              isCurrentlyActive
                                                ? "bg-black text-white border-black"
                                                : "bg-white text-black border-black/10 hover:bg-black/5"
                                            }`}
                                          >
                                            {isCurrentlyLoading
                                              ? "Loading..."
                                              : "View ID Card"}
                                          </button>
                                        ) : (
                                          <span className="text-[10px] text-black/35 font-medium italic">
                                            No ID Card
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="mt-1.5 flex flex-col gap-0.5 text-[10px] text-black/40">
                                      {member.email && <span>{member.email}</span>}
                                      {member.phone && <span>{member.phone}</span>}
                                      {member.participants?.college && (
                                        <span className="italic mt-0.5">
                                          {member.participants.college}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <div className="mt-5 flex gap-2 border-t border-black/10 pt-5">

                          <button
                            type="button"
                            disabled={
                              updatingId ===
                              item.registration
                                .id
                            }
                            onClick={() =>
                              toggleCheckIn(
                                item,
                                "main"
                              )
                            }
                            className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-3 text-xs font-medium disabled:opacity-50 ${item.registration
                              .main_checked_in
                              ? "border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                              : "bg-blue-600 text-white hover:bg-blue-700"
                              }`}
                          >
                            <Check
                              size={14}
                            />

                            {item.registration
                              .main_checked_in
                              ? "Undo Main"
                              : "Main Check In"}
                          </button>
                          
                          <button
                            type="button"
                            disabled={
                              updatingId ===
                              item.registration
                                .id
                            }
                            onClick={() =>
                              toggleCheckIn(
                                item,
                                "event"
                              )
                            }
                            className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-3 text-xs font-medium disabled:opacity-50 ${item.registration
                              .checked_in
                              ? "border border-black/10 bg-white text-black/55 hover:bg-black hover:text-white"
                              : "bg-black text-white hover:bg-black/80"
                              }`}
                          >
                            <Check
                              size={14}
                            />

                            {item.registration
                              .checked_in
                              ? "Undo Event"
                              : "Event Check In"}
                          </button>

                          {role === "master" && (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={
                                  deletingId === item.registration.id || updatingId === item.registration.id
                                }
                                onClick={() =>
                                  item.registration.is_archived
                                    ? restoreRegistration(item)
                                    : archiveRegistration(item)
                                }
                                className={`flex h-11 w-11 items-center justify-center rounded-full border disabled:opacity-50 ${item.registration.is_archived
                                  ? "border-green-200 text-green-600 hover:bg-green-50"
                                  : "border-orange-200 text-orange-500 hover:bg-orange-50"
                                  }`}
                                title={item.registration.is_archived ? "Restore Registration" : "Archive Registration"}
                              >
                                {item.registration.is_archived ? (
                                  <RefreshCw size={14} />
                                ) : (
                                  <Trash2 size={14} />
                                )}
                              </button>

                              <button
                                type="button"
                                disabled={
                                  deletingId === item.registration.id || updatingId === item.registration.id
                                }
                                onClick={() => deleteRegistration(item)}
                                className="flex h-11 px-3 gap-2 items-center justify-center rounded-full border border-red-200 text-red-600 hover:bg-red-50 text-[10px] font-semibold uppercase tracking-wider disabled:opacity-50"
                                title="Delete Registration Permanently"
                              >
                                <X size={14} />
                                Delete
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="mt-3 flex flex-col gap-1">
                          {item.registration
                            .main_checked_in_at && (
                              <p className="text-[9px] text-black/30">
                                Main Checked in{" "}
                                {formatDate(
                                  item.registration
                                    .main_checked_in_at
                                )}
                              </p>
                            )}
                          {item.registration
                            .checked_in_at && (
                              <p className="text-[9px] text-black/30">
                                Event Checked in{" "}
                                {formatDate(
                                  item.registration
                                    .checked_in_at
                                )}
                              </p>
                            )}
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>
      );
    })()}

      <PaymentVerificationDialog
        isOpen={isVerificationOpen}
        onClose={() => setIsVerificationOpen(false)}
        selectedParticipantIds={Array.from(selectedParticipantIds)}
        initialMode={verificationMode}
      />

      <ResendEmailDialog
        isOpen={isResendEmailOpen}
        onClose={() => setIsResendEmailOpen(false)}
        selectedParticipantIds={Array.from(selectedParticipantIds)}
      />

      {adminIdentity?.isPrimary && (
        <SitePageLocksModal
          isOpen={isPageLocksOpen}
          onClose={() => setIsPageLocksOpen(false)}
          isPrimary={adminIdentity.isPrimary}
          siteAccess={siteLocks}
          onUpdate={(updated) => setSiteLocks(updated)}
        />
      )}
    </main>
  );
}

/* =========================================================
   COMPONENTS
========================================================= */

function StatCard({
  title,
  value,
  subtitle,
  icon,
  dark = false,
}: {
  title: string;
  value: number;
  subtitle?: ReactNode;
  icon: ReactNode;
  dark?: boolean;
}) {
  return (
    <div
      className={`rounded-[28px] p-7 ${dark
        ? "bg-black text-white"
        : "bg-white"
        }`}
    >
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-full ${dark
          ? "bg-white/10 text-white"
          : "bg-black/[0.04] text-black"
          }`}
      >
        {icon}
      </div>

      <p
        className={`mt-7 text-[9px] font-semibold uppercase tracking-[0.2em] ${dark
          ? "text-white/40"
          : "text-black/35"
          }`}
      >
        {title}
      </p>

      <div
        className={`mt-2 text-4xl font-semibold tracking-[-0.05em] ${dark ? "text-white" : "text-black"
          }`}
      >
        {value}
      </div>

      {subtitle && (
        <div
          className={`mt-2 text-xs font-medium ${dark ? "text-white/50" : "text-black/45"
            }`}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}

function DrawerInfo({
  icon,
  value,
}: {
  icon: ReactNode;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 text-xs text-white/80">
      <span className="text-white/80">
        {icon}
      </span>

      <span className="truncate">
        {value}
      </span>
    </div>
  );
}

function SmallDetail({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-xl bg-black/[0.035] px-3 py-3">
      <p className="text-[8px] uppercase tracking-[0.14em] text-black/30">
        {label}
      </p>

      <span
        className={`mt-1 inline-block text-xs font-medium ${className}`}
      >
        {value}
      </span>
    </div>
  );
}