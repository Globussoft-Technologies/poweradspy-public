import fs from "fs";
import path from "path";
import https from "https";
import logger from "../resources/logs/logger.log.js";
import sharp from "sharp";
import FormData from "form-data";
import axios from "axios";
import config from "config";

/**
 * NAS media upload — ported to the NEWER NAS contract already used by Facebook/Instagram
 * (pas_node_api helper::StoreInNAS2 / nasClient + nasHttpUpload).
 *
 * What changed from the old NAS:
 *   - Endpoint is `{base}{mediaUploadPath}` (default `/{bucket}/upload`) — not a single `nas_url`.
 *   - Requests carry `Authorization: Bearer <token>`.
 *   - Multipart body is `{ key, file }` (deterministic, id-based key) — not `{ files, adId, network, type, mode }`.
 *   - The key is `<networkPrefix>/<typeSubfolder>/<YYYYMM>/<baseName>`, so the stored path is
 *     deterministic (`/<bucket>/stream/<key>.<ext>`).
 *   - Upload walks an ORDERED transport FALLBACK CHAIN (http → httpOrigin) with a couple of retries
 *     on transient statuses, so a Cloudflare/edge blip falls back to the origin instead of failing.
 *
 * Required config (flat keys, same style as the rest of this service):
 *   nas_media_url          Cloudflare-fronted media base, e.g. https://media.globussoft.com   (transport 'http')
 *   nas_origin_url         direct origin base, e.g. http://125.16.67.186:8119                  (transport 'httpOrigin')
 *   nas_media_token        Bearer token for the upload endpoint
 *   nas_bucket             bucket name, e.g. pas-prod / pas-dev (falls back to NODE_ENV if unset)
 *   nas_media_upload_path  upload path template (default '/{bucket}/upload')
 *   nas_upload_transport   ordered transport list (default ['http','httpOrigin'])
 *   nas_verify_tls         verify NAS TLS cert (default false — origin is a direct IP with no valid cert)
 *   nas_upload_timeout_ms  per-attempt timeout in ms (default 15000)
 */

// Per-network NAS key prefix (Media Upload API: Network → NAS folder).
const NAS_KEY_PREFIX = {
  facebook: "fb",
  instagram: "insta",
  pinterest: "pint",
  reddit: "reddit",
  google: "gt",
  gdn: "gdn",
  native: "native",
  tiktok: "tiktok",
  youtube: "yt",
  linkedin: "linkedin",
  quora: "quora",
  bing: "bing",
};

