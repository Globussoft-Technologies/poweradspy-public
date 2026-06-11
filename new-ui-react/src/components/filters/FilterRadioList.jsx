import React, { useState } from "react";

/**
 * FilterRadioList — Single-select radio buttons.
 * Accepts SDUI options as objects { label, value } or plain strings.
 * Accepts `value` (single string) or `selected` ([string]) for current selection.
 */
const FilterRadioList = ({
  label,
  options = [],
  value,
  selected = [],
  onChange,
}) => {
  const [expandedCount, setExpandedCount] = useState(false);

  const getOptValue = (opt) => opt?.value ?? opt?.label ?? opt;
  const getOptLabel = (opt) => opt?.label ?? opt;

  // Support both `value` (string) and `selected` ([string]) patterns
  const currentValue = value ?? selected[0] ?? "";

  const displayOptions = expandedCount ? options : options.slice(0, 5);
  const hiddenCount = options.length - 5;

  const handleSelect = (optValue) => {
    // If onChange expects a single value (legacy) vs array (SDUI)
    onChange(optValue);
  };

  return (
    <div className="px-3 py-2">
      <div>
        <div className="space-y-1">
          {displayOptions.map((opt) => {
            const optValue = getOptValue(opt);
            const optLabel = getOptLabel(opt);
            const on = currentValue === optValue;
            return (
              <button
                key={optValue}
                onClick={() => handleSelect(optValue)}
                className="w-full flex items-center gap-2.5 py-1 text-[11px] group"
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${on ? "border-[#335296]" : "border-theme-text-secondary group-hover:border-theme-text"}`}
                >
                  {on && (
                    <div className="w-1.5 h-1.5 rounded-full bg-[#335296]" />
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
      </div>
    </div>
  );
};

export default FilterRadioList;
