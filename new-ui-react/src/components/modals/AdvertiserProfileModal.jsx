import React, { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { getGoogleAdvertiserProfile } from "../../services/api";
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

const fmtDay = (s) => (s ? String(s).slice(0, 10) : "—");

/**
 * Advertiser Profile — full competitive profile for one advertiser.
 * Opens from a clicked advertiser. Cross-links to the Keyword Explorer
 * (click a keyword in the portfolio or on a creative).
 */
const AdvertiserProfileModal = ({ postOwnerId, advertiserName, onClose, onOpenKeyword }) => {
  const [state, setState] = useState({ loading: true, data: null, error: null });

  useEffect(() => {
    if (!postOwnerId && !advertiserName) return;
    let alive = true;
    setState({ loading: true, data: null, error: null });
    getGoogleAdvertiserProfile({
      post_owner_id: postOwnerId || undefined,
      post_owner_name: postOwnerId ? undefined : advertiserName,
      top_n: 20,
      creatives: 12,
      interval: "month",
    })
      .then((res) => {
        if (!alive) return;
        if (res?.code === 200 && res.data) setState({ loading: false, data: res.data, error: null });
        else setState({ loading: false, data: null, error: res?.message || "No data found." });
      })
      .catch((e) => alive && setState({ loading: false, data: null, error: e.message }));
    return () => {
      alive = false;
    };
  }, [postOwnerId, advertiserName]);

  const d = state.data;

  return (
    <ModalShell
      icon={<Building2 size={16} className="text-[#6b99ff]" />}
      title="Advertiser Profile"
      subtitle={d?.advertiser || advertiserName || undefined}
      onClose={onClose}
    >
      {state.loading ? (
        <Loading label="Building advertiser profile…" />
      ) : !d ? (
        <EmptyState label={state.error || "No data found."} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile label="Total ads" value={fmtInt(d.summary?.ads)} />
            <StatTile label="Keywords" value={fmtInt(d.summary?.keywords)} />
            <StatTile label="Domains" value={fmtInt(d.summary?.domains)} />
            <StatTile label="Active" value={fmtDay(d.summary?.first_seen)} hint={`→ ${fmtDay(d.summary?.last_seen)}`} />
          </div>

          <div>
            <SectionTitle info="Number of distinct ads seen each month for this advertiser. Trends show how aggressively they're scaling creatives over time.">
              Ad activity over time
            </SectionTitle>
            <TrendChart points={d.trend} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <SectionTitle info="Keywords this advertiser bids on, ranked by number of distinct ads — where they concentrate their search spend. Click one to explore that keyword's full competitive board.">
                Keyword portfolio
              </SectionTitle>
              <RankedBars
                items={d.keyword_portfolio}
                onItemClick={(it) => onOpenKeyword?.(it.key)}
                emptyLabel="No keywords."
              />
            </div>
            <div>
              <SectionTitle info="Destination domains this advertiser's ads point to, ranked by ad count. Note: googleadservices.com appears when the click-tracking redirect hasn't been resolved to the real landing domain.">
                Top landing domains
              </SectionTitle>
              <RankedBars items={d.top_domains} emptyLabel="No domains." />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <SectionTitle info="Share of this advertiser's ads shown in the Top-of-page vs Bottom-of-page sponsored slots. Top slots sit above the organic results, cost more, and win the majority of clicks — a high Top % signals aggressive bidding.">
                SERP slot mix
              </SectionTitle>
              <PositionMix items={d.position_mix} />
            </div>
            <div>
              <SectionTitle info="Countries where this advertiser's ads were seen, ranked by ad count. Reflects where we observed the ads, not a guaranteed targeting list.">
                Country spread
              </SectionTitle>
              <RankedBars items={d.country_spread} emptyLabel="No country data." max={8} />
            </div>
          </div>

          <div>
            <SectionTitle info="A sample of the most recently seen live ads from this advertiser, rendered as they appear on the search results page.">
              Live creatives
            </SectionTitle>
            <SerpCreatives creatives={d.creatives} onKeywordClick={onOpenKeyword} />
          </div>
        </div>
      )}
    </ModalShell>
  );
};

export default AdvertiserProfileModal;
