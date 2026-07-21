import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { TrendingUp, Download, Globe2, Search, X, Plus, LayoutGrid, Calendar, ChevronDown, Info, MoreVertical, ChevronLeft, ChevronRight, Sparkles, Lock } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import { getAuthToken } from '../hooks/useAuth';
import fbIcon from '../assets/fb.png';
import igIcon from '../assets/ig.png';
import gIcon from '../assets/g.png';
import ytIcon from '../assets/yt.png';
import liIcon from '../assets/linkedin.png';
import natIcon from '../assets/native.png';
import rdIcon from '../assets/rd.png';
import quoraIcon from '../assets/quora.png';
import pinIcon from '../assets/pinterest.png';
import gdnIcon from '../assets/gdn.png';
import tiktokIcon from '../assets/tiktoklogo.jpg';
import { SkeletonChartLine, SkeletonBarChart, SkeletonTableRows, FadeIn, ErrorRetry } from './shared/Skeleton';

/**
 * Market Trends — Google-Trends-style Explore/Compare for ad data (single file).
 *
 * Two comparison axes: search TERMS (advertisers — up to 5, coloured lines) and
 * NETWORKS (chips that filter every panel). Country dropdown filters everything.
 * Interest chart supports raw counts or a 0–100 index. All on real ad data.
 * Full doc: MARKET_TRENDS_MANIFEST.md.  props.onDrill(kind,value) → Ads Library.
 */

// ─── API ──────────────────────────────────────────────────────────────────
const BASE = `${import.meta.env.VITE_PAS_API_BASE_URL || ''}/api/v1/intelligence`;
const token = () => getAuthToken() || import.meta.env.VITE_PAS_API_TOKEN;
async function apiGet(path, params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') qs.append(k, v); });
  const res = await fetch(`${BASE}${path}${qs.toString() ? `?${qs}` : ''}`, {
    headers: { ...(token() ? { Authorization: `Bearer ${token()}` } : {}) },
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}
// Returns { enabled, stage, networks } — stage is "beta" or "ga" (see marketTrends.js /
// docs/PLAN_ACCESS.md § "Market Trends beta→GA"). enabled=false at GA for a
// lower tier is expected — the caller shows a locked preview, not a hard hide.
// networks is this plan's Market Trends-specific network list (admin's dedicated
// "Market Trends Networks" override, falling back to Platform Access) — null
// while unresolved, in which case the caller should treat every network as
// available rather than locking everything out.
export async function fetchMarketTrendsAccess() {
  try {
    const r = await apiGet('/access');
    return { enabled: !!r?.data?.enabled, stage: r?.data?.stage || 'beta', networks: r?.data?.networks ?? null };
  } catch {
    return { enabled: false, stage: 'beta', networks: null };
  }
}

// ─── CSV ────────────────────────────────────────────────────────────────────
function downloadCsv(filename, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── constants ──────────────────────────────────────────────────────────────
const CHIP_NETWORKS = ['facebook', 'instagram', 'google', 'youtube', 'linkedin', 'native', 'reddit', 'quora', 'pinterest', 'gdn', 'tiktok'];
const NET_COLOR = {
  facebook: '#3b82f6', instagram: '#ec4899', google: '#f59e0b', youtube: '#ef4444', linkedin: '#0ea5e9',
  native: '#14b8a6', reddit: '#f97316', quora: '#8b5cf6', pinterest: '#e11d48', gdn: '#a855f7', tiktok: '#22d3ee',
};
const NET_LABEL = {
  facebook: 'Facebook', instagram: 'Instagram', google: 'Google', youtube: 'YouTube', linkedin: 'LinkedIn',
  native: 'Native', reddit: 'Reddit', quora: 'Quora', pinterest: 'Pinterest', gdn: 'GDN', tiktok: 'TikTok',
};
const NET_ICON = {
  facebook: fbIcon, instagram: igIcon, google: gIcon, youtube: ytIcon, linkedin: liIcon,
  native: natIcon, reddit: rdIcon, quora: quoraIcon, pinterest: pinIcon, gdn: gdnIcon, tiktok: tiktokIcon,
};
const TERM_COLORS = ['#4285F4', '#DB4437', '#0F9D58', '#F4B400', '#AB47BC'];
const TOP_TYPES = [{ v: 'advertiser', label: 'Advertisers' }, { v: 'cta', label: 'CTAs' }];
const shortLabel = (v) => (typeof v === 'string' && v.length > 18 ? `${v.slice(0, 17)}…` : v);

// Per-panel "which advertiser" toggle — shown on each panel in compare-mode so
// it's clear (right there) whose data the chart shows. Controls a shared active
// advertiser, so all panels stay in sync. Renders nothing when not comparing.
function AdvScope({ terms, activeTerm, onPick }) {
  if (!terms.length) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] text-white/50">Show:</span>
      <button onClick={() => onPick('')}
        className={`text-[10px] rounded-full px-2.5 py-0.5 border transition-colors ${!activeTerm ? 'bg-[#335296] text-white border-transparent' : 'border-theme-border text-white/60 hover:border-white/30'}`}>All</button>
      {terms.map((t, i) => (
        <button key={t} onClick={() => onPick(t)}
          className={`flex items-center gap-1 text-[10px] rounded-full px-2.5 py-0.5 border transition-colors ${activeTerm === t ? 'text-white border-transparent' : 'border-theme-border text-white/60 hover:border-white/30'}`}
          style={activeTerm === t ? { backgroundColor: TERM_COLORS[i % TERM_COLORS.length] } : undefined}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: TERM_COLORS[i % TERM_COLORS.length] }} />{t}
        </button>
      ))}
    </div>
  );
}

// Info (i) with a proper styled hover tooltip (replaces the native `title`, which
// showed a help-cursor "?" and an unstyled browser bubble).
function InfoTip({ text }) {
  if (!text) return null;
  return (
    <span className="relative inline-flex group align-middle shrink-0">
      <Info size={12} className="text-white/40 hover:text-white/80 cursor-pointer" />
      <span className="pointer-events-none absolute left-0 top-5 z-50 w-64 max-w-[75vw] rounded-lg border border-theme-border bg-theme-card px-2.5 py-2 text-[10.5px] leading-snug text-white/80 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100 whitespace-normal font-normal normal-case tracking-normal">
        {text}
      </span>
    </span>
  );
}

// Shimmer visibility, synced EXACTLY to `loading` on the way in — no delay —
// so it's on-screen the instant a fetch starts, in the same render that
// clears the panel's data. That's required: this component clears each
// panel's data immediately when a fetch starts (so a stale result can never
// linger under a new selection — see the fetch effects below), which means
// there is no valid "old content" to keep showing while loading is true. An
// earlier version delayed showing the shimmer by 150ms to avoid flashing it
// on very fast responses — but that just left an empty ~150ms gap where the
// panel had no data AND no shimmer, rendering "No data for this window" on
// every load faster than 150ms (which is most local/dev responses). Once
// shown, still holds for a minimum `minDuration` ms so a load that finishes
// in a few ms doesn't flicker the shimmer on and off — that's the only thing
// actually worth delaying.
function useMinDisplay(loading, minDuration = 300) {
  const [holding, setHolding] = useState(false);
  const shownAtRef = useRef(null);
  useEffect(() => {
    if (loading) {
      shownAtRef.current = Date.now();
      return;
    }
    if (shownAtRef.current == null) return; // wasn't actually showing — nothing to hold
    const elapsed = Date.now() - shownAtRef.current;
    shownAtRef.current = null;
    if (elapsed >= minDuration) return;
    setHolding(true);
    const t = setTimeout(() => setHolding(false), minDuration - elapsed);
    return () => clearTimeout(t);
  }, [loading, minDuration]);
  return loading || holding;
}

