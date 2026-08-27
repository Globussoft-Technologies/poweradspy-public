'use strict';

async function withTransaction(sql, work) {
  const connection = await sql.getConnection();
  const tx = { query: async (query, params) => (await connection.execute(query, params))[0] };
  try {
    await connection.beginTransaction();
    const result = await work(tx);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch { /* preserve original error */ }
    throw error;
  } finally {
    connection.release();
  }
}

async function getAdForUpdate(tx, adId) {
  const rows = await tx.query('SELECT * FROM mob_ads WHERE ad_id = ? LIMIT 1 FOR UPDATE', [adId]);
  return rows[0] || null;
}

async function getAdsForLander(sql, redirectStatus = 0, limit = 50) {
  const safeStatus = Number.isInteger(Number(redirectStatus)) ? Number(redirectStatus) : 0;
  const safeLimit = Math.min(Math.max(Math.trunc(Number(limit)) || 50, 1), 100);

  // LIMIT placeholders are rejected by this MySQL server inside prepared statements,
  // so the clamped integer is inlined after validation.
  return sql.query(
    `SELECT a.id,
            ANY_VALUE(a.ad_id) AS ad_id,
            ANY_VALUE(u.destination_url) AS destination_url,
            GROUP_CONCAT(DISTINCT c.country ORDER BY c.country SEPARATOR ',') AS country
       FROM mob_ads a
       LEFT JOIN mob_ad_urls u ON u.ad_id = a.id
       LEFT JOIN mob_ad_countries c ON c.ad_id = a.id
      WHERE a.redirect_status = ?
        AND u.destination_url IS NOT NULL
      GROUP BY a.id
      ORDER BY a.id DESC
      LIMIT ${safeLimit}`,
    [safeStatus]
  );
}

async function ensureOwner(tx, data, incrementAds) {
  if (!data.post_owner) return null;
  await tx.query(
    `INSERT INTO mob_post_owners (name, image_url, ads_count)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       image_url = COALESCE(NULLIF(VALUES(image_url), ''), image_url),
       ads_count = ads_count + VALUES(ads_count)`,
    [data.post_owner, data.post_owner_image, incrementAds ? 1 : 0]
  );
  const rows = await tx.query('SELECT id, name, image_url FROM mob_post_owners WHERE name_key = LOWER(TRIM(?)) LIMIT 1', [data.post_owner]);
  return rows[0] || null;
}

async function insertAd(tx, data, ownerId) {
  const result = await tx.query(
    `INSERT INTO mob_ads
      (ad_id, post_owner_id, type, platform, network, source, ad_title, ad_text,
       newsfeed_description, ad_image_size, ad_number_position, ad_position,
       ad_sub_position, city, ip_address, first_seen, last_seen, post_date,
       system_id, version)
     VALUES (?, ?, ?, 19, 'mob-network', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?, ?, ?, ?)`,
    [data.ad_id, ownerId, data.type, data.source, data.ad_title, data.ad_text,
      data.newsfeed_description, data.ad_image_size, data.ad_number_position,
      data.ad_position, data.ad_sub_position, data.city, data.ip_address,
      data.last_seen, data.post_date, data.system_id, data.version]
  );
  return result.insertId;
}

async function updateAd(tx, id, data, ownerId) {
  await tx.query(
    `UPDATE mob_ads SET
       post_owner_id = COALESCE(?, post_owner_id), type = ?, source = ?,
       ad_title = COALESCE(?, ad_title), ad_text = COALESCE(?, ad_text),
       newsfeed_description = COALESCE(?, newsfeed_description),
       ad_image_size = COALESCE(?, ad_image_size),
       ad_number_position = COALESCE(?, ad_number_position),
       ad_position = COALESCE(?, ad_position),
       ad_sub_position = COALESCE(?, ad_sub_position), city = COALESCE(?, city),
       ip_address = COALESCE(?, ip_address),
       first_seen = COALESCE(first_seen, created_at, NOW(3)),
       last_seen = GREATEST(last_seen, ?),
       post_date = COALESCE(post_date, ?), system_id = ?,
       version = COALESCE(?, version)
     WHERE id = ?`,
    [ownerId, data.type, data.source, data.ad_title, data.ad_text,
      data.newsfeed_description, data.ad_image_size, data.ad_number_position,
      data.ad_position, data.ad_sub_position, data.city, data.ip_address,
      data.last_seen, data.post_date, data.system_id, data.version, id]
  );
}

