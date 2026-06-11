const NativeAdMetaData = require('../models/NativeAdMetaData');
const NativeCountryData = require('../models/NativeCountryData');
const databaseManager = require('../../../../database/DatabaseManager');

// Helper to search ad in Elasticsearch
async function searchAd(adId) {
  try {
    const esWrapper = databaseManager.getElastic('native');
    if (!esWrapper) {
      return true; // Skip ES validation if not available
    }

    const result = await esWrapper.search({
      index: esWrapper.indexName,
      body: {
        query: {
          match: {
            'native_ad.id': adId,
          },
        },
      },
    });

    return result?.hits?.hits?.length > 0;
  } catch (error) {
    console.error(`Elasticsearch search error for ad ${adId}:`, error.message);
    return false;
  }
}

class GetNativeAdsService {
  /**
   * Fetch ads with status=0 and return with ISO codes
   */
  static async fetchAdsForScraping() {
    try {
      // Step 1: Get ads with status=0
      const ads = await NativeAdMetaData.getAdsByStatus(0);

      if (ads.length === 0) {
        return [];
      }

      const resultAds = [];

      // Step 2: Check all ads in Elasticsearch (parallel)
      const esCheckResults = await Promise.all(
        ads.map(ad => searchAd(ad.id).catch(() => false))
      );

      // Step 3: Build batch update and get all country ISO codes
      const countriesToLookup = new Set();
      ads.forEach(ad => {
        if (ad.countries) {
          ad.countries.split(',').forEach(c => countriesToLookup.add(c.trim()));
        }
      });

      // Get all ISO codes in one query
      const countryToIsoMap = await this.getCountriesIsoCodesBatch(Array.from(countriesToLookup));

      // Step 4: Prepare batch updates
      const updateStatements = [];
      ads.forEach((ad, index) => {
        const newStatus = esCheckResults[index] ? 2 : 5;
        updateStatements.push({ adId: ad.id, status: newStatus });
      });

      // Step 5: Batch update statuses
      await NativeAdMetaData.batchUpdateRedirectStatus(updateStatements);

      // Step 6: Build result
      ads.forEach((ad, index) => {
        if (ad.destination_url) {
          const isoCodes = this.mapCountriesToIso(ad.countries, countryToIsoMap);
          resultAds.push({
            id: ad.id,
            destination_url: ad.destination_url,
            iso: isoCodes,
            country: ad.countries,
          });
        }
      });

      return resultAds;
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
