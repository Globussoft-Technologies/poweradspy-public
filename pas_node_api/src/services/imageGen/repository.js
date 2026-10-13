'use strict';

/**
 * AI Recreate + MySpace — Mongo repository.
 *
 * Four collections, deliberately flexible-schema (Mongo, per explicit instruction —
 * not SQL like the Saved/Hidden Ads precedent, which doesn't fit Ad Studio's nested,
 * semi-structured job-result shape):
 *   imagegen_jobs           - one doc per Recreate request
 *   imagegen_credits        - one doc per user, current balance (_id = user_id)
 *   imagegen_credit_ledger  - append-only transaction log
 *   imagegen_notifications  - one doc per job that reached succeeded/failed/cancelled,
 *                             for the header bell (separate from the existing
 *                             keyword/advertiser/domain notification system —
 *                             see jobsController.js's refreshFromUpstream)
 *   imagegen_nas_deletions  - durable queue of uploaded reference images (product/
 *                             extra) waiting to be deleted from NAS — see
 *                             helpers/nasCleanup.js and jobs/imageGenNasCleanupSweep.js
 *
 *   imagegen_topup_grants   - one doc per credited aMember top-up purchase (never expires)
 *
 * Every collection is per-user: `user_id` on every doc (imagegen_credits uses
 * _id = user_id) with a {user_id, created_at} index, so one user's data is a
 * single indexed query per collection (see scripts/imagegen-user-data.js).
 *
 * Lifetime: docs that should expire get an `expire_at` date and a MongoDB TTL
 * index removes them (no app load). How long is config.json → imageGen.retention;
 * a null value means that kind of doc never gets expire_at (kept forever).
 *
 * `exec` is always the Mongo `db` handle from DatabaseManager.getMongo('imageGen').db
 * (a native MongoClient Db instance) — no ORM, matching this codebase's raw-driver
 * convention everywhere else Mongo is used.
 */

const { ObjectId } = require('mongodb');
const imageGenConfig = require('./config');

const JOBS = 'imagegen_jobs';
const CREDITS = 'imagegen_credits';
const LEDGER = 'imagegen_credit_ledger';
const NOTIFICATIONS = 'imagegen_notifications';
const NAS_DELETIONS = 'imagegen_nas_deletions';
const TOPUP_GRANTS = 'imagegen_topup_grants';

/** now + config.imageGen.retention[key] days, or null (keep forever) if unset/null. */
function expireAt(key, from = new Date()) {
  const days = Number(imageGenConfig.retention?.[key]);
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(from.getTime() + days * 86400000);
}

let indexesEnsured = false;

/** Create indexes once per process (idempotent — createIndex is a no-op if it already exists
 * with the same spec). Called lazily on first repository use, not at module load, so a Mongo
 * connection that isn't ready yet at require-time doesn't throw. */
async function ensureIndexes(db) {
  if (indexesEnsured) return;
  indexesEnsured = true;
  try {
    await db.collection(JOBS).createIndex({ user_id: 1, created_at: -1 });
    await db.collection(JOBS).createIndex({ status: 1, updated_at: 1 });
    await db.collection(JOBS).createIndex({ 'upstream.job_id': 1 }, { unique: true, sparse: true });
    await db.collection(LEDGER).createIndex({ user_id: 1, created_at: -1 });
    await db.collection(TOPUP_GRANTS).createIndex({ user_id: 1, created_at: -1 });
    await db.collection(NOTIFICATIONS).createIndex({ user_id: 1, created_at: -1 });
    await db.collection(NOTIFICATIONS).createIndex({ user_id: 1, read: 1 });
    await db.collection(NAS_DELETIONS).createIndex({ url: 1 }, { unique: true });
    await db.collection(NAS_DELETIONS).createIndex({ next_attempt_at: 1, status: 1 });
    await db.collection(NAS_DELETIONS).createIndex({ user_id: 1 });
    // TTL: Mongo deletes a doc once its expire_at passes (docs without expire_at
    // are never touched) — see expireAt() and config imageGen.retention.
    for (const coll of [JOBS, LEDGER, NOTIFICATIONS, NAS_DELETIONS]) {
      await db.collection(coll).createIndex({ expire_at: 1 }, { expireAfterSeconds: 0 });
    }
  } catch (err) {
    // Never let index creation (e.g. a transient race between two workers) block a request —
    // log via console since repository.js has no logger dependency of its own; callers already
    // have one.
    indexesEnsured = false;
    throw err;
  }
}

