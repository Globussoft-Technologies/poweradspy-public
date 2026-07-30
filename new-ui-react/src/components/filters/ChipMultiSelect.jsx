import { useState, useMemo } from "react";
import { X, Search } from "lucide-react";
import { useTheme } from "../../hooks/useTheme";

/**
 * ChipMultiSelect — Renders options as clickable chip/pill buttons with search.
 * SDUI can opt into a visible label and a smaller option preview for dense groups.
 */
const ChipMultiSelect = ({
  options = [],
  selected = [],
  onChange,
  label,
  showSearch = true,
  showLabel = false,
  previewLimit = 12,
  accented = false,
}) => {
  const { theme = "dark" } = useTheme() || {};
  const isLightTheme = theme === "light";
  const [showAll, setShowAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const selectedCount = Array.isArray(selected) ? new Set(selected).size : 0;
  // Keep the AI popup accents readable in both themes.
  const accentPalette = isLightTheme
    ? {
        section: "mb-2.5 border-[#3762c1]/15 bg-[#3762c1]/5",
        label: "text-[#335296]",
        badge: "border-[#3759a3]/25 bg-[#3762c1]/8 text-[#335296]",
        input: "border-[#3762c1]/20 focus:border-[#3762c1]/55 focus:bg-[#3762c1]/5",
        activeChip: "bg-[#335296]/15 border-[#3759a3]/40 text-[#335296]",
        hoverChip: "bg-theme-card border-theme-border text-theme-text-muted hover:text-theme-text hover:border-[#94a3c8]",
        selectAllBtn: "border-[#3759a3]/30 bg-[#3762c1]/8 text-[#335296] hover:border-[#3759a3]/50 hover:bg-[#3762c1]/12 hover:text-[#2a4786]",
        more: "text-[#335296] hover:text-[#6b99ff]",
        destructiveBtn: "border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100 hover:text-red-800",
      }
    : {
        section: "mb-2.5 border-[#f5c86a]/15 bg-[#f5c86a]/5",
        label: "text-[#f5d88d]",
        badge: "border-[#f5c86a]/20 bg-[#f5c86a]/8 text-[#f5d88d]/90",
        input: "border-[#f5c86a]/20 focus:border-[#f5c86a]/55 focus:bg-[#f5c86a]/5",
        activeChip: "bg-[#7f641f]/20 border-[#f5c86a]/45 text-[#f5d88d]",
        hoverChip: "bg-theme-card border-theme-border text-theme-text-muted hover:text-theme-text hover:border-[#444]",
        selectAllBtn: "border-[#f5c86a]/35 bg-[#f5c86a]/10 text-[#f5d88d] hover:border-[#f5c86a]/55 hover:bg-[#f5c86a]/15 hover:text-[#ffd77f]",
        more: "text-[#f5c86a] hover:text-[#ffd77f]",
        destructiveBtn: "border-red-500/30 bg-red-500/10 text-red-300 hover:border-red-400/50 hover:bg-red-500/15 hover:text-red-200",
      };

  const toggle = (value) => {
    const newSelected = selected.includes(value)
      ? selected.filter((s) => s !== value)
      : [...selected, value];
    onChange(newSelected);
  };

  // Bulk-select the current option scope without removing any existing picks.
  const selectAll = () => {
    const nextSelected = [...selected];
    const seen = new Set(nextSelected);
    for (const opt of optionsToUse) {
      const value = opt.value ?? opt.label ?? opt;
      if (seen.has(value)) continue;
      seen.add(value);
      nextSelected.push(value);
    }
    onChange(nextSelected);
  };

  const clearAll = () => onChange([]);

  // Filter options based on search query
  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    const query = searchQuery.toLowerCase();
    return options.filter((opt) => {
      const optLabel = opt.label ?? opt;
      return String(optLabel).toLowerCase().includes(query);
    });
  }, [options, searchQuery]);

  // When search is active, show all filtered results; otherwise use expand logic
  const optionsToUse = searchQuery.trim() ? filteredOptions : options;
  const safePreviewLimit = Math.max(1, Number(previewLimit) || 12);
  const displayOptions = showAll ? optionsToUse : optionsToUse.slice(0, safePreviewLimit);
  const hiddenCount = Math.max(0, optionsToUse.length - safePreviewLimit);
  // Keep the bulk action row scoped to the AI Signals popup only.
  const showBulkActions = accented && optionsToUse.length > 1;

  return (
    <div className={`px-3 py-2 rounded-xl border ${accented ? accentPalette.section : "border-transparent"}`}>
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          {showLabel && label ? (
            <div className={`text-[10px] font-semibold uppercase tracking-[0.08em] ${accented ? accentPalette.label : "text-theme-text-secondary"}`}>
              {label}
            </div>
          ) : (
            <span />
          )}
          {showBulkActions && (
            <div className="flex items-center gap-1.5">
              {selectedCount > 0 && (
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${accented ? accentPalette.badge : "border-[#3759a3]/25 bg-[#3762c1]/8 text-[#6b99ff]/90"}`}>
                  {selectedCount} selected
                </span>
              )}
              <button
                type="button"
                onClick={selectAll}
                className={`rounded-md border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] transition-colors ${accented ? accentPalette.selectAllBtn : "border-[#3759a3]/30 bg-[#3762c1]/8 text-[#6b99ff] hover:border-[#3759a3]/50 hover:bg-[#3762c1]/12 hover:text-[#7fa8ff]"}`}
              >
                Select all
              </button>
              {selectedCount > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className={`rounded-md border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] transition-colors ${accented ? accentPalette.destructiveBtn : "border-red-500/30 bg-red-500/10 text-red-300 hover:border-red-400/50 hover:bg-red-500/15 hover:text-red-200"}`}
                >
                  Deselect all
                </button>
              )}
            </div>
          )}
        </div>
        {/* Search bar - only show if showSearch is true */}
        {showSearch && (
          <div className="relative mb-2">
            <Search
              size={12}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-theme-text-muted"
            />
            <input
              type="text"
              placeholder={label ? `Search ${label}...` : 'Search...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full bg-theme-card border rounded-md pl-7 pr-3 py-1.5 text-[11px] text-theme-text placeholder:text-theme-text-muted focus:outline-none transition-colors ${accented ? accentPalette.input : "border-theme-border focus:border-[#3759a3]/50"}`}
            />
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {displayOptions.map((opt) => {
            const value = opt.value ?? opt.label ?? opt;
            const optLabel = opt.label ?? opt;
            const isActive = selected.includes(value);
            return (
              <button
                key={value}
                onClick={() => toggle(value)}
                className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all border ${
                  isActive
                    ? accented
                      ? accentPalette.activeChip
                      : "bg-[#335296]/20 border-[#3759a3]/40 text-[#7899e0]"
                    : accented
                      ? accentPalette.hoverChip
                      : "bg-theme-card border-theme-border text-theme-text-muted hover:text-theme-text hover:border-[#444]"
                }`}
              >
                {isActive && <X size={8} className="inline mr-0.5 -mt-px" />}
                {optLabel}
              </button>
            );
          })}
        </div>
        {!showAll && hiddenCount > 0 && (
          <button
            onClick={() => setShowAll(true)}
            className={`mt-1.5 text-[10px] transition-colors ${accented ? accentPalette.more : "text-red-500 hover:text-red-400"}`}
          >
            + {hiddenCount} more
          </button>
        )}
        {showAll && hiddenCount > 0 && (
          <button
            onClick={() => setShowAll(false)}
            className="mt-1.5 text-[10px] text-theme-text-muted hover:text-theme-text-muted transition-colors"
          >
            Show less
          </button>
        )}
      </div>
    </div>
  );
};

export default ChipMultiSelect;
