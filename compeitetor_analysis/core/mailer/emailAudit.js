import crypto from "crypto";
import logger from "../../resources/logs/logger.log.js";
import EmailSendLog from "../../models/emailSendLog.js";
import EmailSendEvent from "../../models/emailSendEvent.js";
import { markBounced, isBounceReason } from "./bounceGuard.js";

/**
 * Email audit helpers (NEW, Feature 2).
 *
 * Writer-side logging for the two report mails. EVERYTHING here is wrapped in
 * try/catch and never throws — a logging hiccup must never break an email send
 * (guardrail in EMAIL_ANALYTICS_MANIFEST.md §7).
 *
 *   newSendId()            → a UUID to pass to SendGrid as custom_args.send_id
 *   logSend(doc)           → upsert one email_send_log row (sent/failed/skipped)
 *   applyWebhookEvent(evt) → store a raw event + advance the log status
 */

export function newSendId() {
  return crypto.randomUUID();
}

/**
 * Deterministic send_id for the daily dataReport blast: same (date, email)
 * always maps to the same id. Lets us pre-create a `queued` row per recipient
 * and then UPDATE that exact row to `sent` when it's actually mailed — so the
 * send log shows "Processing" → "Sent" → "Delivered" per recipient.
 */
export function dataReportSendId(date, email) {
  const h = crypto.createHash("sha1").update(`${date}:${String(email).toLowerCase()}`).digest("hex").slice(0, 20);
  return `DR-${date}-${h}`;
}

/**
 * Record an unsubscribe that happened through OUR custom unsubscribe endpoint
 * (not a SendGrid webhook). Writes an `email_send_events` row so the admin
 * dashboard's "Unsubscribed" tile — which counts unsubscribe/group_unsubscribe
 * events — reflects it too (the SendGrid suppression-list panel already does).
 * Best-effort; never throws.
 * @param {{ email: string, mail_type?: string|null }} args
 */
