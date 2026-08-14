'use strict';

/**
 * Durable load-shedding queue for large domain-registration-date ES updates.
 *
 * API requests persist jobs and return immediately. One worker drains each network
 * sequentially, while a MySQL advisory lock prevents another API process from
 * draining the same network at the same time. Each ES task is throttled and must
 * complete before the next chunk or domain is submitted.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../../../config');
const logger = require('../../../logger');
const serviceRegistry = require('../../ServiceRegistry');
const { DOMAIN_TABLES } = require('./domainTables');

const log = logger.createChild('domain-date-es-queue');
const queueConfig = config.domainDateUpdate || {};

const ES_TERMS_CHUNK = queueConfig.esTermsChunkSize ?? 10000;
const ES_REQUESTS_PER_SECOND = queueConfig.esRequestsPerSecond ?? 250;
const ES_REQUEST_TIMEOUT_MS = queueConfig.esRequestTimeoutMs ?? 10000;
const ES_TASK_POLL_INTERVAL_MS = queueConfig.esTaskPollIntervalMs ?? 5000;
const ES_QUEUE_SWEEP_INTERVAL_MS = queueConfig.esQueueSweepIntervalMs ?? 5000;
const ES_QUEUE_MAX_PENDING_JOBS = queueConfig.esQueueMaxPendingJobs ?? 5000;
const ES_QUEUE_MAX_SIZE_BYTES = (queueConfig.esQueueMaxSizeMb ?? 512) * 1024 * 1024;
const ES_QUEUE_MIN_FREE_BYTES = (queueConfig.esQueueMinFreeDiskMb ?? 2048) * 1024 * 1024;
const ES_QUEUE_MAX_ATTEMPTS = queueConfig.esQueueMaxAttempts ?? 10;

const apiRoot = path.resolve(__dirname, '../../../..');
const configuredQueueRoot = config.localCache?.dir || 'data';
const queueRoot = path.isAbsolute(configuredQueueRoot)
  ? configuredQueueRoot
  : path.resolve(apiRoot, configuredQueueRoot);
const PENDING_DIR = path.join(queueRoot, 'domain-date-es-pending');
const FAILED_DIR = path.join(PENDING_DIR, 'failed');
const BACKOFF_STEP_MS = 30 * 1000;
const BACKOFF_MAX_MS = 10 * 60 * 1000;
const LOCK_PREFIX = 'pas:domain-date-es:';

let seq = 0;
let scanning = false;
let workerTimer = null;
const activeNetworks = new Set();

function uniqueId() {
  seq = (seq + 1) % 1e6;
  return `${process.pid}_${Date.now()}_${seq}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function jobPath(id) {
  return path.join(PENDING_DIR, `${id}.json`);
}

function persistJob(filePath, job, serializedJob = null) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tempPath, serializedJob || JSON.stringify(job));
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch { /* best-effort temp cleanup */ }
    throw error;
  }
}

function readJob(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function responseBody(response) {
  return response?.body || response || {};
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ymdToEpochSeconds(date) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
}

function chunkAt(items, size, chunkIndex) {
  const start = chunkIndex * size;
  return items.slice(start, start + size);
}

function taskFailure(message, details) {
  const error = new Error(message);
  error.taskCompleted = true;
  error.details = details;
  return error;
}

function canonicalFingerprintValues(values) {
  return [...new Set(values.map((value) => `${typeof value}:${String(value)}`))].sort();
}

function jobFingerprint({ network, date, matchIds, domainRowIds = [] }) {
  return crypto.createHash('sha256').update(JSON.stringify({
    network,
    date,
    matchIds: canonicalFingerprintValues(matchIds),
    domainRowIds: canonicalFingerprintValues(domainRowIds),
  })).digest('hex');
}

function findEquivalentPendingJob(fingerprint) {
  if (!fs.existsSync(PENDING_DIR)) return null;

  // Fingerprints are embedded in new queue filenames, so retries do not parse
  // every potentially large job file while handling an API request.
  const prefix = `${fingerprint.slice(0, 32)}_`;
  const candidates = fs.readdirSync(PENDING_DIR)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.json'));
  for (const file of candidates) {
    try {
      const job = readJob(path.join(PENDING_DIR, file));
      if (job.fingerprint === fingerprint) return job;
    } catch {
      // The worker owns invalid-file handling; admission may create a repair job.
    }
  }
  return null;
}

/** Reject ES responses that completed without processing every conflict-free batch. */
function assertEsUpdateComplete(result) {
  const response = result || {};
  const failures = Array.isArray(response.failures)
    ? response.failures
    : (Array.isArray(response.bulk_failures) ? response.bulk_failures : []);
  const searchFailures = Array.isArray(response.search_failures) ? response.search_failures : [];
  const versionConflicts = Number(response.version_conflicts ?? response.versionConflicts ?? 0);
  const timedOut = response.timed_out === true;
  const malformed = typeof response.updated !== 'number';

  if (!malformed && !timedOut && versionConflicts === 0 && failures.length === 0 && searchFailures.length === 0) {
    return response;
  }

  const error = taskFailure('Elasticsearch domain-date update completed partially', {
    timed_out: timedOut,
    malformed_response: malformed,
    version_conflicts: versionConflicts,
    bulk_failures: failures,
    search_failures: searchFailures,
  });
  error.code = 'ES_UPDATE_INCOMPLETE';
  throw error;
}

function queueUsage() {
  const usage = { pendingJobs: 0, totalBytes: 0 };
  if (!fs.existsSync(PENDING_DIR)) return usage;

  const inspect = (dir, countPending) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        inspect(entryPath, false);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        if (countPending) usage.pendingJobs += 1;
        try { usage.totalBytes += fs.statSync(entryPath).size; } catch { /* file changed during scan */ }
      }
    }
  };

  inspect(PENDING_DIR, true);
  return usage;
}

