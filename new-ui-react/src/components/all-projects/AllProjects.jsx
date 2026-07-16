import React, { useState, useEffect, useRef, useMemo } from "react";
import ReactDOM from "react-dom";
import {
  Globe,
  Plus,
  LayoutGrid,
  List,
  Search,
  Filter,
  MoreVertical,
  Trash2,
  ChevronRight,
  X,
  Sparkles,
  Check,
  ChevronDown,
  Monitor,
  ExternalLink,
  Zap,
  ChevronLeft,
  TrendingUp,
  Users,
  Target,
  Activity,
  DollarSign,
  BarChart3,
  Loader2,
  PlayCircle,
  Eye,
  EyeOff,
  CircleDollarSign,
  Download,
  Edit,
  Edit2,
  AlertTriangle,
  Megaphone,
  Copy,
  Info,
} from "lucide-react";
import { io } from "socket.io-client";
import fbIcon from "../../assets/fb.png";
import igIcon from "../../assets/ig.png";
import gIcon from "../../assets/g.png";
const PLATFORM_ICONS = { Facebook: fbIcon, Instagram: igIcon, Google: gIcon };
import { useAuth } from "../../hooks/useAuth";
import { CompetitorAPI, CompetitorFetchTimeoutError, trackProjectEvent } from "../../services/api";
import CompetitorComparison from "./CompetitorComparison";
import MembersManager from "./MembersManager";
import { COUNTRIES } from "../../utils/countries";

// Target Countries picker (Configure Analysis) is gated by a build-time env
// flag, same pattern as VITE_ENABLE_KEYWORD_EXPLORER/VITE_ENABLE_INTELLIGENCE_FEATURE
// in App.jsx. When off, the accordion is hidden entirely — the backend already
// handles an empty/absent country selection gracefully (no country stored,
// no "Brands from ..." keyword appended), so no backend flag is needed.
const COUNTRY_TARGETING_ON =
  import.meta.env.VITE_ENABLE_COUNTRY_TARGETING === "true";

// A 401 from any Competitor API call throws Error('Unauthorized: Token expired')
// (see competitorFetch in services/api.js), which also fires handle401() to clear
// auth + redirect to the logout/login page. This helper lets callers recognise
// that case so they show a "session expired" notice instead of a misleading
// domain-specific error (e.g. "Failed to fetch keywords") while the redirect runs.
const isSessionExpiredError = (error) => {
  const msg = (error && error.message) || "";
  return /unauthorized|token expired/i.test(msg);
};

const getCountryInfo = (code) => {
  if (!code) return { f: "un", n: "Unknown" };
  const target = code.toString().toLowerCase().trim();

  const _map = {
    us: { f: "us", n: "United States" },
    uk: { f: "gb", n: "United Kingdom" },
    gb: { f: "gb", n: "United Kingdom" },
    ca: { f: "ca", n: "Canada" },
    au: { f: "au", n: "Australia" },
    de: { f: "de", n: "Germany" },
    fr: { f: "fr", n: "France" },
    in: { f: "in", n: "India" },
    br: { f: "br", n: "Brazil" },
    // Full name mappings for ES responses
    "united states": { f: "us", n: "United States" },
    "united kingdom": { f: "gb", n: "United Kingdom" },
    canada: { f: "ca", n: "Canada" },
    australia: { f: "au", n: "Australia" },
    germany: { f: "de", n: "Germany" },
    france: { f: "fr", n: "France" },
    india: { f: "in", n: "India" },
    brazil: { f: "br", n: "Brazil" },
    italy: { f: "it", n: "Italy" },
    spain: { f: "es", n: "Spain" },
    netherlands: { f: "nl", n: "Netherlands" },
    sweden: { f: "se", n: "Sweden" },
    poland: { f: "pl", n: "Poland" },
    mexico: { f: "mx", n: "Mexico" },
    "south africa": { f: "za", n: "South Africa" },
    japan: { f: "jp", n: "Japan" },
    "south korea": { f: "kr", n: "South Korea" },
    china: { f: "cn", n: "China" },
    russia: { f: "ru", n: "Russia" },
    indonesia: { f: "id", n: "Indonesia" },
    argentina: { f: "ar", n: "Argentina" },
    colombia: { f: "co", n: "Colombia" },
    vietnam: { f: "vn", n: "Vietnam" },
    thailand: { f: "th", n: "Thailand" },
    philippines: { f: "ph", n: "Philippines" },
    turkey: { f: "tr", n: "Turkey" },
    egypt: { f: "eg", n: "Egypt" },
  };

  if (_map[target]) {
    return _map[target];
  }

  if (target.length === 2) {
    return { f: target, n: target.toUpperCase() };
  }

  // Default to un (United Nations flag or a generic blank) if mapping fails for full string
  return { f: "un", n: code };
};

const getInitials = (name) => {
  if (!name) return "?";
  return name.charAt(0).toUpperCase();
};

// Capitalizes only the first character — unlike CSS `capitalize`, this
// won't title-case every dot-separated segment of a domain (e.g. "cobra.sa"
// stays "Cobra.sa" instead of becoming "Cobra.Sa").
const capitalizeFirst = (str) => {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
};

