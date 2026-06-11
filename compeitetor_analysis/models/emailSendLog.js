import mongoose from "mongoose";

/**
 * email_send_log — one document per outgoing report email (NEW, Feature 2).
 *
 * Covers both compeitetor_analysis mails: `competitorUpdate` and `dataReport`.
 * Written by the send paths (status `sent` / `failed` / `skipped`) and later
 * upgraded by the SendGrid webhook (`delivered` / `bounced` / `opened` / ...).
 * See admin_panel_backend/docs/EMAIL_ANALYTICS_MANIFEST.md for the contract.
 */
const STATUSES = [
  "queued", "sent", "delivered", "opened",
  "bounced", "spam", "unsubscribed", "failed", "skipped",
];

const emailSendLogSchema = new mongoose.Schema(
  {
    send_id: { type: String, required: true, unique: true, index: true },
    mail_type: {
      type: String,
      enum: ["competitorUpdate", "dataReport"],
      required: true,
      index: true,
    },
    to: { type: String, required: true, index: true },
    amember_id: { type: Number, default: null, index: true },
    user_name: { type: String, default: null },
    subject: { type: String, default: null },

    status: { type: String, enum: STATUSES, default: "queued", index: true },
    failure_reason: { type: String, default: null },   // why it failed / skipped / bounced
    bounce_type: { type: String, default: null },        // "hard" | "soft" | null

    sendgrid_message_id: { type: String, default: null, index: true },

    scheduled_for: { type: Date, default: null },
    sent_at: { type: Date, default: null, index: true },
    delivered_at: { type: Date, default: null },
    opened_at: { type: Date, default: null },
    bounced_at: { type: Date, default: null },

    // Click tracking — populated by the SendGrid `click` webhook event.
    // Each click increments `click_count`, records the URL into `clicked_urls`
    // (deduped via $addToSet), and sets `last_clicked_at`. `clicked_at` is the
    // FIRST click — never overwritten. Open status is still upgraded by the
    // same event so "Opened" pill keeps working.
    clicked_at: { type: Date, default: null },
    last_clicked_at: { type: Date, default: null },
    click_count: { type: Number, default: 0 },
    clicked_urls: { type: [String], default: [] },

    resend_of: { type: String, default: null },          // parent send_id (manual resend)
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: "email_send_log" }
);

emailSendLogSchema.index({ mail_type: 1, sent_at: -1 });
emailSendLogSchema.index({ sent_at: -1 });

// 30-day rolling cycle — docs auto-expire 30 days after creation. This is a
// DEDICATED store (NOT competitors_requests, whose email_status resets each
// send), so the analytics history is never overwritten while it lives.
const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;
emailSendLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: THIRTY_DAYS_SECONDS });

export const EMAIL_STATUSES = STATUSES;
export default mongoose.models.email_send_log ||
  mongoose.model("email_send_log", emailSendLogSchema);
