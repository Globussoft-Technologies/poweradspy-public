import React, { useMemo, useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Check, Filter, SlidersHorizontal, Smartphone } from "lucide-react";
import PlatformTab from "../shared/PlatformTab";
import AdDateDropdown from "./AdDateDropdown";
import { PLATFORMS } from "../../constants";
import { trackEvent } from "../../services/api";

// Maps sort option label (lowercase) → plan_access_config _id
const SORT_LABEL_TO_PLAN_ACCESS_ID = {
  'newest':                   'newest_sort',
  'ad running days':          'ad_running_days_sort',
  'domain registration date': 'domain_reg_sort',
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
  PRIMARY_SORT_LABELS = [],
  onDateChange,
  isFilterRestricted,
  onDateRestricted,
  onSortRestricted,
  className = "",
  showOriginalOnMobile = true,
  showPlatformsOnMobile = true,
  isScrolled = false,
  disableTooltips = false,
  guest,
  DROPDOWN_SORT_LABELS = [],
}) => {
  const { t } = useTranslation();
  const { config, activePlatforms, selAdTypes, setSelAdTypes } = sdui;

  // Ad type filter dropdown state (owned here, not lifted to AdGrid)
  const [showAdTypeFilter, setShowAdTypeFilter] = useState(false);
  const adTypeFilterRef = useRef(null);

  useEffect(() => {
    if (!showAdTypeFilter) return;
    const handler = (e) => {
      if (
        adTypeFilterRef.current &&
        !adTypeFilterRef.current.contains(e.target)
      )
        setShowAdTypeFilter(false);
    };
    const onScroll = () => setShowAdTypeFilter(false);
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

  const AD_TYPE_OPTIONS = useMemo(() => {
    // Search all sections (sidebar + navbar) for the ad_type document
    const allDocs = [...(config?.sidebar || []), ...(config?.navbar || [])];
    // Find the doc that contains an ad_type filter
    let opts = [];
    for (const doc of allDocs) {
      const f = (doc.filters || []).find(
        (f) =>
          f._id === "ad_types" ||
          f._id === "ad_type_filter" ||
          f._id === "ad_type" ||
          f.query_param === "ad_type" ||
          f.group_id === "ad_type",
      );
      if (f?.options?.length > 0) {
        opts = f.options;
        break;
      }
    }
    if (opts.length === 0) {
      // Fallback if config not loaded yet
      return [
        { label: "Image", value: "Image" },
        { label: "Video", value: "Video" },
        { label: "Carousel", value: "Carousel" },
        { label: "Story", value: "Story" },
        { label: "Reel", value: "Reel" },
      ];
    }
    // Filter by active platforms — same as shouldShowOption in sidebar
    const activeLower = activePlatforms.map((p) => p.toLowerCase());
    return opts.filter((opt) => {
      if (!opt.platform_applicability || opt.platform_applicability === "all")
        return true;
      if (Array.isArray(opt.platform_applicability)) {
        return opt.platform_applicability.some((p) =>
          activeLower.includes(p.toLowerCase()),
        );
      }
      return true;
    });
  }, [config, activePlatforms]);

  const toggleAdType = (type) => {
    if (guest?.showGuestWarning("Please login to filter by ad type")) return;
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
        <div className={`flex items-center gap-0.5 p-1 bg-theme-card rounded-xl border border-theme-border overflow-x-auto hide-scrollbar ${
          !hasActiveFilter
            ? "w-full max-w-[600px] 2xl:w-auto"
            : `max-w-[200px] sm:max-w-[500px] ${isScrolled ? "2xl:max-w-none" : "max-w-[400px] sm:max-w-[45vw] lg:max-w-[50vw] xl:max-w-none"}`
        }`}>
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
        <AdDateDropdown onDateChange={onDateChange} filterValues={sdui?.filterValues} isTikTok={specificPlatforms.length === 1 && specificPlatforms[0]?.toLowerCase() === "tiktok"} disableTooltips={disableTooltips} isFilterRestricted={isFilterRestricted} onRestricted={onDateRestricted} />
        {/* Ad Type Filter — hidden when no options available for current platform */}
        {AD_TYPE_OPTIONS.length > 0 && <div className="relative" ref={adTypeFilterRef}>
          <button
            ref={filterBtnRef}
            onMouseEnter={handleFilterMouseEnter}
            onMouseLeave={() => setShowFilterTip(false)}
            onClick={() => {
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
            <div className="absolute top-full right-0 mt-1 bg-theme-card border border-theme-border rounded-xl shadow-xl z-50 py-1 min-w-[160px]">
              <p className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-theme-text-muted border-b border-theme-border mb-1">
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
                    className={`w-full text-left px-4 py-2 text-[13px] font-semibold flex items-center justify-between transition-colors ${
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
                {(() => {
                  const targetList =
                    DROPDOWN_SORT_LABELS && DROPDOWN_SORT_LABELS.length > 0
                      ? DROPDOWN_SORT_LABELS
                      : [
                          "newest",
                          "ad running days",
                          "domain registration date",
                        ];

                  const targets = targetList.map((l) =>
                    l.toString().toLowerCase().trim(),
                  );

                  let filtered = sortTabs.filter((t) => {
                    const l = (t.label || t || "").toString().toLowerCase().trim();
                    const v = (t.value || "").toString().toLowerCase().trim();
                    // Filter by platform_applicability
                    const applicability = t.platform_applicability;
                    if (Array.isArray(applicability) && applicability.length > 0) {
                      const matches = activePlatforms.some((p) =>
                        applicability.map((a) => a.toLowerCase()).includes(p.toLowerCase())
                      );
                      if (!matches) return false;
                    }
                    return targets.some(
                      (target) =>
                        l.includes(target) ||
                        target.includes(l) ||
                        v.includes(target.replace(/\s+/g, "_")) ||
                        v.includes(target),
                    );
                  });

                  // If filter failed but we have data, show all as emergency fallback
                  if (filtered.length === 0 && sortTabs.length > 0) {
                    filtered = sortTabs;
                  }

                  return filtered.map((tab) => {
                    const tabValue = tab.value ?? tab.label ?? tab;
                    const tabLabel = tab.label ?? tab;
                    return (
                      <button
                        key={tabValue}
                        onClick={() => {
                          if (guest?.showGuestWarning("Please login to change sorting")) return;
                          const planAccessId = SORT_LABEL_TO_PLAN_ACCESS_ID[(tabLabel || '').toLowerCase().trim()];
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
                  });
                })()}
              </div>
            )}
          </div>
        )}

        {/* Original Preview Toggle */}
        <button
          onClick={() => {
            const network = activePlatforms?.length === 1 ? activePlatforms[0] : 'All';
            trackEvent('showOriginal', { network, show_original: previewMode ? 'false' : 'true' });
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
      </div>
    </div>
  );
};

export default AdFilterBar;
