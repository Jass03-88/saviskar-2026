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
  created_at: string;
};

type EventRecord = {
  id: string;
  name: string;
  category: string | null;
};

type Registration = {
  participant: Participant;
  event: EventRecord | null;
  registration: ParticipantEvent;
};

type StatusFilter = "all" | "checked-in" | "pending";
type PaymentFilter = "all" | "paid" | "pending" | "not_required";

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
    return "bg-amber-50 text-amber-700 border-amber-100";
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

  const [error, setError] =
    useState("");

  const [search, setSearch] =
    useState("");

  const [eventFilter, setEventFilter] =
    useState("all");

  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("all");

  const [paymentFilter, setPaymentFilter] =
    useState<PaymentFilter>("all");

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
        const authenticated = await checkAuth();

        if (!authenticated) return;

        const [
          participantsResult,
          participantEventsResult,
          eventsResult,
        ] = await Promise.all([
          supabase
            .from("participants")
            .select(
              "id, participant_id, name, college, email, phone, photo_url, created_at"
            )
            .order("created_at", {
              ascending: false,
            }),

          supabase
            .from("participant_events")
            .select(
              "id, participant_id, event_id, registration_status, payment_status, payment_amount, payment_id, team_name, checked_in, checked_in_at, created_at"
            )
            .order("created_at", {
              ascending: false,
            }),

          supabase
            .from("events")
            .select(
              "id, name, category"
            )
            .order("name", {
              ascending: true,
            }),
        ]);

        if (participantsResult.error) {
          throw participantsResult.error;
        }

        if (participantEventsResult.error) {
          throw participantEventsResult.error;
        }

        if (eventsResult.error) {
          throw eventsResult.error;
        }

        const participantRows =
          (participantsResult.data ??
            []) as Participant[];

        const participantEventRows =
          (participantEventsResult.data ??
            []) as ParticipantEvent[];

        const eventRows =
          (eventsResult.data ??
            []) as EventRecord[];

        setEvents(eventRows);

        const participantMap =
          new Map<string, Participant>();

        for (const participant of participantRows) {
          participantMap.set(
            participant.id,
            participant
          );
        }

        const eventMap =
          new Map<string, EventRecord>();

        for (const event of eventRows) {
          eventMap.set(
            event.id,
            event
          );
        }

        const combined: Registration[] =
          participantEventRows
            .map((registration) => {
              const participant =
                participantMap.get(
                  registration.participant_id
                );

              if (!participant) {
                return null;
              }

              return {
                participant,
                registration,
                event:
                  eventMap.get(
                    registration.event_id
                  ) ?? null,
              };
            })
            .filter(
              (
                item
              ): item is Registration =>
                item !== null
            );

        setRegistrations(combined);
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
    [checkAuth]
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

          const matchesEvent =
            eventFilter === "all" ||
            item.registration.event_id ===
              eventFilter;

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

          return (
            matchesSearch &&
            matchesEvent &&
            matchesStatus &&
            matchesPayment
          );
        }
      );
    }, [
      registrations,
      search,
      eventFilter,
      statusFilter,
      paymentFilter,
    ]);

  /* =======================================================
     STATS
  ======================================================= */

  const stats = useMemo(() => {
    const total =
      registrations.length;

    const checkedIn =
      registrations.filter(
        (item) =>
          item.registration
            .checked_in === true
      ).length;

    const pending =
      total - checkedIn;

    const uniqueParticipants =
      new Set(
        registrations.map(
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
     EVENT ANALYTICS
  ======================================================= */

  const eventAnalytics =
    useMemo(() => {
      return events
        .map((event) => {
          const count =
            registrations.filter(
              (item) =>
                item.registration
                  .event_id ===
                event.id
            ).length;

          const checked =
            registrations.filter(
              (item) =>
                item.registration
                  .event_id ===
                  event.id &&
                item.registration
                  .checked_in === true
            ).length;

          return {
            ...event,
            count,
            checked,
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
      registration.registration
        .checked_in !== true;

    setUpdatingId(
      registration.registration.id
    );

    const { error: updateError } =
      await supabase
        .from("participant_events")
        .update({
          checked_in: next,
          checked_in_at: next
            ? new Date().toISOString()
            : null,
        })
        .eq(
          "id",
          registration.registration.id
        );

    if (updateError) {
      console.error(
        "CHECK-IN ERROR:",
        updateError
      );

      alert(
        updateError.message
      );

      setUpdatingId(null);
      return;
    }

    setRegistrations(
      (current) =>
        current.map((item) =>
          item.registration.id ===
          registration.registration.id
            ? {
                ...item,
                registration: {
                  ...item.registration,
                  checked_in: next,
                  checked_in_at:
                    next
                      ? new Date().toISOString()
                      : null,
                },
              }
            : item
        )
    );

    setSelectedParticipantEvents(
      (current) =>
        current.map((item) =>
          item.registration.id ===
          registration.registration.id
            ? {
                ...item,
                registration: {
                  ...item.registration,
                  checked_in: next,
                  checked_in_at:
                    next
                      ? new Date().toISOString()
                      : null,
                },
              }
            : item
        )
    );

    setUpdatingId(null);
  }

  /* =======================================================
     DELETE EVENT REGISTRATION
  ======================================================= */

  async function deleteRegistration(
    registration: Registration
  ) {
    const eventName =
      registration.event?.name ??
      "this event";

    const confirmed =
      window.confirm(
        `Remove ${registration.participant.name} from ${eventName}?\n\nTheir Participant ID will remain available for other events.`
      );

    if (!confirmed) return;

    setDeletingId(
      registration.registration.id
    );

    /*
     * Remove team members first.
     */

    const { error: memberError } =
      await supabase
        .from(
          "participant_event_members"
        )
        .delete()
        .eq(
          "participant_event_id",
          registration.registration.id
        );

    if (memberError) {
      console.error(
        "MEMBER DELETE ERROR:",
        memberError
      );

      alert(
        memberError.message
      );

      setDeletingId(null);
      return;
    }

    const { error } =
      await supabase
        .from("participant_events")
        .delete()
        .eq(
          "id",
          registration.registration.id
        );

    if (error) {
      console.error(
        "REGISTRATION DELETE ERROR:",
        error
      );

      alert(error.message);

      setDeletingId(null);
      return;
    }

    setRegistrations(
      (current) =>
        current.filter(
          (item) =>
            item.registration.id !==
            registration.registration.id
        )
    );

    setSelectedParticipantEvents(
      (current) =>
        current.filter(
          (item) =>
            item.registration.id !==
            registration.registration.id
        )
    );

    setDeletingId(null);
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

            <h1 className="text-4xl font-semibold tracking-[-0.05em] md:text-6xl">
              Registrations
            </h1>

            <p className="mt-4 text-sm text-black/45">
              Manage registrations and participant entry.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">

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
                  "/register"
                )
              }
              className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm transition hover:bg-black/[0.03]"
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
              className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm transition hover:bg-black/[0.03] disabled:opacity-50"
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
              className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm transition hover:bg-black/[0.03]"
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

        {/* EVENT ANALYTICS */}

        {eventAnalytics.length >
          0 && (
          <div className="mb-8 rounded-[28px] bg-white p-6 shadow-[0_20px_80px_rgba(0,0,0,0.04)] md:p-8">

            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-black/35">
                  Event analytics
                </p>

                <h2 className="mt-2 text-xl font-semibold">
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
                className="text-xs text-black/35 hover:text-black"
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

                    <p className="mt-2 truncate text-sm font-semibold">
                      {event.name}
                    </p>

                    <div className="mt-5 flex items-end justify-between">
                      <p className="text-3xl font-semibold">
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
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-black/25"
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
              className="rounded-[18px] border border-black/10 bg-white px-4 py-3 text-sm outline-none"
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
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(
                  e.target
                    .value as StatusFilter
                )
              }
              className="rounded-[18px] border border-black/10 bg-white px-4 py-3 text-sm outline-none"
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
              className="rounded-[18px] border border-black/10 bg-white px-4 py-3 text-sm outline-none"
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

            <div className="hidden border-b border-black/10 bg-black/[0.025] px-6 py-4 lg:grid lg:grid-cols-[1.25fr_1fr_1.6fr_1fr_auto] lg:gap-5">
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
                      className="group grid w-full gap-5 px-6 py-5 text-left transition hover:bg-black/[0.018] lg:grid-cols-[1.25fr_1fr_1.6fr_1fr_auto] lg:items-center"
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
                          <p className="truncate text-sm font-semibold">
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
                className="flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white hover:bg-black hover:text-white"
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

                    <p className="mt-1 text-xs text-white/35">
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

                <h3 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
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
                        className="rounded-[24px] border border-black/10 bg-white p-5"
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

                          <button
                            type="button"
                            disabled={
                              deletingId ===
                              item.registration
                                .id
                            }
                            onClick={() =>
                              deleteRegistration(
                                item
                              )
                            }
                            className="flex h-11 w-11 items-center justify-center rounded-full border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50"
                          >
                            <Trash2
                              size={14}
                            />
                          </button>
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

      <p className="mt-2 text-4xl font-semibold tracking-[-0.05em]">
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
    <div className="flex items-center gap-3 text-xs text-white/55">
      <span className="text-white/25">
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