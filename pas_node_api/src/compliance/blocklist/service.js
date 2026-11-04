'use strict';

/**
 * The blocklist check used by the insertion engine, plus the calls the other
 * compliance jobs depend on:
 *
 *   guard(ad, network)             B1  the ingestion check (sync, no DB call)
 *   add(entries)                   B3 / B6 / seeding   put entries on the list, get their ids back
 *   revoke(refs, opts)             B5 / B2 test cleanup   soft-remove entries
 *   listActive(network)            B6  read every active entry (audits)
 *   getImageHashes(network)        B2  the banned images, in memory, for matching
 *   recordAttempt(input)           B2  log a rejection through the same batched writer
 *
 * guard(ad, network) is synchronous and does no database work: it extracts the
 * identifiers from the payload, looks them up in the network's in-memory
 * snapshot, and returns either null (allowed) or a ready-made rejection.
 *
 * Failure behavior (config.failMode):
 *   closed (default)  a network whose list could not be loaded rejects with 503
 *   open              a network whose list could not be loaded lets ads through
 *                     (loudly logged, rate-limited)
 * An unexpected error inside the check follows the same rule.
 *
 * add / revoke / listActive work whether or not enforcement is switched on, so
 * takedowns and seeding never depend on the ingestion flag.
 */

const crypto = require('crypto');
const { rejected, serverError } = require('../../insertion/helpers/responses');
const { STATUS, TYPE_TO_FAMILY } = require('./constants');
const { resolveFields, extract } = require('./extract');
const { evaluate } = require('./match');
const { normalizeByFamily } = require('./normalize');
const { cleanHex } = require('../imagematch/matcher');
const repository = require('./repository');
const { BlocklistCache } = require('./cache');
const { BlockedAttemptLogger } = require('./attempts');

const { idKey, VALUE_MAX } = repository;

// Used only if the setting is missing from the config object (the real default lives in
// src/config/index.js: compliance.blocklist.openWarnSeconds).
const FALLBACK_OPEN_WARN_SECONDS = 60;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const IMAGE_HASH = 'image_hash';
// The hash version of the image-hashing service, e.g. "sscd-simhash-v1" (up to 16 characters, the column width).
const PHASH_ALGO = /^[a-z0-9_-]{1,16}$/;

const sha256Hex = (text) => crypto.createHash('sha256').update(text).digest('hex');

/**
 * The networks covered when compliance.blocklist.networks is empty. They come from the
 * existing networks config (src/config/networks.js, built from config.json): the networks
 * that have SQL enabled and an insertion block, and whose database is connected. Nothing
 * is listed in this module, so a network added to the config is picked up automatically.
 *
 * @param {(slug: string) => any} connected  returns the SQL connection of a network, or null
 * @param {Object} [networksConfig]          injectable for tests
 */
function defaultNetworks(connected, networksConfig) {
  let all = networksConfig;
  if (!all) {
    try {
      all = require('../../config/networks');
    } catch {
      all = {};
    }
  }
  return Object.entries(all || {})
    .filter(([, cfg]) => cfg?.database?.sql?.enabled && cfg?.insertion)
    .map(([slug]) => slug)
    .filter((slug) => Boolean(connected(slug)));
}

/** 256-bit perceptual hash (64 hex characters) -> lowercase hex string, or { error }. */
function parsePhash(value) {
  if (value === undefined || value === null || value === '') return { phash: null };
  const hex = cleanHex(value);
  if (!hex) return { error: 'imagePhash must be 64 hex characters (the 256-bit hash of the image-hashing service)' };
  return { phash: hex };
}

