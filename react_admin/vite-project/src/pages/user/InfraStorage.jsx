import { useEffect, useState, useCallback, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { FiRefreshCw, FiServer, FiDatabase } from "react-icons/fi";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Cell,
} from "recharts";
import { fetchInfraStorage } from "../../store/actions/powerAdsPyActionsApi";

/* ------------------------------------------------------------------ */
/* Infrastructure storage — per-DB-host + per-table sizes (which table */
/* uses how much) and per-ES-cluster disk (used / free). Background-   */
/* snapshotted on the backend; this page auto-refreshes.              */
/* ------------------------------------------------------------------ */

const REFRESH_OPTIONS = [
  { value: 0, label: "Off" },
  { value: 30000, label: "30s" },
  { value: 60000, label: "1m" },
  { value: 300000, label: "5m" },
];

// dominant database name -> friendly network label
const NET_OF_DB = {
  "pas-gtext": "Google Search", nativepro: "Native (old)", nativepro_v2: "Native",
  facebook_sql: "Facebook", instagram_sql: "Instagram", ytpro: "YouTube",
  pinterestpro: "Pinterest", gdnpro_v2: "GDN", gdnpro: "GDN (old)", redditpro: "Reddit",
  linkedpro: "LinkedIn", tiktok_sql: "TikTok", quorapro: "Quora",
};
const PALETTE = ["#1f296a", "#264688", "#7c3aed", "#16a34a", "#0ea5e9", "#e1306c", "#ff7f0e", "#b92b27", "#0a66c2", "#34a853", "#ef4444"];

const fmtGB = (g) => {
  if (g == null || !Number.isFinite(+g)) return "—";
  return +g >= 1024 ? `${(+g / 1024).toFixed(2)} TB` : `${(+g).toFixed(1)} GB`;
};
const fmtRows = (n) => {
  if (!n) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
};
const labelOf = (host) => {
  const top = host.databases && host.databases[0] && host.databases[0].db;
  return top ? (NET_OF_DB[top] || top) : `host ${host.server}`;
};

const KpiTile = ({ label, value, accent = "#1f296a", sub }) => (
  <div className="flex flex-col justify-between rounded-[14px] border border-[#e6e9f5] bg-white px-5 py-4 shadow-sm min-w-[170px]">
    <span className="text-[13px] font-medium text-[#7a83a8] uppercase tracking-wide">{label}</span>
    <span className="text-[28px] font-[700] leading-tight" style={{ color: accent }}>{value}</span>
    {sub ? <span className="text-[12px] text-[#9aa2c0]">{sub}</span> : null}
  </div>
);

