'use strict';

const repo = require('./repository');

function esHits(result) {
  return result?.body?.hits?.hits || result?.hits?.hits || [];
}

async function searchAd(elastic, adId, log) {
  if (!elastic) return false;

  try {
    const response = await elastic.search({
      index: elastic.indexName || 'mob_search_mix',
      body: {
        size: 1,
        track_total_hits: false,
        query: {
          term: {
            ad_id: String(adId).trim().toLowerCase(),
          },
        },
      },
    });

    return esHits(response).length > 0;
  } catch (error) {
    log?.error?.('admob.landers.searchAd failed', { ad_id: adId, error: error.message });
    return false;
  }
}

async function getAdmobAdsWithCountry(db = {}, log) {
  const started = Date.now();
  const sql = db?.sql;
  const elastic = db?.elastic;

  if (!sql) {
    return {
      code: 503,
      message: 'The AdMob MySQL connection is unavailable.',
      data: [],
      exe_time: (Date.now() - started) / 1000,
    };
  }

  if (!elastic) {
    return {
      code: 503,
      message: 'The AdMob Elasticsearch connection is unavailable.',
      data: [],
      exe_time: (Date.now() - started) / 1000,
    };
  }

  try {
    const rows = await repo.getAdsForLander(sql, 0, 50);
    if (!rows.length) {
      return {
        code: 200,
        message: 'No Ads found',
        data: [],
        exe_time: (Date.now() - started) / 1000,
      };
    }

    const result = [];
    for (const row of rows) {
      const found = await searchAd(elastic, row.ad_id, log);
      await sql.query('UPDATE mob_ads SET redirect_status = ? WHERE id = ?', [found ? 2 : 5, row.id]);

      if (!found) continue;

      result.push({
        id: row.id,
        ad_id: row.ad_id,
        destination_url: row.destination_url,
        country: String(row.country || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      });
    }

    return {
      code: 200,
      message: result.length ? 'Ads fetched successfully' : 'Ads not found in Elasticsearch',
      data: result,
      exe_time: (Date.now() - started) / 1000,
    };
  } catch (error) {
    log?.error?.('admob.landers.getAds failed', { error: error.message });
    return {
      code: 500,
      message: 'No Ads found',
      data: [],
      exe_time: (Date.now() - started) / 1000,
    };
  }
}

module.exports = { getAdmobAdsWithCountry, searchAd };
