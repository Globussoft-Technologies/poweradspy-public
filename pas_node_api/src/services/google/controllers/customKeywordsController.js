'use strict';

/**
 * Google custom keywords (MongoDB) — user-uploaded keyword list that a scraper works through.
 *
 *   User (JWT)
 *     GET  /api/v1/google/custom-keywords/sample   download the template (?format=xlsx|csv, default xlsx)
 *     POST /api/v1/google/custom-keywords/upload   multipart `file` (.csv or .xlsx, one `keyword` column)
 *     GET  /api/v1/google/custom-keywords          the caller's own keywords + status
 *   Scraper (no JWT, `x-scraper-name` header)
 *     POST /api/v1/google/custom-keywords/next     close my last keyword, hand me the next one
 *                                                  (also says how many are left) — the only scraper call
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
    ]).catch((err) => { indexesReady = null; throw err; });
  }
  return indexesReady;
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
  if (buf.includes(0)) return 'This is not a text CSV file (it looks binary or UTF-16). Export your sheet as "CSV UTF-8" and upload again.';
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
    for (const r of parsed.rows) {
      if (r.value.length > maxKeywordLength) { invalid.push({ row: r.row, keyword: r.value.slice(0, 40) + '…', reason: `longer than ${maxKeywordLength} characters` }); continue; }
      const keywordNorm = normKeyword(r.value);
      if (seen.has(keywordNorm)) { duplicatesInFile += 1; continue; }
      seen.add(keywordNorm);
      clean.push({ keyword: r.value, keywordNorm });
    }

    const existing = await col.countDocuments({ userId });
    const room = Math.max(0, maxKeywordsPerUser - existing);
    if (room === 0) return res.status(400).json({ code: 400, message: `You have reached the limit of ${maxKeywordsPerUser} keywords.`, data: null });
    const toInsert = clean.slice(0, room);
    const overLimit = clean.length - toInsert.length;

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
    }
    const alreadyExisting = toInsert.length - inserted;

    return res.json({
      code: 200,
      message: `${inserted} keyword(s) added`,
      data: {
        received: parsed.rows.length, added: inserted,
        duplicates: duplicatesInFile + alreadyExisting,
        invalid, notAddedOverLimit: overLimit,
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
// (config.keywordSearch.scraperHeader, default x-scraper-name), or `scraper` in the body.
function scraperName(req, res) {
  const header = config.keywordSearch.scraperHeader;
  const owner = String(req.get(header) || req.body?.scraper || '').trim().slice(0, 100);
  if (!owner) {
    res.status(400).json({ code: 400, message: `header '${header}' (your unique scraper name) is required`, data: null });
    return null;
  }
  return owner;
}

// ── POST /custom-keywords/next — close my last keyword, claim the next ────────
// Body (all optional): { status: 'done' | 'no_ads_found' | 'failed', error: '<why it failed>' }
// Omitting status means the keyword I was working on finished fine ('done').
async function nextKeyword(req, res) {
  try {
    const col = await useCollection(res);
    if (!col) return;
    const owner = scraperName(req, res);
    if (!owner) return;

    const cfg = config.customKeywords;
    const now = new Date();
    let closed = null;

    // 1. Close what this scraper was working on (the one it still holds).
    const outcome = SCRAPER_STATUSES[String(req.body?.status || 'done').toLowerCase()];
    if (!outcome) return res.status(400).json({ code: 400, message: "status must be 'done', 'no_ads_found' or 'failed'", data: null });
    const held = await col.findOne({ claimedBy: owner, status: 'in_progress' }, { sort: { claimedAt: -1 } });
    if (held) {
      let set;
      if (outcome === 'failed') {
        const retry = (held.attempts || 0) < cfg.maxAttempts;
        set = {
          status: retry ? 'pending' : 'failed',
          retryAfter: retry ? now.getTime() + cfg.retryDelayMinutes * 60000 : 0,
          lastError: String(req.body?.error || 'scrape failed').slice(0, 300),
          completedAt: retry ? null : now,
        };
      } else {
        set = { status: outcome, completedAt: now, lastError: null };
      }
      // Only close it if it is still ours (a stale claim may have been handed to someone else).
      const r = await col.updateOne({ _id: held._id, claimedBy: owner, status: 'in_progress' }, { $set: set });
      if (r.modifiedCount) closed = { id: String(held._id), keyword: held.keyword, status: set.status };
    }

    // 2. Claim the next: oldest pending (retry delay passed) or a stale in_progress.
    //    With an allow-list, only keywords owned by allowed users are handed out.
    const owners = (cfg.allowedUserIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    const ownerFilter = (cfg.allowedUserIds || []).length ? { userId: { $in: owners } } : {};
    const staleBefore = new Date(now.getTime() - cfg.staleClaimMinutes * 60000);
    const doc = await col.findOneAndUpdate(
      {
        ...ownerFilter,
        $or: [
          { status: 'pending', retryAfter: { $lte: now.getTime() } },
          { status: 'in_progress', claimedAt: { $lt: staleBefore } },
        ],
      },
      { $set: { status: 'in_progress', claimedBy: owner, claimedAt: now }, $inc: { attempts: 1 } },
      { sort: { createdAt: 1, _id: 1 }, returnDocument: 'after' }
    );

    const claimed = doc?.value !== undefined ? doc.value : doc; // driver v6+ returns the doc itself
    // Progress for the scraper: keywords still waiting (not counting the one just handed out)
    // and all keywords of all users. Both are cheap (indexed count / collection metadata).
    const [left, total] = await Promise.all([col.countDocuments({ status: 'pending', ...ownerFilter }), col.estimatedDocumentCount()]);
    return res.json({
      code: 200,
      message: claimed ? 'claimed' : 'no pending keywords',
      scraper: owner,
      closed,
      data: claimed
        ? { id: String(claimed._id), keyword: claimed.keyword, userId: claimed.userId, attempt: claimed.attempts }
        : null,
      left,
      total,
    });
  } catch (err) {
    log.error('nextKeyword failed', { error: err.message });
    return res.status(500).json({ code: 500, message: 'Could not get the next keyword.', data: null });
  }
}

module.exports = { uploadMiddleware, requireAccess, accessProbe, downloadSample, uploadKeywords, listMyKeywords, nextKeyword, _test: { normKeyword, readKeywordRows, unsupportedTypeMessage, checkFileContent } };
