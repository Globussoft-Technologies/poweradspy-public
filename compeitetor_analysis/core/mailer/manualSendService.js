// Manual-send helpers (admin-triggered, one email at a time).
//
// Two paths, mirroring §8 of MEMBER_CC_MANIFEST.md:
//
//   sendCompetitorMailForEmail(email)
//     Validates the email against `user_details`, snapshots that user's
//     competitor + request statuses IN MEMORY, force-actives them, runs the
//     standard activeCompetitorContacts pipeline targeted to just this user
//     (via req.body.target_email), then ALWAYS restores the snapshot in a
//     finally so the user's row ends in the same state it started in.
//
//   sendDataReportForEmail(email)
//     Stateless. No DB lookup, no validation. Generates today's data report
//     and sends it through the existing dataReportEmailService.
//
// Both are called from manualSendController.js. The original send paths
// (cron, /active-competitor-contacts, /data-report/send) are untouched.

import logger from "../../resources/logs/logger.log.js";
import User_details from "../../models/user_details.js";
import Competitors_request from "../../models/competitors_request.js";
import Competitors from "../../models/competitors.js";
import monitorService from "../Competitors/monitorService.js";
import dataReportEmailService from "./dataReportEmailService.js";
import { isBlacklisted, BLACKLISTED_SKIP_REASON } from "./bounceGuard.js";
import { newSendId, logSend } from "./emailAudit.js";

// Look up a user_details doc by email — exact first, then case-insensitive
// fallback. Mirrors the lookup in scripts/force-active-for-user.js so we
// never mismatch over a stored "Aishwaryam@..." vs lowercased input.
async function findUserByEmail(rawEmail) {
  const email = String(rawEmail || "").trim();
  if (!email) return null;
  let user = await User_details.findOne({ email });
  if (!user) {
    const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    user = await User_details.findOne({ email: { $regex: `^${escaped}$`, $options: "i" } });
  }
  return user;
}

// Snapshot the *minimum* state we're about to flip, in memory. Restore reads
// straight back from this object — no persistent backup collection needed
// because the whole cycle lives inside a single request.
async function snapshotState(competitorIds, requestIds) {
  const [comps, reqs] = await Promise.all([
    competitorIds.length
      ? Competitors.find(
          { _id: { $in: competitorIds } },
          { facebook_status: 1, instagram_status: 1, google_status: 1, youtube_status: 1 }
        ).lean()
      : Promise.resolve([]),
    /* v8 ignore next -- requestIds is always non-empty here (callers guard on requests.length > 0); the empty branch is defensive */
    requestIds.length
      ? Competitors_request.find(
          { _id: { $in: requestIds } },
          { email_status: 1 }
        ).lean()
      : Promise.resolve([]),
  ]);
  return { comps, reqs };
}

async function restoreState(snapshot) {
  if (!snapshot) return;
  const { comps, reqs } = snapshot;
  if (comps?.length) {
    await Competitors.bulkWrite(
      comps.map((d) => ({
        updateOne: {
          filter: { _id: d._id },
          update: { $set: {
            facebook_status:  d.facebook_status  ?? 0,
            instagram_status: d.instagram_status ?? 0,
            google_status:    d.google_status    ?? 0,
            youtube_status:   d.youtube_status   ?? 0,
          } },
        },
      })),
      { ordered: false }
    );
  }
  if (reqs?.length) {
    await Competitors_request.bulkWrite(
      reqs.map((d) => ({
        updateOne: {
          filter: { _id: d._id },
          update: { $set: { email_status: d.email_status ?? 0 } },
        },
      })),
      { ordered: false }
    );
  }
}

// Force this user's competitors → all-platforms-active and their requests'
// email_status → 0, so the standard pipeline treats them as ready-to-send.
async function forceActive(competitorIds, requestIds) {
  if (competitorIds.length) {
    await Competitors.updateMany(
      { _id: { $in: competitorIds } },
      { $set: { facebook_status: 2, instagram_status: 2, google_status: 2 } }
    );
  }
  /* v8 ignore next -- requestIds is always non-empty here (callers guard on requests.length > 0); the empty branch is defensive */
  if (requestIds.length) {
    await Competitors_request.updateMany(
      { _id: { $in: requestIds } },
      { $set: { email_status: 0 } }
    );
  }
}

// Drive monitorService.activeCompetitorContacts through a fake req/res so we
// can call it in-process and capture whatever it sends back (status + body).
async function invokeTargeted(email) {
  let captured = { statusCode: 200, body: null };
  const fakeRes = {
    send: (payload) => { captured = payload && typeof payload === "object" ? payload : { body: payload, statusCode: 200 }; return fakeRes; },
    status: (c) => { captured.statusCode = c; return fakeRes; },
    json: (p) => { captured.body = p; return fakeRes; },
  };
  const fakeReq = { body: { target_email: email } };
  await monitorService.activeCompetitorContacts(fakeReq, fakeRes);
  return captured;
}

