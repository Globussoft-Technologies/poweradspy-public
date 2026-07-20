'use strict';

/**
 * YouTube DISPLAY → GDN merge helper.
 *
 * Product rule: YouTube ads whose `ad_type = DISPLAY` must be surfaced under the
 * GDN listing (NOT under YouTube). They physically live in the YouTube store
 * (`youtube_ads_data` ES index + `youtube_ad` SQL), so this helper reads them
 * from there and the GDN ad-search controller interleaves them into its results.
 *
 * Design (read-path only, no data migration):
 *   - YouTube side hides DISPLAY via a `must_not` in youtube SearchMixQueryBuilder.
 *   - GDN side, for the normal pagination window, fetches the first `upper`
 *     (= from + size) GDN hits AND the first `upper` YouTube DISPLAY hits, merges
 *     them by a normalized recency key, and slices the page. Because every page
 *     recomputes the same merged prefix [0, upper) and slices [from, upper), the
 *     boundaries align across pages → no duplicates / no skips. `total` is the
 *     sum of both counts.
 *
 * Interleave is only enabled for the recency sorts (last_seen / post_date), which
 * are GDN's default and dominant sorts and the only ones with a directly
 * comparable field on both sides. For any other sort the GDN controller skips the
 * merge and behaves exactly as before.
 *
 * Favourites/Hidden lists are a separate merge, not this interleave: hide/favourite
 * on a DISPLAY ad is still recorded via the YouTube backend (`youtube_hidden_ads`,
 * since `network` stays 'youtube' for data routing), so GDN's searchFavoriteAds/
 * searchHiddenAds pull those rows in too via `filterDisplayAdIds` +
 * `enrichYoutubeDisplayAds` — otherwise a favourited/hidden DISPLAY ad never shows
 * under GDN's own Favourites/Hidden sections.
 */

const databaseManager = require('../../../database/DatabaseManager');
const { matchFilter, multiFieldMatchFilter } = require('../../common/helpers/esQueryHelpers');
const { getLanguageMap, resolveLanguageName } = require('../../../utils/languageMap');
const {
  AD_DETAIL_SELECT: YT_SELECT,
  AD_DETAIL_JOINS: YT_JOINS,
} = require('../../youtube/controllers/adSearchController');
const { cleanAdsData: cleanYoutubeAds } = require('../../youtube/helpers/paramParser');

// ES max_result_window — we only merge inside the standard from/size window.
const MAX_WINDOW = 10000;

// GDN sort field → the YouTube field used to fetch/order the DISPLAY side.
// `gdn_ad.id` is the frontend's default "Newest" sort: GDN orders by row id but
// we still interleave the DISPLAY side by recency (last_seen), and the GDN merge
// key is read from gdn_ad.last_seen (see gdnKeyField in the controller), so both
// sides compare on a real timestamp.
const SORT_FIELD_MAP = {
  'gdn_ad.last_seen': 'last_seen',
  'gdn_ad.post_date': 'post_date',
  'gdn_ad.id':        'last_seen',
};

// new_nas_image_url substrings the UI hides (mirror youtube displayable-media gate).
const BLOCKED_MEDIA = ['*pasvideo*', '*pasimage*', '*bydefault*'];

function getYoutubeConns() {
  try {
    return databaseManager.getConnections('youtube');
  } catch (_) {
    return null;
  }
}

/** Normalize a last_seen/post_date value to epoch SECONDS for cross-source merge. */
function toEpochSeconds(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : v; // ms vs s
  const s = String(v);
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n > 1e12 ? Math.floor(n / 1000) : n;
  }
  const t = Date.parse(s.replace(' ', 'T'));
  return Number.isNaN(t) ? 0 : Math.floor(t / 1000);
}

function ensureArr(v) {
  if (Array.isArray(v)) return v;
  if (v === '' || v === null || v === undefined) return [];
  return [v];
}

/**
 * Should YouTube DISPLAY ads be merged into this GDN request?
 * @returns {boolean}
 */
function isDisplayMergeApplicable(p, sort, from, size) {
  // Favorite/hidden modes are handled before this is ever called.
  if (!SORT_FIELD_MAP[sort.field]) return false;          // only recency sorts
  if ((from + size) > MAX_WINDOW) return false;           // deep pages → GDN-only
  // If the user filters by ad type and neither DISPLAY nor IMAGE is one of them, exclude.
  // (YouTube display ads land as ad_type IMAGE via the Node insertion; DISPLAY is the legacy
  // PHP label kept for historical ads — both surface under GDN.)
  const types = ensureArr(p.type).map(t => String(t).toUpperCase());
  if (types.length && !types.includes('DISPLAY') && !types.includes('IMAGE')) return false;
  const yt = getYoutubeConns();
  return !!(yt && yt.elastic);
}

