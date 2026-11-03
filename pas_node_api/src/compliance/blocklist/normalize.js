'use strict';

/**
 * Normalization for everything the blocklist compares: ad ids, advertiser /
 * page names, URLs and domains. The same functions are applied to the ad
 * payload and to the blocklist entries, so both sides always agree.
 */

const { FAMILIES } = require('./constants');
// Same name normalizer as the existing owner deny-list, so both agree.
const { normalizePostOwnerName } = require('../../insertion/helpers/postOwnerRejection');

// ─── Ad ids ──────────────────────────────────────────────────────────

/**
 * Platform ad ids are compared as case-sensitive strings. A number and its
 * string form match (123 == "123"); surrounding whitespace is ignored; leading
 * zeros are kept (so "007" does not match "7").
 */
function normalizeId(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value !== 'string') return '';
  return value.trim();
}

// ─── Advertiser / page names ─────────────────────────────────────────

/**
 * NFKC, trimmed, whitespace collapsed, lowercased. Numbers are accepted (some
 * networks send a numeric advertiser id).
 */
function normalizeName(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return normalizePostOwnerName(value);
}

/**
 * The spelling-proof form of an already normalized name: Latin accents removed,
 * then everything except letters, digits and combining marks dropped.
 * "Twinkling Tree", "twinkling-tree", "Twinkling_Tree" and "TwinklingTree" all
 * become "twinklingtree". Only the Latin accent range (U+0300-U+036F) is removed:
 * in Devanagari, Arabic and similar scripts the marks are part of the letters, so
 * stripping them would make different names equal.
 */
function compactNormalized(name) {
  if (typeof name !== 'string' || !name) return '';
  return name.normalize('NFD').replace(/[̀-ͯ]+/g, '').replace(/[^\p{L}\p{N}\p{M}]+/gu, '');
}

/** compactNormalized() for a raw value (applies normalizeName first). */
function compactName(value) {
  return compactNormalized(normalizeName(value));
}

// ─── URLs and domains ────────────────────────────────────────────────
//
// normalizeUrl: scheme, `www.`, query string, fragment, port, trailing slashes
// and common image size tokens are ignored; the host is lowercased and the path
// case is kept. So these all produce `cdn.site.com/a/b.jpg`:
//   https://CDN.Site.com/a/b.jpg?x=1     http://www.cdn.site.com/a/150x150/b.jpg
//
// Unparseable input falls back to the trimmed raw string so an identical entry
// still matches. Empty, non-string, `data:` and oversized values return ''.

const MAX_URL_LENGTH = 4096;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function parseUrl(raw) {
  let s = raw;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = s.startsWith('//') ? `http:${s}` : `http://${s}`;
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

function cleanHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

function stripSizeTokens(pathname) {
  return pathname
    .replace(/=[swh]\d+(?:-[a-z0-9]+)*$/i, '')                       // =s300, =w300-h200-no
    .replace(/\/[a-z]?\d{2,4}x\d{2,4}(?=\/|$)/gi, '')                // /150x150/, /s150x150/
    .replace(/[_-]\d{2,4}x\d{2,4}(?=\.[a-z0-9]{2,5}$|$)/i, '');      // name_150x150.jpg
}

function usable(value) {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw || raw.length > MAX_URL_LENGTH || /^data:/i.test(raw)) return '';
  return raw;
}

function normalizeUrl(value) {
  const raw = usable(value);
  if (!raw) return '';
  const url = parseUrl(raw);
  const host = url ? cleanHost(url.hostname) : '';
  if (!host) return raw;

  let pathname = url.pathname;
  try {
    pathname = decodeURI(pathname);
  } catch {
    // keep the encoded form
  }
  pathname = stripSizeTokens(pathname).replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return pathname ? `${host}${pathname}` : host;
}

/** Host only (no `www.`, port, path or query). Accepts a bare host or a URL. */
function normalizeDomain(value) {
  const raw = usable(value);
  if (!raw) return '';
  const url = parseUrl(raw);
  return url ? cleanHost(url.hostname) : '';
}

/**
 * The host and its parent domains, down to two labels:
 *   a.b.example.com -> [a.b.example.com, b.example.com, example.com]
 * A suffix match means a blocked `example.com` also blocks its subdomains, but
 * `notexample.com` is never matched (whole labels only). IP addresses and
 * single-label hosts return just themselves.
 */
function domainCandidates(host) {
  if (!host) return [];
  const labels = host.split('.');
  if (labels.length < 2 || IPV4.test(host) || host.includes(':')) return [host];
  const out = [];
  for (let i = 0; i <= labels.length - 2; i += 1) out.push(labels.slice(i).join('.'));
  return out;
}

// ─── By family ───────────────────────────────────────────────────────

/** Normalize a blocklist entry's value according to its matching family. */
function normalizeByFamily(family, value) {
  switch (family) {
    case FAMILIES.AD_ID: return normalizeId(value);
    case FAMILIES.ADVERTISER: return normalizeName(value);
    case FAMILIES.URL: return normalizeUrl(value);
    case FAMILIES.DOMAIN: return normalizeDomain(value);
    default: return '';
  }
}

module.exports = {
  normalizeId,
  normalizeName,
  compactName,
  compactNormalized,
  normalizeUrl,
  normalizeDomain,
  domainCandidates,
  normalizeByFamily,
};
