'use strict';

/**
 * ChatGPT Ads landers — getAdwithCountryCode.
 *
 * Mirrors facebook/landers/getAdsService.js.
 *
 * Flow:
 *   1. Fetch up to 50 ads at lander_status = 0 (PENDING), with their tracked country names.
 *      PENDING has priority: only when the pending queue is fully drained (0 rows) does
 *      it fall back to lander_status = 2 (IN_PROCESSING) — ads already claimed by a
 *      worker that crashed/never finished — so those get re-served instead of stranded,
 *      but never ahead of brand-new pending ones.
 *   2. Check every ad in Elasticsearch (index from config, term on `id`), in parallel:
 *        - present → set lander_status = 2 (IN_PROCESSING), resolve ISO country codes, emit the ad.
 *        - absent  → set lander_status = 5 (NOT_FOUND).
 *   3. Return { code, message, data, exe_time } — same shape as facebook.
 *
 * Unlike facebook there are no discoverers (facebook_ad_users) for this network, so `iso`
 * is always derived from the ad's own tracked country names, via the static name → ISO map
 * shared with tiktok (tiktok/helpers/countries.js) — no country_data table needed in this
 * network's DB. Matching is case-insensitive; a name missing from the map is skipped.
 */

const { searchIdQuery } = require('../insertion/esDocBuilder');
const { COUNTRY_LABEL_TO_ISO } = require('../../tiktok/helpers/countries');
const repo = require('./repository');

// Lower-cased name → ISO, built once.
const ISO_BY_NAME = new Map(Object.entries(COUNTRY_LABEL_TO_ISO).map(([name, iso]) => [name.toLowerCase(), iso]));

// lander_status values (chatgptads_ad):
//   0 = PENDING        — not claimed yet
//   2 = IN_PROCESSING  — claimed (present in ES), handed off to a worker
//   4 = SUCCESS        — worker stored the lander (set by insertHtmlRedirectCountry)
//   5 = NOT_FOUND      — absent from ES, or no lander captured
const PENDING = 0;
const IN_PROCESSING = 2;
const NOT_FOUND = 5;

function esHits(res) {
  return res?.hits?.hits || res?.body?.hits?.hits || [];
}

// A destination_url is usable only if it is a non-empty string that is not the
// literal token "null"/"undefined". Mirrors the SQL filter in getDataForLander.
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
  const ES_INDEX = elastic?.indexName || 'chatgpt_search_mix';

  try {
    if (!sql || !elastic) {
      return { code: 401, message: 'No Ads found', data: [], exe_time: (Date.now() - started) / 1000 };
    }

    // PENDING first; IN_PROCESSING (not served today) only once PENDING is drained.
    let ads = await repo.getDataForLander(sql, PENDING);
    if (!ads.length) {
      ads = await repo.getDataForLander(sql, IN_PROCESSING, { excludeServedToday: true });
    }

    if (!ads.length) {
      return { code: 400, message: 'No Ads found', data: [], exe_time: (Date.now() - started) / 1000 };
    }

    // ── 1. ES existence check — all ads in parallel.
    const hitsPerAd = await Promise.all(ads.map((row) =>
      elastic.search(searchIdQuery(ES_INDEX, row.id))
        .then(esHits)
        .catch((e) => {
          log?.error?.('chatgptads.landers.getAds ES search failed', { id: row.id, error: e.message });
          return [];
        })
    ));
    const found = ads.filter((_, i) => hitsPerAd[i].length > 0);
    const missingIds = ads.filter((_, i) => hitsPerAd[i].length === 0).map((r) => r.id);
    const foundIds = found.map((r) => r.id);

    // ── 2. Status updates (bulk). present → IN_PROCESSING + updated_at stamped; absent → NOT_FOUND.
    await repo.markServedMultiple(sql, foundIds, IN_PROCESSING);
    await repo.updateLanderStatusMultiple(sql, missingIds, NOT_FOUND);

    // ── 3. Build the response; country name → ISO via the static map (no DB lookup).
    const splitCountries = (row) => String(row.country || '').split(',').map((s) => s.trim()).filter(Boolean);
    const newarr = [];
    for (const row of found) {
      if (!isUsableDestinationUrl(row.destination_url)) continue;

      const iso = [];
      for (const name of splitCountries(row)) {
        const code = ISO_BY_NAME.get(name.toLowerCase());
        if (code && !iso.includes(code)) iso.push(code);
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
    log?.error?.('chatgptads.landers.getAdwithCountryCode failed', { error: e.message });
    return { code: 401, message: 'No Ads found', data: [], exe_time: (Date.now() - started) / 1000 };
  }
}

module.exports = { getAdwithCountryCode };
