import { useEffect, useState, useCallback, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { FiRefreshCw, FiHardDrive } from "react-icons/fi";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Cell, AreaChart, Area,
} from "recharts";
import { fetchNasStorage } from "../../store/actions/powerAdsPyActionsApi";

/* ------------------------------------------------------------------ */
/* NAS Storage — capacity (df) + per-network breakdown (daily du) +    */
/* day-over-day growth. Data from pas_node_api (BE-08). Auto-refresh.  */
/* ------------------------------------------------------------------ */

const REFRESH_OPTIONS = [
  { value: 0, label: "Off" },
  { value: 30000, label: "30s" },
  { value: 60000, label: "1m" },
  { value: 300000, label: "5m" },
];

const NET_LABEL = {
  fb: "Facebook", insta: "Instagram", gdn: "GDN", native: "Native", yt: "YouTube",
  gt: "Google", linkedin: "LinkedIn", pint: "Pinterest", quora: "Quora", reddit: "Reddit", tiktok: "TikTok",
};
const NET_COLOR = {
  fb: "#1877f2", insta: "#e1306c", gdn: "#34a853", native: "#0ea5e9", yt: "#ff0000",
  gt: "#ea4335", linkedin: "#0a66c2", pint: "#e60023", quora: "#b92b27", reddit: "#ff4500", tiktok: "#111111",
};
const TREE_LABEL = {
  adImage: "Images", adVideo: "Videos", otherMultiMedia: "Other media",
  thumbnail: "Thumbs", postowner: "Logos", blackHatAd: "BlackHat", whiteHatAd: "WhiteHat",
};

const fmtBytes = (b) => {
  if (b == null || !Number.isFinite(b)) return "—";
  const TB = 1e12, GB = 1e9, MB = 1e6;
  const s = b < 0 ? "-" : ""; b = Math.abs(b);   // keep the sign; format the magnitude
  if (b >= TB) return `${s}${(b / TB).toFixed(2)} TB`;
  if (b >= GB) return `${s}${(b / GB).toFixed(1)} GB`;
  if (b >= MB) return `${s}${(b / MB).toFixed(0)} MB`;
  return `${s}${b} B`;
};
const fmtDay = (d) => (d ? d.slice(5) : "");
const fmtNum = (n) => (n == null || !Number.isFinite(n) ? "—" : n.toLocaleString());

const KpiTile = ({ label, value, accent = "#1f296a", sub }) => (
  <div className="flex flex-col justify-between rounded-[14px] border border-[#e6e9f5] bg-white px-5 py-4 shadow-sm min-w-[160px]">
    <span className="text-[13px] font-medium text-[#7a83a8] uppercase tracking-wide">{label}</span>
    <span className="text-[30px] font-[700] leading-tight" style={{ color: accent }}>{value}</span>
    {sub ? <span className="text-[12px] text-[#9aa2c0]">{sub}</span> : null}
  </div>
);

const MiniKpi = ({ label, value, sub, accent = "#1f296a" }) => (
  <div className="rounded-[12px] border border-[#eef1fb] bg-[#fafbff] px-4 py-2.5 min-w-[140px]">
    <div className="text-[11px] font-[600] text-[#7a83a8] uppercase tracking-wide">{label}</div>
    <div className="text-[20px] font-[700] leading-tight" style={{ color: accent }}>{value}</div>
    {sub ? <div className="text-[11px] text-[#9aa2c0]">{sub}</div> : null}
  </div>
);

const INTAKE_STATUS = {
  active: ["#16a34a", "#eafaf0", "Active"],
  stalled: ["#cf1322", "#fff1f0", "Stalled"],
  idle: ["#9aa2c0", "#f1f3fb", "Idle"],
};
const StatusBadge = ({ status }) => {
  const [c, bg, label] = INTAKE_STATUS[status] || INTAKE_STATUS.idle;
  return <span className="inline-block rounded-full px-2 py-[2px] text-[11px] font-[600]" style={{ color: c, background: bg }}>{label}</span>;
};

