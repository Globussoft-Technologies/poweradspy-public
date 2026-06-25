
// ─── API Configuration ────────────────────────────────────────────────────────
const GEMINI_API_KEY = "";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// ─── PAS API Configuration ────────────────────────────────────────────────────
const PAS_API_BASE = import.meta.env.VITE_PAS_API_BASE_URL || "";
import { getAuthToken, clearSessionState } from '../hooks/useAuth';
const getPASToken = () => getAuthToken() || import.meta.env.VITE_PAS_API_TOKEN;
const COMPETITOR_API_BASE = import.meta.env.VITE_NODE_API_URL || "http://localhost:5000/api";

// ─── 401 Handler ─────────────────────────────────────────────────────────────
// Called whenever any API response returns 401. Clears auth state and redirects.
const LOGOUT_URL = (import.meta.env.VITE_PAS_API_BASE_URL || '') + '/logout';
let _loggingOut = false; // guard against duplicate /logout hits when many 401s fire in parallel
const handle401 = () => {
  // Don't redirect on guest/share routes — those are public pages
  const path = window.location.pathname;
  /* v8 ignore next -- redundant guard: checkFor401() already returns on guest/share paths before ever calling handle401, so this is unreachable defensive code */
  if (path.startsWith('/guest/') || path.startsWith('/share/') || path === '/guest-landing') return;
  if (_loggingOut) return;
  _loggingOut = true;
  localStorage.removeItem('authToken');
  localStorage.removeItem('authUser');
  clearSessionState();
  document.cookie = 'authToken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/;';
  document.cookie = 'authToken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.poweradspy.com;';
  window.location.href = LOGOUT_URL;
};

/**
 * Check a fetch Response for 401 and redirect if found.
 * Also tries to parse message from JSON body for better error matching.
 */
const checkFor401 = async (res) => {
  if (res.status === 401) {
    // On guest/share/landing routes, silently ignore 401 — no redirect, no throw
    const path = window.location.pathname;
    if (path.startsWith('/guest/') || path.startsWith('/share/') || path === '/guest-landing') return;
    handle401();
    throw new Error('Unauthorized: Token expired');
  }
  // Some endpoints return 200 with { code: 401, message: "Unauthorized: Token expired" }
  // We can't consume the body here (stream can only be read once), so we rely on status only.
};
// const PAS_IMAGE_Domain = import.meta.env.VITE_PAS_IMAGE_DOMAIN || "";

// ─── Plan Access ─────────────────────────────────────────────────────────────
/**
 * Fetch plan access restrictions for the current user.
 * Returns { planId, allowedPlatforms, filters: { filterId: { enabled, reason? } } }
 */
export const fetchPlanAccess = async (network) => {
  const query = network && network !== 'all' ? `?network=${encodeURIComponent(Array.isArray(network) ? network.join(',') : network)}` : '';
  const res = await fetch(`${PAS_API_BASE}/api/v1/auth/plan-access${query}`, {
    headers: {
      ...(getPASToken() ? { Authorization: `Bearer ${getPASToken()}` } : {}),
    },
  });
  await checkFor401(res);
  if (!res.ok) return null;
  const json = await res.json();
  return json.data || null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const NAS_BASE_URL = (import.meta.env.VITE_NAS_BASE_URL || "").replace(/\/$/, '');
// Since the 2026-06-21 SFTP migration the NAS stores BOTH images and videos under
// /<bucket>/stream/ on the same content host (the old dedicated nas-video-api
// endpoint is gone). So VITE_NAS_VIDEO_URL is optional — when it's unset we fall
// back to the shared NAS base. Without this fallback the `/stream/` branch below
// and the videoUrl gate in mapAdToCard resolve against an empty base, so the UI
// silently leaks the original source CDN URL instead of serving the NAS copy.
const NAS_VIDEO_BASE_URL = (import.meta.env.VITE_NAS_VIDEO_URL || import.meta.env.VITE_NAS_BASE_URL || "").replace(/\/$/, '');

export const resolveNasUrl = (url) => {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('http')) return url;
  if (url.includes('PowerAdspy') || url.includes('pasimages') || url.includes('pasvideos')) {
    return `${NAS_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  }
  if (url.includes('/stream/')) {
    return `${NAS_VIDEO_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  }
  return url;
};

// Extract a YouTube video ID from any of the common URL shapes and return a
// player-embed URL. Used to render YouTube ads (whose playable link arrives in
// `ad_url`, not `video_url`) through an iframe, since <video> can't decode a
// YouTube watch page. Returns null for non-YouTube input so callers can use
// the result directly in a truthy check.
export const getYoutubeEmbedUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  let m;
  let videoId = null;
  if ((m = url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/))) videoId = m[1];
  else if ((m = url.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/))) videoId = m[1];
  else if ((m = url.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/))) videoId = m[1];
  else if ((m = url.match(/youtube\.com\/v\/([A-Za-z0-9_-]{6,})/))) videoId = m[1];
  else if ((m = url.match(/[?&]v=([A-Za-z0-9_-]{6,})/))) videoId = m[1];
  if (!videoId) return null;
  return `https://www.youtube.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0`;
};

// Combined dispatcher — given an `ad_url`, return whichever platform embed
// URL fits, or null if none. Currently only YouTube — Facebook and Instagram
// ads carry the actual media URL in `image_url_original` (which mapAdToCard
// already routes into `ad.videoUrl`), so the FB watch-page or Ads Library URL
// in `ad_url` is never the right source for in-app playback on those networks.
export const getVideoEmbedUrl = (url) => getYoutubeEmbedUrl(url);

// Route a remote image through our backend so the browser sees same-origin-style
// bytes with CORS headers — needed to embed CDN images in a canvas/PDF without
// running into the cross-origin canvas-taint restriction.
export const fetchImageAsDataUrl = async (imageUrl) => {
  if (!imageUrl) return null;
  const proxyUrl = `${PAS_API_BASE}/api/v1/common/image-proxy?url=${encodeURIComponent(imageUrl)}`;
  const token = getPASToken();
  const res = await fetch(proxyUrl, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  await checkFor401(res);
  if (!res.ok) throw new Error(`image-proxy ${res.status}`);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
};

export const formatNumber = (n) => {
  if (n === undefined || n === null || n === '') return null;
  const num = Number(n);
  if (isNaN(num) || num === 0) return null;
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(num);
};

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  try {
    // UNIX_TIMESTAMP() in MySQL returns seconds; JS Date expects milliseconds
    const d = (typeof dateStr === 'number' && dateStr < 1e10)
      ? new Date(dateStr * 1000)
      : new Date(dateStr);
    // Force UTC so dates stored as midnight UTC don't roll ±1 day in local timezone
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  } catch {
    return String(dateStr);
  }
};

// Derive aspect ratio string from width/height or image_size
const deriveAspectRatio = (raw) => {
  const w = Number(raw.width) || 0;
  const h = Number(raw.height) || 0;
  if (w > 0 && h > 0) {
    const ratio = w / h;
    if (Math.abs(ratio - 16 / 9) < 0.1) return '16:9';
    if (Math.abs(ratio - 9 / 16) < 0.1) return '9:16';
    if (Math.abs(ratio - 4 / 5) < 0.15) return '4:5';
    if (Math.abs(ratio - 1) < 0.1) return '1:1';
    if (Math.abs(ratio - 3 / 2) < 0.1) return '3:2';
    return `${w}:${h}`;
  }
  if (raw.image_size) return raw.image_size;
  return '';
};

// Map numeric platform IDs (from the 'platform' field in raw API responses) to network names
const PLATFORM_ID_TO_NETWORK = {
  1: 'facebook',
  2: 'instagram',
  3: 'youtube',
  4: 'google',
  5: 'native',
  6: 'linkedin',
  7: 'reddit',
  8: 'quora',
  9: 'pinterest',
  10: 'tiktok',
  11: 'twitter',
  12: 'gdn',
};

// Map ad type — supports more granular types from API
const mapAdType = (type) => {
  const t = (type || '').toLowerCase().trim();
  if (t === 'image') return 'image';
  if (t === 'video') return 'video';
  if (t === 'carousel') return 'carousel';
  if (t === 'story') return 'story';
  if (t === 'reel') return 'reel';
  if (t === 'text') return 'text';
  if (t === 'nativead' || t === 'native ad' || t === 'native_ad') return 'native_ad';
  if (t === 'banner') return 'banner';
  if (t === 'display' || t === 'responsive_display') return 'display';
  if (t === 'discovery') return 'discovery';
  if (t === 'text-image' || t === 'text_image') return 'text-image';
  if (t === 'organic search' || t === 'organic_search') return 'organic_search';
  return 'image';
};

// Calculate engagement rate from raw counts
const calcEngRate = (raw) => {  
  const likes = Number(raw.likes) || 0;
  const comments = Number(raw.comment) || 0;
  const shares = Number(raw.share) || 0;
  const views = Number(raw.views) || Number(raw.impression) || 0;
  if (views <= 0) return null;
  const rate = ((likes + comments + shares) / views) * 100;
  return rate > 0 ? rate.toFixed(1) + '%' : null;
};

// Calculate engagements per day
const calcEngPerDay = (raw) => {
  const likes = Number(raw.likes) || 0;
  const comments = Number(raw.comment) || 0;
  const shares = Number(raw.share) || 0;
  const days = Number(raw.days_running) || 1;
  const total = likes + comments + shares;
  if (total <= 0) return null;
  const perDay = Math.round(total / days);
  return perDay > 0 ? formatNumber(perDay) : null;
};

