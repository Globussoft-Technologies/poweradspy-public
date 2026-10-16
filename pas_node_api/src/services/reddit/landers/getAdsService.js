'use strict';

const repo = require('./repository');

// redirect_status values (reddit_ad_meta_data):
//   0 = PENDING       — not claimed yet
//   2 = IN_PROCESSING — claimed (present in ES), handed off to a worker
//   5 = NOT_FOUND     — absent from ES, dead-ended
const PENDING = 0;
const IN_PROCESSING = 2;
const NOT_FOUND = 5;

function esHits(res) {
  return res?.hits?.hits || res?.body?.hits?.hits || [];
}

// A destination_url is usable only if it is a non-empty string that is not the
// literal token "null"/"undefined" (some upstream writes store those as text
// rather than a real SQL NULL). Mirrors the SQL filter in getDataForLander.
function isUsableDestinationUrl(value) {
  if (value == null) return false;
  const trimmed = String(value).trim();
  if (trimmed === '') return false;
  return !['null', 'undefined'].includes(trimmed.toLowerCase());
}

const splitCountries = (row) =>
  String(row.country || '').replace(/\r\n/g, '').split(',').map((c) => c.trim()).filter(Boolean);

/**
 * getAdsForBlackhat — same flow as facebook/landers/getAdsService.js.
 *
 *   1. Fetch up to 100 ads at redirect_status = 0 (PENDING). Only when the pending queue is
 *      fully drained (0 rows) fall back to redirect_status = 2 (IN_PROCESSING) not served
 *      today (updated_date < today) — ads claimed by a worker that crashed/never finished —
 *      so those get re-served at most once a day instead of on every poll.
 *   2. Check every ad in ES (index from config, match on `reddit_ad.id`), in parallel:
 *        - present → redirect_status = 2 + updated_date = NOW(), resolve ISO codes, emit the ad.
 *        - absent  → redirect_status = 5 (NOT_FOUND).
 *   3. Return { code, data, exe_time }.
 *
 * Status updates and the ISO lookup are batched (one IN (...) query each). Each ad gets ONLY
 * its own ISO codes.
 *
 * Mirrors PHP: BlackhatController@getRedditAdsWithCounrty
 */
async function getAdsForBlackhat(db, log) {
  const startTime = Date.now();
  const elastic = db?.elastic;
  const ES_INDEX = elastic?.indexName;

  try {
    if (!elastic) {
      return { code: 400, message: 'No more urls found', data: [], exe_time: (Date.now() - startTime) / 1000 };
    }

    // PENDING first; IN_PROCESSING (not served today) only once PENDING is drained.
    let ads = await repo.getDataForLander(PENDING);
    if (!ads.length) {
      ads = await repo.getDataForLander(IN_PROCESSING, { excludeServedToday: true });
    }
    // Never serve an ad without a usable destination_url (defence-in-depth —
    // getDataForLander already excludes these at the SQL level).
    ads = ads.filter((ad) => isUsableDestinationUrl(ad.destination_url));

    log?.info(`[reddit-landers] Fetched ${ads.length} ads for blackhat`);

    if (!ads.length) {
      return { code: 400, message: 'No more urls found', data: [], exe_time: (Date.now() - startTime) / 1000 };
    }

    // ── 1. ES existence check — all ads in parallel.
    const hitsPerAd = await Promise.all(ads.map((ad) =>
      elastic.search({
        index: ES_INDEX,
        body: { query: { match: { 'reddit_ad.id': ad.id } }, size: 1 },
      })
        .then(esHits)
        .catch((err) => {
          log?.warn(`[reddit-landers] ES search failed for ad ${ad.id}: ${err.message}`);
          return [];
        })
    ));
    const found = ads.filter((_, i) => hitsPerAd[i].length > 0);
    const missingIds = ads.filter((_, i) => hitsPerAd[i].length === 0).map((ad) => ad.id);
    if (missingIds.length) {
      log?.warn(`[reddit-landers] ${missingIds.length} ads not found in Elasticsearch: ${missingIds.join(', ')}`);
    }

    // ── 2. Bulk status writes + one ISO lookup (awaited one at a time).
    //   present → IN_PROCESSING + updated_date stamped (served today); absent → NOT_FOUND.
    await repo.markServedMultiple(found.map((ad) => ad.id), IN_PROCESSING);
    await repo.updateStatusByIds(missingIds, { redirect_status: NOT_FOUND });

    const nicenames = [...new Set(found.flatMap(splitCountries))];
    const isoRows = await repo.getIsoByNicenamesMultiple(nicenames);
    const isoByNicename = new Map();
    for (const r of isoRows) {
      if (r.iso === undefined || r.iso === null) continue;
      const key = String(r.nicename).toLowerCase();
      if (!isoByNicename.has(key)) isoByNicename.set(key, []);
      isoByNicename.get(key).push(r.iso);
    }

    // ── 3. Build the response — each ad gets ONLY its own resolved ISO codes.
    const response = found.map((ad) => {
      const countries = splitCountries(ad);
      const seen = new Set();
      const iso = [];
      for (const name of countries) {
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        iso.push(...(isoByNicename.get(key) || []));
      }
      return {
        id: ad.id,
        country: countries,
        iso,
        destination_url: ad.destination_url,
      };
    });

    if (response.length === 0) {
      return { code: 400, message: 'No more urls found', data: [], exe_time: (Date.now() - startTime) / 1000 };
    }

    return {
      code: 200,
      data: response,
      exe_time: (Date.now() - startTime) / 1000,
    };
  } catch (err) {
    log?.error(`[reddit-landers] Error in getAdsForBlackhat: ${err.message}`);
    return {
      code: 400,
      message: `Exception occured in Reddit getRedditAdsWithCounrty function: ${err.message}`,
      exe_time: (Date.now() - startTime) / 1000,
    };
  }
}

module.exports = {
  getAdsForBlackhat,
};
