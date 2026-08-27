const AD_ACTION_EVENT = 'ad_action';

const ANALYTICS_PLATFORM_TITLES = {
  facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube',
  google: 'Google', gdn: 'GDN', native: 'Native', linkedin: 'LinkedIn',
  reddit: 'Reddit', quora: 'Quora', pinterest: 'Pinterest', tiktok: 'TikTok',
};

const KNOWN_PLAN_TIERS = ['free', 'starter', 'basic', 'standard', 'pro', 'premium', 'enterprise'];

// Short, GA4-friendly platform codes used to prefix per-platform ad_action
// event names (e.g. `fb_call_to_action_clicked`, `insta_call_to_action_clicked`).
const PLATFORM_ACTION_PREFIXES = {
  facebook: 'fb', instagram: 'insta', youtube: 'youtube', google: 'google',
  gdn: 'gdn', native: 'native', linkedin: 'linkedin', reddit: 'reddit',
  quora: 'quora', pinterest: 'pinterest', tiktok: 'tiktok',
};

/**
 * Build a per-platform GA4 action_name, e.g. `fb_call_to_action_clicked` for
 * Facebook or `youtube_call_to_action_clicked` for YouTube. Falls back to the
 * raw platform string for networks without a known short code.
 */
export function getCallToActionEventName(platform) {
  const key = String(platform || '').trim().toLowerCase();
  const prefix = PLATFORM_ACTION_PREFIXES[key] || key || 'unknown';
  return `${prefix}_call_to_action_clicked`;
}

// Guest/share links carry an opaque access token as the second path segment
// (e.g. /guest/6f93d3826ebc2327180eaa156aa4e150). Swap it for a fixed, human
// -readable label before it ever reaches GA4.
const GUEST_ROUTE_LABELS = { guest: 'GuestPage', share: 'LandingPage' };
const GUEST_ROUTE_TITLES = { guest: 'Guest Page', share: 'Shared Landing Page' };

export function resolveGa4RuntimeEnvironment(hostname = typeof window !== 'undefined'
  ? window.location.hostname
  : '') {
  const normalizedHostname = String(hostname || '').trim().toLowerCase();
  if (['localhost', '127.0.0.1', '::1'].includes(normalizedHostname)) return 'local';
  if (['dev', 'staging', 'test', 'qa'].some((marker) => normalizedHostname.includes(marker))) {
    return 'dev';
  }
  return 'prod';
}

export function isGa4Enabled({
  rollout = import.meta.env.GOOGLE_GA4_ENABLED || '',
  hostname = typeof window !== 'undefined' ? window.location.hostname : '',
} = {}) {
  const normalizedRollout = String(rollout).trim().toLowerCase();
  const runtimeEnvironment = resolveGa4RuntimeEnvironment(hostname);
  // "prod" enables GA4 for local, development/staging, and production hosts.
  if (normalizedRollout === 'prod') return true;
  if (normalizedRollout === 'dev') return runtimeEnvironment !== 'prod';
  if (normalizedRollout === 'local') return runtimeEnvironment === 'local';
  return false;
}

const canTrackWithGa4 = () => isGa4Enabled()
  && typeof window !== 'undefined'
  && typeof window.gtag === 'function';

const hasFilterValue = (value) => {
  if (value == null || value === false || value === '' || value === 'NA') return false;
  if (Array.isArray(value)) return value.some(hasFilterValue);
  if (typeof value === 'object') return Object.values(value).some(hasFilterValue);
  return true;
};

export function getFilterCountBucket(filters = {}) {
  const count = Object.values(filters).filter(hasFilterValue).length;
  if (count === 0) return '0';
  if (count <= 2) return '1_2';
  if (count <= 5) return '3_5';
  return '6_plus';
}

export function getNetworkContext(networks = []) {
  const normalized = [...new Set((Array.isArray(networks) ? networks : [networks])
    .map((network) => String(network || '').trim().toLowerCase())
    .filter(Boolean))];
  if (normalized.length === 0 || normalized.includes('all')) {
    return { network: 'all', network_scope: 'all' };
  }
  if (normalized.length === 1) {
    return { network: normalized[0], network_scope: 'single' };
  }
  return { network: normalized.sort().join(','), network_scope: 'multiple' };
}

export function classifyError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  const status = Number(error?.status || error?.response?.status || 0);
  if (/timeout|timed out|abort/.test(message)) return 'timeout';
  if (status >= 500) return 'server_error';
  if (status >= 400) return 'client_error';
  if (/network|fetch|offline|connection/.test(message)) return 'network_error';
  if (/json|parse|invalid|unexpected/.test(message)) return 'invalid_response';
  return 'client_error';
}

