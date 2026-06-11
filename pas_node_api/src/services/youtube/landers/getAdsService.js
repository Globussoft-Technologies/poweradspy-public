'use strict';

/**
 * YouTube landers — get_youtubeid_for_lander (BlackhatControllerYoutube@getYoutubeAdsWithCounrty).
 *
 * Flow (faithful to the PHP):
 *   1. Fetch up to 100 ads at redirect_status = 0 with a non-null destination_url.
 *   2. For each ad, check ES `youtube_ads_data` (match on `ad_id`):
 *        - present → resolve ISO codes (country_data.nicename → iso) and emit the ad
 *          (NOTE: youtube does NOT flip redirect_status to 2 here — only to 5 when missing).
 *        - absent  → set redirect_status = 5.
 *   3. Return { code, data } — same shape as the PHP JSON ("urls over" when none).
 *
 * ISO accumulator `a` is shared across ads to mirror the legacy PHP.
 */

const repo = require('./repository');
const { esHits } = require('./transforms');

const PENDING = 0;
const NOT_FOUND = 5;

async function getYoutubeAdsWithCountry(db, log) {
  const started = Date.now();
  const sql = db?.sql;
  const elastic = db?.elastic;
  const ES_INDEX = elastic?.indexName || 'youtube_ads_data';

  try {
    if (!sql || !elastic) {
      return { code: 401, message: 'No Ads found', data: [], exe_time: (Date.now() - started) / 1000 };
    }

    const ads = await repo.getDataForLander(sql, PENDING);
    if (!ads.length) {
      return { code: 200, message: 'urls over', data: [], exe_time: (Date.now() - started) / 1000 };
    }

    const newarr = [];
    const a = []; // ISO accumulator — shared across ads (matches legacy PHP)

    for (const row of ads) {
      let hits = [];
      try {
        hits = esHits(await elastic.search({
          index: ES_INDEX,
          type: 'doc',
          body: { query: { match: { ad_id: row.id } } },
        }));
      } catch (e) {
        log?.error?.('landers.getYoutubeAds ES search failed', { id: row.id, error: e.message });
        hits = [];
      }

      if (hits.length) {
        const names = String(row.country || '').split(',').filter(Boolean);
        const isos = await repo.getIsoByNicenames(sql, names);
        for (const v of isos) {
          if (!a.includes(v)) a.push(v);
        }
        newarr.push({
          id: row.id,
          iso: [...a],
          destination_url: row.destination_url,
          ad_url: row.ad_url,
        });
      } else {
        // Not in ES → mark failed.
        await repo.updateMeta(sql, row.id, { redirect_status: NOT_FOUND });
      }
    }

    return { code: 200, data: newarr, exe_time: (Date.now() - started) / 1000 };
  } catch (e) {
    log?.error?.('landers.getYoutubeAdsWithCountry failed', { error: e.message });
    return { code: 401, message: 'No Ads found', data: [], exe_time: (Date.now() - started) / 1000 };
  }
}

module.exports = { getYoutubeAdsWithCountry };