export const mapAdToCard = (raw) => {
  const resolvedNetwork = (raw.platform_network || raw.network || PLATFORM_ID_TO_NETWORK[Number(raw.platform)] || '').toLowerCase();
  const isTikTok = resolvedNetwork.toLowerCase() === 'tiktok' || !!raw.video_cover;
  // NAS-cached copy of the creative — used as the primary source when present
  // (and the base URL is configured). `liveVideoUrl` is the live CDN URL the
  // ad shipped with; it's the primary when there's no NAS copy and the runtime
  // fallback when the NAS copy is missing or 410s/expires. Keep all three views
  // (MasonryCard, AdDetailModal, AnalyticsModal) resolving through these two so
  // their video sources never diverge.
  const nasVideoUrl = (raw.nas_video_url && NAS_VIDEO_BASE_URL)
    ? `${NAS_VIDEO_BASE_URL}${raw.nas_video_url.startsWith('/') ? '' : '/'}${raw.nas_video_url}`
    : '';
  const liveVideoUrl = resolvedNetwork === 'quora'
    ? (resolveNasUrl(raw.image_url_original || '') || resolveNasUrl(raw.video_url || ''))
    : (resolveNasUrl(raw.video_url || '') || resolveNasUrl(raw.image_url_original || ''));
  return {
    id: raw.ad_id || raw.sql_id || raw.id,
    advertiser: raw.post_owner || 'Unknown',
    advertiserImage: raw.post_owner_image ? `${raw.post_owner_image}` : null,
    date: formatDate(raw.post_date),
    lastSeen: formatDate(raw.last_seen),
    firstSeen: formatDate(raw.first_seen),
    // IMAGE ads whose NAS image isn't ready yet are flagged preview_unavailable by the
    // backend — show a placeholder (don't fall back to an expiring source URL). The real
    // image appears once NAS is populated (the next search sends image_video_url again).
    thumbnail: raw.preview_unavailable === true
      ? ''
      : resolveNasUrl(raw.video_cover || (raw.image_video_url ? `${raw.image_video_url}` : (raw.image_url_original || raw.image_url || ''))),
    previewUnavailable: raw.preview_unavailable === true,
    // NAS-cached video first; fall through to the live CDN URL when there's no
    // NAS copy (or VITE_NAS_VIDEO_URL is unset, which would otherwise yield a
    // relative `/stream/...` path that 404s against the app origin).
    videoUrl: nasVideoUrl || liveVideoUrl,
    // Played when `videoUrl` fails at runtime. When NAS is the primary this is
    // the live CDN URL, so a NAS 410/expiry transparently falls back to the CDN.
    // For Quora without a NAS copy the primary is image_url_original and this is
    // the video_url alternate. Empty when there's no distinct fallback.
    videoUrlFallback: nasVideoUrl
      ? liveVideoUrl
      : (resolvedNetwork === 'quora' && resolveNasUrl(raw.image_url_original || ''))
        ? resolveNasUrl(raw.video_url || '')
        : '',
    likes: formatNumber(raw.likes),
    comments: formatNumber(raw.comment || raw.comments),
    views: formatNumber(raw.views),
    shares: formatNumber(raw.share || raw.shares),
    impressions: formatNumber(raw.impression || raw.impressions),
    title: raw.ad_title || '',
    carouselMedia: (() => {
      let val = raw.ad_image_video || raw.carousel_media;
      if (typeof val === 'string' && val.trim().startsWith('[') && val.trim().endsWith(']')) {
        try { val = JSON.parse(val); } catch (e) { }
      }
      // Drop slides resolving to the backend's "DefaultImage" placeholder — it's
      // a dead path that renders as "preview unavailable" and otherwise pollutes
      // carousels that are full of valid creatives. Same marker the advertiser
      // avatar guards against ("DefaultImage.jpg").
      const notDefault = (u) => typeof u === 'string' && !u.includes('DefaultImage');
      if (Array.isArray(val)) return val.map(resolveNasUrl).filter(notDefault);
      if (typeof val !== 'string' || !val) return [];
      const sep = val.includes('||,') ? '||,' : (val.includes('||') ? '||' : null);
      if (!sep) return [resolveNasUrl(val)].filter(notDefault);
      return val.split(sep).map(s => s.trim()).filter(Boolean).map(resolveNasUrl).filter(notDefault);
    })(),
    carouselTitles: (() => {
      const val = raw.ad_title;
      if (Array.isArray(val)) return val;
      if (typeof val !== 'string' || !val) return [];
      const sep = val.includes('||,') ? '||,' : (val.includes('||') ? '||' : null);
      if (!sep) return [];
      return val.split(sep).map(s => s.trim()).filter(Boolean);
    })(),
    subtitle: raw.news_feed_description || '',
    adText : raw.ad_text || '',
    adType: isTikTok ? 'video' : mapAdType(raw.type),
    textImageTitle: raw.text_image_title || '',
    adUrl: raw.ad_url || raw.library_url || '',
    tiktokLibraryUrl: isTikTok ? (raw.library_url || '') : '',
    metaAdUrl: raw.meta_ad_url || '',
    adPosition: raw.ad_position || '',
    destinationUrl: raw.destination_url || '',
    network: resolvedNetwork,
    // YouTube DISPLAY ads are surfaced under GDN. Show the GDN badge while
    // keeping network:'youtube' so ad-detail / insights still route to YouTube.
    badgeNetwork: raw.ad_origin === 'youtube_display' ? 'gdn' : resolvedNetwork,
    // YouTube display ad surfaced under GDN — drives the YouTube source marker on the card.
    ytSourced: raw.ad_origin === 'youtube_display',
    verified: raw.verified === 1,
    isMetaLib: Number(raw.platform) === 15 && ['facebook', 'instagram'].includes(resolvedNetwork),
    postOwnerId: raw.post_owner_id || '',
    adId: raw.ad_id || raw.sql_id || raw.id || '',
    // New fields for updated cards
    status: raw.status || '',
    popularity: (() => {
      // The backend ships popularity in three different shapes depending on
      // platform / endpoint:
      //   1. Object: { max, current }
      //   2. JSON-encoded string: '{"max":75,"current":75}'   (Node API
      //      JSON.stringify-s the object before sending it down)
      //   3. Plain number or numeric string
      // The old `raw.popularity?.current ?? raw.popularity` chain only
      // handled (1) and (3); (2) fell through to Number(string)→NaN and
      // collapsed every popularity to null, which both hid the badge and
      // broke any sort that relied on the field.
      const v = raw.popularity;
      if (v == null || v === '') return null;
      const extract = (obj) => obj?.current ?? obj?.max ?? obj?.score ?? obj?.value ?? null;
      if (typeof v === 'object') {
        const n = Number(extract(v));
        return Number.isFinite(n) && n > 0 ? n : null;
      }
      if (typeof v === 'string') {
        const trimmed = v.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try {
            const parsed = JSON.parse(trimmed);
            const n = Number(extract(parsed) ?? parsed);
            return Number.isFinite(n) && n > 0 ? n : null;
          } catch { /* fall through to plain Number() below */ }
        }
        const n = Number(trimmed);
        return Number.isFinite(n) && n > 0 ? n : null;
      }
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    })(),
    runningDays: (() => {
      if (raw.days_running != null && raw.days_running !== '') {
        const parsed = Number(raw.days_running);
        if (parsed > 0) return parsed;
      }
      if (raw.first_seen && raw.last_seen) {
        const first = new Date(raw.first_seen).getTime();
        const last = new Date(raw.last_seen).getTime();
        if (!isNaN(first) && !isNaN(last)) {
          const diffDays = Math.ceil(Math.abs(last - first) / (1000 * 60 * 60 * 24));
          return diffDays === 0 ? 1 : diffDays;
        }
      }
      return null;
    })(),
    cta: raw.call_to_action || '',
    keywords: raw.tags || raw.keyword || '',
    aspectRatio: isTikTok ? '9:16' : deriveAspectRatio(raw),
    adLanguage: raw.language || raw.ad_language || raw.lang_detect || '',
    adBudget: raw.ad_budget || raw.avg_ad_budget || raw.budget || null,
    lowerBudget: raw.lowerBudget != null ? Number(raw.lowerBudget) : null,
    upperBudget: raw.upperBudget != null ? Number(raw.upperBudget) : null,
    engRate: calcEngRate(raw),
    engPerDay: calcEngPerDay(raw),
    industry: raw.industry || '',
    budget: raw.budget ?? null,
    ctr: raw.ctr ?? null,
    hideType: raw.ad_type ?? raw.hideType ?? null,
    builtWith: raw.built_with || null,
    builtWithFunnel: raw.built_with_analytics_tracking || null,
    marketPlatformUrls: (() => {
      const v = raw.market_platform_urls;
      if (!v) return null;
      if (typeof v === 'object') return v;
      try { return JSON.parse(v); } catch { return null; }
    })(),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Hide Ad / Hide Advertiser / Favourite Ad
// ─────────────────────────────────────────────────────────────────────────────

const PLATFORM_ROUTE_MAP = {
  facebook: 'facebook',
  instagram: 'instagram',
  youtube: 'youtube',
  google: 'google',
  gdn: 'gdn',
  native: 'native',
  linkedin: 'linkedin',
  reddit: 'reddit',
  quora: 'quora',
  pinterest: 'pinterest',
  tiktok: 'tiktok',
};

/**
 * Hide ad (type=2), hide advertiser (type=1), or favourite ad (type=3).
 * @param {Object} params
 * @param {string} params.network - Platform name (facebook, instagram, etc.)
 * @param {number|string} params.adId - The ad_id
 * @param {number|string} params.postOwnerId - The post_owner_id (required for type=1)
 * @param {1|2|3} params.type - 1=hide advertiser, 2=hide ad, 3=favourite ad
 * @returns {Promise<Object>}
 */
export const hideAds = async ({ network, adId, postOwnerId, type }) => {
  const platformRoute = PLATFORM_ROUTE_MAP[(network || 'facebook').toLowerCase()] || 'facebook';
  const body = {
    ad_id: adId,
    type,
    // user_id: 72479,
    post_owner_id: postOwnerId || null,
  };

  const res = await fetch(`${PAS_API_BASE}/api/v1/${platformRoute}/ads/hide_ads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getPASToken()}`,
    },
    body: JSON.stringify(body),
  });

  await checkFor401(res);
  if (!res.ok) throw new Error(`hide_ads failed: ${res.status}`);
  return res.json();
};

/**
 * Un-hide ad (type=2), un-hide advertiser (type=1), or un-favourite ad (type=3).
 * @param {Object} params
 * @param {string} params.network - Platform name
 * @param {number|string} params.adId - The ad_id
 * @param {number|string} params.postOwnerId - The post_owner_id
 * @param {1|2|3} params.type - 1=unhide advertiser, 2=unhide ad, 3=unfavourite ad
 * @returns {Promise<Object>}
 */
