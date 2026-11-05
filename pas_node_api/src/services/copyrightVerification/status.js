'use strict';

/**
 * copyright_status helpers shared by insertion (ES index hook) and search.
 *
 *   0 = pending  (inserted, not yet verified)   -> hidden
 *   1 = approved (passed verification)          -> visible
 *   2 = failed   (matched the blocklist)        -> hidden, removed by the cleanup cron
 *
 * Everything here is a no-op while compliance.copyrightVerification.enabled is false.
 */

const config = require('../../config');

const PENDING = 0;
const APPROVED = 1;
const FAILED = 2;

// network -> [SQL ad table, ES field holding the internal id, default ES index]
// TikTok is a separate service and is not part of this flow.
const NETWORKS = {
  facebook: ['facebook_ad', 'facebook_ad.id', 'search_mix'],
  instagram: ['instagram_ad', 'instagram_ad.id', 'instagram_search_mix'],
  gdn: ['gdn_ad', 'gdn_ad.id', 'gdn_search_mix'],
  youtube: ['youtube_ad', 'ad_id', 'youtube_ads_data'],
  linkedin: ['linkedin_ad', 'ad_id', 'linkedin_ads_data'],
  reddit: ['reddit_ad', 'reddit_ad.id', 'reddit_search_mix'],
  quora: ['quora_ad', 'quora_ad.id', 'quora_search_mix'],
  pinterest: ['pinterest_ad', 'pinterest_ad.id', 'pinterest_search_mix'],
  native: ['native_ad', 'native_ad.id', 'native_search_mix'],
  google: ['google_text_ad', 'id', 'google_ads_data_v2'],
  admob: ['mob_ads', 'id', 'mob_search_mix'],
  chatgptads: ['chatgptads_ad', 'id', 'chatgpt_search_mix'],
};

const enabled = () => config.compliance?.copyrightVerification?.enabled === true;

// ES: hide pending and failed docs. A doc WITHOUT the field (indexed before this
// feature) stays visible, so no ES backfill is needed on rollout.
function searchFilter() {
  if (!enabled()) return null;
  return { bool: { must_not: { terms: { copyright_status: [PENDING, FAILED] } } } };
}

// SQL: the migration gives existing rows 1, so "= 1" matches the ES rule.
function sqlPredicate(table) {
  if (!enabled()) return '';
  if (!Object.values(NETWORKS).some(([name]) => name === table)) throw new Error(`Unsupported copyright status table ${table}.`);
  return ` AND ${table}.copyright_status = ${APPROVED}`;
}

function detailQuery(query, network) {
  if (!enabled()) return query;
  const table = NETWORKS[network]?.[0];
  const clause = `WHERE ${table}.id = ?`;
  if (!table || !query.includes(clause)) throw new Error('Cannot apply copyright detail filter.');
  return query.replace(clause, `${clause}${sqlPredicate(table)}`);
}

/**
 * Called by DatabaseManager before every elastic.index() of a supported network.
 * A full re-index must not lose an approval (or un-hide a pending ad), so the
 * status is copied from SQL with one primary-key lookup. Any problem -> pending
 * (hidden, verified later). It never throws, so insertion is never blocked.
 */
async function indexDocument(network, configuredIndex, params, getSql) {
  const mapping = NETWORKS[network];
  if (!enabled() || !mapping || !params?.body) return params;
  const [table, idField, defaultIndex] = mapping;
  const index = String(params.index || '').toLowerCase();
  if (index !== String(configuredIndex || '').toLowerCase() && index !== defaultIndex) return params;
  let status = PENDING;
  try {
    // Insertion writes the id as a flat dotted key (body['facebook_ad.id']); accept a nested object too.
    const [outer, inner] = idField.split('.');
    const id = params.body[idField] ?? (inner ? params.body[outer]?.[inner] : undefined);
    if (/^\d+$/.test(String(id ?? ''))) {
      const rows = await getSql().query(`SELECT copyright_status FROM \`${table}\` WHERE id = ? LIMIT 1`, [String(id)]);
      const value = Number(rows?.[0]?.copyright_status);
      if ([PENDING, APPROVED, FAILED].includes(value)) status = value;
    }
  } catch { /* keep pending */ }
  return { ...params, body: { ...params.body, copyright_status: status } };
}

module.exports = { PENDING, APPROVED, FAILED, NETWORKS, enabled, searchFilter, sqlPredicate, detailQuery, indexDocument };
