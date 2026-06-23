'use strict';

/**
 * Lightweight Ad Details — Node port of Userv2Controller@getAdDetailsData
 * (PHP route: GET /get-ad-details/{adId}).
 *
 * GET /api/v1/common/get-ad-details/:adId
 *
 * Looks up a single Facebook ad in the `search_mix` ES index by `facebook_ad.id`
 * and returns a trimmed card payload (title, text, newsfeed_description,
 * image_url, category, subcategory). IMAGE-type ads use the NAS image URL,
 * everything else falls back to the thumbnail; the chosen path is prefixed with
 * env('NAS_URL_FE') exactly as PHP does.
 *
 * Faithful to PHP:
 *   - Always responds HTTP 200 (Laravel response()->json() defaults to 200);
 *     the real status lives in the body `code`.
 *   - No data found -> body { code: 404, message: 'No data found for the given ad_id' }
 *   - On error      -> body { code: 400, message: 'Error in getAdDetailsData: ...' }
 *   - No auth (PHP route only carries the `cors` middleware).
 */

const databaseManager = require('../../../database/DatabaseManager');
const logger = require('../../../logger');

const log = logger.createChild('get-ad-details');

async function getAdDetailsData(req, res) {
  const response = {};
  try {
    const adId = req.params.adId;

    // Mirrors PHP: sets the message but does NOT short-circuit (the route param
    // is required, so in practice this branch is unreachable).
    if (!adId) {
      response.code = 400;
      response.message = 'ad_id is required';
    }

    const esConn = databaseManager.getElastic('facebook');
    if (!esConn || !esConn.client) {
      response.code = 400;
      response.message = 'Error in getAdDetailsData: Elasticsearch is not configured';
      return res.json(response);
    }

    const params = {
      index: esConn.indexName,
      body: {
        query: {
          bool: {
            filter: {
              terms: {
                'facebook_ad.id': [adId],
              },
            },
          },
        },
      },
    };

    const results = await esConn.search(params);
    // ES client v8 returns the body directly; v7 wraps it as { body: {...} }.
    const hits = results?.hits?.hits || results?.body?.hits?.hits || [];

    if (hits.length === 0) {
      response.code = 404;
      response.message = 'No data found for the given ad_id';
      return res.json(response);
    }

    const source = hits[0]._source || {};

    let imageUrl;
    if ((source['facebook_ad.type'] || '') === 'IMAGE') {
      imageUrl = source['new_nas_image_url'] || '';
    } else {
      imageUrl = source['thumbnail_url'] || '';
    }

    const data = {
      title: source['facebook_ad_variants.title'] || '',
      text: source['facebook_ad_variants.text'] || '',
      newsfeed_description: source['facebook_ad_variants.newsfeed_description'] || '',
      image_url: (process.env.NAS_URL_FE || '') + imageUrl,
      category: source['facebook.category'] || '',
      subcategory: source['facebook.subCategory'] || '',
    };

    response.code = 200;
    response.message = 'Data Fetched Successfully';
    response.data = data;
  } catch (e) {
    log.error('Error occurred in function getAdDetailsData', { error: e.message });
    response.code = 400;
    response.message = 'Error in getAdDetailsData: ' + e.message;
  }
  return res.json(response);
}

module.exports = { getAdDetailsData };
