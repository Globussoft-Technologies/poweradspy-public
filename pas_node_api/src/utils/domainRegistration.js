'use strict';

/**
 * Shared query for `get-domain-registration` — faithful port of the PHP
 * getDomainRegistration (Instagram Userv2Controller + gtext UserController). Both are
 * identical apart from the domains table, so the per-network controllers pass `table`.
 *
 * PHP contract (returned via json_encode → HTTP 200 always; the app status is in `code`):
 *   - missing/empty domain        → { code: 400, message: 'Please provide proper domain' }
 *   - DB query error (model false)→ { code: 400, message: 'Some error ocurred during querying the db' }
 *   - row found                   → { code: 200, message: 'Domain found successfully', data: { domain, domain_registered_date } }
 *   - no row                      → { code: 404, message: 'Domain not found' }
 *   - unexpected error (outer)    → { code: 401, message: 'Some Error Occured', data: [] }
 *
 * @param {string} table  domain table (constant per network — NOT user input)
 */
async function getDomainRegistration(req, db, log, table) {
  const domain = req && req.query && req.query.domain != null ? String(req.query.domain) : '';
  if (domain === '') {
    return { code: 400, message: 'Please provide proper domain' };
  }

  const sql = db && db.sql;
  if (!sql) return { code: 401, message: 'Some Error Occured', data: [] };

  try {
    let row = null;
    try {
      const rows = await sql.query(
        `SELECT domain, domain_registered_date FROM ${table} WHERE domain = ? LIMIT 1`,
        [domain]
      );
      row = Array.isArray(rows) && rows.length ? rows[0] : null;
    } catch (dbErr) {
      // mirrors the model's own try/catch returning false → 400
      log?.error?.('getDomainRegistration db error', { error: dbErr.message, table });
      return { code: 400, message: 'Some error ocurred during querying the db' };
    }

    if (row) return { code: 200, message: 'Domain found successfully', data: row };
    return { code: 404, message: 'Domain not found' };
  } catch (err) {
    log?.error?.('getDomainRegistration error', { error: err.message });
    return { code: 401, message: 'Some Error Occured', data: [] };
  }
}

module.exports = { getDomainRegistration };
