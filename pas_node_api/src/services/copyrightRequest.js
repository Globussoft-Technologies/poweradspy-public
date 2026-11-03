'use strict';

/**
 * Copyright request — the landing-page form's connection to the blocklist (single-file, additive).
 *
 * The landing page sends the advertiser name a user filled in; this route hands it to
 * submitAdvertiser() (compliance/imagematch/worker.js), which searches our data for the name, adds it to the blocklist
 * (new ads of that name are refused from then on) and queues the hashing of its images. The answer is immediate; the
 * hashing is the cron job's work and never part of the response.
 *
 * Mounted at /api/v1/copyright ONLY when config.compliance.request.enabled (app.js), and then only with a token or an
 * explicit allowPublic. Plain file under services/ (not a folder) -> NOT auto-mounted by ServiceRegistry; the module is
 * not even required when the feature is off, mirroring services/aiSearch.js.
 *
 *   GET  /api/v1/copyright/review?network=&status=pending&afterId=&limit=      the images held for a person (token required)
 *   POST /api/v1/copyright/review/:id   { network, decision: "allow"|"block", reviewedBy, note? }   decide one (token required)
 *   POST /api/v1/copyright/images/search { network, sha256?, phash?, maxDistance?, limit? }   which stored images are this banned image (token required)
 *   POST /api/v1/copyright/advertiser/block   { name, reason? }
 *        -> 200 { code, message, data: { complaintId, name, found, adsFound } }
 *           400 the name (or reason) cannot be used   401 missing / wrong token   429 too many requests
 *           503 not configured, or the request could not be recorded (nothing is half-done: try again)
 *
 * What the caller may NOT choose: who is recorded as having asked (config.compliance.request.addedBy), the complaint id
 * (generated here) and the network ('all'). The response never carries blocklist ids or internal errors.
 *
 * Approval: today a request is acted on at once. The approval step that will sit in front of it (an agent) is future work;
 * this route is where it plugs in (it calls the route with the token after approving). Until then, switch the feature on only
 * with a token held by a trusted server, or knowingly with allowPublic: anyone who can reach an open route can block any name.
 */

const crypto = require('crypto');
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const logger = require('../logger');
const { asyncHandler } = require('../middleware/errorHandler');

const log = logger.createChild('copyright-request');

const REASON_MAX = 255;
const BAD_INPUT = new Set(['invalid_name', 'invalid_network', 'invalid_complaint_id']);

function tokensMatch(expected, provided) {
  if (typeof expected !== 'string' || !expected || typeof provided !== 'string' || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}

/** The optional reason from the form: one line of text, cut to the column size. */
function reasonOf(raw) {
  if (typeof raw !== 'string') return undefined;
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, REASON_MAX);
  return text || undefined;
}

const reply = (res, code, message, data = null) => res.status(code).json({ code, message, data });

/**
 * @param {Object} [deps]  injectable for tests
 * @param {Object} [deps.settings]  config.compliance.request
 * @param {Function} [deps.submit]  submitAdvertiser
 */
function createRouter({ settings = config.compliance?.request || {}, submit, review, search } = {}) {
  const run = submit || ((input) => require('../compliance/imagematch/worker').submitAdvertiser(input));
  const reviewApi = () => review || require('../compliance/imagematch/worker').review;
  const runSearch = search || (async (network, query) => {
    const sql = require('../database/DatabaseManager').getSQL(network);
    if (!sql) return { ok: false, error: 'no_database', message: 'there is no database connection for that network' };
    return require('../compliance/imagematch/worker').searchStored(sql, network, query);
  });
  const limit = settings.rateLimit || {};
  const limiter = rateLimit({
    windowMs: limit.windowMs || 60000,
    max: limit.max || 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { code: 429, message: 'Too many requests, please try again later.', data: null },
  });

  function authorize(req, res, next) {
    if (settings.token) {
      if (tokensMatch(settings.token, req.headers['x-copyright-token'])) return next();
      log.warn('copyright request with a missing or wrong token', { requestId: req.id });
      return reply(res, 401, 'Not authorised.');
    }
    if (settings.allowPublic === true) return next();
    log.error('copyright request route reached without a token and without allowPublic');
    return reply(res, 503, 'This service is not configured.');
  }

  // The review and search routes are for the approval agent and people who decide: they need the token, even where the advertiser route
  // is knowingly left open (allowPublic).
  function strictAuth(req, res, next) {
    if (!settings.token) return reply(res, 503, 'This service is not configured.');
    if (tokensMatch(settings.token, req.headers['x-copyright-token'])) return next();
    log.warn('copyright review request with a missing or wrong token', { requestId: req.id });
    return reply(res, 401, 'Not authorised.');
  }
  const STATUS_CODE = { not_found: 404, already_resolved: 409, failed: 503, no_database: 503 };

  const router = Router();
  router.post('/advertiser/block', limiter, authorize, asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const out = await run({ name: body.name, reason: reasonOf(body.reason), addedBy: settings.addedBy || 'landing-form', network: 'all' });

    if (!out.ok) {
      if (BAD_INPUT.has(out.error) || (Array.isArray(out.rejected) && out.rejected.length)) {
        return reply(res, 400, out.error === 'invalid_name' ? out.message : 'This advertiser name cannot be used.');
      }
      log.error('copyright request could not be recorded', { error: out.error, message: out.message, failed: out.failed });
      return reply(res, 503, 'We could not record your request right now. Please try again.');
    }
    return reply(res, 200, 'ok', { complaintId: out.complaintId, name: out.name, found: out.matches.length > 0, adsFound: out.totalAds });
  }));

  router.get('/review', limiter, strictAuth, asyncHandler(async (req, res) => {
    const out = await reviewApi().list({ network: req.query.network, status: req.query.status || 'pending', afterId: req.query.afterId, limit: req.query.limit });
    if (!out.ok) return reply(res, STATUS_CODE[out.error] || 400, out.message);
    return reply(res, 200, 'ok', { items: out.items, next: out.next });
  }));

  router.post('/review/:id', limiter, strictAuth, asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const out = await reviewApi().resolve({ network: body.network, id: req.params.id, decision: body.decision, reviewedBy: body.reviewedBy, note: typeof body.note === 'string' ? body.note : undefined });
    if (!out.ok) return reply(res, STATUS_CODE[out.error] || 400, out.message);
    return reply(res, 200, out.message || 'ok', { id: out.id, status: out.status, blocklistAdded: out.blocklistAdded });
  }));

  router.post('/images/search', limiter, strictAuth, asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const network = typeof body.network === 'string' ? body.network.trim().toLowerCase() : '';
    if (!/^[a-z0-9_-]{1,32}$/.test(network)) return reply(res, 400, 'network must be a network slug');
    if (typeof body.sha256 !== 'string' && typeof body.phash !== 'string') return reply(res, 400, 'give a sha256 or a phash to look for');
    const out = await runSearch(network, { sha256: body.sha256, phash: body.phash, maxDistance: body.maxDistance, limit: body.limit, deadline: Date.now() + 20000 });
    if (!out.ok) return reply(res, STATUS_CODE[out.error] || 503, out.message || 'the search could not be done');
    return reply(res, 200, 'ok', { matches: out.matches, scanned: out.scanned, complete: out.complete });
  }));

  return router;
}

module.exports = createRouter();
module.exports.createRouter = createRouter;
module.exports.reasonOf = reasonOf;
