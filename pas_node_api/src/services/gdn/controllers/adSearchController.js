'use strict';

const SearchMixQueryBuilder = require('../builders/SearchMixQueryBuilder');
const { normalizeParams, ensureArray, parsePagination, parseSort, cleanAdsData } = require('../helpers/paramParser');
const { SAFE_FROM, buildQueryHash, saveCursor, getCursor } = require('../../../utils/searchCursorCache');
const { getLanguageMap, resolveLanguageName } = require('../../../utils/languageMap');
const {
  isDisplayMergeApplicable,
  getYoutubeDisplayHits,
  enrichYoutubeDisplayAds,
  getYoutubeDisplayHiddenRows,
  toEpochSeconds,
} = require('../helpers/youtubeDisplayMerge');

// ─── SQL fragments ────────────────────────────────────────────────────────────
//
// Mirrors PHP SearchController $select (SearchController.php ~line 562).
// GDN uses prefixed table references: gdn_ad.*, gdn_ad_variants.*, etc.

const AD_DETAIL_SELECT = `
    gdn_ad.id                                           AS id,
    gdn_ad.post_owner_id                                AS post_owner_id,
    gdn_ad.ad_position                                  AS ad_position,
    gdn_ad.ad_sub_position                              AS ad_sub_position,
    gdn_ad.type                                         AS type,
    gdn_ad.source                                       AS source,
    gdn_ad.hits                                         AS hits,
    gdn_ad.days_running                                 AS days_running,
    gdn_ad_post_owners.post_owner_image                 AS post_owner_image,
    gdn_ad_post_owners.post_owner_name                  AS post_owner,
    gdn_ad_variants.text                                AS ad_text,
    gdn_ad_variants.title                               AS ad_title,
    gdn_ad_variants.image_url                           AS image_video_url,
    gdn_ad_variants.newsfeed_description                AS news_feed_description,
    gdn_ad_meta_data.destination_url                    AS destination_url,
    gdn_ad_meta_data.built_with                         AS built_with,
    gdn_ad_meta_data.built_with_analytics_tracking      AS built_with_analytics_tracking,
    gdn_ad_meta_data.affiliate_data                     AS affiliate_data,
    DATE(gdn_ad.first_seen)                             AS first_seen,
    DATE(gdn_ad.last_seen)                              AS last_seen,
    DATE(gdn_ad.post_date)                              AS post_date,
    languages.name                                      AS language
`;

const AD_DETAIL_JOINS = `
FROM gdn_ad
LEFT JOIN gdn_ad_post_owners
    ON gdn_ad.post_owner_id = gdn_ad_post_owners.id
LEFT JOIN gdn_ad_variants
    ON gdn_ad.id = gdn_ad_variants.gdn_ad_id
LEFT JOIN gdn_ad_meta_data
    ON gdn_ad.id = gdn_ad_meta_data.gdn_ad_id
LEFT JOIN gdn_country_only
    ON gdn_ad.country_only_id = gdn_country_only.id
LEFT JOIN languages
    ON gdn_ad.language_id = languages.id
`;

function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

// ─── Map flat ES dot-notation keys → clean SQL-alias field names ──────────────
// Mirrors the column aliases in AD_DETAIL_SELECT so both SQL and ES-fallback
// paths return the same shape to the frontend.
function normalizeEsSource(src) {
  const id = src?.['gdn_ad']?.['id'] ?? src?.['gdn_ad.id'];
  return {
    id,
    post_owner_id:                   src['gdn_ad.post_owner_id'],
    ad_position:                     src['gdn_ad.ad_position'],
    ad_sub_position:                 src['gdn_ad.ad_sub_position'],
    type:                            src['gdn_ad.type'],
    source:                          src['gdn_ad.source'],
    hits:                            src['gdn_ad.hits'],
    days_running:                    src['gdn_ad.days_running'],
    post_owner_image:                src['gdn_ad_post_owners.post_owner_image'],
    post_owner:                      src['gdn_ad_post_owners.post_owner_name'],
    ad_text:                         src['gdn_ad_variants.text'],
    ad_title:                        src['gdn_ad_variants.title'],
    image_video_url:                 src['new_nas_image_url'] || src['gdn_ad_variants.image_url'],
    news_feed_description:           src['gdn_ad_variants.newsfeed_description'],
    destination_url:                 src['gdn_ad_meta_data.destination_url'],
    built_with:                      src['gdn_ad_meta_data.built_with'],
    built_with_analytics_tracking:   src['gdn_ad_meta_data.built_with_analytics_tracking'],
    affiliate_data:                  src['gdn_ad_meta_data.affiliate_data'],
    first_seen:                      src['gdn_ad.first_seen'],
    last_seen:                       src['gdn_ad.last_seen'],
    post_date:                       src['gdn_ad.post_date'],
    redirect_url:                    src['gdn_ad_meta_data.redirect_url'],
    country:                         src['gdn_country_only.country'],
  };
}