const Bar2 = ({ pct, color }) => (
  <div className="h-[8px] w-full rounded-full bg-[#eef1fb] overflow-hidden">
    <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, pct || 0))}%`, background: color }} />
  </div>
);

const InfraStorage = () => {
  const dispatch = useDispatch();
  const infra = useSelector((s) => s.poweradspy?.infraStorage);
  const loading = useSelector((s) => s.poweradspy?.loadingInfraStorage);
  const error = useSelector((s) => s.poweradspy?.infraStorageError);
  const [refreshMs, setRefreshMs] = useState(30000);

  const load = useCallback(() => {
    dispatch(fetchInfraStorage()).unwrap().catch(() => {});
  }, [dispatch]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!refreshMs) return undefined;
    const id = setInterval(load, refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, load]);

  const payload = infra?.data || null;
  const summary = payload?.summary || null;
  const ageSec = infra?.ageSec;
  const computing = infra?.computing;

  const dbHosts = useMemo(
    () => (payload?.databases || []).filter((d) => d.ok).slice().sort((a, b) => b.totalGB - a.totalGB),
    [payload]
  );
  const dbErr = (payload?.databases || []).filter((d) => !d.ok);
  const servers = payload?.servers || [];
  const serversAt = payload?.serversAt;
  const esClusters = payload?.elasticsearch || [];
  const maxHostGB = dbHosts.length ? dbHosts[0].totalGB : 1;

  const dbChartData = useMemo(
    () => dbHosts.map((h, i) => ({ name: labelOf(h), gb: h.totalGB, color: PALETTE[i % PALETTE.length] })),
    [dbHosts]
  );

  return (
    <div className="px-6 py-5">
      {/* header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div>
          <h1 className="text-[26px] font-[700] text-[#1f296a] flex items-center gap-2">
            <FiServer /> Infrastructure Storage
          </h1>
          <p className="text-[13px] text-[#7a83a8]">
            Database servers + Elasticsearch clusters across the fleet
            {ageSec != null ? ` · snapshot ${ageSec < 90 ? `${ageSec}s` : `${Math.round(ageSec / 60)}m`} old` : ""}
            {computing ? " · refreshing…" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={refreshMs} onChange={(e) => setRefreshMs(Number(e.target.value))}
            className="border border-[#e6e9f5] rounded-[10px] px-3 py-2 text-[14px] text-[#1f296a]">
            {REFRESH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{`Refresh: ${o.label}`}</option>)}
          </select>
          <button onClick={load} className="flex items-center gap-1.5 border border-[#e6e9f5] rounded-[10px] px-3 py-2 text-[14px] text-[#1f296a] hover:bg-[#f1f3ff]">
            <FiRefreshCw className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      {error ? <div className="mb-4 rounded-[10px] bg-[#fff1f0] border border-[#ffccc7] px-4 py-2 text-[13px] text-[#cf1322]">{String(error)}</div> : null}
      {!payload && !error ? (
        <div className="rounded-[14px] border border-[#e6e9f5] bg-white px-6 py-10 text-center text-[#9aa2c0]">
          Computing the first fleet-wide storage snapshot… (scans 11 DB hosts + 5 ES clusters)
        </div>
      ) : null}

      {summary ? (
        <div className="flex gap-4 flex-wrap mb-5">
          <KpiTile label="DB Storage" value={fmtGB(summary.dbTotalGB)} sub={`${summary.dbHostsOk}/${summary.dbHosts} hosts`} />
          <KpiTile label="ES Storage Used" value={fmtGB(summary.esUsedGB)} accent="#7c3aed" sub={`${summary.esClustersOk}/${summary.esClusters} clusters`} />
          <KpiTile label="Total Tracked" value={fmtGB((summary.dbTotalGB || 0) + (summary.esUsedGB || 0))} accent="#16a34a" />
        </div>
      ) : null}

      {servers.length ? (
        <div className="rounded-[14px] border border-[#e6e9f5] bg-white px-5 py-4 shadow-sm mb-5">
          <div className="flex justify-between items-baseline mb-3">
            <h2 className="text-[16px] font-[600] text-[#1f296a] flex items-center gap-2"><FiServer /> Servers — root disk</h2>
            {serversAt ? <span className="text-[12px] text-[#9aa2c0]">swept {Math.max(0, Math.round((Date.now() - new Date(serversAt).getTime()) / 60000))}m ago</span> : null}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
            {servers.filter((s) => !s.error).slice().sort((a, b) => b.pctUsed - a.pctUsed).map((s) => {
              const col = s.pctUsed > 85 ? "#cf1322" : s.pctUsed > 70 ? "#fa8c16" : "#16a34a";
              return (
                <div key={s.label}>
                  <div className="flex justify-between text-[12px] mb-1">
                    <span className="text-[#1f296a] font-medium">{s.label}</span>
                    <span className="text-[#7a83a8]">{fmtGB(s.usedGB)} / {fmtGB(s.totalGB)} · <span style={{ color: col, fontWeight: 600 }}>{fmtGB(s.availGB)} free</span></span>
                  </div>
                  <Bar2 pct={s.pctUsed} color={col} />
                </div>
              );
            })}
          </div>
          {servers.some((s) => s.error) ? (
            <p className="text-[11px] text-[#ad8b00] mt-3">Unreachable: {servers.filter((s) => s.error).map((s) => s.label).join(", ")}</p>
          ) : null}
        </div>
      ) : null}

      {dbHosts.length ? (
        <>
          {/* DB servers overview chart */}
          <div className="rounded-[14px] border border-[#e6e9f5] bg-white px-5 py-4 shadow-sm mb-5">
            <h2 className="text-[16px] font-[600] text-[#1f296a] mb-3 flex items-center gap-2"><FiDatabase /> Database servers by size</h2>
            <ResponsiveContainer width="100%" height={Math.max(220, dbChartData.length * 34)}>
              <BarChart data={dbChartData} layout="vertical" margin={{ left: 30, right: 50 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => fmtGB(v)} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12 }} />
                <RTooltip formatter={(v) => fmtGB(v)} />
                <Bar dataKey="gb" radius={[0, 6, 6, 0]}>
                  {dbChartData.map((d) => <Cell key={d.name} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* per-host top tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
            {dbHosts.map((h, i) => (
              <div key={h.server} className="rounded-[14px] border border-[#e6e9f5] bg-white px-5 py-4 shadow-sm">
                <div className="flex justify-between items-baseline mb-1">
                  <h3 className="text-[15px] font-[600] text-[#1f296a]">{labelOf(h)}</h3>
                  <span className="text-[15px] font-[700]" style={{ color: PALETTE[i % PALETTE.length] }}>{fmtGB(h.totalGB)}</span>
                </div>
                <p className="text-[12px] text-[#9aa2c0] mb-2">
                  {h.dbCount} database{h.dbCount === 1 ? "" : "s"}: {h.databases.map((d) => `${d.db} (${fmtGB(d.gb)})`).join(" · ")}
                </p>
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-[#7a83a8] text-left">
                      <th className="font-medium pb-1">Largest tables</th>
                      <th className="font-medium pb-1 text-right">Size</th>
                      <th className="font-medium pb-1 text-right">Rows</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.topTables.slice(0, 6).map((t) => (
                      <tr key={`${t.db}.${t.table}`} className="border-t border-[#f0f2fa]">
                        <td className="py-1 text-[#1f296a]"><span className="text-[#9aa2c0]">{t.db}.</span>{t.table}</td>
                        <td className="py-1 text-right tabular-nums">{fmtGB(t.gb)}</td>
                        <td className="py-1 text-right tabular-nums text-[#7a83a8]">{fmtRows(t.rows)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {dbErr.length ? (
        <div className="mb-5 rounded-[10px] bg-[#fffbe6] border border-[#ffe58f] px-4 py-2 text-[12px] text-[#ad8b00]">
          {dbErr.length} DB host(s) unreachable this snapshot: {dbErr.map((d) => `host ${d.server}`).join(", ")}
        </div>
      ) : null}

      {/* ES clusters */}
      {esClusters.length ? (
        <div>
          <h2 className="text-[16px] font-[600] text-[#1f296a] mb-3 flex items-center gap-2"><FiServer /> Elasticsearch clusters</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {esClusters.map((e) => (
              <div key={e.node} className="rounded-[14px] border border-[#e6e9f5] bg-white px-5 py-4 shadow-sm">
                {e.ok ? (
                  <>
                    <div className="flex justify-between items-baseline mb-1">
                      <h3 className="text-[15px] font-[600] text-[#1f296a]">ES cluster {e.node + 1}</h3>
                      <span className="text-[13px] text-[#7a83a8]">{e.indexCount} indices · {fmtGB(e.totalIndicesGB)}</span>
                    </div>
                    <div className="flex justify-between text-[12px] text-[#7a83a8] mb-1">
                      <span>Disk {fmtGB(e.allocation.usedGB)} / {fmtGB(e.allocation.totalGB)}</span>
                      <span className="text-[#16a34a]">{fmtGB(e.allocation.availGB)} free</span>
                    </div>
                    <div className="mb-3">
                      <Bar2 pct={e.allocation.pctUsed} color={e.allocation.pctUsed > 85 ? "#cf1322" : e.allocation.pctUsed > 70 ? "#fa8c16" : "#16a34a"} />
                    </div>
                    <table className="w-full text-[12px]">
                      <tbody>
                        {e.topIndices.slice(0, 6).map((x) => (
                          <tr key={x.index} className="border-t border-[#f0f2fa]">
                            <td className="py-1 text-[#1f296a]">{x.index}</td>
                            <td className="py-1 text-right tabular-nums">{fmtGB(x.gb)}</td>
                            <td className="py-1 text-right tabular-nums text-[#7a83a8]">{fmtRows(x.docs)} docs</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <div className="text-[13px] text-[#cf1322]">ES cluster {e.node + 1} — unreachable: {String(e.error || "").slice(0, 60)}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default InfraStorage;