const formatNumber = (num) => {
  if (!num) return "0";
  if (num >= 1000000)
    return (num / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return Math.round(num).toString();
};

const getAvatarColor = (name) => {
  const colors = [
    "bg-blue-500/20 text-blue-400 border-blue-500/30",
    "bg-[#3762c1]/20 text-[#6b99ff] border-[#3759a3]/30",
    "bg-purple-500/20 text-purple-400 border-purple-500/30",
    "bg-pink-500/20 text-pink-400 border-pink-500/30",
    "bg-rose-500/20 text-rose-400 border-rose-500/30",
    "bg-orange-500/20 text-orange-400 border-orange-500/30",
    "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    "bg-teal-500/20 text-teal-400 border-teal-500/30",
    "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

// ── Loading shimmer helpers (Competitor Analytics table) ────────────────────
// Reuses the theme-aware `media-shimmer` sweep from index.css. A cell shows a
// shimmer block ONLY while its data is genuinely in-flight; the moment the API
// answers (even with 0) the real value is rendered.
const CellShimmer = ({ className = "h-3.5 w-16" }) => (
  <span
    className={`media-shimmer inline-block rounded-md align-middle ${className}`}
    aria-hidden="true"
  />
);

// Full-row skeleton used while the competitor list itself is loading — mirrors
// the real table's 10 columns so nothing jumps when data arrives.
const CompetitorRowSkeleton = () => (
  <tr className="border-b border-theme-border">
    <td className="px-6 py-4">
      <div className="flex items-center gap-3">
        <CellShimmer className="w-8 h-8 rounded" />
        <CellShimmer className="h-3.5 w-32" />
      </div>
    </td>
    <td className="px-4 py-4 text-center">
      <CellShimmer className="w-7 h-7 rounded-lg" />
    </td>
    <td className="px-5 py-4"><CellShimmer className="h-3.5 w-14" /></td>
    <td className="px-5 py-4"><CellShimmer className="h-6 w-24" /></td>
    <td className="px-5 py-4"><CellShimmer className="h-3.5 w-12" /></td>
    <td className="px-3 py-4"><CellShimmer className="h-3.5 w-20" /></td>
    <td className="px-5 py-4">
      <div className="flex gap-1.5">
        <CellShimmer className="w-5 h-5 rounded-full" />
        <CellShimmer className="w-5 h-5 rounded-full" />
        <CellShimmer className="w-5 h-5 rounded-full" />
      </div>
    </td>
    <td className="px-5 py-4"><CellShimmer className="h-5 w-16" /></td>
    <td className="px-5 py-4"><CellShimmer className="h-3.5 w-20" /></td>
    <td className="px-5 py-4 text-center"><CellShimmer className="h-7 w-28 rounded-lg" /></td>
  </tr>
);

const generateDummyCompetitors = (count, startId, monitoredCount) => {
  return Array.from({ length: count }).map((_, i) => {
    const isMonitored = i < monitoredCount;
    return {
      id: startId + i,
      name: `E-com Brand ${i + 1}`,
      totalAds: Math.floor(Math.random() * 5000) + 100,
      todayAds: Math.floor(Math.random() * 50),
      yesterdayAds: Math.floor(Math.random() * 80),
      lastWeekAds: Math.floor(Math.random() * 300) + 10,
      lastMonthAds: Math.floor(Math.random() * 1200) + 50,
      impressions: `${(Math.random() * 10 + 1).toFixed(1)}M`,
      popularity: isMonitored
        ? `High (${Math.floor(Math.random() * 20 + 80)}%)`
        : `Medium (${Math.floor(Math.random() * 30 + 40)}%)`,
      countries: ["US", "CA", "UK", "AU"]
        .sort(() => 0.5 - Math.random())
        .slice(0, 2),
      platforms: ["Facebook", "Instagram"],
      budget: `$${Math.floor(Math.random() * 900) + 100}K`,
      isMonitored,
    };
  });
};

const calculateTotalBudget = (competitors) => {
  if (!competitors || competitors.length === 0) return "$0";
  let total = 0;
  competitors.forEach((c) => {
    if (!c.budget) return;
    let val = parseFloat(c.budget.replace(/[^0-9.]/g, ""));
    if (isNaN(val)) return;
    if (c.budget.includes("M")) total += val * 1000000;
    else if (c.budget.includes("K")) total += val * 1000;
    else total += val;
  });
  if (total >= 1000000) return "$" + (total / 1000000).toFixed(1) + "M";
  if (total >= 1000) return "$" + (total / 1000).toFixed(1) + "K";
  return "$" + total.toFixed(2);
};

const INITIAL_PROJECTS = [];

// COUNTRIES (full ISO 3166-1 list) now lives in src/utils/countries.js — the
// single source of truth shared with the analytics country map. Imported above.

const KEYWORDS_SUGGESTIONS = [
  "ecommerce",
  "online shopping",
  "retail",
  "deals",
  "prime",
  "electronics",
  "fashion",
  "books",
  "spy tool",
  "ad research",
];

// One-shot signal used to keep the user on a project's Competitor Analytics view
// when they return (e.g. via the browser Back button) after drilling into the
// Dashboard from that view (Recent Activity / Platform / Top Country). Without
// it, AllProjects remounts and resets to the projects list, forcing the user to
// re-select the project.
const RESTORE_ANALYTICS_FLAG = "pas_restore_analytics_view";

// Marked at the moment of a drill-down (only reachable from viewState 4).
const markReturnToAnalytics = () => {
  try {
    sessionStorage.setItem(RESTORE_ANALYTICS_FLAG, "1");
  } catch {
    /* sessionStorage unavailable — fall back to default (projects list) */
  }
};

// True when we should restore the analytics view on mount: the flag is set and a
// valid project + analytics view were persisted.
const shouldRestoreAnalytics = () => {
  try {
    return (
      !!sessionStorage.getItem(RESTORE_ANALYTICS_FLAG) &&
      localStorage.getItem("pas_dashboard_view") === "4" &&
      !!localStorage.getItem("pas_dashboard_selected_proj_id")
    );
  } catch {
    return false;
  }
};

const AllProjects = ({ onSearch, onNavigateToAds, onRecentActivityClick, onCountryClick, setProjectContext }) => {
  const { user: authUser, token: authToken } = useAuth();
  const [competitorUserId, setCompetitorUserId] = useState(null);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isProjectLoading, setIsProjectLoading] = useState(false);
  // True from the moment "Generate Competitors" is clicked until the initial
  // rows have been fetched + ES-enriched. Decoupled from `isGenerating` because
  // the socket "completed" event can flip isGenerating off while the (slow, in
  // production) HTTP enrichment is still in flight — which would otherwise show
  // a false "No competitors available" message during that gap.
  const [isPreparingCompetitors, setIsPreparingCompetitors] = useState(false);
  const [progressStatus, setProgressStatus] = useState("");
  const socketRef = useRef(null);
  // content_ref_ids we've already joined a socket room for — lets a page
  // refresh rejoin the room(s) of any project still generating server-side
  // (per its persisted generation_status), not just the one active during
  // the original submit. Also read by the socket's own "connect" handler so
  // a reconnect (e.g. after a network drop) rejoins every tracked room, not
  // just the single most-recent one.
  const joinedRoomsRef = useRef(new Set());

  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(() =>
    shouldRestoreAnalytics()
      ? localStorage.getItem("pas_dashboard_selected_proj_id") || null
      : null,
  );
  const [contentRefId, setContentRefId] = useState(null);
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [openGeoId, setOpenGeoId] = useState(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  // viewState 4 = a project's Competitor Analytics view. Restore it when the user
  // returns from a Dashboard drill-down; otherwise start on the projects list (0).
  const [viewState, setViewState] = useState(() =>
    shouldRestoreAnalytics() ? 4 : 0,
  );
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editSearch, setEditSearch] = useState("");
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [toast, setToast] = useState({
    show: false,
    message: "",
    type: "success",
  });

  const showToast = (message, type = "success", durationMs = 3000) => {
    setToast({ show: true, message, type });
    setTimeout(
      () => setToast({ show: false, message: "", type: "success" }),
      durationMs,
    );
  };

  const [websiteLink, setWebsiteLink] = useState("");
  const [showAdvertiserSuggestions, setShowAdvertiserSuggestions] =
    useState(false);
  const advertiserInputWrapperRef = useRef(null);
  const advertiserInputRef = useRef(null);
  const [selectedKeywords, setSelectedKeywords] = useState([]);
  const [keywordSuggestions, setKeywordSuggestions] =
    useState(KEYWORDS_SUGGESTIONS);
  const [isGeneratingKeywords, setIsGeneratingKeywords] = useState(false);
  const [fetchedContentRefId, setFetchedContentRefId] = useState("");
  const [maxCompetitors, setMaxCompetitors] = useState("15");
  const [customKeyword, setCustomKeyword] = useState("");
  const [selectedCountries, setSelectedCountries] = useState([]);
  const [countrySearch, setCountrySearch] = useState("");
  const [isCountryAccordionOpen, setIsCountryAccordionOpen] = useState(false);
  const [compareCompetitor, setCompareCompetitor] = useState(null);
  const [competitorToDelete, setCompetitorToDelete] = useState(null);
  const [isDeletingCompetitor, setIsDeletingCompetitor] = useState(false);

  const [showAddCompetitorModal, setShowAddCompetitorModal] = useState(false);
  const [manualCompName, setManualCompName] = useState("");
  const [manualCompUrl, setManualCompUrl] = useState("");
  const [isAddingCompetitor, setIsAddingCompetitor] = useState(false);

  // Rename brand modal (PATCH /update-advertiser)
  const [showRenameBrandModal, setShowRenameBrandModal] = useState(false);
  const [renameBrandValue, setRenameBrandValue] = useState("");
  const [isRenamingBrand, setIsRenamingBrand] = useState(false);

  // Auto-initialize connection to Node DB
  useEffect(() => {
    const isLocal = import.meta.env.VITE_PAS_CHECK_BASE_URL === "Local";

    const user = isLocal
      ? {
          ok: true,
          user_id: 281,
          name: "Tadeu Porto",
          name_f: "Tadeu",
          name_l: "Porto",
          email: "aishwarya@globussoft.in",
          login: "tadeuonbrand",
          subscriptions: [null, null, null, null, "2017-12-27"],
          categories: [null, "2017-12-27"],
          userSubscriptionType: 36,
          user_country: "India",
          Facebook: 0,
          Instagram: 0,
          Google: 0,
          YouTube: 0,
          GDN: 0,
          Reddit: 0,
          Native: 0,
          Quora: 0,
          Tiktok: 0,
        }
      : authUser;

    if (!user) {
      setIsLoadingProjects(false);
      return;
    }

    let active = true;
    const initDashboard = async () => {
      setIsLoadingProjects(true);
      try {
        const mongoId = await CompetitorAPI.initializeCompetitorSession(user);
        if (active) setCompetitorUserId(mongoId);

        if (mongoId && active) {
          const res = await CompetitorAPI.getDashboardProjects(mongoId);

          const richProjects = res?.body?.data?.projects || [];
          const fetchedProjectsStrings = res?.body?.data?.project_name || [];

          let mappedProjects = [];

          // Backend now optionally sends raw project objects containing monitoring and competitor ObjectIds
          if (richProjects.length > 0) {
            mappedProjects = richProjects.map((proj, idx) => {
              // Persisted generation state (see competitors_request schema) —
              // lets a page refresh mid-generation resume correctly instead of
              // showing a flat "no competitors" for a project that's actually
              // still being populated in the background.
              const isStillGenerating = proj.generation_status === "running";
              return {
                id: `real_proj_${idx}`,
                project_id: proj._id ? String(proj._id) : null, // competitors_request._id → brand-cc
                advertiser: proj.project_name,
                // While still generating, show the originally requested count
                // so an in-progress project reads as "42/100", not "42/42"
                // (which reads as already done). But once generation has
                // actually finished, target_count can overstate reality — DS's
                // hard cap on /list's `limit` (see competitorOverfetchLimit's
                // DS_MAX_LIST_LIMIT clamp) leaves no overfetch headroom for a
                // 100-competitor request, so a single duplicate name in that
                // batch lands on 99 unique, not 100. Showing "0/100" then would
                // wrongly imply one more competitor is still coming in.
                initialCompetitorCount: isStillGenerating
                  ? (proj.target_count || proj.competitors?.length || 0)
                  : (proj.competitors?.length || 0),
                initialMonitoredCount: proj.monitoring?.length || 0,
                competitors: [], // full list populated when clicked
                contentRefId: proj.content_ref_id || null,
                isGenerating: isStillGenerating,
              };
            });
          } else {
            mappedProjects = fetchedProjectsStrings.map((projName, idx) => ({
              id: `real_proj_${idx}`,
              advertiser: projName,
              initialCompetitorCount: 0,
              initialMonitoredCount: 0,
              competitors: [],
            }));
          }
          setProjects((prev) => {
            return mappedProjects.map((newProj) => {
              const existing = prev.find(
                (p) => p.advertiser === newProj.advertiser,
              );
              if (
                existing &&
                existing.competitors &&
                existing.competitors.length > 0
              ) {
                return { ...newProj, competitors: existing.competitors };
              }
              return newProj;
            });
          });

          trackProjectEvent('Dashboard', {
            dashboard_Advertisers: mappedProjects.map((p) => p.advertiser),
          });

          if (mappedProjects.length === 0 && active) {
            setViewState(1);
          }
        } else if (active) {
          trackProjectEvent('Dashboard', { dashboard_Advertisers: 'NA' });
          setViewState(1);
        }
      } catch (err) {
        console.error("Failed to load dashboard projects", err);
        if (active) setViewState(1);
      } finally {
        if (active) setIsLoadingProjects(false);
      }
    };

    initDashboard();
    return () => {
      active = false;
    };
  }, [authUser]);

  // One-shot view initialization (runs once; ref-guarded so React StrictMode's
  // double-invoke in dev doesn't clobber a restored analytics view).
  const didInitViewRef = useRef(false);
  useEffect(() => {
    if (didInitViewRef.current) return;
    didInitViewRef.current = true;
    if (shouldRestoreAnalytics()) {
      // Returning from a Dashboard drill-down: keep the analytics view that the
      // lazy initializers above restored, and consume the one-shot flag.
      try {
        sessionStorage.removeItem(RESTORE_ANALYTICS_FLAG);
      } catch {
        /* ignore */
      }
    } else {
      // Fresh visit: start on the projects list.
      setViewState(0);
      setSelectedProjectId(null);
    }
  }, []);

  // Close dropdowns on outside click / scroll.
  useEffect(() => {
    const handleClickOutside = (e) => {
      const isTrigger = e.target.closest(".dropdown-trigger");
      const isDropdown = e.target.closest(".dropdown-portal");

      if (!isTrigger && !isDropdown) {
        setOpenDropdownId(null);
        setOpenGeoId(null);
      }
    };

    const handleScroll = (e) => {
      // Keep dropdown open if scrolling INSIDE the dropdown itself
      if (e.target.closest && e.target.closest('.dropdown-portal')) return;
      setOpenDropdownId(null);
      setOpenGeoId(null);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, []);

  // Persist UI state to localStorage
  useEffect(() => {
    if (viewState !== null)
      localStorage.setItem("pas_dashboard_view", viewState);
  }, [viewState]);

  useEffect(() => {
    if (selectedProjectId !== null) {
      localStorage.setItem("pas_dashboard_selected_proj_id", selectedProjectId);
    } else {
      localStorage.removeItem("pas_dashboard_selected_proj_id");
    }
  }, [selectedProjectId]);

  // Auto-fetch competitors if we restored a selected project but it has no data.
  // `projects` is in the deps so this re-runs once the list finishes loading
  // asynchronously after a restore (browser Back) — otherwise the analytics view
  // would render with an empty competitor table. The ref guards against fetching
  // the same project more than once, which would otherwise loop forever for a
  // project that genuinely has zero competitors.
  // Skip if the project is currently generating (data arrives via socket, not API).
  const autoFetchedProjectRef = useRef(null);
  useEffect(() => {
    if (viewState === 4 && selectedProjectId && projects.length > 0) {
      const project = projects.find((p) => p.id === selectedProjectId);
      if (
        project &&
        (!project.competitors || project.competitors.length === 0) &&
        !isProjectLoading &&
        !project.isGenerating &&
        competitorUserId &&
        autoFetchedProjectRef.current !== selectedProjectId
      ) {
        autoFetchedProjectRef.current = selectedProjectId;
        openProject(selectedProjectId, project.advertiser);
      }
    }
  }, [viewState, selectedProjectId, projects, isProjectLoading, competitorUserId]);

  // Safety net for a stale restore: if the persisted project id no longer exists
  // once the list has loaded, fall back to the projects list instead of showing
  // an empty analytics view.
  useEffect(() => {
    if (
      viewState === 4 &&
      !isLoadingProjects &&
      selectedProjectId &&
      projects.length > 0 &&
      !projects.some((p) => p.id === selectedProjectId)
    ) {
      setViewState(0);
      setSelectedProjectId(null);
    }
  }, [viewState, isLoadingProjects, selectedProjectId, projects]);

  // --- SOCKET IO INTEGRATION ---
  // Refs to hold mutable values so socket handlers always see current state
  const selectedProjectIdRef = useRef(selectedProjectId);
  const websiteLinkRef = useRef(websiteLink);
  const contentRefIdRef = useRef(contentRefId);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);
  useEffect(() => {
    websiteLinkRef.current = websiteLink;
  }, [websiteLink]);
  useEffect(() => {
    contentRefIdRef.current = contentRefId;
  }, [contentRefId]);

  // Socket connects ONCE — same as Laravel: connect with token, join-room with content_ref_id
  useEffect(() => {
    // Competitor backend validates JWT with its own JWT_SECRET_KEY (different from PAS API)
    const socketToken =
      authToken || import.meta.env.VITE_COMPETITOR_SOCKET_TOKEN || "";
    if (!socketToken) return;

    const socketUrl = import.meta.env.VITE_COMP_SOCKET_URL;

    const socket = io(socketUrl, {
      auth: { token: socketToken },
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      // Rejoin room on reconnect (e.g. after network drop)
      if (contentRefIdRef.current) {
        socket.emit("join-room", contentRefIdRef.current);
      }
      // Rejoin every project's room we know is still generating — covers the
      // page-refresh case, where this is a fresh socket connecting for the
      // first time and contentRefIdRef alone wouldn't cover projects other
      // than the one most recently submitted.
      for (const refId of joinedRoomsRef.current) {
        socket.emit("join-room", refId);
      }
    });

    // Event for ACTUAL data — appended batch by batch (matches Laravel)
    socket.on("competitor-batch", ({ content_ref_id, rows }) => {
      if (!rows || !Array.isArray(rows)) return;

      try {
        // BE already enriches rows with ES stats before emitting.
        // Use the pre-enriched fields directly — no extra API call needed here.
        const enrichedRows = rows.map((row, idx) => {
          const cName = row.name || row.competitor_name || row.advertiser;

          return {
            id: row.id || `real-${idx}-${Date.now()}`,
            name: cName,
            totalAds: row.total_ads || 0,
            todayAds: row.today_ads || 0,
            yesterdayAds: row.yesterday_ads || 0,
            lastWeekAds: row.last_week_ads || 0,
            lastMonthAds: row.last_month_ads || 0,
            impressions: row.impressions
              ? (typeof row.impressions === "number"
                  ? formatNumber(row.impressions)
                  : row.impressions)
              : "0",
            popularity: row.popularity || "Low (0%)",
            countries: row.countries
              ? Array.isArray(row.countries)
                ? row.countries
                : row.countries.split(",")
              : [],
            platforms: row.platforms
              ? Array.isArray(row.platforms)
                ? row.platforms
                : row.platforms.split(",")
              : [],
            budget: row.budget || "$0",
            isMonitored:
              row.is_monitored === 1 ||
              row.is_monitored === true ||
              row.monitored === true,
            specificToMatch: row.specific_to_match || null,
          };
        });

        // REPLACE competitors — matches Laravel's `aiAllRows = rows`
        // Backend sends the FULL list each time (getCompetitorTableRows queries all from DB)
        setProjects((prevProjects) => {
          return prevProjects.map((p) => {
            const pName = p.advertiser?.toLowerCase();
            const normalizedWebsite = (websiteLinkRef.current || "")
              .replace(/^https?:\/\//i, "")
              .replace(/^www\./i, "")
              .split("/")[0]
              .toLowerCase();

            if (
              (content_ref_id && p.contentRefId === content_ref_id) ||
              p.id === selectedProjectIdRef.current ||
              (normalizedWebsite && pName === normalizedWebsite)
            ) {
              return {
                ...p,
                competitors: enrichedRows,
              };
            }
            return p;
          });
        });
      } catch (err) {
        console.error("Error enriching socket data:", err);
      }
    });

    // Progress events
    socket.on("competitor-progress", (data) => {
      const matchesProject = (p) =>
        (data?.content_ref_id && p.contentRefId === data.content_ref_id) ||
        (!data?.content_ref_id && p.id === selectedProjectIdRef.current);

      if (data?.status === "completed") {
        setProgressStatus("");
        // Fewer competitors than requested is a legitimate outcome (DS's real
        // candidate pool for a niche brand can be smaller than the target),
        // not a failure — but it's surprising if unexplained, so call it out
        // instead of leaving the user to wonder why they got 62 of 100.
        const generated = data?.generated ?? 0;
        const target = data?.target ?? 0;
        setProjects((prev) =>
          prev.map((p) =>
            matchesProject(p)
              ? {
                  ...p,
                  isGenerating: false,
                  // Card showed the requested target while generating (e.g.
                  // "0/100") — now that generation is actually done, replace
                  // it with the real final count so it doesn't keep implying
                  // one more competitor is still coming when it isn't (e.g.
                  // DS's /list limit cap means a 100-competitor request tops
                  // out at 99 if that batch has one duplicate name).
                  initialCompetitorCount: generated,
                }
              : p,
          ),
        );
        if (target > 0 && generated < target) {
          // toast only has two visual styles (green "success" / red anything-else)
          // — this isn't an error, so "success" is the correct (green) choice
          // even though the copy explains a shortfall rather than full success.
          // Longer than the 3s default — this message is long enough that 3s
          // isn't enough time to read it (flagged directly: "toast should
          // stay at least 1-2 second longer").
          showToast(
            `Generated ${generated} of ${target} requested competitors — that may be all the unique competitors available for this brand.`,
            "success",
            6000,
          );
        }
      } else if (data?.generated) {
        setProgressStatus(
          `Generated ${data.generated} of ${data.target || "target"} competitors...`,
        );
      }
    });

    // Token limit exceeded (matches Laravel)
    socket.on("token-limit-exceeded", (data) => {
      setProgressStatus("");
      setProjects((prev) =>
        prev.map((p) =>
          (data?.content_ref_id && p.contentRefId === data.content_ref_id) ||
          (!data?.content_ref_id && p.id === selectedProjectIdRef.current)
            ? { ...p, isGenerating: false, initialCompetitorCount: data?.generated ?? p.initialCompetitorCount }
            : p,
        ),
      );
      showToast(
        `Daily token limit reached. ${data?.generated || 0} competitor(s) generated out of ${data?.target || "target"}.`,
        "error",
        6000,
      );
    });

    socket.on("connect_error", (error) => {
      console.error("Socket Connection Error:", error.message);
    });

    socketRef.current = socket;

    return () => {
      if (socket) socket.disconnect();
    };
  }, [authToken]); // Only reconnect when auth token changes
  // --- END SOCKET ---

  // Rejoin socket rooms for any project the backend says is still generating
  // (persisted generation_status — see initDashboard's mapping). Runs whenever
  // the project list changes, which covers both the initial dashboard load
  // after a page refresh and any project transitioning into "generating".
  useEffect(() => {
    for (const p of projects) {
      if (!p.isGenerating || !p.contentRefId) continue;
      if (joinedRoomsRef.current.has(p.contentRefId)) continue;
      joinedRoomsRef.current.add(p.contentRefId);
      if (socketRef.current?.connected) {
        socketRef.current.emit("join-room", p.contentRefId);
      }
      // If not connected yet, the socket's own "connect" handler above will
      // pick this up from joinedRoomsRef once it does connect.
    }
  }, [projects]);

  const addCustomKeyword = (e) => {
    if (e) e.preventDefault();
    if (!customKeyword.trim()) return;
    const kw = customKeyword.trim();
    const alreadySelected = selectedKeywords.some(
      (existing) => existing.toLowerCase() === kw.toLowerCase(),
    );
    if (alreadySelected) {
      showToast(`"${kw}" is already selected.`, "error");
      return;
    }
    if (
      !keywordSuggestions.some(
        (existing) => existing.toLowerCase() === kw.toLowerCase(),
      )
    ) {
      setKeywordSuggestions([kw, ...keywordSuggestions]);
    }
    setSelectedKeywords([...selectedKeywords, kw]);
    setCustomKeyword("");
  };

  const activeProject = projects.find((p) => p.id === selectedProjectId);
  const hasProjects = projects.length > 0;

  // Suggestions from already-added advertisers, filtered by substring match
  // against whatever the user has typed so far (e.g. "M" -> "MY" -> ...).
  const advertiserSuggestions = useMemo(() => {
    const query = websiteLink.trim().toLowerCase();
    if (!query) return [];
    const seen = new Set();
    return projects
      .filter((p) => p.advertiser && p.advertiser.toLowerCase().includes(query))
      .filter((p) => {
        const key = p.advertiser.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [websiteLink, projects]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        advertiserInputWrapperRef.current &&
        !advertiserInputWrapperRef.current.contains(e.target)
      ) {
        setShowAdvertiserSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Auto-focus the advertiser input whenever the "Add New Advertiser" screen opens.
  useEffect(() => {
    if (viewState === 1) {
      advertiserInputRef.current?.focus();
    }
  }, [viewState]);

  const toggleKeyword = (kw) => {
    setSelectedKeywords((prev) =>
      prev.includes(kw) ? prev.filter((k) => k !== kw) : [...prev, kw],
    );
  };

  const toggleCountry = (code) => {
    setSelectedCountries((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  const filteredCountries = useMemo(() => {
    const query = countrySearch.trim().toLowerCase();
    if (!query) return COUNTRIES;
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(query));
  }, [countrySearch]);

  const handleNextPhase = async () => {
    if (!websiteLink) return;
    setIsGeneratingKeywords(true);
    // Temporarily go to state 3 (loading) to let user know something is happening
    setViewState(3);
    try {
      // First check if brand already exists (matching legacy blade behavior)
      // Force lowercase to match case-sensitive backend storage.
      // Keep the full domain (including TLD) — "cobra" and "cobra.sa" are
      // different brands, only exact-domain matches (e.g. with/without
      // "https://" or "www.") should be treated as duplicates.
      const brandFromUrl = websiteLink
        .replace(/^https?:\/\//i, "")
        .replace(/^www\./i, "")
        .split("/")[0]
        .toLowerCase();
      const checkResp = await CompetitorAPI.checkBrand(
        brandFromUrl,
        competitorUserId,
      );

      if (checkResp?.statusCode === 200 || checkResp?.statusCode === "200") {
        showToast("This brand already exists.", "error");
        setViewState(1); // Go back to the input form
        return;
      }

      const adv = "";
      const response = await CompetitorAPI.fetchKeywordsBasedOnWebsite(
        websiteLink,
        adv,
      );
      let extractedKws = [];
      if (response?.data?.keywords && Array.isArray(response.data.keywords)) {
        extractedKws = response.data.keywords;
      } else if (response?.data && Array.isArray(response.data)) {
        extractedKws = response.data;
      } else if (response?.keywords && Array.isArray(response.keywords)) {
        extractedKws = response.keywords;
      }

      // CAPTURE THE UUID SESSION ID FROM PYTHON
      if (response?.data?.content_ref_id) {
        setFetchedContentRefId(response.data.content_ref_id);
      } else if (response?.content_ref_id) {
        setFetchedContentRefId(response.content_ref_id);
      }

      if (extractedKws.length > 0) {
        setKeywordSuggestions(extractedKws);
        setViewState(2); // Move to keyword selection only when keywords are available
      } else {
        showToast(
          "Failed to fetch keywords. Please try again.",
          "error",
        );
        setViewState(1); // Go back to input so user can retry with domain pre-filled
      }
    } catch (error) {
      if (isSessionExpiredError(error)) {
        // Session expired — handle401() is already redirecting to login.
        // Show the correct reason instead of a misleading "fetch keywords" error.
        showToast("Your session has expired. Please log in again.", "error");
        return;
      }
      console.error("Failed to fetch keywords:", error);
      showToast(
        "Failed to fetch keywords. Please try again.",
        "error",
      );
      setViewState(1); // Go back to input so user can retry with domain pre-filled
    } finally {
      setIsGeneratingKeywords(false);
    }
  };

  const handleSubmitData = async () => {
    if (!websiteLink || selectedKeywords.length === 0) return;
    setViewState(3); // Loading screen
    setIsPreparingCompetitors(true); // keep the buffer up through fetch + ES enrich

    // 1. Normalize specifically for matching existing projects/labels in our local state
    // Keep the full domain (including TLD) — only strip protocol/www and any path/query.
    const normalizedAdvertiser = websiteLink
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0];

    // Resolve selected ISO codes to full names so the AI-generation prompt
    // reads naturally (e.g. "United States" rather than "us").
    const selectedCountryNames = selectedCountries
      .map((code) => COUNTRIES.find((c) => c.code === code)?.name)
      .filter(Boolean);

    try {
      const newRefId = fetchedContentRefId || Date.now().toString();
      setContentRefId(newRefId);
      const userId = competitorUserId || authUser?.user_id;

      // 🚀 JOIN THE ROOM (Matches Laravel/Node standard: just the string ID)
      if (socketRef.current?.connected) {
        socketRef.current.emit("join-room", newRefId);
      } else {
        console.warn(
          "Socket NOT connected! Cannot join room:",
          newRefId,
          "socket state:",
          socketRef.current?.connected,
        );
      }

      // ⚠️ PASS ORIGINAL websiteLink (full domain) to backend
      // Backend will handle stripping for MongoDB, but use FULL for Python
      const res = await CompetitorAPI.checkCompetitorProcess(
        newRefId,
        selectedKeywords,
        parseInt(maxCompetitors, 10),
        websiteLink, // Send original domain
        userId,
        selectedCountryNames,
      );

      // Build project stub first
      const projectId = res?.data?._id || `proj_${Date.now()}`;
      const newProject = {
        id: projectId,
        advertiser: normalizedAdvertiser,
        initialCompetitorCount: parseInt(maxCompetitors, 10),
        initialMonitoredCount: 0,
        competitors: [],
        brand_url: websiteLink,
        contentRefId: newRefId,
        isGenerating: true,
        summary: {
          active_monitors: 0,
          total_ads_tracked: 0,
          avg_budget: 0,
          competitors_count: 0,
        },
      };

      setProjects([newProject, ...projects]);
      setSelectedProjectId(projectId);
      setWebsiteLink("");
      setSelectedKeywords([]);
      setSelectedCountries([]);
      setCountrySearch("");
      setIsCountryAccordionOpen(false);
      setViewState(4);
      trackProjectEvent('Project-click', { project_name: normalizedAdvertiser });

      // 🚀 TRIGGER STORAGE & BACKGROUND SYNC — matches Laravel:
      // 1. Call get-store-process-competitors
      // 2. Use its HTTP response to render INITIAL rows immediately
      // 3. Socket competitor-batch events will REPLACE rows as more arrive
      const exceeded = res?.data?.exceeded || res?.exceeded;
      if (!exceeded) {
        try {
          const storeResp = await CompetitorAPI.getStoreProcessCompetitors(
            websiteLink,
            newRefId,
            parseInt(maxCompetitors, 10),
            userId,
          );

          const apiData = storeResp?.body?.data || storeResp?.data || {};
          const initialRows = apiData.rows || [];

          if (apiData.status === "limit_exceeded") {
            showToast("Daily AI token limit exceeded", "error");
            setProjects((prev) =>
              prev.map((p) =>
                p.id === projectId ? { ...p, isGenerating: false } : p,
              ),
            );
            return;
          }

          // Render initial rows from HTTP response (same as Laravel's renderAiPage)
          if (initialRows.length > 0) {
            // Enrich with ES stats
            const names = initialRows.map((r) => r.name);
            let esMap = {};
            if (names.length > 0) {
              const statsRes = await CompetitorAPI.getCompetitorCountNew(names);
              esMap = statsRes?.body?.data || {};
            }

            const enriched = initialRows.map((row, idx) => {
              const stats = esMap[row.name] || {};
              const initPopVal = stats.averagePopularity || 0;
              const initPopLabel = initPopVal > 66 ? "High" : initPopVal > 33 ? "Medium" : "Low";
              const initPopFormatted = Number(initPopVal).toFixed(2);
              return {
                id: row.id || `init-${idx}-${Date.now()}`,
                requestId: row.comp_request_id,
                name: row.name,
                totalAds: stats.competitorsCount || 0,
                todayAds: stats.todayAdsCount || 0,
                yesterdayAds: stats.yesterdayAdsCount || 0,
                lastWeekAds: stats.lastWeekAdsCount || 0,
                lastMonthAds: stats.lastMonthAdsCount || 0,
                impressions: stats.averageImpression
                  ? formatNumber(stats.averageImpression)
                  : "0",
                popularity: stats.averagePopularity
                  ? `${initPopLabel} (${initPopFormatted}%)`
                  : "Low (0%)",
                countries: stats.uniqueCountries || [],
                platforms: (() => {
                  const p = [];
                  const pc = stats.platformCompetitorCount || {};
                  if (pc.facebook > 0) p.push("Facebook");
                  if (pc.instagram > 0) p.push("Instagram");
                  if (pc.google > 0) p.push("Google");
                  return p;
                })(),
                budget: stats.totalBudget
                  ? `$${Number(stats.totalBudget).toLocaleString()}`
                  : "$0",
                isMonitored: row.monitoring || false,
                specificToMatch: row.specific_to_match || null,
              };
            });

            setProjects((prev) =>
              prev.map((p) =>
                p.id === projectId
                  ? {
                      ...p,
                      competitors: enriched,
                      isGenerating: apiData.status === "running",
                    }
                  : p,
              ),
            );
          }

          // If completed already, stop generating
          if (apiData.status === "completed") {
            setProjects((prev) =>
              prev.map((p) =>
                p.id === projectId ? { ...p, isGenerating: false } : p,
              ),
            );
          }
        } catch (err) {
          // Don't block — socket will still deliver data from background loop
          console.error(
            "getStoreProcessCompetitors failed (socket will still deliver):",
            err,
          );
        }
      }
    } catch (e) {
      if (isSessionExpiredError(e)) {
        showToast("Your session has expired. Please log in again.", "error");
        return;
      }
      console.error("Failed to generate competitors", e);
      // A client-side abort (competitorFetch's own timeoutMs) or the backend's
      // clean 504/502 (its DS call timed out/failed — see DS_PREPARE_TIMEOUT_MS
      // in competitorService.js) both land here, since checkCompetitorProcess
      // is awaited directly. Either way, no brand is left behind: the backend
      // deletes the phantom project doc it created before calling DS.
      const isTimeout =
        e instanceof CompetitorFetchTimeoutError ||
        /\b(504|502)\b/.test(e?.message || "");
      showToast(
        isTimeout
          ? "The competitor generation service took too long to respond. Please try again — requesting fewer competitors may help."
          : "Error generating competitors. Please try again.",
        "error",
        isTimeout ? 6000 : 3000,
      );
      setViewState(1); // Go back to start on error
    } finally {
      // Initial rows are fetched + enriched (or we errored out) — let the empty
      // state resolve to its real value. Any further rows arrive via socket.
      setIsPreparingCompetitors(false);
    }
  };

  const openProject = async (id, advertiserName) => {
    // Switching to another project ends any in-progress generate buffer.
    setIsPreparingCompetitors(false);
    setSelectedProjectId(id);
    setOpenDropdownId(null);
    setOpenGeoId(null);
    setViewState(4);

    // Check if we've already loaded this project's competitors
    const targetProj = projects.find((p) => p.id === id);
    if (
      targetProj &&
      targetProj.competitors &&
      targetProj.competitors.length > 0
    ) {
      trackProjectEvent('Project-click', {
        project_name: advertiserName ?? 'NA',
        competitors: targetProj.competitors.map((c) => c.name),
      });
      return; // Already fetched
    }

    // If project is currently generating via AI, data comes via socket — don't call API
    if (targetProj?.isGenerating) {
      return;
    }

    // Fetch Live Competitors Data For Project
    if (competitorUserId && advertiserName) {
      setIsProjectLoading(true);
      try {
        const page = 1;
        const limit = 100;
        const compResp = await CompetitorAPI.generateCompetitorsSearch(
          advertiserName,
          competitorUserId,
          page,
          limit,
        );

        if (compResp?.body?.data?.comp_details) {
          const remoteDetails = Object.entries(compResp.body.data.comp_details);

          const remoteCompetitors = remoteDetails.map(
            ([compName, details], idx) => {
              // Default placeholders before /get-competitor-count finishes.
              // statsLoaded:false → per-cell shimmer until the stats API answers.
              return {
                id: details.id, // mongo _id of competitor
                requestId: details.comp_request_id,
                name: compName,
                totalAds: 0,
                todayAds: 0,
                yesterdayAds: 0,
                lastWeekAds: 0,
                lastMonthAds: 0,
                impressions: "...",
                popularity: "...",
                countries: [],
                platforms: [],
                budget: "...",
                isMonitored: details.monitoring,
                statsLoaded: false,
                specificToMatch: details.specific_to_match || null,
              };
            },
          );

          // 1. Set the initial array of competitors with zeroed/empty placeholders
          setProjects((prev) =>
            prev.map((p) =>
              p.id === id ? { ...p, competitors: remoteCompetitors } : p,
            ),
          );

          trackProjectEvent('Project-click', {
            project_name: advertiserName ?? 'NA',
            competitors: remoteCompetitors.map((c) => c.name),
          });

          // 2. Fire independent async API calls to get analytics for each competitor
          remoteCompetitors.forEach((comp) => {
            CompetitorAPI.getCompetitorCount(comp.name)
              .then((statsResp) => {
                const pData = statsResp?.body?.data || statsResp?.data; // Check response structure
                if (pData) {
                  setProjects((prev) =>
                    prev.map((p) => {
                      if (p.id !== id) return p;

                      const updatedCompetitors = p.competitors.map((c) => {
                        if (c.id !== comp.id) return c;

                        const platforms = [];
                        const pc2 = pData.platformCompetitorCount || {};
                        if (pc2.facebook > 0) platforms.push("Facebook");
                        if (pc2.instagram > 0) platforms.push("Instagram");
                        if (pc2.google > 0) platforms.push("Google");

                        let popLabel = "Low";
                        if (pData.averagePopularity > 66) popLabel = "High";
                        else if (pData.averagePopularity > 33)
                          popLabel = "Medium";

                        const formattedPop = pData.averagePopularity
                          ? Number(pData.averagePopularity).toFixed(2)
                          : "0";

                        const budgetFmt = pData.totalBudget
                          ? `$${pData.totalBudget.toLocaleString()}`
                          : "$0";

                        return {
                          ...c,
                          totalAds: pData.competitorsCount || 0,
                          todayAds: pData.todayAdsCount || 0,
                          yesterdayAds: pData.yesterdayAdsCount || 0,
                          lastWeekAds: pData.lastWeekAdsCount || 0,
                          lastMonthAds: pData.lastMonthAdsCount || 0,
                          impressions: formatNumber(
                            pData.averageImpression || 0,
                          ),
                          popularity: `${popLabel} (${formattedPop}%)`,
                          budget: budgetFmt,
                          countries: pData.uniqueCountries || [],
                          platforms: platforms,
                          statsLoaded: true, // API answered — shimmer off
                        };
                      });
                      return { ...p, competitors: updatedCompetitors };
                    }),
                  );
                } else {
                  // Empty response — still stop the shimmer, show zeros.
                  markCompetitorStatsLoaded(id, comp.id);
                }
              })
              .catch((e) => {
                console.error("Could not fetch stats for", comp.name, e);
                markCompetitorStatsLoaded(id, comp.id);
              });
          });
        }
      } catch (err) {
        console.error("Failed to load competitors", err);
      } finally {
        setIsProjectLoading(false);
      }
    }
  };

  // Stop the per-cell shimmer for a row whose stats call failed / returned
  // nothing — zeros are shown instead of an endless shimmer.
  const markCompetitorStatsLoaded = (projectId, compId) => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          competitors: (p.competitors || []).map((c) =>
            c.id === compId && c.statsLoaded === false
              ? {
                  ...c,
                  statsLoaded: true,
                  impressions: "0",
                  popularity: "Low (0%)",
                  budget: "$0",
                }
              : c,
          ),
        };
      }),
    );
  };

  const toggleMonitoringStatus = async (project, competitor) => {
    // "0" = Enable, "1" = Disable (Node.js backend expectation)
    const newStatus = competitor.isMonitored ? "1" : "0";
    try {
      const result = await CompetitorAPI.updateMonitoringStatus({
        competitor_request_id: competitor.requestId || project.id,
        competitor_id: competitor.id,
        competitor_name: competitor.name,
        project_name: project.advertiser || project.name,
        status: newStatus,
        brand_url: project.brand_url || project.website || websiteLink,
        user_id: competitorUserId,
      });

      // Update local state if successful
      // Backend might return 200 (Success) or 201 (Already set)
      if (
        result.statusCode === 200 ||
        result.statusCode === 201 ||
        result.statusCode === "200" ||
        result.statusCode === "201"
      ) {
        showToast(
          newStatus === "0"
            ? "Monitoring status enabled successfully."
            : "Monitoring status disabled successfully.",
        );
        trackProjectEvent('monitoring-status', {
          project_name:       project.advertiser || project.name,
          advertiser:         competitor.name,
          monitoring_status:  newStatus === "0" ? "on" : "off",
        });
        setProjects((prev) =>
          prev.map((p) => {
            if (p.id !== project.id) return p;
            return {
              ...p,
              competitors: p.competitors.map((c) =>
                c.id === competitor.id
                  ? { ...c, isMonitored: !c.isMonitored }
                  : c,
              ),
            };
          }),
        );
      }
    } catch (error) {
      console.error("Failed to toggle monitoring status", error);
    }
  };

  const startNewProject = () => {
    setWebsiteLink("");
    setSelectedKeywords([]);
    setSelectedCountries([]);
    setCountrySearch("");
    setIsCountryAccordionOpen(false);
    setViewState(1);
  };

  const goBackToAllProjects = () => {
    setSelectedProjectId(null);
    setViewState(0);
  };

  const toggleMonitoring = (projId, compId) => {
    setProjects((prev) =>
      prev.map((proj) => {
        if (proj.id !== projId) return proj;
        return {
          ...proj,
          competitors: proj.competitors.map((comp) =>
            comp.id === compId
              ? { ...comp, isMonitored: !comp.isMonitored }
              : comp,
          ),
        };
      }),
    );
  };

  const openAddCompetitorModal = () => {
    setManualCompName("");
    setManualCompUrl("");
    setShowAddCompetitorModal(true);
  };

  // ── Rename brand ──────────────────────────────────────────────────────
  const openRenameBrandModal = () => {
    setRenameBrandValue(activeProject?.advertiser || "");
    setShowRenameBrandModal(true);
  };

  const closeRenameBrandModal = () => {
    if (isRenamingBrand) return;
    setShowRenameBrandModal(false);
    setRenameBrandValue("");
  };

  const handleRenameBrand = async (e) => {
    if (e) e.preventDefault();
    if (!activeProject) return;
    const oldName = activeProject.advertiser;
    // Brands are stored lowercased (same normalization as project creation).
    const newName = renameBrandValue.trim().toLowerCase();
    if (!newName || newName === (oldName || "").toLowerCase()) {
      closeRenameBrandModal();
      return;
    }
    const duplicate = projects.some(
      (p) => p.id !== activeProject.id && (p.advertiser || "").toLowerCase() === newName,
    );
    if (duplicate) {
      showToast(`A project named "${newName}" already exists.`, "error");
      return;
    }

    setIsRenamingBrand(true);
    try {
      const resp = await CompetitorAPI.renameAdvertiser(
        competitorUserId,
        oldName,
        newName,
      );
      if (resp?.body?.status === "success") {
        setProjects((prev) =>
          prev.map((p) =>
            p.id === activeProject.id ? { ...p, advertiser: newName } : p,
          ),
        );
        showToast("Brand renamed successfully.");
        setShowRenameBrandModal(false);
        setRenameBrandValue("");
      } else {
        showToast(resp?.body?.message || "Failed to rename brand.", "error");
      }
    } catch (err) {
      console.error("Failed to rename brand", err);
      showToast("Failed to rename brand. Please try again.", "error");
    } finally {
      setIsRenamingBrand(false);
    }
  };

  const closeAddCompetitorModal = () => {
    if (isAddingCompetitor) return;
    setShowAddCompetitorModal(false);
    setManualCompName("");
    setManualCompUrl("");
  };

  const handleAddManualCompetitor = async (e) => {
    if (e) e.preventDefault();
    const name = manualCompName.trim();
    const url = manualCompUrl.trim();
    if (!name || !activeProject) return;

    const duplicate = (activeProject.competitors || []).some(
      (c) => (c.name || "").toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) {
      showToast(`"${name}" is already in this project.`, "error");
      return;
    }

    setIsAddingCompetitor(true);
    try {
      const resp = await CompetitorAPI.addManualCompetitor({
        userId: competitorUserId,
        advertiser: activeProject.advertiser,
        competitorName: name,
        competitorUrl: url,
      });

      const added = resp?.body?.data;
      if (!added) {
        showToast("Failed to add competitor. Please try again.", "error");
        return;
      }

      const newCompetitor = {
        id: added.id || `manual-${Date.now()}`,
        requestId: added.comp_request_id,
        name: added.name || name,
        totalAds: 0,
        todayAds: 0,
        yesterdayAds: 0,
        lastWeekAds: 0,
        lastMonthAds: 0,
        impressions: "...",
        popularity: "...",
        countries: [],
        platforms: [],
        budget: "...",
        isMonitored: false,
        statsLoaded: false, // per-cell shimmer until stats arrive
      };

      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeProject.id
            ? { ...p, competitors: [newCompetitor, ...(p.competitors || [])] }
            : p,
        ),
      );

      showToast(
        added.already_existed
          ? "Competitor already in this project."
          : "Competitor added successfully.",
      );
      trackProjectEvent('Competitor-comparison', { project_name: activeProject?.advertiser ?? 'NA', advertiser: name });

      setShowAddCompetitorModal(false);
      setManualCompName("");
      setManualCompUrl("");

      // Fetch live stats for this competitor in the background
      // Use the canonical name returned by the server (lowercased) — that's how
      // it's indexed in Elasticsearch/Mongo, so stats lookup will actually match.
      CompetitorAPI.getCompetitorCount(newCompetitor.name)
        .then((statsResp) => {
          const pData = statsResp?.body?.data || statsResp?.data;
          if (!pData) {
            // Empty response — stop the shimmer, show zeros.
            markCompetitorStatsLoaded(activeProject.id, newCompetitor.id);
            return;
          }
          setProjects((prev) =>
            prev.map((p) => {
              if (p.id !== activeProject.id) return p;
              const updatedCompetitors = p.competitors.map((c) => {
                if (c.id !== newCompetitor.id) return c;
                const platforms = [];
                const pc2 = pData.platformCompetitorCount || {};
                if (pc2.facebook > 0) platforms.push("Facebook");
                if (pc2.instagram > 0) platforms.push("Instagram");
                if (pc2.google > 0) platforms.push("Google");

                let popLabel = "Low";
                if (pData.averagePopularity > 66) popLabel = "High";
                else if (pData.averagePopularity > 33) popLabel = "Medium";

                const formattedPop = pData.averagePopularity
                  ? Number(pData.averagePopularity).toFixed(2)
                  : "0";

                const budgetFmt = pData.totalBudget
                  ? `$${pData.totalBudget.toLocaleString()}`
                  : "$0";

                return {
                  ...c,
                  totalAds: pData.competitorsCount || 0,
                  todayAds: pData.todayAdsCount || 0,
                  yesterdayAds: pData.yesterdayAdsCount || 0,
                  lastWeekAds: pData.lastWeekAdsCount || 0,
                  lastMonthAds: pData.lastMonthAdsCount || 0,
                  impressions: formatNumber(pData.averageImpression || 0),
                  popularity: `${popLabel} (${formattedPop}%)`,
                  budget: budgetFmt,
                  countries: pData.uniqueCountries || [],
                  platforms,
                  statsLoaded: true, // API answered — shimmer off
                };
              });
              return { ...p, competitors: updatedCompetitors };
            }),
          );
        })
        .catch((err) => {
          console.error("Could not fetch stats for new competitor", err);
          markCompetitorStatsLoaded(activeProject.id, newCompetitor.id);
        });
    } catch (err) {
      console.error("Failed to add manual competitor", err);
      showToast("Failed to add competitor. Please try again.", "error");
    } finally {
      setIsAddingCompetitor(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!projectToDelete) return;
    try {
      const advertiserName = projectToDelete.advertiser || projectToDelete.name;
      await CompetitorAPI.deleteProject(competitorUserId, advertiserName);
      setProjects((prev) => prev.filter((p) => p.id !== projectToDelete.id));
      if (selectedProjectId === projectToDelete.id) {
        setViewState(0);
        setSelectedProjectId(null);
      }
      showToast(`Project "${advertiserName}" deleted successfully.`);
      trackProjectEvent('Delete-project', { deleted_Advertisers: [advertiserName ?? 'NA'] });
    } catch (err) {
      console.error("Failed to delete project:", err);
      showToast("Failed to delete project. Please try again.", "error");
    } finally {
      setProjectToDelete(null);
    }
  };

  // Delete a competitor from MongoDB, then drop it from local state so it
  // disappears immediately and does not reappear on reload.
  const handleDeleteCompetitor = async () => {
    if (!competitorToDelete || isDeletingCompetitor) return;
    const { advertiser, competitor } = competitorToDelete;
    setIsDeletingCompetitor(true);
    try {
      const resp = await CompetitorAPI.deleteCompetitor({
        userId: competitorUserId,
        advertiser,
        competitorId: competitor.id,
        competitorName: competitor.name,
      });

      const ok =
        resp?.statusCode === 200 ||
        resp?.statusCode === "200" ||
        resp?.body?.status === "success";

      if (!ok) {
        showToast("Failed to remove competitor. Please try again.", "error");
        return;
      }

      const sameCompetitor = (c) =>
        (competitor.id != null && c.id === competitor.id) ||
        (c.name || "").toLowerCase() === (competitor.name || "").toLowerCase();

      setProjects((prev) =>
        prev.map((p) => {
          if (p.id !== selectedProjectId) return p;
          const remaining = (p.competitors || []).filter(
            (c) => !sameCompetitor(c),
          );
          const removedCount = (p.competitors || []).length - remaining.length;
          return {
            ...p,
            competitors: remaining,
            // Keep the My Projects list-card counts in sync without a reload.
            initialCompetitorCount: Math.max(
              0,
              (p.initialCompetitorCount || 0) - removedCount,
            ),
            initialMonitoredCount: competitor.isMonitored
              ? Math.max(0, (p.initialMonitoredCount || 0) - removedCount)
              : p.initialMonitoredCount || 0,
          };
        }),
      );
      showToast(`"${competitor.name}" removed from this project.`);
      trackProjectEvent("Delete-competitor", {
        project_name: advertiser ?? "NA",
        advertiser: competitor.name,
      });
      setCompetitorToDelete(null);
    } catch (err) {
      console.error("Failed to delete competitor:", err);
      showToast("Failed to remove competitor. Please try again.", "error");
    } finally {
      setIsDeletingCompetitor(false);
    }
  };

  const [competitorSearch, setCompetitorSearch] = useState("");
  const visibleCompetitors = activeProject ? activeProject.competitors : [];
  const filteredCompetitors = visibleCompetitors.filter((c) =>
    (c.name || "").toLowerCase().includes(competitorSearch.toLowerCase()),
  );
  const totalMonitored = visibleCompetitors.filter((c) => c.isMonitored).length;
  const totalAds = visibleCompetitors.reduce(
    (sum, c) => sum + (c.isMonitored ? c.totalAds : 0),
    0,
  );
  const paginatedCompetitors = filteredCompetitors;

  return (
    <div className="flex-1 h-full overflow-y-auto bg-theme-bg p-8 text-theme-text custom-scrollbar">
      {viewState === 0 && (
        <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-300">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-white mb-2">
                My Projects
              </h1>
              <p className="text-theme-text-muted">
                Manage your monitored advertisers and competitor intelligence.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <MembersManager userId={competitorUserId} projects={projects} />
              <button
                onClick={startNewProject}
                className="bg-[#335296] hover:bg-[#3762c1] text-white shadow-lg shadow-[#3759a3]/25 px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all"
              >
                <Plus size={18} /> Add New Advertiser
              </button>
            </div>
          </div>

          {isLoadingProjects ? (
            <div className="flex justify-center py-20">
              <Loader2 className="animate-spin text-[#3759a3] w-10 h-10" />
            </div>
          ) : hasProjects ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {projects.map((proj) => {
                return (
                  <div
                    key={proj.id}
                    onClick={() => openProject(proj.id, proj.advertiser)}
                    className="bg-theme-card border border-theme-border rounded-2xl p-6 cursor-pointer hover:border-[#3759a3]/40 hover:shadow-xl hover:shadow-[#3759a3]/5 transition-all group relative"
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setProjectToDelete({
                          id: proj.id,
                          advertiser: proj.advertiser,
                        });
                      }}
                      className="absolute top-4 right-4 p-2 rounded-xl text-theme-text-muted hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all border border-transparent hover:border-red-500/20"
                      title="Delete Advertiser"
                    >
                      <Trash2 size={16} />
                    </button>
                    <h3
                      title={proj.advertiser}
                      className="text-xl font-bold text-white mb-1 group-hover:text-[#6b99ff] transition-colors mt-2 break-words line-clamp-2 pr-8"
                    >
                      {capitalizeFirst(proj.advertiser)}
                    </h3>
                    <div className="flex items-center gap-1.5 text-sm text-theme-text-muted">
                      <Activity
                        size={14}
                        className="text-theme-text-secondary opacity-70"
                      />{" "}
                      Monitoring {proj.initialMonitoredCount} /{" "}
                      {proj.initialCompetitorCount || 0}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      )}

      {viewState === 1 && (
        <div className="max-w-4xl mx-auto mt-12 animate-in fade-in duration-300">
          {hasProjects && (
            <button
              onClick={goBackToAllProjects}
              className="mb-8 text-theme-text-muted hover:text-white flex items-center gap-2 text-sm font-semibold transition-colors"
            >
              <X size={16} /> Cancel Setup
            </button>
          )}
          <div
            className={`text-center mb-10 ${hasProjects ? "mt-6" : "mt-12"}`}
          >
            {!hasProjects && (
              <div className="w-16 h-16 bg-[#3762c1]/10 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-[#3759a3]/20">
                <Sparkles className="text-[#6b99ff]" size={28} />
              </div>
            )}
            <h1 className="text-3xl font-bold mb-3 tracking-tight">
              {hasProjects ? "Add New Advertiser" : "Competitor Intelligence"}
            </h1>
            <p className="text-theme-text-muted text-lg max-w-xl mx-auto">
              Enter an advertiser's website link to discover and analyze their
              top competitors.
            </p>
          </div>
          <div className="bg-theme-card border border-theme-border rounded-2xl p-6 shadow-2xl shadow-[#3759a3]/5">
            <label className="block text-sm font-semibold text-theme-text-secondary mb-2">
              Advertiser website, name or description
            </label>
            <div className="flex gap-3">
              <div
                className="relative flex-1"
                ref={advertiserInputWrapperRef}
              >
                <Globe
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-theme-text-muted"
                  size={18}
                />
                <input
                  ref={advertiserInputRef}
                  type="text"
                  value={websiteLink}
                  onChange={(e) => {
                    setWebsiteLink(e.target.value);
                    setShowAdvertiserSuggestions(true);
                  }}
                  onFocus={() => setShowAdvertiserSuggestions(true)}
                  placeholder="e.g. walmart.com, Walmart, or online retail store"
                  autoComplete="off"
                  className="w-full bg-theme-bg border border-theme-border rounded-xl py-3.5 pl-11 pr-4 text-theme-text focus:outline-none focus:border-[#3759a3] focus:ring-1 focus:ring-[#3759a3]/50 transition-all font-medium"
                />
                {showAdvertiserSuggestions &&
                  advertiserSuggestions.length > 0 && (
                    <div className="absolute z-10 top-full left-0 right-0 mt-2 bg-theme-card border border-theme-border rounded-xl shadow-2xl shadow-black/20 overflow-hidden">
                      <p className="px-4 pt-3 pb-1 text-xs font-semibold text-theme-text-muted uppercase tracking-wide">
                        Existing Advertisers
                      </p>
                      <div className="max-h-64 overflow-y-auto">
                        {advertiserSuggestions.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setWebsiteLink(p.advertiser);
                              setShowAdvertiserSuggestions(false);
                            }}
                            className="w-full text-left px-4 py-2.5 flex items-center gap-2.5 hover:bg-theme-border/60 transition-colors"
                          >
                            <Globe
                              size={14}
                              className="text-theme-text-muted flex-shrink-0"
                            />
                            <span className="text-sm font-medium text-theme-text truncate">
                              {capitalizeFirst(p.advertiser)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
              <button
                onClick={handleNextPhase}
                disabled={!websiteLink}
                className={`px-6 py-3.5 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg ${websiteLink ? "bg-[#335296] hover:bg-[#3762c1] text-white shadow-[#3759a3]/25 cursor-pointer" : "bg-theme-border text-theme-text-muted cursor-not-allowed"}`}
              >
                Continue <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </div>
      )}

      {viewState === 2 && (
        <div className="max-w-4xl mx-auto mt-8 animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold">Configure Analysis</h2>
              <p className="text-theme-text-muted">
                Targeting competitors for{" "}
                <span className="text-white font-semibold">{websiteLink}</span>
              </p>
            </div>
            <button
              onClick={startNewProject}
              className="p-2 bg-theme-border hover:bg-theme-card rounded-lg text-theme-text-muted transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-6">
              <div className="bg-theme-card border border-theme-border rounded-xl p-6 shadow-sm">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Target size={16} className="text-[#6b99ff]" /> Provide
                  Relevant Keywords For Better Results
                </h3>
                <div>
                  <form onSubmit={addCustomKeyword} className="flex gap-2">
                    <input
                      type="text"
                      value={customKeyword}
                      onChange={(e) => setCustomKeyword(e.target.value)}
                      placeholder="Enter keyword..."
                      className="flex-1 bg-theme-bg border border-theme-border rounded-lg py-2.5 px-4 text-sm text-theme-text focus:outline-none focus:border-[#3759a3] transition-all"
                    />
                    <button
                      type="submit"
                      disabled={!customKeyword.trim()}
                      className="bg-theme-border hover:bg-theme-border/80 text-white px-4 rounded-lg text-sm font-bold transition-all disabled:opacity-50"
                    >
                      Add
                    </button>
                  </form>
                  <h4 className="text-sm font-medium text-theme-text-secondary mt-3 flex items-center gap-1.5">
                    <Plus size={14} className="text-[#6b99ff]" /> Add Relevant
                    Keyword or Choose From Below
                  </h4>
                </div>
                <div className="flex flex-wrap gap-2 border-t border-theme-border pt-6 mt-6">
                  {keywordSuggestions.slice(0, 20).map((kw) => {
                    const isSelected = selectedKeywords.includes(kw);
                    return (
                      <button
                        key={kw}
                        onClick={() => toggleKeyword(kw)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${isSelected ? "bg-[#3762c1]/20 text-[#7899e0] border border-[#3759a3]/40" : "bg-theme-bg text-theme-text-muted border border-theme-border hover:border-[#3759a3]/30"}`}
                      >
                        {isSelected && (
                          <Check size={14} className="inline mr-1.5" />
                        )}
                        {kw}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-theme-card border border-theme-border rounded-xl p-6 shadow-sm">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Users size={16} className="text-[#6b99ff]" /> Max Competitors
                </h3>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="1"
                    max="100"
                    step="1"
                    value={maxCompetitors}
                    onChange={(e) => setMaxCompetitors(e.target.value)}
                    className="w-full h-2 bg-theme-bg rounded-lg appearance-none cursor-pointer accent-[#3759a3]"
                  />
                  <span className="text-xl font-bold w-12 text-center">
                    {maxCompetitors}
                  </span>
                </div>
                {parseInt(maxCompetitors, 10) >= 50 && (
                  <p className="flex items-start gap-1.5 text-xs text-theme-text-muted mt-3">
                    <Info size={13} className="flex-shrink-0 mt-0.5" />
                    Requesting {maxCompetitors} competitors may take longer to
                    generate — please wait after submitting.
                  </p>
                )}
              </div>

              {COUNTRY_TARGETING_ON && (
              <>
              <div className="bg-theme-card border border-theme-border rounded-xl shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => setIsCountryAccordionOpen((prev) => !prev)}
                  className="w-full flex items-center justify-between p-6"
                >
                  <h3 className="font-semibold flex items-center gap-2">
                    <Globe size={16} className="text-[#6b99ff]" /> Target
                    Countries
                    {selectedCountries.length > 0 && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#3762c1]/20 text-[#7899e0] border border-[#3759a3]/40">
                        {selectedCountries.length}
                      </span>
                    )}
                  </h3>
                  <ChevronDown
                    size={18}
                    className={`text-theme-text-muted transition-transform ${isCountryAccordionOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {isCountryAccordionOpen && (
                  <div className="px-6 pb-6">
                    <div className="relative mb-3">
                      <Search
                        size={14}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted"
                      />
                      <input
                        type="text"
                        value={countrySearch}
                        onChange={(e) => setCountrySearch(e.target.value)}
                        placeholder="Search countries..."
                        className="w-full bg-theme-bg border border-theme-border rounded-lg py-2 pl-8 pr-3 text-sm text-theme-text focus:outline-none focus:border-[#3759a3] transition-all"
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                      {filteredCountries.length === 0 ? (
                        <p className="text-sm text-theme-text-muted text-center py-4">
                          No countries match "{countrySearch}"
                        </p>
                      ) : (
                        filteredCountries.map((c) => {
                          const isSelected = selectedCountries.includes(
                            c.code,
                          );
                          return (
                            <button
                              key={c.code}
                              type="button"
                              onClick={() => toggleCountry(c.code)}
                              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2.5 transition-all ${isSelected ? "bg-[#3762c1]/20 text-[#7899e0] border border-[#3759a3]/40" : "hover:bg-theme-bg text-theme-text border border-transparent"}`}
                            >
                              <span
                                className={`w-4 h-4 rounded-sm border flex items-center justify-center flex-shrink-0 ${isSelected ? "bg-[#3762c1] border-[#3762c1]" : "border-theme-border"}`}
                              >
                                {isSelected && (
                                  <Check size={12} className="text-white" />
                                )}
                              </span>
                              {c.name}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
              <p className="flex items-start gap-1.5 text-xs text-theme-text-muted px-1">
                <Info size={13} className="flex-shrink-0 mt-0.5" />
                Restricting to a specific country limits results to
                competitors found in that country. If this pool is smaller
                than your requested number, leave the country field empty to
                get a complete competitor list from all regions.
              </p>
              </>
              )}

              <button
                onClick={handleSubmitData}
                disabled={selectedKeywords.length === 0}
                className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg ${selectedKeywords.length > 0 ? "bg-[#335296] hover:bg-[#3762c1] text-white shadow-[#3759a3]/25" : "bg-theme-border text-theme-text-muted cursor-not-allowed"}`}
              >
                Generate Competitors <Sparkles size={18} />
              </button>
            </div>
          </div>
        </div>
      )}

      {viewState === 3 && (
        <div className="h-full flex flex-col items-center justify-center animate-in fade-in duration-500">
          <Loader2 size={48} className="text-[#3759a3] animate-spin mb-6" />
          <h2 className="text-2xl font-bold mb-2">Analyzing {websiteLink}</h2>
          <p className="text-theme-text-muted">
            {isGeneratingKeywords
              ? "Fetching best keywords..."
              : "Generating competitors in the background..."}
          </p>
        </div>
      )}

      {/* Restore window: viewState 4 was restored (e.g. browser Back from a
          Dashboard drill-down) but the projects list is still loading, so
          activeProject isn't resolved yet — show a spinner instead of a blank. */}
      {viewState === 4 && !activeProject && isLoadingProjects && (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-[#3759a3] w-10 h-10" />
        </div>
      )}

      {viewState === 4 && activeProject && (
        <div className="animate-in fade-in duration-500 w-full">
          <button
            onClick={goBackToAllProjects}
            className="text-theme-text-muted hover:text-white flex items-center gap-1.5 text-sm font-semibold transition-colors mb-6"
          >
            <ChevronLeft size={18} /> All Projects
          </button>
          <div className="max-w-[1600px] mx-auto space-y-6 pb-20">
            <div className="flex items-end justify-between border-b border-theme-border pb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-theme-card border border-theme-border rounded-lg">
                  <Globe size={24} className="text-[#6b99ff]" />
                </div>
                <h1 className="text-3xl font-bold text-white tracking-tight">
                  {capitalizeFirst(activeProject.advertiser)}
                </h1>
                <button
                  onClick={openRenameBrandModal}
                  title={`Rename brand "${activeProject.advertiser}"`}
                  className="p-2 rounded-lg text-theme-text-muted hover:text-[#6b99ff] hover:bg-[#3762c1]/10 border border-theme-border hover:border-[#3759a3]/40 transition-all"
                >
                  <Edit2 size={16} />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={startNewProject}
                  className="px-4 py-2 bg-theme-card hover:bg-theme-border border border-theme-border rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 shadow-sm text-white"
                >
                  <Plus size={16} /> Add Another
                </button>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4">
              <div className="bg-theme-card border border-theme-border rounded-xl p-5 flex items-center justify-between shadow-sm">
                <div>
                  <p className="text-xs text-theme-text-muted font-medium mb-1">
                    Active Monitors
                  </p>
                  <p className="text-2xl font-bold text-white">
                    {totalMonitored}
                  </p>
                </div>
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                  <Monitor size={20} className="text-blue-400" />
                </div>
              </div>

              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-5 flex items-center justify-between shadow-sm">
                <div>
                  <p className="text-xs text-emerald-400/80 font-medium mb-1">
                    Total Ads Tracked
                  </p>
                  <p className="text-2xl font-bold text-emerald-400">
                    {visibleCompetitors
                      .reduce((sum, c) => sum + c.totalAds, 0)
                      .toLocaleString()}
                  </p>
                </div>
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                  <Megaphone size={20} className="text-emerald-400" />
                </div>
              </div>

              <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-5 flex items-center justify-between shadow-sm">
                <div>
                  <p className="text-xs text-purple-400/80 font-medium mb-1">
                    Total Budget
                  </p>
                  <p className="text-2xl font-bold text-purple-400">
                    {calculateTotalBudget(visibleCompetitors)}
                  </p>
                </div>
                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
                  <CircleDollarSign size={20} className="text-purple-400" />
                </div>
              </div>

              <div className="bg-orange-500/5 border border-orange-500/20 rounded-xl p-5 flex items-center justify-between shadow-sm">
                <div>
                  <p className="text-xs text-orange-400/80 font-medium mb-1">
                    Competitors
                  </p>
                  <p className="text-2xl font-bold text-orange-400">
                    {visibleCompetitors.length}
                  </p>
                </div>
                <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
                  <Users size={20} className="text-orange-400" />
                </div>
              </div>
            </div>

            <div className="bg-theme-card border border-theme-border rounded-xl overflow-hidden shadow-xl flex flex-col">
              <div className="px-6 py-4 border-b border-theme-border bg-theme-bg/50 flex justify-between items-center gap-3">
                <div>
                  <h2 className="text-lg font-bold flex items-center gap-2">
                    <TrendingUp className="text-[#6b99ff] w-5 h-5" /> Competitor
                    Analytics
                  </h2>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <div className="relative">
                    <Search
                      size={13}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-theme-text-muted"
                    />
                    <input
                      type="text"
                      placeholder="Search competitors..."
                      value={competitorSearch}
                      onChange={(e) => {
                        setCompetitorSearch(e.target.value);
                      }}
                      className="pl-8 pr-3 py-2.5 rounded-lg text-[11px] bg-theme-bg border border-theme-border text-theme-text placeholder:text-theme-text-muted focus:outline-none focus:border-[#3759a3]/50 w-64"
                    />
                  </div>
                </div>
                <button
                  onClick={openAddCompetitorModal}
                  title={`Manually add a competitor to "${activeProject?.advertiser}"`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[#335296] hover:bg-[#3762c1] text-white transition-all shadow-sm whitespace-nowrap"
                >
                  <Plus size={13} /> Add Competitor
                </button>
                <button
                  onClick={() => {
                    const comps = activeProject?.competitors || [];
                    if (!comps.length) return;
                    const headers = [
                      "Competitor",
                      "Monitoring Status",
                      "Avg Impression",
                      "Popularity %",
                      "Total Ads",
                      "Recent Activity (Today)",
                      "Platforms",
                      "Top Countries",
                      "Estimated Total Ad Budget ($)",
                    ];
                    const rows = comps.map((c) => [
                      c.name || "",
                      c.isMonitored ? "Enabled" : "Disabled",
                      c.impressions || "0",
                      c.popularity || "0%",
                      c.totalAds || "0",
                      c.todayAds ?? "0",
                      (c.platforms || []).join(" | "),
                      (c.countries || []).join(" | "),
                      c.budget || "$0",
                    ]);
                    const csv = [headers, ...rows]
                      .map((r) =>
                        r
                          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
                          .join(","),
                      )
                      .join("\n");
                    const blob = new Blob([csv], { type: "text/csv" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${activeProject?.advertiser || "competitors"}_analytics.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                    trackProjectEvent("export_competitors", {
                      brand: activeProject?.advertiser || "Unknown",
                      exported_Competitors: comps.map((c) => c.name),
                    });
                  }}
                  title="Download Competitor Data as CSV"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-theme-border text-theme-text-muted hover:text-white hover:border-white/20 transition-all"
                >
                  <Download size={13} /> Export Competitor Data
                </button>
              </div>

              {/* AI Processing Banner — shown while competitors are still generating (matches Laravel) */}
              {activeProject?.isGenerating &&
                activeProject?.competitors?.length > 0 && (
                  <div className="px-6 py-3 bg-[#3762c1]/10 border-b border-[#3759a3]/20 flex items-center gap-3">
                    <Loader2 className="w-4 h-4 text-[#6b99ff] animate-spin flex-shrink-0" />
                    <p className="text-sm text-[#7899e0]">
                      {progressStatus ||
                        "AI is generating competitor data in the background. Results will appear automatically."}
                    </p>
                  </div>
                )}

              {isProjectLoading ? (
                /* Skeleton table — same 10 columns as the real one, so the
                   layout doesn't jump when data lands. */
                <div className="overflow-x-auto min-h-[400px]">
                  <table className="w-full text-left border-collapse min-w-[1050px]">
                    <thead>
                      <tr className="border-b border-theme-border text-[13px] tracking-wide text-theme-text-muted bg-theme-bg/20">
                        <th className="px-6 py-4 font-semibold">Competitors</th>
                        <th className="px-4 py-4 font-semibold text-center">
                          Monitoring Status
                        </th>
                        <th className="px-5 py-4 font-semibold">Avg Impression</th>
                        <th className="px-5 py-4 font-semibold">Popularity %</th>
                        <th className="px-5 py-4 font-semibold">Total Ads</th>
                        <th className="px-3 py-4 font-semibold">
                          Recent Activity
                        </th>
                        <th className="px-5 py-4 font-semibold">Platforms</th>
                        <th className="px-5 py-4 font-semibold">Top Country</th>
                        <th className="px-5 py-4 font-semibold">Estimated Total Ad Budget($)</th>
                        <th className="px-5 py-4 font-semibold text-center">
                          Comparison
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <CompetitorRowSkeleton key={i} />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[1050px]">
                    <thead className="sticky top-0 z-10 bg-theme-bg">
                      <tr className="border-b border-theme-border text-[13px] tracking-wide text-theme-text-muted bg-theme-bg/20">
                        <th className="px-6 py-4 font-semibold">Competitors</th>
                        <th className="px-4 py-4 font-semibold text-center">
                          Monitoring Status
                        </th>
                        <th className="px-5 py-4 font-semibold">Avg Impression</th>
                        <th className="px-5 py-4 font-semibold">Popularity %</th>
                        <th className="px-5 py-4 font-semibold">Total Ads</th>
                        <th className="px-3 py-4 font-semibold">
                          Recent Activity
                        </th>
                        <th className="px-5 py-4 font-semibold">
                          Platforms
                        </th>
                        <th className="px-5 py-4 font-semibold">Top Country</th>
                        <th className="px-5 py-4 font-semibold">Estimated Total Ad Budget($)</th>
                        <th className="px-5 py-4 font-semibold text-center">
                          Comparison
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedCompetitors.map((comp) => (
                        <tr
                          key={comp.id}
                          className="border-b border-theme-border hover:bg-theme-bg/30 transition-colors"
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-8 h-8 rounded border flex items-center justify-center overflow-hidden font-bold text-xs transition-all ${getAvatarColor(comp.name)} shadow-[0_0_10px_rgba(99,102,241,0.2)]`}
                              >
                                {getInitials(comp.name)}
                              </div>
                              <div className="flex items-center gap-2 group/copy relative">
                                <span className="font-bold capitalize text-white">
                                  {comp.name}
                                </span>
                                {comp.specificToMatch &&
                                  Object.entries(comp.specificToMatch).map(
                                    ([attr, value]) => (
                                      <span
                                        key={attr}
                                        title={`Matched on ${attr}: ${value}`}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#3762c1]/20 text-[#7899e0] border border-[#3759a3]/40 capitalize"
                                      >
                                        <Globe size={9} />
                                        {value}
                                      </span>
                                    ),
                                  )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigator.clipboard.writeText(comp.name);
                                    setCopiedId(comp.id);
                                    setTimeout(() => setCopiedId(null), 2000);
                                    showToast("Copied to clipboard!");
                                  }}
                                  className="dropdown-trigger opacity-0 group-hover/copy:opacity-100 transition-opacity p-1 hover:bg-white/10 rounded text-theme-text-muted hover:text-[#6b99ff]"
                                >
                                  {copiedId === comp.id ? (
                                    <Check size={14} className="text-green-400" />
                                  ) : (
                                    <Copy size={14} />
                                  )}
                                </button>

                                {/* Tooltip */}
                                {copiedId === comp.id && (
                                  <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1.5 bg-[#1a1a1a] text-white text-[10px] font-bold rounded-lg shadow-xl animate-in fade-in zoom-in-95 duration-200 pointer-events-none z-50 whitespace-nowrap border border-white/10">
                                    Advertiser Copied!
                                    <div className="absolute right-full top-1/2 -translate-y-1/2 -mr-1 w-2 h-2 bg-[#1a1a1a] rotate-45 border-l border-b border-white/10" />
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>

                          <td className="px-4 py-4 text-center">
                            <button
                              onClick={() =>
                                toggleMonitoringStatus(activeProject, comp)
                              }
                              className={`p-1.5 rounded-lg transition-colors ${comp.isMonitored ? "text-[#6b99ff] bg-[#3762c1]/10" : "text-gray-400 bg-gray-500/10 hover:bg-theme-border"}`}
                              title={comp.isMonitored ? "Enabled" : "Disabled"}
                            >
                              {comp.isMonitored ? (
                                <Eye size={16} />
                              ) : (
                                <EyeOff size={16} />
                              )}
                            </button>
                          </td>

                          <td className="px-5 py-4">
                            {comp.statsLoaded === false ? (
                              <CellShimmer className="h-3.5 w-14" />
                            ) : (
                              <div className="flex items-center gap-1.5 font-bold text-white">
                                <Activity size={14} className="text-[#6b99ff]" />
                                {comp.impressions}
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            {comp.statsLoaded === false ? (
                              <CellShimmer className="h-6 w-24" />
                            ) : (
                              <span className="whitespace-nowrap inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                {comp.popularity.split(" ")[0]}{" "}
                                <span className="opacity-70">
                                  {comp.popularity.split(" ")[1]}
                                </span>
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-4 font-semibold text-white">
                            {comp.statsLoaded === false ? (
                              <CellShimmer className="h-3.5 w-12" />
                            ) : (
                              comp.totalAds.toLocaleString()
                            )}
                          </td>

                          <td className="px-3 py-4 text-sm font-semibold">
                            {comp.statsLoaded === false ? (
                              <CellShimmer className="h-3.5 w-20" />
                            ) : (
                            <div className="relative">
                              <button
                                className="dropdown-trigger flex items-center gap-1.5 hover:text-[#7899e0] transition-colors py-1 text-[#6b99ff] whitespace-nowrap"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (openDropdownId === comp.id) {
                                    setOpenDropdownId(null);
                                  } else {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const dropdownHeight = 168;
                                    const spaceBelow = window.innerHeight - rect.bottom;
                                    const top = spaceBelow >= dropdownHeight + 8
                                      ? rect.bottom + 4
                                      : Math.max(8, rect.top - dropdownHeight - 4);
                                    setDropdownPos({ top, left: rect.left });
                                    setOpenDropdownId(comp.id);
                                    setOpenGeoId(null);
                                  }
                                }}
                              >
                                Today: {comp.todayAds}{" "}
                                <ChevronDown
                                  className={`transition-transform duration-200 ${openDropdownId === comp.id ? "rotate-180" : ""}`}
                                  size={14}
                                />
                              </button>
                              {openDropdownId === comp.id && ReactDOM.createPortal(
                                <div
                                  style={{ zIndex: 9999, top: dropdownPos.top, left: dropdownPos.left }}
                                  className="dropdown-portal fixed w-44 bg-theme-bg border border-theme-border rounded-xl shadow-2xl overflow-hidden text-xs font-semibold animate-in fade-in zoom-in-95 duration-200"
                                >
                                  {[
                                    { label: "Today:",      period: "today",     value: comp.todayAds,     border: true },
                                    { label: "Yesterday:",  period: "yesterday", value: comp.yesterdayAds, border: true },
                                    { label: "Last Week:",  period: "last_7",    value: comp.lastWeekAds,  border: true },
                                    { label: "Last Month:", period: "last_30",   value: comp.lastMonthAds, border: false },
                                  ].map((row) => (
                                    <button
                                      key={row.period}
                                      type="button"
                                      title={`View ${comp.name} ads for ${row.label.replace(":", "")}`}
                                      className={`w-full px-4 py-2.5 flex justify-between items-center text-left hover:bg-white/5 transition-colors ${row.border ? "border-b border-theme-border" : ""}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenDropdownId(null);
                                        markReturnToAnalytics(); onRecentActivityClick?.(comp.name, row.period, comp.platforms);
                                      }}
                                    >
                                      <span className="text-theme-text-muted">{row.label}</span>{" "}
                                      <span className="text-[#6b99ff] text-sm">{row.value}</span>
                                    </button>
                                  ))}
                                </div>,
                                document.body
                              )}
                            </div>
                            )}
                          </td>

                          <td className="px-5 py-4 text-xs font-semibold">
                            {comp.statsLoaded === false ? (
                              <div className="flex gap-1.5">
                                <CellShimmer className="w-5 h-5 rounded-full" />
                                <CellShimmer className="w-5 h-5 rounded-full" />
                                <CellShimmer className="w-5 h-5 rounded-full" />
                              </div>
                            ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {comp.platforms.map((p) =>
                                PLATFORM_ICONS[p] ? (
                                  <img
                                    key={p}
                                    src={PLATFORM_ICONS[p]}
                                    alt={p}
                                    title={`Search ${comp.name} ads on ${p}`}
                                    className="w-5 h-5 object-contain rounded cursor-pointer hover:scale-110 hover:ring-2 hover:ring-white/40 transition-transform rounded-full"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setProjectContext?.({
                                        project_name:        activeProject?.advertiser || activeProject?.name,
                                        competitor_name:     comp.name,
                                        competitor_platform: p,
                                      });
                                      onSearch?.(comp.name, "advertiser", p.toLowerCase());
                                      markReturnToAnalytics();
                                      onNavigateToAds?.();
                                    }}
                                  />
                                ) : (
                                  <span
                                    key={p}
                                    className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-theme-text-secondary cursor-pointer hover:bg-white/10 transition-colors"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setProjectContext?.({
                                        project_name:        activeProject?.advertiser || activeProject?.name,
                                        competitor_name:     comp.name,
                                        competitor_platform: p,
                                      });
                                      onSearch?.(comp.name, "advertiser", p.toLowerCase());
                                      markReturnToAnalytics();
                                      onNavigateToAds?.();
                                    }}
                                  >
                                    {p}
                                  </span>
                                ),
                              )}
                            </div>
                            )}
                          </td>

                          <td className="px-5 py-4 text-xs font-semibold">
                            {comp.statsLoaded === false ? (
                              <CellShimmer className="h-5 w-16" />
                            ) : (
                            <div className="flex items-center gap-1.5 whitespace-nowrap relative">
                              <div
                                className="dropdown-trigger flex -space-x-1.5 cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenGeoId(prev => prev === comp.id ? null : comp.id);
                                  setOpenDropdownId(null);
                                }}
                              >
                                {comp.countries.slice(0, 3).map((c, idx) => {
                                  const info = getCountryInfo(c);
                                  return (
                                    <div
                                      key={c}
                                      className="w-5 h-5 rounded-full border border-theme-border overflow-hidden bg-theme-bg shadow-sm hover:scale-110 hover:ring-2 hover:ring-[#6b99ff]/50 transition-transform"
                                      style={{ zIndex: 10 - idx }}
                                      title={`View ${comp.name} ads in ${info.n}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenGeoId(null);
                                        markReturnToAnalytics(); onCountryClick?.(comp.name, c, comp.platforms);
                                      }}
                                    >
                                      <img
                                        src={`https://flagcdn.com/w20/${info.f}.png`}
                                        alt={info.n}
                                        className="w-full h-full object-cover"
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                              {comp.countries?.length > 0 && <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (openGeoId === comp.id) {
                                    setOpenGeoId(null);
                                  } else {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const dropdownHeight = Math.min(comp.countries.length * 44, 192) + 4;
                                    const spaceBelow = window.innerHeight - rect.top;
                                    const top = spaceBelow >= dropdownHeight + 8
                                      ? rect.top
                                      : Math.max(8, window.innerHeight - dropdownHeight - 8);
                                    setDropdownPos({ top, left: rect.right + 4 });
                                    setOpenGeoId(comp.id);
                                    setOpenDropdownId(null);
                                  }
                                }}
                                className="dropdown-trigger text-theme-text-muted hover:text-white transition-colors ml-0.5 relative"
                              >
                                <ChevronDown
                                  className={`transition-transform duration-200 ${openGeoId === comp.id ? "rotate-180" : ""}`}
                                  size={14}
                                />
                                {openGeoId === comp.id && ReactDOM.createPortal(
                                  <div
                                    style={{ zIndex: 9999, top: dropdownPos.top, left: dropdownPos.left }}
                                    className="dropdown-portal fixed w-48 bg-theme-bg border border-theme-border rounded-xl shadow-xl overflow-hidden font-semibold animate-in fade-in zoom-in-95 duration-200 text-left"
                                  >
                                    <div className="max-h-48 overflow-y-auto custom-scrollbar">
                                      {/* All countries → ads library with every
                                          country of this competitor as filter */}
                                      <button
                                        type="button"
                                        title={`View ${comp.name} ads in all ${comp.countries.length} countries`}
                                        className="w-full px-4 py-2.5 border-b border-theme-border flex items-center gap-3 hover:bg-white/5 transition-colors text-left"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setOpenGeoId(null);
                                          markReturnToAnalytics(); onCountryClick?.(comp.name, comp.countries, comp.platforms);
                                        }}
                                      >
                                        <Globe size={16} className="text-[#6b99ff] flex-shrink-0" />
                                        <span className="text-[#6b99ff] text-sm font-bold">
                                          All Countries ({comp.countries.length})
                                        </span>
                                      </button>
                                      {comp.countries.map((c) => {
                                        const info = getCountryInfo(c);
                                        return (
                                          <button
                                            type="button"
                                            key={c}
                                            title={`View ${comp.name} ads in ${info.n}`}
                                            className="w-full px-4 py-2.5 border-b border-theme-border flex items-center gap-3 hover:bg-white/5 transition-colors text-left"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setOpenGeoId(null);
                                              markReturnToAnalytics(); onCountryClick?.(comp.name, c, comp.platforms);
                                            }}
                                          >
                                            <div className="w-5 rounded-[2px] overflow-hidden shadow-sm">
                                              <img
                                                src={`https://flagcdn.com/w20/${info.f}.png`}
                                                alt={info.n}
                                                className="w-full h-auto object-cover"
                                              />
                                            </div>
                                            <span className="text-white text-sm">{info.n}</span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>,
                                  document.body
                              )}
                              </button>}
                            </div>
                            )}
                          </td>

                          <td className="px-5 py-4 font-semibold text-white">
                            {comp.statsLoaded === false ? (
                              <CellShimmer className="h-3.5 w-16" />
                            ) : (
                              comp.budget
                            )}
                          </td>

                          <td className="px-5 py-4">
                            {(() => {
                              const noAdsToCompare =
                                comp.totalAds === 0 &&
                                (activeProject?.summary?.total_ads_tracked ||
                                  0) === 0;
                              return (
                                <div className="flex items-center justify-center gap-2">
                                  <button
                                    disabled={noAdsToCompare}
                                    onClick={() => {
                                      if (!noAdsToCompare) {
                                        setCompareCompetitor(comp);
                                        setViewState(5);
                                      }
                                    }}
                                    title={
                                      noAdsToCompare
                                        ? "No competitor or advertiser ads available to compare"
                                        : ""
                                    }
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap border ${noAdsToCompare ? "bg-[#3762c1]/5 border-[#3759a3]/10 text-[#6b99ff]/50 cursor-not-allowed" : "bg-[#3762c1]/10 hover:bg-[#3762c1]/20 border-[#3759a3]/20 text-[#6b99ff]"}`}
                                  >
                                    Compare
                                  </button>
                                  <button
                                    onClick={() =>
                                      setCompetitorToDelete({
                                        advertiser: activeProject.advertiser,
                                        competitor: comp,
                                      })
                                    }
                                    title="Delete competitor"
                                    className="p-1.5 rounded-lg text-theme-text-muted hover:text-red-400 hover:bg-red-500/10 border border-theme-border hover:border-red-500/20 transition-all"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {paginatedCompetitors.length === 0 && (
                    <div className="p-24 text-center">
                      {activeProject?.isGenerating || isPreparingCompetitors ? (
                        <div className="flex flex-col items-center gap-6">
                          <div className="relative">
                            <div className="w-20 h-20 border-4 border-[#3759a3]/10 rounded-full animate-pulse"></div>
                            <div className="absolute inset-0 w-20 h-20 border-t-4 border-[#3759a3] rounded-full animate-spin"></div>
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="w-10 h-10 bg-[#3762c1]/10 rounded-full animate-ping"></div>
                            </div>
                          </div>
                          <div className="space-y-3">
                            <h3 className="text-2xl font-bold bg-gradient-to-r from-[#6b99ff] via-purple-400 to-pink-400 bg-clip-text text-transparent animate-gradient-x">
                              AI Analysis in Progress...
                            </h3>
                            <p className="text-theme-text-muted text-lg max-w-md mx-auto">
                              Identifying top competitors for{" "}
                              <span className="text-white font-semibold">
                                {activeProject.brand_url ||
                                  activeProject.advertiser}
                              </span>
                              .
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="text-theme-text-muted">
                          No competitors available for this project.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {viewState === 5 && compareCompetitor && activeProject && (
        <CompetitorComparison
          brandName={activeProject.advertiser}
          competitorName={compareCompetitor.name}
          onBack={() => {
            setCompareCompetitor(null);
            setViewState(4);
          }}
        />
      )}

      {projectToDelete && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4 animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-theme-card border border-theme-border rounded-2xl w-full max-w-sm flex flex-col shadow-2xl overflow-hidden shadow-red-500/10 mb-10 text-center p-8 relative">
            <button
              onClick={() => setProjectToDelete(null)}
              className="absolute top-4 right-4 text-theme-text-muted hover:text-theme-text transition-colors p-2 hover:bg-theme-bg rounded-lg"
            >
              <X size={18} />
            </button>
            <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-red-500/20">
              <AlertTriangle size={32} className="text-red-400" />
            </div>
            <h2 className="text-2xl font-bold text-theme-text mb-2">
              Delete Advertiser?
            </h2>
            <p className="text-theme-text-muted text-sm mb-8">
              Are you sure you want to permanently delete{" "}
              <span className="text-theme-text font-bold break-words">
                {capitalizeFirst(projectToDelete.advertiser || projectToDelete.name)}
              </span>{" "}
              and all its tracked intelligence? This cannot be undone.
            </p>
            <div className="flex gap-3 w-full">
              <button
                onClick={() => setProjectToDelete(null)}
                className="flex-1 py-2.5 rounded-xl font-bold bg-theme-bg border border-theme-border text-theme-text hover:bg-theme-bg/80 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteProject}
                className="flex-1 py-2.5 rounded-xl font-bold bg-red-600 hover:bg-red-500 text-white transition-colors shadow-lg shadow-red-500/20"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      {competitorToDelete && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4 animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-theme-card border border-theme-border rounded-2xl w-full max-w-sm flex flex-col shadow-2xl overflow-hidden shadow-red-500/10 relative">
            {/* Soft red glow header */}
            <div className="relative flex flex-col items-center pt-8 pb-5 px-8 bg-gradient-to-b from-red-500/10 to-transparent">
              <button
                onClick={() => setCompetitorToDelete(null)}
                className="absolute top-4 right-4 text-theme-text-muted hover:text-white transition-colors p-2 hover:bg-theme-bg rounded-lg"
              >
                <X size={18} />
              </button>
              <div className="w-14 h-14 bg-red-500/10 rounded-2xl flex items-center justify-center mb-4 border border-red-500/20 ring-4 ring-red-500/5">
                <Trash2 size={26} className="text-red-400" />
              </div>
              <h2 className="text-xl font-bold text-theme-text">
                Delete Competitor?
              </h2>
            </div>

            <div className="px-8 pb-8">
              {/* Highlighted competitor identity block */}
              <div className="flex items-center gap-3 bg-theme-bg border border-theme-border rounded-xl px-4 py-3 mb-5">
                <div
                  className={`w-9 h-9 rounded-lg border flex items-center justify-center font-bold text-sm flex-shrink-0 ${getAvatarColor(
                    competitorToDelete.competitor?.name || "?",
                  )}`}
                >
                  {getInitials(competitorToDelete.competitor?.name)}
                </div>
                <span className="font-bold capitalize text-theme-text truncate">
                  {competitorToDelete.competitor?.name || "this competitor"}
                </span>
              </div>

              <p className="text-theme-text-muted text-sm text-center mb-6 leading-relaxed">
                This will remove it from your competitor list.
              </p>

              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setCompetitorToDelete(null)}
                  disabled={isDeletingCompetitor}
                  className="flex-1 py-2.5 rounded-xl font-bold bg-theme-bg border border-theme-border text-theme-text hover:bg-theme-bg/80 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteCompetitor}
                  disabled={isDeletingCompetitor}
                  className="flex-1 py-2.5 rounded-xl font-bold bg-red-600 hover:bg-red-500 text-white transition-colors shadow-lg shadow-red-500/20 flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {isDeletingCompetitor ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 size={16} /> Delete
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showAddCompetitorModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4 animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-theme-card border border-theme-border rounded-2xl w-full max-w-md flex flex-col shadow-2xl overflow-hidden relative">
            <button
              onClick={closeAddCompetitorModal}
              disabled={isAddingCompetitor}
              className="absolute top-4 right-4 text-theme-text-muted hover:text-white transition-colors p-2 hover:bg-theme-bg rounded-lg disabled:opacity-50"
            >
              <X size={18} />
            </button>
            <div className="p-8">
              <div className="flex items-center gap-4 mb-5">
                <div className="w-14 h-14 bg-[#3762c1]/10 rounded-2xl flex items-center justify-center border border-[#3759a3]/20 flex-shrink-0">
                  <Plus className="text-[#6b99ff]" size={26} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-theme-text">
                    Add Competitor Manually
                  </h2>
                  <p className="text-theme-text-muted text-sm">
                    Track a competitor of your choice for this brand.
                  </p>
                </div>
              </div>

              {/* Target brand — makes it obvious WHERE the competitor goes */}
              <div className="flex items-center gap-3 bg-theme-bg border border-theme-border rounded-xl px-4 py-3 mb-6">
                <Globe size={16} className="text-[#6b99ff] flex-shrink-0" />
                <span className="text-xs text-theme-text-muted">Adding to brand:</span>
                <span className="font-bold text-theme-text truncate">
                  {capitalizeFirst(activeProject?.advertiser)}
                </span>
              </div>

              <form onSubmit={handleAddManualCompetitor} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-theme-text mb-2">
                    Company Name
                  </label>
                  <input
                    type="text"
                    value={manualCompName}
                    onChange={(e) => setManualCompName(e.target.value)}
                    placeholder="e.g. Walmart"
                    autoFocus
                    disabled={isAddingCompetitor}
                    className="w-full bg-theme-bg border border-theme-border rounded-xl py-3 px-4 text-theme-text focus:outline-none focus:border-[#3759a3] focus:ring-1 focus:ring-[#3759a3]/50 transition-all font-medium disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-theme-text mb-2">
                    Company Website URL{" "}
                    <span className="font-normal text-theme-text-muted">(optional)</span>
                  </label>
                  <div className="relative">
                    <Globe
                      className="absolute left-3.5 top-1/2 -translate-y-1/2 text-theme-text-muted"
                      size={16}
                    />
                    <input
                      type="text"
                      value={manualCompUrl}
                      onChange={(e) => setManualCompUrl(e.target.value)}
                      placeholder="e.g. walmart.com"
                      disabled={isAddingCompetitor}
                      className="w-full bg-theme-bg border border-theme-border rounded-xl py-3 pl-10 pr-4 text-theme-text focus:outline-none focus:border-[#3759a3] focus:ring-1 focus:ring-[#3759a3]/50 transition-all font-medium disabled:opacity-50"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeAddCompetitorModal}
                    disabled={isAddingCompetitor}
                    className="flex-1 py-2.5 rounded-xl font-bold bg-theme-bg border border-theme-border text-theme-text hover:bg-theme-bg/80 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!manualCompName.trim() || isAddingCompetitor}
                    className={`flex-1 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg ${
                      manualCompName.trim() && !isAddingCompetitor
                        ? "bg-[#335296] hover:bg-[#3762c1] text-white shadow-[#3759a3]/25"
                        : "bg-theme-border text-theme-text-muted cursor-not-allowed"
                    }`}
                  >
                    {isAddingCompetitor ? (
                      <>
                        <Loader2 size={16} className="animate-spin" /> Adding...
                      </>
                    ) : (
                      <>
                        <Plus size={16} /> Add
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      {/* ── Rename Brand modal ── */}
      {showRenameBrandModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4 animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-theme-card border border-theme-border rounded-2xl w-full max-w-md flex flex-col shadow-2xl overflow-hidden relative">
            <button
              onClick={closeRenameBrandModal}
              disabled={isRenamingBrand}
              className="absolute top-4 right-4 text-theme-text-muted hover:text-white transition-colors p-2 hover:bg-theme-bg rounded-lg disabled:opacity-50"
            >
              <X size={18} />
            </button>
            <div className="p-8">
              <div className="flex items-center gap-4 mb-5">
                <div className="w-14 h-14 bg-[#3762c1]/10 rounded-2xl flex items-center justify-center border border-[#3759a3]/20 flex-shrink-0">
                  <Edit2 className="text-[#6b99ff]" size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-theme-text">
                    Rename Brand
                  </h2>
                  <p className="text-theme-text-muted text-sm">
                    Competitors and tracked data stay attached to this brand.
                  </p>
                </div>
              </div>

              {/* Current name — so the user always sees what they're renaming */}
              <div className="flex items-center gap-3 bg-theme-bg border border-theme-border rounded-xl px-4 py-3 mb-6">
                <Globe size={16} className="text-[#6b99ff] flex-shrink-0" />
                <span className="text-xs text-theme-text-muted">Current name:</span>
                <span className="font-bold text-theme-text truncate">
                  {capitalizeFirst(activeProject?.advertiser)}
                </span>
              </div>

              <form onSubmit={handleRenameBrand} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-theme-text mb-2">
                    New Brand Name
                  </label>
                  <input
                    type="text"
                    value={renameBrandValue}
                    onChange={(e) => setRenameBrandValue(e.target.value)}
                    placeholder="e.g. walmart"
                    autoFocus
                    disabled={isRenamingBrand}
                    className="w-full bg-theme-bg border border-theme-border rounded-xl py-3 px-4 text-theme-text focus:outline-none focus:border-[#3759a3] focus:ring-1 focus:ring-[#3759a3]/50 transition-all font-medium disabled:opacity-50"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeRenameBrandModal}
                    disabled={isRenamingBrand}
                    className="flex-1 py-2.5 rounded-xl font-bold bg-theme-bg border border-theme-border text-theme-text hover:bg-theme-bg/80 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={
                      !renameBrandValue.trim() ||
                      renameBrandValue.trim().toLowerCase() ===
                        (activeProject?.advertiser || "").toLowerCase() ||
                      isRenamingBrand
                    }
                    className={`flex-1 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg ${
                      renameBrandValue.trim() &&
                      renameBrandValue.trim().toLowerCase() !==
                        (activeProject?.advertiser || "").toLowerCase() &&
                      !isRenamingBrand
                        ? "bg-[#335296] hover:bg-[#3762c1] text-white shadow-[#3759a3]/25"
                        : "bg-theme-border text-theme-text-muted cursor-not-allowed"
                    }`}
                  >
                    {isRenamingBrand ? (
                      <>
                        <Loader2 size={16} className="animate-spin" /> Saving...
                      </>
                    ) : (
                      <>
                        <Check size={16} /> Save
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      {/* Toast Notification */}
      {toast.show && (
        <div
          className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-3 px-6 py-3.5 rounded-2xl shadow-2xl border animate-in slide-in-from-bottom-5 duration-300"
          style={{
            backgroundColor: "var(--color-card)",
            borderColor:
              toast.type === "success"
                ? "rgba(34, 197, 94, 0.3)"
                : "rgba(239, 68, 68, 0.3)",
            color: "var(--color-text)",
          }}
        >
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center text-white ${toast.type === "success" ? "bg-green-500" : "bg-red-500"}`}
          >
            {toast.type === "success" ? (
              <Check size={14} strokeWidth={3} />
            ) : (
              <X size={14} strokeWidth={3} />
            )}
          </div>
          <span className="font-semibold tracking-tight">{toast.message}</span>
        </div>
      )}
    </div>
  );
};

export default AllProjects;
