const express = require("express");
const router = express.Router();
const queryDatabase = require("../db-connections/connection");
const searchAllInstances = require("../es-connections/connection");

/**
 * Infrastructure analytics — storage across the whole PowerAdSpy fleet:
 *   - every production MySQL host: total size, per-database size, and the biggest tables
 *     (answers "which database server / which table is using how much data")
 *   - every Elasticsearch cluster: disk allocation (total/used/free) + biggest indices
 *
 * Collecting this means information_schema across 11 hosts + cat APIs across 5 ES clusters — far
 * too slow to do inside a request. So it is computed in the BACKGROUND (warmed on boot + refreshed
 * on an interval) into an in-process snapshot, and the endpoint serves that snapshot instantly.
 * Each host/cluster is wrapped in its own timeout + try/catch so one slow/down node can never block
 * or sink the whole snapshot — it just comes back as { ok:false, error }.
 */

const NUM_DB_HOSTS = 11;
const REFRESH_MS = 30 * 60 * 1000; // recompute the snapshot every 30 min
const HOST_TIMEOUT_MS = 45 * 1000; // hard cap per DB host / ES cluster

let _snap = { at: 0, data: null, computing: false };

const SYS_SCHEMAS = "('information_schema','performance_schema','mysql','sys')";
const DB_SIZE_SQL = `
  SELECT table_schema AS db,
         ROUND(SUM(data_length + index_length) / 1073741824, 2) AS gb,
         COUNT(*) AS tables
  FROM information_schema.tables
  WHERE table_schema NOT IN ${SYS_SCHEMAS}
  GROUP BY table_schema
  ORDER BY gb DESC`;
const TOP_TABLES_SQL = `
  SELECT table_schema AS db, table_name AS tbl,
         ROUND((data_length + index_length) / 1073741824, 2) AS gb,
         table_rows AS approx_rows
  FROM information_schema.tables
  WHERE table_schema NOT IN ${SYS_SCHEMAS}
  ORDER BY (data_length + index_length) DESC
  LIMIT 25`;

const toGB = (b) => +(((Number(b) || 0)) / 1073741824).toFixed(2);

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label + " timed out")), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

async function collectOneDb(i) {
  try {
    const [sizes, top] = await withTimeout(Promise.all([
      queryDatabase(i, "information_schema", DB_SIZE_SQL),
      queryDatabase(i, "information_schema", TOP_TABLES_SQL),
    ]), HOST_TIMEOUT_MS, "db" + i);
    const totalGB = sizes.reduce((s, r) => s + Number(r.gb || 0), 0);
    return {
      server: i, ok: true, totalGB: +totalGB.toFixed(2), dbCount: sizes.length,
      databases: sizes.map((r) => ({ db: r.db, gb: Number(r.gb || 0), tables: Number(r.tables || 0) })),
      topTables: top.map((r) => ({ db: r.db, table: r.tbl, gb: Number(r.gb || 0), rows: Number(r.approx_rows || 0) })),
    };
  } catch (e) {
    return { server: i, ok: false, error: e.message };
  }
}

async function collectOneEs(cl, i) {
  try {
    const [alloc, idx] = await withTimeout(Promise.all([
      cl.cat.allocation({ format: "json", bytes: "b" }),
      cl.cat.indices({ format: "json", bytes: "b", h: "index,store.size,docs.count", s: "store.size:desc" }),
    ]), HOST_TIMEOUT_MS, "es" + i);
    const node = (Array.isArray(alloc) && alloc[0]) || {};
    const totalIndicesGB = (idx || []).reduce((s, x) => s + toGB(x["store.size"]), 0);
    return {
      node: i, ok: true,
      allocation: {
        totalGB: toGB(node["disk.total"]), usedGB: toGB(node["disk.used"]),
        availGB: toGB(node["disk.avail"]), pctUsed: node["disk.percent"] != null ? Number(node["disk.percent"]) : null,
      },
      indexCount: (idx || []).length,
      totalIndicesGB: +totalIndicesGB.toFixed(2),
      topIndices: (idx || []).slice(0, 25).map((x) => ({ index: x.index, gb: toGB(x["store.size"]), docs: Number(x["docs.count"] || 0) })),
    };
  } catch (e) {
    return { node: i, ok: false, error: e.message };
  }
}

async function refreshInfra() {
  if (_snap.computing) return;
  _snap.computing = true;
  try {
    const clients = searchAllInstances.clients || [];
    const [databases, elasticsearch] = await Promise.all([
      Promise.all(Array.from({ length: NUM_DB_HOSTS }, (_, i) => collectOneDb(i))),
      Promise.all(clients.map((cl, i) => collectOneEs(cl, i))),
    ]);
    const dbTotalGB = databases.filter((d) => d.ok).reduce((s, d) => s + d.totalGB, 0);
    const esUsedGB = elasticsearch.filter((e) => e.ok).reduce((s, e) => s + (e.allocation.usedGB || 0), 0);
    _snap = {
      at: Date.now(), computing: false,
      data: {
        databases, elasticsearch,
        summary: {
          dbHosts: databases.length, dbHostsOk: databases.filter((d) => d.ok).length, dbTotalGB: +dbTotalGB.toFixed(2),
          esClusters: elasticsearch.length, esClustersOk: elasticsearch.filter((e) => e.ok).length, esUsedGB: +esUsedGB.toFixed(2),
        },
        at: new Date().toISOString(),
      },
    };
  } catch (e) {
    _snap.computing = false;
  }
}

// GET /admin-panel/infra/storage — serves the latest snapshot instantly. ?refresh=1 triggers a
// background recompute (still returns the current snapshot). Cold start returns { computing:true }.
router.get("/storage", (req, res) => {
  if (req.query.refresh) refreshInfra();
  if (_snap.data) {
    return res.json({ code: 200, data: _snap.data, computing: _snap.computing, ageSec: Math.round((Date.now() - _snap.at) / 1000) });
  }
  if (!_snap.computing) refreshInfra();
  return res.json({ code: 200, data: null, computing: true });
});

// Warm on boot, then keep it fresh.
refreshInfra();
setInterval(refreshInfra, REFRESH_MS);

module.exports = router;
