'use strict';

const fs = require('fs');
const path = require('path');

// ─── Load config.json ───────────────────────────────────────
let fileConfig = {};
// Resolve from the API project, not the caller's working directory. This keeps
// configuration correct for maintenance scripts and sibling services that use
// the API's resolved network configuration.
const configPath = process.env.PAS_NODE_API_CONFIG_PATH
  ? path.resolve(process.env.PAS_NODE_API_CONFIG_PATH)
  : path.resolve(__dirname, '../../config.json');

// Load the API's environment file from the same root as config.json. This is
// important when a sibling service imports the resolved network configuration.
require('dotenv').config({ path: path.resolve(path.dirname(configPath), '.env') });

try {
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf-8');
    fileConfig = JSON.parse(raw);
  }
} catch (err) {
  console.error(`[config] Failed to load config.json: ${err.message}`);
}

/**
 * Get a value from config.json first, then fall back to environment variable.
 * @param {*} jsonValue - Value from config.json (can be undefined)
 * @param {string} envKey - Environment variable name to fall back to
 * @param {Function} [transform] - Optional transform function (e.g. parseInt, parseFloat)
 * @returns {*} The resolved value
 */
function getVal(jsonValue, envKey, transform) {
  // If jsonValue is explicitly set (not undefined), use it
  if (jsonValue !== undefined && jsonValue !== null && jsonValue !== '') {
    return transform ? transform(jsonValue) : jsonValue;
  }
  // Fallback to env
  const envVal = process.env[envKey];
  if (envVal !== undefined && envVal !== null && envVal !== '') {
    return transform ? transform(envVal) : envVal;
  }
  // No value found anywhere
  return undefined;
}

