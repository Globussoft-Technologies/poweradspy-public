import mongoose from "mongoose";

/**
 * Single fixed-id marker doc recording the last IST calendar day
 * `updateDailyCompetitors` actually reset (_id: "daily_reset").
 *
 * Exists so the old external DevOps crontab and the new in-process
 * `competitorMailCron` can safely coexist during rollout — a second
 * same-day reset call becomes a logged no-op instead of silently wiping a
 * fresh promotion or re-zeroing `competitors_request.email_status`. A Mongo
 * doc (not a local file) deliberately, so the guard holds even if the two
 * triggers land on different processes/instances.
 */
const competitorPipelineStateSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    lastResetDateIST: { type: String, default: null },
  },
  { timestamps: true, collection: "competitor_pipeline_state" }
);

export default mongoose.models.competitor_pipeline_state ||
  mongoose.model("competitor_pipeline_state", competitorPipelineStateSchema);
