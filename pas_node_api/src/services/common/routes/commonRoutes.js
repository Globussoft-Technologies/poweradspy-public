'use strict';
 
const { Router } = require('express');
const axios = require('axios');
const dns = require('dns').promises;
const net = require('net');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { searchAllNetworks, getAdsByAdvertiserAll } = require('../controllers/commonSearchController');
const { getAdvertiserAds } = require('../controllers/advertiserAdsController');
const { getAdInsightData } = require('../controllers/adInsightDataController');
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
const { getAdCountry } = require('../controllers/adCountryController');
const { createShareLink, getSharedAd } = require('../controllers/shareAdController');
const { syncCategory, syncAllCategories } = require('../controllers/categoryController');
const { getDescriptionDetails, newCatInsertion, getAdCategory, insertAiMeta } = require('../controllers/addCategoryController');
const { createDashboardShare, getDashboardShare, guestSearch, publicSearch } = require('../controllers/dashboardShareController');
const { dailyKeywordRequest, getPriorityRequests } = require('../controllers/dailyKeywordRequestController');
const { storeKeywordSearch, scraperWork, insertSyntheticKeywords } = require('../controllers/keywordSearchController');
const { unscoredCreatives, storeCreativeScore, storeRunReport, getRunReports } = require('../controllers/creativeScoreController');
const { getUserKeywordAdNotifications, markKeywordAdNotificationRead } = require('../controllers/keywordAdNotificationController');
const { getNotifications, markNotificationsRead } = require('../controllers/notificationController');
const { 
  registerToken,
  sendPushNotification,
  getPendingNotifications: getPushNotifications,
  getAllNotifications,
  markNotificationAsRead: markPushAsRead,
  resetDailyKeywordStatus
} = require('../controllers/pushNotificationController');
const { getOnboardingStatus, saveOnboarding, getOnboardingPreview, getAdvertiserSuggestions, getCompetitorSuggestions } = require('../controllers/onboardingController');
const { sendMailDailyUpdate } = require('../controllers/dailyMailUpdateController');
const { getTotalAdCount } = require('../controllers/totalAdCountController');
const { getRecentAds } = require('../controllers/recentAdsController');
const { storeBehaviourData, insertInterestBehaviour, updateInterestBehaviour } = require('../controllers/interestBehaviourController');
const { getAdDetailsData, getInstagramAdDetailsData } = require('../controllers/adDetailsDataController');
const { patchAdMedia } = require('../controllers/updateAdMediaController');
const { domainsWithoutRegistration } = require('../controllers/domainsWithoutRegistrationController');
const { putDomainDate } = require('../controllers/updateDomainDateController');
const { getDomainRegistration: getDomainRegistrationUnified } = require('../controllers/domainRegistrationLookupController');
const { authunticatePhpApi } = require('../controllers/phpAuthController');
const { authMiddleware } = require('../../../middleware/auth');
const { freePlanCheck } = require('../../../middleware/freePlanCheck');
const { planAccessMiddleware } = require('../../../middleware/planAccess');
const validator = require('../../../middleware/validator');
const path = require('path');
const os = require('os');
const fs = require('fs');
const multer = require('multer');
const config = require('../../../config');

const searchSchema = {
  body: {
    page:      { type: 'number' },
    page_size: { type: 'number' },
  },
};

// CSV upload for the synthetic keyword bulk-insert → temp file on disk, streamed + parsed,
// then unlinked by the controller. Size capped at config.keywordSearch.syntheticMaxUploadMb.
const SYNTHETIC_KW_TMP = path.join(os.tmpdir(), 'pas-synthetic-keywords');
function ensureSyntheticKwTmp() { try { fs.mkdirSync(SYNTHETIC_KW_TMP, { recursive: true }); } catch { /* ignore */ } }
ensureSyntheticKwTmp();
const syntheticKwUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { ensureSyntheticKwTmp(); cb(null, SYNTHETIC_KW_TMP); },
    filename: (_req, file, cb) => cb(null, `kw_${Date.now()}_${Math.round(process.hrtime()[1])}${path.extname(file.originalname || '') || '.csv'}`),
  }),
  limits: { fileSize: (config.keywordSearch.syntheticMaxUploadMb || 50) * 1024 * 1024 },
}).single('file');
// Run multer but turn its errors (e.g. file too large) into a clean 4xx instead of a throw.
// For non-multipart (JSON) requests multer is a no-op pass-through.
function syntheticKwUploadMw(req, res, next) {
  syntheticKwUpload(req, res, (err) => {
    if (!err) return next();
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooBig ? 413 : 400).json({
      code: tooBig ? 413 : 400,
      message: tooBig ? `CSV exceeds the ${config.keywordSearch.syntheticMaxUploadMb || 50} MB limit.` : `Upload error: ${err.message}`,
    });
  });
}

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

