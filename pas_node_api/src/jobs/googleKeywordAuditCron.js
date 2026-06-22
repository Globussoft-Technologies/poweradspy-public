'use strict';

/**
 * googleKeywordAudit cron — keeps the google_audit_keywords Mongo collection healthy:
 *   1. import newly user-searched GOOGLE keywords from keyword_searches (deduped upsert),
 *   2. enforce the maxCount cap by deleting the oldest rows beyond it.
 *
 * The same cap is also enforced inline on every POST insert; this cron is the periodic
 * safety net (and the only place the user-search import runs). Registered in
 * cronManager REGISTRY under key "googleKeywordAudit"; scheduled via config.crons.jobs.
 */

const repo = require('../services/google/searchAudit/repository');
const config = require('../config');
const logger = require('../logger');

const log = logger.createChild('google-keyword-audit-cron');

async function runGoogleKeywordAudit() {
  const cfg = config.googleKeywordAudit;
  if (!cfg.enabled) return { skipped: 'disabled' };
  if (!repo.getCollection()) return { skipped: 'no mongo connection' };

  // 1. import google user-searched keywords (incremental, deduped)
  let imported = { scanned: 0, inserted: 0, batches: 0, caughtUp: true };
  try {
    imported = await repo.importGoogleUserSearches();
  } catch (err) {
    log.error('user-search import failed', { error: err.message });
  }

  // 2. enforce the 100k cap
  let cap = { total: 0, deleted: 0 };
  try {
    cap = await repo.enforceCap(cfg.maxCount);
  } catch (err) {
    log.error('cap enforcement failed', { error: err.message });
  }

  const summary = { imported: imported.inserted, scanned: imported.scanned, deletedOverCap: cap.deleted, total: cap.total };
  log.info('google keyword audit run complete', summary);
  return summary;
}

module.exports = { runGoogleKeywordAudit };
