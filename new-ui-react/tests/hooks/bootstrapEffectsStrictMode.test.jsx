import React, { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { notificationSpy, healthSpy } = vi.hoisted(() => ({
  notificationSpy: vi.fn(),
  healthSpy: vi.fn(),
}));

vi.mock('../../src/services/api', () => ({
  fetchNotifications: notificationSpy,
  markNotificationsRead: vi.fn(),
}));

vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 42 } }),
}));

vi.mock('../../src/services/aiSearchService', () => ({
  checkAiSearchHealth: healthSpy,
}));

import { useNotifications } from '../../src/hooks/useNotifications';
import { useAiSearchHealth } from '../../src/hooks/useAiSearchHealth';

const strictWrapper = ({ children }) => <StrictMode>{children}</StrictMode>;

describe('bootstrap effects under StrictMode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    notificationSpy.mockReset().mockResolvedValue({ data: [] });
    healthSpy.mockReset().mockResolvedValue({ ok: true });
  });

  afterEach(() => vi.useRealTimers());

  it('runs the initial notification scan once', async () => {
    renderHook(() => useNotifications(), { wrapper: strictWrapper });
    await act(async () => { await Promise.resolve(); });

    expect(notificationSpy).toHaveBeenCalledTimes(1);
  });

  it('runs the initial AI health check once', async () => {
    renderHook(() => useAiSearchHealth(), { wrapper: strictWrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(healthSpy).toHaveBeenCalledTimes(1);
  });
});

