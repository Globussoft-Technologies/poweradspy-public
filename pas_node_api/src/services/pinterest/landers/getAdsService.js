'use strict';

const repo = require('./repository');

/**
 * getAdsForBlackhat — fetches Pinterest ads with redirect_status=0,
 * validates presence in ES (pinterest_search_mix), transitions status to 2,
 * and returns ads with ISO country codes.
 *
 * Mirrors PHP: BlackhatController@getPinterestAdsWithCounrty
 */
async function getAdsForBlackhat(db, log) {
  const startTime = Date.now();
  try {
    // Fetch ads with redirect_status = 0
    const ads = await repo.getDataForLander(0);

    log?.info(`[pinterest-landers] Fetched ${ads.length} ads for blackhat`);

    if (!ads || ads.length === 0) {
      return {
        code: 400,
        message: 'No Ads found',
        data: [],
        exe_time: (Date.now() - startTime) / 1000
      };
    }

    const response = [];
    let isoAccumulator = [];

    for (const ad of ads) {
      // Check if ad exists in Elasticsearch
      let esFound = false;
      try {
        const esResult = await db.elastic.search({
          index: 'pinterest_search_mix',
          body: {
            query: { match: { 'pinterest_ad.id': ad.id } },
            size: 1
          }
        });
        const hits = esResult?.body?.hits?.hits || esResult?.hits?.hits || [];
        esFound = hits.length > 0;
      } catch (err) {
        log?.warn(`[pinterest-landers] ES search failed for ad ${ad.id}: ${err.message}`);
        esFound = false;
      }

      if (esFound) {
        // Update redirect_status to 2 (processing)
        await repo.updateStatusByIds([ad.id], { redirect_status: 2 });

        const countries = ad.country ? ad.country.replace(/\r\n/g, '').split(',').map(c => c.trim()).filter(Boolean) : [];
        if (!countries.length) {
          log?.warn(`[pinterest-landers] No countries for ad ${ad.id}`);
          continue;
        }

        // Get ISO codes for each country
        const isoRows = await repo.getCountriesForAd(countries.join(','));

        if (isoRows && isoRows.length > 0) {
          const a = [];
          const countryNames = [];
          for (const row of isoRows) {
            if (!isoAccumulator.includes(row.iso)) {
              isoAccumulator.push(row.iso);
            }
            a.push(row.iso);
          }

          // Get country names for the ISO codes
          const countryMappings = await repo.getCountryNamesByIso(a);
          const nameMap = {};
          if (countryMappings && countryMappings.length > 0) {
            countryMappings.forEach(c => {
              nameMap[c.iso] = c.nicename;
            });
          }

          response.push({
            id: ad.id,
            iso: a,
            country_names: a.map(iso => nameMap[iso] || iso),
            destination_url: ad.destination_url
          });
        }
      }
    }

    if (response.length === 0) {
      return {
        code: 400,
        message: 'No Ads found',
        data: [],
        exe_time: (Date.now() - startTime) / 1000
      };
    }

    return {
      code: 200,
      message: 'Ads fetched successfully',
      data: response,
      exe_time: (Date.now() - startTime) / 1000
    };
  } catch (err) {
    log?.error(`[pinterest-landers] Error in getAdsForBlackhat: ${err.message}`);
    return {
      code: 401,
      message: 'No Ads found',
      exe_time: (Date.now() - startTime) / 1000
    };
  }
}

module.exports = {
  getAdsForBlackhat
};
