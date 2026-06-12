const InstagramRepository = require('./repository');

class GetAdsService {
  static async fetchAdsForScraping(db) {
    const { sql, elastic } = db;
    const repository = InstagramRepository;

    try {
      const ads = await repository.getDataForLander(0);
      const results = [];

      // Process each row (PHP style: one row per country per ad)
      for (const ad of ads) {
        // PHP filter: destination_url != null OR destination_url != ""
        if (ad.destination_url == null || ad.destination_url === "") continue;

        // Convert country name to ISO code
        if (ad.iso) {
          let isoCode = null;
          let countryName = ad.iso;

          // Special case: "ALL" means all countries
          if (ad.iso === "ALL") {
            isoCode = "ALL";
            countryName = "ALL";
          } else {
            // Lookup actual country ISO code
            isoCode = await repository.getCountryIso(ad.iso);
            if (!isoCode) continue; // Skip if ISO not found

            // Normalize country name to proper case
            countryName = ad.iso.charAt(0).toUpperCase() + ad.iso.slice(1).toLowerCase();
          }

          // Skip ads with only "ALL"
          if (isoCode === "ALL") continue;

          // Return one row per country (like PHP does)
          results.push({
            id: ad.id,
            ad_url: ad.ad_url,
            destination_url: ad.destination_url,
            iso: [isoCode],
            country: [countryName],
          });
        }
      }

      // Update redirect_status for all unique ads
      const uniqueAdIds = [...new Set(ads.map(ad => ad.id))];
      for (const adId of uniqueAdIds) {
        await repository.updateRedirectStatus(adId, 2);
      }

      return results;
    } catch (error) {
      console.error('Error in fetchAdsForScraping:', error);
      throw error;
    }
  }
}

module.exports = GetAdsService;
