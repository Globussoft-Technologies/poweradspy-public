"use strict";
const axios = require("axios");
/**
 * Geo-IP utilities — detect client IP and country from request headers.
 */

/**
 * Extract real client IP from request.
 */
function getClientIp(req) {
  if (req.headers["cf-connecting-ip"]) return req.headers["cf-connecting-ip"];
  if (req.headers["x-forwarded-for"])
    return req.headers["x-forwarded-for"].split(",")[0].trim();
  if (req.headers["x-real-ip"]) return req.headers["x-real-ip"];
  return req.ip || null;
}

/**
 * Detect full country name (e.g. "India", "United States") from CDN headers.
 * CDN headers carry ISO codes — we expand them to names because ES indexes
 * (country_only.country) store full names, so the ipBasedCountry boost only
 * matches when we pass the name.
 */
function detectCountry(req) {
  const cf = req.headers["cf-ipcountry"];
  if (cf && cf !== "XX" && cf !== "T1") return getCountryName(cf);
  if (req.headers["x-country-code"])
    return getCountryName(req.headers["x-country-code"]);
  if (req.headers["x-geoip-country"])
    return getCountryName(req.headers["x-geoip-country"]);
  return null;
}

/**
 * Convert country code → country name
 */
function getCountryName(code) {
  if (!code) return null;

  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code);
  } catch (err) {
    return code; // fallback
  }
}
// In-memory IP → country cache.
// `getLocation` calls a public HTTP endpoint (ip-api.com) with a 45 req/min
// free-tier limit and 100–500ms latency per call, so the un-cached version
// added that latency to EVERY common search. We keep results for an hour and
// cap the map at 10k entries (LRU-ish via insertion-order).
const _ipCache = new Map();
const IP_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const IP_CACHE_MAX = 10000;
// Also cap how long we wait on the upstream so a slow ip-api.com response
// can't drag the whole search request with it.
const IP_LOOKUP_TIMEOUT_MS = 1500;

const getLocation = async (ipAddress) => {
  if (!ipAddress) return null;

  // Fast path — cache hit
  const hit = _ipCache.get(ipAddress);
  if (hit && Date.now() - hit.at < IP_CACHE_TTL_MS) return hit.country;

  try {
    const response = await axios.get(`http://ip-api.com/json/${ipAddress}`, {
      timeout: IP_LOOKUP_TIMEOUT_MS,
    });
    const country = response.data?.country || null;

    // Evict oldest entry if we hit cap (Map preserves insertion order)
    if (_ipCache.size >= IP_CACHE_MAX) {
      const oldestKey = _ipCache.keys().next().value;
      if (oldestKey !== undefined) _ipCache.delete(oldestKey);
    }
    _ipCache.set(ipAddress, { country, at: Date.now() });
    return country;
  } catch (error) {
    // Cache nulls too (briefly) so a flapping upstream doesn't trigger N retries
    // for the same IP within a single user's session.
    _ipCache.set(ipAddress, { country: null, at: Date.now() });
    return null;
  }
};

module.exports = {
  getClientIp,
  detectCountry,
  getLocation,
};
