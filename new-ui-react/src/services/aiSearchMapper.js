// ─── AI Search mapper ─────────────────────────────────────────────────────────
// Translates a DS payload's `args` object into the shapes our search machinery
// actually consumes:
//   - searchQuery / searchIn   (Redux)         ← keyword | advertiser | domain
//   - activePlatforms          (useSDUI)       ← network[]
//   - sortBy                   (useSDUI setter)← order_column + order_by
//   - exactSearch             (Redux)         ← exact_search
//   - filterValues            (useSDUI map)   ← everything else, keyed by SDUI _id
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
//   datePreset/dateRange (posted-date search),
//   gender, verified, order_column, order_by, call_to_action[] (array),
//   affiliate[], ecommerce[], funnel[], market_platform[], source[],
//   ad_position[], nativeNetwork[], budget[] (low/medium/high),
//   likes|shares|comments|impressions|popularity|ctr|adBudget ([min,max]),
//   lower_age|upper_age (numbers), lang, platform, google_transparency_subnetwork,
//   ad_sub_position, size, and AdMob-specific fields/ranges. DS resolves any
//   "except X" phrasing into an
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
  language: ['language_filter', 'language', 'lang'],
  metaAdsLib: ['meta_ads_lib_filter', 'meta_ads_lib', 'meta_ads_library'],
  googleTransparencyAds: ['google_transparency_ads', 'google_transparency_filter'],
  googleTransparencySubnetwork: ['google_transparency_subnetwork', 'google_transparency_platform'],
  adSubPosition: ['ad_sub_position_filter', 'ad_sub_position', 'adSubPosition'],
  imageSize: ['image_size_filter', 'image_size', 'size'],
  admobNetwork: ['admob_network_filter', 'sub_network_filter', 'sub_network'],
  admobSourceApp: ['admob_source_app_filter', 'source_app_filter', 'source_app'],
  admobPosterSort: ['admob_poster_rank_filter', 'admob_poster_sort', 'admobPosterSort'],
  leadScoreRange: ['admob_lead_score_range', 'leadScoreRange'],
  occurrenceCountRange: ['admob_occurrence_count_range', 'occurrenceCountRange'],
  activeDaysRange: ['admob_active_days_range', 'activeDaysRange'],
  hasAiMeta: ['has_ai_meta', 'hasAiMeta', 'ai_meta'],
  aiAdType: ['ai_ad_type'],
  aiIntent: ['ai_intent'],
  aiHook: ['ai_hook'],
  aiOfferingType: ['ai_offering_type'],
  aiOfferType: ['ai_offer_type'],
  aiColors: ['ai_colors'],
  aiCategoryId: ['ai_category_id'],
  aiSubcategoryId: ['ai_subcategory_id'],
};

// Filters whose widget stores the option LABEL rather than its value (the Country
// combobox uses valueKey:'label' because ads-search matches on the display name —
// see utils/countryFilter.js). Everything else stores option.value.
const LABEL_KEYED_IDS = new Set(['country_filter']);

const PLANNING_DATE_FILTER_KEYS = {
  post_date: 'post_date_btn_sort',
  first_seen: 'first_seen_btn_sort',
  last_seen: 'seen_btn_sort',
};

const MULTI_SELECT_TYPES = new Set([
  'chip_multi_select', 'multi_select', 'combobox', 'nested_select', 'checkbox', 'checkbox_group',
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
      const children = o.children || o.sub_options || [];
      if (Array.isArray(children) && children.length) walk(children);
    }
  };
  walk(filter?.options);
  return out;
}

