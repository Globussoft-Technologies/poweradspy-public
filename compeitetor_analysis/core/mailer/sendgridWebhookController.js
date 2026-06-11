import crypto from "crypto";
import config from "config";
import logger from "../../resources/logs/logger.log.js";
import { applyWebhookEvent } from "./emailAudit.js";

/**
 * SendGrid Event Webhook receiver (NEW — Feature 2, Phase 3).
 *
 * SendGrid POSTs an array of delivery events (delivered / open / bounce /
 * dropped / spamreport / unsubscribe / deferred / processed). We persist each
 * raw event and advance the matching email_send_log row's status
 * (via emailAudit.applyWebhookEvent → manifest §4).
 *
 * Mounted public (no auth) at: POST /api/webhooks/sendgrid
 *
 * Signature verification: if `sendgrid_webhook_public_key` is set in config,
 * the ECDSA "Signed Event Webhook" signature is verified against the raw body
 * (server.js stashes it as req.rawBody). If not set, verification is skipped
 * (fine for dev; enable in prod).
 */

const SIG_HEADER = "x-twilio-email-event-webhook-signature";
const TS_HEADER = "x-twilio-email-event-webhook-timestamp";

function publicKeyPem() {
  let b64 = "";
  try { b64 = config.get("sendgrid_webhook_public_key"); } catch { b64 = ""; }
  if (!b64) return null;
  return `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----\n`;
}

function verifySignature(req) {
  const pem = publicKeyPem();
  if (!pem) return { ok: true, skipped: true }; // verification disabled

  try {
    const signature = req.headers[SIG_HEADER];
    const timestamp = req.headers[TS_HEADER];
    if (!signature || !timestamp) return { ok: false };

    const raw = req.rawBody != null ? req.rawBody : Buffer.from(JSON.stringify(req.body));
    const payload = Buffer.concat([Buffer.from(String(timestamp)), Buffer.isBuffer(raw) ? raw : Buffer.from(raw)]);

    const ok = crypto.verify(
      "sha256",
      payload,
      { key: crypto.createPublicKey(pem), dsaEncoding: "der" },
      Buffer.from(signature, "base64")
    );
    return { ok };
  } catch (e) {
    logger.error(`[sgWebhook] signature verify error: ${e.message}`);
    return { ok: false };
  }
}

export async function handleSendgridWebhook(req, res) {
  // Respond fast; process events without blocking the 200.
  const verdict = verifySignature(req);
  if (!verdict.ok) {
    logger.error("[sgWebhook] signature verification failed — rejecting");
    return res.status(403).json({ message: "invalid signature" });
  }

  const events = Array.isArray(req.body) ? req.body : (req.body ? [req.body] : []);
  res.status(200).json({ received: events.length });

  // Fire-and-forget persistence (each is try/catch internally).
  for (const evt of events) {
    applyWebhookEvent(evt);
  }
  logger.info(`[sgWebhook] processed ${events.length} event(s)${verdict.skipped ? " (unverified)" : ""}`);
}

export default { handleSendgridWebhook };
