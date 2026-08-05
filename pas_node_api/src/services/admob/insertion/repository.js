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
     VALUES (?, ?, ?, 19, 'mob-network', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.ad_id, ownerId, data.type, data.source, data.ad_title, data.ad_text,
      data.newsfeed_description, data.ad_image_size, data.ad_number_position,
      data.ad_position, data.ad_sub_position, data.city, data.ip_address,
      data.first_seen, data.last_seen, data.post_date, data.system_id, data.version]
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
       first_seen = CASE
         WHEN first_seen IS NULL THEN ?
         WHEN ? IS NULL THEN first_seen
         ELSE LEAST(first_seen, ?)
       END,
       last_seen = GREATEST(last_seen, ?),
       post_date = COALESCE(post_date, ?), system_id = ?,
       version = COALESCE(?, version)
     WHERE id = ?`,
    [ownerId, data.type, data.source, data.ad_title, data.ad_text,
      data.newsfeed_description, data.ad_image_size, data.ad_number_position,
      data.ad_position, data.ad_sub_position, data.city, data.ip_address,
      data.first_seen, data.first_seen, data.first_seen, data.last_seen,
      data.post_date, data.system_id, data.version, id]
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

async function setNasImage(sql, id, originalUrl, nasPath) {
  await sql.query(
    `INSERT INTO mob_ad_media (ad_id, media_kind, ordinal, original_url, nas_path)
     VALUES (?, 'IMAGE', 0, ?, ?)
     ON DUPLICATE KEY UPDATE original_url = VALUES(original_url), nas_path = VALUES(nas_path)`,
    [id, originalUrl, nasPath]
  );
}

async function insertObservation(tx, id, data, payloadHash) {
  const result = await tx.query(
    `INSERT IGNORE INTO mob_ad_observations (ad_id, system_id, payload_hash, observed_at)
     VALUES (?, ?, UNHEX(?), ?)`,
    [id, data.system_id, payloadHash, data.last_seen]
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
  return sql.query(
    `SELECT o.ad_id, a.ad_id AS public_ad_id, o.attempts
     FROM mob_es_outbox o
     INNER JOIN mob_ads a ON a.id = o.ad_id
     WHERE o.next_retry_at IS NOT NULL
       AND o.next_retry_at <= NOW(3)
       AND o.attempts < ?
     ORDER BY o.next_retry_at ASC, o.ad_id ASC
     LIMIT ?`,
    [maxAttempts, limit]
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
       m.nas_path AS image_url
     FROM mob_ads a
     LEFT JOIN mob_post_owners o ON o.id = a.post_owner_id
     LEFT JOIN mob_ad_urls u ON u.ad_id = a.id
     LEFT JOIN mob_ad_media m ON m.ad_id = a.id AND m.media_kind = 'IMAGE' AND m.ordinal = 0
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
  return { ...ad, countries, states, sub_networks: subNetworks, source_apps: sourceApps };
}

module.exports = {
  withTransaction, getAdForUpdate, ensureOwner, insertAd, updateAd, upsertUrls,
  upsertOriginalImage, setNasImage, insertObservation, upsertDimension,
  upsertSourceApp, queueEs, getPendingEs, completeEs, failEs, getCompleteAd,
};
