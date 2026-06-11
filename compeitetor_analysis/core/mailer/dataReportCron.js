import cron from "node-cron";
import fs from "fs";
import path from "path";
import config from "config";
import moment from "moment";
import logger from "../../resources/logs/logger.log.js";
import { resolveDailyRecipients } from "./reportRecipientsService.js";
import { getDataReportStats } from "./dataReportStatsService.js";
import dataReportEmailService from "./dataReportEmailService.js";
import { dataReportSendId, seedQueued } from "./emailAudit.js";
import EmailRunStatus from "../../models/emailRunStatus.js";

// Run-status for the admin panel (total / running / completed). Non-blocking.
async function setRunStatus(date, patch) {
  try {
    await EmailRunStatus.updateOne(
      { mail_type: "dataReport", date },
      { $set: { mail_type: "dataReport", date, ...patch }, $setOnInsert: { startedAt: new Date() } },
      { upsert: true }
    );
  } catch (e) {
    logger.error(`[dataReportCron] run-status write failed: ${e.message}`);
  }
}

/**
 * Daily data-report cron (NEW).
 *
 * Sends the platform data report to every subscribed user (aMember
 * `unsubscribed=0`, minus SendGrid suppressions) at 03:00 IST, daily.
 *
 * Two-file design so heavy data is cached only while a run is in flight and
 * removed once it's done:
 *
 *   - CACHE_FILE  — recipients + stats + the already-sent list for TODAY.
 *     Written once the list/stats are fetched (so a crash resumes WITHOUT
 *     re-hitting aMember or Elasticsearch), updated as sends progress, and
 *     DELETED the moment the run completes.
 *   - LAST_RUN_FILE — a tiny `{ date }` marker that persists, so the same day
 *     never runs twice even though the cache is gone.
 *
 * Crash safety:
 *   - Down at 03:00 → on startup, if today isn't done and it's past 03:00 IST,
 *     the run is caught up.
 *   - Crash mid-send → the cache (recipients/stats/sent) survives; the next
 *     run RESUMES from it — no contact re-fetched, no email missed/duplicated.
 *
 * Gated by config `cron` (only runs when true).
 */

const DATA_DIR = path.resolve("data");
const CACHE_FILE = path.join(DATA_DIR, "data_report_cache.json");
const LAST_RUN_FILE = path.join(DATA_DIR, "data_report_last_run.json");

// Schedule — read from config so the operator can change the firing time
// without code changes. Falls back to 03:00 IST daily (the historical
// default) if the key is missing or malformed.
//
// Standard cron syntax — "minute hour day-of-month month day-of-week".
// Examples:
//   "0 3 * * *"   → daily at 03:00
//   "0 13 * * *"  → daily at 13:00 (1 PM)
//   "30 9 * * *"  → daily at 09:30
//   "0 */6 * * *" → every 6 hours
function readSchedule() {
  let s = "";
  try { s = String(config.get("daily_report_cron_schedule") || "").trim(); } catch { /* unset */ }
  return s || "0 3 * * *";
}
const TZ = "Asia/Kolkata";             // IST

let running = false;

function istNow() { return moment.utc().utcOffset("+05:30"); }
function istDateKey() { return istNow().format("YYYY-MM-DD"); }

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); }
  catch { return {}; }
}
function writeJson(file, obj) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  } catch (e) {
    logger.error(`[dataReportCron] write failed (${path.basename(file)}): ${e.message}`);
  }
}
function deleteFile(file) {
  try { if (fs.existsSync(file)) fs.unlinkSync(file); }
  catch (e) { logger.error(`[dataReportCron] delete failed (${path.basename(file)}): ${e.message}`); }
}

/**
 * Run (or resume) today's report send. Idempotent per IST day.
 */
