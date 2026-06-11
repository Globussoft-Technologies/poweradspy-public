'use strict';

const GoogleSearchQueryBuilder = require('../builders/GoogleSearchQueryBuilder');
const { normalizeParams, ensureArray, parsePagination, parseSort, cleanAdsData } = require('../helpers/paramParser');
const { SAFE_FROM, buildQueryHash, saveCursor, getCursor } = require('../../../utils/searchCursorCache');
const { resolveLongestTokens } = require('../helpers/landerTokenResolver');

/**
 * Google ad search — mirrors SearchController::getAdsHandlerO.
 *
 * Two-phase approach: ES returns IDs → SQL fetches minimal columns →
 * ES fields overlay (new_nas_image_url, title, text, post_owner, etc.)
 */

const AD_DETAIL_SELECT = `
    google_text_ad.id                                       AS id,
    google_text_ad.id                                       AS ad_id,
    google_text_ad.post_owner_id                            AS post_owner_id,
    UNIX_TIMESTAMP(google_text_ad.post_date)                AS post_date,
    google_text_ad.last_seen                                AS last_seen,
    google_text_ad.days_running                             AS days_running
`;

const AD_DETAIL_JOINS = `
FROM google_text_ad
LEFT JOIN google_text_ad_post_owners ON google_text_ad.post_owner_id = google_text_ad_post_owners.id
LEFT JOIN google_text_ad_meta_data   ON google_text_ad.id = google_text_ad_meta_data.google_text_ad_id
LEFT JOIN google_text_ad_variants    ON google_text_ad.id = google_text_ad_variants.google_text_ad_id
LEFT JOIN google_text_ad_domains     ON google_text_ad.domain_id = google_text_ad_domains.id
`;

/**
 * ES → response field mapping (mirrors PHP $fieldMap in getAdsByOrderByFieldNew).
 */
const ES_FIELD_MAP = {
  new_nas_image_url: 'image_video_url',
  title: 'ad_title',
  text: 'ad_text',
  newsfeed_description: 'news_feed_description',
  post_owner_image: 'post_owner_image',
  post_owner_name: 'post_owner',
  target_keyword: 'target_keyword',
  type: 'type',
  built_with: 'built_with',
  affiliate_data: 'affiliate_data',
  built_with_analytics_tracking: 'built_with_analytics_tracking',
  first_seen: 'first_seen',
  destination_url: 'destination_url',
  ad_position: 'ad_position',
  ad_sub_position: 'ad_sub_position',
  country: 'country',
  likes: 'likes',
  comments: 'comments',
  dislikes: 'dislikes',
  views: 'views',
  days_running: 'days_running',
};

function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter(r => { if (seen.has(r.ad_id)) return false; seen.add(r.ad_id); return true; });
}

// ─── Favorite / Hidden search helpers ───────────────────

async function enrichAndFilterRows(rows, db, esIndex, typeField, nasField) {
  if (!db.elastic || rows.length === 0) return rows;
  try {
    const ids = rows.map(r => r.ad_id).filter(Boolean);
    const result = await db.elastic.search({
      index: esIndex,
      body: {
        query: { terms: { 'id': ids.map(Number) } },
        size: ids.length,
        _source: [nasField, typeField, 'id'],
      },
    });
    const hits = result.hits || result.body?.hits;
    const esMap = new Map((hits?.hits || []).map(h => [String(h._source['id'] ?? h._source['ad_id']), h._source]));
    return rows.filter(row => {
      const src = esMap.get(String(row.ad_id)) || {};
      const adType = src[typeField] || row.type || '';
      const nasUrl = src[nasField] || '';
      if (adType === 'IMAGE') {
        if (nasUrl) {
          row.image_video_url = nasUrl;
          row.image_url_original = nasUrl;
          return true;
        }
        return false;
      }
      return true;
    });
  } catch (err) {
    return rows;
  }
}

