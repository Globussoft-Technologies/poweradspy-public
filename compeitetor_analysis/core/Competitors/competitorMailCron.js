import cron from "node-cron";
import fs from "fs";
import path from "path";
import config from "config";
import moment from "moment";
import logger from "../../resources/logs/logger.log.js";
import monitorService from "./monitorService.js";
import { toCronExpr } from "../mailer/keywordNotifyCron.js";

/**
 * In-process competitor-pulse mail pipeline cron (2026-08-20).
 *
 * Replaces the external, DevOps-owned crontab that previously drove
 * get-competitors -> update-competitors-status (per platform) ->
 * active-competitor-contacts -> update-daily-competitors via curl against
 * the public HTTPS domain. That architecture had two structural problems:
 *   1. No entry for platform=google at all — google_status never left 0.
 *   2. update-competitors-status had to clear the WHOLE day's backlog
 *      inside a fixed ~30-minute external-cron gap before the send fired;
 *      as the tracked-competitor pool grew, that stopped being enough
 *      (facebook returned zero promotions on 3 consecutive nights despite
 *      genuinely fresh ES data existing).
 *
 * This cron calls the SAME already-tested monitorService methods directly,
 * in-process — so activeCompetitorContacts only ever fires once the checks
 * are actually done, instead of racing a fixed external clock. No
 * promotion/send logic is duplicated or changed here.
 *
 * facebook/instagram/google legs run CONCURRENTLY, not sequentially —
 * confirmed in production they hit three genuinely separate ES clusters, so
 * there's no shared-cluster contention risk from checking them at once, and
 * running them together keeps the whole morning cycle fast instead of
 * artificially spread out. Each leg is independent: one platform's ES/
 * exception failure is logged but never blocks or delays the other two, or
 * the daily send/reset that follows.
 *
 * Restart-safe via a same-IST-day marker file (same pattern as
 * dataReportCron.js) plus a `running` mutex. Safe to coexist with the old
 * external crontab during rollout: getCompetitors/updateCompetitorsStatus
 * are naturally safe to call redundantly (rate-limited by the same
 * process-global esLoadGuard singletons regardless of caller);
 * activeCompetitorContacts is naturally idempotent per user per day
 * (email_status gate); updateDailyCompetitors is now guarded against a
 * same-day double-reset (see models/competitorPipelineState.js).
 *
 * Gated by config `competitor_mail_cron` (only runs when true).
 */

const DATA_DIR = path.resolve("data");
const LAST_RUN_FILE = path.join(DATA_DIR, "competitor_mail_last_run.json");
const TZ = "Asia/Kolkata";
const DEFAULT_SCHEDULE = "0 5 * * *"; // 05:00 IST — matches the old external trigger time
// Bounded batch loop, not one giant fetch — a fixed-size batch keeps every
// single Mongo find/updateMany and every ES query-burst the SAME small size
// regardless of how large the tracked-competitor pool grows (today ~5,700;
// safe at 50,000+). Looping more times costs nothing extra per operation;
// fetching everything in one shot does — that's exactly the CPU-spike /
// timeout risk at scale this is designed to avoid.
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_MINUTES_PER_LEG = 20; // wall-clock safety cap per platform per day
const PLATFORMS = ["facebook", "instagram", "google"];

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
    logger.error(`[competitorMailCron] write failed (${path.basename(file)}): ${e.message}`);
  }
}

function readNumberConfig(key, fallback) {
  try {
    const n = Number(config.get(key));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  } catch { return fallback; }
}
function readSchedule() {
  let s = "";
  try { s = String(config.get("competitor_mail_cron_schedule") || "").trim(); } catch { /* unset */ }
  return s || DEFAULT_SCHEDULE;
}

/**
 * Call a monitorService(req, res) method in-process and return whatever it
 * sent — same req/res shape tests/core/Competitors/monitorService.test.js's
 * mockRes() already uses, so this is proven-compatible without touching
 * monitorController.js or monitorService.js's method signatures.
 *
 * `.call(monitorService, ...)` matters: updateCompetitorsStatus and
 * activeCompetitorContacts reference `this.esServers`/`this.esClient`
 * internally, so the method must run bound to the real instance.
 */
