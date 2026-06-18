'use strict';

const SearchMixQueryBuilder = require('../builders/SearchMixQueryBuilder');
const { normalizeParams, ensureArray, parsePagination, parseSort, cleanAdsData } = require('../helpers/paramParser');
const { SAFE_FROM, buildQueryHash, saveCursor, getCursor } = require('../../../utils/searchCursorCache');

// Shared SQL fragment for fetching full ad details by IDs
// (used by main search, favorite, hidden, bug flows)
const AD_DETAIL_SELECT = `
    facebook_ad.id                                  AS id,
    facebook_ad.id                                  AS ad_id,
    facebook_ad.likes                               AS likes,
    facebook_ad.comments                            AS comment,
    facebook_ad.shares                              AS share,
    facebook_ad.ad_position                         AS ad_position,
    facebook_ad.type                                AS type,
    facebook_ad.post_date                           AS post_date,
    facebook_ad.last_seen                           AS last_seen,
    facebook_ad.first_seen                          AS first_seen,
    facebook_ad.days_running                        AS days_running,
    facebook_ad.platform                            AS platform,
    facebook_ad.impression                          AS impression,
    facebook_ad.popularity                          AS popularity,
    facebook_ad.views                               AS views,
    facebook_ad.post_owner_id                       AS post_owner_id,
    facebook_ad_post_owners.post_owner_image        AS post_owner_image,
    facebook_ad_post_owners.post_owner_name         AS post_owner,
    facebook_ad_post_owners.verified                AS verified,
    facebook_ad_meta_data.ad_url                    AS ad_url,
    facebook_ad_meta_data.meta_ad_url               AS meta_ad_url,
    facebook_ad_meta_data.destination_url            AS destination_url,
    facebook_ad_meta_data.initial_url               AS initial_url,
    facebook_ad_meta_data.built_with                AS built_with,
    facebook_ad_meta_data.built_with_analytics_tracking AS built_with_analytics_tracking,
    facebook_ad_outgoing_links.redirect_url         AS redirect_url,
    facebook_ad_variants.tags                       AS tags,
    facebook_ad_variants.tags_status                AS tags_status,
    facebook_ad_variants.image_url                  AS image_video_url,
    facebook_ad_variants.image_url_original         AS image_url_original,
    facebook_ad_variants.text                       AS ad_text,
    facebook_ad_variants.title                      AS ad_title,
    facebook_ad_variants.newsfeed_description       AS news_feed_description,
    facebook_ad_image_video.ad_image_video          AS ad_image_video,
    facebook_meta_ad_budget.lowerBudget             AS lowerBudget,
    facebook_meta_ad_budget.upperBudget             AS upperBudget,
    languages.name                                  AS language
`;

