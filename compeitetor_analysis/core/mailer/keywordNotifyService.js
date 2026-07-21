import path from "path";
import fs from "fs";
import sgMail from "@sendgrid/mail";
import config from "config";
import mongoose from "mongoose";
import logger from "../../resources/logs/logger.log.js";
import { newSendId, logSend } from "./emailAudit.js";
import { isBlacklisted, BLACKLISTED_SKIP_REASON } from "./bounceGuard.js";
import { unsubscribeToken } from "./unsubscribeToken.js";

/**
 * Keyword / advertiser notification email (NEW, standalone — config-driven).
 *
 * Source of truth: the Mongo `keyword_ad_notifications` collection (populated by
 * the crawler when a term the user tracks picks up new ads). Each row already
 * carries everything we need — { email, username, type (1=keyword, 2=advertiser),
 * network, value, adsCount, updatedAt } — so NO Elasticsearch re-query is needed.
 *
 * Per run:
 *   1. group pending rows by user (recipient email), newest-activity first,
 *   2. take that user's top-N rows (updatedAt desc, then adsCount desc),
 *   3. render + send ONE digest email (same look as the data-report mail,
 *      per-message click/open tracking, bounce-blacklist guard, audit log),
 *   4. DELETE the rows that were mailed — so a 24h schedule sends each term
 *      once, a 15m schedule sends only NEW terms each time (delete = dedup).
 *
 * Everything here is additive and never imports from / mutates the existing
 * emailService or dataReportEmailService. Mail-type in the audit log:
 * "keywordNotification" — the admin panel picks it up automatically.
 */

const MAIL_TYPE = "keywordNotification";
const COLLECTION = "keyword_ad_notifications";

const VALID_NETWORKS = new Set([
  "facebook", "instagram", "youtube", "google", "gdn",
  "native", "linkedin", "reddit", "quora", "pinterest", "tiktok",
]);

// ── Assets (logo) — local copy of the data-report resolver so this module is
//    self-contained. Honours assets_mode ("url" | "inline"). ──────────────────
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
    logger.error(`[keywordNotify] fileToDataUri failed for ${filename}: ${e.message}`);
    return "";
  }
}
function assetUrl(filename) {
  return ASSETS_MODE === "url" ? `${ASSETS_BASE}/${filename}` : fileToDataUri(filename);
}
const BRAND_LOGO_URL = assetUrl("poweradspy-logo.webp");

