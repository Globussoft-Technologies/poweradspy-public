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

// --- Per-network/per-tree file-INTAKE matrix: files/bytes written today + a 2-day baseline + a
// today-by-hour split. Like per-network du, the scan stats the current-month dirs (100k-700k files
// per tree) so it is far too slow per-request: an hourly cron kicks it detached on the NAS (writes
// INTAKE_FILE atomically) and getIntake() just reads that file cheaply. "Today" grows through the
// day, hence hourly (vs the once-daily du).
const INTAKE_FILE = '/tmp/nas_intake.txt';
const INTAKE_LOCK = '/tmp/nas_intake.lock';
const INTAKE_SCRIPT = '/tmp/nas_intake_scan.sh';
const INTAKE_CACHE_MS = 5 * 60 * 1000;
let intakeCache = { at: 0, data: null };

// Canonical media-tree column order for the matrix; the FE renders only the trees that have data.
const INTAKE_TREES = ['adImage', 'adVideo', 'otherMultiMedia', 'thumbnail', 'postowner', 'blackHatAd', 'whiteHatAd'];

// Static scan (MONTH/dates resolved at runtime via `date`). Emits, per network/tree:
//   D <net> <tree> <YYYY-MM-DD> <files> <bytes>   (today + the 2 prior days)
//   H <net> <tree> <hour> <files>                 (today only)
// base64'd before shipping over SSH so the awk quoting/backslashes survive intact.
const INTAKE_SCAN_SH = `ROOT=${nas.adminMount || '/mnt/nfs'}/poweradspy-NAS
MONTH=$(date +%Y%m); TODAY=$(date +%Y-%m-%d); SINCE=$(date -d '2 days ago' +%Y-%m-%d)
EL=$(( $(date +%s) - $(date -d "$TODAY 00:00:00" +%s) ))
echo "META computedEpoch=$(date +%s) today=$TODAY tz=$(date +%Z) elapsedSec=$EL sinceDay=$SINCE"
for n in fb gdn gt insta linkedin native pint quora reddit tiktok yt; do
  [ -d "$ROOT/$n" ] || continue
  for tree in $(ls -1 "$ROOT/$n" 2>/dev/null); do
    d="$ROOT/$n/$tree/$MONTH"; [ -d "$d" ] || continue
    find "$d" -maxdepth 1 -type f -newermt "$SINCE 00:00:00" -printf '%TY-%Tm-%Td %TH %s\\n' 2>/dev/null | \\
    awk -v net="$n" -v tree="$tree" -v today="$TODAY" '{dd=$1;cf[dd]++;cb[dd]+=$3;if(dd==today)hh[$2+0]++} END{for(x in cf)printf "D %s %s %s %d %d\\n",net,tree,x,cf[x],cb[x]; for(k=0;k<24;k++)if(hh[k])printf "H %s %s %d %d\\n",net,tree,k,hh[k]}'
  done
done`;
const INTAKE_SCAN_B64 = Buffer.from(INTAKE_SCAN_SH).toString('base64');

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

/**
 * Kick the per-network/per-tree intake scan in the BACKGROUND (fire-and-forget). The scan stats the
 * current-month dirs to count files/bytes written per day — too slow per-request, so it runs detached
 * and getIntake() reads its result. A PID lockfile guards against overlapping scans and self-heals
 * (a stale lock whose PID is dead is ignored). Returns 'kicked' or 'busy'.
 */
async function kickIntakeScan() {
  if (!isConfigured()) throw new Error('NAS admin SSH not configured');
  const cmd =
    `printf %s ${INTAKE_SCAN_B64} | base64 -d > ${INTAKE_SCRIPT} && `
    + `if [ -e ${INTAKE_LOCK} ] && kill -0 "$(cat ${INTAKE_LOCK} 2>/dev/null)" 2>/dev/null; then echo busy; else `
    + `nohup bash -c 'echo $$ > ${INTAKE_LOCK}; bash ${INTAKE_SCRIPT} > ${INTAKE_FILE}.tmp 2>/dev/null `
    + `&& mv -f ${INTAKE_FILE}.tmp ${INTAKE_FILE}; rm -f ${INTAKE_LOCK}' >/dev/null 2>&1 & echo kicked; fi`;
  const out = (await sshExec(cmd, 15000)).trim();
  log.info('NAS intake scan kick', { result: out });
  return out;
}

