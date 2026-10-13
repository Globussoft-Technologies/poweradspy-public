'use strict';

/**
 * GET /api/v1/imageGen/jobs/:id  — screens 3c/3d/3e (Generating/Done/Failed), polled by the client.
 * GET /api/v1/imageGen/jobs      — MySpace gallery list (screens 5/7).
 */

const repo = require('../repository');
const adStudio = require('../helpers/adStudioClient');
const statusCache = require('../helpers/statusCache');
const creditsLedger = require('../helpers/creditsLedger');
const { resolveAdCreative } = require('../helpers/adResolver');
const { notifyRecreateJobTerminal } = require('../helpers/pushNotify');
const { queueImageDeletion } = require('../helpers/nasCleanup');
const profileRepo = require('../../profile/repository');
const logger = require('../../../logger');
const { ok, rejected, serverError } = require('../helpers/responses');

const log = logger.createChild('imagegen-jobs');
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const sourceMetadataCache = new Map();

async function enrichSourceMetadata(job) {
  if (!job || job.source?.advertiser || !job.source?.network || !job.source?.ad_id) return job;
  const key = `${job.source.network}:${job.source.ad_id}`;
  let metadata = sourceMetadataCache.get(key);
  if (metadata === undefined) {
    const resolved = await resolveAdCreative(job.source.network, job.source.ad_id);
    metadata = resolved.ok ? {
      advertiser: resolved.advertiser || null,
      running_days: resolved.runningDays ?? null,
    } : null;
    // This process-local cache avoids repeating ES lookups for legacy jobs on
    // every filter/search/pagination request. New jobs already persist metadata.
    sourceMetadataCache.set(key, metadata);
  }
  if (!metadata?.advertiser) return job;
  return { ...job, source: { ...job.source, ...metadata } };
}

/** In-app bell notification + browser push for a job that just reached a terminal
 * status — called exactly once per job from refreshFromUpstream below (that
 * function is only ever invoked on a job that ISN'T already terminal, by both
 * of its callers — the poll in getJobStatus and the stuck-job sweep cron — so a
 * terminal `patch.status` here always represents a genuine new transition, not
 * a re-notify on an already-finished job).
 * The in-app insert is awaited (fast, local, and the bell should reflect it
 * immediately); the push send is fire-and-forget (slow external FCM call that
 * must never delay the poll response the frontend is waiting on).
 * Gated by the user's Profile ›Notifications preference (recreate_ready /
 * recreate_failed — Profile's notificationPrefsController.js, default on).
 * Only in-app/push are gated here — email delivery is untouched by this
 * feature entirely, per explicit instruction. */
async function notifyTerminalJob(db, job) {
  const prefKey = job.status === 'succeeded' ? 'recreate_ready' : 'recreate_failed';
  const enabled = await profileRepo.isNotificationEnabled(job.user_id, prefKey).catch(() => true);
  if (!enabled) return;
  try {
    const generated = job.result?.images?.[0];
    await repo.insertNotification(db, {
      userId: job.user_id,
      jobId: job._id,
      status: job.status,
      data: {
        image_url: typeof generated === 'string' ? generated : generated?.url || null,
        aspect_ratio: job.request?.aspect_ratio || null,
        advertiser: job.source?.advertiser || null,
        advertiser_avatar: job.source?.image_url || null,
        ad_id: job.source?.ad_id || null,
        network: job.source?.network || null,
        credits_refunded: job.status === 'succeeded' ? 0 : job.credit?.cost || 1,
        retry: {
          prompt: job.request?.prompt || null,
          brand_website: job.request?.brand_website || null,
          product_image_url: job.request?.product_image_url || null,
          product_image: job.request?.product_image || null,
          extra_image_urls: job.request?.extra_image_urls || [],
        },
      },
    });
  } catch (err) {
    log.warn('imageGen in-app notification insert failed', { job_id: String(job._id), error: err.message });
  }
  notifyRecreateJobTerminal(job).catch(() => {}); // already logs its own failures
}

/** Shared by the single-job endpoint and the stuck-job sweep cron — does one live
 * upstream check (cache-throttled by the caller) and applies the resulting state
 * transition (credit finalize/refund, result/error storage) to the Mongo doc.
 * Exported so the cron can reuse it without duplicating the transition logic. */
