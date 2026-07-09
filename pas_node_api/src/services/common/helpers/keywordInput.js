'use strict';

/**
 * Input parsers for the synthetic keyword bulk-insert endpoint.
 *
 * Both yield a flat list of raw items `{ value, type?, network? }` — the controller
 * applies batch/config defaults and validates type/network. Per-item `type`/`network`
 * (when present) override the batch defaults.
 *
 *   - JSON body → parseJsonKeywords  (array of strings | array of objects | {keywords:[...]})
 *   - CSV file  → parseCsvFile       (streamed line-by-line; 50 MB never loaded whole)
 */

const fs = require('fs');
const readline = require('readline');

/** Split one CSV line into trimmed fields, honoring "quoted, values" and "" escapes. */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; } }
      else { cur += ch; }
    } else if (ch === '"') { inQuotes = true; }
    else if (ch === ',') { out.push(cur); cur = ''; }
    else { cur += ch; }
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

/** Normalize a JSON body into [{ value, type?, network? }]. */
function parseJsonKeywords(body) {
  let list = body;
  if (body && !Array.isArray(body) && Array.isArray(body.keywords)) list = body.keywords;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (item == null) return null;
      if (typeof item === 'string' || typeof item === 'number') {
        const value = String(item).trim();
        return value ? { value } : null;
      }
      if (typeof item === 'object') {
        const raw = item.value ?? item.keyword ?? item.term;
        const value = raw == null ? '' : String(raw).trim();
        if (!value) return null;
        const out = { value };
        if (item.type !== undefined && item.type !== null && item.type !== '') out.type = item.type;
        if (item.network !== undefined && item.network !== null && item.network !== '') out.network = item.network;
        if (item.country !== undefined && item.country !== null && item.country !== '') out.country = item.country;
        return out;
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * Stream a CSV file into [{ value, type?, network? }].
 * Header auto-detected: if a `keyword`/`value` column exists, it's used and optional
 * `type`/`network` columns are picked up. Otherwise the FIRST column of every line is the
 * keyword (a plain one-keyword-per-line file works). BOM + surrounding spaces stripped.
 */
function parseCsvFile(filePath) {
  return new Promise((resolve, reject) => {
    const items = [];
    let header = null; // { value:idx, type?:idx, network?:idx }
    let firstRow = true;
    const rl = readline.createInterface({ input: fs.createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });

    rl.on('line', (raw) => {
      const line = raw.replace(/^﻿/, '');
      if (line.trim() === '') return;
      const fields = splitCsvLine(line);

      if (firstRow) {
        firstRow = false;
        const lower = fields.map((f) => f.toLowerCase());
        const valIdx = lower.indexOf('keyword') !== -1 ? lower.indexOf('keyword') : lower.indexOf('value');
        if (valIdx !== -1) {
          header = {
            value: valIdx,
            type: lower.indexOf('type') === -1 ? null : lower.indexOf('type'),
            network: lower.indexOf('network') === -1 ? null : lower.indexOf('network'),
            country: lower.indexOf('country') === -1 ? null : lower.indexOf('country'),
          };
          return; // header row consumed
        }
        // no header → treat this first row as data (fall through)
      }

      if (header) {
        const value = (fields[header.value] || '').trim();
        if (!value) return;
        const out = { value };
        if (header.type != null && fields[header.type]) out.type = fields[header.type];
        if (header.network != null && fields[header.network]) out.network = fields[header.network];
        if (header.country != null && fields[header.country]) out.country = fields[header.country];
        items.push(out);
      } else {
        const value = (fields[0] || '').trim();
        if (value) items.push({ value });
      }
    });

    rl.on('close', () => resolve(items));
    rl.on('error', reject);
  });
}

module.exports = { parseJsonKeywords, parseCsvFile, splitCsvLine };
