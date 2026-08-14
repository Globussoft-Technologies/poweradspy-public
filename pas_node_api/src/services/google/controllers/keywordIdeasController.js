'use strict';

/**
 * Keyword Ideas — related/matching terms for a seed keyword (the "Matching
 * terms" / "Related terms" analog from Ahrefs' Keywords Explorer).
 *
 * POST /api/v1/google/keywords/ideas
 *
 * Body: { keyword (required, seed), top_n (default 30, max 100) }
 *
 * Sourced entirely from PowerAdSpy's own crawled `google_text_keywords` /
 * `keyword_stats` — coverage is bounded to bidding keywords PowerAdSpy has
 * actually seen advertisers use, NOT the internet's full search-query space
 * (no third-party keyword-data provider). Returns two buckets:
 *   - matching_terms: keyword text contains the seed as a substring
 *   - related_terms:  keywords sharing the seed's majority `category`
 */

const { normalizeParams } = require('../helpers/paramParser');

function clampInt(v, def, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(n, max));
}

const STATS_COLUMNS = `gtk.id AS keyword_id, gtk.keyword, gtk.country,
  ksu.ads_total, ksu.advertisers_total, ksu.competition_score, ksu.growth_pct, ksu.category`;

// keyword_stats_unique stores `keyword` deduped/lowercased — join by normalized
// text instead of keyword_id (see keyword_stats_unique_schema.sql).
const STATS_JOIN = `LEFT JOIN keyword_stats_unique ksu
  ON ksu.keyword = LOWER(TRIM(CONVERT(gtk.keyword USING utf8mb4))) COLLATE utf8mb4_unicode_ci`;

async function getKeywordIdeas(req, db, logger) {
  const p = normalizeParams({ ...req.body, ...req.query });
  if (!p.keyword) return { code: 400, message: 'Missing parameter: keyword is required' };
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  const seed = String(p.keyword).trim().toLowerCase();
  const topN = clampInt(p.top_n, 30, 1, 100);

  try {
    // LIMIT is inlined (not bound) — db.sql.query() runs prepared statements
    // (mysql2 execute()), which errors binding LIMIT as a placeholder against
    // this MySQL setup; topN is clampInt()-validated, so inlining is safe.
    const matchingTerms = await db.sql.query(
      `SELECT ${STATS_COLUMNS}
       FROM google_text_keywords gtk
       ${STATS_JOIN}
       WHERE LOWER(gtk.keyword) LIKE ? AND LOWER(gtk.keyword) != ?
       ORDER BY ksu.ads_total DESC
       LIMIT ${topN}`,
      [`%${seed}%`, seed]
    );

    const [seedStats] = await db.sql.query(
      `SELECT category FROM keyword_stats_unique WHERE keyword = ? AND category IS NOT NULL LIMIT 1`,
      [seed]
    );

    let relatedTerms = [];
    if (seedStats?.category) {
      relatedTerms = await db.sql.query(
        `SELECT ${STATS_COLUMNS}
         FROM google_text_keywords gtk
         ${STATS_JOIN}
         WHERE ksu.category = ? AND LOWER(gtk.keyword) != ?
         ORDER BY ksu.ads_total DESC
         LIMIT ${topN}`,
        [seedStats.category, seed]
      );
    }

    return {
      code: 200,
      message: 'Keyword ideas fetched.',
      data: {
        seed: p.keyword,
        matching_terms: matchingTerms,
        related_terms: relatedTerms,
        note: 'Ideas are drawn only from keywords PowerAdSpy has seen advertisers actually bid on — not a general search-query database.',
      },
    };
  } catch (err) {
    logger.error('Error in getKeywordIdeas (google)', { error: err.message });
    return { code: 500, message: 'Error fetching keyword ideas', error: err.message };
  }
}

module.exports = { getKeywordIdeas };