export function resolvePlanTier(storedUser) {
  let user = storedUser;
  if (user === undefined && typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem('authUser');
      user = raw ? JSON.parse(raw) : null;
    } catch {
      user = null;
    }
  }
  const rawTier = String(user?.userSubscriptionType || user?.planTier || '').toLowerCase();
  return KNOWN_PLAN_TIERS.find((tier) => rawTier.includes(tier)) || (rawTier ? 'other' : 'free');
}

export function resolveAuthenticationState({
  pathname = typeof window !== 'undefined' ? window.location.pathname : '/',
  storedToken,
  envToken = import.meta.env.VITE_PAS_API_TOKEN || '',
} = {}) {
  let token = storedToken;
  if (token === undefined && typeof window !== 'undefined') {
    try {
      token = window.localStorage.getItem('authToken') || '';
    } catch {
      token = '';
    }
  }

  // The build-time API token is a development/backend fallback, not a visitor
  // login, so it must never classify a visitor as authenticated.
  if (token && token !== envToken) return 'authenticated';

  const firstPathSegment = String(pathname).split('/').filter(Boolean)[0];
  if (firstPathSegment === 'guest' || firstPathSegment === 'share') return 'guest';
  return 'public';
}

/**
 * Send a successfully completed advertisement action to Google Analytics.
 * Calls are safely ignored when gtag is unavailable (for example in tests or
 * when an analytics/content blocker prevents the Google script from loading).
 */
export function trackAdAction(actionName, details = {}) {
  if (!actionName || !canTrackWithGa4()) {
    return false;
  }

  const actionPlatform = String(details.platform || details.network || 'unknown')
    .trim()
    .toLowerCase();

  window.gtag('event', AD_ACTION_EVENT, {
    ...details,
    action_name: actionName,
    network: actionPlatform,
    platform: actionPlatform,
    auth_state: resolveAuthenticationState(),
    plan_tier: resolvePlanTier(),
  });
  return true;
}

export function trackProductEvent(eventName, details = {}) {
  if (!eventName || !canTrackWithGa4()) {
    return false;
  }
  window.gtag('event', eventName, {
    ...details,
    auth_state: resolveAuthenticationState(),
    plan_tier: resolvePlanTier(),
  });
  return true;
}

/**
 * Send an aggregate GA page view without changing the application's URL.
 *
 * The app pushes a real, ID-bearing URL (e.g. /facebook/134052) via
 * history.pushState when an ad opens, so document.location.href — the value
 * GA4 auto-attaches as page_location to *every* event by default — carries
 * that ID from this point on. A one-off `event: page_view` override only
 * fixes the single page_view hit; any event sent right after (trackAdAction,
 * trackProductEvent, ...) would still pick up the live, ID-bearing URL.
 * `gtag('set', ...)` persists instead of firing a hit, so it overrides
 * page_location/page_path for this event *and* every subsequent one, until
 * the next trackAnalyticsPageView() call changes it again.
 */
export function trackAnalyticsPageView(network) {
  if (!canTrackWithGa4()) return false;
  const platform = String(network || 'unknown').toLowerCase();
  const pagePath = `/${platform}/adanalytics`;
  const pageLocation = `${window.location.origin}${pagePath}`;
  const pageTitle = `Ad Analytics for ${ANALYTICS_PLATFORM_TITLES[platform] || platform}`;
  window.gtag('set', { page_path: pagePath, page_location: pageLocation, page_title: pageTitle });
  window.gtag('event', 'page_view', { page_location: pageLocation, page_path: pagePath, page_title: pageTitle });
  return true;
}

/**
 * Same idea as trackAnalyticsPageView(), but for the /guest/{token} and
 * /share/{token} entry routes. Without this, GA4's default page_location
 * (document.location.href) would carry the raw access token into every
 * event fired while the visitor is on that page — search, filters,
 * feature_blocked, etc. — not just an initial page_view hit. Call this once
 * up front so the token never appears; every subsequent event on the page
 * inherits the sanitized page_path/page_location via gtag('set', ...).
 */
export function trackGuestRoutePageView(pathname = typeof window !== 'undefined' ? window.location.pathname : '/') {
  if (!canTrackWithGa4()) return false;
  const routeType = String(pathname).split('/').filter(Boolean)[0];
  const label = GUEST_ROUTE_LABELS[routeType];
  if (!label) return false;
  const pagePath = `/${routeType}/${label}`;
  const pageLocation = `${window.location.origin}${pagePath}`;
  const pageTitle = GUEST_ROUTE_TITLES[routeType];
  window.gtag('set', { page_path: pagePath, page_location: pageLocation, page_title: pageTitle });
  window.gtag('event', 'page_view', { page_location: pageLocation, page_path: pagePath, page_title: pageTitle });
  return true;
}
