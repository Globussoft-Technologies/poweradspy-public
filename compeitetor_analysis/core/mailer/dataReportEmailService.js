import path from "path";
import fs from "fs";
import sgMail from "@sendgrid/mail";
import config from "config";
import logger from "../../resources/logs/logger.log.js";
import { getDataReportStats } from "./dataReportStatsService.js";
import { newSendId, logSend } from "./emailAudit.js";
import { isBlacklisted, BLACKLISTED_SKIP_REASON } from "./bounceGuard.js";
import { unsubscribeToken } from "./unsubscribeToken.js";

/**
 * Data-report email (NEW, standalone).
 *
 * Renders mail-template/dataReport.html with pure ES counts (last-24h + all
 * time, per platform + grand total) and sends it. Helpers are local copies
 * so this module never imports from / mutates the existing emailService.
 */

const ASSETS_BASE = (() => {
  try { return config.get("assets_base_url"); }
  catch { return "http://localhost:3000/public"; }
})().replace(/\/+$/, "");

const ASSETS_MODE = (() => {
  try { return config.get("assets_mode"); }
  catch { return "inline"; }
})();

const PUBLIC_DIR = path.resolve("public");
const MIME = { ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" };

function fileToDataUri(filename) {
  try {
    const buf = fs.readFileSync(path.join(PUBLIC_DIR, filename));
    const ext = path.extname(filename).toLowerCase();
    return `data:${MIME[ext] || "application/octet-stream"};base64,${buf.toString("base64")}`;
  } catch (e) {
    logger.error(`fileToDataUri failed for ${filename}: ${e.message}`);
    return "";
  }
}

function assetUrl(filename) {
  return ASSETS_MODE === "url" ? `${ASSETS_BASE}/${filename}` : fileToDataUri(filename);
}

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
const PLATFORM_LABELS = {
  facebook: "Facebook", instagram: "Instagram", google: "Google", youtube: "YouTube",
  gdn: "GDN", native: "Native", linkedin: "LinkedIn", quora: "Quora",
  reddit: "Reddit", pinterest: "Pinterest", tiktok: "TikTok",
};
// Top-strip accent colour per network (also used as the icon fallback dot).
const PLATFORM_STRIP = {
  facebook: "#1568d4", instagram: "#7b3ff2", google: "#15c39a", youtube: "#ff0000",
  gdn: "#ea4335", native: "#ff6f3c", linkedin: "#0a66c2", quora: "#b92b27",
  reddit: "#ff4500", pinterest: "#e60023", tiktok: "#111111",
};
const BRAND_LOGO_URL = assetUrl("poweradspy-logo.webp");

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

function todayLabel() {
  return new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// "Generated" stamp shown at the top of the dataReport mail — IST so it
// matches when the report actually ran, not the host clock.
function generatedAtIST() {
  const d = new Date();
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }) + " IST";
}

function platformIconImg(platform, px) {
  const src = PLATFORM_ICONS[platform];
  if (src) {
    return `<img src="${src}" alt="${PLATFORM_LABELS[platform] || ""}" width="${px}" height="${px}" style="display:block;width:${px}px;height:${px}px;border:0;outline:none;border-radius:6px;" />`;
  }
  // No icon asset — coloured dot in the network's accent colour.
  const c = PLATFORM_STRIP[platform] || "#2e4374";
  return `<span style="display:inline-block;width:${px - 6}px;height:${px - 6}px;border-radius:50%;background:${c};"></span>`;
}

