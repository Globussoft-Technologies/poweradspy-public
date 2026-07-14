import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Upload, Database, TrendingUp, TrendingDown, Swords, BarChart3 } from "lucide-react";
import { getGoogleKeywordsExplorer, importGoogleKeywordsFile, importGoogleKeywordsText } from "../../services/api";
import KeywordFilterBar from "./KeywordFilterBar.jsx";
import KeywordExplorerTable from "./KeywordExplorerTable.jsx";
import KeywordListsPanel from "./KeywordListsPanel.jsx";

const PAGE_SIZE = 50;

/** Shimmer skeleton shown while keyword rows are loading — mirrors the table's
 *  card + column layout so the swap to real data doesn't jump. */
const KeywordTableSkeleton = ({ rows = 8 }) => (
  <div className="mt-4 rounded-2xl border border-theme-border bg-theme-card overflow-hidden shadow-sm">
    <div className="flex items-center gap-4 border-b border-theme-border bg-theme-text/[0.02] px-4 py-3">
      <div className="h-3.5 w-3.5 rounded bg-theme-text/10" />
      <div className="h-2.5 w-20 rounded bg-theme-text/10" />
    </div>
    <div className="animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-theme-border last:border-0 px-4 py-3">
          <div className="h-3.5 w-3.5 flex-none rounded bg-theme-text/10" />
          <div className="h-3.5 flex-1 max-w-[220px] rounded bg-theme-text/10" />
          <div className="h-5 w-9 flex-none rounded-md bg-theme-text/10" />
          <div className="h-3.5 w-14 flex-none rounded bg-theme-text/10" />
          <div className="h-3.5 w-12 flex-none rounded bg-theme-text/10" />
          <div className="h-3.5 w-28 flex-none rounded bg-theme-text/10" />
          <div className="h-3.5 w-20 flex-none rounded bg-theme-text/10" />
        </div>
      ))}
    </div>
  </div>
);

const fmtNum = (n) => (n == null ? "–" : Number(n).toLocaleString("en-US"));
const compBarColor = (s) => (s == null ? "bg-gray-400" : s < 34 ? "bg-emerald-500" : s < 67 ? "bg-amber-500" : "bg-red-500");

const StatCard = ({ icon, label, children }) => (
  <div className="rounded-2xl border border-theme-border bg-theme-card px-4 py-3.5 shadow-sm">
    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">
      {icon}{label}
    </div>
    {children}
  </div>
);

/** Summary stat cards above the table — driven by the aggregate `stats` the
 *  /keywords/explorer API returns over the whole filtered set. */
const StatCards = ({ stats }) => {
  if (!stats) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4 [font-variant-numeric:tabular-nums]">
      <StatCard icon={<Search size={12} className="text-[#6b99ff]" />} label="Keywords">
        <div className="mt-1.5 text-2xl font-extrabold text-theme-text">{fmtNum(stats.keywords)}</div>
      </StatCard>
      <StatCard icon={<Swords size={12} className="text-[#6b99ff]" />} label="Avg Competition">
        <div className="mt-1.5 text-2xl font-extrabold text-theme-text">{stats.avg_competition ?? "–"}</div>
        <div className="mt-2 h-1.5 rounded-full bg-theme-text/[0.06] overflow-hidden">
          <div className={`h-full rounded-full ${compBarColor(stats.avg_competition)}`} style={{ width: `${Math.max(0, Math.min(100, stats.avg_competition ?? 0))}%` }} />
        </div>
      </StatCard>
      <StatCard icon={<BarChart3 size={12} className="text-[#6b99ff]" />} label="Total Ad Volume">
        <div className="mt-1.5 text-2xl font-extrabold text-theme-text">{fmtNum(stats.total_ad_volume)}</div>
        <div className="mt-0.5 text-[11px] text-theme-text-muted">ads across matches</div>
      </StatCard>
      <StatCard icon={<TrendingUp size={12} className="text-[#6b99ff]" />} label="Trending">
        <div className="mt-1.5 flex items-center gap-3">
          <span className="inline-flex items-center gap-1 text-xl font-extrabold text-emerald-500"><TrendingUp size={16} />{fmtNum(stats.trending_up)}</span>
          <span className="inline-flex items-center gap-1 text-xl font-extrabold text-red-500"><TrendingDown size={16} />{fmtNum(stats.trending_down)}</span>
        </div>
        <div className="mt-0.5 text-[11px] text-theme-text-muted">up vs down</div>
      </StatCard>
    </div>
  );
};

