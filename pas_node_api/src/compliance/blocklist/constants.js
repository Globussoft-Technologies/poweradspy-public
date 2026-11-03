'use strict';

/**
 * Shared vocabulary for the copyright blocklist (B1).
 *
 * `entry_type` is what is stored in copyright_blocklist. Several entry types
 * share one matching "family" so the in-memory lookup stays small:
 *   ad_id                 -> family ad_id
 *   advertiser, page      -> family advertiser
 *   url, image_url        -> family url     (image, thumbnail, destination URLs)
 *   domain                -> family domain  (host and its parent domains)
 * Any other entry type (e.g. image_hash, owned by B2) is ignored by B1.
 */

const FAMILIES = Object.freeze({
  AD_ID: 'ad_id',
  ADVERTISER: 'advertiser',
  URL: 'url',
  DOMAIN: 'domain',
  // Not an entry family: a second index over the advertiser entries, keyed by the
  // spelling-proof form of the name (see compactNormalized in normalize.js).
  ADVERTISER_VARIANT: 'advertiser_variant',
});

const TYPE_TO_FAMILY = Object.freeze({
  ad_id: FAMILIES.AD_ID,
  advertiser: FAMILIES.ADVERTISER,
  page: FAMILIES.ADVERTISER,
  url: FAMILIES.URL,
  image_url: FAMILIES.URL,
  domain: FAMILIES.DOMAIN,
});


// Per-network lifecycle of a loaded blocklist.
const STATUS = Object.freeze({
  READY: 'ready',             // loaded from the database and refreshing normally
  STALE: 'stale',             // loaded earlier; the latest refresh failed, last good list still in use
  FROM_FILE: 'from_file',     // database unreachable at startup; using the saved copy on disk
  UNAVAILABLE: 'unavailable', // nothing loaded — the fail mode decides what happens
});

module.exports = { FAMILIES, TYPE_TO_FAMILY, STATUS };
