"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import AdminPageLoader from "@/components/admin/AdminPageLoader";
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Download,
  ExternalLink,
  GraduationCap,
  Layers,
  MapPin,
  PieChart,
  QrCode,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
  Bed,
  Shield,
  SlidersHorizontal,
  Lock,
  Building2,
  X,
} from "lucide-react";

/* =========================================================
   TYPES
========================================================= */

type AdminRole = "master" | "admin";

type StateMetric = {
  state: string;
  participantCount: number;
  eventRegistrations: number;
  percentage: number;
  topColleges: string[];
};

type EventMetric = {
  id: string;
  name: string;
  category: string;
  registrationType: string;
  registrationFee: number;
  registrationLimit: number | null;
  active: boolean;
  count: number;
  checkedIn: number;
  fillRate: number | null;
  revenue?: number;
};

type CategoryMetric = {
  category: string;
  count: number;
  eventCount: number;
  checkedIn: number;
  percentage: number;
};

type CollegeMetric = {
  college: string;
  count: number;
  state: string | null;
};

type CollegeOption = {
  college: string;
  count: number;
};

type GenderStats = {
  male: number;
  female: number;
  other: number;
  unspecified: number;
};

type RevenueBreakdown = {
  totalExpected: number;
  totalPaid: number;
  totalOutstanding: number;
  events: {
    expected: number;
    paid: number;
    outstanding: number;
  };
  accommodations: {
    expected: number;
    paid: number;
    outstanding: number;
  };
};

type OverviewStats = {
  totalParticipants: number;
  eventParticipantCount?: number;
  accommodationOnlyCount?: number;
  withAccommodation: number;
  withoutAccommodation: number;
  totalHeadcount: number;
  headcountWithAccommodation: number;
  headcountWithoutAccommodation: number;
  totalRegistrations: number;
  registrationsWithAccommodation: number;
  registrationsWithoutAccommodation: number;
  totalTeams: number;
  totalSolo: number;
  totalCheckedIn: number;
  checkInRate: number;
  totalColleges: number;
  totalStates: number;
  revenue: RevenueBreakdown | null;
};

type AccommodationStats = {
  totalBookings: number;
  paidBookings: number;
  pendingBookings: number;
  checkedIn: number;
  dateOccupancy: { date: string; count: number }[];
  expectedRevenue?: number;
  paidRevenue?: number;
  outstandingRevenue?: number;
};

type AnalyticsPayload = {
  success: boolean;
  isMaster: boolean;
  role: AdminRole;
  assignedCategory: string | null;
  assignedEvents: string[] | null;
  availableCategories: string[];
  selectedCategory: string;
  availableColleges: CollegeOption[];
  selectedCollege: string;
  categoryScopeLabel: string;
  accommodationAccess: boolean;
  overview: OverviewStats;
  stateWise: StateMetric[];
  eventWise: EventMetric[];
  categories: CategoryMetric[];
  demographics: {
    gender: GenderStats;
    topColleges: CollegeMetric[];
  };
  timeline: { date: string; count: number }[];
  accommodations: AccommodationStats | null;
};

type TabType = "states" | "events" | "demographics" | "accommodations";

/* =========================================================
   COMPONENT
========================================================= */

