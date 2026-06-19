'use strict';

/**
 * Interest / Behaviour controller — populates the audience-targeting fields
 * (`interests`, `behaviors`, `confidence_score`) on ad documents in each
 * network's search_mix Elasticsearch index.
 *
 * Node port of the Laravel endpoints:
 *   - adsDataController@storeBahaviourData         (Facebook)
 *   - InstagramUserController@storeBahaviourData   (Instagram)
 *   - adsDataController@insertInterestBahaviour     (Facebook batch puller)
 *   - InstagramUserController@insertInterestBahaviour (Instagram batch puller)
 *
 * Two endpoints, both network-aware via a `network` param (facebook | instagram):
 *
 *   POST /api/v1/common/store-bahaviour-data
 *     Push interests/behaviors/confidence_score for ONE ad. Write-once: only
 *     fields that don't already exist on the doc are written (mirrors PHP).
 *     Body: { adId | ad_id, network?, interestBehaviour: { interests, behaviors, confidence_score } }
 *
 *   GET /api/v1/common/insert-interest-behaviour?network=facebook
 *     Batch puller (cron). Reads the next 10 ad ids (last_seen within 6 months,
 *     id > checkpoint) from the network's `<net>_ad` SQL table, fetches each ad's
 *     targeting data from the external INTEREST_BEHAVIOUR service, and backfills
 *     the missing fields in ES. Checkpoint persisted to data/interestBehaviour.<net>.txt.
 *
 * The read side (surfacing these fields to the frontend "Target Audience" panel)
 * already lives in {facebook,instagram}/controllers/adDetailController.js.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const serviceRegistry = require('../../ServiceRegistry');

// Per-network ES + SQL mapping. The network param is validated against these
// keys, so the (non-parameterizable) SQL table name below is always safe.
const NETWORK_CONFIG = {
  facebook: {
    service:  'facebook',
    index:    process.env.FB_ELASTIC_INDEX || process.env.FB_ES_INDEX || 'search_mix',
    idField:  'facebook_ad.id',
    table:    'facebook_ad',
    platformProd: 'facebook_prod',
    platformDev:  'facebook_dev',
  },
  instagram: {
    service:  'instagram',
    index:    process.env.IG_ES_INDEX || 'instagram_search_mix',
    idField:  'instagram_ad.id',
    table:    'instagram_ad',
    platformProd: 'instagram_prod',
    platformDev:  'instagram_dev',
  },
};

const SUPPORTED_NETWORKS = Object.keys(NETWORK_CONFIG);

const BATCH_SIZE = 10;
const LOOKBACK_MONTHS = 6;
const EXTERNAL_TIMEOUT_MS = 15000;

/**
 * Add an explicit mapping `type` only on ES 6.x. The ES7 client defaults to
 * typeless write URLs; a 6.8 server rejects those, while 7+/8 rejects an
 * explicit type. Mirrors addCategoryController.withEsType. When the version is
 * unknown we fall back to the 6.x-safe form (most clusters here are 6.8), which
 * also matches the PHP `'type' => 'doc'`.
 */
function withEsType(esConn, params, typeName = 'doc') {
  const major = esConn?.esMajor;
  if (major == null || major < 7) {
    return { ...params, type: typeName };
  }
  return params;
}

// ES hits live at result.hits.hits (v8 client) or result.body.hits.hits (v7).
function extractHits(result) {
  return (result?.hits || result?.body?.hits)?.hits || [];
}

// "prod" platform tag when running in production, else "dev". Honours both the
// PHP convention (APP_ENV === 'main') and the Node convention (NODE_ENV).
function isProdEnv() {
  return process.env.APP_ENV === 'main' || process.env.NODE_ENV === 'production';
}

function resolveNetwork(req) {
  const raw = (req.body?.network || req.query?.network || req.headers?.platform || 'facebook');
  return String(raw).toLowerCase().trim();
}

/**
 * Build the ES update for the missing audience fields, given the existing
 * `_source`. Returns {} when nothing needs writing (write-once semantics —
 * existing non-empty values are never overwritten). Mirrors the PHP guards.
 */
function buildMissingFields(source, { interests, behaviors, confidenceScore }, { requireNonEmpty = false } = {}) {
  const updateFields = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(source, k);

  if (!has('interests') && (!requireNonEmpty || (Array.isArray(interests) ? interests.length : interests))) {
    updateFields.interests = interests;
  }
  if (!has('behaviors') && (!requireNonEmpty || (Array.isArray(behaviors) ? behaviors.length : behaviors))) {
    updateFields.behaviors = behaviors;
  }
  // confidence_score is only handled by the push endpoint (not the puller, which
  // mirrors PHP insertInterestBahaviour that ignores confidence_score).
  if (!requireNonEmpty) {
    const confExists = has('confidence_score');
    const confValue = confExists ? source.confidence_score : null;
    if (!confExists || confValue === null || confValue === 0) {
      updateFields.confidence_score = confidenceScore;
    }
  }
  return updateFields;
}

/**
 * POST /store-bahaviour-data
 *
 * Push audience-targeting data for a single ad into the network's search_mix
 * index. Only writes fields that are not already present (write-once).
 */