export async function recordCustomUnsubscribe({ email, mail_type = null } = {}) {
  const e = String(email || "").trim().toLowerCase();
  if (!e.includes("@")) return { ok: false, error: "invalid email" };
  try {
    // Idempotent: one unsubscribe event per email. The unsubscribe page
    // auto-fires on every load/refresh, so without this guard each refresh would
    // add another row and inflate the dashboard's Unsubscribed tile.
    const existing = await EmailSendEvent.findOne({
      email: e,
      event_type: { $in: ["unsubscribe", "group_unsubscribe"] },
    }).select("_id").lean();
    if (existing) return { ok: true, deduped: true };

    await EmailSendEvent.create({
      event_id: newSendId(),
      send_id: null,
      mail_type,
      email: e,
      event_type: "unsubscribe",
      event_ts: new Date(),
      reason: "custom unsubscribe",
      sg_message_id: null,
      raw: { source: "custom-unsubscribe" },
    });
    return { ok: true };
  } catch (err) {
    logger.error(`[emailAudit] recordCustomUnsubscribe failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/**
 * Pre-create `queued` (processing) rows for every recipient of a run. Bulk +
 * resume-safe (duplicate send_ids on a resumed run are ignored). Best-effort —
 * never throws.
 */
export async function seedQueued(mail_type, date, recipients) {
  if (!Array.isArray(recipients) || !recipients.length) return;
  try {
    const now = new Date();
    const docs = recipients.map((email) => ({
      send_id: dataReportSendId(date, email),
      mail_type,
      to: String(email).trim().toLowerCase(),
      status: "queued",
      amember_id: null, user_name: null, subject: null, failure_reason: null, bounce_type: null,
      sendgrid_message_id: null, scheduled_for: null, sent_at: null, delivered_at: null,
      opened_at: null, bounced_at: null, resend_of: null, meta: {},
      createdAt: now, updatedAt: now, __v: 0,
    }));
    const col = EmailSendLog.collection;
    const CHUNK = 5000;
    for (let i = 0; i < docs.length; i += CHUNK) {
      try {
        await col.insertMany(docs.slice(i, i + CHUNK), { ordered: false });
      } catch (e) {
        // E11000 duplicate key on a resumed run = those rows already exist. Fine.
      }
    }
    logger.info(`[emailAudit] seedQueued: ${docs.length} ${mail_type} recipient(s) marked queued for ${date}`);
  } catch (e) {
    logger.error(`[emailAudit] seedQueued failed: ${e.message}`);
  }
}

/**
 * Upsert a send-log row (keyed by send_id so retries/resends don't duplicate).
 *
 * Side-effect — if the row records a `failed` outcome whose `failure_reason`
 * looks like a bounce ("address rejected", "user unknown", etc.), the
 * recipient is added to the bounce blacklist so future sends skip them
 * (manifest §15). Webhook-driven bounces are handled separately in
 * applyWebhookEvent below.
 *
 * @param {Object} doc  partial email_send_log fields ({ send_id, mail_type, to, status, ... })
 */
export async function logSend(doc) {
  if (!doc || !doc.send_id) return;
  try {
    const set = { ...doc };
    if (set.to) set.to = String(set.to).trim().toLowerCase();
    await EmailSendLog.updateOne(
      { send_id: doc.send_id },
      { $set: set },
      { upsert: true }
    );
    // Bounce blacklist feeder #2 — inline detection.
    if (set.to && set.status === "failed" && isBounceReason(set.failure_reason)) {
      await markBounced({
        email: set.to,
        reason: set.failure_reason,
        mail_type: set.mail_type || null,
        source: "failed_reason",
      });
    }
  } catch (e) {
    logger.error(`[emailAudit] logSend failed (${doc.send_id}): ${e.message}`);
  }
}

// SendGrid event → log status update. Terminal/important states (bounced, spam,
// unsubscribed, failed) win over delivered/opened; open never downgrades.
function statusUpdateForEvent(evt) {
  const type = String(evt.event || "").toLowerCase();
  const ts = evt.timestamp ? new Date(Number(evt.timestamp) * 1000) : new Date();
  switch (type) {
    case "delivered":
      return { onlyIfStatusIn: ["queued", "sent"], set: { status: "delivered", delivered_at: ts } };
    case "open":
    case "click":
      return { onlyIfStatusIn: ["queued", "sent", "delivered"], set: { status: "opened", opened_at: ts }, alwaysSet: { opened_at: ts } };
    case "bounce":
      return { set: { status: "bounced", bounce_type: (evt.type || "hard"), failure_reason: evt.reason || "bounced", bounced_at: ts } };
    case "dropped":
      return { set: { status: "failed", failure_reason: evt.reason || "dropped" } };
    case "spamreport":
      return { set: { status: "spam" } };
    case "unsubscribe":
    case "group_unsubscribe":
      return { set: { status: "unsubscribed" } };
    // processed / deferred → event only, no status change
    default:
      return null;
  }
}

/**
 * Handle one SendGrid webhook event: persist the raw event and advance the
 * parent log's status. Correlates by custom_args.send_id, else sg_message_id.
 */
export async function applyWebhookEvent(evt) {
  try {
    const sendId = evt.send_id || evt.custom_args?.send_id || null;
    const sgId = evt.sg_message_id || null;

    await EmailSendEvent.create({
      event_id: newSendId(),
      send_id: sendId,
      mail_type: evt.mail_type || evt.custom_args?.mail_type || null,
      email: evt.email ? String(evt.email).toLowerCase() : null,
      event_type: String(evt.event || "").toLowerCase(),
      event_ts: evt.timestamp ? new Date(Number(evt.timestamp) * 1000) : new Date(),
      reason: evt.reason || null,
      sg_message_id: sgId,
      raw: evt,
    });

    const upd = statusUpdateForEvent(evt);
    if (!upd) return;

    // Locate the log row: prefer send_id, else the sendgrid_message_id prefix.
    const filter = sendId
      ? { send_id: sendId }
      : (sgId ? { sendgrid_message_id: new RegExp("^" + sgId.split(".")[0]) } : null);
    if (!filter) return;

    if (upd.onlyIfStatusIn) {
      const r = await EmailSendLog.updateOne(
        { ...filter, status: { $in: upd.onlyIfStatusIn } },
        { $set: upd.set }
      );
      // If the status guard blocked the change but we still want a timestamp (open).
      if (r.modifiedCount === 0 && upd.alwaysSet) {
        await EmailSendLog.updateOne(filter, { $set: upd.alwaysSet });
      }
    } else {
      await EmailSendLog.updateOne(filter, { $set: upd.set });
    }

    // Click-specific bookkeeping. SendGrid fires a `click` event each time
    // the recipient clicks ANY tracked link in the mail; we increment
    // click_count, push the URL into clicked_urls (deduped via $addToSet),
    // set last_clicked_at, and use $min so clicked_at captures the FIRST
    // click only. Status upgrade ("opened") already happened above.
    const evtTypeForClick = String(evt.event || "").toLowerCase();
    if (evtTypeForClick === "click") {
      const ts = evt.timestamp ? new Date(Number(evt.timestamp) * 1000) : new Date();
      const url = String(evt.url || "").trim();
      const update = {
        $inc: { click_count: 1 },
        $set: { last_clicked_at: ts },
        $min: { clicked_at: ts }, // first click — $min on null sets the value
      };
      if (url) update.$addToSet = { clicked_urls: url };
      await EmailSendLog.updateOne(filter, update);
    }

    // Bounce blacklist feeder #1 — webhook-driven. Triggered by:
    //   - any `bounce` event (regardless of soft/hard — we don't retry).
    //   - a `dropped` event whose reason matches the bounce regex (covers
    //     the case where SendGrid maps a hard reject to "dropped" before
    //     even attempting delivery).
    const evtType = String(evt.event || "").toLowerCase();
    if (
      evtType === "bounce" ||
      (evtType === "dropped" && isBounceReason(evt.reason))
    ) {
      const recipient = evt.email || null;
      const mailType = evt.mail_type || evt.custom_args?.mail_type || null;
      await markBounced({
        email: recipient,
        reason: evt.reason || "bounced",
        mail_type: mailType,
        source: "webhook",
      });
    }
  } catch (e) {
    logger.error(`[emailAudit] applyWebhookEvent failed: ${e.message}`);
  }
}
