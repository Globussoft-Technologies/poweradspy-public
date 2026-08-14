#!/usr/bin/env node
'use strict';

/**
 * Production preflight for the domain-registration-date load-shedding change.
 *
 * Safe mode (default) never updates an ad document. It submits the exact asynchronous
 * update_by_query request against a match_none query so task submission, polling, result
 * validation, throttling, and task cleanup are exercised with negligible ES work.
 *
 * Active mode additionally creates a one-shard temporary index, proves a real update and
 * idempotent no-op with the production ES client, then attempts deletion in a finally block.
 * It never reads from or writes to an ad document.
 *
 * Examples:
 *   node scripts/verify-domain-date-production-readiness.js --network google
 *   node scripts/verify-domain-date-production-readiness.js --network google --active
 *   node scripts/verify-domain-date-production-readiness.js --all --active --strict
 */

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const API_ROOT = path.resolve(__dirname, '..');
const TASK_SCRIPT_SOURCE = 'if (ctx._source[params.f] != params.v) { ctx._source[params.f] = params.v } else { ctx.op = "noop" }';
const TEST_DATE_OLD = '2026-01-01';
const TEST_DATE_NEW = '2026-01-02';
const TEST_EPOCH_OLD = 1767225600;
const TEST_EPOCH_NEW = 1767312000;

// This whitelist is intentionally embedded so the file can run before the changed
// domain-date modules are deployed. Keep it aligned with helpers/domainTables.js.
const DOMAIN_TABLES = Object.freeze({
  facebook:  { table: 'facebook_ad_domains', adTable: 'facebook_ad', esDateField: 'facebook_ad_domains.domain_registered_date', esMatchField: 'facebook_ad.id' },
  linkedin:  { table: 'linkedin_ad_domains', adTable: 'linkedin_ad', esDateField: 'domain_registration_date', esMatchField: 'ad_id' },
  instagram: { table: 'instagram_ad_domain', adTable: 'instagram_ad', esDateField: 'instagram_ad_domain.domain_registered_date', esMatchField: 'instagram_ad.id' },
  google:    { table: 'google_text_ad_domains', adTable: 'google_text_ad', esDateField: 'domain_registered_date', esMatchField: 'ad_id' },
  youtube:   { table: 'youtube_ad_domains', adTable: 'youtube_ad', esDateField: 'domain_registration_date', esMatchField: 'ad_id' },
  native:    { table: 'native_ad_domains', adTable: 'native_ad', esDateField: 'native_ad_domains.domain_registered_date', esMatchField: 'native_ad.id' },
  pinterest: { table: 'pinterest_ad_domains', adTable: 'pinterest_ad', esDateField: 'pinterest_ad_domains.domain_registered_date', esMatchField: 'pinterest_ad.id' },
  reddit:    { table: 'reddit_ad_domain', adTable: 'reddit_ad', esDateField: 'reddit_ad_domain.domain_registered_date', esMatchField: 'reddit_ad.id' },
  quora:     { table: 'quora_ad_domain', adTable: 'quora_ad', esDateField: 'quora_ad_domains.domain_registered_date', esMatchField: 'quora_ad.id' },
  gdn:       { table: 'gdn_ad_domains', adTable: 'gdn_ad', esDateField: 'gdn_ad_domains.domain_registered_date', esMatchField: 'gdn_ad.id' },
});

const DOMAIN_DATE_DEFAULTS = Object.freeze({
  esSyncMaxAds: 100,
  sqlQueryTimeoutMs: 10000,
  esRequestTimeoutMs: 10000,
  esTermsChunkSize: 10000,
  esRequestsPerSecond: 250,
  esTaskPollIntervalMs: 5000,
  esQueueSweepIntervalMs: 5000,
  esQueueMaxPendingJobs: 5000,
  esQueueMaxSizeMb: 512,
  esQueueMinFreeDiskMb: 2048,
  esQueueMaxAttempts: 10,
});

const ALLOW_ZERO = new Set(['esSyncMaxAds', 'esQueueMinFreeDiskMb']);