async function upsertUrls(tx, id, data) {
  await tx.query(
    `INSERT INTO mob_ad_urls
      (ad_id, ad_url, destination_url, redirect_url, placement_url, target_site, destination_host)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       ad_url = COALESCE(VALUES(ad_url), ad_url),
       destination_url = COALESCE(VALUES(destination_url), destination_url),
       redirect_url = COALESCE(VALUES(redirect_url), redirect_url),
       placement_url = COALESCE(VALUES(placement_url), placement_url),
       target_site = COALESCE(VALUES(target_site), target_site),
       destination_host = COALESCE(VALUES(destination_host), destination_host)`,
    [id, data.ad_url, data.destination_url, data.redirect_url, data.placement_url,
      data.target_site, data.destination_host]
  );
}

async function upsertOriginalImage(tx, id, originalUrl) {
  if (!originalUrl) return;
  await tx.query(
    `INSERT INTO mob_ad_media (ad_id, media_kind, ordinal, original_url)
     VALUES (?, 'IMAGE', 0, ?)
     ON DUPLICATE KEY UPDATE original_url = VALUES(original_url)`,
    [id, originalUrl]
  );
}

async function updateRedirectStatus(tx, adId, redirectStatus) {
  await tx.query('UPDATE mob_ads SET redirect_status = ? WHERE id = ?', [redirectStatus, adId]);
}

async function upsertLanderContent(tx, id, data) {
  // Store only the finalized AdMob lander contract plus PAS-maintained
  // rotator signals. Duplicate helper fields stay out of the schema, and the
  // lander pipeline never writes source_app because insertion already owns the
  // top-level source_app dimensions for AdMob ads.
  await tx.query(
    `INSERT INTO mob_ad_lander_content
      (ad_id, platform, lander_status, destinations, html_path, screen_shot, html_content,
       domain_registered_date, domain_age, country_iso_json, outgoing_url_json, redirects_json,
       whatsapp_json, campaign_id, whatsapp_rotator_detected, whatsapp_rotator_count,
       lead_campaign_tag, created, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       platform = VALUES(platform),
       lander_status = VALUES(lander_status),
       destinations = VALUES(destinations),
       html_path = VALUES(html_path),
       screen_shot = VALUES(screen_shot),
       html_content = VALUES(html_content),
       domain_registered_date = VALUES(domain_registered_date),
       domain_age = VALUES(domain_age),
       country_iso_json = VALUES(country_iso_json),
       outgoing_url_json = VALUES(outgoing_url_json),
       redirects_json = VALUES(redirects_json),
       whatsapp_json = VALUES(whatsapp_json),
       campaign_id = VALUES(campaign_id),
       whatsapp_rotator_detected = VALUES(whatsapp_rotator_detected),
       whatsapp_rotator_count = VALUES(whatsapp_rotator_count),
       lead_campaign_tag = VALUES(lead_campaign_tag),
       created = COALESCE(mob_ad_lander_content.created, VALUES(created)),
       updated = VALUES(updated)`,
    [
      id,
      data.platform,
      data.lander_status,
      data.destinations,
      data.html_path,
      data.screen_shot,
      data.html_content,
      data.domain_registered_date,
      data.domain_age,
      data.country_iso_json,
      data.outgoing_url_json,
      data.redirects_json,
      data.whatsapp_json,
      data.campaign_id,
      data.whatsapp_rotator_detected,
      data.whatsapp_rotator_count,
      data.lead_campaign_tag,
      data.created,
      data.updated,
    ]
  );
}

