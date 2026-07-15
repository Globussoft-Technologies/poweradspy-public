'use strict';

/**
 * Keywords Explorer — paginated/filterable/sortable browse of the whole
 * keyword corpus (the Ahrefs/SEMrush-style "browse the database" table).
 *
 * POST /api/v1/google/keywords/explorer
 *
 * Backed by `keyword_stats` (SQL rollup, refreshed by
 * jobs/refreshKeywordStats.js) — NOT a live ES aggregation. Sorting/filtering
 * thousands of rows per request isn't viable against the 200M+ doc index, so
 * this reads the pre-computed rollup instead. Every numeric column here is a
 * proxy derived from PowerAdSpy's own crawled ad corpus (no third-party
 * keyword-data provider) — see GOOGLE_COMPETITIVE_INTEL_FEATURE.md.
 *
 * Body (all optional):
 *   - page, page_size            (default 1 / 50, max page_size 200)
 *   - sort_by                    one of SORTABLE_COLUMNS (default ads_total)
 *   - sort_dir                   asc | desc (default desc)
 *   - volume_min/max             ads_total range
 *   - competition_min/max        competition_score range (0-100)
 *   - growth_min/max             growth_pct range
 *   - category                   exact category match
 *   - country                    keyword's country (google_text_keywords.country)
 *   - include/exclude            substring match/anti-match on the keyword text
 *   - first_seen_after           yyyy-MM-dd
 */

const { normalizeParams } = require('../helpers/paramParser');

const SORTABLE_COLUMNS = new Set([
  'ads_total', 'advertisers_total', 'domains_total', 'competition_score',
  'growth_pct', 'first_seen', 'last_seen',
]);

function clampInt(v, def, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(n, max));
}

