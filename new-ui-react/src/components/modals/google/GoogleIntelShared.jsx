import React from "react";
import { X, Loader2, Info } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

// Shared building blocks for the Google competitive-intelligence modals
// (Keyword Explorer + Advertiser Profile). Kept dependency-light and on the
// existing theme-* utility classes so they render in light/dark without a hook.

const ACCENT = "#6b99ff";

export const fmtInt = (n) => {
  const num = Number(n);
  if (!Number.isFinite(num)) return "0";
  return num.toLocaleString("en-US");
};

const fmtCompact = (n) => {
  const num = Number(n) || 0;
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(num);
};

/** Full-screen modal shell with header + scrollable body.
 *  Defaults to z-[300] so it stacks ABOVE the analytics modal (z-[200], nav
 *  buttons z-[210]) it's typically launched from, but below toasts/tooltips (z-[400]+). */
export const ModalShell = ({ icon, title, subtitle, onClose, zClass = "z-[300]", children }) => (
  <div className={`fixed inset-0 ${zClass} flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm`}>
    <div className="bg-theme-card border border-theme-border w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
      <div className="px-5 py-4 border-b border-theme-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          {icon}
          <div className="min-w-0">
            <h3 className="font-bold text-sm text-theme-text truncate">{title}</h3>
            {subtitle ? <p className="text-xs text-theme-text-muted truncate">{subtitle}</p> : null}
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
      <div className="p-5 overflow-y-auto">{children}</div>
    </div>
  </div>
);

export const Loading = ({ label = "Loading…" }) => (
  <div className="py-16 flex flex-col items-center gap-3">
    <Loader2 className="animate-spin text-[#3759a3]" size={28} />
    <p className="text-xs text-theme-text-secondary">{label}</p>
  </div>
);

export const EmptyState = ({ label = "No data found." }) => (
  <div className="py-16 flex items-center justify-center">
    <span className="text-sm text-theme-text-muted">{label}</span>
  </div>
);

/** Section heading with an optional info (i) icon + hover tooltip. */
export const SectionTitle = ({ children, info }) => (
  <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-theme-text-muted mb-2.5">
    <span>{children}</span>
    {info ? (
      <span className="relative inline-flex items-center group/info">
        <Info size={13} className="text-theme-text-muted/70 hover:text-theme-text-secondary cursor-help" />
        <span
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-[20] mt-1.5 w-64 rounded-lg border border-theme-border bg-theme-card px-3 py-2 text-[11px] font-normal normal-case tracking-normal leading-relaxed text-theme-text-secondary opacity-0 shadow-xl transition-opacity duration-150 group-hover/info:opacity-100"
        >
          {info}
        </span>
      </span>
    ) : null}
  </h4>
);

/** Headline stat tile. */
export const StatTile = ({ label, value, hint }) => (
  <div className="rounded-xl border border-theme-border bg-theme-text/[0.02] px-4 py-3">
    <div className="text-[11px] uppercase tracking-wider text-theme-text-muted">{label}</div>
    <div className="text-xl font-extrabold text-theme-text mt-0.5">{value}</div>
    {hint ? <div className="text-[11px] text-theme-text-muted mt-0.5 truncate">{hint}</div> : null}
  </div>
);

