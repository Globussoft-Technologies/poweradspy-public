'use strict';

/**
 * Copyright claims: the routes (src/compliance/claims/claims.js and attachments.js do the work). Mounted by services/copyrightRequest.js,
 * under /api/v1/copyright, ONLY when config.compliance.claims.enabled. Two callers, two secrets, deliberately different:
 *
 *   The WordPress server (header x-copyright-token = COPYRIGHT_REQUEST_TOKEN)
 *     POST /claims                      { name, complainantName, complainantEmail, complainantOrg, reason, complaintId?, evidenceUrl?, sourceReference? }
 *     POST /claims/:id/attachments      multipart, field "files" (up to 5 files of 5 MB); header x-claim-key = the status key from the first call
 *     GET  /claims/:id                  the coarse status; header x-claim-key (or ?key=)
 *
 *   The admin panel's backend (header x-copyright-admin-token = COPYRIGHT_CLAIMS_ADMIN_TOKEN, a different secret)
 *     GET  /admin/claims/summary        { pending, oldestPendingAt, failingProcessing } for the badge
 *     GET  /admin/claims?status=&beforeId=&limit=
 *     GET  /admin/claims/:id            the claim, its files (names and states), what processing did
 *     GET  /admin/claims/:id/precheck   the read-only search of each network ("unable to check" is never "no ads found")
 *     POST /admin/claims/:id/accept     { reviewedBy, evidenceReviewed: true, note? }
 *     POST /admin/claims/:id/reject     { reviewedBy, reason }
 *     POST /admin/claims/:id/retry      { reviewedBy }  run the processing of an accepted claim again
 *     GET  /admin/claims/:id/files/:fileId   the file, as a download, through this server (no URL of the NAS is ever given out)
 *
 *     GET  /admin/monitor/overview               takedown runs / deleted / waiting / failed per network, and the hash jobs by status
 *     GET  /admin/monitor/verification?network=&afterId=&limit= current pending ads and their last verification stage
 *     GET  /admin/monitor/runs?network=|complaintId=&status=&mode=&cursor=&limit=   takedown runs, newest first
 *     GET  /admin/monitor/runs/:runId/logs?network=&status=&system=&afterId=&limit=  one run and the log of every step
 *     GET  /admin/monitor/failures?network=&beforeId=&limit=   the newest failed steps of a network
 *     GET  /admin/monitor/hash-jobs?network=&status=&afterId=   the hash jobs;  /admin/monitor/hash-jobs/:jobId/results?network=&outcome=&afterId=
 *     GET  /admin/monitor/blocklist?network=&status=&entryType=&q=&beforeId=&limit=   who and what is blocked (B1), with counts
 *     GET  /admin/monitor/attempts?network=&beforeId=&limit=     the ads the blocklist refused at ingestion
 *     GET  /admin/monitor/audits?network=&takedownRunId=&cursor=&limit=   the audit runs (B6), newest first
 *     GET  /admin/monitor/audits/:auditId/findings?network=&status=&afterId=&limit=   one audit run and its findings
 *   (the monitor is read only; it reads B1's blocklist, B3's takedown tables, B2's hash tables and B6's audit tables and changes nothing)
 *
 * The WordPress token cannot call the admin routes (and the two tokens must differ, or the admin routes are not mounted): otherwise the site
 * that submits claims could also approve them. Every answer is { code, message, data }.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const logger = require('../logger');
const { asyncHandler } = require('../middleware/errorHandler');

const log = logger.createChild('copyright-claims');
const reply = (res, code, message, data = null) => res.status(code).json({ code, message, data });

const STATUS_OF = {
  not_found: 404, conflict: 409, already_decided: 409, not_pending: 409, not_accepted: 409, scan_pending: 409,
  evidence_not_reviewed: 400, reviewer_required: 400, reason_required: 400, invalid_status: 400,
  unavailable: 503, no_database: 503, failed: 503, not_configured: 503,
};
const statusOf = (error) => STATUS_OF[error] || (String(error || '').startsWith('invalid_') ? 400 : 503);

function same(expected, provided) {
  if (typeof expected !== 'string' || !expected || typeof provided !== 'string' || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * @param {Object} [deps]  injectable for tests
 * @param {Object} [deps.settings]       config.compliance.claims
 * @param {Object} [deps.requestSettings] config.compliance.request (the WordPress token and the rate limit)
 * @param {Object} [deps.claims]         the claims service
 * @param {Object} [deps.attachments]    the attachments service
 */
