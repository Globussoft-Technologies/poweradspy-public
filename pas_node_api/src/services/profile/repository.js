'use strict';

/**
 * Profile — Mongo repository.
 *
 * One collection, `profile_users`, `_id = userId` — local-extension data for
 * the Account tab (display name override, company, phone, timezone, language,
 * avatar) and the Notifications tab (toggle preferences). Mongo, not a SQL
 * migration on am_user_action: schemaless, so this feature needed zero DDL
 * step before it could work — the SAME posture imageGen's own Mongo
 * collections already use in this codebase, just a different Mongo database
 * (`pas_profile`, see src/config/networks.js's `profile` entry).
 *
 * `exec` is always the Mongo `db` handle from DatabaseManager.getMongo('profile').db
 * (a native MongoClient Db instance) — no ORM, matching every other Mongo use
 * in this codebase.
 */

const databaseManager = require('../../database/DatabaseManager');

const USERS = 'profile_users';

let indexesEnsured = false;

async function ensureIndexes(db) {
  if (indexesEnsured) return;
  indexesEnsured = true;
  try {
    // _id is already the primary key/index — nothing extra needed today.
    // Placeholder init() call kept for symmetry with imageGen's repository.js
    // (same lazy "ensure on first real request" pattern) in case a secondary
    // index is ever needed here.
  } catch (err) {
    indexesEnsured = false;
    throw err;
  }
}

async function init(db) {
  await ensureIndexes(db);
}

async function getUser(db, userId) {
  if (!userId) return null;
  return db.collection(USERS).findOne({ _id: userId });
}

/** Upserts only the given top-level fields — never clobbers the rest of the
 * document (e.g. updating notification_preferences never touches company/phone). */
async function upsertFields(db, userId, fields) {
  if (!userId || !fields || !Object.keys(fields).length) return null;
  const res = await db.collection(USERS).findOneAndUpdate(
    { _id: userId },
    { $set: { ...fields, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } },
    { upsert: true, returnDocument: 'after' },
  );
  return res?.value ?? res;
}

/** Convenience accessor for OTHER services (e.g. imageGen's push sender) that
 * need to check a notification preference but don't otherwise touch the
 * profile service — same cross-service reuse pattern as amemberAuth.js's
 * exported fetchAmemberUser. Returns null if the 'profile' Mongo connection
 * isn't up yet (caller should fail open — see isNotificationEnabled below). */
function getProfileDb() {
  const mongo = databaseManager.getMongo('profile');
  return mongo?.db || null;
}

/** Whether `key` (e.g. 'recreate_ready') is enabled for `userId` — defaults to
 * true (every notification is on until a user explicitly turns it off) and
 * fails open (true) on any error, so a DB hiccup here can never silently swallow
 * a real notification — same "never worse than before this preference existed"
 * posture as everywhere else in this feature. */
async function isNotificationEnabled(userId, key) {
  try {
    const db = getProfileDb();
    if (!db || !userId) return true;
    const doc = await db.collection(USERS).findOne({ _id: userId }, { projection: { notification_preferences: 1 } });
    const pref = doc?.notification_preferences?.[key];
    return pref !== false;
  } catch {
    return true;
  }
}

module.exports = { init, getUser, upsertFields, getProfileDb, isNotificationEnabled };
