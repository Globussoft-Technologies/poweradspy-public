/**
 * GDN (Google Display Network) Unhealthy-Ads Audit — interactive CLI.
 *
 *     cd admin_panel_backend
 *     node diagnostics/gdn-ads-audit.js
 *
 * Thin config wrapper over diagnostics/lib/ads-audit-core.js (the shared engine).
 * READ-ONLY; delete is hard-disabled in the core. See that file for flags
 * (--run / --samples / --timeout / --noDup / --dupPageSize).
 *
 * GDN specifics (verified against pas_node_api gdn adSearchController + live data):
 *   • ES index / es_id   : GDN_INDEX (gdn_search_mix) on es_id 2 (DEV forces 0).
 *                          doc id = gdn_ad.id (no collapse). type = gdn_ad.type — GDN is
 *                          image-only (100% IMAGE in practice).
 *   • Displayable filter : type IMAGE (or empty) needs new_nas_image_url; any other type
 *                          passes. Exists-only → failureGroups still exact.
 *   • SQL media model     : single column gdn_ad_variants.image_url. Values are real NAS
 *                          paths OR legacy 'pasimages/gdn/...' OR '/bydefault_ads.jpg' — so
 *                          the pasimage/bydefault exclusions are essential (verified: ~57k
 *                          of 131k are legacy/default). mediaRequiredTypes = IMAGE/empty.
 *   • NOTE                : DEV ES new_nas_image_url is under-populated vs SQL (SQL has the
 *                          NAS image for ~18k ads ES lacks) — cross-check by RATE/direction.
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { runAuditCli } = require('./lib/ads-audit-core');
const { getDisplayableMediaFilter } = require('../utils/displayable-media-filters');

const TYPE = 'gdn_ad.type.keyword';
// The displayable filter treats IMAGE and empty-type the same (both need media).
const IMAGE_LIKE = { bool: { should: [{ term: { [TYPE]: 'IMAGE' } }, { term: { [TYPE]: '' } }], minimum_should_match: 1 } };

runAuditCli({
  network: 'gdn',
  reportPrefix: 'gdn-audit',
  es: {
    index: process.env.GDN_INDEX || 'gdn_search_mix',
    esId: 2,
    idField: 'gdn_ad.id',
    displayableFilter: getDisplayableMediaFilter('gdn'),
    sampleSource: ['gdn_ad.id', 'gdn_ad.type', 'gdn_ad.last_seen', 'new_nas_image_url'],
    typeBuckets: [
      { label: 'IMAGE', query: { term: { [TYPE]: 'IMAGE' } } },
    ],
    // Partition all docs; failing = group − (group ∧ displayable):
    //   IMAGE/empty → fails on missing new_nas_image_url
    //   OTHER → always displayable → failing 0 (partition check)
    failureGroups: [
      { key: 'IMAGE_NO_IMAGE', label: 'IMAGE/empty-type ad with no new_nas_image_url', query: IMAGE_LIKE },
      { key: 'OTHER_DISPLAYABLE', label: 'Other types — should all be displayable', query: { bool: { must_not: [IMAGE_LIKE] } } },
    ],
  },
  sql: {
    dbId: 5,
    database: process.env.GDN_DATABASE || 'pasdev_gdn',
    mainTable: 'gdn_ad',
    mediaTable: 'gdn_ad_variants',
    fkColumn: 'gdn_ad_id',
    contentColumn: 'image_url',
    mediaRequiredTypes: ['IMAGE'], // GDN is 100% IMAGE (no empty/other types present); others would be counted healthy
    goodMediaExpr: `(image_url IS NOT NULL AND image_url <> ''
      AND image_url NOT LIKE '%bydefault%'
      AND image_url NOT LIKE '%DefaultImage%'
      AND image_url NOT LIKE '%pasimage%'
      AND image_url NOT LIKE '%pasvideo%')`,
    unusableDesc: 'missing / a default or legacy non-NAS path (bydefault/DefaultImage/pasimage/pasvideo)',
  },
});
