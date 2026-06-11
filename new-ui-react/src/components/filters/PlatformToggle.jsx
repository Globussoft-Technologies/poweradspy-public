import React from "react";
import SDUIIcon from "../sdui/SDUIIcon";

/**
 * PlatformToggle — Icon-based toggle buttons for selecting platforms.
 * Supports multi-select (multiple platforms active at once).
 * Each option can have icon_url (SVG or image) and icon_type.
 */
const PlatformToggle = ({
  label,
  options = [],
  selected = [],
  onChange,
  multiSelect = true,
}) => {
  const toggle = (value) => {
    if (multiSelect) {
      const newSelected = selected.includes(value)
        ? selected.filter((s) => s !== value)
        : [...selected, value];
      // Don't allow deselecting all
      if (newSelected.length === 0) return;
      onChange(newSelected);
    } else {
      onChange([value]);
    }
  };

  return (
    <div className="px-3 py-2">
      {label && (
        <span className="text-[10px] font-bold text-theme-text-secondary uppercase tracking-widest block mb-2">
          {label}
        </span>
      )}
      <div className="flex items-center gap-1 flex-wrap">
        {options.map((opt) => {
          const value = opt.value ?? opt.label ?? opt;
          const optLabel = opt.label ?? opt;
          const isActive = selected.includes(value);

          // Determine icon
          const hasIcon = opt.icon_url || opt.icon_type;
          const iconObj = hasIcon
            ? {
                type: opt.icon_type || "svg",
                value: opt.icon_url || "",
              }
            : null;

          return (
            <button
              key={value}
              onClick={() => toggle(value)}
              title={optLabel}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${
                isActive
                  ? "bg-[#335296]/20 border-[#3759a3]/40 text-[#7899e0]"
                  : "bg-theme-card border-theme-border text-theme-text-muted hover:text-theme-text hover:border-[#444]"
              }`}
            >
              {iconObj && <SDUIIcon icon={iconObj} size={14} />}
              <span>{optLabel}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default PlatformToggle;
