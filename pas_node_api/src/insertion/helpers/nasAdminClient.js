'use strict';

/**
 * nasAdminClient — read-only NAS storage stats for the admin dashboard.
 *
 * The SFTP writer (nasSftpPool) connects as a CHROOTED user with no shell, so it cannot run `df`.
 * This opens a separate, short-lived SSH session as the NAS admin user PURELY to read filesystem
 * totals (`df`). The result is cached briefly so the admin endpoint never hammers the NAS.
 *
 * Config: config.insertion.nas.admin{Host,Port,User,Pass,Mount} (config.json → env NAS_ADMIN_*).
 */

const { Client } = require('ssh2');
const config = require('../../config');
const logger = require('../../logger');

const log = logger.createChild('nas-admin');
const nas = config.insertion.nas;
const CACHE_MS = 5 * 60 * 1000;
let cache = { at: 0, data: null };

function isConfigured() {
  return !!(nas.adminHost && nas.adminUser && nas.adminPass);
}

function sshExec(cmd, timeoutMs = 18000) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let out = '';
    let settled = false;
    const done = (err, val) => {
      if (settled) return;
      settled = true;
      try { conn.end(); } catch (e) { /* ignore */ }
      if (err) reject(err); else resolve(val);
    };
    const timer = setTimeout(() => done(new Error('NAS admin SSH timeout')), timeoutMs);
    conn.on('ready', () => {
      conn.exec(cmd, (err, stream) => {
        if (err) { clearTimeout(timer); return done(err); }
        stream.on('close', () => { clearTimeout(timer); done(null, out); })
          .on('data', (d) => { out += d.toString(); })
          .stderr.on('data', () => { /* ignore stderr noise */ });
      });
    }).on('error', (err) => { clearTimeout(timer); done(err); })
      .connect({
        host: nas.adminHost,
        port: nas.adminPort || 7361,
        username: nas.adminUser,
        password: nas.adminPass,
        readyTimeout: timeoutMs,
      });
  });
}

/**
 * Returns { totalBytes, usedBytes, freeBytes, pctUsed, mount, at } for the NAS filesystem.
 * Cached for CACHE_MS. Throws if not configured or the SSH/df fails.
 */
async function getStorage(force = false) {
  if (!force && cache.data && (Date.now() - cache.at) < CACHE_MS) return cache.data;
  if (!isConfigured()) throw new Error('NAS admin SSH not configured');
  const mount = nas.adminMount || '/mnt/nfs';
  // -B1 = report in bytes; --output limits to the three numbers we need; tail -1 drops the header.
  const raw = await sshExec(`df -B1 --output=size,used,avail ${mount} | tail -1`);
  const [totalBytes, usedBytes, freeBytes] = raw.trim().split(/\s+/).map((n) => parseInt(n, 10));
  if (![totalBytes, usedBytes, freeBytes].every(Number.isFinite)) {
    throw new Error(`Unexpected df output: ${String(raw).slice(0, 120)}`);
  }
  const data = {
    totalBytes,
    usedBytes,
    freeBytes,
    pctUsed: totalBytes ? +((usedBytes / totalBytes) * 100).toFixed(1) : 0,
    mount,
    at: new Date().toISOString(),
  };
  cache = { at: Date.now(), data };
  log.info('NAS df refreshed', { totalBytes, usedBytes, freeBytes, pctUsed: data.pctUsed });
  return data;
}

module.exports = { getStorage, isConfigured };
