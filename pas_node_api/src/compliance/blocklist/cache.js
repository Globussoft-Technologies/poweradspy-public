'use strict';

/**
 * Per-network in-memory blocklist, kept fresh by a background refresh.
 *
 * Startup, per network:
 *   1. load from the network's database                        -> status ready
 *   2. database unreachable: load the last saved copy on disk  -> status from_file
 *   3. neither works                                           -> status unavailable
 *      (the service then applies the configured fail mode)
 *
 * While running, a failed refresh keeps the last good list (status stale) and
 * logs a warning; the next successful refresh returns it to ready. A refresh
 * that returns zero rows after a non-empty list is treated as a failure unless
 * emptyRefreshGuard is off. The matching list (names, ids, URLs, domains) is small and is
 * refreshed in full: a full read also picks up expiries and removals without extra bookkeeping.
 *
 * The banned images (B2) can be many (tens of thousands per advertiser), so they are NOT read in full
 * every time: after the first load only the rows added since (id > last id) are read, every
 * imageRefreshSeconds; a full reload every imageFullReloadSeconds (or after a revoke) picks up
 * removals and expiries. An unchanged list is not rebuilt and not written to disk again.
 */

const fs = require('fs');
const path = require('path');
const { STATUS } = require('./constants');
const { buildSnapshot, buildImageHashes } = require('./match');
const { toHex } = require('../imagematch/matcher');

const SAFE_NAME = /^[a-z0-9_-]+$/i;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** A cheap fingerprint of a list of rows: how many, the newest id and the sum of the ids. */
function signature(rows) {
  let max = 0;
  let sum = 0;
  for (const r of rows) {
    const id = Number(r.id);
    if (id > max) max = id;
    sum += id;
  }
  return `${rows.length}:${max}:${sum}`;
}

class BlocklistCache {
  /**
   * @param {Object} deps
   * @param {Object} deps.repository  { loadActive(sql, network, opts) }
   * @param {(network:string)=>Object|null} deps.getSql
   * @param {Object} deps.config      config.compliance.blocklist (src/config/index.js)
   * @param {Object} deps.log
   */
  constructor({ repository, getSql, config, log }) {
    this.repository = repository;
    this.getSql = getSql;
    this.config = config;
    this.log = log;
    this.states = new Map();
    this.networks = [];
    this.timer = null;
    this.refreshing = false;
  }

  manages(network) {
    return this.states.has(network);
  }

  get(network) {
    return this.states.get(network) || null;
  }

