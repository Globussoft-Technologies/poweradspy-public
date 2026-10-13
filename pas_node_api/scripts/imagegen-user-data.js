'use strict';

/**
 * AI Recreate data tool — everything for one user, plus retention maintenance.
 *
 *   node scripts/imagegen-user-data.js <userId>                 summary of all of one user's data
 *   node scripts/imagegen-user-data.js <userId> --full          ...with every document
 *   node scripts/imagegen-user-data.js <userId> --purge --yes   DELETE all of one user's AI Recreate data
 *   node scripts/imagegen-user-data.js --apply-retention        apply config imageGen.retention to existing docs
 *
 * Collections (all keyed by user_id; credits/profile use _id = user_id):
 *   imagegen_jobs, imagegen_credits, imagegen_credit_ledger, imagegen_notifications,
 *   imagegen_topup_grants, imagegen_nas_deletions  (Mongo connection "imageGen")
 *   profile_users                                   (Mongo connection "profile")
 * In development both connections point at the shared dev database (see
 * src/config/networks.js netVal) — in production they are pas_imagegen / pas_profile.
 *
 * Read-only unless --purge --yes or --apply-retention is given.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { MongoClient } = require('mongodb');
const networks = require('../src/config/networks');
const imageGenConfig = require('../src/services/imageGen/config');
const repo = require('../src/services/imageGen/repository');

const { JOBS, CREDITS, LEDGER, NOTIFICATIONS, NAS_DELETIONS, TOPUP_GRANTS } = repo.COLLECTIONS;
const PROFILE_USERS = 'profile_users';
const DAY_MS = 86400000;

async function connect(slug) {
  const m = networks[slug]?.database?.mongo;
  if (!m?.uri) throw new Error(`No Mongo config for "${slug}"`);
  const client = new MongoClient(m.uri);
  await client.connect();
  return { client, db: client.db(m.database) };
}

/** user_id may have been stored as a number or a string — match both. */
function userFilter(userId, field = 'user_id') {
  const values = [String(userId)];
  if (Number.isFinite(Number(userId))) values.push(Number(userId));
  return { [field]: { $in: values } };
}

function compact(doc) {
  const out = { ...doc };
  if (out.result?.images) out.result = { images: out.result.images.length };
  if (out.data?.retry) delete out.data.retry;
  return out;
}

async function showUser(igDb, profDb, userId, full) {
  const report = {};
  const credits = await igDb.collection(CREDITS).findOne(userFilter(userId, '_id'));
  report.credits = credits
    ? { balance: credits.balance, cycle_balance: credits.cycle_balance, topup_balance: credits.topup_balance, cycle_key: credits.cycle_key, plan: credits.cycle_meta }
    : null;
  report.profile = await profDb.collection(PROFILE_USERS).findOne(userFilter(userId, '_id'));

  const lists = {
    jobs: [JOBS, { created_at: -1 }],
    ledger: [LEDGER, { created_at: -1 }],
    notifications: [NOTIFICATIONS, { created_at: -1 }],
    topups: [TOPUP_GRANTS, { created_at: -1 }],
    nas_deletions: [NAS_DELETIONS, { created_at: -1 }],
  };
  for (const [name, [coll, sort]] of Object.entries(lists)) {
    const docs = await igDb.collection(coll).find(userFilter(userId)).sort(sort).toArray();
    const byKey = {};
    for (const d of docs) {
      const k = d.status || d.reason || (d.read === undefined ? 'all' : d.read ? 'read' : 'unread');
      byKey[k] = (byKey[k] || 0) + 1;
    }
    report[name] = {
      count: docs.length,
      breakdown: byKey,
      expiring: docs.filter((d) => d.expire_at).length,
      ...(full ? { docs: docs.map(compact) } : {}),
    };
  }
  console.log(JSON.stringify(report, null, 2));
}

