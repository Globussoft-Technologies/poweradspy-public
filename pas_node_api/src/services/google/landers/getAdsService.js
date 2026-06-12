'use strict';

/**
 * Google landers — get_ads_for_blackhat (BlackhatController@getGoogleAdsWithCounrty).
 *
 * Flow (faithful to the PHP):
 *   1. Fetch up to 50 ads at redirect_status = 0 (with their tracked country names).
 *   2. Bulk-set redirect_status = 2 for ALL fetched ids — note: unlike facebook the
 *      gtext version does NOT set status 5 for ads missing from ES; it just omits them.
 *   3. For each ad, resolve ISO codes (country_data.nicename → iso), then check ES
 *      `google_ads_data` (match on flat `id`). If present, emit the ad.
 *   4. Return { code, message, data, exe_time }.
 *
 * ISO accumulator `a` is shared across ads to mirror the legacy PHP.
 */

const repo = require('./repository');

const PENDING = 0;
const FOUND = 2;

function esHits(res) {
  return res?.hits?.hits || res?.body?.hits?.hits || [];
}

async function getGoogleAdsWithCountry(db, log) {
  const started = Date.now();
  const sql = db?.sql;
  const elastic = db?.elastic;
  const ES_INDEX = elastic?.indexName || 'google_ads_data';

  try {
    if (!sql || !elastic) {
      return { code: 401, message: 'No Ads found', data: [], exe_time: (Date.now() - started) / 1000 };
    }

    const ads = await repo.getDataForLander(sql, PENDING);
    if (!ads.length) {
      return { code: 400, message: 'No Ads found', data: [], exe_time: (Date.now() - started) / 1000 };
    }

    // Bulk flip to in-progress (status 2) for all fetched ids.
    await repo.updateMetaMultiple(sql, ads.map((a) => a.id), { redirect_status: FOUND });

    const newarr = [];

    for (const row of ads) {
      // Each ad gets ONLY its own resolved ISO codes (no cross-ad accumulator — the
      // legacy shared-accumulator inflated every ad's `iso` with earlier ads' countries).
      const names = String(row.country || '').split(',').filter(Boolean);
      const isos = await repo.getIsoByNicenames(sql, names);

      let hits = [];
      try {
        hits = esHits(await elastic.search({
          index: ES_INDEX,
          type: 'doc',
          body: { query: { match: { id: row.id } } },
        }));
      } catch (e) {
        log?.error?.('landers.getGoogleAds ES search failed', { id: row.id, error: e.message });
        hits = [];
      }

      if (hits.length) {
        newarr.push({ id: row.id, iso: isos, destination_url: row.destination_url });
      }
    }

    return {
      code: 200,
      message: 'Ads fetched successfully',
      data: newarr,
      exe_time: (Date.now() - started) / 1000,
    };
  } catch (e) {
    log?.error?.('landers.getGoogleAdsWithCountry failed', { error: e.message });
    return { code: 401, message: 'No Ads found', data: [], exe_time: (Date.now() - started) / 1000 };
  }
}

module.exports = { getGoogleAdsWithCountry };
