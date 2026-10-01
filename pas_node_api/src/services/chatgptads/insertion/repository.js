'use strict';

/**
 * ChatGPT Ads insertion — data repository (raw parameterized SQL).
 *
 * Mirrors facebook's repository.js shape (one function per DB operation, `exec` as the
 * first arg so the same writers work standalone or inside withTransaction) — see
 * src/services/facebook/insertion/repository.js. No PHP to port here (see MANIFEST §0);
 * every query below is written directly against chatgptads_schema.sql (applied + verified
 * live — see MANIFEST §2).
 *
 * No latin1Safe / truncateChars wrapping anywhere in this file — unlike facebook's legacy
 * latin1 columns, EVERY column in this schema is utf8mb4 (see chatgptads_schema.sql's own
 * header), so the whole class of collation-conversion bug those helpers work around does
 * not exist here.
 *
 * Return conventions (same as facebook's):
 *   - getX  → { code: 200, data: rows } | { code: 400, data: null }
 *   - insertX → inserted id (number)
 *   - updateX → affected row count (number)
 */

// ── Transaction helper (copy of facebook's — see that file's header for why) ──────────────
async function withTransaction(sql, fn) {
  const conn = await sql.getConnection();
  const tx = { query: async (q, p) => { const [r] = await conn.execute(q, p); return r; } };
  try {
    await conn.beginTransaction();
    const result = await fn(tx);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

const rows = (r) => (Array.isArray(r) ? r : []);
const firstId = (r) => (r && r.insertId ? r.insertId : 0);
const affected = (r) => (r && typeof r.affectedRows === 'number' ? r.affectedRows : 0);
const found = (r) => (rows(r).length ? { code: 200, data: rows(r) } : { code: 400, data: null });
const stripNulls = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));

// ── chatgptads_ad ──────────────────────────────────────────────────────────────
async function getAdByAdId(exec, adId) {
  return found(await exec.query('SELECT id FROM chatgptads_ad WHERE ad_id = ? LIMIT 1', [adId]));
}

