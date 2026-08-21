"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Clock3,
  Edit3,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

type EventRecord = {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
  event_date: string | null;
  start_time: string | null;
  venue: string | null;
  active: boolean;
  registration_open: boolean;
  registration_type: "individual" | "team" | string | null;
  min_team_size: number | null;
  max_team_size: number | null;
  registration_fee: number | null;
  payment_type: string | null;
  payment_unit: string | null;
  registration_count: number;
};

type EventForm = {
  id?: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  event_date: string;
  start_time: string;
  venue: string;
  active: boolean;
  registration_open: boolean;
  registration_type: "individual" | "team";
  min_team_size: string;
  max_team_size: string;
  registration_fee: string;
  payment_unit: "free" | "per_student" | "per_team" | "tbd";
};

const emptyForm: EventForm = {
  name: "",
  slug: "",
  category: "technical",
  description: "",
  event_date: "",
  start_time: "",
  venue: "",
  active: true,
  registration_open: true,
  registration_type: "individual",
  min_team_size: "",
  max_team_size: "",
  registration_fee: "0",
  payment_unit: "free",
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatDate(value: string | null) {
  if (!value) return "Date TBA";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

function formatFee(event: EventRecord) {
  const fee = Number(event.registration_fee ?? 0);
  if (!fee || event.payment_unit === "free") return "Free";
  const unit =
    event.payment_unit === "per_team"
      ? "per team"
      : event.payment_unit === "per_student"
        ? "per student"
        : event.payment_unit === "tbd"
          ? "TBD"
          : "";
  return `₹${fee.toLocaleString("en-IN")}${unit ? ` · ${unit}` : ""}`;
}

function categoryLabel(category: string | null) {
  return (category ?? "other")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function EventsAdminPage() {
  const router = useRouter();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<EventForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
const [role, setRole] = useState<"master" | "admin" | null>(null);
  const loadEvents = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/events", {
        cache: "no-store",
      });

      if (response.status === 401 || response.status === 403) {
        router.replace("/admin/login");
        return;
      }

      const payload = (await response.json()) as {
  events?: EventRecord[];
  role?: "master" | "admin";
  error?: string;
};
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not load events.");
      }

      setEvents(payload.events ?? []);
      setRole(payload.role ?? null);
      if (payload.role === "admin") {
        router.replace("/admin");
        return;
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load events."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    void loadEvents();

    const channel = supabase
      .channel("admin-event-management")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "events",
        },
        () => void loadEvents(true)
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadEvents]);

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return events;

    return events.filter((event) =>
      [
        event.name,
        event.slug,
        event.category,
        event.venue,
        event.description,
      ].some((value) =>
        value?.toLowerCase().includes(query)
      )
    );
  }, [events, search]);

  const stats = useMemo(
    () => ({
      total: events.length,
      active: events.filter((event) => event.active).length,
      open: events.filter((event) => event.registration_open).length,
    }),
    [events]
  );

  function startCreate() {
    setError("");
    setEditing({ ...emptyForm });
  }

  function startEdit(event: EventRecord) {
    setError("");
    setEditing({
      id: event.id,
      name: event.name,
      slug: event.slug,
      category: event.category ?? "technical",
      description: event.description ?? "",
      event_date: event.event_date ?? "",
      start_time: event.start_time ?? "",
      venue: event.venue ?? "",
      active: event.active,
      registration_open: event.registration_open,
      registration_type:
        event.registration_type === "team"
          ? "team"
          : "individual",
      min_team_size:
        event.min_team_size?.toString() ?? "",
      max_team_size:
        event.max_team_size?.toString() ?? "",
      registration_fee:
        event.registration_fee?.toString() ?? "0",
      payment_unit:
        event.payment_unit === "per_student" ||
        event.payment_unit === "per_team" ||
        event.payment_unit === "tbd"
          ? event.payment_unit
          : "free",
    });
  }

  async function saveEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;

    setSaving(true);
    setError("");

    try {
      const method = editing.id ? "PATCH" : "POST";
      const response = await fetch("/api/admin/events", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...editing,
          slug: editing.slug || slugify(editing.name),
          registration_fee: Number(editing.registration_fee || 0),
          min_team_size:
            editing.registration_type === "team"
              ? Number(editing.min_team_size || 0) || null
              : null,
          max_team_size:
            editing.registration_type === "team"
              ? Number(editing.max_team_size || 0) || null
              : null,
        }),
      });

      const payload = (await response.json()) as {
        event?: EventRecord;
        error?: string;
      };

      if (!response.ok || !payload.event) {
        throw new Error(
          payload.error ?? "Could not save event."
        );
      }

      setEditing(null);
      await loadEvents(true);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save event."
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteEvent(event: EventRecord) {
    if (event.registration_count > 0) {
      setError(
        `"${event.name}" already has ${event.registration_count} registration${event.registration_count === 1 ? "" : "s"}. It cannot be deleted; deactivate it instead.`
      );
      return;
    }

    if (
      !window.confirm(
        `Delete "${event.name}" permanently? This cannot be undone.`
      )
    ) {
      return;
    }

    setDeletingId(event.id);
    setError("");

    try {
      const response = await fetch(
        `/api/admin/events?id=${encodeURIComponent(event.id)}`,
        { method: "DELETE" }
      );
      const payload = (await response.json()) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.error ?? "Could not delete event."
        );
      }

      setEvents((current) =>
        current.filter((item) => item.id !== event.id)
      );
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete event."
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#f5f5f3] px-5 py-10 text-black md:px-10 lg:px-16">
      <div className="mx-auto max-w-[1500px]">
        <header className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-black/40">
              Saviskar 2026
            </p>
            <h1 className="text-5xl font-semibold tracking-[-0.06em] md:text-6xl">
              Events
            </h1>
            <p className="mt-4 text-sm text-black/45">
              Create and manage Saviskar events.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => router.push("/admin")}
              className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm transition hover:bg-black/[0.04]"
            >
              <ArrowLeft size={15} />
              Dashboard
            </button>
            <button
              type="button"
              onClick={() => void loadEvents(true)}
              disabled={refreshing}
              className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm transition hover:bg-black/[0.04] disabled:opacity-50"
            >
              <RefreshCw
                size={15}
                className={refreshing ? "animate-spin" : ""}
              />
              Refresh
            </button>
            {role === "master" && (
              <button
              type="button"
              onClick={startCreate}
              className="flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm text-white transition hover:scale-[1.02]"
            >
              <Plus size={15} />
              Create Event
            </button>
            )}
          </div>
        </header>

        {error && (
          <div className="mb-6 flex items-start justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError("")}
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <section className="mb-8 grid gap-4 md:grid-cols-3">
          <StatCard label="Total events" value={stats.total} dark />
          <StatCard label="Active events" value={stats.active} />
          <StatCard label="Registration open" value={stats.open} />
        </section>

        <section className="mb-8 flex items-center gap-3 rounded-[24px] bg-white p-4 shadow-[0_20px_80px_rgba(0,0,0,0.04)]">
          <Search size={18} className="text-black/35" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search events, category, venue..."
            className="w-full bg-transparent py-2 text-sm outline-none"
          />
        </section>

        {loading ? (
          <div className="rounded-[28px] bg-white py-20 text-center text-sm text-black/40">
            Loading events…
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="rounded-[28px] bg-white py-20 text-center">
            <CalendarDays className="mx-auto text-black/20" size={38} />
            <p className="mt-4 text-sm text-black/45">
              {search ? "No events match your search." : "No events found."}
            </p>
            {!search && (
              role === "master" && (
              <button
                type="button"
                onClick={startCreate}
                className="mt-5 rounded-full bg-black px-5 py-3 text-sm text-white"
              >
                Create your first event
              </button>
              )
            )}
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {filteredEvents.map((event) => (
              <article
                key={event.id}
                className="rounded-[28px] bg-white p-6 shadow-[0_20px_80px_rgba(0,0,0,0.04)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-black/35">
                      {categoryLabel(event.category)}
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
                      {event.name}
                    </h2>
                    <p className="mt-1 text-xs text-black/35">
                      /{event.slug}
                    </p>
                  </div>

                  <span
                    className={`mt-1 h-3 w-3 rounded-full ${
                      event.active
                        ? "bg-emerald-500"
                        : "bg-black/15"
                    }`}
                    title={event.active ? "Active" : "Inactive"}
                  />
                </div>

                {event.description && (
                  <p className="mt-4 text-sm leading-6 text-black/50">
                    {event.description}
                  </p>
                )}

                <div className="mt-6 grid gap-3 text-xs text-black/55 sm:grid-cols-2">
                  <Info icon={<CalendarDays size={14} />} value={formatDate(event.event_date)} />
                  <Info
                    icon={<Clock3 size={14} />}
                    value={event.start_time || "Time TBA"}
                  />
                  <Info
                    icon={<MapPin size={14} />}
                    value={event.venue || "Venue TBA"}
                  />
                  <Info
                    icon={<Users size={14} />}
                    value={
                      event.registration_type === "team"
                        ? `${event.min_team_size ?? "?"}–${event.max_team_size ?? "?"} members`
                        : "Individual"
                    }
                  />
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-medium text-emerald-700">
                    {event.registration_open
                      ? "Registration open"
                      : "Registration closed"}
                  </span>
                  <span className="rounded-full bg-black px-3 py-1.5 text-[10px] text-white">
                    {event.active ? "Active" : "Inactive"}
                  </span>
                  <span className="rounded-full bg-black/[0.04] px-3 py-1.5 text-[10px] text-black/50">
                    {formatFee(event)}
                  </span>
                  <span className="ml-auto text-[10px] uppercase tracking-[0.12em] text-black/30">
                    {event.registration_count} registration
                    {event.registration_count === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="mt-6 grid gap-2 border-t border-black/10 pt-5 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() =>
                      router.push(
                        `/admin/events/${event.id}/registrations`
                      )
                    }
                    className="flex items-center justify-center gap-2 rounded-full bg-black px-4 py-3 text-xs font-medium text-white transition hover:bg-black/80"
                  >
                    <Users size={14} />
                    Registrations
                  </button>
                  {role === "master" && (
                  <button
                    type="button"
                    onClick={() => startEdit(event)}
                    className="flex items-center justify-center gap-2 rounded-full border border-black/10 px-4 py-3 text-xs font-medium transition hover:bg-black/[0.04]"
                  >
                    <Edit3 size={14} />
                    Edit
                  </button>
                  )}
                </div>
{role === "master" && (
                <button
                  type="button"
                  onClick={() => void deleteEvent(event)}
                  disabled={
                    deletingId === event.id ||
                    event.registration_count > 0
                  }
                  title={
                    event.registration_count > 0
                      ? "Events with registrations cannot be deleted."
                      : "Delete event"
                  }
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-red-100 px-4 py-3 text-xs text-red-500 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {deletingId === event.id ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                  Delete event
                </button>
)}
              </article>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[28px] bg-white p-6 md:p-8">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-black/35">
                  {editing.id ? "Edit event" : "New event"}
                </p>
                <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
                  {editing.id ? "Manage event" : "Create event"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-full border border-black/10 p-2"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={saveEvent} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Event name" required>
                  <input
                    required
                    value={editing.name}
                    onChange={(event) =>
                      setEditing((current) =>
                        current
                          ? {
                              ...current,
                              name: event.target.value,
                              slug:
                                current.id || current.slug
                                  ? current.slug
                                  : slugify(event.target.value),
                            }
                          : current
                      )
                    }
                    className="input"
                    placeholder="Hackathon"
                  />
                </Field>

                <Field label="Slug">
                  <input
                    value={editing.slug}
                    onChange={(event) =>
                      setEditing((current) =>
                        current
                          ? {
                              ...current,
                              slug: slugify(event.target.value),
                            }
                          : current
                      )
                    }
                    className="input"
                    placeholder="hackathon"
                  />
                </Field>

                <Field label="Category" required>
                  <select
                    value={editing.category}
                    onChange={(event) =>
                      setEditing((current) =>
                        current
                          ? {
                              ...current,
                              category: event.target.value,
                            }
                          : current
                      )
                    }
                    className="input"
                  >
                    <option value="technical">Technical</option>
                    <option value="cultural">Cultural</option>
                    <option value="non-technical">Non-Technical</option>
                    <option value="sports">Sports</option>
                  </select>
                </Field>

                <Field label="Venue">
                  <input
                    value={editing.venue}
                    onChange={(event) =>
                      setEditing((current) =>
                        current
                          ? {
                              ...current,
                              venue: event.target.value,
                            }
                          : current
                      )
                    }
                    className="input"
                    placeholder="Block A"
                  />
                </Field>

                <Field label="Event date">
                  <input
                    type="date"
                    value={editing.event_date}
                    onChange={(event) =>
                      setEditing((current) =>
                        current
                          ? {
                              ...current,
                              event_date: event.target.value,
                            }
                          : current
                      )
                    }
                    className="input"
                  />
                </Field>

                <Field label="Start time">
                  <input
                    type="time"
                    value={editing.start_time}
                    onChange={(event) =>
                      setEditing((current) =>
                        current
                          ? {
                              ...current,
                              start_time: event.target.value,
                            }
                          : current
                      )
                    }
                    className="input"
                  />
                </Field>

                <Field label="Registration type">
                  <select
                    value={editing.registration_type}
                    onChange={(event) =>
                      setEditing((current) =>
                        current
                          ? {
                              ...current,
                              registration_type:
                                event.target.value as
                                  | "individual"
                                  | "team",
                            }
                          : current
                      )
                    }
                    className="input"
                  >
                    <option value="individual">Individual</option>
                    <option value="team">Team</option>
                  </select>
                </Field>

                <Field label="Registration fee">
                  <input
                    type="number"
                    min="0"
                    value={editing.registration_fee}
                    onChange={(event) =>
                      setEditing((current) =>
                        current
                          ? {
                              ...current,
                              registration_fee: event.target.value,
                            }
                          : current
                      )
                    }
                    className="input"
                    placeholder="0"
                  />
                </Field>

                <Field label="Payment unit">
                  <select
                    value={editing.payment_unit}
                    onChange={(event) =>
                      setEditing((current) =>
                        current
                          ? {
                              ...current,
                              payment_unit:
                                event.target.value as EventForm["payment_unit"],
                            }
                          : current
                      )
                    }
                    className="input"
                  >
                    <option value="free">Free</option>
                    <option value="per_student">Per student</option>
                    <option value="per_team">Per team</option>
                    <option value="tbd">TBD</option>
                  </select>
                </Field>

                {editing.registration_type === "team" && (
                  <>
                    <Field label="Minimum team size">
                      <input
                        type="number"
                        min="1"
                        value={editing.min_team_size}
                        onChange={(event) =>
                          setEditing((current) =>
                            current
                              ? {
                                  ...current,
                                  min_team_size: event.target.value,
                                }
                              : current
                          )
                        }
                        className="input"
                        placeholder="2"
                      />
                    </Field>
                    <Field label="Maximum team size">
                      <input
                        type="number"
                        min="1"
                        value={editing.max_team_size}
                        onChange={(event) =>
                          setEditing((current) =>
                            current
                              ? {
                                  ...current,
                                  max_team_size: event.target.value,
                                }
                              : current
                          )
                        }
                        className="input"
                        placeholder="5"
                      />
                    </Field>
                  </>
                )}
              </div>

              <Field label="Description">
                <textarea
                  value={editing.description}
                  onChange={(event) =>
                    setEditing((current) =>
                      current
                        ? {
                            ...current,
                            description: event.target.value,
                          }
                        : current
                    )
                  }
                  rows={4}
                  className="input resize-none"
                  placeholder="Take the stage and own the sound."
                />
              </Field>

              <div className="grid gap-3 md:grid-cols-2">
                <Toggle
                  label="Active event"
                  checked={editing.active}
                  onChange={(checked) =>
                    setEditing((current) =>
                      current
                        ? { ...current, active: checked }
                        : current
                    )
                  }
                />
                <Toggle
                  label="Registration open"
                  checked={editing.registration_open}
                  onChange={(checked) =>
                    setEditing((current) =>
                      current
                        ? {
                            ...current,
                            registration_open: checked,
                          }
                        : current
                    )
                  }
                />
              </div>

              <div className="flex justify-end gap-3 border-t border-black/10 pt-5">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-full border border-black/10 px-5 py-3 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm text-white disabled:opacity-50"
                >
                  {saving && (
                    <RefreshCw
                      size={15}
                      className="animate-spin"
                    />
                  )}
                  <Check size={15} />
                  {saving
                    ? "Saving…"
                    : editing.id
                      ? "Save changes"
                      : "Create event"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style jsx global>{`
        .input {
          width: 100%;
          border-radius: 14px;
          border: 1px solid rgba(0, 0, 0, 0.1);
          background: white;
          padding: 12px 14px;
          font-size: 14px;
          outline: none;
        }
        .input:focus {
          border-color: rgba(0, 0, 0, 0.35);
          box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.04);
        }
      `}</style>
    </main>
  );
}

function StatCard({
  label,
  value,
  dark = false,
}: {
  label: string;
  value: number;
  dark?: boolean;
}) {
  return (
    <div
      className={`rounded-[28px] p-7 ${
        dark ? "bg-black text-white" : "bg-white"
      }`}
    >
      <p
        className={`text-[9px] font-semibold uppercase tracking-[0.2em] ${
          dark ? "text-white/40" : "text-black/35"
        }`}
      >
        {label}
      </p>
      <p className="mt-3 text-4xl font-semibold tracking-[-0.05em]">
        {value}
      </p>
    </div>
  );
}

function Info({
  icon,
  value,
}: {
  icon: React.ReactNode;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-black/30">{icon}</span>
      <span className="truncate">{value}</span>
    </div>
  );
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[9px] font-semibold uppercase tracking-[0.15em] text-black/35">
        {label}
        {required ? " *" : ""}
      </span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-2xl bg-black/[0.035] px-4 py-4">
      <span className="text-sm">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 accent-black"
      />
    </label>
  );
}
