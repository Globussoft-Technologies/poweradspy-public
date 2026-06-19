'use strict';

/**
 * Facebook user endpoints — ports of Userv2Controller::checkFbUser + fb_user_data.
 *
 *   user-chk  (checkFbUser)  : check-only — does this facebook_id exist?
 *   ads-data  (fb_user_data) : check-or-create — insert a new user or refresh the
 *                              demographic fields of an existing one.
 *
 * Both decode the payload the same way (plaintext for a known platform, else
 * XOR-decrypt body.data). Status codes/messages are kept byte-for-byte with PHP
 * because the browser extension switches on them.
 */

const config = require('../../../config');
const repo = require('./repository');
const { decodeUserPayload } = require('../../../insertion/helpers/payloadCrypto');

// ── user-chk : checkFbUser ─────────────────────────────────────────────────────
async function checkFbUser(req, db, log) {
  const sql = db && db.sql;
  if (!sql) return { code: 503, message: 'Database connection is not available.' };

  const decoded = decodeUserPayload(req.body || {}, config.insertion.decryptionKey);

  if (decoded.facebook_id === undefined || decoded.facebook_id === null) {
    return { code: 403, message: 'Parameter missing', data: null };
  }

  try {
    const user = await repo.getUserByFacebookId(sql, decoded.facebook_id);
    if (user.code === 200) return { code: 200, message: 'data found successfully', count: 1 };
    if (user.code === 400) return { code: 400, message: 'User not found', count: 0, data: null };
    return { code: 401, message: user, count: 0, data: null };
  } catch (err) {
    log?.error?.('user-chk: facebook lookup failed', { error: err.message });
    return { code: 401, message: err.message, count: 0, data: null };
  }
}

// ── ads-data : fb_user_data ─────────────────────────────────────────────────────
async function fbUserData(req, db, log) {
  // PHP wraps the whole method in try/catch → 202 on any failure.
  try {
    const sql = db && db.sql;
    if (!sql) return { code: 503, message: 'Database connection is not available, so the user could not be saved.' };

    const decoded = decodeUserPayload(req.body || {}, config.insertion.decryptionKey);

    if (decoded.facebook_id === undefined || decoded.facebook_id === null) {
      return { code: 400, message: 'please provide facebookId first' };
    }

    // Resolve (or create) the country_only id.
    let countryId = 0;
    if (decoded.current_country !== undefined && decoded.current_country !== null) {
      const existing = await repo.getCountryOnlyByName(sql, decoded.current_country);
      countryId = existing.code === 200
        ? existing.data[0].id
        : await repo.insertCountryOnly(sql, decoded.current_country);
    } else {
      const existing = await repo.getEmptyCountryOnly(sql);
      countryId = existing.code === 200
        ? existing.data[0].id
        : await repo.insertCountryOnly(sql, undefined);
    }

    // Facebook keeps the country NAME in current_country and stores the id separately.
    decoded.current_country_id = countryId;
    if (decoded.Gender !== undefined && decoded.Gender !== null) {
      decoded.Gender = String(decoded.Gender).toUpperCase();
    }

    const user = await repo.getUserByFacebookId(sql, decoded.facebook_id);

    if (user.code === 400) {
      // New user → insert everything except platform/data (never stored).
      const insertData = { ...decoded };
      delete insertData.platform;
      delete insertData.data;
      const id = await repo.insertUser(sql, insertData);
      if (id > 0) return { code: 200, message: 'data added successfully' };
      // PHP leaves $response untouched when the insert yields no id → empty body.
      return { code: 202, message: 'data not updated' };
    }

    if (user.code === 200) {
      // Existing user → refresh exactly the columns PHP's save() touches.
      const fields = {
        name: decoded.name ?? null,
        others_places_lived: decoded.others_places_lived ?? null,
        Gender: decoded.Gender ?? null,
        age: decoded.age ?? null,
        relationship_status: decoded.relationship_status ?? null,
        current_country: decoded.current_country ?? null,
        current_country_id: countryId,
      };
      await repo.updateUserFields(sql, decoded.facebook_id, fields);
      return { code: 201, message: 'data updated' };
    }

    return { code: 401, message: 'sql error', data: user.data };
  } catch (err) {
    log?.error?.('ads-data: fb_user_data failed', { error: err.message });
    return { code: 202, message: 'Error occured in function fb_user_data' };
  }
}

module.exports = { checkFbUser, fbUserData };
