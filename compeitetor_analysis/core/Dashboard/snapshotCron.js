import cron from "node-cron";
import config from "config";
import logger from "../../resources/logs/logger.log.js";
import { runDailySnapshot, pruneOldSnapshots } from "./snapshotService.js";
import { evaluateAlerts } from "./alertEvaluationService.js";
import { detectChanges } from "./changeDetectionService.js";
import { notifyAlerts } from "../mailer/alertNotifyService.js";
import { toCronExpr } from "../mailer/keywordNotifyCron.js";

/**
 * Daily competitor/brand snapshot cron (NEW).
 *
 * Writes today's competitor_snapshots rows (see snapshotService.js), then
 * prunes rows older than the configured retention window. This is the
 * foundation trend sparklines, threshold alerts, and the "what changed"
 * activity feed all read from — see docs referenced in the PRD.
 *
 * IMPORTANT: alert evaluation and change-detection (added alongside this
 * feature) are chained to run immediately AFTER this snapshot completes, in
 * the same process/run — NOT as separately-scheduled crons. Both depend on
 * today's snapshot already being written; a separately-scheduled alert cron
 * would risk reading yesterday's data if this job is ever late or fails.
 * See runOnce() below for the chain.
 *
 * Gated by its OWN switch (independent of `cron`/`keyword_notify_cron`):
 *   - `competitor_snapshot_cron` must be true, and
 *   - `competitor_snapshot_schedule` defaults to "0 1 * * *" (01:00 IST —
 *     ahead of dataReportCron's 03:00) if unset/invalid.
 */

const TZ = "Asia/Kolkata";
const DEFAULT_SCHEDULE = "0 1 * * *";
const DEFAULT_RETENTION_DAYS = 400; // covers a 30d trend window with margin

let running = false;

function readRetentionDays() {
  try {
    const n = Number(config.get("competitor_snapshot_retention_days"));
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_RETENTION_DAYS;
  } catch {
    return DEFAULT_RETENTION_DAYS;
  }
}

async function runOnce(trigger) {
  if (running) {
    logger.info(`[snapshotCron] run already in progress — skip (${trigger})`);
    return;
  }
  running = true;
  try {
    logger.info(`[snapshotCron] fire (trigger=${trigger})`);
    await runDailySnapshot();
    await pruneOldSnapshots(readRetentionDays());

    // Chained (not separately scheduled) — both read today's snapshot rows,
    // so they must run in this same pass, right after the snapshot above.
    const triggeredEvents = await evaluateAlerts();
    await notifyAlerts(triggeredEvents);
    await detectChanges();
  } catch (e) {
    logger.error(`[snapshotCron] run error (${trigger}): ${e.message}`);
  } finally {
    running = false;
  }
}

/**
 * Wire up the cron. Call once after the server starts. No-op unless
 * `competitor_snapshot_cron` is true.
 */
export function initSnapshotCron() {
  let enabled = false;
  try { enabled = !!config.get("competitor_snapshot_cron"); } catch { enabled = false; }
  if (!enabled) {
    logger.info("[snapshotCron] disabled (set `competitor_snapshot_cron` to true to enable)");
    return;
  }

  let scheduleRaw = "";
  try { scheduleRaw = String(config.get("competitor_snapshot_schedule") || "").trim(); } catch { scheduleRaw = ""; }
  const expr = scheduleRaw ? (toCronExpr(scheduleRaw) || scheduleRaw) : DEFAULT_SCHEDULE;

  if (!cron.validate(expr)) {
    logger.error(`[snapshotCron] invalid competitor_snapshot_schedule "${scheduleRaw}" — falling back to default "${DEFAULT_SCHEDULE}"`);
    cron.schedule(DEFAULT_SCHEDULE, () => runOnce("schedule"), { timezone: TZ });
    logger.info(`[snapshotCron] scheduled default "${DEFAULT_SCHEDULE}" ${TZ}`);
    return;
  }

  cron.schedule(expr, () => runOnce("schedule"), { timezone: TZ });
  logger.info(`[snapshotCron] scheduled "${expr}" ${TZ}`);
}

export { runOnce as runSnapshotCronOnce };
