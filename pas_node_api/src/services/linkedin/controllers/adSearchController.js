'use strict';

const LinkedinSearchQueryBuilder = require('../builders/LinkedinSearchQueryBuilder');
const { normalizeParams, ensureArray, parsePagination, parseSort, cleanAdsData } = require('../helpers/paramParser');
const { SAFE_FROM, buildQueryHash, saveCursor, getCursor } = require('../../../utils/searchCursorCache');
const { getLanguageMap, resolveLanguageName } = require('../../../utils/languageMap');
const { applyAiMetaFilters } = require('../../common/helpers/aiMetaSearchFilter');

// Shared SQL fragment for fetching full ad details by IDs
const AD_DETAIL_SELECT = `
    linkedin_ad.id                                  AS id,
    linkedin_ad.id                                  AS ad_id,
    linkedin_ad.type                                AS type,
    linkedin_ad.ad_position                         AS ad_position,
    linkedin_ad.post_date                           AS post_date,
    linkedin_ad.last_seen                           AS last_seen,
    linkedin_ad.post_owner_id                       AS post_owner_id,
    linkedin_ad_analytics.likes                     AS likes,
    linkedin_ad_analytics.comments                  AS comments,
    linkedin_ad_analytics.followers                 AS followers,
    linkedin_ad_post_owners.post_owner_image        AS post_owner_image,
    linkedin_ad_post_owners.post_owner_name         AS post_owner,
    linkedin_ad_meta_data.destination_url            AS destination_url,
    linkedin_ad_meta_data.ad_url                    AS ad_url,
    linkedin_ad_meta_data.platform                  AS platform,
    linkedin_ad_built_with.affiliate_data           AS affiliate_data,
    linkedin_ad_built_with.built_with_analytics_tracking AS built_with_analytics_tracking,
    linkedin_ad_variants.title                      AS ad_title,
    linkedin_ad_variants.text                       AS ad_text,
    linkedin_ad_variants.newsfeed_description       AS news_feed_description,
    linkedin_ad_variants.image_url                  AS image_video_url,
    linkedin_ad_variants.image_url_original         AS image_url_original,
    linkedin_ad_image_video.ad_image_video          AS ad_image_video,
    linkedin_call_to_actions.action                 AS call_to_action,
    linkedin_ad_url.country_code                    AS country_code,
    linkedin_ad_domains.domain                      AS domain,
    linkedin_ad_domains.domain_registered_date      AS domain_registered_date
`;

const AD_DETAIL_JOINS = `
FROM linkedin_ad
LEFT JOIN linkedin_ad_post_owners
    ON linkedin_ad.post_owner_id = linkedin_ad_post_owners.id
LEFT JOIN linkedin_ad_image_video
    ON linkedin_ad.id = linkedin_ad_image_video.linkedin_ad_id
LEFT JOIN linkedin_ad_meta_data
    ON linkedin_ad.id = linkedin_ad_meta_data.linkedin_ad_id
LEFT JOIN linkedin_ad_url
    ON linkedin_ad.id = linkedin_ad_url.linkedin_ad_id
LEFT JOIN linkedin_ad_variants
    ON linkedin_ad.id = linkedin_ad_variants.linkedin_ad_id
LEFT JOIN linkedin_ad_domains
    ON linkedin_ad.domain_id = linkedin_ad_domains.id
LEFT JOIN linkedin_ad_built_with
    ON linkedin_ad.id = linkedin_ad_built_with.linkedin_ad_id
LEFT JOIN linkedin_ad_analytics
    ON linkedin_ad.id = linkedin_ad_analytics.linkedin_ad_id
LEFT JOIN linkedin_call_to_actions
    ON linkedin_ad.call_to_action_id = linkedin_call_to_actions.id
`;

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

/**
 * Enrich SQL ad rows with NAS image URL from ES.
 * Filters out IMAGE ads that don't have a NAS url.
 * Non-IMAGE ads pass through untouched.
 */
async function enrichAndFilterRows(rows, db, esIndex, typeField) {
  if (!db.elastic || rows.length === 0) return rows;
  try {
    const ids = rows.map(r => r.ad_id).filter(Boolean);
    const result = await db.elastic.search({
      index: esIndex,
      body: {
        query: { terms: { _id: ids.map(String) } },
        size: ids.length,
        _source: ['new_nas_image_url', typeField],
      },
    });
    const hits = result.hits || result.body?.hits;
    const esMap = new Map((hits?.hits || []).map(h => [String(h._id), h._source]));

    return rows.filter(row => {
      const src = esMap.get(String(row.ad_id)) || {};
      const adType = src[typeField] || row.type || '';
      const nasUrl = src.new_nas_image_url || '';

      if (adType === 'IMAGE') {
        if (nasUrl) {
          row.image_video_url = nasUrl;
          row.image_url_original = nasUrl;
          return true;
        }
        return false; // IMAGE without NAS url → filter out
      }
      return true; // non-IMAGE → keep as-is
    });
  } catch (err) {
    // If ES fails, return rows as-is — don't break favourite/hidden page
    return rows;
  }
}

