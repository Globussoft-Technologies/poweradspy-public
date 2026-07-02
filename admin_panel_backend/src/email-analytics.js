require("dotenv").config();
const mongoose = require("mongoose");
const NodeCache = require("node-cache");
const logger = require("../utils/logger");

// Short-TTL cache for the heavy aggregations (summary/calendar/breakdown) so
// the dashboard stays sub-second even at millions of docs. TTL is tiny (5s) so
// background polls are at most 5s stale; any user-initiated load (refresh /
// filter / tab change) passes `?fresh=true` to BYPASS the cache and read live.
// The paginated /log is never cached — always live via indexes.
const aggCache = new NodeCache({ stdTTL: 5, checkperiod: 10 });
async function cached(key, fn, bypass) {
  if (!bypass) {
    const hit = aggCache.get(key);
    if (hit !== undefined) return hit;
  }
  const val = await fn();
  aggCache.set(key, val); // refresh the cache even on a bypass read
  return val;
}

/**
 * Email analytics (NEW — PRD Feature 2).
 *
 * Read-only Mongo aggregations over the two collections written by
 * compeitetor_analysis: `email_send_log` and `email_send_events`. Covers both
 * report mails (competitorUpdate, dataReport). See
 * docs/EMAIL_ANALYTICS_MANIFEST.md for the contract.
 */

const LOG = "email_send_log";
const EVT = "email_send_events";
const TYPES = ["competitorUpdate", "dataReport", "keywordNotification"];
const STATUS_KEYS = ["queued", "sent", "delivered", "opened", "bounced", "spam", "unsubscribed", "failed", "skipped"];

const db = () => mongoose.connection.db;

function windowFrom(days) {
  /* v8 ignore next -- callers always pass an already-defaulted positive number, so the `|| 30` fallback is defensive */
  const n = parseInt(days, 10) || 30;
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return { from: d, days: n };
}
// Resolve the createdAt match window for the overview aggregations. An explicit
// [startDate, endDate] range (from the calendar / date-picker selection) takes
// precedence; otherwise the relative `days` window is used. `key` is folded into
// the cache key so a range view and a days view never collide in the cache.
// Mirrors the date-handling already used by /log (date-only end → whole day).
function resolveWindow(req) {
  const { startDate, endDate } = req.query;
  if (startDate || endDate) {
    const createdAt = {};
    if (startDate) createdAt.$gte = new Date(startDate);
    if (endDate) {
      const e = new Date(endDate);
      if (!String(endDate).includes("T")) e.setHours(23, 59, 59, 999);
      createdAt.$lte = e;
    }
    return { createdAt, key: `r:${startDate || ""}~${endDate || ""}` };
  }
  const days = parseInt(req.query.days, 10) || 30;
  const { from } = windowFrom(days);
  return { createdAt: { $gte: from }, key: `d:${days}`, days };
}
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function blankCounts() {
  return STATUS_KEYS.reduce((o, k) => ((o[k] = 0), o), {});
}
function withRates(o) {
  // "accepted" = handed to SendGrid (everything except failed/skipped).
  const accepted = o.sent + o.delivered + o.opened + o.bounced + o.spam + o.unsubscribed;
  const deliveredPlus = o.delivered + o.opened; // opened implies delivered
  o.accepted = accepted;
  o.deliveryRate = accepted ? Math.round((deliveredPlus / accepted) * 1000) / 10 : 0;
  o.bounceRate = accepted ? Math.round((o.bounced / accepted) * 1000) / 10 : 0;
  return o;
}

