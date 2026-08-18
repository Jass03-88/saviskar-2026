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
} from "lucide-react";

type AdminRecord = {
  user_id: string;
  role: "master" | "admin";
  created_at: string;
  email: string | null;
  auth_created_at: string | null;
  last_sign_in_at: string | null;
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

  const loadAdmins = useCallback(
    async (refresh = false) => {
      if (refresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError("");

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

  useEffect(() => {
    void loadAdmins();
  }, [loadAdmins]);

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
              role,
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

      await loadAdmins(true);
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

  async function removeAdmin(
    admin: AdminRecord
  ) {
    if (admin.role !== "admin") {
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
        await loadAdmins(true);

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
          "Normal Admin access removed."
      );

      /*
       * Then refresh from the database to make
       * sure the UI and database are synchronized.
       */
      await loadAdmins(true);
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

  const masters =
    admins.filter(
      (admin) =>
        admin.role === "master"
    );

  const normalAdmins =
    admins.filter(
      (admin) =>
        admin.role === "admin"
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
              void loadAdmins(true)
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
                A new user will receive an
                invitation email. Existing
                Supabase users can also be
                granted Saviskar admin access.
              </p>
            </div>

          </div>

          <form
            onSubmit={addAdmin}
            className="mt-7 grid gap-4 md:grid-cols-[1fr_220px_auto]"
          >

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

          </form>
        </div>

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
                  (admin) => (
                    <AdminRow
                      key={admin.user_id}
                      admin={admin}
                      master
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
                  (admin) => (
                    <AdminRow
                      key={admin.user_id}
                      admin={admin}
                      onRemove={() =>
                        void removeAdmin(
                          admin
                        )
                      }
                      removing={
                        removingId ===
                        admin.user_id
                      }
                    />
                  )
                )}

              </div>
            )}

          </div>
        </section>

      </div>
    </main>
  );
}

function AdminRow({
  admin,
  master = false,
  onRemove,
  removing = false,
}: {
  admin: AdminRecord;
  master?: boolean;
  onRemove?: () => void;
  removing?: boolean;
}) {
  return (
    <div className="flex flex-col gap-5 p-6 md:flex-row md:items-center md:justify-between text-black">

      <div className="flex min-w-0 items-center gap-4">

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
              {master
                ? "Master"
                : "Normal"}
            </span>

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

          </div>

        </div>

      </div>

      {master ? (
        <div className="flex items-center gap-2 text-xs text-green-700">
          <ShieldCheck size={15} />
          MFA required
        </div>
      ) : (
        <button
          type="button"
          onClick={onRemove}
          disabled={removing}
          className="flex items-center justify-center gap-2 rounded-full border border-red-100 bg-red-50 px-4 py-2.5 text-xs text-red-600 transition hover:bg-red-100 disabled:opacity-50"
        >
          <Trash2 size={14} />

          {removing
            ? "Removing..."
            : "Remove access"}
        </button>
      )}

    </div>
  );
}