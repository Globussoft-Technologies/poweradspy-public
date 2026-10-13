import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LayoutGrid, Library, Hash, TrendingUp, Menu, Bookmark, X, Image as ImageIcon } from "lucide-react";
import NavItem from "../shared/NavItem";
import SectionLabel from "../shared/SectionLabel";
import SidebarDivider from "../shared/SidebarDivider";
import SchemaRenderer from "../sdui/SchemaRenderer";
import AiSignalsModal from "../sdui/AiSignalsModal";
import { useInstalledMobile } from "../../hooks/useInstalledMobile";

// Draft helpers for the installed-app filters sheet.
const COUNT_EXCLUDED_KEYS = new Set(["_autoSortField", "has_ai_meta", "sortDirection"]);
const isActiveValue = (v) =>
  Array.isArray(v) ? v.length > 0 : typeof v === "boolean" ? v : v !== null && v !== undefined && v !== "";
const countActiveFilters = (values) =>
  Object.entries(values || {}).filter(([key, v]) => !COUNT_EXCLUDED_KEYS.has(key) && isActiveValue(v)).length;
const sameFilters = (a, b) => {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  return [...keys].every((key) => key === "_autoSortField" || JSON.stringify(a?.[key]) === JSON.stringify(b?.[key]));
};

/**
 * Sidebar — Fully SDUI-driven.
 *
 * Reads `sduiConfig.sidebar` documents and renders each one via SchemaRenderer.
 * No hardcoded filter definitions — everything comes from the SDUI config.
 *
 * Falls back to a minimal "no filters" state if config is loading or empty.
 */
