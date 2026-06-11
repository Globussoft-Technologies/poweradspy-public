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

/**
 * Per-brand "ads by competitor" bar chart with a date filter. Fetches
 * /competitor-ads-by-range for the brand's request_id on mount and whenever the
 * range changes; results are cached per range so toggling presets is instant.
 */
function BrandAdsChart({ requestId }) {
  const [preset, setPreset] = useState("30d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
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

  const chart = useMemo(
    () => ({
      options: {
        chart: { type: "bar", toolbar: { show: false }, fontFamily: "inherit", animations: { speed: 400 } },
        plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: "62%" } },
        colors: ["#3F51B5"],
        dataLabels: { enabled: true, style: { fontSize: "11px", fontWeight: 600, colors: ["#fff"] }, offsetX: 0 },
        grid: { borderColor: "#eef1f6", strokeDashArray: 3 },
        xaxis: { categories: top.map((c) => c.name), labels: { style: { colors: "#9ca3af", fontSize: "11px" } } },
        yaxis: { labels: { style: { colors: "#374151", fontSize: "12px" }, maxWidth: 170 } },
        tooltip: {
          y: {
            formatter: (v, opts) => {
              const c = top[opts?.dataPointIndex] || {};
              return `${v} ads  (FB ${fmtNum(c.facebook)} · IG ${fmtNum(c.instagram)})`;
            },
          },
        },
      },
      series: [{ name: "Ads", data: top.map((c) => Number(c.ads) || 0) }],
    }),
    [top]
  );

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
              onClick={() => { setPreset(p.key); setFrom(""); setTo(""); }}
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
            onClick={() => { setPreset("30d"); setFrom(""); setTo(""); }}
            disabled={preset !== "custom" && !from && !to}
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
  const detailRef = useRef(null); // the right-hand panel captured for PDF export

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

  // Export the detail panel (selected user, or the overview) as a PDF by
  // rasterising it and slicing across A4 pages. Mirrors SearchIntelligence.
  const exportPdf = async () => {
    if (!detailRef.current || exporting) return;
    setExporting(true);
    // Expand every brand for the capture so the PDF holds the full data
    // regardless of what's collapsed on screen; restore the prior state after.
    const prevExpanded = expandedBrands;
    const allKeys = (stats?.brands || []).map((b, i) => brandKey(b, i));
    if (allKeys.length) {
      setExpandedBrands(new Set(allKeys));
      // let React flush the expanded rows + their layout before rasterising
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    try {
      // html-to-image renders via an SVG <foreignObject> using the browser's
      // own engine, so Tailwind v4's oklch / color-mix colours just work — no
      // CSS colour parsing (the thing html2canvas choked on).
      const [{ toCanvas }, { jsPDF }] = await Promise.all([
        import("html-to-image"),
        import("jspdf"),
      ]);

      const element = detailRef.current;
      const prevOverflow = element.style.overflow;
      element.style.overflow = "visible";

      const canvas = await toCanvas(element, {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        cacheBust: true,
        width: element.scrollWidth,
        height: element.scrollHeight,
        style: { overflow: "visible" },
      });

      element.style.overflow = prevOverflow;

      const imgW = canvas.width;
      const imgH = canvas.height;

      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();

      const HEADER_H = 48;
      const FOOTER_H = 20;
      const MARGIN = 16;
      const availW = pageW - MARGIN * 2;
      const availH = pageH - HEADER_H - FOOTER_H - MARGIN;

      const ratio = availW / imgW;
      const scaledH = imgH * ratio;

      const who = selected ? (selected.email || selected.name || "user") : "Overview";
      const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

      const drawHeader = (pageNum) => {
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, pageW, HEADER_H, "F");
        pdf.setDrawColor(229, 231, 235);
        pdf.line(0, HEADER_H, pageW, HEADER_H);
        pdf.setFontSize(13);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(31, 41, 106);
        pdf.text("Competitor Tracker", MARGIN, 22);
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(107, 114, 128);
        pdf.text(`${who}  ·  ${dateStr}${pageNum > 1 ? `  ·  Page ${pageNum}` : ""}`, MARGIN, 38);
      };

      const drawFooter = () => {
        pdf.setFontSize(8);
        pdf.setTextColor(156, 163, 175);
        pdf.text("PowerAdSpy Admin  ·  Competitor Tracker Export", pageW / 2, pageH - 6, { align: "center" });
      };

      let yDrawn = 0;
      let pageNum = 1;
      while (yDrawn < scaledH) {
        if (pageNum > 1) pdf.addPage();
        drawHeader(pageNum);

        const sliceScaledH = Math.min(availH, scaledH - yDrawn);
        const sliceSrcH = sliceScaledH / ratio;
        const sliceSrcY = yDrawn / ratio;

        const tmp = document.createElement("canvas");
        tmp.width = imgW;
        tmp.height = Math.ceil(sliceSrcH);
        tmp.getContext("2d").drawImage(canvas, 0, sliceSrcY, imgW, Math.ceil(sliceSrcH), 0, 0, imgW, Math.ceil(sliceSrcH));

        pdf.addImage(tmp.toDataURL("image/png"), "PNG", MARGIN, HEADER_H + 4, availW, sliceScaledH);
        drawFooter();

        yDrawn += availH;
        pageNum++;
      }

      const safe = who.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
      pdf.save(`competitor-tracker-${safe}-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error("[Export] failed:", err);
      toast.error(`Export failed: ${err.message}`);
    } finally {
      if (allKeys.length) setExpandedBrands(prevExpanded); // restore on-screen collapse state
      setExporting(false);
    }
  };

  const totalCompetitors = stats?.totalCompetitors || 0;

  return (
    <div className="bg-[#f7f8fb] rounded-[10px] w-full h-[calc(100%-120px)] overflow-hidden flex flex-col">
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
            <button onClick={exportPdf} disabled={exporting} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-[13px] text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed" title="Export this user's detail as PDF">
              <FiDownload className={`w-4 h-4 ${exporting ? "animate-pulse" : ""}`} /> {exporting ? "Exporting…" : "Export PDF"}
            </button>
          )}
        </div>
      </div>

      {/* Body: master / detail */}
      <div className="flex-1 min-h-0 px-6 pb-6 flex gap-4">
        {/* ── Left: user list ── */}
        <div className="w-[340px] flex-shrink-0 bg-white rounded-xl border border-gray-100 flex flex-col overflow-hidden">
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
        <div ref={detailRef} className="flex-1 min-w-0 bg-white rounded-xl border border-gray-100 overflow-auto">
          {!selected ? (
            /* ===== Overview from get-comp-users-count ===== */
            <div className="p-6">
              <h4 className="text-[#1f296a] font-bold text-[18px]">Overview</h4>
              <p className="text-gray-400 text-[12px] mb-5">Program-wide competitor monitoring totals. Select a user to drill in.</p>
              {loading || !summary ? (
                <Loader />
              ) : (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
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
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mt-5">
                    {[
                      { label: "BRANDS", value: fmtNum(stats?.totalBrands), accent: "text-[#3F51B5]", ring: "from-[#eef1fb] to-white" },
                      { label: "COMPETITORS", value: fmtNum(totalCompetitors), accent: "text-rose-500", ring: "from-rose-50 to-white" },
                      { label: "MONITORING", value: `${fmtNum(monitoring)}/${fmtNum(totalCompetitors)}`, accent: "text-amber-500", ring: "from-amber-50 to-white" },
                      {
                        label: "ADS TODAY", value: fmtNum(adsToday.total), accent: "text-green-600", ring: "from-green-50 to-white",
                        sub: `FB ${fmtNum(adsToday.facebook)} · IG ${fmtNum(adsToday.instagram)}`,
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
                        const maxAds = Math.max(1, ...competitors.map((c) => Number(c.ads) || 0));
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
                                  competitors.map((c, j) => (
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
                                    <span className="hidden sm:block w-20 flex-shrink-0"><Bar value={Number(c.ads) || 0} max={maxAds} height="h-1.5" /></span>
                                    <span className="text-[13px] font-bold text-gray-800 flex-shrink-0 w-14 text-right whitespace-nowrap">{fmtNum(c.ads)} <span className="text-gray-400 font-medium">ads</span></span>
                                    <span className="w-14 text-right flex-shrink-0"><Growth pct={c.growth} /></span>
                                  </div>
                                  ))
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-[11px] text-gray-300 mt-5">Ads are today's count; growth is vs. yesterday — live from the competitor-analysis service.</p>
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
