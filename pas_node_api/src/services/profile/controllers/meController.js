'use strict';

/**
 * GET/PATCH /api/v1/profile/me — Account tab.
 *
 * Data split, deliberately:
 *   - name/email/plan come from aMember (read-only — this app NEVER writes to
 *     aMember, per explicit instruction) via amemberAuth's fetchAmemberUser.
 *   - company/phone/timezone/language/avatar/display-name-override are LOCAL
 *     to this app (Mongo `profile_users`, see ../repository.js) since
 *     there's nowhere else for them to live without writing to aMember.
 * A field that's genuinely unavailable (e.g. aMember doesn't return it, and
 * the user has never set a local value) comes back `null` — the frontend
 * shows an empty/placeholder state, never a fabricated value.
 *
 * Password change and account deletion are NOT implemented as real mutations
 * here: passwords are managed in aMember (this app doesn't own the hash for
 * aMember-authenticated users), and account deletion spans aMember + SQL +
 * Elasticsearch + Mongo — too wide a blast radius to wire blind. Both actions
 * route to aMember's own member area / support instead (see billingController
 * for the same posture on plan changes).
 */

const fs = require('fs');
const config = require('../../../config');
const { fetchAmemberUser } = require('../../../auth/amemberAuth');
const repo = require('../repository');
const { storeInNas, resolveMediaUrl, deleteFromNas } = require('../../../insertion/helpers/nasClient');
const { resolvePlanIdentity } = require('../../planControl/engine/planIdentityResolver');
const { ok, rejected, serverError } = require('../helpers/responses');

/** Same resolver imageGen's creditsController.js uses for its plan badge — a
 * real plan family name ("Palladium"), not the raw numeric plan ID. Returns
 * null when unresolvable, so the frontend shows an empty state rather than
 * a bare number. */
function resolvePlanLabel(req) {
  const planId = req.user?.userSubscriptionType ?? req.user?.plan_id;
  if (planId === undefined || planId === null) return null;
  const identity = resolvePlanIdentity(planId);
  return identity?.label || null;
}

function userId(req) {
  return req.user?.user_id ?? req.user?.id;
}

async function buildProfile(req) {
  const uid = userId(req);
  const [amUser, localDoc] = await Promise.all([
    fetchAmemberUser({ userId: uid }, config.amember.apiUrl, config.amember.apiKey),
    repo.getUser(req.profileDb, uid),
  ]);

  return {
    id: uid,
    // aMember is the source of truth for these; JWT values are the fallback
    // when the live aMember call fails (never worse than what login already had).
    name: localDoc?.display_name || amUser?.name || req.user?.name || null,
    email: amUser?.email || req.user?.email || null,
    email_verified: true, // aMember accounts are verified at signup; no separate flag exists to check
    company: localDoc?.company ?? amUser?.company ?? null,
    phone: localDoc?.phone ?? amUser?.phone ?? null,
    timezone: localDoc?.timezone || null,
    language: localDoc?.language || null,
    avatar_url: localDoc?.avatar_url ? resolveMediaUrl(localDoc.avatar_url) : null,
    plan_label: resolvePlanLabel(req),
  };
}

async function getMe(req, res) {
  if (!userId(req)) return res.status(401).json(rejected(401, 'Unauthorized.'));
  try {
    const profile = await buildProfile(req);
    return res.json(ok('Profile.', profile));
  } catch (err) {
    return res.status(500).json(serverError(500, 'Could not load your profile right now.', { error: err.message }));
  }
}

const EDITABLE = {
  name: 'display_name',
  company: 'company',
  phone: 'phone',
  timezone: 'timezone',
  language: 'language',
};

async function updateMe(req, res) {
  const uid = userId(req);
  if (!uid) return res.status(401).json(rejected(401, 'Unauthorized.'));

  const fields = {};
  for (const [bodyKey, field] of Object.entries(EDITABLE)) {
    if (req.body?.[bodyKey] === undefined) continue;
    const value = req.body[bodyKey];
    if (value !== null && typeof value !== 'string') {
      return res.status(422).json(rejected(422, `The ${bodyKey} field must be a string.`));
    }
    fields[field] = value === null ? null : String(value).slice(0, 255);
  }
  if (!Object.keys(fields).length) {
    return res.status(422).json(rejected(422, 'Nothing to update.'));
  }

  try {
    await repo.upsertFields(req.profileDb, uid, fields);
    const profile = await buildProfile(req);
    return res.json(ok('Profile updated.', profile));
  } catch (err) {
    return res.status(500).json(serverError(500, 'Could not save your profile right now.', { error: err.message }));
  }
}

async function uploadAvatar(req, res) {
  const uid = userId(req);
  if (!uid) return res.status(401).json(rejected(401, 'Unauthorized.'));
  const file = req.file;
  if (!file) return res.status(422).json(rejected(422, 'No image file was uploaded.'));

  try {
    const prevDoc = await repo.getUser(req.profileDb, uid);
    const nasPath = await storeInNas('AVATAR', file.path, uid, 'profile', String(Date.now()));
    if (!nasPath || String(nasPath).includes('DefaultImage')) {
      return res.status(502).json(serverError(502, 'Could not store this image right now. Please try again.'));
    }
    await repo.upsertFields(req.profileDb, uid, { avatar_url: nasPath });

    // Replacing an existing avatar — best-effort delete the old file. Low
    // volume/low stakes (one small image per user), so a direct fire-and-forget
    // call is proportionate here, unlike imageGen's durable queue (built for
    // NAS deletes that must survive a restart at real volume).
    if (prevDoc?.avatar_url) {
      deleteFromNas(prevDoc.avatar_url).catch(() => {});
    }

    return res.json(ok('Uploaded.', { avatar_url: resolveMediaUrl(nasPath) }));
  } catch (err) {
    return res.status(500).json(serverError(500, 'Upload failed.', { error: err.message }));
  } finally {
    fs.unlink(file.path, () => {});
  }
}

async function removeAvatar(req, res) {
  const uid = userId(req);
  if (!uid) return res.status(401).json(rejected(401, 'Unauthorized.'));
  try {
    const doc = await repo.getUser(req.profileDb, uid);
    await repo.upsertFields(req.profileDb, uid, { avatar_url: null });
    if (doc?.avatar_url) deleteFromNas(doc.avatar_url).catch(() => {});
    return res.json(ok('Removed.'));
  } catch (err) {
    return res.status(500).json(serverError(500, 'Could not remove your photo right now.', { error: err.message }));
  }
}

module.exports = { getMe, updateMe, uploadAvatar, removeAvatar };
