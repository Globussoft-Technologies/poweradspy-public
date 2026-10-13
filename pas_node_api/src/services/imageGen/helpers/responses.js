'use strict';

/**
 * Response envelope helpers for imageGen's customer-facing API.
 *
 * Same {code, status, message, data} shape convention as
 * src/insertion/helpers/responses.js (consistency across the codebase), but a
 * self-contained copy with a flexible `data` payload — the insertion one's `data:
 * {id}` shape is too narrow for job/credit responses. Not importing that file:
 * it's a different domain (crawler-facing vs. customer-facing), and imageGen is
 * meant to be self-contained per MANIFEST.md.
 */

function ok(message, data = {}) {
  return { code: 200, status: 'ok', message, data };
}

function accepted(message, data = {}) {
  return { code: 202, status: 'ok', message, data };
}

function rejected(code, message, extra = {}) {
  return { code, status: 'rejected', message, ...extra };
}

function noCredits(message, data = {}) {
  return { code: 402, status: 'no_credits', message, data };
}

function serverError(code, message, extra = {}) {
  return { code, status: 'server_error', message, ...extra };
}

module.exports = { ok, accepted, rejected, noCredits, serverError };
