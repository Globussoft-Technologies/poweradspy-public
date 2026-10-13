'use strict';

/**
 * Ad Studio API client — thin wrapper over the 2 real documented endpoints
 * (AD_STUDIO_API_CONTRACT.md). No auth header (server-to-server trust, confirmed).
 *
 * Only `generateImage` + `getJob` are used by this feature round. `baseUrl`/
 * `timeoutMs` are config-driven (src/services/imageGen/config.js) — nothing
 * hardcoded here.
 *
 * Deliberately NOT reusing src/insertion/helpers/httpClient.js: that helper's
 * postJson() only treats a literal HTTP 200 as success (PHP-mirroring behavior for
 * the insertion domain), but Ad Studio's generate endpoint succeeds with 202
 * (Accepted) — forcing it through that helper would misclassify every successful
 * submission as a failure.
 */

const axios = require('axios');
const imageGenConfig = require('./../config');

function client() {
  return axios.create({
    baseURL: imageGenConfig.adStudio.baseUrl,
    timeout: imageGenConfig.adStudio.timeoutMs,
    headers: { 'Content-Type': 'application/json' },
    validateStatus: () => true, // inspect status ourselves, never throw on 4xx/5xx
  });
}

/**
 * POST /api/v1/images/ — starts an image generation job.
 * @returns {Promise<{ok:true, jobId:string, status:string} | {ok:false, status:number, body:any}>}
 */
async function generateImage({ prompt, imageUrls, model, aspectRatio, resolution, userId, sessionId, watermark }) {
  const body = {};
  if (prompt) body.prompt = prompt;
  if (imageUrls && imageUrls.length) body.image_urls = imageUrls;
  if (model) body.model = model;
  if (aspectRatio) body.aspect_ratio = aspectRatio;
  if (resolution) body.resolution = resolution;
  if (userId) body.user_id = String(userId);
  if (sessionId) body.session_id = sessionId;
  if (watermark !== undefined) body.watermark = watermark;

  const res = await client().post('/api/v1/images/', body);
  if ((res.status === 200 || res.status === 202) && res.data && res.data.job_id) {
    return { ok: true, jobId: res.data.job_id, status: res.data.status || 'queued' };
  }
  return { ok: false, status: res.status, body: res.data };
}

/**
 * GET /api/v1/jobs/{job_id} — poll job status/result.
 * @returns {Promise<{ok:true, status:string, result?:Object, error?:string, error_code?:string, user_message?:string} | {ok:false, status:number, body:any}>}
 */
async function getJob(jobId) {
  const res = await client().get(`/api/v1/jobs/${encodeURIComponent(jobId)}`);
  if (res.status === 200 && res.data && res.data.status) {
    return { ok: true, ...res.data };
  }
  return { ok: false, status: res.status, body: res.data };
}

module.exports = { generateImage, getJob };