/** Build the optional shared-filter clauses (keyword / advertiser / country / seen / post-date / domain-date ranges). */
function buildSharedFilters(p) {
  const must = [];
  const filter = [];

  if (p.keyword) {
    must.push({
      multi_match: {
        query: String(p.keyword).replace(/"/g, ''),
        type: 'phrase',
        fields: ['ad_title', 'ad_text', 'newsfeed_description'],
      },
    });
  }
  if (p.advertiser) {
    must.push({ match_phrase: { post_owner: String(p.advertiser) } });
  }
  // Country — mirror YouTube SearchMixQueryBuilder._getCountryEnv()
  // (YouTube DISPLAY ads store countries in the top-level `countries` array).
  // Use multiFieldMatchFilter to stay byte-for-byte consistent with the native
  // YouTube query path.
  const countryFilter = multiFieldMatchFilter(['countries'], p.country);
  if (countryFilter) filter.push(countryFilter);
  // Category / sub-category — mirror youtube SearchMixQueryBuilder
  // (_getAdCategoryEnv / _getSubCategoryEnv) so the DISPLAY ads merged in here
  // are filtered by the SAME category as the GDN/YouTube queries. Without this
  // the YouTube DISPLAY side stayed unfiltered and leaked uncategorized/default
  // ads under `network:youtube` whenever a category filter was active.
  const cats = ensureArr(p.adcategory);
  if (cats.length) filter.push({ terms: { 'youtube.category.keyword': cats } });
  const subs = ensureArr(p.subCategory);
  if (subs.length) filter.push({ terms: { 'youtube.subCategory.keyword': subs } });
  // Date-range filters. Each *_btn_sort arrives as [upperTs, lowerTs] in epoch
  // seconds. The GDN main query applies these to the GDN side; mirror them here
  // so the merged-in YouTube DISPLAY total is bounded by the same window —
  // otherwise the YouTube side stays unfiltered and inflates the merged count
  // (e.g. a Post Date filter would otherwise count every DISPLAY ad regardless
  // of date). YouTube ES date fields are mapped as epoch_second.
  const dateRange = (btn, field) => {
    if (!Array.isArray(btn) || btn.length !== 2) return;
    const lower = Number(btn[1]);
    const upper = Number(btn[0]);
    if (Number.isFinite(lower) && Number.isFinite(upper)) {
      filter.push({ range: { [field]: { gte: lower, lte: upper, format: 'epoch_second' } } });
    }
  };
  dateRange(p.seen_btn_sort, 'last_seen');
  dateRange(p.post_date_btn_sort, 'post_date');
  dateRange(p.domain_date_btn_sort, 'domain_registration_date');

  // Traffic Source — mirror GDN SearchMixQueryBuilder._getSourceEnv().
  // Without this, merged-in YouTube DISPLAY ads leak through regardless of the
  // selected source (e.g. an iOS/Desktop ad appears when Android is selected).
  const srcFilter = matchFilter('source', p.source);
  if (srcFilter) filter.push(srcFilter);

  // Affiliate Network — mirror YouTube SearchMixQueryBuilder._getAffiliateEnv()
  // (YouTube DISPLAY ads store affiliate networks in the top-level
  // `affiliate_networks` field). Without this, the merged YouTube DISPLAY side
  // stays unfiltered and leaks ads that don't match the selected affiliate.
  const affFilter = matchFilter('affiliate_networks', p.affiliate);
  if (affFilter) filter.push(affFilter);

  // Marketing Platform — mirror YouTube SearchMixQueryBuilder._getMarketPlatformEnv()
  // (YouTube DISPLAY ads store the click chain in `redirect_urls`). Without this,
  // merged YouTube DISPLAY ads leak through regardless of the selected marketing
  // platform (e.g. an ad with no Adobe Audience Manager data appears when that
  // filter is active).
  const mpValues = ensureArr(p.market_platform).filter(v => v && v !== 'NA');
  if (mpValues.length) {
    const should = mpValues.map(v => ({ wildcard: { 'redirect_urls.keyword': { value: `*${v}*` } } }));
    filter.push({ bool: { should, minimum_should_match: 1 } });
  }

  // Funnel Type — mirror YouTube SearchMixQueryBuilder._getFunnelEnv()
  // (YouTube DISPLAY ads store funnel values in the top-level `funnel` field).
  // Without this, merged YouTube DISPLAY ads leak through regardless of the
  // selected funnel type (e.g. a non-Builderall ad appears when Builderall is
  // selected).
  const funnelFilter = matchFilter('funnel', p.funnel);
  if (funnelFilter) filter.push(funnelFilter);

  // Ecommerce Platform — mirror YouTube SearchMixQueryBuilder._getBuiltWithEnv()
  // (YouTube DISPLAY ads store ecommerce values in the top-level
  // `ecommerce_platform` field). Without this, merged YouTube DISPLAY ads leak
  // through regardless of the selected ecommerce platform (e.g. a non-Shopify
  // ad appears when Shopify is selected).
  const ecommerceFilter = matchFilter('ecommerce_platform', p.ecommerce);
  if (ecommerceFilter) filter.push(ecommerceFilter);

  // Language — mirror YouTube SearchMixQueryBuilder._getLangDetectEnv()
  // (YouTube DISPLAY ads store detected language in the top-level `ad_language`
  // field). Without this, merged YouTube DISPLAY ads leak through regardless of
  // the selected language (e.g. English ads appear when German is selected).
  const langFilter = matchFilter('ad_language', p.lang);
  if (langFilter) filter.push(langFilter);

  return { must, filter };
}

/**
 * Fetch the first `upper` YouTube DISPLAY hits (light: id + sort key only).
 * @returns {Promise<{ items: Array<{src:'yt', id:number, key:number}>, total:number }>}
 */
async function getYoutubeDisplayHits(upper, sort, p, logger) {
  const yt = getYoutubeConns();
  if (!yt || !yt.elastic) return { items: [], total: 0 };

  const ytField = SORT_FIELD_MAP[sort.field] || 'last_seen';
  const order = sort.order === 'asc' ? 'asc' : 'desc';
  const shared = buildSharedFilters(p);

  const body = {
    from: 0,
    size: upper,
    sort: [{ [ytField]: { order } }, { ad_id: 'desc' }],
    _source: ['ad_id', ytField],
    query: {
      bool: {
        must: shared.must,
        filter: [
          { terms: { 'ad_type.keyword': ['DISPLAY', 'IMAGE'] } },
          { exists: { field: 'new_nas_image_url' } },
          ...shared.filter,
        ],
        must_not: BLOCKED_MEDIA.map(v => ({ wildcard: { 'new_nas_image_url.keyword': { value: v } } })),
      },
    },
  };

  try {
    const index = yt.elastic.indexName || 'youtube_ads_data';
    const res = await yt.elastic.search({ index, body });
    const hits = res.hits || res.body?.hits;
    const total = typeof hits?.total === 'object' ? hits.total.value : (hits?.total || 0);
    const items = (hits?.hits || []).map(h => ({
      src: 'yt',
      id: h._source.ad_id,
      key: toEpochSeconds(h._source[ytField]),
    }));
    return { items, total };
  } catch (err) {
    if (logger) logger.warn('YouTube DISPLAY hits fetch failed; GDN-only fallback', { error: err.message });
    return { items: [], total: 0 };
  }
}

/**
 * Given arbitrary YouTube ad ids (e.g. from `youtube_hidden_ads`), return the
 * subset whose `ad_type` is DISPLAY/IMAGE — i.e. the ones surfaced under GDN.
 * Used by the GDN Favourites/Hidden lists: hide/favourite on a merged-in
 * DISPLAY ad is recorded via the YouTube backend (network stays 'youtube' for
 * data routing — see YOUTUBE_DISPLAY_IN_GDN.md), so GDN's own hidden-ads table
 * never sees it. Without this filter, GDN's Favourites/Hidden lists have no
 * way to find those rows and the ad silently disappears from them.
 * @returns {Promise<Array<number|string>>}
 */
async function filterDisplayAdIds(ids, logger) {
  const yt = getYoutubeConns();
  if (!yt || !yt.elastic || !ids || ids.length === 0) return [];
  try {
    const index = yt.elastic.indexName || 'youtube_ads_data';
    const res = await yt.elastic.search({
      index,
      body: {
        query: { terms: { ad_id: ids.map(Number) } },
        size: ids.length,
        _source: ['ad_id', 'ad_type'],
      },
    });
    const hits = res.hits || res.body?.hits;
    const displaySet = new Set(
      (hits?.hits || [])
        .filter(h => ['DISPLAY', 'IMAGE'].includes(h._source.ad_type))
        .map(h => String(h._source.ad_id))
    );
    return ids.filter(id => displaySet.has(String(id)));
  } catch (err) {
    if (logger) logger.warn('YouTube DISPLAY id filter failed', { error: err.message });
    return [];
  }
}

/**
 * Rows from `youtube_hidden_ads` for this user/type-clause, narrowed to the
 * DISPLAY/IMAGE ad ids (the ones surfaced under GDN). Used by GDN's
 * searchFavoriteAds/searchHiddenAds to pull in hide/favourite records that
 * were written via the YouTube backend (see filterDisplayAdIds above).
 * @returns {Promise<Array<{ad_id, post_owner_id, type}>>}
 */
async function getYoutubeDisplayHiddenRows(userId, typeSql, logger) {
  const yt = getYoutubeConns();
  if (!yt || !yt.sql) return [];
  try {
    const rows = await yt.sql.query(
      `SELECT ad_id, post_owner_id, type FROM youtube_hidden_ads WHERE user_id = ? AND ${typeSql}`,
      [userId]
    );
    const ids = rows.map(r => r.ad_id).filter(Boolean);
    const displaySet = new Set((await filterDisplayAdIds(ids, logger)).map(String));
    return rows.filter(r => r.ad_id && displaySet.has(String(r.ad_id)));
  } catch (err) {
    if (logger) logger.warn('YouTube hidden/favourite lookup failed (gdn merge)', { error: err.message });
    return [];
  }
}

function dedupeById(rows) {
  const seen = new Set();
  return rows.filter(r => {
    const id = r.ad_id ?? r.id;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Enrich a page's YouTube DISPLAY ad ids into fully shaped ad objects (youtube
 * shape + a `network: 'youtube'` marker so the frontend routes detail/clicks to
 * YouTube). Returns a Map keyed by String(id).
 */
async function enrichYoutubeDisplayAds(ids, logger) {
  const out = new Map();
  if (!ids || ids.length === 0) return out;

  const yt = getYoutubeConns();
  if (!yt || !yt.sql) return out;

  try {
    const placeholders = ids.map(() => '?').join(',');
    const sql = `SELECT ${YT_SELECT}
${YT_JOINS}
WHERE youtube_ad.id IN (${placeholders})
ORDER BY FIELD(youtube_ad.id, ${placeholders})`;
    const rawRows = await yt.sql.query(sql, [...ids, ...ids]);
    const rows = dedupeById(rawRows);

    // Overlay live media/engagement from ES (DISPLAY media = new_nas_image_url).
    let esMap = new Map();
    if (yt.elastic) {
      try {
        const index = yt.elastic.indexName || 'youtube_ads_data';
        const r = await yt.elastic.search({
          index,
          body: {
            query: { terms: { ad_id: ids.map(Number) } },
            size: ids.length,
            _source: ['ad_id', 'ad_type', 'new_nas_image_url', 'reactions', 'dislikes',
              'comments', 'views', 'verified', 'countries', 'duration', 'call_to_action', 'ad_language'],
          },
        });
        const hh = r.hits || r.body?.hits;
        esMap = new Map((hh?.hits || []).map(h => [String(h._source.ad_id), h._source]));
      } catch (esErr) {
        if (logger) logger.warn('YouTube DISPLAY ES overlay failed', { error: esErr.message });
      }
    }

    // Language map for resolving ES `ad_language` codes → names. Mirrors
    // youtube adDetailController's overlay — without also overriding `row.language`,
    // the stale `youtube_ad.language_id` join (read via YT_SELECT) would win in
    // mapAdToCard's `raw.language || raw.ad_language` priority on the frontend.
    let langMap = null;
    try { langMap = await getLanguageMap(yt.sql); } catch (_) { langMap = null; }

    const shaped = rows.map(row => {
      const src = esMap.get(String(row.ad_id)) || {};
      if (src.new_nas_image_url) {
        row.image_video_url = src.new_nas_image_url;
        row.image_url_original = src.new_nas_image_url;
      }
      if (src.reactions?.likes !== undefined) row.likes = src.reactions.likes;
      if (src.dislikes !== undefined) row.dislikes = src.dislikes;
      if (src.comments !== undefined) row.comment = src.comments;
      if (src.views !== undefined) row.view = src.views;
      if (src.verified !== undefined) row.verified = src.verified;
      if (src.countries !== undefined) row.countries = src.countries;
      if (src.duration !== undefined) row.days_running = src.duration;
      if (src.call_to_action !== undefined) row.call_to_action = src.call_to_action;
      // Language is ES-only — must agree with the language FILTER, which only
      // ever matches `ad_language`. Discard the stale `languages.name` SQL join
      // (read via YT_SELECT) so a card/detail modal never shows a language the
      // filter itself wouldn't match this ad on.
      row.language = null;
      if (src.ad_language) {
        row.ad_language = src.ad_language;
        if (langMap) {
          const resolved = resolveLanguageName(langMap, src.ad_language);
          if (resolved) row.language = resolved;
        }
      }
      return row;
    });

    for (const ad of cleanYoutubeAds(shaped)) {
      out.set(String(ad.ad_id ?? ad.id), { ...ad, network: 'youtube', ad_origin: 'youtube_display' });
    }
  } catch (err) {
    if (logger) logger.warn('YouTube DISPLAY SQL enrich failed', { error: err.message });
  }
  return out;
}

module.exports = {
  isDisplayMergeApplicable,
  getYoutubeDisplayHits,
  enrichYoutubeDisplayAds,
  filterDisplayAdIds,
  getYoutubeDisplayHiddenRows,
  getYoutubeConns,
  toEpochSeconds,
  MAX_WINDOW,
};
