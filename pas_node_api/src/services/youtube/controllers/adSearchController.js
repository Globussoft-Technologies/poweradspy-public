'use strict';

const SearchMixQueryBuilder = require('../builders/SearchMixQueryBuilder');
const { normalizeParams, ensureArray, parsePagination, parseSort, cleanAdsData } = require('../helpers/paramParser');
const { SAFE_FROM, buildQueryHash, saveCursor, getCursor } = require('../../../utils/searchCursorCache');
const { getLanguageMap, resolveLanguageName } = require('../../../utils/languageMap');

// ─── SQL fragments ───────────────────────────────────────────────────────────
//
// Mirrors the PHP SearchController $select array (SearchController.php ~line 1293).
// Notable YouTube differences vs Facebook/Instagram:
//   - youtube_ad_variants.video_url  → image_video_url  (not image_url)
//   - youtube_ad.views               → view             (no shares field)
//   - youtube_ad.dislikes            → dislikes         (YouTube-only)
//   - youtube_call_to_actions.action → call_to_action   (joined via call_to_action_id FK)
//   - youtube_ad_ocb                 → object/celebrity/brand_logo (YouTube-only)

const AD_DETAIL_SELECT = `
    youtube_ad.id                                       AS id,
    youtube_ad.id                                       AS ad_id,
    youtube_ad.likes                                    AS likes,
    youtube_ad.dislikes                                 AS dislikes,
    youtube_ad.comments                                 AS comment,
    youtube_ad.views                                    AS view,
    youtube_ad.ad_position                              AS ad_position,
    youtube_ad.type                                     AS type,
    youtube_ad.post_date                                AS post_date,
    youtube_ad.last_seen                                AS last_seen,
    youtube_ad.first_seen                               AS first_seen,
    youtube_ad.post_owner_id                            AS post_owner_id,
    youtube_ad_post_owners.post_owner_image             AS post_owner_image,
    youtube_ad_post_owners.post_owner_name              AS post_owner,
    youtube_ad_post_owners.verified                     AS verified,
    youtube_ad_meta_data.ad_url                         AS ad_url,
    youtube_ad_meta_data.destination_url                AS destination_url,
    youtube_ad_meta_data.built_with                     AS built_with,
    youtube_ad_meta_data.affiliate_data                 AS affiliate_data,
    youtube_ad_meta_data.built_with_analytics_tracking  AS built_with_analytics_tracking,
    youtube_ad_outgoing_links.redirect_url              AS redirect_url,
    youtube_ad_variants.video_url                       AS image_video_url,
    youtube_ad_variants.title                           AS ad_title,
    youtube_ad_variants.text                            AS ad_text,
    youtube_ad_variants.newsfeed_description            AS news_feed_description,
    youtube_ad_variants.tags                            AS tags,
    youtube_ad_image_video.ad_image_video               AS ad_image_video,
    youtube_call_to_actions.action                      AS call_to_action,
    youtube_ad_ocb.object                               AS image_object,
    youtube_ad_ocb.celebrity                            AS image_celebrity,
    youtube_ad_ocb.brand_logo                           AS image_logo,
    languages.name                                      AS language
`;

const AD_DETAIL_JOINS = `
FROM youtube_ad
LEFT JOIN youtube_ad_post_owners
    ON youtube_ad.post_owner_id = youtube_ad_post_owners.id
LEFT JOIN youtube_ad_meta_data
    ON youtube_ad.id = youtube_ad_meta_data.youtube_ad_id
LEFT JOIN youtube_ad_outgoing_links
    ON youtube_ad.id = youtube_ad_outgoing_links.youtube_ad_id
LEFT JOIN youtube_ad_variants
    ON youtube_ad.id = youtube_ad_variants.youtube_ad_id
LEFT JOIN youtube_ad_image_video
    ON youtube_ad.id = youtube_ad_image_video.youtube_ad_id
LEFT JOIN youtube_call_to_actions
    ON youtube_ad.call_to_action_id = youtube_call_to_actions.id
LEFT JOIN youtube_ad_domains
    ON youtube_ad.domain_id = youtube_ad_domains.id
LEFT JOIN youtube_ad_ocb
    ON youtube_ad.id = youtube_ad_ocb.youtube_ad_id
LEFT JOIN languages
    ON youtube_ad.language_id = languages.id
`;

