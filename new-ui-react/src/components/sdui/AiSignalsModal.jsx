import React, { useEffect } from "react";
import { X, Sparkles } from "lucide-react";
import SchemaRenderer from "./SchemaRenderer";
import { useTheme } from "../../hooks/useTheme";

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
  onFilterChange,
  shouldShowFilter,
  shouldShowOption,
  isDependencySatisfied,
  activePlatforms,
  isFilterRestricted,
  filterHasPlanEntry,
  onRestricted,
}) => {
  const { theme } = useTheme();
  const isLightTheme = theme === "light";

  useEffect(() => {
    if (!isOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !doc) return null;

  const filterCount = Array.isArray(doc.filters) ? doc.filters.length : 0;
  const displayTitle = "AI Filters";

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-4"
      onClick={onClose}
    >
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
            onClick={onClose}
            className="shrink-0 rounded-lg border border-theme-border bg-theme-bg p-2 text-theme-text-muted transition-colors hover:text-theme-text hover:border-theme-text/30"
            aria-label="Close AI Filters popup"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          <div className="rounded-xl border border-theme-border bg-theme-bg/40 p-3 sm:p-4">
            <SchemaRenderer
              document={doc}
              filterValues={filterValues}
              onFilterChange={onFilterChange}
              shouldShowFilter={shouldShowFilter}
              shouldShowOption={shouldShowOption}
              isDependencySatisfied={isDependencySatisfied}
              activePlatforms={activePlatforms}
              noSection
              isFilterRestricted={isFilterRestricted}
              filterHasPlanEntry={filterHasPlanEntry}
              onRestricted={onRestricted}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AiSignalsModal;
