'use strict';

/**
 * Takedown / hash monitor: what is deleted, what is waiting, what failed, and the log of every step. READ ONLY: nothing here inserts,
 * updates or deletes. It reads
 *   - copyright_takedown_runs / copyright_takedown_actions   (B3: the takedown runs and, per run, every delete step), and
 *   - copyright_image_hash_jobs / copyright_image_hash_results (B2: the hash jobs and what they did with each image)
 *   - copyright_audit_runs / copyright_audit_findings (B6: each audit run and what it found)
 *   - the copyright_status column of each network's ad table and copyright_verification_diagnostics (pending ads and their last verification stage)
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

  // ── advertiser names next to ad ids (read only, best effort) ──
  // Every list that shows ad ids also shows the advertiser, so a person can follow an ad up. The name comes from:
  //   - the ad itself while it still exists (the network's post-owner table, the same join copyrightVerification uses), or
  //   - the takedown run's preflight_snapshot once the cleanup deleted it (runs since the snapshot stores `advertiser`).
  // A failure here never fails the list: the name is then simply left out (null).
  const ownerOf = (slug) => (slug === 'admob'
    ? { table: 'mob_post_owners', col: 'name' }
    : { table: `${slug === 'google' ? 'google_text' : slug}_ad_post_owners`, col: 'post_owner_name' });
  const SAFE_NAME = /^[a-z][a-z0-9_]{0,63}$/;

  /** Map of ad key -> advertiser name for live ads. `by` is 'id' (our row id) or 'ad_id' (the platform ad id). */
  async function liveAdvertisers(sql, slug, keys, by = 'id') {
    const out = new Map();
    const table = adTables[slug];
    const owner = ownerOf(slug);
    const list = [...new Set(keys.filter((k) => k !== null && k !== undefined && k !== '').map(String))].slice(0, 500);
    if (!list.length || !table || !SAFE_NAME.test(table) || !SAFE_NAME.test(owner.table)) return out;
    try {
      const rows = await sql.query(
        `SELECT a.${by === 'ad_id' ? 'ad_id' : 'id'} AS k, o.${owner.col} AS advertiser
           FROM \`${table}\` a LEFT JOIN \`${owner.table}\` o ON o.id = a.post_owner_id
          WHERE a.${by === 'ad_id' ? 'ad_id' : 'id'} IN (${list.map(() => '?').join(',')})`, list);
      for (const r of rows || []) if (r && r.k !== undefined && r.advertiser) out.set(String(r.k), String(r.advertiser));
    } catch (err) {
      log.warn?.('monitor: advertiser lookup failed', { network: slug, error: err.message });
    }
    return out;
  }

  /** Map of run id -> (our row id -> advertiser), from the runs' preflight snapshots (written before the ads are deleted). */
  async function snapshotAdvertisers(sql, slug, runIds) {
    const out = new Map();
    const ids = [...new Set(runIds.filter(Boolean).map((r) => String(r).toLowerCase()))].filter((r) => UUID.test(r)).slice(0, 200);
    if (!ids.length) return out;
    try {
      const rows = await sql.query(`SELECT run_id, preflight_snapshot FROM ${RUNS} WHERE network = ? AND run_id IN (${ids.map(() => '?').join(',')})`, [slug, ...ids]);
      for (const r of rows || []) {
        if (!r || typeof r.preflight_snapshot !== 'string') continue;
        let snap = null;
        try { snap = JSON.parse(r.preflight_snapshot); } catch { snap = null; }
        const byAd = new Map();
        for (const ad of (snap && Array.isArray(snap.ads) ? snap.ads : [])) if (ad && ad.advertiser) byAd.set(String(ad.internalId), String(ad.advertiser));
        out.set(String(r.run_id).toLowerCase(), byAd);
      }
    } catch (err) {
      log.warn?.('monitor: snapshot lookup failed', { network: slug, error: err.message });
    }
    return out;
  }

  /** Map of blocklist id -> { type, namespace, value, complaintId }: which entry an attempt matched. */
  async function entriesById(sql, slug, ids) {
    const out = new Map();
    const list = [...new Set(ids.map(whole).filter(Boolean))].slice(0, 500);
    if (!list.length) return out;
    try {
      const found = await sql.query(`SELECT id, entry_type, identifier_namespace, value, complaint_id FROM copyright_blocklist WHERE id IN (${list.map(() => '?').join(',')})`, list);
      for (const e of found || []) {
        if (e && e.id !== undefined) out.set(String(e.id), { type: e.entry_type, namespace: e.identifier_namespace || null, value: cut(e.value), complaintId: e.complaint_id || null });
      }
    } catch (err) { log.warn?.('monitor: matched entries failed', { network: slug, error: err.message }); }
    return out;
  }

  // Is idx_blocked_attempts_ad (network, platform_ad_id) on this network's copyright_blocked_attempts? It is added by
  // copyrightVerification/migrateAttemptsIndex.js. "Yes" is kept for good; "no" is asked again after 10 minutes, so a network
  // starts using the index soon after the migration, without a restart.
  const attemptsIndex = new Map();
  async function hasAttemptsIndex(sql, slug) {
    const known = attemptsIndex.get(slug);
    if (known && (known.yes || Date.now() - known.at < 600000)) return known.yes;
    let yes = false;
    try {
      const rows = await sql.query(`SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'copyright_blocked_attempts' AND index_name = 'idx_blocked_attempts_ad' LIMIT 1`);
      yes = Array.isArray(rows) && rows.length > 0;
    } catch { yes = false; }
    attemptsIndex.set(slug, { yes, at: Date.now() });
    return yes;
  }

  /**
   * Why the cleanup blocked an ad id: its "failed copyright verification" reason says nothing about WHAT matched. The check recorded that
   * when it failed the ad (copyright_blocked_attempts: match type + the entry it matched), so the newest such row of that platform ad id is
   * the cause.
   *   - With idx_blocked_attempts_ad (after migrateAttemptsIndex.js): one query straight by ad id, for blocks of any age.
   *   - Without it: bounded by the (network, created_at) index, one query per day of entries looking two days back, so a network that is
   *     not migrated yet is never scanned whole.
   */
  async function causesOf(sql, slug, entries) {
    const out = new Map();
    const found = [];
    if (await hasAttemptsIndex(sql, slug)) {
      const ids = [...new Set(entries.map((e) => String(e.value)))].slice(0, 500);
      try {
        const rows = await sql.query(
          `SELECT id, platform_ad_id, advertiser, blocklist_id, match_type, distance, source, created_at FROM copyright_blocked_attempts
            WHERE network = ? AND platform_ad_id IN (${ids.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 2000`, [slug, ...ids]);
        found.push(...(rows || []));
      } catch (err) { log.warn?.('monitor: block causes failed', { network: slug, error: err.message }); }
      return finishCauses(sql, slug, found, out);
    }
    const byDay = new Map();
    for (const e of entries) {
      const at = new Date(e.createdAt);
      if (Number.isNaN(at.getTime())) continue;
      const day = at.toISOString().slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, { from: at, to: at, ids: [] });
      const b = byDay.get(day);
      if (at < b.from) b.from = at;
      if (at > b.to) b.to = at;
      b.ids.push(String(e.value));
    }
    for (const b of [...byDay.values()].slice(0, 10)) {
      const from = new Date(b.from.getTime() - 2 * 86400000);
      const to = new Date(b.to.getTime() + 3600000);
      try {
        const rows = await sql.query(
          `SELECT id, platform_ad_id, advertiser, blocklist_id, match_type, distance, source, created_at FROM copyright_blocked_attempts
            WHERE network = ? AND created_at >= ? AND created_at <= ? AND platform_ad_id IN (${b.ids.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 500`,
          [slug, dbTime(from), dbTime(to), ...b.ids]);
        found.push(...(rows || []));
      } catch (err) { log.warn?.('monitor: block causes failed', { network: slug, error: err.message }); }
    }
    return finishCauses(sql, slug, found, out);
  }

  /** The newest non-ingestion attempt per ad id, with the entry it matched. */
  async function finishCauses(sql, slug, found, out) {
    const matched = await entriesById(sql, slug, found.map((r) => r.blocklist_id));
    for (const r of found) {
      const key = String(r.platform_ad_id);
      if (!r || out.has(key) || String(r.source || '').startsWith('ingestion')) continue; // newest first; a refusal at the door was never saved
      out.set(key, {
        matchType: r.match_type, distance: r.distance === null || r.distance === undefined ? null : num(r.distance), source: r.source || null,
        advertiser: r.advertiser || null, at: iso(r.created_at), matchedEntry: matched.get(String(r.blocklist_id)) || null,
      });
    }
    return out;
  }

  /** Adds `advertiser` to rows that carry `internalAdId` (and `runId` / `takedownRunId`): snapshot first, then the live ad. */
  async function withAdvertisers(sql, slug, items, runOf = (i) => i.runId) {
    if (!items.length) return items;
    const snaps = await snapshotAdvertisers(sql, slug, items.map(runOf));
    const missing = items.filter((i) => !i.advertiser && !snaps.get(String(runOf(i) || '').toLowerCase())?.get(String(i.internalAdId)));
    const live = missing.length ? await liveAdvertisers(sql, slug, missing.map((i) => i.internalAdId)) : new Map();
    return items.map((i) => ({
      ...i,
      advertiser: i.advertiser || snaps.get(String(runOf(i) || '').toLowerCase())?.get(String(i.internalAdId)) || live.get(String(i.internalAdId)) || null,
    }));
  }

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

  /** Current status-0 ads with the last persisted verification stage and retry detail. */
  async function verificationQueue({ network, afterId = '0', limit } = {}) {
    const slug = slugOf(network);
    if (!slug || !known(slug) || !adTables[slug]) return bad('invalid_network', 'give a supported network');
    const sql = getSql(slug);
    if (!sql) return { ok: true, available: false, reason: 'no_database', items: [], next: null };
    if (!/^\d+$/.test(String(afterId))) return bad('invalid_cursor', 'afterId must be a row id');
    const n = pageSize(limit, 50, 200);
    const table = adTables[slug];
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(table)) return bad('invalid_network', 'the ad table name is not supported');
    try {
      const fetched = await sql.query(`SELECT a.id AS internal_ad_id, a.ad_id AS platform_ad_id,
          d.stage, d.detail, d.attempts, d.first_checked_at, d.last_checked_at
        FROM \`${table}\` a
        LEFT JOIN copyright_verification_diagnostics d
          ON d.network = ? AND d.internal_ad_id = CAST(a.id AS CHAR)
        WHERE a.copyright_status = 0 AND a.id > ?
        ORDER BY a.id LIMIT ${n + 1}`, [slug, String(afterId)]);
      // one row more than a page was asked for: it only tells whether a next page exists, and is not shown
      const more = fetched.length > n;
      const rows = fetched.slice(0, n);
      const items = rows.map((r) => ({
        internalAdId: String(r.internal_ad_id), platformAdId: r.platform_ad_id == null ? null : String(r.platform_ad_id),
        stage: r.stage || 'not_checked', detail: r.detail || 'No verification attempt is recorded; check that the verification cron is enabled and running.',
        attempts: num(r.attempts), firstCheckedAt: iso(r.first_checked_at), lastCheckedAt: iso(r.last_checked_at),
      }));
      // the advertiser of each waiting ad, read in a second query so a missing owner table never hides the queue
      const names = await liveAdvertisers(sql, slug, items.map((i) => i.internalAdId));
      const named = items.map((i) => ({ ...i, advertiser: names.get(i.internalAdId) || null }));
      return { ok: true, available: true, items: named, next: more ? items[items.length - 1].internalAdId : null };
    } catch (err) {
      if (missingTable(err)) return { ok: true, available: false, reason: 'diagnostics_not_migrated', items: [], next: null };
      if (err?.code === 'ER_BAD_FIELD_ERROR' || err?.errno === 1054) return { ok: true, available: false, reason: 'no_column', items: [], next: null };
      log.warn?.('monitor: verification details failed', { network: slug, error: err.message });
      return { ok: true, available: false, reason: 'error', items: [], next: null };
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
        const rows = await sql.query(`SELECT ${RUN_COLUMNS} FROM ${RUNS} WHERE ${where.join(' AND ')} ORDER BY created_at DESC, run_id DESC LIMIT ${n + 1}`, params);
        items.push(...rows.map((r) => ({ ...runShape(r), cursorAt: dbTime(r.created_at) })));
      } catch (err) {
        if (!missingTable(err)) log.warn?.('monitor: runs failed', { network: slug, error: err.message });
        unavailable.push(slug);
      }
    }
    items.sort((a, b) => String(b.cursorAt).localeCompare(String(a.cursorAt)) || String(b.runId).localeCompare(String(a.runId)));
    // each network was asked for one row more than a page, so more than `n` merged rows means a next page really exists
    const page = items.slice(0, n);
    const last = page[page.length - 1];
    const next = items.length > n && last ? `${last.cursorAt}|${last.runId}` : null;
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
      const fetched = await sql.query(`SELECT ${ACTION_COLUMNS} FROM ${ACTIONS} WHERE ${where.join(' AND ')} ORDER BY id LIMIT ${n + 1}`, params);
      // one row more than a page was asked for: it only tells whether a next page exists, and is not shown
      const more = fetched.length > n;
      const rows = fetched.slice(0, n);
      const bySystem = {};
      const byGroup = {};
      for (const c of counts) {
        const g = groupOf(c.status);
        bySystem[c.system] = bySystem[c.system] || { total: 0, byStatus: {} };
        bySystem[c.system].total += num(c.steps);
        bySystem[c.system].byStatus[c.status] = (bySystem[c.system].byStatus[c.status] || 0) + num(c.steps);
        addTo(byGroup, g, num(c.steps));
      }
      const steps = await withAdvertisers(sql, slug, rows.map((a) => ({ ...actionShape(a), runId: a.run_id })));
      return { ok: true, run: runShape(run), steps: { byGroup, bySystem }, items: steps.map(({ runId: _r, ...st }) => st), next: more ? rows[rows.length - 1].id : null };
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
      const fetched = await sql.query(`SELECT ${ACTION_COLUMNS} FROM ${ACTIONS} WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${n + 1}`, params);
      // one row more than a page was asked for: it only tells whether a next page exists, and is not shown
      const more = fetched.length > n;
      const rows = fetched.slice(0, n);
      const items = await withAdvertisers(sql, slug, rows.map((a) => ({ ...actionShape(a), runId: a.run_id })));
      return { ok: true, items, next: more ? rows[rows.length - 1].id : null };
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
    const out = await jobs.results({ network: query.network, jobId: query.jobId, generation: query.generation, outcome: query.outcome, afterId: query.afterId, limit: pageSize(query.limit, 200, 500) });
    // the advertiser of each image's ad, when the ad still exists (best effort, never fails the answer)
    const sql = getSql(slugOf(query.network));
    if (!out?.ok || !sql || !Array.isArray(out.items) || !out.items.length) return out;
    const names = await liveAdvertisers(sql, slugOf(query.network), out.items.map((r) => r.internalAdId));
    return { ...out, items: out.items.map((r) => ({ ...r, advertiser: r.advertiser || names.get(String(r.internalAdId)) || null })) };
  }

  // ── the blocklist itself and the ads it refused (B1; read only) ──
  const BLOCK_TYPES = ['advertiser', 'page', 'ad_id', 'url', 'image_url', 'domain', 'image_hash'];
  const BLOCK_STATUSES = ['active', 'expired', 'revoked'];
  const likeOf = (text) => `%${text.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

  /**
   * Who and what is blocked in one network: newest entry first, by id, with a cursor. Optional filters: status, entry type, and a text
   * search inside the blocked value (the blocklist is small, so the search is a plain scan with a limit). `counts` says how many entries
   * the network has by status, and how many ACTIVE ones by type. It reads identifier_namespace too (in the schema since the namespace change), to tell a platform ad id from our row id.
   * `complaintId` keeps only the entries of one claim (the advertiser block and the image_hash entries its hash job added), through the
   * idx_blocklist_complaint index, so a reviewer can follow one claim from the Requests tab.
   */
  async function blocklist({ network, status, entryType, q, complaintId, beforeId, limit } = {}) {
    const slug = slugOf(network);
    if (!slug || !known(slug)) return bad('invalid_network', 'network must be a known network slug');
    if (status && !BLOCK_STATUSES.includes(status)) return bad('invalid_status', `status must be one of ${BLOCK_STATUSES.join(', ')}`);
    if (complaintId && !UUID.test(String(complaintId))) return bad('invalid_id', 'complaintId must be a complaint id');
    if (entryType && !BLOCK_TYPES.includes(entryType)) return bad('invalid_type', `entryType must be one of ${BLOCK_TYPES.join(', ')}`);
    const text = typeof q === 'string' ? q.trim().slice(0, 100) : '';
    const n = pageSize(limit, 50, 200);
    const sql = getSql(slug);
    if (!sql) return bad('no_database', 'there is no database connection for that network');
    try {
      // A network's blocks are its own rows plus the rows marked 'all' (an accepted claim blocks for every network and writes an
      // 'all' row into each network's database). Reading only `network = ?` hid every claim block from this list.
      const where = [`network IN (?, 'all')`];
      const params = [slug];
      if (status) { where.push('status = ?'); params.push(status); }
      if (entryType) { where.push('entry_type = ?'); params.push(entryType); }
      if (text) { where.push('LOWER(value) LIKE ?'); params.push(likeOf(text)); }
      // one claim's entries only (complaint ids are stored lowercase, as the runs filter assumes)
      if (complaintId) { where.push('complaint_id = ?'); params.push(String(complaintId).toLowerCase()); }
      if (whole(beforeId)) { where.push('id < ?'); params.push(whole(beforeId)); }
      const fetched = await sql.query(
        `SELECT id, network, entry_type, identifier_namespace, value, reason, source, complaint_id, status, expires_at, created_at, added_by, removed_at, removed_by, details
           FROM copyright_blocklist WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${n + 1}`,
        params
      );
      // one row more than a page was asked for: it only tells whether a next page exists, and is not shown
      const more = fetched.length > n;
      const rows = fetched.slice(0, n);
      const counted = await sql.query(`SELECT entry_type, status, COUNT(*) AS entries FROM copyright_blocklist WHERE network IN (?, 'all') GROUP BY entry_type, status`, [slug]); // own + 'all' rows, as the list
      const counts = { total: 0, byStatus: {}, activeByType: {} };
      for (const c of counted) {
        const k = num(c.entries);
        counts.total += k;
        counts.byStatus[c.status] = (counts.byStatus[c.status] || 0) + k;
        if (c.status === 'active') counts.activeByType[c.entry_type] = (counts.activeByType[c.entry_type] || 0) + k;
      }
      let items = rows.map((r) => {
        // image fingerprints: which ad the image came from (the hash job keeps identifiers only in `details`)
        let origin = null;
        if (r.entry_type === 'image_hash' && typeof r.details === 'string') {
          try {
            const d = JSON.parse(r.details);
            if (d && (d.ad_id || d.internal_ad_id || d.image_url || d.media_url)) {
              origin = { platformAdId: d.ad_id ? String(d.ad_id) : null, internalAdId: d.internal_ad_id ? String(d.internal_ad_id) : null, imageUrl: cut(d.image_url || d.media_url || null), job: d.job ?? null };
            }
          } catch { origin = null; }
        }
        return {
          id: r.id, network: r.network, entryType: r.entry_type, identifierNamespace: r.identifier_namespace || null, value: cut(r.value), reason: r.reason || null, source: r.source || null,
          complaintId: r.complaint_id || null, status: r.status, expiresAt: iso(r.expires_at), createdAt: iso(r.created_at),
          addedBy: r.added_by || null, removedAt: iso(r.removed_at), removedBy: r.removed_by || null, origin,
        };
      });
      // the cleanup's ad ids: what the ad matched when it failed the check
      const cleanupIds = items.filter((i) => i.entryType === 'ad_id' && i.addedBy === 'copyright-verification' && i.identifierNamespace !== 'internal');
      if (cleanupIds.length) {
        const causes = await causesOf(sql, slug, cleanupIds);
        items = items.map((i) => (cleanupIds.includes(i) ? { ...i, cause: causes.get(String(i.value)) || null } : i));
      }
      // the advertiser of the ad an image fingerprint came from
      const withOrigin = items.filter((i) => i.origin?.internalAdId);
      if (withOrigin.length) {
        const names = await liveAdvertisers(sql, slug, withOrigin.map((i) => i.origin.internalAdId));
        items = items.map((i) => (i.origin?.internalAdId ? { ...i, origin: { ...i.origin, advertiser: names.get(i.origin.internalAdId) || null } } : i));
      }
      return {
        ok: true,
        counts,
        items,
        next: more ? rows[rows.length - 1].id : null,
      };
    } catch (err) {
      if (missingTable(err)) return bad('no_table', 'the blocklist table does not exist in that database yet');
      log.warn?.('monitor: blocklist failed', { network: slug, error: err.message });
      return bad('failed', 'the blocklist could not be read');
    }
  }

  /**
   * The ads the blocklist refused or failed in one network, newest first (identifiers only: copyright_blocked_attempts never holds the payload).
   * `complaintId` keeps only the ads refused because of one claim's entries: the attempt's blocklist_id must be an entry of that complaint
   * (idx_blocked_attempts_entry + idx_blocklist_complaint, so both sides are indexed).
   */
  async function attempts({ network, complaintId, beforeId, limit } = {}) {
    const slug = slugOf(network);
    if (!slug || !known(slug)) return bad('invalid_network', 'network must be a known network slug');
    if (complaintId && !UUID.test(String(complaintId))) return bad('invalid_id', 'complaintId must be a complaint id');
    const n = pageSize(limit, 50, 200);
    const sql = getSql(slug);
    if (!sql) return bad('no_database', 'there is no database connection for that network');
    try {
      const where = ['network = ?'];
      const params = [slug];
      if (complaintId) {
        // a claim's blocks are 'all' rows (see blocklist above), so the claim's entries are looked up in both
        where.push(`blocklist_id IN (SELECT id FROM copyright_blocklist WHERE network IN (?, 'all') AND complaint_id = ?)`);
        params.push(slug, String(complaintId).toLowerCase());
      }
      if (whole(beforeId)) { where.push('id < ?'); params.push(whole(beforeId)); }
      const fetched = await sql.query(
        `SELECT id, network, platform_ad_id, advertiser, image_url, blocklist_id, match_type, distance, source, created_at
           FROM copyright_blocked_attempts WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${n + 1}`,
        params
      );
      // one row more than a page was asked for: it only tells whether a next page exists, and is not shown
      const more = fetched.length > n;
      const rows = fetched.slice(0, n);
      // the entry that matched (so "Ad id" or "Same image" says WHICH ad id or image), and the advertiser of ads the attempt has no name for
      const entries = await entriesById(sql, slug, rows.map((r) => r.blocklist_id));
      const names = await liveAdvertisers(sql, slug, rows.filter((r) => !r.advertiser).map((r) => r.platform_ad_id), 'ad_id');
      return {
        ok: true,
        items: rows.map((r) => {
          const e = entries.get(String(r.blocklist_id));
          return {
            id: r.id, network: r.network, platformAdId: r.platform_ad_id || null, advertiser: r.advertiser || names.get(String(r.platform_ad_id)) || null, imageUrl: cut(r.image_url),
            blocklistId: r.blocklist_id, matchType: r.match_type, distance: r.distance === null || r.distance === undefined ? null : num(r.distance),
            source: r.source || null, createdAt: iso(r.created_at),
            matchedEntry: e || null,
          };
        }),
        next: more ? rows[rows.length - 1].id : null,
      };
    } catch (err) {
      if (missingTable(err)) return bad('no_table', 'the blocked-attempts table does not exist in that database yet');
      log.warn?.('monitor: attempts failed', { network: slug, error: err.message });
      return bad('failed', 'the rejected ads could not be read');
    }
  }

  // ── the audit (B6; read only): one audit run per check (e.g. each verification cleanup) and what it found ──
  const AUDIT_STATUSES = ['open', 'in_progress', 'resolved', 'false_positive'];
  const auditShape = (r) => ({
    auditId: r.audit_id, network: r.network, auditType: r.audit_type, status: r.status, startedAt: iso(r.started_at), finishedAt: iso(r.finished_at),
    expectedCount: num(r.expected_count), foundCount: num(r.found_count), takedownRunId: r.takedown_run_id || null, reportUri: r.report_uri || null,
    details: cut(r.details), createdAt: iso(r.created_at),
  });
  const AUDIT_COLUMNS = 'audit_id, network, audit_type, status, started_at, finished_at, expected_count, found_count, takedown_run_id, report_uri, details, created_at';

  /** The audit runs of one network, newest first (or those of one takedown run). The cursor of a page is the `next` of the last. */
  async function audits({ network, takedownRunId, cursor, limit } = {}) {
    const slug = slugOf(network);
    if (!slug || !known(slug)) return bad('invalid_network', 'network must be a known network slug');
    if (takedownRunId && !UUID.test(String(takedownRunId))) return bad('invalid_id', 'takedownRunId must be a run id');
    const n = pageSize(limit, 25, 100);
    let before = null;
    if (cursor) {
      const m = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\|([0-9a-f-]{36})$/i.exec(String(cursor));
      if (!m) return bad('invalid_cursor', 'cursor is not valid');
      before = { at: m[1], id: m[2].toLowerCase() };
    }
    const sql = getSql(slug);
    if (!sql) return bad('no_database', 'there is no database connection for that network');
    try {
      const where = ['network = ?'];
      const params = [slug];
      if (takedownRunId) { where.push('takedown_run_id = ?'); params.push(String(takedownRunId).toLowerCase()); }
      if (before) { where.push('(created_at < ? OR (created_at = ? AND audit_id < ?))'); params.push(before.at, before.at, before.id); }
      const fetched = await sql.query(`SELECT ${AUDIT_COLUMNS} FROM copyright_audit_runs WHERE ${where.join(' AND ')} ORDER BY created_at DESC, audit_id DESC LIMIT ${n + 1}`, params);
      // one row more than a page was asked for: it only tells whether a next page exists, and is not shown
      const more = fetched.length > n;
      const rows = fetched.slice(0, n);
      const last = rows[rows.length - 1];
      return { ok: true, items: rows.map(auditShape), next: more && last ? `${dbTime(last.created_at)}|${last.audit_id}` : null };
    } catch (err) {
      if (missingTable(err)) return bad('no_table', 'the audit tables do not exist in that database yet');
      log.warn?.('monitor: audits failed', { network: slug, error: err.message });
      return bad('failed', 'the audit could not be read');
    }
  }

  /** One audit run, its findings counted by status, and the findings themselves (by id, pages of `limit`). */
  async function auditFindings({ network, auditId, status, afterId = 0, limit } = {}) {
    const slug = slugOf(network);
    if (!slug || !known(slug)) return bad('invalid_network', 'network must be a known network slug');
    if (!UUID.test(String(auditId || ''))) return bad('invalid_id', 'auditId must be an audit id');
    if (status && !AUDIT_STATUSES.includes(status)) return bad('invalid_status', `status must be one of ${AUDIT_STATUSES.join(', ')}`);
    const n = pageSize(limit, 100, 500);
    const sql = getSql(slug);
    if (!sql) return bad('no_database', 'there is no database connection for that network');
    const id = String(auditId).toLowerCase();
    try {
      const [run] = await sql.query(`SELECT ${AUDIT_COLUMNS} FROM copyright_audit_runs WHERE audit_id = ? AND network = ? LIMIT 1`, [id, slug]);
      if (!run) return bad('not_found', 'no such audit');
      const counted = await sql.query('SELECT status, COUNT(*) AS findings FROM copyright_audit_findings WHERE audit_id = ? AND network = ? GROUP BY status', [id, slug]);
      const where = ['audit_id = ?', 'network = ?', 'id > ?'];
      const params = [id, slug, whole(afterId)];
      if (status) { where.push('status = ?'); params.push(status); }
      // `system` is a reserved word in MySQL 8: always quoted.
      const fetched = await sql.query(
        `SELECT id, finding_type, \`system\`, location, internal_ad_id, platform_ad_id, target_type, target_value, details, status, resolution, resolution_note,
                resolved_at, takedown_run_id, created_at
           FROM copyright_audit_findings WHERE ${where.join(' AND ')} ORDER BY id LIMIT ${n + 1}`,
        params
      );
      // one row more than a page was asked for: it only tells whether a next page exists, and is not shown
      const more = fetched.length > n;
      const rows = fetched.slice(0, n);
      const byStatus = {};
      for (const c of counted) byStatus[c.status] = num(c.findings);
      return {
        ok: true,
        audit: auditShape(run),
        counts: { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus },
        items: await withAdvertisers(sql, slug, rows.map((f) => {
          let saved = null;
          try { saved = f.details ? JSON.parse(f.details)?.advertiser || null : null; } catch { saved = null; }
          return {
            id: f.id, findingType: f.finding_type, system: f.system, location: cut(f.location), internalAdId: f.internal_ad_id || null, platformAdId: f.platform_ad_id || null,
            targetType: f.target_type || null, targetValue: cut(f.target_value), details: cut(f.details), status: f.status, resolution: f.resolution || null,
            resolutionNote: cut(f.resolution_note), resolvedAt: iso(f.resolved_at), takedownRunId: f.takedown_run_id || null, createdAt: iso(f.created_at),
            advertiser: saved,
          };
        }), (f) => f.takedownRunId),
        next: more ? rows[rows.length - 1].id : null,
      };
    } catch (err) {
      if (missingTable(err)) return bad('no_table', 'the audit tables do not exist in that database yet');
      log.warn?.('monitor: audit findings failed', { network: slug, error: err.message });
      return bad('failed', 'the audit findings could not be read');
    }
  }

  return { overview, verificationQueue, runs, runLogs, failures, hashJobs, hashJobResults, blocklist, attempts, audits, auditFindings };
}

module.exports = { createMonitorService, groupOf, STATUS_GROUPS };
