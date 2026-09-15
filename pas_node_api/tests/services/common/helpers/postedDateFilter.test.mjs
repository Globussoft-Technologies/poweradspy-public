import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  normalizePostedDateFilter,
  presetRange,
  toTransportRange,
} = require('../../../../src/services/common/helpers/postedDateFilter');

const now = new Date('2026-09-11T12:00:00.000Z');

describe('postedDateFilter', () => {
  it('resolves last_30_days as an inclusive 30-calendar-day UTC window', () => {
    expect(presetRange('last_30_days', now)).toEqual([
      Date.parse('2026-09-11T23:59:59Z') / 1000,
      Date.parse('2026-08-13T00:00:00Z') / 1000,
    ]);
  });

  it('normalizes datePreset into the existing transport key', () => {
    const input = { network: ['facebook'], datePreset: 'last_30_days' };
    const output = normalizePostedDateFilter(input, now);

    expect(output.post_date_btn_sort).toEqual(presetRange('last_30_days', now));
    expect(output).not.toHaveProperty('datePreset');
    expect(input).toEqual({ network: ['facebook'], datePreset: 'last_30_days' });
  });

  it('normalizes a custom dateRange with inclusive boundaries', () => {
    const output = normalizePostedDateFilter({
      dateRange: { startDate: '2026-08-13', endDate: '2026-09-11' },
    }, now);

    expect(output.post_date_btn_sort).toEqual(toTransportRange('2026-08-13', '2026-09-11'));
    expect(output).not.toHaveProperty('dateRange');
  });

  it('normalizes a custom range carried in the canonical post-date key', () => {
    const output = normalizePostedDateFilter({
      post_date_btn_sort: { startDate: '2026-08-13', endDate: '2026-09-11' },
    }, now);

    expect(output.post_date_btn_sort).toEqual(toTransportRange('2026-08-13', '2026-09-11'));
  });

  it('does not rewrite the canonical numeric pair used by regular filters', () => {
    const input = { post_date_btn_sort: [1790000000, 1780000000] };
    expect(normalizePostedDateFilter(input, now)).toBe(input);
  });

  it('leaves invalid date input untouched instead of creating a broad query', () => {
    const input = { dateRange: { startDate: '2026-02-31', endDate: '2026-03-01' } };
    expect(normalizePostedDateFilter(input, now)).toBe(input);
  });
});
