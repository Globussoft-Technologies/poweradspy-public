import path from "path";
import fs from "fs";
import sgMail from "@sendgrid/mail";
import config from "config";
import logger from "../../resources/logs/logger.log.js";
import { newSendId, logSend } from "./emailAudit.js";
import { isBlacklisted, BLACKLISTED_SKIP_REASON } from "./bounceGuard.js";
import { unsubscribeToken } from "./unsubscribeToken.js";
import Competitors_request from "../../models/competitors_request.js";
import User_details from "../../models/user_details.js";

/**
 * Competitor alert digest mail (NEW, standalone — same shape as
 * keywordNotifyService.js: this module owns its own SendGrid send rather than
 * going through emailService.js's class, since it's a fully separate flow
 * with its own recipient-resolution and template).
 *
 * Input is `triggeredEvents` — the array returned by
 * alertEvaluationService.evaluateAlerts(), i.e. [{ rule, event }] — grouped
 * here by project (request_id) so a user with 3 rules firing on the same day
 * gets ONE digest, not three emails.
 */

const MAIL_TYPE = "alertDigest";

const ASSETS_BASE = (() => {
  try { return config.get("assets_base_url"); } catch { return "http://localhost:3000/public"; }
})().replace(/\/+$/, "");
const ASSETS_MODE = (() => {
  try { return config.get("assets_mode"); } catch { return "inline"; }
})();
const PUBLIC_DIR = path.resolve("public");
const MIME = { ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" };
function fileToDataUri(filename) {
  try {
    const buf = fs.readFileSync(path.join(PUBLIC_DIR, filename));
    const ext = path.extname(filename).toLowerCase();
    return `data:${MIME[ext] || "application/octet-stream"};base64,${buf.toString("base64")}`;
  } catch (e) {
    logger.error(`[alertNotify] fileToDataUri failed for ${filename}: ${e.message}`);
    return "";
  }
}
function assetUrl(filename) {
  return ASSETS_MODE === "url" ? `${ASSETS_BASE}/${filename}` : fileToDataUri(filename);
}
const BRAND_LOGO_URL = assetUrl("poweradspy-logo.webp");

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function todayLabel() {
  return new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function firstNameFrom(name, email) {
  const base = String(name || "").trim() || String(email || "").split("@")[0] || "there";
  const tok = base.split(/[\s._-]+/)[0] || base;
  return tok.charAt(0).toUpperCase() + tok.slice(1);
}

const SEVERITY_COLOR = { info: "#2e5cff", warning: "#e07b1a", critical: "#e0392a" };

function buildAlertRow(event, isLast) {
  const color = SEVERITY_COLOR[event.severity] || SEVERITY_COLOR.info;
  const border = isLast ? "" : "border-bottom:1px solid #eef0f6;";
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${border}">
      <tr>
        <td width="6" valign="top" style="padding:12px 10px 12px 0;"><span style="display:inline-block;width:6px;height:6px;margin-top:6px;border-radius:50%;background:${color};"></span></td>
        <td valign="middle" style="padding:12px 0;">
          <div style="font-size:14px;font-weight:600;color:#1a2240;line-height:20px;">${escapeHtml(event.message)}</div>
        </td>
      </tr>
    </table>`;
}

function renderTemplate({ email, name, brandName, events }) {
  const filePath = path.resolve("mail-template", "alertDigest.html");
  let html = fs.readFileSync(filePath, "utf-8");

  let appUrl = "";
  try { appUrl = config.get("app_url"); } catch { appUrl = ""; }
  const manageUrl = appUrl || "#";
  const ctaUrl = appUrl || "#";
  const unsubscribeLink = appUrl
    ? `${appUrl}facebook/unsubscribe-page?email=${encodeURIComponent(email || "")}&sig=${unsubscribeToken(email)}&page=alertDigest`
    : "#";

  const replacements = {
    logoUrl: BRAND_LOGO_URL,
    dateLabel: escapeHtml(todayLabel()),
    firstName: escapeHtml(firstNameFrom(name, email)),
    brandName: escapeHtml(brandName || "your brand"),
    alertCount: String(events.length),
    alertRowsHtml: events.map((e, i) => buildAlertRow(e, i === events.length - 1)).join(""),
    ctaUrl,
    manageUrl,
    unsubscribe_link: unsubscribeLink,
  };
  for (const [key, value] of Object.entries(replacements)) {
    const re = new RegExp(`{{\\s*${key}\\s*}}`, "g");
    html = html.replace(re, value);
  }
  return html;
}

async function sendDigest({ to, name, brandName, events }) {
  const send_id = newSendId();
  const base = { send_id, mail_type: MAIL_TYPE, to, subject: null, meta: { alerts: events.length } };

  if (await isBlacklisted(to)) {
    await logSend({ ...base, status: "skipped", failure_reason: BLACKLISTED_SKIP_REASON });
    logger.info(`[alertNotify] skipped (blacklisted) ${to}`);
    return { status: "skipped" };
  }

  const subject = `${events.length} competitor alert${events.length === 1 ? "" : "s"} on ${brandName || "your brand"}`;
  const html = renderTemplate({ email: to, name, brandName, events });
  const mailOptions = {
    to,
    from: { email: config.get("SENDGRID_FROM"), name: "PoweradSpy" },
    subject,
    html,
    customArgs: { send_id, mail_type: MAIL_TYPE },
    trackingSettings: {
      clickTracking: { enable: true, enableText: false },
      openTracking: { enable: true },
    },
  };

  try {
    const resp = await sgMail.send(mailOptions);
    const r0 = Array.isArray(resp) ? resp[0] : resp;
    const msgId = r0?.headers?.["x-message-id"] || r0?.headers?.["X-Message-Id"] || null;
    await logSend({ ...base, subject, status: "sent", sendgrid_message_id: msgId, sent_at: new Date() });
    logger.info(`[alertNotify] sent to ${to} (${events.length} alert(s))`);
    return { status: "sent" };
  } catch (e) {
    await logSend({ ...base, subject, status: "failed", failure_reason: e?.message || "send error" });
    logger.error(`[alertNotify] send failed ${to}: ${e?.message}`);
    return { status: "failed" };
  }
}

/**
 * Group triggeredEvents by project and mail one digest per project owner.
 * Rules without `channels.email` opted in are skipped entirely (in-app-only
 * rules still wrote their activity_events row in evaluateAlerts — this only
 * gates the email leg).
 */
export async function notifyAlerts(triggeredEvents) {
  if (!triggeredEvents?.length) return { sent: 0, skipped: 0, failed: 0 };

  const emailable = triggeredEvents.filter((t) => t.rule?.channels?.email !== false);
  const byRequest = new Map(); // request_id -> events[]
  emailable.forEach(({ event }) => {
    const key = String(event.request_id);
    if (!byRequest.has(key)) byRequest.set(key, []);
    byRequest.get(key).push(event);
  });

  sgMail.setApiKey(config.get("SENDGRID_API_KEY"));
  let sent = 0, skipped = 0, failed = 0;

  for (const [requestId, events] of byRequest.entries()) {
    try {
      const project = await Competitors_request.findById(requestId, { user_id: 1, advertiser: 1 }).lean();
      if (!project?.user_id) continue;
      const user = await User_details.findById(project.user_id, { email: 1, name: 1, username: 1 }).lean();
      if (!user?.email) continue;

      const r = await sendDigest({
        to: user.email,
        name: user.name || user.username,
        brandName: project.advertiser?.[0],
        events,
      });
      if (r.status === "sent") sent++;
      else if (r.status === "skipped") skipped++;
      else failed++;
    } catch (e) {
      failed++;
      logger.error(`[alertNotify] project ${requestId} failed: ${e.message}`);
    }
  }

  logger.info(`[alertNotify] digests — sent=${sent} skipped=${skipped} failed=${failed} (projects=${byRequest.size})`);
  return { sent, skipped, failed };
}
  