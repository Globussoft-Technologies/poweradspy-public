'use strict';

/**
 * Filter Applicability Helper — SDUI-driven network restriction.
 *
 * Reads the SDUI config to determine which networks each filter applies to.
 * When a user sends a request with a network-specific filter (e.g. `gender`
 * which only applies to Facebook), this helper computes the intersection
 * of applicable networks across all active filters.
 *
 * The search controller uses this to:
 *   1. Skip queries for networks where the user's filters don't apply
 *   2. Avoid misleading meta.total counts (e.g. youtube: 130310 when
 *      gender filter was applied — youtube doesn't even have gender data)
 */

const { getSDUIConfig } = require('../../sdui/services/sduiService');

// All known network slugs — used as the "no restriction" set
const ALL_NETWORKS = [
  'facebook', 'instagram', 'youtube', 'gdn', 'linkedin',
  'native', 'reddit', 'quora', 'pinterest', 'google', 'tiktok', 'admob',
];
const NON_ADMOB_NETWORKS = ALL_NETWORKS.filter(network => network !== 'admob');

/**
 * Maps body parameter keys (used by network search controllers) to
 * SDUI filter identifiers. The frontend's `buildSearchPayload` doesn't
 * always use the SDUI's `query_param` value as the body key, so we keep
 * this explicit mapping.
 *
 * Body keys not listed here either:
 *   - Match an SDUI filter's query_param directly (auto-resolved), OR
 *   - Are not user-driven filters (sort flags, pagination, etc.)
 */
const BODY_TO_SDUI_FILTER_IDS = {
  gender:         ['gender_filter', 'gender_selector'],
  lower_age:      ['age_filter'],
  upper_age:      ['age_filter'],
  call_to_action: ['cta_filter', 'cta'],
  country:        ['country_filter'],
  state:          ['state_filter'],
  city:           ['city_filter'],
  type:           ['ad_type_filter', 'ad_types', 'ad_type'],
  ad_position:    ['ad_position_filter', 'ad_position'],
  ad_sub_position:['ad_sub_position_filter', 'ad_sub_position'],
  adcategory:     ['adcategory', 'category', 'categories'],
  subCategory:    ['subcategory', 'category', 'categories'],
  ecommerce:      ['ecommerce_platform_filter', 'ecommerce', 'ecommerce_filter'],
  source:         ['source_filter', 'source', 'marketing_platform'],
  funnel:         ['funnel_filter', 'funnel'],
  affiliate:      ['affiliate_network_filter', 'affiliate'],
  language:       ['language_filter', 'language'],
  lang:           ['language_filter', 'language'],
  market_platform: ['marketing_platform_filter', 'market_platform'],
  size:           ['image_size_filter', 'image_size'],
  ad_image_size:  ['image_size_filter', 'image_size'],
  sub_network:    ['admob_network_filter', 'sub_network_filter', 'sub_network'],
  source_app:     ['source_app_filter', 'admob_source_app_filter', 'source_app'],
  admobPosterSort:['admob_poster_rank_filter'],
  admob_poster_sort:['admob_poster_rank_filter'],
  verified:       ['verified_filter', 'verified'],
  popularity:     ['popularity_range_filter', 'popularity'],
  likes:          ['likes_range_filter', 'likes'],
  comments:       ['comments_range_filter', 'comments'],
  shares:         ['shares_range_filter', 'shares'],
  impressions:    ['impressions_range_filter', 'impressions'],
  view:           ['views_range_filter', 'view'],
  adBudget:       ['ad_budget_filter', 'adBudget', 'avg_ad_budget'],
  budget:         ['budget'],
};

// Body keys that are NOT filters — sort flags, metadata, pagination, etc.
// These should never restrict network applicability.
const NON_FILTER_BODY_KEYS = new Set([
  'network', 'user_id', 'take', 'skip', 'page', 'page_size', 'order_column', 'order_by',
  'newest_sort', 'running_longest_sort', 'last_seen_sort', 'likes_sort', 'comments_sort',
  'shares_sort', 'hits_sort', 'domain_sort', 'impression_sort', 'popularity_sort',
  'adBudget_sort', 'seen_btn_sort', 'post_date_btn_sort',
  'subscriptionType', 'userSubscription', 'favorite', 'hidden', 'tags', 'version',
  'selected_user', 'discoverer_user_id', 'needle', 'mixdata', 'html', 'html_content',
  'commentdata', 'page_creation', 'ocr', 'image_celebrity', 'image_object', 'image_logo',
  'not_country', 'adDetail_id', 'platform', 'userkeyword', 'country_session',
  'ipBasedCountry', 'exact_search', 'language', 'lang',
  'advertiser', 'domain', 'keyword', // search inputs — applicability handled by search_input filter (usually 'all')
  'track',
]);

