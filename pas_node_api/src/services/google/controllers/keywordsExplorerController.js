'use strict';

/**
 * Keywords Explorer — paginated/filterable/sortable browse of the whole
 * keyword corpus (the Ahrefs/SEMrush-style "browse the database" table).
 *
 * POST /api/v1/google/keywords/explorer
 *
 * Backed by `keyword_stats_unique` (SQL rollup, refreshed by
 * jobs/refreshKeywordStats.js) — NOT a live ES aggregation, and NOT the
 * per-keyword_id `keyword_stats` table either. `keyword_stats` has one row
 * PER COUNTRY-VARIANT keyword_id, so browsing it required `GROUP BY
 * gtk.keyword` on every request — measured at ~20-38s per query against
 * production (1.07M rows materialized + filesorted on every single page
 * load, "Using temporary; Using filesort" even with an index on the sort
 * column — see scripts/diagnose-keywords-explorer.js). `keyword_stats_unique`
 * has ONE row per keyword TEXT instead (see keyword_stats_unique_schema.sql),
 * so count/filter/sort here are plain indexed reads with no GROUP BY at all.
 *
 * Every numeric column here is a proxy derived from PowerAdSpy's own crawled
 * ad corpus (no third-party keyword-data provider) — see
 * GOOGLE_COMPETITIVE_INTEL_FEATURE.md.
 *
 * Body (all optional):
 *   - page, page_size            (default 1 / 50, max page_size 200)
 *   - sort_by                    one of SORTABLE_COLUMNS (default ads_total)
 *   - sort_dir                   asc | desc (default desc)
 *   - volume_min/max             ads_total range
 *   - competition_min/max        competition_score range (0-100)
 *   - growth_min/max             growth_pct range
 *   - category                   exact category match
 *   - country                    keyword tracked in this country (matches
 *                                 against the keyword's `countries` array)
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

// COUNT and the whole-filtered-set stats aggregate only change when
// refreshKeywordStats.js runs (every N hours) — cache them per-filter-set for
// a couple minutes so paging through the SAME filtered view (the common case)
// doesn't re-run both aggregates on every page click. In-process Map, not the
// (currently uninitialized) Redis/SQLite CacheStore — deliberately simple, no
// new subsystem dependency for a hot production fix.
const STATS_CACHE_TTL_MS = 2 * 60 * 1000;
const STATS_CACHE_MAX_ENTRIES = 500;
const statsCache = new Map(); // cacheKey -> { expiresAt, value: { total, aggRow } }

function statsCacheKey(whereSql, params) {
  return `${whereSql}::${JSON.stringify(params)}`;
}

function getCachedStats(key) {
  const hit = statsCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) { statsCache.delete(key); return null; }
  return hit.value;
}

function setCachedStats(key, value) {
  if (statsCache.size >= STATS_CACHE_MAX_ENTRIES) {
    statsCache.delete(statsCache.keys().next().value); // evict oldest
  }
  statsCache.set(key, { expiresAt: Date.now() + STATS_CACHE_TTL_MS, value });
}

// mysql2 returns JSON columns already parsed; guard anyway in case a row was
// written before this column existed (NULL) or the driver hands back a string.
function parseCountries(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
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

  if (hasValue(p.volume_min)) { where.push('ksu.ads_total >= ?'); params.push(Number(p.volume_min) || 0); }
  if (hasValue(p.volume_max)) { where.push('ksu.ads_total <= ?'); params.push(Number(p.volume_max) || 0); }
  if (hasValue(p.competition_min)) { where.push('ksu.competition_score >= ?'); params.push(Number(p.competition_min) || 0); }
  if (hasValue(p.competition_max)) { where.push('ksu.competition_score <= ?'); params.push(Number(p.competition_max) || 0); }
  if (hasValue(p.growth_min)) { where.push('ksu.growth_pct >= ?'); params.push(Number(p.growth_min) || 0); }
  if (hasValue(p.growth_max)) { where.push('ksu.growth_pct <= ?'); params.push(Number(p.growth_max) || 0); }
  if (p.category) { where.push('ksu.category = ?'); params.push(p.category); }
  if (p.country) { where.push('JSON_CONTAINS(ksu.countries, JSON_QUOTE(?))'); params.push(p.country); }
  if (p.include) { where.push('ksu.keyword LIKE ?'); params.push(`%${p.include}%`); }
  if (p.exclude) { where.push('ksu.keyword NOT LIKE ?'); params.push(`%${p.exclude}%`); }
  if (p.first_seen_after) { where.push('ksu.first_seen >= ?'); params.push(p.first_seen_after); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const baseFrom = `FROM keyword_stats_unique ksu ${whereSql}`;

  try {
    // total/stats depend only on the FILTER (whereSql+params), not on page/sort —
    // cache them so paging through the same filtered view doesn't re-run both
    // aggregates on every page click. The row query below is independent of
    // both and always runs fresh, in parallel with the (cached-or-not) stats
    // lookup, instead of the three queries running one after another.
    const cacheKey = statsCacheKey(whereSql, params);
    const cached = getCachedStats(cacheKey);

    const statsPromise = cached
      ? Promise.resolve(cached)
      : Promise.all([
          db.sql.query(`SELECT COUNT(*) AS total ${baseFrom}`, params),
          db.sql.query(
            `SELECT AVG(competition_score) AS avg_competition,
                    SUM(ads_total)          AS total_ad_volume,
                    SUM(CASE WHEN growth_pct > 0 THEN 1 ELSE 0 END) AS trending_up,
                    SUM(CASE WHEN growth_pct < 0 THEN 1 ELSE 0 END) AS trending_down
             ${baseFrom}`,
            params
          ),
        ]).then(([[{ total } = { total: 0 }], [aggRow = {}]]) => {
          const value = { total, aggRow };
          setCachedStats(cacheKey, value);
          return value;
        });

    // LIMIT/OFFSET are inlined below rather than bound as `?` — db.sql.query()
    // runs prepared statements (mysql2 execute()), which errors ("Incorrect
    // arguments to mysqld_stmt_execute") binding LIMIT/OFFSET as placeholders
    // against this MySQL setup. Both are clampInt()-validated integers, so
    // inlining is safe (same workaround as getAdsByAdvertiserController.js).
    const rowsPromise = db.sql.query(
      `SELECT sample_keyword_id AS keyword_id, keyword, countries,
              ads_total, advertisers_total, domains_total, growth_pct,
              competition_score, category, sub_category, top_country,
              type_mix, position_top_pct, first_seen, last_seen
       ${baseFrom}
       ORDER BY ${sortBy} ${sortDir}
       LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params
    );

    const [{ total, aggRow }, rawRows] = await Promise.all([statsPromise, rowsPromise]);

    const rows = rawRows.map((r) => {
      const countries = parseCountries(r.countries);
      return { ...r, countries, country: countries[0] || null };
    });

    const stats = {
      keywords: Number(total) || 0,
      avg_competition: aggRow.avg_competition != null ? Math.round(Number(aggRow.avg_competition)) : null,
      total_ad_volume: Number(aggRow.total_ad_volume) || 0,
      trending_up: Number(aggRow.trending_up) || 0,
      trending_down: Number(aggRow.trending_down) || 0,
    };

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
