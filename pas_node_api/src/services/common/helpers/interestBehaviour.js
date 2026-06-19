'use strict';

/**
 * Interest / Behaviour (audience targeting) helper.
 *
 * Talks to the external targeting service that returns a Facebook/Instagram ad's
 * interest + behaviour targeting:
 *
 *   GET https://ad-intnbeh.poweradspy.ai/targeting/get-data
 *   headers: { accept, ad_id, platform, token }
 *   200 → { data: { interests:[], behaviors:[], confidence_score, ... }, status_code, success }
 *
 * Used by:
 *   - {facebook,instagram}/controllers/adDetailController — lazy read-through:
 *     when an ad has no targeting in ES, fetch it here, show it, and cache it back.
 *   - common/controllers/interestBehaviourController — the batch puller (cron).
 *
 * Config (env):
 *   INTEREST_BEHAVIOUR        base URL of the targeting service (defaults to the
 *                             public host below — the URL is not a secret).
 *   INTEREST_BEHAVIOUR_TOKEN  bearer-style JWT sent in the `token` header. Secret,
 *                             env-only. Without it the fetch is skipped (returns null).
 *   APP_ENV / NODE_ENV        decide the prod vs dev `platform` tag.
 */

const axios = require('axios');

const DEFAULT_BASE_URL = 'https://ad-intnbeh.poweradspy.ai';
const TARGETING_PATH = '/targeting/get-data';
const DEFAULT_TIMEOUT_MS = 15000;

// platform header value per network + environment. The targeting service uses
// this to pick which ad-details backend it queries internally.
const PLATFORM_TAGS = {
  facebook:  { prod: 'facebook_prod',  dev: 'facebook_dev'  },
  instagram: { prod: 'instagram_prod', dev: 'instagram_dev' },
};

function isProdEnv() {
  return process.env.APP_ENV === 'main' || process.env.NODE_ENV === 'production';
}

function platformTag(network) {
  const t = PLATFORM_TAGS[String(network || '').toLowerCase()];
  if (!t) return null;
  return isProdEnv() ? t.prod : t.dev;
}

function targetingUrl() {
  const base = (process.env.INTEREST_BEHAVIOUR || DEFAULT_BASE_URL).replace(/\/$/, '');
  return base + TARGETING_PATH;
}

/**
 * Fetch one ad's targeting data, returning a DISCRIMINATED result so callers can
 * tell the three cases apart — critical for the refresh/cleanup cron, which must
 * only delete data on an authoritative "no data", never on an auth/transient error:
 *
 *   { status: 'ok',    interests, behaviors, confidence_score }  // has data → show/refresh
 *   { status: 'empty' }                                          // service says no targeting → safe to remove
 *   { status: 'skip'  }                                          // token unset / auth fail / network/5xx → DO NOT touch
 *
 * Note the deliberate safety deviation from the PHP cron: the raw PHP removes
 * fields on ANY status_code 400, but this service returns 400 for "Authentication
 * failed" too — so a stale token would wipe every ad's targeting. Auth failures
 * are classified 'skip' here, never 'empty'.
 */