function printHelp() {
  console.log(`Domain-date production readiness preflight

Usage:
  node scripts/verify-domain-date-production-readiness.js [options]

Options:
  --network <name[,name]>  Check one or more domain networks (default: google)
  --all                    Check all domain-date networks
  --active                 Create and remove a temporary ES index for a real write test
  --read-only              Skip update_by_query task checks; connectivity/mappings only
  --strict                 Treat warnings as a failed verdict
  --json                   Print one machine-readable JSON result
  --timeout-ms <number>    Maximum time to poll each ES task (default: 60000)
  --help                   Show this help

Safety:
  Default mode writes one match_none task result to the ES .tasks system index but
  never changes an ad document. --active only writes to a uniquely named temporary
  index and always attempts cleanup. SQL checks are read-only except GET_LOCK.
`);
}

function parseArgs(argv) {
  const options = {
    active: false,
    all: false,
    json: false,
    networks: ['google'],
    readOnly: false,
    strict: false,
    timeoutMs: 60000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--active') options.active = true;
    else if (argument === '--all') options.all = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--read-only') options.readOnly = true;
    else if (argument === '--strict') options.strict = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--network') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--network requires a value');
      options.networks = value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
      index += 1;
    } else if (argument === '--timeout-ms') {
      const value = Number(argv[index + 1]);
      if (!Number.isSafeInteger(value) || value < 1000) throw new Error('--timeout-ms must be an integer of at least 1000');
      options.timeoutMs = value;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (options.active && options.readOnly) throw new Error('--active and --read-only cannot be used together');
  if (options.all) options.networks = Object.keys(DOMAIN_TABLES);
  options.networks = [...new Set(options.networks)];
  if (options.networks.length === 0) throw new Error('At least one network is required');

  const unknownNetworks = options.networks.filter((network) => !DOMAIN_TABLES[network]);
  if (unknownNetworks.length > 0) {
    throw new Error(`Unsupported domain network(s): ${unknownNetworks.join(', ')}`);
  }
  return options;
}

class Reporter {
  constructor(options) {
    this.options = options;
    this.results = [];
    this.startedAt = new Date();
  }

  add(status, scope, message, details) {
    const result = { status, scope, message };
    if (details !== undefined) result.details = details;
    this.results.push(result);
    if (!this.options.json) {
      const detailText = details === undefined ? '' : ` (${typeof details === 'string' ? details : JSON.stringify(details)})`;
      console.log(`[${status}] ${scope}: ${message}${detailText}`);
    }
  }

  pass(scope, message, details) { this.add('PASS', scope, message, details); }
  warn(scope, message, details) { this.add('WARN', scope, message, details); }
  fail(scope, message, details) { this.add('FAIL', scope, message, details); }
  info(scope, message, details) { this.add('INFO', scope, message, details); }

  finish() {
    const counts = { pass: 0, warn: 0, fail: 0, info: 0 };
    for (const result of this.results) counts[result.status.toLowerCase()] += 1;
    const blocking = counts.fail + (this.options.strict ? counts.warn : 0);
    const verdict = blocking > 0 ? 'FAIL' : (counts.warn > 0 ? 'PASS_WITH_WARNINGS' : 'PASS');
    const report = {
      check: 'domain-date-production-readiness',
      started_at: this.startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      mode: this.options.active ? 'active-temporary-index' : (this.options.readOnly ? 'read-only' : 'safe-zero-match-task'),
      networks: this.options.networks,
      strict: this.options.strict,
      verdict,
      counts,
      results: this.results,
    };

    if (this.options.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log('');
      console.log(`VERDICT: ${verdict}`);
      console.log(`Summary: ${counts.pass} passed, ${counts.warn} warning(s), ${counts.fail} failed, ${counts.info} informational`);
      console.log('A PASS verifies production prerequisites and the tested ES/SQL behavior; it does not replace a post-deploy canary and CPU monitoring.');
    }
    return blocking === 0 ? 0 : 1;
  }
}

function bodyOf(response) {
  return response && Object.prototype.hasOwnProperty.call(response, 'body') ? response.body : response;
}

function redactSensitive(value) {
  return String(value)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, '$1[REDACTED]@')
    .replace(/(\b(?:username|password|passwd|authorization|api[_-]?key)\b\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]');
}

function safeError(error) {
  const status = error?.meta?.statusCode || error?.statusCode;
  return {
    name: error?.name || 'Error',
    code: error?.code,
    status,
    message: redactSensitive(error?.message || error),
  };
}

function toNodes(value) {
  const nodes = Array.isArray(value) ? value : String(value || '').split(/[,\s]+/);
  return nodes.map((item) => String(item).trim().replace(/\/+$/, '')).filter(Boolean);
}

