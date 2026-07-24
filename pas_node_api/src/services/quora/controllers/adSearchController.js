'use strict';

const QuoraSearchQueryBuilder = require('../builders/QuoraSearchQueryBuilder');
const { normalizeParams, ensureArray, parsePagination, parseSort, cleanAdsData } = require('../helpers/paramParser');
const { SAFE_FROM, buildQueryHash, saveCursor, getCursor } = require('../../../utils/searchCursorCache');
const { getLanguageMap, resolveLanguageName } = require('../../../utils/languageMap');
const { applyAiMetaFilters } = require('../../common/helpers/aiMetaSearchFilter');

const AD_DETAIL_SELECT = `
    quora_ad.id                                     AS id,
    quora_ad.id                                     AS ad_id,
    quora_ad.type                                   AS type,
    quora_ad.ad_position                            AS ad_position,
    quora_ad.post_owner_id                          AS post_owner_id,
    UNIX_TIMESTAMP(quora_ad.post_date)              AS post_date,
    quora_ad.first_seen                             AS first_seen,
    DATE(quora_ad.last_seen)                        AS last_seen,
    quora_ad.days_running                           AS days_running,
    quora_ad.likes                                  AS likes,
    quora_ad.comments                               AS comment,
    quora_ad.shares                                 AS share,
    quora_ad_post_owners.post_owner_name            AS post_owner,
    quora_ad_post_owners.post_owner_image           AS post_owner_image,
    quora_ad_meta_data.destination_url               AS destination_url,
    quora_ad_meta_data.ad_url                       AS ad_url,
    quora_ad_meta_data.built_with                   AS built_with,
    quora_ad_meta_data.built_with_analytics_tracking AS built_with_analytics_tracking,
    quora_ad_meta_data.affiliate_data               AS affiliate_data,
    quora_ad_variants.title                         AS ad_title,
    quora_ad_variants.text                          AS ad_text,
    quora_ad_variants.newsfeed_description           AS news_feed_description,
    quora_ad_variants.image_url                     AS image_video_url,
    quora_ad_variants.image_url_original            AS image_url_original,
    quora_ad_variants.video_url                     AS video_url,
    quora_ad_variants.tags                          AS tags,
    quora_ad_image_video.ad_image_video             AS ad_image_video,
    quora_call_to_action.call_to_action             AS call_to_action,
    languages.name                                  AS language
`;

const AD_DETAIL_JOINS = `
FROM quora_ad
LEFT JOIN quora_ad_post_owners ON quora_ad.post_owner_id = quora_ad_post_owners.id
LEFT JOIN quora_ad_image_video ON quora_ad.id = quora_ad_image_video.quora_ad_id
LEFT JOIN quora_ad_meta_data   ON quora_ad.id = quora_ad_meta_data.quora_ad_id
LEFT JOIN quora_ad_variants    ON quora_ad.id = quora_ad_variants.quora_ad_id
LEFT JOIN quora_ad_domain      ON quora_ad.domain_id = quora_ad_domain.id
LEFT JOIN quora_call_to_action ON quora_ad.call_to_action_id = quora_call_to_action.id
LEFT JOIN languages            ON quora_ad.language_id = languages.id
`;

function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter(r => { if (seen.has(r.ad_id)) return false; seen.add(r.ad_id); return true; });
}

