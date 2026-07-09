'use strict';

/**
 * "Good media" SQL predicate — an ALLOWLIST of the canonical NAS mount prefixes.
 *
 * A stored media URL is only real / frontend-renderable (and therefore both
 * "healthy" in the audit AND eligible for ES backfill) if it STARTS WITH one of
 * the NAS mount prefixes that each network's paramParser `withCdn()` strips before
 * serving via the CDN — mirror of, e.g.:
 *
 *   trimmed.replace(/^\/?(PowerAdspy\/n2|PowerAdspy-Dev|pas-dev\/stream|pas-prod\/stream)\//i, '/')
 *   (facebook also allows a bare `PowerAdspy` — pass { bare: true })
 *
 * A blocklist ("not pasimage/pasvideo/…") is WRONG: it lets through anything else
 * that isn't a real NAS path — e.g. `getMedia/PowerAdspy-test/nas/…`, `/assets/img/
 * 1200x628.jpg`, raw CDN URLs, legacy `pasimages/…`. Those are NOT servable NAS
 * media, so they must be treated as bad (deletion candidates), not backfilled.
 *
 * Optional leading '/' and case-insensitive, matching the paramParser regex.
 */

const BASE_PREFIXES = ['PowerAdspy/n2', 'PowerAdspy-Dev', 'pas-dev/stream', 'pas-prod/stream'];
const FACEBOOK_PREFIXES = ['PowerAdspy/n2', 'PowerAdspy-Dev', 'PowerAdspy', 'pas-dev/stream', 'pas-prod/stream'];

/**
 * @param {string} column - the SQL column holding the media URL (e.g. image_url, video_cover)
 * @param {{ bare?: boolean }} [opts] - bare:true adds the facebook-only bare `PowerAdspy` prefix
 * @returns {string} a SQL boolean expression, TRUE when the column is a real NAS media path
 */
function nasGoodMediaExpr(column, { bare = false } = {}) {
  const prefixes = bare ? FACEBOOK_PREFIXES : BASE_PREFIXES;
  const like = [];
  for (const p of prefixes) {
    const lp = p.toLowerCase(); // no LIKE metachars in these prefixes ('_'/'%' absent); '-' '/' are literal
    like.push(`LOWER(${column}) LIKE '${lp}/%'`);   // stored without a leading slash
    like.push(`LOWER(${column}) LIKE '/${lp}/%'`);  // stored with a leading slash
  }
  return `(${column} IS NOT NULL AND ${column} <> '' AND (${like.join(' OR ')}))`;
}

module.exports = { nasGoodMediaExpr, BASE_PREFIXES, FACEBOOK_PREFIXES };