function createClaimsRouter({ settings = config.compliance?.claims || {}, requestSettings = config.compliance?.request || {}, claims, attachments, monitor } = {}) {
  const service = claims || buildClaimsService(settings);
  let monitorService = monitor || null;
  const monitorOf = () => { monitorService = monitorService || buildMonitor(); return monitorService; };
  const files = attachments || (settings.attachments && settings.attachments.enabled ? buildAttachments(settings) : null);
  const attachmentSettings = settings.attachments || {};

  const limit = requestSettings.rateLimit || {};
  const limiter = rateLimit({
    windowMs: limit.windowMs || 60000,
    max: limit.max || 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { code: 429, message: 'Too many requests, please try again later.', data: null },
  });
  // The admin panel is used by people, not by a form: a higher ceiling.
  const adminLimiter = rateLimit({
    windowMs: 60000, max: 240, standardHeaders: true, legacyHeaders: false,
    message: { code: 429, message: 'Too many requests, please try again later.', data: null },
  });

  function siteAuth(req, res, next) {
    if (!requestSettings.token) return reply(res, 503, 'This service is not configured.');
    if (same(requestSettings.token, req.headers['x-copyright-token'])) return next();
    log.warn('claims request with a missing or wrong token', { requestId: req.id });
    return reply(res, 401, 'Not authorised.');
  }

  // The admin token must exist and must not be the WordPress token.
  const adminReady = Boolean(settings.adminToken) && settings.adminToken !== requestSettings.token;
  function adminAuth(req, res, next) {
    if (!adminReady) return reply(res, 503, 'This service is not configured.');
    if (same(settings.adminToken, req.headers['x-copyright-admin-token'])) return next();
    log.warn('claims admin request with a missing or wrong token', { requestId: req.id });
    return reply(res, 401, 'Not authorised.');
  }
  if (!adminReady) log.error('compliance.claims: the admin token is missing, or equals the WordPress token; the admin routes answer 503 until it is set');
  if (!settings.statusSecret) log.error('compliance.claims: COPYRIGHT_CLAIMS_STATUS_SECRET is not set; claims cannot be submitted');

  const router = Router();
  const body = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
  const keyOf = (req) => req.headers['x-claim-key'] || (typeof req.query.key === 'string' ? req.query.key : '');

  /**
   * The one call of the WordPress form: the fields and the files together. Nothing is written until the fields are valid; the files go
   * to the private bucket under an id made here, and the claim is stored only when every file was stored. If the claim cannot be stored,
   * the files just stored are removed again, so a failed call leaves nothing behind. WordPress gets back only the claim reference.
   */
  async function submitWithFiles(req, res) {
    if (!files) return reply(res, 503, 'Files cannot be accepted right now.');
    const uploaded = await receiveFiles(req, res, attachmentSettings, { fields: 12 });
    if (uploaded.error) return reply(res, 400, uploaded.error);
    const stored = [];
    try {
      const checked = service.validate(body(req));
      if (!checked.ok) return reply(res, statusOf(checked.error), checked.message);
      const sql = service.databaseOf();
      if (!sql) return reply(res, 503, 'We could not record the claim right now. Please try again.');

      const out = await files.addFiles({ sql, complaintId: checked.complaintId, files: uploaded.files });
      if (out.error) return reply(res, statusOf(out.error), out.error === 'not_configured' ? 'Files cannot be accepted right now.' : out.error);
      for (const r of out.results) if (r.ok && !r.duplicate) stored.push(r.fileId);
      if (out.results.some((r) => !r.ok)) {
        await discardFiles(sql, checked.complaintId, stored);
        return reply(res, 422, 'a file was refused, so the claim was not recorded', { results: out.results.map(({ ok, name, reason }) => ({ ok, name, reason })) });
      }

      const claim = await service.submit({ ...body(req), complaintId: checked.complaintId });
      if (!claim.ok) {
        await discardFiles(sql, checked.complaintId, stored);
        const code = statusOf(claim.error);
        return reply(res, code, code === 503 ? 'We could not record the claim right now. Please try again.' : claim.message, null);
      }
      stored.length = 0;
      return reply(res, 200, 'ok', { claimReference: claim.claimReference });
    } finally {
      for (const f of uploaded.files) fs.unlink(f.path, () => {});
    }
  }

  async function discardFiles(sql, complaintId, fileIds) {
    for (const fileId of fileIds) {
      try { await files.deleteFile({ sql, complaintId, fileId }); } catch (err) { log.error('a file of a claim that was not stored could not be removed', { error: err.message }); }
    }
  }

  // ── the WordPress server ──
  router.post('/claims',limiter, siteAuth, asyncHandler(async (req, res) => {
    if (!settings.statusSecret) return reply(res, 503, 'This service is not configured.');
    if (req.is('multipart/form-data')) return submitWithFiles(req, res);
    const out = await service.submit(body(req));
    if (!out.ok) {
      const code = statusOf(out.error);
      return reply(res, code, code === 503 ? 'We could not record the claim right now. Please try again with the same complaint id.' : out.message, null);
    }
    return reply(res, 200, 'ok', { complaintId: out.complaintId, claimReference: out.claimReference, status: out.status, statusKey: out.statusKey });
  }));

  router.get('/claims/:id', limiter, siteAuth, asyncHandler(async (req, res) => {
    const out = await service.getStatus({ complaintId: req.params.id, key: keyOf(req) });
    if (!out.ok) return reply(res, statusOf(out.error), out.error === 'not_found' ? 'no such claim' : 'the status could not be read');
    return reply(res, 200, 'ok', { status: out.status, decidedAt: out.decidedAt });
  }));

  router.post('/claims/:id/attachments', limiter, siteAuth, asyncHandler(async (req, res) => {
    if (!files) return reply(res, 503, 'Files cannot be accepted right now.');
    const owner = await service.claimForUpload({ complaintId: req.params.id, key: keyOf(req) });
    if (!owner.ok) return reply(res, statusOf(owner.error), owner.error === 'not_found' ? 'no such claim' : owner.message || 'files cannot be added');

    const uploaded = await receiveFiles(req, res, attachmentSettings);
    if (uploaded.error) return reply(res, 400, uploaded.error);
    try {
      const out = await files.addFiles({ sql: owner.sql, complaintId: owner.complaintId, files: uploaded.files });
      if (out.error) return reply(res, statusOf(out.error), out.error === 'not_configured' ? 'Files cannot be accepted right now.' : out.error);
      return reply(res, out.ok ? 200 : 422, out.ok ? 'ok' : 'none of the files could be stored', { results: out.results });
    } finally {
      for (const f of uploaded.files) fs.unlink(f.path, () => {});
    }
  }));

  // ── the admin panel's backend ──
  router.get('/admin/claims/summary', adminLimiter, adminAuth, asyncHandler(async (req, res) => {
    const out = await service.summary();
    if (!out.ok) return reply(res, statusOf(out.error), 'unavailable');
    return reply(res, 200, 'ok', { pending: out.pending, oldestPendingAt: out.oldestPendingAt, failingProcessing: out.failingProcessing });
  }));

  router.get('/admin/claims', adminLimiter, adminAuth, asyncHandler(async (req, res) => {
    const out = await service.list({ status: req.query.status || undefined, beforeId: req.query.beforeId, limit: req.query.limit });
    if (!out.ok) return reply(res, statusOf(out.error), out.message || 'unavailable');
    return reply(res, 200, 'ok', { items: out.items, next: out.next });
  }));

  router.get('/admin/claims/:id', adminLimiter, adminAuth, asyncHandler(async (req, res) => {
    const out = await service.get(req.params.id);
    if (!out.ok) return reply(res, statusOf(out.error), out.message || 'unavailable');
    return reply(res, 200, 'ok', { claim: out.claim, files: out.files, filesError: out.filesError });
  }));

  router.get('/admin/claims/:id/precheck', adminLimiter, adminAuth, asyncHandler(async (req, res) => {
    const out = await service.precheck(req.params.id);
    if (!out.ok) return reply(res, statusOf(out.error), out.message || 'unavailable');
    return reply(res, 200, 'ok', { networks: out.networks });
  }));

  router.post('/admin/claims/:id/accept', adminLimiter, adminAuth, asyncHandler(async (req, res) => {
    const b = body(req);
    const out = await service.accept({ complaintId: req.params.id, reviewedBy: b.reviewedBy, evidenceReviewed: b.evidenceReviewed, note: b.note });
    if (!out.ok) return reply(res, statusOf(out.error), out.message);
    return reply(res, 200, out.already ? 'already accepted' : 'ok', { status: out.status, already: Boolean(out.already), processingStatus: out.processingStatus, processing: out.processing || null });
  }));

  router.post('/admin/claims/:id/reject', adminLimiter, adminAuth, asyncHandler(async (req, res) => {
    const b = body(req);
    const out = await service.reject({ complaintId: req.params.id, reviewedBy: b.reviewedBy, reason: b.reason });
    if (!out.ok) return reply(res, statusOf(out.error), out.message);
    return reply(res, 200, out.already ? 'already rejected' : 'ok', { status: out.status, already: Boolean(out.already) });
  }));

  router.post('/admin/claims/:id/retry', adminLimiter, adminAuth, asyncHandler(async (req, res) => {
    const out = await service.retryProcessing({ complaintId: req.params.id, reviewedBy: body(req).reviewedBy });
    if (!out.ok) return reply(res, statusOf(out.error), out.message);
    return reply(res, 200, 'ok', { processingStatus: out.processingStatus, processing: out.processing });
  }));

  router.get('/admin/claims/:id/files/:fileId', adminLimiter, adminAuth, asyncHandler(async (req, res) => {
    const opened = await service.openFile({ complaintId: req.params.id, fileId: req.params.fileId });
    if (!opened.ok) return reply(res, statusOf(opened.error), opened.error === 'scan_pending' ? 'the file has not been scanned yet' : opened.error === 'not_found' ? 'no such file' : 'the file cannot be read');
    for (const [name, value] of Object.entries(opened.headers)) res.setHeader(name, value);
    opened.stream.on('error', () => res.destroy());
    return opened.stream.pipe(res);
  }));

  // ── the monitor: takedown runs and their logs, hash jobs. READ ONLY (see compliance/monitor/monitor.js) ──
  const monitorRoute = (method, build) => asyncHandler(async (req, res) => {
    const out = await monitorOf()[method](...build(req));
    if (!out.ok) return reply(res, statusOf(out.error), out.message || 'unavailable');
    const { ok, ...data } = out;
    return reply(res, 200, 'ok', data);
  });
  const q = (req) => req.query;
  router.get('/admin/monitor/overview', adminLimiter, adminAuth, monitorRoute('overview', () => []));
  router.get('/admin/monitor/verification', adminLimiter, adminAuth, monitorRoute('verificationQueue', (req) => [{ network: q(req).network, afterId: q(req).afterId, limit: q(req).limit }]));
  router.get('/admin/monitor/runs', adminLimiter, adminAuth, monitorRoute('runs', (req) => [{ network: q(req).network, complaintId: q(req).complaintId, status: q(req).status, mode: q(req).mode, cursor: q(req).cursor, limit: q(req).limit }]));
  router.get('/admin/monitor/runs/:runId/logs', adminLimiter, adminAuth, monitorRoute('runLogs', (req) => [{ network: q(req).network, runId: req.params.runId, status: q(req).status, system: q(req).system, afterId: q(req).afterId, limit: q(req).limit }]));
  router.get('/admin/monitor/failures', adminLimiter, adminAuth, monitorRoute('failures', (req) => [{ network: q(req).network, beforeId: q(req).beforeId, limit: q(req).limit }]));
  router.get('/admin/monitor/hash-jobs', adminLimiter, adminAuth, monitorRoute('hashJobs', (req) => [{ network: q(req).network, status: q(req).status, afterId: q(req).afterId, limit: q(req).limit }]));
  router.get('/admin/monitor/blocklist', adminLimiter, adminAuth, monitorRoute('blocklist', (req) => [{ network: q(req).network, status: q(req).status, entryType: q(req).entryType, q: q(req).q, beforeId: q(req).beforeId, limit: q(req).limit }]));
  router.get('/admin/monitor/attempts', adminLimiter, adminAuth, monitorRoute('attempts', (req) => [{ network: q(req).network, beforeId: q(req).beforeId, limit: q(req).limit }]));
  router.get('/admin/monitor/audits', adminLimiter, adminAuth, monitorRoute('audits', (req) => [{ network: q(req).network, takedownRunId: q(req).takedownRunId, cursor: q(req).cursor, limit: q(req).limit }]));
  router.get('/admin/monitor/audits/:auditId/findings', adminLimiter, adminAuth, monitorRoute('auditFindings', (req) => [{ network: q(req).network, auditId: req.params.auditId, status: q(req).status, afterId: q(req).afterId, limit: q(req).limit }]));
  router.get('/admin/monitor/hash-jobs/:jobId/results', adminLimiter, adminAuth, monitorRoute('hashJobResults', (req) => [{ network: q(req).network, jobId: req.params.jobId, generation: q(req).generation, outcome: q(req).outcome, afterId: q(req).afterId, limit: q(req).limit }]));

  return router;
}

