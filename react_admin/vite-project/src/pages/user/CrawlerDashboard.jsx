import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { CiFilter, CiSearch } from "react-icons/ci";
import { FiRefreshCw } from "react-icons/fi";
import { Tooltip } from "react-tooltip";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Cell, PieChart, Pie, Legend,
} from "recharts";
import SimpleDateRangePicker from "../../components/SimpleDatepicker";
import {
  fetchDashboardOverview,
  fetchDashboardSystem,
  fetchDashboardAccounts,
  fetchDashboardAccountTimeline,
  fetchDashboardPlatforms,
  fetchSystemDebug,
  fetchGdnBenchmark,
  fetchYoutubeBenchmark,
  fetchStatusSystemInfo,
  fetchExporterHealth,
} from "../../store/actions/powerAdsPyActionsApi";
import TimeChart from "./ModalSystemStatusInfo";
import ModalAccountStatusInfo from "./ModalAccountStatusInfo";
import Facebook from "../../assets/Social/fb.png";
import Google from "../../assets/Social/Google.png";
import Instagram from "../../assets/Social/Instagram.png";
import Native from "../../assets/Social/Native.png";
import Gdn from "../../assets/Social/Google-ads.png";
import Youtube from "../../assets/Social/Youtube.png";
import Linkedin from "../../assets/Social/Linkedin.png";
import Quora from "../../assets/Social/Quora.png";
import Reddit from "../../assets/Social/Reddit.png";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const NETWORK_ICONS = {
  facebook: Facebook,
  instagram: Instagram,
  gtext: Google,
  youtube: Youtube,
  native: Native,
  gdn: Gdn,
  linkedin: Linkedin,
  reddit: Reddit,
  quora: Quora,
};
const NETWORK_LABEL = {
  facebook: "Facebook",
  instagram: "Instagram",
  gtext: "Google",
  youtube: "YouTube",
  native: "Native",
  gdn: "GDN",
  linkedin: "LinkedIn",
  reddit: "Reddit",
  quora: "Quora",
};

const NETWORK_COLORS = {
  facebook: "#1877f2",
  instagram: "#e1306c",
  gtext: "#ea4335",
  youtube: "#ff0000",
  native: "#0ea5e9",
  gdn: "#34a853",
  linkedin: "#0a66c2",
  reddit: "#ff4500",
  quora: "#b92b27",
};
const CHART_PALETTE = ["#1f296a", "#264688", "#7c3aed", "#16a34a", "#0ea5e9", "#e1306c", "#ff7f0e", "#b92b27", "#0a66c2", "#34a853"];

const PLATFORM_OPTIONS = [
  { value: "10", label: "Scroll Plugin" },
  { value: "12", label: "Python Crawler" },
];

const REFRESH_OPTIONS = [
  { value: 0, label: "Off" },
  { value: 10000, label: "10s" },
  { value: 30000, label: "30s" },
  { value: 60000, label: "1m" },
];

const loadSelectedDates = () => {
  try {
    const saved = sessionStorage.getItem("dateRange");
    if (saved) {
      const p = JSON.parse(saved);
      return { startDate: new Date(p.startDate), endDate: new Date(p.endDate) };
    }
  } catch {
    /* ignore bad sessionStorage */
  }
  return { startDate: new Date(), endDate: new Date() };
};

const fmtDate = (d) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate()
  ).padStart(2, "0")}`;
};

const daysInclusive = (from, to) => {
  const a = new Date(from);
  const b = new Date(to);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.abs(b - a) / 86400000 + 1;
};

// "5m ago", "2h ago", "3d ago", "—"
const agoText = (sec) => {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
};

const nfmt = (n) =>
  n == null ? "—" : Number(n).toLocaleString("en-US");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2026-06-18" -> "18 Jun 2026"
const niceDate = (s) => {
  if (!s) return "";
  const [y, m, d] = String(s).slice(0, 10).split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1] || m} ${y}`;
};
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
// Human window label: "Today (18 Jun 2026)" | "18 Jun 2026" | "16 Jun → 18 Jun 2026"
const windowLabel = (win) => {
  if (!win?.from) return "";
  if (win.from === win.to) {
    return win.from === todayStr() ? `Today (${niceDate(win.from)})` : niceDate(win.from);
  }
  return `${niceDate(win.from)} → ${niceDate(win.to)}`;
};

/* ------------------------------------------------------------------ */
/* data-source legend + "where does this come from?" info             */
/* ------------------------------------------------------------------ */

// Every field is tagged: db (MySQL activities/users), prom (Prometheus live
// telemetry), or both (bridged / combined).
const SOURCE = {
  db:   { letter: "D", label: "Database (MySQL)", color: "#2563eb", bg: "#eff4ff" },
  prom: { letter: "P", label: "Prometheus (live)", color: "#7c3aed", bg: "#f5f0ff" },
  both: { letter: "B", label: "DB + Prometheus", color: "#16a34a", bg: "#ecfdf3" },
};

const SourceDot = ({ s, withLabel }) => {
  const m = SOURCE[s];
  if (!m) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-1.5 text-[10px] font-bold leading-[16px]"
      style={{ color: m.color, background: m.bg }}
      data-tooltip-id="dash-tip"
      data-tooltip-content={`Source: ${m.label}`}
    >
      {m.letter}
      {withLabel ? <span className="font-medium">{m.label}</span> : null}
    </span>
  );
};

// The single source of truth for "kaunsa data kaha se" — shown in the Info modal.
const FIELD_SOURCES = [
  { f: "System name (PAS####/GLB###)", s: "db",   how: "<net>_accounts_activities.system_id" },
  { f: "Machine hostname (GBSBHL####-PC)", s: "prom", how: "scroll_plugin_counter_total.server_name — bridged to system via shared account_id" },
  { f: "Networks running on a system", s: "db",   how: "which <net>_accounts_activities tables contain that system_id" },
  { f: "Accounts count", s: "db",   how: "COUNT(DISTINCT account_id) in the activities table (window)" },
  { f: "Account ID", s: "db",   how: "<net>_accounts_activities.account_id" },
  { f: "Account name", s: "db",   how: "<net>_users.name (reddit: username)" },
  { f: "Country", s: "db",   how: "<net>_users.current_country / country" },
  { f: "Total Ads (header + per-network)", s: "db", how: "COUNT(id) FROM <net>_ad WHERE last_seen in window — same query as Crawler Insight /get-count (metric=range)" },
  { f: "Unique Ads (header + per-network)", s: "db", how: "COUNT(id) FROM <net>_ad WHERE first_seen in window (new ads). With a platform filter: COUNT on the platform table by created date + platform IN(...)" },
  { f: "Per-system Ads (card)", s: "db", how: "<net>_accounts_activities COUNT in window — system-level activity (the ad table can't attribute per system)" },
  { f: "Last active / “X ago”", s: "db",   how: "MAX(created_at) in the activities table" },
  { f: "Active / Idle badge", s: "both", how: "active if Prometheus heartbeat OR scraping-now OR DB last-activity within 10 min" },
  { f: "Live now (heartbeat)", s: "prom", how: "increase(account_active_hb_total[120s]) > 0" },
  { f: "Scraping now (▶ /min)", s: "prom", how: "rate(scroll_plugin_counter_total[2m]) × 60 (per host / per account)" },
  { f: "CPU % / RAM %", s: "prom", how: "cpu_utilization / ram_utilization (per host)" },
  { f: "Status timeline (system/account)", s: "prom", how: "account_active_hb_total / system heartbeat over the window" },
  { f: "Charts (Top systems / accounts / network)", s: "both", how: "DB ads OR Prometheus live rate, depending on what's active" },
];

const InfoButton = ({ onClick, className = "" }) => (
  <button
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    className={`inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#cdd6f4] bg-white text-[11px] font-bold text-[#1f296a] hover:bg-[#eef2ff] ${className}`}
    data-tooltip-id="dash-tip"
    data-tooltip-content="Where does this data come from?"
  >
    i
  </button>
);

/* ------------------------------------------------------------------ */
/* small presentational pieces                                         */
/* ------------------------------------------------------------------ */

const KpiTile = ({ label, value, accent = "#1f296a", sub, onClick, active, hint, source }) => (
  <div
    onClick={onClick}
    data-tooltip-id={hint ? "dash-tip" : undefined}
    data-tooltip-content={hint}
    className={`flex flex-col justify-between rounded-[14px] border bg-white px-5 py-4 shadow-sm min-w-[150px] transition ${
      onClick ? "cursor-pointer hover:border-[#1f296a] hover:shadow-md" : ""
    } ${active ? "border-[#1f296a] ring-1 ring-[#1f296a]" : "border-[#e6e9f5]"}`}
  >
    <span className="flex items-center gap-1.5 text-[13px] font-medium text-[#7a83a8] uppercase tracking-wide">
      {label}
      {source ? <SourceDot s={source} /> : null}
    </span>
    <span className="text-[30px] font-[700] leading-tight" style={{ color: accent }}>
      {value}
    </span>
    {sub ? <span className="text-[12px] text-[#9aa2c0]">{sub}</span> : null}
  </div>
);

const MiniBar = ({ value, color }) => (
  <div className="h-[6px] w-full rounded-full bg-[#eef1fb] overflow-hidden">
    <div
      className="h-full rounded-full transition-all"
      style={{ width: `${Math.min(100, Math.max(0, value || 0))}%`, background: color }}
    />
  </div>
);

