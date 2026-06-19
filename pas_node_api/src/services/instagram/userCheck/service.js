'use strict';

/**
 * user-chk service — port of UserController::instagram_user_data.
 *
 * One call does check-or-create:
 *   1. Decode the payload (plaintext body for a known platform, else XOR-decrypt body.data).
 *   2. Require instagram_id.
 *   3. Resolve/create the country_only row → numeric id; keep the country NAME in `country`
 *      and replace `current_country` with that id (exactly as PHP rewrites the record).
 *   4. Upsert the user keyed by instagram_id:
 *        - not found → INSERT (platform is never stored)        → 200 "data added successfully"
 *        - found     → UPDATE instagram_username only           → 201 "data updated successfully"
 *
 * Status codes/messages are kept byte-for-byte with PHP because the browser
 * extension switches on them.
 */

const config = require('../../../config');
const repo = require('./repository');
const { decodeUserPayload } = require('../../../insertion/helpers/payloadCrypto');

async function checkUser(req, db, log) {
  const sql = db && db.sql;
  if (!sql) return { code: 503, message: 'Database connection is not available, so the user could not be saved.' };

  const postData = req.body || {};
  const decoded = decodeUserPayload(postData, config.insertion.decryptionKey);

  if (decoded.instagram_id === undefined || decoded.instagram_id === null) {
    return { code: 400, message: 'please provide instagramId first' };
  }

  // Resolve (or create) the country_only id.
  let countryId = 0;
  try {
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
  } catch (err) {
    log?.error?.('user-chk: country_only resolution failed', { error: err.message });
    return { code: 401, message: 'sql error' };
  }

  // PHP rewrites the record: keep the country NAME in `country`, put the id in current_country.
  decoded.country = decoded.current_country;
  decoded.current_country = countryId;
  if (decoded.gender !== undefined && decoded.gender !== null) {
    decoded.gender = String(decoded.gender).toUpperCase();
  }

  try {
    const user = await repo.getUserByInstagramId(sql, decoded.instagram_id);

    if (user.code === 400) {
      // New user → insert everything except platform/data (never stored).
      const insertData = { ...decoded };
      delete insertData.platform;
      delete insertData.data;
      const id = await repo.insertUser(sql, insertData);
      if (id > 0) return { code: 200, message: 'data added successfully' };
      return { code: 401, message: 'sql error' };
    }

    if (user.code === 200) {
      // Existing user → refresh the username only (PHP updateDataUser).
      await repo.updateUsername(sql, decoded.instagram_id, decoded.instagram_username);
      return { code: 201, message: 'data updated successfully' };
    }

    return { code: 401, message: 'sql error' };
  } catch (err) {
    log?.error?.('user-chk: user upsert failed', { error: err.message });
    return { code: 401, message: 'sql error' };
  }
}

module.exports = { checkUser };
