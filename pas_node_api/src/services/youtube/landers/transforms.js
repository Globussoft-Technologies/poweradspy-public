'use strict';

/**
 * YouTube landers — shared value transforms.
 *
 * Pulled out of insertHtmlService so the orchestrator stays focused (mirrors the
 * insertion module's normalize/esDocBuilder split). These faithfully reproduce the
 * legacy PHP string munging used across the lander pipeline.
 */

/** ES hits accessor — handles both client shapes (`res.hits` and `res.body.hits`). */
function esHits(res) {
  return res?.hits?.hits || res?.body?.hits?.hits || [];
}

/** JSON-encode, strip surrounding [], drop quotes, "\/"→"/", join with "||". */
function pipeJoin(value) {
  return JSON.stringify(value ?? null)
    .replace(/^\[|\]$/g, '')
    .replace(/"/g, '')
    .replace(/\\\//g, '/')
    .replace(/,/g, '||');
}

/** Country string: pipeJoin + uppercase (PHP country_iso handling). */
function normalizeCountry(countryIso) {
  return pipeJoin(countryIso).toUpperCase();
}

/** Trim [], drop quotes, split on "," → unique list (PHP screenshot/zip db parsing). */
function splitDbList(dbValue) {
  if (dbValue === null || dbValue === undefined) return [];
  const s = String(dbValue).replace(/^\[|\]$/g, '').replace(/"/g, '');
  if (s === '') return [];
  return [...new Set(s.split(','))];
}

const uniq = (arr) => [...new Set(arr)];

/** Registrable domain from a destination URL (PHP parse_url + regex). */
function extractDomain(destinations) {
  if (!destinations) return null;
  let host;
  try { host = new URL(destinations).hostname; }
  catch { host = String(destinations).replace(/^https?:\/\//i, '').split('/')[0]; }
  const m = String(host || '').match(/([a-z0-9][a-z0-9-]{1,63}\.[a-z.]{2,6})$/i);
  return m ? m[1] : null;
}

/** PHP strtotime(date) → unix seconds (or null when not parseable). */
function toUnixSeconds(dateStr) {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

module.exports = { esHits, pipeJoin, normalizeCountry, splitDbList, uniq, extractDomain, toUnixSeconds };