const AD_DETAIL_JOINS = `
FROM facebook_ad
LEFT JOIN facebook_ad_post_owners
    ON facebook_ad.post_owner_id = facebook_ad_post_owners.id
LEFT JOIN facebook_ad_image_video
    ON facebook_ad.id = facebook_ad_image_video.facebook_ad_id
LEFT JOIN facebook_ad_meta_data
    ON facebook_ad.id = facebook_ad_meta_data.facebook_ad_id
LEFT JOIN facebook_ad_outgoing_links
    ON facebook_ad.id = facebook_ad_outgoing_links.facebook_ad_id
LEFT JOIN facebook_ad_variants
    ON facebook_ad.id = facebook_ad_variants.facebook_ad_id
LEFT JOIN facebook_ad_domains
    ON facebook_ad.domain_id = facebook_ad_domains.id
LEFT JOIN facebook_meta_ad_budget
    ON facebook_ad.id = facebook_meta_ad_budget.facebook_ad_id
LEFT JOIN facebook_lib_page_details
    ON facebook_ad.id = facebook_lib_page_details.facebook_ad_id
LEFT JOIN languages
    ON facebook_ad.language_id = languages.id
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

// ─── Favorite / Hidden / Bug search helpers ─────────────

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
        query: { terms: { 'facebook_ad.id': ids.map(Number) } },
        size: ids.length,
        _source: ['new_nas_image_url', 'nas_video_url', typeField, 'facebook_ad.id'],
      },
    });
    const hits = result.hits || result.body?.hits;
    const esMap = new Map((hits?.hits || []).map(h => [String(h._source['facebook_ad.id']), h._source]));

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

/**
 * Search favorite ads for a user (PHP: simpleQueryConditionForFavorite)
 * Queries hidden_ads WHERE type=3 → fetches full ad details
 */
async function searchFavoriteAds(p, db, logger) {
  try {
    if (!db.sql) return { code: 503, message: 'SQL connection not available' };

    // Step 1: Get favorite ad IDs for this user
    const favRows = await db.sql.query(
      'SELECT ad_id FROM hidden_ads WHERE user_id = ? AND type = 3',
      [p.user_id]
    );
    const adIds = favRows.map(r => r.ad_id).filter(Boolean);
    if (adIds.length === 0) {
      return { code: 200, data: [], total: 0, message: 'No favorite ads found' };
    }

    // Step 2: Buffered fetch with NAS filtering (up to 3 rounds)
    const esIndex = db.elastic?.indexName || 'search_mix';
    const typeField = 'facebook_ad.type';
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
    WHERE facebook_ad.id IN (${placeholders})
    ORDER BY FIELD(facebook_ad.id, ${placeholders})`;

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
    logger.error('Error in searchFavoriteAds', { error: err.message });
    return { code: 500, message: 'Error fetching favorite ads', error: err.message };
  }
}

/**
 * Search hidden ads for a user (PHP: simpleQueryConditionForHidden)
 * Queries hidden_ads WHERE type=1 OR type=2 → fetches full ad details
 */
