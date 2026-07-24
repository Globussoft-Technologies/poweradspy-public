'use strict';

async function withTransaction(sql, fn) {
  const conn = await sql.getConnection();
  const tx = { query: async (query, params) => { const [result] = await conn.execute(query, params); return result; } };
  try {
    await conn.query("SET SESSION sql_mode=(SELECT REPLACE(REPLACE(REPLACE(@@SESSION.sql_mode,'ONLY_FULL_GROUP_BY',''),'STRICT_TRANS_TABLES',''),'STRICT_ALL_TABLES',''))").catch(() => {});
    await conn.beginTransaction();
    const result = await fn(tx);
    await conn.commit();
    return result;
  } catch (error) {
    try { await conn.rollback(); } catch { /* ignore rollback failure */ }
    throw error;
  } finally {
    await conn.query('SET SESSION sql_mode=DEFAULT').catch(() => {});
    conn.release();
  }
}

const first = (rows) => Array.isArray(rows) && rows.length ? rows[0] : null;

async function getAd(exec, adId) {
  return first(await exec.query(
    `SELECT a.id, a.language_id, a.post_owner_id, a.post_date, a.first_seen, a.last_seen, a.days_running,
            v.image_url AS nas_image_url
       FROM google_text_ad a
       LEFT JOIN google_text_ad_variants v ON v.google_text_ad_id = a.id
      WHERE a.ad_id = ? LIMIT 1`,
    [adId]
  ));
}

async function ensurePostOwner(exec, name, increment) {
  if (!name) return null;
  const lower = name.toLowerCase();
  const current = first(await exec.query(
    'SELECT id, ads_count FROM google_text_ad_post_owners WHERE post_owner_lower = ? LIMIT 1',
    [lower]
  ));
  if (current) {
    if (increment) await exec.query('UPDATE google_text_ad_post_owners SET ads_count = ads_count + 1 WHERE id = ?', [current.id]);
    return current.id;
  }
  try {
    const result = await exec.query(
      'INSERT INTO google_text_ad_post_owners (post_owner_name, post_owner_image, ads_count) VALUES (?, ?, 1)',
      [name, '/DefaultImage.jpg']
    );
    return result.insertId;
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    return (first(await exec.query(
      'SELECT id FROM google_text_ad_post_owners WHERE post_owner_lower = ? LIMIT 1',
      [lower]
    )) || {}).id;
  }
}

async function getPostOwnerImage(exec, postOwnerId) {
  if (!postOwnerId) return null;
  return first(await exec.query(
    'SELECT post_owner_image FROM google_text_ad_post_owners WHERE id = ? LIMIT 1',
    [postOwnerId]
  ))?.post_owner_image || null;
}

async function ensureLanguage(exec, detectedLanguage, languageName) {
  if (!detectedLanguage) return 0;
  const iso = String(detectedLanguage).slice(0, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso)) return 0;
  let row = first(await exec.query('SELECT id FROM languages WHERE iso = ? LIMIT 1', [iso]));
  if (row) return row.id;
  try {
    const inserted = await exec.query(
      'INSERT INTO languages (iso, name) VALUES (?, ?)',
      [iso, languageName || iso]
    );
    return inserted.insertId;
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    row = first(await exec.query('SELECT id FROM languages WHERE iso = ? LIMIT 1', [iso]));
    return row?.id || 0;
  }
}

async function ensureCountry(exec, name) {
  let countryOnly = first(await exec.query('SELECT id FROM google_text_country_only WHERE country = ? LIMIT 1', [name]));
  if (!countryOnly) {
    try {
      const inserted = await exec.query('INSERT INTO google_text_country_only (country) VALUES (?)', [name]);
      countryOnly = { id: inserted.insertId };
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY') throw error;
      countryOnly = first(await exec.query('SELECT id FROM google_text_country_only WHERE country = ? LIMIT 1', [name]));
    }
  }
  let country = first(await exec.query(
    "SELECT id FROM google_text_country WHERE city = '' AND state = '' AND country = ? LIMIT 1",
    [name]
  ));
  if (!country) {
    try {
      const inserted = await exec.query(
        "INSERT INTO google_text_country (city, state, country, country_only_id, status) VALUES ('', '', ?, ?, 1)",
        [name, countryOnly.id]
      );
      country = { id: inserted.insertId };
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY') throw error;
      country = first(await exec.query(
        "SELECT id FROM google_text_country WHERE city = '' AND state = '' AND country = ? LIMIT 1",
        [name]
      ));
    }
  }
  return { countryId: country.id, countryOnlyId: countryOnly.id };
}

