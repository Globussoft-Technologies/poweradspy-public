// Admin-triggered single-recipient send endpoints. Used by the EmailDetails
// resend button and the EmailComposer modal in the admin panel. See §8 of
// docs/MEMBER_CC_MANIFEST.md for the contract.
//
// IMPORTANT: this controller is ADDITIVE. It never touches the existing send
// paths (cron, /active-competitor-contacts, /data-report/send). It calls the
// same services they call, but goes through the dedicated manualSendService
// helpers so any per-call state (force-active snapshot, target email filter)
// stays scoped to the request.

import Response from "../../utils/response.js";
import logger from "../../resources/logs/logger.log.js";
import {
  sendCompetitorMailForEmail,
  sendDataReportForEmail,
} from "./manualSendService.js";

class ManualSendController {
  /**
   * POST /api/email-analytics/send-competitor  { email }
   *
   * Mongo-validated. If the email isn't in user_details → 404 (no mail sent).
   * If it is, we snapshot the user's competitor + request statuses, force them
   * to active, run the standard pipeline targeted to just that user, then
   * restore the snapshot in a finally so the daily cron path is unaffected.
   */
  async sendCompetitor(req, res) {
    try {
      const email = String(req?.body?.email || "").trim();
      if (!email) {
        return res.send(Response.validationFailResp("email is required", ""));
      }
      const result = await sendCompetitorMailForEmail(email);
      if (!result.ok && result.code === "user_not_found") {
        return res.status(404).send({
          statusCode: 404,
          body: { status: "failed", error: "user not found in db" },
        });
      }
      if (!result.ok && result.code === "no_requests") {
        return res.status(400).send({
          statusCode: 400,
          body: { status: "failed", error: result.error || "user has no competitor requests" },
        });
      }
      if (!result.ok) {
        return res.send(Response.userFailResp(
          "Failed to send competitor mail",
          result.error || result.code
        ));
      }
      return res.send(Response.userSuccessResp(
        `Competitor mail sent to ${result.sentTo}`,
        { sentTo: result.sentTo, mailStatus: result.code, response: result.response }
      ));
    } catch (e) {
      logger.error(`sendCompetitor endpoint: ${e.message}`);
      return res.send(Response.failResp("Unexpected error sending competitor mail", e.message));
    }
  }

  /**
   * POST /api/email-analytics/send-data-report  { email, name?, hours? }
   *
   * Stateless. No DB lookup, no validation. Generates today's data report and
   * sends it through the standard dataReportEmailService.
   */
  async sendDataReport(req, res) {
    try {
      const email = String(req?.body?.email || "").trim();
      if (!email) {
        return res.send(Response.validationFailResp("email is required", ""));
      }
      /* v8 ignore next -- req.body is always present here (the email check above returns otherwise); the `|| {}` is defensive */
      const { name, hours } = req.body || {};
      const result = await sendDataReportForEmail(email, { name, hours });
      if (!result.ok) {
        return res.send(Response.userFailResp(
          "Failed to send data report",
          result.error || result.code
        ));
      }
      return res.send(Response.userSuccessResp(
        `Data report sent to ${result.sentTo}`,
        { sentTo: result.sentTo, statusCode: result.statusCode, msgId: result.msgId }
      ));
    } catch (e) {
      logger.error(`sendDataReport endpoint: ${e.message}`);
      return res.send(Response.failResp("Unexpected error sending data report", e.message));
    }
  }
}

export default new ManualSendController();
