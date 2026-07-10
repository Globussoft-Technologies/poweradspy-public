import React, { useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { fmtInt } from "../modals/google/GoogleIntelShared.jsx";
import AddToListMenu from "./AddToListMenu.jsx";

const COLUMNS = [
  { key: "competition_score", label: "Competition", sortable: true },
  { key: "ads_total", label: "Ad Volume", sortable: true },
  { key: "growth_pct", label: "Growth", sortable: true },
  { key: "category", label: "Parent Topic", sortable: false },
  { key: "first_seen", label: "First seen", sortable: true },
];

const competitionColor = (score) => {
  if (score == null) return "bg-gray-400/15 text-gray-400";
  if (score < 34) return "bg-emerald-500/15 text-emerald-500";
  if (score < 67) return "bg-amber-500/15 text-amber-500";
  return "bg-red-500/15 text-red-500";
};

/** Sortable/paginated keyword table backed by /keywords/explorer (keyword_stats).
 *  Row click opens the existing single-keyword KeywordExplorerModal (via onKeywordClick);
 *  checkbox selection feeds the bulk "Add to list" action. */
const KeywordExplorerTable = ({ rows, total, page, pageSize, sort, onSortChange, onPageChange, onKeywordClick }) => {
  const [selected, setSelected] = useState(new Set());
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selectedKeywords = rows.filter((r) => selected.has(r.keyword_id)).map((r) => r.keyword);

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
    return <div className="py-16 text-center text-sm text-theme-text-muted">No keywords found.</div>;
  }

  return (
    <div className="rounded-xl border border-theme-border bg-theme-card overflow-hidden">
      {selected.size > 0 ? (
        <div className="flex items-center justify-between px-3 py-2 border-b border-theme-border bg-[#6b99ff]/5">
          <span className="text-xs text-theme-text-secondary">{selected.size} selected</span>
          <AddToListMenu keywords={selectedKeywords} onDone={() => setSelected(new Set())} />
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-theme-border text-left text-[11px] uppercase tracking-wider text-theme-text-muted">
              <th className="px-3 py-2 w-8">
                <input type="checkbox" checked={selected.size === rows.length} onChange={toggleSelectAll} />
              </th>
              <th className="px-3 py-2 font-semibold">Keyword</th>
              {COLUMNS.map((col) => (
                <th key={col.key} className="px-3 py-2 font-semibold">
                  {col.sortable ? (
                    <button type="button" onClick={() => toggleSort(col.key)} className="inline-flex items-center gap-1 hover:text-theme-text">
                      {col.label}
                      {sort.sort_by === col.key ? (sort.sort_dir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : null}
                    </button>
                  ) : col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.keyword_id} className="border-b border-theme-border last:border-0 hover:bg-theme-text/[0.02]">
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selected.has(row.keyword_id)} onChange={() => toggleSelect(row.keyword_id)} />
                </td>
                <td className="px-3 py-2">
                  <button type="button" onClick={() => onKeywordClick?.(row.keyword)} className="text-[#6b99ff] hover:underline font-medium text-left">
                    {row.keyword}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center justify-center rounded px-2 py-0.5 text-xs font-bold ${competitionColor(row.competition_score)}`}>
                    {row.competition_score ?? "–"}
                  </span>
                </td>
                <td className="px-3 py-2 text-theme-text">{fmtInt(row.ads_total)}</td>
                <td className="px-3 py-2">
                  {row.growth_pct == null ? (
                    <span className="text-theme-text-muted">–</span>
                  ) : (
                    <span className={row.growth_pct >= 0 ? "text-emerald-500" : "text-red-500"}>
                      {row.growth_pct >= 0 ? "+" : ""}{row.growth_pct}%
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-theme-text-secondary truncate max-w-[160px]">{row.category || "–"}</td>
                <td className="px-3 py-2 text-theme-text-muted">{row.first_seen || "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-3 py-2 border-t border-theme-border text-xs text-theme-text-muted">
        <span>{fmtInt(total)} keywords</span>
        <div className="flex items-center gap-3">
          <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} className="disabled:opacity-30 hover:text-theme-text">Prev</button>
          <span>Page {page} of {totalPages}</span>
          <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} className="disabled:opacity-30 hover:text-theme-text">Next</button>
        </div>
      </div>
    </div>
  );
};

export default KeywordExplorerTable;
