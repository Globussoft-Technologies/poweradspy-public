import mongoose from "mongoose";

/**
 * Bounced-email blacklist (manifest §15).
 *
 * Any email that lands here is permanently skipped by the send pipelines
 * (competitorUpdate + dataReport, cron + manual + member-brand). Populated
 * by two paths:
 *   1. SendGrid `bounce` webhook event → applyWebhookEvent → markBounced.
 *   2. Inline detection — when `email_send_log` writes status=failed with a
 *      bounce-shaped failure_reason → logSend → markBounced.
 *
 * Each send-time skip writes a `status: "skipped"` row to email_send_log
 * with `failure_reason: "address previously bounced — recipient ignored"`,
 * so the admin panel surfaces the reason naturally.
 *
 * Manual recovery (typo fix, transient bounce on a real address): delete
 * the matching doc from this collection. No UI yet — operator runs a one-off
 * mongo command or short script.
 */
const bouncedEmailSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    first_bounced_at: { type: Date, default: () => new Date() },
    last_bounced_at:  { type: Date, default: () => new Date() },
    bounce_count:     { type: Number, default: 1 },
    last_reason:      { type: String, default: null },
    last_mail_type:   { type: String, default: null }, // "competitorUpdate" | "dataReport" | null
    source:           { type: String, enum: ["webhook", "failed_reason"], default: "webhook" },
  },
  { timestamps: true, collection: "bounced_emails" }
);

export default mongoose.models.bounced_email ||
  mongoose.model("bounced_email", bouncedEmailSchema);
