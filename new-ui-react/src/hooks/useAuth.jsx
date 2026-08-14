import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { fetchPlanAccess, fetchEntitlements, fetchOnboardingStatus, trackEvent } from '../services/api';
import { openModal } from '../store/uiSlice';
import {
  isCapabilityAllowed,
  isCapabilityAllowedOnNetwork,
  isLegacyFilterPlanRestricted,
} from '../utils/planEntitlement';

const AuthContext = createContext(null);
const ONBOARDING_DISMISS_KEY_PREFIX = 'pas_onboarding_dismissed_';

// User-specific session state keys that should disappear immediately on logout.
// These are the bits that must not leak between different users sharing the
// same browser.
const SESSION_STATE_KEYS = [
  'sdui_config_cache',
  'sdui_etag',
  'sdui_cached_at',
  'pas_dashboard_view',
  'pas_dashboard_selected_proj_id',
];

// Filter/UI selections must be cleared on logout so the next user starts fresh.
const FILTER_STATE_KEYS = ['sdui.filterValues', 'sdui.activePlatforms', 'persist:root'];
const FILTER_LOGOUT_TS_KEY = 'pas_filters_logout_at';
const SESSION_STORAGE_KEYS = ['guestToDashboard', 'pendingSearch', 'pendingRedirect'];
const ENV_AUTH_FALLBACK_LOCK_KEY = 'pas_disable_env_auth_fallback';

// A manual logout must leave no browser state behind for the next user. Cookie
// names visible to JavaScript are expired for the current host and every parent
// domain; the httpOnly auth cookie is cleared by the Node /logout route.
function clearBrowserState() {
  try { localStorage.clear(); } catch {}
  try { sessionStorage.clear(); } catch {}

  try {
    const cookieNames = document.cookie
      .split(';')
      .map(cookie => cookie.split('=')[0].trim())
      .filter(Boolean);
    const hostname = window.location.hostname;
    const hostParts = hostname.split('.');
    const domains = new Set(['', hostname, `.${hostname}`]);
    for (let i = 1; i < hostParts.length; i += 1) {
      const parent = hostParts.slice(i).join('.');
      domains.add(parent);
      domains.add(`.${parent}`);
    }
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const paths = new Set(['/']);
    let path = '';
    pathParts.forEach(part => {
      path += `/${part}`;
      paths.add(path);
    });
    const expired = 'expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0';
    cookieNames.forEach(name => {
      paths.forEach(cookiePath => {
        domains.forEach(domain => {
          const domainPart = domain ? `; domain=${domain}` : '';
          document.cookie = `${name}=; ${expired}; path=${cookiePath}${domainPart}`;
        });
      });
    });
  } catch {}
}

function getBlockedEnvAuthToken() {
  try { return localStorage.getItem(ENV_AUTH_FALLBACK_LOCK_KEY) || ''; } catch { return ''; }
}

export function disableEnvAuthFallback(token = import.meta.env.VITE_PAS_API_TOKEN || '') {
  try {
    if (token) {
      localStorage.setItem(ENV_AUTH_FALLBACK_LOCK_KEY, token);
    } else {
      localStorage.removeItem(ENV_AUTH_FALLBACK_LOCK_KEY);
    }
  } catch {}
}

function enableEnvAuthFallback() {
  try { localStorage.removeItem(ENV_AUTH_FALLBACK_LOCK_KEY); } catch {}
}

function isEnvAuthFallbackDisabled() {
  return !!getBlockedEnvAuthToken();
}

export function getOnboardingDismissKey(userId) {
  if (!userId) return '';
  return `${ONBOARDING_DISMISS_KEY_PREFIX}${userId}`;
}

export function dismissOnboardingForUserId(userId) {
  const key = getOnboardingDismissKey(userId);
  if (!key) return;
  try { localStorage.setItem(key, '1'); } catch {}
}

export function clearOnboardingDismissForUserId(userId) {
  const key = getOnboardingDismissKey(userId);
  if (!key) return;
  try { localStorage.removeItem(key); } catch {}
}

