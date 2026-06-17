import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import axios from "axios";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { CiSearch } from "react-icons/ci";
import { FiRefreshCw, FiDownload, FiTrendingUp, FiTrendingDown, FiExternalLink, FiChevronDown } from "react-icons/fi";
import { HiOutlineSquares2X2 } from "react-icons/hi2";
import Chart from "react-apexcharts";
import Loader from "./Loader";

/**
 * Competitor Tracker — master/detail view over the monitored competitor set.
 *
 * Left: the full user list from /get-all-users (searchable + paginated client
 * side). Right: when nothing is selected we show the program-wide totals from
 * /get-comp-users-count; when a user is picked we POST their id to
 * /user-brand-stats and render the returned brands, competitors, monitoring
 * quota, today's ad counts and per-competitor growth. All three endpoints live
 * on the competitor-analysis service (VITE_COMPETITOR_ANALYSIS_API).
 *
 * Plan tier / plan quota-limit, email-delivery status and "flagged" are not
 * returned by the backend, so they are omitted rather than faked.
 */

const COMP_API =
  import.meta.env.VITE_COMPETITOR_ANALYSIS_API || import.meta.env.VITE_COMPETITORS_API;

const USERS_PER_PAGE = 14;

const SORTS = [
  { key: "recent", label: "Recently active" },
  { key: "newest", label: "Newest first" },
  { key: "comps", label: "Most competitors" },
  { key: "az", label: "Email A–Z" },
  { key: "za", label: "Email Z–A" },
];

const fmtNum = (n) => (Number(n) || 0).toLocaleString("en-US");

// Compact "time since last brand/competitor activity" for the user rows.
const relativeTime = (iso) => {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!then) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (d < 30) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
};

const brandNameOf = (brands) =>
  Array.isArray(brands) ? brands.filter(Boolean).join(", ") : brands;

const initials = (label) => {
  if (!label) return "?";
  const name = label.split("@")[0] || label;
  const parts = name.split(/[.\-_\s]/).filter(Boolean);
  const a = parts[0]?.[0] || name[0] || "?";
  const b = parts[1]?.[0] || "";
  return (a + b).toUpperCase();
};

// Rounded progress bar (monitoring quota + per-competitor ads).
function Bar({ value, max, gradient = "linear-gradient(90deg,#3F51B5,#673AB7)", height = "h-2" }) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : value ? 100 : 0);
  return (
    <div className={`${height} w-full bg-gray-100 rounded-full overflow-hidden`}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.max(pct, value ? 6 : 0)}%`, background: value ? gradient : "#e5e7eb" }}
      />
    </div>
  );
}

// Coloured +/-% growth chip with a trend arrow.
function Growth({ pct }) {
  const v = Number(pct) || 0;
  const up = v >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${up ? "text-green-600 bg-green-50" : "text-rose-500 bg-rose-50"}`}>
      {up ? <FiTrendingUp className="w-3 h-3" /> : <FiTrendingDown className="w-3 h-3" />}
      {up ? "+" : ""}{v}%
    </span>
  );
}

