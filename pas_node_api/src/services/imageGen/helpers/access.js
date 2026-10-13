'use strict';

/**
 * Who gets the AI Recreate feature set (Recreate, MySpace, Profile, credits,
 * top-ups, imageGen notifications) — config.json → imageGen.enabled +
 * imageGen.allowedUserIds.
 *
 *   enabled false                      → nobody
 *   enabled true, allowedUserIds []    → everyone
 *   enabled true, allowedUserIds [ids] → only those user IDs
 *
 * Used by every imageGen and profile route (requireImageGenAccess) and by
 * GET /api/v1/imageGen/access, which the frontend reads to decide whether to
 * show any of it at all.
 */

const imageGenConfig = require('../config');

function hasImageGenAccess(userId) {
  if (imageGenConfig.enabled === false) return false;
  const allow = imageGenConfig.allowedUserIds || [];
  if (!allow.length) return true;
  return userId !== undefined && userId !== null && allow.includes(String(userId));
}

/** Express middleware — must run after authMiddleware. A user without access
 * gets a plain 404, so the feature leaves no trace for them. */
function requireImageGenAccess(req, res, next) {
  const userId = req.user?.user_id ?? req.user?.id;
  if (!hasImageGenAccess(userId)) {
    return res.status(404).json({ code: 404, status: 'rejected', message: 'Not found.' });
  }
  next();
}

module.exports = { hasImageGenAccess, requireImageGenAccess };
