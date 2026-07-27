'use strict';

const { Router } = require('express');
const multer = require('multer');
const { asyncHandler } = require('../../../middleware/errorHandler');
const ResponseFormatter = require('../../../utils/responseFormatter');
const { searchAds } = require('../controllers/adSearchController');
const { getTopAds } = require('../controllers/getTopAdsController');
const { getAdsCount } = require('../controllers/adCountController');
const { getAdDetails } = require('../controllers/adDetailController');
const { hideAds, getHiddenPostOwners, unHide } = require('../controllers/hideAdsController');
const {
  getLikeCommentShareDetails,
  getGoogleAdCountry,
  getGoogleOutgoings,
  getAdvertiserCountryData,
  getAdvertiserInsightsByDateRange,
} = require('../controllers/adInsightsController');
const { searchAuditKeywords, insertSearchAuditKeywords } = require('../controllers/searchAuditController');
const { getAdTrends } = require('../controllers/trendsController');
const { getKeywordInsight } = require('../controllers/keywordInsightController');
const { getAdvertiserProfile } = require('../controllers/advertiserProfileController');
const { getKeywordsExplorer } = require('../controllers/keywordsExplorerController');
const { getKeywordIdeas } = require('../controllers/keywordIdeasController');
const {
  createKeywordList,
  listKeywordLists,
  renameKeywordList,
  deleteKeywordList,
  addKeywordsToList,
  removeKeywordFromList,
  getKeywordListItems,
} = require('../controllers/keywordListsController');
const { importKeywordsFile } = require('../controllers/keywordImportController');
const { getUrlForBuiltWith, updateBuiltWith } = require('../controllers/built-withController');
const { authMiddleware } = require('../../../middleware/auth');
const { planAccessMiddleware, requireIntelAccess, requireKeywordExplorerEnabled, hasKeywordExplorerAccess } = require('../../../middleware/planAccess');
const config = require('../../../config');
const validator = require('../../../middleware/validator');
const { getDomainRegistration } = require('../controllers/domainRegistrationController');
const createGoogleAdversuiteRoutes = require('./adversuite_Api_routes');
const {
  requireCapability,
  requireConditionalCapability,
  getCapabilityDecision,
} = require('../../planControl/registries/routeClassification');

// Tier-1 competitive intelligence + Keywords Explorer are gated behind the
// Intel entitlement (server-side mirror of the FE's canAccessIntel()) on top
// of plain auth — see requireIntelAccess in middleware/planAccess.js.
const intelGate = [authMiddleware, planAccessMiddleware, requireIntelAccess];
const competitiveCapability = requireCapability('intelligence.competitive', { network: () => 'google' });
const keywordExplorerCapability = requireCapability('intelligence.keyword_explorer', { network: () => 'google' });
const googleNetwork = () => 'google';
const keywordBrowseCapability = requireCapability('intelligence.keyword_explorer.browse', { network: googleNetwork });
const keywordSearchCapability = requireCapability('intelligence.keyword_explorer.search', { network: googleNetwork });
const keywordAnalyticsCapability = requireCapability('intelligence.keyword_explorer.analytics', { network: googleNetwork });
const KEYWORD_FIELD_CAPABILITIES = {
  metrics: 'intelligence.keyword_explorer.metrics',
  keyword: 'intelligence.keyword_explorer.keyword',
  competition: 'intelligence.keyword_explorer.competition',
  ad_volume: 'intelligence.keyword_explorer.ad_volume',
  growth: 'intelligence.keyword_explorer.growth',
  parent_topic: 'intelligence.keyword_explorer.parent_topic',
  first_seen: 'intelligence.keyword_explorer.first_seen',
};
const KEYWORD_ANALYTICS_CAPABILITIES = {
  activity: 'intelligence.keyword_explorer.analytics.activity',
  top_advertisers: 'intelligence.keyword_explorer.analytics.top_advertisers',
  top_domains: 'intelligence.keyword_explorer.analytics.top_domains',
  serp_mix: 'intelligence.keyword_explorer.analytics.serp_mix',
  live_creatives: 'intelligence.keyword_explorer.analytics.live_creatives',
};
const KEYWORD_FILTER_FIELDS = [
  'volume_min', 'volume_max', 'competition_min', 'competition_max',
  'growth_min', 'growth_max', 'category', 'country', 'include', 'exclude',
  'first_seen_after',
];
const keywordFiltersCapability = requireConditionalCapability({
  capabilityId: 'intelligence.keyword_explorer.filters',
  network: googleNetwork,
  when: (req) => KEYWORD_FILTER_FIELDS.some((field) => {
    const value = req.body?.[field] ?? req.query?.[field];
    return value !== undefined && value !== null && value !== '';
  }),
});

