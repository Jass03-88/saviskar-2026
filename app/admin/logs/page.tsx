"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock3, ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";

type AuditLog = {
  id: string;
  admin_id: string;
  admin_email: string;
  action_type: string;
  target_id: string;
  details: any;
  created_at: string;
};

export default function AuditLogsPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/admin/login");
        return;
      }

      try {
        const res = await fetch("/api/admin/logs");
        if (res.status === 401 || res.status === 403) {
          router.replace("/admin/login");
          return;
        }

        const payload = await res.json();
        if (!res.ok) {
          throw new Error(payload.error || "Failed to load logs");
        }

        setLogs(payload.logs || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading logs");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  return (
    <main className="min-h-screen bg-[#f5f5f5] px-5 py-10 md:px-10 lg:px-16">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <button
              type="button"
              onClick={() => router.push("/admin")}
              className="mb-6 flex items-center gap-2 text-sm font-medium text-black/40 hover:text-black transition"
            >
              <ArrowLeft size={16} />
              Back to Dashboard
            </button>
            <h1 className="text-4xl font-semibold tracking-[-0.05em] md:text-5xl text-black">
              Audit Logs
            </h1>
            <p className="mt-4 text-sm text-black/45">
              Review destructive actions performed by administrators.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="rounded-[28px] bg-white px-6 py-20 text-center text-sm text-black/40">
            Loading logs...
          </div>
        ) : error ? (
          <div className="rounded-[28px] bg-red-50 text-red-600 px-6 py-10 text-center text-sm font-medium">
            {error}
          </div>
        ) : logs.length === 0 ? (
          <div className="rounded-[28px] bg-white px-6 py-20 text-center">
            <Clock3 size={28} className="mx-auto text-black/15" />
            <p className="mt-4 text-sm font-medium">No audit logs found</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[28px] bg-white shadow-[0_20px_80px_rgba(0,0,0,0.035)]">
            <div className="hidden border-b border-black/10 bg-black/[0.025] px-6 py-4 lg:grid lg:grid-cols-[1fr_2fr_1fr_1fr] lg:gap-5">
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-black/30">Timestamp</span>
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-black/30">Action & Target</span>
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-black/30">Admin</span>
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-black/30">Details</span>
            </div>
            <div className="divide-y divide-black/[0.07]">
              {logs.map((log) => (
                <div key={log.id} className="grid w-full gap-5 px-6 py-5 text-left lg:grid-cols-[1fr_2fr_1fr_1fr] lg:items-start text-sm">
                  <div className="text-xs text-black/60 font-mono">
                    {new Date(log.created_at).toLocaleString("en-IN")}
                  </div>
                  <div>
                    <span className="inline-block rounded-full bg-red-50 text-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border border-red-100">
                      {log.action_type}
                    </span>
                    <p className="mt-2 text-xs font-mono text-black/50">
                      ID: {log.target_id}
                    </p>
                  </div>
                  <div className="text-xs font-medium text-black truncate">
                    {log.admin_email}
                  </div>
                  <div className="text-[10px] text-black/50 bg-black/[0.02] p-3 rounded-xl overflow-x-auto font-mono">
                    <pre>{JSON.stringify(log.details, null, 2)}</pre>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