// A one-line, data-driven observation shown under a chart to make it easy to read.
const Insight = ({ children }) => (children ? (
  <p className="text-[11px] text-white/70 bg-white/[0.03] border border-theme-border rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
    <Sparkles size={12} className="mt-[1px] text-emerald-400 shrink-0" /><span>{children}</span>
  </p>
) : null);

// Widget-accurate skeleton, real content, or an error+retry state — never all
// three, and never a stuck shimmer. `skeleton` is the widget-shaped placeholder
// (SkeletonChartLine / SkeletonBarChart / SkeletonTableRows) for THIS panel
// specifically — chosen per call site so a line chart skeletons as a line
// chart, not a generic grey box. Title/subtitle/legend stay visible while
// loading; only the plot area swaps.
function Panel({ title, subtitle, info, right, note, scope, className = '', loading, error, onRetry, skeleton, children }) {
  return (
    <div className={`p-3.5 rounded-xl border border-theme-border bg-theme-bg flex flex-col gap-2.5 min-w-0 ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[13px] font-medium text-white flex items-center gap-1.5">
            {title}<InfoTip text={info} />
          </span>
          {subtitle && <span className="text-[10.5px] text-white/50 block mt-0.5 leading-snug">{subtitle}</span>}
        </div>
        {right}
      </div>
      {scope}
      {loading ? skeleton : error ? <ErrorRetry message="Couldn't load this panel." onRetry={onRetry} /> : <FadeIn>{children}</FadeIn>}
      {!loading && !error && note && <Insight>{note}</Insight>}
    </div>
  );
}
const Empty = ({ msg }) => <div className="py-12 text-center text-[11px] text-white/60 px-3">{msg || 'No data for this window.'}</div>;

// Google-Trends-style ranked table: rank · label · inline micro-bar · change · ⋮.
// Paginates 10 rows; header carries an (i) tooltip + export; rows drill on click.
const TABLE_PAGE = 10;
function TrendTable({ title, subtitle, info, columnLabel, valueLabel, rows, color, onRowClick, onCompare, onExport, note, right, scope, emptyMsg, loading, error, onRetry }) {
  const [page, setPage] = useState(0);
  const [menu, setMenu] = useState(null);
  useEffect(() => { setPage(0); }, [rows]);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value) || 0));
  const totalPages = Math.max(1, Math.ceil(rows.length / TABLE_PAGE));
  const start = page * TABLE_PAGE;
  const pageRows = rows.slice(start, start + TABLE_PAGE);
  return (
    <div className="p-3.5 rounded-xl border border-theme-border bg-theme-bg flex flex-col gap-2 min-w-0 relative">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[13px] font-medium text-white flex items-center gap-1.5">
            {title}<InfoTip text={info} />
          </span>
          {subtitle && <span className="text-[10.5px] text-white/50 block mt-0.5">{subtitle}</span>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {right}
          {onExport && <button onClick={onExport} title="Export" className="text-white/50 hover:text-white p-1"><Download size={14} /></button>}
        </div>
      </div>
      {scope}
      {loading ? <SkeletonTableRows rows={6} /> : error ? <ErrorRetry message="Couldn't load this table." onRetry={onRetry} /> : rows.length ? (
        <FadeIn>
          <div className="flex items-center gap-2 text-[9px] uppercase tracking-wide text-white/40 pt-1">
            <span className="w-4" />
            <span className="flex-1">{columnLabel || 'Query'}</span>
            <span className="w-[96px] hidden sm:block">{valueLabel || 'Search interest'}</span>
            <span className="w-16 text-right">Change</span>
            <span className="w-5" />
          </div>
          <div className="flex flex-col">
            {pageRows.map((r, i) => {
              const idx = start + i;
              const up = (r.change ?? 0) >= 0;
              return (
                <div key={r.id || r.label} className="flex items-center gap-2 py-[7px] border-b border-theme-border/60 last:border-0">
                  <span className="w-4 text-[11px] text-white/40 tabular-nums text-right">{idx + 1}</span>
                  <button onClick={() => onRowClick(r)} className="flex-1 min-w-0 text-left text-[12px] text-white truncate hover:underline" title={r.label}>{r.label}</button>
                  <div className="w-[96px] hidden sm:block">
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(4, (Math.abs(r.value) / max) * 100)}%`, backgroundColor: color }} />
                    </div>
                  </div>
                  <span className={`w-16 text-right text-[11px] tabular-nums ${up ? 'text-emerald-400' : 'text-red-400'}`}>
                    {up ? '↑' : '↓'} {up ? '+' : ''}{r.change ?? 0}%
                  </span>
                  <div className="relative w-5">
                    <button onClick={() => setMenu(menu === idx ? null : idx)} className="text-white/30 hover:text-white p-0.5"><MoreVertical size={13} /></button>
                    {menu === idx && (
                      <div className="absolute right-0 top-6 z-30 bg-theme-card border border-theme-border rounded-lg shadow-xl py-1 w-40 text-[11px]">
                        <button onClick={() => { setMenu(null); onRowClick(r); }} className="block w-full text-left px-3 py-1.5 hover:bg-white/5 text-white">Open in Ads Library</button>
                        {onCompare && <button onClick={() => { setMenu(null); onCompare(r); }} className="block w-full text-left px-3 py-1.5 hover:bg-white/5 text-white">+ Compare</button>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {note && <Insight>{note}</Insight>}
          <div className="flex items-center justify-end gap-3 pt-1 text-[10px] text-white/50">
            <span className="tabular-nums">{start + 1}–{Math.min(start + TABLE_PAGE, rows.length)} of {rows.length}</span>
            <div className="flex items-center gap-1">
              <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="p-1 disabled:opacity-30 hover:text-white"><ChevronLeft size={14} /></button>
              <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} className="p-1 disabled:opacity-30 hover:text-white"><ChevronRight size={14} /></button>
            </div>
          </div>
        </FadeIn>
      ) : <Empty msg={emptyMsg} />}
      {/* click-away to close the row menu */}
      {menu !== null && <div className="fixed inset-0 z-20" onClick={() => setMenu(null)} />}
    </div>
  );
}