async function storeBehaviourData(req, res) {
  const network = resolveNetwork(req);
  const cfg = NETWORK_CONFIG[network];
  if (!cfg) {
    return res.status(400).json({ code: 400, message: `Unsupported network "${network}". Supported: ${SUPPORTED_NETWORKS.join(', ')}` });
  }

  const id = req.body?.adId ?? req.body?.ad_id;
  if (id === undefined || id === null || id === '') {
    return res.status(400).json({ code: 400, message: 'adId is required' });
  }

  const ib = req.body?.interestBehaviour || {};
  const payload = {
    interests:       ib.interests ?? [],
    behaviors:       ib.behaviors ?? [],
    confidenceScore: ib.confidence_score ?? null,
  };

  const service = serviceRegistry.getService(cfg.service);
  if (!service?.db?.elastic) {
    return res.status(503).json({ code: 503, message: `Elasticsearch is not available for network "${network}"` });
  }
  const es = service.db.elastic;

  try {
    const result = await es.search({
      index: cfg.index,
      body: { query: { term: { [cfg.idField]: Number(id) } } },
    });

    const hits = extractHits(result);
    if (hits.length === 0) {
      return res.status(404).json({ code: 404, message: 'ad not found' });
    }

    const doc = hits[0];
    const updateFields = buildMissingFields(doc._source || {}, payload);

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ code: 400, message: 'Fields already exist, no update needed.' });
    }

    await es.update(withEsType(es, {
      index: cfg.index,
      id: doc._id,
      body: { doc: updateFields },
    }));

    return res.status(200).json({ code: 200, message: 'Fields added successfully' });
  } catch (err) {
    service.log?.error(`[storeBehaviourData] network=${network} id=${id} error: ${err.message}`);
    return res.status(500).json({ code: 500, message: 'Error occurred in storeBehaviourData function', error: err.message });
  }
}

// ─── Batch puller checkpoint (file-based, mirrors PHP storage_path) ──────────
function checkpointPath(network) {
  return path.resolve(process.cwd(), 'data', `interestBehaviour.${network}.txt`);
}

function readCheckpoint(network) {
  try {
    const raw = fs.readFileSync(checkpointPath(network), 'utf-8').trim();
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeCheckpoint(network, lastId) {
  const file = checkpointPath(network);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(lastId), 'utf-8');
}

// "YYYY-MM-DD HH:mm:ss" for N months ago (local), to match the SQL datetime column.
function monthsAgoDatetime(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * GET /insert-interest-behaviour?network=facebook
 *
 * Batch puller: claim the next BATCH_SIZE ad ids past the checkpoint, fetch
 * each ad's targeting data from the external INTEREST_BEHAVIOUR service, and
 * backfill the missing interests/behaviors fields in ES.
 */
async function insertInterestBehaviour(req, res) {
  const network = resolveNetwork(req);
  const cfg = NETWORK_CONFIG[network];
  if (!cfg) {
    return res.status(400).json({ code: 400, message: `Unsupported network "${network}". Supported: ${SUPPORTED_NETWORKS.join(', ')}` });
  }

  const baseUrl = process.env.INTEREST_BEHAVIOUR;
  if (!baseUrl) {
    return res.status(503).json({ code: 503, message: 'INTEREST_BEHAVIOUR service URL is not configured', ids: [] });
  }

  const service = serviceRegistry.getService(cfg.service);
  if (!service?.db?.sql || !service?.db?.elastic) {
    return res.status(503).json({ code: 503, message: `SQL/Elasticsearch not available for network "${network}"`, ids: [] });
  }
  const sql = service.db.sql;
  const es = service.db.elastic;

  try {
    const lastProcessedId = readCheckpoint(network);

    // Table name comes from the validated NETWORK_CONFIG whitelist — safe to interpolate.
    const rows = await sql.query(
      `SELECT id FROM ${cfg.table} WHERE last_seen >= ? AND id > ? ORDER BY id ASC LIMIT ${BATCH_SIZE}`,
      [monthsAgoDatetime(LOOKBACK_MONTHS), lastProcessedId]
    );

    if (!rows || rows.length === 0) {
      return res.status(400).json({ code: 400, message: 'No ad IDs found to update', ids: [] });
    }

    const idsArray = rows.map((r) => parseInt(r.id, 10));
    // Advance the checkpoint up-front (mirrors PHP) so a mid-batch failure on one
    // ad doesn't re-process the whole batch on the next run.
    writeCheckpoint(network, idsArray[idsArray.length - 1]);

    const targetingUrl = `${baseUrl.replace(/\/$/, '')}/targeting/get-data`;
    const platform = isProdEnv() ? cfg.platformProd : cfg.platformDev;

    for (const id of idsArray) {
      try {
        const apiResponse = await axios.get(targetingUrl, {
          headers: { Accept: 'application/json', 'ad-Id': id, platform },
          timeout: EXTERNAL_TIMEOUT_MS,
        });

        const data = apiResponse.data || {};
        const interests = data?.data?.interests || [];
        const behaviors = data?.data?.behaviors || [];

        const result = await es.search({
          index: cfg.index,
          body: { query: { term: { [cfg.idField]: id } } },
        });
        const hits = extractHits(result);
        if (hits.length === 0) {
          service.log?.error(`Ad not found in ES to update interest/behaviour — ID: ${id}`);
          continue;
        }

        const doc = hits[0];
        const updateFields = buildMissingFields(doc._source || {}, { interests, behaviors }, { requireNonEmpty: true });

        if (Object.keys(updateFields).length > 0) {
          await es.update(withEsType(es, {
            index: cfg.index,
            id: doc._id,
            body: { doc: updateFields },
          }));
        }
      } catch (ex) {
        service.log?.error(`Error while processing ad ID ${id}: ${ex.message}`);
        continue;
      }
    }

    return res.status(200).json({ code: 200, ids: idsArray, message: 'Fields added successfully' });
  } catch (err) {
    service.log?.error(`[insertInterestBehaviour] network=${network} error: ${err.message}`);
    return res.status(500).json({ code: 500, message: 'Error occurred in insertInterestBehaviour function', error: err.message });
  }
}

module.exports = { storeBehaviourData, insertInterestBehaviour, SUPPORTED_NETWORKS };