// Horizontal progress bar (track + fill), built with a table so it renders
// in every email client (Outlook included). `pct` is 0..100.
function buildBar(pct, color) {
  const w = Math.max(2, Math.min(100, Math.round(pct)));
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef0f6" style="background:#eef0f6;border-radius:8px;">
      <tr>
        <td width="${w}%" bgcolor="${color}" style="background:${color};height:9px;line-height:9px;font-size:0;border-radius:8px;">&nbsp;</td>
        <td style="font-size:0;line-height:9px;">&nbsp;</td>
      </tr>
    </table>`;
}

// One platform row: icon | name + % of today | bar | today count + all-time.
// The icon, label, and count are all clickable — they link to the platform's
// dedicated search page (e.g. clicking Instagram opens the Instagram tab in
// the app). `appUrl` is the configured `app_url` with trailing "/" — when
// missing we render the cells without anchors (still readable).
function buildPlatformRow(p, { grandLast24h, maxLast24h, isLast, appUrl }) {
  const label = p.label || PLATFORM_LABELS[p.key] || p.key;
  const color = PLATFORM_STRIP[p.key] || "#2e4374";
  const icon = platformIconImg(p.key, 30);
  const pctToday = grandLast24h > 0 ? (p.last24h / grandLast24h) * 100 : 0;
  const barPct = maxLast24h > 0 ? (p.last24h / maxLast24h) * 100 : 0;
  const border = isLast ? "" : "border-bottom:1px solid #f0f1f6;";
  // Per-network deep link. Just `?platform=<key>` — FE reads this on landing
  // and selects that network. Bas itna.
  const link = appUrl ? `${appUrl}?platform=${encodeURIComponent(p.key)}` : "";
  const open = link ? `<a href="${link}" target="_blank" style="text-decoration:none;color:inherit;display:block;">` : "";
  const close = link ? `</a>` : "";
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${border}">
      <tr>
        <td width="38" valign="middle" style="padding:11px 0;">${open}${icon}${close}</td>
        <td valign="middle" style="padding:11px 6px;">${open}
          <div class="dr-rowname" style="font-size:14px;font-weight:700;color:#1a2240;line-height:16px;">${escapeHtml(label)}</div>
          <div style="font-size:11px;color:#9aa1b4;margin-top:2px;">${pctToday.toFixed(1)}% of today</div>
        ${close}</td>
        <td valign="middle" width="36%" class="dr-bar-col" style="padding:11px 12px;">${open}${buildBar(barPct, color)}${close}</td>
        <td valign="middle" align="right" width="76" style="padding:11px 0;">${open}
          <div class="dr-rowval" style="font-size:15px;font-weight:800;color:#1a2240;line-height:17px;">${fullNumber(p.last24h)}</div>
          <div style="font-size:10px;color:#9aa1b4;margin-top:2px;">${compactNumber(p.total)} all-time</div>
        ${close}</td>
      </tr>
    </table>`;
}