// Compact table for the GDN/Native benchmark modal. cols = [[key, label, isNum?], ...]
const BenchTable = ({ title, rows, cols, limit = 25 }) => {
  const data = (rows || []).slice(0, limit);
  if (!data.length) return null;
  return (
    <div className="rounded-[12px] border border-[#eef1fb]">
      <div className="border-b border-[#eef1fb] px-3 py-2 text-[12px] font-semibold text-[#1f296a]">{title}</div>
      <div className="max-h-[220px] overflow-auto">
        <table className="w-full text-left text-[12px]">
          <thead className="sticky top-0 bg-white text-[10px] uppercase text-[#9aa2c0]">
            <tr className="border-b border-[#f4f6fc]">
              {cols.map(([k, l, isNum]) => (
                <th key={k} className={`px-3 py-1.5 ${isNum ? "text-right" : ""}`}>{l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={i} className="border-b border-[#f7f8fd] hover:bg-[#f7f8fd]">
                {cols.map(([k, , isNum]) => (
                  <td key={k} className={`px-3 py-1.5 ${isNum ? "text-right tabular-nums text-[#264688]" : "text-[#7a83a8]"}`}>
                    {isNum ? Number(r[k] || 0).toLocaleString("en-US") : (r[k] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

const CrawlerDashboard = () => {
  const dispatch = useDispatch();
  const { dashboardOverview, loadingDashboardOverview, dashboardError, exporterHealth,
          dashboardSystem, loadingDashboardSystem, StatusSystemInfo, loadingStatusSystemInfo,
          dashboardAccounts, loadingDashboardAccounts,
          dashboardAccountTimeline, loadingDashboardAccountTimeline,
          dashboardPlatforms, systemDebug, loadingSystemDebug,
          gdnBenchmark, loadingGdnBenchmark,
          ytBenchmark, loadingYtBenchmark } =
    useSelector((s) => s.poweradspy);

  const [dateRange, setDateRange] = useState(loadSelectedDates());
  const [platform, setPlatform] = useState([]); // [] = both 10 & 12 (no filter)
  const [showFilter, setShowFilter] = useState(false);
  const [refreshMs, setRefreshMs] = useState(60000); // 60s default — lighter on Prometheus/DB
  const [lastUpdated, setLastUpdated] = useState(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all | active | inactive
  const [netFilter, setNetFilter] = useState(null); // null = all networks
  const [sortBy, setSortBy] = useState("recent"); // recent | ads | unique | accounts
  const [scrapingOnly, setScrapingOnly] = useState(false); // "Scraping Now" tile filter
  const [infoOpen, setInfoOpen] = useState(false); // "where does data come from?" modal
  // GDN/Native scraping-benchmark modal
  const [benchOpen, setBenchOpen] = useState(false);
  // YouTube monitoring-benchmark modal
  const [ytOpen, setYtOpen] = useState(false);
  // debug / data-lineage modal
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugSys, setDebugSys] = useState(null);
  const [debugReveal, setDebugReveal] = useState(0); // how many steps shown (real-time feel)
  const [showRawQ, setShowRawQ] = useState(false);

  const systemsRef = useRef(null);

  // drill-down: system status timeline (reuses existing working endpoint)
  const [statusModal, setStatusModal] = useState(false);
  // drill-down: per-system account breakdown (new endpoint)
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillSys, setDrillSys] = useState(null); // the clicked system row
  // filters inside the drill (accounts table)
  const [acctStatus, setAcctStatus] = useState("all"); // all | live | idle
  const [acctNet, setAcctNet] = useState("all");
  const [acctCountry, setAcctCountry] = useState("all");
  const [acctSearch, setAcctSearch] = useState("");
  // account status-timeline modal (new account_id-based endpoint)
  const [acctModal, setAcctModal] = useState(false);
  const [acctModalName, setAcctModalName] = useState("");

  // ALL-accounts modal (Accounts tile / Scraping-Now tile)
  const [accountsModal, setAccountsModal] = useState(false);
  const [allStatus, setAllStatus] = useState("all"); // all | live | idle | scraping
  const [allNet, setAllNet] = useState("all");
  const [allCountry, setAllCountry] = useState("all");
  const [allSystem, setAllSystem] = useState("all");
  const [allSearch, setAllSearch] = useState("");

  const filterRef = useRef(null);
  const filterBtnRef = useRef(null);

  /* persist + build the request payload */
  useEffect(() => {
    sessionStorage.setItem(
      "dateRange",
      JSON.stringify({
        startDate: dateRange.startDate.toISOString(),
        endDate: dateRange.endDate.toISOString(),
      })
    );
  }, [dateRange]);

  const buildPayload = useCallback(
    () => ({
      range: { from: fmtDate(dateRange.startDate), to: fmtDate(dateRange.endDate) },
      platform: platform.length ? platform : undefined,
      activeWindowMin: 10,
    }),
    [dateRange, platform]
  );

  const load = useCallback(() => {
    dispatch(fetchDashboardOverview(buildPayload()))
      .unwrap()
      .then(() => setLastUpdated(Date.now()))
      .catch(() => {});
    // raw metrics-source health (send-metrics) — separate, never blocks overview
    dispatch(fetchExporterHealth());
  }, [dispatch, buildPayload]);

  /* fetch on filter/date change */
  useEffect(() => {
    load();
  }, [load]);

  /* discover all platform values once (for the filter) */
  useEffect(() => {
    dispatch(fetchDashboardPlatforms());
  }, [dispatch]);

  // platform options: discovered list from backend, fallback to the known pair
  const platformOptions = useMemo(
    () => (dashboardPlatforms?.length ? dashboardPlatforms : PLATFORM_OPTIONS),
    [dashboardPlatforms]
  );

  /* live auto-refresh */
  useEffect(() => {
    if (!refreshMs) return undefined;
    const id = setInterval(load, refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, load]);

  /* close filter popover on outside click */
  useEffect(() => {
    const onClick = (e) => {
      if (
        showFilter &&
        filterRef.current &&
        !filterRef.current.contains(e.target) &&
        !filterBtnRef.current?.contains(e.target)
      )
        setShowFilter(false);
    };
    if (showFilter) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showFilter]);

  /* "x ago" ticker for the live indicator */
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const togglePlatform = (val) =>
    setPlatform((prev) => (prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]));

  const totals = dashboardOverview?.totals || {};
  const live = dashboardOverview?.live || {};
  const networks = dashboardOverview?.networks || [];
  const systems = useMemo(() => dashboardOverview?.systems || [], [dashboardOverview]);

  /* derive filtered + sorted systems */
  const visibleSystems = useMemo(() => {
    let rows = systems.slice();
    if (netFilter) rows = rows.filter((r) => (r.networks || []).includes(netFilter));
    if (statusFilter === "active") rows = rows.filter((r) => r.active);
    if (statusFilter === "inactive") rows = rows.filter((r) => !r.active);
    if (scrapingOnly) rows = rows.filter((r) => r.now_rate_per_min > 0);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          String(r.system_id).toLowerCase().includes(q) ||
          String(r.hostname || "").toLowerCase().includes(q)
      );
    }
    rows.sort((a, b) => {
      if (sortBy === "ads") return (b.ads || 0) - (a.ads || 0);
      if (sortBy === "unique") return (b.unique_ads || 0) - (a.unique_ads || 0);
      if (sortBy === "accounts") return (b.accounts || 0) - (a.accounts || 0);
      // recent
      return (a.last_active_ago_sec ?? 1e15) - (b.last_active_ago_sec ?? 1e15);
    });
    return rows;
  }, [systems, netFilter, statusFilter, search, sortBy, scrapingOnly]);

  const handleDateChange = (startDate, endDate) => setDateRange({ startDate, endDate });

  // KPI tile click → apply a quick filter/sort on the systems grid + scroll to it
  const focusSystems = ({ status = "all", net = null, sort = "recent", scraping = false } = {}) => {
    setStatusFilter(status);
    setNetFilter(net);
    setSortBy(sort);
    setScrapingOnly(scraping);
    setTimeout(() => systemsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  // open the GDN/Native scraping-benchmark modal (direct DB, ported v2 dashboard).
  // host = one proxmox system (system-card click); no host = ISP/proxy view (📊).
  const openBenchmark = (opts = {}) => {
    setBenchOpen(true);
    dispatch(fetchGdnBenchmark(opts.host ? { host: opts.host } : { system_id: "decodo-isp" }));
  };

  // open the YouTube monitoring-benchmark modal (direct ES, ported v2 dashboard)
  const openYtBenchmark = () => {
    setYtOpen(true);
    dispatch(fetchYoutubeBenchmark({ limit: 250 }));
  };

  // open the debug / data-lineage trace for a system
  const openDebug = (sys) => {
    setDebugSys(sys);
    setDebugReveal(0);
    setShowRawQ(false);
    setDebugOpen(true);
    dispatch(
      fetchSystemDebug({
        system_id: sys.system_id,
        range: { from: fmtDate(dateRange.startDate), to: fmtDate(dateRange.endDate) },
        platform: platform.length ? platform : undefined,
      })
    );
  };

  // reveal debug steps one-by-one for a "live process" feel
  useEffect(() => {
    if (!debugOpen || !systemDebug?.steps?.length) return undefined;
    if (debugReveal >= systemDebug.steps.length) return undefined;
    const id = setTimeout(() => setDebugReveal((n) => n + 1), 500);
    return () => clearTimeout(id);
  }, [debugOpen, systemDebug, debugReveal]);

  // open the account drill for a system
  const openDrill = (sys) => {
    setDrillSys(sys);
    setDrillOpen(true);
    dispatch(
      fetchDashboardSystem({
        system_id: sys.system_id,
        range: { from: fmtDate(dateRange.startDate), to: fmtDate(dateRange.endDate) },
        platform: platform.length ? platform : undefined,
      })
    );
  };

  // open the Prometheus status-timeline modal (existing endpoint)
  const openSystemStatus = (sys) => {
    setStatusModal(true);
    dispatch(
      fetchStatusSystemInfo({
        range: { from: fmtDate(dateRange.startDate), to: fmtDate(dateRange.endDate) },
        systemName: sys.system_id,
        steps: daysInclusive(dateRange.startDate, dateRange.endDate),
      })
    );
  };

  // open per-account status timeline (NEW account_id-based endpoint — reliable).
  const openAccountStatus = (a) => {
    setAcctModalName(a.name || a.account_id || "Account");
    setAcctModal(true);
    dispatch(
      fetchDashboardAccountTimeline({
        account_id: a.account_id,
        server_name: a.prom_server || drillSys?.hostname || undefined,
        range: { from: fmtDate(dateRange.startDate), to: fmtDate(dateRange.endDate) },
      })
    );
  };

  // open the ALL-accounts modal (Accounts tile / Scraping-Now tile)
  const openAccounts = (preset = "all") => {
    setAllStatus(preset);
    setAllNet("all");
    setAllCountry("all");
    setAllSystem("all");
    setAllSearch("");
    setAccountsModal(true);
    dispatch(
      fetchDashboardAccounts({
        range: { from: fmtDate(dateRange.startDate), to: fmtDate(dateRange.endDate) },
        platform: platform.length ? platform : undefined,
      })
    );
  };

  // all-accounts after the modal filters
  const allAccounts = useMemo(() => dashboardAccounts?.accounts || [], [dashboardAccounts]);
  const visibleAllAccounts = useMemo(() => {
    let rows = allAccounts.slice();
    if (allStatus === "live") rows = rows.filter((a) => a.live);
    if (allStatus === "idle") rows = rows.filter((a) => !a.live);
    if (allStatus === "scraping") rows = rows.filter((a) => a.now_rate_per_min > 0);
    if (allNet !== "all") rows = rows.filter((a) => a.network === allNet);
    if (allCountry !== "all") rows = rows.filter((a) => a.country === allCountry);
    if (allSystem !== "all") rows = rows.filter((a) => a.system_id === allSystem);
    if (allSearch.trim()) {
      const q = allSearch.trim().toLowerCase();
      rows = rows.filter(
        (a) =>
          String(a.name || "").toLowerCase().includes(q) ||
          String(a.account_id || "").toLowerCase().includes(q) ||
          String(a.system_id || "").toLowerCase().includes(q)
      );
    }
    return rows;
  }, [allAccounts, allStatus, allNet, allCountry, allSystem, allSearch]);

  // chart data for the Grafana-style graphical view in the accounts modal.
  // Uses live scrape rate when anything is scraping, else falls back to ads.
  const accountCharts = useMemo(() => {
    const rateMode = visibleAllAccounts.some((a) => a.now_rate_per_min > 0);
    const metric = (a) => (rateMode ? a.now_rate_per_min : a.ads);
    const unit = rateMode ? "/min" : " ads";

    const sysAgg = {};
    const netAgg = {};
    for (const a of visibleAllAccounts) {
      const m = metric(a) || 0;
      if (a.system_id) sysAgg[a.system_id] = (sysAgg[a.system_id] || 0) + m;
      const nk = a.network || "other";
      netAgg[nk] = (netAgg[nk] || 0) + m;
    }
    const topSystems = Object.entries(sysAgg)
      .map(([k, v]) => ({ name: k, value: v }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    const topAccounts = visibleAllAccounts
      .map((a) => ({ name: a.name || String(a.account_id), value: metric(a) || 0, network: a.network }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    const byNetwork = Object.entries(netAgg)
      .map(([k, v]) => ({ name: NETWORK_LABEL[k] || k, key: k, value: v }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
    return { rateMode, unit, topSystems, topAccounts, byNetwork };
  }, [visibleAllAccounts]);

  // accounts after the in-modal filters (status / network / country / search)
  const drillAccounts = useMemo(() => dashboardSystem?.accounts || [], [dashboardSystem]);
  const drillCountries = useMemo(
    () => [...new Set(drillAccounts.map((a) => a.country).filter(Boolean))].sort(),
    [drillAccounts]
  );
  const drillNets = useMemo(
    () => [...new Set(drillAccounts.map((a) => a.network).filter(Boolean))],
    [drillAccounts]
  );
  const visibleAccounts = useMemo(() => {
    let rows = drillAccounts.slice();
    if (acctStatus === "live") rows = rows.filter((a) => a.live);
    if (acctStatus === "idle") rows = rows.filter((a) => !a.live);
    if (acctNet !== "all") rows = rows.filter((a) => a.network === acctNet);
    if (acctCountry !== "all") rows = rows.filter((a) => a.country === acctCountry);
    if (acctSearch.trim()) {
      const q = acctSearch.trim().toLowerCase();
      rows = rows.filter(
        (a) =>
          String(a.name || "").toLowerCase().includes(q) ||
          String(a.account_id || "").toLowerCase().includes(q)
      );
    }
    return rows;
  }, [drillAccounts, acctStatus, acctNet, acctCountry, acctSearch]);

  const updatedAgo = lastUpdated ? Math.floor((Date.now() - lastUpdated) / 1000) : null;

  return (
    <div className="w-full flex flex-col gap-[18px]">
      {/* ===== Header / controls ===== */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
         <div className="flex items-center gap-3">
          <span className="text-[28px] font-[700] text-[#264688]">Crawler Fleet</span>
          <span className="flex items-center gap-1.5 text-[13px] text-[#7a83a8]">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                refreshMs ? "bg-green-500 animate-pulse" : "bg-gray-300"
              }`}
            />
            {refreshMs ? "Live" : "Paused"}
            {lastUpdated ? ` · updated ${updatedAgo}s ago` : ""}
          </span>
          {/* raw metrics source (send-metrics) health */}
          {exporterHealth && (
            <span
              className="flex items-center gap-1.5 rounded-full border border-[#e6e9f5] bg-white px-2 py-0.5 text-[12px] text-[#7a83a8]"
              data-tooltip-id="dash-tip"
              data-tooltip-content={
                exporterHealth.up
                  ? `send-metrics up · ${nfmt(exporterHealth.series)} series · ${exporterHealth.latency_ms}ms`
                  : `send-metrics unreachable${exporterHealth.error ? ` · ${exporterHealth.error}` : ""}`
              }
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  exporterHealth.up ? "bg-green-500" : "bg-red-500"
                }`}
              />
              Metrics source {exporterHealth.up ? "up" : "down"}
            </span>
          )}
         </div>
         {/* date context + data-source legend */}
         <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#9aa2c0]">
           <span>
             Showing data for{" "}
             <b className="text-[#7a83a8]">
               {windowLabel(dashboardOverview?.window) || windowLabel({ from: fmtDate(dateRange.startDate), to: fmtDate(dateRange.endDate) })}
             </b>
           </span>
           <span className="flex items-center gap-1.5">
             <SourceDot s="db" /> DB
             <SourceDot s="prom" /> Prometheus
             <SourceDot s="both" /> Both
             <InfoButton onClick={() => setInfoOpen(true)} className="ml-1" />
           </span>
         </div>
        </div>

        <div className="flex items-center gap-2">
          {/* refresh interval */}
          <select
            value={refreshMs}
            onChange={(e) => setRefreshMs(Number(e.target.value))}
            className="!rounded-lg !border !border-gray-300 !bg-white !px-2 !py-1.5 text-[14px] text-[#1f296a] focus:!outline-0"
            data-tooltip-id="dash-tip"
            data-tooltip-content="Live auto-refresh interval"
          >
            {REFRESH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label === "Off" ? "Refresh: Off" : `Every ${o.label}`}
              </option>
            ))}
          </select>

          {/* manual refresh */}
          <button
            onClick={load}
            className="flex items-center justify-center !rounded-lg !border !border-gray-300 !bg-white !p-2 !w-10"
            data-tooltip-id="dash-tip"
            data-tooltip-content="Refresh now"
          >
            <FiRefreshCw className={`h-5 w-5 ${loadingDashboardOverview ? "animate-spin" : ""}`} />
          </button>

          {/* platform filter */}
          <div className="relative">
            <button
              ref={filterBtnRef}
              onClick={() => setShowFilter((s) => !s)}
              className={`flex items-center justify-center !rounded-lg !border !border-gray-300 !p-1.5 !w-10 ${
                platform.length ? "!bg-[#d2dfff]" : "!bg-white"
              }`}
              data-tooltip-id="dash-tip"
              data-tooltip-content="Filter by crawler type"
            >
              <CiFilter className="h-6 w-6" />
            </button>
            {showFilter && (
              <div
                ref={filterRef}
                className="absolute right-0 top-[50px] z-50 w-72 rounded-xl border border-[#e0e7ff] bg-white p-5 shadow-xl"
              >
                <div className="mb-3 flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700">Crawler type</label>
                  <svg
                    onClick={() => setShowFilter(false)}
                    className="h-5 w-5 cursor-pointer"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div className="flex flex-wrap gap-2">
                  {platformOptions.map((o) => (
                    <div
                      key={o.value}
                      onClick={() => togglePlatform(o.value)}
                      className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${
                        platform.includes(o.value)
                          ? "border-blue-500 bg-blue-100 text-blue-700"
                          : "border-gray-300 bg-gray-100 text-gray-700"
                      }`}
                      data-tooltip-id="dash-tip"
                      data-tooltip-content={`Platform ${o.value}`}
                    >
                      {o.label}
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={() => {
                      setPlatform([]);
                      setShowFilter(false);
                    }}
                    className="!rounded-lg !border !border-[#d1d5db] !bg-gray-200 !px-4 !py-2 text-sm font-medium text-[#1f296a]"
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* date range (existing component, preserved) */}
          <SimpleDateRangePicker
            initialStartDate={dateRange.startDate}
            initialEndDate={dateRange.endDate}
            onDateChange={handleDateChange}
            setSelectedSystem={() => {}}
            setShowFilterModal={setShowFilter}
          />
        </div>
      </div>

      {dashboardError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          Could not load dashboard: {String(dashboardError)}
        </div>
      )}

      {/* ===== KPI tiles (clickable → filter/sort the grid) ===== */}
      <div className="flex flex-wrap gap-3">
        <KpiTile
          label="Total Systems" value={nfmt(totals.systems)} accent="#1f296a" source="db"
          hint="Show all systems"
          active={statusFilter === "all" && !netFilter && !scrapingOnly}
          onClick={() => focusSystems({ status: "all" })}
        />
        <KpiTile
          label="Active Now" value={nfmt(totals.active_systems)} accent="#16a34a" sub="live / last 10 min" source="both"
          hint="Show only active systems"
          active={statusFilter === "active" && !scrapingOnly}
          onClick={() => focusSystems({ status: "active" })}
        />
        <KpiTile
          label="Inactive" value={nfmt(totals.inactive_systems)} accent="#9aa2c0" source="both"
          hint="Show only idle systems"
          active={statusFilter === "inactive"}
          onClick={() => focusSystems({ status: "inactive" })}
        />
        <KpiTile
          label="Scraping Now" source="prom"
          value={live.scrape_rate_per_min != null ? `${nfmt(live.scrape_rate_per_min)}/min` : "—"}
          accent="#16a34a" sub="live fleet rate"
        />
        <KpiTile
          label="Accounts" value={nfmt(totals.accounts)} accent="#264688" source="db"
          hint="Open all accounts (which account on which system)"
          onClick={() => openAccounts("all")}
        />
        <KpiTile label="Total Ads" value={nfmt(totals.ads)} accent="#264688" source="db"
          hint="<net>_ad last_seen in window (same as Crawler Insight /get-count)" />
        <KpiTile label="Unique Ads" value={nfmt(totals.unique_ads)} accent="#7c3aed" source="db"
          hint="<net>_ad first_seen in window (new ads)" />
        <KpiTile label="Networks" value={nfmt(totals.networks_active)} accent="#264688" source="db" />
      </div>

      {/* Live activity strip (cycles/captures/plugin-events) hidden until the
          prod metric names are confirmed — they were returning 0. The Scraping
          Now tile (scrape_rate_per_min) works and stays. */}

      {/* ===== Per-network cards (clickable filter) ===== */}
      <div className="flex flex-wrap gap-3">
        <div
          onClick={() => setNetFilter(null)}
          className={`cursor-pointer rounded-[12px] border px-4 py-3 ${
            netFilter === null ? "border-[#1f296a] bg-[#eef2ff]" : "border-[#e6e9f5] bg-white"
          }`}
        >
          <div className="text-[13px] font-semibold text-[#1f296a]">All networks</div>
          <div className="text-[12px] text-[#7a83a8]">{nfmt(totals.systems)} systems</div>
        </div>
        {networks
          .filter((n) => n && n.systems > 0)
          .map((n) => {
            const sel = netFilter === n.network;
            const hasGdnBench = n.network === "gdn" || n.network === "native";
            const isYt = n.network === "youtube";
            return (
              <div
                key={n.network}
                onClick={() => setNetFilter(sel ? null : n.network)}
                className={`flex cursor-pointer items-center gap-3 rounded-[12px] border px-4 py-3 ${
                  sel ? "border-[#1f296a] bg-[#eef2ff]" : "border-[#e6e9f5] bg-white"
                }`}
                data-tooltip-id="dash-tip"
                data-tooltip-content="Filter systems by this network"
              >
                {NETWORK_ICONS[n.network] && (
                  <img src={NETWORK_ICONS[n.network]} alt="" className="h-8 w-8 rounded-full border border-[#e6e9f5] p-1" />
                )}
                <div className="flex flex-col">
                  <div className="flex items-center gap-2 text-[14px] font-semibold text-[#1f296a]">
                    {NETWORK_LABEL[n.network] || n.network}
                    <span className="flex items-center gap-1 text-[11px] font-normal text-[#16a34a]">
                      <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                      {n.active_systems} live
                    </span>
                    {(hasGdnBench || isYt) && (
                      <button
                        onClick={(e) => { e.stopPropagation(); isYt ? openYtBenchmark() : openBenchmark(); }}
                        className="rounded-full bg-[#7c3aed] px-1.5 text-[9px] font-bold text-white hover:bg-[#6d28d9]"
                        data-tooltip-id="dash-tip"
                        data-tooltip-content={isYt ? "Open YouTube live benchmark (status, 1h/3h/24h, recent ads feed)" : "Open ISP/proxy crawl-benchmark (all machines, providers, proxy)"}
                      >
                        📊
                      </button>
                    )}
                  </div>
                  <div className="text-[12px] text-[#7a83a8]">
                    {n.systems} sys · {nfmt(n.ads)} ads · {nfmt(n.unique_ads)} uniq
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      {/* ===== Systems panel controls ===== */}
      <div ref={systemsRef} className="flex flex-wrap items-center justify-between gap-3 scroll-mt-4">
        <div className="flex items-center gap-2 text-[18px] font-[600] text-[#264688]">
          Systems
          {scrapingOnly && (
            <span className="rounded-full bg-green-50 px-2 py-0.5 text-[12px] font-normal text-green-600">scraping now</span>
          )}
          <span className="text-[14px] font-normal text-[#9aa2c0]">
            ({visibleSystems.length}{netFilter ? ` · ${NETWORK_LABEL[netFilter] || netFilter}` : ""})
          </span>
          <InfoButton onClick={() => setInfoOpen(true)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* status filter */}
          <div className="flex overflow-hidden rounded-lg border border-gray-300">
            {[
              { v: "all", l: "All" },
              { v: "active", l: "Active" },
              { v: "inactive", l: "Inactive" },
            ].map((o) => (
              <button
                key={o.v}
                onClick={() => setStatusFilter(o.v)}
                className={`!px-3 !py-1.5 text-[13px] ${
                  statusFilter === o.v ? "!bg-[#1f296a] !text-white" : "!bg-white !text-[#1f296a]"
                }`}
              >
                {o.l}
              </button>
            ))}
          </div>
          {/* sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="!rounded-lg !border !border-gray-300 !bg-white !px-2 !py-1.5 text-[13px] text-[#1f296a] focus:!outline-0"
          >
            <option value="recent">Sort: Last active</option>
            <option value="ads">Sort: Total ads</option>
            <option value="unique">Sort: Unique ads</option>
            <option value="accounts">Sort: Accounts</option>
          </select>
          {/* search */}
          <div className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5">
            <CiSearch className="h-5 w-5 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search system / host"
              className="w-[170px] text-[13px] focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* ===== Systems grid ===== */}
      {loadingDashboardOverview && !systems.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-[150px] animate-pulse rounded-[14px] border border-[#eef1fb] bg-white" />
          ))}
        </div>
      ) : visibleSystems.length === 0 ? (
        <div className="rounded-[14px] border border-[#eef1fb] bg-white px-6 py-10 text-center text-[#9aa2c0]">
          No systems for the selected window / filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleSystems.map((sys) => (
            <div
              key={sys.system_id}
              onClick={() => (sys.kind === "gdncrawl" ? openBenchmark({ host: sys.system_id }) : openDrill(sys))}
              className="group cursor-pointer rounded-[14px] border border-[#e6e9f5] bg-white p-4 shadow-sm transition hover:border-[#1f296a] hover:shadow-md"
            >
              {/* row 1: id + status */}
              <div className="flex items-start justify-between">
                <div className="flex flex-col gap-0.5">
                  {/* system name — from DB (activities.system_id) */}
                  <span className="flex items-center gap-1 text-[15px] font-[700] text-[#1f296a] group-hover:underline">
                    {sys.system_id}
                    <SourceDot s="db" />
                    {/* <button
                      onClick={(e) => { e.stopPropagation(); openDebug(sys); }}
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[#cdd6f4] text-[10px] font-bold text-[#1f296a] hover:bg-[#eef2ff]"
                      data-tooltip-id="dash-tip"
                      data-tooltip-content="System name source — click to trace + see query"
                    >
                      i
                    </button> */}
                  </span>
                  {/* hostname — from Prometheus (server_name, bridged) */}
                  {sys.hostname && (
                    <span className="flex items-center gap-1 text-[11px] text-gray-400">
                      {sys.hostname}
                      <SourceDot s="prom" />
                      {/* <button
                        onClick={(e) => { e.stopPropagation(); openDebug(sys); }}
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[#cdd6f4] text-[10px] font-bold text-[#7c3aed] hover:bg-[#f5f0ff]"
                        data-tooltip-id="dash-tip"
                        data-tooltip-content="Hostname source — click to trace + see query"
                      >
                        i
                      </button> */}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); openDebug(sys); }}
                    className="rounded-md border border-[#e6e9f5] bg-white px-1.5 py-0.5 text-[11px] font-medium text-[#7a83a8] hover:border-[#1f296a] hover:text-[#1f296a]"
                    data-tooltip-id="dash-tip"
                    data-tooltip-content="Debug: where did this data come from?"
                  >
                    ⓘ debug
                  </button>
                  <span
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      sys.active ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        sys.active ? "bg-green-500 animate-pulse" : "bg-gray-400"
                      }`}
                    />
                    {sys.active ? "Active" : "Idle"}
                  </span>
                </div>
              </div>

              {/* row 1b: live scraping rate "right now" */}
              {sys.now_rate_per_min > 0 && (
                <div className="mt-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-600">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                    ▶ {nfmt(sys.now_rate_per_min)}/min now
                  </span>
                </div>
              )}

              {/* row 2: last active + network icons */}
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[12px] text-[#7a83a8]">
                  Last active: <b className="text-[#1f296a]">{agoText(sys.last_active_ago_sec)}</b>
                </span>
                <div className="flex -space-x-1">
                  {(sys.networks || []).slice(0, 5).map((net) =>
                    NETWORK_ICONS[net] ? (
                      <img
                        key={net}
                        src={NETWORK_ICONS[net]}
                        alt={net}
                        title={NETWORK_LABEL[net] || net}
                        className="h-6 w-6 rounded-full border border-white bg-white"
                      />
                    ) : null
                  )}
                </div>
              </div>

              {/* row 3: mini stats */}
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-[#f7f8fd] py-1.5">
                  <div className="text-[15px] font-[700] text-[#264688]">{nfmt(sys.accounts)}</div>
                  <div className="text-[10px] uppercase text-[#9aa2c0]">Accounts</div>
                </div>
                <div className="rounded-lg bg-[#f7f8fd] py-1.5">
                  <div className="text-[15px] font-[700] text-[#264688]">{nfmt(sys.ads)}</div>
                  <div className="text-[10px] uppercase text-[#9aa2c0]">Ads</div>
                </div>
                <div className="rounded-lg bg-[#f7f8fd] py-1.5">
                  <div className="text-[15px] font-[700] text-[#7c3aed]">{nfmt(sys.unique_ads)}</div>
                  <div className="text-[10px] uppercase text-[#9aa2c0]">Unique</div>
                </div>
              </div>

              {/* row 4: cpu / ram (when Prometheus has it) */}
              {(sys.cpu != null || sys.ram != null) && (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-9 text-[11px] text-[#7a83a8]">CPU</span>
                    <MiniBar value={sys.cpu} color="#1f296a" />
                    <span className="w-9 text-right text-[11px] text-[#1f296a]">
                      {sys.cpu != null ? `${sys.cpu}%` : "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-9 text-[11px] text-[#7a83a8]">RAM</span>
                    <MiniBar value={sys.ram} color="#7c3aed" />
                    <span className="w-9 text-right text-[11px] text-[#1f296a]">
                      {sys.ram != null ? `${sys.ram}%` : "—"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ===== System drill modal — accounts breakdown ===== */}
      {drillOpen && drillSys && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 transition-all duration-300"
          onClick={() => setDrillOpen(false)}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-[20px] border border-white/20 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* header */}
            <div className="flex items-start justify-between border-b border-[#eef1fb] px-6 py-4">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-[20px] font-[700] text-[#1f296a]">{drillSys.system_id}</span>
                  <InfoButton onClick={() => setInfoOpen(true)} />
                  <span
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      drillSys.active ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    <span className={`inline-block h-2 w-2 rounded-full ${drillSys.active ? "bg-green-500" : "bg-gray-400"}`} />
                    {drillSys.active ? "Active" : "Idle"}
                  </span>
                  {drillSys.now_rate_per_min > 0 && (
                    <span className="text-[12px] font-semibold text-green-600">▶ {nfmt(drillSys.now_rate_per_min)}/min now</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 text-[12px] text-[#7a83a8]">
                  {drillSys.hostname && <span>{drillSys.hostname}</span>}
                  <span>Last active: <b className="text-[#1f296a]">{agoText(drillSys.last_active_ago_sec)}</b></span>
                  {drillSys.cpu != null && <span>CPU {drillSys.cpu}%</span>}
                  {drillSys.ram != null && <span>RAM {drillSys.ram}%</span>}
                  <span>Window: <b className="text-[#1f296a]">{windowLabel(dashboardSystem?.window) || windowLabel(dashboardOverview?.window)}</b></span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openSystemStatus(drillSys)}
                  className="!rounded-lg !border !border-[#d2dfff] !bg-[#eef2ff] !px-3 !py-1.5 text-[13px] font-medium text-[#1f296a]"
                >
                  Status timeline
                </button>
                <button onClick={() => setDrillOpen(false)} className="text-gray-400 hover:text-gray-600">
                  <svg className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>

            {/* totals */}
            <div className="flex flex-wrap gap-3 px-6 py-3">
              {[
                { l: "Accounts", v: dashboardSystem?.totals?.accounts, c: "#264688" },
                { l: "Live now", v: dashboardSystem?.totals?.live_accounts, c: "#16a34a" },
                { l: "Total Ads", v: dashboardSystem?.totals?.ads, c: "#264688" },
                { l: "Unique Ads", v: dashboardSystem?.totals?.unique_ads, c: "#7c3aed" },
                { l: "Networks", v: dashboardSystem?.totals?.networks, c: "#264688" },
              ].map((t) => (
                <div key={t.l} className="rounded-lg bg-[#f7f8fd] px-4 py-2">
                  <div className="text-[18px] font-[700]" style={{ color: t.c }}>{nfmt(t.v)}</div>
                  <div className="text-[10px] uppercase text-[#9aa2c0]">{t.l}</div>
                </div>
              ))}
            </div>

            {/* account filters */}
            {drillAccounts.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-6 pb-1">
                <div className="flex overflow-hidden rounded-lg border border-gray-300 text-[12px]">
                  {[
                    { v: "all", l: "All" },
                    { v: "live", l: "Live" },
                    { v: "idle", l: "Idle" },
                  ].map((o) => (
                    <button
                      key={o.v}
                      onClick={() => setAcctStatus(o.v)}
                      className={`!px-3 !py-1 ${acctStatus === o.v ? "!bg-[#1f296a] !text-white" : "!bg-white !text-[#1f296a]"}`}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
                {drillNets.length > 1 && (
                  <select
                    value={acctNet}
                    onChange={(e) => setAcctNet(e.target.value)}
                    className="!rounded-lg !border !border-gray-300 !bg-white !px-2 !py-1 text-[12px] text-[#1f296a]"
                  >
                    <option value="all">All networks</option>
                    {drillNets.map((n) => (
                      <option key={n} value={n}>{NETWORK_LABEL[n] || n}</option>
                    ))}
                  </select>
                )}
                {drillCountries.length > 0 && (
                  <select
                    value={acctCountry}
                    onChange={(e) => setAcctCountry(e.target.value)}
                    className="!rounded-lg !border !border-gray-300 !bg-white !px-2 !py-1 text-[12px] text-[#1f296a]"
                  >
                    <option value="all">All countries</option>
                    {drillCountries.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                )}
                <div className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2 py-1">
                  <CiSearch className="h-4 w-4 text-gray-400" />
                  <input
                    value={acctSearch}
                    onChange={(e) => setAcctSearch(e.target.value)}
                    placeholder="Search account / id"
                    className="w-[150px] text-[12px] focus:outline-none"
                  />
                </div>
                <span className="text-[12px] text-[#9aa2c0]">({visibleAccounts.length})</span>
              </div>
            )}

            {/* accounts table */}
            <div className="flex-1 overflow-auto px-6 pb-5">
              {loadingDashboardSystem ? (
                <div className="space-y-2 pt-2">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-9 animate-pulse rounded bg-[#f1f3fb]" />
                  ))}
                </div>
              ) : (dashboardSystem?.accounts?.length || dashboardSystem?.perNetwork?.length || dashboardSystem?.recent?.length) ? (
                <>
                  {drillAccounts.length > 0 && (
                    <table className="w-full text-left text-[13px]">
                      <thead className="sticky top-0 bg-white text-[11px] uppercase text-[#9aa2c0]">
                        <tr className="border-b border-[#eef1fb]">
                          <th className="py-2"><span className="inline-flex items-center gap-1">Account <SourceDot s="db" /></span></th>
                          <th className="py-2"><span className="inline-flex items-center gap-1">Network <SourceDot s="db" /></span></th>
                          <th className="py-2"><span className="inline-flex items-center gap-1">Country <SourceDot s="db" /></span></th>
                          <th className="py-2"><span className="inline-flex items-center gap-1">Status <SourceDot s="prom" /></span></th>
                          <th className="py-2 text-right"><span className="inline-flex items-center gap-1">Ads <SourceDot s="db" /></span></th>
                          <th className="py-2 text-right"><span className="inline-flex items-center gap-1">Unique <SourceDot s="db" /></span></th>
                          <th className="py-2 text-right"><span className="inline-flex items-center gap-1">Last active <SourceDot s="db" /></span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleAccounts.map((a, i) => (
                          <tr
                            key={`${a.network}-${a.account_id}-${i}`}
                            onClick={() => openAccountStatus(a)}
                            className="cursor-pointer border-b border-[#f4f6fc] hover:bg-[#f7f8fd]"
                            data-tooltip-id="dash-tip"
                            data-tooltip-content="Click for account status timeline"
                          >
                            <td className="py-2">
                              <div className="flex flex-col">
                                <span className="font-medium text-[#1f296a] hover:underline">
                                  {a.name || a.account_id || "—"}
                                </span>
                                {a.name && a.account_id && (
                                  <span className="text-[11px] text-gray-400">{a.account_id}</span>
                                )}
                              </div>
                            </td>
                            <td className="py-2">
                              <span className="inline-flex items-center gap-1.5 text-[#7a83a8]">
                                {NETWORK_ICONS[a.network] && (
                                  <img src={NETWORK_ICONS[a.network]} alt="" className="h-4 w-4 rounded-full" />
                                )}
                                {NETWORK_LABEL[a.network] || a.network}
                              </span>
                            </td>
                            <td className="py-2 text-[#7a83a8]">{a.country || "—"}</td>
                            <td className="py-2">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                  a.live ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"
                                }`}
                              >
                                <span className={`inline-block h-1.5 w-1.5 rounded-full ${a.live ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
                                {a.live ? "Live" : "Idle"}
                              </span>
                            </td>
                            <td className="py-2 text-right tabular-nums">{nfmt(a.ads)}</td>
                            <td className="py-2 text-right tabular-nums text-[#7c3aed]">{nfmt(a.unique_ads)}</td>
                            <td className="py-2 text-right text-[#7a83a8]">{agoText(a.last_active_ago_sec)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {/* system-only networks (no accounts) */}
                  {dashboardSystem?.perNetwork?.some((p) => p.accounts === 0) && (
                    <div className="mt-4">
                      <div className="mb-2 text-[11px] uppercase text-[#9aa2c0]">
                        System-level networks (no per-account split)
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {dashboardSystem.perNetwork.filter((p) => p.accounts === 0).map((p) => (
                          <div key={p.network} className="flex items-center gap-2 rounded-lg border border-[#eef1fb] px-3 py-2 text-[12px]">
                            {NETWORK_ICONS[p.network] && <img src={NETWORK_ICONS[p.network]} alt="" className="h-4 w-4 rounded-full" />}
                            <span className="font-medium text-[#1f296a]">{NETWORK_LABEL[p.network] || p.network}</span>
                            <span className="text-[#7a83a8]">{nfmt(p.ads)} ads · {nfmt(p.unique_ads)} uniq</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 🔴 per-system LIVE feed (youtube): the latest ads THIS machine just processed */}
                  {dashboardSystem?.recent?.length > 0 && (
                    <div className="mt-4 rounded-[12px] border border-[#fde2e2] bg-[#fff7f7]">
                      <div className="flex items-center gap-2 border-b border-[#fde2e2] px-3 py-2 text-[12px] font-semibold text-[#b42318]">
                        <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                        Live feed — ads this system just processed (most recent first)
                      </div>
                      <div className="max-h-[240px] overflow-auto">
                        <table className="w-full text-left text-[12px]">
                          <thead className="sticky top-0 bg-[#fff7f7] text-[10px] uppercase text-[#9aa2c0]">
                            <tr className="border-b border-[#fde2e2]">
                              <th className="px-3 py-1.5">When</th><th className="px-3 py-1.5">Ad ID</th>
                              <th className="px-3 py-1.5">Type</th><th className="px-3 py-1.5">Placement</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dashboardSystem.recent.slice(0, 60).map((p, i) => (
                              <tr key={i} className="border-b border-[#fbeaea] hover:bg-[#fff0f0]">
                                <td className="px-3 py-1.5 whitespace-nowrap text-[#7a83a8]">{p.ts ? agoText(Math.max(0, Math.floor(Date.now() / 1000) - p.ts)) : "—"}</td>
                                <td className="px-3 py-1.5 text-[#1f296a]">{p.ad_id}</td>
                                <td className="px-3 py-1.5 text-[#7a83a8]">{p.ad_type || "—"}</td>
                                <td className="px-3 py-1.5 text-[#7a83a8]">{p.ad_position || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="py-10 text-center text-[#9aa2c0]">
                  No account activity for this system in the selected window.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== ALL accounts modal (Accounts / Scraping-Now tiles) ===== */}
      {accountsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 transition-all duration-300"
          onClick={() => setAccountsModal(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-[20px] border border-white/20 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* header */}
            <div className="flex items-start justify-between border-b border-[#eef1fb] px-6 py-4">
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-[20px] font-[700] text-[#1f296a]">
                  {allStatus === "scraping" ? "Accounts scraping now" : "All accounts"}
                  <InfoButton onClick={() => setInfoOpen(true)} />
                </span>
                <span className="text-[12px] text-[#9aa2c0]">
                  Realtime · {windowLabel(dashboardAccounts?.window) || windowLabel(dashboardOverview?.window)}
                </span>
              </div>
              <button onClick={() => setAccountsModal(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            {/* totals */}
            <div className="flex flex-wrap gap-3 px-6 py-3">
              {[
                { l: "Accounts", v: dashboardAccounts?.totals?.accounts, c: "#264688" },
                { l: "Live now", v: dashboardAccounts?.totals?.live, c: "#16a34a" },
                { l: "Scraping now", v: dashboardAccounts?.totals?.scraping, c: "#16a34a" },
                { l: "Total Ads", v: dashboardAccounts?.totals?.ads, c: "#264688" },
                { l: "Unique Ads", v: dashboardAccounts?.totals?.unique_ads, c: "#7c3aed" },
              ].map((t) => (
                <div key={t.l} className="rounded-lg bg-[#f7f8fd] px-4 py-2">
                  <div className="text-[18px] font-[700]" style={{ color: t.c }}>{nfmt(t.v)}</div>
                  <div className="text-[10px] uppercase text-[#9aa2c0]">{t.l}</div>
                </div>
              ))}
            </div>

            {/* filters */}
            <div className="flex flex-wrap items-center gap-2 px-6 pb-2">
              <div className="flex overflow-hidden rounded-lg border border-gray-300 text-[12px]">
                {[
                  { v: "all", l: "All" },
                  { v: "live", l: "Live" },
                  { v: "idle", l: "Idle" },
                  { v: "scraping", l: "Scraping" },
                ].map((o) => (
                  <button
                    key={o.v}
                    onClick={() => setAllStatus(o.v)}
                    className={`!px-3 !py-1 ${allStatus === o.v ? "!bg-[#1f296a] !text-white" : "!bg-white !text-[#1f296a]"}`}
                  >
                    {o.l}
                  </button>
                ))}
              </div>
              <select
                value={allNet}
                onChange={(e) => setAllNet(e.target.value)}
                className="!rounded-lg !border !border-gray-300 !bg-white !px-2 !py-1 text-[12px] text-[#1f296a]"
              >
                <option value="all">All networks</option>
                {(dashboardAccounts?.facets?.networks || []).map((n) => (
                  <option key={n} value={n}>{NETWORK_LABEL[n] || n}</option>
                ))}
              </select>
              <select
                value={allCountry}
                onChange={(e) => setAllCountry(e.target.value)}
                className="!rounded-lg !border !border-gray-300 !bg-white !px-2 !py-1 text-[12px] text-[#1f296a]"
              >
                <option value="all">All countries</option>
                {(dashboardAccounts?.facets?.countries || []).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select
                value={allSystem}
                onChange={(e) => setAllSystem(e.target.value)}
                className="!rounded-lg !border !border-gray-300 !bg-white !px-2 !py-1 text-[12px] text-[#1f296a]"
              >
                <option value="all">All systems</option>
                {(dashboardAccounts?.facets?.systems || []).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <div className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2 py-1">
                <CiSearch className="h-4 w-4 text-gray-400" />
                <input
                  value={allSearch}
                  onChange={(e) => setAllSearch(e.target.value)}
                  placeholder="Search account / id / system"
                  className="w-[180px] text-[12px] focus:outline-none"
                />
              </div>
              <span className="text-[12px] text-[#9aa2c0]">({visibleAllAccounts.length})</span>
            </div>

            {/* ===== graphical view (Grafana-style) ===== */}
            {(accountCharts.topSystems.length > 0 || accountCharts.byNetwork.length > 0) && (
              <div className="px-6 pb-2">
                <div className="mb-2 flex items-center gap-2 text-[12px] text-[#9aa2c0]">
                  <span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  Graphical view —{" "}
                  <b className="text-[#7a83a8]">
                    {accountCharts.rateMode ? "live scrape rate (/min)" : "ads in window"}
                  </b>
                </div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                  {/* top systems */}
                  <div className="rounded-[12px] border border-[#eef1fb] bg-white p-3">
                    <div className="mb-1 text-[12px] font-semibold text-[#1f296a]">Top systems</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={accountCharts.topSystems} layout="vertical" margin={{ left: 8, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef1fb" />
                        <XAxis type="number" tick={{ fontSize: 11, fill: "#9aa2c0" }} />
                        <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 11, fill: "#7a83a8" }} />
                        <RTooltip formatter={(v) => [`${nfmt(v)}${accountCharts.unit}`, "value"]} />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                          {accountCharts.topSystems.map((_, i) => (
                            <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* top accounts */}
                  <div className="rounded-[12px] border border-[#eef1fb] bg-white p-3">
                    <div className="mb-1 text-[12px] font-semibold text-[#1f296a]">Top accounts</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={accountCharts.topAccounts} layout="vertical" margin={{ left: 8, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef1fb" />
                        <XAxis type="number" tick={{ fontSize: 11, fill: "#9aa2c0" }} />
                        <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11, fill: "#7a83a8" }}
                          tickFormatter={(v) => (String(v).length > 12 ? String(v).slice(0, 12) + "…" : v)} />
                        <RTooltip formatter={(v) => [`${nfmt(v)}${accountCharts.unit}`, "value"]} />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                          {accountCharts.topAccounts.map((d, i) => (
                            <Cell key={i} fill={NETWORK_COLORS[d.network] || CHART_PALETTE[i % CHART_PALETTE.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* by network donut */}
                  <div className="rounded-[12px] border border-[#eef1fb] bg-white p-3">
                    <div className="mb-1 text-[12px] font-semibold text-[#1f296a]">By network</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={accountCharts.byNetwork} dataKey="value" nameKey="name"
                          innerRadius={45} outerRadius={75} paddingAngle={2}>
                          {accountCharts.byNetwork.map((d, i) => (
                            <Cell key={i} fill={NETWORK_COLORS[d.key] || CHART_PALETTE[i % CHART_PALETTE.length]} />
                          ))}
                        </Pie>
                        <RTooltip formatter={(v, n) => [`${nfmt(v)}${accountCharts.unit}`, n]} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* table */}
            <div className="flex-1 overflow-auto px-6 pb-5">
              {loadingDashboardAccounts && !allAccounts.length ? (
                <div className="space-y-2 pt-2">
                  {[...Array(8)].map((_, i) => (
                    <div key={i} className="h-9 animate-pulse rounded bg-[#f1f3fb]" />
                  ))}
                </div>
              ) : visibleAllAccounts.length === 0 ? (
                <div className="py-10 text-center text-[#9aa2c0]">No accounts match these filters.</div>
              ) : (
                <table className="w-full text-left text-[13px]">
                  <thead className="sticky top-0 bg-white text-[11px] uppercase text-[#9aa2c0]">
                    <tr className="border-b border-[#eef1fb]">
                      <th className="py-2"><span className="inline-flex items-center gap-1">Account <SourceDot s="db" /></span></th>
                      <th className="py-2"><span className="inline-flex items-center gap-1">Network <SourceDot s="db" /></span></th>
                      <th className="py-2"><span className="inline-flex items-center gap-1">Country <SourceDot s="db" /></span></th>
                      <th className="py-2"><span className="inline-flex items-center gap-1">System <SourceDot s="db" /></span></th>
                      <th className="py-2"><span className="inline-flex items-center gap-1">Status <SourceDot s="prom" /></span></th>
                      <th className="py-2 text-right"><span className="inline-flex items-center gap-1">Ads <SourceDot s="db" /></span></th>
                      <th className="py-2 text-right"><span className="inline-flex items-center gap-1">Unique <SourceDot s="db" /></span></th>
                      <th className="py-2 text-right"><span className="inline-flex items-center gap-1">Last active <SourceDot s="db" /></span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAllAccounts.map((a, i) => (
                      <tr
                        key={`${a.network}-${a.account_id}-${a.system_id}-${i}`}
                        onClick={() => openAccountStatus(a)}
                        className="cursor-pointer border-b border-[#f4f6fc] hover:bg-[#f7f8fd]"
                        data-tooltip-id="dash-tip"
                        data-tooltip-content="Click for account status timeline"
                      >
                        <td className="py-2">
                          <div className="flex flex-col">
                            <span className="font-medium text-[#1f296a] hover:underline">{a.name || a.account_id || "—"}</span>
                            {a.name && a.account_id && (
                              <span className="text-[11px] text-gray-400">{a.account_id}</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2">
                          <span className="inline-flex items-center gap-1.5 text-[#7a83a8]">
                            {NETWORK_ICONS[a.network] && <img src={NETWORK_ICONS[a.network]} alt="" className="h-4 w-4 rounded-full" />}
                            {NETWORK_LABEL[a.network] || a.network}
                          </span>
                        </td>
                        <td className="py-2 text-[#7a83a8]">{a.country || "—"}</td>
                        <td className="py-2 font-medium text-[#264688]">{a.system_id || "—"}</td>
                        <td className="py-2">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                a.live ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"
                              }`}
                            >
                              <span className={`inline-block h-1.5 w-1.5 rounded-full ${a.live ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
                              {a.live ? "Live" : "Idle"}
                            </span>
                            {a.now_rate_per_min > 0 && (
                              <span className="text-[11px] font-semibold text-green-600">▶ {nfmt(a.now_rate_per_min)}/min</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 text-right tabular-nums">{nfmt(a.ads)}</td>
                        <td className="py-2 text-right tabular-nums text-[#7c3aed]">{nfmt(a.unique_ads)}</td>
                        <td className="py-2 text-right text-[#7a83a8]">{agoText(a.last_active_ago_sec)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== System status timeline modal (existing component) ===== */}
      {statusModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-all duration-300"
          onClick={() => setStatusModal(false)}
        >
          <div
            className="flex h-[400px] w-full max-w-7xl items-center justify-center overflow-auto rounded-[20px] border border-white/20 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <TimeChart
              StatusSystemInfo={StatusSystemInfo}
              loadingStatusSystemInfo={loadingStatusSystemInfo}
              dateRange1={dateRange}
              onClose={() => setStatusModal(false)}
              onStageClick={() => {}}
            />
          </div>
        </div>
      )}

      {/* ===== Account status timeline modal (existing component) ===== */}
      {acctModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-all duration-300"
          onClick={() => setAcctModal(false)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-7xl flex-col overflow-auto rounded-[20px] border border-white/20 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {acctModalName && (
              <div className="px-6 pt-4 text-[13px] text-[#7a83a8]">
                Account: <b className="text-[#1f296a]">{acctModalName}</b>
              </div>
            )}
            <ModalAccountStatusInfo
              AccountInfo={dashboardAccountTimeline}
              loadingStatusAccountInfo={loadingDashboardAccountTimeline}
              dateRange1={dateRange}
              onClose={() => setAcctModal(false)}
              onStageClick={() => {}}
            />
            {dashboardAccountTimeline?.empty && (
              <div className="mx-6 mb-4 rounded-lg border border-[#ffe0b3] bg-[#fff8e6] px-4 py-3 text-[12px] text-[#8a6d1a]">
                <div className="mb-1 font-semibold">Why is this empty?</div>
                <div>{dashboardAccountTimeline.reason || "No heartbeat data in the selected window."}</div>
                {dashboardAccountTimeline.servers?.length > 0 && (
                  <div className="mt-1 text-[#7a83a8]">Heartbeat seen on: {dashboardAccountTimeline.servers.join(", ")}</div>
                )}
                {showRawQ && dashboardAccountTimeline.query && (
                  <code className="mt-2 block whitespace-pre-wrap break-all text-[11px] text-[#7a83a8]">{dashboardAccountTimeline.query}</code>
                )}
                <button onClick={() => setShowRawQ((v) => !v)} className="mt-2 text-[11px] font-medium text-[#1f296a] underline">
                  {showRawQ ? "Hide" : "Show"} Prometheus query
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== GDN / Native scraping-benchmark modal ===== */}
      {benchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 transition-all duration-300"
          onClick={() => setBenchOpen(false)}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[20px] border border-white/20 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* header */}
            <div className="flex items-start justify-between border-b border-[#eef1fb] px-6 py-4">
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-[20px] font-[700] text-[#1f296a]">
                  {gdnBenchmark?.scope === "host" ? `System · ${gdnBenchmark.system_id}` : "GDN / Native Scraping Benchmark"}
                  {gdnBenchmark?.live && (
                    <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      gdnBenchmark.live.status === "running" ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"}`}>
                      <span className={`inline-block h-2 w-2 rounded-full ${gdnBenchmark.live.status === "running" ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
                      {gdnBenchmark.live.status || "—"}
                    </span>
                  )}
                </span>
                <span className="text-[12px] text-[#9aa2c0]">
                  {gdnBenchmark?.scope === "host" ? (
                    <>System (proxmox machine): <b className="text-[#7a83a8]">{gdnBenchmark.system_id}</b> · GDN + Native crawl · direct DB</>
                  ) : (
                    <>ISP/Proxy: <b className="text-[#7a83a8]">{gdnBenchmark?.system_id || "decodo-isp"}</b> (not a system) · systems = machines below · direct DB</>
                  )}
                  {gdnBenchmark?.live?.country ? ` · ${gdnBenchmark.live.country}` : ""}
                </span>
              </div>
              <button onClick={() => setBenchOpen(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-auto px-6 py-4">
              {loadingGdnBenchmark && !gdnBenchmark ? (
                <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-10 animate-pulse rounded bg-[#f1f3fb]" />)}</div>
              ) : !gdnBenchmark ? (
                <div className="py-10 text-center text-[#9aa2c0]">No benchmark data.</div>
              ) : (() => {
                const ov = gdnBenchmark.overview || {};
                const lv = gdnBenchmark.live || {};
                const t = ov.totals || {};
                const tp = ov.throughput || {};
                const sp = ov.split || {};
                const Tile = ({ l, v, c = "#264688" }) => (
                  <div className="rounded-lg bg-[#f7f8fd] px-4 py-2">
                    <div className="text-[18px] font-[700]" style={{ color: c }}>{nfmt(v)}</div>
                    <div className="text-[10px] uppercase text-[#9aa2c0]">{l}</div>
                  </div>
                );
                return (
                  <div className="flex flex-col gap-4">
                    {/* tiles */}
                    <div className="flex flex-wrap gap-3">
                      <Tile l="GDN creatives" v={t.gtot} />
                      <Tile l="Native creatives" v={t.ntot} c="#0ea5e9" />
                      <Tile l="GDN ads /24h" v={t.ah24} c="#16a34a" />
                      <Tile l="URLs crawled" v={t.urls} />
                      <Tile l="Countries" v={t.ccs} />
                      <Tile l="Advertisers" v={t.advertisers} c="#7c3aed" />
                      <Tile l="GDN new (live)" v={lv.gdn_new} c="#16a34a" />
                      <Tile l="Native new (live)" v={lv.native_new} c="#16a34a" />
                    </div>

                    {/* live + throughput strip */}
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="rounded-[12px] border border-[#eef1fb] p-3 text-[12px] text-[#7a83a8]">
                        <div className="mb-1 text-[12px] font-semibold text-[#1f296a]">Live session</div>
                        <div>Mode: <b className="text-[#1f296a]">{lv.mode || "—"}</b></div>
                        <div>Done / pool: <b className="text-[#1f296a]">{nfmt(lv.done)}</b> / {nfmt(lv.pool)}</div>
                        <div>Today new: <b className="text-[#1f296a]">{nfmt(gdnBenchmark.today_new)}</b> · ads/hr: <b className="text-[#1f296a]">{nfmt(gdnBenchmark.ads_hr)}</b> (gdn {nfmt(gdnBenchmark.gdn_hr)} / native {nfmt(gdnBenchmark.native_hr)})</div>
                        {gdnBenchmark.fleet?.text && <div className="mt-1 text-[#16a34a]">{gdnBenchmark.fleet.text}</div>}
                      </div>
                      <div className="rounded-[12px] border border-[#eef1fb] p-3 text-[12px] text-[#7a83a8]">
                        <div className="mb-1 text-[12px] font-semibold text-[#1f296a]">Throughput / split</div>
                        <div>GDN new: <b className="text-[#1f296a]">{nfmt(tp.fg_hr)}</b>/hr · <b className="text-[#1f296a]">{nfmt(tp.fg_day)}</b>/day</div>
                        <div>Native new: <b className="text-[#1f296a]">{nfmt(tp.fn_hr)}</b>/hr · <b className="text-[#1f296a]">{nfmt(tp.fn_day)}</b>/day</div>
                        <div>Observed: gdn <b className="text-[#1f296a]">{nfmt(sp.g_obs)}</b> · native <b className="text-[#1f296a]">{nfmt(sp.n_obs)}</b></div>
                      </div>
                    </div>

                    {/* 🔴 LIVE feed — which URLs are being crawled right now (most recent first) */}
                    <div className="rounded-[12px] border border-[#fde2e2] bg-[#fff7f7]">
                      <div className="flex items-center gap-2 border-b border-[#fde2e2] px-3 py-2 text-[12px] font-semibold text-[#b42318]">
                        <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                        Live feed — URLs being processed now {gdnBenchmark?.scope === "host" ? `(${gdnBenchmark.system_id})` : ""}
                        <span className="font-normal text-[#9aa2c0]">· most recent first</span>
                      </div>
                      <div className="max-h-[260px] overflow-auto">
                        {(gdnBenchmark.pages || []).length === 0 ? (
                          <div className="px-3 py-6 text-center text-[12px] text-[#9aa2c0]">No crawl activity in this window.</div>
                        ) : (
                          <table className="w-full text-left text-[12px]">
                            <thead className="sticky top-0 bg-[#fff7f7] text-[10px] uppercase text-[#9aa2c0]">
                              <tr className="border-b border-[#fde2e2]">
                                <th className="px-3 py-1.5">When</th><th className="px-3 py-1.5">Site</th>
                                <th className="px-3 py-1.5">URL</th><th className="px-3 py-1.5">Cc</th><th className="px-3 py-1.5">OS</th>
                                <th className="px-3 py-1.5 text-right">GDN</th><th className="px-3 py-1.5 text-right">Native</th>
                                <th className="px-3 py-1.5">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(gdnBenchmark.pages || []).slice(0, 60).map((p, i) => (
                                <tr key={i} className="border-b border-[#fbeaea] hover:bg-[#fff0f0]">
                                  <td className="px-3 py-1.5 whitespace-nowrap text-[#7a83a8]">{p.ts ? agoText(Math.max(0, Math.floor(Date.now() / 1000) - p.ts)) : "—"}</td>
                                  <td className="px-3 py-1.5 text-[#1f296a]">{p.site || "—"}</td>
                                  <td className="px-3 py-1.5 max-w-[280px] truncate text-[#7a83a8]" title={p.url}>{p.url || "—"}</td>
                                  <td className="px-3 py-1.5 text-[#7a83a8]">{p.cc || "—"}</td>
                                  <td className="px-3 py-1.5 text-[#7a83a8]">{p.os || "—"}</td>
                                  <td className="px-3 py-1.5 text-right tabular-nums text-[#16a34a]">{p.n_gdn == null ? "—" : nfmt(p.n_gdn)}</td>
                                  <td className="px-3 py-1.5 text-right tabular-nums text-[#0ea5e9]">{p.n_native == null ? "—" : nfmt(p.n_native)}</td>
                                  <td className="px-3 py-1.5">
                                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                      (p.n_total || 0) > 0 ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"}`}>
                                      {p.status || ((p.n_total || 0) > 0 ? "hit" : "zero")}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>

                    {/* tables */}
                    <BenchTable title="Providers" rows={ov.providers} cols={[["provider","Provider"],["urls","URLs",1],["countries","Cc",1],["gdn","GDN",1],["native","Native",1],["zero_urls","0-ad",1]]} />
                    <BenchTable title="Machines = Systems (proxmox)" rows={ov.machines} cols={[["host","System (host)"],["os","OS"],["urls","URLs",1],["gdn","GDN",1],["native","Native",1],["hit","Hit",1]]} />
                    <BenchTable title="Native networks" rows={ov.networks} cols={[["network","Network"],["creatives","Creatives",1]]} />
                    <BenchTable title="Top countries" rows={ov.countries} cols={[["country","Country"],["urls","URLs",1],["gdn","GDN",1],["nat","Native",1]]} limit={12} />
                    <BenchTable title="Top sites" rows={ov.sites} cols={[["site","Site"],["urls","URLs",1],["ads","Ads",1]]} limit={12} />
                    <BenchTable title="Top advertisers" rows={ov.advertisers} cols={[["post_owner_name","Advertiser"],["ads_count","Ads",1]]} limit={12} />
                    <BenchTable title={`Proxy quality (${nfmt(ov.proxy_quality?.totals?.ips)} IPs · ${nfmt(ov.proxy_quality?.totals?.ads)} ads)`} rows={ov.proxy_quality?.rows} cols={[["country","Country"],["ips","IPs",1],["used","Used",1],["ads","Ads",1],["urls","URLs",1]]} limit={12} />
                    <BenchTable title={`0-ad URLs (${nfmt(ov.zero_urls?.count)})`} rows={ov.zero_urls?.rows} cols={[["site","Site"],["country","Cc"],["os","OS"],["zero_streak","Streak",1]]} limit={12} />
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ===== YouTube monitoring-benchmark modal (ElasticSearch) ===== */}
      {ytOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 transition-all duration-300"
          onClick={() => setYtOpen(false)}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[20px] border border-white/20 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-[#eef1fb] px-6 py-4">
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-[20px] font-[700] text-[#1f296a]">
                  YouTube Monitoring Benchmark
                  {ytBenchmark?.live && (
                    <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      ytBenchmark.live.status === "running" ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"}`}>
                      <span className={`inline-block h-2 w-2 rounded-full ${ytBenchmark.live.status === "running" ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
                      {ytBenchmark.live.status || "—"}
                    </span>
                  )}
                </span>
                <span className="text-[12px] text-[#9aa2c0]">
                  Live: <b className="text-[#7a83a8]">{ytBenchmark?.live_source === "crawler" ? "crawler feed (real-time)" : "ElasticSearch"}</b>
                  {" · "}overview: ES index <b className="text-[#7a83a8]">{ytBenchmark?.index || "youtube_ads_data"}</b>
                </span>
              </div>
              <button onClick={() => setYtOpen(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-auto px-6 py-4">
              {loadingYtBenchmark && !ytBenchmark ? (
                <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-10 animate-pulse rounded bg-[#f1f3fb]" />)}</div>
              ) : !ytBenchmark ? (
                <div className="py-10 text-center text-[#9aa2c0]">No YouTube data.</div>
              ) : (() => {
                const ov = ytBenchmark.overview || {};
                const lv = ytBenchmark.live || {};
                const t = ov.totals || {};
                const u = ov.unique || {};
                const Tile = ({ l, v, c = "#264688", suf = "" }) => (
                  <div className="rounded-lg bg-[#f7f8fd] px-4 py-2">
                    <div className="text-[18px] font-[700]" style={{ color: c }}>{v == null ? "—" : nfmt(v)}{suf}</div>
                    <div className="text-[10px] uppercase text-[#9aa2c0]">{l}</div>
                  </div>
                );
                return (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap gap-3">
                      <Tile l="Total ads (ES)" v={t.total} />
                      <Tile l="Ads · 1h" v={t.ads_1h} c="#16a34a" />
                      <Tile l="Ads · 24h" v={t.ads_24h} c="#16a34a" />
                      <Tile l="Findable" v={t.shown_pct} suf="%" c="#7c3aed" />
                      <Tile l="Redirect chain" v={ov.redirect_chain?.pct} suf="%" c="#0ea5e9" />
                      <Tile l="Multi-hop (live)" v={lv.multi_hop} c="#ff7f0e" />
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="rounded-[12px] border border-[#eef1fb] p-3 text-[12px] text-[#7a83a8]">
                        <div className="mb-1 text-[12px] font-semibold text-[#1f296a]">Unique vs duplicate</div>
                        <div>1h: new <b className="text-[#16a34a]">{nfmt(u.new_1h)}</b> · dup <b className="text-[#1f296a]">{nfmt(u.dup_1h)}</b></div>
                        <div>24h: new <b className="text-[#16a34a]">{nfmt(u.new_24h)}</b> · dup <b className="text-[#1f296a]">{nfmt(u.dup_24h)}</b></div>
                      </div>
                      <div className="rounded-[12px] border border-[#eef1fb] p-3 text-[12px] text-[#7a83a8]">
                        <div className="mb-1 text-[12px] font-semibold text-[#1f296a]">Live activity (last_seen)</div>
                        <div>1h <b className="text-[#1f296a]">{nfmt(lv.ads_1h)}</b> · 3h <b className="text-[#1f296a]">{nfmt(lv.ads_3h)}</b> · 24h <b className="text-[#1f296a]">{nfmt(lv.ads_24h)}</b></div>
                        <div>new 1h/3h/24h: <b className="text-[#16a34a]">{nfmt(lv.new_1h)}</b> / {nfmt(lv.new_3h)} / {nfmt(lv.new_24h)}</div>
                      </div>
                    </div>

                    <BenchTable title="By ad type (all-time)" rows={ov.by_type} cols={[["type","Type"],["count","Ads",1]]} limit={15} />
                    <BenchTable title="By placement (all-time)" rows={ov.by_position} cols={[["position","Placement"],["count","Ads",1]]} limit={20} />
                    <BenchTable title="By type · 1h vs 24h" rows={ov.by_type_win} cols={[["type","Type"],["h1","1h",1],["d1","24h",1]]} limit={15} />
                    <BenchTable title="By placement · 1h vs 24h" rows={ov.by_position_win} cols={[["position","Placement"],["h1","1h",1],["d1","24h",1]]} limit={20} />
                    <BenchTable title={`Recent ads (multi-hop: ${nfmt(lv.multi_hop)})`} rows={ytBenchmark.pages} cols={[["advertiser","Advertiser"],["ad_type","Type"],["ad_position","Placement"],["hops","Hops",1]]} limit={25} />
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ===== Info modal — "kaunsa data kaha se aata hai" ===== */}
      {infoOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 transition-all duration-300"
          onClick={() => setInfoOpen(false)}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-[20px] border border-white/20 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-[#eef1fb] px-6 py-4">
              <div className="flex flex-col gap-1">
                <span className="text-[20px] font-[700] text-[#1f296a]">Where does each value come from?</span>
                <div className="flex flex-wrap items-center gap-3 text-[12px] text-[#7a83a8]">
                  <span className="flex items-center gap-1"><SourceDot s="db" /> {SOURCE.db.label}</span>
                  <span className="flex items-center gap-1"><SourceDot s="prom" /> {SOURCE.prom.label}</span>
                  <span className="flex items-center gap-1"><SourceDot s="both" /> {SOURCE.both.label}</span>
                </div>
              </div>
              <button onClick={() => setInfoOpen(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-auto px-6 py-4">
              <table className="w-full text-left text-[13px]">
                <thead className="sticky top-0 bg-white text-[11px] uppercase text-[#9aa2c0]">
                  <tr className="border-b border-[#eef1fb]">
                    <th className="py-2">Field</th>
                    <th className="py-2">Source</th>
                    <th className="py-2">How it is computed</th>
                  </tr>
                </thead>
                <tbody>
                  {FIELD_SOURCES.map((row) => (
                    <tr key={row.f} className="border-b border-[#f4f6fc] align-top">
                      <td className="py-2 pr-3 font-medium text-[#1f296a]">{row.f}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={{ color: SOURCE[row.s].color, background: SOURCE[row.s].bg }}
                        >
                          {SOURCE[row.s].label}
                        </span>
                      </td>
                      <td className="py-2 text-[12px] text-[#7a83a8]"><code className="text-[12px]">{row.how}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 rounded-lg bg-[#ecfdf3] px-4 py-3 text-[12px] text-[#1a7a4a]">
                <b>Total / Unique Ads match Crawler Insight exactly</b> — same query as{" "}
                <code>/network-name/get-count</code>: <b>Total</b> = <code>COUNT(id) WHERE last_seen</code> in window,{" "}
                <b>Unique</b> = <code>WHERE first_seen</code> in window (from each <code>&lt;net&gt;_ad</code> table).
                With a platform filter it switches to the platform count (by <code>created</code> date +{" "}
                <code>platform IN(...)</code>).
                <br />
                <b>Per-system Ads on each card</b> is different — per-system activity in the window (the ad table
                cannot attribute ads to a single system), so per-system numbers will not add up to the network total.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== Debug / data-lineage modal ===== */}
      {debugOpen && debugSys && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 transition-all duration-300"
          onClick={() => setDebugOpen(false)}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-[20px] border border-white/20 bg-[#0f1424] text-[#d7def5] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-white/10 px-6 py-4">
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-[18px] font-[700] text-white">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
                  Live trace · {debugSys.system_id}
                </span>
                <span className="text-[12px] text-[#8b95bf]">
                  Where & how each value was fetched — step by step (raw queries hidden)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowRawQ((v) => !v)}
                  className="rounded-md border border-white/15 px-2 py-1 text-[12px] text-[#b9c2e6] hover:bg-white/10"
                >
                  {showRawQ ? "Hide" : "Show"} raw queries
                </button>
                <button onClick={() => setDebugOpen(false)} className="text-[#8b95bf] hover:text-white">
                  <svg className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto px-6 py-4 font-mono text-[13px]">
              {loadingSystemDebug && !systemDebug?.steps ? (
                <div className="flex items-center gap-2 text-[#8b95bf]">
                  <span className="inline-block h-2 w-2 animate-ping rounded-full bg-green-500" /> running queries…
                </div>
              ) : systemDebug?.error ? (
                <div className="text-red-400">Trace failed: {String(systemDebug.error)}</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {(systemDebug?.steps || []).slice(0, debugReveal).map((st) => {
                    const sc = st.source === "prom" ? "prom" : st.source === "db" ? "db" : "both";
                    const statusColor =
                      st.status === "ok" ? "text-green-400" :
                      st.status === "warn" ? "text-yellow-400" :
                      st.status === "error" ? "text-red-400" : "text-[#8b95bf]";
                    return (
                      <div key={st.n} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                        <div className="flex items-start gap-2">
                          <span className={`mt-0.5 ${statusColor}`}>
                            {st.status === "ok" ? "✓" : st.status === "warn" ? "!" : st.status === "error" ? "✕" : "›"}
                          </span>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-white">{st.title}</span>
                              <SourceDot s={sc} />
                              <span className="text-[10px] text-[#5f6a93]">+{st.at_ms}ms</span>
                            </div>
                            {st.detail && <div className="mt-0.5 text-[12px] text-[#b9c2e6]">{st.detail}</div>}
                            {showRawQ && st.query && (
                              <code className="mt-1 block whitespace-pre-wrap break-all rounded bg-black/40 px-2 py-1 text-[11px] text-[#7fd1b9]">
                                {st.query}
                              </code>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {debugReveal < (systemDebug?.steps?.length || 0) && (
                    <div className="flex items-center gap-2 pl-1 text-[#8b95bf]">
                      <span className="inline-block h-2 w-2 animate-ping rounded-full bg-green-500" /> …
                    </div>
                  )}
                  {systemDebug?.steps && debugReveal >= systemDebug.steps.length && (
                    <div className="mt-1 border-t border-white/10 pt-2 text-[12px] text-[#8b95bf]">
                      Done in {systemDebug.total_ms}ms · found in: {systemDebug.networks_found?.join(", ") || "—"}
                      {systemDebug.hosts?.length ? ` · hostname: ${systemDebug.hosts.join(", ")}` : " · no hostname"}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <Tooltip
        id="dash-tip"
        place="top"
        effect="solid"
        className="z-50 !rounded-[20px] !bg-[#d2dfff] !text-[13px] !text-[#1f296a]"
        delayShow={300}
      />
    </div>
  );
};

export default CrawlerDashboard;
