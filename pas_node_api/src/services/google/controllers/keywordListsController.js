'use strict';

/**
 * Keyword Lists — user-curated named lists of keywords (the "Keyword lists"
 * tab in the Ahrefs-style Keywords Explorer). Independent of the
 * `keyword_stats` rollup — a list just points at keyword_ids; browsing a
 * list's contents joins back to `keyword_stats` for the same columns as the
 * main Explorer table.
 *
 * Routes (all under /api/v1/google/keywords/lists, see googleRoutes.js):
 *   POST   /keywords/lists                 create
 *   GET    /keywords/lists                 list (current user's)
 *   POST   /keywords/lists/:id/rename
 *   POST   /keywords/lists/:id/delete
 *   GET    /keywords/lists/:id/items
 *   POST   /keywords/lists/:id/items       add keywords (body: { keywords: [...] })
 *   POST   /keywords/lists/:id/items/remove
 */

const { normalizeParams } = require('../helpers/paramParser');

async function loadOwnedList(db, listId, userId) {
  const [list] = await db.sql.query('SELECT * FROM keyword_lists WHERE id = ?', [listId]);
  if (!list) return { list: null, forbidden: false };
  if (Number(list.user_id) !== Number(userId)) return { list: null, forbidden: true };
  return { list, forbidden: false };
}

async function createKeywordList(req, db, logger) {
  const p = normalizeParams({ ...req.body, ...req.query });
  const userId = req.user?.id || p.user_id;
  if (!p.name) return { code: 400, message: 'Missing parameter: name is required' };
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const result = await db.sql.query(
      'INSERT INTO keyword_lists (user_id, name, country, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
      [userId, p.name, p.country || null]
    );
    const id = result.insertId;
    return { code: 200, message: 'Keyword list created.', data: { id, name: p.name, country: p.country || null } };
  } catch (err) {
    logger.error('Error in createKeywordList (google)', { error: err.message });
    return { code: 500, message: 'Error creating keyword list', error: err.message };
  }
}

async function listKeywordLists(req, db, logger) {
  const p = normalizeParams({ ...req.body, ...req.query });
  const userId = req.user?.id || p.user_id;
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const lists = await db.sql.query(
      `SELECT kl.id, kl.name, kl.country, kl.created_at, kl.updated_at,
              COUNT(kli.id) AS keyword_count
       FROM keyword_lists kl
       LEFT JOIN keyword_list_items kli ON kli.list_id = kl.id
       WHERE kl.user_id = ?
       GROUP BY kl.id
       ORDER BY kl.updated_at DESC`,
      [userId]
    );
    return { code: 200, message: 'Keyword lists fetched.', data: { lists } };
  } catch (err) {
    logger.error('Error in listKeywordLists (google)', { error: err.message });
    return { code: 500, message: 'Error fetching keyword lists', error: err.message };
  }
}

async function renameKeywordList(req, db, logger) {
  const p = normalizeParams({ ...req.body, ...req.query });
  const userId = req.user?.id || p.user_id;
  const listId = req.params.id;
  if (!p.name) return { code: 400, message: 'Missing parameter: name is required' };
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const { list, forbidden } = await loadOwnedList(db, listId, userId);
    if (forbidden) return { code: 403, message: 'You do not own this keyword list' };
    if (!list) return { code: 404, message: 'Keyword list not found' };

    await db.sql.query('UPDATE keyword_lists SET name = ?, updated_at = NOW() WHERE id = ?', [p.name, listId]);
    return { code: 200, message: 'Keyword list renamed.', data: { id: Number(listId), name: p.name } };
  } catch (err) {
    logger.error('Error in renameKeywordList (google)', { error: err.message });
    return { code: 500, message: 'Error renaming keyword list', error: err.message };
  }
}

async function deleteKeywordList(req, db, logger) {
  const p = normalizeParams({ ...req.body, ...req.query });
  const userId = req.user?.id || p.user_id;
  const listId = req.params.id;
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const { list, forbidden } = await loadOwnedList(db, listId, userId);
    if (forbidden) return { code: 403, message: 'You do not own this keyword list' };
    if (!list) return { code: 404, message: 'Keyword list not found' };

    await db.sql.query('DELETE FROM keyword_lists WHERE id = ?', [listId]); // cascades to keyword_list_items
    return { code: 200, message: 'Keyword list deleted.', data: { id: Number(listId) } };
  } catch (err) {
    logger.error('Error in deleteKeywordList (google)', { error: err.message });
    return { code: 500, message: 'Error deleting keyword list', error: err.message };
  }
}

