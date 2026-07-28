import React, { useId, useLayoutEffect, useMemo, useRef } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Globe2,
  HelpCircle,
  ExternalLink,
  Link2,
  Monitor,
  TrendingUp,
} from "lucide-react";
import * as am5 from "@amcharts/amcharts5";
import * as am5map from "@amcharts/amcharts5/map";
import am5geodata_worldLow from "@amcharts/amcharts5-geodata/worldLow";
import am5themes_Dark from "@amcharts/amcharts5/themes/Dark";
import { COUNTRY_NAMES } from "../../../utils/countries";

const EMPTY = "--";

const finiteNumber = (value) => {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const compactNumber = (value) => {
  const number = finiteNumber(value);
  if (number == null) return EMPTY;
  return new Intl.NumberFormat("en", {
    notation: Math.abs(number) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(number);
};

export const formatTransparencyRange = (range) => {
  if (!range || typeof range !== "object") return EMPTY;
  const min = finiteNumber(range.min);
  const max = finiteNumber(range.max);
  const operator = String(range.operator || "").toLowerCase();
  if (operator === "over" && min != null) return `${compactNumber(min)}+`;
  if (operator === "under" && max != null) return `Up to ${compactNumber(max)}`;
  if (min != null && max != null) return `${compactNumber(min)} – ${compactNumber(max)}`;
  if (min != null) return `${compactNumber(min)}+`;
  if (max != null) return `Up to ${compactNumber(max)}`;
  return EMPTY;
};

export const getOperatorMeaning = (range) => {
  const operator = String(range?.operator || "").toLowerCase();
  if (operator === "range") return "Bounded range";
  if (operator === "over") return "Minimum threshold · continues above";
  if (operator === "under") return "Maximum threshold · up to";
  return "Estimate";
};

const toTimestamp = (value) => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
};

const formatDate = (value) => {
  const timestamp = typeof value === "number" ? value : toTimestamp(value);
  if (timestamp == null) return EMPTY;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp));
};

const formatMonth = (timestamp) => new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
}).format(new Date(timestamp));

const normalizeCountries = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const resolveTransparencyCountryName = (country, countryCode) => {
  const rawCountry = String(country || "").trim();
  const normalizedCode = String(countryCode || "").trim().toUpperCase();
  const countryAsCode = /^[A-Z]{2}$/i.test(rawCountry)
    ? rawCountry.toUpperCase()
    : "";

  if (rawCountry && !countryAsCode) return rawCountry;
  return COUNTRY_NAMES[normalizedCode || countryAsCode] || rawCountry || normalizedCode || EMPTY;
};

const hasRangeValue = (range) =>
  range &&
  typeof range === "object" &&
  (finiteNumber(range.min) != null || finiteNumber(range.max) != null);

const InfoTip = ({ text, isLight, align = "right" }) => (
  <span className="group/info relative inline-flex shrink-0">
    <button
      type="button"
      aria-label="Explain this metric"
      className={`rounded-full p-0.5 transition-colors ${
        isLight
          ? "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          : "text-white/30 hover:bg-white/10 hover:text-white/75"
      }`}
    >
      <HelpCircle size={13} />
    </button>
    <span
      role="tooltip"
      className={`pointer-events-none absolute top-full z-[100] mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg border px-3 py-2 text-left text-[11px] font-medium normal-case leading-relaxed tracking-normal opacity-0 shadow-xl transition-opacity group-hover/info:opacity-100 group-focus-within/info:opacity-100 ${
        align === "left" ? "left-0" : "right-0"
      } ${
        isLight
          ? "border-slate-200 bg-slate-900 text-white"
          : "border-white/15 bg-black text-white/85"
      }`}
    >
      {text}
    </span>
  </span>
);

