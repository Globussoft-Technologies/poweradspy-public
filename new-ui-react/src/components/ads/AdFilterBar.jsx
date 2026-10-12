import React, { useMemo, useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, Filter, SlidersHorizontal } from "lucide-react";
import { createPortal } from "react-dom";
import PlatformTab, { PLATFORM_ASSET_MAP, PLATFORM_FULL_NAMES } from "../shared/PlatformTab";
import RowSlider from "../shared/RowSlider";
import { useInstalledMobile } from "../../hooks/useInstalledMobile";
import AdDateDropdown from "./AdDateDropdown";
import { PLATFORMS } from "../../constants";
import {
  discardAiFilterDraft,
  hasActiveAiFilters,
  replaceAiFilters,
} from "../../utils/aiQuickFilterPresets";

// Maps SDUI sort labels/values to the stable Plan Control/legacy access ID.
const SORT_TO_PLAN_ACCESS_ID = {
  newest: 'newest_sort',
  newest_sort: 'newest_sort',
  last_seen: 'newest_sort',
  lastseen: 'newest_sort',
  last_seen_sort: 'newest_sort',
  created_at: 'newest_sort',
  'ad seen date': 'newest_sort',
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
  poster_intelligence_score: 'admob_poster_intelligence',
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
  last_seen: "created_at",
  lastseen: "created_at",
  last_seen_sort: "created_at",
  "-created_at": "created_at",
  popular: "popularity_score",
  popularity: "popularity_score",
  "-popularity_score": "popularity_score",
  impression: "impressions",
  "-impressions": "impressions",
  "ad running days": "running_days",
  "running longest": "running_days",
  "days running": "running_days",
  "ad seen date": "created_at",
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

const getSortDirectionOptions = (tab) => {
  const nested = tab?.sub_options || tab?.children || tab?.sort_directions;
  return Array.isArray(nested) && nested.length > 0 ? nested : [];
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
 * 4. AI-analysed-only Toggle
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
  sortTabs = [],
  onDateChange,
  isFilterRestricted,
  onDateRestricted,
  onSortRestricted,
  onAdTypeRestricted,
  onAiFilterRestricted,
  className = "",
  showAiToggleOnMobile = true,
  showPlatformsOnMobile = true,
  isScrolled = false,
  disableTooltips = false,
  guest,
  // Installed phone app: content shown at the right end of the Date / Ad
  // type / Sort / AI row (AdGrid passes the ads count + Export there).
  pwaTrailing = null,
  // Installed phone app: AdGrid renders the platform row pinned on its own
  // (pwaHideControls) and the rest of the bar below it (pwaHidePlatforms).
  pwaHideControls = false,
  pwaHidePlatforms = false,
}) => {
  const { t } = useTranslation();
  const {
    config,
    activePlatforms,
    selAdTypes,
    setSelAdTypes,
    filterValues,
    setFilter,
    setAllFilters,
  } = sdui;

  const aiFiltersDoc = useMemo(
    () => config?.sidebar?.find(
      (doc) => doc?._id === "ai_meta" && doc.visible !== false,
    ) || null,
    [config],
  );
  const isAiAnalysedOnly = hasActiveAiFilters(filterValues, aiFiltersDoc);

  const toggleAiAnalysedOnly = () => {
    if (guest?.showGuestWarning("Please login to filter AI analysed ads")) return;
    if (isFilterRestricted?.("ai_meta")) {
      onAiFilterRestricted?.();
      return;
    }

    discardAiFilterDraft();
    if (isAiAnalysedOnly) {
      // Switching off the lane clears detailed AI filters too; otherwise the
      // backend would still return AI-only results while the toggle looked off.
      const next = replaceAiFilters(filterValues, aiFiltersDoc, {});
      if (setAllFilters) setAllFilters(next);
      else setFilter?.("has_ai_meta", false, "filter_bar");
      return;
    }
    setFilter?.("has_ai_meta", true, "filter_bar");
  };

  // Ad type filter dropdown state (owned here, not lifted to AdGrid)
  const [showAdTypeFilter, setShowAdTypeFilter] = useState(false);
  const adTypeFilterRef = useRef(null);

  // Platform tab row; RowSlider adds the installed app's ‹ › and indicator.
  const platformRowRef = useRef(null);

  // Installed phone app: the row shows "All" + the first few networks like an
  // app dock, plus a "+N" tile that opens every network in a grid sheet. A
  // selected network always stays visible in the row. Website: all tabs.
  const isInstalledMobile = useInstalledMobile();
  const [showAllNetworks, setShowAllNetworks] = useState(false);
  const platformValue = (opt) => opt.value ?? opt.label;
  const platformFallback = (opt) => {
    const value = platformValue(opt);
    return (
      opt._fallback ||
      PLATFORMS.find((f) => f.id.toLowerCase() === value.toLowerCase() || f.label === opt.label) ||
      {}
    );
  };
  // Room for the wider "more" pill: 4 networks on most phones, 3 on the smallest.
  const pwaVisibleCount = typeof window !== "undefined" && window.innerWidth < 360 ? 3 : window.innerWidth >= 412 ? 5 : 4;
  // Never more than pwaVisibleCount in the row: selected networks take the
  // slots first (e.g. an AI search that picks many), unselected fill the rest;
  // original order is kept. Everything else sits behind "+N".
  const visiblePlatformOptions = (() => {
    if (!isInstalledMobile) return platformOptions;
    const isSel = (opt) => specificPlatforms.includes(platformValue(opt));
    const pickedSel = platformOptions.filter(isSel).slice(0, pwaVisibleCount);
    const fill = platformOptions.filter((opt) => !isSel(opt)).slice(0, pwaVisibleCount - pickedSel.length);
    return platformOptions.filter((opt) => pickedSel.includes(opt) || fill.includes(opt));
  })();
  const hiddenPlatformCount = platformOptions.length - visiblePlatformOptions.length;

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
  const isQuoraOnly = activeLower.length === 1 && activeLower[0] === "quora";
  // ChatGPT Ads tab — its date picker offers Last Seen / First Seen.
  const isChatgptOnly = activeLower.length === 1 && activeLower[0] === "chatgptads";
  const visibleSortTabs = useMemo(() => {
    if (!isQuoraOnly) return sortTabs;
    return sortTabs.filter((tab) => {
      const tabValue = tab?.value ?? tab?.label ?? tab;
      const tabLabel = tab?.label ?? tab;
      return resolveSortPlanAccessId(tabLabel, tabValue) !== "ad_running_days_sort";
    });
  }, [isQuoraOnly, sortTabs]);
  const [expandedSortValue, setExpandedSortValue] = useState(null);

  useEffect(() => {
    if (!showMoreTabs) setExpandedSortValue(null);
  }, [showMoreTabs]);

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
        className={`flex items-center min-w-[120px] ${!showPlatformsOnMobile ? "hidden md:flex" : "flex"} ${!hasActiveFilter ? "flex-1 2xl:flex-initial" : ""} pwa:relative pwa:w-full pwa:flex-none ${pwaHidePlatforms ? "pwa:hidden" : ""}`}
      >
        {/* pwa: snaps tab by tab on swipe; RowSlider below adds ‹ › and the
            position indicator (in place of the native scrollbar). */}
        <div ref={platformRowRef} className="flex w-full max-w-[760px] items-center gap-0.5 overflow-x-auto rounded-xl border border-theme-border bg-theme-card p-1 hide-scrollbar pwa:justify-between pwa:snap-x pwa:snap-proximity pwa:scroll-px-1 2xl:w-auto">
          <PlatformTab
            label="All"
            active={isAllActive}
            activeBg="#3352964d"
            activeBorder="rgba(99,102,241,0.5)"
            onClick={handleAllClick}
            disableTooltips={disableTooltips}
          />
          {visiblePlatformOptions.map((opt) => {
            const value = platformValue(opt);
            const fallback = platformFallback(opt);
            return (
              <PlatformTab
                key={value}
                value={value}
                Icon={fallback.Icon || null}
                imageUrl={opt.icon_url || null}
                label={opt.label}
                active={specificPlatforms.includes(value)}
                dimmed={isInstalledMobile && !isAllActive && specificPlatforms.length > 0 && !specificPlatforms.includes(value)}
                onClick={() => handlePlatformClick(value)}
                color={fallback.color}
                activeBg={fallback.activeBg}
                activeBorder={fallback.activeBorder}
                disableTooltips={disableTooltips}
              />
            );
          })}
          {isInstalledMobile && hiddenPlatformCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllNetworks(true)}
              aria-label={`Show all networks (${hiddenPlatformCount} more)`}
              // Avatar-stack "more" pill (Slack/Google style): the next two hidden
              // networks overlapping, then the "+N" count.
              className="flex h-10 shrink-0 snap-start items-center rounded-full border border-theme-border bg-theme-bg pl-1 pr-2.5 shadow-sm transition-transform active:scale-95"
            >
              <span className="flex items-center">
                {platformOptions
                  .filter((opt) => !visiblePlatformOptions.includes(opt))
                  .slice(0, 2)
                  .map((opt, i) => {
                    const key = platformValue(opt).toLowerCase();
                    const src = PLATFORM_ASSET_MAP[key] || opt.icon_url;
                    const NextIcon = platformFallback(opt).Icon;
                    return (
                      <span
                        key={key}
                        className={`flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-theme-card ring-2 ring-theme-bg ${i ? "-ml-1.5" : ""}`}
                        style={{ zIndex: 2 - i }}
                      >
                        {src ? (
                          <img src={src} alt="" className="h-[18px] w-[18px] object-contain" />
                        ) : NextIcon ? (
                          <NextIcon size={16} />
                        ) : (
                          <span className="text-[10px] font-black text-theme-text">{opt.label?.slice(0, 2)}</span>
                        )}
                      </span>
                    );
                  })}
              </span>
              <span className="ml-1.5 text-[12px] font-bold text-[#335296] dark:text-[#8fb0ff]">+{hiddenPlatformCount}</span>
            </button>
          )}
        </div>
        <RowSlider rowRef={platformRowRef} deps={[platformOptions.length, visiblePlatformOptions.length]} />
      </div>

      {/* Installed phone app: "All networks" sheet — every network as an app
          tile; tap to toggle (same as tapping its tab). */}
      {isInstalledMobile && showAllNetworks && createPortal(
        <>
          <div className="fixed inset-0 z-[70] bg-black/40 animate-in fade-in duration-200" onClick={() => setShowAllNetworks(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label="All networks"
            className="fixed inset-x-0 bottom-0 z-[71] max-h-[80dvh] overflow-y-auto rounded-t-[24px] bg-theme-card px-4 pt-3 shadow-2xl animate-in slide-in-from-bottom duration-300"
            style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom))" }}
          >
            <span className="mx-auto mb-3 block h-1 w-10 rounded-full bg-theme-text-muted/40" />
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-[17px] font-bold text-theme-text">All networks</p>
              <button
                type="button"
                onClick={handleAllClick}
                className={`h-8 rounded-full border px-3 text-[12px] font-semibold transition-colors ${
                  isAllActive ? "border-[#3759a3] bg-[#335296]" : "border-theme-border text-theme-text-secondary"
                }`}
                style={isAllActive ? { color: "#ffffff" } : undefined}
              >
                {isAllActive ? "✓ All selected" : "Select all"}
              </button>
            </div>
            <div className="grid grid-cols-4 gap-x-2 gap-y-4">
              {platformOptions.map((opt) => {
                const value = platformValue(opt);
                const fallback = platformFallback(opt);
                const key = value.toLowerCase();
                const iconSrc = PLATFORM_ASSET_MAP[key] || opt.icon_url;
                const Icon = fallback.Icon;
                const name = key === "gdn" ? "GDN" : PLATFORM_FULL_NAMES[key] || opt.label;
                const on = specificPlatforms.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handlePlatformClick(value)}
                    aria-pressed={on}
                    className="flex min-w-0 flex-col items-center gap-1.5 active:scale-95"
                  >
                    <span
                      className={`relative flex h-14 w-14 items-center justify-center rounded-2xl border bg-theme-bg transition-colors ${
                        on ? "border-transparent ring-2 ring-[#335296]" : "border-theme-border"
                      }`}
                    >
                      {iconSrc ? (
                        <img src={iconSrc} alt="" className="h-8 w-8 object-contain" />
                      ) : Icon ? (
                        <Icon size={28} className={fallback.color} />
                      ) : (
                        <span className="text-[13px] font-black text-theme-text">{opt.label?.slice(0, 2)}</span>
                      )}
                      {on && (
                        <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#335296] shadow" style={{ color: "#ffffff" }}>
                          <Check size={12} strokeWidth={3} />
                        </span>
                      )}
                    </span>
                    <span className={`w-full truncate text-center text-[11px] font-medium ${on ? "text-theme-text" : "text-theme-text-secondary"}`}>{name}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setShowAllNetworks(false)}
              className="mt-6 h-12 w-full rounded-2xl bg-[#335296] text-[15px] font-bold shadow-md active:scale-[0.98]"
              style={{ color: "#ffffff" }}
            >
              Done
            </button>
          </div>
        </>,
        document.body,
      )}

      {/* Right side controls */}
      {/* pwa: this row is the anchor for the Date / Ad Type / Sort dropdowns
          (their own wrappers go static), so each opens right under the row,
          aligned to the screen gutters, whichever button opened it. */}
      <div className={`flex items-center gap-2 flex-wrap shrink-0 pwa:relative pwa:w-full pwa:flex-nowrap pwa:gap-1.5 ${pwaHideControls ? "pwa:hidden" : ""}`}>

        <AdDateDropdown onDateChange={onDateChange} filterValues={sdui?.filterValues} isTikTok={specificPlatforms.length === 1 && specificPlatforms[0]?.toLowerCase() === "tiktok"} isAdmobOnly={isAdmobOnly} disableTooltips={disableTooltips} isChatgptOnly={isChatgptOnly} isFilterRestricted={isFilterRestricted} onRestricted={onDateRestricted} />
        {/* Ad Type Filter — hidden when no options available for current platform */}
        {AD_TYPE_OPTIONS.length > 0 && <div className="relative pwa:static" ref={adTypeFilterRef}>
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
              className="fixed z-[9999] px-3 py-1.5 text-[12px] font-semibold rounded-lg whitespace-nowrap pointer-events-none pwa:hidden"
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
            // Installed phone app: compact 2-column dropdown under the filter row
            // (anchored right-0 to this button it opened off the screen's left edge).
            <div className="absolute top-full right-0 mt-1 w-[205px] max-h-[240px] pwa:left-0 pwa:right-auto pwa:mt-2 pwa:w-[calc(100vw-24px)] pwa:max-h-[38dvh] pwa:z-[60] overflow-y-auto overscroll-contain custom-scrollbar pwa-scrollbar pwa:grid pwa:grid-cols-2 pwa:content-start bg-theme-card border border-theme-border rounded-xl shadow-xl z-50 py-1">
              <p className="sticky top-0 z-10 pwa:col-span-2 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-theme-text-muted bg-theme-card border-b border-theme-border mb-1">
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
                  className="w-full text-left px-4 py-2 pwa:col-span-2 text-[11px] font-semibold text-red-400 hover:text-red-300 border-t border-theme-border mt-1 transition-colors"
                >
                  {t("clear")}
                </button>
              )}
            </div>
          )}
        </div>}
        {/* Sort filter */}
        {visibleSortTabs.length > 0 && (
          <div className="relative pwa:static" ref={moreTabsRef}>
            <div className="relative">
              <button
                ref={sortBtnRef}
                onMouseEnter={handleSortMouseEnter}
                onMouseLeave={() => setShowSortTip(false)}
                onClick={() => setShowMoreTabs((p) => !p)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${
                  showMoreTabs ||
                  visibleSortTabs.some((t) => activeTab === (t.label ?? t))
                    ? "bg-[#335296] text-white border-[#3759a3]"
                    : "bg-theme-card text-white/60 border-theme-border hover:text-theme-text-secondary hover:border-theme-text-muted"
                }`}
              >
                <SlidersHorizontal size={14} />
              </button>
              {showSortTip && !disableTooltips && (
                <div
                  className="fixed z-[9999] px-3 py-1.5 text-[12px] font-semibold rounded-lg whitespace-nowrap pointer-events-none pwa:hidden"
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
              <div className="absolute top-full lg:right-0 mt-1 pwa:left-0 pwa:right-auto pwa:mt-2 pwa:w-[calc(100vw-24px)] pwa:max-h-[42dvh] pwa:overflow-y-auto pwa:z-[60] pwa-scrollbar bg-theme-card border border-theme-border rounded-xl shadow-xl z-50 py-1 min-w-[220px]">
                {visibleSortTabs.map((tab) => {
                  const tabValue = tab.value ?? tab.label ?? tab;
                  const tabLabel = tab.label ?? tab;
                  const directionOptions = getSortDirectionOptions(tab);
                  const hasNestedDirections = directionOptions.length > 0;
                  const isExpanded = expandedSortValue === tabValue;
                  const selectedDirection = sdui.sortDirection || "desc";
                  const applySort = (direction = selectedDirection) => {
                    if (guest?.showGuestWarning("Please login to change sorting")) return;
                    const planAccessId = resolveSortPlanAccessId(tabLabel, tabValue);
                    if (planAccessId && isFilterRestricted?.(planAccessId)) {
                      onSortRestricted?.();
                      return;
                    }
                    setActiveTab(tabLabel);
                    sdui.setSortBy(tabValue);
                    sdui.setSortDirection?.(direction);
                    setShowMoreTabs(false);
                  };
                  return (
                    <div key={tabValue}>
                      <button
                        type="button"
                        onClick={() => {
                          if (hasNestedDirections) {
                            setExpandedSortValue((current) => current === tabValue ? null : tabValue);
                            return;
                          }
                          applySort();
                        }}
                        className={`flex w-full items-center justify-between gap-3 text-left px-4 py-2 text-[13px] font-semibold transition-colors ${
                          activeTab === tabLabel
                            ? "text-[#6b99ff] bg-[#3762c1]/10"
                            : "text-theme-text-secondary hover:text-theme-text hover:bg-theme-text/[0.04]"
                        }`}
                      >
                        <span className={activeTab === tabLabel ? "text-[#6b99ff]" : ""}>{tabLabel}</span>
                        {hasNestedDirections && (
                          <ChevronRight
                            size={14}
                            className={`shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                          />
                        )}
                      </button>
                      {hasNestedDirections && isExpanded && (
                        <div className="border-t border-theme-border/70 bg-theme-bg/30 py-1">
                          {directionOptions.map((direction) => {
                            const directionValue = String(direction?.value || "desc").toLowerCase() === "asc"
                              ? "asc"
                              : "desc";
                            return (
                              <button
                                key={direction?._id || `${tabValue}-${directionValue}`}
                                type="button"
                                onClick={() => applySort(directionValue)}
                                className="flex w-full items-center justify-between gap-3 px-7 py-1.5 text-left text-[12px] font-medium text-theme-text-secondary transition-colors hover:bg-theme-text/[0.05] hover:text-theme-text"
                              >
                                <span>{direction?.label || (directionValue === "asc" ? "Low to High" : "High to Low")}</span>
                                {activeTab === tabLabel && selectedDirection === directionValue && (
                                  <Check size={13} className="text-[#6b99ff]" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {!isAdmobOnly && (
          <button
            type="button"
            role="switch"
            aria-checked={isAiAnalysedOnly}
            aria-label="AI analysed only"
            onClick={toggleAiAnalysedOnly}
            // pwa: installed phone app — a ✦ AI icon button instead of the
            // switch: outlined when off, filled violet when on. Website unchanged.
            className={`items-center gap-2.5 rounded-lg border px-3 py-2 text-[11px] font-semibold transition-colors pwa:h-8 pwa:gap-1 pwa:px-2.5 pwa:py-0 pwa:active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 ${
              !showAiToggleOnMobile ? "hidden md:flex" : "flex"
            } ${
              isAiAnalysedOnly
                ? "ai-analysed-toggle--active border-violet-400/30 bg-violet-500/10 text-violet-300 pwa:border-transparent pwa:bg-gradient-to-r pwa:from-[#6366f1] pwa:to-[#7c3aed] pwa:shadow-md pwa:shadow-violet-500/30"
                // Keep hover neutral so violet communicates the enabled state only.
                : "border-theme-border bg-theme-card text-theme-text-muted hover:border-theme-text-muted hover:bg-theme-text/[0.04] hover:text-theme-text pwa:border-violet-400/50"
            }`}
          >
            <span className="hidden whitespace-nowrap sm:inline">AI analysed only</span>
            <span
              className="hidden pwa:flex items-center gap-1 text-[12px] font-bold"
              style={{ color: isAiAnalysedOnly ? "#ffffff" : "#7c3aed" }}
            >
              {/* Inline sparkles (the test's lucide mock has no Sparkles). */}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9.94 14.06 4 12l5.94-2.06L12 4l2.06 5.94L20 12l-5.94 2.06L12 20z" />
                <path d="M19 3v4M17 5h4" />
              </svg>
              AI
            </span>
            <span
              aria-hidden="true"
              data-testid="ai-analysed-toggle-track"
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors pwa:hidden ${
                isAiAnalysedOnly
                  ? "bg-violet-600 pwa:animate-[pwaToggleGlow_700ms_ease-out]"
                  : "bg-slate-300 dark:bg-zinc-600"
              }`}
            >
              <span
                data-testid="ai-analysed-toggle-thumb"
                className={`absolute left-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full shadow-sm transition-transform duration-200 pwa:duration-300 pwa:ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                  isAiAnalysedOnly ? "translate-x-4" : "translate-x-0"
                }`}
                style={{ backgroundColor: "#ffffff" }}
              >
                {isAiAnalysedOnly && (
                  <span className="hidden pwa:block text-[9px] leading-none text-violet-600 animate-[pwaSparkIn_400ms_ease-out]">✦</span>
                )}
              </span>
            </span>
          </button>
        )}
        {pwaTrailing && (
          <div className="hidden pwa:flex ml-auto min-w-0 items-center gap-1.5">{pwaTrailing}</div>
        )}
      </div>
    </div>
  );
};

export default AdFilterBar;
