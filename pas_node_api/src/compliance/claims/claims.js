'use strict';

/**
 * Copyright claims: stored, reviewed and decided by us (the form on the landing page only sends them).
 *
 * A claim is stored as `pending`. A reviewer (through the admin panel) accepts or rejects it. Only ACCEPT starts the work: the
 * advertiser is blocked and its images are queued for hashing (submitAdvertiser, src/compliance/imagematch/worker.js). In three parts:
 *   1. the repository   SQL on copyright_claims (the claims' home database: compliance.claims.homeNetwork)
 *   2. the service      submit / getStatus / list / get / accept / reject / retryProcessing / summary / precheck
 *   3. small helpers    input cleaning, the fingerprint, the status key
 *
 * What it guarantees:
 *   - The same complaint id with the same content is the same claim (a retry returns it; nothing is added twice). The same id with
 *     DIFFERENT content is refused (`conflict`), so a complaint id never means two things.
 *   - A decision is one conditional update (WHERE status = 'pending'): of two reviewers at once exactly one wins; the same decision again
 *     is a success that changes nothing; the opposite decision after one was taken is refused (`already_decided`).
 *   - APPROVAL and PROCESSING are separate. Accepting records the decision first; the blocking and the hash job then run, and what each
 *     network did is stored with the claim (`processing_status` ok / partial / failed and the per-network result). A failure never undoes or
 *     hides the decision; it is shown, and `retryProcessing` runs it again (it is idempotent: the blocklist write is an upsert, and the same
 *     complaint id does not restart a finished hash job).
 *   - A claim's status is shown to the claimant only with a status key derived from the complaint id with a server secret (a complaint id
 *     alone is not proof of identity, and no key has to be stored).
 *   - Nothing here deletes a claim or sends an email.
 *
 * Off by default (compliance.claims.enabled); the routes are in src/services/copyrightClaimsRoutes.js.
 */

const crypto = require('crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const CLAIMS_TABLE = 'copyright_claims';
const STATUS = Object.freeze({ PENDING: 'pending', ACCEPTED: 'accepted', REJECTED: 'rejected' });
const PROCESSING = Object.freeze({ NONE: 'none', OK: 'ok', PARTIAL: 'partial', FAILED: 'failed' });
// No 0 / O / 1 / I / L: a reference is read aloud and typed in an email subject.
const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// ═══ 3. Helpers ═══
const utc = (date = new Date()) => date.toISOString().slice(0, 19).replace('T', ' ');

/** One line of text: control characters become spaces, spaces collapse, cut to `max`. '' when empty or not text. */
function oneLine(raw, max) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** An https:// URL up to 1024 characters, or '' (none) / null (given but not usable). */
function evidenceUrlOf(raw) {
  if (raw === undefined || raw === null || raw === '') return '';
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text || text.length > 1024 || /[\u0000-\u001f\u007f\s]/.test(text)) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && url.hostname ? text : null;
  } catch {
    return null;
  }
}

/** The claim reference: CR- and six readable characters. */
function newReference(random = crypto.randomBytes) {
  const bytes = random(6);
  let out = '';
  for (let i = 0; i < 6; i += 1) out += REF_ALPHABET[bytes[i] % REF_ALPHABET.length];
  return `CR-${out}`;
}

