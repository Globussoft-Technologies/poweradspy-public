import React, { useMemo, useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Check, Filter, SlidersHorizontal, Smartphone } from "lucide-react";
import PlatformTab from "../shared/PlatformTab";
import AdDateDropdown from "./AdDateDropdown";
import { PLATFORMS } from "../../constants";
import { trackEvent } from "../../services/api";
import { getNetworkContext, trackAdAction } from "../../utils/googleAnalytics";

// Maps SDUI sort labels/values to the stable Plan Control/legacy access ID.
const SORT_TO_PLAN_ACCESS_ID = {
  newest: 'newest_sort',
  newest_sort: 'newest_sort',
  likes: 'likes_sort',
  like: 'likes_sort',
  like_sort: 'likes_sort',
  likes_sort: 'likes_sort',
  comments: 'comments_sort',
  comment: 'comments_sort',
  comment_sort: 'comments_sort',
  comments_sort: 'comments_sort',
  shares: 'shares_sort',
  share: 'shares_sort',
  share_sort: 'shares_sort',
  shares_sort: 'shares_sort',
  impressions: 'impression_sort',
  impression: 'impression_sort',
  impression_sort: 'impression_sort',
  popularity: 'popularity_sort',
  popularity_sort: 'popularity_sort',
  'ad running days': 'ad_running_days_sort',
  ad_running_days: 'ad_running_days_sort',
  ad_running_days_sort: 'ad_running_days_sort',
  running_longest: 'ad_running_days_sort',
  // AdMob Poster Intelligence sort options are temporarily free for all plans.
  lead_score: 'admob_poster_intelligence',
  occurrence_count: 'admob_poster_intelligence',
  days_running: 'admob_poster_intelligence',
  'domain registration date': 'domain_reg_sort',
  domain_reg: 'domain_reg_sort',
  domain_reg_sort: 'domain_reg_sort',
};
// added as fallback for the ad_types 
const ADMOB_AD_TYPE_OPTIONS = [
  { label: "Banner", value: "BANNER" },
  { label: "Webview Banner", value: "WEBVIEW_BANNER" },
  { label: "Interstitial Or Native", value: "INTERSTITIAL_OR_NATIVE" },
  { label: "Interstitial Webview", value: "INTERSTITIAL_WEBVIEW" },
  { label: "Native Or Unknown", value: "NATIVE_OR_UNKNOWN" },
  { label: "Rewarded Or Video", value: "REWARDED_OR_VIDEO" },
  { label: "Play Store Ad", value: "PLAY_STORE_AD" },
  { label: "Visual Banner", value: "VISUAL_BANNER" },
  { label: "Visual Native Ad", value: "VISUAL_NATIVE_AD" },
];

