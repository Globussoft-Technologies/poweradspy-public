'use strict';

const networks = require('../src/config/networks');
const databaseManager = require('../src/database/DatabaseManager');
const { searchAds } = require('../src/services/google/controllers/adSearchController');
const { getAdDetails } = require('../src/services/google/controllers/adDetailController');

const logger = {
  info() {},
  debug() {},
  warn() {},
  error() {},
};

function rows(result) {
  if (!Array.isArray(result)) return [];
  return Array.isArray(result[0]) ? result[0] : result;
}

function valuePresent(value) {
  return value !== null && value !== undefined && value !== '';
}

function comparable(value) {
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value ?? null);
}

function addIssue(issues, id, layer, field, expected, actual) {
  if (comparable(expected) === comparable(actual)) return;
  issues.push({ id, layer, field, expected: expected ?? null, actual: actual ?? null });
}

function addMediaIssue(issues, id, layer, field, expected, actual) {
  const normalizedExpected = String(expected || '').replace(/^https:\/\/media\.globussoft\.com/i, '');
  const normalizedActual = String(actual || '').replace(/^https:\/\/media\.globussoft\.com/i, '');
  if (normalizedExpected === normalizedActual) return;
  addIssue(issues, id, layer, field, expected, actual);
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

async function main() {
  await databaseManager.connectAll({ google: networks.google });
  const db = databaseManager.getConnections('google');
  if (!db?.sql || !db?.elastic) throw new Error('Google SQL/Elasticsearch connection is unavailable');
  const index = db.elastic.indexName || 'google_ads_data_v2';

  const sqlAds = rows(await db.sql.query(
    `SELECT a.id, a.ad_id, a.type, a.post_date, a.first_seen, a.last_seen,
            v.title, v.text, v.newsfeed_description, v.image_url_original, v.image_url,
            po.post_owner_name, po.post_owner_image,
            m.platform, m.version, m.destination_url,
            p.advertiser_id, p.ad_url, p.subnetwork, p.region_code,
            p.impressions_min, p.impressions_max, p.impressions_operator,
            p.video_url_original, p.redirect_url
       FROM google_text_ad a
       JOIN google_text_ad_meta_data m ON m.google_text_ad_id = a.id AND m.platform = 18
       LEFT JOIN google_text_ad_variants v ON v.google_text_ad_id = a.id
       LEFT JOIN google_text_ad_post_owners po ON po.id = a.post_owner_id
       LEFT JOIN google_transparency_ad_payload p ON p.google_text_ad_id = a.id
      ORDER BY a.id`,
  ));
  const ids = sqlAds.map((ad) => Number(ad.id));

  const deliveryRows = ids.length ? rows(await db.sql.query(
    `SELECT d.google_text_ad_id, co.country, d.country_code, d.first_seen, d.last_seen,
            d.impressions_min, d.impressions_max, d.impressions_operator
       FROM google_transparency_country_delivery d
       JOIN google_text_country_only co ON co.id = d.country_only_id
      WHERE d.google_text_ad_id IN (${ids.map(() => '?').join(',')})
      ORDER BY d.google_text_ad_id, d.ordinal`,
    ids,
  )) : [];
  const deliveryById = new Map();
  for (const row of deliveryRows) {
    const id = Number(row.google_text_ad_id);
    if (!deliveryById.has(id)) deliveryById.set(id, []);
    deliveryById.get(id).push(row);
  }

  const esResult = await db.elastic.search({
    index,
    type: 'doc',
    body: {
      size: 1000,
      query: { term: { platform: 18 } },
      sort: [{ id: 'asc' }],
    },
  });
  const esHits = esResult?.hits?.hits || esResult?.body?.hits?.hits || [];
  const esById = new Map(esHits.map((hit) => [Number(hit._source?.id || hit._id), hit._source || {}]));

  const searchById = new Map();
  const maximumSearchPages = Math.ceil(Math.max(ids.length, 1) / 100) + 2;
  for (let page = 0; page < maximumSearchPages; page += 1) {
    const result = await searchAds({
      body: {
        user_id: 1,
        google_transparency_ads: true,
        google_transparency_subnetwork: 'NA',
        take: 100,
        // Search treats skip as a zero-based page number.
        skip: page,
      },
      query: {},
    }, db, logger);
    for (const ad of result.data || []) searchById.set(Number(ad.id || ad.ad_id), ad);
    if (!result.data?.length || searchById.size >= Number(result.total || ids.length)) break;
  }

  const detailResults = await mapLimit(ids, 10, async (id) => {
    const result = await getAdDetails({ body: { ad_id: String(id), language: 'en' }, query: {} }, db, logger);
    return [id, result];
  });
  const detailById = new Map(detailResults);

  const nullCounts = {
    title: 0,
    text: 0,
    image_url_original: 0,
    stored_image_or_thumbnail: 0,
    video_url_original: 0,
    subnetwork: 0,
    overall_impressions: 0,
    destination_url: 0,
    first_seen_payload_value: 0,
  };
  const issues = [];

  for (const ad of sqlAds) {
    const id = Number(ad.id);
    const es = esById.get(id);
    const search = searchById.get(id);
    const detailResult = detailById.get(id);
    const detail = detailResult?.data?.[0] || null;
    const countries = deliveryById.get(id) || [];

    if (!valuePresent(ad.title)) nullCounts.title++;
    if (!valuePresent(ad.text)) nullCounts.text++;
    if (!valuePresent(ad.image_url_original)) nullCounts.image_url_original++;
    if (!valuePresent(ad.image_url)) nullCounts.stored_image_or_thumbnail++;
    if (!valuePresent(ad.video_url_original)) nullCounts.video_url_original++;
    if (!valuePresent(ad.subnetwork)) nullCounts.subnetwork++;
    if (!valuePresent(ad.impressions_operator)
        && ad.impressions_min == null && ad.impressions_max == null) nullCounts.overall_impressions++;
    if (!valuePresent(ad.destination_url)) nullCounts.destination_url++;
    if (!es || !valuePresent(es.first_seen)) nullCounts.first_seen_payload_value++;

    if (!es) {
      issues.push({ id, layer: 'elasticsearch', field: 'document', expected: 'present', actual: null });
    } else {
      addIssue(issues, id, 'elasticsearch', 'ad_id', ad.ad_id, es.ad_id);
      addIssue(issues, id, 'elasticsearch', 'platform', 18, Number(es.platform));
      for (const field of [
        'advertiser_id', 'ad_url', 'subnetwork', 'region_code',
        'impressions_min', 'impressions_max', 'impressions_operator',
        'video_url_original', 'redirect_url',
      ]) {
        addIssue(issues, id, 'elasticsearch', field, ad[field], es[field]);
      }
      addIssue(issues, id, 'elasticsearch', 'image_url_original', ad.image_url_original, es.image_url_original);
      addIssue(issues, id, 'elasticsearch', 'country_details.length', countries.length, es.country_details?.length || 0);
    }

    if (!search) {
      issues.push({ id, layer: 'search_api', field: 'ad', expected: 'present', actual: null });
    } else {
      addIssue(issues, id, 'search_api', 'platform', 18, Number(search.platform));
      addIssue(issues, id, 'search_api', 'subnetwork', ad.subnetwork, search.subnetwork);
      addIssue(issues, id, 'search_api', 'advertiser_id', ad.advertiser_id, search.advertiser_id);
      addIssue(issues, id, 'search_api', 'ad_url', ad.ad_url, search.ad_url);
      addIssue(issues, id, 'search_api', 'country_details.length', countries.length, search.country_details?.length || 0);
      const expectedImpressions = valuePresent(ad.impressions_operator)
        || ad.impressions_min != null || ad.impressions_max != null
        ? {
            min: ad.impressions_min ?? null,
            max: ad.impressions_max ?? null,
            operator: ad.impressions_operator ?? null,
          }
        : null;
      addIssue(issues, id, 'search_api', 'impressions', expectedImpressions, search.impressions);
    }

    if (!detail || detailResult.code !== 200) {
      issues.push({
        id,
        layer: 'analytics_adDetails',
        field: 'response',
        expected: 200,
        actual: detailResult?.code ?? null,
      });
    } else {
      addIssue(issues, id, 'analytics_adDetails', 'platform', 18, Number(detail.platform));
      addIssue(issues, id, 'analytics_adDetails', 'subnetwork', ad.subnetwork, detail.subnetwork);
      addIssue(issues, id, 'analytics_adDetails', 'advertiser_id', ad.advertiser_id, detail.advertiser_id);
      addIssue(issues, id, 'analytics_adDetails', 'ad_url', ad.ad_url, detail.ad_url);
      addIssue(issues, id, 'analytics_adDetails', 'country_details.length', countries.length, detail.country_details?.length || 0);
      if (valuePresent(ad.image_url)) {
        const actualMedia = String(ad.type).toUpperCase() === 'VIDEO'
          ? detail.thumbnail
          : detail.image_video_url;
        addMediaIssue(issues, id, 'analytics_adDetails', 'stored_media', ad.image_url, actualMedia);
      }
      if (valuePresent(ad.video_url_original)) {
        addIssue(issues, id, 'analytics_adDetails', 'video_url_original', ad.video_url_original, detail.video_url_original);
      }
    }
  }

  const issueCounts = {};
  for (const issue of issues) {
    const key = `${issue.layer}.${issue.field}`;
    issueCounts[key] = (issueCounts[key] || 0) + 1;
  }

  console.log(JSON.stringify({
    elastic_index: index,
    sql_platform_18_ads: sqlAds.length,
    elastic_platform_18_docs: esById.size,
    search_api_ads_seen: searchById.size,
    analytics_details_checked: detailById.size,
    genuine_source_null_counts: nullCounts,
    mismatch_count: issues.length,
    mismatch_counts: issueCounts,
    mismatches: issues,
  }, null, 2));
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    })
    .finally(() => databaseManager.disconnectAll().catch(() => {}));
}

module.exports = { main, rows, valuePresent, comparable };
