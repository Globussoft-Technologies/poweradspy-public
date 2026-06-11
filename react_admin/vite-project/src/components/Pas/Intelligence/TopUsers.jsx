import React, { useState, useEffect, useRef } from "react";
import { RxCross1 } from "react-icons/rx";
import { CiFilter } from "react-icons/ci";
import { FaArrowDown, FaArrowUp, FaCalendarAlt } from "react-icons/fa";
import Cookies from "js-cookie";

const NODE_API = import.meta.env.VITE_NODE_USER_ACTIVITY_API?.replace(/\/$/, '');

const AVATAR_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6",
  "#3b82f6", "#ec4899", "#14b8a6", "#f97316", "#06b6d4",
];

const PLATFORMS = ["Any", "Facebook", "Instagram", "Google", "GDN", "TikTok", "LinkedIn", "YouTube", "Reddit", "Pinterest", "Quora", "Native"];

const PRESET_RANGES = [
  { label: "Last 7 days",  days: 7  },
  { label: "Last 14 days", days: 14 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 60 days", days: 60 },
  { label: "Last 90 days", days: 90 },
];

function toISO(date) { return date.toISOString().slice(0, 10); }

function getMinDate() {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return toISO(d);
}

function getTodayISO() { return toISO(new Date()); }

function getInitials(userId) {
  const id = String(userId ?? "");
  if (!id) return "?";
  const parts = id.split(/[@._\s]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return id.slice(0, 2).toUpperCase();
}

function getColor(userId) {
  const id = String(userId ?? "");
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function formatNumber(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString();
}

function buildTrend(trendPct, trendLabel) {
  if (trendPct == null) return { text: `— ${trendLabel}`, up: null };
  const arrow = trendPct >= 0 ? "↑" : "↓";
  const pct   = Math.abs(trendPct) > 999 ? ">999%" : `${Math.abs(trendPct)}%`;
  return { text: `${arrow} ${pct} ${trendLabel}`, up: trendPct >= 0 };
}

const EMPTY_FILTER = { keyword: "", advertiser: "", domain: "", platform: "Any" };

const MAX_FILTER_PILLS = 3;

const TopFilterPills = ({ filters, anomaly, forceExpand }) => {
  const [expanded, setExpanded] = useState(false);
  if (!filters || filters.length === 0) return <span style={{ color: "#9ca3af" }}>—</span>;
  const isExpanded = forceExpand || expanded;
  const visible = isExpanded ? filters : filters.slice(0, MAX_FILTER_PILLS);
  const hidden  = filters.length - MAX_FILTER_PILLS;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "3px", alignItems: "flex-start" }}>
      {visible.map((f, fi) => (
        <span key={fi} style={{ background: anomaly ? "#fef3c7" : "#f3f4f6", color: anomaly ? "#d97706" : "#374151", border: `1px solid ${anomaly ? "#fde68a" : "#e5e7eb"}`, padding: "2px 7px", borderRadius: "4px", fontSize: "11px", whiteSpace: "nowrap" }}>
          {f}
        </span>
      ))}
      {!isExpanded && hidden > 0 && (
        <button onClick={() => setExpanded(true)} style={{ background: "#e0e7ff", border: "1px solid #c7d2fe", color: "#4338ca", padding: "2px 7px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", whiteSpace: "nowrap", fontWeight: 600 }}>
          +{hidden} more
        </button>
      )}
      {isExpanded && !forceExpand && hidden > 0 && (
        <button onClick={() => setExpanded(false)} style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", color: "#6b7280", padding: "2px 7px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", whiteSpace: "nowrap" }}>
          show less
        </button>
      )}
    </div>
  );
};

