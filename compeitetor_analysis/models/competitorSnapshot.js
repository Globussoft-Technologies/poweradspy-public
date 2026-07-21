import mongoose from "mongoose";

/**
 * competitor_snapshots — one row per (subject_type, subject_key, date),
 * written once daily by snapshotService.runDailySnapshot().
 *
 * This is the foundation the trend sparklines, threshold alerts, and "what
 * changed" activity feed all read from — before this model existed, every
 * dashboard number (impressions/popularity/budget/ad counts) was computed
 * live against Elasticsearch per request, with nothing persisted day over
 * day, so there was no way to answer "is this competitor scaling up or down."
 *
 * `subject_type` distinguishes a tracked competitor from the project owner's
 * own brand, so the same collection can back both a competitor row's trend
 * AND the pinned "your brand" row for share-of-voice comparison.
 *   - "competitor" → subject_key = String(competitors._id) (global — the same
 *     competitor referenced by multiple projects shares one set of snapshots,
 *     since ES is queried by name/owner regardless of which project's
 *     competitors_request.competitors[] references it).
 *   - "brand"      → subject_key = String(competitors_request._id) (project-
 *     scoped — two users can share the same advertiser name).
 */
const competitorSnapshotSchema = new mongoose.Schema(
  {
    subject_type: { type: String, enum: ["competitor", "brand"], required: true },
    subject_key: { type: String, required: true },
    subject_name: { type: String, default: null }, // denormalized for display without a join
    date: { type: String, required: true }, // "YYYY-MM-DD" IST
    metrics: {
      adsTotal: { type: Number, default: 0 },
      adsToday: { type: Number, default: 0 },
      adsYesterday: { type: Number, default: 0 },
      impressionsAvg: { type: Number, default: 0 },
      popularityAvg: { type: Number, default: 0 },
      // Estimated/calculated proxy — Σ(per-ad `averagebudget`), not real
      // disclosed ad spend. See getCompetitorBudgetStats() in dashboardService.js.
      budgetAvg: { type: Number, default: 0 },
      budgetTotal: { type: Number, default: 0 },
      platforms: {
        facebook: { type: Number, default: 0 },
        instagram: { type: Number, default: 0 },
        google: { type: Number, default: 0 },
      },
    },
    takenAt: { type: Date, default: Date.now },
  },
  { collection: "competitor_snapshots" }
);

// Upsert target — one row per subject per day.
competitorSnapshotSchema.index({ subject_type: 1, subject_key: 1, date: 1 }, { unique: true });
// Trend reads: latest-N-days for a given subject.
competitorSnapshotSchema.index({ subject_key: 1, date: -1 });
// Retention pruning.
competitorSnapshotSchema.index({ date: 1 });

export default mongoose.models.competitor_snapshots ||
  mongoose.model("competitor_snapshots", competitorSnapshotSchema);