// POST /api/v1/common/ads/getAdvertiserAds?network=<net>
// For a given advertiser/competitor (post_owner_id, alias competitor_id), returns
// every ad with its first_seen date: { data: [{ ad_id, first_seen }] }. Network
// param selects the per-network SQL ad table (TikTok reads from ES).
router.post(
  '/ads/getAdvertiserAds',
  authMiddleware,
  planAccessMiddleware,
  asyncHandler(getAdvertiserAds)
);

// POST /api/v1/common/ads/getAdInsightData?network=<net>
// Curated single-ad insight (one flat JSON object) for one ad, only if it has
// both call_to_action and destination_url. Not the SSE getAdInsights — this is a
// filtered, competitor-analysis field set incl. URL + landing-page info.
router.post(
  '/ads/getAdInsightData',
  authMiddleware,
  planAccessMiddleware,
  asyncHandler(getAdInsightData)
);

// GET/POST /api/v1/common/ads/ad-country?network=<net>&<net>_ad_id=<id>
// Lightweight ad-level country lookup — the single `country` fetcher the
// getAdInsights SSE stream runs, without the other ~8 insights. Used by the Ad
// Details popup to show the first country + "N more". Returns { code, data:[{country,iso}] }.
router.post(
  '/ads/ad-country',
  authMiddleware,
  planAccessMiddleware,
  asyncHandler(getAdCountry)
);
router.get(
  '/ads/ad-country',
  authMiddleware,
  planAccessMiddleware,
  asyncHandler(getAdCountry)
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

// API 3 — POST /api/v1/common/keyword-search/synthetic — bulk-insert synthetic keywords
// (manually inserted) via a CSV file (field "file") OR JSON. Stored in the same collection
// + doc shape, deduped (case-insensitive) by (type,valueNorm); marked by users=null +
// userInfos=null. NO JWT (internal bulk-load, like keyword-search/work). Additive — does
// not touch the store/work flow.
router.post(
  '/keyword-search/synthetic',
  syntheticKwUploadMw,
  asyncHandler(insertSyntheticKeywords)
);

// ─── AI creative scoring — internal/scorer endpoints (NO JWT, like keyword-search/work) ───
// The scorer is the Claude Code harness (hourly cron, Sonnet). GET pulls un-scored ads
// with creative image URLs; POST writes the produced scores onto the ad's ES doc.
// GET  /api/v1/common/creative-score/unscored?network=<net>&limit=N
router.get('/creative-score/unscored', asyncHandler(unscoredCreatives));
// POST /api/v1/common/creative-score/store  { network, ad_id, es_doc_id?, scores:{...} }
router.post('/creative-score/store', asyncHandler(storeCreativeScore));
// Cron run reports (admin monitoring): POST a per-run report; GET recent runs + all-time summary
router.post('/creative-score/run-report', asyncHandler(storeRunReport));
router.get('/creative-score/run-report', asyncHandler(getRunReports));

// ─── NAS storage (internal — server-to-server; also a fallback for the react_admin NAS page) ───
// Reuses the same `df` + on-disk history + per-network du as every other NAS surface, via the one
// shared builder. NO JWT (internal, like creative-score + keyword-work). GET /nas-storage?days=30
const { buildNasReport } = require('../../../insertion/helpers/nasStorageReport');
router.get('/nas-storage', asyncHandler(async (req, res) => {
  const data = await buildNasReport({ days: req.query.days, refresh: req.query.refresh === '1' });
  res.json({ code: 200, data });
}));
// ─── Keyword ad-count notifications (frontend bell) — 2 APIs, additive. ───
// See KEYWORD_AD_NOTIFICATION_MANIFEST.md.
// Primary — GET — poll for the caller's keyword→ad-count notifications. Each call runs
// a per-user scan (terms the caller searched, scraped today) then returns pending docs.
// Poll cadence is env-tunable (KEYWORD_SEARCH_NOTIFY_POLL_SEC) and echoed in meta.
router.get(
  '/keyword-ad-notifications',
  authMiddleware,
  asyncHandler(getUserKeywordAdNotifications)
);

// Mark read — POST { id } | { ids: [...] } — delete the caller's own notification doc(s).
router.post(
  '/keyword-ad-notifications/read',
  authMiddleware,
  asyncHandler(markKeywordAdNotificationRead)
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

// GET /api/v1/common/getAdCategory?platform=facebook&ad_id=13011
// Single-ad read-back — returns the ad's currently-stored category/sub_category so the
// classifier can verify a newCatInsertion write attached. No auth — internal only.
router.get(
  '/getAdCategory',
  asyncHandler(getAdCategory)
);

// POST /api/v1/common/ai-meta
// Dedicated AI-Meta enrichment write path (AI_META_API_PAYLOAD_SPEC.md, Option B).
// Validates the ai_meta payload and writes it onto the runtime AI-Meta ES field
// (`ai` normally, `ai_meta` only for production facebook). Decoupled from category
// classification. No auth — internal only.
router.post(
  '/ai-meta',
  asyncHandler(insertAiMeta)
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

// GET /api/v1/common/recent-ads
// Returns the most recently-seen ads across ALL networks (facebook, instagram,
// google, gdn, youtube, pinterest, …) in one fan-out call. "Recent" = ads whose
// last_seen is within the last `days` days (default 1). Pass `days` to widen the
// window (e.g. days=2, days=3), `network` to restrict platforms, and `limit` to
// cap ads per network. Sorted newest-first across networks.
router.get('/recent-ads', authMiddleware, asyncHandler(getRecentAds));

// ─── Interest / Behaviour (audience targeting) — Node port of the Laravel
// adsDataController/InstagramUserController endpoints. Populate the
// interests/behaviors/confidence_score fields on ads in each network's
// search_mix index. `network` param selects facebook|instagram. Internal/cron
// — no auth, mirroring the PHP routes.
//
// POST /api/v1/common/store-bahaviour-data — push targeting data for ONE ad (write-once)
router.post('/store-bahaviour-data', asyncHandler(storeBehaviourData));

// GET /api/v1/common/insert-interest-behaviour?network=facebook — batch puller (cron)
router.get('/insert-interest-behaviour', asyncHandler(insertInterestBehaviour));

// GET /api/v1/common/update-interest-behaviour?network=facebook — refresh + cleanup (cron)
router.get('/update-interest-behaviour', asyncHandler(updateInterestBehaviour));

// GET /api/v1/common/get-ad-details/:adId
// Node port of Userv2Controller@getAdDetailsData. Returns a trimmed ad card
// (title/text/newsfeed_description/image_url/category/subcategory) from the
// facebook `search_mix` ES index. No auth (PHP route carried only `cors`).
// Always HTTP 200; the real status is in the body `code` (matches Laravel).
router.get('/get-ad-details/:adId', asyncHandler(getAdDetailsData));

// GET /api/v1/common/get-instagram-ad-details/:adId
// Node port of the Instagram app's AdDetails@getAdDetailsData. Same as the
// facebook card above but reads the `instagram_search_mix` ES index by
// `instagram_ad.id`. No auth. Always HTTP 200; real status in the body `code`.
router.get('/get-instagram-ad-details/:adId', asyncHandler(getInstagramAdDetailsData));

// GET /api/v1/common/authunticate-php-api
// Node port of adsDataController@authunticatePhpApi. Verifies the Bearer JWT in
// the Authorization header (HS512, shared secret). No auth middleware — the
// endpoint validates the token itself. Always HTTP 200; status is in body `code`.
router.get('/authunticate-php-api', asyncHandler(authunticatePhpApi));

// PATCH /api/v1/common/ads/media
// Cross-network media repair: update image, thumbnail, video and/or
// other_multimedia in both SQL and Elasticsearch for any supported network.
router.patch('/ads/media', authMiddleware, asyncHandler(patchAdMedia));

// GET /api/v1/common/get-domains-without-registration-date?network=<net>&limit=<1..50>
// Returns a network's domains with NO WHOIS registration date
// (domain_registered_date IS NULL), ordered newest-updated first. Ops/backfill
// helper; companion to the per-network get-domain-registration lookup.
router.get('/get-domains-without-registration-date', asyncHandler(domainsWithoutRegistration));

// PUT /api/v1/common/insert-update-domain-date  { domain_name, domain_date: 'YYYY-MM-DD' }
// Updates a domain's WHOIS registration date across ALL networks' domains tables and bumps
// `updated_date` where present (not on facebook/linkedin). Update-only; never inserts. Node
// port of the PHP SupportScrapper@putDomainDate, fanned out to every network.
router.put('/insert-update-domain-date', asyncHandler(putDomainDate));

// GET /api/v1/common/get-domain-registration?domain=<domain>&network=<net|csv|all>
// Unified cross-network domain registration-date lookup. Consolidates the four per-network
// /api/v1/{instagram,google,youtube,facebook}/get-domain-registration endpoints and covers
// all 10 networks. No `network` (or 'all') searches every network; returns every network the
// domain was found in, each with its own domain_registered_date.
router.get('/get-domain-registration', asyncHandler(getDomainRegistrationUnified));

// ─── First-login onboarding (category / competitors / countries) — additive.
// Storage: am_user_action (same table/key as fcm_token, pinterest_launch_status
// above). See onboardingController.js and ONBOARDING_FEATURE_IMPLEMENTATION_PLAN.md.
// Category search itself reuses the existing /catsearch proxy above — no new endpoint for it.
router.get('/onboarding/status', authMiddleware, asyncHandler(getOnboardingStatus));
router.post('/onboarding', authMiddleware, asyncHandler(saveOnboarding));
router.post('/onboarding/preview-results', authMiddleware, asyncHandler(getOnboardingPreview));
router.get('/onboarding/advertiser-suggest', authMiddleware, asyncHandler(getAdvertiserSuggestions));
router.get('/onboarding/competitor-suggest', authMiddleware, asyncHandler(getCompetitorSuggestions));

module.exports = router;
