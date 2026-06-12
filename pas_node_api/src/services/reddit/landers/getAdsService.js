'use strict';

const repo = require('./repository');

/**
 * getAdsForBlackhat — fetches Reddit ads with redirect_status=0,
 * validates presence in ES (reddit_search_mix), transitions status to 2,
 * and returns ads with ISO country codes.
 *
 * Mirrors PHP: BlackhatController@getRedditAdsWithCounrty
 */
async function getAdsForBlackhat(db, log) {
  const startTime = Date.now();
  try {
    // Fetch ads with redirect_status = 0
    const ads = await repo.getDataForLander(0);

    log?.info(`[reddit-landers] Fetched ${ads.length} ads for blackhat`);

    if (!ads || ads.length === 0) {
      return {
        code: 400,
        message: 'No more urls found',
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
          index: 'reddit_search_mix',
          body: {
            query: { match: { 'reddit_ad.id': ad.id } },
            size: 1
          }
        });
        const hits = esResult?.body?.hits?.hits || esResult?.hits?.hits || [];
        esFound = hits.length > 0;
      } catch (err) {
        log?.warn(`[reddit-landers] ES search failed for ad ${ad.id}: ${err.message}`);
        esFound = false;
      }

      if (esFound) {
        // Update redirect_status to 2 (processing)
        await repo.updateStatusByIds([ad.id], { redirect_status: 2 });

        const countries = ad.country ? ad.country.replace(/\r\n/g, '').split(',').map(c => c.trim()).filter(Boolean) : [];
        if (!countries.length) {
          log?.warn(`[reddit-landers] No countries for ad ${ad.id}`);
          continue;
        }

        log?.info(`[reddit-landers] Ad ${ad.id} countries: ${countries.join(', ')}`);

        // Get ISO codes for each country
        const isoRows = await repo.getCountriesForAd(countries.join(','));

        if (isoRows && isoRows.length > 0) {
          const a = [];
          for (const row of isoRows) {
            if (!isoAccumulator.includes(row.iso)) {
              isoAccumulator.push(row.iso);
            }
            a.push(row.iso);
          }

          response.push({
            id: ad.id,
            country: countries,
            iso: a,
            destination_url: ad.destination_url
          });
        } else {
          log?.warn(`[reddit-landers] No ISO mapping found for ad ${ad.id}, countries: ${countries.join(', ')}`);
        }
      } else {
        // Ad not found in ES, set redirect_status = 5
        log?.warn(`[reddit-landers] Ad ${ad.id} not found in Elasticsearch`);
        await repo.updateStatusByIds([ad.id], { redirect_status: 5 });
      }
    }

    if (response.length === 0) {
      return {
        code: 400,
        message: 'No more urls found',
        data: [],
        exe_time: (Date.now() - startTime) / 1000
      };
    }

    return {
      code: 200,
      data: response,
      exe_time: (Date.now() - startTime) / 1000
    };
  } catch (err) {
    log?.error(`[reddit-landers] Error in getAdsForBlackhat: ${err.message}`);
    return {
      code: 400,
      message: `Exception occured in Reddit getRedditAdsWithCounrty function: ${err.message}`,
      exe_time: (Date.now() - startTime) / 1000
    };
  }
}

module.exports = {
  getAdsForBlackhat
};