function buildMonitor() {
  const { createMonitorService } = require('../compliance/monitor/monitor');
  const manager = require('../database/DatabaseManager');
  const networksConfig = require('../config/networks');
  return createMonitorService({
    networks: () => Object.entries(networksConfig).filter(([, c]) => c?.database?.sql?.enabled).map(([n]) => n),
    getSql: (network) => manager.getSQL(network),
    jobs: require('../compliance/imagematch/worker').jobs,
    // network -> ad table with copyright_status: the verification queue counts of the overview
    adTables: Object.fromEntries(Object.entries(require('./copyrightVerification/status').NETWORKS).map(([n, [table]]) => [n, table])),
    log,
  });
}

// ── the real objects behind the routes (loaded only when the routes are mounted) ──
function buildClaimsService(settings) {
  const { createClaimsService } = require('../compliance/claims/claims');
  const worker = require('../compliance/imagematch/worker');
  const sources = require('../compliance/imagematch/sources');
  const manager = require('../database/DatabaseManager');
  const networksConfig = require('../config/networks');
  const { normalizeName } = require('../compliance/blocklist/normalize');
  const attachments = settings.attachments && settings.attachments.enabled ? buildAttachments(settings) : null;
  return createClaimsService({
    settings,
    getSql: (network) => manager.getSQL(network),
    submitAdvertiser: worker.submitAdvertiser,
    attachments,
    normalizeName,
    log,
    precheckDeps: {
      // the networks the blocklist covers: SQL enabled with an insertion block
      networks: () => Object.entries(networksConfig).filter(([, c]) => c?.database?.sql?.enabled && c?.insertion).map(([n]) => n),
      supports: (network) => Object.prototype.hasOwnProperty.call(sources.SOURCES, network),
      sqlOf: (network) => manager.getSQL(network),
      findOwners: (sql, network, name) => sources.findOwners(sql, sources.sourceFor(network), sources.nameCandidates(name)),
    },
  });
}

