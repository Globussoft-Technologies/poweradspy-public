'use strict';

const NativeSearchQueryBuilder = require('../builders/NativeSearchQueryBuilder');
const { normalizeParams, ensureArray, parsePagination, parseSort, cleanAdsData } = require('../helpers/paramParser');
const { SAFE_FROM, buildQueryHash, saveCursor, getCursor } = require('../../../utils/searchCursorCache');

// Shared SQL fragment for fetching full native ad details by IDs
const AD_DETAIL_SELECT = `
    native_ad.id                                    AS id,
    native_ad.id                                    AS ad_id,
    native_ad.type                                  AS type,
    native_ad.ad_position                           AS ad_position,
    native_ad.ad_sub_position                       AS ad_sub_position,
    native_ad.post_date                             AS post_date,
    native_ad.first_seen                            AS first_seen,
    native_ad.last_seen                             AS last_seen,
    native_ad.days_running                          AS days_running,
    native_ad.post_owner_id                         AS post_owner_id,
    native_ad_post_owners.post_owner_name           AS post_owner,
    native_ad_post_owners.post_owner_image          AS post_owner_image,
    native_ad_meta_data.destination_url              AS destination_url,
    native_ad_meta_data.built_with                  AS built_with,
    native_ad_meta_data.built_with_analytics_tracking AS built_with_analytics_tracking,
    native_ad_meta_data.affiliate_data              AS affiliate_data,
    native_ad_variants.title                        AS ad_title,
    native_ad_variants.text                         AS ad_text,
    native_ad_variants.newsfeed_description         AS news_feed_description,
    native_ad_variants.image_url                    AS image_video_url,
    native_ad_outgoing_links.source_url             AS source_url,
    native_ad_outgoing_links.redirect_url           AS redirect_url,
    native_ad_outgoing_links.final_url              AS final_url,
    native_ad_domains.domain                        AS domain,
    native_ad_domains.domain_registered_date        AS domain_registered_date,
    (SELECT GROUP_CONCAT(DISTINCT nc.country)
     FROM native_ad_countries_only naco
     JOIN native_country_only nc ON naco.country_only_id = nc.id
     WHERE naco.native_ad_id = native_ad.id)         AS country,
    (SELECT GROUP_CONCAT(DISTINCT net.network)
     FROM native_ad_network nan
     JOIN networks net ON nan.network_id = net.id
     WHERE nan.native_ad_id = native_ad.id)          AS ad_network
`;

const AD_DETAIL_JOINS = `
FROM native_ad
LEFT JOIN native_ad_post_owners
    ON native_ad.post_owner_id = native_ad_post_owners.id
LEFT JOIN native_ad_meta_data
    ON native_ad.id = native_ad_meta_data.native_ad_id
LEFT JOIN native_ad_variants
    ON native_ad.id = native_ad_variants.native_ad_id
LEFT JOIN native_ad_outgoing_links
    ON native_ad.id = native_ad_outgoing_links.native_ad_id
LEFT JOIN native_ad_domains
    ON native_ad.domain_id = native_ad_domains.id
`;

/**
 * Map raw ES source fields to the same clean field names produced by AD_DETAIL_SELECT.
 * Used as fallback when SQL is unavailable or times out.
 */
