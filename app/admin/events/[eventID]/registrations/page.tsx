"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  RefreshCw,
  Users,
  LogOut,
  Search,
  Download,
  Eye,
  Trash2,
  X,
  QrCode,
  CheckCircle2,
  Clock3,
  ArrowLeft,
  ShieldCheck,
} from "lucide-react";

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
};

type StatusFilter = "all" | "checked-in" | "pending";
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
  if (!value) return "—";

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

export default function EventRegistrationsPage() {
  const router = useRouter();
  const params = useParams<{ eventID: string }>();
  const eventID = params.eventID;

  const [allRegistrations, setAllRegistrations] = useState<
    Registration[]
  >([]);

  const [allEvents, setAllEvents] = useState<EventRecord[]>([]);

  const [role, setRole] = useState<AdminRole | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("all");
  const [archiveFilter, setArchiveFilter] =
    useState<ArchiveFilter>("active");

  const [selectedRegistration, setSelectedRegistration] =
    useState<Registration | null>(null);

  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ---------------------------------------------------------
  // AUTH
  // ---------------------------------------------------------

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

  // ---------------------------------------------------------
  // CURRENT EVENT NAME
  // ---------------------------------------------------------

  const currentEvent = useMemo(() => {
    return (
      allEvents.find((event) => event.id === eventID) ?? null
    );
  }, [allEvents, eventID]);

  const currentEventName = currentEvent?.name ?? "Event";

  // ---------------------------------------------------------
  // LOAD DATA
  // ---------------------------------------------------------

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

        if (!authenticated) {
          return;
        }

        const response = await fetch(
          "/api/admin/registrations",
          {
            cache: "no-store",
          }
        );

        if (response.status === 401) {
          router.replace("/admin/login");
          return;
        }

        if (response.status === 403) {
          router.replace("/admin");
          return;
        }

        const payload = (await response.json()) as {
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

        setAllRegistrations(
          payload.registrations ?? []
        );

        setAllEvents(
          payload.events ?? []
        );

        if (
          payload.role === "master" ||
          payload.role === "admin"
        ) {
          setRole(payload.role);
        } else {
          setRole(null);
        }
      } catch (loadError) {
        console.error(
          "EVENT REGISTRATIONS LOAD ERROR:",
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
    [checkAuth, router]
  );

  // ---------------------------------------------------------
  // SCOPED REGISTRATIONS
  // ---------------------------------------------------------

  const registrations = useMemo(() => {
    if (!eventID) return allRegistrations;

    return allRegistrations.filter(
      (item) =>
        item.registration.event_id === eventID
    );
  }, [allRegistrations, eventID]);

  // ---------------------------------------------------------
  // INITIALISE + REALTIME
  // ---------------------------------------------------------

  useEffect(() => {
    void loadData();

    const channelInstanceId = `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;

    const participantChannel = supabase
      .channel(
        `event-reg-participants-${channelInstanceId}`
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

    const participantEventChannel = supabase
      .channel(
        `event-reg-participant-events-${channelInstanceId}`
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

    const eventChannel = supabase
      .channel(
        `event-reg-events-${channelInstanceId}`
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

  // ---------------------------------------------------------
  // LOGOUT
  // ---------------------------------------------------------

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/admin/login");
  }

  // ---------------------------------------------------------
  // TOGGLE CHECK IN
  // ---------------------------------------------------------

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
            "Content-Type":
              "application/json",
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

      setAllRegistrations(
        (current) =>
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

      if (
        selectedRegistration?.registration.id ===
        registration.registration.id
      ) {
        setSelectedRegistration(
          (current) =>
            current
              ? {
                  ...current,
                  registration: {
                    ...current.registration,
                    ...payload.registration,
                  },
                }
              : current
        );
      }
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

  // ---------------------------------------------------------
  // ARCHIVE REGISTRATION
  // ---------------------------------------------------------

  async function archiveRegistration(
    registration: Registration
  ) {
    const confirmed = window.confirm(
      `Archive ${registration.participant.name}'s registration for ${currentEventName}?\n\nThe registration will be removed from the active view, but all payment history and team records will be retained.`
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
        {
          method: "DELETE",
        }
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

      setAllRegistrations(
        (current) =>
          current.map(
            (item) =>
              item.registration.id ===
              registration.registration.id
                ? { ...item, registration: { ...item.registration, is_archived: true } }
                : item
          )
      );

      if (
        selectedRegistration?.registration.id ===
        registration.registration.id
      ) {
        setSelectedRegistration(
          (current) =>
            current
              ? { ...current, registration: { ...current.registration, is_archived: true } }
              : current
        );
      }
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

  // ---------------------------------------------------------
  // RESTORE REGISTRATION
  // ---------------------------------------------------------

  async function restoreRegistration(
    registration: Registration
  ) {
    const confirmed = window.confirm(
      `Restore ${registration.participant.name}'s registration for ${currentEventName}?`
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

      setAllRegistrations(
        (current) =>
          current.map(
            (item) =>
              item.registration.id ===
              registration.registration.id
                ? { ...item, registration: { ...item.registration, is_archived: false } }
                : item
          )
      );

      if (
        selectedRegistration?.registration.id ===
        registration.registration.id
      ) {
        setSelectedRegistration(
          (current) =>
            current
              ? { ...current, registration: { ...current.registration, is_archived: false } }
              : current
        );
      }
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

  // ---------------------------------------------------------
  // REGISTRATION DETAIL
  // ---------------------------------------------------------

  function openRegistration(
    registration: Registration
  ) {
    setSelectedRegistration(
      registration
    );
  }

  function closeRegistration() {
    setSelectedRegistration(null);
  }

  // ---------------------------------------------------------
  // FILTERED REGISTRATIONS
  // ---------------------------------------------------------

  const filteredRegistrations =
    useMemo(() => {
      const query =
        search.trim().toLowerCase();

      return registrations.filter(
        (item) => {
          const participant =
            item.participant;

          const matchesSearch =
            !query ||
            participant.name
              ?.toLowerCase()
              .includes(query) ||
            participant.college
              ?.toLowerCase()
              .includes(query) ||
            participant.email
              ?.toLowerCase()
              .includes(query) ||
            participant.phone
              ?.toLowerCase()
              .includes(query) ||
            participant.participant_id
              ?.toLowerCase()
              .includes(query) ||
            item.registration.team_name
              ?.toLowerCase()
              .includes(query) ||
            item.registration.id
              ?.toLowerCase()
              .includes(query);

          const matchesStatus =
            statusFilter === "all" ||
            (statusFilter ===
              "checked-in" &&
              item.registration
                .checked_in === true) ||
            (statusFilter === "pending" &&
              item.registration
                .checked_in !== true);

          const matchesArchive =
            archiveFilter === "all" ||
            (archiveFilter === "archived" &&
              item.registration.is_archived === true) ||
            (archiveFilter === "active" &&
              item.registration.is_archived !== true);

          return (
            matchesSearch &&
            matchesStatus &&
            matchesArchive
          );
        }
      );
    }, [
      registrations,
      search,
      statusFilter,
      archiveFilter,
    ]);

  // ---------------------------------------------------------
  // STATS
  // ---------------------------------------------------------

  // Only count active registrations for the dashboard stats
  const activeRegistrations = registrations.filter(
    (item) => item.registration.is_archived !== true
  );

  const totalCheckedIn = activeRegistrations.filter(
    (item) => item.registration.checked_in === true
  ).length;

  const totalPending =
    activeRegistrations.length - totalCheckedIn;

  // ---------------------------------------------------------
  // CSV EXPORT
  // ---------------------------------------------------------

  function exportCSV() {
    const rows = [
      [
        "Participant ID",
        "Name",
        "Event",
        "College",
        "Email",
        "Phone",
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
          escapeCsv(
            item.participant
              .participant_id
          ),
          escapeCsv(
            item.participant.name
          ),
          escapeCsv(
            item.event?.name ??
              item.registration
                .event_id
          ),
          escapeCsv(
            item.participant.college ??
              ""
          ),
          escapeCsv(
            item.participant.email
          ),
          escapeCsv(
            item.participant.phone ??
              ""
          ),
          escapeCsv(
            item.registration
              .team_name ??
              "Individual"
          ),
          escapeCsv(
            item.registration
              .registration_status ??
              ""
          ),
          escapeCsv(
            item.registration
              .payment_status ??
              ""
          ),
          escapeCsv(
            item.registration
              .payment_amount ?? 0
          ),
          escapeCsv(
            item.registration
              .payment_id ?? ""
          ),
          escapeCsv(
            item.registration
              .checked_in
              ? "Yes"
              : "No"
          ),
          escapeCsv(
            item.registration
              .checked_in_at
              ? formatDate(
                  item.registration
                    .checked_in_at
                )
              : ""
          ),
          escapeCsv(
            formatDate(
              item.registration
                .created_at
            )
          ),
        ]
      ),
    ];

    const csv = rows
      .map((row) => row.join(","))
      .join("\n");

    const blob = new Blob(
      [csv],
      {
        type:
          "text/csv;charset=utf-8;",
      }
    );

    const url =
      URL.createObjectURL(blob);

    const link =
      document.createElement("a");

    link.href = url;

    link.download = `saviskar-${currentEventName
      .toLowerCase()
      .replace(/\s+/g, "-")}-registrations-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;

    document.body.appendChild(link);

    link.click();

    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }

  // ---------------------------------------------------------
  // PAGE
  // ---------------------------------------------------------

  return (
    <main className="min-h-screen bg-[#f5f5f5] px-5 py-10 md:px-10 lg:px-16">
      <div className="mx-auto max-w-[1500px]">

        {/* HEADER */}

        <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">

          <div>
            <button
              onClick={() =>
                router.push(
                  "/admin/events"
                )
              }
              className="mb-4 flex items-center gap-2 text-sm text-black/45 transition hover:text-black"
            >
              <ArrowLeft size={15} />
              Back to events
            </button>

            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-black/40">
              Saviskar 2026
            </p>

            <h1 className="text-4xl font-semibold tracking-[-0.05em] md:text-6xl text-black">
              {currentEventName}
            </h1>

            <p className="mt-4 text-sm text-black/45">
              Manage registrations and
              participant entry for this
              event.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">

            {/* MASTER ADMIN ONLY */}

            {role === "master" && (
              <button
                onClick={() =>
                  router.push(
                    "/admin/admins"
                  )
                }
                className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm text-black transition hover:bg-black hover:text-white"
              >
                <ShieldCheck
                  size={15}
                />
                Manage Admins
              </button>
            )}

            <button
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
              onClick={() =>
                void loadData(true)
              }
              disabled={
                loading ||
                refreshing
              }
              className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm transition hover:bg-black/[0.03] disabled:opacity-50 text-black"
            >
              <RefreshCw
                size={15}
                className={
                  loading ||
                  refreshing
                    ? "animate-spin"
                    : ""
                }
              />

              Refresh
            </button>

            <button
              onClick={logout}
              className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm transition hover:bg-black/[0.03] text-black"
            >
              <LogOut size={15} />
              Logout
            </button>

          </div>
        </div>

        {/* STATS */}

        <div className="mb-8 grid gap-4 md:grid-cols-3">

          <StatCard
            title="Total registrations"
            value={
              registrations.length
            }
            icon={
              <Users size={18} />
            }
            dark
          />

          <StatCard
            title="Checked in"
            value={totalCheckedIn}
            icon={
              <CheckCircle2
                size={18}
              />
            }
          />

          <StatCard
            title="Pending"
            value={totalPending}
            icon={
              <Clock3 size={18} />
            }
          />

        </div>

        {/* FILTERS */}

        <div className="mb-5 rounded-[24px] bg-white p-3 shadow-[0_15px_50px_rgba(0,0,0,0.035)] text-sm text-black/70">

          <div className="flex flex-col gap-3 lg:flex-row">

            <div className="flex flex-1 items-center gap-3 rounded-full bg-black/[0.035] px-4">

              <Search
                size={15}
                className="text-black/35"
              />

              <input
                value={search}
                onChange={(event) =>
                  setSearch(
                    event.target.value
                  )
                }
                placeholder="Search name, college, email, phone, team, participant ID..."
                className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-black/70"
              />

            </div>

            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target
                    .value as StatusFilter
                )
              }
              className="rounded-full bg-black/[0.035] px-5 py-3 text-sm outline-none"
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

            {role === "master" && (
              <select
                value={archiveFilter}
                onChange={(event) =>
                  setArchiveFilter(
                    event.target.value as ArchiveFilter
                  )
                }
                className="rounded-full bg-black/[0.035] px-5 py-3 text-sm outline-none"
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
              onClick={exportCSV}
              className="flex items-center justify-center gap-2 rounded-full bg-black px-5 py-3 text-sm text-white"
            >
              <Download size={15} />
              Export CSV
            </button>

          </div>

        </div>

        {/* ERROR */}

        {error && (
          <div className="mb-6 rounded-2xl bg-red-50 p-5 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* TABLE */}

        <div className="overflow-hidden rounded-[28px] bg-white shadow-[0_20px_80px_rgba(0,0,0,0.05)]">

          {loading ? (

            <div className="flex min-h-[350px] items-center justify-center">

              <div className="text-center">

                <RefreshCw
                  size={24}
                  className="mx-auto mb-4 animate-spin"
                />

                <p className="text-sm text-black/40">
                  Loading registrations...
                </p>

              </div>

            </div>

          ) : filteredRegistrations.length ===
            0 ? (

            <div className="flex min-h-[350px] items-center justify-center text-center">

              <div>

                <Users
                  size={28}
                  className="mx-auto mb-4 text-black/25"
                />

                <p className="font-medium text-black">
                  No registrations found
                </p>

                <p className="mt-2 text-sm text-black/40">
                  {registrations.length ===
                  0
                    ? "No one has registered for this event yet."
                    : "Try changing your filters."}
                </p>

              </div>

            </div>

          ) : (

            <div className="overflow-x-auto">

              <table className="w-full min-w-[1250px] text-left">

                <thead>
                  <tr className="border-b border-black/10">

                    <TableHead>
                      Participant
                    </TableHead>

                    <TableHead>
                      College
                    </TableHead>

                    <TableHead>
                      Contact
                    </TableHead>

                    <TableHead>
                      Team
                    </TableHead>

                    <TableHead>
                      Payment
                    </TableHead>

                    <TableHead>
                      Status
                    </TableHead>

                    <TableHead>
                      Registered
                    </TableHead>

                    <TableHead>
                      Actions
                    </TableHead>

                  </tr>
                </thead>

                <tbody>

                  {filteredRegistrations.map(
                    (item) => (

                      <tr
                        key={
                          item.registration.id
                        }
                        className="border-b border-black/[0.06] transition hover:bg-black/[0.02]"
                      >

                        <td className="px-6 py-5">

                          <p className="font-medium">
                            {
                              item
                                .participant
                                .name
                            }
                          </p>

                          <p className="mt-1 max-w-[170px] truncate font-mono text-[10px] text-black/35">
                            {
                              item
                                .participant
                                .participant_id
                            }
                          </p>

                        </td>

                        <td className="px-6 py-5 text-sm text-black/60">
                          {
                            item.participant
                              .college ||
                            "—"
                          }
                        </td>

                        <td className="px-6 py-5">

                          <p className="text-sm">
                            {
                              item
                                .participant
                                .email
                            }
                          </p>

                          <p className="mt-1 text-xs text-black/40">
                            {
                              item
                                .participant
                                .phone ||
                              "—"
                            }
                          </p>

                        </td>

                        <td className="px-6 py-5 text-sm text-black/60">
                          {
                            item.registration
                              .team_name ||
                            "Individual"
                          }
                        </td>

                        <td className="px-6 py-5">

                          <span
                            className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium ${paymentClass(
                              item
                                .registration
                                .payment_status
                            )}`}
                          >
                            {paymentLabel(
                              item
                                .registration
                                .payment_status
                            )}
                          </span>

                        </td>

                        <td className="px-6 py-5">

                          {item.registration
                            .checked_in ? (

                            <div>

                              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700">
                                <CheckCircle2
                                  size={13}
                                />
                                Checked in
                              </span>

                              {item
                                .registration
                                .checked_in_at && (

                                <p className="mt-2 text-[10px] text-black/35">
                                  {formatDate(
                                    item
                                      .registration
                                      .checked_in_at
                                  )}
                                </p>

                              )}

                            </div>

                          ) : (

                            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.045] px-3 py-1.5 text-xs text-black/55">
                              <Clock3
                                size={13}
                              />
                              Pending
                            </span>

                          )}

                        </td>

                        <td className="px-6 py-5 text-sm text-black/45">

                          {formatDate(
                            item.registration
                              .created_at
                          )}

                        </td>

                        <td className="px-6 py-5">

                          <div className="flex items-center gap-2">

                            <button
                              onClick={() =>
                                openRegistration(
                                  item
                                )
                              }
                              className="flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs transition hover:bg-black hover:text-white"
                            >
                              <Eye
                                size={13}
                              />
                              View
                            </button>

                            {role === "master" && (
                              <button
                                onClick={() =>
                                  item.registration.is_archived
                                    ? restoreRegistration(item)
                                    : archiveRegistration(item)
                                }
                                disabled={
                                  deletingId === item.registration.id ||
                                  updatingId === item.registration.id
                                }
                                className={`flex h-9 w-9 items-center justify-center rounded-full border transition disabled:opacity-40 ${
                                  item.registration.is_archived
                                    ? "border-green-200 text-green-600 hover:bg-green-50"
                                    : "border-red-100 text-red-500 hover:bg-red-50"
                                }`}
                                title={item.registration.is_archived ? "Restore Registration" : "Archive Registration"}
                              >
                                {(deletingId === item.registration.id || updatingId === item.registration.id) ? (
                                  <RefreshCw size={13} className="animate-spin" />
                                ) : item.registration.is_archived ? (
                                  <RefreshCw size={13} />
                                ) : (
                                  <Trash2 size={13} />
                                )}
                              </button>
                            )}

                          </div>

                        </td>

                      </tr>

                    )
                  )}

                </tbody>

              </table>

            </div>

          )}

        </div>

        {!loading && (

          <p className="mt-4 text-right text-xs text-black/35">
            Showing{" "}
            {
              filteredRegistrations.length
            }{" "}
            of{" "}
            {registrations.length}{" "}
            registrations
          </p>

        )}

      </div>

      {/* VIEW MODAL */}

      {selectedRegistration && (

        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          onClick={
            closeRegistration
          }
        >

          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[30px] bg-white p-7 md:p-9"
            onClick={(event) =>
              event.stopPropagation()
            }
          >

            <div className="mb-7 flex items-start justify-between">

              <div>

                <p className="text-[10px] uppercase tracking-[0.22em] text-black/35">
                  Participant details
                </p>

                <h2 className="mt-2 text-3xl font-semibold">
                  {
                    selectedRegistration
                      .participant.name
                  }
                </h2>

              </div>

              <button
                onClick={
                  closeRegistration
                }
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.05]"
              >
                <X size={17} />
              </button>

            </div>

            <div className="mb-7 rounded-[20px] bg-black p-5 text-white">

              <p className="text-[9px] uppercase tracking-[0.2em] text-white/40">
                Participant ID
              </p>

              <p className="mt-2 break-all font-mono text-sm">
                {
                  selectedRegistration
                    .participant
                    .participant_id
                }
              </p>

            </div>

            <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">

              <Detail
                title="Full name"
                value={
                  selectedRegistration
                    .participant.name
                }
              />

              <Detail
                title="Event"
                value={
                  selectedRegistration
                    .event?.name ??
                  selectedRegistration
                    .registration
                    .event_id
                }
              />

              <Detail
                title="College / University"
                value={
                  selectedRegistration
                    .participant
                    .college ?? ""
                }
              />

              <Detail
                title="Team"
                value={
                  selectedRegistration
                    .registration
                    .team_name ||
                  "Individual"
                }
              />

              <Detail
                title="Email"
                value={
                  selectedRegistration
                    .participant.email
                }
              />

              <Detail
                title="Phone"
                value={
                  selectedRegistration
                    .participant
                    .phone ?? ""
                }
              />

              <Detail
                title="Payment"
                value={`${paymentLabel(
                  selectedRegistration
                    .registration
                    .payment_status
                )} — ${formatAmount(
                  selectedRegistration
                    .registration
                    .payment_amount
                )}`}
              />

              <Detail
                title="Registered"
                value={formatDate(
                  selectedRegistration
                    .registration
                    .created_at
                )}
              />

              <Detail
                title="Entry status"
                value={
                  selectedRegistration
                    .registration
                    .checked_in
                    ? "Checked in"
                    : "Pending"
                }
              />

              {selectedRegistration
                .registration
                .checked_in_at && (

                <Detail
                  title="Checked in at"
                  value={formatDate(
                    selectedRegistration
                      .registration
                      .checked_in_at
                  )}
                />

              )}

            </div>

            {selectedRegistration
              .registration
              .team_name &&
              selectedRegistration
                .members &&
              selectedRegistration
                .members.length > 0 && (

              <div className="mt-8 border-t border-black/[0.08] pt-8">

                <div className="mb-5 flex items-end justify-between gap-4">

                  <div>

                    <p className="text-[10px] uppercase tracking-[0.22em] text-black/35">
                      Team members
                    </p>

                    <h3 className="mt-2 text-xl font-semibold">
                      {
                        selectedRegistration
                          .registration
                          .team_name
                      }
                    </h3>

                  </div>

                  <span className="rounded-full bg-black/[0.05] px-3 py-1.5 text-xs text-black/50">
                    {
                      selectedRegistration
                        .members.length
                    }{" "}
                    {
                      selectedRegistration
                        .members.length ===
                      1
                        ? "member"
                        : "members"
                    }
                  </span>

                </div>

                <div className="space-y-3">

                  {selectedRegistration
                    .members.map(
                      (
                        member,
                        index
                      ) => (

                        <div
                          key={member.id}
                          className="rounded-[18px] border border-black/[0.07] p-5"
                        >

                          <div className="flex items-start justify-between gap-4">

                            <div>

                              <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-black/35">
                                {member.is_team_leader
                                  ? "Team leader"
                                  : `Member ${
                                      index +
                                      1
                                    }`}
                              </p>

                              <div className="mt-2 flex items-center gap-2">

                                <p className="font-medium">
                                  {member.name ||
                                    "—"}
                                </p>

                                {member
                                  .participants
                                  ?.participant_id && (

                                  <span className="rounded-[4px] bg-black/[0.05] px-1.5 py-0.5 font-mono text-[10px] font-bold text-black/45">
                                    {
                                      member
                                        .participants
                                        .participant_id
                                    }
                                  </span>

                                )}

                              </div>

                            </div>

                            {member.is_team_leader && (

                              <span className="rounded-full bg-black px-3 py-1 text-[10px] text-white">
                                Leader
                              </span>

                            )}

                          </div>

                          <div className="mt-4 grid gap-4 sm:grid-cols-2">

                            <Detail
                              title="Email"
                              value={
                                member.email ??
                                ""
                              }
                            />

                            <Detail
                              title="Phone"
                              value={
                                member.phone ??
                                ""
                              }
                            />

                            <Detail
                              title="College / University"
                              value={
                                member
                                  .participants
                                  ?.college ??
                                "—"
                              }
                            />

                          </div>

                        </div>

                      )
                    )}

                </div>

              </div>

            )}

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

              <div>
                {role === "master" && (
                  <button
                    onClick={() =>
                      selectedRegistration.registration.is_archived
                        ? restoreRegistration(selectedRegistration)
                        : archiveRegistration(selectedRegistration)
                    }
                    disabled={
                      deletingId ===
                        selectedRegistration.registration.id ||
                      updatingId ===
                        selectedRegistration.registration.id
                    }
                    className={`flex items-center justify-center gap-2 rounded-full border px-5 py-3 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      selectedRegistration.registration.is_archived
                        ? "border-green-200 text-green-600 hover:bg-green-50"
                        : "border-red-100 text-red-600 hover:bg-red-50"
                    }`}
                  >
                    {(deletingId === selectedRegistration.registration.id || updatingId === selectedRegistration.registration.id) ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : selectedRegistration.registration.is_archived ? (
                      <RefreshCw size={14} />
                    ) : (
                      <Trash2 size={14} />
                    )}

                    {selectedRegistration.registration.is_archived
                      ? "Restore registration"
                      : "Archive registration"}
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">

                {!selectedRegistration
                  .registration
                  .checked_in ? (

                  <button
                    onClick={() =>
                      toggleCheckIn(
                        selectedRegistration
                      )
                    }
                    disabled={
                      updatingId ===
                        selectedRegistration
                          .registration
                          .id ||
                      deletingId ===
                        selectedRegistration
                          .registration
                          .id
                    }
                    className="flex items-center justify-center gap-2 rounded-full bg-green-600 px-6 py-3 text-sm font-medium text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >

                    {updatingId ===
                    selectedRegistration
                      .registration.id ? (

                      <RefreshCw
                        size={15}
                        className="animate-spin"
                      />

                    ) : (

                      <CheckCircle2
                        size={15}
                      />

                    )}

                    {updatingId ===
                    selectedRegistration
                      .registration.id
                      ? "Checking in..."
                      : "Check In"}

                  </button>

                ) : (

                  <button
                    onClick={() =>
                      toggleCheckIn(
                        selectedRegistration
                      )
                    }
                    disabled={
                      updatingId ===
                        selectedRegistration
                          .registration
                          .id ||
                      deletingId ===
                        selectedRegistration
                          .registration
                          .id
                    }
                    className="flex items-center justify-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-6 py-3 text-sm font-medium text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >

                    {updatingId ===
                    selectedRegistration
                      .registration.id ? (

                      <RefreshCw
                        size={15}
                        className="animate-spin"
                      />

                    ) : (

                      <Clock3
                        size={15}
                      />

                    )}

                    {updatingId ===
                    selectedRegistration
                      .registration.id
                      ? "Undoing..."
                      : "Undo Check-In"}

                  </button>

                )}

                <button
                  onClick={
                    closeRegistration
                  }
                  disabled={
                    updatingId ===
                      selectedRegistration
                        .registration.id ||
                    deletingId ===
                      selectedRegistration
                        .registration.id
                  }
                  className="rounded-full bg-black px-7 py-3 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Close
                </button>

              </div>

            </div>

          </div>

        </div>

      )}

    </main>
  );
}

