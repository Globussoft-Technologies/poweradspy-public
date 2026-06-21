'use strict';

/**
 * Creative-scoring controller — AI creative-quality scores on ad docs.
 *
 * The scorer is the Claude Code harness itself (an hourly cron, running on
 * Sonnet), NOT a separate Claude API key. It pulls a batch of un-scored ads with
 * their creative image URLs, reads + scores each, and writes the scores back onto
 * the ad's Elasticsearch doc. Two endpoints, NO JWT — internal/scorer, mirroring
 * the keyword-search/work pattern. Write path mirrors interestBehaviourController
 * (ES search by idField -> es.update doc fields).
 *
 *   GET  /api/v1/common/creative-score/unscored?network=<net>&limit=N
 *        -> up to N ads with NO creative_total_score yet, each with candidate
 *           fetchable image URLs (+ es_doc_id so store can skip the re-search).
 *
 *   POST /api/v1/common/creative-score/store
 *        { network, ad_id, es_doc_id?, scored_by?, scores: {
 *            predicted_ctr/100, hook_score/10, hold_score/10,
 *            hook_total/100, hold_total/100, total_score/100, rationale } }
 *        -> writes the creative_* fields onto the ad doc (and marks it scored,
 *           so /unscored no longer returns it).
 *
 * Networks: youtube, gdn, native, facebook, instagram. ES map verified via
 * src/config/networks.js + the per-network insertion pipelines. CAVEATS:
 *  - native uses 'native_search_mix_v2' (the live serving index; the old
 *    native_search_mix was retired in the 2026-06 cleanup) — override with CREATIVE_NATIVE_INDEX.
 *  - creatives that are NAS *paths* (not http URLs) are skipped by /unscored
 *    until a NAS base is configured; only fetchable http(s) images are returned.
 */

const serviceRegistry = require('../../ServiceRegistry');
const networks = require('../../../config/networks');
const config = require('../../../config');

// NAS/CDN base that turns a stored NAS path into a fetchable URL (config.json cdn.baseUrl
// or CDN_BASE_URL env; e.g. https://media.globussoft.com/pas-prod/stream).
const CDN_BASE = ((config && config.cdn && config.cdn.baseUrl) || process.env.CDN_BASE_URL || '').replace(/\/+$/, '');

