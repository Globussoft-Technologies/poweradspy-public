import moment from "moment";
import logger from "../../resources/logs/logger.log.js";
import AlertRule from "../../models/alertRule.js";
import ActivityEvent from "../../models/activityEvent.js";
import CompetitorSnapshot from "../../models/competitorSnapshot.js";
import Competitors_request from "../../models/competitors_request.js";

function istDateKey(offsetDays = 0) {
  return moment.utc().utcOffset("+05:30").subtract(offsetDays, "days").format("YYYY-MM-DD");
}

// { budgetTotal, adsTotal } lookup keyed by rule.metric.
const METRIC_FIELD = { budget: "budgetTotal", ad_count: "adsTotal" };

function pctChange(before, after) {
  if (!before) return after > 0 ? Infinity : 0;
  return ((after - before) / before) * 100;
}

/**
 * Resolve the competitor ids a rule applies to: an explicit competitor_id,
 * or (when null) every competitor currently on the project's monitoring[] list.
 */
async function resolveTargets(rule) {
  if (rule.competitor_id) return [String(rule.competitor_id)];
  const project = await Competitors_request.findById(rule.request_id, { monitoring: 1 }).lean();
  return (project?.monitoring || []).map((id) => String(id));
}

async function getSnapshot(subjectKey, date) {
  return CompetitorSnapshot.findOne({ subject_type: "competitor", subject_key: subjectKey, date }).lean();
}

async function alreadyTriggeredToday(rule) {
  if (!rule.last_triggered_at) return false;
  return moment(rule.last_triggered_at).utcOffset("+05:30").format("YYYY-MM-DD") === istDateKey();
}

async function evaluatePctRule(rule, competitorId) {
  const field = METRIC_FIELD[rule.metric];
  if (!field) return null;

  const [today, weekAgo] = await Promise.all([
    getSnapshot(competitorId, istDateKey(0)),
    getSnapshot(competitorId, istDateKey(7)),
  ]);
  if (!today || !weekAgo) return null; // not enough history yet

  const before = weekAgo.metrics[field] || 0;
  const after = today.metrics[field] || 0;
  const change = pctChange(before, after);

  const crossed =
    (rule.condition === "pct_increase_wow" && change >= rule.threshold_value) ||
    (rule.condition === "pct_decrease_wow" && change <= -rule.threshold_value);

  if (!crossed) return null;

  return {
    competitor_id: competitorId,
    competitor_name: today.subject_name,
    event_type: "threshold_crossed",
    metric: rule.metric === "budget" ? "budget" : "ads",
    before_value: before,
    after_value: after,
    severity: "warning",
    message: `${today.subject_name}'s ${rule.metric === "budget" ? "estimated budget" : "ad count"} ${
      change >= 0 ? "rose" : "fell"
    } ${Math.abs(change).toFixed(1)}% week-over-week (threshold ${rule.threshold_value}%).`,
  };
}

async function evaluateWentDarkRule(rule, competitorId) {
  const darkDays = rule.dark_days || 7;
  const dates = Array.from({ length: darkDays }, (_, i) => istDateKey(i));
  const rows = await CompetitorSnapshot.find({
    subject_type: "competitor",
    subject_key: competitorId,
    date: { $in: dates },
  }).lean();

  // Only alert once we actually have `darkDays` worth of history and every
  // one of those days shows zero new ads — a missing row (job outage, brand
  // new competitor) must NOT be treated as "dark".
  if (rows.length < darkDays) return null;
  const allZero = rows.every((r) => (r.metrics.adsToday || 0) === 0);
  if (!allZero) return null;

  const latest = rows.find((r) => r.date === istDateKey(0)) || rows[0];
  return {
    competitor_id: competitorId,
    competitor_name: latest.subject_name,
    event_type: "went_dark",
    metric: "ads",
    before_value: null,
    after_value: 0,
    severity: "critical",
    message: `${latest.subject_name} has had no new ads for ${darkDays}+ days.`,
  };
}

/**
 * Evaluate every active alert_rules row against today's competitor_snapshots
 * (must run AFTER runDailySnapshot() for the same day — see snapshotCron.js).
 * On a crossing: write one activity_events row (category "alert"), stamp
 * last_triggered_at, and return the event so the caller (snapshotCron) can
 * hand it to alertNotifyService for delivery.
 */
export async function evaluateAlerts() {
  const rules = await AlertRule.find({ is_active: true }).lean();
  const triggeredEvents = [];

  for (const rule of rules) {
    try {
      if (await alreadyTriggeredToday(rule)) continue; // one alert per rule per day

      const targets = await resolveTargets(rule);
      for (const competitorId of targets) {
        const result =
          rule.condition === "went_dark"
            ? await evaluateWentDarkRule(rule, competitorId)
            : await evaluatePctRule(rule, competitorId);

        if (!result) continue;

        const occurred_on = istDateKey();
        const event = await ActivityEvent.create({
          request_id: rule.request_id,
          competitor_id: result.competitor_id,
          competitor_name: result.competitor_name,
          category: "alert",
          event_type: result.event_type,
          metric: result.metric,
          before_value: result.before_value,
          after_value: result.after_value,
          message: result.message,
          severity: result.severity,
          occurred_on,
        });

        await AlertRule.updateOne({ _id: rule._id }, { $set: { last_triggered_at: new Date() } });
        triggeredEvents.push({ rule, event: event.toObject() });
      }
    } catch (e) {
      logger.error(`[alertEvaluationService] rule ${rule._id} failed: ${e.message}`);
    }
  }

  logger.info(`[alertEvaluationService] evaluated ${rules.length} rules → ${triggeredEvents.length} alerts triggered`);
  return triggeredEvents;
}