async function getKeywordsExplorer(req, db, logger) {
  const p = normalizeParams({ ...req.body, ...req.query });
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  const page = clampInt(p.page, 1, 1, 1_000_000);
  const pageSize = clampInt(p.page_size, 50, 1, 200);
  const sortBy = SORTABLE_COLUMNS.has(p.sort_by) ? p.sort_by : 'ads_total';
  const sortDir = String(p.sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const where = [];
  const params = [];

  // normalizeParams only transforms keys present on the request — an omitted
  // filter is `undefined`, not `''`, so `!== ''` alone let every unset numeric
  // filter default to 0 and silently zero out real results (e.g. an unset
  // volume_max became `ads_total <= 0`, excluding every keyword). hasValue()
  // treats "absent" and "empty string" the same: no filter applied.
  const hasValue = (v) => v !== undefined && v !== null && v !== '';

  if (hasValue(p.volume_min)) { where.push('ks.ads_total >= ?'); params.push(Number(p.volume_min) || 0); }
  if (hasValue(p.volume_max)) { where.push('ks.ads_total <= ?'); params.push(Number(p.volume_max) || 0); }
  if (hasValue(p.competition_min)) { where.push('ks.competition_score >= ?'); params.push(Number(p.competition_min) || 0); }
  if (hasValue(p.competition_max)) { where.push('ks.competition_score <= ?'); params.push(Number(p.competition_max) || 0); }
  if (hasValue(p.growth_min)) { where.push('ks.growth_pct >= ?'); params.push(Number(p.growth_min) || 0); }
  if (hasValue(p.growth_max)) { where.push('ks.growth_pct <= ?'); params.push(Number(p.growth_max) || 0); }
  if (p.category) { where.push('ks.category = ?'); params.push(p.category); }
  if (p.country) { where.push('gtk.country = ?'); params.push(p.country); }
  if (p.include) { where.push('gtk.keyword LIKE ?'); params.push(`%${p.include}%`); }
  if (p.exclude) { where.push('gtk.keyword NOT LIKE ?'); params.push(`%${p.exclude}%`); }
  if (p.first_seen_after) { where.push('ks.first_seen >= ?'); params.push(p.first_seen_after); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const baseFrom = `FROM keyword_stats ks JOIN google_text_keywords gtk ON gtk.id = ks.keyword_id ${whereSql}`;

  try {
    // A keyword STRING can map to several google_text_keywords rows (one per
    // country), and refreshKeywordStats writes the SAME (keyword-string-level)
    // rollup to each of those keyword_ids — so a plain join surfaces the same
    // keyword as multiple identical rows (e.g. "sample" twice) and double-counts
    // the totals. Dedupe by keyword text everywhere: count distinct keywords,
    // aggregate the (identical) stats per keyword, and GROUP BY in the row query.
    const [{ total } = { total: 0 }] = await db.sql.query(`SELECT COUNT(DISTINCT gtk.keyword) AS total ${baseFrom}`, params);

    // Summary stats over the WHOLE filtered set (not just the current page) —
    // powers the stat cards above the table. Same baseFrom + params as the count,
    // so it respects every active filter/search. No schema change: all columns
    // already exist on keyword_stats.
    const [aggRow = {}] = await db.sql.query(
      `SELECT AVG(t.competition_score) AS avg_competition,
              SUM(t.ads_total)          AS total_ad_volume,
              SUM(CASE WHEN t.growth_pct > 0 THEN 1 ELSE 0 END) AS trending_up,
              SUM(CASE WHEN t.growth_pct < 0 THEN 1 ELSE 0 END) AS trending_down
       FROM (
         SELECT MAX(ks.competition_score) AS competition_score,
                MAX(ks.ads_total)         AS ads_total,
                MAX(ks.growth_pct)        AS growth_pct
         ${baseFrom}
         GROUP BY gtk.keyword
       ) t`,
      params
    );
    const stats = {
      keywords: Number(total) || 0,
      avg_competition: aggRow.avg_competition != null ? Math.round(Number(aggRow.avg_competition)) : null,
      total_ad_volume: Number(aggRow.total_ad_volume) || 0,
      trending_up: Number(aggRow.trending_up) || 0,
      trending_down: Number(aggRow.trending_down) || 0,
    };

    // LIMIT/OFFSET are inlined below rather than bound as `?` — db.sql.query()
    // runs prepared statements (mysql2 execute()), which errors ("Incorrect
    // arguments to mysqld_stmt_execute") binding LIMIT/OFFSET as placeholders
    // against this MySQL setup. Both are clampInt()-validated integers, so
    // inlining is safe (same workaround as getAdsByAdvertiserController.js).
    const rows = await db.sql.query(
      `SELECT MIN(gtk.id) AS keyword_id, gtk.keyword, ANY_VALUE(gtk.country) AS country,
              MAX(ks.ads_total) AS ads_total, MAX(ks.advertisers_total) AS advertisers_total,
              MAX(ks.domains_total) AS domains_total, MAX(ks.growth_pct) AS growth_pct,
              MAX(ks.competition_score) AS competition_score, ANY_VALUE(ks.category) AS category,
              ANY_VALUE(ks.sub_category) AS sub_category, ANY_VALUE(ks.top_country) AS top_country,
              ANY_VALUE(ks.type_mix) AS type_mix, ANY_VALUE(ks.position_top_pct) AS position_top_pct,
              MIN(ks.first_seen) AS first_seen, MAX(ks.last_seen) AS last_seen
       ${baseFrom}
       GROUP BY gtk.keyword
       ORDER BY ${sortBy} ${sortDir}
       LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params
    );

    return {
      code: 200,
      message: 'Keywords fetched.',
      data: {
        keywords: rows,
        page,
        page_size: pageSize,
        total,
        stats,
        note: 'Ad Volume / Competition Score / Growth are proxies derived from PowerAdSpy\'s own crawled Google Ads corpus, not Google search volume or backlink-based Keyword Difficulty.',
      },
    };
  } catch (err) {
    logger.error('Error in getKeywordsExplorer (google)', { error: err.message });
    return { code: 500, message: 'Error fetching keywords', error: err.message };
  }
}

module.exports = { getKeywordsExplorer, SORTABLE_COLUMNS };
