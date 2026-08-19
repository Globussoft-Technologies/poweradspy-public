import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, Sparkles, SlidersHorizontal, X } from "lucide-react";
import SchemaRenderer from "./SchemaRenderer";
import { useTheme } from "../../hooks/useTheme";
import {
  AI_FILTER_DRAFT_KEY,
  getAiFilterKeys,
  normalizeAiFilterValues,
} from "../../utils/aiQuickFilterPresets";
import {
  AI_COLOR_GROUPS,
  getAiColorLabel,
  normalizeAiColorHex,
} from "../../utils/aiColorPalette";

const AI_SIGNALS_OPEN_KEY = "sdui.aiSignals.open";
const AI_SIGNALS_ACTIVE_GROUP_KEY = "sdui.aiSignals.activeGroup";

const AI_FILTER_PRESENTATION = Object.freeze({
  ai_ad_type: {
    description: "Creative format used to present the ad.",
    hue: "#7c3aed",
    darkHue: "#c084fc",
    order: 1,
  },
  ai_intent: {
    description: "Funnel stage and outcome the ad is designed for.",
    hue: "#2563eb",
    darkHue: "#7da2ff",
    order: 2,
  },
  ai_hook: {
    description: "Persuasion angle used to capture attention.",
    hue: "#0e7490",
    darkHue: "#5eead4",
    order: 3,
  },
  ai_offer_type: {
    description: "Incentive presented to the viewer.",
    hue: "#c2410c",
    darkHue: "#fb923c",
    order: 4,
  },
  ai_offering_type: {
    description: "The kind of offering being promoted.",
    hue: "#a16207",
    darkHue: "#fbbf24",
    order: 5,
  },
  ai_colors: {
    description: "Dominant colors detected in the ad creative.",
    hue: "#be185d",
    darkHue: "#f472b6",
    order: 6,
  },
  ai_category_id: {
    description: "Industry and content taxonomy assigned by AI.",
    hue: "#15803d",
    darkHue: "#4ade80",
    order: 7,
  },
});

const optionValue = (option) => option?.value ?? option?.label ?? option;
const optionLabel = (option) => option?.label ?? option?.value ?? option;
const presentationHue = (presentation, isLightTheme) =>
  isLightTheme
    ? presentation?.hue || "#4f46e5"
    : presentation?.darkHue || presentation?.hue || "#818cf8";

const getOwnedFilterKeys = (filter) =>
  [
    filter?._id,
    filter?.parent_filter_id,
    filter?.child_filter_id,
  ].filter((key, index, keys) => key && keys.indexOf(key) === index);

const getFilterSelectionCount = (filter, values) => {
  if (!filter) return 0;
  if (
    filter.type === "nested_select" ||
    filter.type === "nested_multiselect"
  ) {
    const parentKey = filter.parent_filter_id || filter._id;
    const childKey = filter.child_filter_id;
    const parents = Array.isArray(values?.[parentKey])
      ? values[parentKey]
      : [];
    if (parents.length > 0) return new Set(parents).size;
    const children =
      childKey && Array.isArray(values?.[childKey]) ? values[childKey] : [];
    return new Set(children).size;
  }

  const value = values?.[filter._id];
  if (Array.isArray(value)) return new Set(value).size;
  return isEmptyFilterValue(value) ? 0 : 1;
};

const collectLeafValues = (node) => {
  const children = node?.children || node?.sub_options || [];
  if (children.length === 0) return [optionValue(node)];
  return children.flatMap(collectLeafValues);
};

const findOption = (options, targetValue) => {
  for (const option of options || []) {
    if (optionValue(option) === targetValue) return option;
    const nested = findOption(
      option.children || option.sub_options || [],
      targetValue,
    );
    if (nested) return nested;
  }
  return null;
};

const readActiveGroup = () => {
  try {
    return sessionStorage.getItem(AI_SIGNALS_ACTIVE_GROUP_KEY);
  } catch {
    return null;
  }
};

