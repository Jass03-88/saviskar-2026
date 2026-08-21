"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
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
} from "lucide-react";
import { supabase } from "@/lib/supabase";

/* =========================================================
   TYPES
========================================================= */

type Participant = {
  id: string;
  participant_id: string;
  name: string;
  college: string | null;
  email: string;
  phone: string | null;
  photo_url: string | null;
  created_at: string;
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
  is_archived: boolean | null;
  created_at: string;
};

type EventRecord = {
  id: string;
  name: string;
  category: string | null;
  payment_type: string | null;
  registration_fee: number | null;
};

type RegistrationMember = {
  id: string;
  participant_event_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_team_leader: boolean | null;
  participant_id: string | null;
  participants: {
    participant_id: string;
    college: string | null;
  } | null;
};

type Registration = {
  participant: Participant;
  event: EventRecord | null;
  registration: ParticipantEvent;
  members?: RegistrationMember[];
  payment_order?: {
    id: string;
    order_reference: string;
    gateway: string | null;
    gateway_order_id: string | null;
    gateway_payment_id: string | null;
    status: string;
    updated_at: string;
  } | null;
};

type StatusFilter = "all" | "checked-in" | "pending";
type PaymentFilter = "all" | "paid" | "pending" | "not_required";
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

function escapeCsv(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

/* =========================================================
   PAGE
========================================================= */

export default function AdminPage() {
  const router = useRouter();

  const [registrations, setRegistrations] =
    useState<Registration[]>([]);

  const [events, setEvents] =
    useState<EventRecord[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [role, setRole] =
    useState<AdminRole | null>(null);

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

  const [paymentOverviewState, setPaymentOverviewState] = useState<"all" | "paid" | "unpaid" | "free">("all");
  const [paymentOverviewCategory, setPaymentOverviewCategory] = useState<"all" | "technical" | "non-technical" | "cultural" | "sports">("all");

  const [selectedParticipant, setSelectedParticipant] =
    useState<Participant | null>(null);

  const [selectedParticipantEvents, setSelectedParticipantEvents] =
    useState<Registration[]>([]);

  const [updatingId, setUpdatingId] =
    useState<string | null>(null);

  const [deletingId, setDeletingId] =
    useState<string | null>(null);

  /* =======================================================
     AUTH
  ======================================================= */

  const checkAuth = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      router.replace("/admin/login");
      return false;
    }

    return true;
  }, [router]);

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
          "/api/admin/registrations",
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
            error?: string;
          };

        if (!response.ok) {
          throw new Error(
            payload.error ??
              "Could not load registrations."
          );
        }

        setRegistrations(
          payload.registrations ?? []
        );
        setEvents(
          payload.events ?? []
        );
        if (payload.role) {
          setRole(payload.role);
        }
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
    void loadData();

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
  }, [loadData]);

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

      return registrations.filter(
        (item) => {
          const participant =
            item.participant;

          const eventName =
            item.event?.name ?? "";

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
            participant.college
              ?.toLowerCase()
              .includes(query) ||
            participant.participant_id
              ?.toLowerCase()
              .includes(query) ||
            eventName
              .toLowerCase()
              .includes(query) ||
            item.registration.team_name
              ?.toLowerCase()
              .includes(query);

          let matchesEvent = true;

          if (eventTypeFilter === "paid_events") {
            matchesEvent = matchesEvent && item.event?.payment_type === "paid";
          } else if (eventTypeFilter === "free_events") {
            matchesEvent = matchesEvent && item.event?.payment_type === "free";
          }

          if (eventFilter !== "all") {
            matchesEvent = matchesEvent && item.registration.event_id === eventFilter;
          }

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

          const matchesPayment =
            paymentFilter === "all" ||
            item.registration
              .payment_status
              ?.toLowerCase() ===
              paymentFilter;

          const matchesArchive =
            archiveFilter === "all" ||
            (archiveFilter === "archived" &&
              item.registration.is_archived === true) ||
            (archiveFilter === "active" &&
              item.registration.is_archived !== true);

          return (
            matchesSearch &&
            matchesEvent &&
            matchesStatus &&
            matchesPayment &&
            matchesArchive
          );
        }
      );
    }, [
      registrations,
      search,
      eventFilter,
      statusFilter,
      paymentFilter,
      archiveFilter,
    ]);

  /* =======================================================
     STATS
  ======================================================= */

  const stats = useMemo(() => {
    // Only count active registrations for the dashboard stats
    const activeRegistrations = registrations.filter(
      (item) => item.registration.is_archived !== true
    );

    const total =
      activeRegistrations.length;

    const checkedIn =
      activeRegistrations.filter(
        (item) =>
          item.registration
            .checked_in === true
      ).length;

    const pending =
      total - checkedIn;

    const uniqueParticipants =
      new Set(
        activeRegistrations.map(
          (item) =>
            item.participant.id
        )
      ).size;

    return {
      total,
      checkedIn,
      pending,
      uniqueParticipants,
    };
  }, [registrations]);

  /* =======================================================
     PAYMENT STATS
  ======================================================= */

  const paymentStats = useMemo(() => {
    let allCount = 0;
    let paidCount = 0;
    let unpaidCount = 0;
    let freeCount = 0;

    const activeRegistrations = registrations.filter(
      (item) => item.registration.is_archived !== true
    );

    activeRegistrations.forEach((item) => {
      const isPaidEvent = item.event?.payment_type === "paid";
      const isSuccess = item.registration.payment_status === "paid";

      allCount++;
      if (!isPaidEvent) {
        freeCount++;
      } else if (isSuccess) {
        paidCount++;
      } else {
        unpaidCount++;
      }
    });

    return { all: allCount, paid: paidCount, unpaid: unpaidCount, free: freeCount };
  }, [registrations]);

  /* =======================================================
     EVENT ANALYTICS
  ======================================================= */

  const eventAnalytics =
    useMemo(() => {
      return events
        .map((event) => {
          // Event analytics only count active registrations
          const count =
            registrations.filter(
              (item) =>
                item.registration
                  .event_id ===
                event.id &&
                item.registration.is_archived !== true
            ).length;

          const checked =
            registrations.filter(
              (item) =>
                item.registration.event_id === event.id &&
                item.registration.checked_in === true &&
                item.registration.is_archived !== true
            ).length;

          const paidCount =
            registrations.filter(
              (item) =>
                item.registration.event_id === event.id &&
                item.registration.is_archived !== true &&
                item.registration.payment_status === "paid"
            ).length;

          const pendingCount = event.payment_type === "paid" ? count - paidCount : 0;

          return {
            ...event,
            count,
            checked,
            paidCount,
            pendingCount,
          };
        })
        .filter(
          (event) => event.count > 0
        );
    }, [events, registrations]);

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
  }

  /* =======================================================
     CHECK IN
  ======================================================= */

  async function toggleCheckIn(
    registration: Registration
  ) {
    const next =
      registration.registration.checked_in !== true;

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
            checkedIn: next,
          }),
        }
      );

      const payload =
        (await response.json()) as {
          registration?: {
            checked_in: boolean;
            checked_in_at: string | null;
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
     CSV
  ======================================================= */

  function exportCsv() {
    const rows = [
      [
        "Participant ID",
        "Name",
        "College",
        "Email",
        "Phone",
        "Event",
        "Category",
        "Team",
        "Registration Status",
        "Payment Status",
        "Payment Amount",
        "Payment ID",
        "Checked In",
        "Checked In At",
        "Registered At",
      ],
      ...filteredRegistrations.map(
        (item) => [
          item.participant
            .participant_id,

          item.participant.name,

          item.participant.college ??
            "",

          item.participant.email,

          item.participant.phone ??
            "",

          item.event?.name ??
            item.registration
              .event_id,

          item.event?.category ??
            "",

          item.registration
            .team_name ??
            "Individual",

          item.registration
            .registration_status ??
            "",

          item.registration
            .payment_status ??
            "",

          item.registration
            .payment_amount ??
            0,

          item.registration
            .payment_id ??
            "",

          item.registration
            .checked_in
            ? "Yes"
            : "No",

          formatDate(
            item.registration
              .checked_in_at
          ),

          formatDate(
            item.registration
              .created_at
          ),
        ]
      ),
    ];

    const csv =
      rows
        .map((row) =>
          row
            .map(escapeCsv)
            .join(",")
        )
        .join("\n");

    const blob =
      new Blob([csv], {
        type: "text/csv;charset=utf-8;",
      });

    const url =
      URL.createObjectURL(blob);

    const link =
      document.createElement("a");

    link.href = url;

    link.download =
      `saviskar-registrations-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;

    document.body.appendChild(link);

    link.click();

    link.remove();

    URL.revokeObjectURL(url);
  }

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <main className="min-h-screen bg-[#f5f5f5] px-5 py-10 md:px-10 lg:px-16">
      <div className="mx-auto max-w-[1500px]">

        {/* HEADER */}

        <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-black/40">
              Saviskar 2026
            </p>

            <h1 className="text-4xl font-semibold tracking-[-0.05em] md:text-6xl text-black">
              Registrations
            </h1>

            <p className="mt-4 text-sm text-black/45">
              Manage registrations and participant entry.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">

            {role === "master" && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    router.push(
                      "/admin/events"
                    )
                  }
                  className="flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm text-white transition hover:scale-[1.02]"
                >
                  <CalendarDays
                    size={15}
                  />

                  Manage Events
                </button>

                <button
                  type="button"
                  onClick={() =>
                    router.push(
                      "/admin/admins"
                    )
                  }
                  className="flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm text-white transition hover:scale-[1.02]"
                >
                  <Users size={15} />

                  Manage Admins
                </button>

                <button
                  type="button"
                  onClick={() =>
                    router.push(
                      "/admin/logs"
                    )
                  }
                  className="flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm text-white transition hover:scale-[1.02]"
                >
                  <Clock3 size={15} />

                  Audit Logs
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() =>
                router.push(
                  "/register?from=admin"
                )
              }
              className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm transition hover:bg-black/[0.03] text-black/70"
            >
              <ExternalLink
                size={15}
              />

              Add Registration
            </button>

            <button
              type="button"
              onClick={() =>
                router.push(
                  "/admin/scanner"
                )
              }
              className="flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm text-white transition hover:scale-[1.02]"
            >
              <QrCode size={15} />

              Entry Scanner
            </button>

            <button
              type="button"
              onClick={() =>
                loadData(true)
              }
              disabled={refreshing}
              className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm transition hover:bg-black/[0.03] disabled:opacity-50 text-black/70"
            >
              <RefreshCw
                size={15}
                className={
                  refreshing
                    ? "animate-spin"
                    : ""
                }
              />

              Refresh
            </button>

            <button
              type="button"
              onClick={logout}
              className="flex items-center gap-2 rounded-full border border-black/10 bg-black px-5 py-3 text-sm transition hover:bg-black/[0.03]"
            >
              <LogOut
                size={15}
              />

              Logout
            </button>
          </div>
        </div>

        {/* ERROR */}

        {error && (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* STATS */}

        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

          <StatCard
            title="Total registrations"
            value={stats.total}
            icon={
              <CalendarDays
                size={18}
              />
            }
            dark
          />

          <StatCard
            title="Participants"
            value={
              stats.uniqueParticipants
            }
            icon={
              <Users size={18} />
            }
          />

          <StatCard
            title="Checked in"
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
            title="Pending"
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

        <div className="mb-8 rounded-[28px] bg-white p-6 shadow-[0_20px_80px_rgba(0,0,0,0.04)] md:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-black/35">
                Financial Snapshot
              </p>
              <h2 className="mt-2 text-xl font-semibold text-black md:text-2xl">
                Payment Overview
              </h2>
            </div>
            
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPaymentOverviewState("all")}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition ${paymentOverviewState === "all" ? "bg-black text-white" : "bg-black/[0.04] text-black/60 hover:bg-black/[0.08]"}`}
              >
                ALL <span className="opacity-50 font-mono">{paymentStats.all}</span>
              </button>
              <button
                type="button"
                onClick={() => setPaymentOverviewState("paid")}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition ${paymentOverviewState === "paid" ? "bg-green-600 text-white" : "bg-green-50 text-green-700 hover:bg-green-100"}`}
              >
                PAID <span className="opacity-50 font-mono">{paymentStats.paid}</span>
              </button>
              <button
                type="button"
                onClick={() => setPaymentOverviewState("unpaid")}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition ${paymentOverviewState === "unpaid" ? "bg-red-600 text-white" : "bg-red-50 text-red-700 hover:bg-red-100"}`}
              >
                UNPAID <span className="opacity-50 font-mono">{paymentStats.unpaid}</span>
              </button>
              <button
                type="button"
                onClick={() => setPaymentOverviewState("free")}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition ${paymentOverviewState === "free" ? "bg-black/60 text-white" : "bg-black/[0.04] text-black/50 hover:bg-black/[0.08]"}`}
              >
                FREE <span className="opacity-50 font-mono">{paymentStats.free}</span>
              </button>
            </div>
          </div>
          
          <div className="mt-6 border-t border-black/[0.05] pt-6">
            <div className="flex flex-wrap gap-2 mb-6">
              {["all", "technical", "non-technical", "cultural", "sports"].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setPaymentOverviewCategory(cat as any)}
                  className={`rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition border ${
                    paymentOverviewCategory === cat 
                      ? "border-black/20 bg-black/[0.03] text-black" 
                      : "border-transparent text-black/40 hover:text-black/70"
                  }`}
                >
                  {cat === "all" ? "All Categories" : cat.replace("-", " ")}
                </button>
              ))}
            </div>
            
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {eventAnalytics
                .filter((event) => {
                  const isPaidEvent = event.payment_type === "paid";
                  if (paymentOverviewCategory !== "all") {
                    if (event.category?.toLowerCase() !== paymentOverviewCategory.toLowerCase()) return false;
                  }
                  if (paymentOverviewState === "free") return !isPaidEvent;
                  if (paymentOverviewState === "paid" || paymentOverviewState === "unpaid") {
                    if (!isPaidEvent) return false;
                  }
                  return true;
                })
                .map((event) => {
                  const eventRegs = registrations.filter(r => r.registration.event_id === event.id && r.registration.is_archived !== true);
                  let matchedCount = 0;
                  
                  eventRegs.forEach(r => {
                    const isSuccess = r.registration.payment_status === "paid";
                    if (paymentOverviewState === "paid" && !isSuccess) return;
                    if (paymentOverviewState === "unpaid" && isSuccess) return;
                    matchedCount++;
                  });
                  
                  if (matchedCount === 0 && paymentOverviewState !== "all") return null;

                  const fee = event.registration_fee != null ? `₹${event.registration_fee}` : "Amount unavailable";
                  const isPaidEvent = event.payment_type === "paid";
                  
                  let badgeClass = "bg-black/[0.04] border-black/10 text-black/45";
                  let badgeText = "FREE";
                  
                  if (isPaidEvent) {
                    if (paymentOverviewState === "unpaid" || (paymentOverviewState === "all" && matchedCount > 0)) {
                      badgeClass = "bg-red-50 text-red-700 border-red-200";
                      badgeText = `${fee} · PAYMENT PENDING`;
                    }
                    if (paymentOverviewState === "paid") {
                      badgeClass = "bg-green-50 text-green-700 border-green-200";
                      badgeText = `${fee} · PAID`;
                    }
                  }

                  return (
                    <div key={`po-${event.id}`} className="rounded-[20px] bg-black/[0.02] border border-black/[0.04] p-5 flex flex-col justify-between">
                      <div>
                        <p className="truncate text-[10px] uppercase tracking-[0.16em] text-black/40">
                          {event.category ?? "Event"}
                        </p>
                        <p className="mt-1 truncate text-sm font-semibold text-black">
                          {event.name}
                        </p>
                        <div className="mt-2.5">
                          {isPaidEvent ? (
                            <span className={`rounded-full px-2 py-1 text-[8px] font-bold uppercase tracking-wider border ${
                              paymentOverviewState === 'all'
                                ? 'bg-black/[0.04] text-black/60 border-black/10'
                                : badgeClass
                            }`}>
                              {paymentOverviewState === 'all' ? `${fee} · PAID EVENT` : badgeText}
                            </span>
                          ) : (
                            <span className="rounded-full bg-black/[0.04] border border-black/10 px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-black/45">
                              FREE
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mt-5">
                        <p className="text-2xl font-semibold text-black leading-none">
                          {matchedCount} <span className="text-[9px] font-medium text-black/40 uppercase tracking-wider align-middle ml-1">registrations</span>
                        </p>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        {/* EVENT ANALYTICS */}

        {eventAnalytics.length >
          0 && (
          <div className="mb-8 rounded-[28px] bg-white p-6 shadow-[0_20px_80px_rgba(0,0,0,0.04)] md:p-8">

            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-black/35">
                  Event analytics
                </p>

                <h2 className="mt-2 text-xl font-semibold text-black md:text-2xl">
                  Registration breakdown
                </h2>
              </div>

              <button
                type="button"
                onClick={() =>
                  setEventFilter(
                    "all"
                  )
                }
                className="text-xs text-black hover:text-black"
              >
                View all
              </button>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {eventAnalytics.map(
                (event) => (
                  <button
                    type="button"
                    key={event.id}
                    onClick={() =>
                      setEventFilter(
                        eventFilter ===
                          event.id
                          ? "all"
                          : event.id
                      )
                    }
                    className={`rounded-[20px] p-5 text-left transition ${
                      eventFilter ===
                      event.id
                        ? "bg-black text-white"
                        : "bg-black/[0.035] hover:bg-black/[0.06]"
                    }`}
                  >
                    <p
                      className={`truncate text-[10px] uppercase tracking-[0.16em] ${
                        eventFilter ===
                        event.id
                          ? "text-white/40"
                          : "text-black/40"
                      }`}
                    >
                      {event.category ??
                        "Event"}
                    </p>

                    <div className="mt-1">
                      <p
                        className={`truncate text-sm font-semibold ${
                          eventFilter === event.id
                            ? "text-white"
                            : "text-black"
                        }`}
                      >
                        {event.name}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {event.payment_type === "paid" ? (
                          <>
                            {event.paidCount > 0 && (
                              <span className={`rounded-full px-2 py-1 text-[8px] font-bold uppercase tracking-wider border ${
                                eventFilter === event.id
                                  ? "border-green-400 bg-green-500/20 text-white"
                                  : "border-green-200 bg-green-50 text-green-700"
                              }`}>
                                {event.registration_fee != null ? `₹${event.registration_fee}` : "Amount unavailable"} · PAID
                              </span>
                            )}
                            {event.pendingCount > 0 && (
                              <span className={`rounded-full px-2 py-1 text-[8px] font-bold uppercase tracking-wider border ${
                                eventFilter === event.id
                                  ? "border-red-400 bg-red-500/20 text-white"
                                  : "border-red-200 bg-red-50 text-red-700"
                              }`}>
                                {event.registration_fee != null ? `₹${event.registration_fee}` : "Amount unavailable"} · PENDING
                              </span>
                            )}
                            {event.paidCount === 0 && event.pendingCount === 0 && (
                              <span className={`rounded-full px-2 py-1 text-[8px] font-bold uppercase tracking-wider border ${
                                eventFilter === event.id
                                  ? "border-white/20 text-white"
                                  : "border-black/10 text-black/60 bg-black/[0.04]"
                              }`}>
                                {event.registration_fee != null ? `₹${event.registration_fee}` : "Amount unavailable"} · PAID EVENT
                              </span>
                            )}
                          </>
                        ) : (
                          <span className={`rounded-full px-2 py-1 text-[8px] font-bold uppercase tracking-wider border ${
                            eventFilter === event.id
                              ? "border-white/20 text-white/70"
                              : "border-black/10 text-black/50 bg-black/[0.02]"
                          }`}>
                            FREE
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-5 flex items-end justify-between">
                      <p
  className={`text-3xl font-semibold ${
    eventFilter === event.id
      ? "text-white"
      : "text-black"
  }`}
>
  {event.count}
</p>

                      <p
                        className={`text-xs ${
                          eventFilter ===
                          event.id
                            ? "text-white/40"
                            : "text-black/35"
                        }`}
                      >
                        {event.checked}/
                        {event.count} checked
                      </p>
                    </div>
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {/* FILTERS */}

        <div className="mb-5 rounded-[24px] bg-white p-3 shadow-[0_15px_50px_rgba(0,0,0,0.035)]">
          <div className="flex flex-col gap-3 lg:flex-row">

            <div className="flex flex-1 items-center gap-3 rounded-[18px] bg-black/[0.035] px-4 py-3">
              <Search
                size={17}
                className="text-black/30"
              />

              <input
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
                  onClick={() =>
                    setSearch("")
                  }
                  className="text-black/30 hover:text-black"
                >
                  <X size={15} />
                </button>
              )}
            </div>

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
                All events
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
              value={paymentFilter}
              onChange={(e) =>
                setPaymentFilter(
                  e.target
                    .value as PaymentFilter
                )
              }
              className="rounded-[18px] border border-black/10 bg-black px-4 py-3 text-sm outline-none"
            >
              <option value="all">
                All payments
              </option>

              <option value="paid">
                Paid
              </option>

              <option value="pending">
                Payment pending
              </option>

              <option value="not_required">
                Not required
              </option>
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

            <button
              type="button"
              onClick={exportCsv}
              className="flex items-center justify-center gap-2 rounded-[18px] bg-black px-5 py-3 text-sm text-white"
            >
              <Download
                size={15}
              />

              Export CSV
            </button>
          </div>

          <div className="mt-3 px-2 text-[10px] uppercase tracking-[0.16em] text-black/30">
            Showing{" "}
            <span className="text-black/60">
              {filteredRegistrations.length}
            </span>{" "}
            event registrations
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

            <p className="mt-4 text-sm font-medium">
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

            <div className="hidden border-b border-black/10 bg-black/[0.025] px-6 py-4 lg:grid lg:grid-cols-[1.25fr_1fr_1.6fr_1fr_1fr_auto] lg:gap-5">
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

              <span />
            </div>

            <div className="divide-y divide-black/[0.07]">

              {participantGroups.map(
                (group) => {
                  const participant =
                    group[0].participant;

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
                      className="group grid w-full gap-5 px-6 py-5 text-left transition hover:bg-black/[0.018] lg:grid-cols-[1.25fr_1fr_1.6fr_1fr_1fr_auto] lg:items-center"
                    >

                      {/* PARTICIPANT */}

                      <div className="flex min-w-0 items-center gap-3">

                        {participant.photo_url ? (
                          <img
                            src={
                              participant.photo_url
                            }
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-full object-cover"
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

                          <p className="mt-1 truncate font-mono text-[9px] text-black/35">
                            {
                              participant.participant_id
                            }
                          </p>
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

                        <p className="mt-1 truncate text-[10px] text-black/35">
                          {
                            participant.college
                          }
                        </p>
                      </div>

                      {/* EVENTS */}

                      <div className="flex min-w-0 flex-wrap gap-1.5">
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
                      </div>

                      {/* STATUS */}

                      <div className="flex flex-wrap gap-1.5">
                        <span className="rounded-full border border-black/10 bg-black/[0.035] px-3 py-1.5 text-[9px] font-medium text-black/50">
                          {checked}/
                          {group.length}{" "}
                          checked
                        </span>
                      </div>

                      <div className="flex justify-end">
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

      {selectedParticipant && (
        <div className="fixed inset-0 z-50">

          <button
            type="button"
            aria-label="Close"
            onClick={() => {
              setSelectedParticipant(
                null
              );
              setSelectedParticipantEvents(
                []
              );
            }}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />

          <aside className="absolute right-0 top-0 flex h-full w-full max-w-[620px] flex-col bg-[#f5f5f5] shadow-2xl">

            {/* DRAWER HEADER */}

            <div className="flex items-center justify-between border-b border-black/10 bg-white px-6 py-5">

              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-black/30">
                  Participant
                </p>

                <p className="mt-1 font-mono text-xs text-black/45">
                  {
                    selectedParticipant.participant_id
                  }
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setSelectedParticipant(
                    null
                  );
                  setSelectedParticipantEvents(
                    []
                  );
                }}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-black hover:bg-black hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            {/* DRAWER BODY */}

            <div className="flex-1 overflow-y-auto px-6 py-6">

              {/* PROFILE */}

              <div className="rounded-[28px] bg-black p-6 text-white">

                <div className="flex items-center gap-4">

                  {selectedParticipant.photo_url ? (
                    <img
                      src={
                        selectedParticipant.photo_url
                      }
                      alt=""
                      className="h-16 w-16 rounded-2xl object-cover"
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
                </div>
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

                          <span
                            className={`rounded-full border px-3 py-1.5 text-[9px] font-medium ${
                              item.registration
                                .checked_in
                                ? "border-green-100 bg-green-50 text-green-700"
                                : "border-black/10 bg-black/[0.035] text-black/45"
                            }`}
                          >
                            {item.registration
                              .checked_in
                              ? "Checked in"
                              : "Pending"}
                          </span>
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
                              {item.members.map((member, idx) => (
                                <div
                                  key={member.id}
                                  className="rounded-[18px] border border-black/5 bg-black/[0.01] p-4 text-xs"
                                >
                                  <div className="flex items-center justify-between gap-2">
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
                              ))}
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
                                item
                              )
                            }
                            className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-3 text-xs font-medium disabled:opacity-50 ${
                              item.registration
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
                              ? "Undo check-in"
                              : "Check in"}
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
                                className={`flex h-11 w-11 items-center justify-center rounded-full border disabled:opacity-50 ${
                                  item.registration.is_archived
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

                        {item.registration
                          .checked_in_at && (
                          <p className="mt-3 text-[9px] text-black/30">
                            Checked in{" "}
                            {formatDate(
                              item.registration
                                .checked_in_at
                            )}
                          </p>
                        )}
                      </div>
                    )
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>
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
  icon,
  dark = false,
}: {
  title: string;
  value: number;
  icon: ReactNode;
  dark?: boolean;
}) {
  return (
    <div
      className={`rounded-[28px] p-7 ${
        dark
          ? "bg-black text-white"
          : "bg-white"
      }`}
    >
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-full ${
          dark
            ? "bg-white/10 text-white"
            : "bg-black/[0.04] text-black"
        }`}
      >
        {icon}
      </div>

      <p
        className={`mt-7 text-[9px] font-semibold uppercase tracking-[0.2em] ${
          dark
            ? "text-white/40"
            : "text-black/35"
        }`}
      >
        {title}
      </p>

      <p
  className={`mt-2 text-4xl font-semibold tracking-[-0.05em] ${
    dark ? "text-white" : "text-black"
  }`}
>
  {value}
</p>
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