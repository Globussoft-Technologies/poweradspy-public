import React, { useState, useEffect, useRef, useCallback } from "react";
import { RxCross1 } from "react-icons/rx";
import Cookies from "js-cookie";

const NODE_API = (import.meta.env.VITE_NODE_USER_ACTIVITY_API ?? "").trim().replace(/\/$/, "");

const AVATAR_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6",
  "#3b82f6", "#ec4899", "#14b8a6", "#f97316", "#06b6d4",
];

function getAvatarProps(email) {
  if (!email) return { initials: "?", color: AVATAR_COLORS[0] };
  const parts = email.split(/[@._]/);
  const initials = (
    (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")
  ).toUpperCase() || email[0].toUpperCase();
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
  }
  return { initials, color: AVATAR_COLORS[hash % AVATAR_COLORS.length] };
}

const PLATFORMS = ["Any", "Facebook", "Instagram", "Google", "GDN", "TikTok", "LinkedIn", "YouTube", "Reddit", "Pinterest", "Quora", "Native"];
const PAGE_SIZE = 10;

// Returns today's date as "YYYY-MM-DD" in local time
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

const EMPTY = {
  dateRange: "Last 90 days",
  fromDate: todayStr(), fromTime: "00:00",
  toDate: todayStr(),   toTime: "23:59",
  userFilter: "", keyword: "", advertiser: "", domain: "",
  platform: "Any", country: "",
};

