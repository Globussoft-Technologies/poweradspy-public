
'use strict';

/**
 * The evidence files of a copyright claim (PDFs and images), kept in a PRIVATE NAS bucket. One module, in four parts:
 *   1. file checks     what a file is (by its bytes, never its name), its size, a safe name, the storage key
 *   2. the transport   upload / read / delete over HTTP against the private bucket (injectable; the tests use a fake)
 *   3. the repository  SQL on copyright_claim_files (the home database of the claims)
 *   4. the service     addFiles / openFile / listFiles / deleteFile: what a route calls
 *
 * Why its own module and not nasClient.js: nasClient.js and nasHttpUpload.js serve the ad media of every network (one global bucket and
 * token, files served publicly by the CDN to anyone with the URL). Evidence must never go there. This module has its own bucket, its own
 * token (environment only) and never returns a "default image" for a failed upload: a failure is a failure.
 *
 * Privacy rules it keeps:
 *   - no file name from the user is ever used on the NAS or on a disk. The key follows the layout the infrastructure team set for the private
 *     bucket, copyrightdoc/<MMYYYY>/<complaintId>/<timestamp>: it carries the claim id (so a claim's files sit together) and never the
 *     advertiser or a person's name. That is acceptable only because the bucket is PRIVATE (not served by the CDN, reads need the token);
 *   - the original name is kept in the database only, cleaned, and is never part of a path;
 *   - nothing here makes a URL: a file is read by this server (openFile) and streamed to a logged-in reviewer by the admin route;
 *   - a file whose scan is not "clean" is not readable while compliance.claims.attachments.scan.required is on (the default).
 *
 * Off by default (config.compliance.claims.attachments.enabled). Nothing in this file is required unless the claims feature loads it.
 */

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const axios = require('axios');
const FormData = require('form-data');

