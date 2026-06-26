'use strict';

/**
 * nasHttpUpload — shared multipart HTTP upload to the NAS media endpoint.
 *
 * This is the "old method" (faithful port of PHP helper::StoreInNAS2): POST the file to
 * {base}{uploadPath} with a Bearer token and a multipart body of { key, file }. The NAS
 * validates the extension, appends it, and returns { ok, path }.
 *
 * Two bases share this exact contract (chosen per network/type by config.insertion.nas.uploadTransport):
 *   - 'http'       → mediaUrl  (media.globussoft.com, Cloudflare-fronted — small files only; Cloudflare
 *                    413s any body >~100MB, which is why VIDEO must NOT use this base).
 *   - 'httpOrigin' → originUrl (the origin IP directly, e.g. http://125.16.67.186:8119) — Cloudflare is
 *                    out of the path, so there is NO ~100MB cap; large video can upload over HTTP.
 *
 * Extracted into its own module so BOTH nasClient (in-request) and nasUploadQueue (background retry)
 * can call it without a circular require (nasClient ↔ nasUploadQueue).
 */

const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');
const https = require('https');
const config = require('../../config');

const nas = () => config.insertion.nas;

/** Join a base URL and a path, avoiding double/missing slashes. */
function joinUrl(base, pathPart) {
  return `${String(base).replace(/\/+$/, '')}/${String(pathPart).replace(/^\/+/, '')}`;
}

function nasAgent() {
  // PHP uses verify:false. Honour config.insertion.nas.verifyTls. A direct-IP (httpOrigin) base
  // has no valid cert for the IP, so verifyTls must stay false for it.
  return nas().verifyTls ? undefined : new https.Agent({ keepAlive: true, rejectUnauthorized: false });
}

/** Resolve the bucket the same way nasClient does (explicit override → env-derived). */
function resolveBucket() {
  if (nas().bucket) return nas().bucket;
  return config.env === 'production' ? 'pas-prod' : 'pas-dev';
}

/**
 * Build the absolute upload URL for a transport.
 * @param {'http'|'httpOrigin'} transport
 * @returns {string|null} the URL, or null if that transport isn't configured (no base set).
 */
function uploadUrlFor(transport) {
  const n = nas();
  const base = transport === 'httpOrigin' ? n.originUrl : n.mediaUrl;
  if (!base) return null;
  const mediaPath = (n.mediaUploadPath || '/{bucket}/upload').replace('{bucket}', resolveBucket());
  return joinUrl(base, mediaPath);
}

/**
 * POST a local file to a NAS HTTP endpoint. Single attempt (callers add retry/defer policy).
 *
 * @param {string} filePath  absolute path to the local file
 * @param {string} url       absolute upload URL (from uploadUrlFor)
 * @param {string} key       NAS key WITHOUT extension (e.g. 'fb/adImage/202606/123')
 * @param {string} fileName  filename WITH real extension (e.g. '123.jpg')
 * @param {number} [timeoutMs]
 * @returns {Promise<{ok:boolean, status:number, path?:string, body?:any}>}
 *   ok=true only when the NAS returns { ok:true, path }. Never throws on an HTTP error status;
 *   throws only on a hard network error (so the caller can treat it the same as a retryable failure).
 */
async function httpUpload(filePath, url, key, fileName, timeoutMs) {
  const form = new FormData();
  form.append('key', key);
  form.append('file', fs.createReadStream(filePath), { filename: fileName });

  const res = await axios.post(url, form, {
    headers: { ...form.getHeaders(), Authorization: `Bearer ${nas().mediaToken}` },
    timeout: timeoutMs || nas().uploadTimeoutMs || 15000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    httpsAgent: nasAgent(),
    validateStatus: () => true,
  });

  if (res.data && res.data.ok && res.data.path) {
    return { ok: true, status: res.status, path: res.data.path };
  }
  return { ok: false, status: res.status, body: res.data };
}

module.exports = { httpUpload, uploadUrlFor, resolveBucket, joinUrl };