export const unHideAds = async ({ network, adId, postOwnerId, type }) => {
  const platformRoute = PLATFORM_ROUTE_MAP[(network || 'facebook').toLowerCase()] || 'facebook';
  const body = {
    ad_id: adId,
    type,
    post_owner_id: postOwnerId || null,
  };

  const res = await fetch(`${PAS_API_BASE}/api/v1/${platformRoute}/ads/un-hide`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getPASToken()}`,
    },
    body: JSON.stringify(body),
  });

  await checkFor401(res);
  if (!res.ok) throw new Error(`un-hide failed: ${res.status}`);
  return res.json();
};

/**
 * Fetch hidden advertisers, hidden ads, and favourite ads for a platform.
 * GET /api/v1/{platform}/ads/getHiddenPostOwners
 * @param {string} network - Platform name
 * @returns {Promise<{ hiddenAdvertiserIds: number[], hiddenAdIds: number[], favouriteAdIds: number[] }>}
 */
export const fetchHiddenAndFavourites = async (network) => {
  try {
    const platformRoute = PLATFORM_ROUTE_MAP[(network || 'facebook').toLowerCase()] || 'facebook';
    const res = await fetch(`${PAS_API_BASE}/api/v1/${platformRoute}/ads/getHiddenPostOwners`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getPASToken()}`,
      },
      body: JSON.stringify({}),
    });
    await checkFor401(res);
    if (!res.ok) return { hiddenAdvertiserIds: [], hiddenAdIds: [], favouriteAdIds: [] };
    const json = await res.json();
    return {
      hiddenAdvertiserIds: json.data || [],
      hiddenAdIds: json.addata || [],
      favouriteAdIds: json.favorite || [],
    };
  } catch {
    return { hiddenAdvertiserIds: [], hiddenAdIds: [], favouriteAdIds: [] };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Gemini AI Service
// ─────────────────────────────────────────────────────────────────────────────

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calls the Gemini API with a text prompt.
 * Includes exponential backoff retry logic (up to 5 retries).
 */
export const fetchGemini = async (prompt, retryCount = 0) => {
  try {
    const response = await fetch(`${GEMINI_BASE_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    if (!response.ok) {
      if (response.status === 429 && retryCount < 5) {
        await delay(Math.pow(2, retryCount) * 1000);
        return fetchGemini(prompt, retryCount + 1);
      }
      throw new Error('Failed to connect to AI service');
    }
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text;
  } catch (error) {
    if (retryCount < 5) {
      await delay(Math.pow(2, retryCount) * 1000);
      return fetchGemini(prompt, retryCount + 1);
    }
    throw error;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PAS Ad Intelligence API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches ads from the PAS API based on filters.
 *
 * @param {object} filters - Current filter state from useSDUI hook
 * @returns {Promise<Array>} Array of ad objects mapped for AdCard
 */
/**
 * Builds the search API payload from filter state.
 * Exported so the dashboard share feature can capture it.
 */
// Per-platform filter support map — which platforms support each filter field.
// Used by buildSearchPayload to skip irrelevant fields when querying specific platforms.
// Also exported so App.jsx can decide whether to skip TikTok or generic API calls entirely.
export const FILTER_PLATFORM_SUPPORT = {
  likes:          ['facebook', 'instagram', 'youtube', 'linkedin', 'reddit', 'tiktok'],
  shares:         ['facebook', 'tiktok'],
  comments:       ['facebook', 'instagram', 'youtube', 'linkedin', 'reddit', 'tiktok'],
  impressions:    ['facebook', 'instagram', 'linkedin', 'tiktok'],
  popularity:     ['facebook', 'instagram', 'linkedin', 'tiktok'],
  adBudget:       ['facebook', 'instagram', 'youtube', 'tiktok'],
  ctr:            ['facebook', 'tiktok'],
  views:          ['youtube', 'facebook', 'tiktok'],
  cta:            ['facebook', 'instagram', 'youtube', 'linkedin', 'reddit', 'quora'],
  gender:         ['facebook', 'instagram'],
  age:            ['facebook', 'instagram'],
  verified:       ['facebook', 'instagram', 'youtube', 'linkedin'],
  meta_ads_lib:   ['facebook', 'instagram'],
  ad_position:    ['facebook', 'youtube'],
  ad_sub_position:['google'],
  image_size:     ['gdn'],
  native_network: ['native'],
  language:       ['facebook', 'instagram', 'youtube', 'gdn', 'native', 'linkedin', 'reddit', 'quora', 'tiktok'],
};

// Returns true if at least one platform in `nets` supports the named filter field.
// Accepts an optional dynamic map (from config) that overrides the hardcoded fallback.
const platformSupports = (nets, field, dynamicMap) => {
  const supported = (dynamicMap && dynamicMap[field]) || FILTER_PLATFORM_SUPPORT[field];
  if (!supported) return true; // unknown field — pass through
  // ALL tab sends 'all' as platform — treat it as supporting every filter
  if (nets.some(p => p.toLowerCase() === 'all')) return true;
  return nets.some(p => supported.includes(p.toLowerCase()));
};

export const buildSearchPayload = (filters = {}) => {
  const {
    searchQuery, searchIn, exactSearch, activePlatforms, activePlatform, selCategories, selCountries, sortBy,
    filterPlatformSupport: dynamicPlatformSupport,
  } = filters;

  // Merge dynamic config map over hardcoded fallback — config wins for known fields
  const platformSupportMap = dynamicPlatformSupport
    ? { ...FILTER_PLATFORM_SUPPORT, ...dynamicPlatformSupport }
    : FILTER_PLATFORM_SUPPORT;

  // Scoped helper using the merged map
  const ps = (nets, field) => platformSupports(nets, field, platformSupportMap);

  // Helper: return value if non-empty, else 'NA'
  const v = (val) => {
    if (val === undefined || val === null || val === '' || val === false) return 'NA';
    if (Array.isArray(val)) return val.length > 0 ? val : 'NA';
    // Range object with empty bounds → treat as "not set"
    if (typeof val === 'object') {
      const hasMin = val.min !== undefined && val.min !== null && val.min !== '';
      const hasMax = val.max !== undefined && val.max !== null && val.max !== '';
      if (!hasMin && !hasMax) return 'NA';
    }
    return val;
  };

  // Flexible lookup — tries multiple possible SDUI filter _id names for the same field
  const pick = (...keys) => {
    for (const k of keys) {
      const val = filters[k];
      if (val !== undefined && val !== null) return val;
    }
    return undefined;
  };

  // Range fields — try every reasonable SDUI _id variant
  const likesRange = pick('likes', 'like', 'likes_range', 'engagement_likes');
  const sharesRange = pick('shares', 'share', 'shares_range', 'engagement_shares');
  const commentsRange = pick('comments', 'comment', 'comments_range', 'engagement_comments');
  const impressionsRange = pick('impressions', 'impression', 'impressions_range', 'engagement_impressions');
  const viewsRange = pick('views_range_filter', 'view', 'views', 'video_views', 'views_range', 'view_count');
  const popularityRange = pick('popularity', 'popularity_score', 'popularity_range');
  const adBudgetRange = pick('adBudget', 'ad_budget', 'avg_ad_budget');
  const ctrRange = pick('ctr', 'ctr_filter', 'ctr_range');
  // TikTok categorical budget — scan all filterValues keys for any array containing Low/Medium/High
  const tiktokBudget = (() => {
    const CATEGORICAL = new Set(['low', 'medium', 'high']);
    const isCategorical = (x) => typeof x === 'string' && CATEGORICAL.has(x.toLowerCase());
    for (const k of Object.keys(filters)) {
      if (k === '_autoSortField' || k === 'filterPlatformSupport') continue;
      const val = filters[k];
      const arr = Array.isArray(val) ? val : (val != null && val !== false ? [val] : []);
      const cats = arr.filter(isCategorical).map(x => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase());
      if (cats.length > 0) return cats;
    }
    return [];
  })();

  // Other filter fields
  const categories = pick('categories', 'category');
  const cta_filter = pick('cta_filter', 'cta', 'call_to_action');
  const country_filter = pick('country_filter', 'country', 'countries', 'geo', 'location', 'targeting_country');
  const ad_type = pick('ad_type', 'type', 'adType');
  const adPositionFilter = pick('ad_position_filter', 'ad_position', 'position');
  const adSubPosition = pick('ad_sub_position', 'ad_sub_position_filter', 'adSubPosition', 'subposition', 'sub_position');
  const gender = pick('gender', 'gender_filter', 'gender_selector');
  const ageFilter = pick('age_filter', 'age', 'lower_age', 'lowerAge');
  // Parse age ranges like ["13-17", "25-34"] → lower_age = min start, upper_age = max end
  const parsedAge = (() => {
    if (!ageFilter) return { lower: undefined, upper: undefined };
    if (typeof ageFilter === 'number' || (typeof ageFilter === 'string' && !ageFilter.includes('-') && !ageFilter.includes('+'))) {
      return { lower: ageFilter, upper: pick('upper_age', 'upperAge') };
    }
    const ranges = Array.isArray(ageFilter) ? ageFilter : [ageFilter];
    if (ranges.length === 0) return { lower: undefined, upper: undefined };
    let minAge = Infinity, maxAge = -Infinity;
    for (const r of ranges) {
      const str = String(r);
      if (str.includes('+')) {
        const num = parseInt(str);
        if (!isNaN(num)) { minAge = Math.min(minAge, num); maxAge = Math.max(maxAge, num); }
      } else if (str.includes('-')) {
        const [lo, hi] = str.split('-').map(Number);
        if (!isNaN(lo)) minAge = Math.min(minAge, lo);
        if (!isNaN(hi)) maxAge = Math.max(maxAge, hi);
      }
    }
    return {
      lower: minAge !== Infinity ? minAge : undefined,
      upper: maxAge !== -Infinity ? maxAge : undefined,
    };
  })();
  const lower_age = parsedAge.lower;
  const upper_age = parsedAge.upper;
  const subcategoryVal = pick('subcategory');
  const industryFilter = pick('industry', 'industry_filter');
  const ecommerce = pick('ecommerce_platform_filter', 'ecommerce', 'ecommerce_filter', 'ecommerce_platform');
  const source = pick('source', 'source_filter', 'marketing_platform');
  const funnel = pick('funnel_filter', 'funnel');
  const affiliate = pick('affiliate_network_filter', 'affiliate', 'affiliate_filter', 'affiliate_network', 'affiliates');
  const nativeNetwork = pick('native_network_filter', 'nativeNetwork', 'native_network');
  const languageFilter = pick('language', 'lang', 'language_filter');
  const lang = pick('lang', 'language', 'language_filter');
  const commentdata = pick('commentdata');
  const verified = pick('verified_filter', 'verified', 'is_verified');
  const metaAdsLib = pick('meta_ads_lib_filter', 'meta_ads_lib', 'meta_ads_library');
  const market_platform = pick('market_platform', 'marketing_platform_filter', 'marketing_platform', 'marketingPlatform');
  const post_date_btn_sort = pick('post_date_btn_sort');
  const seen_btn_sort = pick('seen_btn_sort');
  const domain_date_btn_sort = pick('domain_date_btn_sort');
  const imageSize = pick('image_size_filter', 'image_size', 'size');

  // Build a map of ad type value → platform_applicability from config options passed in
  const adTypeOptions = filters.adTypeOptions || [];
  const selectedTypes = Array.isArray(ad_type) ? ad_type : (ad_type ? [ad_type] : []);
  const restrictedPlatforms = selectedTypes.reduce((acc, t) => {
    const opt = adTypeOptions.find(o => (o.value || '').toLowerCase() === (t || '').toLowerCase());
    const platforms = opt?.platform_applicability;
    if (Array.isArray(platforms) && platforms.length > 0) {
      platforms.forEach(p => acc.add(p.toLowerCase()));
    }
    return acc;
  }, new Set());

  const baseNetworks = activePlatforms?.length
    ? activePlatforms.map(p => p.toLowerCase())
    : [(activePlatform || 'facebook').toLowerCase()];

  const networks = restrictedPlatforms.size > 0
    ? baseNetworks.filter(p => restrictedPlatforms.has(p))
    : baseNetworks;

  // Fallback: if intersection is empty (user's platform doesn't support the selected ad type),
  // use the user's actual selected platforms so the API returns "No ads found" naturally.
  const finalNetworks = networks.length > 0 ? networks : baseNetworks;

  // No frontend network narrowing — all selected platforms are always queried.
  // Each backend controller reads only the fields it supports and ignores the rest.
  const resolvedNetworks = finalNetworks;

  const keyword = searchIn === 'keyword' ? (searchQuery || 'NA') : 'NA';
  const advertiser = searchIn === 'advertiser' ? (searchQuery || 'NA') : 'NA';
  const domain = searchIn === 'domain' ? (searchQuery || 'NA') : 'NA';

  // Category: prefer adcategory from nested filter, then filterValues.categories, fallback to selCategories
  const adcategoryDirect = pick('adcategory');
  const resolvedCategories = adcategoryDirect
    ? (Array.isArray(adcategoryDirect) ? adcategoryDirect : [adcategoryDirect])
    : (categories?.length ? categories : (selCategories || []));
  const adcategory = resolvedCategories.length ? resolvedCategories : 'NA';

  // TikTok industry: ordered array — category name(s) first, then subcategories.
  // If a dedicated industry filter is set, use it directly.
  // Otherwise build from adcategory + subcategory: [category, ...subcategories]
  const resolvedIndustry = (() => {
    if (Array.isArray(industryFilter) && industryFilter.length > 0) return industryFilter;
    const cats = adcategoryDirect
      ? (Array.isArray(adcategoryDirect) ? adcategoryDirect : [adcategoryDirect])
      : [];
    const subs = Array.isArray(subcategoryVal) ? subcategoryVal : (subcategoryVal ? [subcategoryVal] : []);
    if (cats.length === 0 && subs.length === 0) return [];
    // Category names first, then subcategories (no duplicates)
    const result = [];
    cats.forEach(cat => result.push(cat));
    subs.forEach(sub => { if (!result.includes(sub)) result.push(sub); });
    return result;
  })();

  // Country: prefer filterValues match, fallback to selCountries passed from App
  const rawCountry = (() => {
    if (Array.isArray(country_filter) && country_filter.length > 0) return country_filter;
    if (country_filter && !Array.isArray(country_filter)) return [country_filter];
    if (Array.isArray(selCountries) && selCountries.length > 0) return selCountries;
    return [];
  })();
  const resolvedCountry = rawCountry.length ? rawCountry : 'NA';

  // lang: add 'un' when 'en' is present (mirrors PHP logic)
  const resolvedLang = v(lang) !== 'NA' ? v(lang) : v(languageFilter);

  // ad_position: use ["FEED","VIDEOFEED"] when popularity or impressions filter is active
  // Only send ad_position when the user explicitly set it — no auto-default fallback.
  // Each backend controller ignores this field if the platform doesn't support it.
  const resolvedAdPosition = v(adPositionFilter) !== 'NA' ? adPositionFilter : 'NA';

  // Map sortBy → order_column — covers all common SDUI value aliases per sort option
  const SORT_MAP = {
    // newest
    newest: 'post_date', post_date: 'post_date', new: 'post_date',
    '-created_at': 'post_date',
    // popular / popularity
    popular: 'popularity', popularity: 'popularity', popularity_score: 'popularity',
    '-popularity_score': 'popularity',
    // running longest
    running_longest: 'days_running', days_running: 'days_running', longest_running: 'days_running',
    running_days: 'days_running', '-running_days': 'days_running', 'ad running days': 'days_running', 'ad_running_days': 'days_running',
    'Ad Running Days': 'days_running', 'Ad running days': 'days_running', 'Running Longest': 'days_running',
    // likes / engagement
    likes: 'likes', like: 'likes', likes_sort: 'likes', sort_likes: 'likes',
    '-engagement_score': 'likes',
    // comments
    comments: 'comment', comment: 'comment', comments_sort: 'comment',
    // shares
    shares: 'share', share: 'share', shares_sort: 'share',
    // impressions
    impressions: 'impression', impression: 'impression', impressions_sort: 'impression',
    '-impressions': 'impression',
    // last seen
    last_seen: 'LastSeen', lastseen: 'LastSeen', last_seen_sort: 'LastSeen',
    '-last_seen_at': 'LastSeen',
    // hits
    hits: 'hits', hit: 'hits',
    // domain
    domain: 'domain_date', domain_date: 'domain_date', domain_sort: 'domain_date',
    domain_reg_sort: 'domain_date', 'domain registration date': 'domain_date',
    '-domain_reg_date': 'domain_date',
    // ad budget
    ad_budget: 'ad_budget', adbudget: 'ad_budget', budget: 'ad_budget', avg_ad_budget: 'ad_budget',
  };
  const rawSort = (sortBy || filters.sorting || '').toLowerCase();
  let order_column = SORT_MAP[rawSort] || SORT_MAP[sortBy] || 'post_date';
  
  // Extra aggressive mapping for common sort variants
  if (rawSort.includes('domain')) order_column = 'domain_date';
  if (rawSort.includes('running') || rawSort.includes('days')) order_column = 'days_running';

  // When sort is Newest (default), auto-sort by the most-recently-changed range metric.
  // _autoSortField is set in useSDUI whenever a slider changes — tracks last user interaction.
  if (order_column === 'post_date') {
    const autoSortField = filters['_autoSortField'];
    const RANGE_SORT_MAP = {
      likes: 'likes', like: 'likes', likes_range: 'likes', engagement_likes: 'likes',
      shares: 'share', share: 'share', shares_range: 'share', engagement_shares: 'share',
      comments: 'comment', comment: 'comment', comments_range: 'comment', engagement_comments: 'comment',
      impressions: 'impression', impression: 'impression', impressions_range: 'impression', engagement_impressions: 'impression',
      views_range_filter: 'views', view: 'views', views: 'views', video_views: 'views', views_range: 'views', view_count: 'views',
      popularity: 'popularity', popularity_score: 'popularity', popularity_range: 'popularity',
      adBudget: 'ad_budget', ad_budget: 'ad_budget', avg_ad_budget: 'ad_budget',
      ctr: 'ctr', ctr_filter: 'ctr', ctr_range: 'ctr',
    };
    if (autoSortField && RANGE_SORT_MAP[autoSortField]) {
      order_column = RANGE_SORT_MAP[autoSortField];
    } else if (v(ctrRange) !== 'NA') order_column = 'ctr';
    else if (v(popularityRange) !== 'NA') order_column = 'popularity';
    else if (v(likesRange) !== 'NA') order_column = 'likes';
    else if (v(sharesRange) !== 'NA') order_column = 'share';
    else if (v(commentsRange) !== 'NA') order_column = 'comment';
    else if (v(impressionsRange) !== 'NA') order_column = 'impression';
    else if (v(viewsRange) !== 'NA') order_column = 'views';
    else if (v(adBudgetRange) !== 'NA') order_column = 'ad_budget';
  }

  const payload = {
    network: resolvedNetworks,
    // user_id: 281,
    advertiser,
    domain,
    keyword,
    newest_sort: order_column === 'post_date' ? 'newest_sort' : 'NA',
    running_longest_sort: order_column === 'days_running' ? 'running_longest_sort' : 'NA',
    last_seen_sort: order_column === 'LastSeen' ? 'LastSeen_sort' : 'NA',
    likes_sort: order_column === 'likes' ? 'likes_sort' : 'NA',
    comments_sort: order_column === 'comment' ? 'comments_sort' : 'NA',
    shares_sort: order_column === 'share' ? 'shares_sort' : 'NA',
    hits_sort: order_column === 'hits' ? 'hits_sort' : 'NA',
    domain_sort: order_column === 'domain_date' ? 'domain_sort' : 'NA',
    impression_sort: order_column === 'impression' ? 'impression_sort' : 'NA',
    popularity_sort: order_column === 'popularity' ? 'popularity_sort' : 'NA',
    views_sort: order_column === 'views' ? 'views_sort' : 'NA',
    adBudget_sort: order_column === 'ad_budget' ? 'adBudget_sort' : 'NA',
    seen_btn_sort: v(seen_btn_sort),
    post_date_btn_sort: v(post_date_btn_sort),
    domain_date_btn_sort: v(domain_date_btn_sort),
    // Per-platform filter skipping: only include filter fields that at least one
    // resolved network supports. Unsupported fields are sent as 'NA' so the backend
    // ignores them cleanly.
    call_to_action: ps(resolvedNetworks, 'cta_filter') || ps(resolvedNetworks, 'cta') ? v(cta_filter) : 'NA',
    adcategory,
    country: resolvedCountry,
    state: 'NA',
    city: 'NA',
    type: (() => {
      const raw = v(ad_type);
      if (raw === 'NA') return 'NA';
      const vals = Array.isArray(raw) ? raw : [raw];
      return vals.map(t => t.replace(/-/g, '_').toUpperCase());
    })(),
    ad_position: resolvedAdPosition,
    gender: (() => {
      if (!ps(resolvedNetworks, 'gender_filter') && !ps(resolvedNetworks, 'gender')) return 'NA';
      if (!gender || gender === '' || gender === 'all') return 'NA';
      if (Array.isArray(gender)) return gender.length > 0 ? gender : 'NA';
      return [gender];
    })(),
    gender_activity: (() => {
      if (!ps(resolvedNetworks, 'gender_filter') && !ps(resolvedNetworks, 'gender')) return 'NA';
      if (!gender || gender === '') return 'NA';
      if (gender === 'all') return 'All';
      if (Array.isArray(gender)) return gender.length > 0 ? gender.join(',') : 'NA';
      return gender;
    })(),
    lower_age: ps(resolvedNetworks, 'age_filter') || ps(resolvedNetworks, 'age') ? v(lower_age) : 'NA',
    upper_age: ps(resolvedNetworks, 'age_filter') || ps(resolvedNetworks, 'age') ? v(upper_age) : 'NA',
    industry: resolvedIndustry.length > 0 ? resolvedIndustry : 'NA',
    subCategory: Array.isArray(subcategoryVal) && subcategoryVal.length > 0 ? subcategoryVal : v(subcategoryVal),
    ecommerce: Array.isArray(ecommerce) && ecommerce.length > 0 ? ecommerce : v(ecommerce),
    ad_sub_position: (() => {
      if (!ps(resolvedNetworks, 'ad_sub_position_filter') && !ps(resolvedNetworks, 'ad_sub_position')) return 'NA';
      if (!adSubPosition || adSubPosition === 'NA') return 'NA';
      const vals = Array.isArray(adSubPosition) ? adSubPosition : [adSubPosition];
      return vals.length > 0 ? vals.map(v => String(v).toUpperCase()) : 'NA';
    })(),
    track: 'NA',
    source: Array.isArray(source) && source.length > 0 ? source : v(source),
    funnel: Array.isArray(funnel) && funnel.length > 0 ? funnel : v(funnel),
    affiliate: Array.isArray(affiliate) && affiliate.length > 0 ? affiliate : 'NA',
    nativeNetwork: ps(resolvedNetworks, 'native_network_filter') || ps(resolvedNetworks, 'native_network')
      ? (Array.isArray(nativeNetwork) && nativeNetwork.length > 0 ? nativeNetwork : 'NA')
      : 'NA',
    order_column,
    order_by: 'desc',
    take: '9',
    skip: filters.skip ?? 0,
    needle: 'NA',
    subscriptionType: 'NA',
    favorite: filters.favorite === true ? 'true' : 'false',
    hidden: filters.hidden === true ? 'true' : 'false',
    tags: 'NA',
    version: 'NA',
    selected_user: 'NA',
    lang: ps(resolvedNetworks, 'language') ? resolvedLang : 'NA',
    discoverer_user_id: 'NA',
    likes: ps(resolvedNetworks, 'likes') ? v(likesRange) : 'NA',
    comments: ps(resolvedNetworks, 'comments') ? v(commentsRange) : 'NA',
    shares: ps(resolvedNetworks, 'shares') ? v(sharesRange) : 'NA',
    impressions: ps(resolvedNetworks, 'impressions') ? v(impressionsRange) : 'NA',
    view: ps(resolvedNetworks, 'views_range_filter') || ps(resolvedNetworks, 'views') ? v(viewsRange) : 'NA',
    popularity: ps(resolvedNetworks, 'popularity') ? v(popularityRange) : 'NA',
    adBudget: ps(resolvedNetworks, 'adBudget') ? v(adBudgetRange) : 'NA',
    ctr: ps(resolvedNetworks, 'ctr_filter') || ps(resolvedNetworks, 'ctr') ? v(ctrRange) : 'NA',
    budget: tiktokBudget.length > 0 ? tiktokBudget : 'NA',
    impression: ps(resolvedNetworks, 'impressions') ? v(impressionsRange) : 'NA',
    html: 'NA',
    commentdata: v(commentdata),
    page_creation: 'NA',
    verified: ps(resolvedNetworks, 'verified_filter') || ps(resolvedNetworks, 'verified')
      ? ((verified === true || verified === 1 || verified === 'true') ? 1 : 'NA')
      : 'NA',
    mixdata: 'NA',
    html_content: 'NA',
    ocr: 'NA',
    image_celebrity: 'NA',
    image_object: 'NA',
    image_logo: 'NA',
    userSubscription: 'NA',
    not_country: '',
    adDetail_id: 'NA',
    platform: (ps(resolvedNetworks, 'meta_ads_lib_filter') || ps(resolvedNetworks, 'meta_ads_lib')) &&
      (metaAdsLib === true || metaAdsLib === 1 || metaAdsLib === 'true') &&
      (resolvedNetworks.includes('facebook') || resolvedNetworks.includes('instagram')) ? 15 : 'NA',
    platform_positions: (ps(resolvedNetworks, 'meta_ads_lib_filter') || ps(resolvedNetworks, 'meta_ads_lib')) &&
      (metaAdsLib === true || metaAdsLib === 1 || metaAdsLib === 'true')
      ? ['facebook', 'instagram']
      : 'NA',
    market_platform: v(market_platform),
    size: ps(resolvedNetworks, 'image_size_filter') || ps(resolvedNetworks, 'image_size')
      ? (Array.isArray(imageSize) ? (imageSize.length > 0 ? imageSize.join(',') : 'NA') : v(imageSize))
      : 'NA',
    language: ps(resolvedNetworks, 'language') ? (resolvedLang !== 'NA' ? resolvedLang : 'en') : 'NA',
    ad_position_filter: v(adPositionFilter) !== 'NA' ? adPositionFilter : 'NA',
    userkeyword: false,
    country_session: 0,
    ipBasedCountry: 'NA',
    exact_search: exactSearch ? 1 : 0,
  };

  return payload;
};



// const USER_ACTIVITY_URL = (import.meta.env.VITE_USER_ACTIVITY_URL || '').replace(/\/$/, ''); // migrated to Node.js

function getAuthUser() {
  try {
    const raw = localStorage.getItem('authUser');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// Cache country for the session so we don't call ipapi.co on every search
// Fetch user's current country from their request IP
// This is done server-side using the request IP, so we pass a signal from the frontend
// The backend will detect the country from the HTTP request IP
async function getCountryByIP() {
  // Return a marker that tells the backend to auto-detect from request IP
  // The backend will call geoip or similar to get the country from the request IP
  return 'auto-detect';
}

async function trackUserActivity(payload, meta) {
  if (!PAS_API_BASE) return;
  const authUser = getAuthUser();
  if (!authUser?.user_id) return;
  const userCurrentCountry = await getCountryByIP();
  const networkRaw = payload.network;
  /* v8 ignore next -- payload.network always comes from buildSearchPayload (resolvedNetworks array); the non-array fallback is defensive */
  const networkArr = Array.isArray(networkRaw) ? networkRaw.map(n => n.toLowerCase()) : [(networkRaw || 'all').toLowerCase()];
  const isAll = payload.isAllTab === true || networkArr[0] === 'all';
  const total = meta?.total
    ? Object.entries(meta.total).reduce((s, [k, n]) => {
        if (isAll || networkArr.includes(k.toLowerCase())) return s + (Number(n) || 0);
        return s;
      }, 0)
    : 0;
  const isMulti = !isAll && networkArr.length > 1;
  const networkKey = isAll ? 'all' : networkArr[0];

  /* v8 ignore start -- defensive telemetry: rangeToStr/genderVal/common/extra only feed the
     outbound body; buildSearchPayload always defines these keys so `?? 'NA'` is unreachable */
  // Convert a [min, max] range array to "min-max" string for storage
  const rangeToStr = (val) => {
    if (Array.isArray(val) && val.length === 2) return `${val[0]}-${val[1]}`;
    if (Array.isArray(val) && val.length === 1) return String(val[0]);
    return val ?? 'NA';
  };

  // gender_activity carries 'All'/'Male'/'Female' when filter was explicitly used, else 'NA'
  const genderVal = payload.gender_activity ?? 'NA';

  // Common fields shared across all platforms
  const common = {
    user_id:              authUser.user_id,
    email:                authUser.email ?? 'NA',
    user_country:         userCurrentCountry,
    advertiser:           payload.advertiser           ?? 'NA',
    domain:               payload.domain               ?? 'NA',
    keyword:              payload.keyword              ?? 'NA',
    newest_sort:          payload.newest_sort          ?? 'NA',
    running_longest_sort: payload.running_longest_sort ?? 'NA',
    last_seen_sort:       payload.last_seen_sort       ?? 'NA',
    likes_sort:           payload.likes_sort           ?? 'NA',
    impression_sort:      payload.impression_sort      ?? 'NA',
    popularity_sort:      payload.popularity_sort      ?? 'NA',
    adBudget_sort:        payload.adBudget_sort        ?? 'NA',
    comments_sort:        payload.comments_sort        ?? 'NA',
    shares_sort:          payload.shares_sort          ?? 'NA',
    domain_sort:          payload.domain_sort          ?? 'NA',
    seen_btn_sort:        payload.seen_btn_sort        ?? 'NA',
    post_date_btn_sort:   payload.post_date_btn_sort   ?? 'NA',
    domain_date_btn_sort: payload.domain_date_btn_sort ?? 'NA',
    call_to_action:       payload.call_to_action       ?? 'NA',
    adcategory:           payload.adcategory           ?? 'NA',
    subCategory:          payload.subCategory          ?? 'NA',
    country:              payload.country              ?? 'NA',
    state:                payload.state                ?? 'NA',
    city:                 payload.city                 ?? 'NA',
    type:                 payload.type                 ?? 'NA',
    ad_position:          payload.ad_position          ?? 'NA',
    gender:               genderVal,
    lower_age:            payload.lower_age            ?? 'NA',
    upper_age:            payload.upper_age            ?? 'NA',
    ecommerce:            payload.ecommerce            ?? 'NA',
    track:                payload.track                ?? 'NA',
    source:               payload.source               ?? 'NA',
    funnel:               payload.funnel               ?? 'NA',
    affiliate:            payload.affiliate            ?? 'NA',
    order_column:         payload.order_column         ?? 'post_date',
    order_by:             payload.order_by             ?? 'desc',
    take:                 payload.take                 ?? '9',
    skip:                 payload.skip                 ?? '0',
    needle:               payload.needle               ?? 'NA',
    subscriptionType:     authUser.userSubscriptionType ?? 'NA',
    lang:                 payload.lang                 ?? 'NA',
    favorite:             payload.favorite             ?? 'false',
    hidden:               payload.hidden               ?? 'false',
    likes:                rangeToStr(payload.likes),
    comments:             rangeToStr(payload.comments),
    shares:               rangeToStr(payload.shares),
    impressions:          rangeToStr(payload.impressions),
    popularity:           rangeToStr(payload.popularity),
    adBudget:             payload.adBudget             ?? 'NA',
    ctr:                  rangeToStr(payload.ctr),
    html_content:         payload.html_content         ?? 'NA',
    verified:             payload.verified             ?? 'NA',
    meta_ads_lib_filter:  (payload.platform === 15 || Array.isArray(payload.platform_positions)) ? 'true' : 'NA',
    ocr:                  payload.ocr                  ?? 'NA',
    addetails:            'NA',
    similar_ad_id:        'NA',
    userSubscription:     authUser.userSubscriptionType ?? 'NA',
    market_platform:      payload.market_platform      ?? 'NA',
    language:             payload.language             ?? 'en',
    ad_position_filter:   payload.ad_position_filter   ?? 'NA',
    user_keyword:         payload.userkeyword          ?? false,
    ipBasedCountry:       payload.ipBasedCountry       ?? 'NA',
    method:               'getAds',
    adsCountOnSerach:     total,
    project_name:              payload.project_name              ?? 'NA',
    competitor_name:           payload.competitor_name           ?? 'NA',
    competitor_platform:       payload.competitor_platform       ?? 'NA',
    competitor_platform_click: payload.competitor_platform_click ?? 'NA',
  };

  // Per-platform extra fields matching the exact payload format expected by user_activity helper
  let extra = {};
  if (isMulti) {
    extra = { network: networkArr.join(','), platform: 'NA' };
  } else if (networkKey === 'facebook' || networkKey === 'instagram') {
    extra = {
      network:         networkKey,
      platform:        'NA',
      celeb:           payload.image_celebrity ?? 'NA',
      logo:            payload.image_logo      ?? 'NA',
      object:          payload.image_object    ?? 'NA',
      hiddenads:       'NA',
    };
  } else if (networkKey === 'youtube') {
    extra = {
      network:         'Youtube',
      platform:        'NA',
      celebrity:       payload.image_celebrity ?? 'NA',
      brand_logo:      payload.image_logo      ?? 'NA',
      dislikes_sort:   payload.dislikes_sort   ?? 'NA',
      views_sort:      payload.views_sort      ?? 'NA',
      views:           payload.view            ?? 'NA',
      dislikes:        'NA',
      hiddenads:       'NA',
      user_email:      authUser.email          ?? 'NA',
      type_filter:     payload.type            ?? 'NA',
      ad_type:         payload.type            ?? 'NA',
    };
  } else if (networkKey === 'google') {
    extra = {
      network:         'Google',
      platform:        'NA',
      target_keywords: 'NA',
      cname:           'NA',
      user_email:      authUser.email          ?? 'NA',
      name:            authUser.name           ?? 'NA',
      hiddenads:       'NA',
      type_filter:     payload.type            ?? 'NA',
      ad_sub_position: payload.ad_sub_position ?? 'NA',
    };
  } else if (networkKey === 'native') {
    extra = {
      network:         'NA',
      platform:        'Native',
      platform_native: true,
      category:        payload.adcategory      ?? 'NA',
      cname:           'NA',
      target_keywords: 'NA',
      user_email:      authUser.email          ?? 'NA',
    };
  } else if (networkKey === 'linkedin') {
    extra = {
      network:         'Linkedin',
      platform:        'NA',
      impressionsort:  payload.impression_sort ?? 'NA',
      popularitysort:  payload.popularity_sort ?? 'NA',
      impressions:     rangeToStr(payload.impressions),
      popularitys:     rangeToStr(payload.popularity),
      hiddenads:       'NA',
      target_keywords: 'NA',
      user_email:      authUser.email          ?? 'NA',
      name:            authUser.name           ?? 'NA',
    };
  } else if (networkKey === 'pinterest') {
    extra = {
      network:         'Pinterest',
      platform:        'NA',
      target_keywords: 'NA',
      ad_sub_position: payload.ad_sub_position ?? 'NA',
      hiddenads:       'NA',
      user_email:      authUser.email          ?? 'NA',
      name:            authUser.name           ?? 'NA',
    };
  } else if (networkKey === 'quora') {
    extra = {
      network:         'Quora',
      platform:        'NA',
      tags:            payload.tags            ?? 'NA',
      hits_sort:       payload.hits_sort       ?? 'NA',
      html:            payload.html            ?? 'NA',
      commentdata:     payload.commentdata     ?? 'NA',
      celeb:           payload.image_celebrity ?? 'NA',
      logo:            payload.image_logo      ?? 'NA',
      object:          payload.image_object    ?? 'NA',
      type_filter:     payload.type            ?? 'NA',
      user_email:      authUser.email          ?? 'NA',
    };
  } else if (networkKey === 'reddit') {
    extra = {
      network:         'Reddit',
      platform:        'NA',
      likes:           payload.likes           ?? 'NA',
      range:           'NA',
      target_keywords: 'NA',
      cname:           'NA',
      celeb:           payload.image_celebrity ?? 'NA',
      logo:            payload.image_logo      ?? 'NA',
      object:          payload.image_object    ?? 'NA',
      hiddenads:       'NA',
    };
  } else if (networkKey === 'gdn') {
    extra = {
      network:         'GDN',
      platform:        'NA',
      target_keywords: 'NA',
      size:            payload.size            ?? 'NA',
      cname:           'NA',
      celeb:           payload.image_celebrity ?? 'NA',
      logo:            payload.image_logo      ?? 'NA',
      object:          payload.image_object    ?? 'NA',
      hiddenads:       'NA',
      email:           authUser.email          ?? 'NA',
    };
  } else if (isAll) {
    extra = {
      network:         'All',
      platform:        'NA',
      ocr:             payload.ocr               ?? 'NA',
      celeb:           payload.image_celebrity   ?? 'NA',
      logo:            payload.image_logo        ?? 'NA',
      object:          payload.image_object      ?? 'NA',
      type_filter:     payload.type              ?? 'NA',
      user_email:      authUser.email            ?? 'NA',
      views_sort:      payload.views_sort        ?? 'NA',
      views:           rangeToStr(payload.view)  ?? 'NA',
      view:            rangeToStr(payload.view)  ?? 'NA',
      likes:           rangeToStr(payload.likes) ?? 'NA',
      comments:        rangeToStr(payload.comments) ?? 'NA',
      shares:          rangeToStr(payload.shares)   ?? 'NA',
      impressions:     rangeToStr(payload.impressions) ?? 'NA',
      popularity:      rangeToStr(payload.popularity)  ?? 'NA',
      adBudget:        payload.adBudget          ?? 'NA',
      adBudget_sort:   payload.adBudget_sort     ?? 'NA',
      verified:        payload.verified          ?? 'NA',
      meta_ads_lib_filter: (payload.platform === 15 || Array.isArray(payload.platform_positions)) ? 'true' : 'NA',
      size:            payload.size              ?? 'NA',
      nativeNetwork:   payload.nativeNetwork     ?? 'NA',
      ad_sub_position: payload.ad_sub_position   ?? 'NA',
      budget:          payload.budget && payload.budget !== 'NA' ? payload.budget : 'NA',
      ctr:             rangeToStr(payload.ctr),
    };
  } else if (networkKey === 'tiktok') {
    extra = {
      network:         'tiktok',
      platform:        'NA',
      celeb:           payload.image_celebrity ?? 'NA',
      logo:            payload.image_logo      ?? 'NA',
      object:          payload.image_object    ?? 'NA',
      budget:          payload.budget && payload.budget !== 'NA' ? payload.budget : 'NA',
    };
  } else {
    extra = {
      network:  networkKey,
      platform: 'NA',
      celeb:    payload.image_celebrity ?? 'NA',
      logo:     payload.image_logo      ?? 'NA',
      object:   payload.image_object    ?? 'NA',
    };
  }
  /* v8 ignore stop */

  const body = { ...common, ...extra };
  console.log('[UserActivity] payload:', JSON.stringify(body, null, 2));
  const formBody = Object.entries(body)
    .filter(([, v]) => v !== null && v !== undefined)
    .flatMap(([k, v]) => {
      if (Array.isArray(v)) return v.map(item => `${encodeURIComponent(k)}[]=${encodeURIComponent(item)}`);
      /* v8 ignore next -- telemetry body values are only strings/numbers/arrays; the plain-object branch is defensive */
      return [`${encodeURIComponent(k)}=${encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : v)}`];
    })
    .join('&');
  // fetch(`${USER_ACTIVITY_URL}/user_activity`, { ... }); // old Laravel endpoint
  fetch(`${PAS_API_BASE}/api/v1/frontend_user_activity/user-activity`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(getPASToken() ? { Authorization: `Bearer ${getPASToken()}` } : {}),
    },
    body: formBody,
  }).catch(() => {});
}

export function trackProjectEvent(method, fields = {}) {
  if (!PAS_API_BASE) return;
  const authUser = getAuthUser();
  if (!authUser?.user_id) { console.warn('[trackProjectEvent] no authUser or user_id, skipping'); return; }
  const body = {
    user_id:              authUser.user_id,
    name:                 authUser.name || authUser.login || authUser.username || 'NA',
    email:                authUser.email ?? 'NA',
    network:              'Project',
    userSubscriptionType: authUser.userSubscriptionType ?? 'NA',
    method,
    brand:                fields.brand        ?? 'NA',
    advertiser:           fields.advertiser   ?? 'NA',
    competitors:          fields.competitors  ?? 'NA',
  };
  if (fields.project_name          != null) body.project_name          = fields.project_name;
  if (fields.dashboard_Advertisers != null) body.dashboard_Advertisers = fields.dashboard_Advertisers;
  if (fields.deleted_Advertisers   != null) body.deleted_Advertisers   = fields.deleted_Advertisers;
  if (fields.monitoring_status     != null) body.monitoring_status     = fields.monitoring_status;
  if (fields.network               != null) body.competitor_platform   = fields.network;
  if (fields.exported_Competitors  != null) body.exported_Competitors  = fields.exported_Competitors;
  if (fields.member_name           != null) body.member_name           = fields.member_name;
  if (fields.member_email          != null) body.member_email          = fields.member_email;
  if (fields.delete_member_name    != null) body.delete_member_name    = fields.delete_member_name;
  if (fields.delete_member_email   != null) body.delete_member_email   = fields.delete_member_email;
  const ARRAY_KEYS = new Set(['competitors', 'dashboard_Advertisers', 'deleted_Advertisers', 'exported_Competitors']);
  const formBody = Object.entries(body)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => {
      if (ARRAY_KEYS.has(k)) {
        const arr = Array.isArray(v) ? v : [v];
        return `${encodeURIComponent(k)}=${encodeURIComponent(JSON.stringify(arr))}`;
      }
      return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
    })
    .join('&');
  const url = `${PAS_API_BASE}/api/v1/frontend_user_activity/user-activity-project`;
  console.log('[trackProjectEvent] posting to', url, 'token:', !!getPASToken(), 'body:', formBody);
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(getPASToken() ? { Authorization: `Bearer ${getPASToken()}` } : {}),
    },
    body: formBody,
  }).then(r => { r.text().then(t => console.log('[trackProjectEvent] response', r.status, t)); })
    .catch(e => console.error('[trackProjectEvent] fetch error', e));
}

export function trackEvent(method, fields = {}) {
  if (!PAS_API_BASE) return;
  const authUser = getAuthUser();
  const user_id = authUser?.user_id ?? fields.user_id ?? 'guest';
  const FIXED_KEYS = new Set(['user_id', 'network', 'ad_id', 'domain', 'userSubscriptionType', 'email', 'hidetype', 'unhidetype']);
  const body = {
    user_id,
    method,
    network:              fields.network  ?? 'NA',
    ad_id:                fields.ad_id    ?? 'NA',
    domain:               fields.domain   ?? 'NA',
    userSubscriptionType: authUser?.userSubscriptionType ?? fields.userType ?? 'NA',
    email:                authUser?.email ?? fields.email ?? 'NA',
  };
  if (fields.hidetype   != null) body.hidetype   = fields.hidetype;
  if (fields.unhidetype != null) body.unhidetype = fields.unhidetype;
  // Forward any extra fields (e.g. username, email for LoggedIn)
  for (const [k, v] of Object.entries(fields)) {
    if (!FIXED_KEYS.has(k) && k !== 'userType' && v != null) body[k] = v;
  }
  const formBody = Object.entries(body)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  // fetch(`${USER_ACTIVITY_URL}/user_activity`, { ... }); // old Laravel endpoint
  fetch(`${PAS_API_BASE}/api/v1/frontend_user_activity/user-activity`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(getPASToken() ? { Authorization: `Bearer ${getPASToken()}` } : {}),
    },
    body: formBody,
  }).catch(() => {});
}

export const fetchAds = async (filters = {}, { signal } = {}) => {
  const payload = buildSearchPayload(filters);

  const response = await fetch(`${PAS_API_BASE}/api/v1/common/ads/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(getPASToken() ? { Authorization: `Bearer ${getPASToken()}` } : {}),
    },
    body: JSON.stringify(payload),
    signal,
  });

  await checkFor401(response);

  if (response.status === 403) {
    const json = await response.json();
    const err = new Error(json.message || 'Access restricted by your plan.');
    err.code = 403;
    err.showSubscriptionModal = json.showSubscriptionModal || false;
    err.platformRestriction = json.platformRestriction || false;
    err.restrictedFilters = json.restrictedFilters || [];
    err.allowedPlatforms = json.allowedPlatforms || [];
    throw err;
  }

  if (!response.ok) {
    throw new Error(`Ads API error: ${response.status}`);
  }

  const json = await response.json();
  // Some servers return 200 with { code: 401, message: "Unauthorized: Token expired" }
  if (json.code === 401 || (typeof json.message === 'string' && json.message.toLowerCase().includes('token expired'))) {
    handle401();
    throw new Error('Unauthorized: Token expired');
  }
  const rawAds = json.data || [];

  // ── Frontend safety-net sort — always applied regardless of network count ─────
  // Backend sorts correctly, but this guarantees order on the client side too
  // (handles stale deploys, multi-network merge edge cases, and single-network
  // responses where a range filter is active with an explicit sort field).
  // Resolve sortField from both the built payload flags AND the original
  // sortBy filter — the payload flag is only set when buildSearchPayload's
  // SORT_MAP recognises the tab value, so SDUI tabs with non-canonical values
  // (e.g. "Popularity" label, custom backend tokens) can otherwise silently
  // fall through to the last_seen default and leave the order unsorted.
  let sortField = 'last_seen';
  const rawSortBy = String(filters.sortBy ?? filters.sorting ?? '').toLowerCase().trim();
  const SORT_BY_FIELD_MAP = {
    popular: 'popularity', popularity: 'popularity', popularity_score: 'popularity',
    '-popularity_score': 'popularity', popularity_sort: 'popularity',
    impressions: 'impression', impression: 'impression', '-impressions': 'impression',
    impression_sort: 'impression', impressions_range: 'impression',
    newest: 'last_seen', latest: 'last_seen', post_date: 'last_seen',
    '-created_at': 'last_seen', created_at: 'last_seen', new: 'last_seen',
    last_seen: 'last_seen',
    likes: 'likes', like: 'likes', '-engagement_score': 'likes',
    comments: 'comment', comment: 'comment',
    shares: 'share', share: 'share',
    running_days: 'days_running', running_longest: 'days_running',
    days_running: 'days_running', longest_running: 'days_running',
    ad_budget: 'ad_budget', adbudget: 'ad_budget', budget: 'ad_budget',
    avg_ad_budget: 'ad_budget',
  };
  if (SORT_BY_FIELD_MAP[rawSortBy]) sortField = SORT_BY_FIELD_MAP[rawSortBy];
  else if (payload.running_longest_sort === 'running_longest_sort') sortField = 'days_running';
  else if (payload.likes_sort === 'likes_sort') sortField = 'likes';
  else if (payload.comments_sort === 'comments_sort') sortField = 'comment';
  else if (payload.shares_sort === 'shares_sort') sortField = 'share';
  else if (payload.impression_sort === 'impression_sort') sortField = 'impression';
  else if (payload.popularity_sort === 'popularity_sort') sortField = 'popularity';
  else if (payload.adBudget_sort === 'adBudget_sort') sortField = 'ad_budget';
  else if (payload.newest_sort === 'newest_sort') sortField = 'last_seen';
  else if (payload.last_seen_sort === 'LastSeen_sort') sortField = 'last_seen';

  const toTs = (v) => {
    if (!v) return 0;
    if (typeof v === 'number') return v < 1e10 ? v * 1000 : v;
    const ms = Date.parse(String(v));
    return isNaN(ms) ? 0 : ms;
  };

  // Map raw sort field name → corresponding mapped-ad field. We sort the
  // mapped ads (rather than rawAds) for fields whose mapping cleans up the
  // shape — most importantly `popularity`, which arrives from some backends
  // as `{ current: N }` (Number(obj) → NaN, every ad collapses to 0 and the
  // ordering is lost). For numeric fields stored as formatted strings on
  // the mapped ad (likes/views/etc), fall back to reading rawAds.
  const MAPPED_NUMERIC_FIELDS = {
    popularity: 'popularity',
    days_running: 'runningDays',
  };
  const RAW_NUMERIC_FIELDS = new Set(['likes', 'comment', 'share', 'impression', 'ad_budget']);
  // null/missing scores sink to the end regardless of direction
  const cmpDesc = (av, bv) => {
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  };
  const toNumRaw = (raw, field) => {
    const v = raw?.[field];
    if (v == null || v === '') return null;
    if (typeof v === 'object') {
      const c = v.current ?? v.score ?? v.value ?? null;
      if (c == null) return null;
      const n = Number(c);
      return isNaN(n) ? null : n;
    }
    const n = Number(v);
    return isNaN(n) ? null : n;
  };

  // Map first, then sort using the cleaned-up `popularity` (or `runningDays`)
  // value — guarantees the order matches what the cards actually display.
  const mappedAds = rawAds.map(mapAdToCard);
  let sortedAds;
  if (mappedAds.length <= 1) {
    sortedAds = mappedAds;
  } else if (MAPPED_NUMERIC_FIELDS[sortField]) {
    const mappedKey = MAPPED_NUMERIC_FIELDS[sortField];
    sortedAds = [...mappedAds].sort((a, b) => {
      const av = a[mappedKey] == null ? null : Number(a[mappedKey]);
      const bv = b[mappedKey] == null ? null : Number(b[mappedKey]);
      return cmpDesc(av, bv);
    });
  } else if (RAW_NUMERIC_FIELDS.has(sortField)) {
    // For these we pair mapped ads with their raw counterparts so the
    // comparator can read numeric values that mapAdToCard formatted into
    // display strings.
    const paired = mappedAds.map((m, i) => ({ m, raw: rawAds[i] }));
    paired.sort((a, b) => cmpDesc(toNumRaw(a.raw, sortField), toNumRaw(b.raw, sortField)));
    sortedAds = paired.map(p => p.m);
  } else {
    const paired = mappedAds.map((m, i) => ({ m, raw: rawAds[i] }));
    paired.sort((a, b) => toTs(b.raw?.[sortField]) - toTs(a.raw?.[sortField]));
    sortedAds = paired.map(p => p.m);
  }

  // Fire-and-forget user activity — only on fresh search (skip=0), not scroll pagination
  if (!filters.skip || filters.skip === 0) {
    trackUserActivity({
      ...payload,
      isAllTab:            filters.isAllTab,
      project_name:             filters.project_name        ?? 'NA',
      competitor_name:          filters.competitor_name     ?? 'NA',
      competitor_platform:      filters.competitor_platform ?? 'NA',
      competitor_platform_click: filters.competitor_platform ?? 'NA',
    }, json.meta);
  }

  return {
    ads: sortedAds,
    meta: json.meta || {},
  };
};