async function ensureDomain(exec, domain) {
  if (!domain) return null;
  let row = first(await exec.query('SELECT id FROM google_text_ad_domains WHERE domain = ? LIMIT 1', [domain]));
  if (row) return row.id;
  try {
    const inserted = await exec.query('INSERT INTO google_text_ad_domains (domain) VALUES (?)', [domain]);
    return inserted.insertId;
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    row = first(await exec.query('SELECT id FROM google_text_ad_domains WHERE domain = ? LIMIT 1', [domain]));
    return row.id;
  }
}

async function insertAd(exec, data) {
  const result = await exec.query(
    `INSERT INTO google_text_ad
      (ad_id, language_id, post_owner_updated, variants_count, type, ad_position,
       ad_sub_position, post_date, first_seen, last_seen, days_running, status, source,
       system_id, affiliate_ad, redirect_destination_url_source, reward_status, domain_id,
       country_id, country_only_id, post_owner_id, default_variant_id, ad_ranking)
     VALUES (?,?,0,0,?,?,NULL,?,?,?,?,1,?,?,0,0,0,?,?,?,?,0,'')`,
    [
      data.ad_id, data.languageId || 0, data.type, data.adPosition || 'FEED', data.postDateSql,
      data.firstSeenSql, data.lastSeenSql, data.daysRunning, data.source,
      data.system_id, data.domainId, data.countryId, data.countryOnlyId, data.postOwnerId,
    ]
  );
  return result.insertId;
}

async function updateAd(exec, id, data) {
  await exec.query(
    `UPDATE google_text_ad SET type = ?, ad_position = ?,
       post_date = CASE
         WHEN post_date IS NULL OR post_date <= '1000-01-01 00:00:00'
           THEN COALESCE(?, post_date)
         ELSE post_date
       END,
       first_seen = CASE
         WHEN first_seen IS NULL OR first_seen <= '0001-01-01 01:01:01' THEN ?
         WHEN ? = 1 THEN LEAST(first_seen, ?)
         ELSE first_seen
       END,
       last_seen = CASE
         WHEN last_seen IS NULL THEN ?
         ELSE GREATEST(last_seen, ?)
       END,
       days_running = ?, source = ?, system_id = ?, domain_id = ?,
       language_id = CASE WHEN ? = 1 THEN ? ELSE language_id END,
       country_id = CASE WHEN country_id IS NULL OR country_id = 0 THEN ? ELSE country_id END,
       country_only_id = CASE WHEN country_only_id IS NULL OR country_only_id = 0 THEN ? ELSE country_only_id END,
       post_owner_id = COALESCE(?, post_owner_id) WHERE id = ?`,
    [
      data.type, data.adPosition || 'FEED', data.postDateSql,
      data.firstSeenSql, data.hasPayloadFirstSeen ? 1 : 0, data.firstSeenSql,
      data.lastSeenSql, data.lastSeenSql,
      data.daysRunning, data.source, data.system_id, data.domainId,
      data.languageShouldUpdate ? 1 : 0, data.languageId || 0, data.countryId,
      data.countryOnlyId, data.postOwnerId, id,
    ]
  );
}

async function upsertVariant(exec, adId, data) {
  const current = first(await exec.query('SELECT id FROM google_text_ad_variants WHERE google_text_ad_id = ? LIMIT 1', [adId]));
  if (current) {
    await exec.query(
      `UPDATE google_text_ad_variants SET title = ?, text = ?, newsfeed_description = '',
       image_url_original = ?, target_keyword = '', target_page = NULL WHERE google_text_ad_id = ?`,
      [data.ad_title || '', data.ad_text || '', data.image_url_original, adId]
    );
    return current.id;
  }
  const inserted = await exec.query(
    `INSERT INTO google_text_ad_variants
      (google_text_ad_id, title, text, newsfeed_description, image_url_original, image_url, target_keyword, target_page)
     VALUES (?, ?, ?, '', ?, NULL, '', NULL)`,
    [adId, data.ad_title || '', data.ad_text || '', data.image_url_original]
  );
  await exec.query('UPDATE google_text_ad SET default_variant_id = ? WHERE id = ?', [inserted.insertId, adId]);
  return inserted.insertId;
}

