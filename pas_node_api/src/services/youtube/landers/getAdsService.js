'use strict';

/**
 * YouTube landers — get_youtubeid_for_lander (BlackhatControllerYoutube@getYoutubeAdsWithCounrty).
 *
 * Flow (faithful to the PHP):
 *   1. Fetch up to 50 ads at redirect_status = 0 with a non-null destination_url.
 *      (falls back to redirect_status = 2 not served today when none are pending).
 *   2. Check every ad in ES `youtube_ads_data` (match on `ad_id`), in parallel:
 *        - present → redirect_status = 2 + updated_date, resolve ISO codes, emit the ad.
 *        - absent  → set redirect_status = 5.
 *   3. Return { code, data } — same shape as the PHP JSON ("urls over" when none).
 *
 * Status updates and the ISO lookup are batched (one IN (...) query each), awaited one
 * at a time so a request holds at most one MySQL connection.
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

async function getYoutubeAdsWithCountry(db, log) {
  const started = Date.now();
  const sql = db?.sql;
  const elastic = db?.elastic;
  const ES_INDEX = elastic?.indexName || 'youtube_ads_data';

  try {
    if (!sql || !elastic) {
      return { code: 401, message: 'No Ads found', data: [], exe_time: (Date.now() - started) / 1000 };
    }

    // PENDING has priority; only once it is fully drained fall back to IN_PROCESSING (ads
    // claimed by a worker that crashed/never finished) so they get re-served, not stranded.
    // IN_PROCESSING ads already served today (updated_date = today) are skipped until tomorrow.
    let ads = await repo.getDataForLander(sql, PENDING);
    if (!ads.length) {
      ads = await repo.getDataForLander(sql, IN_PROCESSING, { excludeServedToday: true });
    }
    if (!ads.length) {
      return { code: 200, message: 'urls over', data: [], exe_time: (Date.now() - started) / 1000 };
    }

    // Never serve an ad without a usable destination_url (defence-in-depth —
    // getDataForLander already excludes these at the SQL level).
    const usable = ads.filter((row) => isUsableDestinationUrl(row.destination_url));

    // ── 1. ES existence check — all ads in parallel (same per-id match query as before).
    const hitsPerAd = await Promise.all(usable.map((row) =>
      elastic.search({
        index: ES_INDEX,
        type: 'doc',
        body: { query: { match: { ad_id: row.id } } },
      })
        .then(esHits)
        .catch((e) => {
          log?.error?.('landers.getYoutubeAds ES search failed', { id: row.id, error: e.message });
          return [];
        })
    ));
    const found = usable.filter((_, i) => hitsPerAd[i].length > 0);
    const missingIds = usable.filter((_, i) => hitsPerAd[i].length === 0).map((r) => r.id);

    // ── 2. Bulk status writes + one ISO lookup. SQL calls are awaited one at a time so a
    //   request never holds more than one pool connection.
    //   present → claimed (0 → 2) + updated_date stamped, so the 2-fallback re-serves it at most
    //   once per day and only if a worker never reports back; absent → NOT_FOUND.
    await repo.markServedMultiple(sql, found.map((r) => r.id), IN_PROCESSING);
    await repo.updateMetaMultiple(sql, missingIds, { redirect_status: NOT_FOUND });

    const splitCountries = (row) => String(row.country || '').split(',').filter(Boolean);
    const nicenames = [...new Set(found.flatMap(splitCountries))];
    const isoByNicename = buildIsoByNicename(await repo.getIsoByNicenamesMultiple(sql, nicenames));

    // ── 3. Build the response. Each ad gets ONLY its own resolved ISO codes (no cross-ad
    //   accumulator — the legacy shared-accumulator inflated every ad's `iso`).
    const newarr = found.map((row) => ({
      id: row.id,
      iso: isosFor(splitCountries(row), isoByNicename),
      destination_url: row.destination_url,
      ad_url: row.ad_url,
    }));

    return { code: 200, data: newarr, exe_time: (Date.now() - started) / 1000 };
  } catch (e) {
    log?.error?.('landers.getYoutubeAdsWithCountry failed', { error: e.message });
    return { code: 401, message: 'No Ads found', data: [], exe_time: (Date.now() - started) / 1000 };
  }
}

module.exports = { getYoutubeAdsWithCountry };
