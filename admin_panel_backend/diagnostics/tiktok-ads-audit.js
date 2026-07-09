/**
 * TikTok Unhealthy-Ads Audit — interactive CLI.
 *
 *     cd admin_panel_backend
 *     node diagnostics/tiktok-ads-audit.js
 *
 * Thin config wrapper over diagnostics/lib/ads-audit-core.js (the shared engine).
 * READ-ONLY; delete is hard-disabled in the core. See that file for flags
 * (--run / --samples / --timeout / --noDup / --dupPageSize).
 *
 * TikTok is the one network on a SEPARATE ES 8.x cluster (the legacy admin ES
 * client can't reach it), so it supplies its own transport — see
 * es-connections/tiktok-connection.js (dependency-free REST over the 8.x cluster).
 * Creds live in admin .env: TT_ELASTIC_NODE / TT_ELASTIC_USERNAME /
 * TT_ELASTIC_PASSWORD / TT_ELASTIC_INDEX / TT_DATABASE.
 *
 * TikTok specifics (verified against pas_node_api tiktok service + live data):
 *   • ES index / cluster : tiktok_ads on the 8.x cluster (TT_ELASTIC_NODE). The search
 *                          COLLAPSES on `sql_id` (= tiktok_ads.id), so duplicates inflate
 *                          the pre-collapse count — the dup scan groups by `sql_id`.
 *                          No `type` field in ES; the displayable filter is type-agnostic.
 *   • Displayable filter : video_cover must exist AND not be a blocked path; video_url must
 *                          not be a blocked path (pasvideo/pasimage/bydefault). It does NOT
 *                          require a NAS path — raw tiktokcdn.com covers are displayable.
 *   • SQL media model     : tiktok_ad_meta_data.video_cover (FK ad_id → tiktok_ads.id, 1:1).
 *                          "Good" = video_cover present AND neither video_cover nor video_url
 *                          is a blocked path (NOT requiring NAS — raw CDN URLs are fine).
 *                          All ads are type VIDEO.
 *   • PROD note           : in DEV all MySQL goes to one pool so dbId is ignored; for PROD,
 *                          wire TikTok's MySQL server into db-connections and set TT_DB_SERVER.
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { runAuditCli } = require('./lib/ads-audit-core');
const { getDisplayableMediaFilter } = require('../utils/displayable-media-filters');
const { nasGoodMediaExpr } = require('./lib/media-good-expr');
const tiktokTransport = require('../es-connections/tiktok-connection');

runAuditCli({
  network: 'tiktok',
  reportPrefix: 'tiktok-audit',
  es: {
    index: process.env.TT_ELASTIC_INDEX || 'tiktok_ads',
    esId: 0,                       // ignored by the custom transport
    transport: tiktokTransport,    // ES 8.x cluster (see es-connections/tiktok-connection.js)
    idField: 'sql_id',             // = tiktok_ads.id; the collapse field
    displayableFilter: getDisplayableMediaFilter('tiktok'),
    backfillFields: { VIDEO: 'video_cover' }, // SQL source: tiktok_ad_meta_data.video_cover
    sampleSource: ['sql_id', 'video_cover', 'video_url', 'last_seen', 'ad_title'],
    // No ES `type` field and a type-agnostic filter → one group over all docs.
    // failing = total − displayable = non-displayable (trivially a full partition).
    failureGroups: [
      { key: 'BAD_MEDIA', label: 'Ad with missing/blocked video_cover or blocked video_url', query: { match_all: {} } },
    ],
  },
  sql: {
    dbId: parseInt(process.env.TT_DB_SERVER, 10) || 0, // DEV: pool 0 regardless; PROD: tiktok server
    database: process.env.TT_DATABASE || 'tiktok_database_development',
    mainTable: 'tiktok_ads',
    mediaTable: 'tiktok_ad_meta_data',
    fkColumn: 'ad_id',             // tiktok_ad_meta_data.ad_id → tiktok_ads.id (verified 1:1)
    contentColumn: 'video_cover',
    mediaRequiredTypes: ['VIDEO'], // tiktok ads are all VIDEO
    // "Good" = a usable cover (present) that isn't a blocked placeholder, and a
    // video_url that isn't blocked — mirroring the ES filter. NAS is NOT required
    // (raw tiktokcdn.com covers are valid), so no PowerAdspy/pasN whitelisting.
    // Backfill eligibility = a real NAS video_cover (allowlist). Note: tiktok also
    // displays raw tiktokcdn.com covers, but per policy only NAS-stored covers are
    // backfill-eligible — raw-CDN/legacy covers are deletion candidates, not backfill.
    goodMediaExpr: nasGoodMediaExpr('video_cover'),
    unusableDesc: 'missing / not a real NAS video_cover (raw CDN, legacy, blocked, null)',
  },
});
