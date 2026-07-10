'use strict';

/**
 * Single source of truth for each network's SQL "domains" table and its date columns.
 *
 * Verified against the PHP domain models (each api_* app's Models/*AdDomain*.php) and the
 * Node insertion repositories. TikTok is intentionally excluded — it has no SQL domains table.
 *
 * Per network:
 *   table       - the domains table name
 *   updatedDate  - the "row last updated" column, or null if the table has none.
 *                  facebook_ad_domains & linkedin_ad_domains have NO `updated_date`
 *                  column (they carry `created` + `last_seen`).
 *   recency      - best "most recently touched" column to sort by when `updatedDate` is null.
 *
 * Every one of these tables has a `domain` and a `domain_registered_date` column.
 */
const DOMAIN_TABLES = {
  facebook:  { table: 'facebook_ad_domains',    updatedDate: null,           recency: 'last_seen' },
  linkedin:  { table: 'linkedin_ad_domains',    updatedDate: null,           recency: 'last_seen' },
  instagram: { table: 'instagram_ad_domain',    updatedDate: 'updated_date', recency: 'updated_date' },
  google:    { table: 'google_text_ad_domains', updatedDate: 'updated_date', recency: 'updated_date' },
  youtube:   { table: 'youtube_ad_domains',     updatedDate: 'updated_date', recency: 'updated_date' },
  native:    { table: 'native_ad_domains',      updatedDate: 'updated_date', recency: 'updated_date' },
  pinterest: { table: 'pinterest_ad_domains',   updatedDate: 'updated_date', recency: 'updated_date' },
  reddit:    { table: 'reddit_ad_domain',       updatedDate: 'updated_date', recency: 'updated_date' },
  quora:     { table: 'quora_ad_domain',        updatedDate: 'updated_date', recency: 'updated_date' },
  gdn:       { table: 'gdn_ad_domains',         updatedDate: 'updated_date', recency: 'updated_date' },
};

const DOMAIN_NETWORKS = Object.keys(DOMAIN_TABLES);

module.exports = { DOMAIN_TABLES, DOMAIN_NETWORKS };
