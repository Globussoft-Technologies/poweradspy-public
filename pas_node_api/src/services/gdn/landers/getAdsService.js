'use strict';

/**
 * GDN landers — get_ads_for_blackhat (BlackhatController@getGDNAdsWithCounrty).
 *
 * Flow (faithful to the PHP):
 *   1. Fetch up to 50 ads at redirect_status = 0 (with their tracked country names).
 *   2. Bulk-set redirect_status = 2 for ALL fetched ids.
 *   3. For each ad, resolve ISO codes (country_data.nicename → iso) and emit
 *      { id, iso, destination_url }. NOTE: the GDN get-ads does NOT check ES (unlike
 *      youtube/google) — it returns every fetched ad straight from the meta table.
 *   4. Return { code, message, data, exe_time }.
 *
 * ACCUMULATOR FIX: the legacy PHP shared a single `$a` array across all ads, so each
 * ad's `iso` carried every earlier ad's countries (phantom countries). Here each ad
 * gets ONLY its own resolved ISO codes.
 */

const repo = require('./repository');

const PENDING = 0;
const FOUND = 2;

async function getGdnAdsWithCountry(db, log) {
  const started = Date.now();
  const sql = db?.sql;

  try {
    if (!sql) {
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

      newarr.push({ id: row.id, iso: isos, destination_url: row.destination_url });
    }

    return {
      code: 200,
      message: 'Ads fetched successfully',
      data: newarr,
      exe_time: (Date.now() - started) / 1000,
    };
  } catch (e) {
    log?.error?.('landers.getGdnAdsWithCountry failed', { error: e.message, stack: e.stack });
    return { code: 401, message: 'No Ads found', data: [], exe_time: (Date.now() - started) / 1000 };
  }
}

module.exports = { getGdnAdsWithCountry };
