'use strict';

/**
 * ChatGPT Ads insertion — payload normalization.
 *
 * No PHP legacy to port (see docs/insertion/chatgptads/MANIFEST.md §0) — this is designed
 * directly from the one real sample payload confirmed so far (MANIFEST §1), not extracted
 * from anywhere.
 */

const { epochToDateTime, toInt } = require('../../../insertion/helpers/util');

const PLATFORM = 21; // fixed per product confirmation — not a varying payload value

function normalize(ad) {
  const n = {};

  n.ad_id = ad.ad_id != null ? String(ad.ad_id) : null;
  n.uid = ad.uid != null ? String(ad.uid) : null;
  n.type = String(ad.type || '').toUpperCase();
  n.platform = PLATFORM;
  // The payload's own "network":"chatgpt" is descriptive ad-row data only — it must NEVER be
  // used as the `network` argument to the shared NAS/mediaUpload helpers (that argument must
  // stay the literal string "chatgptads", the config slug — see nasClient.js's NAS_KEY_PREFIX
  // comment). Store it here for display/debugging only.
  n.network = ad.network || 'chatgpt';

  n.post_owner = ad.post_owner ?? null;
  n.post_owner_image = ad.post_owner_image ?? null;

  n.ad_title = ad.ad_title ?? null;
  n.ad_text = ad.ad_text ?? null;
  // The crawler sends BOTH "news_feed_description" and "newsfeed_description" with the
  // identical value (confirmed in the real sample — see MANIFEST §1). Collapse to ONE
  // canonical value; prefer the no-underscore spelling to match this network's own column/
  // ES-field name. Ask the crawler team to stop sending both (open item in the manifest).
  n.newsfeed_description = ad.newsfeed_description ?? ad.news_feed_description ?? null;

  n.destination_url = ad.destination_url ?? null;
  n.ad_position = ad.ad_position ?? null;
  // country can be a single resolved NAME string OR an array of them (same ad seen across
  // multiple countries) — already resolved names (geolocation lookup), no ISO translation
  // needed either way. n.countries is the full de-duplicated-by-nothing list (repeats are
  // harmless — chatgptads_ad_countries' ON DUPLICATE KEY UPDATE increments the sighting count
  // instead of erroring, so there is no need to dedupe here); n.country is just the first
  // entry, kept for the main ad row's single country_only_id + the ES doc's single `country`
  // field (unchanged shape for backward compat — see chatgptadsPipeline.js for how the full
  // list is additionally persisted into the join table).
  n.countries = (Array.isArray(ad.country) ? ad.country : ad.country != null ? [ad.country] : [])
    .filter((c) => typeof c === 'string' && c.trim() !== '')
    .map((c) => c.trim());
  n.country = n.countries[0] ?? null;
  n.version = ad.version ?? null;

  // image_url_original / image_video_url are both sent with the same value in the one real
  // sample — prefer image_video_url first, matching facebook's own preference order
  // (n.image_video_url ?? n.ad_image) for the equivalent concept.
  n.image_url_original = ad.image_video_url ?? ad.image_url_original ?? null;

  // UNCONFIRMED (no real VIDEO/carousel sample seen yet — see MANIFEST §6 open items #1/#2).
  // Assumed to match facebook's field names until a real sample proves otherwise.
  n.thumbnail_url = ad.thumbnail_url ?? null;
  n.other_multimedia = ad.other_multimedia ?? null;

  n.first_seen = ad.first_seen ? epochToDateTime(ad.first_seen) : null;
  n.last_seen = ad.last_seen ? epochToDateTime(ad.last_seen) : null;

  return n;
}

module.exports = { normalize, PLATFORM };
