import mongoose from "mongoose";

/**
 * email_send_events — raw SendGrid webhook events (NEW, Feature 2).
 *
 * Append-only audit trail. Each row is one SendGrid event correlated to a send
 * via `send_id` (custom_arg) or `sg_message_id`. The webhook also updates the
 * parent email_send_log status. See EMAIL_ANALYTICS_MANIFEST.md §3.2 / §4.
 */
const emailSendEventSchema = new mongoose.Schema(
  {
    event_id: { type: String, required: true, index: true },
    send_id: { type: String, default: null, index: true },
    mail_type: { type: String, default: null },
    email: { type: String, default: null, index: true },
    event_type: { type: String, default: null, index: true }, // processed/delivered/open/bounce/dropped/spamreport/unsubscribe/deferred
    event_ts: { type: Date, default: null, index: true },
    reason: { type: String, default: null },                    // bounce / drop reason
    sg_message_id: { type: String, default: null, index: true },
    raw: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "email_send_events" }
);

// 30-day rolling cycle — match the send-log retention.
emailSendEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export default mongoose.models.email_send_events ||
  mongoose.model("email_send_events", emailSendEventSchema);
