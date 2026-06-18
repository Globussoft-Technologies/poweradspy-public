import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";

// Hooks & Services
import { useSDUI } from "./hooks/useSDUI";
import { useTheme } from "./hooks/useTheme";
import { useAuth } from "./hooks/useAuth";
import {
  fetchAds,
  fetchAdsForExport,
  buildAuditPrompt,
  buildCampaignPrompt,
  fetchGemini,
  fetchHiddenAndFavourites,
  hideAds,
  unHideAds,
  fetchLandingAd,
  guestSearchAds,
  publicSearchAds,
  fetchPlanAccess,
  saveKeywordSearch,
  trackEvent,
} from "./services/api";
import { useGuest } from "./hooks/useGuest";
import { GuestProvider } from "./hooks/useGuest";
import { Check, X } from "lucide-react";
import { useSelector, useDispatch } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import { Routes, Route } from 'react-router-dom';
import { setActivePage, setShowSavedAdsPage, setSidebarOpen, setSearchQuery, setSearchIn, setExactSearch, setActiveTab, setPreviewMode, setSpecificPlatforms, openModal, closeModal } from './store/uiSlice';
import { useBrowserHistoryState, coalesceNextHistoryWrite } from './hooks/useBrowserHistoryState';

// Components
import Header from "./components/layout/Header";
import Sidebar from "./components/layout/Sidebar";
import AdGrid from "./components/ads/AdGrid";
import AIAnalysisModal from "./components/modals/AIAnalysisModal";
import CampaignModal from "./components/modals/CampaignModal";
import SubscriptionModal from "./components/modals/SubscriptionModal";
import PricingModal from "./components/modals/PricingModal";
import AnalyticsModal from "./components/modals/AnalyticsModal.jsx";
import AllProjects from "./components/all-projects/AllProjects";
// SharedAdView no longer used — /share routes now use dashboard UI via GuestProvider
import SavedAdsPage from "./components/ads/SavedAdsPage";
import ChatbotWidget from "./components/shared/ChatbotWidget";
import NotificationPermissionPrompt from "./components/layout/NotificationPermissionPrompt";
import UnsubscribePage from "./components/UnsubscribePage";

const USE_SAMPLE_DATA = false;

// Maps API body keys (from restrictedFilters response) → SDUI filterValues keys
// Mirrors the pick() logic in api.js so we can clear the right SDUI state entries
const RESTRICTED_BODY_KEY_TO_SDUI_IDS = {
  adBudget:      ['adBudget', 'ad_budget', 'budget', 'avg_ad_budget'],
  avgBudget:     ['adBudget', 'ad_budget', 'budget', 'avg_ad_budget'],
  adBudget_sort: ['adBudget', 'ad_budget', 'budget', 'avg_ad_budget'],
  gender:        ['gender', 'gender_filter', 'gender_selector'],
  ecommerce:     ['ecommerce', 'ecommerce_platform_filter', 'ecommerce_filter'],
  funnel:        ['funnel', 'funnel_filter'],
  // Backend sends 'lower_age' and 'upper_age' (from BODY_KEY_TO_FILTER_ID) — clear all age SDUI IDs
  lower_age:     ['age_filter', 'age', 'lower_age', 'lowerAge'],
  upper_age:     ['age_filter', 'age', 'upper_age', 'upperAge'],
  // Backend sends 'call_to_action' (body key) — not 'cta'
  call_to_action: ['cta_filter', 'cta', 'call_to_action'],
  // Ad type filter — backend body key is 'type' but SDUI stores it as 'ad_type'
  type:          ['ad_type', 'ad_types', 'type', 'adType'],
  // Category filter — clear all possible SDUI keys for category selection.
  // Parent category stored as 'adcategory' (string), child selection stored as 'subcategory'
  // (array) — both produce chips, both must be cleared.
  adcategory:    ['adcategory', 'category', 'categories', 'subcategory'],
  // Date filters — backend body keys map directly to SDUI filterValues keys
  seen_btn_sort:        ['seen_btn_sort'],
  post_date_btn_sort:   ['post_date_btn_sort'],
  domain_date_btn_sort: ['domain_date_btn_sort'],
};

const AMEMBER_LOGIN_URL =
  import.meta.env.VITE_AMEMBER_LOGIN_URL ||
  "https://app-dev.poweradspy.com/amember/member";

const AMEMBER_LOGIN_REDIRECT =
  import.meta.env.VITE_AMEMBER_LOGIN_URL ||
  "https://app-dev.poweradspy.com/amember/member";

// Check if user has a real login (not just env fallback token)
const checkIsLoggedIn = () => {
  const storedToken = localStorage.getItem('authToken');
  const envToken = import.meta.env.VITE_PAS_API_TOKEN;
  return !!storedToken && storedToken !== envToken;
};

// Check if this is a /share/{token} or /guest/{token} or /guest-landing/{token} URL
const getRouteToken = () => {
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  if (pathParts.length === 1 && pathParts[0] === "guest-landing") {
    return { type: "guest-landing" };
  }
  if (pathParts.length === 2 && pathParts[1]) {
    if (pathParts[0] === "share") return { type: "share", token: pathParts[1] };
    if (pathParts[0] === "guest") return { type: "guest", token: pathParts[1] };
  }
  // /guest or /share without token → redirect to login
  if (pathParts.length === 1 && (pathParts[0] === "guest" || pathParts[0] === "share")) {
    return { type: "invalid" };
  }
  return null;
};

const routeToken = getRouteToken();

// In-app routes that are safe to deep-link to across a login round-trip.
// Restricting to a known allowlist avoids an open-redirect: the value is read
// back from sessionStorage after returning from the external aMember login, so
// it must never be an attacker-controlled or cross-origin destination.
const DEEP_LINK_SAFE_PATHS = new Set(['/projects', '/saved']);
const isSafeDeepLink = (p) =>
  typeof p === 'string' &&
  p.startsWith('/') &&
  !p.startsWith('//') &&
  DEEP_LINK_SAFE_PATHS.has(p.split('?')[0]);

const AppWrapper = () => {
  // Standalone public unsubscribe page (linked from every report email's footer:
  // /facebook/unsubscribe-page?email=...). Handled FIRST — before any dashboard
  // or /{network}/{adId} analytics routing — so it never gets parsed as an ad URL.
  if (/\/unsubscribe-page\/?$/.test(window.location.pathname)) {
    const _p = new URLSearchParams(window.location.search);
    // NOTE: the signed token rides as `sig`, NOT `token` — `token` collides with
    // the auth bootstrap (useAuth) which treats ?token= as a login JWT and strips
    // the query on load, wiping the email.
    return <UnsubscribePage email={_p.get("email") || ""} token={_p.get("sig") || ""} page={_p.get("page") || ""} />;
  }

  // /guest or /share without token → redirect to login
  if (routeToken?.type === "invalid") {
    window.location.href = AMEMBER_LOGIN_REDIRECT;
    return null;
  }
  if (routeToken?.type === "share") {
    return (
      <GuestProvider shareToken={routeToken.token}>
        <App />
      </GuestProvider>
    );
  }
  if (routeToken?.type === "guest") {
    return (
      <GuestProvider guestToken={routeToken.token}>
        <App />
      </GuestProvider>
    );
  }
  if (routeToken?.type === "guest-landing") {
    // Logged-in users should not see the guest landing page — redirect to dashboard
    if (checkIsLoggedIn()) {
      window.location.replace('/');
      return null;
    }
    return (
      <GuestProvider publicLanding={true}>
        <App />
      </GuestProvider>
    );
  }
  return <App />;
};