export function isOnboardingDismissedForUserId(userId) {
  const key = getOnboardingDismissKey(userId);
  if (!key) return false;
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

function shouldResetOnboardingDismiss(userLike) {
  return userLike?.needsOnboarding !== false;
}

// Called on logout / forced auth expiry. Clear user-specific UI state immediately
// so a different user on the same browser never inherits platform/search/filter
// state from the previous user.
export function markFiltersForExpiry() {
  try {
    SESSION_STATE_KEYS.forEach(k => localStorage.removeItem(k));
    FILTER_STATE_KEYS.forEach(k => localStorage.removeItem(k));
    localStorage.removeItem(FILTER_LOGOUT_TS_KEY);
  } catch {}
  try {
    // Ads Library state is tab-scoped, while these same keys may still exist in
    // localStorage from an older build. Clear both copies on logout/auth expiry.
    FILTER_STATE_KEYS.forEach(k => sessionStorage.removeItem(k));
    SESSION_STORAGE_KEYS.forEach(k => sessionStorage.removeItem(k));
  } catch {}
}

// Clean up any stale logout marker left behind by older builds. No filter
// retention is used now, so the timestamp is only safe to discard.
function expireStaleFilters() {
  try { localStorage.removeItem(FILTER_LOGOUT_TS_KEY); } catch {}
}

// ─── SDUI filter _id / group_id  →  plan_access_config _id ──────────────────
// Maps frontend SDUI filter identifiers to backend plan access restriction IDs.
const SDUI_TO_PLAN_ACCESS = {
  // Sidebar document _id → plan access _id
  cta:                  'call_to_action',
  gender:               'gender',
  age:                  'age',
  country:              'country',
  state:                'state',
  city:                 'city',
  ecommerce_platform:   'ecommerce_platform',
  funnel:               'funnel',
  marketing_platform:   'marketing_platform',
  source:               'traffic_source',
  affiliate_network:    'affiliate_network',
  ad_type:              'ad_type',
  language:             'language',
  lang:                 'language',
  // Sidebar filter _id → plan access _id (with _filter suffix)
  cta_filter:           'call_to_action',
  gender_filter:        'gender',
  age_filter:           'age',
  country_filter:       'country',
  state_filter:         'state',
  city_filter:          'city',
  ecommerce_platform_filter: 'ecommerce_platform',
  funnel_filter:        'funnel',
  marketing_platform_filter: 'marketing_platform',
  source_filter:        'traffic_source',
  affiliate_network_filter: 'affiliate_network',
  ad_type_filter:       'ad_type',
  language_filter:      'language',
  ad_position_filter:   'ad_position',
  // SDUI uses verified_filter while both legacy Plan Access and Plan Control
  // store this feature under `verified`.
  verified_filter:      'verified',
  is_verified:          'verified',
  // Navbar / searchbar
  ad_position:          'ad_position',
  keyword_search:       'keyword_search',
  advertiser_search:    'advertiser_search',
  domain_search:        'domain_search',
  // Image search
  text_in_image:        'text_in_image',
  brand_detection:      'brand_detection',
  object_in_image:      'object_in_image',
  celeb_in_image:       'celeb_in_image',
  html_content:         'html_content',
  // Sort
  likes_sort:               'likes_sort',
  comments_sort:            'comments_sort',
  shares_sort:              'shares_sort',
  impression_sort:          'impression_sort',
  popularity_sort:          'popularity_sort',
  ad_budget_sort:           'ad_budget_sort',
  ad_budget:                'ad_budget_sort',
  adBudget:                 'ad_budget_sort',
  ad_budget_filter:         'ad_budget_sort',
  // TikTok Sidebar Budget is independent from Estimated/Avg Ad Budget.
  sidebar_budget:           'sidebar_budget',
  avg_ad_budget:            'ad_budget_sort',
  budget_filter:            'sidebar_budget',
  image_size_filter:        'image_size',
  imageSize:                'image_size',
  native_network_filter:    'native_network',
  nativeNetwork:            'native_network',
  // Sort by dropdown options
  newest_sort:              'newest_sort',
  ad_running_days_sort:     'ad_running_days_sort',
  domain_reg_sort:          'domain_reg_sort',
  // AdMob Poster Intelligence is temporarily free for every plan. Keep the
  // document and its child sort values on one stable entitlement ID so the
  // SDUI renderer does not treat an unseeded child as restricted.
  admob_poster_intelligence: 'admob_poster_intelligence',
  admob_poster_rank_filter:  'admob_poster_intelligence',
  lead_score:                'admob_poster_intelligence',
  occurrence_count:          'admob_poster_intelligence',
  days_running:              'admob_poster_intelligence',
  sortBy:                   'admob_poster_intelligence',
  // Dates
  post_date:            'post_date',
  last_seen:            'last_seen',
  domain_registration:  'domain_registration',
  page_creation_date:   'page_creation_date',
  // Engagement
  bookmark:             'bookmark',
  // AI
  ai_meta:              'ai_metadata_filters',
  ai_metadata_filters:  'ai_metadata_filters',
  adgpt:                'adgpt_access',
};

const LEGACY_TO_CAPABILITY = {
  keyword_search: 'ads.search.keyword',
  advertiser_search: 'ads.search.advertiser',
  domain_search: 'ads.search.domain',
  country: 'filter.country',
  gender: 'filter.gender',
  age: 'filter.age',
  ad_type: 'filter.ad_type',
  ad_position: 'filter.ad_position',
  call_to_action: 'filter.call_to_action',
  category: 'filter.category',
  language: 'filter.language',
  ad_budget_sort: 'sort.ad_budget',
  affiliate_network: 'filter.affiliate_network',
  ecommerce_platform: 'filter.ecommerce_platform',
  marketing_platform: 'filter.marketing_platform',
  traffic_source: 'filter.traffic_source',
  funnel: 'filter.funnel',
  google_transparency: 'google.transparency.search',
  market_trends: 'intelligence.market_trends',
  keyword_explorer: 'intelligence.keyword_explorer',
  ad_analytics: 'intelligence.competitive',
  project_access: 'projects.access',
};
const capabilityForLegacyId = (id) => LEGACY_TO_CAPABILITY[id] || `legacy.${id}`;
const LEGACY_PLAN_ACCESS_FALLBACK = {
  sidebar_budget: 'ad_budget_sort',
};

// Synchronous auth bootstrap — runs once at module load, BEFORE any React render.
// Resolves ?token= URL param → localStorage → env fallback, so child hooks (useSDUI, etc.)
// always see a valid token on their first API call. Otherwise the first fetch fires
// with a stale token and 401 → handle401 → /logout loop.
function bootstrapAuth() {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token');
  const isFreshLogin = !!urlToken;
  if (urlToken) {
    localStorage.setItem('authToken', urlToken);
    enableEnvAuthFallback();
    window.history.replaceState({}, '', window.location.pathname);
  }

  const storedToken = localStorage.getItem('authToken');
  let token = urlToken || storedToken;
  let isEnvLogin = false;
  if (!token) {
    const envToken = import.meta.env.VITE_PAS_API_TOKEN;
    if (envToken && envToken !== getBlockedEnvAuthToken()) {
      localStorage.setItem('authToken', envToken);
      token = envToken;
      isEnvLogin = true;
    }
  }

  if (!token) return { token: null, user: null };

  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    // Skip expiry check for dev env fallback tokens — they are local-only and don't rotate.
    if (payload.exp && payload.exp * 1000 < Date.now() && !isEnvLogin) {
      throw new Error('Token expired');
    }
    // A session is actually being (re)established here — this is the "next login"
    // moment. Clean up any stale logout marker left by older builds so a future
    // bootstrap starts from a consistent state.
    expireStaleFilters();
    enableEnvAuthFallback();
    if (isFreshLogin && shouldResetOnboardingDismiss(payload)) {
      clearOnboardingDismissForUserId(payload.user_id || payload.id);
    }
    localStorage.setItem('authUser', JSON.stringify(payload));
    if (isFreshLogin || isEnvLogin) {
      trackEvent('loginPage', {
        user_id:  payload.user_id,
        network:  'All',
        name: payload.name || payload.login || payload.username || 'NA',
        email:    payload.email ?? 'NA',
        userType: payload.userSubscriptionType ?? 'NA',
      });
    }
    return { token, user: payload };
  } catch {
    // Token is expired/invalid at page load (e.g. user came back later without
    // logging out). Wipe auth immediately and clear user-specific filters so the
    // next session starts clean.
    localStorage.removeItem('authToken');
    localStorage.removeItem('authUser');
    markFiltersForExpiry();
    disableEnvAuthFallback();
    return { token: null, user: null };
  }
}

