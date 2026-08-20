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
  // Store the DS lander scrape plus the WA/VPN enrichment in one row so the
  // lander flow can round-trip the evidence without touching legacy tables.
  await tx.query(
    `INSERT INTO mob_ad_lander_content
      (ad_id, lander_status, crawled_by, destinations, html_path, screen_shot, html_content,
       domain_registered_date, domain_age, country_iso_json, outgoing_url_json, redirects_json,
       ad_category, source_website, source_parameters_json, whatsapp_url, whatsapp_domain,
       whatsapp_path, whatsapp_phone, whatsapp_message, whatsapp_parameters_json, campaign_id,
       location_without_vpn_json, location_with_vpn_json, comparison_json, whatsapp_links_json,
       whatsapp_texts_json, phone_numbers_json, contact_buttons_json, contact_button_count,
       whatsapp_rotator_detected, whatsapp_rotator_phone_count, lead_campaign_tag, raw_payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       lander_status = VALUES(lander_status),
       crawled_by = VALUES(crawled_by),
       destinations = VALUES(destinations),
       html_path = VALUES(html_path),
       screen_shot = VALUES(screen_shot),
       html_content = VALUES(html_content),
       domain_registered_date = VALUES(domain_registered_date),
       domain_age = VALUES(domain_age),
       country_iso_json = VALUES(country_iso_json),
       outgoing_url_json = VALUES(outgoing_url_json),
       redirects_json = VALUES(redirects_json),
       ad_category = VALUES(ad_category),
       source_website = VALUES(source_website),
       source_parameters_json = VALUES(source_parameters_json),
       whatsapp_url = VALUES(whatsapp_url),
       whatsapp_domain = VALUES(whatsapp_domain),
       whatsapp_path = VALUES(whatsapp_path),
       whatsapp_phone = VALUES(whatsapp_phone),
       whatsapp_message = VALUES(whatsapp_message),
       whatsapp_parameters_json = VALUES(whatsapp_parameters_json),
       campaign_id = VALUES(campaign_id),
       location_without_vpn_json = VALUES(location_without_vpn_json),
       location_with_vpn_json = VALUES(location_with_vpn_json),
       comparison_json = VALUES(comparison_json),
       whatsapp_links_json = VALUES(whatsapp_links_json),
       whatsapp_texts_json = VALUES(whatsapp_texts_json),
       phone_numbers_json = VALUES(phone_numbers_json),
       contact_buttons_json = VALUES(contact_buttons_json),
       contact_button_count = VALUES(contact_button_count),
       whatsapp_rotator_detected = VALUES(whatsapp_rotator_detected),
       whatsapp_rotator_phone_count = VALUES(whatsapp_rotator_phone_count),
       lead_campaign_tag = VALUES(lead_campaign_tag),
       raw_payload_json = VALUES(raw_payload_json)`,
    [
      id,
      data.lander_status,
      data.crawled_by,
      data.destinations,
      data.html_path,
      data.screen_shot,
      data.html_content,
      data.domain_registered_date,
      data.domain_age,
      data.country_iso_json,
      data.outgoing_url_json,
      data.redirects_json,
      data.ad_category,
      data.source_website,
      data.source_parameters_json,
      data.whatsapp_url,
      data.whatsapp_domain,
      data.whatsapp_path,
      data.whatsapp_phone,
      data.whatsapp_message,
      data.whatsapp_parameters_json,
      data.campaign_id,
      data.location_without_vpn_json,
      data.location_with_vpn_json,
      data.comparison_json,
      data.whatsapp_links_json,
      data.whatsapp_texts_json,
      data.phone_numbers_json,
      data.contact_buttons_json,
      data.contact_button_count,
      data.whatsapp_rotator_detected,
      data.whatsapp_rotator_phone_count,
      data.lead_campaign_tag,
      data.raw_payload_json,
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

async function insertObservation(tx, id, data, payloadHash) {
  // ON DUPLICATE KEY (ad_id, session_id) means the scraper re-submitted this
  // exact ad within the same session — bump repeat_count instead of the old
  // INSERT IGNORE behavior of silently dropping the resubmission.
  //
  // The caller's `newObservation` flag must stay true ONLY for a genuinely
  // new (ad_id, session_id) row — it gates whether country/state/sub_network/
  // source_app appearance_count get incremented, and a same-session resubmit
  // must NOT double-count those. MySQL reports affectedRows=1 for a fresh
  // INSERT and =2 for a row that hit the UPDATE branch (values changed), so
  // checking === 1 preserves the original "was this new" semantics exactly.
  const result = await tx.query(
    `INSERT INTO mob_ad_observations (ad_id, session_id, system_id, payload_hash, observed_at, repeat_count)
     VALUES (?, ?, ?, UNHEX(?), ?, 1)
     ON DUPLICATE KEY UPDATE
       repeat_count = repeat_count + 1,
       observed_at = VALUES(observed_at)`,
    [id, data.session_id, data.system_id, payloadHash, data.last_seen]
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

async function upsertSourceApp(tx, id, data, increment) {
  await tx.query(
    `INSERT INTO mob_source_apps
      (source_app, source_app_pkg, appearance_count, first_seen, last_seen)
     VALUES (?, ?, 1, ?, ?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       last_seen = GREATEST(last_seen, VALUES(last_seen)),
       first_seen = LEAST(first_seen, VALUES(first_seen)),
       appearance_count = appearance_count + ?`,
    [data.source_app, data.source_app_pkg, data.last_seen, data.last_seen, increment ? 1 : 0]
  );
  const rows = await tx.query(
    'SELECT id FROM mob_source_apps WHERE source_app_key = LOWER(TRIM(?)) AND source_app_pkg = ? LIMIT 1',
    [data.source_app, data.source_app_pkg]
  );
  const sourceAppId = rows[0].id;
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

async function getCompleteAd(sql, publicAdId) {
  const ads = await sql.query(
    `SELECT a.*, o.name AS post_owner, o.image_url AS post_owner_image,
       u.ad_url, u.destination_url, u.redirect_url, u.placement_url,
       u.target_site, u.destination_host, m.original_url AS image_url_original,
       m.nas_path AS image_url,
       lc.lander_status, lc.crawled_by AS lander_crawled_by,
       lc.destinations AS lander_destination_url,
       lc.html_path AS lander_html_path,
       lc.screen_shot AS lander_screen_shot,
       lc.domain_registered_date AS lander_domain_registered_date,
       lc.domain_age AS lander_domain_age,
       lc.country_iso_json, lc.outgoing_url_json, lc.redirects_json,
       lc.ad_category AS lander_ad_category,
       lc.source_website, lc.source_parameters_json, lc.whatsapp_url,
       lc.whatsapp_domain, lc.whatsapp_path, lc.whatsapp_phone,
       lc.whatsapp_message, lc.whatsapp_parameters_json, lc.campaign_id,
       lc.location_without_vpn_json, lc.location_with_vpn_json, lc.comparison_json,
       lc.whatsapp_links_json, lc.whatsapp_texts_json, lc.phone_numbers_json,
       lc.contact_buttons_json, lc.contact_button_count, lc.whatsapp_rotator_detected,
       lc.whatsapp_rotator_phone_count, lc.lead_campaign_tag, lc.raw_payload_json
     FROM mob_ads a
     LEFT JOIN mob_post_owners o ON o.id = a.post_owner_id
     LEFT JOIN mob_ad_urls u ON u.ad_id = a.id
     LEFT JOIN mob_ad_media m ON m.ad_id = a.id AND m.media_kind = 'IMAGE' AND m.ordinal = 0
     LEFT JOIN mob_ad_lander_content lc ON lc.ad_id = a.id
     WHERE a.ad_id = ? LIMIT 1`,
    [publicAdId]
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
  const observationRows = await sql.query(
    'SELECT COUNT(*) AS occurrence_count FROM mob_ad_observations WHERE ad_id = ?',
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

module.exports = {
  withTransaction, getAdForUpdate, getAdsForLander, ensureOwner, insertAd, updateAd, upsertUrls,
  upsertOriginalImage, updateRedirectStatus, upsertLanderContent, setNasImage, insertObservation,
  upsertDimension, upsertSourceApp, queueEs, getPendingEs, completeEs, failEs, getCompleteAd,
};
