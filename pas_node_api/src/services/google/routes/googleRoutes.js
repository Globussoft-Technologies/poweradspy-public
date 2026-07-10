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
const { authMiddleware } = require('../../../middleware/auth');
const { planAccessMiddleware, requireIntelAccess, requireKeywordExplorerEnabled } = require('../../../middleware/planAccess');
const validator = require('../../../middleware/validator');
const { getDomainRegistration } = require('../controllers/domainRegistrationController');
const createGoogleAdversuiteRoutes = require('./adversuite_Api_routes');

// Tier-1 competitive intelligence + Keywords Explorer are gated behind the
// Intel entitlement (server-side mirror of the FE's canAccessIntel()) on top
// of plain auth — see requireIntelAccess in middleware/planAccess.js.
const intelGate = [authMiddleware, planAccessMiddleware, requireIntelAccess];
const importUploadMw = multer({ dest: require('os').tmpdir() }).single('file');

const searchSchema = {
  body: {
    page:      { type: 'number' },
    page_size: { type: 'number' },
  },
};

function createGoogleRoutes(service) {
  const router = Router();

  // Keywords Explorer feature flag (KEYWORD_EXPLORER_ENABLED / config.json
  // keywordExplorer.enabled). Single gate for the whole /keywords/* group:
  // when the feature is off every keyword route 404s before any auth/plan work,
  // mirroring the frontend's VITE_ENABLE_KEYWORD_EXPLORER visibility toggle.
  // Registered before the route handlers so it runs first in the chain.
  router.use('/keywords', requireKeywordExplorerEnabled);

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
    asyncHandler(async (req, res) => {
      const result = await getAdTrends(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/keywords/insight — Keyword Explorer competitive board
  router.post(
    '/keywords/insight',
    ...intelGate,
    asyncHandler(async (req, res) => {
      const result = await getKeywordInsight(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/advertiser/profile — full advertiser competitive profile
  router.post(
    '/advertiser/profile',
    ...intelGate,
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
    ...intelGate,
    asyncHandler(async (req, res) => {
      const result = await getKeywordsExplorer(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/keywords/ideas — related/matching terms for seed keyword(s)
  router.post(
    '/keywords/ideas',
    ...intelGate,
    asyncHandler(async (req, res) => {
      const result = await getKeywordIdeas(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // Keyword Lists — user-curated named lists of keywords.
  router.post(
    '/keywords/lists',
    ...intelGate,
    asyncHandler(async (req, res) => {
      const result = await createKeywordList(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST (not GET) for consistency with the rest of this API's postGoogleIntel
  // convention on the FE — every Tier-1/Explorer call is a POST, reads included.
  router.post(
    '/keywords/lists/get',
    ...intelGate,
    asyncHandler(async (req, res) => {
      const result = await listKeywordLists(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  router.post(
    '/keywords/lists/:id/rename',
    ...intelGate,
    asyncHandler(async (req, res) => {
      const result = await renameKeywordList(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  router.post(
    '/keywords/lists/:id/delete',
    ...intelGate,
    asyncHandler(async (req, res) => {
      const result = await deleteKeywordList(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  router.post(
    '/keywords/lists/:id/items/get',
    ...intelGate,
    asyncHandler(async (req, res) => {
      const result = await getKeywordListItems(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  router.post(
    '/keywords/lists/:id/items',
    ...intelGate,
    asyncHandler(async (req, res) => {
      const result = await addKeywordsToList(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  router.post(
    '/keywords/lists/:id/items/remove',
    ...intelGate,
    asyncHandler(async (req, res) => {
      const result = await removeKeywordFromList(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/keywords/import — CSV/TXT upload of seed keywords
  router.post(
    '/keywords/import',
    ...intelGate,
    importUploadMw,
    asyncHandler(async (req, res) => {
      const result = await importKeywordsFile(req, service.db, service.log);
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

  return router;
}

module.exports = { createGoogleRoutes };
