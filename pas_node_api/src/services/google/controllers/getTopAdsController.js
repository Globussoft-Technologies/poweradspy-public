'use strict';

const GoogleSearchQueryBuilder = require('../builders/GoogleSearchQueryBuilder');
const { normalizeParams, ensureArray, parsePagination, parseSort, cleanAdsData } = require('../helpers/paramParser');
const { SAFE_FROM, buildQueryHash, saveCursor, getCursor } = require('../../../utils/searchCursorCache');

const AD_DETAIL_SELECT = `
    google_text_ad.id                                       AS id,
    google_text_ad.id                                       AS ad_id,
    google_text_ad.type                                     AS type,
    google_text_ad.ad_sub_position                          AS ad_sub_position,
    google_text_ad.post_owner_id                            AS post_owner_id,
    UNIX_TIMESTAMP(google_text_ad.post_date)                AS post_date,
    DATE(google_text_ad.last_seen)                          AS last_seen,
    DATE(google_text_ad.first_seen)                         AS first_seen,
    google_text_ad_post_owners.post_owner_name              AS post_owner,
    google_text_ad_post_owners.post_owner_image             AS post_owner_image,
    google_text_ad_meta_data.destination_url                 AS destination_url,
    google_text_ad_meta_data.g_temp_url                     AS g_temp_url,
    google_text_ad_meta_data.platform                       AS platform,
    google_text_ad_meta_data.built_with                     AS built_with,
    google_text_ad_meta_data.built_with_analytics_tracking  AS built_with_analytics_tracking,
    google_text_ad_meta_data.affiliate_data                 AS affiliate_data,
    google_text_ad_variants.title                           AS ad_title,
    google_text_ad_variants.text                            AS ad_text,
    google_text_ad_variants.newsfeed_description             AS news_feed_description,
    google_text_ad_variants.target_keyword                  AS target_keyword,
    google_text_ad_variants.target_page                     AS target_page,
    google_text_ad_variants.image_url                       AS image_video_url
`;

const AD_DETAIL_JOINS = `
FROM google_text_ad
LEFT JOIN google_text_ad_post_owners ON google_text_ad.post_owner_id = google_text_ad_post_owners.id
LEFT JOIN google_text_ad_meta_data   ON google_text_ad.id = google_text_ad_meta_data.google_text_ad_id
LEFT JOIN google_text_ad_variants    ON google_text_ad.id = google_text_ad_variants.google_text_ad_id
LEFT JOIN google_text_ad_domains     ON google_text_ad.domain_id = google_text_ad_domains.id
`;

function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter(r => { if (seen.has(r.ad_id)) return false; seen.add(r.ad_id); return true; });
}

