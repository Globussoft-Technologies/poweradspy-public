'use strict';

/**
 * The only file that runs SQL for the blocklist. Tables are defined in
 * scripts/apply-copyright-schema.js. All values go through placeholders; the
 * only inlined values are a validated integer page size and fixed constants.
 *
 * Timestamps are UTC DATETIMEs supplied here (the tables have no DB defaults).
 *
 * Perceptual hashes: the 256-bit hash of the image-hashing service is stored as
 * CHAR(64) lowercase hex, read and written as that string. Callers turn it into
 * 8 words (../imagematch/matcher.js).
 */

const BLOCKLIST_TABLE = 'copyright_blocklist';
const ATTEMPTS_TABLE = 'copyright_blocked_attempts';
const IMAGE_HASH_TYPE = 'image_hash';
const IN_CHUNK = 500;
// copyright_blocklist.value and copyright_blocked_attempts.image_url are varchar(2048),
// like the URL columns of the ad tables. add() rejects a longer value instead of
// letting it be cut here, because a cut entry would never match.
const VALUE_MAX = 2048;

function utcNow() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function cut(value, max) {
  if (value === undefined || value === null) return null;
  return String(value).slice(0, max);
}

// The ASCII columns (network, ids, type and source codes) reject any other
// character in strict mode, which would fail a whole multi-row INSERT. Keep the
// row and replace such characters instead.
function ascii(value, max) {
  if (value === undefined || value === null) return null;
  return String(value).replace(/[^\x20-\x7e]/g, '?').slice(0, max);
}

function idKey(network, entryType, valueSha256, namespace = entryType === 'ad_id' ? 'platform' : 'none') {
  return `${network}|${entryType}|${namespace}|${valueSha256}`;
}

/**
 * Keyset-paginated read of the active, unexpired rows of one entry-type group
 * for a network: its own rows, then the rows marked 'all'.
 *
 * One query per scope, with equality on `network` and `status`, so MySQL reads
 * the (network, status) index in `id` order: no filesort, and `id > ?` is a
 * plain range seek. (A single `network IN (?, 'all')` would force a sort of the
 * whole filtered set on every page.) No OFFSET: constant cost per page.
 */
async function pageThrough(sql, network, pageSize, { columns, typeOperator, typeValue, startId = 0 }) {
  const limit = Math.max(1, parseInt(pageSize, 10) || 5000);
  const scopes = network === 'all' ? ['all'] : [network, 'all'];
  const rows = [];
  for (const scope of scopes) {
    let lastId = startId;
    for (;;) {
      const page = await sql.query(
        `SELECT ${columns}
           FROM ${BLOCKLIST_TABLE}
          WHERE network = ?
            AND status = 'active'
            AND entry_type ${typeOperator} ?
            AND id > ?
            AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
          ORDER BY id
          LIMIT ${limit}`,
        [scope, typeValue, lastId]
      );
      if (!page.length) break;
      rows.push(...page);
      lastId = page[page.length - 1].id;
      if (page.length < limit) break;
    }
  }
  return rows;
}

/**
 * Every active entry B1 matches at ingestion (all types except image_hash), only
 * the columns needed to match.
 */
function loadActive(sql, network, { pageSize = 5000 } = {}) {
  return pageThrough(sql, network, pageSize, {
    columns: 'id, entry_type, value, identifier_namespace',
    typeOperator: '<>',
    typeValue: IMAGE_HASH_TYPE,
  });
}

/**
 * The banned images (entry_type = image_hash) for B2: id, exact hash, the
 * perceptual hash (64 hex characters) and its version. Kept in its own query so a
 * problem here can never stop the ingestion matching above.
 *
 * `afterId` reads only the rows added after that id (ids only grow), so the cache can pick up new images
 * without reading every banned image again.
 */
function loadImageHashes(sql, network, { pageSize = 5000, afterId = 0 } = {}) {
  return pageThrough(sql, network, pageSize, {
    columns: 'id, image_sha256, image_phash, image_phash_algo',
    typeOperator: '=',
    typeValue: IMAGE_HASH_TYPE,
    startId: Number.isSafeInteger(afterId) && afterId > 0 ? afterId : 0,
  });
}

/**
 * Add entries in one multi-row statement. The unique key
 * (network, entry_type, identifier_namespace, value_sha256) makes this idempotent: an existing entry
 * is re-activated (its removal marks are cleared), never duplicated. Rows are
 * never deleted. `added_by` is NOT NULL in the table, so every entry must have it.
 *
 * @param {Array<{network, entry_type, value, value_sha256, added_by, reason?, source?,
 *                complaint_id?, expires_at?, details?, image_sha256?, image_phash_algo?,
 *                image_phash? (64 hex characters)}>} entries
 */
