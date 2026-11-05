'use strict';

// The automatic image work of B2, in one file, in five parts:
//   1. jobRepository   the SQL on copyright_image_hash_jobs (and the blocklist read that finds new advertisers)
//   2. DbCheckpoint    a job's saved place, kept in its row
//   3. HashWorker      claims a job, runs it with HashJob, records how it ended, retries, pauses
//   4. NewAdSweeper    checks the NEW ads against the banned images (stage 4) and queues what matches for review
//   5. the cron runner what src/jobs/cronManager.js runs on each tick (createRunner / runImageHashJobs)
//   6. submitAdvertiser the entry point for a name from the landing page: search, block, queue the hashing (createIntake)

// ═══ 1. jobRepository ═══
/**
 * The SQL of the background hashing worker, on one network's database. It reads copyright_blocklist
 * (to find blocked advertisers) and reads and writes copyright_image_hash_jobs (the work list).
 * It never deletes anything and never touches the ad tables (that is sources.js).
 *
 * Timestamps are UTC DATETIMEs supplied here (the tables have no DB defaults).
 *
 * A job is claimed with one atomic UPDATE: two workers can never run the same job. Every later write
 * (progress, finish, release) is guarded by `claimed_by = me AND status = 'running'`, so a worker
 * that lost its claim (it was too slow and another worker took over) cannot overwrite the new one.
 */

const { hasImageExtension } = require('./sources');
const { slotHash } = require('./job');

const BLOCKLIST_TABLE = 'copyright_blocklist';
const JOBS_TABLE = 'copyright_image_hash_jobs';
const RESULTS_TABLE = 'copyright_image_hash_results';
// The blocklist entry types that get a job: an advertiser / page (its ads), one ad id, a URL (its ads, if they can be found).
const ENTRY_TYPES = ['advertiser', 'page', 'ad_id', 'url', 'image_url'];
const NAME_MAX = 255;
const ERROR_MAX = 512;
const LAST_REAL_ENTRY = 4294967294; // 4294967295 is the backfill cursor row; 0 is the sweep cursor row

const JOB = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  DONE: 'done',
  NO_OWNER: 'no_owner',
  LIMIT_REACHED: 'limit_reached',
  UNRESOLVED: 'unresolved',
  FAILED: 'failed',
});

const utc = (date = new Date()) => date.toISOString().slice(0, 19).replace('T', ' ');
const cut = (value, max) => (value === undefined || value === null ? null : String(value).slice(0, max));
// claimed_by is an ASCII column: replace anything else rather than fail the statement in strict mode.
const asciiId = (value) => String(value ?? '').replace(/[^\x20-\x7e]/g, '?').slice(0, 128);

/**
 * Blocked entries that have no job yet, for one network: its own entries and the 'all' ones. An anti-join on the unique key
 * (network, blocklist_id). One query per scope and entry type, each an equality on the first two columns of the blocklist's unique key
 * (network, entry_type, value_sha256): it reads only the few advertiser / page / ad id / URL entries and never walks the image_hash
 * entries, which are the bulk of the table.
 *
 * @returns {Promise<Array<{ id, value, complaint_id, entry_type }>>}
 */
async function findNewAdvertisers(sql, network, { limit = 100 } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const out = [];
  const seen = new Set();
  for (const scope of network === 'all' ? ['all'] : [network, 'all']) {
    for (const type of ENTRY_TYPES) {
      if (out.length >= n) return out;
      const rows = await sql.query(
        `SELECT b.id AS id, b.value AS value, b.complaint_id AS complaint_id, b.entry_type AS entry_type, b.identifier_namespace AS identifier_namespace
           FROM ${BLOCKLIST_TABLE} b
           LEFT JOIN ${JOBS_TABLE} j ON j.network = ? AND j.blocklist_id = b.id
          WHERE b.network = ?
            AND b.entry_type = ?
            AND b.status = 'active'
            AND (b.expires_at IS NULL OR b.expires_at > UTC_TIMESTAMP())
            AND j.id IS NULL
          ORDER BY b.id
          LIMIT ${n}`,
        [network, scope, type]
      );
      for (const row of rows) {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          out.push(row);
        }
      }
    }
  }
  return out.slice(0, n);
}

/** Create the jobs, one per blocklist entry. Idempotent: an entry that already has a job is left alone. */
async function createJobs(sql, network, entries) {
  const rows = [];
  for (const e of entries || []) {
    if (!e) continue;
    // An id is a positive whole number (or its digits as text). Number(null) and Number('') are 0: not an id.
    const id = typeof e.id === 'number' ? e.id : (typeof e.id === 'string' && /^\d+$/.test(e.id) ? Number(e.id) : NaN);
    const name = cut(e.value, NAME_MAX)?.trim();
    const type = ENTRY_TYPES.includes(e.entry_type) ? e.entry_type : 'advertiser';
    const namespace = e.identifier_namespace || (type === 'ad_id' ? null : 'none');
    // Never guess an ad-ID namespace.
    const validNamespace = type === 'ad_id' ? ['internal', 'platform'].includes(namespace) : namespace === 'none';
    if (Number.isSafeInteger(id) && id > 0 && id <= LAST_REAL_ENTRY && name && validNamespace) rows.push({ id, name, type, namespace, complaintId: e.complaint_id || null });
  }
  if (!rows.length) return { created: 0 };
  const now = utc();
  const params = [];
  for (const r of rows) {
    params.push(network, r.id, r.type, r.name, r.complaintId, JOB.PENDING, 0, 1, 0, 0, 0, now, now, r.namespace);
  }
  const result = await sql.query(
    `INSERT INTO ${JOBS_TABLE}
       (network, blocklist_id, entry_type, advertiser_name, complaint_id, status, attempts, requested_gen, run_gen, covered_gen, progress_seq, created_at, updated_at, identifier_namespace)
     VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE id = id`,
    params
  );
  return { created: result?.affectedRows ?? rows.length };
}

/**
 * Entries that were blocked AGAIN after their job was made. A block is identified by its complaint id:
 *   - the entry carries a complaint id the job does not have (a new complaint on the same advertiser) -> a new block;
 *   - the same complaint id again (a retry of the same request, for example after a timeout) -> NOT a new block, whatever updated_at says;
 *   - an entry with no complaint id at all (added by a script) counts as a new block only when it changed after the job last asked for a
 *     run (updated_at > requested_at, or created_at).
 * Same per scope / type query shape as findNewAdvertisers (an equality on the first two columns of the blocklist's unique key).
 * @returns {Promise<Array<{ id: number, complaint_id: ?string }>>}
 */
async function findReblocked(sql, network, { limit = 100 } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const found = [];
  for (const scope of network === 'all' ? ['all'] : [network, 'all']) {
    for (const type of ENTRY_TYPES) {
      if (found.length >= n) return found;
      const rows = await sql.query(
        `SELECT b.id AS id, b.complaint_id AS complaint_id
           FROM ${BLOCKLIST_TABLE} b
           JOIN ${JOBS_TABLE} j ON j.network = ? AND j.blocklist_id = b.id
          WHERE b.network = ?
            AND b.entry_type = ?
            AND b.status = 'active'
            AND (b.expires_at IS NULL OR b.expires_at > UTC_TIMESTAMP())
            AND ((b.complaint_id IS NOT NULL AND NOT (b.complaint_id <=> j.complaint_id))
              OR (b.complaint_id IS NULL AND b.updated_at > COALESCE(j.requested_at, j.created_at)))
          ORDER BY b.id
          LIMIT ${n}`,
        [network, scope, type]
      );
      for (const row of rows) if (!found.some((f) => f.id === row.id)) found.push({ id: row.id, complaint_id: row.complaint_id || null });
    }
  }
  return found.slice(0, n);
}

/**
 * A new request for the entry's work (a re-block, or someone asking for a rerun): a new generation. A job that is waiting or finished goes
 * back to pending with a clean slate (a fresh run, counted from zero). A job that is RUNNING keeps running; the generation is only raised,
 * and when that run ends finish() sees that a newer generation was asked for and sends the job back to pending instead of closing it,
 * so an older run is never taken for covering the newer block. The cursor rows (sweep, backfill) are never touched.
 * `complaintId` (the new block's complaint) replaces the job's, so the next run tags its image hashes with the complaint that asked for it
 * and the same complaint arriving again is recognised as a repeat (see findReblocked); null leaves the job's complaint as it is.
 * @returns {Promise<boolean>} true when a job was found
 */
async function requestRun(sql, network, blocklistId, complaintId = null) {
  const now = utc();
  const result = await sql.query(
    `UPDATE ${JOBS_TABLE}
        SET requested_gen = requested_gen + 1, requested_at = ?, complaint_id = COALESCE(?, complaint_id),
            state = IF(status = 'running', state, NULL),
            attempts = IF(status = 'running', attempts, 0),
            last_error = IF(status = 'running', last_error, NULL),
            finished_at = IF(status = 'running', finished_at, NULL),
            claimed_by = IF(status = 'running', claimed_by, NULL),
            claimed_at = IF(status = 'running', claimed_at, NULL),
            heartbeat_at = IF(status = 'running', heartbeat_at, NULL),
            status = IF(status = 'running', 'running', 'pending'),
            progress_seq = progress_seq + 1, updated_at = ?
      WHERE network = ? AND blocklist_id = ? AND blocklist_id > 0 AND blocklist_id <= ${LAST_REAL_ENTRY}`,
    [now, cut(complaintId, 36), now, network, blocklistId]
  );
  return Boolean(result?.affectedRows);
}

/**
 * Ask for the re-run of every entry that was blocked again (see findReblocked), each with the complaint that blocked it. A few, each one UPDATE.
 * @returns {Promise<number>} jobs asked to run again
 */
async function requestReblocked(sql, network, options = {}) {
  let count = 0;
  for (const row of await findReblocked(sql, network, options)) {
    if (await requestRun(sql, network, row.id, row.complaint_id)) count += 1;
  }
  return count;
}

/**
 * Continue a job that stopped at its image cap (limit_reached): the SAME generation, from its saved place, with the image counter back at
 * zero so it gets a new allowance of images. Only a limit_reached job can be resumed.
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function resumeLimited(sql, network, blocklistId) {
  const rows = await sql.query(
    `SELECT id, status, state, progress_seq FROM ${JOBS_TABLE} WHERE network = ? AND blocklist_id = ? AND blocklist_id > 0 AND blocklist_id <= ${LAST_REAL_ENTRY} LIMIT 1`,
    [network, blocklistId]
  );
  const job = rows[0];
  if (!job) return { ok: false, reason: 'no_job' };
  if (job.status !== JOB.LIMIT_REACHED) return { ok: false, reason: 'not_limit_reached' };
  let state = null;
  try { state = job.state ? JSON.parse(job.state) : null; } catch { state = null; }
  if (!state || typeof state !== 'object') return { ok: false, reason: 'no_saved_place' };
  state.stats = { ...(state.stats || {}), requested: 0 };
  const now = utc();
  // progress_seq makes this a compare-and-set: if the row changed since it was read nothing is updated.
  const result = await sql.query(
    `UPDATE ${JOBS_TABLE}
        SET status = 'pending', attempts = 0, last_error = NULL, finished_at = NULL, claimed_by = NULL, claimed_at = NULL, heartbeat_at = NULL,
            state = ?, progress_seq = progress_seq + 1, updated_at = ?
      WHERE id = ? AND status = 'limit_reached' AND progress_seq = ?`,
    [JSON.stringify(state), now, job.id, job.progress_seq]
  );
  return result?.affectedRows ? { ok: true } : { ok: false, reason: 'changed_meanwhile' };
}

/**
 * Claim the job that has waited longest (least recently updated) among those pending, or running with a stale heartbeat (its worker
   * died). A big advertiser's job goes to the back of the line after each time slice, so small new ones are not stuck behind it.
 * @param {Date} staleBefore  a running job whose heartbeat is older than this is taken over
 * @returns {Promise<?{ id, network, blocklist_id, advertiser_name, complaint_id, attempts, state }>}
 */