// ─── Special search modes ─────────────────────────────────────────────────────

async function enrichAndFilterRows(rows, db, esIndex, typeField, nasField) {
  if (!db.elastic || rows.length === 0) return rows;
  try {
    const ids = rows.map(r => r.ad_id || r.id).filter(Boolean);
    // GDN ES documents use 'gdn_ad.id' as a field (not _id), so query by field
    const result = await db.elastic.search({
      index: esIndex,
      body: {
        query: { terms: { 'gdn_ad.id': ids.map(Number) } },
        size: ids.length,
        _source: [nasField, typeField, 'gdn_ad.id'],
      },
    });
    const hits = result.hits || result.body?.hits;
    const esMap = new Map((hits?.hits || []).map(h => [String(h._source['gdn_ad.id']), h._source]));
    return rows.filter(row => {
      const rowId = row.ad_id || row.id;
      const src = esMap.get(String(rowId)) || {};
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

// Fetch+enrich a page's worth of GDN rows for the given ids (shared by the
// favourite/hidden batching loops below).
async function fetchGdnRowsByIds(ids, db, esIndex) {
  if (!ids || ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const sql = `SELECT ${AD_DETAIL_SELECT}
${AD_DETAIL_JOINS}
WHERE gdn_ad.id IN (${placeholders})
ORDER BY FIELD(gdn_ad.id, ${placeholders})`;
  const rows = await db.sql.query(sql, [...ids, ...ids]);
  const enriched = await enrichAndFilterRows(dedupeRows(rows), db, esIndex, 'gdn_ad.type', 'new_nas_image_url');
  return cleanAdsData(enriched);
}

async function searchFavoriteAds(p, db, logger) {
  try {
    if (!db.sql) return { code: 503, message: 'SQL connection not available' };

    const favRows = await db.sql.query(
      'SELECT ad_id FROM gdn_hidden_ads WHERE user_id = ? AND type = 3',
      [p.user_id]
    );
    const gdnAdIds = favRows.map(r => r.ad_id).filter(Boolean);

    // YouTube DISPLAY ads surfaced under GDN are favourited via the YouTube
    // backend (network stays 'youtube' for data routing — see
    // YOUTUBE_DISPLAY_IN_GDN.md), so gdn_hidden_ads never sees them. Pull the
    // matching youtube_hidden_ads rows in too so the ad still shows under
    // GDN's Favourites, matching how it's browsed.
    const ytRows = await getYoutubeDisplayHiddenRows(p.user_id, 'type = 3', logger);
    const ytAdIds = ytRows.map(r => r.ad_id);

    const total = gdnAdIds.length + ytAdIds.length;
    if (total === 0) return { code: 200, data: [], total: 0, message: 'No favorite ads found' };

    const esIndex = db.elastic?.indexName || 'gdn_search_mix';
    const take = parseInt(p.take, 10) || 20;
    const skip = (parseInt(p.skip, 10) || 0) * take;
    const combined = [
      ...gdnAdIds.map(id => ({ id, src: 'gdn' })),
      ...ytAdIds.map(id => ({ id, src: 'yt' })),
    ];

    const MAX_ROUNDS = 3;
    let validItems = [];
    let cursor = skip;
    let rounds = 0;

    while (validItems.length < take && cursor < combined.length && rounds < MAX_ROUNDS) {
      rounds++;
      const batch = combined.slice(cursor, cursor + take);
      cursor += take;
      if (batch.length === 0) break;

      const batchGdnIds = batch.filter(x => x.src === 'gdn').map(x => x.id);
      const batchYtIds  = batch.filter(x => x.src === 'yt').map(x => x.id);

      const [gdnAds, ytMap] = await Promise.all([
        fetchGdnRowsByIds(batchGdnIds, db, esIndex),
        batchYtIds.length ? enrichYoutubeDisplayAds(batchYtIds, logger) : Promise.resolve(new Map()),
      ]);

      const gdnMap = new Map(gdnAds.map(ad => [String(ad.ad_id || ad.id), ad]));
      const batchAds = batch
        .map(x => (x.src === 'gdn' ? gdnMap.get(String(x.id)) : ytMap.get(String(x.id))))
        .filter(Boolean);

      validItems = validItems.concat(batchAds);
    }

    return { code: 200, data: validItems.slice(0, take), total, message: 'Favorite ads fetched successfully' };
  } catch (err) {
    logger.error('Error in searchFavoriteAds (gdn)', { error: err.message });
    return { code: 500, message: 'Error fetching favorite ads', error: err.message };
  }
}

async function searchHiddenAds(p, db, logger) {
  try {
    if (!db.sql) return { code: 503, message: 'SQL connection not available' };

    const hiddenRows = await db.sql.query(
      'SELECT ad_id, post_owner_id, type FROM gdn_hidden_ads WHERE user_id = ? AND (type = 1 OR type = 2)',
      [p.user_id]
    );
    const hiddenMeta = {};
    for (const r of hiddenRows) {
      if (r.ad_id) hiddenMeta[`gdn:${r.ad_id}`] = { hideType: r.type, postOwnerId: r.post_owner_id };
    }
    const gdnAdIds = hiddenRows.map(r => r.ad_id).filter(Boolean);

    // Same YouTube-backend routing issue as searchFavoriteAds (see comment there).
    const ytRows = await getYoutubeDisplayHiddenRows(p.user_id, '(type = 1 OR type = 2)', logger);
    for (const r of ytRows) {
      if (r.ad_id) hiddenMeta[`yt:${r.ad_id}`] = { hideType: r.type, postOwnerId: r.post_owner_id };
    }
    const ytAdIds = ytRows.map(r => r.ad_id);

    const total = gdnAdIds.length + ytAdIds.length;
    if (total === 0) return { code: 200, data: [], total: 0, message: 'No hidden ads found' };

    const esIndex = db.elastic?.indexName || 'gdn_search_mix';
    const take = parseInt(p.take, 10) || 20;
    const skip = (parseInt(p.skip, 10) || 0) * take;
    const combined = [
      ...gdnAdIds.map(id => ({ id, src: 'gdn' })),
      ...ytAdIds.map(id => ({ id, src: 'yt' })),
    ];

    const MAX_ROUNDS = 3;
    let validItems = [];
    let cursor = skip;
    let rounds = 0;

    while (validItems.length < take && cursor < combined.length && rounds < MAX_ROUNDS) {
      rounds++;
      const batch = combined.slice(cursor, cursor + take);
      cursor += take;
      if (batch.length === 0) break;

      const batchGdnIds = batch.filter(x => x.src === 'gdn').map(x => x.id);
      const batchYtIds  = batch.filter(x => x.src === 'yt').map(x => x.id);

      const [gdnAds, ytMap] = await Promise.all([
        fetchGdnRowsByIds(batchGdnIds, db, esIndex),
        batchYtIds.length ? enrichYoutubeDisplayAds(batchYtIds, logger) : Promise.resolve(new Map()),
      ]);

      const gdnMap = new Map(gdnAds.map(ad => [String(ad.ad_id || ad.id), ad]));
      const batchAds = batch
        .map(x => {
          const ad = x.src === 'gdn' ? gdnMap.get(String(x.id)) : ytMap.get(String(x.id));
          if (!ad) return null;
          const meta = hiddenMeta[`${x.src}:${x.id}`] || {};
          const hideType = meta.hideType ?? 2;
          return { ...ad, hideType, ad_type: hideType, hiddenPostOwnerId: meta.postOwnerId ?? null };
        })
        .filter(Boolean);

      validItems = validItems.concat(batchAds);
    }

    return { code: 200, data: validItems.slice(0, take), total, message: 'Hidden ads fetched successfully' };
  } catch (err) {
    logger.error('Error in searchHiddenAds (gdn)', { error: err.message });
    return { code: 500, message: 'Error fetching hidden ads', error: err.message };
  }
}

// ─── Shared enrichment ─────────────────────────────────────────────────────────
// Turn a set of GDN ES hits into fully shaped, cleaned ad objects (SQL join +
// ES overlay + market_platform_urls). Used by both the normal search path and
// the YouTube-DISPLAY merge path so they stay byte-for-byte consistent.
async function enrichGdnHits(esHits, db, logger) {
  if (!esHits || esHits.length === 0) return [];

  // gdn_search_mix indexes data with flat dot-notation keys: "gdn_ad.id", "gdn_ad.type", etc.
  // Support both flat ("gdn_ad.id") and nested (gdn_ad.id) access.
  const getEsId = (src) =>
    src?.['gdn_ad']?.['id'] ??   // nested (just in case)
    src?.['gdn_ad.id'];           // flat dot-notation (primary format)

  const adIds = esHits.map(hit => getEsId(hit._source)).filter(Boolean);
  let finalAds = [];

  // Language map for resolving ES `lang_detect` codes → names. Loaded once,
  // then reused below to override the stale `gdn_ad.language_id` join —
  // mirrors adDetailController's overlay so list results agree with the
  // detail/analytics views instead of showing whatever language was detected
  // at insertion time.
  let langMap = null;
  if (db.sql) {
    try { langMap = await getLanguageMap(db.sql); } catch (_) { langMap = null; }
  }

  if (db.sql && adIds.length > 0) {
    try {
      const placeholders = adIds.map(() => '?').join(',');
      const sql = `SELECT ${AD_DETAIL_SELECT}
${AD_DETAIL_JOINS}
WHERE gdn_ad.id IN (${placeholders})
ORDER BY FIELD(gdn_ad.id, ${placeholders})`;

      const rawRows = await db.sql.query(sql, [...adIds, ...adIds]);
      const sqlRows = dedupeRows(rawRows);

      // ES lookup map keyed on gdn_ad.id (flat or nested)
      const esMap = new Map(
        esHits.map(hit => [String(getEsId(hit._source)), hit])
      );

      finalAds = sqlRows.map(row => {
        const esHit = esMap.get(String(row.id));
        if (!esHit) return row;

        const src = esHit._source || {};

        // Overlay NAS image URL if present
        if (src['new_nas_image_url']) row.image_video_url = src['new_nas_image_url'];

        // Merge country from ES — supports both flat and nested
        const country = src['gdn_country_only.country'] ?? src['gdn_country_only']?.['country'];
        if (country !== undefined) row.country = country;

        return row;
      });

    } catch (sqlErr) {
      if (logger) logger.warn('SQL fetch failed, falling back to ES data (gdn)', { error: sqlErr.message });
      finalAds = esHits.map(hit => normalizeEsSource(hit._source || {}));
    }
  } else {
    // No SQL — normalize flat ES source to clean field names
    finalAds = esHits.map(hit => normalizeEsSource(hit._source || {}));
  }

  const esMap2 = new Map(esHits.map(hit => [String(getEsId(hit._source)), hit._source]));
  finalAds = finalAds.map(ad => {
    const src = esMap2.get(String(ad.ad_id || ad.id)) || {};
    const language = (src['lang_detect'] && langMap) ? resolveLanguageName(langMap, src['lang_detect']) : ad.language;
    return {
      ...ad,
      language,
      market_platform_urls: {
        url_destination: src['gdn_ad_url.url_destination']         || null,
        source_url:      src['gdn_ad_outgoing_links.source_url']   || null,
        redirect_url:    src['gdn_ad_outgoing_links.redirect_url'] || null,
        final_url:       src['gdn_ad_outgoing_links.final_url']    || null,
        url_redirects:   src['gdn_ad_url.url_redirects']           || null,
        redirect_urls:   src['gdn_ad_meta_data.redirect_url']      || null,
        destination_url: src['gdn_ad_meta_data.destination_url']   || null,
      },
    };
  });

  return cleanAdsData(finalAds);
}

// ─── YouTube DISPLAY merge path ─────────────────────────────────────────────────
// Interleaves YouTube DISPLAY ads into the GDN listing by recency. Fetches the
// first `upper` (= from+size) hits from BOTH stores, merges by a normalized
// last_seen/post_date key, slices the page, then enriches only that page. Because
// every page recomputes the same merged prefix and slices [from, upper), the
// boundaries align across pages → no duplicates / no skips. total = gdn + yt.
async function searchWithDisplayMerge({ db, logger, esParams, p, from, size, sort }) {
  const upper = from + size;
  const order = sort.order === 'asc' ? 'asc' : 'desc';

  // GDN hits for the whole [0, upper) window (own query, no search_after needed).
  const gdnParams = { index: esParams.index, body: { ...esParams.body, from: 0, size: upper } };
  delete gdnParams.body.search_after;

  const [gdnRes, ytDisplay] = await Promise.all([
    db.elastic.search(gdnParams),
    getYoutubeDisplayHits(upper, sort, p, logger),
  ]);

  const gHits    = gdnRes.hits || gdnRes.body?.hits;
  const gdnTotal = typeof gHits.total === 'object' ? gHits.total.value : gHits.total;
  const gdnHits  = gHits.hits || [];
  const ytItems  = ytDisplay.items;
  const ytTotal  = ytDisplay.total;

  // Interleave on a real timestamp. When the GDN sort is `gdn_ad.id` ("Newest"),
  // its _source value is a row id (not comparable to the YouTube last_seen key),
  // so always read the GDN recency key from a date field.
  const gdnKeyField = sort.field === 'gdn_ad.post_date' ? 'gdn_ad.post_date' : 'gdn_ad.last_seen';
  const getEsId = (src) => src?.['gdn_ad']?.['id'] ?? src?.['gdn_ad.id'];
  const merged = gdnHits
    .map(h => ({ src: 'gdn', id: getEsId(h._source), key: toEpochSeconds(h._source?.[gdnKeyField]), hit: h }))
    .concat(ytItems);

  // Stable sort by recency key (gdn entries precede yt on ties → deterministic).
  merged.sort((a, b) => (order === 'asc' ? a.key - b.key : b.key - a.key));

  const pageItems = merged.slice(from, upper);
  const total = gdnTotal + ytTotal;
  if (pageItems.length === 0) {
    return { code: 200, data: [], total, message: 'No ads found' };
  }

  const gdnSliceHits = pageItems.filter(it => it.src === 'gdn').map(it => it.hit);
  const ytIds        = pageItems.filter(it => it.src === 'yt').map(it => it.id);

  const [gdnAds, ytMap] = await Promise.all([
    enrichGdnHits(gdnSliceHits, db, logger),
    enrichYoutubeDisplayAds(ytIds, logger),
  ]);
  const gdnMap = new Map(gdnAds.map(ad => [String(ad.id), ad]));

  const data = [];
  for (const it of pageItems) {
    const ad = it.src === 'gdn' ? gdnMap.get(String(it.id)) : ytMap.get(String(it.id));
    if (ad) data.push(ad);
  }

  return { code: 200, data, total, message: 'Ads fetched successfully' };
}

// ─── Main search ──────────────────────────────────────────────────────────────

async function searchAds(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p   = normalizeParams(raw);

  if (!p.user_id) return { code: 400, message: 'Missing params: user_id is required' };

  if (p.favorite === 'true') return searchFavoriteAds(p, db, logger);
  if (p.hidden   === 'true') return searchHiddenAds(p,   db, logger);

  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  const { size, from } = parsePagination(p);
  const sort            = parseSort(p);

  // ─── Build ES query ────────────────────────────────────────────────────
  const builder = new SearchMixQueryBuilder(db.elastic?.indexName);

  builder
    .setFrom(from)
    .setSize(size)
    .setSortField(sort.field)
    .setSortMethod(sort.order);

  if (p.status && Array.isArray(p.status) && p.status.length > 0) builder.setStatus(p.status);

  const adPositionArr = p.ad_position ? ensureArray(p.ad_position) : [];
  if (adPositionArr.length > 0) builder.setAdPosition(adPositionArr);

  if (p.ad_sub_position) builder.setAdSubPosition(ensureArray(p.ad_sub_position));
  if (p.keyword)         builder.setKeyword(p.keyword);
  if (p.advertiser)      builder.setPostOwnerName(p.advertiser);
  if (p.domain)          builder.setUrl(p.domain);

  if (p.call_to_action)  builder.setCallToAction(ensureArray(p.call_to_action));
  if (p.adcategory)      builder.setAdCategory(ensureArray(p.adcategory));
  if (p.subCategory)     builder.setSubCategory(ensureArray(p.subCategory));
  if (p.tags)            builder.setTags(ensureArray(p.tags));
  if (p.target_keyword)  builder.setTargetKeyword(ensureArray(p.target_keyword));
  if (p.country)         builder.setCountry(ensureArray(p.country));
  if (p.type)            builder.setAdType(ensureArray(p.type));
  if (p.lang)            builder.setLangDetect(ensureArray(p.lang));
  if (p.gender)          builder.setGender(ensureArray(p.gender));

  if (p.lower_age && p.upper_age) {
    builder.setLowerAgeSeen({ lower_age: p.lower_age, upper_age: p.upper_age });
  }

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

  if (p.ecommerce)        builder.setBuiltWith(ensureArray(p.ecommerce));
  if (p.source)           builder.setSource(ensureArray(p.source));
  if (p.funnel)           builder.setFunnel(ensureArray(p.funnel));
  if (p.affiliate)        builder.setAffiliate(ensureArray(p.affiliate));
  if (p.market_platform)  builder.setMarketPlatform(ensureArray(p.market_platform));
  if (p.html_content)     builder.setHtmlContent(p.html_content);
  if (p.needle)           builder.setNeedle(p.needle);
  if (p.not_country)      builder.setNotCountry(p.not_country);

  if (p.ocr)             builder.setOcr(p.ocr);
  if (p.image_celebrity) builder.setCelebrity(ensureArray(p.image_celebrity));
  if (p.image_logo)      builder.setLogo(ensureArray(p.image_logo));
  if (p.image_object)    builder.setImageObject(ensureArray(p.image_object));
  if (p.size)            builder.setAdImageSize(p.size);

  const esParams = builder.build();

  // ─── YouTube DISPLAY merge ────────────────────────────────────────────
  // DISPLAY-type YouTube ads are shown under GDN (and hidden from YouTube). For
  // the normal pagination window + a recency sort, interleave them here. Falls
  // through to the standard GDN-only path otherwise (deep pages, exotic sorts,
  // YouTube unavailable) — see helpers/youtubeDisplayMerge.js.
  if (isDisplayMergeApplicable(p, sort, from, size)) {
    try {
      return await searchWithDisplayMerge({ db, logger, esParams, p, from, size, sort });
    } catch (mergeErr) {
      logger.warn('YouTube DISPLAY merge failed; falling back to GDN-only', { error: mergeErr.message });
      // fall through to the standard GDN-only path below
    }
  }

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

  logger.info('Executing GDN ad search', {
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

    // ─── Phase 2: enrich from SQL (shared with the DISPLAY merge path) ────
    const finalAds = await enrichGdnHits(esHits, db, logger);

    return {
      code: 200,
      data: finalAds,
      total,
      message: 'Ads fetched successfully',
    };

  } catch (err) {
    logger.error('Error in GDN searchAds', { error: err.message, stack: err.stack });
    return { code: 500, message: 'Error occurred in GDN ad search', error: err.message };
  }
}

module.exports = { searchAds, AD_DETAIL_SELECT, AD_DETAIL_JOINS };
