import zlib from "zlib";
import sgClient from "@sendgrid/client";
import config from "config";
import logger from "../../resources/logs/logger.log.js";

/**
 * SendGrid subscribed-contacts service (NEW).
 *
 * "Subscribed" = every Marketing Contact MINUS anyone on the global
 * unsubscribe / suppression list. SendGrid only returns the full contact
 * book through an async EXPORT job, so the flow is:
 *
 *   1. POST /v3/marketing/contacts/exports        → start a CSV export job
 *   2. GET  /v3/marketing/contacts/exports/{id}   → poll until status=ready
 *   3. download + gunzip each returned CSV url     → collect EMAIL column
 *   4. GET  /v3/suppression/unsubscribes (paged)   → build unsubscribed set
 *   5. return contacts not present in the unsubscribed set
 *
 * Nothing here touches the existing emailService — it is fully standalone.
 */

sgClient.setApiKey(config.get("SENDGRID_API_KEY"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startContactExport() {
  const [, body] = await sgClient.request({
    method: "POST",
    url: "/v3/marketing/contacts/exports",
    body: { file_type: "csv" },
  });
  const id = body?.id;
  if (!id) throw new Error("SendGrid export did not return a job id");
  return id;
}

async function pollExport(id, { maxWaitMs = 90_000, intervalMs = 3_000 } = {}) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const [, body] = await sgClient.request({
      method: "GET",
      url: `/v3/marketing/contacts/exports/${id}`,
    });
    const status = body?.status;
    if (status === "ready") return body?.urls || [];
    if (status === "failure") throw new Error("SendGrid contact export failed");
    await sleep(intervalMs);
  }
  throw new Error(`SendGrid contact export not ready within ${maxWaitMs}ms`);
}

/**
 * Minimal CSV parse: split into rows, locate the EMAIL column from the
 * header, and pull that column from every data row. SendGrid emails never
 * contain commas, but values may be quoted — strip surrounding quotes.
 */
function emailsFromCsv(csv) {
  const rows = csv.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!rows.length) return [];
  const header = rows[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim().toLowerCase());
  const emailIdx = header.findIndex((h) => h === "email");
  if (emailIdx === -1) return [];
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i].split(",");
    const raw = (cols[emailIdx] || "").replace(/^"|"$/g, "").trim().toLowerCase();
    if (raw) out.push(raw);
  }
  return out;
}

async function downloadAndExtractEmails(urls) {
  const all = new Set();
  for (const url of urls) {
    const resp = await fetch(url);
    if (!resp.ok) {
      logger.error(`SendGrid export download failed (${resp.status}) for ${url}`);
      continue;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    // Export files are gzipped CSVs; fall back to raw text if not gzipped.
    let csv;
    try { csv = zlib.gunzipSync(buf).toString("utf-8"); }
    catch { csv = buf.toString("utf-8"); }
    for (const e of emailsFromCsv(csv)) all.add(e);
  }
  return [...all];
}

/**
 * Generic paged fetch of any SendGrid suppression list.
 * @param {string} kind one of: unsubscribes, bounces, blocks, spam_reports, invalid_emails
 * @returns {Promise<Array<{email, created, reason?, status?}>>}
 */
async function fetchSuppressionList(kind) {
  const out = [];
  const limit = 500;
  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const [, body] = await sgClient.request({
      method: "GET",
      url: `/v3/suppression/${kind}?limit=${limit}&offset=${offset}`,
    });
    const rows = Array.isArray(body) ? body : [];
    for (const r of rows) {
      if (r?.email) {
        out.push({
          email: String(r.email).trim().toLowerCase(),
          created: r.created,
          ...(r.reason !== undefined ? { reason: r.reason } : {}),
          ...(r.status !== undefined ? { status: r.status } : {}),
        });
      }
    }
    if (rows.length < limit) break;
    offset += limit;
    /* v8 ignore next -- safety cap; reaching it needs 400+ full 500-row pages, not feasible to exercise */
    if (offset > 200_000) break; // safety cap
  }
  return out;
}

async function fetchGlobalUnsubscribes() {
  const set = new Set();
  for (const r of await fetchSuppressionList("unsubscribes")) set.add(r.email);
  return set;
}

