"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Download, Eye, LogOut, QrCode, RefreshCw, Search, Trash2, Users, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Member = { id: string; name: string; email: string | null; phone: string | null; is_team_leader: boolean | null };
type Participant = { id: string; participant_id: string; name: string; college: string | null; email: string; phone: string | null };
type ParticipantEvent = { id: string; event_id: string; payment_status: string | null; payment_amount: number | null; team_name: string | null; checked_in: boolean | null; checked_in_at: string | null; created_at: string };
type EventRecord = { id: string; name: string; category: string | null };
type Registration = { participant: Participant; registration: ParticipantEvent; event: EventRecord | null; members: Member[] };
type DashboardResponse = { registrations: Registration[]; events: EventRecord[] };

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}
function escapeCsv(value: unknown) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }

export default function AdminPage() {
  const router = useRouter();
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [eventFilter, setEventFilter] = useState("all");
  const [selected, setSelected] = useState<Registration | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadData = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/registrations", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) { router.replace("/admin/login"); return; }
      const payload = (await response.json()) as DashboardResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not load registrations.");
      setRegistrations(payload.registrations ?? []);
      setEvents(payload.events ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load registrations.");
    } finally { setLoading(false); setRefreshing(false); }
  }, [router]);

  useEffect(() => { void loadData(); }, [loadData]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return registrations.filter(({ participant, registration, event }) =>
      (eventFilter === "all" || registration.event_id === eventFilter) &&
      (!query || [participant.participant_id, participant.name, participant.email, participant.phone, participant.college, event?.name, registration.team_name].some((value) => value?.toLowerCase().includes(query)))
    );
  }, [eventFilter, registrations, search]);
  const uniqueParticipants = new Set(registrations.map(({ participant }) => participant.id)).size;
  const checkedIn = registrations.filter(({ registration }) => registration.checked_in).length;

  async function updateCheckIn(
    item: Registration,
    checkedInNext: boolean
  ) {
    setUpdatingId(item.registration.id);
    setError("");
    try {
      const response = await fetch("/api/admin/registrations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ participantEventId: item.registration.id, checkedIn: checkedInNext }) });
      const payload = await response.json() as { error?: string; registration?: { checked_in: boolean; checked_in_at: string | null } };
      if (!response.ok || !payload.registration) throw new Error(payload.error ?? "Could not update check-in status.");
      setRegistrations((current) => current.map((row) => row.registration.id === item.registration.id ? { ...row, registration: { ...row.registration, ...payload.registration } } : row));
      setSelected((current) => current?.registration.id === item.registration.id ? { ...current, registration: { ...current.registration, ...payload.registration } } : current);
    } catch (updateError) { setError(updateError instanceof Error ? updateError.message : "Could not update check-in status."); }
    finally { setUpdatingId(null); }
  }

  async function deleteRegistration(item: Registration) {
    if (!window.confirm(`Delete ${item.participant.name}'s registration for ${item.event?.name ?? "this event"}?`)) return;
    setDeletingId(item.registration.id); setError("");
    try {
      const response = await fetch(`/api/admin/registrations?participantEventId=${encodeURIComponent(item.registration.id)}`, { method: "DELETE" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not delete the event registration.");
      setRegistrations((current) => current.filter((row) => row.registration.id !== item.registration.id));
      setSelected(null);
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "Could not delete the event registration."); }
    finally { setDeletingId(null); }
  }

  function exportCsv() {
    const rows: unknown[][] = [["Participant ID", "Name", "Email", "Phone", "College", "Event", "Team", "Payment status", "Amount", "Check-in", "Registered at"]];
    filtered.forEach(({ participant, registration, event }) => rows.push([participant.participant_id, participant.name, participant.email, participant.phone ?? "", participant.college ?? "", event?.name ?? "Unknown event", registration.team_name ?? "", registration.payment_status ?? "", registration.payment_amount ?? 0, registration.checked_in ? "Checked in" : "Pending", registration.created_at]));
    const blob = new Blob([rows.map((row) => row.map(escapeCsv).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "saviskar-registrations.csv"; link.click(); URL.revokeObjectURL(link.href);
  }
  async function logout() { await supabase.auth.signOut(); router.replace("/admin/login"); }

  return <main className="min-h-screen bg-[#f7f7f5] px-4 py-8 text-zinc-900 sm:px-8"><div className="mx-auto max-w-7xl">
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium text-zinc-500">Saviskar 2026</p><h1 className="text-3xl font-bold">Registrations</h1></div><div className="flex flex-wrap gap-2"><Button onClick={() => router.push("/admin/scanner")}><QrCode size={16} />Scanner</Button><Button onClick={exportCsv} disabled={!filtered.length}><Download size={16} />Export</Button><button onClick={() => void loadData(true)} disabled={refreshing} className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50"><RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />Refresh</button><Button onClick={() => void logout()} danger><LogOut size={16} />Log out</Button></div></header>
    <section className="mb-6 grid gap-4 sm:grid-cols-3"><Stat label="Event registrations" value={registrations.length} /><Stat label="Unique participants" value={uniqueParticipants} /><Stat label="Checked in" value={checkedIn} /></section>
    <section className="rounded-xl border bg-white p-4 shadow-sm"><div className="mb-4 flex flex-col gap-3 sm:flex-row"><label className="flex flex-1 items-center gap-2 rounded-lg border px-3"><Search size={17} className="text-zinc-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search participant, email, ID, or event" className="w-full py-2 outline-none" /></label><select value={eventFilter} onChange={(event) => setEventFilter(event.target.value)} className="rounded-lg border px-3 py-2"><option value="all">All events</option>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></div>
      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading ? <p className="py-12 text-center text-zinc-500">Loading registrations…</p> : filtered.length === 0 ? <p className="py-12 text-center text-zinc-500">No registrations found.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="border-b text-zinc-500"><tr><th className="p-3">Participant</th><th className="p-3">Event</th><th className="p-3">Team</th><th className="p-3">Payment</th><th className="p-3">Entry</th><th className="p-3">Registered</th><th className="p-3">Actions</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.registration.id} className="border-b last:border-0"><td className="p-3"><div className="font-semibold">{item.participant.name}</div><div className="text-zinc-500">{item.participant.participant_id} · {item.participant.email}</div></td><td className="p-3">{item.event?.name ?? "Unknown event"}</td><td className="p-3">{item.registration.team_name ?? "—"}</td><td className="p-3">{item.registration.payment_status ?? "—"}{item.registration.payment_amount ? ` · ₹${item.registration.payment_amount}` : ""}</td><td className="p-3">{item.registration.checked_in ? "Checked in" : "Pending"}</td><td className="p-3 text-zinc-500">{formatDate(item.registration.created_at)}</td><td className="p-3"><div className="flex gap-2"><IconButton title="View details" onClick={() => setSelected(item)}><Eye size={16} /></IconButton><IconButton
  title={item.registration.checked_in ? "Check out" : "Check in"}
  onClick={() =>
    void updateCheckIn(
      item,
      !Boolean(item.registration.checked_in)
    )
  }
  disabled={updatingId === item.registration.id}
>
  {updatingId === item.registration.id ? (
    <RefreshCw size={16} className="animate-spin" />
  ) : (
    <Check size={16} />
  )}
</IconButton><IconButton title="Delete event registration" onClick={() => void deleteRegistration(item)} disabled={deletingId === item.registration.id} danger>{deletingId === item.registration.id ? <RefreshCw size={16} className="animate-spin" /> : <Trash2 size={16} />}</IconButton></div></td></tr>)}</tbody></table></div>}
    </section>
  </div>{selected && (
      <DetailsModal
        item={selected}
        updating={updatingId === selected.registration.id}
        deleting={deletingId === selected.registration.id}
        onClose={() => setSelected(null)}
        onCheckIn={() => void updateCheckIn(selected, true)}
        onCheckOut={() => void updateCheckIn(selected, false)}
        onDelete={() => void deleteRegistration(selected)}
      />
    )}</main>;
}