const toInt = (v) => parseInt(v, 10);
const toBool = (v) => v === true || v === 'true';
const validatedInt = (value, fallback, allowZero = false) => {
  const parsed = toInt(value);
  const valid = Number.isFinite(parsed) && (allowZero ? parsed >= 0 : parsed > 0);
  return valid ? parsed : fallback;
};
// Integer clamped to [min, max]; anything unparseable falls back to `fallback`.
const boundedInt = (value, fallback, min, max) => {
  const parsed = toInt(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
};
const toStringArray = (v) => {
  if (Array.isArray(v)) return v.map((item) => String(item).trim()).filter(Boolean);
  if (typeof v !== 'string') return [];

  try {
    const parsed = JSON.parse(v);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
  } catch {
    // A plain comma-separated environment value is also supported.
  }
  return v.split(',').map((item) => item.trim()).filter(Boolean);
};

// ─── Build config object ─────────────────────────────────────

const config = {
  env: getVal(fileConfig.server?.nodeEnv, 'NODE_ENV'),
  port: getVal(fileConfig.server?.port, 'PORT', toInt),
  host: getVal(fileConfig.server?.host, 'HOST'),
  bodyLimit: getVal(fileConfig.server?.bodyLimit, 'BODY_LIMIT'),
  trustProxy: getVal(fileConfig.server?.trustProxy, 'TRUST_PROXY', toInt),

  jwt: {
    secret: getVal(fileConfig.jwt?.secret, 'JWT_SECRET'),
    expiresIn: getVal(fileConfig.jwt?.expiresIn, 'JWT_EXPIRES_IN'),
    cookieMaxAgeMs: getVal(fileConfig.jwt?.cookieMaxAgeMs, 'JWT_COOKIE_MAX_AGE_MS', toInt) || 86400000,
  },

  rateLimit: {
    windowMs: getVal(fileConfig.rateLimit?.windowMs, 'RATE_LIMIT_WINDOW_MS', toInt),
    maxRequests: getVal(fileConfig.rateLimit?.maxRequests, 'RATE_LIMIT_MAX_REQUESTS', toInt),
  },

  cluster: {
    enabled: getVal(fileConfig.cluster?.enabled, 'CLUSTER_ENABLED', toBool),
    workers: getVal(fileConfig.cluster?.workers, 'CLUSTER_WORKERS', toInt),
    maxRestarts: getVal(fileConfig.cluster?.maxRestarts, 'CLUSTER_MAX_RESTARTS', toInt),
    restartWindowMs: getVal(fileConfig.cluster?.restartWindowMs, 'CLUSTER_RESTART_WINDOW_MS', toInt),
    maxRestartDelayMs: getVal(fileConfig.cluster?.maxRestartDelayMs, 'CLUSTER_MAX_RESTART_DELAY_MS', toInt),
    gracefulShutdownTimeoutMs: getVal(fileConfig.cluster?.gracefulShutdownTimeoutMs, 'CLUSTER_GRACEFUL_SHUTDOWN_MS', toInt),
  },

  cache: {
    defaultTTL: getVal(fileConfig.cache?.defaultTTL, 'CACHE_DEFAULT_TTL', toInt),
    enabled: getVal(fileConfig.cache?.enabled, 'CACHE_ENABLED', toBool),
  },

  planControl: {
    enforcementMode: getVal(fileConfig.planControl?.enforcementMode, 'PLAN_CONTROL_ENFORCEMENT_MODE') || 'enforce',
    shadowMode: getVal(fileConfig.planControl?.shadowMode, 'PLAN_CONTROL_SHADOW_MODE', toBool) ?? true,
    policyCacheMs: getVal(fileConfig.planControl?.policyCacheMs, 'PLAN_CONTROL_POLICY_CACHE_MS', toInt) || 5000,
  },

  localCache: {
    dir: getVal(fileConfig.localCache?.dir, 'LOCAL_CACHE_DIR'),
    cleanupIntervalMs: getVal(fileConfig.localCache?.cleanupIntervalMs, 'LOCAL_CACHE_CLEANUP_MS', toInt),
  },

  redis: {
    host: getVal(fileConfig.redis?.host, 'REDIS_HOST'),
    port: getVal(fileConfig.redis?.port, 'REDIS_PORT', toInt),
    password: getVal(fileConfig.redis?.password, 'REDIS_PASSWORD'),
    db: getVal(fileConfig.redis?.db, 'REDIS_DB', toInt),
    connectTimeoutMs: getVal(fileConfig.redis?.connectTimeoutMs, 'REDIS_CONNECT_TIMEOUT_MS', toInt),
    maxRetriesPerRequest: getVal(fileConfig.redis?.maxRetriesPerRequest, 'REDIS_MAX_RETRIES', toInt),
    retryDelayBase: getVal(fileConfig.redis?.retryDelayBase, 'REDIS_RETRY_DELAY_BASE', toInt),
    retryDelayMax: getVal(fileConfig.redis?.retryDelayMax, 'REDIS_RETRY_DELAY_MAX', toInt),
  },

  log: {
    level: getVal(fileConfig.logging?.level, 'LOG_LEVEL'),
    dir: getVal(fileConfig.logging?.dir, 'LOG_DIR'),
    errorLogMaxSize: fileConfig.logging?.errorLogMaxSize,
    errorLogMaxDays: fileConfig.logging?.errorLogMaxDays,
    combinedLogMaxSize: fileConfig.logging?.combinedLogMaxSize,
    combinedLogMaxDays: fileConfig.logging?.combinedLogMaxDays,
    zippedArchive: fileConfig.logging?.zippedArchive,
  },

  databases: {
    sql: {
      host: getVal(fileConfig.databases?.sql?.host, 'DB_SQL_HOST'),
      user: getVal(fileConfig.databases?.sql?.user, 'DB_SQL_USER'),
      password: getVal(fileConfig.databases?.sql?.password, 'DB_SQL_PASSWORD'),
      port: getVal(fileConfig.databases?.sql?.port, 'DB_SQL_PORT', toInt),
      database: getVal(fileConfig.databases?.sql?.database, 'DB_SQL_DATABASE'),
      tiktokdatabase: getVal(fileConfig.databases?.sql?.tiktokdatabase, 'DB_SQL_TIKTOK_DATABASE'),
      poolSize: getVal(fileConfig.databases?.sql?.poolSize, 'DB_SQL_POOL_SIZE', toInt),
      idleTimeout: fileConfig.databases?.sql?.idleTimeout,
      keepAliveInitialDelay: fileConfig.databases?.sql?.keepAliveInitialDelay,
      queueLimit: fileConfig.databases?.sql?.queueLimit,
    },
    mongo: {
      uri: getVal(fileConfig.databases?.mongo?.uri, 'DB_MONGO_URI'),
      database: getVal(fileConfig.databases?.mongo?.database, 'DB_MONGO_DATABASE'),
      poolSize: getVal(fileConfig.databases?.mongo?.poolSize, 'DB_MONGO_POOL_SIZE', toInt),
      minPoolSize: fileConfig.databases?.mongo?.minPoolSize,
      serverSelectionTimeoutMs: fileConfig.databases?.mongo?.serverSelectionTimeoutMs,
      heartbeatFrequencyMs: fileConfig.databases?.mongo?.heartbeatFrequencyMs,
    },
    elastic: {
      node: getVal(fileConfig.databases?.elastic?.node, 'DB_ELASTIC_NODE'),
      auth: {
        username: getVal(fileConfig.databases?.elastic?.username, 'DB_ELASTIC_USERNAME'),
        password: getVal(fileConfig.databases?.elastic?.password, 'DB_ELASTIC_PASSWORD'),
      },
      maxRetries: fileConfig.databases?.elastic?.maxRetries,
      requestTimeoutMs: fileConfig.databases?.elastic?.requestTimeoutMs,
    },
    elastic_tiktok: {
      node: getVal(fileConfig.databases?.elastic_tiktok?.node, 'DB_ELASTIC_TIKTOK_NODE'),
      auth: {
        username: getVal(fileConfig.databases?.elastic_tiktok?.username, 'DB_ELASTIC_TIKTOK_USERNAME'),
        password: getVal(fileConfig.databases?.elastic_tiktok?.password, 'DB_ELASTIC_TIKTOK_PASSWORD'),
      },
      maxRetries: fileConfig.databases?.elastic?.maxRetries,
      requestTimeoutMs: fileConfig.databases?.elastic?.requestTimeoutMs,
    },
  },

  serverTimeouts: {
    keepAliveTimeoutMs: getVal(fileConfig.serverTimeouts?.keepAliveTimeoutMs, 'SERVER_KEEP_ALIVE_TIMEOUT_MS', toInt),
    headersTimeoutMs: getVal(fileConfig.serverTimeouts?.headersTimeoutMs, 'SERVER_HEADERS_TIMEOUT_MS', toInt),
    maxHeadersCount: getVal(fileConfig.serverTimeouts?.maxHeadersCount, 'SERVER_MAX_HEADERS_COUNT', toInt),
    requestTimeoutMs: getVal(fileConfig.serverTimeouts?.requestTimeoutMs, 'SERVER_REQUEST_TIMEOUT_MS', toInt),
    workerGracefulShutdownMs: getVal(fileConfig.serverTimeouts?.workerGracefulShutdownMs, 'SERVER_WORKER_SHUTDOWN_MS', toInt),
  },

  apiTimeouts: {
    networkSearchTimeoutMs: getVal(fileConfig.apiTimeouts?.networkSearchTimeoutMs, 'API_NETWORK_SEARCH_TIMEOUT_MS', toInt),
  },

  // Performance controls for PUT /common/insert-update-domain-date. These
  // values intentionally come from config.json rather than environment vars.
  domainDateUpdate: {
    esSyncMaxAds: validatedInt(fileConfig.domainDateUpdate?.esSyncMaxAds, 100, true),
    sqlQueryTimeoutMs: validatedInt(fileConfig.domainDateUpdate?.sqlQueryTimeoutMs, 10000),
    esRequestTimeoutMs: validatedInt(fileConfig.domainDateUpdate?.esRequestTimeoutMs, 10000),
    // Large updates are queued and drained sequentially per network. Chunk size
    // bounds the terms query; request rate bounds the resulting ES write load.
    // Was 10000 — on a single-node cluster, a single updateByQuery with a 10k-term
    // `terms` clause makes every shard match against all 10k values, which measured
    // 20-28s per chunk in production slow logs (2026-08-17) even though the write
    // side was already throttled via esRequestsPerSecond (that only bounds re-index
    // rate, not the search/matching cost of the terms clause itself). 500 keeps each
    // chunk cheap; the queue already drains chunks sequentially per network, so this
    // only means more (much cheaper) round trips, not less total throughput.
    esTermsChunkSize: validatedInt(fileConfig.domainDateUpdate?.esTermsChunkSize, 500),
    esRequestsPerSecond: validatedInt(fileConfig.domainDateUpdate?.esRequestsPerSecond, 250),
    esTaskPollIntervalMs: validatedInt(fileConfig.domainDateUpdate?.esTaskPollIntervalMs, 5000),
    esQueueSweepIntervalMs: validatedInt(fileConfig.domainDateUpdate?.esQueueSweepIntervalMs, 5000),
    // Bound outage behavior so deferred ES work cannot exhaust host disk or
    // resubmit a permanently failing task forever.
    esQueueMaxPendingJobs: validatedInt(fileConfig.domainDateUpdate?.esQueueMaxPendingJobs, 5000),
    esQueueMaxSizeMb: validatedInt(fileConfig.domainDateUpdate?.esQueueMaxSizeMb, 512),
    esQueueMinFreeDiskMb: validatedInt(fileConfig.domainDateUpdate?.esQueueMinFreeDiskMb, 2048, true),
    esQueueMaxAttempts: validatedInt(fileConfig.domainDateUpdate?.esQueueMaxAttempts, 10),
  },

  // Time cap for the OCR/OCB lease (GET) of every network except Facebook. config.json →
  // env OCR_LEASE_MAX_EXECUTION_MS → undefined (no cap). No code default: read by each
  // src/services/<network>/ocr lease service and passed to its repository.
  ocrLease: {
    maxExecutionMs: getVal(fileConfig.ocrLease?.maxExecutionMs, 'OCR_LEASE_MAX_EXECUTION_MS', toInt),
  },

  // Load controls for GET /facebook/ocr/getFBImageUrl. Each key: config.json →
  // env FACEBOOK_OCR_* → undefined. No code defaults: read by
  // src/services/facebook/ocr/services/getImageUrlService.js, which runs the lease
  // query uncapped when leaseMaxExecutionMs is unset, and falls back to the 10-day
  // last_seen lease when leaseWindowDays or leaseBatchSize is unset/invalid.
  facebookOcr: {
    leaseMaxExecutionMs: getVal(fileConfig.facebookOcr?.leaseMaxExecutionMs, 'FACEBOOK_OCR_LEASE_MAX_EXECUTION_MS', toInt),
    leaseWindowDays: getVal(fileConfig.facebookOcr?.leaseWindowDays, 'FACEBOOK_OCR_LEASE_WINDOW_DAYS', toInt),
    leaseBatchSize: getVal(fileConfig.facebookOcr?.leaseBatchSize, 'FACEBOOK_OCR_LEASE_BATCH_SIZE', toInt),
    leaseMinIdCacheMs: getVal(fileConfig.facebookOcr?.leaseMinIdCacheMs, 'FACEBOOK_OCR_LEASE_MIN_ID_CACHE_MS', toInt),
  },

  aiMeta: {
    bulkRecommendedSize: getVal(fileConfig.aiMeta?.bulkRecommendedSize, 'AI_META_BULK_RECOMMENDED_SIZE', toInt),
    bulkMaxSize: getVal(fileConfig.aiMeta?.bulkMaxSize, 'AI_META_BULK_MAX_SIZE', toInt),
    forceRefreshNetworks: getVal(fileConfig.aiMeta?.forceRefreshNetworks, 'AI_META_FORCE_REFRESH_NETWORKS', toStringArray),
  },

  circuitBreaker: {
    failureThreshold: getVal(fileConfig.circuitBreaker?.failureThreshold, 'CB_FAILURE_THRESHOLD', toInt),
    resetTimeoutMs: getVal(fileConfig.circuitBreaker?.resetTimeoutMs, 'CB_RESET_TIMEOUT_MS', toInt),
  },

  compression: {
    threshold: getVal(fileConfig.compression?.threshold, 'COMPRESSION_THRESHOLD', toInt),
  },

  cors: {
    origin: getVal(fileConfig.cors?.origin, 'CORS_ORIGIN'),
    methods: fileConfig.cors?.methods || ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: fileConfig.cors?.allowedHeaders || ['Content-Type', 'Authorization', 'x-request-id'],
  },

  admin: {
    enabled: getVal(fileConfig.admin?.enabled, 'ADMIN_ENABLED', toBool),
    username: getVal(fileConfig.admin?.username, 'ADMIN_USERNAME'),
    password: getVal(fileConfig.admin?.password, 'ADMIN_PASSWORD'),
    sessionSecret: getVal(fileConfig.admin?.sessionSecret, 'ADMIN_SESSION_SECRET'),
    sessionMaxAgeMs: getVal(fileConfig.admin?.sessionMaxAgeMs, 'ADMIN_SESSION_MAX_AGE_MS', toInt),
    telegramBotToken: getVal(fileConfig.admin?.telegramBotToken, 'TELEGRAM_BOT_TOKEN'),
    telegramChatId: getVal(fileConfig.admin?.telegramChatId, 'TELEGRAM_CHAT_ID'),
  },

  metricsConfig: {
    enabled: getVal(fileConfig.metrics?.enabled, 'METRICS_ENABLED', toBool),
    retentionMinutes: getVal(fileConfig.metrics?.retentionMinutes, 'METRICS_RETENTION_MINUTES', toInt),
    snapshotIntervalMs: getVal(fileConfig.metrics?.snapshotIntervalMs, 'METRICS_SNAPSHOT_INTERVAL_MS', toInt),
  },

  blockedIps: {
    filePath: getVal(fileConfig.blockedIps?.filePath, 'BLOCKED_IPS_FILE_PATH') || 'data/blocked-ips.json',
  },

  cdn: {
    baseUrl: getVal(fileConfig.cdn?.baseUrl, 'CDN_BASE_URL') || '',
  },

  elasticsearch: {
    safeFrom: getVal(fileConfig.elasticsearch?.safeFrom, 'ES_SAFE_FROM', toInt) || 9000,
  },

  // ─── Insertion engine (NEW — high-throughput ad insertion) ───
  // Global tuning shared by all networks. Per-network on/off is in networks.<net>.insertion.enabled.
  insertion: {
    concurrency: getVal(fileConfig.insertion?.concurrency, 'INSERTION_CONCURRENCY', toInt) || 8,
    useWorkerThreads: getVal(fileConfig.insertion?.useWorkerThreads, 'INSERTION_USE_WORKER_THREADS', toBool) === true,
    workerThreads: getVal(fileConfig.insertion?.workerThreads, 'INSERTION_WORKER_THREADS', toInt) || 4,
    // HMAC secret for x-signature auth. config.json first, then env INSERTION_SECRET_KEY (mirrors PHP).
    secretKey: getVal(fileConfig.insertion?.secretKey, 'INSERTION_SECRET_KEY') || '',
    signatureHeader: (getVal(fileConfig.insertion?.signatureHeader, 'INSERTION_SIGNATURE_HEADER') || 'x-signature').toLowerCase(),
    // body.platform value/list that bypasses signature auth (PHP platform==12). null disables the bypass.
    allowPlatformBypass: fileConfig.insertion?.allowPlatformBypass !== undefined
      ? fileConfig.insertion.allowPlatformBypass
      : '12',
    // Secret token for the secure delete endpoint (PHP API_DELETE_TOKEN). config.json → env.
    deleteToken: getVal(fileConfig.insertion?.deleteToken, 'API_DELETE_TOKEN') || '',
    // ES field prefix carried over on UPDATE re-index (PHP TRANSLATION_FEILD).
    translationField: getVal(fileConfig.insertion?.translationField, 'TRANSLATION_FEILD') || 'facebook_translations',
    // XOR key for the encrypted `data` field on user-chk (PHP env DECRYPTION_KEY).
    decryptionKey: getVal(fileConfig.insertion?.decryptionKey, 'DECRYPTION_KEY') || '',
    // Shared NAS media-upload settings (common helper, used by all networks). config.json → env.
    nas: {
      videoUrl: getVal(fileConfig.insertion?.nas?.videoUrl, 'NAS_VIDEO_URL') || '',
      videoUploadPath: getVal(fileConfig.insertion?.nas?.videoUploadPath, 'NAS_VIDEO_UPLOAD_PATH') || '/upload',
      mediaUploadPath: getVal(fileConfig.insertion?.nas?.mediaUploadPath, 'NAS_MEDIA_UPLOAD_PATH') || '/{bucket}/upload',
      mediaUrl: getVal(fileConfig.insertion?.nas?.mediaUrl, 'NAS_MEDIA_URL') || '',
      mediaToken: getVal(fileConfig.insertion?.nas?.mediaToken, 'NAS_MEDIA_TOKEN') || '',
      // Explicit bucket override; else derived from env (production → pas-prod, otherwise pas-dev).
      bucket: getVal(fileConfig.insertion?.nas?.bucket, 'NAS_BUCKET') || '',
      verifyTls: fileConfig.insertion?.nas?.verifyTls === true,
      timeoutMs: getVal(fileConfig.insertion?.nas?.timeoutMs, 'NAS_TIMEOUT_MS', toInt) || 60000,
      // Direct-to-NAS SFTP write target — bypasses the Cloudflare-fronted media endpoint and its
      // ~100MB 413 cap (which silently dropped large fb/insta videos onto the API box's disk).
      // When sftpHost is set, storeInNas writes media straight to the NAS over SFTP.
      sftpHost: getVal(fileConfig.insertion?.nas?.sftpHost, 'NAS_SFTP_HOST') || '',
      sftpPort: getVal(fileConfig.insertion?.nas?.sftpPort, 'NAS_SFTP_PORT', toInt) || 7361,
      sftpUser: getVal(fileConfig.insertion?.nas?.sftpUser, 'NAS_SFTP_USER') || '',
      sftpPass: getVal(fileConfig.insertion?.nas?.sftpPass, 'NAS_SFTP_PASS') || '',
      sftpPoolSize: getVal(fileConfig.insertion?.nas?.sftpPoolSize, 'NAS_SFTP_POOL', toInt) || 5,
      // Master ON/OFF per media type. video=false → never download/upload/queue ad video (thumbnails
      // still store — they're images). image=false → skip images/thumbnails/postowner/carousel too.
      // Default true; false only when explicitly set to false in config.json or env NAS_STORE_*.
      store: {
        image: fileConfig.insertion?.nas?.store?.image !== false && process.env.NAS_STORE_IMAGE !== 'false',
        video: fileConfig.insertion?.nas?.store?.video !== false && process.env.NAS_STORE_VIDEO !== 'false',
      },
      // Ordered upload-transport fallback chain for ALL media (try each until one succeeds).
      // 'http' (Cloudflare mediaUrl), 'httpOrigin' (direct originUrl, no Cloudflare cap), 'sftp' (direct NAS).
      uploadTransport: (() => {
        const v = fileConfig.insertion?.nas?.uploadTransport ?? process.env.NAS_TRANSPORT_CHAIN;
        if (Array.isArray(v)) return v;
        if (typeof v === 'string' && v.trim()) {
          try { const p = JSON.parse(v); if (Array.isArray(p)) return p; } catch { /* not json */ }
          return v.split(',').map((s) => s.trim()).filter(Boolean);
        }
        return ['http', 'sftp'];
      })(),
      // Direct origin base for the 'httpOrigin' transport (bypasses Cloudflare's body cap for large video).
      originUrl: getVal(fileConfig.insertion?.nas?.originUrl, 'NAS_ORIGIN_URL') || '',
      // Per-attempt timeout for an IN-REQUEST upload (small images). Keep short so a slow NAS can't
      // stall the insertion response. Downloads use timeoutMs; background video uses queueUploadTimeoutMs.
      uploadTimeoutMs: getVal(fileConfig.insertion?.nas?.uploadTimeoutMs, 'NAS_UPLOAD_TIMEOUT_MS', toInt) || 15000,
      // Per-attempt timeout for a BACKGROUND queue upload (large video). Default 30 min — runs off-request.
      queueUploadTimeoutMs: getVal(fileConfig.insertion?.nas?.queueUploadTimeoutMs, 'NAS_QUEUE_UPLOAD_TIMEOUT_MS', toInt) || 1800000,
      // HARD cap (GB) on the data/nas-pending retry queue — prevents it filling the API box disk
      // (the 2026-06-21 outage). 0 = no cap.
      pendingMaxGB: getVal(fileConfig.insertion?.nas?.pendingMaxGB, 'NAS_PENDING_MAX_GB', toInt) ?? 10,
      // Download attempts (with backoff) before a remote media URL is given up — fixes the one-shot
      // video download that placeholdered ~20% of video ads.
      downloadRetries: getVal(fileConfig.insertion?.nas?.downloadRetries, 'NAS_DOWNLOAD_RETRIES', toInt) || 3,
      // Retention for the dedicated NAS-media diagnostics log (logs/nas-media-<date>.log). maxFiles syntax.
      logMaxDays: getVal(fileConfig.insertion?.nas?.logMaxDays, 'NAS_LOG_MAX_DAYS') || '2d',
      // NAS admin SSH (read-only) — used ONLY by the admin NAS-storage report to run `df` for
      // total/used/free. Separate from the chrooted sftpUser (no shell). config.json → env NAS_ADMIN_*.
      adminHost: getVal(fileConfig.insertion?.nas?.adminHost, 'NAS_ADMIN_HOST') || '',
      adminPort: getVal(fileConfig.insertion?.nas?.adminPort, 'NAS_ADMIN_PORT', toInt) || 7361,
      adminUser: getVal(fileConfig.insertion?.nas?.adminUser, 'NAS_ADMIN_USER') || '',
      adminPass: getVal(fileConfig.insertion?.nas?.adminPass, 'NAS_ADMIN_PASS') || '',
      adminMount: getVal(fileConfig.insertion?.nas?.adminMount, 'NAS_ADMIN_MOUNT') || '/mnt/nfs',
    },
    // Shared external-API endpoints (translation/impression/popularity/adgpt). config.json → env.
    api: {
      translationUrl: getVal(fileConfig.insertion?.api?.translationUrl, 'LANGUAGE_TRANSLATION_API') || '',
      // true (default) = PHP-faithful: a failed translation aborts metaAdsData with 503.
      // false = dev/testing: skip translation gracefully and continue inserting.
      translationRequired: fileConfig.insertion?.api?.translationRequired !== false,
      impressionUrl: getVal(fileConfig.insertion?.api?.impressionUrl, 'IMPRESSION_API') || 'https://impression.poweradspy.com/get_impressions_and_popularity',
      popularityUrl: getVal(fileConfig.insertion?.api?.popularityUrl, 'API_IMPRESSION_POPULARITY') || '',
      adgptInsertionUrl: getVal(fileConfig.insertion?.api?.adgptInsertionUrl, 'ADGPT_INSERTION_API') || '',
      adgptTimeoutMs: getVal(fileConfig.insertion?.api?.adgptTimeoutMs, 'ADGPT_TIMEOUT_MS', toInt) || 100,
      timeoutMs: getVal(fileConfig.insertion?.api?.timeoutMs, 'INSERTION_API_TIMEOUT_MS', toInt) || 15000,
    },
  },

  // ─── Copyright compliance: B1 blocklist (src/compliance/blocklist) ───
  // OFF by default, so deploying the code before the tables exist cannot stop insertion.
  // failMode 'closed' (default): a network whose blocklist could not be loaded rejects ads with 503.
  // failMode 'open': such a network lets ads through (loudly logged). Any other value means 'closed'.
  // Invalid numbers fall back to / are clamped to safe values.
  compliance: {
    blocklist: {
      enabled: getVal(fileConfig.compliance?.blocklist?.enabled, 'BLOCKLIST_ENABLED', toBool) === true,
      failMode: String(getVal(fileConfig.compliance?.blocklist?.failMode, 'BLOCKLIST_FAIL_MODE') || 'closed').toLowerCase() === 'open'
        ? 'open'
        : 'closed',
      refreshSeconds: boundedInt(getVal(fileConfig.compliance?.blocklist?.refreshSeconds, 'BLOCKLIST_REFRESH_SECONDS'), 30, 5, 3600),
      // The banned images (B2) can be tens of thousands: after the first load only the NEW ones are read, every imageRefreshSeconds;
      // every imageFullReloadSeconds they are all read again (picks up removals and expiries; a revoke does it at once).
      imageRefreshSeconds: boundedInt(fileConfig.compliance?.blocklist?.imageRefreshSeconds, 60, 5, 86400),
      imageFullReloadSeconds: boundedInt(fileConfig.compliance?.blocklist?.imageFullReloadSeconds, 900, 60, 86400),
      // Random extra delay (0..N % of refreshSeconds) per process, so a cluster's workers do not all read the databases in the same second.
      refreshJitterPercent: boundedInt(fileConfig.compliance?.blocklist?.refreshJitterPercent, 20, 0, 50),
      // With failMode 'open', log "ads are NOT being checked" at most once per this many seconds per network.
      openWarnSeconds: boundedInt(fileConfig.compliance?.blocklist?.openWarnSeconds, 60, 5, 3600),
      // Most URLs checked from one ad (a huge carousel is cut here); bounds the work per ad.
      maxUrlsPerAd: boundedInt(fileConfig.compliance?.blocklist?.maxUrlsPerAd, 200, 1, 1000),
      // Shortest advertiser name (letters and digits only) indexed for the spelling-proof match.
      compactMinLength: boundedInt(fileConfig.compliance?.blocklist?.compactMinLength, 4, 2, 20),
      loadTimeoutMs: boundedInt(fileConfig.compliance?.blocklist?.loadTimeoutMs, 5000, 500, 60000),
      pageSize: boundedInt(fileConfig.compliance?.blocklist?.pageSize, 5000, 100, 50000),
      // A refresh returning 0 rows after a non-empty list is treated as a failure (keeps the last good list).
      emptyRefreshGuard: fileConfig.compliance?.blocklist?.emptyRefreshGuard !== false,
      // Networks covered by the blocklist; empty = every insertion network that has a SQL connection.
      networks: toStringArray(fileConfig.compliance?.blocklist?.networks).map((n) => n.toLowerCase()),
      response: {
        code: boundedInt(fileConfig.compliance?.blocklist?.response?.code, 422, 400, 499),
        message: fileConfig.compliance?.blocklist?.response?.message || 'Ad rejected: this content is not allowed.',
      },
      unavailable: {
        code: boundedInt(fileConfig.compliance?.blocklist?.unavailable?.code, 503, 500, 599),
        message: fileConfig.compliance?.blocklist?.unavailable?.message || 'Ad insertion is temporarily unavailable for this network.',
      },
      attempts: {
        batchSize: boundedInt(fileConfig.compliance?.blocklist?.attempts?.batchSize, 100, 1, 1000),
        flushSeconds: boundedInt(fileConfig.compliance?.blocklist?.attempts?.flushSeconds, 5, 1, 300),
        maxQueue: boundedInt(fileConfig.compliance?.blocklist?.attempts?.maxQueue, 10000, 100, 1000000),
      },
      // Last good list is saved here so a restart while the database is down can still enforce it.
      snapshot: {
        enabled: fileConfig.compliance?.blocklist?.snapshot?.enabled !== false,
        dir: path.resolve(getVal(fileConfig.compliance?.blocklist?.snapshot?.dir, 'BLOCKLIST_SNAPSHOT_DIR')
          || path.join(__dirname, '../../data/compliance-blocklist')),
      },
      rules: {
        adId: fileConfig.compliance?.blocklist?.rules?.adId !== false,
        advertiser: fileConfig.compliance?.blocklist?.rules?.advertiser !== false,
        // Also match an advertiser written with other spacing / punctuation / accents ("twinkling tree" = "TwinklingTree").
        advertiserVariant: fileConfig.compliance?.blocklist?.rules?.advertiserVariant !== false,
        url: fileConfig.compliance?.blocklist?.rules?.url !== false,
        domain: fileConfig.compliance?.blocklist?.rules?.domain !== false,
      },
      // Per-network payload field overrides: { "*": {...}, "<network>": { adId: [...], advertiser: [...], ... } }
      fields: fileConfig.compliance?.blocklist?.fields && typeof fileConfig.compliance.blocklist.fields === 'object'
        ? fileConfig.compliance.blocklist.fields
        : {},
    },

    // ─── Copyright compliance: B2 image matching (src/compliance/imagematch) ───
    // Uses the image-hashing service (SSCD Hash API). OFF by default. The API key is read from
    // the environment only (IMAGE_HASH_API_KEY): do not put it in config.json.
    imageMatch: {
      // The exact-copy check at ingestion: every primary image (or video thumbnail) that is downloaded is looked up by its SHA-256 in the
      // banned images, in memory; a match is refused with the same answer as a blocked name. OFF by default. Needs compliance.blocklist.enabled.
      enabled: getVal(fileConfig.compliance?.imageMatch?.enabled, 'IMAGE_MATCH_ENABLED', toBool) === true,
      baseUrl: String(getVal(fileConfig.compliance?.imageMatch?.baseUrl, 'IMAGE_HASH_API_URL') || '').trim().replace(/\/+$/, ''),
      apiKey: String(process.env.IMAGE_HASH_API_KEY || '').trim(),
      // The service allows 20 s to download a URL, so a call can legitimately take longer than that.
      timeoutMs: boundedInt(fileConfig.compliance?.imageMatch?.timeoutMs, 30000, 1000, 120000),
      // Calls in flight at once (one image per call): keeps a job from flooding the service.
      concurrency: boundedInt(fileConfig.compliance?.imageMatch?.concurrency, 4, 1, 32),
      // 0 = off (always exactly `concurrency` calls at once). Above `concurrency`: the client starts at `concurrency`, adds one call at a time
      // while the service keeps answering, and halves the number when it answers 429 / 5xx / times out, never above this. Set it once the
      // hashing service's team has said how many calls it can take.
      maxConcurrency: boundedInt(fileConfig.compliance?.imageMatch?.maxConcurrency, 0, 0, 64),
      retries: boundedInt(fileConfig.compliance?.imageMatch?.retries, 2, 0, 5),
      retryDelayMs: boundedInt(fileConfig.compliance?.imageMatch?.retryDelayMs, 500, 50, 10000),
      // Images larger than this are not uploaded (the service rejects more than 50 MB).
      maxFileBytes: boundedInt(fileConfig.compliance?.imageMatch?.maxFileBytes, 50 * 1024 * 1024, 1024, 50 * 1024 * 1024),
      // Hashes made by another version cannot be compared with these: the service's /health must report this one.
      hashVersion: String(fileConfig.compliance?.imageMatch?.hashVersion || 'sscd-simhash-v1').toLowerCase(),
      // Near-copy matching (resized, recompressed, lightly cropped copies). OFF until the distances are tuned on
      // real altered copies: with it off only an exact copy (same sha256) is caught. Distances are in bits, 0..256
      // (0 = identical hash). Up to rejectDistance the image is rejected; up to reviewDistance it is held for a person.
      perceptual: {
        enabled: fileConfig.compliance?.imageMatch?.perceptual?.enabled === true,
        rejectDistance: boundedInt(fileConfig.compliance?.imageMatch?.perceptual?.rejectDistance, 0, 0, 256),
        reviewDistance: boundedInt(fileConfig.compliance?.imageMatch?.perceptual?.reviewDistance, 0, 0, 256),
      },
      // The job that hashes the images of one blocked advertiser (src/compliance/imagematch/job.js, run by the cron).
      // It reads the ad tables page by page, so these keep it gentle on the database and on the hashing service.
      job: {
        pageSize: boundedInt(fileConfig.compliance?.imageMatch?.job?.pageSize, 200, 10, 500), // ads per page
        pageDelayMs: boundedInt(fileConfig.compliance?.imageMatch?.job?.pageDelayMs, 200, 0, 60000), // pause between pages
        maxImages: boundedInt(fileConfig.compliance?.imageMatch?.job?.maxImages, 10000, 1, 1000000), // images hashed per job
        // The extra (carousel) images of an ad. OFF until the index on that table has been checked.
        includeCarousel: fileConfig.compliance?.imageMatch?.job?.includeCarousel === true,
        // Stop when this many calls in a row fail (the service is down): do not hammer it.
        maxConsecutiveFailures: boundedInt(fileConfig.compliance?.imageMatch?.job?.maxConsecutiveFailures, 20, 1, 1000),
        addBatchSize: boundedInt(fileConfig.compliance?.imageMatch?.job?.addBatchSize, 200, 1, 1000), // entries per blocklist write
        maxOwners: boundedInt(fileConfig.compliance?.imageMatch?.job?.maxOwners, 20, 1, 200), // owners one run may cover
      },
      // The worker that hashes the images of every blocked advertiser by itself. The cron job crons.jobs.imageHashJobs
      // (config.json) switches it on; these are its settings. It uses the `job` settings above for the pace of each job.
      worker: {
        // Networks it covers; empty = every network the job supports that has SQL enabled.
        networks: toStringArray(fileConfig.compliance?.imageMatch?.worker?.networks).map((n) => n.toLowerCase()),
        staleClaimMinutes: boundedInt(fileConfig.compliance?.imageMatch?.worker?.staleClaimMinutes, 60, 5, 1440), // a job with no sign of life this long is taken over
        maxAttempts: boundedInt(fileConfig.compliance?.imageMatch?.worker?.maxAttempts, 3, 1, 20), // tries before a job is marked failed
        pauseSeconds: boundedInt(fileConfig.compliance?.imageMatch?.worker?.pauseSeconds, 300, 10, 3600), // wait after a service / key problem
        newJobsPerTick: boundedInt(fileConfig.compliance?.imageMatch?.worker?.newJobsPerTick, 100, 1, 500),
        // Most jobs one pass may start (a pass has a time budget too): small advertisers finish one after another in the same pass.
        maxJobsPerTick: boundedInt(fileConfig.compliance?.imageMatch?.worker?.maxJobsPerTick, 20, 1, 200),
        maxImagesPerJob: boundedInt(fileConfig.compliance?.imageMatch?.worker?.maxImagesPerJob, 50000, 1, 1000000), // images hashed for one advertiser
        addedBy: String(fileConfig.compliance?.imageMatch?.worker?.addedBy || 'imagematch-worker').slice(0, 128),
      },
      // Stage 4: the check of NEW ads (added after it was switched on) against the banned images, run inside the same cron job.
      // A match goes to copyright_review_queue for a person; nothing is deleted or blocked. Only exact copies match until
      // `perceptual` above is enabled.
      sweep: {
        enabled: fileConfig.compliance?.imageMatch?.sweep?.enabled === true,
        // Also hash and RECORD every new image (copyright_image_hashes), even while nothing is banned: what a later complaint is searched
        // against. OFF by default: it costs one call of the hashing service (about 6 per second in total) for every new image.
        recordHashes: fileConfig.compliance?.imageMatch?.sweep?.recordHashes === true,
        pageSize: boundedInt(fileConfig.compliance?.imageMatch?.sweep?.pageSize, 100, 1, 500), // ads per page
        budgetShare: Math.min(Math.max(Number(fileConfig.compliance?.imageMatch?.sweep?.budgetShare) || 0.4, 0.1), 0.9), // part of a pass's time budget the sweep may use
      },
      // Hash and record every image already stored (copyright_image_hashes), in the time a cron pass has left after the sweep and the hashing
      // jobs. OFF by default. The service takes about 6 images per second in total: a million images is about two days of that spare time.
      backfill: {
        enabled: fileConfig.compliance?.imageMatch?.backfill?.enabled === true,
        pageSize: boundedInt(fileConfig.compliance?.imageMatch?.backfill?.pageSize, 100, 1, 500), // ads per page
        fromId: boundedInt(fileConfig.compliance?.imageMatch?.backfill?.fromId, 0, 0, Number.MAX_SAFE_INTEGER), // start after this ad id (0 = from the first ad)
      },
    },
    // The landing-page form's route (services/copyrightRequest.js, mounted at /api/v1/copyright). OFF by default, and even when
    // enabled it is mounted only with a token or an explicit allowPublic. The token is read from the environment only
    // (COPYRIGHT_REQUEST_TOKEN): do not put it in config.json.
    request: {
      enabled: fileConfig.compliance?.request?.enabled === true,
      token: String(process.env.COPYRIGHT_REQUEST_TOKEN || '').trim(),
      allowPublic: fileConfig.compliance?.request?.allowPublic === true, // knowingly open to anyone who can reach the route
      addedBy: String(fileConfig.compliance?.request?.addedBy || 'landing-form').trim().slice(0, 128) || 'landing-form', // recorded as who asked
      rateLimit: {
        windowMs: boundedInt(fileConfig.compliance?.request?.rateLimit?.windowMs, 60000, 1000, 3600000),
        max: boundedInt(fileConfig.compliance?.request?.rateLimit?.max, 10, 1, 1000), // requests per address per window
      },
    },
    // ─── Copyright claims: the evidence files (src/compliance/claims/attachments.js) ───
    // PDFs and images kept in a PRIVATE NAS bucket: never the public media bucket (insertion.nas), whose files the CDN serves to anyone with
    // the URL. OFF by default. The token is read from the environment only (COPYRIGHT_CLAIMS_NAS_TOKEN): do not put it in config.json.
    // The bucket, the endpoint and the paths come from the infrastructure team (the defaults below were checked on the real private bucket).
    // The CDN in front of the NAS caches authorized reads for 7 days; the code works around it (see attachments.js, createHttpTransport.get).
    claims: {
      // The claims themselves (src/compliance/claims/claims.js, routes in src/services/copyrightClaimsRoutes.js, mounted under /api/v1/copyright
      // only when this is on AND compliance.request is on). OFF by default. Claims are stored in ONE home database (a network's SQL
      // database); production has no central database. Two secrets, from the environment only, and they must DIFFER:
      //   COPYRIGHT_REQUEST_TOKEN        the WordPress server: it may submit a claim and read its status, nothing else
      //   COPYRIGHT_CLAIMS_ADMIN_TOKEN   the admin panel's backend: list, read, accept, reject, download files. WordPress must never have it,
      //                                  or the site could approve its own claims.
      //   COPYRIGHT_CLAIMS_STATUS_SECRET makes the status key a claimant needs to read a claim's status (a complaint id alone is no proof)
      enabled: fileConfig.compliance?.claims?.enabled === true,
      homeNetwork: String(fileConfig.compliance?.claims?.homeNetwork || 'facebook').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'facebook',
      adminToken: String(process.env.COPYRIGHT_CLAIMS_ADMIN_TOKEN || '').trim(),
      statusSecret: String(process.env.COPYRIGHT_CLAIMS_STATUS_SECRET || '').trim(),
      // Accept needs the reviewer to confirm that the supporting documents were looked at.
      requireEvidenceReviewed: fileConfig.compliance?.claims?.requireEvidenceReviewed !== false,
      attachments: {
        enabled: fileConfig.compliance?.claims?.attachments?.enabled === true,
        baseUrl: String(fileConfig.compliance?.claims?.attachments?.baseUrl || '').trim().replace(/\/+$/, ''),
        bucket: String(fileConfig.compliance?.claims?.attachments?.bucket || '').trim().replace(/[^A-Za-z0-9._-]/g, ''),
        token: String(process.env.COPYRIGHT_CLAIMS_NAS_TOKEN || '').trim(),
        uploadPath: String(fileConfig.compliance?.claims?.attachments?.uploadPath || '/{bucket}/upload'),
        // Checked on the real bucket pas-copyright-doc (media.globussoft.com): the upload answer gives the stored path /<bucket>/stream/<key>.<ext>;
        // that same path is read (with the token) and deleted. /<bucket>/<key>.<ext> answers 404 for both.
        readPath: String(fileConfig.compliance?.claims?.attachments?.readPath || '/{bucket}/stream/{key}'),
        deletePath: String(fileConfig.compliance?.claims?.attachments?.deletePath || '/{bucket}/stream/{key}'),
        // Check the NAS's certificate. Turn off only for an endpoint that is a bare IP address (no valid certificate), like the media origin.
        verifyTls: fileConfig.compliance?.claims?.attachments?.verifyTls !== false,
        timeoutMs: boundedInt(fileConfig.compliance?.claims?.attachments?.timeoutMs, 30000, 1000, 300000),
        maxFiles: boundedInt(fileConfig.compliance?.claims?.attachments?.maxFiles, 5, 1, 20), // files per claim
        maxFileBytes: boundedInt(fileConfig.compliance?.claims?.attachments?.maxFileBytes, 5 * 1024 * 1024, 1024, 25 * 1024 * 1024),
        // Only these types (checked from the file's bytes, not its name): pdf, jpg, png, webp.
        allowedTypes: (Array.isArray(fileConfig.compliance?.claims?.attachments?.allowedTypes)
          ? fileConfig.compliance.claims.attachments.allowedTypes : ['pdf', 'jpg', 'png', 'webp'])
          .map((t) => String(t).toLowerCase()).filter((t) => ['pdf', 'jpg', 'png', 'webp'].includes(t)),
        // A virus scan. With required on (the default) a file is readable only after a scan said "clean"; with no scanner connected it stays
        // "pending" and cannot be downloaded. Turn it off only after deciding that no scan is acceptable.
        scan: { required: fileConfig.compliance?.claims?.attachments?.scan?.required !== false },
      },
    },
  },

  amember: {
    apiUrl: getVal(fileConfig.amember?.apiUrl, 'AMEMBER_API_URL') || '',
    apiKey: getVal(fileConfig.amember?.apiKey, 'AMEMBER_API_KEY') || '',
    frontendUrl: getVal(fileConfig.amember?.frontendUrl, 'AMEMBER_FRONTEND_URL') || 'http://localhost:5173',
    freePlanCode: getVal(fileConfig.amember?.freePlanCode, 'AMEMBER_FREE_PLAN_CODE', toInt) || 20,
    plans: fileConfig.amember?.plans || {},
  },

  dailyKeyword: {
    newPlanUser: (() => {
      const val = getVal(fileConfig.dailyKeyword?.newPlanUser, 'NEW_PLAN_USER');
      if (!val) return [];
      try { return (Array.isArray(val) ? val : JSON.parse(val)).map(String); } catch { return []; }
    })(),
    realTimeStore: getVal(fileConfig.dailyKeyword?.realTimeStore, 'REAL_TIME_STORE') || 'on',
  },

  // ─── NEW keyword-search store (MongoDB) — additive, see docs/KEYWORD_SEARCH_REVAMP_MANIFEST.md ───
  keywordSearch: {
    enabled: getVal(fileConfig.keywordSearch?.enabled, 'KEYWORD_SEARCH_ENABLED', toBool) !== false,
    scrapeRequestUrl: getVal(fileConfig.keywordSearch?.scrapeRequestUrl, 'KEYWORD_SEARCH_SCRAPE_REQUEST_URL') || '',
    scrapeMaxAds: getVal(fileConfig.keywordSearch?.scrapeMaxAds, 'KEYWORD_SEARCH_SCRAPE_MAX_ADS', toInt) || 10,
    mongoSlug: getVal(fileConfig.keywordSearch?.mongoSlug, 'KEYWORD_SEARCH_MONGO_SLUG') || 'facebook',
    database: getVal(fileConfig.keywordSearch?.database, 'KEYWORD_SEARCH_DATABASE') || '',
    collection: getVal(fileConfig.keywordSearch?.collection, 'KEYWORD_SEARCH_COLLECTION') || 'keyword_searches',
    networks: (() => {
      const val = getVal(fileConfig.keywordSearch?.networks, 'KEYWORD_SEARCH_NETWORKS');
      const def = ['facebook', 'instagram', 'gdn', 'youtube', 'google', 'native', 'linkedin', 'reddit', 'quora', 'pinterest', 'tiktok'];
      if (!val) return def;
      try { return (Array.isArray(val) ? val : JSON.parse(val)).map(s => String(s).trim().toLowerCase()).filter(Boolean); } catch { return def; }
    })(),
    allToken: (getVal(fileConfig.keywordSearch?.allToken, 'KEYWORD_SEARCH_ALL_TOKEN') || 'all').toLowerCase(),
    defaultClaimSize: getVal(fileConfig.keywordSearch?.defaultClaimSize, 'KEYWORD_SEARCH_DEFAULT_SIZE', toInt) || 1,
    maxClaimSize: getVal(fileConfig.keywordSearch?.maxClaimSize, 'KEYWORD_SEARCH_MAX_SIZE', toInt) || 100,
    searchDatesCap: getVal(fileConfig.keywordSearch?.searchDatesCap, 'KEYWORD_SEARCH_DATES_CAP', toInt) || 30,
    staleClaimMinutes: getVal(fileConfig.keywordSearch?.staleClaimMinutes, 'KEYWORD_SEARCH_STALE_MINUTES', toInt) || 30,
    prioritySortDir: (getVal(fileConfig.keywordSearch?.prioritySortDir, 'KEYWORD_SEARCH_PRIORITY_SORT') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc',
    applyPlanGate: getVal(fileConfig.keywordSearch?.applyPlanGate, 'KEYWORD_SEARCH_APPLY_PLAN_GATE', toBool) === true,
    scraperHeader: (getVal(fileConfig.keywordSearch?.scraperHeader, 'KEYWORD_SEARCH_SCRAPER_HEADER') || 'x-scraper-name').toLowerCase(),
    autoRecoverStale: getVal(fileConfig.keywordSearch?.autoRecoverStale, 'KEYWORD_SEARCH_AUTO_RECOVER_STALE', toBool) !== false,
    staleSweepIntervalSec: getVal(fileConfig.keywordSearch?.staleSweepIntervalSec, 'KEYWORD_SEARCH_STALE_SWEEP_SEC', toInt) || 120,
    staleSweepBatch: getVal(fileConfig.keywordSearch?.staleSweepBatch, 'KEYWORD_SEARCH_STALE_SWEEP_BATCH', toInt) || 100,
    scrappingStatusRetention: getVal(fileConfig.keywordSearch?.scrappingStatusRetention, 'KEYWORD_SEARCH_SCRAPPING_STATUS_RETENTION', toInt) || 200,

    // Synthetic (manually-inserted) keywords — additive bulk-insert endpoint. Stored in the
    // SAME keyword_searches collection + doc shape, deduped by the unique (type,valueNorm)
    // index via $setOnInsert (never clobbers an existing doc). Marked solely by users=null +
    // userInfos=null (real docs always carry arrays); a later user search enriches them via
    // the unchanged store flow ($ifNull turns null→[]→[user]). `network` is MANDATORY in the
    // payload (no default) — it populates the doc's networks + networkState.
    syntheticDefaultType: getVal(fileConfig.keywordSearch?.syntheticDefaultType, 'KEYWORD_SEARCH_SYNTHETIC_DEFAULT_TYPE', toInt) || 1,
    syntheticMaxUploadMb: getVal(fileConfig.keywordSearch?.syntheticMaxUploadMb, 'KEYWORD_SEARCH_SYNTHETIC_MAX_UPLOAD_MB', toInt) || 50,
    syntheticInsertChunk: getVal(fileConfig.keywordSearch?.syntheticInsertChunk, 'KEYWORD_SEARCH_SYNTHETIC_INSERT_CHUNK', toInt) || 2000,

    // Auto-deletion (HARD capacity cap). Independently keeps each category at ≤ its cap
    // (`userCap` / `syntheticCap`). When over cap, the OLDEST docs are deleted, preferring
    // already-scraped docs first; if those aren't enough, the oldest not-yet-scraped docs are
    // deleted too, so the count always returns to exactly the cap. Enforced INLINE when new
    // data is inserted (synthetic bulk insert / a new user search); `applyTo` selects the
    // categories (or 'none' to disable). No cron.
    cleanup: {
      // Which categories the cap applies to: 'both' | 'user' | 'synthetic' | 'none'.
      // 'none' disables auto-deletion entirely. Invalid values fall back to 'both'.
      applyTo: (() => {
        const v = String(getVal(fileConfig.keywordSearch?.cleanup?.applyTo, 'KEYWORD_SEARCH_CLEANUP_APPLY_TO') || 'both').trim().toLowerCase();
        return ['both', 'user', 'synthetic', 'none'].includes(v) ? v : 'both';
      })(),
      userCap: getVal(fileConfig.keywordSearch?.cleanup?.userCap, 'KEYWORD_SEARCH_USER_CAP', toInt) || 100000,
      syntheticCap: getVal(fileConfig.keywordSearch?.cleanup?.syntheticCap, 'KEYWORD_SEARCH_SYNTHETIC_CAP', toInt) || 100000,
    },

    // Google-specific keyword-search /work behaviour. When continuousLoop is true, a Google
    // daily claim that exhausts all tiers automatically resets dailyClaimDate and tries again,
    // so Google scrapers never sit idle waiting for the next calendar day.
    google: {
      continuousLoop: getVal(fileConfig.keywordSearch?.google?.continuousLoop, 'KEYWORD_SEARCH_GOOGLE_CONTINUOUS_LOOP', toBool) !== false,
    },

    // Ad-count notification cron — scans terms scraped today, checks Elasticsearch for
    // matching ads per network, records a notification when count >= adsCountThreshold.
    notify: {
      enabled: getVal(fileConfig.keywordSearch?.notify?.enabled, 'KEYWORD_SEARCH_NOTIFY_ENABLED', toBool) !== false,
      schedule: getVal(fileConfig.keywordSearch?.notify?.schedule, 'KEYWORD_SEARCH_NOTIFY_SCHEDULE') || '15 min',
      adsCountThreshold: getVal(fileConfig.keywordSearch?.notify?.adsCountThreshold, 'KEYWORD_SEARCH_NOTIFY_THRESHOLD', toInt) || 20,
      collection: getVal(fileConfig.keywordSearch?.notify?.collection, 'KEYWORD_SEARCH_NOTIFY_COLLECTION') || 'keyword_ad_notifications',
      dateScoped: getVal(fileConfig.keywordSearch?.notify?.dateScoped, 'KEYWORD_SEARCH_NOTIFY_DATE_SCOPED', toBool) !== false,
      scanBatch: getVal(fileConfig.keywordSearch?.notify?.scanBatch, 'KEYWORD_SEARCH_NOTIFY_SCAN_BATCH', toInt) || 500,
      // Frontend "primary" read API: how many of the caller's own terms to scan per
      // request, and the poll cadence (ms, echoed back so the UI can self-pace its
      // polling). pollIntervalSec is env-tunable so ops can change it without a deploy.
      userScanLimit: getVal(fileConfig.keywordSearch?.notify?.userScanLimit, 'KEYWORD_SEARCH_NOTIFY_USER_SCAN_LIMIT', toInt) || 100,
      pollIntervalSec: getVal(fileConfig.keywordSearch?.notify?.pollIntervalSec, 'KEYWORD_SEARCH_NOTIFY_POLL_SEC', toInt) || 60,
      // First-ad push (SEARCH_CRAWL_STATUS_MANIFEST.md §4) — independent of
      // adsCountThreshold, fires once per user/term/network/day the moment adsCount >= 1.
      // Driven by a per-claim watcher spawned from scraperWork() (keywordSearchController.js)
      // the moment a term is claimed, NOT this section's cron/poll — see
      // startFirstAdPushWatcher in keywordAdNotificationController.js.
      firstAdPushEnabled: getVal(fileConfig.keywordSearch?.notify?.firstAdPushEnabled, 'KEYWORD_SEARCH_NOTIFY_FIRST_AD_PUSH_ENABLED', toBool) !== false,
      // How often (seconds) the watcher re-checks ES while a claimed term is still being
      // scraped. First check is always 1 min after the claim (not configurable); this is
      // that recurring interval after the first check.
      firstAdPushCheckIntervalSec: getVal(fileConfig.keywordSearch?.notify?.firstAdPushCheckIntervalSec, 'KEYWORD_SEARCH_NOTIFY_FIRST_AD_PUSH_CHECK_INTERVAL_SEC', toInt) || 300,
      // Who gets the first-ad push (keyword scraping watcher + Google Transparency).
      // The older 20-ad bell is NOT gated — it stays on for everyone. allUsers true
      // (default) = everyone; false = ONLY allowedUserIds. The frontend banners have
      // their own matching list (VITE_SEARCH_CRAWL_ALL_USERS / _ALLOWED_USER_IDS) —
      // keep the two in sync.
      allUsers: getVal(fileConfig.keywordSearch?.notify?.allUsers, 'KEYWORD_SEARCH_NOTIFY_ALL_USERS', toBool) !== false,
      allowedUserIds: (() => {
        const raw = getVal(fileConfig.keywordSearch?.notify?.allowedUserIds, 'KEYWORD_SEARCH_NOTIFY_ALLOWED_USER_IDS');
        if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
        if (typeof raw === 'string' && raw.trim()) return raw.split(',').map((s) => s.trim()).filter(Boolean);
        return [];
      })(),
    },
  },

  // Intelligence suite (Winning Ads / Trends / Tech & Funnel / Creative).
  // Fully additive + gated: when disabled, the router is never mounted (app.js).
  // Default OFF (opt-in) so production is unaffected until explicitly enabled.
  //   allowedUserIds: optional per-user override. Market Trends access is this
  //   allow-list OR the plan_access_config `market_trends` entitlement.
  intelligence: {
    enabled: getVal(fileConfig.intelligence?.enabled, 'INTELLIGENCE_ENABLED', toBool) === true,
    allowedUserIds: (() => {
      const raw = getVal(fileConfig.intelligence?.allowedUserIds, 'INTELLIGENCE_ALLOWED_USER_IDS');
      if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
      if (typeof raw === 'string' && raw.trim()) return raw.split(',').map((s) => s.trim()).filter(Boolean);
      return [];
    })(),
  },

  // AI Recreate + MySpace (image generation). Self-contained service, see
  // src/services/imageGen/ and docs/imageGen/MANIFEST.md. defaultCredits is an
  // explicit PLACEHOLDER flat grant — real per-plan credit allocation is deferred.
  imageGen: {
    enabled: getVal(fileConfig.imageGen?.enabled, 'IMAGEGEN_ENABLED', toBool) !== false,
    // EXCLUSIVE allow-list (same contract as chatgptads.allowedUserIds): empty =
    // everyone gets the feature (while enabled); non-empty = ONLY these user IDs
    // see AI Recreate/MySpace/Profile/credits — everyone else gets no UI and 404s.
    allowedUserIds: (() => {
      const raw = getVal(fileConfig.imageGen?.allowedUserIds, 'IMAGEGEN_ALLOWED_USER_IDS');
      if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
      if (typeof raw === 'string' && raw.trim()) return raw.split(',').map((s) => s.trim()).filter(Boolean);
      return [];
    })(),
    adStudio: {
      baseUrl: getVal(fileConfig.imageGen?.adStudio?.baseUrl, 'IMAGEGEN_ADSTUDIO_BASE_URL') || 'https://ace-adsgpt.poweradspy.ai',
      timeoutMs: validatedInt(getVal(fileConfig.imageGen?.adStudio?.timeoutMs, 'IMAGEGEN_ADSTUDIO_TIMEOUT_MS'), 45000),
      pollCacheTtlMs: validatedInt(getVal(fileConfig.imageGen?.adStudio?.pollCacheTtlMs, 'IMAGEGEN_POLL_CACHE_TTL_MS'), 3000),
    },
    aspectRatios: Array.isArray(fileConfig.imageGen?.aspectRatios) && fileConfig.imageGen.aspectRatios.length
      ? fileConfig.imageGen.aspectRatios
      : ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    defaultModel: getVal(fileConfig.imageGen?.defaultModel, 'IMAGEGEN_DEFAULT_MODEL') || null,
    watermarkDefault: getVal(fileConfig.imageGen?.watermarkDefault, 'IMAGEGEN_WATERMARK_DEFAULT', toBool) !== false,
    creditCostPerGeneration: validatedInt(getVal(fileConfig.imageGen?.creditCostPerGeneration, 'IMAGEGEN_CREDIT_COST'), 1),
    stuckJobTimeoutMinutes: validatedInt(getVal(fileConfig.imageGen?.stuckJobTimeoutMinutes, 'IMAGEGEN_STUCK_JOB_TIMEOUT_MIN'), 15),
    // Per-plan credit allowance + top-up packs — config.json is the only source
    // (see helpers/creditPlan.js and helpers/topups.js). Passed through as-is.
    credits: fileConfig.imageGen?.credits || {},
    // Data lifetime per collection (repository.js expireAt + TTL indexes).
    retention: fileConfig.imageGen?.retention || {},
    topup: fileConfig.imageGen?.topup || { enabled: false, packs: [] },
    // Recreate's "Product image" upload (POST /api/v1/imageGen/upload) — matches the
    // UI copy "JPG, PNG, WEBP up to 10MB".
    productImageMaxUploadMb: validatedInt(getVal(fileConfig.imageGen?.productImageMaxUploadMb, 'IMAGEGEN_PRODUCT_IMAGE_MAX_MB'), 10),
    // "Enhance" button (POST /recreate/enhance) — rewrites the user's draft prompt via a
    // real Claude call. OFF/inert without an apiKey (falls back to ANTHROPIC_API_KEY if
    // IMAGEGEN_ENHANCE_API_KEY isn't set); the controller 503s cleanly rather than faking
    // a rewrite when no key is configured.
    promptEnhancer: {
      enabled: getVal(fileConfig.imageGen?.promptEnhancer?.enabled, 'IMAGEGEN_ENHANCE_ENABLED', toBool) !== false,
      apiKey: getVal(fileConfig.imageGen?.promptEnhancer?.apiKey, 'IMAGEGEN_ENHANCE_API_KEY') || process.env.ANTHROPIC_API_KEY || '',
      model: getVal(fileConfig.imageGen?.promptEnhancer?.model, 'IMAGEGEN_ENHANCE_MODEL') || 'claude-haiku-4-5-20251001',
      timeoutMs: validatedInt(getVal(fileConfig.imageGen?.promptEnhancer?.timeoutMs, 'IMAGEGEN_ENHANCE_TIMEOUT_MS'), 15000),
    },
  },

  // Keywords Explorer feature (dedicated page + single-keyword modal). Additive
  // + gated: when disabled, the /keywords/* Google routes 404 so the APIs are
  // inert. Mirrors the frontend VITE_ENABLE_KEYWORD_EXPLORER flag. Default OFF
  // (opt-in) so production is unaffected until explicitly enabled.
  //   allowedUserIds: optional per-user override (same contract as
  //   intelligence.allowedUserIds). Access is this allow-list OR the
  //   plan_access_config `keyword_explorer` entitlement. Empty/unset contributes
  //   no access. JSON array in config.json or a comma-separated env value.
  keywordExplorer: {
    enabled: getVal(fileConfig.keywordExplorer?.enabled, 'KEYWORD_EXPLORER_ENABLED', toBool) === true,
    allowedUserIds: (() => {
      const raw = getVal(fileConfig.keywordExplorer?.allowedUserIds, 'KEYWORD_EXPLORER_ALLOWED_USER_IDS');
      if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
      if (typeof raw === 'string' && raw.trim()) return raw.split(',').map((s) => s.trim()).filter(Boolean);
      return [];
    })(),
  },

  // Which plan generation GET /api/v1/plans/catalog serves to the upgrade/pricing
  // modal. Display-only — never affects existing subscribers' actual entitlements
  // (those are always looked up by plan_id, regardless of this value). See
  // docs/PLAN_ACCESS.md § 2026 Pricing Restructure.
  pricing: {
    activePlanGeneration: getVal(fileConfig.pricing?.activePlanGeneration, 'PRICING_ACTIVE_PLAN_GENERATION') || '2026-restructure',
    // PRD FR-7/FR-8 §8 — pending CEO decision (lifetime vs 12 months). null = lifetime.
    // Nothing currently reads this automatically; see config.json's own description.
    legacyHeldPriceDurationMonths: getVal(fileConfig.pricing?.legacyHeldPriceDurationMonths, 'PRICING_LEGACY_HELD_PRICE_MONTHS', toInt) ?? null,
    // PRD FR-18 — annual price = monthly × this (10 = "2 months free"). Display only.
    annualPriceMultiplier: getVal(fileConfig.pricing?.annualPriceMultiplier, 'PRICING_ANNUAL_MULTIPLIER', toInt) || 10,
    // Display-only monthly/yearly prices and optional per-cycle discounts for
    // the upgrade modal. Kept separate from entitlement and billing data.
    planPrices: fileConfig.pricing?.planPrices && typeof fileConfig.pricing.planPrices === 'object'
      ? JSON.parse(JSON.stringify(fileConfig.pricing.planPrices))
      : {},
    // The ONLY source of the 2026-restructure tiers' numeric plan IDs — see
    // restructure2026.js and config.json's planIds._description for why these must
    // never be hardcoded (dev/prod can have different free IDs).
    planIds: fileConfig.pricing?.planIds ? { ...fileConfig.pricing.planIds } : {},
  },

  // AI Search — prompt → filter-payload planning proxy (fronts the DS service).
  // Additive + gated: when disabled, the router is never mounted (app.js) and the
  // frontend hides the toggle. allowedUserIds: same contract as intelligence.
  aiSearch: {
    enabled: getVal(fileConfig.aiSearch?.enabled, 'AI_SEARCH_ENABLED', toBool) === true,
    baseUrl: getVal(fileConfig.aiSearch?.baseUrl, 'AI_SEARCH_BASE_URL') || '',
    timeoutMs: getVal(fileConfig.aiSearch?.timeoutMs, 'AI_SEARCH_TIMEOUT_MS', toInt) || 15000,
    healthCacheMs: getVal(fileConfig.aiSearch?.healthCacheMs, 'AI_SEARCH_HEALTH_CACHE_MS', toInt) ?? 15000,
    pollIntervalMs: getVal(fileConfig.aiSearch?.pollIntervalMs, 'AI_SEARCH_POLL_INTERVAL_MS', toInt) || 1000,
    pollMaxMs: getVal(fileConfig.aiSearch?.pollMaxMs, 'AI_SEARCH_POLL_MAX_MS', toInt) || 60000,
    rateLimitWindowMs: getVal(fileConfig.aiSearch?.rateLimitWindowMs, 'AI_SEARCH_RATE_LIMIT_WINDOW_MS', toInt) || 60000,
    rateLimitMax: getVal(fileConfig.aiSearch?.rateLimitMax, 'AI_SEARCH_RATE_LIMIT_MAX', toInt) || 20,
    maxPromptLen: getVal(fileConfig.aiSearch?.maxPromptLen, 'AI_SEARCH_MAX_PROMPT_LEN', toInt) || 2000,
    allowedUserIds: (() => {
      const raw = getVal(fileConfig.aiSearch?.allowedUserIds, 'AI_SEARCH_ALLOWED_USER_IDS');
      if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
      if (typeof raw === 'string' && raw.trim()) return raw.split(',').map((s) => s.trim()).filter(Boolean);
      return [];
    })(),
  },

  // AdMob network visibility override. Unlike intelligence/keywordExplorer/
  // aiSearch's allow-list (which is OR'd with plan entitlement — additive),
  // this one is EXCLUSIVE: empty = no restriction (AdMob stays visible to
  // everyone per their normal plan entitlement, today's behavior). Non-empty
  // = ONLY these user IDs see AdMob at all — it's removed from every other
  // user's `allowedPlatforms`, so the tab disappears from the frontend
  // exactly like a plan that never purchased AdMob. Applied in
  // planAccessMiddleware.
  admob: {
    allowedUserIds: (() => {
      const raw = getVal(fileConfig.admob?.allowedUserIds, 'ADMOB_ALLOWED_USER_IDS');
      if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
      if (typeof raw === 'string' && raw.trim()) return raw.split(',').map((s) => s.trim()).filter(Boolean);
      return [];
    })(),
  },

  // ChatGPT Ads network visibility (testing/development gate). EXCLUSIVE allow-list:
  // empty = no restriction (the network follows normal plan entitlement — open to every
  // plan via networkRegistry's defaultPlanAccess until plan control takes over). Non-empty
  // = ONLY these user IDs see ChatGPT Ads; it is removed from every other user's
  // allowedPlatforms, so the tab disappears and its search is refused. Applied in
  // planAccessMiddleware and GET /auth/plan-access.
  //   enabled: master switch (CHATGPTADS_ENABLED). Default true; false/0 = ChatGPT Ads is
  //   removed from every user's allowedPlatforms (allow-listed users included), so the tab,
  //   its ads in "All" and its search API disappear without a frontend change.
  chatgptads: {
    enabled: (() => {
      const raw = getVal(fileConfig.chatgptads?.enabled, 'CHATGPTADS_ENABLED');
      if (raw === undefined || raw === null || raw === '') return true;
      return !(raw === false || raw === 0 || ['false', '0', 'no', 'off'].includes(String(raw).trim().toLowerCase()));
    })(),
    allowedUserIds: (() => {
      const raw = getVal(fileConfig.chatgptads?.allowedUserIds, 'CHATGPTADS_ALLOWED_USER_IDS');
      if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
      if (typeof raw === 'string' && raw.trim()) return raw.split(',').map((s) => s.trim()).filter(Boolean);
      return [];
    })(),
  },

  sendgrid: {
    enabled: getVal(fileConfig.sendgrid?.enabled, 'SENDGRID_ENABLED', toBool),
    apiKey: getVal(fileConfig.sendgrid?.apiKey, 'SENDGRID_API_KEY'),
    fromEmail: getVal(fileConfig.sendgrid?.fromEmail, 'SENDGRID_FROM_EMAIL') || 'noreply@poweradspy.com',
    fromName: getVal(fileConfig.sendgrid?.fromName, 'SENDGRID_FROM_NAME') || 'PowerAdSpy',
  },

  // compeitetor_analysis API base (e.g. https://competitor.poweradspy.com/api). Used
  // by the unsubscribe flow to record an email_send_events row there so the admin
  // dashboard's Unsubscribed tile reflects it. Optional — empty disables that step.
  competitorAnalysis: {
    apiUrl: getVal(fileConfig.competitorAnalysis?.apiUrl, 'COMPETITOR_ANALYSIS_API_URL') || '',
  },

  onboarding: {
    mode: (() => {
      const raw = String(getVal(fileConfig.onboarding?.mode, 'ONBOARDING_MODE') || 'new_users').trim().toLowerCase();
      return ['all', 'new_users', 'disabled'].includes(raw) ? raw : 'new_users';
    })(),
    newUsersAfterDate: getVal(fileConfig.onboarding?.newUsersAfterDate, 'ONBOARDING_NEW_USERS_AFTER_DATE') || '',
  },

  // Shared secret to verify signed email-unsubscribe links (HMAC-SHA256 of the
  // email). MUST equal the value compeitetor_analysis signs with (config
  // `unsubscribe_secret` / env UNSUBSCRIBE_SECRET) so a token minted in the mail
  // verifies here. When set, the unsubscribe API rejects requests without a valid
  // token — so the page works ONLY from a real mail link, not a guessed URL.
  unsubscribe: {
    secret: getVal(fileConfig.unsubscribe?.secret, 'UNSUBSCRIBE_SECRET') || '',
  },

  firebase: {
    enabled: getVal(fileConfig.firebase?.enabled, 'FIREBASE_ENABLED', toBool),
    projectId: getVal(fileConfig.firebase?.projectId, 'FIREBASE_PROJECT_ID'),
    credentialsPath: getVal(fileConfig.firebase?.credentialsPath, 'FIREBASE_CREDENTIALS_PATH') || 'firebase-credentials.json',
  },

  // ─── Centralized cron config (see config.json "crons") ───
  // Generic, reusable scheduler config. `jobs` is a map of jobKey → { enabled,
  // schedule, ...jobSpecificOpts }. The cron manager (src/jobs/cronManager.js)
  // schedules every enabled job whose key is registered in cronRegistry.js.
  crons: {
    timezone: getVal(fileConfig.crons?.timezone, 'CRONS_TIMEZONE') || fileConfig.notifications?.timezone || 'Asia/Kolkata',
    jobs: fileConfig.crons?.jobs || {},
  },

  notifications: {
    enabled: getVal(fileConfig.notifications?.enabled, 'NOTIFICATIONS_ENABLED', toBool),
    // Timezone for ALL cron times (IANA name). Default IST so "daily 12:30 AM" = India time.
    timezone: getVal(fileConfig.notifications?.timezone, 'NOTIFICATIONS_TIMEZONE') || 'Asia/Kolkata',
    // Human-friendly schedules (e.g. "1 min", "1 hour", "daily 12:30 AM") — parsed to cron in the cron job.
    pushSchedule: getVal(fileConfig.notifications?.pushSchedule, 'NOTIFICATIONS_PUSH_SCHEDULE') || '5 min',
    emailSchedule: getVal(fileConfig.notifications?.emailSchedule, 'NOTIFICATIONS_EMAIL_SCHEDULE') || 'daily 12:30 AM',
    resetSchedule: getVal(fileConfig.notifications?.resetSchedule, 'NOTIFICATIONS_RESET_SCHEDULE') || 'daily 12:30 AM',
    // Per-cron on/off toggles (default ON unless explicitly false).
    pushEnabled: getVal(fileConfig.notifications?.pushEnabled, 'NOTIFICATIONS_PUSH_ENABLED', toBool) !== false,
    emailEnabled: getVal(fileConfig.notifications?.emailEnabled, 'NOTIFICATIONS_EMAIL_ENABLED', toBool) !== false,
    resetEnabled: getVal(fileConfig.notifications?.resetEnabled, 'NOTIFICATIONS_RESET_ENABLED', toBool) !== false,
    keywordStatusEnabled: getVal(fileConfig.notifications?.keywordStatusEnabled, 'NOTIFICATIONS_KEYWORD_STATUS_ENABLED', toBool) !== false,
    // Which DB (network) + tables the notification crons read/write — all driven by config, no hardcoding.
    pendingNetwork: getVal(fileConfig.notifications?.pendingNetwork, 'NOTIFICATIONS_PENDING_NETWORK') || 'linkedin',
    pendingTable: getVal(fileConfig.notifications?.pendingTable, 'NOTIFICATIONS_PENDING_TABLE') || 'daily_keyword_requests',
    tokenNetwork: getVal(fileConfig.notifications?.tokenNetwork, 'NOTIFICATIONS_TOKEN_NETWORK') || 'facebook',
    tokenTable: getVal(fileConfig.notifications?.tokenTable, 'NOTIFICATIONS_TOKEN_TABLE') || 'am_user_action',
    inAppTable: getVal(fileConfig.notifications?.inAppTable, 'NOTIFICATIONS_INAPP_TABLE') || 'ad_notifications',
  },

  adminUserActivity: {
    username: getVal(fileConfig.adminUserActivity?.username, 'PAS_ADMIN_USERNAME'),
    password: getVal(fileConfig.adminUserActivity?.password, 'PAS_ADMIN_PASSWORD'),
  },
};


// Computed convenience properties
config.isDev = config.env !== 'production';

// ─── Hot-reload support ─────────────────────────────────────
/**
 * Reload config.json from disk and merge updated values.
 * Used by the admin panel to apply config changes at runtime.
 */
config.reload = () => {
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const newFileConfig = JSON.parse(raw);
      
      // Update rate limit
      if (newFileConfig.rateLimit) {
        if (newFileConfig.rateLimit.windowMs !== undefined) config.rateLimit.windowMs = toInt(newFileConfig.rateLimit.windowMs);
        if (newFileConfig.rateLimit.maxRequests !== undefined) config.rateLimit.maxRequests = toInt(newFileConfig.rateLimit.maxRequests);
      }

      // Update API timeouts
      if (newFileConfig.apiTimeouts) {
        if (newFileConfig.apiTimeouts.networkSearchTimeoutMs !== undefined) config.apiTimeouts.networkSearchTimeoutMs = newFileConfig.apiTimeouts.networkSearchTimeoutMs;
      }

      // Update AI-Meta bulk safeguards and refresh policy. The request handler
      // validates bulk values again before use, so a bad runtime edit cannot
      // remove the hard cap.
      if (newFileConfig.aiMeta) {
        if (newFileConfig.aiMeta.bulkRecommendedSize !== undefined) config.aiMeta.bulkRecommendedSize = toInt(newFileConfig.aiMeta.bulkRecommendedSize);
        if (newFileConfig.aiMeta.bulkMaxSize !== undefined) config.aiMeta.bulkMaxSize = toInt(newFileConfig.aiMeta.bulkMaxSize);
        if (newFileConfig.aiMeta.forceRefreshNetworks !== undefined) {
          config.aiMeta.forceRefreshNetworks = toStringArray(newFileConfig.aiMeta.forceRefreshNetworks);
        }
      }

      // OCR/OCB lease time cap (non-Facebook networks), same config.json → env precedence.
      config.ocrLease.maxExecutionMs = getVal(
        newFileConfig.ocrLease?.maxExecutionMs,
        'OCR_LEASE_MAX_EXECUTION_MS',
        toInt
      );

      // Facebook OCR lease controls. Re-resolved with the same config.json → env
      // precedence as module load, so removing a key falls back to env.
      const fbOcr = newFileConfig.facebookOcr;
      config.facebookOcr.leaseMaxExecutionMs = getVal(fbOcr?.leaseMaxExecutionMs, 'FACEBOOK_OCR_LEASE_MAX_EXECUTION_MS', toInt);
      config.facebookOcr.leaseWindowDays = getVal(fbOcr?.leaseWindowDays, 'FACEBOOK_OCR_LEASE_WINDOW_DAYS', toInt);
      config.facebookOcr.leaseBatchSize = getVal(fbOcr?.leaseBatchSize, 'FACEBOOK_OCR_LEASE_BATCH_SIZE', toInt);
      config.facebookOcr.leaseMinIdCacheMs = getVal(fbOcr?.leaseMinIdCacheMs, 'FACEBOOK_OCR_LEASE_MIN_ID_CACHE_MS', toInt);

      // Update server timeouts
      if (newFileConfig.serverTimeouts) {
        Object.assign(config.serverTimeouts, newFileConfig.serverTimeouts);
      }

      // Update cluster settings
      if (newFileConfig.cluster) {
        if (newFileConfig.cluster.maxRestarts !== undefined) config.cluster.maxRestarts = toInt(newFileConfig.cluster.maxRestarts);
        if (newFileConfig.cluster.restartWindowMs !== undefined) config.cluster.restartWindowMs = toInt(newFileConfig.cluster.restartWindowMs);
      }

      // Update circuit breaker
      if (newFileConfig.circuitBreaker) {
        Object.assign(config.circuitBreaker, newFileConfig.circuitBreaker);
      }

      // Update admin
      if (newFileConfig.admin) {
        Object.assign(config.admin, newFileConfig.admin);
      }

      // Update metrics
      if (newFileConfig.metrics) {
        if (newFileConfig.metrics.enabled !== undefined) config.metricsConfig.enabled = newFileConfig.metrics.enabled;
        if (newFileConfig.metrics.retentionMinutes !== undefined) config.metricsConfig.retentionMinutes = newFileConfig.metrics.retentionMinutes;
      }

      // Update compression
      if (newFileConfig.compression) {
        Object.assign(config.compression, newFileConfig.compression);
      }

      // Update CORS
      if (newFileConfig.cors) {
        Object.assign(config.cors, newFileConfig.cors);
      }

      // Update logging
      if (newFileConfig.logging) {
        if (newFileConfig.logging.level) config.log.level = newFileConfig.logging.level;
      }

      // Update pricing (which plan generation the upgrade modal shows)
      if (newFileConfig.pricing?.activePlanGeneration !== undefined) {
        config.pricing.activePlanGeneration = newFileConfig.pricing.activePlanGeneration;
      }
      if (newFileConfig.pricing?.legacyHeldPriceDurationMonths !== undefined) {
        config.pricing.legacyHeldPriceDurationMonths = newFileConfig.pricing.legacyHeldPriceDurationMonths;
      }
      if (newFileConfig.pricing?.annualPriceMultiplier !== undefined) {
        config.pricing.annualPriceMultiplier = toInt(newFileConfig.pricing.annualPriceMultiplier);
      }
      if (newFileConfig.pricing?.planPrices !== undefined) {
        config.pricing.planPrices = newFileConfig.pricing.planPrices && typeof newFileConfig.pricing.planPrices === 'object'
          ? JSON.parse(JSON.stringify(newFileConfig.pricing.planPrices))
          : {};
      }
      if (newFileConfig.pricing?.planIds !== undefined) {
        config.pricing.planIds = { ...newFileConfig.pricing.planIds };
      }

      if (newFileConfig.onboarding?.mode !== undefined) {
        const raw = String(newFileConfig.onboarding.mode || '').trim().toLowerCase();
        config.onboarding.mode = ['all', 'new_users', 'disabled'].includes(raw) ? raw : 'new_users';
      }
      if (newFileConfig.onboarding?.newUsersAfterDate !== undefined) {
        config.onboarding.newUsersAfterDate = newFileConfig.onboarding.newUsersAfterDate || '';
      }

      return true;
    }
  } catch (err) {
    console.error(`[config] Failed to reload config.json: ${err.message}`);
    return false;
  }
};