// Nested category widgets keep the parent marker and leaf values in separate
// state keys. Hydrating both keys makes AI Search behave like a manual tree
// selection, including the checked state and grouped filter chips.
function collectLeafValues(option, result = []) {
  const children = option?.children || option?.sub_options || [];
  if (children.length === 0) {
    const value = option?.value ?? option?.label;
    if (value != null && value !== '') result.push(value);
    return result;
  }
  for (const child of children) collectLeafValues(child, result);
  return result;
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
function applyResolved(filter, rawValues, filterValues, unmapped, fieldLabel, onUnmapped) {
  const resolved = [];
  for (const raw of rawValues) {
    const r = resolveOption(filter, raw);
    if (r === undefined) {
      if (onUnmapped) onUnmapped(fieldLabel, raw, 'value is not present in live SDUI options');
      else unmapped.push(`${fieldLabel}: ${raw}`);
    }
    else if (!resolved.includes(r)) resolved.push(r);
  }
  if (!resolved.length) return;
  filterValues[filter._id] = isMulti(filter) ? resolved : resolved[0];
}

function applyNestedResolved(filter, rawValues, filterValues, unmapped, fieldLabel, onUnmapped) {
  const resolved = [];
  for (const raw of rawValues) {
    const value = resolveOption(filter, raw);
    if (value === undefined) {
      if (onUnmapped) onUnmapped(fieldLabel, raw, 'value is not present in live SDUI options');
      else unmapped.push(`${fieldLabel}: ${raw}`);
    } else if (!resolved.includes(value)) {
      resolved.push(value);
    }
  }
  if (!resolved.length) return;

  const parentKey = filter.parent_filter_id || 'adcategory';
  const childKey = filter.child_filter_id || 'subcategory';
  filterValues[parentKey] = isMulti(filter) ? resolved : resolved[0];

  const leaves = [];
  for (const value of resolved) {
    const parent = (filter.options || []).find(
      (option) => norm(option?.value) === norm(value) || norm(option?.label) === norm(value),
    );
    if (parent?.children?.length || parent?.sub_options?.length) {
      collectLeafValues(parent, leaves);
    }
  }
  if (leaves.length) {
    const existing = Array.isArray(filterValues[childKey])
      ? filterValues[childKey]
      : filterValues[childKey] ? [filterValues[childKey]] : [];
    filterValues[childKey] = [...new Set([...existing, ...leaves])];
  }
}

// DS AI planner fields are part of the stable PAS request contract, and the
// AI modal/chips already read these exact keys directly. When a live SDUI
// filter exists we still resolve against its options, but if a reduced/older
// config omits that filter we preserve the raw contract key so the generated
// AI payload remains visible and executable instead of disappearing in UI state.
function applyStableField(filter, stateKey, rawValues, filterValues, unmapped, fieldLabel, onUnmapped) {
  if (filter) {
    applyResolved(filter, rawValues, filterValues, unmapped, fieldLabel, onUnmapped);
    return;
  }

  const deduped = [];
  for (const raw of rawValues) {
    if (raw == null || raw === '' || raw === 'NA') continue;
    const value = String(raw);
    if (!deduped.includes(value)) deduped.push(value);
  }
  if (!deduped.length) return;
  filterValues[stateKey] = deduped;
}

// order_column (+ order_by) → our semantic sort value. Then we still verify the
// value exists among the sort filter's options before using it.
function mapSortValue(orderColumn) {
  const c = norm(orderColumn);
  if (/post ?date|date|created|newest|recent/.test(c)) return 'newest';
  // Keep metric sorts distinct. Mapping impressions to Popular silently
  // changed the user's requested ordering and sent popularity_sort instead.
  if (/impression/.test(c)) return 'impressions';
  if (/like/.test(c)) return 'likes';
  if (/comment/.test(c)) return 'comments';
  if (/share/.test(c)) return 'shares';
  if (/popular|popularity|engagement/.test(c)) return 'popular';
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
 *   exactSearch: boolean,
 *   filterValues: object,      // keyed by SDUI filter _id — ready for setAllFilters
 *   unmapped: string[],        // DS values we couldn't resolve (for logging/telemetry)
 *   unmappedDetails: object[], // field/value/network/reason diagnostics
 * }}
 */
