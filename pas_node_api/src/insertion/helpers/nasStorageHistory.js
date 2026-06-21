'use strict';

/**
 * nasStorageHistory — tiny on-disk daily df-snapshot store for the admin NAS-storage report.
 *
 * The BE has no working Redis on this box, so the per-day "data stored" metric is derived from
 * periodic `df` snapshots: we keep the latest reading per UTC day in data/nas-storage-history.json
 * and the report shows the day-over-day growth of `used`. Writes are atomic (temp + rename);
 * last-write-wins across the two cluster workers, which is fine for a once-or-twice-daily snapshot.
 */

const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('../../logger');

const log = logger.createChild('nas-history');
const DIR = path.join(process.cwd(), (config.localCache && config.localCache.dir) || 'data');
const FILE = path.join(DIR, 'nas-storage-history.json');
const MAX_DAYS = 150;

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; }
  catch (e) { return {}; }
}

function write(obj) {
  try {
    if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, FILE);
  } catch (e) { log.warn('NAS history write failed', { error: e.message }); }
}

/** Record (overwrite) today's df snapshot. Idempotent within a UTC day. */
function recordSnapshot(df) {
  if (!df || !Number.isFinite(df.totalBytes)) return;
  const day = new Date().toISOString().slice(0, 10);
  const hist = read();
  hist[day] = {
    totalBytes: df.totalBytes,
    usedBytes: df.usedBytes,
    freeBytes: df.freeBytes,
    at: df.at || new Date().toISOString(),
  };
  const dates = Object.keys(hist).sort();
  while (dates.length > MAX_DAYS) delete hist[dates.shift()];
  write(hist);
}

/** Last `days` daily snapshots, each with growthBytes = used delta vs the previous snapshot. */
function getSeries(days) {
  const hist = read();
  const dates = Object.keys(hist).sort();
  const series = dates.map((d, i) => {
    const cur = hist[d];
    const prev = i > 0 ? hist[dates[i - 1]] : null;
    return {
      date: d,
      totalBytes: cur.totalBytes,
      usedBytes: cur.usedBytes,
      freeBytes: cur.freeBytes,
      growthBytes: prev ? cur.usedBytes - prev.usedBytes : null,
    };
  });
  return series.slice(-Math.max(1, days));
}

module.exports = { recordSnapshot, getSeries, FILE };