async function setVariantNasImage(exec, adId, path) {
  await exec.query('UPDATE google_text_ad_variants SET image_url = ? WHERE google_text_ad_id = ?', [path, adId]);
}

async function setPostOwnerImage(exec, postOwnerId, path) {
  await exec.query('UPDATE google_text_ad_post_owners SET post_owner_image = ? WHERE id = ?', [path, postOwnerId]);
}

async function upsertTranslation(exec, adId, translation) {
  if (!translation) return;
  const current = first(await exec.query(
    'SELECT google_ad_id FROM google_ad_translation WHERE google_ad_id = ? LIMIT 1',
    [adId]
  ));
  const values = [
    translation.text ?? '',
    translation.title ?? '',
    translation.newsfeed_description ?? '',
  ];
  if (current) {
    await exec.query(
      `UPDATE google_ad_translation
          SET ad_text = ?, ad_title = ?, news_feed_description = ?
        WHERE google_ad_id = ?`,
      [...values, adId]
    );
    return;
  }
  await exec.query(
    `INSERT INTO google_ad_translation
      (google_ad_id, ad_text, ad_title, news_feed_description)
     VALUES (?, ?, ?, ?)`,
    [adId, ...values]
  );
}

async function upsertMeta(exec, adId, data) {
  const current = first(await exec.query('SELECT id FROM google_text_ad_meta_data WHERE google_text_ad_id = ? LIMIT 1', [adId]));
  if (current) {
    await exec.query(
      `UPDATE google_text_ad_meta_data SET platform = 18, version = ?, destination_url = ?,
       lastSeenOnDesktop = ? WHERE google_text_ad_id = ?`,
      [data.version, data.destination_url, data.lastSeenSql, adId]
    );
    return;
  }
  await exec.query(
    `INSERT INTO google_text_ad_meta_data
      (google_text_ad_id, firstSeenOnDesktop, lastSeenOnDesktop, firstSeenOnIos,
       lastSeenOnIos, firstSeenOnAndroid, lastSeenOnAndroid, platform, version,
       destination_url, screenshot_url, destination_scraper_status,
       adv_screenshots, redirect_destination_url_source, admin_status,
       affiliate_network_id)
     VALUES (?, ?, ?, NULL, NULL, NULL, NULL, 18, ?, ?, '/processing.gif',
       0, 0, 0, 0, 0)`,
    [adId, data.firstSeenSql, data.lastSeenSql, data.version, data.destination_url]
  );
}

async function upsertAdCountry(exec, adId, ids) {
  const current = first(await exec.query(
    'SELECT id FROM google_text_ad_countries WHERE google_text_ad_id = ? AND country_only_id = ? LIMIT 1',
    [adId, ids.countryOnlyId]
  ));
  if (current) {
    await exec.query('UPDATE google_text_ad_countries SET count = count + 1 WHERE id = ?', [current.id]);
  } else {
    await exec.query(
      'INSERT INTO google_text_ad_countries (google_text_ad_id, country_id, country_only_id, count) VALUES (?, ?, ?, 1)',
      [adId, ids.countryId, ids.countryOnlyId]
    );
  }
  const only = first(await exec.query(
    'SELECT id FROM google_text_ad_countries_only WHERE google_text_ad_id = ? AND country_only_id = ? LIMIT 1',
    [adId, ids.countryOnlyId]
  ));
  if (only) {
    await exec.query('UPDATE google_text_ad_countries_only SET count = count + 1 WHERE id = ?', [only.id]);
  } else {
    await exec.query(
      'INSERT INTO google_text_ad_countries_only (google_text_ad_id, country_only_id, count) VALUES (?, ?, 1)',
      [adId, ids.countryOnlyId]
    );
  }
}

