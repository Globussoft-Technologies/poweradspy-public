import React, { useState } from "react";
import { useTheme } from "../../hooks/useTheme";

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
  accented = false,
}) => {
  const { theme } = useTheme();
  const isLightTheme = theme === "light";
  const [expandedCount, setExpandedCount] = useState(false);

  const getOptValue = (opt) => opt?.value ?? opt?.label ?? opt;
  const getOptLabel = (opt) => opt?.label ?? opt;

  // Support both `value` (string) and `selected` ([string]) patterns
  const currentValue = value ?? selected[0] ?? "";
  const selectedCount = currentValue ? 1 : 0;
  // The AI filter popup uses a separate accent tint so the state still reads
  // clearly in light and dark themes.
  const accentPalette = isLightTheme
    ? {
        section: "mb-2.5 border-[#3762c1]/15 bg-[#3762c1]/5",
        badge: "border-[#3759a3]/30 bg-[#3762c1]/10 text-[#335296]",
        hover: "hover:bg-[#3762c1]/5",
        onRing: "border-[#335296]",
        offRing: "border-[#93a4c8] group-hover:border-[#335296]",
        dot: "bg-[#335296]",
        textOn: "text-[#335296] font-medium",
        more: "text-[#335296] hover:text-[#6b99ff]",
      }
    : {
        section: "mb-2.5 border-[#f5c86a]/15 bg-[#f5c86a]/5",
        badge: "border-[#f5c86a]/30 bg-[#f5c86a]/10 text-[#f5d88d]",
        hover: "hover:bg-[#f5c86a]/5",
        onRing: "border-[#f5c86a]/70",
        offRing: "border-[#f5c86a]/25 group-hover:border-[#f5c86a]/55",
        dot: "bg-[#f5c86a]",
        textOn: "text-[#f5d88d] font-medium",
        more: "text-[#f5c86a] hover:text-[#ffd77f]",
      };

  const displayOptions = expandedCount ? options : options.slice(0, 5);
  const hiddenCount = options.length - 5;

  const handleSelect = (optValue) => {
    // If onChange expects a single value (legacy) vs array (SDUI)
    onChange(optValue);
  };

  return (
    <div className={`px-3 py-2 rounded-xl border ${accented ? accentPalette.section : "border-transparent"}`}>
      <div>
        {accented && selectedCount > 0 && (
          <div className="mb-2 flex justify-end">
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${accentPalette.badge}`}>
              selected
            </span>
          </div>
        )}
        <div className="space-y-1">
          {displayOptions.map((opt) => {
            const optValue = getOptValue(opt);
            const optLabel = getOptLabel(opt);
            const on = currentValue === optValue;
            return (
              <button
                key={optValue}
                onClick={() => handleSelect(optValue)}
                className={`w-full flex items-center gap-2.5 py-1 text-[11px] group rounded-md px-1 transition-colors ${accented ? accentPalette.hover : ""}`}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${on ? (accented ? accentPalette.onRing : "border-[#335296]") : (accented ? accentPalette.offRing : "border-theme-text-secondary group-hover:border-theme-text")}`}
                >
                  {on && (
                    <div className={`w-1.5 h-1.5 rounded-full ${accented ? accentPalette.dot : "bg-[#335296]"}`} />
                  )}
                </div>
                <span
                  className={`transition-colors text-left ${on ? (accented ? accentPalette.textOn : "text-[#7899e0] font-medium") : "text-theme-text-muted group-hover:text-theme-text"}`}
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
      </div>
    </div>
  );
};

export default FilterRadioList;