class BlocklistService {
  /**
   * @param {Object} deps
   * @param {Object} deps.config
   * @param {?BlocklistCache} deps.cache      null while enforcement is disabled
   * @param {?BlockedAttemptLogger} deps.attempts
   * @param {?Object} deps.repository         needed for add / revoke / listActive
   * @param {Function} deps.getSql
   * @param {Object} deps.log
   */
  constructor({ config, cache = null, attempts = null, repository = null, getSql = () => null, log }) {
    this.config = config;
    this.cache = cache;
    this.attempts = attempts;
    this.repository = repository;
    this.getSql = getSql;
    this.log = log;
    this.fieldsByNetwork = new Map();
    this.lastOpenWarn = new Map();
  }

  fieldsFor(network) {
    if (!this.fieldsByNetwork.has(network)) {
      this.fieldsByNetwork.set(network, resolveFields(network, this.config.fields));
    }
    return this.fieldsByNetwork.get(network);
  }

  /** True when this network is covered by the blocklist. */
  appliesTo(network) {
    return Boolean(this.config.enabled && this.cache && network && this.cache.manages(network));
  }

  /** The networks whose database holds the blocklist tables (the 'all' fan-out targets). */
  managedNetworks() {
    if (this.cache) return this.cache.networks;
    const configured = this.config.networks;
    return configured && configured.length ? configured : defaultNetworks(this.getSql);
  }

  // ─── B1: the ingestion check ───────────────────────────────────────

  /** The match for an ad, or null. Throws only on a programming error. */
  match(ad, network) {
    const state = this.cache.get(network);
    if (!state || !state.snapshot) return null;
    const extracted = extract(ad, this.fieldsFor(network), this.config.maxUrlsPerAd);
    const hit = evaluate(extracted, state.snapshot, this.config.rules);
    return hit ? { hit, extracted } : null;
  }

  /**
   * @returns {?Object} null when the ad may proceed, otherwise the rejection
   *                    result to return for it (nothing is stored or uploaded).
   */
  guard(ad, network, { source = null } = {}) {
    if (!this.appliesTo(network)) return null;
    try {
      const state = this.cache.get(network);
      if (!state || state.status === STATUS.UNAVAILABLE) return this.unavailable(network);

      const found = this.match(ad, network);
      if (!found) return null;

      this.recordMatch(network, found, source);
      return rejected(this.config.response.code, this.config.response.message, {
        hint: 'This content cannot be accepted. Do not resend it.',
      });
    } catch (err) {
      this.log.error('blocklist check failed', { network, error: err.message, stack: err.stack });
      return this.unavailable(network);
    }
  }

  unavailable(network) {
    if (this.config.failMode === 'closed') {
      return serverError(this.config.unavailable.code, this.config.unavailable.message, {
        hint: 'Retry shortly. The ad was not stored.',
      });
    }
    const now = Date.now();
    const seconds = Number(this.config.openWarnSeconds);
    const warnEveryMs = (Number.isFinite(seconds) && seconds > 0 ? seconds : FALLBACK_OPEN_WARN_SECONDS) * 1000;
    if (now - (this.lastOpenWarn.get(network) || 0) > warnEveryMs) {
      this.lastOpenWarn.set(network, now);
      this.log.warn('blocklist unavailable; failMode=open so ads are NOT being checked', { network });
    }
    return null;
  }

  recordMatch(network, { hit, extracted }, source) {
    if (!this.attempts) return;
    const matchedUrl = hit.family === 'url' ? hit.key : null;
    this.attempts.record({
      network,
      platform_ad_id: extracted.rawAdId,
      advertiser: extracted.rawAdvertiser,
      image_url: matchedUrl,
      blocklist_id: hit.entry.id,
      match_type: hit.entry.entryType,
      distance: null,
      source,
    });
  }

  // ─── B2: banned images and attempt logging ─────────────────────────

