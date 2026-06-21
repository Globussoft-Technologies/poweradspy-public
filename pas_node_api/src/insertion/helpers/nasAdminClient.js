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

// Per-network du is far too slow to run per-request (millions of files per network), so a daily
// cron kicks it in the background; it writes PN_FILE and getPerNetworkSizes() reads that cheaply.
const PN_FILE = '/tmp/nas_per_network_du.txt';
const PN_CACHE_MS = 5 * 60 * 1000;
let pnCache = { at: 0, data: null };

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

/**
 * Kick a per-network `du` on the NAS in the BACKGROUND (fire-and-forget).
 *
 * Per-network totals mean summing millions of files under each network dir — many minutes, far too
 * slow for a request. A daily cron calls this; it writes the result to PN_FILE (atomic temp+rename)
 * and getPerNetworkSizes() just reads that file cheaply. A guard skips kicking if a scan is already
 * running, so repeated calls never stack. Returns 'kicked' or 'busy'.
 */
async function kickPerNetworkDu() {
  if (!isConfigured()) throw new Error('NAS admin SSH not configured');
  const root = `${nas.adminMount || '/mnt/nfs'}/poweradspy-NAS`;
  const cmd =
    `if pgrep -f "du -b -d1 ${root}" >/dev/null 2>&1; then echo busy; else `
    + `nohup bash -c 'du -b -d1 ${root} 2>/dev/null > ${PN_FILE}.tmp && mv -f ${PN_FILE}.tmp ${PN_FILE}' `
    + `>/dev/null 2>&1 & echo kicked; fi`;
  const out = (await sshExec(cmd, 15000)).trim();
  log.info('NAS per-network du kick', { result: out, root });
  return out;
}

/**
 * Read the latest per-network `du` snapshot (cheap — just cats PN_FILE). Returns
 * { sizes: { <network>: bytes }, total, computedAt } or null if no scan has completed yet.
 * Cached PN_CACHE_MS (the underlying scan only changes once a day anyway).
 */
async function getPerNetworkSizes(force = false) {
  if (!force && pnCache.data && (Date.now() - pnCache.at) < PN_CACHE_MS) return pnCache.data;
  if (!isConfigured()) return null;
  let out;
  try {
    out = await sshExec(`stat -c %Y ${PN_FILE} 2>/dev/null || echo 0; echo '==='; cat ${PN_FILE} 2>/dev/null || true`, 15000);
  } catch (e) {
    log.warn('NAS per-network read failed', { error: e.message });
    return pnCache.data; // serve last-known on a transient SSH error
  }
  const [mtPart, body = ''] = out.split('===');
  const mt = parseInt(String(mtPart).trim(), 10);
  const sizes = {};
  let total = null;
  for (const line of body.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!m) continue;
    const bytes = parseInt(m[1], 10);
    const name = m[2].split('/').pop();
    if (!name || !Number.isFinite(bytes)) continue;
    if (name === 'poweradspy-NAS') { total = bytes; continue; }
    sizes[name] = bytes;
  }
  const networks = Object.keys(sizes);
  if (!networks.length) return pnCache.data; // not computed yet → keep prior value (likely null)
  const data = {
    sizes,
    total: Number.isFinite(total) ? total : networks.reduce((s, n) => s + sizes[n], 0),
    computedAt: mt ? new Date(mt * 1000).toISOString() : null,
  };
  pnCache = { at: Date.now(), data };
  return data;
}

module.exports = { getStorage, isConfigured, kickPerNetworkDu, getPerNetworkSizes };