async function insertChatgptAd(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  const sql = `INSERT INTO chatgptads_ad (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return firstId(await exec.query(sql, Object.values(clean)));
}

async function updateChatgptAd(exec, data, internalId) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE chatgptads_ad SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), internalId]
  ));
}

/** Cascade-delete an ad and all its child rows by internal chatgptads_ad.id. Run inside withTransaction. */
async function deleteAdCascade(exec, internalId) {
  const childDeletes = [
    ['chatgptads_translation', 'chatgptads_ad_id'],
    ['chatgptads_ad_analytics', 'chatgptads_ad_id'],
    ['chatgptads_ad_countries', 'chatgptads_ad_id'],
    ['chatgptads_ad_image_video', 'chatgptads_ad_id'],
    ['chatgptads_ad_variants', 'chatgptads_ad_id'],
  ];
  for (const [table, col] of childDeletes) {
    await deleteIgnoringMissingTable(exec, `DELETE FROM ${table} WHERE ${col} = ?`, [internalId]);
  }
  return affected(await exec.query('DELETE FROM chatgptads_ad WHERE id = ?', [internalId]));
}
async function deleteIgnoringMissingTable(exec, sql, params) {
  try { await exec.query(sql, params); } catch (err) {
    if (err && (err.errno === 1146 || err.code === 'ER_NO_SUCH_TABLE')) return;
    throw err;
  }
}

// Denormalized join for the ES doc, aliased directly to the FLAT ES field names this
// network uses (see chatgpt_search_mix.mapping.json / MANIFEST §4) — no dotted "table.field"
// rewriting needed in esDocBuilder.js because the query itself already produces the final
// shape. ANY_VALUE() keeps this compatible with only_full_group_by (same reason facebook's
// getJoinedAd uses it — functionally dependent on the GROUP BY key, chatgptads_ad.id).
async function getJoinedAd(exec, whereCol, whereVal) {
  const sql = `
    SELECT chatgptads_ad.id, chatgptads_ad.ad_id, chatgptads_ad.uid, chatgptads_ad.type,
           chatgptads_ad.platform, chatgptads_ad.network, chatgptads_ad.ad_position,
           chatgptads_ad.version, chatgptads_ad.post_date, chatgptads_ad.first_seen,
           chatgptads_ad.last_seen, chatgptads_ad.days_running, chatgptads_ad.hits,
           chatgptads_ad.status, chatgptads_ad.destination_url,
           ANY_VALUE(chatgptads_ad_domains.domain) AS domain,
           ANY_VALUE(chatgptads_country_only.country) AS country,
           -- Full multi-country list (chatgptads_ad_countries, appended-not-replaced across
           -- requests — see chatgptadsPipeline.js) for the ES country field, which must carry
           -- ALL countries this ad has been seen in, not just the primary one above. Separate
           -- join + alias ('all_countries') from the single-value one above — same table,
           -- different relationship (FK vs many-to-many), so it needs its own alias.
           GROUP_CONCAT(DISTINCT all_countries.country SEPARATOR '||') AS all_countries,
           ANY_VALUE(chatgptads_ad_post_owners.post_owner_name) AS post_owner_name,
           ANY_VALUE(chatgptads_ad_post_owners.post_owner_lower) AS post_owner_lower,
           ANY_VALUE(chatgptads_ad_post_owners.post_owner_image) AS post_owner_image,
           ANY_VALUE(chatgptads_ad_variants.title) AS ad_title,
           ANY_VALUE(chatgptads_ad_variants.text) AS ad_text,
           ANY_VALUE(chatgptads_ad_variants.newsfeed_description) AS newsfeed_description,
           ANY_VALUE(chatgptads_ad_variants.image_url) AS image_url,
           ANY_VALUE(chatgptads_ad_variants.image_url_original) AS image_url_original,
           ANY_VALUE(chatgptads_ad_image_video.ad_image_video) AS ad_image_video,
           -- detected_language + language_name from chatgptads_translation (durable,
           -- SQL-sourced) — NOT from the old ES doc's carry-over, which never actually
           -- captured either (found + fixed alongside this change; see esDocBuilder.js's
           -- CARRY_OVER_KEYS, which never included lang_detect in the first place). ES's
           -- lang_detect field uses ONLY language_name (the full word, e.g. 'English') —
           -- see indexAd()/reindexOne() — detected_language (the short code, e.g. 'en') is
           -- kept in SQL only.
           ANY_VALUE(chatgptads_translation.detected_language) AS detected_language,
           ANY_VALUE(chatgptads_translation.language_name) AS language_name
    FROM chatgptads_ad
    LEFT JOIN chatgptads_ad_domains     ON chatgptads_ad.domain_id = chatgptads_ad_domains.id
    LEFT JOIN chatgptads_country_only   ON chatgptads_ad.country_only_id = chatgptads_country_only.id
    LEFT JOIN chatgptads_ad_countries   ON chatgptads_ad.id = chatgptads_ad_countries.chatgptads_ad_id
    LEFT JOIN chatgptads_country_only AS all_countries ON chatgptads_ad_countries.country_only_id = all_countries.id
    LEFT JOIN chatgptads_ad_post_owners ON chatgptads_ad.post_owner_id = chatgptads_ad_post_owners.id
    LEFT JOIN chatgptads_ad_variants    ON chatgptads_ad.id = chatgptads_ad_variants.chatgptads_ad_id
    LEFT JOIN chatgptads_ad_image_video ON chatgptads_ad.id = chatgptads_ad_image_video.chatgptads_ad_id
    LEFT JOIN chatgptads_translation    ON chatgptads_ad.id = chatgptads_translation.chatgptads_ad_id
    WHERE ${whereCol} = ?
    GROUP BY chatgptads_ad.id`;
  return rows(await exec.query(sql, [whereVal]));
}

// ── chatgptads_ad_post_owners (dedup post_owner_lower, GENERATED — never insert it) ────────
async function getPostOwner(exec, postOwnerLower) {
  return found(await exec.query(
    'SELECT id, ads_count, post_owner_image FROM chatgptads_ad_post_owners WHERE post_owner_lower = ? LIMIT 1',
    [postOwnerLower]
  ));
}
async function insertPostOwner(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO chatgptads_ad_post_owners (post_owner_name, post_owner_image, ads_count, verified) VALUES (?,?,?,?)',
    [d.post_owner_name, d.post_owner_image ?? null, d.ads_count ?? 1, d.verified ?? 0]
  ));
}
async function updatePostOwner(exec, data, id) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE chatgptads_ad_post_owners SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), id]
  ));
}

// ── chatgptads_ad_domains (dedup domain) ────────────────────────────────────────
async function getDomain(exec, domain) {
  return found(await exec.query('SELECT id FROM chatgptads_ad_domains WHERE domain = ? LIMIT 1', [domain]));
}
async function insertDomain(exec, domain) {
  return firstId(await exec.query('INSERT INTO chatgptads_ad_domains (domain) VALUES (?)', [domain]));
}

// ── chatgptads_country_only (dedup country NAME — no ISO translation needed, see normalize.js) ─
async function upsertCountryOnly(exec, names) {
  const list = (Array.isArray(names) ? names : [names]).filter((n) => n !== undefined && n !== null && n !== '');
  if (!list.length) return [];
  for (const country of list) {
    const existing = rows(await exec.query('SELECT id FROM chatgptads_country_only WHERE country = ? LIMIT 1', [country]));
    if (!existing.length) await exec.query('INSERT INTO chatgptads_country_only (country) VALUES (?)', [country]);
  }
  const placeholders = list.map(() => '?').join(',');
  const foundRows = rows(await exec.query(`SELECT id FROM chatgptads_country_only WHERE country IN (${placeholders})`, list));
  return foundRows.map((row) => ({ country_only_id: row.id, count: 1 }));
}

// ── chatgptads_ad_variants ──────────────────────────────────────────────────────
async function insertVariant(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO chatgptads_ad_variants (chatgptads_ad_id, title, text, newsfeed_description, image_url_original) VALUES (?,?,?,?,?)',
    [d.chatgptads_ad_id, d.title ?? null, d.text ?? null, d.newsfeed_description ?? null, d.image_url_original ?? null]
  ));
}
async function updateVariantByAdId(exec, data, chatgptadsAdId) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE chatgptads_ad_variants SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE chatgptads_ad_id = ?`,
    [...Object.values(data), chatgptadsAdId]
  ));
}