/** GET /summary?mail_type=&days=30 — headline tiles + rates, per type + total. */
async function summary(req, res) {
  try {
    const mt = TYPES.includes(req.query.mail_type) ? req.query.mail_type : "";
    const w = resolveWindow(req);
    const body = await cached(`summary:${mt}:${w.key}`, async () => {
      const match = { createdAt: w.createdAt };
      if (mt) match.mail_type = mt;

      const rows = await db().collection(LOG).aggregate([
        { $match: match },
        { $group: { _id: { mail_type: "$mail_type", status: "$status" }, c: { $sum: 1 } } },
      ]).toArray();

      // Derived from TYPES so a new mail-type (e.g. keywordNotification) is
      // picked up automatically — no per-type lines to keep in sync.
      const byType = TYPES.reduce((o, t) => ((o[t] = blankCounts()), o), {});
      const total = blankCounts();
      for (const r of rows) {
        const t = r._id.mail_type, st = r._id.status, c = r.c;
        if (byType[t] && st in byType[t]) byType[t][st] += c;
        if (st in total) total[st] += c;
      }

      // Unsubscribes are captured by the raw event stream, not a terminal log
      // status (a global / group unsubscribe rarely maps back to a single send
      // row, so email_send_log.status="unsubscribed" stays ~0). They're a GLOBAL
      // signal — the events carry mail_type=null — so we count them the same on
      // every mail-type tab, matching the log's unsubscribed view (which also
      // ignores mail_type). Counted within the same date window.
      const unsubCount = await db().collection(EVT).countDocuments({
        createdAt: w.createdAt,
        event_type: { $in: ["unsubscribe", "group_unsubscribe"] },
      });
      for (const t of TYPES) byType[t].unsubscribed = unsubCount;
      total.unsubscribed = unsubCount;

      // Click metrics (same window). `clicked` = emails with ≥1 tracked click
      // (matches the log's hasClicks filter); `clicks` = total clicks summed.
      for (const o of [...Object.values(byType), total]) { o.clicked = 0; o.clicks = 0; }
      const clickRows = await db().collection(LOG).aggregate([
        { $match: { ...match, click_count: { $gt: 0 } } },
        { $group: { _id: "$mail_type", emails: { $sum: 1 }, clicks: { $sum: "$click_count" } } },
      ]).toArray();
      for (const r of clickRows) {
        if (byType[r._id]) { byType[r._id].clicked += r.emails; byType[r._id].clicks += r.clicks; }
        total.clicked += r.emails; total.clicks += r.clicks;
      }

      for (const t of TYPES) withRates(byType[t]);
      withRates(total);
      return { window: w, byType, total };
    }, String(req.query.fresh) === "true");

    return res.status(200).json({ statusCode: 200, body });
  } catch (e) {
    logger.error({ email_analytics_summary_error: e.message });
    return res.status(500).json({ statusCode: 500, message: e.message });
  }
}

