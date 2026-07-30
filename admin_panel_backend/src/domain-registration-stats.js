require('dotenv').config();
const queryDatabase = require('../db-connections/connection');
const cache = require('../utils/cache');

/**
 * Daily "Domain Registration Date" processing statistics, per platform.
 *
 * The domain-registration-date crawler is a two-endpoint loop in pas_node_api:
 *   1. GET  /api/v1/common/get-domains-without-registration-date  → hands out PENDING domains
 *   2. PUT  /api/v1/common/insert-update-domain-date              → writes the WHOIS date, or
 *                                                                   marks the domain unresolvable
 * Neither endpoint keeps a run log, so the numbers are read straight off the source of truth:
 * each network's domains table, whose `status` column is exactly the loop's outcome flag.
 *
 *   status 0 PENDING       still queued (NULL date, never attempted / re-queued)
 *   status 1 RESOLVED      a registration date was found and written   → "Updated"
 *   status 2 UNRESOLVABLE  attempted, no date obtainable (dead/redacted) → "Failed"
 *
 * So per day:  processed = rows the loop touched (status 1 or 2), updated = status 1,
 * failed = status 2. Rows still at status 0 were never processed and are reported separately
 * as the pending backlog.
 *
 * BUCKET COLUMN — which timestamp says "processed on day X" differs per network (verified
 * against the live dev schema, not assumed):
 * `updated_date TIMESTAMP ... ON UPDATE CURRENT_TIMESTAMP` is the standard: any write to the
 * row (including the status/date write) stamps it. 8 of the 10 tables have it today, and
 * facebook + linkedin are getting it, so all ten declare it. Until those two migrations land
 * each falls back to the only stamp its table currently has:
 *   - linkedin_ad_domains → `updated_at` (same semantics, just the older name — so its numbers
 *     are already accurate and the migration is a rename, not a fix).
 *   - facebook_ad_domains → `dod_date` ("date of domain" fetch time), which is NOT
 *     auto-maintained and is never written by the update service. Status-2 rows therefore carry
 *     no stamp and drop out of the daily buckets, so Facebook's per-day figures — its Failed
 *     column especially — under-report until `updated_date` exists.
 * resolveBucketColumn reads the live schema, so each switches over on its own once migrated.
 * TikTok is excluded on purpose — it has no SQL domains table.
 *
 * SNAPSHOT, NOT A RUN LOG. The bucket column records a row's *latest* write, so a domain
 * processed on Monday and re-processed on Tuesday is counted on Tuesday only. Each day's
 * figure is therefore "domains whose most recent processing landed on that day", and past
 * days can shrink as the crawler revisits domains. Exact per-attempt history would need the
 * update endpoint to write an append-only log, which it does not do today.
 */

// db_id / index follow the same per-network mapping the other analytics modules use
// (src/types-anaytics.js, src/ad-position-analytics.js, ...). Key order is the platform
// order the admin panel displays.
const DOMAIN_NETWORKS = {
  // facebook and linkedin are mid-migration: both are getting the standard `updated_date`
  // column, so both declare it. Until it lands they fall back to the only stamp each table
  // has today — dod_date and updated_at respectively. The live schema picks; see
  // resolveBucketColumn.
  facebook:  { label: 'Facebook',  table: 'facebook_ad_domains',    bucketColumn: 'updated_date', fallbackBucketColumn: 'dod_date',   db_id: 0, index: process.env.FB_DATABASE },
  instagram: { label: 'Instagram', table: 'instagram_ad_domain',    bucketColumn: 'updated_date', db_id: 8, index: process.env.INSTA_DATABASE },
  google:    { label: 'Google',    table: 'google_text_ad_domains', bucketColumn: 'updated_date', db_id: 9, index: process.env.GT_DATABASE },
  youtube:   { label: 'YouTube',   table: 'youtube_ad_domains',     bucketColumn: 'updated_date', db_id: 1, index: process.env.YT_DATABASE },
  gdn:       { label: 'GDN',       table: 'gdn_ad_domains',         bucketColumn: 'updated_date', db_id: 5, index: process.env.GDN_DATABASE },
  linkedin:  { label: 'LinkedIn',  table: 'linkedin_ad_domains',    bucketColumn: 'updated_date', fallbackBucketColumn: 'updated_at', db_id: 2, index: process.env.LINKEDIN_DATABASE },
  reddit:    { label: 'Reddit',    table: 'reddit_ad_domain',       bucketColumn: 'updated_date', db_id: 4, index: process.env.REDDIT_DATABASE },
  quora:     { label: 'Quora',     table: 'quora_ad_domain',        bucketColumn: 'updated_date', db_id: 7, index: process.env.QUORA_DATABASE },
  pinterest: { label: 'Pinterest', table: 'pinterest_ad_domains',   bucketColumn: 'updated_date', db_id: 6, index: process.env.PINT_DATABASE },
  native:    { label: 'Native',    table: 'native_ad_domains',      bucketColumn: 'updated_date', db_id: 3, index: process.env.NATIVE_DATABASE },
};

