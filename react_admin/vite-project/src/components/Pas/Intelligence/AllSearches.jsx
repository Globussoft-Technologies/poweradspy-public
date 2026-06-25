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
  includedUsers: [], excludedUsers: [],  // Will be populated with globussoft.in emails after filterOptions load
  keyword: "", advertiser: "", domain: "",
  platform: "", activityTypes: ["keyword"],  // Array of selected activity types - default to keyword
};

const ACTIVITY_TYPES = [
  { key: "keyword", label: "Keyword" },
  { key: "advertiser", label: "Advertiser" },
  { key: "domain", label: "Domain" },
  { key: "filters", label: "Filters" },
  { key: "other_activity", label: "Other Activity" },
  { key: "sorting_filters", label: "Sorting Filters" },
];

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
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
    : options;

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
        autoComplete="new-password"
        name={`ac-${placeholder}`}
        onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { onCommit?.(query); setOpen(false); }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, zIndex: 999,
          background: "white", border: "1px solid #d1d5db", borderRadius: "6px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.10)", maxHeight: "350px", overflowY: "auto",
          marginTop: "2px", width: "100%", minWidth: "500px", maxWidth: "none",
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

// ── Single user input (for include or exclude only) ──────────────────────────────
const SingleUserInput = ({ users = [], onChange, options = [], mode = 'include', placeholder = 'email or .domain...', otherUsers = [], onOtherUsersChange }) => {
  const [query, setQuery] = useState("");
  const [open, setOpen]   = useState(false);
  const wrapRef           = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Show suggestions: all options EXCEPT those already selected
  const filtered = (query
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
    : options
  ).filter((o) => !users.includes(o)).slice(0, 30);

  const addEntry = (val) => {
    const v = val.trim();
    if (!v) { setQuery(""); return; }

    const isDomain = v.startsWith('.') || (!v.includes('@') && v.includes('.'));

    if (isDomain) {
      const pat = v.startsWith('.') ? v.slice(1).toLowerCase() : v.toLowerCase();
      const matches = options.filter((o) => {
        const emailLower = o.toLowerCase();
        const atIdx = emailLower.indexOf('@');
        if (atIdx === -1) return false;
        const domain = emailLower.slice(atIdx + 1);
        return domain === pat || domain.endsWith(`.${pat}`);
      }).filter((o) => !users.includes(o));
      const toAdd = matches.length > 0 ? matches : [v];
      const newUsers = [...users, ...toAdd];
      onChange(newUsers);

      // Remove from other list if present
      const updatedOther = otherUsers.filter((u) => !toAdd.includes(u));
      if (updatedOther.length !== otherUsers.length && onOtherUsersChange) {
        onOtherUsersChange(updatedOther);
      }
    } else {
      if (users.includes(v)) { setQuery(""); return; }
      const newUsers = [...users, v];
      onChange(newUsers);

      // Remove from other list if present
      if (otherUsers.includes(v) && onOtherUsersChange) {
        onOtherUsersChange(otherUsers.filter((u) => u !== v));
      }
    }
    setQuery("");
    setOpen(false);
  };

  const removeUser = (v) => onChange(users.filter((x) => x !== v));

  const inputStyle = {
    border: "none", outline: "none", fontSize: "12px", color: "#374151",
    background: "transparent", minWidth: "100px", flex: 1, padding: "2px 4px",
  };

  const bgColor = mode === "include" ? "#dcfce7" : "#fee2e2";
  const textColor = mode === "include" ? "#15803d" : "#dc2626";
  const borderColor = mode === "include" ? "#bbf7d0" : "#fecaca";

  const showDropdown = open && (filtered.length > 0 || query.trim() || users.length > 0);

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <div
        style={{ border: "1px solid #d1d5db", borderRadius: "6px", background: "white", padding: "4px 6px", cursor: "text", display: "flex", alignItems: "center", gap: "4px", minHeight: "32px", flexWrap: "wrap" }}
        onClick={() => setOpen(true)}
      >
        {users.length > 0 && (
          <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "4px", background: bgColor, color: textColor, border: `1px solid ${borderColor}`, whiteSpace: "nowrap" }}>
            {mode === "include" ? "+" : "−"}{users.length}
          </span>
        )}

        <input
          value={query}
          autoComplete="new-password"
          placeholder={users.length > 0 ? "add more..." : placeholder}
          style={inputStyle}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.trim()) { addEntry(query); }
            if (e.key === "Backspace" && !query && users.length > 0) {
              removeUser(users[users.length - 1]);
            }
            if (e.key === "Escape") setOpen(false);
          }}
        />
      </div>

      {showDropdown && (
        <div style={{
          position: "absolute", top: "100%", left: 0, zIndex: 999,
          background: "white", border: "1px solid #d1d5db", borderRadius: "6px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.10)", maxHeight: "300px", overflowY: "auto",
          marginTop: "2px", minWidth: "100%", width: "max-content", maxWidth: "380px",
        }}>
          {users.length > 0 && (
            <div style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                <span style={{ fontSize: "10px", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Selected ({users.length})
                </span>
                <button
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onChange([]); }}
                  style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "4px", border: "1px solid #e5e7eb", background: "#f9fafb", color: "#6b7280", cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  ✕ Clear all
                </button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {users.map((v) => (
                  <span key={v} style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: bgColor, color: textColor, border: `1px solid ${borderColor}`, borderRadius: "4px", fontSize: "11px", padding: "2px 6px", whiteSpace: "nowrap" }}>
                    <span style={{ fontSize: "9px", fontWeight: 700 }}>{mode === "include" ? "+" : "−"}</span>{v}
                    <span onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); removeUser(v); }} style={{ cursor: "pointer", marginLeft: "2px", fontSize: "10px", color: textColor }}>×</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {query.trim() && !filtered.includes(query.trim()) && (
            <div
              onMouseDown={(e) => { e.preventDefault(); addEntry(query); }}
              style={{ padding: "7px 12px", fontSize: "12px", cursor: "pointer", borderBottom: "1px solid #f3f4f6", color: textColor, background: mode === "include" ? "#f0fdf4" : "#fff1f2" }}
            >
              {mode === "include" ? "+" : "−"} {mode} "{query.trim()}"
            </div>
          )}

          {filtered.map((opt) => (
            <div
              key={opt}
              onMouseDown={(e) => { e.preventDefault(); addEntry(opt); }}
              style={{ padding: "7px 12px", fontSize: "12px", color: "#374151", cursor: "pointer", borderBottom: "1px solid #f3f4f6", whiteSpace: "nowrap" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f4f6")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
            >
              <span style={{ fontSize: "10px", marginRight: "6px", color: textColor, fontWeight: 700 }}>
                {mode === "include" ? "+" : "−"}
              </span>
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

const MAX_PLATFORMS_UI = 2;  // Show 2 platforms by default in UI

const PlatformCell = ({ platforms, isExport = false }) => {
  const [expanded, setExpanded] = useState(false);
  const maxDisplay = isExport ? Infinity : MAX_PLATFORMS_UI;
  const visible = expanded || isExport ? platforms : platforms.slice(0, maxDisplay);
  const hidden  = Math.max(0, platforms.length - maxDisplay);
  if (isExport && platforms.length > 2) {
    console.log(`PlatformCell export - ${platforms.length} platforms:`, platforms);
  }

  const capitalize = (str) => str ? str.charAt(0).toUpperCase() + str.slice(1) : str;

  // For PDF export, render all platforms stacked vertically
  if (isExport && visible.length > 0) {
    return (
      <>
        {visible.map((p, i) => (
          <div key={i} style={{ display: "block", marginBottom: i < visible.length - 1 ? "4px" : "0" }}>
            <span style={{ display: "inline-block", background: "#e0e7ff", color: "#4338ca", padding: "2px 8px", borderRadius: "4px", fontSize: "12px", whiteSpace: "nowrap" }}>
              {capitalize(p)}
            </span>
          </div>
        ))}
      </>
    );
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "3px", alignItems: "flex-start", overflow: isExport ? "visible" : "hidden" }}>
      {visible.map((p, i) => (
        <span key={i} style={{ display: "inline-block", background: "#e0e7ff", color: "#4338ca", padding: "2px 8px", borderRadius: "4px", fontSize: "12px", whiteSpace: "nowrap", flexShrink: 0 }}>
          {capitalize(p)}
        </span>
      ))}
      {!isExport && !expanded && hidden > 0 && (
        <button onClick={() => setExpanded(true)} style={{ background: "#e0e7ff", border: "1px solid #c7d2fe", color: "#4338ca", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>
          +{hidden} more
        </button>
      )}
      {!isExport && expanded && hidden > 0 && (
        <button onClick={() => setExpanded(false)} style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", color: "#6b7280", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", whiteSpace: "nowrap" }}>
          show less
        </button>
      )}
    </div>
  );
};

const SummaryTag = ({ text, bg, color, border }) => (
  <span style={{ display: "inline-block", background: bg, color, border: `1px solid ${border}`, padding: "2px 8px", borderRadius: "4px", fontSize: "11px", whiteSpace: "nowrap", fontWeight: 500 }}>
    {text}
  </span>
);

const SummaryBar = ({ summaryStats }) => {
  const platforms       = (summaryStats?.platforms ?? []).map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  const pagesVisited    = (summaryStats?.pages_visited ?? []).filter((p) => p.name !== "All Projects Dashboard");
  const searchCounts    = summaryStats?.search_counts ?? {};
  const actionCounts    = summaryStats?.action_counts ?? {};

  const SummarySection = ({ icon, label, children }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "16px", borderRight: "1px solid #e5e7eb" }}>
      <span style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>{icon} {label}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>{children}</div>
    </div>
  );

  return (
    <div style={{ background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", overflow: "hidden" }}>

        {/* Section 1: Platforms Used */}
        <SummarySection icon="📡" label="Platforms Used">
          {platforms.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {platforms.map((p) => (
                <span key={p} style={{ display: "inline-block", background: "#e0e7ff", color: "#4338ca", padding: "4px 10px", borderRadius: "4px", fontSize: "12px", fontWeight: 500, border: "1px solid #c7d2fe" }}>
                  {p}
                </span>
              ))}
            </div>
          ) : (
            <span style={{ fontSize: "12px", color: "#9ca3af" }}>—</span>
          )}
        </SummarySection>

        {/* Section 2: Pages Visited */}
        <SummarySection icon="📄" label="Pages Visited">
          {pagesVisited.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {pagesVisited.map((p) => {
                const isAdsLibrary = p.name === "Ads Library";
                let displayCount = p.count;

                if (isAdsLibrary) {
                  const keywordsTotal = typeof searchCounts.keywords === 'object' ? (searchCounts.keywords?.total ?? 0) : (searchCounts.keywords ?? 0);
                  const domainsTotal = typeof searchCounts.domains === 'object' ? (searchCounts.domains?.total ?? 0) : (searchCounts.domains ?? 0);
                  const advertisersTotal = typeof searchCounts.advertisers === 'object' ? (searchCounts.advertisers?.total ?? 0) : (searchCounts.advertisers ?? 0);
                  const filtersTotal = actionCounts.filters_total ?? 0;
                  const sortingTotal = actionCounts.sorting_total ?? 0;
                  displayCount = keywordsTotal + domainsTotal + advertisersTotal + filtersTotal + sortingTotal;
                }

                return (
                  <div
                    key={p.name}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: "12px",
                    }}
                  >
                    <span style={{ color: "#6b7280" }}>{p.name}</span>
                    <span style={{ fontWeight: 600, color: "#111827" }}>({displayCount})</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <span style={{ fontSize: "12px", color: "#9ca3af" }}>—</span>
          )}
        </SummarySection>

        {/* Section 3: Searches */}
        <SummarySection icon="🔑" label="Searches">
          <div style={{ display: "flex", gap: "20px", alignItems: "flex-start", width: "100%" }}>

            {/* Searched Keywords */}
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1 }}>
              <div style={{ fontSize: "10px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>Searched Keywords</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "11px", color: "#6b7280" }}>Unique:</span>
                <span style={{ fontSize: "16px", fontWeight: 700, color: "#4338ca" }}>{typeof searchCounts.keywords === 'object' ? (searchCounts.keywords?.unique ?? 0) : (searchCounts.keywords ?? 0)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "11px", color: "#6b7280" }}>Total:</span>
                <span style={{ fontSize: "16px", fontWeight: 700, color: "#6b7280" }}>{typeof searchCounts.keywords === 'object' ? (searchCounts.keywords?.total ?? 0) : (searchCounts.keywords ?? 0)}</span>
              </div>
            </div>

            <div style={{ width: "1px", background: "#f3f4f6", height: "100%" }} />

            {/* Searched Domains */}
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1 }}>
              <div style={{ fontSize: "10px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>Searched Domains</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "11px", color: "#6b7280" }}>Unique:</span>
                <span style={{ fontSize: "16px", fontWeight: 700, color: "#059669" }}>{typeof searchCounts.domains === 'object' ? (searchCounts.domains?.unique ?? 0) : (searchCounts.domains ?? 0)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "11px", color: "#6b7280" }}>Total:</span>
                <span style={{ fontSize: "16px", fontWeight: 700, color: "#6b7280" }}>{typeof searchCounts.domains === 'object' ? (searchCounts.domains?.total ?? 0) : (searchCounts.domains ?? 0)}</span>
              </div>
            </div>

            <div style={{ width: "1px", background: "#f3f4f6", height: "100%" }} />

            {/* Searched Advertisers */}
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1 }}>
              <div style={{ fontSize: "10px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>Searched Advertisers</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "11px", color: "#6b7280" }}>Unique:</span>
                <span style={{ fontSize: "16px", fontWeight: 700, color: "#d97706" }}>{typeof searchCounts.advertisers === 'object' ? (searchCounts.advertisers?.unique ?? 0) : (searchCounts.advertisers ?? 0)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "11px", color: "#6b7280" }}>Total:</span>
                <span style={{ fontSize: "16px", fontWeight: 700, color: "#6b7280" }}>{typeof searchCounts.advertisers === 'object' ? (searchCounts.advertisers?.total ?? 0) : (searchCounts.advertisers ?? 0)}</span>
              </div>
            </div>

          </div>
        </SummarySection>

        {/* Section 4: Activity Counts */}
        <SummarySection icon="📊" label="Activity Counts">
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", color: "#6b7280" }}>Sorting:</span>
              <span style={{ fontSize: "18px", fontWeight: 700, color: "#f59e0b" }}>{actionCounts.sorting_total ?? 0}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", color: "#6b7280" }}>Other Actions:</span>
              <span style={{ fontSize: "18px", fontWeight: 700, color: "#d97706" }}>{actionCounts.other_actions_total ?? 0}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", color: "#6b7280" }}>Filters:</span>
              <span style={{ fontSize: "18px", fontWeight: 700, color: "#4338ca" }}>{actionCounts.filters_total ?? 0}</span>
            </div>
          </div>
        </SummarySection>
      </div>
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
      .then((j) => {
        console.log('[AllSearches] filterOptions response:', j);
        if (j.code === 200) {
          console.log('[AllSearches] Setting filter options:', { keywords: j.data.keywords?.length, advertisers: j.data.advertisers?.length, domains: j.data.domains?.length, users: j.data.users?.length });
          setFilterOptions(j.data);
        }
      })
      .catch((err) => { console.error('[AllSearches] filterOptions fetch error:', err); });
  }, []);

  // Initialize with Last 90 days as default
  const DEFAULT_APPLIED = { ...EMPTY, dateRange: "Last 90 days" };

  // Draft filter state (form fields — not yet applied for text inputs)
  const [draft, setDraft] = useState({ ...DEFAULT_APPLIED });

  // Applied state — drives the fetch (default to Last 90 days)
  const [applied, setApplied] = useState({ ...DEFAULT_APPLIED });
  const appliedRef = useRef({ ...DEFAULT_APPLIED });

  // Store default excluded users (globussoft.in emails) for reset
  const [defaultExcludedUsers, setDefaultExcludedUsers] = useState([]);

  // Track whether initial filter setup is complete
  const [filtersInitialized, setFiltersInitialized] = useState(false);

  // Expand domain pattern to individual emails when filterOptions are loaded
  useEffect(() => {
    if (filterOptions.users && filterOptions.users.length > 0) {
      console.log('[AllSearches] filterOptions.users loaded:', filterOptions.users);

      // Find all emails matching .globussoft.in domain
      const globussoftEmails = filterOptions.users.filter((email) => {
        const emailLower = email.toLowerCase();
        const atIdx = emailLower.indexOf('@');
        if (atIdx === -1) return false;
        const domain = emailLower.slice(atIdx + 1);
        return domain === "globussoft.in" || domain.endsWith(".globussoft.in");
      });

      console.log('[AllSearches] Found globussoft.in emails:', globussoftEmails);

      // Store as default excluded users (for reset) — always do this even if empty
      setDefaultExcludedUsers(globussoftEmails);

      // Update draft state
      setDraft((prevDraft) => ({
        ...prevDraft,
        excludedUsers: globussoftEmails,
      }));

      // Update applied state and trigger fetch
      const newApplied = { ...DEFAULT_APPLIED, excludedUsers: globussoftEmails };
      setApplied(newApplied);
      appliedRef.current = newApplied;

      // Mark filters as initialized — this will trigger the data fetch
      setFiltersInitialized(true);
    }
  }, [filterOptions.users]);

  const [page, setPage] = useState(0);
  const [fetchTick, setFetchTick] = useState(0);

  // API state
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [dateLabel, setDateLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [summaryStats, setSummaryStats] = useState({ platforms: [], activity_types: [], sort_by: [], pages_visited: [], total: 0, search_counts: { keywords: { unique: 0, total: 0 }, advertisers: { unique: 0, total: 0 }, domains: { unique: 0, total: 0 } }, action_counts: { sorting_total: 0, sorting_breakdown: [], other_actions_total: 0, other_actions_breakdown: {}, filters_total: 0, filters_breakdown: [] } });

  // Modal state for keyword status history
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [statusModalData, setStatusModalData] = useState(null);
  const [statusHistory, setStatusHistory] = useState([]);
  const [statusHistoryLoading, setStatusHistoryLoading] = useState(false);

  const openStatusModal = async (rowData) => {
    setStatusModalData({ ...rowData, platform: rowData.platform || [] });
    setStatusModalOpen(true);
    setStatusHistoryLoading(true);
    setStatusHistory([]);

    try {
      const params = new URLSearchParams();

      // Determine type (1=keyword, 2=advertiser, 3=domain) and add the appropriate parameter
      if (rowData.keyword) {
        params.set("type", "1");
        params.set("keyword", rowData.keyword);
      } else if (rowData.advertiser) {
        params.set("type", "2");
        params.set("advertiser", rowData.advertiser);
      } else if (rowData.domain) {
        params.set("type", "3");
        params.set("domain", rowData.domain);
      }

      if (!params.toString()) {
        console.warn("[openStatusModal] No keyword/advertiser/domain provided");
        setStatusHistoryLoading(false);
        return;
      }

      const url = `${NODE_API}/intelligence/scraping-history?${params.toString()}`;
      console.log("[openStatusModal] Fetching from:", url);
      console.log("[openStatusModal] Row data:", rowData);

      const token = Cookies.get("token");
      const response = await fetch(url, {
        headers: token ? { "Authorization": `Bearer ${token}` } : {},
      });

      console.log("[openStatusModal] Response status:", response.status);

      if (response.ok) {
        const data = await response.json();
        console.log("[openStatusModal] API response:", data);
        console.log("[openStatusModal] Searched date from API:", data.data?.searchedDate);
        if (data.data?.history && data.data.history.length > 0) {
          // Sort history by date descending (newest first)
          const sortedHistory = [...data.data.history].sort((a, b) => new Date(b.date) - new Date(a.date));
          setStatusHistory(sortedHistory);
        }
        // Update modal data with platform and searched date from API response
        setStatusModalData(prev => ({
          ...prev,
          platform: data.data?.platform || prev.platform,
          searchedDate: data.data?.searchedDate
        }));
      } else {
        const errText = await response.text();
        console.error("Failed to fetch scraping history:", response.status, errText);
      }
    } catch (err) {
      console.error("Error fetching scraping history:", err);
    } finally {
      setStatusHistoryLoading(false);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      if (!NODE_API) {
        setError("API URL not configured (VITE_NODE_USER_ACTIVITY_API)");
        return;
      }
      // Don't fetch until filters are initialized with default exclusions
      if (!filtersInitialized) {
        console.log('[AllSearches] Skipping fetch, filters not yet initialized');
        return;
      }
      setLoading(true);
      setError(null);
      const f = appliedRef.current;
      try {
        // Build parameters for both main search and summary
        const buildParams = (includePageSize = true) => {
          const params = new URLSearchParams();
          if (f.dateRange === "Custom") {
            // Send date and time as separate parameters - let backend know these are user's local times
            params.set("from_date", f.fromDate);
            params.set("from_time", f.fromTime + ":00");
            params.set("to_date", f.toDate);
            params.set("to_time", f.toTime + ":59");
            // Send timezone offset so backend can convert local time to UTC correctly
            params.set("tz_offset_minutes", new Date().getTimezoneOffset());
          } else {
            params.set("date_range", f.dateRange);
          }
          if (includePageSize) {
            params.set("page", String(page));
            params.set("size", String(PAGE_SIZE));
          }
          if (f.includedUsers?.length > 0) params.set("users",         f.includedUsers.join(","));
          if (f.excludedUsers?.length > 0) params.set("exclude_users", f.excludedUsers.join(","));
          if (f.keyword)              params.set("keyword",    f.keyword);
          if (f.advertiser)           params.set("advertiser", f.advertiser);
          if (f.domain)               params.set("domain",     f.domain);
          if (f.platform)             params.set("platform",   f.platform);
          if (f.activityTypes?.length > 0) params.set("activity_type", f.activityTypes.join(","));
          return params;
        };

        const params = buildParams(true);
        const summaryParams = buildParams(false);

        const token = Cookies.get("token");

        const allSearchesUrl = `${NODE_API}/intelligence/all-searches?${params.toString()}`;
        const summaryUrl = `${NODE_API}/intelligence/summary?${summaryParams.toString()}`;
        console.log('[AllSearches] Query Params:', {
          date_range: applied.dateRange,
          from_date: applied.fromDate,
          from_time: applied.fromTime,
          to_date: applied.toDate,
          to_time: applied.toTime,
          users: applied.includedUsers.join(','),
          exclude_users: applied.excludedUsers.join(','),
          keyword: applied.keyword,
          advertiser: applied.advertiser,
          domain: applied.domain,
          platform: applied.platform,
          activity_types: applied.activityTypes?.join(','),
        });

        // Fetch both in parallel
        const [mainRes, summaryRes] = await Promise.all([
          fetch(allSearchesUrl, {
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          }),
          fetch(summaryUrl, {
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          })
        ]);

        if (!mainRes.ok) throw new Error(`Server error: ${mainRes.status}`);
        const json = await mainRes.json();
        if (json.code !== 200) throw new Error(json.message || "Unexpected response");

        const rowsData = json.data.rows ?? [];
        console.log("All-searches response - sample row platforms:", rowsData[0]?.platform);
        setRows(rowsData);
        setTotal(json.data.total ?? 0);
        setTotalPages(json.data.total_pages ?? 1);
        setDateLabel(json.meta?.date_label ?? "");

        // Handle summary response
        if (summaryRes.ok) {
          const summaryJson = await summaryRes.json();
          if (summaryJson.code === 200) setSummaryStats(summaryJson.data);
        }
      } catch (err) {
        setError(err.message || "Failed to load data");
        setRows([]);
        setTotal(0);
        setTotalPages(1);
        setSummaryStats({ platforms: [], activity_types: [], sort_by: [], pages_visited: [], total: 0, search_counts: { keywords: { unique: 0, total: 0 }, advertisers: { unique: 0, total: 0 }, domains: { unique: 0, total: 0 } }, action_counts: { sorting_total: 0, sorting_breakdown: [], other_actions_total: 0, other_actions_breakdown: {}, filters_total: 0, filters_breakdown: [] } });
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchTick, page, filtersInitialized]);

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

      // Auto-select activity types based on filled text fields
      if (patch) {
        const updatedTypes = new Set();
        // Only add types that have non-empty values in the final state
        if (next.keyword && next.keyword !== '') updatedTypes.add('keyword');
        if (next.advertiser && next.advertiser !== '') updatedTypes.add('advertiser');
        if (next.domain && next.domain !== '') updatedTypes.add('domain');
        next.activityTypes = Array.from(updatedTypes);
      }

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
    // Reset to defaults: Last 90 days + exclude globussoft.in emails
    const fresh = {
      ...EMPTY,
      fromDate: todayStr(),
      toDate: todayStr(),
      dateRange: "Last 90 days",
      excludedUsers: defaultExcludedUsers && defaultExcludedUsers.length > 0 ? defaultExcludedUsers : []
    };
    console.log('[handleReset] Reset to fresh state:', { excludedUsers: fresh.excludedUsers, defaultExcludedUsers });
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
    applied.dateRange && { key: "dateRange", label: applied.dateRange === "Custom"
      ? `Custom: ${applied.fromDate} → ${applied.toDate}`
      : applied.dateRange,
      clear: () => clearChip({ dateRange: "Last 90 days" }) },
    applied.includedUsers && applied.includedUsers.length > 0 && { key: "includedUsers", label: `Include: ${applied.includedUsers.length} user${applied.includedUsers.length > 1 ? "s" : ""}`,
      clear: () => clearChip({ includedUsers: [] }) },
    (applied.excludedUsers && applied.excludedUsers.length > 0) && { key: "excludedUsers", label: `Exclude: ${applied.excludedUsers.length} user${applied.excludedUsers.length > 1 ? "s" : ""}`,
      clear: () => { console.log('[activeChips] Clearing excluded users, resetting to default:', defaultExcludedUsers); clearChip({ excludedUsers: defaultExcludedUsers }); } },
    applied.keyword      && { key: "keyword",    label: `Keyword: ${applied.keyword}`,
      clear: () => clearChip({ keyword: "" }) },
    applied.advertiser   && { key: "advertiser", label: `Advertiser: ${applied.advertiser}`,
      clear: () => clearChip({ advertiser: "" }) },
    applied.domain       && { key: "domain",     label: `Domain: ${applied.domain}`,
      clear: () => clearChip({ domain: "" }) },
    applied.platform     && { key: "platform",   label: `Platform: ${applied.platform}`,
      clear: () => clearChip({ platform: "" }) },
    applied.activityTypes?.length > 0 && { key: "activityTypes", label: `Activity: ${applied.activityTypes.map(t => ACTIVITY_TYPES.find(a => a.key === t)?.label || t).join(", ")}`,
      clear: () => clearChip({ activityTypes: [] }) },
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

    // Determine which activity types to show
    const showAllActivityTypes = applied.activityTypes?.length === 0;
    const showKeyword = showAllActivityTypes || applied.activityTypes?.includes('keyword');
    const showAdvertiser = showAllActivityTypes || applied.activityTypes?.includes('advertiser');
    const showDomain = showAllActivityTypes || applied.activityTypes?.includes('domain');

    return rows.map((row, i) => {
      const { initials, color } = getAvatarProps(row.email);
      return (
        <tr
          key={i}
          style={{ borderBottom: "1px solid #f3f4f6", backgroundColor: "white", height: forceExpand ? "auto" : "auto", minHeight: forceExpand ? "120px" : "auto", verticalAlign: "top" }}
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
          {showKeyword && (
            <td style={{ padding: "10px 12px", overflow: "hidden" }}>
              <span style={{ display: "inline-block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", background: "#e0e7ff", color: "#4338ca", padding: "2px 8px", borderRadius: "4px", fontSize: "12px" }}>
                {row.keyword ?? "—"}
              </span>
            </td>
          )}
          {showAdvertiser && (
            <td style={{ padding: "10px 12px", color: "#374151", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {row.advertiser ?? "—"}
            </td>
          )}
          {showDomain && (
            <td style={{ padding: "10px 12px", color: "#374151", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {row.domain ?? "—"}
            </td>
          )}
          <td style={{ padding: "10px 12px", overflow: "visible", minWidth: forceExpand ? "600px" : "200px", verticalAlign: "top" }}>
            {row.platform ? (
              <PlatformCell platforms={String(row.platform).split(',').map(p => p.trim()).filter(Boolean)} isExport={forceExpand} />
            ) : <span style={{ color: "#9ca3af" }}>—</span>}
          </td>
          <td style={{ padding: "10px 12px", color: "#374151", fontSize: "12px", textAlign: "left", whiteSpace: "nowrap" }}>
            {row.ads_count != null ? Number(row.ads_count).toLocaleString() : <span style={{ color: "#9ca3af" }}>—</span>}
          </td>
          <td style={{ padding: "10px 12px", color: "#374151", fontSize: "12px", textAlign: "center", whiteSpace: "nowrap" }}>
            {(row.keyword || row.advertiser || row.domain) ? (
              <button
                onClick={() => openStatusModal(row)}
                style={{ display: "inline-block", background: "#dbeafe", color: "#1e40af", border: "1px solid #93c5fd", padding: "4px 10px", borderRadius: "4px", fontSize: "11px", fontWeight: 600, cursor: "pointer", textDecoration: "none" }}
              >
                Check Status
              </button>
            ) : <span style={{ color: "#9ca3af" }}>—</span>}
          </td>
          <td style={{ padding: "10px 12px" }}>
            {row.filters_applied?.length > 0
              ? <FilterPillsCell pills={row.filters_applied} />
              : <span style={{ color: "#9ca3af" }}>—</span>}
          </td>
          <td style={{ padding: "10px 12px" }}>
            {row.other_activity ? (
              <span style={{ display: "inline-block", background: "#fef3c7", color: "#d97706", border: "1px solid #fde68a", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", whiteSpace: "nowrap" }}>
                {row.other_activity}
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

          {/* Include Users */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Include Users</label>
            <SingleUserInput
              users={draft.includedUsers ?? []}
              options={filterOptions.users}
              mode="include"
              placeholder="email or .domain..."
              otherUsers={draft.excludedUsers ?? []}
              onChange={(users) => handleApply({ includedUsers: users })}
              onOtherUsersChange={(users) => handleApply({ excludedUsers: users })}
            />
          </div>

          {/* Exclude Users */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Exclude Users</label>
            <SingleUserInput
              users={draft.excludedUsers ?? []}
              options={filterOptions.users}
              mode="exclude"
              placeholder="email or .domain..."
              otherUsers={draft.includedUsers ?? []}
              onChange={(users) => handleApply({ excludedUsers: users })}
              onOtherUsersChange={(users) => handleApply({ includedUsers: users })}
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
              value={draft.platform || ""}
              onChange={(e) => applyImmediate({ platform: e.target.value })}
              style={{ ...inputStyle, background: "white" }}
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

        </div>

        {/* Activity Type Buttons — toggle multiple selections */}
        <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "#374151", marginRight: "4px" }}>Filter by Activity:</span>
          <button
            onClick={() => clearChip({ activityTypes: [] })}
            style={{ padding: "6px 16px", borderRadius: "6px", fontSize: "12px", fontWeight: 500, border: draft.activityTypes?.length === 0 ? "1px solid #4338ca" : "1px solid #d1d5db", cursor: "pointer", background: draft.activityTypes?.length === 0 ? "#4338ca" : "white", color: draft.activityTypes?.length === 0 ? "white" : "#374151" }}
          >
            All
          </button>
          {ACTIVITY_TYPES.map((act) => {
            const isSelected = draft.activityTypes?.includes(act.key);
            return (
              <button
                key={act.key}
                onClick={() => {
                  const newTypes = isSelected
                    ? draft.activityTypes.filter((t) => t !== act.key)
                    : [...(draft.activityTypes || []), act.key];
                  applyImmediate({ activityTypes: newTypes });
                }}
                style={{ padding: "6px 16px", borderRadius: "6px", fontSize: "12px", fontWeight: 500, border: isSelected ? "1px solid #4338ca" : "1px solid #d1d5db", cursor: "pointer", background: isSelected ? "#4338ca" : "white", color: isSelected ? "white" : "#374151" }}
              >
                {act.label}
              </button>
            );
          })}
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

      {/* Active filter chips + result count */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", minHeight: "24px" }}>
          {!forceExpand && <span style={{ fontSize: "12px", color: "#6b7280" }}>Active filters:</span>}
          {activeChips.map((chip) => (
            forceExpand
              ? <span key={chip.key} style={{ display: "inline-block", background: "#e0e7ff", color: "#4338ca", fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "9999px", border: "1px solid #c7d2fe" }}>{chip.label}</span>
              : <FilterPill key={chip.key} label={chip.label} onRemove={chip.clear} />
          ))}
        </div>
        <p style={{ fontSize: "12px", color: "#6b7280", margin: 0 }}>
          {total.toLocaleString()} searches matched{dateLabel ? ` · ${dateLabel}` : ""}
        </p>
      </div>

      {/* Summary bar */}
      {summaryStats.total > 0 && !loading && <SummaryBar summaryStats={summaryStats} />}

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
              <col style={{ minWidth: forceExpand ? "600px" : "200px" }} />
              <col style={{ minWidth: "70px" }} />
              <col style={{ minWidth: "120px" }} />
              <col style={{ minWidth: "280px" }} />
              <col style={{ minWidth: "160px" }} />
            </colgroup>
            <thead>
              <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                {(() => {
                  const showAllActivityTypes = applied.activityTypes?.length === 0;
                  const showKeyword = showAllActivityTypes || applied.activityTypes?.includes('keyword');
                  const showAdvertiser = showAllActivityTypes || applied.activityTypes?.includes('advertiser');
                  const showDomain = showAllActivityTypes || applied.activityTypes?.includes('domain');

                  const headers = ["TIMESTAMP", "USER"];
                  if (showKeyword) headers.push("KEYWORD");
                  if (showAdvertiser) headers.push("ADVERTISER");
                  if (showDomain) headers.push("DOMAIN");
                  headers.push("PLATFORM", "AD COUNT", "KEYWORD STATUS", "FILTERS APPLIED", "OTHER ACTIVITY");

                  return headers.map((h) => (
                    <th key={h} style={{ padding: h === "AD COUNT" ? "10px 6px" : "10px 12px", textAlign: "left", fontSize: "11px", fontWeight: 600, color: "#9ca3af", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                      {h}
                    </th>
                  ));
                })()}
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

      {/* Keyword Status Modal */}
      {statusModalOpen && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "white", borderRadius: "10px", padding: "20px", maxWidth: "900px", width: "90%", maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "#1f2937" }}>Scraping Status - Last 30 Days</h2>
              <button
                onClick={() => setStatusModalOpen(false)}
                style={{ background: "none", border: "none", fontSize: "24px", cursor: "pointer", color: "#6b7280" }}
              >
                ×
              </button>
            </div>

            {statusModalData && (statusModalData.keyword || statusModalData.advertiser || statusModalData.domain) && (
              <div style={{ marginBottom: "16px", padding: "12px", background: "#f3f4f6", borderRadius: "6px" }}>
                {statusModalData.keyword && (
                  <p style={{ margin: "0 0 8px 0", fontSize: "12px", color: "#6b7280" }}>
                    <strong>Keyword:</strong> {statusModalData.keyword}
                  </p>
                )}
                {statusModalData.advertiser && (
                  <p style={{ margin: "0 0 8px 0", fontSize: "12px", color: "#6b7280" }}>
                    <strong>Advertiser:</strong> {statusModalData.advertiser}
                  </p>
                )}
                {statusModalData.domain && (
                  <p style={{ margin: "0 0 8px 0", fontSize: "12px", color: "#6b7280" }}>
                    <strong>Domain:</strong> {statusModalData.domain}
                  </p>
                )}
                {Array.isArray(statusModalData.platform) && statusModalData.platform.length > 0 && (
                  <p style={{ margin: "0 0 8px 0", fontSize: "12px", color: "#6b7280" }}>
                    <strong>Platform:</strong> {statusModalData.platform.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(", ")}
                  </p>
                )}
                {statusModalData.searchedDate && (
                  <p style={{ margin: "0", fontSize: "12px", color: "#6b7280" }}>
                    <strong>Searched Date:</strong> {statusModalData.searchedDate}
                  </p>
                )}
              </div>
            )}

            {statusHistoryLoading ? (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "#9ca3af" }}>Loading...</div>
            ) : statusHistory.length === 0 ? (
              <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: "8px", padding: "20px", textAlign: "center" }}>
                <p style={{ fontSize: "14px", color: "#0369a1", margin: "0 0 8px 0", fontWeight: 600 }}>
                  📋 No Scraping History Found
                </p>
                <p style={{ fontSize: "12px", color: "#0369a1", margin: 0 }}>
                  This {statusModalData?.keyword ? "keyword" : statusModalData?.advertiser ? "advertiser" : "domain"} has not been scheduled for scraping yet.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "110px 110px 130px 130px 80px 80px 100px", gap: "10px", marginBottom: "12px", paddingBottom: "8px", borderBottom: "1px solid #e5e7eb", textAlign: "center" }}>
                    <strong style={{ fontSize: "11px", color: "#6b7280" }}>Scraping Date</strong>
                    <strong style={{ fontSize: "11px", color: "#6b7280" }}>Network</strong>
                    <strong style={{ fontSize: "11px", color: "#6b7280" }}>Start Time</strong>
                    <strong style={{ fontSize: "11px", color: "#6b7280" }}>End Time</strong>
                    <strong style={{ fontSize: "11px", color: "#6b7280" }}>Ads Count</strong>
                    <strong style={{ fontSize: "11px", color: "#6b7280" }}>Status</strong>
                  </div>
                  {statusHistory
                    .map((item, idx) => {
                    let statusColor, statusBg, statusText;
                    if (item.status === 'success' || item.status === 'completed') {
                      statusBg = "#d1fae5";
                      statusColor = "#065f46";
                      statusText = "✓ Completed";
                    } else if (item.status === 'no_ads_found') {
                      statusBg = "#fee2e2";
                      statusColor = "#991b1b";
                      statusText = "✗ No Ads";
                    } else if (item.status === 'scrapping') {
                      statusBg = "#fef3c7";
                      statusColor = "#92400e";
                      statusText = "⟳ Scrapping";
                    } else {
                      statusBg = "#fee2e2";
                      statusColor = "#dc2626";
                      statusText = "✗ Failed";
                    }
                    const startTime = item.startTime ? new Date(item.startTime).toLocaleTimeString() : "-";
                    const endTime = item.endTime ? new Date(item.endTime).toLocaleTimeString() : "-";
                    const isFailed = !item.status || item.status === 'no_ads_found' || item.status === 'failed' || item.status === 'error';
                    const rowBg = isFailed ? "#fff5f5" : "white";
                    const rowBorder = isFailed ? "3px solid #dc2626" : "1px solid #f3f4f6";

                    return (
                      <div key={idx} style={{ display: "grid", gridTemplateColumns: "110px 110px 130px 130px 80px 80px 100px", gap: "10px", padding: "8px 0", borderBottom: "1px solid #f3f4f6", borderLeft: rowBorder, backgroundColor: rowBg, textAlign: "center" }}>
                        <span style={{ fontSize: "11px", color: "#374151" }}>{item.date}</span>
                        <span style={{ fontSize: "11px", color: "#374151", textTransform: "capitalize" }}>{item.network || "-"}</span>
                        <span style={{ fontSize: "11px", color: "#374151" }}>{startTime}</span>
                        <span style={{ fontSize: "11px", color: "#374151" }}>{endTime}</span>
                        <span>
                          {item.adsCount === 0 ? (
                            <span style={{ display: "inline-block", background: "#fecaca", color: "#991b1b", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: 600 }}>
                              no ads found
                            </span>
                          ) : (
                            <span style={{ fontSize: "11px", color: "#374151", fontWeight: 500 }}>{item.adsCount ?? "-"}</span>
                          )}
                        </span>
                        <span style={{ fontSize: "10px", padding: "4px 8px", borderRadius: "4px", background: statusBg, color: statusColor, fontWeight: 600, border: "1px solid #fca5a5" }}>
                          {statusText}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ marginTop: "16px", textAlign: "right" }}>
              <button
                onClick={() => setStatusModalOpen(false)}
                style={{ background: "#6366f1", color: "white", border: "none", padding: "6px 16px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AllSearches;