// Per-platform scraping-dispatch state for a competitor. status 0 = not sent to
// the scraping plugin today; 1|2 = sent. The plugin resets these to 0 daily, so
// a lit chip reflects today's run only.
function ScrapeChip({ label, name, status }) {
  const on = (Number(status) || 0) > 0;
  const who = name || label;
  return (
    <span
      title={on ? `${who}: sent to the scraping plugin today` : `${who}: not sent to the scraping plugin yet today`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold leading-none ${
        on ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-400"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${on ? "bg-green-500" : "bg-gray-300"}`} />
      {label}
    </span>
  );
}

// Date presets for the per-brand ads chart (custom range available too).
const RANGE_PRESETS = [
  { key: "7d", label: "7d", days: 7 },
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
];
const CHART_TOP_N = 15; // cap bars so dense brands stay readable

// Local YYYY-MM-DD (avoids UTC off-by-one from toISOString()).
const isoDay = (d) => {
  const z = new Date(d);
  z.setMinutes(z.getMinutes() - z.getTimezoneOffset());
  return z.toISOString().slice(0, 10);
};

// {from,to} (YYYY-MM-DD) for a "last N days" preset — N days back through today,
// inclusive. Fills the date inputs so the active preset is reflected there.
const presetDates = (days) => {
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  return { from: isoDay(start), to: isoDay(new Date()) };
};

/**
 * Per-brand "ads by competitor" bar chart with a date filter. Fetches
 * /competitor-ads-by-range for the brand's request_id on mount and whenever the
 * range changes; results are cached per range so toggling presets is instant.
 */
function BrandAdsChart({ requestId }) {
  const [preset, setPreset] = useState("30d");
  const [from, setFrom] = useState(() => presetDates(30).from); // mirror default preset
  const [to, setTo] = useState(() => presetDates(30).to);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const cacheRef = useRef({}); // "from|to" -> competitors[]
  const today = isoDay(new Date()); // upper bound — no future dates allowed

  // Resolve the active window. "all" = all-time (no dates); custom needs both
  // ends before it fetches (and neither may be in the future).
  const range = useMemo(() => {
    if (preset === "all") return { all: true };
    if (preset === "custom") {
      if (!from || !to || from > to || from > today || to > today) return null;
      return { from, to };
    }
    const days = RANGE_PRESETS.find((p) => p.key === preset)?.days || 30;
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    return { from: isoDay(start), to: isoDay(new Date()) };
  }, [preset, from, to, today]);

  useEffect(() => {
    if (!range) return;
    const key = range.all ? "all" : `${range.from}|${range.to}`;
    if (cacheRef.current[key]) { setData(cacheRef.current[key]); setError(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await axios.post(`${COMP_API}competitor-ads-by-range`, {
          request_id: requestId,
          ...(range.all ? { all: true } : { from: range.from, to: range.to }),
        });
        const comps = res?.data?.body?.data?.competitors || [];
        if (cancelled) return;
        cacheRef.current[key] = comps;
        setData(comps);
      } catch {
        if (!cancelled) { setError(true); setData([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [range, requestId]);

  const top = useMemo(
    () => (data || []).filter((c) => (Number(c.ads) || 0) > 0).slice(0, CHART_TOP_N),
    [data]
  );
  const totalWithAds = useMemo(() => (data || []).filter((c) => (Number(c.ads) || 0) > 0).length, [data]);

  const chart = useMemo(() => {
    // Bars are scaled against the largest competitor, so low-count ones would
    // otherwise render as an invisible hairline. Floor each bar to a small
    // fraction of the longest one so every competitor stays noticeable. Only the
    // bar *length* is floored — the data label and tooltip still read the real
    // ad count back from `top` by data-point index, so the numbers stay honest.
    const maxAds = Math.max(...top.map((c) => Number(c.ads) || 0), 1);
    const MIN_BAR = maxAds * 0.06; // shortest bar ≈ 6% of the longest
    const realAds = (i) => Number(top[i]?.ads) || 0;
    return {
      options: {
        chart: { type: "bar", toolbar: { show: false }, fontFamily: "inherit", animations: { speed: 400 } },
        plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: "62%" } },
        colors: ["#3F51B5"],
        dataLabels: {
          enabled: true,
          style: { fontSize: "11px", fontWeight: 600, colors: ["#fff"] },
          offsetX: 0,
          formatter: (_v, opts) => fmtNum(realAds(opts?.dataPointIndex)),
        },
        grid: { borderColor: "#eef1f6", strokeDashArray: 3 },
        xaxis: { categories: top.map((c) => c.name), labels: { style: { colors: "#9ca3af", fontSize: "11px" } } },
        yaxis: { labels: { style: { colors: "#374151", fontSize: "12px" }, maxWidth: 170 } },
        tooltip: {
          y: {
            formatter: (_v, opts) => {
              const c = top[opts?.dataPointIndex] || {};
              return `${fmtNum(c.ads)} ads  (FB ${fmtNum(c.facebook)} · IG ${fmtNum(c.instagram)} · GG ${fmtNum(c.google)})`;
            },
          },
        },
      },
      series: [{ name: "Ads", data: top.map((c) => Math.max(Number(c.ads) || 0, MIN_BAR)) }],
    };
  }, [top]);

  const presetBtn = (active) =>
    `px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors ${
      active ? "bg-[#eef1fb] text-[#3F51B5] border-[#c7d2fe]" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
    }`;

  return (
    <div className="px-4 py-3 border-b border-gray-100 bg-[#fcfcfe]">
      {/* date filter */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-[11px] font-semibold tracking-wider text-gray-400 mr-1">ADS BY COMPETITOR</span>
        <div className="flex items-center gap-1">
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => { setPreset(p.key); const d = presetDates(p.days); setFrom(d.from); setTo(d.to); }}
              className={presetBtn(preset === p.key)}
            >
              {p.label}
            </button>
          ))}
          {/* All-time */}
          <button
            type="button"
            onClick={() => { setPreset("all"); setFrom(""); setTo(""); }}
            className={presetBtn(preset === "all")}
          >
            All
          </button>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <input
            type="date"
            value={from}
            max={to || today}
            onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* not supported */ } }}
            onChange={(e) => { if (e.target.value <= today) { setFrom(e.target.value); setPreset("custom"); } }}
            className="h-8 w-[140px] px-2.5 text-[12px] border border-gray-200 rounded-md text-gray-600 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#1540a4] hover:border-gray-300"
          />
          <span className="text-gray-300 text-[12px]">–</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            max={today}
            onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* not supported */ } }}
            onChange={(e) => { if (e.target.value <= today) { setTo(e.target.value); setPreset("custom"); } }}
            className="h-8 w-[140px] px-2.5 text-[12px] border border-gray-200 rounded-md text-gray-600 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#1540a4] hover:border-gray-300"
          />
          <button
            type="button"
            onClick={() => { setPreset("30d"); const d = presetDates(30); setFrom(d.from); setTo(d.to); }}
            disabled={preset !== "custom"}
            className="h-8 px-2.5 inline-flex items-center justify-center leading-none text-[11px] font-semibold rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-rose-500 hover:border-rose-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-500 disabled:hover:border-gray-200 transition-colors"
            title="Clear the custom date range"
          >
            Clear
          </button>
        </div>
      </div>

      {/* chart body */}
      {preset === "custom" && !range ? (
        <p className="text-[12px] text-gray-400 py-6 text-center">Pick a valid start and end date.</p>
      ) : loading ? (
        <div className="h-[160px] flex items-center justify-center"><Loader /></div>
      ) : error ? (
        <p className="text-[12px] text-rose-500 py-6 text-center">Couldn’t load ad counts for the selected period.</p>
      ) : top.length === 0 ? (
        <p className="text-[12px] text-gray-400 py-6 text-center">
          No ads for any competitor {preset === "all" ? "for this brand" : "in the selected period"}.
        </p>
      ) : (
        <>
          <Chart options={chart.options} series={chart.series} type="bar" height={Math.max(170, top.length * 34)} />
          {totalWithAds > CHART_TOP_N && (
            <p className="text-[10.5px] text-gray-400 text-right -mt-1">Showing top {CHART_TOP_N} of {totalWithAds} competitors with ads</p>
          )}
        </>
      )}
    </div>
  );
}