const _initialAuth = bootstrapAuth();

export function AuthProvider({ children }) {
  const [token, setToken] = useState(_initialAuth.token);
  const [user, setUser] = useState(_initialAuth.user);
  const [loading] = useState(false);
  const [planAccess, setPlanAccess] = useState(null);
  const [entitlements, setEntitlements] = useState(null);
  const [planAccessResolved, setPlanAccessResolved] = useState(!token);
  const tokenRef = useRef(token);
  const dispatch = useDispatch();

  // Keep React state aligned with the shared browser storage. This lets a
  // logout in one tab clear the other tabs without requiring a refresh.
  useEffect(() => {
    const syncAuthFromStorage = (event) => {
      if (event.storageArea !== localStorage) return;
      // localStorage.clear() emits a StorageEvent whose key is null.
      if (event.key !== null && !['authToken', 'authUser', ENV_AUTH_FALLBACK_LOCK_KEY].includes(event.key)) return;

      const nextToken = localStorage.getItem('authToken');
      if (!nextToken) {
        // sessionStorage belongs to each tab, so a logout in another tab cannot
        // clear this tab's Ads Library state directly. Clear it when the shared
        // authentication removal event arrives instead.
        markFiltersForExpiry();
        tokenRef.current = null;
        setToken(null);
        setUser(null);
        setPlanAccess(null);
        setEntitlements(null);
        setPlanAccessResolved(true);
        return;
      }

      try {
        const rawUser = localStorage.getItem('authUser');
        const nextUser = rawUser ? JSON.parse(rawUser) : JSON.parse(atob(nextToken.split('.')[1]));

        // Opening another tab rewrites authUser during bootstrap even though the
        // authenticated session did not change. Keep this tab's resolved plan
        // access intact; otherwise token remains unchanged, its fetch effect does
        // not rerun, and an already-open Projects page spins indefinitely.
        if (event.key === 'authUser' || event.key === ENV_AUTH_FALLBACK_LOCK_KEY) {
          setUser(nextUser);
          return;
        }

        // A duplicate authToken event must also be harmless. Only a genuinely
        // different token represents a new session that needs fresh access data.
        if (nextToken === tokenRef.current) {
          setUser(nextUser);
          return;
        }

        tokenRef.current = nextToken;
        setToken(nextToken);
        setUser(nextUser);
        setPlanAccess(null);
        setEntitlements(null);
        setPlanAccessResolved(false);
      } catch {
        markFiltersForExpiry();
        tokenRef.current = null;
        setToken(null);
        setUser(null);
        setPlanAccess(null);
        setEntitlements(null);
        setPlanAccessResolved(true);
      }
    };

    window.addEventListener('storage', syncAuthFromStorage);
    return () => window.removeEventListener('storage', syncAuthFromStorage);
  }, []);

  // Fetch plan access restrictions once user is authenticated (skip on public/guest routes)
  useEffect(() => {
    const path = window.location.pathname;
    if (!token || path === '/guest-landing' || path.startsWith('/guest/') || path.startsWith('/share/')) {
      setPlanAccessResolved(true);
      return;
    }
    let active = true;
    setPlanAccessResolved(false);
    Promise.allSettled([fetchPlanAccess(), fetchEntitlements()]).then(([legacy, unified]) => {
      if (!active) return;
      if (legacy.status === 'fulfilled' && legacy.value) setPlanAccess(legacy.value);
      if (unified.status === 'fulfilled' && unified.value) setEntitlements(unified.value);
      setPlanAccessResolved(true);
    });
    return () => { active = false; };
  }, [token]);

  // First-login onboarding popup. Prefer the needsOnboarding flag baked into a
  // FRESH login's JWT (authRoutes.js / amemberAuth.js) — no extra request. But a
  // token already in localStorage from before this feature (or from a session
  // that started before the DB migration ran) won't carry that field, so fall
  // back to a live status check whenever it's missing. This also means it self-
  // corrects: once a stale session hits this once, later loads keep working off
  // the JWT flag as normal logins refresh it.
  useEffect(() => {
    const path = window.location.pathname;
    if (!token || !user) return;
    if (path === '/guest-landing' || path.startsWith('/guest/') || path.startsWith('/share/')) return;
    const userId = user.user_id || user.id;
    if (isOnboardingDismissedForUserId(userId)) return;

    if (user.needsOnboarding === true) {
      fetchOnboardingStatus().then(data => {
        if (data?.needsOnboarding) {
          dispatch(openModal('isOnboardingModalOpen'));
        } else {
          try {
            const raw = localStorage.getItem('authUser');
            if (raw) {
              const parsed = JSON.parse(raw);
              localStorage.setItem('authUser', JSON.stringify({ ...parsed, needsOnboarding: false }));
            }
          } catch {}
        }
      }).catch(() => {});
      return;
    }
    if (user.needsOnboarding === undefined) {
      fetchOnboardingStatus().then(data => {
        if (data?.needsOnboarding) dispatch(openModal('isOnboardingModalOpen'));
      }).catch(() => {});
    }
  }, [token, user, dispatch]);

  /**
   * Check if a SDUI filter/document _id is restricted for this user's plan.
   * @param {string} sduiFilterId — the SDUI filter _id or document _id (e.g. 'ad_position_filter', 'cta', 'country_filter')
   * @returns {boolean} true if restricted (user cannot use this filter)
   */
  const isFilterRestricted = useCallback((sduiFilterId) => {
    if (entitlements?.capabilities) {
      const planAccessId = SDUI_TO_PLAN_ACCESS[sduiFilterId] || sduiFilterId;
      const decision = entitlements.capabilities[capabilityForLegacyId(planAccessId)];
      if (decision) return !decision.allowed;
    }
    if (!planAccess?.filters) return false;
    const planAccessId = SDUI_TO_PLAN_ACCESS[sduiFilterId] || sduiFilterId;
    const fallbackId = LEGACY_PLAN_ACCESS_FALLBACK[planAccessId];
    const status = planAccess.filters[planAccessId] ?? planAccess.filters[fallbackId];
    return isLegacyFilterPlanRestricted(status);
  }, [planAccess, entitlements]);

  // Returns true when a filter has an explicit plan-access entry (enabled OR disabled).
  // Used by SchemaRenderer to avoid cascading to section-level restrictions when the
  // filter itself has a known, authoritative status.
  const filterHasPlanEntry = useCallback((sduiFilterId) => {
    if (entitlements?.capabilities) {
      const planAccessId = SDUI_TO_PLAN_ACCESS[sduiFilterId] || sduiFilterId;
      if (entitlements.capabilities[capabilityForLegacyId(planAccessId)] !== undefined) return true;
    }
    if (!planAccess?.filters) return false;
    const planAccessId = SDUI_TO_PLAN_ACCESS[sduiFilterId] || sduiFilterId;
    const fallbackId = LEGACY_PLAN_ACCESS_FALLBACK[planAccessId];
    return planAccess.filters[planAccessId] !== undefined ||
      (fallbackId !== undefined && planAccess.filters[fallbackId] !== undefined);
  }, [planAccess, entitlements]);

  const getCapabilityDecision = useCallback(
    (capabilityId) => entitlements?.capabilities?.[capabilityId] || null,
    [entitlements],
  );
  const canUseCapability = useCallback(
    (capabilityId) => isCapabilityAllowed(entitlements, capabilityId),
    [entitlements],
  );
  const canUseCapabilityOnNetwork = useCallback((capabilityId, network) => {
    return isCapabilityAllowedOnNetwork(entitlements, capabilityId, network);
  }, [entitlements]);
  const getCapabilityLimit = useCallback(
    (capabilityId, limitName) => getCapabilityDecision(capabilityId)?.limits?.[limitName] ?? null,
    [getCapabilityDecision],
  );

  const logout = () => {
    clearBrowserState();
  };

  const isAuthenticated = !!token && !!user;

  return (
    <AuthContext.Provider value={{ token, user, isAuthenticated, loading, logout, planAccess, setPlanAccess, entitlements, setEntitlements, planAccessResolved, isFilterRestricted, filterHasPlanEntry, canUseCapability, canUseCapabilityOnNetwork, getCapabilityLimit, getCapabilityDecision }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/**
 * Get the current auth token for API calls.
 * Used by api.js instead of hardcoded VITE_PAS_API_TOKEN.
 */
export function getAuthToken() {
  const token = localStorage.getItem('authToken') || '';
  if (token) return token;
  if (isEnvAuthFallbackDisabled()) return '';
  return import.meta.env.VITE_PAS_API_TOKEN || '';
}
