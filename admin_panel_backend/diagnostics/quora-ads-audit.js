/**
 * Quora Unhealthy-Ads Audit — interactive CLI.
 *
 *     cd admin_panel_backend
 *     node diagnostics/quora-ads-audit.js
 *
 * Thin config wrapper over diagnostics/lib/ads-audit-core.js (the shared engine).
 * READ-ONLY; delete is hard-disabled in the core. See that file for flags
 * (--run / --samples / --timeout / --noDup / --dupPageSize).
 *
 * Quora specifics (verified against pas_node_api quora adSearchController + insertion):
 *   • ES index / es_id   : QUORA_INDEX (quora_search_mix) on es_id 2 (DEV forces 0).
 *                          doc id = quora_ad.id (no collapse). type = quora_ad.type.
 *   • Displayable filter : IMAGE needs new_nas_image_url; VIDEO needs new_nas_image_url
 *                          AND thumbnail; other types pass. Exists-only → failureGroups
 *                          still exact.
 *   • SQL media model     : SPLIT BY TYPE (the reason mediaSpecs exists):
 *                            - IMAGE → quora_ad_variants.image_url   (ES new_nas_image_url)
 *                            - VIDEO → quora_ad_image_video.ad_image_video (ES thumbnail)
 *                          The insert writes '/DefaultImage.jpg' on failure; good = a real
 *                          NAS path (exclude default/legacy). TEXT (the largest type) needs
 *                          no media → healthy. Cross-check by RATE (ES total ≠ SQL total).
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { runAuditCli } = require('./lib/ads-audit-core');
const { getDisplayableMediaFilter } = require('../utils/displayable-media-filters');

const TYPE = 'quora_ad.type.keyword';
const MEDIA_TYPES = ['IMAGE', 'VIDEO'];
// "Good" NAS media: present and not a default/legacy placeholder. Shared by both specs.
const goodNas = (col) => `(${col} IS NOT NULL AND ${col} <> ''
  AND ${col} NOT LIKE '%bydefault%'
  AND ${col} NOT LIKE '%DefaultImage%'
  AND ${col} NOT LIKE '%pasimage%'
  AND ${col} NOT LIKE '%pasvideo%')`;

runAuditCli({
  network: 'quora',
  reportPrefix: 'quora-audit',
  es: {
    index: process.env.QUORA_INDEX || 'quora_search_mix',
    esId: 2,
    idField: 'quora_ad.id',
    displayableFilter: getDisplayableMediaFilter('quora'),
    sampleSource: ['quora_ad.id', 'quora_ad.type', 'quora_ad.last_seen', 'new_nas_image_url', 'thumbnail'],
    typeBuckets: [
      { label: 'IMAGE', query: { term: { [TYPE]: 'IMAGE' } } },
      { label: 'VIDEO', query: { term: { [TYPE]: 'VIDEO' } } },
    ],
    // Partition all docs; failing = group − (group ∧ displayable):
    //   IMAGE → fails on missing new_nas_image_url
    //   VIDEO → fails when missing new_nas_image_url OR thumbnail
    //   OTHER (TEXT, …) → always displayable → failing 0 (partition check)
    failureGroups: [
      { key: 'IMAGE_NO_IMAGE', label: 'IMAGE ad with no new_nas_image_url', query: { term: { [TYPE]: 'IMAGE' } } },
      { key: 'VIDEO_NO_MEDIA', label: 'VIDEO ad missing new_nas_image_url and/or thumbnail', query: { term: { [TYPE]: 'VIDEO' } } },
      { key: 'OTHER_DISPLAYABLE', label: 'Other types (TEXT, …) — should all be displayable', query: { bool: { must_not: [{ terms: { [TYPE]: MEDIA_TYPES } }] } } },
    ],
  },
  sql: {
    dbId: 7,
    database: process.env.QUORA_DATABASE || 'pasdev_quora',
    mainTable: 'quora_ad',
    // Split media by type — see header. Types not listed (TEXT) are counted healthy.
    mediaSpecs: [
      {
        types: ['IMAGE'],
        mediaTable: 'quora_ad_variants',
        fkColumn: 'quora_ad_id',
        contentColumn: 'image_url',
        goodMediaExpr: goodNas('image_url'),
        unusableDesc: 'missing / a default or legacy non-NAS path',
      },
      {
        types: ['VIDEO'],
        mediaTable: 'quora_ad_image_video',
        fkColumn: 'quora_ad_id',
        contentColumn: 'ad_image_video',
        goodMediaExpr: goodNas('ad_image_video'),
        unusableDesc: 'missing / a default or legacy non-NAS path',
      },
    ],
  },
});
