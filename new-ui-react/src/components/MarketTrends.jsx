import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { TrendingUp, Loader2, Download, Globe2, Search, X, Plus, LayoutGrid, Calendar, ChevronDown } from 'lucide-react';
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
export async function fetchMarketTrendsAccess() {
  try { const r = await apiGet('/access'); return !!r?.data?.enabled; } catch { return false; }
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

function Panel({ title, right, children }) {
  return (
    <div className="p-3.5 rounded-xl border border-theme-border bg-theme-bg flex flex-col gap-2.5 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-white">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}
const Empty = ({ msg }) => <div className="py-12 text-center text-[11px] text-white/60 px-3">{msg || 'No data for this window.'}</div>;

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

const MarketTrends = ({ onDrill }) => {
  const [days, setDays] = useState(30);
  const [from, setFrom] = useState(''); // custom range (YYYY-MM-DD)
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState(CHIP_NETWORKS); // network filter (chips)
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
  const [top, setTop] = useState([]);
  const [topUnsupported, setTopUnsupported] = useState(false);
  const [keywords, setKeywords] = useState([]);
  const [kwUnsupported, setKwUnsupported] = useState(false);
  const [metaNet, setMetaNet] = useState('All networks');
  const [drillItem, setDrillItem] = useState(null);
  const [loading, setLoading] = useState(false);

  // Chips double as a filter: all chips → 'all'; otherwise a CSV the backend honors.
  const netParam = selected.length === CHIP_NETWORKS.length ? 'all' : (selected.join(',') || 'all');

  const load = useCallback(async () => {
    setLoading(true);
    const adv = terms.join(','); // searched advertisers filter every panel too
    const dp = (days === 'custom' && from && to) ? { from, to } : { days }; // preset days or custom range
    try {
      const [ov, rg, cat, tp, kw] = await Promise.all([
        apiGet('/trends/overview', { ...dp, network: 'all', country }).catch(() => null),
        apiGet('/trends/regions', { ...dp, network: netParam, advertiser: adv }).catch(() => null),
        apiGet('/trends/categories', { ...dp, network: netParam, size: 12, country, advertiser: adv }).catch(() => null),
        apiGet('/trends/top', { ...dp, type: topType, network: netParam, size: 12, country, advertiser: adv }).catch(() => null),
        apiGet('/trends/keywords', { ...dp, network: netParam, size: 12, country, advertiser: adv }).catch(() => null),
      ]);
      setOverview(ov?.data || null);
      setRegions(rg?.data || null);
      if (rg?.data?.items?.length) setCountryOpts(rg.data.items.map((c) => c.country));
      setCategories(cat?.data?.items || []);
      setCatUnsupported(!!cat?.meta?.unsupported);
      setTop(tp?.data?.items || []);
      setTopUnsupported(!!tp?.meta?.unsupported);
      setKeywords(kw?.data?.items || []);
      setKwUnsupported(!!kw?.meta?.unsupported);
      setMetaNet(cat?.data?.network || tp?.data?.network || 'All networks');
    } finally { setLoading(false); }
  }, [days, from, to, netParam, topType, country, terms]);

  useEffect(() => { load(); }, [days, from, to, netParam, topType, country, terms]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch each compared term's per-network trend.
  useEffect(() => {
    if (!terms.length) { setTermData({}); return; }
    const dp = (days === 'custom' && from && to) ? { from, to } : { days };
    let alive = true;
    Promise.all(terms.map((t) => apiGet('/trends/search', { q: t, ...dp, network: netParam, country })
      .then((r) => [t, r?.data]).catch(() => [t, null])))
      .then((pairs) => { if (!alive) return; const m = {}; pairs.forEach(([t, d]) => { if (d) m[t] = d; }); setTermData(m); });
    return () => { alive = false; };
  }, [terms, days, from, to, netParam, country]);

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

  const addTerm = () => {
    const t = termInput.trim();
    if (t && !terms.includes(t) && terms.length < 5) setTerms((p) => [...p, t]);
    setTermInput('');
  };
  const removeTerm = (t) => setTerms((p) => p.filter((x) => x !== t));
  const isAllNets = selected.length === CHIP_NETWORKS.length;
  const selectAll = () => setSelected(CHIP_NETWORKS);
  // From "All" a click solos that network; after that clicks toggle (multi-select, min 1).
  const toggleNet = (n) => setSelected((prev) => {
    if (prev.length === CHIP_NETWORKS.length) return [n];
    if (prev.includes(n)) return prev.length > 1 ? prev.filter((x) => x !== n) : prev;
    return [...prev, n];
  });

  const metaNote = ` · ${metaNet}`;
  const metaOnlyMsg = "Advertiser / category data isn't stored for this network's ad index.";
  const netsIn = (items) => [...new Set((items || []).map((i) => i.net).filter(Boolean))];
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
            const on = !isAllNets && selected.includes(n);
            const has = !overview || allNets.includes(n);
            return (
              <button key={n} onClick={() => toggleNet(n)} disabled={!has}
                className={`flex items-center gap-1.5 text-[11px] rounded-full px-2.5 py-1 border transition-colors ${on ? 'border-transparent text-white' : 'border-theme-border text-white/60 hover:border-white/30'} ${!has ? 'opacity-30 cursor-not-allowed' : ''}`}
                style={on ? { backgroundColor: NET_COLOR[n] } : undefined}>
                <img src={NET_ICON[n]} alt="" className="w-3.5 h-3.5 rounded-sm object-contain" />
                {NET_LABEL[n]}
              </button>
            );
          })}
        </div>

        {loading && (
          <div className="flex items-center gap-1.5 text-[11px] text-white/60 self-start px-2 py-1 rounded-full bg-white/5">
            <Loader2 size={12} className="animate-spin" /> Updating…
          </div>
        )}

        {(
          <div className={`flex flex-col gap-5 transition-opacity ${loading ? 'opacity-60' : ''}`}>
            {/* Interest over time */}
            <Panel
              title={termMode ? `Comparing ${terms.length} advertiser${terms.length > 1 ? 's' : ''} — ${daysLabel}` : `Interest over time — ${daysLabel}`}
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
                  <p className="text-[10px] text-white/60">
                    {termMode ? 'Each line = that advertiser’s ad volume across the selected networks. ' : ''}
                    {indexed ? '0–100 index: each line scaled to its own peak.' : 'Raw ad counts per day.'}
                  </p>
                </>
              ) : <Empty msg={termMode ? 'No ads found for these advertisers in the selected networks/window.' : 'Pick at least one network above.'} />}
            </Panel>

            <div className="grid gap-5 lg:grid-cols-2">
              {/* Ads by country */}
              <Panel title={<span className="flex items-center gap-1.5"><Globe2 size={14} /> Ads by country{selected.length === 1 ? ` · ${NET_LABEL[selected[0]]}` : ''}</span>}>
                {regions?.items?.length ? (
                  <ResponsiveContainer width="100%" height={Math.max(220, Math.min(regions.items.length, 12) * 24)}>
                    <BarChart data={regions.items.slice(0, 12)} layout="vertical" margin={{ top: 4, right: 14, left: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 9, fill: 'currentColor' }} />
                      <YAxis type="category" dataKey="country" tick={{ fontSize: 9, fill: 'currentColor' }} width={110} interval={0} tickFormatter={shortLabel} />
                      <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v) => [`${v.toLocaleString()} ads`, 'Ads']} />
                      <Bar dataKey="count" name="ads" fill="#0ea5e9" radius={[0, 3, 3, 0]} cursor="pointer" onClick={(d) => setCountry(d?.country || '')} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <Empty msg="No country data for this window." />}
              </Panel>

              {/* Ads per category */}
              <Panel title={`Ads per category${metaNote}`}>
                {catUnsupported ? <Empty msg={metaOnlyMsg} /> : categories.length ? (
                  <>
                    {selected.length !== 1 && <NetLegend nets={netsIn(categories)} />}
                    <ResponsiveContainer width="100%" height={Math.max(220, categories.length * 24)}>
                      <BarChart data={categories} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 9, fill: 'currentColor' }} />
                        <YAxis type="category" dataKey="category" tick={{ fontSize: 9, fill: 'currentColor' }} width={132} interval={0} tickFormatter={shortLabel} />
                        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v, n, p) => [`${v} ads · ${NET_LABEL[p?.payload?.net] || 'Meta'}`, 'Ads']} />
                        <Bar dataKey="current" name="ads" radius={[0, 3, 3, 0]} cursor="pointer" onClick={(d) => drill('category', d?.category)}>
                          {categories.map((c, i) => <Cell key={i} fill={NET_COLOR[c.net] || '#6366f1'} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </>
                ) : <Empty msg={`No category data for ${metaNet} in this window.`} />}
              </Panel>

              {/* Top movers */}
              <Panel title={<span className="flex items-center gap-2">Top movers{metaNote}</span>}
                right={(
                  <div className="flex gap-1">
                    {TOP_TYPES.map((t) => (
                      <button key={t.v} onClick={() => setTopType(t.v)} className={`text-[10px] px-2 py-0.5 rounded-md ${topType === t.v ? 'bg-[#335296] text-white' : 'bg-white/5 text-white/60'}`}>{t.label}</button>
                    ))}
                  </div>
                )}>
                {topUnsupported ? <Empty msg={metaOnlyMsg} /> : top.length ? (
                  <>
                    {selected.length !== 1 && <NetLegend nets={netsIn(top)} />}
                    <ResponsiveContainer width="100%" height={Math.max(220, top.length * 24)}>
                      <BarChart data={top} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 9, fill: 'currentColor' }} />
                        <YAxis type="category" dataKey="label" tick={{ fontSize: 9, fill: 'currentColor' }} width={120} interval={0} tickFormatter={shortLabel} />
                        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v, n, p) => [`${v} ads · ${NET_LABEL[p?.payload?.net] || 'Meta'}`, 'Ads']} />
                        <Bar dataKey="count" name="ads" radius={[0, 3, 3, 0]} cursor="pointer" onClick={(d) => drill(topType, d?.label)}>
                          {top.map((t, i) => <Cell key={i} fill={NET_COLOR[t.net] || '#10b981'} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </>
                ) : <Empty msg={`No ${topType === 'cta' ? 'CTA' : topType} data for ${metaNet} in this window.`} />}
              </Panel>

              {/* Rising categories */}
              <Panel title={`Rising categories${metaNote}`}>
                {catUnsupported ? <Empty msg={metaOnlyMsg} /> : categories.length ? (
                  (() => {
                    const growth = [...categories].sort((a, b) => b.growthPct - a.growthPct).slice(0, 10);
                    return (
                      <ResponsiveContainer width="100%" height={Math.max(220, growth.length * 24)}>
                        <BarChart data={growth} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 9, fill: 'currentColor' }} unit="%" />
                          <YAxis type="category" dataKey="category" tick={{ fontSize: 9, fill: 'currentColor' }} width={132} interval={0} tickFormatter={shortLabel} />
                          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v) => [`${v}%`, 'Growth']} />
                          <Bar dataKey="growthPct" radius={[0, 3, 3, 0]} cursor="pointer" onClick={(d) => drill('category', d?.category)}>
                            {growth.map((c, i) => <Cell key={i} fill={c.growthPct >= 0 ? '#10b981' : '#ef4444'} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    );
                  })()
                ) : <Empty msg={`No category data for ${metaNet} in this window.`} />}
              </Panel>

              {/* Top keywords */}
              <Panel title="Top search keywords · Google">
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
