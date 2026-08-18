"use strict";
const axios = require("axios");
/**
 * Geo-IP utilities — detect client IP and country from request headers.
 */

// Cloudflare's published IPv4 edge ranges (cloudflare.com/ips). A real end
// user's IP should never legitimately BE one of these — if the "best"
// available candidate resolves inside one, some hop between Cloudflare and
// this app dropped the real cf-connecting-ip and what's left is
// Cloudflare's own connecting/edge IP, not the visitor's. Recording that as
// if it were the real client (what every candidate below used to do
// unconditionally) is worse than admitting "unknown" — it silently fills
// the IP Manager table with Cloudflare's own infrastructure IPs.
const CLOUDFLARE_IPV4_RANGES = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];

function _ipToInt(ip) {
  const parts = String(ip || "").trim().split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isCloudflareIp(ip) {
  const ipInt = _ipToInt(ip);
  if (ipInt === null) return false;
  return CLOUDFLARE_IPV4_RANGES.some((cidr) => {
    const [rangeIp, bits] = cidr.split("/");
    const rangeInt = _ipToInt(rangeIp);
    const maskBits = Number(bits);
    const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
    return (ipInt & mask) === (rangeInt & mask);
  });
}

/**
 * Extract real client IP from request — skips any candidate (header or
 * req.ip) that resolves to a Cloudflare edge range, falling through to the
 * next one. Returns null (never a Cloudflare IP) if nothing usable remains.
 */
function getClientIp(req) {
  const candidates = [
    req.headers["cf-connecting-ip"],
    req.headers["x-forwarded-for"] ? req.headers["x-forwarded-for"].split(",")[0].trim() : null,
    req.headers["x-real-ip"],
    req.ip,
  ];
  for (const c of candidates) {
    if (c && !isCloudflareIp(c)) return c;
  }
  return null;
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

// Shared lookup — both getLocation() (existing callers, country-string only)
// and getLocationDetails() (new: admin IP Manager, country+city) read from
// the SAME cache entry, so an IP looked up by one flow doesn't cost a
// second ip-api.com call (45 req/min free-tier limit) if the other flow
// happens to touch the same IP.
async function _lookupIp(ipAddress) {
  if (!ipAddress) return null;

  const hit = _ipCache.get(ipAddress);
  if (hit && Date.now() - hit.at < IP_CACHE_TTL_MS) return hit;

  try {
    const response = await axios.get(`http://ip-api.com/json/${ipAddress}`, {
      timeout: IP_LOOKUP_TIMEOUT_MS,
    });
    const entry = {
      country: response.data?.country || null,
      city: response.data?.city || null,
      region: response.data?.regionName || null,
      at: Date.now(),
    };
    if (_ipCache.size >= IP_CACHE_MAX) {
      const oldestKey = _ipCache.keys().next().value;
      if (oldestKey !== undefined) _ipCache.delete(oldestKey);
    }
    _ipCache.set(ipAddress, entry);
    return entry;
  } catch (error) {
    // Cache nulls too (briefly) so a flapping upstream doesn't trigger N retries
    // for the same IP within a single user's session.
    const entry = { country: null, city: null, region: null, at: Date.now() };
    _ipCache.set(ipAddress, entry);
    return entry;
  }
}

const getLocation = async (ipAddress) => {
  const entry = await _lookupIp(ipAddress);
  return entry?.country ?? null;
};

/** Country + city + region for one IP — real ip-api.com data, null fields
 * when the lookup fails/times out (never fabricated). */
const getLocationDetails = async (ipAddress) => {
  const entry = await _lookupIp(ipAddress);
  if (!entry) return null;
  return { country: entry.country, city: entry.city, region: entry.region };
};

module.exports = {
  getClientIp,
  detectCountry,
  getLocation,
  getLocationDetails,
  isCloudflareIp,
};
