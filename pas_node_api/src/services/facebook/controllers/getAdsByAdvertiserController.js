// controllers/getAdsByAdvertiserController.js
require("dotenv").config()
const { facebook: fbNet } = require('../../../config/networks');
const { cleanAdsData } = require('../helpers/paramParser');

// reuse from your existing file
const { AD_DETAIL_SELECT, AD_DETAIL_JOINS } = require('../controllers/adSearchController');

async function getAdsByAdvertiser(req, db, logger) {
  try {
    const { ad_id, take = 1, skip = 0 } = req.body;

    if (!ad_id) {
      return { code: 400, message: 'ad_id is required', data: null };
    }

    const takeNum = Number(take) || 1;
    const skipNum = Number(skip) || 0;
    const offset = skipNum * takeNum;

    const sql = `
      SELECT ${AD_DETAIL_SELECT}
      ${AD_DETAIL_JOINS}
      WHERE facebook_ad.id = ?
      ORDER BY facebook_ad.id DESC
      LIMIT ${takeNum} OFFSET ${offset}
    `;

    const result = await db.sql.query(sql, [Number(ad_id)]);
    const rows = Array.isArray(result[0]) ? result[0] : result;

    if (!rows.length) {
      return { code: 400, message: 'No ads found', data: null };
    }

    // FULL PHP LOGIC
    for (let value of rows) {

      // urlArray
      const urlsRes = await db.sql.query(
        'SELECT url FROM facebook_ad_url WHERE facebook_ad_id = ?',
        [value.id]
      );
      value.urlArray = Array.isArray(urlsRes[0]) ? urlsRes[0] : urlsRes;

      // Elasticsearch
      if (db.elastic) {
        try {
          const esRes = await db.elastic.search({
            index: fbNet?.database?.elastic?.index || process.env.FB_ELASTIC_INDEX || 'search_mix',
            body: {
              query: {
                bool: {
                  filter: {
                    match: {
                      "facebook_ad.id": value.id
                    }
                  }
                }
              }
            }
          });

          const hit = esRes.body?.hits?.hits?.[0]?._source;

          if (hit?.new_nas_image_url) {
            value.image_video_url = hit.new_nas_image_url;
            value.image_url = hit.new_nas_image_url;
          }

        } catch (e) {
          logger.warn("ES error", { ad_id: value.id });
        }
      }
    }
    const finalData = cleanAdsData(rows);

    return {
      code: 200,
      message: 'Ad data found',
      data: finalData,
      ads_count: 1,
    };

  } catch (err) {
    logger.error('Error in getAdsByAdvertiser', { error: err.message });
    return {
      code: 500,
      message: err.message,
      data: null,
    };
  }
}

module.exports = { getAdsByAdvertiser };