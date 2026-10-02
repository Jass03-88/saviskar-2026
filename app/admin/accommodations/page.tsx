"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { 
  Building, 
  Users, 
  ArrowLeft, 
  CheckCircle2, 
  XCircle, 
  Plus, 
  RefreshCw, 
  Settings, 
  History 
} from "lucide-react";
import { INDIAN_STATES_AND_UT } from "@/lib/states";

type HostelRecord = { id: string; name: string; gender_eligibility: string; is_active: boolean };
type FloorRecord = { id: string; hostel_id: string; floor_number: number; name: string | null; is_active: boolean };
type RoomRecord = { id: string; hostel_id: string; floor_id: string; room_number: string; capacity: number; is_active: boolean };
type PlanRecord = { id: string; name: string; price: number };

type ParticipantDetails = {
  participant_id: string;
  name: string;
  email: string;
  phone: string;
  gender: string;
  state: string;
};

type AccommodationRecord = {
  id: string;
  participant_id: string;
  accommodation_plan_id: string;
  start_date: string;
  end_date: string;
  duration_days: number;
  amount: number;
  currency: string;
  status: string;
  hostel_id: string | null;
  room_id: string | null;
  checked_in: boolean;
  checked_in_at: string | null;
  checked_out: boolean;
  checked_out_at: string | null;
  created_at: string;
  participants: ParticipantDetails | null;
};

type DashboardData = {
  accommodations: AccommodationRecord[];
  hostels: HostelRecord[];
  floors: FloorRecord[];
  rooms: RoomRecord[];
  plans: PlanRecord[];
  roomOccupancy: Record<string, number>;
  floorOccupancy: Record<string, number>;
  hostelOccupancy: Record<string, number>;
  stats: { total: number; paid: number; pending: number; cancelled: number; checkedIn?: number; checkedOut?: number; allocated?: number; awaitingAllocation?: number; totalCapacity?: number; occupiedCapacity?: number };
};

