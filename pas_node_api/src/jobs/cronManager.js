'use strict';

/**
 * Generic, config-driven cron manager.
 *
 * Reads `config.crons` (from config.json) and schedules every ENABLED job whose
 * key is registered in REGISTRY. Adding a new cron = add a `config.crons.jobs.<key>`
 * entry + a REGISTRY entry — no other wiring. Each entry supports:
 *   enabled   true/false   — run this cron or not
 *   schedule  string       — "daily 12:05 AM" | "5 min" | "2 hour" | raw 5-field cron
 *   ...                    — any job-specific options (passed to the runner)
 */

const cron = require('node-cron');
const config = require('../config');
const logger = require('../logger');
const { parseSchedule } = require('./parseSchedule');
const { runActiveCountSnapshot } = require('./activeCountSnapshotJob');
const { runKeywordStatsRefresh } = require('../services/google/jobs/refreshKeywordStats');
const { runCompetitionScoreRefresh } = require('../services/google/jobs/competitionScoreCron');
const { runAdmobEsOutbox } = require('../services/admob/jobs/admobEsOutboxJob');

const log = logger.createChild('cron-manager');

// jobKey (== config.crons.jobs.<key>) → async runner(jobConfig)
const REGISTRY = {
  activeCountSnapshot: (jobCfg) =>
    runActiveCountSnapshot({ retentionDays: jobCfg.retentionDays || 365 }),
  keywordStatsRefresh: (jobCfg) =>
    runKeywordStatsRefresh({
      commit: jobCfg.commit !== false,
      truncate: !!jobCfg.truncate,
      full: !!jobCfg.full,
      batch: jobCfg.batch || 1000,
      precision: jobCfg.precision || 1000, // see refreshKeywordStats.js's "Scale" doc comment before raising this
      // Keep the competition score available for the UI by default.
      // If an operator explicitly turns it off, they can set false in config.
      recomputeScores: jobCfg.recomputeScores !== false,
    }),
  admobEsOutbox: (jobCfg) => runAdmobEsOutbox(jobCfg),
  // Decoupled from keywordStatsRefresh's own ad-corpus sweep completion —
  // see competitionScoreCron.js's doc comment for why that gating left
  // competition_score empty for most keywords. Only touches the small
  // keyword_stats_unique rollup (~500k-1M rows), so it's cheap enough to
  // run frequently without competing with the (much heavier) ad-corpus
  // sweep for SQL/ES capacity.
  keywordCompetitionScore: () => runCompetitionScoreRefresh(),
};

/**
 * Schedule all enabled, registered crons. Returns the number scheduled.
 * Call once at startup (worker-guarded by the caller).
 */
function initConfigCrons() {
  const tz = config.crons?.timezone || 'Asia/Kolkata';
  const jobs = config.crons?.jobs || {};
  let started = 0;

  for (const [key, jobCfg] of Object.entries(jobs)) {
    if (!jobCfg || jobCfg.enabled === false) {
      log.info(`cron "${key}" disabled via config`);
      continue;
    }
    const runner = REGISTRY[key];
    if (!runner) {
      log.warn(`cron "${key}" has no registered implementation — skipped`);
      continue;
    }
    const expr = parseSchedule(jobCfg.schedule, null);
    if (!expr || !cron.validate(expr)) {
      log.error(`cron "${key}" has an invalid schedule — not started`, { schedule: jobCfg.schedule, expr });
      continue;
    }

    cron.schedule(expr, async () => {
      try {
        log.info(`cron "${key}" triggered`);
        await runner(jobCfg);
        log.info(`cron "${key}" completed`);
      } catch (err) {
        log.error(`cron "${key}" job error`, { error: err.message });
      }
    }, { timezone: tz });

    started++;
    log.info(`✓ cron "${key}" scheduled (${jobCfg.schedule} → "${expr}", ${tz})`);
  }

  log.info(`config crons initialized: ${started} scheduled`);
  return started;
}

module.exports = { initConfigCrons, REGISTRY };
