const NativeAdMetaData = require('../models/NativeAdMetaData');
const NativeCountryData = require('../models/NativeCountryData');
const databaseManager = require('../../../../database/DatabaseManager');

// Helper to search ad in Elasticsearch
// A destination_url is usable only if it is a non-empty string that is not the
// literal token "null"/"undefined" (some upstream writes store those as text
// rather than a real SQL NULL). Mirrors the SQL filter in NativeAdMetaData.getAdsByStatus.
function isUsableDestinationUrl(value) {
  if (value == null) return false;
  const trimmed = String(value).trim();
  if (trimmed === '') return false;
  return !['null', 'undefined'].includes(trimmed.toLowerCase());
}

// redirect_status values (native_ad_meta_data):
//   0 = PENDING       — not claimed yet
//   2 = IN_PROCESSING — claimed (present in ES), handed off to a worker
//   5 = NOT_FOUND     — absent from ES, dead-ended
const PENDING = 0;
const IN_PROCESSING = 2;
const NOT_FOUND = 5;

// Ad presence in ES (index from config). An ES error counts as "absent".
async function searchAd(esWrapper, adId) {
  try {
    const result = await esWrapper.search({
      index: esWrapper.indexName,
      body: {
        query: {
          match: {
            'native_ad.id': adId,
          },
        },
        size: 1,
      },
    });

    const hits = result?.hits?.hits || result?.body?.hits?.hits || [];
    return hits.length > 0;
  } catch (error) {
    console.error(`Elasticsearch search error for ad ${adId}:`, error.message);
    return false;
  }
}

class GetNativeAdsService {
  /**
   * Same flow as facebook/landers/getAdsService.js:
   *   1. Fetch up to 100 ads at redirect_status = 0 (PENDING). Only when the pending queue is
   *      fully drained (0 rows) fall back to redirect_status = 2 (IN_PROCESSING) not served
   *      today (updated_date < today) — ads claimed by a worker that crashed/never finished —
   *      so those get re-served at most once a day instead of on every poll.
   *   2. Check every ad in ES (index from config, match on `native_ad.id`), in parallel:
   *        - present → redirect_status = 2 + updated_date = NOW(), resolve ISO codes, emit the ad.
   *        - absent  → redirect_status = 5 (NOT_FOUND), NOT returned.
   *   3. Return the list of ads (the controller wraps it in { code, message, data, exe_time }).
   */
  static async fetchAdsForScraping(db) {
    try {
      const esWrapper = db?.elastic || databaseManager.getElastic('native');
      if (!esWrapper) {
        console.error('fetchAdsForScraping: native Elasticsearch connection is unavailable');
        return [];
      }

      // PENDING first; IN_PROCESSING (not served today) only once PENDING is drained.
      let ads = await NativeAdMetaData.getAdsByStatus(PENDING);
      if (ads.length === 0) {
        ads = await NativeAdMetaData.getAdsByStatus(IN_PROCESSING, { excludeServedToday: true });
      }
      // Never serve an ad without a usable destination_url (defence-in-depth —
      // getAdsByStatus already excludes these at the SQL level).
      ads = ads.filter((ad) => isUsableDestinationUrl(ad.destination_url));

      if (ads.length === 0) {
        return [];
      }

      // ── 1. ES existence check — all ads in parallel.
      const esPresence = await Promise.all(ads.map((ad) => searchAd(esWrapper, ad.id)));
      const found = ads.filter((_, i) => esPresence[i]);
      const missingIds = ads.filter((_, i) => !esPresence[i]).map((ad) => ad.id);

      // ── 2. Bulk status writes + one ISO lookup (awaited one at a time).
      //   present → IN_PROCESSING + updated_date stamped (served today); absent → NOT_FOUND.
      await NativeAdMetaData.markServedMultiple(found.map((ad) => ad.id), IN_PROCESSING);
      await NativeAdMetaData.updateRedirectStatusMultiple(missingIds, NOT_FOUND);

      const splitCountries = (ad) => String(ad.countries || '').split(',').map((c) => c.trim()).filter(Boolean);
      const nicenames = [...new Set(found.flatMap(splitCountries))];
      const isoRows = await NativeCountryData.getIsoByNicenamesMultiple(nicenames);
      const isoByNicename = new Map();
      for (const r of isoRows) {
        if (r.iso === undefined || r.iso === null) continue;
        const key = String(r.nicename).toLowerCase();
        if (!isoByNicename.has(key)) isoByNicename.set(key, []);
        isoByNicename.get(key).push(r.iso);
      }

      // ── 3. Build the result — only ads present in ES, each with ONLY its own ISO codes.
      return found.map((ad) => {
        const seen = new Set();
        const iso = [];
        for (const name of splitCountries(ad)) {
          const key = name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          iso.push(...(isoByNicename.get(key) || []));
        }
        return {
          id: ad.id,
          destination_url: ad.destination_url,
          iso,
          country: ad.countries,
        };
      });
    } catch (error) {
      console.error('Error in fetchAdsForScraping:', error);
      throw error;
    }
  }

  // Helper: Get ISO codes for multiple countries in one batch
  static async getCountriesIsoCodesBatch(countryNames) {
    const map = new Map();

    if (countryNames.length === 0) {
      return map;
    }

    try {
      const isoCodes = await NativeCountryData.getIsoByMultipleCountries(countryNames);
      // Map back: we need to match country name to ISO
      const countryToIso = await NativeCountryData.batchGetIso(countryNames);
      return countryToIso;
    } catch (error) {
      console.error('Error in batch ISO lookup:', error.message);
      // Fallback: return country names as ISO codes
      countryNames.forEach(c => map.set(c, c));
      return map;
    }
  }

  // Helper: Map country names to ISO codes using lookup map
  static mapCountriesToIso(countriesString, countryToIsoMap) {
    if (!countriesString) {
      return [];
    }

    const isoCodes = countriesString
      .split(',')
      .map(c => c.trim())
      .filter(c => c)
      .map(c => countryToIsoMap.get(c) || c);

    return isoCodes;
  }

  /**
   * Convert country names to ISO codes
   * @param {string} countriesString - Comma-separated country names
   * @returns {Array} ISO codes or country names as fallback
   */
  static async getCountryIsoCodes(countriesString) {
    if (!countriesString) {
      return [];
    }

    try {
      // Parse comma-separated countries
      const countryNames = countriesString
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c);

      if (countryNames.length === 0) {
        return [];
      }

      // Get ISO codes
      const isoCodes = await NativeCountryData.getIsoByMultipleCountries(countryNames);
      return isoCodes;
    } catch (error) {
      // If native_country_data table doesn't exist, use country names as fallback
      if (error.code === 'ER_NO_SUCH_TABLE') {
        return countriesString
          .split(',')
          .map((c) => c.trim())
          .filter((c) => c);
      }
      console.error('Error getting ISO codes:', error.message);
      return [];
    }
  }

  /**
   * Format response
   */
  static formatResponse(data) {
    return {
      code: 200,
      message: 'Ads fetched successfully',
      data,
      exe_time: 0,
    };
  }
}

module.exports = GetNativeAdsService;
