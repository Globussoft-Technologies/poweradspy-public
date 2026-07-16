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

  // Upload middleware flagged a non-.txt/.csv file (PDF/DOCX/XLSX/image/etc.):
  // reject with a clear message instead of trying to parse it.
  if (req.invalidFileType) {
    return { code: 400, message: 'Only .txt or .csv files are supported. Please upload a plain text or CSV file with one keyword per line.' };
  }

  let items = [];
  let binaryUpload = false;
  let parseFailed = false;
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
  } catch (e) {
    // A malformed/unreadable upload can make the CSV stream reject (bad encoding,
    // read error, weird delimiters, etc.). Treat it as an invalid file → friendly
    // 400, never let it bubble up as an unhandled 500.
    parseFailed = true;
    logger.warn('keyword import parse failed', { error: e.message });
  } finally {
    if (req.file?.path) fs.unlink(req.file.path, () => {}); // best-effort temp-file cleanup
  }

  if (parseFailed) {
    return { code: 400, message: "The file couldn't be read as a text or CSV keyword list. Please upload a plain .txt or .csv file with one keyword per line." };
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

  // Accept only real keyword tokens so a "bullshit" upload (random symbols,
  // single/short stray characters, an entire pasted blob, thousands of lines)
  // can't match corpus noise, blow up the IN(...) list, or fall through to
  // `IN ()`. A valid keyword: 3–200 chars and contains at least one letter/digit
  // — this drops "", spaces, ".", "###", and 1–2 char junk like "c"/"h"/"ab".
  const MIN_KEYWORD_LENGTH = 3;
  const MAX_KEYWORDS = 5000;
  const isValidKeyword = (v) => v.length >= MIN_KEYWORD_LENGTH && v.length <= 200 && /[\p{L}\p{N}]/u.test(v);
  const cleaned = [...new Set(items.map((i) => String(i.value ?? '').trim().toLowerCase()).filter(isValidKeyword))];
  const truncated = cleaned.length > MAX_KEYWORDS;
  const wanted = cleaned.slice(0, MAX_KEYWORDS); // cap so a huge file can't overflow the prepared statement

  if (!wanted.length) {
    // Non-empty input, but nothing in it looks like a keyword (e.g. a single
    // character, 1-2 char junk, or symbols). Never build `IN ()` (SQL syntax
    // error → 500) — return a friendly validation message instead.
    return { code: 400, message: 'Please enter a valid keyword (at least 3 characters).' };
  }

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

    if (matched.length === 0) {
      // Nothing matched at all — almost always the wrong kind of file (an ads
      // export / report / random text whose columns got parsed as "keywords"),
      // not a keyword list. Show a friendly message instead of dumping 100+
      // unmatched tokens (ad_id/ad_position/…) into the not-found banner.
      return {
        code: 400,
        message: "None of the entries in this file match a keyword in PowerAdSpy's data. Please upload a keyword list — a plain .txt or .csv with one keyword per line, not an ads export or report.",
      };
    }

    return {
      code: 200,
      message: 'Keywords imported.',
      data: {
        matched,
        not_found: notFound,
        note: [
          truncated ? `Only the first ${MAX_KEYWORDS} keywords were processed.` : null,
          notFound.length ? `${notFound.length} of ${wanted.length} keyword(s) are not in PowerAdSpy's crawled corpus and were not matched.` : null,
        ].filter(Boolean).join(' ') || undefined,
      },
    };
  } catch (err) {
    // Catch-all: never surface a raw DB/engine error to the user. Log the real
    // error server-side for debugging, but return a friendly message. Use 400
    // (not 500) so the frontend renders THIS message — it throws a generic
    // "failed: 500" for any non-2xx status other than 400, which would hide our
    // text. This guarantees any unforeseen bad-file edge case still shows a
    // friendly message instead of an error.
    logger.error('Error in importKeywordsFile (google)', { error: err.message });
    return { code: 400, message: "We couldn't process this file. Please make sure it's a valid .txt or .csv with one keyword per line, then try again." };
  }
}

module.exports = { importKeywordsFile };
