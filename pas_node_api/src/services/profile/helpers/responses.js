'use strict';

/**
 * Response envelope helpers for the profile service's customer-facing API.
 * Same {code, status, message, data} shape convention used across this
 * codebase (e.g. imageGen's own copy) — kept as its own small copy rather
 * than importing another service's helper, since each service here is meant
 * to be self-contained.
 */

function ok(message, data = {}) {
  return { code: 200, status: 'ok', message, data };
}

function rejected(code, message, extra = {}) {
  return { code, status: 'rejected', message, ...extra };
}

function serverError(code, message, extra = {}) {
  return { code, status: 'server_error', message, ...extra };
}

module.exports = { ok, rejected, serverError };
