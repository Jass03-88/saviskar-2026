"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  Edit3,
  MapPin,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  X,
} from "lucide-react";

type Event = {
  id: string;
  created_at: string;
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
  event_date: string | null;
  start_time: string | null;
  venue: string | null;
  registration_type: "individual" | "team";
  min_team_size: number | null;
  max_team_size: number | null;
  registration_limit: number | null;
  payment_type: "free" | "paid";
  registration_fee: number;
  payment_unit: "per_student" | "per_team" | null;
  registration_open: boolean;
  active: boolean;
};

type EventForm = {
  name: string;
  slug: string;
  category: string;
  description: string;
  event_date: string;
  start_time: string;
  venue: string;
  registration_type: "individual" | "team";
  min_team_size: string;
  max_team_size: string;
  registration_limit: string;
  payment_type: "free" | "paid";
  registration_fee: string;
  payment_unit: "per_student" | "per_team";
  registration_open: boolean;
  active: boolean;
};

const emptyForm: EventForm = {
  name: "",
  slug: "",
  category: "",
  description: "",
  event_date: "",
  start_time: "",
  venue: "",
  registration_type: "individual",
  min_team_size: "",
  max_team_size: "",
  registration_limit: "",
  payment_type: "free",
  registration_fee: "0",
  payment_unit: "per_student",
  registration_open: true,
  active: true,
};

