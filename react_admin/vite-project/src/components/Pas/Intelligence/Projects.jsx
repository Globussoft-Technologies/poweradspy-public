import React, { useState, useEffect, useRef } from "react";
import { RxCross1 } from "react-icons/rx";
import Cookies from "js-cookie";

const NODE_API = (import.meta.env.VITE_NODE_USER_ACTIVITY_API ?? "").trim().replace(/\/$/, "");

const AVATAR_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6",
  "#3b82f6", "#ec4899", "#14b8a6", "#f97316", "#06b6d4",
];

const MAX_TAGS = 4;

const TagList = ({ items, bg, border, color, forceExpand = false }) => {
  const [expanded, setExpanded] = useState(false);
  if (!items || items.length === 0) return <span style={{ color: "#9ca3af" }}>—</span>;
  const isExpanded = forceExpand || expanded;
  const visible = isExpanded ? items : items.slice(0, MAX_TAGS);
  const hidden = items.length - MAX_TAGS;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
      {visible.map((item, i) => (
        <span key={i} style={{ background: bg, border: `1px solid ${border}`, color, padding: "2px 8px", borderRadius: "4px", fontSize: "11px", whiteSpace: "nowrap" }}>
          {item}
        </span>
      ))}
      {!isExpanded && hidden > 0 && (
        <button onClick={() => setExpanded(true)} style={{ background: "#e0e7ff", border: "1px solid #c7d2fe", color: "#4338ca", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>
          +{hidden} more
        </button>
      )}
      {isExpanded && !forceExpand && hidden > 0 && (
        <button onClick={() => setExpanded(false)} style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", color: "#6b7280", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", whiteSpace: "nowrap" }}>
          show less
        </button>
      )}
    </div>
  );
};

function getAvatarProps(email) {
  if (!email) return { initials: "?", color: AVATAR_COLORS[0] };
  const parts = email.split(/[@._]/);
  const initials = (
    (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")
  ).toUpperCase() || email[0].toUpperCase();
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
  return { initials, color: AVATAR_COLORS[hash % AVATAR_COLORS.length] };
}

const PROJECT_TYPE_LABELS = {
  project_click:          { label: "Project Click",        color: "#6366f1", bg: "#e0e7ff" },
  competitor_comparison:  { label: "Competitor Comparison", color: "#d97706", bg: "#fef3c7" },
  dashboard:              { label: "Dashboard",            color: "#059669", bg: "#d1fae5" },
  delete_brand:           { label: "Delete Brand",         color: "#dc2626", bg: "#fee2e2" },
  monitoring_status:      { label: "Monitoring Status",    color: "#7c3aed", bg: "#ede9fe" },
  other:                  { label: "Other",                color: "#6b7280", bg: "#f3f4f6" },
};

const PAGE_SIZE = 10;

const EMPTY = { dateRange: "Last 90 days", userFilter: "" };

const FilterPill = ({ label, onRemove }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#e0e7ff", color: "#4338ca", fontSize: "12px", padding: "4px 12px", borderRadius: "9999px", border: "1px solid #c7d2fe" }}>
    {label}
    <RxCross1 style={{ fontSize: "10px", cursor: "pointer" }} onClick={onRemove} />
  </span>
);

const Projects = ({ forceExpand = false, onDataReady }) => {
  const [draft, setDraft]     = useState({ ...EMPTY });
  const [applied, setApplied] = useState({ ...EMPTY });
  const appliedRef            = useRef({ ...EMPTY });

  const [page, setPage]           = useState(0);
  const [fetchTick, setFetchTick] = useState(0);

  const [rows, setRows]           = useState([]);
  const [total, setTotal]         = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [dateLabel, setDateLabel] = useState("");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!NODE_API) { setError("API URL not configured"); return; }
      setLoading(true);
      setError(null);
      const f = appliedRef.current;
      try {
        const params = new URLSearchParams();
        params.set("date_range", f.dateRange);
        params.set("page", String(page));
        params.set("size", String(PAGE_SIZE));
        if (f.userFilter) params.set("user", f.userFilter);

        const token = Cookies.get("token");
        const res = await fetch(`${NODE_API}/intelligence/projects?${params.toString()}`, {
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        const json = await res.json();
        if (json.code !== 200) throw new Error(json.message || "Unexpected response");

        setRows(json.data.rows ?? []);
        setTotal(json.data.total ?? 0);
        setTotalPages(json.data.total_pages ?? 1);
        setDateLabel(json.meta?.date_label ?? "");
      } catch (err) {
        setError(err.message || "Failed to load data");
        setRows([]);
        setTotal(0);
        setTotalPages(1);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchTick, page]);

  const applyImmediate = (patch) => {
    const next = { ...appliedRef.current, ...patch };
    appliedRef.current = next;
    setApplied(next);
    setDraft((d) => ({ ...d, ...patch }));
    setPage(0);
    setFetchTick((t) => t + 1);
  };

  const handleApply = () => {
    const next = { ...draft };
    appliedRef.current = next;
    setApplied(next);
    setPage(0);
    setFetchTick((t) => t + 1);
  };

  const handleReset = () => {
    appliedRef.current = { ...EMPTY };
    setApplied({ ...EMPTY });
    setDraft({ ...EMPTY });
    setPage(0);
    setFetchTick((t) => t + 1);
  };

  const clearChip = (patch) => {
    const next = { ...applied, ...patch };
    appliedRef.current = next;
    setApplied(next);
    setDraft(next);
    setPage(0);
    setFetchTick((t) => t + 1);
  };

  const activeChips = [
    { key: "dateRange", label: applied.dateRange, clear: () => clearChip({ dateRange: "Last 90 days" }) },
    applied.userFilter && { key: "user", label: `User: ${applied.userFilter}`, clear: () => clearChip({ userFilter: "" }) },
  ].filter(Boolean);

  // Expose live data for native PDF export
  const exportDataRef = useRef(null);
  exportDataRef.current = { rows, applied, total, dateLabel };
  useEffect(() => {
    if (onDataReady) onDataReady(() => exportDataRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDataReady]);

  const renderBody = () => {
    if (loading) return (
      <tr><td colSpan={5} style={{ padding: "40px 12px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>Loading...</td></tr>
    );
    if (error) return (
      <tr><td colSpan={5} style={{ padding: "40px 12px", textAlign: "center", color: "#ef4444", fontSize: "13px" }}>{error}</td></tr>
    );
    if (rows.length === 0) return (
      <tr><td colSpan={5} style={{ padding: "40px 12px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>No project activity found.</td></tr>
    );

    return rows.map((row, i) => {
      const { initials, color } = getAvatarProps(row.email);
      const typeInfo = PROJECT_TYPE_LABELS[row.project_type] ?? PROJECT_TYPE_LABELS.other;

      return (
        <tr
          key={i}
          style={{ borderBottom: "1px solid #f3f4f6", backgroundColor: "white" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f9fafb")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "white")}
        >
          <td style={{ padding: "10px 12px", color: "#6b7280", fontSize: "12px", whiteSpace: "nowrap" }}>
            {row.timestamp ?? "—"}
          </td>
          <td style={{ padding: "10px 12px", verticalAlign: "middle" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
              <span style={{ width: "26px", height: "26px", borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, color: "white", backgroundColor: color }}>
                {initials}
              </span>
              <span style={{ overflow: forceExpand ? "visible" : "hidden", textOverflow: forceExpand ? "unset" : "ellipsis", whiteSpace: forceExpand ? "normal" : "nowrap", wordBreak: forceExpand ? "break-all" : "normal", color: "#111827", fontSize: "12px" }}>
                {row.email ?? "—"}
              </span>
            </div>
          </td>
          <td style={{ padding: "10px 12px" }}>
            <span style={{ background: typeInfo.bg, color: typeInfo.color, padding: "2px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap" }}>
              {row.project_type === "monitoring_status" && row.monitoring_status != null
                ? `Monitoring Status: ${String(row.monitoring_status).charAt(0).toUpperCase() + String(row.monitoring_status).slice(1)}`
                : typeInfo.label}
            </span>
          </td>
          <td style={{ padding: "10px 12px", verticalAlign: "middle" }}>
            <TagList items={row.brands ? row.brands.split(', ') : []} bg="#f3f4f6" border="#e5e7eb" color="#374151" forceExpand={forceExpand} />
          </td>
          <td style={{ padding: "10px 12px", verticalAlign: "middle" }}>
            <TagList items={row.competitors ? row.competitors.split(', ') : []} bg="#e0e7ff" border="#c7d2fe" color="#4338ca" forceExpand={forceExpand} />
          </td>
        </tr>
      );
    });
  };

  const showFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const showTo   = Math.min((page + 1) * PAGE_SIZE, total);

  const inputStyle = { border: "1px solid #d1d5db", borderRadius: "6px", padding: "6px 8px", fontSize: "12px", color: "#374151", outline: "none", width: "100%", boxSizing: "border-box" };
  const labelStyle = { fontSize: "10px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "4px" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Filter row — hidden during PDF export */}
      <div style={{ display: forceExpand ? "none" : "block", background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", padding: "16px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "12px" }}>
          <div style={{ display: "flex", flexDirection: "column", width: "280px" }}>
            <label style={labelStyle}>Date Range</label>
            <select
              value={draft.dateRange}
              onChange={(e) => applyImmediate({ dateRange: e.target.value })}
              style={{ ...inputStyle, background: "white" }}
            >
              <option>Last 90 days</option>
              <option>Last 30 days</option>
              <option>Last 7 days</option>
              <option>Today</option>
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <label style={labelStyle}>User</label>
            <input
              value={draft.userFilter}
              onChange={(e) => setDraft((d) => ({ ...d, userFilter: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && handleApply()}
              placeholder="Search email..."
              style={inputStyle}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button onClick={handleApply} style={{ display: "flex", alignItems: "center", gap: "4px", background: "white", color: "#374151", fontSize: "12px", fontWeight: 600, padding: "6px 16px", borderRadius: "6px", border: "1px solid #d1d5db", cursor: "pointer" }}>
              ↓ Apply
            </button>
            <button onClick={handleReset} style={{ display: "flex", alignItems: "center", gap: "4px", border: "1px solid #d1d5db", color: "#374151", fontSize: "12px", fontWeight: 500, padding: "6px 12px", borderRadius: "6px", background: "white", cursor: "pointer" }}>
              ↺ Reset
            </button>
          </div>
        </div>
      </div>

      {/* Active chips + count */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
        {!forceExpand && <span style={{ fontSize: "12px", color: "#6b7280" }}>Active filters:</span>}
        {activeChips.map((chip) => (
          forceExpand
            ? <span key={chip.key} style={{ display: "inline-block", background: "#e0e7ff", color: "#4338ca", fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "9999px", border: "1px solid #c7d2fe" }}>{chip.label}</span>
            : <FilterPill key={chip.key} label={chip.label} onRemove={chip.clear} />
        ))}
      </div>
      <div>
        <p style={{ fontSize: "12px", color: "#6b7280", margin: 0 }}>
          {total.toLocaleString()} project events{dateLabel ? ` · ${dateLabel}` : ""}
        </p>
      </div>

      {/* Table */}
      <div style={{ background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", tableLayout: "fixed", fontSize: "13px", borderCollapse: "collapse" }}>
            <colgroup>
              <col style={{ width: "110px" }} />
              <col style={{ width: "200px" }} />
              <col style={{ width: "110px" }} />
              <col style={{ width: "220px" }} />
              <col style={{ width: "220px" }} />
            </colgroup>
            <thead>
              <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                {["TIMESTAMP", "USER", "TYPE", "BRANDS", "COMPETITORS"].map((h) => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: "11px", fontWeight: 600, color: "#9ca3af", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{renderBody()}</tbody>
          </table>
        </div>

        {/* Pagination */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderTop: "1px solid #e5e7eb" }}>
          <p style={{ fontSize: "12px", color: "#6b7280" }}>Showing {showFrom}–{showTo} of {total.toLocaleString()}</p>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "12px", color: "#6b7280" }}>Page {page + 1} / {totalPages}</span>
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}
              style={{ fontSize: "12px", color: "#6b7280", padding: "4px 8px", cursor: page === 0 ? "not-allowed" : "pointer", opacity: page === 0 ? 0.3 : 1, background: "none", border: "none" }}>
              ‹ Prev
            </button>
            <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}
              style={{ fontSize: "12px", color: "#6b7280", padding: "4px 8px", cursor: page >= totalPages - 1 ? "not-allowed" : "pointer", opacity: page >= totalPages - 1 ? 0.3 : 1, background: "none", border: "none" }}>
              Next ›
            </button>
          </div>
        </div>

        <div style={{ padding: "10px 16px", background: "#f9fafb", borderTop: "1px solid #e5e7eb" }}>
          <p style={{ fontSize: "11px", color: "#9ca3af" }}>
            ℹ Project activity is retained for 90 days.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Projects;
