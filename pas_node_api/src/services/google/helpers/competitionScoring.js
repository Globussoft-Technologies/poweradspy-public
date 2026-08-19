'use strict';

/**
 * competition_score computation — pure, side-effect-free. Deliberately its
 * OWN small module, not part of scripts/refresh-keyword-stats-safe.js
 * (where this logic originally lived), because that script has top-level
 * side effects that run the instant it's `require()`'d — NOT gated behind
 * its `require.main === module` CLI guard:
 *   - `process.on('SIGINT', ...)` / `process.on('SIGTERM', ...)` register
 *     signal handlers on whatever process requires it.
 *   - `require('dotenv').config()` re-applies .env into process.env.
 * None of that belongs running inside the long-lived pas_node_api server
 * process just because jobs/competitionScoreCron.js wants one function from
 * it. This module has no top-level statements beyond plain requires/consts,
 * so requiring it is inert — it can only ever do what its exported
 * functions are explicitly called to do.
 *
 * Both scripts/refresh-keyword-stats-safe.js (the CLI/batch-sweep job) and
 * jobs/competitionScoreCron.js (the lightweight standalone cron) import
 * FROM here — one implementation, two independent callers, no coupling
 * between them.
 */

const logger = require('../../../logger');

const log = logger.createChild('competition-scoring');

// Chunk size + a small pause between chunks — same "small batch, brief
// sleep, repeat" shape used everywhere else in this codebase for exactly
// this reason (see scripts/refresh-keyword-stats-safe.js's own adaptive
// batching). Small enough that scripts/refresh-keyword-stats-safe.js's own
// continuous UPSERTs into this same table (it runs in a --loop, writing
// every few seconds) always get a gap to interleave in, instead of queuing
// behind one long-held lock.
const SCORE_BATCH = 5000;
const CHUNK_SLEEP_MS = 250;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Single set-based UPDATE using window functions — computationally cheap
 * (only touches keyword_stats_unique, the small ~500k-1M-row rollup, never
 * the 42M-row ad corpus) but NOT lightweight in the way that matters here:
 * it's ONE transaction touching every row in the table, holding row locks
 * for its full duration. scripts/refresh-keyword-stats-safe.js's own
 * incremental UPSERTs into this exact table run continuously (every few
 * seconds) — a single mega-UPDATE would queue behind/block those writers
 * for as long as it takes to touch every row. NOT called automatically
 * (recomputeCompetitionScores below always uses the chunked path) — kept
 * only for a deliberate, manual one-off run where a human has confirmed
 * it's an acceptable moment for one longer-held update.
 */
async function recomputeCompetitionScoresSql(sql) {
  const [countRow] = await sql.query('SELECT COUNT(*) AS c FROM keyword_stats_unique');
  const totalRows = Number(countRow.c || 0);
  if (!totalRows) return 0;
  await sql.query(`
    UPDATE keyword_stats_unique ks
    JOIN (
      SELECT keyword,
             CASE
               WHEN total_rows = 1 THEN 100
               ELSE ROUND(((row_num - 1) / (total_rows - 1)) * 100)
             END AS score
        FROM (
          SELECT keyword,
                 ROW_NUMBER() OVER (ORDER BY advertisers_total ASC, keyword ASC) AS row_num,
                 COUNT(*) OVER () AS total_rows
            FROM keyword_stats_unique
        ) ranked
    ) scores ON scores.keyword = ks.keyword
    SET ks.competition_score = scores.score
  `);
  return totalRows;
}

/**
 * Default path — same percentile-rank algorithm as the SQL version above,
 * but paginated in SCORE_BATCH-sized chunks, each its own short UPDATE
 * (further split by score value, so any single UPDATE only touches rows
 * sharing one score — typically a small fraction of one chunk), with a
 * brief sleep between chunks. Every individual UPDATE holds its row locks
 * for a short, bounded time and then releases them, instead of one
 * transaction holding locks across the whole table — scripts/refresh-
 * keyword-stats-safe.js's own continuous UPSERTs into this same table
 * always get a gap to land in between chunks.
 */
async function recomputeCompetitionScoresJs(sql) {
  const [countRow] = await sql.query('SELECT COUNT(*) AS c FROM keyword_stats_unique');
  const totalRows = Number(countRow.c || 0);
  if (!totalRows) return 0;
  let processed = 0;
  let lastAdvertisersTotal = null;
  let lastKeyword = null;
  while (processed < totalRows) {
    const rows = await sql.query(
      lastAdvertisersTotal === null
        ? `SELECT keyword, advertisers_total
             FROM keyword_stats_unique
            ORDER BY advertisers_total ASC, keyword ASC
            LIMIT ${SCORE_BATCH}`
        : `SELECT keyword, advertisers_total
             FROM keyword_stats_unique
            WHERE (advertisers_total > ?)
               OR (advertisers_total = ? AND keyword > ?)
            ORDER BY advertisers_total ASC, keyword ASC
            LIMIT ${SCORE_BATCH}`,
      lastAdvertisersTotal === null ? [] : [lastAdvertisersTotal, lastAdvertisersTotal, lastKeyword]
    );
    if (!rows.length) break;
    const byScore = new Map();
    rows.forEach((row, index) => {
      const absoluteIndex = processed + index;
      const score = totalRows === 1 ? 100 : Math.round((absoluteIndex / (totalRows - 1)) * 100);
      if (!byScore.has(score)) byScore.set(score, []);
      byScore.get(score).push(row.keyword);
    });
    for (const [score, keywords] of byScore.entries()) {
      const placeholders = keywords.map(() => '?').join(', ');
      await sql.query(`UPDATE keyword_stats_unique SET competition_score = ? WHERE keyword IN (${placeholders})`, [score, ...keywords]);
    }
    processed += rows.length;
    const lastRow = rows[rows.length - 1];
    lastAdvertisersTotal = Number(lastRow.advertisers_total || 0);
    lastKeyword = lastRow.keyword;
    if (processed < totalRows) await sleep(CHUNK_SLEEP_MS); // let other writers interleave
  }
  return totalRows;
}

// Always the gentle, chunked path — see recomputeCompetitionScoresSql's doc
// comment for why the single mega-UPDATE is never called automatically.
async function recomputeCompetitionScores(sql) {
  return recomputeCompetitionScoresJs(sql);
}

module.exports = {
  recomputeCompetitionScores,
  recomputeCompetitionScoresSql,
  recomputeCompetitionScoresJs,
};