function positiveInteger(value, allowZero = false) {
  return Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0);
}

function resolvedDomainDateConfig(config, rawConfig) {
  const raw = rawConfig?.domainDateUpdate || {};
  const resolved = {};
  for (const [key, fallback] of Object.entries(DOMAIN_DATE_DEFAULTS)) {
    const candidate = config?.domainDateUpdate?.[key] ?? raw[key];
    resolved[key] = positiveInteger(candidate, ALLOW_ZERO.has(key)) ? candidate : fallback;
  }
  return resolved;
}

function installedPackageVersion(packageName) {
  const entryPoint = require.resolve(packageName);
  const packagePath = path.join(path.dirname(entryPoint), 'package.json');
  return JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
}

function checkRuntimeAndConfig(options, reporter) {
  let config;
  let networks;
  try {
    config = require('../src/config');
    networks = require('../src/config/networks');
    reporter.pass('runtime', 'Application configuration loaded');
  } catch (error) {
    reporter.fail('runtime', 'Application configuration could not be loaded', safeError(error));
    return null;
  }

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor >= 18) reporter.pass('runtime', `Node.js ${process.versions.node} is supported`);
  else reporter.fail('runtime', `Node.js ${process.versions.node} is too old; Node.js 18+ is required`);

  try {
    const esClientVersion = installedPackageVersion('@elastic/elasticsearch');
    const esClientMajor = Number(esClientVersion.split('.')[0]);
    if (esClientMajor === 7) reporter.pass('runtime', `Elasticsearch client ${esClientVersion} matches the reviewed 7.x client`);
    else reporter.fail('runtime', `Elasticsearch client ${esClientVersion} is not the reviewed 7.x client`);
  } catch (error) {
    reporter.fail('runtime', 'Elasticsearch client package is unavailable', safeError(error));
  }

  try {
    const mysqlClientVersion = installedPackageVersion('mysql2');
    const mysqlClientMajor = Number(mysqlClientVersion.split('.')[0]);
    if (mysqlClientMajor === 3) reporter.pass('runtime', `mysql2 ${mysqlClientVersion} matches the reviewed 3.x client`);
    else reporter.warn('runtime', `mysql2 ${mysqlClientVersion} differs from the reviewed 3.x client`);
  } catch (error) {
    reporter.fail('runtime', 'mysql2 package is unavailable', safeError(error));
  }

  if (config.env === 'production') reporter.pass('config', 'NODE_ENV resolves to production');
  else reporter.fail('config', `NODE_ENV resolves to ${String(config.env)} instead of production`);

  if (config.cluster?.enabled === true) {
    reporter.pass('config', 'Cluster mode is enabled', { workers: config.cluster.workers || 'auto' });
  } else {
    reporter.fail('config', 'Cluster mode is not enabled; this does not match the declared production topology');
  }

  const rawConfig = typeof config.getRawFileConfig === 'function' ? config.getRawFileConfig() : null;
  const rawDomainDate = rawConfig?.domainDateUpdate;
  const domainDate = resolvedDomainDateConfig(config, rawConfig);
  if (!rawDomainDate) {
    reporter.warn('config', 'config.json has no domainDateUpdate block; reviewed defaults will be used after deployment', DOMAIN_DATE_DEFAULTS);
  } else {
    reporter.pass('config', 'config.json contains the domainDateUpdate block');
    const missingKeys = Object.keys(DOMAIN_DATE_DEFAULTS)
      .filter((key) => !Object.prototype.hasOwnProperty.call(rawDomainDate, key));
    const invalidKeys = Object.keys(DOMAIN_DATE_DEFAULTS)
      .filter((key) => Object.prototype.hasOwnProperty.call(rawDomainDate, key)
        && !positiveInteger(rawDomainDate[key], ALLOW_ZERO.has(key)));
    if (missingKeys.length > 0) reporter.warn('config', 'domainDateUpdate omits reviewed keys and will use defaults for them', missingKeys);
    if (invalidKeys.length > 0) reporter.fail('config', 'domainDateUpdate contains invalid integer values', invalidKeys);
  }

  for (const [key, value] of Object.entries(domainDate)) {
    if (!positiveInteger(value, ALLOW_ZERO.has(key))) {
      reporter.fail('config', `domainDateUpdate.${key} must be ${ALLOW_ZERO.has(key) ? 'zero or a positive integer' : 'a positive integer'}`, value);
    }
  }
  if (domainDate.esTermsChunkSize > 65536) {
    reporter.fail('config', 'esTermsChunkSize exceeds the default Elasticsearch terms-query limit of 65536', domainDate.esTermsChunkSize);
  } else {
    reporter.pass('config', 'Domain-date limits are valid', domainDate);
  }

  for (const network of options.networks) {
    const networkConfig = networks[network];
    if (!networkConfig) {
      reporter.fail(network, 'Network configuration is unavailable');
      continue;
    }
    if (networkConfig.enabled === false) reporter.warn(network, 'Network is disabled in production configuration');
    if (!networkConfig.database?.sql?.enabled) reporter.fail(network, 'SQL is disabled or not configured');
    if (!networkConfig.database?.elastic?.enabled) reporter.fail(network, 'Elasticsearch is disabled or not configured');
    if (!networkConfig.database?.elastic?.index) reporter.fail(network, 'Elasticsearch index is missing');
  }

  return { config, domainDate, networks, rawConfig };
}