// Date filter — presets + a react-day-picker range calendar (no ad-type tabs).
const toYMD = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const DATE_PRESETS = [['All time', 365], ['Last 7 days', 7], ['Last 30 days', 30], ['Last 90 days', 90]];
function DateRangePicker({ days, from, to, onPreset, onRange, onClear }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(undefined);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  useEffect(() => { setSel(from && to ? { from: new Date(from), to: new Date(to) } : undefined); }, [from, to]);
  const label = (days === 'custom' && from && to) ? `${from} → ${to}` : (days >= 365 ? 'All time' : `Last ${days} days`);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs bg-theme-bg border border-theme-border rounded-lg px-3 py-1.5 text-white h-fit">
        <Calendar size={13} /> {label} <ChevronDown size={12} className="opacity-70" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 z-50 bg-theme-card border border-theme-border rounded-xl shadow-2xl p-3 flex gap-3 text-white">
          <div className="flex flex-col gap-1 min-w-[118px]">
            {DATE_PRESETS.map(([lbl, d]) => (
              <button key={d} onClick={() => { onPreset(d); setSel(undefined); setOpen(false); }}
                className={`text-left text-xs px-3 py-2 rounded-md transition-colors ${days === d ? 'bg-[#335296] text-white' : 'text-white/70 hover:bg-white/5'}`}>{lbl}</button>
            ))}
          </div>
          <div className="border-l border-theme-border pl-3 mt-rdp">
            <style>{`
              .mt-rdp .rdp-root { --rdp-accent-color: #335296; margin: 0; }
              .mt-rdp .rdp-day_button { color: currentColor; font-size: 12px; }
              .mt-rdp .rdp-day_button:hover:not([disabled]) { background: rgba(127,127,127,0.18); border-radius: 6px; }
              .mt-rdp .rdp-selected .rdp-day_button,
              .mt-rdp .rdp-range_start .rdp-day_button,
              .mt-rdp .rdp-range_end .rdp-day_button { background: #335296 !important; color: #fff !important; border-radius: 6px; }
              .mt-rdp .rdp-range_middle { background: rgba(51,82,150,0.25); }
              .mt-rdp .rdp-weekday { color: currentColor; opacity: 0.6; font-size: 11px; }
              .mt-rdp .rdp-caption_label, .mt-rdp .rdp-dropdown { color: currentColor; background: transparent; font-size: 12px; }
              .mt-rdp .rdp-chevron { fill: currentColor; }
              .mt-rdp .rdp-day.rdp-disabled { opacity: 0.3; }
            `}</style>
            <DayPicker mode="range" selected={sel} onSelect={setSel} captionLayout="dropdown"
              defaultMonth={sel?.from || new Date()} disabled={{ after: new Date() }} />
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-theme-border mt-1">
              <span className="text-[11px] text-white/60">{sel?.from && sel?.to ? `${toYMD(sel.from)} → ${toYMD(sel.to)}` : 'Pick start & end'}</span>
              <div className="flex gap-2">
                <button onClick={() => { setSel(undefined); onClear(); setOpen(false); }}
                  className="text-[11px] text-white/70 border border-theme-border rounded-md px-3 py-1 hover:text-white">Clear</button>
                <button disabled={!sel?.from || !sel?.to} onClick={() => { onRange(toYMD(sel.from), toYMD(sel.to)); setOpen(false); }}
                  className="text-[11px] bg-[#335296] text-white rounded-md px-3 py-1 disabled:opacity-40">Apply</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const MarketTrends = ({ onDrill, allowedPlatforms, onNetworkRestricted }) => {
  // Networks this account's PLAN actually includes (admin-configured per plan, same
  // req.planAccess.allowedPlatforms every other gated feature reads) — Market Trends
  // previously ignored this entirely and always offered all 11 networks regardless
  // of plan. Falls back to every network only while allowedPlatforms hasn't loaded
  // yet (undefined) — an empty array (a real "no networks" plan) is respected as-is.
  const AVAILABLE_NETWORKS = useMemo(
    () => (allowedPlatforms ? CHIP_NETWORKS.filter((n) => allowedPlatforms.includes(n)) : CHIP_NETWORKS),
    [allowedPlatforms]
  );

  const [days, setDays] = useState(30);
  const [from, setFrom] = useState(''); // custom range (YYYY-MM-DD)
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState(AVAILABLE_NETWORKS); // network filter (chips)
  // Re-sync once the plan's real allowedPlatforms arrives (it's fetched async in
  // App.jsx, so it's usually undefined on first render here).
  useEffect(() => { setSelected(AVAILABLE_NETWORKS); }, [AVAILABLE_NETWORKS]);
  const [indexed, setIndexed] = useState(true);
  const [topType, setTopType] = useState('advertiser');
  const [country, setCountry] = useState('');
  const [countryOpts, setCountryOpts] = useState([]);

  // Compared search terms (advertisers) — GT-style, up to 5.
  const [termInput, setTermInput] = useState('');
  const [terms, setTerms] = useState([]);
  const [termData, setTermData] = useState({}); // term -> { networks, series }

  const [overview, setOverview] = useState(null);
  const [regions, setRegions] = useState(null);
  const [categories, setCategories] = useState([]);
  const [catUnsupported, setCatUnsupported] = useState(false);
  const [risingCats, setRisingCats] = useState([]);
  const [risingUnsupported, setRisingUnsupported] = useState(false);
  const [top, setTop] = useState([]);
  const [topUnsupported, setTopUnsupported] = useState(false);
  const [keywords, setKeywords] = useState([]);
  const [kwUnsupported, setKwUnsupported] = useState(false);
  const [metaNet, setMetaNet] = useState('All networks');
  const [drillItem, setDrillItem] = useState(null);

  // Per-panel fetch failure — previously every fetch's `.catch(() => null)`
  // swallowed the error into an empty result, indistinguishable from a
  // genuinely-empty window. Each panel now shows a real "Retry" affordance on
  // failure instead of a silent/misleading Empty state. `xRetry` is a pure
  // trigger counter — bumping it re-runs that panel's effect with no other
  // state change.
  const [overviewError, setOverviewError] = useState(false);
  const [termError, setTermError] = useState(false);
  const [regionsError, setRegionsError] = useState(false);
  const [categoriesError, setCategoriesError] = useState(false);
  const [risingError, setRisingError] = useState(false);
  const [topError, setTopError] = useState(false);
  const [kwError, setKwError] = useState(false);
  const [overviewRetry, setOverviewRetry] = useState(0);
  const [termRetry, setTermRetry] = useState(0);
  const [regionsRetry, setRegionsRetry] = useState(0);
  const [categoriesRetry, setCategoriesRetry] = useState(0);
  const [risingRetry, setRisingRetry] = useState(0);
  const [topRetry, setTopRetry] = useState(0);
  const [kwRetry, setKwRetry] = useState(0);

  // Per-panel advertiser scope (compare-mode). Each card's "Show" toggle is
  // INDEPENDENT — '' = all compared advertisers merged, else just that one.
  const [regionsScope, setRegionsScope] = useState('');
  const [catScope, setCatScope] = useState('');
  const [risingScope, setRisingScope] = useState('');
  const [topScope, setTopScope] = useState('');
  const [kwScope, setKwScope] = useState('');

  // Each panel loads independently — its own shimmer skeleton, not a page-wide dim.
  // (Previously a single shared `pending` counter dimmed the ENTIRE page to opacity-60
  // on ANY of the 6 independent fetches — switching country, say, re-dimmed panels
  // that hadn't actually changed.)
  const [termLoading, setTermLoading] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [regionsLoading, setRegionsLoading] = useState(true);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [risingLoading, setRisingLoading] = useState(true);
  const [topLoading, setTopLoading] = useState(true);
  const [kwLoading, setKwLoading] = useState(true);
  const loading = overviewLoading || regionsLoading || categoriesLoading || risingLoading || topLoading || kwLoading;
  // Actual values passed to the panels — see useMinDisplay above. Shows the
  // instant loading starts (never an empty gap), holds a minimum stable
  // duration once shown so a very fast load doesn't flicker.
  const overviewShimmer = useMinDisplay(overviewLoading || termLoading);
  const regionsShimmer = useMinDisplay(regionsLoading);
  const categoriesShimmer = useMinDisplay(categoriesLoading);
  const risingShimmer = useMinDisplay(risingLoading);
  const topShimmer = useMinDisplay(topLoading);
  const kwShimmer = useMinDisplay(kwLoading);

  // Chips double as a filter: all (of the plan's allowed) chips → 'all'; otherwise a
  // CSV the backend honors. The backend also independently clamps this to the plan's
  // allowedPlatforms (restrictNetworkToPlan in marketTrends.js) — this is just keeping
  // the UI's own "is everything selected" notion in sync with what's actually offered.
  const netParam = selected.length === AVAILABLE_NETWORKS.length ? 'all' : (selected.join(',') || 'all');
  const dpOf = () => ((days === 'custom' && from && to) ? { from, to } : { days });
  const advOf = (scope) => scope || terms.join(','); // panel scope, else all compared advertisers

  // Interest overview — no advertiser scope (the chart shows every term as its own line).
  useEffect(() => {
    let alive = true;
    setOverviewLoading(true);
    setOverviewError(false);
    setOverview(null); // clear immediately so a stale response can never linger under a new selection
    apiGet('/trends/overview', { ...dpOf(), network: 'all', country })
      .then((ov) => { if (alive) { setOverview(ov?.data || null); setOverviewLoading(false); } })
      .catch(() => { if (alive) { setOverviewError(true); setOverviewLoading(false); } });
    return () => { alive = false; };
  }, [days, from, to, country, overviewRetry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ads by country (own scope).
  useEffect(() => {
    let alive = true;
    setRegionsLoading(true);
    setRegionsError(false);
    setRegions(null);
    apiGet('/trends/regions', { ...dpOf(), network: netParam, advertiser: advOf(regionsScope) })
      .then((rg) => {
        if (!alive) return;
        setRegions(rg?.data || null);
        // Names are normalised server-side (ISO codes → country names); dedupe +
        // sort so the filter list has no duplicates and reads cleanly.
        if (rg?.data?.items?.length) setCountryOpts([...new Set(rg.data.items.map((c) => c.country).filter(Boolean))].sort((a, b) => a.localeCompare(b)));
        setRegionsLoading(false);
      })
      .catch(() => { if (alive) { setRegionsError(true); setRegionsLoading(false); } });
    return () => { alive = false; };
  }, [days, from, to, netParam, regionsScope, terms, regionsRetry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ads per category (own scope).
  useEffect(() => {
    let alive = true;
    setCategoriesLoading(true);
    setCategoriesError(false);
    setCategories([]);
    apiGet('/trends/categories', { ...dpOf(), network: netParam, size: 12, country, advertiser: advOf(catScope) })
      .then((cat) => { if (!alive) return; setCategories(cat?.data?.items || []); setCatUnsupported(!!cat?.meta?.unsupported); setMetaNet(cat?.data?.network || 'All networks'); setCategoriesLoading(false); })
      .catch(() => { if (alive) { setCategoriesError(true); setCategoriesLoading(false); } });
    return () => { alive = false; };
  }, [days, from, to, netParam, country, catScope, terms, categoriesRetry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rising categories (own scope — separate fetch so it can differ from Ads per category).
  useEffect(() => {
    let alive = true;
    setRisingLoading(true);
    setRisingError(false);
    setRisingCats([]);
    apiGet('/trends/categories', { ...dpOf(), network: netParam, size: 20, country, advertiser: advOf(risingScope) })
      .then((cat) => { if (!alive) return; setRisingCats(cat?.data?.items || []); setRisingUnsupported(!!cat?.meta?.unsupported); setRisingLoading(false); })
      .catch(() => { if (alive) { setRisingError(true); setRisingLoading(false); } });
    return () => { alive = false; };
  }, [days, from, to, netParam, country, risingScope, terms, risingRetry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Top movers (own scope).
  useEffect(() => {
    let alive = true;
    setTopLoading(true);
    setTopError(false);
    setTop([]);
    apiGet('/trends/top', { ...dpOf(), type: topType, network: netParam, size: 12, country, advertiser: advOf(topScope) })
      .then((tp) => { if (!alive) return; setTop(tp?.data?.items || []); setTopUnsupported(!!tp?.meta?.unsupported); setTopLoading(false); })
      .catch(() => { if (alive) { setTopError(true); setTopLoading(false); } });
    return () => { alive = false; };
  }, [days, from, to, netParam, country, topType, topScope, terms, topRetry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Top keywords (own scope).
  useEffect(() => {
    let alive = true;
    setKwLoading(true);
    setKwError(false);
    setKeywords([]);
    apiGet('/trends/keywords', { ...dpOf(), network: netParam, size: 12, country, advertiser: advOf(kwScope) })
      .then((kw) => { if (!alive) return; setKeywords(kw?.data?.items || []); setKwUnsupported(!!kw?.meta?.unsupported); setKwLoading(false); })
      .catch(() => { if (alive) { setKwError(true); setKwLoading(false); } });
    return () => { alive = false; };
  }, [days, from, to, netParam, country, kwScope, terms, kwRetry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drop any panel scope that's no longer among the compared terms.
  useEffect(() => {
    const fix = (s) => (s && !terms.includes(s) ? '' : s);
    setRegionsScope(fix); setCatScope(fix); setRisingScope(fix); setTopScope(fix); setKwScope(fix);
  }, [terms]);

  // Fetch each compared term's per-network trend.
  useEffect(() => {
    if (!terms.length) { setTermData({}); setTermLoading(false); setTermError(false); return; }
    const dp = (days === 'custom' && from && to) ? { from, to } : { days };
    let alive = true;
    setTermLoading(true);
    setTermError(false);
    setTermData({}); // clear immediately — a stale term's data must never linger under a new network selection
    // Each term is caught individually — one bad advertiser name shouldn't blank
    // out the others. The 3rd tuple element distinguishes a genuine fetch
    // failure from a legitimately-empty response, so termError only fires when
    // EVERY term's request actually failed — not when the terms simply have no
    // matching ads (that's a real, valid Empty state, not an error).
    Promise.all(terms.map((t) => apiGet('/trends/search', { q: t, ...dp, network: netParam, country })
      .then((r) => [t, r?.data, false]).catch(() => [t, null, true])))
      .then((triples) => {
        if (!alive) return;
        const m = {}; triples.forEach(([t, d]) => { if (d) m[t] = d; }); setTermData(m);
        setTermError(triples.every(([, , failed]) => failed));
        setTermLoading(false);
      });
    return () => { alive = false; };
  }, [terms, days, from, to, netParam, country, termRetry]);

  const termMode = terms.length > 0;
  const allNets = overview?.networks || [];
  const shown = selected.filter((n) => allNets.includes(n)); // selected AND has data

  // Chart keys/labels/colors depend on the mode (compare terms vs compare networks).
  const chartKeys = termMode ? terms : shown;
  const keyColor = (k) => termMode ? TERM_COLORS[terms.indexOf(k) % TERM_COLORS.length] : (NET_COLOR[k] || '#888');
  const keyLabel = (k) => termMode ? k : (NET_LABEL[k] || k);

  // Chart data: term-mode sums each term over the selected networks per day;
  // network-mode uses the per-network overview. Either way, indexed → 0–100 of
  // each series' own peak (so wildly different volumes stay comparable/visible).
  const chartData = useMemo(() => {
    let series;
    if (termMode) {
      const byDate = {};
      terms.forEach((t) => {
        (termData[t]?.series || []).forEach((r) => {
          const sum = shown.length ? shown.reduce((s, n) => s + (r[n] || 0), 0) : r.total || 0;
          (byDate[r.date] = byDate[r.date] || {})[t] = sum;
        });
      });
      series = Object.keys(byDate).sort().map((date) => ({ date, ...Object.fromEntries(terms.map((t) => [t, byDate[date]?.[t] || 0])) }));
    } else {
      series = overview?.series || [];
    }
    if (!indexed) return series;
    const maxByKey = {};
    for (const k of chartKeys) { let m = 0; for (const r of series) m = Math.max(m, r[k] || 0); maxByKey[k] = m || 1; }
    return series.map((r) => { const o = { date: r.date }; for (const k of chartKeys) o[k] = Math.round(((r[k] || 0) / maxByKey[k]) * 100); return o; });
  }, [termMode, terms, termData, shown, overview, indexed, chartKeys]);

  // ── Stacked-chart data (per network) ──
  const countryNets = useMemo(() => {
    const set = new Set();
    (regions?.items || []).forEach((c) => Object.keys(c.byNet || {}).forEach((n) => set.add(n)));
    return CHIP_NETWORKS.filter((n) => set.has(n));
  }, [regions]);
  const countryData = useMemo(() => (regions?.items || []).slice(0, 12).map((c) => ({ country: c.country, ...(c.byNet || {}) })), [regions]);
  const catNets = useMemo(() => {
    const set = new Set();
    categories.forEach((c) => Object.keys(c.byNet || {}).forEach((n) => set.add(n)));
    return CHIP_NETWORKS.filter((n) => set.has(n));
  }, [categories]);
  const catData = useMemo(() => categories.map((c) => ({ category: c.category, ...(c.byNet || {}) })), [categories]);

  // ── Google-Trends table rows (top movers / rising categories) ──
  const topRows = useMemo(() => top.map((t) => ({ id: t.id || t.label, label: t.label, value: t.count, change: t.growthPct ?? 0, net: t.net })), [top]);
  const risingRows = useMemo(() => [...risingCats].sort((a, b) => b.growthPct - a.growthPct)
    .map((c) => ({ id: c.category, label: c.category, value: c.current, change: c.growthPct, net: c.net })), [risingCats]);

  // ── Dynamic one-line observations (computed from raw data, not the chart) ──
  const netTotals = useMemo(() => {
    const t = {};
    (overview?.series || []).forEach((r) => shown.forEach((n) => { t[n] = (t[n] || 0) + (r[n] || 0); }));
    return t;
  }, [overview, shown]);
  const termTotals = useMemo(() => {
    const t = {};
    terms.forEach((term) => {
      let s = 0;
      (termData[term]?.series || []).forEach((r) => { s += shown.length ? shown.reduce((a, n) => a + (r[n] || 0), 0) : (r.total || 0); });
      t[term] = s;
    });
    return t;
  }, [terms, termData, shown]);
  const num = (n) => Number(n || 0).toLocaleString();
  const interestNote = useMemo(() => {
    if (termMode) {
      const e = Object.entries(termTotals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      if (!e.length) return '';
      const [t0, v0] = e[0];
      if (e.length > 1 && e[1][1] > 0) {
        const ratio = v0 / e[1][1];
        return `“${t0}” is the busiest advertiser here with ${num(v0)} ads${ratio >= 1.1 ? ` — about ${ratio.toFixed(1)}× “${e[1][0]}” (${num(e[1][1])})` : `, just ahead of “${e[1][0]}” (${num(e[1][1])})`}.`;
      }
      return `“${t0}” ran ${num(v0)} ads across the selected networks in this window.`;
    }
    const e = Object.entries(netTotals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (!e.length) return '';
    const grand = e.reduce((s, [, v]) => s + v, 0);
    const share = grand ? Math.round((e[0][1] / grand) * 100) : 0;
    const second = e[1] ? `, followed by ${NET_LABEL[e[1][0]] || e[1][0]} (${num(e[1][1])})` : '';
    return `${NET_LABEL[e[0][0]] || e[0][0]} runs the most ads — ${num(e[0][1])} (${share}% of ${num(grand)} across ${e.length} network${e.length > 1 ? 's' : ''})${second}.`;
  }, [termMode, termTotals, netTotals]);
  const countryNote = useMemo(() => {
    const items = regions?.items || [];
    if (!items.length) return '';
    const total = regions.total || items.reduce((s, i) => s + i.count, 0);
    const share = total ? Math.round((items[0].count / total) * 100) : 0;
    const second = items[1] ? `, then ${items[1].country} (${num(items[1].count)})` : '';
    return `${items[0].country} is the biggest market — ${share}% of ads (${num(items[0].count)})${second}; ${items.length}+ countries seen.`;
  }, [regions]);
  const catNote = useMemo(() => {
    if (!categories.length) return '';
    const t = categories[0];
    const n = Object.keys(t.byNet || {}).length;
    const second = categories[1] ? `, then “${categories[1].category}” (${num(categories[1].current)})` : '';
    return `“${t.category}” is the most-advertised category — ${num(t.current)} ads${n > 1 ? ` spread across ${n} networks` : ''}${second}.`;
  }, [categories]);
  const topNote = useMemo(() => {
    if (!top.length) return '';
    const leader = top[0];
    const riser = [...top].sort((a, b) => (b.growthPct ?? 0) - (a.growthPct ?? 0))[0];
    const kind = topType === 'cta' ? 'CTA' : 'advertiser';
    const g = leader.growthPct ?? 0;
    let s = `“${leader.label}” is the top ${kind} with ${num(leader.count)} ads (${g >= 0 ? '+' : ''}${g}% vs the prior period)`;
    if (riser && riser.label !== leader.label && (riser.growthPct ?? 0) > 0) s += `; “${riser.label}” is scaling fastest at +${riser.growthPct}%`;
    return `${s}.`;
  }, [top, topType]);
  const risingNote = useMemo(() => {
    if (!risingCats.length) return '';
    const sorted = [...risingCats].sort((a, b) => b.growthPct - a.growthPct);
    const r = sorted[0];
    const second = sorted[1] ? `; “${sorted[1].category}” follows (+${sorted[1].growthPct}%)` : '';
    return `“${r.category}” is growing fastest — +${r.growthPct}% vs the previous period (${num(r.current)} ads now)${second}.`;
  }, [risingCats]);
  const kwNote = useMemo(() => {
    if (!keywords.length) return '';
    const k = keywords[0];
    const second = keywords[1] ? `, ahead of “${keywords[1].keyword}” (${num(keywords[1].count)})` : '';
    return `“${k.keyword}” is the most-targeted search keyword — ${num(k.count)} ads${second}.`;
  }, [keywords]);

  const addTerm = () => {
    const t = termInput.trim();
    if (t && !terms.includes(t) && terms.length < 5) setTerms((p) => [...p, t]);
    setTermInput('');
  };
  const removeTerm = (t) => setTerms((p) => p.filter((x) => x !== t));
  const isAllNets = selected.length === AVAILABLE_NETWORKS.length;
  const selectAll = () => setSelected(AVAILABLE_NETWORKS);
  // From "All" a click solos that network; after that clicks toggle (multi-select, min 1).
  // A network the plan doesn't include stays visible (never hidden — "not a hard
  // removal", same principle as LockedFeaturePreview) but clicking it opens the
  // upgrade prompt instead of toggling selection.
  const toggleNet = (n) => {
    if (!AVAILABLE_NETWORKS.includes(n)) { onNetworkRestricted?.(); return; }
    setSelected((prev) => {
      if (prev.length === AVAILABLE_NETWORKS.length) return [n];
      if (prev.includes(n)) return prev.length > 1 ? prev.filter((x) => x !== n) : prev;
      return [...prev, n];
    });
  };

  const metaNote = ` · ${metaNet}`;
  const metaOnlyMsg = "Advertiser / category data isn't stored for this network's ad index.";
  const NetLegend = ({ nets }) => (nets.length > 1 ? (
    <div className="flex flex-wrap gap-x-2.5 gap-y-1">
      {nets.map((n) => (
        <span key={n} className="flex items-center gap-1 text-[9px] text-white/60">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: NET_COLOR[n] || '#888' }} />{NET_LABEL[n] || n}
        </span>
      ))}
    </div>
  ) : null);

  const drill = (kind, value) => value && setDrillItem({ kind, value });
  const daysLabel = days === 'custom' ? (from && to ? `${from} → ${to}` : 'custom range') : `last ${days} days`;
  // In compare-mode, spell out whose data THIS panel is scoped to right now.
  const scopeText = (scope) => (termMode ? ` · showing ${scope || 'all compared advertisers'}` : '');

  const exportCsv = () => {
    const rows = [['Market Trends export', `last ${days} days`, country ? `country: ${country}` : 'all countries']];
    rows.push([], [termMode ? 'Compared terms over time' : 'Interest over time', indexed ? '(0–100 index)' : '(ad counts)'], ['date', ...chartKeys]);
    (chartData || []).forEach((r) => rows.push([r.date, ...chartKeys.map((k) => r[k] ?? 0)]));
    if (regions?.items?.length) { rows.push([], ['Ads by country'], ['country', 'ads']); regions.items.forEach((c) => rows.push([c.country, c.count])); }
    if (!catUnsupported) { rows.push([], ['Ads per category'], ['category', 'ads', 'growth %']); categories.forEach((c) => rows.push([c.category, c.current, c.growthPct])); }
    if (!topUnsupported) { rows.push([], [`Top ${topType}s`], [topType, 'ads']); top.forEach((t) => rows.push([t.label, t.count])); }
    if (!kwUnsupported) { rows.push([], ['Top keywords'], ['keyword', 'ads']); keywords.forEach((k) => rows.push([k.keyword, k.count])); }
    downloadCsv(`market-trends-${days}d.csv`, rows);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-theme-bg">
      <div className="max-w-[1500px] mx-auto px-5 py-6 flex flex-col gap-5 text-white">
        {/* Header */}
        <div className="flex items-start gap-3 flex-wrap">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500"><TrendingUp size={20} /></div>
          <div className="flex-1 min-w-[220px]">
            <h1 className="text-lg font-semibold text-white">Market Trends</h1>
            <p className="text-xs text-white/60">Compare advertisers &amp; networks over time, see where ads run and what's trending — on real ad data.</p>
          </div>
          <button onClick={exportCsv} className="text-xs flex items-center gap-1.5 bg-white/5 hover:bg-white/10 rounded-lg px-3 py-1.5 text-white h-fit">
            <Download size={13} /> Export CSV
          </button>
          <select value={country} onChange={(e) => setCountry(e.target.value)}
            className="text-xs bg-theme-bg border border-theme-border rounded-lg px-3 py-1.5 text-white h-fit max-w-[150px]">
            <option value="">All countries</option>
            {countryOpts.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <DateRangePicker days={days} from={from} to={to}
            onPreset={(d) => { setDays(d); setFrom(''); setTo(''); }}
            onRange={(f, t) => { setFrom(f); setTo(t); setDays('custom'); }}
            onClear={() => { setDays(30); setFrom(''); setTo(''); }} />
        </div>

        {/* Compared search terms (advertisers) */}
        <div className="flex items-center gap-2 flex-wrap">
          {terms.map((t, i) => (
            <span key={t} className="flex items-center gap-1.5 text-[11px] rounded-full pl-2.5 pr-1.5 py-1 text-white" style={{ backgroundColor: TERM_COLORS[i % TERM_COLORS.length] }}>
              {t}<button onClick={() => removeTerm(t)} className="hover:bg-white/20 rounded-full p-0.5"><X size={11} /></button>
            </span>
          ))}
          {terms.length < 5 && (
            <div className="relative flex items-center">
              <Search className="absolute left-2.5 text-white/60" size={13} />
              <input value={termInput} onChange={(e) => setTermInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addTerm(); if (e.key === 'Escape') setTermInput(''); }}
                placeholder={terms.length ? 'Add advertiser…' : 'Compare advertisers (e.g. Nykaa, Myntra) — press Enter'}
                className="text-xs bg-theme-bg border border-theme-border rounded-full pl-7 pr-2 py-1.5 text-white w-64" />
              {termInput && <button onClick={addTerm} className="ml-1 text-xs bg-[#335296] text-white rounded-full p-1.5"><Plus size={12} /></button>}
            </div>
          )}
          {termMode && <button onClick={() => setTerms([])} className="text-[11px] text-white/60 underline">clear compare</button>}
        </div>

        {/* Network selector — "All" or a single network (icons from assets) */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-white/60 mr-1">Network:</span>
          <button onClick={selectAll}
            className={`flex items-center gap-1.5 text-[11px] rounded-full px-2.5 py-1 border transition-colors ${isAllNets ? 'bg-[#335296] text-white border-transparent' : 'border-theme-border text-white/60 hover:border-white/30'}`}>
            <LayoutGrid size={13} /> All
          </button>
          {CHIP_NETWORKS.map((n) => {
            const planRestricted = !AVAILABLE_NETWORKS.includes(n);
            const on = !isAllNets && selected.includes(n);
            // Data-presence disabling only applies to networks the plan actually
            // allows — a plan-restricted chip stays clickable (opens the upgrade
            // prompt) rather than looking dead, matching "not a hard removal".
            const has = planRestricted || !overview || allNets.includes(n);
            return (
              <button key={n} onClick={() => toggleNet(n)} disabled={!has} title={planRestricted ? 'Upgrade your plan to unlock this network' : undefined}
                className={`flex items-center gap-1.5 text-[11px] rounded-full px-2.5 py-1 border transition-colors ${on ? 'border-transparent text-white' : 'border-theme-border text-white/60 hover:border-white/30'} ${!has ? 'opacity-30 cursor-not-allowed' : ''} ${planRestricted ? 'opacity-50' : ''}`}
                style={on ? { backgroundColor: NET_COLOR[n] } : undefined}>
                <img src={NET_ICON[n]} alt="" className="w-3.5 h-3.5 rounded-sm object-contain" />
                {NET_LABEL[n]}
                {planRestricted && <Lock size={10} className="opacity-70" />}
              </button>
            );
          })}
        </div>

        {(
          <div className="flex flex-col gap-5">
            {/* Interest over time */}
            <Panel
              loading={overviewShimmer}
              error={overviewError || termError}
              onRetry={() => { setOverviewRetry((n) => n + 1); setTermRetry((n) => n + 1); }}
              skeleton={<SkeletonChartLine height={260} lines={termMode ? Math.min(terms.length, 3) : 3} />}
              title={termMode ? `Comparing ${terms.length} advertiser${terms.length > 1 ? 's' : ''} — ${daysLabel}` : `Interest over time — ${daysLabel}`}
              subtitle={termMode ? 'Each line is an advertiser’s daily ad volume across the selected networks.' : 'Daily ad volume per network. Use the 0–100 index to compare trends regardless of scale.'}
              info={termMode
                ? 'One line per compared advertiser, summing their daily ad count over the selected networks. In 0–100 index mode each line is scaled to its own peak so shapes are comparable even when volumes differ.'
                : 'One line per network showing how many ads were live each day (by last-seen date). 0–100 index scales every line to its own peak; Ad counts shows raw daily volume.'}
              note={interestNote}
              right={(
                <div className="flex rounded-lg overflow-hidden border border-theme-border">
                  <button onClick={() => setIndexed(true)} className={`text-[10px] px-2 py-1 ${indexed ? 'bg-[#335296] text-white' : 'text-white/60'}`}>0–100 index</button>
                  <button onClick={() => setIndexed(false)} className={`text-[10px] px-2 py-1 ${!indexed ? 'bg-[#335296] text-white' : 'text-white/60'}`}>Ad counts</button>
                </div>
              )}>
              {chartData?.length && chartKeys.length ? (
                <>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {chartKeys.map((k) => (
                      <span key={k} className="flex items-center gap-1 text-[10px] text-white/60">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: keyColor(k) }} />{keyLabel(k)}
                      </span>
                    ))}
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={chartData} margin={{ top: 6, right: 10, left: -14, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'currentColor' }} interval="preserveStartEnd" minTickGap={28} />
                      <YAxis tick={{ fontSize: 9, fill: 'currentColor' }} domain={indexed ? [0, 100] : undefined} />
                      <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} cursor={{ stroke: 'currentColor', strokeOpacity: 0.2 }}
                        formatter={(v, name) => [indexed ? `${v}/100` : `${v} ads`, keyLabel(name)]} />
                      {chartKeys.map((k) => (
                        <Line key={k} type="monotone" dataKey={k} name={k} stroke={keyColor(k)} dot={false} strokeWidth={1.8} isAnimationActive={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                  <p className="text-[10px] text-white/50">
                    {indexed ? '0–100 index: each line scaled to its own peak.' : 'Raw ad counts per day.'}
                  </p>
                </>
              ) : <Empty msg={termMode ? 'No ads found for these advertisers in the selected networks/window.' : 'Pick at least one network above.'} />}
            </Panel>

            <div className="grid gap-5 lg:grid-cols-2">
              {/* Ads by country — stacked by network */}
              <Panel
                loading={regionsShimmer}
                error={regionsError}
                onRetry={() => setRegionsRetry((n) => n + 1)}
                skeleton={<SkeletonBarChart bars={7} orientation="horizontal" height={220} />}
                title={<span className="flex items-center gap-1.5"><Globe2 size={14} /> Ads by country{selected.length === 1 ? ` · ${NET_LABEL[selected[0]]}` : ''}</span>}
                subtitle={`Where ads are running — each country bar stacked by network. Click a bar to filter.${scopeText(regionsScope)}`}
                info="Ad counts grouped by the target country on each ad, top 12 shown. Bar length = total ads; each coloured segment is one network's share. Country names are normalised and merged across networks. Click a bar to filter the whole page."
                scope={<AdvScope terms={terms} activeTerm={regionsScope} onPick={setRegionsScope} />}
                note={countryNote}>
                {countryData.length ? (
                  <>
                    <NetLegend nets={countryNets} />
                    <ResponsiveContainer width="100%" height={Math.max(220, Math.min(countryData.length, 12) * 26)}>
                      <BarChart data={countryData} layout="vertical" margin={{ top: 4, right: 14, left: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 9, fill: 'currentColor' }} />
                        <YAxis type="category" dataKey="country" tick={{ fontSize: 9, fill: 'currentColor' }} width={110} interval={0} tickFormatter={shortLabel} />
                        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v, name) => [`${Number(v).toLocaleString()} ads`, NET_LABEL[name] || name]} />
                        {countryNets.map((n, i) => (
                          <Bar key={n} dataKey={n} name={n} stackId="country" fill={NET_COLOR[n] || '#0ea5e9'}
                            radius={i === countryNets.length - 1 ? [0, 3, 3, 0] : 0}
                            cursor="pointer" onClick={(d) => setCountry(d?.country || '')} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </>
                ) : <Empty msg="No country data for this window." />}
              </Panel>

              {/* Ads per category — horizontal stacked, compared across networks */}
              <Panel
                loading={categoriesShimmer}
                error={categoriesError}
                onRetry={() => setCategoriesRetry((n) => n + 1)}
                skeleton={<SkeletonBarChart bars={7} orientation="horizontal" height={220} />}
                title={`Ads per category${metaNote}`}
                subtitle={`Which categories advertisers push, compared across networks — each bar stacked by network. Click to drill.${scopeText(catScope)}`}
                info="Ad counts grouped by the ad's category. Bar length = total ads in that category; each coloured segment is a network's contribution, so you can compare where a category is being advertised. Category is only stored on some networks (Facebook, Instagram, Native, Pinterest, Google). Click to open matching ads."
                scope={<AdvScope terms={terms} activeTerm={catScope} onPick={setCatScope} />}
                note={catUnsupported ? '' : catNote}>
                {catUnsupported ? <Empty msg={metaOnlyMsg} /> : catData.length ? (
                  <>
                    <NetLegend nets={catNets} />
                    <ResponsiveContainer width="100%" height={Math.max(220, Math.min(catData.length, 12) * 28)}>
                      <BarChart data={catData} layout="vertical" margin={{ top: 4, right: 14, left: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 9, fill: 'currentColor' }} allowDecimals={false} />
                        <YAxis type="category" dataKey="category" tick={{ fontSize: 9, fill: 'currentColor' }} width={132} interval={0} tickFormatter={shortLabel} />
                        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v, name) => [`${Number(v).toLocaleString()} ads`, NET_LABEL[name] || name]} />
                        {catNets.map((n, i) => (
                          <Bar key={n} dataKey={n} name={n} stackId="cat" fill={NET_COLOR[n] || '#6366f1'}
                            radius={i === catNets.length - 1 ? [0, 3, 3, 0] : 0}
                            cursor="pointer" onClick={(d) => drill('category', d?.category)} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </>
                ) : <Empty msg={`No category data ${termMode ? `for “${catScope || 'the compared advertisers'}” ` : ''}in this window — category is only tagged on Facebook, Instagram, Native, Pinterest & Google.`} />}
              </Panel>

              {/* Top movers — Google-Trends-style ranked table */}
              <TrendTable
                loading={topShimmer}
                error={topError}
                onRetry={() => setTopRetry((n) => n + 1)}
                title="Top movers"
                subtitle={`${metaNet} · ${daysLabel}${scopeText(topScope)}`}
                info="The advertisers (or CTAs) running the most ads right now, ranked by volume. The bar shows each row's share of the top entry; Change is its growth versus the previous equal-length period (↑ up / ↓ down). Use the ⋮ menu to open matching ads or add an advertiser to the compare box."
                columnLabel={topType === 'cta' ? 'Call to action' : 'Advertiser'}
                valueLabel="Ad volume"
                rows={topRows}
                color="#4285F4"
                note={topNote}
                emptyMsg={topUnsupported ? metaOnlyMsg : `No ${topType === 'cta' ? 'CTA' : 'advertiser'} data for ${metaNet} in this window.`}
                onRowClick={(r) => drill(topType, r.label)}
                onCompare={topType === 'advertiser' ? (r) => setTerms((p) => (p.includes(r.label) || p.length >= 5 ? p : [...p, r.label])) : undefined}
                onExport={exportCsv}
                scope={<AdvScope terms={terms} activeTerm={topScope} onPick={setTopScope} />}
                right={(
                  <div className="flex gap-1">
                    {TOP_TYPES.map((t) => (
                      <button key={t.v} onClick={() => setTopType(t.v)} className={`text-[10px] px-2 py-0.5 rounded-md ${topType === t.v ? 'bg-[#335296] text-white' : 'bg-white/5 text-white/60'}`}>{t.label}</button>
                    ))}
                  </div>
                )} />

              {/* Rising categories — Google-Trends-style ranked table */}
              <TrendTable
                loading={risingShimmer}
                error={risingError}
                onRetry={() => setRisingRetry((n) => n + 1)}
                title="Rising categories"
                subtitle={`${metaNet} · vs previous ${daysLabel}${scopeText(risingScope)}`}
                info="Categories sorted by growth: the change in ad volume versus the previous equal-length period (↑ rising / ↓ falling). The bar shows current ad volume relative to the top row, so you can tell a fast-growing niche from a fast-growing giant. Click a row to open matching ads."
                columnLabel="Category"
                valueLabel="Ad volume"
                rows={risingRows}
                color="#8b5cf6"
                note={risingUnsupported ? '' : risingNote}
                emptyMsg={risingUnsupported ? metaOnlyMsg : `No category data ${termMode ? `for “${risingScope || 'the compared advertisers'}” ` : ''}in this window — category is only tagged on Facebook, Instagram, Native, Pinterest & Google.`}
                onRowClick={(r) => drill('category', r.label)}
                onExport={exportCsv}
                scope={<AdvScope terms={terms} activeTerm={risingScope} onPick={setRisingScope} />} />

              {/* Top keywords */}
              <Panel
                loading={kwShimmer}
                error={kwError}
                onRetry={() => setKwRetry((n) => n + 1)}
                skeleton={<SkeletonBarChart bars={8} orientation="horizontal" height={220} />}
                className="lg:col-span-2"
                title="Top search keywords · Google"
                subtitle={`Most-targeted Google search keywords in this window.${scopeText(kwScope)}`}
                info="The search keywords advertisers target most on Google search ads (from each ad's target keyword), ranked by ad count. Available for Google only. Click a bar to open matching ads."
                scope={<AdvScope terms={terms} activeTerm={kwScope} onPick={setKwScope} />}
                note={kwUnsupported ? '' : kwNote}>
                {kwUnsupported ? <Empty msg="Search-keyword data is available for Google search ads." /> : keywords.length ? (
                  <ResponsiveContainer width="100%" height={Math.max(220, keywords.length * 24)}>
                    <BarChart data={keywords} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 9, fill: 'currentColor' }} />
                      <YAxis type="category" dataKey="keyword" tick={{ fontSize: 9, fill: 'currentColor' }} width={132} interval={0} tickFormatter={shortLabel} />
                      <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v) => [`${v} ads`, 'Ads']} />
                      <Bar dataKey="count" name="ads" fill="#f59e0b" radius={[0, 3, 3, 0]} cursor="pointer" onClick={(d) => drill('keyword', d?.keyword)} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <Empty msg="No keyword data for this window." />}
              </Panel>
            </div>
          </div>
        )}
      </div>

      {/* Drill detail modal — opens in-page (no reload) */}
      {drillItem && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setDrillItem(null)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-theme-bg border border-theme-border p-5 shadow-xl">
            <div className="text-[10px] uppercase tracking-wide text-white/60">
              {drillItem.kind === 'advertiser' ? 'Advertiser' : drillItem.kind === 'cta' ? 'Call to action' : drillItem.kind === 'keyword' ? 'Search keyword' : 'Category'}
            </div>
            <h3 className="text-base font-semibold text-white mt-0.5 break-words">{drillItem.value}</h3>
            <p className="text-xs text-white/60 mt-2">Open this in the Ads Library to see every matching ad with full analytics.</p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => { const it = drillItem; setDrillItem(null); onDrill && onDrill(it.kind, it.value); }}
                className="flex-1 text-xs bg-[#335296] text-white rounded-lg px-3 py-2 font-medium">Open in Ads Library</button>
              {drillItem.kind === 'advertiser' && (
                <button onClick={() => { const v = drillItem.value; setDrillItem(null); setTerms((p) => (p.includes(v) || p.length >= 5 ? p : [...p, v])); }}
                  className="text-xs text-white px-3 py-2 rounded-lg border border-theme-border">+ Compare</button>
              )}
              <button onClick={() => setDrillItem(null)} className="text-xs text-white/60 hover:text-white px-3 py-2 rounded-lg border border-theme-border">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MarketTrends;
