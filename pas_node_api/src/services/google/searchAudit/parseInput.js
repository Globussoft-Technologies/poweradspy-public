'use strict';

/**
 * Input parsers for POST insert-search-audit-keywords.
 *
 * Two sources, both yielding a list of { keyword, country?, user_id? }:
 *   - JSON body  → parseJsonKeywords (array of strings | array of objects | {keywords:[...]})
 *   - CSV file   → parseCsvFile (streamed line-by-line so a 50 MB file never loads whole)
 *
 * CSV rules: a header row is auto-detected (if the first row contains a "keyword" column,
 * that column is used and optional "country"/"user_id" columns are picked up too).
 * Otherwise the FIRST column of every line is taken as the keyword (i.e. a plain
 * one-keyword-per-line file works). Quotes and surrounding spaces are stripped.
 */

const fs = require('fs');
const readline = require('readline');

/** Split a single CSV line into fields, honoring double-quoted values with "" escapes. */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else { cur += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

/** Normalize a JSON body into [{ keyword, country?, user_id? }]. */
function parseJsonKeywords(body) {
  let list = body;
  if (body && !Array.isArray(body) && Array.isArray(body.keywords)) list = body.keywords;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (item == null) return null;
      if (typeof item === 'string' || typeof item === 'number') return { keyword: String(item) };
      if (typeof item === 'object') {
        const keyword = item.keyword ?? item.value ?? item.term;
        if (keyword == null || String(keyword).trim() === '') return null;
        return { keyword: String(keyword), country: item.country ?? null, user_id: item.user_id ?? item.userId ?? null };
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * Stream a CSV file from disk into [{ keyword, country?, user_id? }].
 * @param {string} filePath
 * @returns {Promise<Array>}
 */
function parseCsvFile(filePath) {
  return new Promise((resolve, reject) => {
    const items = [];
    let header = null; // { keyword:idx, country?:idx, user_id?:idx } when a header row is found
    let firstRow = true;

    const rl = readline.createInterface({ input: fs.createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });

    rl.on('line', (raw) => {
      const line = raw.replace(/^﻿/, ''); // strip BOM on the very first line
      if (line.trim() === '') return;
      const fields = splitCsvLine(line);

      if (firstRow) {
        firstRow = false;
        const lower = fields.map((f) => f.toLowerCase());
        const kwIdx = lower.indexOf('keyword');
        if (kwIdx !== -1) {
          header = {
            keyword: kwIdx,
            country: lower.indexOf('country') === -1 ? null : lower.indexOf('country'),
            user_id: lower.indexOf('user_id') === -1 ? lower.indexOf('userid') : lower.indexOf('user_id'),
          };
          return; // header row consumed, don't treat as data
        }
        // no header → fall through and treat this first row as data
      }

      if (header) {
        const keyword = fields[header.keyword];
        if (keyword && keyword.trim() !== '') {
          items.push({
            keyword,
            country: header.country != null ? (fields[header.country] || null) : null,
            user_id: header.user_id != null ? (fields[header.user_id] || null) : null,
          });
        }
      } else {
        const keyword = fields[0];
        if (keyword && keyword.trim() !== '') items.push({ keyword });
      }
    });

    rl.on('close', () => resolve(items));
    rl.on('error', reject);
  });
}

module.exports = { parseJsonKeywords, parseCsvFile, splitCsvLine };
