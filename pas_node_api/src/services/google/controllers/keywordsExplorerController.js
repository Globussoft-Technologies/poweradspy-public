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

// Unfiltered stat-cards (keywords/advertisers/ad_volume/trending), sourced
// from Elasticsearch instead of MySQL — see 2026-09-22 decision: MySQL's
// AVG(competition_score) always converges to ~50 regardless of underlying
// data (averaging a percentile rank), so it never carried real signal;
// total_advertisers (a real, absolute count) replaces it. Trending is
// redefined too — the old trending_up/trending_down (count of keywords whose
// 30d vs prior-30d activity rose/fell) needed a per-keyword composite-agg
// sweep over the whole ES corpus to compute (same shape as
// jobs/refreshKeywordStats.js's sweep()) — expensive (measured elsewhere in
// this codebase: ~3min at best-tuned settings over an 18mo-scoped subset,
// hours over the full corpus). A single overall ad-volume % change
// (last 30d vs prior 30d) answers "is the market growing or shrinking" with
// one aggregate query instead of a per-keyword sweep, at the cost of no
// longer being a count of individual keywords. "One query" turned out to
// still be slow in absolute terms — see ES_STATS_PRECISION and the
// cache-warming interval below — flat aggs are cheap RELATIVE TO a composite
// sweep, not cheap in an absolute sense at this document count.
//
// Deliberately separate from the MySQL statsCache above — same TTL/eviction
// shape, but a single fixed key since this covers only the one no-filter
// case (a filtered request still uses the MySQL path/cache; translating
// every MySQL filter — volume/competition/category/country/etc. — into ES
// query DSL is out of scope for this change).
const ES_STATS_CACHE_TTL_MS = 2 * 60 * 1000;
let esStatsCache = null; // { expiresAt, value } — single entry, this covers only the no-filter case

// Same "real ads only" scope as the rest of the Google network's ES queries
// (see GoogleSearchQueryBuilder's default must_not): excludes ORGANIC SEARCH
// (not a paid ad) and platform 18 (Google Transparency — a separate crawl
// source from the regular Google Ads corpus this feature is scoped to; kept
// out by explicit product decision, not to match MySQL's scope, which
// currently doesn't filter it — see chat history 2026-09-22).
const ES_ELIGIBLE_AD_FILTER = {
  bool: {
    must_not: [
      { term: { type: 'organic search' } },
      { term: { platform: 18 } },
    ],
  },
};

// precision_threshold — measured directly against production 2026-09-22:
// this query (5 flat cardinality aggs over the whole eligible-ad set, no
// composite bucketing) took 17.6s at precision_threshold=40000. That's the
// "flat aggs are cheap regardless of precision" assumption from this file's
// original comment turning out to be wrong in practice, not just a
// theoretical difference from the composite-sweep case — measuring beats
// reasoning-from-the-code-shape. Lowered to 3000: same reasoning
// refreshKeywordStats.js already uses for its own bulk sweep (a proxy/
// summary count doesn't need HyperLogLog-exact precision), still not
// re-measured against production at this exact value — see the cache-warming
// comment below for why a slow first call no longer reaches a live request
// either way.
const ES_STATS_PRECISION = 3000;