  /**
   * The banned images for a network, for B2's matching. `available` is false when
   * the list could not be trusted (nothing loaded, or the image query failed and
   * no earlier copy exists), so B2 can apply its own fail mode.
   *
   * @returns {{ available: boolean, status: string, hashes: Array<{id, sha256, phash: ?Uint32Array, algo: ?string}> }}
   *          phash is the 256-bit hash as 8 unsigned 32-bit words (see ../imagematch/matcher.js); do not modify it.
   */
  getImageHashes(network) {
    const state = this.cache ? this.cache.get(network) : null;
    if (!state || !state.snapshot) {
      return { available: false, status: state ? state.status : 'unmanaged', hashes: [] };
    }
    return {
      available: state.imageHashesLoaded === true && state.status !== STATUS.UNAVAILABLE,
      status: state.status,
      hashes: state.snapshot.imageHashes || [],
    };
  }

  /**
   * Log a rejection made by another job (B2) through the same batched writer, so
   * it never adds a database write to the request. Identifiers only.
   * @returns {boolean} false when the input is unusable or logging is off
   */
  recordAttempt({ network, platformAdId = null, advertiser = null, imageUrl = null, blocklistId, matchType, distance = null, source = null } = {}) {
    if (!this.attempts) return false;
    if (typeof network !== 'string' || !network || typeof matchType !== 'string' || !matchType) return false;
    if (!Number.isSafeInteger(blocklistId) || blocklistId <= 0) return false;
    this.attempts.record({
      network,
      platform_ad_id: platformAdId === null || platformAdId === undefined ? null : String(platformAdId),
      advertiser,
      image_url: imageUrl,
      blocklist_id: blocklistId,
      match_type: matchType,
      distance: Number.isInteger(distance) && distance >= 0 && distance <= 256 ? distance : null,
      source,
    });
    return true;
  }

  // ─── B3 / B6 / seeding: writing the list ───────────────────────────

  /** One validated table row for an entry, or { error }. */
  buildRow(entry) {
    const addedBy = typeof entry?.addedBy === 'string' ? entry.addedBy.trim() : '';
    // ad_id defaults to platform; internal = our SQL row id (it cannot block a newly arriving ad by itself).
    const namespace = entry?.identifierNamespace === undefined
      ? (entry?.entryType === 'ad_id' ? 'platform' : 'none')
      : String(entry.identifierNamespace).trim().toLowerCase();
    if (entry?.entryType === 'ad_id' ? !['internal', 'platform'].includes(namespace) : namespace !== 'none') {
      return { error: 'identifierNamespace must be internal or platform for ad_id, and none for other entry types' };
    }
    let fields;

    if (entry?.entryType === IMAGE_HASH) {
      // value = the image sha256 (lowercase hex) and value_sha256 = sha256(value), the
      // convention the schema script documents for both B1 and B2 writers.
      const sha = typeof entry.imageSha256 === 'string' ? entry.imageSha256.trim().toLowerCase() : '';
      if (!SHA256_HEX.test(sha)) return { error: 'image_hash needs imageSha256 (64 hex characters)' };
      const { phash, error } = parsePhash(entry.imagePhash);
      if (error) return { error };
      const algo = typeof entry.imagePhashAlgo === 'string' ? entry.imagePhashAlgo.trim().toLowerCase() : '';
      if (phash !== null && !PHASH_ALGO.test(algo)) {
        return { error: 'imagePhashAlgo is required with imagePhash (letters, digits, "_" or "-"; up to 16), e.g. sscd-simhash-v1' };
      }
      fields = {
        value: sha,
        value_sha256: sha256Hex(sha),
        image_sha256: sha,
        image_phash: phash,
        image_phash_algo: phash !== null ? algo : null,
      };
    } else {
      const family = TYPE_TO_FAMILY[entry?.entryType];
      const key = family ? normalizeByFamily(family, entry.value) : '';
      if (!key) {
        return { error: family ? 'value is empty or unusable' : `unsupported entryType "${entry?.entryType}"` };
      }
      const value = String(entry.value).trim();
      // A value longer than the column would be cut when stored, and a cut entry never matches.
      if (value.length > VALUE_MAX) return { error: `value is longer than ${VALUE_MAX} characters (the column limit)` };
      fields = {
        value,
        value_sha256: sha256Hex(`${family}:${key}`),
      };
    }

    if (!addedBy) return { error: 'addedBy is required (who is adding this block)' };
    return {
      row: {
        network: String(entry.network || 'all').toLowerCase(),
        entry_type: entry.entryType,
        identifier_namespace: namespace,
        added_by: addedBy,
        reason: entry.reason,
        source: entry.source,
        complaint_id: entry.complaintId,
        expires_at: entry.expiresAt,
        details: entry.details,
        ...fields,
      },
    };
  }