async function invokeService(fn, { query = {}, body = {} } = {}) {
  let captured;
  const res = { send: (payload) => { captured = payload; return payload; } };
  await fn.call(monitorService, { query, body }, res);
  return captured;
}

/**
 * Runs one platform's get→check leg as a bounded batch LOOP, not one giant
 * fetch: each iteration marks at most `batchSize` competitors (status 0→1)
 * then immediately ES-checks exactly that batch (updateCompetitorsStatus
 * scans whatever is currently at status=1, which after a bounded
 * getCompetitors call is naturally ~batchSize, not the whole pool). Keeps
 * every single Mongo query and every ES query-burst a fixed, small size no
 * matter how large the tracked-competitor pool grows — looping costs
 * nothing extra per call; fetching-everything-at-once does.
 *
 * Stops when: a batch comes back smaller than `batchSize` (pool for this
 * platform is drained for today), or the per-leg time cap is hit (whatever
 * is left simply continues tomorrow — the oldest-updatedAt-first sort in
 * getCompetitors means it's never the SAME competitors stuck waiting
 * forever, coverage rotates fairly across days if a single day ever can't
 * fit the whole pool).
 *
 * Never throws — a failure (thrown exception from either service call) is
 * caught here and returned as `{ platform, ok: false, error }` so
 * Promise.all in the caller can't have one platform's failure abort the
 * other two concurrent legs.
 */
async function runLeg(platform, batchSize, maxMs, trigger) {
  const t0 = Date.now();
  let totalCandidates = 0, totalMatched = 0, batches = 0, timedOut = false;
  try {
    while (true) {
      if (Date.now() - t0 > maxMs) {
        timedOut = true;
        break;
      }
      const got = await invokeService(monitorService.getCompetitors, { query: { platform, limit: String(batchSize) } });
      const candidateCount = got?.body?.data?.competitorNames?.length ?? 0;
      if (candidateCount === 0) break; // nothing left to check today

      const checked = await invokeService(monitorService.updateCompetitorsStatus, { query: { platform } });
      const matchedCount = Array.isArray(checked?.body?.data) ? checked.body.data.length : 0;

      totalCandidates += candidateCount;
      totalMatched += matchedCount;
      batches++;

      // A partial batch (fewer returned than requested) means status=0 is
      // drained for this platform — looping again would just find nothing.
      if (candidateCount < batchSize) break;
    }
    if (timedOut) {
      logger.info(`[competitorMailCron] leg ${platform} hit the ${maxMs}ms time cap after ${batches} batch(es) — stopping for today, remaining candidates continue tomorrow`);
    }
    logger.info(`[competitorMailCron] leg ${platform} done in ${Date.now() - t0}ms (trigger=${trigger}) batches=${batches} candidates=${totalCandidates} matched=${totalMatched}`);
    return { platform, ok: true, batches, candidateCount: totalCandidates, matchedCount: totalMatched, timedOut };
  } catch (e) {
    logger.error(`[competitorMailCron] leg ${platform} FAILED after ${Date.now() - t0}ms (trigger=${trigger}, batches=${batches}): ${e.message}`);
    return { platform, ok: false, error: e.message, batches, candidateCount: totalCandidates, matchedCount: totalMatched };
  }
}

/**
 * Run (or resume) today's full pipeline. Idempotent per IST day.
 */
