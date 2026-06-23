// controllers/getAdsByAdvertiserController.js
require("dotenv").config()
const { google: googNet } = require('../../../config/networks');
const { cleanAdsData } = require('../helpers/paramParser');
const { AD_DETAIL_SELECT, AD_DETAIL_JOINS, ES_FIELD_MAP } = require('./adSearchController');

async function getAdsByAdvertiser(req, db, logger) {
  try {
    const { ad_id, take = 1, skip = 0 } = req.body;
    if (!ad_id) return { code: 400, message: 'ad_id is required', data: null };

    const takeNum = Number(take) || 1;
    const skipNum = Number(skip) || 0;
    const offset = skipNum * takeNum;

    const sql = `SELECT ${AD_DETAIL_SELECT} ${AD_DETAIL_JOINS} WHERE google_text_ad.id = ? LIMIT ${takeNum} OFFSET ${offset}`;
    const result = await db.sql.query(sql, [Number(ad_id)]);
    const rows = Array.isArray(result[0]) ? result[0] : result;

    if (!rows.length) return { code: 400, message: 'No ads found', data: null };

    for (let row of rows) {
      if (db.elastic) {
        try {
          const esRes = await db.elastic.search({
            index: googNet?.database?.elastic?.index || process.env.GOOG_ELASTIC_INDEX || 'google_ads_data',
            body: { query: { bool: { filter: { term: { "id": row.id } } } } }
          });
          const hit = esRes.body?.hits?.hits?.[0]?._source || esRes.hits?.hits?.[0]?._source;
          if (hit) {
            for (const [esKey, responseKey] of Object.entries(ES_FIELD_MAP)) {
              if (hit[esKey] !== undefined && hit[esKey] !== null) {
                const val = hit[esKey];
                row[responseKey] = Array.isArray(val) ? val.join(', ') : val;
              }
            }
          }
        } catch (e) { logger.warn("ES error in Google search", { ad_id: row.id }); }
      }
    }

    return { code: 200, data: cleanAdsData(rows), total: rows.length, message: 'Ads fetched successfully' };
  } catch (err) {
    logger.error('Error in Google getAdsByAdvertiser', { error: err.message });
    return { code: 500, message: err.message, data: null };
  }
}

module.exports = { getAdsByAdvertiser };
