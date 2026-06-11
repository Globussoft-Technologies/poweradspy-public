'use strict';

const axios = require('axios');

/**
 * Extracts the TikTok ad_id from a Creative Center library URL.
 * Example: https://ads.tiktok.com/business/creativecenter/topads/7569968978819874817/pc/en?countryCode=GB&period=30
 * → returns '7569968978819874817'
 */
function extractAdIdFromLibraryUrl(libraryUrl) {
  if (!libraryUrl) return null;
  const match = libraryUrl.match(/\/topads\/(\d+)\//);
  return match ? match[1] : null;
}

/**
 * Extracts country code and period from the library URL query params.
 */
function extractParamsFromUrl(libraryUrl) {
  try {
    const url = new URL(libraryUrl);
    return {
      countryCode: url.searchParams.get('countryCode') || 'US',
      period: url.searchParams.get('period') || '30',
    };
  } catch {
    return { countryCode: 'US', period: '30' };
  }
}

/**
 * Parse Set-Cookie headers into a cookie string for subsequent requests.
 */
function extractCookies(setCookieHeaders) {
  if (!setCookieHeaders) return '';
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  return headers
    .map(h => h.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

/**
 * Strict check: is this a real TikTok VIDEO URL (not an image/cover/thumbnail)?
 *
 * TikTok video URLs have specific patterns:
 *   - Path contains `/video/tos/` (video transcoding service)
 *   - OR `mime_type=video_mp4` query param
 *   - OR ends with `.mp4`
 *
 * IMAGE/COVER URLs have these patterns and MUST be rejected:
 *   - `tplv-noop.image`, `.image?` (image transcode endpoint)
 *   - `/tos-alisg-p-`, `/tos-alisg-i-` (p = picture, i = image)
 *   - `tplv-` followed by image processing
 *   - Even if they have `VideoID=` query param (misleading!)
 */
function isVideoUrl(url) {
  if (typeof url !== 'string') return false;
  if (!url.startsWith('http')) return false;

  const isTikTokDomain =
    url.includes('tiktokcdn') ||
    url.includes('byteoversea') ||
    url.includes('tiktokv.com');
  if (!isTikTokDomain) return false;

  // Hard exclusions — image/cover endpoints
  const lower = url.toLowerCase();
  if (
    lower.includes('.image?') ||
    lower.includes('.image&') ||
    lower.includes('tplv-noop.image') ||
    lower.includes('/tos-alisg-p-') || // p = picture
    lower.includes('/tos-alisg-i-') || // i = image
    lower.includes('/img/tos/') ||
    lower.includes('/image/tos/')
  ) {
    return false;
  }

  // Strict positive matches — must be one of these
  const isVideoPath =
    lower.includes('/video/tos/') ||
    /tos-[a-z0-9]+-ve-/.test(lower); // ve = video
  const hasVideoMime = lower.includes('mime_type=video');
  const isMp4 = lower.includes('.mp4') || lower.includes('video_mp4');

  return isVideoPath || hasVideoMime || isMp4;
}

/**
 * Try to find a video URL in any object/string by deep-searching common field names.
 */
function deepFindVideoUrl(obj, depth = 0) {
  if (!obj || depth > 10) return null;

  if (typeof obj === 'string') {
    return isVideoUrl(obj) ? obj : null;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFindVideoUrl(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof obj === 'object') {
    // Priority keys first
    const priorityKeys = ['video_url', 'play_url', 'play_addr', 'download_url', 'url', 'url_list'];
    for (const key of priorityKeys) {
      if (obj[key]) {
        const val = obj[key];
        if (typeof val === 'string' && isVideoUrl(val)) {
          return val;
        }
        if (Array.isArray(val)) {
          for (const u of val) {
            if (typeof u === 'string' && isVideoUrl(u)) {
              return u;
            }
          }
        }
        const found = deepFindVideoUrl(val, depth + 1);
        if (found) return found;
      }
    }
    // Then search all other keys
    for (const key of Object.keys(obj)) {
      if (priorityKeys.includes(key)) continue;
      const found = deepFindVideoUrl(obj[key], depth + 1);
      if (found) return found;
    }
  }

  return null;
}

/**
 * POST /api/v1/tiktok/ads/refresh-video
 *
 * Body: { library_url: "https://ads.tiktok.com/business/creativecenter/topads/..." }
 *
 * Strategy:
 *   1. Visit the TikTok Creative Center page to get session cookies
 *   2. Use those cookies to call TikTok's internal detail API
 *   3. Deep-search the response for a valid video URL
 */
async function refreshVideoUrl(req, db, log) {
  const { library_url } = req.body;

  if (!library_url) {
    return { code: 400, message: 'library_url is required' };
  }

  const adId = extractAdIdFromLibraryUrl(library_url);
  if (!adId) {
    return { code: 400, message: 'Could not extract ad_id from library_url' };
  }

  const { countryCode, period } = extractParamsFromUrl(library_url);

  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };

  // ─── Step 1: Visit the page to obtain session cookies ──────
  let cookies = '';
  try {
    log.info(`[tiktok-video-refresh] Step 1: Visiting page for cookies, ad_id=${adId}`);
    
    const pageRes = await axios.get(library_url, {
      headers: browserHeaders,
      timeout: 15000,
      maxRedirects: 5,
      // Don't parse body, we only need cookies
      transformResponse: [(data) => data],
      validateStatus: () => true, // Accept any status
    });

    cookies = extractCookies(pageRes.headers['set-cookie']);
    log.info(`[tiktok-video-refresh] Got ${cookies ? cookies.split(';').length : 0} cookies`);

    // Also try to find video URL in the page HTML itself (SSR data)
    if (typeof pageRes.data === 'string') {
      const htmlVideoUrl = deepFindVideoUrl(pageRes.data);
      if (htmlVideoUrl) {
        log.info(`[tiktok-video-refresh] Found video URL in page HTML for ad_id=${adId}`);
        return { code: 200, data: { video_url: htmlVideoUrl } };
      }

      // Try to parse __NEXT_DATA__ or similar JSON embeds
      const nextDataMatch = pageRes.data.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (nextDataMatch) {
        try {
          const nextData = JSON.parse(nextDataMatch[1]);
          const videoUrl = deepFindVideoUrl(nextData);
          if (videoUrl) {
            log.info(`[tiktok-video-refresh] Found video URL in __NEXT_DATA__ for ad_id=${adId}`);
            return { code: 200, data: { video_url: videoUrl } };
          }
        } catch {}
      }

      // Try generic JSON in script tags — extract ALL candidate URLs and validate each
      const scriptMatches = pageRes.data.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g);
      for (const m of scriptMatches) {
        const content = m[1];
        if (!(content.includes('tiktokcdn') || content.includes('video_url') || content.includes('play_addr'))) continue;
        // Extract ALL TikTok CDN URLs and validate each via isVideoUrl
        const urlPattern = /https?:\/\/[^\s"'\\<>]+(?:tiktokcdn|byteoversea|tiktokv)[^\s"'\\<>]*/g;
        const allUrls = content.match(urlPattern) || [];
        for (const rawUrl of allUrls) {
          const cleanUrl = rawUrl.replace(/\\u002F/g, '/').replace(/\\\//g, '/');
          if (isVideoUrl(cleanUrl)) {
            log.info(`[tiktok-video-refresh] Found video URL in script tag for ad_id=${adId}`);
            return { code: 200, data: { video_url: cleanUrl } };
          }
        }
      }
    }
  } catch (pageErr) {
    log.warn(`[tiktok-video-refresh] Page visit failed: ${pageErr.message}`);
  }

  // ─── Step 2: Call internal API with session cookies ──────
  const apiEndpoints = [
    `https://ads.tiktok.com/creative_radar_api/v1/top_ads/v2/detail`,
    `https://ads.tiktok.com/creative_radar_api/v1/top_ads/detail`,
  ];

  for (const apiBase of apiEndpoints) {
    try {
      const apiUrl = `${apiBase}?ad_id=${adId}&country_code=${countryCode}&period=${period}`;
      log.info(`[tiktok-video-refresh] Step 2: Calling API → ${apiBase}`);

      const apiRes = await axios.get(apiUrl, {
        headers: {
          'User-Agent': browserHeaders['User-Agent'],
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': library_url,
          'Origin': 'https://ads.tiktok.com',
          'Cookie': cookies,
          'Sec-Ch-Ua': browserHeaders['Sec-Ch-Ua'],
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
        },
        timeout: 15000,
      });

      log.info(`[tiktok-video-refresh] API response code: ${apiRes.data?.code}, msg: ${apiRes.data?.msg || 'OK'}`);

      if (apiRes.data && (apiRes.data.code === 0 || apiRes.data.code === 200)) {
        const videoUrl = deepFindVideoUrl(apiRes.data);
        if (videoUrl) {
          log.info(`[tiktok-video-refresh] ✓ Got fresh video URL from API for ad_id=${adId}`);
          return { code: 200, data: { video_url: videoUrl } };
        }
        log.warn(`[tiktok-video-refresh] API returned success but no video URL found in response`);
      }
    } catch (apiErr) {
      log.warn(`[tiktok-video-refresh] API call failed: ${apiErr.message}`);
    }
  }

  // ─── Step 3: Try the list/search API to find this ad ──────
  try {
    log.info(`[tiktok-video-refresh] Step 3: Trying search API for ad_id=${adId}`);

    const searchUrl = `https://ads.tiktok.com/creative_radar_api/v1/top_ads/v2/list`;
    const searchRes = await axios.get(searchUrl, {
      params: {
        page: 1,
        limit: 1,
        period: parseInt(period) || 30,
        country_code: countryCode,
        order_by: 'ctr',
        ad_id: adId,
      },
      headers: {
        'User-Agent': browserHeaders['User-Agent'],
        'Accept': 'application/json',
        'Referer': 'https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en',
        'Origin': 'https://ads.tiktok.com',
        'Cookie': cookies,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
      timeout: 15000,
    });

    if (searchRes.data && (searchRes.data.code === 0 || searchRes.data.code === 200)) {
      const videoUrl = deepFindVideoUrl(searchRes.data);
      if (videoUrl) {
        log.info(`[tiktok-video-refresh] ✓ Got fresh video URL from search API for ad_id=${adId}`);
        return { code: 200, data: { video_url: videoUrl } };
      }
    }
  } catch (searchErr) {
    log.warn(`[tiktok-video-refresh] Search API failed: ${searchErr.message}`);
  }

  log.error(`[tiktok-video-refresh] All strategies exhausted for ad_id=${adId}`);
  return {
    code: 404,
    message: 'Could not retrieve fresh video URL. The TikTok Creative Center API requires browser-level authentication.',
  };
}

module.exports = { refreshVideoUrl };