async function attachCapabilityAccess(req, definitions) {
  const entries = await Promise.all(Object.entries(definitions).map(async ([key, capabilityId]) => {
    const decision = await getCapabilityDecision(req, capabilityId, { network: googleNetwork });
    return [key, decision ? decision.allowed === true : true];
  }));
  return Object.fromEntries(entries);
}

async function attachKeywordFieldAccess(req, _res, next) {
  try {
    req.keywordFieldAccess = await attachCapabilityAccess(req, KEYWORD_FIELD_CAPABILITIES);
    next();
  } catch (error) {
    next(error);
  }
}

async function attachKeywordAnalyticsAccess(req, _res, next) {
  try {
    req.keywordAnalyticsAccess = await attachCapabilityAccess(req, KEYWORD_ANALYTICS_CAPABILITIES);
    next();
  } catch (error) {
    next(error);
  }
}

function redactKeywordRows(rows, access) {
  return (rows || []).map((row) => {
    const safe = { ...row };
    if (!access.keyword) delete safe.keyword;
    if (!access.competition) delete safe.competition_score;
    if (!access.ad_volume) {
      delete safe.ads_total;
      delete safe.advertisers_total;
      delete safe.domains_total;
    }
    if (!access.growth) delete safe.growth_pct;
    if (!access.parent_topic) {
      delete safe.category;
      delete safe.sub_category;
    }
    if (!access.first_seen) {
      delete safe.first_seen;
      delete safe.last_seen;
    }
    return safe;
  });
}

function redactKeywordExplorerResult(result, access = {}) {
  if (!result?.data) return result;
  if (Array.isArray(result.data.keywords)) result.data.keywords = redactKeywordRows(result.data.keywords, access);
  if (Array.isArray(result.data.matched)) result.data.matched = redactKeywordRows(result.data.matched, access);
  if (!access.metrics) {
    delete result.data.stats;
  } else if (result.data.stats) {
    if (!access.competition) delete result.data.stats.avg_competition;
    if (!access.ad_volume) delete result.data.stats.total_ad_volume;
    if (!access.growth) {
      delete result.data.stats.trending_up;
      delete result.data.stats.trending_down;
    }
  }
  return result;
}

function redactKeywordInsightResult(result, access = {}) {
  if (!result?.data) return result;
  if (!access.activity) delete result.data.trend;
  if (!access.top_advertisers) delete result.data.top_advertisers;
  if (!access.top_domains) delete result.data.top_domains;
  if (!access.serp_mix) delete result.data.position_mix;
  if (!access.live_creatives) delete result.data.creatives;
  result.data.access = access;
  return result;
}
// Keyword-import upload guard: accept ONLY .txt/.csv, cap the size, and turn any
// multer error into a friendly JSON message (never a raw stack/error to the user).
// An unwanted file type is skipped and flagged (req.invalidFileType) so the
// controller can return a clear "only .txt/.csv" message instead of parsing junk.
const ALLOWED_IMPORT_EXT = new Set(['.csv', '.txt']);
const importUpload = multer({
  dest: require('os').tmpdir(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 }, // 20 MB is far more than any keyword list needs
  fileFilter: (req, file, cb) => {
    const ext = require('path').extname(file.originalname || '').toLowerCase();
    if (ALLOWED_IMPORT_EXT.has(ext)) return cb(null, true);
    req.invalidFileType = true; // reject without throwing so we can message cleanly
    return cb(null, false);
  },
}).single('file');
const importUploadMw = (req, res, next) => importUpload(req, res, (err) => {
  if (err) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'The file is too large. Please upload a .txt or .csv file under 20 MB.'
      : "We couldn't read the uploaded file. Please upload a plain .txt or .csv file with one keyword per line.";
    return res.status(400).json({ code: 400, message });
  }
  return next();
});

const keywordUploadMw = multer({ dest: require('os').tmpdir() }).single('file');

const searchSchema = {
  body: {
    page:      { type: 'number' },
    page_size: { type: 'number' },
  },
};