async function init(db) {
  await ensureIndexes(db);
}

// ── imagegen_jobs ────────────────────────────────────────────────────────────
async function insertJob(db, doc) {
  const now = new Date();
  const toInsert = { ...doc, created_at: now, updated_at: now };
  const res = await db.collection(JOBS).insertOne(toInsert);
  return { ...toInsert, _id: res.insertedId };
}

async function getJobById(db, id, userId) {
  const _id = typeof id === 'string' ? new ObjectId(id) : id;
  const filter = { _id };
  if (userId) filter.user_id = userId;
  return db.collection(JOBS).findOne(filter);
}

/** Scoped to userId — a user can only delete their own job. Returns true if a row
 * was actually removed (false = not found / not theirs, caller returns 404). */
async function deleteJob(db, id, userId) {
  const _id = typeof id === 'string' ? new ObjectId(id) : id;
  const res = await db.collection(JOBS).deleteOne({ _id, user_id: userId });
  return res.deletedCount > 0;
}

async function updateJob(db, id, patch) {
  const _id = typeof id === 'string' ? new ObjectId(id) : id;
  const res = await db.collection(JOBS).findOneAndUpdate(
    { _id },
    { $set: { ...patch, updated_at: new Date() } },
    { returnDocument: 'after' }
  );
  return res?.value ?? res;
}

async function listJobs(db, { userId, status, from, to, query, sort = 'newest', limit = 24, cursor }) {
  const filter = { user_id: userId };
  if (from || to) {
    filter.created_at = {};
    if (from) filter.created_at.$gte = new Date(from);
    if (to) {
      const upper = new Date(to);
      // Date-only filters are inclusive of the entire selected day. Previously
      // YYYY-MM-DD parsed at midnight and silently excluded almost that whole day.
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(to))) upper.setUTCHours(23, 59, 59, 999);
      filter.created_at.$lte = upper;
    }
  }
  const q = String(query || '').trim();
  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { 'source.advertiser': { $regex: escaped, $options: 'i' } },
      { 'request.prompt': { $regex: escaped, $options: 'i' } },
      { 'source.ad_id': { $regex: escaped, $options: 'i' } },
    ];
  }

  // Count every status in the same date/search scope, independently of the
  // currently selected status filter used by the gallery query below.
  const statusCountFilter = { ...filter };
  if (status) filter.status = Array.isArray(status) ? { $in: status } : status;

  const direction = sort === 'oldest' ? 1 : -1;
  // Totals describe the whole filtered result set, not only the page after the
  // cursor. Keep a cursor-free copy before adding pagination to the query.
  const countFilter = { ...filter };
  if (cursor) filter._id = direction === 1
    ? { $gt: typeof cursor === 'string' ? new ObjectId(cursor) : cursor }
    : { $lt: typeof cursor === 'string' ? new ObjectId(cursor) : cursor };

  const safeLimit = Math.min(Math.max(Number(limit) || 24, 1), 100);
  const collection = db.collection(JOBS);
  const [docs, total, totalAll, succeeded, failed, active] = await Promise.all([
    collection.find(filter).sort({ _id: direction }).limit(safeLimit + 1).toArray(),
    collection.countDocuments(countFilter),
    collection.countDocuments({ user_id: userId }),
    collection.countDocuments({ ...statusCountFilter, status: 'succeeded' }),
    collection.countDocuments({ ...statusCountFilter, status: { $in: ['failed', 'cancelled'] } }),
    collection.countDocuments({ ...statusCountFilter, status: { $in: ['queued', 'running'] } }),
  ]);

  const hasMore = docs.length > safeLimit;
  const page = hasMore ? docs.slice(0, safeLimit) : docs;
  return {
    items: page,
    nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
    total,
    totalAll,
    statusCounts: { all: succeeded + failed + active, succeeded, failed, active },
  };
}

