'use strict';

/**
 * LinkedIn landers — get-ads-for-blackhat (api_linkedin BlackhatController@getAdsForBlackHat).
 *
 * Same flow as facebook/landers/getAdsService.js:
 *   1. Fetch up to 100 ads at redirect_status = 0 (PENDING) with a usable destination_url.
 *      PENDING has priority: only when the pending queue is fully drained (0 rows) does it
 *      fall back to redirect_status = 2 (IN_PROCESSING) not served today (updated_at < today)
 *      — ads claimed by a worker that crashed/never finished — so those get re-served at most
 *      once a day instead of on every poll.
 *   2. Check every ad in ES (index from config, match on `ad_id`), in parallel:
 *        - present → redirect_status = 2 + updated_at = NOW(), resolve ISO codes, emit the ad.
 *        - absent  → redirect_status = 5 (NOT_FOUND).
 *   3. Return { code, data } — same shape as the PHP JSON ("urls over" when none).
 *
 * Status updates and the ISO lookup are batched (one IN (...) query each), awaited one at a
 * time so a request holds at most one MySQL connection. Each ad gets ONLY its own ISO codes.
 */

const repo = require('./repository');
const { esHits } = require('./transforms');

const PENDING = 0;
const IN_PROCESSING = 2;
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

// [{ nicename, iso }] → Map(lowercased nicename → [iso, ...]). MySQL's nicename comparison is
// case-insensitive, so lookups are keyed by lowercase.
function buildIsoByNicename(rows) {
  const map = new Map();
  for (const r of rows) {
    if (r.iso === undefined || r.iso === null) continue;
    const key = String(r.nicename).toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r.iso);
  }
  return map;
}

// ISO codes for one ad's country names (each distinct name counted once, like SQL IN (...)).
function isosFor(names, isoByNicename) {
  const seen = new Set();
  const out = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(...(isoByNicename.get(key) || []));
  }
  return out;
}

async function getLinkedinAdsWithCountry(db, log) {
  const started = Date.now();
  const sql = db?.sql;
  const elastic = db?.elastic;
  const ES_INDEX = elastic?.indexName;

  try {
    if (!sql || !elastic) {
      return { code: 401, message: 'No Ads found', data: [], exe_time: (Date.now() - started) / 1000 };
    }

    // PENDING first; IN_PROCESSING (not served today) only once PENDING is drained.
    let ads = await repo.getDataForLander(sql, PENDING);
    if (!ads.length) {
      ads = await repo.getDataForLander(sql, IN_PROCESSING, { excludeServedToday: true });
    }
    // Never serve an ad without a usable destination_url (defence-in-depth —
    // getDataForLander already excludes these at the SQL level).
    ads = ads.filter((row) => isUsableDestinationUrl(row.destination_url));
    if (!ads.length) {
      return { code: 200, message: 'urls over', data: [], exe_time: (Date.now() - started) / 1000 };
    }

    // ── 1. ES existence check — all ads in parallel.
    const hitsPerAd = await Promise.all(ads.map((row) =>
      elastic.search({
        index: ES_INDEX,
        type: 'doc',
        body: { query: { match: { ad_id: row.id } } },
      })
        .then(esHits)
        .catch((e) => {
          log?.error?.('landers.getLinkedinAds ES search failed', { id: row.id, error: e.message });
          return [];
        })
    ));
    const found = ads.filter((_, i) => hitsPerAd[i].length > 0);
    const missingIds = ads.filter((_, i) => hitsPerAd[i].length === 0).map((r) => r.id);

    // ── 2. Bulk status writes + one ISO lookup (SQL awaited one at a time).
    //   present → IN_PROCESSING + updated_at stamped (served today); absent → NOT_FOUND.
    await repo.markServedMultiple(sql, found.map((r) => r.id), IN_PROCESSING);
    await repo.updateMetaMultiple(sql, missingIds, { redirect_status: NOT_FOUND });

    const splitCountries = (row) => String(row.country || '').split(',').map((s) => s.trim()).filter(Boolean);
    const nicenames = [...new Set(found.flatMap(splitCountries))];
    const isoByNicename = buildIsoByNicename(await repo.getIsoByNicenamesMultiple(sql, nicenames));

    // ── 3. Build the response — each ad gets ONLY its own resolved ISO codes.
    const newarr = found.map((row) => ({
      id: row.id,
      iso: isosFor(splitCountries(row), isoByNicename),
      destination_url: row.destination_url,
      ad_url: row.ad_url,
    }));

    return { code: 200, data: newarr, exe_time: (Date.now() - started) / 1000 };
  } catch (e) {
    log?.error?.('landers.getLinkedinAdsWithCountry failed', { error: e.message });
    return { code: 401, message: 'No Ads found', data: [], exe_time: (Date.now() - started) / 1000 };
  }
}

module.exports = { getLinkedinAdsWithCountry };
