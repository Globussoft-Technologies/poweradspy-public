import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Menu,
  ChevronDown,
  X,
  LogOut,
  Search,
  ArrowLeft,
  Share2,
  Check,
  LogIn,
  Heart,
  User,
  MessageCircle,
  CalendarCheck,
  UserPlus,
  Maximize2,
  Minimize2,
  Bell,
  Globe,
  ArrowLeftRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { createDashboardShare, buildSearchPayload, trackEvent } from "../../services/api";
import AutocompleteFilter from "../filters/AutocompleteFilter";
import { useTheme, THEMES } from "../../hooks/useTheme";
import { useAuth } from "../../hooks/useAuth";
import powerAdSpyLogo from "../../assets/poweradspy-logo.webp";
import whatsappLogo from "../../assets/whatsapp.png";
import PlatformTab from "../shared/PlatformTab";
import AdFilterBar from "../ads/AdFilterBar";
import { useNotifications } from "../../hooks/useNotifications";
import NotificationPopup from "./NotificationPopup";
import { PLATFORMS } from "../../constants";
import { AnimatedThemeToggler } from "../ui/animated-theme-toggler";

const LANGUAGES = [
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "ar", label: "عربى", flag: "🇸🇦" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "pt", label: "Português", flag: "🇧🇷" },
];

// Programmatically trigger Google Translate widget for full-page translation.
// Retries up to 10 times (3 s total) to handle async widget initialization.
const triggerGoogleTranslate = (langCode) => {
  if (langCode === "en") {
    // Google Translate modifies DOM text nodes directly — the only reliable
    // way to fully restore original English is to reload the page.
    const exp = "expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    const hostname = window.location.hostname;
    // Clear on current domain and all parent domain levels.
    // On subdomains (e.g. dev.example.com) Google Translate sets googtrans on
    // the parent (.example.com), so we must clear every ancestor level too.
    const parts = hostname.split(".");
    const domainVariants = [hostname, `.${hostname}`];
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(i).join(".");
      domainVariants.push(parent, `.${parent}`);
    }
    document.cookie = `googtrans=; ${exp}`;
    domainVariants.forEach((d) => {
      document.cookie = `googtrans=; ${exp}; domain=${d}`;
    });
    window.location.reload();
    return;
  }
  const tryTrigger = (attempts = 0) => {
    const select = document.querySelector(".goog-te-combo");
    if (select) {
      select.value = langCode;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (attempts < 15) {
      setTimeout(() => tryTrigger(attempts + 1), 300);
    }
  };
  tryTrigger();
};

/**
 * Header — SDUI-driven searchbar + navbar.
 */