function mapEsSourceToAd(src) {
  const id = src['native_ad.id'] || null;
  const imageUrl = src['native_ad.nas_url'] || src['new_nas_image_url'] || src['native_ad_variants.image_url'] || null;

  return {
    id,
    ad_id:                        id,
    type:                         src['native_ad.type']                              || null,
    ad_position:                  src['native_ad.ad_position']                       || null,
    ad_sub_position:              src['native_ad.ad_sub_position']                   || null,
    post_date:                    src['native_ad.post_date']                         || null,
    first_seen:                   src['native_ad.first_seen']                        || null,
    last_seen:                    src['native_ad.last_seen']                         || null,
    post_owner_id:                src['native_ad.post_owner_id']                     || null,
    post_owner:                   src['native_ad_post_owners.post_owner_name']       || null,
    post_owner_image:             src['native_ad_post_owners.post_owner_image']      || null,
    destination_url:              src['native_ad_meta_data.destination_url']         || null,
    built_with:                   src['native_ad_meta_data.built_with']              || null,
    built_with_analytics_tracking: src['native_ad_meta_data.built_with_analytics_tracking'] || null,
    affiliate_data:               src['native_ad_meta_data.affiliate_data']          || null,
    ad_title:                     src['native_ad_variants.title']                    || null,
    ad_text:                      src['native_ad_variants.text']                     || null,
    news_feed_description:        src['native_ad_variants.newsfeed_description']     || null,
    image_video_url:              imageUrl,
    source_url:                   src['native_ad_outgoing_links.source_url']         || null,
    redirect_url:                 src['native_ad_outgoing_links.redirect_url']       || null,
    final_url:                    src['native_ad_outgoing_links.final_url']          || null,
    domain:                       src['native_ad_domains.domain']                    || null,
    domain_registered_date:       src['native_ad_domains.domain_registered_date']   || null,
    country:                      src['native_country_only.country']                 || null,
    ad_network:                   src['networks.network']                            || null,
  };
}

/**
 * Deduplicate rows by ad_id (JOINs can produce duplicates)
 */
function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter(r => {
    if (seen.has(r.ad_id)) return false;
    seen.add(r.ad_id);
    return true;
  });
}

// ─── Favorite / Hidden search helpers ───────────────────

async function enrichAndFilterRows(rows, db, esIndex, typeField, nasField) {
  if (!db.elastic || rows.length === 0) return rows;
  try {
    const ids = rows.map(r => r.ad_id).filter(Boolean);
    const result = await db.elastic.search({
      index: esIndex,
      body: {
        query: { terms: { 'native_ad.id': ids.map(Number) } },
        size: ids.length,
        _source: [nasField, typeField, 'native_ad.id'],
      },
    });
    const hits = result.hits || result.body?.hits;
    const esMap = new Map((hits?.hits || []).map(h => [String(h._source['native_ad.id']), h._source]));
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

    const favRows = await db.sql.query(
      'SELECT ad_id FROM native_hidden_ads WHERE user_id = ? AND type = 3',
      [p.user_id]
    );
    const adIds = favRows.map(r => r.ad_id).filter(Boolean);
    if (adIds.length === 0) return { code: 200, data: [], total: 0, message: 'No favorite ads found' };

    const esIndex = db.elastic?.indexName || 'native_search_mix';
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
      const placeholders = batchIds.map(() => '?').join(',');
      const sql = `SELECT ${AD_DETAIL_SELECT}
    ${AD_DETAIL_JOINS}
    WHERE native_ad.id IN (${placeholders})
    ORDER BY FIELD(native_ad.id, ${placeholders})`;
      const rows = await db.sql.query(sql, [...batchIds, ...batchIds]);
      const enriched = await enrichAndFilterRows(dedupeRows(rows), db, esIndex, 'native_ad.type', 'native_ad.nas_url');
      validRows = validRows.concat(enriched);
    }

    return { code: 200, data: cleanAdsData(validRows.slice(0, take)), total: adIds.length, message: 'Favorite ads fetched successfully' };
  } catch (err) {
    logger.error('Error in searchFavoriteAds (native)', { error: err.message });
    return { code: 500, message: 'Error fetching favorite ads', error: err.message };
  }
}