const SummaryCard = ({
  icon: Icon,
  label,
  value,
  isLight,
  accent,
  caption,
  help,
  helpAlign = "left",
}) => (
  <div className={`rounded-xl border p-3 ${
    isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.035]"
  }`}>
    <div className="mb-2 flex items-center justify-between">
      <span className="flex items-center gap-1.5">
        <span className={`text-[10px] font-bold uppercase tracking-[0.14em] ${
          isLight ? "text-slate-500" : "text-white/45"
        }`}>
          {label}
        </span>
        <InfoTip text={help} isLight={isLight} align={helpAlign} />
      </span>
      <span className={`grid h-7 w-7 place-items-center rounded-lg ${accent}`}>
        <Icon size={14} />
      </span>
    </div>
    <div className={`text-base font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
      {value || EMPTY}
    </div>
    {caption ? (
      <div className={`mt-1 text-[10px] ${isLight ? "text-slate-400" : "text-white/35"}`}>
        {caption}
      </div>
    ) : null}
  </div>
);

const ChartPanel = ({ title, description, help, isLight, children }) => (
  <div className={`rounded-xl border ${
    isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.035]"
  }`}>
    <div className={`border-b px-5 py-4 ${isLight ? "border-slate-100" : "border-white/10"}`}>
      <div className="flex items-center gap-1.5">
        <h4 className={`text-sm font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
          {title}
        </h4>
        <InfoTip isLight={isLight} align="left" text={help} />
      </div>
      <p className={`mt-1 text-[11px] ${isLight ? "text-slate-500" : "text-white/40"}`}>
        {description}
      </p>
    </div>
    {children}
  </div>
);

const PlainRangeValue = ({ range, isLight }) => {
  const min = finiteNumber(range?.min);
  const max = finiteNumber(range?.max);
  const operator = String(range?.operator || "").toLowerCase();
  const muted = isLight ? "text-slate-400" : "text-white/35";
  const value = isLight ? "text-slate-900" : "text-white";

  if (operator === "over" && min != null) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className={`text-[9px] font-bold uppercase tracking-wider ${muted}`}>At least</div>
          <div className={`mt-1 text-2xl font-black ${value}`}>{compactNumber(min)}</div>
        </div>
        <ArrowRight size={18} className="text-violet-500" />
        <div className={`rounded-lg border border-dashed px-3 py-2 text-[11px] font-semibold ${
          isLight ? "border-slate-300 bg-slate-50 text-slate-500" : "border-white/15 bg-white/5 text-white/45"
        }`}>
          No upper limit reported
        </div>
      </div>
    );
  }

  if (operator === "under" && max != null) {
    return (
      <div>
        <div className={`text-[9px] font-bold uppercase tracking-wider ${muted}`}>Up to</div>
        <div className={`mt-1 text-2xl font-black ${value}`}>{compactNumber(max)}</div>
      </div>
    );
  }

  if (min != null && max != null) {
    return (
      <div className="flex items-center gap-4">
        <div>
          <div className={`text-[9px] font-bold uppercase tracking-wider ${muted}`}>From</div>
          <div className={`mt-1 text-xl font-black ${value}`}>{compactNumber(min)}</div>
        </div>
        <ArrowRight size={18} className="text-violet-500" />
        <div>
          <div className={`text-[9px] font-bold uppercase tracking-wider ${muted}`}>To</div>
          <div className={`mt-1 text-xl font-black ${value}`}>{compactNumber(max)}</div>
        </div>
      </div>
    );
  }

  return <span className={`text-lg font-bold ${muted}`}>{EMPTY}</span>;
};

