import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyError,
  getFilterCountBucket,
  getNetworkContext,
  isGa4Enabled,
  resolveAuthenticationState,
  resolveGa4RuntimeEnvironment,
  resolvePlanTier,
  trackAdAction,
  trackAnalyticsPageView,
} from '../../src/utils/googleAnalytics';

describe('trackAdAction', () => {
  afterEach(() => {
    delete window.gtag;
  });

  it('sends the canonical action name as a GA4 event parameter', () => {
    window.gtag = vi.fn();

    expect(trackAdAction('favorite_added', { platform: 'facebook' })).toBe(true);
    expect(window.gtag).toHaveBeenCalledWith('event', 'ad_action', {
      platform: 'facebook',
      action_name: 'favorite_added',
      network: 'facebook',
      auth_state: 'public',
      plan_tier: 'free',
    });
  });

  it('does nothing when gtag is unavailable', () => {
    expect(trackAdAction('hidden')).toBe(false);
  });

  it.each([
    [{ storedToken: 'real-session', envToken: 'fallback', pathname: '/' }, 'authenticated'],
    [{ storedToken: '', envToken: 'fallback', pathname: '/guest/shared-token' }, 'guest'],
    [{ storedToken: '', envToken: 'fallback', pathname: '/share/ad-token' }, 'guest'],
    [{ storedToken: '', envToken: 'fallback', pathname: '/guest-landing' }, 'public'],
    [{ storedToken: 'fallback', envToken: 'fallback', pathname: '/' }, 'public'],
  ])('resolves aggregate authentication state without identity data', (input, expected) => {
    expect(resolveAuthenticationState(input)).toBe(expected);
  });

  it.each([
    [{}, '0'],
    [{ country: ['US'] }, '1_2'],
    [{ a: 1, b: true, c: ['x'] }, '3_5'],
    [{ a: 1, b: 1, c: 1, d: 1, e: 1, f: 1 }, '6_plus'],
  ])('buckets filter counts without exposing filter values', (filters, expected) => {
    expect(getFilterCountBucket(filters)).toBe(expected);
  });

  it('normalizes network scope', () => {
    expect(getNetworkContext([])).toEqual({ network: 'all', network_scope: 'all' });
    expect(getNetworkContext(['Facebook'])).toEqual({ network: 'facebook', network_scope: 'single' });
    expect(getNetworkContext(['tiktok', 'facebook'])).toEqual({ network: 'facebook,tiktok', network_scope: 'multiple' });
  });

  it('allowlists plan tiers and sanitizes errors', () => {
    expect(resolvePlanTier({ userSubscriptionType: 'Pro Annual' })).toBe('pro');
    expect(resolvePlanTier({ userSubscriptionType: 'Customer-specific plan' })).toBe('other');
    expect(classifyError({ status: 503 })).toBe('server_error');
  });
});

describe('trackAnalyticsPageView', () => {
  afterEach(() => {
    delete window.gtag;
    vi.unstubAllEnvs();
  });

  it('rewrites the ID-bearing URL to a clean /{network}/adanalytics page view', () => {
    vi.stubEnv('GOOGLE_GA4_ENABLED', 'local'); // jsdom hostname is localhost
    window.gtag = vi.fn();

    expect(trackAnalyticsPageView('quora')).toBe(true);

    // gtag('set', ...) persists the clean path so every *subsequent* event
    // (from the analytics modal, ad grid, search, ...) stops leaking the ID.
    expect(window.gtag).toHaveBeenCalledWith('set', {
      page_path: '/quora/adanalytics',
      page_location: `${window.location.origin}/quora/adanalytics`,
      page_title: 'Ad Analytics for Quora',
    });
    expect(window.gtag).toHaveBeenCalledWith('event', 'page_view', {
      page_path: '/quora/adanalytics',
      page_location: `${window.location.origin}/quora/adanalytics`,
      page_title: 'Ad Analytics for Quora',
    });
  });

  it('does nothing when gtag is unavailable', () => {
    vi.stubEnv('GOOGLE_GA4_ENABLED', 'local');
    expect(trackAnalyticsPageView('quora')).toBe(false);
  });
});

describe('GA4 environment rollout', () => {
  it.each([
    ['localhost', 'local'],
    ['127.0.0.1', 'local'],
    ['stagingtest.poweradspy.com', 'dev'],
    ['dev.poweradspy.com', 'dev'],
    ['poweradspy.com', 'prod'],
  ])('classifies %s as %s', (hostname, expected) => {
    expect(resolveGa4RuntimeEnvironment(hostname)).toBe(expected);
  });

  it('enables only environments included in the rollout level', () => {
    expect(isGa4Enabled({ rollout: 'local', hostname: 'localhost' })).toBe(true);
    expect(isGa4Enabled({ rollout: 'local', hostname: 'stagingtest.poweradspy.com' })).toBe(false);
    expect(isGa4Enabled({ rollout: 'dev', hostname: 'localhost' })).toBe(true);
    expect(isGa4Enabled({ rollout: 'dev', hostname: 'stagingtest.poweradspy.com' })).toBe(true);
    expect(isGa4Enabled({ rollout: 'dev', hostname: 'poweradspy.com' })).toBe(false);
    expect(isGa4Enabled({ rollout: 'prod', hostname: 'localhost' })).toBe(false);
    expect(isGa4Enabled({ rollout: 'prod', hostname: 'stagingtest.poweradspy.com' })).toBe(false);
    expect(isGa4Enabled({ rollout: 'prod', hostname: 'poweradspy.com' })).toBe(false);
    expect(isGa4Enabled({ rollout: '', hostname: 'localhost' })).toBe(false);
  });
});
