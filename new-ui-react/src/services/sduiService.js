import { SDUI_BASE, CLIENT_VERSION, CACHE_TTL } from '../constants/sduiVersions';
import { normalizeSDUIConfig } from './sduiNormalizer';
import { isSchemaCompatible } from './sduiVersionCheck';
import { getSDUIFallbackConfig } from '../config/defaultConfig';

// ── Cache keys ─────────────────────────────────────────────────────────────
const LS_CONFIG_KEY = 'sdui_config_cache';
const LS_ETAG_KEY = 'sdui_etag';
const LS_TIMESTAMP_KEY = 'sdui_cached_at';

// ── In-memory cache (fastest layer) ────────────────────────────────────────
let memCache = null;
let memCachedAt = 0;
let memETag = '';

// ── localStorage helpers ───────────────────────────────────────────────────
function writeToLocalStorage(config, etag) {
    try {
        localStorage.setItem(LS_CONFIG_KEY, JSON.stringify(config));
        localStorage.setItem(LS_ETAG_KEY, etag || '');
        localStorage.setItem(LS_TIMESTAMP_KEY, String(Date.now()));
    } catch {
        // localStorage full or disabled — non-fatal
    }
}

function readFromLocalStorage() {
    try {
        const raw = localStorage.getItem(LS_CONFIG_KEY);
        const etag = localStorage.getItem(LS_ETAG_KEY) || '';
        const ts = parseInt(localStorage.getItem(LS_TIMESTAMP_KEY) || '0', 10);
        if (!raw) return null;
        return { config: JSON.parse(raw), etag, cachedAt: ts };
    } catch {
        return null;
    }
}

function clearLocalStorageCache() {
    try {
        localStorage.removeItem(LS_CONFIG_KEY);
        localStorage.removeItem(LS_ETAG_KEY);
        localStorage.removeItem(LS_TIMESTAMP_KEY);
    } catch {
        // non-fatal
    }
}

// ── Hard-refresh detection ─────────────────────────────────────────────────
// Ctrl+Shift+R / Shift+click reload = hard refresh → wipe all caches.
// Normal reload / back-forward / soft navigate = keep caches.
function isHardRefresh() {
    try {
        // Modern API (PerformanceNavigationTiming)
        const nav = performance.getEntriesByType('navigation')[0];
        if (nav) return nav.type === 'reload';

        // Legacy fallback
        if (performance.navigation) return performance.navigation.type === 1;
    } catch {
        // SSR or unsupported — not a hard refresh
    }
    return false;
}

// ── Boot: hydrate or wipe based on navigation type ─────────────────────────
(function bootCache() {
    if (isHardRefresh()) {
        // Hard refresh → clear everything, force fresh fetch
        clearLocalStorageCache();
        memCache = null;
        memCachedAt = 0;
        memETag = '';
        return;
    }

    // Normal load → hydrate memory from localStorage
    const ls = readFromLocalStorage();
    if (ls && ls.config && (Date.now() - ls.cachedAt < CACHE_TTL)) {
        memCache = ls.config;
        memCachedAt = ls.cachedAt;
        memETag = ls.etag;
    }
})();

/**
 * Fetches the full SDUI config from the backend.
 *
 * Cache layers (fastest to slowest):
 * 1. In-memory (memCache) — instant, lives for CACHE_TTL
 * 2. localStorage — survives page reloads, lives for CACHE_TTL
 * 3. Network fetch with ETag → 304 Not Modified = no body transfer
 * 4. Full network fetch
 * 5. Fallback config (hardcoded)
 *
 * @param {Object} options
 * @param {boolean} options.skipCache - Bypass memory + localStorage cache
 * @returns {Promise<Object>} Normalized SDUI config
 */
export async function fetchSDUIConfig(options = {}) {
    const { skipCache = false, platforms = [] } = options;

    // When platforms change, always skip cache to get platform-specific config
    const hasPlatforms = platforms.length > 0;
    const effectiveSkipCache = skipCache || hasPlatforms;

    // ── Layer 1: In-memory cache ──────────────────────────────────────────
    if (!effectiveSkipCache && memCache && (Date.now() - memCachedAt < CACHE_TTL)) {
        return memCache;
    }

    // ── Layer 2: localStorage cache ───────────────────────────────────────
    if (!effectiveSkipCache) {
        const ls = readFromLocalStorage();
        if (ls && ls.config && (Date.now() - ls.cachedAt < CACHE_TTL)) {
            memCache = ls.config;
            memCachedAt = ls.cachedAt;
            memETag = ls.etag;
            return ls.config;
        }
    }

    // ── Layer 3 & 4: Network fetch ────────────────────────────────────────
    try {
        const headers = {
            'X-SDUI-Client-Version': CLIENT_VERSION,
        };
        // Send ETag for conditional request (Layer 3: 304 check)
        const etag = memETag || readFromLocalStorage()?.etag || '';
        if (etag && !hasPlatforms) {
            headers['If-None-Match'] = etag;
        }

        // Build URL with platforms query param
        let url = `${SDUI_BASE}/api/sdui/config`;
        if (hasPlatforms) {
            url += `?platforms=${platforms.join(',')}`;
        }

        const res = await fetch(url, { headers });

        // 304 Not Modified — data hasn't changed, use cached
        if (res.status === 304) {
            const cached = memCache || readFromLocalStorage()?.config;
            if (cached) {
                memCachedAt = Date.now();
                writeToLocalStorage(cached, etag);
                return cached;
            }
        }

        if (!res.ok) {
            throw new Error(`SDUI config fetch failed: ${res.status}`);
        }

        const raw = await res.json();

        // Store ETag
        const newEtag = res.headers.get('ETag') || '';

        // Schema compatibility check
        if (raw.schema_version && !isSchemaCompatible(raw.schema_version)) {
            console.warn(`SDUI schema v${raw.schema_version} incompatible. Using fallback.`);
            return useFallback();
        }

        const normalized = normalizeSDUIConfig(raw);

        // Only cache the full (unfiltered) config — platform-filtered responses must not
        // be stored or they'll show reduced filters on the next page load.
        if (!hasPlatforms) {
            memCache = normalized;
            memCachedAt = Date.now();
            memETag = newEtag;
            writeToLocalStorage(normalized, newEtag);
        }

        return normalized;

    } catch (error) {
        console.warn('SDUI config fetch failed, using cache/fallback:', error.message);

        // Try stale memory cache
        if (memCache) return memCache;

        // Try stale localStorage cache (any age)
        const ls = readFromLocalStorage();
        if (ls?.config) {
            memCache = ls.config;
            return ls.config;
        }

        // Layer 5: Hardcoded fallback
        return useFallback();
    }
}

function useFallback() {
    const fallback = normalizeSDUIConfig(getSDUIFallbackConfig());
    memCache = fallback;
    memCachedAt = Date.now();
    return fallback;
}

/**
 * Fetches only the config version (lightweight, ~100 bytes).
 * Used by polling to avoid fetching the full config every interval.
 */
export async function fetchSDUIConfigVersion() {
    try {
        const res = await fetch(`${SDUI_BASE}/api/v1/sdui/config/version`, {
            headers: { 'X-SDUI-Client-Version': CLIENT_VERSION },
        });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

/**
 * Invalidates all cache layers, forcing a fresh fetch next time.
 */
export function invalidateSDUICache() {
    memCache = null;
    memCachedAt = 0;
    memETag = '';
    clearLocalStorageCache();
}

/**
 * Returns the current cached config version, or 0 if not cached.
 */
export function getCachedConfigVersion() {
    return memCache?.config_version || 0;
}