/** What makes two submissions "the same claim": the normalized content, not the formatting. */
function fingerprintOf(c, normalizeName) {
  const normalized = [normalizeName(c.name) || c.name.toLowerCase(), c.reason, c.complainantName, c.complainantEmail.toLowerCase(), c.complainantOrg, c.evidenceUrl, c.sourceReference];
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/** The key that lets a claimant read a claim's status: HMAC of the complaint id with a server secret (nothing is stored). */
function statusKeyOf(secret, complaintId) {
  return crypto.createHmac('sha256', String(secret)).update(`claim-status:${String(complaintId).toLowerCase()}`).digest('hex').slice(0, 40);
}

function sameText(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

/**
 * What submitAdvertiser did, per network, and one word for all of it. ok: blocked everywhere it tried and every hash job queued (or the
 * network has no hashing); partial: blocked somewhere but something failed or was not queued; failed: blocked nowhere.
 */
function processingOf(out) {
  if (!out || out.ok !== true) {
    return { status: PROCESSING.FAILED, result: { ok: false, error: out?.error || 'failed', message: String(out?.message || '').slice(0, 300), networks: [] } };
  }
  const nets = new Map();
  const net = (name) => { if (!nets.has(name)) nets.set(name, { network: name, blocklist: 'not_attempted', hashing: 'not_supported', ads: null }); return nets.get(name); };
  for (const b of out.blocked || []) net(b.network).blocklist = 'ok';
  for (const f of out.failed || []) { const n = net(f.network); n.blocklist = 'failed'; n.error = String(f.error || 'failed').slice(0, 200); }
  for (const h of out.hashing || []) net(h.network).hashing = h.queued ? 'queued' : 'not_queued';
  for (const m of out.matches || []) net(m.network).ads = (net(m.network).ads || 0) + (Number(m.ads) || 0);
  const networks = [...nets.values()];
  const blocked = networks.filter((n) => n.blocklist === 'ok');
  const clean = networks.every((n) => n.blocklist === 'ok' && n.hashing !== 'not_queued');
  const status = blocked.length === 0 ? PROCESSING.FAILED : (clean ? PROCESSING.OK : PROCESSING.PARTIAL);
  return { status, result: { ok: blocked.length > 0, complaintId: out.complaintId, networks, totalAds: Number(out.totalAds) || 0 } };
}

// ═══ 1. Repository ═══
const COLUMNS = `complaint_id, claim_reference, name, reason, complainant_name, complainant_email, complainant_org, evidence_url, source_reference,
  fingerprint, status, received_at, decided_by, decided_at, decision_reason, evidence_reviewed, processing_status, processing_result, processed_at`;

const repository = {
  /** Add a claim. A repeated complaint id or reference adds nothing (the caller reads the row back to tell which). */
  async insert(sql, c) {
    const now = utc();
    await sql.query(
      `INSERT INTO ${CLAIMS_TABLE}
         (complaint_id, claim_reference, name, reason, complainant_name, complainant_email, complainant_org, evidence_url, source_reference,
          fingerprint, status, evidence_reviewed, processing_status, received_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 'none', ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [c.complaintId, c.reference, c.name, c.reason, c.complainantName, c.complainantEmail, c.complainantOrg, c.evidenceUrl, c.sourceReference, c.fingerprint, now, now, now]
    );
  },
  async getByComplaintId(sql, complaintId) {
    const rows = await sql.query(`SELECT id, ${COLUMNS} FROM ${CLAIMS_TABLE} WHERE complaint_id = ? LIMIT 1`, [complaintId]);
    return rows[0] || null;
  },
  /** Newest first, by primary key, one page: pass the `id` of the last row as `beforeId` for the next. */
  async list(sql, { status, beforeId, limit = 25 } = {}) {
    const n = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
    const where = [];
    const params = [];
    if (status) { where.push('status = ?'); params.push(status); }
    if (Number.isSafeInteger(Number(beforeId)) && Number(beforeId) > 0) { where.push('id < ?'); params.push(Number(beforeId)); }
    return sql.query(
      `SELECT id, complaint_id, claim_reference, name, complainant_name, complainant_org, status, received_at, decided_by, decided_at, processing_status
         FROM ${CLAIMS_TABLE} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${n}`,
      params
    );
  },
  async summary(sql) {
    const pending = await sql.query(`SELECT COUNT(*) AS n, MIN(received_at) AS oldest FROM ${CLAIMS_TABLE} WHERE status = 'pending'`, []);
    const failing = await sql.query(`SELECT COUNT(*) AS n FROM ${CLAIMS_TABLE} WHERE status = 'accepted' AND processing_status IN ('partial', 'failed')`, []);
    return { pending: Number(pending[0]?.n) || 0, oldestPendingAt: pending[0]?.oldest || null, failingProcessing: Number(failing[0]?.n) || 0 };
  },
  /** The decision: one conditional update. @returns {Promise<boolean>} true only for the request that changed the row */
  async decide(sql, { complaintId, status, by, reason, evidenceReviewed }) {
    const now = utc();
    const result = await sql.query(
      `UPDATE ${CLAIMS_TABLE}
          SET status = ?, decided_by = ?, decided_at = ?, decision_reason = ?, evidence_reviewed = ?, updated_at = ?
        WHERE complaint_id = ? AND status = 'pending'`,
      [status, by, now, reason || null, evidenceReviewed ? 1 : 0, now, complaintId]
    );
    return Boolean(result?.affectedRows);
  },
  async saveProcessing(sql, { complaintId, status, result }) {
    const now = utc();
    const out = await sql.query(
      `UPDATE ${CLAIMS_TABLE} SET processing_status = ?, processing_result = ?, processed_at = ?, updated_at = ? WHERE complaint_id = ? AND status = 'accepted'`,
      [status, JSON.stringify(result).slice(0, 60000), now, now, complaintId]
    );
    return Boolean(out?.affectedRows);
  },
};

// ═══ 2. Service ═══
/**
 * @param {Object} deps
 * @param {Object} deps.settings     config.compliance.claims
 * @param {(network:string)=>?Object} deps.getSql   the SQL handle of a network's database
 * @param {Object} [deps.repo]
 * @param {(input:Object)=>Promise<Object>} deps.submitAdvertiser   the blocking and hash-job queueing (worker.js)
 * @param {Object} [deps.attachments]   the evidence files service (attachments.js), for the file lists
 * @param {(name:string)=>string} [deps.normalizeName]
 * @param {Object} [deps.precheckDeps]  { networks(): string[], sources, searchSql(network) } for the read-only search before a decision
 */
function createClaimsService({ settings, getSql, repo = repository, submitAdvertiser, attachments, normalizeName = (s) => String(s).trim().toLowerCase(), precheckDeps, log, random = crypto.randomBytes }) {
  const logger = log || { info() {}, warn() {}, error() {} };
  const bad = (error, message) => ({ ok: false, error, message });
  const home = () => getSql(settings.homeNetwork);
  const needSql = () => { const sql = home(); return sql || null; };

  async function readBack(sql, complaintId) { return repo.getByComplaintId(sql, complaintId); }

  /**
   * Check the fields of a claim without writing anything. Required: the advertiser name, who is complaining
   * (name, email, organization) and a reason; optional: an https link and the sender's own reference.
   * @returns {{ ok: true, complaintId: string, claim: Object } | { ok: false, error: string, message: string }}
   */
  function validate(input = {}) {
    const name = oneLine(input.name, 255);
    if (name.length < 2) return bad('invalid_name', 'the advertiser name must be 2 to 255 characters');
    const complainantName = oneLine(input.complainantName, 255);
    if (!complainantName) return bad('invalid_complainant_name', 'the complainant name is required');
    const complainantEmail = oneLine(input.complainantEmail, 255);
    if (!EMAIL.test(complainantEmail)) return bad('invalid_complainant_email', 'a valid complainant email is required');
    const complainantOrg = oneLine(input.complainantOrg, 255);
    if (!complainantOrg) return bad('invalid_complainant_org', 'the company or organization is required');
    const reason = oneLine(input.reason, 255);
    if (!reason) return bad('invalid_reason', 'a reason is required');
    const evidenceUrl = evidenceUrlOf(input.evidenceUrl);
    if (evidenceUrl === null) return bad('invalid_evidence_url', 'the link must be an https:// address of up to 1024 characters');
    const sourceReference = oneLine(input.sourceReference, 255);
    const given = input.complaintId;
    if (given !== undefined && given !== null && given !== '' && !UUID.test(String(given))) return bad('invalid_complaint_id', 'complaintId must be a UUID');
    const complaintId = (given ? String(given) : crypto.randomUUID()).toLowerCase();
    return { ok: true, complaintId, claim: { name, reason, complainantName, complainantEmail, complainantOrg, evidenceUrl, sourceReference } };
  }

  /** Store a claim as pending. Idempotent on the complaint id (see the header). */
  async function submit(input = {}) {
    const checked = validate(input);
    if (!checked.ok) return checked;
    const { complaintId, claim } = checked;
    const sql = needSql();
    if (!sql) return bad('no_database', 'the claims database is not connected');
    const fingerprint = fingerprintOf(claim, normalizeName);

    try {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const existing = await readBack(sql, complaintId);
        if (existing) {
          if (existing.fingerprint !== fingerprint) return bad('conflict', 'this complaint id was already used with different details');
          return { ok: true, repeated: true, complaintId, claimReference: existing.claim_reference, status: existing.status, statusKey: statusKeyOf(settings.statusSecret, complaintId) };
        }
        const reference = newReference(random);
        await repo.insert(sql, { ...claim, complaintId, reference, fingerprint });
        const stored = await readBack(sql, complaintId);
        if (stored) {
          if (stored.fingerprint !== fingerprint) return bad('conflict', 'this complaint id was already used with different details');
          return { ok: true, repeated: stored.claim_reference !== reference, complaintId, claimReference: stored.claim_reference, status: stored.status, statusKey: statusKeyOf(settings.statusSecret, complaintId) };
        }
        // not stored: the reference was taken by another claim; try another one
      }
      return bad('failed', 'could not store the claim');
    } catch (err) {
      logger.error('a claim could not be stored', { error: err.message });
      return bad('failed', 'could not store the claim');
    }
  }

  /** The coarse status for a claimant. A wrong key answers like an unknown claim. */
  async function getStatus({ complaintId, key }) {
    if (!UUID.test(String(complaintId || '')) || !sameText(statusKeyOf(settings.statusSecret, complaintId), key)) return bad('not_found', 'no such claim');
    const sql = needSql();
    if (!sql) return bad('no_database', 'the claims database is not connected');
    try {
      const row = await readBack(sql, String(complaintId).toLowerCase());
      if (!row) return bad('not_found', 'no such claim');
      return { ok: true, status: row.status, decidedAt: row.decided_at || null };
    } catch (err) {
      return bad('failed', err.message);
    }
  }

  /** Does this status key belong to this claim, and is the claim still pending (files can be added)? */
  async function claimForUpload({ complaintId, key }) {
    const status = await getStatus({ complaintId, key });
    if (!status.ok) return status;
    if (status.status !== STATUS.PENDING) return bad('not_pending', 'files can only be added to a claim that is waiting for review');
    return { ok: true, complaintId: String(complaintId).toLowerCase(), sql: home() };
  }

  async function list({ status, beforeId, limit } = {}) {
    if (status && !Object.values(STATUS).includes(status)) return bad('invalid_status', `status must be one of ${Object.values(STATUS).join(', ')}`);
    const sql = needSql();
    if (!sql) return bad('no_database', 'the claims database is not connected');
    try {
      const rows = await repo.list(sql, { status, beforeId, limit });
      return { ok: true, items: rows.map(shortView), next: rows.length ? rows[rows.length - 1].id : null };
    } catch (err) {
      return bad('failed', err.message);
    }
  }

  async function summary() {
    const sql = needSql();
    if (!sql) return { ok: false, error: 'no_database', message: 'the claims database is not connected' };
    try {
      return { ok: true, ...(await repo.summary(sql)) };
    } catch (err) {
      return bad('failed', err.message);
    }
  }

  /** One claim for a reviewer: everything it holds, its files (names and states) and what processing did. */
  async function get(complaintId) {
    if (!UUID.test(String(complaintId || ''))) return bad('not_found', 'no such claim');
    const sql = needSql();
    if (!sql) return bad('no_database', 'the claims database is not connected');
    try {
      const row = await readBack(sql, String(complaintId).toLowerCase());
      if (!row) return bad('not_found', 'no such claim');
      let files = [];
      let filesError = null;
      if (attachments) {
        try { files = await attachments.listFiles({ sql, complaintId: row.complaint_id }); } catch (err) { filesError = 'unable to list the files'; }
      }
      return { ok: true, claim: fullView(row), files, filesError };
    } catch (err) {
      return bad('failed', err.message);
    }
  }

  /** The read-only search of each network for the claimed name, before a decision. "unable to check" is never "no ads found". */
  async function precheck(complaintId) {
    const found = await get(complaintId);
    if (!found.ok) return found;
    if (!precheckDeps) return { ok: true, networks: [], note: 'the search is not configured' };
    const networks = [];
    for (const network of precheckDeps.networks()) {
      if (!precheckDeps.supports(network)) { networks.push({ network, check: 'not_supported' }); continue; }
      try {
        const sql = precheckDeps.sqlOf(network);
        if (!sql) { networks.push({ network, check: 'unable_to_check', reason: 'no database connection' }); continue; }
        const owners = await precheckDeps.findOwners(sql, network, found.claim.name);
        const ads = owners.reduce((sum, o) => sum + (Number(o.ads_count) || 0), 0);
        networks.push(owners.length ? { network, check: 'found', owners: owners.length, ads } : { network, check: 'not_found' });
      } catch (err) {
        networks.push({ network, check: 'unable_to_check', reason: String(err.message || 'failed').slice(0, 150) });
      }
    }
    return { ok: true, networks };
  }

  async function runProcessing(sql, row, by) {
    let out;
    try {
      out = await submitAdvertiser({ name: row.name, addedBy: by, reason: `copyright claim ${row.claim_reference}: ${row.reason}`.slice(0, 255), complaintId: row.complaint_id, network: 'all' });
    } catch (err) {
      out = { ok: false, error: 'failed', message: err.message };
    }
    const processed = processingOf(out);
    try {
      await repo.saveProcessing(sql, { complaintId: row.complaint_id, status: processed.status, result: processed.result });
    } catch (err) {
      logger.error('the result of the processing of a claim could not be saved', { complaintId: row.complaint_id, error: err.message });
    }
    return processed;
  }

  function checkReviewer(reviewedBy) {
    const by = oneLine(reviewedBy, 128);
    return by.length >= 2 ? by : null;
  }

  /**
   * Accept a claim. The decision is recorded first (one conditional update); then the blocking and the hash job run and their result is
   * stored. Accepting again is a success that does nothing; accepting a rejected claim is refused.
   */
  async function accept({ complaintId, reviewedBy, evidenceReviewed, note }) {
    const by = checkReviewer(reviewedBy);
    if (!by) return bad('reviewer_required', 'reviewedBy is required: who is deciding');
    if (settings.requireEvidenceReviewed !== false && evidenceReviewed !== true) return bad('evidence_not_reviewed', 'confirm that the supporting documents were reviewed');
    if (!UUID.test(String(complaintId || ''))) return bad('not_found', 'no such claim');
    const sql = needSql();
    if (!sql) return bad('no_database', 'the claims database is not connected');
    const id = String(complaintId).toLowerCase();
    try {
      const row = await readBack(sql, id);
      if (!row) return bad('not_found', 'no such claim');
      if (row.status === STATUS.REJECTED) return bad('already_decided', 'this claim was already rejected');
      if (row.status === STATUS.ACCEPTED) return { ok: true, status: STATUS.ACCEPTED, already: true, processingStatus: row.processing_status };
      const won = await repo.decide(sql, { complaintId: id, status: STATUS.ACCEPTED, by, reason: oneLine(note, 255), evidenceReviewed: true });
      if (!won) {
        const now = await readBack(sql, id);
        if (now && now.status === STATUS.ACCEPTED) return { ok: true, status: STATUS.ACCEPTED, already: true, processingStatus: now.processing_status };
        return bad('already_decided', 'this claim was decided at the same time by someone else');
      }
      const processed = await runProcessing(sql, { ...row, status: STATUS.ACCEPTED }, by);
      return { ok: true, status: STATUS.ACCEPTED, processingStatus: processed.status, processing: processed.result };
    } catch (err) {
      logger.error('a claim could not be accepted', { error: err.message });
      return bad('failed', 'the decision could not be recorded');
    }
  }

  /** Reject a claim (a reason is required). Rejecting again does nothing; rejecting an accepted claim is refused. */
  async function reject({ complaintId, reviewedBy, reason }) {
    const by = checkReviewer(reviewedBy);
    if (!by) return bad('reviewer_required', 'reviewedBy is required: who is deciding');
    const why = oneLine(reason, 255);
    if (!why) return bad('reason_required', 'a reason is required to reject a claim');
    if (!UUID.test(String(complaintId || ''))) return bad('not_found', 'no such claim');
    const sql = needSql();
    if (!sql) return bad('no_database', 'the claims database is not connected');
    const id = String(complaintId).toLowerCase();
    try {
      const row = await readBack(sql, id);
      if (!row) return bad('not_found', 'no such claim');
      if (row.status === STATUS.ACCEPTED) return bad('already_decided', 'this claim was already accepted');
      if (row.status === STATUS.REJECTED) return { ok: true, status: STATUS.REJECTED, already: true };
      const won = await repo.decide(sql, { complaintId: id, status: STATUS.REJECTED, by, reason: why, evidenceReviewed: false });
      if (!won) {
        const now = await readBack(sql, id);
        if (now && now.status === STATUS.REJECTED) return { ok: true, status: STATUS.REJECTED, already: true };
        return bad('already_decided', 'this claim was decided at the same time by someone else');
      }
      return { ok: true, status: STATUS.REJECTED };
    } catch (err) {
      logger.error('a claim could not be rejected', { error: err.message });
      return bad('failed', 'the decision could not be recorded');
    }
  }

  /** Run the processing of an ACCEPTED claim again (a network failed, or a hash job was not queued). Idempotent. */
  async function retryProcessing({ complaintId, reviewedBy }) {
    const by = checkReviewer(reviewedBy);
    if (!by) return bad('reviewer_required', 'reviewedBy is required: who is retrying');
    if (!UUID.test(String(complaintId || ''))) return bad('not_found', 'no such claim');
    const sql = needSql();
    if (!sql) return bad('no_database', 'the claims database is not connected');
    try {
      const row = await readBack(sql, String(complaintId).toLowerCase());
      if (!row) return bad('not_found', 'no such claim');
      if (row.status !== STATUS.ACCEPTED) return bad('not_accepted', 'only an accepted claim has anything to retry');
      const processed = await runProcessing(sql, row, by);
      return { ok: true, processingStatus: processed.status, processing: processed.result };
    } catch (err) {
      logger.error('a claim could not be retried', { error: err.message });
      return bad('failed', 'the retry could not be done');
    }
  }

  /** Open one evidence file of a claim for a reviewer: the stream and the download-only headers (the admin route has checked the login). */
  async function openFile({ complaintId, fileId }) {
    if (!attachments) return bad('not_configured', 'evidence files are not enabled');
    if (!UUID.test(String(complaintId || ''))) return bad('not_found', 'no such claim');
    const sql = needSql();
    if (!sql) return bad('no_database', 'the claims database is not connected');
    try {
      const row = await readBack(sql, String(complaintId).toLowerCase());
      if (!row) return bad('not_found', 'no such claim');
      return await attachments.openFile({ sql, complaintId: row.complaint_id, fileId });
    } catch (err) {
      logger.error('a claim file could not be opened', { error: err.message });
      return bad('failed', 'the file cannot be read');
    }
  }

  return { validate, databaseOf: needSql, submit, getStatus, claimForUpload, list, summary, get, precheck, accept, reject, retryProcessing, openFile, isEnabled: () => settings.enabled === true };
}

/** The list row: enough to choose a claim, no contact details. */
function shortView(r) {
  return {
    id: r.id, complaintId: r.complaint_id, reference: r.claim_reference, name: r.name, organization: r.complainant_org, status: r.status,
    receivedAt: r.received_at, decidedBy: r.decided_by || null, decidedAt: r.decided_at || null, processingStatus: r.processing_status,
  };
}

/** The whole claim for a reviewer. The status key, the fingerprint and the database id are never part of it. */
function fullView(r) {
  let processing = null;
  try { processing = r.processing_result ? JSON.parse(r.processing_result) : null; } catch { processing = null; }
  return {
    complaintId: r.complaint_id, reference: r.claim_reference, name: r.name, reason: r.reason,
    complainant: { name: r.complainant_name, email: r.complainant_email, organization: r.complainant_org },
    evidenceUrl: r.evidence_url || null, sourceReference: r.source_reference || null,
    status: r.status, receivedAt: r.received_at,
    decision: r.status === STATUS.PENDING ? null : { by: r.decided_by, at: r.decided_at, reason: r.decision_reason || null, evidenceReviewed: Boolean(r.evidence_reviewed) },
    processingStatus: r.processing_status, processing, processedAt: r.processed_at || null,
  };
}

module.exports = {
  STATUS, PROCESSING, CLAIMS_TABLE, oneLine, evidenceUrlOf, newReference, fingerprintOf, statusKeyOf, processingOf,
  repository, createClaimsService, shortView, fullView,
};
