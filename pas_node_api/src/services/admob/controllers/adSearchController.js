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
  const size = Math.min(Math.max(parseInt(input.take || input.page_size, 10) || 20, 1), 100);
  const page = Math.max(parseInt(input.skip || input.page, 10) || 0, 0);
  const filter = [{ term: { status: 1 } }];
  const must = [];

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
  const body = {
    from: page * size,
    size,
    track_total_hits: true,
    query: { bool: { must, filter } },
    sort: [{ [sortField]: { order: 'desc', missing: '_last' } }, { id: 'desc' }],
  };

  try {
    const response = await db.elastic.search({ index: db.elastic.indexName || 'mob_search_mix', body });
    const result = response.body || response;
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

module.exports = { searchAds };