  /**
   * Add entries to the blocklist.
   *
   * entry: { entryType, value, addedBy, identifierNamespace?, network? ('all' or a network slug; default 'all'),
   *          reason?, source?, complaintId?, expiresAt?, details? }
   *   entryType 'image_hash' (B2): { entryType, imageSha256, imagePhash?, imagePhashAlgo?, addedBy, ... }
   *   `value` is not used for image_hash; imagePhash is the 64-hex-character hash and imagePhashAlgo its version.
   * `addedBy` (who is adding the block: a person, script or service) is required:
   * the table column is NOT NULL and the appeal needs the audit trail.
   *
   * 'all' is written, as an 'all' row, into every managed network's database; a
   * specific network is written to that network's database only. Each target
   * database is reported separately so a partial failure is visible and can be
   * re-run (the write is idempotent). Written networks are refreshed at once.
   *
   * Each result lists the entries it wrote WITH their ids in that database, which
   * B3 and B6 store in their run / complaint link tables.
   *
   * @returns {Promise<{ rejected: Array<{entry, reason}>,
   *   results: Array<{ network, ok, count, error?, entries: Array<{entryType, value, valueSha256, blocklistId}> }> }>}
   */
  async add(entries) {
    if (!this.repository) throw new Error('blocklist is not initialised');
    const rejectedEntries = [];
    const perNetwork = new Map();

    for (const entry of entries || []) {
      const { row, error } = this.buildRow(entry);
      if (error) {
        rejectedEntries.push({ entry, reason: error });
        continue;
      }
      const targets = row.network === 'all' ? this.managedNetworks() : [row.network];
      for (const target of targets) {
        if (!perNetwork.has(target)) perNetwork.set(target, []);
        perNetwork.get(target).push(row);
      }
    }

    const results = [];
    for (const [network, rows] of perNetwork) {
      try {
        const sql = this.getSql(network);
        if (!sql) throw new Error('no SQL connection');
        await this.repository.upsertEntries(sql, rows);
        const ids = await this.repository.findIds(sql, rows).catch((err) => {
          throw new Error(`written, but the entry ids could not be read (safe to re-run): ${err.message}`);
        });
        results.push({
          network,
          ok: true,
          count: rows.length,
          entries: rows.map((r) => ({
            entryType: r.entry_type,
            identifierNamespace: r.identifier_namespace,
            value: r.value,
            valueSha256: r.value_sha256,
            blocklistId: ids.get(idKey(r.network, r.entry_type, r.value_sha256, r.identifier_namespace)) ?? null,
          })),
        });
        // Only the new banned images are read again (an add never removes one); see BlocklistCache.
        if (this.cache) await this.cache.refreshNetwork(network, { force: true, images: 'incremental' });
      } catch (err) {
        results.push({ network, ok: false, count: rows.length, error: err.message, entries: [] });
      }
    }
    return { rejected: rejectedEntries, results };
  }