function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter(r => {
    if (seen.has(r.ad_id)) return false;
    seen.add(r.ad_id);
    return true;
  });
}

// ─── Special search modes ─────────────────────────────────────────────────────

async function enrichAndFilterRows(rows, db, esIndex, typeField, nasField) {
  if (!db.elastic || rows.length === 0) return rows;
  try {
    const ids = rows.map(r => r.ad_id).filter(Boolean);
    const result = await db.elastic.search({
      index: esIndex,
      body: {
        query: { terms: { 'ad_id': ids.map(Number) } },
        size: ids.length,
        _source: [nasField, typeField, 'ad_id'],
      },
    });
    const hits = result.hits || result.body?.hits;
    const esMap = new Map((hits?.hits || []).map(h => [String(h._source['ad_id']), h._source]));
    // Keep every matched ad so rendered cards == search total. IMAGE/DISPLAY ads
    // without a usable NAS image are flagged preview_unavailable (frontend placeholder).
    return rows.map(row => {
      const src = esMap.get(String(row.ad_id)) || {};
      const adType = src[typeField] || row.type || '';
      const rawNas = src[nasField] || '';
      const nasUrl = rawNas && !String(rawNas).includes('DefaultImage') ? rawNas : '';
      if (adType === 'IMAGE' || adType === 'DISPLAY') {
        if (nasUrl) {
          row.image_video_url = nasUrl;
          row.image_url_original = nasUrl;
        } else {
          row.image_video_url = '';
          row.preview_unavailable = true;
        }
      }
      return row;
    });
  } catch (err) {
    return rows;
  }
}

async function searchFavoriteAds(p, db, logger) {
  try {
    if (!db.sql) return { code: 503, message: 'SQL connection not available' };

    const favRows = await db.sql.query(
      'SELECT ad_id FROM youtube_hidden_ads WHERE user_id = ? AND type = 3',
      [p.user_id]
    );
    const adIds = favRows.map(r => r.ad_id).filter(Boolean);
    if (adIds.length === 0) return { code: 200, data: [], total: 0, message: 'No favorite ads found' };

    const esIndex = db.elastic?.indexName || 'youtube_ads_data';
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
WHERE youtube_ad.id IN (${placeholders})
ORDER BY FIELD(youtube_ad.id, ${placeholders})`;
      const rows = await db.sql.query(sql, [...batchIds, ...batchIds]);
      const enriched = await enrichAndFilterRows(dedupeRows(rows), db, esIndex, 'ad_type', 'new_nas_image_url');
      validRows = validRows.concat(enriched);
    }

    return { code: 200, data: cleanAdsData(validRows.slice(0, take)), total: adIds.length, message: 'Favorite ads fetched successfully' };
  } catch (err) {
    logger.error('Error in searchFavoriteAds (youtube)', { error: err.message });
    return { code: 500, message: 'Error fetching favorite ads', error: err.message };
  }
}

async function searchHiddenAds(p, db, logger) {
  try {
    if (!db.sql) return { code: 503, message: 'SQL connection not available' };

    const hiddenRows = await db.sql.query(
      'SELECT ad_id, post_owner_id, type FROM youtube_hidden_ads WHERE user_id = ? AND (type = 1 OR type = 2)',
      [p.user_id]
    );
    const hiddenMeta = {};
    for (const r of hiddenRows) {
      if (r.ad_id) hiddenMeta[String(r.ad_id)] = { hideType: r.type, postOwnerId: r.post_owner_id };
    }
    const adIds = hiddenRows.map(r => r.ad_id).filter(Boolean);
    if (adIds.length === 0) return { code: 200, data: [], total: 0, message: 'No hidden ads found' };

    const esIndex = db.elastic?.indexName || 'youtube_ads_data';
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
WHERE youtube_ad.id IN (${placeholders})
ORDER BY FIELD(youtube_ad.id, ${placeholders})`;
      const rows = await db.sql.query(sql, [...batchIds, ...batchIds]);
      const enriched = await enrichAndFilterRows(dedupeRows(rows), db, esIndex, 'ad_type', 'new_nas_image_url');
      validRows = validRows.concat(enriched);
    }

    const cleanedData = cleanAdsData(validRows.slice(0, take)).map(ad => {
      const meta = hiddenMeta[String(ad.ad_id || ad.id)] || {};
      const hideType = meta.hideType ?? 2;
      return { ...ad, hideType, ad_type: hideType, hiddenPostOwnerId: meta.postOwnerId ?? null };
    });
    return { code: 200, data: cleanedData, total: adIds.length, message: 'Hidden ads fetched successfully' };
  } catch (err) {
    logger.error('Error in searchHiddenAds (youtube)', { error: err.message });
    return { code: 500, message: 'Error fetching hidden ads', error: err.message };
  }
}

