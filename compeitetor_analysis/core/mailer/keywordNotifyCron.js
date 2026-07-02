import cron from "node-cron";
import config from "config";
import logger from "../../resources/logs/logger.log.js";
import { runKeywordNotify } from "./keywordNotifyService.js";

/**
 * Keyword / advertiser notification cron (NEW, config-driven).
 *
 * Fires on the schedule set in config `keyword_notify_schedule` and mails each
 * user the top-N of their tracked terms that picked up new ads (see
 * keywordNotifyService). Because the service DELETES rows once mailed, the
 * cadence just controls freshness:
 *   - daily (e.g. "10am")  → each user gets at most one digest per day,
 *   - "15m"                → a digest every 15 min carrying only NEW terms.
 *
 * Gated by its OWN switch (independent of the data-report `cron` flag):
 *   - `keyword_notify_cron` must be true, and
 *   - `keyword_notify_schedule` must be non-empty and parseable.
 * Either missing → the cron never registers (feature stays off).
 *
 * Schedule formats accepted (all resolved to IST):
 *   "10:00" / "9:30"      → daily at that time
 *   "10am" / "10 pm"      → daily at that hour
 *   "15m" / "30 min"      → every N minutes (N < 60)
 *   "6h" / "2 hours"      → every N hours (N < 24); N >= 24 → daily midnight
 *   "0 10 * * *"          → raw 5-field cron, used verbatim
 */

const TZ = "Asia/Kolkata";
let running = false;

/**
 * Translate a human schedule into a node-cron expression.
 * Returns null when the value is empty or unrecognised.
 */
export function toCronExpr(input) {
  const s = String(input || "").trim().toLowerCase();
  if (!s) return null;

  // Raw 5-field cron, used as-is.
  if (/\s/.test(s) && s.split(/\s+/).length === 5) return s;

  // "10:00" / "9:30" — daily at HH:MM.
  let m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = Number(m[1]), min = Number(m[2]);
    if (h < 24 && min < 60) return `${min} ${h} * * *`;
    return null;
  }

  // "10am" / "10 pm" — daily at hour.
  m = s.match(/^(\d{1,2})\s*(am|pm)$/);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[2] === "pm") h += 12;
    if (h < 24) return `0 ${h} * * *`;
    return null;
  }

  // "15m" / "30 min" / "45 minutes" — every N minutes.
  m = s.match(/^(\d+)\s*(m|min|mins|minute|minutes)$/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n < 60) return `*/${n} * * * *`;
    return null;
  }

  // "6h" / "2 hours" / "24h" — every N hours (>=24 → once daily at midnight).
  m = s.match(/^(\d+)\s*(h|hr|hrs|hour|hours)$/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 24) return "0 0 * * *";
    if (n >= 1) return `0 */${n} * * *`;
    return null;
  }

  return null;
}

async function runOnce(trigger) {
  if (running) {
    logger.info(`[keywordNotifyCron] run already in progress — skip (${trigger})`);
    return;
  }
  running = true;
  try {
    logger.info(`[keywordNotifyCron] fire (trigger=${trigger})`);
    await runKeywordNotify();
  } catch (e) {
    logger.error(`[keywordNotifyCron] run error (${trigger}): ${e.message}`);
  } finally {
    running = false;
  }
}

/**
 * Wire up the cron. Call once after the server starts. No-op unless
 * `keyword_notify_cron` is true AND `keyword_notify_schedule` resolves to a
 * valid cron. Completely independent of the data-report `cron` flag.
 */
export function initKeywordNotifyCron() {
  let enabled = false;
  try { enabled = !!config.get("keyword_notify_cron"); } catch { enabled = false; }
  if (!enabled) {
    logger.info("[keywordNotifyCron] disabled (set `keyword_notify_cron` to true to enable)");
    return;
  }

  let scheduleRaw = "";
  try { scheduleRaw = String(config.get("keyword_notify_schedule") || "").trim(); } catch { scheduleRaw = ""; }
  if (!scheduleRaw) {
    logger.info("[keywordNotifyCron] disabled (set `keyword_notify_schedule` to enable, e.g. \"10am\" / \"15m\")");
    return;
  }

  const expr = toCronExpr(scheduleRaw);
  if (!expr || !cron.validate(expr)) {
    logger.error(`[keywordNotifyCron] invalid keyword_notify_schedule "${scheduleRaw}" — cron NOT started`);
    return;
  }

  cron.schedule(expr, () => runOnce("schedule"), { timezone: TZ });
  logger.info(`[keywordNotifyCron] scheduled "${scheduleRaw}" → "${expr}" ${TZ}`);
}

export { runOnce as runKeywordNotifyOnce };