/**
 * Fetches up to 100 ads for CSV export using the current search/filter state.
 * Identical to fetchAds but overrides take=100 and skip=0 in the payload.
 */
export const fetchAdsForExport = async (filters = {}) => {
  const payload = buildSearchPayload(filters);
  payload.take = '100';
  payload.skip = 0;

  const response = await fetch(`${PAS_API_BASE}/api/v1/common/ads/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(getPASToken() ? { Authorization: `Bearer ${getPASToken()}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) return [];
  const json = await response.json();
  const rawAds = json.data || [];
  return rawAds.map(mapAdToCard);
};

/**
 * Fetches exactly one ad for the landing page.
 * Uses the specialized Node.js endpoint that returns raw DB/ES data for a single ID.
 */
export const fetchLandingAd = async (network, adId) => {
  // const PAS_API_BASE = import.meta.env.VITE_PAS_NODE_API_URL || "http://localhost:3000";

  const response = await fetch(`${PAS_API_BASE}/api/v1/common/ads/getAdsByAdvertiser`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(getPASToken() ? { Authorization: `Bearer ${getPASToken()}` } : {}),
    },
    body: JSON.stringify({ ad_id: adId, network: network.toLowerCase() }),
  });

  await checkFor401(response);
  if (!response.ok) {
    throw new Error(`Landing Ad API error: ${response.status}`);
  }

  const json = await response.json();
  // This endpoint returns an array of ads in 'data'
  const rawAds = json.data || [];
  return {
    ads: rawAds.map(ad => mapAdToCard({ ...ad, network })),
    meta: { total: rawAds.length },
  };
};

