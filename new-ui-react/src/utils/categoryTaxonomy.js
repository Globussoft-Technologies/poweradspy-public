/**
 * Category taxonomy helpers.
 *
 * An ad is classified with a SINGLE major category + subcategory (see the
 * backend `newCatInsertion`). But the same subcategory NAME (e.g. "Higher
 * education") can live under multiple major categories (e.g. both "Education"
 * and "Education and Careers"), and the subcategory filter matches on the name.
 * So an ad surfaced by filtering "Education" may carry a stored major category
 * of "Education and Careers". For display we want ALL major categories whose
 * subcategories include the ad's subcategory — not just the one stored on the ad.
 *
 * The authoritative taxonomy is the SDUI `categories` nested_select filter:
 * options = [{ label/value: <category>, children: [{ label/value: <sub> }] }].
 */

/**
 * Locate the `categories` nested_select filter's options anywhere in the SDUI
 * config, regardless of which section (searchbar/navbar/sidebar) holds it.
 * @returns {Array} the options array (possibly empty)
 */
export function findCategoryOptions(config) {
  if (!config || typeof config !== 'object') return [];
  const sections = ['sidebar', 'navbar', 'searchbar', 'filters'];
  for (const key of sections) {
    const groups = config[key];
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const filters = group?.filters || [];
      for (const f of filters) {
        if ((f._id === 'categories' || f.query_param === 'category') && Array.isArray(f.options)) {
          return f.options;
        }
      }
    }
  }
  return [];
}

const norm = (v) => String(v ?? '').trim().toLowerCase();

/** Split a subcategory field (array or comma-separated string) into clean names. */
function toList(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (v == null || v === '') return [];
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Resolve every major category an ad belongs to, given its stored category and
 * subcategory plus the taxonomy options. Returns a deduped array of category
 * names: the stored category first, then any other categories whose children
 * include the ad's subcategory. Falls back to just the stored category when the
 * taxonomy is unavailable or has no match — so it never regresses to empty.
 */
export function resolveAdCategories(storedCategory, subCategory, categoryOptions) {
  const subs = toList(subCategory).map(norm);
  const out = [];
  const seen = new Set();
  const add = (name) => {
    const label = String(name ?? '').trim();
    if (!label || seen.has(norm(label))) return;
    seen.add(norm(label));
    out.push(label);
  };

  // Stored category first (union must "at least" include it).
  toList(storedCategory).forEach(add);

  if (subs.length && Array.isArray(categoryOptions)) {
    for (const opt of categoryOptions) {
      const children = opt?.children || [];
      const hasSub = children.some((c) => subs.includes(norm(c.value)) || subs.includes(norm(c.label)));
      if (hasSub) add(opt.label || opt.value);
    }
  }

  return out;
}
