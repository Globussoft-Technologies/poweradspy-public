import { Check } from "lucide-react";
import { useTheme } from "../../hooks/useTheme";
import {
  getAiColorLabel,
  normalizeAiColorHex,
} from "../../utils/aiColorPalette";

const relativeLuminance = (hex) => {
  const normalized = normalizeAiColorHex(hex);
  if (!/^#[0-9A-F]{6}$/.test(normalized)) return 0;
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(normalized.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (
    channels[0] * 0.2126 +
    channels[1] * 0.7152 +
    channels[2] * 0.0722
  );
};

/**
 * AI color selector that keeps hexadecimal option values in filter state while
 * presenting accessible names and visual swatches to the user.
 */
const ColorSwatchMultiSelect = ({
  options = [],
  selected = [],
  onChange,
  label,
  accented = false,
}) => {
  const { theme = "dark" } = useTheme() || {};
  const isLightTheme = theme === "light";
  const selectedValues = Array.isArray(selected) ? selected : [];
  const selectedHex = new Set(selectedValues.map(normalizeAiColorHex));
  const selectedCount = selectedHex.size;

  const palette = isLightTheme
    ? {
        section: "border-[#3762c1]/15 bg-[#3762c1]/5",
        label: "text-[#335296]",
        badge: "border-[#3759a3]/25 bg-[#3762c1]/8 text-[#335296]",
        selectAll:
          "border-[#3759a3]/30 bg-[#3762c1]/8 text-[#335296] hover:border-[#3759a3]/50 hover:bg-[#3762c1]/12",
        destructive:
          "border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100",
        active: "border-[#3762c1] bg-[#3762c1]/10 ring-[#3762c1]/20",
        idle:
          "border-theme-border bg-theme-card hover:border-[#3762c1]/45 hover:bg-[#3762c1]/5",
      }
    : {
        section: "border-[#f5c86a]/15 bg-[#f5c86a]/5",
        label: "text-[#f5d88d]",
        badge:
          "border-[#f5c86a]/20 bg-[#f5c86a]/8 text-[#f5d88d]/90",
        selectAll:
          "border-[#f5c86a]/35 bg-[#f5c86a]/10 text-[#f5d88d] hover:border-[#f5c86a]/55 hover:bg-[#f5c86a]/15",
        destructive:
          "border-red-500/30 bg-red-500/10 text-red-300 hover:border-red-400/50 hover:bg-red-500/15",
        active:
          "border-[#f5c86a]/70 bg-[#f5c86a]/10 ring-[#f5c86a]/15",
        idle:
          "border-theme-border bg-theme-card hover:border-[#f5c86a]/40 hover:bg-[#f5c86a]/5",
      };

  const toggle = (value) => {
    const normalized = normalizeAiColorHex(value);
    if (selectedHex.has(normalized)) {
      onChange(
        selectedValues.filter(
          (item) => normalizeAiColorHex(item) !== normalized,
        ),
      );
      return;
    }
    onChange([...selectedValues, value]);
  };

  const selectAll = () => {
    const next = [...selectedValues];
    const seen = new Set(selectedHex);
    for (const option of options) {
      const value = option?.value ?? option?.label ?? option;
      const normalized = normalizeAiColorHex(value);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      next.push(value);
    }
    onChange(next);
  };

  return (
    <div
      className={`h-full rounded-xl border px-3 py-3 ${
        accented ? palette.section : "border-transparent"
      }`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div
          className={`text-[10px] font-semibold uppercase tracking-[0.08em] ${
            accented ? palette.label : "text-theme-text-secondary"
          }`}
        >
          {label || "Colors"}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {selectedCount > 0 && (
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${palette.badge}`}
            >
              {selectedCount} selected
            </span>
          )}
          <button
            type="button"
            onClick={selectAll}
            className={`rounded-md border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] transition-colors ${palette.selectAll}`}
          >
            Select all
          </button>
          {selectedCount > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className={`rounded-md border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] transition-colors ${palette.destructive}`}
            >
              Deselect all
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
        {options.map((option) => {
          const value = option?.value ?? option?.label ?? option;
          const normalized = normalizeAiColorHex(value);
          const displayLabel = getAiColorLabel(value, option?.label);
          const isSelected = selectedHex.has(normalized);
          const useDarkCheck = relativeLuminance(normalized) > 0.58;

          return (
            <button
              type="button"
              key={normalized || displayLabel}
              onClick={() => toggle(value)}
              aria-pressed={isSelected}
              aria-label={`${displayLabel}${isSelected ? ", selected" : ""}`}
              className={`group flex min-w-0 flex-col items-center gap-1.5 rounded-lg border px-1.5 py-2 transition-all ${
                isSelected
                  ? `${palette.active} ring-2`
                  : palette.idle
              }`}
            >
              <span
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/15 shadow-sm transition-transform group-hover:scale-105"
                style={{ backgroundColor: normalized }}
              >
                {isSelected && (
                  <Check
                    size={14}
                    strokeWidth={3}
                    className={useDarkCheck ? "text-slate-900" : "text-white"}
                  />
                )}
              </span>
              <span className="w-full truncate text-center text-[10px] font-medium text-theme-text-secondary">
                {displayLabel}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ColorSwatchMultiSelect;