function hasQueueCapacity(jobBytes, network, matchedAds) {
  const usage = queueUsage();
  if (usage.pendingJobs >= ES_QUEUE_MAX_PENDING_JOBS) {
    log.error('domain date ES enqueue rejected: pending job limit reached', {
      network,
      matched_ads: matchedAds,
      pending_jobs: usage.pendingJobs,
      max_pending_jobs: ES_QUEUE_MAX_PENDING_JOBS,
    });
    return false;
  }
  if (usage.totalBytes + jobBytes > ES_QUEUE_MAX_SIZE_BYTES) {
    log.error('domain date ES enqueue rejected: queue size limit reached', {
      network,
      matched_ads: matchedAds,
      queue_bytes: usage.totalBytes,
      job_bytes: jobBytes,
      max_queue_bytes: ES_QUEUE_MAX_SIZE_BYTES,
    });
    return false;
  }

  try {
    const stats = fs.statfsSync(PENDING_DIR);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    if (freeBytes - jobBytes < ES_QUEUE_MIN_FREE_BYTES) {
      log.error('domain date ES enqueue rejected: insufficient free disk', {
        network,
        matched_ads: matchedAds,
        free_bytes: freeBytes,
        min_free_bytes: ES_QUEUE_MIN_FREE_BYTES,
      });
      return false;
    }
  } catch {
    // Queue count and size limits still protect platforms without statfs support.
  }
  return true;
}

/** Persist an ES propagation job before reporting the SQL-first API request complete. */
function enqueueDomainDateEsUpdate({ network, date, matchIds, domainRowIds = [] }) {
  if (!DOMAIN_TABLES[network] || !date || !Array.isArray(matchIds) || matchIds.length === 0) {
    return null;
  }

  try {
    ensureDir(PENDING_DIR);
    const fingerprint = jobFingerprint({ network, date, matchIds, domainRowIds });
    const existing = findEquivalentPendingJob(fingerprint);
    if (existing) {
      log.info('domain date ES enqueue reused pending job', {
        queue_id: existing.id,
        network,
        matched_ads: matchIds.length,
      });
      return { id: existing.id, queuedAt: existing.createdAt, duplicate: true };
    }

    const id = `${fingerprint.slice(0, 32)}_${uniqueId()}`;
    const now = Date.now();
    const job = {
      schemaVersion: 2,
      id,
      fingerprint,
      network,
      date,
      matchIds,
      domainRowIds: Array.isArray(domainRowIds) ? [...new Set(domainRowIds)] : [],
      chunkIndex: 0,
      activeTaskId: null,
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      totals: { updated: 0, noops: 0, versionConflicts: 0 },
    };
    const serializedJob = JSON.stringify(job);
    if (!hasQueueCapacity(Buffer.byteLength(serializedJob), network, matchIds.length)) return null;
    persistJob(jobPath(id), job, serializedJob);
    return { id, queuedAt: now };
  } catch (error) {
    log.error('domain date ES enqueue failed', {
      network,
      matched_ads: matchIds.length,
      error: error.message,
    });
    return null;
  }
}

