import React, { useState, useEffect, useRef } from "react";
import { FaArrowUp, FaArrowDown } from "react-icons/fa";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import Cookies from "js-cookie";

const NODE_API = (import.meta.env.VITE_NODE_USER_ACTIVITY_API ?? "").trim().replace(/\/$/, "");

const COLORS = ["#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444","#14b8a6"];

const TYPE_TABS = [
  { key: "keywords",    label: "Keywords"    },
  { key: "advertisers", label: "Advertisers" },
  { key: "domains",     label: "Domains"     },
];

const KeywordTrends = ({ onDataReady }) => {
  const [sortBy,  setSortBy]  = useState("count");
  const [typeTab, setTypeTab] = useState("keywords");
  const [data,    setData]    = useState({ keywords: [], advertisers: [], domains: [] });
  const [meta,    setMeta]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    const fetchTrends = async () => {
      if (!NODE_API) { setError("API URL not configured"); return; }
      setLoading(true);
      setError(null);
      try {
        const token = Cookies.get("token");
        const params = new URLSearchParams({ type: "all", sort_by: sortBy, size: "20" });
        const res = await fetch(`${NODE_API}/intelligence/keyword-trends?${params}`, {
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        const json = await res.json();
        if (json.code !== 200) throw new Error(json.message || "Unexpected response");
        setData({
          keywords:    json.data.keywords    ?? [],
          advertisers: json.data.advertisers ?? [],
          domains:     json.data.domains     ?? [],
        });
        setMeta(json.meta ?? null);
      } catch (err) {
        setError(err.message || "Failed to load trends");
      } finally {
        setLoading(false);
      }
    };
    fetchTrends();
  }, [sortBy]);

  // Expose live data for native PDF export
  const exportDataRef = useRef(null);
  exportDataRef.current = { data, typeTab, sortBy, meta };
  useEffect(() => {
    if (onDataReady) onDataReady(() => exportDataRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDataReady]);

  const currentList = data[typeTab] ?? [];

  const chartData = [...currentList]
    .sort((a, b) => sortBy === "growth"
      ? (b.growth_pct ?? -Infinity) - (a.growth_pct ?? -Infinity)
      : b.count - a.count
    )
    .slice(0, 8);

  const maxCount = currentList.length > 0 ? Math.max(...currentList.map((r) => r.count)) : 1;

  const renderContent = () => {
    if (loading) return (
      <div style={{ padding: "60px 0", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>
        Loading trends...
      </div>
    );
    if (error) return (
      <div style={{ padding: "60px 0", textAlign: "center", color: "#ef4444", fontSize: "13px" }}>
        {error}
      </div>
    );
    if (currentList.length === 0) return (
      <div style={{ padding: "60px 0", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>
        No data found for this category.
      </div>
    );

    return (
      <>
        {/* Chart */}
        <div style={{ background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", padding: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px", flexWrap: "wrap", gap: "8px" }}>
            <p style={{ fontSize: "13px", fontWeight: 600, color: "#374151", margin: 0 }}>
              Top {TYPE_TABS.find((t) => t.key === typeTab)?.label} by {sortBy === "count" ? "Search Volume" : "Growth Rate"}
            </p>
            {meta && (
              <span style={{ fontSize: "11px", color: "#9ca3af" }}>
                Current: {meta.current_period} &nbsp;|&nbsp; vs {meta.previous_period}
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} layout="vertical" barSize={18} margin={{ top: 0, right: 32, bottom: 0, left: 0 }}>
              <XAxis type="number" domain={[0, 'dataMax']} tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <YAxis
                type="category" dataKey="term" width={160}
                tick={{ fontSize: 11, fill: "#374151" }} axisLine={false} tickLine={false}
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                formatter={(v) => [
                  sortBy === "count" ? v.toLocaleString() : `${v}%`,
                  sortBy === "count" ? "Searches" : "Growth",
                ]}
              />
              <Bar dataKey={sortBy === "count" ? "count" : "growth_pct"} radius={[0, 4, 4, 0]}>
                {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Table */}
        <div style={{ background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", tableLayout: "fixed", fontSize: "13px", borderCollapse: "collapse" }}>
              <colgroup>
                <col style={{ width: "40px" }} />
                <col style={{ width: "35%" }} />
                <col style={{ width: "28%" }} />
                <col style={{ width: "20%" }} />
                <col style={{ width: "17%" }} />
              </colgroup>
              <thead>
                <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                  {["#", TYPE_TABS.find((t) => t.key === typeTab)?.label.toUpperCase(), "SEARCH COUNT", "GROWTH RATE", "PREV COUNT"].map((h) => (
                    <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: "11px", fontWeight: 600, color: "#9ca3af", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentList.map((row, idx) => (
                  <tr
                    key={row.term}
                    style={{ borderBottom: "1px solid #f3f4f6", backgroundColor: "white" }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f9fafb")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "white")}
                  >
                    <td style={{ padding: "10px 12px", color: "#9ca3af" }}>{idx + 1}</td>
                    <td style={{ padding: "10px 12px", fontWeight: 500, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row.term}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div style={{ width: "80px", height: "5px", background: "#e5e7eb", borderRadius: "9999px", overflow: "hidden", flexShrink: 0 }}>
                          <div style={{ height: "100%", background: "#6366f1", borderRadius: "9999px", width: `${Math.round((row.count / maxCount) * 100)}%` }} />
                        </div>
                        <span style={{ fontWeight: 600, color: "#111827" }}>{row.count.toLocaleString()}</span>
                      </div>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      {row.growth_pct === null ? (
                        <span style={{ color: "#9ca3af", fontSize: "12px" }}>No prev data</span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontWeight: 600, fontSize: "12px", color: row.growth_pct >= 0 ? "#10b981" : "#ef4444" }}>
                          {row.growth_pct >= 0
                            ? <FaArrowUp style={{ fontSize: "10px" }} />
                            : <FaArrowDown style={{ fontSize: "10px" }} />}
                          {Math.abs(row.growth_pct)}%
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "10px 12px", color: "#6b7280", fontSize: "12px" }}>
                      {row.prev_count.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Controls row */}
      <div style={{ background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        {/* Type tabs */}
        <div style={{ display: "flex", alignItems: "center", gap: "4px", background: "#f3f4f6", borderRadius: "8px", padding: "4px" }}>
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setTypeTab(tab.key)}
              style={{ padding: "6px 16px", borderRadius: "6px", fontSize: "12px", fontWeight: 500, border: typeTab === tab.key ? "1px solid #e5e7eb" : "1px solid transparent", cursor: "pointer", background: typeTab === tab.key ? "white" : "transparent", color: typeTab === tab.key ? "#111827" : "#6b7280", boxShadow: "none" }}
            >
              {tab.label}
              {!loading && data[tab.key]?.length > 0 && (
                <span style={{ marginLeft: "6px", fontSize: "11px", fontWeight: 600, color: typeTab === tab.key ? "#4338ca" : "#9ca3af" }}>
                  {data[tab.key].length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Sort controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "12px", color: "#6b7280" }}>Sort by:</span>
          <button
            onClick={() => setSortBy("count")}
            className="px-3 py-1 rounded-full text-[12px] font-[500] transition"
            style={{ background: sortBy === "count" ? "#6366f1" : "#f3f4f6", color: sortBy === "count" ? "white" : "#6b7280", border: "none", cursor: "pointer" }}
          >
            Frequency
          </button>
          <button
            onClick={() => setSortBy("growth")}
            className="px-3 py-1 rounded-full text-[12px] font-[500] transition"
            style={{ background: sortBy === "growth" ? "#6366f1" : "#f3f4f6", color: sortBy === "growth" ? "white" : "#6b7280", border: "none", cursor: "pointer" }}
          >
            Growth Rate
          </button>
        </div>
      </div>

      {/* Growth rate info */}
      <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: "8px", padding: "10px 16px" }}>
        <p style={{ fontSize: "12px", color: "#0369a1", margin: 0 }}>
          <strong>Growth Rate</strong> compares the last 45 days vs the 45 days before that.&nbsp;
          <span style={{ display: "inline", fontSize: "11px", fontFamily: "monospace", border: "none", background: "none", color: "#0369a1", fontWeight: 600 }}>
            ((current 45d − prev 45d) ÷ prev 45d) × 100
          </span>
          &nbsp; "No prev data" = term didn't appear in the earlier period (new/emerging).
        </p>
      </div>

      {renderContent()}
    </div>
  );
};

export default KeywordTrends;