/** Area chart of a time-series ({ date, ads }[]). */
export const TrendChart = ({ points = [], height = 180 }) => {
  if (!points.length) return <EmptyState label="No trend data." />;
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        {/* top/right/bottom margins give the peak + edge points room so they
            aren't clipped at the plot edges; YAxis domain adds 15% headroom. */}
        <AreaChart data={points} margin={{ top: 12, right: 12, left: -8, bottom: 4 }}>
          <defs>
            <linearGradient id="gIntelArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-theme-border" opacity={0.4} />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="currentColor" className="text-theme-text-muted" minTickGap={24} />
          <YAxis tick={{ fontSize: 10 }} stroke="currentColor" className="text-theme-text-muted" tickFormatter={fmtCompact} width={40} allowDecimals={false} domain={[0, (max) => Math.max(1, Math.ceil((max || 0) * 1.15))]} />
          {/* Explicit light bg + dark text so the tooltip (incl. the date/year
              label) is readable in BOTH themes — the app's theme toggle doesn't
              drive Recharts' default tooltip colors. */}
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid rgba(127,127,127,0.25)", background: "#ffffff", color: "#111827" }}
            labelStyle={{ color: "#111827", fontWeight: 600 }}
            itemStyle={{ color: "#111827" }}
            formatter={(v, k) => [fmtInt(v), k === "advertisers" ? "Advertisers" : "Ads"]}
          />
          <Area type="monotone" dataKey="ads" stroke={ACCENT} strokeWidth={2} fill="url(#gIntelArea)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

/** Ranked horizontal-bar list. items: [{ key, ads, display? }]. */
export const RankedBars = ({ items = [], onItemClick, emptyLabel = "No data.", max = 10 }) => {
  if (!items.length) return <EmptyState label={emptyLabel} />;
  const top = items.slice(0, max);
  const peak = Math.max(...top.map((i) => i.ads || 0), 1);
  return (
    <div className="space-y-1.5">
      {top.map((it, i) => {
        const label = it.display || it.key || "—";
        const pct = Math.max(2, Math.round(((it.ads || 0) / peak) * 100));
        const clickable = typeof onItemClick === "function";
        return (
          <button
            key={`${label}-${i}`}
            type="button"
            disabled={!clickable}
            onClick={clickable ? () => onItemClick(it) : undefined}
            className={`relative w-full text-left rounded-lg overflow-hidden border border-theme-border px-3 py-1.5 ${
              clickable ? "hover:border-[#6b99ff]/60 cursor-pointer" : "cursor-default"
            } transition-colors`}
          >
            <div className="absolute inset-y-0 left-0 bg-[#6b99ff]/10" style={{ width: `${pct}%` }} />
            <div className="relative flex items-center justify-between gap-3">
              <span className="text-sm text-theme-text truncate">{label}</span>
              <span className="text-xs font-semibold text-theme-text-muted shrink-0">{fmtInt(it.ads)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
};

/** TOP/BOTTOM SERP-slot split. items: [{ position, ads }]. */
export const PositionMix = ({ items = [] }) => {
  if (!items.length) return <EmptyState label="No position data." />;
  const total = items.reduce((s, i) => s + (i.ads || 0), 0) || 1;
  const colorFor = (p) => (String(p).toLowerCase() === "top" ? "#34c759" : "#ff9f0a");
  return (
    <div>
      <div className="flex w-full h-3 rounded-full overflow-hidden border border-theme-border">
        {items.map((it, i) => (
          <div key={i} style={{ width: `${((it.ads || 0) / total) * 100}%`, background: colorFor(it.position) }} title={`${it.position}: ${fmtInt(it.ads)}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-3 mt-2">
        {items.map((it, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 text-xs text-theme-text-secondary">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: colorFor(it.position) }} />
            <span className="uppercase">{it.position}</span>
            <span className="text-theme-text-muted">{fmtInt(it.ads)} ({Math.round(((it.ads || 0) / total) * 100)}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
};

const domainFromUrl = (url) => {
  if (!url) return "";
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return String(url).split("/")[0];
  }
};

const kwArray = (kw) => (Array.isArray(kw) ? kw : kw ? [kw] : []);

/** SERP-faithful creative cards. creatives = raw _source docs from the index. */
export const SerpCreatives = ({ creatives = [], onKeywordClick }) => {
  if (!creatives.length) return <EmptyState label="No creatives found." />;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {creatives.map((c, i) => {
        const title = c.ad_title || c.title || c.newsfeed_description || "(no title)";
        const desc = c.ad_text || c.text || c.newsfeed_description || "";
        const display = domainFromUrl(c.destination_url) || c.domain || c.post_owner_name || "";
        const slot = (c.ad_sub_position || "").toUpperCase();
        return (
          <div key={c.id || i} className="rounded-xl border border-theme-border bg-theme-text/[0.02] p-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-bold text-theme-text-secondary border border-theme-border rounded px-1.5 py-0.5">Sponsored</span>
              <span className="text-xs text-theme-text-muted truncate">{display}</span>
              {slot ? (
                <span className={`ml-auto text-[10px] font-bold rounded px-1.5 py-0.5 ${slot === "TOP" ? "text-[#34c759] bg-[#34c759]/10" : "text-[#ff9f0a] bg-[#ff9f0a]/10"}`}>{slot}</span>
              ) : null}
            </div>
            {/* App theme is class/data-attr driven, not OS `dark:` — use the
                accent blue which stays readable on both light and dark cards. */}
            <div className="text-[15px] leading-snug text-[#6b99ff] font-medium line-clamp-2">{title}</div>
            {desc ? <div className="text-xs text-theme-text-secondary mt-1 line-clamp-3">{desc}</div> : null}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {kwArray(c.target_keyword).slice(0, 4).map((kw, k) => (
                <button
                  key={k}
                  type="button"
                  onClick={onKeywordClick ? () => onKeywordClick(kw) : undefined}
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] border border-[#6b99ff]/30 text-[#6b99ff] ${onKeywordClick ? "hover:bg-[#6b99ff]/10 cursor-pointer" : "cursor-default"}`}
                >
                  {kw}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