async function getTopAds(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);
  if (!p.user_id) return { code: 400, message: 'Missing params: user_id is required' };
  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  const { size, from } = parsePagination(p);
  const sort = parseSort(p);
  const builder = new GoogleSearchQueryBuilder(db.elastic?.indexName);
  builder.setFrom(from).setSize(size).setSortField(sort.field).setSortMethod(sort.order).setIpBasedCountry(p.ipBasedCountry || 'NA');

  // Search text fields — v2 clean content_analyzer (no edge_ngram). exact_search
  // (frontend "Search Precisely") + quoted input → phrase; applies to keyword + advertiser.
  builder.setExactSearch(p.exact_search === 1 || p.exact_search === '1' || p.exact_search === true);
  if (p.keyword)          builder.setKeyword(p.keyword);
  if (p.advertiser || p.advertisername) builder.setPostOwnerName(p.advertiser || p.advertisername);
  if (p.domain || p.domainname)        builder.setUrl(p.domain || p.domainname);

  // Filters
  if (p.call_to_action || p.callToAction) builder.setCallToAction(ensureArray(p.call_to_action || p.callToAction));
  if (p.adcategory)       builder.setAdCategory(ensureArray(p.adcategory));
  if (p.subCategory)      builder.setSubCategory(ensureArray(p.subCategory));
  if (p.country)          builder.setCountry(ensureArray(p.country));
  if (p.state)            builder.setState(ensureArray(p.state));
  if (p.city)             builder.setCity(ensureArray(p.city));
  if (p.type)             builder.setAdType(ensureArray(p.type));
  if (p.target_keywords)  builder.setTargetKeyword(ensureArray(p.target_keywords));
  if (p.tags)             builder.setTags(ensureArray(p.tags));
  if (p.lang)             builder.setLangDetect(ensureArray(p.lang));

  const apArr = p.ad_position || p.position ? ensureArray(p.ad_position || p.position) : [];
  if (apArr.length > 0) builder.setAdPosition(apArr);
  if (p.ad_sub_position || p.subposition) builder.setAdSubPosition(ensureArray(p.ad_sub_position || p.subposition));
  if (p.gender) builder.setGender(ensureArray(p.gender));
  if (p.lower_age && p.upper_age) builder.setLowerAgeSeen({ lower_age: p.lower_age, upper_age: p.upper_age });

  // Date ranges
  if (Array.isArray(p.seen_btn_sort) && p.seen_btn_sort.length === 2) builder.setLastSeen({ lower_date: p.seen_btn_sort[0], upper_date: p.seen_btn_sort[1] });
  if (Array.isArray(p.post_date_btn_sort) && p.post_date_btn_sort.length === 2) builder.setPostDate({ lower_date: p.post_date_btn_sort[0], upper_date: p.post_date_btn_sort[1] });
  if (Array.isArray(p.domain_date_btn_sort) && p.domain_date_btn_sort.length === 2) builder.setDomainDate({ lower_date: p.domain_date_btn_sort[0], upper_date: p.domain_date_btn_sort[1] });

  // Lander properties — v2 clean keyword fields → term-match raw values directly.
  if (p.ecommerce)       builder.setBuiltWith(ensureArray(p.ecommerce));
  if (p.track)           builder.setTrack(ensureArray(p.track));
  if (p.source)          builder.setSource(ensureArray(p.source));
  if (p.funnel)          builder.setFunnel(ensureArray(p.funnel));
  if (p.affiliate)       builder.setAffiliate(ensureArray(p.affiliate));
  if (p.market_platform) builder.setMarketPlatform(ensureArray(p.market_platform));

  // Other
  if (p.html_content || p.html_feild) builder.setHtmlContent(p.html_content || p.html_feild);
  if (p.needle)          builder.setNeedle(p.needle);
  if (p.similar_ad_id || p.adDetail_id) builder.setAdDetailId(p.similar_ad_id || p.adDetail_id);
  if (p.not_country)     builder.setNotCountry(p.not_country);

  const esParams = builder.build();
  const queryHash = buildQueryHash(p);
  if (from >= SAFE_FROM) {
    const cursor = getCursor(queryHash, from);
    if (cursor) { delete esParams.body.from; esParams.body.search_after = cursor; }
    else { esParams.body.from = Math.max(0, SAFE_FROM - size); }
  }

  logger.info('Executing Google ad search', { from: esParams.body.from, size: esParams.body.size, sortField: sort.field });

  try {
    const result = await db.elastic.search(esParams);
    const hits = result.hits || result.body?.hits;
    const total = typeof hits.total === 'object' ? hits.total.value : hits.total;
    const esHits = (hits.hits || []);
    saveCursor(queryHash, from, size, esHits);
    if (esHits.length === 0) return { code: 200, data: [], total, message: 'No ads found' };

    // Google ES uses flat field `id` or `ad_id`
    const adIds = esHits.map(hit => hit._source?.['id'] || hit._source?.['ad_id'] || hit._id);
    let finalAds = [];
    if (db.sql) {
      try {
        const ph = adIds.map(() => '?').join(',');
        const rawRows = await db.sql.query(`SELECT ${AD_DETAIL_SELECT} ${AD_DETAIL_JOINS} WHERE google_text_ad.id IN (${ph}) ORDER BY FIELD(google_text_ad.id, ${ph})`, [...adIds, ...adIds]);
        const sqlRows = dedupeRows(rawRows);
        const esMap = new Map(esHits.map(hit => [String(hit._source?.['id'] || hit._source?.['ad_id'] || hit._id), hit]));
        finalAds = sqlRows.map(row => {
          const esHit = esMap.get(String(row.ad_id)); if (!esHit) return row;
          const src = esHit._source || {};
          if (src.new_nas_image_url) row.image_video_url = src.new_nas_image_url;
          if (src.country) row.country = Array.isArray(src.country) ? src.country.join(', ') : src.country;
          return row;
        });
      } catch (sqlErr) {
        logger.warn('SQL fetch failed, falling back to ES', { error: sqlErr.message });
        finalAds = esHits.map(hit => { const src = hit._source || {}; const id = src.id || src.ad_id || hit._id; return { ...src, id, ad_id: id }; });
      }
    } else {
      finalAds = esHits.map(hit => { const src = hit._source || {}; const id = src.id || src.ad_id || hit._id; return { ...src, id, ad_id: id }; });
    }

    return { code: 200, data: cleanAdsData(finalAds), total, message: 'Ads fetched successfully' };
  } catch (err) {
    logger.error('Error in getTopAds (google)', { error: err.message, stack: err.stack });
    return { code: 500, message: 'Error occurred in ad search', error: err.message };
  }
}

module.exports = { getTopAds };
