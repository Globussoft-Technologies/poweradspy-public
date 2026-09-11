'use strict';

/**
 * LinkedIn landers — get-ads-for-blackhat (api_linkedin BlackhatController@getAdsForBlackHat).
 * Same shape as youtube/landers/getAdsService.js.
 *
 * Flow (faithful to the PHP):
 *   1. Fetch up to 100 ads at redirect_status = 0 with a non-null destination_url.
 *   2. For each ad, check ES `linkedin_ads_data` (match on `ad_id`):
 *        - present → resolve ISO codes (country_data.nicename -> iso) and emit the ad.
 *        - absent  → set redirect_status = 5.
 *   3. Return { code, data } — same shape as the PHP JSON ("urls over" when none).
 *
 * ISO accumulator `a` is shared across ads to mirror the legacy PHP.
 */

const repo = require('./repository');
const { esHits } = require('./transforms');

const PENDING = 0;
const NOT_FOUND = 5;

// A destination_url is usable only if it is a non-empty string that is not the
// literal token "null"/"undefined" (some upstream writes store those as text
// rather than a real SQL NULL). Mirrors the SQL filter in getDataForLander.
function isUsableDestinationUrl(value) {
  if (value == null) return false;
  const trimmed = String(value).trim();
  if (trimmed === '') return false;
  return !['null', 'undefined'].includes(trimmed.toLowerCase());
}

async function getLinkedinAdsWithCountry(db, log) {
  const started = Date.now();
  const sql = db?.sql;
  const elastic = db?.elastic;
  const ES_INDEX = elastic?.indexName || 'linkedin_ads_data';

  try {
    if (!sql || !elastic) {
      return { code: 401, message: 'No Ads found', data: [], exe_time: (Date.now() - started) / 1000 };
    }

    const ads = await repo.getDataForLander(sql, PENDING);
    if (!ads.length) {
      return { code: 200, message: 'urls over', data: [], exe_time: (Date.now() - started) / 1000 };
    }

    const newarr = [];

    for (const row of ads) {
      // Never serve an ad without a usable destination_url (defence-in-depth —
      // getDataForLander already excludes these at the SQL level).
      if (!isUsableDestinationUrl(row.destination_url)) continue;

      let hits = [];
      try {
        hits = esHits(await elastic.search({
          index: ES_INDEX,
          type: 'doc',
          body: { query: { match: { ad_id: row.id } } },
        }));
      } catch (e) {
        log?.error?.('landers.getLinkedinAds ES search failed', { id: row.id, error: e.message });
        hits = [];
      }

      if (hits.length) {
        // Each ad gets ONLY its own resolved ISO codes (no cross-ad accumulator — the
        // legacy shared-accumulator inflated every ad's `iso` with earlier ads' countries).
        const names = String(row.country || '').split(',').filter(Boolean);
        const isos = await repo.getIsoByNicenames(sql, names);
        newarr.push({
          id: row.id,
          iso: isos,
          destination_url: row.destination_url,
          ad_url: row.ad_url,
        });
      } else {
        await repo.updateMeta(sql, row.id, { redirect_status: NOT_FOUND });
      }
    }

    return { code: 200, data: newarr, exe_time: (Date.now() - started) / 1000 };
  } catch (e) {
    log?.error?.('landers.getLinkedinAdsWithCountry failed', { error: e.message });
    return { code: 401, message: 'No Ads found', data: [], exe_time: (Date.now() - started) / 1000 };
  }
}

module.exports = { getLinkedinAdsWithCountry };