export default function AccommodationsAdmin() {
  const router = useRouter();
  
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  
  const [tab, setTab] = useState<"overview" | "registrations" | "payments" | "allocations" | "lifecycle" | "history" | "exceptions" | "hostels" | "floors" | "rooms">("overview");
  const [initialFilters, setInitialFilters] = useState<{status?: string, checkIn?: string}>({});
  const goToRegistrations = (filters: {status?: string, checkIn?: string}) => {
    setInitialFilters(filters);
    setTab("registrations");
  };

  // Load Data
  const loadData = useCallback(async (refresh = false) => {
    if (refresh) {
      setRefreshing(true);
      setError("");
    }
    try {
      const response = await fetch("/api/admin/accommodations/dashboard?pageSize=5000");
      if (response.status === 401 || response.status === 403) {
        router.replace("/admin/login");
        return;
      }
      
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Failed to load data.");
      
      setData(payload);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message || "Failed to load data.");
      } else {
        setError("Failed to load data.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Hostels State
  const [hostelModalOpen, setHostelModalOpen] = useState(false);
  const [editingHostel, setEditingHostel] = useState<HostelRecord | null>(null);
  const [hostelForm, setHostelForm] = useState({ name: "", gender_eligibility: "mixed", is_active: true });

  // Floors State
  const [floorModalOpen, setFloorModalOpen] = useState(false);
  const [editingFloor, setEditingFloor] = useState<FloorRecord | null>(null);
  const [floorForm, setFloorForm] = useState({ hostel_id: "", floor_number: 0, name: "", is_active: true });

  // Rooms State
  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<RoomRecord | null>(null);
  const [roomForm, setRoomForm] = useState({ hostel_id: "", floor_id: "", room_number: "", capacity: 1, is_active: true });

  // Filter state for Floors and Rooms tabs
  const [filterHostelForFloors, setFilterHostelForFloors] = useState<string>("all");
  const [filterHostelForRooms, setFilterHostelForRooms] = useState<string>("all");
  const [filterFloorForRooms, setFilterFloorForRooms] = useState<string>("all");

  const saveHostel = async () => {
    try {
      const isUpdate = !!editingHostel;
      const res = await fetch("/api/admin/accommodations/hostels", {
        method: isUpdate ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isUpdate ? { id: editingHostel.id, ...hostelForm } : hostelForm)
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      
      setHostelModalOpen(false);
      loadData(true);
    } catch(err: unknown) {
      if (err instanceof Error) alert(err.message);
    }
  };

  const saveFloor = async () => {
    try {
      const isUpdate = !!editingFloor;
      const res = await fetch("/api/admin/accommodations/floors", {
        method: isUpdate ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isUpdate ? { id: editingFloor.id, ...floorForm } : floorForm)
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      
      setFloorModalOpen(false);
      loadData(true);
    } catch(err: unknown) {
      if (err instanceof Error) alert(err.message);
    }
  };

  const saveRoom = async () => {
    try {
      if (!roomForm.hostel_id || !roomForm.floor_id) {
        alert("Please select both a hostel and a floor.");
        return;
      }
      const isUpdate = !!editingRoom;
      const res = await fetch("/api/admin/accommodations/rooms", {
        method: isUpdate ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isUpdate ? { id: editingRoom.id, ...roomForm } : roomForm)
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      
      setRoomModalOpen(false);
      loadData(true);
    } catch(err: unknown) {
      if (err instanceof Error) alert(err.message);
    }
  };

  // Helper when hostel changes in Room form
  const handleRoomHostelChange = (newHostelId: string) => {
    const availableFloors = (data?.floors ?? []).filter(f => f.hostel_id === newHostelId && f.is_active);
    setRoomForm(prev => ({
      ...prev,
      hostel_id: newHostelId,
      floor_id: availableFloors.length > 0 ? availableFloors[0].id : ""
    }));
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[#f5f5f5] px-5 py-10 flex items-center justify-center text-black">
        <p className="text-sm text-black/60">Loading accommodations...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f5f5] px-5 py-10 md:px-10 lg:px-16 text-black">
      <div className="mx-auto max-w-[1500px]">
        {/* HEADER */}
        <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <button
              onClick={() => router.push("/admin")}
              className="mb-4 flex items-center gap-2 text-sm text-black/50 hover:text-black transition"
            >
              <ArrowLeft size={16} /> Back to Admin
            </button>
            <h1 className="text-4xl font-semibold tracking-[-0.05em] md:text-6xl text-black">
              Accommodation
            </h1>
            <p className="mt-4 text-sm text-black/50">
              Manage hostels, floors, rooms, and participant allocations.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => loadData(true)}
              disabled={refreshing}
              className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm transition hover:bg-black/[0.03] disabled:opacity-50 text-black/80 font-medium"
            >
              <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* NAVIGATION TABS */}
        <div className="flex space-x-2 border-b border-black/10 mb-8 pb-px overflow-x-auto">
          {(["overview", "registrations", "payments", "allocations", "lifecycle", "history", "exceptions", "hostels", "floors", "rooms"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm uppercase font-semibold tracking-wider transition ${
                tab === t 
                  ? "border-b-2 border-black text-black" 
                  : "text-black/40 hover:text-black"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* OVERVIEW TAB */}
        {tab === "overview" && data && (
          <div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mb-8">
              <StatCard title="Total Bookings" value={data.stats.total.toString()} icon={<Users size={18} />} dark />
              <StatCard title="Paid" value={data.stats.paid.toString()} icon={<CheckCircle2 size={18} />} />
              <StatCard title="Pending" value={data.stats.pending.toString()} icon={<RefreshCw size={18} />} />
              <StatCard title="Cancelled" value={data.stats.cancelled.toString()} icon={<XCircle size={18} />} />
              
              <StatCard title="Allocated" value={(data.stats.allocated ?? 0).toString()} icon={<CheckCircle2 size={18} />} />
              <StatCard title="Awaiting Allocation" value={(data.stats.awaitingAllocation ?? 0).toString()} icon={<RefreshCw size={18} />} />
              <StatCard title="Checked In" value={(data.stats.checkedIn ?? 0).toString()} icon={<CheckCircle2 size={18} />} />
              <StatCard title="Checked Out" value={(data.stats.checkedOut ?? 0).toString()} icon={<Building size={18} />} />
              
              <StatCard title="Total Capacity" value={(data.stats.totalCapacity ?? 0).toString()} icon={<Building size={18} />} dark />
              <StatCard title="Occupied Capacity" value={(data.stats.occupiedCapacity ?? 0).toString()} icon={<Users size={18} />} />
              <StatCard title="Available Capacity" value={Math.max(0, (data.stats.totalCapacity ?? 0) - (data.stats.occupiedCapacity ?? 0)).toString()} icon={<CheckCircle2 size={18} />} />
              <StatCard title="Occupancy %" value={data.stats.totalCapacity ? Math.round(((data.stats.occupiedCapacity ?? 0) / data.stats.totalCapacity) * 100) + "%" : "0%"} icon={<Building size={18} />} />
            </div>

            
            <h2 className="text-xl font-semibold mt-10 mb-4 text-black">Requires Attention</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 mb-10">
              <div onClick={() => goToRegistrations({ status: 'paid', checkIn: 'not_allocated' })} className="cursor-pointer rounded-2xl bg-orange-50 border border-orange-200 p-5 hover:bg-orange-100 transition">
                <p className="text-[10px] uppercase font-semibold text-orange-700">Awaiting Allocation</p>
                <p className="text-2xl font-semibold text-orange-800 mt-2">{data.stats.awaitingAllocation || 0}</p>
              </div>
              <div onClick={() => goToRegistrations({ status: 'paid', checkIn: 'not_checked_in' })} className="cursor-pointer rounded-2xl bg-yellow-50 border border-yellow-200 p-5 hover:bg-yellow-100 transition">
                <p className="text-[10px] uppercase font-semibold text-yellow-700">Paid, Not Checked In</p>
                <p className="text-2xl font-semibold text-yellow-800 mt-2">{data.accommodations.filter(a => a.status === 'paid' && !a.checked_in).length}</p>
              </div>
              <div onClick={() => goToRegistrations({ status: 'paid', checkIn: 'not_checked_in' })} className="cursor-pointer rounded-2xl bg-blue-50 border border-blue-200 p-5 hover:bg-blue-100 transition">
                <p className="text-[10px] uppercase font-semibold text-blue-700">Allocated, Not Checked In</p>
                <p className="text-2xl font-semibold text-blue-800 mt-2">{data.accommodations.filter(a => a.status === 'paid' && !!a.room_id && !a.checked_in).length}</p>
              </div>
              <div onClick={() => goToRegistrations({ checkIn: 'checked_in' })} className="cursor-pointer rounded-2xl bg-emerald-50 border border-emerald-200 p-5 hover:bg-emerald-100 transition">
                <p className="text-[10px] uppercase font-semibold text-emerald-700">Checked In</p>
                <p className="text-2xl font-semibold text-emerald-800 mt-2">{data.stats.checkedIn || 0}</p>
              </div>
              <div onClick={() => goToRegistrations({ checkIn: 'checked_out' })} className="cursor-pointer rounded-2xl bg-purple-50 border border-purple-200 p-5 hover:bg-purple-100 transition">
                <p className="text-[10px] uppercase font-semibold text-purple-700">Checked Out</p>
                <p className="text-2xl font-semibold text-purple-800 mt-2">{data.stats.checkedOut || 0}</p>
              </div>
              <div onClick={() => goToRegistrations({ status: 'unpaid' })} className="cursor-pointer rounded-2xl bg-red-50 border border-red-200 p-5 hover:bg-red-100 transition">
                <p className="text-[10px] uppercase font-semibold text-red-700">Unpaid Accomm.</p>
                <p className="text-2xl font-semibold text-red-800 mt-2">{data.stats.pending || 0}</p>
              </div>
            </div>

            <h2 className="text-xl font-semibold mb-4 text-black">Hostel Operations</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.hostels.map(h => {
                const hostelFloors = data.floors.filter(f => f.hostel_id === h.id);
                const hostelRooms = data.rooms.filter(r => r.hostel_id === h.id);
                const totalCap = hostelRooms.reduce((sum, r) => sum + r.capacity, 0);
                const occupied = data.hostelOccupancy[h.id] || 0;
                const occupancyPct = totalCap > 0 ? Math.round((occupied / totalCap) * 100) : 0;
                let statusLabel = "AVAILABLE";
                let statusColor = "bg-emerald-50 text-emerald-700 border-emerald-200";
                if (occupancyPct >= 100) { statusLabel = "FULL"; statusColor = "bg-red-50 text-red-700 border-red-200"; }
                else if (occupancyPct >= 80) { statusLabel = "NEAR CAPACITY"; statusColor = "bg-orange-50 text-orange-700 border-orange-200"; }
                else if (occupancyPct > 0) { statusLabel = "PARTIALLY OCCUPIED"; statusColor = "bg-blue-50 text-blue-700 border-blue-200"; }
                const available = Math.max(0, totalCap - occupied);
                return (
                  <div key={h.id} className="rounded-[28px] p-7 bg-white border border-black/5 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.04]">
                        <Building size={18} />
                      </div>
                      <span className="text-xs uppercase font-semibold px-2.5 py-1 rounded-full bg-black/5 text-black/70">
                        {h.gender_eligibility}
                      </span>
                    </div>
                    <p className="mt-5 text-xl font-semibold text-black">{h.name}</p>
                    <div className="mt-4 mb-2 flex justify-between items-center text-xs font-semibold">
                      <span className="text-black/50">Occupancy</span>
                      <span className="text-black">{occupancyPct}%</span>
                    </div>
                    <div className="w-full bg-black/5 rounded-full h-1.5 mb-4 overflow-hidden">
                      <div className="bg-black h-1.5 rounded-full" style={{ width: `${occupancyPct}%` }}></div>
                    </div>
                    <div className="mt-2 mb-4">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${statusColor}`}>
                        {statusLabel}
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-center border-t border-black/5 pt-4">
                      <div>
                        <p className="text-[10px] uppercase font-semibold text-black/40">Capacity</p>
                        <p className="text-lg font-semibold text-black">{totalCap}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase font-semibold text-black/40">Occupied</p>
                        <p className="text-lg font-semibold text-black">{occupied}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase font-semibold text-black/40">Available</p>
                        <p className="text-lg font-semibold text-green-600">{available}</p>
                      </div>
                    </div>
                    
                    {(() => {
                      const hostelAccs = data.accommodations.filter(a => a.hostel_id === h.id);
                      const checkInCount = hostelAccs.filter(a => a.checked_in && !a.checked_out).length;
                      const checkOutCount = hostelAccs.filter(a => a.checked_out).length;
                      const awaitingAllocCount = hostelAccs.filter(a => a.status === "paid" && !a.room_id).length;
                      return (
                        <div className="mt-3 flex justify-between text-xs text-black/60 pt-2 border-t border-black/5">
                          <span>Check-in: <strong>{checkInCount}</strong></span>
                          <span>Checked-out: <strong>{checkOutCount}</strong></span>
                          <span>Awaiting: <strong>{awaitingAllocCount}</strong></span>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
              {data.hostels.length === 0 && (
                <div className="col-span-full bg-white rounded-3xl p-8 text-center text-black/40 border border-black/5">
                  No hostels created yet. Add a hostel under the Hostels tab.
                </div>
              )}
            </div>
          </div>
        )}

        {/* HOSTELS TAB */}
        {tab === "hostels" && data && (
          <div>
            <button 
              onClick={() => { 
                setEditingHostel(null); 
                setHostelForm({ name: "", gender_eligibility: "mixed", is_active: true }); 
                setHostelModalOpen(true); 
              }}
              className="mb-4 flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm text-white hover:bg-black/90 transition"
            >
              <Plus size={15} /> Add Hostel
            </button>
            <button onClick={() => exportHostels(data)} className="mb-4 ml-3 flex items-center gap-2 rounded-full border border-black/20 bg-white px-5 py-3 text-sm text-black hover:bg-black/5 transition font-medium">Export CSV</button>
            <div className="bg-white rounded-3xl p-6 overflow-x-auto shadow-sm border border-black/5">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-black/40">
                    <th className="pb-3 pr-4 font-semibold">Name</th>
                    <th className="pb-3 px-4 font-semibold">Gender Eligibility</th>
                    <th className="pb-3 px-4 font-semibold">Floors</th>
                    <th className="pb-3 px-4 font-semibold">Rooms</th>
                    <th className="pb-3 px-4 font-semibold">Capacity</th>
                    <th className="pb-3 px-4 font-semibold">Occupied</th>
                    <th className="pb-3 px-4 font-semibold">Available</th>
                    <th className="pb-3 px-4 font-semibold">Status</th>
                    <th className="pb-3 pl-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.hostels.map(h => {
                    const floorsCount = data.floors.filter(f => f.hostel_id === h.id).length;
                    const hostelRooms = data.rooms.filter(r => r.hostel_id === h.id);
                    const totalCap = hostelRooms.reduce((sum, r) => sum + r.capacity, 0);
                    const occupied = data.hostelOccupancy[h.id] || 0;
                    const available = Math.max(0, totalCap - occupied);
                    return (
                      <tr key={h.id} className={`border-b border-black/5 last:border-0 hover:bg-black/[0.02] ${!h.is_active ? 'opacity-60 bg-gray-50' : ''}`}>
                        <td className="py-4 pr-4 font-medium text-black">{h.name}</td>
                        <td className="py-4 px-4 uppercase text-xs font-semibold">{h.gender_eligibility}</td>
                        <td className="py-4 px-4">{floorsCount}</td>
                        <td className="py-4 px-4">{hostelRooms.length}</td>
                        <td className="py-4 px-4 font-semibold">{totalCap}</td>
                        <td className="py-4 px-4 text-black/80">{occupied}</td>
                        <td className="py-4 px-4 font-semibold text-green-600">{available}</td>
                        <td className="py-4 px-4">
                          {h.is_active ? (
                            <span className="text-green-600 font-medium">Active</span>
                          ) : (
                            <span className="text-red-500 font-medium">Inactive</span>
                          )}
                        </td>
                        <td className="py-4 pl-4 text-right">
                          <button 
                            onClick={() => { 
                              setEditingHostel(h); 
                              setHostelForm({ name: h.name, gender_eligibility: h.gender_eligibility, is_active: h.is_active }); 
                              setHostelModalOpen(true); 
                            }} 
                            className="text-black/60 hover:text-black font-medium"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {data.hostels.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-black/40">
                        No hostels created yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* FLOORS TAB */}
        {tab === "floors" && data && (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => { 
                    setEditingFloor(null); 
                    setFloorForm({ 
                      hostel_id: data.hostels[0]?.id || "", 
                      floor_number: 0, 
                      name: "", 
                      is_active: true 
                    }); 
                    setFloorModalOpen(true); 
                  }}
                  disabled={data.hostels.length === 0}
                  className="flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm text-white hover:bg-black/90 transition disabled:opacity-50"
                >
                  <Plus size={15} /> Add Floor
                </button>
                <button onClick={() => exportFloors(data)} className="flex items-center gap-2 rounded-full border border-black/20 bg-white px-5 py-3 text-sm text-black hover:bg-black/5 transition font-medium">Export CSV</button>

                <select 
                  value={filterHostelForFloors} 
                  onChange={e => setFilterHostelForFloors(e.target.value)}
                  className="border border-black/10 rounded-full px-4 py-2 text-sm text-black bg-white"
                >
                  <option value="all">All Hostels</option>
                  {data.hostels.map(h => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
              </div>

              <div className="text-xs text-black/50">
                Total Floors: {data.floors.length}
              </div>
            </div>

            <div className="bg-white rounded-3xl p-6 overflow-x-auto shadow-sm border border-black/5">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-black/40">
                    <th className="pb-3 pr-4 font-semibold">Hostel</th>
                    <th className="pb-3 px-4 font-semibold">Floor Number</th>
                    <th className="pb-3 px-4 font-semibold">Floor Name / Label</th>
                    <th className="pb-3 px-4 font-semibold">Rooms</th>
                    <th className="pb-3 px-4 font-semibold">Capacity</th>
                    <th className="pb-3 px-4 font-semibold">Occupied</th>
                    <th className="pb-3 px-4 font-semibold">Available</th>
                    <th className="pb-3 px-4 font-semibold">Occupancy %</th>
                    <th className="pb-3 px-4 font-semibold">Checked In</th>
                    <th className="pb-3 px-4 font-semibold">Checked Out</th>
                    <th className="pb-3 px-4 font-semibold">Full Rooms</th>
                    <th className="pb-3 px-4 font-semibold">Available Rooms</th>
                    <th className="pb-3 px-4 font-semibold">Status</th>
                    <th className="pb-3 pl-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.floors
                    .filter(f => filterHostelForFloors === "all" || f.hostel_id === filterHostelForFloors)
                    .map(f => {
                      const hostel = data.hostels.find(h => h.id === f.hostel_id);
                      const floorRooms = data.rooms.filter(r => r.floor_id === f.id);
                      const floorCap = floorRooms.reduce((sum, r) => sum + r.capacity, 0);
                      const floorOcc = data.floorOccupancy[f.id] || 0;
                      const available = Math.max(0, floorCap - floorOcc);
                      const occupancyPct = floorCap > 0 ? Math.round((floorOcc / floorCap) * 100) : 0;
                      const checkedIn = data.accommodations.filter(a => a.status === "paid" && a.room_id && data.rooms.find(r => r.id === a.room_id)?.floor_id === f.id && a.checked_in && !a.checked_out).length;
                      const checkedOut = data.accommodations.filter(a => a.status === "paid" && a.room_id && data.rooms.find(r => r.id === a.room_id)?.floor_id === f.id && a.checked_out).length;
                      const fullRooms = floorRooms.filter(r => (data.roomOccupancy[r.id] || 0) >= r.capacity).length;
                      const availableRooms = floorRooms.length - fullRooms;
                      return (
                        <tr key={f.id} className={`border-b border-black/5 last:border-0 hover:bg-black/[0.02] ${!f.is_active ? 'opacity-60 bg-gray-50' : ''}`}>
                          <td className="py-4 pr-4 font-medium text-black">{hostel?.name || "Unknown"}</td>
                          <td className="py-4 px-4 font-semibold">Floor {f.floor_number}</td>
                          <td className="py-4 px-4 text-black/70">{f.name || "—"}</td>
                          <td className="py-4 px-4">{floorRooms.length}</td>
                          <td className="py-4 px-4 font-semibold">{floorCap}</td>
                          <td className="py-4 px-4 text-black/80">{floorOcc}</td>
                          <td className="py-4 px-4 font-semibold text-green-600">{available}</td>
                          <td className="py-4 px-4 font-semibold">{occupancyPct}%</td>
                          <td className="py-4 px-4 text-emerald-600">{checkedIn}</td>
                          <td className="py-4 px-4 text-purple-600">{checkedOut}</td>
                          <td className="py-4 px-4">{fullRooms}</td>
                          <td className="py-4 px-4 text-green-600 font-semibold">{availableRooms}</td>
                          <td className="py-4 px-4">
                            {f.is_active ? (
                              <span className="text-green-600 font-medium">Active</span>
                            ) : (
                              <span className="text-red-500 font-medium">Inactive</span>
                            )}
                          </td>
                          <td className="py-4 pl-4 text-right">
                            <button 
                              onClick={() => { 
                                setEditingFloor(f); 
                                setFloorForm({ 
                                  hostel_id: f.hostel_id, 
                                  floor_number: f.floor_number, 
                                  name: f.name || "", 
                                  is_active: f.is_active 
                                }); 
                                setFloorModalOpen(true); 
                              }} 
                              className="text-black/60 hover:text-black font-medium"
                            >
                              Edit
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  {data.floors.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-black/40">
                        No floors created yet. Add a floor to get started.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ROOMS TAB */}
        {tab === "rooms" && data && (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <div className="flex flex-wrap items-center gap-3">
                <button 
                  onClick={() => { 
                    setEditingRoom(null); 
                    const defaultHostel = data.hostels[0]?.id || "";
                    const availableFloors = data.floors.filter(f => f.hostel_id === defaultHostel && f.is_active);
                    setRoomForm({ 
                      hostel_id: defaultHostel, 
                      floor_id: availableFloors[0]?.id || "", 
                      room_number: "", 
                      capacity: 1, 
                      is_active: true 
                    }); 
                    setRoomModalOpen(true); 
                  }}
                  disabled={data.floors.length === 0}
                  className="flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm text-white hover:bg-black/90 transition disabled:opacity-50"
                >
                  <Plus size={15} /> Add Room
                </button>
                <button onClick={() => exportRooms(data)} className="flex items-center gap-2 rounded-full border border-black/20 bg-white px-5 py-3 text-sm text-black hover:bg-black/5 transition font-medium">Export CSV</button>

                <select 
                  value={filterHostelForRooms} 
                  onChange={e => {
                    setFilterHostelForRooms(e.target.value);
                    setFilterFloorForRooms("all");
                  }}
                  className="border border-black/10 rounded-full px-4 py-2 text-sm text-black bg-white"
                >
                  <option value="all">All Hostels</option>
                  {data.hostels.map(h => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>

                <select 
                  value={filterFloorForRooms} 
                  onChange={e => setFilterFloorForRooms(e.target.value)}
                  className="border border-black/10 rounded-full px-4 py-2 text-sm text-black bg-white"
                >
                  <option value="all">All Floors</option>
                  {data.floors
                    .filter(f => filterHostelForRooms === "all" || f.hostel_id === filterHostelForRooms)
                    .map(f => {
                      const h = data.hostels.find(x => x.id === f.hostel_id);
                      return (
                        <option key={f.id} value={f.id}>
                          {h ? `${h.name} — ` : ""}Floor {f.floor_number} {f.name ? `(${f.name})` : ""}
                        </option>
                      );
                    })}
                </select>
              </div>

              <div className="text-xs text-black/50">
                Total Rooms: {data.rooms.length}
              </div>
            </div>

            <div className="bg-white rounded-3xl p-6 overflow-x-auto shadow-sm border border-black/5">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-black/40">
                    <th className="pb-3 pr-4 font-semibold">Hostel</th>
                    <th className="pb-3 px-4 font-semibold">Floor</th>
                    <th className="pb-3 px-4 font-semibold">Room Number</th>
                    <th className="pb-3 px-4 font-semibold">Capacity</th>
                    <th className="pb-3 px-4 font-semibold">Occupied</th>
                    <th className="pb-3 px-4 font-semibold">Available</th>
                    <th className="pb-3 px-4 font-semibold">Room Status</th>
                    <th className="pb-3 px-4 font-semibold">System Status</th>
                    <th className="pb-3 pl-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rooms
                    .filter(r => filterHostelForRooms === "all" || r.hostel_id === filterHostelForRooms)
                    .filter(r => filterFloorForRooms === "all" || r.floor_id === filterFloorForRooms)
                    .map(r => {
                      const hostel = data.hostels.find(h => h.id === r.hostel_id);
                      const floor = data.floors.find(f => f.id === r.floor_id);
                      const occupied = data.roomOccupancy[r.id] || 0;
                      const available = Math.max(0, r.capacity - occupied);
                      const occupancyPct = r.capacity > 0 ? Math.round((occupied / r.capacity) * 100) : 0;
                      return (
                        <tr key={r.id} className={`border-b border-black/5 last:border-0 hover:bg-black/[0.02] ${!r.is_active ? 'opacity-60 bg-gray-50' : ''}`}>
                          <td className="py-4 pr-4 text-black">{hostel?.name || "Unknown"}</td>
                          <td className="py-4 px-4 font-medium text-black">
                            {floor ? `Floor ${floor.floor_number}` : "—"}
                          </td>
                          <td className="py-4 px-4 font-semibold text-black">{r.room_number}</td>
                          <td className="py-4 px-4">{r.capacity}</td>
                          <td className="py-4 px-4 text-black/80">{occupied}</td>
                          <td className="py-4 px-4 font-semibold text-green-600">{available}</td>
                          <td className="py-4 px-4">
                            {(() => {
                               const roomStatus = occupied === 0 ? "AVAILABLE" : occupied >= r.capacity ? "FULL" : "PARTIALLY OCCUPIED";
                               if (roomStatus === "AVAILABLE") return <span className="inline-block px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">AVAILABLE</span>;
                               if (roomStatus === "FULL") return <span className="inline-block px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-red-50 text-red-700 border border-red-200">FULL</span>;
                               return <span className="inline-block px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-orange-50 text-orange-700 border border-orange-200">PARTIALLY OCCUPIED</span>;
                            })()}
                          </td>
                          <td className="py-4 px-4">
                            {r.is_active ? (
                              <span className="text-green-600 font-medium">Active</span>
                            ) : (
                              <span className="text-red-500 font-medium">Inactive</span>
                            )}
                          </td>
                          <td className="py-4 pl-4 text-right">
                            <button 
                              onClick={() => { 
                                setEditingRoom(r); 
                                setRoomForm({ 
                                  hostel_id: r.hostel_id, 
                                  floor_id: r.floor_id, 
                                  room_number: r.room_number, 
                                  capacity: r.capacity, 
                                  is_active: r.is_active 
                                }); 
                                setRoomModalOpen(true); 
                              }} 
                              className="text-black/60 hover:text-black font-medium"
                            >
                              Edit
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  {data.rooms.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-black/40">
                        No rooms created yet. Ensure a hostel and floor exist first.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* REGISTRATIONS TAB */}
        
        {tab === "registrations" && data && (
          <RegistrationsTable data={data} onRefresh={() => loadData(true)} initialFilters={initialFilters} />
        )}

        {tab === "payments" && data && (
          <PaymentsReport data={data} />
        )}

        {tab === "allocations" && data && (
          <AllocationsReport data={data} />
        )}

        {tab === "lifecycle" && data && (
          <LifecycleReport data={data} />
        )}

        {tab === "history" && data && (
          <HistoryReport />
        )}

        {tab === "exceptions" && data && (
          <ExceptionsReport data={data} />
        )}

      </div>

      {/* MODALS */}

      {/* HOSTEL MODAL */}
      {hostelModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 shadow-xl">
            <h2 className="text-2xl font-semibold mb-4 text-black">{editingHostel ? "Edit Hostel" : "Add Hostel"}</h2>
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-black/50 mb-1">Hostel Name</label>
                <input 
                  type="text" 
                  placeholder="e.g. Ganga Hostel, Block A" 
                  value={hostelForm.name} 
                  onChange={e => setHostelForm({...hostelForm, name: e.target.value})} 
                  className="w-full border border-black/10 rounded-xl px-4 py-3 text-black placeholder:text-black/40 bg-white" 
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-black/50 mb-1">Gender Eligibility</label>
                <select 
                  value={hostelForm.gender_eligibility} 
                  onChange={e => setHostelForm({...hostelForm, gender_eligibility: e.target.value})} 
                  className="w-full border border-black/10 rounded-xl px-4 py-3 text-black bg-white"
                >
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="mixed">Mixed</option>
                  <option value="any">Any</option>
                </select>
              </div>

              <label className="flex items-center gap-2 text-black text-sm">
                <input 
                  type="checkbox" 
                  checked={hostelForm.is_active} 
                  onChange={e => setHostelForm({...hostelForm, is_active: e.target.checked})} 
                />
                Active Status
              </label>

              <div className="flex justify-end gap-2 mt-4">
                <button 
                  onClick={() => setHostelModalOpen(false)} 
                  className="px-4 py-2 bg-gray-100 rounded-full text-black/70 hover:bg-gray-200 transition text-sm font-medium"
                >
                  Cancel
                </button>
                <button 
                  onClick={saveHostel} 
                  className="px-5 py-2 bg-black text-white rounded-full hover:bg-black/90 transition text-sm font-medium"
                >
                  Save Hostel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FLOOR MODAL */}
      {floorModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 shadow-xl">
            <h2 className="text-2xl font-semibold mb-4 text-black">{editingFloor ? "Edit Floor" : "Add Floor"}</h2>
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-black/50 mb-1">Hostel</label>
                <select 
                  value={floorForm.hostel_id} 
                  onChange={e => setFloorForm({...floorForm, hostel_id: e.target.value})} 
                  className="w-full border border-black/10 rounded-xl px-4 py-3 text-black bg-white"
                  disabled={!!editingFloor}
                >
                  {data?.hostels?.map(h => (
                    <option key={h.id} value={h.id}>{h.name} ({h.gender_eligibility})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-black/50 mb-1">Floor Number</label>
                <input 
                  type="number" 
                  min="0" 
                  placeholder="0 for Ground, 1 for 1st Floor..." 
                  value={floorForm.floor_number} 
                  onChange={e => setFloorForm({...floorForm, floor_number: parseInt(e.target.value) || 0})} 
                  className="w-full border border-black/10 rounded-xl px-4 py-3 text-black placeholder:text-black/40 bg-white" 
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-black/50 mb-1">Floor Name / Label (Optional)</label>
                <input 
                  type="text" 
                  placeholder="e.g. Ground Floor, First Floor, Wing B" 
                  value={floorForm.name} 
                  onChange={e => setFloorForm({...floorForm, name: e.target.value})} 
                  className="w-full border border-black/10 rounded-xl px-4 py-3 text-black placeholder:text-black/40 bg-white" 
                />
              </div>

              <label className="flex items-center gap-2 text-black text-sm">
                <input 
                  type="checkbox" 
                  checked={floorForm.is_active} 
                  onChange={e => setFloorForm({...floorForm, is_active: e.target.checked})} 
                />
                Active Status
              </label>

              <div className="flex justify-end gap-2 mt-4">
                <button 
                  onClick={() => setFloorModalOpen(false)} 
                  className="px-4 py-2 bg-gray-100 rounded-full text-black/70 hover:bg-gray-200 transition text-sm font-medium"
                >
                  Cancel
                </button>
                <button 
                  onClick={saveFloor} 
                  className="px-5 py-2 bg-black text-white rounded-full hover:bg-black/90 transition text-sm font-medium"
                >
                  Save Floor
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ROOM MODAL */}
      {roomModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 shadow-xl">
            <h2 className="text-2xl font-semibold mb-4 text-black">{editingRoom ? "Edit Room" : "Add Room"}</h2>
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-black/50 mb-1">Hostel</label>
                <select 
                  value={roomForm.hostel_id} 
                  onChange={e => handleRoomHostelChange(e.target.value)} 
                  className="w-full border border-black/10 rounded-xl px-4 py-3 text-black bg-white" 
                  disabled={!!editingRoom}
                >
                  <option value="" disabled>-- Select Hostel --</option>
                  {data?.hostels?.map(h => (
                    <option key={h.id} value={h.id}>{h.name} ({h.gender_eligibility})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-black/50 mb-1">Floor</label>
                <select 
                  value={roomForm.floor_id} 
                  onChange={e => setRoomForm({...roomForm, floor_id: e.target.value})} 
                  className="w-full border border-black/10 rounded-xl px-4 py-3 text-black bg-white" 
                  disabled={!roomForm.hostel_id || !!editingRoom}
                >
                  <option value="" disabled>-- Select Floor --</option>
                  {(data?.floors ?? [])
                    .filter(f => f.hostel_id === roomForm.hostel_id && f.is_active)
                    .map(f => (
                      <option key={f.id} value={f.id}>
                        Floor {f.floor_number} {f.name ? `(${f.name})` : ""}
                      </option>
                    ))}
                </select>
                {(data?.floors ?? []).filter(f => f.hostel_id === roomForm.hostel_id && f.is_active).length === 0 && roomForm.hostel_id && (
                  <p className="text-xs text-red-500 mt-1">This hostel has no active floors. Please add a floor first.</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-black/50 mb-1">Room Number</label>
                <input 
                  type="text" 
                  placeholder="e.g. 101, 202, B-12" 
                  value={roomForm.room_number} 
                  onChange={e => setRoomForm({...roomForm, room_number: e.target.value})} 
                  className="w-full border border-black/10 rounded-xl px-4 py-3 text-black placeholder:text-black/40 bg-white" 
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-black/50 mb-1">Capacity (Beds)</label>
                <input 
                  type="number" 
                  placeholder="Capacity" 
                  min="1" 
                  value={roomForm.capacity} 
                  onChange={e => setRoomForm({...roomForm, capacity: parseInt(e.target.value) || 1})} 
                  className="w-full border border-black/10 rounded-xl px-4 py-3 text-black placeholder:text-black/40 bg-white" 
                />
              </div>

              <label className="flex items-center gap-2 text-black text-sm">
                <input 
                  type="checkbox" 
                  checked={roomForm.is_active} 
                  onChange={e => setRoomForm({...roomForm, is_active: e.target.checked})} 
                />
                Active Status
              </label>

              <div className="flex justify-end gap-2 mt-4">
                <button 
                  onClick={() => setRoomModalOpen(false)} 
                  className="px-4 py-2 bg-gray-100 rounded-full text-black/70 hover:bg-gray-200 transition text-sm font-medium"
                >
                  Cancel
                </button>
                <button 
                  onClick={saveRoom} 
                  disabled={!roomForm.hostel_id || !roomForm.floor_id}
                  className="px-5 py-2 bg-black text-white rounded-full hover:bg-black/90 transition text-sm font-medium disabled:opacity-50"
                >
                  Save Room
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function RegistrationsTable({ data, onRefresh, initialFilters = {} }: { data: DashboardData; onRefresh: () => void, initialFilters?: {status?: string, checkIn?: string} }) {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState(initialFilters.status || "all");
  const [filterGender, setFilterGender] = useState("all");
  const [filterState, setFilterState] = useState("all");
  const [filterCheckIn, setFilterCheckIn] = useState(initialFilters.checkIn || "all");
  useEffect(() => {
    if (initialFilters.status) setFilterStatus(initialFilters.status);
    if (initialFilters.checkIn) setFilterCheckIn(initialFilters.checkIn);
  }, [initialFilters]);
  const [filterHostel, setFilterHostel] = useState("all");
  const [filterRoom, setFilterRoom] = useState("all");

  const [allocatingAcc, setAllocatingAcc] = useState<AccommodationRecord | null>(null);
  const [historyAcc, setHistoryAcc] = useState<AccommodationRecord | null>(null);
  const [autoAllocating, setAutoAllocating] = useState(false);
  const [autoAllocResult, setAutoAllocResult] = useState<{
    allocated: number;
    skipped: number;
    failed: number;
  } | null>(null);

  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<"allocate" | "check-in" | "check-out" | null>(null);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.accommodations.filter(acc => {
      const p = acc.participants;
      if (!p) return false;
      const q = search.toLowerCase();
      const room = data.rooms.find(r => r.id === acc.room_id);
      const hostel = data.hostels.find(h => h.id === acc.hostel_id);

      const matchesSearch = !search || 
        p.name?.toLowerCase().includes(q) || 
        p.email?.toLowerCase().includes(q) || 
        p.participant_id?.toLowerCase().includes(q) ||
        room?.room_number?.toLowerCase().includes(q) ||
        hostel?.name?.toLowerCase().includes(q);
      
      const matchesStatus = filterStatus === "all" || acc.status === filterStatus;
      const matchesGender = filterGender === "all" || p.gender === filterGender;
      const matchesState = filterState === "all" || p.state === filterState;
      
      let matchesCheckIn = true;
      if (filterCheckIn === "not_allocated") {
        matchesCheckIn = !acc.room_id;
      } else if (filterCheckIn === "allocated") {
        matchesCheckIn = !!acc.room_id;
      } else if (filterCheckIn === "not_checked_in") {
        matchesCheckIn = acc.status === "paid" && !!acc.room_id && !acc.checked_in;
      } else if (filterCheckIn === "checked_in") {
        matchesCheckIn = acc.checked_in && !acc.checked_out;
      } else if (filterCheckIn === "checked_out") {
        matchesCheckIn = acc.checked_out;
      }

      const matchesHostel = filterHostel === "all" || acc.hostel_id === filterHostel;
      const matchesRoom = filterRoom === "all" || acc.room_id === filterRoom;

      return matchesSearch && matchesStatus && matchesGender && matchesState && matchesCheckIn && matchesHostel && matchesRoom;
    });
  }, [data, search, filterStatus, filterGender, filterState, filterCheckIn, filterHostel, filterRoom]);

  const toggleSelection = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const selectAllFiltered = () => {
    const next = new Set(selectedIds);
    let added = false;
    for (const f of filtered) {
      if (!next.has(f.id)) {
        next.add(f.id);
        added = true;
      }
    }
    if (!added) {
      // if all are already selected, deselect them
      for (const f of filtered) {
        next.delete(f.id);
      }
    }
    setSelectedIds(next);
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleCheckIn = async (acc: AccommodationRecord) => {
    const participantName = acc.participants?.name || "this participant";
    const confirmed = window.confirm(`Check in ${participantName} to accommodation?`);
    if (!confirmed) return;

    setActionLoadingId(acc.id);
    setActionMessage(null);
    setActionError(null);

    try {
      const res = await fetch("/api/admin/accommodations/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantAccommodationId: acc.id }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error?.message || payload.error || "Failed to check in.");
      }
      setActionMessage(`Check-in successful for ${participantName}.`);
      onRefresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to check in.";
      setActionError(msg);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCheckOut = async (acc: AccommodationRecord) => {
    const participantName = acc.participants?.name || "this participant";
    const confirmed = window.confirm(`Check out ${participantName} from accommodation?`);
    if (!confirmed) return;

    setActionLoadingId(acc.id);
    setActionMessage(null);
    setActionError(null);

    try {
      const res = await fetch("/api/admin/accommodations/check-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantAccommodationId: acc.id }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error?.message || payload.error || "Failed to check out.");
      }
      setActionMessage(`Check-out successful for ${participantName}.`);
      onRefresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to check out.";
      setActionError(msg);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleAutoAllocate = async () => {
    if (!confirm("Are you sure you want to run bulk auto-allocation on ALL unallocated paid bookings? This cannot be undone.")) return;
    setAutoAllocating(true);
    try {
      const res = await fetch("/api/admin/accommodations/auto-allocate", { method: "POST" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error?.message || "Error");
      setAutoAllocResult(payload.data);
      onRefresh();
    } catch(err: unknown) {
      const msg = err instanceof Error ? err.message : "Error";
      alert("Failed: " + msg);
    } finally {
      setAutoAllocating(false);
    }
  };

  const handleExport = () => {
    if (filtered.length === 0) {
      alert("No data to export.");
      return;
    }
    const headers = [
      "Participant ID", "Participant Name", "Email", "Gender", "State", 
      "Accommodation Plan", "Duration (Days)", "Amount", "Currency", 
      "Payment Status", "Accommodation Status", "Hostel", "Floor", "Room",
      "Allocation Status", "Checked In", "Checked In At", "Checked Out", "Checked Out At"
    ];
    const rows = filtered.map(acc => {
      const plan = data.plans.find(p => p.id === acc.accommodation_plan_id);
      const hostel = data.hostels.find(h => h.id === acc.hostel_id);
      const room = data.rooms.find(r => r.id === acc.room_id);
      const floor = room ? data.floors.find(f => f.id === room.floor_id) : null;
      
      const allocStatus = !acc.room_id ? "Awaiting Allocation" : "Allocated";
      
      return [
        acc.participants?.participant_id || "",
        `"${(acc.participants?.name || "").replace(/"/g, '""')}"`,
        `"${(acc.participants?.email || "").replace(/"/g, '""')}"`,
        acc.participants?.gender || "",
        `"${(acc.participants?.state || "").replace(/"/g, '""')}"`,
        `"${(plan?.name || "").replace(/"/g, '""')}"`,
        acc.duration_days,
        acc.amount,
        acc.currency,
        acc.status,
        acc.checked_out ? "Checked Out" : acc.checked_in ? "Checked In" : acc.room_id ? "Allocated" : "Awaiting Allocation",
        `"${(hostel?.name || "").replace(/"/g, '""')}"`,
        floor ? floor.floor_number : "",
        `"${(room?.room_number || "").replace(/"/g, '""')}"`,
        allocStatus,
        acc.checked_in ? "Yes" : "No",
        acc.checked_in_at ? new Date(acc.checked_in_at).toLocaleString() : "",
        acc.checked_out ? "Yes" : "No",
        acc.checked_out_at ? new Date(acc.checked_out_at).toLocaleString() : ""
      ];
    });
    
    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `accommodation_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-4 mb-6">
        <input 
          type="text" 
          placeholder="Search name, email, ID, room..." 
          className="border border-black/10 rounded-full px-4 py-2 text-sm w-full md:w-auto text-black placeholder:text-black/40 bg-white"
          value={search} onChange={e => setSearch(e.target.value)}
        />
        <select className="border border-black/10 rounded-full px-4 py-2 text-sm text-black bg-white" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="all">All Payment Status</option>
          <option value="paid">Paid</option>
          <option value="pending">Pending</option>
          <option value="unpaid">Unpaid</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select className="border border-black/10 rounded-full px-4 py-2 text-sm text-black bg-white" value={filterCheckIn} onChange={e => setFilterCheckIn(e.target.value)}>
          <option value="all">All Lifecycle</option>
          <option value="not_allocated">Awaiting Allocation</option>
          <option value="allocated">Allocated</option>
          <option value="not_checked_in">Not Checked In</option>
          <option value="checked_in">Checked In</option>
          <option value="checked_out">Checked Out</option>
        </select>
        <select className="border border-black/10 rounded-full px-4 py-2 text-sm text-black bg-white" value={filterGender} onChange={e => setFilterGender(e.target.value)}>
          <option value="all">All Genders</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
        </select>
        <select className="border border-black/10 rounded-full px-4 py-2 text-sm text-black bg-white" value={filterState} onChange={e => setFilterState(e.target.value)}>
          <option value="all">All States</option>
          {INDIAN_STATES_AND_UT.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select 
          className="border border-black/10 rounded-full px-4 py-2 text-sm text-black bg-white" 
          value={filterHostel} 
          onChange={e => { setFilterHostel(e.target.value); setFilterRoom("all"); }}
        >
          <option value="all">All Hostels</option>
          {data.hostels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <select 
          className="border border-black/10 rounded-full px-4 py-2 text-sm text-black bg-white max-w-[200px] truncate" 
          value={filterRoom} 
          onChange={e => setFilterRoom(e.target.value)}
          disabled={filterHostel === "all"}
        >
          <option value="all">All Rooms</option>
          {data.rooms.filter(r => filterHostel === "all" || r.hostel_id === filterHostel).map(r => (
            <option key={r.id} value={r.id}>Rm {r.room_number}</option>
          ))}
        </select>
        
        <div className="ml-auto flex items-center gap-3">
          <button 
            onClick={handleExport}
            className="flex items-center gap-2 rounded-full border border-black/20 bg-white px-5 py-2 text-sm text-black hover:bg-black/5 transition font-medium"
          >
            Export CSV
          </button>
          <button 
            onClick={handleAutoAllocate}
            disabled={autoAllocating}
            className="flex items-center gap-2 rounded-full bg-black px-5 py-2 text-sm text-white disabled:opacity-50 hover:bg-black/90 transition font-medium"
          >
            <Settings size={15} className={autoAllocating ? "animate-spin" : ""} />
            Auto Allocate All
          </button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="mb-4 rounded-2xl bg-indigo-50 border border-indigo-200 px-5 py-3 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-4">
            <span className="text-indigo-800 font-medium text-sm">{selectedIds.size} participant(s) selected</span>
            <button onClick={clearSelection} className="text-indigo-600 text-xs font-semibold hover:underline">Clear Selection</button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setBulkAction("allocate")} className="px-4 py-1.5 bg-indigo-600 text-white rounded-full text-xs font-medium hover:bg-indigo-700 transition shadow-sm">Bulk Allocate</button>
            <button onClick={() => setBulkAction("check-in")} className="px-4 py-1.5 bg-emerald-600 text-white rounded-full text-xs font-medium hover:bg-emerald-700 transition shadow-sm">Bulk Check-in</button>
            <button onClick={() => setBulkAction("check-out")} className="px-4 py-1.5 bg-purple-600 text-white rounded-full text-xs font-medium hover:bg-purple-700 transition shadow-sm">Bulk Check-out</button>
          </div>
        </div>
      )}

      {actionMessage && (
        <div className="mb-4 rounded-2xl border border-green-200 bg-green-50 px-5 py-3 text-sm text-green-700 flex justify-between items-center">
          <span>{actionMessage}</span>
          <button onClick={() => setActionMessage(null)} className="text-green-800 text-xs font-semibold hover:underline">Dismiss</button>
        </div>
      )}
      {actionError && (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700 flex justify-between items-center">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-red-800 text-xs font-semibold hover:underline">Dismiss</button>
        </div>
      )}

      {autoAllocResult && (
        <div className="mb-6 rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold mb-2 text-black">Auto Allocation Results</h3>
          <p className="text-sm text-black/70">Allocated: {autoAllocResult.allocated} | Skipped: {autoAllocResult.skipped} | Failed: {autoAllocResult.failed}</p>
          <button className="mt-4 px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-black/70 hover:bg-gray-200 transition" onClick={() => setAutoAllocResult(null)}>Dismiss</button>
        </div>
      )}

      <div className="bg-white rounded-3xl p-6 overflow-x-auto shadow-sm border border-black/5 min-h-[500px]">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-black/10 text-black/40">
              <th className="pb-3 pr-2 pl-4 font-semibold w-10">
                <input 
                  type="checkbox" 
                  title="Select/Deselect All Filtered"
                  checked={filtered.length > 0 && filtered.every(f => selectedIds.has(f.id))}
                  ref={input => {
                    if (input) {
                      const selectedCount = filtered.filter(f => selectedIds.has(f.id)).length;
                      input.indeterminate = selectedCount > 0 && selectedCount < filtered.length;
                    }
                  }}
                  onChange={selectAllFiltered}
                  className="rounded border-black/20"
                />
              </th>
              <th className="pb-3 pr-4 font-semibold">ID</th>
              <th className="pb-3 px-4 font-semibold">Participant</th>
              <th className="pb-3 px-4 font-semibold">Gender/State</th>
              <th className="pb-3 px-4 font-semibold">Plan</th>
              <th className="pb-3 px-4 font-semibold">Payment</th>
              <th className="pb-3 px-4 font-semibold">Accommodation Status</th>
              <th className="pb-3 px-4 font-semibold text-right">Hostel / Floor / Room</th>
              <th className="pb-3 pl-4 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(acc => {
              const plan = data.plans.find(p => p.id === acc.accommodation_plan_id);
              const hostel = data.hostels.find(h => h.id === acc.hostel_id);
              const room = data.rooms.find(r => r.id === acc.room_id);
              const floor = room ? data.floors.find(f => f.id === room.floor_id) : null;
              
              const canReallocate = acc.status === "paid" && !!acc.room_id && !acc.checked_out;

              return (
                <tr key={acc.id} className="border-b border-black/5 last:border-0 hover:bg-black/[0.02]">
                  <td className="py-4 pr-2 pl-4">
                    <input 
                      type="checkbox" 
                      checked={selectedIds.has(acc.id)}
                      onChange={() => toggleSelection(acc.id)}
                      className="rounded border-black/20"
                    />
                  </td>
                  <td className="py-4 pr-4 font-mono text-xs text-black/60">{acc.participants?.participant_id}</td>
                  <td className="py-4 px-4 font-medium text-black">
                    {acc.participants?.name}
                    <div className="text-xs text-black/50 font-normal">{acc.participants?.email}</div>
                  </td>
                  <td className="py-4 px-4 uppercase text-xs">
                    {acc.participants?.gender || "—"}<br/>
                    <span className="text-black/50">{acc.participants?.state || "—"}</span>
                  </td>
                  <td className="py-4 px-4 text-black">{plan?.name || "Unknown"}</td>
                  <td className="py-4 px-4 uppercase text-xs font-semibold text-black">{acc.status}</td>
                  <td className="py-4 px-4">
                    {acc.status !== "paid" ? (
                      <span className="inline-block px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-red-50 text-red-700 border border-red-200">
                        Payment Pending
                      </span>
                    ) : acc.checked_out ? (
                      <div>
                        <span className="inline-block px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-purple-50 text-purple-700 border border-purple-200">
                          Checked Out
                        </span>
                        {acc.checked_out_at && (
                          <div className="text-[10px] text-black/40 mt-1 font-mono">
                            {new Date(acc.checked_out_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                          </div>
                        )}
                      </div>
                    ) : acc.checked_in ? (
                      <div>
                        <span className="inline-block px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Checked In
                        </span>
                        {acc.checked_in_at && (
                          <div className="text-[10px] text-black/40 mt-1 font-mono">
                            {new Date(acc.checked_in_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                          </div>
                        )}
                      </div>
                    ) : acc.room_id ? (
                      <span className="inline-block px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
                        Allocated
                      </span>
                    ) : (
                      <span className="inline-block px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-gray-100 text-gray-600 border border-gray-200">
                        Awaiting Allocation
                      </span>
                    )}
                  </td>
                  <td className="py-4 px-4 text-right">
                    {hostel?.name || <span className="text-black/30">Unallocated</span>}<br/>
                    {room ? (
                      <span className="text-black/50 text-xs">
                        {floor ? `Fl ${floor.floor_number} • ` : ""}Rm {room.room_number}
                      </span>
                    ) : ""}
                  </td>
                  <td className="py-4 pl-4 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      {acc.status !== "paid" ? (
                        <span className="text-xs text-black/40 italic">Payment Pending</span>
                      ) : !acc.room_id ? (
                        <button 
                          onClick={() => setAllocatingAcc(acc)} 
                          className="px-3 py-1.5 bg-black text-white rounded-full text-xs font-medium hover:bg-black/80 transition"
                        >
                          Allocate
                        </button>
                      ) : !acc.checked_in ? (
                        <>
                          <button 
                            onClick={() => handleCheckIn(acc)} 
                            disabled={actionLoadingId === acc.id}
                            className="px-3 py-1.5 bg-emerald-600 text-white rounded-full text-xs font-medium hover:bg-emerald-700 transition disabled:opacity-50"
                          >
                            {actionLoadingId === acc.id ? "Processing..." : "Check In"}
                          </button>
                          {canReallocate && (
                            <button 
                              onClick={() => setAllocatingAcc(acc)} 
                              className="px-3 py-1.5 border border-black/20 text-black rounded-full text-xs font-medium hover:bg-black/5 transition"
                            >
                              Reallocate
                            </button>
                          )}
                        </>
                      ) : !acc.checked_out ? (
                        <>
                          <button 
                            onClick={() => handleCheckOut(acc)} 
                            disabled={actionLoadingId === acc.id}
                            className="px-3 py-1.5 bg-black text-white rounded-full text-xs font-medium hover:bg-black/80 transition disabled:opacity-50"
                          >
                            {actionLoadingId === acc.id ? "Processing..." : "Check Out"}
                          </button>
                          {canReallocate && (
                            <button 
                              onClick={() => setAllocatingAcc(acc)} 
                              className="px-3 py-1.5 border border-black/20 text-black rounded-full text-xs font-medium hover:bg-black/5 transition"
                            >
                              Reallocate
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="text-xs font-medium text-purple-700">Checked Out</span>
                      )}
                      <button 
                        onClick={() => setHistoryAcc(acc)} 
                        className="ml-1 p-1.5 text-black/40 hover:text-black transition" 
                        title="History"
                      >
                        <History size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="py-8 text-center text-black/40">No registrations found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {allocatingAcc && (
        <AllocateModal 
          acc={allocatingAcc} 
          data={data} 
          onClose={() => setAllocatingAcc(null)} 
          onSuccess={() => { setAllocatingAcc(null); onRefresh(); }} 
        />
      )}

      {historyAcc && (
        <HistoryModal
          acc={historyAcc}
          onClose={() => setHistoryAcc(null)}
        />
      )}

      {bulkAction && (
        <BulkActionModal 
          action={bulkAction}
          selectedIds={Array.from(selectedIds)}
          data={data}
          onClose={() => setBulkAction(null)}
          onSuccess={() => {
            setBulkAction(null);
            clearSelection();
            onRefresh();
          }}
        />
      )}
    </div>
  );
}

function AllocateModal({ acc, data, onClose, onSuccess }: { acc: AccommodationRecord; data: DashboardData; onClose: () => void; onSuccess: () => void }) {
  const [hostelId, setHostelId] = useState(acc.hostel_id || "");
  const [floorId, setFloorId] = useState("");
  const [roomId, setRoomId] = useState(acc.room_id || "");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isReallocation = !!acc.room_id;

  // Filter eligible hostels by participant gender
  const participantGender = acc.participants?.gender?.trim().toLowerCase();
  const eligibleHostels = useMemo(() => {
    return data.hostels.filter(h => {
      if (!h.is_active) return false;
      if (h.gender_eligibility === "any" || h.gender_eligibility === "mixed") return true;
      return h.gender_eligibility === participantGender;
    });
  }, [data.hostels, participantGender]);

  // Available floors for selected hostel
  const availableFloors = useMemo(() => {
    if (!hostelId) return [];
    return data.floors.filter(f => f.hostel_id === hostelId && f.is_active);
  }, [hostelId, data.floors]);

  // Available rooms for selected floor or hostel
  const filteredRooms = useMemo(() => {
    if (!hostelId) return [];
    return data.rooms.filter(r => {
      if (r.hostel_id !== hostelId || !r.is_active) return false;
      if (floorId && r.floor_id !== floorId) return false;
      return true;
    });
  }, [hostelId, floorId, data.rooms]);

  const handleSubmit = async () => {
    if (!hostelId || !roomId) {
      setError("Please select both a hostel and a room.");
      return;
    }
    if (isReallocation && (!reason || reason.trim() === "")) {
      setError("Reason is required for reallocation.");
      return;
    }
    setSubmitting(true);
    setError("");

    try {
      const endpoint = isReallocation ? "/api/admin/accommodations/reallocate" : "/api/admin/accommodations/allocate";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantAccommodationId: acc.id,
          hostelId,
          roomId,
          reason
        })
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error?.message || "Failed to allocate.");
      
      onSuccess();
    } catch(err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to allocate.";
      setError(msg);
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg bg-white rounded-3xl p-8 shadow-2xl">
        <h2 className="text-2xl font-semibold mb-2 text-black">{isReallocation ? "Reallocate Participant" : "Allocate Participant"}</h2>
        <p className="text-sm text-black/50 mb-6">{acc.participants?.name} ({acc.participants?.gender || "Unknown"})</p>

        {error && <div className="mb-4 text-red-600 text-sm p-3 bg-red-50 rounded-xl">{error}</div>}

        <div className="flex flex-col gap-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-black/50 mb-2">Select Hostel</label>
            <select 
              value={hostelId} 
              onChange={e => { 
                setHostelId(e.target.value); 
                setFloorId(""); 
                setRoomId(""); 
              }} 
              className="w-full border border-black/10 rounded-xl px-4 py-3 bg-white text-black"
            >
              <option value="">-- Choose Hostel --</option>
              {eligibleHostels.map(h => (
                <option key={h.id} value={h.id}>{h.name} ({h.gender_eligibility})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-black/50 mb-2">Filter by Floor (Optional)</label>
            <select 
              value={floorId} 
              onChange={e => { 
                setFloorId(e.target.value); 
                setRoomId(""); 
              }} 
              disabled={!hostelId}
              className="w-full border border-black/10 rounded-xl px-4 py-3 bg-white text-black disabled:opacity-50"
            >
              <option value="">-- All Floors --</option>
              {availableFloors.map(f => (
                <option key={f.id} value={f.id}>
                  Floor {f.floor_number} {f.name ? `(${f.name})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-black/50 mb-2">Select Room</label>
            <select 
              value={roomId} 
              onChange={e => setRoomId(e.target.value)} 
              disabled={!hostelId} 
              className="w-full border border-black/10 rounded-xl px-4 py-3 bg-white text-black disabled:opacity-50"
            >
              <option value="">-- Choose Room --</option>
              {filteredRooms.map(r => {
                const occ = data.roomOccupancy[r.id] || 0;
                const isFull = occ >= r.capacity;
                const fl = data.floors.find(f => f.id === r.floor_id);
                return (
                  <option key={r.id} value={r.id} disabled={isFull && r.id !== acc.room_id}>
                    {fl ? `Fl ${fl.floor_number} • ` : ""}Room {r.room_number} (Available: {Math.max(0, r.capacity - occ)})
                  </option>
                );
              })}
            </select>
          </div>

          {isReallocation && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-black/50 mb-2">Reason</label>
              <input 
                type="text" 
                placeholder="e.g. Room maintenance, request" 
                value={reason} 
                onChange={e => setReason(e.target.value)} 
                className="w-full border border-black/10 rounded-xl px-4 py-3 text-black placeholder:text-black/40 bg-white" 
              />
            </div>
          )}

          <div className="flex justify-end gap-3 mt-4">
            <button 
              onClick={onClose} 
              className="px-5 py-2.5 bg-gray-100 rounded-full text-black/70 font-medium hover:bg-gray-200 transition"
            >
              Cancel
            </button>
            <button 
              onClick={handleSubmit} 
              disabled={submitting} 
              className="px-5 py-2.5 bg-black text-white rounded-full font-medium hover:bg-black/90 transition disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Confirm"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type HistoryItem = {
  id: string;
  hostels?: { name: string };
  hostel_rooms?: { room_number: string };
  status: string;
  allocated_at: string;
  deallocated_at?: string;
  reason?: string;
};

function HistoryModal({ acc, onClose }: { acc: AccommodationRecord; onClose: () => void }) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/admin/accommodations/history?participantAccommodationId=${acc.id}`)
      .then(res => res.json())
      .then(d => {
        if (d.success) setHistory(d.data);
        setLoading(false);
      });
  }, [acc.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl bg-white rounded-3xl p-8 max-h-[80vh] flex flex-col shadow-2xl">
        <h2 className="text-2xl font-semibold mb-2 text-black">Allocation History</h2>
        <p className="text-sm text-black/50 mb-6">{acc.participants?.name}</p>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-black/40">Loading history...</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-black/40">No allocation history found.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {history.map(h => (
                <div key={h.id} className="border border-black/10 rounded-2xl p-5 bg-white">
                  <div className="flex justify-between items-start mb-2">
                    <div className="font-semibold text-black">{h.hostels?.name} - Rm {h.hostel_rooms?.room_number}</div>
                    <div className={`text-xs px-2 py-1 rounded uppercase font-semibold ${h.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{h.status}</div>
                  </div>
                  <div className="text-xs text-black/50 flex flex-col gap-1">
                    <p>Allocated: {new Date(h.allocated_at).toLocaleString()}</p>
                    {h.deallocated_at && <p>Deallocated: {new Date(h.deallocated_at).toLocaleString()}</p>}
                    <p>Reason: {h.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <button 
            onClick={onClose} 
            className="px-5 py-2.5 bg-black text-white rounded-full font-medium hover:bg-black/90 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, dark }: { title: string; value: string | number; icon: React.ReactNode; dark?: boolean }) {
  return (
    <div className={`rounded-[28px] p-7 ${dark ? "bg-black text-white" : "bg-white border border-black/5 shadow-sm"}`}>
      <div className={`flex h-10 w-10 items-center justify-center rounded-full ${dark ? "bg-white/10" : "bg-black/[0.04]"}`}>
        {icon}
      </div>
      <p className={`mt-7 text-[9px] font-semibold uppercase tracking-[0.2em] ${dark ? "text-white/40" : "text-black/35"}`}>
        {title}
      </p>
      <p className={`mt-2 text-4xl font-semibold tracking-[-0.05em] ${dark ? "text-white" : "text-black"}`}>
        {value}
      </p>
    </div>
  );
}


// --- PHASE 3C REPORTING COMPONENTS --- //

function exportCSV(filename: string, headers: string[], rows: (string|number)[][]) {
  const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function exportHostels(data: DashboardData) {
  const headers = ["Hostel Name", "Gender Eligibility", "Total Floors", "Total Rooms", "Total Capacity", "Occupied", "Available", "Occupancy %", "Status"];
  const rows = data.hostels.map(h => {
    const floorsCount = data.floors.filter(f => f.hostel_id === h.id).length;
    const hostelRooms = data.rooms.filter(r => r.hostel_id === h.id);
    const totalCap = hostelRooms.reduce((sum, r) => sum + r.capacity, 0);
    const occupied = data.hostelOccupancy[h.id] || 0;
    const available = Math.max(0, totalCap - occupied);
    const occPct = totalCap > 0 ? Math.round((occupied/totalCap)*100) : 0;
    return [`"${h.name.replace(/"/g, '""')}"`, h.gender_eligibility, floorsCount, hostelRooms.length, totalCap, occupied, available, `${occPct}%`, h.is_active ? "Active" : "Inactive"];
  });
  exportCSV("saviskar-accommodation-hostels.csv", headers, rows);
}

function exportFloors(data: DashboardData) {
  const headers = ["Hostel Name", "Floor Number", "Floor Name", "Rooms", "Capacity", "Occupied", "Available", "Occupancy %", "Status"];
  const rows = data.floors.map(f => {
    const h = data.hostels.find(x => x.id === f.hostel_id);
    const floorRooms = data.rooms.filter(r => r.floor_id === f.id);
    const cap = floorRooms.reduce((sum, r) => sum + r.capacity, 0);
    const occ = data.floorOccupancy[f.id] || 0;
    const available = Math.max(0, cap - occ);
    const pct = cap > 0 ? Math.round((occ/cap)*100) : 0;
    return [`"${(h?.name||"").replace(/"/g, '""')}"`, f.floor_number, `"${(f.name||"").replace(/"/g, '""')}"`, floorRooms.length, cap, occ, available, `${pct}%`, f.is_active ? "Active" : "Inactive"];
  });
  exportCSV("saviskar-accommodation-floors.csv", headers, rows);
}

function exportRooms(data: DashboardData) {
  const headers = ["Hostel", "Floor", "Room Number", "Capacity", "Occupied", "Available", "Status", "Active"];
  const rows = data.rooms.map(r => {
    const h = data.hostels.find(x => x.id === r.hostel_id);
    const f = data.floors.find(x => x.id === r.floor_id);
    const occ = data.roomOccupancy[r.id] || 0;
    const avail = Math.max(0, r.capacity - occ);
    const status = occ === 0 ? "AVAILABLE" : occ >= r.capacity ? "FULL" : "PARTIALLY OCCUPIED";
    return [`"${(h?.name||"").replace(/"/g, '""')}"`, f ? f.floor_number : "", `"${(r.room_number||"").replace(/"/g, '""')}"`, r.capacity, occ, avail, status, r.is_active ? "Yes" : "No"];
  });
  exportCSV("saviskar-accommodation-rooms.csv", headers, rows);
}

function PaymentsReport({ data }: { data: DashboardData }) {
  const [filter, setFilter] = useState("all");
  
  const filtered = data.accommodations.filter(a => filter === "all" || a.status === filter);

  const handleExport = () => {
    const headers = ["Participant ID", "Participant Name", "Plan", "Amount", "Currency", "Payment Status", "Created At"];
    const rows = filtered.map(a => {
      const p = data.plans.find(x => x.id === a.accommodation_plan_id);
      return [a.participants?.participant_id || "", `"${(a.participants?.name||"").replace(/"/g, '""')}"`, `"${(p?.name||"").replace(/"/g, '""')}"`, a.amount, a.currency, a.status, new Date(a.created_at).toLocaleString()];
    });
    exportCSV("saviskar-accommodation-payments.csv", headers, rows);
  };

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm border border-black/5">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-black">Payment Reconciliation</h2>
        <div className="flex gap-3">
          <select value={filter} onChange={e => setFilter(e.target.value)} className="border border-black/10 rounded-full px-4 py-2 text-sm bg-white text-black">
            <option value="all">All Payments</option>
            <option value="paid">PAID</option>
            <option value="pending">PENDING</option>
            <option value="unpaid">UNPAID</option>
            <option value="failed">FAILED</option>
            <option value="cancelled">CANCELLED</option>
          </select>
          <button onClick={handleExport} className="px-4 py-2 rounded-full border border-black/20 text-sm hover:bg-black/5 transition text-black font-medium">Export CSV</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-black/10 text-black/40">
              <th className="pb-3 pr-4 font-semibold">Participant</th>
              <th className="pb-3 px-4 font-semibold">Plan</th>
              <th className="pb-3 px-4 font-semibold">Amount</th>
              <th className="pb-3 px-4 font-semibold">Status</th>
              <th className="pb-3 px-4 font-semibold">Date</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(a => {
              const p = data.plans.find(x => x.id === a.accommodation_plan_id);
              return (
                <tr key={a.id} className="border-b border-black/5 hover:bg-black/[0.02]">
                  <td className="py-4 pr-4">
                    <div className="font-medium text-black">{a.participants?.name}</div>
                    <div className="text-xs text-black/50">{a.participants?.participant_id}</div>
                  </td>
                  <td className="py-4 px-4 text-black">{p?.name}</td>
                  <td className="py-4 px-4 text-black">{a.amount} {a.currency}</td>
                  <td className="py-4 px-4 font-semibold uppercase text-xs">{a.status}</td>
                  <td className="py-4 px-4 text-black/50 text-xs">{new Date(a.created_at).toLocaleString()}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-black/40">No payments found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AllocationsReport({ data }: { data: DashboardData }) {
  const [filter, setFilter] = useState("all");
  const filtered = data.accommodations.filter(a => {
    if (a.status !== "paid") return false;
    if (filter === "allocated") return !!a.room_id;
    if (filter === "awaiting") return !a.room_id;
    return true;
  });

  const handleExport = () => {
    const headers = ["Participant", "Gender", "Plan", "Hostel", "Floor", "Room", "Room Capacity", "Occupancy", "Status"];
    const rows = filtered.map(a => {
      const h = data.hostels.find(x => x.id === a.hostel_id);
      const r = data.rooms.find(x => x.id === a.room_id);
      const f = r ? data.floors.find(x => x.id === r.floor_id) : null;
      const pl = data.plans.find(x => x.id === a.accommodation_plan_id);
      const status = a.room_id ? "ALLOCATED" : "AWAITING ALLOCATION";
      const occ = r ? data.roomOccupancy[r.id] || 0 : 0;
      return [`"${(a.participants?.name||"").replace(/"/g, '""')}"`, a.participants?.gender||"", `"${(pl?.name||"").replace(/"/g, '""')}"`, `"${(h?.name||"").replace(/"/g, '""')}"`, f?.floor_number||"", `"${(r?.room_number||"").replace(/"/g, '""')}"`, r?.capacity||"", occ, status];
    });
    exportCSV("saviskar-accommodation-allocation.csv", headers, rows);
  };

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm border border-black/5">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-black">Allocation Report</h2>
        <div className="flex gap-3">
          <select value={filter} onChange={e => setFilter(e.target.value)} className="border border-black/10 rounded-full px-4 py-2 text-sm bg-white text-black">
            <option value="all">All Paid Accommodations</option>
            <option value="allocated">Allocated</option>
            <option value="awaiting">Awaiting Allocation</option>
          </select>
          <button onClick={handleExport} className="px-4 py-2 rounded-full border border-black/20 text-sm hover:bg-black/5 transition text-black font-medium">Export CSV</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-black/10 text-black/40">
              <th className="pb-3 pr-4 font-semibold">Participant</th>
              <th className="pb-3 px-4 font-semibold">Gender</th>
              <th className="pb-3 px-4 font-semibold">Hostel</th>
              <th className="pb-3 px-4 font-semibold">Floor / Room</th>
              <th className="pb-3 px-4 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(a => {
              const h = data.hostels.find(x => x.id === a.hostel_id);
              const r = data.rooms.find(x => x.id === a.room_id);
              const f = r ? data.floors.find(x => x.id === r.floor_id) : null;
              return (
                <tr key={a.id} className="border-b border-black/5 hover:bg-black/[0.02]">
                  <td className="py-4 pr-4">
                    <div className="font-medium text-black">{a.participants?.name}</div>
                    <div className="text-xs text-black/50">{a.participants?.participant_id}</div>
                  </td>
                  <td className="py-4 px-4 uppercase text-xs text-black">{a.participants?.gender}</td>
                  <td className="py-4 px-4 text-black">{h?.name || "—"}</td>
                  <td className="py-4 px-4 text-black">{r ? `Fl ${f?.floor_number} / Rm ${r.room_number}` : "—"}</td>
                  <td className="py-4 px-4">
                    {a.room_id ? (
                      <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-1 rounded">ALLOCATED</span>
                    ) : (
                      <span className="text-xs font-semibold text-orange-700 bg-orange-50 px-2 py-1 rounded">AWAITING</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-black/40">No allocations found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LifecycleReport({ data }: { data: DashboardData }) {
  const [filter, setFilter] = useState("all");
  const filtered = data.accommodations.filter(a => {
    if (a.status !== "paid") return false;
    if (filter === "checked_in") return a.checked_in && !a.checked_out;
    if (filter === "checked_out") return a.checked_out;
    if (filter === "not_checked_in") return a.room_id && !a.checked_in;
    return true;
  });

  const handleExport = () => {
    const headers = ["Participant", "Hostel/Room", "Allocated", "Checked In", "Checked In At", "Checked Out", "Checked Out At"];
    const rows = filtered.map(a => {
      const h = data.hostels.find(x => x.id === a.hostel_id);
      const r = data.rooms.find(x => x.id === a.room_id);
      return [`"${(a.participants?.name||"").replace(/"/g, '""')}"`, `"${(h?.name||"")} / Rm ${(r?.room_number||"")}"`, a.room_id?"Yes":"No", a.checked_in?"Yes":"No", a.checked_in_at||"", a.checked_out?"Yes":"No", a.checked_out_at||""];
    });
    exportCSV("saviskar-accommodation-lifecycle.csv", headers, rows);
  };

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm border border-black/5">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-black">Check-in / Check-out Lifecycle</h2>
        <div className="flex gap-3">
          <select value={filter} onChange={e => setFilter(e.target.value)} className="border border-black/10 rounded-full px-4 py-2 text-sm bg-white text-black">
            <option value="all">All Paid Accommodations</option>
            <option value="checked_in">Checked In</option>
            <option value="checked_out">Checked Out</option>
            <option value="not_checked_in">Allocated, Not Checked In</option>
          </select>
          <button onClick={handleExport} className="px-4 py-2 rounded-full border border-black/20 text-sm hover:bg-black/5 transition text-black font-medium">Export CSV</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-black/10 text-black/40">
              <th className="pb-3 pr-4 font-semibold">Participant</th>
              <th className="pb-3 px-4 font-semibold">Allocation</th>
              <th className="pb-3 px-4 font-semibold">Check-in</th>
              <th className="pb-3 px-4 font-semibold">Check-out</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(a => {
              const h = data.hostels.find(x => x.id === a.hostel_id);
              const r = data.rooms.find(x => x.id === a.room_id);
              return (
                <tr key={a.id} className="border-b border-black/5 hover:bg-black/[0.02]">
                  <td className="py-4 pr-4 font-medium text-black">{a.participants?.name}</td>
                  <td className="py-4 px-4 text-black">{a.room_id ? `${h?.name} / Rm ${r?.room_number}` : "Not Allocated"}</td>
                  <td className="py-4 px-4">
                    {a.checked_in ? (
                      <div className="text-emerald-700 text-xs font-semibold">
                        YES <div className="text-black/50 font-normal">{new Date(a.checked_in_at!).toLocaleString()}</div>
                      </div>
                    ) : "NO"}
                  </td>
                  <td className="py-4 px-4">
                    {a.checked_out ? (
                      <div className="text-purple-700 text-xs font-semibold">
                        YES <div className="text-black/50 font-normal">{new Date(a.checked_out_at!).toLocaleString()}</div>
                      </div>
                    ) : "NO"}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-black/40">No lifecycle data found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExceptionsReport({ data }: { data: DashboardData }) {
  const exceptions: any[] = [];
  
  data.accommodations.forEach(a => {
    if (a.status === "paid" && !a.room_id) {
      exceptions.push({ acc: a, type: "PAID_UNALLOCATED", desc: "Paid accommodation but no room allocated." });
    }
    if (a.status === "paid" && a.room_id && !a.checked_in) {
      exceptions.push({ acc: a, type: "ALLOCATED_NOT_CHECKED_IN", desc: "Room allocated but participant has not checked in." });
    }
    if ((a.status === "pending" || a.status === "unpaid") && !a.room_id) {
      exceptions.push({ acc: a, type: "SELECTED_UNPAID", desc: "Accommodation selected but payment not completed." });
    }
  });

  data.rooms.forEach(r => {
    const occ = data.roomOccupancy[r.id] || 0;
    if (occ > r.capacity) {
      exceptions.push({ type: "OVER_CAPACITY", desc: `Room ${r.room_number} occupancy (${occ}) exceeds capacity (${r.capacity}).` });
    }
  });

  const handleExport = () => {
    const headers = ["Exception Type", "Description", "Participant", "Participant ID"];
    const rows = exceptions.map(ex => [ex.type, `"${ex.desc.replace(/"/g, '""')}"`, `"${(ex.acc?.participants?.name||"").replace(/"/g, '""')}"`, ex.acc?.participants?.participant_id || ""]);
    exportCSV("saviskar-accommodation-exceptions.csv", headers, rows);
  };

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm border border-black/5">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-black">Exceptions & Reconciliation</h2>
        <button onClick={handleExport} className="px-4 py-2 rounded-full border border-black/20 text-sm hover:bg-black/5 transition text-black font-medium">Export CSV</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-black/10 text-black/40">
              <th className="pb-3 pr-4 font-semibold">Type</th>
              <th className="pb-3 px-4 font-semibold">Description</th>
              <th className="pb-3 px-4 font-semibold">Participant</th>
            </tr>
          </thead>
          <tbody>
            {exceptions.map((ex, idx) => (
              <tr key={idx} className="border-b border-black/5 hover:bg-black/[0.02]">
                <td className="py-4 pr-4 font-semibold text-xs uppercase text-red-600">{ex.type}</td>
                <td className="py-4 px-4 text-black">{ex.desc}</td>
                <td className="py-4 px-4 font-medium text-black">
                  {ex.acc ? `${ex.acc.participants?.name} (${ex.acc.participants?.participant_id})` : "—"}
                </td>
              </tr>
            ))}
            {exceptions.length === 0 && (
              <tr><td colSpan={3} className="py-8 text-center text-black/40">No exceptions detected.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistoryReport() {
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [actionFilter, setActionFilter] = useState("ALL");
  const [bulkFilter, setBulkFilter] = useState("ALL");
  const [participantSearch, setParticipantSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState(""); // to prevent firing on every keystroke

  const fetchActivities = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({
      page: page.toString(),
      pageSize: "25"
    });
    if (actionFilter !== "ALL") params.set("action", actionFilter);
    if (bulkFilter !== "ALL") params.set("bulk", bulkFilter);
    if (activeSearch) params.set("participant", activeSearch);

    fetch('/api/admin/accommodations/activity?' + params.toString())
      .then(res => res.json())
      .then(d => {
        if (d.success) {
          setActivities(d.data.activities);
          setTotalPages(d.data.totalPages);
          setTotalCount(d.data.totalCount);
        }
        setLoading(false);
      });
  }, [page, actionFilter, bulkFilter, activeSearch]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setActiveSearch(participantSearch);
  };

  const handleExport = () => {
    const headers = [
      "Timestamp", "Action", "Admin", "Participant ID", "Participant Name", 
      "Hostel", "Floor", "Room", "Previous State", "New State", "Reason", "Bulk Operation"
    ];
    const rows = activities.map(a => [
      new Date(a.timestamp).toLocaleString(),
      a.action,
      `"${(a.admin_email || "System").replace(/"/g, '""')}"`,
      a.participant_id,
      `"${(a.participant_name || "").replace(/"/g, '""')}"`,
      `"${(a.hostel_name || "").replace(/"/g, '""')}"`,
      a.floor_number || "",
      `"${(a.room_number || "").replace(/"/g, '""')}"`,
      a.previous_state || "",
      a.new_state || "",
      `"${(a.reason || "").replace(/"/g, '""')}"`,
      a.bulk_operation ? "Yes" : "No"
    ]);
    exportCSV("saviskar-accommodation-activity.csv", headers, rows);
  };

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm border border-black/5">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h2 className="text-xl font-semibold text-black">Operational Activity & Audit</h2>
          <p className="text-sm text-black/50 mt-1">Trace all allocations, reallocations, check-ins, and check-outs.</p>
        </div>
        <button onClick={handleExport} className="px-4 py-2 rounded-full border border-black/20 text-sm hover:bg-black/5 transition text-black font-medium whitespace-nowrap">
          Export CSV (Current Page)
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <form onSubmit={handleSearch} className="flex-1 flex gap-2">
          <input 
            type="text" 
            placeholder="Search Participant ID or Name..." 
            value={participantSearch}
            onChange={e => setParticipantSearch(e.target.value)}
            className="flex-1 bg-black/5 border border-transparent rounded-xl px-4 py-2 text-sm text-black focus:outline-none focus:border-black/20"
          />
          <button type="submit" className="bg-black text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-black/80 transition">Search</button>
        </form>
        
        <select 
          value={actionFilter} 
          onChange={e => { setActionFilter(e.target.value); setPage(1); }}
          className="bg-black/5 border border-transparent rounded-xl px-4 py-2 text-sm text-black focus:outline-none focus:border-black/20"
        >
          <option value="ALL">All Actions</option>
          <option value="ALLOCATION">Allocation</option>
          <option value="REALLOCATION">Reallocation</option>
          <option value="CHECK_IN">Check-In</option>
          <option value="CHECK_OUT">Check-Out</option>
        </select>

        <select 
          value={bulkFilter} 
          onChange={e => { setBulkFilter(e.target.value); setPage(1); }}
          className="bg-black/5 border border-transparent rounded-xl px-4 py-2 text-sm text-black focus:outline-none focus:border-black/20"
        >
          <option value="ALL">All Types</option>
          <option value="false">Individual Only</option>
          <option value="true">Bulk Only</option>
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-black/10 text-black/40">
              <th className="pb-3 pr-4 font-semibold">Timestamp / Actor</th>
              <th className="pb-3 px-4 font-semibold">Participant</th>
              <th className="pb-3 px-4 font-semibold">Action & Status</th>
              <th className="pb-3 px-4 font-semibold">Location</th>
              <th className="pb-3 px-4 font-semibold">Reason</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={5} className="py-8 text-center text-black/40">Loading activity...</td></tr> : 
             activities.map((h, i) => (
              <tr key={h.id || i} className="border-b border-black/5 hover:bg-black/[0.02]">
                <td className="py-4 pr-4">
                  <div className="font-medium text-black">{new Date(h.timestamp).toLocaleString()}</div>
                  <div className="text-xs text-black/40 truncate max-w-[150px]" title={h.admin_email || h.admin_id}>{h.admin_email || h.admin_id}</div>
                </td>
                <td className="py-4 px-4 font-medium text-black">
                  {h.participant_name}
                  <div className="text-xs text-black/40">{h.participant_id}</div>
                </td>
                <td className="py-4 px-4">
                  <div className="font-semibold uppercase text-xs text-black">{h.action} {h.bulk_operation && <span className="bg-black/10 text-black px-1.5 py-0.5 rounded ml-1">BULK</span>}</div>
                  <div className="text-xs text-black/50 mt-0.5">{h.previous_state} → {h.new_state}</div>
                </td>
                <td className="py-4 px-4 text-black text-xs">
                  {h.hostel_name !== "Unknown" ? (
                    <>
                      <div className="font-medium">{h.hostel_name}</div>
                      <div className="text-black/50">Fl {h.floor_number} / Rm {h.room_number}</div>
                    </>
                  ) : "—"}
                </td>
                <td className="py-4 px-4 text-black/70 text-xs">
                  {h.reason || "—"}
                </td>
              </tr>
            ))}
            {!loading && activities.length === 0 && (
              <tr><td colSpan={5} className="py-8 text-center text-black/40">No activity history found matching your filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {!loading && totalPages > 1 && (
        <div className="flex justify-between items-center mt-6">
          <div className="text-xs text-black/40">Showing {(page - 1) * 25 + 1} to {Math.min(page * 25, totalCount)} of {totalCount} records</div>
          <div className="flex gap-2">
            <button 
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 text-sm border border-black/10 rounded hover:bg-black/5 disabled:opacity-30 transition text-black"
            >
              Previous
            </button>
            <button 
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 text-sm border border-black/10 rounded hover:bg-black/5 disabled:opacity-30 transition text-black"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BulkActionModal({ action, selectedIds, data, onClose, onSuccess }: { action: "allocate" | "check-in" | "check-out"; selectedIds: string[]; data: DashboardData; onClose: () => void; onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{allocated?: number, success?: number, skipped?: number, failed: number, results: any[]} | null>(null);
  
  const selectedAccs = selectedIds.map(id => data.accommodations.find(a => a.id === id)).filter(Boolean) as AccommodationRecord[];
  
  const eligible = selectedAccs.filter(acc => {
    if (acc.status !== "paid") return false;
    if (action === "allocate") return !acc.room_id;
    if (action === "check-in") return acc.room_id && !acc.checked_in && !acc.checked_out;
    if (action === "check-out") return acc.checked_in && !acc.checked_out;
    return false;
  });

  const ineligible = selectedAccs.length - eligible.length;

  const handleExecute = async () => {
    setLoading(true);
    try {
      let endpoint = "";
      if (action === "allocate") endpoint = "/api/admin/accommodations/auto-allocate";
      if (action === "check-in") endpoint = "/api/admin/accommodations/bulk-check-in";
      if (action === "check-out") endpoint = "/api/admin/accommodations/bulk-check-out";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantAccommodationIds: selectedIds })
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error?.message || "Failed");
      setResult(payload.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error";
      alert("Error: " + msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg bg-white rounded-3xl p-8 shadow-2xl">
        <h2 className="text-2xl font-semibold mb-2 text-black capitalize">Bulk {action}</h2>
        <p className="text-sm text-black/50 mb-6">Confirm your bulk action below.</p>
        
        {!result ? (
          <div className="flex flex-col gap-4">
            <div className="bg-gray-50 rounded-xl p-4 border border-black/10">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-black">Total Selected</span>
                <span className="text-sm font-bold text-black">{selectedAccs.length}</span>
              </div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-emerald-700">Eligible</span>
                <span className="text-sm font-bold text-emerald-700">{eligible.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-red-700">Ineligible (Skipped)</span>
                <span className="text-sm font-bold text-red-700">{ineligible}</span>
              </div>
            </div>
            
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={onClose} disabled={loading} className="px-5 py-2.5 bg-gray-100 rounded-full text-black/70 font-medium hover:bg-gray-200 transition disabled:opacity-50">Cancel</button>
              <button onClick={handleExecute} disabled={loading || eligible.length === 0} className="px-5 py-2.5 bg-black text-white rounded-full font-medium hover:bg-black/90 transition disabled:opacity-50">
                {loading ? "Processing..." : `Confirm ${action}`}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200 text-emerald-800">
              <h3 className="font-semibold mb-2">Operation Complete</h3>
              <p className="text-sm">Success: {result.allocated !== undefined ? result.allocated : result.success}</p>
              <p className="text-sm text-black/50">Skipped/Failed: {(result.skipped || 0) + (result.failed || 0)}</p>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={onSuccess} className="px-5 py-2.5 bg-black text-white rounded-full font-medium hover:bg-black/90 transition">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
