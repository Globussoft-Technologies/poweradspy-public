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

// A `.txt`/`.csv` extension is not a guarantee of text content — a user can
// upload a PNG/PDF/binary renamed (or picked) as .txt. Its raw bytes then get
// split into hundreds of garbage "keywords". Detect that up front so we reject
// with a friendly message instead of treating bytes as keywords.
//   - a NUL byte (0x00) never appears in legitimate UTF-8/ASCII text but is
//     everywhere in binary (PNG, PDF, images) → decisive binary marker.
//   - otherwise, if a large fraction of the sampled bytes are non-printable
//     control chars (outside tab/newline/carriage-return and the printable
//     range) the "text" is garbage/obfuscated, not a keyword list.
function looksBinaryOrGarbage(buf) {
  if (!buf || !buf.length) return false;
  const sample = buf.subarray(0, 8192);
  let nonPrintable = 0;
  for (const b of sample) {
    if (b === 0) return true; // NUL byte → definitely binary
    // allow tab(9), LF(10), CR(11-13 covers VT/FF/CR), and printable 32..126;
    // count everything else in the low range as non-printable control noise.
    const printable = b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126);
    if (!printable && b < 32) nonPrintable += 1;
  }
  return nonPrintable / sample.length > 0.3;
}

async function importKeywordsFile(req, db, logger) {
  const p = normalizeParams({ ...req.body, ...req.query });
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  let items = [];
  let binaryUpload = false;
  try {
    if (req.file) {
      // Guard against a binary/garbage file uploaded with a .txt/.csv extension
      // (e.g. a PNG renamed .txt) before its bytes get parsed into fake keywords.
      let buf = null;
      try { buf = fs.readFileSync(req.file.path); } catch { /* fall through to parse */ }
      if (buf && looksBinaryOrGarbage(buf)) {
        binaryUpload = true;
      } else {
        items = await parseCsvFile(req.file.path);
      }
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

  if (binaryUpload) {
    // Distinct from the empty case: the file had content, but it wasn't text.
    return { code: 400, message: "This file doesn't look like a text or CSV keyword list. Please upload a plain .txt or .csv file with one keyword per line." };
  }

  if (!items.length) {
    // User-facing message (shown verbatim in the Keywords Explorer UI) — keep it
    // free of API/payload jargon like the field names or JSON shapes.
    return { code: 400, message: 'Please enter or paste at least one keyword, or upload a .csv/.txt file to explore.' };
  }

  const wanted = [...new Set(items.map((i) => i.value.trim().toLowerCase()).filter(Boolean))];

  try {
    const placeholders = wanted.map(() => '?').join(', ');
    const matched = await db.sql.query(
      `SELECT MIN(gtk.id) AS keyword_id, gtk.keyword, ANY_VALUE(gtk.country) AS country,
              MAX(ks.ads_total) AS ads_total, MAX(ks.advertisers_total) AS advertisers_total,
              MAX(ks.domains_total) AS domains_total, MAX(ks.growth_pct) AS growth_pct,
              MAX(ks.competition_score) AS competition_score, ANY_VALUE(ks.category) AS category,
              MIN(ks.first_seen) AS first_seen, MAX(ks.last_seen) AS last_seen
       FROM google_text_keywords gtk
       LEFT JOIN keyword_stats ks ON ks.keyword_id = gtk.id
       -- gtk.keyword is utf8mb3 but the bound params arrive as utf8mb4; MySQL can't
       -- coerce a utf8mb4 param (e.g. an emoji/accented char in an uploaded file)
       -- into the utf8mb3 column collation ("Conversion from utf8mb4_unicode_ci into
       -- utf8mb3_unicode_ci impossible for parameter" → 500). Convert the column up
       -- to utf8mb4 (a lossless superset) and pin the comparison collation to the
       -- params' so both sides match — a non-matching keyword just falls to not_found.
       WHERE LOWER(TRIM(CONVERT(gtk.keyword USING utf8mb4))) COLLATE utf8mb4_unicode_ci IN (${placeholders})
       -- A keyword string can map to several google_text_keywords rows (one per
       -- country) with identical keyword-string-level stats; dedupe by keyword text
       -- so a searched/imported keyword shows once (same fix as the browse list).
       GROUP BY gtk.keyword`,
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
