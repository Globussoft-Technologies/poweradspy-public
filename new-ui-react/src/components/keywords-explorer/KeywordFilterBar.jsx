import React, { useEffect, useState } from "react";
import { SlidersHorizontal, BarChart3, Swords, TrendingUp, Tag, Plus, Minus, X, Search } from "lucide-react";

const inputCls =
  "w-16 rounded-lg border border-theme-border bg-theme-text/[0.04] px-2.5 py-1.5 text-xs text-theme-text transition-all focus:outline-none focus:border-[#6b99ff] focus:bg-transparent focus:ring-2 focus:ring-[#6b99ff]/15 placeholder:text-theme-text-muted";

// Tooltips use the native `title` attribute rather than a styled popover: the
// filter bar is inside a scroll container + sticky region, which clipped the
// old absolutely-positioned tooltip. Native title is never clipped/covered.
const NumberRange = ({ icon, label, tip, minVal, maxVal, onMinChange, onMaxChange, onApply }) => (
  <div className="flex items-center gap-2">
    <span title={tip || undefined} className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-theme-text-secondary cursor-help">
      {icon}{label}
    </span>
    <input type="number" placeholder="min" value={minVal ?? ""} onChange={(e) => onMinChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onApply()} className={inputCls} />
    <span className="text-theme-text-muted text-xs">–</span>
    <input type="number" placeholder="max" value={maxVal ?? ""} onChange={(e) => onMaxChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onApply()} className={inputCls} />
  </div>
);

const TextInput = ({ icon, placeholder, value, onChange, tip, onApply }) => (
  <div title={tip || undefined} className="flex items-center gap-1.5 rounded-lg border border-theme-border bg-theme-text/[0.04] px-2.5 transition-all focus-within:border-[#6b99ff] focus-within:bg-transparent focus-within:ring-2 focus-within:ring-[#6b99ff]/15">
    <span className="text-theme-text-muted">{icon}</span>
    <input
      type="text"
      placeholder={placeholder}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && onApply()}
      className="w-28 bg-transparent py-1.5 text-xs text-theme-text focus:outline-none placeholder:text-theme-text-muted"
    />
  </div>
);

const Divider = () => <span className="hidden h-6 w-px self-center bg-theme-border lg:block" />;

/** Filter chips for the Keywords Explorer table — Ad Volume/Competition/Growth
 *  are PowerAdSpy ad-corpus proxies (see KeywordsExplorerPage's disclosure copy),
 *  not licensed Google search-volume/KD data.
 *
 *  Every input here edits a LOCAL draft, not the live `filters` prop — typing
 *  used to call onChange() (and therefore re-fetch the table) on every single
 *  keystroke, so e.g. typing "laptop" fired 6 separate backend requests, each
 *  racing the others with no cancellation: a slow response for "l" could land
 *  AFTER the "laptop" response and silently overwrite it, making the filter
 *  look like it "wasn't working" even though the last-typed value was
 *  correct. The draft only becomes the real, fetch-triggering `filters` when
 *  Apply is clicked (or Enter is pressed in any field) — exactly one request
 *  per deliberate search, matching how the main search bar already works. */
const KeywordFilterBar = ({ filters, onChange }) => {
  const [draft, setDraft] = useState(filters);
  // Keep the draft in sync when filters change from OUTSIDE this component
  // (e.g. KeywordsExplorerPage's resetToDatabase() clearing everything).
  useEffect(() => { setDraft(filters); }, [filters]);

  const set = (key, value) => setDraft((d) => ({ ...d, [key]: value === "" ? undefined : value }));
  const apply = () => onChange(draft);
  const clear = () => { setDraft({}); onChange({}); };

  const hasDraft = Object.values(draft).some((v) => v !== undefined && v !== "");
  const isDirty = JSON.stringify(draft) !== JSON.stringify(filters);

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
        minVal={draft.volume_min}
        maxVal={draft.volume_max}
        onMinChange={(v) => set("volume_min", v)}
        onMaxChange={(v) => set("volume_max", v)}
        onApply={apply}
      />
      <Divider />
      <NumberRange
        icon={<Swords size={12} className="text-[#6b99ff]" />}
        label="Competition"
        tip="How crowded the keyword is (0–100) — ranked by how many advertisers use it. Refreshed hourly; a keyword can briefly show no score until the next refresh picks it up."
        minVal={draft.competition_min}
        maxVal={draft.competition_max}
        onMinChange={(v) => set("competition_min", v)}
        onMaxChange={(v) => set("competition_max", v)}
        onApply={apply}
      />
      <Divider />
      <NumberRange
        icon={<TrendingUp size={12} className="text-[#6b99ff]" />}
        label="Growth %"
        tip="Change in ad activity: last 30 days vs the previous 30 days."
        minVal={draft.growth_min}
        maxVal={draft.growth_max}
        onMinChange={(v) => set("growth_min", v)}
        onMaxChange={(v) => set("growth_max", v)}
        onApply={apply}
      />
      <Divider />
      <TextInput icon={<Tag size={12} className="text-[#6b99ff]" />} placeholder="Category" tip="Filter to keywords in a specific ad category (exact match)." value={draft.category} onChange={(v) => set("category", v)} onApply={apply} />
      <TextInput icon={<Plus size={12} className="text-[#6b99ff]" />} placeholder="Include term" tip="Only show keywords whose text contains this term." value={draft.include} onChange={(v) => set("include", v)} onApply={apply} />
      <TextInput icon={<Minus size={12} className="text-[#6b99ff]" />} placeholder="Exclude term" tip="Hide keywords whose text contains this term." value={draft.exclude} onChange={(v) => set("exclude", v)} onApply={apply} />

      <button
        type="button"
        onClick={apply}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors ${
          isDirty ? "bg-[#6b99ff] text-white hover:bg-[#5a88ee]" : "border border-theme-border text-theme-text-secondary hover:border-[#6b99ff]/50 hover:text-[#6b99ff]"
        }`}
      >
        <Search size={12} /> Apply
      </button>
      {hasDraft ? (
        <button
          type="button"
          onClick={clear}
          className="inline-flex items-center gap-1 rounded-lg border border-theme-border px-3 py-1.5 text-xs font-semibold text-theme-text-secondary transition-colors hover:border-[#6b99ff]/50 hover:text-[#6b99ff]"
        >
          <X size={12} /> Clear
        </button>
      ) : null}
    </div>
  );
};

export default KeywordFilterBar;