const Sidebar = ({
  isOpen,
  setIsOpen,
  sdui,
  onGenerateStrategy,
  activePage = "ads",
  onPageChange,
  isFilterRestricted,
  filterHasPlanEntry,
  onRestricted,
  canAccessProjects = false,
  projectsAccessResolved = true,
  projectsAccessUnavailable = false,
  intelligenceEnabled = false,
  intelligenceStage = null,
  keywordExplorerEnabled = false,
  guest,
  isLoggedIn = false,
  allowedPlatforms,
  showSavedAdsPage = false,
  onShowSavedAdsPage,
  showMySpacePage = false,
  showProfilePage = false,
  onShowMySpacePage,
  onOpenKeywordsExplorer,
  searchIn = "keyword",
  onClearFilters,
}) => {
  const AI_SIGNALS_OPEN_KEY = "sdui.aiSignals.open";
  const [aiSignalsOpen, setAiSignalsOpen] = useState(() => {
    try {
      return sessionStorage.getItem(AI_SIGNALS_OPEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const {
    config,
    loading,
    filterValues,
    setFilter,
    setAllFilters,
    clearAll,
    totalActiveFilters,
    shouldShowFilter,
    shouldShowOption,
    isDependencySatisfied,
    activePlatforms,
  } = sdui;

  // In guest mode, block filter changes — show pricing modal on public landing, toast otherwise
  const guestSetFilter = guest?.isRestricted
    ? () => onRestricted ? onRestricted() : guest.showGuestWarning("Please login to change filters")
    : setFilter;

  const guestClearAll = guest?.isRestricted
    ? () => onRestricted ? onRestricted() : guest.showGuestWarning("Please login to change filters")
    : clearAll;

  // Installed phone app: the filters sheet collects selections in a local draft
  // and applies them together with "Apply filters" (one search instead of one
  // per tap). Closing with ✕ / the backdrop discards the draft. The website
  // sidebar and restricted guests keep applying each change immediately.
  const isInstalledMobile = useInstalledMobile();
  const useDraft = isInstalledMobile && !guest?.isRestricted;
  const [draft, setDraft] = useState(null);
  useEffect(() => {
    setDraft(useDraft && isOpen ? { ...(filterValues || {}) } : null);
    // Snapshot only when the sheet opens; later live changes don't reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useDraft, isOpen]);
  const setDraftFilter = useCallback(
    (key, value) => setDraft((d) => ({ ...(d || {}), [key]: value })),
    [],
  );
  const sheetValues = draft ?? filterValues;
  const draftCount = useMemo(() => countActiveFilters(draft), [draft]);
  const draftDirty = Boolean(draft) && !sameFilters(draft, filterValues);
  const applyDraft = () => {
    if (draft) {
      if (countActiveFilters(draft) === 0) {
        clearAll();
      } else {
        // Same setter as a live tap, so analytics and the range auto-sort hint
        // behave exactly as before; React batches these into one search.
        const keys = new Set([...Object.keys(filterValues || {}), ...Object.keys(draft)]);
        keys.forEach((key) => {
          if (key === "_autoSortField") return;
          if (JSON.stringify(filterValues?.[key]) !== JSON.stringify(draft[key])) setFilter(key, draft[key]);
        });
      }
    }
    setIsOpen(false);
  };
  // "Clear all" in the sheet takes effect right away (the feed updates and the
  // sheet stays open) — it used to only empty the draft, so closing with ✕
  // left every filter applied. AI-search filters are cleared via the parent.
  const [justCleared, setJustCleared] = useState(false);
  useEffect(() => {
    if (!justCleared) return undefined;
    const t = setTimeout(() => setJustCleared(false), 1200);
    return () => clearTimeout(t);
  }, [justCleared]);
  const clearNow = () => {
    setDraft({});
    if (onClearFilters) onClearFilters();
    else clearAll();
    setJustCleared(true);
  };

  // The AI Signals popup applies live; fold what it changed into an open draft
  // so "Apply filters" doesn't roll it back.
  const applyAiSignals = (next, analytics) => {
    setAllFilters(next, analytics);
    setDraft((d) => {
      if (!d) return d;
      const merged = { ...d };
      new Set([...Object.keys(next || {}), ...Object.keys(filterValues || {})]).forEach((key) => {
        if (JSON.stringify(next?.[key]) !== JSON.stringify(filterValues?.[key])) merged[key] = next?.[key];
      });
      return merged;
    });
  };

  const { t } = useTranslation();
  const sidebarDocs = config?.sidebar || [];
  const hasGooglePlatform = activePlatforms.some(
    (platform) => String(platform).trim().toLowerCase() === "google",
  );
  const aiSignalsDoc = useMemo(
    () => sidebarDocs.find((doc) => doc._id === "ai_meta") || null,
    [sidebarDocs],
  );
  const aiSignalsRestricted = Boolean(isFilterRestricted?.("ai_meta"));
  const sidebarBudgetRestricted = Boolean(isFilterRestricted?.("sidebar_budget"));

  // Keep the disabled Sidebar Budget control discoverable. Its SDUI
  // applicability is TikTok-only, but a plan can disable TikTok and/or this
  // capability; hiding it at the platform-visibility layer then makes the
  // upgrade path disappear completely. SchemaRenderer still owns the click
  // guard, so the restricted value cannot be applied or reach the search API.
  const shouldShowPlanAwareFilter = useCallback((item) => {
    const id = item?._id;
    if (
      sidebarBudgetRestricted &&
      (id === "sidebar_budget" || id === "budget_filter")
    ) {
      return true;
    }
    return shouldShowFilter?.(item) ?? true;
  }, [shouldShowFilter, sidebarBudgetRestricted]);

  const openAiSignals = () => {
    if (guest?.isRestricted || aiSignalsRestricted) {
      onRestricted?.();
      return;
    }
    setAiSignalsOpen(true);
  };

  useEffect(() => {
    if (aiSignalsRestricted && aiSignalsOpen) setAiSignalsOpen(false);
  }, [aiSignalsOpen, aiSignalsRestricted]);

  useEffect(() => {
    if (!aiSignalsRestricted) return;
    const aiKeys = [
      "has_ai_meta", "ai_ad_type", "ai_intent", "ai_hook",
      "ai_offering_type", "ai_offer_type", "ai_colors",
      "ai_category_id", "ai_subcategory_id",
    ];
    if (!aiKeys.some((key) => filterValues?.[key] !== undefined)) return;
    const next = { ...(filterValues || {}) };
    aiKeys.forEach((key) => delete next[key]);
    setAllFilters(next);
  }, [aiSignalsRestricted, filterValues, setAllFilters]);

  useEffect(() => {
    if (!sidebarBudgetRestricted) return;
    // Do not clear the generic/numeric Ad Budget value here. This gate owns
    // only the TikTok Low/Medium/High Sidebar Budget control.
    const budgetKeys = ["budget_filter", "sidebar_budget"];
    if (!budgetKeys.some((key) => filterValues?.[key] !== undefined)) return;
    const next = { ...(filterValues || {}) };
    budgetKeys.forEach((key) => delete next[key]);
    setAllFilters(next);
  }, [filterValues, setAllFilters, sidebarBudgetRestricted]);

  useEffect(() => {
    try {
      if (aiSignalsOpen) sessionStorage.setItem(AI_SIGNALS_OPEN_KEY, "1");
      else sessionStorage.removeItem(AI_SIGNALS_OPEN_KEY);
    } catch {}
  }, [aiSignalsOpen]);

  return (
    <>
      {/* Mobile backdrop overlay — only when sidebar is open on small screens */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[45] md:hidden transition-opacity"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Installed phone app (pwa:): navigation lives in BottomNav, so the
          collapsed icon strip is hidden and the open sidebar becomes a
          filters-only bottom sheet (opened from BottomNav's "Filters" tab). */}
      <aside
        className={`${isOpen ? "w-56" : "w-16 pwa:hidden"} ${isOpen ? "fixed md:relative" : "relative"} inset-y-0 left-0 z-50 md:z-20 bg-theme-bg transition-[width] duration-300 flex-shrink-0 flex flex-col overflow-hidden pwa:inset-x-0 pwa:top-auto pwa:bottom-0 pwa:w-full pwa:h-[72dvh] pwa:z-[60] pwa:rounded-t-[24px] pwa:border-t pwa:border-theme-border pwa:shadow-2xl pwa:pb-[env(safe-area-inset-bottom)]`}
      >
        {/* Fading Gradient Border */}
        <div
          className="absolute right-0 inset-y-0 w-[1px] pointer-events-none z-10 opacity-60"
          style={{
            background:
              "linear-gradient(to bottom, transparent, rgba(255,255,255,0.15) 15%, rgba(255,255,255,0.4) 50%, rgba(255,255,255,0.2) 70%, rgba(255,255,255,0.15) 85%, transparent)",
          }}
        />

        <div className="flex-1 py-2 flex flex-col min-h-0">
          {/* Bottom-sheet header (installed phone app only) */}
          <div className="hidden pwa:flex flex-col items-center px-4 pb-2 border-b border-theme-border">
            <span className="mb-2 h-1 w-10 rounded-full bg-theme-text-muted/40" />
            <div className="flex w-full items-center justify-between">
              <span className="flex items-center gap-2 text-base font-bold text-theme-text">
                {t("filters")}
                {draft && draftCount > 0 && (
                  <span className="rounded-full bg-[#335296]/10 px-2 py-0.5 text-[11px] font-bold text-[#335296] dark:text-[#8fb0ff]">
                    {draftCount} selected
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close filters"
                className="p-2 -mr-2 rounded-lg text-theme-text-muted"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Nav */}
          <div className="flex items-center justify-between px-1 pwa:hidden">
            <SectionLabel label={t("explore")} collapsed={!isOpen} />
            <button
              onClick={() => setIsOpen(!isOpen)}
              className={`p-2 hover:bg-theme-text/[0.06] rounded-lg transition-colors text-theme-text-muted hover:text-theme-text ${!isOpen ? "w-full flex justify-center" : ""}`}
            >
              <Menu size={18} />
            </button>
          </div>

          <div className="px-2 space-y-0.5 mb-1 pwa:hidden">
            <NavItem
              icon={<LayoutGrid size={isOpen ? 16 : 18} />}
              label={t("all_projects")}
              active={activePage === "projects"}
              onClick={() => {
                if (guest?.isRestricted) {
                  onRestricted?.();
                  return;
                }
                // Loading/missing access data is not a subscription denial.
                // Navigate to the neutral Projects state and let App resolve it.
                if (!projectsAccessResolved || projectsAccessUnavailable) {
                  onPageChange?.("projects");
                } else if (!canAccessProjects) {
                  onRestricted?.();
                } else {
                  onPageChange?.("projects");
                }
              }}
              collapsed={!isOpen}
            />
            <NavItem
              icon={<Library size={isOpen ? 16 : 18} />}
              label={t("ads_library")}
              active={activePage === "ads" && !showSavedAdsPage && !showMySpacePage && !showProfilePage}
              onClick={() => onPageChange?.("ads")}
              collapsed={!isOpen}
            />
            {/* Market Trends — shown whenever the feature is globally live
                (intelligenceEnabled = the env flag only, PRD FR-17: "not a hard
                removal" for lower tiers — clicking through shows a locked preview
                with an upgrade CTA instead of hiding the tab). BETA badge while
                config.pricing/market_trends' `stage` is "beta" (see marketTrends.js). */}
            {intelligenceEnabled && (
              <NavItem
                icon={<TrendingUp size={isOpen ? 16 : 18} />}
                label={t("market_trends", "Market Trends")}
                active={activePage === "intelligence"}
                onClick={() => {
                  if (guest?.isRestricted) {
                    onRestricted?.();
                    return;
                  }
                  onPageChange?.("intelligence");
                }}
                collapsed={!isOpen}
                badge={intelligenceStage === "beta" ? "Beta" : null}
              />
            )}
            {/* Keywords Explorer — shown whenever the feature is globally live
                (keywordExplorerEnabled = the env flag only, same "not a hard
                removal" pattern as Market Trends above — a locked preview shows
                if the account isn't allow-listed, the tab itself never hides).
                Still in beta for every account today. */}
            {keywordExplorerEnabled && (
              <NavItem
                icon={<Hash size={isOpen ? 16 : 18} />}
                label={t("keywords_explorer")}
                active={activePage === "keywords-explorer"}
                onClick={() => onOpenKeywordsExplorer?.()}
                collapsed={!isOpen}
                badge="Beta"
              />
            )}
            {isLoggedIn && (allowedPlatforms == null || allowedPlatforms.length > 0) && (
              <NavItem
                icon={<Bookmark size={isOpen ? 16 : 18} />}
                label={t("saved_hidden_ads")}
                active={showSavedAdsPage}
                onClick={() => onShowSavedAdsPage?.()}
                collapsed={!isOpen}
              />
            )}
            {/* onShowMySpacePage is only passed when the user has AI Recreate access */}
            {isLoggedIn && onShowMySpacePage && (
              <NavItem
                icon={<ImageIcon size={isOpen ? 16 : 18} />}
                label="MySpace"
                active={showMySpacePage}
                onClick={() => onShowMySpacePage?.()}
                collapsed={!isOpen}
                badge="New"
              />
            )}
          </div>

          {/* Only show filters on Ads Library page */}
          {activePage === "ads" && !showSavedAdsPage && !showMySpacePage && !showProfilePage && isOpen && (
            <div className="flex flex-col flex-1 min-h-0">
              <div className="pwa:hidden">
                <SidebarDivider />
                <SectionLabel label={t("filters")} />
              </div>

              {/* SDUI-driven Sidebar Filters — visible scrollbar in the phone sheet */}
              <div className="flex-1 overflow-y-auto scrollbar-hide pwa-scrollbar pwa:pt-2">

                {loading ? (
                  <div className="px-3 py-4 text-[10px] text-theme-text-muted">
                    {t("loading_filters")}
                  </div>
                ) : sidebarDocs.length > 0 ? (
                  sidebarDocs
                    .filter((doc) => {
                      if (!shouldShowPlanAwareFilter(doc)) return false;
                      if (doc._id === "google_transparency" && !hasGooglePlatform) {
                        return false;
                      }
                      // Hide the category filter when not in keyword search mode
                      // if (searchIn !== "keyword") {
                      //   const isCategoryDoc =
                      //     doc._id === "category" ||
                      //     doc.filters?.some(
                      //       (f) =>
                      //         f.group_id === "category" ||
                      //         f.query_param === "category",
                      //     );
                      //   if (isCategoryDoc) return false;
                      // }
                      return true;
                    })
                    .map((doc, idx, visible) => {
                      return (
                        <React.Fragment key={doc._id}>
                          <SchemaRenderer
                            document={doc}
                            filterValues={sheetValues}
                            onFilterChange={draft ? setDraftFilter : guestSetFilter}
                            onDocumentClick={
                              doc._id === "ai_meta" ? openAiSignals : undefined
                            }
                            shouldShowFilter={shouldShowPlanAwareFilter}
                            shouldShowOption={
                              sidebarBudgetRestricted && doc._id === "sidebar_budget"
                                ? () => true
                                : shouldShowOption
                            }
                            isDependencySatisfied={isDependencySatisfied}
                            activePlatforms={activePlatforms}
                            isFilterRestricted={isFilterRestricted}
                            filterHasPlanEntry={filterHasPlanEntry}
                            onRestricted={onRestricted}
                            guest={guest}
                          />
                          {idx < visible.length - 1 && <SidebarDivider />}
                        </React.Fragment>
                      );
                    })
                ) : (
                  <div className="px-3 py-4 text-[10px] text-theme-text-muted">
                    {t("no_filters_configured")}
                  </div>
                )}
              </div>

              {/* Installed phone app: Clear all + Apply, pinned under the list.
                  Apply sends the draft as one search and closes the sheet. */}
              {draft && (
                <div className="hidden pwa:flex items-center gap-3 border-t border-theme-border bg-theme-bg px-4 pt-3 pb-2">
                  <button
                    type="button"
                    onClick={clearNow}
                    disabled={draftCount === 0 && totalActiveFilters === 0 && !justCleared}
                    className={`h-11 shrink-0 rounded-xl border px-4 text-[13px] font-semibold transition-colors active:scale-[0.97] disabled:opacity-40 ${
                      justCleared ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : "border-theme-border text-theme-text-secondary"
                    }`}
                  >
                    {justCleared ? "✓ Cleared" : "Clear all"}
                  </button>
                  <button
                    type="button"
                    onClick={applyDraft}
                    className="h-11 flex-1 rounded-xl bg-[#335296] text-[14px] font-bold text-white shadow-md transition-transform active:scale-[0.98]"
                  >
                    {draftDirty
                      ? `Apply filters${draftCount > 0 ? ` · ${draftCount}` : ""}`
                      : "Done"}
                  </button>
                </div>
              )}

              {/* Clear All (website, and restricted guests in the app) */}
              {totalActiveFilters > 0 && !draft && (
                <div className="px-3 py-4">
                  <button
                    onClick={guestClearAll}
                    className="w-full text-[10px] text-theme-text-muted hover:text-red-400 transition-colors border border-theme-border rounded-lg py-1.5 hover:border-red-500/20"
                  >
                    {totalActiveFilters === 1 ? t("clear_x_filters", { count: totalActiveFilters }) : t("clear_x_filters_plural", { count: totalActiveFilters })}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
      <AiSignalsModal
        isOpen={aiSignalsOpen && !aiSignalsRestricted}
        document={aiSignalsDoc}
        filterValues={filterValues}
        onClose={() => setAiSignalsOpen(false)}
        shouldShowFilter={shouldShowFilter}
        shouldShowOption={shouldShowOption}
        isDependencySatisfied={isDependencySatisfied}
        activePlatforms={activePlatforms}
        isFilterRestricted={isFilterRestricted}
        filterHasPlanEntry={filterHasPlanEntry}
        onRestricted={onRestricted}
        onApply={applyAiSignals}
      />
    </>
  );
};

export default Sidebar;
