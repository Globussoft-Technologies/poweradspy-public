'use strict';

/**
 * userCheckController — POST user-chk (InstagramUserController route
 * UserController@instagram_user_data). Thin wrapper over the userCheck service.
 */

const { checkUser } = require('../userCheck/service');

async function userChk(req, db, logger) {
  return checkUser(req, db, logger);
}

module.exports = { userChk };
