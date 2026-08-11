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

function buildCommonClauses(input) {
  const must = [];
  const filter = [{ term: { status: 1 } }];

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

  if (type.length) filter.push({ terms: { type } });
  if (country.length) filter.push({ terms: { country } });
  if (state.length) filter.push({ terms: { state } });
  if (source.length) filter.push({ terms: { source } });
  if (subNetwork.length) filter.push({ terms: { sub_network: subNetwork } });
  if (sourceApp.length) filter.push({ terms: { source_app: sourceApp } });
  if (adPosition.length) filter.push({ terms: { ad_position: adPosition } });
  if (adSubPosition.length) filter.push({ terms: { ad_sub_position: adSubPosition } });
  if (imageSize.length) filter.push({ terms: { ad_image_size: imageSize } });

  const sortField = input.running_longest_sort === 'running_longest_sort' ? 'first_seen' : 'last_seen';
  const size = Math.min(Math.max(parseInt(input.take || input.page_size, 10) || 20, 1), 100);
  const page = Math.max(parseInt(input.skip || input.page, 10) || 0, 0);

  return { must, filter, sortField, size, page };
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
    days_running: daysRunning(source.first_seen, source.last_seen),
    image_url: imageUrl,
    image_video_url: imageUrl,
    image_url_original: source.image_url_original,
    ad_position: source.ad_position,
    country: Array.isArray(source.country) ? source.country.join(', ') : source.country,
    platform: 19,
    network: 'admob',
  };
}

async function searchAds(req, db, logger) {
  if (!db?.elastic) {
    return { code: 503, status: 'server_error', message: 'AdMob Elasticsearch connection is unavailable.', data: [], total: 0 };
  }

  const input = { ...(req.query || {}), ...(req.body || {}) };
  const favoriteRequested = input.favorite === 'true' || input.favorite === true || input.favorite === 1 || input.favorite === '1';
  const hiddenRequested = input.hidden === 'true' || input.hidden === true || input.hidden === 1 || input.hidden === '1';
  if (favoriteRequested) return searchFavoriteAds(input, db, logger);
  if (hiddenRequested) return searchHiddenAds(input, db, logger);

  const { must, filter, sortField, page, size } = buildCommonClauses(input);

  try {
    const result = await runElasticSearch(db, { must, filter, sortField, page, size });
    const hits = result.hits?.hits || [];
    return {
      code: 200,
      status: 'ok',
      message: 'AdMob ads fetched successfully.',
      data: hits.map(toCardRow),
      total: totalHits(result.hits?.total),
    };
  } catch (error) {
    logger.error('AdMob search failed', { error: error.message });
    return { code: 500, status: 'server_error', message: 'AdMob ads could not be fetched.', error: error.message, data: [], total: 0 };
  }
}

async function searchFavoriteAds(input, db, logger) {
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
      return { code: 200, status: 'ok', message: 'No favorite ads found', data: [], total: 0 };
    }

    const { must, filter, sortField, page, size } = buildCommonClauses(input);
    filter.push({ terms: { ad_id: adIds } });

    const result = await runElasticSearch(db, { must, filter, sortField, page, size });
    const hits = result.hits?.hits || [];
    return {
      code: 200,
      status: 'ok',
      message: 'Favorite ads fetched successfully.',
      data: hits.map(toCardRow),
      total: totalHits(result.hits?.total),
    };
  } catch (error) {
    logger.error('AdMob favorite search failed', { error: error.message });
    return { code: 500, status: 'server_error', message: 'AdMob favorite ads could not be fetched.', error: error.message, data: [], total: 0 };
  }
}

async function searchHiddenAds(input, db, logger) {
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
      return { code: 200, status: 'ok', message: 'No hidden ads found', data: [], total: 0 };
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

    const result = await runElasticSearch(db, { must, filter, sortField, page, size });
    const hits = result.hits?.hits || [];
    return {
      code: 200,
      status: 'ok',
      message: 'Hidden ads fetched successfully.',
      data: hits.map(toCardRow).map((ad) => attachHiddenMeta(ad, hiddenMeta)),
      total: totalHits(result.hits?.total),
    };
  } catch (error) {
    logger.error('AdMob hidden search failed', { error: error.message });
    return { code: 500, status: 'server_error', message: 'AdMob hidden ads could not be fetched.', error: error.message, data: [], total: 0 };
  }
}

module.exports = { searchAds };