function createGoogleRoutes(service) {
  const router = Router();

  // GET /api/v1/google/keywords/access — per-user access probe (mirrors Market
  // Trends' /access). Registered BEFORE the feature gate below so it always
  // answers (auth only, no allow-list block): returns whether this user should
  // see Keywords Explorer = feature enabled AND user allow-listed. The frontend
  // uses this to show/hide the nav item + page.
  router.get('/keywords/access', authMiddleware, async (req, res) => {
    const enabled = config.keywordExplorer?.enabled === true && (await hasKeywordExplorerAccess(req));
    res.status(200).json({
      code: 200,
      message: 'ok',
      data: {
        enabled,
        reasonCode: req.planControlDecision?.reasonCode || null,
        policyVersion: req.planControlDecision?.policyVersion || null,
      },
    });
  });

  // Keywords Explorer feature flag plus central Plan Control decision. One gate
  // protects the whole group; legacy access is only a no-active-policy fallback.
  // /keywords/* group: feature off → 404, neither mechanism grants access → 403,
  // before any plan work. Mirrors the frontend's env flag + /keywords/access check.
  // Registered after the access probe so that probe stays reachable.
  // `authMiddleware` here is required, not redundant with individual routes' own
  // authMiddleware (e.g. via intelGate below) — this runs FIRST for the whole
  // /keywords/* group, so without it req.user is still undefined at this point,
  // and requireKeywordExplorerEnabled would deny everyone regardless of their
  // actual entitlement (silently masked previously only because the allow-list's
  // old empty-list-means-everyone default didn't care whether req.user existed).
  router.use('/keywords', authMiddleware, requireKeywordExplorerEnabled);

  // POST /api/v1/google/ads/search
  router.post(
    '/ads/search',
    authMiddleware,
    validator(searchSchema),
    asyncHandler(async (req, res) => {
      const result = await searchAds(req, service.db, service.log);
      if (result.code === 200) {
        return ResponseFormatter.success(res, {
          data: result.data,
          meta: { total: result.total },
        });
      }
      return res.status(result.code).json(result);
    })
  );

  // POST /api/v1/google/ads/getTopAds
  router.post(
    '/ads/getTopAds',
    authMiddleware,
    validator(searchSchema),
    asyncHandler(async (req, res) => {
      const result = await getTopAds(req, service.db, service.log);
      if (result.code === 200) {
        return ResponseFormatter.success(res, {
          data: result.data,
          meta: { total: result.total },
        });
      }
      return res.status(result.code).json(result);
    })
  );

  // GET /api/v1/google/ads/count
  router.get(
    '/ads/count',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdsCount(req, service.db, service.log);
      if (result.code === 200) {
        return ResponseFormatter.success(res, { data: result.data });
      }
      return res.status(result.code).json(result);
    })
  );

  // POST /api/v1/google/ads/detail
  router.post(
    '/ads/detail',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdDetails(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/ads/getAdDetails
  router.post(
    '/ads/getAdDetails',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdDetails(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/ads/getLikeCommentShareDetails
  router.post(
    '/ads/getLikeCommentShareDetails',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getLikeCommentShareDetails(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/ads/getGoogleAdCountry
  router.post(
    '/ads/getGoogleAdCountry',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getGoogleAdCountry(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/ads/getGoogleOutgoings
  router.post(
    '/ads/getGoogleOutgoings',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getGoogleOutgoings(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/ads/getAdvertiserCountryData
  router.post(
    '/ads/getAdvertiserCountryData',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserCountryData(req, service.db, service.log);
      if (!result) return res.status(400).json({ code: 400, message: 'No data found.', data: null });
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/ads/getAdvertiserInsightsByDateRange
  router.post(
    '/ads/getAdvertiserInsightsByDateRange',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserInsightsByDateRange(req, service.db, service.log);
      if (!result) return res.status(400).json({ code: 400, message: 'No data found.', data: null });
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/ads/hide_ads
  router.post(
    '/ads/hide_ads',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await hideAds(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/ads/getHiddenPostOwners
  router.post(
    '/ads/getHiddenPostOwners',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getHiddenPostOwners(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/ads/un-hide
  router.post(
    '/ads/un-hide',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await unHide(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Tier-1 competitive-intelligence aggregations (SpyFu-style) ─────────────
  // All three reuse GoogleSearchQueryBuilder, so they accept the same filter
  // payload as /ads/search and return aggregations instead of hits.

  // POST /api/v1/google/ads/trends — time-series of ad/advertiser activity
  router.post(
    '/ads/trends',
    ...intelGate,
    competitiveCapability,
    asyncHandler(async (req, res) => {
      const result = await getAdTrends(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/keywords/insight — Keyword Explorer competitive board
  router.post(
    '/keywords/insight',
    keywordAnalyticsCapability,
    attachKeywordAnalyticsAccess,
    asyncHandler(async (req, res) => {
      const result = redactKeywordInsightResult(
        await getKeywordInsight(req, service.db, service.log),
        req.keywordAnalyticsAccess
      );
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/advertiser/profile — full advertiser competitive profile
  router.post(
    '/advertiser/profile',
    ...intelGate,
    requireKeywordExplorerEnabled,
    keywordExplorerCapability,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserProfile(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Keywords Explorer (Ahrefs/SEMrush-style browsable keyword database) ────
  // Backed by the `keyword_stats` rollup table (SQL), refreshed by the
  // refreshKeywordStats cron — not live ES aggregation, since browsing/sorting
  // thousands of rows isn't viable as a per-request ES query over 200M+ docs.

  // POST /api/v1/google/keywords/explorer — paginated/filterable/sortable keyword table
  router.post(
    '/keywords/explorer',
    keywordBrowseCapability,
    keywordFiltersCapability,
    attachKeywordFieldAccess,
    asyncHandler(async (req, res) => {
      const result = redactKeywordExplorerResult(
        await getKeywordsExplorer(req, service.db, service.log),
        req.keywordFieldAccess
      );
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/keywords/ideas — related/matching terms for seed keyword(s)
  router.post(
    '/keywords/ideas',
    keywordSearchCapability,
    asyncHandler(async (req, res) => {
      const result = await getKeywordIdeas(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // Keyword Lists — user-curated named lists of keywords.
  router.post(
    '/keywords/lists',
    asyncHandler(async (req, res) => {
      const result = await createKeywordList(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST (not GET) for consistency with the rest of this API's postGoogleIntel
  // convention on the FE — every Tier-1/Explorer call is a POST, reads included.
  router.post(
    '/keywords/lists/get',
    asyncHandler(async (req, res) => {
      const result = await listKeywordLists(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  router.post(
    '/keywords/lists/:id/rename',
    asyncHandler(async (req, res) => {
      const result = await renameKeywordList(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  router.post(
    '/keywords/lists/:id/delete',
    asyncHandler(async (req, res) => {
      const result = await deleteKeywordList(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  router.post(
    '/keywords/lists/:id/items/get',
    asyncHandler(async (req, res) => {
      const result = await getKeywordListItems(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  router.post(
    '/keywords/lists/:id/items',
    asyncHandler(async (req, res) => {
      const result = await addKeywordsToList(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  router.post(
    '/keywords/lists/:id/items/remove',
    asyncHandler(async (req, res) => {
      const result = await removeKeywordFromList(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/keywords/import — CSV/TXT upload of seed keywords
  router.post(
    '/keywords/import',
    keywordSearchCapability,
    attachKeywordFieldAccess,
    importUploadMw,
    asyncHandler(async (req, res) => {
      const result = redactKeywordExplorerResult(
        await importKeywordsFile(req, service.db, service.log),
        req.keywordFieldAccess
      );
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Search-Audit Keywords (gtext → MongoDB google_audit_keywords) ──────────
  // GET  /api/v1/google/get-search-audit-keywords    — crawler pull (cursored batch)
  // POST /api/v1/google/insert-search-audit-keywords — bulk insert (CSV file or JSON)
  // Public (gtext routes had no auth); dedupe + 100k cap handled in the service.
  router.get(
    '/get-search-audit-keywords',
    asyncHandler(async (req, res) => {
      const result = await searchAuditKeywords(req, service.db, service.log);
      // HTTP 200 always; the app-level status lives in body.code (legacy contract).
      return res.status(200).json(result);
    })
  );

  router.post(
    '/insert-search-audit-keywords',
    keywordUploadMw,
    asyncHandler(async (req, res) => {
      const result = await insertSearchAuditKeywords(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Domain registration lookup (gtext) ───────────────
  // GET /api/v1/google/get-domain-registration?domain=<domain> → UserController@getDomainRegistration
  // Public (no auth in PHP). `code` is mapped to the real HTTP status (200/404/400/401).
  router.get(
    '/get-domain-registration',
    asyncHandler(async (req, res) => {
      const result = await getDomainRegistration(req, service.db, service.log);
      return res.status(result.code).json(result);
    })
  );

  // ─── Adversuite API Routes (getLocation) ──────────────
  const adversuiteRouter = createGoogleAdversuiteRoutes(service);
  router.use('/adversuite', adversuiteRouter);

  // ─── Built-with scrape queue (worker endpoints) ──────
  //   GET  /api/v1/google/built-with/getUrlForBuiltWith
  //   POST /api/v1/google/built-with/updateBuiltWith
  router.get(
    '/built-with/getUrlForBuiltWith',
    asyncHandler(async (req, res) => {
      const result = await getUrlForBuiltWith(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );
  router.post(
    '/built-with/updateBuiltWith',
    asyncHandler(async (req, res) => {
      const result = await updateBuiltWith(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  return router;
}

module.exports = { createGoogleRoutes };