async function refreshFromUpstream(db, job) {
  const upstreamJobId = job.upstream?.job_id;
  if (!upstreamJobId) return job;

  let upstream = statusCache.get(upstreamJobId);
  if (!upstream) {
    const res = await adStudio.getJob(upstreamJobId);
    if (!res.ok) return job; // transient upstream error — leave local state as-is, try again next poll
    upstream = res;
    statusCache.set(upstreamJobId, upstream);
  }

  const patch = { 'upstream.last_polled_at': new Date(), 'upstream.status': upstream.status };

  if (upstream.status === 'succeeded') {
    // The debit already happened at reserve time (its 'reserve' ledger row is the
    // record). credit.finalized_at marks it final — no extra zero-value ledger row.
    patch.status = 'succeeded';
    patch.result = upstream.result || null;
    patch['credit.finalized_at'] = new Date();
  } else if (upstream.status === 'failed' || upstream.status === 'cancelled') {
    patch.status = upstream.status;
    patch.error = { error_code: upstream.error_code || null, message: upstream.error || null, user_message: upstream.user_message || null };
    // Failed generations leave MySpace after config imageGen.retention.failedJobsDays (TTL).
    const exp = repo.expireAt('failedJobsDays');
    if (exp) patch.expire_at = exp;
    if (!job.credit.refunded) {
      await creditsLedger.refund(db, { userId: job.user_id, jobId: job._id, cost: job.credit.cost, bucket: job.credit.bucket });
      patch['credit.refunded'] = true;
      patch['credit.finalized_at'] = new Date();
    }
  } else {
    patch.status = upstream.status === 'running' ? 'running' : job.status;
  }

  // Dotted keys (e.g. 'credit.finalized_at') are valid MongoDB $set nested-field paths.
  const updated = await repo.updateJob(db, job._id, patch);
  if (TERMINAL.has(updated.status)) {
    await notifyTerminalJob(db, updated);
  }
  return updated;
}

function serializeJob(job) {
  if (!job) return null;
  return {
    job_id: String(job._id),
    status: job.status,
    source: job.source,
    request: job.request,
    result: job.result,
    error: job.error,
    credit: job.credit,
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}

async function getJobStatus(req, res) {
  const db = req.imageGenDb;
  const userId = req.user?.user_id ?? req.user?.id;
  if (!userId) return res.status(401).json(rejected(401, 'Unauthorized.'));

  let job = await repo.getJobById(db, req.params.id, userId);
  if (!job) return res.status(404).json(rejected(404, 'Job not found.'));

  if (!TERMINAL.has(job.status)) {
    try {
      job = await refreshFromUpstream(db, job);
    } catch (err) {
      // Status-check failure must not break the poll — return the last known local state.
      return res.json(ok('Status (stale — live check failed).', serializeJob(job)));
    }
  }

  return res.json(ok('Status.', serializeJob(job)));
}

async function listMySpace(req, res) {
  const db = req.imageGenDb;
  const userId = req.user?.user_id ?? req.user?.id;
  if (!userId) return res.status(401).json(rejected(401, 'Unauthorized.'));

  const { status, from, to, q, sort, limit, cursor } = req.query;
  try {
    const { items, nextCursor, total, totalAll, statusCounts } = await repo.listJobs(db, {
      userId, status: status ? String(status).split(',') : undefined,
      from, to, query: q, sort, limit, cursor,
    });
    const enrichedItems = await Promise.all(items.map(enrichSourceMetadata));
    return res.json(ok('MySpace list.', {
      items: enrichedItems.map(serializeJob), next_cursor: nextCursor, total, total_all: totalAll,
      status_counts: statusCounts,
    }));
  } catch (err) {
    return res.status(500).json(serverError(500, 'Could not load MySpace right now.', { error: err.message }));
  }
}

/** DELETE /jobs/:id — removes a generated image from MySpace. This is a gallery
 * removal only: it does NOT refund the credit (the generation already happened
 * and was already paid for; deleting it from view later doesn't undo that) and
 * does not touch the AI-GENERATED result (we never mirror Ad Studio's own image
 * URL to NAS — see MANIFEST.md §1 — so there's no file of ours to clean up there).
 * It DOES queue the job's own uploaded reference images (product/extra, which
 * ARE stored on our NAS — see uploadController.js) for deletion — fire-and-forget,
 * the actual NAS round-trip happens later on imageGenNasCleanupSweep.js's own
 * schedule so this response never waits on it. */
async function deleteMySpaceJob(req, res) {
  const db = req.imageGenDb;
  const userId = req.user?.user_id ?? req.user?.id;
  if (!userId) return res.status(401).json(rejected(401, 'Unauthorized.'));

  try {
    const job = await repo.getJobById(db, req.params.id, userId);
    if (!job) return res.status(404).json(rejected(404, 'Job not found.'));
    await repo.deleteJob(db, req.params.id, userId);
    const imageUrls = [job.request?.product_image_url, ...(job.request?.extra_image_urls || [])];
    queueImageDeletion(db, imageUrls, userId).catch(() => {}); // enqueue insert is fast/local; never block this response on it
    return res.json(ok('Deleted.', { job_id: req.params.id }));
  } catch (err) {
    return res.status(500).json(serverError(500, 'Could not delete this image right now.', { error: err.message }));
  }
}

module.exports = { getJobStatus, listMySpace, deleteMySpaceJob, refreshFromUpstream };
