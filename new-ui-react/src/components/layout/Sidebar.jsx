import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LayoutGrid, Library, Hash, TrendingUp, Menu, Bookmark } from "lucide-react";
import NavItem from "../shared/NavItem";
import SectionLabel from "../shared/SectionLabel";
import SidebarDivider from "../shared/SidebarDivider";
import SchemaRenderer from "../sdui/SchemaRenderer";
import AiSignalsModal from "../sdui/AiSignalsModal";

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
  onOpenKeywordsExplorer,
  searchIn = "keyword",
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

      <aside
        className={`${isOpen ? "w-56" : "w-16"} ${isOpen ? "fixed md:relative" : "relative"} inset-y-0 left-0 z-50 md:z-20 bg-theme-bg transition-all duration-300 flex-shrink-0 flex flex-col overflow-hidden`}
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
          {/* Nav */}
          <div className="flex items-center justify-between px-1">
            <SectionLabel label={t("explore")} collapsed={!isOpen} />
            <button
              onClick={() => setIsOpen(!isOpen)}
              className={`p-2 hover:bg-theme-text/[0.06] rounded-lg transition-colors text-theme-text-muted hover:text-theme-text ${!isOpen ? "w-full flex justify-center" : ""}`}
            >
              <Menu size={isOpen ? 18 : 20} />
            </button>
          </div>

          <div className="px-2 space-y-0.5 mb-1">
            <NavItem
              icon={<LayoutGrid size={isOpen ? 16 : 18} />}
              label={t("all_projects")}
              active={activePage === "projects"}
              onClick={() => {
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
              active={activePage === "ads" && !showSavedAdsPage}
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
                onClick={() => onPageChange?.("intelligence")}
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
          </div>

          {/* Only show filters on Ads Library page */}
          {activePage === "ads" && !showSavedAdsPage && isOpen && (
            <div className="flex flex-col flex-1 min-h-0">
              {<SidebarDivider />}
              {<SectionLabel label={t("filters")} />}

              {/* SDUI-driven Sidebar Filters */}
              <div className="flex-1 overflow-y-auto scrollbar-hide">
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
                            filterValues={filterValues}
                            onFilterChange={guestSetFilter}
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

              {/* Clear All */}
              {totalActiveFilters > 0 && (
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
        onApply={setAllFilters}
      />
    </>
  );
};

export default Sidebar;
