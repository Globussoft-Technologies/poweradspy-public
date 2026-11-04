'use strict';

/**
 * Hashes the images of a blocked advertiser and adds them to the blocklist as image_hash entries,
 * so an altered copy of one of those images is caught later (see matcher.js).
 *
 *   advertiser name(s) / owner id(s)
 *     -> the owner rows (indexed lookup)
 *     -> the owner's ads, one small page at a time (keyset on the ad id)
 *     -> the stored image of each ad (a CDN URL, built by sources.js)
 *     -> the image-hashing service (one call per image, a few at a time)
 *     -> blocklist.add({ entryType: 'image_hash', ... }), batched, idempotent
 *
 * It is written to be gentle with a production database: only index lookups with a LIMIT, pages
 * of `pageSize` ads with a pause between them, a cap on the number of images, and a checkpoint
 * file so a stopped run continues where it stopped. It reads the ad tables and writes only to the
 * blocklist table, and only when run with apply: true. Without apply it reads the owners and one
 * small sample page and makes no call to the hashing service and no write.
 *
 * Nothing is thrown for an expected problem: run() resolves to a summary whose `status` says how
 * it ended (see STATUS).
 */

const crypto = require('crypto');
const repo = require('./sources'); // table queries, name spellings and image URLs
const { nameCandidates, toFetchableUrl } = repo;
const { OUTCOME } = require('./client');
const { normalizeUrl, normalizeDomain } = require('../blocklist/normalize');

// Blocklist entry types a job can start from. advertiser / page: the owner's ads. ad_id: that one ad. url / image_url: see urlRole().
const URL_TYPES = new Set(['url', 'image_url']);
const MEDIA_FILE = /\.(jpe?g|png|webp|gif|bmp|avif|heic|tiff?|mp4|mov|m4v|webm|mkv|avi|m3u8)$/i;

/**
 * What a URL block points at. An image_url entry, or a URL ending in an image / video file name, is MEDIA; anything else is a DESTINATION
 * (landing page). B1 matches both through one family, so the entry type alone does not say which it is.
 */
function urlRole(type, value) {
  if (type === 'image_url') return 'media';
  const path = String(value || '').split('#')[0].split('?')[0];
  return MEDIA_FILE.test(path) ? 'media' : 'destination';
}

const slotHash = (stored) => crypto.createHash('sha1').update(String(stored ?? '')).digest('hex');

const STATUS = Object.freeze({
  DONE: 'done',
  DRY_RUN: 'dry_run',
  NO_OWNER: 'no_owner',
  TOO_MANY_OWNERS: 'too_many_owners',
  NOT_CONFIGURED: 'not_configured',
  SERVICE_NOT_READY: 'service_not_ready',
  HASH_VERSION_MISMATCH: 'hash_version_mismatch',
  UNAUTHORIZED: 'unauthorized',
  SERVICE_UNAVAILABLE: 'service_unavailable',
  DATABASE_WRITE_FAILED: 'database_write_failed',
  LIMIT_REACHED: 'limit_reached',
  UNRESOLVED: 'unresolved', // the ads of a URL block could not be established: B3 must not treat the job as covering them
  STOPPED: 'stopped',
  JOB_EXISTS: 'job_exists',
  NO_CHECKPOINT: 'no_checkpoint',
  INVALID_INPUT: 'invalid_input',
});

const DEFAULTS = Object.freeze({
  pageSize: 200,
  pageDelayMs: 200,
  maxImages: 10000,
  includeCarousel: false,
  maxConsecutiveFailures: 20,
  addBatchSize: 200,
  maxOwners: 20,
  sampleAds: 20,
  maxUrlAds: 20000,   // a destination URL's ads are found through its host: more ads than this on one host and the URL is unresolved
  urlPageSize: 500,
});

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const emptyStats = () => ({ ads: 0, imagesFound: 0, requested: 0, hashed: 0, duplicates: 0, skipped: {}, failed: 0, added: 0, rejectedByAdd: 0 });

function bump(map, key) {
  map[key] = (map[key] || 0) + 1;
}

