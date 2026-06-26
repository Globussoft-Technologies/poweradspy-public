'use strict';

/**
 * nasUploadRetryCron — drains the two durable NAS media queues every minute:
 *   1. nasDownloadQueue (sweepVideoDownloads) — background ad-video DOWNLOADS: fetch the source video
 *      while its URL is fresh, secure the bytes into the upload queue, then publish nas_video_url to ES.
 *   2. nasUploadQueue   (sweepPending)        — retries NAS UPLOADS that failed/deferred in-request,
 *      re-uploading from disk (no re-download → expiry-proof) to the SAME deterministic key.
 * Both dirs are machine-local, so this runs on one worker per machine. Self-healing, no data loss.
 */

const cron = require('node-cron');
const logger = require('../logger');
const { sweepPending } = require('../insertion/helpers/nasUploadQueue');
const { sweepVideoDownloads } = require('../insertion/helpers/nasDownloadQueue');

const log = logger.createChild('nas-upload-retry-cron');

function initNasUploadRetryCron(schedule = '* * * * *') {
  cron.schedule(schedule, async () => {
    // Downloads first (secure bytes into the upload queue), then drain uploads — so a video can be
    // downloaded and uploaded within the same tick when the NAS is healthy.
    try { await sweepVideoDownloads(); } catch (err) { log.error('NAS video-download sweep failed', { error: err.message }); }
    try { await sweepPending(); } catch (err) { log.error('NAS upload sweep failed', { error: err.message }); }
  });
  log.info('✓ NAS upload+download retry cron initialized', { schedule });
}

module.exports = { initNasUploadRetryCron };
