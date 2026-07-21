'use strict';

/**
 * Synchronous dual-write hook: called from keywordSearchController right after a frontend
 * search is stored in keyword_searches. When the stored term is a GOOGLE KEYWORD it is
 * immediately upserted into google_audit_keywords too (deduped by keywordNorm).
 *
 * Best-effort and NON-FATAL by design — it never throws, so a Mongo hiccup on the audit
 * collection can't break or slow down the user-facing search store. The cron remains the
 * backstop (re-imports anything missed). Toggle with config.googleKeywordAudit.syncFromUserSearch.
 */

const repo = require('./repository');
const config = require('../../../config');

/**
 * @param {{ value:string, type:number, networks:string[] }} term  the just-stored term
 * @param {object} [log]
 * @returns {Promise<{synced:boolean, inserted?:number}>}
 */
async function syncGoogleKeyword({ value, type, networks }, log) {
  const cfg = config.googleKeywordAudit;
  if (!cfg.enabled || cfg.syncFromUserSearch === false) return { synced: false };
  if (Number(type) !== Number(cfg.importType)) return { synced: false };            // keywords only
  if (!Array.isArray(networks) || !networks.includes(cfg.importNetwork)) return { synced: false }; // google only
  if (value == null || String(value).trim() === '') return { synced: false };
  if (!repo.getCollection()) return { synced: false };                              // mongo down → skip

  try {
    const r = await repo.bulkUpsertKeywords([{ keyword: value }], 'user_search');
    // Only pay for cap enforcement when the collection actually grew.
    if (r.inserted > 0 && cfg.syncEnforceCap !== false) {
      await repo.enforceCap(cfg.maxCount);
    }
    return { synced: true, inserted: r.inserted };
  } catch (err) {
    log?.error?.('google audit dual-write failed', { error: err.message });
    return { synced: false };
  }
}

module.exports = { syncGoogleKeyword };