async function claimNext(sql, network, workerId, staleBefore) {
  const me = asciiId(workerId);
  const now = utc();
  const stale = utc(staleBefore);
  const claimed = await sql.query(
    `UPDATE ${JOBS_TABLE}
        SET status = 'running', run_gen = requested_gen, claimed_by = ?, claimed_at = ?, heartbeat_at = ?, attempts = attempts + 1,
            progress_seq = progress_seq + 1, updated_at = ?
      WHERE id = (SELECT id FROM (
                    SELECT id FROM ${JOBS_TABLE}
                     WHERE network = ? AND (status = 'pending' OR (status = 'running' AND heartbeat_at < ?))
                     ORDER BY updated_at, id LIMIT 1) AS pick)
        AND (status = 'pending' OR (status = 'running' AND heartbeat_at < ?))`,
    [me, now, now, now, network, stale, stale]
  );
  if (!claimed?.affectedRows) return null;
  const rows = await sql.query(
    `SELECT id, network, blocklist_id, entry_type, identifier_namespace, advertiser_name, complaint_id, attempts, run_gen, state
       FROM ${JOBS_TABLE}
      WHERE network = ? AND claimed_by = ? AND status = 'running'
      ORDER BY claimed_at DESC, id DESC
      LIMIT 1`,
    [network, me]
  );
  return rows[0] || null;
}

/** The saved state of a job (a JSON string), or null. */
async function loadState(sql, jobId) {
  const rows = await sql.query(`SELECT state FROM ${JOBS_TABLE} WHERE id = ? LIMIT 1`, [jobId]);
  return rows[0]?.state ?? null;
}

/** Save the job's place and renew the claim. @returns {Promise<boolean>} false when this worker no longer holds the job */
async function saveProgress(sql, jobId, workerId, stateJson) {
  const now = utc();
  const result = await sql.query(
    `UPDATE ${JOBS_TABLE}
        SET state = ?, heartbeat_at = ?, progress_seq = progress_seq + 1, updated_at = ?
      WHERE id = ? AND claimed_by = ? AND status = 'running'`,
    [stateJson, now, now, jobId, asciiId(workerId)]
  );
  return Boolean(result?.affectedRows);
}

/**
 * End the job with a final status. covered_gen moves up to the run's generation only for a COMPLETE result (done, no_owner). If a newer
 * generation was asked for while this run was going (requested_gen > run_gen: a re-block), the result is NOT final for it: the job goes
 * back to pending with a clean slate, covered_gen stays, and it runs again for the newer block.
 * (UPDATE assignments are evaluated left to right; none of them changes requested_gen or run_gen, so every IF sees the same values.)
 * @returns {Promise<boolean>} false when this worker no longer holds the job
 */
async function finish(sql, jobId, workerId, status, { error } = {}) {
  const now = utc();
  const covers = status === JOB.DONE || status === JOB.NO_OWNER ? 1 : 0;
  const newer = 'requested_gen > run_gen';
  const result = await sql.query(
    `UPDATE ${JOBS_TABLE}
        SET covered_gen = IF(${newer} OR ? = 0, covered_gen, run_gen),
            state = IF(${newer}, NULL, state),
            attempts = IF(${newer}, 0, attempts),
            last_error = IF(${newer}, NULL, ?),
            finished_at = IF(${newer}, NULL, ?),
            claimed_by = IF(${newer}, NULL, claimed_by),
            claimed_at = IF(${newer}, NULL, claimed_at),
            heartbeat_at = IF(${newer}, NULL, heartbeat_at),
            status = IF(${newer}, 'pending', ?),
            progress_seq = progress_seq + 1, updated_at = ?
      WHERE id = ? AND claimed_by = ? AND status = 'running'`,
    [covers, cut(error, ERROR_MAX), now, status, now, jobId, asciiId(workerId)]
  );
  return Boolean(result?.affectedRows);
}

/**
 * Give the job back to the queue (pending), keeping its saved place.
 * @param {boolean} [refundAttempt]  the failure was not the job's fault (a bad key, a stop): do not count this try
 */
async function release(sql, jobId, workerId, { error, refundAttempt = false } = {}) {
  const now = utc();
  const result = await sql.query(
    `UPDATE ${JOBS_TABLE}
        SET status = 'pending', claimed_by = NULL, claimed_at = NULL, heartbeat_at = NULL,
            state = IF(requested_gen > run_gen, NULL, state),
            attempts = IF(requested_gen > run_gen, 0, IF(?, GREATEST(attempts, 1) - 1, attempts)),
            last_error = ?, progress_seq = progress_seq + 1, updated_at = ?
      WHERE id = ? AND claimed_by = ? AND status = 'running'`,
    [refundAttempt ? 1 : 0, cut(error, ERROR_MAX), now, jobId, asciiId(workerId)]
  );
  return Boolean(result?.affectedRows);
}

// ── cursor rows: one reserved row per network and kind, in the same table ──
// The hashing worker only looks at 'pending' / 'running' rows, so it never touches these.
const SWEEP = Object.freeze({ entry: 0, status: 'sweep', label: 'new-ads sweep' }); // the check of new ads
// hashing every old image: the entry number is above any real blocklist id
const BACKFILL = Object.freeze({ entry: 4294967295, status: 'backfill', label: 'image backfill' });
const SWEEP_STATUS = SWEEP.status;
const SWEEP_ENTRY = SWEEP.entry;

/**
 * Create the cursor row if it is not there. It runs every pass, so it is a plain lookup that inserts only when the row is
 * missing (INSERT ... ON DUPLICATE KEY would use up an auto-increment id on every call). Two machines racing on the first
 * pass are safe: the unique key (network, blocklist_id) keeps one row and IGNORE swallows the loser's duplicate.
 */
async function sweepEnsure(sql, network, stateJson, kind = SWEEP) {
  const now = utc();
  await sql.query(
    `INSERT IGNORE INTO ${JOBS_TABLE}
       (network, blocklist_id, entry_type, identifier_namespace, advertiser_name, complaint_id, status, attempts, requested_gen, run_gen, covered_gen, progress_seq, state, created_at, updated_at)
     SELECT ?, ${kind.entry}, '${kind.status}', 'none', '${kind.label}', NULL, '${kind.status}', 0, 0, 0, 0, 0, ?, ?, ?
       FROM DUAL
      WHERE NOT EXISTS (SELECT 1 FROM ${JOBS_TABLE} WHERE network = ? AND blocklist_id = ${kind.entry})`,
    [network, stateJson, now, now, network]
  );
}

/** Take the cursor for this pass; a holder that has shown no sign of life since `staleBefore` is replaced. @returns {Promise<?{ state }>} */
async function sweepClaim(sql, network, workerId, staleBefore, kind = SWEEP) {
  const me = asciiId(workerId);
  const now = utc();
  const result = await sql.query(
    `UPDATE ${JOBS_TABLE}
        SET claimed_by = ?, claimed_at = ?, heartbeat_at = ?, progress_seq = progress_seq + 1, updated_at = ?
      WHERE network = ? AND blocklist_id = ${kind.entry} AND status = '${kind.status}'
        AND (claimed_by IS NULL OR heartbeat_at < ?)`,
    [me, now, now, now, network, utc(staleBefore)]
  );
  if (!result?.affectedRows) return null;
  const rows = await sql.query(
    `SELECT state FROM ${JOBS_TABLE} WHERE network = ? AND blocklist_id = ${kind.entry} AND claimed_by = ? LIMIT 1`,
    [network, me]
  );
  return rows[0] ? { state: rows[0].state } : null;
}

/** Save the cursor and renew the claim; `lastError` is kept for people to read. @returns {Promise<boolean>} false when the claim is gone */
async function sweepSave(sql, network, workerId, stateJson, lastError = null, kind = SWEEP) {
  const now = utc();
  const result = await sql.query(
    `UPDATE ${JOBS_TABLE}
        SET state = ?, last_error = ?, heartbeat_at = ?, progress_seq = progress_seq + 1, updated_at = ?
      WHERE network = ? AND blocklist_id = ${kind.entry} AND claimed_by = ?`,
    [stateJson, cut(lastError, ERROR_MAX), now, now, network, asciiId(workerId)]
  );
  return Boolean(result?.affectedRows);
}

async function sweepRelease(sql, network, workerId, kind = SWEEP) {
  const result = await sql.query(
    `UPDATE ${JOBS_TABLE} SET claimed_by = NULL, claimed_at = NULL, heartbeat_at = NULL, updated_at = ?
      WHERE network = ? AND blocklist_id = ${kind.entry} AND claimed_by = ?`,
    [utc(), network, asciiId(workerId)]
  );
  return Boolean(result?.affectedRows);
}

/**
 * Hold an image for a person: one pending row per (network, sha256, banned entry). The first row wins and a later
 * copy of the same image changes nothing, so a decision a person already made is never overwritten.
 * @returns {Promise<boolean>} true when a new row was added
 */
