import moment from "moment";
import pLimit from "p-limit";
import logger from "../../resources/logs/logger.log.js";
import Competitors_request from "../../models/competitors_request.js";
import Competitors from "../../models/competitors.js";
import CompetitorSnapshot from "../../models/competitorSnapshot.js";
import DashboardService from "./dashboardService.js";

// Same IST anchoring rule as dashboardService.js's nowIST()/dataReportCron's
// istDateKey() — ES `last_seen` strings and "today" boundaries are IST.
function istDateKey() {
  return moment.utc().utcOffset("+05:30").format("YYYY-MM-DD");
}

const CONCURRENCY = 8;

/**
 * Build one day's metrics for a single advertiser/competitor name.
 * Reuses the exact same ES aggregations the live dashboard uses (getCompetitorAdStats
 * / getCompetitorBudgetStats) so a snapshot value always matches what the user
 * would see by opening the dashboard on that day — nothing is re-derived here.
 */
async function buildMetricsFor(name) {
  const [adStats, budgetStats] = await Promise.all([
    DashboardService.getCompetitorAdStats(name),
    DashboardService.getCompetitorBudgetStats(name),
  ]);

  return {
    adsTotal: adStats.allTime.total,
    adsToday: adStats.today.total,
    adsYesterday: adStats.yesterday.total,
    impressionsAvg: budgetStats.averageImpression,
    popularityAvg: budgetStats.averagePopularity,
    budgetAvg: budgetStats.averageBudget,
    budgetTotal: budgetStats.totalBudget,
    platforms: {
      facebook: adStats.allTime.facebook,
      instagram: adStats.allTime.instagram,
      google: adStats.allTime.google,
    },
  };
}

async function upsertSnapshot(subject_type, subject_key, subject_name, date, metrics) {
  await CompetitorSnapshot.updateOne(
    { subject_type, subject_key, date },
    { $set: { subject_type, subject_key, subject_name, date, metrics, takenAt: new Date() } },
    { upsert: true }
  );
}

/**
 * Snapshot every monitored competitor plus every project's own brand for
 * today (IST). Idempotent — safe to re-run the same day (upserts by
 * subject+date), which is what makes a manual `/snapshot/run` debug call and
 * the nightly cron share the same code path safely.
 *
 * Competitors are snapshotted ONCE globally (by their Mongo _id), not once
 * per project that references them — the same competitor name resolves to
 * the same ES aggregation regardless of which project's watchlist it's on,
 * so per-project duplication would just be wasted ES load.
 *
 * Brands are project-scoped (a competitors_request._id), since two projects
 * can legitimately share the same advertiser name.
 */
export async function runDailySnapshot() {
  const date = istDateKey();
  const limit = pLimit(CONCURRENCY);
  let ok = 0, failed = 0;

  // ── Competitors: distinct ids across every project's monitoring[] list ──
  const requests = await Competitors_request.find({}, { advertiser: 1, monitoring: 1 }).lean();

  const monitoredIds = new Set();
  requests.forEach((r) => (r.monitoring || []).forEach((id) => monitoredIds.add(String(id))));

  const monitoredCompetitors = monitoredIds.size
    ? await Competitors.find(
        { _id: { $in: [...monitoredIds] } },
        { competitor_name: 1 }
      ).lean()
    : [];

  const competitorJobs = monitoredCompetitors.map((c) =>
    limit(async () => {
      try {
        const metrics = await buildMetricsFor(c.competitor_name);
        await upsertSnapshot("competitor", String(c._id), c.competitor_name, date, metrics);
        ok++;
      } catch (e) {
        failed++;
        logger.error(`[snapshotService] competitor "${c.competitor_name}" (${c._id}) failed: ${e.message}`);
      }
    })
  );

  // ── Brands: one per project, keyed by the project (competitors_request) id ──
  const brandJobs = requests
    .filter((r) => Array.isArray(r.advertiser) && r.advertiser[0])
    .map((r) =>
      limit(async () => {
        try {
          const brandName = r.advertiser[0];
          const metrics = await buildMetricsFor(brandName);
          await upsertSnapshot("brand", String(r._id), brandName, date, metrics);
          ok++;
        } catch (e) {
          failed++;
          logger.error(`[snapshotService] brand for project ${r._id} failed: ${e.message}`);
        }
      })
    );

  await Promise.all([...competitorJobs, ...brandJobs]);

  logger.info(
    `[snapshotService] runDailySnapshot ${date}: ${monitoredCompetitors.length} competitors + ${requests.length} brands → ok=${ok} failed=${failed}`
  );
  return { date, competitors: monitoredCompetitors.length, brands: requests.length, ok, failed };
}

/**
 * Delete snapshot rows older than `retentionDays`. Explicit cron-side
 * pruning (not a Mongo TTL index) so retention stays config-tunable without
 * an index rebuild — same reasoning as pas_node_api's activeCountSnapshotJob.
 */
export async function pruneOldSnapshots(retentionDays) {
  const cutoff = moment.utc().utcOffset("+05:30").subtract(retentionDays, "days").format("YYYY-MM-DD");
  const result = await CompetitorSnapshot.deleteMany({ date: { $lt: cutoff } });
  logger.info(`[snapshotService] pruneOldSnapshots: removed ${result.deletedCount} rows older than ${cutoff}`);
  return result.deletedCount;
}