/** Jobs stuck in queued/running past the timeout — for the safety-net sweep. */
async function findStuckJobs(db, olderThan, limit = 50) {
  return db.collection(JOBS)
    .find({ status: { $in: ['queued', 'running'] }, updated_at: { $lt: olderThan } })
    .limit(limit)
    .toArray();
}

// ── imagegen_credits ─────────────────────────────────────────────────────────
// One doc per user (_id = userId), two buckets:
//   cycle_balance — the plan allowance for the current cycle (reset, never rolled
//                   over, when cycle_key changes — see helpers/creditPlan.js)
//   topup_balance — purchased top-up credits, never reset or expired
//   balance       — always cycle_balance + topup_balance (what the header shows)
async function getCreditsDoc(db, userId) {
  return db.collection(CREDITS).findOne({ _id: userId });
}

async function getBalance(db, userId) {
  const doc = await getCreditsDoc(db, userId);
  return doc ? doc.balance : null;
}

/** Makes sure a row exists without granting anything — used when aMember can't
 * be reached, so the next successful sync can apply the real cycle. */
async function ensureCreditsDoc(db, userId) {
  const now = new Date();
  const res = await db.collection(CREDITS).findOneAndUpdate(
    { _id: userId },
    {
      $setOnInsert: { _id: userId, balance: 0, cycle_balance: 0, topup_balance: 0, cycle_key: null, created_at: now },
      $set: { updated_at: now },
    },
    { upsert: true, returnDocument: 'after' }
  );
  return res?.value ?? res;
}

/** Starts a new cycle iff `cycleKey` differs from the stored one: cycle_balance
 * is reset to `allowance` and balance recomputed (top-ups untouched). Atomic —
 * the filter only matches a doc still on the old key, so two concurrent
 * requests can't both grant. Returns { started, doc }. */
async function applyCycle(db, userId, { cycleKey, allowance, cycleMeta }) {
  const now = new Date();
  const update = [{
    $set: {
      cycle_key: cycleKey,
      cycle_meta: cycleMeta || null,
      cycle_balance: allowance,
      topup_balance: { $ifNull: ['$topup_balance', 0] },
      balance: { $add: [allowance, { $ifNull: ['$topup_balance', 0] }] },
      created_at: { $ifNull: ['$created_at', now] },
      updated_at: now,
    },
  }];
  try {
    const res = await db.collection(CREDITS).findOneAndUpdate(
      { _id: userId, cycle_key: { $ne: cycleKey } },
      update,
      { upsert: true, returnDocument: 'after' }
    );
    const doc = res?.value ?? res;
    if (doc) return { started: true, doc };
  } catch (err) {
    // Upsert raced against an existing doc already on this cycle_key → duplicate _id.
    if (err?.code !== 11000) throw err;
  }
  return { started: false, doc: await getCreditsDoc(db, userId) };
}

/** Plan details for display (label, next refresh, end date) — can change
 * mid-cycle (e.g. a subscription gets cancelled), so refreshed on every sync. */
async function setCycleMeta(db, userId, meta) {
  await db.collection(CREDITS).updateOne({ _id: userId }, { $set: { cycle_meta: meta } });
}

/** Atomic reserve: plan credits first, then top-up credits. Returns
 * { balance, bucket } or null if neither bucket can cover `cost`. */
async function reserveCredit(db, userId, cost) {
  for (const bucket of ['cycle_balance', 'topup_balance']) {
    const res = await db.collection(CREDITS).findOneAndUpdate(
      { _id: userId, [bucket]: { $gte: cost } },
      { $inc: { [bucket]: -cost, balance: -cost }, $set: { updated_at: new Date() } },
      { returnDocument: 'after' }
    );
    const doc = res?.value ?? res;
    if (doc) return { balance: doc.balance, bucket: bucket === 'cycle_balance' ? 'cycle' : 'topup' };
  }
  return null;
}