async function acquireNetworkLock(service, network) {
  const sql = service?.db?.sql;
  const getConnection = sql?.getConnection || (sql?.pool?.getConnection
    ? () => sql.pool.getConnection()
    : null);

  // Distributed coordination is a safety boundary. If SQL is unavailable, keep
  // the job queued rather than falling back to uncoordinated ES submissions.
  if (!getConnection) {
    log.warn('domain date ES lock unavailable', { network, reason: 'sql_connection_missing' });
    return { acquired: false, query: null, release: async () => {} };
  }

  let connection;
  try {
    connection = await getConnection();
    const lockName = `${LOCK_PREFIX}${network}`;
    const [rows] = await connection.execute(
      'SELECT GET_LOCK(?, 0) AS acquired',
      [lockName]
    );
    const acquired = Number(rows?.[0]?.acquired) === 1;
    if (!acquired) {
      connection.release();
      return { acquired: false, query: null, release: async () => {} };
    }
    return {
      acquired: true,
      query: async (statement, params) => {
        const [rows] = await connection.execute(statement, params);
        return rows;
      },
      release: async () => {
        try {
          await connection.execute('SELECT RELEASE_LOCK(?) AS released', [lockName]);
        } catch (error) {
          log.warn('domain date ES lock release failed', { network, error: error.message });
        } finally {
          connection.release();
        }
      },
    };
  } catch (error) {
    if (connection) connection.release();
    log.warn('domain date ES lock acquisition failed', { network, error: error.message });
    return { acquired: false, query: null, release: async () => {} };
  }
}

function buildUpdateRequest(service, job, ids) {
  const cfg = DOMAIN_TABLES[job.network];
  const value = cfg.esDateFormat === 'epoch' ? ymdToEpochSeconds(job.date) : job.date;
  return {
    index: service.db.elastic.indexName,
    conflicts: 'proceed',
    refresh: false,
    waitForCompletion: false,
    requestsPerSecond: ES_REQUESTS_PER_SECOND,
    body: {
      query: { terms: { [cfg.esMatchField]: ids } },
      script: {
        lang: 'painless',
        // Retries are safe and cheap when a previous attempt already wrote the date.
        source: "if (ctx._source[params.f] == params.v) { ctx.op = 'noop' } else { ctx._source[params.f] = params.v }",
        params: { f: cfg.esDateField, v: value },
      },
    },
  };
}

async function isJobCurrent(job, lockQuery) {
  // Schema-v1 jobs created before stale-write protection remain replayable.
  if (!Array.isArray(job.domainRowIds) || job.domainRowIds.length === 0) return true;

  const cfg = DOMAIN_TABLES[job.network];
  const placeholders = job.domainRowIds.map(() => '?').join(', ');
  const rows = await lockQuery(
    `SELECT COUNT(*) AS total_rows,
            SUM(CASE WHEN domain_registered_date = ? THEN 1 ELSE 0 END) AS matching_rows
       FROM ${cfg.table}
      WHERE id IN (${placeholders})`,
    [job.date, ...job.domainRowIds]
  );
  const summary = Array.isArray(rows) ? rows[0] : null;
  const totalRows = Number(summary?.total_rows || 0);
  const matchingRows = Number(summary?.matching_rows || 0);
  return totalRows === job.domainRowIds.length && matchingRows === totalRows;
}

async function waitForTask(client, taskId) {
  while (true) {
    let response;
    try {
      response = await client.tasks.get(
        { taskId },
        { requestTimeout: ES_REQUEST_TIMEOUT_MS, maxRetries: 0 }
      );
    } catch (error) {
      // A missing persisted result is safe to replay because the update script no-ops
      // documents that already contain the requested date.
      if (Number(error?.statusCode || error?.meta?.statusCode) === 404) {
        error.taskCompleted = true;
      }
      throw error;
    }

    const body = responseBody(response);
    if (!body.completed) {
      await delay(ES_TASK_POLL_INTERVAL_MS);
      continue;
    }
    if (body.error) throw taskFailure('Elasticsearch domain-date task failed', body.error);

    return assertEsUpdateComplete(body.response || {});
  }
}

async function deleteTaskResult(client, taskId, esMajor) {
  if (typeof client.delete !== 'function') return;
  try {
    // wait_for_completion=false stores the completed response in .tasks until
    // the caller removes it. Cleanup is best-effort and never blocks queue progress.
    const deleteParams = { index: '.tasks', id: taskId };
    if (!esMajor || esMajor < 7) deleteParams.type = 'task';
    await client.delete(
      deleteParams,
      { requestTimeout: ES_REQUEST_TIMEOUT_MS, maxRetries: 0 }
    );
  } catch (error) {
    const statusCode = Number(error?.statusCode || error?.meta?.statusCode);
    if (statusCode !== 404 && log.debug) {
      log.debug('domain date ES task result cleanup skipped', {
        task_id: taskId,
        status_code: statusCode || undefined,
        error: error.message,
      });
    }
  }
}

