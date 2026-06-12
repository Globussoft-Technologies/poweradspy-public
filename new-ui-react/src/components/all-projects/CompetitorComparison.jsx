import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  ChevronLeft,
  TrendingUp,
  BarChart3,
  DollarSign,
  MessageCircle,
  ThumbsUp,
  Share2,
  Image,
  Loader2,
  AlertTriangle,
  MoreHorizontal,
  Download,
} from "lucide-react";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { CompetitorAPI, trackProjectEvent } from "../../services/api";

// ─── Constants ──────────────────────────────────────────────────────────────

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const COLORS = {
  brand: "#FFA43C",
  competitor: "#326DE7",
};

const CTA_COLORS = [
  "#f97316",
  "#ef4444",
  "#facc15",
  "#6366f1",
  "#ec4899",
  "#06b6d4",
  "#10b981",
  "#8b5cf6",
];

// ─── Common axis/grid props ─────────────────────────────────────────────────

const axisProps = {
  tick: { fill: "#64748b", fontSize: 11 },
  axisLine: false,
  tickLine: false,
};
const gridProps = { strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.05)" };

// ─── Tooltip ────────────────────────────────────────────────────────────────

// ─── Legend Toggle Hook ──────────────────────────────────────────────────────

/** Hook to manage toggling series visibility via legend clicks (matches ApexCharts behavior) */
const useSeriesToggle = () => {
  const [hidden, setHidden] = useState(new Set());
  const toggle = (dataKey) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(dataKey)) next.delete(dataKey);
      else next.add(dataKey);
      return next;
    });
  };
  return { hidden, toggle };
};

/** Custom interactive legend — clicking a series dims it and hides it from the chart */
const ToggleLegend = ({ payload, hidden, onToggle }) => {
  if (!payload?.length) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] mt-1">
      {payload.map((entry, i) => {
        const isHidden = hidden.has(entry.dataKey);
        return (
          <span
            key={i}
            className="flex items-center gap-1.5 cursor-pointer select-none transition-opacity"
            style={{ opacity: isHidden ? 0.3 : 1 }}
            onClick={() => onToggle(entry.dataKey)}
          >
            <span
              className="w-3 h-3 rounded-sm"
              style={{ background: entry.color }}
            />
            <span className="text-white/70">{entry.value}</span>
          </span>
        );
      })}
    </div>
  );
};

// ─── Tooltip ────────────────────────────────────────────────────────────────

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1a1a2e] border border-white/10 rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-white/60 font-medium mb-1">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: p.color || p.stroke }}
          />
          <span className="text-white/80">{p.name}:</span>
          <span className="text-white font-bold">
            {typeof p.value === "number" ? p.value.toLocaleString() : p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

// ─── Section Card ───────────────────────────────────────────────────────────

const SectionCard = ({ title, rightContent, children, className = "" }) => (
  <div
    className={`bg-theme-card border border-theme-border rounded-xl overflow-hidden shadow-sm ${className}`}
  >
    {title && (
      <div className="px-6 py-4 border-b border-theme-border bg-theme-bg/50 flex items-center justify-between">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          {title}
        </h3>
        {rightContent}
      </div>
    )}
    <div className="p-6">{children}</div>
  </div>
);

// ─── Legend Dots ─────────────────────────────────────────────────────────────

const ChartLegend = ({ items }) => (
  <div className="flex items-center gap-4 text-xs font-medium">
    {items.map((it, i) => (
      <span key={i} className="flex items-center gap-1.5">
        <span
          className="w-2.5 h-2.5 rounded-full"
          style={{ background: it.color }}
        />
        <span className="text-white/60">{it.label}</span>
      </span>
    ))}
  </div>
);

// ─── Info Tooltip ───────────────────────────────────────────────────────────

const InfoTooltip = ({ text }) => {
  const [show, setShow] = useState(false);
  return (
    <div
      className="relative group"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span className="w-4 h-4 rounded-full border border-white/30 flex items-center justify-center text-white/40 group-hover:text-white/70 group-hover:border-white/50 transition-colors cursor-pointer text-[9px] font-serif italic leading-none">
        i
      </span>
      {show && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-80 bg-[#1a1a2e] border border-white/10 rounded-xl px-5 py-4 shadow-2xl">
          <p className="text-sm text-white/80 leading-relaxed text-center">
            {text}
          </p>
        </div>
      )}
    </div>
  );
};

// ─── Chart Download Menu ─────────────────────────────────────────────────────

/**
 * Download helpers – no external dependencies.
 * svgEl: the <svg> DOM element inside the chart container.
 */
const downloadSVG = (svgEl, filename) => {
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svgEl);
  const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.svg`;
  a.click();
  URL.revokeObjectURL(url);
};

const downloadPNG = (svgEl, filename) => {
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svgEl);
  const { width, height } = svgEl.getBoundingClientRect();
  const canvas = document.createElement("canvas");
  const scale = window.devicePixelRatio || 2;
  canvas.width = (width || 800) * scale;
  canvas.height = (height || 400) * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const img = new window.Image();
  const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  img.onload = () => {
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    const a = document.createElement("a");
    a.download = `${filename}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  };
  img.src = url;
};

