// Matching. Two parts:
//
// buildSnapshot: an immutable, in-memory index of the active blocklist entries.
// Built once per refresh and swapped in whole, so a check never sees a
// half-updated list. Lookups are Map hits (O(1)); no database is touched.
//
// evaluate: runs the rules in order against an extracted payload; the first hit
// wins. A rule can be switched off in config (compliance.blocklist.rules.<flag>).
import { FAMILIES, TYPE_TO_FAMILY } from "./blocklist.constants.js";
import { normalizeByFamily, compactNormalized } from "./blocklist.normalize.js";

// Shortest spelling-proof name that is indexed. A 2-3 letter name would match too
// much once spaces and punctuation are ignored. Config: compliance.blocklist.compactMinLength.
const DEFAULT_COMPACT_MIN_LENGTH = 4;

export function buildSnapshot(rows, options = {}) {
  const byFamily = new Map();
  const minCompact = Number.isInteger(options.compactMinLength) && options.compactMinLength > 0
    ? options.compactMinLength
    : DEFAULT_COMPACT_MIN_LENGTH;
  let count = 0;
  let ignored = 0;

  const put = (family, key, row) => {
    let index = byFamily.get(family);
    if (!index) {
      index = new Map();
      byFamily.set(family, index);
    }
    if (index.has(key)) return false;
    index.set(key, { id: row.id, entryType: row.entry_type });
    return true;
  };

  for (const row of rows || []) {
    const family = TYPE_TO_FAMILY[row?.entry_type];
    const key = family ? normalizeByFamily(family, row.value) : "";
    if (!key) {
      ignored += 1; // unknown type (e.g. image_hash, owned by B2) or an unusable value
      continue;
    }
    if (put(family, key, row)) count += 1;

    if (family === FAMILIES.ADVERTISER) {
      const compact = compactNormalized(key);
      if (compact.length >= minCompact) put(FAMILIES.ADVERTISER_VARIANT, compact, row);
    }
  }
  return { byFamily, count, ignored, builtAt: Date.now() };
}

export const RULES = Object.freeze([
  { name: "adId", flag: "adId", family: FAMILIES.AD_ID, candidates: (x) => x.adIds },
  { name: "advertiser", flag: "advertiser", family: FAMILIES.ADVERTISER, candidates: (x) => x.advertisers },
  // Same advertiser entries, spelling-proof: "twinkling tree" also catches "TwinklingTree".
  // Needs the advertiser rule to be on as well; has its own switch.
  {
    name: "advertiserVariant",
    flag: "advertiserVariant",
    requires: "advertiser",
    family: FAMILIES.ADVERTISER_VARIANT,
    candidates: (x) => x.advertisers.map(compactNormalized),
  },
  { name: "url", flag: "url", family: FAMILIES.URL, candidates: (x) => x.urls },
  { name: "domain", flag: "domain", family: FAMILIES.DOMAIN, candidates: (x) => x.domains },
]);

export function evaluate(extracted, snapshot, enabledRules = {}) {
  for (const rule of RULES) {
    if (enabledRules[rule.flag] === false) continue;
    if (rule.requires && enabledRules[rule.requires] === false) continue;
    const index = snapshot.byFamily.get(rule.family);
    if (!index || index.size === 0) continue;
    for (const key of rule.candidates(extracted)) {
      const entry = index.get(key);
      if (entry) return { rule: rule.name, family: rule.family, key, entry };
    }
  }
  return null;
}
