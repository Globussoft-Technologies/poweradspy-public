import React, { useState, useEffect, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import Cookies from "js-cookie";

const NODE_API = (import.meta.env.VITE_NODE_USER_ACTIVITY_API ?? "").trim().replace(/\/$/, "");

const COLORS = ["#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444","#14b8a6"];

// Custom YAxis tick renderer with hover tooltip
const CustomYAxisTick = ({ x, y, payload, chartData }) => {
  const item = chartData?.find((d) => d.id === payload.value);
  const displayText = item?.displayTerm || payload.value;
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
        {displayText}
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
  const searchInputRef = useRef(null);

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

            // All time stats
            totalItems: data.total || 0,
            completedToday: data.completed_scraping || 0,
            notQueued: data.not_went_scrapping || 0,
            scrapingQueued: data.under_scraping || 0,
            totalScraped: data.completed_scraping || 0,
            totalFailed: 0,
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

  // Fetch table data with pagination (only when page or typeTab changes)
  useEffect(() => {
    const fetchTableData = async () => {
      if (!NODE_API) { setError("API URL not configured"); return; }
      setError(null);
      try {
        const token = Cookies.get("token");
        const typeParam = typeTab === "keywords" ? "keyword" : typeTab === "advertisers" ? "advertiser" : "domain";
        const params = new URLSearchParams({ type: typeParam, sort_by: "createdAt", page: String(page), size: "10" });
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
  }, [typeTab, page]);

  // Expose live data for native PDF export
  const exportDataRef = useRef(null);
  exportDataRef.current = { data, typeTab, sortBy, meta };
  useEffect(() => {
    if (onDataReady) onDataReady(() => exportDataRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDataReady]);

  // Full list from API (already paginated)
  const fullList = data[typeTab] ?? [];

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

  const SummaryMetric = ({ label, value, sublabel }) => (
    <div style={{ flex: 1, minWidth: "120px", padding: "10px", background: "#f9fafb", borderRadius: "8px", textAlign: "center", border: "1px solid #e5e7eb" }}>
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
    if (!loading && fullList.length === 0) return (
      <div style={{ padding: "60px 0", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>
        No data found for this category.
      </div>
    );

    return (
      <>
        {/* Summary Metrics Section (for all tabs) */}
        {scrapingStats && (
          <div style={{ background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", padding: "12px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
              {/* All Time Metrics - First */}
              <SummaryMetric label={`Total ${typeTab.charAt(0).toUpperCase() + typeTab.slice(1)}`} value={scrapingStats.totalItems} />
              <SummaryMetric label="Total Scraped Completed" value={scrapingStats.completedToday} />
              <SummaryMetric label="Total keywords Not Went for Scraping" value={scrapingStats.notQueued} />
              <SummaryMetric label={`Total under Scraping ${typeTab.charAt(0).toUpperCase() + typeTab.slice(1)}`} value={scrapingStats.scrapingQueued} />

              {/* Today's Metrics */}
              <SummaryMetric label="Today Scraped Completed" value={scrapingStats.todayCompletedItems} />
              <SummaryMetric label="Today Not Went for Scraping" value={scrapingStats.todayNotQueued} />
              <SummaryMetric label={`Today under Scraping ${typeTab.charAt(0).toUpperCase() + typeTab.slice(1)}`} value={scrapingStats.todayScrapingQueued} />
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

        {/* Chart */}
        <div style={{ background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", padding: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px", flexWrap: "wrap", gap: "8px" }}>
            <p style={{ fontSize: "13px", fontWeight: 600, color: "#374151", margin: 0 }}>
              Top {TYPE_TABS.find((t) => t.key === typeTab)?.label} by Search Volume
            </p>
          </div>
          <ResponsiveContainer width="100%" height={chartData.length * 20 + 60}>
            <BarChart data={chartData} layout="vertical" barSize={18} margin={{ top: 0, right: 32, bottom: 0, left: 10 }}>
              <XAxis type="number" domain={[0, 'dataMax']} tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <YAxis
                type="category" dataKey="displayTerm" width={yAxisWidth}
                tick={(props) => <CustomYAxisTick {...props} chartData={chartData} />}
                axisLine={false} tickLine={false}
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb", maxWidth: "350px", wordWrap: "break-word", whiteSpace: "normal", backgroundColor: "#ffffff", padding: "12px" }}
                content={({ active, payload }) => {
                  if (active && payload && payload.length > 0) {
                    const data = payload[0].payload;
                    return (
                      <div style={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: "6px", padding: "8px 12px", maxWidth: "350px" }}>
                        <p style={{ margin: "0 0 6px 0", fontWeight: 600, color: "#111827", wordBreak: "break-word", whiteSpace: "normal" }}>{data.term}</p>
                        <p style={{ margin: "0", color: "#6b7280" }}>Searches: {data.count}</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Tooltip for full text on hover */}
          <div style={{ marginTop: "8px", fontSize: "11px", color: "#6b7280", display: "flex", alignItems: "center", gap: "4px" }}>
            <span>ℹ Hover over truncated labels to see full text</span>
          </div>
        </div>


        {/* Table */}
        <div style={{ background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", tableLayout: "fixed", fontSize: "13px", borderCollapse: "collapse" }}>
              <colgroup>
                <col style={{ width: "40px" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "30%" }} />
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
                  const totalAds = row.history?.reduce((sum, h) => sum + (h.adsCount || 0), 0) || 0;
                  const lastHistory = row.history && row.history.length > 0 ? row.history[row.history.length - 1] : null;

                  const statusColorMap = {
                    completed: { bg: "#dbeafe", text: "#0c4a6e", label: "✓ Completed" },
                    failed: { bg: "#fee2e2", text: "#991b1b", label: "✗ Failed" },
                    scrapping: { bg: "#fef3c7", text: "#92400e", label: "⏱ Scrapping" },
                    "no_ads_found": { bg: "#fef3c7", text: "#92400e", label: "⚠ No Ads" },
                  };
                  const lastStatus = row.hasScrappingStatus ? (lastHistory?.status || "pending") : null;
                  const statusInfo = lastStatus ? (statusColorMap[lastStatus] || { bg: "#f3f4f6", text: "#6b7280", label: "✗ Pending" }) : { bg: "#f3f4f6", text: "#6b7280", label: "—" };

                  const platformLabels = row.platforms?.map(p => p.charAt(0).toUpperCase() + p.slice(1)) || [];

                  return (
                    <tr
                      key={row.term}
                      style={{ borderBottom: "1px solid #f3f4f6", backgroundColor: "white" }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f9fafb")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "white")}
                    >
                      <td style={{ padding: "10px 12px", color: "#9ca3af" }}>{page * 10 + idx + 1}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 500, color: "#111827", wordBreak: "break-word", whiteSpace: "normal" }}>
                        {row.term}
                      </td>

                      <td style={{ padding: "10px 12px", fontSize: "12px", color: "#6b7280" }}>
                        {row.searchedDate || "—"}
                      </td>
                      <td style={{ padding: "10px 12px", overflow: "visible" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                          {platformLabels.length > 0 ? (
                            platformLabels.slice(0, 3).map((platform) => (
                              <span key={platform} style={{ display: "inline-block", background: "#e0e7ff", color: "#4338ca", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", whiteSpace: "nowrap" }}>
                                {platform}
                              </span>
                            ))
                          ) : <span style={{ color: "#9ca3af" }}>—</span>}
                          {platformLabels.length > 3 && (
                            <span style={{ display: "inline-block", background: "#f3f4f6", color: "#6b7280", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", whiteSpace: "nowrap" }}>
                              +{platformLabels.length - 3}
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <div style={{ display: "inline-block", padding: "4px 8px", borderRadius: "4px", background: statusInfo.bg, color: statusInfo.text, fontSize: "11px", fontWeight: 500 }}>
                          {statusInfo.label}
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Controls row */}
      <div style={{ background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        {/* Type tabs */}
        <div style={{ display: "flex", alignItems: "center", gap: "4px", background: "#f3f4f6", borderRadius: "8px", padding: "4px" }}>
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setTypeTab(tab.key); setPage(0); }}
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
