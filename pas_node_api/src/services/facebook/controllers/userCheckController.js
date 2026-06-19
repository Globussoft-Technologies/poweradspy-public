'use strict';

/**
 * userCheckController — Facebook user endpoints (Userv2Controller routes):
 *   POST user-chk  → Userv2Controller@checkFbUser   (check-only)
 *   POST ads-data  → Userv2Controller@fb_user_data  (insert / update)
 * Thin wrappers over the userCheck service.
 */

const { checkFbUser, fbUserData } = require('../userCheck/service');

async function userChk(req, db, logger) {
  return checkFbUser(req, db, logger);
}

async function adsData(req, db, logger) {
  return fbUserData(req, db, logger);
}

module.exports = { userChk, adsData };
