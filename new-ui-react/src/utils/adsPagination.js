export const ADS_PAGE_SIZE = 9;
export const MAX_EMPTY_PAGE_RECOVERY_STREAK = 3;

/**
 * The backend's `meta.hasMore` is the source of truth for whether more ES
 * matches exist, but a sparse page can still hydrate into zero visible ads
 * after dedup/collapse/filtering. Recover across a few such gaps automatically
 * without letting a permanently empty cursor spin forever.
 */
export function resolvePaginationState({
  guestLimitReached = false,
  metaHasMore,
  pageAdsCount = 0,
  emptyPageStreak = 0,
  page = 0,
  pageSize = ADS_PAGE_SIZE,
} = {}) {
  if (guestLimitReached) {
    return {
      emptyPageStreak: 0,
      hasMore: false,
      shouldAutoAdvance: false,
    };
  }

  if (typeof metaHasMore === "boolean") {
    if (!metaHasMore) {
      return {
        emptyPageStreak: 0,
        hasMore: false,
        shouldAutoAdvance: false,
      };
    }

    if (pageAdsCount > 0) {
      return {
        emptyPageStreak: 0,
        hasMore: true,
        shouldAutoAdvance: false,
      };
    }

    const nextEmptyPageStreak = emptyPageStreak + 1;
    const canRecover =
      page >= 0 && nextEmptyPageStreak <= MAX_EMPTY_PAGE_RECOVERY_STREAK;

    return {
      emptyPageStreak: nextEmptyPageStreak,
      hasMore: canRecover,
      shouldAutoAdvance: canRecover,
    };
  }

  return {
    emptyPageStreak: pageAdsCount > 0 ? 0 : emptyPageStreak,
    hasMore: pageAdsCount >= pageSize,
    shouldAutoAdvance: false,
  };
}
