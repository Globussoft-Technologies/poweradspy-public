import { describe, expect, it } from 'vitest';

import {
  normalizePostedDateFilter,
  toTransportRange,
} from '../../../src/services/common/helpers/postedDateFilter.js';

const NOW = new Date('2026-09-11T12:00:00.000Z');

describe('normalizePostedDateFilter', () => {
  it('normalizes a posted-date preset to an inclusive UTC range', () => {
    const normalized = normalizePostedDateFilter({
      post_date_btn_sort: 'last_30_days',
    }, NOW);

    expect(normalized.post_date_btn_sort).toEqual([
      1789171199,
      1786579200,
    ]);
  });

  it('normalizes first-seen and last-seen dimensions independently', () => {
    const firstSeen = normalizePostedDateFilter({
      first_seen_btn_sort: 'last_7_days',
    }, NOW);
    const lastSeen = normalizePostedDateFilter({
      seen_btn_sort: 'yesterday',
    }, NOW);

    expect(firstSeen.first_seen_btn_sort).toEqual([
      1789171199,
      1788566400,
    ]);
    expect(lastSeen.seen_btn_sort).toEqual([
      1789084799,
      1788998400,
    ]);
  });

  it('normalizes custom ranges under the selected dimension only', () => {
    const normalized = normalizePostedDateFilter({
      first_seen_btn_sort: {
        startDate: '2026-08-01',
        endDate: '2026-09-11',
      },
    }, NOW);

    expect(normalized.first_seen_btn_sort).toEqual(toTransportRange('2026-08-01', '2026-09-11'));
    expect(normalized).not.toHaveProperty('startDate');
    expect(normalized).not.toHaveProperty('endDate');
  });

  it('keeps a legacy custom range when the selected field only contains a preset', () => {
    const normalized = normalizePostedDateFilter({
      post_date_btn_sort: 'last_30_days',
      dateRange: { startDate: '2026-08-01', endDate: '2026-09-11' },
    }, NOW);

    expect(normalized.post_date_btn_sort).toEqual(toTransportRange('2026-08-01', '2026-09-11'));
  });

  it('keeps the legacy dimensionless preset mapped to posted date', () => {
    const normalized = normalizePostedDateFilter({
      datePreset: 'yesterday',
    }, NOW);

    expect(normalized.post_date_btn_sort).toEqual([
      1789084799,
      1788998400,
    ]);
  });
});
