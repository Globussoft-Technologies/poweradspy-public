'use strict';

/**
 * Facebook landers — getAdwithCountryCode.
 *
 * Faithful port of BlackHatController@getAdwithCountryCode (api app).
 *
 * Flow:
 *   1. Fetch up to 50 ads at redirect_status = 0 (PENDING), with their users' countries.
 *      PENDING has priority: only when the pending queue is fully drained (0 rows) does
 *      it fall back to redirect_status = 2 (IN_PROCESSING) — ads already claimed by a
 *      worker that crashed/never finished — so those get re-served instead of stranded,
 *      but never ahead of brand-new pending ones.
 *   2. Check every ad in Elasticsearch (search_mix, term on facebook_ad.id), in parallel:
 *        - present → set redirect_status = 2 (IN_PROCESSING), resolve ISO country codes, emit the ad.
 *        - absent  → set redirect_status = 5 (NOT_FOUND).
 *   3. Return { code, message, data, exe_time } — same shape as the PHP JSON.
 *
 * Status updates and country/ISO lookups are batched (one IN (...) query each) rather than
 * issued per ad/per user, so the whole batch costs a handful of round trips.
 */

const { searchIdQuery } = require('../insertion/esDocBuilder');
const repo = require('./repository');

// redirect_status values (facebook_ad_meta_data):
//   0     = PENDING        — not claimed yet
//   2     = IN_PROCESSING  — claimed (present in ES), handed off to a worker
//   3, 4  = FOUND          — worker finished (set elsewhere, e.g. insertHtmlRedirectCountry)
//   5     = NOT_FOUND      — absent from ES, dead-ended
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

async function getAdwithCountryCode(db, log) {
  const started = Date.now();
  const sql = db?.sql;
  const elastic = db?.elastic;
  const ES_INDEX = elastic?.indexName || 'search_mix';

  try {
    if (!sql || !elastic) {
      return { code: 401, message: 'No Ads found', data: [], exe_time: (Date.now() - started) / 1000 };
    }

    // PENDING has priority: only fall back to IN_PROCESSING (ads already claimed, e.g.
    // by a worker that crashed mid-flight) once the pending queue is fully drained —
    // never mix the two in the same batch. IN_PROCESSING ads already served today
    // (updated_at = today) are skipped; they become eligible again tomorrow.
    let ads = await repo.getDataForLander(sql, PENDING);
    if (!ads.length) {
      ads = await repo.getDataForLander(sql, IN_PROCESSING, { excludeServedToday: true });
    }

    if (!ads.length) {
      return { code: 400, message: 'No Ads found', data: [], exe_time: (Date.now() - started) / 1000 };
    }

    // ── 1. ES existence check — all ads in parallel (same per-id term query as before).
    const hitsPerAd = await Promise.all(ads.map((row) =>
      elastic.search(searchIdQuery(ES_INDEX, row.id))
        .then(esHits)
        .catch((e) => {
          log?.error?.('landers.getAds ES search failed', { id: row.id, error: e.message });
          return [];
        })
    ));
    const found = ads.filter((_, i) => hitsPerAd[i].length > 0);
    const missingIds = ads.filter((_, i) => hitsPerAd[i].length === 0).map((r) => r.id);
    const foundIds = found.map((r) => r.id);

    // ── 2. Status updates (bulk) + discoverers for the found ads.
    //   present → IN_PROCESSING + updated_at stamped (served today); absent → NOT_FOUND.
    //   SQL calls are awaited one at a time so a request never holds more than one pool connection.
    await repo.markServedMultiple(sql, foundIds, IN_PROCESSING);
    await repo.updateMetaMultiple(sql, missingIds, { redirect_status: NOT_FOUND });
    const userRows = await repo.getAdUserIdsMultiple(sql, foundIds);

    const usersByAd = new Map();
    for (const u of userRows) {
      const key = String(u.facebook_ad_id);
      if (!usersByAd.has(key)) usersByAd.set(key, []);
      usersByAd.get(key).push(u.user_id);
    }

    // Nicenames needed by ads with no discoverers (ISO derived from the ad's tracked countries).
    const splitCountries = (row) => String(row.country || '').split(',').filter(Boolean);
    const nicenames = [...new Set(
      found.filter((r) => !usersByAd.has(String(r.id))).flatMap(splitCountries)
    )];
    const userIds = [...new Set(userRows.map((u) => u.user_id))];

    // ── 3. Country lookups (bulk, sequential — one connection at a time).
    const userCountryRows = await repo.getUsersCurrentCountryIds(sql, userIds);
    const nicenameIsoRows = await repo.getIsoByNicenamesMultiple(sql, nicenames);
    const userCountry = new Map(userCountryRows.map((r) => [String(r.id), r.current_country_id]));
    // MySQL nicename comparison is case-insensitive, so key by lowercase.
    const isoByNicename = new Map();
    for (const r of nicenameIsoRows) {
      if (r.iso === undefined || r.iso === null) continue;
      const key = String(r.nicename).toLowerCase();
      if (!isoByNicename.has(key)) isoByNicename.set(key, []);
      isoByNicename.get(key).push(r.iso);
    }

    // Has discoverers → the most common current_country_id among them (a missing user
    // counts as null, same as the old per-user lookup; ties keep Object.keys order).
    const topCountryByAd = new Map();
    for (const [adKey, users] of usersByAd) {
      const freq = {};
      for (const uid of users) {
        const c = userCountry.has(String(uid)) ? userCountry.get(String(uid)) : null;
        freq[c] = (freq[c] || 0) + 1;
      }
      topCountryByAd.set(adKey, Object.keys(freq).sort((x, y) => freq[y] - freq[x])[0]);
    }
    const topIds = [...new Set([...topCountryByAd.values()])]
      .filter((c) => Number(c) !== 0 && Number.isFinite(Number(c)));
    const isoByIdRows = await repo.getIsoByIds(sql, topIds);
    const isoById = new Map(isoByIdRows.map((r) => [String(r.id), r.iso]));

    // ── 4. Build the response (same per-ad shape and rules as before).
    const newarr = [];
    for (const row of found) {
      // Never serve an ad without a usable destination_url (defence-in-depth —
      // getDataForLander already excludes these at the SQL level).
      if (!isUsableDestinationUrl(row.destination_url)) continue;

      const adKey = String(row.id);
      let iso;
      if (!usersByAd.has(adKey)) {
        // No discoverers → ISO codes of the ad's own tracked country nicenames.
        const seen = new Set();
        iso = [];
        for (const name of splitCountries(row)) {
          const key = name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          iso.push(...(isoByNicename.get(key) || []));
        }
      } else {
        // Has discoverers → ISO of the top country; '' when that id is 0.
        const top = topCountryByAd.get(adKey);
        if (Number(top) === 0) {
          iso = '';
        } else {
          const isoVal = isoById.get(String(top));
          iso = isoVal !== null && isoVal !== undefined ? [isoVal] : [];
        }
      }

      newarr.push({
        id: row.id,
        ad_url: row.ad_url,
        iso,
        destination_url: row.destination_url,
      });
    }

    return {
      code: 200,
      message: newarr.length ? 'Ads fetched successfully' : 'Ads not found in Elastisearch',
      data: newarr,
      exe_time: (Date.now() - started) / 1000,
    };
  } catch (e) {
    log?.error?.('landers.getAdwithCountryCode failed', { error: e.message });
    return { code: 401, message: 'No Ads found', data: [], exe_time: (Date.now() - started) / 1000 };
  }
}

module.exports = { getAdwithCountryCode };
