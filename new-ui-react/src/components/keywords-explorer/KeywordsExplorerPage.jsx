import React, { useCallback, useEffect, useState } from "react";
import { Search, Upload } from "lucide-react";
import { getGoogleKeywordsExplorer, importGoogleKeywordsFile, importGoogleKeywordsText } from "../../services/api";
import { Loading } from "../modals/google/GoogleIntelShared.jsx";
import KeywordFilterBar from "./KeywordFilterBar.jsx";
import KeywordExplorerTable from "./KeywordExplorerTable.jsx";
import KeywordListsPanel from "./KeywordListsPanel.jsx";

const PAGE_SIZE = 50;

/**
 * Ahrefs/SEMrush-style Keywords Explorer — a dedicated page (not a modal) for
 * browsing/filtering/saving PowerAdSpy's Google keyword corpus at scale.
 * Backed by /keywords/explorer (keyword_stats rollup), not live ES.
 *
 * Row clicks delegate to the EXISTING single-keyword KeywordExplorerModal via
 * `onOpenKeyword` (passed down from App.jsx's openKeywordExplorer) — this page
 * only owns the browse/filter/list layer, not the drill-down.
 */
const KeywordsExplorerPage = ({ onOpenKeyword }) => {
  const [pasteText, setPasteText] = useState("");
  const [filters, setFilters] = useState({});
  const [sort, setSort] = useState({ sort_by: "ads_total", sort_dir: "desc" });
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("explorer");
  const [notFound, setNotFound] = useState([]);
  const [importing, setImporting] = useState(false);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getGoogleKeywordsExplorer({ page, page_size: PAGE_SIZE, ...sort, ...filters });
      if (res.code === 200) {
        setRows(res.data.keywords || []);
        setTotal(res.data.total || 0);
      } else {
        setRows([]);
        setTotal(0);
      }
    } catch (e) {
      setError(e.message || "Failed to load keywords.");
    } finally {
      setLoading(false);
    }
  }, [page, sort, filters]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const applyImportResult = (res) => {
    if (res.code === 200) {
      setRows(res.data.matched || []);
      setTotal((res.data.matched || []).length);
      setNotFound(res.data.not_found || []);
    } else {
      setError(res.message || "Import failed.");
    }
  };

  const handleSearchPasted = async () => {
    // An empty box means "go back to browsing everything" rather than a no-op —
    // otherwise clearing the text leaves the previous search's stale results on
    // screen with no obvious way back (the Search button used to just disable).
    if (!pasteText.trim()) { resetToDatabase(); return; }
    setImporting(true);
    setError(null);
    try {
      applyImportResult(await importGoogleKeywordsText({ text: pasteText }));
    } catch (e) {
      setError(e.message || "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  const handleFileUpload = async (file) => {
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      applyImportResult(await importGoogleKeywordsFile({ file }));
    } catch (e) {
      setError(e.message || "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  const resetToDatabase = () => {
    setPasteText("");
    setNotFound([]);
    setFilters({});
    setPage(1);
    fetchRows();
  };

  const busy = loading || importing;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-extrabold text-theme-text mb-1">Keywords Explorer</h1>
        <p className="text-sm text-theme-text-muted mb-4">
          Ad Volume, Competition and Growth are proxies derived from PowerAdSpy&apos;s own crawled Google Search ad
          data — not Google search volume or backlink-based Keyword Difficulty.
        </p>

        <div className="rounded-2xl border border-theme-border bg-theme-card p-4 mb-4">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Enter keywords separated by commas or new lines"
            rows={3}
            className="w-full rounded-lg border border-theme-border bg-transparent p-3 text-sm text-theme-text resize-none focus:outline-none focus:border-[#6b99ff]/60"
          />
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              type="button"
              onClick={handleSearchPasted}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#6b99ff] text-white px-4 py-2 text-xs font-semibold disabled:opacity-50"
            >
              <Search size={14} /> Search
            </button>
            <label className="inline-flex items-center gap-1.5 rounded-lg border border-theme-border px-4 py-2 text-xs font-semibold text-theme-text-secondary cursor-pointer hover:bg-theme-text/[0.04]">
              <Upload size={14} /> CSV or TXT
              <input
                type="file"
                accept=".csv,.txt"
                className="hidden"
                disabled={busy}
                onChange={(e) => { handleFileUpload(e.target.files?.[0]); e.target.value = ""; }}
              />
            </label>
            <button type="button" onClick={resetToDatabase} disabled={busy} className="text-xs text-theme-text-muted hover:text-theme-text ml-auto underline">
              …or explore entire database
            </button>
          </div>
          {notFound.length > 0 ? (
            <p className="text-[11px] text-amber-500 mt-2">
              {notFound.length} keyword(s) not in PowerAdSpy&apos;s corpus: {notFound.slice(0, 10).join(", ")}
              {notFound.length > 10 ? "…" : ""}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-4 border-b border-theme-border mb-4">
          {[
            { key: "explorer", label: "Keywords" },
            { key: "lists", label: "Keyword Lists" },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={`pb-2 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === t.key ? "border-[#6b99ff] text-theme-text" : "border-transparent text-theme-text-muted hover:text-theme-text"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === "explorer" ? (
          <>
            <KeywordFilterBar filters={filters} onChange={(f) => { setFilters(f); setPage(1); }} />
            {busy ? (
              <Loading label="Loading keywords…" />
            ) : error ? (
              <div className="py-16 text-center text-sm text-theme-text-muted">{error}</div>
            ) : (
              <KeywordExplorerTable
                rows={rows}
                total={total}
                page={page}
                pageSize={PAGE_SIZE}
                sort={sort}
                onSortChange={(s) => { setSort(s); setPage(1); }}
                onPageChange={setPage}
                onKeywordClick={onOpenKeyword}
              />
            )}
          </>
        ) : (
          <KeywordListsPanel onOpenKeyword={onOpenKeyword} />
        )}
      </div>
    </div>
  );
};

export default KeywordsExplorerPage;
