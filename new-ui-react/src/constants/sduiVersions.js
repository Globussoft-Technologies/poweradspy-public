// SDUI Versioning Constants
// These are used across sduiService, sduiVersionCheck, and useSDUIPolling.

export const CLIENT_VERSION = '1.0.0';
export const SUPPORTED_SCHEMA_MAJOR = 1;
export const SDUI_BASE = import.meta.env.VITE_SDUI_API_BASE_URL || 'http://localhost:8080';
export const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
export const POLL_INTERVAL = 30_000;     // 30 seconds
