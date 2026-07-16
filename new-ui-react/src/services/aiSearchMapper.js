// ─── AI Search mapper ─────────────────────────────────────────────────────────
// Translates a DS payload's `args` object into the shapes our search machinery
// actually consumes:
//   - searchQuery / searchIn   (Redux)         ← keyword | advertiser | domain
//   - activePlatforms          (useSDUI)       ← network[]
//   - sortBy                   (useSDUI setter)← order_column + order_by
//   - filterValues             (useSDUI map)   ← everything else, keyed by SDUI _id
//
// Every value is resolved against the LIVE SDUI config's own options (matched on
// option value OR label, normalized) so it survives config changes and unknown
// values degrade gracefully instead of poisoning a widget with a non-existent
// option. Anything we can't resolve is collected in `unmapped` (not applied) —
// the DS fallback ladder is what recovers from a dropped filter, not us.
//
// DS `args` field reference (see PAYLOAD_API_GUIDE.md):
//   keyword | advertiser | domain (mutually exclusive, ALL may be absent for a
//   category-only search), network[], type, country[], adcategory, subCategory,
//   gender, verified, order_column, order_by, call_to_action[] (array),
//   affiliate[], ecommerce[], funnel[], market_platform[], source[],
//   ad_position[], nativeNetwork[], budget[] (low/medium/high),
//   likes|shares|comments|impressions|popularity|ctr|adBudget ([min,max]),
//   lower_age|upper_age (numbers). DS resolves any "except X" phrasing into an
//   explicit include list, so we just resolve whatever list arrives.

// Candidate SDUI _id / query_param aliases per logical field (mirrors the pick()
// alias lists in services/api.js buildSearchPayload so we target the same keys).
const FILTER_IDS = {
  adType: ['ad_type', 'ad_types', 'ad_type_filter'],
  gender: ['gender', 'gender_filter', 'gender_selector'],
  verified: ['verified_filter', 'verified', 'is_verified'],
  categories: ['categories', 'category'],
  subcategory: ['subcategory', 'sub_category'],
  country: ['country_filter', 'country', 'countries'],
  cta: ['cta_filter', 'cta', 'call_to_action'],
  sort: ['sort_by', 'sorting', 'sort'],
  platform: ['platform_selector', 'platforms', 'platform'],
  // Closed-vocabulary multi-selects (DS resolves include/exclude to explicit lists).
  affiliate: ['affiliate_network_filter', 'affiliate', 'affiliate_filter', 'affiliate_network', 'affiliates'],
  ecommerce: ['ecommerce_platform_filter', 'ecommerce', 'ecommerce_filter', 'ecommerce_platform'],
  funnel: ['funnel_filter', 'funnel'],
  market_platform: ['market_platform', 'marketing_platform_filter', 'marketing_platform', 'marketingPlatform'],
  source: ['source', 'source_filter'],
  ad_position: ['ad_position_filter', 'ad_position', 'position'],
  nativeNetwork: ['native_network_filter', 'nativeNetwork', 'native_network'],
  budget: ['budget', 'budget_filter', 'tiktok_budget', 'ad_budget_category'],
  // Numeric range sliders ([min, max]).
  likes: ['likes', 'like', 'likes_range', 'engagement_likes'],
  shares: ['shares', 'share', 'shares_range', 'engagement_shares'],
  comments: ['comments', 'comment', 'comments_range', 'engagement_comments'],
  impressions: ['impressions', 'impression', 'impressions_range', 'engagement_impressions'],
  popularity: ['popularity', 'popularity_score', 'popularity_range'],
  ctr: ['ctr', 'ctr_filter', 'ctr_range'],
  adBudget: ['adBudget', 'ad_budget', 'avg_ad_budget'],
};

// Filters whose widget stores the option LABEL rather than its value (the Country
// combobox uses valueKey:'label' because ads-search matches on the display name —
// see utils/countryFilter.js). Everything else stores option.value.
const LABEL_KEYED_IDS = new Set(['country_filter']);

