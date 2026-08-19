import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Briefcase,
  Check,
  Download,
  Gem,
  MapPin,
  RotateCcw,
  Smartphone,
  Tag,
  Zap,
} from "lucide-react";
import {
  discardAiFilterDraft,
  findActiveAiQuickFilterPreset,
  hasActiveAiFilters,
  replaceAiFilters,
  resolveAiQuickFilterPresets,
} from "../../utils/aiQuickFilterPresets";
import { buildSearchPayload, fetchAiQuickFilterAvailability } from "../../services/api";

const PRESET_ICONS = {
  tiktok_ugc: Smartphone,
  b2b_saas: BarChart3,
  flash_sale: Zap,
  luxury_brand: Gem,
  app_install: Download,
  black_friday: Tag,
  high_ticket: Briefcase,
  local_lead: MapPin,
};

const PRESET_ACCENTS = {
  tiktok_ugc: "text-pink-500 bg-pink-500/10 border-pink-500/20",
  b2b_saas: "text-blue-500 bg-blue-500/10 border-blue-500/20",
  flash_sale: "text-amber-500 bg-amber-500/10 border-amber-500/20",
  luxury_brand: "text-violet-500 bg-violet-500/10 border-violet-500/20",
  app_install: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
  black_friday: "text-rose-500 bg-rose-500/10 border-rose-500/20",
  high_ticket: "text-cyan-500 bg-cyan-500/10 border-cyan-500/20",
  local_lead: "text-indigo-500 bg-indigo-500/10 border-indigo-500/20",
};

/**
 * Home-page shortcuts for coherent AI filter combinations. They commit through
 * the same SDUI state used by the popup, so both surfaces always stay in sync.
 */
const AiQuickFilters = ({
  document: doc,
  filterValues,
  onApply,
  isRestricted,
  onRestricted,
  activePlatforms,
  searchQuery,
  searchIn,
  exactSearch,
  filterPlatformSupport,
}) => {
  const presets = useMemo(() => resolveAiQuickFilterPresets(doc), [doc]);
  // `null` means that the batch probe has not answered for this search context.
  // An empty object is a completed response where no preset is eligible.
  const [presetAvailability, setPresetAvailability] = useState(null);

  const activePreset = findActiveAiQuickFilterPreset(
    filterValues,
    doc,
    presets,
  );
  const hasAiFilters = hasActiveAiFilters(filterValues, doc);

  useEffect(() => {
    if (isRestricted || !doc || doc.visible === false || presets.length === 0) {
      setPresetAvailability(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const evaluatePresets = async () => {
      const presetPayload = presets.map((preset) => ({
        id: preset.id,
        payload: buildSearchPayload({
          // Availability is network/search scoped. Normal sidebar filters are
          // intentionally excluded so changing their order cannot change which
          // quick-filter controls exist; they remain preserved by commit().
          ...replaceAiFilters({}, doc, preset.filters),
          activePlatforms,
          searchQuery,
          searchIn,
          exactSearch,
          filterPlatformSupport,
        }),
      }));

      const result = await fetchAiQuickFilterAvailability(
        { presets: presetPayload },
        { signal: controller.signal },
      );

      if (cancelled) return;
      setPresetAvailability(
        result?.availability && typeof result.availability === "object"
          ? result.availability
          : {},
      );
    };

    evaluatePresets().catch(() => {
      if (!cancelled) setPresetAvailability({});
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    doc,
    presets,
    activePlatforms,
    searchQuery,
    searchIn,
    exactSearch,
    filterPlatformSupport,
    isRestricted,
  ]);

  if (!doc || doc.visible === false || presets.length === 0) return null;

  // Never treat a missing availability value as eligible. It previously made a
  // failed or empty batch response render every quick filter. Retain an already
  // active preset so the user can see and reset the filter they have applied.
  const visiblePresets = presets.filter((preset) => {
    // Restricted users need an actionable shortcut that opens the upgrade flow.
    // They cannot execute a search, so availability cannot be safely probed.
    if (isRestricted) return true;
    return presetAvailability?.[preset.id] === true || activePreset?.id === preset.id;
  });
  if (visiblePresets.length === 0) return null;

  const commit = (replacement, presetId = null) => {
    if (isRestricted) {
      onRestricted?.();
      return;
    }
    discardAiFilterDraft();
    onApply?.(
      replaceAiFilters(filterValues, doc, replacement),
      presetId
        ? {
            filterName: `quick_filter_${presetId}`,
            entryPoint: "quick_filters",
          }
        : null,
    );
  };

  return (
    <section
      className="mx-3 mt-3 flex min-w-0 items-center gap-3 rounded-xl border border-theme-border bg-theme-card px-3 py-2 shadow-sm"
      aria-label="AI strategy quick filters"
    >
      <div className="hidden w-[118px] shrink-0 border-r border-theme-border pr-3 sm:block">
        <p className="text-[11px] font-bold text-theme-text">Quick Filters</p>
        <p className="mt-0.5 text-[9px] leading-3 text-theme-text-muted">
          Apply an AI strategy in one click
        </p>
      </div>

      <div className="scrollbar-hide flex min-w-0 flex-1 items-stretch gap-2 overflow-x-auto py-0.5">
        {visiblePresets.map((preset) => {
          const Icon = PRESET_ICONS[preset.id] || Zap;
          const isActive = activePreset?.id === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => commit(preset.filters, preset.id)}
              className={`group relative flex min-w-[136px] shrink-0 items-center gap-2 rounded-lg border py-2 pl-2.5 pr-7 text-left transition-all ${
                isActive
                  ? "border-[#6b99ff] bg-[#3762c1]/12 shadow-[0_0_0_1px_rgba(107,153,255,0.15)]"
                  : "border-theme-border bg-theme-bg hover:border-[#6b99ff]/45 hover:bg-theme-text/[0.025]"
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${
                  PRESET_ACCENTS[preset.id]
                }`}
              >
                <Icon size={14} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-semibold text-theme-text">
                  {preset.label}
                </span>
                <span className="block truncate text-[8px] font-semibold uppercase tracking-[0.1em] text-theme-text-muted">
                  {preset.tag}
                </span>
              </span>
              {isActive && (
                <span className="absolute right-1.5 top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#3762c1] text-white">
                  <Check size={9} strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => commit({})}
        disabled={!hasAiFilters}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-semibold text-[#6b99ff] transition-colors hover:bg-[#3762c1]/10 disabled:cursor-not-allowed disabled:opacity-35"
        title="Clear all AI filters"
      >
        <RotateCcw size={11} />
        <span className="hidden lg:inline">Reset</span>
      </button>
    </section>
  );
};

export default AiQuickFilters;
