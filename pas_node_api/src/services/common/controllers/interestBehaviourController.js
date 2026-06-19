'use strict';

/**
 * Interest / Behaviour controller — populates the audience-targeting fields
 * (`interests`, `behaviors`, `confidence_score`) on ad documents in each
 * network's search_mix Elasticsearch index.
 *
 * Node port of the Laravel endpoints (FB = adsData/AdMetaData, IG = InstagramUser):
 *   - storeBahaviourData         → POST  store-bahaviour-data
 *   - insertInterestBahaviour    → GET   insert-interest-behaviour
 *   - updateInterestBehaviourData → GET  update-interest-behaviour
 *
 * Three endpoints, all network-aware via a `network` param (facebook | instagram):
 *
 *   POST /api/v1/common/store-bahaviour-data
 *     Push interests/behaviors/confidence_score for ONE ad. Write-once: only
 *     fields that don't already exist on the doc are written (mirrors PHP).
 *     Body: { adId | ad_id, network?, interestBehaviour: { interests, behaviors, confidence_score } }
 *
 *   GET /api/v1/common/insert-interest-behaviour?network=facebook
 *     Batch puller (cron). Reads the next 10 ad ids (last_seen within 6 months,
 *     id > checkpoint) from the network's `<net>_ad` SQL table, fetches each ad's
 *     targeting data from the external service, and backfills the MISSING fields
 *     in ES. Checkpoint: data/interestBehaviour.<net>.txt.
 *
 *   GET /api/v1/common/update-interest-behaviour?network=facebook
 *     Refresh + cleanup cron. Re-visits ads that ALREADY have targeting and were
 *     last seen before a cutoff: overwrites with fresh data, or removes the fields
 *     when the service reports no data (never on auth/transient errors). Checkpoint:
 *     data/interest_last_ad_id.<net>.txt.
 *
 * The read side (surfacing these fields to the frontend "Target Audience" panel)
 * already lives in {facebook,instagram}/controllers/adDetailController.js, plus a
 * lazy read-through that fetches+caches on modal open via the shared helper.
 */

const fs = require('fs');
const path = require('path');
const serviceRegistry = require('../../ServiceRegistry');
const { fetchTargetingData, fetchTargetingDetailed, removeTargetingData } = require('../helpers/interestBehaviour');

// Per-network ES + SQL mapping. The network param is validated against these
// keys, so the (non-parameterizable) SQL table name below is always safe.
const NETWORK_CONFIG = {
  facebook: {
    service:  'facebook',
    index:    process.env.FB_ELASTIC_INDEX || process.env.FB_ES_INDEX || 'search_mix',
    idField:  'facebook_ad.id',
    lastSeenField: 'facebook_ad.last_seen',
    table:    'facebook_ad',
  },
  instagram: {
    service:  'instagram',
    index:    process.env.IG_ES_INDEX || 'instagram_search_mix',
    idField:  'instagram_ad.id',
    lastSeenField: 'instagram_ad.last_seen',
    table:    'instagram_ad',
  },
};

const SUPPORTED_NETWORKS = Object.keys(NETWORK_CONFIG);

const BATCH_SIZE = 10;
const LOOKBACK_MONTHS = 6;
// Refresh/cleanup cron only revisits ads last seen before this cutoff (mirrors
// the PHP `last_seen < '2026-03-16 00:00:00'`). Overridable via env.
const DEFAULT_REFRESH_BEFORE = '2026-03-16 00:00:00';

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
// Each batch endpoint keeps its own checkpoint file under data/. `name` is the
// full base name (e.g. `interestBehaviour.facebook`, `interest_last_ad_id.instagram`)
// so the puller and the refresh cron don't share a cursor.
function checkpointPath(name) {
  return path.resolve(process.cwd(), 'data', `${name}.txt`);
}

