import React from "react";

const NumberRange = ({ label, minVal, maxVal, onMinChange, onMaxChange }) => (
  <div className="flex items-center gap-1.5">
    <span className="text-xs font-semibold text-theme-text-secondary">{label}</span>
    <input
      type="number"
      placeholder="min"
      value={minVal ?? ""}
      onChange={(e) => onMinChange(e.target.value)}
      className="w-16 rounded-md border border-theme-border bg-transparent px-2 py-1 text-xs text-theme-text focus:outline-none focus:border-[#6b99ff]/60"
    />
    <span className="text-theme-text-muted text-xs">–</span>
    <input
      type="number"
      placeholder="max"
      value={maxVal ?? ""}
      onChange={(e) => onMaxChange(e.target.value)}
      className="w-16 rounded-md border border-theme-border bg-transparent px-2 py-1 text-xs text-theme-text focus:outline-none focus:border-[#6b99ff]/60"
    />
  </div>
);

/** Filter chips for the Keywords Explorer table — Ad Volume/Competition/Growth
 *  are PowerAdSpy ad-corpus proxies (see KeywordsExplorerPage's disclosure copy),
 *  not licensed Google search-volume/KD data. */
const KeywordFilterBar = ({ filters, onChange }) => {
  const set = (key, value) => onChange({ ...filters, [key]: value === "" ? undefined : value });
  const hasFilters = Object.values(filters).some((v) => v !== undefined && v !== "");

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-theme-border bg-theme-card px-4 py-3 mb-4">
      <NumberRange
        label="Ad Volume"
        minVal={filters.volume_min}
        maxVal={filters.volume_max}
        onMinChange={(v) => set("volume_min", v)}
        onMaxChange={(v) => set("volume_max", v)}
      />
      <NumberRange
        label="Competition"
        minVal={filters.competition_min}
        maxVal={filters.competition_max}
        onMinChange={(v) => set("competition_min", v)}
        onMaxChange={(v) => set("competition_max", v)}
      />
      <NumberRange
        label="Growth %"
        minVal={filters.growth_min}
        maxVal={filters.growth_max}
        onMinChange={(v) => set("growth_min", v)}
        onMaxChange={(v) => set("growth_max", v)}
      />
      <input
        type="text"
        placeholder="Category"
        value={filters.category || ""}
        onChange={(e) => set("category", e.target.value)}
        className="w-32 rounded-md border border-theme-border bg-transparent px-2 py-1 text-xs text-theme-text focus:outline-none focus:border-[#6b99ff]/60"
      />
      <input
        type="text"
        placeholder="Include term"
        value={filters.include || ""}
        onChange={(e) => set("include", e.target.value)}
        className="w-32 rounded-md border border-theme-border bg-transparent px-2 py-1 text-xs text-theme-text focus:outline-none focus:border-[#6b99ff]/60"
      />
      <input
        type="text"
        placeholder="Exclude term"
        value={filters.exclude || ""}
        onChange={(e) => set("exclude", e.target.value)}
        className="w-32 rounded-md border border-theme-border bg-transparent px-2 py-1 text-xs text-theme-text focus:outline-none focus:border-[#6b99ff]/60"
      />
      {hasFilters ? (
        <button type="button" onClick={() => onChange({})} className="text-xs text-theme-text-muted hover:text-theme-text underline">
          Clear filters
        </button>
      ) : null}
    </div>
  );
};

export default KeywordFilterBar;
