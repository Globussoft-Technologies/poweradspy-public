/**
 * Call-To-Action parsing.
 *
 * An ad can carry more than one CTA (LinkedIn regularly ships two, e.g.
 * "sign up" + "visit website"). The crawlers pack them into a single string
 * using the PHP-era multi-value separators — `||,` first, then `||` — the same
 * convention `mapAdToCard` already unpacks for carousel media/titles. Rendering
 * that blob straight into a button produces "sign up||,visit website" and a
 * single link, so every consumer that shows a CTA goes through here instead.
 *
 * When each CTA has its own landing page, `destination_url` arrives joined the
 * same way and pairs with the labels by index.
 */

const splitBlob = (value, split) => {
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? "").trim()).filter(Boolean);
  }
  if (typeof value !== "string" || !value.trim()) return [];
  return split(value).map((s) => s.trim()).filter(Boolean);
};

/**
 * Split a CTA blob without deduping. Collapses every separator form down to one
 * before splitting (the same str_replace normalization the insertion pipelines
 * use), so a blob that mixes them still comes apart cleanly.
 */
const splitCtaBlob = (cta) =>
  splitBlob(cta, (s) => s.split("||,").join("|").split("||").join("|").split("|"));

/** Dedup key — matches the Laravel CTA normalization: lowercase, collapse spaces. */
const ctaKey = (label) => label.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * CTA blob → ["sign up", "visit website"]. Single-CTA ads yield one entry.
 * The backend happily stores the same CTA twice ("learn more||,learn more"),
 * so repeats collapse to the first occurrence.
 */
export const ctaLabels = (cta) => {
  const seen = new Set();
  return splitCtaBlob(cta).filter((label) => {
    const key = ctaKey(label);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Destination blob → one entry per CTA landing page. Only the doubled
 * separators split here: a lone `|` is legal inside a query string.
 */
export const destinationUrls = (destinationUrl) =>
  splitBlob(destinationUrl, (s) => s.split("||,").join("||").split("||"));

/** First CTA only — for the native-look previews, which render a single button. */
export const primaryCtaLabel = (cta) => ctaLabels(cta)[0] || "";

/** Human-readable form for read-only surfaces (card badge, PDF export). */
export const ctaLabelText = (cta) => ctaLabels(cta).join(", ");

/** Bare domains stored without a scheme still have to open as absolute URLs. */
export const ctaHref = (url) => {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

/**
 * Pair every CTA label with the URL it should open.
 *
 * - no destination URL   → every button renders disabled
 * - one destination URL  → shared by all CTAs (the common multi-CTA shape)
 * - many                 → paired by index, falling back to the first when the
 *                          counts disagree
 *
 * Pairing happens before duplicate labels collapse, so a repeated CTA keeps the
 * URL that was stored against its first occurrence.
 */
export const parseAdCtas = (ad) => {
  const urls = destinationUrls(ad?.destinationUrl);
  const seen = new Set();
  return splitCtaBlob(ad?.cta)
    .map((label, i) => ({
      label,
      url: urls.length > 1 ? urls[i] || urls[0] : urls[0] || "",
    }))
    .filter(({ label }) => {
      const key = ctaKey(label);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};
