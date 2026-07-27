import React, { useState } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, TrendingUp, TrendingDown, SearchX, Lock } from "lucide-react";
import { fmtInt } from "../modals/google/GoogleIntelShared.jsx";
import AddToListMenu from "./AddToListMenu.jsx";

// "Add to list" is hidden until the Keyword Lists backend is wired up — the
// button did nothing when clicked. Flip to true to bring back the row-select
// checkboxes + the bulk "Add to list" action.
const SHOW_ADD_TO_LIST = false;

const COLUMNS = [
  { key: "competition_score", accessKey: "competition", label: "Competition", sortable: true, align: "left", tip: "How crowded the keyword is (0–100) — ranked by how many advertisers use it." },
  { key: "ads_total", accessKey: "adVolume", label: "Ad Volume", sortable: true, align: "left", tip: "Number of unique ads using this keyword across the crawled corpus." },
  { key: "growth_pct", accessKey: "growth", label: "Growth", sortable: true, align: "left", tip: "Change in ad activity: last 30 days vs the previous 30 days." },
  { key: "category", accessKey: "parentTopic", label: "Parent Topic", sortable: false, align: "left", tip: "The dominant category across this keyword's ads." },
  { key: "first_seen", accessKey: "firstSeen", label: "First seen", sortable: true, align: "left", tip: "The earliest date any ad for this keyword was crawled." },
];

const LockedValue = ({ label, onUpgrade }) => (
  <button
    type="button"
    onClick={onUpgrade}
    title={`Upgrade to unlock ${label}`}
    className="inline-flex items-center gap-1 rounded-md border border-[#6b99ff]/20 bg-[#6b99ff]/10 px-2 py-1 text-[10px] font-bold text-[#6b99ff]"
  >
    <Lock size={10} /> Upgrade
  </button>
);

const competitionColor = (score) => {
  if (score == null) return "bg-gray-400/15 text-gray-400";
  if (score < 34) return "bg-emerald-500/15 text-emerald-500";
  if (score < 67) return "bg-amber-500/15 text-amber-500";
  return "bg-red-500/15 text-red-500";
};

// Friendly date: "Today" / "Yesterday" / "14 Aug 2023" — never the raw ISO string.
// yyyy-MM-dd is parsed as a LOCAL date (not UTC) to avoid an off-by-one shift.
const fmtDate = (raw) => {
  if (!raw) return "–";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw));
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(raw);
  if (isNaN(d.getTime())) return String(raw);
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const now = new Date();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

/** Sortable/paginated keyword table backed by /keywords/explorer (keyword_stats).
 *  Row click opens the existing single-keyword KeywordExplorerModal (via onKeywordClick);
 *  checkbox selection feeds the bulk "Add to list" action. */