async function setNasImage(sql, id, originalUrl, nasPath) {
  await sql.query(
    `INSERT INTO mob_ad_media (ad_id, media_kind, ordinal, original_url, nas_path)
     VALUES (?, 'IMAGE', 0, ?, ?)
     ON DUPLICATE KEY UPDATE original_url = VALUES(original_url), nas_path = VALUES(nas_path)`,
    [id, originalUrl, nasPath]
  );
}

async function insertObservation(tx, id, data, payloadHash, sourceAppId) {
  // ON DUPLICATE KEY (ad_id, session_id, source_app_id) means the scraper
  // re-submitted this exact ad within the same session AND through the same
  // app — bump repeat_count instead of the old INSERT IGNORE behavior of
  // silently dropping the resubmission. If the SAME session reports this ad
  // through a DIFFERENT app, that's not a key collision — it becomes its own
  // row with its own repeat_count, so per-app counts never get merged into
  // whichever app happened to report first.
  //
  // The caller's `newObservation` flag must stay true ONLY for a genuinely
  // new (ad_id, session_id, source_app_id) row — it gates whether
  // country/state/sub_network/source_app appearance_count get incremented,
  // and a same-session-same-app resubmit must NOT double-count those. MySQL
  // reports affectedRows=1 for a fresh INSERT and =2 for a row that hit the
  // UPDATE branch (values changed), so checking === 1 preserves the original
  // "was this new" semantics exactly.
  //
  // source_app_id records which app this specific row's observation came
  // through. COALESCE on the UPDATE branch is a no-op in practice now (a
  // collision only happens when source_app_id already matches), kept only
  // as a defensive no-overwrite guard.
  const result = await tx.query(
    `INSERT INTO mob_ad_observations (ad_id, session_id, system_id, payload_hash, observed_at, repeat_count, source_app_id)
     VALUES (?, ?, ?, UNHEX(?), ?, 1, ?)
     ON DUPLICATE KEY UPDATE
       repeat_count = repeat_count + 1,
       observed_at = VALUES(observed_at),
       source_app_id = COALESCE(source_app_id, VALUES(source_app_id))`,
    [id, data.session_id, data.system_id, payloadHash, data.last_seen, sourceAppId]
  );
  return result.affectedRows === 1;
}

async function upsertDimension(tx, table, column, id, value, seenAt, increment) {
  if (!value) return;
  const allowed = {
    mob_ad_countries: 'country',
    mob_ad_states: 'state',
    mob_ad_sub_networks: 'sub_network',
  };
  if (allowed[table] !== column) throw new Error('Invalid AdMob dimension table.');
  await tx.query(
    `INSERT INTO ${table} (ad_id, ${column}, appearance_count, first_seen, last_seen)
     VALUES (?, ?, 1, ?, ?)
     ON DUPLICATE KEY UPDATE
       last_seen = GREATEST(last_seen, VALUES(last_seen)),
       first_seen = LEAST(first_seen, VALUES(first_seen)),
       appearance_count = appearance_count + ?`,
    [id, value, seenAt, seenAt, increment ? 1 : 0]
  );
}

