/**
 * Convert API ecommerce platform labels into the keys used by the logo maps.
 * The API may prefix names that begin with a number (for example `_3DCart`).
 */
export const normalizeEcommercePlatformKey = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
