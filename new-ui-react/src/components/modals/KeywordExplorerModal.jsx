import React, { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { getGoogleKeywordInsight } from "../../services/api";
import {
  Loading,
  EmptyState,
  SectionTitle,
  StatTile,
  TrendChart,
  RankedBars,
  PositionMix,
  SerpCreatives,
  fmtInt,
} from "./google/GoogleIntelShared";

/**
 * Keyword Explorer — the competitive board for a single bidding keyword.
 * Opens as a right-side DRAWER from a clicked keyword/target_keyword. Clicking a
 * top advertiser jumps straight to the Ads Library searching that advertiser;
 * clicking a keyword on a creative reopens this drawer for that keyword.
 *
 * Data is fetched live from /keywords/insight (ES) — not the keyword_stats rollup.
 */
const KeywordExplorerModal = ({ keyword, onClose, onAdvertiserClick, onOpenKeyword }) => {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [shown, setShown] = useState(false);

  // Slide-in on mount.
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 10);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!keyword) return;
    let alive = true;
    setState({ loading: true, data: null, error: null });
    getGoogleKeywordInsight({ keyword, top_n: 15, creatives: 12, interval: "month" })
      .then((res) => {
        if (!alive) return;
        if (res?.code === 200 && res.data) setState({ loading: false, data: res.data, error: null });
        else setState({ loading: false, data: null, error: res?.message || "No data found." });
      })
      .catch((e) => alive && setState({ loading: false, data: null, error: e.message }));
    return () => {
      alive = false;
    };
  }, [keyword]);

  const d = state.data;

  return (
    <div className="fixed inset-0 z-[300]">
      {/* Overlay */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`}
      />

      {/* Drawer panel */}
      <div
        className={`absolute top-0 right-0 bottom-0 w-[640px] max-w-[94vw] bg-theme-card border-l border-theme-border shadow-2xl flex flex-col transform transition-transform duration-300 ease-out ${
          shown ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-theme-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-[#6b99ff]/10 text-[#6b99ff]">
              <Search size={16} />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-wider text-theme-text-muted">
                Keyword analytics
              </div>
              <h3 className="font-bold text-sm text-theme-text truncate">
                {keyword ? `“${keyword}”` : "Keyword Explorer"}
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-theme-text/[0.06] rounded-lg transition-colors text-theme-text-muted hover:text-theme-text shrink-0"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {state.loading ? (
            <Loading label="Analyzing keyword…" />
          ) : !d ? (
            <EmptyState label={state.error || "No data found."} />
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-3 gap-3">
                <StatTile label="Advertisers" value={fmtInt(d.summary?.advertisers)} />
                <StatTile label="Landing domains" value={fmtInt(d.summary?.domains)} />
                <StatTile label="Total ads" value={fmtInt(d.summary?.ads)} />
              </div>

              <div>
                <SectionTitle info="Number of distinct ads seen each month for this keyword. Rising activity means more advertisers/creatives competing; dips suggest paused campaigns.">
                  Ad activity over time
                </SectionTitle>
                <TrendChart points={d.trend} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <SectionTitle info="Advertisers running the most distinct ads on this keyword, ranked by ad count — your direct competition for this term. Click one to see all of their ads in the Ads Library.">
                    Top advertisers
                  </SectionTitle>
                  <RankedBars
                    items={d.top_advertisers}
                    onItemClick={(it) => onAdvertiserClick?.(it.display || it.key)}
                    emptyLabel="No advertisers."
                  />
                </div>
                <div>
                  <SectionTitle info="Destination domains these ads point to, ranked by ad count. Note: googleadservices.com appears when the click-tracking redirect hasn't been resolved to the real landing domain.">
                    Top landing domains
                  </SectionTitle>
                  <RankedBars items={d.top_domains} emptyLabel="No domains." />
                </div>
              </div>

              <div>
                <SectionTitle info="Share of ads shown in the Top-of-page vs Bottom-of-page sponsored slots. Top slots sit above the organic results, cost more, and win the majority of clicks — a high Top % signals aggressive bidding on this keyword.">
                  SERP slot mix
                </SectionTitle>
                <PositionMix items={d.position_mix} />
              </div>

              <div>
                <SectionTitle info="A sample of the most recently seen live ads for this keyword, rendered as they appear on the search results page.">
                  Live creatives
                </SectionTitle>
                <SerpCreatives creatives={d.creatives} onKeywordClick={onOpenKeyword} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default KeywordExplorerModal;
