/**
 * Native Unhealthy-Ads Audit — interactive CLI.
 *
 *     cd admin_panel_backend
 *     node diagnostics/native-ads-audit.js
 *
 * Thin config wrapper over diagnostics/lib/ads-audit-core.js (the shared engine).
 * READ-ONLY; delete is hard-disabled in the core. See that file for flags
 * (--run / --samples / --timeout / --noDup / --dupPageSize).
 *
 * Native specifics (verified against pas_node_api native adSearchController + insertion):
 *   • ES index / es_id   : NATIVE_INDEX on es_id 1 (DEV forces 0). doc id = native_ad.id
 *                          (search does NOT collapse → a duplicate renders as a dupe card).
 *                          type = native_ad.type.
 *   • Displayable filter : IMAGE/VIDEO need native_ad.nas_url to exist; other types pass.
 *                          Exists-only (no blocked-value wildcards) → failureGroups still
 *                          works (the IMAGE/VIDEO group's failing == those missing nas_url).
 *   • SQL media model    : media is native_ad_variants.image_url (NAS path; set on upload,
 *                          else NULL). The ES native_ad.nas_url is the SAME uploaded path
 *                          (ES-only field, not a native_ad column). Only IMAGE/VIDEO carry
 *                          media → mediaRequiredTypes; "good" excludes default/legacy paths
 *                          (bydefault/DefaultImage/pasimage/pasvideo), mirroring the google
 *                          lesson. Cross-check: SQL IMAGE/VIDEO-unhealthy ≈ ES failure group.
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { runAuditCli } = require('./lib/ads-audit-core');
const { getDisplayableMediaFilter } = require('../utils/displayable-media-filters');

const TYPE = 'native_ad.type.keyword';
const MEDIA_TYPES = ['IMAGE', 'VIDEO']; // the displayable filter's nas_url branch

runAuditCli({
  network: 'native',
  reportPrefix: 'native-audit',
  es: {
    index: process.env.NATIVE_INDEX || 'native_search_mix',
    esId: 1,
    idField: 'native_ad.id',
    displayableFilter: getDisplayableMediaFilter('native'),
    sampleSource: ['native_ad.id', 'native_ad.type', 'native_ad.last_seen', 'native_ad.nas_url'],
    typeBuckets: [
      { label: 'IMAGE', query: { term: { [TYPE]: 'IMAGE' } } },
      { label: 'VIDEO', query: { term: { [TYPE]: 'VIDEO' } } },
    ],
    // Partition all docs. failing = group − (group ∧ displayable):
    //   IMAGE/VIDEO → fails when native_ad.nas_url is missing
    //   OTHER → always displayable → failing 0 (partition check)
    failureGroups: [
      { key: 'IMAGE_VIDEO_NO_NAS', label: 'IMAGE/VIDEO ad with no native_ad.nas_url', query: { terms: { [TYPE]: MEDIA_TYPES } } },
      { key: 'OTHER_DISPLAYABLE', label: 'Other types — should all be displayable', query: { bool: { must_not: [{ terms: { [TYPE]: MEDIA_TYPES } }] } } },
    ],
  },
  sql: {
    dbId: 3,
    database: process.env.NATIVE_DATABASE || 'pasdev_native',
    mainTable: 'native_ad',
    mediaTable: 'native_ad_variants',
    fkColumn: 'native_ad_id',
    contentColumn: 'image_url',
    mediaRequiredTypes: ['IMAGE', 'VIDEO'], // other native types have no media by design → healthy
    goodMediaExpr: `(image_url IS NOT NULL AND image_url <> ''
      AND image_url NOT LIKE '%bydefault%'
      AND image_url NOT LIKE '%DefaultImage%'
      AND image_url NOT LIKE '%pasimage%'
      AND image_url NOT LIKE '%pasvideo%')`,
    unusableDesc: 'missing / a default or legacy non-NAS path (bydefault/DefaultImage/pasimage/pasvideo)',
  },
});
