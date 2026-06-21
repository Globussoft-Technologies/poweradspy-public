'use strict';

/**
 * nasStorageReport — builds the single, shared NAS-storage payload used by EVERY NAS endpoint:
 *   - ops dashboard            GET /admin/api/nas-storage      (cookie auth)
 *   - internal/server-to-server GET /api/v1/common/nas-storage (no auth)
 *   - react_admin "NAS Storage" GET /api/v1/admin_user_activity/nas-storage (JWT)
 *
 * Keeping one builder guarantees the three surfaces never drift in shape. `storage` (df total/
 * used/free) is live (cached ~5min in nasAdminClient); `perNetwork` is the latest daily background
 * `du` breakdown; `daily` is the on-disk day-over-day growth series.
 */

const nasAdminClient = require('./nasAdminClient');
const nasStorageHistory = require('./nasStorageHistory');

async function buildNasReport({ days = 30, refresh = false } = {}) {
  const win = Math.min(Math.max(parseInt(days, 10) || 30, 1), 150);
  let storage = null;
  let storageError = null;
  let perNetwork = null;

  if (nasAdminClient.isConfigured()) {
    try {
      storage = await nasAdminClient.getStorage(refresh);
      nasStorageHistory.recordSnapshot(storage);
    } catch (e) {
      storageError = e.message;
    }
    // per-network is best-effort: null until the first daily du completes; never blocks the report.
    try { perNetwork = await nasAdminClient.getPerNetworkSizes(); } catch (e) { /* leave null */ }
  } else {
    storageError = 'NAS admin SSH not configured (insertion.nas.adminHost/User/Pass)';
  }

  const daily = nasStorageHistory.getSeries(win);
  const lastGrowth = [...daily].reverse().find((d) => d.growthBytes != null);

  return {
    storage,
    storageError,
    perNetwork,
    daily,
    points: daily.length,
    windowDays: win,
    lastDayGrowthBytes: lastGrowth ? lastGrowth.growthBytes : null,
  };
}

module.exports = { buildNasReport };
