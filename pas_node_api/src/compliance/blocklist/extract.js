'use strict';

/**
 * Pull the identifiers the blocklist can match out of one ad payload and
 * normalize them. Never throws: anything that is not usable is skipped.
 *
 * Which payload fields carry what is configurable. The defaults are the union
 * of the field names the insertion pipelines read; override them per network
 * (or for all networks with "*") in config.json under
 * compliance.blocklist.fields, so adding or correcting a network needs no code
 * change.
 *
 *   adId             platform ad id
 *   advertiser       advertiser / page / owner name or id
 *   imageUrls        single image-like URLs
 *   listUrls         fields holding several URLs separated by `||,`, `||` or `|`
 *   destinationUrls  landing-page URLs (also matched against `url` entries)
 *   domainUrls       URLs whose host is checked against `domain` entries
 *
 * Deliberately NOT included: `reddit_id`. On Reddit that is the discovering
 * user's account, not the advertiser.
 */

const {
  normalizeId, normalizeName, normalizeUrl, normalizeDomain, domainCandidates,
} = require('./normalize');

const DEFAULT_FIELDS = Object.freeze({
  adId: ['ad_id'],
  advertiser: ['post_owner', 'post_owner_name', 'advertiser_name', 'advertiser_id', 'advertiser'],
  // Raw payload names seen across the networks' insertion code: image_video_url (fb, ig, reddit,
  // quora, linkedin), ad_image / ad_video (pinterest, native, google), image_url_original (gdn,
  // native, quora, admob, chatgptads), thumbnail (youtube), video_url_original (google).
  imageUrls: [
    'image_video_url', 'image_url', 'image_url_original', 'ad_image', 'ad_video',
    'thumbnail', 'thumbnail_url', 'video_url_original', 'post_owner_image',
  ],
  listUrls: ['other_multimedia', 'othermedia', 'othermultimedia'],
  destinationUrls: ['destination_url'],
  domainUrls: ['destination_url'],
});

const FIELD_KEYS = Object.keys(DEFAULT_FIELDS);
// Used only if the caller passes no limit (the real default lives in src/config/index.js:
// compliance.blocklist.maxUrlsPerAd). Bounds the work for a payload with a huge carousel.
const FALLBACK_MAX_URLS = 200;
const LIST_SEPARATOR = /\|\|,|\|\||\|/;

function cleanList(value) {
  if (!Array.isArray(value)) return null;
  return value.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
}

/** Defaults, then the "*" override, then the network's own override. */
function resolveFields(network, overrides = {}) {
  const merged = { ...DEFAULT_FIELDS };
  for (const source of [overrides['*'], overrides[network]]) {
    if (!source || typeof source !== 'object') continue;
    for (const key of FIELD_KEYS) {
      const list = cleanList(source[key]);
      if (list) merged[key] = list;
    }
  }
  return merged;
}

function uniq(values) {
  return [...new Set(values)];
}

function readAll(ad, names) {
  return names.map((name) => ad[name]);
}

function splitList(value) {
  if (Array.isArray(value)) return value.flatMap(splitList);
  if (typeof value !== 'string') return [];
  return value.split(LIST_SEPARATOR);
}

/**
 * @param {Object} ad      raw payload
 * @param {Object} fields  result of resolveFields()
 * @param {number} [maxUrls]  config compliance.blocklist.maxUrlsPerAd
 * @returns {{adIds:string[], advertisers:string[], urls:string[], domains:string[],
 *            rawAdId:?string, rawAdvertiser:?string}}
 */
function extract(ad, fields, maxUrls) {
  const urlLimit = Number.isInteger(maxUrls) && maxUrls > 0 ? maxUrls : FALLBACK_MAX_URLS;
  if (!ad || typeof ad !== 'object') {
    return { adIds: [], advertisers: [], urls: [], domains: [], rawAdId: null, rawAdvertiser: null };
  }

  const adIds = uniq(readAll(ad, fields.adId).map(normalizeId).filter(Boolean));
  const advertisers = uniq(readAll(ad, fields.advertiser).map(normalizeName).filter(Boolean));

  const urlValues = [
    ...readAll(ad, fields.imageUrls),
    ...readAll(ad, fields.listUrls).flatMap(splitList),
    ...readAll(ad, fields.destinationUrls),
  ];
  const urls = uniq(urlValues.map(normalizeUrl).filter(Boolean)).slice(0, urlLimit);

  const hosts = uniq(readAll(ad, fields.domainUrls).map(normalizeDomain).filter(Boolean));
  const domains = uniq(hosts.flatMap(domainCandidates));

  return {
    adIds,
    advertisers,
    urls,
    domains,
    rawAdId: adIds[0] ?? null,
    rawAdvertiser: advertisers[0] ?? null,
  };
}

module.exports = { DEFAULT_FIELDS, resolveFields, extract };