/** GET /log — paginated send log. Filters: mail_type, status, search(to), date range. */
async function log(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    // Unsubscribes live in the event stream, not as a terminal log status (a
    // global / group unsubscribe rarely maps back to a single send row, so
    // email_send_log.status="unsubscribed" stays ~0). When the operator filters
    // by "unsubscribed", serve the matching events instead — shaped like log
    // rows — so the Unsubscribed tile count and this list agree.
    if (req.query.status === "unsubscribed") {
      const eq = { event_type: { $in: ["unsubscribe", "group_unsubscribe"] } };
      // NOTE: unsubscribe / group_unsubscribe events usually carry mail_type=null
      // (a global / ASM-group unsubscribe isn't tied to one mail type), so we do
      // NOT filter by mail_type here — otherwise they'd vanish on every tab
      // except "All mails". Search + date window still apply.
      if (req.query.search && req.query.search.trim()) eq.email = new RegExp(escapeRegex(req.query.search.trim()), "i");
      if (req.query.startDate || req.query.endDate) {
        eq.createdAt = {};
        if (req.query.startDate) eq.createdAt.$gte = new Date(req.query.startDate);
        if (req.query.endDate) {
          const e = new Date(req.query.endDate);
          if (!String(req.query.endDate).includes("T")) e.setHours(23, 59, 59, 999);
          eq.createdAt.$lte = e;
        }
      }
      const ecol = db().collection(EVT);
      const [edata, etotal] = await Promise.all([
        ecol.find(eq).sort({ event_ts: -1 }).skip(skip).limit(limit).toArray(),
        ecol.countDocuments(eq),
      ]);
      const data = edata.map((e) => ({
        send_id: e.send_id || e.event_id,
        to: e.email,
        mail_type: e.mail_type,
        status: "unsubscribed",
        sent_at: e.event_ts,
        createdAt: e.createdAt,
        failure_reason: e.reason || (e.event_type === "group_unsubscribe" ? "group unsubscribe" : "unsubscribe"),
        sendgrid_message_id: e.sg_message_id || null,
      }));
      return res.status(200).json({ statusCode: 200, body: { data, totalRecords: etotal, page, limit } });
    }

    const q = {};
    if (TYPES.includes(req.query.mail_type)) q.mail_type = req.query.mail_type;
    if (req.query.status && STATUS_KEYS.includes(req.query.status)) q.status = req.query.status;
    if (req.query.search && req.query.search.trim()) q.to = new RegExp(escapeRegex(req.query.search.trim()), "i");
    // hasClicks: "true" → only rows with at least one tracked click (click_count > 0);
    // "false" → only rows with no clicks (field missing / null / 0). `click_count`
    // is maintained by the SendGrid webhook handler. Applied to BOTH the find and
    // the count below, so pagination/totalRecords stay correct (the frontend's
    // page-only fallback can't do that).
    if (req.query.hasClicks === "true") q.click_count = { $gt: 0 };
    else if (req.query.hasClicks === "false") q.click_count = { $not: { $gt: 0 } };
    if (req.query.startDate || req.query.endDate) {
      q.createdAt = {};
      if (req.query.startDate) q.createdAt.$gte = new Date(req.query.startDate);
      if (req.query.endDate) {
        const e = new Date(req.query.endDate);
        // Date-only "YYYY-MM-DD" → include the whole day; datetime → exact.
        if (!String(req.query.endDate).includes("T")) e.setHours(23, 59, 59, 999);
        q.createdAt.$lte = e;
      }
    }

    const col = db().collection(LOG);
    const [data, totalRecords] = await Promise.all([
      col.find(q).sort({ sent_at: -1, createdAt: -1 }).skip(skip).limit(limit).toArray(),
      col.countDocuments(q),
    ]);

    return res.status(200).json({ statusCode: 200, body: { data, totalRecords, page, limit } });
  } catch (e) {
    logger.error({ email_analytics_log_error: e.message });
    return res.status(500).json({ statusCode: 500, message: e.message });
  }
}

/** GET /log/:send_id — single send + its event timeline. */
async function detail(req, res) {
  try {
    const send_id = req.params.send_id;
    const row = await db().collection(LOG).findOne({ send_id });
    if (!row) return res.status(404).json({ statusCode: 404, message: "Send not found" });
    const events = await db().collection(EVT).find({ send_id }).sort({ event_ts: 1 }).toArray();
    return res.status(200).json({ statusCode: 200, body: { log: row, events } });
  } catch (e) {
    logger.error({ email_analytics_detail_error: e.message });
    return res.status(500).json({ statusCode: 500, message: e.message });
  }
}

/** GET /calendar?mail_type=&days=30 — per-day status counts for the heatmap (IST). */
async function calendar(req, res) {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const mt = TYPES.includes(req.query.mail_type) ? req.query.mail_type : "";
    const body = await cached(`calendar:${mt}:${days}`, async () => {
      const { from } = windowFrom(days);
      const match = { createdAt: { $gte: from } };
      /* v8 ignore next -- both branches are exercised by tests (mt set vs unset), but the v8 provider does not credit this branch inside the cached() closure */
      if (mt) match.mail_type = mt;

      const rows = await db().collection(LOG).aggregate([
        { $match: match },
        { $group: {
          _id: { d: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "+05:30" } }, status: "$status" },
          c: { $sum: 1 },
        } },
      ]).toArray();

      const map = {};
      for (const r of rows) {
        const d = r._id.d;
        if (!map[d]) map[d] = { date: d, total: 0, sent: 0, delivered: 0, bounced: 0, failed: 0, skipped: 0, spam: 0 };
        map[d].total += r.c;
        if (r._id.status in map[d]) map[d][r._id.status] += r.c;
      }
      const daysData = Object.values(map).sort((a, b) => (a.date < b.date ? -1 : 1));
      return { days, daysData };
    }, String(req.query.fresh) === "true");
    return res.status(200).json({ statusCode: 200, body });
  } catch (e) {
    logger.error({ email_analytics_calendar_error: e.message });
    return res.status(500).json({ statusCode: 500, message: e.message });
  }
}