/**
 * §8.1 — Send the competitor mail to one user.
 *
 * Returns:
 *   { ok: true,  send_id?, status?, sentTo, response } on success
 *   { ok: false, code: "user_not_found",   error }    on validation failure
 *   { ok: false, code: "send_failed",      error }    on pipeline error
 *
 * Throws ONLY on a bug-level exception (e.g. mongo connection lost during
 * restore). The controller catches and 500s in that case.
 */
export async function sendCompetitorMailForEmail(rawEmail) {
  const user = await findUserByEmail(rawEmail);
  if (!user) {
    return { ok: false, code: "user_not_found", error: "user not found in db" };
  }
  const targetEmail = user.email; // use the stored canonical casing
  // Bounce blacklist (manifest §15) — refuse manual sends to a previously
  // bounced address. Log a skipped row so the admin panel surfaces it.
  if (await isBlacklisted(targetEmail)) {
    try {
      await logSend({
        send_id: newSendId(),
        mail_type: "competitorUpdate",
        to: targetEmail,
        user_name: user.userName || null,
        subject: null,
        status: "skipped",
        failure_reason: BLACKLISTED_SKIP_REASON,
        meta: { source: "manual_send" },
      });
    } catch { /* logSend handles its own errors */ }
    return {
      ok: false,
      code: "blacklisted",
      error: BLACKLISTED_SKIP_REASON,
      sentTo: targetEmail,
    };
  }
  // Collect the user's requests + competitor ids.
  const requests = await Competitors_request.find(
    { user_id: user._id },
    { monitoring: 1, email_status: 1 }
  ).lean();
  if (!requests.length) {
    return { ok: false, code: "no_requests", error: "user has no competitor requests" };
  }
  const requestIds = requests.map((r) => r._id);
  // String IDs are fine — Mongoose casts them to ObjectId on query/update.
  const competitorIds = [...new Set(requests.flatMap((r) => (r.monitoring || []).map(String)))];

  let snapshot = null;
  try {
    snapshot = await snapshotState(competitorIds, requestIds);
    await forceActive(competitorIds, requestIds);
    const captured = await invokeTargeted(targetEmail);
    // monitorService.activeCompetitorContacts returns:
    //   { statusCode: 200, body: { status, message, data: [ { email, name, brands, mailStatus, ... } ] } }
    // or a validationFailResp when there's no work.
    const body = captured?.body || {};
    const data = Array.isArray(body?.data) ? body.data : [];
    const mine = data.find((d) => String(d?.email || "").toLowerCase() === targetEmail.toLowerCase());
    const mailStatus = mine?.mailStatus || (data.length === 0 ? "no_work" : "unknown");
    return {
      ok: mailStatus === "sent",
      code: mailStatus,
      sentTo: targetEmail,
      response: { statusCode: captured?.statusCode, body },
    };
  } catch (e) {
    logger.error(`sendCompetitorMailForEmail(${targetEmail}) failed: ${e.message}`);
    return { ok: false, code: "send_failed", error: e.message, sentTo: targetEmail };
  } finally {
    // ALWAYS restore — even if the send blew up. Best-effort: log but don't
    // throw out of finally, so the caller sees the original error.
    try { await restoreState(snapshot); }
    catch (restoreErr) { logger.error(`restoreState failed for ${targetEmail}: ${restoreErr.message}`); }
  }
}

/**
 * §8.2 — Send the data report to one email. Stateless: no DB lookup, no
 * validation, no revert cycle. Any email is accepted; bounces will surface
 * in email_send_log normally.
 */
export async function sendDataReportForEmail(rawEmail, opts = {}) {
  const email = String(rawEmail || "").trim();
  if (!email) {
    return { ok: false, code: "empty_email", error: "email is required" };
  }
  // Bounce blacklist (manifest §15) — same hard rule as the competitor
  // path. Log a skipped row instead of sending.
  if (await isBlacklisted(email)) {
    try {
      await logSend({
        send_id: newSendId(),
        mail_type: "dataReport",
        to: email,
        user_name: opts.name || null,
        subject: null,
        status: "skipped",
        failure_reason: BLACKLISTED_SKIP_REASON,
        meta: { source: "manual_send" },
      });
    } catch { /* logSend handles its own errors */ }
    return {
      ok: false,
      code: "blacklisted",
      error: BLACKLISTED_SKIP_REASON,
      sentTo: email,
    };
  }
  try {
    const result = await dataReportEmailService.sendDataReport({
      to: email,
      name: opts.name || "there",
      hours: Number(opts.hours) || 24,
    });
    return {
      ok: true,
      code: "sent",
      sentTo: email,
      statusCode: result.statusCode,
      msgId: result.msgId,
    };
  } catch (e) {
    logger.error(`sendDataReportForEmail(${email}) failed: ${e.message}`);
    return { ok: false, code: "send_failed", error: e.message, sentTo: email };
  }
}
