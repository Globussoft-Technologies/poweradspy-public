// Pull the identifiers the blocklist can match out of one TikTok ad payload and
// normalize them. Never throws: anything that is not usable is skipped.
//
// Which payload fields carry what is configurable (config
// compliance.blocklist.fields). The defaults are the fields POST
// /v1/tiktok/create accepts (see tiktok.validate.js):
//   adId             ad_id
//   advertiser       post_owner, tiktok_account_name, tiktok_account_id
//   imageUrls        video_cover (thumbnail), video_url
//   listUrls         (none for TikTok)
//   destinationUrls  destination_url
//   domainUrls       destination_url (its host is checked against `domain` entries)
// `library_url` is deliberately not matched: it is TikTok's own Creative Center
// page for the ad, not the creative or the advertiser.
import {
  normalizeId, normalizeName, normalizeUrl, normalizeDomain, domainCandidates,
} from "./blocklist.normalize.js";

export const DEFAULT_FIELDS = Object.freeze({
  adId: ["ad_id"],
  advertiser: ["post_owner", "tiktok_account_name", "tiktok_account_id"],
  imageUrls: ["video_cover", "video_url"],
  listUrls: [],
  destinationUrls: ["destination_url"],
  domainUrls: ["destination_url"],
});

const FIELD_KEYS = Object.keys(DEFAULT_FIELDS);
// Used only if the caller passes no limit (the real default lives in blocklist.service.js:
// compliance.blocklist.maxUrlsPerAd).
const FALLBACK_MAX_URLS = 200;
const LIST_SEPARATOR = /\|\|,|\|\||\|/;

function cleanList(value) {
  if (!Array.isArray(value)) return null;
  return value.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim());
}

// Defaults, then the configured override.
export function resolveFields(overrides = {}) {
  const merged = { ...DEFAULT_FIELDS };
  if (overrides && typeof overrides === "object") {
    for (const key of FIELD_KEYS) {
      const list = cleanList(overrides[key]);
      if (list) merged[key] = list;
    }
  }
  return merged;
}

const uniq = (values) => [...new Set(values)];
const readAll = (ad, names) => names.map((name) => ad[name]);

function splitList(value) {
  if (Array.isArray(value)) return value.flatMap(splitList);
  if (typeof value !== "string") return [];
  return value.split(LIST_SEPARATOR);
}

export function extract(ad, fields, maxUrls) {
  const urlLimit = Number.isInteger(maxUrls) && maxUrls > 0 ? maxUrls : FALLBACK_MAX_URLS;
  if (!ad || typeof ad !== "object") {
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
