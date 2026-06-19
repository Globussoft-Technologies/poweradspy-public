'use strict';

/**
 * user-chk repository — raw parameterized SQL for the instagram_user /
 * instagram_country_only tables.
 *
 * Ports the model methods used by UserController::instagram_user_data:
 *   - Instagram_country_only::getCountry_only / insertCountry_only
 *   - Instagram_users::getInstagram_users / insertInstagram_users / updateDataUser
 *
 * Convention (same as the insertion repository): getX → {code, data};
 * insertX → new id; updateX → affected rows. `exec` is db.sql (pool wrapper).
 */

const rows = (r) => (Array.isArray(r) ? r : []);
const firstId = (r) => (r && r.insertId ? r.insertId : 0);
const affected = (r) => (r && typeof r.affectedRows === 'number' ? r.affectedRows : 0);
const found = (r) => (rows(r).length ? { code: 200, data: rows(r) } : { code: 400, data: null });

// ── instagram_country_only ──────────────────────────────────────────────────
async function getCountryOnlyByName(exec, country) {
  return found(await exec.query('SELECT * FROM instagram_country_only WHERE country = ? LIMIT 1', [country]));
}
// PHP no-current_country branch: WHERE country = "" (empty string).
async function getEmptyCountryOnly(exec) {
  return found(await exec.query('SELECT * FROM instagram_country_only WHERE country = ? LIMIT 1', ['']));
}
async function insertCountryOnly(exec, country) {
  // PHP passes either { country } (insertGetId) or an empty array → row of defaults.
  if (country === undefined || country === null) {
    return firstId(await exec.query('INSERT INTO instagram_country_only () VALUES ()'));
  }
  return firstId(await exec.query('INSERT INTO instagram_country_only (country) VALUES (?)', [country]));
}

// ── instagram_user ───────────────────────────────────────────────────────────
async function getUserByInstagramId(exec, instagramId) {
  return found(await exec.query('SELECT * FROM instagram_user WHERE instagram_id = ? LIMIT 1', [instagramId]));
}
async function insertUser(exec, data) {
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  return firstId(await exec.query(
    `INSERT INTO instagram_user (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(data)
  ));
}
// PHP updateDataUser: only the username is refreshed, keyed by instagram_id.
async function updateUsername(exec, instagramId, username) {
  return affected(await exec.query(
    'UPDATE instagram_user SET instagram_username = ? WHERE instagram_id = ?',
    [username, instagramId]
  ));
}

module.exports = {
  getCountryOnlyByName,
  getEmptyCountryOnly,
  insertCountryOnly,
  getUserByInstagramId,
  insertUser,
  updateUsername,
};
