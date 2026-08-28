import { describe, expect, it } from "vitest";

import {
  ADS_PAGE_SIZE,
  MAX_EMPTY_PAGE_RECOVERY_STREAK,
  resolvePaginationState,
} from "../../src/utils/adsPagination";

describe("adsPagination", () => {
  it("stops immediately when the guest result limit is reached", () => {
    expect(resolvePaginationState({
      guestLimitReached: true,
      metaHasMore: true,
      pageAdsCount: ADS_PAGE_SIZE,
      emptyPageStreak: 2,
    })).toEqual({
      emptyPageStreak: 0,
      hasMore: false,
      shouldAutoAdvance: false,
    });
  });

  it("keeps scrolling when the backend says more pages exist and ads were returned", () => {
    expect(resolvePaginationState({
      metaHasMore: true,
      pageAdsCount: 5,
      emptyPageStreak: 2,
      page: 4,
    })).toEqual({
      emptyPageStreak: 0,
      hasMore: true,
      shouldAutoAdvance: false,
    });
  });

  it("auto-advances across a sparse empty page while the backend still reports more data", () => {
    expect(resolvePaginationState({
      metaHasMore: true,
      pageAdsCount: 0,
      emptyPageStreak: 0,
      page: 3,
    })).toEqual({
      emptyPageStreak: 1,
      hasMore: true,
      shouldAutoAdvance: true,
    });
  });

  it("caps empty-page recovery to avoid infinite pagination loops", () => {
    expect(resolvePaginationState({
      metaHasMore: true,
      pageAdsCount: 0,
      emptyPageStreak: MAX_EMPTY_PAGE_RECOVERY_STREAK,
      page: 7,
    })).toEqual({
      emptyPageStreak: MAX_EMPTY_PAGE_RECOVERY_STREAK + 1,
      hasMore: false,
      shouldAutoAdvance: false,
    });
  });

  it("falls back to page-size heuristics when older backends omit meta.hasMore", () => {
    expect(resolvePaginationState({
      pageAdsCount: ADS_PAGE_SIZE,
    })).toEqual({
      emptyPageStreak: 0,
      hasMore: true,
      shouldAutoAdvance: false,
    });

    expect(resolvePaginationState({
      pageAdsCount: ADS_PAGE_SIZE - 1,
    })).toEqual({
      emptyPageStreak: 0,
      hasMore: false,
      shouldAutoAdvance: false,
    });
  });
});
