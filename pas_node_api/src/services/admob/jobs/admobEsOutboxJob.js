'use strict';

const databaseManager = require('../../../database/DatabaseManager');
const logger = require('../../../logger');
const repo = require('../insertion/repository');
const { buildAdmobDocument } = require('../insertion/esDocBuilder');

const log = logger.createChild('admob-es-outbox');
let running = false;

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function runAdmobEsOutbox(jobConfig = {}, dependencies = {}) {
  if (running) {
    log.warn('AdMob ES outbox sweep skipped because the previous sweep is still running');
    return { skipped: true, processed: 0, indexed: 0, failed: 0 };
  }

  running = true;
  const db = dependencies.databaseManager || databaseManager;
  const repository = dependencies.repository || repo;
  const buildDocument = dependencies.buildDocument || buildAdmobDocument;
  const jobLog = dependencies.log || log;
  const batchSize = boundedInt(jobConfig.batchSize, 25, 1, 100);
  const maxAttempts = boundedInt(jobConfig.maxAttempts, 10, 1, 50);

  try {
    const sql = db.getSQL('admob');
    const elastic = db.getElastic('admob');
    if (!sql || !elastic) {
      jobLog.warn('AdMob ES outbox sweep skipped because MySQL or Elasticsearch is unavailable', {
        mysql: Boolean(sql),
        elasticsearch: Boolean(elastic),
      });
      return { skipped: true, processed: 0, indexed: 0, failed: 0 };
    }

    const pending = await repository.getPendingEs(sql, batchSize, maxAttempts);
    let indexed = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        const ad = await repository.getCompleteAd(sql, item.public_ad_id);
        if (!ad) throw new Error('AdMob outbox ad was not found in MySQL.');

        const params = {
          index: elastic.indexName || 'mob_search_mix',
          id: String(item.ad_id),
          body: buildDocument(ad),
          refresh: false,
        };
        if (Number(elastic.esMajor) <= 6) params.type = 'doc';

        await elastic.index(params);
        await repository.completeEs(sql, item.ad_id);
        indexed++;
      } catch (error) {
        failed++;
        await repository.failEs(sql, item.ad_id, error.message).catch((repoError) => {
          jobLog.error('AdMob ES outbox retry state could not be updated', {
            ad_id: item.ad_id,
            error: repoError.message,
          });
        });
        jobLog.error('AdMob ES outbox item failed', {
          ad_id: item.ad_id,
          public_ad_id: item.public_ad_id,
          attempt: Number(item.attempts) + 1,
          error: error.message,
        });
      }
    }

    const result = { skipped: false, processed: pending.length, indexed, failed };
    if (pending.length) jobLog.info('AdMob ES outbox sweep completed', result);
    return result;
  } finally {
    running = false;
  }
}

module.exports = { runAdmobEsOutbox };