  /**
   * Soft-remove entries (status 'revoked', with who and when). Rows are never
   * deleted. refs: [{ network, blocklistId }] where `network` is the database slug
   * the id lives in (as returned by add()). For B5 (policy reversal) pass
   * `approvedBy`; it is recorded next to `removedBy`.
   *
   * @returns {Promise<{ invalid: Array, results: Array<{network, ok, requested, revoked?, error?}> }>}
   */
  async revoke(refs, { removedBy, approvedBy } = {}) {
    if (!this.repository) throw new Error('blocklist is not initialised');
    const by = typeof removedBy === 'string' ? removedBy.trim() : '';
    if (!by) throw new Error('removedBy is required (who is removing this block)');
    const approver = typeof approvedBy === 'string' ? approvedBy.trim() : '';
    const removedByText = approver ? `${by} (approved by ${approver})` : by;

    const invalid = [];
    const perNetwork = new Map();
    for (const ref of refs || []) {
      const network = typeof ref?.network === 'string' ? ref.network.trim().toLowerCase() : '';
      const blocklistId = Number(ref?.blocklistId);
      if (!network || !Number.isSafeInteger(blocklistId) || blocklistId <= 0) {
        invalid.push({ ref, reason: 'needs a network and a positive integer blocklistId' });
        continue;
      }
      if (!perNetwork.has(network)) perNetwork.set(network, []);
      perNetwork.get(network).push(blocklistId);
    }

    const results = [];
    for (const [network, ids] of perNetwork) {
      try {
        const sql = this.getSql(network);
        if (!sql) throw new Error('no SQL connection');
        const { affected } = await this.repository.revokeEntries(sql, ids, { removedBy: removedByText });
        results.push({ network, ok: true, requested: ids.length, revoked: affected });
        if (this.cache) await this.cache.refreshNetwork(network, { force: true, images: 'full' });
      } catch (err) {
        results.push({ network, ok: false, requested: ids.length, error: err.message });
      }
    }
    return { invalid, results };
  }

  /**
   * Every active entry of a network, read from the database (not the cache), for
   * B6's audits. Rows: { id, entry_type, value }; imageHashes: { id, image_sha256,
   * image_phash (64 hex characters), image_phash_algo }.
   */
  async listActive(network) {
    if (!this.repository) throw new Error('blocklist is not initialised');
    const sql = this.getSql(network);
    if (!sql) throw new Error('no SQL connection');
    const opts = { pageSize: this.config.pageSize };
    const entries = await this.repository.loadActive(sql, network, opts);
    const imageHashes = typeof this.repository.loadImageHashes === 'function'
      ? await this.repository.loadImageHashes(sql, network, opts)
      : [];
    return { entries, imageHashes };
  }

  status() {
    return {
      enabled: this.config.enabled,
      failMode: this.config.failMode,
      networks: this.cache ? this.cache.summary() : {},
      pendingAttempts: this.attempts ? this.attempts.queue.length : 0,
      droppedAttempts: this.attempts ? this.attempts.dropped : 0,
      rejectedAttempts: this.attempts ? this.attempts.rejected || 0 : 0,
    };
  }
}

// ─── The module's single instance and its public functions ───────────────────
//
//   await init()                      start it (once per worker, after the databases connect)
//   guard(ad, network, { source })    B1  null = allowed, otherwise the rejection result  (sync, no DB call)
//   await add(entries)                B3 / B6 / seeding  put entries on the list; each result carries the entries' ids
//   await revoke(refs, opts)          B5 / B2 test cleanup  soft-remove entries by { network, blocklistId }
//   await listActive(network)         B6  every active entry, read from the database (audits)
//   getImageHashes(network)           B2  the banned images in memory: { available, status, hashes }
//   recordAttempt(input)              B2  log a rejection through the same batched writer
//   status()                          per-network state for health / debugging
//   await shutdown()                  stop timers, flush pending attempt rows
//
// Disabled by default (compliance.blocklist.enabled in config.json). When it is enabled
// but could not start at all, the configured failMode applies to every network instead of
// silently letting ads through. add / revoke / listActive do not depend on the enabled
// flag. A script outside the server must connect the databases first, call init(), and
// call shutdown() before it exits. Settings come from src/config/index.js.