async function searchHiddenAds(p, db, logger) {
  try {
    if (!db.sql) return { code: 503, message: 'SQL connection not available' };

    const hiddenRows = await db.sql.query(
      'SELECT ad_id, post_owner_id, type FROM native_hidden_ads WHERE user_id = ? AND (type = 1 OR type = 2)',
      [p.user_id]
    );
    const hiddenMeta = {};
    for (const r of hiddenRows) {
      if (r.ad_id) hiddenMeta[String(r.ad_id)] = { hideType: r.type, postOwnerId: r.post_owner_id };
    }
    const adIds = hiddenRows.map(r => r.ad_id).filter(Boolean);
    if (adIds.length === 0) return { code: 200, data: [], total: 0, message: 'No hidden ads found' };

    const esIndex = db.elastic?.indexName || 'native_search_mix';
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
      const placeholders = batchIds.map(() => '?').join(',');
      const sql = `SELECT ${AD_DETAIL_SELECT}
    ${AD_DETAIL_JOINS}
    WHERE native_ad.id IN (${placeholders})
    ORDER BY FIELD(native_ad.id, ${placeholders})`;
      const rows = await db.sql.query(sql, [...batchIds, ...batchIds]);
      const enriched = await enrichAndFilterRows(dedupeRows(rows), db, esIndex, 'native_ad.type', 'native_ad.nas_url');
      validRows = validRows.concat(enriched);
    }

    const cleanedData = cleanAdsData(validRows.slice(0, take)).map(ad => {
      const meta = hiddenMeta[String(ad.ad_id || ad.id)] || {};
      const hideType = meta.hideType ?? 2;
      return { ...ad, hideType, ad_type: hideType, hiddenPostOwnerId: meta.postOwnerId ?? null };
    });
    return { code: 200, data: cleanedData, total: adIds.length, message: 'Hidden ads fetched successfully' };
  } catch (err) {
    logger.error('Error in searchHiddenAds (native)', { error: err.message });
    return { code: 500, message: 'Error fetching hidden ads', error: err.message };
  }
}

/**
 * Main Native ad search handler.
 */
