'use strict';

const insertionRepo = require('../insertion/repository');

const CLAIMS_TABLE = 'mob_ad_lander_claims';
const DEFAULT_REQUESTED_STATUS = 0;

function clampLimit(limit, fallback = 50, max = 50) {
  return Math.min(Math.max(Math.trunc(Number(limit)) || fallback, 1), max);
}

function candidateLimit(limit) {
  return Math.min(Math.max(clampLimit(limit) * 4, clampLimit(limit)), 200);
}

async function attachCountries(sql, rows) {
  if (!rows.length) return rows;

  const ids = [...new Set(rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) {
    return rows.map((row) => ({ ...row, country: '' }));
  }

  const placeholders = ids.map(() => '?').join(', ');
  const countries = await sql.query(
    `SELECT ad_id, country
       FROM mob_ad_countries
      WHERE ad_id IN (${placeholders})
      ORDER BY ad_id ASC, country_key ASC`,
    ids
  );

  const countryMap = new Map();
  for (const row of countries || []) {
    const adId = Number(row.ad_id);
    if (!Number.isFinite(adId) || adId <= 0) continue;
    const name = String(row.country || '').trim();
    if (!name) continue;

    if (!countryMap.has(adId)) {
      countryMap.set(adId, []);
    }
    countryMap.get(adId).push(name);
  }

  return rows.map((row) => ({
    ...row,
    country: (countryMap.get(Number(row.id)) || []).join(', '),
  }));
}

async function getNeverProcessedAds(sql, limit = 50) {
  const safeLimit = candidateLimit(limit);

  // The small candidate expansion absorbs ES misses and same-day claim races
  // without forcing callers to issue multiple GET requests in tight loops.
  const rows = await sql.query(
    `SELECT a.id,
            a.ad_id,
            u.destination_url
       FROM mob_ads a
       INNER JOIN mob_ad_urls u
          ON u.ad_id = a.id
         AND u.destination_url IS NOT NULL
       LEFT JOIN mob_ad_lander_content lc ON lc.ad_id = a.id
       LEFT JOIN ${CLAIMS_TABLE} claim
         ON claim.ad_id = a.id
        AND claim.process_date = CURDATE()
      WHERE lc.ad_id IS NULL
        AND claim.ad_id IS NULL
      ORDER BY a.id DESC
      LIMIT ${safeLimit}`,
    []
  );

  return attachCountries(sql, rows || []);
}

async function getPreviouslyProcessedAds(sql, limit = 50) {
  const safeLimit = candidateLimit(limit);

  const rows = await sql.query(
    `SELECT a.id,
            a.ad_id,
            u.destination_url,
            lc.updated AS last_processed_at
       FROM mob_ad_lander_content lc
       INNER JOIN mob_ads a ON a.id = lc.ad_id
       INNER JOIN mob_ad_urls u
          ON u.ad_id = a.id
         AND u.destination_url IS NOT NULL
       LEFT JOIN ${CLAIMS_TABLE} claim
         ON claim.ad_id = a.id
        AND claim.process_date = CURDATE()
      WHERE lc.updated IS NOT NULL
        AND lc.updated < CURDATE()
        AND claim.ad_id IS NULL
      ORDER BY lc.updated ASC, a.id ASC
      LIMIT ${safeLimit}`,
    []
  );

  return attachCountries(sql, rows || []);
}

async function claimAdForToday(tx, adId, scraperName, requestedStatus) {
  const result = await tx.query(
    `INSERT IGNORE INTO ${CLAIMS_TABLE}
      (ad_id, process_date, scraper_name, requested_status, claimed_at)
     VALUES (?, CURDATE(), ?, ?, NOW(3))`,
    [adId, scraperName, requestedStatus]
  );

  return Number(result?.affectedRows || 0) === 1;
}

async function completeLanderClaim(tx, adId, scraperName, landerStatus) {
  const normalizedStatus = Number.isFinite(Number(landerStatus)) ? Number(landerStatus) : null;

  if (scraperName) {
    const updateResult = await tx.query(
      `UPDATE ${CLAIMS_TABLE}
          SET completed_at = NOW(3),
              last_lander_status = ?,
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE ad_id = ?
          AND process_date = CURDATE()
          AND scraper_name = ?`,
      [normalizedStatus, adId, scraperName]
    );

    if (Number(updateResult?.affectedRows || 0) > 0) {
      return true;
    }

    await tx.query(
      `INSERT INTO ${CLAIMS_TABLE}
        (ad_id, process_date, scraper_name, requested_status, claimed_at, completed_at, last_lander_status)
       VALUES (?, CURDATE(), ?, ${DEFAULT_REQUESTED_STATUS}, NOW(3), NOW(3), ?)
       ON DUPLICATE KEY UPDATE
         scraper_name = VALUES(scraper_name),
         completed_at = VALUES(completed_at),
         last_lander_status = VALUES(last_lander_status),
         updated_at = CURRENT_TIMESTAMP(3)`,
      [adId, scraperName, normalizedStatus]
    );
    return true;
  }

  await tx.query(
    `UPDATE ${CLAIMS_TABLE}
        SET completed_at = NOW(3),
            last_lander_status = ?,
            updated_at = CURRENT_TIMESTAMP(3)
      WHERE ad_id = ?
        AND process_date = CURDATE()`,
    [normalizedStatus, adId]
  );

  return true;
}

// AdMob landers reuse the insertion transaction helpers and ad/ES projection
// queries so the lander and insertion pipelines stay aligned.
module.exports = {
  withTransaction: insertionRepo.withTransaction,
  getAdForUpdate: insertionRepo.getAdForUpdate,
  updateRedirectStatus: insertionRepo.updateRedirectStatus,
  upsertLanderContent: insertionRepo.upsertLanderContent,
  getCompleteAd: insertionRepo.getCompleteAd,
  queueEs: insertionRepo.queueEs,
  completeEs: insertionRepo.completeEs,
  clampLimit,
  claimAdForToday,
  completeLanderClaim,
  getNeverProcessedAds,
  getPreviouslyProcessedAds,
};
