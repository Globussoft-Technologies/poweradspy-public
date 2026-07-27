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

const toTimestamp = (value) => {
  if (value == null || value === "") return NaN;

  if (typeof value === "number") {
    return value < 1e10 ? value * 1000 : value;
  }

  const normalized = String(value).trim();
  if (!normalized) return NaN;

  if (/^\d{9,13}$/.test(normalized)) {
    const numericValue = Number(normalized);
    return numericValue < 1e10 ? numericValue * 1000 : numericValue;
  }

  return Date.parse(
    normalized.includes("T") ? normalized : normalized.replace(" ", "T"),
  );
};

/**
 * Calculate how long an ad ran using its crawler dates.
 *
 * The post date is the preferred start. When it is absent or is an invalid
 * sentinel date, first seen becomes the start. Same-day ads do not get a
 * default running-days value.
 */
export const calculateRunningDays = ({ lastSeen, postDate, firstSeen }) => {
  const end = toTimestamp(lastSeen);
  const postStart = toTimestamp(postDate);
  const firstSeenStart = toTimestamp(firstSeen);
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

  const difference =
    Math.floor(end / DAY_MS) - Math.floor(start / DAY_MS);

  return difference > 0 ? difference : null;
};