async function checkQueueFilesystem(config, domainDate, reporter) {
  const cacheDirectory = path.resolve(API_ROOT, config.localCache?.dir || 'data');
  const queueDirectory = path.join(cacheDirectory, 'domain-date-es-pending');
  const existed = fs.existsSync(queueDirectory);
  const token = `${process.pid}-${Date.now()}`;
  const firstPath = path.join(queueDirectory, `.preflight-${token}.tmp`);
  const renamedPath = path.join(queueDirectory, `.preflight-${token}.json`);

  try {
    await fsPromises.mkdir(queueDirectory, { recursive: true });
    const handle = await fsPromises.open(firstPath, 'wx');
    try {
      await handle.writeFile(JSON.stringify({ preflight: true, created_at: new Date().toISOString() }), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsPromises.rename(firstPath, renamedPath);
    JSON.parse(await fsPromises.readFile(renamedPath, 'utf8'));
    await fsPromises.unlink(renamedPath);
    reporter.pass('queue-filesystem', 'Atomic write, fsync, rename, read, and delete succeeded', queueDirectory);

    if (typeof fsPromises.statfs === 'function') {
      const stats = await fsPromises.statfs(queueDirectory);
      const freeMb = Math.floor((Number(stats.bavail) * Number(stats.bsize)) / (1024 * 1024));
      if (freeMb >= domainDate.esQueueMinFreeDiskMb) {
        reporter.pass('queue-filesystem', 'Free disk satisfies esQueueMinFreeDiskMb', { free_mb: freeMb, required_mb: domainDate.esQueueMinFreeDiskMb });
      } else {
        reporter.fail('queue-filesystem', 'Free disk is below esQueueMinFreeDiskMb', { free_mb: freeMb, required_mb: domainDate.esQueueMinFreeDiskMb });
      }
    } else {
      reporter.warn('queue-filesystem', 'This Node.js runtime cannot report filesystem free space');
    }
  } catch (error) {
    reporter.fail('queue-filesystem', 'Queue persistence primitives failed', safeError(error));
  } finally {
    await fsPromises.unlink(firstPath).catch(() => {});
    await fsPromises.unlink(renamedPath).catch(() => {});
    if (!existed) await fsPromises.rmdir(queueDirectory).catch(() => {});
  }

  reporter.info('queue-filesystem', 'DevOps must confirm this path survives process restarts and is shared only as intended by the deployment topology', queueDirectory);
}

function extractRows(response) {
  return Array.isArray(response) && Array.isArray(response[0]) ? response[0] : response;
}

async function checkMysqlNetwork(network, networkConfig, tableConfig, reporter) {
  const scope = `${network}/mysql`;
  const sql = networkConfig?.database?.sql;
  if (!sql?.enabled) return;

  let mysql;
  try {
    mysql = require('mysql2/promise');
  } catch (error) {
    reporter.fail(scope, 'mysql2/promise could not be loaded', safeError(error));
    return;
  }

  const pool = mysql.createPool({
    host: sql.host,
    port: Number(sql.port) || 3306,
    user: sql.user,
    password: sql.password,
    database: sql.database,
    waitForConnections: true,
    connectionLimit: Math.max(2, Number(sql.poolSize) || 2),
    connectTimeout: 10000,
    enableKeepAlive: true,
  });

  let first;
  let second;
  // Use the same MySQL primitive without briefly contending with the live worker's lock.
  const lockName = `pas:domain-date-es:preflight:${network}`;
  try {
    first = await pool.getConnection();
    second = await pool.getConnection();

    const versionRows = extractRows(await first.query('SELECT VERSION() AS version, DATABASE() AS database_name'));
    const version = String(versionRows[0]?.version || 'unknown');
    if (Number(version.split('.')[0]) === 8) reporter.pass(scope, `MySQL ${version} matches the reviewed 8.x server`);
    else reporter.fail(scope, `MySQL ${version} does not match the reviewed 8.x server`);

    const requiredColumns = {
      [tableConfig.table]: new Set(['id', 'domain', 'domain_registered_date', 'status', 'updated_date']),
      [tableConfig.adTable]: new Set(['id', 'ad_id', 'domain_id']),
    };
    const [columnRows] = await first.execute(
      `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (?, ?)`,
      [tableConfig.table, tableConfig.adTable],
    );
    for (const row of columnRows) requiredColumns[row.table_name]?.delete(row.column_name);
    const missing = Object.entries(requiredColumns)
      .flatMap(([table, columns]) => [...columns].map((column) => `${table}.${column}`));
    if (missing.length === 0) reporter.pass(scope, 'Domain and ad table columns required by the worker are present');
    else reporter.fail(scope, 'Required SQL columns are missing', missing);

    // EXPLAIN validates the two production query shapes without scanning or changing data.
    await first.execute(
      `EXPLAIN SELECT COUNT(*) AS total_rows,
                      SUM(CASE WHEN domain_registered_date = ? THEN 1 ELSE 0 END) AS matching_rows
         FROM ${tableConfig.table}
        WHERE id IN (?)`,
      [TEST_DATE_NEW, 0],
    );
    await first.execute(
      `EXPLAIN SELECT id, ad_id FROM ${tableConfig.adTable} WHERE domain_id IN (?)`,
      [0],
    );
    reporter.pass(scope, 'Stale-check and ad-id lookup SQL query shapes compile');

    const firstLockRows = extractRows(await first.query('SELECT GET_LOCK(?, 0) AS acquired', [lockName]));
    const secondLockRows = extractRows(await second.query('SELECT GET_LOCK(?, 0) AS acquired', [lockName]));
    if (Number(firstLockRows[0]?.acquired) !== 1 || Number(secondLockRows[0]?.acquired) !== 0) {
      throw new Error('GET_LOCK did not enforce cross-connection mutual exclusion');
    }
    const releaseRows = extractRows(await first.query('SELECT RELEASE_LOCK(?) AS released', [lockName]));
    const reacquireRows = extractRows(await second.query('SELECT GET_LOCK(?, 0) AS acquired', [lockName]));
    if (Number(releaseRows[0]?.released) !== 1 || Number(reacquireRows[0]?.acquired) !== 1) {
      throw new Error('The advisory lock could not be released and reacquired');
    }
    await second.query('SELECT RELEASE_LOCK(?) AS released', [lockName]);
    reporter.pass(scope, 'MySQL advisory lock excludes competing cluster workers and can be handed over');
  } catch (error) {
    reporter.fail(scope, 'MySQL production prerequisite failed', safeError(error));
  } finally {
    if (first) {
      await first.query('SELECT RELEASE_LOCK(?) AS released', [lockName]).catch(() => {});
      first.release();
    }
    if (second) {
      await second.query('SELECT RELEASE_LOCK(?) AS released', [lockName]).catch(() => {});
      second.release();
    }
    await pool.end().catch(() => {});
  }
}

function mappingFieldNames(mappingResponse, indexName) {
  const body = bodyOf(mappingResponse) || {};
  const indexMapping = body[indexName] || body[Object.keys(body)[0]] || {};
  const mappings = indexMapping.mappings || {};
  const roots = mappings.properties
    ? [mappings.properties]
    : Object.values(mappings).filter((value) => value && value.properties).map((value) => value.properties);
  const names = new Set();

  function visit(properties, prefix = '') {
    for (const [name, definition] of Object.entries(properties || {})) {
      const fullName = prefix ? `${prefix}.${name}` : name;
      names.add(fullName);
      if (definition?.properties) visit(definition.properties, fullName);
      if (definition?.fields) {
        for (const subfield of Object.keys(definition.fields)) names.add(`${fullName}.${subfield}`);
      }
    }
  }
  for (const properties of roots) visit(properties);
  return names;
}

function validateCompletedUpdate(taskBody, expectation = {}) {
  if (!taskBody || taskBody.completed !== true) throw new Error('Elasticsearch task is not complete');
  if (taskBody.error) throw new Error(`Elasticsearch task failed: ${taskBody.error.reason || taskBody.error.type || 'unknown error'}`);
  const response = taskBody.response;
  if (!response || typeof response !== 'object') throw new Error('Elasticsearch task completed without a response payload');
  if (response.timed_out === true) throw new Error('Elasticsearch update_by_query timed out');
  if (Number(response.version_conflicts || 0) !== 0) throw new Error(`Elasticsearch reported ${response.version_conflicts} version conflict(s)`);
  if (Array.isArray(response.failures) && response.failures.length > 0) throw new Error(`Elasticsearch reported ${response.failures.length} item failure(s)`);
  if (!Number.isFinite(Number(response.total)) || !Number.isFinite(Number(response.updated)) || !Number.isFinite(Number(response.noops))) {
    throw new Error('Elasticsearch task response is missing total/updated/noops counters');
  }
  if (expectation.updated !== undefined && Number(response.updated) !== expectation.updated) {
    throw new Error(`Expected ${expectation.updated} updated document(s), received ${response.updated}`);
  }
  if (expectation.noops !== undefined && Number(response.noops) !== expectation.noops) {
    throw new Error(`Expected ${expectation.noops} no-op document(s), received ${response.noops}`);
  }
  return response;
}

function updateByQueryRequest(index, query, field, value, domainDate) {
  return {
    index,
    conflicts: 'proceed',
    refresh: false,
    waitForCompletion: false,
    requestsPerSecond: domainDate.esRequestsPerSecond,
    body: {
      query,
      script: {
        lang: 'painless',
        source: TASK_SCRIPT_SOURCE,
        params: { f: field, v: value },
      },
    },
  };
}

async function waitForTask(client, taskId, domainDate, options) {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const task = bodyOf(await client.tasks.get(
      { taskId },
      { requestTimeout: domainDate.esRequestTimeoutMs, maxRetries: 0 },
    ));
    if (task?.completed === true) return task;
    await new Promise((resolve) => setTimeout(resolve, Math.min(domainDate.esTaskPollIntervalMs, 1000)));
  }
  throw new Error(`Elasticsearch task ${taskId} did not finish within ${options.timeoutMs}ms`);
}

async function deleteTaskResult(client, taskId, esMajor, domainDate, reporter, scope) {
  const params = { index: '.tasks', id: taskId };
  if (esMajor <= 6) params.type = 'task';
  try {
    await client.delete(params, { requestTimeout: domainDate.esRequestTimeoutMs, maxRetries: 0 });
    reporter.pass(scope, 'Completed task result was removed from .tasks');
  } catch (error) {
    const status = error?.meta?.statusCode || error?.statusCode;
    if (status === 404) reporter.pass(scope, 'Completed task result was already absent from .tasks');
    else reporter.warn(scope, 'Completed task result could not be removed; production will log and continue', safeError(error));
  }
}

async function runUpdateTask(client, request, domainDate, options, reporter, scope, esMajor, expectation) {
  const submitted = bodyOf(await client.updateByQuery(
    request,
    { requestTimeout: domainDate.esRequestTimeoutMs, maxRetries: 0 },
  ));
  const taskId = submitted?.task;
  if (!taskId) throw new Error('Elasticsearch did not return an async task id');
  let taskBody;
  try {
    taskBody = await waitForTask(client, taskId, domainDate, options);
    return validateCompletedUpdate(taskBody, expectation);
  } finally {
    // Only completed tasks have a persisted result document that is safe to remove.
    if (taskBody?.completed === true) {
      await deleteTaskResult(client, taskId, esMajor, domainDate, reporter, scope);
    }
  }
}

function temporaryIndexName(network) {
  const host = os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 24) || 'host';
  return `pas-domain-date-preflight-${network}-${host}-${process.pid}-${Date.now()}`.slice(0, 220);
}