const SUPPRESSION_KINDS = ["unsubscribes", "bounces", "blocks", "spam_reports", "invalid_emails"];

/**
 * Full contact health breakdown: total marketing contacts, the subscribed
 * count, and every SendGrid suppression list (unsubscribed / bounced /
 * blocked / spam / invalid) with counts (and emails unless includeEmails=false).
 */
export async function getContactsBreakdown({ includeEmails = true } = {}) {
  let totalContacts = 0;
  try {
    const [, body] = await sgClient.request({ method: "GET", url: "/v3/marketing/contacts/count" });
    totalContacts = body?.contact_count ?? 0;
  } catch (e) {
    logger.error(`contacts count failed: ${e.message}`);
  }

  const suppressions = {};
  const suppressedSet = new Set();
  for (const kind of SUPPRESSION_KINDS) {
    try {
      const list = await fetchSuppressionList(kind);
      list.forEach((r) => suppressedSet.add(r.email));
      suppressions[kind] = { count: list.length, ...(includeEmails ? { emails: list } : {}) };
    } catch (e) {
      logger.error(`suppression ${kind} failed: ${e.message}`);
      suppressions[kind] = { count: 0, error: e.message };
    }
  }

  // Subscribed ≈ contacts that are NOT on any suppression list.
  const subscribedCount = Math.max(0, totalContacts - suppressedSet.size);

  return { totalContacts, subscribedCount, suppressed: suppressedSet.size, suppressions };
}

/**
 * Returns the list of subscribed contact emails.
 * @param {Object} [opts]
 * @param {number} [opts.maxWaitMs=90000] how long to wait for the export job
 * @returns {Promise<{ subscribed: string[], totalContacts: number, unsubscribed: number }>}
 */
export async function getSubscribedContacts(opts = {}) {
  const id = await startContactExport();
  const urls = await pollExport(id, opts);
  const allEmails = await downloadAndExtractEmails(urls);

  let unsubSet = new Set();
  try {
    unsubSet = await fetchGlobalUnsubscribes();
  } catch (e) {
    // If suppression lookup fails, don't hard-fail — return all contacts but
    // log it so the caller knows the unsubscribe filter wasn't applied.
    logger.error(`fetchGlobalUnsubscribes failed: ${e.message}`);
  }

  const subscribed = allEmails.filter((e) => !unsubSet.has(e));
  return {
    subscribed,
    totalContacts: allEmails.length,
    unsubscribed: allEmails.length - subscribed.length,
  };
}

/**
 * Add address(es) to the GLOBAL unsubscribe suppression list on THIS SendGrid
 * account — the same account that SENDS the report mails. Once here SendGrid
 * refuses delivery to them from every send path, and they show in the
 * suppression panel. Must run with the SENDER's key (this service's key), not a
 * different app's key, or the suppression lands on the wrong account.
 * Idempotent. @param {string|string[]} emails
 */
export async function addGlobalUnsubscribe(emails) {
  const list = (Array.isArray(emails) ? emails : [emails])
    .map((e) => String(e || "").trim().toLowerCase())
    .filter((e) => e.includes("@"));
  if (!list.length) return { ok: false, added: 0, error: "no valid email" };
  try {
    await sgClient.request({
      method: "POST",
      url: "/v3/asm/suppressions/global",
      body: { recipient_emails: list },
    });
    return { ok: true, added: list.length };
  } catch (e) {
    const msg = e?.response?.body ? JSON.stringify(e.response.body) : e.message;
    logger.error(`addGlobalUnsubscribe failed: ${msg}`);
    return { ok: false, added: 0, error: msg };
  }
}

/** Remove an address from the global unsubscribe list (resubscribe). 404 = ok. */
export async function removeGlobalUnsubscribe(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e.includes("@")) return { ok: false, error: "no valid email" };
  try {
    await sgClient.request({
      method: "DELETE",
      url: `/v3/asm/suppressions/global/${encodeURIComponent(e)}`,
    });
    return { ok: true };
  } catch (err) {
    if (err?.code === 404 || err?.response?.statusCode === 404) return { ok: true };
    const msg = err?.response?.body ? JSON.stringify(err.response.body) : err.message;
    logger.error(`removeGlobalUnsubscribe failed: ${msg}`);
    return { ok: false, error: msg };
  }
}
