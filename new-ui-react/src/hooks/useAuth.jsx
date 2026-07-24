import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { fetchPlanAccess, fetchEntitlements, fetchOnboardingStatus, trackEvent } from '../services/api';
import { openModal } from '../store/uiSlice';

const AuthContext = createContext(null);
const ONBOARDING_DISMISS_KEY_PREFIX = 'pas_onboarding_dismissed_';

// Node.js logout route — clears cookie + redirects to aMember logout
const LOGOUT_URL = (import.meta.env.VITE_PAS_API_BASE_URL || '') + '/logout';

// User-specific session state keys. Keeps `pas-theme` (user preference) and
// `clientIP` (non-identifying). Split into two groups on logout:
//  - FILTER_STATE_KEYS (below) are retained for FILTER_RETENTION_MS, then wiped.
//  - everything else here is wiped immediately.
const SESSION_STATE_KEYS = [
  'sdui.filterValues',
  'sdui.activePlatforms',
  'sdui_config_cache',
  'sdui_etag',
  'sdui_cached_at',
  'pas_dashboard_view',
  'pas_dashboard_selected_proj_id',
  // redux-persist UI state — search query, active page, selected platforms, etc.
  'persist:root',
];

// Filter/UI selections should survive a logout for a grace period, not vanish
// or persist forever — kept separate from SESSION_STATE_KEYS above (which are
// wiped immediately).
const FILTER_STATE_KEYS = ['sdui.filterValues', 'sdui.activePlatforms', 'persist:root'];
const FILTER_RETENTION_MS = 24 * 60 * 60 * 1000; // 24h
const FILTER_LOGOUT_TS_KEY = 'pas_filters_logout_at';

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

// Called on logout: leaves filter/UI selections in place but starts a 24h
// retention clock, and immediately wipes everything else session-specific.
// (Requirement: filters persist up to 24h after logout, then reset to default.)
export function markFiltersForExpiry() {
  SESSION_STATE_KEYS.filter(k => !FILTER_STATE_KEYS.includes(k)).forEach(k => localStorage.removeItem(k));
  localStorage.setItem(FILTER_LOGOUT_TS_KEY, String(Date.now()));
  try { sessionStorage.removeItem('guestToDashboard'); } catch {}
}

// Called only when a session is (re)established (see bootstrapAuth's success path):
// if the 24h post-logout retention window has elapsed, clears the saved filters so
// the app loads with default filter settings; otherwise leaves them for this login.
function expireStaleFilters() {
  const loggedOutAt = Number(localStorage.getItem(FILTER_LOGOUT_TS_KEY));
  if (!loggedOutAt) return;
  if (Date.now() - loggedOutAt > FILTER_RETENTION_MS) {
    FILTER_STATE_KEYS.forEach(k => localStorage.removeItem(k));
  }
  localStorage.removeItem(FILTER_LOGOUT_TS_KEY);
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
  // Budget — single 'ad_budget_sort' doc controls all platform budget access (TikTok + FB/IG)
  sidebar_budget:           'ad_budget_sort',
  budget:                   'ad_budget_sort',
  avg_ad_budget:            'ad_budget_sort',
  budget_filter:            'ad_budget_sort',
  // Sort by dropdown options
  newest_sort:              'newest_sort',
  ad_running_days_sort:     'ad_running_days_sort',
  domain_reg_sort:          'domain_reg_sort',
  // Dates
  post_date:            'post_date',
  last_seen:            'last_seen',
  domain_registration:  'domain_registration',
  page_creation_date:   'page_creation_date',
  // Engagement
  bookmark:             'bookmark',
  // AI
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
    window.history.replaceState({}, '', window.location.pathname);
  }

  const storedToken = localStorage.getItem('authToken');
  let token = urlToken || storedToken;
  let isEnvLogin = false;
  if (!token) {
    const envToken = import.meta.env.VITE_PAS_API_TOKEN;
    if (envToken) {
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
    // moment. Resolve any pending post-logout retention window now: keep filters if
    // logout was under 24h ago, otherwise reset them to defaults. Must NOT run on
    // every page load (e.g. the reload the /logout redirect chain itself triggers),
    // or the timestamp gets consumed before the 24h window ever elapses.
    expireStaleFilters();
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
    // logging out). Wipe auth immediately, but only start the filter retention
    // clock — mirrors the manual logout() path, so filters still survive up to
    // 24h from here before resetting to defaults.
    localStorage.removeItem('authToken');
    localStorage.removeItem('authUser');
    markFiltersForExpiry();
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
  const dispatch = useDispatch();

  // Fetch plan access restrictions once user is authenticated (skip on public/guest routes)
  useEffect(() => {
    const path = window.location.pathname;
    if (!token || path === '/guest-landing' || path.startsWith('/guest/') || path.startsWith('/share/')) return;
    Promise.allSettled([fetchPlanAccess(), fetchEntitlements()]).then(([legacy, unified]) => {
      if (legacy.status === 'fulfilled' && legacy.value) setPlanAccess(legacy.value);
      if (unified.status === 'fulfilled' && unified.value) setEntitlements(unified.value);
    });
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
    const status = planAccess.filters[planAccessId];
    return status ? !status.enabled : false;
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
    return planAccess.filters[planAccessId] !== undefined;
  }, [planAccess, entitlements]);

  const getCapabilityDecision = useCallback(
    (capabilityId) => entitlements?.capabilities?.[capabilityId] || null,
    [entitlements],
  );
  const canUseCapability = useCallback(
    (capabilityId) => getCapabilityDecision(capabilityId)?.allowed === true,
    [getCapabilityDecision],
  );
  const canUseCapabilityOnNetwork = useCallback((capabilityId, network) => {
    const decision = getCapabilityDecision(capabilityId);
    if (!decision?.allowed) return false;
    return !network || (decision.allowedNetworks || []).includes(String(network).toLowerCase());
  }, [getCapabilityDecision]);
  const getCapabilityLimit = useCallback(
    (capabilityId, limitName) => getCapabilityDecision(capabilityId)?.limits?.[limitName] ?? null,
    [getCapabilityDecision],
  );

  const logout = () => {
    if (shouldResetOnboardingDismiss(user)) {
      clearOnboardingDismissForUserId(user?.user_id || user?.id);
    }
    // Clear all auth data from localStorage
    localStorage.removeItem('authToken');
    localStorage.removeItem('authUser');
    // Start the 24h filter-retention clock; filters/UI state are only wiped once
    // that window elapses (see expireStaleFilters, run on next app load/login).
    markFiltersForExpiry();
    // Clear cookie from frontend side too (in case server cookie clear fails due to cross-domain)
    document.cookie = 'authToken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/;';
    document.cookie = 'authToken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.poweradspy.com;';
    setToken(null);
    setUser(null);
    // Redirect to Node.js /logout → clears server cookie → aMember /logout
    setTimeout(() => { window.location.href = LOGOUT_URL; }, 50);
  };

  const isAuthenticated = !!token && !!user;

  return (
    <AuthContext.Provider value={{ token, user, isAuthenticated, loading, logout, planAccess, setPlanAccess, entitlements, setEntitlements, isFilterRestricted, filterHasPlanEntry, canUseCapability, canUseCapabilityOnNetwork, getCapabilityLimit, getCapabilityDecision }}>
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
  return localStorage.getItem('authToken') || '';
}