const NETWORK_KEYS = Object.keys(DOMAIN_NETWORKS);

const STATUS = { PENDING: 0, RESOLVED: 1, UNRESOLVABLE: 2 };
// No cap on how wide a range may be: none of the bucket columns is indexed, so the daily
// query is a full table scan whatever the range (EXPLAIN reports type=ALL, key=null on every
// network) — a narrow range costs the same as a wide one. The response grows by one row per
// day per network, which is the only thing a limit would have bounded.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_TTL_SEC = 120;
// Schema shape changes far less often than the data; re-probed every 10 min so a migration is
// picked up on its own without needing a restart.
const BUCKET_COLUMN_TTL_SEC = 600;

const num = (v) => Number(v || 0);

/**
 * Which timestamp column to bucket a network's rows by.
 *
 * Networks with a `fallbackBucketColumn` are ones whose preferred column is not in the schema
 * yet (facebook and linkedin). The live schema decides: the preferred column is used the
 * moment it exists, otherwise the fallback keeps the platform reporting instead of erroring on
 * an unknown column. The answer is cached, so the switch happens on its own within the TTL of
 * the migration landing — no code change or restart needed. The column actually used is
 * reported back as `bucket_column`.
 */
async function resolveBucketColumn(cfg) {
  if (!cfg.fallbackBucketColumn) return cfg.bucketColumn;

  const cacheKey = `domainRegBucketCol-${cfg.table}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let column = cfg.fallbackBucketColumn;
  try {
    const rows = await queryDatabase(
      cfg.db_id, cfg.index,
      `SELECT COLUMN_NAME FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ? AND COLUMN_NAME = ? LIMIT 1`,
      [cfg.index, cfg.table, cfg.bucketColumn]
    );
    if (Array.isArray(rows) && rows.length) column = cfg.bucketColumn;
  } catch (err) {
    // Schema probe failed — fall back rather than take the whole platform down with it.
    console.error(`domain-registration-stats: bucket column probe for ${cfg.table} failed —`, err.message);
  }

  cache.set(cacheKey, column, BUCKET_COLUMN_TTL_SEC);
  return column;
}

/**
 * Per-day processed/updated/failed counts for one network, plus the whole-table status
 * breakdown (the still-queued backlog). Both queries are parameterised and bounded to the
 * requested range; the status breakdown rides the idx_domain_status index the crawler
 * migration added, so it stays cheap on big tables.
 */
async function getNetworkDailyStats(network, range) {
  const cfg = DOMAIN_NETWORKS[network];
  const { label, table, db_id, index } = cfg;
  const bucketColumn = await resolveBucketColumn(cfg);

  // DATE_FORMAT (not DATE()) so the day/timestamp cross the wire as plain strings — a JS Date
  // would be re-interpreted in the server's local zone and could slide a row into the wrong day.
  const dailySql = `
    SELECT DATE_FORMAT(\`${bucketColumn}\`, '%Y-%m-%d') AS day,
           COUNT(*) AS processed_count,
           SUM(\`status\` = ${STATUS.RESOLVED}) AS updated_count,
           SUM(\`status\` = ${STATUS.UNRESOLVABLE}) AS failed_count,
           DATE_FORMAT(MAX(\`${bucketColumn}\`), '%Y-%m-%d %H:%i:%s') AS last_updated
    FROM \`${table}\`
    WHERE \`${bucketColumn}\` BETWEEN ? AND ?
      AND \`status\` IN (${STATUS.RESOLVED}, ${STATUS.UNRESOLVABLE})
    GROUP BY day
    ORDER BY day DESC`;

  const backlogSql = `SELECT \`status\` AS status, COUNT(*) AS cnt FROM \`${table}\` GROUP BY \`status\``;

  const [dailyRows, backlogRows] = await Promise.all([
    queryDatabase(db_id, index, dailySql, [`${range.from} 00:00:00`, `${range.to} 23:59:59`]),
    queryDatabase(db_id, index, backlogSql),
  ]);

  const daily = (dailyRows || []).map((r) => ({
    date: r.day,
    processed_count: num(r.processed_count),
    updated_count: num(r.updated_count),
    failed_count: num(r.failed_count),
    last_updated: r.last_updated || null,
  }));

  const totals = daily.reduce(
    (acc, d) => ({
      processed: acc.processed + d.processed_count,
      updated: acc.updated + d.updated_count,
      failed: acc.failed + d.failed_count,
      // daily is ordered newest-first, so the first non-null stamp is the latest one
      last_updated: acc.last_updated || d.last_updated,
    }),
    { processed: 0, updated: 0, failed: 0, last_updated: null }
  );

  const byStatus = new Map((backlogRows || []).map((r) => [num(r.status), num(r.cnt)]));
  const backlog = {
    pending: byStatus.get(STATUS.PENDING) || 0,
    resolved: byStatus.get(STATUS.RESOLVED) || 0,
    unresolvable: byStatus.get(STATUS.UNRESOLVABLE) || 0,
    total: [...byStatus.values()].reduce((a, b) => a + b, 0),
  };

  return {
    network,
    label,
    table,
    bucket_column: bucketColumn,
    daily,
    totals,
    backlog,
    error: null,
  };
}

// A network whose DB is down must not sink the other nine — it comes back as an error row
// with zeroed counters, exactly like the fleet-wide infra endpoint does.
async function safeNetworkStats(network, range) {
  try {
    return await getNetworkDailyStats(network, range);
  } catch (err) {
    console.error(`domain-registration-stats: ${network} failed —`, err.message);
    const cfg = DOMAIN_NETWORKS[network];
    return {
      network,
      label: cfg.label,
      table: cfg.table,
      bucket_column: cfg.bucketColumn,
      daily: [],
      totals: { processed: 0, updated: 0, failed: 0, last_updated: null },
      backlog: null,
      error: err.message,
    };
  }
}

function validate(body) {
  const range = body && body.range;
  if (!range || !range.from || !range.to) {
    return { error: 'Missing required field: range { from, to }' };
  }
  if (!DATE_RE.test(String(range.from)) || !DATE_RE.test(String(range.to))) {
    return { error: 'range.from and range.to must be YYYY-MM-DD dates' };
  }
  const from = Date.parse(`${range.from}T00:00:00Z`);
  const to = Date.parse(`${range.to}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return { error: 'range.from and range.to must be valid dates' };
  }
  if (from > to) {
    return { error: 'range.from must not be after range.to' };
  }
  const days = Math.round((to - from) / 86400000) + 1;

  let networks = NETWORK_KEYS;
  if (body.networks != null) {
    if (!Array.isArray(body.networks) || body.networks.length === 0) {
      return { error: 'networks must be a non-empty array of platform keys' };
    }
    const asked = body.networks.map((n) => String(n).toLowerCase());
    const unknown = asked.filter((n) => !DOMAIN_NETWORKS[n]);
    if (unknown.length) {
      return { error: `Unsupported network(s): ${unknown.join(', ')}. Available: ${NETWORK_KEYS.join(', ')}` };
    }
    // keep the canonical display order regardless of the order asked for
    networks = NETWORK_KEYS.filter((n) => asked.includes(n));
  }

  return { range: { from: String(range.from), to: String(range.to) }, networks, days };
}

/**
 * POST /admin-panel/domain-registration-stats/daily
 * Body: { range: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }, networks?: ['facebook', ...] }
 */
const dailyDomainRegistrationStats = async (req, res) => {
  try {
    const parsed = validate(req.body);
    if (parsed.error) {
      return res.status(400).json({ code: 400, error: parsed.error });
    }
    const { range, networks, days } = parsed;

    const cacheKey = `domainRegStats-${range.from}-${range.to}-${networks.join(',')}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }

    const results = await Promise.all(networks.map((n) => safeNetworkStats(n, range)));

    const summary = results.reduce(
      (acc, r) => ({
        processed: acc.processed + r.totals.processed,
        updated: acc.updated + r.totals.updated,
        failed: acc.failed + r.totals.failed,
        pending: acc.pending + (r.backlog ? r.backlog.pending : 0),
        networks_ok: acc.networks_ok + (r.error ? 0 : 1),
        networks_failed: acc.networks_failed + (r.error ? 1 : 0),
      }),
      { processed: 0, updated: 0, failed: 0, pending: 0, networks_ok: 0, networks_failed: 0 }
    );

    const payload = {
      code: 200,
      data: {
        range,
        days,
        generated_at: new Date().toISOString(),
        summary,
        networks: results,
      },
    };

    cache.set(cacheKey, payload, CACHE_TTL_SEC);
    return res.status(200).json(payload);
  } catch (error) {
    console.error('Error fetching domain registration stats:', error);
    return res.status(500).json({ code: 500, error: 'Internal Server Error' });
  }
};

module.exports = {
  dailyDomainRegistrationStats,
  getNetworkDailyStats,
  DOMAIN_NETWORKS,
  NETWORK_KEYS,
};