  async start(networks) {
    this.networks = [...networks];
    for (const network of this.networks) {
      this.states.set(network, {
        status: STATUS.UNAVAILABLE,
        snapshot: null,
        loadedAt: null,
        lastError: null,
        imageHashesLoaded: false, // banned image hashes (B2) are loaded separately from the matching list
        imageHashesError: null,
      });
    }
    await Promise.all(this.networks.map((network) => this.refreshNetwork(network)));

    this.timer = setInterval(() => {
      this.refreshAll().catch((err) => this.log.error('blocklist refresh crashed', { error: err.message }));
    }, this.intervalMs());
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  /**
   * This process's refresh period: refreshSeconds plus a random 0..refreshJitterPercent %
   * of it, so the cluster's workers drift apart instead of all reading the same
   * databases in the same second. A missing or invalid percent means no jitter.
   */
  intervalMs() {
    const baseMs = this.config.refreshSeconds * 1000;
    const percent = Number(this.config.refreshJitterPercent);
    const jitter = Number.isFinite(percent) && percent > 0 ? Math.floor(Math.random() * baseMs * (percent / 100)) : 0;
    return baseMs + jitter;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async refreshAll() {
    if (this.refreshing) return; // a slow refresh never overlaps the next one
    this.refreshing = true;
    try {
      await Promise.all(this.networks.map((network) => this.refreshNetwork(network)));
    } finally {
      this.refreshing = false;
    }
  }

  /**
   * @param {string} network
   * @param {{ force?: boolean, images?: ?('incremental'|'full') }} [opts] force: accept an empty result. Used after our
   *        own add / revoke, where removing the last entry is intended. images: 'incremental' reads only the new banned
   *        images (after an add), 'full' reads them all (after a revoke); omitted = decided by the timers.
   */
  async refreshNetwork(network, { force = false, images: imageMode = null } = {}) {
    const state = this.states.get(network);
    if (!state) return;
    try {
      const sql = this.getSql(network);
      if (!sql) throw new Error('no SQL connection');
      const rows = await withTimeout(
        this.repository.loadActive(sql, network, { pageSize: this.config.pageSize }),
        this.config.loadTimeoutMs,
        'blocklist load'
      );

      if (!force && rows.length === 0 && state.snapshot && state.snapshot.count > 0 && this.config.emptyRefreshGuard) {
        throw new Error('refresh returned 0 rows after a non-empty list; keeping the previous list');
      }

      // Banned image hashes for B2: a separate query whose failure is contained,
      // so it can never take the ingestion matching list down with it.
      const previousHashes = state.snapshot?.imageHashes || [];
      const images = await this.loadImageHashes(network, sql, state, imageMode);

      const wasDown = state.status !== STATUS.READY;
      // An unchanged list is not rebuilt (ids never change their value, so the set of ids says it all).
      const mainSig = signature(rows);
      if (!state.snapshot || state.mainSig !== mainSig) {
        state.snapshot = buildSnapshot(rows, { compactMinLength: this.config.compactMinLength });
        state.mainSig = mainSig;
      }
      state.snapshot.imageHashes = images ? images.hashes : previousHashes;
      if (images) state.imageHashesLoaded = true;
      state.status = STATUS.READY;
      state.loadedAt = Date.now();
      state.lastError = null;
      if (wasDown) this.log.info('blocklist loaded', { network, entries: state.snapshot.count, ignored: state.snapshot.ignored });
      // Written to disk only when something changed (the file holds every banned image).
      const savedSig = `${state.mainSig}|${state.imageVersion || 0}`;
      if (savedSig !== state.savedSig && (await this.saveFile(network, rows, state))) state.savedSig = savedSig;
    } catch (err) {
      await this.handleFailure(network, state, err);
    }
  }

  /**
   * How to bring the banned images up to date now: 'full' (read them all), 'incremental' (read the new ones) or 'skip'.
   * Without the image timers in the config every refresh is a full read, as before.
   */
  imageLoadMode(state, requested, now) {
    if (!state.imageHashesLoaded || !state.snapshot || state.imageFullAt == null) return 'full';
    if (requested === 'full') return 'full';
    const every = Number(this.config.imageRefreshSeconds) * 1000;
    if (!(every > 0)) return 'full';
    const fullEvery = Number(this.config.imageFullReloadSeconds) * 1000;
    if (fullEvery > 0 && now - state.imageFullAt >= fullEvery) return 'full';
    if (requested === 'incremental') return 'incremental';
    return now - (state.imageCheckedAt || 0) >= every ? 'incremental' : 'skip';
  }

  /** @returns {Promise<?{ hashes: Array }>} null when there is nothing new to apply, it is unsupported, or the query failed */
  async loadImageHashes(network, sql, state, requested = null) {
    if (typeof this.repository.loadImageHashes !== 'function') return null;
    const now = Date.now();
    const mode = this.imageLoadMode(state, requested, now);
    if (mode === 'skip') return null;
    try {
      const rows = await withTimeout(
        this.repository.loadImageHashes(sql, network, { pageSize: this.config.pageSize, afterId: mode === 'incremental' ? state.imageLastId : 0 }),
        this.config.loadTimeoutMs,
        'image hash load'
      );
      state.imageHashesError = null;
      state.imageCheckedAt = now;
      const previous = state.snapshot?.imageHashes || [];
      const top = rows.reduce((max, r) => (Number(r.id) > max ? Number(r.id) : max), mode === 'incremental' ? state.imageLastId || 0 : 0);
      state.imageLastId = top;

      if (mode === 'incremental') {
        state.imageSig = null; // the next full read compares against nothing, so it counts as a change once
        if (!rows.length) return { hashes: previous }; // same array: the matcher keeps its index
        state.imageVersion = (state.imageVersion || 0) + 1;
        return { hashes: previous.concat(buildImageHashes(rows)) };
      }

      state.imageFullAt = now;
      const sig = signature(rows);
      if (sig === state.imageSig) return { hashes: previous }; // nothing changed: keep the array (and the matcher's index)
      state.imageSig = sig;
      state.imageVersion = (state.imageVersion || 0) + 1;
      return { hashes: buildImageHashes(rows) };
    } catch (err) {
      state.imageHashesError = err.message;
      this.log.warn('could not load the banned image hashes; ingestion matching is unaffected', { network, error: err.message });
      return null;
    }
  }

  async handleFailure(network, state, err) {
    state.lastError = err.message;

    if (state.snapshot) {
      if (state.status === STATUS.READY) state.status = STATUS.STALE;
      this.log.warn('blocklist refresh failed; using the last good list', { network, status: state.status, error: err.message });
      return;
    }

    const saved = await this.loadFile(network);
    if (saved) {
      state.snapshot = buildSnapshot(saved.rows, { compactMinLength: this.config.compactMinLength });
      state.snapshot.imageHashes = saved.imageHashes;
      state.imageHashesLoaded = saved.imageHashesLoaded;
      state.status = STATUS.FROM_FILE;
      state.loadedAt = saved.savedAt;
      this.log.warn('blocklist database unreachable; started from the saved copy on disk', {
        network, entries: state.snapshot.count, savedAt: new Date(saved.savedAt).toISOString(), error: err.message,
      });
      return;
    }

    state.status = STATUS.UNAVAILABLE;
    this.log.error('blocklist could not be loaded and no saved copy exists', { network, error: err.message });
  }

  // ─── Saved copy on disk ─────────────────────────────────────────────

  filePath(network) {
    if (!SAFE_NAME.test(network)) return null;
    return path.join(this.config.snapshot.dir, `blocklist-${network}.json`);
  }

  /** @returns {Promise<boolean>} true when the copy was written */
  async saveFile(network, rows, state) {
    if (!this.config.snapshot.enabled) return false;
    const file = this.filePath(network);
    if (!file) return false;
    try {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      const body = JSON.stringify({
        network,
        savedAt: Date.now(),
        rows: rows.map((r) => ({ id: r.id, entry_type: r.entry_type, value: r.value, identifier_namespace: r.identifier_namespace })),
        // A typed array is not useful as JSON: the 256-bit perceptual hash is saved as its 64 hex characters.
        imageHashesLoaded: Boolean(state?.imageHashesLoaded),
        imageHashes: (state?.snapshot?.imageHashes || []).map((h) => ({
          id: h.id, sha256: h.sha256, phash: h.phash ? toHex(h.phash) : null, algo: h.algo,
        })),
      });
      await fs.promises.writeFile(tmp, body, 'utf8');
      await fs.promises.rename(tmp, file); // atomic swap: a reader never sees a half-written file
      return true;
    } catch (err) {
      this.log.warn('could not save the blocklist copy to disk', { network, error: err.message });
      return false;
    }
  }

  async loadFile(network) {
    if (!this.config.snapshot.enabled) return null;
    const file = this.filePath(network);
    if (!file) return null;
    try {
      const parsed = JSON.parse(await fs.promises.readFile(file, 'utf8'));
      if (!parsed || parsed.network !== network || !Array.isArray(parsed.rows)) return null;
      // An old snapshot without namespaces cannot safely distinguish equal-looking IDs.
      if (parsed.rows.some((row) => row.entry_type === 'ad_id' && !['internal', 'platform'].includes(row.identifier_namespace))) return null;
      const stored = Array.isArray(parsed.imageHashes) ? parsed.imageHashes : [];
      return {
        rows: parsed.rows,
        savedAt: Number(parsed.savedAt) || Date.now(),
        imageHashesLoaded: parsed.imageHashesLoaded === true,
        imageHashes: buildImageHashes(stored.map((h) => ({
          id: h?.id, image_sha256: h?.sha256, image_phash: h?.phash, image_phash_algo: h?.algo,
        }))),
      };
    } catch {
      return null;
    }
  }

  /** Per-network summary for health / debugging. */
  summary() {
    const out = {};
    for (const [network, s] of this.states) {
      out[network] = {
        status: s.status,
        entries: s.snapshot ? s.snapshot.count : 0,
        loadedAt: s.loadedAt ? new Date(s.loadedAt).toISOString() : null,
        lastError: s.lastError,
        imageHashes: s.snapshot?.imageHashes ? s.snapshot.imageHashes.length : 0,
        imageHashesLoaded: Boolean(s.imageHashesLoaded),
        imageHashesError: s.imageHashesError || null,
      };
    }
    return out;
  }
}

module.exports = { BlocklistCache };
