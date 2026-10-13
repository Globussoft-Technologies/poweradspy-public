'use strict';

/**
 * GET  /api/v1/imageGen/notifications       — header bell list (succeeded/failed
 *                                              Recreate jobs), separate from the
 *                                              existing keyword/advertiser/domain
 *                                              notification system.
 * POST /api/v1/imageGen/notifications/read  — mark one or more as read.
 */

const repo = require('../repository');
const { resolveAdCreative } = require('../helpers/adResolver');
const { ok, rejected } = require('../helpers/responses');
const sourceCache = new Map();

function imageUrl(job) {
  const image = job?.result?.images?.[0];
  return typeof image === 'string' ? image : image?.url || null;
}

function serializeNotification(n, job) {
  const data = n.data || {};
  return {
    id: String(n._id),
    job_id: String(n.job_id),
    status: n.status, // 'succeeded' | 'failed' | 'cancelled'
    read: !!n.read,
    created_at: n.created_at,
    type: n.status === 'succeeded' ? 'recreate_done' : 'recreate_failed',
    data: {
      job_id: String(n.job_id),
      image_id: String(n.job_id),
      image_url: data.image_url || imageUrl(job),
      aspect_ratio: data.aspect_ratio || job?.request?.aspect_ratio || null,
      advertiser: data.advertiser || job?.source?.advertiser || null,
      advertiser_avatar: data.advertiser_avatar || job?.source?.image_url || null,
      ad_id: data.ad_id || job?.source?.ad_id || null,
      network: data.network || job?.source?.network || null,
      credits_refunded: Number(data.credits_refunded ?? (n.status === 'succeeded' ? 0 : job?.credit?.cost || 1)),
      retry: data.retry || (job ? {
        prompt: job.request?.prompt || null,
        brand_website: job.request?.brand_website || null,
        product_image_url: job.request?.product_image_url || null,
        product_image: job.request?.product_image || null,
        extra_image_urls: job.request?.extra_image_urls || [],
      } : null),
    },
  };
}

async function listNotifications(req, res) {
  const db = req.imageGenDb;
  const userId = req.user?.user_id ?? req.user?.id;
  if (!userId) return res.status(401).json(rejected(401, 'Unauthorized.'));

  const [{ items, nextCursor }, unreadCount] = await Promise.all([
    repo.listNotifications(db, userId, { limit: req.query.limit, cursor: req.query.cursor, unreadOnly: req.query.filter === 'unread' }),
    repo.countUnreadNotifications(db, userId),
  ]);
  const jobs = await repo.getJobsByIds(db, items.map((item) => item.job_id), userId);
  await Promise.all(jobs.map(async (job) => {
    if (job.source?.advertiser || !job.source?.network || !job.source?.ad_id) return;
    const key = `${job.source.network}:${job.source.ad_id}`;
    let metadata = sourceCache.get(key);
    if (metadata === undefined) {
      const resolved = await resolveAdCreative(job.source.network, job.source.ad_id);
      metadata = resolved.ok ? { advertiser: resolved.advertiser || null, image_url: resolved.imageUrl || null } : null;
      sourceCache.set(key, metadata);
    }
    if (metadata) job.source = { ...job.source, advertiser: metadata.advertiser, image_url: job.source.image_url || metadata.image_url };
  }));
  const jobsById = new Map(jobs.map((job) => [String(job._id), job]));

  return res.json(ok('Notifications.', {
    items: items.map((item) => serializeNotification(item, jobsById.get(String(item.job_id)))),
    unread_count: unreadCount,
    next_cursor: nextCursor,
  }));
}

async function markNotificationsRead(req, res) {
  const db = req.imageGenDb;
  const userId = req.user?.user_id ?? req.user?.id;
  if (!userId) return res.status(401).json(rejected(401, 'Unauthorized.'));

  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
  if (!ids.length) return res.status(422).json(rejected(422, 'The ids field is required.'));

  await repo.markNotificationsRead(db, userId, ids);
  return res.json(ok('Marked read.'));
}

module.exports = { listNotifications, markNotificationsRead };
