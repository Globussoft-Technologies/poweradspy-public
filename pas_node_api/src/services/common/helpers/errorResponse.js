'use strict';

function compactObject(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

function buildErrorResponse({
  code,
  message,
  type,
  source = 'api',
  operation,
  stage,
  network,
  table,
  field,
  value,
  details,
}) {
  return {
    code,
    message,
    error: compactObject({
      type,
      source,
      operation,
      stage,
      network,
      table,
      field,
      value,
      details,
    }),
  };
}

function classifySqlError(err) {
  const code = err && err.code ? String(err.code) : '';
  const connCodes = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'PROTOCOL_CONNECTION_LOST',
    'ER_CON_COUNT_ERROR',
  ]);
  const isConnection = connCodes.has(code) || /server has gone away|connection.*lost|too many connections/i.test(err?.message || '');

  return {
    httpCode: isConnection ? 503 : 500,
    type: isConnection ? 'sql_connection_error' : 'sql_query_error',
    source: 'sql',
    message: isConnection ? 'SQL connection unavailable' : 'SQL query failed',
    sql: compactObject({
      code: err?.code,
      errno: err?.errno,
      sqlState: err?.sqlState,
      sqlMessage: err?.sqlMessage,
      message: err?.message,
    }),
  };
}

function classifyEsError(err) {
  return {
    type: 'elasticsearch_error',
    source: 'elasticsearch',
    message: 'Elasticsearch update failed',
    details: compactObject({
      message: err?.message,
      name: err?.name,
      code: err?.code,
      statusCode: err?.statusCode,
    }),
  };
}

// "UPDATE google_text_ad" / "INSERT INTO google_ad_url" / "SELECT FROM x" from the failing SQL.
function sqlTarget(sql) {
  if (!sql) return null;
  const s = String(sql).trim();
  const op = (s.match(/^\w+/) || [''])[0].toUpperCase();
  const table = (s.match(/\b(?:INTO|UPDATE|FROM)\s+`?([\w.]+)`?/i) || [])[1];
  if (!op) return null;
  if (!table) return op;
  if (op === 'UPDATE') return `UPDATE ${table}`;
  if (op === 'INSERT' || op === 'REPLACE') return `${op} INTO ${table}`;
  return `${op} FROM ${table}`;
}

/**
 * One-line, human-readable reason for a thrown error, saying where it happened:
 *   SQL → "SQL error on UPDATE google_text_ad — ER_...: Incorrect integer value ..."
 *   ES  → "Elasticsearch error — <reason>"
 *   JS  → the plain error message
 */
function describeError(err) {
  if (!err) return 'Unknown error';
  const esReason = err?.meta?.body?.error?.reason || err?.body?.error?.reason;
  if (esReason || err?.name === 'ResponseError' || err?.meta?.statusCode) {
    return `Elasticsearch error — ${esReason || err.message}`;
  }
  if (err.sqlMessage || err.sql) {
    const where = sqlTarget(err.sql);
    const detail = err.code ? `${err.code}: ${err.sqlMessage || err.message}` : (err.sqlMessage || err.message);
    return where ? `SQL error on ${where} — ${detail}` : `SQL error — ${detail}`;
  }
  return err.message || String(err);
}

module.exports = { buildErrorResponse, classifySqlError, classifyEsError, compactObject, describeError };
