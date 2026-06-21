'use strict';

/**
 * nasSftpPool — direct-to-NAS SFTP writer backed by a SMALL persistent connection pool.
 *
 * WHY: the HTTP media upload (media.globussoft.com) is fronted by Cloudflare, which 413s any
 * request body >~100MB. Large fb/insta videos therefore could never upload, piled up in the
 * durable retry queue, and filled the API box's disk — taking prod down (2026-06-21 incident).
 * Writing straight to the NAS over SFTP has no such size cap.
 *
 * The NAS (TrueNAS) refuses more than ~10 concurrent SSH sessions, so we keep a SMALL pool
 * (default 5) of reused connections rather than connecting per upload (a fresh connect is ~1.3s).
 * A module-level dir cache avoids redundant recursive mkdir round-trips for files that share a
 * {network}/{subfolder}/{yyyymm} directory.
 *
 * The SFTP user is chrooted to the bucket stream root (/mnt/nfs/<bucket>-NAS), so a remote path
 * of `<network>/<subfolder>/<yyyymm>/<id>.<ext>` lands exactly where the CDN serves
 * /<bucket>/stream/<same path> — i.e. the deterministic predicted path the ad already references.
 */

const path = require('path');
const Client = require('ssh2-sftp-client');
const config = require('../../config');
const logger = require('../../logger');

const log = logger.createChild('nas-sftp');
const nas = config.insertion.nas;
const POOL_SIZE = nas.sftpPoolSize || 5;

function isConfigured() {
  return !!(nas.sftpHost && nas.sftpUser && nas.sftpPass);
}
function conf() {
  return {
    host: nas.sftpHost,
    port: nas.sftpPort || 7361,
    username: nas.sftpUser,
    password: nas.sftpPass,
    readyTimeout: 20000,
  };
}

const mkdone = new Set();   // remote dirs already ensured (skip redundant mkdir)
const slots = [];           // { client: Client|null, busy: bool }
const waiters = [];         // resolve fns parked until a slot frees

async function acquire() {
  let slot = slots.find((s) => !s.busy);
  if (slot) { slot.busy = true; return slot; }
  if (slots.length < POOL_SIZE) { slot = { client: null, busy: true }; slots.push(slot); return slot; }
  return new Promise((resolve) => waiters.push(resolve));
}
function release(slot) {
  const next = waiters.shift();
  if (next) { next(slot); } else { slot.busy = false; }   // slot stays busy if handed to a waiter
}
async function clientFor(slot) {
  if (slot.client) return slot.client;
  const c = new Client();
  await c.connect(conf());
  slot.client = c;
  return c;
}

/**
 * Upload a local file to the NAS at `remoteKeyPath` (relative to the SFTP home = bucket stream
 * root), creating parent directories as needed. Resolves true on success; rejects on failure
 * (the caller decides whether to fall back / enqueue).
 *
 * @param {string} localPath     absolute path to the file on this box
 * @param {string} remoteKeyPath e.g. 'fb/adVideo/202606/38517231.mp4'
 */
async function putFile(localPath, remoteKeyPath) {
  if (!isConfigured()) throw new Error('NAS SFTP not configured (insertion.nas.sftpHost/User/Pass)');
  const slot = await acquire();
  try {
    const c = await clientFor(slot);
    const dir = path.posix.dirname(remoteKeyPath);
    if (dir && dir !== '.' && !mkdone.has(dir)) {
      await c.mkdir(dir, true).catch(() => {});   // tolerate "already exists"
      mkdone.add(dir);
    }
    try {
      await c.put(localPath, remoteKeyPath);
    } catch (e) {
      // A stale root-owned file (left by the old upload mechanism) can't be overwritten in place.
      // Our ownership of the directory lets us unlink it first, then write a fresh
      // poweradspy-NAS-owned file. The bytes are safe: on any failure the caller re-queues them.
      if (/permission denied/i.test(e.message || '')) {
        await c.delete(remoteKeyPath).catch(() => {});
        await c.put(localPath, remoteKeyPath);
      } else {
        throw e;
      }
    }
    release(slot);
    return true;
  } catch (err) {
    // Drop the (possibly broken) connection so this slot reconnects on next use.
    try { if (slot.client) await slot.client.end(); } catch (e) { /* ignore */ }
    slot.client = null;
    release(slot);
    throw err;
  }
}

module.exports = { putFile, isConfigured };