const KeywordExplorerTable = ({ rows, total, page, pageSize, sort, onSortChange, onPageChange, onKeywordClick, access = {}, onUpgrade }) => {
  const [selected, setSelected] = useState(new Set());
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selectedKeywords = rows.filter((r) => selected.has(r.keyword_id)).map((r) => r.keyword);
  const allSelected = rows.length > 0 && selected.size === rows.length;

  const toggleSort = (key) => {
    if (sort.sort_by === key) onSortChange({ sort_by: key, sort_dir: sort.sort_dir === "asc" ? "desc" : "asc" });
    else onSortChange({ sort_by: key, sort_dir: "desc" });
  };

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.keyword_id))));
  };

  if (!rows.length) {
    return (
      <div className="mt-4 rounded-2xl border border-theme-border bg-theme-card py-20 text-center shadow-sm">
        <div className="mx-auto mb-3.5 flex h-12 w-12 items-center justify-center rounded-full bg-theme-text/[0.04] text-theme-text-muted">
          <SearchX size={22} />
        </div>
        <p className="text-sm font-bold text-theme-text">No keywords found</p>
        <p className="mt-1 text-xs text-theme-text-muted">Try widening your filters or exploring the entire database.</p>
      </div>
    );
  }

  // Column tips use the native `title` attribute — the styled popover was
  // clipped by the table's overflow/scroll container. Native title is never cut off.
  const SortHeader = ({ col }) => {
    const active = sort.sort_by === col.key;
    return (
      <th className={`relative px-4 py-3 font-bold ${col.align === "right" ? "text-right" : "text-left"}`}>
        {access[col.accessKey] !== false && col.sortable ? (
          <button
            type="button"
            title={col.tip || undefined}
            onClick={() => toggleSort(col.key)}
            className={`group/th inline-flex items-center gap-1 cursor-pointer transition-colors ${col.align === "right" ? "flex-row-reverse" : ""} ${active ? "text-theme-text" : "hover:text-theme-text"}`}
          >
            {col.label}
            {active ? (
              sort.sort_dir === "asc" ? <ChevronUp size={13} className="text-[#6b99ff]" /> : <ChevronDown size={13} className="text-[#6b99ff]" />
            ) : (
              <ChevronsUpDown size={13} className="opacity-0 transition-opacity group-hover/th:opacity-40" />
            )}
          </button>
        ) : (
          <span title={access[col.accessKey] === false ? `Upgrade to unlock ${col.label}` : col.tip || undefined} className={`inline-flex items-center gap-1 ${col.tip ? "cursor-help" : ""}`}>
            {access[col.accessKey] === false ? <Lock size={10} /> : null}{col.label}
          </span>
        )}
      </th>
    );
  };

  return (
    <div className="mt-4 flex flex-col rounded-2xl border border-theme-border bg-theme-card overflow-hidden shadow-sm">
      {SHOW_ADD_TO_LIST && selected.size > 0 ? (
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-theme-border bg-[#6b99ff]/[0.07]">
          <span className="text-xs font-semibold text-[#6b99ff]">{selected.size} selected</span>
          <AddToListMenu keywords={selectedKeywords} onDone={() => setSelected(new Set())} />
        </div>
      ) : null}

      {/* Scrollable table area — thead sticks to the top of THIS box */}
      <div className="overflow-auto max-h-[calc(100vh-15rem)]">
        <table className="w-full text-[13px] [font-variant-numeric:tabular-nums]">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-theme-border bg-theme-card/95 backdrop-blur text-left text-[11px] uppercase tracking-wider text-theme-text-secondary">
              {SHOW_ADD_TO_LIST ? (
                <th className="px-4 py-3 w-9">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="h-3.5 w-3.5 accent-[#6b99ff] cursor-pointer align-middle"
                  />
                </th>
              ) : null}
              <th className="px-4 py-3 font-bold">
                <span className="inline-flex items-center gap-1">
                  {access.keyword === false ? <Lock size={10} /> : null}Keyword
                </span>
              </th>
              {COLUMNS.map((col) => <SortHeader key={col.key} col={col} />)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const g = row.growth_pct;
              return (
                <tr key={row.keyword_id} className="border-b border-theme-border last:border-0 transition-colors hover:bg-theme-text/[0.03]">
                  {SHOW_ADD_TO_LIST ? (
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={selected.has(row.keyword_id)}
                        onChange={() => toggleSelect(row.keyword_id)}
                        className="h-3.5 w-3.5 accent-[#6b99ff] cursor-pointer align-middle"
                      />
                    </td>
                  ) : null}
                  <td className="px-4 py-2.5">
                    {access.keyword === false ? <LockedValue label="Keyword" onUpgrade={onUpgrade} /> : (
                      <button
                        type="button"
                        title={row.keyword}
                        onClick={() => onKeywordClick?.(row.keyword)}
                        className="block max-w-[320px] truncate font-semibold text-[#6b99ff] text-left transition-colors hover:brightness-110 hover:underline"
                      >
                        {row.keyword}
                      </button>
                    )}
                  </td>
                   <td className="px-4 py-2.5">
                    {access.competition === false ? <LockedValue label="Competition" onUpgrade={onUpgrade} /> : (
                     <span className={`inline-flex min-w-[2.1rem] items-center justify-center rounded-md px-2 py-1 text-xs font-extrabold ${competitionColor(row.competition_score)}`}>
                       {row.competition_score ?? "–"}
                     </span>
                    )}
                   </td>
                  <td className="px-4 py-2.5 font-semibold text-theme-text">{access.adVolume === false ? <LockedValue label="Ad Volume" onUpgrade={onUpgrade} /> : fmtInt(row.ads_total)}</td>
                  <td className="px-4 py-2.5">
                    {access.growth === false ? <LockedValue label="Growth" onUpgrade={onUpgrade} /> : g == null ? (
                      <span className="text-theme-text-muted">–</span>
                    ) : (
                      <span className={`inline-flex items-center gap-1 font-semibold ${g >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                        {g >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                        {g >= 0 ? "+" : ""}{g}%
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-theme-text truncate max-w-[180px]">{access.parentTopic === false ? <LockedValue label="Parent Topic" onUpgrade={onUpgrade} /> : row.category || "–"}</td>
                  <td className="px-4 py-2.5 text-theme-text-secondary whitespace-nowrap">{access.firstSeen === false ? <LockedValue label="First Seen" onUpgrade={onUpgrade} /> : fmtDate(row.first_seen)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination footer (outside the scroll area) — 3-col grid so the
          Prev/Next controls sit dead-center while the count stays left. */}
      <div className="grid grid-cols-3 items-center px-4 py-3 border-t border-theme-border text-xs text-theme-text-muted">
        <span className="justify-self-start"><b className="text-theme-text-secondary font-semibold">{fmtInt(total)}</b> keywords</span>
        <div className="justify-self-center flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="rounded-lg border border-theme-border px-3 py-1.5 font-semibold text-theme-text-secondary transition-colors hover:text-theme-text disabled:opacity-30 disabled:hover:text-theme-text-secondary"
          >
            Prev
          </button>
          <span className="px-1">Page <b className="text-theme-text font-semibold">{page}</b> of {totalPages}</span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="rounded-lg border border-theme-border px-3 py-1.5 font-semibold text-theme-text-secondary transition-colors hover:text-theme-text disabled:opacity-30 disabled:hover:text-theme-text-secondary"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

export default KeywordExplorerTable;
