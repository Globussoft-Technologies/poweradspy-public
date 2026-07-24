import React from "react";
import { ChevronDown } from "lucide-react";

/**
 * Compact SDUI single-select dropdown.
 * An absent value resolves to the option marked selected_by_default, then the
 * first option. This keeps "All" as a display default without activating an
 * API filter until the user makes a narrower selection.
 */
const DropdownFilter = ({ label, options = [], value, selected = [], onChange }) => {
  const defaultOption =
    options.find((option) => option?.selected_by_default) || options[0];
  const current = Array.isArray(value)
    ? value[0]
    : value ?? selected[0] ?? defaultOption?.value ?? "";

  return (
    <div className="px-3 py-2">
      {label && (
        <label className="mb-1.5 block text-[11px] font-medium text-theme-text-muted">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          aria-label={label || "Select option"}
          value={current}
          onChange={(event) => onChange(event.target.value)}
          className="w-full appearance-none rounded-md border border-theme-border bg-theme-card px-3 py-2 pr-8 text-[11px] text-theme-text focus:border-[#3759a3]/60 focus:outline-none"
        >
          {options.map((option) => (
            <option
              key={option.value ?? option._id ?? option.label}
              value={option.value ?? option.label}
            >
              {option.label ?? option.value}
            </option>
          ))}
        </select>
        <ChevronDown
          size={13}
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-theme-text-muted"
        />
      </div>
    </div>
  );
};

export default DropdownFilter;
