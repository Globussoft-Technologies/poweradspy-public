import moment from "moment";
import logger from "../../resources/logs/logger.log.js";
import ActivityEvent from "../../models/activityEvent.js";
import CompetitorSnapshot from "../../models/competitorSnapshot.js";
import Competitors_request from "../../models/competitors_request.js";

// v1 scope (see GOOGLE_COMPETITIVE_INTEL_PRD-style scoping note): only
// aggregate-count-derived signals. "New creative" (a specific new ad, not
// just a count delta) is NOT built here — it needs actual ad IDs, which the
// snapshot rollup deliberately doesn't store to keep documents small.
const NOTEWORTHY_PCT = 30; // feed-noise threshold, distinct from user-configured alert_rules thresholds
const WENT_DARK_DAYS = 5; // lower-severity default than alert_rules' user-configurable dark_days

function istDateKey(offsetDays = 0) {
  return moment.utc().utcOffset("+05:30").subtract(offsetDays, "days").format("YYYY-MM-DD");
}

function pctChange(before, after) {
  if (!before) return after > 0 ? Infinity : 0;
  return ((after - before) / before) * 100;
}

function diffPlatforms(before, after) {
  const events = [];
  for (const platform of ["facebook", "instagram", "google"]) {
    const wasPresent = (before?.[platform] || 0) > 0;
    const isPresent = (after?.[platform] || 0) > 0;
    if (!wasPresent && isPresent) {
      events.push({ event_type: "platform_added", metric: "platform", message: `started running ads on ${platform}` });
    } else if (wasPresent && !isPresent) {
      events.push({ event_type: "platform_dropped", metric: "platform", message: `stopped running ads on ${platform}` });
    }
  }
  return events;
}

function diffCountMetric({ before, after, field, upType, downType, label }) {
  const beforeVal = before?.[field] || 0;
  const afterVal = after?.[field] || 0;
  const change = pctChange(beforeVal, afterVal);
  if (Math.abs(change) < NOTEWORTHY_PCT) return null;
  return {
    event_type: change >= 0 ? upType : downType,
    metric: field === "budgetTotal" ? "budget" : "ads",
    before_value: beforeVal,
    after_value: afterVal,
    message: `${label} ${change >= 0 ? "jumped" : "dropped"} ${Math.abs(change).toFixed(1)}%`,
  };
}

async function detectWentDark(competitorId) {
  const dates = Array.from({ length: WENT_DARK_DAYS }, (_, i) => istDateKey(i));
  const rows = await CompetitorSnapshot.find({
    subject_type: "competitor",
    subject_key: competitorId,
    date: { $in: dates },
  }).lean();
  if (rows.length < WENT_DARK_DAYS) return null;
  if (!rows.every((r) => (r.metrics.adsToday || 0) === 0)) return null;
  return { event_type: "went_dark", metric: "ads", after_value: 0, message: `has had no new ads for ${WENT_DARK_DAYS}+ days` };
}

// One activity_events row per event per request_id per day — re-running the
// same day's detection (e.g. a manual debug trigger) must not duplicate rows.
async function alreadyRecorded(request_id, competitor_id, event_type, occurred_on) {
  const existing = await ActivityEvent.findOne({ request_id, competitor_id, event_type, occurred_on, category: "change" }).lean();
  return Boolean(existing);
}

/**
 * Diff today's vs. yesterday's competitor_snapshots per monitored competitor
 * and fan the result out to every project currently watching that
 * competitor. Must run AFTER runDailySnapshot() for the same day (see
 * snapshotCron.js) — it reads snapshots, it doesn't compute anything live.
 */
export async function detectChanges() {
  const today = istDateKey(0);
  const yesterday = istDateKey(1);

  const projects = await Competitors_request.find({}, { monitoring: 1 }).lean();
  const requestsByCompetitor = new Map(); // competitorId -> [request_id, ...]
  projects.forEach((p) => {
    (p.monitoring || []).forEach((id) => {
      const key = String(id);
      if (!requestsByCompetitor.has(key)) requestsByCompetitor.set(key, []);
      requestsByCompetitor.get(key).push(p._id);
    });
  });

  let written = 0;
  for (const [competitorId, requestIds] of requestsByCompetitor.entries()) {
    try {
      const [todaySnap, yesterdaySnap] = await Promise.all([
        CompetitorSnapshot.findOne({ subject_type: "competitor", subject_key: competitorId, date: today }).lean(),
        CompetitorSnapshot.findOne({ subject_type: "competitor", subject_key: competitorId, date: yesterday }).lean(),
      ]);
      if (!todaySnap) continue;

      const changes = [];
      if (yesterdaySnap) {
        changes.push(...diffPlatforms(yesterdaySnap.metrics.platforms, todaySnap.metrics.platforms));
        const adsChange = diffCountMetric({
          before: yesterdaySnap.metrics, after: todaySnap.metrics, field: "adsTotal",
          upType: "ad_count_spike", downType: "ad_count_drop", label: `${todaySnap.subject_name}'s ad count`,
        });
        if (adsChange) changes.push(adsChange);
        const budgetChange = diffCountMetric({
          before: yesterdaySnap.metrics, after: todaySnap.metrics, field: "budgetTotal",
          upType: "budget_spike", downType: "budget_drop", label: `${todaySnap.subject_name}'s estimated budget`,
        });
        if (budgetChange) changes.push(budgetChange);
      }
      const darkChange = await detectWentDark(competitorId);
      if (darkChange) changes.push({ ...darkChange, message: `${todaySnap.subject_name} ${darkChange.message}` });

      for (const change of changes) {
        for (const request_id of requestIds) {
          if (await alreadyRecorded(request_id, competitorId, change.event_type, today)) continue;
          await ActivityEvent.create({
            request_id,
            competitor_id: competitorId,
            competitor_name: todaySnap.subject_name,
            category: "change",
            event_type: change.event_type,
            metric: change.metric,
            before_value: change.before_value ?? null,
            after_value: change.after_value ?? null,
            message: change.message,
            severity: change.event_type === "went_dark" ? "warning" : "info",
            occurred_on: today,
          });
          written++;
        }
      }
    } catch (e) {
      logger.error(`[changeDetectionService] competitor ${competitorId} failed: ${e.message}`);
    }
  }

  logger.info(`[changeDetectionService] detectChanges ${today}: ${requestsByCompetitor.size} competitors → ${written} events written`);
  return { date: today, competitorsChecked: requestsByCompetitor.size, eventsWritten: written };
}
