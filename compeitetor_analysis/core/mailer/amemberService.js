import config from "config";
import logger from "../../resources/logs/logger.log.js";

/**
 * aMember user fetch (NEW).
 *
 * PowerAdSpy users register through aMember, so the mailing list comes from
 * there — every user who has NOT unsubscribed (`unsubscribed = 0`). The list
 * is large (~60k), so we page through the REST API (max 1000/page) with the
 * server-side `_filter[unsubscribed]=0` so aMember only returns subscribed
 * users.
 *
 * Config:
 *   amember_api_url  e.g. "https://app-dev.poweradspy.com/amember/api"
 *   amember_api_key  aMember REST API key
 */

function amemberCfg() {
  let apiUrl = "";
  let apiKey = "";
  try { apiUrl = config.get("amember_api_url"); } catch { apiUrl = ""; }
  try { apiKey = config.get("amember_api_key"); } catch { apiKey = ""; }
  return { apiUrl: String(apiUrl || "").replace(/\/+$/, ""), apiKey: String(apiKey || "") };
}

// aMember returns the page rows as numeric string keys ("0","1",...) alongside
// meta keys like "_total". Pull just the row objects.
function rowsFromPage(body) {
  return Object.keys(body || {})
    .filter((k) => /^\d+$/.test(k))
    .map((k) => body[k]);
}

// Single-page fetch. Internal — both public functions below use this.
async function fetchAmemberPage({ apiUrl, apiKey, pageSize, page, timeoutMs }) {
  const url =
    `${apiUrl}/users?_key=${encodeURIComponent(apiKey)}` +
    `&_filter%5Bunsubscribed%5D=0&_count=${pageSize}&_page=${page}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) throw new Error(`aMember users HTTP ${resp.status} on page ${page}`);
  return resp.json();
}

/**
 * Page-parallel fetcher. Fetches page 0 first to discover `_total`, then
 * fires the remaining pages in concurrent batches (default 5 at a time).
 * Drops a ~60k-user pull from ~2 minutes (60 sequential) down to ~25 seconds.
 *
 * `concurrency: 1` falls back to one-at-a-time — exactly the historical
 * behavior — for environments where parallelism trips aMember rate limits.
 *
 * @returns {Promise<{ rawRows: Array<Object>, total: number, pages: number }>}
 */
async function collectAllAmemberSubscribers({ pageSize, maxPages, timeoutMs, concurrency }) {
  const { apiUrl, apiKey } = amemberCfg();
  if (!apiUrl || !apiKey) {
    throw new Error("aMember not configured (set amember_api_url and amember_api_key in config)");
  }

  // 1) Page 0 — discover server-reported total + first 1000 rows.
  const page0Body = await fetchAmemberPage({ apiUrl, apiKey, pageSize, page: 0, timeoutMs });
  const total = Number(page0Body?._total) || 0;
  const rows0 = rowsFromPage(page0Body);
  const totalPages = Math.min(maxPages, Math.max(1, Math.ceil(total / pageSize) || 1));
  logger.info(`[amember] page 0: ${rows0.length} rows, _total=${total}, plan=${totalPages} pages @ concurrency=${concurrency}`);

  if (totalPages <= 1 || rows0.length < pageSize) {
    // Single page covers everything OR page 0 itself was short → done.
    return { rawRows: rows0, total, pages: 1 };
  }

  // 2) Fetch pages 1 … totalPages-1 in parallel batches.
  const remaining = [];
  for (let p = 1; p < totalPages; p++) remaining.push(p);

  const all = [...rows0];
  let stoppedEarly = false;
  for (let i = 0; i < remaining.length && !stoppedEarly; i += concurrency) {
    const batch = remaining.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (p) => {
        const body = await fetchAmemberPage({ apiUrl, apiKey, pageSize, page: p, timeoutMs });
        const rows = rowsFromPage(body);
        logger.info(`[amember] page ${p}: ${rows.length} rows`);
        return { page: p, rows };
      })
    );
    // Append in page order for deterministic dedup / ordering downstream.
    results.sort((a, b) => a.page - b.page);
    for (const r of results) {
      all.push(...r.rows);
      // If aMember returned fewer than pageSize, this was the last page —
      // skip any subsequent pages we may have over-projected.
      if (r.rows.length < pageSize) stoppedEarly = true;
    }
  }
  return { rawRows: all, total, pages: totalPages };
}

/**
 * Fetch every subscribed user's email from aMember (unsubscribed = 0).
 * Parallel-paged (concurrency 5 by default → ~5x faster than sequential).
 *
 * @param {Object} [opts]
 * @param {number} [opts.pageSize=1000]    rows per page (aMember caps at 1000)
 * @param {number} [opts.maxPages=1000]    safety cap on pages
 * @param {number} [opts.timeoutMs=30000]  per-request timeout
 * @param {number} [opts.concurrency=5]    parallel page fetches; set to 1 for
 *                                          sequential (original) behavior
 * @returns {Promise<{ emails: string[], total: number, pages: number }>}
 */
export async function getSubscribedUserEmails({
  pageSize = 1000, maxPages = 1000, timeoutMs = 30000, concurrency = 5,
} = {}) {
  const { rawRows, total, pages } = await collectAllAmemberSubscribers({ pageSize, maxPages, timeoutMs, concurrency });
  const emails = new Set();
  for (const u of rawRows) {
    if (String(u.unsubscribed) === "1") continue;
    const e = String(u.email || "").trim().toLowerCase();
    if (e && e.includes("@")) emails.add(e);
  }
  logger.info(`[amember] collected ${emails.size} unique emails from ${rawRows.length} rows across ${pages} page(s)`);
  return { emails: [...emails], total, pages };
}

/**
 * Fetch every subscribed user from aMember with the metadata needed for
 * priority ordering (manifest §17). Same paging + filter as
 * `getSubscribedUserEmails`, but the result is the full user record per row
 * (not just `email`) so callers can sort by `added` (signup date),
 * `last_login`, etc.
 *
 * Additive — `getSubscribedUserEmails` is unchanged; existing callers keep
 * the lightweight path. Ramp/priority callers use this richer path.
 *
 * @param {Object} [opts]   same shape as getSubscribedUserEmails
 * @returns {Promise<{ users: Array<{ email, added, last_login, amember_id, raw }>, total: number, pages: number }>}
 */
export async function getSubscribedUsers({
  pageSize = 1000, maxPages = 1000, timeoutMs = 30000, concurrency = 5,
} = {}) {
  const { rawRows, total, pages } = await collectAllAmemberSubscribers({ pageSize, maxPages, timeoutMs, concurrency });
  const seen = new Set();
  const users = [];
  for (const u of rawRows) {
    if (String(u.unsubscribed) === "1") continue;
    const email = String(u.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    users.push({
      email,
      added: u.added || null,            // signup timestamp (priority: "new_user")
      last_login: u.last_login || null,  // last login timestamp (priority: "active")
      amember_id: u.user_id ?? u.member_id ?? null,
      raw: u,                            // future criteria can read more fields without another fetch
    });
  }
  logger.info(`[amember] (rich) collected ${users.length} unique users from ${rawRows.length} rows across ${pages} page(s)`);
  return { users, total, pages };
}