// Static network restrictions for filters not driven by SDUI platform_applicability.
// Keys here are body param names; values are the networks that support the filter.
const STATIC_FILTER_NETWORKS = {
  domain_date_btn_sort: ['facebook', 'instagram', 'youtube', 'gdn', 'linkedin', 'native', 'reddit', 'quora', 'pinterest', 'google'],
  // Numeric budget (fb/ig/yt) and categorical budget (tiktok) both supported
  adBudget: ['facebook', 'instagram', 'youtube'],
  // TikTok categorical budget ["Low","Medium","High"] — same platforms as adBudget
  budget:   ['tiktok'],
  // `has_ai_meta` is request-level, while category still remains `all` in the
  // live SDUI config. Keep only the fallbacks still needed at runtime.
  has_ai_meta: NON_ADMOB_NETWORKS,
  adcategory: NON_ADMOB_NETWORKS,
  subCategory: NON_ADMOB_NETWORKS,
  // These fields belong to the isolated AdMob index even if SDUI is unavailable.
  sub_network: ['admob'],
  source_app: ['admob'],
  admobPosterSort: ['admob'],
  admob_poster_sort: ['admob'],
};

// AdMob should not participate in AI/category-driven searches. These filters
// belong to the non-AdMob discovery experience, so when they are active in
// an "all platforms" request we explicitly drop AdMob from the candidate set.

// In-memory cache — SDUI config is rebuilt every minute max
let _cached = null;
let _cachedAt = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

/**
 * Build an index: { bodyKey: [networks...] } from the live SDUI config.
 * Walks every filter document and reads `platform_applicability`.
 * Also builds _optionIndex: { bodyKey: { optionValue: [networks] } } for
 * option-level applicability, so shared groups like `ad_position` can still
 * narrow to the correct network for the selected sub-option.
 */
async function _buildIndex() {
  const config = await getSDUIConfig();
  const index = {}; // bodyKey -> Set<network>
  const optionIndex = {}; // bodyKey -> { normalizedValue -> Set<network> }
  const matrixNetworksByDocument = new Map();

  // The platform matrix is the source of truth for sidebar availability.
  for (const sectionDocs of Object.values(config || {})) {
    if (!Array.isArray(sectionDocs)) continue;
    for (const doc of sectionDocs) {
      for (const filter of (doc.filters || [])) {
        const matrix = filter.platform_filter_matrix;
        if (!matrix || typeof matrix !== 'object') continue;
        for (const [network, documentIds] of Object.entries(matrix)) {
          if (!Array.isArray(documentIds)) continue;
          for (const documentId of documentIds) {
            const key = String(documentId);
            if (!matrixNetworksByDocument.has(key)) matrixNetworksByDocument.set(key, new Set());
            matrixNetworksByDocument.get(key).add(String(network).toLowerCase());
          }
        }
      }
    }
  }

  // Walk all sections (sidebar, navbar, searchbar, etc.)
  for (const sectionDocs of Object.values(config || {})) {
    if (!Array.isArray(sectionDocs)) continue;

    for (const doc of sectionDocs) {
      const filters = doc.filters || [];
      for (const f of filters) {
        const filterId = f._id;
        const queryParam = f.query_param;
        const applicability = f.platform_applicability;

        // Resolve body keys for this filter (multiple possible body keys can map to one SDUI filter)
        const matchingBodyKeys = [];
        for (const [bodyKey, sduiIds] of Object.entries(BODY_TO_SDUI_FILTER_IDS)) {
          if (sduiIds.includes(filterId)) matchingBodyKeys.push(bodyKey);
        }
        // Also map by query_param (if body key matches SDUI's query_param directly)
        if (queryParam && !NON_FILTER_BODY_KEYS.has(queryParam) && !matchingBodyKeys.includes(queryParam)) {
          matchingBodyKeys.push(queryParam);
        }

        if (matchingBodyKeys.length === 0) continue;

        // Resolve applicability → array of networks (or null if "all")
        const matrixNetworks = matrixNetworksByDocument.get(String(doc._id));
        let networks = matrixNetworks ? [...matrixNetworks] : null;
        if (Array.isArray(applicability) && applicability.length > 0) {
          const explicit = applicability.map(p => String(p).toLowerCase());
          networks = networks ? [...new Set([...networks, ...explicit])] : explicit;
        }
        // 'all', missing, or non-array → null (no restriction)

        for (const bk of matchingBodyKeys) {
          if (!index[bk]) index[bk] = new Set(networks || ALL_NETWORKS);
          else if (networks) {
            // Multiple SDUI filters mapping to same body key — union (more permissive)
            networks.forEach(n => index[bk].add(n));
          }
        }

        const optionNetworksFallback = networks || ALL_NETWORKS;
        for (const option of (f.options || [])) {
          const rawOptionValue = option?.value ?? option?._id ?? option?.label;
          const normalizedOptionValue = String(rawOptionValue ?? '').trim().toLowerCase();
          if (!normalizedOptionValue) continue;

          let optionNetworks = optionNetworksFallback;
          const optionApplicability = option?.platform_applicability;
          if (Array.isArray(optionApplicability) && optionApplicability.length > 0) {
            optionNetworks = optionApplicability.map((network) => String(network).toLowerCase());
          } else if (
            optionApplicability &&
            optionApplicability !== 'all' &&
            typeof optionApplicability === 'string'
          ) {
            optionNetworks = [String(optionApplicability).toLowerCase()];
          }

          for (const bk of matchingBodyKeys) {
            optionIndex[bk] ||= {};
            optionIndex[bk][normalizedOptionValue] ||= new Set();
            optionNetworks.forEach((network) => optionIndex[bk][normalizedOptionValue].add(network));
          }
        }
      }
    }
  }

  // Convert sets → arrays
  const out = {};
  for (const [k, v] of Object.entries(index)) out[k] = Array.from(v);
  out._optionIndex = {};
  for (const [bodyKey, values] of Object.entries(optionIndex)) {
    out._optionIndex[bodyKey] = {};
    for (const [optionValue, networks] of Object.entries(values)) {
      out._optionIndex[bodyKey][optionValue] = Array.from(networks);
    }
  }
  return out;
}