function buildAttachments(settings) {
  const { createAttachmentService } = require('../compliance/claims/attachments');
  return createAttachmentService({ settings: settings.attachments, scanner: null, log });
}

/** Read a multipart request into temp files (size and count limited while receiving). Resolves { files } or { error }. */
function receiveFiles(req, res, att, { fields = 5 } = {}) {
  return new Promise((resolve) => {
    const multer = require('multer');
    const dir = path.join(os.tmpdir(), 'pas-claim-uploads');
    try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* multer reports it */ }
    const upload = multer({ dest: dir, limits: { files: att.maxFiles || 5, fileSize: att.maxFileBytes || 5 * 1024 * 1024, fields, parts: 30 } }).array('files', att.maxFiles || 5);
    upload(req, res, (err) => {
      const received = (req.files || []).map((f) => ({ path: f.path, originalName: f.originalname }));
      if (err) {
        for (const f of received) fs.unlink(f.path, () => {});
        const message = err.code === 'LIMIT_FILE_SIZE' ? 'a file is larger than the limit'
          : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'too many files, or a wrong field name (use "files")'
            : 'the upload could not be read';
        return resolve({ error: message });
      }
      if (!received.length) return resolve({ error: 'no files were sent (use the field "files")' });
      return resolve({ files: received });
    });
  });
}

module.exports = { createClaimsRouter, statusOf };