const Header = ({
  isSidebarOpen,
  setIsSidebarOpen,
  searchQuery,
  setSearchQuery,
  searchIn,
  setSearchIn,
  exactSearch,
  setExactSearch,
  sdui,
  activePage = "ads",
  isLanding = false,
  isScrolled = false,
  // Props for AdFilterBar
  platformOptions = [],
  allowedPlatforms = null,
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
  DROPDOWN_SORT_LABELS = [],
  showMoreTabs,
  setShowMoreTabs,
  moreTabsRef,
  sortBtnRef,
  handleSortMouseEnter,
  showSortTip,
  sortTipPos,
  setShowSortTip,
  onDateChange,
  guest,
  showOnlyFavourites = false,
  onShowFavourites,
  onSearch,
}) => {
  const { config } = sdui;
  const { user, logout } = useAuth();
  const { t, i18n } = useTranslation();
  const [searchTypeOpen, setSearchTypeOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef(null);

  // Local input state — only syncs to Redux on Enter/button click via onSearch
  const [localQuery, setLocalQuery] = useState(searchQuery || "");
  // When a category is selected we clear Redux searchQuery (category-only search)
  // but must NOT wipe the visible input — this ref suppresses that one sync.
  const skipQuerySyncRef = useRef(false);
  useEffect(() => {
    if (skipQuerySyncRef.current) { skipQuerySyncRef.current = false; return; }
    setLocalQuery(searchQuery || "");
  }, [searchQuery]);

  // Local search type — only syncs to Redux on submit
  const [localSearchIn, setLocalSearchIn] = useState(searchIn || "keyword");
  useEffect(() => {
    setLocalSearchIn(searchIn || "keyword");
  }, [searchIn]);

  const isGuestMode = !!guest?.isRestricted; // true only for non-logged-in guests
  const [switchingToOldPAS, setSwitchingToOldPAS] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Notifications
  const { notifications, unreadCount, newNotifications, markAllRead } = useNotifications();
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef(null);

  // Click a notification → search its term on its network. The bell's type is 0=keyword,
  // 1=advertiser, 2=domain; map it to the search-in value. onSearch is App's handleSearch,
  // whose 3rd arg selects the platform (same path the "advertiser click on an ad" uses), so
  // this sets query + type + network and fires the search in one shot.
  const handleNotificationClick = (notif) => {
    const TYPE_TO_SEARCHIN = { 0: "keyword", 1: "advertiser", 2: "domain" };
    const searchType = TYPE_TO_SEARCHIN[notif?.type] || "keyword";
    const term = notif?.keyword || "";
    if (!term) return;
    setLocalSearchIn(searchType);
    setLocalQuery(term);
    if (onSearch) onSearch(term, searchType, notif.network);
    setNotifOpen(false);
  };

  // Auto-toast only for freshly-arrived notifications (deduped in the hook), so it
  // never re-fires for ones already in the bell or on reload.
  const [autoToast, setAutoToast] = useState(null);

  useEffect(() => {
    if (newNotifications.length > 0) {
      const latest = newNotifications[0];
      setAutoToast({
        id: Date.now(),
        keyword: latest.keyword || latest.advertiser || latest.domain || "your search",
        type: latest.type,
      });
      // Auto hide after 5s
      const t = setTimeout(() => setAutoToast(null), 5000);
      return () => clearTimeout(t);
    }
  }, [newNotifications]);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Close language dropdown on outside click
  useEffect(() => {
    if (!langOpen) return;
    const handler = (e) => {
      if (langRef.current && !langRef.current.contains(e.target)) setLangOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [langOpen]);

  // Sync lang attribute only — intentionally NOT setting dir=rtl
  // because the existing layout is LTR-only and would break with full RTL flip
  useEffect(() => {
    document.documentElement.lang = i18n.language.split("-")[0];
  }, [i18n.language]);

  // Close notification popup on click outside
  useEffect(() => {
    if (!notifOpen) return;
    const handler = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [notifOpen]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  // Reset the "switching" state if the user returns via browser back (bfcache).
  // Otherwise the button stays disabled with cursor:wait forever.
  useEffect(() => {
    const onPageShow = (e) => {
      if (e.persisted) setSwitchingToOldPAS(false);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  const handleSwitchToOldPAS = async () => {
    if (switchingToOldPAS) return;
    const username =
      user?.username ||
      user?.login ||
      user?.login_name ||
      user?.name ||
      (user?.email ? user.email.split('@')[0] : '');
    if (!username) {
      console.warn('Switch to Old PAS: no username found on user', user);
      return;
    }
    setSwitchingToOldPAS(true);

    // Prefer IP cached by search API (meta.clientIp). Fallback: fetch + cache.
    let ip = '';
    try { ip = localStorage.getItem('clientIP') || ''; } catch {}
    if (!ip) {
      try {
        const res = await fetch('https://api.ipify.org?format=json');
        const data = await res.json();
        ip = data?.ip || '';
        if (ip) { try { localStorage.setItem('clientIP', ip); } catch {} }
      } catch {
        // ignore — redirect without IP
      }
    }

    const encoded = btoa(username);
    const base = (import.meta.env.VITE_SHARE_URL || '').replace(/\/+$/, '');

    const url = `${base}/facebook/loginpage/${encoded}?switch=1${ip ? `&ip=${encodeURIComponent(ip)}` : ''}`;
    window.location.href = url;
  };

  const handleShareDashboard = async () => {
    if (shareLoading) return;
    setShareLoading(true);
    try {
      // Capture current UI state
      const uiState = {
        searchQuery: searchQuery || "",
        searchIn: searchIn || "keyword",
        exactSearch: exactSearch || false,
        filterValues: sdui.filterValues || {},
        activePlatforms: sdui.activePlatforms || [],
        specificPlatforms: specificPlatforms || [],
        sortBy: sdui.sortBy || "newest",
        activeTab: activeTab || "Newest",
      };

      // Build the same search payload that fetchAds would send
      const searchPayload = buildSearchPayload({
        ...sdui.filterValues,
        activePlatforms: sdui.effectivePlatforms,
        activePlatform: sdui.effectivePlatforms?.[0] || "facebook",
        searchQuery: searchQuery || "",
        searchIn: searchIn || "keyword",
        exactSearch: exactSearch || false,
        selCategories: sdui.selCategories,
        selCountries: sdui.selCountries,
        sortBy: sdui.sortBy,
        skip: 0,
      });

      const result = await createDashboardShare({ uiState, searchPayload });
      const url = `${window.location.origin}/guest/${result.token}`;
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
      trackEvent('shareAd', {
        network: sdui.activePlatforms?.[0] ?? 'NA',
        guest_page_url: url,
      });
    } catch (err) {
      console.error("Failed to share dashboard:", err);
    } finally {
      setShareLoading(false);
    }
  };
  const [isSearchOpenMobile, setIsSearchOpenMobile] = useState(
    window.innerWidth < 768,
  );
  const searchTypeRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!searchTypeRef.current) return;
      // Google Translate may wrap text in <font> elements that become e.target.
      // Walk up the DOM from e.target to check if any ancestor is our container.
      const clickedInside =
        searchTypeRef.current.contains(e.target) ||
        e.target.closest?.('[data-search-type-ref]') !== null;
      if (!clickedInside) setSearchTypeOpen(false);
    };
    if (searchTypeOpen)
      document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [searchTypeOpen]);

  // Extract searchbar documents
  const searchInputDoc = config?.searchbar?.find(
    (d) => d._id === "search_input",
  );
  const searchTypeDoc = config?.searchbar?.find((d) => d._id === "search_type");

  // Get search input filter config (autocomplete)
  const searchFilter = searchInputDoc?.filters?.[0];

  // Fallback suggestion sources
  const defaultSuggestionSources = [
    {
      _id: "word_suggest",
      rank: 1,
      label: "Suggestions",
      method: "GET",
      endpoint: "/suggest",
      env_key: "VITE_SUGGEST_API_BASE_URL",
      query_params: {
        query: "lastWord",
        limit: 5,
        list: "google",
        fuzzy: false,
      },
      response_key: "suggestions",
      display_field: "word",
      min_chars_to_trigger: 3,
      on_select_action: "replacePartialWord",
    },
    {
      _id: "category_suggest",
      rank: 2,
      label: "Categories",
      method: "POST",
      endpoint: "/search",
      env_key: "VITE_CAT_SEARCH_API_BASE_URL",
      request_body: { query: "", top_k: 5 },
      response_key: "matches",
      display_field: "sub_category",
      min_chars_to_trigger: 3,
      on_select_action: "setSelCategories",
    },
  ];

  // Get search type options
  const searchTypeFilter = searchTypeDoc?.filters?.[0];
  const allowedSearchTypes = ["keyword", "advertiser", "domain"];
  const searchTypeOptions = useMemo(() => {
    if (!searchTypeFilter?.options)
      return [{ label: "Keyword", value: "keyword" }];
    return searchTypeFilter.options.filter((opt) =>
      allowedSearchTypes.includes(opt.value),
    );
  }, [searchTypeFilter]);

  const currentSearchTypeLabel = useMemo(() => {
    const opt = searchTypeOptions.find((o) => o.value === localSearchIn);
    const raw = opt?.label || localSearchIn || "keyword";
    return t(localSearchIn, raw);
  }, [searchTypeOptions, localSearchIn, t]);

  const handleCategorySelect = (cat) => {
    if (guest?.isPublicLanding && guest?.isRestricted) {
      guest.showGuestWarning?.("Please login to search and filter ads");
      return;
    }
    // Backwards-compat — older callers still pass a string display ("Gambling > Casinos").
    const major = typeof cat === 'object' ? cat.major : (typeof cat === 'string' ? cat.split('>')[0]?.trim() : '');
    const sub   = typeof cat === 'object' ? cat.sub   : (typeof cat === 'string' ? cat.split('>')[1]?.trim() : '');

    // Set major category filter.
    if (major && sdui.setSelCategories) {
      sdui.setSelCategories((prev) =>
        prev.includes(major) ? prev : [...prev, major],
      );
    }

    // Set subcategory filter if present (e.g. "Computers" from "Consumer Electronics > Computers").
    if (sub && sdui.setFilter) {
      sdui.setFilter('subcategory', [sub]);
    }

    // Clear the Redux keyword so the search fires with category only (no text query).
    // skipQuerySyncRef prevents the sync-from-Redux effect from wiping the visible input,
    // so "apple" stays displayed in the search bar even though Redux has no keyword.
    skipQuerySyncRef.current = true;
    if (setSearchQuery) setSearchQuery('');

    setSearchTypeOpen(false);
  };

  // Local UI state for AdFilterBar dropdowns in the header
  const [showMoreTabsHeader, setShowMoreTabsHeader] = useState(false);
  const moreTabsRefHeader = useRef(null);

  useEffect(() => {
    if (!showMoreTabsHeader) return;
    const handler = (e) => {
      if (
        moreTabsRefHeader.current &&
        !moreTabsRefHeader.current.contains(e.target)
      )
        setShowMoreTabsHeader(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMoreTabsHeader]);

  return (
    <header className="h-16 2xl:h-20 py-2 px-3 sm:px-5 flex items-center justify-between sticky top-0 z-40 bg-theme-bg/95 backdrop-blur-md border-b border-theme-border">
      <div className="flex items-center gap-4">
        <img
          src={powerAdSpyLogo}
          alt="PowerAdSpy"
          className="h-8 sm:h-9 2xl:h-12 cursor-pointer"
        />
      </div>

      {activePage !== "projects" && isSearchOpenMobile && (
        <div
          className="fixed inset-0 bg-[#0a0a0a] backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsSearchOpenMobile(false)}
        />
      )}

      {activePage !== "projects" && activePage !== "intelligence" && (
        <div className="flex-1 relative h-full flex items-center mx-2 xl:mx-4">
          {/* Desktop Search bar & Mobile Search Overlay */}
          <div
            className={`
               inset-0 transition-all duration-300 ease-in-out max-w-2xl mx-auto
              ${
                isSearchOpenMobile
                  ? "fixed inset-0 z-50 bg-theme-bg/98 backdrop-blur-xl flex items-center px-4 gap-3 pointer-events-auto"
                  : "absolute items-center hidden md:flex gap-2"
              }
              ${isScrolled ? "xl:opacity-0 xl:invisible xl:-translate-y-6 xl:pointer-events-none opacity-100 visible translate-y-0" : "opacity-100 visible translate-y-0"}
            `}
          >
            {isSearchOpenMobile && (
              <button
                onClick={() => setIsSearchOpenMobile(false)}
                className="p-2 text-theme-text-muted hover:text-theme-text transition-colors"
              >
                <ArrowLeft size={20} />
              </button>
            )}

            <div className="flex-1 relative flex items-center gap-0 bg-theme-text/[0.04] border border-white/20 rounded-lg focus-within:border-[#6b99ff]/50 transition-all text-white">
              {searchTypeDoc?.visible !== false && (
                <div
                  className="relative group/si border-r border-theme-border"
                  ref={searchTypeRef}
                  data-search-type-ref
                >
                  <button
                    className="notranslate flex items-center gap-1 pl-4 pr-3 py-2.5 text-xs 2xl:text-[14px] font-bold text-theme-text whitespace-nowrap hover:text-[#6b99ff] hover:bg-theme-text/[0.04] rounded-l-lg transition-colors"
                    onClick={() => setSearchTypeOpen(!searchTypeOpen)}
                  >
                    {currentSearchTypeLabel} <ChevronDown size={10} />
                  </button>
                  {searchTypeOpen && (
                    <div className="notranslate absolute top-full left-0 mt-1 bg-theme-surface border border-theme-border rounded-lg shadow-2xl w-36 z-50 py-1">
                      {searchTypeOptions.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => {
                            setLocalSearchIn(opt.value);
                            if (setSearchIn) setSearchIn(opt.value);
                            setSearchTypeOpen(false);
                          }}
                          className={`notranslate w-full text-left px-3 py-1.5 text-[13px] transition-colors ${
                            localSearchIn === opt.value
                              ? "text-[#6b99ff] bg-[#3762c1]/10"
                              : "text-theme-text-muted hover:text-theme-text hover:bg-theme-text/[0.04]"
                          }`}
                        >
                          {t(opt.value, opt.label) || opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex-1">
                <AutocompleteFilter
                  placeholder={
                    searchFilter?.placeholder ||
                    t("search_placeholder")
                  }
                  value={localQuery}
                  onChange={(val) => {
                    setLocalQuery(val);
                    if (val === "") {
                      if (onSearch) onSearch("", localSearchIn);
                    }
                  }}
                  onClear={() => {
                    if (onSearch) onSearch("", localSearchIn);
                  }}
                  onSearch={(val) => {
                    if (onSearch) onSearch(val, localSearchIn);
                  }}
                  suggestionSources={
                    searchFilter?.suggestion_sources?.length > 0
                      ? searchFilter.suggestion_sources
                      : defaultSuggestionSources
                  }
                  debounceMs={searchFilter?.debounce_ms || 300}
                  minLength={searchFilter?.min_length || 3}
                  onSelectCategory={handleCategorySelect}
                  minimal={true}
                />
              </div>
            </div>

            {localQuery.trim().length > 0 && localSearchIn === "keyword" && (
              <label
                className="flex items-center gap-1.5 cursor-pointer select-none shrink-0"
                title={t("search_precisely_tooltip")}
              >
                <input
                  type="checkbox"
                  checked={exactSearch}
                  onChange={(e) => setExactSearch(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-[#333] bg-[#111] accent-[#3759a3] cursor-pointer"
                />
                <span className="notranslate text-[10px] 2xl:text-[12px] text-white/50 hover:text-[#6b99ff] transition-colors whitespace-nowrap">
                  {t("search_precisely")}
                </span>
              </label>
            )}

            {isSearchOpenMobile && (
              <button
                onClick={() => setIsSearchOpenMobile(false)}
                className="p-2 text-theme-text-muted hover:text-theme-text transition-colors"
              >
                <X size={20} />
              </button>
            )}
          </div>

          {/* Ad Filter Bar (visible on scroll on desktop) */}
          <div
            className={`
              absolute inset-0 transition-all duration-300 ease-in-out 
              ${isScrolled ? "xl:opacity-100 xl:visible xl:translate-y-0 xl:flex hidden" : "opacity-0 invisible translate-y-6 pointer-events-none"}
              w-full items-center
            `}
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
              DROPDOWN_SORT_LABELS={DROPDOWN_SORT_LABELS}
              showMoreTabs={showMoreTabsHeader}
              setShowMoreTabs={setShowMoreTabsHeader}
              moreTabsRef={moreTabsRefHeader}
              onDateChange={onDateChange}
              showOriginalOnMobile={false}
              showPlatformsOnMobile={false}
              isScrolled={isScrolled}
              disableTooltips={true}
              guest={guest}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5 sm:gap-2">
        {activePage !== "projects" && (
          <button
            className="md:hidden sm:p-1.5 text-theme-text-muted hover:text-theme-text transition-colors"
            onClick={() => setIsSearchOpenMobile(true)}
          >
            <Search size={20} />
          </button>
        )}
        {sdui.totalActiveFilters > 0 && !guest?.isRestricted && activePage !== "projects" && (
          <button
            onClick={() => {
              if (guest?.showGuestWarning("Please login to change filters")) return;
              sdui.clearAll();
              if (setSearchQuery) setSearchQuery("");
              if (setActiveTab) setActiveTab("Newest");
            }}
            className="flex items-center gap-0.5 md:gap-1.5 px-1.5 md:px-3 whitespace-nowrap py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-500/40 rounded-lg text-[9px] md:text-[11px] font-bold transition-all animate-pulse-glow"
          >
            <X size={12} />
            {sdui.totalActiveFilters === 1 ? t("clear_x_filters", { count: sdui.totalActiveFilters }) : t("clear_x_filters_plural", { count: sdui.totalActiveFilters })}
          </button>
        )}

        {/* Share Dashboard button — only for logged-in users, not on guest/share routes.
            `order-1` pulls it to the right side of the flex row (next to the
            now-hidden fullscreen toggle) without moving the JSX in source. */}
        {!isLanding && !isGuestMode && !guest?.isGuest && (
          <div className="relative group/share order-1">
            <button
              onClick={handleShareDashboard}
              disabled={shareLoading}
              className="hover:bg-theme-text/[0.06] mt-0.5 rounded-lg text-theme-text-muted hover:text-theme-text transition-colors p-1"
              style={{ opacity: shareLoading ? 0.5 : 1, cursor: shareLoading ? "wait" : "pointer" }}
            >
              {shareCopied ? (
                <Check className="size-5 2xl:size-6 text-green-400" />
              ) : (
                <Share2 className="size-[17px] md:size-[18px] 2xl:size-6" />
              )}
            </button>
            <div className={`absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2.5 py-1.5 bg-[#1a1a1a] text-white text-[9px] 2xl:text-[10px] font-bold rounded-lg shadow-xl transition-all duration-200 pointer-events-none z-50 whitespace-nowrap border border-white/10 ${
              shareCopied 
                ? "opacity-100 visible translate-y-0" 
                : "opacity-0 invisible translate-y-1 group-hover/share:opacity-100 group-hover/share:visible group-hover/share:translate-y-0"
            }`}>
              {shareCopied ? "Dashboard link copied!" : "Share Dashboard"}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mt-[-1px] w-2 h-2 bg-[#1a1a1a] rotate-45 border-l border-t border-white/10" />
            </div>
          </div>
        )}

        {/* Guest mode: Login button */}
        {isGuestMode && guest?.isRestricted && (
          <a
            href={import.meta.env.VITE_AMEMBER_LOGIN_URL || "https://app-dev.poweradspy.com/amember/member"}
            className="flex items-center gap-1.5 px-4 py-1.5 text-white text-[12px] font-semibold rounded-lg transition-colors hover:opacity-90"
            style={{ backgroundColor: "rgb(51, 82, 150)" }}
          >
            <LogIn size={13} />
            {t("login")}
          </a>
        )}

        {/* Notification bell — logged-in users only */}
        {!isLanding && !isGuestMode && !guest?.isGuest && (
          <div className="relative" ref={notifRef}>
            <button
              id="notification-bell"
              onClick={() => setNotifOpen((prev) => !prev)}
              className="relative sm:w-7 sm:h-7 2xl:w-9 2xl:h-9 flex items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-theme-text/[0.08] transition-all"
              title="Notifications"
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center text-[9px] font-bold text-white bg-red-500 rounded-full px-1 leading-none animate-bounce" style={{ animationDuration: '2s', animationIterationCount: 3 }}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            {notifOpen && (
              <NotificationPopup
                notifications={notifications}
                onMarkAllRead={() => { markAllRead(); setNotifOpen(false); }}
                onNotificationClick={handleNotificationClick}
                onClose={() => setNotifOpen(false)}
              />
            )}
          </div>
        )}

        {/* Language Switcher */}
        <div className="relative" ref={langRef}>
          <button
            onClick={() => setLangOpen((prev) => !prev)}
            title={t("language")}
            className="flex items-center gap-0.5 sm:w-auto h-7 2xl:h-9 px-1.5 justify-center rounded-lg text-white/70 hover:text-white hover:bg-theme-text/[0.08] transition-all"
          >
            <Globe size={16} />
            <ChevronDown size={10} />
          </button>
          {langOpen && (
            <div className="notranslate group absolute right-0 top-full mt-1 w-36 rounded-lg shadow-xl z-50 p-[2px] overflow-hidden">
              {/* Spinning neon gradient border — mirrors the ad-card hover treatment */}
              <div className="absolute inset-[-100%] z-0 bg-[conic-gradient(from_0deg,transparent_0_180deg,#335296_240deg,#244a94_300deg,transparent_360deg)] opacity-0 group-hover:opacity-100 animate-[spin_3s_linear_infinite] transition-opacity duration-500 pointer-events-none" />
              <div className="relative z-10 bg-theme-card border border-theme-border group-hover:border-transparent rounded-[6px] py-1 transition-colors duration-300">
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => { i18n.changeLanguage(lang.code); triggerGoogleTranslate(lang.code); setLangOpen(false); trackEvent('languageChange', { language: lang.code, language_name: lang.label ?? lang.name ?? lang.code }); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                      (i18n.resolvedLanguage || i18n.language).split("-")[0] === lang.code
                        ? "text-[#6b99ff] bg-[#3762c1]/10"
                        : "text-theme-text hover:bg-theme-text/[0.04] hover:text-theme-text"
                    }`}
                  >
                    <span className="text-sm">{lang.flag}</span>
                    <span>{lang.label}</span>
                    {(i18n.resolvedLanguage || i18n.language).split("-")[0] === lang.code && (
                      <Check size={10} className="ml-auto text-[#6b99ff]" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Animated Theme Toggle — Sun/Moon with view-transition reveal.
            Drives the same `useTheme` context so every page using
            --color-* vars updates in lockstep. */}
        <AnimatedThemeToggler
          title={t("toggle_theme", "Toggle theme")}
          className="w-7 h-7 2xl:w-9 2xl:h-9 flex items-center justify-center rounded-lg text-theme-text-muted hover:text-theme-text hover:bg-theme-text/[0.08] transition-all shrink-0 [&_svg]:w-4 [&_svg]:h-4 2xl:[&_svg]:w-[18px] 2xl:[&_svg]:h-[18px]"
        />

        {/* Fullscreen toggle — currently hidden via `hidden` class; the
            handler, state, and effect stay live so the feature can be
            re-enabled by removing the class alone. */}
        <button
          onClick={toggleFullscreen}
          title={isFullscreen ? t("exit_fullscreen") : t("enter_fullscreen")}
          className="hidden sm:w-6 sm:h-6 2xl:w-8 2xl:h-8 flex items-center justify-center rounded-lg text-theme-text-muted hover:text-theme-text hover:bg-theme-text/[0.06] transition-all"
        >
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>

        <div className="relative group order-2">
          <div
            className="w-6 h-6 2xl:w-8 2xl:h-8 rounded-lg bg-[#335296] flex items-center justify-center text-[11px] 2xl:text-sm font-black cursor-pointer hover:bg-[#3762c1] transition-colors text-white"
            title={isGuestMode ? "Guest" : (user?.name || user?.email || "")}
          >
            {isLanding || isGuestMode
              ? "G"
              : (user?.name || user?.email || "U").charAt(0).toUpperCase()}
          </div>
          <div
            className={`group/dropdown absolute right-0 top-full mt-1 ${isLanding || isGuestMode ? "w-max min-w-[110px]" : "w-56"} rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 p-[2px] overflow-hidden`}
          >
            {/* Spinning neon gradient border — fires only when the dropdown
                itself is hovered (group/dropdown), not when the avatar is. */}
            <div className="absolute inset-[-100%] z-0 bg-[conic-gradient(from_0deg,transparent_0_180deg,#335296_240deg,#244a94_300deg,transparent_360deg)] opacity-0 group-hover/dropdown:opacity-100 animate-[spin_3s_linear_infinite] transition-opacity duration-500 pointer-events-none" />
            <div className="relative z-10 bg-theme-card border border-theme-border group-hover/dropdown:border-transparent rounded-[6px] overflow-hidden transition-colors duration-300">
            <div
              className={`px-4 py-2 ${!isLanding && !isGuestMode ? "border-b border-theme-border" : ""}`}
            >
              <p
                className={`text-xs font-bold text-theme-text truncate ${isLanding || isGuestMode ? "text-center" : ""}`}
              >
                {isLanding || isGuestMode ? t("guest_user") : user?.name || "User"}
              </p>
              {!isLanding && !isGuestMode && (
                <p className="text-[10px] text-theme-text-muted truncate">
                  {user?.email || ""}
                </p>
              )}
            </div>
            {/* Account (Logged-in only) */}
            {!isLanding && !isGuestMode && (
              <a
                href={import.meta.env.VITE_AMEMBER_ACCOUNT_URL || "https://app-dev.poweradspy.com/amember/member/index"}
                className="group w-full flex items-center gap-2 px-3 py-2 text-xs text-theme-text hover:bg-[#6b99ff]/10 hover:text-[#6b99ff] transition-all duration-300"
              >
                <User size={14} className="group-hover:scale-110 transition-transform" />
                <span className="group-hover:translate-x-1 transition-transform">{t("account")}</span>
              </a>
            )}

            {/* Switch to Classic Dashboard (Logged-in only) */}
            {/* {!isLanding && !isGuestMode && !guest?.isGuest && (
              <button
                onClick={handleSwitchToOldPAS}
                disabled={switchingToOldPAS}
                style={{ cursor: switchingToOldPAS ? "wait" : "pointer" }}
                className="group w-full flex items-center gap-2 px-3 py-2 text-xs text-theme-text hover:bg-[#6b99ff]/10 hover:text-[#6b99ff] transition-all duration-300 disabled:opacity-50"
              >
                <ArrowLeftRight size={14} className="group-hover:scale-110 transition-transform" />
                <span className="group-hover:translate-x-1 transition-transform">Switch to Classic Dashboard</span>
              </button>
            )} */}

            {/* Book a Demo (Visible to all) */}
            <a
              href={import.meta.env.VITE_BOOK_DEMO_URL || "https://poweradspy.com/book-a-demo/"}
              target="_blank"
              rel="noopener noreferrer"
              className="group w-full flex items-center gap-2 px-3 py-2 text-xs text-theme-text hover:bg-[#6b99ff]/10 hover:text-[#6b99ff] transition-all duration-300"
            >
              <CalendarCheck size={14} className="text-[#6b99ff] group-hover:scale-110 transition-transform" />
              <span className="group-hover:translate-x-1 transition-transform">{t("book_a_demo")}</span>
            </a>

            {/* WhatsApp (Visible to all) */}
            <a
              href={import.meta.env.VITE_WHATSAPP_URL || "https://api.whatsapp.com/send/?phone=919538024894&text&type=phone_number&app_absent=0"}
              target="_blank"
              rel="noopener noreferrer"
              className="group w-full flex items-center gap-2 px-3 py-2 text-xs text-theme-text hover:bg-[#25D366]/10 hover:text-[#25D366] transition-all duration-300"
            >
              <img src={whatsappLogo} alt="WhatsApp" className="w-[14px] h-[14px] object-contain group-hover:scale-110 group-hover:rotate-12 transition-transform duration-300" />
              <span className="group-hover:translate-x-1 transition-transform duration-300">{t("whatsapp")}</span>
            </a>

            {/* Watch our tutorials */}
            <a
              href={import.meta.env.VITE_YOUTUBE_TUTORIALS_URL || "https://www.youtube.com/channel/UC_xUdtiMeUAbuN5LLVyK_Qw"}
              target="_blank"
              rel="noopener noreferrer"
              className="group w-full flex items-center gap-2 px-3 py-2 text-xs text-theme-text hover:bg-[#FF0000]/10 hover:text-[#FF0000] transition-all duration-300"
            >
              <svg viewBox="0 0 24 24" className="w-[14px] h-[14px] shrink-0 group-hover:scale-110 transition-transform" aria-hidden="true">
                <path fill="currentColor" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
              <span className="group-hover:translate-x-1 transition-transform">{t("watch_tutorials")}</span>
            </a>

            {/* Share this on Twitter */}
            <a
              href="https://x.com/intent/post?url=https%3A%2F%2Fapp.poweradspy.com%2Ffacebook%2Flanding%3Fadvertiser%2Famazon&via=PowerAdSpy&text=Spy%20on%20All%20Facebook%20Ads%20by%20%20using%20this%20awesome%20tool%20-%20%40poweradspy%2C%20try%20it%20out%20for%20%241%20-%20www.poweradspy.com%2C%20Check%20the%20ads%20here%20-"
              target="_blank"
              rel="noopener noreferrer"
              className="group w-full flex items-center gap-2 px-3 py-2 text-xs text-theme-text hover:bg-[#1da1f2]/10 hover:text-[#1da1f2] dark:hover:bg-[#1da1f2]/15 dark:hover:text-[#1da1f2] transition-all duration-300"
            >
              <svg viewBox="0 0 24 24" className="w-[14px] h-[14px] shrink-0 group-hover:scale-110 transition-transform" aria-hidden="true">
                <path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.736-8.867L1.683 2.25H8.12l4.258 5.635 5.866-5.635zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/>
              </svg>
              <span className="group-hover:translate-x-1 transition-transform">{t("share_twitter")}</span>
            </a>

            {/* Invite friends — temporarily hidden
            <a
              href={(() => {
                try {
                  const origin = new URL(import.meta.env.VITE_AMEMBER_LOGIN_URL || "https://app-dev.poweradspy.com/amember/login").origin;
                  return `${origin}/facebook/invite-friends`;
                } catch {
                  return "https://app-dev.poweradspy.com/facebook/invite-friends";
                }
              })()}
              target="_blank"
              rel="noopener noreferrer"
              className="group w-full flex items-center gap-2 px-3 py-2 text-xs text-theme-text hover:bg-[#6b99ff]/10 hover:text-[#6b99ff] transition-all duration-300"
            >
              <UserPlus size={14} className="group-hover:scale-110 transition-transform" />
              <span className="group-hover:translate-x-1 transition-transform">{t("invite_friends")}</span>
            </a>
            */}

            {/* Logout (Logged-in only) */}
            {!isLanding && !isGuestMode && (
              <button
                onClick={logout}
                className="group w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-500 rounded-b-lg transition-all duration-300"
              >
                <LogOut size={14} className="group-hover:scale-110 transition-transform" />
                <span className="group-hover:translate-x-1 transition-transform">{t("logout")}</span>
              </button>
            )}
            </div>
          </div>
        </div>
        {/* Auto Toast Popup */}
        {autoToast && (
          <div className="absolute top-full right-4 mt-4 bg-theme-card border-l-4 border-[#6b99ff] rounded-lg shadow-xl px-4 py-3 min-w-[250px] z-[70] animate-slide-in-right flex items-start gap-3 cursor-pointer" onClick={() => setNotifOpen(true)}>
            <div className="w-8 h-8 rounded-full bg-[#6b99ff]/10 flex items-center justify-center shrink-0 mt-0.5">
              <Bell size={14} className="text-[#6b99ff] animate-ring" />
            </div>
            <div>
              <p className="text-xs font-bold text-theme-text">New Ads Found!</p>
              <p className="text-[10px] text-theme-text-muted mt-0.5">
                Ads scraped for {autoToast.type === 1 ? "advertiser" : autoToast.type === 2 ? "domain" : "keyword"} <span className="font-semibold text-theme-text">"{autoToast.keyword}"</span>
              </p>
            </div>
            <button onClick={(e) => { e.stopPropagation(); setAutoToast(null); }} className="absolute top-2 right-2 text-theme-text-muted hover:text-theme-text">
              <X size={12} />
            </button>
            <style>{`
              @keyframes slideInRight {
                from { opacity: 0; transform: translateX(20px); }
                to { opacity: 1; transform: translateX(0); }
              }
              .animate-slide-in-right {
                animation: slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1);
              }
              @keyframes ring {
                0% { transform: rotate(0); }
                25% { transform: rotate(15deg); }
                50% { transform: rotate(-15deg); }
                75% { transform: rotate(10deg); }
                100% { transform: rotate(0); }
              }
              .animate-ring {
                animation: ring 1.5s ease infinite;
                transform-origin: top center;
              }
            `}</style>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
