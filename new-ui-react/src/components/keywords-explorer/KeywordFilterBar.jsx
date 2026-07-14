import React from "react";
import { SlidersHorizontal, BarChart3, Swords, TrendingUp, Tag, Plus, Minus, X } from "lucide-react";

const inputCls =
  "w-16 rounded-lg border border-theme-border bg-theme-text/[0.04] px-2.5 py-1.5 text-xs text-theme-text transition-all focus:outline-none focus:border-[#6b99ff] focus:bg-transparent focus:ring-2 focus:ring-[#6b99ff]/15 placeholder:text-theme-text-muted";

// Tooltips use the native `title` attribute rather than a styled popover: the
// filter bar is inside a scroll container + sticky region, which clipped the
// old absolutely-positioned tooltip. Native title is never clipped/covered.
const NumberRange = ({ icon, label, tip, minVal, maxVal, onMinChange, onMaxChange }) => (
  <div className="flex items-center gap-2">
    <span title={tip || undefined} className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-theme-text-secondary cursor-help">
      {icon}{label}
    </span>
    <input type="number" placeholder="min" value={minVal ?? ""} onChange={(e) => onMinChange(e.target.value)} className={inputCls} />
    <span className="text-theme-text-muted text-xs">–</span>
    <input type="number" placeholder="max" value={maxVal ?? ""} onChange={(e) => onMaxChange(e.target.value)} className={inputCls} />
  </div>
);

const TextInput = ({ icon, placeholder, value, onChange, tip }) => (
  <div title={tip || undefined} className="flex items-center gap-1.5 rounded-lg border border-theme-border bg-theme-text/[0.04] px-2.5 transition-all focus-within:border-[#6b99ff] focus-within:bg-transparent focus-within:ring-2 focus-within:ring-[#6b99ff]/15">
    <span className="text-theme-text-muted">{icon}</span>
    <input
      type="text"
      placeholder={placeholder}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      className="w-28 bg-transparent py-1.5 text-xs text-theme-text focus:outline-none placeholder:text-theme-text-muted"
    />
  </div>
);

const Divider = () => <span className="hidden h-6 w-px self-center bg-theme-border lg:block" />;

/** Filter chips for the Keywords Explorer table — Ad Volume/Competition/Growth
 *  are PowerAdSpy ad-corpus proxies (see KeywordsExplorerPage's disclosure copy),
 *  not licensed Google search-volume/KD data. */
const KeywordFilterBar = ({ filters, onChange }) => {
  const set = (key, value) => onChange({ ...filters, [key]: value === "" ? undefined : value });
  const hasFilters = Object.values(filters).some((v) => v !== undefined && v !== "");

  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3 rounded-2xl border border-theme-border bg-theme-card px-4 py-3 shadow-sm">
      <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-theme-text-muted">
        <SlidersHorizontal size={13} className="text-[#6b99ff]" /> Filters
      </span>
      <Divider />
      <NumberRange
        icon={<BarChart3 size={12} className="text-[#6b99ff]" />}
        label="Volume"
        tip="Number of unique ads using this keyword across the crawled corpus."
        minVal={filters.volume_min}
        maxVal={filters.volume_max}
        onMinChange={(v) => set("volume_min", v)}
        onMaxChange={(v) => set("volume_max", v)}
      />
      <Divider />
      <NumberRange
        icon={<Swords size={12} className="text-[#6b99ff]" />}
        label="Competition"
        tip="How crowded the keyword is (0–100) — ranked by how many advertisers use it."
        minVal={filters.competition_min}
        maxVal={filters.competition_max}
        onMinChange={(v) => set("competition_min", v)}
        onMaxChange={(v) => set("competition_max", v)}
      />
      <Divider />
      <NumberRange
        icon={<TrendingUp size={12} className="text-[#6b99ff]" />}
        label="Growth %"
        tip="Change in ad activity: last 30 days vs the previous 30 days."
        minVal={filters.growth_min}
        maxVal={filters.growth_max}
        onMinChange={(v) => set("growth_min", v)}
        onMaxChange={(v) => set("growth_max", v)}
      />
      <Divider />
      <TextInput icon={<Tag size={12} className="text-[#6b99ff]" />} placeholder="Category" tip="Filter to keywords in a specific ad category (exact match)." value={filters.category} onChange={(v) => set("category", v)} />
      <TextInput icon={<Plus size={12} className="text-[#6b99ff]" />} placeholder="Include term" tip="Only show keywords whose text contains this term." value={filters.include} onChange={(v) => set("include", v)} />
      <TextInput icon={<Minus size={12} className="text-[#6b99ff]" />} placeholder="Exclude term" tip="Hide keywords whose text contains this term." value={filters.exclude} onChange={(v) => set("exclude", v)} />
      {hasFilters ? (
        <button
          type="button"
          onClick={() => onChange({})}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-theme-border px-3 py-1.5 text-xs font-semibold text-theme-text-secondary transition-colors hover:border-[#6b99ff]/50 hover:text-[#6b99ff]"
        >
          <X size={12} /> Clear
        </button>
      ) : null}
    </div>
  );
};

export default KeywordFilterBar;