const NasStorage = () => {
  const dispatch = useDispatch();
  const nas = useSelector((s) => s.poweradspy?.nasStorage);
  const loading = useSelector((s) => s.poweradspy?.loadingNasStorage);
  const error = useSelector((s) => s.poweradspy?.nasStorageError);
  const [refreshMs, setRefreshMs] = useState(30000);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(() => {
    dispatch(fetchNasStorage({ days: 30 }))
      .unwrap()
      .then(() => setLastUpdated(Date.now()))
      .catch(() => {});
  }, [dispatch]);

  useEffect(() => { load(); }, [load]);

  /* live auto-refresh */
  useEffect(() => {
    if (!refreshMs) return undefined;
    const id = setInterval(load, refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, load]);

  const storage = nas?.storage || null;
  const perNetwork = nas?.perNetwork || null;
  const daily = nas?.daily || [];
  const intake = nas?.intake || null;

  const netData = useMemo(() => {
    if (!perNetwork?.sizes) return [];
    return Object.entries(perNetwork.sizes)
      .map(([k, v]) => ({ key: k, name: NET_LABEL[k] || k, bytes: v, color: NET_COLOR[k] || "#1f296a" }))
      .sort((a, b) => b.bytes - a.bytes);
  }, [perNetwork]);

  const growthData = useMemo(
    () => daily
      .filter((d) => d.growthBytes != null)
      .map((d) => ({ date: fmtDay(d.date), gb: +(d.growthBytes / 1e9).toFixed(2) })),
    [daily]
  );

  const intakeRows = useMemo(() => {
    if (!intake?.networks) return [];
    return Object.entries(intake.networks)
      .map(([k, v]) => ({ key: k, name: NET_LABEL[k] || k, ...v }))
      .sort((a, b) => b.filesToday - a.filesToday);
  }, [intake]);

  const intakeTrees = useMemo(() => {
    if (!intake) return [];
    const present = new Set();
    Object.values(intake.networks || {}).forEach((n) =>
      Object.entries(n.trees || {}).forEach(([t, e]) => { if (e.today || e.d1 || e.d2) present.add(t); })
    );
    return (intake.trees || []).filter((t) => present.has(t));
  }, [intake]);

  const hourData = useMemo(
    () => (intake?.byHour ? Array.from({ length: 24 }, (_, h) => ({ h: String(h), files: intake.byHour[h] || 0 })) : []),
    [intake]
  );

  const pace = useMemo(() => {
    const proj = intake?.totals?.projFiles, y = intake?.totals?.filesD1;
    if (!proj || !y) return null;
    return Math.round((proj / y - 1) * 100);
  }, [intake]);

  const pct = storage?.pctUsed ?? 0;

  return (
    <div className="px-6 py-5">
      {/* header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div>
          <h1 className="text-[26px] font-[700] text-[#1f296a] flex items-center gap-2">
            <FiHardDrive /> NAS Storage
          </h1>
          <p className="text-[13px] text-[#7a83a8]">
            {storage ? `Mount ${storage.mount}` : "—"}
            {perNetwork?.computedAt ? ` · per-network scan ${new Date(perNetwork.computedAt).toLocaleString()}` : ""}
            {lastUpdated ? ` · refreshed ${new Date(lastUpdated).toLocaleTimeString()}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={refreshMs}
            onChange={(e) => setRefreshMs(Number(e.target.value))}
            className="border border-[#e6e9f5] rounded-[10px] px-3 py-2 text-[14px] text-[#1f296a]"
          >
            {REFRESH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{`Refresh: ${o.label}`}</option>)}
          </select>
          <button
            onClick={load}
            className="flex items-center gap-1.5 border border-[#e6e9f5] rounded-[10px] px-3 py-2 text-[14px] text-[#1f296a] hover:bg-[#f1f3ff]"
          >
            <FiRefreshCw className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-[10px] bg-[#fff1f0] border border-[#ffccc7] px-4 py-2 text-[13px] text-[#cf1322]">
          {String(error)}
        </div>
      ) : null}
      {nas?.storageError ? (
        <div className="mb-4 rounded-[10px] bg-[#fffbe6] border border-[#ffe58f] px-4 py-2 text-[13px] text-[#ad8b00]">
          NAS: {nas.storageError}
        </div>
      ) : null}

      {/* KPI tiles */}
      <div className="flex gap-4 flex-wrap mb-5">
        <KpiTile label="Total Capacity" value={fmtBytes(storage?.totalBytes)} />
        <KpiTile label="Used" value={fmtBytes(storage?.usedBytes)} accent="#cf1322" sub={`${pct}%`} />
        <KpiTile label="Free" value={fmtBytes(storage?.freeBytes)} accent="#16a34a" />
        <KpiTile
          label="Growth (last day)"
          value={nas?.lastDayGrowthBytes != null ? fmtBytes(nas.lastDayGrowthBytes) : "—"}
          accent="#7c3aed"
        />
      </div>

      {/* capacity bar */}
      <div className="rounded-[14px] border border-[#e6e9f5] bg-white px-5 py-4 shadow-sm mb-5">
        <div className="flex justify-between text-[13px] text-[#7a83a8] mb-2">
          <span>Capacity</span>
          <span>{fmtBytes(storage?.usedBytes)} / {fmtBytes(storage?.totalBytes)} ({pct}%)</span>
        </div>
        <div className="h-[14px] w-full rounded-full bg-[#eef1fb] overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: pct > 85 ? "#cf1322" : pct > 70 ? "#fa8c16" : "#16a34a" }}
          />
        </div>
      </div>

      {/* ingest today — per-network/per-tree file intake (matrix) */}
      {intake ? (
        <div className="rounded-[14px] border border-[#e6e9f5] bg-white px-5 py-4 shadow-sm mb-5">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h2 className="text-[16px] font-[600] text-[#1f296a]">Ingest today — files landing on NAS</h2>
            <span className="text-[12px] text-[#9aa2c0]">
              {intake.today}{intake.tz ? ` (${intake.tz})` : ""}
              {intake.elapsedSec ? ` · ${(intake.elapsedSec / 3600).toFixed(1)}h elapsed` : ""}
              {intake.computedAt ? ` · scanned ${new Date(intake.computedAt).toLocaleTimeString()}` : ""}
            </span>
          </div>

          <div className="flex gap-3 flex-wrap mb-4">
            <MiniKpi label="Files today" value={fmtNum(intake.totals?.filesToday)} />
            <MiniKpi label="Data today" value={fmtBytes(intake.totals?.bytesToday)} accent="#7c3aed" />
            <MiniKpi label="Projected (full day)" value={fmtNum(intake.totals?.projFiles)} sub={fmtBytes(intake.totals?.projBytes)} />
            <MiniKpi
              label="vs yesterday"
              value={pace == null ? "—" : `${pace >= 0 ? "+" : ""}${pace}%`}
              accent={pace == null ? "#1f296a" : pace >= 0 ? "#16a34a" : "#cf1322"}
              sub={`${fmtNum(intake.totals?.filesD1)} yest.`}
            />
          </div>

          {hourData.some((d) => d.files > 0) ? (
            <div className="mb-3">
              <div className="text-[12px] text-[#9aa2c0] mb-1">Files per hour (today, all networks)</div>
              <ResponsiveContainer width="100%" height={92}>
                <BarChart data={hourData} margin={{ left: 0, right: 8, top: 4 }}>
                  <XAxis dataKey="h" tick={{ fontSize: 10 }} interval={1} />
                  <YAxis hide />
                  <RTooltip formatter={(v) => `${fmtNum(v)} files`} labelFormatter={(h) => `${h}:00`} />
                  <Bar dataKey="files" fill="#1f296a" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full text-[13px] border-collapse">
              <thead>
                <tr className="text-[#7a83a8] border-b border-[#eef1fb]">
                  <th className="text-left py-2 pr-3 font-[600]">Network</th>
                  {intakeTrees.map((t) => <th key={t} className="text-right px-2 py-2 font-[600]">{TREE_LABEL[t] || t}</th>)}
                  <th className="text-right px-2 py-2 font-[700]">Today</th>
                  <th className="text-right pl-3 py-2 font-[600]">Status</th>
                </tr>
              </thead>
              <tbody>
                {intakeRows.map((r) => (
                  <tr key={r.key} className="border-b border-[#f4f6fd]">
                    <td className="py-2 pr-3 font-[600] text-[#1f296a] whitespace-nowrap">
                      <span className="inline-block w-2 h-2 rounded-full mr-2 align-middle" style={{ background: NET_COLOR[r.key] || "#1f296a" }} />
                      {r.name}
                    </td>
                    {intakeTrees.map((t) => {
                      const e = r.trees?.[t];
                      const v = e?.today || 0;
                      return (
                        <td
                          key={t}
                          className="text-right px-2 py-2 tabular-nums"
                          style={{ color: v ? "#1f296a" : "#c7cce0" }}
                          title={e ? `${fmtNum(v)} files · ${fmtBytes(e.todayBytes)} · prev days ${fmtNum(e.d1)} / ${fmtNum(e.d2)}` : ""}
                        >
                          {v ? fmtNum(v) : "·"}
                        </td>
                      );
                    })}
                    <td className="text-right px-2 py-2 font-[700] tabular-nums">{fmtNum(r.filesToday)}</td>
                    <td className="text-right pl-3 py-2"><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="text-[#1f296a] font-[700] border-t-2 border-[#eef1fb]">
                  <td className="py-2 pr-3">Total</td>
                  {intakeTrees.map((t) => {
                    const sum = intakeRows.reduce((s, r) => s + (r.trees?.[t]?.today || 0), 0);
                    return <td key={t} className="text-right px-2 py-2 tabular-nums">{sum ? fmtNum(sum) : "·"}</td>;
                  })}
                  <td className="text-right px-2 py-2 tabular-nums">{fmtNum(intake.totals?.filesToday)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-[14px] border border-[#e6e9f5] bg-white px-5 py-4 shadow-sm mb-5 text-[13px] text-[#9aa2c0]">
          Ingest matrix is computed hourly on the NAS — it will appear here after the first scan completes.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* per-network breakdown */}
        <div className="rounded-[14px] border border-[#e6e9f5] bg-white px-5 py-4 shadow-sm">
          <h2 className="text-[16px] font-[600] text-[#1f296a] mb-1">Storage by network</h2>
          <p className="text-[12px] text-[#9aa2c0] mb-3">
            {perNetwork
              ? `Total ${fmtBytes(perNetwork.total)} across ${netData.length} networks`
              : "Computing… first daily scan runs at server-time midnight"}
          </p>
          {netData.length ? (
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={netData} layout="vertical" margin={{ left: 20, right: 36 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => fmtBytes(v)} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={82} tick={{ fontSize: 12 }} />
                <RTooltip formatter={(v) => fmtBytes(v)} />
                <Bar dataKey="bytes" radius={[0, 6, 6, 0]}>
                  {netData.map((d) => <Cell key={d.key} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[340px] flex items-center justify-center text-[#9aa2c0] text-[14px] text-center px-6">
              {loading ? "Loading…" : "Per-network breakdown is computed once a day (midnight). It will appear after the first scan completes."}
            </div>
          )}
        </div>

        {/* daily growth */}
        <div className="rounded-[14px] border border-[#e6e9f5] bg-white px-5 py-4 shadow-sm">
          <h2 className="text-[16px] font-[600] text-[#1f296a] mb-1">Daily growth</h2>
          <p className="text-[12px] text-[#9aa2c0] mb-3">Day-over-day increase in used space (GB)</p>
          {growthData.length ? (
            <ResponsiveContainer width="100%" height={340}>
              <AreaChart data={growthData} margin={{ left: 0, right: 20 }}>
                <defs>
                  <linearGradient id="nasGrowth" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1f296a" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#1f296a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}G`} />
                <RTooltip formatter={(v) => `${v} GB`} />
                <Area type="monotone" dataKey="gb" stroke="#1f296a" strokeWidth={2} fill="url(#nasGrowth)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[340px] flex items-center justify-center text-[#9aa2c0] text-[14px]">
              Need ≥2 daily snapshots to chart growth.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NasStorage;