const readDraft = (fallback = null) => {
  try {
    const raw = sessionStorage.getItem(AI_FILTER_DRAFT_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const isEmptyFilterValue = (value) =>
  value === undefined ||
  value === null ||
  value === false ||
  value === "" ||
  (Array.isArray(value) && value.length === 0);

const normalizeComparableValue = (value) => {
  if (isEmptyFilterValue(value)) return null;
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeComparableValue(item))
      .filter((item) => item !== null)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        const normalized = normalizeComparableValue(value[key]);
        if (normalized !== null) acc[key] = normalized;
        return acc;
      }, {});
  }
  return value;
};

const serializeAiSubset = (values, keys) =>
  JSON.stringify(
    keys
      .map((key) => [key, normalizeComparableValue(values?.[key])])
      .filter(([, value]) => value !== null)
      .sort(([a], [b]) => a.localeCompare(b)),
  );

const buildDraftFromValues = (values, keys) => {
  const next = {};
  for (const key of keys) {
    if (!isEmptyFilterValue(values?.[key])) {
      next[key] = values[key];
    }
  }
  return next;
};

export const getDocumentFilterKeys = getAiFilterKeys;

const FocusedOptionGrid = ({
  filter,
  selected,
  onChange,
  searchQuery,
  onSearchChange,
  hue,
  isLightTheme,
  shouldShowOption,
}) => {
  const options = (filter.options || []).filter(
    (option) => !shouldShowOption || shouldShowOption(option),
  );
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleOptions = normalizedQuery
    ? options.filter((option) =>
        String(optionLabel(option)).toLowerCase().includes(normalizedQuery),
      )
    : options;
  const selectedValues = Array.isArray(selected) ? selected : [];

  const toggle = (value) => {
    onChange(
      selectedValues.includes(value)
        ? selectedValues.filter((item) => item !== value)
        : [...selectedValues, value],
    );
  };

  return (
    <>
      {options.length > 4 && (
        <div className="sticky top-0 z-[2] bg-theme-surface pb-3">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-[11px] text-theme-text-muted"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={`Search ${options.length} ${String(filter.label || "filter").toLowerCase()} options`}
            className="w-full rounded-lg border border-theme-border bg-theme-card py-2 pl-9 pr-3 text-[13px] text-theme-text outline-none transition-colors placeholder:text-theme-text-muted focus:border-theme-text/30"
          />
        </div>
      )}

      {visibleOptions.length > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {visibleOptions.map((option) => {
            const value = optionValue(option);
            const label = optionLabel(option);
            const isSelected = selectedValues.includes(value);
            return (
              <button
                type="button"
                key={option?._id || value}
                onClick={() => toggle(value)}
                aria-pressed={isSelected}
                className="flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-[13px] transition-colors hover:border-theme-text/30"
                style={{
                  borderColor: isSelected
                    ? `color-mix(in srgb, ${hue} ${
                        isLightTheme ? 45 : 70
                      }%, transparent)`
                    : isLightTheme
                      ? undefined
                      : "rgba(255,255,255,0.14)",
                  backgroundColor: isSelected
                    ? `color-mix(in srgb, ${hue} ${
                        isLightTheme ? 7 : 22
                      }%, transparent)`
                    : isLightTheme
                      ? undefined
                      : "rgba(255,255,255,0.035)",
                }}
              >
                <span
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded border"
                  style={{
                    borderColor: isSelected
                      ? hue
                      : isLightTheme
                        ? undefined
                        : "rgba(255,255,255,0.28)",
                    backgroundColor: isSelected
                      ? isLightTheme
                        ? hue
                        : `color-mix(in srgb, ${hue} 64%, black)`
                      : "transparent",
                  }}
                >
                  {isSelected && (
                    <Check size={11} strokeWidth={3} className="text-white" />
                  )}
                </span>
                <span
                  className={`truncate font-medium ${
                    isSelected
                      ? "text-theme-text"
                      : "text-theme-text-secondary"
                  }`}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="py-6 text-center text-sm text-theme-text-muted">
          No options match that search.
        </div>
      )}
    </>
  );
};

const FocusedColorGrid = ({
  options,
  selected,
  onChange,
  hue,
  isLightTheme,
  shouldShowOption,
}) => {
  const visibleOptions = (options || []).filter(
    (option) => !shouldShowOption || shouldShowOption(option),
  );
  const selectedValues = Array.isArray(selected) ? selected : [];
  const selectedHex = new Set(selectedValues.map(normalizeAiColorHex));
  const optionByHex = new Map(
    visibleOptions.map((option) => [
      normalizeAiColorHex(optionValue(option)),
      optionValue(option),
    ]),
  );
  const palettes = AI_COLOR_GROUPS.map((group) => ({
    ...group,
    values: group.values.filter((value) => optionByHex.has(value)),
  })).filter((group) => group.values.length > 0);

  const toggleValues = (hexValues) => {
    const allSelected = hexValues.every((value) => selectedHex.has(value));
    if (allSelected) {
      const valuesToRemove = new Set(hexValues);
      onChange(
        selectedValues.filter(
          (value) => !valuesToRemove.has(normalizeAiColorHex(value)),
        ),
      );
      return;
    }

    const next = [...selectedValues];
    const seen = new Set(selectedHex);
    for (const hex of hexValues) {
      if (seen.has(hex)) continue;
      seen.add(hex);
      next.push(optionByHex.get(hex));
    }
    onChange(next);
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-theme-text-muted">
          Curated palettes
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {palettes.map((palette) => {
            const isSelected = palette.values.every((value) =>
              selectedHex.has(value),
            );
            return (
              <button
                type="button"
                key={palette.id}
                onClick={() => toggleValues(palette.values)}
                aria-pressed={isSelected}
                className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-theme-text/30"
                style={{
                  borderColor: isSelected
                    ? `color-mix(in srgb, ${hue} ${
                        isLightTheme ? 45 : 70
                      }%, transparent)`
                    : isLightTheme
                      ? undefined
                      : "rgba(255,255,255,0.14)",
                  backgroundColor: isSelected
                    ? `color-mix(in srgb, ${hue} ${
                        isLightTheme ? 7 : 22
                      }%, transparent)`
                    : isLightTheme
                      ? undefined
                      : "rgba(255,255,255,0.035)",
                }}
              >
                <span
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded border"
                  style={{
                    borderColor: isSelected
                      ? hue
                      : isLightTheme
                        ? undefined
                        : "rgba(255,255,255,0.28)",
                    backgroundColor: isSelected
                      ? isLightTheme
                        ? hue
                        : `color-mix(in srgb, ${hue} 64%, black)`
                      : "transparent",
                  }}
                >
                  {isSelected && (
                    <Check size={11} strokeWidth={3} className="text-white" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-theme-text-secondary">
                  {palette.label}
                </span>
                <span className="flex shrink-0 gap-1">
                  {palette.values.map((value) => (
                    <span
                      key={value}
                      className="h-4 w-4 rounded border border-black/10"
                      style={{ backgroundColor: value }}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-theme-text-muted">
          Individual colors
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {visibleOptions.map((option) => {
            const value = optionValue(option);
            const normalized = normalizeAiColorHex(value);
            const label = getAiColorLabel(value, option?.label);
            const isSelected = selectedHex.has(normalized);
            return (
              <button
                type="button"
                key={option?._id || normalized}
                onClick={() => toggleValues([normalized])}
                aria-pressed={isSelected}
                className="flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-theme-text/30"
                style={{
                  borderColor: isSelected
                    ? `color-mix(in srgb, ${hue} ${
                        isLightTheme ? 45 : 70
                      }%, transparent)`
                    : isLightTheme
                      ? undefined
                      : "rgba(255,255,255,0.14)",
                  backgroundColor: isSelected
                    ? `color-mix(in srgb, ${hue} ${
                        isLightTheme ? 7 : 22
                      }%, transparent)`
                    : isLightTheme
                      ? undefined
                      : "rgba(255,255,255,0.035)",
                }}
              >
                <span
                  className="h-5 w-5 shrink-0 rounded-md border border-black/15"
                  style={{ backgroundColor: normalized }}
                />
                <span className="truncate text-[13px] font-medium text-theme-text-secondary">
                  {label}
                </span>
                {isSelected && (
                  <Check
                    size={13}
                    strokeWidth={3}
                    className="ml-auto shrink-0"
                    style={{ color: hue }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

class PopupErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    if (import.meta.env.DEV) {
      /* eslint-disable no-console */
      console.error("AI Filters popup failed to render:", error);
      /* eslint-enable no-console */
    }
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

/**
 * Dedicated modal for the AI Filters sidebar section.
 *
 * The sidebar shows a compact launcher while the actual filters are edited in
 * this popup so the dense nested controls do not cram the sidebar column.
 */
const AiSignalsModal = ({
  isOpen,
  document: doc,
  filterValues,
  onClose,
  shouldShowFilter,
  shouldShowOption,
  isDependencySatisfied,
  activePlatforms,
  isFilterRestricted,
  filterHasPlanEntry,
  onRestricted,
  onApply,
}) => {
  const { theme = "dark" } = useTheme() || {};
  const isLightTheme = theme === "light";
  const filterKeys = useMemo(
    () => getDocumentFilterKeys(doc),
    [doc],
  );
  const visibleFilters = useMemo(
    () =>
      [...(doc?.filters || [])]
        .filter(
          (filter) =>
            filter.visible !== false &&
            (!shouldShowFilter || shouldShowFilter(filter)) &&
            (!isDependencySatisfied || isDependencySatisfied(filter)),
        )
        .sort((first, second) => {
          const firstRank = Number(first.rank);
          const secondRank = Number(second.rank);
          const firstOrder =
            AI_FILTER_PRESENTATION[first._id]?.order ??
            (Number.isFinite(firstRank) ? firstRank : Number.MAX_SAFE_INTEGER);
          const secondOrder =
            AI_FILTER_PRESENTATION[second._id]?.order ??
            (Number.isFinite(secondRank)
              ? secondRank
              : Number.MAX_SAFE_INTEGER);
          return firstOrder - secondOrder;
        }),
    [doc, isDependencySatisfied, shouldShowFilter],
  );
  const [activeFilterId, setActiveFilterId] = useState(readActiveGroup);
  const [searchQuery, setSearchQuery] = useState("");
  const [draftValues, setDraftValues] = useState(() =>
    buildDraftFromValues(
      normalizeAiFilterValues(readDraft(filterValues || {}), doc),
      filterKeys,
    ),
  );
  const wasOpenRef = useRef(false);
  const activeFilter =
    visibleFilters.find((filter) => filter._id === activeFilterId) ||
    visibleFilters[0] ||
    null;
  const activePresentation =
    AI_FILTER_PRESENTATION[activeFilter?._id] || {
      description: activeFilter?.description || "AI-derived ad signal.",
      hue: "#4f46e5",
      darkHue: "#818cf8",
    };
  const activeAccent = presentationHue(activePresentation, isLightTheme);

  const draftSnapshot = useMemo(
    () => serializeAiSubset(draftValues, filterKeys),
    [draftValues, filterKeys],
  );
  const liveSnapshot = useMemo(
    () => serializeAiSubset(filterValues || {}, filterKeys),
    [filterValues, filterKeys],
  );
  const hasPendingChanges = draftSnapshot !== liveSnapshot;
  const activeFilterCount = visibleFilters.reduce(
    (count, filter) =>
      count + (getFilterSelectionCount(filter, draftValues) > 0 ? 1 : 0),
    0,
  );
  const totalSelectedValues = visibleFilters.reduce(
    (count, filter) => count + getFilterSelectionCount(filter, draftValues),
    0,
  );

  const isRestrictedChange = (filter) => {
    if (!filter || !isFilterRestricted || !onRestricted) return false;
    const hasOwnEntry = filterHasPlanEntry?.(filter._id);
    const restricted = hasOwnEntry
      ? isFilterRestricted(filter._id)
      : isFilterRestricted(filter._id) ||
        isFilterRestricted(filter.group_id) ||
        isFilterRestricted(doc?._id);
    if (restricted) onRestricted();
    return restricted;
  };

  const handleDraftChange = (filterId, value) => {
    const filter = visibleFilters.find((item) =>
      getOwnedFilterKeys(item).includes(filterId),
    );
    if (isRestrictedChange(filter)) return;

    setDraftValues((prev) => {
      const next = { ...prev };
      if (isEmptyFilterValue(value)) delete next[filterId];
      else next[filterId] = value;
      return next;
    });
  };

  const closeAndForgetDraft = () => {
    try {
      sessionStorage.removeItem(AI_FILTER_DRAFT_KEY);
      sessionStorage.removeItem(AI_SIGNALS_OPEN_KEY);
      sessionStorage.removeItem(AI_SIGNALS_ACTIVE_GROUP_KEY);
    } catch {}
    wasOpenRef.current = false;
    onClose?.();
  };

  const commitDraft = (nextDraft) => {
    if (typeof onApply === "function") {
      const next = { ...(filterValues || {}) };
      for (const key of filterKeys) {
        if (Object.prototype.hasOwnProperty.call(nextDraft, key) && !isEmptyFilterValue(nextDraft[key])) {
          next[key] = nextDraft[key];
        } else {
          delete next[key];
        }
      }
      onApply(next, {
        changedFilterIds: filterKeys,
        entryPoint: "ai_filter_modal",
      });
    }
    closeAndForgetDraft();
  };

  const handleClear = () => {
    // Keep Clear as an in-popup draft reset so users can review the empty state
    // before committing it with Apply.
    setDraftValues({});
  };

  const handleClearActive = () => {
    if (!activeFilter) return;
    setDraftValues((previous) => {
      const next = { ...previous };
      for (const key of getOwnedFilterKeys(activeFilter)) delete next[key];
      return next;
    });
  };

  const getVisibleOptions = (filter) =>
    (filter?.options || []).filter(
      (option) => !shouldShowOption || shouldShowOption(option),
    );

  const handleSelectAllActive = () => {
    if (!activeFilter) return;
    const options = getVisibleOptions(activeFilter);
    if (
      activeFilter.type === "nested_select" ||
      activeFilter.type === "nested_multiselect"
    ) {
      if (isRestrictedChange(activeFilter)) return;
      const parentKey = activeFilter.parent_filter_id || activeFilter._id;
      const childKey = activeFilter.child_filter_id;
      const parentValues = options.map(optionValue);
      const childValues = options.flatMap(collectLeafValues);
      setDraftValues((previous) => ({
        ...previous,
        [parentKey]: parentValues,
        ...(childKey ? { [childKey]: childValues } : {}),
      }));
      return;
    }
    handleDraftChange(activeFilter._id, options.map(optionValue));
  };

  const activeSelectionEntries = useMemo(
    () =>
      visibleFilters.flatMap((filter) => {
        const isNested =
          filter.type === "nested_select" ||
          filter.type === "nested_multiselect";
        const stateKey = isNested
          ? filter.parent_filter_id || filter._id
          : filter._id;
        const selected = Array.isArray(draftValues?.[stateKey])
          ? draftValues[stateKey]
          : isEmptyFilterValue(draftValues?.[stateKey])
            ? []
            : [draftValues[stateKey]];
        return selected.map((value) => {
          const matchedOption = findOption(filter.options || [], value);
          return {
            filter,
            stateKey,
            value,
            group: filter.label || filter._id,
            label:
              filter._id === "ai_colors"
                ? getAiColorLabel(value, matchedOption?.label)
                : optionLabel(matchedOption || value),
          };
        });
      }),
    [draftValues, visibleFilters],
  );

  const removeSelection = (entry) => {
    const { filter, stateKey, value } = entry;
    const selected = Array.isArray(draftValues?.[stateKey])
      ? draftValues[stateKey]
      : [];
    handleDraftChange(
      stateKey,
      selected.filter((item) => item !== value),
    );

    if (
      filter.type !== "nested_select" &&
      filter.type !== "nested_multiselect"
    ) {
      return;
    }

    const parent = findOption(filter.options || [], value);
    const childKey = filter.child_filter_id;
    if (!parent || !childKey) return;
    const leaves = new Set(collectLeafValues(parent));
    const childValues = Array.isArray(draftValues?.[childKey])
      ? draftValues[childKey]
      : [];
    handleDraftChange(
      childKey,
      childValues.filter((child) => !leaves.has(child)),
    );
  };

  const handleApply = () => {
    if (!hasPendingChanges) return;
    commitDraft(draftValues);
  };

  useEffect(() => {
    if (isOpen) return;
    // Keep the dormant modal aligned with chip removals and other external
    // filter changes; session storage is reserved for an actively open draft.
    setDraftValues(
      buildDraftFromValues(
        normalizeAiFilterValues(filterValues || {}, doc),
        filterKeys,
      ),
    );
  }, [doc, filterKeys, filterValues, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    try {
      sessionStorage.setItem(AI_FILTER_DRAFT_KEY, JSON.stringify(draftValues || {}));
    } catch {}
  }, [draftValues, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }

    let hasStoredDraft = false;
    try {
      hasStoredDraft = sessionStorage.getItem(AI_FILTER_DRAFT_KEY) != null;
      sessionStorage.setItem(AI_SIGNALS_OPEN_KEY, "1");
    } catch {}

    if (!wasOpenRef.current && !hasStoredDraft) {
      setDraftValues(
        buildDraftFromValues(
          normalizeAiFilterValues(filterValues || {}, doc),
          filterKeys,
        ),
      );
    }
    wasOpenRef.current = true;
  }, [doc, filterKeys, filterValues, isOpen]);

  useEffect(() => {
    const activeGroupExists = visibleFilters.some(
      (filter) => filter._id === activeFilterId,
    );
    if ((!activeFilterId || !activeGroupExists) && visibleFilters.length > 0) {
      setActiveFilterId(visibleFilters[0]._id);
    }
  }, [activeFilterId, visibleFilters]);

  useEffect(() => {
    setSearchQuery("");
    if (!activeFilterId) return;
    try {
      sessionStorage.setItem(AI_SIGNALS_ACTIVE_GROUP_KEY, activeFilterId);
    } catch {}
  }, [activeFilterId]);

  if (!isOpen || !doc) return null;

  const activeSelectedCount = getFilterSelectionCount(
    activeFilter,
    draftValues,
  );
  const activeOptions = getVisibleOptions(activeFilter);
  const activeDocument = activeFilter
    ? { ...doc, filters: [activeFilter] }
    : null;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-4">
      <div
        className="flex h-[min(760px,94vh)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-theme-border bg-theme-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-theme-border px-5 py-4 sm:px-6">
          <div
            className={`hidden rounded-xl border p-2.5 sm:flex ${
              isLightTheme
                ? "border-[#3762c1]/15 bg-[#3762c1]/8 text-[#335296]"
                : "border-[#f5c86a]/20 bg-[#f5c86a]/8 text-[#f5d88d]"
            }`}
          >
            <SlidersHorizontal size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[17px] font-bold text-theme-text">
                AI Filters
              </h2>
              <span
                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] ${
                  isLightTheme
                    ? "border-[#3762c1]/20 bg-[#3762c1]/10 text-[#335296]"
                    : "border-[#f5c86a]/35 bg-[#f5c86a]/10 text-[#f5c86a]"
                }`}
              >
                <Sparkles size={9} />
                New
              </span>
            </div>
            <p className="mt-0.5 truncate text-[12px] text-theme-text-secondary">
              Refine ads using AI-derived creative, intent, offer, color, and
              category signals.
            </p>
          </div>

          <button
            type="button"
            onClick={closeAndForgetDraft}
            className="shrink-0 rounded-lg border border-theme-border bg-theme-bg p-2 text-theme-text-muted transition-colors hover:border-theme-text/30 hover:text-theme-text"
            aria-label="Close AI Filters popup"
          >
            <X size={17} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="flex shrink-0 flex-col border-b border-theme-border bg-theme-bg/40 md:w-56 md:border-b-0 md:border-r">
            <div className="hidden px-4 pb-2 pt-4 text-[10px] font-semibold uppercase tracking-[0.1em] text-theme-text-muted md:block">
              Filter groups
            </div>

            <div className="flex gap-1 overflow-x-auto p-2 md:flex-1 md:flex-col md:overflow-y-auto">
              {visibleFilters.map((filter) => {
                const presentation =
                  AI_FILTER_PRESENTATION[filter._id] || activePresentation;
                const filterAccent = presentationHue(
                  presentation,
                  isLightTheme,
                );
                const isActive = filter._id === activeFilter?._id;
                const selectedCount = getFilterSelectionCount(
                  filter,
                  draftValues,
                );
                return (
                  <button
                    type="button"
                    key={filter._id}
                    onClick={() => setActiveFilterId(filter._id)}
                    className="flex min-w-max items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors md:min-w-0"
                    style={{
                      color: isActive ? filterAccent : undefined,
                      borderColor: isActive
                        ? `color-mix(in srgb, ${filterAccent} 55%, transparent)`
                        : "transparent",
                      backgroundColor: isActive
                        ? `color-mix(in srgb, ${filterAccent} ${
                            isLightTheme ? 7 : 18
                          }%, transparent)`
                        : "transparent",
                    }}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-[3px]"
                      style={{
                        backgroundColor: filterAccent,
                        opacity: isActive || selectedCount > 0 ? 1 : 0.45,
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {filter.label}
                    </span>
                    {selectedCount > 0 && (
                      <span
                        className="inline-flex min-w-[19px] items-center justify-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold"
                        style={{
                          color: filterAccent,
                          borderColor: `color-mix(in srgb, ${filterAccent} 45%, transparent)`,
                          backgroundColor: `color-mix(in srgb, ${filterAccent} ${
                            isLightTheme ? 8 : 20
                          }%, transparent)`,
                        }}
                      >
                        {selectedCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="hidden border-t border-theme-border p-3 md:block">
              <p className="mb-2 text-[11px] text-theme-text-muted">
                {activeFilterCount > 0
                  ? `${totalSelectedValues} selected across ${activeFilterCount} ${
                      activeFilterCount === 1 ? "group" : "groups"
                    }`
                  : "No filters applied yet"}
              </p>
              <button
                type="button"
                onClick={handleClear}
                disabled={activeFilterCount === 0}
                className="w-full rounded-lg border border-theme-border bg-theme-surface px-3 py-2 text-left text-[12px] font-medium text-theme-text-secondary transition-colors hover:bg-theme-card disabled:cursor-not-allowed disabled:opacity-45"
              >
                Clear all filters
              </button>
            </div>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {activeFilter ? (
              <>
                <div className="flex shrink-0 items-center gap-3 px-5 pb-3 pt-4 sm:px-6">
                  <span
                    className="h-8 w-1 shrink-0 rounded-full"
                    style={{ backgroundColor: activeAccent }}
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[15px] font-semibold text-theme-text">
                      {activeFilter.label}
                    </h3>
                    <p className="mt-0.5 truncate text-[12px] text-theme-text-secondary">
                      {activeFilter.description ||
                        activeFilter.meta ||
                        activePresentation.description}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-[12px] font-medium">
                    <button
                      type="button"
                      onClick={handleSelectAllActive}
                      disabled={activeOptions.length === 0}
                      className="transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
                      style={{ color: activeAccent }}
                    >
                      Select all
                    </button>
                    {activeSelectedCount > 0 && (
                      <button
                        type="button"
                        onClick={handleClearActive}
                        className="transition-opacity hover:opacity-70"
                        style={{ color: activeAccent }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                <div className="modal-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6">
                  <PopupErrorBoundary
                    key={activeFilter._id}
                    fallback={
                      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
                        This AI filter could not be rendered. Refresh once and
                        check the console if the issue continues.
                      </div>
                    }
                  >
                    {activeFilter._id === "ai_colors" ? (
                      <FocusedColorGrid
                        options={activeFilter.options}
                        selected={draftValues[activeFilter._id] || []}
                        onChange={(value) =>
                          handleDraftChange(activeFilter._id, value)
                        }
                        hue={activeAccent}
                        isLightTheme={isLightTheme}
                        shouldShowOption={shouldShowOption}
                      />
                    ) : activeFilter.type === "nested_select" ||
                      activeFilter.type === "nested_multiselect" ? (
                      <SchemaRenderer
                        document={activeDocument}
                        filterValues={draftValues}
                        onFilterChange={handleDraftChange}
                        shouldShowOption={shouldShowOption}
                        activePlatforms={activePlatforms}
                        noSection
                        layoutVariant="ai-focus"
                        isFilterRestricted={isFilterRestricted}
                        filterHasPlanEntry={filterHasPlanEntry}
                        onRestricted={onRestricted}
                      />
                    ) : (
                      <FocusedOptionGrid
                        filter={activeFilter}
                        selected={draftValues[activeFilter._id] || []}
                        onChange={(value) =>
                          handleDraftChange(activeFilter._id, value)
                        }
                        searchQuery={searchQuery}
                        onSearchChange={setSearchQuery}
                        hue={activeAccent}
                        isLightTheme={isLightTheme}
                        shouldShowOption={shouldShowOption}
                      />
                    )}
                  </PopupErrorBoundary>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-theme-text-muted">
                No AI filter groups are available.
              </div>
            )}
          </section>
        </div>

        {activeSelectionEntries.length > 0 && (
          <div className="flex max-h-[88px] shrink-0 items-start gap-3 overflow-y-auto border-t border-theme-border bg-theme-bg/30 px-5 py-2.5 sm:px-6">
            <span className="shrink-0 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-theme-text-muted">
              Active
            </span>
            <div className="flex flex-1 flex-wrap gap-1.5">
              {activeSelectionEntries.map((entry) => {
                const presentation =
                  AI_FILTER_PRESENTATION[entry.filter._id] ||
                  activePresentation;
                const chipAccent = presentationHue(
                  presentation,
                  isLightTheme,
                );
                return (
                  <span
                    key={`${entry.stateKey}:${entry.value}`}
                    className="inline-flex items-center gap-1.5 rounded-md border bg-theme-surface px-2 py-1 text-[11px] text-theme-text-secondary"
                    style={{
                      borderColor: `color-mix(in srgb, ${chipAccent} ${
                        isLightTheme ? 30 : 48
                      }%, transparent)`,
                    }}
                  >
                    <span className="opacity-60">{entry.group}</span>
                    <span className="opacity-30">/</span>
                    <span className="font-medium">{entry.label}</span>
                    <button
                      type="button"
                      onClick={() => removeSelection(entry)}
                      className="ml-0.5 opacity-55 transition-opacity hover:opacity-100"
                      aria-label={`Remove ${entry.group}: ${entry.label}`}
                    >
                      <X size={11} />
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2 border-t border-theme-border bg-theme-surface px-5 py-3 sm:px-6">
          <span className="hidden text-[12px] text-theme-text-muted sm:block">
            {totalSelectedValues > 0
              ? `${totalSelectedValues} ${
                  totalSelectedValues === 1 ? "selection" : "selections"
                } ready to apply`
              : `${visibleFilters.length} filter groups available`}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={closeAndForgetDraft}
            className="rounded-lg border border-theme-border bg-theme-bg px-4 py-2 text-[12px] font-semibold text-theme-text-secondary transition-colors hover:bg-theme-card"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!hasPendingChanges}
            className={`rounded-lg border px-4 py-2 text-[12px] font-semibold transition-colors ${
              hasPendingChanges
                ? "border-[#4f46e5] bg-[#4f46e5] text-white hover:bg-[#4338ca]"
                : "cursor-not-allowed border-theme-border bg-theme-bg text-theme-text-muted opacity-50"
            }`}
          >
            Apply{totalSelectedValues > 0 ? ` ${totalSelectedValues}` : ""}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AiSignalsModal;
