import { Check } from "lucide-react";
import { useTheme } from "../../hooks/useTheme";
import {
  AI_COLOR_GROUPS,
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
  const optionByHex = new Map(
    options.map((option) => {
      const value = option?.value ?? option?.label ?? option;
      return [normalizeAiColorHex(value), value];
    }),
  );
  const availableGroups = AI_COLOR_GROUPS.map((group) => ({
    ...group,
    values: group.values.filter((value) => optionByHex.has(value)),
  })).filter((group) => group.values.length > 0);

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

  const toggleGroup = (groupValues) => {
    const allSelected = groupValues.every((value) => selectedHex.has(value));
    if (allSelected) {
      const groupSet = new Set(groupValues);
      onChange(
        selectedValues.filter(
          (value) => !groupSet.has(normalizeAiColorHex(value)),
        ),
      );
      return;
    }

    const next = [...selectedValues];
    const seen = new Set(selectedHex);
    for (const normalized of groupValues) {
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      next.push(optionByHex.get(normalized));
    }
    onChange(next);
  };

  return (
    <div
      className={`rounded-xl border px-3 py-3 ${
        accented ? palette.section : "border-transparent"
      }`}
    >
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div
          className={`text-[12px] font-bold uppercase tracking-[0.09em] ${
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
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="mb-3">
        <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-theme-text-muted">
          Curated palettes
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {availableGroups.map((group) => {
            const isSelected = group.values.every((value) =>
              selectedHex.has(value),
            );
            return (
              <button
                type="button"
                key={group.id}
                onClick={() => toggleGroup(group.values)}
                aria-pressed={isSelected}
                className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                  isSelected
                    ? palette.active
                    : palette.idle
                }`}
              >
                <span className="truncate text-[11px] font-semibold text-theme-text-secondary">
                  {group.label}
                </span>
                <span className="flex shrink-0 -space-x-1">
                  {group.values.map((value) => (
                    <span
                      key={value}
                      className="h-4 w-4 rounded-full border-2 border-theme-card shadow-sm"
                      style={{ backgroundColor: value }}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-theme-text-muted">
        Individual colors
      </div>
      <div className="-mx-0.5 overflow-x-auto px-0.5 pb-1">
        <div className="flex min-w-max items-center gap-1.5">
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
                title={displayLabel}
                className="group flex shrink-0 items-center justify-center bg-transparent py-0.5"
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-md border shadow-sm transition-all group-hover:scale-105 ${
                    isSelected
                      ? isLightTheme
                        ? "border-[#3762c1] ring-2 ring-[#3762c1]/25"
                        : "border-[#f5c86a] ring-2 ring-[#f5c86a]/20"
                      : "border-black/15"
                  }`}
                  style={{ backgroundColor: normalized }}
                >
                  {isSelected && (
                    <Check
                      size={13}
                      strokeWidth={3}
                      className={useDarkCheck ? "text-slate-900" : "text-white"}
                    />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ColorSwatchMultiSelect;