async function enrichAndFilterRows(rows, db, esIndex, typeField, nasField) {
  if (!db.elastic || rows.length === 0) return rows;
  try {
    const ids = rows.map(r => r.ad_id).filter(Boolean);
    const result = await db.elastic.search({
      index: esIndex,
      body: {
        query: { terms: { 'quora_ad.id': ids.map(Number) } },
        size: ids.length,
        _source: [nasField, typeField, 'quora_ad.id'],
      },
    });
    const hits = result.hits || result.body?.hits;
    const esMap = new Map((hits?.hits || []).map(h => [String(h._source['quora_ad.id']), h._source]));
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

async function searchFavoriteAds(p, db, logger) {
  try {
    if (!db.sql) return { code: 503, message: 'SQL connection not available' };
    const favRows = await db.sql.query('SELECT ad_id FROM hidden_ads WHERE user_id = ? AND type = 3', [p.user_id]);
    const adIds = favRows.map(r => r.ad_id).filter(Boolean);
    if (!adIds.length) return { code: 200, data: [], total: 0, message: 'No favorite ads found' };

    const esIndex = db.elastic?.indexName || 'quora_search_mix';
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
      const rows = await db.sql.query(`SELECT ${AD_DETAIL_SELECT} ${AD_DETAIL_JOINS} WHERE quora_ad.id IN (${ph}) ORDER BY FIELD(quora_ad.id, ${ph})`, [...batchIds, ...batchIds]);
      const enriched = await enrichAndFilterRows(dedupeRows(rows), db, esIndex, 'quora_ad.type', 'new_nas_image_url');
      validRows = validRows.concat(enriched);
    }

    return { code: 200, data: cleanAdsData(validRows.slice(0, take)), total: adIds.length, message: 'Favorite ads fetched successfully' };
  } catch (err) {
    logger.error('Error in searchFavoriteAds (quora)', { error: err.message });
    return { code: 500, message: 'Error fetching favorite ads', error: err.message };
  }
}

async function searchHiddenAds(p, db, logger) {
  try {
    if (!db.sql) return { code: 503, message: 'SQL connection not available' };
    const hiddenRows = await db.sql.query('SELECT ad_id, post_owner_id, type FROM hidden_ads WHERE user_id = ? AND (type = 1 OR type = 2)', [p.user_id]);
    const hiddenMeta = {};
    for (const r of hiddenRows) {
      if (r.ad_id) hiddenMeta[String(r.ad_id)] = { hideType: r.type, postOwnerId: r.post_owner_id };
    }
    const adIds = hiddenRows.map(r => r.ad_id).filter(Boolean);
    if (!adIds.length) return { code: 200, data: [], total: 0, message: 'No hidden ads found' };

    const esIndex = db.elastic?.indexName || 'quora_search_mix';
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
      const rows = await db.sql.query(`SELECT ${AD_DETAIL_SELECT} ${AD_DETAIL_JOINS} WHERE quora_ad.id IN (${ph}) ORDER BY FIELD(quora_ad.id, ${ph})`, [...batchIds, ...batchIds]);
      const enriched = await enrichAndFilterRows(dedupeRows(rows), db, esIndex, 'quora_ad.type', 'new_nas_image_url');
      validRows = validRows.concat(enriched);
    }

    const cleanedData = cleanAdsData(validRows.slice(0, take)).map(ad => {
      const meta = hiddenMeta[String(ad.ad_id || ad.id)] || {};
      const hideType = meta.hideType ?? 2;
      return { ...ad, hideType, ad_type: hideType, hiddenPostOwnerId: meta.postOwnerId ?? null };
    });
    return { code: 200, data: cleanedData, total: adIds.length, message: 'Hidden ads fetched successfully' };
  } catch (err) {
    logger.error('Error in searchHiddenAds (quora)', { error: err.message });
    return { code: 500, message: 'Error fetching hidden ads', error: err.message };
  }
}

