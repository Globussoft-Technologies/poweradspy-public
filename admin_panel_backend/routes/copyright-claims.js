require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { authenticateJWT } = require('../services/authService');

/**
 * Copyright claims: the admin panel's door to the claims service (pas_node_api, /api/v1/copyright/admin/claims).
 *
 * The browser never holds the claims service's secret. This router checks WHO is asking (the admin login's JWT, then an allowlist of
 * user names) and only then calls the claims service with its own server-side admin token. The reviewer's name that is recorded with a
 * decision is ALWAYS the JWT's user_name: anything a client sends as "reviewedBy" is ignored.
 *
 * Environment (all required; with any missing the routes answer 503):
 *   PAS_NODE_API_URL                the claims service, e.g. https://v2-api.poweradspy.com
 *   COPYRIGHT_CLAIMS_ADMIN_TOKEN    its admin token (a different secret from the one the WordPress site holds)
 *   COPYRIGHT_CLAIMS_REVIEWERS      comma-separated user_name values allowed to see and decide claims; empty = nobody
 *
 * Mounted at /admin-panel/copyright-claims (routes/main-routes.js). Nothing here deletes or edits a claim itself.
 */

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVICE = '/api/v1/copyright/admin/claims';
const FILE_HEADERS = ['content-type', 'content-disposition', 'x-content-type-options', 'cache-control', 'content-security-policy'];

const settings = () => ({
  base: String(process.env.PAS_NODE_API_URL || '').trim().replace(/\/+$/, ''),
  token: String(process.env.COPYRIGHT_CLAIMS_ADMIN_TOKEN || '').trim(),
  reviewers: new Set(String(process.env.COPYRIGHT_CLAIMS_REVIEWERS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)),
});

function requireReviewer(req, res, next) {
  const s = settings();
  if (!s.base || !s.token || s.reviewers.size === 0) {
    return res.status(503).json({ code: 503, message: 'Copyright claims are not configured.', data: null });
  }
  const who = String(req.user && req.user.user_name || '').trim().toLowerCase();
  if (!who || !s.reviewers.has(who)) {
    return res.status(403).json({ code: 403, message: 'You are not allowed to review copyright claims.', data: null });
  }
  return next();
}

router.use(authenticateJWT);
router.use(requireReviewer);

const unavailable = (res) => res.status(502).json({ code: 502, message: 'The claims service is unavailable. Please try again.', data: null });
const reviewer = (req) => String(req.user.user_name).trim();
const checkId = (req, res, next) => {
  if (!UUID.test(req.params.id) || (req.params.fileId !== undefined && !UUID.test(req.params.fileId))) {
    return res.status(400).json({ code: 400, message: 'Invalid id.', data: null });
  }
  return next();
};

/** One call to the claims service. A 4xx answer is passed on as it is; anything else the caller cannot fix becomes a plain 502. */
async function call(method, path, { params, data, timeout = 30000, stream = false, service = SERVICE } = {}) {
  const s = settings();
  return axios({
    method, url: `${s.base}${service}${path}`, params, data, timeout,
    headers: { 'x-copyright-admin-token': s.token },
    responseType: stream ? 'stream' : 'json',
    validateStatus: () => true,
  });
}

function relay(res, upstream) {
  const ok = upstream && upstream.status >= 200 && upstream.status < 500 && upstream.data && typeof upstream.data === 'object' && 'code' in upstream.data;
  if (!ok) return unavailable(res);
  return res.status(upstream.status).json(upstream.data);
}

const proxy = (method, path, build = () => ({})) => async (req, res) => {
  try {
    return relay(res, await call(method, typeof path === 'function' ? path(req) : path, build(req)));
  } catch (err) {
    return unavailable(res);
  }
};

router.get('/summary', proxy('GET', '/summary'));

router.get('/', proxy('GET', '', (req) => {
  const q = req.query;
  const params = {};
  for (const key of ['status', 'beforeId', 'limit']) if (typeof q[key] === 'string' && q[key]) params[key] = q[key];
  return { params };
}));

