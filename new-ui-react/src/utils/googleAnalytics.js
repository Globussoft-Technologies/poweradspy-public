const AD_ACTION_EVENT = 'ad_action';

const ANALYTICS_PLATFORM_TITLES = {
  facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube',
  google: 'Google', gdn: 'GDN', native: 'Native', linkedin: 'LinkedIn',
  reddit: 'Reddit', quora: 'Quora', pinterest: 'Pinterest', tiktok: 'TikTok',
};

const KNOWN_PLAN_TIERS = ['free', 'starter', 'basic', 'standard', 'pro', 'premium', 'enterprise'];

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
  // "prod" is intentionally a complete GA4 kill switch.
  if (normalizedRollout === 'prod') return false;
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

/** Send an aggregate GA page view without changing the application's URL. */
export function trackAnalyticsPageView(network) {
  if (!canTrackWithGa4()) return false;
  const platform = String(network || 'unknown').toLowerCase();
  const pagePath = `/${platform}/adanalytics`;
  window.gtag('event', 'page_view', {
    page_location: `${window.location.origin}${pagePath}`,
    page_path: pagePath,
    page_title: `Ad Analytics for ${ANALYTICS_PLATFORM_TITLES[platform] || platform}`,
  });
  return true;
}