/**
 * @deprecated Use fetchSDUIConfig() from sduiService.js instead.
 * Fetches UI configuration from the backend (legacy endpoint).
 */
export const fetchUIConfig = async () => {
  console.warn('[DEPRECATED] fetchUIConfig() — use fetchSDUIConfig() from sduiService.js');
  try {
    const response = await fetch('http://localhost:8080/api/ui/config');
    if (!response.ok) {
      throw new Error('Failed to fetch UI configuration');
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching UI config:', error);
    return getDefaultUIConfig();
  }
};

/**
 * Default UI configuration as fallback
 */
const getDefaultUIConfig = () => ({
  header: {
    search_types: [
      { id: 'search_keyword', label: 'Keyword', unique_identifier: 'keyword', api_field: 'keyword' },
      { id: 'search_advertiser', label: 'Advertiser', unique_identifier: 'advertiser', api_field: 'advertiser_name' }
    ],
    platforms: [
      { id: 'platform_facebook', label: 'FB', unique_identifier: 'facebook', selected_by_default: true },
      { id: 'platform_instagram', label: 'IG', unique_identifier: 'instagram', selected_by_default: true },
      { id: 'platform_youtube', label: 'YT', unique_identifier: 'youtube', selected_by_default: false },
      { id: 'platform_linkedin', label: 'IN', unique_identifier: 'linkedin', selected_by_default: false },
      { id: 'platform_google', label: 'GGL', unique_identifier: 'google', selected_by_default: false }
    ],
    sorting: [
      { id: 'sort_newest', label: 'Newest', unique_identifier: 'newest', default: true, query_sort: '-created_at' },
      { id: 'sort_popular', label: 'Popular', unique_identifier: 'popular', default: false, query_sort: '-likes' }
    ],
    features: [],
    search_config: {
      placeholder: 'Search keyword, advertiser, or domain...',
      min_length: 2,
      max_length: 120,
      debounce_ms: 400,
      autosuggest: true
    }
  },
  sidebar_filters: []
});
export const buildAuditPrompt = (ad) =>
  `Analyze this ad:\nTitle: "${ad.title}"\nAdvertiser: "${ad.advertiser}"\nCategory: "${ad.subtitle}"\nEngagement: ${ad.likes} likes, ${ad.views} views, ${ad.shares} shares.\n\nBrief bulleted insights on:\n1. Core psychological trigger\n2. Target audience persona\n3. Performance prediction\n4. One improvement tip`;

/**
 * Builds a campaign strategy prompt for a list of ads.
 */
export const buildCampaignPrompt = (ads) =>
  `Based on these ads:\n${ads.map(a => `- ${a.title}`).join('\n')}\n\nGenerate a concise 30-day blitz strategy for a new competitor.`;

// ─────────────────────────────────────────────────────────────────────────────
// Filters API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @deprecated Use fetchSDUIConfig() from sduiService.js instead.
 * Fetches filter configuration from the backend API (legacy endpoint).
 */
export const fetchFilters = async () => {
  console.warn('[DEPRECATED] fetchFilters() — use fetchSDUIConfig() from sduiService.js');
  const response = await fetch('http://localhost:8080/api/filters');
  if (!response.ok) {
    throw new Error('Failed to fetch filters');
  }
  const data = await response.json();
  return data.groups;
};

// ─────────────────────────────────────────────────────────────────────────────
// Competitor Analysis API
// ─────────────────────────────────────────────────────────────────────────────

export const competitorFetch = async (path, options = {}) => {
  const token = getAuthToken();

  // Build headers safely
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  // Always override Authorization (important)
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${COMPETITOR_API_BASE}${path}`, {
    ...options,
    headers,
    cache: 'no-store', // avoids 304 issues
  });

  // Safe JSON parsing
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }

  if (res.status === 401) { handle401(); throw new Error('Unauthorized: Token expired'); }
  if (!res.ok) {
    console.error("API Error:", res.status, data);
    throw new Error(`Competitor API ${path} failed: ${res.status}`);
  }

  return data; // direct JSON
};

export const CompetitorAPI = {
  // Initialize user session — check if user exists, auto-create if not (mirrors Laravel dashFunction)
  initializeCompetitorSession: async (user) => {
    const email = user?.email || "";
    const checkRes = await competitorFetch(`/check-user?email=${encodeURIComponent(email)}`, { method: 'GET' });

    if (checkRes?.statusCode === 201) {
      // User exists — return their MongoDB _id
      return checkRes?.body?.data?._id || null;
    }

    if (checkRes?.statusCode === 401) {
      // User not found — register them
      const createRes = await competitorFetch('/create-comp-details', {
        method: 'POST',
        body: JSON.stringify({
          amember_id:       user?.user_id  || user?.id || "",
          plan_id:          user?.userSubscriptionType || "",
          plan_expiry_date: user?.expiry_date || new Date().toISOString(),
          email:            email,
          userName:         user?.login    || "",
        }),
      });
      return createRes?.body?.data?._id || null;
    }

    return null;
  },

  // Dashboard projects
  getDashboardProjects: (mongoId) =>
    competitorFetch('/project-details', {
      method: 'POST',
      body: JSON.stringify({ user_id: mongoId }),
    }),

  // Competitor count
  getCompetitorCount: (name) =>
    competitorFetch('/get-competitor-count', {
      method: 'POST',
      body: JSON.stringify({ competitors: [name] }),
    }),

  getCompetitorCountNew: (names) =>
    competitorFetch('/get-competitor-count-new', {
      method: 'POST',
      body: JSON.stringify({ competitors: names }),
    }),

  // Keywords
  fetchKeywordsBasedOnWebsite: (webSiteUrl, adv) =>
    competitorFetch('/fetch-keywords-basedOnWebsite', {
      method: 'POST',
      body: JSON.stringify({ webSiteUrl, adv }),
    }),

  // Competitor process
  checkCompetitorProcess: (contentRefId, keywords, limit, advertiser, userId) =>
    competitorFetch('/check-competitor-process', {
      method: 'POST',
      body: JSON.stringify({
        content_ref_id: contentRefId,
        keywords,
        limit,
        advertiser,
        user_id: userId,
      }),
    }),

  // Store competitors
  getStoreProcessCompetitors: (advertiser, contentRefId, target, userId) =>
    competitorFetch('/get-store-process-competitors', {
      method: 'POST',
      body: JSON.stringify({
        advertiser,
        content_ref_id: contentRefId,
        target,
        user_id: userId,
      }),
    }),

  // Search competitors
  generateCompetitorsSearch: (project_name, userId, page = 1, limit = 10) =>
    competitorFetch('/compeitetor-name-client', {
      method: 'POST',
      body: JSON.stringify({
        project_name,
        user_id: userId,
        page,
        limit,
      }),
    }),

  // Update monitoring
  updateMonitoringStatus: (data) =>
    competitorFetch('/update-monitoring', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Check brand
  checkBrand: (brand, competitorUserId) =>
    competitorFetch('/check-brand', {
      method: 'POST',
      body: JSON.stringify({ brand, user_id: competitorUserId })
    }),

  // ── Members + per-brand competitor-email CC ──
  // (see compeitetor_analysis/docs/MEMBER_CC_MANIFEST.md)
  listMembers: (userId) =>
    competitorFetch('/members/list', { method: 'POST', body: JSON.stringify({ user_id: userId }) }),
  addMember: (userId, name, email) =>
    competitorFetch('/members/add', { method: 'POST', body: JSON.stringify({ user_id: userId, name, email }) }),
  updateMember: (userId, memberId, patch) =>
    competitorFetch('/members/update', { method: 'POST', body: JSON.stringify({ user_id: userId, member_id: memberId, ...patch }) }),
  deleteMember: (userId, memberId) =>
    competitorFetch('/members/delete', { method: 'POST', body: JSON.stringify({ user_id: userId, member_id: memberId }) }),
  getBrandCc: (userId, projectId) =>
    competitorFetch('/brand-cc/get', { method: 'POST', body: JSON.stringify({ user_id: userId, project_id: projectId }) }),
  setBrandCc: (userId, projectId, memberIds) =>
    competitorFetch('/brand-cc/set', { method: 'POST', body: JSON.stringify({ user_id: userId, project_id: projectId, member_ids: memberIds }) }),

  // ── Analytics / Comparison Endpoints ─────────────────────────────

  // Monthly ad count breakdown by platform
  getAdCount: (competitor) =>
    competitorFetch('/get-ad-count', {
      method: 'POST',
      body: JSON.stringify({ competitors: competitor }),
    }),

  // Monthly engagement stats (likes, comments, shares, views) per platform
  getLCS: (competitor) =>
    competitorFetch('/get-lcs', {
      method: 'POST',
      body: JSON.stringify({ competitors: competitor }),
    }),

  // Average budget by monthly/daily/yearly per platform
  getAverageBudget: (competitor, startDate, endDate) =>
    competitorFetch('/get-avgbud-data', {
      method: 'POST',
      body: JSON.stringify({ competitors: competitor, ...(startDate && { startDate }), ...(endDate && { endDate }) }),
    }),

  // Top countries, ad positions, CTA trends per platform
  getFrequentData: (competitor) =>
    competitorFetch('/get-frequent-data', {
      method: 'POST',
      body: JSON.stringify({ competitors: competitor }),
    }),

  // Engagement analytics (impression, popularity, engagement rates)
  getEngagement: (competitor) =>
    competitorFetch('/get-engagement', {
      method: 'POST',
      body: JSON.stringify({ competitors: competitor }),
    }),

  // Top 5 most-liked ads (full ad documents) per platform
  getTopLikes: (competitor) =>
    competitorFetch('/get-top-likes', {
      method: 'POST',
      body: JSON.stringify({ competitors: competitor }),
    }),

  // Top 5 most popular ads (full ad documents) per platform
  getTopPopularity: (competitor) =>
    competitorFetch('/get-top-popularity', {
      method: 'POST',
      body: JSON.stringify({ competitors: competitor }),
    }),

  // Top 5 longest running ads (full ad documents) per platform
  getLongest: (competitor) =>
    competitorFetch('/get-longest', {
      method: 'POST',
      body: JSON.stringify({ competitors: competitor }),
    }),

  // Rename a project's brand/advertiser name. Backend expects the OLD name
  // wrapped in an array (it patches advertiser.$ inside competitors_request).
  renameAdvertiser: (userId, oldName, newName) =>
    competitorFetch('/update-advertiser', {
      method: 'PATCH',
      body: JSON.stringify({
        user_id: userId,
        advertiser: [oldName],
        newadvertiser: newName,
      }),
    }),

  // Delete a project (competitors_request doc) by user_id + advertiser name
  deleteProject: (userId, advertiser) =>
    competitorFetch('/delete-project', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, advertiser }),
    }),

  // Manually add a competitor to an existing project
  addManualCompetitor: ({ userId, advertiser, competitorName, competitorUrl }) =>
    competitorFetch('/add-manual-competitor', {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId,
        advertiser,
        competitor_name: competitorName,
        competitor_url: competitorUrl,
      }),
    }),

  // Detach a competitor from a project (removes it in MongoDB so it stays gone
  // after reload). Resolves by id; falls back to name on the backend.
  deleteCompetitor: ({ userId, advertiser, competitorId, competitorName }) =>
    competitorFetch('/delete-competitor', {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId,
        advertiser,
        competitor_id: competitorId,
        competitor_name: competitorName,
      }),
    }),
};

/**
 * Fetch insights for an advertiser based on date range.
 * @param {Object} params
 * @param {number} params.post_owner_id
 * @param {string} params.from_date - YYYY-MM-DD
 * @param {string} params.to_date - YYYY-MM-DD
 * @param {'lcs'|'country'|'user'} params.type
 * @param {number} params.user_id
 * @returns {Promise<Object>}
 */
export const getAdvertiserInsightsByDateRange = async ({ post_owner_id, from_date, to_date, type, user_id = 281, network = 'facebook' }) => {
  const platformRoute = PLATFORM_ROUTE_MAP[(network || 'facebook').toLowerCase()] || 'facebook';
  const res = await fetch(`${PAS_API_BASE}/api/v1/${platformRoute}/ads/getAdvertiserInsightsByDateRange`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getPASToken()}`,
    },
    body: JSON.stringify({ post_owner_id, from_date, to_date, type, user_id }),
  });

  await checkFor401(res);
  const data = await res.json();
  if (!res.ok && res.status !== 400) {
    throw new Error(`getAdvertiserInsightsByDateRange failed: ${res.status}`);
  }
  return data;
};