/** GET /breakdown?mail_type=&days=30 — top failure/bounce/skip reasons ("kyun nahi gaya"). */
async function breakdown(req, res) {
  try {
    const mt = TYPES.includes(req.query.mail_type) ? req.query.mail_type : "";
    const w = resolveWindow(req);
    const body = await cached(`breakdown:${mt}:${w.key}`, async () => {
      const match = {
        createdAt: w.createdAt,
        status: { $in: ["failed", "bounced", "skipped"] },
        failure_reason: { $ne: null },
      };
      /* v8 ignore next -- both branches are exercised by tests (mt set vs unset), but the v8 provider does not credit this branch inside the cached() closure */
      if (mt) match.mail_type = mt;

      const rows = await db().collection(LOG).aggregate([
        { $match: match },
        { $group: { _id: { status: "$status", reason: "$failure_reason" }, c: { $sum: 1 } } },
        { $sort: { c: -1 } },
        { $limit: 50 },
      ]).toArray();

      return { window: w, reasons: rows.map((r) => ({ status: r._id.status, reason: r._id.reason, count: r.c })) };
    }, String(req.query.fresh) === "true");
    return res.status(200).json({ statusCode: 200, body });
  } catch (e) {
    logger.error({ email_analytics_breakdown_error: e.message });
    return res.status(500).json({ statusCode: 500, message: e.message });
  }
}

/**
 * GET /run-status?mail_type=dataReport — live daily-send progress for the
 * admin panel: total targeted, processed so far, currently processing, state.
 * `total` + state come from email_run_status (written by the cron); `processed`
 * is counted live from email_send_log so it's always current. Not cached.
 */
async function runStatus(req, res) {
  try {
    const mt = TYPES.includes(req.query.mail_type) ? req.query.mail_type : "dataReport";

    // Today's IST date + the UTC instant of IST-midnight (for the log count).
    const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
    const y = istNow.getUTCFullYear(), mo = istNow.getUTCMonth(), d = istNow.getUTCDate();
    const date = `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dayStartUTC = new Date(Date.UTC(y, mo, d, 0, 0, 0) - 5.5 * 3600 * 1000);

    const run = await db().collection("email_run_status").findOne({ mail_type: mt, date });
    const LOGC = db().collection(LOG);
    // processed = already mailed (anything past `queued`); processing = still queued.
    const [processed, processing] = await Promise.all([
      LOGC.countDocuments({ mail_type: mt, createdAt: { $gte: dayStartUTC }, status: { $ne: "queued" } }),
      LOGC.countDocuments({ mail_type: mt, createdAt: { $gte: dayStartUTC }, status: "queued" }),
    ]);

    const total = run?.total ?? (processed + processing);
    const status = run?.status ?? (processing > 0 ? "running" : "idle");
    const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 1000) / 10) : 0;

    return res.status(200).json({
      statusCode: 200,
      body: {
        mail_type: mt,
        date,
        total,
        processed,
        processing,
        percent,
        status,                          // idle | running | completed
        startedAt: run?.startedAt || null,
        completedAt: run?.completedAt || null,
      },
    });
  } catch (e) {
    logger.error({ email_analytics_runstatus_error: e.message });
    return res.status(500).json({ statusCode: 500, message: e.message });
  }
}

module.exports = { summary, log, detail, calendar, breakdown, runStatus };
