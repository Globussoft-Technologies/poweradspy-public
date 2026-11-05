'use strict';

/**
 * Takedown / hash monitor: what is deleted, what is waiting, what failed, and the log of every step. READ ONLY: nothing here inserts,
 * updates or deletes. It reads
 *   - copyright_takedown_runs / copyright_takedown_actions   (B3: the takedown runs and, per run, every delete step), and
 *   - copyright_image_hash_jobs / copyright_image_hash_results (B2: the hash jobs and what they did with each image)
 *   - the copyright_status column of each network's ad table (the verification queue: ads waiting to be checked, failed ads waiting for cleanup)
 * in each network's own database. A network whose tables do not exist yet (B3 not deployed) is reported as { available: false } and the others
 * are still shown: a missing table is never shown as "0 deleted".
 *
 * Cost: the overview counts RUNS (small, one row per complaint and network), never the actions table. The actions of a run are read by run id
 * (idx_takedown_actions_run), page by page; recent failures read by status (idx_takedown_actions_status). Every list has a limit and a cursor.
 *
 * B3 owns the words used in `status`. They are grouped here (done / failed / pending / running); a word that is in no group is shown as it is
 * under "other", so nothing is hidden when B3 uses a word that is not listed. A DRY RUN never counts as deleted: it is reported separately.
 */

const RUNS = 'copyright_takedown_runs';
const ACTIONS = 'copyright_takedown_actions';
const JOBS = 'copyright_image_hash_jobs';
const LAST_REAL_ENTRY = 4294967294; // the same bound as the hash worker: 0 and 4294967295 are its cursor rows

