import React, { useId, useLayoutEffect, useMemo, useRef } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Globe2,
  HelpCircle,
  Monitor,
  TrendingUp,
} from "lucide-react";
import * as am5 from "@amcharts/amcharts5";
import * as am5map from "@amcharts/amcharts5/map";
import am5geodata_worldLow from "@amcharts/amcharts5-geodata/worldLow";
import am5themes_Dark from "@amcharts/amcharts5/themes/Dark";

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
      className={`pointer-events-none absolute top-full z-50 mt-2 w-72 rounded-lg border px-3 py-2 text-left text-[11px] font-medium normal-case leading-relaxed tracking-normal opacity-0 shadow-xl transition-opacity group-hover/info:opacity-100 group-focus-within/info:opacity-100 ${
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

const SummaryCard = ({ icon: Icon, label, value, isLight, accent, caption, help }) => (
  <div className={`rounded-xl border p-4 ${
    isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.035]"
  }`}>
    <div className="mb-3 flex items-center justify-between">
      <span className="flex items-center gap-1.5">
        <span className={`text-[10px] font-bold uppercase tracking-[0.14em] ${
          isLight ? "text-slate-500" : "text-white/45"
        }`}>
          {label}
        </span>
        <InfoTip text={help} isLight={isLight} align="left" />
      </span>
      <span className={`grid h-8 w-8 place-items-center rounded-lg ${accent}`}>
        <Icon size={15} />
      </span>
    </div>
    <div className={`text-lg font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
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
  const overall = rows[0];
  const countries = rows.slice(1);
  return (
    <div className="p-5">
      <div className={`mb-4 rounded-xl border p-5 ${
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
      </div>

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
                {row.code ? (
                  <span className={`ml-2 text-[9px] font-bold ${isLight ? "text-slate-400" : "text-white/30"}`}>
                    {row.code}
                  </span>
                ) : null}
              </div>
              <InfoTip
                isLight={isLight}
                text={`Source: country_details[].times_shown for ${row.label}. Google reported ${formatTransparencyRange(row.range)} (${getOperatorMeaning(row.range).toLowerCase()}).`}
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
        aria-label="Country first seen and last seen Gantt chart"
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
          ● First seen
        </text>
        <text x={left + 82} y={height - 1} textAnchor="start" fill={text} opacity=".65" fontSize="9">
          ● Last seen
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
                {item.country_code ? (
                  <span className={`ml-2 text-[9px] font-bold ${
                    isLight ? "text-slate-400" : "text-white/30"
                  }`}>
                    {item.country_code}
                  </span>
                ) : null}
              </div>
              <InfoTip
                isLight={isLight}
                text={`Source: country_details first_seen and last_seen for ${item.country}. Active duration includes both reported dates.`}
              />
            </div>

            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className={`text-[9px] font-bold uppercase tracking-wider ${
                  isLight ? "text-slate-400" : "text-white/35"
                }`}>
                  First seen
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
                  Last seen
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
        name: item.country || item.country_code,
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
}) => {
  const countries = useMemo(
    () => normalizeCountries(countryDetails).map((item, index) => ({
      ...item,
      key: `${item?.country_code || item?.country || "country"}-${index}`,
      firstTimestamp: toTimestamp(item?.first_seen),
      lastTimestamp: toTimestamp(item?.last_seen),
    })),
    [countryDetails],
  );
  const datedPoints = countries
    .flatMap((item) => [item.firstTimestamp, item.lastTimestamp])
    .filter((value) => value != null);
  const timelineStart = datedPoints.length ? Math.min(...datedPoints) : null;
  const timelineEnd = datedPoints.length ? Math.max(...datedPoints) : null;
  const effectiveStart = toTimestamp(firstSeen) ?? timelineStart;
  const effectiveEnd = toTimestamp(lastSeen) ?? timelineEnd;
  const activityWindow = effectiveStart != null && effectiveEnd != null
    ? `${formatDate(effectiveStart)} – ${formatDate(effectiveEnd)}`
    : effectiveStart != null
      ? `From ${formatDate(effectiveStart)}`
      : effectiveEnd != null
        ? `Until ${formatDate(effectiveEnd)}`
        : EMPTY;
  const rangeRows = [
    { label: "Overall", code: "", range: impressions },
    ...countries.map((item) => ({
      label: item.country || EMPTY,
      code: item.country_code ? String(item.country_code).toUpperCase() : "",
      range: item.times_shown,
    })),
  ];

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
                Transparency Delivery
              </h3>
              <InfoTip
                isLight={isLight}
                align="left"
                text="These charts use the platform-18 impressions and country_details fields supplied by Google Ads Transparency. Ranges remain estimates and are never converted into exact counts."
              />
            </div>
            <p className={`mt-0.5 text-xs ${isLight ? "text-slate-500" : "text-white/45"}`}>
              Geographic, temporal, and ranged delivery analysis
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 px-6 py-5 lg:grid-cols-4">
        <SummaryCard
          icon={Monitor}
          label="Platform"
          value={subnetwork ? String(subnetwork).toUpperCase() : EMPTY}
          isLight={isLight}
          accent="bg-blue-500/10 text-blue-500"
          help="Source: subnetwork. It identifies where Google reported the creative, such as SEARCH or SHOPPING."
        />
        <SummaryCard
          icon={Activity}
          label="Impressions"
          value={formatTransparencyRange(impressions)}
          caption={getOperatorMeaning(impressions)}
          isLight={isLight}
          accent="bg-violet-500/10 text-violet-500"
          help="Source: impressions. range is bounded, over is open above its minimum, and under is capped by its maximum."
        />
        <SummaryCard
          icon={Globe2}
          label="Countries"
          value={countries.length ? String(countries.length) : EMPTY}
          caption="With delivery details"
          isLight={isLight}
          accent="bg-emerald-500/10 text-emerald-500"
          help="Number of country_details entries supplied for this ad."
        />
        <SummaryCard
          icon={CalendarDays}
          label="Activity Window"
          value={activityWindow}
          caption="Ad dates, then country-date fallback"
          isLight={isLight}
          accent="bg-amber-500/10 text-amber-500"
          help="Top-level first_seen/last_seen are preferred. Missing endpoints fall back to the earliest/latest country observation dates."
        />
      </div>

      <div className="space-y-4 px-6 pb-6">
        <ChartPanel
          isLight={isLight}
          title="Estimated impressions"
          description="Plain-language ranges for the overall ad and each country."
          help="From/To means Google supplied a bounded range. At least means operator=over and Google did not report an upper limit. Up to means operator=under."
        >
          <SimpleRangeSummary rows={rangeRows} isLight={isLight} />
        </ChartPanel>

        <ChartPanel
          isLight={isLight}
          title="Country activity"
          description="First seen, last seen, and active duration for every country."
          help="Dates come from country_details.first_seen and country_details.last_seen. Active duration counts both the first and last reported day."
        >
          <CountryActivitySummary countries={countries} isLight={isLight} />
        </ChartPanel>

        <ChartPanel
          isLight={isLight}
          title="Geographic delivery intensity"
          description="Choropleth shaded by the logarithm of each country's minimum reported times shown."
          help="country_code places the value on the map. Darker violet means a higher minimum/baseline. Hover a highlighted country for its exact reported range."
        >
          <TransparencyChoropleth countries={countries} isLight={isLight} />
        </ChartPanel>
      </div>
    </section>
  );
};

export default TransparencyDelivery;