/**
 * Get the raw config.json file content (for admin UI display).
 */
config.getRawFileConfig = () => {
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error(`[config] Failed to read config.json: ${err.message}`);
  }
  return {};
};

/**
 * Write new config values to config.json.
 * Automatically archives the previous config.json into data/config_backups (max 10 files).
 * @param {Object} newConfig - The full config object to write
 */
config.writeConfigFile = (newConfig) => {
  try {
    // Backup existing file before overwrite
    if (fs.existsSync(configPath)) {
      const backupDir = path.resolve(path.dirname(configPath), 'data', 'config_backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      
      const timestamp = Date.now();
      const backupPath = path.join(backupDir, `config_${timestamp}.json`);
      fs.copyFileSync(configPath, backupPath);

      // Prune backups to keep only the latest 10
      const backups = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('config_') && f.endsWith('.json'))
        .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtime.getTime() }))
        .sort((a, b) => b.time - a.time);

      if (backups.length > 10) {
        const toDelete = backups.slice(10);
        for (const fileObj of toDelete) {
          try {
            fs.unlinkSync(path.join(backupDir, fileObj.name));
          } catch (e) {
            console.error(`[config] Failed to delete old backup ${fileObj.name}`, e);
          }
        }
      }
    }

    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf-8');
    config.reload();
    return true;
  } catch (err) {
    console.error(`[config] Failed to write config.json: ${err.message}`);
    return false;
  }
};

module.exports = config;