const STATUS_GROUPS = Object.freeze({
  done: ['succeeded', 'success', 'completed', 'complete', 'done', 'deleted', 'verified'],
  failed: ['failed', 'error', 'errored', 'partial_failed'],
  running: ['running', 'in_progress', 'started', 'executing'],
  pending: ['pending', 'planned', 'queued', 'scheduled', 'retry', 'retrying', 'waiting'],
});
const FAILED_WORDS = STATUS_GROUPS.failed;
const NETWORK = /^[a-z0-9_-]{1,32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DETAIL_MAX = 2000;

const groupOf = (status) => {
  const s = String(status || '').toLowerCase();
  for (const [group, words] of Object.entries(STATUS_GROUPS)) if (words.includes(s)) return group;
  return 'other';
};
const num = (v) => Number(v) || 0;
const iso = (d) => (d instanceof Date ? d.toISOString() : d || null);
// The datetime exactly as the database holds it (the driver reads it in local time, so local parts give the stored text back): used as a cursor.
const two = (v) => String(v).padStart(2, '0');
const dbTime = (d) => (d instanceof Date
  ? `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
  : String(d ?? ''));
const cut = (v) => (typeof v === 'string' && v.length > DETAIL_MAX ? `${v.slice(0, DETAIL_MAX)}…` : v ?? null);
const whole = (v) => (/^\d+$/.test(String(v ?? '')) ? Number(v) : 0);
const pageSize = (v, def = 50, max = 200) => Math.min(Math.max(parseInt(v, 10) || def, 1), max);
const missingTable = (err) => err && (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146);

function addTo(bucket, group, n) { bucket[group] = (bucket[group] || 0) + n; }

/**
 * @param {Object} deps
 * @param {() => string[]} deps.networks   the network slugs to look at
 * @param {(network: string) => ?Object} deps.getSql
 * @param {{ list: Function, results: Function }} [deps.jobs]   the hash jobs API (worker.jobs)
 * @param {Object<string, string>} [deps.adTables]  network -> ad table with copyright_status (copyrightVerification/status.js NETWORKS)
 * @param {Object} [deps.log]
 */
function createMonitorService({ networks, getSql, jobs, adTables = {}, log = console }) {
  const bad = (error, message) => ({ ok: false, error, message });
  const slugOf = (network) => (typeof network === 'string' && NETWORK.test(network.trim().toLowerCase()) ? network.trim().toLowerCase() : null);
  const known = (slug) => networks().includes(slug);

  /** One network's takedown numbers, from the runs table only. */
  async function takedownOf(sql, network) {
    try {
      const rows = await sql.query(
        `SELECT mode, status, COUNT(*) AS runs, COALESCE(SUM(items_planned), 0) AS planned, COALESCE(SUM(items_succeeded), 0) AS succeeded,
                COALESCE(SUM(items_failed), 0) AS failed, MAX(created_at) AS last_at
           FROM ${RUNS} WHERE network = ? GROUP BY mode, status`,
        [network]
      );
      const out = { available: true, runs: { total: 0, byGroup: {}, byStatus: {} }, items: { planned: 0, deleted: 0, failed: 0 }, dryRuns: { total: 0, byStatus: {} }, lastRunAt: null };
      for (const r of rows) {
        const runs = num(r.runs);
        if (String(r.mode).toLowerCase() === 'dry_run') {
          out.dryRuns.total += runs;
          out.dryRuns.byStatus[r.status] = (out.dryRuns.byStatus[r.status] || 0) + runs;
        } else {
          out.runs.total += runs;
          out.runs.byStatus[r.status] = (out.runs.byStatus[r.status] || 0) + runs;
          addTo(out.runs.byGroup, groupOf(r.status), runs);
          out.items.planned += num(r.planned);
          out.items.deleted += num(r.succeeded);
          out.items.failed += num(r.failed);
        }
        const at = iso(r.last_at);
        if (at && (!out.lastRunAt || at > out.lastRunAt)) out.lastRunAt = at;
      }
      out.items.waiting = Math.max(out.items.planned - out.items.deleted - out.items.failed, 0);
      return out;
    } catch (err) {
      return missingTable(err) ? { available: false, reason: 'no_table' } : (log.warn?.('monitor: takedown counts failed', { network, error: err.message }), { available: false, reason: 'error' });
    }
  }

  /** One network's hash jobs by status (the real jobs, not the sweep / backfill cursor rows). */
  async function hashOf(sql, network) {
    try {
      const rows = await sql.query(
        `SELECT status, COUNT(*) AS jobs FROM ${JOBS} WHERE network = ? AND blocklist_id > 0 AND blocklist_id <= ${LAST_REAL_ENTRY} GROUP BY status`,
        [network]
      );
      const out = { available: true, total: 0, byStatus: {} };
      for (const r of rows) { out.byStatus[r.status] = num(r.jobs); out.total += num(r.jobs); }
      return out;
    } catch (err) {
      return missingTable(err) ? { available: false, reason: 'no_table' } : (log.warn?.('monitor: hash job counts failed', { network, error: err.message }), { available: false, reason: 'error' });
    }
  }

  /**
   * The verification queue of one network: ads hidden until checked (copyright_status 0) and failed ads waiting for the cleanup cron (2).
   * Read through the (copyright_status, id) index; approved ads (1) are never counted, that would read the whole index.
   */
  async function verificationOf(sql, network) {
    const table = adTables[network];
    if (!table || !/^[a-z][a-z0-9_]{0,63}$/.test(table)) return { available: false, reason: 'not_supported' };
    try {
      const rows = await sql.query(`SELECT copyright_status AS status, COUNT(*) AS ads FROM \`${table}\` WHERE copyright_status IN (0, 2) GROUP BY copyright_status`);
      const out = { available: true, pending: 0, failed: 0 };
      for (const r of rows) { if (num(r.status) === 0) out.pending = num(r.ads); else out.failed = num(r.ads); }
      return out;
    } catch (err) {
      // No column yet = the migration has not run there: not available, never zero.
      if (missingTable(err) || err?.code === 'ER_BAD_FIELD_ERROR' || err?.errno === 1054) return { available: false, reason: 'no_column' };
      log.warn?.('monitor: verification counts failed', { network, error: err.message });
      return { available: false, reason: 'error' };
    }
  }

  /** The numbers for every network, and the totals. */
  async function overview() {
    const list = networks();
    const per = await Promise.all(list.map(async (network) => {
      const sql = getSql(network);
      if (!sql) return { network, takedown: { available: false, reason: 'no_database' }, hashJobs: { available: false, reason: 'no_database' }, verification: { available: false, reason: 'no_database' } };
      const [takedown, hashJobs, verification] = await Promise.all([takedownOf(sql, network), hashOf(sql, network), verificationOf(sql, network)]);
      return { network, takedown, hashJobs, verification };
    }));
    const totals = { runs: { total: 0, byGroup: {} }, items: { planned: 0, deleted: 0, failed: 0, waiting: 0 }, hashJobs: { total: 0, byStatus: {} }, verification: { pending: 0, failed: 0 }, unavailable: [] };
    for (const n of per) {
      if (n.takedown.available) {
        totals.runs.total += n.takedown.runs.total;
        for (const [g, v] of Object.entries(n.takedown.runs.byGroup)) addTo(totals.runs.byGroup, g, v);
        for (const k of ['planned', 'deleted', 'failed', 'waiting']) totals.items[k] += n.takedown.items[k];
      } else totals.unavailable.push({ network: n.network, what: 'takedown', reason: n.takedown.reason });
      if (n.hashJobs.available) {
        totals.hashJobs.total += n.hashJobs.total;
        for (const [s, v] of Object.entries(n.hashJobs.byStatus)) addTo(totals.hashJobs.byStatus, s, v);
      } else totals.unavailable.push({ network: n.network, what: 'hashJobs', reason: n.hashJobs.reason });
      if (n.verification.available) { totals.verification.pending += n.verification.pending; totals.verification.failed += n.verification.failed; }
    }
    return { ok: true, networks: per, totals, groups: STATUS_GROUPS };
  }

  const runShape = (r) => ({
    runId: r.run_id, network: r.network, complaintId: r.complaint_id || null, triggerType: r.trigger_type, mode: r.mode, status: r.status, group: groupOf(r.status),
    startedAt: iso(r.started_at), finishedAt: iso(r.finished_at), itemsPlanned: num(r.items_planned), itemsSucceeded: num(r.items_succeeded), itemsFailed: num(r.items_failed),
    operator: r.operator || null, reportUri: r.report_uri || null, proofUri: r.proof_uri || null, details: cut(r.details), createdAt: iso(r.created_at),
  });
  const RUN_COLUMNS = `run_id, network, complaint_id, trigger_type, mode, status, started_at, finished_at, items_planned, items_succeeded, items_failed, operator,
            report_uri, proof_uri, details, created_at`;

  /**
   * The takedown runs of one network (newest first), or of one complaint in every network. The cursor of a page is the `next` of the last.
   */
  async function runs({ network, complaintId, status, mode, cursor, limit } = {}) {
    const n = pageSize(limit, 25, 100);
    if (complaintId !== undefined && complaintId !== null && complaintId !== '' && !UUID.test(String(complaintId))) return bad('invalid_id', 'complaintId must be a complaint id');
    if (mode && !['execute', 'dry_run'].includes(mode)) return bad('invalid_mode', 'mode must be execute or dry_run');
    const targets = network ? [slugOf(network)] : (complaintId ? networks() : []);
    if (!targets.length || targets.includes(null)) return bad('invalid_network', 'give a network, or a complaint id');
    if (network && !known(targets[0])) return bad('invalid_network', 'unknown network');
    let before = null;
    if (cursor) {
      const m = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\|([0-9a-f-]{36})$/i.exec(String(cursor));
      if (!m) return bad('invalid_cursor', 'cursor is not valid');
      before = { at: m[1], runId: m[2].toLowerCase() };
    }
    const items = [];
    const unavailable = [];
    for (const slug of targets) {
      const sql = getSql(slug);
      if (!sql) { unavailable.push(slug); continue; }
      const where = ['network = ?'];
      const params = [slug];
      if (complaintId) { where.push('complaint_id = ?'); params.push(String(complaintId).toLowerCase()); }
      if (status) { where.push('status = ?'); params.push(String(status)); }
      if (mode) { where.push('mode = ?'); params.push(mode); }
      if (before) { where.push('(created_at < ? OR (created_at = ? AND run_id < ?))'); params.push(before.at, before.at, before.runId); }
      try {
        const rows = await sql.query(`SELECT ${RUN_COLUMNS} FROM ${RUNS} WHERE ${where.join(' AND ')} ORDER BY created_at DESC, run_id DESC LIMIT ${n}`, params);
        items.push(...rows.map((r) => ({ ...runShape(r), cursorAt: dbTime(r.created_at) })));
      } catch (err) {
        if (!missingTable(err)) log.warn?.('monitor: runs failed', { network: slug, error: err.message });
        unavailable.push(slug);
      }
    }
    items.sort((a, b) => String(b.cursorAt).localeCompare(String(a.cursorAt)) || String(b.runId).localeCompare(String(a.runId)));
    const page = items.slice(0, n);
    const last = page[page.length - 1];
    const next = page.length === n && last ? `${last.cursorAt}|${last.runId}` : null;
    return { ok: true, items: page.map(({ cursorAt, ...run }) => run), unavailable, next };
  }

  const actionShape = (a) => ({
    id: a.id, targetType: a.target_type, targetId: a.target_id || null, internalAdId: a.internal_ad_id || null, targetValue: cut(a.target_value), targetUrl: cut(a.target_url),
    system: a.system, operation: a.operation, status: a.status, group: groupOf(a.status), errorMessage: cut(a.error_message), details: cut(a.details),
    attempts: num(a.attempts), proofUri: a.proof_uri || null, nextRetryAt: iso(a.next_retry_at), startedAt: iso(a.started_at), finishedAt: iso(a.finished_at), createdAt: iso(a.created_at),
  });
  const ACTION_COLUMNS = `id, run_id, network, target_type, target_id, internal_ad_id, target_value, target_url, \`system\`, operation, status, error_message, details, attempts,
            proof_uri, next_retry_at, started_at, finished_at, created_at`;

  /** One run, the count of its steps by system and status, and the log: its steps (by id, pages of `limit`). */
  async function runLogs({ network, runId, status, system, afterId = 0, limit } = {}) {
    const slug = slugOf(network);
    if (!slug || !known(slug)) return bad('invalid_network', 'network must be a known network slug');
    if (!UUID.test(String(runId || ''))) return bad('invalid_id', 'runId must be a run id');
    const n = pageSize(limit, 100, 500);
    const sql = getSql(slug);
    if (!sql) return bad('no_database', 'there is no database connection for that network');
    try {
      const [run] = await sql.query(`SELECT ${RUN_COLUMNS} FROM ${RUNS} WHERE run_id = ? AND network = ? LIMIT 1`, [String(runId).toLowerCase(), slug]);
      if (!run) return bad('not_found', 'no such run');
      const counts = await sql.query(`SELECT \`system\` AS \`system\`, status, COUNT(*) AS steps FROM ${ACTIONS} WHERE run_id = ? AND network = ? GROUP BY \`system\`, status`, [String(runId).toLowerCase(), slug]);
      const where = ['run_id = ?', 'network = ?', 'id > ?'];
      const params = [String(runId).toLowerCase(), slug, whole(afterId)];
      if (status) { where.push('status = ?'); params.push(String(status)); }
      if (system) { where.push('`system` = ?'); params.push(String(system)); }
      const rows = await sql.query(`SELECT ${ACTION_COLUMNS} FROM ${ACTIONS} WHERE ${where.join(' AND ')} ORDER BY id LIMIT ${n}`, params);
      const bySystem = {};
      const byGroup = {};
      for (const c of counts) {
        const g = groupOf(c.status);
        bySystem[c.system] = bySystem[c.system] || { total: 0, byStatus: {} };
        bySystem[c.system].total += num(c.steps);
        bySystem[c.system].byStatus[c.status] = (bySystem[c.system].byStatus[c.status] || 0) + num(c.steps);
        addTo(byGroup, g, num(c.steps));
      }
      return { ok: true, run: runShape(run), steps: { byGroup, bySystem }, items: rows.map(actionShape), next: rows.length === n ? rows[rows.length - 1].id : null };
    } catch (err) {
      if (missingTable(err)) return bad('no_table', 'the takedown tables do not exist in that database yet');
      log.warn?.('monitor: run logs failed', { network: slug, error: err.message });
      return bad('failed', 'the log could not be read');
    }
  }

  /** The newest steps that failed in one network (the log a person looks at first). */
  async function failures({ network, beforeId, limit } = {}) {
    const slug = slugOf(network);
    if (!slug || !known(slug)) return bad('invalid_network', 'network must be a known network slug');
    const n = pageSize(limit, 50, 200);
    const sql = getSql(slug);
    if (!sql) return bad('no_database', 'there is no database connection for that network');
    try {
      const where = [`status IN (${FAILED_WORDS.map(() => '?').join(', ')})`, 'network = ?'];
      const params = [...FAILED_WORDS, slug];
      if (whole(beforeId)) { where.push('id < ?'); params.push(whole(beforeId)); }
      const rows = await sql.query(`SELECT ${ACTION_COLUMNS} FROM ${ACTIONS} WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${n}`, params);
      return { ok: true, items: rows.map((a) => ({ ...actionShape(a), runId: a.run_id })), next: rows.length === n ? rows[rows.length - 1].id : null };
    } catch (err) {
      if (missingTable(err)) return bad('no_table', 'the takedown tables do not exist in that database yet');
      log.warn?.('monitor: failures failed', { network: slug, error: err.message });
      return bad('failed', 'the failures could not be read');
    }
  }

  /** The hash jobs and their results are the hash worker's own API (the same answers the jobs routes give), checked against the known networks. */
  async function hashJobs(query = {}) {
    if (!jobs) return bad('not_configured', 'the hash jobs are not available');
    if (!known(slugOf(query.network))) return bad('invalid_network', 'network must be a known network slug');
    return jobs.list({ network: query.network, status: query.status, afterId: query.afterId, limit: pageSize(query.limit, 50, 200) });
  }
  async function hashJobResults(query = {}) {
    if (!jobs) return bad('not_configured', 'the hash jobs are not available');
    if (!known(slugOf(query.network))) return bad('invalid_network', 'network must be a known network slug');
    return jobs.results({ network: query.network, jobId: query.jobId, generation: query.generation, outcome: query.outcome, afterId: query.afterId, limit: pageSize(query.limit, 200, 500) });
  }

  // ── the blocklist itself and the ads it refused (B1; read only) ──
  const BLOCK_TYPES = ['advertiser', 'page', 'ad_id', 'url', 'image_url', 'domain', 'image_hash'];
  const BLOCK_STATUSES = ['active', 'expired', 'revoked'];
  const likeOf = (text) => `%${text.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

  /**
   * Who and what is blocked in one network: newest entry first, by id, with a cursor. Optional filters: status, entry type, and a text
   * search inside the blocked value (the blocklist is small, so the search is a plain scan with a limit). `counts` says how many entries
   * the network has by status, and how many ACTIVE ones by type. It reads identifier_namespace too (in the schema since the namespace change), to tell a platform ad id from our row id.
   */
  async function blocklist({ network, status, entryType, q, beforeId, limit } = {}) {
    const slug = slugOf(network);
    if (!slug || !known(slug)) return bad('invalid_network', 'network must be a known network slug');
    if (status && !BLOCK_STATUSES.includes(status)) return bad('invalid_status', `status must be one of ${BLOCK_STATUSES.join(', ')}`);
    if (entryType && !BLOCK_TYPES.includes(entryType)) return bad('invalid_type', `entryType must be one of ${BLOCK_TYPES.join(', ')}`);
    const text = typeof q === 'string' ? q.trim().slice(0, 100) : '';
    const n = pageSize(limit, 50, 200);
    const sql = getSql(slug);
    if (!sql) return bad('no_database', 'there is no database connection for that network');
    try {
      const where = ['network = ?'];
      const params = [slug];
      if (status) { where.push('status = ?'); params.push(status); }
      if (entryType) { where.push('entry_type = ?'); params.push(entryType); }
      if (text) { where.push('LOWER(value) LIKE ?'); params.push(likeOf(text)); }
      if (whole(beforeId)) { where.push('id < ?'); params.push(whole(beforeId)); }
      const rows = await sql.query(
        `SELECT id, network, entry_type, identifier_namespace, value, reason, source, complaint_id, status, expires_at, created_at, added_by, removed_at, removed_by
           FROM copyright_blocklist WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${n}`,
        params
      );
      const counted = await sql.query('SELECT entry_type, status, COUNT(*) AS entries FROM copyright_blocklist WHERE network = ? GROUP BY entry_type, status', [slug]);
      const counts = { total: 0, byStatus: {}, activeByType: {} };
      for (const c of counted) {
        const k = num(c.entries);
        counts.total += k;
        counts.byStatus[c.status] = (counts.byStatus[c.status] || 0) + k;
        if (c.status === 'active') counts.activeByType[c.entry_type] = (counts.activeByType[c.entry_type] || 0) + k;
      }
      return {
        ok: true,
        counts,
        items: rows.map((r) => ({
          id: r.id, network: r.network, entryType: r.entry_type, identifierNamespace: r.identifier_namespace || null, value: cut(r.value), reason: r.reason || null, source: r.source || null,
          complaintId: r.complaint_id || null, status: r.status, expiresAt: iso(r.expires_at), createdAt: iso(r.created_at),
          addedBy: r.added_by || null, removedAt: iso(r.removed_at), removedBy: r.removed_by || null,
        })),
        next: rows.length === n ? rows[rows.length - 1].id : null,
      };
    } catch (err) {
      if (missingTable(err)) return bad('no_table', 'the blocklist table does not exist in that database yet');
      log.warn?.('monitor: blocklist failed', { network: slug, error: err.message });
      return bad('failed', 'the blocklist could not be read');
    }
  }

  /** The ads the blocklist refused at ingestion in one network, newest first (identifiers only: copyright_blocked_attempts never holds the payload). */
  async function attempts({ network, beforeId, limit } = {}) {
    const slug = slugOf(network);
    if (!slug || !known(slug)) return bad('invalid_network', 'network must be a known network slug');
    const n = pageSize(limit, 50, 200);
    const sql = getSql(slug);
    if (!sql) return bad('no_database', 'there is no database connection for that network');
    try {
      const where = ['network = ?'];
      const params = [slug];
      if (whole(beforeId)) { where.push('id < ?'); params.push(whole(beforeId)); }
      const rows = await sql.query(
        `SELECT id, network, platform_ad_id, advertiser, image_url, blocklist_id, match_type, distance, source, created_at
           FROM copyright_blocked_attempts WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${n}`,
        params
      );
      return {
        ok: true,
        items: rows.map((r) => ({
          id: r.id, network: r.network, platformAdId: r.platform_ad_id || null, advertiser: r.advertiser || null, imageUrl: cut(r.image_url),
          blocklistId: r.blocklist_id, matchType: r.match_type, distance: r.distance === null || r.distance === undefined ? null : num(r.distance),
          source: r.source || null, createdAt: iso(r.created_at),
        })),
        next: rows.length === n ? rows[rows.length - 1].id : null,
      };
    } catch (err) {
      if (missingTable(err)) return bad('no_table', 'the blocked-attempts table does not exist in that database yet');
      log.warn?.('monitor: attempts failed', { network: slug, error: err.message });
      return bad('failed', 'the rejected ads could not be read');
    }
  }

  return { overview, runs, runLogs, failures, hashJobs, hashJobResults, blocklist, attempts };
}

module.exports = { createMonitorService, groupOf, STATUS_GROUPS };