async function searchAds(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);
  if (!p.user_id) return { code: 400, message: 'Missing params: user_id is required' };
  if (p.favorite === 'true') return searchFavoriteAds(p, db, logger);
  if (p.hiddenads === 'true' || p.hidden === 'true') return searchHiddenAds(p, db, logger);
  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  const { size, from } = parsePagination(p);
  const sort = parseSort(p);
  const builder = new QuoraSearchQueryBuilder(db.elastic?.indexName);
  builder.setFrom(from).setSize(size).setSortField(sort.field).setSortMethod(sort.order).setIpBasedCountry(p.ipBasedCountry || 'NA');
  builder.setStatus([1, 5, 6]);

  if (p.keyword)    builder.setKeyword(p.keyword);
  if (p.advertiser) builder.setPostOwnerName(p.advertiser);
  if (p.domain)     builder.setUrl(p.domain);

  if (p.call_to_action) builder.setCallToAction(ensureArray(p.call_to_action));
  if (p.adcategory)     builder.setAdCategory(ensureArray(p.adcategory));
  if (p.subCategory)    builder.setSubCategory(ensureArray(p.subCategory));
  if (p.country)        builder.setCountry(ensureArray(p.country));
  if (p.state)          builder.setState(ensureArray(p.state));
  if (p.city)           builder.setCity(ensureArray(p.city));
  if (p.type)           builder.setAdType(ensureArray(p.type));
  if (p.tags)           builder.setTags(ensureArray(p.tags));
  if (p.lang)           builder.setLangDetect(ensureArray(p.lang));
  const apArr = p.ad_position ? ensureArray(p.ad_position) : [];
  if (apArr.length > 0) builder.setAdPosition(apArr);
  if (p.gender) builder.setGender(ensureArray(p.gender));
  if (p.lower_age && p.upper_age) builder.setLowerAgeSeen({ lower_age: p.lower_age, upper_age: p.upper_age });

  // Engagement range filters — Quora indexes likes/comments/shares only.
  if (p.likes && Array.isArray(p.likes))       builder.setLikes(p.likes);
  if (p.comments && Array.isArray(p.comments)) builder.setComments(p.comments);
  if (p.shares && Array.isArray(p.shares))     builder.setShares(p.shares);

  const tsToDate = (ts, time) => new Date(Number(ts) * 1000).toISOString().slice(0, 10) + ' ' + time;
  if (Array.isArray(p.seen_btn_sort) && p.seen_btn_sort.length === 2) builder.setLastSeen({ lower_date: tsToDate(p.seen_btn_sort[1], '00:00:00'), upper_date: tsToDate(p.seen_btn_sort[0], '23:59:59') });
  if (Array.isArray(p.post_date_btn_sort) && p.post_date_btn_sort.length === 2) builder.setPostDate({ lower_date: tsToDate(p.post_date_btn_sort[1], '00:00:00'), upper_date: tsToDate(p.post_date_btn_sort[0], '23:59:59') });
  if (Array.isArray(p.domain_date_btn_sort) && p.domain_date_btn_sort.length === 2) { const tsToDay = ts => new Date(Number(ts) * 1000).toISOString().slice(0, 10); builder.setDomainDate({ lower_date: tsToDay(p.domain_date_btn_sort[1]), upper_date: tsToDay(p.domain_date_btn_sort[0]) }); }

  if (p.ecommerce)       builder.setBuiltWith(ensureArray(p.ecommerce));
  if (p.track)           builder.setTrack(ensureArray(p.track));
  if (p.source)          builder.setSource(ensureArray(p.source));
  if (p.funnel)          builder.setFunnel(ensureArray(p.funnel));
  if (p.affiliate)       builder.setAffiliate(ensureArray(p.affiliate));
  if (p.market_platform) builder.setMarketPlatform(ensureArray(p.market_platform));

  if (p.ocr)             builder.setOcr(p.ocr);
  if (p.image_celebrity) builder.setCelebrity(ensureArray(p.image_celebrity));
  if (p.image_object)    builder.setImageObject(ensureArray(p.image_object));
  if (p.image_logo)      builder.setLogo(ensureArray(p.image_logo));
  if (p.html_content)    builder.setHtmlContent(p.html_content);
  if (p.needle)          builder.setNeedle(p.needle);
  if (p.similar_ad_id || p.adDetail_id) builder.setAdDetailId(p.similar_ad_id || p.adDetail_id);
  if (p.not_country)     builder.setNotCountry(p.not_country);

  const esParams = builder.build();
  applyAiMetaFilters(esParams, 'quora', p);
  const queryHash = buildQueryHash(p);
  if (from >= SAFE_FROM) {
    const cursor = getCursor(queryHash, from);
    if (cursor) { delete esParams.body.from; esParams.body.search_after = cursor; }
    else { esParams.body.from = Math.max(0, SAFE_FROM - size); }
  }

  logger.info('Executing Quora ad search', { from: esParams.body.from, size: esParams.body.size, sortField: sort.field });

  try {
    const result = await db.elastic.search(esParams);
    const hits = result.hits || result.body?.hits;
    const total = typeof hits.total === 'object' ? hits.total.value : hits.total;
    const esHits = (hits.hits || []);
    saveCursor(queryHash, from, size, esHits);
    if (esHits.length === 0) return { code: 200, data: [], total, message: 'No ads found' };

    const adIds = esHits.map(hit => hit._source['quora_ad.id'] || hit._id);

    // Language map for resolving ES `lang_detect` codes → names. Loaded once,
    // then used below in place of the stale `quora_ad.language_id` join.
    let langMap = null;
    if (db.sql) {
      try { langMap = await getLanguageMap(db.sql); } catch (_) { langMap = null; }
    }

    let finalAds = [];
    if (db.sql) {
      try {
        const ph = adIds.map(() => '?').join(',');
        const sql = `SELECT ${AD_DETAIL_SELECT} ${AD_DETAIL_JOINS} WHERE quora_ad.id IN (${ph}) ORDER BY FIELD(quora_ad.id, ${ph})`;
        const rawRows = await db.sql.query(sql, [...adIds, ...adIds]);
        const sqlRows = dedupeRows(rawRows);
        const esMap = new Map(esHits.map(hit => [String(hit._source['quora_ad.id'] || hit._id), hit]));
        finalAds = sqlRows.map(row => {
          const esHit = esMap.get(String(row.ad_id));
          if (!esHit) return row;
          const src = esHit._source || {};
          if (src.new_nas_image_url) row.image_video_url = src.new_nas_image_url;
          if (src['quora_ad.days_running'] !== undefined) row.days_running = src['quora_ad.days_running'];
          return row;
        });
      } catch (sqlErr) {
        logger.warn('SQL fetch failed, falling back to ES raw data', { error: sqlErr.message });
        finalAds = esHits.map(hit => hit._source);
      }
    } else { finalAds = esHits.map(hit => hit._source); }


    const esMap2 = new Map(esHits.map(hit => [String(hit._source['quora_ad.id'] || hit._id), hit._source]));
    finalAds = finalAds.map(ad => {
      const src = esMap2.get(String(ad.ad_id || ad.id)) || {};
      return {
        ...ad,
        // Language is ES-only — must agree with the language FILTER, which
        // only ever matches `lang_detect`. Never fall back to the stale SQL
        // `languages` join (`ad.language`, inherited via the spread above).
        language: (src['lang_detect'] && langMap) ? resolveLanguageName(langMap, src['lang_detect']) : null,
        lang_detect: src['lang_detect'] || null,
        // CTA: prefer ES `quora_call_to_action.call_to_action` — that's the field the CTA
        // FILTER matches, and it holds the current scrape's value (the Node pipeline writes
        // CTA only to ES; the SQL quora_call_to_action join is empty for API-ingested ads
        // and stale for older ones). Preferring SQL made the displayed CTA diverge from the
        // filter (e.g. "Learn More" filter returning an ad showing "Continue reading").
        // Fall back to the SQL value only when ES has none.
        call_to_action: src['quora_call_to_action.call_to_action'] || ad.call_to_action || null,
        // Destination URL: the quora_ad_meta_data insert is deferred in the Node
        // pipeline, so SQL is empty for API-ingested ads while ES has it. Overlay the
        // ES value onto the top-level field the frontend reads (ad.destinationUrl) —
        // otherwise the CTA button is disabled ("lacks a Destination URL") for those ads.
        destination_url: ad.destination_url || src['quora_ad_meta_data.destination_url'] || null,
        market_platform_urls: {
          url_destination: src['quora_ad_url.url_destination']         || null,
          source_url:      src['quora_ad_outgoing_links.source_url']   || null,
          redirect_url:    src['quora_ad_outgoing_links.redirect_url'] || null,
          final_url:       src['quora_ad_outgoing_links.final_url']    || null,
          url_redirects:   src['quora_ad_url.url_redirects']           || null,
          destination_url: src['quora_ad_meta_data.destination_url']   || null,
        },
      };
    });

    return { code: 200, data: cleanAdsData(finalAds), total, message: 'Ads fetched successfully' };
  } catch (err) {
    logger.error('Error in searchAds (quora)', { error: err.message, stack: err.stack });
    return { code: 500, message: 'Error occurred in ad search', error: err.message };
  }
}

module.exports = { searchAds, AD_DETAIL_SELECT, AD_DETAIL_JOINS };
