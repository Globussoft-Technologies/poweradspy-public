'use strict';

/**
 * AI Recreate + MySpace routes. Auto-mounted by ServiceRegistry under /api/v1/imageGen
 * (dynamic discovery — src/services/imageGen/routes/ exists, same mechanism chatgptads
 * uses, no extra registration needed).
 *
 *   POST   /api/v1/imageGen/upload            → uploadController@uploadProductImage (3a/3b — product image)
 *   DELETE /api/v1/imageGen/upload            → uploadController@deleteUpload (queues NAS cleanup for an unused upload)
 *   POST   /api/v1/imageGen/recreate/enhance  → enhanceController@enhance (3a/3b — "Enhance" prompt rewrite)
 *   POST   /api/v1/imageGen/recreate   → recreateController@recreate
 *   GET    /api/v1/imageGen/jobs/:id   → jobsController@getJobStatus      (poll — 3c/3d/3e)
 *   GET    /api/v1/imageGen/jobs       → jobsController@listMySpace       (MySpace — 5/7)
 *   DELETE /api/v1/imageGen/jobs/:id   → jobsController@deleteMySpaceJob  (MySpace delete)
 *   GET    /api/v1/imageGen/jobs/:id/download?format=png|jpeg|webp|svg → downloadController@downloadImage
 *   GET    /api/v1/imageGen/credits    → creditsController@getCredits     (2/8)
 *   GET    /api/v1/imageGen/notifications       → notificationsController@listNotifications (header bell)
 *   POST   /api/v1/imageGen/notifications/read  → notificationsController@markNotificationsRead
 *
 * Auth: the same customer JWT middleware every other customer-facing route uses
 * (src/middleware/auth.js) — NOT insertionAuth/deleteAuth (those are crawler-only).
 * Deliberately no plan-capability gate yet — explicit instruction, decide later.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { authMiddleware } = require('../../../middleware/auth');
const imageGenConfig = require('../config');
const { recreate } = require('../controllers/recreateController');
const { getJobStatus, listMySpace, deleteMySpaceJob } = require('../controllers/jobsController');
const { getCredits, syncCredits } = require('../controllers/creditsController');
const { getCreditHistory, exportCreditHistoryCsv } = require('../controllers/creditsHistoryController');
const { uploadProductImage, deleteUpload } = require('../controllers/uploadController');
const { enhance } = require('../controllers/enhanceController');
const { downloadImage } = require('../controllers/downloadController');
const { listNotifications, markNotificationsRead } = require('../controllers/notificationsController');
const repo = require('../repository');
const { hasImageGenAccess, requireImageGenAccess } = require('../helpers/access');

// Product-image upload (screen 3a/3b) → temp file on disk, streamed to NAS by
// uploadController, then unlinked. Same disk-temp-then-stream pattern as the
// synthetic-keyword CSV upload in services/common/routes/commonRoutes.js.
const IMAGEGEN_UPLOAD_TMP = path.join(os.tmpdir(), 'pas-imagegen-uploads');
function ensureUploadTmpDir() { try { fs.mkdirSync(IMAGEGEN_UPLOAD_TMP, { recursive: true }); } catch { /* ignore */ } }
ensureUploadTmpDir();
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const productImageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { ensureUploadTmpDir(); cb(null, IMAGEGEN_UPLOAD_TMP); },
    filename: (_req, file, cb) => cb(null, `pi_${Date.now()}_${Math.round(process.hrtime()[1])}${path.extname(file.originalname || '') || '.jpg'}`),
  }),
  limits: { fileSize: imageGenConfig.productImageMaxUploadMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_IMAGE_MIME.has(file.mimetype)),
}).single('image');

/** Turns multer errors (too large, wrong type) into a clean 4xx instead of a throw. */
function productImageUploadMw(req, res, next) {
  productImageUpload(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({
        code: tooBig ? 413 : 400,
        message: tooBig
          ? `Image exceeds the ${imageGenConfig.productImageMaxUploadMb}MB limit.`
          : `Upload error: ${err.message}`,
      });
    }
    if (!req.file) {
      return res.status(422).json({ code: 422, message: 'Please upload a JPG, PNG, or WEBP image.' });
    }
    next();
  });
}


/** Attaches the Mongo Db handle onto the request so controllers don't each reach
 * into `service.db` themselves — one place to change if the injection shape ever
 * changes. Ensures indexes exist on first real request (cheap no-op after that). */
function injectDb(service) {
  return async (req, res, next) => {
    const mongo = service.db?.mongo;
    if (!mongo || !mongo.db) {
      return res.status(503).json({ code: 503, status: 'server_error', message: 'AI Recreate database is not available.' });
    }
    req.imageGenDb = mongo.db;
    try {
      await repo.init(mongo.db);
    } catch (err) {
      service.log?.warn?.('imageGen index setup failed (continuing)', { error: err.message });
    }
    next();
  };
}

function createImageGenRoutes(service) {
  const router = Router();
  // Every feature route: logged in AND has imageGen access (enabled +
  // allowedUserIds, helpers/access.js) — otherwise a plain 404.
  const access = [authMiddleware, requireImageGenAccess];
  const guard = [...access, injectDb(service)];

  // The one ungated route: tells the frontend whether to show the feature at all.
  router.get('/access', authMiddleware, (req, res) => res.json({
    code: 200, status: 'ok', message: 'Access.',
    data: { enabled: hasImageGenAccess(req.user?.user_id ?? req.user?.id) },
  }));

  // No injectDb — this route never touches Mongo, just NAS.
  router.post('/upload', ...access, productImageUploadMw, asyncHandler(uploadProductImage));
  // Needs injectDb (reference-count check against job docs before queuing a delete).
  router.delete('/upload', ...guard, asyncHandler(deleteUpload));
  // No injectDb — a text rewrite, never touches Mongo.
  router.post('/recreate/enhance', ...access, asyncHandler(enhance));
  router.post('/recreate', ...guard, asyncHandler(recreate));
  router.get('/jobs/:id/download', ...guard, asyncHandler(downloadImage));
  router.get('/jobs/:id', ...guard, asyncHandler(getJobStatus));
  router.get('/jobs', ...guard, asyncHandler(listMySpace));
  router.delete('/jobs/:id', ...guard, asyncHandler(deleteMySpaceJob));
  router.get('/credits', ...guard, asyncHandler(getCredits));
  router.post('/credits/sync', ...guard, asyncHandler(syncCredits));
  // credits/history before credits/history.csv matters not at all (different
  // paths), but both must be registered before any future '/credits/:id'-style
  // route to avoid a param route swallowing them — noted for future editors.
  router.get('/credits/history', ...guard, asyncHandler(getCreditHistory));
  router.get('/credits/history.csv', ...guard, asyncHandler(exportCreditHistoryCsv));
  router.get('/notifications', ...guard, asyncHandler(listNotifications));
  router.post('/notifications/read', ...guard, asyncHandler(markNotificationsRead));

  return router;
}

module.exports = createImageGenRoutes;