async function searchBugAds(p, db, logger) {
  try {
    if (!db.sql) return { code: 503, message: 'SQL connection not available' };

    const bugRows = await db.sql.query('SELECT ad_id FROM youtube_ad_bug_report WHERE ad_id > 0');
    const adIds = bugRows.map(r => r.ad_id).filter(Boolean);
    if (adIds.length === 0) return { code: 200, data: [], total: 0, message: 'No bug-reported ads found' };

    const take = parseInt(p.take, 10) || 20;
    const skip = (parseInt(p.skip, 10) || 0) * take;
    const pagedIds = adIds.slice(skip, skip + take);
    if (pagedIds.length === 0) return { code: 200, data: [], total: adIds.length, message: 'No ads on this page' };

    const placeholders = pagedIds.map(() => '?').join(',');
    const sql = `SELECT ${AD_DETAIL_SELECT},
        youtube_ad_bug_report.message AS bug_message,
        youtube_ad_bug_report.email   AS bug_email
${AD_DETAIL_JOINS}
LEFT JOIN youtube_ad_bug_report ON youtube_ad.id = youtube_ad_bug_report.ad_id
WHERE youtube_ad.id IN (${placeholders})
ORDER BY FIELD(youtube_ad.id, ${placeholders})`;

    const rows = await db.sql.query(sql, [...pagedIds, ...pagedIds]);
    return { code: 200, data: cleanAdsData(dedupeRows(rows)), total: adIds.length, message: 'Bug-reported ads fetched successfully' };
  } catch (err) {
    logger.error('Error in searchBugAds (youtube)', { error: err.message });
    return { code: 500, message: 'Error fetching bug-reported ads', error: err.message };
  }
}

// ─── Main search ──────────────────────────────────────────────────────────────

