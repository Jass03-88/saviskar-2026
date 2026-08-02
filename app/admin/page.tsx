"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getAuthorizedAdmin, signOutUnauthorizedUser } from "@/lib/admin";
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
  Plus,
  UserPlus,
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
  registration_type: string;
  min_team_size: number | null;
  max_team_size: number | null;
  registration_open: boolean;
  active: boolean;
};

type ManualTeamMember = {
  name: string;
  email: string;
  phone: string;
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
  const [updatingCheckInId, setUpdatingCheckInId] = useState<string | null>(null);

  const [showAddRegistration, setShowAddRegistration] = useState(false);
  const [addingRegistration, setAddingRegistration] = useState(false);
  const [newRegistration, setNewRegistration] = useState({
    event_id: "",
    name: "",
    college: "",
    email: "",
    phone: "",
    team: "",
  });
  const [manualTeamMembers, setManualTeamMembers] = useState<ManualTeamMember[]>([]);

  // ---------------------------------------------------------
  // AUTH
  // ---------------------------------------------------------

  async function checkAuth() {
    const result = await getAuthorizedAdmin();

    if (!result.authorized) {
      if (result.session) {
        await signOutUnauthorizedUser();
      }

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
      .select("id, name, slug, category, registration_type, min_team_size, max_team_size, registration_open, active")
      .order("name", { ascending: true });

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
  // CHECK IN / UNDO CHECK IN
  // ---------------------------------------------------------

  async function toggleCheckIn(registration: Registration) {
    const nextCheckedIn = !registration.checked_in;

    setUpdatingCheckInId(registration.id);

    const { data, error } = await supabase
      .from("registrations")
      .update({
        checked_in: nextCheckedIn,
        checked_in_at: nextCheckedIn ? new Date().toISOString() : null,
      })
      .eq("id", registration.id)
      .select("*")
      .single();

    if (error) {
      console.error("CHECK-IN UPDATE ERROR:", error);
      alert(`Could not update entry status: ${error.message}`);
      setUpdatingCheckInId(null);
      return;
    }

    const updatedRegistration = data as Registration;

    setRegistrations((current) =>
      current.map((item) =>
        item.id === updatedRegistration.id ? updatedRegistration : item
      )
    );

    setSelectedRegistration((current) =>
      current?.id === updatedRegistration.id ? updatedRegistration : current
    );

    setUpdatingCheckInId(null);
  }

  // ---------------------------------------------------------
  // MANUAL REGISTRATION
  // ---------------------------------------------------------

  const selectedManualEvent = eventRecords.find(
    (item) => item.id === newRegistration.event_id
  );

  const isManualTeamEvent =
    selectedManualEvent?.registration_type?.toLowerCase().trim() === "team";

  const manualMinTeamSize = selectedManualEvent?.min_team_size ?? 1;
  const manualMaxTeamSize = selectedManualEvent?.max_team_size ?? manualMinTeamSize;
  const manualMinimumExtraMembers = Math.max(0, manualMinTeamSize - 1);
  const manualMaximumExtraMembers = Math.max(0, manualMaxTeamSize - 1);

  function resetManualRegistration() {
    setNewRegistration({
      event_id: "",
      name: "",
      college: "",
      email: "",
      phone: "",
      team: "",
    });
    setManualTeamMembers([]);
  }

  function selectManualEvent(eventId: string) {
    const selected = eventRecords.find((item) => item.id === eventId);
    setNewRegistration((current) => ({
      ...current,
      event_id: eventId,
      team: "",
    }));

    if (selected?.registration_type?.toLowerCase().trim() === "team") {
      const requiredExtra = Math.max(0, (selected.min_team_size ?? 1) - 1);
      setManualTeamMembers(
        Array.from({ length: requiredExtra }, () => ({
          name: "",
          email: "",
          phone: "",
        }))
      );
    } else {
      setManualTeamMembers([]);
    }
  }

  function addManualTeamMember() {
    if (manualTeamMembers.length >= manualMaximumExtraMembers) return;
    setManualTeamMembers((current) => [
      ...current,
      { name: "", email: "", phone: "" },
    ]);
  }

  function removeManualTeamMember(index: number) {
    if (manualTeamMembers.length <= manualMinimumExtraMembers) return;
    setManualTeamMembers((current) => current.filter((_, i) => i !== index));
  }

  function updateManualTeamMember(
    index: number,
    field: keyof ManualTeamMember,
    value: string
  ) {
    setManualTeamMembers((current) =>
      current.map((member, i) =>
        i === index ? { ...member, [field]: value } : member
      )
    );
  }

  async function createManualRegistration(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (
      !newRegistration.event_id ||
      !newRegistration.name.trim() ||
      !newRegistration.college.trim() ||
      !newRegistration.email.trim() ||
      !newRegistration.phone.trim()
    ) {
      alert("Please fill in all required fields.");
      return;
    }

    if (!selectedManualEvent) {
      alert("Please select a valid event.");
      return;
    }

    if (!selectedManualEvent.registration_open) {
      alert("Registration for this event is currently closed.");
      return;
    }

    if (isManualTeamEvent) {
      const totalParticipants = manualTeamMembers.length + 1;

      if (!newRegistration.team.trim()) {
        alert("Please enter the team name.");
        return;
      }

      if (totalParticipants < manualMinTeamSize || totalParticipants > manualMaxTeamSize) {
        alert(`This event requires ${manualMinTeamSize}${manualMaxTeamSize !== manualMinTeamSize ? `–${manualMaxTeamSize}` : ""} total team members including the leader.`);
        return;
      }

      const incompleteMember = manualTeamMembers.findIndex(
        (member) =>
          !member.name.trim() || !member.email.trim() || !member.phone.trim()
      );

      if (incompleteMember !== -1) {
        alert(`Please complete all details for Team Member ${incompleteMember + 2}.`);
        return;
      }
    }

    setAddingRegistration(true);

    try {
      const { data, error } = await supabase
        .from("registrations")
        .insert({
          event_id: newRegistration.event_id,
          name: newRegistration.name.trim(),
          college: newRegistration.college.trim(),
          email: newRegistration.email.trim(),
          phone: newRegistration.phone.trim(),
          team: isManualTeamEvent ? newRegistration.team.trim() : null,
          checked_in: false,
          checked_in_at: null,
        })
        .select("*")
        .single();

      if (error) throw error;

      const createdRegistration = data as Registration;

      if (isManualTeamEvent && manualTeamMembers.length > 0) {
        const { error: membersError } = await supabase
          .from("registration_members")
          .insert(
            manualTeamMembers.map((member) => ({
              registration_id: createdRegistration.id,
              name: member.name.trim(),
              email: member.email.trim(),
              phone: member.phone.trim(),
            }))
          );

        if (membersError) {
          await supabase
            .from("registrations")
            .delete()
            .eq("id", createdRegistration.id);
          throw membersError;
        }
      }

      setRegistrations((current) => [createdRegistration, ...current]);
      resetManualRegistration();
      setShowAddRegistration(false);
    } catch (error) {
      console.error("MANUAL REGISTRATION ERROR:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      alert(`Could not create registration: ${message}`);
    } finally {
      setAddingRegistration(false);
    }
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
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-black/80">
              Saviskar 2026
            </p>

            <h1 className="text-4xl font-semibold tracking-[-0.05em] text-black md:text-6xl">
              Registrations
            </h1>

            <p className="mt-4 text-sm text-black/80">
              Manage registrations and participant entry.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">

            <button
              onClick={() => setShowAddRegistration(true)}
              className="flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm text-white transition hover:scale-[1.02]"
            >
              <Plus size={15} />
              Add Registration
            </button>

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
              className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-black/[0.03] disabled:opacity-50"
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
              className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-black/[0.03]"
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

            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-black/70">
              Event analytics
            </p>

            <h2 className="mt-2 text-xl font-semibold text-black">
              Registration breakdown
            </h2>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">

              {eventBreakdown.map((item) => (
                <div
                  key={item.eventId}
                  className="rounded-[20px] bg-black/[0.035] p-5"
                >

                  <p className="text-[10px] uppercase tracking-[0.16em] text-black/80">
                    {item.eventName}
                  </p>

                  <div className="mt-4 flex items-end justify-between">

                    <p className="text-3xl font-bold text-black">
  {item.count}
</p>

                    <p className="text-xs text-black/70">
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
                className="text-black/70"
              />

              <input
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder="Search name, event, college, email, phone, team..."
                className="w-full bg-transparent py-3 text-sm text-black outline-none placeholder:text-black/70"
              />

            </div>

            <select
              value={eventFilter}
              onChange={(event) =>
                setEventFilter(event.target.value)
              }
              className="rounded-full bg-black/[0.035] px-5 py-3 text-sm text-black outline-none"
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
              className="rounded-full bg-black/[0.035] px-5 py-3 text-sm text-black outline-none"
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

                <p className="text-sm text-black/80">
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

                <p className="mt-2 text-sm text-black/80">
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

                          <p className="font-medium text-black">
                            {registration.name}
                          </p>

                          <p className="mt-1 max-w-[170px] truncate font-mono text-[10px] text-black/70">
                            {registration.id}
                          </p>

                        </td>

                        {/* FIXED EVENT NAME */}

                        <td className="px-6 py-5">

                          <span className="rounded-full bg-black/[0.05] px-3 py-1.5 text-xs font-medium text-black">
                            {getEventName(
                              registration.event_id
                            )}
                          </span>

                        </td>

                        <td className="px-6 py-5 text-sm text-black/60">
                          {registration.college}
                        </td>

                        <td className="px-6 py-5">

                          <p className="text-sm text-black">
                            {registration.email}
                          </p>

                          <p className="mt-1 text-xs text-black/80">
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

                                <p className="mt-2 text-[10px] text-black/70">
                                  {new Date(
                                    registration.checked_in_at
                                  ).toLocaleString()}
                                </p>

                              )}

                            </div>

                          ) : (

                            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.045] px-3 py-1.5 text-xs text-black/80">
                              <Clock3 size={13} />
                              Pending
                            </span>

                          )}

                        </td>

                        <td className="px-6 py-5 text-sm text-black/80">

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
                              className="flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs font-medium text-black transition hover:bg-black hover:text-white"
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

          <p className="mt-4 text-right text-xs text-black/70">
            Showing {filteredRegistrations.length} of{" "}
            {registrations.length} registrations
          </p>

        )}

      </div>

      {/* ADD REGISTRATION MODAL */}

      {showAddRegistration && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          onClick={() => {
            setShowAddRegistration(false);
            resetManualRegistration();
          }}
        >
          <div
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[30px] bg-white p-7 md:p-9"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-8 flex items-start justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-black/70">Admin registration</p>
                <h2 className="mt-2 text-3xl font-semibold">Add Registration</h2>
                <p className="mt-2 text-sm text-black/80">Manually register an individual participant or complete team.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowAddRegistration(false);
                  resetManualRegistration();
                }}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.05]"
              >
                <X size={17} />
              </button>
            </div>

            <form onSubmit={createManualRegistration} className="space-y-6">
              <div>
                <label className="mb-2 block text-[10px] font-medium uppercase tracking-[0.18em] text-black/80">Event *</label>
                <select
                  required
                  value={newRegistration.event_id}
                  onChange={(event) => selectManualEvent(event.target.value)}
                  className="w-full rounded-[16px] border border-black/10 bg-white px-4 py-3.5 text-sm text-black outline-none focus:border-black/30"
                >
                  <option value="">Select event</option>
                  {eventRecords.map((event) => (
                    <option key={event.id} value={event.id} disabled={!event.registration_open}>
                      {event.name}{!event.registration_open ? " — Registration closed" : ""}
                    </option>
                  ))}
                </select>
              </div>

              {selectedManualEvent && (
                <div className="rounded-[18px] bg-black/[0.035] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[9px] uppercase tracking-[0.2em] text-black/70">Registering for</p>
                      <p className="mt-1 font-medium">{selectedManualEvent.name}</p>
                    </div>
                    <span className="rounded-full bg-black px-3 py-1.5 text-[10px] uppercase tracking-[0.12em] text-white">
                      {isManualTeamEvent ? "Team" : "Individual"}
                    </span>
                  </div>
                  {isManualTeamEvent && (
                    <p className="mt-3 text-xs text-black/80">
                      Team size: {manualMinTeamSize}{manualMaxTeamSize !== manualMinTeamSize ? `–${manualMaxTeamSize}` : ""} members including the leader.
                    </p>
                  )}
                </div>
              )}

              {isManualTeamEvent && (
                <div className="border-b border-black/[0.08] pb-2">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-black/70">Team leader</p>
                  <h3 className="mt-1 text-xl font-semibold">Leader details</h3>
                </div>
              )}

              <div className="grid gap-5 sm:grid-cols-2">
                <ManualField
                  label={isManualTeamEvent ? "Team leader name *" : "Full name *"}
                  value={newRegistration.name}
                  onChange={(value) => setNewRegistration((current) => ({ ...current, name: value }))}
                />
                <ManualField
                  label="College / University *"
                  value={newRegistration.college}
                  onChange={(value) => setNewRegistration((current) => ({ ...current, college: value }))}
                />
                <ManualField
                  label={isManualTeamEvent ? "Team leader email *" : "Email *"}
                  type="email"
                  value={newRegistration.email}
                  onChange={(value) => setNewRegistration((current) => ({ ...current, email: value }))}
                />
                <ManualField
                  label={isManualTeamEvent ? "Team leader phone *" : "Phone *"}
                  type="tel"
                  value={newRegistration.phone}
                  onChange={(value) => setNewRegistration((current) => ({ ...current, phone: value }))}
                />
              </div>

              {isManualTeamEvent && (
                <div className="space-y-5">
                  <ManualField
                    label="Team name *"
                    value={newRegistration.team}
                    placeholder="Enter team name"
                    onChange={(value) => setNewRegistration((current) => ({ ...current, team: value }))}
                  />

                  <div className="flex flex-col gap-3 border-t border-black/[0.08] pt-6 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.2em] text-black/70">Team members</p>
                      <h3 className="mt-1 text-xl font-semibold">Add teammates</h3>
                      <p className="mt-1 text-xs text-black/80">The team leader is already counted as Member 1.</p>
                    </div>
                    <span className="text-xs text-black/80">{manualTeamMembers.length + 1} / {manualMaxTeamSize} members</span>
                  </div>

                  {manualTeamMembers.map((member, index) => (
                    <div key={index} className="rounded-[20px] border border-black/[0.08] p-5">
                      <div className="mb-4 flex items-center justify-between">
                        <div>
                          <p className="text-[9px] uppercase tracking-[0.2em] text-black/70">Team member</p>
                          <p className="mt-1 font-semibold">Member {index + 2}</p>
                        </div>
                        {manualTeamMembers.length > manualMinimumExtraMembers && (
                          <button
                            type="button"
                            onClick={() => removeManualTeamMember(index)}
                            className="flex h-9 w-9 items-center justify-center rounded-full border border-red-100 text-red-500 hover:bg-red-50"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                      <div className="grid gap-4 md:grid-cols-3">
                        <ManualField label="Full name *" value={member.name} onChange={(value) => updateManualTeamMember(index, "name", value)} />
                        <ManualField label="Email *" type="email" value={member.email} onChange={(value) => updateManualTeamMember(index, "email", value)} />
                        <ManualField label="Phone *" type="tel" value={member.phone} onChange={(value) => updateManualTeamMember(index, "phone", value)} />
                      </div>
                    </div>
                  ))}

                  {manualTeamMembers.length < manualMaximumExtraMembers && (
                    <button
                      type="button"
                      onClick={addManualTeamMember}
                      className="flex items-center gap-2 rounded-full border border-black/15 px-5 py-3 text-sm transition hover:bg-black hover:text-white"
                    >
                      <UserPlus size={15} />
                      Add team member
                    </button>
                  )}
                </div>
              )}

              <div className="border-t border-black/[0.08] pt-6">
                <button
                  type="submit"
                  disabled={addingRegistration || !newRegistration.event_id}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-black px-6 py-4 text-sm font-medium text-white transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {addingRegistration ? (
                    <>
                      <RefreshCw size={15} className="animate-spin" />
                      Creating registration...
                    </>
                  ) : (
                    <>
                      <Plus size={15} />
                      {isManualTeamEvent ? "Register Team" : "Register Participant"}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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

                <p className="text-[10px] uppercase tracking-[0.22em] text-black/70">
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

              <p className="text-[9px] uppercase tracking-[0.2em] text-white">
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
                    <p className="text-[10px] uppercase tracking-[0.22em] text-black/70">
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
                  <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-black/70">
                    Team leader
                  </p>
                  <p className="mt-2 font-medium">
                    {selectedRegistration.name}
                  </p>
                  <div className="mt-2 flex flex-col gap-1 text-xs text-black/80 sm:flex-row sm:gap-4">
                    <span>{selectedRegistration.email || "—"}</span>
                    <span>{selectedRegistration.phone || "—"}</span>
                  </div>
                </div>

                {membersLoading ? (
                  <div className="flex items-center gap-3 rounded-[18px] border border-black/[0.07] p-5 text-sm text-black/80">
                    <RefreshCw size={15} className="animate-spin" />
                    Loading team members...
                  </div>
                ) : membersError ? (
                  <div className="rounded-[18px] bg-red-50 p-5 text-sm text-red-700">
                    Could not load team members: {membersError}
                  </div>
                ) : registrationMembers.length === 0 ? (
                  <div className="rounded-[18px] border border-black/[0.07] p-5 text-sm text-black/80">
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
                            <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-black/70">
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

            <div className="mt-8 border-t border-black/[0.08] pt-6">
              <button
                onClick={() => toggleCheckIn(selectedRegistration)}
                disabled={updatingCheckInId === selectedRegistration.id}
                className={`mb-4 flex w-full items-center justify-center gap-2 rounded-full px-6 py-3.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  selectedRegistration.checked_in
                    ? "border border-black/10 bg-white text-black hover:bg-black/[0.04]"
                    : "bg-black text-white hover:scale-[1.01]"
                }`}
              >
                {updatingCheckInId === selectedRegistration.id ? (
                  <>
                    <RefreshCw size={15} className="animate-spin" />
                    Updating...
                  </>
                ) : selectedRegistration.checked_in ? (
                  <>
                    <Clock3 size={15} />
                    Undo Check-In
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={15} />
                    Check In Participant
                  </>
                )}
              </button>

              <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                <button
                  onClick={() =>
                    deleteRegistration(
                      selectedRegistration.id
                    )
                  }
                  disabled={
                    deletingId === selectedRegistration.id ||
                    updatingCheckInId === selectedRegistration.id
                  }
                  className="flex items-center justify-center gap-2 rounded-full border border-red-100 px-5 py-3 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-40"
                >
                  {deletingId === selectedRegistration.id ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                  {deletingId === selectedRegistration.id
                    ? "Deleting..."
                    : "Delete registration"}
                </button>

                <button
                  onClick={closeRegistration}
                  disabled={updatingCheckInId === selectedRegistration.id}
                  className="rounded-full bg-black px-7 py-3 text-sm text-white disabled:opacity-40"
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
            ? "text-white"
            : "text-black/80"
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
    <th className="px-6 py-5 text-[10px] font-medium uppercase tracking-[0.18em] text-black/80">
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

      <p className="text-[9px] uppercase tracking-[0.2em] text-black/70">
        {title}
      </p>

      <p className="mt-2 break-words text-sm text-black">
        {value || "—"}
      </p>

    </div>
  );
}

function ManualField({
  label,
  value,
  onChange,
  type = "text",
  placeholder = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-2 block text-[10px] font-medium uppercase tracking-[0.18em] text-black/80">
        {label}
      </label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        required={label.includes("*")}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-[16px] border border-black/10 bg-white px-4 py-3.5 text-sm text-black outline-none transition placeholder:text-black/25 focus:border-black/30"
      />
    </div>
  );
}