/* =========================================================
   STAT CARD
========================================================= */

function StatCard({
  title,
  value,
  icon,
  dark = false,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <div
      className={`rounded-[24px] p-7 ${
        dark
          ? "bg-black text-white"
          : "bg-white text-black shadow-[0_15px_50px_rgba(0,0,0,0.035)]"
      }`}
    >
      <div
        className={`mb-8 flex h-10 w-10 items-center justify-center rounded-full ${
          dark
            ? "bg-white/10"
            : "bg-black/[0.05]"
        }`}
      >
        {icon}
      </div>

      <p
        className={`text-[10px] uppercase tracking-[0.2em] ${
          dark
            ? "text-white/40"
            : "text-black/40"
        }`}
      >
        {title}
      </p>

      <p className="mt-2 text-4xl font-semibold">
        {value}
      </p>
    </div>
  );
}

/* =========================================================
   TABLE HEAD
========================================================= */

function TableHead({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <th className="px-6 py-5 text-[10px] font-medium uppercase tracking-[0.18em] text-black/40">
      {children}
    </th>
  );
}

/* =========================================================
   DETAIL
========================================================= */

function Detail({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="border-b border-black/[0.07] pb-4">
      <p className="text-[9px] uppercase tracking-[0.2em] text-black/35">
        {title}
      </p>

      <p className="mt-2 break-words text-sm">
        {value || "—"}
      </p>
    </div>
  );
}