'use strict';

const { Router } = require('express');
const axios = require('axios');
const dns = require('dns').promises;
const net = require('net');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { searchAllNetworks, getAdsByAdvertiserAll } = require('../controllers/commonSearchController');
const { getAdInsights: fbAdInsights } = require('../controllers/commonInsightsController');
const { getAdInsights: igAdInsights } = require('../controllers/instaCommonInsightsController');
const { getAdInsights: pinAdInsights } = require('../controllers/pinterestCommonInsightsController');
const { getAdInsights: ytAdInsights } = require('../controllers/youtubeCommonInsightsController');
const { getAdInsights: gdnAdInsights } = require('../controllers/gdnCommonInsightsController');
const { getAdInsights: googAdInsights } = require('../controllers/googleCommonInsightsController');
const { getAdInsights: natAdInsights } = require('../controllers/nativeCommonInsightsController');
const { getAdInsights: liAdInsights } = require('../controllers/linkedinCommonInsightsController');
const { getAdInsights: redAdInsights } = require('../controllers/redditCommonInsightsController');
const { getAdInsights: qrAdInsights } = require('../controllers/quoraCommonInsightsController');
const { getAdInsights: ttAdInsights } = require('../controllers/tiktokCommonInsightsController');
const { createShareLink, getSharedAd } = require('../controllers/shareAdController');
const { syncCategory, syncAllCategories } = require('../controllers/categoryController');
const { getDescriptionDetails, newCatInsertion } = require('../controllers/addCategoryController');
const { createDashboardShare, getDashboardShare, guestSearch, publicSearch } = require('../controllers/dashboardShareController');
const { dailyKeywordRequest, getPriorityRequests } = require('../controllers/dailyKeywordRequestController');
const { storeKeywordSearch, scraperWork } = require('../controllers/keywordSearchController');
const { getNotifications, markNotificationsRead } = require('../controllers/notificationController');
const {
  registerToken,
  sendPushNotification,
  getPendingNotifications: getPushNotifications,
  getAllNotifications,
  markNotificationAsRead: markPushAsRead,
  resetDailyKeywordStatus
} = require('../controllers/pushNotificationController');
const { sendMailDailyUpdate } = require('../controllers/dailyMailUpdateController');
const { getTotalAdCount } = require('../controllers/totalAdCountController');
const { authMiddleware } = require('../../../middleware/auth');
const { freePlanCheck } = require('../../../middleware/freePlanCheck');
const { planAccessMiddleware } = require('../../../middleware/planAccess');
const validator = require('../../../middleware/validator');

const searchSchema = {
  body: {
    page:      { type: 'number' },
    page_size: { type: 'number' },
  },
};

const router = Router();

// POST /api/common/ads/search
router.post(
  '/ads/search',
  authMiddleware,
  planAccessMiddleware,
  validator(searchSchema),
  asyncHandler(searchAllNetworks)
);

// POST /api/v1/common/catsearch — proxy to DS team's AI category search
// Frontend calls this so network tab shows "catsearch" not "search"
router.post(
  '/catsearch',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const DS_CAT_SEARCH_URL = process.env.AI_CATEGORY || 'https://ai-cat-search.poweradspy.ai/search';
    try {
      const response = await fetch(DS_CAT_SEARCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(req.body),
      });
      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (err) {
      return res.status(502).json({ code: 502, message: 'Category search service unavailable', error: err.message });
    }
  })
);

// POST /api/common/ads/getAdsByAdvertiser?network=facebook|instagram
router.post(
  '/ads/getAdsByAdvertiser',
  authMiddleware,
  planAccessMiddleware,
  asyncHandler(getAdsByAdvertiserAll)
);

// Network → handler map
const insightHandlers = {
  facebook:  fbAdInsights,
  instagram: igAdInsights,
  pinterest: pinAdInsights,
  youtube:   ytAdInsights,
  gdn:       gdnAdInsights,
  google:    googAdInsights,
  native:    natAdInsights,
  linkedin:  liAdInsights,
  reddit:    redAdInsights,
  quora:     qrAdInsights,
  tiktok:    ttAdInsights,
};