/** Refund (failed/cancelled job) back into the bucket it was taken from. */
async function refundCredit(db, userId, amount, bucket = 'cycle') {
  const field = bucket === 'topup' ? 'topup_balance' : 'cycle_balance';
  const res = await db.collection(CREDITS).findOneAndUpdate(
    { _id: userId },
    { $inc: { [field]: amount, balance: amount }, $set: { updated_at: new Date() } },
    { upsert: true, returnDocument: 'after' }
  );
  const doc = res?.value ?? res;
  return doc.balance;
}

/** Records one aMember top-up purchase (keyed by its aMember access record)
 * and adds its credits — exactly once. Returns the new balance, or null if this
 * purchase was already credited. */
async function grantTopup(db, userId, { grantKey, credits, accessId, invoiceId, productId, paidAmount = null }) {
  try {
    await db.collection(TOPUP_GRANTS).insertOne({
      _id: grantKey, user_id: userId, access_id: accessId, invoice_id: invoiceId,
      product_id: productId, credits, paid_amount: paidAmount, reversed_credits: 0, status: 'active',
      created_at: new Date(),
    });
  } catch (err) {
    if (err?.code === 11000) return null;
    throw err;
  }
  await ensureCreditsDoc(db, userId);
  const res = await db.collection(CREDITS).findOneAndUpdate(
    { _id: userId },
    { $inc: { topup_balance: credits, balance: credits }, $set: { updated_at: new Date() } },
    { returnDocument: 'after' }
  );
  const doc = res?.value ?? res;
  return doc.balance;
}

/** A user's top-up grants that still have credits left to reverse. */
async function listOpenTopupGrants(db, userId) {
  return db.collection(TOPUP_GRANTS).find({ user_id: userId, status: { $ne: 'reversed' } }).toArray();
}

/**
 * Reverse a top-up grant up to `targetReversed` credits in total (refund /
 * chargeback). Idempotent: the grant's reversed_credits is advanced with a
 * conditional update first, so concurrent syncs can't reverse the same credits
 * twice. Then takes back as many of those credits as are still unspent in the
 * top-up bucket (never below 0). Returns { reversed, removed } or null if
 * nothing changed.
 */
async function reverseTopupGrant(db, userId, grant, targetReversed) {
  const already = Number(grant.reversed_credits) || 0;
  const toReverse = Math.min(grant.credits, targetReversed) - already;
  if (toReverse <= 0) return null;
  const nextReversed = already + toReverse;
  const claimed = await db.collection(TOPUP_GRANTS).updateOne(
    { _id: grant._id, reversed_credits: already },
    { $set: { reversed_credits: nextReversed, status: nextReversed >= grant.credits ? 'reversed' : 'active', reversed_at: new Date() } },
  );
  if (!claimed.modifiedCount) return null; // another sync already did it

  let removed = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const doc = await getCreditsDoc(db, userId);
    removed = Math.min(toReverse, Math.max(0, doc?.topup_balance || 0));
    if (removed === 0) break;
    const res = await db.collection(CREDITS).updateOne(
      { _id: userId, topup_balance: { $gte: removed } },
      { $inc: { topup_balance: -removed, balance: -removed }, $set: { updated_at: new Date() } },
    );
    if (res.modifiedCount) break;
    removed = 0;
  }
  return { reversed: toReverse, removed };
}

// ── imagegen_credit_ledger ───────────────────────────────────────────────────
async function appendLedger(db, { userId, delta, reason, refJobId = null, balanceAfter, meta = null }) {
  const now = new Date();
  const doc = { user_id: userId, delta, reason, ref_job_id: refJobId, balance_after: balanceAfter, created_at: now };
  if (meta) doc.meta = meta;
  const exp = expireAt('ledgerDays', now);
  if (exp) doc.expire_at = exp;
  await db.collection(LEDGER).insertOne(doc);
}

async function listLedger(db, userId, limit = 50) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return db.collection(LEDGER).find({ user_id: userId }).sort({ created_at: -1 }).limit(safeLimit).toArray();
}

