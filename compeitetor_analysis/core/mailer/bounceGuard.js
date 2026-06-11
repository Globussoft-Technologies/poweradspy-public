// Bounce-blacklist helpers (manifest §15).
//
// One source of truth for "should we send to this email?". All four send
// paths (owner competitorUpdate, member-brand competitorUpdate, manual
// send-competitor, manual send-data-report) call `isBlacklisted(email)`
// before talking to SendGrid; when it returns true they write a `skipped`
// log row with the standard reason and skip the send.
//
// The blacklist is fed by:
//   - SendGrid `bounce` webhook events (emailAudit.applyWebhookEvent).
//   - Inline detection: any `email_send_log` write with status=failed
//     whose failure_reason matches a bounce signature (emailAudit.logSend).

import logger from "../../resources/logs/logger.log.js";
import BouncedEmail from "../../models/bouncedEmail.js";

// Failure reasons that mean "the recipient address itself rejected the mail".
// Conservative on purpose — transient SMTP errors, sender-side throttling,
// or rate limits must NOT poison the blacklist. If we ever see a real bounce
// phrase we don't catch, add it here.
const BOUNCE_REASON_RE = /\b(bounce|bounced|bouncing|hard\s*bounce|undeliverable|address\s+(?:rejected|invalid|does\s*not\s*exist|not\s*found)|user\s+(?:unknown|not\s*found)|mailbox\s+(?:unavailable|not\s*found|does\s*not\s*exist)|no\s+such\s+user|invalid\s+recipient|recipient\s+rejected|550(?:\s+5\.\d+\.\d+)?)\b/i;

export function isBounceReason(reason) {
  if (!reason) return false;
  return BOUNCE_REASON_RE.test(String(reason));
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/**
 * Is this address on the bounce blacklist?
 * Returns false on lookup error (best-effort — never block a send because of
 * a transient DB hiccup; if it bounces again the webhook adds it again).
 */
export async function isBlacklisted(email) {
  const e = normalizeEmail(email);
  if (!e) return false;
  try {
    const doc = await BouncedEmail.findOne({ email: e }, { _id: 1 }).lean();
    return !!doc;
  } catch (err) {
    logger.error(`[bounceGuard] isBlacklisted lookup failed for "${e}": ${err.message}`);
    return false;
  }
}

/**
 * Add (or refresh) an email on the blacklist. Idempotent — repeated bounces
 * for the same address bump `bounce_count` and `last_bounced_at`.
 */
export async function markBounced({ email, reason = null, mail_type = null, source = "webhook" }) {
  const e = normalizeEmail(email);
  if (!e) return;
  try {
    const now = new Date();
    await BouncedEmail.updateOne(
      { email: e },
      {
        $set: { last_bounced_at: now, last_reason: reason, last_mail_type: mail_type, source },
        $setOnInsert: { email: e, first_bounced_at: now },
        $inc: { bounce_count: 1 },
      },
      { upsert: true }
    );
    logger.info(`[bounceGuard] blacklisted "${e}" (source=${source}, reason=${reason || "n/a"})`);
  } catch (err) {
    logger.error(`[bounceGuard] markBounced failed for "${e}": ${err.message}`);
  }
}

/**
 * Stable skip reason — referenced by manifest §15 and rendered in the
 * admin panel's EmailDetails view. Don't change the wording without also
 * updating the manifest, FE filter logic, and any analytics queries that
 * group on it.
 */
export const BLACKLISTED_SKIP_REASON =
  "address previously bounced — recipient ignored";