// The monitor (takedown runs and their logs, hash jobs): read only. Before '/:id' so "monitor" is never taken for a claim id.
const NETWORK = /^[a-z0-9_-]{1,32}$/;
const MONITOR = '/api/v1/copyright/admin/monitor';
const passOn = (...keys) => (req) => {
  const params = {};
  for (const key of keys) if (typeof req.query[key] === 'string' && req.query[key]) params[key] = req.query[key];
  return { params, service: MONITOR, timeout: 60000 };
};
const checkMonitor = (req, res, next) => {
  const q = req.query;
  const badNetwork = typeof q.network === 'string' && q.network && !NETWORK.test(q.network);
  const badRun = req.params.runId !== undefined && !UUID.test(req.params.runId);
  const badJob = req.params.jobId !== undefined && !/^\d{1,18}$/.test(req.params.jobId);
  const badComplaint = typeof q.complaintId === 'string' && q.complaintId && !UUID.test(q.complaintId);
  if (badNetwork || badRun || badJob || badComplaint) return res.status(400).json({ code: 400, message: 'Invalid request.', data: null });
  return next();
};
router.get('/monitor/overview', checkMonitor, proxy('GET', '/overview', passOn()));
router.get('/monitor/runs', checkMonitor, proxy('GET', '/runs', passOn('network', 'complaintId', 'status', 'mode', 'cursor', 'limit')));
router.get('/monitor/runs/:runId/logs', checkMonitor, proxy('GET', (req) => `/runs/${req.params.runId}/logs`, passOn('network', 'status', 'system', 'afterId', 'limit')));
router.get('/monitor/failures', checkMonitor, proxy('GET', '/failures', passOn('network', 'beforeId', 'limit')));
router.get('/monitor/blocklist', checkMonitor, proxy('GET', '/blocklist', passOn('network', 'status', 'entryType', 'q', 'beforeId', 'limit')));
router.get('/monitor/attempts', checkMonitor, proxy('GET', '/attempts', passOn('network', 'beforeId', 'limit')));
router.get('/monitor/hash-jobs', checkMonitor, proxy('GET', '/hash-jobs', passOn('network', 'status', 'afterId', 'limit')));
router.get('/monitor/hash-jobs/:jobId/results', checkMonitor, proxy('GET', (req) => `/hash-jobs/${req.params.jobId}/results`, passOn('network', 'generation', 'outcome', 'afterId', 'limit')));

router.get('/:id', checkId, proxy('GET', (req) => `/${req.params.id}`));
router.get('/:id/precheck', checkId, proxy('GET', (req) => `/${req.params.id}/precheck`, () => ({ timeout: 60000 })));

router.post('/:id/accept', checkId, express.json(), proxy('POST', (req) => `/${req.params.id}/accept`, (req) => ({
  timeout: 90000,
  data: { reviewedBy: reviewer(req), evidenceReviewed: req.body && req.body.evidenceReviewed === true, note: typeof (req.body && req.body.note) === 'string' ? req.body.note : undefined },
})));

router.post('/:id/reject', checkId, express.json(), proxy('POST', (req) => `/${req.params.id}/reject`, (req) => ({
  data: { reviewedBy: reviewer(req), reason: typeof (req.body && req.body.reason) === 'string' ? req.body.reason : '' },
})));

router.post('/:id/retry', checkId, proxy('POST', (req) => `/${req.params.id}/retry`, (req) => ({ timeout: 90000, data: { reviewedBy: reviewer(req) } })));

// An evidence file: streamed through, as a download. Only the safe headers are passed on; no address of the storage is ever given out.
router.get('/:id/files/:fileId', checkId, async (req, res) => {
  try {
    const upstream = await call('GET', `/${req.params.id}/files/${req.params.fileId}`, { stream: true, timeout: 60000 });
    if (upstream.status !== 200) {
      if (upstream.data && typeof upstream.data.destroy === 'function') upstream.data.destroy();
      const code = [404, 409].includes(upstream.status) ? upstream.status : 502;
      const message = upstream.status === 409 ? 'The file has not been scanned yet.' : upstream.status === 404 ? 'No such file.' : 'The file cannot be read right now.';
      return res.status(code).json({ code, message, data: null });
    }
    for (const name of FILE_HEADERS) if (upstream.headers[name]) res.setHeader(name, upstream.headers[name]);
    upstream.data.on('error', () => res.destroy());
    return upstream.data.pipe(res);
  } catch (err) {
    return unavailable(res);
  }
});

module.exports = router;