class HashJob {
  /**
   * @param {Object} deps
   * @param {string} deps.network
   * @param {Object} deps.source     table map from sources.js
   * @param {Object} deps.sql        the network's SQL connection ({ query(text, params) })
   * @param {Object} deps.client     ImageHashClient
   * @param {Object} deps.blocklist  { add(entries) } (a BlocklistService)
   * @param {string} deps.cdnBase    config cdn.baseUrl
   * @param {string} deps.hashVersion expected hash version, e.g. sscd-simhash-v1
   * @param {Object} [deps.config]   overrides of DEFAULTS
   * @param {Object} [deps.checkpoint] FileCheckpoint
   * @param {Object} [deps.results]  { record(rows) }: what happened to each image (copyright_image_hash_results); a failing sink never fails the job
   * @param {Object} [deps.log]
   * @param {(ms:number)=>Promise} [deps.sleep]
   */
  constructor({ network, source, sql, client, blocklist, cdnBase, hashVersion, config, checkpoint, results, log, sleep }) {
    this.results = results || null;
    this.network = network;
    this.source = source;
    this.sql = sql;
    this.client = client;
    this.blocklist = blocklist;
    this.cdnBase = cdnBase;
    this.hashVersion = hashVersion;
    this.config = { ...DEFAULTS, ...(config || {}) };
    this.checkpoint = checkpoint || null;
    this.log = log || { info() {}, warn() {}, error() {} };
    this.sleep = sleep || defaultSleep;
    this.stopRequested = false;
  }

  /** Ask the run to stop after the page it is on (for Ctrl+C). The checkpoint keeps its place. */
  requestStop() {
    this.stopRequested = true;
  }

  // ── reading ──────────────────────────────────────────────────────────

  /** The owner rows for the given names (and their usual spellings) and ids: [{ id, name, adsCount }]. */
  async findOwners({ names = [], ownerIds = [] } = {}) {
    const found = new Map();
    const candidates = nameCandidates(names);
    const rows = [
      ...(candidates.length ? await repo.findOwners(this.sql, this.source, candidates) : []),
      ...(ownerIds.length ? await repo.ownersByIds(this.sql, this.source, ownerIds) : []),
    ];
    for (const r of rows) {
      if (!found.has(String(r.id))) found.set(String(r.id), { id: r.id, name: r.name, adsCount: Number(r.ads_count) || 0 });
    }
    return [...found.values()];
  }

  /** The images of some ads as [{ adId, stored, url }]; images with no stored file or no usable URL are counted and left out. */
  async imagesOf(adIds, stats, dropped = null) {
    const rows = await repo.variantImages(this.sql, this.source, adIds);
    if (this.config.includeCarousel) rows.push(...await repo.carouselImages(this.sql, this.source, adIds));
    const out = [];
    const drop = (r, stored, reason) => {
      bump(stats.skipped, reason);
      if (dropped) dropped.push({ adId: r.ad_id, stored, reason });
    };
    for (const r of rows) {
      const stored = typeof r.image_url === 'string' ? r.image_url.trim() : '';
      if (!stored || /DefaultImage/i.test(stored)) {
        drop(r, stored, 'no stored image');
        continue;
      }
      const url = toFetchableUrl(stored, this.cdnBase);
      if (!url) {
        drop(r, stored, 'no usable url');
        continue;
      }
      if (!repo.hasImageExtension(url)) {
        drop(r, stored, 'not an image file');
        continue;
      }
      out.push({ adId: r.ad_id, stored, url });
    }
    return out;
  }

  // ── what a job starts from: advertiser / page (the owner's ads), one ad id, or a URL ──