const CompetitorTracker = () => {
  const location = useLocation();
  const [allUsers, setAllUsers] = useState([]); // [{id,name,email}]
  const [summary, setSummary] = useState(null); // program-wide totals
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [chip, setChip] = useState("all"); // all | active | inactive
  const [sort, setSort] = useState("recent"); // default: latest brand/competitor activity first

  const [selected, setSelected] = useState(null); // {id,name,email}
  const [stats, setStats] = useState(null); // /user-brand-stats payload (selected)
  const [detailLoading, setDetailLoading] = useState(false);
  const [brandSearch, setBrandSearch] = useState(""); // filters the detail brands/competitors
  const [expandedBrands, setExpandedBrands] = useState(() => new Set()); // brand keys currently expanded (default: all collapsed)
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false); // export-options dropdown
  const [exportCharts, setExportCharts] = useState(false); // include ad-count charts in the PDF
  const [exportRange, setExportRange] = useState("30d"); // chart window: 1d | 7d | 30d | all
  const exportMenuRef = useRef(null); // export dropdown (for click-outside close)

  // Per-user /user-brand-stats cache for the detail panel — populated only when
  // a user is actually selected, so re-selecting them is instant. The list rows
  // never trigger this; their brands/comps come from /get-all-users.
  const [cache, setCache] = useState({}); // id -> payload | { error: true }
  const cacheRef = useRef(cache);
  useEffect(() => { cacheRef.current = cache; }, [cache]);

  // ── Initial load: full user list + program-wide counts ──
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const [u, c] = await Promise.all([
        axios.get(`${COMP_API}get-all-users`),
        axios.get(`${COMP_API}get-comp-users-count`),
      ]);
      setAllUsers(u?.data?.body?.data?.users || []);
      setSummary(c?.data?.body?.data || null);
    } catch (e) {
      toast.error("Failed to load competitor tracker");
      setAllUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // StrictMode double-mounts effects in dev, which would fire the initial load
  // twice; this ref makes the mount fetch run only once. The Refresh button
  // calls fetchUsers() directly and is unaffected.
  const didInitialFetch = useRef(false);
  useEffect(() => {
    if (didInitialFetch.current) return;
    didInitialFetch.current = true;
    fetchUsers();
  }, [fetchUsers]);

  // Row badge — derived entirely from the /get-all-users payload, no call.
  const rowStat = useCallback((u) => {
    if (!u) return null;
    return {
      brands: Number(u.totalBrands) || 0,
      comps: Number(u.totalCompetitors) || 0,
    };
  }, []);

  // ── Search + sort over the full list (all call-free, list-data only) ──
  // Active mirrors the backend's get-comp-users-count definition: a user is
  // "active" when they have at least one monitored brand/competitor (i.e. a
  // competitors_request), which on the list payload means either count > 0.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = allUsers.filter((u) => {
      if (q && !((u.email || "").toLowerCase().includes(q) || (u.name || "").toLowerCase().includes(q)))
        return false;
      if (chip === "active" || chip === "inactive") {
        const active = (Number(u.totalBrands) || 0) > 0 || (Number(u.totalCompetitors) || 0) > 0;
        if (chip === "active" && !active) return false;
        if (chip === "inactive" && active) return false;
      }
      return true;
    });
    if (sort === "az" || sort === "za") {
      list = [...list].sort((a, b) => (a.email || a.name || "").localeCompare(b.email || b.name || ""));
      if (sort === "za") list.reverse();
    } else if (sort === "comps") {
      list = [...list].sort((a, b) => (Number(b.totalCompetitors) || 0) - (Number(a.totalCompetitors) || 0));
    } else if (sort === "recent") {
      // Latest brand/competitor activity first; users with no activity sink down.
      const t = (u) => (u.lastActivity ? new Date(u.lastActivity).getTime() || 0 : 0);
      list = [...list].sort((a, b) => t(b) - t(a));
    }
    return list;
  }, [allUsers, search, sort, chip]);

  useEffect(() => { setPage(1); }, [search, chip, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / USERS_PER_PAGE));
  const pageUsers = useMemo(
    () => filtered.slice((page - 1) * USERS_PER_PAGE, page * USERS_PER_PAGE),
    [filtered, page]
  );

  // Busiest user's competitor count — scales each row's relative-volume bar.
  const maxComps = useMemo(
    () => allUsers.reduce((m, u) => Math.max(m, Number(u.totalCompetitors) || 0), 0),
    [allUsers]
  );

  // Active/inactive split for the filter-chip badges (ignores the search box so
  // the totals stay stable; the same active rule is applied in `filtered`).
  const statusCounts = useMemo(() => {
    const active = allUsers.reduce(
      (n, u) => n + ((Number(u.totalBrands) || 0) > 0 || (Number(u.totalCompetitors) || 0) > 0 ? 1 : 0),
      0
    );
    return { all: allUsers.length, active, inactive: allUsers.length - active };
  }, [allUsers]);

  // ── On select: reuse cache if present, else POST /user-brand-stats ──
  const selectUser = useCallback(async (user) => {
    setSelected(user);
    setBrandSearch("");
    setExpandedBrands(new Set()); // collapse all for the newly selected user
    const cached = cacheRef.current[user.id];
    if (cached && !cached.error) { setStats(cached); setDetailLoading(false); return; }
    setStats(null);
    setDetailLoading(true);
    try {
      const res = await axios.post(`${COMP_API}user-brand-stats`, { user_id: user.id });
      const data = res?.data?.body?.data || { totalBrands: 0, totalCompetitors: 0, brands: [] };
      setStats(data);
      setCache((prev) => ({ ...prev, [user.id]: data }));
    } catch (e) {
      toast.error("Failed to load user details");
      setStats({ totalBrands: 0, totalCompetitors: 0, brands: [] });
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Clicking the sidebar "Competitor Tracker" link navigates here with a fresh
  // resetTracker timestamp — that deselects the current user and drops back to
  // the Overview, the same state the page loads in (works even when we're
  // already on the page, where a plain link click would otherwise do nothing).
  useEffect(() => {
    if (location.state?.resetTracker) {
      setSelected(null);
      setStats(null);
    }
  }, [location.state?.resetTracker]);

  // Close the export-options dropdown on any outside click.
  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) setExportOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [exportOpen]);

  // adsToday is a platform-split object the backend already totals; we only
  // sum the per-brand monitoring slots here.
  const monitoring = useMemo(
    () => (stats?.brands || []).reduce((n, b) => n + (Number(b.monitoringCount) || 0), 0),
    [stats]
  );
  const adsToday = stats?.adsToday || { facebook: 0, instagram: 0, total: 0 };

  // Stable per-brand key for the expand/collapse set.
  const brandKey = useCallback((b, i) => b.request_id || `idx-${i}`, []);

  const toggleBrand = useCallback((key) => {
    setExpandedBrands((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Filter brands + their competitors by the detail search box. A brand-name
  // match keeps all its competitors; otherwise only competitors whose name/url
  // match are kept (and brands with no surviving match drop out entirely).
  const visibleBrands = useMemo(() => {
    const list = stats?.brands || [];
    const q = brandSearch.trim().toLowerCase();
    if (!q) return list.map((b, i) => ({ brand: b, competitors: b.competitors || [], i }));
    return list.reduce((acc, b, i) => {
      const name = (brandNameOf(b.brands) || b.project_name || "").toLowerCase();
      const comps = b.competitors || [];
      const brandMatch = name.includes(q);
      const competitors = brandMatch
        ? comps
        : comps.filter((c) => (c.name || "").toLowerCase().includes(q) || (c.url || "").toLowerCase().includes(q));
      if (brandMatch || competitors.length) acc.push({ brand: b, competitors, i });
      return acc;
    }, []);
  }, [stats, brandSearch]);

  // While a search is active every matching brand is forced open so results are
  // visible without manual expanding; otherwise honour the per-brand toggle.
  const searching = brandSearch.trim().length > 0;

  // Build a clean, native PDF straight from the loaded `stats` — selectable text
  // + vector tables, no DOM rasterisation, so it exports near-instantly. Charts
  // are opt-in: when enabled we fetch ad counts for the chosen window per brand
  // and draw them as lightweight vector bars (still no screenshotting).
  const RANGE_LABELS = { "1d": "Today", "7d": "Last 7 days", "30d": "Last 30 days", all: "All time" };
  const exportPdf = async ({ charts = false, range = "30d" } = {}) => {
    if (!selected || !stats || exporting) return;
    setExporting(true);
    try {
      const [{ jsPDF }, autoTableMod] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const autoTable = autoTableMod.default;

      const brands = stats.brands || [];
      const rangeLabel = RANGE_LABELS[range] || RANGE_LABELS["30d"];

      // ── Optionally fetch one ad-count window per brand, all in parallel ──
      const chartByBrand = {};
      if (charts) {
        const reqRange =
          range === "all"
            ? { all: true }
            : (() => {
                const days = { "1d": 1, "7d": 7, "30d": 30 }[range] || 30;
                const start = new Date();
                start.setDate(start.getDate() - (days - 1));
                return { from: isoDay(start), to: isoDay(new Date()) };
              })();
        const withReq = brands.filter((b) => b.request_id && b.competitorsCount > 0);
        const results = await Promise.all(
          withReq.map((b) =>
            axios
              .post(`${COMP_API}competitor-ads-by-range`, { request_id: b.request_id, ...reqRange })
              .then((r) => ({ id: b.request_id, comps: r?.data?.body?.data?.competitors || [] }))
              .catch(() => ({ id: b.request_id, comps: [] }))
          )
        );
        results.forEach((r) => { chartByBrand[r.id] = r.comps; });
      }

      // ── PDF scaffold ──
      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const MARGIN = 40;
      const HEADER_H = 58;
      const FOOTER_H = 26;
      const contentW = pageW - MARGIN * 2;
      const topY = HEADER_H + 12; // first content line on every page
      const bottomLimit = pageH - FOOTER_H - 8;
      const tableMargin = { top: topY, left: MARGIN, right: MARGIN, bottom: FOOTER_H + 8 };

      const who = selected.email || selected.name || "user";
      const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

      let cursorY = topY;
      const ensure = (h) => { if (cursorY + h > bottomLimit) { pdf.addPage(); cursorY = topY; } };

      // ── Summary row ──
      const monitoringTotal = brands.reduce((n, b) => n + (Number(b.monitoringCount) || 0), 0);
      const compTotal = stats.totalCompetitors || 0;
      const ads = stats.adsToday || { facebook: 0, instagram: 0, google: 0, total: 0 };
      autoTable(pdf, {
        startY: topY,
        margin: tableMargin,
        theme: "plain",
        styles: { fontSize: 9, cellPadding: { top: 6, bottom: 6, left: 8, right: 8 } },
        head: [["Brands", "Competitors", "Monitoring", "Ads today"]],
        body: [[
          fmtNum(stats.totalBrands),
          fmtNum(compTotal),
          `${fmtNum(monitoringTotal)}/${fmtNum(compTotal)}`,
          `${fmtNum(ads.total)}  (FB ${fmtNum(ads.facebook)} · IG ${fmtNum(ads.instagram)} · G ${fmtNum(ads.google)})`,
        ]],
        headStyles: { fillColor: [238, 241, 251], textColor: [63, 81, 181], fontStyle: "bold", halign: "left" },
        bodyStyles: { textColor: [31, 41, 106], fontStyle: "bold", fontSize: 12 },
      });
      cursorY = pdf.lastAutoTable.finalY + 18;

      // Lightweight vector bar chart for one brand's top competitors.
      const CHART_TOP_N = 8;
      const drawChart = (comps) => {
        const rows = (comps || [])
          .map((c) => ({ name: c.name || "—", ads: Number(c.ads) || 0 }))
          .filter((c) => c.ads > 0)
          .sort((a, b) => b.ads - a.ads)
          .slice(0, CHART_TOP_N);
        if (!rows.length) return;
        const labelW = 130;
        const valW = 44;
        const barAreaW = contentW - labelW - valW;
        const rowH = 15;
        ensure(12 + rows.length * rowH + 8);
        pdf.setFontSize(8);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(150, 150, 150);
        pdf.text(`Ads by competitor · ${rangeLabel}`, MARGIN, cursorY);
        cursorY += 10;
        const maxAds = Math.max(...rows.map((c) => c.ads), 1);
        rows.forEach((c) => {
          let label = c.name;
          pdf.setFontSize(8);
          pdf.setTextColor(75, 85, 99);
          while (pdf.getTextWidth(label) > labelW - 8 && label.length > 1) label = label.slice(0, -1);
          if (label.length < c.name.length) label = label.slice(0, -1) + "…";
          pdf.text(label, MARGIN, cursorY + 7);
          pdf.setFillColor(238, 241, 251);
          pdf.roundedRect(MARGIN + labelW, cursorY + 1, barAreaW, 8, 2, 2, "F");
          pdf.setFillColor(63, 81, 181);
          pdf.roundedRect(MARGIN + labelW, cursorY + 1, Math.max((c.ads / maxAds) * barAreaW, 3), 8, 2, 2, "F");
          pdf.setTextColor(55, 65, 81);
          pdf.text(fmtNum(c.ads), pageW - MARGIN, cursorY + 7, { align: "right" });
          cursorY += rowH;
        });
        cursorY += 8;
      };

      // ── Per-brand: heading → optional chart → competitor table ──
      brands.forEach((b) => {
        const brandName = brandNameOf(b.brands) || b.project_name || "Untitled brand";
        const comps = b.competitors || [];

        ensure(26);
        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(31, 41, 106);
        pdf.text(brandName, MARGIN, cursorY + 6);
        pdf.setFontSize(8.5);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(120, 120, 120);
        pdf.text(`${b.competitorsCount} competitor${b.competitorsCount === 1 ? "" : "s"}`, pageW - MARGIN, cursorY + 6, { align: "right" });
        cursorY += 22;

        if (charts) drawChart(chartByBrand[b.request_id]);

        if (!comps.length) {
          ensure(20);
          pdf.setFontSize(9);
          pdf.setFont("helvetica", "normal");
          pdf.setTextColor(150, 150, 150);
          pdf.text("No competitors", MARGIN, cursorY + 6);
          cursorY += 24;
          return;
        }

        autoTable(pdf, {
          startY: cursorY,
          margin: tableMargin,
          theme: "striped",
          styles: { fontSize: 8.5, cellPadding: 5, overflow: "ellipsize", valign: "middle", minCellHeight: 18 },
          headStyles: { fillColor: [244, 246, 252], textColor: [107, 114, 128], fontStyle: "bold", fontSize: 8 },
          alternateRowStyles: { fillColor: [250, 251, 255] },
          // Widths only; alignment is set in didParseCell so headers match their
          // body cells (column 1 "Scraping" is custom-drawn in didDrawCell).
          columnStyles: {
            0: { cellWidth: 165 },
            1: { cellWidth: 86, halign: "center" },
            2: { cellWidth: 48 },
            3: { cellWidth: 44 },
            4: { cellWidth: 58 },
            5: { cellWidth: 46 },
            6: { cellWidth: 44 },
          },
          head: [["Competitor", "Scraping", "Total", "Today", "Yesterday", "7 Days", "Growth"]],
          body: comps.map((c) => [
            c.url ? `${c.name || "—"}\n${c.url.replace(/^https?:\/\//, "")}` : c.name || "—",
            "", // Scraping — drawn as chips in didDrawCell
            fmtNum(c.ads),
            fmtNum(c.today),
            fmtNum(c.yesterday),
            fmtNum(c.last7Days),
            `${Number(c.growth) >= 0 ? "+" : ""}${Number(c.growth) || 0}%`,
          ]),
          didParseCell: (d) => {
            // Right-align every numeric column (header + body) so they line up.
            if (d.column.index >= 2) d.cell.styles.halign = "right";
            if (d.column.index === 1) d.cell.styles.halign = "center";
            if (d.section === "body" && d.column.index === 6) {
              d.cell.styles.textColor = (Number(comps[d.row.index]?.growth) || 0) >= 0 ? [22, 163, 74] : [225, 29, 72];
              d.cell.styles.fontStyle = "bold";
            }
          },
          didDrawCell: (d) => {
            // Render the per-platform scraping chips (FB/IG/YT/GG) for column 1.
            if (d.section !== "body" || d.column.index !== 1) return;
            const c = comps[d.row.index];
            if (!c) return;
            const chips = [
              ["FB", c.facebookStatus],
              ["IG", c.instagramStatus],
              ["YT", c.youtubeStatus],
              ["GG", c.googleStatus],
            ];
            const chipW = 17;
            const chipH = 9;
            const gap = 1.5;
            const totalW = chips.length * chipW + (chips.length - 1) * gap;
            let x = d.cell.x + (d.cell.width - totalW) / 2;
            const y = d.cell.y + (d.cell.height - chipH) / 2;
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(6);
            chips.forEach(([label, status]) => {
              const on = (Number(status) || 0) > 0;
              const [fr, fg, fb] = on ? [220, 252, 231] : [243, 244, 246];
              const [tr, tg, tb] = on ? [22, 163, 74] : [156, 163, 175];
              pdf.setFillColor(fr, fg, fb);
              pdf.roundedRect(x, y, chipW, chipH, 1.5, 1.5, "F");
              pdf.setTextColor(tr, tg, tb);
              pdf.text(label, x + chipW / 2, y + chipH / 2, { align: "center", baseline: "middle" });
              x += chipW + gap;
            });
          },
        });
        cursorY = pdf.lastAutoTable.finalY + 18;
      });

      // ── Header + footer on every page (drawn last, when the count is final) ──
      const pageCount = pdf.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        pdf.setPage(i);
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, pageW, HEADER_H, "F");
        pdf.setDrawColor(229, 231, 235);
        pdf.line(0, HEADER_H, pageW, HEADER_H);
        pdf.setFontSize(14);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(31, 41, 106);
        pdf.text("Competitor Tracker", MARGIN, 26);
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(107, 114, 128);
        pdf.text(`${who}${stats.planName ? `  ·  ${stats.planName} plan` : ""}  ·  ${dateStr}`, MARGIN, 44);
        pdf.setFontSize(8);
        pdf.setTextColor(156, 163, 175);
        pdf.text("PowerAdSpy Admin  ·  Competitor Tracker Export", MARGIN, pageH - 10);
        pdf.text(`Page ${i} of ${pageCount}`, pageW - MARGIN, pageH - 10, { align: "right" });
      }

      const safe = who.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
      pdf.save(`competitor-tracker-${safe}-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error("[Export] failed:", err);
      toast.error(`Export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const totalCompetitors = stats?.totalCompetitors || 0;

  return (
    // Below lg: grow with content so the page (Layout's scroll container) scrolls.
    // lg+: lock to one viewport and scroll the panels internally.
    <div className="bg-[#f7f8fb] rounded-[10px] w-full min-h-[calc(100%-120px)] lg:h-[calc(100%-120px)] overflow-visible lg:overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h3 className="text-[#1f296a] font-bold text-[22px]">Competitor Tracker</h3>
          <p className="text-gray-400 text-[12px]">All users with their monitored brands, competitors & live ad counts</p>
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={() => fetchUsers()} className="p-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50" title="Refresh">
            <FiRefreshCw className={`w-4 h-4 text-gray-600 ${loading ? "animate-spin" : ""}`} />
          </button>
          {selected && (
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setExportOpen((o) => !o)}
                disabled={exporting}
                className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-[13px] text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Export this user's detail as PDF"
              >
                <FiDownload className={`w-4 h-4 ${exporting ? "animate-pulse" : ""}`} />
                {exporting ? "Exporting…" : "Export PDF"}
                {!exporting && <FiChevronDown className={`w-3.5 h-3.5 transition-transform ${exportOpen ? "rotate-180" : ""}`} />}
              </button>

              {exportOpen && !exporting && (
                <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-xl shadow-lg z-30 p-3.5">
                  <p className="text-[11px] font-semibold tracking-wider text-gray-400 mb-2.5">EXPORT OPTIONS</p>

                  {/* include charts toggle */}
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-gray-700 font-medium">Include charts</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={exportCharts}
                      onClick={() => setExportCharts((v) => !v)}
                      className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${exportCharts ? "bg-[#3F51B5]" : "bg-gray-300"}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${exportCharts ? "translate-x-4" : ""}`} />
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">Per-brand “ads by competitor” bars.</p>

                  {/* chart window */}
                  <div className={`mt-3 transition-opacity ${exportCharts ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
                    <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Chart period</p>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { k: "1d", l: "1d" },
                        { k: "7d", l: "7d" },
                        { k: "30d", l: "30d" },
                        { k: "all", l: "All time" },
                      ].map((r) => (
                        <button
                          key={r.k}
                          type="button"
                          onClick={() => setExportRange(r.k)}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors ${
                            exportRange === r.k
                              ? "bg-[#eef1fb] text-[#3F51B5] border-[#c7d2fe]"
                              : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                          }`}
                        >
                          {r.l}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => { setExportOpen(false); exportPdf({ charts: exportCharts, range: exportRange }); }}
                    className="mt-3.5 w-full py-2 rounded-lg bg-[#3F51B5] text-white text-[13px] font-semibold hover:bg-[#36469c] transition-colors"
                  >
                    Export PDF
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Body: master / detail — stacks vertically below lg, side-by-side at lg+ */}
      <div className="flex-1 min-h-0 px-6 pb-6 flex flex-col lg:flex-row gap-4">
        {/* ── Left: user list ── */}
        <div className="w-full lg:w-[340px] flex-shrink-0 max-h-[55vh] lg:max-h-none bg-white rounded-xl border border-gray-100 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-gray-100">
            <div className="relative">
              <CiSearch className="h-5 w-5 text-gray-400 absolute left-2.5 top-2.5" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by email or name…"
                className="pl-9 pr-3 h-10 w-full text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#1540a4]"
              />
            </div>

            {/* filter chips: All / Active (has monitored brands/comps) / Inactive */}
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {[
                { key: "all", label: "All", count: statusCounts.all },
                { key: "active", label: "Active", count: statusCounts.active },
                { key: "inactive", label: "Inactive", count: statusCounts.inactive },
              ].map((c) => (
                <button
                  key={c.key}
                  onClick={() => setChip(c.key)}
                  className={`px-3 py-1 rounded-full text-[12px] font-semibold border transition-colors whitespace-nowrap ${
                    chip === c.key
                      ? "bg-[#eef1fb] text-[#3F51B5] border-[#c7d2fe]"
                      : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {c.label} <span className={chip === c.key ? "text-[#3F51B5]/70" : "text-gray-400"}>{c.count}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between px-3 py-2 text-[12px] text-gray-400 border-b border-gray-50">
            <span>{loading ? "Loading…" : `${fmtNum(filtered.length)} users`}</span>
            <label className="flex items-center gap-1">
              <span>Sort:</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="bg-transparent text-gray-600 font-medium focus:outline-none cursor-pointer"
              >
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex-1 overflow-auto">
            {loading ? (
              <Loader />
            ) : pageUsers.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-10">No users found</p>
            ) : (
              pageUsers.map((u) => {
                const active = selected && u.id === selected.id;
                const rs = rowStat(u); // brands/comps straight from /get-all-users
                // dot: green = tracking competitors, grey = none
                const dot = rs.comps > 0 ? "#22c55e" : "#d1d5db";
                const rel = relativeTime(u.lastActivity); // last brand/competitor activity
                const lastTitle = u.lastActivity
                  ? `Last brand/competitor activity: ${new Date(u.lastActivity).toLocaleString()}`
                  : "No brand/competitor activity yet";
                return (
                  <button
                    key={u.id}
                    onClick={() => selectUser(u)}
                    className={`w-full text-left flex items-center gap-3 pr-3 py-2.5 border-b border-gray-50 border-l-[3px] transition-colors ${active ? "bg-[#eef1fb] border-l-[#3F51B5] pl-[9px]" : "border-l-transparent pl-3 hover:bg-gray-50"}`}
                  >
                    <span className={`w-9 h-9 flex-shrink-0 rounded-full text-[12px] font-bold flex items-center justify-center ${active ? "bg-[linear-gradient(135deg,#3F51B5,#673AB7)] text-white" : "bg-[#eef1fb] text-[#3f51b5]"}`}>
                      {initials(u.email || u.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-gray-800 truncate">{u.email || u.name || "—"}</span>
                      <span className="block text-[11px] text-gray-400 truncate">
                        {`${rs.brands} brand${rs.brands === 1 ? "" : "s"} · ${rs.comps} comp${rs.comps === 1 ? "" : "s"}`}
                      </span>
                    </span>
                    {/* last-activity time + competitor-volume bar (relative to the busiest user) */}
                    <span className="flex flex-col items-end gap-1 w-16 flex-shrink-0" title={lastTitle}>
                      <span className="text-[10px] leading-none text-gray-400 whitespace-nowrap">{rel || "—"}</span>
                      <Bar
                        value={rs.comps}
                        max={maxComps || 1}
                        height="h-1.5"
                      />
                    </span>
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dot }} title={rs.comps > 0 ? "tracking competitors" : "no competitors"} />
                  </button>
                );
              })
            )}
          </div>

          {/* pagination */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 text-[12px] text-gray-500">
            <span>Page {page} of {totalPages}</span>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50">‹</button>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50">›</button>
            </div>
          </div>
        </div>

        {/* ── Right: detail (user) or overview (no selection) ── */}
        {/* @container: inner grids size to THIS panel's width, not the viewport.
            Below lg the panel expands and the page scrolls; at lg+ it scrolls internally. */}
        <div className="@container flex-1 min-w-0 min-h-0 bg-white rounded-xl border border-gray-100 overflow-visible lg:overflow-auto">
          {!selected ? (
            /* ===== Overview from get-comp-users-count ===== */
            <div className="p-6">
              <h4 className="text-[#1f296a] font-bold text-[18px]">Overview</h4>
              <p className="text-gray-400 text-[12px] mb-5">Program-wide competitor monitoring totals. Select a user to drill in.</p>
              {loading || !summary ? (
                <Loader />
              ) : (
                <div className="grid grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-3 gap-4">
                  {[
                    { label: "Total Users", value: summary.totalUsers, accent: "text-[#3F51B5]", ring: "from-[#eef1fb]" },
                    { label: "Active Users", value: summary.activeUsers, accent: "text-[#e04e8e]", ring: "from-pink-50" },
                    { label: "Inactive Users", value: summary.inActiveUsers, accent: "text-[#673AB7]", ring: "from-purple-50" },
                    { label: "Total Brands", value: summary.totalBrands, accent: "text-amber-600", ring: "from-amber-50" },
                    { label: "Total Competitors", value: summary.totalCompetitors, accent: "text-green-600", ring: "from-green-50" },
                  ].map((t) => (
                    <div key={t.label} className={`p-5 rounded-2xl border border-gray-100 bg-gradient-to-b ${t.ring} to-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col justify-between min-h-[112px]`}>
                      <p className="text-gray-500 text-[13px] font-medium">{t.label}</p>
                      <h2 className={`text-[34px] font-extrabold leading-none ${t.accent}`}>{fmtNum(t.value)}</h2>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* ===== Selected user detail (from /user-brand-stats) ===== */
            <div className="p-6">
              {/* user header */}
              <div className="flex items-center gap-3.5 pb-5 border-b border-gray-100">
                <span className="w-12 h-12 rounded-full bg-[linear-gradient(135deg,#3F51B5,#673AB7)] text-white text-[15px] font-bold flex items-center justify-center shadow-sm">
                  {initials(selected.email || selected.name)}
                </span>
                <div className="min-w-0">
                  <p className="text-[#1f296a] font-bold text-[17px] truncate">{selected.email || selected.name || "—"}</p>
                  <div className="flex items-center gap-2 mt-0.5 min-w-0">
                    {stats?.planName && (
                      <span className="px-2 py-0.5 rounded-full bg-[#eef1fb] text-[#3F51B5] font-semibold text-[11px] capitalize flex-shrink-0">
                        {stats.planName} plan
                      </span>
                    )}
                    {selected.name && <span className="text-gray-400 text-[12px] truncate">{selected.name}</span>}
                  </div>
                </div>
              </div>

              {detailLoading ? (
                <Loader />
              ) : (
                <>
                  {/* summary tiles */}
                  <div className="grid grid-cols-2 @lg:grid-cols-4 gap-3.5 mt-5">
                    {[
                      { label: "BRANDS", value: fmtNum(stats?.totalBrands), accent: "text-[#3F51B5]", ring: "from-[#eef1fb] to-white" },
                      { label: "COMPETITORS", value: fmtNum(totalCompetitors), accent: "text-rose-500", ring: "from-rose-50 to-white" },
                      { label: "MONITORING", value: `${fmtNum(monitoring)}/${fmtNum(totalCompetitors)}`, accent: "text-amber-500", ring: "from-amber-50 to-white" },
                      {
                        label: "ADS TODAY", value: fmtNum(adsToday.total), accent: "text-green-600", ring: "from-green-50 to-white",
                        sub: `FB ${fmtNum(adsToday.facebook)} · IG ${fmtNum(adsToday.instagram)} · G ${fmtNum(adsToday.google)}`,
                      },
                    ].map((t) => (
                      <div key={t.label} className={`p-4 rounded-2xl border border-gray-100 bg-gradient-to-b ${t.ring} shadow-[0_1px_2px_rgba(16,24,40,0.04)]`}>
                        <p className={`text-[26px] font-extrabold leading-none ${t.accent}`}>{t.value}</p>
                        <p className="text-[10.5px] font-semibold tracking-wider text-gray-400 mt-2">{t.label}</p>
                        {t.sub && <p className="text-[10px] text-gray-400 mt-0.5 font-medium">{t.sub}</p>}
                      </div>
                    ))}
                  </div>

                  {/* monitoring quota card */}
                  <div className="mt-5 p-4 rounded-2xl border border-gray-100 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                    <div className="flex items-center justify-between mb-2.5">
                      <p className="text-[11px] font-semibold tracking-wider text-gray-400">MONITORING QUOTA</p>
                      <p className="text-[11px] font-medium text-gray-500">
                        {totalCompetitors > 0 ? Math.round((monitoring / totalCompetitors) * 100) : 0}% utilised
                      </p>
                    </div>
                    <Bar value={monitoring} max={totalCompetitors} height="h-2.5" />
                    <div className="flex items-center justify-between mt-2 text-[11.5px] text-gray-400">
                      <span><b className="text-gray-600">{fmtNum(monitoring)}</b> active slots</span>
                      <span><b className="text-gray-600">{fmtNum(totalCompetitors)}</b> competitors tracked</span>
                    </div>
                  </div>

                  {/* brands & competitors */}
                  <div className="flex flex-wrap items-center justify-between gap-2 mt-6 mb-3">
                    <p className="text-[11px] font-semibold tracking-wider text-gray-400">BRANDS &amp; COMPETITORS</p>
                    {stats?.brands?.length > 0 && (
                      <div className="relative w-full sm:w-64">
                        <CiSearch className="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          value={brandSearch}
                          onChange={(e) => setBrandSearch(e.target.value)}
                          placeholder="Search brand or competitor…"
                          className="pl-8 pr-3 h-9 w-full text-[13px] border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#1540a4]"
                        />
                      </div>
                    )}
                  </div>
                  {!stats?.brands || stats.brands.length === 0 ? (
                    <div className="text-center py-10 rounded-2xl border border-dashed border-gray-200 bg-gray-50/50">
                      <p className="text-gray-400 text-sm">No monitored brands for this user yet.</p>
                    </div>
                  ) : visibleBrands.length === 0 ? (
                    <div className="text-center py-10 rounded-2xl border border-dashed border-gray-200 bg-gray-50/50">
                      <p className="text-gray-400 text-sm">No brands or competitors match “{brandSearch.trim()}”.</p>
                    </div>
                  ) : (
                    <div className="space-y-3.5">
                      {visibleBrands.map(({ brand: b, competitors, i }) => {
                        const key = brandKey(b, i);
                        const open = searching || expandedBrands.has(key);
                        return (
                          <div key={key} className="border border-gray-100 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                            <button
                              type="button"
                              onClick={() => toggleBrand(key)}
                              aria-expanded={open}
                              style={{ outline: "none" }} // beats the global button:focus ring in index.css
                              className={`w-full text-left flex items-center justify-between gap-2 px-4 py-3 bg-gradient-to-r from-[#f4f6fc] to-white hover:from-[#eef1fb] transition-colors focus-visible:bg-[#eef1fb] ${open ? "border-b border-gray-100" : ""}`}
                            >
                              <span className="flex items-center gap-2.5 min-w-0">
                                <span className="w-7 h-7 rounded-lg bg-[#eef1fb] text-[#3F51B5] flex items-center justify-center flex-shrink-0">
                                  <HiOutlineSquares2X2 className="w-4 h-4" />
                                </span>
                                <span className="text-[14px] font-bold text-[#1f296a] capitalize truncate">
                                  {brandNameOf(b.brands) || b.project_name || "Untitled brand"}
                                </span>
                              </span>
                              <span className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-[11px] font-medium text-gray-500 bg-white border border-gray-200 rounded-full px-2.5 py-0.5">
                                  {b.competitorsCount} competitor{b.competitorsCount === 1 ? "" : "s"}
                                </span>
                                <FiChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
                              </span>
                            </button>
                            {open && (
                              <>
                                {b.request_id && b.competitorsCount > 0 && (
                                  <BrandAdsChart requestId={b.request_id} />
                                )}
                                {(!competitors || competitors.length === 0) ? (
                                  <p className="px-4 py-4 text-[12px] text-gray-400">No competitors</p>
                                ) : (
                                  <div className="overflow-x-auto">
                                   <div className="min-w-[680px]">
                                    {/* column header for the per-competitor ad metrics */}
                                    <div className="flex items-center gap-3 px-4 py-2 border-t border-gray-100 bg-gray-50/60">
                                      <span className="w-8 flex-shrink-0" aria-hidden="true" />
                                      <span className="flex-1 min-w-0 text-[9.5px] font-semibold uppercase tracking-wider text-gray-400">Competitor</span>
                                      <span className="w-[92px] text-center flex-shrink-0 text-[9.5px] font-semibold uppercase tracking-wider text-gray-400" title="Whether the competitor was sent to the scraping plugin today (resets daily)">Scraping</span>
                                      <span className="w-16 text-right flex-shrink-0 text-[9.5px] font-semibold uppercase tracking-wider text-gray-400">Total</span>
                                      <span className="w-16 text-right flex-shrink-0 text-[9.5px] font-semibold uppercase tracking-wider text-gray-400">Today</span>
                                      <span className="w-16 text-right flex-shrink-0 text-[9.5px] font-semibold uppercase tracking-wider text-gray-400">Yesterday</span>
                                      <span className="w-16 text-right flex-shrink-0 text-[9.5px] font-semibold uppercase tracking-wider text-gray-400">7 Days</span>
                                      <span className="w-14 text-right flex-shrink-0 text-[9.5px] font-semibold uppercase tracking-wider text-gray-400">Growth</span>
                                    </div>
                                    {competitors.map((c, j) => (
                                      <div key={c.id || j} className="flex items-center gap-3 px-4 py-3 border-t border-gray-50 hover:bg-[#fafbff] transition-colors">
                                        <span className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                                          {initials(c.name)}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                          <span className="block text-[13.5px] font-semibold text-gray-800 truncate" title={c.name}>{c.name}</span>
                                          {c.url && (
                                            <a href={c.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                                              className="inline-flex items-center gap-1 text-[11px] text-[#3F51B5] hover:underline truncate max-w-[200px]">
                                              <span className="truncate">{c.url.replace(/^https?:\/\//, "")}</span>
                                              <FiExternalLink className="w-3 h-3 flex-shrink-0" />
                                            </a>
                                          )}
                                        </span>
                                        <span className="w-[92px] flex-shrink-0 flex flex-wrap items-center justify-center gap-1">
                                          <ScrapeChip label="FB" name="Facebook" status={c.facebookStatus} />
                                          <ScrapeChip label="IG" name="Instagram" status={c.instagramStatus} />
                                          <ScrapeChip label="YT" name="YouTube" status={c.youtubeStatus} />
                                          <ScrapeChip label="GG" name="Google" status={c.googleStatus} />
                                        </span>
                                        <span className="w-16 text-right flex-shrink-0 text-[13px] font-bold text-gray-800 whitespace-nowrap" title="All-time ads">{fmtNum(c.ads)}</span>
                                        <span className="w-16 text-right flex-shrink-0 text-[13px] font-semibold text-gray-700 whitespace-nowrap" title="Ads today">{fmtNum(c.today)}</span>
                                        <span className="w-16 text-right flex-shrink-0 text-[13px] font-semibold text-gray-700 whitespace-nowrap" title="Ads yesterday">{fmtNum(c.yesterday)}</span>
                                        <span className="w-16 text-right flex-shrink-0 text-[13px] font-semibold text-gray-700 whitespace-nowrap" title="Ads in the last 7 days">{fmtNum(c.last7Days)}</span>
                                        <span className="w-14 text-right flex-shrink-0"><Growth pct={c.growth} /></span>
                                      </div>
                                    ))}
                                   </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-[11px] text-gray-300 mt-5">Total is all-time; Today / Yesterday / 7 Days are by last-seen date; growth is day-over-day — live from the competitor-analysis service.</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <ToastContainer />
    </div>
  );
};

export default CompetitorTracker;