const availableNetworks = Object.keys(insightHandlers).join(', ');

// POST /api/common/ads/getAdInsights?network=facebook|instagram|pinterest|...
// Network param decides which controller handles it.
router.post(
  '/ads/getAdInsights',
  authMiddleware,
  planAccessMiddleware,
  asyncHandler(async (req, res) => {
    const network = (req.body.network || req.query.network || 'facebook').toLowerCase().trim();

    const handler = insightHandlers[network];
    if (handler) {
      return handler(req, res);
    }

    return res.status(400).json({ code: 400, message: `Unsupported network: ${network}. Available: ${availableNetworks}` });
  })
);

// POST /api/v1/common/dashboard/share — Create a shareable dashboard snapshot (auth required)
router.post(
  '/dashboard/share',
  authMiddleware,
  asyncHandler(createDashboardShare)
);

// GET /api/v1/common/dashboard/share/:token — Get stored dashboard state (public)
router.get(
  '/dashboard/share/:token',
  asyncHandler(getDashboardShare)
);

// POST /api/v1/common/dashboard/guest-search — Search with stored filters (public, 35 limit)
router.post(
  '/dashboard/guest-search',
  asyncHandler(guestSearch)
);

// POST /api/v1/common/dashboard/public-search — No token required, default ads for guest landing page
router.post(
  '/dashboard/public-search',
  asyncHandler(publicSearch)
);

// POST /api/v1/common/ads/share — Create a shareable ad link (auth required)
router.post(
  '/ads/share',
  authMiddleware,
  asyncHandler(createShareLink)
);

// GET /api/v1/common/ads/share/:token — Fetch shared ad (public, no auth)
router.get(
  '/ads/share/:token',
  asyncHandler(getSharedAd)
);

// POST /api/v1/common/daily-keyword-request — Save keyword for batch scraping (Facebook only, plan-gated server-side)
router.post(
  '/daily-keyword-request',
  authMiddleware,
  asyncHandler(dailyKeywordRequest)
);

// GET /api/v1/common/get-priority-requests/:platform/:limit
// Fetches priority records (status=9) and marks them status=1 + notify_status=1
router.get(
  '/get-priority-requests/:platform/:limit',
  asyncHandler(getPriorityRequests)
);

// ─── NEW keyword-search store (MongoDB) — 2 APIs, additive. See KEYWORD_SEARCH_REVAMP_MANIFEST.md ───
// API 1 — POST /api/v1/common/keyword-search — frontend stores a search (dedup upsert)
router.post(
  '/keyword-search',
  authMiddleware,
  asyncHandler(storeKeywordSearch)
);

// API 2 — POST /api/v1/common/keyword-search/work — the SINGLE scraper endpoint.
// One call submits finished results AND claims the next batch. Scraper identifies
// itself via the configured header (x-scraper-name). priority is a body flag.
router.post(
  '/keyword-search/work',
  asyncHandler(scraperWork)
);

// GET /api/v1/common/notifications — Fetch scraping notifications for current user
router.get(
  '/notifications',
  authMiddleware,
  asyncHandler(getNotifications)
);

// POST /api/v1/common/notifications/read — Mark notifications as read
router.post(
  '/notifications/read',
  authMiddleware,
  asyncHandler(markNotificationsRead)
);

// POST /api/v1/internal/category/sync
// Internal endpoint — called by GDN existQuery (fire-and-forget) after any
// write to the master `category` ES index. Upserts the category into MongoDB
// sdui_config so SDUI filter dropdowns stay in sync. No auth — internal only.
router.post(
  '/internal/category/sync',
  asyncHandler(syncCategory)
);

// POST /api/v1/common/internal/category/sync-all
// One-shot backfill: re-syncs ALL categories from ES to MongoDB with platform_applicability set.
router.post(
  '/internal/category/sync-all',
  asyncHandler(syncAllCategories)
);

