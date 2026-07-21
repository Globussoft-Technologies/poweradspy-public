import AlertRule from "../../models/alertRule.js";
import Response from "../../utils/response.js";
import logger from "../../resources/logs/logger.log.js";
import { evaluateAlerts } from "./alertEvaluationService.js";
import { notifyAlerts } from "../mailer/alertNotifyService.js";

const VALID_METRICS = ["budget", "ad_count", "activity"];
const VALID_CONDITIONS = ["pct_increase_wow", "pct_decrease_wow", "went_dark"];

class AlertRulesController {
  // POST /alert-rules/list  { request_id }
  async list(req, res) {
    try {
      const { request_id } = req.body || {};
      if (!request_id) return res.send(Response.validationFailResp("request_id is required", ""));
      const rules = await AlertRule.find({ request_id }).sort({ createdAt: -1 }).lean();
      return res.send(Response.userSuccessResp("alert rules fetched", { rules }));
    } catch (e) {
      logger.error(`[alertRulesController] list: ${e.message}`);
      return res.send(Response.userFailResp("Failed to fetch alert rules", e.message));
    }
  }

  // POST /alert-rules/create  { user_id, request_id, competitor_id?, metric, condition, threshold_value?, dark_days?, channels? }
  async create(req, res) {
    try {
      const { user_id, request_id, competitor_id, metric, condition, threshold_value, dark_days, channels } = req.body || {};
      if (!user_id || !request_id) return res.send(Response.validationFailResp("user_id and request_id are required", ""));
      if (!VALID_METRICS.includes(metric)) return res.send(Response.validationFailResp(`metric must be one of ${VALID_METRICS.join(", ")}`, ""));
      if (!VALID_CONDITIONS.includes(condition)) return res.send(Response.validationFailResp(`condition must be one of ${VALID_CONDITIONS.join(", ")}`, ""));
      if (condition !== "went_dark" && !(Number(threshold_value) > 0)) {
        return res.send(Response.validationFailResp("threshold_value must be a positive number for this condition", ""));
      }

      const rule = await AlertRule.create({
        user_id, request_id,
        competitor_id: competitor_id || null,
        metric, condition,
        threshold_value: condition === "went_dark" ? null : Number(threshold_value),
        dark_days: condition === "went_dark" ? (Number(dark_days) > 0 ? Number(dark_days) : 7) : 7,
        channels: { email: channels?.email !== false, in_app: channels?.in_app !== false },
      });
      return res.send(Response.userSuccessResp("alert rule created", { rule }));
    } catch (e) {
      logger.error(`[alertRulesController] create: ${e.message}`);
      return res.send(Response.userFailResp("Failed to create alert rule", e.message));
    }
  }

  // POST /alert-rules/update  { user_id, rule_id, ...patch }
  async update(req, res) {
    try {
      const { user_id, rule_id, ...rest } = req.body || {};
      if (!user_id || !rule_id) return res.send(Response.validationFailResp("user_id and rule_id are required", ""));
      const patch = {};
      ["metric", "condition", "threshold_value", "dark_days", "is_active"].forEach((k) => {
        if (rest[k] !== undefined) patch[k] = rest[k];
      });
      if (rest.channels) patch.channels = { email: rest.channels.email !== false, in_app: rest.channels.in_app !== false };

      const rule = await AlertRule.findOneAndUpdate(
        { _id: rule_id, user_id },
        { $set: patch },
        { new: true }
      );
      if (!rule) return res.send(Response.userFailResp("Alert rule not found", ""));
      return res.send(Response.userSuccessResp("alert rule updated", { rule }));
    } catch (e) {
      logger.error(`[alertRulesController] update: ${e.message}`);
      return res.send(Response.userFailResp("Failed to update alert rule", e.message));
    }
  }

  // POST /alert-rules/delete  { user_id, rule_id }
  async delete(req, res) {
    try {
      const { user_id, rule_id } = req.body || {};
      if (!user_id || !rule_id) return res.send(Response.validationFailResp("user_id and rule_id are required", ""));
      const result = await AlertRule.deleteOne({ _id: rule_id, user_id });
      if (!result.deletedCount) return res.send(Response.userFailResp("Alert rule not found", ""));
      return res.send(Response.userSuccessResp("alert rule deleted", { ok: true }));
    } catch (e) {
      logger.error(`[alertRulesController] delete: ${e.message}`);
      return res.send(Response.userFailResp("Failed to delete alert rule", e.message));
    }
  }

  // GET /alert-rules/run — manual trigger, for dev/staging verification.
  async run(req, res) {
    try {
      const triggeredEvents = await evaluateAlerts();
      const notifyResult = await notifyAlerts(triggeredEvents);
      return res.status(200).json({ message: "Alert evaluation run complete", alertsTriggered: triggeredEvents.length, notify: notifyResult });
    } catch (e) {
      logger.error(`[alertRulesController] run: ${e.message}`);
      return res.status(500).json({ message: "Failed to run alert evaluation", error: e.message });
    }
  }
}

export default new AlertRulesController();