const GOOGLE_FAV_SQL = (ph) => `SELECT ${AD_DETAIL_SELECT},
      google_text_ad_post_owners.post_owner_name AS post_owner,
      google_text_ad_post_owners.post_owner_image AS post_owner_image,
      google_text_ad.type AS type,
      google_text_ad_meta_data.destination_url AS destination_url,
      google_text_ad_meta_data.built_with AS built_with,
      google_text_ad_meta_data.affiliate_data AS affiliate_data,
      google_text_ad_meta_data.built_with_analytics_tracking AS built_with_analytics_tracking,
      google_text_ad_variants.title AS ad_title,
      google_text_ad_variants.text AS ad_text,
      google_text_ad_variants.newsfeed_description AS news_feed_description,
      google_text_ad_variants.image_url AS image_video_url,
      google_text_ad_variants.target_keyword AS target_keyword
    ${AD_DETAIL_JOINS}
    WHERE google_text_ad.id IN (${ph})
    ORDER BY FIELD(google_text_ad.id, ${ph})`;

async function searchFavoriteAds(p, db, logger) {
  try {
    if (!db.sql) return { code: 503, message: 'SQL connection not available' };
    const favRows = await db.sql.query(
      'SELECT ad_id FROM google_text_hidden_ads WHERE user_id = ? AND type = 3', [p.user_id]
    );
    const adIds = favRows.map(r => r.ad_id).filter(Boolean);
    if (!adIds.length) return { code: 200, data: [], total: 0, message: 'No favorite ads found' };

    const esIndex = db.elastic?.indexName || 'google_ads_data';
    const take = parseInt(p.take, 10) || 20;
    const skip = (parseInt(p.skip, 10) || 0) * take;
    const MAX_ROUNDS = 3;
    let validRows = [];
    let cursor = skip;
    let rounds = 0;

    while (validRows.length < take && cursor < adIds.length && rounds < MAX_ROUNDS) {
      rounds++;
      const batchIds = adIds.slice(cursor, cursor + take);
      cursor += take;
      if (batchIds.length === 0) break;
      const ph = batchIds.map(() => '?').join(',');
      const rows = await db.sql.query(GOOGLE_FAV_SQL(ph), [...batchIds, ...batchIds]);
      const enriched = await enrichAndFilterRows(dedupeRows(rows), db, esIndex, 'type', 'new_nas_image_url');
      validRows = validRows.concat(enriched);
    }

    return { code: 200, data: cleanAdsData(validRows.slice(0, take)), total: adIds.length, message: 'Favorite ads fetched successfully' };
  } catch (err) {
    logger.error('Error in searchFavoriteAds (google)', { error: err.message });
    return { code: 500, message: 'Error fetching favorite ads', error: err.message };
  }
}

async function searchHiddenAds(p, db, logger) {
  try {
    if (!db.sql) return { code: 503, message: 'SQL connection not available' };
    const hiddenRows = await db.sql.query(
      'SELECT ad_id, post_owner_id, type FROM google_text_hidden_ads WHERE user_id = ? AND (type = 1 OR type = 2)', [p.user_id]
    );
    const hiddenMeta = {};
    for (const r of hiddenRows) {
      if (r.ad_id) hiddenMeta[String(r.ad_id)] = { hideType: r.type, postOwnerId: r.post_owner_id };
    }
    const adIds = hiddenRows.map(r => r.ad_id).filter(Boolean);
    if (!adIds.length) return { code: 200, data: [], total: 0, message: 'No hidden ads found' };

    const esIndex = db.elastic?.indexName || 'google_ads_data';
    const take = parseInt(p.take, 10) || 20;
    const skip = (parseInt(p.skip, 10) || 0) * take;
    const MAX_ROUNDS = 3;
    let validRows = [];
    let cursor = skip;
    let rounds = 0;

    while (validRows.length < take && cursor < adIds.length && rounds < MAX_ROUNDS) {
      rounds++;
      const batchIds = adIds.slice(cursor, cursor + take);
      cursor += take;
      if (batchIds.length === 0) break;
      const ph = batchIds.map(() => '?').join(',');
      const rows = await db.sql.query(GOOGLE_FAV_SQL(ph), [...batchIds, ...batchIds]);
      const enriched = await enrichAndFilterRows(dedupeRows(rows), db, esIndex, 'type', 'new_nas_image_url');
      validRows = validRows.concat(enriched);
    }

    const cleanedData = cleanAdsData(validRows.slice(0, take)).map(ad => {
      const meta = hiddenMeta[String(ad.ad_id || ad.id)] || {};
      const hideType = meta.hideType ?? 2;
      return { ...ad, hideType, ad_type: hideType, hiddenPostOwnerId: meta.postOwnerId ?? null };
    });
    return { code: 200, data: cleanedData, total: adIds.length, message: 'Hidden ads fetched successfully' };
  } catch (err) {
    logger.error('Error in searchHiddenAds (google)', { error: err.message });
    return { code: 500, message: 'Error fetching hidden ads', error: err.message };
  }
}

