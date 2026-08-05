import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAuthTokenSpy } = vi.hoisted(() => ({
  getAuthTokenSpy: vi.fn(() => 'user-token'),
}));

vi.mock('../../src/hooks/useAuth', () => ({
  getAuthToken: getAuthTokenSpy,
  markFiltersForExpiry: vi.fn(),
}));

const response = (json = {}, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  json: vi.fn().mockResolvedValue(json),
});

let api;
beforeEach(async () => {
  vi.resetModules();
  getAuthTokenSpy.mockReset().mockReturnValue('user-token');
  globalThis.fetch = vi.fn();
  api = await import('../../src/services/api.js');
});

describe('API read coordination', () => {
  it('deduplicates concurrent plan-access reads for the same user and network', async () => {
    globalThis.fetch.mockResolvedValue(response({ data: { planId: 7 } }));

    const [first, second] = await Promise.all([
      api.fetchPlanAccess('facebook'),
      api.fetchPlanAccess('facebook'),
    ]);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it('deduplicates concurrent notification scans', async () => {
    globalThis.fetch.mockResolvedValue(response({ data: [], meta: { unreadCount: 0 } }));

    await Promise.all([api.fetchNotifications(), api.fetchNotifications()]);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('caches hidden state and invalidates only after a successful mutation', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(response({ data: [1], addata: [2], favorite: [3] }))
      .mockResolvedValueOnce(response({ success: true }))
      .mockResolvedValueOnce(response({ data: [1], addata: [2, 4], favorite: [3] }));

    await api.fetchHiddenAndFavourites('facebook');
    await api.fetchHiddenAndFavourites('facebook');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    await api.hideAds({ network: 'facebook', adId: 4, type: 2 });
    const refreshed = await api.fetchHiddenAndFavourites('facebook');

    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(refreshed.hiddenAdIds).toEqual([2, 4]);
  });
});

