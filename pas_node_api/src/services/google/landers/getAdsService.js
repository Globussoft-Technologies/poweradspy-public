'use strict';

/**
 * Google landers — get_ads_for_blackhat (BlackhatController@getGoogleAdsWithCounrty).
 *
 * Flow (faithful to the PHP):
 *   1. Fetch up to 50 ads at redirect_status = 0 (with their tracked country names).
 *   2. Bulk-set redirect_status = 2 for ALL fetched ids — note: unlike facebook the
 *      gtext version does NOT set status 5 for ads missing from ES; it just omits them.
 *   3. Resolve ISO codes for the whole batch in one query (country_data.nicename → iso),
 *      then check ES `google_ads_data_v2` (match on flat `id`) for every ad in parallel.
 *      If present, emit the ad.
 *   4. Return { code, message, data, exe_time }.
 *
 * SQL calls are awaited one at a time so a request holds at most one MySQL connection.
 */

const repo = require('./repository');

const PENDING = 0;
const FOUND = 2;

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

async function getGoogleAdsWithCountry(db, log) {
  const started = Date.now();
  const sql = db?.sql;
  const elastic = db?.elastic;
  const ES_INDEX = elastic?.indexName || 'google_ads_data_v2';

  try {
    if (!sql || !elastic) {
      return { code: 401, message: 'No Ads found', data: [], exe_time: (Date.now() - started) / 1000 };
    }

    // PENDING has priority: only once that queue is fully drained (0 rows) does this fall
    // back to FOUND (2 = in processing — claimed by a worker that crashed/never finished) so
    // those get re-served instead of stranded, but never ahead of brand-new pending ads.
    // Status-2 ads already served today (updated_date = today) are skipped until tomorrow.
    let fetched = await repo.getDataForLander(sql, PENDING);
    if (!fetched.length) {
      fetched = await repo.getDataForLander(sql, FOUND, { excludeServedToday: true });
    }
    // Never lease an ad without a usable destination_url (defence-in-depth —
    // getDataForLander already excludes these at the SQL level).
    const ads = fetched.filter((a) => isUsableDestinationUrl(a.destination_url));
    if (!ads.length) {
      return { code: 400, message: 'No Ads found', data: [], exe_time: (Date.now() - started) / 1000 };
    }

    // Bulk flip to in-progress (status 2) for all fetched ids and stamp updated_date (served today).
    await repo.markServedMultiple(sql, ads.map((a) => a.id), FOUND);

    // One ISO lookup for the whole batch (SQL awaited one at a time — at most one connection).
    const splitCountries = (row) => String(row.country || '').split(',').filter(Boolean);
    const nicenames = [...new Set(ads.flatMap(splitCountries))];
    const isoByNicename = buildIsoByNicename(await repo.getIsoByNicenamesMultiple(sql, nicenames));

    // ES existence check — all ads in parallel (same per-id match query as before).
    const hitsPerAd = await Promise.all(ads.map((row) =>
      elastic.search({
        index: ES_INDEX,
        type: 'doc',
        body: { query: { match: { id: row.id } } },
      })
        .then(esHits)
        .catch((e) => {
          log?.error?.('landers.getGoogleAds ES search failed', { id: row.id, error: e.message });
          return [];
        })
    ));

    // Each ad gets ONLY its own resolved ISO codes (no cross-ad accumulator — the
    // legacy shared-accumulator inflated every ad's `iso` with earlier ads' countries).
    const newarr = ads
      .filter((_, i) => hitsPerAd[i].length > 0)
      .map((row) => ({
        id: row.id,
        iso: isosFor(splitCountries(row), isoByNicename),
        destination_url: row.destination_url,
      }));

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
