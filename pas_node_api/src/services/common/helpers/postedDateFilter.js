'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateOnly(value) {
  const match = DATE_ONLY_RE.exec(String(value ?? '').trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);

  // Date.UTC normalizes invalid dates (for example, 2026-02-31), so verify
  // the components before accepting a caller-provided boundary.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;

  return { year, month, day };
}

function dateOnlyFromTimestamp(timestamp) {
  const date = new Date(timestamp);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function shiftDate(date, days) {
  return dateOnlyFromTimestamp(Date.UTC(date.year, date.month - 1, date.day) + days * DAY_MS);
}

function compareDates(left, right) {
  return Date.UTC(left.year, left.month - 1, left.day) -
    Date.UTC(right.year, right.month - 1, right.day);
}

function toTransportRange(start, end) {
  const lower = parseDateOnly(start);
  const upper = parseDateOnly(end);
  if (!lower || !upper || compareDates(lower, upper) > 0) return null;

  return [
    Math.floor(Date.UTC(upper.year, upper.month - 1, upper.day, 23, 59, 59) / 1000),
    Math.floor(Date.UTC(lower.year, lower.month - 1, lower.day, 0, 0, 0) / 1000),
  ];
}

function presetRange(value, now = new Date()) {
  const key = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!key || key === 'na' || key === 'all' || key === 'all_time') return null;

  const today = dateOnlyFromTimestamp(now.getTime());
  let start = today;
  let end = today;

  if (key === 'today') {
    // Defaults already represent the current UTC calendar day.
  } else if (key === 'yesterday') {
    start = end = shiftDate(today, -1);
  } else {
    const lastDays = /^last_(7|14|30|90)_days?$/.exec(key);
    if (lastDays) {
      start = shiftDate(today, -(Number(lastDays[1]) - 1));
    } else if (key === 'this_month') {
      start = { year: today.year, month: today.month, day: 1 };
    } else if (key === 'last_month') {
      const firstThisMonth = { year: today.year, month: today.month, day: 1 };
      end = shiftDate(firstThisMonth, -1);
      start = { year: end.year, month: end.month, day: 1 };
    } else if (key === 'this_year') {
      start = { year: today.year, month: 1, day: 1 };
    } else {
      return null;
    }
  }

  return toTransportRange(
    `${start.year}-${String(start.month).padStart(2, '0')}-${String(start.day).padStart(2, '0')}`,
    `${end.year}-${String(end.month).padStart(2, '0')}-${String(end.day).padStart(2, '0')}`,
  );
}

function activeDateValue(value) {
  if (value == null || value === '') return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized !== 'na' && normalized !== 'all' && normalized !== 'all_time';
  }
  return true;
}

function explicitRange(body, dateKey = 'post_date_btn_sort') {
  // AI custom ranges are carried under the selected date dimension before this
  // boundary converts them to the canonical timestamp pair.
  // A legacy generic dateRange remains a valid custom-range source. Check it
  // after the selected field so a dimension-specific custom range wins, but
  // do not let a dimension preset hide an older custom range.
  const candidates = [body[dateKey], body.dateRange, body.date_range];
  for (const range of candidates) {
    if (Array.isArray(range) && range.length === 2) return range;
    if (typeof range === 'string') {
      const match = range.trim().match(/^(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})$/);
      if (match) return [match[1], match[2]];
    }
    if (range && typeof range === 'object') {
      const candidate = [
        range.startDate ?? range.start_date ?? range.start ?? range.from,
        range.endDate ?? range.end_date ?? range.end ?? range.to,
      ];
      if (candidate.some((value) => value != null && value !== '')) return candidate;
    }
  }

  if (activeDateValue(body.startDate) && activeDateValue(body.endDate)) {
    return [body.startDate, body.endDate];
  }

  return null;
}

function isNumericPair(value) {
  return Array.isArray(value) && value.length === 2 &&
    value.every((entry) => Number.isFinite(Number(entry)));
}

/**
 * Convert AI/date aliases into the existing search-controller contracts.
 *
 * Canonical transport for every supported date dimension is
 * [endUnixSeconds, startUnixSeconds]. The range is inclusive at UTC day
 * boundaries. Invalid or unsupported aliases are left untouched so this
 * boundary cannot turn a malformed request into a query.
 */
function normalizePostedDateFilter(body, now = new Date()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;

  const dateKeys = ['post_date_btn_sort', 'first_seen_btn_sort', 'seen_btn_sort'];
  const activeKeys = dateKeys.filter(key => activeDateValue(body[key]));
  // Legacy callers can still send datePreset/dateRange without a dimension;
  // preserve the historical default of posted date in that case.
  const targetKeys = activeKeys.length ? activeKeys : ['post_date_btn_sort'];
  let normalized = body;
  let changed = false;

  for (const dateKey of targetKeys) {
    const current = body[dateKey];
    if (isNumericPair(current)) continue;

    const custom = explicitRange(body, dateKey);
    const customRange = custom && toTransportRange(custom[0], custom[1]);
    const preset = activeDateValue(current)
      ? current
      : (body.datePreset ?? body.date_preset);
    const normalizedRange = customRange || (activeDateValue(preset) ? presetRange(preset, now) : null);
    if (!normalizedRange) continue;

    normalized = normalized === body ? { ...body } : normalized;
    normalized[dateKey] = normalizedRange;
    changed = true;
  }

  if (!changed) return body;

  for (const key of [
    'datePreset', 'date_preset', 'dateRange', 'date_range',
    'startDate', 'start_date', 'endDate', 'end_date',
  ]) delete normalized[key];
  return normalized;
}

module.exports = {
  normalizePostedDateFilter,
  presetRange,
  toTransportRange,
};
