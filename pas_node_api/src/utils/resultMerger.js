'use strict';

/**
 * Multi-network result merging utilities.
 *
 * Strategy:
 *  1. Round-robin interleave — preserves each network's internal ES ranking.
 *     ES already sorts country-boosted ads first (via ipBasedCountry boost),
 *     so interleaving naturally gives: [fb_country, ig_country, fb_country, ig_country,
 *     ... fb_default, ig_default]. Country-specific results from all networks appear
 *     before any default results — without needing a second ES query.
 *
 *  2. Deduplicate by composite key `network:ad_id` — first occurrence wins.
 */

/**
 * Round-robin interleave arrays from multiple networks.
 *
 * Example:
 *   FB: [a, b, c, d]   IG: [x, y]
 *   → [a, x, b, y, c, d]
 *
 * @param {Array[]} networkArrays - Array of per-network result arrays
 * @returns {Array}
 */
function interleave(networkArrays) {
  if (!networkArrays.length) return [];
  const out = [];
  const maxLen = Math.max(...networkArrays.map(a => a.length));
  for (let i = 0; i < maxLen; i++) {
    for (const arr of networkArrays) {
      if (i < arr.length) out.push(arr[i]);
    }
  }
  return out;
}

/**
 * Remove duplicate ads from a merged list.
 * Key: `network:ad_id` — first occurrence wins (preserves interleave order).
 *
 * @param {Array} ads - Merged (interleaved) ad list, each item must have `.network` and `.ad_id` or `.id`
 * @returns {Array}
 */
function deduplicate(ads) {
  const seen = new Set();
  return ads.filter(ad => {
    const key = `${ad.network ?? ''}:${ad.ad_id ?? ad.id ?? ad.sql_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Merge + deduplicate in one call.
 *
 * @param {Array[]} networkArrays
 * @returns {Array}
 */
function mergeNetworkResults(networkArrays) {
  return deduplicate(interleave(networkArrays));
}

module.exports = { interleave, deduplicate, mergeNetworkResults };