export default function AdminAnalyticsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<AnalyticsPayload | null>(null);

  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedCollege, setSelectedCollege] = useState("all");
  const [collegeSearch, setCollegeSearch] = useState("");
  const [showCollegeDropdown, setShowCollegeDropdown] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("states");
  const [stateSearch, setStateSearch] = useState("");
  const [eventSearch, setEventSearch] = useState("");
  const [eventCategoryFilter, setEventCategoryFilter] = useState("all");
  const [eventSortBy, setEventSortBy] = useState<"count" | "name" | "fillRate" | "checkedIn">("count");
  const [showExportMenu, setShowExportMenu] = useState(false);

  /* =======================================================
     FETCH DATA
  ======================================================= */
  const loadAnalytics = useCallback(
    async (
      isRefresh = false,
      categoryOverride?: string,
      collegeOverride?: string
    ) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");

      try {
        const catParam =
          categoryOverride !== undefined ? categoryOverride : selectedCategory;
        const colParam =
          collegeOverride !== undefined ? collegeOverride : selectedCollege;

        const params = new URLSearchParams();
        if (catParam && catParam !== "all") params.set("category", catParam);
        if (colParam && colParam !== "all") params.set("college", colParam);

        const qs = params.toString();
        const url = qs ? `/api/admin/analytics?${qs}` : "/api/admin/analytics";

        const res = await fetch(url, { cache: "no-store" });
        if (res.status === 401 || res.status === 403) {
          router.replace("/admin/login");
          return;
        }
        const json = (await res.json()) as AnalyticsPayload;
        if (!res.ok || !json.success) {
          throw new Error((json as any).error || "Failed to load analytics");
        }
        setData(json);
        if (json.selectedCategory) {
          setSelectedCategory(json.selectedCategory);
        }
        if (json.selectedCollege) {
          setSelectedCollege(json.selectedCollege);
        }
      } catch (err: any) {
        console.error("Failed to load analytics:", err);
        setError(err.message || "Failed to load analytics");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router, selectedCategory, selectedCollege]
  );

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  /* =======================================================
     DERIVED DATA & PERMISSIONS
  ======================================================= */
  const role = data?.role ?? "admin";
  const isMaster = data?.isMaster ?? (role === "master");
  const overview = data?.overview;
  const availableCategories = useMemo(
    () => data?.availableCategories ?? [],
    [data?.availableCategories]
  );
  const availableColleges = useMemo(
    () => data?.availableColleges ?? [],
    [data?.availableColleges]
  );
  const isCategoryScoped =
    !isMaster &&
    (!!data?.assignedCategory || (data?.assignedEvents && data.assignedEvents.length > 0));

  const roleBadgeLabel = useMemo(() => {
    if (isMaster) return "Master Administrator";
    if (availableCategories.length === 1) {
      return `${availableCategories[0].replace("-", " ").toUpperCase()} Category Admin`;
    }
    if (availableCategories.length > 1 && isCategoryScoped) {
      return `${availableCategories
        .map((c) => c.replace("-", " ").toUpperCase())
        .join(" & ")} Category Admin`;
    }
    if (data?.assignedEvents && data.assignedEvents.length > 0) {
      return "Event-Scoped Admin";
    }
    return "Standard Admin";
  }, [isMaster, availableCategories, isCategoryScoped, data?.assignedEvents]);

  const handleCategorySwitch = (newCat: string) => {
    if (newCat === selectedCategory) return;
    setSelectedCategory(newCat);
    loadAnalytics(true, newCat, selectedCollege);
  };

  const handleCollegeSwitch = (newCollege: string) => {
    if (newCollege === selectedCollege) return;
    setSelectedCollege(newCollege);
    setShowCollegeDropdown(false);
    setCollegeSearch("");
    loadAnalytics(true, selectedCategory, newCollege);
  };

  const filteredCollegeOptions = useMemo(() => {
    if (!collegeSearch.trim()) return availableColleges;
    const q = collegeSearch.toLowerCase().trim();
    return availableColleges.filter((c) =>
      c.college.toLowerCase().includes(q)
    );
  }, [availableColleges, collegeSearch]);

  // Filtered State List
  const stateWise = data?.stateWise;
  const filteredStates = useMemo(() => {
    if (!stateWise) return [];
    if (!stateSearch.trim()) return stateWise;
    const q = stateSearch.toLowerCase().trim();
    return stateWise.filter(
      (s) =>
        s.state.toLowerCase().includes(q) ||
        s.topColleges.some((c) => c.toLowerCase().includes(q))
    );
  }, [stateWise, stateSearch]);

  // Filtered and Sorted Event List
  const eventWise = data?.eventWise;
  const filteredEvents = useMemo(() => {
    if (!eventWise) return [];
    let list = [...eventWise];

    if (eventCategoryFilter !== "all") {
      list = list.filter(
        (e) => e.category.toLowerCase().trim() === eventCategoryFilter.toLowerCase().trim()
      );
    }

    if (eventSearch.trim()) {
      const q = eventSearch.toLowerCase().trim();
      list = list.filter((e) => e.name.toLowerCase().includes(q));
    }

    list.sort((a, b) => {
      if (eventSortBy === "name") return a.name.localeCompare(b.name);
      if (eventSortBy === "fillRate") return (b.fillRate ?? 0) - (a.fillRate ?? 0);
      if (eventSortBy === "checkedIn") return b.checkedIn - a.checkedIn;
      return b.count - a.count;
    });

    return list;
  }, [eventWise, eventCategoryFilter, eventSearch, eventSortBy]);

  /* =======================================================
     CSV EXPORTERS
  ======================================================= */
  const exportStatesCsv = useCallback(() => {
    if (!stateWise) return;
    const headers = ["State", "Participants", "Event Registrations", "Share (%)", "Top Colleges"];
    const rows = stateWise.map((s) => [
      `"${s.state.replace(/"/g, '""')}"`,
      s.participantCount,
      s.eventRegistrations,
      `${s.percentage}%`,
      `"${s.topColleges.join("; ").replace(/"/g, '""')}"`,
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const colSlug =
      selectedCollege === "all"
        ? "all_colleges"
        : selectedCollege.replace(/[^a-zA-Z0-9]/g, "_");
    link.setAttribute(
      "download",
      `saviskar_2026_state_analytics_${selectedCategory}_${colSlug}_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setShowExportMenu(false);
  }, [stateWise, selectedCategory, selectedCollege]);

  const exportEventsCsv = useCallback(() => {
    if (!eventWise) return;
    const baseHeaders = [
      "Event Name",
      "Category",
      "Type",
      "Registrations",
      "Capacity Limit",
      "Fill Rate (%)",
      "Checked-In",
    ];
    if (isMaster) baseHeaders.push("Revenue (INR)");

    const rows = eventWise.map((e) => {
      const r = [
        `"${e.name.replace(/"/g, '""')}"`,
        `"${e.category.replace(/"/g, '""')}"`,
        e.registrationType,
        e.count,
        e.registrationLimit ?? "Unlimited",
        e.fillRate !== null ? `${e.fillRate}%` : "N/A",
        e.checkedIn,
      ];
      if (isMaster) {
        r.push(e.revenue ?? 0);
      }
      return r;
    });

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [baseHeaders.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const colSlug =
      selectedCollege === "all"
        ? "all_colleges"
        : selectedCollege.replace(/[^a-zA-Z0-9]/g, "_");
    link.setAttribute(
      "download",
      `saviskar_2026_event_analytics_${selectedCategory}_${colSlug}_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setShowExportMenu(false);
  }, [eventWise, isMaster, selectedCategory, selectedCollege]);

  /* =======================================================
     LOADING STATE
  ======================================================= */
  if (loading && !data) {
    return (
      <AdminPageLoader
        heading="Loading Scoped Analytics..."
        subtext="Aggregating authorized real-time state distributions, category performance, and delegate metrics."
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f5f5] px-5 py-10 md:px-10 lg:px-16 text-black">
      <div className="mx-auto max-w-[1500px]">

        {/* =======================================================
            HEADER
        ======================================================= */}
        <div className="mb-8 flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <button
                type="button"
                onClick={() => router.push("/admin")}
                className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-semibold text-black/60 hover:text-black hover:bg-black/5 transition shadow-sm"
              >
                <ArrowLeft size={13} />
                <span>Registrations</span>
              </button>
              <span className="text-[10px] font-semibold uppercase tracking-[0.25em] text-black/40">
                Saviskar 2026 Intelligence
              </span>
            </div>

            <h1 className="text-4xl font-semibold tracking-[-0.05em] md:text-6xl text-black">
              Analytics & Insights
            </h1>

            <p className="mt-3 text-sm text-black/55 max-w-2xl">
              Live geographic footprint, competition capacity, and festival demographics categorized according to administrative permissions.
            </p>
          </div>

          <div className="flex flex-col items-end gap-3">
            {/* Identity & Scope Badge */}
            <div className="flex flex-col items-end bg-white p-4 rounded-[20px] border border-black/10 shadow-sm w-full sm:w-auto">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-black/40">
                Access Level & Scope
              </div>
              <div className="text-sm font-bold text-black mt-0.5 flex items-center gap-1.5">
                <Shield
                  size={14}
                  className={isMaster ? "text-violet-600" : "text-emerald-600"}
                />
                <span>{roleBadgeLabel}</span>
              </div>
              <div className="text-[10px] font-medium text-black/50 mt-1">
                {isMaster
                  ? "Full Metrics & Revenue Clearance"
                  : isCategoryScoped
                  ? `Restricted to: ${data?.categoryScopeLabel || "Assigned Categories"}`
                  : "Operational & Demographic Access"}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => loadAnalytics(true)}
                disabled={refreshing}
                className="flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-4 py-2.5 text-xs font-semibold text-black/70 hover:bg-black/[0.03] transition disabled:opacity-50 shadow-sm"
              >
                <RefreshCw
                  size={13}
                  className={refreshing ? "animate-spin text-violet-600" : ""}
                />
                <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
              </button>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  className="flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-4 py-2.5 text-xs font-semibold text-black/70 hover:bg-black/[0.03] transition shadow-sm"
                >
                  <Download size={13} />
                  <span>Export Report</span>
                  <ChevronDown size={12} className="opacity-60" />
                </button>

                {showExportMenu && (
                  <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-white border border-black/10 shadow-xl p-2 z-50 animate-in fade-in zoom-in-95 duration-150">
                    <button
                      type="button"
                      onClick={exportStatesCsv}
                      className="w-full text-left px-3 py-2 text-xs font-medium rounded-xl hover:bg-black/5 text-black flex items-center justify-between"
                    >
                      <span>State-Wise CSV</span>
                      <MapPin size={13} className="opacity-40" />
                    </button>
                    <button
                      type="button"
                      onClick={exportEventsCsv}
                      className="w-full text-left px-3 py-2 text-xs font-medium rounded-xl hover:bg-black/5 text-black flex items-center justify-between"
                    >
                      <span>Event-Wise CSV</span>
                      <CalendarDays size={13} className="opacity-40" />
                    </button>
                  </div>
                )}
              </div>

              {isMaster && (
                <button
                  type="button"
                  onClick={() => router.push("/admin/events")}
                  className="flex items-center gap-1.5 rounded-full bg-black px-4 py-2.5 text-xs font-semibold text-white hover:scale-[1.02] transition shadow-sm"
                >
                  <CalendarDays size={13} />
                  <span>Events</span>
                </button>
              )}

              {(isMaster || data?.accommodationAccess) && (
                <button
                  type="button"
                  onClick={() => router.push("/admin/accommodations")}
                  className="flex items-center gap-1.5 rounded-full bg-black px-4 py-2.5 text-xs font-semibold text-white hover:scale-[1.02] transition shadow-sm"
                >
                  <Bed size={13} />
                  <span>Accommodation</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => router.push("/admin/scanner")}
                className="flex items-center gap-1.5 rounded-full bg-black px-4 py-2.5 text-xs font-semibold text-white hover:scale-[1.02] transition shadow-sm"
              >
                <QrCode size={13} />
                <span>Scanner</span>
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-8 rounded-2xl bg-red-50 border border-red-200 p-4 text-xs font-medium text-red-700 flex items-center justify-between">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => loadAnalytics(true)}
              className="underline hover:text-red-900 font-bold ml-4"
            >
              Retry
            </button>
          </div>
        )}

        {/* =======================================================
            CATEGORY SCOPE & COLLEGE FILTER BAR (ADMIN PERMISSIONS)
        ======================================================= */}
        <section className="mb-8 rounded-[28px] bg-white border border-black/10 p-5 sm:p-6 shadow-sm">
          {/* Top Row: Category Filter */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-black/5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-black/[0.04] text-black">
                <SlidersHorizontal size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-black">
                    Competition Category Scope
                  </h2>
                  {isCategoryScoped && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase bg-amber-50 text-amber-800 px-2 py-0.5 rounded-full border border-amber-200 font-semibold">
                      <Lock size={10} />
                      <span>Role Scoped</span>
                    </span>
                  )}
                  {selectedCategory !== "all" && (
                    <span className="text-[10px] font-mono uppercase bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full border border-violet-100 font-semibold">
                      Active: {selectedCategory.replace("-", " ")}
                    </span>
                  )}
                </div>
                <p className="text-xs text-black/50 mt-0.5">
                  {availableCategories.length === 1
                    ? `Showing metrics exclusively for your assigned ${availableCategories[0].replace("-", " ")} category.`
                    : "Filter real-time delegates, state distribution, and competition metrics by category."}
                </p>
              </div>
            </div>

            {/* Category Selector Buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
              {availableCategories.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleCategorySwitch("all")}
                  disabled={refreshing}
                  className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wider transition border ${
                    selectedCategory === "all"
                      ? "border-black bg-black text-white shadow-sm"
                      : "border-black/10 bg-black/[0.02] text-black/60 hover:bg-black/5"
                  }`}
                >
                  All Assigned ({data?.overview.totalRegistrations ?? 0})
                </button>
              )}

              {availableCategories.map((cat) => {
                const catStat = data?.categories.find(
                  (c) => c.category.toLowerCase().trim() === cat.toLowerCase().trim()
                );
                const count = catStat?.count ?? 0;
                const isSelected = selectedCategory === cat;

                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => handleCategorySwitch(cat)}
                    disabled={refreshing || availableCategories.length === 1}
                    className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wider transition border flex items-center gap-2 ${
                      isSelected
                        ? "border-black bg-black text-white shadow-sm"
                        : "border-black/10 bg-black/[0.02] text-black/60 hover:bg-black/5"
                    }`}
                  >
                    <span>{cat.replace("-", " ")}</span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                        isSelected
                          ? "bg-white/20 text-white"
                          : "bg-black/5 text-black/60"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bottom Row: College / Institution Filter */}
          <div className="pt-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
                <Building2 size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-black">
                    Filter by College / Institution
                  </h3>
                  {selectedCollege !== "all" && (
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold bg-blue-50 text-blue-800 px-2.5 py-0.5 rounded-full border border-blue-200">
                      <span>{selectedCollege}</span>
                      <button
                        type="button"
                        onClick={() => handleCollegeSwitch("all")}
                        className="hover:text-red-600 transition"
                        title="Clear college filter"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  )}
                </div>
                <p className="text-xs text-black/50 mt-0.5">
                  Filter delegate attendance, accommodation status, and competition entries by college.
                </p>
              </div>
            </div>

            {/* College Combobox & Quick Selector */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Quick Chip: All Colleges */}
              <button
                type="button"
                onClick={() => handleCollegeSwitch("all")}
                disabled={refreshing}
                className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition border ${
                  selectedCollege === "all"
                    ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                    : "border-black/10 bg-black/[0.02] text-black/65 hover:bg-black/5"
                }`}
              >
                All Colleges ({availableColleges.length})
              </button>

              {/* Quick Top 3 Colleges */}
              {availableColleges.slice(0, 3).map((col) => {
                const isSelected = selectedCollege.toLowerCase() === col.college.toLowerCase();
                return (
                  <button
                    key={col.college}
                    type="button"
                    onClick={() => handleCollegeSwitch(col.college)}
                    disabled={refreshing}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition border flex items-center gap-1.5 max-w-[200px] truncate ${
                      isSelected
                        ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                        : "border-black/10 bg-black/[0.02] text-black/65 hover:bg-black/5"
                    }`}
                    title={col.college}
                  >
                    <span className="truncate">{col.college}</span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full shrink-0 ${
                        isSelected
                          ? "bg-white/20 text-white"
                          : "bg-black/5 text-black/60"
                      }`}
                    >
                      {col.count}
                    </span>
                  </button>
                );
              })}

              {/* Searchable Dropdown for all 240+ Colleges */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowCollegeDropdown(!showCollegeDropdown)}
                  className="flex items-center gap-1.5 rounded-full border border-black/15 bg-white px-3.5 py-1.5 text-xs font-semibold text-black/80 hover:bg-black/[0.03] transition shadow-sm"
                >
                  <Search size={13} className="text-black/50" />
                  <span>
                    {selectedCollege !== "all" ? "Change College..." : "Select from 240+ Colleges..."}
                  </span>
                  <ChevronDown size={12} className="opacity-60" />
                </button>

                {showCollegeDropdown && (
                  <div className="absolute right-0 sm:left-0 sm:right-auto mt-2 w-80 sm:w-96 rounded-2xl bg-white border border-black/15 shadow-2xl p-3 z-50 animate-in fade-in zoom-in-95 duration-150">
                    <div className="relative mb-2">
                      <Search
                        size={14}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-black/40"
                      />
                      <input
                        type="text"
                        value={collegeSearch}
                        onChange={(e) => setCollegeSearch(e.target.value)}
                        placeholder="Search college by name..."
                        className="w-full rounded-xl bg-black/[0.03] pl-9 pr-3 py-2 text-xs text-black placeholder:text-black/40 focus:outline-none focus:ring-2 focus:ring-blue-500 border border-black/5"
                        autoFocus
                      />
                      {collegeSearch && (
                        <button
                          type="button"
                          onClick={() => setCollegeSearch("")}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-black/40 hover:text-black"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>

                    <div className="max-h-60 overflow-y-auto space-y-1 divide-y divide-black/[0.03]">
                      <button
                        type="button"
                        onClick={() => handleCollegeSwitch("all")}
                        className={`w-full text-left px-3 py-2 text-xs rounded-xl transition flex items-center justify-between ${
                          selectedCollege === "all"
                            ? "bg-blue-50 font-bold text-blue-700"
                            : "hover:bg-black/5 text-black"
                        }`}
                      >
                        <span>All Colleges (Reset Filter)</span>
                        <span className="text-[10px] font-mono opacity-50">
                          {data?.overview.totalParticipants ?? 0} delegates
                        </span>
                      </button>

                      {filteredCollegeOptions.length === 0 ? (
                        <p className="py-4 text-center text-xs text-black/40">
                          No colleges found matching &quot;{collegeSearch}&quot;
                        </p>
                      ) : (
                        filteredCollegeOptions.map((c) => {
                          const isSelected =
                            selectedCollege.toLowerCase() === c.college.toLowerCase();
                          return (
                            <button
                              key={c.college}
                              type="button"
                              onClick={() => handleCollegeSwitch(c.college)}
                              className={`w-full text-left px-3 py-2 text-xs rounded-xl transition flex items-center justify-between gap-2 ${
                                isSelected
                                  ? "bg-blue-50 font-bold text-blue-700"
                                  : "hover:bg-black/5 text-black"
                              }`}
                            >
                              <span className="truncate">{c.college}</span>
                              <span className="text-[10px] font-mono bg-black/5 px-2 py-0.5 rounded-full shrink-0">
                                {c.count} {c.count === 1 ? "delegate" : "delegates"}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* =======================================================
            EXECUTIVE OVERVIEW CARDS
        ======================================================= */}
        <section className="mb-10">
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {/* 1. Total Delegates (Leaders + Team Members) */}
            <div className="rounded-[26px] bg-white border border-black/10 p-5 shadow-sm transition hover:shadow-md flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-black/40">
                  <span className="text-[10px] font-bold uppercase tracking-wider">
                    {selectedCategory === "all"
                      ? selectedCollege === "all"
                        ? "Total Delegates"
                        : "Delegates (College)"
                      : `${selectedCategory.replace("-", " ")} Delegates`}
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
                    <Users size={16} />
                  </div>
                </div>
                <p className="mt-3 text-3xl font-bold tracking-tight text-black">
                  {overview?.totalParticipants.toLocaleString() ?? "0"}
                </p>
                <p className="mt-1 text-xs text-black/60 font-medium">
                  {typeof overview?.accommodationOnlyCount === "number" && overview.accommodationOnlyCount > 0
                    ? `${(overview.eventParticipantCount ?? 0).toLocaleString()} in events · ${overview.accommodationOnlyCount} stay-only`
                    : `Headcount: ${(overview?.totalHeadcount ?? 0).toLocaleString()}`}
                </p>
                <p className="mt-0.5 text-[11px] text-black/40">
                  Headcount: <span className="font-semibold text-black/70">{overview?.totalHeadcount.toLocaleString() ?? 0}</span> (including all team members)
                </p>
              </div>

              {/* Acco Breakdown Badges for Delegates */}
              <div className="mt-4 pt-3 border-t border-black/5 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 border border-emerald-200">
                  <Bed size={12} className="text-emerald-600 shrink-0" />
                  <span>{overview?.withAccommodation.toLocaleString() ?? 0} With Acco</span>
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 border border-zinc-200">
                  <span>{overview?.withoutAccommodation.toLocaleString() ?? 0} Without Acco</span>
                </span>
              </div>
            </div>

            {/* 2. Total Registrations & Squads */}
            <div className="rounded-[26px] bg-white border border-black/10 p-5 shadow-sm transition hover:shadow-md flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-black/40">
                  <span className="text-[10px] font-bold uppercase tracking-wider">
                    {selectedCategory === "all" ? "Event Registrations" : `${selectedCategory.replace("-", " ")} Entries`}
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                    <CalendarDays size={16} />
                  </div>
                </div>
                <p className="mt-3 text-3xl font-bold tracking-tight text-black">
                  {overview?.totalRegistrations.toLocaleString() ?? "0"}
                </p>
                <p className="mt-1 text-xs text-black/50">
                  <span className="font-semibold text-black">{overview?.totalTeams.toLocaleString() ?? 0}</span> squads · <span className="font-semibold text-black">{overview?.totalSolo.toLocaleString() ?? 0}</span> solo
                </p>
              </div>

              {/* Acco Breakdown Badges for Registrations */}
              <div className="mt-4 pt-3 border-t border-black/5 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-800 border border-blue-200">
                  <Bed size={12} className="text-blue-600 shrink-0" />
                  <span>{overview?.registrationsWithAccommodation.toLocaleString() ?? 0} With Stay</span>
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 border border-zinc-200">
                  <span>{overview?.registrationsWithoutAccommodation.toLocaleString() ?? 0} Without Stay</span>
                </span>
              </div>
            </div>

            {/* 3. Check-In Attendance */}
            <div className="rounded-[26px] bg-white border border-black/10 p-5 shadow-sm transition hover:shadow-md flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-black/40">
                  <span className="text-[10px] font-bold uppercase tracking-wider">Turnout & Check-Ins</span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                    <UserCheck size={16} />
                  </div>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <p className="text-3xl font-bold tracking-tight text-emerald-700">
                    {overview?.totalCheckedIn.toLocaleString() ?? "0"}
                  </p>
                  <span className="text-sm font-semibold text-emerald-800/70">
                    ({overview?.checkInRate ?? 0}%)
                  </span>
                </div>
                <div className="mt-2 w-full bg-emerald-100/60 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-emerald-600 h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, overview?.checkInRate ?? 0)}%` }}
                  />
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-black/5 text-[11px] text-black/50">
                Verified gate & competition check-ins
              </div>
            </div>

            {/* 4. Geographic & Institution Footprint */}
            <div className="rounded-[26px] bg-white border border-black/10 p-5 shadow-sm transition hover:shadow-md flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-black/40">
                  <span className="text-[10px] font-bold uppercase tracking-wider">
                    {selectedCollege === "all" ? "Institutions & States" : "Filtered College"}
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
                    <MapPin size={16} />
                  </div>
                </div>

                {selectedCollege === "all" ? (
                  <>
                    <p className="mt-3 text-3xl font-bold tracking-tight text-black">
                      {overview?.totalColleges.toLocaleString() ?? "0"}
                    </p>
                    <p className="mt-1 text-xs text-black/50">
                      Institutions across <span className="font-semibold text-black">{overview?.totalStates ?? 0}</span> states
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-3 text-lg font-bold tracking-tight text-black line-clamp-2" title={selectedCollege}>
                      {selectedCollege}
                    </p>
                    <p className="mt-1 text-xs text-black/50">
                      {overview?.totalParticipants} delegates across {overview?.totalStates} states
                    </p>
                  </>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-black/5 flex items-center justify-between">
                {selectedCollege === "all" ? (
                  <span className="text-[11px] text-black/55 truncate">
                    Top: <span className="font-semibold text-black">{data?.stateWise[0]?.state ?? "N/A"}</span> ({data?.stateWise[0]?.participantCount ?? 0})
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleCollegeSwitch("all")}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-900 transition"
                  >
                    <span>Clear College Filter</span>
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

          </div>

          {/* =======================================================
              ACCOMMODATION & STAY LOGISTICS SUMMARY BANNER
          ======================================================= */}
          <div className="mt-4 rounded-[26px] bg-gradient-to-r from-emerald-50/60 via-teal-50/40 to-white border border-emerald-100/80 p-5 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
                  <Bed size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-black">
                      Accommodation & Hostel Stay Distribution
                    </h3>
                    <span className="text-[10px] font-mono uppercase bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">
                      {overview?.totalParticipants ? Math.round(((overview?.withAccommodation ?? 0) / overview.totalParticipants) * 100) : 0}% Stay Ratio
                    </span>
                  </div>
                  <p className="text-xs text-black/55 mt-0.5">
                    Breakdown of delegates requiring university hostel accommodation vs. non-stay delegates.
                  </p>
                </div>
              </div>

              {/* Visual Stats Row */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-2xl bg-white border border-emerald-200/60 px-4 py-2 shadow-xs">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">With Accommodation</div>
                  <div className="text-lg font-bold text-black flex items-baseline gap-1 mt-0.5">
                    <span>{overview?.withAccommodation.toLocaleString() ?? 0}</span>
                    <span className="text-xs font-normal text-black/45">delegates</span>
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-zinc-200/80 px-4 py-2 shadow-xs">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">Without Accommodation</div>
                  <div className="text-lg font-bold text-black flex items-baseline gap-1 mt-0.5">
                    <span>{overview?.withoutAccommodation.toLocaleString() ?? 0}</span>
                    <span className="text-xs font-normal text-black/45">delegates</span>
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-blue-200/60 px-4 py-2 shadow-xs">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Headcount Stay Seats</div>
                  <div className="text-lg font-bold text-black flex items-baseline gap-1 mt-0.5">
                    <span>{overview?.headcountWithAccommodation.toLocaleString() ?? 0}</span>
                    <span className="text-xs font-normal text-black/45">participations</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Proportion Bar */}
            <div className="mt-4">
              <div className="w-full bg-zinc-200/80 rounded-full h-2.5 overflow-hidden flex">
                <div
                  className="bg-emerald-500 h-full transition-all duration-500"
                  style={{
                    width: `${
                      overview?.totalParticipants
                        ? Math.min(100, Math.round(((overview?.withAccommodation ?? 0) / overview.totalParticipants) * 100))
                        : 0
                    }%`,
                  }}
                  title={`With Accommodation: ${overview?.withAccommodation ?? 0}`}
                />
                <div
                  className="bg-zinc-400 h-full transition-all duration-500"
                  style={{
                    width: `${
                      overview?.totalParticipants
                        ? Math.min(100, Math.round(((overview?.withoutAccommodation ?? 0) / overview.totalParticipants) * 100))
                        : 0
                    }%`,
                  }}
                  title={`Without Accommodation: ${overview?.withoutAccommodation ?? 0}`}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] font-medium text-black/50 mt-1.5 px-0.5">
                <span className="text-emerald-700 font-semibold">
                  ● With Stay: {overview?.withAccommodation ?? 0} ({overview?.totalParticipants ? Math.round(((overview?.withAccommodation ?? 0) / overview.totalParticipants) * 100) : 0}%)
                </span>
                <span className="text-zinc-600 font-semibold">
                  ● Without Stay: {overview?.withoutAccommodation ?? 0} ({overview?.totalParticipants ? Math.round(((overview?.withoutAccommodation ?? 0) / overview.totalParticipants) * 100) : 0}%)
                </span>
              </div>
            </div>
          </div>

          {/* =======================================================
              REVENUE SUMMARY (STRICTLY MASTER ADMIN ONLY)
          ======================================================= */}
          {isMaster && overview?.revenue && (
            <div className="mt-4 rounded-[28px] bg-white border border-black/10 p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-black/5 gap-2">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-emerald-500" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-black/60">
                    Championship Financial Analytics (Master Clearance)
                    {selectedCategory !== "all" && ` — ${selectedCategory.toUpperCase()}`}
                  </h3>
                </div>
                <span className="text-[10px] font-mono text-black/40 uppercase">
                  {selectedCategory === "all" ? "Events & Accommodations Combined" : `${selectedCategory.toUpperCase()} Events Only`}
                </span>
              </div>

              <div className="mt-5 grid gap-4 grid-cols-1 sm:grid-cols-3">
                <div className="rounded-2xl bg-black/[0.02] border border-black/[0.03] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-black/40">Expected Revenue</p>
                  <p className="text-2xl font-bold text-black mt-1">₹{overview.revenue.totalExpected.toLocaleString()}</p>
                  <p className="text-[11px] text-black/45 mt-1">
                    Events: ₹{overview.revenue.events.expected.toLocaleString()}
                    {selectedCategory === "all" && ` · Acco: ₹${overview.revenue.accommodations.expected.toLocaleString()}`}
                  </p>
                </div>

                <div className="rounded-2xl bg-emerald-50/70 border border-emerald-100 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-800/70">Paid Revenue</p>
                  <p className="text-2xl font-bold text-emerald-700 mt-1">₹{overview.revenue.totalPaid.toLocaleString()}</p>
                  <p className="text-[11px] text-emerald-900/60 mt-1">
                    Events: ₹{overview.revenue.events.paid.toLocaleString()}
                    {selectedCategory === "all" && ` · Acco: ₹${overview.revenue.accommodations.paid.toLocaleString()}`}
                  </p>
                </div>

                <div className="rounded-2xl bg-red-50/70 border border-red-100 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-red-800/70">Outstanding Dues</p>
                  <p className="text-2xl font-bold text-red-700 mt-1">₹{overview.revenue.totalOutstanding.toLocaleString()}</p>
                  <p className="text-[11px] text-red-900/60 mt-1">
                    Events: ₹{overview.revenue.events.outstanding.toLocaleString()}
                    {selectedCategory === "all" && ` · Acco: ₹${overview.revenue.accommodations.outstanding.toLocaleString()}`}
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* =======================================================
            TAB NAVIGATION
        ======================================================= */}
        <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-black/10 pb-4">
          <button
            type="button"
            onClick={() => setActiveTab("states")}
            className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-semibold transition ${
              activeTab === "states"
                ? "bg-black text-white shadow-sm"
                : "bg-white text-black/70 hover:bg-black/5 border border-black/10"
            }`}
          >
            <MapPin size={14} />
            <span>State-Wise Distribution</span>
            <span
              className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                activeTab === "states"
                  ? "bg-white/20 text-white"
                  : "bg-black/5 text-black/60"
              }`}
            >
              {data?.stateWise.length ?? 0}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("events")}
            className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-semibold transition ${
              activeTab === "events"
                ? "bg-black text-white shadow-sm"
                : "bg-white text-black/70 hover:bg-black/5 border border-black/10"
            }`}
          >
            <CalendarDays size={14} />
            <span>Event-Wise Performance</span>
            <span
              className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                activeTab === "events"
                  ? "bg-white/20 text-white"
                  : "bg-black/5 text-black/60"
              }`}
            >
              {data?.eventWise.length ?? 0}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("demographics")}
            className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-semibold transition ${
              activeTab === "demographics"
                ? "bg-black text-white shadow-sm"
                : "bg-white text-black/70 hover:bg-black/5 border border-black/10"
            }`}
          >
            <GraduationCap size={14} />
            <span>Colleges & Demographics</span>
          </button>

          {(isMaster || data?.accommodationAccess) && data?.accommodations && (
            <button
              type="button"
              onClick={() => setActiveTab("accommodations")}
              className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-semibold transition ${
                activeTab === "accommodations"
                  ? "bg-black text-white shadow-sm"
                  : "bg-white text-black/70 hover:bg-black/5 border border-black/10"
              }`}
            >
              <Bed size={14} />
              <span>Accommodation Insights</span>
              <span
                className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  activeTab === "accommodations"
                    ? "bg-white/20 text-white"
                    : "bg-black/5 text-black/60"
                }`}
              >
                {data.accommodations.totalBookings}
              </span>
            </button>
          )}
        </div>

        {/* =======================================================
            TAB 1: STATE-WISE DISTRIBUTION
        ======================================================= */}
        {activeTab === "states" && (
          <section className="space-y-6 animate-in fade-in duration-200">
            {/* Top 4 Quick Highlight Cards */}
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              {data?.stateWise.slice(0, 4).map((s, idx) => (
                <div
                  key={s.state}
                  className="rounded-[22px] bg-white border border-black/10 p-5 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-black/40">
                      Rank #{idx + 1}
                    </span>
                    <span className="font-mono text-xs font-bold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full">
                      {s.percentage}% Share
                    </span>
                  </div>
                  <h4 className="mt-2 text-xl font-bold text-black truncate">{s.state}</h4>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-black">{s.participantCount}</span>
                    <span className="text-xs text-black/45">delegates</span>
                    <span className="text-xs text-black/30">·</span>
                    <span className="text-xs text-black/50">{s.eventRegistrations} entries</span>
                  </div>
                  <div className="mt-3 w-full bg-black/5 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-violet-600 h-full rounded-full"
                      style={{ width: `${Math.min(100, s.percentage * 2)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Filter and Table Container */}
            <div className="rounded-[28px] bg-white border border-black/10 p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-lg font-bold text-black">
                    State-Wise Participation Ledger
                    {selectedCategory !== "all" && (
                      <span className="text-xs font-normal text-violet-600 ml-2 font-mono uppercase">
                        [{selectedCategory.replace("-", " ")}]
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-black/50 mt-0.5">
                    Total representation from {data?.stateWise.length} States & Union Territories.
                  </p>
                </div>

                <div className="relative w-full sm:w-72">
                  <Search
                    size={14}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-black/40"
                  />
                  <input
                    type="text"
                    value={stateSearch}
                    onChange={(e) => setStateSearch(e.target.value)}
                    placeholder="Search state or college..."
                    className="w-full rounded-full border border-black/10 bg-black/[0.02] pl-9 pr-4 py-2 text-xs text-black placeholder:text-black/40 outline-none focus:border-violet-500 focus:bg-white transition"
                  />
                  {stateSearch && (
                    <button
                      type="button"
                      onClick={() => setStateSearch("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-black/40 hover:text-black text-xs"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-black/10 text-[10px] font-bold uppercase tracking-wider text-black/40">
                      <th className="py-3 px-3 w-16">Rank</th>
                      <th className="py-3 px-3">State / Union Territory</th>
                      <th className="py-3 px-3 text-right">Delegates</th>
                      <th className="py-3 px-3 text-right">Event Registrations</th>
                      <th className="py-3 px-3 w-48">Representation Share</th>
                      <th className="py-3 px-3">Top Institutes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5">
                    {filteredStates.map((s, idx) => (
                      <tr key={s.state} className="hover:bg-black/[0.015] transition">
                        <td className="py-3.5 px-3 font-mono font-bold text-black/40">
                          #{idx + 1}
                        </td>
                        <td className="py-3.5 px-3 font-semibold text-black">
                          {s.state}
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono font-bold text-black">
                          {s.participantCount.toLocaleString()}
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono text-black/60">
                          {s.eventRegistrations.toLocaleString()}
                        </td>
                        <td className="py-3.5 px-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-black/5 rounded-full h-2 overflow-hidden">
                              <div
                                className="bg-gradient-to-r from-violet-600 to-indigo-600 h-full rounded-full"
                                style={{ width: `${Math.min(100, s.percentage)}%` }}
                              />
                            </div>
                            <span className="font-mono text-[11px] font-semibold text-black/60 w-12 text-right">
                              {s.percentage}%
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-3 text-black/65 max-w-md">
                          {s.topColleges.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {s.topColleges.map((c, i) => (
                                <span
                                  key={i}
                                  className="inline-block px-2 py-0.5 rounded-md bg-black/[0.03] text-[10px] border border-black/5 truncate max-w-xs"
                                >
                                  {c}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-black/30 italic">No college specified</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {filteredStates.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-black/40 italic">
                          No states match your search query.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* =======================================================
            TAB 2: EVENT-WISE PERFORMANCE
        ======================================================= */}
        {activeTab === "events" && (
          <section className="space-y-6 animate-in fade-in duration-200">
            {/* Category Summary Cards */}
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
              {data?.categories.map((c) => {
                const isSelected = selectedCategory === c.category.toLowerCase().trim();
                return (
                  <button
                    type="button"
                    key={c.category}
                    onClick={() => handleCategorySwitch(c.category.toLowerCase().trim())}
                    className={`text-left rounded-[22px] bg-white border p-5 shadow-sm transition hover:scale-[1.01] ${
                      isSelected
                        ? "border-black ring-2 ring-black/10 shadow-md"
                        : "border-black/10 hover:border-black/20"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-black/40">
                        {c.eventCount} Competitions
                      </span>
                      <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                        {c.percentage}% of all entries
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <h4 className="text-xl font-bold capitalize text-black">
                        {c.category.replace("-", " ")}
                      </h4>
                      {isSelected && (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-black text-white">
                          <Check size={12} />
                        </span>
                      )}
                    </div>
                    <div className="mt-3 flex items-baseline gap-2">
                      <span className="text-3xl font-bold text-black">{c.count}</span>
                      <span className="text-xs text-black/50">total registrations</span>
                    </div>
                    <div className="mt-3 w-full bg-black/5 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-blue-600 h-full rounded-full"
                        style={{ width: `${Math.min(100, c.percentage)}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Event Filter & Table */}
            <div className="rounded-[28px] bg-white border border-black/10 p-6 shadow-sm">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-lg font-bold text-black">
                    Event Registrations & Capacity Fill
                    {selectedCategory !== "all" && (
                      <span className="text-xs font-normal text-violet-600 ml-2 font-mono uppercase">
                        [{selectedCategory.replace("-", " ")}]
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-black/50 mt-0.5">
                    Detailed participation metrics, squad allocations, and capacity tracking.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {/* Category Filter Pills (strictly matching availableCategories) */}
                  {availableCategories.length > 1 && (
                    <div className="flex items-center rounded-full border border-black/10 bg-black/[0.02] p-1 text-xs">
                      {["all", ...availableCategories].map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setEventCategoryFilter(cat)}
                          className={`rounded-full px-3 py-1 font-medium capitalize transition ${
                            eventCategoryFilter === cat
                              ? "bg-black text-white shadow-sm"
                              : "text-black/60 hover:text-black"
                          }`}
                        >
                          {cat.replace("-", " ")}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Sort Filter */}
                  <select
                    value={eventSortBy}
                    onChange={(e: any) => setEventSortBy(e.target.value)}
                    className="rounded-full border border-black/10 bg-black/[0.02] px-3.5 py-1.5 text-xs text-black outline-none focus:border-violet-500"
                  >
                    <option value="count">Sort: Most Registrations</option>
                    <option value="fillRate">Sort: Capacity Fill %</option>
                    <option value="checkedIn">Sort: Checked In</option>
                    <option value="name">Sort: A-Z Alphabetical</option>
                  </select>

                  {/* Search */}
                  <div className="relative w-full sm:w-60">
                    <Search
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-black/40"
                    />
                    <input
                      type="text"
                      value={eventSearch}
                      onChange={(e) => setEventSearch(e.target.value)}
                      placeholder="Search event name..."
                      className="w-full rounded-full border border-black/10 bg-black/[0.02] pl-8 pr-4 py-1.5 text-xs text-black outline-none focus:border-violet-500"
                    />
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-black/10 text-[10px] font-bold uppercase tracking-wider text-black/40">
                      <th className="py-3 px-3">Competition</th>
                      <th className="py-3 px-3">Category</th>
                      <th className="py-3 px-3">Type</th>
                      <th className="py-3 px-3 text-right">Registrations</th>
                      <th className="py-3 px-3 w-44">Capacity / Fill</th>
                      <th className="py-3 px-3 text-right">Checked In</th>
                      {isMaster && <th className="py-3 px-3 text-right">Revenue</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5">
                    {filteredEvents.map((ev) => (
                      <tr key={ev.id} className="hover:bg-black/[0.015] transition">
                        <td className="py-3.5 px-3">
                          <p className="font-bold text-black">{ev.name}</p>
                          <p className="font-mono text-[10px] text-black/40 mt-0.5">
                            Fee: ₹{ev.registrationFee}
                          </p>
                        </td>
                        <td className="py-3.5 px-3">
                          <span className="capitalize inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-black/5 border border-black/5 text-black/70">
                            {ev.category.replace("-", " ")}
                          </span>
                        </td>
                        <td className="py-3.5 px-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                              ev.registrationType === "team"
                                ? "bg-purple-50 text-purple-700"
                                : "bg-emerald-50 text-emerald-700"
                            }`}
                          >
                            {ev.registrationType}
                          </span>
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono font-bold text-black text-sm">
                          {ev.count.toLocaleString()}
                        </td>
                        <td className="py-3.5 px-3">
                          {ev.registrationLimit ? (
                            <div className="space-y-1">
                              <div className="flex justify-between text-[10px] font-mono text-black/50">
                                <span>{ev.count} / {ev.registrationLimit}</span>
                                <span
                                  className={
                                    ev.fillRate && ev.fillRate >= 90
                                      ? "text-red-600 font-bold"
                                      : ""
                                  }
                                >
                                  {ev.fillRate}%
                                </span>
                              </div>
                              <div className="w-full bg-black/5 rounded-full h-1.5 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    (ev.fillRate ?? 0) >= 90
                                      ? "bg-red-500"
                                      : (ev.fillRate ?? 0) >= 60
                                      ? "bg-amber-500"
                                      : "bg-blue-600"
                                  }`}
                                  style={{
                                    width: `${Math.min(100, ev.fillRate ?? 0)}%`,
                                  }}
                                />
                              </div>
                            </div>
                          ) : (
                            <span className="text-[10px] font-mono text-black/40">
                              Unlimited
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono font-semibold text-emerald-700">
                          {ev.checkedIn}
                        </td>
                        {isMaster && (
                          <td className="py-3.5 px-3 text-right font-mono font-bold text-black">
                            ₹{(ev.revenue ?? 0).toLocaleString()}
                          </td>
                        )}
                      </tr>
                    ))}
                    {filteredEvents.length === 0 && (
                      <tr>
                        <td
                          colSpan={isMaster ? 7 : 6}
                          className="py-8 text-center text-black/40 italic"
                        >
                          No events match your criteria.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* =======================================================
            TAB 3: DEMOGRAPHICS & INSTITUTES
        ======================================================= */}
        {activeTab === "demographics" && (
          <section className="space-y-6 animate-in fade-in duration-200">
            <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
              {/* Gender Distribution */}
              <div className="rounded-[28px] bg-white border border-black/10 p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <Users size={16} className="text-violet-600" />
                  <h3 className="text-base font-bold text-black">
                    Gender Representation
                    {selectedCategory !== "all" && (
                      <span className="text-xs font-normal text-violet-600 ml-2 font-mono uppercase">
                        [{selectedCategory.replace("-", " ")}]
                      </span>
                    )}
                  </h3>
                </div>

                {data?.demographics.gender && (
                  <div className="space-y-4">
                    {/* Ratio Bar */}
                    <div className="w-full h-3 rounded-full bg-black/5 overflow-hidden flex">
                      {overview?.totalParticipants ? (
                        <>
                          <div
                            className="bg-blue-600 h-full"
                            style={{
                              width: `${(data.demographics.gender.male / overview.totalParticipants) * 100}%`,
                            }}
                            title={`Male: ${data.demographics.gender.male}`}
                          />
                          <div
                            className="bg-pink-500 h-full"
                            style={{
                              width: `${(data.demographics.gender.female / overview.totalParticipants) * 100}%`,
                            }}
                            title={`Female: ${data.demographics.gender.female}`}
                          />
                          <div
                            className="bg-purple-400 h-full"
                            style={{
                              width: `${(data.demographics.gender.other / overview.totalParticipants) * 100}%`,
                            }}
                            title={`Other: ${data.demographics.gender.other}`}
                          />
                        </>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-2">
                      <div className="rounded-xl bg-blue-50/70 border border-blue-100 p-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Male</span>
                        <p className="text-xl font-bold text-blue-900 mt-1">{data.demographics.gender.male}</p>
                        <p className="text-[10px] text-blue-800/60 font-mono mt-0.5">
                          {overview?.totalParticipants ? Math.round((data.demographics.gender.male / overview.totalParticipants) * 100) : 0}%
                        </p>
                      </div>

                      <div className="rounded-xl bg-pink-50/70 border border-pink-100 p-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-pink-700">Female</span>
                        <p className="text-xl font-bold text-pink-900 mt-1">{data.demographics.gender.female}</p>
                        <p className="text-[10px] text-pink-800/60 font-mono mt-0.5">
                          {overview?.totalParticipants ? Math.round((data.demographics.gender.female / overview.totalParticipants) * 100) : 0}%
                        </p>
                      </div>

                      <div className="rounded-xl bg-purple-50/70 border border-purple-100 p-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Other</span>
                        <p className="text-xl font-bold text-purple-900 mt-1">{data.demographics.gender.other}</p>
                        <p className="text-[10px] text-purple-800/60 font-mono mt-0.5">
                          {overview?.totalParticipants ? Math.round((data.demographics.gender.other / overview.totalParticipants) * 100) : 0}%
                        </p>
                      </div>

                      <div className="rounded-xl bg-black/[0.02] border border-black/[0.04] p-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-black/50">Unspecified</span>
                        <p className="text-xl font-bold text-black mt-1">{data.demographics.gender.unspecified}</p>
                        <p className="text-[10px] text-black/40 font-mono mt-0.5">
                          {overview?.totalParticipants ? Math.round((data.demographics.gender.unspecified / overview.totalParticipants) * 100) : 0}%
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Top Colleges Leaderboard */}
              <div className="lg:col-span-2 rounded-[28px] bg-white border border-black/10 p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <GraduationCap size={16} className="text-violet-600" />
                    <h3 className="text-base font-bold text-black">
                      Top Participating Institutions
                      {selectedCategory !== "all" && (
                        <span className="text-xs font-normal text-violet-600 ml-2 font-mono uppercase">
                          [{selectedCategory.replace("-", " ")}]
                        </span>
                      )}
                    </h3>
                  </div>
                  <span className="text-xs font-mono text-black/40">
                    {data?.demographics.topColleges.length} Institutions Listed
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-black/10 text-[10px] font-bold uppercase tracking-wider text-black/40">
                        <th className="py-2.5 px-3 w-14">#</th>
                        <th className="py-2.5 px-3">College / University Name</th>
                        <th className="py-2.5 px-3">State</th>
                        <th className="py-2.5 px-3 text-right">Delegates</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5">
                      {data?.demographics.topColleges.map((col, idx) => (
                        <tr key={idx} className="hover:bg-black/[0.015] transition">
                          <td className="py-2.5 px-3 font-mono font-bold text-black/40">
                            #{idx + 1}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-black max-w-sm truncate">
                            {col.college}
                          </td>
                          <td className="py-2.5 px-3 text-black/50">{col.state || "—"}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-violet-700">
                            {col.count}
                          </td>
                        </tr>
                      ))}
                      {data?.demographics.topColleges.length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-black/40 italic">
                            No institutions found for this category.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* =======================================================
            TAB 4: ACCOMMODATION INSIGHTS
        ======================================================= */}
        {activeTab === "accommodations" && data?.accommodations && (
          <section className="space-y-6 animate-in fade-in duration-200">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-[22px] bg-white border border-black/10 p-5 shadow-sm">
                <span className="text-[10px] font-bold uppercase tracking-wider text-black/40">Total Stays</span>
                <p className="mt-2 text-3xl font-bold text-black">{data.accommodations.totalBookings}</p>
                <p className="text-xs text-black/50 mt-1">Delegates requested campus stay</p>
              </div>

              <div className="rounded-[22px] bg-white border border-black/10 p-5 shadow-sm">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800/70">Confirmed & Paid</span>
                <p className="mt-2 text-3xl font-bold text-emerald-700">{data.accommodations.paidBookings}</p>
                <p className="text-xs text-emerald-800/60 mt-1">Completed bookings</p>
              </div>

              <div className="rounded-[22px] bg-white border border-black/10 p-5 shadow-sm">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800/70">Pending Holds</span>
                <p className="mt-2 text-3xl font-bold text-amber-600">{data.accommodations.pendingBookings}</p>
                <p className="text-xs text-amber-800/60 mt-1">Awaiting checkout</p>
              </div>

              <div className="rounded-[22px] bg-white border border-black/10 p-5 shadow-sm">
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-800/70">Hostel Checked-In</span>
                <p className="mt-2 text-3xl font-bold text-blue-700">{data.accommodations.checkedIn}</p>
                <p className="text-xs text-blue-800/60 mt-1">Arrived on campus</p>
              </div>
            </div>

            {/* Daily Occupancy */}
            <div className="rounded-[28px] bg-white border border-black/10 p-6 shadow-sm">
              <h3 className="text-base font-bold text-black mb-4">Daily Check-In Date Occupancy</h3>
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                {data.accommodations.dateOccupancy.map((d) => (
                  <div key={d.date} className="rounded-2xl bg-black/[0.02] border border-black/5 p-4">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-black/40">Date</span>
                    <h4 className="text-lg font-bold text-black mt-1">{d.date}</h4>
                    <p className="text-2xl font-bold text-violet-700 mt-2">{d.count}</p>
                    <p className="text-[10px] text-black/45">Checking in this date</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

      </div>
    </main>
  );
}
