import mongoose from "mongoose";

/**
 * activity_events — shared feed/notification store for BOTH threshold alerts
 * (category "alert", written by alertEvaluationService) and the "what
 * changed" activity feed (category "change", written by
 * changeDetectionService). One collection, one `read_by`/pagination model,
 * instead of two parallel notification stacks for what is, from the user's
 * point of view, one feed of "things that happened to my tracked competitors."
 *
 * Deliberately NOT wired into the existing pas_node_api/MySQL notification
 * bell (`daily_keyword_requests`) — that system is about keyword-search-job
 * completions, an unrelated feature owned by a different service/database.
 */
const activityEventSchema = new mongoose.Schema(
  {
    request_id: { type: mongoose.Schema.Types.ObjectId, ref: "competitors_request", required: true, index: true },
    competitor_id: { type: mongoose.Schema.Types.ObjectId, ref: "competitors", default: null },
    competitor_name: { type: String, default: null },
    category: { type: String, enum: ["alert", "change"], required: true },
    event_type: {
      type: String,
      enum: [
        "platform_added",
        "platform_dropped",
        "ad_count_spike",
        "ad_count_drop",
        "budget_spike",
        "budget_drop",
        "went_dark",
        "threshold_crossed",
      ],
      required: true,
    },
    metric: { type: String, enum: ["ads", "budget", "impressions", "platform", null], default: null },
    before_value: { type: Number, default: null },
    after_value: { type: Number, default: null },
    message: { type: String, required: true }, // pre-rendered sentence for the feed/email
    severity: { type: String, enum: ["info", "warning", "critical"], default: "info" },
    occurred_on: { type: String, required: true }, // "YYYY-MM-DD" IST
    read_by: [{ type: mongoose.Schema.Types.ObjectId, ref: "user_details" }],
  },
  { timestamps: true, collection: "activity_events" }
);

activityEventSchema.index({ request_id: 1, occurred_on: -1 });
activityEventSchema.index({ request_id: 1, category: 1, occurred_on: -1 });

export default mongoose.models.activity_events ||
  mongoose.model("activity_events", activityEventSchema);
