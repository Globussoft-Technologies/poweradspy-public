require('dotenv').config();
const http = require('http');
const https = require('https');

/**
 * TikTok Elasticsearch connection.
 *
 * TikTok lives on a SEPARATE cluster running ES 8.x (see config: TT_ELASTIC_NODE),
 * which the legacy `elasticsearch` v16 client used by es-connections/connection.js
 * cannot talk to. Rather than add a second client library, this is a tiny
 * dependency-free transport over the ES REST API (`_count` / `_search`) — those
 * endpoints are version-stable, so the same code works against 6.x/7.x/8.x.
 *
 * Exposes the SAME signature + return shape as es-connections/connection.js
 * (searchAllInstances), so it can be dropped in as `cfg.es.transport` for the
 * shared ads-audit engine:
 *     tiktokSearch(index, body, esId, mode) -> { node, type, data }
 *       mode 'count'  → data = hit count (number)
 *       mode 'search' → data = full ES response body (has .hits, .aggregations)
 *
 * Config (admin .env), mirroring pas_node_api's elastic_tiktok block:
 *     TT_ELASTIC_NODE      e.g. http://92.4.92.86:9200
 *     TT_ELASTIC_USERNAME  e.g. elastic
 *     TT_ELASTIC_PASSWORD
 *     TT_ELASTIC_INDEX     e.g. tiktok_ads
 */

const TT_NODE = process.env.TT_ELASTIC_NODE || '';
const TT_USER = process.env.TT_ELASTIC_USERNAME || 'elastic';
const TT_PASS = process.env.TT_ELASTIC_PASSWORD || '';
const TT_INDEX = process.env.TT_ELASTIC_INDEX || 'tiktok_ads';
const TT_TIMEOUT_MS = parseInt(process.env.TT_ELASTIC_TIMEOUT_MS, 10) || 30000;

function postJson(urlStr, body) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(e); }
    const lib = u.protocol === 'https:' ? https : http;
    const payload = Buffer.from(JSON.stringify(body || {}));
    const auth = 'Basic ' + Buffer.from(`${TT_USER}:${TT_PASS}`).toString('base64');
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
        Authorization: auth,
      },
      timeout: TT_TIMEOUT_MS,
    }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(b)); } catch (e) { reject(new Error(`TikTok ES bad JSON: ${b.slice(0, 200)}`)); }
        } else {
          reject(new Error(`TikTok ES HTTP ${res.statusCode}: ${b.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`TikTok ES request timed out after ${TT_TIMEOUT_MS}ms`)));
    req.write(payload);
    req.end();
  });
}

// Same contract as searchAllInstances: never throws — returns {} on failure so the
// caller's `res.data === undefined` guard turns it into a clean error.
async function tiktokSearch(index, body, _esId, mode) {
  if (!TT_NODE) { console.error('TikTok ES: TT_ELASTIC_NODE is not set'); return {}; }
  const idx = index || TT_INDEX;
  try {
    const endpoint = mode === 'count' ? '_count' : '_search';
    const resp = await postJson(`${TT_NODE}/${idx}/${endpoint}`, body);
    return { node: TT_NODE, type: mode, data: mode === 'count' ? resp.count : resp };
  } catch (err) {
    console.error(`TikTok ES query failed (${mode}) on ${TT_NODE}:`, err.message);
    return {};
  }
}

// Startup health ping (mirrors the other connection modules' console output).
(async () => {
  if (!TT_NODE) { console.warn('⚠️  TikTok Elasticsearch: TT_ELASTIC_NODE not configured'); return; }
  try {
    const c = await tiktokSearch(TT_INDEX, {}, 0, 'count');
    if (c && c.data !== undefined) {
      console.log(`✅ TikTok Elasticsearch connected: ${TT_NODE} (index ${TT_INDEX}, ${c.data} docs)`);
    } else {
      console.error(`❌ TikTok Elasticsearch connection FAILED: ${TT_NODE}`);
    }
  } catch (e) {
    console.error(`❌ TikTok Elasticsearch connection FAILED: ${TT_NODE} — ${e.message}`);
  }
})();

tiktokSearch.postJson = postJson;
module.exports = tiktokSearch;
