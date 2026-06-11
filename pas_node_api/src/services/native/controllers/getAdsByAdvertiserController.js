// controllers/getAdsByAdvertiserController.js
require("dotenv").config()
const { native: natNet } = require('../../../config/networks');
const { cleanAdsData } = require('../helpers/paramParser');
const { AD_DETAIL_SELECT, AD_DETAIL_JOINS } = require('./adSearchController');

async function getAdsByAdvertiser(req, db, logger) {
  try {
    const { ad_id, take = 1, skip = 0 } = req.body;
    if (!ad_id) return { code: 400, message: 'ad_id is required', data: null };

    const takeNum = Number(take) || 1;
    const skipNum = Number(skip) || 0;
    const offset = skipNum * takeNum;

    const sql = `SELECT ${AD_DETAIL_SELECT} ${AD_DETAIL_JOINS} WHERE native_ad.id = ? LIMIT ${takeNum} OFFSET ${offset}`;
    const result = await db.sql.query(sql, [Number(ad_id)]);
    const rows = Array.isArray(result[0]) ? result[0] : result;

    if (!rows.length) return { code: 400, message: 'No ads found', data: null };

    for (let row of rows) {
      if (db.elastic) {
        try {
          const esRes = await db.elastic.search({
            index: natNet?.database?.elastic?.index || process.env.NATIVE_ELASTIC_INDEX || 'native_ads_data',
            body: { query: { bool: { filter: { term: { "native_ad.id": row.id } } } } }
          });
          const hit = esRes.body?.hits?.hits?.[0]?._source || esRes.hits?.hits?.[0]?._source;
          if (hit?.new_nas_image_url) row.image_video_url = hit.new_nas_image_url;
          else if (hit?.['native_ad.nas_url']) row.image_video_url = hit['native_ad.nas_url'];
        } catch (e) { logger.warn("ES error in Native search", { ad_id: row.id }); }
      }
    }

    return { code: 200, data: cleanAdsData(rows), total: rows.length, message: 'Ads fetched successfully' };
  } catch (err) {
    logger.error('Error in Native getAdsByAdvertiser', { error: err.message });
    return { code: 500, message: err.message, data: null };
  }
}

module.exports = { getAdsByAdvertiser };
