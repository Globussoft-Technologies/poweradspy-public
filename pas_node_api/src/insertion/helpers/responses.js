'use strict';

/**
 * responses — meaningful, caller-friendly result builders for insertion.
 *
 * Every insertion result tells the caller three things:
 *   - message : what happened, in plain language
 *   - status  : 'ok' | 'rejected' (caller must fix their data/request) | 'server_error' (our side, retry later)
 *   - hint    : what to do next (only for failures)
 * plus optional `errors` (field-level list) and `field` (the offending field).
 *
 * This makes it obvious to the scraper/extension WHY an ad was not inserted and
 * whether the fix is on their end. Used by validate + both pipelines + middleware.
 */

function ok(id, message = 'Ad inserted successfully', extra = {}) {
  // extra can carry a non-fatal `warning` (e.g. image storage issue) — the ad
  // was saved, but the caller should know something partial happened.
  return { code: 200, status: 'ok', message, data: { id }, ...extra };
}

function updated(id, warning) {
  const r = { code: 200, status: 'ok', message: `Ad already present — existing data updated (id ${id})`, data: { id } };
  if (warning) r.warning = warning;
  return r;
}

/**
 * Caller-fault failure (4xx). The ad was NOT inserted because of something in
 * the request/data. `hint` explains the fix.
 */
function rejected(code, message, { hint, errors, field } = {}) {
  const r = { code, status: 'rejected', message };
  if (hint) r.hint = hint;
  if (errors) r.errors = errors;
  if (field) r.field = field;
  return r;
}

/**
 * Server-fault failure (5xx). The ad was NOT inserted due to an issue on OUR side
 * (DB/Elasticsearch/media/external API). The caller's data may be fine — retry later.
 */
function serverError(code, message, { hint, error } = {}) {
  return {
    code,
    status: 'server_error',
    message,
    hint: hint || 'This is a server-side issue, not your data. Please retry after some time; if it persists, contact support.',
    ...(error ? { error } : {}),
  };
}

/** Validation failure — list every field that needs fixing. */
function validationError(errors) {
  return rejected(400, `Validation failed — ${errors.length} field(s) need fixing before this ad can be inserted.`, {
    errors,
    hint: 'Fix the fields listed in `errors` and resend. The ad was not inserted because the payload is incomplete or invalid.',
  });
}

module.exports = { ok, updated, rejected, serverError, validationError };
