import { useState, useMemo } from "react";
import { X, Search } from "lucide-react";

/**
 * ChipMultiSelect — Renders options as clickable chip/pill buttons with search.
 * Used for CTA, age ranges, and similar compact multi-select filters.
 */
const ChipMultiSelect = ({ options = [], selected = [], onChange, label, showSearch = true }) => {
  const [showAll, setShowAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const toggle = (value) => {
    const newSelected = selected.includes(value)
      ? selected.filter((s) => s !== value)
      : [...selected, value];
    onChange(newSelected);
  };

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
  const displayOptions = showAll ? optionsToUse : optionsToUse.slice(0, 12);
  const hiddenCount = optionsToUse.length - 12;

  return (
    <div className="px-3 py-2">
      <div>
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
              className="w-full bg-theme-card border border-theme-border rounded-md pl-7 pr-3 py-1.5 text-[11px] text-theme-text placeholder:text-theme-text-muted focus:outline-none focus:border-[#3759a3]/50 transition-colors"
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
                    ? "bg-[#335296]/20 border-[#3759a3]/40 text-[#7899e0]"
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
            className="mt-1.5 text-[10px] text-red-500 hover:text-red-400 transition-colors"
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
