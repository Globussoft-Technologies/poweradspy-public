/**
 * Pinterest Unhealthy-Ads Audit — interactive CLI.
 *
 *     cd admin_panel_backend
 *     node diagnostics/pinterest-ads-audit.js
 *
 * Thin config wrapper over diagnostics/lib/ads-audit-core.js (the shared engine).
 * READ-ONLY; delete is hard-disabled in the core. See that file for flags
 * (--run / --samples / --timeout / --noDup / --dupPageSize).
 *
 * Pinterest specifics (verified against pas_node_api pinterest adSearchController + insertion):
 *   • ES index / es_id   : PINT_INDEX (pinterest_search_mix) on es_id 2 (DEV forces 0).
 *                          doc id = pinterest_ad.id (no collapse). type = pinterest_ad.type.
 *   • Displayable filter : IMAGE needs new_nas_image_url; VIDEO needs thumbnail; other
 *                          types pass. Exists-only → failureGroups still exact.
 *   • SQL media model     : SINGLE column — both IMAGE and VIDEO store their NAS media
 *                          (image / video thumbnail) in pinterest_ad_variants.image_url.
 *                          The two ES fields (new_nas_image_url / thumbnail) both derive
 *                          from that one column, so no mediaSpecs needed. mediaRequiredTypes
 *                          IMAGE/VIDEO; exclude default/legacy paths.
 *   • NOTE                : pinterest has a known ES↔SQL gap (~22% of ES docs have no MySQL
 *                          row) — expect ES total ≠ SQL total; cross-check by RATE.
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { runAuditCli } = require('./lib/ads-audit-core');
const { getDisplayableMediaFilter } = require('../utils/displayable-media-filters');
const { nasGoodMediaExpr } = require('./lib/media-good-expr');

const TYPE = 'pinterest_ad.type.keyword';
const MEDIA_TYPES = ['IMAGE', 'VIDEO'];

runAuditCli({
  network: 'pinterest',
  reportPrefix: 'pinterest-audit',
  es: {
    index: process.env.PINT_INDEX || 'pinterest_search_mix',
    esId: 2,
    idField: 'pinterest_ad.id',
    displayableFilter: getDisplayableMediaFilter('pinterest'),
    backfillFields: { IMAGE: 'new_nas_image_url', VIDEO: 'thumbnail' }, // both from SQL pinterest_ad_variants.image_url
    sampleSource: ['pinterest_ad.id', 'pinterest_ad.type', 'pinterest_ad.last_seen', 'new_nas_image_url', 'thumbnail'],
    typeBuckets: [
      { label: 'IMAGE', query: { term: { [TYPE]: 'IMAGE' } } },
      { label: 'VIDEO', query: { term: { [TYPE]: 'VIDEO' } } },
    ],
    // Partition all docs; failing = group − (group ∧ displayable):
    //   IMAGE → fails on missing new_nas_image_url
    //   VIDEO → fails on missing thumbnail
    //   OTHER → always displayable → failing 0 (partition check)
    failureGroups: [
      { key: 'IMAGE_NO_IMAGE', label: 'IMAGE ad with no new_nas_image_url', query: { term: { [TYPE]: 'IMAGE' } } },
      { key: 'VIDEO_NO_THUMB', label: 'VIDEO ad with no thumbnail', query: { term: { [TYPE]: 'VIDEO' } } },
      { key: 'OTHER_DISPLAYABLE', label: 'Other types — should all be displayable', query: { bool: { must_not: [{ terms: { [TYPE]: MEDIA_TYPES } }] } } },
    ],
  },
  sql: {
    dbId: 6,
    database: process.env.PINT_DATABASE || 'pasdev_pinterest',
    mainTable: 'pinterest_ad',
    mediaTable: 'pinterest_ad_variants',
    fkColumn: 'pinterest_ad_id',
    contentColumn: 'image_url',
    mediaRequiredTypes: ['IMAGE', 'VIDEO'],
    goodMediaExpr: nasGoodMediaExpr('image_url'), // allowlist of real NAS prefixes, not a blocklist
    unusableDesc: 'missing / not a real NAS media path (legacy pasimages, test/asset paths, raw CDN, default, null)',
  },
});
