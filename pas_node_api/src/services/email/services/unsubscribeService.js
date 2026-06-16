'use strict';

/**
 * Email unsubscribe service.
 *
 * Mirrors the old PHP unsubscribe intent (mark the user opted-out in aMember +
 * stop SendGrid from delivering) but with a single, universal mechanism so an
 * unsubscribe is effective across EVERY mail sender (data-report cron,
 * competitor digest, daily-keyword mails) without each one needing its own check:
 *
 *   1. SendGrid GLOBAL unsubscribe suppression — the catch-all. Once an address
 *      is here SendGrid refuses delivery from this account, no matter which
 *      service tries to send. Also makes it show in the admin suppression panel.
 *   2. aMember `unsubscribed = 1` — so the data-report recipient resolver (which
 *      pulls aMember users with unsubscribed = 0) never even attempts the send.
 *
 * Both steps run in parallel and are best-effort: if one fails the other still
 * takes effect, and the call reports per-step status. Resubscribe reverses both.
 */

const crypto = require('crypto');
const axios = require('axios');
const config = require('../../../config');
const logger = require('../../../logger');

const log = logger.createChild('email-unsubscribe');

const SENDGRID_GLOBAL_UNSUB = 'https://api.sendgrid.com/v3/asm/suppressions/global';

// compeitetor_analysis API base — when configured, the unsubscribe is also
// recorded as an email_send_events row there so the admin dashboard's
// Unsubscribed TILE reflects it (the suppression panel already does). Optional.
const competitorApiUrl = () => String(config.competitorAnalysis?.apiUrl || '').replace(/\/+$/, '');

const normEmail = (e) => String(e || '').trim().toLowerCase();
const isEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

/**
 * Verify the signed unsubscribe token (HMAC-SHA256 of the lowercased email with
 * the shared secret). Ensures the request came from a real mail link, not a
 * guessed/direct URL. Returns { ok, enforced }. When no secret is configured the
 * check is DISABLED (ok:true, enforced:false) — set `unsubscribe.secret` in BOTH
 * apps to actually lock it down.
 */
function verifyEmailToken(email, token) {
  const secret = config.unsubscribe?.secret || '';
  if (!secret) return { ok: true, enforced: false };
  const expected = crypto.createHmac('sha256', secret).update(normEmail(email)).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token || ''));
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { ok, enforced: true };
}

/** aMember: set the `unsubscribed` flag (1 = unsubscribed, 0 = subscribed). */
async function setAmemberUnsubscribed(email, value) {
  const apiUrl = config.amember?.apiUrl;
  const apiKey = config.amember?.apiKey;
  if (!apiUrl || !apiKey) return { ok: false, skipped: true, reason: 'aMember not configured' };

  try {
    // 1. Resolve the aMember user_id from the email.
    const findUrl = `${apiUrl}users?_key=${encodeURIComponent(apiKey)}&_filter[email]=${encodeURIComponent(email)}`;
    const { data } = await axios.get(findUrl, { timeout: 10000 });
    const rows = Array.isArray(data) ? data : (data && typeof data === 'object' ? Object.values(data) : []);
    const user = rows.find((u) => u && normEmail(u.email) === email) || rows.find((u) => u && u.user_id);
    if (!user || !user.user_id) return { ok: false, reason: 'email not found in aMember' };

    // 2. Flip the flag.
    const updUrl = `${apiUrl}users/${user.user_id}?_key=${encodeURIComponent(apiKey)}`;
    await axios.put(updUrl, new URLSearchParams({ unsubscribed: String(value) }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    });
    return { ok: true, user_id: user.user_id };
  } catch (e) {
    const msg = e?.response?.data ? JSON.stringify(e.response.data) : e.message;
    log.error('aMember update failed', { email, value, error: msg });
    return { ok: false, error: msg };
  }
}

/** SendGrid: add to the global unsubscribe suppression list. Idempotent. */
async function addSendgridGlobalUnsub(email) {
  const key = config.sendgrid?.apiKey;
  if (!key) return { ok: false, skipped: true, reason: 'SendGrid not configured' };
  try {
    await axios.post(SENDGRID_GLOBAL_UNSUB, { recipient_emails: [email] }, {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    return { ok: true };
  } catch (e) {
    const msg = e?.response?.data ? JSON.stringify(e.response.data) : e.message;
    log.error('SendGrid global unsubscribe add failed', { email, error: msg });
    return { ok: false, error: msg };
  }
}

/** SendGrid: remove from the global unsubscribe list (resubscribe). 404 = already gone = ok. */
async function removeSendgridGlobalUnsub(email) {
  const key = config.sendgrid?.apiKey;
  if (!key) return { ok: false, skipped: true, reason: 'SendGrid not configured' };
  try {
    await axios.delete(`${SENDGRID_GLOBAL_UNSUB}/${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${key}` },
      timeout: 10000,
    });
    return { ok: true };
  } catch (e) {
    if (e?.response?.status === 404) return { ok: true };
    const msg = e?.response?.data ? JSON.stringify(e.response.data) : e.message;
    log.error('SendGrid global unsubscribe remove failed', { email, error: msg });
    return { ok: false, error: msg };
  }
}

/** Record the unsubscribe in compeitetor_analysis' event store so the dashboard's
 * Unsubscribed tile reflects it. Best-effort; skipped when the URL isn't set. */
async function recordDashboardEvent(email, mailType) {
  const base = competitorApiUrl();
  if (!base) return { ok: false, skipped: true, reason: 'competitorAnalysis.apiUrl not set' };
  try {
    await axios.post(`${base}/email-events/unsubscribe`, { email, mail_type: mailType || null }, { timeout: 10000 });
    return { ok: true };
  } catch (e) {
    const msg = e?.response?.data ? JSON.stringify(e.response.data) : e.message;
    log.error('record dashboard unsubscribe event failed', { email, error: msg });
    return { ok: false, error: msg };
  }
}

async function unsubscribe(rawEmail, mailType) {
  const email = normEmail(rawEmail);
  if (!isEmail(email)) return { success: false, error: 'A valid email is required' };
  const [amember, sendgrid, dashboard] = await Promise.all([
    setAmemberUnsubscribed(email, 1),
    addSendgridGlobalUnsub(email),
    recordDashboardEvent(email, mailType),
  ]);
  // Effective if EITHER took hold (SendGrid global alone already stops delivery).
  return { success: !!(amember.ok || sendgrid.ok), email, amember, sendgrid, dashboard };
}

async function resubscribe(rawEmail) {
  const email = normEmail(rawEmail);
  if (!isEmail(email)) return { success: false, error: 'A valid email is required' };
  const [amember, sendgrid] = await Promise.all([
    setAmemberUnsubscribed(email, 0),
    removeSendgridGlobalUnsub(email),
  ]);
  return { success: !!(amember.ok || sendgrid.ok), email, amember, sendgrid };
}

module.exports = {
  unsubscribe,
  resubscribe,
  verifyEmailToken,
  setAmemberUnsubscribed,
  addSendgridGlobalUnsub,
  removeSendgridGlobalUnsub,
};
