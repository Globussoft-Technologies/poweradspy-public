'use strict';

const repo = require('./repository');

async function getAdwithCountryCode(db, log) {
  const startTime = Date.now();
  try {
    // Fetch ads with redirect_status = 0
    const ads = await repo.getDataForLander(0);

    log?.info(`Fetched ${ads.length} ads`);

    if (!ads || ads.length === 0) {
      return {
        code: 400,
        message: 'urls over',
        data: [],
        exe_time: (Date.now() - startTime) / 1000
      };
    }

    // Update redirect_status to 2 (processing)
    const adIds = ads.map(a => a.id);
    await repo.updateStatusByIds(adIds, { redirect_status: 2 });

    // Build response with ISO accumulator
    const response = [];
    let isoAccumulator = [];
    let cachedCountryNames = null;

    for (const ad of ads) {
      const countries = ad.country ? ad.country.split(',') : [];

      if (!countries.length) {
        log?.warn(`No countries for ad ${ad.id}`);
        continue;
      }

      // Get ISO codes for each country
      const isoRows = await repo.getCountriesForAd(countries.map(c => c.trim()).join(','));

      if (isoRows && isoRows.length > 0) {
        // Accumulate unique ISOs
        const newIsos = [];
        for (const row of isoRows) {
          if (!isoAccumulator.includes(row.iso)) {
            isoAccumulator.push(row.iso);
            newIsos.push(row.iso);
          }
        }

        // Cache country names to avoid repeated queries
        if (newIsos.length > 0 || !cachedCountryNames) {
          cachedCountryNames = await repo.getCountryNames(isoAccumulator);
        }
        const countryNameList = cachedCountryNames.map(c => c.nicename);

        response.push({
          id: ad.id,
          destination_url: ad.destination_url,
          iso: isoAccumulator,
          countries: countryNameList
        });
      }
    }

    if (response.length === 0) {
      return {
        code: 400,
        message: 'urls over',
        data: [],
        exe_time: (Date.now() - startTime) / 1000
      };
    }

    return {
      code: 200,
      message: 'Success',
      data: response,
      exe_time: (Date.now() - startTime) / 1000
    };
  } catch (err) {
    log?.error(`Error in getAdwithCountryCode: ${err.message}`);
    return {
      code: 400,
      message: 'Error fetching ads',
      error: err.message,
      exe_time: (Date.now() - startTime) / 1000
    };
  }
}

module.exports = {
  getAdwithCountryCode
};
