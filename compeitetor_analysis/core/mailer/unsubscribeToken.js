import crypto from "crypto";
import config from "config";

/**
 * Signed unsubscribe token. The unsubscribe link in every report mail carries
 * `?email=<addr>&token=<hmac>`, where the token = HMAC-SHA256(lowercased email,
 * UNSUBSCRIBE_SECRET). Only our servers (which hold the secret) can produce a
 * valid token, so the unsubscribe page works ONLY when reached from a real mail
 * link — a direct/guessed URL has no valid token and is rejected by the API.
 *
 * The SAME secret must be set in pas_node_api (config `unsubscribe.secret` / env
 * UNSUBSCRIBE_SECRET) which verifies the token.
 */
function secret() {
  let s = "";
  try { s = config.get("unsubscribe_secret"); } catch { s = ""; }
  return s || process.env.UNSUBSCRIBE_SECRET || "";
}

export function unsubscribeToken(email) {
  const s = secret();
  const e = String(email || "").trim().toLowerCase();
  if (!s || !e) return "";
  return crypto.createHmac("sha256", s).update(e).digest("hex");
}