async function getKeywordListItems(req, db, logger) {
  const p = normalizeParams({ ...req.body, ...req.query });
  const userId = req.user?.id || p.user_id;
  const listId = req.params.id;
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const { list, forbidden } = await loadOwnedList(db, listId, userId);
    if (forbidden) return { code: 403, message: 'You do not own this keyword list' };
    if (!list) return { code: 404, message: 'Keyword list not found' };

    const keywords = await db.sql.query(
      `SELECT gtk.id AS keyword_id, gtk.keyword, gtk.country,
              ks.ads_total, ks.advertisers_total, ks.domains_total,
              ks.growth_pct, ks.competition_score, ks.category,
              ks.first_seen, ks.last_seen, kli.added_at
       FROM keyword_list_items kli
       JOIN google_text_keywords gtk ON gtk.id = kli.keyword_id
       LEFT JOIN keyword_stats ks ON ks.keyword_id = gtk.id
       WHERE kli.list_id = ?
       ORDER BY kli.added_at DESC`,
      [listId]
    );
    return { code: 200, message: 'Keyword list items fetched.', data: { list, keywords } };
  } catch (err) {
    logger.error('Error in getKeywordListItems (google)', { error: err.message });
    return { code: 500, message: 'Error fetching keyword list items', error: err.message };
  }
}

async function addKeywordsToList(req, db, logger) {
  const p = normalizeParams({ ...req.body, ...req.query });
  const userId = req.user?.id || p.user_id;
  const listId = req.params.id;
  const keywords = Array.isArray(req.body?.keywords) ? req.body.keywords : [];
  if (!keywords.length) return { code: 400, message: 'Missing parameter: keywords (array) is required' };
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const { list, forbidden } = await loadOwnedList(db, listId, userId);
    if (forbidden) return { code: 403, message: 'You do not own this keyword list' };
    if (!list) return { code: 404, message: 'Keyword list not found' };

    const wanted = [...new Set(keywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean))];
    if (!wanted.length) return { code: 400, message: 'No valid keywords provided' };

    const placeholders = wanted.map(() => '?').join(', ');
    const matched = await db.sql.query(
      `SELECT id, LOWER(TRIM(keyword)) AS k FROM google_text_keywords WHERE LOWER(TRIM(keyword)) IN (${placeholders})`,
      wanted
    );
    const foundSet = new Set(matched.map((m) => m.k));
    const notFound = wanted.filter((w) => !foundSet.has(w));

    if (matched.length) {
      const values = matched.map(() => '(?, ?, NOW())').join(', ');
      const params = matched.flatMap((m) => [listId, m.id]);
      await db.sql.query(
        `INSERT IGNORE INTO keyword_list_items (list_id, keyword_id, added_at) VALUES ${values}`,
        params
      );
      await db.sql.query('UPDATE keyword_lists SET updated_at = NOW() WHERE id = ?', [listId]);
    }

    return {
      code: 200,
      message: 'Keywords added to list.',
      data: { added: matched.length, not_found: notFound },
    };
  } catch (err) {
    logger.error('Error in addKeywordsToList (google)', { error: err.message });
    return { code: 500, message: 'Error adding keywords to list', error: err.message };
  }
}

async function removeKeywordFromList(req, db, logger) {
  const p = normalizeParams({ ...req.body, ...req.query });
  const userId = req.user?.id || p.user_id;
  const listId = req.params.id;
  const keywordId = req.body?.keyword_id;
  if (!keywordId) return { code: 400, message: 'Missing parameter: keyword_id is required' };
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const { list, forbidden } = await loadOwnedList(db, listId, userId);
    if (forbidden) return { code: 403, message: 'You do not own this keyword list' };
    if (!list) return { code: 404, message: 'Keyword list not found' };

    await db.sql.query('DELETE FROM keyword_list_items WHERE list_id = ? AND keyword_id = ?', [listId, keywordId]);
    return { code: 200, message: 'Keyword removed from list.', data: { list_id: Number(listId), keyword_id: Number(keywordId) } };
  } catch (err) {
    logger.error('Error in removeKeywordFromList (google)', { error: err.message });
    return { code: 500, message: 'Error removing keyword from list', error: err.message };
  }
}

module.exports = {
  createKeywordList,
  listKeywordLists,
  renameKeywordList,
  deleteKeywordList,
  getKeywordListItems,
  addKeywordsToList,
  removeKeywordFromList,
};