/**
 * Main Google ad search handler (mirrors getAdsHandlerO).
 */
async function searchAds(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.user_id) return { code: 400, message: 'Missing params: user_id is required' };

  // Early-return for special search modes
  if (p.favorite === 'true') return searchFavoriteAds(p, db, logger);
  if (p.hiddenads === 'true' || p.hidden === 'true') return searchHiddenAds(p, db, logger);

  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  const { size, from } = parsePagination(p);
  const sort = parseSort(p);

  const builder = new GoogleSearchQueryBuilder(db.elastic?.indexName);
  builder.setFrom(from).setSize(size).setSortField(sort.field).setSortMethod(sort.order).setIpBasedCountry(p.ipBasedCountry || 'NA');

  // Search text fields
  if (p.keyword)    builder.setKeyword(p.keyword);
  if (p.advertiser) builder.setPostOwnerName(p.advertiser);
  if (p.domain)     builder.setUrl(p.domain);

  // Filters
  if (p.call_to_action) builder.setCallToAction(ensureArray(p.call_to_action));
  if (p.adcategory)     builder.setAdCategory(ensureArray(p.adcategory));
  if (p.subCategory)    builder.setSubCategory(ensureArray(p.subCategory));
  if (p.country)        builder.setCountry(ensureArray(p.country));
  if (p.state)          builder.setState(ensureArray(p.state));
  if (p.city)           builder.setCity(ensureArray(p.city));
  if (p.type)           builder.setAdType(ensureArray(p.type));
  if (p.target_keywords) builder.setTargetKeyword(ensureArray(p.target_keywords));
  if (p.tags)           builder.setTags(ensureArray(p.tags));
  if (p.lang)           builder.setLangDetect(ensureArray(p.lang));

  const apArr = p.ad_position ? ensureArray(p.ad_position) : [];
  if (apArr.length > 0) builder.setAdPosition(apArr);
  if (p.ad_sub_position) builder.setAdSubPosition(ensureArray(p.ad_sub_position));
  if (p.gender) builder.setGender(ensureArray(p.gender));
  if (p.lower_age && p.upper_age) builder.setLowerAgeSeen({ lower_age: p.lower_age, upper_age: p.upper_age });

  // Date ranges
  const tsToDate = (ts, time) => new Date(Number(ts) * 1000).toISOString().slice(0, 10) + ' ' + time;
  if (Array.isArray(p.seen_btn_sort) && p.seen_btn_sort.length === 2) builder.setLastSeen({ lower_date: tsToDate(p.seen_btn_sort[1], '00:00:00'), upper_date: tsToDate(p.seen_btn_sort[0], '23:59:59') });
  if (Array.isArray(p.post_date_btn_sort) && p.post_date_btn_sort.length === 2) builder.setPostDate({ lower_date: tsToDate(p.post_date_btn_sort[1], '00:00:00'), upper_date: tsToDate(p.post_date_btn_sort[0], '23:59:59') });
  if (Array.isArray(p.domain_date_btn_sort) && p.domain_date_btn_sort.length === 2) { const tsToDay = ts => new Date(Number(ts) * 1000).toISOString().slice(0, 10); builder.setDomainDate({ lower_date: tsToDay(p.domain_date_btn_sort[1]), upper_date: tsToDay(p.domain_date_btn_sort[0]) }); }

  // Lander properties
  // built_with / built_with_analytics_tracking are edge_ngram analyzed, so we
  // resolve each value to the exact stemmed token before term-matching it.
  const esIndexLander = db.elastic?.indexName || 'google_ads_data';
  if (p.ecommerce)       builder.setBuiltWith(await resolveLongestTokens(db.elastic, esIndexLander, 'built_with', ensureArray(p.ecommerce), logger));
  if (p.track)           builder.setTrack(ensureArray(p.track));
  if (p.source)          builder.setSource(ensureArray(p.source));
  if (p.funnel)          builder.setFunnel(await resolveLongestTokens(db.elastic, esIndexLander, 'built_with_analytics_tracking', ensureArray(p.funnel), logger));
  if (p.affiliate)       builder.setAffiliate(ensureArray(p.affiliate));
  if (p.market_platform) builder.setMarketPlatform(ensureArray(p.market_platform));

  // Engagement range filters (getAdsHandlerO-specific)
  if (p.likes && Array.isArray(p.likes))         builder.setLikes(p.likes);
  if (p.comments && Array.isArray(p.comments))   builder.setComments(p.comments);
  if (p.dislikes && Array.isArray(p.dislikes))   builder.setDislikes(p.dislikes);
  if (p.views && Array.isArray(p.views))         builder.setViews(p.views);
  if (p.adBudget && Array.isArray(p.adBudget))   builder.setAdBudget(p.adBudget);

  // Other
  if (p.html_content)    builder.setHtmlContent(p.html_content);
  if (p.needle)          builder.setNeedle(p.needle);
  if (p.similar_ad_id || p.adDetail_id) builder.setAdDetailId(p.similar_ad_id || p.adDetail_id);
  if (p.not_country)     builder.setNotCountry(p.not_country);

  const esParams = builder.build();

  // Deep pagination
  const queryHash = buildQueryHash(p);
  if (from >= SAFE_FROM) {
    const cursor = getCursor(queryHash, from);
    if (cursor) { delete esParams.body.from; esParams.body.search_after = cursor; }
    else { esParams.body.from = Math.max(0, SAFE_FROM - size); }
  }

  logger.info('Executing Google ad search', { from: esParams.body.from, size: esParams.body.size, sortField: sort.field });

  // Timing instrumentation — exposed in response for live diagnostics.
  const tStart = Date.now();
  let esElapsed = 0;
  let sqlElapsed = 0;

  try {
    const tEs = Date.now();
    const result = await db.elastic.search(esParams);
    esElapsed = Date.now() - tEs;
    const hits = result.hits || result.body?.hits;
    const aggregations = result.aggregations || result.body?.aggregations;
    const esHits = (hits.hits || []);
    saveCursor(queryHash, from, size, esHits);

    if (esHits.length === 0) return { code: 200, data: [], total: 0, message: 'No ads found', _timing: { es_ms: esElapsed, sql_ms: 0, total_ms: Date.now() - tStart } };

    // Use cardinality agg for accurate unique-doc count — hits.total is pre-collapse
    // (inflated by duplicates). Fall back to hits.total only when agg is unavailable.
    const esFallbackTotal = typeof hits.total === 'object' ? hits.total.value : hits.total;
    const cardinalityTotal = aggregations?.unique_count?.value;
    const total = cardinalityTotal != null ? cardinalityTotal : esFallbackTotal;

    const adIds = esHits.map(hit => hit._source['id'] || hit._source['ad_id'] || hit._id);

    let finalAds = [];
    if (db.sql) {
      try {
        const ph = adIds.map(() => '?').join(',');
        // Main-search SQL is a single-table indexed lookup. The 4 JOINs in
        // AD_DETAIL_JOINS were dead weight here — every ad-detail field
        // (title, text, post_owner_*, destination_url, etc.) is overlaid
        // from ES via ES_FIELD_MAP below, so joining post_owners/meta_data/
        // variants/domains was pure waste. Removing them eliminates row
        // multiplication and turns this query from a 4-table mash into a
        // primary-key IN lookup. Favorite/hidden flow (GOOGLE_FAV_SQL) still
        // uses the JOINs because it really does select from those tables.
        const tSql = Date.now();
        const rawRows = await db.sql.query(
          `SELECT ${AD_DETAIL_SELECT} FROM google_text_ad WHERE google_text_ad.id IN (${ph}) ORDER BY FIELD(google_text_ad.id, ${ph})`,
          [...adIds, ...adIds]
        );
        sqlElapsed = Date.now() - tSql;
        const sqlRows = dedupeRows(rawRows);

        // Build ES lookup map
        const esMap = new Map(esHits.map(hit => [String(hit._source['id'] || hit._source['ad_id'] || hit._id), hit]));

        finalAds = sqlRows.map(row => {
          const esHit = esMap.get(String(row.ad_id));
          if (!esHit) return row;
          const src = esHit._source || {};

          // Overlay ES fields onto SQL row (mirrors PHP $fieldMap)
          for (const [esKey, responseKey] of Object.entries(ES_FIELD_MAP)) {
            if (src[esKey] !== undefined && src[esKey] !== null) {
              const val = src[esKey];
              row[responseKey] = Array.isArray(val) ? val.join(', ') : val;
            }
          }

          return row;
        });
      } catch (sqlErr) {
        logger.warn('SQL fetch failed, falling back to ES raw data', { error: sqlErr.message });
        finalAds = esHits.map(hit => {
          const src = hit._source || {};
          const id = src.id || src.ad_id || hit._id;
          return { ...src, id, ad_id: id };
        });
      }
    } else {
      finalAds = esHits.map(hit => {
        const src = hit._source || {};
        const id = src.id || src.ad_id || hit._id;
        return { ...src, id, ad_id: id };
      });
    }

    const totalMs = Date.now() - tStart;
    if (totalMs > 1000) {
      logger.warn('Slow Google search request', { es_ms: esElapsed, sql_ms: sqlElapsed, total_ms: totalMs, hits: esHits.length });
    }
    
    const esMap2 = new Map(esHits.map(hit => [String(hit._source['id'] || hit._source['ad_id'] || hit._id), hit._source]));
    finalAds = finalAds.map(ad => {
      const src = esMap2.get(String(ad.ad_id || ad.id)) || {};
      return {
        ...ad,
        market_platform_urls: {
          url_destination: src['url_destination'] || null,
          source_url:      src['source_url']      || null,
          redirect_url:    src['redirect_url']    || null,
          final_url:       src['final_url']       || null,
          url_redirects:   src['url_redirects']   || null,
          destination_url: src['destination_url'] || null,
        },
      };
    });

    return { code: 200, data: cleanAdsData(finalAds), total, message: 'Ads fetched successfully', _timing: { es_ms: esElapsed, sql_ms: sqlElapsed, total_ms: totalMs } };
  } catch (err) {
    logger.error('Error in searchAds (google)', { error: err.message, stack: err.stack, es_ms: esElapsed, sql_ms: sqlElapsed });
    return { code: 500, message: 'Error occurred in ad search', error: err.message };
  }
}

module.exports = { searchAds, AD_DETAIL_SELECT, AD_DETAIL_JOINS, ES_FIELD_MAP };
