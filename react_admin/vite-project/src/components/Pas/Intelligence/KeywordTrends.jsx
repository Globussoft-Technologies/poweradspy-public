import React, { useState, useEffect, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import Cookies from "js-cookie";
import ItemFilter from "./ItemFilter";

const NODE_API = (import.meta.env.VITE_NODE_USER_ACTIVITY_API ?? "").trim().replace(/\/$/, "");

const COLORS = ["#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444","#14b8a6"];

// Custom YAxis tick renderer with hover tooltip
const CustomYAxisTick = ({ x, y, payload, chartData }) => {
  const item = chartData?.find((d) => d.displayTerm === payload.value);
  const fullTerm = item?.term || payload.value;

  return (
    <g title={fullTerm}>
      <text
        x={x}
        y={y}
        textAnchor="end"
        fill="#374151"
        fontSize={11}
        title={fullTerm}
      >
        {payload.value}
      </text>
    </g>
  );
};

const TYPE_TABS = [
  { key: "keywords",    label: "Keywords"    },
  { key: "advertisers", label: "Advertisers" },
  { key: "domains",     label: "Domains"     },
];

const KeywordTrends = ({ onDataReady }) => {
  const [sortBy,        setSortBy]        = useState("count");
  const [typeTab,       setTypeTab]       = useState("keywords");  // Default to keywords instead of "all"
  const [data,          setData]          = useState({ keywords: [], advertisers: [], domains: [] });
  const [meta,          setMeta]          = useState(null);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState(null);
  const [searchTerm,    setSearchTerm]    = useState("");
  const [openDropdown,  setOpenDropdown]  = useState(false);
  const [scrapingStats, setScrapingStats] = useState(null);
  const [page,          setPage]          = useState(0);
  const [topKeywords,   setTopKeywords]   = useState([]);
  const [adsCount,      setAdsCount]      = useState(null);
  const [expandedPlatformRows, setExpandedPlatformRows] = useState(new Set());
  const [expandedKeywords, setExpandedKeywords] = useState(new Set());
  const [statusFilter, setStatusFilter] = useState("totalkeywords"); // Default to Total Keywords filter
  const [selectedFilterValue, setSelectedFilterValue] = useState(null); // New state for item filter
  const searchInputRef = useRef(null);
  const tableRef = useRef(null);

  // Fetch top keywords/advertisers/domains for chart - updates when typeTab changes
  useEffect(() => {
    const fetchTopItems = async () => {
      if (!NODE_API) return;
      try {
        const token = Cookies.get("token");
        const typeParam = typeTab === "keywords" ? "keyword" : typeTab === "advertisers" ? "advertiser" : "domain";
        const res = await fetch(`${NODE_API}/intelligence/top-keywords?type=${typeParam}`, {
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) return;
        const json = await res.json();
        if (json.code === 200 && json.data?.items) {
          setTopKeywords(json.data.items);
        }
      } catch (err) {
        console.error('Failed to fetch top items:', err);
      }
    };
    fetchTopItems();
  }, [typeTab]);


  // Fetch summary stats from API when typeTab changes
  useEffect(() => {
    const fetchSummaryStats = async () => {
      if (!NODE_API) return;
      try {
        const token = Cookies.get("token");
        const typeParam = typeTab === "keywords" ? "keyword" : typeTab === "advertisers" ? "advertiser" : "domain";

        // Single API call that returns both today and all-time data
        const res = await fetch(`${NODE_API}/intelligence/summary-stats?type=${typeParam}`, {
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });

        const json = await res.json();

        if (json.code === 200 && json.data) {
          console.log('[fetchSummaryStats] Summary data:', json.data);

          const data = json.data;
          const stats = {
            // Today's stats (use correct field names from API)
            todayCompletedItems: data.today_completed_scraping || 0,
            todayNotQueued: data.today_not_went_scrapping || 0,
            todayScrapingQueued: data.today_under_scraping || 0,
            todayFailed: data.today_failed_scraping || 0,

            // All time stats
            totalItems: data.total || 0,
            completedToday: data.completed_scraping || 0,
            notQueued: data.not_went_scrapping || 0,
            scrapingQueued: data.under_scraping || 0,
            totalScraped: data.completed_scraping || 0,
            totalFailed: data.failed_scraping || 0,
            todayAdsCount: 0,
            totalAdsCount: data.total_ads_count || 0,
          };

          console.log('[fetchSummaryStats] Mapped stats:', stats);
          setScrapingStats(stats);
        }
      } catch (err) {
        console.error('Failed to fetch summary stats:', err);
      }
    };
    fetchSummaryStats();
  }, [typeTab]);

  // Fetch ads count data when typeTab changes
  useEffect(() => {
    const fetchAdsCountData = async () => {
      if (!NODE_API) return;
      try {
        const token = Cookies.get("token");
        const typeParam = typeTab === "keywords" ? "1" : typeTab === "advertisers" ? "2" : "3";
        const res = await fetch(`${NODE_API}/intelligence/total-ads-count?type=${typeParam}&period=total`, {
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) return;
        const json = await res.json();
        if (json.code === 200 && json.data) {
          console.log('[fetchAdsCountData] Ads count data:', json.data);
          setAdsCount(json.data);
        }
      } catch (err) {
        console.error('Failed to fetch ads count:', err);
      }
    };
    fetchAdsCountData();
  }, [typeTab]);

  // Track if typeTab changed (to show loading only on tab change, not pagination)
  const prevTypeTabRef = useRef(typeTab);
  useEffect(() => {
    if (prevTypeTabRef.current !== typeTab) {
      setLoading(true);
      prevTypeTabRef.current = typeTab;
    }
  }, [typeTab]);

  // Fetch table data with pagination (only when page, typeTab, statusFilter, or selectedFilterValue changes)
  useEffect(() => {
    const fetchTableData = async () => {
      if (!NODE_API) { setError("API URL not configured"); return; }
      setError(null);
      try {
        const token = Cookies.get("token");
        const typeParam = typeTab === "keywords" ? "keyword" : typeTab === "advertisers" ? "advertiser" : "domain";
        const params = new URLSearchParams({
          type: typeParam,
          sort_by: "createdAt",
          page: String(page),
          size: "10",
          ...(statusFilter && statusFilter !== "totalkeywords" ? { status: statusFilter } : {}),
          ...(selectedFilterValue ? { search_value: selectedFilterValue } : {})
        });
        console.log('[fetchTableData] params:', Object.fromEntries(params));
        const res = await fetch(`${NODE_API}/intelligence/keyword-trends?${params}`, {
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        const json = await res.json();
        if (json.code !== 200) throw new Error(json.message || "Unexpected response");

        // API response structure: { data: { keywords/advertisers/domains: [...] }, meta: {...} }
        const items = json.data?.keywords || json.data?.advertisers || json.data?.domains || [];

        const transformItems = (items) => items.map((item) => ({
          term: item.keyword || item.advertiser || item.domain || "Unknown",
          type: item.keyword ? "keyword" : item.advertiser ? "advertiser" : "domain",
          count: item.history?.length || 0,
          platforms: item.platform || [],
          searchedDate: item.searchedDate,
          history: item.history || [],
          hasScrappingStatus: (item.history && item.history.length > 0),
        }));

        const transformedItems = transformItems(items);

        setData({
          keywords: typeParam === "keyword" ? transformedItems : [],
          advertisers: typeParam === "advertiser" ? transformedItems : [],
          domains: typeParam === "domain" ? transformedItems : [],
        });
        setMeta(json.meta ?? null);
      } catch (err) {
        setError(err.message || "Failed to load trends");
      } finally {
        setLoading(false);
      }
    };
    fetchTableData();
  }, [typeTab, page, statusFilter, selectedFilterValue]);

  // Full list from API (already paginated and filtered by statusFilter via API)
  const fullList = data[typeTab] ?? [];

  // Expose live data for native PDF export
  const exportDataRef = useRef(null);
  exportDataRef.current = {
    data,
    typeTab,
    sortBy,
    meta,
    // Include full table data for PDF export
    tableList: fullList,
    scrapingStats,
    adsCount
  };
  useEffect(() => {
    if (onDataReady) onDataReady(() => exportDataRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDataReady]);

  // For dropdown search (search across all items, not just current page)
  const allItems = data[typeTab] ?? [];
  const filteredDropdownItems = searchTerm === ""
    ? []
    : allItems
      .filter((item) => item.term && item.term.toLowerCase().includes(searchTerm.toLowerCase()))
      .slice(0, 8);

  // Transform topKeywords for chart - handle dynamic field names (keyword, advertiser, domain)
  const chartData = (topKeywords || [])
    .map((item, idx) => {
      const term = item.keyword || item.advertiser || item.domain || "Unknown";
      return {
        id: `item-${idx + 1}`,
        term: term.trim(),
        searchCount: item.searchCount,
        displayTerm: term.length > 35 ? term.slice(0, 35) + "..." : term,
        count: item.searchCount,
      };
    });

  console.log('[KeywordTrends] Top Keywords received:', topKeywords.length, topKeywords);
  console.log('[KeywordTrends] Chart Data:', chartData.length, chartData);

  const maxCount = chartData.length > 0 ? Math.max(...chartData.map((r) => r.searchCount)) : 1;

  // Calculate dynamic YAxis width based on longest label
  const maxLabelLength = chartData.length > 0 ? Math.max(...chartData.map((d) => d.displayTerm.length), 10) : 10;
  const yAxisWidth = Math.max(80, Math.min(200, maxLabelLength * 6.5));

  const SummaryMetric = ({ label, value, sublabel, filterKey, isActive }) => (
    <div
      onClick={() => {
        if (filterKey) {
          setStatusFilter(statusFilter === filterKey ? null : filterKey);
          setPage(0);
          // Scroll to table after a brief delay to allow state update
          setTimeout(() => {
            tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 100);
        }
      }}
      style={{
        flex: 1, minWidth: "120px", padding: "10px", background: isActive ? "#dbeafe" : "#f9fafb", borderRadius: "8px", textAlign: "center", border: isActive ? "1px solid #7dd3fc" : "1px solid #e5e7eb",
        cursor: filterKey ? "pointer" : "default",
        transition: "all 0.2s"
      }}
      onMouseEnter={(e) => {
        if (filterKey && !isActive) {
          e.currentTarget.style.background = "#f0f9ff";
          e.currentTarget.style.borderColor = "#bfdbfe";
        }
      }}
      onMouseLeave={(e) => {
        if (filterKey && !isActive) {
          e.currentTarget.style.background = "#f9fafb";
          e.currentTarget.style.borderColor = "#e5e7eb";
        }
      }}
    >
      <div style={{ fontSize: "10px", color: "#9ca3af", fontWeight: 500, marginBottom: "3px" }}>{label}</div>
      <div style={{ fontSize: "18px", fontWeight: 700, color: "#111827" }}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {sublabel && <div style={{ fontSize: "10px", color: "#d1d5db", marginTop: "2px" }}>{sublabel}</div>}
    </div>
  );

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

    return (
      <>
        {/* Summary Metrics Section (for all tabs) */}
        {scrapingStats && (
          <div style={{ background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", padding: "12px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
              {/* All Time Metrics - First */}
              <SummaryMetric label={`Total ${typeTab.charAt(0).toUpperCase() + typeTab.slice(1)}`} value={scrapingStats.totalItems} filterKey="totalkeywords" isActive={statusFilter === "totalkeywords"} />
              <SummaryMetric label="Total Scraped Completed" value={scrapingStats.completedToday} filterKey="totalcompleted" isActive={statusFilter === "totalcompleted"} />
              <SummaryMetric label="Total keywords Not Went for Scraping" value={scrapingStats.notQueued} filterKey="totalnotwent" isActive={statusFilter === "totalnotwent"} />
              <SummaryMetric label={`Total under Scraping ${typeTab.charAt(0).toUpperCase() + typeTab.slice(1)}`} value={scrapingStats.scrapingQueued} filterKey="totalunderscrapping" isActive={statusFilter === "totalunderscrapping"} />
              <SummaryMetric label="Total Failed" value={scrapingStats.totalFailed} filterKey="totalfailed" isActive={statusFilter === "totalfailed"} />

              {/* Today's Metrics */}
              <SummaryMetric label="Today Scraped Completed" value={scrapingStats.todayCompletedItems} filterKey="todaycompleted" isActive={statusFilter === "todaycompleted"} />
              <SummaryMetric label="Today Not Went for Scraping" value={scrapingStats.todayNotQueued} filterKey="todaynotwent" isActive={statusFilter === "todaynotwent"} />
              <SummaryMetric label={`Today under Scraping ${typeTab.charAt(0).toUpperCase() + typeTab.slice(1)}`} value={scrapingStats.todayScrapingQueued} filterKey="todayunderscrapping" isActive={statusFilter === "todayunderscrapping"} />
              <SummaryMetric label="Today Failed" value={scrapingStats.todayFailed} filterKey="todayfailed" isActive={statusFilter === "todayfailed"} />
            </div>
          </div>
        )}

        {/* Ads Count Section */}
        {adsCount && (
          <div style={{ background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", padding: "12px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
              {/* Today Ads Count */}
              <SummaryMetric label="Today Ads Count" value={adsCount.today_ads_count} />

              {/* Total Ads Count */}
              <SummaryMetric label="Total Ads Count" value={adsCount.total_ads_count} />

              {/* Platform Wise Breakdown */}
              <div style={{ flex: 1, minWidth: "250px", padding: "10px", background: "#f9fafb", borderRadius: "8px", textAlign: "left", border: "1px solid #e5e7eb" }}>
                <div style={{ fontSize: "10px", color: "#9ca3af", fontWeight: 500, marginBottom: "8px" }}>Ads Count by Platform</div>
                <div style={{ fontSize: "12px", color: "#111827" }}>
                  {Object.entries(adsCount.total_per_platform || {}).map(([platform, count]) => (
                    <div key={platform} style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ textTransform: "capitalize" }}>{platform}:</span>
                      <span style={{ fontWeight: 600 }}>{count}</span>
                    </div>
                  ))}
                  {Object.keys(adsCount.total_per_platform || {}).length === 0 && (
                    <div style={{ color: "#9ca3af" }}>No ads found</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Chart - Custom SVG implementation to avoid Recharts rendering issues */}
        <div style={{ background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", padding: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexWrap: "wrap", gap: "8px" }}>
            <p style={{ fontSize: "13px", fontWeight: 600, color: "#374151", margin: 0 }}>
              Top {TYPE_TABS.find((t) => t.key === typeTab)?.label} by Search Volume
            </p>
          </div>

          <div style={{ overflowX: "auto" }}>
            <svg width="100%" height={Math.max(chartData.length * 24 + 40, 300)} style={{ minHeight: "300px" }}>
              {chartData.map((item, idx) => {
                const barHeight = 18;
                const rowHeight = 24;
                const y = 20 + idx * rowHeight;
                const barWidth = (item.count / maxCount) * (typeof window !== 'undefined' ? window.innerWidth - 400 : 800);
                const labelX = yAxisWidth - 10;

                return (
                  <g key={idx}>
                    {/* Label */}
                    <text
                      x={labelX}
                      y={y + 13}
                      textAnchor="end"
                      fontSize="11"
                      fill="#374151"
                      style={{ cursor: "help" }}
                      title={item.term}
                    >
                      {item.displayTerm}
                    </text>

                    {/* Bar */}
                    <rect
                      x={yAxisWidth + 5}
                      y={y + 2}
                      width={Math.max(barWidth, 0)}
                      height={barHeight}
                      fill={COLORS[idx % COLORS.length]}
                      rx="4"
                      style={{ cursor: "pointer" }}
                    >
                      <title>{item.term} - {item.count} searches</title>
                    </rect>

                  </g>
                );
              })}

              {/* X-axis */}
              <line x1={yAxisWidth} y1={20 + chartData.length * 24} x2="100%" y2={20 + chartData.length * 24} stroke="#e5e7eb" strokeWidth="1" />
            </svg>
          </div>

          {/* Tooltip for full text on hover */}
          <div style={{ marginTop: "12px", fontSize: "11px", color: "#6b7280", display: "flex", alignItems: "center", gap: "4px" }}>
            <span>ℹ Hover over labels to see full text</span>
          </div>
        </div>

        {/* Filter row - above table */}
        <div style={{ background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", padding: "12px 20px" }}>
          <ItemFilter typeTab={typeTab} onFilterApply={handleFilterApply} />
        </div>

        {/* Table */}
        <div ref={tableRef} style={{ background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", tableLayout: "fixed", fontSize: "13px", borderCollapse: "collapse" }}>
              <colgroup>
                <col style={{ width: "40px" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "28%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "6%" }} />
                <col style={{ width: "7%" }} />
              </colgroup>
              <thead>
                <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                  {[
                    "#", TYPE_TABS.find((t) => t.key === typeTab)?.label.toUpperCase(),
                    "SEARCHED DATE", "PLATFORMS", "STATUS", "HISTORY",
                    "CRAWLED", "FAILED", "ADS COUNT"
                  ].map((h) => (
                    <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: "11px", fontWeight: 600, color: "#9ca3af", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fullList.map((row, idx) => {
                  // Calculate stats from history
                  const completedCount = row.history?.filter(h => h.status === "completed").length || 0;
                  const failedCount = row.history?.filter(h => h.status === "failed").length || 0;
                  const scrapingCount = row.history?.filter(h => h.status === "scrapping").length || 0;
                  const totalAds = row.history?.reduce((sum, h) => sum + (h.adsCount || 0), 0) || 0;

                  // Build status summary
                  let statusLabel = "";
                  let statusBg = "#f3f4f6";
                  let statusText = "#6b7280";

                  if (row.hasScrappingStatus) {
                    const totalScraped = completedCount + failedCount + scrapingCount;
                    const parts = [];
                    if (completedCount > 0) parts.push(`${completedCount} Crawl${completedCount > 1 ? 's' : ''} Completed`);
                    if (failedCount > 0) parts.push(`${failedCount} Failed`);
                    if (scrapingCount > 0) parts.push(`${scrapingCount} Under Scraping`);

                    if (parts.length > 0) {
                      statusLabel = parts.join(", ");
                      // Color based on priority: Failed > Scrapping > Completed
                      if (failedCount > 0) {
                        statusBg = "#fee2e2";
                        statusText = "#991b1b";
                      } else if (scrapingCount > 0) {
                        statusBg = "#fef3c7";
                        statusText = "#92400e";
                      } else {
                        statusBg = "#dbeafe";
                        statusText = "#0c4a6e";
                      }
                    }
                  } else {
                    statusLabel = "⚠ Not Went for Scrapping";
                  }

                  const platformLabels = row.platforms?.map(p => p.charAt(0).toUpperCase() + p.slice(1)) || [];

                  return (
                    <tr
                      key={row.term}
                      style={{ borderBottom: "1px solid #f3f4f6", backgroundColor: "white" }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f9fafb")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "white")}
                    >
                      <td style={{ padding: "10px 12px", color: "#9ca3af" }}>{page * 10 + idx + 1}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 500, color: "#111827" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <div style={{ whiteSpace: expandedKeywords.has(row.term) ? "normal" : "nowrap", overflow: expandedKeywords.has(row.term) ? "visible" : "hidden", textOverflow: "ellipsis", maxWidth: expandedKeywords.has(row.term) ? "none" : "200px" }}>
                            {row.term}
                          </div>
                          {row.term.length > 50 && (
                            <button
                              onClick={() => {
                                const newSet = new Set(expandedKeywords);
                                if (newSet.has(row.term)) {
                                  newSet.delete(row.term);
                                } else {
                                  newSet.add(row.term);
                                }
                                setExpandedKeywords(newSet);
                              }}
                              style={{ fontSize: "11px", color: "#6366f1", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline", textAlign: "left", fontWeight: 500 }}
                            >
                              {expandedKeywords.has(row.term) ? "Show Less" : "Show More"}
                            </button>
                          )}
                        </div>
                      </td>

                      <td style={{ padding: "10px 12px", fontSize: "12px", color: "#6b7280" }}>
                        {row.searchedDate || "—"}
                      </td>
                      <td style={{ padding: "10px 12px", overflow: "visible" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                          {platformLabels.length > 0 ? (
                            <>
                              {(expandedPlatformRows.has(row.term) ? platformLabels : platformLabels.slice(0, 3)).map((platform) => (
                                <span key={platform} style={{ display: "inline-block", background: "#e0e7ff", color: "#4338ca", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", whiteSpace: "nowrap" }}>
                                  {platform}
                                </span>
                              ))}
                              {platformLabels.length > 3 && (
                                <button
                                  onClick={() => {
                                    const newSet = new Set(expandedPlatformRows);
                                    if (newSet.has(row.term)) {
                                      newSet.delete(row.term);
                                    } else {
                                      newSet.add(row.term);
                                    }
                                    setExpandedPlatformRows(newSet);
                                  }}
                                  style={{ display: "inline-block", background: "#f3f4f6", color: "#6b7280", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", whiteSpace: "nowrap", border: "none", cursor: "pointer", fontWeight: 600, transition: "all 0.2s" }}
                                  onMouseEnter={(e) => { e.currentTarget.style.background = "#e5e7eb"; e.currentTarget.style.color = "#374151"; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.background = "#f3f4f6"; e.currentTarget.style.color = "#6b7280"; }}
                                >
                                  {expandedPlatformRows.has(row.term) ? "Show Less" : `+${platformLabels.length - 3}`}
                                </button>
                              )}
                            </>
                          ) : <span style={{ color: "#9ca3af" }}>—</span>}
                        </div>
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <div style={{ display: "inline-block", padding: "4px 8px", borderRadius: "4px", background: statusBg, color: statusText, fontSize: "11px", fontWeight: 500, whiteSpace: "normal", maxWidth: "150px" }}>
                          {statusLabel}
                        </div>
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: "11px", color: "#6b7280" }}>
                        {row.history && row.history.length > 0 ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                            {row.history.map((h, hIdx) => {
                              const startTime = h.startTime ? new Date(h.startTime).toLocaleString() : "—";
                              const endTime = h.endTime ? new Date(h.endTime).toLocaleString() : "—";
                              return (
                                <div key={hIdx} style={{ padding: "6px", background: "#f9fafb", borderRadius: "4px", border: "1px solid #e5e7eb" }}>
                                  <div style={{ fontWeight: 600, color: "#374151", marginBottom: "3px" }}>
                                    {h.network ? h.network.charAt(0).toUpperCase() + h.network.slice(1) : "Unknown"}
                                  </div>
                                  <div style={{ fontSize: "10px", color: "#6b7280", marginBottom: "2px" }}>
                                    <strong>Date:</strong> {h.date || "—"}
                                  </div>
                                  <div style={{ fontSize: "10px", color: "#6b7280", marginBottom: "2px" }}>
                                    <strong>Start:</strong> {startTime}
                                  </div>
                                  <div style={{ fontSize: "10px", color: "#6b7280", marginBottom: "2px" }}>
                                    <strong>End:</strong> {endTime}
                                  </div>
                                  <div style={{ fontSize: "10px", color: "#374151", fontWeight: 500 }}>
                                    <strong>Ads:</strong> {h.adsCount ?? 0}
                                  </div>
                                </div>
                              );
                            })}
                              </div>
                            ) : (
                              <span style={{ color: "#9ca3af" }}>—</span>
                            )}
                          </td>
                      <td style={{ padding: "10px 12px", textAlign: "center", color: "#111827", fontWeight: 500 }}>
                        {row.count}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "center", color: "#ef4444", fontWeight: 500 }}>
                        {failedCount}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "center", color: "#111827", fontWeight: 600 }}>
                        {totalAds.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
                {fullList.length === 0 && (
                  <tr>
                    <td colSpan="9" style={{ padding: "40px 12px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>
                      No data found for this category.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination footer */}
        <div style={{ background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderTop: "1px solid #e5e7eb", background: "#f9fafb" }}>
            <p style={{ fontSize: "12px", color: "#6b7280", margin: 0 }}>
              Showing {fullList.length > 0 ? page * 10 + 1 : 0}–{Math.min((page + 1) * 10, meta?.total || 0)} of {meta?.total || 0}
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "12px", color: "#6b7280" }}>Page {page + 1} / {meta?.total_pages || 1}</span>
              <button
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
                style={{ fontSize: "12px", color: page === 0 ? "#d1d5db" : "#6b7280", padding: "4px 8px", cursor: page === 0 ? "not-allowed" : "pointer", background: "none", border: "none", fontWeight: 500 }}
              >
                ‹ Prev
              </button>
              <button
                disabled={page >= (meta?.total_pages || 1) - 1}
                onClick={() => setPage(p => p + 1)}
                style={{ fontSize: "12px", color: page >= (meta?.total_pages || 1) - 1 ? "#d1d5db" : "#6b7280", padding: "4px 8px", cursor: page >= (meta?.total_pages || 1) - 1 ? "not-allowed" : "pointer", background: "none", border: "none", fontWeight: 500 }}
              >
                Next ›
              </button>
            </div>
          </div>
        </div>
      </>
    );
  };

  const handleFilterApply = (value) => {
    setSelectedFilterValue(value);
    setPage(0); // Reset to first page when filter changes
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Type tabs row */}
      <div style={{ background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", padding: "12px 20px", display: "flex", alignItems: "center", gap: "12px" }}>
        {/* Type tabs */}
        <div style={{ display: "flex", alignItems: "center", gap: "4px", background: "#f3f4f6", borderRadius: "8px", padding: "4px" }}>
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setTypeTab(tab.key); setPage(0); setSelectedFilterValue(null); }}
              style={{ padding: "6px 16px", borderRadius: "6px", fontSize: "12px", fontWeight: 500, border: typeTab === tab.key ? "1px solid #e5e7eb" : "1px solid transparent", cursor: "pointer", background: typeTab === tab.key ? "white" : "transparent", color: typeTab === tab.key ? "#111827" : "#6b7280", boxShadow: "none" }}
            >
              {tab.label}
              {scrapingStats?.totalItems > 0 && typeTab === tab.key && (
                <span style={{ marginLeft: "6px", fontSize: "11px", fontWeight: 600, color: typeTab === tab.key ? "#4338ca" : "#9ca3af" }}>
                  {scrapingStats.totalItems}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {renderContent()}
    </div>
  );
};

export default KeywordTrends;
