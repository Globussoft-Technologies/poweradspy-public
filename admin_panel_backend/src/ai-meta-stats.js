require('dotenv').config();
const queryDatabase = require('../db-connections/connection');
const cache = require('../utils/cache');

/**
 * Daily AI-Meta processing statistics, per platform.
 *
 * Source: each network's `<net>_ad_ai_meta` table — the durable SQL copy of the AI-Meta
 * enrichment (ad_type, offering, category, intent, hook, ...), one row per ad, unique on
 * `<net>_ad_id`. Rows are bucketed by `updated_at`, a
 * `TIMESTAMP ... ON UPDATE CURRENT_TIMESTAMP` column on both tables, so it moves whenever the
 * pipeline writes a row — which is exactly "this ad was processed then".
 *
 * ONLY WHAT THE TABLE KNOWS. These tables carry no status, error or retry column: a row exists
 * if and only if enrichment produced something. There is therefore no failure signal to report,
 * and nothing here infers one — the numbers are the count of ads written and the newest write
 * time. (A failed attempt leaves no trace in SQL at all; recording one would need a status
 * column or a job log on the pipeline side.)
 *
 * SNAPSHOT, NOT A RUN LOG. `updated_at` holds a row's *latest* write, so an ad enriched today
 * and re-enriched tomorrow counts on tomorrow only. Each day is "ads whose most recent AI-Meta
 * write landed that day", and past days can shrink as ads are re-processed.
 *
 * Only facebook and instagram are covered — they are the networks with an `*_ad_ai_meta` table.
 */

// db_id / index follow the same per-network mapping the other analytics modules use.
const AI_META_NETWORKS = {
  facebook:  { label: 'Facebook',  table: 'facebook_ad_ai_meta',  adIdColumn: 'facebook_ad_id',  db_id: 0, index: process.env.FB_DATABASE },
  instagram: { label: 'Instagram', table: 'instagram_ad_ai_meta', adIdColumn: 'instagram_ad_id', db_id: 8, index: process.env.INSTA_DATABASE },
};

const NETWORK_KEYS = Object.keys(AI_META_NETWORKS);

const BUCKET_COLUMN = 'updated_at';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_TTL_SEC = 120;

const num = (v) => Number(v || 0);

/**
 * Per-day count of ads written to one network's AI-Meta table, plus the newest write time.
 * DATE_FORMAT (not DATE()) keeps the day and timestamp as plain strings — a JS Date would be
 * re-read in the server's local zone and could slide a row into the wrong day.
 */
async function getNetworkAiMetaStats(network, range) {
  const { label, table, db_id, index } = AI_META_NETWORKS[network];

  const sql = `
    SELECT DATE_FORMAT(\`${BUCKET_COLUMN}\`, '%Y-%m-%d') AS day,
           COUNT(*) AS updated_count,
           DATE_FORMAT(MAX(\`${BUCKET_COLUMN}\`), '%Y-%m-%d %H:%i:%s') AS last_updated
    FROM \`${table}\`
    WHERE \`${BUCKET_COLUMN}\` BETWEEN ? AND ?
    GROUP BY day
    ORDER BY day DESC`;

  const rows = await queryDatabase(db_id, index, sql, [
    `${range.from} 00:00:00`,
    `${range.to} 23:59:59`,
  ]);

  const daily = (rows || []).map((r) => ({
    date: r.day,
    updated_count: num(r.updated_count),
    last_updated: r.last_updated || null,
  }));

  const totals = daily.reduce(
    (acc, d) => ({
      updated: acc.updated + d.updated_count,
      // daily is ordered newest-first, so the first stamp is the latest one
      last_updated: acc.last_updated || d.last_updated,
    }),
    { updated: 0, last_updated: null }
  );

  return { network, label, table, bucket_column: BUCKET_COLUMN, daily, totals, error: null };
}

// One unreachable network must not sink the other — it comes back as an error row with zeroed
// counters, the same way the domain-registration stats endpoint degrades.
async function safeNetworkStats(network, range) {
  try {
    return await getNetworkAiMetaStats(network, range);
  } catch (err) {
    console.error(`ai-meta-stats: ${network} failed —`, err.message);
    const cfg = AI_META_NETWORKS[network];
    return {
      network,
      label: cfg.label,
      table: cfg.table,
      bucket_column: BUCKET_COLUMN,
      daily: [],
      totals: { updated: 0, last_updated: null },
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

  let networks = NETWORK_KEYS;
  if (body.networks != null) {
    if (!Array.isArray(body.networks) || body.networks.length === 0) {
      return { error: 'networks must be a non-empty array of platform keys' };
    }
    const asked = body.networks.map((n) => String(n).toLowerCase());
    const unknown = asked.filter((n) => !AI_META_NETWORKS[n]);
    if (unknown.length) {
      return { error: `Unsupported network(s): ${unknown.join(', ')}. Available: ${NETWORK_KEYS.join(', ')}` };
    }
    networks = NETWORK_KEYS.filter((n) => asked.includes(n));
  }

  const days = Math.round((to - from) / 86400000) + 1;
  return { range: { from: String(range.from), to: String(range.to) }, networks, days };
}

/**
 * POST /admin-panel/ai-meta-stats/daily
 * Body: { range: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }, networks?: ['facebook','instagram'] }
 */
const dailyAiMetaStats = async (req, res) => {
  try {
    const parsed = validate(req.body);
    if (parsed.error) {
      return res.status(400).json({ code: 400, error: parsed.error });
    }
    const { range, networks, days } = parsed;

    const cacheKey = `aiMetaStats-${range.from}-${range.to}-${networks.join(',')}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }

    const results = await Promise.all(networks.map((n) => safeNetworkStats(n, range)));

    const summary = results.reduce(
      (acc, r) => ({
        updated: acc.updated + r.totals.updated,
        networks_ok: acc.networks_ok + (r.error ? 0 : 1),
        networks_failed: acc.networks_failed + (r.error ? 1 : 0),
      }),
      { updated: 0, networks_ok: 0, networks_failed: 0 }
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
    console.error('Error fetching AI-Meta stats:', error);
    return res.status(500).json({ code: 500, error: 'Internal Server Error' });
  }
};

module.exports = {
  dailyAiMetaStats,
  getNetworkAiMetaStats,
  AI_META_NETWORKS,
  NETWORK_KEYS,
};