const SimpleRangeSummary = ({ rows, isLight }) => {
  const overall = rows.find((row) => row.isOverall);
  const countries = rows.filter((row) => !row.isOverall);
  return (
    <div className="p-5">
      {overall ? <div className={`mb-4 rounded-xl border p-5 ${
        isLight
          ? "border-violet-200 bg-gradient-to-r from-violet-50 to-blue-50"
          : "border-violet-400/20 bg-gradient-to-r from-violet-500/10 to-blue-500/10"
      }`}>
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-violet-500/15 text-violet-500">
            <TrendingUp size={16} />
          </span>
          <div>
            <div className={`text-xs font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
              Overall estimated impressions
            </div>
            <div className={`text-[10px] ${isLight ? "text-slate-500" : "text-white/40"}`}>
              Google reports an estimate, not an exact total
            </div>
          </div>
        </div>
        <PlainRangeValue range={overall?.range} isLight={isLight} />
      </div> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {countries.length ? countries.map((row, index) => (
          <div
            key={`${row.label}-${index}`}
            className={`rounded-xl border p-4 ${
              isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.025]"
            }`}
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <div>
                <span className={`text-sm font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                  {row.label}
                </span>
              </div>
              <InfoTip
                isLight={isLight}
                text={`Google estimates that this ad appeared ${formatTransparencyRange(row.range)} times in ${row.label}.`}
              />
            </div>
            <PlainRangeValue range={row.range} isLight={isLight} />
          </div>
        )) : (
          <div className={`py-8 text-center text-xs ${isLight ? "text-slate-400" : "text-white/35"}`}>
            Country impression estimates are not available.
          </div>
        )}
      </div>
    </div>
  );
};

const GanttTimeline = ({ countries, isLight }) => {
  const rows = countries.filter((item) =>
    item.firstTimestamp != null &&
    item.lastTimestamp != null &&
    item.lastTimestamp >= item.firstTimestamp
  );
  if (!rows.length) {
    return <div className="p-10 text-center text-xs text-slate-400">No complete observation windows available.</div>;
  }
  const start = Math.min(...rows.map((item) => item.firstTimestamp));
  const end = Math.max(...rows.map((item) => item.lastTimestamp));
  const span = Math.max(86400000, end - start);
  const width = 920;
  const left = 150;
  const right = 110;
  const top = 36;
  const rowHeight = 54;
  const bottom = 46;
  const plotWidth = width - left - right;
  const height = top + rows.length * rowHeight + bottom;
  const x = (timestamp) => left + ((timestamp - start) / span) * plotWidth;
  const ticks = Array.from({ length: 5 }, (_, i) => start + (span * i) / 4);
  const grid = isLight ? "#e2e8f0" : "rgba(255,255,255,.09)";
  const text = isLight ? "#475569" : "rgba(255,255,255,.65)";

  return (
    <div className="overflow-x-auto p-4">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-[720px] w-full"
        role="img"
        aria-label="Country first shown and last shown timeline"
      >
        <defs>
          <linearGradient id="gt-time" x1="0" x2="1">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
        </defs>
        {ticks.map((tick, index) => {
          const tickX = x(tick);
          return (
            <g key={index}>
              <line x1={tickX} y1={top - 10} x2={tickX} y2={height - bottom + 4} stroke={grid} />
              <text x={tickX} y={height - 15} textAnchor="middle" fill={text} fontSize="10">
                {formatMonth(tick)}
              </text>
            </g>
          );
        })}
        {rows.map((item, index) => {
          const y = top + index * rowHeight + 18;
          const startX = x(item.firstTimestamp);
          const endX = x(item.lastTimestamp);
          const duration = Math.max(1, Math.floor((item.lastTimestamp - item.firstTimestamp) / 86400000) + 1);
          return (
            <g key={item.key}>
              <title>{`${item.country}: ${formatDate(item.firstTimestamp)} to ${formatDate(item.lastTimestamp)} (${duration} days observed)`}</title>
              <text x={left - 14} y={y + 4} textAnchor="end" fill={text} fontSize="12" fontWeight="700">
                {item.country || EMPTY}
              </text>
              <line x1={startX} y1={y} x2={endX} y2={y} stroke="url(#gt-time)" strokeWidth="14" strokeLinecap="round" />
              <circle cx={startX} cy={y} r="5" fill="#fbbf24" stroke="white" strokeWidth="2" />
              <circle cx={endX} cy={y} r="5" fill="#f97316" stroke="white" strokeWidth="2" />
              <text x={width - 8} y={y + 4} textAnchor="end" fill={text} fontSize="11" fontWeight="700">
                {duration} days
              </text>
            </g>
          );
        })}
        <text x={left} y={height - 1} textAnchor="start" fill={text} opacity=".65" fontSize="9">
          ● First shown
        </text>
        <text x={left + 82} y={height - 1} textAnchor="start" fill={text} opacity=".65" fontSize="9">
          ● Last shown
        </text>
      </svg>
    </div>
  );
};