async function purgeUser(igDb, profDb, userId) {
  const results = {};
  for (const coll of [JOBS, LEDGER, NOTIFICATIONS, TOPUP_GRANTS, NAS_DELETIONS]) {
    results[coll] = (await igDb.collection(coll).deleteMany(userFilter(userId))).deletedCount;
  }
  results[CREDITS] = (await igDb.collection(CREDITS).deleteMany(userFilter(userId, '_id'))).deletedCount;
  results[PROFILE_USERS] = (await profDb.collection(PROFILE_USERS).deleteMany(userFilter(userId, '_id'))).deletedCount;
  console.log('Deleted:', JSON.stringify(results, null, 2));
  console.log('Note: NAS image files are not touched by --purge.');
}

/** expire_at = <dateField> + days, or remove expire_at if the setting is null. */
async function setExpiry(coll, filter, dateField, days) {
  if (Number.isFinite(days) && days > 0) {
    return (await coll.updateMany(filter, [{ $set: { expire_at: { $add: [`$${dateField}`, days * DAY_MS] } } }])).modifiedCount;
  }
  return (await coll.updateMany(filter, { $unset: { expire_at: '' } })).modifiedCount;
}

async function applyRetention(igDb) {
  const r = imageGenConfig.retention || {};
  await repo.init(igDb); // makes sure the TTL indexes exist
  const out = {};

  out.finalize_debit_rows_removed = (await igDb.collection(LEDGER).deleteMany({ reason: 'finalize_debit' })).deletedCount;
  out.failed_jobs = await setExpiry(igDb.collection(JOBS), { status: { $in: ['failed', 'cancelled'] } }, 'updated_at', Number(r.failedJobsDays));
  out.ledger = await setExpiry(igDb.collection(LEDGER), {}, 'created_at', Number(r.ledgerDays));
  out.notifications = await setExpiry(igDb.collection(NOTIFICATIONS), {}, 'created_at', Number(r.notificationsUnreadDays));
  const readDays = Number(r.notificationsReadDays);
  if (Number.isFinite(readDays) && readDays > 0) {
    const readBy = new Date(Date.now() + readDays * DAY_MS);
    out.read_notifications = (await igDb.collection(NOTIFICATIONS).updateMany(
      { read: true },
      [{ $set: { expire_at: { $min: [{ $ifNull: ['$expire_at', readBy] }, readBy] } } }],
    )).modifiedCount;
  }
  const nasDays = Number(r.failedNasDeletionDays);
  out.failed_nas = await setExpiry(igDb.collection(NAS_DELETIONS), { status: 'failed' }, 'created_at', nasDays);

  const max = Number(r.notificationsMaxPerUser);
  if (Number.isFinite(max) && max > 0) {
    let capped = 0;
    for (const userId of await igDb.collection(NOTIFICATIONS).distinct('user_id')) {
      const cutoff = await igDb.collection(NOTIFICATIONS).find({ user_id: userId }, { projection: { created_at: 1 } })
        .sort({ created_at: -1 }).skip(max).limit(1).next();
      if (cutoff) capped += (await igDb.collection(NOTIFICATIONS).deleteMany({ user_id: userId, created_at: { $lte: cutoff.created_at } })).deletedCount;
    }
    out.notifications_over_cap_removed = capped;
  }
  console.log('Retention applied (MongoDB removes expired docs within ~60s):', JSON.stringify(out, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  const userId = args.find((a) => !a.startsWith('--'));
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  if (!userId && !flags.has('--apply-retention')) {
    console.log('Usage: node scripts/imagegen-user-data.js <userId> [--full] [--purge --yes] | --apply-retention');
    process.exit(1);
  }

  const ig = await connect('imageGen');
  const prof = await connect('profile');
  try {
    console.log(`imageGen DB: ${ig.db.databaseName} | profile DB: ${prof.db.databaseName}`);
    if (flags.has('--apply-retention')) await applyRetention(ig.db);
    if (userId) {
      if (flags.has('--purge')) {
        if (!flags.has('--yes')) { console.log('Refusing to purge without --yes.'); return; }
        await purgeUser(ig.db, prof.db, userId);
      } else {
        await showUser(ig.db, prof.db, userId, flags.has('--full'));
      }
    }
  } finally {
    await ig.client.close();
    await prof.client.close();
  }
}

main().catch((err) => { console.error('Failed:', err.message); process.exit(1); });
