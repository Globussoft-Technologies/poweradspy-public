import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, Sparkles } from "lucide-react";
import SchemaRenderer from "./SchemaRenderer";
import { useTheme } from "../../hooks/useTheme";

const AI_SIGNALS_DRAFT_KEY = "sdui.aiSignals.draft";
const AI_SIGNALS_OPEN_KEY = "sdui.aiSignals.open";

const readDraft = (fallback = null) => {
  try {
    const raw = sessionStorage.getItem(AI_SIGNALS_DRAFT_KEY);
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
  const { theme } = useTheme();
  const isLightTheme = theme === "light";
  const filterKeys = useMemo(
    () => (Array.isArray(doc?.filters) ? doc.filters.map((filter) => filter?._id).filter(Boolean) : []),
    [doc],
  );
  const [draftValues, setDraftValues] = useState(() =>
    buildDraftFromValues(readDraft(filterValues || {}), filterKeys),
  );
  const wasOpenRef = useRef(false);

  const draftSnapshot = useMemo(
    () => serializeAiSubset(draftValues, filterKeys),
    [draftValues, filterKeys],
  );
  const liveSnapshot = useMemo(
    () => serializeAiSubset(filterValues || {}, filterKeys),
    [filterValues, filterKeys],
  );
  const hasPendingChanges = draftSnapshot !== liveSnapshot;

  const handleDraftChange = (filterId, value) => {
    setDraftValues((prev) => {
      const next = { ...prev };
      if (isEmptyFilterValue(value)) delete next[filterId];
      else next[filterId] = value;
      return next;
    });
  };

  const closeAndForgetDraft = () => {
    try {
      sessionStorage.removeItem(AI_SIGNALS_DRAFT_KEY);
      sessionStorage.removeItem(AI_SIGNALS_OPEN_KEY);
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
      onApply(next);
    }
    closeAndForgetDraft();
  };

  const handleClear = () => {
    // Keep Clear as an in-popup draft reset so users can review the empty state
    // before committing it with Apply.
    setDraftValues({});
  };

  const handleApply = () => {
    if (!hasPendingChanges) return;
    commitDraft(draftValues);
  };

  useEffect(() => {
    try {
      sessionStorage.setItem(AI_SIGNALS_DRAFT_KEY, JSON.stringify(draftValues || {}));
    } catch {}
  }, [draftValues]);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }

    let hasStoredDraft = false;
    try {
      hasStoredDraft = sessionStorage.getItem(AI_SIGNALS_DRAFT_KEY) != null;
      sessionStorage.setItem(AI_SIGNALS_OPEN_KEY, "1");
    } catch {}

    if (!wasOpenRef.current && !hasStoredDraft) {
      setDraftValues(buildDraftFromValues(filterValues || {}, filterKeys));
    }
    wasOpenRef.current = true;
  }, [isOpen, filterValues, filterKeys]);

  if (!isOpen || !doc) return null;

  const filterCount = Array.isArray(doc.filters) ? doc.filters.length : 0;
  const displayTitle = "AI Filters";

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-4">
      <div
        className="w-full max-w-5xl max-h-[92vh] overflow-hidden rounded-2xl border border-theme-border bg-theme-surface shadow-2xl flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-theme-border px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] ${
                  isLightTheme
                    ? "border-[#3762c1]/20 bg-[#3762c1]/10 text-[#335296]"
                    : "border-[#f5c86a]/40 bg-[#f5c86a]/10 text-[#f5c86a]"
                }`}
              >
                <Sparkles size={10} />
                New
              </span>
            </div>
            <h2 className="mt-1 text-2xl font-bold text-theme-text">{displayTitle}</h2>
            <p className="mt-1 text-sm text-theme-text-secondary">
              {filterCount ? `${filterCount} filters available.` : "No filters found."}
            </p>
          </div>

          <button
            type="button"
            onClick={closeAndForgetDraft}
            className="shrink-0 rounded-lg border border-theme-border bg-theme-bg p-2 text-theme-text-muted transition-colors hover:text-theme-text hover:border-theme-text/30"
            aria-label="Close AI Filters popup"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3">
          <button
            type="button"
            onClick={handleClear}
            className="rounded-md border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-red-300 transition-colors hover:border-red-400/40 hover:bg-red-500/15 hover:text-red-200"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!hasPendingChanges}
            className={`rounded-md border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors ${
              hasPendingChanges
                ? "border-[#3759a3]/30 bg-[#3762c1] text-white hover:bg-[#335296]"
                : "cursor-not-allowed border-[#3759a3]/15 bg-[#3762c1]/35 text-white/50"
            }`}
          >
            Apply
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          <div className="rounded-xl border border-theme-border bg-theme-bg/40 p-3 sm:p-4">
            <PopupErrorBoundary
              fallback={
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-200">
                  AI Filters could not be rendered. Please refresh once; if it keeps happening, the console will show the failing filter.
                </div>
              }
            >
              <SchemaRenderer
                document={doc}
                filterValues={draftValues}
                onFilterChange={handleDraftChange}
                shouldShowFilter={shouldShowFilter}
                shouldShowOption={shouldShowOption}
                isDependencySatisfied={isDependencySatisfied}
                activePlatforms={activePlatforms}
                noSection
                isFilterRestricted={isFilterRestricted}
                filterHasPlanEntry={filterHasPlanEntry}
                onRestricted={onRestricted}
              />
            </PopupErrorBoundary>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AiSignalsModal;
