import keywordNotifyService, { runKeywordNotify, previewForUser } from "./keywordNotifyService.js";
import { toCronExpr } from "./keywordNotifyCron.js";
import config from "config";
import logger from "../../resources/logs/logger.log.js";

/**
 * Keyword / advertiser notification endpoints (NEW, standalone).
 *
 *   POST /keyword-notify/run       { limitUsers? }   → run one pass now (sends + deletes)
 *   GET  /keyword-notify/preview   ?email=           → what would be mailed (no send, no delete)
 *   GET  /keyword-notify/schedule                    → resolved cron + enabled state
 */
class KeywordNotifyController {
  /** Trigger one notification pass immediately (mails users, deletes mailed rows). */
  async run(req, res) {
    try {
      const limitUsers = Number(req.body?.limitUsers);
      const opts = Number.isFinite(limitUsers) && limitUsers > 0 ? { limitUsers } : {};
      const summary = await runKeywordNotify(opts);
      return res.status(200).json({ message: "Keyword notification run complete", ...summary });
    } catch (error) {
      logger.error(`keywordNotify run failed: ${error.message}`);
      return res.status(500).json({ message: "Failed to run keyword notification", error: error.message });
    }
  }

  /** Preview one user's next digest without sending or deleting anything. */
  async preview(req, res) {
    try {
      const email = req.query?.email;
      if (!email) return res.status(400).json({ message: "Missing required query param: email" });
      const data = await previewForUser(email);
      return res.status(200).json({ message: "Keyword notification preview", ...data });
    } catch (error) {
      logger.error(`keywordNotify preview failed: ${error.message}`);
      return res.status(500).json({ message: "Failed to build preview", error: error.message });
    }
  }

  /** Show the resolved schedule so the operator can confirm what's configured. */
  async schedule(req, res) {
    try {
      let enabled = false, raw = "";
      try { enabled = !!config.get("keyword_notify_cron"); } catch { /* off */ }
      try { raw = String(config.get("keyword_notify_schedule") || "").trim(); } catch { /* unset */ }
      const expr = toCronExpr(raw);
      return res.status(200).json({
        message: "Keyword notification schedule",
        keywordNotifyCronEnabled: enabled,
        scheduleRaw: raw || null,
        cronExpr: expr,
        active: !!(enabled && expr),
        timezone: "Asia/Kolkata",
      });
    } catch (error) {
      logger.error(`keywordNotify schedule failed: ${error.message}`);
      return res.status(500).json({ message: "Failed to read schedule", error: error.message });
    }
  }
}

export default new KeywordNotifyController();
