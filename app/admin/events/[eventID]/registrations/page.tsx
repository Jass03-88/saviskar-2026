"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  slug: string;
  category: string | null;
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

type StatusFilter = "all" | "checked-in" | "pending";

export default function AdminPage() {
  const router = useRouter();

  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [eventRecords, setEventRecords] = useState<EventRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [eventFilter, setEventFilter] = useState("all");
  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("all");

  const [selectedRegistration, setSelectedRegistration] =
    useState<Registration | null>(null);

  const [registrationMembers, setRegistrationMembers] =
    useState<RegistrationMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [checkingInId, setCheckingInId] = useState<string | null>(null);
  const [checkingOutId, setCheckingOutId] = useState<string | null>(null);

  // ---------------------------------------------------------
  // AUTH
  // ---------------------------------------------------------

  async function checkAuth() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      router.replace("/admin/login");
      return false;
    }

    return true;
  }

  // ---------------------------------------------------------
  // LOAD EVENTS
  // ---------------------------------------------------------

  async function loadEvents() {
    const { data, error } = await supabase
      .from("events")
      .select("id, name, slug, category");

    if (error) {
      console.error("EVENT LOAD ERROR:", error);
      return;
    }

    setEventRecords((data as EventRecord[]) || []);
  }

  // ---------------------------------------------------------
  // LOAD REGISTRATIONS
  // ---------------------------------------------------------

  async function loadRegistrations() {
    setLoading(true);
    setError("");

    const { data, error } = await supabase
      .from("registrations")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("ADMIN ERROR:", error);
      setError(error.message);
      setLoading(false);
      return;
    }

    setRegistrations((data as Registration[]) || []);
    setLoading(false);
  }

  // ---------------------------------------------------------
  // EVENT NAME RESOLVER
  // ---------------------------------------------------------

  function getEventName(eventId: string) {
    if (!eventId) {
      return "Unknown event";
    }

    const event = eventRecords.find(
      (item) =>
        item.id === eventId ||
        item.slug?.toLowerCase() === eventId.toLowerCase()
    );

    if (event) {
      return event.name;
    }

    // Fallback for older registrations where event_id
    // contains a slug rather than the Supabase UUID.
    return eventId
      .split("-")
      .map(
        (word) =>
          word.charAt(0).toUpperCase() +
          word.slice(1)
      )
      .join(" ");
  }

  // ---------------------------------------------------------
  // INITIALISE + REALTIME
  // ---------------------------------------------------------

  useEffect(() => {
    let registrationChannel:
      | ReturnType<typeof supabase.channel>
      | null = null;

    let eventChannel:
      | ReturnType<typeof supabase.channel>
      | null = null;

    async function initialise() {
      const authenticated = await checkAuth();

      if (!authenticated) return;

      await Promise.all([
        loadRegistrations(),
        loadEvents(),
      ]);

      // Use unique channel names for this mounted AdminPage instance.
      // This prevents Next.js development remounts / Fast Refresh from reusing
      // an already-subscribed channel and then trying to add callbacks to it.
      const channelInstanceId = `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;

      registrationChannel = supabase
        .channel(`admin-registration-changes-${channelInstanceId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "registrations",
          },
          () => {
            void loadRegistrations();
          }
        );

      registrationChannel.subscribe();

      eventChannel = supabase
        .channel(`admin-event-changes-${channelInstanceId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "events",
          },
          () => {
            void loadEvents();
          }
        );

      eventChannel.subscribe();
    }

    initialise();

    return () => {
      if (registrationChannel) {
        supabase.removeChannel(registrationChannel);
      }

      if (eventChannel) {
        supabase.removeChannel(eventChannel);
      }
    };
  }, []);

  // ---------------------------------------------------------
  // LOGOUT
  // ---------------------------------------------------------

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/admin/login");
  }

  // ---------------------------------------------------------
  // REGISTRATION MEMBERS
  // ---------------------------------------------------------

  async function loadRegistrationMembers(registrationId: string) {
    setMembersLoading(true);
    setMembersError("");
    setRegistrationMembers([]);

    const { data, error } = await supabase
      .from("registration_members")
      .select(
        "id, created_at, registration_id, name, email, phone, is_team_leader"
      )
      .eq("registration_id", registrationId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("MEMBER LOAD ERROR:", error);
      setMembersError(error.message);
      setMembersLoading(false);
      return;
    }

    setRegistrationMembers((data as RegistrationMember[]) || []);
    setMembersLoading(false);
  }

  function openRegistration(registration: Registration) {
    setSelectedRegistration(registration);
    loadRegistrationMembers(registration.id);
  }

  function closeRegistration() {
    setSelectedRegistration(null);
    setRegistrationMembers([]);
    setMembersError("");
    setMembersLoading(false);
  }

  // ---------------------------------------------------------
  // MANUAL CHECK IN
  // ---------------------------------------------------------

  async function checkInRegistration(id: string) {
    if (checkingInId) return;

    const registration = registrations.find((item) => item.id === id);

    if (!registration) {
      alert("Registration not found.");
      return;
    }

    if (registration.checked_in) {
      alert("This participant is already checked in.");
      return;
    }

    setCheckingInId(id);
    const checkedInAt = new Date().toISOString();

    const { error } = await supabase
      .from("registrations")
      .update({
        checked_in: true,
        checked_in_at: checkedInAt,
      })
      .eq("id", id)
      .eq("checked_in", false);

    if (error) {
      console.error("MANUAL CHECK IN ERROR:", error);
      alert(`Could not check in participant: ${error.message}`);
      setCheckingInId(null);
      return;
    }

    setRegistrations((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, checked_in: true, checked_in_at: checkedInAt }
          : item
      )
    );

    setSelectedRegistration((current) =>
      current?.id === id
        ? { ...current, checked_in: true, checked_in_at: checkedInAt }
        : current
    );

    setCheckingInId(null);
  }

  // ---------------------------------------------------------
  // UNDO CHECK IN
  // ---------------------------------------------------------

  async function undoCheckInRegistration(id: string) {
    if (checkingOutId) return;

    const registration = registrations.find((item) => item.id === id);

    if (!registration) {
      alert("Registration not found.");
      return;
    }

    if (!registration.checked_in) {
      alert("This participant is already pending.");
      return;
    }

    const confirmed = window.confirm(
      "Undo this participant's check-in? They will return to Pending status and can be checked in again."
    );

    if (!confirmed) return;

    setCheckingOutId(id);

    const { error } = await supabase
      .from("registrations")
      .update({
        checked_in: false,
        checked_in_at: null,
      })
      .eq("id", id)
      .eq("checked_in", true);

    if (error) {
      console.error("UNDO CHECK IN ERROR:", error);
      alert(`Could not undo check-in: ${error.message}`);
      setCheckingOutId(null);
      return;
    }

    setRegistrations((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              checked_in: false,
              checked_in_at: null,
            }
          : item
      )
    );

    setSelectedRegistration((current) =>
      current?.id === id
        ? {
            ...current,
            checked_in: false,
            checked_in_at: null,
          }
        : current
    );

    setCheckingOutId(null);
  }

  // ---------------------------------------------------------
  // DELETE REGISTRATION
  // ---------------------------------------------------------

  async function deleteRegistration(id: string) {
    const confirmed = window.confirm(
      "Are you sure you want to permanently delete this registration?"
    );

    if (!confirmed) return;

    setDeletingId(id);

    // Remove child team-member rows first so this also works when
    // registration_members.registration_id has a restrictive foreign key.
    const { error: memberDeleteError } = await supabase
      .from("registration_members")
      .delete()
      .eq("registration_id", id);

    if (memberDeleteError) {
      console.error("MEMBER DELETE ERROR:", memberDeleteError);
      alert(
        `Could not delete registration members: ${memberDeleteError.message}`
      );
      setDeletingId(null);
      return;
    }

    const { error } = await supabase
      .from("registrations")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("DELETE ERROR:", error);
      alert(`Could not delete registration: ${error.message}`);
      setDeletingId(null);
      return;
    }

    setRegistrations((current) =>
      current.filter((registration) => registration.id !== id)
    );

    if (selectedRegistration?.id === id) {
      closeRegistration();
    }

    setDeletingId(null);
  }

  // ---------------------------------------------------------
  // EVENTS USED IN REGISTRATIONS
  // ---------------------------------------------------------

  const events = useMemo(() => {
    return Array.from(
      new Set(
        registrations
          .map((registration) => registration.event_id)
          .filter(Boolean)
      )
    ).sort((a, b) =>
      getEventName(a).localeCompare(getEventName(b))
    );
  }, [registrations, eventRecords]);

  // ---------------------------------------------------------
  // FILTERED REGISTRATIONS
  // ---------------------------------------------------------

  const filteredRegistrations = useMemo(() => {
    const query = search.trim().toLowerCase();

    return registrations.filter((registration) => {
      const eventName = getEventName(
        registration.event_id
      ).toLowerCase();

      const matchesSearch =
        !query ||
        registration.name?.toLowerCase().includes(query) ||
        registration.college?.toLowerCase().includes(query) ||
        registration.email?.toLowerCase().includes(query) ||
        registration.phone?.toLowerCase().includes(query) ||
        registration.team?.toLowerCase().includes(query) ||
        registration.event_id?.toLowerCase().includes(query) ||
        eventName.includes(query) ||
        registration.id?.toLowerCase().includes(query);

      const matchesEvent =
        eventFilter === "all" ||
        registration.event_id === eventFilter;

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "checked-in" &&
          registration.checked_in === true) ||
        (statusFilter === "pending" &&
          registration.checked_in !== true);

      return (
        matchesSearch &&
        matchesEvent &&
        matchesStatus
      );
    });
  }, [
    registrations,
    search,
    eventFilter,
    statusFilter,
    eventRecords,
  ]);

  // ---------------------------------------------------------
  // EVENT ANALYTICS
  // ---------------------------------------------------------

  const eventBreakdown = useMemo(() => {
    return events.map((eventId) => {
      const count = registrations.filter(
        (registration) =>
          registration.event_id === eventId
      ).length;

      const percentage =
        registrations.length > 0
          ? Math.round(
              (count / registrations.length) * 100
            )
          : 0;

      return {
        eventId,
        eventName: getEventName(eventId),
        count,
        percentage,
      };
    });
  }, [events, registrations, eventRecords]);

  // ---------------------------------------------------------
  // STATS
  // ---------------------------------------------------------

  const totalCheckedIn = registrations.filter(
    (registration) => registration.checked_in
  ).length;

  const totalPending =
    registrations.length - totalCheckedIn;

  // ---------------------------------------------------------
  // CSV EXPORT
  // ---------------------------------------------------------

  function exportCSV() {
    const rows = [
      [
        "Registration ID",
        "Name",
        "Event",
        "Event ID",
        "College",
        "Email",
        "Phone",
        "Team",
        "Registered",
        "Status",
        "Checked In At",
      ],

      ...filteredRegistrations.map(
        (registration) => [
          registration.id,
          registration.name,
          getEventName(registration.event_id),
          registration.event_id,
          registration.college,
          registration.email,
          registration.phone,
          registration.team || "Individual",

          registration.created_at
            ? new Date(
                registration.created_at
              ).toLocaleString()
            : "",

          registration.checked_in
            ? "Checked In"
            : "Pending",

          registration.checked_in_at
            ? new Date(
                registration.checked_in_at
              ).toLocaleString()
            : "",
        ]
      ),
    ];

    const csv = rows
      .map((row) =>
        row
          .map((value) => {
            const stringValue = String(value ?? "");

            return `"${stringValue.replace(
              /"/g,
              '""'
            )}"`;
          })
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;

    link.download = `saviskar-registrations-${new Date()
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
              onClick={() =>
                router.push("/admin/scanner")
              }
              className="flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm text-white transition hover:scale-[1.02]"
            >
              <QrCode size={15} />
              Entry Scanner
            </button>

            <button
              onClick={async () => {
                await Promise.all([
                  loadRegistrations(),
                  loadEvents(),
                ]);
              }}
              disabled={loading}
              className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm transition hover:bg-black/[0.03] disabled:opacity-50"
            >
              <RefreshCw
                size={15}
                className={
                  loading ? "animate-spin" : ""
                }
              />

              Refresh
            </button>

            <button
              onClick={logout}
              className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm transition hover:bg-black/[0.03]"
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
            value={registrations.length}
            icon={<Users size={18} />}
            dark
          />

          <StatCard
            title="Checked in"
            value={totalCheckedIn}
            icon={<CheckCircle2 size={18} />}
          />

          <StatCard
            title="Pending"
            value={totalPending}
            icon={<Clock3 size={18} />}
          />

        </div>

        {/* EVENT ANALYTICS */}

        {registrations.length > 0 && (
          <div className="mb-8 rounded-[28px] bg-white p-6 shadow-[0_20px_80px_rgba(0,0,0,0.04)] md:p-8">

            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-black/35">
              Event analytics
            </p>

            <h2 className="mt-2 text-xl font-semibold">
              Registration breakdown
            </h2>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">

              {eventBreakdown.map((item) => (
                <div
                  key={item.eventId}
                  className="rounded-[20px] bg-black/[0.035] p-5"
                >

                  <p className="text-[10px] uppercase tracking-[0.16em] text-black/40">
                    {item.eventName}
                  </p>

                  <div className="mt-4 flex items-end justify-between">

                    <p className="text-3xl font-semibold">
                      {item.count}
                    </p>

                    <p className="text-xs text-black/35">
                      {item.percentage}%
                    </p>

                  </div>

                </div>
              ))}

            </div>

          </div>
        )}

        {/* FILTERS */}

        <div className="mb-5 rounded-[24px] bg-white p-3 shadow-[0_15px_50px_rgba(0,0,0,0.035)]">

          <div className="flex flex-col gap-3 lg:flex-row">

            <div className="flex flex-1 items-center gap-3 rounded-full bg-black/[0.035] px-4">

              <Search
                size={15}
                className="text-black/35"
              />

              <input
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder="Search name, event, college, email, phone, team..."
                className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-black/70"
              />

            </div>

            <select
              value={eventFilter}
              onChange={(event) =>
                setEventFilter(event.target.value)
              }
              className="rounded-full bg-black/[0.035] px-5 py-3 text-sm outline-none"
            >

              <option value="all">
                All events
              </option>

              {events.map((eventId) => (
                <option
                  key={eventId}
                  value={eventId}
                >
                  {getEventName(eventId)}
                </option>
              ))}

            </select>

            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value as StatusFilter
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

          ) : filteredRegistrations.length === 0 ? (

            <div className="flex min-h-[350px] items-center justify-center text-center">

              <div>

                <Users
                  size={28}
                  className="mx-auto mb-4 text-black/25"
                />

                <p className="font-medium">
                  No registrations found
                </p>

                <p className="mt-2 text-sm text-black/40">
                  Try changing your filters.
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
                      Event
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
                    (registration) => (

                      <tr
                        key={registration.id}
                        className="border-b border-black/[0.06] transition hover:bg-black/[0.02]"
                      >

                        <td className="px-6 py-5">

                          <p className="font-medium">
                            {registration.name}
                          </p>

                          <p className="mt-1 max-w-[170px] truncate font-mono text-[10px] text-black/35">
                            {registration.id}
                          </p>

                        </td>

                        {/* FIXED EVENT NAME */}

                        <td className="px-6 py-5">

                          <span className="rounded-full bg-black/[0.05] px-3 py-1.5 text-xs">
                            {getEventName(
                              registration.event_id
                            )}
                          </span>

                        </td>

                        <td className="px-6 py-5 text-sm text-black/60">
                          {registration.college}
                        </td>

                        <td className="px-6 py-5">

                          <p className="text-sm">
                            {registration.email}
                          </p>

                          <p className="mt-1 text-xs text-black/40">
                            {registration.phone}
                          </p>

                        </td>

                        <td className="px-6 py-5 text-sm text-black/60">
                          {registration.team ||
                            "Individual"}
                        </td>

                        <td className="px-6 py-5">

                          {registration.checked_in ? (

                            <div>

                              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700">
                                <CheckCircle2 size={13} />
                                Checked in
                              </span>

                              {registration.checked_in_at && (

                                <p className="mt-2 text-[10px] text-black/35">
                                  {new Date(
                                    registration.checked_in_at
                                  ).toLocaleString()}
                                </p>

                              )}

                            </div>

                          ) : (

                            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.045] px-3 py-1.5 text-xs text-black/55">
                              <Clock3 size={13} />
                              Pending
                            </span>

                          )}

                        </td>

                        <td className="px-6 py-5 text-sm text-black/45">

                          {registration.created_at
                            ? new Date(
                                registration.created_at
                              ).toLocaleString()
                            : "—"}

                        </td>

                        <td className="px-6 py-5">

                          <div className="flex items-center gap-2">

                            <button
                              onClick={() =>
                                openRegistration(registration)
                              }
                              className="flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs transition hover:bg-black hover:text-white"
                            >
                              <Eye size={13} />
                              View
                            </button>

                            <button
                              onClick={() =>
                                deleteRegistration(
                                  registration.id
                                )
                              }
                              disabled={
                                deletingId ===
                                registration.id
                              }
                              className="flex h-9 w-9 items-center justify-center rounded-full border border-red-100 text-red-500 transition hover:bg-red-50 disabled:opacity-40"
                            >

                              {deletingId ===
                              registration.id ? (

                                <RefreshCw
                                  size={13}
                                  className="animate-spin"
                                />

                              ) : (

                                <Trash2 size={13} />

                              )}

                            </button>

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
            Showing {filteredRegistrations.length} of{" "}
            {registrations.length} registrations
          </p>

        )}

      </div>

      {/* VIEW MODAL */}

      {selectedRegistration && (

        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          onClick={closeRegistration}
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
                  {selectedRegistration.name}
                </h2>

              </div>

              <button
                onClick={closeRegistration}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.05]"
              >
                <X size={17} />
              </button>

            </div>

            <div className="mb-7 rounded-[20px] bg-black p-5 text-white">

              <p className="text-[9px] uppercase tracking-[0.2em] text-white/40">
                Registration ID
              </p>

              <p className="mt-2 break-all font-mono text-sm">
                {selectedRegistration.id}
              </p>

            </div>

            <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">

              <Detail
                title="Full name"
                value={selectedRegistration.name}
              />

              <Detail
                title="Event"
                value={getEventName(
                  selectedRegistration.event_id
                )}
              />

              <Detail
                title="College / University"
                value={selectedRegistration.college}
              />

              <Detail
                title="Team"
                value={
                  selectedRegistration.team ||
                  "Individual"
                }
              />

              <Detail
                title="Email"
                value={selectedRegistration.email}
              />

              <Detail
                title="Phone"
                value={selectedRegistration.phone}
              />

              <Detail
                title="Registered"
                value={
                  selectedRegistration.created_at
                    ? new Date(
                        selectedRegistration.created_at
                      ).toLocaleString()
                    : "—"
                }
              />

              <Detail
                title="Entry status"
                value={
                  selectedRegistration.checked_in
                    ? "Checked in"
                    : "Pending"
                }
              />

              {selectedRegistration.checked_in_at && (

                <Detail
                  title="Checked in at"
                  value={new Date(
                    selectedRegistration.checked_in_at
                  ).toLocaleString()}
                />

              )}

            </div>

            {selectedRegistration.team && (
              <div className="mt-8 border-t border-black/[0.08] pt-8">
                <div className="mb-5 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.22em] text-black/35">
                      Team members
                    </p>
                    <h3 className="mt-2 text-xl font-semibold">
                      {selectedRegistration.team}
                    </h3>
                  </div>

                  {!membersLoading && !membersError && (
                    <span className="rounded-full bg-black/[0.05] px-3 py-1.5 text-xs text-black/50">
                      {registrationMembers.length} additional{" "}
                      {registrationMembers.length === 1 ? "member" : "members"}
                    </span>
                  )}
                </div>

                <div className="mb-4 rounded-[18px] bg-black/[0.035] p-5">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-black/35">
                    Team leader
                  </p>
                  <p className="mt-2 font-medium">
                    {selectedRegistration.name}
                  </p>
                  <div className="mt-2 flex flex-col gap-1 text-xs text-black/45 sm:flex-row sm:gap-4">
                    <span>{selectedRegistration.email || "—"}</span>
                    <span>{selectedRegistration.phone || "—"}</span>
                  </div>
                </div>

                {membersLoading ? (
                  <div className="flex items-center gap-3 rounded-[18px] border border-black/[0.07] p-5 text-sm text-black/45">
                    <RefreshCw size={15} className="animate-spin" />
                    Loading team members...
                  </div>
                ) : membersError ? (
                  <div className="rounded-[18px] bg-red-50 p-5 text-sm text-red-700">
                    Could not load team members: {membersError}
                  </div>
                ) : registrationMembers.length === 0 ? (
                  <div className="rounded-[18px] border border-black/[0.07] p-5 text-sm text-black/45">
                    No additional team members are stored for this registration.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {registrationMembers.map((member, index) => (
                      <div
                        key={member.id}
                        className="rounded-[18px] border border-black/[0.07] p-5"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-black/35">
                              {member.is_team_leader
                                ? "Team leader"
                                : `Member ${index + 2}`}
                            </p>
                            <p className="mt-2 font-medium">
                              {member.name || "—"}
                            </p>
                          </div>

                          {member.is_team_leader && (
                            <span className="rounded-full bg-black px-3 py-1 text-[10px] text-white">
                              Leader
                            </span>
                          )}
                        </div>

                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                          <Detail title="Email" value={member.email} />
                          <Detail title="Phone" value={member.phone} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                onClick={() =>
                  deleteRegistration(selectedRegistration.id)
                }
                disabled={
                  deletingId === selectedRegistration.id ||
                  checkingInId === selectedRegistration.id ||
                  checkingOutId === selectedRegistration.id
                }
                className="flex items-center justify-center gap-2 rounded-full border border-red-100 px-5 py-3 text-sm text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {deletingId === selectedRegistration.id ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                Delete registration
              </button>

              <div className="flex flex-col gap-3 sm:flex-row">
                {!selectedRegistration.checked_in ? (
                  <button
                    onClick={() =>
                      checkInRegistration(selectedRegistration.id)
                    }
                    disabled={
                      checkingInId === selectedRegistration.id ||
                      deletingId === selectedRegistration.id
                    }
                    className="flex items-center justify-center gap-2 rounded-full bg-green-600 px-6 py-3 text-sm font-medium text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {checkingInId === selectedRegistration.id ? (
                      <RefreshCw size={15} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={15} />
                    )}
                    {checkingInId === selectedRegistration.id
                      ? "Checking in..."
                      : "Check In"}
                  </button>
                ) : (
                  <button
                    onClick={() =>
                      undoCheckInRegistration(selectedRegistration.id)
                    }
                    disabled={
                      checkingOutId === selectedRegistration.id ||
                      deletingId === selectedRegistration.id
                    }
                    className="flex items-center justify-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-6 py-3 text-sm font-medium text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {checkingOutId === selectedRegistration.id ? (
                      <RefreshCw size={15} className="animate-spin" />
                    ) : (
                      <Clock3 size={15} />
                    )}
                    {checkingOutId === selectedRegistration.id
                      ? "Undoing..."
                      : "Undo Check-In"}
                  </button>
                )}

                <button
                  onClick={closeRegistration}
                  disabled={
                    checkingInId === selectedRegistration.id ||
                    checkingOutId === selectedRegistration.id ||
                    deletingId === selectedRegistration.id
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

// =========================================================
// STAT CARD
// =========================================================

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

// =========================================================
// TABLE HEAD
// =========================================================

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

// =========================================================
// DETAIL
// =========================================================

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