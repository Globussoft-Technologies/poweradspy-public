import mongoose from "mongoose";

/**
 * email_run_status — one doc per mail_type per day (NEW, Feature 2).
 *
 * Tracks the daily send RUN itself (the dataReport blast to ~60k+ users), so
 * the admin panel can show live progress: total targeted, how many processed,
 * how many still processing. `total` is the recipient count resolved at run
 * start; `processed` is derived live by the admin from email_send_log, so this
 * doc only needs the target + run state.
 */
const emailRunStatusSchema = new mongoose.Schema(
  {
    mail_type: { type: String, required: true, index: true }, // "dataReport" | "competitorUpdate"
    date: { type: String, required: true, index: true },        // YYYY-MM-DD (IST)
    total: { type: Number, default: 0 },                        // recipients targeted this run
    status: { type: String, default: "idle" },                  // idle | running | completed
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    note: { type: String, default: null },
  },
  { timestamps: true, collection: "email_run_status" }
);

emailRunStatusSchema.index({ mail_type: 1, date: -1 });
// 60-day rolling cleanup.
emailRunStatusSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 60 });

export default mongoose.models.email_run_status ||
  mongoose.model("email_run_status", emailRunStatusSchema);
