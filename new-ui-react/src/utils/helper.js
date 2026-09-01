/**
 * Convert API ecommerce platform labels into the keys used by the logo maps.
 * The API may prefix names that begin with a number (for example `_3DCart`).
 */
export const normalizeEcommercePlatformKey = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reduce a crawler date to a whole-day index (days since 1970-01-01), using the
 * calendar date only. The time-of-day is deliberately ignored: the stored
 * `first_seen` / `last_seen` strings are UTC wall-clock with no offset, so
 * parsing them as instants shifts the day across the timezone boundary and
 * inflates the running-days count. Comparing bare dates keeps the number in
 * step with the dates shown in the UI.
 */
const toDayIndex = (value) => {
  if (value == null || value === "") return NaN;

  const normalized = String(value).trim();
  if (!normalized) return NaN;

  // `YYYY-MM-DD` prefix (optionally followed by "T"/space + time + offset).
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, year, month, day] = match;
    return Math.floor(Date.UTC(Number(year), Number(month) - 1, Number(day)) / DAY_MS);
  }

  // Epoch input (number or all-digit string): no wall-clock ambiguity, take the
  // UTC calendar date of that instant.
  if (typeof value === "number" || /^\d{9,13}$/.test(normalized)) {
    const numericValue = Number(normalized);
    const ms = numericValue < 1e10 ? numericValue * 1000 : numericValue;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return NaN;
    return Math.floor(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / DAY_MS,
    );
  }

  return NaN;
};

/**
 * Calculate how long an ad ran using its crawler dates.
 *
 * The post date is the preferred start. When it is absent or is an invalid
 * sentinel date, first seen becomes the start. Same-day ads do not get a
 * default running-days value. Only the calendar date is compared (see
 * {@link toDayIndex}) — the time-of-day is not considered.
 */
export const calculateRunningDays = ({ lastSeen, postDate, firstSeen }) => {
  const end = toDayIndex(lastSeen);
  const postStart = toDayIndex(postDate);
  const firstSeenStart = toDayIndex(firstSeen);
  const hasUsablePostDate = Number.isFinite(postStart) && postStart > 0;
  const start = hasUsablePostDate ? postStart : firstSeenStart;

  if (
    !Number.isFinite(start) ||
    start <= 0 ||
    !Number.isFinite(end) ||
    end < start
  ) {
    return null;
  }

  const difference = end - start;

  return difference > 0 ? difference : null;
};