// ── chatgptads_ad_analytics (impression + hits only — see schema header for why) ───────────
// Upsert-by-date: same ad seen again same day → bump hits/impression on that day's row,
// instead of facebook's 10%-tolerance-or-new-row logic (there is no likes/comments/shares
// series here to tolerance-check against, so that complexity doesn't apply).
async function upsertAnalyticsForDate(exec, chatgptadsAdId, date, impression) {
  const existing = rows(await exec.query(
    'SELECT id, hits FROM chatgptads_ad_analytics WHERE chatgptads_ad_id = ? AND date = ? LIMIT 1',
    [chatgptadsAdId, date]
  ));
  if (existing.length) {
    return affected(await exec.query(
      'UPDATE chatgptads_ad_analytics SET hits = hits + 1, impression = ? WHERE id = ?',
      [impression ?? 0, existing[0].id]
    ));
  }
  return firstId(await exec.query(
    'INSERT INTO chatgptads_ad_analytics (chatgptads_ad_id, impression, hits, date) VALUES (?,?,1,?)',
    [chatgptadsAdId, impression ?? 0, date]
  ));
}

// ── chatgptads_ad_countries (bulk, ad <-> country sighting count) ──────────────────────────
async function insertAdCountries(exec, list) {
  if (!list.length) return 0;
  const values = list.map((c) => [c.chatgptads_ad_id, c.country_only_id, c.count ?? 1]);
  const sql = `INSERT INTO chatgptads_ad_countries (chatgptads_ad_id, country_only_id, count) VALUES ${values.map(() => '(?,?,?)').join(', ')}
               ON DUPLICATE KEY UPDATE count = count + 1`;
  return affected(await exec.query(sql, values.flat()));
}

// ── chatgptads_ad_image_video (carousel — UNCONFIRMED shape, see MANIFEST §6) ──────────────
// The shared mediaUpload.uploadMultimedia() returns the legacy key `facebook_ad_id` (see
// MANIFEST.md's explicit note on this, copied from facebook/instagram's own documented
// gotcha) — accept `chatgptads_ad_id ?? facebook_ad_id` so the carousel row is never
// silently skipped in SQL while ES still gets it.
async function upsertAdImageVideo(exec, d) {
  const adId = d?.chatgptads_ad_id ?? d?.facebook_ad_id;
  if (!d || !adId) return 0;
  const existing = rows(await exec.query('SELECT chatgptads_ad_id FROM chatgptads_ad_image_video WHERE chatgptads_ad_id = ? LIMIT 1', [adId]));
  if (existing.length) {
    return affected(await exec.query(
      'UPDATE chatgptads_ad_image_video SET ad_type = ?, ad_image_video = ? WHERE chatgptads_ad_id = ?',
      [d.ad_type ?? null, d.ad_image_video ?? null, adId]
    ));
  }
  return affected(await exec.query(
    'INSERT INTO chatgptads_ad_image_video (chatgptads_ad_id, ad_type, ad_image_video) VALUES (?,?,?)',
    [adId, d.ad_type ?? null, d.ad_image_video ?? null]
  ));
}