// Ensures the app's row in mob_source_apps exists and returns its id, without
// touching appearance_count yet — called before insertObservation so the
// resolved id can be stamped onto the observation row itself. The counter
// bump (which needs `newObservation`, only known after insertObservation
// runs) happens afterwards in bumpSourceAppCounters below.
async function resolveSourceAppId(tx, data) {
  const result = await tx.query(
    `INSERT INTO mob_source_apps
      (source_app, source_app_pkg, appearance_count, first_seen, last_seen)
     VALUES (?, ?, 1, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [data.source_app, data.source_app_pkg, data.last_seen, data.last_seen]
  );
  const rows = await tx.query(
    'SELECT id FROM mob_source_apps WHERE source_app_key = LOWER(TRIM(?)) AND source_app_pkg = ? LIMIT 1',
    [data.source_app, data.source_app_pkg]
  );
  // affectedRows === 1 means this app row was just created by the INSERT
  // above (appearance_count already seeded to 1 via VALUES); anything else
  // means an existing row was matched and its appearance_count still needs
  // the increment below.
  return { sourceAppId: rows[0].id, isNewApp: result.affectedRows === 1 };
}

async function bumpSourceAppCounters(tx, id, sourceAppId, isNewApp, data, increment) {
  if (!isNewApp) {
    await tx.query(
      `UPDATE mob_source_apps SET
         last_seen = GREATEST(last_seen, ?),
         first_seen = LEAST(first_seen, ?),
         appearance_count = appearance_count + ?
       WHERE id = ?`,
      [data.last_seen, data.last_seen, increment ? 1 : 0, sourceAppId]
    );
  }
  await tx.query(
    `INSERT INTO mob_ad_source_apps
      (ad_id, source_app_id, appearance_count, first_seen, last_seen)
     VALUES (?, ?, 1, ?, ?)
     ON DUPLICATE KEY UPDATE
       last_seen = GREATEST(last_seen, VALUES(last_seen)),
       first_seen = LEAST(first_seen, VALUES(first_seen)),
       appearance_count = appearance_count + ?`,
    [id, sourceAppId, data.last_seen, data.last_seen, increment ? 1 : 0]
  );
}

async function queueEs(tx, id) {
  await tx.query(
    `INSERT INTO mob_es_outbox (ad_id, attempts, next_retry_at)
     VALUES (?, 0, NOW(3))
     ON DUPLICATE KEY UPDATE attempts = 0, next_retry_at = NOW(3), last_error = NULL`,
    [id]
  );
}

async function getPendingEs(sql, limit, maxAttempts) {
  const safeLimit = Math.min(Math.max(Math.trunc(Number(limit)) || 25, 1), 100);
  const safeMaxAttempts = Math.min(Math.max(Math.trunc(Number(maxAttempts)) || 10, 1), 50);

  // This server rejects LIMIT placeholders in prepared statements. These
  // values are bounded integers, so inlining them remains safe.
  return sql.query(
    `SELECT o.ad_id, a.ad_id AS public_ad_id, o.attempts
     FROM mob_es_outbox o
     INNER JOIN mob_ads a ON a.id = o.ad_id
     WHERE o.next_retry_at IS NOT NULL
       AND o.next_retry_at <= NOW(3)
       AND o.attempts < ${safeMaxAttempts}
     ORDER BY o.next_retry_at ASC, o.ad_id ASC
     LIMIT ${safeLimit}`,
    []
  );
}

async function completeEs(sql, id) {
  await sql.query('DELETE FROM mob_es_outbox WHERE ad_id = ?', [id]);
}

async function failEs(sql, id, error) {
  await sql.query(
    `UPDATE mob_es_outbox SET attempts = attempts + 1, last_error = ?,
       next_retry_at = DATE_ADD(NOW(3), INTERVAL LEAST(POWER(2, attempts), 60) MINUTE)
     WHERE ad_id = ?`,
    [String(error).slice(0, 4000), id]
  );
}

async function getCompleteAdWithClause(sql, whereClause, whereValue) {
  const ads = await sql.query(
    `SELECT a.*, o.name AS post_owner, o.image_url AS post_owner_image,
       u.ad_url, u.destination_url, u.redirect_url, u.placement_url,
       u.target_site, u.destination_host, m.original_url AS image_url_original,
       m.nas_path AS image_url,
       lc.platform AS lander_platform, lc.lander_status,
       lc.destinations AS lander_destination_url,
       lc.html_path AS lander_html_path,
       lc.screen_shot AS lander_screen_shot,
       lc.domain_registered_date AS lander_domain_registered_date,
       lc.domain_age AS lander_domain_age,
       lc.country_iso_json, lc.outgoing_url_json, lc.redirects_json,
       lc.whatsapp_json, lc.campaign_id,
       lc.whatsapp_rotator_detected, lc.whatsapp_rotator_count, lc.lead_campaign_tag,
       lc.created AS lander_created, lc.updated AS lander_updated
     FROM mob_ads a
     LEFT JOIN mob_post_owners o ON o.id = a.post_owner_id
     LEFT JOIN mob_ad_urls u ON u.ad_id = a.id
     LEFT JOIN mob_ad_media m ON m.ad_id = a.id AND m.media_kind = 'IMAGE' AND m.ordinal = 0
     LEFT JOIN mob_ad_lander_content lc ON lc.ad_id = a.id
     WHERE ${whereClause} LIMIT 1`,
    [whereValue]
  );
  if (!ads[0]) return null;
  const ad = ads[0];
  const [countries, states, subNetworks, sourceApps] = await Promise.all([
    sql.query('SELECT country AS name, appearance_count, first_seen, last_seen FROM mob_ad_countries WHERE ad_id = ? ORDER BY country_key', [ad.id]),
    sql.query('SELECT state AS name, appearance_count, first_seen, last_seen FROM mob_ad_states WHERE ad_id = ? ORDER BY state_key', [ad.id]),
    sql.query('SELECT sub_network AS name, appearance_count, first_seen, last_seen FROM mob_ad_sub_networks WHERE ad_id = ? ORDER BY sub_network_key', [ad.id]),
    sql.query(`SELECT s.source_app AS name, s.source_app_pkg AS package,
       x.appearance_count, x.first_seen, x.last_seen
       FROM mob_ad_source_apps x JOIN mob_source_apps s ON s.id = x.source_app_id
       WHERE x.ad_id = ? ORDER BY s.source_app_key, s.source_app_pkg`, [ad.id]),
  ]);
  // Total times this ad has been seen across all sessions, repeats included
  // (e.g. session A saw it 1x, session B saw it 3x -> occurrence_count = 4) —
  // not a count of distinct sessions (that's `sessions_seen`/session rows).
  const observationRows = await sql.query(
    'SELECT SUM(repeat_count) AS occurrence_count FROM mob_ad_observations WHERE ad_id = ?',
    [ad.id]
  );
  return {
    ...ad,
    occurrence_count: Number(observationRows[0]?.occurrence_count || 0),
    countries,
    states,
    sub_networks: subNetworks,
    source_apps: sourceApps,
  };
}

async function getCompleteAd(sql, publicAdId) {
  return getCompleteAdWithClause(sql, 'a.ad_id = ?', publicAdId);
}

async function getCompleteAdByInternalId(sql, internalId) {
  return getCompleteAdWithClause(sql, 'a.id = ?', internalId);
}

// Delete one ad and every dependent row. Ten child tables (mob_ad_urls,
// mob_ad_media, mob_ad_lander_content, mob_ad_lander_claims, mob_ad_countries,
// mob_ad_states, mob_ad_sub_networks, mob_ad_source_apps, mob_ad_observations,
// mob_es_outbox) are ON DELETE CASCADE, so MySQL removes them automatically
// once the mob_ads row goes. mob_hidden_ads is the one exception — its FK is
// ON DELETE RESTRICT (per-user saved/hidden state must be an explicit,
// deliberate delete, not a side effect), so it has to be cleared first or the
// mob_ads DELETE fails with a FK error. mob_source_apps / mob_post_owners are
// shared catalog tables other ads may still reference — never touched here.
async function deleteAdCascade(tx, internalId) {
  await tx.query('DELETE FROM mob_hidden_ads WHERE ad_id = (SELECT ad_id FROM mob_ads WHERE id = ?)', [internalId]);
  const result = await tx.query('DELETE FROM mob_ads WHERE id = ?', [internalId]);
  return result.affectedRows || 0;
}

module.exports = {
  withTransaction, getAdForUpdate, getAdsForLander, ensureOwner, insertAd, updateAd, upsertUrls,
  upsertOriginalImage, updateRedirectStatus, upsertLanderContent, setNasImage, insertObservation,
  upsertDimension, resolveSourceAppId, bumpSourceAppCounters, queueEs, getPendingEs, completeEs,
  failEs, getCompleteAd,
  getCompleteAdByInternalId, deleteAdCascade,
};
