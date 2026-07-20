'use strict';

/**
 * Single source of truth for each network's SQL "domains" table + the Elasticsearch doc field
 * that mirrors the registration date (so a SQL update can be propagated to every ad's ES doc).
 *
 * Verified against the PHP domain models (each api_* app's Models/*AdDomain*.php), the Node
 * insertion repositories, and the LIVE ES field mappings. TikTok is excluded — no SQL domains table.
 *
 * Per network:
 *   table       - the domains table name
 *   adTable      - the ads table (its `domain_id` FK links ads → this domain; its `ad_id` matches
 *                  the ES `ad_id` field used to locate each ad's doc — same key updateAdMediaService uses)
 *   updatedDate  - the "row last updated" column, or null if the table has none.
 *                  facebook_ad_domains & linkedin_ad_domains have NO `updated_date`
 *                  column (they carry `created` + `last_seen`).
 *   recency      - best "most recently touched" column to sort by when `updatedDate` is null.
 *   esDateField  - the ES field (in the network's primary search index) holding the registration
 *                  date. NOTE the naming/format split, confirmed against live mappings:
 *                    * search_mix indices → literal dotted key `<table>.domain_registered_date`, `yyyy-MM-dd`
 *                    * google_ads_data     → flat `domain_registered_date`, `yyyy-MM-dd`
 *                    * linkedin/youtube    → flat `domain_registration_date`, stored as epoch_second
 *   esDateFormat - 'ymd' (write the 'YYYY-MM-DD' string) | 'epoch' (write integer epoch seconds)
 *   esMatchField - the ES field that identifies an ad's doc, used to locate the docs to update
 *                  (the ES docs do NOT store the domain string). Confirmed by live probing:
 *                    * search_mix indices → `<adTable>.id`  (the ad's INTERNAL id, dotted key)
 *                    * youtube / linkedin → flat `ad_id`, holding the INTERNAL id
 *                    * google_ads_data     → flat `ad_id`, holding the PUBLIC ad_id
 *   esMatchId    - which SQL column of `adTable` supplies esMatchField's value: 'internal' (id) | 'public' (ad_id)
 *
 * Every domains table has a `domain` and a `domain_registered_date` column. The ES ad docs do NOT
 * store the domain string, so ES updates are located via ad ids resolved from SQL (adTable.domain_id).
 */
const DOMAIN_TABLES = {
  facebook:  { table: 'facebook_ad_domains',    adTable: 'facebook_ad',    updatedDate: null,           recency: 'last_seen',    esDateField: 'facebook_ad_domains.domain_registered_date',  esDateFormat: 'ymd',   esMatchField: 'facebook_ad.id',    esMatchId: 'internal' },
  linkedin:  { table: 'linkedin_ad_domains',    adTable: 'linkedin_ad',    updatedDate: null,           recency: 'last_seen',    esDateField: 'domain_registration_date',                    esDateFormat: 'epoch', esMatchField: 'ad_id',             esMatchId: 'internal' },
  instagram: { table: 'instagram_ad_domain',    adTable: 'instagram_ad',   updatedDate: 'updated_date', recency: 'updated_date', esDateField: 'instagram_ad_domain.domain_registered_date',  esDateFormat: 'ymd',   esMatchField: 'instagram_ad.id',   esMatchId: 'internal' },
  google:    { table: 'google_text_ad_domains', adTable: 'google_text_ad', updatedDate: 'updated_date', recency: 'updated_date', esDateField: 'domain_registered_date',                      esDateFormat: 'ymd',   esMatchField: 'ad_id',             esMatchId: 'public' },
  youtube:   { table: 'youtube_ad_domains',     adTable: 'youtube_ad',     updatedDate: 'updated_date', recency: 'updated_date', esDateField: 'domain_registration_date',                    esDateFormat: 'epoch', esMatchField: 'ad_id',             esMatchId: 'internal' },
  native:    { table: 'native_ad_domains',      adTable: 'native_ad',      updatedDate: 'updated_date', recency: 'updated_date', esDateField: 'native_ad_domains.domain_registered_date',    esDateFormat: 'ymd',   esMatchField: 'native_ad.id',      esMatchId: 'internal' },
  pinterest: { table: 'pinterest_ad_domains',   adTable: 'pinterest_ad',   updatedDate: 'updated_date', recency: 'updated_date', esDateField: 'pinterest_ad_domains.domain_registered_date', esDateFormat: 'ymd',   esMatchField: 'pinterest_ad.id',   esMatchId: 'internal' },
  reddit:    { table: 'reddit_ad_domain',       adTable: 'reddit_ad',      updatedDate: 'updated_date', recency: 'updated_date', esDateField: 'reddit_ad_domain.domain_registered_date',     esDateFormat: 'ymd',   esMatchField: 'reddit_ad.id',      esMatchId: 'internal' },
  quora:     { table: 'quora_ad_domain',        adTable: 'quora_ad',       updatedDate: 'updated_date', recency: 'updated_date', esDateField: 'quora_ad_domains.domain_registered_date',     esDateFormat: 'ymd',   esMatchField: 'quora_ad.id',       esMatchId: 'internal' },
  gdn:       { table: 'gdn_ad_domains',         adTable: 'gdn_ad',         updatedDate: 'updated_date', recency: 'updated_date', esDateField: 'gdn_ad_domains.domain_registered_date',       esDateFormat: 'ymd',   esMatchField: 'gdn_ad.id',         esMatchId: 'internal' },
};

const DOMAIN_NETWORKS = Object.keys(DOMAIN_TABLES);

module.exports = { DOMAIN_TABLES, DOMAIN_NETWORKS };