// Final highlighted "All platforms" Σ row.
function buildAllPlatformsRow(grand) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#fff7ec" style="background:#fff7ec;border-radius:10px;margin-top:6px;">
      <tr>
        <td width="38" valign="middle" style="padding:13px 0 13px 8px;">
          <span style="display:inline-block;width:26px;height:26px;border-radius:6px;background:#f39b2c;color:#ffffff;font-size:15px;font-weight:800;text-align:center;line-height:26px;">&#931;</span>
        </td>
        <td valign="middle" style="padding:13px 6px;">
          <div style="font-size:14px;font-weight:800;color:#1a2240;">All platforms</div>
        </td>
        <td valign="middle" align="right" width="120" style="padding:13px 12px 13px 0;">
          <div style="font-size:16px;font-weight:800;color:#f39b2c;line-height:18px;">${fullNumber(grand.last24h)}</div>
          <div style="font-size:10px;color:#b08a4a;margin-top:2px;">${compactNumber(grand.total)} all-time</div>
        </td>
      </tr>
    </table>`;
}

function getMinPlatformAds() {
  const raw = Number(config.get("DATA_REPORT_MIN_ADS"));
  if (raw !== undefined && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  try {
    const n = Number(config.get("DATA_REPORT_MIN_ADS"));
    if (Number.isFinite(n)) return n;
  } catch { /* not configured — fall through to default */ }
  return 0;
}

// Whole breakdown: networks with at least 1 ad today (zero-count networks are
// dropped from the UI), sorted by today's volume desc, then the Σ row.
function buildPlatformRowsHtml(platforms, grand, minAds = 1, appUrl = "") {
  const threshold = Math.max(1, Number(minAds) || 1);
  const visible = platforms.filter((p) => p.ok && p.last24h >= threshold).slice().sort((a, b) => b.last24h - a.last24h);
  if (!visible.length) return "";
  const maxLast24h = visible.reduce((m, p) => Math.max(m, p.last24h), 0);
  const rows = visible
    .map((p, i) => buildPlatformRow(p, { grandLast24h: grand.last24h, maxLast24h, isLast: i === visible.length - 1, appUrl }))
    .join("");
  return rows + buildAllPlatformsRow(grand);
}

class DataReportEmailService {
  constructor() {
    sgMail.setApiKey(config.get("SENDGRID_API_KEY"));
  }

  renderTemplate(stats, variables = {}) {
    const filePath = path.resolve("mail-template", "dataReport.html");
    let html = fs.readFileSync(filePath, "utf-8");

    let appUrl = "";
    try { appUrl = config.get("app_url"); } catch { appUrl = ""; }

    const manageUrl = appUrl ? `${appUrl}` : "#";
    const ctaUrl = appUrl ? `${appUrl}guest-landing` : "#";
    // Deep-links to the dashboard Projects section. Plural `projects` matches the
    // SPA route + the post-login deep-link restore, so a logged-out click lands
    // back here after authenticating.
    const createProjectUrl = appUrl ? `${appUrl}projects` : "#";
    const unsubscribeLink = appUrl
      ? `${appUrl}facebook/unsubscribe-page?email=${encodeURIComponent(variables.email || "")}&sig=${unsubscribeToken(variables.email)}&page=dataReport`
      : "#";

    // Hero "Active platforms" must match the number of network ROWS actually
    // rendered in the email — use the same `minAds` threshold that
    // buildPlatformRowsHtml uses (see line below). Otherwise the hero shows
    // "11 active" while only 7 rows appear (or vice-versa).
    const minAds = getMinPlatformAds();
    const visibleThreshold = Math.max(1, Number(minAds) || 1);
    const activeToday = stats.platforms.filter((p) => p.ok && p.last24h >= visibleThreshold);
    const topPlatform = activeToday.slice().sort((a, b) => b.last24h - a.last24h)[0];
    const name = (variables.name || "").trim();
    const greeting = name ? `Good morning, ${name}` : "Good morning";
    const replacements = {
      logoUrl: BRAND_LOGO_URL,
      dateLabel: escapeHtml(variables.dateLabel || todayLabel()),
      generatedAt: escapeHtml(generatedAtIST()),
      greeting: escapeHtml(greeting),
      grandLast24h: fullNumber(stats.grand.last24h),
      // activePlatforms: `${activeToday.length} / ${stats.platforms.length}`,
      activePlatforms: `${activeToday.length}`,
      topPlatform: escapeHtml(topPlatform ? (topPlatform.label || topPlatform.key) : "—"),
      allTimeTracked: compactNumber(stats.grand.total),
      platformRowsHtml: buildPlatformRowsHtml(stats.platforms, stats.grand, minAds, appUrl),
      ctaUrl,
      createProjectUrl,
      manageUrl,
      unsubscribe_link: unsubscribeLink,
    };

    for (const [key, value] of Object.entries(replacements)) {
      const re = new RegExp(`{{\\s*${key}\\s*}}`, "g");
      html = html.replace(re, value);
    }
    return html;
  }

  /** Render + send to ONE recipient using already-computed stats. */
  async _sendOne(to, name, data, sendId) {
    // Bounce blacklist (manifest §15) — single canonical gate covering
    // single send, bulk, and cron. Writes a skipped log row then throws
    // so the bulk loop's failed-list captures the address; the truthful
    // record lives in email_send_log either way.
    if (await isBlacklisted(to)) {
      const skipId = sendId || newSendId();
      try {
        await logSend({
          send_id: skipId,
          mail_type: "dataReport",
          to,
          subject: null,
          status: "skipped",
          failure_reason: BLACKLISTED_SKIP_REASON,
          meta: { source: "cron" },
        });
      } catch { /* logSend handles its own errors */ }
      throw new Error(BLACKLISTED_SKIP_REASON);
    }

    const html = this.renderTemplate(data, { name, email: to });
    // Reuse the caller's send_id (cron passes the deterministic one so the
    // pre-created `queued` row is UPDATED to `sent`, not duplicated).
    const send_id = sendId || newSendId();
    const subject = `PowerAdSpy Data Report · ${todayLabel()}`;
    const mailOptions = {
      to,
      from: { email: config.get("SENDGRID_FROM"), name: "PoweradSpy" },
      subject,
      html,
      // custom_args travel back on SendGrid webhook events → correlate to this log row.
      customArgs: { send_id, mail_type: "dataReport" },
      // Enable click + open tracking PER MESSAGE so SendGrid rewrites the
      // <a href> links into tracking redirects and fires `click` events
      // (otherwise no clicks are ever generated, regardless of the webhook
      // subscription). Independent of the account-level default.
      trackingSettings: {
        clickTracking: { enable: true, enableText: false },
        openTracking: { enable: true },
      },
    };
    const base = {
      send_id,
      mail_type: "dataReport",
      to,
      subject,
      meta: { todayTotal: data?.grand?.last24h ?? 0, allTime: data?.grand?.total ?? 0 },
    };
    try {
      const resp = await sgMail.send(mailOptions);
      const r0 = Array.isArray(resp) ? resp[0] : resp;
      const statusCode = r0?.statusCode || r0?.status || "?";
      const msgId = r0?.headers?.["x-message-id"] || r0?.headers?.["X-Message-Id"] || "(no-msg-id)";
      logger.info(`[dataReport] sent to ${to} (status=${statusCode} msgId=${msgId})`);
      await logSend({ ...base, status: "sent", sendgrid_message_id: msgId === "(no-msg-id)" ? null : msgId, sent_at: new Date() });
      return { to, statusCode, msgId, send_id };
    } catch (e) {
      // Record WHY it didn't go out, then rethrow so the caller's failed list is unchanged.
      await logSend({ ...base, status: "failed", failure_reason: e?.message || "send error" });
      throw e;
    }
  }

  /**
   * Compute stats (if not supplied) and send the data report to one recipient.
   * Returns the stats used so the caller/test can inspect them.
   */
  async sendDataReport({ to, name, hours = 24, stats = null, send_id = null }) {
    if (!to) throw new Error("Missing recipient 'to'");
    const data = stats || (await getDataReportStats());
    logger.info(`[dataReport] sending to ${to} (last24h=${data.grand.last24h}, total=${data.grand.total})`);
    const { statusCode, msgId } = await this._sendOne(to, name, data, send_id);
    return { stats: data, statusCode, msgId };
  }

  /**
   * Send the data report to MANY recipients (any emails you pass — one or an
   * array). Stats are computed ONCE and reused; each recipient is sent
   * individually so one bad address never blocks the rest. Returns per-email
   * sent / failed lists.
   */
  async sendDataReportBulk({ recipients, name, hours = 24, stats = null }) {
    const list = (Array.isArray(recipients) ? recipients : [recipients])
      .map((e) => String(e || "").trim())
      .filter(Boolean);
    if (!list.length) throw new Error("No recipients provided");

    const data = stats || (await getDataReportStats());
    logger.info(`[dataReport] bulk send → ${list.length} recipient(s) (last24h=${data.grand.last24h}, total=${data.grand.total})`);

    const sent = [];
    const failed = [];
    for (const to of list) {
      try {
        const r = await this._sendOne(to, name, data);
        sent.push(r);
      } catch (e) {
        logger.error(`[dataReport] FAILED to ${to}: ${e.message}`);
        failed.push({ to, error: e.message });
      }
    }
    return { stats: data, sent, failed };
  }
}

export default new DataReportEmailService();
