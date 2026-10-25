"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ShieldCheck,
  UserPlus,
  Trash2,
  RefreshCw,
  Crown,
  Building,
  Sliders,
  Layers,
  Search,
  X,
  Check,
} from "lucide-react";
import {
  parseAdminCategories,
  normalizeAdminCategory,
  formatCategoryBadgeLabel,
  getCanonicalCategoryValue,
  CATEGORY_COMBINATIONS,
  VALID_ADMIN_CATEGORIES,
  type AdminCategory,
} from "@/lib/admin/scope";

type AdminRecord = {
  user_id: string;
  role: "master" | "admin";
  accommodation_access?: boolean;
  assigned_category?: string | null;
  assigned_events?: string[];
  created_at: string;
  email: string | null;
  auth_created_at: string | null;
  last_sign_in_at: string | null;
  isPrimary?: boolean;
};

export default function AdminManagementPage() {
  const router = useRouter();

  const [admins, setAdmins] =
    useState<AdminRecord[]>([]);

  const [email, setEmail] =
    useState("");

  const [role, setRole] =
    useState<"admin" | "master">(
      "admin"
    );

  const [loading, setLoading] =
    useState(true);

  const [submitting, setSubmitting] =
    useState(false);

  const [removingId, setRemovingId] =
    useState<string | null>(null);

  const [refreshing, setRefreshing] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [error, setError] =
    useState("");

  const [isSuperMaster, setIsSuperMaster] = useState(false);
  const [changingRoleId, setChangingRoleId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [togglingAccId, setTogglingAccId] = useState<string | null>(null);

  // Event & Category scope state for adding admin
  const [eventsList, setEventsList] = useState<{ id: string; name: string; category: string }[]>([]);
  const [assignedCategory, setAssignedCategory] = useState<string>("all");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [showEventPicker, setShowEventPicker] = useState(false);
  const [addSearch, setAddSearch] = useState("");

  // Edit Scope modal state
  const [editingScopeAdmin, setEditingScopeAdmin] = useState<AdminRecord | null>(null);
  const [editScopeCategory, setEditScopeCategory] = useState<string>("all");
  const [editScopeEvents, setEditScopeEvents] = useState<string[]>([]);
  const [savingScope, setSavingScope] = useState(false);
  const [scopeSearch, setScopeSearch] = useState("");
  const [scopeModalError, setScopeModalError] = useState("");

  function toggleAddCategory(cat: AdminCategory) {
    const current = parseAdminCategories(assignedCategory);
    const next = current.includes(cat)
      ? current.filter((c) => c !== cat)
      : [...current, cat];
    const normalized = normalizeAdminCategory(next) ?? "all";
    setAssignedCategory(normalized);
    const active = parseAdminCategories(normalized);
    if (active.length > 0) {
      setSelectedEvents((prev) =>
        prev.filter((id) => {
          const ev = eventsList.find((item) => item.id === id);
          return ev && active.includes(ev.category?.toLowerCase() as AdminCategory);
        })
      );
    }
  }

  function toggleEditCategory(cat: AdminCategory) {
    const current = parseAdminCategories(editScopeCategory);
    const next = current.includes(cat)
      ? current.filter((c) => c !== cat)
      : [...current, cat];
    const normalized = normalizeAdminCategory(next) ?? "all";
    setEditScopeCategory(normalized);
    const active = parseAdminCategories(normalized);
    if (active.length > 0) {
      setEditScopeEvents((prev) =>
        prev.filter((id) => {
          const ev = eventsList.find((item) => item.id === id);
          return ev && active.includes(ev.category?.toLowerCase() as AdminCategory);
        })
      );
    }
  }

  const loadAdmins = useCallback(
    async () => {
      try {
        const response =
          await fetch(
            "/api/admin/admins",
            {
              cache: "no-store",
            }
          );

        if (response.status === 401) {
          router.replace(
            "/admin/login"
          );
          return;
        }

        if (response.status === 403) {
          router.replace("/admin");
          return;
        }

        const payload =
          (await response.json()) as {
            admins?: AdminRecord[];
            isSuperMaster?: boolean;
            error?: string;
          };

        if (!response.ok) {
          throw new Error(
            payload.error ??
              "Could not load administrators."
          );
        }

        setAdmins(
          payload.admins ?? []
        );
        setIsSuperMaster(payload.isSuperMaster ?? false);
      } catch (loadError) {
        console.error(
          "ADMIN MANAGEMENT LOAD ERROR:",
          loadError
        );

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load administrators."
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router]
  );

  const refreshAdmins = useCallback(async () => {
    setRefreshing(true);
    setError("");
    await loadAdmins();
  }, [loadAdmins]);

  const loadEvents = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/events", { cache: "no-store" });
      if (response.ok) {
        const payload = (await response.json()) as {
          events?: { id: string; name: string; category?: string | null }[];
        };
        if (Array.isArray(payload.events)) {
          setEventsList(
            payload.events.map((e) => ({
              id: e.id,
              name: e.name,
              category: (e.category || "").toLowerCase(),
            }))
          );
        }
      }
    } catch {
      // safe fallback
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        void loadEvents();
        const response = await fetch("/api/admin/admins", { cache: "no-store" });
        if (response.status === 401) {
          router.replace("/admin/login");
          return;
        }
        if (response.status === 403) {
          router.replace("/admin");
          return;
        }
        const payload = (await response.json()) as {
          admins?: AdminRecord[];
          isSuperMaster?: boolean;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Could not load administrators.");
        }
        if (!ignore) {
          setAdmins(payload.admins ?? []);
          setIsSuperMaster(payload.isSuperMaster ?? false);
        }
      } catch (loadError) {
        if (!ignore) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load administrators."
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
    return () => {
      ignore = true;
    };
  }, [router, loadEvents]);

  async function addAdmin(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const cleanEmail =
      email.trim().toLowerCase();

    if (!cleanEmail) {
      setError(
        "Enter an email address."
      );
      return;
    }

    setSubmitting(true);
    setError("");
    setMessage("");

    try {
      const response =
        await fetch(
          "/api/admin/admins",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              email: cleanEmail,
              role: isSuperMaster ? role : "admin",
              assigned_category: role === "admin" && assignedCategory !== "all" ? normalizeAdminCategory(assignedCategory) : null,
              assigned_events: role === "admin" ? selectedEvents : [],
            }),
          }
        );

      const payload =
        (await response.json()) as {
          message?: string;
          error?: string;
        };

      if (!response.ok) {
        throw new Error(
          payload.error ??
            "Could not add administrator."
        );
      }

      setMessage(
        payload.message ??
          "Administrator added successfully."
      );

      setEmail("");
      setRole("admin");
      setAssignedCategory("all");
      setSelectedEvents([]);
      setShowEventPicker(false);
      setAddSearch("");

      await refreshAdmins();
    } catch (addError) {
      console.error(
        "ADMIN ADD ERROR:",
        addError
      );

      setError(
        addError instanceof Error
          ? addError.message
          : "Could not add administrator."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function updateScope(
    admin: AdminRecord,
    newCategory: string | null,
    newEvents: string[]
  ) {
    setSavingScope(true);
    setScopeModalError("");
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/admins/${encodeURIComponent(admin.user_id)}/scope`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assigned_category: newCategory === "all" ? null : normalizeAdminCategory(newCategory),
            assigned_events: newEvents,
          }),
        }
      );

      const payload = (await response.json()) as {
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        const errMsg = payload.error ?? "Could not update administrator scope.";
        setScopeModalError(errMsg);
        return;
      }

      setMessage(
        payload.message ?? "Administrator scope updated successfully."
      );
      setEditingScopeAdmin(null);
      await refreshAdmins();
    } catch (scopeError) {
      const errMsg =
        scopeError instanceof Error
          ? scopeError.message
          : "Could not update administrator scope.";
      setScopeModalError(errMsg);
    } finally {
      setSavingScope(false);
    }
  }

  async function removeAdmin(
    admin: AdminRecord
  ) {
    if (admin.isPrimary) {
      return;
    }

    if (admin.role === "master" && !isSuperMaster) {
      return;
    }

    const confirmed =
      window.confirm(
        `Remove ${admin.email ?? "this administrator"} from Saviskar admin access?`
      );

    if (!confirmed) {
      return;
    }

    setRemovingId(
      admin.user_id
    );

    setError("");
    setMessage("");

    try {
      const response =
        await fetch(
          `/api/admin/admins?userId=${encodeURIComponent(
            admin.user_id
          )}`,
          {
            method: "DELETE",
          }
        );

      const payload =
        (await response.json()) as {
          message?: string;
          error?: string;
        };

      /*
       * If the administrator was already removed
       * from the database, simply remove the stale
       * entry from the UI instead of showing an error.
       */
      if (response.status === 404) {
        setAdmins((currentAdmins) =>
          currentAdmins.filter(
            (currentAdmin) =>
              currentAdmin.user_id !==
              admin.user_id
          )
        );

        setMessage(
          `${admin.email ?? "Administrator"} was already removed from Saviskar admin access.`
        );

        /*
         * Sync with the database after removing
         * the stale UI entry.
         */
        await refreshAdmins();

        return;
      }

      if (!response.ok) {
        throw new Error(
          payload.error ??
            "Could not remove administrator."
        );
      }

      /*
       * Remove immediately from the local UI.
       * This makes the interface feel instant.
       */
      setAdmins((currentAdmins) =>
        currentAdmins.filter(
          (currentAdmin) =>
            currentAdmin.user_id !==
            admin.user_id
        )
      );

      setMessage(
        payload.message ??
          "Administrator access removed."
      );

      /*
       * Then refresh from the database to make
       * sure the UI and database are synchronized.
       */
      await refreshAdmins();
    } catch (removeError) {
      console.error(
        "ADMIN REMOVE ERROR:",
        removeError
      );

      setError(
        removeError instanceof Error
          ? removeError.message
          : "Could not remove administrator."
      );
    } finally {
      setRemovingId(null);
    }
  }

  async function changeRole(admin: AdminRecord, newRole: "master" | "admin") {
    if (!isSuperMaster || admin.isPrimary) return;

    const actionStr = newRole === "master" ? "Promote" : "Demote";
    const confirmed = window.confirm(
      `${actionStr} ${admin.email ?? "this administrator"} ${newRole === "master" ? "to Master Admin" : "to Normal Admin"}?`
    );

    if (!confirmed) return;

    setChangingRoleId(admin.user_id);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/admin/admins", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: admin.user_id, newRole }),
      });

      const payload = (await response.json()) as { message?: string; error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? `Could not ${actionStr.toLowerCase()} administrator.`);
      }

      setMessage(payload.message ?? `Administrator ${actionStr.toLowerCase()}d successfully.`);
      await refreshAdmins();
    } catch (err) {
      console.error(`ADMIN ${actionStr.toUpperCase()} ERROR:`, err);
      setError(err instanceof Error ? err.message : `Could not ${actionStr.toLowerCase()} administrator.`);
    } finally {
      setChangingRoleId(null);
    }
  }

  async function resetPassword(admin: AdminRecord) {
    const confirmed = window.confirm(
      `Send password reset email to ${admin.email ?? "this administrator"}?`
    );
    if (!confirmed) return;

    setResettingId(admin.user_id);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/admin/admins/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: admin.user_id }),
      });

      const payload = (await response.json()) as { message?: string; error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not send password reset email.");
      }

      setMessage(payload.message ?? "Password reset email sent successfully.");
    } catch (err) {
      console.error("ADMIN RESET PASSWORD ERROR:", err);
      setError(err instanceof Error ? err.message : "Could not send password reset email.");
    } finally {
      setResettingId(null);
    }
  }

  async function toggleAccommodationAccess(admin: AdminRecord) {
    if (admin.isPrimary) return;
    if (admin.role === "master" && !isSuperMaster) return;

    const currentAccess = admin.accommodation_access ?? false;
    const newAccess = !currentAccess;
    const actionVerb = newAccess ? "Grant" : "Revoke";

    const confirmed = window.confirm(
      `${actionVerb} accommodation access ${newAccess ? "to" : "from"} ${admin.email ?? "this administrator"}?`
    );

    if (!confirmed) return;

    setTogglingAccId(admin.user_id);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/admins/${encodeURIComponent(admin.user_id)}/accommodation-access`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accommodationAccess: newAccess }),
        }
      );

      const payload = (await response.json()) as {
        success?: boolean;
        accommodationAccess?: boolean;
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not update accommodation access.");
      }

      setMessage(
        newAccess
          ? `Accommodation access enabled for ${admin.email ?? "administrator"}`
          : `Accommodation access disabled for ${admin.email ?? "administrator"}`
      );

      // Optimistically update local state
      setAdmins((currentAdmins) =>
        currentAdmins.map((item) =>
          item.user_id === admin.user_id
            ? { ...item, accommodation_access: newAccess }
            : item
        )
      );

      await refreshAdmins();
    } catch (toggleError) {
      console.error("ADMIN ACCOMMODATION TOGGLE ERROR:", toggleError);
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "Could not update accommodation access."
      );
    } finally {
      setTogglingAccId(null);
    }
  }

  const primaryMasters = admins.filter((admin) => admin.isPrimary);
  const masters = admins.filter(
    (admin) => admin.role === "master" && !admin.isPrimary
  );

  const normalAdmins = admins.filter(
    (admin) => admin.role === "admin" && !admin.isPrimary
  );

  return (
    <main className="min-h-screen bg-[#f5f5f5] px-5 py-10 md:px-10 lg:px-16">
      <div className="mx-auto max-w-[1200px]">

        <div className="mb-10 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">

          <div>
            <button
              type="button"
              onClick={() =>
                router.push("/admin")
              }
              className="mb-5 flex items-center gap-2 text-sm text-black/50 transition hover:text-black"
            >
              <ArrowLeft size={15} />
              Back to registrations
            </button>

            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-black/40">
              Saviskar 2026
            </p>

            <h1 className="text-4xl font-semibold tracking-[-0.05em] text-black md:text-6xl">
              Admin Management
            </h1>

            <p className="mt-4 max-w-xl text-sm text-black/45">
              Manage Master Admins and
              registration-desk administrators.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              void refreshAdmins()
            }
            disabled={refreshing}
            className="flex items-center justify-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm text-black/70 transition hover:bg-black/[0.03] disabled:opacity-50"
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
        </div>

        {error && (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {message && (
          <div className="mb-6 rounded-2xl border border-green-200 bg-green-50 px-5 py-4 text-sm text-green-700">
            {message}
          </div>
        )}

        <div className="mb-8 rounded-[28px] bg-black p-7 text-white md:p-9">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10">
              <UserPlus size={19} />
            </div>

            <div>
              <h2 className="text-xl font-semibold">
                Add Administrator
              </h2>

              <p className="mt-2 text-sm text-white/50">
                {isSuperMaster
                  ? "A new user will receive an invitation email. Existing Supabase users can also be granted Saviskar admin access."
                  : "Add registration-desk administrators. Master Admin creation is restricted to the Primary Master."}
              </p>
            </div>
          </div>

          <form
            onSubmit={addAdmin}
            className="mt-7 space-y-4"
          >
            <div className="grid gap-4 md:grid-cols-[1fr_220px_auto]">
              <input
                type="email"
                value={email}
                onChange={(event) =>
                  setEmail(
                    event.target.value
                  )
                }
                placeholder="admin@example.com"
                autoComplete="off"
                className="rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/30"
              />

              {isSuperMaster ? (
                <select
                  value={role}
                  onChange={(event) =>
                    setRole(
                      event.target.value as
                        | "admin"
                        | "master"
                    )
                  }
                  className="rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none focus:border-white/30"
                >
                  <option
                    value="admin"
                    className="text-black"
                  >
                    Normal Admin
                  </option>

                  <option
                    value="master"
                    className="text-black"
                  >
                    Master Admin
                  </option>
                </select>
              ) : (
                <select
                  value="admin"
                  disabled
                  className="rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white/60 outline-none cursor-not-allowed"
                >
                  <option
                    value="admin"
                    className="text-black"
                  >
                    Normal Admin
                  </option>
                </select>
              )}

              <button
                type="submit"
                disabled={
                  submitting ||
                  !email.trim()
                }
                className="flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-40"
              >
                <UserPlus size={15} />

                {submitting
                  ? "Adding..."
                  : "Add Admin"}
              </button>
            </div>

            {role === "admin" && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-xs">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-medium text-white/80">
                      <Layers size={14} className="text-white/60" />
                      <span>Admin Permissions & Event Scope (Optional)</span>
                    </div>
                    <span className="text-[11px] text-white/40">
                      Default: Unrestricted access to all events and categories
                    </span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <label className="block text-[11px] text-white/60">
                          Category Scope
                        </label>
                        <span className="text-[10px] text-white/40">
                          {formatCategoryBadgeLabel(assignedCategory)}
                        </span>
                      </div>
                      <select
                        value={getCanonicalCategoryValue(assignedCategory)}
                        onChange={(e) => {
                          const val = e.target.value;
                          setAssignedCategory(val);
                          const active = parseAdminCategories(val);
                          if (active.length > 0) {
                            setSelectedEvents((prev) =>
                              prev.filter((id) => {
                                const ev = eventsList.find((item) => item.id === id);
                                return ev && active.includes(ev.category?.toLowerCase() as AdminCategory);
                              })
                            );
                          }
                        }}
                        className="w-full rounded-xl border border-white/10 bg-white/10 px-3.5 py-2.5 text-xs text-white outline-none focus:border-white/30"
                      >
                        {CATEGORY_COMBINATIONS.map((c) => (
                          <option key={c.value} value={c.value} className="text-black">
                            {c.label}
                          </option>
                        ))}
                      </select>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] text-white/40">Toggle:</span>
                        {VALID_ADMIN_CATEGORIES.map((cat) => {
                          const isCatActive = parseAdminCategories(assignedCategory).includes(cat);
                          const label = cat === "technical" ? "Technical" : cat === "cultural" ? "Cultural" : "Non-Technical";
                          return (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => toggleAddCategory(cat)}
                              className={`rounded-lg px-2 py-0.5 text-[10px] font-medium transition ${
                                isCatActive
                                  ? "bg-purple-500/30 text-purple-200 border border-purple-400/50"
                                  : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10 hover:text-white/80"
                              }`}
                            >
                              {isCatActive ? "✓ " : "+ "}{label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] text-white/60">
                        Specific Events Scope
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowEventPicker(!showEventPicker)}
                        className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/10 px-3.5 py-2.5 text-left text-xs text-white/90 transition hover:bg-white/15"
                      >
                        <span className="truncate">
                          {selectedEvents.length === 0
                            ? (parseAdminCategories(assignedCategory).length === 0
                                ? "All events (Unrestricted)"
                                : `All ${formatCategoryBadgeLabel(assignedCategory)} events`)
                            : `${selectedEvents.length} event${selectedEvents.length > 1 ? "s" : ""} selected`}
                        </span>
                        <span className="ml-2 text-[10px] text-white/50">
                          {showEventPicker ? "Hide ▲" : "Configure ▼"}
                        </span>
                      </button>
                    </div>
                  </div>

                  {showEventPicker && (
                    <div className="mt-1 rounded-xl border border-white/10 bg-black/60 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2 border-b border-white/10 pb-2">
                        <div className="relative flex-1">
                          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40" />
                          <input
                            type="text"
                            placeholder="Filter events..."
                            value={addSearch}
                            onChange={(e) => setAddSearch(e.target.value)}
                            className="w-full rounded-lg bg-white/10 py-1.5 pl-8 pr-3 text-xs text-white placeholder:text-white/30 outline-none"
                          />
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              const active = parseAdminCategories(assignedCategory);
                              const filtered = eventsList
                                .filter((ev) => active.length === 0 || active.includes(ev.category?.toLowerCase() as AdminCategory))
                                .map((ev) => ev.id);
                              setSelectedEvents(filtered);
                            }}
                            className="rounded bg-white/10 px-2 py-1 text-[10px] font-medium text-white/80 transition hover:bg-white/20"
                          >
                            Select All
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedEvents([])}
                            className="rounded bg-white/10 px-2 py-1 text-[10px] font-medium text-white/60 transition hover:bg-white/20"
                          >
                            Clear All
                          </button>
                        </div>
                      </div>

                      <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                        {eventsList
                          .filter((ev) => {
                            const active = parseAdminCategories(assignedCategory);
                            return active.length === 0 || active.includes(ev.category?.toLowerCase() as AdminCategory);
                          })
                          .filter((ev) => !addSearch || ev.name.toLowerCase().includes(addSearch.toLowerCase()))
                          .map((ev) => {
                            const isChecked = selectedEvents.includes(ev.id);
                            return (
                              <label
                                key={ev.id}
                                className="flex cursor-pointer items-center gap-2.5 rounded p-1.5 text-xs transition hover:bg-white/5"
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedEvents([...selectedEvents, ev.id]);
                                    } else {
                                      setSelectedEvents(selectedEvents.filter((id) => id !== ev.id));
                                    }
                                  }}
                                  className="rounded border-white/20 bg-white/10 text-black focus:ring-0"
                                />
                                <span className="flex-1 truncate text-white/90">{ev.name}</span>
                                <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white/40">
                                  {ev.category}
                                </span>
                              </label>
                            );
                          })}
                        {eventsList
                          .filter((ev) => {
                            const active = parseAdminCategories(assignedCategory);
                            return active.length === 0 || active.includes(ev.category?.toLowerCase() as AdminCategory);
                          })
                          .filter((ev) => !addSearch || ev.name.toLowerCase().includes(addSearch.toLowerCase())).length === 0 && (
                          <p className="py-3 text-center text-[11px] text-white/40">No events match filter</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </form>
        </div>

        {primaryMasters.length > 0 && (
          <section className="mb-8">
            <div className="mb-4 flex items-center gap-3 text-black">
              <Crown size={18} className="text-amber-500" />
              <h2 className="text-xl font-semibold text-black">
                {primaryMasters.length > 1 ? "Primary Master Admins" : "Primary Master"}
              </h2>
            </div>
            <div className="overflow-hidden rounded-[28px] bg-white">
              <div className="divide-y divide-black/[0.06]">
                {primaryMasters.map((pm) => (
                  <AdminRow
                    key={pm.user_id}
                    admin={pm}
                    master
                    isSuperMaster={isSuperMaster}
                    onResetPassword={() => resetPassword(pm)}
                    resetting={resettingId === pm.user_id}
                  />
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="mb-8">

          <div className="mb-4 flex items-center gap-3 text-black">

            <Crown size={18} />

            <h2 className="text-xl font-semibold text-black">
              Master Admins
            </h2>

            <span className="rounded-full bg-black/[0.05] px-3 py-1 text-xs text-black/50">
              {masters.length}
            </span>

          </div>

          <div className="overflow-hidden rounded-[28px] bg-white">

            {loading ? (
              <div className="p-8 text-sm text-black/40">
                Loading administrators...
              </div>
            ) : masters.length === 0 ? (
              <div className="p-8 text-sm text-black/40">
                No Master Admins found.
              </div>
            ) : (
              <div className="divide-y divide-black/[0.06]">

                {masters.map(
                  (admin, idx) => (
                    <AdminRow
                      key={admin.user_id}
                      serialNumber={idx + 1}
                      admin={admin}
                      master
                      isSuperMaster={isSuperMaster}
                      onRemove={() => removeAdmin(admin)}
                      onRoleChange={(newRole) => changeRole(admin, newRole)}
                      onResetPassword={() => resetPassword(admin)}
                      onToggleAccommodation={() => toggleAccommodationAccess(admin)}
                      removing={removingId === admin.user_id}
                      changingRole={changingRoleId === admin.user_id}
                      resetting={resettingId === admin.user_id}
                      togglingAcc={togglingAccId === admin.user_id}
                    />
                  )
                )}

              </div>
            )}

          </div>
        </section>

        <section>

          <div className="mb-4 flex items-center gap-3 text-black">

            <ShieldCheck size={18} />

            <h2 className="text-xl font-semibold text-black">
              Normal Admins
            </h2>

            <span className="rounded-full bg-black/[0.05] px-3 py-1 text-xs text-black/50">
              {normalAdmins.length}
            </span>

          </div>

          <div className="overflow-hidden rounded-[28px] bg-white">

            {loading ? (
              <div className="p-8 text-sm text-black/40">
                Loading administrators...
              </div>
            ) : normalAdmins.length === 0 ? (
              <div className="p-8">

                <p className="text-sm text-black/40">
                  No Normal Admins have been
                  added yet.
                </p>

                <p className="mt-2 text-xs text-black/30">
                  Add registration-desk
                  administrators using the form
                  above.
                </p>

              </div>
            ) : (
              <div className="divide-y divide-black/[0.06]">

                {normalAdmins.map(
                  (admin, idx) => (
                    <AdminRow
                      key={admin.user_id}
                      serialNumber={idx + 1}
                      admin={admin}
                      isSuperMaster={isSuperMaster}
                      eventsList={eventsList}
                      onEditScope={() => {
                        setEditingScopeAdmin(admin);
                        setEditScopeCategory(admin.assigned_category ? getCanonicalCategoryValue(admin.assigned_category) : "all");
                        setEditScopeEvents(admin.assigned_events || []);
                        setScopeSearch("");
                        setScopeModalError("");
                      }}
                      onRemove={() =>
                        void removeAdmin(
                          admin
                        )
                      }
                      onRoleChange={(newRole) => changeRole(admin, newRole)}
                      onResetPassword={() => resetPassword(admin)}
                      onToggleAccommodation={() => toggleAccommodationAccess(admin)}
                      removing={
                        removingId ===
                        admin.user_id
                      }
                      changingRole={changingRoleId === admin.user_id}
                      resetting={resettingId === admin.user_id}
                      togglingAcc={togglingAccId === admin.user_id}
                    />
                  )
                )}

              </div>
            )}

          </div>
        </section>

      </div>

      {editingScopeAdmin && (
        <div data-lenis-prevent="true" className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl md:p-8">
            <button
              type="button"
              onClick={() => setEditingScopeAdmin(null)}
              disabled={savingScope}
              className="absolute right-5 top-5 rounded-full p-2 text-black/40 transition hover:bg-black/5 hover:text-black"
            >
              <X size={18} />
            </button>

            <div className="mb-6">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-black/40">
                Scope Configuration
              </span>
              <h3 className="mt-1 text-2xl font-bold tracking-tight text-black">
                Edit Admin Scope
              </h3>
              <p className="mt-1 text-sm text-black/50">
                Restricting scope for <strong className="text-black">{editingScopeAdmin.email}</strong>
              </p>
            </div>

            <div className="space-y-5">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-semibold text-black/70">
                    Category Scope
                  </label>
                  <span className="text-[11px] font-medium text-purple-700">
                    {formatCategoryBadgeLabel(editScopeCategory)}
                  </span>
                </div>
                <select
                  value={getCanonicalCategoryValue(editScopeCategory)}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEditScopeCategory(val);
                    const active = parseAdminCategories(val);
                    if (active.length > 0) {
                      setEditScopeEvents((prev) =>
                        prev.filter((id) => {
                          const ev = eventsList.find((item) => item.id === id);
                          return ev && active.includes(ev.category?.toLowerCase() as AdminCategory);
                        })
                      );
                    }
                  }}
                  className="w-full rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 text-sm text-black outline-none focus:border-black/30"
                >
                  {CATEGORY_COMBINATIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-black/40">Toggle:</span>
                  {VALID_ADMIN_CATEGORIES.map((cat) => {
                    const isCatActive = parseAdminCategories(editScopeCategory).includes(cat);
                    const label = cat === "technical" ? "Technical" : cat === "cultural" ? "Cultural" : "Non-Technical";
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => toggleEditCategory(cat)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                          isCatActive
                            ? "bg-purple-100 text-purple-800 border border-purple-300"
                            : "bg-black/[0.04] text-black/60 border border-black/10 hover:bg-black/[0.08]"
                        }`}
                      >
                        {isCatActive ? "✓ " : "+ "}{label}
                      </button>
                    );
                  })}
                </div>

                <p className="mt-1 text-[11px] text-black/40">
                  Restricts this administrator to only see registrations and check-in attendees for the selected categories.
                </p>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-semibold text-black/70">
                    Specific Events ({editScopeEvents.length} selected)
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const active = parseAdminCategories(editScopeCategory);
                        const filtered = eventsList
                          .filter((ev) => active.length === 0 || active.includes(ev.category?.toLowerCase() as AdminCategory))
                          .map((ev) => ev.id);
                        setEditScopeEvents(filtered);
                      }}
                      className="text-[11px] font-medium text-black/60 underline transition hover:text-black"
                    >
                      Select All
                    </button>
                    <span className="text-black/20">•</span>
                    <button
                      type="button"
                      onClick={() => setEditScopeEvents([])}
                      className="text-[11px] font-medium text-black/60 underline transition hover:text-black"
                    >
                      Clear All
                    </button>
                  </div>
                </div>

                <div className="relative mb-2">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/30" />
                  <input
                    type="text"
                    placeholder="Search events..."
                    value={scopeSearch}
                    onChange={(e) => setScopeSearch(e.target.value)}
                    className="w-full rounded-xl border border-black/10 bg-black/[0.02] py-2 pl-9 pr-3 text-xs text-black placeholder:text-black/30 outline-none focus:border-black/30"
                  />
                </div>

                <div className="max-h-56 divide-y divide-black/[0.04] overflow-y-auto rounded-xl border border-black/10 p-2">
                  {eventsList
                    .filter((ev) => {
                      const active = parseAdminCategories(editScopeCategory);
                      return active.length === 0 || active.includes(ev.category?.toLowerCase() as AdminCategory);
                    })
                    .filter((ev) => !scopeSearch || ev.name.toLowerCase().includes(scopeSearch.toLowerCase()))
                    .map((ev) => {
                      const isChecked = editScopeEvents.includes(ev.id);
                      return (
                        <label
                          key={ev.id}
                          className="flex cursor-pointer items-center justify-between gap-3 rounded-lg p-2 text-xs transition hover:bg-black/[0.02]"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setEditScopeEvents([...editScopeEvents, ev.id]);
                                } else {
                                  setEditScopeEvents(editScopeEvents.filter((id) => id !== ev.id));
                                }
                              }}
                              className="rounded border-black/20 text-black focus:ring-0"
                            />
                            <span className="truncate font-medium text-black/80">{ev.name}</span>
                          </div>
                          <span className="shrink-0 rounded bg-black/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase text-black/40">
                            {ev.category}
                          </span>
                        </label>
                      );
                    })}
                  {eventsList
                    .filter((ev) => {
                      const active = parseAdminCategories(editScopeCategory);
                      return active.length === 0 || active.includes(ev.category?.toLowerCase() as AdminCategory);
                    })
                    .filter((ev) => !scopeSearch || ev.name.toLowerCase().includes(scopeSearch.toLowerCase())).length === 0 && (
                    <p className="py-4 text-center text-xs text-black/40">No events found matching filter.</p>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-black/40">
                  If no specific events are selected, the admin will have access to <strong>all</strong> events within the selected category.
                </p>
              </div>

              {scopeModalError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-900">
                  <p className="font-semibold text-red-900">Setup Required in Supabase:</p>
                  <p className="mt-1 font-mono text-[11px] leading-relaxed break-all bg-white/70 p-2 rounded-lg border border-red-100 text-red-800">
                    {scopeModalError}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 border-t border-black/[0.06] pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setEditingScopeAdmin(null);
                    setScopeModalError("");
                  }}
                  disabled={savingScope}
                  className="rounded-full border border-black/10 bg-white px-5 py-2.5 text-xs font-medium text-black/70 transition hover:bg-black/[0.03] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void updateScope(
                      editingScopeAdmin,
                      editScopeCategory === "all" ? null : editScopeCategory,
                      editScopeEvents
                    );
                  }}
                  disabled={savingScope}
                  className="flex items-center gap-2 rounded-full bg-black px-6 py-2.5 text-xs font-semibold text-white shadow-md transition hover:bg-black/90 disabled:opacity-50"
                >
                  {savingScope ? "Saving..." : "Save Scope"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function AdminRow({
  admin,
  serialNumber,
  master = false,
  onRemove,
  onRoleChange,
  onToggleAccommodation,
  onEditScope,
  eventsList = [],
  removing = false,
  changingRole = false,
  togglingAcc = false,
  isSuperMaster = false,
  onResetPassword,
  resetting = false,
}: {
  admin: AdminRecord;
  serialNumber?: number;
  master?: boolean;
  onRemove?: () => void;
  onRoleChange?: (newRole: "master" | "admin") => void;
  onToggleAccommodation?: () => void;
  onEditScope?: () => void;
  eventsList?: { id: string; name: string; category: string }[];
  removing?: boolean;
  changingRole?: boolean;
  togglingAcc?: boolean;
  isSuperMaster?: boolean;
  onResetPassword?: () => void;
  resetting?: boolean;
}) {
  const isPrimary = admin.isPrimary ?? false;

  return (
    <div className="flex flex-col gap-5 p-6 md:flex-row md:items-center md:justify-between text-black">

      <div className="flex min-w-0 items-center gap-4">

        {serialNumber !== undefined && (
          <span className="font-mono text-xs font-semibold text-black/40 w-6 shrink-0">
            {serialNumber}
          </span>
        )}

        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/[0.05]">

          {master ? (
            <Crown size={17} />
          ) : (
            <ShieldCheck size={17} />
          )}

        </div>

        <div className="min-w-0">

          <div className="flex flex-wrap items-center gap-2">

            <p className="truncate text-sm font-medium text-black">
              {admin.email ??
                "Unknown email"}
            </p>

            <span className="rounded-full bg-black/[0.05] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.15em] text-black/40">
              {isPrimary ? "Primary Master Admin" : master ? "Master" : "Normal"}
            </span>

            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.15em] ${
                admin.accommodation_access
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-black/[0.05] text-black/40 border border-black/[0.05]"
              }`}
            >
              <Building size={10} className={admin.accommodation_access ? "text-emerald-600" : "text-black/30"} />
              Acc: {admin.accommodation_access ? "ON" : "OFF"}
            </span>

            {!master && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.15em] ${
                  admin.assigned_category || (admin.assigned_events && admin.assigned_events.length > 0)
                    ? "bg-purple-50 text-purple-700 border border-purple-200"
                    : "bg-black/[0.05] text-black/50 border border-black/[0.05]"
                }`}
              >
                <Layers size={10} className={admin.assigned_category || (admin.assigned_events && admin.assigned_events.length > 0) ? "text-purple-600" : "text-black/30"} />
                {admin.assigned_events && admin.assigned_events.length > 0
                  ? `${admin.assigned_events.length} Event${admin.assigned_events.length > 1 ? "s" : ""}${admin.assigned_category ? ` (${formatCategoryBadgeLabel(admin.assigned_category)})` : ""}`
                  : admin.assigned_category
                  ? `${formatCategoryBadgeLabel(admin.assigned_category)} Category`
                  : "Scope: All Events"}
              </span>
            )}

          </div>

          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-black/35">

            <span>
              Added{" "}
              {new Date(
                admin.created_at
              ).toLocaleDateString(
                "en-IN"
              )}
            </span>

            {admin.last_sign_in_at && (
              <span>
                Last login{" "}
                {new Date(
                  admin.last_sign_in_at
                ).toLocaleDateString(
                  "en-IN"
                )}
              </span>
            )}

            {isPrimary && (
              <span className="text-black/60 font-medium">
                [Protected]
              </span>
            )}

            <span>
              Accommodation Access:{" "}
              <strong className={admin.accommodation_access ? "font-semibold text-emerald-700" : "font-normal text-black/50"}>
                {admin.accommodation_access ? "Enabled (ON)" : "Disabled (OFF)"}
              </strong>
            </span>

            {!master && (
              <span>
                Event Scope:{" "}
                <strong className="font-medium text-black/60">
                  {admin.assigned_category ? `${formatCategoryBadgeLabel(admin.assigned_category).toUpperCase()} Category` : "All Categories"}
                  {admin.assigned_events && admin.assigned_events.length > 0
                    ? ` (${admin.assigned_events.length} assigned)`
                    : " (All events)"}
                </strong>
              </span>
            )}

          </div>

        </div>

      </div>

      <div className="flex flex-wrap items-center gap-2">
        {isPrimary ? (
          <>
            {isSuperMaster && (
              <button
                type="button"
                onClick={onResetPassword}
                disabled={resetting}
                className="rounded-full border border-black/10 bg-white px-4 py-2.5 text-xs text-black/70 transition hover:bg-black/[0.03] disabled:opacity-50"
              >
                {resetting ? "Sending..." : "Reset Password"}
              </button>
            )}
            <div className="rounded-full border border-black/10 bg-black/[0.03] px-3 py-1.5 text-xs font-medium text-black/40">
              Primary Master (Protected)
            </div>
          </>
        ) : isSuperMaster ? (
          <>
            {master ? (
              <>
                <button
                  type="button"
                  onClick={onResetPassword}
                  disabled={resetting || removing || changingRole || togglingAcc}
                  className="rounded-full border border-black/10 bg-white px-4 py-2.5 text-xs text-black/70 transition hover:bg-black/[0.03] disabled:opacity-50"
                >
                  {resetting ? "Sending..." : "Reset Password"}
                </button>
                <button
                  type="button"
                  onClick={onToggleAccommodation}
                  disabled={togglingAcc || resetting || removing || changingRole}
                  className={`rounded-full border px-4 py-2.5 text-xs font-medium transition disabled:opacity-50 ${
                    admin.accommodation_access
                      ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                      : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                  }`}
                >
                  {togglingAcc
                    ? "Updating..."
                    : admin.accommodation_access
                    ? "Disable Acc"
                    : "Enable Acc"}
                </button>
                <button
                  type="button"
                  onClick={() => onRoleChange?.("admin")}
                  disabled={changingRole || removing || togglingAcc}
                  className="rounded-full border border-black/10 bg-white px-4 py-2.5 text-xs text-black/70 transition hover:bg-black/[0.03] disabled:opacity-50"
                >
                  {changingRole ? "Changing..." : "Change to Normal"}
                </button>
                <button
                  type="button"
                  onClick={onRemove}
                  disabled={removing || changingRole || togglingAcc}
                  className="flex items-center justify-center gap-2 rounded-full border border-red-100 bg-red-50 px-4 py-2.5 text-xs text-red-600 transition hover:bg-red-100 disabled:opacity-50"
                >
                  <Trash2 size={14} />
                  {removing ? "Removing..." : "Remove Master Access"}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onResetPassword}
                  disabled={resetting || removing || changingRole || togglingAcc}
                  className="rounded-full border border-black/10 bg-white px-4 py-2.5 text-xs text-black/70 transition hover:bg-black/[0.03] disabled:opacity-50"
                >
                  {resetting ? "Sending..." : "Reset Password"}
                </button>
                <button
                  type="button"
                  onClick={onToggleAccommodation}
                  disabled={togglingAcc || resetting || removing || changingRole}
                  className={`rounded-full border px-4 py-2.5 text-xs font-medium transition disabled:opacity-50 ${
                    admin.accommodation_access
                      ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                      : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                  }`}
                >
                  {togglingAcc
                    ? "Updating..."
                    : admin.accommodation_access
                    ? "Disable Acc"
                    : "Enable Acc"}
                </button>
                {onEditScope && (
                  <button
                    type="button"
                    onClick={onEditScope}
                    disabled={changingRole || removing || togglingAcc || resetting}
                    className="flex items-center justify-center gap-1.5 rounded-full border border-black/10 bg-white px-4 py-2.5 text-xs font-medium text-black/70 transition hover:bg-black/[0.03] disabled:opacity-50"
                  >
                    <Sliders size={13} />
                    Edit Scope
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onRoleChange?.("master")}
                  disabled={changingRole || removing || togglingAcc}
                  className="rounded-full border border-black/10 bg-white px-4 py-2.5 text-xs text-black/70 transition hover:bg-black/[0.03] disabled:opacity-50"
                >
                  {changingRole ? "Changing..." : "Make Master"}
                </button>
                <button
                  type="button"
                  onClick={onRemove}
                  disabled={removing || changingRole || togglingAcc}
                  className="flex items-center justify-center gap-2 rounded-full border border-red-100 bg-red-50 px-4 py-2.5 text-xs text-red-600 transition hover:bg-red-100 disabled:opacity-50"
                >
                  <Trash2 size={14} />
                  {removing ? "Removing..." : "Remove access"}
                </button>
              </>
            )}
          </>
        ) : master ? (
          <>
            <button
              type="button"
              onClick={onResetPassword}
              disabled={resetting}
              className="rounded-full border border-black/10 bg-white px-4 py-2.5 text-xs text-black/70 transition hover:bg-black/[0.03] disabled:opacity-50"
            >
              {resetting ? "Sending..." : "Reset Password"}
            </button>
            <div className="flex items-center gap-1.5 text-xs text-black/40">
              <ShieldCheck size={14} className="text-black/30" />
              <span>Master management restricted to Primary Master</span>
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onResetPassword}
              disabled={resetting || removing || togglingAcc}
              className="rounded-full border border-black/10 bg-white px-4 py-2.5 text-xs text-black/70 transition hover:bg-black/[0.03] disabled:opacity-50"
            >
              {resetting ? "Sending..." : "Reset Password"}
            </button>
            <button
              type="button"
              onClick={onToggleAccommodation}
              disabled={togglingAcc || resetting || removing}
              className={`rounded-full border px-4 py-2.5 text-xs font-medium transition disabled:opacity-50 ${
                admin.accommodation_access
                  ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                  : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
              }`}
            >
              {togglingAcc
                ? "Updating..."
                : admin.accommodation_access
                ? "Disable Acc"
                : "Enable Acc"}
            </button>
            {onEditScope && (
              <button
                type="button"
                onClick={onEditScope}
                disabled={removing || togglingAcc || resetting}
                className="flex items-center justify-center gap-1.5 rounded-full border border-black/10 bg-white px-4 py-2.5 text-xs font-medium text-black/70 transition hover:bg-black/[0.03] disabled:opacity-50"
              >
                <Sliders size={13} />
                Edit Scope
              </button>
            )}
            <button
              type="button"
              onClick={onRemove}
              disabled={removing || togglingAcc}
              className="flex items-center justify-center gap-2 rounded-full border border-red-100 bg-red-50 px-4 py-2.5 text-xs text-red-600 transition hover:bg-red-100 disabled:opacity-50"
            >
              <Trash2 size={14} />
              {removing ? "Removing..." : "Remove access"}
            </button>
          </>
        )}
      </div>

    </div>
  );
}