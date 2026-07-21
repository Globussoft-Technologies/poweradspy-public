import mongoose from "mongoose";

/**
 * alert_rules — user-configured thresholds evaluated by alertEvaluationService
 * once per day, right after that day's competitor_snapshots are written.
 *
 * `competitor_id: null` means "applies to every competitor currently
 * monitored on this project," not "applies to no one" — evaluation treats
 * null as a wildcard across the project's monitoring[] list.
 */
const alertRuleSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "user_details", required: true },
    request_id: { type: mongoose.Schema.Types.ObjectId, ref: "competitors_request", required: true, index: true },
    competitor_id: { type: mongoose.Schema.Types.ObjectId, ref: "competitors", default: null },
    metric: { type: String, enum: ["budget", "ad_count", "activity"], required: true },
    condition: { type: String, enum: ["pct_increase_wow", "pct_decrease_wow", "went_dark"], required: true },
    threshold_value: { type: Number, default: null }, // percent; unused for went_dark
    dark_days: { type: Number, default: 7 }, // only used for went_dark
    channels: {
      email: { type: Boolean, default: true },
      in_app: { type: Boolean, default: true },
    },
    is_active: { type: Boolean, default: true },
    last_triggered_at: { type: Date, default: null },
  },
  { timestamps: true, collection: "alert_rules" }
);

alertRuleSchema.index({ request_id: 1, is_active: 1 });

export default mongoose.models.alert_rules ||
  mongoose.model("alert_rules", alertRuleSchema);
