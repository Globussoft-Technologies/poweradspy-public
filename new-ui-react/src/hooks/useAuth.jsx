import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { fetchPlanAccess, trackEvent } from '../services/api';

const AuthContext = createContext(null);

// Node.js logout route — clears cookie + redirects to aMember logout
const LOGOUT_URL = (import.meta.env.VITE_PAS_API_BASE_URL || '') + '/logout';

// User-specific session state keys — wiped on logout so next login starts fresh.
// Keeps `pas-theme` (user preference) and `clientIP` (non-identifying).
const SESSION_STATE_KEYS = [
  'sdui.filterValues',
  'sdui.activePlatforms',
  'sdui_config_cache',
  'sdui_etag',
  'sdui_cached_at',
  'pas_dashboard_view',
  'pas_dashboard_selected_proj_id',
  // redux-persist UI state — search query, active page, selected platforms, etc.
  // Must be wiped alongside the SDUI filters so an expired session doesn't rehydrate
  // yesterday's UI on the next login.
  'persist:root',
];

export function clearSessionState() {
  SESSION_STATE_KEYS.forEach(k => localStorage.removeItem(k));
  try { sessionStorage.removeItem('guestToDashboard'); } catch {}
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
    // Token is expired/invalid at page load (e.g. user came back the next day without
    // logging out). Wipe auth AND all user-specific session/UI state so the upcoming
    // login redirect starts fresh — mirrors the manual logout() path. Without this,
    // sdui.filterValues + persist:root survive and rehydrate yesterday's filters/search.
    localStorage.removeItem('authToken');
    localStorage.removeItem('authUser');
    clearSessionState();
    return { token: null, user: null };
  }
}

const _initialAuth = bootstrapAuth();

export function AuthProvider({ children }) {
  const [token, setToken] = useState(_initialAuth.token);
  const [user, setUser] = useState(_initialAuth.user);
  const [loading] = useState(false);
  const [planAccess, setPlanAccess] = useState(null);

  // Fetch plan access restrictions once user is authenticated (skip on public/guest routes)
  useEffect(() => {
    const path = window.location.pathname;
    if (!token || path === '/guest-landing' || path.startsWith('/guest/') || path.startsWith('/share/')) return;
    fetchPlanAccess().then(data => {
      if (data) setPlanAccess(data);
    }).catch(() => {});
  }, [token]);

  /**
   * Check if a SDUI filter/document _id is restricted for this user's plan.
   * @param {string} sduiFilterId — the SDUI filter _id or document _id (e.g. 'ad_position_filter', 'cta', 'country_filter')
   * @returns {boolean} true if restricted (user cannot use this filter)
   */
  const isFilterRestricted = useCallback((sduiFilterId) => {
    if (!planAccess?.filters) return false;
    const planAccessId = SDUI_TO_PLAN_ACCESS[sduiFilterId] || sduiFilterId;
    const status = planAccess.filters[planAccessId];
    return status ? !status.enabled : false;
  }, [planAccess]);

  // Returns true when a filter has an explicit plan-access entry (enabled OR disabled).
  // Used by SchemaRenderer to avoid cascading to section-level restrictions when the
  // filter itself has a known, authoritative status.
  const filterHasPlanEntry = useCallback((sduiFilterId) => {
    if (!planAccess?.filters) return false;
    const planAccessId = SDUI_TO_PLAN_ACCESS[sduiFilterId] || sduiFilterId;
    return planAccess.filters[planAccessId] !== undefined;
  }, [planAccess]);

  const logout = () => {
    // Clear all auth data from localStorage
    localStorage.removeItem('authToken');
    localStorage.removeItem('authUser');
    // Wipe user-specific session + UI state (incl. persist:root) so next login starts fresh
    clearSessionState();
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
    <AuthContext.Provider value={{ token, user, isAuthenticated, loading, logout, planAccess, setPlanAccess, isFilterRestricted, filterHasPlanEntry }}>
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