async function upsertEntries(sql, entries) {
  if (!entries.length) return { affected: 0 };
  const now = utcNow();
  const placeholders = entries.map(() => `(${Array(17).fill('?').join(', ')})`).join(', ');
  const params = [];
  for (const e of entries) {
    params.push(
      ascii(e.network, 32), ascii(e.entry_type, 32), cut(e.value, VALUE_MAX), e.value_sha256,
      cut(e.reason, 255), ascii(e.source, 64), e.complaint_id || null,
      'active', e.expires_at || null, e.details || null, now, now, cut(e.added_by, 128),
      e.image_sha256 || null, ascii(e.image_phash_algo, 16), e.image_phash ?? null,
      ascii(e.identifier_namespace || (e.entry_type === 'ad_id' ? 'platform' : 'none'), 16)
    );
  }
  const result = await sql.query(
    `INSERT INTO ${BLOCKLIST_TABLE}
       (network, entry_type, value, value_sha256, reason, source, complaint_id,
        status, expires_at, details, created_at, updated_at, added_by,
        image_sha256, image_phash_algo, image_phash, identifier_namespace)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       status = 'active', reason = VALUES(reason), source = VALUES(source),
       complaint_id = VALUES(complaint_id), expires_at = VALUES(expires_at),
       added_by = VALUES(added_by), removed_at = NULL, removed_by = NULL,
       image_sha256 = VALUES(image_sha256), image_phash_algo = VALUES(image_phash_algo),
       image_phash = VALUES(image_phash), updated_at = VALUES(updated_at)`,
    params
  );
  return { affected: result?.affectedRows ?? entries.length };
}

/**
 * The ids of entries that were just written, looked up through the unique key
 * (network, entry_type, value_sha256). INSERT ... ON DUPLICATE KEY does not
 * return the ids of every row, and B3 / B6 need them for their link tables.
 *
 * @returns {Promise<Map<string, number>>} key = idKey(network, entry_type, value_sha256)
 */
async function findIds(sql, rows) {
  const groups = new Map();
  for (const r of rows) {
    const namespace = r.identifier_namespace || (r.entry_type === 'ad_id' ? 'platform' : 'none');
    const key = `${r.network}\u0000${r.entry_type}\u0000${namespace}`;
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key).add(r.value_sha256);
  }
  const ids = new Map();
  for (const [key, hashSet] of groups) {
    const [network, entryType, namespace] = key.split('\u0000');
    const hashes = [...hashSet];
    for (let i = 0; i < hashes.length; i += IN_CHUNK) {
      const chunk = hashes.slice(i, i + IN_CHUNK);
      const found = await sql.query(
        `SELECT id, value_sha256
           FROM ${BLOCKLIST_TABLE}
          WHERE network = ? AND entry_type = ? AND identifier_namespace = ?
            AND value_sha256 IN (${chunk.map(() => '?').join(', ')})`,
        [network, entryType, namespace, ...chunk]
      );
      for (const f of found) ids.set(idKey(network, entryType, f.value_sha256, namespace), Number(f.id));
    }
  }
  return ids;
}

/**
 * Soft-remove entries by id: status 'revoked', with who and when. Rows are never
 * deleted. Only currently active rows change, so repeating a call is harmless.
 */
async function revokeEntries(sql, ids, { removedBy }) {
  const clean = [...new Set(ids.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))];
  if (!clean.length) return { affected: 0 };
  const now = utcNow();
  let affected = 0;
  for (let i = 0; i < clean.length; i += IN_CHUNK) {
    const chunk = clean.slice(i, i + IN_CHUNK);
    const result = await sql.query(
      `UPDATE ${BLOCKLIST_TABLE}
          SET status = 'revoked', removed_at = ?, removed_by = ?, updated_at = ?
        WHERE id IN (${chunk.map(() => '?').join(', ')}) AND status = 'active'`,
      [now, cut(removedBy, 128), now, ...chunk]
    );
    affected += result?.affectedRows ?? 0;
  }
  return { affected };
}

/** Insert rejected-attempt rows in one multi-row statement. Identifiers only. */
async function insertAttempts(sql, rows) {
  if (!rows.length) return { inserted: 0 };
  const placeholders = rows.map(() => `(${Array(9).fill('?').join(', ')})`).join(', ');
  const params = [];
  for (const r of rows) {
    params.push(
      ascii(r.network, 32), ascii(r.platform_ad_id, 255), cut(r.advertiser, 255), cut(r.image_url, VALUE_MAX),
      r.blocklist_id, ascii(r.match_type, 32), r.distance ?? null, ascii(r.source, 64),
      r.created_at || utcNow()
    );
  }
  await sql.query(
    `INSERT INTO ${ATTEMPTS_TABLE}
       (network, platform_ad_id, advertiser, image_url, blocklist_id,
        match_type, distance, source, created_at)
     VALUES ${placeholders}`,
    params
  );
  return { inserted: rows.length };
}

module.exports = {
  IMAGE_HASH_TYPE,
  VALUE_MAX,
  loadActive,
  loadImageHashes,
  upsertEntries,
  findIds,
  idKey,
  revokeEntries,
  insertAttempts,
  utcNow,
};
