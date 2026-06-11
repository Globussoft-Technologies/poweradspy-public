import React, { useState, useMemo } from "react";
import { Check, Search } from "lucide-react";

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
}) => {
  const [expandedCount, setExpandedCount] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const getOptValue = (opt) => opt?.value ?? opt?.label ?? opt;
  const getOptLabel = (opt) => opt?.label ?? opt;

  const toggle = (optValue) => {
    if (maxItems && selected.length >= maxItems && !selected.includes(optValue))
      return;
    const newSelected = selected.includes(optValue)
      ? selected.filter((s) => s !== optValue)
      : [...selected, optValue];
    onChange(newSelected);
  };

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

        <div className="space-y-1">
          {displayOptions.map((opt) => {
            const optValue = getOptValue(opt);
            const optLabel = getOptLabel(opt);
            const on = selected.includes(optValue);
            return (
              <button
                key={optValue}
                onClick={() => toggle(optValue)}
                className="w-full flex items-center gap-2.5 py-1 text-[11px] group"
              >
                <div
                  className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 transition-colors ${on ? "bg-[#335296] border-[#335296]" : "border-theme-text-secondary group-hover:border-theme-text"}`}
                >
                  {on && (
                    <Check size={8} strokeWidth={3} className="text-white" />
                  )}
                </div>
                <span
                  className={`transition-colors text-left ${on ? "text-[#7899e0] font-medium" : "text-theme-text-muted group-hover:text-theme-text"}`}
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
            className="mt-1.5 text-[10px] text-red-500 hover:text-red-400 transition-colors text-left"
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
