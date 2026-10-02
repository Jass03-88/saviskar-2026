"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
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
  created_at?: string | null;
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
  registration_limit?: number | null;
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
  registration_limit: string;
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
  registration_limit: "",
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
    .replace(/[-_]/g, " ")
    .toUpperCase();
}

type DateFilterValue = "all" | "today" | "tomorrow" | "this-week" | "this-month" | "custom";
type PaymentFilterValue = "all" | "free" | "paid";
type SortOption = "default" | "recently-added";

function isEventFree(event: EventRecord) {
  const fee = Number(event.registration_fee ?? 0);
  return fee === 0 || event.payment_unit === "free";
}

/**
 * Returns the start of today in local time as a Date.
 */
function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function matchesDateFilter(
  eventDate: string | null,
  filter: DateFilterValue,
  customFrom: string,
  customTo: string
): boolean {
  if (filter === "all") return true;

  // Specific date filter: events without a set date do not match
  if (!eventDate) return false;

  const d = new Date(`${eventDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;

  const today = todayStart();

  switch (filter) {
    case "today":
      return d.getTime() === today.getTime();
    case "tomorrow": {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return d.getTime() === tomorrow.getTime();
    }
    case "this-week": {
      // Current week: Monday to Sunday
      const dayOfWeek = today.getDay();
      const diffToMonday = (dayOfWeek + 6) % 7;
      const weekStart = new Date(today);
      weekStart.setDate(weekStart.getDate() - diffToMonday);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
      return d >= weekStart && d <= weekEnd;
    }
    case "this-month": {
      return (
        d.getMonth() === today.getMonth() &&
        d.getFullYear() === today.getFullYear()
      );
    }
    case "custom": {
      if (customFrom) {
        const from = new Date(`${customFrom}T00:00:00`);
        if (!Number.isNaN(from.getTime()) && d < from) return false;
      }
      if (customTo) {
        const to = new Date(`${customTo}T00:00:00`);
        if (!Number.isNaN(to.getTime()) && d > to) return false;
      }
      return true;
    }
    default:
      return true;
  }
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

  /* ── New filter state ────────────────────────────────────── */
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [dateFilter, setDateFilter] = useState<DateFilterValue>("all");
  const [customDateFrom, setCustomDateFrom] = useState("");
  const [customDateTo, setCustomDateTo] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilterValue>("all");
  const [sortOrder, setSortOrder] = useState<SortOption>("default");

  const loadEvents = useCallback(async (refresh = false) => {
    if (refresh) {
      setRefreshing(true);
      setError("");
    }

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
    let ignore = false;
    async function init() {
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

        if (!ignore) {
          setEvents(payload.events ?? []);
          setRole(payload.role ?? null);
          if (payload.role === "admin") {
            router.replace("/admin");
            return;
          }
        }
      } catch (loadError) {
        if (!ignore) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load events."
          );
        }
      } finally {
        if (!ignore) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void init();

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
      ignore = true;
      void supabase.removeChannel(channel);
    };
  }, [loadEvents, router]);

  /* ── Categories derived from data ────────────────────────── */
  const eventCategories = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of events) {
      const raw = e.category?.trim();
      if (raw) {
        const lower = raw.toLowerCase();
        if (!map.has(lower)) {
          map.set(lower, raw);
        }
      }
    }
    const cats = Array.from(map.values()).sort((a, b) =>
      categoryLabel(a).localeCompare(categoryLabel(b))
    );
    return ["All", ...cats];
  }, [events]);

  /* ── Category counts ─────────────────────────────────────── */
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: events.length,
      All: events.length,
    };
    for (const e of events) {
      const key = (e.category?.trim() || "other").toLowerCase();
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [events]);

  /* ── Has any filter active? ──────────────────────────────── */
  const hasActiveFilters =
    search.trim().length > 0 ||
    categoryFilter !== "All" ||
    dateFilter !== "all" ||
    customDateFrom !== "" ||
    customDateTo !== "" ||
    paymentFilter !== "all" ||
    sortOrder !== "default";

  function clearAllFilters() {
    setSearch("");
    setCategoryFilter("All");
    setDateFilter("all");
    setCustomDateFrom("");
    setCustomDateTo("");
    setPaymentFilter("all");
    setSortOrder("default");
  }

  /* ── Combined filter pipeline ────────────────────────────── */
  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase();

    const result = events.filter((event) => {
      // Search
      if (query) {
        const matches = [
          event.name,
          event.slug,
          event.category,
          event.venue,
          event.description,
        ].some((value) => value?.toLowerCase().includes(query));
        if (!matches) return false;
      }

      // Category
      if (
        categoryFilter !== "All" &&
        event.category?.trim().toLowerCase() !== categoryFilter.toLowerCase()
      ) {
        return false;
      }

      // Date
      if (!matchesDateFilter(event.event_date, dateFilter, customDateFrom, customDateTo)) {
        return false;
      }

      // Payment
      if (paymentFilter === "free" && !isEventFree(event)) return false;
      if (paymentFilter === "paid" && isEventFree(event)) return false;

      return true;
    });

    if (sortOrder === "recently-added") {
      return [...result].sort((a, b) => {
        const timeA = a.created_at ? new Date(a.created_at).getTime() : NaN;
        const timeB = b.created_at ? new Date(b.created_at).getTime() : NaN;
        const validA = !Number.isNaN(timeA);
        const validB = !Number.isNaN(timeB);

        // If both timestamps are valid, newest first (descending)
        if (validA && validB) {
          if (timeB !== timeA) return timeB - timeA;
          return (a.name ?? "").localeCompare(b.name ?? "");
        }

        // Records with missing/null created_at go safely at the end
        if (validA && !validB) return -1;
        if (!validA && validB) return 1;
        return (a.name ?? "").localeCompare(b.name ?? "");
      });
    }

    return result;
  }, [events, search, categoryFilter, dateFilter, customDateFrom, customDateTo, paymentFilter, sortOrder]);

  const stats = useMemo(
    () => ({
      total: events.length,
      active: events.filter((event) => event.active).length,
      open: events.filter((event) => event.registration_open).length,
      free: events.filter((event) => isEventFree(event)).length,
      paid: events.filter((event) => !isEventFree(event)).length,
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
      registration_limit:
        event.registration_limit?.toString() ?? "",
    });
  }

  async function saveEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;

    setSaving(true);
    setError("");

    try {
      const method = editing.id ? "PATCH" : "POST";
      const feeNumber = Number(editing.registration_fee || 0);
      const paymentUnit =
        feeNumber === 0 || editing.payment_unit === "free"
          ? null
          : editing.payment_unit;

      const response = await fetch("/api/admin/events", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...editing,
          slug: editing.slug || slugify(editing.name),
          registration_fee: feeNumber,
          payment_unit: paymentUnit,
          min_team_size:
            editing.registration_type === "team"
              ? Number(editing.min_team_size || 0) || null
              : null,
          max_team_size:
            editing.registration_type === "team"
              ? Number(editing.max_team_size || 0) || null
              : null,
          registration_limit:
            editing.registration_limit
              ? Number(editing.registration_limit) || null
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

        {/* ── STAT CARDS ────────────────────────────────────── */}
        <section className="mb-8 grid gap-4 grid-cols-2 md:grid-cols-5">
          <StatCard label="Total events" value={stats.total} dark />
          <StatCard label="Active events" value={stats.active} />
          <StatCard label="Registration open" value={stats.open} />
          <StatCard label="Free events" value={stats.free} />
          <StatCard label="Paid events" value={stats.paid} />
        </section>

        {/* ── SEARCH BAR WITH CLEAR BUTTON ─────────────────── */}
        <section className="mb-5 flex items-center gap-3 rounded-[24px] bg-white p-4 shadow-[0_20px_80px_rgba(0,0,0,0.04)]">
          <Search size={18} className="shrink-0 text-black/35" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search events, category, venue..."
            className="min-w-0 w-full bg-transparent py-2 text-sm outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/[0.06] text-black/50 transition hover:bg-black/10 hover:text-black"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </section>

        {/* ── FILTER CONTROLS ──────────────────────────────── */}
        <section className="mb-5 space-y-4 rounded-[24px] bg-white p-4 shadow-[0_20px_80px_rgba(0,0,0,0.04)]">
          {/* Category pills */}
          <div className="flex flex-wrap gap-2">
            {eventCategories.map((cat) => {
              const active = categoryFilter === cat;
              const count = categoryCounts[cat.toLowerCase()] ?? categoryCounts[cat] ?? 0;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`shrink-0 rounded-full px-4 py-2 text-xs font-medium tracking-wide transition-all ${
                    active
                      ? "bg-black text-white"
                      : "border border-black/10 bg-transparent text-black/60 hover:border-black/25 hover:text-black"
                  }`}
                >
                  {categoryLabel(cat)} {count}
                </button>
              );
            })}
          </div>

          {/* Filter & Sort row */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Sort filter */}
            <div className="relative">
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as SortOption)}
                aria-label="Sort events"
                className="appearance-none rounded-full border border-black/10 bg-white py-2 pl-4 pr-9 text-xs font-medium text-black/70 outline-none transition hover:border-black/25 focus:border-black/35"
              >
                <option value="default">Sort: Default</option>
                <option value="recently-added">Sort: Recently added</option>
              </select>
              <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-black/35" />
            </div>

            {/* Date filter */}
            <div className="relative">
              <select
                value={dateFilter}
                onChange={(e) => {
                  const val = e.target.value as DateFilterValue;
                  setDateFilter(val);
                  if (val !== "custom") {
                    setCustomDateFrom("");
                    setCustomDateTo("");
                  }
                }}
                className="appearance-none rounded-full border border-black/10 bg-white py-2 pl-4 pr-9 text-xs font-medium text-black/70 outline-none transition hover:border-black/25 focus:border-black/35"
              >
                <option value="all">All dates</option>
                <option value="today">Today</option>
                <option value="tomorrow">Tomorrow</option>
                <option value="this-week">This week</option>
                <option value="this-month">This month</option>
                <option value="custom">Custom range</option>
              </select>
              <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-black/35" />
            </div>

            {/* Custom date inputs */}
            {dateFilter === "custom" && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-black/40">From</span>
                <input
                  type="date"
                  value={customDateFrom}
                  onChange={(e) => setCustomDateFrom(e.target.value)}
                  className="rounded-full border border-black/10 bg-white px-3 py-2 text-xs outline-none transition focus:border-black/35"
                  aria-label="From date"
                />
                <span className="text-xs text-black/40">To</span>
                <input
                  type="date"
                  value={customDateTo}
                  onChange={(e) => setCustomDateTo(e.target.value)}
                  className="rounded-full border border-black/10 bg-white px-3 py-2 text-xs outline-none transition focus:border-black/35"
                  aria-label="To date"
                />
                {(customDateFrom || customDateTo) && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomDateFrom("");
                      setCustomDateTo("");
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-black/[0.06] text-black/50 transition hover:bg-black/10 hover:text-black"
                    title="Clear date range"
                    aria-label="Clear date range"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            )}

            {/* Payment filter */}
            <div className="relative">
              <select
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value as PaymentFilterValue)}
                className="appearance-none rounded-full border border-black/10 bg-white py-2 pl-4 pr-9 text-xs font-medium text-black/70 outline-none transition hover:border-black/25 focus:border-black/35"
              >
                <option value="all">All pricing</option>
                <option value="free">Free</option>
                <option value="paid">Paid</option>
              </select>
              <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-black/35" />
            </div>

            {/* Clear all filters */}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="ml-auto flex items-center gap-1.5 rounded-full border border-black/10 px-4 py-2 text-xs font-medium text-black/50 transition hover:border-black/25 hover:text-black"
              >
                <X size={13} />
                Clear all filters
              </button>
            )}
          </div>
        </section>

        {/* ── FILTER STATUS BAR ────────────────────────────── */}
        <div className="mb-5 flex items-center justify-between px-1">
          <p className="text-xs font-medium text-black/40">
            {hasActiveFilters
              ? `Showing ${filteredEvents.length} of ${events.length} event${events.length === 1 ? "" : "s"}`
              : `${events.length} event${events.length === 1 ? "" : "s"}`}
          </p>
        </div>

        {loading ? (
          <div className="rounded-[28px] bg-white py-20 text-center text-sm text-black/40">
            Loading events…
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="rounded-[28px] bg-white py-20 text-center">
            <CalendarDays className="mx-auto text-black/20" size={38} />
            <p className="mt-4 text-sm text-black/45">
              No events found.
            </p>
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={clearAllFilters}
                className="mt-5 rounded-full border border-black/10 px-5 py-3 text-sm transition hover:bg-black/[0.04]"
              >
                Clear filters
              </button>
            ) : (
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {filteredEvents.map((event) => (
              <article
                key={event.id}
                className="flex flex-col justify-between rounded-[22px] bg-white p-4 shadow-[0_10px_40px_rgba(0,0,0,0.035)] transition-all hover:shadow-[0_16px_50px_rgba(0,0,0,0.06)] sm:p-5"
              >
                {/* Top section: Header, Description, Metadata, Badges */}
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-black/35">
                        {categoryLabel(event.category)}
                      </p>
                      <h2
                        className="mt-1 text-base font-semibold tracking-[-0.03em] leading-snug line-clamp-2"
                        title={event.name}
                      >
                        {event.name}
                      </h2>
                      <p className="mt-0.5 truncate text-[11px] text-black/35">
                        /{event.slug}
                      </p>
                    </div>

                    <span
                      className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                        event.active
                          ? "bg-emerald-500"
                          : "bg-black/15"
                      }`}
                      title={event.active ? "Active" : "Inactive"}
                    />
                  </div>

                  {event.description && (
                    <p
                      className="mt-2 text-xs leading-relaxed text-black/50 line-clamp-2"
                      title={event.description}
                    >
                      {event.description}
                    </p>
                  )}

                  <div className="mt-3.5 grid grid-cols-2 gap-x-2 gap-y-1.5 text-xs text-black/55">
                    <Info icon={<CalendarDays size={13} />} value={formatDate(event.event_date)} />
                    <Info
                      icon={<Clock3 size={13} />}
                      value={event.start_time || "Time TBA"}
                    />
                    <Info
                      icon={<MapPin size={13} />}
                      value={event.venue || "Venue TBA"}
                    />
                    <Info
                      icon={<Users size={13} />}
                      value={
                        event.registration_type === "team"
                          ? `${event.min_team_size ?? "?"}–${event.max_team_size ?? "?"} members`
                          : "Individual"
                      }
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5 pt-1">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium ${
                        event.registration_open
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-black/[0.04] text-black/50"
                      }`}
                    >
                      {event.registration_open
                        ? "Registration open"
                        : "Registration closed"}
                    </span>
                    <span className="rounded-full bg-black px-2.5 py-0.5 text-[10px] text-white">
                      {event.active ? "Active" : "Inactive"}
                    </span>
                    <span className="rounded-full bg-black/[0.04] px-2.5 py-0.5 text-[10px] text-black/50">
                      {formatFee(event)}
                    </span>
                    <span className="ml-auto text-[10px] uppercase tracking-[0.08em] text-black/35 font-medium">
                      {event.registration_count}{event.registration_limit ? `/${event.registration_limit}` : ""} registration
                      {event.registration_count === 1 ? "" : "s"}
                    </span>
                    {event.registration_limit && event.registration_count >= event.registration_limit && (
                      <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">
                        Full
                      </span>
                    )}
                  </div>
                </div>

                {/* Bottom section: Action buttons */}
                <div className="mt-4 border-t border-black/10 pt-3">
                  {role === "master" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          router.push(
                            `/admin/events/${event.id}/registrations`
                          )
                        }
                        className="flex items-center justify-center gap-1.5 rounded-full bg-black px-3 py-2 text-xs font-medium text-white transition hover:bg-black/80"
                      >
                        <Users size={13} className="shrink-0" />
                        <span className="truncate">Registrations</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(event)}
                        className="flex items-center justify-center gap-1.5 rounded-full border border-black/10 px-3 py-2 text-xs font-medium transition hover:bg-black/[0.04]"
                      >
                        <Edit3 size={13} className="shrink-0" />
                        <span>Edit</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        router.push(
                          `/admin/events/${event.id}/registrations`
                        )
                      }
                      className="flex w-full items-center justify-center gap-1.5 rounded-full bg-black px-3 py-2 text-xs font-medium text-white transition hover:bg-black/80"
                    >
                      <Users size={13} className="shrink-0" />
                      <span>Registrations</span>
                    </button>
                  )}

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
                      className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-full border border-red-100 px-3 py-1.5 text-xs text-red-500 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {deletingId === event.id ? (
                        <RefreshCw size={13} className="animate-spin" />
                      ) : (
                        <Trash2 size={13} />
                      )}
                      Delete event
                    </button>
                  )}
                </div>
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

                <Field label="Registration limit (capacity)">
                  <input
                    type="number"
                    min="0"
                    value={editing.registration_limit}
                    onChange={(event) =>
                      setEditing((current) =>
                        current
                          ? {
                              ...current,
                              registration_limit: event.target.value,
                            }
                          : current
                      )
                    }
                    className="input"
                    placeholder="Empty = unlimited"
                  />
                </Field>
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
    <div className="flex min-w-0 items-center gap-1.5" title={value}>
      <span className="shrink-0 text-black/35">{icon}</span>
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
