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

module.exports = { buildErrorResponse, classifySqlError, classifyEsError, compactObject };