const HISTORY_TYPE_REASONS = { used: ['reserve'], refunded: ['refund'], allocated: ['allocation', 'topup', 'topup_reversed'] };

/** Credit history for Profile › Credits — always excludes 'finalize_debit' (a
 * zero-delta bookkeeping marker, not a real transaction the user needs to see).
 * Returns raw ledger docs (ref_job_id, not yet joined to the job's advertiser —
 * the controller does that enrichment, same pattern as listJobs/enrichSourceMetadata). */
async function listLedgerPage(db, userId, { type = 'all', page = 1, limit = 8 } = {}) {
  const filter = { user_id: userId, reason: { $ne: 'finalize_debit' } };
  const reasons = HISTORY_TYPE_REASONS[type];
  if (reasons) filter.reason = { $in: reasons };

  const safeLimit = Math.min(Math.max(Number(limit) || 8, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const collection = db.collection(LEDGER);
  const [items, total] = await Promise.all([
    collection.find(filter).sort({ created_at: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).toArray(),
    collection.countDocuments(filter),
  ]);
  return { items, total };
}

// ── imagegen_notifications ───────────────────────────────────────────────────
/** One doc per job that reaches a terminal status — the header bell's source for
 * "Your recreated ad is ready" / "Generation failed — credit refunded". Separate
 * from `imagegen_jobs` itself so deleting a job from MySpace (deleteJob above)
 * doesn't also erase the notification history of it having happened. */
async function insertNotification(db, { userId, jobId, status, data = null }) {
  const now = new Date();
  const doc = { user_id: userId, job_id: jobId, status, data, read: false, created_at: now };
  const exp = expireAt('notificationsUnreadDays', now);
  if (exp) doc.expire_at = exp;
  const res = await db.collection(NOTIFICATIONS).insertOne(doc);
  await capNotifications(db, userId).catch(() => {});
  return { ...doc, _id: res.insertedId };
}

/** Keep only the newest `notificationsMaxPerUser` notifications for a user.
 * One indexed lookup ({user_id, created_at}) for the cut-off, one deleteMany —
 * cheap no matter how many users or notifications exist. */
async function capNotifications(db, userId) {
  const max = Number(imageGenConfig.retention?.notificationsMaxPerUser);
  if (!Number.isFinite(max) || max <= 0) return;
  const cutoff = await db.collection(NOTIFICATIONS)
    .find({ user_id: userId }, { projection: { created_at: 1 } })
    .sort({ created_at: -1 }).skip(max).limit(1).next();
  if (!cutoff) return;
  await db.collection(NOTIFICATIONS).deleteMany({ user_id: userId, created_at: { $lte: cutoff.created_at } });
}

async function listNotifications(db, userId, { limit = 20, cursor, unreadOnly = false } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const filter = { user_id: userId };
  if (unreadOnly) filter.read = false;
  if (cursor) filter._id = { $lt: typeof cursor === 'string' ? new ObjectId(cursor) : cursor };
  const docs = await db.collection(NOTIFICATIONS).find(filter).sort({ _id: -1 }).limit(safeLimit + 1).toArray();
  const hasMore = docs.length > safeLimit;
  const items = hasMore ? docs.slice(0, safeLimit) : docs;
  return { items, nextCursor: hasMore ? String(items[items.length - 1]._id) : null };
}

async function getJobsByIds(db, ids, userId) {
  const objectIds = ids.filter(Boolean).map((id) => (typeof id === 'string' ? new ObjectId(id) : id));
  if (!objectIds.length) return [];
  return db.collection(JOBS).find({ _id: { $in: objectIds }, user_id: userId }).toArray();
}

async function countUnreadNotifications(db, userId) {
  return db.collection(NOTIFICATIONS).countDocuments({ user_id: userId, read: false });
}

/** Scoped to userId — a user can only mark their own notifications read. */
async function markNotificationsRead(db, userId, ids) {
  const objIds = ids.map((id) => (typeof id === 'string' ? new ObjectId(id) : id));
  const update = { $set: { read: true } };
  // Read notifications go sooner: expire_at moves to now + notificationsReadDays,
  // but never later than it already was ($min).
  const exp = expireAt('notificationsReadDays');
  if (exp) update.$min = { expire_at: exp };
  await db.collection(NOTIFICATIONS).updateMany({ _id: { $in: objIds }, user_id: userId }, update);
}

/** Is `url` still referenced by any OTHER job doc? "Recreate again" prefills a new
 * job with a PRIOR job's already-uploaded product/extra image URL (see
 * MySpacePage.jsx's toAd()), so more than one job can legitimately point at the
 * same NAS file — this must be checked before actually deleting it, not just
 * when the one job that originally uploaded it gets removed. */
async function isImageUrlStillReferenced(db, url, excludeJobId) {
  const filter = {
    $or: [{ 'request.product_image_url': url }, { 'request.extra_image_urls': url }],
  };
  if (excludeJobId) filter._id = { $ne: typeof excludeJobId === 'string' ? new ObjectId(excludeJobId) : excludeJobId };
  const count = await db.collection(JOBS).countDocuments(filter, { limit: 1 });
  return count > 0;
}

// ── imagegen_nas_deletions ───────────────────────────────────────────────────
/** Durable queue of uploaded reference-image URLs to delete from NAS. Enqueuing
 * is a fast local insert (the request that triggers it — MySpace delete, or
 * removing an unused upload from the modal — must never wait on the actual NAS
 * round-trip); imageGenNasCleanupSweep.js processes this queue on its own
 * schedule, so a server restart mid-delete just picks the row back up next
 * sweep instead of losing track of it. `url` is unique — removing the same
 * image from two places (e.g. two browser tabs) only queues one row. */
async function enqueueNasDeletion(db, url, userId = null) {
  if (!url) return;
  const now = new Date();
  await db.collection(NAS_DELETIONS).updateOne(
    { url },
    { $setOnInsert: { url, user_id: userId, attempts: 0, status: 'pending', created_at: now }, $set: { next_attempt_at: now } },
    { upsert: true },
  );
}

async function listDueNasDeletions(db, limit = 50) {
  return db.collection(NAS_DELETIONS)
    .find({ status: 'pending', next_attempt_at: { $lte: new Date() } })
    .limit(limit)
    .toArray();
}

async function deleteNasDeletionRecord(db, id) {
  await db.collection(NAS_DELETIONS).deleteOne({ _id: id });
}

async function rescheduleNasDeletion(db, id, { attempts, nextAttemptAt }) {
  await db.collection(NAS_DELETIONS).updateOne(
    { _id: id },
    { $set: { attempts, next_attempt_at: nextAttemptAt } },
  );
}

/** Give up retrying but keep the row (status 'failed') for manual follow-up —
 * same posture as nasUploadQueue's failed/ dir, just a status flag since
 * there's no file payload to move here. */
async function markNasDeletionFailed(db, id) {
  const set = { status: 'failed' };
  const exp = expireAt('failedNasDeletionDays');
  if (exp) set.expire_at = exp;
  await db.collection(NAS_DELETIONS).updateOne({ _id: id }, { $set: set });
}

module.exports = {
  init, expireAt, COLLECTIONS: { JOBS, CREDITS, LEDGER, NOTIFICATIONS, NAS_DELETIONS, TOPUP_GRANTS },
  insertJob, getJobById, getJobsByIds, updateJob, deleteJob, listJobs, findStuckJobs,
  getCreditsDoc, getBalance, ensureCreditsDoc, applyCycle, setCycleMeta, reserveCredit, refundCredit, grantTopup, listOpenTopupGrants, reverseTopupGrant,
  appendLedger, listLedger, listLedgerPage,
  insertNotification, listNotifications, countUnreadNotifications, markNotificationsRead,
  isImageUrlStillReferenced,
  enqueueNasDeletion, listDueNasDeletions, deleteNasDeletionRecord, rescheduleNasDeletion, markNasDeletionFailed,
};