// Upload type → NAS subfolder (matches PHP $typeMap).
const TYPE_SUBFOLDER = {
  IMAGE: "adImage/",
  VIDEO: "adVideo/",
  THUMBNAIL: "thumbnail/",
  POSTOWNER: "postowner/",
  OTHERMULTIMEDIA: "otherMultiMedia/",
  LANDERS: "landers/",
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const UPLOAD_MAX_ATTEMPTS = 2; // in-request HTTP attempts per transport before falling through
const UPLOAD_RETRY_BASE_MS = 300; // backoff between in-request attempts
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Read a flat config key, returning `fallback` when it is not defined. */
function cfg(key, fallback) {
  return config.has(key) ? config.get(key) : fallback;
}

/** YYYYMM for the upload key, in UTC (matches PHP date('Ym') grouping). */
function yearMonth() {
  const d = new Date();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${d.getUTCFullYear()}${m}`;
}

/** Join a base URL and a path, avoiding double/missing slashes. */
function joinUrl(base, pathPart) {
  return `${String(base).replace(/\/+$/, "")}/${String(pathPart).replace(/^\/+/, "")}`;
}

/** Bucket: explicit config override, else env-derived (production → pas-prod, else pas-dev). */
function resolveBucket() {
  const explicit = cfg("nas_bucket", "");
  if (explicit) return explicit;
  return process.env.NODE_ENV === "production" ? "pas-prod" : "pas-dev";
}

/** Base URL for a transport, or null when that transport is not configured. */
function baseFor(transport) {
  return transport === "httpOrigin" ? cfg("nas_origin_url", "") : cfg("nas_media_url", "");
}

/** Absolute upload URL for a transport (null if the base is unset). */
function uploadUrlFor(transport) {
  const base = baseFor(transport);
  if (!base) return null;
  const mediaPath = String(cfg("nas_media_upload_path", "/{bucket}/upload")).replace(
    "{bucket}",
    resolveBucket()
  );
  return joinUrl(base, mediaPath);
}

/** Ordered, de-duplicated, usable transport chain (default ['http','httpOrigin']). */
function transportChain() {
  const raw = cfg("nas_upload_transport", ["http", "httpOrigin"]);
  const list = (Array.isArray(raw) ? raw : String(raw).split(","))
    .map((t) => String(t || "").trim().toLowerCase())
    .map((t) => (t === "httporigin" || t === "http-origin" || t === "origin" ? "httpOrigin" : t))
    .filter((t) => t === "http" || t === "httpOrigin");
  const seen = new Set();
  const chain = list.filter((t) => baseFor(t) && !seen.has(t) && seen.add(t));
  if (chain.length) return chain;
  // Nothing configured matched — use whichever base IS set so media is never silently dropped.
  return ["http", "httpOrigin"].filter((t) => baseFor(t));
}

/** HTTPS agent honouring nas_verify_tls (origin is a direct IP → cert can't verify, keep false). */
function nasAgent() {
  return cfg("nas_verify_tls", false)
    ? undefined
    : new https.Agent({ keepAlive: true, rejectUnauthorized: false });
}

/**
 * POST a buffer to a NAS HTTP endpoint. Single attempt (caller adds retry/fallback policy).
 * @returns {Promise<{ok:boolean, status:number, path?:string, body?:any}>}
 *   ok=true only when the NAS returns { ok:true, path }. Never throws on an HTTP status;
 *   throws only on a hard network error so the caller can treat it as a retryable failure.
 */
async function httpUpload(buffer, fileName, url, key, timeoutMs) {
  const form = new FormData();
  form.append("key", key);
  form.append("file", buffer, { filename: fileName });

  const res = await axios.post(url, form, {
    headers: { ...form.getHeaders(), Authorization: `Bearer ${cfg("nas_media_token", "")}` },
    timeout: timeoutMs || Number(cfg("nas_upload_timeout_ms", 15000)),
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

/**
 * Read the first file from `tempFolderPath`, convert it to webp, and upload it to NAS using
 * the newer contract. Keeps the original signature so callers (tiktok.service getS3Url) are
 * unchanged.
 *
 * @param {string} tempFolderPath folder holding exactly the file to upload
 * @param {string|number} ad_id   ad id — becomes the deterministic key base name
 * @param {string} network        network slug, e.g. 'tiktok'
 * @param {string} type           IMAGE | VIDEO | THUMBNAIL | POSTOWNER | …
 * @returns {Promise<string>}      the stored NAS path
 */
export async function uploadFile(tempFolderPath, ad_id, network, type) {
  try {
    const files = await fs.promises.readdir(tempFolderPath);

    if (files.length === 0) {
      const errorMsg = "No files found in the temp folder.";
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    const filePath = path.join(tempFolderPath, files[0]);
    const fileBuffer = await fs.promises.readFile(filePath);
    const webpBuffer = await sharp(fileBuffer).webp({ quality: 4 }).toBuffer();

    // Build the deterministic key: <prefix>/<subfolder>/<YYYYMM>/<baseName>.
    // NAS key segments allow only A-Z a-z 0-9 '.' '_' '-'.
    const folder = String(type || "").toUpperCase();
    const keyPrefix = NAS_KEY_PREFIX[network] || network;
    const subfolder = TYPE_SUBFOLDER[folder] || "adImage/";
    const baseName = String(ad_id).replace(/[^A-Za-z0-9._-]/g, "");
    const fileExt = "webp"; // we always upload the webp-converted buffer
    const fileName = `${baseName}.${fileExt}`;
    const key = `${keyPrefix}/${subfolder}${yearMonth()}/${baseName}`;
    // Deterministic predicted path — the CDN serves /<bucket>/stream/<key>.<ext>, exactly where the
    // upload lands the file. Used as the fallback return when the NAS answers ok but omits the path.
    const storedPath = `/${resolveBucket()}/stream/${key}.${fileExt}`;

    const chain = transportChain();
    if (chain.length === 0) {
      throw new Error(
        "NAS upload not configured: set nas_media_url and/or nas_origin_url."
      );
    }

    // Walk the transport chain (http first, httpOrigin fallback), a couple of retries per transport
    // on transient statuses.
    let lastErr = "no transport attempted";
    for (const transport of chain) {
      const url = uploadUrlFor(transport);
      if (!url) {
        lastErr = `transport '${transport}' not configured`;
        continue;
      }
      for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt++) {
        try {
          const r = await httpUpload(webpBuffer, fileName, url, key);
          if (r.ok) return r.path; // NAS-returned path (same format as storedPath)
          if (r.status === 200 || r.status === 201) return storedPath; // stored, path omitted
          lastErr = `http status=${r.status}`;
          if (RETRYABLE_STATUS.has(r.status) && attempt < UPLOAD_MAX_ATTEMPTS) {
            await sleep(UPLOAD_RETRY_BASE_MS * attempt);
            continue;
          }
          break; // non-retryable status → try the next transport in the chain
        } catch (err) {
          lastErr = err.message || String(err); // network/timeout → next attempt / transport
          if (attempt < UPLOAD_MAX_ATTEMPTS) {
            await sleep(UPLOAD_RETRY_BASE_MS * attempt);
            continue;
          }
        }
      }
    }

    // Whole chain exhausted — surface the failure (caller decides how to handle it).
    throw new Error(`NAS upload failed (all transports): ${lastErr}`);
  } catch (error) {
    logger.error("Error uploading file:", error.message || error);
    throw error;
  }
}