async function runActiveEsProbe(client, network, esMajor, domainDate, options, reporter) {
  const scope = `${network}/es-active`;
  const index = temporaryIndexName(network);
  const properties = {
    ad_id: { type: 'keyword' },
    domain_registered_date: { type: 'date', format: 'yyyy-MM-dd' },
    domain_registration_date: { type: 'date', format: 'epoch_second' },
  };
  const mappings = esMajor <= 6 ? { doc: { properties } } : { properties };
  let created = false;

  try {
    await client.indices.create({
      index,
      body: {
        settings: { number_of_shards: 1, number_of_replicas: 0 },
        mappings,
      },
    }, { requestTimeout: domainDate.esRequestTimeoutMs, maxRetries: 0 });
    created = true;
    reporter.pass(scope, 'Temporary one-shard index was created', index);

    const indexRequest = {
      index,
      id: 'preflight-1',
      refresh: 'wait_for',
      body: {
        ad_id: 'preflight-ad',
        domain_registered_date: TEST_DATE_OLD,
        domain_registration_date: TEST_EPOCH_OLD,
      },
    };
    if (esMajor <= 6) indexRequest.type = 'doc';
    await client.index(indexRequest, { requestTimeout: domainDate.esRequestTimeoutMs, maxRetries: 0 });

    const updateRequest = updateByQueryRequest(
      index,
      { terms: { ad_id: ['preflight-ad'] } },
      'domain_registered_date',
      TEST_DATE_NEW,
      domainDate,
    );
    const firstUpdate = await runUpdateTask(client, updateRequest, domainDate, options, reporter, scope, esMajor, { updated: 1, noops: 0 });
    reporter.pass(scope, 'Painless date update completed through the async task API', firstUpdate);

    const noOpUpdate = await runUpdateTask(client, updateRequest, domainDate, options, reporter, scope, esMajor, { updated: 0, noops: 1 });
    reporter.pass(scope, 'Repeating the same date produced an idempotent no-op', noOpUpdate);

    const epochUpdate = await runUpdateTask(
      client,
      updateByQueryRequest(index, { terms: { ad_id: ['preflight-ad'] } }, 'domain_registration_date', TEST_EPOCH_NEW, domainDate),
      domainDate,
      options,
      reporter,
      scope,
      esMajor,
      { updated: 1, noops: 0 },
    );
    reporter.pass(scope, 'Epoch-second date update completed through the same path', epochUpdate);

    const getRequest = { index, id: 'preflight-1' };
    if (esMajor <= 6) getRequest.type = 'doc';
    const document = bodyOf(await client.get(getRequest, { requestTimeout: domainDate.esRequestTimeoutMs, maxRetries: 0 }));
    if (document?._source?.domain_registered_date !== TEST_DATE_NEW
      || Number(document?._source?.domain_registration_date) !== TEST_EPOCH_NEW) {
      throw new Error('Temporary document did not retain the expected YMD and epoch values');
    }
    reporter.pass(scope, 'Temporary document contains both expected date formats');
  } catch (error) {
    reporter.fail(scope, 'Isolated Elasticsearch write test failed', safeError(error));
  } finally {
    if (created) {
      try {
        await client.indices.delete({ index }, { requestTimeout: domainDate.esRequestTimeoutMs, maxRetries: 0 });
        reporter.pass(scope, 'Temporary index was deleted', index);
      } catch (error) {
        reporter.fail(scope, `Temporary index cleanup failed; delete ${index} manually`, safeError(error));
      }
    }
  }
}