  /** The one ad with this platform ad id (or the few, if the platform id repeats). */
  async ownersOfAdId(value, namespace = 'platform') {
    const id = String(value || '').trim();
    let ids;
    if (namespace === 'internal') {
      // Do not let MySQL coerce malformed or imprecise IDs into another ad.
      if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || String(Number(id)) !== id) throw new Error('invalid internal ad ID');
      const found = await repo.platformIds(this.sql, this.source, [id]);
      ids = found.has(id) ? [Number(id)] : [];
    } else if (namespace === 'platform') {
      ids = await repo.adIdsByPlatformId(this.sql, this.source, [id]);
    } else {
      throw new Error('invalid ad ID namespace');
    }
    return ids.length ? [{ id: `ad_id:${value}`, name: String(value), adsCount: ids.length, fixedAdIds: ids.map(Number) }] : [];
  }

  /**
   * The ads of a URL block. A DESTINATION URL is searched through its host: the domain index -> the ads of that domain (domain_id
   * index) -> their destination_url by primary key, compared in the application with the same normalization B1 uses. No scan: the
   * ad tables have no index on destination_url / image_url / image_url_original. A MEDIA URL has no such path: its ads cannot be found,
   * so the job hashes the URL itself and reports the ads as unresolved.
   * @returns {Promise<{ role, owners?, status?, message? }>} status is set when the URL cannot be resolved
   */
  async ownersOfUrl(entry) {
    const value = String(entry.value || '').trim();
    const role = urlRole(entry.type, value);
    if (role === 'media') return { role, owners: [] };
    const host = normalizeDomain(value);
    const want = normalizeUrl(value);
    if (!host || !want) return { role, status: STATUS.UNRESOLVED, message: 'the URL has no usable host' };

    const domainRowIds = await repo.domainIds(this.sql, this.source, [host, `www.${host}`]);
    if (!domainRowIds.length) {
      return { role, status: STATUS.UNRESOLVED, message: 'no ad has this host as its destination: the URL may be a media URL or a destination that was never stored' };
    }
    const matched = [];
    let after = 0;
    let scanned = 0;
    for (;;) {
      if (this.stopRequested) return { role, status: STATUS.STOPPED };
      const ids = await repo.adIdsByDomainPage(this.sql, this.source, domainRowIds, after, this.config.urlPageSize);
      if (!ids.length) break;
      after = ids[ids.length - 1];
      scanned += ids.length;
      for (const r of await repo.destinationUrls(this.sql, this.source, ids)) {
        if (normalizeUrl(r.destination_url) === want) matched.push(Number(r.ad_id));
      }
      if (scanned >= this.config.maxUrlAds && ids.length === this.config.urlPageSize) {
        return { role, status: STATUS.UNRESOLVED, message: `this host has more than ${this.config.maxUrlAds} ads: its ads were not all checked` };
      }
      if (ids.length < this.config.urlPageSize) break;
    }
    matched.sort((a, b) => a - b);
    return { role, owners: matched.length ? [{ id: `url:${want}`, name: value, adsCount: matched.length, fixedAdIds: matched }] : [] };
  }

  /** A page of an owner's ad ids: from the list a URL / ad id fixed, or from the owner's ads. */
  async pageOf(owner, afterId, size = this.config.pageSize) {
    if (Array.isArray(owner.fixedAdIds)) return owner.fixedAdIds.filter((id) => id > (afterId ?? 0)).slice(0, size);
    return repo.adIdsPage(this.sql, this.source, owner.id, afterId, size);
  }

  /** Tell the results sink what happened to images. Never throws: losing a result must not fail the hashing. */
  async recordResults(rows) {
    if (!this.results || !rows.length) return;
    try {
      await this.results.record(rows);
    } catch (err) {
      this.log.warn('could not record the image results', { error: err.message });
    }
  }

  /** Dry run: the owners, and the images of the first page of ads of each, without hashing or writing. */
  async preview(owners) {
    const sample = [];
    for (const owner of owners.slice(0, 3)) {
      const adIds = await this.pageOf(owner, 0, this.config.sampleAds);
      const stats = emptyStats();
      const images = await this.imagesOf(adIds, stats);
      sample.push({ ownerId: owner.id, ownerName: owner.name, adsInSample: adIds.length, images: images.slice(0, 10), skipped: stats.skipped });
    }
    return sample;
  }

  // ── the run ──────────────────────────────────────────────────────────

  async run({ names = [], ownerIds = [], apply = false, jobId, resume = false, addedBy, reason, complaintId, entry = null, generation = 1 } = {}) {
    const summary = (status, extra = {}) => ({ status, network: this.network, jobId: jobId || null, ...extra });

    const isAd = Boolean(entry) && entry.type === 'ad_id';
    const isUrl = Boolean(entry) && URL_TYPES.has(entry.type);
    if (!isAd && !isUrl && !names.length && !ownerIds.length) return summary(STATUS.INVALID_INPUT, { message: 'give at least one advertiser name or owner id' });

    let owners;
    let role = null;
    try {
      if (isAd) {
        owners = await this.ownersOfAdId(entry.value, entry.identifierNamespace || 'platform');
      } else if (isUrl) {
        const found = await this.ownersOfUrl(entry);
        role = found.role;
        if (found.status) return summary(found.status, { role, message: found.message });
        owners = found.owners;
      } else {
        owners = await this.findOwners({ names, ownerIds });
      }
    } catch (err) {
      return summary(STATUS.INVALID_INPUT, { message: `could not read the owners: ${err.message}` });
    }
    if (!owners.length && role !== 'media') {
      return summary(STATUS.NO_OWNER, { message: isAd ? 'no ad has this ad id' : isUrl ? 'no ad has this destination URL' : 'no advertiser matches those names / ids', triedNames: isAd || isUrl ? undefined : nameCandidates(names) });
    }
    if (owners.length > this.config.maxOwners) {
      return summary(STATUS.TOO_MANY_OWNERS, { owners, message: `${owners.length} owners match; limit is ${this.config.maxOwners}. Narrow the names or pass owner ids.` });
    }

    if (!apply) return summary(STATUS.DRY_RUN, { owners, sample: await this.preview(owners) });

    const by = typeof addedBy === 'string' ? addedBy.trim() : '';
    if (!by) return summary(STATUS.INVALID_INPUT, { message: 'addedBy is required to write entries' });
    if (!jobId) return summary(STATUS.INVALID_INPUT, { message: 'a job id is required to write entries (it names the checkpoint file)' });
    if (!this.client.isConfigured()) return summary(STATUS.NOT_CONFIGURED, { message: 'the image-hashing service needs its address and IMAGE_HASH_API_KEY' });

    const health = await this.client.health();
    if (!health.ok || !health.ready) return summary(STATUS.SERVICE_NOT_READY, { message: 'the image-hashing service is not ready' });
    if (health.hashVersion !== this.hashVersion) {
      return summary(STATUS.HASH_VERSION_MISMATCH, { message: `the service makes "${health.hashVersion}" hashes, expected "${this.hashVersion}"` });
    }

    // Resume from the checkpoint, or start a new one (never overwrite an existing job by accident).
    let state = this.checkpoint ? await this.checkpoint.load(jobId) : null;
    if (state && !resume) return summary(STATUS.JOB_EXISTS, { message: `job "${jobId}" already exists; resume it or use another job id` });
    if (!state && resume) return summary(STATUS.NO_CHECKPOINT, { message: `no saved job "${jobId}" to resume` });
    if (!state) {
      state = {
        jobId, network: this.network, hashVersion: this.hashVersion, startedAt: new Date().toISOString(), status: 'running',
        owners: Object.fromEntries(owners.map((o) => [String(o.id), { name: o.name, lastAdId: 0, done: false }])), stats: emptyStats(),
      };
    }
    const stats = { ...emptyStats(), ...state.stats, skipped: { ...(state.stats?.skipped || {}) } };
    const ctx = { by, reason, complaintId, jobId, generation, stats, state, seenUrls: new Map(), seenSha: new Set(), consecutiveFailures: 0 };

    const started = Date.now();
    let status = STATUS.DONE;
    if (role === 'media') {
      // A media URL: hash the file itself (so a copy of it is caught from now on), but the ads that use it cannot be found.
      await this.hashMediaUrl(entry, ctx);
      await this.save(state, stats, STATUS.UNRESOLVED);
      return summary(STATUS.UNRESOLVED, { role, stats, message: 'media URL: the file was hashed, but the ads that use it cannot be searched (no index on the image columns)', elapsedMs: Date.now() - started });
    }
    outer:
    for (const owner of owners) {
      const key = String(owner.id);
      const progress = state.owners[key] || (state.owners[key] = { name: owner.name, lastAdId: 0, done: false });
      while (!progress.done) {
        if (this.stopRequested) { status = STATUS.STOPPED; break outer; }
        if (stats.requested >= this.config.maxImages) { status = STATUS.LIMIT_REACHED; break outer; }

        const adIds = await this.pageOf(owner, progress.lastAdId);
        if (!adIds.length) { progress.done = true; break; }

        const page = await this.processPage(owner, adIds, ctx);
        if (page.abort) { status = page.abort; break outer; }
        if (page.partial) { status = STATUS.LIMIT_REACHED; break outer; } // the page is repeated on resume

        progress.lastAdId = adIds[adIds.length - 1];
        if (adIds.length < this.config.pageSize) progress.done = true;
        await this.save(state, stats, 'running');
        if (!progress.done && this.config.pageDelayMs > 0) await this.sleep(this.config.pageDelayMs);
      }
    }

    await this.save(state, stats, status);
    return summary(status, { owners, stats, elapsedMs: Date.now() - started });
  }

  async save(state, stats, status) {
    state.stats = stats;
    state.status = status;
    if (this.checkpoint) await this.checkpoint.save(state.jobId, state);
  }

  /** Hash the images of one page of ads and add the new ones to the blocklist. Returns { abort?, partial? }. */
  async processPage(owner, adIds, ctx) {
    const { stats } = ctx;
    stats.ads += adIds.length;
    const platform = await repo.platformIds(this.sql, this.source, adIds);

    // One result per image looked at (copyright_image_hash_results): hashed / duplicate / skipped / failed, and why.
    const outcomes = [];
    const note = (img, outcome, reason, sha256) => {
      outcomes.push({ adId: img.adId, platformAdId: platform.get(String(img.adId)) ?? null, sourceUrl: img.stored, outcome, reason: reason || '', sha256: sha256 || null });
    };

    const dropped = [];
    const fresh = [];
    const repeats = [];
    for (const img of await this.imagesOf(adIds, stats, dropped)) {
      stats.imagesFound += 1;
      if (ctx.seenUrls.has(img.url)) { stats.duplicates += 1; repeats.push(img); continue; }
      ctx.seenUrls.set(img.url, null);
      fresh.push(img);
    }
    for (const d of dropped) note(d, 'skipped', d.reason);

    const room = Math.max(this.config.maxImages - stats.requested, 0);
    const batch = fresh.length > room ? fresh.slice(0, room) : fresh;
    const partial = batch.length < fresh.length;
    stats.requested += batch.length;

    const results = await Promise.all(batch.map((img) => this.client.hashUrl(img.url)));
    const entries = [];
    let abort = null;
    results.forEach((result, i) => {
      const img = batch[i];
      if (abort) return;
      if (result.ok) {
        ctx.consecutiveFailures = 0;
        stats.hashed += 1;
        ctx.seenUrls.set(img.url, { outcome: 'hashed', reason: '', sha256: result.sha256 });
        if (ctx.seenSha.has(result.sha256)) { stats.duplicates += 1; note(img, 'duplicate', 'the same image as another URL of this run', result.sha256); return; }
        ctx.seenSha.add(result.sha256);
        note(img, 'hashed', '', result.sha256);
        entries.push(this.entryFor(img, owner, result, ctx, platform));
        return;
      }
      switch (result.outcome) {
        case OUTCOME.SKIP: {
          const why = String(result.reason || 'skipped').toLowerCase().slice(0, 60);
          bump(stats.skipped, why);
          ctx.consecutiveFailures = 0;
          ctx.seenUrls.set(img.url, { outcome: 'skipped', reason: why, sha256: null });
          note(img, 'skipped', why);
          break;
        }
        case OUTCOME.UNAUTHORIZED: abort = STATUS.UNAUTHORIZED; break;
        case OUTCOME.NOT_CONFIGURED: abort = STATUS.NOT_CONFIGURED; break;
        default: {
          stats.failed += 1;
          ctx.consecutiveFailures += 1;
          const why = `${result.outcome || 'failed'}: ${result.reason || ''}`.toLowerCase().slice(0, 120);
          ctx.seenUrls.set(img.url, { outcome: 'failed', reason: why, sha256: null });
          note(img, 'failed', why);
          if (ctx.consecutiveFailures >= this.config.maxConsecutiveFailures) abort = STATUS.SERVICE_UNAVAILABLE;
        }
      }
    });
    // An image whose URL repeats one already looked at (another ad, or earlier in this run) has the same outcome as the first.
    if (!abort) {
      for (const img of repeats) {
        const first = ctx.seenUrls.get(img.url);
        if (first && first.outcome === 'hashed') note(img, 'duplicate', 'the same image URL as an earlier ad of this run', first.sha256);
        else if (first) note(img, first.outcome, first.reason);
      }
    }

    // Entries that were hashed are valid whatever happened to the rest of the page: write them.
    const written = await this.writeEntries(entries, stats);
    if (!written) return { abort: STATUS.DATABASE_WRITE_FAILED };
    await this.recordResults(outcomes);
    return { abort, partial };
  }

  /** A media URL block: hash the file at the URL and add its hash to the blocklist. Its ads are not searched (see ownersOfUrl). */
  async hashMediaUrl(entry, ctx) {
    const raw = String(entry.value || '').trim();
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const row = (outcome, reason, sha256) => this.recordResults([{ adId: '', platformAdId: null, sourceUrl: raw, outcome, reason: reason || '', sha256: sha256 || null }]);
    ctx.stats.requested += 1;
    if (!repo.hasImageExtension(url)) { bump(ctx.stats.skipped, 'not an image file'); await row('skipped', 'not an image file'); return; }
    const result = await this.client.hashUrl(url);
    if (!result.ok) {
      if (result.outcome === OUTCOME.SKIP) {
        const why = String(result.reason || 'skipped').toLowerCase().slice(0, 60);
        bump(ctx.stats.skipped, why);
        await row('skipped', why);
      } else {
        ctx.stats.failed += 1;
        await row('failed', `${result.outcome || 'failed'}: ${result.reason || ''}`.toLowerCase().slice(0, 120));
      }
      return;
    }
    ctx.stats.hashed += 1;
    await this.writeEntries([{
      entryType: 'image_hash', imageSha256: result.sha256, imagePhash: result.sscdHash, imagePhashAlgo: this.hashVersion, network: this.network,
      addedBy: ctx.by, reason: ctx.reason, complaintId: ctx.complaintId, source: 'imagematch:job',
      details: JSON.stringify({ job: ctx.jobId, media_url: raw }),
    }], ctx.stats);
    await row('hashed', '', result.sha256);
  }

  entryFor(img, owner, result, ctx, platform) {
    return {
      entryType: 'image_hash',
      imageSha256: result.sha256,
      imagePhash: result.sscdHash,
      imagePhashAlgo: this.hashVersion,
      network: this.network,
      addedBy: ctx.by,
      reason: ctx.reason,
      complaintId: ctx.complaintId,
      source: 'imagematch:job',
      // Where this image came from, for takedown (B3) and audit (B6): identifiers only, no image data.
      // ad_id is the platform's (scraper's) ad id; internal_ad_id is our own row id.
      details: JSON.stringify({ job: ctx.jobId, owner_id: owner.id, ad_id: platform.get(String(img.adId)) ?? null, internal_ad_id: img.adId, image_url: img.stored }),
    };
  }

  /** Add entries in batches. Returns false when the database could not be written (the run stops). */
  async writeEntries(entries, stats) {
    for (let i = 0; i < entries.length; i += this.config.addBatchSize) {
      let out;
      try {
        out = await this.blocklist.add(entries.slice(i, i + this.config.addBatchSize));
      } catch (err) {
        this.log.error('could not write image hashes to the blocklist', { error: err.message });
        return false;
      }
      stats.rejectedByAdd += out.rejected.length;
      if (out.rejected.length) this.log.warn('some image hashes were refused by the blocklist', { count: out.rejected.length, first: out.rejected[0]?.reason });
      const failed = out.results.find((r) => !r.ok);
      if (failed) {
        this.log.error('could not write image hashes to the blocklist', { network: failed.network, error: failed.error });
        return false;
      }
      stats.added += out.results.reduce((n, r) => n + (r.count || 0), 0);
    }
    return true;
  }
}

module.exports = { HashJob, STATUS, DEFAULTS, urlRole, slotHash, URL_TYPES };
