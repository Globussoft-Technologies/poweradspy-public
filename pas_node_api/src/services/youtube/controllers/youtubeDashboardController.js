'use strict';

/**
 * YouTube monitoring-dashboard READ API — additive, read-only, unguarded (same convention as
 * the GDN dashboard routes). Every number comes from the youtube_ads_data ES index so the
 * monitoring dashboard (dashboard.py) reads via API, never directly from the DB/ES.
 *
 *   GET /api/v1/youtube/dashboard/overview  -> totals, ad_type/position split, search-visibility,
 *                                              redirect-chain coverage
 *   GET /api/v1/youtube/dashboard/live      -> last N ads crawled (feed) + rolling activity counts
 *
 * YouTube has no crawl_quality table (unlike GDN); the "URLs crawled" feed is the most-recently
 * inserted/updated ads (by last_seen), which is what the crawler emits in real time.
 */

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const nowSec = () => Math.floor(Date.now() / 1000);
const hitsOf = (r) => r.hits || (r.body && r.body.hits) || {};
const aggsOf = (r) => r.aggregations || (r.body && r.body.aggregations) || {};
const totalOf = (r) => { const t = hitsOf(r).total; return typeof t === 'object' ? num(t && t.value) : num(t); };

// search-visibility gate (mirror of SearchMixQueryBuilder EXTRA_CONDITION)
const VD = ['VIDEO', 'DISCOVERY'];
const THUMB_PLACE = ['pasvideo', 'pasimage', 'bydefault', 'DefaultImage'].map((p) => ({ wildcard: { 'thumbnail_url.keyword': { value: `*${p}*` } } }));
const NAS_PLACE = ['pasvideo', 'pasimage', 'bydefault'].map((p) => ({ wildcard: { 'new_nas_image_url.keyword': { value: `*${p}*` } } }));
const FINDABLE = { bool: { should: [
  { bool: { filter: [{ terms: { 'ad_type.keyword': VD } }, { exists: { field: 'thumbnail_url' } }], must_not: THUMB_PLACE } },
  { bool: { filter: [{ exists: { field: 'new_nas_image_url' } }], must_not: [{ terms: { 'ad_type.keyword': VD } }, ...NAS_PLACE] } },
], minimum_should_match: 1 } };
const HAS_REDIRECT = { bool: { filter: [{ exists: { field: 'redirect_urls' } }], must_not: [{ term: { 'redirect_urls.keyword': '' } }] } };

async function esCount(db, query) {
  const r = await db.elastic.search({ index: db.elastic.indexName, body: { size: 0, track_total_hits: true, query } });
  return totalOf(r);
}

async function getOverview(req, db, logger) {
  if (!db || !db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };
  try {
    const now = nowSec();
    const aggRes = await db.elastic.search({ index: db.elastic.indexName, body: {
      size: 0, track_total_hits: true, query: { match_all: {} },
      aggs: {
        by_type: { terms: { field: 'ad_type.keyword', size: 15 } },
        by_position: { terms: { field: 'ad_position.keyword', size: 15 } },
      },
    } });
    const total = totalOf(aggRes);
    const aggs = aggsOf(aggRes);
    const by_type = ((aggs.by_type && aggs.by_type.buckets) || []).map((b) => ({ type: b.key || '(none)', count: num(b.doc_count) }));
    const by_position = ((aggs.by_position && aggs.by_position.buckets) || []).map((b) => ({ position: b.key || '(none)', count: num(b.doc_count) }));
    const [ads_1h, ads_24h, findable, withChain] = await Promise.all([
      esCount(db, { range: { last_seen: { gte: now - 3600 } } }),
      esCount(db, { range: { last_seen: { gte: now - 86400 } } }),
      esCount(db, FINDABLE),
      esCount(db, HAS_REDIRECT),
    ]);
    return { code: 200, data: {
      totals: { total, ads_1h, ads_24h, findable, shown_pct: total ? Number((100 * findable / total).toFixed(1)) : 0 },
      redirect_chain: { with_chain: withChain, pct: total ? Number((100 * withChain / total).toFixed(2)) : 0 },
      by_type, by_position,
    } };
  } catch (e) {
    if (logger && logger.error) logger.error('youtube dashboard/overview failed', { error: e.message });
    return { code: 500, message: e.message };
  }
}

async function getLive(req, db, logger) {
  if (!db || !db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };
  try {
    const now = nowSec();
    const limit = Math.min(parseInt((req.query && req.query.limit), 10) || 250, 500);
    const res = await db.elastic.search({ index: db.elastic.indexName, body: {
      size: limit, sort: [{ last_seen: { order: 'desc' } }, { ad_id: 'desc' }],
      _source: ['ad_id', 'ad_type', 'ad_position', 'post_owner', 'destination_url', 'redirect_urls', 'last_seen', 'first_seen', 'source'],
      query: { match_all: {} },
    } });
    const pages = (hitsOf(res).hits || []).map((h) => {
      const s = h._source || {};
      const rv = s.redirect_urls;
      const hops = Array.isArray(rv) ? rv.length : (rv ? 1 : 0);
      return {
        ts: num(s.last_seen), ad_id: s.ad_id, ad_type: s.ad_type || '', ad_position: s.ad_position || '',
        advertiser: s.post_owner || '—', url: s.destination_url || '', hops,
        first_seen: num(s.first_seen), source: Array.isArray(s.source) ? s.source.join(',') : (s.source || ''),
      };
    });
    const [ads_1h, ads_3h, ads_24h] = await Promise.all([
      esCount(db, { range: { last_seen: { gte: now - 3600 } } }),
      esCount(db, { range: { last_seen: { gte: now - 10800 } } }),
      esCount(db, { range: { last_seen: { gte: now - 86400 } } }),
    ]);
    const lastTs = pages.length ? pages[0].ts : null;
    const running = !!(lastTs && (now - lastTs) < 300);
    return { code: 200, data: {
      live: { status: running ? 'running' : 'idle', ads_1h, ads_3h, ads_24h, last_ts: lastTs },
      pages,
    } };
  } catch (e) {
    if (logger && logger.error) logger.error('youtube dashboard/live failed', { error: e.message });
    return { code: 500, message: e.message };
  }
}

module.exports = { getOverview, getLive };