// ── chatgptads_translation (upsert on chatgptads_ad_id) ─────────────────────────
async function upsertTranslation(exec, d) {
  const existing = rows(await exec.query('SELECT chatgptads_ad_id FROM chatgptads_translation WHERE chatgptads_ad_id = ? LIMIT 1', [d.chatgptads_ad_id]));
  if (existing.length) {
    await exec.query(
      'UPDATE chatgptads_translation SET ad_title = ?, ad_text = ?, newsfeed_description = ?, detected_language = ?, language_name = ? WHERE chatgptads_ad_id = ?',
      [d.ad_title ?? null, d.ad_text ?? null, d.newsfeed_description ?? null, d.detected_language ?? null, d.language_name ?? null, d.chatgptads_ad_id]
    );
  } else {
    await exec.query(
      'INSERT INTO chatgptads_translation (chatgptads_ad_id, ad_title, ad_text, newsfeed_description, detected_language, language_name) VALUES (?,?,?,?,?,?)',
      [d.chatgptads_ad_id, d.ad_title ?? null, d.ad_text ?? null, d.newsfeed_description ?? null, d.detected_language ?? null, d.language_name ?? null]
    );
  }
  return true;
}

// ── chatgptads_es_outbox (ES-write durability — see schema file header for why this
// covers BOTH index and delete failures, unlike admob's mob_es_outbox) ─────────────
async function queueEsOutbox(exec, chatgptadsAdId, action, error) {
  await exec.query(
    `INSERT INTO chatgptads_es_outbox (chatgptads_ad_id, action, attempts, next_retry_at, last_error)
     VALUES (?, ?, 0, NOW(3), ?)
     ON DUPLICATE KEY UPDATE attempts = 0, next_retry_at = NOW(3), last_error = VALUES(last_error)`,
    [chatgptadsAdId, action, error ? String(error).slice(0, 4000) : null]
  );
}
// Cancel any pending outbox work for an ad that is about to be (or was just) deleted —
// an 'index' job queued moments before a delete request must not fire after the row is gone.
async function clearEsOutbox(exec, chatgptadsAdId) {
  await exec.query('DELETE FROM chatgptads_es_outbox WHERE chatgptads_ad_id = ?', [chatgptadsAdId]);
}
async function getPendingEsOutbox(exec, limit, maxAttempts) {
  const safeLimit = Math.min(Math.max(Math.trunc(Number(limit)) || 25, 1), 100);
  const safeMaxAttempts = Math.min(Math.max(Math.trunc(Number(maxAttempts)) || 10, 1), 50);
  // bounded integers inlined (not bind params) — same reasoning as admob's getPendingEs
  return rows(await exec.query(
    `SELECT id, chatgptads_ad_id, action, attempts
     FROM chatgptads_es_outbox
     WHERE next_retry_at <= NOW(3) AND attempts < ${safeMaxAttempts}
     ORDER BY next_retry_at ASC, id ASC
     LIMIT ${safeLimit}`
  ));
}
async function completeEsOutbox(exec, id) {
  await exec.query('DELETE FROM chatgptads_es_outbox WHERE id = ?', [id]);
}
async function failEsOutbox(exec, id, error) {
  await exec.query(
    `UPDATE chatgptads_es_outbox SET attempts = attempts + 1, last_error = ?,
       next_retry_at = DATE_ADD(NOW(3), INTERVAL LEAST(POWER(2, attempts), 60) MINUTE)
     WHERE id = ?`,
    [String(error).slice(0, 4000), id]
  );
}

module.exports = {
  withTransaction,
  getAdByAdId, insertChatgptAd, updateChatgptAd, getJoinedAd, deleteAdCascade,
  getPostOwner, insertPostOwner, updatePostOwner,
  getDomain, insertDomain,
  upsertCountryOnly,
  insertVariant, updateVariantByAdId,
  upsertAnalyticsForDate,
  insertAdCountries,
  upsertAdImageVideo,
  upsertTranslation,
  queueEsOutbox, clearEsOutbox, getPendingEsOutbox, completeEsOutbox, failEsOutbox,
};