const TopUsers = ({ onExport, forceExpand = false, onDataReady }) => {
  const [flaggedOnly, setFlaggedOnly]     = useState(false);
  const [sortAsc, setSortAsc]             = useState(false);
  const [drillUser, setDrillUser]         = useState(null);
  const [filterOpen, setFilterOpen]       = useState(false);
  const [filterDraft, setFilterDraft]     = useState({ ...EMPTY_FILTER });
  const [filterActive, setFilterActive]   = useState({ ...EMPTY_FILTER });

  // Date range: preset label or "Custom"
  const [dateRange, setDateRange]         = useState("Last 7 days");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [customFrom, setCustomFrom]       = useState("");
  const [customTo, setCustomTo]           = useState("");
  const [appliedFrom, setAppliedFrom]     = useState("");
  const [appliedTo, setAppliedTo]         = useState("");
  const datePickerRef                     = useRef(null);

  const [stats, setStats]               = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const [users, setUsers]               = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError]     = useState(null);

  // Close date picker on outside click
  useEffect(() => {
    const handler = (e) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target)) {
        setDatePickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const token = Cookies.get("token");
    setStatsLoading(true);
    fetch(`${NODE_API}/intelligence/stats`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((json) => { if (json.code === 200) setStats(json.data); })
      .catch(() => {})
      .finally(() => setStatsLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const token = Cookies.get("token");
    setUsersLoading(true);
    setUsersError(null);

    let from_date, to_date;
    if (dateRange === "Custom") {
      if (!appliedFrom || !appliedTo) { setUsersLoading(false); return; }
      from_date = `${appliedFrom}T00:00:00`;
      to_date   = `${appliedTo}T23:59:59`;
    } else {
      const preset = PRESET_RANGES.find((r) => r.label === dateRange) ?? PRESET_RANGES[0];
      const now = new Date();
      to_date   = toISO(now);
      from_date = toISO(new Date(now - preset.days * 24 * 60 * 60 * 1000));
    }

    const params = new URLSearchParams({ size: "50", from_date, to_date });
    if (flaggedOnly) params.set("flagged_only", "true");
    fetch(`${NODE_API}/intelligence/top-users?${params}`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.code === 200) setUsers(json.data.users ?? []);
        else setUsersError(json.message || "Failed to load users");
      })
      .catch((e) => { if (e.name !== "AbortError") setUsersError("Failed to load users"); })
      .finally(() => setUsersLoading(false));
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flaggedOnly, dateRange, appliedFrom, appliedTo]);

  const totalSearches  = stats?.total_searches;
  const activeUsers    = stats?.active_users;
  const highVolFlags   = stats?.high_volume_flags;
  const uniqueKeywords = stats?.unique_keywords;

  const statCards = [
    {
      value:      statsLoading ? "…" : formatNumber(totalSearches?.value),
      label:      "TOTAL SEARCHES",
      color:      "text-[#3b82f6]",
      colorHex:   "#3b82f6",
      prev_value: statsLoading ? null : totalSearches?.prev_value,
      ...buildTrend(totalSearches?.trend_pct, totalSearches?.trend_label),
    },
    {
      value:      statsLoading ? "…" : formatNumber(activeUsers?.value),
      label:      "ACTIVE USERS",
      color:      "text-[#1f2937]",
      colorHex:   "#1f2937",
      prev_value: statsLoading ? null : activeUsers?.prev_value,
      ...buildTrend(activeUsers?.trend_pct, activeUsers?.trend_label),
    },
    {
      value:    statsLoading ? "…" : formatNumber(highVolFlags?.value),
      label:    "HIGH-VOLUME FLAGS",
      sub:      highVolFlags?.sub_label ?? "users with >500 searches in last 24h",
      color:    "text-[#f59e0b]",
      colorHex: "#f59e0b",
      text:     "",
      up:       null,
    },
    {
      value:      statsLoading ? "…" : formatNumber(uniqueKeywords?.value),
      label:      "UNIQUE KEYWORDS",
      color:      "text-[#10b981]",
      colorHex:   "#10b981",
      prev_value: statsLoading ? null : uniqueKeywords?.prev_value,
      ...buildTrend(uniqueKeywords?.trend_pct, uniqueKeywords?.trend_label),
    },
  ];

  const flaggedCount = users.filter((u) => u.anomaly_flag).length;

  // Client-side filtering
  const filteredUsers = users.filter((u) => {
    const kw = filterActive.keyword.trim().toLowerCase();
    const adv = filterActive.advertiser.trim().toLowerCase();
    const dom = filterActive.domain.trim().toLowerCase();
    const plat = filterActive.platform;
    if (kw  && !(u.top_keyword    ?? "").toLowerCase().includes(kw))  return false;
    if (adv && !(u.top_advertiser ?? "").toLowerCase().includes(adv)) return false;
    if (dom && !(u.top_domain     ?? "").toLowerCase().includes(dom)) return false;
    if (plat !== "Any") {
      const platVal = (u.top_platform ?? "").toLowerCase();
      const platSel = plat.toLowerCase();
      // Google covers both "google" and "gdn"
      const matches = platSel === "google"
        ? (platVal === "google" || platVal === "gdn")
        : platVal === platSel;
      if (!matches) return false;
    }
    return true;
  });

  const getCount = (u) => u.doc_count ?? u.search_count ?? 0;

  const sortedUsers = [...filteredUsers].sort((a, b) =>
    sortAsc ? getCount(a) - getCount(b) : getCount(b) - getCount(a)
  );

  // Expose a stable getter so parent can pull live data for native PDF export
  const exportDataRef = useRef(null);
  exportDataRef.current = { statCards, sortedUsers, filterActive, flaggedOnly, dateRange, appliedFrom, appliedTo };
  useEffect(() => {
    if (onDataReady) onDataReady(() => exportDataRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDataReady]);

  const handleRowClick = (user) => {
    setDrillUser(drillUser?.user_id === user.user_id ? null : user);
  };

  const applyFilter = () => {
    setFilterActive({ ...filterDraft });
  };

  const resetFilter = () => {
    setFilterDraft({ ...EMPTY_FILTER });
    setFilterActive({ ...EMPTY_FILTER });
  };

  const hasActiveFilter =
    filterActive.keyword || filterActive.advertiser ||
    filterActive.domain  || filterActive.platform !== "Any";

  const activeFilterCount = [
    filterActive.keyword,
    filterActive.advertiser,
    filterActive.domain,
    filterActive.platform !== "Any" ? filterActive.platform : "",
  ].filter(Boolean).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "24px" }}>
        {statCards.map((s) => (
          <div key={s.label} style={{ background: "#f3f4f6", borderRadius: "10px", padding: "16px 20px 20px 20px" }}>
            <p style={{ fontSize: "28px", fontWeight: 700, lineHeight: 1.2, color: s.colorHex ?? "#111827", margin: 0 }}>{s.value}</p>
            <p style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", letterSpacing: "0.05em", marginTop: "4px", marginBottom: 0 }}>{s.label}</p>
            {s.sub && <p style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px", marginBottom: 0 }}>{s.sub}</p>}
            {s.prev_value != null && (
              <p style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px", marginBottom: 0 }}>
                prev: {formatNumber(s.prev_value)}
              </p>
            )}
            {s.text && (
              <p style={{ fontSize: "11px", marginTop: "4px", fontWeight: 500, color: s.up ? "#10b981" : s.up === false ? "#ef4444" : "#9ca3af", marginBottom: 0 }}>
                {s.text}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Section title — always visible including PDF */}
      <p style={{ fontSize: "13px", fontWeight: 600, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: forceExpand ? "12px" : "6px", marginTop: "8px" }}>
        Top Users By Search Volume
      </p>

      {/* Controls row — hidden during PDF export (buttons don't render in html2canvas) */}
      <div style={{ display: forceExpand ? "none" : "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: "12px", flexWrap: "wrap", gap: "8px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {/* Date range picker */}
          <div ref={datePickerRef} style={{ position: "relative" }}>
            <button
              onClick={() => setDatePickerOpen((v) => !v)}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                border: "1px solid #d1d5db", borderRadius: "9999px", padding: "6px 14px",
                fontSize: "12px", fontWeight: 500, color: "#374151", background: "white",
                outline: "none", cursor: "pointer",
                ...(datePickerOpen ? { borderColor: "#6366f1", color: "#6366f1" } : {}),
              }}
            >
              <FaCalendarAlt style={{ fontSize: "11px" }} />
              {dateRange === "Custom" && appliedFrom && appliedTo
                ? `${appliedFrom} → ${appliedTo}`
                : dateRange}
            </button>

            {datePickerOpen && (
              <div style={{
                position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 50,
                background: "white", border: "1px solid #e5e7eb", borderRadius: "12px",
                boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: "16px", minWidth: "280px",
              }}>
                {/* Preset chips */}
                <p style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "10px" }}>Quick select</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "16px" }}>
                  {PRESET_RANGES.map((r) => (
                    <button
                      key={r.label}
                      onClick={() => { setDateRange(r.label); setDatePickerOpen(false); }}
                      style={{
                        padding: "4px 12px", borderRadius: "9999px", fontSize: "12px", fontWeight: 500,
                        cursor: "pointer", outline: "none", border: "1px solid",
                        background: dateRange === r.label ? "#6366f1" : "#f3f4f6",
                        color:      dateRange === r.label ? "white"    : "#374151",
                        borderColor: dateRange === r.label ? "#6366f1" : "#e5e7eb",
                      }}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>

                {/* Custom range */}
                <p style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "10px" }}>Custom range</p>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <label style={{ fontSize: "11px", color: "#6b7280", fontWeight: 600 }}>From</label>
                    <input
                      type="date"
                      value={customFrom}
                      min={getMinDate()}
                      max={customTo || getTodayISO()}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      style={{ border: "1px solid #d1d5db", borderRadius: "6px", padding: "6px 10px", fontSize: "12px", color: "#374151", outline: "none", width: "100%" }}
                    />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <label style={{ fontSize: "11px", color: "#6b7280", fontWeight: 600 }}>To</label>
                    <input
                      type="date"
                      value={customTo}
                      min={customFrom || getMinDate()}
                      max={getTodayISO()}
                      onChange={(e) => setCustomTo(e.target.value)}
                      style={{ border: "1px solid #d1d5db", borderRadius: "6px", padding: "6px 10px", fontSize: "12px", color: "#374151", outline: "none", width: "100%" }}
                    />
                  </div>
                  <p style={{ fontSize: "11px", color: "#9ca3af", margin: 0 }}>
                    ⓘ Only dates within the last 90 days are selectable.
                  </p>
                  <button
                    disabled={!customFrom || !customTo}
                    onClick={() => {
                      setAppliedFrom(customFrom);
                      setAppliedTo(customTo);
                      setDateRange("Custom");
                      setDatePickerOpen(false);
                    }}
                    style={{
                      background: customFrom && customTo ? "#6366f1" : "#e5e7eb",
                      color: customFrom && customTo ? "white" : "#9ca3af",
                      border: "none", borderRadius: "6px", padding: "7px 0", fontSize: "12px",
                      fontWeight: 600, cursor: customFrom && customTo ? "pointer" : "not-allowed",
                      outline: "none", width: "100%",
                    }}
                  >
                    Apply custom range
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => setSortAsc(!sortAsc)}
            style={{
              outline: "none", boxShadow: "none", cursor: "pointer",
              display: "flex", alignItems: "center", gap: "4px",
              padding: "6px 14px", borderRadius: "9999px", fontSize: "12px", fontWeight: 500,
              background: "#f3f4f6", color: "#111827", border: "1px solid #e5e7eb",
            }}
          >
            {sortAsc ? <FaArrowUp style={{ fontSize: "10px" }} /> : <FaArrowDown style={{ fontSize: "10px" }} />}
            Most searches
          </button>
          <button
            onClick={() => setFlaggedOnly(!flaggedOnly)}
            style={{
              outline: "none", boxShadow: flaggedOnly ? "0 0 0 2px #f59e0b" : "none",
              cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
              padding: "6px 14px", borderRadius: "9999px", fontSize: "12px", fontWeight: 600,
              background: flaggedOnly ? "#f59e0b" : "white",
              color: flaggedOnly ? "white" : "#374151",
              border: flaggedOnly ? "1px solid #f59e0b" : "1px solid #d1d5db",
            }}
          >
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: flaggedOnly ? "white" : "#f59e0b", flexShrink: 0 }} />
            Flagged only
            {flaggedCount > 0 && (
              <span style={{ background: flaggedOnly ? "white" : "#f59e0b", color: flaggedOnly ? "#d97706" : "white", fontSize: "10px", fontWeight: 700, padding: "1px 6px", borderRadius: "9999px", lineHeight: 1.4 }}>
                {flaggedCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setFilterOpen((v) => !v)}
            style={{
              outline: "none", cursor: "pointer",
              display: "flex", alignItems: "center", gap: "4px",
              padding: "6px 14px", borderRadius: "9999px", fontSize: "12px", fontWeight: 500,
              background: filterOpen || hasActiveFilter ? "#6366f1" : "white",
              color: filterOpen || hasActiveFilter ? "white" : "#374151",
              border: filterOpen || hasActiveFilter ? "1px solid #6366f1" : "1px solid #d1d5db",
              boxShadow: "none",
            }}
          >
            <CiFilter style={{ fontSize: "14px" }} />
            Filter
            {activeFilterCount > 0 && (
              <span style={{ background: "white", color: "#6366f1", fontSize: "10px", fontWeight: 700, padding: "1px 6px", borderRadius: "9999px", lineHeight: 1.4 }}>
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {filterOpen && (
        <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "16px", marginBottom: "12px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", alignItems: "end" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label style={{ fontSize: "10px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>Keyword</label>
              <input
                value={filterDraft.keyword}
                onChange={(e) => setFilterDraft((d) => ({ ...d, keyword: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && applyFilter()}
                placeholder="Contains..."
                style={{ border: "1px solid #d1d5db", borderRadius: "6px", padding: "6px 8px", fontSize: "12px", color: "#374151", outline: "none" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label style={{ fontSize: "10px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>Advertiser</label>
              <input
                value={filterDraft.advertiser}
                onChange={(e) => setFilterDraft((d) => ({ ...d, advertiser: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && applyFilter()}
                placeholder="Contains..."
                style={{ border: "1px solid #d1d5db", borderRadius: "6px", padding: "6px 8px", fontSize: "12px", color: "#374151", outline: "none" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label style={{ fontSize: "10px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>Domain</label>
              <input
                value={filterDraft.domain}
                onChange={(e) => setFilterDraft((d) => ({ ...d, domain: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && applyFilter()}
                placeholder="e.g. nike.com"
                style={{ border: "1px solid #d1d5db", borderRadius: "6px", padding: "6px 8px", fontSize: "12px", color: "#374151", outline: "none" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label style={{ fontSize: "10px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>Platform</label>
              <select
                value={filterDraft.platform}
                onChange={(e) => setFilterDraft((d) => ({ ...d, platform: e.target.value }))}
                style={{ border: "1px solid #d1d5db", borderRadius: "6px", padding: "6px 8px", fontSize: "12px", color: "#374151", background: "white", outline: "none" }}
              >
                {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px", justifyContent: "flex-end" }}>
            <button
              onClick={applyFilter}
              style={{ display: "flex", alignItems: "center", gap: "4px", background: "white", color: "#374151", fontSize: "12px", fontWeight: 600, padding: "6px 16px", borderRadius: "6px", border: "1px solid #d1d5db", cursor: "pointer" }}
            >
              ↓ Apply
            </button>
            <button
              onClick={resetFilter}
              style={{ display: "flex", alignItems: "center", gap: "4px", background: "white", color: "#374151", fontSize: "12px", fontWeight: 500, padding: "6px 12px", borderRadius: "6px", border: "1px solid #d1d5db", cursor: "pointer" }}
            >
              ↺ Reset
            </button>
          </div>
        </div>
      )}

      {/* PDF-only: show date range + active filters as a summary line */}
      {forceExpand && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
          <span style={{ display: "inline-block", background: "#e0e7ff", color: "#4338ca", fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "9999px", border: "1px solid #c7d2fe" }}>
            {dateRange === "Custom" && appliedFrom && appliedTo ? `${appliedFrom} → ${appliedTo}` : dateRange}
          </span>
          {filterActive.keyword    && <span style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", color: "#374151", fontSize: "11px", padding: "3px 10px", borderRadius: "9999px" }}>Keyword: {filterActive.keyword}</span>}
          {filterActive.advertiser && <span style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", color: "#374151", fontSize: "11px", padding: "3px 10px", borderRadius: "9999px" }}>Advertiser: {filterActive.advertiser}</span>}
          {filterActive.domain     && <span style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", color: "#374151", fontSize: "11px", padding: "3px 10px", borderRadius: "9999px" }}>Domain: {filterActive.domain}</span>}
          {filterActive.platform !== "Any" && <span style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", color: "#374151", fontSize: "11px", padding: "3px 10px", borderRadius: "9999px" }}>Platform: {filterActive.platform}</span>}
          {flaggedOnly && <span style={{ background: "#fef3c7", border: "1px solid #fde68a", color: "#d97706", fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "9999px" }}>Flagged only</span>}
        </div>
      )}

      {/* Active filter chips */}
      {hasActiveFilter && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
          <span style={{ fontSize: "12px", color: "#6b7280" }}>Filtered by:</span>
          {filterActive.keyword && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#e0e7ff", color: "#4338ca", fontSize: "12px", padding: "4px 12px", borderRadius: "9999px", border: "1px solid #c7d2fe" }}>
              Keyword: {filterActive.keyword}
              <RxCross1 style={{ fontSize: "10px", cursor: "pointer" }} onClick={() => { setFilterDraft((d) => ({ ...d, keyword: "" })); setFilterActive((a) => ({ ...a, keyword: "" })); }} />
            </span>
          )}
          {filterActive.advertiser && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#e0e7ff", color: "#4338ca", fontSize: "12px", padding: "4px 12px", borderRadius: "9999px", border: "1px solid #c7d2fe" }}>
              Advertiser: {filterActive.advertiser}
              <RxCross1 style={{ fontSize: "10px", cursor: "pointer" }} onClick={() => { setFilterDraft((d) => ({ ...d, advertiser: "" })); setFilterActive((a) => ({ ...a, advertiser: "" })); }} />
            </span>
          )}
          {filterActive.domain && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#e0e7ff", color: "#4338ca", fontSize: "12px", padding: "4px 12px", borderRadius: "9999px", border: "1px solid #c7d2fe" }}>
              Domain: {filterActive.domain}
              <RxCross1 style={{ fontSize: "10px", cursor: "pointer" }} onClick={() => { setFilterDraft((d) => ({ ...d, domain: "" })); setFilterActive((a) => ({ ...a, domain: "" })); }} />
            </span>
          )}
          {filterActive.platform !== "Any" && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#e0e7ff", color: "#4338ca", fontSize: "12px", padding: "4px 12px", borderRadius: "9999px", border: "1px solid #c7d2fe" }}>
              Platform: {filterActive.platform}
              <RxCross1 style={{ fontSize: "10px", cursor: "pointer" }} onClick={() => { setFilterDraft((d) => ({ ...d, platform: "Any" })); setFilterActive((a) => ({ ...a, platform: "Any" })); }} />
            </span>
          )}
          <span style={{ fontSize: "12px", color: "#6b7280" }}>— {sortedUsers.length} result{sortedUsers.length !== 1 ? "s" : ""}</span>
        </div>
      )}

      {/* Table */}
      <div style={{ background: "white", borderRadius: "10px", overflow: "hidden", border: "1px solid #e5e7eb" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse", verticalAlign: "middle" }}>
            <colgroup>
              <col style={{ width: "36px" }} />
              <col style={{ width: "170px" }} />
              <col style={{ width: "75px" }} />
              <col style={{ width: "120px" }} />
              <col style={{ width: "120px" }} />
              <col style={{ width: "120px" }} />
              <col style={{ width: "180px" }} />
              <col style={{ width: "100px" }} />
            </colgroup>
            <thead>
              <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                {["#", "USER", "SEARCHES", "TOP KEYWORD", "TOP ADVERTISER", "TOP DOMAIN", "TOP FILTER", "PLATFORM"].map((h) => (
                  <th
                    key={h}
                    style={{ padding: "10px 12px", textAlign: "left", fontSize: "11px", fontWeight: 600, color: "#9ca3af", letterSpacing: "0.05em", whiteSpace: "nowrap", overflow: "hidden" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usersLoading ? (
                <tr>
                  <td colSpan={8} style={{ padding: "32px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>
                    Loading...
                  </td>
                </tr>
              ) : usersError ? (
                <tr>
                  <td colSpan={8} style={{ padding: "32px", textAlign: "center", color: "#ef4444", fontSize: "13px" }}>
                    {usersError}
                  </td>
                </tr>
              ) : sortedUsers.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: "32px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>
                    {hasActiveFilter ? "No users match the current filters." : "No data found for this period."}
                  </td>
                </tr>
              ) : (
                sortedUsers.map((user, idx) => (
                  <React.Fragment key={user.user_id}>
                    <tr
                      onClick={() => handleRowClick(user)}
                      style={{ borderBottom: "1px solid #f3f4f6", cursor: "pointer", backgroundColor: drillUser?.user_id === user.user_id ? "#f9fafb" : "white", verticalAlign: "middle" }}
                      onMouseEnter={(e) => { if (drillUser?.user_id !== user.user_id) e.currentTarget.style.backgroundColor = "#f9fafb"; }}
                      onMouseLeave={(e) => { if (drillUser?.user_id !== user.user_id) e.currentTarget.style.backgroundColor = "white"; }}
                    >
                      <td style={{ padding: "10px 12px", color: "#9ca3af", overflow: "hidden", verticalAlign: "middle" }}>{idx + 1}</td>
                      <td style={{ padding: "10px 12px", overflow: "hidden", verticalAlign: "middle" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                          <span style={{ width: "28px", height: "28px", borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, color: "white", background: getColor(user.email || user.user_id) }}>
                            {getInitials(user.email || user.user_id)}
                          </span>
                          <span style={{ overflow: forceExpand ? "visible" : "hidden", textOverflow: forceExpand ? "unset" : "ellipsis", whiteSpace: forceExpand ? "normal" : "nowrap", color: "#111827", wordBreak: forceExpand ? "break-all" : "normal" }}>{user.email || user.user_id}</span>
                        </div>
                      </td>
                      <td style={{ padding: "10px 12px", fontWeight: 700, color: "#111827", overflow: "hidden", verticalAlign: "middle" }}>{formatNumber(user.doc_count ?? user.search_count)}</td>
                      <td style={{ padding: "10px 12px", overflow: forceExpand ? "visible" : "hidden", verticalAlign: "middle" }}>
                        {user.top_keyword ? (
                          <span style={{ display: "inline-block", maxWidth: "100%", overflow: forceExpand ? "visible" : "hidden", textOverflow: forceExpand ? "unset" : "ellipsis", whiteSpace: forceExpand ? "normal" : "nowrap", background: "#e0e7ff", color: "#4338ca", padding: "2px 8px", borderRadius: "4px", fontSize: "12px" }}>
                            {user.top_keyword}
                          </span>
                        ) : <span style={{ color: "#9ca3af" }}>—</span>}
                      </td>
                      <td style={{ padding: "10px 12px", color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "middle" }}>{user.top_advertiser ?? "—"}</td>
                      <td style={{ padding: "10px 12px", color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "middle" }}>{user.top_domain ?? "—"}</td>
                      <td style={{ padding: "10px 12px", verticalAlign: "middle" }}>
                        <TopFilterPills
                          filters={Array.isArray(user.top_filter) ? user.top_filter : (user.top_filter ? [user.top_filter] : [])}
                          anomaly={user.anomaly_flag}
                          forceExpand={forceExpand}
                        />
                      </td>
                      <td style={{ padding: "10px 12px", overflow: forceExpand ? "visible" : "hidden", verticalAlign: "middle" }}>
                        {user.top_platform ? (
                          <span style={{ display: "inline-block", maxWidth: "100%", overflow: forceExpand ? "visible" : "hidden", textOverflow: forceExpand ? "unset" : "ellipsis", whiteSpace: forceExpand ? "normal" : "nowrap", background: "#e0e7ff", color: "#4338ca", padding: "2px 8px", borderRadius: "4px", fontSize: "12px" }}>
                            {user.top_platform}
                          </span>
                        ) : <span style={{ color: "#9ca3af" }}>—</span>}
                      </td>
                    </tr>

                    {/* Inline drill-down panel */}
                    {drillUser?.user_id === user.user_id && (
                      <tr style={{ backgroundColor: "#f9fafb" }}>
                        <td colSpan={8} style={{ padding: "16px 12px" }}>
                          <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", background: "white", padding: "20px", position: "relative" }}>
                            <button
                              onClick={() => setDrillUser(null)}
                              style={{ position: "absolute", top: "12px", right: "12px", background: "none", border: "none", cursor: "pointer", color: "#9ca3af", outline: "none" }}
                            >
                              <RxCross1 style={{ fontSize: "16px" }} />
                            </button>

                            <p style={{ fontSize: "13px", fontWeight: 600, color: "#111827", marginBottom: "12px" }}>
                              {user.email || user.user_id} · drill-down
                            </p>

                            {user.anomaly_flag && (
                              <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px" }}>
                                <span style={{ fontSize: "16px", lineHeight: 1 }}>⚠️</span>
                                <div>
                                  <p style={{ fontSize: "12px", fontWeight: 700, color: "#92400e", marginBottom: "2px" }}>High-Volume Flag — Possible Scraper</p>
                                  <p style={{ fontSize: "12px", color: "#b45309" }}>{user.flag_reason ?? `${getCount(user)} searches in window`}</p>
                                </div>
                              </div>
                            )}

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                              <div style={{ background: "#f9fafb", borderRadius: "8px", padding: "16px" }}>
                                <p style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
                                  Search Summary
                                </p>
                                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                  {[
                                    ["Total Searches", formatNumber(user.doc_count ?? user.search_count)],
                                    ["Top Keyword",    user.top_keyword    ?? "—"],
                                    ["Top Advertiser", user.top_advertiser ?? "—"],
                                    ["Top Domain",     user.top_domain     ?? "—"],
                                    ["Top Filter",     Array.isArray(user.top_filter) ? user.top_filter.join(" · ") : (user.top_filter ?? "—")],
                                  ].map(([label, val]) => (
                                    <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                                      <span style={{ color: "#6b7280" }}>{label}</span>
                                      <span style={{ color: "#111827", fontWeight: 500 }}>{val}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              <div style={{ background: "#f9fafb", borderRadius: "8px", padding: "16px" }}>
                                <p style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
                                  User Info
                                </p>
                                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                  {[
                                    ["User",       user.email || user.user_id],
                                    ["Status",     user.anomaly_flag ? "⚠️ Flagged" : "Normal"],
                                    ["Threshold",  "500 searches / window"],
                                  ].map(([label, val]) => (
                                    <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                                      <span style={{ color: "#6b7280" }}>{label}</span>
                                      <span style={{ color: "#111827", fontWeight: 500 }}>{val}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default TopUsers;
