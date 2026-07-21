'use strict';

/**
 * POST insert-search-audit-keywords — bulk insert keywords from a CSV file (≤ maxUploadMb)
 * or a JSON body, into google_audit_keywords.
 *
 *   1. parse input → [{ keyword, country?, user_id? }]
 *   2. dedupe + upsert (unique index on keywordNorm → no duplicates, case-insensitive)
 *   3. enforce the maxCount cap (delete oldest beyond it)
 *
 * The uploaded temp file is always unlinked afterwards.
 */

const fs = require('fs');
const repo = require('./repository');
const { parseJsonKeywords, parseCsvFile } = require('./parseInput');
const config = require('../../../config');

async function insertKeywords(req, db, log) {
  const cfg = config.googleKeywordAudit;
  if (!cfg.enabled) return { code: 503, message: 'Keyword audit store is disabled.' };
  if (!repo.getCollection()) return { code: 500, message: 'Database connection is not available.' };

  const file = req.file; // set by multer when a CSV is uploaded
  try {
    let items;
    if (file) {
      items = await parseCsvFile(file.path);
    } else {
      items = parseJsonKeywords(req.body);
    }

    if (!items || items.length === 0) {
      return {
        code: 400,
        message: 'No keywords found in the request. Send a CSV file (field "file") or JSON keywords.',
        hint: 'JSON: {"keywords":["cat","dog"]} or ["cat","dog"]. CSV: one keyword per line, or a column named "keyword".',
      };
    }

    const result = await repo.bulkUpsertKeywords(items, file ? 'upload' : 'api');
    const cap = await repo.enforceCap(cfg.maxCount);

    return {
      code: 200,
      message: 'Keywords inserted successfully',
      data: {
        received: result.received,
        inserted: result.inserted,
        duplicatesIgnored: result.received - result.inserted, // batch dupes + already-present
        deletedOverCap: cap.deleted,
        totalAfter: cap.total,
      },
    };
  } catch (err) {
    log?.error?.('insertSearchAuditKeywords error', { error: err.message });
    return { code: 500, message: err.message };
  } finally {
    if (file && file.path) fs.promises.unlink(file.path).catch(() => {});
  }
}

module.exports = { insertKeywords };