async function queueForReview(sql, row) {
  const result = await sql.query(
    `INSERT INTO copyright_review_queue
       (network, platform_ad_id, advertiser, image_url, internal_ad_id, media_role, ordinal, sha256, phash, phash_algo,
        blocklist_id, distance, status, note, created_at)
     VALUES (?, ?, NULL, ?, ?, 'creative', 0, ?, ?, ?, ?, ?, 'pending', ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [row.network, cut(row.platformAdId, 255), cut(row.imageUrl, 2048), cut(row.internalAdId, 255), row.sha256, row.phash,
      cut(row.phashAlgo, 16), row.blocklistId, row.distance ?? null, cut(row.note, 512), utc()]
  );
  return Boolean(result?.affectedRows);
}


/**
 * Record the hashes of images, one row per ad image (copyright_image_hashes): what a later complaint is searched against, so a
 * complaint can be swept across every stored image without hashing them again. Idempotent on the slot (network, platform ad id, role,
 * ordinal): a repeat changes nothing. Ingestion never reads this table. Rows without a platform ad id are not recorded (the column
 * is NOT NULL and the slot needs it).
 * @returns {Promise<number>} rows added
 */
async function recordHashes(sql, rows) {
  const list = (rows || []).filter((r) => r && r.sha256 && r.platformAdId !== null && r.platformAdId !== undefined && String(r.platformAdId) !== '');
  if (!list.length) return 0;
  const now = utc();
  const params = [];
  for (const r of list) {
    params.push(r.network, cut(r.internalAdId, 255) ?? '', cut(r.platformAdId, 255), r.mediaRole || 'creative', Number.isInteger(r.ordinal) ? r.ordinal : 0,
      r.sha256, r.phash || null, r.phash ? cut(r.phashAlgo, 16) : null, cut(r.sourceUrl, 2048) ?? '', cut(r.storagePath, 2048) ?? '', r.source || 'ingest', now);
  }
  const result = await sql.query(
    `INSERT INTO copyright_image_hashes
       (network, internal_ad_id, platform_ad_id, media_role, ordinal, sha256, phash, phash_algo, source_url, storage_path, source, created_at)
     VALUES ${list.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE id = id`,
    params
  );
  return result?.affectedRows ?? list.length;
}

const REVIEW_STATUS = Object.freeze(['pending', 'allowed', 'blocked']);

/** The review queue of a network, oldest first, by primary key. @returns {Promise<Array>} */
async function listReview(sql, { network, status = 'pending', afterId = 0, limit = 50 } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const after = Number.isSafeInteger(Number(afterId)) && Number(afterId) > 0 ? Number(afterId) : 0;
  return sql.query(
    `SELECT id, network, platform_ad_id, internal_ad_id, advertiser, image_url, media_role, ordinal, sha256, phash, phash_algo,
            blocklist_id, distance, status, reviewed_by, reviewed_at, note, created_at
       FROM copyright_review_queue
      WHERE network = ? AND status = ? AND id > ?
      ORDER BY id
      LIMIT ${n}`,
    [network, REVIEW_STATUS.includes(status) ? status : 'pending', after]
  );
}

async function getReview(sql, network, id) {
  const rows = await sql.query(
    `SELECT id, network, platform_ad_id, internal_ad_id, image_url, sha256, phash, phash_algo, blocklist_id, distance, status
       FROM copyright_review_queue WHERE id = ? AND network = ? LIMIT 1`,
    [id, network]
  );
  return rows[0] || null;
}

/** Decide a pending row (never a row already decided, so a decision is never overwritten). @returns {Promise<boolean>} */
async function resolveReview(sql, { network, id, status, reviewedBy, note }) {
  const result = await sql.query(
    `UPDATE copyright_review_queue
        SET status = ?, reviewed_by = ?, reviewed_at = ?, note = ?
      WHERE id = ? AND network = ? AND status = 'pending'`,
    [status, cut(reviewedBy, 128), utc(), cut(note, 512), id, network]
  );
  return Boolean(result?.affectedRows);
}

/**
 * Write what a hash job did with images (copyright_image_hash_results): one row per (job, generation, ad, image). Idempotent: a repeated
 * page (a resumed job) updates the same rows. Identifiers and outcomes only. @returns {Promise<number>} rows written
 */
async function recordJobResults(sql, rows, { network, jobId, blocklistId, generation }) {
  const list = (rows || []).filter((r) => r && r.outcome && r.sourceUrl !== undefined);
  if (!list.length) return 0;
  const now = utc();
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200);
    const params = [];
    for (const r of chunk) {
      params.push(network, jobId, blocklistId, generation, cut(r.platformAdId, 255), cut(r.adId, 255) ?? '', slotHash(r.sourceUrl),
        cut(r.sourceUrl, 2048) ?? '', r.outcome, cut(r.reason, 128) ?? '', r.sha256 || null, now, now);
    }
    await sql.query(
      `INSERT INTO ${RESULTS_TABLE}
         (network, job_id, blocklist_id, generation, platform_ad_id, internal_ad_id, slot_hash, source_url, outcome, reason, sha256, created_at, updated_at)
       VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
       ON DUPLICATE KEY UPDATE platform_ad_id = VALUES(platform_ad_id), outcome = VALUES(outcome), reason = VALUES(reason),
         sha256 = VALUES(sha256), updated_at = VALUES(updated_at)`,
      params
    );
  }
  return list.length;
}

/** Jobs of a network by id order (the real ones: not the sweep / backfill cursor rows), optionally one entry or one status. */
async function listJobs(sql, { network, jobId, blocklistId, status, afterId = 0, limit = 50 } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const where = ['network = ?', 'id > ?', 'blocklist_id > 0', `blocklist_id <= ${LAST_REAL_ENTRY}`];
  const params = [network, Number.isSafeInteger(Number(afterId)) && Number(afterId) > 0 ? Number(afterId) : 0];
  if (jobId !== undefined && jobId !== null && jobId !== '') { where.push('id = ?'); params.push(Number(jobId)); }
  if (blocklistId !== undefined && blocklistId !== null && blocklistId !== '') { where.push('blocklist_id = ?'); params.push(Number(blocklistId)); }
  if (status) { where.push('status = ?'); params.push(String(status)); }
  return sql.query(
    `SELECT id, network, blocklist_id, entry_type, identifier_namespace, advertiser_name, complaint_id, status, attempts, requested_gen, run_gen, covered_gen,
            requested_at, last_error, created_at, updated_at, finished_at, state
       FROM ${JOBS_TABLE}
      WHERE ${where.join(' AND ')}
      ORDER BY id
      LIMIT ${n}`,
    params
  );
}

/** The results of one run (generation) of one job, by id. outcome is optional ('hashed', 'duplicate', 'skipped', 'failed'). */
async function listJobResults(sql, { network, jobId, generation, outcome, afterId = 0, limit = 200 } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
  const where = ['network = ?', 'job_id = ?', 'generation = ?', 'id > ?'];
  const params = [network, jobId, generation, Number.isSafeInteger(Number(afterId)) && Number(afterId) > 0 ? Number(afterId) : 0];
  if (outcome) { where.push('outcome = ?'); params.push(String(outcome)); }
  return sql.query(
    `SELECT id, job_id, blocklist_id, generation, platform_ad_id, internal_ad_id, source_url, outcome, reason, sha256, created_at, updated_at
       FROM ${RESULTS_TABLE}
      WHERE ${where.join(' AND ')}
      ORDER BY id
      LIMIT ${n}`,
    params
  );
}

const jobRepository = {
  findNewAdvertisers, createJobs, claimNext, loadState, saveProgress, finish, release,
  findReblocked, requestRun, requestReblocked, resumeLimited, recordJobResults, listJobs, listJobResults,
  sweepEnsure, sweepClaim, sweepSave, sweepRelease, queueForReview,
  recordHashes, listReview, getReview, resolveReview,
};

// ═══ 2. DbCheckpoint ═══
/**
 * A hashing job's saved place, kept in its row of copyright_image_hash_jobs (the worker's
 * what HashJob saves after every page). Two methods, load and save.
 *
 * Every save also renews the worker's claim on the job. If the claim is gone (the job was too slow
 * and another worker took it over), save() throws ClaimLostError and the run stops at once, so two
 * workers never write the same job's progress.
 */

class ClaimLostError extends Error {
  constructor(jobId) {
    super(`this worker no longer holds hash job ${jobId}`);
    this.name = 'ClaimLostError';
    this.jobId = jobId;
  }
}

class DbCheckpoint {
  /** @param {{ sql: Object, workerId: string, repo?: Object }} deps */
  constructor({ sql, workerId, repo = jobRepository }) {
    this.sql = sql;
    this.workerId = workerId;
    this.repo = repo;
  }

  /** The saved state, or null when there is none (or it cannot be read). */
  async load(jobId) {
    const raw = await this.repo.loadState(this.sql, Number(jobId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  async save(jobId, state) {
    const held = await this.repo.saveProgress(this.sql, Number(jobId), this.workerId, JSON.stringify(state));
    if (!held) throw new ClaimLostError(jobId);
  }
}

// ═══ 3. HashWorker ═══
/**
 * The background worker that hashes the images of every blocked advertiser, by itself.
 *
 * It is run by the project's cron manager (part 4 below). On every tick, for each
 * network it covers:
 *
 *   1. finds blocked advertisers (blocklist entries of type advertiser / page) that have no job yet
 *      and creates one job for each (copyright_image_hash_jobs);
 *   2. claims the oldest job that is waiting, or whose worker has died, and runs it with HashJob
 *      (owner -> ads -> images -> hashes -> image_hash entries in the blocklist);
 *   3. records how it ended.
 *
 * So whatever way an advertiser gets into the blocklist (the complaint form, a script,
 * a seed), its images get hashed without anyone running anything. It reads the ad tables and writes only the
 * blocklist and the job table. It never deletes.
 *
 * One job at a time per network, with the job limits (pages of ads, a pause between
 * pages, an image cap). A job survives a restart: its place is in its row, and a job whose worker died
 * (no heartbeat for staleClaimMinutes) is taken over by the next tick.
 *
 * How a job ends (JOB in part 1):
 *   done / no_owner / limit_reached   final. no_owner = no advertiser of that name has ads (yet); limit_reached = the image cap
 *   failed                            gave up after maxAttempts, or the request itself was unusable (see last_error)
 *   pending again                     a stop, a service problem or a bad key: tried again later; the worker also pauses
 *
 * It never throws out of tick(): one network's or one job's problem does not stop the others.
 */

const os = require('os');
const { STATUS } = require('./job');

const DEFAULTS = Object.freeze({
  staleClaimMinutes: 60,
  maxAttempts: 3,
  pauseSeconds: 300,
  newJobsPerTick: 100,
  maxJobsPerTick: 20,
  addedBy: 'imagematch-worker',
});

// The service, its key or the database is the problem, not the job: wait, and do not count the try.
const CONFIGURATION = new Set([STATUS.UNAUTHORIZED, STATUS.NOT_CONFIGURED, STATUS.SERVICE_NOT_READY, STATUS.HASH_VERSION_MISMATCH]);
// A temporary problem: try again, and count the try (so a job that always fails ends as failed).
const TEMPORARY = new Set([STATUS.SERVICE_UNAVAILABLE, STATUS.DATABASE_WRITE_FAILED]);
// The result is final.
const FINAL = new Map([
  [STATUS.DONE, JOB.DONE],
  [STATUS.NO_OWNER, JOB.NO_OWNER],
  [STATUS.LIMIT_REACHED, JOB.LIMIT_REACHED],
  [STATUS.UNRESOLVED, JOB.UNRESOLVED], // the ads of a URL block could not be found: final, and never counted as covered
]);

const workerIdOf = () => `${os.hostname()}:${process.pid}`.replace(/[^\x20-\x7e]/g, '?').slice(0, 128);

class HashWorker {
  /**
   * @param {Object} deps
   * @param {string[]} deps.networks   the networks to cover (each must be supported by sources.js)
   * @param {(network:string)=>?Object} deps.getSql
   * @param {(ctx:{network, sql, checkpoint})=>Object} deps.makeJob   builds a HashJob for one job
   * @param {?ImageBackfill} [deps.backfill]  hashes every stored image with the time a pass has left (needs a time budget)
   * @param {?NewAdSweeper} [deps.sweeper]  the check of new ads (stage 4); run before the hashing jobs, with a part of the budget
   * @param {Object} [deps.config]     overrides of DEFAULTS
   * @param {Object} [deps.repo]       jobRepository (injectable for tests)
   * @param {Object} [deps.log]
   * @param {()=>Date} [deps.now]
   * @param {string} [deps.workerId]
   */
  constructor({ networks, getSql, makeJob, sweeper, backfill, config, repo, log, now, workerId }) {
    this.networks = networks || [];
    this.getSql = getSql;
    this.makeJob = makeJob;
    this.sweeper = sweeper || null;
    this.backfill = backfill || null;
    this.config = { ...DEFAULTS, ...(config || {}) };
    this.repo = repo || jobRepository;
    this.log = log || { info() {}, warn() {}, error() {} };
    this.now = now || (() => new Date());
    this.workerId = workerId || workerIdOf();
    this.pauseUntil = 0;
  }

  // ── one pass ─────────────────────────────────────────────────────────

  /**
   * One pass over the networks.
   *
   * @param {{ budgetMs?: number }} [options]  A time budget for the whole pass. When it is used up, the job that is running
   *   stops after the page it is on and goes back to the queue with its place saved (the try is not counted), and no further
   *   network is started. The next pass continues from there. Without a budget a job runs until it ends. This is what keeps a
   *   cron pass short and its load steady, however big the advertiser is.
   * @returns {Promise<{ paused?: boolean, budgetUsed?: boolean, created: number, ran: Array<Object> }>}
   */
  async tick({ budgetMs } = {}) {
    const summary = { created: 0, ran: [] };
    if (this.now().getTime() < this.pauseUntil) return { ...summary, paused: true };
    const deadline = Number.isFinite(budgetMs) && budgetMs > 0 ? this.now().getTime() + budgetMs : null;

    for (const network of this.networks) {
      if (this.now().getTime() < this.pauseUntil) { summary.paused = true; break; }
      if (deadline !== null && this.now().getTime() >= deadline) { summary.budgetUsed = true; break; }
      try {
        const sql = this.getSql(network);
        if (!sql) {
          this.log.warn('no SQL connection for the hashing worker; network skipped', { network });
          continue;
        }
        if (this.sweeper) {
          const share = deadline === null ? null : (deadline - this.now().getTime()) * this.sweeper.budgetShare;
          const swept = await this.sweeper.sweep(network, sql, { workerId: this.workerId, deadline: share === null ? null : this.now().getTime() + share });
          if (swept.checked || swept.matched || swept.problem) (summary.swept ||= []).push(swept);
          if (swept.pause) this.pause(swept.pause);
          if (this.now().getTime() < this.pauseUntil) { summary.paused = true; break; }
        }
        // A block repeated after its job was made asks for a new run (a new generation); a failure here never stops the jobs.
        if (this.repo.requestReblocked) {
          try {
            const again = await this.repo.requestReblocked(sql, network);
            if (again) this.log.info('blocked again: hash jobs asked to run again', { network, count: again });
          } catch (err) {
            this.log.warn('could not look for re-blocked entries', { network, error: err.message });
          }
        }
        summary.created += await this.discover(network, sql);
        // With a time budget (the cron) several small jobs finish one after another in the same pass; a job cut off by the budget
        // (or lost to another worker) ends the pass. Without a budget one job runs, as before.
        const most = deadline === null ? 1 : this.config.maxJobsPerTick;
        for (let n = 0; n < most; n += 1) {
          const ran = await this.runOne(network, sql, deadline);
          if (!ran) break;
          summary.ran.push(ran);
          if (ran.outcome === JOB.PENDING || ran.outcome === 'claim_lost' || this.now().getTime() < this.pauseUntil) break;
          if (deadline !== null && this.now().getTime() >= deadline) break;
        }
        // The backfill only gets the time that is left, and never runs without a budget.
        if (this.backfill && deadline !== null && this.now().getTime() < deadline && this.now().getTime() >= this.pauseUntil) {
          const filled = await this.backfill.run(network, sql, { workerId: this.workerId, deadline });
          if (filled.hashed || filled.recorded || filled.problem || filled.pause) (summary.backfill ||= []).push(filled);
          if (filled.pause) this.pause(filled.pause);
        }
      } catch (err) {
        this.log.error('hashing worker pass failed for a network', { network, error: err.message });
      }
    }
    return summary;
  }

  /** Create a job for each blocked advertiser that has none. @returns {Promise<number>} jobs created */
  async discover(network, sql) {
    const entries = await this.repo.findNewAdvertisers(sql, network, { limit: this.config.newJobsPerTick });
    if (!entries.length) return 0;
    await this.repo.createJobs(sql, network, entries);
    this.log.info('hash jobs created for blocked advertisers', { network, count: entries.length });
    return entries.length;
  }

  /**
   * Claim and run one job. `deadline` (ms since epoch) is the end of the pass's time budget: at that time the job is asked to
   * stop after its current page.
   * @returns {Promise<?Object>} what happened, or null when there was no job
   */
  async runOne(network, sql, deadline = null) {
    const staleBefore = new Date(this.now().getTime() - this.config.staleClaimMinutes * 60 * 1000);
    const job = await this.repo.claimNext(sql, network, this.workerId, staleBefore);
    if (!job) return null;

    const checkpoint = new DbCheckpoint({ sql, workerId: this.workerId, repo: this.repo });
    // What the run does with each image is written to copyright_image_hash_results under this run's generation.
    const generation = Number(job.run_gen) > 0 ? Number(job.run_gen) : 1;
    const results = this.repo.recordJobResults
      ? { record: (rows) => this.repo.recordJobResults(sql, rows, { network, jobId: job.id, blocklistId: job.blocklist_id, generation }) }
      : null;
    const runner = this.makeJob({ network, sql, checkpoint, results });
    this.log.info('hashing the images of a blocked advertiser', { network, jobId: job.id, advertiser: job.advertiser_name, attempt: job.attempts });
    const budgetTimer = deadline === null ? null : setTimeout(() => runner.requestStop(), Math.max(deadline - this.now().getTime(), 0));
    try {
      const saved = await checkpoint.load(job.id);
      const result = await runner.run({
        names: [job.advertiser_name],
        apply: true,
        jobId: String(job.id),
        resume: Boolean(saved),
        addedBy: this.config.addedBy,
        reason: `auto: advertiser "${job.advertiser_name}" is blocked`,
        complaintId: job.complaint_id || undefined,
        entry: { type: job.entry_type || 'advertiser', identifierNamespace: job.identifier_namespace, value: job.advertiser_name },
        generation,
      });
      return await this.settle(sql, job, result);
    } catch (err) {
      if (err instanceof ClaimLostError) {
        this.log.warn('another worker took over a hash job', { network, jobId: job.id });
        return { jobId: job.id, network, outcome: 'claim_lost' };
      }
      this.log.error('a hash job crashed', { network, jobId: job.id, error: err.message });
      return this.retryOrFail(sql, job, err.message, { network });
    } finally {
      clearTimeout(budgetTimer);
    }
  }

  /** Record how a job ended. */
  async settle(sql, job, result) {
    const base = { jobId: job.id, network: job.network, status: result.status };
    const message = result.message || null;

    if (FINAL.has(result.status)) {
      await this.repo.finish(sql, job.id, this.workerId, FINAL.get(result.status), { error: result.status === STATUS.DONE ? null : message });
      return { ...base, outcome: FINAL.get(result.status), stats: result.stats };
    }
    if (result.status === STATUS.STOPPED) {
      await this.repo.release(sql, job.id, this.workerId, { refundAttempt: true });
      return { ...base, outcome: JOB.PENDING };
    }
    if (CONFIGURATION.has(result.status)) {
      await this.repo.release(sql, job.id, this.workerId, { refundAttempt: true, error: `${result.status}: ${message || ''}` });
      this.pause(`the hashing service or its key is not usable (${result.status})`);
      return { ...base, outcome: JOB.PENDING, paused: true };
    }
    if (TEMPORARY.has(result.status)) {
      this.pause(`a temporary problem (${result.status})`);
      return this.retryOrFail(sql, job, `${result.status}: ${message || ''}`, base);
    }
    // TOO_MANY_OWNERS, INVALID_INPUT, JOB_EXISTS, ...: the request itself cannot work, so trying again will not help.
    await this.repo.finish(sql, job.id, this.workerId, JOB.FAILED, { error: `${result.status}: ${message || ''}` });
    return { ...base, outcome: JOB.FAILED };
  }

  /** Back to the queue, or failed for good after maxAttempts. */
  async retryOrFail(sql, job, error, base) {
    if (job.attempts >= this.config.maxAttempts) {
      await this.repo.finish(sql, job.id, this.workerId, JOB.FAILED, { error });
      return { ...base, jobId: job.id, outcome: JOB.FAILED };
    }
    await this.repo.release(sql, job.id, this.workerId, { error });
    return { ...base, jobId: job.id, outcome: JOB.PENDING };
  }

  pause(reason) {
    this.pauseUntil = this.now().getTime() + this.config.pauseSeconds * 1000;
    this.log.warn(`hashing worker paused for ${this.config.pauseSeconds} s: ${reason}`);
  }
}

// ═══ 4. NewAdSweeper ═══
/**
 * Stage 4 of B2: the check of NEW ads against the banned images, without touching the insertion path.
 *
 * Each pass, for one network: the ads added since the last pass (a primary-key range after a saved cursor, never a scan of
 * old ads) -> their stored images -> the hashing service -> matcher.decide() against the banned images already in memory
 * (blocklist.getImageHashes) -> what matches is put in copyright_review_queue (pending) and logged in
 * copyright_blocked_attempts. It never deletes or changes an ad: the queue is for a person, and takedown stays B3's work.
 *
 * - The cursor starts at the newest ad when the sweep is first switched on: older ads are the hashing worker's and B3's work.
 * - An ad is looked at only on the pass AFTER the one that first saw its id (the "horizon"), so an insert that commits a
 *   little late is not skipped.
 * - Only exact copies (same sha256) match until compliance.imageMatch.perceptual.enabled is set after the distances are tuned.
 * - If the banned list cannot be trusted, nothing is checked and the cursor does not move (the ads are checked later).
 * - If the hashing service fails for every image of a page, the cursor stays and the page is retried on the next pass; a
 *   page where some images hashed moves on (the ones that failed are counted).
 * - If nothing is banned yet, the cursor moves without calling the service.
 */
class NewAdSweeper {
  /**
   * @param {Object} deps
   * @param {Object} deps.client       ImageHashClient
   * @param {Object} deps.blocklist    B1 service: getImageHashes(network), recordAttempt(input)
   * @param {Object} deps.matcher      { decide }
   * @param {(network:string)=>Object} deps.sourceFor
   * @param {Object} deps.sources      { newAdsPage, maxAdId, variantImages, toFetchableUrl }
   * @param {Object} [deps.repo]       jobRepository (injectable for tests)
   * @param {Object} deps.options      { pageSize, staleClaimMinutes, budgetShare, hashVersion, perceptual, cdnBase }
   */
  constructor({ client, blocklist, matcher, sourceFor, sources, repo, options, log, now }) {
    this.client = client;
    this.blocklist = blocklist;
    this.matcher = matcher;
    this.sourceFor = sourceFor;
    this.sources = sources;
    this.repo = repo || jobRepository;
    this.options = { pageSize: 100, staleClaimMinutes: 10, budgetShare: 0.4, hashVersion: 'sscd-simhash-v1', perceptual: {}, cdnBase: '', ...(options || {}) };
    this.log = log || { info() {}, warn() {}, error() {} };
    this.now = now || (() => new Date());
    this.budgetShare = Math.min(Math.max(Number(this.options.budgetShare) || 0.4, 0.1), 0.9);
  }

  /** @returns {Promise<{ network, checked, matched, skipped, lag, pause?, problem? }>} never throws */
  async sweep(network, sql, { workerId, deadline = null } = {}) {
    const out = { network, checked: 0, matched: 0, skipped: 0, lag: 0 };
    let held = false;
    try {
      const source = this.sourceFor(network);
      let top = await this.sources.maxAdId(sql, source);
      await this.repo.sweepEnsure(sql, network, JSON.stringify({ lastAdId: top, horizon: top }));
      const stale = new Date(this.now().getTime() - this.options.staleClaimMinutes * 60 * 1000);
      const claim = await this.repo.sweepClaim(sql, network, workerId, stale);
      if (!claim) return { ...out, problem: 'another worker holds the cursor' };
      held = true;

      const state = parseState(claim.state, top);
      const banned = this.blocklist.getImageHashes(network);
      if (!banned.available) return { ...out, problem: `the banned images are not loaded (${banned.status}); nothing checked` };

      const upTo = Math.min(state.horizon, top);
      const idle = banned.hashes.length === 0;
      while (state.lastAdId < upTo) {
        if (deadline !== null && this.now().getTime() >= deadline) break;
        const ads = await this.sources.newAdsPage(sql, source, state.lastAdId, upTo, this.options.pageSize);
        if (!ads.length) { state.lastAdId = upTo; break; }
        const page = idle && !this.options.recordHashes ? { ok: true } : await this.checkPage(network, sql, source, ads, banned, out);
        if (page.pause) { out.pause = page.pause; break; }
        if (!page.ok) { out.problem = page.problem; break; } // the service failed for the whole page: stay, retry next pass
        state.lastAdId = ads[ads.length - 1].id;
        if (!(await this.repo.sweepSave(sql, network, workerId, JSON.stringify(state)))) { held = false; out.problem = 'the cursor was taken over'; return out; }
      }
      // The next pass may look at everything seen so far; it was visible for at least one pass.
      if (state.lastAdId >= upTo) state.horizon = Math.max(top, upTo);
      out.lag = Math.max(top - state.lastAdId, 0);
      await this.repo.sweepSave(sql, network, workerId, JSON.stringify(state), out.problem || null);
    } catch (err) {
      this.log.error('new-ad sweep failed', { network, error: err.message });
      out.problem = err.message;
    } finally {
      if (held) { try { await this.repo.sweepRelease(sql, network, workerId); } catch { /* the claim expires by itself */ } }
    }
    return out;
  }

  /** Hash the images of one page of ads and queue the matches. @returns {Promise<{ ok: boolean, problem?, pause? }>} */
  async checkPage(network, sql, source, ads, banned, out) {
    const rows = await imageRowsOf(this.sources, sql, source, ads.map((a) => a.id), this.options.includeCarousel === true);
    const platformOf = new Map(ads.map((a) => [String(a.id), a.platformId]));
    const images = collectImages(this.sources, this.options.cdnBase, rows, platformOf, out);
    if (!images.length) return { ok: true };

    const results = await Promise.all(images.map((img) => this.client.hashUrl(img.url)));
    let hashed = 0;
    let unavailable = 0;
    const toRecord = [];
    for (let i = 0; i < images.length; i++) {
      const res = results[i];
      if (res.ok) {
        hashed++;
        out.checked++;
        await this.judge(network, sql, images[i], res, banned, out);
        if (this.options.recordHashes) {
          toRecord.push({
            network, internalAdId: images[i].adId, platformAdId: images[i].platformId, mediaRole: images[i].role, ordinal: images[i].ordinal,
            sha256: res.sha256, phash: res.sscdHash, phashAlgo: this.options.hashVersion, sourceUrl: images[i].url, storagePath: images[i].stored, source: 'ingest',
          });
        }
      } else if (res.outcome === 'unauthorized' || res.outcome === 'not_configured') {
        return { ok: false, pause: `the hashing service or its key is not usable (${res.outcome})` };
      } else {
        if (res.outcome === 'unavailable') unavailable++;
        out.skipped++; // this image could not be hashed (unavailable, skip, rejected, bad_response)
      }
    }
    if (!hashed && unavailable) return { ok: false, problem: 'the hashing service is unavailable' };
    if (toRecord.length) {
      try { await this.repo.recordHashes(sql, toRecord); } catch (err) { this.log.warn('could not record image hashes', { network, error: err.message }); }
    }
    return { ok: true };
  }

  async judge(network, sql, image, hashed, banned, out) {
    const verdict = this.matcher.decide(banned, { sha256: hashed.sha256, words: hashed.words }, { perceptual: this.options.perceptual, hashVersion: this.options.hashVersion });
    if (verdict.action !== 'reject' && verdict.action !== 'review') return;
    out.matched++;
    await this.repo.queueForReview(sql, {
      network, platformAdId: image.platformId, internalAdId: image.adId, imageUrl: image.url,
      sha256: hashed.sha256, phash: hashed.sscdHash, phashAlgo: this.options.hashVersion,
      blocklistId: verdict.entry.id, distance: verdict.distance,
      note: `new-ad sweep: ${verdict.kind === 'sha256' ? 'same file' : 'similar image'} (${verdict.action})`,
    });
    this.blocklist.recordAttempt({
      network, platformAdId: image.platformId, imageUrl: image.url, blocklistId: verdict.entry.id,
      matchType: verdict.kind, distance: verdict.distance, source: 'imagematch-sweep',
    });
  }
}

/** The saved cursor; a missing or broken one starts at `top` (only ads from now on). */
function parseState(raw, top) {
  try {
    const p = JSON.parse(raw);
    const last = Number(p?.lastAdId);
    const horizon = Number(p?.horizon);
    if (Number.isSafeInteger(last) && last >= 0) return { lastAdId: last, horizon: Number.isSafeInteger(horizon) && horizon >= last ? horizon : last };
  } catch { /* fall through */ }
  return { lastAdId: top, horizon: top };
}

// ═══ 4b. ImageBackfill ═══
/**
 * Records the hash of EVERY image already stored (copyright_image_hashes), so that a future complaint can be swept across the whole
 * store with a database read instead of hashing millions of images again (see searchStored below). It is the lowest priority of the
 * cron pass: it only gets the time that is left after the new-ad sweep and the hashing jobs, and it stops at the pass's deadline.
 *
 * - Walks the ad table by primary key from `fromId` up to the newest ad at the moment it first ran (the sweep takes the ads after that),
 *   one page at a time, saving its place after every page; a restart or another machine continues from it. Its cursor is a reserved
 *   row of copyright_image_hash_jobs (status 'backfill'); finished, it costs nothing more.
 * - Read-only on the ad tables; the only writes are the rows it records and its own cursor. It never deletes.
 * - The service takes about 6 images per second in total, so a million images is about two days of the time left over: that is why
 *   it is a background job. Paths that are not image files (a video id) are skipped before the call.
 * - OFF by default (compliance.imageMatch.backfill.enabled).
 */

/**
 * The image rows of some ads: their main images and, when asked for (job.includeCarousel), their carousel images. A carousel row is
 * tagged, so that it gets image slots of its own (role 'carousel') and never takes the place of a main image.
 */
async function imageRowsOf(sources, sql, source, adIds, includeCarousel) {
  const rows = await sources.variantImages(sql, source, adIds);
  if (includeCarousel && typeof sources.carouselImages === 'function') {
    for (const r of await sources.carouselImages(sql, source, adIds)) rows.push({ ...r, role: 'carousel' });
  }
  return rows;
}

/** The usable images of a page: [{ adId, platformId, url, stored, ordinal, role }]. Skips what the service could not fetch (no file, the default image, no image extension) and a URL seen twice on the page. */
function collectImages(sources, cdnBase, rows, platformOf, counters) {
  const images = [];
  const seenUrls = new Set();
  const perAd = new Map();
  for (const r of rows) {
    const stored = typeof r.image_url === 'string' ? r.image_url.trim() : '';
    const url = !stored || /DefaultImage/i.test(stored) ? '' : sources.toFetchableUrl(stored, cdnBase);
    if (!url || !hasImageExtension(url) || seenUrls.has(url)) { counters.skipped++; continue; }
    seenUrls.add(url);
    const key = String(r.ad_id);
    const role = r.role || 'creative';
    const slot = `${role}|${key}`;
    const ordinal = perAd.get(slot) || 0;
    perAd.set(slot, ordinal + 1);
    images.push({ adId: r.ad_id, platformId: platformOf.get(key) ?? null, url, stored, ordinal, role });
  }
  return images;
}

class ImageBackfill {
  /**
   * @param {Object} deps
   * @param {Object} deps.client      ImageHashClient
   * @param {(network:string)=>Object} deps.sourceFor
   * @param {Object} deps.sources     { newAdsPage, maxAdId, variantImages, toFetchableUrl }
   * @param {Object} [deps.repo]      jobRepository (injectable for tests)
   * @param {Object} deps.options     { pageSize, fromId, staleClaimMinutes, hashVersion, cdnBase }
   */
  constructor({ client, sourceFor, sources, repo, options, log, now }) {
    this.client = client;
    this.sourceFor = sourceFor;
    this.sources = sources;
    this.repo = repo || jobRepository;
    this.options = { pageSize: 100, fromId: 0, staleClaimMinutes: 10, hashVersion: 'sscd-simhash-v1', cdnBase: '', ...(options || {}) };
    this.log = log || { info() {}, warn() {}, error() {} };
    this.now = now || (() => new Date());
    this.finished = new Set(); // networks whose backfill is complete (known for the life of the process)
  }

  /** One slice of work on one network, until `deadline` (ms since epoch). @returns {Promise<{ network, hashed, recorded, skipped, remaining?, done?, pause?, problem? }>} never throws */
  async run(network, sql, { workerId, deadline = null } = {}) {
    const out = { network, hashed: 0, recorded: 0, skipped: 0 };
    if (this.finished.has(network)) return { ...out, done: true };
    if (deadline === null) return { ...out, problem: 'no time budget: the backfill only runs inside a timed pass' };
    let held = false;
    try {
      const source = this.sourceFor(network);
      const fromId = Math.max(Number(this.options.fromId) || 0, 0);
      const top = await this.sources.maxAdId(sql, source);
      await this.repo.sweepEnsure(sql, network, JSON.stringify({ lastAdId: fromId, upToId: top, done: false, recorded: 0 }), BACKFILL);
      const stale = new Date(this.now().getTime() - this.options.staleClaimMinutes * 60 * 1000);
      const claim = await this.repo.sweepClaim(sql, network, workerId, stale, BACKFILL);
      if (!claim) return { ...out, problem: 'another worker holds the backfill cursor' };
      held = true;

      const state = parseBackfill(claim.state, fromId, top);
      while (!state.done) {
        if (this.now().getTime() >= deadline) break;
        const ads = await this.sources.newAdsPage(sql, source, state.lastAdId, state.upToId, this.options.pageSize);
        if (!ads.length) { state.done = true; break; }
        const page = await this.hashPage(network, sql, source, ads, out);
        if (page.pause) { out.pause = page.pause; break; }
        if (!page.ok) { out.problem = page.problem; break; } // the service failed for the whole page: stay, try again next pass
        state.lastAdId = ads[ads.length - 1].id;
        state.recorded += page.recorded;
        if (state.lastAdId >= state.upToId || ads.length < this.options.pageSize) state.done = true;
        if (!(await this.repo.sweepSave(sql, network, workerId, JSON.stringify(state), null, BACKFILL))) { held = false; out.problem = 'the backfill cursor was taken over'; return out; }
      }
      await this.repo.sweepSave(sql, network, workerId, JSON.stringify(state), out.problem || null, BACKFILL);
      out.remaining = Math.max(state.upToId - state.lastAdId, 0);
      if (state.done) {
        this.finished.add(network);
        out.done = true;
        this.log.info('image backfill finished', { network, imagesRecorded: state.recorded });
      }
    } catch (err) {
      this.log.error('image backfill failed', { network, error: err.message });
      out.problem = err.message;
    } finally {
      if (held) { try { await this.repo.sweepRelease(sql, network, workerId, BACKFILL); } catch { /* the claim expires by itself */ } }
    }
    return out;
  }

  /** Hash the images of one page and record them. @returns {Promise<{ ok: boolean, recorded: number, problem?, pause? }>} */
  async hashPage(network, sql, source, ads, out) {
    const rows = await imageRowsOf(this.sources, sql, source, ads.map((a) => a.id), this.options.includeCarousel === true);
    const platformOf = new Map(ads.map((a) => [String(a.id), a.platformId]));
    const images = collectImages(this.sources, this.options.cdnBase, rows, platformOf, out);
    if (!images.length) return { ok: true, recorded: 0 };

    const results = await Promise.all(images.map((img) => this.client.hashUrl(img.url)));
    const toRecord = [];
    let hashed = 0;
    let unavailable = 0;
    results.forEach((res, i) => {
      if (res.ok) {
        hashed++;
        out.hashed++;
        toRecord.push({
          network, internalAdId: images[i].adId, platformAdId: images[i].platformId, mediaRole: images[i].role, ordinal: images[i].ordinal,
          sha256: res.sha256, phash: res.sscdHash, phashAlgo: this.options.hashVersion, sourceUrl: images[i].url, storagePath: images[i].stored, source: 'backfill',
        });
      } else if (res.outcome === 'unauthorized' || res.outcome === 'not_configured') {
        out.pauseReason = `the hashing service or its key is not usable (${res.outcome})`;
      } else {
        if (res.outcome === 'unavailable') unavailable++;
        out.skipped++;
      }
    });
    if (out.pauseReason) { const pause = out.pauseReason; delete out.pauseReason; return { ok: false, recorded: 0, pause }; }
    if (!hashed && unavailable) return { ok: false, recorded: 0, problem: 'the hashing service is unavailable' };
    const recorded = toRecord.length ? await this.repo.recordHashes(sql, toRecord) : 0;
    out.recorded += recorded;
    return { ok: true, recorded };
  }
}

/** The saved backfill cursor; a missing or broken one starts at fromId and goes up to the newest ad now. */
function parseBackfill(raw, fromId, top) {
  try {
    const p = JSON.parse(raw);
    const last = Number(p?.lastAdId);
    const upTo = Number(p?.upToId);
    if (Number.isSafeInteger(last) && last >= 0 && Number.isSafeInteger(upTo) && upTo >= 0) {
      return { lastAdId: last, upToId: upTo, done: p.done === true, recorded: Number.isSafeInteger(Number(p.recorded)) ? Number(p.recorded) : 0 };
    }
  } catch { /* fall through */ }
  return { lastAdId: fromId, upToId: top, done: false, recorded: 0 };
}

// ═══ 5. The cron runner ═══
/**
 * The cron entry of the image-hashing worker (B2): what src/jobs/cronManager.js runs for
 * `config.crons.jobs.imageHashJobs`. It makes hashing automatic: nobody starts anything per advertiser.
 *
 * On every cron tick (cronManager only runs it on ONE process of a machine, see isSingletonOwner) it does one
 * short pass of HashWorker:
 *   1. finds blocked advertisers (blocklist entries of type advertiser / page) that have no job yet, and makes a job each;
 *   2. claims the oldest waiting job and runs it for at most `timeBudgetSeconds`, then gives it back to the queue
 *      with its place saved; the next tick continues. So each tick is short and its load is steady, however big
 *      the advertiser is, and a restart loses nothing.
 *
 * Config (config.json -> crons.jobs.imageHashJobs; the file is per server and not in git):
 *   enabled            false until you switch it on
 *   schedule           how often a tick runs, e.g. "1 min"
 *   timeBudgetSeconds  longest a tick works before it stops and hands over to the next (default 240; 10..3000)
 *   window             optional "HH:MM-HH:MM" in the crons timezone (an overnight one like "22:00-05:00" works): ticks
 *                      outside it do nothing. Use it to keep hashing to quiet hours.
 * and, in compliance.imageMatch: baseUrl + the key in IMAGE_HASH_API_KEY (the service), worker.* (networks, retries, pause),
 * job.* (page size, pause between pages, image cap). See docs/COPYRIGHT_BLOCKLIST_B1_MANIFEST.md (image matching).
 *
 * Safe by construction: a tick that is still working makes the next one skip; two machines never run the same job
 * (an atomic claim in the database); it reads the ad tables with index lookups a page at a time and writes only the
 * blocklist and its own job table; it never deletes.
 *
 * run() never throws: cronManager would only log it, and a problem here must not affect anything else.
 */

// The worker class of this very file. Named here so the lookup inside buildWorker() does not see its own `HashWorker` constant.
const WORKER_MODULE = { HashWorker };
const DEFAULT_BUDGET_SECONDS = 240;
const WINDOW = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/;

const toMinutes = (h, m) => Number(h) * 60 + Number(m);

/**
 * Is `now` inside a "HH:MM-HH:MM" window, in the given time zone?
 * @returns {?boolean} null when the window text is not valid
 */
function inWindow(window, now, timeZone) {
  const match = WINDOW.exec(String(window));
  if (!match) return null;
  const [, h1, m1, h2, m2] = match;
  if (Number(h1) > 23 || Number(h2) > 23 || Number(m1) > 59 || Number(m2) > 59) return null;
  const start = toMinutes(h1, m1);
  const end = toMinutes(h2, m2);
  if (start === end) return null;

  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  } catch {
    return null; // an unknown time zone
  }
  const current = toMinutes(parts.find((p) => p.type === 'hour').value, parts.find((p) => p.type === 'minute').value);
  return start < end ? current >= start && current < end : current >= start || current < end;
}

/**
 * @param {Object} [deps]  injectable for tests; the defaults are the real application objects, loaded on first use
 * @returns {(jobCfg?: Object) => Promise<Object>} the function cronManager runs on each tick
 */
function createRunner(deps = {}) {
  let running = false;
  let worker = null;
  let client = null;
  const warned = new Set();

  const get = (name, load) => (deps[name] !== undefined ? deps[name] : load());
  const logOf = () => get('log', () => require('../../logger').createChild('image-hash-cron'));
  const warnOnce = (key, message, extra) => {
    if (warned.has(key)) return;
    warned.add(key);
    logOf().warn(message, extra);
  };

  function networksOf(imageMatch, networksConfig, sources, getSql) {
    const configured = imageMatch.worker.networks || [];
    const wanted = configured.length ? configured : Object.keys(sources).filter((n) => networksConfig[n]?.database?.sql?.enabled);
    return wanted.filter((network) => {
      if (!Object.prototype.hasOwnProperty.call(sources, network)) {
        warnOnce(`unsupported:${network}`, 'image hashing does not support this network yet (its tables must be checked in sources.js); skipped', { network });
        return false;
      }
      return Boolean(getSql(network));
    });
  }

  function buildWorker(config, networks, getSql) {
    const { ImageHashClient } = get('clientModule', () => require('./client'));
    const { HashJob } = get('jobModule', () => require('./job'));
    const { HashWorker } = get('workerModule', () => WORKER_MODULE);
    const { sourceFor } = get('sourcesModule', () => require('./sources'));
    const blocklist = get('blocklist', () => require('../blocklist/service'));
    const im = config.compliance.imageMatch;
    const log = logOf();

    client = new ImageHashClient({ config: im, log });
    const jobConfig = { ...im.job, maxImages: im.worker.maxImagesPerJob };
    const makeJob = ({ network, sql, checkpoint, results }) => new HashJob({
      network, source: sourceFor(network), sql, client, blocklist, cdnBase: config.cdn?.baseUrl || '',
      hashVersion: im.hashVersion, config: jobConfig, checkpoint, results, log,
    });
    let sweeper = null;
    if (im.sweep && im.sweep.enabled === true) {
      const sources = get('sourcesModule', () => require('./sources'));
      const matcher = get('matcherModule', () => require('./matcher'));
      sweeper = new NewAdSweeper({
        client, blocklist, matcher, sourceFor, sources, repo: deps.jobRepository, log,
        options: { ...im.sweep, hashVersion: im.hashVersion, perceptual: im.perceptual, cdnBase: config.cdn?.baseUrl || '', staleClaimMinutes: im.worker.staleClaimMinutes, includeCarousel: im.job?.includeCarousel === true },
      });
    }
    let backfill = null;
    if (im.backfill && im.backfill.enabled === true) {
      const sources = get('sourcesModule', () => require('./sources'));
      backfill = new ImageBackfill({
        client, sourceFor, sources, repo: deps.jobRepository, log,
        options: { ...im.backfill, hashVersion: im.hashVersion, cdnBase: config.cdn?.baseUrl || '', staleClaimMinutes: im.worker.staleClaimMinutes, includeCarousel: im.job?.includeCarousel === true },
      });
    }
    return new HashWorker({ networks, getSql, makeJob, sweeper, backfill, config: im.worker, repo: deps.jobRepository, log });
  }

  return async function runImageHashJobs(jobCfg = {}) {
    if (running) return { skipped: 'the previous pass is still working' };
    running = true;
    try {
      const config = get('config', () => require('../../config'));
      const im = config.compliance && config.compliance.imageMatch;
      if (!im) return { skipped: 'no compliance.imageMatch configuration' };

      if (jobCfg.window) {
        const now = deps.now ? deps.now() : new Date();
        const inside = inWindow(jobCfg.window, now, config.crons?.timezone || 'Asia/Kolkata');
        if (inside === null) {
          warnOnce('window', 'crons.jobs.imageHashJobs.window is not valid ("HH:MM-HH:MM", e.g. "01:00-06:00"); hashing is paused until it is fixed', { window: jobCfg.window });
          return { skipped: 'invalid window' };
        }
        if (!inside) return { skipped: 'outside the window' };
      }

      const databaseManager = get('databaseManager', () => require('../../database/DatabaseManager'));
      const getSql = (network) => databaseManager.getSQL(network);
      const sources = get('sources', () => require('./sources').SOURCES);
      const networksConfig = get('networksConfig', () => require('../../config/networks'));
      const networks = networksOf(im, networksConfig, sources, getSql);
      if (!networks.length) return { skipped: 'no supported network with a database connection' };

      if (!worker) worker = buildWorker(config, networks, getSql);
      if (!client.isConfigured()) {
        warnOnce('not-configured', 'image hashing is switched on but the service has no address or key (compliance.imageMatch.baseUrl / IMAGE_HASH_API_URL and IMAGE_HASH_API_KEY); nothing is hashed');
        return { skipped: 'the hashing service is not configured' };
      }
      worker.networks = networks;

      const seconds = Number.isFinite(Number(jobCfg.timeBudgetSeconds)) ? Number(jobCfg.timeBudgetSeconds) : DEFAULT_BUDGET_SECONDS;
      const budgetMs = Math.min(Math.max(seconds, 10), 3000) * 1000;
      const out = await worker.tick({ budgetMs });
      if (out.created || out.ran.length || out.swept || out.backfill) logOf().info('image-hash pass', { created: out.created, ran: out.ran.map((r) => ({ job: r.jobId, outcome: r.outcome })), swept: out.swept, backfill: out.backfill, budgetUsed: Boolean(out.budgetUsed) });
      return out;
    } catch (err) {
      try { logOf().error('image-hash pass failed', { error: err.message }); } catch { /* logging must not throw */ }
      return { error: err.message };
    } finally {
      running = false;
    }
  };
}

const runImageHashJobs = createRunner();

// ═══ 6. submitAdvertiser ═══
/**
 * The entry point for an advertiser name that arrives from the landing page (through whatever backend or approval step calls it):
 * check the name, search our data for it, add it to the blocklist, and queue the hashing of its images. It answers at once;
 * the hashing itself is the cron job's work (part 5), never part of the answer.
 *
 *   submitAdvertiser({ name, addedBy, reason?, complaintId?, network? }) ->
 *     { ok, complaintId, name, blocked: [{network, blocklistId}], failed: [{network, error}], rejected: [reason],
 *       matches: [{network, ownerId, name, ads}], totalAds, hashing: [{network, queued}] }
 *     or { ok: false, error, message } when the input is unusable
 *
 * What it costs (everything else happens later, in the background):
 *   - the search: one indexed read of the owners table per supported network (owner name lower-cased, plus its usual spellings, an
 *     index lookup with a LIMIT). The number of ads is the owner's stored ads_count: the ad table (millions of rows) is never counted
 *     or scanned here, so the figure is as fresh as that counter;
 *   - the block: blocklist.add(), the same write B1 uses (idempotent: the same name again changes nothing); it runs at the same time
 *     as the search, and from then on new ads of that name are refused;
 *   - one small insert per network that creates the hashing job at once (idempotent; the cron would also find it).
 * Public input: nothing here limits how often it is called or decides whether a request should be granted: that is the job of the
 * caller (an approval step, a rate limit). It never throws.
 */
const NAME_MIN = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NETWORK = /^[a-z0-9_-]{1,32}$/;

/** A name from a form: control characters become spaces, spaces collapse. null when it is not usable. */
function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length >= NAME_MIN && text.length <= NAME_MAX ? text : null;
}

function createIntake(deps = {}) {
  const get = (name, load) => (deps[name] !== undefined ? deps[name] : load());
  const bad = (error, message) => ({ ok: false, error, message });

  return async function submitAdvertiser({ name, addedBy, reason, complaintId, network = 'all' } = {}) {
    const clean = cleanName(name);
    if (!clean) return bad('invalid_name', `the advertiser name must be ${NAME_MIN} to ${NAME_MAX} characters`);
    const by = typeof addedBy === 'string' ? addedBy.trim() : '';
    if (!by) return bad('added_by_required', 'addedBy is required (who or what asked for this block)');
    if (complaintId !== undefined && complaintId !== null && complaintId !== '' && !UUID.test(String(complaintId))) {
      return bad('invalid_complaint_id', 'complaintId must be a UUID');
    }
    const target = String(network || 'all').trim().toLowerCase();
    if (!NETWORK.test(target)) return bad('invalid_network', 'network must be "all" or a network slug');
    const complaint = complaintId ? String(complaintId).toLowerCase() : require('crypto').randomUUID();

    try {
      const blocklist = get('blocklist', () => require('../blocklist/service'));
      const sources = get('sourcesModule', () => require('./sources'));
      const databaseManager = get('databaseManager', () => require('../../database/DatabaseManager'));
      const repo = deps.jobRepository || jobRepository;
      const getSql = (n) => databaseManager.getSQL(n);
      const supported = Object.keys(sources.SOURCES).filter((n) => (target === 'all' || n === target) && getSql(n));
      const candidates = sources.nameCandidates(clean);

      // The search and the block run at the same time; one failing search never stops the block.
      const search = Promise.all(supported.map(async (n) => {
        try {
          const rows = await sources.findOwners(getSql(n), sources.sourceFor(n), candidates);
          return rows.map((r) => ({ network: n, ownerId: r.id, name: r.name, ads: Number(r.ads_count) || 0 }));
        } catch (err) {
          return [];
        }
      }));
      const [added, found] = await Promise.all([
        blocklist.add([{ entryType: 'advertiser', value: clean, network: target, addedBy: by, reason: reason || `requested for "${clean}"`, complaintId: complaint, source: 'intake' }]),
        search,
      ]);

      const results = added.results || [];
      const blocked = results.filter((r) => r.ok).map((r) => ({ network: r.network, blocklistId: r.entries?.[0]?.blocklistId ?? null }));
      const failed = results.filter((r) => !r.ok).map((r) => ({ network: r.network, error: r.error }));
      const rejected = (added.rejected || []).map((r) => r.reason);

      // The hashing job is created now, so it is visible at once (the cron would also find the entry; creating it twice is harmless).
      const hashing = await Promise.all(blocked.filter((b) => b.blocklistId && supported.includes(b.network)).map(async (b) => {
        try {
          await repo.createJobs(getSql(b.network), b.network, [{ id: b.blocklistId, value: clean, complaint_id: complaint, entry_type: 'advertiser' }]);
          // The same name blocked again after its job finished: the job is asked to run again (a new generation), at once.
          if (repo.requestReblocked) await repo.requestReblocked(getSql(b.network), b.network).catch(() => {});
          return { network: b.network, queued: true };
        } catch (err) {
          return { network: b.network, queued: false };
        }
      }));

      const matches = found.flat();
      return {
        ok: blocked.length > 0,
        complaintId: complaint,
        name: clean,
        blocked, failed, rejected,
        matches,
        totalAds: matches.reduce((sum, m) => sum + m.ads, 0),
        hashing,
      };
    } catch (err) {
      return { ...bad('failed', err.message), complaintId: complaint, name: clean };
    }
  };
}

const submitAdvertiser = createIntake();

// ═══ 7. Review queue and search of the stored hashes ═══
/**
 * What a person (or the approval agent) does with the backend, called by the token-protected routes of services/copyrightRequest.js:
 *
 *   review.list({ network, status?, afterId?, limit? })        the held images, oldest first
 *   review.resolve({ network, id, decision, reviewedBy, note? }) decision 'allow' or 'block' on a pending row
 *       allow: the row is marked allowed; the same image against the same banned entry is never held again (the queue keeps the decision).
 *       block: the row is marked blocked AND the image itself is added to the blocklist (type image_hash, network of the row), so an exact
 *              copy of it is refused at ingestion from then on. The decision is saved first; if adding the image fails it says so
 *              (blocklistAdded: false) and nothing is undone. Deleting the ad that was found is B3's work, not done here.
 *   searchStored(sql, network, { sha256?, phash?, maxDistance?, limit? })
 *       finds the stored images (copyright_image_hashes) that are a given banned image: an exact copy by SHA-256 (indexed), near copies by
 *       reading the stored hashes in pages and comparing in the application (BIT_COUNT is 64-bit): a million stored images is a few
 *       seconds of CPU in about 200 reads of 5,000 rows. A complaint can therefore be swept across the whole store without the hashing service.
 * Nothing here deletes; every function returns a result instead of throwing.
 */
const { cleanHex, parseHash, hammingDistance } = require('./matcher');

const DECISIONS = { allow: 'allowed', block: 'blocked' };

function createReview(deps = {}) {
  const get = (name, load) => (deps[name] !== undefined ? deps[name] : load());
  const repo = deps.jobRepository || jobRepository;
  const bad = (error, message) => ({ ok: false, error, message });
  const sqlOf = (network) => get('databaseManager', () => require('../../database/DatabaseManager')).getSQL(network);
  const validNetwork = (n) => typeof n === 'string' && NETWORK.test(n.trim().toLowerCase());

  async function list({ network, status = 'pending', afterId = 0, limit = 50 } = {}) {
    if (!validNetwork(network)) return bad('invalid_network', 'network must be a network slug');
    if (!REVIEW_STATUS.includes(status)) return bad('invalid_status', `status must be one of ${REVIEW_STATUS.join(', ')}`);
    try {
      const sql = sqlOf(network.trim().toLowerCase());
      if (!sql) return bad('no_database', 'there is no database connection for that network');
      const rows = await repo.listReview(sql, { network: network.trim().toLowerCase(), status, afterId, limit });
      return { ok: true, items: rows, next: rows.length ? rows[rows.length - 1].id : null };
    } catch (err) {
      return bad('failed', err.message);
    }
  }

  async function resolve({ network, id, decision, reviewedBy, note } = {}) {
    if (!validNetwork(network)) return bad('invalid_network', 'network must be a network slug');
    const slug = network.trim().toLowerCase();
    const rowId = typeof id === 'number' ? id : (typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : NaN);
    if (!Number.isSafeInteger(rowId) || rowId <= 0) return bad('invalid_id', 'id must be a positive whole number');
    if (!Object.prototype.hasOwnProperty.call(DECISIONS, decision)) return bad('invalid_decision', 'decision must be "allow" or "block"');
    const by = typeof reviewedBy === 'string' ? reviewedBy.trim() : '';
    if (!by) return bad('reviewed_by_required', 'reviewedBy is required (who decided)');
    try {
      const sql = sqlOf(slug);
      if (!sql) return bad('no_database', 'there is no database connection for that network');
      const row = await repo.getReview(sql, slug, rowId);
      if (!row) return bad('not_found', 'no such item in the review queue');
      if (row.status !== 'pending') return { ...bad('already_resolved', 'this item was already decided'), status: row.status };
      const changed = await repo.resolveReview(sql, { network: slug, id: rowId, status: DECISIONS[decision], reviewedBy: by, note });
      if (!changed) return { ...bad('already_resolved', 'this item was already decided'), status: 'unknown' };

      const out = { ok: true, id: rowId, status: DECISIONS[decision] };
      if (decision === 'block') {
        out.blocklistAdded = false;
        try {
          const blocklist = get('blocklist', () => require('../blocklist/service'));
          const added = await blocklist.add([{
            entryType: 'image_hash', network: slug, imageSha256: row.sha256, imagePhash: row.phash || undefined, imagePhashAlgo: row.phash_algo || undefined,
            addedBy: by, reason: `confirmed copy of blocklist entry ${row.blocklist_id}`, source: 'review',
            details: JSON.stringify({ review_id: rowId, blocklist_id: row.blocklist_id, ad_id: row.platform_ad_id, internal_ad_id: row.internal_ad_id, image_url: row.image_url, distance: row.distance }),
          }]);
          out.blocklistAdded = (added.results || []).some((r) => r.ok);
          if (!out.blocklistAdded) out.message = 'the decision is saved, but the image could not be added to the blocklist: add it again';
        } catch (err) {
          out.message = `the decision is saved, but the image could not be added to the blocklist: ${err.message}`;
        }
      }
      return out;
    } catch (err) {
      return bad('failed', err.message);
    }
  }

  return { list, resolve };
}

/**
 * Stored images that are the given banned image. `sha256` finds exact copies by the index; `phash` with `maxDistance` (bits, 0..256) reads the
 * stored hashes by primary key in pages and compares in memory (only hashes of the same version are compared). Stops at `limit` matches or
 * at `deadline` (ms since epoch); `complete` says whether the whole store was read.
 * @returns {Promise<{ ok, matches: Array<{ distance, platformAdId, internalAdId, mediaRole, ordinal, sha256, storagePath, sourceUrl }>, scanned, complete }>}
 */
async function searchStored(sql, network, { sha256, phash, algo = 'sscd-simhash-v1', maxDistance = 0, limit = 1000, pageSize = 5000, deadline = null } = {}, now = () => Date.now()) {
  const cap = Math.min(Math.max(parseInt(limit, 10) || 1000, 1), 10000);
  const matches = [];
  const shape = (r, distance) => ({ distance, platformAdId: r.platform_ad_id, internalAdId: r.internal_ad_id, mediaRole: r.media_role, ordinal: r.ordinal, sha256: r.sha256, storagePath: r.storage_path, sourceUrl: r.source_url });
  const COLUMNS = 'id, platform_ad_id, internal_ad_id, media_role, ordinal, sha256, phash, phash_algo, source_url, storage_path';
  let scanned = 0;

  const exact = cleanHex(sha256);
  if (exact) {
    const rows = await sql.query(`SELECT ${COLUMNS} FROM copyright_image_hashes WHERE sha256 = ? AND network = ? LIMIT ${cap}`, [exact, network]);
    for (const r of rows) matches.push(shape(r, 0));
    scanned += rows.length;
  }

  const words = parseHash(phash);
  const reach = Math.min(Math.max(parseInt(maxDistance, 10) || 0, 0), 256);
  let complete = true;
  if (words && reach > 0) {
    complete = false;
    let lastId = 0;
    const seen = new Set(matches.map((m) => `${m.platformAdId}|${m.mediaRole}|${m.ordinal}`));
    for (;;) {
      if (matches.length >= cap || (deadline !== null && now() >= deadline)) break;
      const rows = await sql.query(
        `SELECT ${COLUMNS} FROM copyright_image_hashes WHERE id > ? AND network = ? AND phash IS NOT NULL ORDER BY id LIMIT ${Math.min(Math.max(parseInt(pageSize, 10) || 5000, 100), 20000)}`,
        [lastId, network]
      );
      if (!rows.length) { complete = true; break; }
      for (const r of rows) {
        lastId = r.id;
        scanned += 1;
        if (r.phash_algo !== algo) continue;
        const other = parseHash(r.phash);
        if (!other) continue;
        const distance = hammingDistance(words, other);
        const key = `${r.platform_ad_id}|${r.media_role}|${r.ordinal}`;
        if (distance <= reach && !seen.has(key)) { seen.add(key); matches.push(shape(r, distance)); }
        if (matches.length >= cap) break;
      }
    }
  }
  matches.sort((a, b) => a.distance - b.distance);
  return { ok: true, matches, scanned, complete };
}

const review = createReview();

// ═══ 8. What B3 reads: the jobs, their results, and asking for a run again ═══
/**
 * The hand-over to takedown (B3), on token-protected routes (services/copyrightRequest.js):
 *
 *   jobs.list({ network, jobId?, blocklistId?, status?, afterId?, limit? })   the jobs: status, generations, counts, per-owner progress
 *   jobs.results({ network, jobId, generation?, outcome?, afterId?, limit? }) what happened to each image of one run of one job
 *   jobs.requeue({ network, blocklistId, mode })                              mode 'rerun': a new generation, from scratch
 *                                                                              mode 'resume': continue a limit_reached job with a new image allowance
 *
 * A job covers the LATEST request for its entry only when coversLatest is true (status done / no_owner and coveredGen >= requestedGen).
 * generation tells runs apart: a requeue writes its results under a new generation and the previous run's rows stay, so the previous run
 * and the current run are never mixed. results defaults to the job's latest run. Identifiers and outcomes only; nothing here deletes.
 */
function describeJob(row) {
  let state = null;
  try { state = row.state ? JSON.parse(row.state) : null; } catch { state = null; }
  const complete = row.status === JOB.DONE || row.status === JOB.NO_OWNER;
  return {
    id: row.id, network: row.network, blocklistId: row.blocklist_id, entryType: row.entry_type, identifierNamespace: row.identifier_namespace || null, value: row.advertiser_name, complaintId: row.complaint_id || null,
    status: row.status, attempts: row.attempts,
    requestedGen: row.requested_gen, runGen: row.run_gen, coveredGen: row.covered_gen,
    coversLatest: complete && Number(row.covered_gen) >= Number(row.requested_gen),
    requestedAt: row.requested_at || null, createdAt: row.created_at, updatedAt: row.updated_at, finishedAt: row.finished_at || null,
    lastError: row.last_error || null,
    stats: state && state.stats ? state.stats : null,
    progress: state && state.owners ? state.owners : null,
  };
}

function createJobsApi(deps = {}) {
  const repo = deps.jobRepository || jobRepository;
  const bad = (error, message) => ({ ok: false, error, message });
  const sqlOf = (network) => (deps.getSql ? deps.getSql(network) : require('../../database/DatabaseManager').getSQL(network));
  const slugOf = (network) => (typeof network === 'string' && NETWORK.test(network.trim().toLowerCase()) ? network.trim().toLowerCase() : null);
  const whole = (v) => (typeof v === 'number' ? v : (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN));
  const OUTCOMES = ['hashed', 'duplicate', 'skipped', 'failed'];

  async function list({ network, jobId, blocklistId, status, afterId = 0, limit = 50 } = {}) {
    const slug = slugOf(network);
    if (!slug) return bad('invalid_network', 'network must be a network slug');
    for (const [name, v] of [['jobId', jobId], ['blocklistId', blocklistId]]) {
      if (v !== undefined && v !== null && v !== '' && !(Number.isSafeInteger(whole(v)) && whole(v) > 0)) return bad('invalid_id', `${name} must be a positive whole number`);
    }
    if (status !== undefined && status !== null && status !== '' && !Object.values(JOB).includes(status)) return bad('invalid_status', `status must be one of ${Object.values(JOB).join(', ')}`);
    try {
      const sql = sqlOf(slug);
      if (!sql) return bad('no_database', 'there is no database connection for that network');
      const rows = await repo.listJobs(sql, { network: slug, jobId, blocklistId, status: status || undefined, afterId, limit });
      return { ok: true, items: rows.map(describeJob), next: rows.length ? rows[rows.length - 1].id : null };
    } catch (err) {
      return bad('failed', err.message);
    }
  }

  async function results({ network, jobId, generation, outcome, afterId = 0, limit = 200 } = {}) {
    const slug = slugOf(network);
    if (!slug) return bad('invalid_network', 'network must be a network slug');
    const id = whole(jobId);
    if (!Number.isSafeInteger(id) || id <= 0) return bad('invalid_id', 'jobId must be a positive whole number');
    if (outcome !== undefined && outcome !== null && outcome !== '' && !OUTCOMES.includes(outcome)) return bad('invalid_outcome', `outcome must be one of ${OUTCOMES.join(', ')}`);
    try {
      const sql = sqlOf(slug);
      if (!sql) return bad('no_database', 'there is no database connection for that network');
      const [job] = await repo.listJobs(sql, { network: slug, jobId: id, limit: 1 });
      if (!job) return bad('not_found', 'no such job');
      const wanted = generation === undefined || generation === null || generation === '' ? Number(job.run_gen) || 1 : whole(generation);
      if (!Number.isSafeInteger(wanted) || wanted <= 0) return bad('invalid_generation', 'generation must be a positive whole number');
      const rows = await repo.listJobResults(sql, { network: slug, jobId: id, generation: wanted, outcome: outcome || undefined, afterId, limit });
      return {
        ok: true, job: describeJob(job), generation: wanted, latestGeneration: Number(job.run_gen) || 1,
        items: rows.map((r) => ({
          id: r.id, platformAdId: r.platform_ad_id, internalAdId: r.internal_ad_id || null, sourceUrl: r.source_url, outcome: r.outcome, reason: r.reason || null, sha256: r.sha256 || null, updatedAt: r.updated_at,
        })),
        next: rows.length ? rows[rows.length - 1].id : null,
      };
    } catch (err) {
      return bad('failed', err.message);
    }
  }

  async function requeue({ network, blocklistId, mode } = {}) {
    const slug = slugOf(network);
    if (!slug) return bad('invalid_network', 'network must be a network slug');
    const id = whole(blocklistId);
    if (!Number.isSafeInteger(id) || id <= 0 || id > LAST_REAL_ENTRY) return bad('invalid_id', 'blocklistId must be a positive whole number');
    if (mode !== 'rerun' && mode !== 'resume') return bad('invalid_mode', 'mode must be "rerun" or "resume"');
    try {
      const sql = sqlOf(slug);
      if (!sql) return bad('no_database', 'there is no database connection for that network');
      if (mode === 'rerun') {
        const found = await repo.requestRun(sql, slug, id);
        return found ? { ok: true, mode } : bad('not_found', 'that entry has no hash job yet (the worker creates it)');
      }
      const out = await repo.resumeLimited(sql, slug, id);
      if (out.ok) return { ok: true, mode };
      return bad(out.reason === 'no_job' ? 'not_found' : 'not_resumable', out.reason === 'no_job' ? 'that entry has no hash job' : `only a limit_reached job can be resumed (${out.reason})`);
    } catch (err) {
      return bad('failed', err.message);
    }
  }

  return { list, results, requeue };
}

const jobs = createJobsApi();

module.exports = {
  HashWorker, DEFAULTS,
  jobRepository, JOB_STATUS: JOB, ENTRY_TYPES, JOBS_TABLE, BLOCKLIST_TABLE,
  DbCheckpoint, ClaimLostError, NewAdSweeper, ImageBackfill, collectImages, SWEEP, BACKFILL, REVIEW_STATUS, createReview, review, searchStored,
  createRunner, inWindow, runImageHashJobs, createIntake, submitAdvertiser, cleanName,
  createJobsApi, jobs, describeJob,
};