export default function AdminEventsPage() {
  const router = useRouter();

  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] =
    useState<Event | null>(null);

  const [form, setForm] = useState<EventForm>(emptyForm);

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

  async function loadEvents() {
    setLoading(true);
    setError("");

    const { data, error } = await supabase
      .from("events")
      .select("*")
      .order("event_date", { ascending: true });

    if (error) {
      console.error("EVENT LOAD ERROR:", error);
      setError(error.message);
      setLoading(false);
      return;
    }

    setEvents((data as Event[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    async function initialise() {
      const authenticated = await checkAuth();

      if (!authenticated) return;

      await loadEvents();
    }

    initialise();
  }, []);

  function updateForm<K extends keyof EventForm>(
    key: K,
    value: EventForm[K]
  ) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function createSlug(value: string) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function openCreateForm() {
    setEditingEvent(null);
    setForm(emptyForm);
    setError("");
    setShowForm(true);
  }

  function openEditForm(event: Event) {
    setEditingEvent(event);

    setForm({
      name: event.name,
      slug: event.slug,
      category: event.category || "",
      description: event.description || "",
      event_date: event.event_date || "",
      start_time: event.start_time
        ? event.start_time.slice(0, 5)
        : "",
      venue: event.venue || "",
      registration_type: event.registration_type,
      min_team_size: event.min_team_size?.toString() || "",
      max_team_size: event.max_team_size?.toString() || "",
      registration_limit:
        event.registration_limit?.toString() || "",
      payment_type: event.payment_type ?? "free",
      registration_fee:
        event.registration_fee?.toString() || "0",
      payment_unit:
        event.payment_unit === "per_team"
          ? "per_team"
          : "per_student",
      registration_open: event.registration_open,
      active: event.active,
    });

    setError("");
    setShowForm(true);
  }

  function closeForm() {
    if (saving) return;

    setShowForm(false);
    setEditingEvent(null);
    setForm(emptyForm);
  }

  async function saveEvent(e: React.FormEvent) {

    if (!form.name.trim()) {
      setError("Event name is required.");
      return;
    }

    const slug =
      form.slug.trim() || createSlug(form.name);

    if (!slug) {
      setError("Please enter a valid event name.");
      return;
    }

    if (
      form.registration_type === "team" &&
      form.min_team_size &&
      form.max_team_size &&
      Number(form.min_team_size) >
        Number(form.max_team_size)
    ) {
      setError(
        "Minimum team size cannot be greater than maximum team size."
      );
      return;
    }

    if (
      form.payment_type === "paid" &&
      (!form.registration_fee ||
        Number(form.registration_fee) <= 0)
    ) {
      setError("Please enter a valid fee greater than ₹0.");
      return;
    }

    setSaving(true);
    setError("");

    const payload = {
      name: form.name.trim(),
      slug,
      category: form.category.trim() || null,
      description: form.description.trim() || null,
      event_date: form.event_date || null,
      start_time: form.start_time || null,
      venue: form.venue.trim() || null,

      registration_type: form.registration_type,

      min_team_size:
        form.registration_type === "team" &&
        form.min_team_size
          ? Number(form.min_team_size)
          : null,

      max_team_size:
        form.registration_type === "team" &&
        form.max_team_size
          ? Number(form.max_team_size)
          : null,

      registration_limit: form.registration_limit
        ? Number(form.registration_limit)
        : null,

      payment_type: form.payment_type,
      registration_fee:
        form.payment_type === "paid"
          ? Number(form.registration_fee)
          : 0,
      // payment_unit is NOT NULL in the current database,
      // so free events keep a harmless default value.
      payment_unit:
        form.payment_type === "paid"
          ? form.payment_unit
          : "per_student",

      registration_open: form.registration_open,
      active: form.active,
    };

    let result;

    if (editingEvent) {
      result = await supabase
        .from("events")
        .update(payload)
        .eq("id", editingEvent.id);
    } else {
      result = await supabase
        .from("events")
        .insert(payload);
    }

    if (result.error) {
      console.error("EVENT SAVE ERROR:", result.error);

      if (result.error.code === "23505") {
        setError(
          "An event with this slug already exists."
        );
      } else {
        setError(result.error.message);
      }

      setSaving(false);
      return;
    }

    await loadEvents();

    setSaving(false);
    setShowForm(false);
    setEditingEvent(null);
    setForm(emptyForm);
  }

  async function toggleRegistration(event: Event) {
    const { error } = await supabase
      .from("events")
      .update({
        registration_open: !event.registration_open,
      })
      .eq("id", event.id);

    if (error) {
      console.error(error);
      alert("Could not update registration status.");
      return;
    }

    await loadEvents();
  }

  async function toggleActive(event: Event) {
    const { error } = await supabase
      .from("events")
      .update({
        active: !event.active,
      })
      .eq("id", event.id);

    if (error) {
      console.error(error);
      alert("Could not update event status.");
      return;
    }

    await loadEvents();
  }

  async function deleteEvent(event: Event) {
    const confirmed = window.confirm(
      `Delete "${event.name}"?\n\nThis action cannot be undone.`
    );

    if (!confirmed) return;

    const { error } = await supabase
      .from("events")
      .delete()
      .eq("id", event.id);

    if (error) {
      console.error("DELETE EVENT ERROR:", error);
      alert("Could not delete event.");
      return;
    }

    await loadEvents();
  }

  return (
    <main className="min-h-screen bg-[#f5f5f5] px-5 py-10 md:px-10 lg:px-16">
      <div className="mx-auto max-w-[1500px]">

        {/* HEADER */}

        <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-black/40">
              Saviskar 2026
            </p>

            <h1 className="text-4xl font-semibold tracking-[-0.05em] text-black md:text-6xl">
              Events
            </h1>

            <p className="mt-4 text-sm text-black/45">
              Create and manage Saviskar events.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => router.push("/admin")}
              className="flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs font-medium text-black transition hover:bg-black hover:text-white"
            >
              <ArrowLeft size={15} />
              Dashboard
            </button>

            <button
              onClick={loadEvents}
              disabled={loading}
              className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm text-black transition hover:bg-black/[0.03]"
            >
              <RefreshCw
                size={15}
                className={loading ? "animate-spin" : ""}
              />
              Refresh
            </button>

            <button
              onClick={openCreateForm}
              className="flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm text-white transition hover:scale-[1.02]"
            >
              <Plus size={15} />
              Create Event
            </button>
          </div>
        </div>

        {/* STATS */}

        <div className="mb-8 grid gap-4 md:grid-cols-3">
          <StatCard
            title="Total events"
            value={events.length}
            dark
          />

          <StatCard
            title="Active events"
            value={
              events.filter((event) => event.active).length
            }
          />

          <StatCard
            title="Registration open"
            value={
              events.filter(
                (event) =>
                  event.active &&
                  event.registration_open
              ).length
            }
          />
        </div>

        {/* ERROR */}

        {error && !showForm && (
          <div className="mb-6 rounded-[20px] bg-red-50 p-5 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* EVENTS */}

        {loading ? (
          <div className="flex min-h-[350px] items-center justify-center rounded-[28px] bg-white">
            <div className="text-center">
              <RefreshCw
                size={24}
                className="mx-auto mb-4 animate-spin"
              />

              <p className="text-sm text-black/40">
                Loading events...
              </p>
            </div>
          </div>
        ) : events.length === 0 ? (
          <div className="flex min-h-[400px] items-center justify-center rounded-[28px] bg-white text-center shadow-[0_20px_80px_rgba(0,0,0,0.04)]">
            <div>
              <CalendarDays
                size={30}
                className="mx-auto mb-5 text-black/20"
              />

              <h2 className="text-xl font-semibold text-black">
                No events yet
              </h2>

              <p className="mt-2 text-sm text-black/40">
                Create your first Saviskar event.
              </p>

              <button
                onClick={openCreateForm}
                className="mt-6 rounded-full bg-black px-6 py-3 text-sm text-white"
              >
                Create Event
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {events.map((event) => (
              <div
                key={event.id}
                className="flex flex-col rounded-[28px] bg-white p-7 shadow-[0_20px_80px_rgba(0,0,0,0.04)]"
              >
                <div className="mb-6 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-black/35">
                      {event.category || "Event"}
                    </p>

                    <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-black">
                      {event.name}
                    </h2>

                    <p className="mt-1 font-mono text-[10px] text-neutral-500">
                      /{event.slug}
                    </p>
                  </div>

                  <div
                    className={`h-3 w-3 rounded-full ${
                      event.active
                        ? "bg-green-500"
                        : "bg-black/15"
                    }`}
                  />
                </div>

                {event.description && (
                  <p className="mb-6 line-clamp-3 text-sm leading-6 text-neutral-700">
                    {event.description}
                  </p>
                )}

                <div className="mb-7 space-y-3">
                  <InfoRow
                    icon={<CalendarDays size={14} />}
                    value={
                      event.event_date
                        ? formatDate(event.event_date)
                        : "Date not set"
                    }
                  />

                  <InfoRow
                    icon={<MapPin size={14} />}
                    value={event.venue || "Venue not set"}
                  />

                  <InfoRow
                    icon={<Users size={14} />}
                    value={
                      event.registration_type === "team"
                        ? `Team${
                            event.min_team_size ||
                            event.max_team_size
                              ? ` · ${
                                  event.min_team_size || "?"
                                }–${
                                  event.max_team_size || "?"
                                } members`
                              : ""
                          }`
                        : "Individual"
                    }
                  />

                  <InfoRow
                    icon={<span className="text-xs font-semibold">₹</span>}
                    value={
                      event.payment_type === "paid"
                        ? `₹${Number(event.registration_fee || 0).toLocaleString(
                            "en-IN"
                          )} · ${
                            event.payment_unit === "per_team"
                              ? "per team"
                              : "per student"
                          }`
                        : "Free"
                    }
                  />
                </div>

                <div className="mb-6 flex flex-wrap gap-2">
                  <button
                    onClick={() =>
                      toggleRegistration(event)
                    }
                    className={`rounded-full px-3 py-2 text-xs font-medium ${
                      event.registration_open
                        ? "bg-green-50 text-green-700"
                        : "bg-red-50 text-red-600"
                    }`}
                  >
                    {event.registration_open
                      ? "Registration open"
                      : "Registration closed"}
                  </button>

                  <button
                    onClick={() => toggleActive(event)}
                    className={`rounded-full px-3 py-2 text-xs ${
                      event.active
                        ? "bg-black text-white"
                        : "bg-black/[0.05] text-black/50"
                    }`}
                  >
                    {event.active ? "Active" : "Inactive"}
                  </button>
                </div>

                <div className="mt-auto grid grid-cols-2 gap-2 border-t border-black/[0.06] pt-5">
                  <button
                    onClick={() =>
                      router.push(`/admin/events/${event.id}/registrations`)
                    }
                    className="flex items-center justify-center gap-2 rounded-full bg-black px-4 py-2.5 text-xs text-white transition hover:scale-[1.01]"
                  >
                    <BarChart3 size={13} />
                    Registrations
                  </button>

                  <button
                    onClick={() => openEditForm(event)}
                    className="flex items-center justify-center gap-2 rounded-full border border-black/10 px-4 py-2.5 text-xs text-black transition hover:bg-black hover:text-white"
                  >
                    <Edit3 size={13} />
                    Edit
                  </button>

                  <button
                    onClick={() => deleteEvent(event)}
                    className="col-span-2 flex items-center justify-center gap-2 rounded-full border border-red-100 px-4 py-2.5 text-xs text-red-500 transition hover:bg-red-50"
                  >
                    <Trash2 size={13} />
                    Delete event
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* CREATE / EDIT MODAL */}

      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          onClick={closeForm}
        >
          <div
            className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[30px] bg-white p-7 md:p-9"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-8 flex items-start justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-black/35">
                  Event management
                </p>

                <h2 className="mt-2 text-3xl font-semibold text-black">
                  {editingEvent
                    ? "Edit event"
                    : "Create event"}
                </h2>
              </div>

              <button
                type="button"
                onClick={closeForm}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.05] text-black"
              >
                <X size={17} />
              </button>
            </div>

            {error && (
              <div className="mb-6 rounded-2xl bg-red-50 p-4 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={saveEvent}>
              <div className="grid gap-5 md:grid-cols-2">

                <Field label="Event name">
                  <input
                    required
                    value={form.name}
                    onChange={(e) => {
                      const value = e.target.value;

                      updateForm("name", value);

                      if (!editingEvent) {
                        updateForm(
                          "slug",
                          createSlug(value)
                        );
                      }
                    }}
                    placeholder="Hackathon"
                    className={inputClass}
                  />
                </Field>

                <Field label="Event slug">
                  <input
                    required
                    value={form.slug}
                    onChange={(e) =>
                      updateForm(
                        "slug",
                        createSlug(e.target.value)
                      )
                    }
                    placeholder="hackathon"
                    className={inputClass}
                  />
                </Field>

                <Field label="Category">
                  <input
                    value={form.category}
                    onChange={(e) =>
                      updateForm(
                        "category",
                        e.target.value
                      )
                    }
                    placeholder="Technical"
                    className={inputClass}
                  />
                </Field>

                <Field label="Venue">
                  <input
                    value={form.venue}
                    onChange={(e) =>
                      updateForm("venue", e.target.value)
                    }
                    placeholder="Main Auditorium"
                    className={inputClass}
                  />
                </Field>

                <Field label="Event date">
                  <input
                    type="date"
                    value={form.event_date}
                    onChange={(e) =>
                      updateForm(
                        "event_date",
                        e.target.value
                      )
                    }
                    className={inputClass}
                  />
                </Field>

                <Field label="Start time">
                  <input
                    type="time"
                    value={form.start_time}
                    onChange={(e) =>
                      updateForm(
                        "start_time",
                        e.target.value
                      )
                    }
                    className={inputClass}
                  />
                </Field>

                <Field label="Registration type">
                  <select
                    value={form.registration_type}
                    onChange={(e) =>
                      updateForm(
                        "registration_type",
                        e.target.value as
                          | "individual"
                          | "team"
                      )
                    }
                    className={inputClass}
                  >
                    <option value="individual">
                      Individual
                    </option>

                    <option value="team">
                      Team
                    </option>
                  </select>
                </Field>

                <Field label="Registration limit">
                  <input
                    type="number"
                    min="1"
                    value={form.registration_limit}
                    onChange={(e) =>
                      updateForm(
                        "registration_limit",
                        e.target.value
                      )
                    }
                    placeholder="Leave blank for unlimited"
                    className={inputClass}
                  />
                </Field>

                <Field label="Event fee">
                  <select
                    value={form.payment_type}
                    onChange={(e) => {
                      const value = e.target.value as
                        | "free"
                        | "paid";

                      updateForm("payment_type", value);

                      if (value === "free") {
                        updateForm("registration_fee", "0");
                      }
                    }}
                    className={inputClass}
                  >
                    <option value="free">Free</option>
                    <option value="paid">Paid</option>
                  </select>
                </Field>

                {form.payment_type === "paid" && (
                  <>
                    <Field label="Registration fee (₹)">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        required
                        value={form.registration_fee}
                        onChange={(e) =>
                          updateForm(
                            "registration_fee",
                            e.target.value
                          )
                        }
                        placeholder="500"
                        className={inputClass}
                      />
                    </Field>

                    <Field label="Charge">
                      <select
                        value={form.payment_unit}
                        onChange={(e) =>
                          updateForm(
                            "payment_unit",
                            e.target.value as
                              | "per_student"
                              | "per_team"
                          )
                        }
                        className={inputClass}
                      >
                        <option value="per_student">
                          Per student
                        </option>
                        <option value="per_team">
                          Per team
                        </option>
                      </select>
                    </Field>
                  </>
                )}

                {form.registration_type === "team" && (
                  <>
                    <Field label="Minimum team size">
                      <input
                        type="number"
                        min="1"
                        value={form.min_team_size}
                        onChange={(e) =>
                          updateForm(
                            "min_team_size",
                            e.target.value
                          )
                        }
                        placeholder="2"
                        className={inputClass}
                      />
                    </Field>

                    <Field label="Maximum team size">
                      <input
                        type="number"
                        min="1"
                        value={form.max_team_size}
                        onChange={(e) =>
                          updateForm(
                            "max_team_size",
                            e.target.value
                          )
                        }
                        placeholder="4"
                        className={inputClass}
                      />
                    </Field>
                  </>
                )}

                <div className="md:col-span-2">
                  <Field label="Description">
                    <textarea
                      value={form.description}
                      onChange={(e) =>
                        updateForm(
                          "description",
                          e.target.value
                        )
                      }
                      rows={5}
                      placeholder="Describe the event..."
                      className={`${inputClass} resize-none`}
                    />
                  </Field>
                </div>
              </div>

              {/* SETTINGS */}

              <div className="mt-7 rounded-[22px] bg-black/[0.035] p-5">
                <p className="mb-5 text-[10px] font-semibold uppercase tracking-[0.2em] text-black/35">
                  Event settings
                </p>

                <div className="space-y-4">
                  <ToggleRow
                    title="Registration open"
                    description="Participants can register for this event."
                    checked={form.registration_open}
                    onChange={(value) =>
                      updateForm(
                        "registration_open",
                        value
                      )
                    }
                  />

                  <ToggleRow
                    title="Event active"
                    description="Show this event on the public website."
                    checked={form.active}
                    onChange={(value) =>
                      updateForm("active", value)
                    }
                  />
                </div>
              </div>

              <div className="mt-8 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeForm}
                  disabled={saving}
                  className="rounded-full border border-black/10 px-6 py-3 text-sm text-black"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="flex min-w-[140px] items-center justify-center gap-2 rounded-full bg-black px-7 py-3 text-sm text-white disabled:opacity-50"
                >
                  {saving && (
                    <RefreshCw
                      size={14}
                      className="animate-spin"
                    />
                  )}

                  {saving
                    ? "Saving..."
                    : editingEvent
                    ? "Save changes"
                    : "Create event"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

const inputClass =
  "w-full rounded-[14px] border border-black/[0.08] bg-black/[0.025] px-4 py-3.5 text-sm text-black placeholder:text-black/35 outline-none transition focus:border-black/25 focus:bg-white";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.18em] text-black/40">
        {label}
      </span>

      {children}
    </label>
  );
}

function StatCard({
  title,
  value,
  dark = false,
}: {
  title: string;
  value: number;
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
      <p
        className={`text-[10px] uppercase tracking-[0.2em] ${
          dark ? "text-white/40" : "text-black/40"
        }`}
      >
        {title}
      </p>

      <p className="mt-4 text-4xl font-semibold">
        {value}
      </p>
    </div>
  );
}

function InfoRow({
  icon,
  value,
}: {
  icon: React.ReactNode;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 text-sm text-neutral-700">
      <span className="text-neutral-500">{icon}</span>
      <span>{value}</span>
    </div>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-5">
      <div>
        <p className="text-sm font-medium text-black">{title}</p>

        <p className="mt-1 text-xs text-black/40">
          {description}
        </p>
      </div>

      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${
          checked ? "bg-black" : "bg-black/15"
        }`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${
            checked ? "left-6" : "left-1"
          }`}
        />
      </button>
    </div>
  );
}

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(
    "en-IN",
    {
      day: "numeric",
      month: "short",
      year: "numeric",
    }
  );
}