export function mapArgsToFilters(args = {}, config = {}, planning = null) {
  const filterValues = {};
  const unmapped = [];
  const unmappedDetails = [];
  let searchQuery = '';
  let searchIn = null;
  let activePlatforms = [];
  let sortBy = null;
  // DS uses exact_search to protect explicit advertiser/domain matching. Keep
  // that intent separate from the widget-mapped filters so App.jsx can forward
  // it unchanged through the normal buildSearchPayload() path.
  const exactSearch =
    args.exact_search === 1 ||
    args.exact_search === '1' ||
    args.exact_search === true;

  const asArray = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
  const meaningfulValues = (v) => asArray(v).filter(
    (value) => value != null && value !== '' && String(value).toLowerCase() !== 'na',
  );
  const describeValue = (value) => {
    if (Array.isArray(value)) return value.join(', ');
    if (value && typeof value === 'object') return JSON.stringify(value);
    return String(value ?? '');
  };
  const recordUnmapped = (field, value, reason) => {
    unmapped.push(`${field}: ${describeValue(value)}`);
    unmappedDetails.push({
      field,
      value,
      network: [...activePlatforms],
      reason,
    });
  };
  const hasPlatform = (...platforms) => activePlatforms.some(
    (active) => platforms.includes(String(active).toLowerCase()),
  );
  const hasOnlyPlatforms = (...platforms) => activePlatforms.length > 0 && activePlatforms.every(
    (active) => platforms.includes(String(active).toLowerCase()),
  );

  // ── Search scope + query (mutually exclusive) ──────────────────────────────
  const advertiserValue = args.advertiser ?? args.page ?? args.brand;
  if (args.keyword) { searchQuery = String(args.keyword); searchIn = 'keyword'; }
  else if (advertiserValue) { searchQuery = String(advertiserValue); searchIn = 'advertiser'; }
  else if (args.domain) { searchQuery = String(args.domain); searchIn = 'domain'; }

  // ── network → activePlatforms (resolve against platform_selector options) ──
  const platformFilter = findFilter(config, FILTER_IDS.platform);
  const netValues = asArray(args.network);
  if (netValues.length) {
    for (const raw of netValues) {
      if (platformFilter) {
        const r = resolveOption(platformFilter, raw);
        if (r !== undefined) { if (!activePlatforms.includes(r)) activePlatforms.push(r); continue; }
        recordUnmapped('network', raw, 'network is not present in live SDUI platform options');
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
    if (adTypeFilter) applyResolved(adTypeFilter, asArray(args.type), filterValues, unmapped, 'type', recordUnmapped);
    else recordUnmapped('type', args.type, 'filter is not available in live SDUI');
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
      recordUnmapped('country', countries, 'filter is not available in live SDUI');
    }
  }

  // ── adcategory / subCategory → nested category state (only when they
  //    resolve to real options; DS taxonomy often won't match ours) ───────────
  // Resolve explicit leaves first so parent expansion below merges with them
  // instead of replacing a narrower subcategory selection.
  const subcategoryFilter = findFilter(config, FILTER_IDS.subcategory);
  if (args.subCategory && subcategoryFilter) {
    applyResolved(subcategoryFilter, asArray(args.subCategory), filterValues, unmapped, 'subCategory', recordUnmapped);
  } else if (args.subCategory) {
    recordUnmapped('subCategory', args.subCategory, 'filter is not available in live SDUI');
  }
  const categoriesFilter = findFilter(config, FILTER_IDS.categories);
  if (args.adcategory && categoriesFilter) {
    if (categoriesFilter.type === 'nested_select' || categoriesFilter.type === 'nested_multiselect') {
      applyNestedResolved(categoriesFilter, asArray(args.adcategory), filterValues, unmapped, 'adcategory', recordUnmapped);
    } else {
      applyResolved(categoriesFilter, asArray(args.adcategory), filterValues, unmapped, 'adcategory', recordUnmapped);
    }
  } else if (args.adcategory) {
    recordUnmapped('adcategory', args.adcategory, 'filter is not available in live SDUI');
  }

  // Standard AI Search fields with special request shaping in api.js. Keep
  // these in ordinary SDUI state so visible controls/chips and the final
  // manual-style search request remain synchronized with the AI plan.
  const languageValue = args.lang !== undefined ? args.lang : args.language;
  const languageValues = meaningfulValues(languageValue);
  if (languageValues.length) {
    const languageFilter = findFilter(config, FILTER_IDS.language);
    if (languageFilter) {
      applyResolved(languageFilter, languageValues, filterValues, unmapped, 'lang', recordUnmapped);
    } else {
      recordUnmapped('lang', languageValues, 'language filter is not available in live SDUI');
    }
  }

  const plannerPlatform = Number(args.platform);
  const metaAdsLibRequested = plannerPlatform === 15;
  if (metaAdsLibRequested) {
    const metaAdsFilter = findFilter(config, FILTER_IDS.metaAdsLib);
    if (!hasOnlyPlatforms('facebook', 'instagram')) {
      recordUnmapped('platform', args.platform, 'Meta Ads Library mode requires only Facebook and/or Instagram');
    } else if (metaAdsFilter) {
      filterValues[metaAdsFilter._id] = true;
    } else {
      recordUnmapped('platform', args.platform, 'Meta Ads Library filter is not available in live SDUI');
    }
  }

  const transparencyEnabled =
    args.google_transparency_ads === true ||
    args.google_transparency_ads === 1 ||
    args.google_transparency_ads === '1' ||
    String(args.google_transparency_ads).toLowerCase() === 'true' ||
    plannerPlatform === 18;
  const transparencyFilter = findFilter(config, FILTER_IDS.googleTransparencyAds);
  if (transparencyEnabled) {
    if (!hasOnlyPlatforms('google')) {
      recordUnmapped('google_transparency_ads', true, 'Google Transparency mode requires only the Google network');
    } else if (transparencyFilter) {
      filterValues[transparencyFilter._id] = true;
    } else {
      recordUnmapped('google_transparency_ads', true, 'Google Transparency filter is not available in live SDUI');
    }
  }

  const transparencySubnetworkValues = meaningfulValues(args.google_transparency_subnetwork);
  if (transparencySubnetworkValues.length) {
    const subnetworkFilter = findFilter(config, FILTER_IDS.googleTransparencySubnetwork);
    if (!transparencyEnabled) {
      recordUnmapped(
        'google_transparency_subnetwork',
        transparencySubnetworkValues,
        'subnetwork requires Google Transparency mode to be enabled',
      );
    } else if (!hasOnlyPlatforms('google')) {
      recordUnmapped(
        'google_transparency_subnetwork',
        transparencySubnetworkValues,
        'Google Transparency mode requires only the Google network',
      );
    } else if (subnetworkFilter) {
      applyResolved(
        subnetworkFilter,
        transparencySubnetworkValues.slice(0, 1),
        filterValues,
        unmapped,
        'google_transparency_subnetwork',
        recordUnmapped,
      );
    } else {
      recordUnmapped(
        'google_transparency_subnetwork',
        transparencySubnetworkValues,
        'Google Transparency subnetwork filter is not available in live SDUI',
      );
    }
  }

  const specialCategoricalFields = [
    ['ad_sub_position', FILTER_IDS.adSubPosition, ['google'], 'Google ad sub-position requires only the Google network'],
    ['size', FILTER_IDS.imageSize, ['gdn', 'admob'], 'Image size requires only the GDN and/or AdMob network'],
    ['sub_network', FILTER_IDS.admobNetwork, ['admob'], 'AdMob filter requires the AdMob network'],
    ['source_app', FILTER_IDS.admobSourceApp, ['admob'], 'AdMob filter requires the AdMob network'],
  ];
  for (const [field, ids, supportedNetworks, unsupportedReason] of specialCategoricalFields) {
    const rawValues = meaningfulValues(args[field]);
    if (!rawValues.length) continue;
    const filter = findFilter(config, ids);
    if (!hasOnlyPlatforms(...supportedNetworks)) {
      recordUnmapped(field, rawValues, unsupportedReason);
    } else if (filter) {
      applyResolved(filter, rawValues, filterValues, unmapped, field, recordUnmapped);
    } else {
      recordUnmapped(field, rawValues, 'filter is not available in live SDUI');
    }
  }

  const admobPosterSortValue = args.admobPosterSort ?? args.admob_poster_sort;
  const admobPosterSortValues = meaningfulValues(admobPosterSortValue);
  if (admobPosterSortValues.length) {
    const filter = findFilter(config, FILTER_IDS.admobPosterSort);
    if (!hasPlatform('admob')) {
      recordUnmapped('admobPosterSort', admobPosterSortValues, 'AdMob Poster Intelligence requires the AdMob network');
    } else if (filter) {
      applyResolved(filter, admobPosterSortValues.slice(0, 1), filterValues, unmapped, 'admobPosterSort', recordUnmapped);
    } else {
      recordUnmapped('admobPosterSort', admobPosterSortValues, 'AdMob Poster Intelligence is not available in live SDUI');
    }
  }

  const admobRanges = [
    ['leadScoreRange', FILTER_IDS.leadScoreRange],
    ['occurrenceCountRange', FILTER_IDS.occurrenceCountRange],
    ['activeDaysRange', FILTER_IDS.activeDaysRange],
  ];

  // DS may express an AdMob range as { min, max } (with either bound
  // optional), while SliderFilter uses a numeric [min, max] state tuple.
  // Fill an omitted bound from the live SDUI slider rather than inventing a
  // limit, so open-ended planner constraints remain visible and executable.
  const normalizeAdmobRange = (raw, filter) => {
    let bounds = null;
    if (Array.isArray(raw)) {
      bounds = raw.length === 2 ? raw : null;
    } else if (raw && typeof raw === 'object') {
      const lower = raw.min ?? raw.lower ?? raw.lower_bound;
      const upper = raw.max ?? raw.upper ?? raw.upper_bound;
      if (lower != null || upper != null) {
        bounds = [
          lower ?? filter.min ?? filter.default_min,
          upper ?? filter.max ?? filter.default_max,
        ];
      }
    }
    if (!bounds || bounds.some((value) => value == null || value === '')) return null;
    const nums = bounds.map(Number);
    if (nums.some((value) => !Number.isFinite(value)) || nums[0] > nums[1]) return null;
    return nums;
  };

  for (const [field, ids] of admobRanges) {
    const raw = args[field];
    if (raw == null || raw === '' || String(raw).toLowerCase() === 'na') {
      continue;
    }
    const filter = findFilter(config, ids);
    if (!hasPlatform('admob')) {
      recordUnmapped(field, raw, 'AdMob range requires the AdMob network');
    } else if (filter) {
      const nums = normalizeAdmobRange(raw, filter);
      if (nums) filterValues[filter._id] = nums;
      else recordUnmapped(field, raw, 'range must contain valid numeric bounds');
    } else {
      recordUnmapped(field, raw, 'AdMob range filter is not available in live SDUI');
    }
  }

  // ── gender ───────────────────────────────────────────────────────────────
  const genderFilter = findFilter(config, FILTER_IDS.gender);
  if (args.gender != null && args.gender !== '') {
    if (genderFilter) applyResolved(genderFilter, [args.gender], filterValues, unmapped, 'gender', recordUnmapped);
    else recordUnmapped('gender', args.gender, 'filter is not available in live SDUI');
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
      recordUnmapped('verified', 1, 'filter is not available in live SDUI');
    }
  }

  // ── call_to_action (array, e.g. ["shop now"]) → cta_filter (["shop_now"]) ──
  const ctaFilter = findFilter(config, FILTER_IDS.cta);
  const ctaValues = asArray(args.call_to_action);
  if (ctaValues.length) {
    if (ctaFilter) applyResolved(ctaFilter, ctaValues, filterValues, unmapped, 'call_to_action', recordUnmapped);
    else recordUnmapped('call_to_action', ctaValues, 'filter is not available in live SDUI');
  }

  // ── order_column / order_by → sortBy (verified against sort options) ───────
  if (args.order_column) {
    const semantic = mapSortValue(args.order_column);
    const sortFilter = findFilter(config, FILTER_IDS.sort);
    if (semantic) {
      if (sortFilter) {
        const r = resolveOption(sortFilter, semantic);
        if (r !== undefined) sortBy = r;
        else recordUnmapped('sort', `${args.order_column} ${args.order_by || ''}`.trim(), 'sort value is not present in live SDUI options');
      } else {
        sortBy = semantic; // no sort filter in config — trust the semantic value
      }
    } else {
      recordUnmapped('sort', `${args.order_column} ${args.order_by || ''}`.trim(), 'sort value is not supported by the frontend mapper');
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
    if (filter) applyResolved(filter, raw, filterValues, unmapped, field, recordUnmapped);
    else recordUnmapped(field, raw, 'filter is not available in live SDUI');
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
  const normalizeNumericRange = (raw) => {
    let lower;
    let upper;
    if (Array.isArray(raw) && raw.length === 2) {
      [lower, upper] = raw;
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      lower = raw.min ?? raw.lower ?? raw.lower_bound ?? raw.gte;
      upper = raw.max ?? raw.upper ?? raw.upper_bound ?? raw.lte;
    } else {
      return null;
    }

    // Common Ads Search consumes inclusive numeric pairs. Use open numeric
    // bounds for planner phrases such as "likes higher than 500" instead of
    // turning a missing upper bound into zero or dropping the filter.
    const isOpenBound = (value) => value == null || ['na', ''].includes(String(value).trim().toLowerCase());
    const normalizedLower = isOpenBound(lower) ? null : Number(lower);
    const normalizedUpper = isOpenBound(upper) ? null : Number(upper);
    if ((normalizedLower !== null && !Number.isFinite(normalizedLower)) ||
      (normalizedUpper !== null && !Number.isFinite(normalizedUpper))) {
      return null;
    }
    return { lower: normalizedLower, upper: normalizedUpper };
  };

  for (const [field, ids] of RANGES) {
    const raw = args[field];
    if (raw == null || raw === '') continue;
    const nums = normalizeNumericRange(raw);
    if (!nums) {
      recordUnmapped(field, raw, 'range must contain exactly two numeric bounds');
      continue;
    }
    const filter = findFilter(config, ids);
    if (filter) {
      const filterMin = Number(filter.min ?? 0);
      const filterMax = Number(filter.max ?? 1000000);
      const lower = nums.lower ?? (Number.isFinite(filterMin) ? filterMin : 0);
      const upper = nums.upper ?? (Number.isFinite(filterMax) ? filterMax : lower);
      if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper) {
        recordUnmapped(field, raw, 'range is outside the live filter bounds');
        continue;
      }
      filterValues[filter._id] = [lower, upper];
    } else recordUnmapped(field, raw, 'filter is not available in live SDUI');
  }

  // ── Continuous age (lower_age/upper_age) — our widget is discrete brackets,
  //    which DS itself confirmed don't filter, so this doesn't round-trip. Leave
  //    it unmapped rather than force a lossy conversion. ─────────────────────────
  if (args.lower_age != null || args.upper_age != null) {
    recordUnmapped('age', `${args.lower_age ?? ''}-${args.upper_age ?? ''}`, 'frontend uses discrete age brackets and cannot safely convert continuous bounds');
  }

  // DS AI-plan payloads use stable top-level PAS keys. Hydrate them into the
  // same frontend state that powers the AI Filters modal/chips so a generated
  // plan is visible to the user and round-trips unchanged through search.
  const hasAiMetaEnabled =
    args.has_ai_meta === true ||
    args.has_ai_meta === 1 ||
    args.has_ai_meta === '1' ||
    String(args.has_ai_meta).toLowerCase() === 'true';
  if (hasAiMetaEnabled) {
    const hasAiMetaFilter = findFilter(config, FILTER_IDS.hasAiMeta);
    filterValues[hasAiMetaFilter?._id || 'has_ai_meta'] = true;
  }

  const AI_META_VOCAB = [
    ['ai_ad_type', FILTER_IDS.aiAdType],
    ['ai_intent', FILTER_IDS.aiIntent],
    ['ai_hook', FILTER_IDS.aiHook],
    ['ai_offering_type', FILTER_IDS.aiOfferingType],
    ['ai_offer_type', FILTER_IDS.aiOfferType],
    ['ai_colors', FILTER_IDS.aiColors],
    ['ai_category_id', FILTER_IDS.aiCategoryId],
    ['ai_subcategory_id', FILTER_IDS.aiSubcategoryId],
  ];
  for (const [field, ids] of AI_META_VOCAB) {
    const raw = asArray(args[field]);
    if (!raw.length) continue;
    applyStableField(findFilter(config, ids), field, raw, filterValues, unmapped, field, recordUnmapped);
  }

  // Keep AI date intent in the same state slots used by the regular date flow.
  // Planning is control metadata, so only its selected date dimension/value is
  // materialized into normal search filter state.
  const plannedDate = (() => {
    const dateFilter = planning?.date_filter;
    if (!dateFilter || typeof dateFilter !== 'object') return null;
    const filterKey = PLANNING_DATE_FILTER_KEYS[String(dateFilter.field || '').trim().toLowerCase()];
    if (!filterKey) return null;

    const startDate = dateFilter.start_date ?? dateFilter.startDate;
    const endDate = dateFilter.end_date ?? dateFilter.endDate;
    if (startDate != null && startDate !== '' && endDate != null && endDate !== '') {
      return { filterKey, value: { startDate, endDate } };
    }

    const preset = String(dateFilter.preset || '').trim();
    return preset ? { filterKey, value: preset } : null;
  })();

  const dateRange = args.dateRange ?? args.date_range;
  const customDateRange = dateRange ?? (
    args.startDate != null && args.endDate != null
      ? { startDate: args.startDate, endDate: args.endDate }
      : null
  );
  const datePreset = args.datePreset ?? args.date_preset;
  const isActiveDateValue = (value) => {
    if (value == null || value === '') return false;
    if (typeof value === 'string') {
      return !['na', 'all', 'all_time'].includes(value.trim().toLowerCase());
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      return [value.startDate, value.start_date, value.endDate, value.end_date]
        .some((entry) => entry != null && entry !== '');
    }
    if (Array.isArray(value)) return value.length > 0;
    return true;
  };
  if (plannedDate) {
    filterValues[plannedDate.filterKey] = plannedDate.value;
  } else {
    const dateValue = isActiveDateValue(customDateRange)
      ? customDateRange
      : (isActiveDateValue(datePreset) ? datePreset : args.post_date_btn_sort);
    const dateIsActive = isActiveDateValue(dateValue);
    if (dateIsActive) filterValues.post_date_btn_sort = dateValue;
  }

  return {
    searchQuery,
    searchIn,
    activePlatforms,
    exactSearch,
    sortBy,
    filterValues,
    unmapped,
    unmappedDetails,
  };
}

/**
 * DS payload tiers carry both a trimmed `args` object and a full `/ads/search`
 * body. The UI maps editable filters from `args`, but some upstream builds may
 * only surface `exact_search` in `full_payload`. Merge that single contract
 * field in so the AI flow stays exact-match-safe without depending on a
 * duplicated upstream shape. Planner metadata is read only for removing a
 * stale instruction-derived keyword and is never copied into the mapped search
 * arguments.
 *
 * @param {{ args?: object, full_payload?: object }} payload
 * @returns {object}
 */
export function normalizeAiSearchArgs(payload = {}) {
  const args = payload?.args && typeof payload.args === 'object' ? payload.args : {};
  const fullPayload = payload?.full_payload && typeof payload.full_payload === 'object'
    ? payload.full_payload
    : {};
  const passthroughKeys = [
    'exact_search',
    'has_ai_meta',
    'ai_ad_type',
    'ai_intent',
    'ai_hook',
    'ai_offering_type',
    'ai_offer_type',
    'ai_colors',
    'ai_category_id',
    'ai_subcategory_id',
    'datePreset',
    'date_preset',
    'dateRange',
    'date_range',
    'startDate',
    'endDate',
    'seen_btn_sort',
    'first_seen_btn_sort',
    'post_date_btn_sort',
  ];

  let changed = false;
  const merged = { ...args };
  for (const key of passthroughKeys) {
    if (merged[key] != null || fullPayload[key] == null) continue;
    merged[key] = fullPayload[key];
    changed = true;
  }

  // Older planner responses could leave an instruction-derived keyword in
  // args even after adding planning metadata. Do not let that keyword broaden
  // the search: only a term explicitly classified as a subject is eligible,
  // and consumed phrases are never search terms. This does not touch genuine
  // subject keywords or mutate the planner metadata returned by DS.
  const planning = payload?.planning;
  const searchTermRole = String(planning?.search_term_role || '').trim().toLowerCase();
  const consumedPhrases = Array.isArray(planning?.consumed_phrases)
    ? planning.consumed_phrases.map((phrase) => String(phrase || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const keyword = String(merged.keyword || '').trim().toLowerCase();
  const nonSubjectRole = ['instruction', 'unsupported', 'ambiguous'].includes(searchTermRole);
  const keywordWasConsumed = keyword && consumedPhrases.some((phrase) =>
    phrase === keyword || phrase.includes(keyword),
  );
  if (keyword && (nonSubjectRole || keywordWasConsumed)) {
    delete merged.keyword;
    changed = true;
  }

  return changed ? merged : args;
}