async function searchAds(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p   = normalizeParams(raw);

  if (!p.user_id) return { code: 400, message: 'Missing params: user_id is required' };

  if (p.favorite === 'true') return searchFavoriteAds(p, db, logger);
  if (p.hidden   === 'true') return searchHiddenAds(p,   db, logger);
  if (p.bug      === 'true') return searchBugAds(p,      db, logger);

  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  const { size, from } = parsePagination(p);
  const sort            = parseSort(p);

  // ─── Build ES query ────────────────────────────────────────────────────
  const builder = new SearchMixQueryBuilder(db.elastic?.indexName);

  builder
    .setFrom(from)
    .setSize(size)
    .setSortField(sort.field)
    .setSortMethod(sort.order)
    .setIpBasedCountry(p.ipBasedCountry || 'NA')
    .setIncludeDisplayAds(raw.youtube_display_ads);

  if (p.status && Array.isArray(p.status) && p.status.length > 0) builder.setStatus(p.status);

  const adPositionArr = p.ad_position ? ensureArray(p.ad_position) : [];
  if (adPositionArr.length > 0 && adPositionArr.length < 4) builder.setAdPosition(adPositionArr);

  if (p.keyword)    builder.setKeyword(p.keyword);
  if (p.advertiser) builder.setPostOwnerName(p.advertiser);
  if (p.domain)     builder.setUrl(p.domain);

  if (p.call_to_action) builder.setCallToAction(ensureArray(p.call_to_action));
  if (p.adcategory)     builder.setAdCategory(ensureArray(p.adcategory));
  if (p.subCategory)    builder.setSubCategory(ensureArray(p.subCategory));
  if (p.country)        builder.setCountry(ensureArray(p.country));
  if (p.type)           builder.setAdType(ensureArray(p.type));
  if (p.lang)           builder.setLangDetect(ensureArray(p.lang));

  if (p.verified !== '' && p.verified !== undefined && p.verified !== 'NA') {
    builder.setVerified(p.verified === '0' ? 0 : p.verified);
  }
  if (p.discoverer_user_id) builder.setDiscovererUserId(p.discoverer_user_id);

  if (p.lower_age && p.upper_age) {
    builder.setLowerAgeSeen({ lower_age: p.lower_age, upper_age: p.upper_age });
  }

  if (Array.isArray(p.seen_btn_sort) && p.seen_btn_sort.length === 2) {
    builder.setLastSeen({ lower_date: Number(p.seen_btn_sort[1]), upper_date: Number(p.seen_btn_sort[0]) });
  }
  if (Array.isArray(p.post_date_btn_sort) && p.post_date_btn_sort.length === 2) {
    builder.setPostDate({ lower_date: Number(p.post_date_btn_sort[1]), upper_date: Number(p.post_date_btn_sort[0]) });
  }
  if (Array.isArray(p.domain_date_btn_sort) && p.domain_date_btn_sort.length === 2) {
    builder.setDomainDate({ lower_date: Number(p.domain_date_btn_sort[1]), upper_date: Number(p.domain_date_btn_sort[0]) });
  }

  if (p.ecommerce)       builder.setBuiltWith(ensureArray(p.ecommerce));
  if (p.source)          builder.setSource(ensureArray(p.source));
  if (p.funnel)          builder.setFunnel(ensureArray(p.funnel));
  if (p.affiliate)       builder.setAffiliate(ensureArray(p.affiliate));
  if (p.market_platform) builder.setMarketPlatform(ensureArray(p.market_platform));

  // YouTube engagement filters (views + dislikes instead of shares/impressions/popularity)
  if (p.likes     && Array.isArray(p.likes))     builder.setLikes(p.likes);
  if (p.comments  && Array.isArray(p.comments))  builder.setComments(p.comments);
  if (p.view      && Array.isArray(p.view))      builder.setViews(p.view);
  else if (p.views && Array.isArray(p.views))   builder.setViews(p.views);
  if (p.dislikes  && Array.isArray(p.dislikes))  builder.setDislikes(p.dislikes);
  if (p.adBudget  && Array.isArray(p.adBudget))   builder.setAdBudget(p.adBudget);

  if (p.ocr)             builder.setOcr(p.ocr);
  if (p.image_celebrity) builder.setCelebrity(ensureArray(p.image_celebrity));
  if (p.image_object)    builder.setImageObject(ensureArray(p.image_object));
  if (p.image_logo)      builder.setLogo(ensureArray(p.image_logo));

  if (p.needle)      builder.setNeedle(p.needle);
  if (p.adDetail_id) builder.setAdDetailId(p.adDetail_id);
  if (p.not_country) builder.setNotCountry(p.not_country);

  const esParams = builder.build();

  // ─── Deep pagination: swap from/size → search_after ───────────────────
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

  logger.info('Executing YouTube ad search', {
    from: esParams.body.from,
    size: esParams.body.size,
    sortField: sort.field,
    query: JSON.stringify(esParams.body.query),
  });

  try {
    const result  = await db.elastic.search(esParams);
    const hits    = result.hits || result.body?.hits;
    const total   = typeof hits.total === 'object' ? hits.total.value : hits.total;
    const esHits  = hits.hits || [];

    saveCursor(queryHash, from, size, esHits);

    if (esHits.length === 0) {
      return { code: 200, data: [], total, message: 'No ads found' };
    }

    // ─── Phase 2: enrich from SQL ────────────────────────────────────────
    // youtube_ads_data index uses flat `ad_id` as the document identifier
    const adIds = esHits.map(hit => hit._source['ad_id']);
    let finalAds = [];

    // Language map for resolving ES `ad_language` codes → names. Mirrors
    // adDetailController's overlay so list results agree with the detail/
    // analytics views instead of showing the stale `youtube_ad.language_id` join.
    let langMap = null;
    if (db.sql) {
      try { langMap = await getLanguageMap(db.sql); } catch (_) { langMap = null; }
    }

    if (db.sql) {
      try {
        const placeholders = adIds.map(() => '?').join(',');
        const sql = `SELECT ${AD_DETAIL_SELECT}
${AD_DETAIL_JOINS}
WHERE youtube_ad.id IN (${placeholders})
ORDER BY FIELD(youtube_ad.id, ${placeholders})`;

        const rawRows = await db.sql.query(sql, [...adIds, ...adIds]);
        const sqlRows = dedupeRows(rawRows);

        // ES lookup map keyed on flat `ad_id`
        const esMap = new Map(
          esHits.map(hit => [String(hit._source['ad_id']), hit])
        );

        finalAds = sqlRows.map(row => {
          const esHit = esMap.get(String(row.ad_id));
          if (!esHit) return row;

          const src = esHit._source || {};

          // Overlay media URL from ES based on ad type
          const esAdType = (src.ad_type || row.type || '').toUpperCase();
          if ((esAdType === 'VIDEO' || esAdType === 'DISCOVERY') && src.thumbnail_url) {
            row.image_video_url = src.thumbnail_url;
          } else if (src.new_nas_image_url) {
            row.image_video_url = src.new_nas_image_url;
          }

          // Merge live engagement data from ES
          if (src['reactions']?.['likes'] !== undefined) row.likes = src['reactions']['likes'];
          if (src['dislikes']  !== undefined) row.dislikes = src['dislikes'];
          if (src['comments']  !== undefined) row.comment  = src['comments'];
          if (src['views']     !== undefined) row.view     = src['views'];
          if (src['verified']  !== undefined) row.verified = src['verified'];
          if (src['countries'] !== undefined) row.countries = src['countries'];
          if (src['duration']  !== undefined) row.days_running = src['duration'];
          if (src['call_to_action'] !== undefined) row.call_to_action = src['call_to_action'];
          if (src['text_image_title'] !== undefined) row.text_image_title = src['text_image_title'];
          if (src['youtube.lowerBudget']   !== undefined) row.lowerBudget   = src['youtube.lowerBudget'];
          if (src['youtube.upperBudget']   !== undefined) row.upperBudget   = src['youtube.upperBudget'];
          if (src['youtube.averageBudget'] !== undefined) row.averageBudget = src['youtube.averageBudget'];

          return row;
        });

      } catch (sqlErr) {
        logger.warn('SQL fetch failed, falling back to ES raw data (youtube)', { error: sqlErr.message });
        finalAds = esHits.map(hit => hit._source);
      }
    } else {
      finalAds = esHits.map(hit => hit._source);
    }

    const esMap2 = new Map(esHits.map(hit => [String(hit._source['ad_id']), hit._source]));
    finalAds = finalAds.map(ad => {
      const src = esMap2.get(String(ad.ad_id || ad.id)) || {};
      const esLang = src['ad_language'];
      const language = (esLang && langMap) ? resolveLanguageName(langMap, esLang) : null;
      return {
        ...ad,
        language,
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
    logger.error('Error in YouTube searchAds', { error: err.message, stack: err.stack });
    return { code: 500, message: 'Error occurred in YouTube ad search', error: err.message };
  }
}

module.exports = { searchAds, AD_DETAIL_SELECT, AD_DETAIL_JOINS };
