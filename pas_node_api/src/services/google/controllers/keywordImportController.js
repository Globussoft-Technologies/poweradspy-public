'use strict';

/**
 * Keyword Import — CSV/TXT upload (or pasted JSON list) of seed keywords,
 * matched against PowerAdSpy's own crawled keyword corpus.
 *
 * POST /api/v1/google/keywords/import (multipart 'file', OR JSON body
 * `{ keywords: [...] }` / a plain array for pasted/comma-separated input)
 *
 * Reuses the CSV/line parser already built for the keyword-search synthetic
 * upload (src/services/common/helpers/keywordInput.js) rather than a second
 * implementation — a one-keyword-per-line TXT file parses the same way a
 * headerless CSV does.
 *
 * Returns matched rows (joined to keyword_stats) + an explicit `not_found`
 * list for keywords outside PowerAdSpy's corpus — no silent drops.
 */

const fs = require('fs');
const { normalizeParams } = require('../helpers/paramParser');
const { parseJsonKeywords, parseCsvFile } = require('../../common/helpers/keywordInput');

async function importKeywordsFile(req, db, logger) {
  const p = normalizeParams({ ...req.body, ...req.query });
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  let items = [];
  try {
    if (req.file) {
      items = await parseCsvFile(req.file.path);
    } else if (req.body?.keywords) {
      items = parseJsonKeywords(req.body.keywords);
    } else if (typeof req.body?.text === 'string') {
      items = req.body.text
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((value) => ({ value }));
    }
  } finally {
    if (req.file?.path) fs.unlink(req.file.path, () => {}); // best-effort temp-file cleanup
  }

  if (!items.length) {
    return { code: 400, message: 'No keywords provided (upload a file field named "file", or send { keywords: [...] } / { text: "..." })' };
  }

  const wanted = [...new Set(items.map((i) => i.value.trim().toLowerCase()).filter(Boolean))];

  try {
    const placeholders = wanted.map(() => '?').join(', ');
    const matched = await db.sql.query(
      `SELECT gtk.id AS keyword_id, gtk.keyword, gtk.country,
              ks.ads_total, ks.advertisers_total, ks.domains_total,
              ks.growth_pct, ks.competition_score, ks.category,
              ks.first_seen, ks.last_seen
       FROM google_text_keywords gtk
       LEFT JOIN keyword_stats ks ON ks.keyword_id = gtk.id
       WHERE LOWER(TRIM(gtk.keyword)) IN (${placeholders})`,
      wanted
    );

    const foundSet = new Set(matched.map((m) => String(m.keyword).trim().toLowerCase()));
    const notFound = wanted.filter((w) => !foundSet.has(w));

    return {
      code: 200,
      message: 'Keywords imported.',
      data: {
        matched,
        not_found: notFound,
        note: notFound.length
          ? `${notFound.length} of ${wanted.length} keyword(s) are not in PowerAdSpy's crawled corpus and were not matched.`
          : undefined,
      },
    };
  } catch (err) {
    logger.error('Error in importKeywordsFile (google)', { error: err.message });
    return { code: 500, message: 'Error importing keywords', error: err.message };
  }
}

module.exports = { importKeywordsFile };