// Turn a stored creative value into a fetchable http(s) URL. Already-http values pass
// through (youtube). NAS-relative paths get their mount prefix stripped and the CDN base
// prepended (mirrors GDN/_img_check.py served() + the FE resolveNasUrl). NOTE: the CDN 403s
// a non-browser User-Agent, so the fetcher (cron) MUST send a browser UA (or use /image-proxy).
function served(v) {
  if (!v || typeof v !== 'string') return v;
  if (/^https?:\/\//i.test(v)) return v;
  if (!CDN_BASE) return v;
  const t = v.replace(/^\/?(PowerAdspy\/n2|PowerAdspy-Dev|pas-dev\/stream|pas-prod\/stream)\//i, '/');
  return CDN_BASE + (t.startsWith('/') ? t : '/' + t);
}

// idField + candidate creative image fields per network. The ES INDEX itself comes
// from the shared `networks` config (config.json -> env -> default) so it stays
// staging/prod-aware automatically (e.g. gdn -> gdn_search_mix on staging,
// gdn_search_mix_v2 on prod; native -> whatever config.json says, avoiding the _v2 404).
const FIELD_CONFIG = {
  youtube:   { idField: 'ad_id',           images: ['new_nas_image_url', 'ad_image_or_video', 'ad_image', 'thumbnail_url', 'ad_url'] },
  gdn:       { idField: 'gdn_ad.id',       images: ['new_nas_image_url', 'gdn_ad.new_nas_image_url', 'gdn_ad_variants.image_url', 'gdn_ad.ad_image'] },
  native:    { idField: 'native_ad.id',    indexOverride: process.env.CREATIVE_NATIVE_INDEX || 'native_search_mix_v2', images: ['native_ad.nas_url', 'native_ad.new_nas_image_url', 'native_ad_variants.image_url'] },
  facebook:  { idField: 'facebook_ad.id',  images: ['new_nas_image_url', 'facebook_ad.s3_path', 'facebook_ad.image_url', 'facebook_ad.Thumbnail'] },
  instagram: { idField: 'instagram_ad.id', images: ['new_nas_image_url', 'instagram_ad.s3_path', 'instagram_ad_variants.image_url'] },
};
const SUPPORTED = Object.keys(FIELD_CONFIG);

// Resolve {index, idField, images} for a network — index from the shared networks config.
function cfgFor(net) {
  const fc = FIELD_CONFIG[net];
  if (!fc) return null;
  // indexOverride wins (e.g. native lives in native_search_mix, not the _v2 the shared
  // config resolves to); else use the shared networks config (staging/prod-aware).
  const index = fc.indexOverride || (networks[net] && networks[net].database && networks[net].database.elastic && networks[net].database.elastic.index);
  return index ? { index, idField: fc.idField, images: fc.images } : null;
}

// ES 6.8 needs an explicit doc type; 7+/8 reject it (mirrors interestBehaviour).
function withEsType(es, params, type = 'doc') {
  const m = es && es.esMajor;
  return (m == null || m < 7) ? { ...params, type } : params;
}
function extractHits(r) { return ((r && (r.hits || (r.body && r.body.hits))) || {}).hits || []; }
function getPath(obj, dotted) {
  if (obj == null) return undefined;
  if (obj[dotted] != null) return obj[dotted];                                 // ES often stores dotted fields as FLAT keys (e.g. "native_ad.nas_url")
  return dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);      // else nested traversal
}
function svc(net) {
  const cfg = cfgFor(net);
  const s = serviceRegistry.getService(net);
  return { cfg, es: s && s.db && s.db.elastic };
}

// GET /creative-score/unscored?network=youtube&limit=10
async function unscoredCreatives(req, res) {
  const net = String((req.query && req.query.network) || (req.body && req.body.network) || '').toLowerCase().trim();
  const { cfg, es } = svc(net);
  if (!cfg) return res.status(400).json({ code: 400, message: `network must be one of: ${SUPPORTED.join(', ')}` });
  if (!es)  return res.status(503).json({ code: 503, message: `Elasticsearch not available for "${net}"` });

  let limit = parseInt((req.query && req.query.limit) || (req.body && req.body.limit) || 10, 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 10;
  limit = Math.min(limit, 100);

  try {
    const result = await es.search({
      index: cfg.index,
      size: limit,
      body: {
        query: { bool: { must_not: [{ exists: { field: 'creative_total_score' } }] } },
        sort: [{ [cfg.idField]: { order: 'desc' } }], // newest ids first
        // Full _source: some indices (native) store dotted fields as FLAT keys that a
        // `_source` includes filter won't return; getPath handles both flat + nested.
      },
    });
    const data = extractHits(result).map((h) => {
      const src = h._source || {};
      const images = [...new Set(cfg.images
        .map((f) => served(getPath(src, f)))
        .filter((v) => typeof v === 'string' && /^https?:\/\//i.test(v)))];
      return { ad_id: getPath(src, cfg.idField), network: net, es_doc_id: h._id, images };
    }).filter((a) => a.images.length); // only ads we can actually fetch a creative for

    return res.status(200).json({ code: 200, network: net, count: data.length, data });
  } catch (err) {
    if (/index_not_found/i.test(err.message || '')) {
      return res.status(200).json({ code: 200, network: net, count: 0, data: [], note: `index ${cfg.index} not found` });
    }
    return res.status(500).json({ code: 500, message: err.message });
  }
}

// POST /creative-score/store  { network, ad_id, es_doc_id?, scored_by?, scores:{...} }
async function storeCreativeScore(req, res) {
  const b = req.body || {};
  const net = String(b.network || '').toLowerCase().trim();
  const { cfg, es } = svc(net);
  if (!cfg) return res.status(400).json({ code: 400, message: `network must be one of: ${SUPPORTED.join(', ')}` });
  if (!es)  return res.status(503).json({ code: 503, message: `Elasticsearch not available for "${net}"` });

  const id = b.ad_id != null ? b.ad_id : b.adId;
  if (id == null || id === '') return res.status(400).json({ code: 400, message: 'ad_id is required' });

  const sc = b.scores || {};
  const doc = {
    creative_predicted_ctr:   Number(sc.predicted_ctr),
    creative_hook_score:      Number(sc.hook_score),
    creative_hold_score:      Number(sc.hold_score),
    creative_hook_total:      Number(sc.hook_total),
    creative_hold_total:      Number(sc.hold_total),
    creative_total_score:     Number(sc.total_score),
    creative_score_rationale: String(sc.rationale || '').slice(0, 1000),
    creative_scored_at:       new Date().toISOString(),
    creative_scored_by:       String(b.scored_by || 'claude-sonnet'),
  };
  if (!Number.isFinite(doc.creative_total_score)) {
    return res.status(400).json({ code: 400, message: 'scores.total_score must be a number (0-100)' });
  }

  try {
    let esDocId = b.es_doc_id;
    if (!esDocId) {
      const r = await es.search({ index: cfg.index, body: { query: { term: { [cfg.idField]: isNaN(Number(id)) ? id : Number(id) } } } });
      const hits = extractHits(r);
      if (!hits.length) return res.status(404).json({ code: 404, message: 'ad not found' });
      esDocId = hits[0]._id;
    }
    await es.update(withEsType(es, { index: cfg.index, id: esDocId, body: { doc } }));
    return res.status(200).json({ code: 200, message: 'creative score stored', network: net, ad_id: id });
  } catch (err) {
    return res.status(500).json({ code: 500, message: err.message });
  }
}

// ─── Cron run reports (operational monitoring for the admin; separate ES index) ───
const RUNS_INDEX = process.env.CREATIVE_RUNS_INDEX || 'creative_scorer_runs';
function runsEs() {
  const s = serviceRegistry.getService('youtube') || serviceRegistry.getService('gdn');
  return s && s.db && s.db.elastic;
}

// POST /creative-score/run-report  { run_at?, scored_by?, duration_sec?, networks:{...}, total_scored, total_skipped, total_errors, api_ok, status }
async function storeRunReport(req, res) {
  const b = req.body || {};
  const es = runsEs();
  if (!es) return res.status(503).json({ code: 503, message: 'Elasticsearch not available' });
  const doc = {
    run_at:        b.run_at || new Date().toISOString(),
    scored_by:     String(b.scored_by || 'claude-sonnet'),
    duration_sec:  Number.isFinite(Number(b.duration_sec)) ? Number(b.duration_sec) : null,
    networks:      (b.networks && typeof b.networks === 'object') ? b.networks : {},
    total_scored:  Number(b.total_scored) || 0,
    total_skipped: Number(b.total_skipped) || 0,
    total_errors:  Number(b.total_errors) || 0,
    api_ok:        b.api_ok !== false,
    status:        String(b.status || 'success'),
    created_at:    new Date().toISOString(),
  };
  try {
    await es.index(withEsType(es, { index: RUNS_INDEX, body: doc }));
    return res.status(200).json({ code: 200, message: 'run report stored' });
  } catch (err) {
    return res.status(500).json({ code: 500, message: err.message });
  }
}

// GET /creative-score/run-report?limit=N  -> recent runs + an all-time summary (for the admin)
async function getRunReports(req, res) {
  const es = runsEs();
  if (!es) return res.status(503).json({ code: 503, message: 'Elasticsearch not available' });
  let limit = parseInt((req.query && req.query.limit) || 50, 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  limit = Math.min(limit, 500);
  try {
    const r = await es.search({
      index: RUNS_INDEX,
      size: limit,
      body: {
        query: { match_all: {} },
        sort: [{ run_at: { order: 'desc' } }],
        aggs: {
          all_scored:  { sum: { field: 'total_scored' } },
          all_skipped: { sum: { field: 'total_skipped' } },
          all_errors:  { sum: { field: 'total_errors' } },
        },
      },
    });
    const body = (r && r.body) ? r.body : r;
    const runs = extractHits(r).map((h) => ({ _id: h._id, ...(h._source || {}) }));
    const aggs = (body && body.aggregations) || {};
    const tot  = body && body.hits && body.hits.total;
    const totalRuns = (tot && typeof tot === 'object') ? tot.value : (tot != null ? tot : runs.length);
    const last = runs[0] || null;
    const recentMs = last ? (Date.now() - new Date(last.run_at).getTime()) : null;
    return res.status(200).json({
      code: 200,
      summary: {
        total_runs:             totalRuns,
        total_processed:        Math.round(((aggs.all_scored && aggs.all_scored.value) || 0) + ((aggs.all_skipped && aggs.all_skipped.value) || 0)),
        total_scored_all_time:  Math.round((aggs.all_scored && aggs.all_scored.value) || 0),
        total_skipped_all_time: Math.round((aggs.all_skipped && aggs.all_skipped.value) || 0),
        total_errors_all_time:  Math.round((aggs.all_errors && aggs.all_errors.value) || 0),
        last_run_at:            last ? last.run_at : null,
        last_status:            last ? last.status : null,
        api_ok:                 last ? (last.api_ok !== false) : null,
        // healthy = last run was OK AND recent (< 20 min) -> the cron + API are alive
        api_healthy:            last ? (last.api_ok !== false && recentMs != null && recentMs < 20 * 60 * 1000) : false,
        minutes_since_last_run: recentMs != null ? Math.round(recentMs / 60000) : null,
      },
      runs,
    });
  } catch (err) {
    if (/index_not_found/i.test(err.message || '')) {
      return res.status(200).json({ code: 200, summary: { total_runs: 0, total_scored_all_time: 0, api_healthy: false, note: 'no runs recorded yet' }, runs: [] });
    }
    return res.status(500).json({ code: 500, message: err.message });
  }
}

module.exports = { unscoredCreatives, storeCreativeScore, storeRunReport, getRunReports, SUPPORTED_NETWORKS: SUPPORTED };