async function searchFavoriteAds(p, db, logger) {
  try {
    if (!db.sql) return { code: 503, message: 'SQL connection not available' };

    const favRows = await db.sql.query(
      'SELECT ad_id FROM hidden_ads WHERE user_id = ? AND type = 3',
      [p.user_id]
    );
    const adIds = favRows.map(r => r.ad_id).filter(Boolean);
    if (adIds.length === 0) {
      return { code: 200, data: [], total: 0, message: 'No favorite ads found' };
    }

    // Buffered fetch with NAS filtering (up to 3 rounds)
    const esIndex = db.elastic?.indexName || 'linkedin_ads_data';
    const typeField = 'ad_type';
    const take = parseInt(p.take, 10) || 20;
    const skip = (parseInt(p.skip, 10) || 0) * take;
    const startIndex = skip;

    const MAX_ROUNDS = 3;
    let validRows = [];
    let cursor = startIndex;
    let rounds = 0;

    while (validRows.length < take && cursor < adIds.length && rounds < MAX_ROUNDS) {
      rounds++;
      const batchIds = adIds.slice(cursor, cursor + take);
      cursor += take;
      if (batchIds.length === 0) break;

      const placeholders = batchIds.map(() => '?').join(',');
      const sql = `SELECT ${AD_DETAIL_SELECT}
    ${AD_DETAIL_JOINS}
    WHERE linkedin_ad.id IN (${placeholders})
    ORDER BY FIELD(linkedin_ad.id, ${placeholders})`;

      const rows = await db.sql.query(sql, [...batchIds, ...batchIds]);
      const deduped = dedupeRows(rows);
      const enriched = await enrichAndFilterRows(deduped, db, esIndex, typeField);
      validRows = validRows.concat(enriched);
    }

    validRows = validRows.slice(0, take);

    return {
      code: 200,
      data: cleanAdsData(validRows),
      total: adIds.length,
      message: 'Favorite ads fetched successfully',
    };
  } catch (err) {
    logger.error('Error in searchFavoriteAds (linkedin)', { error: err.message });
    return { code: 500, message: 'Error fetching favorite ads', error: err.message };
  }
}

async function searchHiddenAds(p, db, logger) {
  try {
    if (!db.sql) return { code: 503, message: 'SQL connection not available' };

    const hiddenRows = await db.sql.query(
      'SELECT ad_id, post_owner_id, type FROM hidden_ads WHERE user_id = ? AND (type = 1 OR type = 2)',
      [p.user_id]
    );
    const hiddenMeta = {};
    for (const r of hiddenRows) {
      if (r.ad_id) hiddenMeta[String(r.ad_id)] = { hideType: r.type, postOwnerId: r.post_owner_id };
    }
    const adIds = hiddenRows.map(r => r.ad_id).filter(Boolean);
    if (adIds.length === 0) {
      return { code: 200, data: [], total: 0, message: 'No hidden ads found' };
    }

    // Buffered fetch with NAS filtering (up to 3 rounds)
    const esIndex = db.elastic?.indexName || 'linkedin_ads_data';
    const typeField = 'ad_type';
    const take = parseInt(p.take, 10) || 20;
    const skip = (parseInt(p.skip, 10) || 0) * take;
    const startIndex = skip;

    const MAX_ROUNDS = 3;
    let validRows = [];
    let cursor = startIndex;
    let rounds = 0;

    while (validRows.length < take && cursor < adIds.length && rounds < MAX_ROUNDS) {
      rounds++;
      const batchIds = adIds.slice(cursor, cursor + take);
      cursor += take;
      if (batchIds.length === 0) break;

      const placeholders = batchIds.map(() => '?').join(',');
      const sql = `SELECT ${AD_DETAIL_SELECT}
    ${AD_DETAIL_JOINS}
    WHERE linkedin_ad.id IN (${placeholders})
    ORDER BY FIELD(linkedin_ad.id, ${placeholders})`;

      const rows = await db.sql.query(sql, [...batchIds, ...batchIds]);
      const deduped = dedupeRows(rows);
      const enriched = await enrichAndFilterRows(deduped, db, esIndex, typeField);
      validRows = validRows.concat(enriched);
    }

    validRows = validRows.slice(0, take);

    const cleanedData = cleanAdsData(validRows).map(ad => {
      const meta = hiddenMeta[String(ad.ad_id || ad.id)] || {};
      const hideType = meta.hideType ?? 2;
      return { ...ad, hideType, ad_type: hideType, hiddenPostOwnerId: meta.postOwnerId ?? null };
    });

    return {
      code: 200,
      data: cleanedData,
      total: adIds.length,
      message: 'Hidden ads fetched successfully',
    };
  } catch (err) {
    logger.error('Error in searchHiddenAds (linkedin)', { error: err.message });
    return { code: 500, message: 'Error fetching hidden ads', error: err.message };
  }
}

