import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useSelector, useDispatch } from "react-redux";
import { Heart, EyeOff } from "lucide-react";
import { fetchAds } from "../../services/api";
import PlatformTab from "../shared/PlatformTab";
import Masonry from "./Masonry";
import MasonryCard from "./MasonryCard";
import AdDetailModal from "./AdDetailModal";
import { PLATFORMS } from "../../constants";
import { setSpecificPlatforms as setReduxPlatforms, setSavedAdsTab } from "../../store/uiSlice";


// ── Skeleton card ──────────────────────────────────────────────────────────────
const ShimmerBlock = ({ className = "", style }) => (
  <div
    className={`relative overflow-hidden bg-white/[0.05] rounded-lg ${className}`}
    style={style}
  >
    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent -translate-x-full animate-shimmer" />
  </div>
);

const SavedAdCardSkeleton = ({ height = 200 }) => (
  <div className="rounded-2xl overflow-hidden border border-white/[0.08] bg-[#0f111a]/80">
    <ShimmerBlock style={{ height }} className="rounded-none" />
    <div className="p-3 flex items-center gap-2.5">
      <ShimmerBlock className="w-8 h-8 rounded-full flex-shrink-0" />
      <div className="flex flex-col gap-2 flex-1">
        <ShimmerBlock className="h-3 w-3/5" />
        <ShimmerBlock className="h-2.5 w-2/5" />
      </div>
    </div>
  </div>
);

// Varying heights to mimic masonry — enough to fill 5 columns × 3 rows
const SKELETON_HEIGHTS = [200, 260, 180, 300, 220, 240, 190, 270, 210, 250, 185, 230, 195, 280, 215];

// ── Tabs config ────────────────────────────────────────────────────────────────
const TABS = [
  { id: "favourites", label: "Favourites", icon: Heart, apiKey: "favorite" },
  { id: "hidden", label: "Hidden", icon: EyeOff, apiKey: "hidden" },
];

const PAGE_SIZE = 9;