async function upsertTransparency(exec, adId, data) {
  const impression = data.impressions || {};
  await exec.query(
    `INSERT INTO google_transparency_ad_payload
      (google_text_ad_id, advertiser_id, ad_url, subnetwork, region_code,
       impressions_min, impressions_max, impressions_operator, video_url_original,
       redirect_url, othermultimedia)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE advertiser_id=VALUES(advertiser_id), ad_url=VALUES(ad_url),
       subnetwork=VALUES(subnetwork), region_code=VALUES(region_code),
       impressions_min=VALUES(impressions_min), impressions_max=VALUES(impressions_max),
       impressions_operator=VALUES(impressions_operator),
       video_url_original=VALUES(video_url_original), redirect_url=VALUES(redirect_url),
       othermultimedia=VALUES(othermultimedia), received_at=CURRENT_TIMESTAMP(3)`,
    [
      adId, data.advertiser_id, data.ad_url, data.subnetwork, data.region_code,
      impression.min ?? null, impression.max ?? null, impression.operator ?? null,
      data.video_url_original, data.redirect_url, JSON.stringify(data.othermultimedia),
    ]
  );
}

async function getCountryDelivery(exec, adId) {
  return exec.query(
    `SELECT co.country, d.country_code, d.ordinal, d.first_seen, d.last_seen,
            d.impressions_min, d.impressions_max, d.impressions_operator
       FROM google_transparency_country_delivery d
       JOIN google_text_country_only co ON co.id = d.country_only_id
      WHERE d.google_text_ad_id = ?
      ORDER BY d.ordinal`,
    [adId]
  );
}

async function mergeCountryDelivery(exec, adId, details, countries, fallbackLastSeenSql) {
  const current = await getCountryDelivery(exec, adId);
  const currentByName = new Map(current.map((row) => [row.country, row]));
  let nextOrdinal = current.reduce((max, row) => Math.max(max, Number(row.ordinal)), -1) + 1;
  const detailByName = new Map(details.map((detail) => [detail.country, detail]));
  for (const country of countries) {
    const ids = await ensureCountry(exec, country);
    const detail = detailByName.get(country);
    const shown = detail?.times_shown || {};
    const ordinal = currentByName.has(country)
      ? Number(currentByName.get(country).ordinal)
      : nextOrdinal++;
    const detailLastSeen = detail?.lastSeenSql ?? fallbackLastSeenSql;
    await upsertAdCountry(exec, adId, ids);
    await exec.query(
      `INSERT INTO google_transparency_country_delivery
        (google_text_ad_id, country_only_id, ordinal, country_code, first_seen,
         last_seen, impressions_min, impressions_max, impressions_operator)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         ordinal=VALUES(ordinal),
         country_code=COALESCE(VALUES(country_code), country_code),
         first_seen=CASE
           WHEN VALUES(first_seen) IS NULL THEN first_seen
           WHEN first_seen IS NULL THEN VALUES(first_seen)
           ELSE LEAST(first_seen, VALUES(first_seen))
         END,
         last_seen=CASE
           WHEN last_seen IS NULL THEN VALUES(last_seen)
           ELSE GREATEST(last_seen, VALUES(last_seen))
         END,
         impressions_min=VALUES(impressions_min),
         impressions_max=VALUES(impressions_max),
         impressions_operator=VALUES(impressions_operator)`,
      [
        adId, ids.countryOnlyId, ordinal, detail?.country_code ?? null,
        detail?.firstSeenSql ?? null, detailLastSeen,
        shown.min ?? null, shown.max ?? null, shown.operator ?? null,
      ]
    );
  }
  return getCountryDelivery(exec, adId);
}

module.exports = {
  withTransaction, getAd, ensurePostOwner, getPostOwnerImage, ensureLanguage, ensureCountry, ensureDomain,
  insertAd, updateAd, upsertVariant, setVariantNasImage, setPostOwnerImage, upsertTranslation, upsertMeta,
  upsertAdCountry, upsertTransparency, getCountryDelivery, mergeCountryDelivery,
};