/**
 * Main LinkedIn ad search handler.
 */
async function searchAds(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.user_id) {
    return { code: 400, message: 'Missing params: user_id is required' };
  }

  // ─── Early-return for special search modes ────────────
  if (p.favorite === 'true') return searchFavoriteAds(p, db, logger);
  if (p.hidden === 'true')   return searchHiddenAds(p, db, logger);

  if (!db.elastic) {
    return { code: 503, message: 'Elasticsearch connection not available' };
  }

  const { size, from } = parsePagination(p);
  const sort = parseSort(p);

  // ─── Build ES query ───────────────────────────────────
  const builder = new LinkedinSearchQueryBuilder(db.elastic?.indexName);
  builder
    .setFrom(from)
    .setSize(size)
    .setSortField(sort.field)
    .setSortMethod(sort.order)
    .setIpBasedCountry(p.ipBasedCountry || 'NA');

  if (p.status && Array.isArray(p.status) && p.status.length > 0) {
    builder.setStatus(p.status);
  }

  // ─── Search text fields ───────────────────────────────
  if (p.keyword)     builder.setKeyword(p.keyword);
  if (p.advertiser)  builder.setPostOwnerName(p.advertiser);
  if (p.domain)      builder.setUrl(p.domain);

  // ─── Filter fields ────────────────────────────────────
  if (p.call_to_action)   builder.setCallToAction(ensureArray(p.call_to_action));
  if (p.adcategory)       builder.setAdCategory(ensureArray(p.adcategory));
  if (p.subCategory)      builder.setSubCategory(ensureArray(p.subCategory));
  if (p.country)          builder.setCountry(ensureArray(p.country));
  if (p.state)            builder.setState(ensureArray(p.state));
  if (p.city)             builder.setCity(ensureArray(p.city));
  if (p.type)             builder.setAdType(ensureArray(p.type));
  if (p.target_keywords)  builder.setTargetKeyword(ensureArray(p.target_keywords));
  if (p.lang)             builder.setLangDetect(ensureArray(p.lang));

  const adPositionArr = p.ad_position ? ensureArray(p.ad_position) : [];
  if (adPositionArr.length > 0 && adPositionArr.length < 4) {
    builder.setAdPosition(adPositionArr);
  }
  if (p.ad_sub_position) builder.setAdSubPosition(ensureArray(p.ad_sub_position));

  if (p.gender) builder.setGender(ensureArray(p.gender));

  // ─── Verified ─────────────────────────────────────────
  if (p.verified !== '' && p.verified !== undefined && p.verified !== 'NA') {
    builder.setVerified(p.verified === '0' ? 0 : p.verified);
  }

  // ─── Age range ────────────────────────────────────────
  if (p.lower_age && p.upper_age) {
    builder.setLowerAgeSeen({ lower_age: p.lower_age, upper_age: p.upper_age });
  }

  // ─── Date ranges ──────────────────────────────────────
  if (Array.isArray(p.seen_btn_sort) && p.seen_btn_sort.length === 2) {
    builder.setLastSeen({ lower_date: Number(p.seen_btn_sort[1]), upper_date: Number(p.seen_btn_sort[0]) });
  }
  if (Array.isArray(p.post_date_btn_sort) && p.post_date_btn_sort.length === 2) {
    builder.setPostDate({ lower_date: Number(p.post_date_btn_sort[1]), upper_date: Number(p.post_date_btn_sort[0]) });
  }
  if (Array.isArray(p.domain_date_btn_sort) && p.domain_date_btn_sort.length === 2) {
    builder.setDomainDate({ lower_date: Number(p.domain_date_btn_sort[1]), upper_date: Number(p.domain_date_btn_sort[0]) });
  }

  // ─── Lander properties ────────────────────────────────
  if (p.ecommerce)        builder.setBuiltWith(ensureArray(p.ecommerce));
  if (p.track)            builder.setTrack(ensureArray(p.track));
  if (p.source)           builder.setSource(ensureArray(p.source));
  if (p.funnel)           builder.setFunnel(ensureArray(p.funnel));
  if (p.affiliate)        builder.setAffiliate(ensureArray(p.affiliate));
  if (p.market_platform)  builder.setMarketPlatform(ensureArray(p.market_platform));

  // ─── Engagement range filters ─────────────────────────
  if (p.likes && Array.isArray(p.likes))             builder.setLikes(p.likes);
  if (p.comments && Array.isArray(p.comments))       builder.setComments(p.comments);
  if (p.impressions && Array.isArray(p.impressions)) builder.setImpressions(p.impressions);
  if (p.popularity && Array.isArray(p.popularity))   builder.setPopularity(p.popularity);

  // ─── Image analysis filters ───────────────────────────
  if (p.ocr)              builder.setOcr(p.ocr);
  if (p.image_celebrity)  builder.setCelebrity(ensureArray(p.image_celebrity));
  if (p.image_object)     builder.setImageObject(ensureArray(p.image_object));
  if (p.image_logo)       builder.setLogo(ensureArray(p.image_logo));

  // ─── Other text fields ────────────────────────────────
  if (p.html_content)     builder.setHtmlContent(p.html_content);

  // ─── Needle (cursor for avoiding realtime new ads) ────
  if (p.needle) builder.setNeedle(p.needle);

  // ─── Ad detail exclusion ──────────────────────────────
  if (p.adDetail_id) builder.setAdDetailId(p.adDetail_id);

  // ─── Not country ─────────────────────────────────────
  if (p.not_country) builder.setNotCountry(p.not_country);

  // Build and execute
  const esParams = builder.build();
  applyAiMetaFilters(esParams, 'linkedin', p);
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

  logger.info('Executing LinkedIn ad search', {
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
    const adIds = esHits.map(hit => hit._id || hit._source['ad_id']);

    let finalAds = [];
    if (db.sql) {
      try {
        const placeholders = adIds.map(() => '?').join(',');
        const sql = `SELECT ${AD_DETAIL_SELECT}
${AD_DETAIL_JOINS}
WHERE linkedin_ad.id IN (${placeholders})
ORDER BY FIELD(linkedin_ad.id, ${placeholders})
`;

        const rawRows = await db.sql.query(sql, [...adIds, ...adIds]);
        const sqlRows = dedupeRows(rawRows);

        // ISO → language-name map for resolving ES ad_language (e.g. 'en' → 'English')
        const langMap = await getLanguageMap(db.sql);

        // Build ES lookup map
        const esMap = new Map(
          esHits.map(hit => {
            const id = hit._id || hit._source['ad_id'];
            return [String(id), hit];
          })
        );

        finalAds = sqlRows.map(row => {
          const esHit = esMap.get(String(row.ad_id));
          if (!esHit) return row;

          const src = esHit._source || {};

          // Overlay NAS image URL
          if (src.new_nas_image_url) {
            row.image_video_url = src.new_nas_image_url;
          }

          // Language from ES ad_language ISO (e.g. 'en' → 'English')
          if (src['ad_language']) {
            row.language = resolveLanguageName(langMap, src['ad_language']);
          }

          // Ecommerce platform from ES
          if (src['ecommerce_platform']) {
            row.built_with = src['ecommerce_platform'];
          }

          // Merge live ES engagement data
          if (src.reactions?.likes !== undefined)    row.likes = src.reactions.likes;
          if (src['comments'] !== undefined)         row.comments = src['comments'];
          if (src['impression'] !== undefined)       row.impression = src['impression'];
          if (src['verified'] !== undefined)         row.verified = src['verified'];
          if (src['first_seen'] !== undefined)       row.first_seen = src['first_seen'];
          if (src['duration'] !== undefined)         row.days_running = src['duration'];

          // Popularity from ES
          if (src.popularity?.current !== undefined) {
            row.popularity = JSON.stringify({
              max: src.popularity.max,
              current: src.popularity.current,
            });
          }

          return row;
        });

      } catch (sqlErr) {
        logger.warn('SQL fetch failed, falling back to ES raw data', { error: sqlErr.message });
        finalAds = esHits.map(hit => hit._source);
      }
    } else {
      finalAds = esHits.map(hit => hit._source);
    }

    const esMap2 = new Map(esHits.map(hit => [String(hit._id || hit._source['ad_id']), hit._source]));
    finalAds = finalAds.map(ad => {
      const src = esMap2.get(String(ad.ad_id || ad.id)) || {};
      return {
        ...ad,
        market_platform_urls: {
          redirect_urls: src['redirect_urls'] || null,
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
    logger.error('Error in searchAds (linkedin)', { error: err.message, stack: err.stack });
    return {
      code: 500,
      message: 'Error occurred in ad search',
      error: err.message,
    };
  }
}

module.exports = { searchAds, AD_DETAIL_SELECT, AD_DETAIL_JOINS };
