'use strict';

/**
 * Elasticsearch 6.x compatibility for the 9.x-style requests the app sends.
 *
 * The app is written for ES 9.5. DatabaseManager detects the cluster version at connect time
 * (`esMajor`); only when the cluster is older than 7 are requests passed through the helpers
 * below. ES 9.x requests are sent unchanged.
 *
 * What differs on ES 6.x:
 *   - document APIs need a mapping type in the URL (`/index/doc/id`). Client v9 cannot send a
 *     type, so index / get / update / delete go out as raw typed requests, and bulk action
 *     lines get `_type`. A `type` the caller already set is used as is.
 *   - date_histogram knows only `interval` (`calendar_interval` / `fixed_interval` are 7.2+).
 *   - docvalue_fields returns dates as epoch millis unless `format: 'use_field_mapping'` is
 *     asked for (9.x returns the mapping's format by default).
 * Response bodies have the same shape, so callers need no change.
 */

const LEGACY_MAX_MAJOR = 6;

function isLegacy(esMajor) {
  return esMajor != null && esMajor <= LEGACY_MAX_MAJOR;
}

const enc = (v) => encodeURIComponent(String(v));

// ── Search / count ──────────────────────────────────────────────────────────

// Deep copy of an aggs tree with calendar_interval / fixed_interval renamed to interval.
function renameIntervals(value) {
  if (Array.isArray(value)) return value.map(renameIntervals);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    const name = key === 'calendar_interval' || key === 'fixed_interval' ? 'interval' : key;
    out[name] = renameIntervals(v);
  }
  return out;
}

function legacyDocvalueFields(fields) {
  if (!Array.isArray(fields)) return fields;
  return fields.map((f) => {
    if (typeof f === 'string') return { field: f, format: 'use_field_mapping' };
    if (f && typeof f === 'object' && !f.format) return { ...f, format: 'use_field_mapping' };
    return f;
  });
}

function legacySearchBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const out = { ...body };
  if (out.aggs) out.aggs = renameIntervals(out.aggs);
  if (out.aggregations) out.aggregations = renameIntervals(out.aggregations);
  if (out.docvalue_fields) out.docvalue_fields = legacyDocvalueFields(out.docvalue_fields);
  return out;
}

/** Search/count params for ES 6.x (body keys may sit in `body` or at the top level). */
function toLegacySearch(params) {
  if (!params || typeof params !== 'object') return params;
  const out = legacySearchBody(params);
  if (out.body) out.body = legacySearchBody(out.body);
  return out;
}

// ── Document APIs ───────────────────────────────────────────────────────────

/** The index's single mapping type on ES 6.x (e.g. `doc`), cached per index name. */
async function resolveType(client, index, cache) {
  if (cache.has(index)) return cache.get(index);
  let type = 'doc';
  try {
    const res = await client.transport.request({ method: 'GET', path: `/${enc(index)}/_mapping` });
    const first = Object.values(res || {})[0];
    const names = Object.keys(first?.mappings || {}).filter((n) => n !== '_default_');
    if (names.length) type = names[0];
  } catch (_) { /* keep 'doc' — the type every PowerAdSpy 6.x index uses */ }
  cache.set(index, type);
  return type;
}

const pickRest = (params, skip) => {
  const qs = {};
  for (const [k, v] of Object.entries(params || {})) if (!skip.includes(k) && v !== undefined) qs[k] = v;
  return qs;
};

async function legacyIndex(client, params, options, cache) {
  const type = params.type || await resolveType(client, params.index, cache);
  const id = params.id != null ? `/${enc(params.id)}` : '';
  return client.transport.request({
    method: params.id != null ? 'PUT' : 'POST',
    path: `/${enc(params.index)}/${enc(type)}${id}`,
    querystring: pickRest(params, ['index', 'type', 'id', 'body', 'document']),
    body: params.document ?? params.body,
  }, options);
}

async function legacyGet(client, params, options) {
  // `_all` = whichever type the document has (ES 6.x).
  return client.transport.request({
    method: 'GET',
    path: `/${enc(params.index)}/${enc(params.type || '_all')}/${enc(params.id)}`,
    querystring: pickRest(params, ['index', 'type', 'id']),
  }, options);
}

const UPDATE_BODY_KEYS = ['doc', 'doc_as_upsert', 'script', 'scripted_upsert', 'upsert', 'detect_noop'];

async function legacyUpdate(client, params, options, cache) {
  const type = params.type || await resolveType(client, params.index, cache);
  let body = params.body;
  if (body == null) {
    body = {};
    for (const k of UPDATE_BODY_KEYS) if (params[k] !== undefined) body[k] = params[k];
  }
  return client.transport.request({
    method: 'POST',
    path: `/${enc(params.index)}/${enc(type)}/${enc(params.id)}/_update`,
    querystring: pickRest(params, ['index', 'type', 'id', 'body', ...UPDATE_BODY_KEYS]),
    body,
  }, options);
}

async function legacyDelete(client, params, options, cache) {
  const type = params.type || await resolveType(client, params.index, cache);
  return client.transport.request({
    method: 'DELETE',
    path: `/${enc(params.index)}/${enc(type)}/${enc(params.id)}`,
    querystring: pickRest(params, ['index', 'type', 'id']),
  }, options);
}

const BULK_ACTIONS = ['index', 'create', 'update', 'delete'];

/** Bulk params for ES 6.x: `_type` added to every action line that lacks one. */
async function toLegacyBulk(client, params, cache) {
  const key = Array.isArray(params.operations) ? 'operations' : 'body';
  const ops = params[key];
  if (!Array.isArray(ops)) return params;
  const out = ops.slice();
  for (let i = 0; i < out.length;) {
    const line = out[i];
    const action = line && typeof line === 'object' ? Object.keys(line).find((k) => BULK_ACTIONS.includes(k)) : null;
    if (!action) { i += 1; continue; }
    const meta = line[action] || {};
    if (!meta._type) {
      const index = meta._index || params.index;
      if (index) out[i] = { [action]: { ...meta, _type: await resolveType(client, index, cache) } };
    }
    i += action === 'delete' ? 1 : 2; // every action except delete is followed by a source line
  }
  return { ...params, [key]: out };
}

module.exports = {
  isLegacy,
  toLegacySearch,
  renameIntervals,
  legacyDocvalueFields,
  resolveType,
  legacyIndex,
  legacyGet,
  legacyUpdate,
  legacyDelete,
  toLegacyBulk,
};