/**
 * Get the cached body-key → applicable-networks map.
 * Refreshes from SDUI config every CACHE_TTL_MS.
 */
async function _getIndex() {
  const now = Date.now();
  if (_cached && (now - _cachedAt) < CACHE_TTL_MS) return _cached;
  try {
    _cached = await _buildIndex();
    _cachedAt = now;
  } catch (err) {
    // Fail open — if SDUI is unreadable, don't restrict anything
    if (!_cached) _cached = {};
  }
  return _cached;
}

/**
 * Check if a body value is "active" — i.e. the user actually applied this filter.
 *   - 'NA', '', null, undefined → inactive
 *   - empty arrays → inactive
 *   - everything else → active
 */
function isActiveValue(v) {
  if (v == null) return false;
  if (v === false || v === 0 || v === 'false' || v === 'NA' || v === '') return false;
  if (Array.isArray(v)) {
    if (v.length === 0) return false;
    // All-NA array (e.g. ['NA']) → inactive
    if (v.every(x => x === 'NA' || x === '' || x == null)) return false;
    return true;
  }
  return true;
}

function getActiveValues(value) {
  if (!isActiveValue(value)) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry ?? '').trim().toLowerCase())
      .filter((entry) => entry && entry !== 'na');
  }
  return [String(value ?? '').trim().toLowerCase()].filter((entry) => entry && entry !== 'na');
}

/**
 * Given a request body, return the list of networks where ALL active filters apply.
 * Returns `null` if no filter restricts applicability (= search every network).
 *
 * Logic: for each active body field, look up its applicable networks.
 * Final result = intersection of all those network sets.
 *
 * Failure modes that fall back to `null` (no restriction) instead of breaking:
 *   - No active filters at all
 *   - Active filters all map to "all networks" applicability
 *   - Intersection collapses to empty (conflicting filters) — fall back rather
 *     than blocking every network and returning zero results everywhere
 */
async function getApplicableNetworks(reqBody) {
  if (!reqBody || typeof reqBody !== 'object') return null;

  const index = await _getIndex();
  const optionIndex = index._optionIndex || {};
  let intersection = null;

  for (const [key, value] of Object.entries(reqBody)) {
    if (NON_FILTER_BODY_KEYS.has(key)) continue;
    if (!isActiveValue(value)) continue;

    let allowed = STATIC_FILTER_NETWORKS[key] || index[key];
    const selectedValues = getActiveValues(value);
    const optionAllowed = [];
    for (const selectedValue of selectedValues) {
      const matched = optionIndex[key]?.[selectedValue];
      if (Array.isArray(matched) && matched.length > 0) {
        optionAllowed.push(...matched);
      }
    }
    if (optionAllowed.length > 0) {
      allowed = [...new Set(optionAllowed)];
    }

    if (!allowed) continue; // unknown filter — don't restrict

    // Skip "all networks" applicability — it doesn't narrow anything
    if (allowed.length >= ALL_NETWORKS.length) continue;

    if (intersection === null) {
      intersection = new Set(allowed);
    } else {
      const next = new Set(allowed.filter(n => intersection.has(n)));
      // Don't let intersection collapse to empty — that would block all
      // networks and return zero results. Keep the previous (more permissive)
      // intersection if the new filter would zero it out.
      if (next.size > 0) intersection = next;
    }
  }

  return intersection && intersection.size > 0 ? Array.from(intersection) : null;
}

/**
 * Force-refresh the cache (useful for tests or after SDUI config edits).
 */
function clearCache() {
  _cached = null;
  _cachedAt = 0;
}

module.exports = {
  getApplicableNetworks,
  clearCache,
  ALL_NETWORKS,
};
