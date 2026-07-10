import React, { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { getGoogleKeywordInsight } from "../../services/api";
import {
  ModalShell,
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
 * Opens from a clicked keyword/target_keyword. Clicking a top advertiser
 * jumps straight to the Ads Library searching that advertiser; clicking a
 * keyword on a creative reopens this modal for that keyword.
 */
const KeywordExplorerModal = ({ keyword, onClose, onAdvertiserClick, onOpenKeyword }) => {
  const [state, setState] = useState({ loading: true, data: null, error: null });

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
    <ModalShell
      icon={<Search size={16} className="text-[#6b99ff]" />}
      title="Keyword Explorer"
      subtitle={keyword ? `“${keyword}”` : undefined}
      onClose={onClose}
    >
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
    </ModalShell>
  );
};

export default KeywordExplorerModal;
