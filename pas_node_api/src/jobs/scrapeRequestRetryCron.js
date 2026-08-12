'use strict';

/**
 * scrapeRequestRetryCron — drains the durable on-disk scrape-request queue
 * (src/services/common/helpers/scrapeRequestQueue.js) every minute, so a term whose
 * Google scrape-request trigger failed at store-time (scrapeRequestUrl down/unreachable)
 * still gets sent once the endpoint recovers — even across an API restart, since the
 * queue lives on disk, not in memory.
 */

const cron = require('node-cron');
const logger = require('../logger');
const { sweepPending } = require('../services/common/helpers/scrapeRequestQueue');

const log = logger.createChild('scrape-request-retry-cron');

function initScrapeRequestRetryCron(schedule = '* * * * *') {
  // Sweep once immediately on boot too — don't make a queue built up before a restart
  // wait a full minute before the first retry attempt.
  sweepPending().catch((err) => log.error('initial scrape-request sweep failed', { error: err.message }));

  cron.schedule(schedule, async () => {
    try { await sweepPending(); } catch (err) { log.error('scrape-request retry sweep failed', { error: err.message }); }
  });
  log.info('✓ Scrape-request retry cron initialized', { schedule });
}

module.exports = { initScrapeRequestRetryCron };