// Client-side stats for the import/search view (API returns the full matched
// set there, not a page — so averaging/summing it is accurate).
const computeStats = (list = []) => {
  if (!list.length) return { keywords: 0, avg_competition: null, total_ad_volume: 0, trending_up: 0, trending_down: 0 };
  const comp = list.filter((r) => r.competition_score != null);
  return {
    keywords: list.length,
    avg_competition: comp.length ? Math.round(comp.reduce((s, r) => s + Number(r.competition_score), 0) / comp.length) : null,
    total_ad_volume: list.reduce((s, r) => s + (Number(r.ads_total) || 0), 0),
    trending_up: list.filter((r) => Number(r.growth_pct) > 0).length,
    trending_down: list.filter((r) => Number(r.growth_pct) < 0).length,
  };
};

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
  const [stats, setStats] = useState(null);
  // 'browse' = full DB (server-paginated/sorted); 'search' = import/search result
  // (the matched set is loaded whole, so sorting/paging happen client-side and must
  // NOT trigger a browse refetch — that was reloading the entire DB list on sort).
  const [mode, setMode] = useState("browse");

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getGoogleKeywordsExplorer({ page, page_size: PAGE_SIZE, ...sort, ...filters });
      if (res.code === 200) {
        setRows(res.data.keywords || []);
        setTotal(res.data.total || 0);
        setStats(res.data.stats || null);
      } else {
        setRows([]);
        setTotal(0);
        setStats(null);
      }
    } catch (e) {
      setError(e.message || "Failed to load keywords.");
    } finally {
      setLoading(false);
    }
  }, [page, sort, filters]);

  // Only the browse mode hits the server. In search mode the matched rows are
  // already loaded, so a sort/page/filter change must NOT re-run fetchRows (which
  // would replace the search result with the whole database).
  useEffect(() => { if (mode === "browse") fetchRows(); }, [fetchRows, mode]);

  // In search mode, sort the loaded matched rows client-side so the sort arrows
  // reorder just the result (browse mode is already server-sorted → pass through).
  // Empty/null values always sort last regardless of direction.
  const displayRows = useMemo(() => {
    if (mode !== "search") return rows;
    const { sort_by, sort_dir } = sort;
    const dir = sort_dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a?.[sort_by];
      const bv = b?.[sort_by];
      const aEmpty = av == null || av === "";
      const bEmpty = bv == null || bv === "";
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      const an = Number(av);
      const bn = Number(bv);
      if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * dir;
      if (sort_by === "first_seen") return (new Date(av) - new Date(bv)) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, sort, mode]);

  // Clear the previous results so a failed/empty import doesn't leave the stat
  // cards (Keywords / Avg Competition / Total Ad Volume / Trending) and the table
  // showing the stale database-browse numbers behind the error message. e.g.
  // uploading a CSV whose keyword column is empty → 0 matches → counts must read 0.
  // computeStats([]) → { keywords: 0, avg_competition: null, total_ad_volume: 0, ... }.
  const clearResults = () => {
    setRows([]);
    setTotal(0);
    setNotFound([]);
    setStats(computeStats([]));
  };

  const applyImportResult = (res) => {
    if (res.code === 200) {
      setRows(res.data.matched || []);
      setTotal((res.data.matched || []).length);
      setNotFound(res.data.not_found || []);
      setStats(computeStats(res.data.matched || []));
    } else {
      clearResults();
      setError(res.message || "Import failed.");
    }
  };

  const handleSearchPasted = async () => {
    // An empty box means "go back to browsing everything" rather than a no-op —
    // otherwise clearing the text leaves the previous search's stale results on
    // screen with no obvious way back (the Search button used to just disable).
    if (!pasteText.trim()) { resetToDatabase(); return; }
    setMode("search");
    setPage(1); // reset stale browse page so it doesn't show e.g. "Page 4 of 1"
    setImporting(true);
    setError(null);
    try {
      applyImportResult(await importGoogleKeywordsText({ text: pasteText }));
    } catch (e) {
      clearResults();
      setError(e.message || "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  const handleFileUpload = async (file) => {
    if (!file) return;
    setMode("search");
    setPage(1); // reset stale browse page so it doesn't show e.g. "Page 4 of 1"
    setImporting(true);
    setError(null);
    try {
      applyImportResult(await importGoogleKeywordsFile({ file }));
    } catch (e) {
      clearResults();
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
    // Switch back to browse — the guarded effect refetches the full DB (setFilters
    // always passes a fresh {} ref, so fetchRows is recreated and the effect fires).
    setMode("browse");
  };

  const busy = loading || importing;

  // "Keyword Lists" is hidden for now — the lists corpus isn't populated yet.
  // Re-add { key: "lists", label: "Keyword Lists" } here to bring the tab back.
  const TABS = [
    { key: "explorer", label: "Keywords" },
  ];

  return (
    <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
      {/* pb-24 keeps the table's Prev/Next pagination clear of the fixed
          chatbot widget floating at the bottom-right of the viewport. */}
      <div className="px-4 sm:px-6 pt-5 pb-24">
        {/* ── Header ───────────────────────────────────────────── */}
        <div className="mb-4">
          <h1 className="text-xl font-bold tracking-tight text-theme-text">Keywords Explorer</h1>
          <p className="mt-1 text-xs text-theme-text-secondary">
            Volume, Competition &amp; Growth — proxies from PowerAdSpy&apos;s crawled Google-ads data.
          </p>
        </div>

        {/* ── Search toolbar ───────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {/* Unified search pill — input + embedded submit share one rounded bar */}
          <div className="flex items-center flex-1 min-w-[240px] max-w-md rounded-full border border-theme-border bg-theme-card pl-4 pr-1.5 shadow-sm transition-all focus-within:border-[#6b99ff] focus-within:ring-2 focus-within:ring-[#6b99ff]/15 focus-within:shadow-md">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSearchPasted(); } }}
              rows={1}
              placeholder="Search keyword"
              className="w-full resize-none bg-transparent py-2.5 text-[13px] leading-snug text-theme-text focus:outline-none placeholder:text-theme-text-muted"
            />
            <button
              type="button"
              onClick={handleSearchPasted}
              disabled={busy}
              aria-label="Search"
              className="group/srch relative flex-none inline-flex items-center justify-center rounded-full h-8 w-8 text-theme-text-muted transition-colors hover:text-theme-text hover:bg-theme-text/[0.06] active:scale-95 disabled:opacity-50"
            >
              <Search size={15} />
              <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 z-30 mt-2 whitespace-nowrap rounded-lg border border-theme-border bg-theme-surface px-2.5 py-1.5 text-[11px] font-semibold text-theme-text-secondary opacity-0 shadow-xl transition-opacity duration-150 group-hover/srch:opacity-100">
                Search
              </span>
            </button>
          </div>

          {/* Import — icon button, right next to the search bar */}
          <label
            aria-label="Import CSV / TXT keywords"
            className="group/imp relative flex-none inline-flex items-center justify-center rounded-full border border-theme-border bg-theme-card h-9 w-9 text-theme-text-secondary cursor-pointer transition-colors hover:text-theme-text hover:bg-theme-text/[0.06] active:scale-95"
          >
            <Upload size={16} className="transition-transform group-hover/imp:-translate-y-0.5" />
            <input
              type="file"
              accept=".csv,.txt"
              className="hidden"
              disabled={busy}
              onChange={(e) => { handleFileUpload(e.target.files?.[0]); e.target.value = ""; }}
            />
            <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full z-30 mt-2 whitespace-nowrap rounded-lg border border-theme-border bg-theme-surface px-2.5 py-1.5 text-[11px] font-semibold text-theme-text-secondary opacity-0 shadow-xl transition-opacity duration-150 group-hover/imp:opacity-100">
              Import CSV / TXT keywords
            </span>
          </label>

          {/* Explore — right next to Import, near the search bar */}
          <button
            type="button"
            onClick={resetToDatabase}
            disabled={busy}
            aria-label="Explore entire database"
            className="group/exp relative flex-none inline-flex items-center justify-center rounded-full border border-theme-border bg-theme-card h-9 w-9 text-theme-text-secondary transition-colors hover:text-theme-text hover:bg-theme-text/[0.06] active:scale-95 disabled:opacity-50"
          >
            <Database size={16} />
            <span className="pointer-events-none absolute right-0 top-full z-30 mt-2 whitespace-nowrap rounded-lg border border-theme-border bg-theme-surface px-2.5 py-1.5 text-[11px] font-semibold text-theme-text-secondary opacity-0 shadow-xl transition-opacity duration-150 group-hover/exp:opacity-100">
              Explore entire database
            </span>
          </button>
        </div>
        {notFound.length > 0 ? (
          <p className="mb-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs font-medium text-amber-500">
            {notFound.length} keyword(s) not in PowerAdSpy&apos;s corpus: {notFound.slice(0, 10).join(", ")}
            {notFound.length > 10 ? "…" : ""}
          </p>
        ) : null}

        {/* ── Summary stat cards ───────────────────────────────── */}
        {activeTab === "explorer" ? <StatCards stats={stats} /> : null}

        {/* ── Segmented tabs (hidden when only one tab is available) ── */}
        {TABS.length > 1 ? (
          <div className="inline-flex items-center gap-1 rounded-xl border border-theme-border bg-theme-text/[0.04] p-1 mt-4 mb-4">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={`rounded-lg px-4 py-1.5 text-[13px] font-bold transition-all duration-200 ${
                  activeTab === t.key
                    ? "bg-theme-card text-theme-text shadow-sm"
                    : "text-theme-text-muted hover:text-theme-text"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-4" />
        )}

        {activeTab === "explorer" ? (
          <>
            <div className="sticky top-0 z-10 -mx-1 px-1 py-1">
              <KeywordFilterBar filters={filters} onChange={(f) => { setFilters(f); setPage(1); }} />
            </div>
            {busy ? (
              <KeywordTableSkeleton />
            ) : error ? (
              <div className="py-16 text-center text-sm text-theme-text-muted">{error}</div>
            ) : (
              <KeywordExplorerTable
                rows={displayRows}
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