let instance = null;
let initFailure = null; // set when enabled but startup crashed
let moduleLog = null;

// Lazy, so requiring this file (e.g. in a unit test) creates no logger.
function getLog() {
  if (!moduleLog) moduleLog = require('../../logger').createChild('blocklist');
  return moduleLog;
}

function getSql(network) {
  return require('../../database/DatabaseManager').getSQL(network);
}

// Settings live in src/config/index.js (compliance.blocklist). If they cannot be
// read the feature stays off: reading config must never stop startup.
function loadConfig() {
  try {
    return require('../../config').compliance?.blocklist || { enabled: false };
  } catch (err) {
    getLog().error('Could not read compliance.blocklist config; blocklist stays disabled', { error: err.message });
    return { enabled: false };
  }
}

async function init(options = {}) {
  if (instance) return instance;
  const log = getLog();
  const config = options.config || loadConfig();

  if (!config.enabled) {
    log.info('Copyright blocklist is disabled (compliance.blocklist.enabled)');
    // No enforcement and no background work, but add / revoke / listActive still work.
    instance = new BlocklistService({ config, repository, getSql, log });
    return instance;
  }

  try {
    const networks = config.networks?.length ? config.networks : defaultNetworks(getSql);
    if (!networks.length) {
      log.warn('Copyright blocklist is enabled but covers no network: none has SQL enabled with an insertion block and a connection, and compliance.blocklist.networks is empty');
    }
    const cache = new BlocklistCache({ repository, getSql, config, log });
    const attempts = new BlockedAttemptLogger({ repository, getSql, config, log });
    instance = new BlocklistService({ config, cache, attempts, repository, getSql, log });
    attempts.start();
    await cache.start(networks);
    log.info('Copyright blocklist started', { failMode: config.failMode, networks: cache.summary() });
  } catch (err) {
    initFailure = { config, error: err };
    log.error('Copyright blocklist failed to start', { error: err.message, stack: err.stack });
  }
  return instance;
}

function guard(ad, network, opts) {
  if (initFailure) {
    // Enabled but not running: never fail silently open unless explicitly configured.
    return initFailure.config.failMode === 'closed'
      ? serverError(initFailure.config.unavailable.code, initFailure.config.unavailable.message)
      : null;
  }
  return instance ? instance.guard(ad, network, opts) : null;
}

function requireInstance() {
  if (!instance) throw new Error('blocklist is not initialised');
  return instance;
}

// async on purpose: "not initialised" is a rejected promise, never a synchronous
// throw, so callers can use either await/try or .catch().
async function add(entries) {
  return requireInstance().add(entries);
}

async function revoke(refs, opts) {
  return requireInstance().revoke(refs, opts);
}

async function listActive(network) {
  return requireInstance().listActive(network);
}

// Metadata match without the insertion side effects (used by copyright verification).
function match(ad, network) {
  return instance && instance.appliesTo(network) ? instance.match(ad, network) : null;
}

function getImageHashes(network) {
  return instance
    ? instance.getImageHashes(network)
    : { available: false, status: 'uninitialised', hashes: [] };
}

function recordAttempt(input) {
  return instance ? instance.recordAttempt(input) : false;
}

function status() {
  if (initFailure) return { enabled: true, failMode: initFailure.config.failMode, startupError: initFailure.error.message };
  return instance ? instance.status() : { enabled: false };
}

async function shutdown() {
  if (!instance) return;
  if (instance.cache) instance.cache.stop();
  if (instance.attempts) await instance.attempts.stop();
}

// Test hook: inject a prepared instance (or null to reset).
function _setServiceForTests(next) {
  instance = next;
  initFailure = null;
}

module.exports = {
  BlocklistService,
  parsePhash,
  defaultNetworks,
  init,
  guard,
  match,
  add,
  revoke,
  listActive,
  getImageHashes,
  recordAttempt,
  status,
  shutdown,
  _setServiceForTests,
};
