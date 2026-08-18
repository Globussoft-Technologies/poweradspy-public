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
 *   2. For each ad, check Elasticsearch (search_mix, match on facebook_ad.id):
 *        - present → set redirect_status = 2 (IN_PROCESSING), resolve ISO country codes, emit the ad.
 *        - absent  → set redirect_status = 5 (NOT_FOUND).
 *   3. Return { code, message, data, exe_time } — same shape as the PHP JSON.
 *
 * The ISO accumulator (`a`) is intentionally shared across ads to mirror the legacy
 * PHP, where $a accumulated and each ad's `iso` was a snapshot of it at that point.
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
    // never mix the two in the same batch.
    let ads = await repo.getDataForLander(sql, PENDING);
    if (!ads.length) {
      ads = await repo.getDataForLander(sql, IN_PROCESSING);
    }

    if (!ads.length) {
      return { code: 400, message: 'No Ads found', data: [], exe_time: (Date.now() - started) / 1000 };
    }

    const newarr = [];

    for (const row of ads) {
      const id = row.id;

      let hits = [];
      try {
        hits = esHits(await elastic.search(searchIdQuery(ES_INDEX, id)));
      } catch (e) {
        log?.error?.('landers.getAds ES search failed', { id, error: e.message });
        hits = [];
      }

      if (!hits.length) {
        // Not present in Elasticsearch → mark failed.
        await repo.updateMeta(sql, id, { redirect_status: NOT_FOUND });
        continue;
      }

      // Present → mark in-processing.
      await repo.updateMeta(sql, id, { redirect_status: IN_PROCESSING });

      const country = String(row.country || '').split(',').filter(Boolean);
      const userRows = await repo.getAdUserIds(sql, id);

      let iso = null;
      if (userRows.length === 0) {
        // No discoverers → derive ISO from the ad's tracked country nicenames.
        const isos = await repo.getIsoByNicenames(sql, country);
        iso = isos; // each ad gets ONLY its own resolved ISO codes (no cross-ad accumulator)
      } else {
        // Has discoverers → pick the most common current_country_id, resolve its ISO.
        const countryIds = [];
        for (const u of userRows) {
          countryIds.push(await repo.getUserCurrentCountryId(sql, u.user_id));
        }
        const freq = {};
        for (const c of countryIds) freq[c] = (freq[c] || 0) + 1;
        const topCountryId = Object.keys(freq).sort((x, y) => freq[y] - freq[x])[0];

        iso = null;
        if (Number(topCountryId) !== 0) {
          iso = []; // PHP: $iso = query rows (non-null) when id != 0
          const isoVal = await repo.getIsoById(sql, topCountryId);
          if (isoVal !== null && isoVal !== undefined) {
            iso.push(isoVal);
          }
        }
      }

      const resp = {
        id,
        ad_url: row.ad_url,
        iso: iso !== null ? iso : '',
        destination_url: row.destination_url,
      };

      if (row.destination_url !== null && row.destination_url !== undefined) {
        newarr.push(resp);
      }
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
