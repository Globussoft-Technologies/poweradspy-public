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

const KpiTile = ({ label, value, accent = "#1f296a", sub }) => (
  <div className="flex flex-col justify-between rounded-[14px] border border-[#e6e9f5] bg-white px-5 py-4 shadow-sm min-w-[160px]">
    <span className="text-[13px] font-medium text-[#7a83a8] uppercase tracking-wide">{label}</span>
    <span className="text-[30px] font-[700] leading-tight" style={{ color: accent }}>{value}</span>
    {sub ? <span className="text-[12px] text-[#9aa2c0]">{sub}</span> : null}
  </div>
);

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
