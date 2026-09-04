const InstagramRepository = require('./repository');

// redirect_status values (instagram_ad_meta_data):
//   0 = PENDING       — not claimed yet
//   2 = IN_PROCESSING — claimed, handed off to a worker
const PENDING = 0;
const IN_PROCESSING = 2;

// A destination_url is usable only if it is a non-empty string that is not the
// literal token "null"/"undefined" (some upstream writes store those as text
// rather than a real SQL NULL). Mirrors the SQL filter in getDataForLander.
function isUsableDestinationUrl(value) {
  if (value == null) return false;
  const trimmed = String(value).trim();
  if (trimmed === '') return false;
  return !['null', 'undefined'].includes(trimmed.toLowerCase());
}

class GetAdsService {
  static async fetchAdsForScraping(db) {
    const { sql, elastic } = db;
    const repository = InstagramRepository;

    try {
      // PENDING has priority: only once that queue is fully drained (0 rows) does
      // this fall back to IN_PROCESSING — ads already claimed by a worker that
      // crashed/never finished — so those get re-served instead of stranded, but
      // never ahead of brand-new pending ones.
      let ads = await repository.getDataForLander(PENDING);
      if (!ads.length) {
        ads = await repository.getDataForLander(IN_PROCESSING);
      }

      const results = [];

      // Process each row (PHP style: one row per country per ad)
      for (const ad of ads) {
        // Never serve an ad without a usable destination_url (defence-in-depth —
        // getDataForLander already excludes these at the SQL level).
        if (!isUsableDestinationUrl(ad.destination_url)) continue;

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

      // Mark every fetched ad as claimed. No-op for ads that were already
      // IN_PROCESSING (the fallback batch) — they just get re-stamped.
      const uniqueAdIds = [...new Set(ads.map(ad => ad.id))];
      for (const adId of uniqueAdIds) {
        await repository.updateRedirectStatus(adId, IN_PROCESSING);
      }

      return results;
    } catch (error) {
      console.error('Error in fetchAdsForScraping:', error);
      throw error;
    }
  }
}

module.exports = GetAdsService;
