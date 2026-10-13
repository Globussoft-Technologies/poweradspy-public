'use strict';

/**
 * Profile routes. Auto-mounted by ServiceRegistry under /api/v1/profile
 * (dynamic discovery — src/services/profile/routes/ exists, same mechanism
 * imageGen/chatgptads use, no extra registration needed).
 *
 *   GET    /api/v1/profile/me                       → meController@getMe
 *   PATCH  /api/v1/profile/me                        → meController@updateMe
 *   POST   /api/v1/profile/me/avatar                 → meController@uploadAvatar
 *   DELETE /api/v1/profile/me/avatar                 → meController@removeAvatar
 *   GET    /api/v1/profile/billing                   → billingController@getBilling
 *   GET    /api/v1/profile/notification-preferences  → notificationPrefsController@getPreferences
 *   PATCH  /api/v1/profile/notification-preferences  → notificationPrefsController@updatePreferences
 *
 * Auth: the same customer JWT middleware every other customer-facing route
 * uses (src/middleware/auth.js).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { authMiddleware } = require('../../../middleware/auth');
const { getMe, updateMe, uploadAvatar, removeAvatar } = require('../controllers/meController');
const { getBilling } = require('../controllers/billingController');
const { getPreferences, updatePreferences } = require('../controllers/notificationPrefsController');
const repo = require('../repository');
// Profile (Credits/Notifications) is part of the AI Recreate feature set —
// same enabled + allowedUserIds gate as every imageGen route.
const { requireImageGenAccess } = require('../../imageGen/helpers/access');

const AVATAR_UPLOAD_TMP = path.join(os.tmpdir(), 'pas-profile-avatar-uploads');
function ensureUploadTmpDir() { try { fs.mkdirSync(AVATAR_UPLOAD_TMP, { recursive: true }); } catch { /* ignore */ } }
ensureUploadTmpDir();
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png']);
const AVATAR_MAX_MB = 2; // matches the spec's "JPG/PNG ≤2MB"
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { ensureUploadTmpDir(); cb(null, AVATAR_UPLOAD_TMP); },
    filename: (_req, file, cb) => cb(null, `av_${Date.now()}_${Math.round(process.hrtime()[1])}${path.extname(file.originalname || '') || '.jpg'}`),
  }),
  limits: { fileSize: AVATAR_MAX_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_IMAGE_MIME.has(file.mimetype)),
}).single('image');

function avatarUploadMw(req, res, next) {
  avatarUpload(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({
        code: tooBig ? 413 : 400,
        message: tooBig ? `Image exceeds the ${AVATAR_MAX_MB}MB limit.` : `Upload error: ${err.message}`,
      });
    }
    if (!req.file) return res.status(422).json({ code: 422, message: 'Please upload a JPG or PNG image.' });
    next();
  });
}

/** Attaches the Mongo Db handle onto the request — same pattern as imageGen's
 * injectDb (req.imageGenDb). Ensures the collection's indexes exist on first
 * real request (cheap no-op after that). */
function injectDb(service) {
  return async (req, res, next) => {
    const mongo = service.db?.mongo;
    if (!mongo || !mongo.db) {
      return res.status(503).json({ code: 503, status: 'server_error', message: 'Profile database is not available.' });
    }
    req.profileDb = mongo.db;
    try {
      await repo.init(mongo.db);
    } catch (err) {
      service.log?.warn?.('profile index setup failed (continuing)', { error: err.message });
    }
    next();
  };
}

function createProfileRoutes(service) {
  const router = Router();
  const withDb = injectDb(service);
  const auth = [authMiddleware, requireImageGenAccess];

  router.get('/me', ...auth, withDb, asyncHandler(getMe));
  router.patch('/me', ...auth, withDb, asyncHandler(updateMe));
  router.post('/me/avatar', ...auth, withDb, avatarUploadMw, asyncHandler(uploadAvatar));
  router.delete('/me/avatar', ...auth, withDb, asyncHandler(removeAvatar));
  router.get('/billing', ...auth, asyncHandler(getBilling));
  router.get('/notification-preferences', ...auth, withDb, asyncHandler(getPreferences));
  router.patch('/notification-preferences', ...auth, withDb, asyncHandler(updatePreferences));

  return router;
}

module.exports = createProfileRoutes;
