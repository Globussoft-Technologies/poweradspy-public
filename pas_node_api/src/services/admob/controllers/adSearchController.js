'use strict';

const { resolveMediaUrl } = require('../../../insertion/helpers/nasClient');

function active(value) {
  return value !== undefined && value !== null && value !== '' && value !== 'NA';
}

function values(value) {
  const list = Array.isArray(value) ? value : active(value) ? [value] : [];
  return list
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter((item) => item && item.toUpperCase() !== 'NA');
}

function totalHits(total) {
  return typeof total === 'object' && total !== null ? Number(total.value || 0) : Number(total || 0);
}

function imageSizeValues(value) {
  return [...new Set(values(value).flatMap((size) => {
    const normalized = size.replace(/\s/g, '').replace(/[x\u00d7*]/i, 'x');
    const [width, height] = normalized.split('x');
    if (!width || !height) return [size];
    return [`${width}x${height}`, `${width}*${height}`, `${width}\u00d7${height}`];
  }))];
}

function daysRunning(firstSeen, lastSeen) {
  if (!firstSeen || !lastSeen) return null;
  const start = Date.parse(firstSeen);
  const end = Date.parse(lastSeen);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(1, Math.ceil((end - start) / 86400000) + 1);
}

function normalizeAdId(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str ? str.toLowerCase() : null;
}