function moveJobToFailed(filePath, job) {
  ensureDir(FAILED_DIR);
  persistJob(filePath, job);
  let failedPath = path.join(FAILED_DIR, path.basename(filePath));
  if (fs.existsSync(failedPath)) {
    failedPath = path.join(FAILED_DIR, `${path.basename(filePath, '.json')}_${Date.now()}.json`);
  }
  fs.renameSync(filePath, failedPath);
  return failedPath;
}

function scheduleRetry(filePath, job, error) {
  job.attempts = (job.attempts || 0) + 1;
  job.nextAttemptAt = Date.now() + Math.min(
    BACKOFF_MAX_MS,
    BACKOFF_STEP_MS * job.attempts
  );
  if (error.taskCompleted) job.activeTaskId = null;
  job.lastError = {
    message: error.message,
    code: error.code,
    statusCode: error.statusCode || error.meta?.statusCode,
    details: error.details,
    at: Date.now(),
  };

  // Do not abandon a task that may still be running merely because polling is
  // unavailable. Submission failures and completed task failures are bounded.
  if (!job.activeTaskId && job.attempts >= ES_QUEUE_MAX_ATTEMPTS) {
    job.failedAt = Date.now();
    const failedPath = moveJobToFailed(filePath, job);
    return { deadLettered: true, failedPath };
  }
  persistJob(filePath, job);
  return { deadLettered: false };
}

async function processJob(filePath, job, service, lockQuery) {
  const totalChunks = Math.ceil(job.matchIds.length / ES_TERMS_CHUNK);

  try {
    while (job.chunkIndex < totalChunks) {
      if (!job.activeTaskId) {
        if (!(await isJobCurrent(job, lockQuery))) {
          fs.unlinkSync(filePath);
          log.info('domain date ES queue job superseded', {
            queue_id: job.id,
            network: job.network,
            date: job.date,
            chunk: job.chunkIndex + 1,
          });
          return true;
        }

        const ids = chunkAt(job.matchIds, ES_TERMS_CHUNK, job.chunkIndex);
        const response = await service.db.elastic.client.updateByQuery(
          buildUpdateRequest(service, job, ids),
          { requestTimeout: ES_REQUEST_TIMEOUT_MS, maxRetries: 0 }
        );
        const taskId = responseBody(response).task;
        if (!taskId) throw new Error('Elasticsearch did not return a background task id');
        job.activeTaskId = taskId;
        job.nextAttemptAt = Date.now();
        persistJob(filePath, job);
        log.info('domain date ES task submitted', {
          queue_id: job.id,
          network: job.network,
          task_id: taskId,
          chunk: job.chunkIndex + 1,
          chunks: totalChunks,
          matched_ads: job.matchIds.length,
          requests_per_second: ES_REQUESTS_PER_SECOND,
        });
      }

      const completedTaskId = job.activeTaskId;
      let result;
      try {
        result = await waitForTask(service.db.elastic.client, completedTaskId);
      } catch (error) {
        if (error.taskCompleted) {
          await deleteTaskResult(
            service.db.elastic.client,
            completedTaskId,
            service.db.elastic.esMajor
          );
        }
        throw error;
      }
      await deleteTaskResult(
        service.db.elastic.client,
        completedTaskId,
        service.db.elastic.esMajor
      );
      job.totals.updated += Number(result.updated || 0);
      job.totals.noops += Number(result.noops || 0);
      job.totals.versionConflicts += Number(result.version_conflicts || result.versionConflicts || 0);
      job.chunkIndex += 1;
      job.activeTaskId = null;
      job.attempts = 0;
      job.nextAttemptAt = Date.now();
      persistJob(filePath, job);
    }

    fs.unlinkSync(filePath);
    log.info('domain date ES queue job completed', {
      queue_id: job.id,
      network: job.network,
      matched_ads: job.matchIds.length,
      chunks: totalChunks,
      totals: job.totals,
      duration_ms: Date.now() - job.createdAt,
    });
    return true;
  } catch (error) {
    const retry = scheduleRetry(filePath, job, error);
    if (retry.deadLettered) {
      log.error('domain date ES queue job moved to failed after retry limit', {
        queue_id: job.id,
        network: job.network,
        chunk: job.chunkIndex + 1,
        attempts: job.attempts,
        failed_path: retry.failedPath,
        error: error.message,
        error_details: error.details,
      });
      return false;
    }
    log.warn('domain date ES queue job deferred', {
      queue_id: job.id,
      network: job.network,
      chunk: job.chunkIndex + 1,
      task_id: job.activeTaskId,
      attempts: job.attempts,
      next_attempt_at: job.nextAttemptAt,
      error: error.message,
    });
    return false;
  }
}