const MULTI_SELECT_TYPES = new Set([
  'chip_multi_select', 'multi_select', 'combobox', 'nested_select', 'checkbox_group',
]);

// Normalize a value for tolerant matching: lowercase, collapse "_" / whitespace
// to a single space, trim. So "shop_now", "Shop Now", "shop now" all compare equal.
const norm = (v) => String(v ?? '').toLowerCase().replace(/[_\s]+/g, ' ').trim();

// Flatten every filter definition across all config sections.
function allFilters(config) {
  if (!config || typeof config !== 'object') return [];
  const sections = ['searchbar', 'navbar', 'sidebar', 'filters'];
  const out = [];
  for (const key of sections) {
    const docs = config[key];
    if (!Array.isArray(docs)) continue;
    for (const doc of docs) {
      for (const f of doc?.filters || []) out.push(f);
    }
  }
  return out;
}

// Find a filter definition by any of the candidate _ids / query_params.
function findFilter(config, ids) {
  const idSet = new Set(ids);
  return allFilters(config).find(
    (f) => idSet.has(f._id) || (f.query_param && idSet.has(f.query_param))
  ) || null;
}

function isMulti(filter) {
  return MULTI_SELECT_TYPES.has(String(filter?.type || '').toLowerCase());
}

// Recursively collect a filter's options (including nested children).
function collectOptions(filter) {
  const out = [];
  const walk = (opts) => {
    for (const o of opts || []) {
      if (!o) continue;
      out.push(o);
      if (Array.isArray(o.children) && o.children.length) walk(o.children);
    }
  };
  walk(filter?.options);
  return out;
}

// Resolve a raw DS value to the stored key the widget expects (option.value, or
// option.label for label-keyed filters). Returns undefined when no option matches.
function resolveOption(filter, rawValue) {
  const target = norm(rawValue);
  if (!target) return undefined;
  const useLabel = LABEL_KEYED_IDS.has(filter._id);
  const opts = collectOptions(filter);
  const match = opts.find((o) => norm(o.value) === target || norm(o.label) === target);
  if (!match) return undefined;
  return useLabel ? (match.label ?? match.value) : (match.value ?? match.label);
}

// Store one-or-many resolved values under a filter, respecting its arity.
// `rawValues` is always an array of raw DS values.
function applyResolved(filter, rawValues, filterValues, unmapped, fieldLabel) {
  const resolved = [];
  for (const raw of rawValues) {
    const r = resolveOption(filter, raw);
    if (r === undefined) unmapped.push(`${fieldLabel}: ${raw}`);
    else if (!resolved.includes(r)) resolved.push(r);
  }
  if (!resolved.length) return;
  filterValues[filter._id] = isMulti(filter) ? resolved : resolved[0];
}

// order_column (+ order_by) → our semantic sort value. Then we still verify the
// value exists among the sort filter's options before using it.
function mapSortValue(orderColumn) {
  const c = norm(orderColumn);
  if (/post ?date|date|created|newest|recent/.test(c)) return 'newest';
  if (/popular|popularity|likes|engagement|impression/.test(c)) return 'popular';
  if (/running|duration|active|longest/.test(c)) return 'running_longest';
  return null;
}

/**
 * Map a single DS payload's `args` into applicable frontend filter state.
 *
 * @param {object} args   the DS payload's `args` object
 * @param {object} config the live (normalized) SDUI config
 * @returns {{
 *   searchQuery: string,
 *   searchIn: 'keyword'|'advertiser'|'domain'|null,
 *   activePlatforms: string[],
 *   sortBy: string|null,
 *   filterValues: object,      // keyed by SDUI filter _id — ready for setAllFilters
 *   unmapped: string[],        // DS values we couldn't resolve (for logging/telemetry)
 * }}
 */
