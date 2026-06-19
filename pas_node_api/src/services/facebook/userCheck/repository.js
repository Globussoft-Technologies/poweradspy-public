'use strict';

/**
 * user-chk / ads-data repository — raw parameterized SQL for the facebook_users /
 * country_only tables.
 *
 * Ports the model methods used by Userv2Controller::fb_user_data + checkFbUser:
 *   - Country_only::getCountry_only / insertCountry_only
 *   - Facebook_users::getFacebook_users / getFacebook_usersdata / insertGetId / save
 *
 * Convention: getX → {code, data}; insertX → new id; updateX → affected rows.
 * `exec` is db.sql (pool wrapper).
 */

const rows = (r) => (Array.isArray(r) ? r : []);
const firstId = (r) => (r && r.insertId ? r.insertId : 0);
const affected = (r) => (r && typeof r.affectedRows === 'number' ? r.affectedRows : 0);
const found = (r) => (rows(r).length ? { code: 200, data: rows(r) } : { code: 400, data: null });

// ── country_only ─────────────────────────────────────────────────────────────
async function getCountryOnlyByName(exec, country) {
  return found(await exec.query('SELECT * FROM country_only WHERE country = ? LIMIT 1', [country]));
}
async function getEmptyCountryOnly(exec) {
  return found(await exec.query('SELECT * FROM country_only WHERE country = ? LIMIT 1', ['']));
}
async function insertCountryOnly(exec, country) {
  if (country === undefined || country === null) {
    return firstId(await exec.query('INSERT INTO country_only () VALUES ()'));
  }
  return firstId(await exec.query('INSERT INTO country_only (country) VALUES (?)', [country]));
}

// ── facebook_users ───────────────────────────────────────────────────────────
async function getUserByFacebookId(exec, facebookId) {
  return found(await exec.query('SELECT * FROM facebook_users WHERE facebook_id = ? LIMIT 1', [facebookId]));
}
async function insertUser(exec, data) {
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  return firstId(await exec.query(
    `INSERT INTO facebook_users (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(data)
  ));
}
// PHP save() on the loaded model — refreshes exactly these columns, keyed by facebook_id.
async function updateUserFields(exec, facebookId, fields) {
  const cols = Object.keys(fields);
  if (!cols.length) return 0;
  return affected(await exec.query(
    `UPDATE facebook_users SET ${cols.map((c) => `\`${c}\` = ?`).join(', ')} WHERE facebook_id = ?`,
    [...Object.values(fields), facebookId]
  ));
}

module.exports = {
  getCountryOnlyByName,
  getEmptyCountryOnly,
  insertCountryOnly,
  getUserByFacebookId,
  insertUser,
  updateUserFields,
};
