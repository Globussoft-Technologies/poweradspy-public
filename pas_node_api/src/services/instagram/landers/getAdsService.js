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
      // never ahead of brand-new pending ones. IN_PROCESSING ads already served today
      // (updated_date = today) are skipped; they become eligible again tomorrow.
      let ads = await repository.getDataForLander(PENDING);
      if (!ads.length) {
        ads = await repository.getDataForLander(IN_PROCESSING, { excludeServedToday: true });
      }

      const results = [];

      // One ISO lookup for every country name in the batch (instead of one per row).
      // SQL calls are awaited one at a time — a request holds at most one connection.
      const countryNames = ads
        .filter((ad) => isUsableDestinationUrl(ad.destination_url) && ad.iso && ad.iso !== "ALL")
        .map((ad) => ad.iso);
      const isoByName = await repository.getCountryIsoMultiple(countryNames);

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
            isoCode = isoByName.get(String(ad.iso).toLowerCase()) || null;
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

      // Mark every fetched ad as claimed and stamp updated_date (served today), so the
      // IN_PROCESSING fallback does not hand the same ad out again until tomorrow.
      // One bulk UPDATE for the whole batch.
      const uniqueAdIds = [...new Set(ads.map(ad => ad.id))];
      await repository.markServedMultiple(uniqueAdIds, IN_PROCESSING);

      return results;
    } catch (error) {
      console.error('Error in fetchAdsForScraping:', error);
      throw error;
    }
  }
}

module.exports = GetAdsService;
