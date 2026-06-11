import dataReportEmailService from "./dataReportEmailService.js";
import { getDataReportStats } from "./dataReportStatsService.js";
import { getSubscribedContacts, getContactsBreakdown } from "./sendgridContactsService.js";
import { resolveDailyRecipients } from "./reportRecipientsService.js";
import logger from "../../resources/logs/logger.log.js";

/**
 * Data-report endpoints (NEW, standalone).
 *
 *   POST /data-report/send         { to, name?, hours? }  → send to any email(s) you pass
 *   POST /data-report/test         { to, name?, hours? }  → send one test mail
 *   GET  /data-report/stats        ?hours=24              → raw ES counts (no mail)
 *   GET  /data-report/subscribers                         → SendGrid subscribed emails
 */
class DataReportController {
  /**
   * Send the data report to whatever email(s) you pass — `to` can be one
   * email string or an array of emails. Each gets the report individually.
   */
  async send(req, res) {
    try {
      const { to, name, hours } = req.body || {};
      const recipients = (Array.isArray(to) ? to : [to])
        .map((e) => String(e || "").trim())
        .filter(Boolean);
      if (!recipients.length) {
        return res.status(400).json({ message: "Provide 'to' — a single email or an array of emails" });
      }
      const result = await dataReportEmailService.sendDataReportBulk({
        recipients,
        name: name || "there",
        hours: Number(hours) || 24,
      });
      return res.status(200).json({
        message: `Data report sent to ${result.sent.length}/${recipients.length} recipient(s)`,
        sent: result.sent,
        failed: result.failed,
        stats: result.stats,
      });
    } catch (error) {
      logger.error(`dataReport send failed: ${error.message}`);
      return res.status(500).json({ message: "Failed to send data report", error: error.message });
    }
  }

  /** Send a single test data-report mail to the email passed in `to`. */
  async sendTest(req, res) {
    try {
      const { to, name, hours } = req.body || {};
      if (!to) {
        return res.status(400).json({ message: "Missing required field: to" });
      }
      const result = await dataReportEmailService.sendDataReport({
        to,
        name: name || "there",
        hours: Number(hours) || 24,
      });
      return res.status(200).json({
        message: `Test data report sent to ${to}`,
        statusCode: result.statusCode,
        msgId: result.msgId,
        stats: result.stats,
      });
    } catch (error) {
      logger.error(`dataReport sendTest failed: ${error.message}`);
      return res.status(500).json({ message: "Failed to send data report", error: error.message });
    }
  }

  /** Return the raw ES counts without sending anything (quick sanity check). */
  async stats(req, res) {
    try {
      const hours = Number(req.query?.hours) || 24;
      const stats = await getDataReportStats({ hours });
      return res.status(200).json({ message: "Data report stats", stats });
    } catch (error) {
      logger.error(`dataReport stats failed: ${error.message}`);
      return res.status(500).json({ message: "Failed to compute stats", error: error.message });
    }
  }

  /**
   * ONE-HIT full contact breakdown: total contacts, subscribed count, and
   * every suppression list (unsubscribed / bounced / blocked / spam / invalid)
   * with counts + emails. Pass ?emails=false for counts only (faster).
   */
  async contacts(req, res) {
    try {
      const includeEmails = String(req.query?.emails ?? "true") !== "false";
      const data = await getContactsBreakdown({ includeEmails });
      return res.status(200).json({ message: "Contacts breakdown", ...data });
    } catch (error) {
      logger.error(`dataReport contacts failed: ${error.message}`);
      return res.status(500).json({ message: "Failed to fetch contacts breakdown", error: error.message });
    }
  }

  /**
   * The actual data-report mailing list: aMember users with unsubscribed = 0,
   * minus SendGrid suppressions. Counts by default; pass ?emails=true to
   * include the full email array (can be ~60k entries).
   */
  async recipients(req, res) {
    try {
      const includeEmails = String(req.query?.emails ?? "false") === "true";
      const data = await resolveDailyRecipients();
      const payload = {
        message: "Data report recipients",
        source: data.source, // "override" (config dailyreport) or "amember"
        recipientCount: data.recipients.length,
        amemberSubscribed: data.totalSubscribed,
        suppressedExcluded: data.suppressedExcluded,
      };
      if (includeEmails) payload.emails = data.recipients;
      return res.status(200).json(payload);
    } catch (error) {
      logger.error(`dataReport recipients failed: ${error.message}`);
      return res.status(500).json({ message: "Failed to fetch recipients", error: error.message });
    }
  }

  /** Return the SendGrid subscribed contacts (all contacts minus unsubscribed). */
  async subscribers(req, res) {
    try {
      const result = await getSubscribedContacts();
      return res.status(200).json({
        message: "Subscribed contacts fetched",
        count: result.subscribed.length,
        totalContacts: result.totalContacts,
        unsubscribed: result.unsubscribed,
        emails: result.subscribed,
      });
    } catch (error) {
      logger.error(`dataReport subscribers failed: ${error.message}`);
      return res.status(500).json({ message: "Failed to fetch subscribers", error: error.message });
    }
  }
}

export default new DataReportController();