const downloadCSV = (data, filename) => {
  if (!data || data.length === 0) return;
  const headers = Object.keys(data[0]);
  const rows = data.map((row) =>
    headers.map((h) => {
      const v = row[h];
      return typeof v === "string" && v.includes(",") ? `"${v}"` : v ?? "";
    })
  );
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

/**
 * Three-dot menu with Download SVG / PNG / CSV actions.
 * chartRef: ref to the wrapper div that contains a <svg> element.
 * csvData: array of plain objects for CSV export.
 * filename: base name (no extension).
 */
const ChartDownloadMenu = ({ chartRef, csvData, filename }) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const getSvgEl = () => chartRef?.current?.querySelector("svg");

  const handleSVG = () => {
    const svg = getSvgEl();
    if (svg) downloadSVG(svg, filename);
    setOpen(false);
  };

  const handlePNG = () => {
    const svg = getSvgEl();
    if (svg) downloadPNG(svg, filename);
    setOpen(false);
  };

  const handleCSV = () => {
    downloadCSV(csvData, filename);
    setOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-1.5 rounded-md text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
        title="Download chart"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-[#1e2235] border border-white/10 rounded-lg shadow-2xl overflow-hidden min-w-[148px]">
          {[
            { label: "Download SVG", action: handleSVG },
            { label: "Download PNG", action: handlePNG },
            { label: "Download CSV", action: handleCSV },
          ].map(({ label, action }) => (
            <button
              key={label}
              onClick={action}
              className="flex items-center gap-2.5 w-full px-4 py-2.5 text-xs text-white/70 hover:text-white hover:bg-white/[0.07] transition-colors text-left whitespace-nowrap"
            >
              <Download size={12} className="text-white/40" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Loading Skeleton ───────────────────────────────────────────────────────

const ChartSkeleton = ({ height = 240 }) => (
  <div className="flex items-center justify-center" style={{ height }}>
    <Loader2 size={24} className="animate-spin text-white/30" />
  </div>
);

const ErrorBlock = ({ message }) => (
  <div className="flex items-center justify-center gap-2 py-8 text-red-400/70 text-sm">
    <AlertTriangle size={16} />
    <span>{message || "Failed to load data"}</span>
  </div>
);

// ─── Data Transformers ──────────────────────────────────────────────────────

/** Convert { January: N, February: N, ... } objects into recharts-friendly array */
const buildMonthlyChartData = (brandData, competitorData, platformKey) => {
  return MONTHS.map((month, i) => ({
    month: SHORT_MONTHS[i],
    brand: brandData?.[platformKey]?.[month] || 0,
    competitor: competitorData?.[platformKey]?.[month] || 0,
  }));
};

/** Sum across platforms for each month (exclude Google — matches Laravel) */
const buildAdsOverTimeData = (brandAdCount, competitorAdCount) => {
  const platforms = ["facebook", "instagram", "youtube"];
  return MONTHS.map((month, i) => {
    let brandTotal = 0,
      compTotal = 0;
    platforms.forEach((p) => {
      brandTotal += brandAdCount?.[p]?.[month] || 0;
      compTotal += competitorAdCount?.[p]?.[month] || 0;
    });
    return { month: SHORT_MONTHS[i], brand: brandTotal, competitor: compTotal };
  });
};

const DAYS = Array.from({ length: 31 }, (_, i) => (i + 1).toString());

/** Build budget chart data — supports month/day/year views (matches Laravel) */
const buildBudgetData = (brandBudget, competitorBudget, view = "month") => {
  if (view === "day") {
    return DAYS.map((d) => ({
      label: d,
      brandFB: Math.round(brandBudget?.facebook?.dailyAverageBudget?.[d] || 0),
      brandIG: Math.round(brandBudget?.instagram?.dailyAverageBudget?.[d] || 0),
      competitorFB: Math.round(
        competitorBudget?.facebook?.dailyAverageBudget?.[d] || 0,
      ),
      competitorIG: Math.round(
        competitorBudget?.instagram?.dailyAverageBudget?.[d] || 0,
      ),
    }));
  }
  if (view === "year") {
    const yearKeys = [
      ...new Set([
        ...Object.keys(brandBudget?.facebook?.yearlyAverageBudget || {}),
        ...Object.keys(brandBudget?.instagram?.yearlyAverageBudget || {}),
        ...Object.keys(competitorBudget?.facebook?.yearlyAverageBudget || {}),
        ...Object.keys(competitorBudget?.instagram?.yearlyAverageBudget || {}),
      ]),
    ].sort((a, b) => +a - +b);
    return yearKeys.map((y) => ({
      label: y,
      brandFB: Math.round(brandBudget?.facebook?.yearlyAverageBudget?.[y] || 0),
      brandIG: Math.round(
        brandBudget?.instagram?.yearlyAverageBudget?.[y] || 0,
      ),
      competitorFB: Math.round(
        competitorBudget?.facebook?.yearlyAverageBudget?.[y] || 0,
      ),
      competitorIG: Math.round(
        competitorBudget?.instagram?.yearlyAverageBudget?.[y] || 0,
      ),
    }));
  }
  // month (default)
  return MONTHS.map((month, i) => ({
    label: SHORT_MONTHS[i],
    brandFB: Math.round(
      brandBudget?.facebook?.monthlyAverageBudget?.[month] || 0,
    ),
    brandIG: Math.round(
      brandBudget?.instagram?.monthlyAverageBudget?.[month] || 0,
    ),
    competitorFB: Math.round(
      competitorBudget?.facebook?.monthlyAverageBudget?.[month] || 0,
    ),
    competitorIG: Math.round(
      competitorBudget?.instagram?.monthlyAverageBudget?.[month] || 0,
    ),
  }));
};

/** Build cumulative engagement data from LCS response */
const buildEngagementData = (brandLCS, competitorLCS) => {
  let bL = 0,
    cL = 0,
    bC = 0,
    cC = 0,
    bS = 0,
    cS = 0;
  return MONTHS.map((month, i) => {
    // Sum likes/comments/shares across facebook + instagram
    const bl =
      (brandLCS?.facebook?.likes?.[month] || 0) +
      (brandLCS?.instagram?.likes?.[month] || 0);
    const cl =
      (competitorLCS?.facebook?.likes?.[month] || 0) +
      (competitorLCS?.instagram?.likes?.[month] || 0);
    const bc =
      (brandLCS?.facebook?.comments?.[month] || 0) +
      (brandLCS?.instagram?.comments?.[month] || 0);
    const cc =
      (competitorLCS?.facebook?.comments?.[month] || 0) +
      (competitorLCS?.instagram?.comments?.[month] || 0);
    const bs =
      (brandLCS?.facebook?.shares?.[month] || 0) +
      (brandLCS?.instagram?.shares?.[month] || 0);
    const cs =
      (competitorLCS?.facebook?.shares?.[month] || 0) +
      (competitorLCS?.instagram?.shares?.[month] || 0);
    bL += bl;
    cL += cl;
    bC += bc;
    cC += cc;
    bS += bs;
    cS += cs;
    return {
      month: SHORT_MONTHS[i],
      brandLikes: bL,
      competitorLikes: cL,
      brandComments: bC,
      competitorComments: cC,
      brandShares: bS,
      competitorShares: cS,
    };
  });
};

/** Normalize CTA string (matches Laravel: lowercase, trim, collapse spaces) */
const normalizeCta = (cta) => {
  if (!cta) return "";
  return cta.trim().toLowerCase().replace(/\s+/g, " ");
};

/** Build monthly CTA stacked bar data — matches Laravel logic (top 4 CTAs, normalized) */
const buildCtaData = (frequentData) => {
  const platforms = ["facebook", "instagram"];

  // 1. Combine topCta across platforms, normalized + summed
  const ctaCounts = {};
  platforms.forEach((p) => {
    const topCtas = frequentData?.[p]?.topCta;
    if (!Array.isArray(topCtas)) return;
    topCtas.forEach(({ cta, count }) => {
      const n = normalizeCta(cta);
      if (!n) return;
      ctaCounts[n] = (ctaCounts[n] || 0) + count;
    });
  });

  // 2. Pick top 4 by count
  const topCtas = Object.entries(ctaCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([cta]) => cta);

  if (topCtas.length === 0) return { chartData: [], ctaTypes: [] };

  // 3. Display names (capitalized)
  const displayNames = topCtas.map((c) =>
    c.replace(/\b\w/g, (ch) => ch.toUpperCase()),
  );

  // 4. Build monthly chart data
  const chartData = MONTHS.map((month, i) => {
    const obj = { month: SHORT_MONTHS[i] };
    topCtas.forEach((cta, ci) => {
      let total = 0;
      platforms.forEach((p) => {
        const entries = frequentData?.[p]?.monthlyCta?.[month];
        if (Array.isArray(entries)) {
          total += entries
            .filter((item) => normalizeCta(item.cta) === cta)
            .reduce((sum, item) => sum + (item.count || 0), 0);
        }
      });
      obj[displayNames[ci]] = total;
    });
    return obj;
  });

  return { chartData, ctaTypes: displayNames };
};

const NAS_URL = import.meta.env.VITE_PAS_IMAGE_DOMAIN || "";

/**
 * Extract top headlines from get-longest response (matches Laravel logic).
 * Uses longestRunningAds → IMAGE type → title_exactly fields.
 */
const extractHeadlines = (longestData) => {
  let titles = [];

  const getImageAdTitles = (ads, platform) => {
    const result = [];
    for (const ad of ads) {
      if (platform === "facebook" && ad["facebook_ad.type"] === "IMAGE") {
        const title = ad["facebook_ad_variants.title_exactly"];
        if (title) result.push(title);
      }
      if (platform === "instagram" && ad["instagram_ad.type"] === "IMAGE") {
        const title = ad["instagram_ad_variants.title_exactly"];
        if (title) result.push(title);
      }
      if (platform === "google" && ad["type"] === "IMAGE") {
        const title = ad["ad_title"];
        if (title) result.push(title);
      }
      if (result.length >= 5) break;
    }
    return result;
  };

  if (longestData?.facebook?.longestRunningAds?.length) {
    titles = getImageAdTitles(
      longestData.facebook.longestRunningAds,
      "facebook",
    );
  }
  if (titles.length < 5 && longestData?.instagram?.longestRunningAds?.length) {
    titles = titles
      .concat(
        getImageAdTitles(longestData.instagram.longestRunningAds, "instagram"),
      )
      .slice(0, 5);
  }
  if (titles.length < 5 && longestData?.google?.longestRunningAds?.length) {
    titles = titles
      .concat(getImageAdTitles(longestData.google.longestRunningAds, "google"))
      .slice(0, 5);
  }

  // Clean up: split on "||" and take first part (matches Laravel)
  return titles.map((t) => {
    const parts = t.split("||");
    return parts.length > 1 ? parts[0].trim() : t.trim();
  });
};

/**
 * Extract creative image URLs from get-longest response (matches Laravel logic).
 * Uses longestRunningAds → IMAGE type → new_nas_image_url, prefixed with NAS_URL.
 */
const extractImages = (longestData) => {
  let images = [];

  const getImageAdImages = (ads, platform) => {
    const result = [];
    for (const ad of ads) {
      if (
        platform === "facebook" &&
        ad["facebook_ad.type"] === "IMAGE" &&
        ad["new_nas_image_url"]
      ) {
        result.push(ad["new_nas_image_url"]);
      }
      if (
        platform === "instagram" &&
        ad["instagram_ad.type"] === "IMAGE" &&
        ad["new_nas_image_url"]
      ) {
        result.push(ad["new_nas_image_url"]);
      }
      if (
        platform === "google" &&
        ad["type"] === "IMAGE" &&
        ad["new_nas_image_url"]
      ) {
        result.push(ad["new_nas_image_url"]);
      }
      if (result.length >= 5) break;
    }
    return result;
  };

  if (longestData?.facebook?.longestRunningAds?.length) {
    images = getImageAdImages(
      longestData.facebook.longestRunningAds,
      "facebook",
    );
  }
  if (images.length < 5 && longestData?.instagram?.longestRunningAds?.length) {
    images = images
      .concat(
        getImageAdImages(longestData.instagram.longestRunningAds, "instagram"),
      )
      .slice(0, 5);
  }
  if (images.length < 5 && longestData?.google?.longestRunningAds?.length) {
    images = images
      .concat(getImageAdImages(longestData.google.longestRunningAds, "google"))
      .slice(0, 5);
  }

  // Prefix with NAS_URL
  return images.map((img) => `${NAS_URL}${img}`);
};

// ─── Main Component ─────────────────────────────────────────────────────────

const CompetitorComparison = ({ brandName, competitorName, onBack }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Legend toggle state for each chart with interactive legends
  const budgetToggle = useSeriesToggle();
  const engagementToggle = useSeriesToggle();
  const compCtaToggle = useSeriesToggle();
  const brandCtaToggle = useSeriesToggle();
  // Chart ref for engagement comparison download
  const engagementChartRef = useRef(null);

  // Data states
  const [adCountData, setAdCountData] = useState({
    brand: null,
    competitor: null,
  });
  const [lcsData, setLcsData] = useState({ brand: null, competitor: null });
  const [budgetData, setBudgetData] = useState({
    brand: null,
    competitor: null,
  });
  const [frequentData, setFrequentData] = useState({
    brand: null,
    competitor: null,
  });
  const [topAdsData, setTopAdsData] = useState({
    brand: null,
    competitor: null,
  });
  const [budgetView, setBudgetView] = useState("month"); // month | day | year

  // Section-level loading
  const [sectionLoading, setSectionLoading] = useState({
    adCount: true,
    lcs: true,
    budget: true,
    frequent: true,
    topAds: true,
  });

  const safeCall = async (fn) => {
    try {
      const res = await fn();
      return res?.body?.data || res?.data || res;
    } catch (e) {
      console.error("API call failed:", e);
      return null;
    }
  };

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch ad counts for both brand and competitor in parallel
      const [brandAdCount, compAdCount] = await Promise.all([
        safeCall(() => CompetitorAPI.getAdCount(brandName)),
        safeCall(() => CompetitorAPI.getAdCount(competitorName)),
      ]);
      setAdCountData({ brand: brandAdCount, competitor: compAdCount });
      setSectionLoading((prev) => ({ ...prev, adCount: false }));

      // Fetch LCS (likes/comments/shares) for both
      const [brandLCS, compLCS] = await Promise.all([
        safeCall(() => CompetitorAPI.getLCS(brandName)),
        safeCall(() => CompetitorAPI.getLCS(competitorName)),
      ]);
      setLcsData({ brand: brandLCS, competitor: compLCS });
      setSectionLoading((prev) => ({ ...prev, lcs: false }));

      // Fetch budget data for both
      const [brandBudget, compBudget] = await Promise.all([
        safeCall(() => CompetitorAPI.getAverageBudget(brandName)),
        safeCall(() => CompetitorAPI.getAverageBudget(competitorName)),
      ]);
      setBudgetData({ brand: brandBudget, competitor: compBudget });
      setSectionLoading((prev) => ({ ...prev, budget: false }));

      // Fetch frequent data (CTAs, countries) for both
      const [brandFrequent, compFrequent] = await Promise.all([
        safeCall(() => CompetitorAPI.getFrequentData(brandName)),
        safeCall(() => CompetitorAPI.getFrequentData(competitorName)),
      ]);
      setFrequentData({ brand: brandFrequent, competitor: compFrequent });
      setSectionLoading((prev) => ({ ...prev, frequent: false }));

      // Fetch longest running ads (for headlines + images) — matches Laravel
      const [brandLongest, compLongest] = await Promise.all([
        safeCall(() => CompetitorAPI.getLongest(brandName)),
        safeCall(() => CompetitorAPI.getLongest(competitorName)),
      ]);
      setTopAdsData({ brand: brandLongest, competitor: compLongest });
      setSectionLoading((prev) => ({ ...prev, topAds: false }));
    } catch (err) {
      console.error("CompetitorComparison fetch error:", err);
      setError("Failed to load comparison data. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [brandName, competitorName]);

  useEffect(() => {
    if (brandName && competitorName) {
      fetchAllData();
      trackProjectEvent('Competitor-comparison', { brand: brandName, advertiser: competitorName });
    }
  }, [brandName, competitorName, fetchAllData]);

  // ── Derived chart data ──────────────────────────────────────────

  const facebookData = buildMonthlyChartData(
    adCountData.brand,
    adCountData.competitor,
    "facebook",
  );
  const instagramData = buildMonthlyChartData(
    adCountData.brand,
    adCountData.competitor,
    "instagram",
  );
  const adsOverTime = buildAdsOverTimeData(
    adCountData.brand,
    adCountData.competitor,
  );
  const budgetChartData = buildBudgetData(
    budgetData.brand,
    budgetData.competitor,
    budgetView,
  );
  const budgetViewLabel =
    budgetView === "month"
      ? "Monthly"
      : budgetView === "day"
        ? "Daily"
        : "Yearly";
  const engagementChartData = buildEngagementData(
    lcsData.brand,
    lcsData.competitor,
  );

  const brandCta = buildCtaData(frequentData.brand);
  const competitorCta = buildCtaData(frequentData.competitor);

  const brandHeadlines = extractHeadlines(topAdsData.brand);
  const competitorHeadlines = extractHeadlines(topAdsData.competitor);
  const brandImages = extractImages(topAdsData.brand);
  const competitorImages = extractImages(topAdsData.competitor);

  // Match Laravel: hide entire sections when BOTH sides have no data
  const hasAnyCta =
    brandCta.ctaTypes.length > 0 || competitorCta.ctaTypes.length > 0;
  const hasAnyHeadlines =
    brandHeadlines.length > 0 || competitorHeadlines.length > 0;
  const hasAnyImages = brandImages.length > 0 || competitorImages.length > 0;
  const hasCreativeInsights = hasAnyCta || hasAnyHeadlines;

  // ── Full-page loading ──
  if (loading && sectionLoading.adCount) {
    return (
      <div className="animate-in fade-in duration-500 w-full">
        <button
          onClick={onBack}
          className="text-theme-text-muted hover:text-white flex items-center gap-1.5 text-sm font-semibold transition-colors mb-6"
        >
          <ChevronLeft size={18} /> Back to Project
        </button>
        <div className="flex flex-col items-center justify-center py-32 gap-4">
          <Loader2 size={36} className="animate-spin text-[#6b99ff]" />
          <p className="text-white/50 text-sm">Loading comparison data...</p>
        </div>
      </div>
    );
  }

  if (error && !adCountData.brand && !adCountData.competitor) {
    return (
      <div className="animate-in fade-in duration-500 w-full">
        <button
          onClick={onBack}
          className="text-theme-text-muted hover:text-white flex items-center gap-1.5 text-sm font-semibold transition-colors mb-6"
        >
          <ChevronLeft size={18} /> Back to Project
        </button>
        <div className="flex flex-col items-center justify-center py-32 gap-4">
          <AlertTriangle size={36} className="text-red-400" />
          <p className="text-red-400/80 text-sm">{error}</p>
          <button
            onClick={fetchAllData}
            className="px-4 py-2 rounded-lg bg-[#3762c1]/20 text-[#6b99ff] text-sm hover:bg-[#3762c1]/30 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-500 w-full">
      <button
        onClick={onBack}
        className="text-theme-text-muted hover:text-white flex items-center gap-1.5 text-sm font-semibold transition-colors mb-6"
      >
        <ChevronLeft size={18} /> Back to Project
      </button>

      <div className="max-w-7xl mx-auto space-y-6 pb-20">
        {/* Header */}
        <div className="border-b border-theme-border pb-6">
          <h1 className="text-3xl font-bold text-white tracking-tight mb-1">
            Competitive Analysis
          </h1>
          <p className="text-theme-text-muted text-lg">
            <span className="text-orange-400 font-semibold capitalize">
              {brandName}
            </span>{" "}
            vs{" "}
            <span className="text-[#6b99ff] font-semibold capitalize">
              {competitorName}
            </span>
          </p>
        </div>

        {/* ── Platform Comparison — Stacked Bars ─────────────────── */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <TrendingUp size={18} className="text-[#6b99ff]" /> Platform
              Comparison
            </h2>
            <InfoTooltip text="This section compares your brand with its competitors, highlighting the months in which ads were active across Facebook, Instagram, and Google platforms." />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Facebook */}
            <SectionCard
              title={
                <>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="#1877F2">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                  </svg>{" "}
                  Facebook
                </>
              }
              rightContent={
                <ChartLegend
                  items={[
                    { label: brandName, color: COLORS.brand },
                    { label: competitorName, color: COLORS.competitor },
                  ]}
                />
              }
            >
              {sectionLoading.adCount ? (
                <ChartSkeleton />
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={facebookData}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="month" {...axisProps} />
                    <YAxis {...axisProps} />
                    <Tooltip
                      content={<CustomTooltip />}
                      cursor={{ fill: "rgba(255,255,255,0.03)" }}
                    />
                    <Bar
                      dataKey="brand"
                      name={brandName}
                      stackId="a"
                      fill={COLORS.brand}
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="competitor"
                      name={competitorName}
                      stackId="a"
                      fill={COLORS.competitor}
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </SectionCard>

            {/* Instagram */}
            <SectionCard
              title={
                <>
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <defs>
                      <linearGradient
                        id="igGrad"
                        x1="0%"
                        y1="100%"
                        x2="100%"
                        y2="0%"
                      >
                        <stop offset="0%" stopColor="#FFDC80" />
                        <stop offset="25%" stopColor="#F77737" />
                        <stop offset="50%" stopColor="#E1306C" />
                        <stop offset="75%" stopColor="#C13584" />
                        <stop offset="100%" stopColor="#833AB4" />
                      </linearGradient>
                    </defs>
                    <path
                      fill="url(#igGrad)"
                      d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405a1.441 1.441 0 11-2.882 0 1.441 1.441 0 012.882 0z"
                    />
                  </svg>{" "}
                  Instagram
                </>
              }
              rightContent={
                <ChartLegend
                  items={[
                    { label: brandName, color: COLORS.brand },
                    { label: competitorName, color: COLORS.competitor },
                  ]}
                />
              }
            >
              {sectionLoading.adCount ? (
                <ChartSkeleton />
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={instagramData}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="month" {...axisProps} />
                    <YAxis {...axisProps} />
                    <Tooltip
                      content={<CustomTooltip />}
                      cursor={{ fill: "rgba(255,255,255,0.03)" }}
                    />
                    <Bar
                      dataKey="brand"
                      name={brandName}
                      stackId="a"
                      fill={COLORS.brand}
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="competitor"
                      name={competitorName}
                      stackId="a"
                      fill={COLORS.competitor}
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </SectionCard>
          </div>
        </div>

        {/* ── Ads Over Time — Area Chart ─────────────────────────── */}
        <SectionCard
          title={
            <>
              <TrendingUp size={15} className="text-[#6b99ff]" /> Ads Over Time{" "}
              <InfoTooltip text="This section compares your brand with its competitors, highlighting the months during which ads were active." />
            </>
          }
          rightContent={
            <ChartLegend
              items={[
                { label: brandName, color: COLORS.brand },
                { label: competitorName, color: COLORS.competitor },
              ]}
            />
          }
        >
          {sectionLoading.adCount ? (
            <ChartSkeleton height={260} />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={adsOverTime}>
                <defs>
                  <linearGradient id="gradBrand" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor={COLORS.brand}
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="95%"
                      stopColor={COLORS.brand}
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                  <linearGradient id="gradComp" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor={COLORS.competitor}
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="95%"
                      stopColor={COLORS.competitor}
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis {...axisProps} />
                <Tooltip
                  content={<CustomTooltip />}
                  cursor={{ fill: "rgba(255,255,255,0.03)" }}
                />
                <Area
                  type="monotone"
                  dataKey="brand"
                  name={brandName}
                  stroke={COLORS.brand}
                  strokeWidth={2.5}
                  fill="url(#gradBrand)"
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="competitor"
                  name={competitorName}
                  stroke={COLORS.competitor}
                  strokeWidth={2.5}
                  fill="url(#gradComp)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        {/* ── Average Budget — 4 Line Area Chart (per platform) ──── */}
        <SectionCard
          title={
            <>
              <DollarSign size={15} className="text-purple-400" /> Average
              Budget Comparison{" "}
              <InfoTooltip text="This section compares the average ad budget of your brand with competitors across Facebook and Instagram, on a monthly or daily basis." />
            </>
          }
          rightContent={
            <div className="flex items-center gap-4">
              <ChartLegend
                items={[
                  { label: brandName, color: COLORS.brand },
                  { label: competitorName, color: COLORS.competitor },
                ]}
              />
              <select
                value={budgetView}
                onChange={(e) => setBudgetView(e.target.value)}
                className="bg-white/5 border border-white/15 text-white/80 text-xs rounded-md px-2 py-1.5 outline-none cursor-pointer hover:border-white/30 transition-colors"
              >
                <option value="month" className="bg-[#1a1a2e] text-white">
                  Monthly View
                </option>
                <option value="day" className="bg-[#1a1a2e] text-white">
                  Daily View
                </option>
                <option value="year" className="bg-[#1a1a2e] text-white">
                  Yearly View
                </option>
              </select>
            </div>
          }
        >
          {sectionLoading.budget ? (
            <ChartSkeleton height={300} />
          ) : (
            <>
              <p className="text-xs text-white/40 mb-3 font-medium">
                {budgetViewLabel} Average Budget Comparison
              </p>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={budgetChartData}>
                  <defs>
                    <linearGradient
                      id="gradBrandFB"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor={COLORS.brand}
                        stopOpacity={0.25}
                      />
                      <stop
                        offset="95%"
                        stopColor={COLORS.brand}
                        stopOpacity={0}
                      />
                    </linearGradient>
                    <linearGradient
                      id="gradBrandIG"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor="#ec4899"
                        stopOpacity={0.25}
                      />
                      <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient
                      id="gradCompFB2"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor={COLORS.competitor}
                        stopOpacity={0.25}
                      />
                      <stop
                        offset="95%"
                        stopColor={COLORS.competitor}
                        stopOpacity={0}
                      />
                    </linearGradient>
                    <linearGradient id="gradCompIG" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor="#38bdf8"
                        stopOpacity={0.25}
                      />
                      <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis
                    {...axisProps}
                    tickFormatter={(v) =>
                      v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`
                    }
                    label={{
                      value: "Budget ($)",
                      angle: -90,
                      position: "insideLeft",
                      fill: "#64748b",
                      fontSize: 11,
                    }}
                  />
                  <Tooltip
                    content={<CustomTooltip />}
                    cursor={{ fill: "rgba(255,255,255,0.03)" }}
                  />
                  <Legend
                    content={
                      <ToggleLegend
                        hidden={budgetToggle.hidden}
                        onToggle={budgetToggle.toggle}
                      />
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="brandFB"
                    name={`${brandName} Facebook`}
                    stroke={COLORS.brand}
                    strokeWidth={2}
                    fill="url(#gradBrandFB)"
                    dot={false}
                    hide={budgetToggle.hidden.has("brandFB")}
                  />
                  <Area
                    type="monotone"
                    dataKey="brandIG"
                    name={`${brandName} Instagram`}
                    stroke="#ec4899"
                    strokeWidth={2}
                    fill="url(#gradBrandIG)"
                    dot={false}
                    hide={budgetToggle.hidden.has("brandIG")}
                  />
                  <Area
                    type="monotone"
                    dataKey="competitorFB"
                    name={`${competitorName} Facebook`}
                    stroke={COLORS.competitor}
                    strokeWidth={2}
                    fill="url(#gradCompFB2)"
                    dot={false}
                    hide={budgetToggle.hidden.has("competitorFB")}
                  />
                  <Area
                    type="monotone"
                    dataKey="competitorIG"
                    name={`${competitorName} Instagram`}
                    stroke="#38bdf8"
                    strokeWidth={2}
                    fill="url(#gradCompIG)"
                    dot={false}
                    hide={budgetToggle.hidden.has("competitorIG")}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </>
          )}
        </SectionCard>

        {/* ── Engagement Comparison — Cumulative Lines ────────────── */}
        <SectionCard
          title={
            <>
              <MessageCircle size={15} className="text-emerald-400" />{" "}
              Engagement Comparison{" "}
              <InfoTooltip text="This section compares cumulative engagement metrics (likes, comments, shares) between your brand and competitors across platforms." />
            </>
          }
          rightContent={
            <div className="flex items-center gap-3">
              <ChartLegend
                items={[
                  { label: brandName, color: COLORS.brand },
                  { label: competitorName, color: COLORS.competitor },
                ]}
              />
              <ChartDownloadMenu
                chartRef={engagementChartRef}
                csvData={engagementChartData}
                filename={`engagement-comparison-${brandName}-vs-${competitorName}`}
              />
            </div>
          }
        >
          {sectionLoading.lcs ? (
            <ChartSkeleton height={320} />
          ) : (
            <>
              <div ref={engagementChartRef}>
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={engagementChartData}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="month" {...axisProps} />
                  <YAxis
                    {...axisProps}
                    tickFormatter={(v) =>
                      v >= 1000000
                        ? `${(v / 1000000).toFixed(1)}M`
                        : v >= 1000
                          ? `${(v / 1000).toFixed(0)}K`
                          : v
                    }
                  />
                  <Tooltip
                    content={<CustomTooltip />}
                    cursor={{ fill: "rgba(255,255,255,0.03)" }}
                  />
                  <Legend
                    content={
                      <ToggleLegend
                        hidden={engagementToggle.hidden}
                        onToggle={engagementToggle.toggle}
                      />
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="brandLikes"
                    name={`${brandName} Likes`}
                    stroke="#3b82f6"
                    strokeWidth={2.5}
                    fill="transparent"
                    dot={false}
                    hide={engagementToggle.hidden.has("brandLikes")}
                  />
                  <Area
                    type="monotone"
                    dataKey="competitorLikes"
                    name={`${competitorName} Likes`}
                    stroke="#2dd4bf"
                    strokeWidth={2.5}
                    fill="transparent"
                    dot={false}
                    strokeDasharray="6 3"
                    hide={engagementToggle.hidden.has("competitorLikes")}
                  />
                  <Area
                    type="monotone"
                    dataKey="brandComments"
                    name={`${brandName} Comments`}
                    stroke="#facc15"
                    strokeWidth={2}
                    fill="transparent"
                    dot={false}
                    strokeDasharray="6 3"
                    hide={engagementToggle.hidden.has("brandComments")}
                  />
                  <Area
                    type="monotone"
                    dataKey="competitorComments"
                    name={`${competitorName} Comments`}
                    stroke="#ef4444"
                    strokeWidth={2}
                    fill="transparent"
                    dot={false}
                    hide={engagementToggle.hidden.has("competitorComments")}
                  />
                  <Area
                    type="monotone"
                    dataKey="brandShares"
                    name={`${brandName} Shares`}
                    stroke="#a855f7"
                    strokeWidth={2}
                    fill="transparent"
                    dot={false}
                    strokeDasharray="6 3"
                    hide={engagementToggle.hidden.has("brandShares")}
                  />
                  <Area
                    type="monotone"
                    dataKey="competitorShares"
                    name={`${competitorName} Shares`}
                    stroke="#1e3a5f"
                    strokeWidth={2}
                    fill="transparent"
                    dot={false}
                    hide={engagementToggle.hidden.has("competitorShares")}
                  />
                </AreaChart>
              </ResponsiveContainer>
              </div>
              <div className="flex justify-center gap-8 mt-4 pt-4 border-t border-white/5">
                <div className="flex items-center gap-2 text-sm">
                  <ThumbsUp size={14} className="text-blue-400" />
                  <span className="text-white/50">Likes</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <MessageCircle size={14} className="text-yellow-400" />
                  <span className="text-white/50">Comments</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Share2 size={14} className="text-purple-400" />
                  <span className="text-white/50">Shares</span>
                </div>
              </div>
            </>
          )}
        </SectionCard>

        {/* ── Creative Insights (CTA + Headlines) — hidden if both empty (Laravel match) */}
        {(sectionLoading.frequent ||
          sectionLoading.topAds ||
          hasCreativeInsights) && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <BarChart3 size={18} className="text-[#6b99ff]" /> Creative
                Insights
              </h2>
              <InfoTooltip text="This section compares your brand with its competitors, highlighting the most popular ads along with their call-to-actions, headlines, and visuals." />
            </div>

            {/* CTA Trends — hidden if both brand & competitor have no CTAs */}
            {(sectionLoading.frequent || hasAnyCta) && (
              <>
                <p className="text-sm text-[#6b99ff] font-semibold mb-3">
                  CTA Trends
                </p>
                {sectionLoading.frequent ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <SectionCard title={`CTA of ${competitorName}`}>
                      <ChartSkeleton />
                    </SectionCard>
                    <SectionCard title={`CTA of ${brandName}`}>
                      <ChartSkeleton />
                    </SectionCard>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    {/* Competitor CTA */}
                    <SectionCard title={`CTA of ${competitorName}`}>
                      {competitorCta.ctaTypes.length === 0 ? (
                        <p className="text-white/30 text-sm text-center py-8">
                          No call to action found
                        </p>
                      ) : (
                        <ResponsiveContainer width="100%" height={240}>
                          <BarChart data={competitorCta.chartData}>
                            <CartesianGrid {...gridProps} />
                            <XAxis dataKey="month" {...axisProps} />
                            <YAxis
                              {...axisProps}
                              label={{
                                value: "Count",
                                angle: -90,
                                position: "insideLeft",
                                fill: "#64748b",
                                fontSize: 11,
                              }}
                            />
                            <Tooltip
                              content={<CustomTooltip />}
                              cursor={{ fill: "rgba(255,255,255,0.03)" }}
                            />
                            <Legend
                              content={
                                <ToggleLegend
                                  hidden={compCtaToggle.hidden}
                                  onToggle={compCtaToggle.toggle}
                                />
                              }
                            />
                            {competitorCta.ctaTypes.map((cta, i) => (
                              <Bar
                                key={cta}
                                dataKey={cta}
                                fill={CTA_COLORS[i % CTA_COLORS.length]}
                                radius={[3, 3, 0, 0]}
                                hide={compCtaToggle.hidden.has(cta)}
                              />
                            ))}
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </SectionCard>

                    {/* Brand CTA */}
                    <SectionCard title={`CTA of ${brandName}`}>
                      {brandCta.ctaTypes.length === 0 ? (
                        <p className="text-white/30 text-sm text-center py-8">
                          No call to action found
                        </p>
                      ) : (
                        <ResponsiveContainer width="100%" height={240}>
                          <BarChart data={brandCta.chartData}>
                            <CartesianGrid {...gridProps} />
                            <XAxis dataKey="month" {...axisProps} />
                            <YAxis
                              {...axisProps}
                              label={{
                                value: "Count",
                                angle: -90,
                                position: "insideLeft",
                                fill: "#64748b",
                                fontSize: 11,
                              }}
                            />
                            <Tooltip
                              content={<CustomTooltip />}
                              cursor={{ fill: "rgba(255,255,255,0.03)" }}
                            />
                            <Legend
                              content={
                                <ToggleLegend
                                  hidden={brandCtaToggle.hidden}
                                  onToggle={brandCtaToggle.toggle}
                                />
                              }
                            />
                            {brandCta.ctaTypes.map((cta, i) => (
                              <Bar
                                key={cta}
                                dataKey={cta}
                                fill={CTA_COLORS[i % CTA_COLORS.length]}
                                radius={[3, 3, 0, 0]}
                                hide={brandCtaToggle.hidden.has(cta)}
                              />
                            ))}
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </SectionCard>
                  </div>
                )}
              </>
            )}

            {/* Top Headlines — hidden if both brand & competitor have no headlines */}
            {(sectionLoading.topAds || hasAnyHeadlines) && (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <p className="text-sm text-[#6b99ff] font-semibold">
                    Top Headlines
                  </p>
                  <InfoTooltip text="In this section, we will showcase the headline elements from the most popular ads of your brand and competitors." />
                </div>
                <SectionCard className="mb-6">
                  {sectionLoading.topAds ? (
                    <ChartSkeleton height={100} />
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <p className="text-xs text-white/50 font-semibold mb-2">
                          Heading of {competitorName}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {competitorHeadlines.length === 0 ? (
                            <span className="text-white/30 text-sm">
                              No heading found
                            </span>
                          ) : (
                            competitorHeadlines.map((h, i) => (
                              <span
                                key={i}
                                className="px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-sm text-white/70 hover:border-[#3759a3]/30 hover:text-white transition-colors cursor-default"
                              >
                                {h}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                      <div className="pt-3 border-t border-white/5">
                        <p className="text-xs text-white/50 font-semibold mb-2">
                          Heading of {brandName}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {brandHeadlines.length === 0 ? (
                            <span className="text-white/30 text-sm">
                              No heading found
                            </span>
                          ) : (
                            brandHeadlines.map((h, i) => (
                              <span
                                key={i}
                                className="px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-sm text-white/70 hover:border-orange-500/30 hover:text-white transition-colors cursor-default"
                              >
                                {h}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </SectionCard>
              </>
            )}
          </div>
        )}

        {/* ── Creative Style Examples — hidden if both sides have no images (Laravel match) */}
        {(sectionLoading.topAds || hasAnyImages) && (
          <div>
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Image size={18} className="text-pink-400" /> Creative Style
              Examples
            </h2>
            {sectionLoading.topAds ? (
              <ChartSkeleton height={200} />
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-white/50 font-semibold mb-3">
                    Creative images of {competitorName}
                  </p>
                  {competitorImages.length === 0 ? (
                    <p className="text-white/30 text-sm">No image found</p>
                  ) : (
                    <div className="flex gap-3 overflow-x-auto pb-2 custom-scrollbar">
                      {competitorImages.map((src, i) => (
                        <div
                          key={i}
                          className="flex-shrink-0 w-48 h-48 rounded-xl border border-white/10 overflow-hidden bg-white/5"
                        >
                          <img
                            src={src}
                            alt={`Competitor creative ${i + 1}`}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs text-white/50 font-semibold mb-3">
                    Creative images of {brandName}
                  </p>
                  {brandImages.length === 0 ? (
                    <p className="text-white/30 text-sm">No image found</p>
                  ) : (
                    <div className="flex gap-3 overflow-x-auto pb-2 custom-scrollbar">
                      {brandImages.map((src, i) => (
                        <div
                          key={i}
                          className="flex-shrink-0 w-48 h-48 rounded-xl border border-white/10 overflow-hidden bg-white/5"
                        >
                          <img
                            src={src}
                            alt={`Brand creative ${i + 1}`}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CompetitorComparison;
