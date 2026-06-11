'use strict';

const axios = require('axios');

// SSRF guard: only proxy hostnames that are unambiguously TikTok CDN.
// Matches the domain set used by isVideoUrl in videoRefreshController.
const ALLOWED_HOST_SUFFIXES = [
  '.tiktokcdn.com',
  '.tiktokcdn-us.com',
  '.byteoversea.com',
  '.tiktokv.com',
];

function isAllowedTikTokCdnHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return false;
  return ALLOWED_HOST_SUFFIXES.some((suf) => h === suf.slice(1) || h.endsWith(suf));
}

// Response headers we forward verbatim so video playback / seeking works.
const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'content-encoding',
  'accept-ranges',
  'cache-control',
  'last-modified',
  'etag',
];

/**
 * GET /api/v1/tiktok/ads/video-proxy?url=<encoded_tiktok_cdn_url>
 *
 * Streams a TikTok CDN video through this server so the browser <video> tag
 * isn't blocked by TikTok's Referer-based 403. Auth-less by design (referenced
 * directly from <video src>); SSRF is contained by a TikTok-only host allowlist.
 */
async function proxyTikTokVideo(req, res, log) {
  const targetUrl = typeof req.query?.url === 'string' ? req.query.url : '';
  if (!targetUrl) {
    return res.status(400).json({ code: 400, message: 'url query param is required' });
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return res.status(400).json({ code: 400, message: 'url is not a valid URL' });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return res.status(400).json({ code: 400, message: 'url must be http(s)' });
  }

  if (!isAllowedTikTokCdnHost(parsed.hostname)) {
    log?.warn?.(`[tiktok-video-proxy] blocked non-TikTok host: ${parsed.hostname}`);
    return res.status(403).json({ code: 403, message: 'host not allowed' });
  }

  const upstreamHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': '*/*',
  };
  if (req.headers && req.headers.range) {
    upstreamHeaders.Range = req.headers.range;
  }

  let upstream;
  try {
    upstream = await axios.get(targetUrl, {
      headers: upstreamHeaders,
      responseType: 'stream',
      timeout: 15000,
      maxRedirects: 5,
      decompress: false,
      validateStatus: () => true,
    });
  } catch (err) {
    log?.error?.(`[tiktok-video-proxy] upstream request failed: ${err.message}`);
    return res.status(502).json({ code: 502, message: 'upstream fetch failed' });
  }

  res.status(upstream.status);
  for (const h of FORWARD_RESPONSE_HEADERS) {
    const v = upstream.headers?.[h];
    if (v !== undefined) res.setHeader(h, v);
  }

  upstream.data.on('error', (err) => {
    log?.warn?.(`[tiktok-video-proxy] upstream stream error: ${err.message}`);
    if (!res.headersSent) res.status(502);
    res.end();
  });

  upstream.data.pipe(res);
}

module.exports = { proxyTikTokVideo, isAllowedTikTokCdnHost };
