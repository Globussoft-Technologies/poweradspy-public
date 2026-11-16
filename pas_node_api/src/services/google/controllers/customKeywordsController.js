'use strict';

/**
 * Google custom keywords (MongoDB) — user-uploaded keyword list that a scraper works through.
 *
 *   User (JWT)
 *     GET  /api/v1/google/custom-keywords/sample   download the template (?format=xlsx|csv, default xlsx)
 *     POST /api/v1/google/custom-keywords/upload   multipart `file` (.csv or .xlsx, one `keyword` column)
 *     GET  /api/v1/google/custom-keywords          the caller's own keywords + status
 *   Scraper (no JWT, `x-scraper-name` header)
 *     GET  /api/v1/google/custom-keywords/scraper/keywords   take keywords (?size=, ?keyword=) or look (?status=)
 *     POST /api/v1/google/custom-keywords/scraper/results    report each keyword as done / no_ads_found / failed
 *
 * One document per (userId, keywordNorm). status: pending → in_progress → done | no_ads_found | failed.
 * A failed keyword goes back to pending (after retryDelayMinutes) until maxAttempts is reached.
 * A keyword stuck in_progress longer than staleClaimMinutes is handed out again — no cron needed.
 * Everything is controlled by config.customKeywords; disabled (the default) = every endpoint 503.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const ExcelJS = require('exceljs');
const dbManager = require('../../../database/DatabaseManager');
const logger = require('../../../logger');
const config = require('../../../config');
const { normCustomKeyword, customKeywordAllowed } = require('../insertion/normalize');

const log = logger.createChild('google-custom-keywords');

const SCRAPER_STATUSES = { done: 'done', completed: 'done', no_ads_found: 'no_ads_found', failed: 'failed' };
const CHUNK = 1000;

// ── Collection + one-time index bootstrap ─────────────────────────────────────
let indexesReady = null;

function getCollection() {
  const cfg = config.customKeywords;
  const ks = config.keywordSearch;
  const conn = dbManager.getMongo(cfg.mongoSlug || ks.mongoSlug);
  if (!conn) return null;
  const dbName = cfg.database || ks.database;
  const db = dbName ? conn.client.db(dbName) : conn.db;
  return db.collection(cfg.collection);
}

function ensureIndexes(col) {
  if (!indexesReady) {
    indexesReady = col.createIndexes([
      { key: { userId: 1, keywordNorm: 1 }, name: 'uniq_user_keyword', unique: true },
      { key: { status: 1, retryAfter: 1, createdAt: 1 }, name: 'claim_queue' },
      { key: { userId: 1, createdAt: -1 }, name: 'user_list' },
      { key: { claimedBy: 1, claimedAt: -1 }, name: 'scraper_history' },
      { key: { keywordNorm: 1 }, name: 'by_keyword' },
    ]).catch((err) => { indexesReady = null; throw err; });
  }
  return indexesReady;
}

// ── Who owns a keyword: used when the scraper inserts an ad with only `custom_keyword` ──────────
// Every user who uploaded a keyword (and is allowed to use the feature) gets the ad. Takes a list of
// keywords and returns a Map keyword -> [user ids]. Cached for a
// short time so a scraper inserting many ads for one keyword does not query Mongo for each ad.
const OWNERS_TTL_MS = 30000;
const OWNERS_CACHE_MAX = 2000;
const ownersCache = new Map(); // keywordNorm -> { at, ids }

async function findKeywordOwners(keywordNorms) {
  const wanted = [...new Set([].concat(keywordNorms))];
  const owners = new Map();
  const missing = [];
  const now = Date.now();
  for (const k of wanted) {
    const hit = ownersCache.get(k);
    if (hit && now - hit.at < OWNERS_TTL_MS) owners.set(k, hit.ids); else missing.push(k);
  }
  if (missing.length) {
    const col = getCollection();
    if (!col) throw new Error('custom keywords database unavailable');
    await ensureIndexes(col);
    const rows = await col.find({ keywordNorm: { $in: missing } }, { projection: { userId: 1, keywordNorm: 1 } }).toArray();
    const byKeyword = new Map(missing.map((k) => [k, new Set()]));
    for (const r of rows) byKeyword.get(r.keywordNorm)?.add(r.userId);
    for (const k of missing) {
      const ids = [...byKeyword.get(k)].filter((id) => customKeywordAllowed(config.customKeywords, id));
      if (ownersCache.size >= OWNERS_CACHE_MAX) ownersCache.delete(ownersCache.keys().next().value);
      ownersCache.set(k, { at: now, ids });
      owners.set(k, ids);
    }
  }
  return owners;
}

// Express middleware for the user routes (after authMiddleware): feature off -> 503; a user who is
// not in customKeywords.allowedUserIds gets a plain 404, so the feature leaves no trace for them.
function requireAccess(req, res, next) {
  const cfg = config.customKeywords;
  if (!cfg.enabled) return res.status(503).json({ code: 503, message: 'custom keywords feature is not enabled', data: null });
  if (!customKeywordAllowed(cfg, req.user?.user_id ?? req.user?.id)) {
    return res.status(404).json({ code: 404, status: 'rejected', message: 'Not found.' });
  }
  return next();
}

// GET /custom-keywords/access — the one ungated user route: tells the frontend whether to show the feature.
function accessProbe(req, res) {
  res.json({ code: 200, status: 'ok', message: 'Access.', data: { enabled: customKeywordAllowed(config.customKeywords, req.user?.user_id ?? req.user?.id) } });
}

// Returns the collection (indexes ready) or sends the error response and returns null.
async function useCollection(res) {
  if (!config.customKeywords.enabled) {
    res.status(503).json({ code: 503, message: 'custom keywords feature is not enabled', data: null });
    return null;
  }
  const col = getCollection();
  if (!col) {
    res.status(503).json({ code: 503, message: 'custom keywords database unavailable', data: null });
    return null;
  }
  await ensureIndexes(col);
  return col;
}

const normKeyword = normCustomKeyword;
const userIdOf = (req) => {
  const id = Number(req.user?.user_id ?? req.user?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
};
const publicDoc = (d) => ({
  id: String(d._id), keyword: d.keyword, status: d.status, attempts: d.attempts || 0,
  lastError: d.lastError || null, createdAt: d.createdAt, completedAt: d.completedAt || null,
});

// ── Upload middleware: .csv or .xlsx only, size capped, friendly errors ───────
const ALLOWED_EXT = ['.csv', '.xlsx'];

// The message a user sees for any other file type.
function unsupportedTypeMessage(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (ext === '.xls') return 'Old Excel files (.xls) are not supported. Open it in Excel, save it as .xlsx or .csv, and upload again.';
  return `Unsupported file type${ext ? ` "${ext}"` : ''}. Only .csv and .xlsx files are allowed. Download the sample sheet and upload it in one of those formats.`;
}

const upload = multer({
  dest: path.join(os.tmpdir(), 'pas-custom-keywords'),
  limits: { fileSize: config.customKeywords.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_EXT.includes(path.extname(file.originalname || '').toLowerCase())) return cb(null, true);
    req.invalidFileName = file.originalname || '';
    return cb(null, false);
  },
}).single('file');

const uploadMiddleware = (req, res, next) => upload(req, res, (err) => {
  if (!err) return next();
  const message = err.code === 'LIMIT_FILE_SIZE'
    ? `The file is too large. Please upload a .csv or .xlsx file under ${config.customKeywords.maxUploadMb} MB.`
    : 'We could not read the uploaded file. Please upload the sample sheet as .csv or .xlsx.';
  return res.status(400).json({ code: 400, message, data: null });
});

// ── GET /custom-keywords/sample?format=xlsx|csv (default xlsx) ────────────────
const SAMPLE_KEYWORDS = ['nike running shoes', 'best crm software', 'gym bag'];

async function downloadSample(req, res) {
  const format = String(req.query?.format || 'xlsx').toLowerCase();
  if (format !== 'xlsx' && format !== 'csv') {
    return res.status(400).json({ code: 400, message: "format must be 'xlsx' or 'csv'", data: null });
  }

  if (format === 'csv') {
    // UTF-8 BOM so Excel opens it with the right encoding; the reader accepts it again.
    const body = `\uFEFFkeyword\r\n${SAMPLE_KEYWORDS.join('\r\n')}\r\n`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="custom-keywords-sample.csv"');
    return res.send(body);
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Keywords');
  ws.columns = [{ header: 'keyword', key: 'keyword', width: 40 }];
  ws.getRow(1).font = { bold: true };
  SAMPLE_KEYWORDS.forEach((k) => ws.addRow({ keyword: k }));

  const help = wb.addWorksheet('Instructions');
  help.getColumn(1).width = 90;
  [
    'Fill the "keyword" column on the Keywords sheet, one keyword per row.',
    'Delete the three example rows before uploading.',
    `Up to ${config.customKeywords.maxRowsPerUpload} keywords per file, each up to ${config.customKeywords.maxKeywordLength} characters.`,
    'Duplicate keywords are ignored. Upload it as .xlsx or .csv from the Custom Keyword button.',
  ].forEach((line) => help.addRow([line]));

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="custom-keywords-sample.xlsx"');
  return res.send(Buffer.from(buf));
}

// ── Content check: the extension alone can be faked (a PDF renamed to .csv), so look at the bytes ──
// Returns an error message, or '' when the file really is what its extension says.
function checkFileContent(filePath, ext) {
  const fd = fs.openSync(filePath, 'r');
  let buf;
  try {
    const raw = Buffer.alloc(4096);
    buf = raw.subarray(0, fs.readSync(fd, raw, 0, raw.length, 0));
  } finally { fs.closeSync(fd); }

  if (buf.length === 0) return 'The file is empty. Please add your keywords and upload it again.';
  const startsWith = (...bytes) => bytes.every((b, i) => buf[i] === b);
  const isZip = startsWith(0x50, 0x4b, 0x03, 0x04); // .xlsx is a zip
  const isOldExcel = startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1); // legacy .xls / .doc
  if (String(ext).toLowerCase() === '.xlsx') {
    if (isZip) return '';
    if (isOldExcel) return 'This is an old Excel (.xls) file saved with an .xlsx name. Open it in Excel and save it as .xlsx or .csv.';
    return 'This is not a valid Excel (.xlsx) file. Open your sheet in Excel and save it as .xlsx, or upload a .csv file.';
  }
  // .csv must be plain text: no zip/old-Excel signature and no binary (NUL) bytes.
  if (isZip) return 'This is an Excel file saved with a .csv name. Rename it to .xlsx, or export your sheet as CSV.';
  if (isOldExcel) return 'This is an old Excel (.xls) file saved with a .csv name. Open it in Excel and export it as CSV.';
  // PDF, PNG, JPEG, GIF, program (MZ) and gzip files are caught by their first bytes even when they have no NUL byte early on.
  const isOtherFile = startsWith(0x25, 0x50, 0x44, 0x46) || startsWith(0x89, 0x50, 0x4e, 0x47) || startsWith(0xff, 0xd8, 0xff)
    || startsWith(0x47, 0x49, 0x46, 0x38) || startsWith(0x4d, 0x5a) || startsWith(0x1f, 0x8b);
  if (isOtherFile || buf.includes(0)) return 'This is not a text CSV file (it looks like a PDF, image, program or other binary file, or UTF-16 text). Export your sheet as "CSV UTF-8" and upload again.';
  return '';
}

// ── File parsing (.csv or .xlsx): first sheet, header row must contain a "keyword" column ──
// Excel in some locales saves CSV with ';' (or tabs): pick the delimiter from the header line.
function sniffCsvDelimiter(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(2048);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const head = buf.toString('utf8', 0, n).replace(/^\uFEFF/, '').split(/\r?\n/)[0] || '';
    if (head.includes(',')) return ',';
    if (head.includes(';')) return ';';
    if (head.includes('\t')) return '\t';
    return ',';
  } finally { fs.closeSync(fd); }
}

async function readKeywordRows(filePath, ext = '.xlsx') {
  const wb = new ExcelJS.Workbook();
  if (String(ext).toLowerCase() === '.csv') {
    await wb.csv.readFile(filePath, { parserOptions: { delimiter: sniffCsvDelimiter(filePath) } });
  } else {
    await wb.xlsx.readFile(filePath);
  }
  const ws = wb.worksheets[0];
  if (!ws) return { error: 'The file has no data.' };

  let col = 0;
  ws.getRow(1).eachCell((cell, n) => {
    if (!col && String(cell.text || '').trim().toLowerCase() === 'keyword') col = n;
  });
  if (!col) return { error: 'The first row must have a column named "keyword". Please use the sample sheet.' };

  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const value = String(row.getCell(col).text || '').trim().replace(/\s+/g, ' ');
    if (value) rows.push({ row: n, value });
  });
  return { rows };
}

// ── POST /custom-keywords/upload ──────────────────────────────────────────────
async function uploadKeywords(req, res) {
  const filePath = req.file?.path;
  const cleanup = () => { if (filePath) fs.unlink(filePath, () => {}); };
  try {
    const col = await useCollection(res);
    if (!col) return;
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ code: 401, message: 'Unauthorized', data: null });
    if (req.invalidFileName !== undefined) return res.status(400).json({ code: 400, message: unsupportedTypeMessage(req.invalidFileName), data: null });
    if (!req.file) return res.status(400).json({ code: 400, message: 'No file uploaded. Send a .csv or .xlsx file in the "file" field.', data: null });

    const fileExt = path.extname(req.file.originalname || '');
    const contentError = checkFileContent(filePath, fileExt);
    if (contentError) return res.status(400).json({ code: 400, message: contentError, data: null });

    let parsed;
    try { parsed = await readKeywordRows(filePath, fileExt); } catch (e) {
      return res.status(400).json({ code: 400, message: 'We could not read this file. Please upload the sample sheet saved as .csv or .xlsx.', data: null });
    }
    if (parsed.error) return res.status(400).json({ code: 400, message: parsed.error, data: null });

    const { maxRowsPerUpload, maxKeywordLength, maxKeywordsPerUser } = config.customKeywords;
    if (parsed.rows.length === 0) return res.status(400).json({ code: 400, message: 'The "keyword" column is empty.', data: null });
    if (parsed.rows.length > maxRowsPerUpload) {
      return res.status(400).json({ code: 400, message: `Too many rows: ${parsed.rows.length}. The limit is ${maxRowsPerUpload} keywords per file.`, data: null });
    }

    const invalid = [];
    const seen = new Set();
    let duplicatesInFile = 0;
    const clean = [];
    // One result per keyword in the sheet, in sheet order: added | duplicate | invalid | not_added.
    const items = [];
    for (const r of parsed.rows) {
      if (r.value.length > maxKeywordLength) {
        const reason = `longer than ${maxKeywordLength} characters`;
        invalid.push({ row: r.row, keyword: r.value.slice(0, 40) + '…', reason });
        items.push({ row: r.row, keyword: r.value.slice(0, 60) + '…', result: 'invalid', reason });
        continue;
      }
      const keywordNorm = normKeyword(r.value);
      if (seen.has(keywordNorm)) {
        duplicatesInFile += 1;
        items.push({ row: r.row, keyword: r.value, result: 'duplicate', reason: 'repeated in your file' });
        continue;
      }
      seen.add(keywordNorm);
      const item = { row: r.row, keyword: r.value, result: 'added' }; // decided below once the database has answered
      items.push(item);
      clean.push({ keyword: r.value, keywordNorm, item });
    }

    const existing = await col.countDocuments({ userId });
    const room = Math.max(0, maxKeywordsPerUser - existing);
    if (room === 0) return res.status(400).json({ code: 400, message: `You have reached the limit of ${maxKeywordsPerUser} keywords.`, data: null });
    const toInsert = clean.slice(0, room);
    const overLimit = clean.length - toInsert.length;
    for (const k of clean.slice(room)) { k.item.result = 'not_added'; k.item.reason = `over your limit of ${maxKeywordsPerUser} keywords`; }

    const now = new Date();
    let inserted = 0;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const ops = toInsert.slice(i, i + CHUNK).map((k) => ({
        updateOne: {
          filter: { userId, keywordNorm: k.keywordNorm },
          update: {
            $setOnInsert: {
              userId, keyword: k.keyword, keywordNorm: k.keywordNorm, status: 'pending',
              attempts: 0, retryAfter: 0, lastError: null, claimedBy: null, claimedAt: null,
              completedAt: null, createdAt: now,
            },
          },
          upsert: true,
        },
      }));
      const r = await col.bulkWrite(ops, { ordered: false });
      inserted += r.upsertedCount || 0;
      // Which of this batch were really new? upsertedIds is keyed by the operation's position in the batch.
      // (Without it, fall back to the counts: all new, none new, or the first `upsertedCount`.)
      const isNew = r.upsertedIds
        ? (idx) => Object.prototype.hasOwnProperty.call(r.upsertedIds, idx)
        : (idx) => idx < (r.upsertedCount || 0);
      ops.forEach((_, idx) => {
        const item = toInsert[i + idx].item;
        if (!isNew(idx)) { item.result = 'duplicate'; item.reason = 'already in your list'; }
      });
    }
    const alreadyExisting = toInsert.length - inserted;

    return res.json({
      code: 200,
      message: `${inserted} keyword(s) added`,
      data: {
        received: parsed.rows.length, added: inserted,
        duplicates: duplicatesInFile + alreadyExisting,
        invalid, notAddedOverLimit: overLimit,
        items,
      },
    });
  } catch (err) {
    log.error('uploadKeywords failed', { error: err.message });
    return res.status(500).json({ code: 500, message: 'Could not save the keywords. Please try again.', data: null });
  } finally {
    cleanup();
  }
}

// ── GET /custom-keywords — the caller's own keywords ──────────────────────────
async function listMyKeywords(req, res) {
  try {
    const col = await useCollection(res);
    if (!col) return;
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ code: 401, message: 'Unauthorized', data: null });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.page_size, 10) || 50));
    const filter = { userId };
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.q) filter.keywordNorm = { $regex: '^' + normKeyword(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') };

    const [items, total, counts] = await Promise.all([
      col.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
      col.countDocuments(filter),
      col.aggregate([{ $match: { userId } }, { $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
    ]);
    return res.json({
      code: 200, message: 'ok',
      data: { items: items.map(publicDoc), page, pageSize, total, counts: toCounts(counts) },
    });
  } catch (err) {
    log.error('listMyKeywords failed', { error: err.message });
    return res.status(500).json({ code: 500, message: 'Could not load your keywords.', data: null });
  }
}

function toCounts(rows) {
  const out = { pending: 0, in_progress: 0, done: 0, no_ads_found: 0, failed: 0 };
  for (const r of rows) out[r._id] = r.n;
  return out;
}

// Same identity the existing keyword-search /work endpoint uses: the configured scraper header
// (config.keywordSearch.scraperHeader, default x-scraper-name), or `scraper` in the body or query string.
function scraperName(req, res) {
  const header = config.keywordSearch.scraperHeader;
  const owner = String(req.get(header) || (req.body && req.body.scraper) || (req.query && req.query.scraper) || '').trim().slice(0, 100);
  if (!owner) {
    res.status(400).json({ code: 400, message: `header '${header}' (your unique scraper name) is required`, data: null });
    return null;
  }
  return owner;
}

// ── Scraper API: ONE GET to fetch keywords, ONE POST to send back how they went ─────────────
//   GET  /custom-keywords/scraper/keywords   take keywords (or just look at the queue)
//   POST /custom-keywords/scraper/results    report each keyword as done / no_ads_found / failed
const KEYWORD_STATUSES = ['pending', 'in_progress', 'done', 'no_ads_found', 'failed'];
const unwrapDoc = (r) => (r && r.value !== undefined ? r.value : r); // driver v6+ returns the doc itself

// With an allow-list only keywords owned by allowed users are handed out or listed.
function ownerFilterFor(cfg) {
  const allowedIds = (cfg.allowedUserIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return (cfg.allowedUserIds || []).length ? { userId: { $in: allowedIds } } : {};
}

// Close what this scraper held for one keyword (every user's entry for it). A failed keyword goes back
// to pending (after retryDelayMinutes) until maxAttempts, then it stays failed.
async function closeKeywordDocs(col, owner, docs, outcome, error, now) {
  const cfg = config.customKeywords;
  let closed = null;
  const userIds = []; // owners whose entry was really closed here (they are the ones to notify)
  for (const d of docs) {
    let set;
    if (outcome === 'failed') {
      const retry = (d.attempts || 0) < cfg.maxAttempts;
      set = {
        status: retry ? 'pending' : 'failed',
        retryAfter: retry ? now.getTime() + cfg.retryDelayMinutes * 60000 : 0,
        lastError: String(error || 'scrape failed').slice(0, 300),
        completedAt: retry ? null : now,
      };
    } else {
      set = { status: outcome, completedAt: now, lastError: null };
    }
    // Only close it if it is still ours (a stale claim may have been handed to someone else).
    const r = await col.updateOne({ _id: d._id, claimedBy: owner, status: 'in_progress' }, { $set: set });
    if (r.modifiedCount) {
      userIds.push(d.userId);
      if (!closed) closed = { id: String(d._id), keyword: d.keyword, status: set.status };
    }
  }
  return closed && { ...closed, userIds };
}

// Tell the owners their keyword has been scraped (bell + push). Fire and forget: it never delays or fails
// the scraper's request, and any problem is only logged.
function notifyOwnersScraped({ userIds, keyword }) {
  try {
    Promise.resolve(
      require('../../common/controllers/keywordAdNotificationController')
        .notifyCustomKeywordScraped({ userIds, keyword, keywordNorm: normKeyword(keyword) })
    ).catch((e) => log.warn('custom keyword notification failed', { error: e.message }));
  } catch (e) {
    log.warn('custom keyword notification failed', { error: e.message });
  }
}

// Take keywords for this scraper: the exact ones named (`wanted`), or the oldest waiting ones (`size`).
async function takeKeywords(col, owner, { size, wanted }, now) {
  const cfg = config.customKeywords;
  const ownerFilter = ownerFilterFor(cfg);
  const staleBefore = new Date(now.getTime() - cfg.staleClaimMinutes * 60000);
  const claim = { $set: { status: 'in_progress', claimedBy: owner, claimedAt: now }, $inc: { attempts: 1 } };
  const pick = { sort: { createdAt: 1, _id: 1 }, returnDocument: 'after' };
  // waiting in the queue: pending (retry delay passed), or a claim nobody finished for too long
  const queueReady = { $or: [{ status: 'pending', retryAfter: { $lte: now.getTime() } }, { status: 'in_progress', claimedAt: { $lt: staleBefore } }] };
  // asked for by name: anything not currently being scraped (this also allows scraping a done keyword again)
  const notBusy = { $or: [{ status: { $ne: 'in_progress' } }, { status: 'in_progress', claimedAt: { $lt: staleBefore } }] };

  const data = [];
  const skipped = [];
  // The other users' entries for the same keyword go with it, so it is scraped once for everyone.
  const takeWithSiblings = async (doc, readyFilter) => {
    await col.updateMany({ keywordNorm: doc.keywordNorm, _id: { $ne: doc._id }, ...ownerFilter, ...readyFilter }, claim);
    data.push({ id: String(doc._id), keyword: doc.keyword, attempt: doc.attempts });
  };
  if (wanted) {
    for (const key of wanted) {
      const doc = unwrapDoc(await col.findOneAndUpdate({ keywordNorm: key, ...ownerFilter, ...notBusy }, claim, pick));
      if (doc) await takeWithSiblings(doc, notBusy);
      else skipped.push({ keyword: key, reason: (await col.findOne({ keywordNorm: key, ...ownerFilter })) ? 'in_progress' : 'not_found' });
    }
  } else {
    for (let i = 0; i < size; i += 1) {
      const doc = unwrapDoc(await col.findOneAndUpdate({ ...ownerFilter, ...queueReady }, claim, pick));
      if (!doc) break;
      await takeWithSiblings(doc, queueReady);
    }
  }
  return { data, skipped };
}

// Read and check the GET query. Returns { error } or { size, wanted }.
function parseTakeQuery(query) {
  const cfg = config.customKeywords;
  const out = { size: 1, wanted: null };
  if (query.size !== undefined && query.size !== '') {
    const n = Number(query.size);
    if (!Number.isInteger(n) || n < 0 || n > cfg.maxClaimSize) return { error: `size must be a whole number from 0 to ${cfg.maxClaimSize}` };
    out.size = n;
  }
  const raw = query.keyword !== undefined ? query.keyword : query.keywords;
  if (raw !== undefined) {
    // Repeat the parameter for several keywords (keyword=a&keyword=b). Commas are NOT separators: a keyword may contain one.
    const list = [...new Set([].concat(raw).map(normKeyword).filter(Boolean))];
    if (!list.length || list.length > cfg.maxClaimSize) return { error: `keyword must be 1 to ${cfg.maxClaimSize} keywords (repeat the parameter: keyword=a&keyword=b)` };
    out.wanted = list;
  }
  return out;
}

// ── GET /custom-keywords/scraper/keywords ────────────────────────────────────────
//   ?size=5                        take up to 5 waiting keywords (default 1; 0 = take nothing)
//   ?keyword=gym bag&keyword=...   take exactly these keywords (repeat the parameter; any case;
//                                  a keyword that is already done is scraped again)
//   ?status=pending|in_progress|done|no_ads_found|failed[&limit=50&page=1]
//                                  only LOOK: list the keywords with that status, take nothing
// Taking a keyword marks it in_progress for this scraper (like the existing keyword-search GET /next).
async function getScraperKeywords(req, res) {
  try {
    const col = await useCollection(res);
    if (!col) return;
    const owner = scraperName(req, res);
    if (!owner) return;
    if (typeof res.setHeader === 'function') res.setHeader('Cache-Control', 'no-store');
    const query = req.query || {};
    if (query.status !== undefined) return await listKeywords(col, query, res, owner);

    const parsed = parseTakeQuery(query);
    if (parsed.error) return res.status(400).json({ code: 400, message: parsed.error, data: null });
    const { data, skipped } = await takeKeywords(col, owner, parsed, new Date());

    // Progress: entries still waiting (not counting what was just handed out) and all entries.
    const ownerFilter = ownerFilterFor(config.customKeywords);
    const [left, total] = await Promise.all([col.countDocuments({ status: 'pending', ...ownerFilter }), col.estimatedDocumentCount()]);
    let message = 'no pending keywords';
    if (data.length) message = 'claimed';
    else if (!parsed.wanted && parsed.size === 0) message = 'ok';
    else if (skipped.length) message = 'no keywords taken';
    return res.json({ code: 200, message, scraper: owner, data, skipped, left, total });
  } catch (err) {
    log.error('getScraperKeywords failed', { error: err.message });
    return res.status(500).json({ code: 500, message: 'Could not get keywords.', data: null });
  }
}

// What is waiting, what is done: one row per distinct keyword with the given status, plus the counts of
// every status. User ids are never shown; `owners` is how many users uploaded the keyword.
async function listKeywords(col, query, res, owner) {
  const status = String(query.status || 'pending').toLowerCase();
  if (!KEYWORD_STATUSES.includes(status)) return res.status(400).json({ code: 400, message: `status must be one of ${KEYWORD_STATUSES.join(', ')}`, data: null });
  const pageSize = Math.min(200, Math.max(1, parseInt(query.limit ?? query.page_size, 10) || 50));
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const ownerFilter = ownerFilterFor(config.customKeywords);

  const [countRows, listed] = await Promise.all([
    col.aggregate([{ $match: ownerFilter }, { $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
    col.aggregate([
      { $match: { status, ...ownerFilter } },
      {
        $group: {
          _id: '$keywordNorm', keyword: { $first: '$keyword' }, owners: { $sum: 1 }, attempts: { $max: '$attempts' },
          since: { $min: '$createdAt' }, claimedBy: { $first: '$claimedBy' }, lastError: { $first: '$lastError' },
        },
      },
      { $facet: { items: [{ $sort: { since: 1, _id: 1 } }, { $skip: (page - 1) * pageSize }, { $limit: pageSize }], total: [{ $count: 'n' }] } },
    ]).toArray(),
  ]);
  const facet = (listed && listed[0]) || { items: [], total: [] };
  return res.json({
    code: 200, message: 'ok', scraper: owner, status, page, pageSize,
    total: (facet.total[0] && facet.total[0].n) || 0, // distinct keywords with this status
    counts: toCounts(countRows), // entries (one per user and keyword) per status
    data: facet.items.map((d) => ({
      keyword: d.keyword, owners: d.owners, attempts: d.attempts || 0, since: d.since,
      ...(status === 'in_progress' ? { claimedBy: d.claimedBy } : {}),
      ...(d.lastError ? { lastError: d.lastError } : {}),
    })),
  });
}

// Read and check the POST body. Returns { error } or { results } or { status, error }.
function parseResultsBody(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (b.results !== undefined) {
    if (!Array.isArray(b.results) || b.results.length === 0) return { error: 'results must be a non-empty list of { keyword, status }' };
    const results = [];
    for (const r of b.results) {
      const outcome = SCRAPER_STATUSES[String((r && r.status) || '').toLowerCase()];
      const key = normKeyword(r && r.keyword);
      if (!outcome || (!key && !(r && r.id))) return { error: "each result needs a keyword (or id) and a status of 'done', 'no_ads_found' or 'failed'" };
      results.push({ outcome, key, id: r.id ? String(r.id) : null, error: r.error });
    }
    return { results };
  }
  if (b.status !== undefined) {
    const outcome = SCRAPER_STATUSES[String(b.status).toLowerCase()];
    if (!outcome) return { error: "status must be 'done', 'no_ads_found' or 'failed'" };
    return { status: outcome, error: b.error };
  }
  return { error: "send results: [{ keyword, status }] — or status to close everything you hold" };
}

// ── POST /custom-keywords/scraper/results ────────────────────────────────────────
// Body: { results: [{ keyword | id, status: 'done'|'no_ads_found'|'failed', error? }, ...] }
//   or  { status, error }   closes EVERYTHING this scraper holds with that status.
// A keyword uploaded by several users is closed for all of them together. A scraper can only close
// keywords it holds; anything else comes back in `ignored`.
async function postScraperResults(req, res) {
  try {
    const col = await useCollection(res);
    if (!col) return;
    const owner = scraperName(req, res);
    if (!owner) return;
    const parsed = parseResultsBody(req.body);
    if (parsed.error) return res.status(400).json({ code: 400, message: parsed.error, data: null });

    const now = new Date();
    const held = await col.find({ claimedBy: owner, status: 'in_progress' }).toArray();
    const groups = [];
    const ignored = [];
    if (parsed.results) {
      for (const r of parsed.results) {
        const key = r.key || (held.find((d) => String(d._id) === r.id) || {}).keywordNorm;
        const docs = key ? held.filter((d) => d.keywordNorm === key) : [];
        if (docs.length) groups.push({ docs, outcome: r.outcome, error: r.error });
        else ignored.push({ keyword: r.key || r.id, reason: 'not_held' });
      }
    } else {
      const byKeyword = new Map();
      for (const d of held) byKeyword.set(d.keywordNorm, [...(byKeyword.get(d.keywordNorm) || []), d]);
      for (const docs of byKeyword.values()) groups.push({ docs, outcome: parsed.status, error: parsed.error });
    }
    const closed = [];
    const toNotify = [];
    for (const g of groups) {
      const c = await closeKeywordDocs(col, owner, g.docs, g.outcome, g.error, now);
      if (!c) { ignored.push({ keyword: g.docs[0].keyword, reason: 'not_held' }); continue; }
      const { userIds, ...entry } = c; // owners' ids are never part of the scraper's answer
      closed.push(entry);
      if (entry.status === 'done') toNotify.push({ userIds, keyword: entry.keyword });
    }
    // A keyword reported as done: tell its owners (only keywords really closed by this call, so a repeat does not notify twice).
    for (const n of toNotify) notifyOwnersScraped(n);
    return res.json({ code: 200, message: closed.length ? 'recorded' : 'nothing to close', scraper: owner, closed, ignored });
  } catch (err) {
    log.error('postScraperResults failed', { error: err.message });
    return res.status(500).json({ code: 500, message: 'Could not save the results.', data: null });
  }
}

module.exports = { findKeywordOwners, uploadMiddleware, requireAccess, accessProbe, downloadSample, uploadKeywords, listMyKeywords, getScraperKeywords, postScraperResults, _test: { normKeyword, readKeywordRows, unsupportedTypeMessage, checkFileContent, clearOwnersCache: () => ownersCache.clear() } };