export function mapArgsToFilters(args = {}, config = {}) {
  const filterValues = {};
  const unmapped = [];
  let searchQuery = '';
  let searchIn = null;
  let activePlatforms = [];
  let sortBy = null;

  const asArray = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

  // ── Search scope + query (mutually exclusive) ──────────────────────────────
  if (args.keyword) { searchQuery = String(args.keyword); searchIn = 'keyword'; }
  else if (args.advertiser) { searchQuery = String(args.advertiser); searchIn = 'advertiser'; }
  else if (args.domain) { searchQuery = String(args.domain); searchIn = 'domain'; }

  // ── network → activePlatforms (resolve against platform_selector options) ──
  const platformFilter = findFilter(config, FILTER_IDS.platform);
  const netValues = asArray(args.network);
  if (netValues.length) {
    for (const raw of netValues) {
      if (platformFilter) {
        const r = resolveOption(platformFilter, raw);
        if (r !== undefined) { if (!activePlatforms.includes(r)) activePlatforms.push(r); continue; }
        unmapped.push(`network: ${raw}`);
      } else {
        // No platform filter in config → trust the DS slug as-is (lowercased).
        const slug = String(raw).toLowerCase();
        if (!activePlatforms.includes(slug)) activePlatforms.push(slug);
      }
    }
  }

  // ── type → ad_type ─────────────────────────────────────────────────────────
  const adTypeFilter = findFilter(config, FILTER_IDS.adType);
  if (args.type != null && args.type !== '') {
    if (adTypeFilter) applyResolved(adTypeFilter, asArray(args.type), filterValues, unmapped, 'type');
    else unmapped.push(`type: ${args.type}`);
  }

  // ── country → country_filter (label-keyed; falls back to the raw name since
  //    ads-search matches on the display name anyway) ─────────────────────────
  const countryFilter = findFilter(config, FILTER_IDS.country);
  const countries = asArray(args.country);
  if (countries.length) {
    if (countryFilter) {
      const resolved = [];
      for (const raw of countries) {
        const r = resolveOption(countryFilter, raw);
        const val = r !== undefined ? r : String(raw); // raw name is still valid downstream
        if (!resolved.includes(val)) resolved.push(val);
      }
      filterValues[countryFilter._id] = isMulti(countryFilter) ? resolved : resolved[0];
    } else {
      unmapped.push(`country: ${countries.join(', ')}`);
    }
  }

  // ── adcategory / subCategory → categories / subcategory (only when they
  //    resolve to real options; DS taxonomy often won't match ours) ───────────
  const categoriesFilter = findFilter(config, FILTER_IDS.categories);
  if (args.adcategory && categoriesFilter) {
    applyResolved(categoriesFilter, [args.adcategory], filterValues, unmapped, 'adcategory');
  } else if (args.adcategory) {
    unmapped.push(`adcategory: ${args.adcategory}`);
  }
  const subcategoryFilter = findFilter(config, FILTER_IDS.subcategory);
  if (args.subCategory && subcategoryFilter) {
    applyResolved(subcategoryFilter, [args.subCategory], filterValues, unmapped, 'subCategory');
  } else if (args.subCategory) {
    unmapped.push(`subCategory: ${args.subCategory}`);
  }

  // ── gender ───────────────────────────────────────────────────────────────
  const genderFilter = findFilter(config, FILTER_IDS.gender);
  if (args.gender != null && args.gender !== '') {
    if (genderFilter) applyResolved(genderFilter, [args.gender], filterValues, unmapped, 'gender');
    else unmapped.push(`gender: ${args.gender}`);
  }

  // ── verified ("1") — toggle-style; store true when the filter exists ───────
  const verifiedFilter = findFilter(config, FILTER_IDS.verified);
  const verifiedOn = args.verified === '1' || args.verified === 1 || args.verified === true;
  if (verifiedOn) {
    if (verifiedFilter) {
      const opts = collectOptions(verifiedFilter);
      const matched = opts.length ? resolveOption(verifiedFilter, '1') : undefined;
      filterValues[verifiedFilter._id] = matched !== undefined ? matched : true;
    } else {
      unmapped.push('verified: 1');
    }
  }

  // ── call_to_action (array, e.g. ["shop now"]) → cta_filter (["shop_now"]) ──
  const ctaFilter = findFilter(config, FILTER_IDS.cta);
  const ctaValues = asArray(args.call_to_action);
  if (ctaValues.length) {
    if (ctaFilter) applyResolved(ctaFilter, ctaValues, filterValues, unmapped, 'call_to_action');
    else unmapped.push(`call_to_action: ${ctaValues.join(', ')}`);
  }

  // ── order_column / order_by → sortBy (verified against sort options) ───────
  if (args.order_column) {
    const semantic = mapSortValue(args.order_column);
    const sortFilter = findFilter(config, FILTER_IDS.sort);
    if (semantic) {
      if (sortFilter) {
        const r = resolveOption(sortFilter, semantic);
        if (r !== undefined) sortBy = r;
        else unmapped.push(`sort: ${args.order_column} ${args.order_by || ''}`.trim());
      } else {
        sortBy = semantic; // no sort filter in config — trust the semantic value
      }
    } else {
      unmapped.push(`sort: ${args.order_column} ${args.order_by || ''}`.trim());
    }
  }

  // ── Closed-vocabulary multi-selects — resolve each value against the widget's
  //    options (DS already resolves any "except X" phrasing to an explicit list). ──
  const MULTI_VOCAB = [
    ['affiliate', FILTER_IDS.affiliate],
    ['ecommerce', FILTER_IDS.ecommerce],
    ['funnel', FILTER_IDS.funnel],
    ['market_platform', FILTER_IDS.market_platform],
    ['source', FILTER_IDS.source],
    ['ad_position', FILTER_IDS.ad_position],
    ['nativeNetwork', FILTER_IDS.nativeNetwork],
    ['budget', FILTER_IDS.budget],
  ];
  for (const [field, ids] of MULTI_VOCAB) {
    const raw = asArray(args[field]);
    if (!raw.length) continue;
    const filter = findFilter(config, ids);
    if (filter) applyResolved(filter, raw, filterValues, unmapped, field);
    else unmapped.push(`${field}: ${raw.join(', ')}`);
  }

  // ── Numeric range sliders ([min, max]) — stored verbatim under the filter _id;
  //    no options to resolve against. ─────────────────────────────────────────
  const RANGES = [
    ['likes', FILTER_IDS.likes],
    ['shares', FILTER_IDS.shares],
    ['comments', FILTER_IDS.comments],
    ['impressions', FILTER_IDS.impressions],
    ['popularity', FILTER_IDS.popularity],
    ['ctr', FILTER_IDS.ctr],
    ['adBudget', FILTER_IDS.adBudget],
  ];
  for (const [field, ids] of RANGES) {
    const raw = args[field];
    if (!Array.isArray(raw) || raw.length !== 2) continue;
    const nums = raw.map(Number);
    if (nums.some((n) => Number.isNaN(n))) { unmapped.push(`${field}: ${raw.join('-')}`); continue; }
    const filter = findFilter(config, ids);
    if (filter) filterValues[filter._id] = nums;
    else unmapped.push(`${field}: ${raw.join('-')}`);
  }

  // ── Continuous age (lower_age/upper_age) — our widget is discrete brackets,
  //    which DS itself confirmed don't filter, so this doesn't round-trip. Leave
  //    it unmapped rather than force a lossy conversion. ─────────────────────────
  if (args.lower_age != null || args.upper_age != null) {
    unmapped.push(`age: ${args.lower_age ?? ''}-${args.upper_age ?? ''}`);
  }

  return { searchQuery, searchIn, activePlatforms, sortBy, filterValues, unmapped };
}