function Button({ children, onClick, disabled, danger = false }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) { return <button onClick={onClick} disabled={disabled} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-50 ${danger ? "border-red-200 bg-red-50 text-red-700" : "bg-black text-white"}`}>{children}</button>; }
function IconButton({ children, title, onClick, disabled, danger = false }: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; danger?: boolean }) { return <button title={title} aria-label={title} onClick={onClick} disabled={disabled} className={`rounded-md border p-2 disabled:opacity-50 ${danger ? "border-red-200 text-red-700" : "bg-white"}`}>{children}</button>; }
function Stat({ label, value }: { label: string; value: number }) { return <div className="rounded-xl border bg-white p-5 shadow-sm"><div className="mb-2 flex items-center gap-2 text-zinc-500"><Users size={17} /> {label}</div><p className="text-3xl font-bold">{value}</p></div>; }
function DetailsModal({
  item,
  updating,
  deleting,
  onClose,
  onCheckIn,
  onCheckOut,
  onDelete,
}: {
  item: Registration;
  updating: boolean;
  deleting: boolean;
  onClose: () => void;
  onCheckIn: () => void;
  onCheckOut: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 text-zinc-900 shadow-xl">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <p className="text-sm text-zinc-500">Participant details</p>
            <h2 className="text-2xl font-bold text-zinc-900">
              {item.participant.name}
            </h2>
            <p className="text-zinc-500">
              {item.participant.participant_id}
            </p>
          </div>

          <IconButton title="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Detail
            label="Event"
            value={item.event?.name ?? "Unknown event"}
          />
          <Detail
            label="Team"
            value={item.registration.team_name ?? "Individual"}
          />
          <Detail
            label="Email"
            value={item.participant.email}
          />
          <Detail
            label="Phone"
            value={item.participant.phone ?? "—"}
          />
          <Detail
            label="College"
            value={item.participant.college ?? "—"}
          />
          <Detail
            label="Payment"
            value={`${item.registration.payment_status ?? "—"}${
              item.registration.payment_amount
                ? ` · ₹${item.registration.payment_amount}`
                : ""
            }`}
          />
          <Detail
            label="Entry status"
            value={
              item.registration.checked_in
                ? `Checked in · ${formatDate(
                    item.registration.checked_in_at
                  )}`
                : "Pending"
            }
          />
          <Detail
            label="Registered"
            value={formatDate(item.registration.created_at)}
          />
        </div>

        {item.members.length > 0 && (
          <div className="mt-6 border-t border-zinc-200 pt-5">
            <h3 className="font-semibold text-zinc-900">
              Team members
            </h3>

            <div className="mt-3 space-y-2">
              {item.members.map((member) => (
                <div
                  key={member.id}
                  className="rounded-lg bg-zinc-50 p-3"
                >
                  <div className="font-medium text-zinc-900">
                    {member.name}
                    {member.is_team_leader
                      ? " (Leader)"
                      : ""}
                  </div>

                  <div className="text-sm text-zinc-500">
                    {member.email ?? "—"} ·{" "}
                    {member.phone ?? "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2 border-t border-zinc-200 pt-5">
          {!item.registration.checked_in ? (
            <button
              type="button"
              onClick={onCheckIn}
              disabled={updating}
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {updating ? (
                <RefreshCw
                  size={16}
                  className="animate-spin"
                />
              ) : (
                <Check size={16} />
              )}
              Check in
            </button>
          ) : (
            <button
              type="button"
              onClick={onCheckOut}
              disabled={updating}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 disabled:opacity-50"
            >
              {updating ? (
                <RefreshCw
                  size={16}
                  className="animate-spin"
                />
              ) : (
                <RefreshCw size={16} />
              )}
              Check out
            </button>
          )}

          <Button
            onClick={onDelete}
            disabled={deleting}
            danger
          >
            {deleting ? (
              <RefreshCw
                size={16}
                className="animate-spin"
              />
            ) : (
              <Trash2 size={16} />
            )}
            Delete registration
          </Button>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-zinc-50 p-3"><p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p><p className="mt-1 break-words">{value}</p></div>; }