async function processNetwork(network, entries) {
  const service = serviceRegistry.getService(network);
  if (!service?.db?.elastic?.client || !service.db.elastic.indexName) {
    log.warn('domain date ES queue network unavailable', { network, queued_jobs: entries.length });
    return;
  }

  const lock = await acquireNetworkLock(service, network);
  if (!lock.acquired) return;

  try {
    // Release and reacquire between domains so another API host with queued work
    // gets a fair chance to own this network's distributed lock.
    const [entry] = entries;
    let currentJob;
    try {
      // Another process sharing this queue may have changed or removed the file
      // while this process waited for the distributed lock.
      currentJob = readJob(entry.filePath);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if ((currentJob.nextAttemptAt || 0) > Date.now()) return;
    await processJob(entry.filePath, currentJob, service, lock.query);
  } finally {
    await lock.release();
  }
}

/** Discover due jobs and start work for each currently idle network. */
async function sweepDomainDateEsQueue() {
  if (scanning) return [];
  scanning = true;
  const started = [];
  try {
    if (!fs.existsSync(PENDING_DIR)) return [];
    const now = Date.now();
    const entries = [];
    for (const file of fs.readdirSync(PENDING_DIR).filter((name) => name.endsWith('.json'))) {
      const filePath = path.join(PENDING_DIR, file);
      try {
        const job = readJob(filePath);
        if (!DOMAIN_TABLES[job.network] || !Array.isArray(job.matchIds)) {
          throw new Error('Invalid domain-date ES queue job');
        }
        if ((job.nextAttemptAt || 0) <= now) entries.push({ filePath, job });
      } catch (error) {
        ensureDir(FAILED_DIR);
        try { fs.renameSync(filePath, path.join(FAILED_DIR, file)); } catch { /* leave it for inspection */ }
        log.error('invalid domain date ES queue job moved to failed', { file, error: error.message });
      }
    }

    entries.sort((a, b) => (a.job.createdAt || 0) - (b.job.createdAt || 0));
    const byNetwork = new Map();
    for (const entry of entries) {
      if (!byNetwork.has(entry.job.network)) byNetwork.set(entry.job.network, []);
      byNetwork.get(entry.job.network).push(entry);
    }
    for (const [network, jobs] of byNetwork.entries()) {
      if (activeNetworks.has(network)) continue;
      activeNetworks.add(network);
      const work = processNetwork(network, jobs)
        .catch((error) => {
          log.error('domain date ES queue network processing failed', {
            network,
            error: error.message,
          });
        })
        .finally(() => activeNetworks.delete(network));
      started.push(work);
    }
  } catch (error) {
    log.error('domain date ES queue sweep failed', { error: error.message });
  } finally {
    scanning = false;
  }
  return Promise.all(started);
}

function initDomainDateEsQueueWorker() {
  if (workerTimer) return workerTimer;
  sweepDomainDateEsQueue().catch((error) => {
    log.error('initial domain date ES queue sweep failed', { error: error.message });
  });
  workerTimer = setInterval(() => {
    sweepDomainDateEsQueue().catch((error) => {
      log.error('domain date ES queue sweep failed', { error: error.message });
    });
  }, ES_QUEUE_SWEEP_INTERVAL_MS);
  if (typeof workerTimer.unref === 'function') workerTimer.unref();
  log.info('domain date ES queue worker initialized', {
    sweep_interval_ms: ES_QUEUE_SWEEP_INTERVAL_MS,
    task_poll_interval_ms: ES_TASK_POLL_INTERVAL_MS,
    terms_chunk_size: ES_TERMS_CHUNK,
    requests_per_second: ES_REQUESTS_PER_SECOND,
    max_pending_jobs: ES_QUEUE_MAX_PENDING_JOBS,
    max_queue_bytes: ES_QUEUE_MAX_SIZE_BYTES,
    min_free_bytes: ES_QUEUE_MIN_FREE_BYTES,
    max_attempts: ES_QUEUE_MAX_ATTEMPTS,
  });
  return workerTimer;
}

module.exports = {
  enqueueDomainDateEsUpdate,
  sweepDomainDateEsQueue,
  initDomainDateEsQueueWorker,
  buildUpdateRequest,
  assertEsUpdateComplete,
  PENDING_DIR,
  ES_TERMS_CHUNK,
  ES_REQUESTS_PER_SECOND,
  ES_QUEUE_MAX_PENDING_JOBS,
  ES_QUEUE_MAX_SIZE_BYTES,
  ES_QUEUE_MAX_ATTEMPTS,
};
