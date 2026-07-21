import logger from "../../resources/logs/logger.log.js";
import { runDailySnapshot } from "./snapshotService.js";
import { evaluateAlerts } from "./alertEvaluationService.js";
import { detectChanges } from "./changeDetectionService.js";
import { notifyAlerts } from "../mailer/alertNotifyService.js";
import CompetitorSnapshot from "../../models/competitorSnapshot.js";

/**
 * Manual/debug entry points for the snapshot → alerts → change-detection
 * chain (see snapshotCron.js for the scheduled version). For dev/staging
 * verification without waiting for the nightly cron.
 *
 *   GET /snapshot/run        → run the full chain once, now
 *   GET /snapshot/last-run   → how many snapshot rows exist for today
 */
class SnapshotController {
  async run(req, res) {
    try {
      const snapshotResult = await runDailySnapshot();
      const triggeredEvents = await evaluateAlerts();
      const notifyResult = await notifyAlerts(triggeredEvents);
      const changeResult = await detectChanges();
      return res.status(200).json({
        message: "Snapshot chain run complete",
        snapshot: snapshotResult,
        alertsTriggered: triggeredEvents.length,
        notify: notifyResult,
        changes: changeResult,
      });
    } catch (error) {
      logger.error(`[snapshotController] run failed: ${error.message}`);
      return res.status(500).json({ message: "Failed to run snapshot chain", error: error.message });
    }
  }

  async lastRun(req, res) {
    try {
      const latest = await CompetitorSnapshot.findOne({}, { date: 1 }).sort({ date: -1 }).lean();
      const date = latest?.date || null;
      const count = date ? await CompetitorSnapshot.countDocuments({ date }) : 0;
      return res.status(200).json({ message: "Latest snapshot date", date, rowCount: count });
    } catch (error) {
      logger.error(`[snapshotController] lastRun failed: ${error.message}`);
      return res.status(500).json({ message: "Failed to read last run", error: error.message });
    }
  }
}

export default new SnapshotController();