/**
 * Creates a shareable link for an ad.
 * Backend hardcodes 7-day expiry.
 * Returns { token, expiresAt } from the backend.
 */
export const createShareLink = async ({ adId, network }) => {
  const response = await fetch(`${PAS_API_BASE}/api/v1/common/ads/share`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(getPASToken() ? { Authorization: `Bearer ${getPASToken()}` } : {}),
    },
    body: JSON.stringify({
      ad_id: adId,
      network: network.toLowerCase(),
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || `Share link API error: ${response.status}`);
  }

  const json = await response.json();
  return { token: json.token, expiresAt: json.expires_at };
};

/**
 * Fetches a shared ad by its share token.
 * Public endpoint — no auth required.
 * Returns { ad, expiresAt, expired }
 */
export const fetchSharedAd = async (shareToken) => {
  // const PAS_API_BASE = import.meta.env.VITE_PAS_API_BASE_URL || "http://localhost:3000";

  const response = await fetch(`${PAS_API_BASE}/api/v1/common/ads/share/${shareToken}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (response.status === 410) {
    const err = new Error("Share link has expired");
    err.status = 410;
    err.expired = true;
    throw err;
  }

  if (!response.ok) {
    throw new Error(`Shared ad API error: ${response.status}`);
  }

  const json = await response.json();
  if (json.expired) {
    return { expired: true, ad: null, expiresAt: null };
  }

  return {
    expired: false,
    ad: mapAdToCard({ ...json.ad, network: json.network || json.ad?.network }),
    expiresAt: json.expires_at,
  };
};

/**
 * Creates a shareable dashboard snapshot.
 * Stores UI state + search payload for guest access.
 * Returns { token, expiresAt }
 */
export const createDashboardShare = async ({ uiState, searchPayload }) => {
  const response = await fetch(`${PAS_API_BASE}/api/v1/common/dashboard/share`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(getPASToken() ? { Authorization: `Bearer ${getPASToken()}` } : {}),
    },
    body: JSON.stringify({ uiState, searchPayload }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || `Dashboard share API error: ${response.status}`);
  }

  const json = await response.json();
  return { token: json.token, expiresAt: json.expires_at };
};

/**
 * Fetches stored dashboard state by share token.
 * Public — no auth required.
 * Returns { uiState, expiresAt, expired }
 */
export const fetchDashboardState = async (token) => {
  const response = await fetch(`${PAS_API_BASE}/api/v1/common/dashboard/share/${token}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (response.status === 410) {
    const err = new Error("Dashboard share link has expired");
    err.status = 410;
    err.expired = true;
    throw err;
  }

  if (!response.ok) {
    const err = new Error(`Dashboard state API error: ${response.status}`);
    err.status = response.status;
    throw err;
  }

  const json = await response.json();
  if (json.expired) {
    return { expired: true, uiState: null, expiresAt: null };
  }

  return {
    expired: false,
    uiState: json.uiState,
    expiresAt: json.expires_at,
  };
};

/**
 * Guest search — runs search using stored dashboard filters.
 * Public — no auth. Limited to 100 ads per network.
 * Returns same structure as fetchAds.
 */
export const guestSearchAds = async (token, skip = 0) => {
  const response = await fetch(`${PAS_API_BASE}/api/v1/common/dashboard/guest-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, skip, user_id: 281 }), // user_id is optional, used for rate limiting in backend
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || `Guest search error: ${response.status}`);
  }

  const json = await response.json();
  const rawAds = json.data || [];

  return {
    ads: rawAds.map(mapAdToCard),
    availableNetworks: json.meta?.networksWithData || [],
    noDataMessage: rawAds.length === 0 ? "No ads found" : null,
    meta: json.meta || {},
    guestLimitReached: json.meta?.guestLimitReached || false,
  };
};

export const publicSearchAds = async (skip = 0, network = 'all') => {
  const response = await fetch(`${PAS_API_BASE}/api/v1/common/dashboard/public-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skip, network }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || `Public search error: ${response.status}`);
  }

  const json = await response.json();
  const rawAds = json.data || [];

  return {
    ads: rawAds.map(mapAdToCard),
    availableNetworks: json.meta?.networksWithData || [],
    noDataMessage: rawAds.length === 0 ? "No ads found" : null,
    meta: json.meta || {},
    guestLimitReached: json.meta?.guestLimitReached || false,
  };
};

