import React from "react";

/**
 * SegmentedControl — A horizontal group of toggle buttons (e.g. Ascending/Descending).
 */
const SegmentedControl = ({
  label,
  options = [],
  value,
  selected = [],
  onChange,
}) => {
  const currentValue = value ?? selected[0] ?? "";

  return (
    <div className="px-3 py-2">
      {label && (
        <span className="text-[10px] font-bold text-theme-text-secondary uppercase tracking-widest block mb-2">
          {label}
        </span>
      )}
      <div className="flex items-center bg-theme-card border border-theme-border rounded-lg overflow-hidden">
        {options.map((opt) => {
          const optValue = opt.value ?? opt.label ?? opt;
          const optLabel = opt.label ?? opt;
          const isActive = currentValue === optValue;
          return (
            <button
              key={optValue}
              onClick={() => onChange(optValue)}
              className={`flex-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${
                isActive
                  ? "bg-[#335296] text-white"
                  : "text-theme-text-muted hover:text-theme-text hover:bg-theme-text/[0.04]"
              }`}
            >
              {optLabel}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default SegmentedControl;