// ── Main page ──────────────────────────────────────────────────────────────────
const SavedAdsPage = ({
  sdui,
  favouriteAdIds = new Set(),
  hiddenAdvertiserIds = new Set(),
  onToggleFavourite,
  onUnHideAd,
  onHideAdvertiser,
  onAnalyticsAd,
  onSearch,
  closeDetailSignal,
}) => {
  const dispatch = useDispatch();
  const reduxPlatforms = useSelector((s) => s.ui.specificPlatforms);
  const reduxSavedAdsTab = useSelector((s) => s.ui.savedAdsTab);

  const [activeTab, setActiveTab] = useState(reduxSavedAdsTab || "favourites");

  const [selectedAd, setSelectedAd] = useState(null);
  // Lets a parent-level navigation (e.g. jumping to the Ads Library from the
  // Keyword Explorer's "Top advertisers" list) dismiss this modal even though
  // it's local state — without lifting selectedAd up to App.jsx.
  useEffect(() => {
    if (closeDetailSignal) setSelectedAd(null);
  }, [closeDetailSignal]);
  const [specificPlatforms, setSpecificPlatforms] = useState(reduxPlatforms);
  const [ads, setAds] = useState([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [removingIds, setRemovingIds] = useState(new Set());
  const scrollRef = useRef(null);
  const isFetchingRef = useRef(false);

  // Auto-height masonry — same pattern as AdGrid
  // Refs for scroll handler — avoids stale closure issues (same pattern as AdGrid)
  const hasMoreRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const pageRef = useRef(0);
  const activeTabRef = useRef("favourites");
  const specificPlatformsRef = useRef([]);
  const sduiRef = useRef(sdui);
  const allPlatformValuesRef = useRef([]);
  hasMoreRef.current = hasMore;
  loadingMoreRef.current = loadingMore;
  pageRef.current = page;
  activeTabRef.current = activeTab;
  specificPlatformsRef.current = specificPlatforms;
  sduiRef.current = sdui;

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
          if (prev[k] !== v) { next[k] = v; changed = true; }
        }
        return changed ? next : prev;
      });
    }, 50);
  };

  // Build platform options from SDUI config (same as AdGrid)
  const platformsDoc = sdui?.config?.navbar?.find((d) => d._id === "platforms");
  const platformFilter = platformsDoc?.filters?.[0];
  const platformOptions = useMemo(() => {
    const opts = platformFilter?.options || [];
    if (opts.length === 0 || opts.some((o) => (o.value || "").toLowerCase() === "tiktok")) return opts;
    return [...opts, { value: "tiktok", label: "TT", icon_url: null }];
  }, [platformFilter]);

  const allPlatformValues = useMemo(() => {
    if (platformOptions.length > 0) return platformOptions.map((o) => o.value ?? o.label);
    return PLATFORMS.map((p) => p.id.toLowerCase());
  }, [platformOptions]);
  allPlatformValuesRef.current = allPlatformValues;

  const isAllActive = specificPlatforms.length === 0;

  // Keep sdui.activePlatforms in sync alongside the redux specificPlatforms.
  // The Ad Lib (AdGrid) fetch effect keys on sdui.activePlatforms, not on
  // specificPlatforms — so without this, switching platforms here updates only
  // the tab highlight and leaves the Ad Lib grid showing stale ads from the
  // previously selected platform after navigating back.
  const handleAllClick = () => {
    setSpecificPlatforms([]);
    dispatch(setReduxPlatforms([]));
    sdui.setActivePlatforms?.(allPlatformValues);
  };
  // Single-select in Fav Ads: picking a platform REPLACES the current selection
  // (so switching GDN → Google auto-closes GDN instead of stacking both). Clicking
  // the already-active platform clears back to "All". Ad Lib keeps its own
  // multi-select handler in App.jsx — this only changes the Fav Ads tabs.
  const handlePlatformClick = (val) => {
    setSpecificPlatforms((prev) => {
      const next = prev.length === 1 && prev[0] === val ? [] : [val];
      dispatch(setReduxPlatforms(next));
      sdui.setActivePlatforms?.(next.length > 0 ? next : allPlatformValues);
      return next;
    });
  };

  // Fresh load — resets ads list. Uses refs to avoid stale closure issues.
  const loadFresh = useCallback(async (tab, platforms) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setLoading(true);
    setError(null);
    setAds([]);
    setPage(0);
    setHasMore(true);
    // Reset pending-removal flags — they're keyed by adId and would otherwise
    // bleed across tabs (e.g. an ad favourited from Hidden reappears in
    // Favourites still dim because its key lingered in removingIds).
    setRemovingIds(new Set());
    try {
      const sdui = sduiRef.current;
      const allPlatforms = allPlatformValuesRef.current;
      const activePlatforms = platforms.length > 0 ? platforms : allPlatforms;
      // Don't spread sdui.filterValues here — sidebar filters (language, gender, etc.)
      // are restricted per-plan and would trigger a 403 on the saved ads endpoint.
      // Saved ads only need platform, sort, and pagination context.
      const payload = {
        activePlatforms,
        activePlatform: activePlatforms[0],
        selCategories: sdui.selCategories,
        selCountries: sdui.selCountries,
        sortBy: sdui.sortBy,
        favorite: tab === "favourites",
        hidden: tab === "hidden",
        skip: 0,
      };
      const result = await fetchAds(payload);
      const fetched = result.ads || [];
      // Deduplicate by adId — API can return duplicates when pagination boundaries shift
      const seen = new Set();
      const unique = fetched.filter((ad) => {
        const key = String(ad.adId || ad.id || "");
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setAds(unique);
      setPage(1);
      setHasMore(fetched.length >= PAGE_SIZE);
    } catch {
      setError("Failed to load ads. Please try again.");
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, []);

  // Load more — reads from refs to avoid stale closures
  const loadMore = useCallback(async () => {
    if (isFetchingRef.current || !hasMoreRef.current || loadingMoreRef.current) return;
    isFetchingRef.current = true;
    setLoadingMore(true);
    try {
      const platforms = specificPlatformsRef.current;
      const activePlatforms = platforms.length > 0 ? platforms : allPlatformValuesRef.current;
      const tab = activeTabRef.current;
      // Same as loadFresh: omit sdui.filterValues to avoid restricted-filter 403s
      const payload = {
        activePlatforms,
        activePlatform: activePlatforms[0],
        selCategories: sdui.selCategories,
        selCountries: sdui.selCountries,
        sortBy: sdui.sortBy,
        favorite: tab === "favourites",
        hidden: tab === "hidden",
        skip: pageRef.current,
      };
      const result = await fetchAds(payload);
      const fetched = result.ads || [];
      setAds((prev) => {
        const existingIds = new Set(prev.map((a) => String(a.adId || a.id || "")));
        const unique = fetched.filter((a) => {
          const key = String(a.adId || a.id || "");
          return key && !existingIds.has(key);
        });
        return [...prev, ...unique];
      });
      setPage((prev) => prev + 1);
      setHasMore(fetched.length >= PAGE_SIZE);
    } catch {
      // silently fail on load more
    } finally {
      setLoadingMore(false);
      isFetchingRef.current = false;
    }
  }, []);

  // Re-fetch fresh when tab or platform changes
  useEffect(() => {
    if (allPlatformValuesRef.current.length > 0) {
      loadFresh(activeTab, specificPlatforms);
    }
  }, [activeTab, specificPlatforms, allPlatformValues.length, loadFresh]);

  // Scroll listener — set up once, reads live values via refs
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      if (
        el.scrollHeight - (el.scrollTop + el.clientHeight) < 400 &&
        hasMoreRef.current &&
        !loadingMoreRef.current
      ) {
        loadMore();
      }
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [loadMore]);

  const masonryItems = useMemo(() => ads.map((ad) => {
    const id = String(ad.adId || ad.id || "");
    const idNum = parseInt(id, 10) || 0;
    const hasMedia = ad.thumbnail || ad.imageUrl || ad.videoUrl || ad.image_url || ad.video_url;
    const adType = (ad.adType || ad.type || "").toLowerCase();
    const isTextOnly = adType === "text" || (!hasMedia && adType !== "video" && adType !== "image");
    if (isTextOnly) return { ...ad, id, height: 180 };
    const ratioHeights = { "9:16": 420, "4:5": 380, "1:1": 320, "16:9": 260, "3:2": 280 };
    const baseHeight = ratioHeights[ad.aspectRatio] || [300, 340, 280, 360, 320][idNum % 5];
    return { ...ad, id, height: baseHeight + 90 };
  }), [ads]);

  // Pre-seed measuredHeights with estimated heights as soon as new items arrive.
  // Prevents the grid jumping: undefined(300) → estimate → real height.
  useEffect(() => {
    setMeasuredHeights((prev) => {
      const next = { ...prev };
      let changed = false;
      masonryItems.forEach((item) => {
        if (next[item.id] === undefined) {
          next[item.id] = item.height;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [masonryItems]);

  // Clean up measuredHeights for ads that were removed (e.g. unfavorited)
  useEffect(() => {
    const currentIds = new Set(masonryItems.map((i) => i.id));
    setMeasuredHeights((prev) => {
      const next = { ...prev };
      let changed = false;
      Object.keys(next).forEach((id) => {
        if (!currentIds.has(id)) { delete next[id]; changed = true; }
      });
      return changed ? next : prev;
    });
  }, [masonryItems]);

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden bg-theme-bg">
      {/* Toolbar */}
      <div className="px-5 pt-3 pb-3 border-b border-theme-border">
        <div className="flex flex-wrap items-center gap-2">
          {/* Platform tabs */}
          <div className="flex items-center min-w-0 flex-1">
            <div className="flex w-fit bg-theme-card rounded-xl gap-0.5 border p-1 hide-scrollbar border-theme-border overflow-x-auto ">
              <PlatformTab
                label="All"
                active={isAllActive}
                activeBg="#3352964d"
                activeBorder="rgba(99,102,241,0.5)"
                onClick={handleAllClick}
              />
              {(platformOptions.length > 0
                ? platformOptions
                : PLATFORMS.map((p) => ({ value: p.id.toLowerCase(), label: p.label, _fallback: p }))
              ).map((opt) => {
                const value = opt.value ?? opt.label;
                const fallback = opt._fallback || PLATFORMS.find((f) => f.id.toLowerCase() === value.toLowerCase()) || {};
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
                  />
                );
              })}
            </div>
          </div>

          {/* Favourite/Hidden tabs — right side */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex gap-1">
              {TABS.map(({ id, label, icon: Icon }) => {
                const isActive = activeTab === id;
                return (
                  <button
                    key={id}
                    onClick={() => { setActiveTab(id); dispatch(setSavedAdsTab(id)); }}
                    className={`flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold rounded-lg border transition-all ${isActive
                      ? "text-[#6b99ff] border-[#6b99ff]/40 bg-[#3762c1]/10"
                      : "text-theme-text-muted border-transparent hover:text-theme-text hover:bg-theme-text/[0.04]"
                      }`}
                  >
                    <Icon size={14} className={id === "favourites" && isActive ? "fill-[#6b99ff]" : ""} />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

        </div>
      </div>


      {/* Content — only scroll when there's content to scroll through, so the
          infinite-scroll handler can't fire spurious page-bumps in empty states. */}
      <div
        ref={scrollRef}
        className={`flex-1 p-6 w-full ${ads.length > 0 ? "overflow-y-auto" : "overflow-hidden"}`}
      >
        {loading ? (
          <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-4">
            {SKELETON_HEIGHTS.map((h, i) => (
              <div key={i} className="break-inside-avoid mb-4">
                <SavedAdCardSkeleton height={h} />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-theme-text-muted">
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={() => loadFresh(activeTab, specificPlatforms)}
              className="px-4 py-1.5 text-xs bg-[#3762c1]/20 text-[#6b99ff] rounded-lg hover:bg-[#3762c1]/30 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : ads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-theme-text-muted">
            {activeTab === "favourites" ? (
              <>
                <Heart size={40} className="opacity-20" />
                <p className="text-sm font-medium">No favourite ads yet</p>
                <p className="text-xs opacity-60">Click the heart icon on any ad to save it here</p>
              </>
            ) : (
              <>
                <EyeOff size={40} className="opacity-20" />
                <p className="text-sm font-medium">No hidden ads</p>
                <p className="text-xs opacity-60">Hidden ads will appear here</p>
              </>
            )}
          </div>
        ) : (
          <Masonry
            items={masonryItems}
            autoHeight
            measuredHeights={measuredHeights}
            onItemMeasure={handleItemMeasure}
            loading={loadingMore && ads.length > 0}
            renderItem={(item) => {
              const isRemoving = removingIds.has(item.id);
              const isFav = activeTab === "favourites" || favouriteAdIds.has(Number(item.adId)) || favouriteAdIds.has(String(item.adId));
              const isAdvHidden = item.hideType === 1;
              return (
                <div className={`transition-opacity duration-200 ${isRemoving ? "opacity-40 pointer-events-none" : "opacity-100"}`}>
                  <MasonryCard
                    ad={item}
                    isFavourite={isFav}
                    isHidden={activeTab === "hidden"}
                    isAdvertiserHidden={isAdvHidden}
                    onToggleFavourite={async (ad) => {
                      const key = String(ad.adId || ad.id || "");
                      if (removingIds.has(key)) return;
                      setRemovingIds((prev) => new Set([...prev, key]));
                      try {
                        if (activeTab === "hidden") {
                          // Favouriting from the Hidden tab moves the ad into
                          // Favourites — so it must also be unhidden, otherwise
                          // it lingers in both lists. Unhide FIRST, then
                          // favourite, so favourite is the last write (and the
                          // surviving "Added to Favourites" toast).
                          await onUnHideAd({ ...ad, hideType: isAdvHidden ? 1 : 2 });
                        }
                        await onToggleFavourite(ad);
                        // Both tabs remove the card from the current list. Also
                        // drop the key from removingIds so a stale entry can't
                        // keep the card dim if it re-appears in the other tab.
                        setAds((prev) => prev.filter((a) => String(a.adId || a.id) !== key));
                        setRemovingIds((prev) => { const n = new Set(prev); n.delete(key); return n; });
                      } catch {
                        setRemovingIds((prev) => { const n = new Set(prev); n.delete(key); return n; });
                      }
                    }}
                    onUnhide={async (ad) => {
                      const key = String(ad.adId || ad.id || "");
                      if (removingIds.has(key)) return;
                      setRemovingIds((prev) => new Set([...prev, key]));
                      try {
                        await onUnHideAd({ ...ad, hideType: isAdvHidden ? 1 : 2 });
                        setAds((prev) => prev.filter((a) => String(a.adId || a.id) !== key));
                      } catch {
                        setRemovingIds((prev) => { const n = new Set(prev); n.delete(key); return n; });
                      }
                    }}
                    onClick={(ad) => setSelectedAd(ad)}
                    onSearch={onSearch}
                    showCopyLink
                  />
                </div>
              );
            }}
          />
        )}
      </div>

      <AdDetailModal
        ad={selectedAd}
        onClose={() => setSelectedAd(null)}
        isFavourite={selectedAd ? favouriteAdIds.has(Number(selectedAd.adId || selectedAd.id)) : false}
        isHidden={activeTab === "hidden"}
        isAdvertiserHidden={selectedAd ? selectedAd.hideType === 1 : false}
        onUnHideAd={async (ad) => {
          await onUnHideAd?.(ad);
          setAds((prev) => prev.filter((a) => String(a.adId || a.id) !== String(ad.adId || ad.id)));
          setSelectedAd(null);
        }}
        onHideAdvertiser={onHideAdvertiser}
        onToggleFavourite={async (ad) => {
          if (activeTab === "hidden") {
            // Same as the card handler: favouriting a hidden ad also unhides it
            // so it doesn't remain in both lists. Unhide first, then favourite.
            await onUnHideAd?.({ ...ad, hideType: ad.hideType === 1 ? 1 : 2 });
            await onToggleFavourite?.(ad);
            setAds((prev) => prev.filter((a) => String(a.adId || a.id) !== String(ad.adId || ad.id)));
            setSelectedAd(null);
          } else {
            await onToggleFavourite?.(ad);
            if (activeTab === "favourites") {
              setAds((prev) => prev.filter((a) => String(a.adId || a.id) !== String(ad.adId || ad.id)));
            }
          }
        }}
        onAnalytics={onAnalyticsAd}
        onPrev={() => {
          const idx = ads.findIndex((a) => a.id === selectedAd?.id);
          if (idx > 0) setSelectedAd(ads[idx - 1]);
        }}
        onNext={() => {
          const idx = ads.findIndex((a) => a.id === selectedAd?.id);
          if (idx < ads.length - 1) setSelectedAd(ads[idx + 1]);
        }}
        hasPrev={ads.findIndex((a) => a.id === selectedAd?.id) > 0}
        hasNext={ads.findIndex((a) => a.id === selectedAd?.id) < ads.length - 1}
      />
    </div>
  );
};

export default SavedAdsPage;
