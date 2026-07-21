import React, { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { SearchX, AlertTriangle, RefreshCw, ArrowUp, FileDown, EyeOff, Radar } from "lucide-react";

// PRD FR-11 — networks with materially lower crawled ad volume than the rest of
// the platform today. When every currently-active platform is one of these, the
// empty state explains WHY results are sparse instead of implying the search
// itself was bad (see the coverage-note block below, distinct from the generic
// "No ads found" state).
const LOW_VOLUME_NETWORKS = ['quora', 'reddit', 'tiktok', 'linkedin'];
import { useTranslation } from "react-i18next";
import Masonry from "./Masonry";
import MasonryCard from "./MasonryCard";
import OriginalPreview from "./OriginalPreview";
import AdDetailModal from "./AdDetailModal";
import AdFilterBar from "./AdFilterBar";
import FilterChip from "../filters/FilterChip";
import ChipCluster from "../filters/ChipCluster";

// Env kill-switch for the "Total Ads: X" count shown next to the filter chips
// on every search. Set VITE_SHOW_TOTAL_ADS_COUNT=false to hide it; any other
// value (or leaving it unset) keeps the count visible.
const SHOW_TOTAL_ADS_COUNT =
  String(import.meta.env.VITE_SHOW_TOTAL_ADS_COUNT ?? "true")
    .trim()
    .toLowerCase() !== "false";

/**
 * AdGrid — SDUI-driven ad display with platform tabs, sort tabs, and active filter chips.
 *
 * Reads platform options from SDUI navbar `platforms` document.
 * Reads sort options from SDUI navbar `sorting` document.
 * Filter chips display currently active filter values from sdui.filterValues.
 */
const AdGrid = ({
  ads,
  sdui,
  activeTab,
  setActiveTab,
  onAnalyzeAd,
  onAnalyticsAd,
  setPage,
  hasMore = true,
  loadingMore = false,
  adsMeta = {},
  favouriteAdIds = new Set(),
  onHideAd,
  onHideAdvertiser,
  onToggleFavourite,
  onSearch,
  onOpenAdvertiserProfile,
  onOpenKeywordExplorer,
  onExportAll,
  error = null,
  onRetry,
  allowedPlatforms,
  onPlatformRestricted,
  onToggleSidebar,
  theme,
  isLanding = false,
  isHeaderScrolled,
  onScrollChange,
  previewMode,
  setPreviewMode,
  specificPlatforms,
  setSpecificPlatforms,
  platformOptions,
  sortTabs,
  isAllActive,
  handleAllClick,
  handlePlatformClick,
  onDateChange,
  isFilterRestricted,
  onDateRestricted,
  onSortRestricted,
  PRIMARY_SORT_LABELS,
  guest,
  DROPDOWN_SORT_LABELS,
  onClearAll,
  hiddenCount = 0,
  isSearchActive = false,
  onGuestLimit,
  closeDetailSignal,
}) => {
  const {
    activePlatforms,
    setActivePlatforms,
    filterValues,
    setFilter,
    setSortBy,
    config,
  } = sdui;

  // "Total Ads" = the ES match total from the backend (`adsMeta` is per-network
  // `meta.total`, captured once at page 0 in App.jsx, stable across pages). The
  // backend ES queries now filter to displayable ads only (each network requires
  // its NAS thumbnail for IMAGE/VIDEO), so this total equals what actually
  // renders and matches a same-filter DB count — no client-side recount, no
  // pagination growth. Summing across networks works for every tab (non-requested
  // networks come back as 0). Gated on `ads.length` so the count is hidden in the
  // empty/discovery states.
  const adsCount = useMemo(() => {
    if (!ads || ads.length === 0) return null;
    const total =
      adsMeta && typeof adsMeta === "object"
        ? Object.values(adsMeta).reduce((s, n) => s + (Number(n) || 0), 0)
        : 0;
    if (!total) return null;
    return total >= 1_000_000
      ? `${(total / 1_000_000).toFixed(1)}M`
      : total >= 1_000
        ? `${(total / 1_000).toFixed(1)}K`
        : `${total}`;
  }, [ads.length, adsMeta]);
  const DATE_FILTER_KEYS = {
    seen_btn_sort: "Ad Seen",
    post_date_btn_sort: "Post Date",
    domain_date_btn_sort: "Domain Reg.",
  };

  // Pretty labels for the active-sort chip. Backend stores opaque tokens
  // like 'popularity_score' or '-created_at'; this maps them to the same
  // wording the user just clicked on the sort tabs.
  // The "Newest" tab sends '-created_at' / newest_sort, but the backend
  // paramParsers on every platform actually sort by `last_seen` — so the
  // chip says "Last Seen" instead of "Latest" to reflect what the ordering
  // is keyed to (and stop ads with old post_dates looking out of order).
  const SORT_LABEL_MAP = {
    newest: "Last Seen", post_date: "Last Seen", new: "Last Seen",
    "-created_at": "Last Seen", created_at: "Last Seen", latest: "Last Seen",
    popular: "Popularity", popularity: "Popularity",
    popularity_score: "Popularity", "-popularity_score": "Popularity",
    impressions: "Impressions", impression: "Impressions",
    "-impressions": "Impressions",
    likes: "Likes", like: "Likes", "-engagement_score": "Likes",
    comments: "Comments", comment: "Comments",
    shares: "Shares", share: "Shares",
    hits: "Hits", hit: "Hits",
    last_seen: "Last Seen", lastseen: "Last Seen", "-last_seen_at": "Last Seen",
    running_days: "Ad Running Days", days_running: "Ad Running Days",
    running_longest: "Ad Running Days", longest_running: "Ad Running Days",
    "-running_days": "Ad Running Days", "ad running days": "Ad Running Days",
    domain: "Domain Reg. Date", domain_date: "Domain Reg. Date",
    domain_sort: "Domain Reg. Date", domain_reg_sort: "Domain Reg. Date",
    "-domain_reg_date": "Domain Reg. Date",
    "domain registration date": "Domain Reg. Date",
    ad_budget: "Ad Budget", adbudget: "Ad Budget",
    budget: "Ad Budget", avg_ad_budget: "Ad Budget",
  };

  const RANGE_FILTER_KEYS = {
    likes: "Likes", like: "Likes", likes_range: "Likes", engagement_likes: "Likes",
    shares: "Shares", share: "Shares", shares_range: "Shares", engagement_shares: "Shares",
    comments: "Comments", comment: "Comments", comments_range: "Comments", engagement_comments: "Comments",
    impressions: "Impressions", impression: "Impressions", impressions_range: "Impressions", engagement_impressions: "Impressions",
    views_range_filter: "Views", views: "Views", views_range: "Views",
    popularity: "Popularity", popularity_range: "Popularity", popularity_score: "Popularity", popularity_score_filter: "Popularity", popularity_filter: "Popularity",
    adBudget: "Ad Budget", ad_budget: "Ad Budget", avg_ad_budget: "Ad Budget", ad_budget_filter: "Ad Budget", budget: "Ad Budget",
  };

  const formatRangeValue = (n) => {
    if (n === null || n === undefined || n === '') return null;
    const num = Number(n);
    if (isNaN(num)) return String(n);
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(num);
  };

  const formatUnixDate = (ts) => {
    const d = new Date(Number(ts) * 1000);
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = d.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };

  // Build maps from SDUI config:
  //   filterOptionLabels: { filterId -> { value -> displayLabel } }
  //   filterCategoryLabels: { filterId -> filter.label }  — used to prefix chips (e.g. "Age: 18-24")
  const { filterOptionLabels, filterCategoryLabels } = useMemo(() => {
    if (!config) return { filterOptionLabels: {}, filterCategoryLabels: {} };
    const allFilters = [
      ...(config.searchbar?.flatMap(d => d.filters || []) || []),
      ...(config.navbar?.flatMap(d => d.filters || []) || []),
      ...(config.sidebar?.flatMap(d => d.filters || []) || []),
    ];
    const optionMap = {};
    const categoryMap = {};
    for (const f of allFilters) {
      if (!f._id) continue;
      if (f.label) categoryMap[f._id] = f.label;
      if (!f.options?.length) continue;
      optionMap[f._id] = {};
      for (const opt of f.options) {
        const val = opt.value ?? opt.label ?? opt;
        const lbl = opt.label ?? opt.value ?? opt;
        optionMap[f._id][String(val)] = String(lbl);
      }
    }
    return { filterOptionLabels: optionMap, filterCategoryLabels: categoryMap };
  }, [config]);

  // Accumulates toggle labels across config re-fetches so chips survive platform switches.
  // Platform-specific configs omit cross-platform toggles (e.g. meta_ads_lib_filter),
  // which would otherwise cause active chips to disappear without a reload.
  const _seenToggleLabels = useRef({});
  const filterToggleLabels = useMemo(() => {
    if (!config) return _seenToggleLabels.current;
    const allFilters = [
      ...(config.sidebar?.flatMap(d => d.filters || []) || []),
    ];
    for (const f of allFilters) {
      if (f.type === 'toggle_switch' && f._id) {
        _seenToggleLabels.current[f._id] = f.label || f._id;
      }
    }
    return { ..._seenToggleLabels.current };
  }, [config]);

  // Build parent → ordered children leaves (and reverse map) from the nested
  // category filter. Used to absorb subcategory chips into their parent's
  // cluster instead of rendering them as siblings.
  const parentToLeaves = useMemo(() => {
    if (!config) return {};
    const allFilters = [
      ...(config.searchbar?.flatMap((d) => d.filters || []) || []),
      ...(config.navbar?.flatMap((d) => d.filters || []) || []),
      ...(config.sidebar?.flatMap((d) => d.filters || []) || []),
    ];
    const nested = allFilters.find(
      (f) => f.type === "nested_select" || f.type === "nested_multiselect",
    );
    if (!nested) return {};
    const p2l = {};
    const collect = (node) => {
      const kids = node.children || node.sub_options || [];
      if (kids.length === 0) {
        return [{ value: node.value ?? node.label, label: node.label ?? node.value }];
      }
      return kids.flatMap(collect);
    };
    for (const parent of nested.options || []) {
      const pVal = parent.value ?? parent.label;
      p2l[pVal] = collect(parent);
    }
    return p2l;
  }, [config]);

  // Which parent's children are shown inline. The most recently selected
  // parent auto-expands; clicking a collapsed cluster chip switches focus.
  const [expandedParent, setExpandedParent] = useState(null);
  const prevParentsRef = useRef([]);

  useEffect(() => {
    const parents = Array.isArray(filterValues.adcategory)
      ? filterValues.adcategory
      : [];
    const prev = prevParentsRef.current;
    const added = parents.find((p) => !prev.includes(p));
    if (added) {
      setExpandedParent(added);
    } else if (expandedParent && !parents.includes(expandedParent)) {
      // expanded parent was removed — fall back to the most recently added
      setExpandedParent(parents[parents.length - 1] || null);
    } else if (parents.length === 0 && expandedParent) {
      setExpandedParent(null);
    }
    prevParentsRef.current = parents;
  }, [filterValues.adcategory, expandedParent]);

  // chipGroups: ordered list of render units. Each is either:
  //   { type: 'cluster', parent: {value,label}, children: [{value,label}] }
  //   { type: 'chip',    filterId, value, label }
  // Cluster groups absorb subcategory leaves under their parent so the
  // chip row doesn't fan out into a dozen sibling chips.
  const chipGroups = useMemo(() => {
    const groups = [];
    const adcategory = Array.isArray(filterValues.adcategory)
      ? filterValues.adcategory
      : [];
    const subcategory = Array.isArray(filterValues.subcategory)
      ? filterValues.subcategory
      : [];

    // 1. One cluster per selected parent. Iterated in reverse so the most
    //    recently selected parent renders first.
    const absorbed = new Set();
    const parentsOrdered = [...adcategory].reverse();
    for (const pVal of parentsOrdered) {
      const pLabel =
        filterOptionLabels.adcategory?.[String(pVal)] ?? String(pVal);
      const leaves = parentToLeaves[pVal] || [];
      const leafIndex = new Map(leaves.map((l) => [l.value, l]));
      const selectedChildren = subcategory
        .filter((v) => leafIndex.has(v))
        .map((v) => {
          const leaf = leafIndex.get(v);
          return { value: v, label: leaf.label ?? v };
        });
      selectedChildren.forEach((c) => absorbed.add(c.value));
      groups.push({
        type: "cluster",
        parent: { value: pVal, label: pLabel },
        children: selectedChildren,
      });
    }

    // Ensure the currently expanded parent renders first so the wide pill
    // doesn't get pushed off-screen behind collapsed siblings.
    if (expandedParent) {
      const idx = groups.findIndex(
        (g) => g.type === "cluster" && g.parent.value === expandedParent,
      );
      if (idx > 0) {
        const [g] = groups.splice(idx, 1);
        groups.unshift(g);
      }
    }

    // 2. All other filterValues entries become standalone chips, in reverse
    //    insertion order so newer chips show first (current behaviour).
    const otherChips = [];
    for (const [key, value] of Object.entries(filterValues)) {

      if (key === '_autoSortField') continue;
      if (key === "adcategory") continue;
      if (key === "subcategory") {
        if (Array.isArray(value)) {
          for (const v of value) {
            if (absorbed.has(v)) continue;
            // Orphan subcategory — its parent isn't selected. Render as a
            // standalone chip so the user can still see/remove it.
            const displayLabel =
              filterOptionLabels.subcategory?.[String(v)] ?? String(v);
            otherChips.push({
              type: "chip",
              filterId: "subcategory",
              value: v,
              label: displayLabel,
            });
          }
        }
        continue;
      }
      if (DATE_FILTER_KEYS[key] && Array.isArray(value) && value.length === 2) {
        const label = `${DATE_FILTER_KEYS[key]}: ${formatUnixDate(value[1])} - ${formatUnixDate(value[0])}`;
        otherChips.push({ type: "chip", filterId: key, value: "__date_range__", label });
        continue;
      }
      const rangeLabel = RANGE_FILTER_KEYS[key];
      const isNumericPair =
        Array.isArray(value) &&
        value.length === 2 &&
        value.every((v) => v !== null && v !== undefined && !isNaN(Number(v)));
      if (isNumericPair && (rangeLabel || !value.every((v) => String(v).length > 8))) {
        const [lo, hi] = value;
        const loStr = formatRangeValue(lo);
        const hiStr = formatRangeValue(hi);
        if (loStr !== null || hiStr !== null) {
          const displayLabel =
            rangeLabel || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
          const label = `${displayLabel}: ${loStr ?? "0"} - ${hiStr ?? "∞"}`;
          otherChips.push({ type: "chip", filterId: key, value: "__range__", label });
        }
        continue;
      }
      if (Array.isArray(value) && value.length > 0) {
        const categoryLabel = filterCategoryLabels[key];
        value.forEach((v) => {
          const displayLabel = filterOptionLabels[key]?.[String(v)] ?? v;
          const label = categoryLabel ? `${categoryLabel}: ${displayLabel}` : displayLabel;
          otherChips.push({ type: "chip", filterId: key, value: v, label });
        });
        continue;
      }
      if (typeof value === "string" && value !== "" && value !== "NA") {
        if (key === "sorting") {
          const pretty = SORT_LABEL_MAP[value.toLowerCase()] ?? value;
          otherChips.push({
            type: "chip",
            filterId: key,
            value: "__single__",
            label: `Ordered By: ${pretty}`,
          });
          continue;
        }
        const categoryLabel = filterCategoryLabels[key];
        const displayLabel = filterOptionLabels[key]?.[value] ?? value;
        const label = categoryLabel ? `${categoryLabel}: ${displayLabel}` : displayLabel;
        otherChips.push({ type: "chip", filterId: key, value: "__single__", label });
        continue;
      }
      if (value === true && filterToggleLabels[key]) {
        otherChips.push({
          type: "chip",
          filterId: key,
          value: "__toggle__",
          label: filterToggleLabels[key],
        });
      }
    }

    return [...groups, ...otherChips.reverse()];
  }, [
    filterValues,
    parentToLeaves,
    filterToggleLabels,
    filterOptionLabels,
    filterCategoryLabels,
    expandedParent,
  ]);

  const removeChip = (filterId, chipValue) => {
    if (chipValue === "__date_range__" || chipValue === "__range__" || chipValue === "__toggle__") {
      setFilter(filterId, false);
      return;
    }
    if (chipValue === "__single__") {
      setFilter(filterId, "");
      // Legacy: an `adcategory` stored as a single string (older localStorage).
      // Removing that chip should also drop its children from `subcategory`.
      if (filterId === "adcategory") {
        setFilter("subcategory", []);
      }
      return;
    }
    const current = filterValues[filterId];
    if (Array.isArray(current)) {
      setFilter(
        filterId,
        current.filter((v) => v !== chipValue),
      );
      // `adcategory` now holds an array of parent categories. When a parent
      // chip is dismissed, also strip its leaves from `subcategory` so the
      // whole branch goes away together — otherwise orphaned child chips
      // linger with no parent context.
      if (filterId === "adcategory") {
        const allFilters = [
          ...(config?.searchbar?.flatMap((d) => d.filters || []) || []),
          ...(config?.navbar?.flatMap((d) => d.filters || []) || []),
          ...(config?.sidebar?.flatMap((d) => d.filters || []) || []),
        ];
        const nested = allFilters.find(
          (f) => f.type === "nested_select" || f.type === "nested_multiselect",
        );
        const parent = nested?.options?.find(
          (o) => (o.value ?? o.label) === chipValue,
        );
        if (parent) {
          const collectLeaves = (node) => {
            const kids = node.children || node.sub_options || [];
            if (kids.length === 0) return [node.value ?? node.label];
            return kids.flatMap(collectLeaves);
          };
          const leaves = collectLeaves(parent);
          if (leaves.length > 0) {
            const subs = Array.isArray(filterValues.subcategory)
              ? filterValues.subcategory
              : [];
            setFilter(
              "subcategory",
              subs.filter((v) => !leaves.includes(v)),
            );
          }
        }
      }
    }
  };

  const exportAdsToCSV = async () => {
    if (!ads || ads.length === 0) return;
    if (guest?.isRestricted || guest?.isPublicLanding) {
      guest?.showGuestWarning?.("Please login to export ads");
      return;
    }
    setExportLoading(true);
    let exportAds = ads;
    if (onExportAll) {
      const fetched = await onExportAll();
      if (fetched && fetched.length > 0) exportAds = fetched;
    }
    setExportLoading(false);

    const escapeVal = (val) => {
      if (val === null || val === undefined) return "";
      const str = String(val);
      return str.includes(",") || str.includes('"') || str.includes("\n")
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    };

    const targetKeyword =
      filterValues?.keyword ||
      filterValues?.search ||
      filterValues?.q ||
      "";
    const rawCountry =
      filterValues?.country ||
      filterValues?.countries ||
      filterValues?.geo ||
      "";
    const countries = Array.isArray(rawCountry)
      ? rawCountry.join(", ")
      : rawCountry;

    const headers = [
      "Sr. No",
      "Ad id",
      "Advertiser",
      "Keyword",
      "Target Keyword",
      "Ad Type",
      "Ad Position",
      "Platform",
      "Post Date",
      "Countries",
    ];

    const limitedExportAds = exportAds.slice(0, 100);
    const rows = limitedExportAds.map((ad, index) => {

      const keyword = Array.isArray(ad.keywords)
        ? ad.keywords.join(", ")
        : ad.keywords || "";
      return [
        index + 1,
        ad.adId || ad.id || "",
        ad.advertiser || "",
        keyword,
        targetKeyword,
        (ad.adType || "").toUpperCase(),
        (ad.adPosition || "").toUpperCase(),
        (ad.network || "").toUpperCase(),
        ad.date || ad.firstSeen || "",
        countries,
      ]
        .map(escapeVal)
        .join(",");
    });

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const platform = isAllActive
      ? "all"
      : (specificPlatforms[0] || activePlatforms[0] || "ads").toLowerCase();
    link.download = `ads_export_${platform}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const activePlatformLabel = activePlatforms[0] || "facebook";

  // Auto-reset sort when active tab is not valid for current platforms
  useEffect(() => {
    const currentTab = sortTabs.find((t) => (t.label ?? "") === activeTab);
    if (!currentTab) return;
    const applicability = currentTab.platform_applicability;
    if (!Array.isArray(applicability) || applicability.length === 0) return;
    const isValid = activePlatforms.some((p) =>
      applicability.map((a) => a.toLowerCase()).includes(p.toLowerCase())
    );
    if (!isValid) {
      const fallback = sortTabs.find((t) => {
        const ap = t.platform_applicability;
        return !Array.isArray(ap) || ap === "all" || ap.length === 0;
      });
      if (fallback) {
        setActiveTab(fallback.label ?? fallback.value);
        setSortBy(fallback.value ?? fallback.label);
      }
    }
  }, [activePlatforms, activeTab, sortTabs, setActiveTab, setSortBy]);

  const { t } = useTranslation();
  const [exportLoading, setExportLoading] = useState(false);

  // Detail modal state
  const [selectedAd, setSelectedAd] = useState(null);
  // Lets a parent-level navigation (e.g. jumping to the Ads Library from the
  // Keyword Explorer's "Top advertisers" list) dismiss this modal even though
  // it's local state — without lifting selectedAd up to App.jsx.
  useEffect(() => {
    if (closeDetailSignal) setSelectedAd(null);
  }, [closeDetailSignal]);
  // Stable card click handler so the memoized MasonryCard sees the same fn ref
  // across AdGrid re-renders triggered by unrelated state.
  const handleCardClick = useCallback((ad) => {
    if (guest?.isRestricted || guest?.isPublicLanding) {
      guest?.showGuestWarning?.("Please login to view ad details");
      return;
    }
    setSelectedAd(ad);
  }, [guest]);
  const [showAllChips, setShowAllChips] = useState(false);

  // Scroll to Top state
  const [showScrollTop, setShowScrollTop] = useState(false);

  // Preview mode — show original platform previews in the grid (lifted to App)

  // Build masonry items with estimated heights for Pinterest-style variation
  // Auto-height masonry: track real rendered heights per ad id
  const [measuredHeights, setMeasuredHeights] = useState({});
  const pendingMeasures = useRef({});
  const measureTimerRef = useRef(null);
  const handleItemMeasure = (id, height) => {
    pendingMeasures.current[id] = height;
    if (measureTimerRef.current) clearTimeout(measureTimerRef.current);
    measureTimerRef.current = setTimeout(() => {
      setMeasuredHeights((prev) => {
        const updates = pendingMeasures.current;
        pendingMeasures.current = {};
        let changed = false;
        const next = { ...prev };
        for (const [k, v] of Object.entries(updates)) {
          if (prev[k] !== v) {
            next[k] = v;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 50);
  };

  const masonryItems = useMemo(() => {
    return ads.map((ad) => {
      const idNum = parseInt(ad.id, 10) || 0;
      const platform = (ad.network || "").toLowerCase();
      const position = (ad.adPosition || "").toLowerCase();
      const adType = (ad.adType || "image").toLowerCase();

      if (previewMode) {
        // Heights tuned per platform preview — enough to show full content without cutoff
        const isVertical =
          platform === "tiktok" ||
          (platform === "instagram" &&
            (position.includes("stories") ||
              position.includes("story") ||
              position.includes("reel")));
        const isSideColumn =
          platform === "facebook" && position.includes("side");
        const isGoogleSearch =
          platform === "google" &&
          adType !== "display" &&
          adType !== "banner" &&
          !position.includes("display") &&
          !position.includes("banner");
        const isPinterest = platform === "pinterest";
        const isYtBanner =
          platform === "youtube" &&
          (adType === "banner" ||
            adType === "display" ||
            position.includes("banner") ||
            position.includes("display"));

        let height;
        if (isVertical) height = 700;
        else if (isSideColumn) height = 90;
        else if (isGoogleSearch) height = 240 + (ad.keywords ? 40 : 0);
        else if (isPinterest) height = 520;
        else if (isYtBanner) height = 340;
        else if (platform === "reddit") height = 560;
        else height = 640;

        return { ...ad, height };
      }

      // Placeholder height used for initial column placement before image loads
      const ratioHeights = {
        "9:16": 420,
        "4:5": 380,
        "1:1": 320,
        "16:9": 260,
        "3:2": 280,
      };
      const baseHeight =
        ratioHeights[ad.aspectRatio] || [300, 340, 280, 360, 320][idNum % 5];
      const contentHeight = 90 + (ad.cta ? 15 : 0) + (ad.runningDays ? 12 : 0);
      return { ...ad, height: baseHeight + contentHeight };
    });
  }, [ads, previewMode]);

  const scrollRef = useRef(null);
  const lastScrollTopRef = useRef(0);
  // The sticky-header collapse/expand changes the scroll container's height,
  // which clamps scrollTop and emits "phantom" scroll events. We remember the
  // last seen scrollHeight/clientHeight so we can tell a genuine user scroll
  // from one of these layout-induced clamps (also fired while masonry images
  // measure in) and skip the header toggle for the latter — otherwise a toggle
  // feeds straight back into the opposite toggle: the top-bar "jump" loop.
  const lastScrollHeightRef = useRef(0);
  const lastClientHeightRef = useRef(0);
  const hasMoreRef = useRef(hasMore);
  const loadingMoreRef = useRef(loadingMore);
  hasMoreRef.current = hasMore;
  loadingMoreRef.current = loadingMore;

  // Synchronous lock that serializes page bumps. `loadingMore` is React state,
  // so it only flips to true on the next render — in the gap between issuing a
  // bump and that re-render, fast scroll events (or the auto-bump) would fire
  // additional `setPage` calls, launching overlapping page fetches that abort
  // each other and drop pages (the random "11 vs 18 cards" jitter). This ref
  // flips the instant a bump is issued and clears when the load completes, so
  // only one page is ever in flight.
  const bumpLockRef = useRef(false);
  useEffect(() => {
    if (!loadingMore) bumpLockRef.current = false;
  }, [loadingMore]);

  // Infinite scroll — triggers when within 400px of the bottom
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;

      // Handle sticky header toggle (Hide on scroll down, Show on ANY scroll up)
      if (onScrollChange) {
        const delta = scrollTop - lastScrollTopRef.current;
        // A change in scrollHeight/clientHeight since the previous event means
        // this scroll was caused by a layout shift — the header's own collapse/
        // expand, or masonry items measuring in — not by the user. Toggling on
        // those is what creates the feedback "jump" loop, so react to genuine
        // user scrolls only.
        const layoutShifted =
          scrollHeight !== lastScrollHeightRef.current ||
          clientHeight !== lastClientHeightRef.current;

        lastScrollTopRef.current = scrollTop;
        lastScrollHeightRef.current = scrollHeight;
        lastClientHeightRef.current = clientHeight;

        // Only collapse when enough scrollable overflow remains after the
        // header reveals its height (~280px). Otherwise collapsing makes the
        // content fit exactly, the scrollbar vanishes, no further scroll events
        // fire, and the header can never be scrolled back — stuck-collapsed
        // until refresh. Short result sets keep the header (and search) shown.
        const COLLAPSE_MIN_OVERFLOW = 280;
        const overflow = scrollHeight - clientHeight;

        if (!layoutShifted && Math.abs(delta) > 4) {
          if (
            delta > 0 &&
            scrollTop > 80 &&
            !isHeaderScrolled &&
            overflow > COLLAPSE_MIN_OVERFLOW
          ) {
            onScrollChange(true);
          } else if (delta < 0 && isHeaderScrolled) {
            onScrollChange(false);
          }
        }
      }

      setShowScrollTop(scrollTop > 500);

      if (
        scrollHeight - (scrollTop + clientHeight) < 2800 &&
        hasMoreRef.current &&
        !loadingMoreRef.current &&
        !bumpLockRef.current
      ) {
        bumpLockRef.current = true;
        setPage((p) => p + 1);
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [setPage, isHeaderScrolled, onScrollChange]);

  // Universal Reset for scroll, header, and layout measurements immediately on fresh search fetch (page 0)
  useEffect(() => {
    if (ads.length === 0 && loadingMoreRef.current) {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
      if (onScrollChange) {
        onScrollChange(false);
      }
      // Clear layout measurements for the new context
      setMeasuredHeights({});
      pendingMeasures.current = {};
    }
  }, [ads.length, loadingMore, onScrollChange]);

  // If client-side filtering (e.g. hiding pas* media) trims most ads from a page,
  // the container may not be tall enough to scroll — so the scroll handler never
  // fires and more pages never load. Auto-bump page until the container fills or
  // the backend says hasMore=false.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    if (!hasMore || loadingMore || ads.length === 0 || bumpLockRef.current) return;
    const id = requestAnimationFrame(() => {
      const { scrollHeight, clientHeight } = container;
      if (scrollHeight <= clientHeight + 100 && !bumpLockRef.current) {
        bumpLockRef.current = true;
        setPage((p) => p + 1);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [ads.length, hasMore, loadingMore, measuredHeights, setPage]);

  return (
    <div className="flex-1 overflow-hidden relative bg-fixed flex flex-col">
      <div className="pb-2 pt-3 sm:px-5">
        {/* Dynamic Filter Bar Wrapper */}
        <div
          className={`transition-all duration-300 ease-in-out ${
            isHeaderScrolled
              ? "max-h-0 opacity-0 invisible overflow-hidden pointer-events-none mb-0"
              : "max-h-[200px] opacity-100 visible mb-3"
          }`}
        >
          <AdFilterBar
            sdui={sdui}
            platformOptions={platformOptions}
            specificPlatforms={specificPlatforms}
            handleAllClick={handleAllClick}
            handlePlatformClick={handlePlatformClick}
            isAllActive={isAllActive}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            previewMode={previewMode}
            setPreviewMode={setPreviewMode}
            sortTabs={sortTabs}
            PRIMARY_SORT_LABELS={PRIMARY_SORT_LABELS}
            onDateChange={onDateChange}
            isFilterRestricted={isFilterRestricted}
            onDateRestricted={onDateRestricted}
            onSortRestricted={onSortRestricted}
            guest={guest}
            DROPDOWN_SORT_LABELS={DROPDOWN_SORT_LABELS}
          />
        </div>

        {/* Row 2: Sort tabs */}
        {/* <div className="flex items-center gap-0.5 mb-6 px-3">
                {sortTabs.map(tab => {
                    const tabValue = tab.value ?? tab.label;
                    const tabLabel = tab.label ?? tab;
                    return (
                        <button
                            key={tabValue}
                            onClick={() => { setActiveTab(tabLabel); setSortBy(tabValue); }}
                            className={`px-2.5 py-1.5 rounded-lg text-[16px] font-black tracking-wider transition-all ${
                                activeTab === tabLabel ? 'bg-[#335296] text-white' : 'text-theme-text-secondary hover:text-theme-text hover:bg-theme-text/[0.04]'
                            }`}
                        >
                            {tabLabel}
                        </button>
                    );
                })}
            </div> */}
        <div className="flex flex-wrap items-start justify-between mt-3 gap-1 mb-2 px-3">
          <div className="px-3 py-1 flex flex-wrap items-center gap-2 max-w-full lg:max-w-[40%] xl:max-w-[50%] 2xl:max-w-[55%] max-h-[120px] 2xl:max-h-[150px] overflow-y-auto">
            {SHOW_TOTAL_ADS_COUNT && adsCount && (
              <span className="text-[14px] font-bold whitespace-nowrap text-theme-text capitalize tracking-widest mr-1">
                {isAllActive || specificPlatforms.length > 1 ? "Total Ads" : activePlatformLabel}
                {`: ${adsCount}`}
              </span>
            )}

            {(guest?.isRestricted || guest?.isPublicLanding) ? null : (showAllChips ? chipGroups : chipGroups.slice(0, 3)).map(
              (group, idx) => {
                if (group.type === "cluster") {
                  const parentValue = group.parent.value;
                  return (
                    <ChipCluster
                      key={`cluster-${parentValue}`}
                      parent={group.parent}
                      items={group.children}
                      isExpanded={expandedParent === parentValue}
                      onExpand={() => setExpandedParent(parentValue)}
                      onCollapse={() => setExpandedParent(null)}
                      onRemoveParent={() => removeChip("adcategory", parentValue)}
                      onRemoveChild={(childValue) => {
                        // Strip the leaf from subcategory, then mirror
                        // SchemaRenderer.handleChildChange: if no leaves of
                        // this parent remain selected, drop the parent from
                        // adcategory too so the cluster doesn't linger empty.
                        const currentSubs = Array.isArray(filterValues.subcategory)
                          ? filterValues.subcategory
                          : [];
                        const nextSubs = currentSubs.filter((v) => v !== childValue);
                        setFilter("subcategory", nextSubs);
                        const parentLeaves = (parentToLeaves[parentValue] || []).map(
                          (l) => l.value,
                        );
                        const parentStillHasChild = parentLeaves.some((l) =>
                          nextSubs.includes(l),
                        );
                        if (!parentStillHasChild) {
                          const currentParents = Array.isArray(filterValues.adcategory)
                            ? filterValues.adcategory
                            : [];
                          setFilter(
                            "adcategory",
                            currentParents.filter((p) => p !== parentValue),
                          );
                        }
                      }}
                    />
                  );
                }
                return (
                  <FilterChip
                    key={`${group.filterId}-${group.value}-${idx}`}
                    label={group.label}
                    onRemove={() => removeChip(group.filterId, group.value)}
                  />
                );
              },
            )}

            {chipGroups.length > 3 && (
              <button
                onClick={() => setShowAllChips(!showAllChips)}
                className="text-[10px] 2xl:text-xs text-white/50 hover:text-white/70 cursor-pointer transition-colors py-0.5 rounded-md ml-1"
              >
                {showAllChips ? "Show less" : `+${chipGroups.length - 3} more`}
              </button>
            )}
          </div>

          <div className="flex items-center flex-wrap gap-2">
            <div className={`transition-all duration-300 ease-in-out ${
              isHeaderScrolled
                ? "max-h-0 opacity-0 invisible overflow-hidden pointer-events-none"
                : "max-h-[100px] opacity-100 visible"
            }`}>
              <button
                onClick={exportAdsToCSV}
                disabled={!ads || ads.length === 0 || exportLoading}
                title="Export first 100 ads as CSV"
                className="notranslate flex items-center gap-1.5 px-3 py-1.5 text-xs border border-white/10 2xl:text-[14px] bg-theme-card font-bold whitespace-nowrap transition-colors rounded-lg text-theme-text hover:text-[#6b99ff] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {exportLoading ? <RefreshCw size={13} className="animate-spin" /> : <FileDown size={13} />}
                <span>{exportLoading ? "..." : "Export_ads"}</span>
              </button>
            </div>
            {" "}
            {sortTabs
              .filter((t) => {
                // Filter by platform_applicability
                const applicability = t.platform_applicability;
                if (Array.isArray(applicability) && applicability.length > 0) {
                  const matches = activePlatforms.some((p) =>
                    applicability.map((a) => a.toLowerCase()).includes(p.toLowerCase())
                  );
                  if (!matches) return false;
                }
                return (
                  PRIMARY_SORT_LABELS.includes((t.label ?? "").toLowerCase()) ||
                  PRIMARY_SORT_LABELS.includes((t.value ?? "").toLowerCase())
                );
              })
              .map((tab) => {
                const tabValue = tab.value ?? tab.label;
                const tabLabel = tab.label ?? tab;
                return (
                  <button
                    key={tabValue}
                    disabled={activeTab === tabLabel}
                    onClick={() => {
                      if (guest?.showGuestWarning("Please login to change sorting")) return;
                      setActiveTab(tabLabel);
                      setSortBy(tabValue);
                    }}
                    className={`flex items-center gap-1 px-3 py-1.5 text-xs border border-white/10 2xl:text-[14px] bg-theme-card font-bold whitespace-nowrap transition-colors rounded-lg ${
                      activeTab === tabLabel ? "text-[#6b99ff] cursor-default" : "text-theme-text hover:text-[#6b99ff]"
                    }`}
                  >
                    {tabLabel}
                  </button>
                );
              })}
          </div>
        </div>
      </div>

      {/* Scrollable content area — disable scrolling when there's nothing to scroll
          through (empty / error states), so the infinite-scroll handler can't fire
          spurious page-bumps that cause flicker at high browser zoom levels. */}
      <div
        className={`px-5 pb-5 flex-1 ${ads.length > 0 ? "overflow-y-auto" : "overflow-hidden"}`}
        ref={scrollRef}
      >
        {/* Error state */}
        {error && !loadingMore && (
          <div className="flex flex-col items-center justify-center py-32 gap-5">
            <div className="w-20 h-20 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <AlertTriangle size={36} className="text-red-400" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-lg font-bold text-theme-text-muted">
                Something went wrong
              </h3>
              <p className="text-xs text-theme-text-muted max-w-sm leading-relaxed">
                {error}
              </p>
            </div>
            {onRetry && (
              <button
                onClick={onRetry}
                className="mt-2 px-5 py-2 rounded-lg bg-[#335296] hover:bg-[#3762c1] text-xs font-semibold text-white transition-all flex items-center gap-2"
              >
                <RefreshCw size={14} /> Try Again
              </button>
            )}
          </div>
        )}

        {/* Platform suggestion banner — pinned to top */}
        {!error &&
          ads.length === 0 &&
          !loadingMore &&
          (() => {
            const metaAdsLibActive = !!(filterValues?.meta_ads_lib_filter || filterValues?.meta_ads_lib);
            const metaAdsLibPlatforms = ['facebook', 'instagram'];
            const isActiveFilterVal = (v) => {
              if (!v) return false;
              if (Array.isArray(v)) return v.length > 0 && !v.every(x => x === 'NA' || x === '' || x == null);
              return v !== 'NA' && v !== '';
            };
            const adBudgetActive = ['adBudget', 'avg_ad_budget', 'ad_budget', 'budget'].some(k => isActiveFilterVal(filterValues?.[k]));
            const adBudgetPlatforms = ['facebook', 'instagram', 'youtube'];
            const platformsWithAds =
              adsMeta && typeof adsMeta === "object"
                ? Object.entries(adsMeta)
                    .filter(([platform, count]) => {
                      if (count <= 0 || activePlatforms.includes(platform)) return false;
                      if (metaAdsLibActive && !activePlatforms.some(p => metaAdsLibPlatforms.includes(p.toLowerCase()))) {
                        return metaAdsLibPlatforms.includes(platform.toLowerCase());
                      }
                      if (adBudgetActive && !adBudgetPlatforms.includes(platform.toLowerCase())) return false;
                      return true;
                    })
                    .map(([platform, count]) => ({ platform, count }))
                : [];
            if (platformsWithAds.length === 0) return null;
            return (
              <div className="mb-4 px-6 py-4 bg-[#131313] border border-[#222] rounded-xl flex items-center justify-between flex-wrap gap-3">
                <p className="text-xs text-theme-text-muted">
                  We have ads for this search in{" "}
                  <span className="text-[#6b99ff] font-semibold">
                    {platformsWithAds
                      .map(
                        (p) =>
                          p.platform.charAt(0).toUpperCase() +
                          p.platform.slice(1),
                      )
                      .join(", ")}
                  </span>
                  . Do you want to see them?
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  {platformsWithAds.map(({ platform, count }) => (
                    <button
                      key={platform}
                      onClick={() => {
                        if (
                          allowedPlatforms &&
                          allowedPlatforms.length > 0 &&
                          !allowedPlatforms.includes(platform)
                        ) {
                          onPlatformRestricted?.();
                          return;
                        }
                        setSpecificPlatforms([platform]);
                        setActivePlatforms([platform]);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[#335296]/10 border border-[#3759a3]/20 text-[11px] font-bold text-[#6b99ff] hover:bg-[#335296]/20 hover:border-[#3759a3]/40 transition-all"
                    >
                      {platform.charAt(0).toUpperCase() + platform.slice(1)}
                      {count > 0 && (
                        <span className="ml-1 text-theme-text-muted">
                          (
                          {count >= 1000
                            ? `${(count / 1000).toFixed(1)}K`
                            : count}
                          )
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

        {/* Low-volume network coverage note (PRD FR-11) — replaces the generic
            empty state below when every active platform is a known low-volume
            network, so the message explains the sparse coverage rather than
            implying the search terms were wrong. */}
        {!error && ads.length === 0 && !loadingMore && activePlatforms.length > 0 &&
          activePlatforms.every((p) => LOW_VOLUME_NETWORKS.includes(p.toLowerCase())) && (
          <div className="flex flex-col items-center justify-center py-32 gap-5">
            <div className="w-20 h-20 rounded-2xl bg-theme-surface border border-theme-border flex items-center justify-center">
              <Radar size={36} className="text-theme-text-muted" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-lg font-bold text-theme-text-muted">
                Coverage on {activePlatforms.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(", ")} is still ramping up
              </h3>
              <p className="text-xs text-theme-text-muted max-w-sm leading-relaxed">
                These networks have lower ad volume on PowerAdSpy than Facebook or Google today. Try broadening your search terms or date range, or check another network for more results.
              </p>
            </div>
            <button
              onClick={() => {
                if (onClearAll) onClearAll();
                else if (sdui.clearAll) sdui.clearAll();
              }}
              className="mt-2 px-5 py-2 rounded-lg bg-theme-surface border border-theme-border text-xs font-semibold text-theme-text-muted hover:text-theme-text hover:border-theme-text-muted transition-all"
            >
              Broaden search
            </button>
          </div>
        )}

        {/* Empty state (generic) */}
        {!error && ads.length === 0 && !loadingMore &&
          !(activePlatforms.length > 0 && activePlatforms.every((p) => LOW_VOLUME_NETWORKS.includes(p.toLowerCase()))) && (
          <div className="flex flex-col items-center justify-center py-32 gap-5">
            <div className="w-20 h-20 rounded-2xl bg-theme-surface border border-theme-border flex items-center justify-center">
              <SearchX size={36} className="text-theme-text-muted" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-lg font-bold text-theme-text-muted">
                No ads found
              </h3>
              <p className="text-xs text-theme-text-muted max-w-sm leading-relaxed">
                Try adjusting your filters, changing the platform, or searching
                with different keywords.
              </p>
            </div>
            <button
              onClick={() => {
                if (onClearAll) onClearAll();
                else if (sdui.clearAll) sdui.clearAll();
              }}
              className="mt-2 px-5 py-2 rounded-lg bg-theme-surface border border-theme-border text-xs font-semibold text-theme-text-muted hover:text-theme-text hover:border-theme-text-muted transition-all"
            >
              Clear all filters
            </button>
          </div>
        )}

        {/* Hidden ads notice — removed per product decision */}
        {/* {hiddenCount > 0 && ads.length > 0 && isSearchActive && (
          <div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
            <EyeOff size={13} className="shrink-0" />
            <span>
              {hiddenCount} ad{hiddenCount > 1 ? 's are' : ' is'} hidden from these results.{' '}
              <button
                onClick={() => window.location.href = '/saved'}
                className="underline underline-offset-2 hover:text-amber-300 transition-colors"
              >
                Manage hidden ads
              </button>
            </span>
          </div>
        )} */}

        {/* Masonry Grid */}
        {ads.length > 0 && (
          <Masonry
            key={`${activePlatforms.join(",")}-${activeTab}`}
            items={masonryItems}
            ease="power3.out"
            duration={0.6}
            stagger={0.05}
            animateFrom="bottom"
            scaleOnHover={false}
            blurToFocus={false}
            columnConfig={
              previewMode ? { values: [3, 3, 2, 1], default: 1 } : null
            }
            gap={6}
            autoHeight={!previewMode}
            measuredHeights={measuredHeights}
            onItemMeasure={handleItemMeasure}
            loading={loadingMore && ads.length > 0}
            renderItem={(item) =>
              previewMode ? (
                <div
                  className="h-full cursor-pointer overflow-hidden"
                  onClick={() => setSelectedAd(item)}
                >
                  <OriginalPreview ad={item} fillWidth />
                </div>
              ) : (
                <MasonryCard
                  ad={item}
                  isFavourite={favouriteAdIds.has(`${(item.network || '').toLowerCase()}:${Number(item.adId || item.id)}`)}
                  onToggleFavourite={onToggleFavourite}
                  onSearch={onSearch}
                  onOpenAdvertiserProfile={onOpenAdvertiserProfile}
                  onOpenKeywordExplorer={onOpenKeywordExplorer}
                  onClick={handleCardClick}
                  onHideAd={onHideAd}
                  onHideAdvertiser={onHideAdvertiser}
                  guest={guest}
                />
              )
            }
          />
        )}

        {/* Skeleton loader — shown when loading with no existing ads */}
        {loadingMore && ads.length === 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={`skeleton-${i}`}
                className="flex flex-col bg-theme-card rounded-xl border border-theme-border overflow-hidden"
              >
                <div
                  className="masonry-shimmer-line"
                  style={{
                    height: [200, 260, 180, 300, 240][i % 5],
                    borderRadius: 0,
                  }}
                />
                <div className="p-2.5 flex flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <div className="masonry-shimmer-line w-4 h-4 !rounded-full" />
                    <div className="masonry-shimmer-line h-2 w-16" />
                  </div>
                  <div className="masonry-shimmer-line h-2.5 w-full" />
                  <div className="masonry-shimmer-line h-2.5 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Infinite scroll indicator */}
        <div className="flex items-center justify-center mt-6 pb-2">
          {!hasMore && ads.length > 0 && !isLanding && (
            (guest?.isRestricted || guest?.isPublicLanding) ? (
              <span className="text-[13px] font-semibold text-theme-text-muted">
                Please login to view more ads
              </span>
            ) : (
              <span className="text-[11px] text-theme-text-muted">No more ads</span>
            )
          )}
        </div>

        {/* Ad Detail Modal — shown on card click */}
        <AdDetailModal
          ad={selectedAd}
          onClose={() => setSelectedAd(null)}
          isFavourite={
            selectedAd
              ? favouriteAdIds.has(`${(selectedAd.network || '').toLowerCase()}:${Number(selectedAd.adId || selectedAd.id)}`)
              : false
          }
          onToggleFavourite={onToggleFavourite}
          onAnalytics={onAnalyticsAd}
          onSearch={onSearch}
          onHideAd={onHideAd}
          onHideAdvertiser={onHideAdvertiser}
          guest={guest}
          onPrev={() => {
            const idx = ads.findIndex((a) => a.id === selectedAd?.id);
            if (idx > 0) setSelectedAd(ads[idx - 1]);
          }}
          onNext={() => {
            const idx = ads.findIndex((a) => a.id === selectedAd?.id);
            if (idx < ads.length - 1) setSelectedAd(ads[idx + 1]);
          }}
          hasPrev={ads.findIndex((a) => a.id === selectedAd?.id) > 0}
          hasNext={
            ads.findIndex((a) => a.id === selectedAd?.id) < ads.length - 1
          }
        />

        {/* Scroll to Top Arrow */}
        <button
          onClick={() => {
            if (scrollRef.current) {
              scrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
            }
          }}
          className={`absolute bottom-24 right-6 w-[55px] h-[55px] flex items-center justify-center rounded-full bg-white border-theme-border text-[#335296] shadow-lg hover:bg-theme-surface/80 hover:border-theme-text-muted transition-all duration-300 z-40 ${
            showScrollTop
              ? "opacity-100 visible translate-y-0"
              : "opacity-0 invisible translate-y-4"
          }`}
        >
          <ArrowUp className="size-6.5" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
};

export default AdGrid;
