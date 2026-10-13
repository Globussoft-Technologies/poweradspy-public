'use strict';

/**
 * GET/PATCH /api/v1/profile/notification-preferences — Notifications tab.
 *
 * In-app/push only — this app does NOT touch email/SendGrid delivery at all
 * (explicit instruction: email flows stay exactly as they are, untouched).
 * One toggle per real, already-firing notification — no mock rows. Only
 * recreate_ready/recreate_failed exist today because those are the only
 * notification types that genuinely fire anywhere in this codebase (imageGen's
 * in-app bell + push, both via jobsController.js's notifyTerminalJob). A
 * "credits running low" / "weekly digest" / etc. row was removed rather than
 * shown as a toggle that silently does nothing — add it back here only once
 * that notification actually exists to gate.
 *
 * Stored shape is a plain { [key]: boolean } map on
 * profile_users.notification_preferences (Mongo) — default true (every
 * notification is on until a user explicitly turns it off). The actual gating
 * happens in imageGen's pushNotify.js / jobsController.js via
 * repository.js's isNotificationEnabled(), which reads this same document.
 */

const repo = require('../repository');
const { ok, rejected } = require('../helpers/responses');

const KEYS = [
  { key: 'recreate_ready', title: 'Recreated ad is ready', description: "Your AI Recreate image finished generating." },
  { key: 'recreate_failed', title: 'Generation failed / refund', description: 'A Recreate job failed and your credit was refunded.' },
  { key: 'keyword_search_results', title: 'Keyword search results', description: 'New ads found for a keyword, advertiser, or domain you searched.' },
];

function userId(req) {
  return req.user?.user_id ?? req.user?.id;
}

/** { items: [{key, title, description, enabled}] } — row metadata comes from
 * KEYS (single source of truth shared with the gating check), values merged
 * with the stored preferences doc. */
function withDefaults(stored) {
  return KEYS.map(({ key, title, description }) => ({
    key, title, description, enabled: stored?.[key] !== false,
  }));
}

async function getPreferences(req, res) {
  const uid = userId(req);
  if (!uid) return res.status(401).json(rejected(401, 'Unauthorized.'));
  try {
    const doc = await repo.getUser(req.profileDb, uid);
    return res.json(ok('Preferences.', { items: withDefaults(doc?.notification_preferences || null) }));
  } catch (err) {
    return res.status(500).json({ code: 500, status: 'server_error', message: 'Could not load preferences right now.', error: err.message });
  }
}

async function updatePreferences(req, res) {
  const uid = userId(req);
  if (!uid) return res.status(401).json(rejected(401, 'Unauthorized.'));

  // authMiddleware auto-injects body.user_id for every authenticated request
  // (see src/middleware/auth.js — a convenience other controllers like
  // freePlanCheck rely on reading directly off req.body). Strip it before
  // validating/merging so it's never mistaken for a preference key or
  // written into the stored preferences doc.
  const { user_id: _ignoredUserId, ...patch } = req.body || {};
  const validKeys = new Set(KEYS.map((k) => k.key));
  for (const [key, value] of Object.entries(patch)) {
    if (!validKeys.has(key)) return res.status(422).json(rejected(422, `Unknown preference key: ${key}.`));
    if (typeof value !== 'boolean') return res.status(422).json(rejected(422, `${key} must be a boolean.`));
  }
  if (!Object.keys(patch).length) {
    return res.status(422).json(rejected(422, 'Nothing to update.'));
  }

  try {
    const doc = await repo.getUser(req.profileDb, uid);
    const next = { ...(doc?.notification_preferences || {}), ...patch };
    await repo.upsertFields(req.profileDb, uid, { notification_preferences: next });
    return res.json(ok('Preferences saved.', { items: withDefaults(next) }));
  } catch (err) {
    return res.status(500).json({ code: 500, status: 'server_error', message: 'Could not save preferences right now.', error: err.message });
  }
}

module.exports = { getPreferences, updatePreferences };