// ── Autocomplete dropdown input ───────────────────────────────────────────────
const AutocompleteInput = ({ value, onChange, onCommit, placeholder, options, style }) => {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState(value);
  const wrapRef           = useRef(null);

  // Sync when parent resets value
  useEffect(() => { setQuery(value); }, [value]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = query
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase())).slice(0, 30)
    : options.slice(0, 30);

  const select = (val) => {
    setQuery(val);
    onChange(val);
    onCommit?.(val);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <input
        value={query}
        placeholder={placeholder}
        style={style}
        autoComplete="off"
        onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { onCommit?.(query); setOpen(false); }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 999,
          background: "white", border: "1px solid #d1d5db", borderRadius: "6px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.10)", maxHeight: "200px", overflowY: "auto",
          marginTop: "2px",
        }}>
          {filtered.map((opt) => (
            <div
              key={opt}
              onMouseDown={(e) => { e.preventDefault(); select(opt); }}
              style={{
                padding: "7px 12px", fontSize: "12px", color: "#374151", cursor: "pointer",
                borderBottom: "1px solid #f3f4f6", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f4f6")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const FilterPill = ({ label, onRemove }) => (
  <span className="flex items-center gap-1.5 bg-[#e0e7ff] text-[#4338ca] text-[12px] px-3 py-1 rounded-full border border-[#c7d2fe]">
    {label}
    <RxCross1 className="text-[10px] cursor-pointer hover:text-red-500" onClick={onRemove} />
  </span>
);

const MAX_PILLS_COLLAPSED = 3;

function groupPills(pills) {
  return pills.map((pill) => ({ display: pill, full: pill, isFirst: true }));
}

const PILL_COLLAPSE_LINES = 3; // line height ~18px, 3 lines = 54px

const PillItem = ({ text }) => {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split('\n');
  const isMultiLine = lines.length > 1;
  const isLong = text.length > 80;

  return (
    <div style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: "4px", padding: "2px 8px", fontSize: "11px", lineHeight: "1.6", color: "#374151", wordBreak: "break-word", maxWidth: "100%" }}>
      <span style={{
        display: "block",
        maxHeight: (!isLong || expanded) ? "none" : `${PILL_COLLAPSE_LINES * 18}px`,
        overflow: "hidden",
        whiteSpace: isMultiLine ? "pre-line" : "normal",
      }}>
        {text}
      </span>
      {isLong && !expanded && (
        <button onClick={() => setExpanded(true)} style={{ background: "none", border: "none", color: "#4338ca", fontSize: "11px", cursor: "pointer", fontWeight: 600, padding: "0", display: "block", marginTop: "1px" }}>
          show more
        </button>
      )}
      {isLong && expanded && (
        <button onClick={() => setExpanded(false)} style={{ background: "none", border: "none", color: "#6b7280", fontSize: "11px", cursor: "pointer", padding: "0", display: "block", marginTop: "1px" }}>
          show less
        </button>
      )}
    </div>
  );
};

const FilterPillsCell = ({ pills }) => {
  const [expanded, setExpanded] = useState(false);
  if (!pills || pills.length === 0) return null;

  const grouped = groupPills(pills);
  const visible = expanded ? grouped : grouped.slice(0, MAX_PILLS_COLLAPSED);
  const hidden  = grouped.length - MAX_PILLS_COLLAPSED;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", alignItems: "flex-start" }}>
      {visible.map((item, fi) => (
        <PillItem key={fi} text={item.display} />
      ))}
      {!expanded && hidden > 0 && (
        <button onClick={() => setExpanded(true)} style={{ background: "#e0e7ff", border: "1px solid #c7d2fe", color: "#4338ca", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", whiteSpace: "nowrap", fontWeight: 600 }}>
          +{hidden} more
        </button>
      )}
      {expanded && hidden > 0 && (
        <button onClick={() => setExpanded(false)} style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", color: "#6b7280", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", whiteSpace: "nowrap" }}>
          show less
        </button>
      )}
    </div>
  );
};

const MAX_PLATFORMS = 2;

const PlatformCell = ({ platforms }) => {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? platforms : platforms.slice(0, MAX_PLATFORMS);
  const hidden  = platforms.length - MAX_PLATFORMS;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "3px", alignItems: "center" }}>
      {visible.map((p, i) => (
        <span key={i} style={{ display: "inline-block", background: "#e0e7ff", color: "#4338ca", padding: "2px 8px", borderRadius: "4px", fontSize: "12px", whiteSpace: "nowrap" }}>
          {p}
        </span>
      ))}
      {!expanded && hidden > 0 && (
        <button onClick={() => setExpanded(true)} style={{ background: "#e0e7ff", border: "1px solid #c7d2fe", color: "#4338ca", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>
          +{hidden} more
        </button>
      )}
      {expanded && hidden > 0 && (
        <button onClick={() => setExpanded(false)} style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", color: "#6b7280", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", whiteSpace: "nowrap" }}>
          show less
        </button>
      )}
    </div>
  );
};

const AllSearches = ({ forceExpand = false, onDataReady }) => {
  // Filter option lists fetched once on mount for autocomplete
  const [filterOptions, setFilterOptions] = useState({ keywords: [], advertisers: [], domains: [], countries: [], users: [] });
  useEffect(() => {
    if (!NODE_API) return;
    const token = Cookies.get("token");
    fetch(`${NODE_API}/intelligence/filter-options`, {
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
      .then((r) => r.json())
      .then((j) => { if (j.code === 200) setFilterOptions(j.data); })
      .catch(() => {});
  }, []);

  // Draft filter state (form fields — not yet applied for text inputs)
  const [draft, setDraft] = useState({ ...EMPTY });

  // Applied state — drives the fetch
  const [applied, setApplied] = useState({ ...EMPTY });
  const appliedRef = useRef({ ...EMPTY });

  const [page, setPage] = useState(0);
  const [fetchTick, setFetchTick] = useState(0);

  // API state
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [dateLabel, setDateLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!NODE_API) {
        setError("API URL not configured (VITE_NODE_USER_ACTIVITY_API)");
        return;
      }
      setLoading(true);
      setError(null);
      const f = appliedRef.current;
      try {
        const params = new URLSearchParams();
        if (f.dateRange === "Custom") {
          // Build ISO datetime strings from date + time parts
          params.set("from_date", `${f.fromDate}T${f.fromTime}:00`);
          params.set("to_date",   `${f.toDate}T${f.toTime}:59`);
        } else {
          params.set("date_range", f.dateRange);
        }
        params.set("page", String(page));
        params.set("size", String(PAGE_SIZE));
        if (f.userFilter)           params.set("user",       f.userFilter);
        if (f.keyword)              params.set("keyword",    f.keyword);
        if (f.advertiser)           params.set("advertiser", f.advertiser);
        if (f.domain)               params.set("domain",     f.domain);
        if (f.platform !== "Any")   params.set("platform",   f.platform.toLowerCase());
        if (f.country)              params.set("country",    f.country);

        const token = Cookies.get("token");
        const res = await fetch(`${NODE_API}/intelligence/all-searches?${params.toString()}`, {
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

  // Auto-apply for dropdown fields (date range, platform)
  const applyImmediate = (patch) => {
    const next = { ...appliedRef.current, ...patch };
    appliedRef.current = next;
    setApplied(next);
    setDraft((d) => ({ ...d, ...patch }));
    setPage(0);
    setFetchTick((t) => t + 1);
  };

  // Apply button — commits all draft fields including custom date/time
  // Accepts an optional `patch` so autocomplete can apply a selected value immediately
  const handleApply = useCallback((patch) => {
    setDraft((currentDraft) => {
      const next = patch ? { ...currentDraft, ...patch } : { ...currentDraft };
      if (next.dateRange === "Custom") {
        const from = new Date(`${next.fromDate}T${next.fromTime}:00`);
        const to   = new Date(`${next.toDate}T${next.toTime}:59`);
        if (isNaN(from) || isNaN(to) || from > to) {
          alert("Invalid date range: 'From' must be before 'To'.");
          return currentDraft;
        }
      }
      appliedRef.current = next;
      setApplied(next);
      setPage(0);
      setFetchTick((t) => t + 1);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReset = () => {
    const fresh = { ...EMPTY, fromDate: todayStr(), toDate: todayStr() };
    appliedRef.current = fresh;
    setApplied(fresh);
    setDraft(fresh);
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
    { key: "dateRange",
      label: applied.dateRange === "Custom"
        ? `${applied.fromDate} ${applied.fromTime} → ${applied.toDate} ${applied.toTime}`
        : applied.dateRange,
      clear: () => clearChip({ dateRange: "Last 90 days" }) },
    applied.platform !== "Any" && { key: "platform", label: `Platform: ${applied.platform}`,
      clear: () => clearChip({ platform: "Any" }) },
    applied.userFilter   && { key: "user",       label: `User: ${applied.userFilter}`,
      clear: () => clearChip({ userFilter: "" }) },
    applied.keyword      && { key: "keyword",    label: `Keyword: ${applied.keyword}`,
      clear: () => clearChip({ keyword: "" }) },
    applied.advertiser   && { key: "advertiser", label: `Advertiser: ${applied.advertiser}`,
      clear: () => clearChip({ advertiser: "" }) },
    applied.domain       && { key: "domain",     label: `Domain: ${applied.domain}`,
      clear: () => clearChip({ domain: "" }) },
    applied.country      && { key: "country",    label: `Country: ${applied.country}`,
      clear: () => clearChip({ country: "" }) },
  ].filter(Boolean);

  // Expose live data for native PDF export
  const exportDataRef = useRef(null);
  exportDataRef.current = { rows, applied, total, dateLabel };
  useEffect(() => {
    if (onDataReady) onDataReady(() => exportDataRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDataReady]);

  const renderTableBody = () => {
    if (loading) return (
      <tr><td colSpan={10} style={{ padding: "40px 12px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>Loading...</td></tr>
    );
    if (error) return (
      <tr><td colSpan={10} style={{ padding: "40px 12px", textAlign: "center", color: "#ef4444", fontSize: "13px" }}>{error}</td></tr>
    );
    if (rows.length === 0) return (
      <tr><td colSpan={10} style={{ padding: "40px 12px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>No search events found.</td></tr>
    );
    return rows.map((row, i) => {
      const { initials, color } = getAvatarProps(row.email);
      return (
        <tr
          key={i}
          style={{ borderBottom: "1px solid #f3f4f6", backgroundColor: "white" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f9fafb")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "white")}
        >
          <td style={{ padding: "10px 12px", color: "#6b7280", fontSize: "12px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {row.timestamp}
          </td>
          <td style={{ padding: "10px 12px", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
              <span style={{ width: "26px", height: "26px", borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, color: "white", backgroundColor: color }}>
                {initials}
              </span>
              <span style={{ color: "#111827", fontSize: "12px", whiteSpace: "nowrap" }}>
                {row.email ?? "—"}
              </span>
            </div>
          </td>
          <td style={{ padding: "10px 12px", overflow: "hidden" }}>
            <span style={{ display: "inline-block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", background: "#e0e7ff", color: "#4338ca", padding: "2px 8px", borderRadius: "4px", fontSize: "12px" }}>
              {row.keyword ?? "—"}
            </span>
          </td>
          <td style={{ padding: "10px 12px", color: "#374151", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.advertiser ?? "—"}
          </td>
          <td style={{ padding: "10px 12px", color: "#374151", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.domain ?? "—"}
          </td>
          <td style={{ padding: "10px 12px", overflow: "hidden" }}>
            {row.platform ? (
              <PlatformCell platforms={String(row.platform).split(',').map(p => p.trim()).filter(Boolean)} />
            ) : <span style={{ color: "#9ca3af" }}>—</span>}
          </td>
          <td style={{ padding: "10px 12px", color: "#374151", fontSize: "12px", textAlign: "left", whiteSpace: "nowrap" }}>
            {row.ads_count != null ? Number(row.ads_count).toLocaleString() : <span style={{ color: "#9ca3af" }}>—</span>}
          </td>
          <td style={{ padding: "10px 12px" }}>
            {row.other_activity ? (
              <span style={{ display: "inline-block", background: "#fef3c7", color: "#d97706", border: "1px solid #fde68a", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", whiteSpace: "nowrap" }}>
                {row.other_activity}
              </span>
            ) : <span style={{ color: "#9ca3af" }}>—</span>}
          </td>
          <td style={{ padding: "10px 12px" }}>
            {row.filters_applied?.length > 0
              ? <FilterPillsCell pills={row.filters_applied} />
              : <span style={{ color: "#9ca3af" }}>—</span>}
          </td>
          <td style={{ padding: "10px 12px", overflow: "hidden" }}>
            {row.country ? (
              <span
                onClick={() => applyImmediate({ country: row.country })}
                title={`Filter by ${row.country}`}
                style={{ display: "inline-block", background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0", padding: "2px 8px", borderRadius: "4px", fontSize: "12px", whiteSpace: "nowrap", cursor: "pointer" }}
              >
                {row.country}
              </span>
            ) : <span style={{ color: "#9ca3af" }}>—</span>}
          </td>
        </tr>
      );
    });
  };

  const showFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const showTo   = Math.min((page + 1) * PAGE_SIZE, total);

  const inputStyle = { border: "1px solid #d1d5db", borderRadius: "6px", padding: "6px 8px", fontSize: "12px", color: "#374151", outline: "none", width: "100%", boxSizing: "border-box" };
  const labelStyle = { fontSize: "10px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "4px" };
  const fieldStyle = { display: "flex", flexDirection: "column" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Filter row — hidden during PDF export */}
      <div style={{ display: forceExpand ? "none" : "block", background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", padding: "16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "12px", alignItems: "end" }}>

          {/* Date Range */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Date Range</label>
            <select
              value={draft.dateRange}
              onChange={(e) => {
                const val = e.target.value;
                setDraft((d) => ({ ...d, dateRange: val }));
                if (val !== "Custom") applyImmediate({ dateRange: val });
              }}
              style={{ ...inputStyle, background: "white" }}
            >
              <option>Last 90 days</option>
              <option>Last 30 days</option>
              <option>Last 7 days</option>
              <option>Today</option>
              <option value="Custom">Custom range</option>
            </select>
          </div>

          {/* User */}
          <div style={fieldStyle}>
            <label style={labelStyle}>User</label>
            <AutocompleteInput
              value={draft.userFilter}
              onChange={(v) => setDraft((d) => ({ ...d, userFilter: v }))}
              onCommit={(v) => handleApply({ userFilter: v })}
              placeholder="Search email..."
              options={filterOptions.users}
              style={inputStyle}
            />
          </div>

          {/* Keyword */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Keyword</label>
            <AutocompleteInput
              value={draft.keyword}
              onChange={(v) => setDraft((d) => ({ ...d, keyword: v }))}
              onCommit={(v) => handleApply({ keyword: v })}
              placeholder="Contains..."
              options={filterOptions.keywords}
              style={inputStyle}
            />
          </div>

          {/* Advertiser */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Advertiser</label>
            <AutocompleteInput
              value={draft.advertiser}
              onChange={(v) => setDraft((d) => ({ ...d, advertiser: v }))}
              onCommit={(v) => handleApply({ advertiser: v })}
              placeholder="Contains..."
              options={filterOptions.advertisers}
              style={inputStyle}
            />
          </div>

          {/* Domain */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Domain</label>
            <AutocompleteInput
              value={draft.domain}
              onChange={(v) => setDraft((d) => ({ ...d, domain: v }))}
              onCommit={(v) => handleApply({ domain: v })}
              placeholder="e.g. nike.com"
              options={filterOptions.domains}
              style={inputStyle}
            />
          </div>

          {/* Platform */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Platform</label>
            <select
              value={draft.platform}
              onChange={(e) => applyImmediate({ platform: e.target.value })}
              style={{ ...inputStyle, background: "white" }}
            >
              {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>

          {/* Country */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Country</label>
            <AutocompleteInput
              value={draft.country}
              onChange={(v) => setDraft((d) => ({ ...d, country: v }))}
              onCommit={(v) => handleApply({ country: v })}
              placeholder="Any"
              options={filterOptions.countries}
              style={inputStyle}
            />
          </div>
        </div>

        {/* Custom date+time pickers — shown only when Custom range is selected */}
        {draft.dateRange === "Custom" && (
          <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", padding: "12px 14px", background: "#f8faff", border: "1px solid #c7d2fe", borderRadius: "8px" }}>
            <span style={{ fontSize: "11px", fontWeight: 600, color: "#4338ca", textTransform: "uppercase", letterSpacing: "0.05em" }}>From</span>
            <input
              type="date"
              value={draft.fromDate}
              max={draft.toDate}
              onChange={(e) => setDraft((d) => ({ ...d, fromDate: e.target.value }))}
              style={{ ...inputStyle, width: "140px" }}
            />
            <input
              type="time"
              value={draft.fromTime}
              onChange={(e) => setDraft((d) => ({ ...d, fromTime: e.target.value }))}
              style={{ ...inputStyle, width: "110px" }}
            />
            <span style={{ fontSize: "11px", fontWeight: 600, color: "#4338ca", textTransform: "uppercase", letterSpacing: "0.05em", marginLeft: "6px" }}>To</span>
            <input
              type="date"
              value={draft.toDate}
              min={draft.fromDate}
              onChange={(e) => setDraft((d) => ({ ...d, toDate: e.target.value }))}
              style={{ ...inputStyle, width: "140px" }}
            />
            <input
              type="time"
              value={draft.toTime}
              onChange={(e) => setDraft((d) => ({ ...d, toTime: e.target.value }))}
              style={{ ...inputStyle, width: "110px" }}
            />
            <span style={{ fontSize: "11px", color: "#6b7280", marginLeft: "4px" }}>
              (local time)
            </span>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px", justifyContent: "flex-end" }}>
          <button
            onClick={() => handleApply()}
            style={{ display: "flex", alignItems: "center", gap: "4px", background: "white", color: "#374151", fontSize: "12px", fontWeight: 600, padding: "6px 16px", borderRadius: "6px", border: "1px solid #d1d5db", cursor: "pointer" }}
          >
            ↓ Apply
          </button>
          <button
            onClick={handleReset}
            style={{ display: "flex", alignItems: "center", gap: "4px", border: "1px solid #d1d5db", color: "#374151", fontSize: "12px", fontWeight: 500, padding: "6px 12px", borderRadius: "6px", background: "white", cursor: "pointer" }}
          >
            ↺ Reset
          </button>
        </div>
      </div>

      {/* Active filter chips + result count */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
        {!forceExpand && <span style={{ fontSize: "12px", color: "#6b7280" }}>Active filters:</span>}
        {activeChips.map((chip) => (
          forceExpand
            ? <span key={chip.key} style={{ display: "inline-block", background: "#e0e7ff", color: "#4338ca", fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "9999px", border: "1px solid #c7d2fe" }}>{chip.label}</span>
            : <FilterPill key={chip.key} label={chip.label} onRemove={chip.clear} />
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <p style={{ fontSize: "12px", color: "#6b7280", margin: 0 }}>
          {total.toLocaleString()} searches matched{dateLabel ? ` · ${dateLabel}` : ""}
        </p>
      </div>

      {/* Table */}
      <div style={{ background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", tableLayout: "auto", fontSize: "13px", borderCollapse: "collapse" }}>
            <colgroup>
              <col style={{ minWidth: "100px" }} />
              <col style={{ minWidth: "260px" }} />
              <col style={{ minWidth: "100px" }} />
              <col style={{ minWidth: "100px" }} />
              <col style={{ minWidth: "90px" }} />
              <col style={{ minWidth: "100px" }} />
              <col style={{ minWidth: "70px" }} />
              <col style={{ minWidth: "160px" }} />
              <col style={{ minWidth: "240px" }} />
              <col style={{ minWidth: "90px" }} />
            </colgroup>
            <thead>
              <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                {["TIMESTAMP", "USER", "KEYWORD", "ADVERTISER", "DOMAIN", "PLATFORM", "AD COUNT", "OTHER ACTIVITY", "FILTERS APPLIED", "COUNTRY"].map((h) => (
                  <th key={h} style={{ padding: h === "AD COUNT" ? "10px 6px" : "10px 12px", textAlign: "left", fontSize: "11px", fontWeight: 600, color: "#9ca3af", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {renderTableBody()}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderTop: "1px solid #e5e7eb" }}>
          <p style={{ fontSize: "12px", color: "#6b7280" }}>
            Showing {showFrom}–{showTo} of {total.toLocaleString()}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "12px", color: "#6b7280" }}>Page {page + 1} / {totalPages}</span>
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              style={{ fontSize: "12px", color: "#6b7280", padding: "4px 8px", cursor: page === 0 ? "not-allowed" : "pointer", opacity: page === 0 ? 0.3 : 1, background: "none", border: "none" }}
            >
              ‹ Prev
            </button>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              style={{ fontSize: "12px", color: "#6b7280", padding: "4px 8px", cursor: page >= totalPages - 1 ? "not-allowed" : "pointer", opacity: page >= totalPages - 1 ? 0.3 : 1, background: "none", border: "none" }}
            >
              Next ›
            </button>
          </div>
        </div>

        <div style={{ padding: "10px 16px", background: "#f9fafb", borderTop: "1px solid #e5e7eb" }}>
          <p style={{ fontSize: "11px", color: "#9ca3af" }}>
            ℹ Search events are retained for 90 days. After 90 days, events are anonymised and kept as aggregate counts.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AllSearches;