const CountryActivitySummary = ({ countries, isLight }) => {
  const rows = countries.filter((item) =>
    item.firstTimestamp != null &&
    item.lastTimestamp != null &&
    item.lastTimestamp >= item.firstTimestamp
  );

  if (!rows.length) {
    return <div className="p-10 text-center text-xs text-slate-400">No complete observation windows available.</div>;
  }

  return (
    <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((item) => {
        const duration = Math.max(
          1,
          Math.floor((item.lastTimestamp - item.firstTimestamp) / 86400000) + 1,
        );
        return (
          <div
            key={item.key}
            className={`rounded-xl border p-4 ${
              isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.025]"
            }`}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <span className={`text-sm font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                  {item.country || EMPTY}
                </span>
              </div>
              <InfoTip
                isLight={isLight}
                text={`The first and last dates Google reported this ad in ${item.country}.`}
              />
            </div>

            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className={`text-[9px] font-bold uppercase tracking-wider ${
                  isLight ? "text-slate-400" : "text-white/35"
                }`}>
                  First shown
                </div>
                <div className={`mt-1 text-sm font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                  {formatDate(item.firstTimestamp)}
                </div>
              </div>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-500/10 text-amber-500">
                <ArrowRight size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-[9px] font-bold uppercase tracking-wider ${
                  isLight ? "text-slate-400" : "text-white/35"
                }`}>
                  Last shown
                </div>
                <div className={`mt-1 text-sm font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                  {formatDate(item.lastTimestamp)}
                </div>
              </div>
            </div>

            <div className={`mt-4 flex items-center justify-between rounded-lg px-3 py-2 ${
              isLight ? "bg-amber-50" : "bg-amber-500/10"
            }`}>
              <span className={`text-[10px] font-semibold ${
                isLight ? "text-slate-500" : "text-white/50"
              }`}>
                Active for
              </span>
              <span className="text-sm font-black text-amber-600">
                {duration} {duration === 1 ? "day" : "days"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const TransparencyChoropleth = ({ countries, isLight }) => {
  const mapRootRef = useRef(null);
  const mapId = `gt-map-${useId().replace(/:/g, "")}`;

  const mapData = useMemo(() => countries
    .filter((item) => /^[A-Z]{2}$/i.test(String(item.country_code || "")))
    .map((item) => {
      const min = finiteNumber(item.times_shown?.min);
      const max = finiteNumber(item.times_shown?.max);
      return {
        id: String(item.country_code).toUpperCase(),
        name: item.countryName,
        intensity: Math.max(1, min ?? max ?? 1),
        rangeLabel: formatTransparencyRange(item.times_shown),
      };
    }), [countries]);

  useLayoutEffect(() => {
    // amCharts uses a canvas renderer. JSDOM intentionally has no canvas
    // context; keep the semantic map container testable without starting the
    // renderer in that environment.
    if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) return undefined;
    if (mapRootRef.current) mapRootRef.current.dispose();
    const root = am5.Root.new(mapId);
    mapRootRef.current = root;
    if (!isLight) root.setThemes([am5themes_Dark.new(root)]);
    root._logo?.dispose();

    const chart = root.container.children.push(am5map.MapChart.new(root, {
      projection: am5map.geoNaturalEarth1(),
      panX: "translateX",
      panY: "none",
      wheelY: "zoom",
    }));
    const series = chart.series.push(am5map.MapPolygonSeries.new(root, {
      geoJSON: am5geodata_worldLow,
      exclude: ["AQ"],
    }));
    const byIso = Object.fromEntries(mapData.map((item) => [item.id, item]));
    const logs = mapData.map((item) => Math.log10(item.intensity));
    const low = logs.length ? Math.min(...logs) : 0;
    const high = logs.length ? Math.max(...logs) : 1;
    const colorFor = (value) => {
      const t = high === low ? 1 : (Math.log10(value) - low) / (high - low);
      const r = Math.round(167 - t * 91);
      const g = Math.round(139 - t * 110);
      const b = Math.round(250 - t * 101);
      return (r << 16) | (g << 8) | b;
    };
    series.mapPolygons.template.setAll({
      fill: am5.color(isLight ? 0xe2e8f0 : 0x2a2f3b),
      stroke: am5.color(isLight ? 0xffffff : 0x3f4655),
      strokeWidth: 0.6,
      interactive: true,
      tooltipText: "{name}",
    });
    series.mapPolygons.template.adapters.add("fill", (fill, target) => {
      const item = byIso[target.dataItem?.dataContext?.id];
      return item ? am5.color(colorFor(item.intensity)) : fill;
    });
    series.mapPolygons.template.adapters.add("tooltipText", (text, target) => {
      const context = target.dataItem?.dataContext;
      const item = byIso[context?.id];
      return item
        ? `[bold]${item.name}[/]\nTimes shown: ${item.rangeLabel}\nColor basis: ${compactNumber(item.intensity)} minimum/baseline`
        : context?.name || "";
    });
    chart.set("zoomControl", am5map.ZoomControl.new(root, {}));
    return () => root.dispose();
  }, [mapId, mapData, isLight]);

  return (
    <div className="relative">
      <div id={mapId} className="h-[360px] w-full" />
      <div className={`absolute bottom-3 left-4 rounded-lg border px-3 py-2 text-[9px] ${
        isLight ? "border-slate-200 bg-white/90 text-slate-500" : "border-white/10 bg-black/70 text-white/50"
      }`}>
        <div className="mb-1 h-1.5 w-28 rounded-full bg-gradient-to-r from-violet-300 via-violet-500 to-violet-900" />
        Minimum reported times shown · low → high
      </div>
    </div>
  );
};

const TransparencyDelivery = ({
  isLight,
  subnetwork,
  impressions,
  countryDetails,
  firstSeen,
  lastSeen,
  lastShown,
  adType,
  source,
  language,
  adUrl,
  destinationUrl,
  redirectUrl,
}) => {
  const countries = useMemo(
    () => normalizeCountries(countryDetails).map((item, index) => {
      const countryName = resolveTransparencyCountryName(item?.country, item?.country_code);
      return {
        ...item,
        country: countryName,
        countryName,
        key: `${item?.country_code || countryName || "country"}-${index}`,
        firstTimestamp: toTimestamp(item?.first_seen),
        lastTimestamp: toTimestamp(item?.last_seen),
      };
    }).filter((item) => item.countryName !== EMPTY),
    [countryDetails],
  );
  const countryFirstShownPoints = countries
    .map((item) => item.firstTimestamp)
    .filter((value) => value != null);
  const countryLastShownPoints = countries
    .map((item) => item.lastTimestamp)
    .filter((value) => value != null);
  // Country delivery rows are Google's authoritative shown window. Aggregate
  // every country instead of mixing them with PowerAdSpy's top-level seen date.
  const effectiveStart = countryFirstShownPoints.length
    ? Math.min(...countryFirstShownPoints)
    : toTimestamp(firstSeen);
  const effectiveEnd = countryLastShownPoints.length
    ? Math.max(...countryLastShownPoints)
    : toTimestamp(lastShown) ?? toTimestamp(lastSeen);
  const activityWindow = effectiveStart != null && effectiveEnd != null
    ? `${formatDate(effectiveStart)} – ${formatDate(effectiveEnd)}`
    : effectiveStart != null
      ? `From ${formatDate(effectiveStart)}`
      : effectiveEnd != null
        ? `Until ${formatDate(effectiveEnd)}`
        : EMPTY;
  const rangeRows = [
    ...(hasRangeValue(impressions) ? [{
      label: "Overall",
      code: "",
      range: impressions,
      isOverall: true,
    }] : []),
    ...countries.map((item) => ({
      label: item.country || EMPTY,
      code: item.country_code ? String(item.country_code).toUpperCase() : "",
      range: item.times_shown,
    })).filter((item) => hasRangeValue(item.range)),
  ];
  const activityCountries = countries.filter((item) =>
    item.firstTimestamp != null &&
    item.lastTimestamp != null &&
    item.lastTimestamp >= item.firstTimestamp
  );
  const intensityCountries = countries.filter((item) =>
    /^[A-Z]{2}$/i.test(String(item.country_code || "")) &&
    hasRangeValue(item.times_shown)
  );
  const platformValue = subnetwork ? String(subnetwork).toUpperCase() : null;
  const impressionValue = hasRangeValue(impressions)
    ? formatTransparencyRange(impressions)
    : null;
  const lastSeenValue = toTimestamp(lastSeen) != null ? formatDate(lastSeen) : null;
  // `last_shown` is its own producer field. A country row's last_seen describes
  // country activity and must not be relabelled as Last Shown.
  const lastShownTimestamp = toTimestamp(lastShown);
  const lastShownValue = lastShownTimestamp != null ? formatDate(lastShownTimestamp) : null;
  const adTypeValue = adType ? String(adType).toUpperCase() : null;
  const sourceValue = source ? String(source) : null;
  const summaryCards = [
    ...(platformValue ? [{
      icon: Monitor,
      label: "Platform",
      value: platformValue,
      accent: "bg-blue-500/10 text-blue-500",
      help: "Where this ad appeared on Google, such as Search or YouTube.",
    }] : []),
    ...(adTypeValue ? [{
      icon: BarChart3,
      label: "Ad Type",
      value: adTypeValue,
      accent: "bg-pink-500/10 text-pink-500",
      help: "The creative format reported by Google.",
    }] : []),
    ...(sourceValue ? [{
      icon: ExternalLink,
      label: "Source",
      value: sourceValue,
      accent: "bg-cyan-500/10 text-cyan-500",
      help: "Where this ad record was collected.",
    }] : []),
    ...(lastSeenValue ? [{
      icon: Activity,
      label: "Last Seen",
      value: lastSeenValue,
      accent: "bg-emerald-500/10 text-emerald-500",
      help: "The most recent date PowerAdSpy found this ad.",
    }] : []),
    ...(lastShownValue ? [{
      icon: CalendarDays,
      label: "Last Shown",
      value: lastShownValue,
      accent: "bg-orange-500/10 text-orange-500",
      help: "The most recent date Google Ads Transparency reports this ad was shown.",
    }] : []),
    ...(impressionValue ? [{
      icon: Activity,
      label: "Impressions",
      value: impressionValue,
      caption: getOperatorMeaning(impressions),
      accent: "bg-violet-500/10 text-violet-500",
      help: "Google reports an estimated range, not an exact number.",
    }] : []),
    ...(countries.length ? [{
      icon: Globe2,
      label: "Countries",
      value: String(countries.length),
      caption: "With delivery details",
      accent: "bg-emerald-500/10 text-emerald-500",
      help: "Countries where Google reported this ad.",
    }] : []),
    ...(language ? [{
      icon: Globe2,
      label: "Language",
      value: String(language),
      accent: "bg-indigo-500/10 text-indigo-500",
      help: "Detected language, when translation detection returned a value.",
    }] : []),
    ...(activityWindow !== EMPTY ? [{
      icon: CalendarDays,
      label: "Activity Window",
      value: activityWindow,
      caption: "Across all reported countries",
      accent: "bg-amber-500/10 text-amber-500",
      help: "Uses the earliest first shown and latest last shown across every reported country.",
    }] : []),
  ];
  const availableLinks = [
    { label: "Ad URL", value: adUrl },
    { label: "Destination URL", value: destinationUrl },
    { label: "Redirect URL", value: redirectUrl },
  ].filter((item) => typeof item.value === "string" && item.value.trim());

  return (
    <section className={`rounded-2xl border ${
      isLight ? "border-slate-200 bg-slate-50/70" : "border-white/10 bg-[#151b2b]"
    }`}>
      <div className={`border-b px-6 py-5 ${isLight ? "border-slate-200" : "border-white/10"}`}>
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-500/15 text-violet-500">
            <BarChart3 size={18} />
          </span>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className={`text-sm font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                Transparency Ad Details
              </h3>
              <InfoTip
                isLight={isLight}
                align="left"
                text="Shows where, when, and approximately how often this ad appeared."
              />
            </div>
            <p className={`mt-0.5 text-xs ${isLight ? "text-slate-500" : "text-white/45"}`}>
              Geographic, temporal, and ranged delivery analysis
            </p>
          </div>
        </div>
      </div>

      {summaryCards.length ? (
        <div className="grid grid-cols-2 gap-2.5 px-6 py-5 md:grid-cols-3 xl:grid-cols-5">
          {summaryCards.map((card) => (
            <SummaryCard key={card.label} {...card} isLight={isLight} />
          ))}
        </div>
      ) : null}

      <div className="space-y-4 px-6 pb-6">
        {availableLinks.length ? (
          <div className={`rounded-xl border ${
            isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.035]"
          }`}>
            {availableLinks.map((item, index) => (
              <div
                key={item.label}
                className={`flex items-center gap-3 px-4 py-3 ${
                  index < availableLinks.length - 1
                    ? isLight ? "border-b border-slate-100" : "border-b border-white/10"
                    : ""
                }`}
              >
                <Link2 size={14} className="shrink-0 text-violet-500" />
                <span className={`w-32 shrink-0 text-[10px] font-bold uppercase tracking-wider ${
                  isLight ? "text-slate-500" : "text-white/45"
                }`}>
                  {item.label}
                </span>
                <a
                  href={item.value}
                  target="_blank"
                  rel="noreferrer"
                  className={`min-w-0 flex-1 truncate text-sm font-semibold ${
                    isLight ? "text-slate-800 hover:text-violet-600" : "text-white/80 hover:text-violet-300"
                  }`}
                >
                  {item.value}
                </a>
                <ExternalLink size={14} className="shrink-0 text-slate-400" />
              </div>
            ))}
          </div>
        ) : null}
        {rangeRows.length ? <ChartPanel
          isLight={isLight}
          title="Estimated impressions"
          description="Plain-language ranges for the overall ad and each country."
          help="From–To is a range. At least has no reported upper limit. Up to is the reported maximum."
        >
          <SimpleRangeSummary rows={rangeRows} isLight={isLight} />
        </ChartPanel> : null}

        {activityCountries.length ? <ChartPanel
          isLight={isLight}
          title="Country activity"
          description="First shown, last shown, and active duration for every country."
          help="Shows when the ad was first and last reported as shown in each country."
        >
          <CountryActivitySummary countries={activityCountries} isLight={isLight} />
        </ChartPanel> : null}

        {intensityCountries.length ? <ChartPanel
          isLight={isLight}
          title="Geographic delivery intensity"
          description="Countries with more reported views appear darker."
          help="Darker countries have a higher reported minimum. Hover a country to see its range."
        >
          <TransparencyChoropleth countries={intensityCountries} isLight={isLight} />
        </ChartPanel> : null}
      </div>
    </section>
  );
};

export default TransparencyDelivery;