const PLATFORM_LABELS = {
  facebook: "Facebook", instagram: "Instagram", google: "Google", youtube: "YouTube",
  gdn: "GDN", native: "Native", linkedin: "LinkedIn", quora: "Quora",
  reddit: "Reddit", pinterest: "Pinterest", tiktok: "TikTok",
};
const PLATFORM_ICONS = {
  facebook: assetUrl("fb.png"),
  instagram: assetUrl("ig.png"),
  google: assetUrl("g.png"),
  youtube: assetUrl("yt.png"),
  gdn: assetUrl("gdn.png"),
  native: assetUrl("native.png"),
  linkedin: assetUrl("linkedin.png"),
  quora: assetUrl("quora.png"),
  reddit: assetUrl("rd.png"),
  pinterest: assetUrl("pinterest.png"),
  tiktok: assetUrl("tiktoklogo.jpg"),
};
// Accent dot per network — a coloured fallback so the row is still identifiable
// if the icon image is blocked by the mail client.
const PLATFORM_COLOR = {
  facebook: "#1568d4", instagram: "#7b3ff2", google: "#15c39a", youtube: "#ff0000",
  gdn: "#ea4335", native: "#ff6f3c", linkedin: "#0a66c2", quora: "#b92b27",
  reddit: "#ff4500", pinterest: "#e60023", tiktok: "#111111",
};

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function compactNumber(n) {
  const num = Number(n) || 0;
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(num >= 10_000_000 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (num >= 1_000)     return (num / 1_000).toFixed(num >= 10_000 ? 0 : 1).replace(/\.0$/, "") + "k";
  return String(num);
}
function fullNumber(n) {
  return (Number(n) || 0).toLocaleString("en-US");
}
function dayLabel(d) {
  const dt = d ? new Date(d) : new Date();
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function todayLabel() {
  return new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function generatedAtIST() {
  const d = new Date();
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }) + " IST";
}

function topN() {
  let n = 20;
  try { const v = Number(config.get("keyword_notify_top_n")); if (Number.isFinite(v) && v > 0) n = Math.floor(v); } catch { /* default */ }
  return n;
}

// Only notify terms with MORE THAN this many new ads. Config-driven; default 10.
function minAds() {
  let n = 10;
  try { const v = Number(config.get("keyword_notify_min_ads")); if (Number.isFinite(v) && v >= 0) n = Math.floor(v); } catch { /* default */ }
  return n;
}

// "Facebook" · "Facebook and Instagram" · "Facebook, Instagram, and Pinterest"
function humanJoin(arr) {
  const a = arr.filter(Boolean);
  if (a.length <= 1) return a[0] || "";
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(", ")}, and ${a[a.length - 1]}`;
}

// First name for the greeting: username → else the email's local part.
function firstNameFrom(name, email) {
  const base = String(name || "").trim() || String(email || "").split("@")[0] || "there";
  const tok = base.split(/[\s._-]+/)[0] || base;
  return tok.charAt(0).toUpperCase() + tok.slice(1);
}

function collection() {
  return mongoose.connection.db.collection(COLLECTION);
}

/**
 * Deep link for one row.
 *   type 2 (advertiser) → ?advertiser=<value>&platform=<network>
 *   type 1 (keyword)    → ?keyword=<value>
 * Returns "" when app_url isn't configured (row still renders, just not linked).
 */
function rowLink(row, appUrl) {
  if (!appUrl) return "";
  const value = encodeURIComponent(String(row.value || row.valueNorm || "").trim());
  if (!value) return "";
  if (Number(row.type) === 2) {
    const net = String(row.network || "").toLowerCase();
    const p = VALID_NETWORKS.has(net) ? `&platform=${encodeURIComponent(net)}` : "";
    return `${appUrl}?advertiser=${value}${p}`;
  }
  return `${appUrl}?keyword=${value}`;
}

// Network icon (with a coloured-dot fallback) so the client can render even if
// images are blocked. `px` is the square size.
function networkIconImg(net, px) {
  const src = PLATFORM_ICONS[net];
  if (src) {
    return `<img src="${src}" alt="${PLATFORM_LABELS[net] || net}" width="${px}" height="${px}" style="display:block;width:${px}px;height:${px}px;border:0;outline:none;border-radius:6px;" />`;
  }
  const c = PLATFORM_COLOR[net] || "#2e4374";
  return `<span style="display:inline-block;width:${px - 6}px;height:${px - 6}px;border-radius:50%;background:${c};"></span>`;
}

// One term row: [network icon] term + "Keyword/Advertiser · Network" | new-ads
// count | a "View →" button. Everything links to that term's dashboard, and
// the network is ALWAYS shown as text (not just an icon) so it's identifiable
// even when the mail client blocks images.
function buildTermRow(row, { isLast, appUrl }) {
  const isAdv = Number(row.type) === 2;
  const typeLabel = isAdv ? "Advertiser" : "Keyword";
  const typeColor = isAdv ? "#e07b1a" : "#2e5cff";
  const net = String(row.network || "").toLowerCase();
  const hasNet = VALID_NETWORKS.has(net);
  const netLabel = hasNet ? (PLATFORM_LABELS[net] || net) : "";
  const sub = netLabel ? `${typeLabel} · ${netLabel}` : typeLabel;
  const term = escapeHtml(row.value || row.valueNorm || "—");
  const border = isLast ? "" : "border-bottom:1px solid #eef0f6;";
  const link = rowLink(row, appUrl);
  const icon = networkIconImg(hasNet ? net : "", 26);
  const btn = link
    ? `<a href="${link}" target="_blank" style="display:inline-block;background:#eef2ff;color:#2e5cff;font-size:12px;font-weight:700;padding:7px 14px;border-radius:999px;text-decoration:none;white-space:nowrap;">View&nbsp;&rarr;</a>`
    : "";
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${border}">
      <tr>
        <td width="34" valign="middle" style="padding:12px 8px 12px 0;">${icon}</td>
        <td valign="middle" style="padding:12px 6px;">
          <div class="kn-term" style="font-size:14px;font-weight:700;color:#1a2240;line-height:17px;">${term}</div>
          <div style="font-size:11px;margin-top:2px;">
            <span style="color:${typeColor};font-weight:700;">${escapeHtml(sub)}</span>
            <span style="color:#9aa1b4;">&nbsp;·&nbsp;${compactNumber(row.adsCount)} new ads</span>
          </div>
        </td>
        <td valign="middle" align="right" width="86" style="padding:12px 0;">${btn}</td>
      </tr>
    </table>`;
}