async function runDailyReport(trigger) {
  const date = istDateKey();

  if (running) {
    logger.info(`[dataReportCron] run already in progress — skip (${trigger})`);
    return;
  }
  if (readJson(LAST_RUN_FILE).date === date) {
    logger.info(`[dataReportCron] already completed for ${date} — skip (${trigger})`);
    return;
  }

  running = true;
  const t0 = Date.now();
  try {
    logger.info(`[dataReportCron] ===== START ${date} (trigger=${trigger}) =====`);

    // Resume cache for today (crash-safe). Different day → start fresh.
    let cache = readJson(CACHE_FILE);
    if (cache.date !== date) cache = { date, recipients: null, stats: null, sent: [] };
    const sentSet = new Set((cache.sent || []).map((e) => e.toLowerCase()));

    // 1. Recipients — fetched ONCE, then cached (so a resume never re-hits
    //    aMember/SendGrid for ~60k users). Honours config `dailyreport` override.
    let subscribed = Array.isArray(cache.recipients) ? cache.recipients : null;
    if (!subscribed) {
      const r = await resolveDailyRecipients();
      subscribed = r.recipients;
      cache.recipients = subscribed;
      writeJson(CACHE_FILE, cache);
      logger.info(`[dataReportCron] recipients: ${subscribed.length} (source=${r.source}, aMember=${r.totalSubscribed}, suppressed=${r.suppressedExcluded})`);
    } else {
      logger.info(`[dataReportCron] reusing cached recipients: ${subscribed.length}`);
    }

    if (!subscribed.length) {
      await setRunStatus(date, { total: 0, status: "completed", completedAt: new Date(), note: "no recipients" });
      writeJson(LAST_RUN_FILE, { date, completedAt: new Date().toISOString(), sent: 0, failed: 0 });
      deleteFile(CACHE_FILE);
      logger.info(`[dataReportCron] no recipients — nothing to send. Marked done for ${date}.`);
      return;
    }

    // Publish the run target so the admin panel can show live progress.
    await setRunStatus(date, { total: subscribed.length, status: "running" });

    // Pre-create a `queued` (Processing) row per recipient so the admin send
    // log shows everyone immediately — each flips to `sent` as it's mailed.
    await seedQueued("dataReport", date, subscribed);

    // 2. Stats — also fetched ONCE and cached (everyone gets the same numbers;
    //    no repeated Elasticsearch hits on resume).
    let stats = cache.stats || null;
    if (!stats) {
      stats = await getDataReportStats();
      cache.stats = stats;
      writeJson(CACHE_FILE, cache);
      logger.info(`[dataReportCron] stats today=${stats.grand.last24h} all-time=${stats.grand.total}`);
    } else {
      logger.info(`[dataReportCron] reusing cached stats today=${stats.grand.last24h}`);
    }

    // 3. Send to whoever isn't already sent today (resume-safe).
    const pending = subscribed.filter((e) => !sentSet.has(e.toLowerCase()));
    logger.info(`[dataReportCron] sending to ${pending.length} pending (already sent ${sentSet.size})`);

    let ok = 0, fail = 0;
    for (let i = 0; i < pending.length; i++) {
      const to = pending[i];
      try {
        // Same deterministic id as the queued row → updates it to `sent`.
        await dataReportEmailService.sendDataReport({ to, stats, send_id: dataReportSendId(date, to) });
        sentSet.add(to.toLowerCase());
        ok++;
      } catch (e) {
        fail++;
        logger.error(`[dataReportCron] send failed ${to}: ${e.message}`);
      }
      // Persist progress every 20 so a crash resumes without re-mailing.
      if ((i + 1) % 20 === 0) {
        cache.sent = [...sentSet];
        writeJson(CACHE_FILE, cache);
        logger.info(`[dataReportCron] progress ${i + 1}/${pending.length} (ok=${ok} fail=${fail})`);
      }
    }

    // 4. Done — record the tiny marker, mark the run complete, DELETE the cache.
    writeJson(LAST_RUN_FILE, { date, completedAt: new Date().toISOString(), sent: ok, failed: fail });
    await setRunStatus(date, { status: "completed", completedAt: new Date() });
    deleteFile(CACHE_FILE);
    logger.info(`[dataReportCron] ===== DONE ${date}: sent=${ok} failed=${fail} (${Date.now() - t0}ms) — cache cleared =====`);
  } catch (e) {
    // LAST_RUN not written → retried on next startup / 03:00 tick. Cache kept for resume.
    logger.error(`[dataReportCron] run error (${trigger}): ${e.message} — will retry, cache kept`);
  } finally {
    running = false;
  }
}

/**
 * Wire up the cron. Call once after the server starts. No-op unless
 * config `cron` is true.
 */
export function initDataReportCron() {
  let enabled = false;
  try { enabled = !!config.get("cron"); } catch { enabled = false; }

  if (!enabled) {
    logger.info("[dataReportCron] disabled (set config `cron` to true to enable)");
    return;
  }

  const SCHEDULE = readSchedule();
  cron.schedule(SCHEDULE, () => runDailyReport("schedule"), { timezone: TZ });
  logger.info(`[dataReportCron] scheduled "${SCHEDULE}" ${TZ}`);

  // Crash-recovery: server was down at the scheduled time and it's now past
  // it on the same IST day with today not yet completed → catch up now.
  // The trigger HOUR is parsed from the cron expression's 2nd field. If the
  // expression isn't a single-hour pattern (e.g. "*/6") we fall back to 0
  // so the catchup gate effectively triggers any time the day isn't done.
  const triggerHour = (() => {
    const parts = SCHEDULE.split(/\s+/);
    const h = Number(parts[1]);
    return Number.isFinite(h) ? h : 0;
  })();
  const ist = istNow();
  const pastTrigger = ist.hour() >= triggerHour;
  const doneToday = readJson(LAST_RUN_FILE).date === istDateKey();
  if (pastTrigger && !doneToday) {
    logger.info(`[dataReportCron] today's ${String(triggerHour).padStart(2,"0")}:00 run missing — catching up now`);
    runDailyReport("startup-catchup");
  }
}

export { runDailyReport };