async function runCompetitorPipelineOnce(trigger) {
  const date = istDateKey();

  if (running) {
    logger.info(`[competitorMailCron] run already in progress — skip (${trigger})`);
    return;
  }
  if (readJson(LAST_RUN_FILE).date === date) {
    logger.info(`[competitorMailCron] already completed for ${date} — skip (${trigger})`);
    return;
  }

  running = true;
  const t0 = Date.now();
  const batchSize = readNumberConfig("competitor_get_batch_size", DEFAULT_BATCH_SIZE);
  const maxMs = readNumberConfig("competitor_leg_max_minutes", DEFAULT_MAX_MINUTES_PER_LEG) * 60 * 1000;

  try {
    logger.info(`[competitorMailCron] ===== START ${date} (trigger=${trigger}) batchSize=${batchSize} =====`);

    // All 3 platforms fire together — separate ES clusters, no shared-load
    // reason to spread them out, and this is what keeps the whole morning
    // cycle fast. runLeg never throws, so one platform failing can't abort
    // the others; activeCompetitorContacts below naturally works off
    // whatever ended up promoted regardless of which legs succeeded.
    const legResults = await Promise.all(PLATFORMS.map((platform) => runLeg(platform, batchSize, maxMs, trigger)));
    const legFailures = legResults.filter((r) => !r.ok).map((r) => r.platform);
    const legTimedOut = legResults.filter((r) => r.ok && r.timedOut).map((r) => r.platform);

    const sent = await invokeService(monitorService.activeCompetitorContacts, {});
    const sentCount = Array.isArray(sent?.body?.data) ? sent.body.data.length : 0;

    const reset = await invokeService(monitorService.updateDailyCompetitors, {});

    writeJson(LAST_RUN_FILE, { date, completedAt: new Date().toISOString(), legFailures, legTimedOut });

    const legSummary = legResults.map((r) => r.ok ? `${r.platform}=${r.matchedCount}/${r.candidateCount}(${r.batches}b)${r.timedOut ? "⏱" : ""}` : `${r.platform}=FAILED`).join(" ");
    logger.info(`[competitorMailCron] ===== DONE ${date}: legs[${legSummary}] sent=${sentCount} reset="${reset?.body?.message}" (${Date.now() - t0}ms) =====`);
  } catch (e) {
    // LAST_RUN not written on error -> retried on the next tick / next startup.
    logger.error(`[competitorMailCron] run error (${trigger}): ${e.message}`);
  } finally {
    running = false;
  }
}

/**
 * Wire up the cron. Call once after the server starts. No-op unless
 * config `competitor_mail_cron` is true.
 */
export function initCompetitorMailCron() {
  let enabled = false;
  try { enabled = !!config.get("competitor_mail_cron"); } catch { enabled = false; }

  if (!enabled) {
    logger.info("[competitorMailCron] disabled (set config `competitor_mail_cron` to true to enable)");
    return;
  }

  const scheduleRaw = readSchedule();
  const expr = toCronExpr(scheduleRaw) || scheduleRaw;
  let effectiveExpr = expr;
  if (!cron.validate(expr)) {
    logger.error(`[competitorMailCron] invalid competitor_mail_cron_schedule "${scheduleRaw}" — falling back to default "${DEFAULT_SCHEDULE}"`);
    effectiveExpr = DEFAULT_SCHEDULE;
    cron.schedule(effectiveExpr, () => runCompetitorPipelineOnce("schedule"), { timezone: TZ });
    logger.info(`[competitorMailCron] scheduled default "${DEFAULT_SCHEDULE}" ${TZ}`);
  } else {
    cron.schedule(effectiveExpr, () => runCompetitorPipelineOnce("schedule"), { timezone: TZ });
    logger.info(`[competitorMailCron] scheduled "${scheduleRaw}" -> "${effectiveExpr}" ${TZ}`);
  }

  // Crash-recovery: server was down at the scheduled time and it's now past
  // it on the same IST day with today not yet completed -> catch up now.
  const triggerHour = (() => {
    const parts = effectiveExpr.split(/\s+/);
    const h = Number(parts[1]);
    return Number.isFinite(h) ? h : 0;
  })();
  const ist = istNow();
  const pastTrigger = ist.hour() >= triggerHour;
  const doneToday = readJson(LAST_RUN_FILE).date === istDateKey();
  if (pastTrigger && !doneToday) {
    logger.info(`[competitorMailCron] today's ${String(triggerHour).padStart(2, "0")}:00 run missing — catching up now`);
    runCompetitorPipelineOnce("startup-catchup");
  }
}

export { runCompetitorPipelineOnce };