function renderTemplate(email, name, rows) {
  const filePath = path.resolve("mail-template", "keywordNotification.html");
  let html = fs.readFileSync(filePath, "utf-8");

  let appUrl = "";
  try { appUrl = config.get("app_url"); } catch { appUrl = ""; }
  const manageUrl = appUrl || "#";
  const ctaUrl = appUrl || "#";
  const unsubscribeLink = appUrl
    ? `${appUrl}facebook/unsubscribe-page?email=${encodeURIComponent(email || "")}&sig=${unsubscribeToken(email)}&page=keywordNotification`
    : "#";

  // Distinct keyword / advertiser values + the networks we scanned for them.
  const keywordVals = new Set();
  const advertiserVals = new Set();
  const networks = [];
  let newAdsTotal = 0;
  for (const r of rows) {
    newAdsTotal += Number(r.adsCount) || 0;
    const v = String(r.value || r.valueNorm || "").toLowerCase();
    if (Number(r.type) === 2) advertiserVals.add(v); else keywordVals.add(v);
    const net = String(r.network || "").toLowerCase();
    if (VALID_NETWORKS.has(net) && !networks.includes(net)) networks.push(net);
  }
  const scannedNetworks = humanJoin(networks.map((n) => PLATFORM_LABELS[n] || n)) || "your networks";

  const rowsHtml = rows
    .map((r, i) => buildTermRow(r, { isLast: i === rows.length - 1, appUrl }))
    .join("");

  const replacements = {
    logoUrl: BRAND_LOGO_URL,
    dateLabel: escapeHtml(todayLabel()),
    firstName: escapeHtml(firstNameFrom(name, email)),
    scannedNetworks: escapeHtml(scannedNetworks),
    newAdsCount: fullNumber(newAdsTotal),
    keywordCount: String(keywordVals.size),
    advertiserCount: String(advertiserVals.size),
    termRowsHtml: rowsHtml,
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

/**
 * Group pending rows by recipient, newest-activity first. Honours the
 * TEST_EMAIL_ONLY config gate (same as the competitor mailer) so a staging box
 * never blasts real users. Returns [{ email, latest, count }].
 */
async function resolveUsers() {
  let testEmailOnly = "";
  try { testEmailOnly = String(config.get("TEST_EMAIL_ONLY") || "").trim().toLowerCase(); } catch { /* not set */ }

  const match = { email: { $exists: true, $nin: [null, ""] }, adsCount: { $gt: minAds() } };
  if (testEmailOnly) match.email = testEmailOnly;

  const groups = await collection().aggregate([
    { $match: match },
    { $group: { _id: "$email", latest: { $max: "$updatedAt" }, count: { $sum: 1 } } },
    { $sort: { latest: -1 } },
  ]).toArray();

  return groups
    .map((g) => ({ email: String(g._id || "").trim(), latest: g.latest, count: g.count }))
    .filter((g) => g.email.includes("@"));
}

/** Fetch a user's top-N rows over the min-ads threshold (updatedAt desc, then adsCount desc). */
async function topRowsForUser(email, limit) {
  return collection()
    .find({ email, adsCount: { $gt: minAds() } })
    .sort({ updatedAt: -1, adsCount: -1 })
    .limit(limit)
    .toArray();
}

/**
 * Same as topRowsForUser but matches the email CASE-INSENSITIVELY — used by the
 * preview + admin manual send, where the operator types the address and the
 * stored casing may differ (e.g. "Palladium45@…"). The cron path uses the exact
 * stored casing from resolveUsers, so it stays on the faster exact match above.
 */
async function topRowsForEmailCI(email, limit) {
  const escaped = String(email || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return collection()
    .find({ email: { $regex: `^${escaped}$`, $options: "i" }, adsCount: { $gt: minAds() } })
    .sort({ updatedAt: -1, adsCount: -1 })
    .limit(limit)
    .toArray();
}

/**
 * Send one digest to one user. Returns { status: "sent"|"skipped"|"failed" }.
 *
 * @param {string} email
 * @param {Array}  rows
 * @param {{ deleteRows?: boolean, source?: string }} [opts]
 *   deleteRows — clear the mailed rows afterwards. TRUE for the scheduled cron
 *     (a sent term is never re-notified); FALSE for the admin manual/test send
 *     so the same terms can be re-tested. Blacklisted rows are cleared only when
 *     deleteRows is true, and never on a transient failure (so the cron retries).
 *   source     — stamped into the audit log meta ("cron" | "manual_send").
 */
async function sendToUser(email, rows, opts = {}) {
  const { deleteRows = true, source = "cron" } = opts;
  const to = String(email).trim().toLowerCase();
  const ids = rows.map((r) => r._id);
  const name = rows.find((r) => r.username)?.username || "";
  const send_id = newSendId();
  const base = {
    send_id,
    mail_type: MAIL_TYPE,
    to,
    subject: null,
    meta: { terms: rows.length, top: ids.length, source },
  };

  // Bounce blacklist — same guard the other mails use.
  if (await isBlacklisted(to)) {
    await logSend({ ...base, status: "skipped", failure_reason: BLACKLISTED_SKIP_REASON });
    if (deleteRows) await collection().deleteMany({ _id: { $in: ids } });
    logger.info(`[keywordNotify] skipped (blacklisted) ${to}${deleteRows ? ` — ${ids.length} row(s) cleared` : " — rows kept (manual)"}`);
    return { status: "skipped" };
  }

  const subject = `New ad activity on ${rows.length} of your tracked term${rows.length === 1 ? "" : "s"}`;
  const html = renderTemplate(to, name, rows);
  base.meta.previewHtml = html; // exact mail this user got (admin detail preview)
  const mailOptions = {
    to,
    from: { email: config.get("SENDGRID_FROM"), name: "PoweradSpy" },
    subject,
    html,
    customArgs: { send_id, mail_type: MAIL_TYPE },
    // Per-message tracking so SendGrid rewrites links + fires click/open events
    // (so the admin panel shows clicks — same as the other report mails).
    trackingSettings: {
      clickTracking: { enable: true, enableText: false },
      openTracking: { enable: true },
    },
  };

  try {
    const resp = await sgMail.send(mailOptions);
    const r0 = Array.isArray(resp) ? resp[0] : resp;
    const statusCode = r0?.statusCode || r0?.status || "?";
    const msgId = r0?.headers?.["x-message-id"] || r0?.headers?.["X-Message-Id"] || null;
    await logSend({ ...base, subject, status: "sent", sendgrid_message_id: msgId, sent_at: new Date() });
    // Delete the mailed rows ONLY for the scheduled run — a sent term is never
    // re-notified. Manual/test sends keep the rows so they can be re-tested.
    if (deleteRows) await collection().deleteMany({ _id: { $in: ids } });
    logger.info(`[keywordNotify] sent to ${to} (${ids.length} term(s), status=${statusCode}, source=${source})${deleteRows ? " — rows cleared" : " — rows kept (manual)"}`);
    return { status: "sent" };
  } catch (e) {
    // Keep the rows — next run retries. Record why it failed.
    await logSend({ ...base, subject, status: "failed", failure_reason: e?.message || "send error" });
    logger.error(`[keywordNotify] send failed ${to}: ${e?.message} — rows kept`);
    return { status: "failed" };
  }
}

/**
 * Run one notification pass over every pending user. Returns a summary.
 * @param {{ limitUsers?: number }} [opts]
 */
export async function runKeywordNotify(opts = {}) {
  sgMail.setApiKey(config.get("SENDGRID_API_KEY"));
  const N = topN();
  const users = await resolveUsers();
  const total = typeof opts.limitUsers === "number" ? users.slice(0, opts.limitUsers) : users;
  logger.info(`[keywordNotify] ===== START — ${total.length} user(s) with pending terms (topN=${N}) =====`);

  let sent = 0, skipped = 0, failed = 0, mailedTerms = 0;
  for (const u of total) {
    const rows = await topRowsForUser(u.email, N);
    if (!rows.length) continue;
    const r = await sendToUser(u.email, rows);
    if (r.status === "sent") { sent++; mailedTerms += rows.length; }
    else if (r.status === "skipped") skipped++;
    else failed++;
  }

  const summary = { users: total.length, sent, skipped, failed, mailedTerms };
  logger.info(`[keywordNotify] ===== DONE — ${JSON.stringify(summary)} =====`);
  return summary;
}

/**
 * Admin manual/test send to ONE email. The email MUST already have pending rows
 * in keyword_ad_notifications (that's the "notification must exist" rule) — if
 * it has none we return `no_terms` and send nothing. Rows are NOT deleted (this
 * is a testing path), so the same terms can be re-sent. Matches the email
 * case-insensitively against however it's stored in the collection.
 *
 * Returns { ok, code, sentTo, terms } — shaped for manualSendController.
 */
export async function sendKeywordNotifyForEmail(rawEmail) {
  const input = String(rawEmail || "").trim();
  if (!input.includes("@")) return { ok: false, code: "empty_email", error: "valid email is required" };

  const rows = await topRowsForEmailCI(input, topN());

  if (!rows.length) {
    return { ok: false, code: "no_terms", error: `no keyword notifications (> ${minAds()} ads) in DB for this email` };
  }

  sgMail.setApiKey(config.get("SENDGRID_API_KEY"));
  // Use the email exactly as stored (canonical casing) for the send.
  const to = rows.find((r) => r.email)?.email || input;
  const r = await sendToUser(to, rows, { deleteRows: false, source: "manual_send" });
  return {
    ok: r.status === "sent",
    code: r.status,
    sentTo: to,
    terms: rows.length,
    ...(r.status !== "sent" ? { error: r.status === "skipped" ? BLACKLISTED_SKIP_REASON : "send error" } : {}),
  };
}

/**
 * Preview one user's next digest WITHOUT sending or deleting anything.
 * @param {string} email
 */
export async function previewForUser(email) {
  const input = String(email || "").trim();
  if (!input.includes("@")) throw new Error("Valid 'email' required");
  const rows = await topRowsForEmailCI(input, topN());
  const name = rows.find((r) => r.username)?.username || "";
  const to = rows.find((r) => r.email)?.email || input; // canonical stored casing
  return {
    email: to,
    terms: rows.length,
    rows: rows.map((r) => ({
      value: r.value || r.valueNorm,
      type: Number(r.type) === 2 ? "advertiser" : "keyword",
      network: r.network || null,
      adsCount: r.adsCount || 0,
      updatedAt: r.updatedAt || r.date || null,
    })),
    html: rows.length ? renderTemplate(to, name, rows) : null,
  };
}

export default { runKeywordNotify, previewForUser, sendKeywordNotifyForEmail };