// GET /api/v1/common/getDescriptionDetails?platform=facebook&exVal=0&limit=150
// Unified replacement for the per-platform Laravel getDescriptionDetails endpoints.
// Returns ad text/title/image data used for AI category mapping. No auth — internal only.
router.get(
  '/getDescriptionDetails',
  asyncHandler(getDescriptionDetails)
);

// POST /api/v1/common/newCatInsertion
// Unified replacement for the Laravel AdMetaDataController@newCatInsertion.
// Inserts/updates category in ES, updates the ad record, and syncs to MongoDB. No auth — internal only.
router.post(
  '/newCatInsertion',
  asyncHandler(newCatInsertion)
);

// GET /api/v1/common/image-proxy?url=...
// Stream a remote image with CORS headers so the frontend can rasterize it into
// a canvas / embed it in a PDF without CORS-tainting issues. SSRF-guarded.
const isPrivateIp = (ip) => {
  if (!net.isIP(ip)) return false;
  if (ip === '::1' || ip.startsWith('127.') || ip.startsWith('169.254.')) return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  const parts = ip.split('.').map(Number);
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
};
router.get(
  '/image-proxy',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const url = typeof req.query.url === 'string' ? req.query.url : '';
    if (!url) return res.status(400).json({ code: 400, message: 'url query param required' });
    let parsed;
    try { parsed = new URL(url); }
    catch { return res.status(400).json({ code: 400, message: 'Invalid URL' }); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return res.status(400).json({ code: 400, message: 'Only http/https URLs allowed' });
    }
    try {
      const { address } = await dns.lookup(parsed.hostname);
      if (isPrivateIp(address)) return res.status(400).json({ code: 400, message: 'Private addresses not allowed' });
    } catch {
      return res.status(400).json({ code: 400, message: 'DNS resolution failed' });
    }
    try {
      const upstream = await axios.get(url, {
        responseType: 'stream',
        timeout: 10000,
        maxContentLength: 10 * 1024 * 1024,
        validateStatus: (s) => s < 500,
      });
      const contentType = upstream.headers['content-type'] || '';
      if (!contentType.startsWith('image/')) {
        upstream.data?.destroy?.();
        return res.status(415).json({ code: 415, message: 'Resource is not an image' });
      }
      res.setHeader('Content-Type', contentType);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      upstream.data.pipe(res);
    } catch (err) {
      return res.status(502).json({ code: 502, message: 'Image fetch failed', error: err.message });
    }
  })
);

// Push Notification Routes (Exactly like Laravel)
// POST /api/v1/common/register-push-token — Register browser FCM token
router.post('/register-push-token', authMiddleware, asyncHandler(registerToken));

// POST /api/v1/common/send-push-notification/{action} — Send pending notifications (cron job)
router.post('/send-push-notification/:action', asyncHandler(sendPushNotification));

// GET /api/v1/common/push-notifications/pending — Get pending notifications for UI
router.get('/push-notifications/pending', authMiddleware, asyncHandler(getPushNotifications));

// POST /api/v1/common/push-notifications/all — Get all notifications (paginated)
router.post('/push-notifications/all', authMiddleware, asyncHandler(getAllNotifications));

// POST /api/v1/common/push-notifications/read — Mark notification as read
router.post('/push-notifications/read', authMiddleware, asyncHandler(markPushAsRead));

// POST /api/v1/common/send-mail-dailyup — Send daily email digest (cron job)
router.post('/send-mail-dailyup', asyncHandler(sendMailDailyUpdate));

// POST /api/v1/common/reset-daily-keyword-status — Daily reset (cron job / manual test)
router.post('/reset-daily-keyword-status', asyncHandler(resetDailyKeywordStatus));

// GET/POST /api/v1/common/total-ad-count
// Returns the total ad count for a given network from Elasticsearch.
// Internal — consumed by both the admin panel dashboard header and DS daily
// reports so both numbers stay in sync. No auth (internal network only).
router.get('/total-ad-count',  asyncHandler(getTotalAdCount));
router.post('/total-ad-count', asyncHandler(getTotalAdCount));

module.exports = router;