export const resolveSortPlanAccessId = (label, value) => {
  const normalize = (input) => String(input ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  const rawLabel = String(label ?? '').toLowerCase().trim();
  return SORT_TO_PLAN_ACCESS_ID[normalize(value)] ||
    SORT_TO_PLAN_ACCESS_ID[normalize(label)] ||
    SORT_TO_PLAN_ACCESS_ID[rawLabel] ||
    null;
};

const SORT_VALUE_ALIASES = {
  newest: "created_at",
  newest_sort: "created_at",
  post_date: "created_at",
  "-created_at": "created_at",
  popular: "popularity_score",
  popularity: "popularity_score",
  "-popularity_score": "popularity_score",
  impression: "impressions",
  "-impressions": "impressions",
  "ad running days": "running_days",
  "running longest": "running_days",
  "days running": "running_days",
  running_longest: "running_days",
  days_running: "running_days",
  "-running_days": "running_days",
  "domain registration date": "domain_reg_date",
  "domain reg date": "domain_reg_date",
  domain_sort: "domain_reg_date",
  domain_reg_sort: "domain_reg_date",
  "-domain_reg_date": "domain_reg_date",
};

const normalizeSortValue = (value) => {
  const normalized = String(value ?? "").toLowerCase().trim();
  return SORT_VALUE_ALIASES[normalized] || normalized.replace(/[\s-]+/g, "_");
};

export const resolveActiveSortLabel = (sortTabs = [], sortBy) => {
  const selectedValue = normalizeSortValue(sortBy);
  if (!selectedValue) return "";
  const match = sortTabs.find((tab) =>
    normalizeSortValue(tab?.value ?? tab?.label ?? tab) === selectedValue ||
    normalizeSortValue(tab?.label ?? tab) === selectedValue
  );
  return match?.label ?? match ?? "";
};

/**
 * AdFilterBar - Consolidates all ad-level controls:
 * 1. Platform Tabs (with horizontal scroll)
 * 2. Date Filter
 * 3. Sort Filter
 * 4. Original Preview Toggle
 */
const AdFilterBar = ({
  sdui,
  platformOptions = [],
  specificPlatforms = [],
  handleAllClick,
  handlePlatformClick,
  isAllActive,
  activeTab,
  setActiveTab,
  previewMode,
  setPreviewMode,
  sortTabs = [],
  onDateChange,
  isFilterRestricted,
  onDateRestricted,
  onSortRestricted,
  onAdTypeRestricted,
  className = "",
  showOriginalOnMobile = true,
  showPlatformsOnMobile = true,
  isScrolled = false,
  disableTooltips = false,
  guest,
}) => {
  const { t } = useTranslation();
  const { config, activePlatforms, selAdTypes, setSelAdTypes } = sdui;

  // Ad type filter dropdown state (owned here, not lifted to AdGrid)
  const [showAdTypeFilter, setShowAdTypeFilter] = useState(false);
  const adTypeFilterRef = useRef(null);

  // Entitlements can refresh after the filter was selected (login, plan change,
  // or policy publish). Never retain a now-denied value in search state.
  useEffect(() => {
    if (!isFilterRestricted?.("ad_type") || !(selAdTypes || []).length) return;
    setSelAdTypes([]);
    setShowAdTypeFilter(false);
  }, [isFilterRestricted, selAdTypes, setSelAdTypes]);

  useEffect(() => {
    if (!showAdTypeFilter) return;
    const handler = (e) => {
      if (
        adTypeFilterRef.current &&
        !adTypeFilterRef.current.contains(e.target)
      )
        setShowAdTypeFilter(false);
    };
    const onScroll = (event) => {
      const target = event.target;
      if (target instanceof Node && adTypeFilterRef.current?.contains(target)) return;
      setShowAdTypeFilter(false);
    };
    document.addEventListener("mousedown", handler);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", handler);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [showAdTypeFilter]);

  // Sort dropdown state (owned here, not lifted to AdGrid)
  const [showMoreTabs, setShowMoreTabs] = useState(false);
  const moreTabsRef = useRef(null);

  useEffect(() => {
    if (!showMoreTabs) return;
    const handler = (e) => {
      if (moreTabsRef.current && !moreTabsRef.current.contains(e.target))
        setShowMoreTabs(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMoreTabs]);

  // Sort tooltip state
  const [showSortTip, setShowSortTip] = useState(false);
  const [sortTipPos, setSortTipPos] = useState({ x: 0, y: 0 });
  const sortBtnRef = useRef(null);

  const handleSortMouseEnter = () => {
    const rect = sortBtnRef.current?.getBoundingClientRect();
    if (rect) {
      setSortTipPos({ x: rect.left + rect.width / 2, y: rect.top - 6 });
    }
    setShowSortTip(true);
  };

  // Filter tooltip state
  const [showFilterTip, setShowFilterTip] = useState(false);
  const [filterTipPos, setFilterTipPos] = useState({ x: 0, y: 0 });
  const filterBtnRef = useRef(null);

  const handleFilterMouseEnter = () => {
    const rect = filterBtnRef.current?.getBoundingClientRect();
    if (rect) {
      setFilterTipPos({ x: rect.left + rect.width / 2, y: rect.top - 6 });
    }
    setShowFilterTip(true);
  };

  const activeLower = useMemo(() => (activePlatforms || [])
    .map((platform) => String(platform).trim().toLowerCase())
    .filter(Boolean), [activePlatforms]);
  const isAdmobOnly = activeLower.length === 1 && activeLower[0] === "admob";

  const AD_TYPE_OPTIONS = useMemo(() => {
    const isWildcardApplicability = (applicability) => {
      if (!applicability) return true;
      if (!Array.isArray(applicability) && String(applicability).trim().toLowerCase() === "all") {
        return true;
      }
      return Array.isArray(applicability) &&
        applicability.some((platform) => String(platform).trim().toLowerCase() === "all");
    };

    const matchesActivePlatforms = (applicability) => {
      if (isWildcardApplicability(applicability)) return true;
      const values = (Array.isArray(applicability) ? applicability : [applicability])
        .map((platform) => String(platform).trim().toLowerCase())
        .filter(Boolean);
      if (values.length === 0) return false;
      if (activeLower.length === 0) return true;
      return values.some((platform) => activeLower.includes(platform));
    };

    const shouldShowAdTypeFilter = (filter) => {
      if (!filter) return false;
      if (typeof sdui.shouldShowFilter === "function") {
        return sdui.shouldShowFilter(filter);
      }
      return matchesActivePlatforms(filter.platform_applicability);
    };

    const shouldShowAdTypeOption = (option) => {
      if (!option) return false;
      if (typeof sdui.shouldShowOption === "function") {
        return sdui.shouldShowOption(option);
      }
      if (matchesActivePlatforms(option.platform_applicability)) return true;
      const nestedOptions = option.children || option.sub_options || option.options;
      return Array.isArray(nestedOptions) &&
        nestedOptions.some((child) => shouldShowAdTypeOption(child));
    };

    const isAdTypeFilter = (filter) =>
      filter?._id === "ad_types" ||
      filter?._id === "ad_type_filter" ||
      filter?._id === "ad_type" ||
      filter?.query_param === "ad_type" ||
      filter?.group_id === "ad_type";
    // Search all sections (sidebar + navbar) for the authoritative ad_type filter.
    const allDocs = [...(config?.sidebar || []), ...(config?.navbar || [])];
    let adTypeFilter = null;
    for (const doc of allDocs) {
      const f = (doc.filters || []).find(isAdTypeFilter);
      if (f) {
        adTypeFilter = f;
        break;
      }
    }
    // AdMob-only uses a curated enum list so we never surface the generic
    // cross-network labels that the live SDUI config may carry for other tabs.
    if (isAdmobOnly) return ADMOB_AD_TYPE_OPTIONS;

    // Filter-level applicability is authoritative; option "All" cannot widen it.
    if (!adTypeFilter?.options?.length || !shouldShowAdTypeFilter(adTypeFilter)) {
      return [];
    }
    // Options are scoped only after the parent filter has passed.
    return adTypeFilter.options.filter(shouldShowAdTypeOption);
  }, [config, activeLower, isAdmobOnly, sdui.shouldShowFilter, sdui.shouldShowOption]);

  useEffect(() => {
    if (AD_TYPE_OPTIONS.length === 0 && showAdTypeFilter) {
      setShowAdTypeFilter(false);
    }
  }, [AD_TYPE_OPTIONS.length, showAdTypeFilter]);

  const toggleAdType = (type) => {
    if (guest?.showGuestWarning("Please login to filter by ad type")) return;
    if (isFilterRestricted?.("ad_type")) {
      if ((selAdTypes || []).length) setSelAdTypes([]);
      setShowAdTypeFilter(false);
      onAdTypeRestricted?.();
      return;
    }
    const current = selAdTypes || [];
    const next = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type];
    setSelAdTypes(next);
  };

  // True when any sidebar/searchbar filter is active, OR the sort has been
  // changed away from the default. The default sort ("newest") is excluded
  // because it's always set and isn't user-perceived as a "filter chip" — but
  // picking Impressions/Popularity/etc. must flip this to true so the
  // platforms bar gives up its flex-1 space and stops overlapping the
  // clear-filter button.
  const hasActiveFilter = useMemo(() => {
    const fv = sdui?.filterValues;
    const hasFilter = fv
      ? Object.entries(fv).some(([key, v]) => {
          if (key === "sorting") return false;
          if (v === null || v === undefined || v === "") return false;
          if (Array.isArray(v)) return v.length > 0;
          if (typeof v === "boolean") return v;
          return true;
        })
      : false;
    if (hasFilter) return true;
    const currentSort = (sdui?.sortBy || "").toString().toLowerCase().trim();
    return !!currentSort && currentSort !== "newest";
  }, [sdui?.filterValues, sdui?.sortBy]);

  return (
    <div
      className={`flex flex-1 items-center justify-between gap-3 transition-all duration-300 ${className} ${isScrolled ? "flex-nowrap px-1" : "flex-wrap px-3"} sm:flex-nowrap`}
    >
      {/* Platform tabs */}
      <div
        className={`flex items-center min-w-[120px] ${!showPlatformsOnMobile ? "hidden md:flex" : "flex"} ${!hasActiveFilter ? "flex-1 2xl:flex-initial" : ""}`}
      >
        <div className="flex w-full max-w-[760px] items-center gap-0.5 overflow-x-auto rounded-xl border border-theme-border bg-theme-card p-1 hide-scrollbar 2xl:w-auto">
          <PlatformTab
            label="All"
            active={isAllActive}
            activeBg="#3352964d"
            activeBorder="rgba(99,102,241,0.5)"
            onClick={handleAllClick}
            disableTooltips={disableTooltips}
          />
          {platformOptions.map((opt) => {
            const value = opt.value ?? opt.label;
            const fallback =
              opt._fallback ||
              PLATFORMS.find(
                (f) =>
                  f.id.toLowerCase() === value.toLowerCase() ||
                  f.label === opt.label,
              ) ||
              {};
            return (
              <PlatformTab
                key={value}
                value={value}
                Icon={fallback.Icon || null}
                imageUrl={opt.icon_url || null}
                label={opt.label}
                active={specificPlatforms.includes(value)}
                onClick={() => handlePlatformClick(value)}
                color={fallback.color}
                activeBg={fallback.activeBg}
                activeBorder={fallback.activeBorder}
                disableTooltips={disableTooltips}
              />
            );
          })}
        </div>
      </div>

      {/* Right side controls */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <AdDateDropdown onDateChange={onDateChange} filterValues={sdui?.filterValues} isTikTok={specificPlatforms.length === 1 && specificPlatforms[0]?.toLowerCase() === "tiktok"} isAdmobOnly={isAdmobOnly} disableTooltips={disableTooltips} isFilterRestricted={isFilterRestricted} onRestricted={onDateRestricted} />
        {/* Ad Type Filter — hidden when no options available for current platform */}
        {AD_TYPE_OPTIONS.length > 0 && <div className="relative" ref={adTypeFilterRef}>
          <button
            ref={filterBtnRef}
            onMouseEnter={handleFilterMouseEnter}
            onMouseLeave={() => setShowFilterTip(false)}
            onClick={() => {
              if (isFilterRestricted?.("ad_type")) {
                if ((selAdTypes || []).length) setSelAdTypes([]);
                setShowAdTypeFilter(false);
                setShowFilterTip(false);
                onAdTypeRestricted?.();
                return;
              }
              setShowAdTypeFilter((p) => !p);
              setShowFilterTip(false);
            }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${
              showAdTypeFilter || (selAdTypes && selAdTypes.length > 0)
                ? "bg-[#335296] text-white border-[#3759a3]"
                : "bg-theme-card text-white/60 border-theme-border hover:text-theme-text-secondary hover:border-theme-text-muted"
            }`}
          >
            <Filter size={14} />
            {selAdTypes && selAdTypes.length > 0 && (
              <span className="ml-0.5">{selAdTypes.length}</span>
            )}
          </button>
          {showFilterTip && !disableTooltips && (
            <div
              className="fixed z-[9999] px-3 py-1.5 text-[12px] font-semibold rounded-lg whitespace-nowrap pointer-events-none"
              style={{
                left: filterTipPos.x,
                top: filterTipPos.y,
                transform: "translate(-50%, -100%)",
                backgroundColor: "var(--color-surface)",
                color: "var(--color-text)",
                border: "1px solid var(--color-border)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              }}
            >
              {t("filter_by_ad_type")}
            </div>
          )}
          {showAdTypeFilter && (
            <div className="absolute top-full right-0 mt-1 w-[205px] max-h-[240px] overflow-y-auto overscroll-contain custom-scrollbar bg-theme-card border border-theme-border rounded-xl shadow-xl z-50 py-1">
              <p className="sticky top-0 z-10 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-theme-text-muted bg-theme-card border-b border-theme-border mb-1">
                {t("ad_type")}
              </p>
              {AD_TYPE_OPTIONS.map((opt) => {
                const value = opt.value ?? opt.label ?? opt;
                const label = opt.label ?? opt;
                const isSelected = (selAdTypes || []).includes(value);
                return (
                  <button
                    key={value}
                    onClick={() => toggleAdType(value)}
                    className={`w-full text-left px-3 py-1.5 text-[11px] font-semibold flex items-center justify-between gap-2 transition-colors ${
                      isSelected
                        ? "text-[#6b99ff] bg-[#3762c1]/10"
                        : "text-theme-text-secondary hover:text-theme-text hover:bg-theme-text/[0.04]"
                    }`}
                  >
                    {String(label).charAt(0).toUpperCase() +
                      String(label).slice(1)}
                    {isSelected && (
                      <Check size={13} className="text-[#6b99ff]" />
                    )}
                  </button>
                );
              })}
              {selAdTypes && selAdTypes.length > 0 && (
                <button
                  onClick={() => {
                    if (guest?.showGuestWarning("Please login to change filters")) return;
                    if (isFilterRestricted?.("ad_type")) {
                      if ((selAdTypes || []).length) setSelAdTypes([]);
                      setShowAdTypeFilter(false);
                      onAdTypeRestricted?.();
                      return;
                    }
                    setSelAdTypes([]);
                    setShowAdTypeFilter(false);
                  }}
                  className="w-full text-left px-4 py-2 text-[11px] font-semibold text-red-400 hover:text-red-300 border-t border-theme-border mt-1 transition-colors"
                >
                  {t("clear")}
                </button>
              )}
            </div>
          )}
        </div>}
        {/* Sort filter */}
        {sortTabs.length > 0 && (
          <div className="relative" ref={moreTabsRef}>
            <div className="relative">
              <button
                ref={sortBtnRef}
                onMouseEnter={handleSortMouseEnter}
                onMouseLeave={() => setShowSortTip(false)}
                onClick={() => setShowMoreTabs((p) => !p)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${
                  showMoreTabs ||
                  sortTabs.some((t) => activeTab === (t.label ?? t))
                    ? "bg-[#335296] text-white border-[#3759a3]"
                    : "bg-theme-card text-white/60 border-theme-border hover:text-theme-text-secondary hover:border-theme-text-muted"
                }`}
              >
                <SlidersHorizontal size={14} />
              </button>
              {showSortTip && !disableTooltips && (
                <div
                  className="fixed z-[9999] px-3 py-1.5 text-[12px] font-semibold rounded-lg whitespace-nowrap pointer-events-none"
                  style={{
                    left: sortTipPos.x,
                    top: sortTipPos.y,
                    transform: "translate(-50%, -100%)",
                    backgroundColor: "var(--color-surface)",
                    color: "var(--color-text)",
                    border: "1px solid var(--color-border)",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                  }}
                >
                  Sort by
                </div>
              )}
            </div>
            {showMoreTabs && (
              <div className="absolute top-full lg:right-0 mt-1 bg-theme-card border border-theme-border rounded-xl shadow-xl z-50 py-1 min-w-[220px]">
                {sortTabs.map((tab) => {
                  const tabValue = tab.value ?? tab.label ?? tab;
                  const tabLabel = tab.label ?? tab;
                  return (
                    <button
                      key={tabValue}
                      onClick={() => {
                        if (guest?.showGuestWarning("Please login to change sorting")) return;
                        const planAccessId = resolveSortPlanAccessId(tabLabel, tabValue);
                        if (planAccessId && isFilterRestricted?.(planAccessId)) { onSortRestricted?.(); return; }
                        setActiveTab(tabLabel);
                        sdui.setSortBy(tabValue);
                        setShowMoreTabs(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-[13px] font-semibold transition-colors ${
                        activeTab === tabLabel
                          ? "text-[#6b99ff] bg-[#3762c1]/10"
                          : "text-theme-text-secondary hover:text-theme-text hover:bg-theme-text/[0.04]"
                      }`}
                    >
                      {tabLabel}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {!isAdmobOnly && (
          <>
            {/* Original Preview Toggle */}
            <button
              onClick={() => {
                const network = activePlatforms?.length === 1 ? activePlatforms[0] : 'All';
                trackEvent('showOriginal', { network, show_original: previewMode ? 'false' : 'true' });
                if (!previewMode) {
                  const networkContext = getNetworkContext(activePlatforms || []);
                  trackAdAction('show_original', {
                    entry_point: 'filter_bar',
                    feature_name: 'original_ad',
                    ...networkContext,
                    platform: networkContext.network,
                    request_context: 'ad_open',
                  });
                }
                setPreviewMode(!previewMode);
              }}
              className={`items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all border ${
                !showOriginalOnMobile ? "hidden md:flex" : "flex"
              } ${
                previewMode
                  ? "bg-[#335296] text-white border-[#3759a3] shadow-md shadow-[#3759a3]/20"
                  : "bg-theme-card text-white/50 border-theme-border hover:text-theme-text-secondary hover:border-theme-text-muted"
              }`}
            >
              <Smartphone size={12} />
              <span className="sm:inline hidden">Show Original</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default AdFilterBar;
