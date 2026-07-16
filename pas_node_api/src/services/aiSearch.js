'use strict';

/**
 * AI Search — payload-planning proxy (single-file, additive).
 *
 * Fronts the DS team's AI-search "payload generation" service so the customer
 * browser never talks to that (currently AUTH-LESS) endpoint directly. Every
 * request here sits behind our JWT (authMiddleware) + an optional per-user
 * allow-list, and /plan is additionally rate-limited to shield the DS service's
 * shared Gemini budget (~20 rpm across ALL clients).
 *
 * Mounted at /api/v1/ai-search ONLY when config.aiSearch.enabled (app.js).
 * Plain file under services/ (not a folder) → NOT auto-mounted by ServiceRegistry;
 * mounting is flag-gated in app.js only, mirroring services/marketTrends.js.
 *
 * Browser-facing endpoints:
 *   POST /api/v1/ai-search/plan   { prompt }
 *        → { code, message, data: { ref_id, prompt, payloads[], model, usage } }
 *        Performs the DS two-step (init → fetch) server-side and returns the full
 *        payload set in one round-trip. `payloads` are most-specific-first (1..3).
 *   GET  /api/v1/ai-search/health
 *        → { code, message, data: { ok, status, upstream } }
 *        Short-cached proxy of the DS /health — drives the frontend AI-toggle gate.
 *
 * Upstream DS contract (see PAYLOAD_API_GUIDE.md):
 *   POST {baseUrl}/search/payload       { prompt } → { ref_id, model, usage }
 *   GET  {baseUrl}/search/payload/{id}            → { ref_id, prompt, payloads, model, usage }
 *   GET  {baseUrl}/health
 */

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const config = require('../config');
const logger = require('../logger');
const { authMiddleware } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const validator = require('../middleware/validator');

const log = logger.createChild('ai-search');

// ─── Resolved config ──────────────────────────────────────────────────────────
const BASE = String(config.aiSearch?.baseUrl || '').replace(/\/+$/, '');
const TIMEOUT_MS = config.aiSearch?.timeoutMs || 15000;
const HEALTH_TIMEOUT_MS = Math.min(TIMEOUT_MS, 5000);
const HEALTH_CACHE_MS = config.aiSearch?.healthCacheMs ?? 15000;
const MAX_PROMPT_LEN = config.aiSearch?.maxPromptLen || 2000;

// Shared axios client to the DS service.
const http = axios.create({
  baseURL: BASE,
  timeout: TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json', accept: 'application/json' },
  // We forward the upstream status ourselves, so don't let 4xx/5xx throw before we inspect them.
  validateStatus: () => true,
});

// ─── Per-user access allow-list (mirrors intelligence/keywordExplorer) ──────────
function isAllowedUser(userId) {
  const allow = config.aiSearch?.allowedUserIds || [];
  if (!allow.length) return true; // empty list → all authenticated users
  if (userId === undefined || userId === null || userId === '') return false;
  return allow.map(String).includes(String(userId));
}
function accessGuard(req, res, next) {
  const uid = req.user?.id ?? req.body?.user_id ?? req.query?.user_id;
  if (!isAllowedUser(uid)) {
    return res.status(403).json({ code: 403, message: 'AI Search is not enabled for this account', data: null });
  }
  return next();
}

// ─── Rate limiter for /plan (keyed per user) — protects the DS Gemini budget ────
const planLimiter = rateLimit({
  windowMs: config.aiSearch?.rateLimitWindowMs || 60000,
  max: config.aiSearch?.rateLimitMax || 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id ?? req.ip),
  message: { code: 429, message: 'Too many AI-search requests, please slow down.', data: null },
});

// ─── Health cache (avoids hammering DS /health when many clients poll) ──────────
let healthCache = { at: 0, body: null };

// ─── Router ─────────────────────────────────────────────────────────────────────
const router = Router();
router.use(authMiddleware);
router.use(accessGuard);

/**
 * POST /plan — plan a natural-language prompt into a fallback payload set.
 */
router.post(
  '/plan',
  planLimiter,
  validator({ body: { prompt: { required: true } } }),
  asyncHandler(async (req, res) => {
    if (!BASE) {
      return res.status(503).json({ code: 503, message: 'AI Search is not configured', data: null });
    }

    const prompt = String(req.body.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ code: 400, message: 'prompt is required', data: null });
    }
    if (prompt.length > MAX_PROMPT_LEN) {
      return res.status(400).json({ code: 400, message: `prompt exceeds ${MAX_PROMPT_LEN} characters`, data: null });
    }

    // Step 1 — init: plan the prompt, get a ref_id back.
    let initData;
    try {
      const initRes = await http.post('/search/payload', { prompt });
      if (initRes.status < 200 || initRes.status >= 300) {
        log.warn('DS init non-2xx', { status: initRes.status });
        return res.status(502).json({ code: 502, message: 'AI Search upstream (init) failed', data: null });
      }
      initData = initRes.data || {};
    } catch (err) {
      log.error('DS init request failed', { error: err.message });
      return res.status(502).json({ code: 502, message: 'AI Search upstream (init) unreachable', data: null });
    }

    const refId = initData.ref_id;
    if (!refId) {
      return res.status(502).json({ code: 502, message: 'AI Search upstream returned no ref_id', data: null });
    }

    // Step 2 — fetch: retrieve the generated payload set for that ref_id.
    try {
      const fetchRes = await http.get(`/search/payload/${encodeURIComponent(refId)}`);
      if (fetchRes.status < 200 || fetchRes.status >= 300) {
        log.warn('DS fetch non-2xx', { status: fetchRes.status, refId });
        return res.status(502).json({ code: 502, message: 'AI Search upstream (fetch) failed', data: null });
      }
      const d = fetchRes.data || {};
      return res.json({
        code: 200,
        message: 'ok',
        data: {
          ref_id: d.ref_id || refId,
          prompt: d.prompt || prompt,
          payloads: Array.isArray(d.payloads) ? d.payloads : [],
          model: d.model ?? initData.model ?? null,
          usage: d.usage ?? initData.usage ?? null,
        },
      });
    } catch (err) {
      log.error('DS fetch request failed', { error: err.message, refId });
      return res.status(502).json({ code: 502, message: 'AI Search upstream (fetch) unreachable', data: null });
    }
  })
);

/**
 * GET /health — short-cached proxy of the DS /health. Never throws: returns
 * { ok:false } on any upstream problem so the frontend simply hides the toggle.
 */
router.get(
  '/health',
  asyncHandler(async (req, res) => {
    if (!BASE) {
      return res.json({ code: 200, message: 'ok', data: { ok: false, status: 'not_configured' } });
    }

    const now = Date.now();
    if (healthCache.body && now - healthCache.at < HEALTH_CACHE_MS) {
      return res.json({ code: 200, message: 'ok', data: healthCache.body });
    }

    let body;
    try {
      const r = await http.get('/health', { timeout: HEALTH_TIMEOUT_MS });
      const up = r.data;
      let ok = r.status >= 200 && r.status < 300;
      // If the upstream reports a status field, require it to read as healthy.
      const statusStr = up && typeof up === 'object' ? String(up.status ?? '') : String(up ?? '');
      if (statusStr && !/\b(ok|healthy|up|pass|ready|true)\b/i.test(statusStr)) ok = false;
      body = { ok, status: statusStr || (ok ? 'ok' : 'unknown'), upstream: up ?? null };
    } catch (err) {
      body = { ok: false, status: 'unreachable', reason: err.message };
    }

    healthCache = { at: now, body };
    return res.json({ code: 200, message: 'ok', data: body });
  })
);

module.exports = router;