// `force` bypasses the cache-is-still-valid check — used by the warmer
// below, which must actually refresh on its own schedule rather than
// silently no-op'ing because the cache it's trying to keep warm hasn't
// expired yet (it never would, if the warmer just deferred to the same
// check a live request uses).
async function computeEsStats(db, logger, force = false) {
  const cached = esStatsCache;
  if (!force && cached && cached.expiresAt > Date.now()) return cached.value;

  if (!db.elastic) {
    logger?.warn?.('computeEsStats: Elasticsearch unavailable — serving degraded stats');
    return {
      keywords: 0, total_advertisers: null, total_ad_volume: null,
      trending_last_30d: null, trending_prior_30d: null, stale: true,
    };
  }

  try {
    const esIndex = db.elastic.indexName || 'google_ads_data_v2';
    const result = await db.elastic.search({
      index: esIndex,
      body: {
        size: 0,
        track_total_hits: false,
        query: ES_ELIGIBLE_AD_FILTER,
        aggs: {
          // total_keywords/total_advertisers genuinely need a distinct-value
          // count — cardinality is the only way to get that from ES, no
          // cheaper substitute exists.
          total_keywords: { cardinality: { field: 'target_keyword', precision_threshold: ES_STATS_PRECISION } },
          total_advertisers: { cardinality: { field: 'post_owner_lower', precision_threshold: ES_STATS_PRECISION } },
          // total_ad_volume / last_30d / prior_30d were cardinality(id)
          // (deduping the index's ~4% duplicate docs — see
          // helpers/aggregations.js's comment on the same trade-off) but
          // cardinality builds a HyperLogLog sketch per matching doc, which
          // measured as real, non-trivial cost here (17.6s → 14.3s from a
          // 13x precision drop alone — see chat history 2026-09-22,
          // confirming precision wasn't the dominant cost, doc-count was).
          // Switched to plain filter doc_count — accepts ~4% overcounting
          // instead of computing a sketch over tens of millions of docs.
          total_ad_volume: { filter: { match_all: {} } },
          last_30d: { filter: { range: { last_seen: { gte: 'now-30d/d' } } } },
          prior_30d: { filter: { range: { last_seen: { gte: 'now-60d/d', lt: 'now-30d/d' } } } },
        },
      },
    });

    const aggs = result.aggregations || result.body?.aggregations;

    // Raw counts, not a % change — a % off a small prior-30d base swings to
    // extreme, misleading values (3 ads → 0 ads reads as "-100%", which looks
    // like the market collapsed, not like the small sample it is — see chat
    // history 2026-09-22). The frontend renders these two counts as a simple
    // side-by-side bar comparison instead.
    const value = {
      keywords: Number(aggs?.total_keywords?.value) || 0,
      total_advertisers: Number(aggs?.total_advertisers?.value) || 0,
      // doc_count, not cardinality.value — see the aggs definition above.
      total_ad_volume: Number(aggs?.total_ad_volume?.doc_count) || 0,
      trending_last_30d: Number(aggs?.last_30d?.doc_count) || 0,
      trending_prior_30d: Number(aggs?.prior_30d?.doc_count) || 0,
      stale: false,
    };
    esStatsCache = { expiresAt: Date.now() + ES_STATS_CACHE_TTL_MS, value };
    startEsStatsWarmer(db, logger);
    return value;
  } catch (err) {
    logger?.warn?.('computeEsStats: query failed — serving degraded stats', { error: err.message });
    return {
      keywords: 0, total_advertisers: null, total_ad_volume: null,
      trending_last_30d: null, trending_prior_30d: null, stale: true,
    };
  }
}

// Measured against production 2026-09-22: this query takes ~14s even after
// two rounds of optimization (precision, cardinality→doc_count) — the cost
// turned out to be dominated by the base query's match-set size (tens of
// millions of docs on a single-node, 22-shard cluster), not by the
// aggregations layered on top, so it will only get slower as more ads get
// crawled/indexed over time. A live user request must never be the thing
// that pays that cost, at any point in that growth.
//
// setTimeout + reschedule-after-completion (NOT setInterval) is deliberate:
// setInterval fires on a fixed clock regardless of whether the previous call
// finished, so the day this query takes longer than the interval — which
// WILL happen as the corpus grows, per the paragraph above — two warm
// cycles would start overlapping, each running its own expensive ES query
// at once, doubling load on the cluster at exactly the moment it's already
// struggling. Scheduling the next cycle only after the current one
// completes means cadence naturally stretches out as the query gets slower,
// instead of piling up concurrent calls.
const ES_STATS_WARM_INTERVAL_MS = 90 * 1000;
// Logged, not enforced — an early-warning signal (in logs/monitoring) that
// this query's cost is approaching the cache TTL, well before it would
// actually cause a live request to see a cold cache.
const ES_STATS_WARM_SLOW_WARN_MS = 60 * 1000;
let esStatsWarmerStarted = false;

function scheduleEsStatsWarm(db, logger) {
  const timer = setTimeout(async () => {
    const startedAt = Date.now();
    try {
      await computeEsStats(db, logger, true);
    } finally {
      const durationMs = Date.now() - startedAt;
      if (durationMs > ES_STATS_WARM_SLOW_WARN_MS) {
        logger?.warn?.(`computeEsStats warm refresh took ${durationMs}ms — approaching cache TTL (${ES_STATS_CACHE_TTL_MS}ms) as the corpus grows`);
      }
      scheduleEsStatsWarm(db, logger);
    }
  }, ES_STATS_WARM_INTERVAL_MS);
  timer.unref();
}