async function searchAds(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.user_id) {
    return { code: 400, message: 'Missing params: user_id is required' };
  }

  // ─── Early-return for special search modes ────────────
  if (p.favorite === 'true') return searchFavoriteAds(p, db, logger);
  if (p.hidden === 'true') return searchHiddenAds(p, db, logger);

  if (!db.elastic) {
    return { code: 503, message: 'Elasticsearch connection not available' };
  }

  const { size, from } = parsePagination(p);
  const sort = parseSort(p);

  // ─── Build ES query ───────────────────────────────────
  const builder = new NativeSearchQueryBuilder(db.elastic?.indexName);

  builder
    .setFrom(from)
    .setSize(size)
    .setSortField(sort.field)
    .setSortMethod(sort.order)
    .setIpBasedCountry(p.ipBasedCountry || 'NA');

  // Status always [1] for native (active ads only)
  builder.setStatus([1]);

  // ─── Search text fields ───────────────────────────────
  if (p.keyword)     builder.setKeyword(p.keyword);
  if (p.advertiser)  builder.setPostOwnerName(p.advertiser);
  if (p.domain)      builder.setUrl(p.domain);

  // ─── Filter fields ────────────────────────────────────
  if (p.call_to_action)   builder.setCallToAction(ensureArray(p.call_to_action));
  if (p.adcategory)       builder.setAdCategory(ensureArray(p.adcategory));
  if (p.subCategory)      builder.setSubCategory(ensureArray(p.subCategory));
  if (p.category)         builder.setCategory(ensureArray(p.category));
  if (p.country)          builder.setCountry(ensureArray(p.country));
  if (p.state)            builder.setState(ensureArray(p.state));
  if (p.city)             builder.setCity(ensureArray(p.city));
  if (p.type)             builder.setAdType(ensureArray(p.type));
  if (p.target_keywords)  builder.setTargetKeyword(ensureArray(p.target_keywords));
  if (p.tags)             builder.setTags(ensureArray(p.tags));
  if (p.lang)             builder.setLangDetect(ensureArray(p.lang));

  // Network filter (native-specific ad network, e.g. Taboola/Outbrain — frontend sends as nativeNetwork)
  const networkVal = p.nativeNetwork || p.ad_network;
  if (networkVal && networkVal !== 'N/A') {
    builder.setNetwork(ensureArray(networkVal));
  }

  const adPositionArr = p.ad_position ? ensureArray(p.ad_position) : [];
  if (adPositionArr.length > 0) {
    builder.setAdPosition(adPositionArr);
  }
  if (p.ad_sub_position) builder.setAdSubPosition(ensureArray(p.ad_sub_position));

  if (p.gender) builder.setGender(ensureArray(p.gender));

  // ─── Age range ────────────────────────────────────────
  if (p.lower_age && p.upper_age) {
    builder.setLowerAgeSeen({ lower_age: p.lower_age, upper_age: p.upper_age });
  }

  // ─── Date ranges ──────────────────────────────────────
  const tsToDate = (ts, time) => new Date(Number(ts) * 1000).toISOString().slice(0, 10) + ' ' + time;
  if (Array.isArray(p.seen_btn_sort) && p.seen_btn_sort.length === 2) {
    builder.setLastSeen({ lower_date: tsToDate(p.seen_btn_sort[1], '00:00:00'), upper_date: tsToDate(p.seen_btn_sort[0], '23:59:59') });
  }
  if (Array.isArray(p.post_date_btn_sort) && p.post_date_btn_sort.length === 2) {
    builder.setPostDate({ lower_date: tsToDate(p.post_date_btn_sort[1], '00:00:00'), upper_date: tsToDate(p.post_date_btn_sort[0], '23:59:59') });
  }
  if (Array.isArray(p.domain_date_btn_sort) && p.domain_date_btn_sort.length === 2) {
    const tsToDay = ts => new Date(Number(ts) * 1000).toISOString().slice(0, 10);
    builder.setDomainDate({ lower_date: tsToDay(p.domain_date_btn_sort[1]), upper_date: tsToDay(p.domain_date_btn_sort[0]) });
  }

  // ─── Lander properties ────────────────────────────────
  if (p.ecommerce)        builder.setBuiltWith(ensureArray(p.ecommerce));
  if (p.track)            builder.setTrack(ensureArray(p.track));
  if (p.source)           builder.setSource(ensureArray(p.source));
  if (p.funnel)           builder.setFunnel(ensureArray(p.funnel));
  if (p.affiliate)        builder.setAffiliate(ensureArray(p.affiliate));
  if (p.market_platform)  builder.setMarketPlatform(ensureArray(p.market_platform));

  // ─── Engagement range filters ─────────────────────────
  if (p.likes && Array.isArray(p.likes))       builder.setLikes(p.likes);
  if (p.comments && Array.isArray(p.comments)) builder.setComments(p.comments);

  // ─── Image analysis filters ───────────────────────────
  if (p.ocr)              builder.setOcr(p.ocr);
  if (p.image_celebrity)  builder.setCelebrity(ensureArray(p.image_celebrity));
  if (p.image_object)     builder.setImageObject(ensureArray(p.image_object));
  if (p.image_logo)       builder.setLogo(ensureArray(p.image_logo));

  // ─── Other text fields ────────────────────────────────
  if (p.html_content)     builder.setHtmlContent(p.html_content);

  // ─── Needle (cursor for avoiding realtime new ads) ────
  if (p.needle) builder.setNeedle(p.needle);

  // ─── Ad detail exclusion (similar_ad_id) ──────────────
  if (p.similar_ad_id || p.adDetail_id) builder.setAdDetailId(p.similar_ad_id || p.adDetail_id);

  // ─── Not country ─────────────────────────────────────
  if (p.not_country) builder.setNotCountry(p.not_country);

  // Build and execute
  const esParams = builder.build();

  // ─── Deep pagination: swap from/size → search_after ──
  const queryHash = buildQueryHash(p);
  if (from >= SAFE_FROM) {
    const cursor = getCursor(queryHash, from);
    if (cursor) {
      delete esParams.body.from;
      esParams.body.search_after = cursor;
      logger.info('Deep pagination: using search_after', { from, cursor });
    } else {
      esParams.body.from = Math.max(0, SAFE_FROM - size);
      logger.warn('Deep pagination without cursor, capping', { requestedFrom: from, cappedTo: esParams.body.from });
    }
  }

  logger.info('Executing Native ad search', {
    from: esParams.body.from,
    size: esParams.body.size,
    sortField: sort.field,
  });
  try {
    const result = await db.elastic.search(esParams);
    const hits = result.hits || result.body?.hits;
    const total = typeof hits.total === 'object' ? hits.total.value : hits.total;
    const esHits = (hits.hits || []);

    // Cache cursor for next deep page
    saveCursor(queryHash, from, size, esHits);

    if (esHits.length === 0) {
      return { code: 200, data: [], total, message: 'No ads found' };
    }

    // ─── Fetch detailed metadata from SQL ────────────────
    const adIds = esHits.map(hit => hit._source['native_ad.id'] || hit._id);

    let finalAds = [];
    if (db.sql) {
      try {
        const placeholders = adIds.map(() => '?').join(',');
        const sql = `SELECT ${AD_DETAIL_SELECT}
${AD_DETAIL_JOINS}
WHERE native_ad.id IN (${placeholders})
ORDER BY FIELD(native_ad.id, ${placeholders})
`;

        const rawRows = await db.sql.query(sql, [...adIds, ...adIds]);
        const sqlRows = dedupeRows(rawRows);

        // Build ES lookup map
        const esMap = new Map(
          esHits.map(hit => {
            const id = hit._source['native_ad.id'] || hit._id;
            return [String(id), hit];
          })
        );

        finalAds = sqlRows.map(row => {
          const esHit = esMap.get(String(row.ad_id));
          if (!esHit) return row;

          const src = esHit._source || {};

          // Overlay NAS image URL
          if (src['native_ad.nas_url']) {
            row.image_video_url = src['native_ad.nas_url'];
          } else if (src.new_nas_image_url) {
            row.image_video_url = src.new_nas_image_url;
          }
          if (src['native_ad.days_running'] !== undefined) row.days_running = src['native_ad.days_running'];

          return row;
        });

      } catch (sqlErr) {
        logger.warn('SQL fetch failed, falling back to ES mapped data', { error: sqlErr.message });
        finalAds = esHits.map(hit => mapEsSourceToAd(hit._source || {}));
      }
    } else {
      finalAds = esHits.map(hit => mapEsSourceToAd(hit._source || {}));
    }

      const esMap2 = new Map(esHits.map(hit => [String(hit._source['native_ad.id'] || hit._id), hit._source]));
      finalAds = finalAds.map(ad => {
        const src = esMap2.get(String(ad.ad_id || ad.id)) || {};
        return {
          ...ad,
          market_platform_urls: {
            url_destination: src['native_ad_url.url_destination']         || null,
            source_url:      src['native_ad_outgoing_links.source_url']   || null,
            redirect_url:    src['native_ad_outgoing_links.redirect_url'] || null,
            final_url:       src['native_ad_outgoing_links.final_url']    || null,
            url_redirects:   src['native_ad_url.url_redirects']           || null,
            redirect_urls:   src['native_ad_meta_data.redirect_url']      || null,
            destination_url: src['native_ad_meta_data.destination_url']   || null,
          },
        };
      });


    return {
      code: 200,
      data: cleanAdsData(finalAds),
      total,
      message: 'Ads fetched successfully',
    };
  } catch (err) {
    logger.error('Error in searchAds (native)', { error: err.message, stack: err.stack });
    return {
      code: 500,
      message: 'Error occurred in ad search',
      error: err.message,
    };
  }
}

module.exports = { searchAds, AD_DETAIL_SELECT, AD_DETAIL_JOINS };