async function checkElasticsearchNetwork(network, networkConfig, tableConfig, domainDate, options, reporter) {
  const scope = `${network}/elasticsearch`;
  const elastic = networkConfig?.database?.elastic;
  if (!elastic?.enabled) return;

  let Client;
  try {
    ({ Client } = require('@elastic/elasticsearch'));
  } catch (error) {
    reporter.fail(scope, 'Elasticsearch client could not be loaded', safeError(error));
    return;
  }

  const nodes = toNodes(elastic.node);
  if (nodes.length === 0) {
    reporter.fail(scope, 'No Elasticsearch node is configured');
    return;
  }
  const clientOptions = {
    nodes,
    maxRetries: 0,
    requestTimeout: domainDate.esRequestTimeoutMs,
  };
  if (elastic.auth?.username || elastic.auth?.password) clientOptions.auth = elastic.auth;
  const client = new Client(clientOptions);

  try {
    const info = bodyOf(await client.info({}, { requestTimeout: domainDate.esRequestTimeoutMs, maxRetries: 0 }));
    const version = String(info?.version?.number || 'unknown');
    const esMajor = Number(version.split('.')[0]);
    if (esMajor === 6) reporter.pass(scope, `Elasticsearch ${version} matches the reviewed 6.8 production family`);
    else if (esMajor >= 7 && esMajor <= 8) reporter.warn(scope, `Elasticsearch ${version} is supported by the request shape but differs from the expected 6.8 non-TikTok cluster`);
    else reporter.fail(scope, `Elasticsearch ${version} is outside the reviewed 6.x-8.x range`);

    const exists = bodyOf(await client.indices.exists(
      { index: elastic.index },
      { requestTimeout: domainDate.esRequestTimeoutMs, maxRetries: 0 },
    ));
    if (exists !== true) throw new Error(`Configured index ${elastic.index} does not exist`);
    reporter.pass(scope, 'Configured ad index exists', elastic.index);

    const mapping = await client.indices.getMapping(
      { index: elastic.index },
      { requestTimeout: domainDate.esRequestTimeoutMs, maxRetries: 0 },
    );
    const fields = mappingFieldNames(mapping, elastic.index);
    const missingFields = [tableConfig.esDateField, tableConfig.esMatchField].filter((field) => !fields.has(field));
    if (missingFields.length === 0) reporter.pass(scope, 'Date and ad-match ES mappings are present', [tableConfig.esDateField, tableConfig.esMatchField]);
    else reporter.fail(scope, 'Required Elasticsearch mappings are missing', missingFields);

    if (!options.readOnly) {
      const safeTask = await runUpdateTask(
        client,
        updateByQueryRequest(elastic.index, { match_none: {} }, tableConfig.esDateField, TEST_DATE_NEW, domainDate),
        domainDate,
        options,
        reporter,
        scope,
        esMajor,
        { updated: 0, noops: 0 },
      );
      reporter.pass(scope, 'Zero-match asynchronous update_by_query completed without touching ad documents', safeTask);
    } else {
      reporter.info(scope, 'Async task lifecycle was skipped because --read-only was selected');
    }

    if (options.active) await runActiveEsProbe(client, network, esMajor, domainDate, options, reporter);
  } catch (error) {
    reporter.fail(scope, 'Elasticsearch production prerequisite failed', safeError(error));
  } finally {
    await Promise.resolve(client.close()).catch(() => {});
  }
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`Argument error: ${error.message}`);
    printHelp();
    return 1;
  }
  if (options.help) {
    printHelp();
    return 0;
  }

  const reporter = new Reporter(options);
  if (!options.json) {
    console.log('Domain-date production readiness preflight');
    console.log(`Mode: ${options.active ? 'active temporary-index test' : (options.readOnly ? 'read-only' : 'safe zero-match task')}`);
    console.log(`Networks: ${options.networks.join(', ')}`);
    console.log('No real ad document will be modified. Credentials are never printed.');
    console.log('');
  }

  const runtime = checkRuntimeAndConfig(options, reporter);
  if (runtime) {
    await checkQueueFilesystem(runtime.config, runtime.domainDate, reporter);
    for (const network of options.networks) {
      const networkConfig = runtime.networks[network];
      if (!networkConfig) continue;
      await checkMysqlNetwork(network, networkConfig, DOMAIN_TABLES[network], reporter);
      await checkElasticsearchNetwork(network, networkConfig, DOMAIN_TABLES[network], runtime.domainDate, options, reporter);
    }
    reporter.info('deployment', 'This preflight cannot verify that the reviewed source commit is included in the release artifact; verify the deployed commit SHA separately');
    reporter.info('deployment', 'After deployment, canary one worker and monitor ES CPU, task backlog, queue depth, retries, and HTTP 503 responses before full rollout');
  }
  return reporter.finish();
}

if (require.main === module) {
  main()
    .then((exitCode) => { process.exitCode = exitCode; })
    .catch((error) => {
      console.error(`Unexpected preflight failure: ${safeError(error).message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  DOMAIN_DATE_DEFAULTS,
  DOMAIN_TABLES,
  Reporter,
  bodyOf,
  deleteTaskResult,
  installedPackageVersion,
  main,
  mappingFieldNames,
  parseArgs,
  redactSensitive,
  resolvedDomainDateConfig,
  toNodes,
  validateCompletedUpdate,
};