function shiftDay(ymd, delta) {
  const dt = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/** Parse the D/H scan output into the intake-matrix payload, or null if not yet computed. */
function parseIntake(text) {
  if (!text || !text.trim()) return null;
  let meta = null;
  const D = {};      // D[net][tree][day] = { files, bytes }
  const byHour = {}; // fleet today: hour -> files
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('META ')) {
      meta = {};
      for (const kv of line.slice(5).split(/\s+/)) {
        const i = kv.indexOf('=');
        if (i > 0) meta[kv.slice(0, i)] = kv.slice(i + 1);
      }
    } else if (line.startsWith('D ')) {
      const p = line.split(/\s+/);  // D net tree day files bytes
      if (p.length < 6) continue;
      const net = D[p[1]] || (D[p[1]] = {});
      const tree = net[p[2]] || (net[p[2]] = {});
      tree[p[3]] = { files: +p[4], bytes: +p[5] };
    } else if (line.startsWith('H ')) {
      const p = line.split(/\s+/);  // H net tree hour files
      if (p.length < 5) continue;
      byHour[+p[3]] = (byHour[+p[3]] || 0) + (+p[4]);
    }
  }
  if (!meta || !meta.today) return null;
  const today = meta.today;
  const d1 = shiftDay(today, -1);
  const d2 = shiftDay(today, -2);
  const networks = {};
  const totals = { filesToday: 0, bytesToday: 0, filesD1: 0, filesD2: 0 };
  for (const net of Object.keys(D)) {
    const trees = {};
    let filesToday = 0, bytesToday = 0, filesD1 = 0, filesD2 = 0;
    for (const tree of Object.keys(D[net])) {
      const td = D[net][tree];
      const e0 = td[today] || { files: 0, bytes: 0 };
      const e1 = td[d1] || { files: 0, bytes: 0 };
      const e2 = td[d2] || { files: 0, bytes: 0 };
      trees[tree] = { today: e0.files, todayBytes: e0.bytes, d1: e1.files, d2: e2.files };
      filesToday += e0.files; bytesToday += e0.bytes; filesD1 += e1.files; filesD2 += e2.files;
    }
    const status = filesToday > 0 ? 'active' : ((filesD1 > 0 || filesD2 > 0) ? 'stalled' : 'idle');
    networks[net] = { trees, filesToday, bytesToday, filesD1, filesD2, status };
    totals.filesToday += filesToday; totals.bytesToday += bytesToday;
    totals.filesD1 += filesD1; totals.filesD2 += filesD2;
  }
  const elapsedSec = parseInt(meta.elapsedSec, 10) || null;
  totals.projFiles = elapsedSec ? Math.round((totals.filesToday * 86400) / elapsedSec) : null;
  totals.projBytes = elapsedSec ? Math.round((totals.bytesToday * 86400) / elapsedSec) : null;
  return {
    computedAt: meta.computedEpoch ? new Date(parseInt(meta.computedEpoch, 10) * 1000).toISOString() : null,
    today,
    tz: meta.tz || null,
    elapsedSec,
    networks,
    trees: INTAKE_TREES,
    byHour,
    totals,
  };
}

/**
 * Read the latest intake scan (cheap — just cats INTAKE_FILE) parsed into the matrix payload.
 * Cached INTAKE_CACHE_MS. Returns null until the first scan completes; never throws to the report.
 */
async function getIntake(force = false) {
  if (!force && intakeCache.data && (Date.now() - intakeCache.at) < INTAKE_CACHE_MS) return intakeCache.data;
  if (!isConfigured()) return null;
  let out;
  try {
    out = await sshExec(`cat ${INTAKE_FILE} 2>/dev/null || true`, 15000);
  } catch (e) {
    log.warn('NAS intake read failed', { error: e.message });
    return intakeCache.data; // serve last-known on a transient SSH error
  }
  const parsed = parseIntake(out);
  if (!parsed) return intakeCache.data; // not computed yet → keep prior value (likely null)
  intakeCache = { at: Date.now(), data: parsed };
  return parsed;
}

module.exports = { getStorage, isConfigured, kickPerNetworkDu, getPerNetworkSizes, kickIntakeScan, getIntake };
