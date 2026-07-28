import React, { useState, useMemo } from "react";
import { Check, Search } from "lucide-react";
import { useTheme } from "../../hooks/useTheme";

/**
 * FilterCheckboxList — Multi-select checkboxes.
 * Accepts SDUI options as objects { label, value } or plain strings.
 */
const FilterCheckboxList = ({
  label,
  options = [],
  selected = [],
  onChange,
  maxItems,
  showSearch = true,
  accented = false,
}) => {
  const { theme } = useTheme();
  const isLightTheme = theme === "light";
  const [expandedCount, setExpandedCount] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const selectedCount = Array.isArray(selected) ? selected.length : 0;
  // AI-specific blocks stay subtle in dark mode but swap to the normal blue
  // brand accent in light mode so the popup remains theme aware.
  const accentPalette = isLightTheme
    ? {
        section: "mb-2.5 border-[#3762c1]/15 bg-[#3762c1]/5",
        label: "text-[#335296]",
        badge: "border-[#3759a3]/25 bg-[#3762c1]/8 text-[#335296]",
        input: "border-[#3762c1]/20 focus:border-[#3762c1]/55 focus:bg-[#3762c1]/5",
        hover: "hover:bg-[#3762c1]/5",
        checkedBox: "bg-[#335296] border-[#335296]",
        uncheckedBox: "border-[#93a4c8] group-hover:border-[#335296]",
        checkedText: "text-[#335296] font-medium",
        selectAllBtn: "border-[#3759a3]/30 bg-[#3762c1]/8 text-[#335296] hover:border-[#3759a3]/50 hover:bg-[#3762c1]/12 hover:text-[#2a4786]",
        more: "text-[#335296] hover:text-[#6b99ff]",
        destructiveBtn: "border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100 hover:text-red-800",
      }
    : {
        section: "mb-2.5 border-[#f5c86a]/15 bg-[#f5c86a]/5",
        label: "text-[#f5d88d]",
        badge: "border-[#f5c86a]/20 bg-[#f5c86a]/8 text-[#f5d88d]/90",
        input: "border-[#f5c86a]/20 focus:border-[#f5c86a]/55 focus:bg-[#f5c86a]/5",
        hover: "hover:bg-[#f5c86a]/5",
        checkedBox: "bg-[#7f641f] border-[#f5c86a]/70",
        uncheckedBox: "border-[#f5c86a]/20 group-hover:border-[#f5c86a]/50",
        checkedText: "text-[#f5d88d] font-medium",
        selectAllBtn: "border-[#f5c86a]/35 bg-[#f5c86a]/10 text-[#f5d88d] hover:border-[#f5c86a]/55 hover:bg-[#f5c86a]/15 hover:text-[#ffd77f]",
        more: "text-[#f5c86a] hover:text-[#ffd77f]",
        destructiveBtn: "border-red-500/30 bg-red-500/10 text-red-300 hover:border-red-400/50 hover:bg-red-500/15 hover:text-red-200",
      };

  const getOptValue = (opt) => opt?.value ?? opt?.label ?? opt;
  const getOptLabel = (opt) => opt?.label ?? opt;
  const selectedValues = Array.isArray(selected) ? selected : [];

  const toggle = (optValue) => {
    if (maxItems && selected.length >= maxItems && !selected.includes(optValue))
      return;
    const newSelected = selected.includes(optValue)
      ? selected.filter((s) => s !== optValue)
      : [...selected, optValue];
    onChange(newSelected);
  };

  // Preserve existing selections and add every available option in scope.
  const selectAll = () => {
    const nextSelected = [...selectedValues];
    const seen = new Set(nextSelected);
    for (const opt of optionsToUse) {
      const optValue = getOptValue(opt);
      if (seen.has(optValue)) continue;
      if (maxItems && nextSelected.length >= maxItems) break;
      seen.add(optValue);
      nextSelected.push(optValue);
    }
    onChange(nextSelected);
  };

  const clearAll = () => onChange([]);

  // Filter options based on search query
  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    const query = searchQuery.toLowerCase();
    return options.filter((opt) => {
      const label = getOptLabel(opt);
      return label.toLowerCase().includes(query);
    });
  }, [options, searchQuery]);

  // When search is active, show all filtered results; otherwise use expand logic
  const optionsToUse = searchQuery.trim() ? filteredOptions : options;
  const displayOptions = expandedCount ? optionsToUse : optionsToUse.slice(0, 5);
  const hiddenCount = optionsToUse.length - 5;
  // Only the AI Signals popup gets the extra bulk controls.
  const showBulkActions = accented && optionsToUse.length > 1;

  return (
    <div className={`px-3 py-2 rounded-xl border ${accented ? accentPalette.section : "border-transparent"}`}>
      <div>
        {showBulkActions && (
          <div className="mb-2 flex items-center justify-between gap-2">
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
            </div>
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

        <div className="space-y-1">
          {displayOptions.map((opt) => {
            const optValue = getOptValue(opt);
            const optLabel = getOptLabel(opt);
            const on = selected.includes(optValue);
            return (
              <button
                key={optValue}
                onClick={() => toggle(optValue)}
                className={`w-full flex items-center gap-2.5 py-1 text-[11px] group rounded-md px-1 transition-colors ${accented ? accentPalette.hover : ""}`}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 transition-colors ${on ? (accented ? accentPalette.checkedBox : "bg-[#335296] border-[#335296]") : (accented ? accentPalette.uncheckedBox : "border-theme-text-secondary group-hover:border-theme-text")}`}
                >
                  {on && (
                    <Check size={8} strokeWidth={3} className="text-white" />
                  )}
                </div>
                <span
                  className={`transition-colors text-left ${on ? (accented ? accentPalette.checkedText : "text-[#7899e0] font-medium") : "text-theme-text-muted group-hover:text-theme-text"}`}
                >
                  {optLabel}
                </span>
              </button>
            );
          })}
        </div>
        {!expandedCount && hiddenCount > 0 && (
          <button
            onClick={() => setExpandedCount(true)}
            className={`mt-1.5 text-[10px] transition-colors text-left ${accented ? accentPalette.more : "text-red-500 hover:text-red-400"}`}
          >
            + {hiddenCount} more
          </button>
        )}
        {expandedCount && hiddenCount > 0 && (
          <button
            onClick={() => setExpandedCount(false)}
            className="mt-1.5 text-[10px] text-theme-text-muted hover:text-theme-text-muted transition-colors text-left"
          >
            Show less
          </button>
        )}
        {maxItems && selected.length >= maxItems && (
          <div className="text-[10px] text-orange-400 mt-1">
            Maximum {maxItems} items selected
          </div>
        )}
      </div>
    </div>
  );
};

export default FilterCheckboxList;
