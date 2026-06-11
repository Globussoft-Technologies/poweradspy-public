// controllers/getAdsByAdvertiserController.js
require("dotenv").config()
const { instagram: igNet } = require('../../../config/networks');
const { cleanAdsData } = require('../helpers/paramParser');
const { AD_DETAIL_SELECT, AD_DETAIL_JOINS } = require('./adSearchController');

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
      WHERE instagram_ad.id = ?
      LIMIT ${takeNum} OFFSET ${offset}
    `;

    const result = await db.sql.query(sql, [Number(ad_id)]);
    const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;

    if (!rows || rows.length === 0) {
      return { code: 400, message: 'No ads found', data: null };
    }

    // Process each row for urlArray and ES overlay
    for (let value of rows) {
      // urlArray
      const urlsRes = await db.sql.query(
        'SELECT url FROM instagram_ad_url WHERE instagram_ad_id = ?',
        [value.id]
      );
      value.urlArray = Array.isArray(urlsRes[0]) ? urlsRes[0] : urlsRes;

      // Elasticsearch Overlay
      if (db.elastic) {
        try {
          const esRes = await db.elastic.search({
            index: igNet?.database?.elastic?.index || process.env.IG_ELASTIC_INDEX || 'instagram_ads_data',
            body: {
              query: {
                bool: {
                  filter: {
                    term: { "instagram_ad.id": value.id }
                  }
                }
              }
            }
          });

          const hit = esRes.body?.hits?.hits?.[0]?._source || esRes.hits?.hits?.[0]?._source;

          if (hit?.new_nas_image_url) {
            value.image_video_url = hit.new_nas_image_url;
            value.image_url = hit.new_nas_image_url;
          }
        } catch (e) {
          logger.warn("ES error in Instagram advertiser search", { ad_id: value.id, error: e.message });
        }
      }
    }

    const finalData = cleanAdsData(rows);

    return {
      code: 200,
      data: finalData,
      total: finalData.length,
      message: 'Ads fetched successfully',
    };

  } catch (err) {
    logger.error('Error in Instagram getAdsByAdvertiser', { error: err.message });
    return {
      code: 500,
      message: err.message,
      data: null,
    };
  }
}

module.exports = { getAdsByAdvertiser };
