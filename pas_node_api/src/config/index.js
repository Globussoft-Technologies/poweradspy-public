'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');

// ─── Load config.json ───────────────────────────────────────
let fileConfig = {};
const configPath = path.resolve(process.cwd(), 'config.json');

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

  circuitBreaker: {
    failureThreshold: getVal(fileConfig.circuitBreaker?.failureThreshold, 'CB_FAILURE_THRESHOLD', toInt),
    resetTimeoutMs: getVal(fileConfig.circuitBreaker?.resetTimeoutMs, 'CB_RESET_TIMEOUT_MS', toInt),
  },

  compression: {
    threshold: getVal(fileConfig.compression?.threshold, 'COMPRESSION_THRESHOLD', toInt),
  },

  cors: {
    origin: getVal(fileConfig.cors?.origin, 'CORS_ORIGIN'),
    methods: fileConfig.cors?.methods || ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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
    // body.platform value that bypasses signature auth (PHP platform==12). null disables the bypass.
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
    },
  },

  // Intelligence suite (Winning Ads / Trends / Tech & Funnel / Creative).
  // Fully additive + gated: when disabled, the router is never mounted (app.js).
  // Default OFF (opt-in) so production is unaffected until explicitly enabled.
  //   allowedUserIds: optional allow-list of user ids. When non-empty, ONLY
  //   those users get the feature + tab (everyone else is 403'd and the UI hides
  //   it). Empty/unset = all authenticated users (when `enabled`). Accepts a
  //   JSON array in config.json or a comma-separated string in the env var.
  intelligence: {
    enabled: getVal(fileConfig.intelligence?.enabled, 'INTELLIGENCE_ENABLED', toBool) === true,
    allowedUserIds: (() => {
      const raw = getVal(fileConfig.intelligence?.allowedUserIds, 'INTELLIGENCE_ALLOWED_USER_IDS');
      if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
      if (typeof raw === 'string' && raw.trim()) return raw.split(',').map((s) => s.trim()).filter(Boolean);
      return [];
    })(),
  },

  // Keywords Explorer feature (dedicated page + single-keyword modal). Additive
  // + gated: when disabled, the /keywords/* Google routes 404 so the APIs are
  // inert. Mirrors the frontend VITE_ENABLE_KEYWORD_EXPLORER flag. Default OFF
  // (opt-in) so production is unaffected until explicitly enabled.
  //   allowedUserIds: optional per-user allow-list (same contract as
  //   intelligence.allowedUserIds). When non-empty, ONLY those users get the
  //   feature + APIs (everyone else is 403'd and the UI hides it). Empty/unset =
  //   all authenticated users (when `enabled`). JSON array in config.json or a
  //   comma-separated string in the env var.
  keywordExplorer: {
    enabled: getVal(fileConfig.keywordExplorer?.enabled, 'KEYWORD_EXPLORER_ENABLED', toBool) === true,
    allowedUserIds: (() => {
      const raw = getVal(fileConfig.keywordExplorer?.allowedUserIds, 'KEYWORD_EXPLORER_ALLOWED_USER_IDS');
      if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
      if (typeof raw === 'string' && raw.trim()) return raw.split(',').map((s) => s.trim()).filter(Boolean);
      return [];
    })(),
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
      const backupDir = path.resolve(process.cwd(), 'data', 'config_backups');
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