async function fetchTargetingDetailed({ network, adId, log, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const platform = platformTag(network);
  if (!platform) {
    log?.warn?.(`[interestBehaviour] unsupported network "${network}" — skipping targeting fetch`);
    return { status: 'skip' };
  }

  const token = process.env.INTEREST_BEHAVIOUR_TOKEN;
  if (!token) {
    log?.warn?.('[interestBehaviour] INTEREST_BEHAVIOUR_TOKEN not set — skipping targeting fetch');
    return { status: 'skip' };
  }

  try {
    const resp = await axios.get(targetingUrl(), {
      headers: { accept: 'application/json', ad_id: String(adId), platform, token },
      timeout: timeoutMs,
      validateStatus: (s) => s < 500, // let us read a 4xx body (service signals no-data there)
    });

    const body = resp.data || {};
    // Auth / permission failure must NEVER be treated as "no data" → never delete.
    const msg = String(body.message || '').toLowerCase();
    const authFailed = resp.status === 401 || resp.status === 403 ||
      msg.includes('auth') || msg.includes('token') || msg.includes('unauthor') || msg.includes('forbidden');
    if (authFailed) {
      log?.warn?.(`[interestBehaviour] auth failure fetching ad ${adId} — skipping (data left intact)`);
      return { status: 'skip' };
    }

    const d = body.data || {};
    const interests = Array.isArray(d.interests) ? d.interests : [];
    const behaviors = Array.isArray(d.behaviors) ? d.behaviors : [];
    const confidence_score = d.confidence_score ?? null;

    // Authoritative "this ad has no targeting data" → safe to remove on the cron.
    const noData = body.success === false || (body.status_code && body.status_code !== 200) ||
      (interests.length === 0 && behaviors.length === 0);
    if (noData) return { status: 'empty' };

    return { status: 'ok', interests, behaviors, confidence_score };
  } catch (err) {
    log?.warn?.(`[interestBehaviour] targeting fetch failed for ad ${adId}: ${err.message}`);
    return { status: 'skip' };
  }
}

/**
 * Simple wrapper used by the lazy read-through and the insert puller: returns the
 * targeting data on success, or null for "nothing to show / nothing to cache".
 * @returns {Promise<{interests:string[], behaviors:string[], confidence_score:(number|null)}|null>}
 */
async function fetchTargetingData(opts) {
  const r = await fetchTargetingDetailed(opts);
  return r.status === 'ok'
    ? { interests: r.interests, behaviors: r.behaviors, confidence_score: r.confidence_score }
    : null;
}

/**
 * Add an explicit mapping `type` only on ES 6.x (typeless on 7+/8). Mirrors the
 * helper in addCategoryController so write paths behave the same across versions.
 */
function withEsType(esConn, params, typeName = 'doc') {
  const major = esConn?.esMajor;
  if (major == null || major < 7) return { ...params, type: typeName };
  return params;
}

/**
 * Write-once merge: which targeting fields are MISSING on the ad's existing
 * `source`, given freshly-fetched `data`. Returns {} when nothing needs writing.
 */
function buildWriteOnceFields(source = {}, data = {}) {
  const fields = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(source, k);
  if (!has('interests') && data.interests?.length) fields.interests = data.interests;
  if (!has('behaviors') && data.behaviors?.length) fields.behaviors = data.behaviors;
  const confExists = has('confidence_score');
  const confVal = confExists ? source.confidence_score : null;
  if ((!confExists || confVal === null || confVal === 0) && data.confidence_score != null) {
    fields.confidence_score = data.confidence_score;
  }
  return fields;
}

/**
 * Cache freshly-fetched targeting data back onto the ad's ES doc (write-once).
 * Best-effort — never throws (callers run this fire-and-forget).
 */
async function storeTargetingData({ esConn, index, docId, source = {}, data, log } = {}) {
  if (!esConn || !index || !docId || !data) return;
  const fields = buildWriteOnceFields(source, data);
  if (Object.keys(fields).length === 0) return;
  try {
    await esConn.update(withEsType(esConn, { index, id: docId, body: { doc: fields } }));
    log?.info?.(`[interestBehaviour] cached targeting data for doc ${docId} in ${index}`);
  } catch (err) {
    log?.warn?.(`[interestBehaviour] ES write-back failed for doc ${docId}: ${err.message}`);
  }
}

/**
 * Remove the targeting fields from an ad's ES doc — the cron's cleanup path when
 * the service authoritatively reports the ad has no (valid) targeting anymore.
 * Best-effort — never throws.
 */
async function removeTargetingData({ esConn, index, docId, log } = {}) {
  if (!esConn || !index || !docId) return;
  try {
    await esConn.update(withEsType(esConn, {
      index,
      id: docId,
      body: {
        script: {
          lang: 'painless',
          source: "ctx._source.remove('interests'); ctx._source.remove('behaviors'); ctx._source.remove('confidence_score');",
        },
      },
    }));
    log?.info?.(`[interestBehaviour] removed stale targeting from doc ${docId} in ${index}`);
  } catch (err) {
    log?.warn?.(`[interestBehaviour] ES remove failed for doc ${docId}: ${err.message}`);
  }
}

module.exports = {
  fetchTargetingData,
  fetchTargetingDetailed,
  storeTargetingData,
  removeTargetingData,
  buildWriteOnceFields,
  withEsType,
  platformTag,
  isProdEnv,
};