// ═══ 1. File checks ═══
/** What is allowed: the extension we store under, whether it is a document or an image, and its type. */
const TYPES = Object.freeze({
  pdf: { kind: 'document', mime: 'application/pdf' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  png: { kind: 'image', mime: 'image/png' },
  webp: { kind: 'image', mime: 'image/webp' },
});

/** The type of a file from its first bytes: 'pdf' | 'jpg' | 'png' | 'webp' | null. */
function detectType(head) {
  if (!Buffer.isBuffer(head) || head.length < 12) return null;
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpg';
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/** Read the first bytes of a file and detect its type. */
async function sniffFile(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buf, 0, 16, 0);
    return detectType(buf.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/** SHA-256 of a file, streamed (a few MB at most, but never read whole into memory). */
function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/** The name a person gave the file, made safe to STORE and to show: no path, no control characters, at most 255 characters. */
function cleanName(raw) {
  const base = String(raw ?? '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (base || 'file').slice(0, 255);
}

/** The extension the person's file name claims, normalised ('jpeg' is 'jpg'); '' for none. */
function declaredExtension(name) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name ?? '').trim());
  if (!m) return '';
  const ext = m[1].toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

/**
 * The storage key (without extension) of a file, exactly in the layout the infrastructure team set for the private bucket:
 *   copyrightdoc/<MMYYYY>/<complaintId>/<timestamp>
 * The month and year are UTC; the timestamp is in milliseconds. (Two files of one claim must never get the same timestamp, or the NAS would
 * overwrite one with the other: the service hands out strictly increasing timestamps, see createAttachmentService.) The segments use only
 * letters, digits, '.', '_' and '-', as the NAS requires.
 * @param {string} complaintId
 * @param {number|Date} [when]  the timestamp in milliseconds (or a Date)
 */
function keyFor(complaintId, when = Date.now()) {
  const at = new Date(when);
  const month = `${String(at.getUTCMonth() + 1).padStart(2, '0')}${at.getUTCFullYear()}`;
  return `copyrightdoc/${month}/${String(complaintId).toLowerCase()}/${at.getTime()}`;
}

/** Headers for sending a stored file to a reviewer: always a download, never shown by the browser, never cached. */
function downloadHeaders(row) {
  const name = cleanName(row.original_name);
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_');
  return {
    'Content-Type': TYPES[extOfRow(row)]?.mime || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  };
}

function extOfRow(row) {
  const m = /\.([a-z0-9]+)$/.exec(String(row.file_key || ''));
  return m ? m[1] : '';
}

// ═══ 2. The transport (private bucket over HTTP) ═══
const joinUrl = (base, part) => `${String(base).replace(/\/+$/, '')}/${String(part).replace(/^\/+/, '')}`;

/**
 * The same NAS storage API the media upload uses (POST { key, file } with a Bearer token; DELETE {base}/{bucket}/{key.ext}), but against
 * the claims bucket with the claims token. READING a file back is NOT part of that API: its path is `readPath` in the settings and has
 * to be confirmed with the infrastructure team for the private bucket.
 * @param {Object} s  config.compliance.claims.attachments
 */
function createHttpTransport(s, http = axios) {
  const agent = s.verifyTls === false ? new https.Agent({ keepAlive: true, rejectUnauthorized: false }) : undefined;
  const headers = () => ({ Authorization: `Bearer ${s.token}` });
  const url = (template, key) => joinUrl(s.baseUrl, String(template).replace('{bucket}', s.bucket).replace('{key}', String(key).replace(/^\/+/, '')));

  return {
    configured: () => Boolean(s.baseUrl && s.bucket && s.token),

    /** Upload. ok only when the NAS answers { ok: true, path }. Never throws. */
    async put(filePath, key, ext) {
      try {
        const form = new FormData();
        form.append('key', key);
        form.append('file', fs.createReadStream(filePath), { filename: `${key.split('/').pop()}.${ext}` });
        const res = await http.post(joinUrl(s.baseUrl, String(s.uploadPath).replace('{bucket}', s.bucket)), form, {
          headers: { ...form.getHeaders(), ...headers() },
          timeout: s.timeoutMs,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          httpsAgent: agent,
          validateStatus: () => true,
        });
        if (res.data && res.data.ok && res.data.path) return { ok: true, status: res.status, path: res.data.path };
        return { ok: false, status: res.status, error: 'the NAS did not confirm the upload' };
      } catch (err) {
        return { ok: false, error: err.code || err.message || 'upload failed' };
      }
    },

    /**
     * Read a stored file as a stream. Never throws.
     * Every read carries a random query string (?cb=...). Checked on the real bucket: the origin is private (no token, 401), but the CDN in front of
     * it caches an AUTHORIZED answer for 7 days ("cache-control: public, max-age=604800, immutable") and then hands it to anyone who asks for the
     * same address, even after the file was deleted. A new address on every read means the plain address is never cached, so a delete is final and
     * nobody else can fetch what a reviewer read. (The infrastructure team should also stop the CDN from caching this bucket.)
     */
    async get(key, ext) {
      try {
        const plain = url(s.readPath, `${key}.${ext}`);
        const res = await http.get(`${plain}${plain.includes('?') ? '&' : '?'}cb=${crypto.randomBytes(6).toString('hex')}`, {
          headers: headers(), timeout: s.timeoutMs, responseType: 'stream', httpsAgent: agent, validateStatus: () => true,
        });
        if (res.status === 200) return { ok: true, status: 200, stream: res.data, size: Number(res.headers?.['content-length']) || null };
        if (res.data && typeof res.data.destroy === 'function') res.data.destroy();
        return { ok: false, status: res.status, error: res.status === 404 ? 'not_found' : 'read_failed' };
      } catch (err) {
        return { ok: false, error: err.code || err.message || 'read failed' };
      }
    },

    /** Delete. 2xx and 404 (already gone) are success. Never throws. */
    async del(key, ext) {
      try {
        const res = await http.delete(url(s.deletePath, `${key}.${ext}`), {
          headers: headers(), timeout: s.timeoutMs, httpsAgent: agent, validateStatus: () => true,
        });
        return { ok: (res.status >= 200 && res.status < 300) || res.status === 404, status: res.status };
      } catch (err) {
        return { ok: false, error: err.code || err.message || 'delete failed' };
      }
    },
  };
}

// ═══ 3. The repository (copyright_claim_files, in the claims' home database) ═══
const FILES_TABLE = 'copyright_claim_files';
const utc = (date = new Date()) => date.toISOString().slice(0, 19).replace('T', ' ');

const repository = {
  /** @returns {Promise<boolean>} true when the row was added (the slot (complaint, sha256) is unique, so a repeat adds nothing) */
  async insertFile(sql, r) {
    const now = utc();
    const result = await sql.query(
      `INSERT INTO ${FILES_TABLE}
         (complaint_id, file_id, storage, bucket, file_key, original_name, kind, mime, size_bytes, sha256, scan_status, status, uploaded_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'stored', ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [r.complaintId, r.fileId, r.storage, r.bucket, r.fileKey, r.originalName, r.kind, r.mime, r.sizeBytes, r.sha256, r.scanStatus, now, now, now]
    );
    return Boolean(result?.affectedRows);
  },
  async findBySha(sql, complaintId, sha256) {
    const rows = await sql.query(`SELECT file_id, status FROM ${FILES_TABLE} WHERE complaint_id = ? AND sha256 = ? LIMIT 1`, [complaintId, sha256]);
    return rows[0] || null;
  },
  async countFiles(sql, complaintId) {
    const rows = await sql.query(`SELECT COUNT(*) AS n FROM ${FILES_TABLE} WHERE complaint_id = ? AND status = 'stored'`, [complaintId]);
    return Number(rows[0]?.n) || 0;
  },
  async getFile(sql, complaintId, fileId) {
    const rows = await sql.query(
      `SELECT file_id, complaint_id, storage, bucket, file_key, original_name, kind, mime, size_bytes, sha256, scan_status, status, uploaded_at
         FROM ${FILES_TABLE} WHERE complaint_id = ? AND file_id = ? LIMIT 1`,
      [complaintId, fileId]
    );
    return rows[0] || null;
  },
  async listFiles(sql, complaintId) {
    return sql.query(
      `SELECT file_id, original_name, kind, mime, size_bytes, scan_status, uploaded_at
         FROM ${FILES_TABLE} WHERE complaint_id = ? AND status = 'stored' ORDER BY id LIMIT 50`,
      [complaintId]
    );
  },
  async markScan(sql, complaintId, fileId, scanStatus) {
    const result = await sql.query(
      `UPDATE ${FILES_TABLE} SET scan_status = ?, updated_at = ? WHERE complaint_id = ? AND file_id = ? AND status = 'stored'`,
      [scanStatus, utc(), complaintId, fileId]
    );
    return Boolean(result?.affectedRows);
  },
  /** The file stays as a record (nothing is deleted from the database); its bytes are gone from the NAS. */
  async markDeleted(sql, complaintId, fileId) {
    const now = utc();
    const result = await sql.query(
      `UPDATE ${FILES_TABLE} SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE complaint_id = ? AND file_id = ? AND status = 'stored'`,
      [now, now, complaintId, fileId]
    );
    return Boolean(result?.affectedRows);
  },
};

// ═══ 4. The service ═══
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {Object} deps
 * @param {Object} deps.settings   config.compliance.claims.attachments
 * @param {Object} [deps.transport]  { put, get, del } (default: the HTTP transport on those settings)
 * @param {Object} [deps.repo]       the repository above
 * @param {(filePath:string)=>Promise<'clean'|'infected'|'error'>} [deps.scanner]  a virus scan; with scan.required and no scanner a file stays "pending"
 * @param {Object} [deps.log]
 */
function createAttachmentService({ settings, transport, repo = repository, scanner, log, now = () => new Date(), randomId = () => crypto.randomUUID() }) {
  const s = settings;
  // The key of a file ends in its timestamp (milliseconds). A clock that has not moved since the last file (or has gone back) would give two
  // files of one claim the same key, and the NAS would overwrite the first: so each stamp is at least one millisecond after the one before.
  let lastStamp = 0;
  const stamp = () => { lastStamp = Math.max(now().getTime(), lastStamp + 1); return lastStamp; };
  const nas = transport || createHttpTransport(s);
  const logger = log || { info() {}, warn() {}, error() {} };
  const allowed = new Set((s.allowedTypes || []).filter((t) => TYPES[t]));

  const reject = (name, reason) => ({ ok: false, name, reason });

  /**
   * Store the files of one claim. `files` are files already on this server's disk (for example multer's temp files): { path, originalName }.
   * Files are handled one by one; one failing never stops the others. The caller removes its temp files afterwards.
   * @returns {Promise<{ ok: boolean, results: Array<{ ok, name, fileId?, duplicate?, reason? }> }>}
   */
  async function addFiles({ sql, complaintId, files }) {
    if (!UUID.test(String(complaintId || ''))) return { ok: false, error: 'invalid_complaint_id', results: [] };
    const list = Array.isArray(files) ? files : [];
    if (!list.length) return { ok: false, error: 'no_files', results: [] };
    if (!nas.configured || !nas.configured()) return { ok: false, error: 'not_configured', results: [] };

    const results = [];
    let stored = await repo.countFiles(sql, complaintId);
    for (const f of list) {
      const name = cleanName(f.originalName);
      try {
        const size = fs.statSync(f.path).size;
        if (size === 0) { results.push(reject(name, 'empty')); continue; }
        if (size > s.maxFileBytes) { results.push(reject(name, 'too_large')); continue; }

        const type = await sniffFile(f.path);
        if (!type || !allowed.has(type)) { results.push(reject(name, 'type_not_allowed')); continue; }
        const declared = declaredExtension(f.originalName);
        if (declared && declared !== type) { results.push(reject(name, 'extension_mismatch')); continue; }

        const sha256 = await sha256File(f.path);
        const same = await repo.findBySha(sql, complaintId, sha256);
        if (same && same.status === 'stored') { results.push({ ok: true, name, fileId: same.file_id, duplicate: true }); continue; }
        if (stored >= s.maxFiles) { results.push(reject(name, 'too_many_files')); continue; }

        let scanStatus = 'skipped';
        if (s.scan && s.scan.required) {
          scanStatus = 'pending';
          if (scanner) {
            const verdict = await scanner(f.path);
            if (verdict === 'infected') { results.push(reject(name, 'infected')); continue; }
            if (verdict !== 'clean') { results.push(reject(name, 'scan_failed')); continue; }
            scanStatus = 'clean';
          }
        }

        const fileId = randomId();
        const key = keyFor(complaintId, stamp());
        const put = await nas.put(f.path, key, type);
        if (!put.ok) {
          logger.warn('a claim file could not be stored in the private bucket', { status: put.status, error: put.error });
          results.push(reject(name, 'storage_failed'));
          continue;
        }

        const added = await repo.insertFile(sql, {
          complaintId, fileId, storage: 'nas', bucket: s.bucket, fileKey: `${key}.${type}`, originalName: name,
          kind: TYPES[type].kind, mime: TYPES[type].mime, sizeBytes: size, sha256, scanStatus,
        }).catch((err) => { logger.error('a claim file was stored but its record could not be written', { error: err.message }); return false; });
        if (!added) {
          await nas.del(key, type); // do not leave a file that nothing points to
          results.push(reject(name, 'record_failed'));
          continue;
        }
        stored += 1;
        results.push({ ok: true, name, fileId });
      } catch (err) {
        logger.error('a claim file could not be processed', { error: err.message });
        results.push(reject(name, 'failed'));
      }
    }
    return { ok: results.some((r) => r.ok), results };
  }

  /** The files of a claim for the admin panel: names and states only, never a key, a bucket or a URL. */
  async function listFiles({ sql, complaintId }) {
    const rows = await repo.listFiles(sql, complaintId);
    return rows.map((r) => ({
      fileId: r.file_id, name: r.original_name, kind: r.kind, mime: r.mime, size: Number(r.size_bytes), scanStatus: r.scan_status, uploadedAt: r.uploaded_at,
    }));
  }

  /**
   * Open a stored file for a reviewer (the admin route has already checked the login and the role). Returns the stream and the headers to send.
   * A file whose scan is not clean is refused while scanning is required.
   */
  async function openFile({ sql, complaintId, fileId }) {
    const row = UUID.test(String(fileId || '')) ? await repo.getFile(sql, complaintId, fileId) : null;
    if (!row || row.status !== 'stored') return { ok: false, error: 'not_found' };
    if (s.scan && s.scan.required && row.scan_status !== 'clean') return { ok: false, error: 'scan_pending' };
    const ext = extOfRow(row);
    const key = String(row.file_key).slice(0, -(ext.length + 1));
    const got = await nas.get(key, ext);
    if (!got.ok) return { ok: false, error: got.error === 'not_found' ? 'not_found' : 'unavailable' };
    return { ok: true, stream: got.stream, headers: downloadHeaders(row) };
  }

  /** Remove a file's bytes from the NAS and mark its record deleted (the record stays). */
  async function deleteFile({ sql, complaintId, fileId }) {
    const row = UUID.test(String(fileId || '')) ? await repo.getFile(sql, complaintId, fileId) : null;
    if (!row || row.status !== 'stored') return { ok: false, error: 'not_found' };
    const ext = extOfRow(row);
    const gone = await nas.del(String(row.file_key).slice(0, -(ext.length + 1)), ext);
    if (!gone.ok) return { ok: false, error: 'unavailable' };
    await repo.markDeleted(sql, complaintId, fileId);
    return { ok: true };
  }

  return { addFiles, listFiles, openFile, deleteFile, isEnabled: () => s.enabled === true };
}

module.exports = {
  TYPES, detectType, sniffFile, sha256File, cleanName, declaredExtension, keyFor, downloadHeaders,
  createHttpTransport, repository, FILES_TABLE, createAttachmentService,
};
