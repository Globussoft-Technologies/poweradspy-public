/**
 * YouTube Unhealthy-Ads Audit — interactive CLI.
 *
 *     cd admin_panel_backend
 *     node diagnostics/youtube-ads-audit.js
 *
 * Thin config wrapper over diagnostics/lib/ads-audit-core.js (the shared engine).
 * READ-ONLY; delete is hard-disabled in the core. See that file for flags
 * (--run / --samples / --timeout / --noDup / --dupPageSize).
 *
 * YouTube specifics (verified against pas_node_api youtube adSearchController):
 *   • ES index / es_id   : YT_INDEX (youtube_ads_data) on es_id 0 (DEV forces 0).
 *                          This is a FLAT index — its document id field is `ad_id`
 *                          (NOT youtube_ad.id), and the type field is `ad_type`.
 *                          Search does NOT collapse → a duplicate renders as a dupe card.
 *   • Displayable filter : VIDEO/DISCOVERY need a usable `thumbnail_url`; everything
 *                          else needs a usable `new_nas_image_url`; empty ad_type is
 *                          excluded. The filter uses blocked-value wildcards (a doc
 *                          can have the field but hold a pasvideo/pasimage/bydefault/
 *                          DefaultImage path), so the failure breakdown uses the core's
 *                          subtract-displayable model (exact even with those rules).
 *   • SQL media model    : NOT youtube_ad_image_video — that table is carousel-only
 *                          (VIDEO+SIDE), so ~every ad legitimately lacks a row there.
 *                          YouTube's real media column is youtube_ad_variants.video_url
 *                          (image→NAS path, thumbnail→NAS path; set for every type).
 *                          "Good" media = video_url present AND not a default/blocked
 *                          NAS path (bydefault/DefaultImage/pasimage/pasvideo —
 *                          DEFAULT_AD_IMAGE='/bydefault_ads.jpg', DEFAULT_OWNER_IMAGE=
 *                          '/DefaultImage.jpg'), mirroring the ES displayable filter.
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { runAuditCli } = require('./lib/ads-audit-core');
const { getDisplayableMediaFilter } = require('../utils/displayable-media-filters');

const TYPE = 'ad_type.keyword';
const VIDEO_LIKE = ['VIDEO', 'DISCOVERY']; // the displayable filter's thumbnail_url branch

runAuditCli({
  network: 'youtube',
  reportPrefix: 'youtube-audit',
  es: {
    index: process.env.YT_INDEX || 'youtube_ads_data',
    esId: 0,
    idField: 'ad_id',
    displayableFilter: getDisplayableMediaFilter('youtube'),
    // VIDEO/DISCOVERY gate on thumbnail_url; DISPLAY/IMAGE on new_nas_image_url. SQL
    // source for all is youtube_ad_variants.video_url (image→NAS, thumbnail→NAS).
    backfillFields: { VIDEO: 'thumbnail_url', DISCOVERY: 'thumbnail_url', DISPLAY: 'new_nas_image_url', IMAGE: 'new_nas_image_url' },
    sampleSource: ['ad_id', 'ad_type', 'last_seen', 'thumbnail_url', 'new_nas_image_url'],
    typeBuckets: [
      { label: 'VIDEO',     query: { term: { [TYPE]: 'VIDEO' } } },
      { label: 'DISCOVERY', query: { term: { [TYPE]: 'DISCOVERY' } } },
      { label: 'DISPLAY',   query: { term: { [TYPE]: 'DISPLAY' } } },
      { label: 'IMAGE',     query: { term: { [TYPE]: 'IMAGE' } } },
    ],
    // Disjoint groups that partition ALL docs by type. failing = group − (group ∧
    // displayable), so the two sum exactly to non-displayable. G2 captures
    // DISPLAY/IMAGE/empty-type ads (empty ad_type fails the filter → counted here).
    failureGroups: [
      {
        key: 'VIDEO_DISCOVERY_BAD_THUMB',
        label: 'VIDEO/DISCOVERY without a usable thumbnail_url',
        query: { terms: { [TYPE]: VIDEO_LIKE } },
      },
      {
        key: 'OTHER_BAD_IMAGE',
        label: 'Non-VIDEO/DISCOVERY (DISPLAY/IMAGE/empty) without a usable new_nas_image_url',
        query: { bool: { must_not: [{ terms: { [TYPE]: VIDEO_LIKE } }] } },
      },
    ],
  },
  sql: {
    dbId: 1,
    database: process.env.YT_DATABASE || 'pasdev_youtube',
    mainTable: 'youtube_ad',
    // YouTube media is the variant's video_url (NAS path), NOT the carousel-only
    // youtube_ad_image_video table. So we audit youtube_ad_variants instead.
    mediaTable: 'youtube_ad_variants',
    fkColumn: 'youtube_ad_id',
    contentColumn: 'video_url',
    // "Good" = a real NAS media path: present and not a default/blocked placeholder.
    // Mirrors the ES displayable filter's blocked substrings. MySQL LIKE is
    // case-insensitive under the default *_ci collation, so this also catches
    // mixed-case variants of the patterns.
    goodMediaExpr: `(video_url IS NOT NULL AND video_url <> ''
      AND video_url NOT LIKE '%bydefault%'
      AND video_url NOT LIKE '%DefaultImage%'
      AND video_url NOT LIKE '%pasimage%'
      AND video_url NOT LIKE '%pasvideo%')`,
    unusableDesc: 'missing / a default or blocked NAS path (bydefault/DefaultImage/pasimage/pasvideo)',
  },
});