function readCheckpoint(name) {
  try {
    const raw = fs.readFileSync(checkpointPath(name), 'utf-8').trim();
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeCheckpoint(name, lastId) {
  const file = checkpointPath(name);
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

  if (!process.env.INTEREST_BEHAVIOUR_TOKEN) {
    return res.status(503).json({ code: 503, message: 'INTEREST_BEHAVIOUR_TOKEN is not configured', ids: [] });
  }

  const service = serviceRegistry.getService(cfg.service);
  if (!service?.db?.sql || !service?.db?.elastic) {
    return res.status(503).json({ code: 503, message: `SQL/Elasticsearch not available for network "${network}"`, ids: [] });
  }
  const sql = service.db.sql;
  const es = service.db.elastic;

  const checkpointName = `interestBehaviour.${network}`;

  try {
    const lastProcessedId = readCheckpoint(checkpointName);

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
    writeCheckpoint(checkpointName, idsArray[idsArray.length - 1]);

    for (const id of idsArray) {
      try {
        // Same external targeting fetch the modal's lazy read-through uses.
        const targeting = await fetchTargetingData({ network, adId: id, log: service.log });
        if (!targeting) continue; // no data / service error — leave this ad for a later run

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
        const updateFields = buildMissingFields(
          doc._source || {},
          { interests: targeting.interests, behaviors: targeting.behaviors },
          { requireNonEmpty: true }
        );

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

/**
 * GET /update-interest-behaviour?network=facebook
 *
 * Refresh + cleanup cron — Node port of AdMetaDataController@updateInterestBehaviourData
 * (FB) and InstagramUserController@updateInterestBehaviourData (IG).
 *
 * Walks the backlog of ads that ALREADY have targeting (`exists: interests`) and
 * were last seen before the refresh cutoff, oldest id first, in batches of
 * BATCH_SIZE. For each ad it re-fetches from the targeting service and:
 *   - has data  → overwrites interests/behaviors/confidence_score (refresh)
 *   - no data   → removes those fields (cleanup; ad's audience section then hides)
 *   - error/auth→ leaves the ad untouched (never deletes on a transient/auth failure)
 *
 * Checkpoint is a SEPARATE file from the puller (data/interest_last_ad_id.<net>.txt)
 * and, mirroring PHP, only advances on a successful refresh — removed ads drop out
 * of the `exists: interests` filter on the next run, so progress is still guaranteed.
 */
async function updateInterestBehaviour(req, res) {
  const network = resolveNetwork(req);
  const cfg = NETWORK_CONFIG[network];
  if (!cfg) {
    return res.status(400).json({ code: 400, message: `Unsupported network "${network}". Supported: ${SUPPORTED_NETWORKS.join(', ')}` });
  }

  if (!process.env.INTEREST_BEHAVIOUR_TOKEN) {
    return res.status(503).json({ code: 503, message: 'INTEREST_BEHAVIOUR_TOKEN is not configured' });
  }

  const service = serviceRegistry.getService(cfg.service);
  if (!service?.db?.elastic) {
    return res.status(503).json({ code: 503, message: `Elasticsearch not available for network "${network}"` });
  }
  const es = service.db.elastic;

  const checkpointName = `interest_last_ad_id.${network}`;
  const refreshBefore = process.env.INTEREST_BEHAVIOUR_REFRESH_BEFORE || DEFAULT_REFRESH_BEFORE;

  try {
    const lastId = readCheckpoint(checkpointName);

    const must = [
      { range: { [cfg.lastSeenField]: { lt: refreshBefore } } },
      { exists: { field: 'interests' } },
    ];
    if (lastId) must.push({ range: { [cfg.idField]: { gt: lastId } } });

    const result = await es.search({
      index: cfg.index,
      size: BATCH_SIZE,
      body: {
        query: { bool: { must } },
        sort: [{ [cfg.idField]: { order: 'asc' } }],
      },
    });

    const hits = extractHits(result);
    if (hits.length === 0) {
      return res.status(404).json({ code: 404, message: 'No ads to update' });
    }

    let lastProcessedId = null;
    let refreshed = 0;
    let removed = 0;
    let skipped = 0;

    for (const hit of hits) {
      const adId = hit._source?.[cfg.idField];
      const docId = hit._id;
      const docIndex = hit._index;

      const r = await fetchTargetingDetailed({ network, adId, log: service.log });

      if (r.status === 'empty') {
        // Service authoritatively reports no targeting → purge the stale fields.
        await removeTargetingData({ esConn: es, index: docIndex, docId, log: service.log });
        removed++;
      } else if (r.status === 'ok') {
        // Refresh — overwrite with the latest targeting (NOT write-once).
        await es.update(withEsType(es, {
          index: docIndex,
          id: docId,
          body: { doc: { interests: r.interests, behaviors: r.behaviors, confidence_score: r.confidence_score } },
        }));
        refreshed++;
        lastProcessedId = adId; // advance only on a successful refresh (mirrors PHP)
      } else {
        // 'skip' — auth/transient error: never delete, retry on a later run.
        skipped++;
      }
    }

    if (lastProcessedId != null) writeCheckpoint(checkpointName, lastProcessedId);

    return res.status(200).json({
      code: 200,
      message: 'Interest and behaviour updated for batch',
      refreshed,
      removed,
      skipped,
      next_checkpoint: lastProcessedId,
    });
  } catch (err) {
    service.log?.error(`[updateInterestBehaviour] network=${network} error: ${err.message}`);
    return res.status(500).json({ code: 500, message: 'Error occurred in updateInterestBehaviour function', error: err.message });
  }
}

module.exports = { storeBehaviourData, insertInterestBehaviour, updateInterestBehaviour, SUPPORTED_NETWORKS };