const App = () => {
  const ui = useSelector(state => state.ui);
  const dispatch = useDispatch();
  const location = useLocation();
  const navigate = useNavigate();

  // ── Auth Guard ────────────────────────────────────────────────────────
  const {
    isAuthenticated,
    loading: authLoading,
    token,
    user,
    logout,
    isFilterRestricted,
    filterHasPlanEntry,
    planAccess,
    setPlanAccess,
  } = useAuth();

  // ── Guest Mode ────────────────────────────────────────────────────────
  const guest = useGuest();

  // ── SDUI State ───────────────────────────────────────────────────────
  const sdui = useSDUI();
  const { theme, colors } = useTheme();

  // Apply guest UI state to SDUI once loaded
  const guestInitApplied = useRef(false);
  useEffect(() => {
    if (guest?.uiState && !guest.loading && sdui.config && !guestInitApplied.current) {
      guestInitApplied.current = true;
      const gs = guest.uiState;
      // Restore filter values
      if (gs.filterValues) {
        Object.entries(gs.filterValues).forEach(([key, val]) => {
          if (val != null) sdui.setFilter(key, val);
        });
      }
      // Restore active platforms
      if (gs.activePlatforms?.length) {
        sdui.setActivePlatforms(gs.activePlatforms);
      }
      // Restore specific platform selection (individual tabs)
      if (gs.specificPlatforms?.length) {
        dispatch(setSpecificPlatforms(gs.specificPlatforms));
      }
      // Restore search state
      if (gs.searchQuery) dispatch(setSearchQuery(gs.searchQuery));
      if (gs.searchIn) dispatch(setSearchIn(gs.searchIn));
      if (gs.exactSearch != null) dispatch(setExactSearch(gs.exactSearch));
      if (gs.activeTab) dispatch(setActiveTab(gs.activeTab));
    }
  }, [guest?.uiState, guest?.loading, sdui.config, dispatch]);

  // Pick up state from guest/share page redirect (logged-in user interacted)
  useEffect(() => {
    const pending = sessionStorage.getItem('guestToDashboard');
    if (!pending) return;
    sessionStorage.removeItem('guestToDashboard');
    try {
      const s = JSON.parse(pending);
      if (s.searchQuery != null) dispatch(setSearchQuery(s.searchQuery));
      if (s.searchIn) dispatch(setSearchIn(s.searchIn));
      if (s.exactSearch != null) dispatch(setExactSearch(s.exactSearch));
      if (s.activeTab) dispatch(setActiveTab(s.activeTab));
    } catch {}
  }, [dispatch]);

  // Keep the quick-filter (sort) pill highlight in sync with the actual active
  // sort. The pill highlight is driven by `activeTab`, but the real sort lives in
  // `sdui.sortBy` (filterValues.sorting). When the sort is cleared by any path —
  // most notably removing its "Ordered By: …" chip — `sortBy` empties but
  // `activeTab` would otherwise stay set, leaving the pill stuck highlighted.
  // Clearing it here un-highlights the pill whenever no sort is active.
  useEffect(() => {
    if (!sdui.sortBy && ui.activeTab) dispatch(setActiveTab(''));
  }, [sdui.sortBy, ui.activeTab, dispatch]);

  // Responsive sidebar default — only on mobile, so persisted desktop preference survives
  const sidebarInitDone = useRef(false);
  useEffect(() => {
    if (sidebarInitDone.current) return;
    sidebarInitDone.current = true;
    if (window.innerWidth < 768) dispatch(setSidebarOpen(false));
  }, [dispatch]);

  // Browser back/forward: push a history snapshot on reversible state changes;
  // restore on popstate. URL stays unchanged (Option C).
  const historySnapshot = useMemo(() => ({
    searchQuery: ui.searchQuery,
    searchIn: ui.searchIn,
    exactSearch: ui.exactSearch,
    activeTab: ui.activeTab,
    specificPlatforms: ui.specificPlatforms,
    filterValues: sdui.filterValues,
    activePlatforms: sdui.activePlatforms,
  }), [ui.searchQuery, ui.searchIn, ui.exactSearch, ui.activeTab, ui.specificPlatforms, sdui.filterValues, sdui.activePlatforms]);

  useBrowserHistoryState(historySnapshot, (snap) => {
    if (snap.searchQuery !== undefined) dispatch(setSearchQuery(snap.searchQuery));
    if (snap.searchIn !== undefined) dispatch(setSearchIn(snap.searchIn));
    if (snap.exactSearch !== undefined) dispatch(setExactSearch(snap.exactSearch));
    if (snap.activeTab !== undefined) dispatch(setActiveTab(snap.activeTab));
    if (snap.specificPlatforms !== undefined) dispatch(setSpecificPlatforms(snap.specificPlatforms));
    if (snap.filterValues !== undefined) sdui.setAllFilters?.(snap.filterValues);
    if (snap.activePlatforms !== undefined) sdui.setActivePlatforms?.(snap.activePlatforms);
  });

  // Sync state with URL — skip on guest/share routes so we don't clobber their pathname
  useEffect(() => {
    if (location.pathname.startsWith('/guest/') || location.pathname.startsWith('/share/')) return;
    if (location.pathname === '/projects') {
      dispatch(setActivePage('projects'));
      dispatch(setShowSavedAdsPage(false));
    } else if (location.pathname === '/saved') {
      dispatch(setActivePage('ads'));
      dispatch(setShowSavedAdsPage(true));
    } else {
      dispatch(setActivePage('ads'));
      dispatch(setShowSavedAdsPage(false));
    }
  }, [location.pathname, dispatch]);

  // Navigate based on state — skip on guest/share routes so a persisted activePage doesn't kick users to /.
  // Also skip the tick where pathname JUST changed: url-to-state (above) will dispatch the new activePage,
  // but this effect sees stale activePage + new pathname in the same tick and would navigate back — causing
  // an infinite loop on browser back/forward. Trust url-to-state to catch up on the next render.
  const lastPathnameRef = useRef(location.pathname);
  // On the very first render the URL must win, not a stale redux-persist
  // activePage. The url→state effect above adopts the path (e.g. a hard load of
  // /projects); skipping this state→URL push on mount prevents the persisted
  // page from overriding the URL — which caused both a hard-loaded /projects to
  // bounce to '/', and a returning '/' session (activePage='projects' persisted)
  // to bounce to /projects.
  const didInitialNavSyncRef = useRef(false);
  const _VALID_NETWORKS = ["facebook","instagram","youtube","google","gdn","native","linkedin","reddit","quora","pinterest","tiktok"];
  const _isAdAnalyticsUrl = (() => {
    const parts = location.pathname.split("/").filter(Boolean);
    return parts.length === 2 && _VALID_NETWORKS.includes(parts[0].toLowerCase()) && !!parts[1];
  })();
  useEffect(() => {
    if (!didInitialNavSyncRef.current) {
      didInitialNavSyncRef.current = true;
      return;
    }
    if (location.pathname.startsWith('/guest/') || location.pathname.startsWith('/share/')) return;
    if (_isAdAnalyticsUrl) return;
    if (location.pathname !== lastPathnameRef.current) {
      lastPathnameRef.current = location.pathname;
      return;
    }
    const _isSpecialRoute = location.pathname === '/guest-landing' || location.pathname.startsWith('/guest/') || location.pathname.startsWith('/share/');
    if (_isSpecialRoute) return;
    if (ui.activePage === 'projects' && location.pathname !== '/projects') {
      navigate('/projects');
    } else if (ui.showSavedAdsPage && location.pathname !== '/saved') {
      navigate('/saved');
    } else if (ui.activePage === 'ads' && !ui.showSavedAdsPage && location.pathname !== '/') {
      navigate('/');
    }
  }, [ui.activePage, ui.showSavedAdsPage, location.pathname, navigate]);

  // ── Application State ────────────────────────────────────────────────
  const [ads, setAds] = useState([]);
  const [adsMeta, setAdsMeta] = useState({});
  const [availableNetworks, setAvailableNetworks] = useState([]);
  const [noDataMessage, setNoDataMessage] = useState(null);
  const [useSample, setUseSample] = useState(USE_SAMPLE_DATA);

  const [isHeaderScrolled, setIsHeaderScrolled] = useState(false);

  // Error State
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);

  // Modal State
  const [selectedAdForAI, setSelectedAdForAI] = useState(null);
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [campaignStrategy, setCampaignStrategy] = useState("");
  const [isGeneratingStrategy, setIsGeneratingStrategy] = useState(false);

  // Toast State
  const [toast, setToast] = useState({ show: false, message: "", type: "success" });
  const showToast = useCallback((message, type = "success") => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: "", type: "success" }), 3000);
  }, []);

  // Landing State (from URL)
  const [landingAd, setLandingAd] = useState(() => {
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    const validNetworks = [
      "facebook",
      "instagram",
      "youtube",
      "google",
      "gdn",
      "native",
      "linkedin",
      "reddit",
      "quora",
      "pinterest",
      "tiktok",
    ];

    // Pattern: /{network}/landing/ad_id/{adId} — landing page ad viewer only
    if (
      pathParts.length === 4 &&
      pathParts[1] === "landing" &&
      pathParts[2] === "ad_id"
    ) {
      const [network, , , adId] = pathParts;
      if (validNetworks.includes(network.toLowerCase()) && adId) {
        return { id: adId, network: network.toLowerCase(), _fromUrl: true };
      }
    }

    return null;
  });
  const [selectedAdForAnalytics, setSelectedAdForAnalytics] = useState(() => {
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    const validNetworks = [
      "facebook", "instagram", "youtube", "google", "gdn", "native",
      "linkedin", "reddit", "quora", "pinterest", "tiktok",
    ];
    if (pathParts.length === 2) {
      const [network, adId] = pathParts;
      if (validNetworks.includes(network.toLowerCase()) && adId) {
        return { id: adId, network: network.toLowerCase(), _fromUrl: true };
      }
    }
    return null;
  });

  const openAnalyticsModal = (ad) => {
    if (ad) {
      const network = ad.network || ad.platform || "instagram";
      const id = ad.adId || ad.id;
      window.history.pushState(
        { adModal: true, network, id },
        "",
        `/${network}/${id}`,
      );
      trackEvent('showAnalytics', { ad_id: id, network });
    }
    setSelectedAdForAnalytics(ad);
  };

  const closeAnalyticsModal = () => {
    window.history.pushState(null, "", "/");
    setSelectedAdForAnalytics(null);
  };

  useEffect(() => {
    const onPopState = (e) => {
      const pathParts = window.location.pathname.split("/").filter(Boolean);
      const validNetworks = [
        "facebook",
        "instagram",
        "youtube",
        "google",
        "gdn",
        "native",
        "linkedin",
        "reddit",
        "quora",
        "pinterest",
        "tiktok",
      ];

      // Pattern 1: /{network}/{adId}
      if (pathParts.length === 2) {
        const [network, adId] = pathParts;
        if (validNetworks.includes(network.toLowerCase()) && adId) {
          setSelectedAdForAnalytics({
            id: adId,
            network: network.toLowerCase(),
            _fromUrl: true,
          });
          return;
        }
      }

      // Pattern 2: /{network}/landing/ad_id/{adId}
      if (
        pathParts.length === 4 &&
        pathParts[1] === "landing" &&
        pathParts[2] === "ad_id"
      ) {
        const [network, , , adId] = pathParts;
        if (validNetworks.includes(network.toLowerCase()) && adId) {
          setLandingAd({
            id: adId,
            network: network.toLowerCase(),
            _fromUrl: true,
          });
          setSelectedAdForAnalytics(null);
          return;
        }
      }
      setLandingAd(null);
      setSelectedAdForAnalytics(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Sync SDUI platform with URL network if landing directly on an ad
  useEffect(() => {
    if (landingAd?._fromUrl && sdui.activePlatforms.length > 0) {
      const net = landingAd.network;
      if (!sdui.activePlatforms.includes(net)) {
        sdui.setActivePlatforms([net]);
      }
    }
  }, [sdui.activePlatforms, landingAd, sdui.setActivePlatforms]);

  // Re-fetch plan access with the current network whenever specificPlatforms changes.
  // This covers: initial load (redux-persist restores platforms without handlePlatformClick firing)
  // and real-time platform switching.
  useEffect(() => {
    if (!token) return;
    const sp = ui.specificPlatforms;
    const network = sp.length === 1 ? sp[0] : sp.length > 1 ? sp : 'all';
    fetchPlanAccess(network).then(data => { if (data) setPlanAccess(data); }).catch(() => {});
  }, [ui.specificPlatforms, token]);

  const filterKey = useMemo(
    () => JSON.stringify(sdui.filterValues),
    [sdui.filterValues],
  );
  const platformKey = useMemo(
    () => sdui.activePlatforms.join(","),
    [sdui.activePlatforms],
  );

  // ── Shared Platform/Sort Logic ──────────────────────────────────────
  const platformsDoc = sdui.config?.navbar?.find((d) => d._id === "platforms");
  const platformFilter = platformsDoc?.filters?.[0];
  const platformOptions = useMemo(() => {
    const opts = platformFilter?.options || [];
    let allOpts;
    if (
      opts.length === 0 ||
      opts.some((o) => (o.value || "").toLowerCase() === "tiktok")
    )
      allOpts = opts;
    else
      allOpts = [...opts, { value: "tiktok", label: "TT", icon_url: null }];

    // Only hide tabs for amember custom plan users with explicit platform restrictions.
    // Regular plan-tier restrictions still show all tabs (clicking restricted ones opens upgrade modal).
    if (planAccess?.customPlatformRestriction && planAccess.allowedPlatforms?.length > 0) {
      return allOpts.filter((o) => planAccess.allowedPlatforms.includes((o.value || "").toLowerCase()));
    }
    return allOpts;
  }, [platformFilter, planAccess?.customPlatformRestriction, planAccess?.allowedPlatforms]);

  const sortingDoc = sdui.config?.navbar?.find((d) => d._id === "sorting");
  const sortFilter = sortingDoc?.filters?.[0];
  const sortOptions = sortFilter?.options || [];
  const sortTabs = useMemo(() => {
    if (sortOptions.length > 0) return sortOptions;
    return ["Newest", "Ad Running Days", "Domain Registration Date"].map((t) => ({
      label: t,
      value: t === "Newest" ? "-created_at" : t === "Ad Running Days" ? "-running_days" : "-domain_reg_date",
    }));
  }, [sortOptions]);

  // Derive primary/dropdown split from config: options with primary:true are inline tabs,
  // rest go in the dropdown. Falls back to hardcoded labels if config has no primary flag.
  const { PRIMARY_SORT_LABELS, DROPDOWN_SORT_LABELS } = useMemo(() => {
    const hasPrimaryFlag = sortOptions.some((o) => o.primary === true);
    if (hasPrimaryFlag) {
      const primary = sortOptions.filter((o) => o.primary).map((o) => (o.label ?? "").toLowerCase());
      const dropdown = sortOptions.filter((o) => !o.primary).map((o) => (o.label ?? "").toLowerCase());
      return { PRIMARY_SORT_LABELS: primary, DROPDOWN_SORT_LABELS: dropdown };
    }
    // No primary flag in config — use all option labels split by hardcoded known-primary set
    const knownPrimary = new Set(["newest", "impressions", "popularity"]);
    const primary = sortOptions.map((o) => (o.label ?? "").toLowerCase()).filter((l) => knownPrimary.has(l));
    const dropdown = sortOptions.map((o) => (o.label ?? "").toLowerCase()).filter((l) => !knownPrimary.has(l));
    return {
      PRIMARY_SORT_LABELS: primary.length > 0 ? primary : ["newest", "impressions", "popularity"],
      DROPDOWN_SORT_LABELS: dropdown.length > 0 ? dropdown : ["newest", "ad running days", "domain registration date"],
    };
  }, [sortOptions]);

  const allPlatformValues = useMemo(() => {
    if (platformOptions.length > 0)
      return platformOptions.map((opt) => opt.value ?? opt.label);
    const platforms = [
      "facebook",
      "instagram",
      "youtube",
      "google",
      "gdn",
      "native",
      "linkedin",
      "reddit",
      "quora",
      "pinterest",
      "tiktok",
    ];
    return platforms;
  }, [platformOptions]);

  const isAllActive = ui.specificPlatforms.length === 0;

  const handleAllClick = () => {
    if (!guest?.isPublicLanding && guestGuard("Please login to change platforms", {})) return;
    dispatch(setSpecificPlatforms([]));
    sdui.setActivePlatforms(allPlatformValues);
    if (!guest?.isPublicLanding) fetchPlanAccess('all').then(data => { if (data) setPlanAccess(data); }).catch(() => {});
  };

  const handlePlatformClick = (platformValue) => {
    if (!guest?.isPublicLanding && guestGuard("Please login to change platforms", { platform: platformValue })) return;
    if (
      planAccess?.allowedPlatforms &&
      planAccess.allowedPlatforms.length > 0 &&
      !planAccess.allowedPlatforms.includes(platformValue)
    ) {
      dispatch(openModal('isPricingModalOpen'));
      return;
    }

    let newSpecific;
    newSpecific = ui.specificPlatforms.includes(platformValue)
      ? ui.specificPlatforms.filter((p) => p !== platformValue)
      : [...ui.specificPlatforms, platformValue];

    if (newSpecific.length === 0) {
      dispatch(setSpecificPlatforms([]));
      sdui.setActivePlatforms(allPlatformValues);
      if (!guest?.isPublicLanding) fetchPlanAccess('all').then(data => { if (data) setPlanAccess(data); }).catch(() => {});
    } else {
      dispatch(setSpecificPlatforms(newSpecific));
      sdui.setActivePlatforms(newSpecific);
      if (!guest?.isPublicLanding) fetchPlanAccess(newSpecific.length === 1 ? newSpecific[0] : newSpecific).then(data => { if (data) setPlanAccess(data); }).catch(() => {});
    }
  };

  
  const DATE_TYPE_TO_FILTER_KEY = {
    ad_seen: "seen_btn_sort",
    post_date: "post_date_btn_sort",
    domain_reg: "domain_date_btn_sort",
  };

  const handleDateChange = (type, dates) => {
    if (guestGuard("Please login to change filters", {})) return;
    const filterKey = DATE_TYPE_TO_FILTER_KEY[type] || type;
    if (!dates || !dates[0] || !dates[1]) {
      sdui.setFilter(filterKey, null);
      return;
    }
    const [from, to] = dates;
    const toStartUnix = (d) => { const dt = new Date(d); return Math.floor(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0) / 1000); };
    const toEndUnix   = (d) => { const dt = new Date(d); return Math.floor(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59) / 1000); };
    sdui.setFilter(filterKey, [toEndUnix(to), toStartUnix(from)]);
  };

  // ── Hidden & Favourite State ─────────────────────────────────────────
  const [hiddenAdIds, setHiddenAdIds] = useState(new Set());
  const [hiddenAdvertiserIds, setHiddenAdvertiserIds] = useState(new Set());
  const [favouriteAdIds, setFavouriteAdIds] = useState(new Set());

  const _isPublicRoute = window.location.pathname.startsWith('/guest/') || window.location.pathname.startsWith('/share/') || window.location.pathname === '/guest-landing';

  useEffect(() => {
    if (sdui.activePlatforms.length === 0 || landingAd?._fromUrl || _isPublicRoute) return;
    const loadHidden = async () => {
      try {
        const results = await Promise.all(
          sdui.activePlatforms.map((p) =>
            fetchHiddenAndFavourites(p).then(r => ({ ...r, platform: p.toLowerCase() }))
          ),
        );
        const allHiddenAds = new Set();
        const allHiddenAdvertisers = new Set();
        const allFavourites = new Set();
        for (const r of results) {
          const pl = r.platform;
          r.hiddenAdIds.forEach((id) => allHiddenAds.add(`${pl}:${id}`));
          r.hiddenAdvertiserIds.forEach((id) => allHiddenAdvertisers.add(`${pl}:${id}`));
          r.favouriteAdIds.forEach((id) => allFavourites.add(`${pl}:${id}`));
        }
        setHiddenAdIds(allHiddenAds);
        setHiddenAdvertiserIds(allHiddenAdvertisers);
        setFavouriteAdIds(allFavourites);
      } catch (err) {
        console.error("Failed to fetch hidden/favourites:", err);
      }
    };
    loadHidden();
  }, [platformKey]);

  const visibleAds = useMemo(() => {
    const BLOCKED_MEDIA_RE = /\/(pasimages|pasvideoes|pasvideos|pasimage|pasvideo)\/|bydefault_ads/i;
    const isBlockedMedia = (u) => typeof u === 'string' && BLOCKED_MEDIA_RE.test(u);
    const filtered = ads.filter((ad) => {
      const platform = (ad.network || '').toLowerCase();
      const adId = Number(ad.adId || ad.id);
      const ownerId = Number(ad.postOwnerId);
      if (hiddenAdIds.has(`${platform}:${adId}`)) return false;
      if (hiddenAdvertiserIds.has(`${platform}:${ownerId}`)) return false;
      if (isBlockedMedia(ad.thumbnail) || isBlockedMedia(ad.videoUrl) || isBlockedMedia(ad.videoUrlFallback)) return false;
      if (Array.isArray(ad.carouselMedia) && ad.carouselMedia.some(isBlockedMedia)) return false;
      return true;
    });

    // NOTE: we deliberately do NOT re-sort here. The grid order is whatever the
    // backend returned, appended page by page. A client-side re-sort over the
    // whole accumulated list reorders already-rendered cards on every page
    // append (the masonry positions each card by its index within its column),
    // which shoved the viewport and caused the "scroll jumps back up" behaviour
    // on popularity/running-days sorts. "Newest" never re-sorted client-side and
    // never jumped — this makes the numeric sorts behave the same. The backend
    // now sorts each page (and, for popularity, excludes score-less docs via an
    // `exists` filter), so a render-time re-sort is no longer needed.
    return filtered;
  }, [ads, hiddenAdIds, hiddenAdvertiserIds]);

  const hiddenCount = useMemo(
    () => ads.length - visibleAds.length,
    [ads.length, visibleAds.length],
  );

  const handleHideAd = useCallback(async (ad) => {
    try {
      await hideAds({
        network: ad.network,
        adId: ad.adId,
        postOwnerId: ad.postOwnerId,
        type: 2,
      });
      const hideKey = `${(ad.network || '').toLowerCase()}:${Number(ad.adId)}`;
      setHiddenAdIds((prev) => new Set(prev).add(hideKey));
      // The backend auto-unfavourites an ad when it's hidden, so mirror that in
      // local state: drop it from favourites so the heart un-fills and it leaves
      // the Favourites section. Without this the stale heart would trigger an
      // unHide(type=3) that matches 0 rows → "Failed to update favourite" toast.
      setFavouriteAdIds((prev) => {
        if (!prev.has(hideKey)) return prev;
        const next = new Set(prev);
        next.delete(hideKey);
        return next;
      });
      showToast("Ad hidden successfully", "success");
      trackEvent('favAds', { ad_id: ad.adId, network: ad.network, hidetype: 2, post_owner_id: ad.postOwnerId ?? 'NA' });
    } catch (err) {
      setActionError("Failed to hide ad. Please try again.");
    }
  }, [showToast]);

  // Unhide from the Hidden page — type=1 for advertiser-hidden, type=2 for ad-hidden, type=3 for favourite
  const handleUnHideAd = useCallback(async (ad) => {
    try {
      const type = ad.hideType ?? 2;
      const postOwnerId = ad.hiddenPostOwnerId ?? ad.postOwnerId;
      await unHideAds({
        network: ad.network,
        adId: ad.adId,
        postOwnerId,
        type,
      });
      const platform = (ad.network || '').toLowerCase();
      if (type === 1) {
        setHiddenAdvertiserIds((prev) => {
          const next = new Set(prev);
          next.delete(`${platform}:${Number(postOwnerId)}`);
          return next;
        });
        showToast("Advertiser unhidden successfully", "success");
      } else {
        setHiddenAdIds((prev) => {
          const next = new Set(prev);
          next.delete(`${platform}:${Number(ad.adId)}`);
          return next;
        });
        showToast("Ad unhidden successfully", "success");
      }
      trackEvent('unHide', { ad_id: ad.adId, network: ad.network, unhidetype: type, post_owner_id: postOwnerId ?? 'NA' });
    } catch (err) {
      showToast("Failed to unhide. Please try again.", "error");
      throw err;
    }
  }, [showToast]);

  const handleHideAdvertiser = useCallback(async (ad) => {
    try {
      await hideAds({
        network: ad.network,
        adId: ad.adId,
        postOwnerId: ad.postOwnerId,
        type: 1,
      });
      const platform = (ad.network || '').toLowerCase();
      const ownerId = Number(ad.postOwnerId);
      setHiddenAdvertiserIds((prev) => new Set(prev).add(`${platform}:${ownerId}`));
      // Hiding an advertiser unfavourites all of its ads on the backend, so mirror
      // that locally: drop every loaded ad from this advertiser out of favourites
      // so their hearts un-fill and they leave the Favourites section. Without this
      // a stale heart would trigger an unHide(type=3) that matches 0 rows →
      // "Failed to update favourite" toast.
      setFavouriteAdIds((prev) => {
        const keysToDrop = ads
          .filter((a) => (a.network || '').toLowerCase() === platform && Number(a.postOwnerId) === ownerId)
          .map((a) => `${platform}:${Number(a.adId || a.id)}`);
        if (!keysToDrop.some((k) => prev.has(k))) return prev;
        const next = new Set(prev);
        keysToDrop.forEach((k) => next.delete(k));
        return next;
      });
      showToast("Advertiser hidden successfully", "success");
      trackEvent('favAds', { ad_id: ad.adId, network: ad.network, hidetype: 1, post_owner_id: ad.postOwnerId ?? 'NA' });
    } catch (err) {
      setActionError("Failed to hide advertiser. Please try again.");
    }
  }, [showToast, ads]);

  const handleToggleFavourite = useCallback(async (ad) => {
    try {
      const platform = (ad.network || '').toLowerCase();
      const favKey = `${platform}:${Number(ad.adId)}`;
      const isFavourited = favouriteAdIds.has(favKey);

      if (isFavourited) {
        await unHideAds({
          network: ad.network,
          adId: ad.adId,
          postOwnerId: ad.postOwnerId,
          type: 3,
        });
        setFavouriteAdIds((prev) => {
          const next = new Set(prev);
          next.delete(favKey);
          return next;
        });
        showToast("Removed from Favourites", "success");
        trackEvent('unHide', { ad_id: ad.adId, network: ad.network, unhidetype: 3, post_owner_id: ad.postOwnerId ?? 'NA' });
      } else {
        await hideAds({
          network: ad.network,
          adId: ad.adId,
          postOwnerId: ad.postOwnerId,
          type: 3,
        });
        setFavouriteAdIds((prev) => {
          const next = new Set(prev);
          next.add(favKey);
          return next;
        });
        showToast("Added to Favourites", "success");
        trackEvent('favAds', { ad_id: ad.adId, network: ad.network, hidetype: 3, post_owner_id: ad.postOwnerId ?? 'NA' });
      }
    } catch (err) {
      setActionError("Failed to update favourite. Please try again.");
    }
  }, [favouriteAdIds, showToast]);

  const [debouncedFilterKey, setDebouncedFilterKey] = useState(filterKey);
  const debounceTimer = useRef(null);
  const lastDailyKeywordRef = useRef(null);
  const projectContextRef = useRef(null);
  const [projectContextTrigger, setProjectContextTrigger] = useState(0);
  useEffect(() => {
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(
      () => setDebouncedFilterKey(filterKey),
      500,
    );
    return () => clearTimeout(debounceTimer.current);
  }, [filterKey]);

  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchTrigger, setSearchTrigger] = useState(0);

  // Auto-open pricing modal when guest on public landing reaches the end of ads
  useEffect(() => {
    if (!hasMore && guest?.isPublicLanding && ads.length > 0) {
      dispatch(openModal('isPricingModalOpen'));
    }
  }, [hasMore, guest?.isPublicLanding, ads.length, dispatch]);

  useEffect(() => {
    setPage(0);
    setAds([]);
    // NB: do NOT wipe adsMeta here. The count label is already hidden while
    // loading (adsCount requires ads.length > 0), so clearing ads is enough to
    // avoid a stale-count flash. Wiping adsMeta too opened a race: on a switch
    // this effect can fire twice (immediate platformKey change + the 500ms
    // debounced filterKey / sdui.loading settle), and if the response that
    // ultimately populates `ads` is superseded/aborted or arrives on a non-page-0
    // path, nothing restores adsMeta — so the grid shows ads with no "Total Ads"
    // count. Letting the next response overwrite adsMeta keeps them in sync.
    setHasMore(true);
  }, [debouncedFilterKey, platformKey, ui.searchQuery, ui.searchIn, ui.exactSearch, searchTrigger, landingAd?.id]);

  useEffect(() => {
    if (!actionError) return;
    const t = setTimeout(() => setActionError(null), 4000);
    return () => clearTimeout(t);
  }, [actionError]);

  // project_access.enabled is the single gate — fully controlled via admin panel (plan_access_config)
  // const canAccessProjects = planAccess
  //   ? (planAccess.filters?.project_access?.enabled === true ||
  //       (planAccess.competitorLimits?.brandLimit ?? 0) > 0)
  //   : false;
  const canAccessProjects = planAccess
    ? planAccess.filters?.project_access?.enabled === true
    : false;

  // Guard: if user somehow lands on "projects" without plan access, redirect to ads and show pricing modal
  useEffect(() => {
    if (ui.activePage === "projects" && planAccess && !canAccessProjects) {
      dispatch(setActivePage("ads"));
      dispatch(openModal('isPricingModalOpen'));
    }
  }, [ui.activePage, planAccess, canAccessProjects, dispatch]);

  // Guard: block analytics modal for plans without ad_analytics access.
  // Runs regardless of how selectedAdForAnalytics was set (button, URL init, popstate, etc.)
  useEffect(() => {
    if (!selectedAdForAnalytics) return;
    if (!planAccess) return; // planAccess not yet loaded — wait for it to settle
    const canAccessAnalytics = planAccess.filters?.ad_analytics?.enabled === true;
    if (!canAccessAnalytics) {
      setSelectedAdForAnalytics(null);
      window.history.replaceState(null, '', '/');
      dispatch(openModal('isPricingModalOpen'));
    }
  }, [selectedAdForAnalytics, planAccess, dispatch]);

  useEffect(() => {
    const controller = new AbortController();
    const loadAds = async () => {
      // On a fresh search (page 0), drop stale ads immediately so the UI shows a
      // loader instead of the previous tab/filter's results while the new fetch runs.
      if (page === 0) setAds([]);
      setLoadingMore(true);
      setAvailableNetworks([]);
      setNoDataMessage(null);
      if (page === 0) setError(null);
      try {
        const isLanding = landingAd?._fromUrl;
        // Filter out platforms not allowed by the current plan before querying.
        // Use activePlatforms (user's selection) not effectivePlatforms — each filter's
        // per-platform field gating is handled inside buildSearchPayload via platformSupports,
        // so all selected platforms are always queried and unsupported filter fields are sent as 'NA'.
        const planAllowed = planAccess?.allowedPlatforms;
        const permittedPlatforms = (planAllowed && planAllowed.length > 0)
          ? sdui.activePlatforms.filter(p => planAllowed.includes(p))
          : sdui.activePlatforms;

        // Share mode: use pre-loaded ads from GuestProvider
        const isShareMode = guest?.isGuest && guest?.sharedAds;
        if (isShareMode && page === 0) {
          setAds(guest.sharedAds);
          setHasMore(false);
          setLoadingMore(false);
          return;
        }
        if (isShareMode && page > 0) {
          setHasMore(false);
          setLoadingMore(false);
          return;
        }

        const isPublicLanding = guest?.isPublicLanding;
        const isGuestMode = guest?.isGuest && guest?.guestToken;
        if (_isPublicRoute) console.log('[GUEST-DEBUG] loadAds called', { isGuestMode, isShareMode, isPublicLanding, isLanding, page, guestToken: guest?.guestToken });

        // Block search/filter on public landing — restore default empty state and show toaster
        if (isPublicLanding && page === 0 && (ui.searchQuery || Object.keys(sdui.filterValues || {}).some(k => {
          const v = sdui.filterValues[k]; return v != null && v !== '' && v !== 'NA' && v !== 'all' && v !== false && !(Array.isArray(v) && v.length === 0);
        }))) {
          dispatch(setSearchQuery(''));
          sdui.clearAll?.();
          setLoadingMore(false);
          guest?.showGuestWarning?.("Please login to search and filter ads");
          return;
        }

        const _fv = sdui.filterValues || {};
        const _ttValActive = (key) => { const v = _fv[key]; return v != null && v !== '' && v !== 'NA' && v !== 'all' && v !== false; };

        // Meta Ads Library is only supported on Facebook/Instagram.
        const _metaAdsLibActive = _ttValActive('meta_ads_lib_filter');
        const _metaAdsLibUnsupported = _metaAdsLibActive &&
          !permittedPlatforms.some(p => p.toLowerCase() === 'facebook' || p.toLowerCase() === 'instagram');

        const _projCtx = page === 0 ? projectContextRef.current : null;
        if (page === 0) projectContextRef.current = null;
        const _searchParams = {
          ...sdui.filterValues,
          searchQuery: ui.searchQuery,
          searchIn: ui.searchIn,
          exactSearch: ui.exactSearch,
          selCategories: sdui.selCategories,
          selCountries: sdui.selCountries,
          sortBy: sdui.sortBy,
          activePlatforms: permittedPlatforms,
          activePlatform: permittedPlatforms[0] || 'facebook',
          skip: page,
          filterPlatformSupport: sdui.filterPlatformSupport,
          isAllTab: isAllActive,
          ...(_projCtx || {}),
        };

        // ── Single API call for all platforms including TikTok ──────────────────
        const data = isLanding
          ? await fetchLandingAd(landingAd.network, landingAd.id)
          : isPublicLanding
          ? await (async () => {
              const platforms = ui.specificPlatforms;
              if (platforms.length <= 1) {
                return publicSearchAds(page, platforms.length === 1 ? platforms[0] : 'all');
              }
              // Multiple platforms selected — fetch each in parallel, 35 ads per platform
              const results = await Promise.all(platforms.map(p => publicSearchAds(page, p).catch(() => ({ ads: [], meta: {}, guestLimitReached: false }))));
              const mergedAds = results.flatMap(r => r.ads || []);
              const guestLimitReached = results.every(r => r.guestLimitReached);
              const mergedTotal = results.reduce((acc, r) => {
                const t = r.meta?.total;
                if (t && typeof t === 'object') Object.assign(acc, t);
                return acc;
              }, {});
              return { ads: mergedAds, meta: { ...results[0]?.meta, total: mergedTotal, guestLimitReached }, guestLimitReached };
            })()
          : isGuestMode
          ? await guestSearchAds(guest.guestToken, page)
          : _metaAdsLibUnsupported
          ? await (async () => {
              const d = await fetchAds({ ..._searchParams, activePlatforms: ['facebook'], activePlatform: 'facebook', skip: 0 }, { signal: controller.signal });
              const rawTotal = d.meta?.total;
              const filteredTotal = rawTotal && typeof rawTotal === 'object'
                ? Object.fromEntries(Object.entries(rawTotal).filter(([p]) => ['facebook', 'instagram'].includes(p.toLowerCase())))
                : rawTotal;
              return { ...d, ads: [], meta: { ...d.meta, total: filteredTotal } };
            })()
          : await fetchAds(_searchParams, { signal: controller.signal });

        // If a newer fetch superseded us while we were awaiting, drop this response.
        if (controller.signal.aborted) return;
        if (_isPublicRoute) console.log('[GUEST-DEBUG] data received', { adsCount: data?.ads?.length, guestLimitReached: data?.guestLimitReached, error: null });

        // Fire daily keyword request only when triggered by an explicit search submit (ref set in handleSearch)
        if (page === 0 && lastDailyKeywordRef.current) {
          const { query, si, userEmail, network } = lastDailyKeywordRef.current;
          lastDailyKeywordRef.current = null; // clear immediately so filter changes don't re-trigger
          const adsCount = data?.meta?.total?.facebook ?? data?.ads?.filter(a => a.network === 'facebook')?.length ?? 0;
          const adsFound = adsCount > 0;
          saveKeywordSearch({
            value: query,
            type: si,        // 'keyword' | 'advertiser' | 'domain'
            network,         // 'all' or array of platform slugs
            email: userEmail,
            ads_count: adsCount,
          }).then((res) => {
            if (res?.data?.status === 'skip') return;
            if (adsFound) showToast('Hang On! Syncing Recent Ads for You', 'success');
            else showToast('Your request is now in motion — ads will be provided soon.', 'success');
          }).catch(() => {});
        }

        const {
          ads: newAds,
          availableNetworks: networks,
          noDataMessage: msg,
          meta,
        } = data;
        setAds((prev) => {
          if (page === 0) return newAds;
          const existingIds = new Set(prev.map((a) => a.id));
          const unique = newAds.filter((a) => !existingIds.has(a.id));
          // Append-only. We deliberately do NOT re-sort the merged set here.
          // Re-sorting on every page append reorders already-rendered cards, and
          // because the masonry positions each card by its index within its
          // column, that yanks earlier cards to new positions mid-scroll — the
          // Popularity-only "scroll jumps" bug (measured: ~0px on Newest, cards
          // shifting thousands of px on Popularity). The backend now returns each
          // page already sorted descending and excludes score-less docs, so the
          // old [scored → null → scored] interleaving can't recur; an append
          // keeps a consistent order (matching how Newest already behaves).
          return [...prev, ...unique];
        });
        if (networks) setAvailableNetworks(networks);
        if (msg) setNoDataMessage(msg);
        // Set on EVERY non-aborted response that carries a total, not just
        // page 0. meta.total is the ES match total (stable across pages), so
        // re-setting it on appends is a harmless no-op — but it guarantees the
        // count stays in sync with whatever response populated `ads`, closing
        // the race where a lost/aborted page-0 meta-set left the count blank.
        if (meta?.total != null) {
          if (typeof meta.total === 'number') {
            // Determine the primary platform for a numeric total
            const _onlyTiktok = tiktokPermitted.length > 0 && genericPermitted.length === 0;
            const _primaryPlatform = _onlyTiktok ? 'tiktok' : (genericPermitted[0] || 'facebook');
            setAdsMeta({ [_primaryPlatform]: meta.total });
          } else {
            setAdsMeta(meta.total);
          }
        }
        if (meta?.planAccess) setPlanAccess(meta.planAccess);
        if (meta?.clientIp) {
          try { localStorage.setItem('clientIP', meta.clientIp); } catch {}
        }
        // Guest mode: stop loading when limit reached
        if (data.guestLimitReached) {
          setHasMore(false);
        } else if (typeof meta?.hasMore === 'boolean') {
          // Prefer the backend's ES-total-based signal so a short page (some ads
          // dropped in SQL hydration/dedup) doesn't prematurely end pagination
          // while thousands of ES matches remain. Guard with newAds.length > 0
          // so a sparse/orphan network can't loop forever fetching empty pages.
          setHasMore(meta.hasMore && newAds.length > 0);
        } else {
          // Fallback for older backend responses without meta.hasMore.
          setHasMore(newAds.length >= 9);
        }
      } catch (err) {
        // Aborted by a newer effect run (user switched tab/filter) — silently bail.
        if (controller.signal.aborted || err.name === 'AbortError') return;
        if (_isPublicRoute) console.error('[GUEST-DEBUG] loadAds ERROR', err.message, err);
        if (err.showSubscriptionModal || err.code === 403) {
          dispatch(openModal('isPricingModalOpen'));
          // Clear restricted filter values from SDUI state so the filter UI resets
          if (err.restrictedFilters?.length > 0) {
            err.restrictedFilters.forEach((bodyKey) => {
              const sduiIds = RESTRICTED_BODY_KEY_TO_SDUI_IDS[bodyKey] || [bodyKey];
              sduiIds.forEach((id) => sdui.setFilter(id, null));
            });
          }
          return;
        }
        if (page === 0) {
          setError(err.message || "Failed to load ads. Please try again.");
        } else {
          setActionError("Failed to load more ads.");
          setHasMore(false);
        }
      } finally {
        if (!controller.signal.aborted) setLoadingMore(false);
      }
    };
    if (sdui.loading || sdui.activePlatforms.length === 0) return;
    // In guest mode, wait for guest state to load before fetching ads
    if (guest?.isGuest && guest?.loading) return;
    // Don't fetch ads while on the projects page
    if (location.pathname === '/projects') return;
    loadAds();
    return () => controller.abort();
  }, [
    debouncedFilterKey,
    platformKey,
    ui.searchQuery,
    ui.searchIn,
    ui.exactSearch,
    searchTrigger,
    page,
    sdui.loading,
    guest?.loading,
    location.pathname,
    projectContextTrigger,
  ]);

  // Guest-safe wrappers — guest: toaster, logged-in on guest page: redirect to dashboard
  const guestGuard = useCallback((warningMsg, dashboardState) => {
    if (!guest?.isGuest) return false; // normal mode, no guard
    if (guest.isRestricted) {
      if (guest.isPublicLanding) {
        dispatch(openModal('isPricingModalOpen'));
      } else {
        guest.showGuestWarning(warningMsg);
      }
      return true; // blocked
    }
    // Logged-in user on guest/share page → redirect to dashboard with state
    guest.redirectToDashboard(dashboardState);
    return true; // will redirect
  }, [guest, dispatch]);

  const guestSetSearchQuery = (val) => {
    if (guest?.isPublicLanding && guest?.isRestricted) { guest.showGuestWarning("Please login to search"); return; }
    if (guestGuard("Please login to search", { searchQuery: val, searchIn: ui.searchIn })) return;
    dispatch(setSearchQuery(val));
  };
  const guestSetSearchIn = (val) => {
    if (guest?.isPublicLanding && guest?.isRestricted) { guest.showGuestWarning("Please login to search"); return; }
    if (guestGuard("Please login to search", { searchQuery: ui.searchQuery, searchIn: val })) return;
    dispatch(setSearchIn(val));
    // Clear category filters when switching away from keyword — they don't apply to advertiser/domain search
    if (val !== 'keyword') {
      sdui.setFilter('subcategory', []);
      sdui.setFilter('adcategory', []);
    }
  };
  const guestSetExactSearch = (val) => {
    if (guestGuard("Please login to search", { exactSearch: val })) return;
    dispatch(setExactSearch(val));
  };
  const guestSetActiveTab = (val) => {
    if (guestGuard("Please login to change sorting", { activeTab: val })) return;
    dispatch(setActiveTab(val));
  };
  const guestSetPreviewMode = (val) => {
    if (guestGuard("Please login to use this feature", {})) return;
    dispatch(setPreviewMode(val));
  };

  const handleSearch = useCallback((query, type, platform) => {
    if (guest?.isPublicLanding && guest?.isRestricted) {
      guest.showGuestWarning("Please login to search");
      return;
    }
    if (guestGuard("Please login to search", { searchQuery: query, searchIn: type || ui.searchIn })) return;
    dispatch(setSearchQuery(query));
    setSearchTrigger(prev => prev + 1);
    if (type) dispatch(setSearchIn(type));
    if (platform) {
      sdui.setActivePlatforms([platform]);
      dispatch(setSpecificPlatforms([platform]));
    }

    // Keyword-search store — only on explicit search submit, AUTHENTICATED users only
    // (never guest / public). Stores the searched network(s): 'all' or the selected slugs.
    if (query && isAuthenticated && !guest?.isGuest && !_isPublicRoute) {
      const si = type || ui.searchIn || 'keyword';
      const userEmail = user?.email || '';
      const selected = (platform ? [platform] : ui.specificPlatforms) || [];
      const network = selected.length === 0 ? 'all' : selected.map((p) => String(p).toLowerCase());
      lastDailyKeywordRef.current = { query, si, userEmail, network };
    }
  }, [guestGuard, dispatch, ui.searchIn, ui.specificPlatforms, sdui, user, guest, isAuthenticated, _isPublicRoute]);

  // Recent Activity ("Today / Yesterday / Last Week / Last Month") click on the
  // competitor analytics table → land on the ads library searching that
  // advertiser, with the matching seen-date range and the advertiser's
  // platforms pre-selected.
  //   last_7  → the 7 days ending one day before today (today-7 … yesterday)
  //   last_30 → the 30 days ending one day before today (today-30 … yesterday)
  const handleRecentActivityClick = useCallback((advertiserName, period, platforms) => {
    if (guestGuard("Please login to search", {})) return;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfYesterday = new Date(startOfToday);
    endOfYesterday.setDate(endOfYesterday.getDate() - 1);
    endOfYesterday.setHours(23, 59, 59);

    let range;
    switch (period) {
      case "today":
        range = [startOfToday, now];
        break;
      case "yesterday": {
        const yStart = new Date(startOfToday);
        yStart.setDate(yStart.getDate() - 1);
        range = [yStart, endOfYesterday];
        break;
      }
      case "last_7": {
        const start = new Date(startOfToday);
        start.setDate(start.getDate() - 7);
        range = [start, endOfYesterday];
        break;
      }
      case "last_30": {
        // Exactly one month before yesterday → yesterday (e.g. 11/05 → 11/06).
        const start = new Date(endOfYesterday);
        start.setMonth(start.getMonth() - 1);
        range = [start, endOfYesterday];
        break;
      }
      default:
        range = null;
    }

    const pls = (platforms || [])
      .map((p) => String(p).toLowerCase())
      .filter(Boolean);
    if (pls.length) {
      sdui.setActivePlatforms(pls);
      dispatch(setSpecificPlatforms(pls));
    }

    handleSearch(advertiserName, "advertiser");
    if (range) handleDateChange("ad_seen", range);
    // Fold the upcoming filter snapshot into the page-navigation history entry so
    // one browser Back returns to the project's Competitor Analytics view.
    coalesceNextHistoryWrite();
    dispatch(setActivePage("ads"));
  }, [guestGuard, dispatch, sdui, handleSearch]);

  // Top Country click on the competitor analytics table → land on the ads
  // library searching that advertiser with ONLY the country filter applied —
  // any other active filter (date, CTA, category, …) is cleared — and the
  // advertiser's platforms pre-selected.
  //   countries: a single code ("US") or the competitor's full list (= "All").
  const handleCountryClick = useCallback((advertiserName, countries, platforms) => {
    if (guestGuard("Please login to search", {})) return;

    const list = (Array.isArray(countries) ? countries : [countries])
      .map((c) => String(c || "").trim().toUpperCase())
      .filter(Boolean);

    const pls = (platforms || [])
      .map((p) => String(p).toLowerCase())
      .filter(Boolean);
    if (pls.length) {
      sdui.setActivePlatforms(pls);
      dispatch(setSpecificPlatforms(pls));
    }

    // Replace the whole filter state — wipes every previously applied filter
    // and leaves only the clicked country/countries.
    sdui.setAllFilters(list.length ? { country_filter: list } : {});

    handleSearch(advertiserName, "advertiser");
    // Fold the upcoming filter snapshot into the page-navigation history entry so
    // one browser Back returns to the project's Competitor Analytics view.
    coalesceNextHistoryWrite();
    dispatch(setActivePage("ads"));
  }, [guestGuard, dispatch, sdui, handleSearch]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const params = new URLSearchParams(window.location.search);
    let advertiser = params.get('advertiser');
    let platform = params.get('platform');
    if (!advertiser) {
      const pending = sessionStorage.getItem('pendingSearch');
      if (pending) {
        try {
          const parsed = JSON.parse(pending);
          advertiser = parsed.advertiser;
          platform = parsed.platform;
        } catch {}
      }
    }
    if (advertiser) {
      sessionStorage.removeItem('pendingSearch');
      handleSearch(advertiser, 'advertiser', platform || 'facebook');
      window.history.replaceState({}, '', '/');
      return;
    }
    // Platform-only deep link (e.g. from the daily data-report email):
    //   /?platform=instagram  → pre-select Instagram, land on the default
    // ads view. No advertiser is searched; we just set the network filter.
    if (platform) {
      const valid = ['facebook', 'instagram', 'youtube', 'google', 'gdn',
                     'native', 'linkedin', 'reddit', 'quora', 'pinterest', 'tiktok'];
      const key = String(platform).toLowerCase();
      if (valid.includes(key)) {
        dispatch(setSpecificPlatforms([key]));
        window.history.replaceState({}, '', '/');
      }
    }
  }, [isAuthenticated, dispatch]);

  // After login, restore an allow-listed deep-link destination saved before the
  // aMember redirect (e.g. a /projects link opened while logged out). The
  // url→state sync effect then promotes the path to the right activePage.
  useEffect(() => {
    if (!isAuthenticated) return;
    const pendingRedirect = sessionStorage.getItem('pendingRedirect');
    if (!pendingRedirect) return;
    sessionStorage.removeItem('pendingRedirect');
    if (
      isSafeDeepLink(pendingRedirect) &&
      window.location.pathname !== pendingRedirect.split('?')[0]
    ) {
      navigate(pendingRedirect);
    }
  }, [isAuthenticated, navigate]);

  const handleExportAll = useCallback(async () => {
    try {
      const planAllowed = planAccess?.allowedPlatforms;
      const permittedPlatforms = (planAllowed && planAllowed.length > 0)
        ? sdui.effectivePlatforms.filter(p => planAllowed.includes(p))
        : sdui.effectivePlatforms;
      const _fv = sdui.filterValues || {};
      const _ok = (v) => v && v !== 'NA' && !(Array.isArray(v) && (v.length === 0 || v.every(x => x === 'NA' || x === '' || x == null)));
      const _exportBudgetActive = Object.entries(_fv).some(([k, v]) => k.toLowerCase().includes('budget') && _ok(v));
      const _BNETS = ['facebook', 'instagram', 'youtube'];
      const exportPlatforms = _exportBudgetActive
        ? (permittedPlatforms.filter(p => _BNETS.includes(p.toLowerCase())).length > 0
            ? permittedPlatforms.filter(p => _BNETS.includes(p.toLowerCase()))
            : permittedPlatforms)
        : permittedPlatforms;
      const activePlatform = permittedPlatforms.find(p => p.toLowerCase() !== 'tiktok') || permittedPlatforms[0] || 'facebook';
      trackEvent('ExportAds', {
        network: isAllActive ? 'All' : (exportPlatforms.length === 1 ? exportPlatforms[0] : exportPlatforms.join(',')),
      });
      return await fetchAdsForExport({ ...sdui.filterValues, activePlatforms: exportPlatforms, activePlatform, searchQuery: ui.searchQuery, searchIn: ui.searchIn, exactSearch: ui.exactSearch, selCategories: sdui.selCategories, selCountries: sdui.selCountries, sortBy: sdui.sortBy });
    } catch {
      return [];
    }
  }, [planAccess, sdui, ui]);

  const handleAnalyzeAd = async (ad) => {
    setSelectedAdForAI(ad);
    setIsAnalyzing(true);
    setAiAnalysis("");
    trackEvent('aiAnalyze', { ad_id: ad?.adId ?? ad?.id, network: ad?.network ?? 'NA' });
    try {
      const prompt = buildAuditPrompt(ad);
      const result = await fetchGemini(prompt);
      setAiAnalysis(result);
    } catch {
      setAiAnalysis("Analysis unavailable.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGenerateCampaign = async () => {
    setIsGeneratingStrategy(true);
    dispatch(openModal('isCampaignModalOpen'));
    setCampaignStrategy("");
    try {
      const prompt = buildCampaignPrompt(ads);
      const result = await fetchGemini(prompt);
      setCampaignStrategy(result);
    } catch {
      setCampaignStrategy("Strategy generation failed.");
    } finally {
      setIsGeneratingStrategy(false);
    }
  };

  if (authLoading && !_isPublicRoute) return null;
  if (!isAuthenticated && !_isPublicRoute) {
    const _params = new URLSearchParams(window.location.search);
    const _advertiser = _params.get('advertiser');
    if (_advertiser) {
      sessionStorage.setItem('pendingSearch', JSON.stringify({
        advertiser: _advertiser,
        platform: _params.get('platform') || 'facebook',
      }));
    }
    // Deep-link guard: the aMember login round-trip drops the original path
    // (user comes back at `/?token=…`). Remember an allow-listed in-app
    // destination (e.g. /projects) so we can restore it once authenticated.
    const _intended = window.location.pathname + window.location.search;
    if (isSafeDeepLink(_intended)) {
      sessionStorage.setItem('pendingRedirect', _intended);
    }
    window.location.href = AMEMBER_LOGIN_REDIRECT;
    return null;
  }
  if (!checkIsLoggedIn() && !_isPublicRoute && _isAdAnalyticsUrl) {
    window.location.href = AMEMBER_LOGIN_REDIRECT;
    return null;
  }

  return (
    <div
      className="h-screen flex flex-col font-sans selection:bg-[#3762c1]/20 overflow-hidden transition-colors duration-300"
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      <Header
        isSidebarOpen={ui.isSidebarOpen}
        setIsSidebarOpen={(val) => dispatch(setSidebarOpen(val))}
        committedQuery={ui.searchQuery}
        onSearch={handleSearch}
        searchIn={ui.searchIn}
        setSearchIn={guestSetSearchIn}
        searchQuery={ui.searchQuery}
        setSearchQuery={guestSetSearchQuery}
        exactSearch={ui.exactSearch}
        setExactSearch={guestSetExactSearch}
        onGenerateStrategy={handleGenerateCampaign}
        sdui={sdui}
        setActiveTab={(val) => dispatch(setActiveTab(val))}
        activePage={ui.showSavedAdsPage ? "projects" : ui.activePage}
        isLanding={!!landingAd}
        isScrolled={isHeaderScrolled}
        previewMode={ui.previewMode}
        setPreviewMode={(val) => dispatch(setPreviewMode(val))}
        specificPlatforms={ui.specificPlatforms}
        setSpecificPlatforms={(val) => dispatch(setSpecificPlatforms(val))}
        platformOptions={platformOptions}
        allowedPlatforms={planAccess?.allowedPlatforms}
        sortTabs={sortTabs}
        isAllActive={isAllActive}
        handleAllClick={handleAllClick}
        handlePlatformClick={handlePlatformClick}
        onDateChange={handleDateChange}
        isFilterRestricted={isFilterRestricted}
        onDateRestricted={() => dispatch(openModal('isPricingModalOpen'))}
        onSortRestricted={() => dispatch(openModal('isPricingModalOpen'))}
        PRIMARY_SORT_LABELS={PRIMARY_SORT_LABELS}
        guest={guest}
        showOnlyFavourites={ui.showSavedAdsPage}
        onShowFavourites={() => dispatch(setShowSavedAdsPage(!ui.showSavedAdsPage))}
        DROPDOWN_SORT_LABELS={DROPDOWN_SORT_LABELS}
        activeTab={ui.activeTab}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          isOpen={ui.isSidebarOpen}
          setIsOpen={(val) => dispatch(setSidebarOpen(val))}
          sdui={sdui}
          onGenerateStrategy={handleGenerateCampaign}
          activePage={ui.activePage}
          onPageChange={(val) => {
            if (guest?.isPublicLanding) { guest.showGuestWarning('Please login to access this feature'); return; }
            dispatch(setActivePage(val));
            dispatch(setShowSavedAdsPage(false));
          }}
          isFilterRestricted={isFilterRestricted}
          filterHasPlanEntry={filterHasPlanEntry}
          onRestricted={() => {
            dispatch(openModal('isPricingModalOpen'));
          }}
          canAccessProjects={canAccessProjects}
          guest={guest}
          isLoggedIn={!guest?.isRestricted}
          allowedPlatforms={planAccess?.allowedPlatforms}
          showSavedAdsPage={ui.showSavedAdsPage}
          onShowSavedAdsPage={() => {
            const next = !ui.showSavedAdsPage;
            dispatch(setActivePage('ads'));
            dispatch(setShowSavedAdsPage(next));
          }}
          searchIn={ui.searchIn}
        />

        {ui.activePage === "projects" && canAccessProjects ? (
          <AllProjects
            onSearch={handleSearch}
            onNavigateToAds={() => { coalesceNextHistoryWrite(); dispatch(setActivePage("ads")); }}
            onRecentActivityClick={handleRecentActivityClick}
            onCountryClick={handleCountryClick}
            setProjectContext={(ctx) => { projectContextRef.current = ctx; setProjectContextTrigger(t => t + 1); }}
          />
        ) : ui.showSavedAdsPage ? (
          <SavedAdsPage
            sdui={sdui}
            favouriteAdIds={favouriteAdIds}
            hiddenAdIds={hiddenAdIds}
            hiddenAdvertiserIds={hiddenAdvertiserIds}
            onToggleFavourite={handleToggleFavourite}
            onHideAd={handleHideAd}
            onHideAdvertiser={handleHideAdvertiser}
            onUnHideAd={handleUnHideAd}
            onSearch={(query, type) => {
              handleSearch(query, type);
              dispatch(setShowSavedAdsPage(false));
            }}
            onAnalyticsAd={(ad) => {
              if (!planAccess) return;
              const canAccessAnalytics = planAccess.filters?.ad_analytics?.enabled === true ||
                (planAccess.competitorLimits?.brandLimit ?? 0) > 0;
              if (!canAccessAnalytics) { dispatch(openModal('isPricingModalOpen')); return; }
              openAnalyticsModal(ad);
            }}
          />
        ) : (
          <AdGrid
            ads={visibleAds}
            sdui={sdui}
            activeTab={ui.activeTab}
            setActiveTab={(val) => dispatch(setActiveTab(val))}
            onAnalyzeAd={handleAnalyzeAd}
            onAnalyticsAd={(ad) => {
              if (guest?.isRestricted) {
                dispatch(openModal('isPricingModalOpen'));
                return;
              }
              if (!planAccess) return;
              const canAccessAnalytics = planAccess.filters?.ad_analytics?.enabled === true ||
                (planAccess.competitorLimits?.brandLimit ?? 0) > 0;
              if (!canAccessAnalytics) {
                dispatch(openModal('isPricingModalOpen'));
                return;
              }
              openAnalyticsModal(ad);
            }}
            onSearch={handleSearch}
            onExportAll={handleExportAll}
            setPage={setPage}
            hasMore={hasMore}
            loadingMore={loadingMore}
            adsMeta={adsMeta}
            favouriteAdIds={favouriteAdIds}
            onHideAd={handleHideAd}
            onHideAdvertiser={handleHideAdvertiser}
            onToggleFavourite={handleToggleFavourite}
            error={error}
            onRetry={() => {
              setError(null);
              setPage(0);
            }}
            allowedPlatforms={planAccess?.allowedPlatforms}
            onClearAll={() => {
              if (sdui.clearAll) sdui.clearAll();
              dispatch(setSearchQuery(""));
            }}
            onPlatformRestricted={() => dispatch(openModal('isPricingModalOpen'))}
            onToggleSidebar={() => dispatch(setSidebarOpen(!ui.isSidebarOpen))}
            theme={theme}
            guest={guest}
            isLanding={!!landingAd}
            isHeaderScrolled={isHeaderScrolled}
            onScrollChange={setIsHeaderScrolled}
            previewMode={ui.previewMode}
            setPreviewMode={(val) => dispatch(setPreviewMode(val))}
            specificPlatforms={ui.specificPlatforms}
            setSpecificPlatforms={(val) => dispatch(setSpecificPlatforms(val))}
            platformOptions={platformOptions}
            sortTabs={sortTabs}
            isAllActive={isAllActive}
            handleAllClick={handleAllClick}
            handlePlatformClick={handlePlatformClick}
            onDateChange={handleDateChange}
            isFilterRestricted={isFilterRestricted}
            onDateRestricted={() => dispatch(openModal('isPricingModalOpen'))}
            onSortRestricted={() => dispatch(openModal('isPricingModalOpen'))}
            onGuestLimit={() => dispatch(openModal('isPricingModalOpen'))}
            PRIMARY_SORT_LABELS={PRIMARY_SORT_LABELS}
            DROPDOWN_SORT_LABELS={DROPDOWN_SORT_LABELS}
            hiddenCount={hiddenCount}
            isSearchActive={!!(ui.searchQuery && ui.searchQuery.trim() && ui.searchQuery !== 'NA')}
          />
        )}
      </div>

      <AnalyticsModal
        ad={selectedAdForAnalytics}
        onClose={closeAnalyticsModal}
        onPrev={() => {
          const idx = visibleAds.findIndex(
            (a) => a.id === selectedAdForAnalytics?.id,
          );
          if (idx > 0) openAnalyticsModal(visibleAds[idx - 1]);
        }}
        onNext={() => {
          const idx = visibleAds.findIndex(
            (a) => a.id === selectedAdForAnalytics?.id,
          );
          if (idx < visibleAds.length - 1)
            openAnalyticsModal(visibleAds[idx + 1]);
        }}
        hasPrev={
          visibleAds.findIndex((a) => a.id === selectedAdForAnalytics?.id) > 0
        }
        hasNext={
          visibleAds.findIndex((a) => a.id === selectedAdForAnalytics?.id) <
          visibleAds.length - 1
        }
      />

      <AIAnalysisModal
        ad={selectedAdForAI}
        analysis={aiAnalysis}
        isAnalyzing={isAnalyzing}
        onClose={() => setSelectedAdForAI(null)}
      />

      <CampaignModal
        isOpen={ui.isCampaignModalOpen}
        strategy={campaignStrategy}
        isGenerating={isGeneratingStrategy}
        onClose={() => dispatch(closeModal('isCampaignModalOpen'))}
      />

      <PricingModal
        isOpen={ui.isPricingModalOpen}
        onClose={() => dispatch(closeModal('isPricingModalOpen'))}
        currentPlanTier={planAccess?.planTier ?? null}
      />

      {actionError && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-[400] px-4 py-2.5 bg-red-500/15 border border-red-500/30 rounded-xl backdrop-blur-md flex items-center gap-2 animate-in slide-in-from-bottom-2">
          <span className="text-xs font-medium text-red-400">
            {actionError}
          </span>
          <button
            onClick={() => setActionError(null)}
            className="text-red-400/60 hover:text-red-400 transition-colors"
          >
            <span className="text-sm">&times;</span>
          </button>
        </div>
      )}

      {/* Toast Notification */}
      {toast.show && (
        <div 
          className="fixed bottom-16 left-1/2 -translate-x-1/2 z-[400] px-4 py-2.5 rounded-xl backdrop-blur-md border flex items-center gap-3 animate-in slide-in-from-bottom-4 duration-300"
          style={{ 
            backgroundColor: toast.type === 'success' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            borderColor: toast.type === 'success' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)',
            color: toast.type === 'success' ? '#4ade80' : '#f87171'
          }}
        >
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white ${toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}>
            {toast.type === 'success' ? <Check size={14} strokeWidth={3} /> : <X size={14} strokeWidth={3} />}
          </div>
          <span className="font-semibold tracking-tight text-xs">{toast.message}</span>
        </div>
      )}

      {/* Guest Login Popup */}
      {guest?.showLoginPopup && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={guest.closeLoginPopup}>
          <div
            className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-[90vw] max-w-md mx-4 p-8 flex flex-col items-center gap-6 animate-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={guest.closeLoginPopup}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>

            {/* Lock icon */}
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20">
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </div>

            {/* Text */}
            <div className="text-center">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Unlock Full Access</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                To access ad details, filters, engagement data, and all advanced features — log in or sign up.
              </p>
            </div>

            {/* Feature bullets */}
            <ul className="w-full space-y-2 text-sm text-gray-600 dark:text-gray-400">
              {['View full ad details & creatives', 'Apply filters across all platforms', 'Track engagement & performance data', 'Save favourites and manage projects', 'Monitor competitors & track rival ad strategies with Projects'].map(f => (
                <li key={f} className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  {f}
                </li>
              ))}
            </ul>

            {/* Buttons */}
            <div className="w-full flex flex-col gap-3">
              <a
                href={guest.loginUrl}
                className="w-full text-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm"
              >
                Login to PowerAdSpy
              </a>
              <a
                href={guest.signupUrl}
                className="w-full text-center text-blue-600 hover:text-blue-700 font-semibold py-2.5 rounded-xl transition-colors text-sm"
              >
                New to PowerAdSpy? <span className="underline">Sign Up</span>
              </a>
            </div>
          </div>
        </div>
      )}

      <ChatbotWidget />

      {/* Push Notification Permission Prompt */}
      <NotificationPermissionPrompt />
    </div>
  );
};

export default AppWrapper;