function normalizeNumericId(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeSessionId(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function rangeFilter(field, value) {
  if (!active(value)) return null;

  let minimum;
  let maximum;

  if (Array.isArray(value)) {
    [minimum, maximum] = value;
  } else if (value && typeof value === 'object') {
    minimum = value.min ?? value.gte ?? value.lower ?? value.lower_age;
    maximum = value.max ?? value.lte ?? value.upper ?? value.upper_age;
  } else {
    return null;
  }

  const range = {};
  const gte = Number(minimum);
  const lte = Number(maximum);

  if (Number.isFinite(gte)) range.gte = gte;
  if (Number.isFinite(lte)) range.lte = lte;
  if (!Object.keys(range).length) return null;

  return { range: { [field]: range } };
}

function buildCommonClauses(input) {
  const must = [];
  const filter = [{ term: { status: 1 } }];

  const internalId = normalizeNumericId(input.id ?? input.internal_id);
  const publicAdId = normalizeAdId(
    input.ad_id ?? input.adId ?? (internalId === null ? input.id : null)
  );
  if (internalId !== null && Number.isInteger(internalId) && internalId > 0) {
    filter.push({ term: { id: internalId } });
  } else if (publicAdId) {
    filter.push({ term: { ad_id: publicAdId } });
  }

  const keyword = [input.keyword, input.advertiser, input.domain]
    .find((value) => active(value) && String(value).trim());
  if (keyword) {
    must.push({
      simple_query_string: {
        query: String(keyword).trim(),
        fields: ['ad_title^3', 'ad_text^2', 'newsfeed_description', 'post_owner^2', 'ad_id', 'destination_host'],
        default_operator: 'and',
      },
    });
  }

  const type = values(input.type).map((value) => value.toLowerCase());
  const country = values(input.country).map((value) => value.toLowerCase());
  const state = values(input.state).map((value) => value.toLowerCase());
  const source = values(input.source).map((value) => value.toLowerCase());
  const subNetwork = values(input.sub_network ?? input.subNetwork).map((value) => value.toLowerCase());
  const sourceApp = values(input.source_app ?? input.sourceApp).map((value) => value.toLowerCase());
  const adPosition = values(input.ad_position ?? input.ad_position_filter).map((value) => value.toLowerCase());
  const adSubPosition = values(input.ad_sub_position).map((value) => value.toLowerCase());
  const imageSize = imageSizeValues(input.ad_image_size ?? input.size);
  const leadScoreRange = input.leadScoreRange ?? input.admob_lead_score_range ?? input.lead_score_range;
  const occurrenceCountRange = input.occurrenceCountRange ?? input.admob_occurrence_count_range ?? input.occurrence_count_range;
  const activeDaysRange = input.activeDaysRange ?? input.admob_active_days_range ?? input.active_days_range ?? input.days_running_range;
  // `order_column` is the shared frontend transport field. Keep the
  // AdMob-specific aliases supported for direct API callers as well.
  const sortInput = String(
    input.admobPosterSort ??
    input.admob_poster_sort ??
    input.sort_by ??
    input.rank_by ??
    input.sort ??
    input.order_column ??
    ''
  ).trim().toLowerCase();

  if (type.length) filter.push({ terms: { type } });
  if (country.length) filter.push({ terms: { country } });
  if (state.length) filter.push({ terms: { state } });
  if (source.length) filter.push({ terms: { source } });
  if (subNetwork.length) filter.push({ terms: { sub_network: subNetwork } });
  if (sourceApp.length) filter.push({ terms: { source_app: sourceApp } });
  if (adPosition.length) filter.push({ terms: { ad_position: adPosition } });
  if (adSubPosition.length) filter.push({ terms: { ad_sub_position: adSubPosition } });
  if (imageSize.length) filter.push({ terms: { ad_image_size: imageSize } });
  const leadScoreClause = rangeFilter('lead_score', leadScoreRange);
  const occurrenceCountClause = rangeFilter('occurrence_count', occurrenceCountRange);
  const activeDaysClause = rangeFilter('days_running', activeDaysRange);
  if (leadScoreClause) filter.push(leadScoreClause);
  if (occurrenceCountClause) filter.push(occurrenceCountClause);
  if (activeDaysClause) filter.push(activeDaysClause);

  // Ad Seen Date filter (calendar dropdown) — sent as [upper_epoch, lower_epoch]
  // seconds, same shape every other platform uses for seen_btn_sort.
  const seenBtnSort = input.seen_btn_sort;
  if (Array.isArray(seenBtnSort) && seenBtnSort.length === 2) {
    const lower = Number(seenBtnSort[1]);
    const upper = Number(seenBtnSort[0]);
    if (Number.isFinite(lower) && Number.isFinite(upper)) {
      filter.push({ range: { last_seen: { gte: lower, lte: upper, format: 'epoch_second' } } });
    }
  }

  let sortField = 'last_seen';
  if (sortInput === 'lead_score' || sortInput === 'top_ranked') sortField = 'lead_score';
  else if (sortInput === 'occurrence_count' || sortInput === 'most_seen') sortField = 'occurrence_count';
  else if (sortInput === 'days_running' || sortInput === 'active_days' || input.running_longest_sort === 'running_longest_sort') sortField = 'days_running';
  else if (sortInput === 'first_seen') sortField = 'first_seen';
  const size = Math.min(Math.max(parseInt(input.take || input.page_size, 10) || 20, 1), 100);
  const page = Math.max(parseInt(input.skip || input.page, 10) || 0, 0);

  return { must, filter, sortField, size, page };
}

async function resolveSessionScope(db, sessionId) {
  const normalized = normalizeSessionId(sessionId);
  if (!normalized) return { sessionId: null, adIds: null, summary: null };
  if (!db.sql) {
    return { error: { code: 503, status: 'server_error', message: 'SQL connection not available for session filtering.', data: [], total: 0 } };
  }

  const [adRows, summaryRows] = await Promise.all([
    db.sql.query(
      `SELECT DISTINCT a.id
       FROM mob_ad_observations o
       INNER JOIN mob_ads a ON a.id = o.ad_id
       WHERE o.session_id = ?`,
      [normalized]
    ),
    db.sql.query(
      `SELECT COUNT(DISTINCT a.id) AS ad_count,
              COUNT(DISTINCT a.post_owner_id) AS post_owner_count
       FROM mob_ad_observations o
       INNER JOIN mob_ads a ON a.id = o.ad_id
       WHERE o.session_id = ?`,
      [normalized]
    ),
  ]);

  const adIds = [...new Set((adRows || [])
    .map((row) => normalizeNumericId(row.id))
    .filter((value) => value !== null))];
  const summaryRow = summaryRows?.[0] || {};
  return {
    sessionId: normalized,
    adIds,
    summary: {
      session_id: normalized,
      ad_count: Number(summaryRow.ad_count || 0),
      post_owner_count: Number(summaryRow.post_owner_count || 0),
    },
  };
}

async function runElasticSearch(db, { must, filter, sortField, page, size }) {
  const response = await db.elastic.search({
    index: db.elastic.indexName || 'mob_search_mix',
    body: {
      from: page * size,
      size,
      track_total_hits: true,
      query: { bool: { must, filter } },
      sort: [{ [sortField]: { order: 'desc', missing: '_last' } }, { id: 'desc' }],
    },
  });
  return response.body || response;
}

function buildHiddenMeta(rows) {
  const hiddenOwners = new Map();
  const hiddenAds = new Map();

  for (const row of rows || []) {
    const type = Number(row.type);
    if (type === 1 && row.post_owner_id != null) {
      const ownerId = normalizeNumericId(row.post_owner_id);
      if (ownerId != null && !hiddenOwners.has(String(ownerId))) {
        hiddenOwners.set(String(ownerId), {
          hideType: 1,
          hiddenPostOwnerId: ownerId,
        });
      }
      continue;
    }

    if ((type === 2 || type === 3) && row.ad_id != null) {
      const adId = normalizeAdId(row.ad_id);
      if (adId && !hiddenAds.has(adId)) {
        hiddenAds.set(adId, {
          hideType: type,
          hiddenPostOwnerId: row.post_owner_id != null ? normalizeNumericId(row.post_owner_id) : null,
        });
      }
    }
  }

  return { hiddenOwners, hiddenAds };
}

function attachHiddenMeta(ad, hiddenMeta) {
  const adKey = normalizeAdId(ad.ad_id || ad.id);
  const adMeta = adKey ? hiddenMeta.hiddenAds.get(adKey) : null;
  if (adMeta) {
    return { ...ad, hideType: adMeta.hideType, ad_type: adMeta.hideType, hiddenPostOwnerId: adMeta.hiddenPostOwnerId ?? null };
  }

  const ownerValue = ad.post_owner_id ?? ad.postOwnerId;
  const ownerKey = ownerValue != null ? String(normalizeNumericId(ownerValue) ?? ownerValue) : null;
  const ownerMeta = ownerKey ? hiddenMeta.hiddenOwners.get(ownerKey) : null;
  if (ownerMeta) {
    return { ...ad, hideType: ownerMeta.hideType, ad_type: ownerMeta.hideType, hiddenPostOwnerId: ownerMeta.hiddenPostOwnerId ?? null };
  }

  return ad;
}

function toCardRow(hit) {
  const source = hit._source || {};
  const imageUrl = resolveMediaUrl(source.image_url);
  const daysRunningValue = source.days_running ?? daysRunning(source.first_seen, source.last_seen);
  return {
    ...source,
    id: source.id ?? Number(hit._id),
    ad_id: source.ad_id,
    type: source.type,
    post_owner: source.post_owner,
    post_owner_image: source.post_owner_image,
    post_date: source.post_date,
    first_seen: source.first_seen,
    last_seen: source.last_seen,
    days_running: daysRunningValue,
    occurrence_count: Number(source.occurrence_count || 0),
    lead_score: Number(source.lead_score || 0),
    image_url: imageUrl,
    image_video_url: imageUrl,
    image_url_original: source.image_url_original,
    ad_position: source.ad_position,
    country: Array.isArray(source.country) ? source.country.join(', ') : source.country,
    platform: 19,
    network: 'admob',
  };
}

async function resolveAdRecord(sql, input) {
  const internalId = normalizeNumericId(input.id ?? input.internal_id);
  const publicAdId = normalizeAdId(
    input.ad_id ?? input.adId ?? (internalId === null ? input.id : null)
  );

  if (internalId !== null && Number.isInteger(internalId) && internalId > 0) {
    const rows = await sql.query(
      `SELECT id, ad_id, first_seen, last_seen
       FROM mob_ads
       WHERE id = ?
       LIMIT 1`,
      [internalId]
    );
    return rows?.[0] || null;
  }

  if (!publicAdId) return null;

  const rows = await sql.query(
    `SELECT id, ad_id, first_seen, last_seen
     FROM mob_ads
     WHERE LOWER(TRIM(ad_id)) = ?
     LIMIT 1`,
    [publicAdId]
  );
  return rows?.[0] || null;
}

async function getAdSessions(req, db, logger) {
  if (!db?.sql) {
    return {
      code: 503,
      status: 'server_error',
      message: 'AdMob SQL connection is unavailable.',
      data: null,
    };
  }

  const input = { ...(req.query || {}), ...(req.body || {}) };

  try {
    const ad = await resolveAdRecord(db.sql, input);
    if (!ad) {
      return {
        code: 404,
        status: 'not_found',
        message: 'AdMob ad not found.',
        data: null,
      };
    }

    const size = boundedInteger(input.take ?? input.limit, 25, 1, 100);
    const page = boundedInteger(input.skip ?? input.page, 0, 0, 1000000);
    const offset = page * size;

    const sourceAppRows = await db.sql.query(
      'SELECT source_app_id FROM mob_ad_source_apps WHERE ad_id = ?',
      [ad.id]
    );
    const sourceAppIds = [...new Set((sourceAppRows || [])
      .map((row) => normalizeNumericId(row.source_app_id))
      .filter((value) => value !== null))];

    const occurrenceCountPromise = db.sql.query(
      'SELECT COUNT(*) AS sessions_total FROM mob_ad_observations WHERE ad_id = ?',
      [ad.id]
    );
    const sessionRowsPromise = db.sql.query(
      `SELECT session_id, system_id, observed_at, repeat_count
       FROM mob_ad_observations
       WHERE ad_id = ?
       ORDER BY observed_at DESC
       LIMIT ${size}
       OFFSET ${offset}`,
      [ad.id]
    );
    // No linked source app to scope by — fall back to this ad's own session
    // count instead of an unbounded, unfiltered scan of the whole table.
    const totalSessionsPromise = sourceAppIds.length > 0
      ? db.sql.query(
        `SELECT COUNT(DISTINCT o.session_id) AS total_sessions
         FROM mob_ad_observations o
         INNER JOIN mob_ad_source_apps x ON x.ad_id = o.ad_id
         WHERE x.source_app_id IN (${sourceAppIds.map(() => '?').join(', ')})`,
        sourceAppIds
      )
      : occurrenceCountPromise.then((rows) => [
        { total_sessions: Number(rows?.[0]?.sessions_total || 0) },
      ]);

    // Per-app breakdowns for the Session History card: how many times THIS ad
    // was seen in each app (appearance_count), and how many sessions were
    // tracked for each app individually (not summed/deduped across apps).
    const sourceAppNamesPromise = sourceAppIds.length > 0
      ? db.sql.query(
        `SELECT s.id AS source_app_id, s.source_app AS name, x.appearance_count
         FROM mob_ad_source_apps x
         JOIN mob_source_apps s ON s.id = x.source_app_id
         WHERE x.ad_id = ?`,
        [ad.id]
      )
      : Promise.resolve([]);
    const trackedByAppPromise = sourceAppIds.length > 0
      ? db.sql.query(
        `SELECT x.source_app_id, COUNT(DISTINCT o.session_id) AS tracked
         FROM mob_ad_observations o
         INNER JOIN mob_ad_source_apps x ON x.ad_id = o.ad_id
         WHERE x.source_app_id IN (${sourceAppIds.map(() => '?').join(', ')})
         GROUP BY x.source_app_id`,
        sourceAppIds
      )
      : Promise.resolve([]);

    const [occurrenceRows, sessionRows, totalSessionRows, sourceAppNameRows, trackedByAppRows] = await Promise.all([
      occurrenceCountPromise,
      sessionRowsPromise,
      totalSessionsPromise,
      sourceAppNamesPromise,
      trackedByAppPromise,
    ]);

    const trackedByAppId = new Map(
      (trackedByAppRows || []).map((row) => [normalizeNumericId(row.source_app_id), Number(row.tracked || 0)])
    );
    const sessionsSeenByApp = (sourceAppNameRows || []).map((row) => ({
      name: row.name,
      count: Number(row.appearance_count || 0),
    }));
    const trackedSessionsByApp = (sourceAppNameRows || []).map((row) => ({
      name: row.name,
      count: trackedByAppId.get(normalizeNumericId(row.source_app_id)) || 0,
    }));

    const occurrenceCount = Number(occurrenceRows?.[0]?.sessions_total || 0);
    const trackedSessionsTotal = Number(totalSessionRows?.[0]?.total_sessions || 0);
    const safeTrackedSessionsTotal = trackedSessionsTotal > 0 ? trackedSessionsTotal : occurrenceCount;
    const occurrenceRate = safeTrackedSessionsTotal > 0
      ? occurrenceCount / safeTrackedSessionsTotal
      : null;
    const runningDays = daysRunning(ad.first_seen, ad.last_seen);

    return {
      code: 200,
      status: 'ok',
      message: 'AdMob ad sessions fetched successfully.',
      data: {
        id: ad.id,
        ad_id: ad.ad_id,
        first_seen: ad.first_seen,
        last_seen: ad.last_seen,
        days_running: runningDays,
        occurrence_count: occurrenceCount,
        sessions_total: occurrenceCount,
        total_sessions: safeTrackedSessionsTotal,
        sessions_seen_by_app: sessionsSeenByApp,
        tracked_sessions_by_app: trackedSessionsByApp,
        occurrence_rate: occurrenceRate == null ? null : Number(occurrenceRate.toFixed(6)),
        occurrence_rate_percent: occurrenceRate == null ? null : Number((occurrenceRate * 100).toFixed(2)),
        lead_score: occurrenceCount * (runningDays || 0),
        page,
        size,
        sessions: (sessionRows || []).map((row) => ({
          session_id: row.session_id,
          system_id: row.system_id,
          observed_at: row.observed_at,
          repeat_count: Number(row.repeat_count || 1),
        })),
      },
    };
  } catch (error) {
    logger.error('AdMob sessions lookup failed', { error: error.message });
    return {
      code: 500,
      status: 'server_error',
      message: 'AdMob ad sessions could not be fetched.',
      error: error.message,
      data: null,
    };
  }
}

async function searchAds(req, db, logger) {
  if (!db?.elastic) {
    return { code: 503, status: 'server_error', message: 'AdMob Elasticsearch connection is unavailable.', data: [], total: 0 };
  }

  const input = { ...(req.query || {}), ...(req.body || {}) };
  const favoriteRequested = input.favorite === 'true' || input.favorite === true || input.favorite === 1 || input.favorite === '1';
  const hiddenRequested = input.hidden === 'true' || input.hidden === true || input.hidden === 1 || input.hidden === '1';
  const sessionScope = await resolveSessionScope(db, input.session_id);
  if (sessionScope.error) return sessionScope.error;
  if (favoriteRequested) return searchFavoriteAds(input, db, logger, sessionScope);
  if (hiddenRequested) return searchHiddenAds(input, db, logger, sessionScope);

  const { must, filter, sortField, page, size } = buildCommonClauses(input);
  if (sessionScope.adIds) {
    if (sessionScope.adIds.length === 0) {
      return {
        code: 200,
        status: 'ok',
        message: 'AdMob ads fetched successfully.',
        data: [],
        total: 0,
        session_summary: sessionScope.summary,
      };
    }
    filter.push({ terms: { id: sessionScope.adIds } });
  }

  try {
    const result = await runElasticSearch(db, { must, filter, sortField, page, size });
    const hits = result.hits?.hits || [];
    return {
      code: 200,
      status: 'ok',
      message: 'AdMob ads fetched successfully.',
      data: hits.map(toCardRow),
      total: totalHits(result.hits?.total),
      session_summary: sessionScope.summary,
    };
  } catch (error) {
    logger.error('AdMob search failed', { error: error.message });
    return { code: 500, status: 'server_error', message: 'AdMob ads could not be fetched.', error: error.message, data: [], total: 0 };
  }
}

async function searchFavoriteAds(input, db, logger, sessionScope = { adIds: null, summary: null }) {
  try {
    if (!db.sql) return { code: 503, status: 'server_error', message: 'SQL connection not available.', data: [], total: 0 };
    if (!db.elastic) return { code: 503, status: 'server_error', message: 'AdMob Elasticsearch connection is unavailable.', data: [], total: 0 };
    if (!input.user_id) return { code: 400, status: 'bad_request', message: 'Missing required param: user_id', data: [], total: 0 };

    const favoriteRows = await db.sql.query(
      'SELECT ad_id FROM mob_hidden_ads WHERE user_id = ? AND type = 3',
      [input.user_id]
    );
    const adIds = [...new Set((favoriteRows || [])
      .map((row) => normalizeAdId(row.ad_id))
      .filter(Boolean))];
    if (adIds.length === 0) {
      return { code: 200, status: 'ok', message: 'No favorite ads found', data: [], total: 0, session_summary: sessionScope.summary };
    }

    const { must, filter, sortField, page, size } = buildCommonClauses(input);
    filter.push({ terms: { ad_id: adIds } });
    if (sessionScope.adIds) {
      if (sessionScope.adIds.length === 0) {
        return { code: 200, status: 'ok', message: 'No favorite ads found', data: [], total: 0, session_summary: sessionScope.summary };
      }
      filter.push({ terms: { id: sessionScope.adIds } });
    }

    const result = await runElasticSearch(db, { must, filter, sortField, page, size });
    const hits = result.hits?.hits || [];
    return {
      code: 200,
      status: 'ok',
      message: 'Favorite ads fetched successfully.',
      data: hits.map(toCardRow),
      total: totalHits(result.hits?.total),
      session_summary: sessionScope.summary,
    };
  } catch (error) {
    logger.error('AdMob favorite search failed', { error: error.message });
    return { code: 500, status: 'server_error', message: 'AdMob favorite ads could not be fetched.', error: error.message, data: [], total: 0 };
  }
}

async function searchHiddenAds(input, db, logger, sessionScope = { adIds: null, summary: null }) {
  try {
    if (!db.sql) return { code: 503, status: 'server_error', message: 'SQL connection not available.', data: [], total: 0 };
    if (!db.elastic) return { code: 503, status: 'server_error', message: 'AdMob Elasticsearch connection is unavailable.', data: [], total: 0 };
    if (!input.user_id) return { code: 400, status: 'bad_request', message: 'Missing required param: user_id', data: [], total: 0 };

    const hiddenRows = await db.sql.query(
      'SELECT post_owner_id, ad_id, type FROM mob_hidden_ads WHERE user_id = ? AND type IN (1, 2)',
      [input.user_id]
    );

    const hiddenMeta = buildHiddenMeta(hiddenRows);
    const hiddenOwnerIds = [...hiddenMeta.hiddenOwners.keys()].map((value) => Number(value)).filter((value) => Number.isFinite(value));
    const hiddenAdIds = [...hiddenMeta.hiddenAds.keys()];

    if (hiddenOwnerIds.length === 0 && hiddenAdIds.length === 0) {
      return { code: 200, status: 'ok', message: 'No hidden ads found', data: [], total: 0, session_summary: sessionScope.summary };
    }

    const { must, filter, sortField, page, size } = buildCommonClauses(input);
    const should = [];
    if (hiddenOwnerIds.length) should.push({ terms: { post_owner_id: hiddenOwnerIds } });
    if (hiddenAdIds.length) should.push({ terms: { ad_id: hiddenAdIds } });
    if (should.length) {
      filter.push({
        bool: {
          should,
          minimum_should_match: 1,
        },
      });
    }
    if (sessionScope.adIds) {
      if (sessionScope.adIds.length === 0) {
        return { code: 200, status: 'ok', message: 'No hidden ads found', data: [], total: 0, session_summary: sessionScope.summary };
      }
      filter.push({ terms: { id: sessionScope.adIds } });
    }

    const result = await runElasticSearch(db, { must, filter, sortField, page, size });
    const hits = result.hits?.hits || [];
    return {
      code: 200,
      status: 'ok',
      message: 'Hidden ads fetched successfully.',
      data: hits.map(toCardRow).map((ad) => attachHiddenMeta(ad, hiddenMeta)),
      total: totalHits(result.hits?.total),
      session_summary: sessionScope.summary,
    };
  } catch (error) {
    logger.error('AdMob hidden search failed', { error: error.message });
    return { code: 500, status: 'server_error', message: 'AdMob hidden ads could not be fetched.', error: error.message, data: [], total: 0 };
  }
}

module.exports = { searchAds, getAdSessions };
