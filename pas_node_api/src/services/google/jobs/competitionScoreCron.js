'use strict';

/**
 * Competition-score refresh — lightweight, standalone cron.
 *
 * `keyword_stats_unique.competition_score` (0-100 percentile rank by
 * advertisers_total, shown as the Keywords Explorer "Competition" column/
 * filter/stat card) previously only got recomputed once a FULL
 * scripts/refresh-keyword-stats-safe.js sweep cycle completed (see that
 * script's finalizeCycle()). That sweep walks the ~42M-row ad corpus in
 * small adaptive batches — against production's real size a full cycle can
 * take a very long time — so the score stayed NULL for most keywords even
 * though every OTHER keyword_stats_unique column (ads_total,
 * advertisers_total, growth_pct, ...) already updates incrementally per
 * batch, independent of cycle completion.
 *
 * The fix isn't to make scoring itself faster — recomputeCompetitionScores()
 * is already a cheap, fast, single set-based pass, because it only touches
 * keyword_stats_unique (the small ONE-ROW-PER-KEYWORD-TEXT rollup, ~500k-1M
 * rows — nothing like the 42M-row ad corpus that caused this session's
 * other slow-query incidents). It's decoupling it from the ad-corpus
 * sweep's own (much slower) completion signal and giving it its own
 * frequent, independent schedule instead — same percentile-rank query,
 * just no longer gated behind an event that may effectively never fire.
 * Scores whatever rows already exist in keyword_stats_unique right now
 * (however much of the ad-corpus sweep has completed so far) — never
 * touches, waits on, or duplicates that sweep in any way.
 *
 * Imports from helpers/competitionScoring.js, NOT scripts/refresh-keyword-
 * stats-safe.js — that script has top-level side effects (process.on
 * SIGINT/SIGTERM handlers, dotenv.config()) that run the instant it's
 * require()'d, not just when its CLI entry point runs. That's fine for a
 * one-off CLI invocation but wrong to pull into the long-lived server
 * process for one function; scripts/refresh-keyword-stats-safe.js is left
 * completely untouched.
 */

const databaseManager = require('../../../database/DatabaseManager');
const logger = require('../../../logger');
const { recomputeCompetitionScores } = require('../helpers/competitionScoring');

const log = logger.createChild('keyword-competition-score');
const NETWORK = 'google';

async function runCompetitionScoreRefresh() {
  const sql = databaseManager.getSQL(NETWORK);
  if (!sql) {
    log.warn('google SQL connection unavailable — skipping this run');
    return { scored: 0 };
  }
  const startedAt = Date.now();
  try {
    const scored = await recomputeCompetitionScores(sql);
    log.info(`competition_score refreshed for ${scored} keyword(s) in ${Date.now() - startedAt}ms`);
    return { scored };
  } catch (err) {
    log.error('competition_score refresh failed', { error: err.message });
    throw err;
  }
}

module.exports = { runCompetitionScoreRefresh };
