'use strict';

const networks = require('../src/config/networks');
const databaseManager = require('../src/database/DatabaseManager');
const { searchAds } = require('../src/services/google/controllers/adSearchController');
const { getAdDetails } = require('../src/services/google/controllers/adDetailController');
const {
  getGoogleAdCountry,
  getGoogleOutgoings,
  getAdvertiserCountryData,
} = require('../src/services/google/controllers/adInsightsController');

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

async function main() {
  const id = Number(process.argv[2]);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('Usage: node scripts/diagnose-google-transparency-ad.js <positive-internal-id>');
  }

  await databaseManager.connectAll({ google: networks.google });
  const sql = databaseManager.getSQL('google');
  const elastic = databaseManager.getElastic('google');
  const db = databaseManager.getConnections('google');
  if (!sql) throw new Error('Google SQL connection is unavailable');

  const canonical = rows(await sql.query(
    `SELECT a.id, a.ad_id, a.type, a.post_date, a.first_seen, a.last_seen,
            v.title, v.text, v.newsfeed_description, v.image_url_original, v.image_url,
            m.platform, m.version, m.destination_url,
            p.advertiser_id, p.ad_url, p.subnetwork, p.region_code,
            p.impressions_min, p.impressions_max, p.impressions_operator,
            p.video_url_original, p.redirect_url, p.othermultimedia
       FROM google_text_ad a
       LEFT JOIN google_text_ad_variants v ON v.google_text_ad_id = a.id
       LEFT JOIN google_text_ad_meta_data m ON m.google_text_ad_id = a.id
       LEFT JOIN google_transparency_ad_payload p ON p.google_text_ad_id = a.id
      WHERE a.id = ?
      LIMIT 1`,
    [id],
  ))[0] || null;

  const countryDelivery = rows(await sql.query(
    `SELECT co.country, d.country_code, d.first_seen, d.last_seen,
            d.impressions_min, d.impressions_max, d.impressions_operator
       FROM google_transparency_country_delivery d
       JOIN google_text_country_only co ON co.id = d.country_only_id
      WHERE d.google_text_ad_id = ?
      ORDER BY d.ordinal`,
    [id],
  ));

  let elasticDocument = null;
  let elasticError = null;
  const index = elastic?.indexName || networks.google?.database?.elastic?.index || 'google_ads_data_v2';
  try {
    const client = elastic?.client || elastic;
    if (!client || typeof client.get !== 'function') throw new Error('Google Elasticsearch connection is unavailable');
    const result = await client.get({ index, type: 'doc', id: String(id) });
    elasticDocument = result?._source || result?.body?._source || null;
  } catch (error) {
    elasticError = error.message;
  }

  const advertiser = canonical?.advertiser_id
    ? elasticDocument?.post_owner_name || null
    : null;
  const searchResponse = advertiser
    ? await searchAds({
        body: {
          user_id: 1,
          advertiser,
          platform: 18,
          google_transparency_ads: true,
          google_transparency_subnetwork: 'NA',
          take: 100,
          skip: 0,
        },
        query: {},
      }, db, logger)
    : null;
  const searchAd = searchResponse?.data?.find((ad) => Number(ad.id || ad.ad_id) === id) || null;
  const request = { body: { ad_id: String(id), google_text_ad_id: String(id), user_id: 1, language: 'en' }, query: {} };
  const [adDetails, advertiserCountryData, country, outgoingLinks] = await Promise.all([
    getAdDetails(request, db, logger),
    getAdvertiserCountryData(request, db, logger),
    getGoogleAdCountry(request, db, logger),
    getGoogleOutgoings(request, db, logger),
  ]);

  console.log(JSON.stringify({
    internal_id: id,
    elastic_index: index,
    sql: canonical,
    country_delivery: countryDelivery,
    elasticsearch: elasticDocument,
    elastic_error: elasticError,
    api_controller: {
      advertiser_filter: advertiser,
      search_total: searchResponse?.total ?? null,
      search_match: searchAd,
      insights: {
        adDetails,
        advertiserCountryData,
        country,
        outgoingLinks,
      },
    },
  }, null, 2));
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => databaseManager.disconnectAll().catch(() => {}));
}

module.exports = { main, rows };