function startEsStatsWarmer(db, logger) {
  if (esStatsWarmerStarted) return;
  esStatsWarmerStarted = true;
  scheduleEsStatsWarm(db, logger);
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

  // Tracks whether any USER-CHOSEN filter is active (not the always-on
  // data-quality filters below) — the unfiltered/default view's stat-cards
  // are sourced from Elasticsearch (see computeEsStats above); a filtered
  // request keeps using the live MySQL aggregate, since translating every
  // filter here into ES query DSL is out of scope for this change.
  let hasOptionalFilter = false;

  if (hasValue(p.volume_min)) { where.push('ksu.ads_total >= ?'); params.push(Number(p.volume_min) || 0); hasOptionalFilter = true; }
  if (hasValue(p.volume_max)) { where.push('ksu.ads_total <= ?'); params.push(Number(p.volume_max) || 0); hasOptionalFilter = true; }
  if (hasValue(p.competition_min)) { where.push('ksu.competition_score >= ?'); params.push(Number(p.competition_min) || 0); hasOptionalFilter = true; }
  if (hasValue(p.competition_max)) { where.push('ksu.competition_score <= ?'); params.push(Number(p.competition_max) || 0); hasOptionalFilter = true; }
  if (hasValue(p.growth_min)) { where.push('ksu.growth_pct >= ?'); params.push(Number(p.growth_min) || 0); hasOptionalFilter = true; }
  if (hasValue(p.growth_max)) { where.push('ksu.growth_pct <= ?'); params.push(Number(p.growth_max) || 0); hasOptionalFilter = true; }
  if (p.category) { where.push('ksu.category = ?'); params.push(p.category); hasOptionalFilter = true; }
  if (p.country) { where.push('JSON_CONTAINS(ksu.countries, JSON_QUOTE(?))'); params.push(p.country); hasOptionalFilter = true; }
  if (p.include) { where.push('ksu.keyword LIKE ?'); params.push(`%${p.include}%`); hasOptionalFilter = true; }
  if (p.exclude) { where.push('ksu.keyword NOT LIKE ?'); params.push(`%${p.exclude}%`); hasOptionalFilter = true; }

  // Always-on garbage filter — not a user-facing filter, a data-quality floor.
  // Two junk patterns observed in production: (1) mojibake — a keyword that's
  // mostly literal '?' characters (an upstream charset/encoding conversion
  // failure replaced real characters with '?', e.g. "?????? ?????????"), and
  // (2) mangled URL/domain fragments starting with a literal '.' (e.g.
  // ".business.site roof north carolina") — never a real search term a human
  // typed. Both patterns only ever showed ads_total:1 with every other column
  // empty — single stray crawl artifacts, not real keywords. Conservative on
  // purpose: only excludes keyword text no legitimate search term could ever
  // take, never touches volume/recency, so it can't hide a real low-volume
  // keyword.
  where.push("ksu.keyword NOT LIKE '.%'");
  where.push("(LENGTH(ksu.keyword) - LENGTH(REPLACE(ksu.keyword, '?', ''))) < LENGTH(REPLACE(ksu.keyword, ' ', '')) * 0.5");
  // Some keywords have first_seen populated, some don't (varies per row, not
  // tied to keyword-text quality — e.g. "verisure"/"top mba college" are real
  // keywords but only some rows carry a date) — a row with no first_seen is
  // an incomplete rollup entry, not a useful browse result. Hide it rather
  // than showing a blank date.
  where.push('ksu.first_seen IS NOT NULL');
  if (p.first_seen_after) { where.push('ksu.first_seen >= ?'); params.push(p.first_seen_after); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const baseFrom = `FROM keyword_stats_unique ksu ${whereSql}`;

  try {
    // total/stats depend only on the FILTER (whereSql+params), not on page/sort —
    // cache them so paging through the same filtered view doesn't re-run both
    // aggregates on every page click. The row query below is independent of
    // both and always runs fresh, in parallel with the (cached-or-not) stats
    // lookup, instead of the three queries running one after another.
    //
    // `total` (pagination count) always comes from MySQL — the row list
    // itself is still MySQL-driven regardless of stats source, so paging
    // must stay consistent with what keyword_stats_unique actually has.
    // `stats` (the 4 cards) branches: a filtered request keeps the MySQL
    // aggregate (translating every filter to ES query DSL is out of scope —
    // see computeEsStats' comment above); the unfiltered/default view is
    // sourced from Elasticsearch instead.
    const cacheKey = statsCacheKey(whereSql, params);
    const cached = getCachedStats(cacheKey);

    const statsPromise = cached
      ? Promise.resolve(cached)
      : (hasOptionalFilter
          ? Promise.all([
              db.sql.query(`SELECT COUNT(*) AS total ${baseFrom}`, params),
              db.sql.query(
                `SELECT SUM(advertisers_total) AS total_advertisers,
                        SUM(ads_total)         AS total_ad_volume,
                        SUM(ads_30d)           AS ads_30d_sum,
                        SUM(ads_prior_30d)     AS ads_prior_30d_sum
                 ${baseFrom}`,
                params
              ),
            ]).then(([[{ total } = { total: 0 }], [aggRow = {}]]) => {
              const value = {
                total,
                stats: {
                  keywords: Number(total) || 0,
                  total_advertisers: Number(aggRow.total_advertisers) || 0,
                  total_ad_volume: Number(aggRow.total_ad_volume) || 0,
                  trending_last_30d: Number(aggRow.ads_30d_sum) || 0,
                  trending_prior_30d: Number(aggRow.ads_prior_30d_sum) || 0,
                  stale: false,
                },
              };
              setCachedStats(cacheKey, value);
              return value;
            })
          : Promise.all([
              db.sql.query(`SELECT COUNT(*) AS total ${baseFrom}`, params),
              computeEsStats(db, logger),
            ]).then(([[{ total } = { total: 0 }], esStats]) => {
              const value = { total, stats: esStats };
              // Only cache when ES actually answered — a transient ES failure
              // shouldn't get pinned as "the" stats for the next 2 minutes.
              if (!esStats.stale) setCachedStats(cacheKey, value);
              return value;
            })
        );

    // LIMIT/OFFSET are inlined below rather than bound as `?` — db.sql.query()
    // runs prepared statements (mysql2 execute()), which errors ("Incorrect
    // arguments to mysqld_stmt_execute") binding LIMIT/OFFSET as placeholders
    // against this MySQL setup. Both are clampInt()-validated integers, so
    // inlining is safe (same workaround as getAdsByAdvertiserController.js).
    // `keyword_stats_unique.sample_keyword_id` was dropped from the table
    // (2026-09-23) — keyword_id (a real google_text_keywords.id, needed by
    // Keyword Lists' add/remove, which stores it as an int FK — the keyword
    // TEXT alone isn't enough there) is now resolved with a correlated
    // subquery instead. Bounded to just this page's rows (LIMIT above), not
    // the whole table, same "cheap because it only runs against an
    // already-limited result set" reasoning as keywordIdeasController.js's
    // display-only joins. No LOWER()/TRIM() wrap on either side of the
    // match — ksu.keyword is already lowercased/trimmed at write time, and
    // google_text_keywords.keyword's collation is case-insensitive already;
    // wrapping either side in a function would defeat the index (measured
    // elsewhere in this codebase: an 80.7s/page vs 46ms/page difference from
    // exactly this).
    const rowsPromise = db.sql.query(
      `SELECT (SELECT MIN(gtk.id) FROM google_text_keywords gtk WHERE gtk.keyword = ksu.keyword) AS keyword_id,
              keyword, countries,
              ads_total, advertisers_total, domains_total, growth_pct,
              competition_score, category, sub_category, top_country,
              type_mix, position_top_pct, first_seen, last_seen
       ${baseFrom}
       ORDER BY ${sortBy} ${sortDir}
       LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params
    );

    const [{ total, stats }, rawRows] = await Promise.all([statsPromise, rowsPromise]);

    const rows = rawRows.map((r) => {
      const countries = parseCountries(r.countries);
      return { ...r, countries, country: countries[0] || null };
    });

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