async function searchHiddenAds(p, db, logger) {
  try {
    if (!db.sql) return { code: 503, message: 'SQL connection not available' };

    // Step 1: Get hidden ad IDs for this user (type 1=advertiser, 2=ad)
    const hiddenRows = await db.sql.query(
      'SELECT ad_id, post_owner_id, type FROM hidden_ads WHERE user_id = ? AND (type = 1 OR type = 2)',
      [p.user_id]
    );
    // Build a map from ad_id → { hideType, postOwnerId } for attaching to results
    const hiddenMeta = {};
    for (const r of hiddenRows) {
      if (r.ad_id) hiddenMeta[String(r.ad_id)] = { hideType: r.type, postOwnerId: r.post_owner_id };
    }
    const adIds = hiddenRows.map(r => r.ad_id).filter(Boolean);
    if (adIds.length === 0) {
      return { code: 200, data: [], total: 0, message: 'No hidden ads found' };
    }

    // Step 2: Buffered fetch with NAS filtering (up to 3 rounds)
    const esIndex = db.elastic?.indexName || 'search_mix';
    const typeField = 'facebook_ad.type';
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
    WHERE facebook_ad.id IN (${placeholders})
    ORDER BY FIELD(facebook_ad.id, ${placeholders})`;

      const rows = await db.sql.query(sql, [...batchIds, ...batchIds]);
      const deduped = dedupeRows(rows);
      const enriched = await enrichAndFilterRows(deduped, db, esIndex, typeField);
      validRows = validRows.concat(enriched);
    }

    validRows = validRows.slice(0, take);

    // Attach hide metadata (hideType, ad_type, hiddenPostOwnerId) to each row
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
    logger.error('Error in searchHiddenAds', { error: err.message });
    return { code: 500, message: 'Error fetching hidden ads', error: err.message };
  }
}

/**
 * Search bug-reported ads (PHP: simpleQueryConditionForBug)
 * Queries facebook_ad_bug_report → fetches full ad details
 */
async function searchBugAds(p, db, logger) {
  try {
    if (!db.sql) return { code: 503, message: 'SQL connection not available' };

    // Step 1: Get bug-reported ad IDs
    const bugRows = await db.sql.query(
      'SELECT ad_id FROM facebook_ad_bug_report WHERE ad_id > 0'
    );
    const adIds = bugRows.map(r => r.ad_id).filter(Boolean);
    if (adIds.length === 0) {
      return { code: 200, data: [], total: 0, message: 'No bug-reported ads found' };
    }

    // Step 2: Paginate
    const take = parseInt(p.take, 10) || 20;
    const skip = (parseInt(p.skip, 10) || 0) * take;
    const pagedIds = adIds.slice(skip, skip + take);
    if (pagedIds.length === 0) {
      return { code: 200, data: [], total: adIds.length, message: 'No ads on this page' };
    }

    // Step 3: Fetch full ad details with bug report info
    const placeholders = pagedIds.map(() => '?').join(',');
    const sql = `SELECT ${AD_DETAIL_SELECT},
        facebook_ad_bug_report.message AS bug_message,
        facebook_ad_bug_report.email   AS bug_email
    ${AD_DETAIL_JOINS}
    LEFT JOIN facebook_ad_bug_report ON facebook_ad.id = facebook_ad_bug_report.ad_id
    WHERE facebook_ad.id IN (${placeholders})
    ORDER BY FIELD(facebook_ad.id, ${placeholders})`;

    const rows = await db.sql.query(sql, [...pagedIds, ...pagedIds]);

    return {
      code: 200,
      data: cleanAdsData(dedupeRows(rows)),
      total: adIds.length,
      message: 'Bug-reported ads fetched successfully',
    };
  } catch (err) {
    logger.error('Error in searchBugAds', { error: err.message });
    return { code: 500, message: 'Error fetching bug-reported ads', error: err.message };
  }
}

/**
 * Main ad search handler.
 * @param {Object} req    - Express request (body contains all filter params)
 * @param {Object} db     - { sql, elastic } injected database connections
 * @param {Object} logger - service logger
 * @returns {Object}      - { code, data, total, sync? }
 */
async function searchAds(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  // Validate required params
  if (!p.user_id) {
    return { code: 400, message: 'Missing params: user_id is required' };
  }

  // ─── Early-return for special search modes (before ES) ──
  // (mirrors PHP getAdsHandler lines 2424-2438)
  if (p.favorite === 'true') return searchFavoriteAds(p, db, logger);
  if (p.hidden === 'true')   return searchHiddenAds(p, db, logger);
  if (p.bug === 'true')      return searchBugAds(p, db, logger);

  // Check ES connection
  if (!db.elastic) {
    return { code: 503, message: 'Elasticsearch connection not available' };
  }

  const { size, from } = parsePagination(p);
  const sort = parseSort(p);

  // ─── Build ES query ───────────────────────────────────
  const builder = new SearchMixQueryBuilder(db.elastic?.indexName);

  builder
    .setFrom(from)
    .setSize(size)
    .setSortField(sort.field)
    .setSortMethod(sort.order)
    .setIpBasedCountry(p.ipBasedCountry || 'NA');

  // Only apply status filter if the user explicitly sent a valid value
  // (PHP also only applies status when not "NA" in some paths)
  if (p.status && Array.isArray(p.status) && p.status.length > 0) {
    builder.setStatus(p.status);
  }

  // Only apply ad_position filter if fewer than 4 positions are selected
  // (all 4 = no filter preference = skip the term filter entirely)
  const adPositionArr = p.ad_position ? ensureArray(p.ad_position) : [];
  if (adPositionArr.length > 0 && adPositionArr.length < 4) {
    builder.setAdPosition(adPositionArr);
  }

  // ─── Search text fields ───────────────────────────────
  if (p.keyword)     builder.setKeyword(p.keyword);
  if (p.advertiser)  builder.setPostOwnerName(p.advertiser);
  if (p.domain)      builder.setUrl(p.domain);

  // ─── Filter fields ────────────────────────────────────
  if (p.call_to_action) builder.setCallToAction(ensureArray(p.call_to_action));
  if (p.adcategory)     builder.setAdCategory(ensureArray(p.adcategory));
  if (p.subCategory)    builder.setSubCategory(ensureArray(p.subCategory));
  if (p.country)        builder.setCountry(ensureArray(p.country));
  if (p.state)          builder.setState(ensureArray(p.state));
  if (p.city)           builder.setCity(ensureArray(p.city));
  if (p.type)           builder.setAdType(ensureArray(p.type));
  if (p.gender)         builder.setGender(ensureArray(p.gender));
  if (p.tags)           builder.setTags(ensureArray(p.tags));
  if (p.lang)           builder.setLangDetect(ensureArray(p.lang));

  // ─── Verified & discoverer ────────────────────────────
  if (p.verified !== '' && p.verified !== undefined && p.verified !== 'NA') {
    builder.setVerified(p.verified === '0' ? 0 : p.verified);
  }
  if (p.discoverer_user_id) builder.setDiscovererUserId(p.discoverer_user_id);

  // ─── Age range ────────────────────────────────────────
  if (p.lower_age && p.upper_age) {
    builder.setLowerAgeSeen({ lower_age: p.lower_age, upper_age: p.upper_age });
  }

  // ─── Date ranges ──────────────────────────────────────
  // PHP: index[0]=upper(end) index[1]=lower(start), converts Unix ts → "YYYY-MM-DD HH:mm:ss"
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
  if (p.page_creation && typeof p.page_creation === 'object') {
    builder.setPageCreation(p.page_creation);
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
  if (p.shares && Array.isArray(p.shares))     builder.setShares(p.shares);
  if (p.impressions && Array.isArray(p.impressions)) builder.setImpressions(p.impressions);
  if (p.popularity && Array.isArray(p.popularity))   builder.setPopularity(p.popularity);
  if (p.adBudget && Array.isArray(p.adBudget))       builder.setAdBudget(p.adBudget);

  // ─── Image analysis filters ───────────────────────────
  if (p.ocr)              builder.setOcr(p.ocr);
  if (p.image_celebrity)  builder.setCelebrity(ensureArray(p.image_celebrity));
  if (p.image_object)     builder.setImageObject(ensureArray(p.image_object));
  if (p.image_logo)       builder.setLogo(ensureArray(p.image_logo));

  // ─── Other text fields ────────────────────────────────
  if (p.mixdata)          builder.setMixdata(p.mixdata);
  if (p.html_content)     builder.setHtmlContent(p.html_content);
  if (p.html)             builder.setHtml(p.html);
  if (p.commentdata)      builder.setCommentdata(p.commentdata);

  // ─── Needle (cursor for avoiding realtime new ads) ────
  if (p.needle) builder.setNeedle(p.needle);

  // ─── Ad detail exclusion ──────────────────────────────
  if (p.adDetail_id) builder.setAdDetailId(p.adDetail_id);

  // ─── Platform ─────────────────────────────────────────
  if (p.platform) builder.setPlatform(ensureArray(p.platform));

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
      // No cursor cached (cold jump to deep page) — cap to last safe page
      esParams.body.from = Math.max(0, SAFE_FROM - size);
      logger.warn('Deep pagination without cursor, capping', { requestedFrom: from, cappedTo: esParams.body.from });
    }
  }

  logger.info('Executing ad search', {
    from: esParams.body.from,
    size: esParams.body.size,
    sortField: sort.field,
    query: JSON.stringify(esParams.body.query)
  });

  try {
    const result = await db.elastic.search(esParams);
    logger.debug('ES Search Result', { 
      took: result.took, 
      timed_out: result.timed_out,
      hits_total: result.hits?.total,
      hits_count: result.hits?.hits?.length
    });
    // Handle both ES 7.x and 8.x response formats
    const hits = result.hits || result.body?.hits;
    const total = typeof hits.total === 'object' ? hits.total.value : hits.total;
    const esHits = (hits.hits || []);

    // Cache cursor for next deep page (always save, cheap operation)
    saveCursor(queryHash, from, size, esHits);

    if (esHits.length === 0) {
      return {
        code: 200,
        data: [],
        total,
        message: 'No ads found',
      };
    }

    // ─── Step 2: Fetch detailed metadata from SQL ────────
    const adIds = esHits.map(hit => hit._source['facebook_ad.id']);

    // Shared ES lookup map — keyed on facebook_ad.id, reused by SQL merge and market_platform block
    const esMap = new Map(
      esHits.map(hit => [String(hit._source['facebook_ad.id']), hit])
    );

    let finalAds = [];
    if (db.sql) {
      try {
        const placeholders = adIds.map(() => '?').join(',');

        // ─── Specific columns matching PHP $selectedColumns ───
        // (mirrors Userv2Controller triageCondition1 → getAdsByOrderByField)
        const sql = `SELECT ${AD_DETAIL_SELECT}
${AD_DETAIL_JOINS}
WHERE facebook_ad.id IN (${placeholders})
ORDER BY FIELD(facebook_ad.id, ${placeholders})
`;

        const params = [...adIds, ...adIds];
        const rawRows = await db.sql.query(sql, params);
        const sqlRows = dedupeRows(rawRows);

        finalAds = sqlRows.map(row => {
          const esHit = esMap.get(String(row.ad_id));
          if (!esHit) return row;

          const src = esHit._source || {};

          // Overlay NAS image URL (same as PHP)
          if (src.new_nas_image_url) {
            row.image_video_url = src.new_nas_image_url;
          }
          if (src.nas_video_url) {
            row.nas_video_url = src.nas_video_url;
          }

          // Merge live ES engagement data (PHP does this in getAdsByOrderByField)
          if (src['facebook_ad.shares'] !== undefined)   row.share   = src['facebook_ad.shares'];
          if (src['facebook_ad.comments'] !== undefined)  row.comment = src['facebook_ad.comments'];
          if (src['facebook_ad.likes'] !== undefined)     row.likes   = src['facebook_ad.likes'];
          if (src['facebook_ad_post_owners.verified'] !== undefined) row.verified = src['facebook_ad_post_owners.verified'];
          if (src['facebook_ad.impression'] !== undefined) row.impression = src['facebook_ad.impression'];
          if (src['facebook_ad.days_running'] !== undefined) row.days_running = src['facebook_ad.days_running'];
          if (src['facebook_call_to_actions.action'] !== undefined) row.call_to_action = src['facebook_call_to_actions.action'];

          // Popularity from ES (json with current/max)
          if (src['facebook_ad.popularity']?.current !== undefined) {
            row.popularity = JSON.stringify({
              max: src['facebook_ad.popularity'].max,
              current: src['facebook_ad.popularity'].current,
            });
          }

          return row;
        });

      } catch (sqlErr) {
        logger.warn('SQL fetch failed, falling back to ES raw data', {
          error: sqlErr.message,
        });
        finalAds = esHits.map(hit => hit._source);
      }
    } else {
      finalAds = esHits.map(hit => hit._source);
    }

    finalAds = finalAds.map(ad => {
      const src = (esMap.get(String(ad.ad_id || ad.id))?._source) || {};
      return {
        ...ad,
        market_platform_urls: {
          url_destination:  src['facebook_ad_url.url_destination']         || null,
          source_url:       src['facebook_ad_outgoing_links.source_url']   || null,
          redirect_url:     src['facebook_ad_outgoing_links.redirect_url'] || null,
          final_url:        src['facebook_ad_outgoing_links.final_url']    || null,
          url_redirects:    src['facebook_ad_url.url_redirects']           || null,
          destination_url:  src['facebook_ad_meta_data.destination_url']   || null,
          initial_url:      src['facebook_ad_meta_data.initial_url']       || null,
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
    logger.error('Error in searchAds', { error: err.message, stack: err.stack });
    return {
      code: 500,
      message: 'Error occurred in ad search',
      error: err.message,
    };
  }
}

module.exports = { searchAds, AD_DETAIL_SELECT, AD_DETAIL_JOINS };