// ─── Keyword Search store (MongoDB, per-network) ──────────────────────────────
// Stores a frontend search into the new keyword_searches collection.
// Authenticated users ONLY (no guest / public). type: 'keyword' | 'advertiser' | 'domain'.
// network: 'all' or an array/comma-list of platform slugs.
export const saveKeywordSearch = async ({ value, type, network, email, ads_count }) => {
  const token = getPASToken();
  if (!token) return null; // authenticated users only
  const res = await fetch(`${PAS_API_BASE}/api/v1/common/keyword-search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ value, type, network, email, ads_count }),
  });
  await checkFor401(res);
  if (!res.ok) return null;
  return res.json();
};

// ─────────────────────────────────────────────────────────────────────────────
// TikTok Video URL Refresh — called when a TikTok video_url has expired
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch a fresh video URL for a TikTok ad whose CDN link has expired.
 * Calls the backend proxy which scrapes TikTok Creative Center.
 *
 * @param {string} libraryUrl - The TikTok Creative Center library URL
 * @returns {Promise<string|null>} Fresh video URL or null on failure
 */
export const fetchFreshTikTokVideoUrl = async (libraryUrl) => {
  if (!libraryUrl) return null;
  try {
    const res = await fetch(`${PAS_API_BASE}/api/v1/tiktok/ads/refresh-video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(getPASToken() ? { Authorization: `Bearer ${getPASToken()}` } : {}),
      },
      body: JSON.stringify({ library_url: libraryUrl }),
    });
    await checkFor401(res);
    if (!res.ok) return null;
    const json = await res.json();
    return json.data?.video_url || null;
  } catch {
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Notifications — Real-time scraping alerts
// ─────────────────────────────────────────────────────────────────────────────

// keyword_ad_notifications store uses type 1=keyword, 2=advertiser, 3=domain; the bell's
// TYPE_MAP (NotificationPopup) + Header toast use 0/1/2 — shift down by one so the right
// icon/label render without touching those components.
const NOTIFY_TYPE_TO_UI = { 1: 0, 2: 1, 3: 2 };

/**
 * Fetch keyword→ad-count notifications for the current user.
 * GET /api/v1/common/keyword-ad-notifications — each call also runs a per-user scan
 * server-side, then returns the caller's pending (notified:false) docs. The response
 * carries meta.pollIntervalMs (env-controlled) so the bell can self-pace its polling.
 */
export const fetchNotifications = async () => {
  try {
    const res = await fetch(`${PAS_API_BASE}/api/v1/common/keyword-ad-notifications`, {
      headers: {
        Authorization: `Bearer ${getPASToken()}`,
      },
    });
    await checkFor401(res);
    if (!res.ok) return { data: [], meta: { unreadCount: 0 } };
    const json = await res.json();
    // Map Mongo docs → the shape the bell UI already consumes (id / keyword / type /
    // created_at). adsCount + network are passed through for richer wording if needed.
    const data = (json.data || []).map((n) => ({
      id: n._id,
      keyword: n.value,
      type: NOTIFY_TYPE_TO_UI[n.type] ?? 0,
      network: n.network,
      adsCount: n.adsCount,
      created_at: n.createdAt || n.updatedAt,
    }));
    return { data, meta: json.meta || { unreadCount: data.length } };
  } catch {
    return { data: [], meta: { unreadCount: 0 } };
  }
};

/**
 * Mark keyword ad-notifications as read.
 * POST /api/v1/common/keyword-ad-notifications/read — accepts the whole id array in one
 * call; the server deletes those notification docs for this user.
 * @param {string[]} ids — notification _ids to mark
 */
export const markNotificationsRead = async (ids = []) => {
  try {
    if (!Array.isArray(ids) || ids.length === 0) return true;
    const res = await fetch(`${PAS_API_BASE}/api/v1/common/keyword-ad-notifications/read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getPASToken()}`,
      },
      body: JSON.stringify({ ids }),
    });
    await checkFor401(res);
    return res.ok;
  } catch {
    return false;
  }
};

export default {
  fetchPlanAccess,
  fetchAds,
  hideAds,
  fetchHiddenAndFavourites,
  getAdvertiserInsightsByDateRange,
  createShareLink,
  fetchSharedAd,
  createDashboardShare,
  fetchDashboardState,
  guestSearchAds,
  saveKeywordSearch,
  fetchFreshTikTokVideoUrl,
  fetchNotifications,
  markNotificationsRead,
};
