/**
 * LinkedIn Unhealthy-Ads Audit — interactive CLI.
 *
 *     cd admin_panel_backend
 *     node diagnostics/linkedin-ads-audit.js
 *
 * Thin config wrapper over diagnostics/lib/ads-audit-core.js (the shared engine).
 * READ-ONLY; delete is hard-disabled in the core. See that file for flags
 * (--run / --samples / --timeout / --noDup / --dupPageSize).
 *
 * LinkedIn specifics (verified against pas_node_api linkedin adSearchController + insertion):
 *   • ES index / es_id   : LINKEDIN_INDEX (linkedin_ads_data) on es_id 1 (DEV forces 0).
 *                          FLAT index. The ad id is the ES doc _id = internal linkedin_ad.id,
 *                          mirrored in the `ad_id` source field (esColumns). The search
 *                          hydrates by _id (upsert-keyed), so duplicates are structurally
 *                          impossible — the dup scan groups by the aggregatable `ad_id`
 *                          field and should confirm 0 (an integrity check). type = ad_type.
 *   • Displayable filter : IMAGE needs new_nas_image_url, VIDEO needs ad_video — both with
 *                          blocked-value wildcards (pasimage/pasvideo/bydefault/DefaultImage);
 *                          other types pass. Blocked-value rules → subtract-displayable
 *                          failureGroups (exact).
 *   • SQL media model    : BOTH IMAGE and VIDEO store their media (NAS path / video thumbnail)
 *                          in linkedin_ad_variants.image_url (set on upload, else NULL).
 *                          So one SQL column covers both → mediaRequiredTypes IMAGE/VIDEO,
 *                          contentColumn image_url, exclude default/legacy paths. (The ES
 *                          ad_video field is the same uploaded thumbnail; linkedin_ad_image_video
 *                          is carousel-only, like youtube — NOT the media source.)
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { runAuditCli } = require('./lib/ads-audit-core');
const { getDisplayableMediaFilter } = require('../utils/displayable-media-filters');
const { nasGoodMediaExpr } = require('./lib/media-good-expr');

const TYPE = 'ad_type.keyword';
const MEDIA_TYPES = ['IMAGE', 'VIDEO'];

runAuditCli({
  network: 'linkedin',
  reportPrefix: 'linkedin-audit',
  es: {
    index: process.env.LINKEDIN_INDEX || 'linkedin_ads_data',
    esId: 1,
    idField: 'ad_id', // _source mirror of the _id (internal linkedin_ad.id); aggregatable
    displayableFilter: getDisplayableMediaFilter('linkedin'),
    backfillFields: { IMAGE: 'new_nas_image_url', VIDEO: 'ad_video' }, // both from SQL linkedin_ad_variants.image_url
    sampleSource: ['ad_id', 'ad_type', 'last_seen', 'new_nas_image_url', 'ad_video'],
    typeBuckets: [
      { label: 'IMAGE', query: { term: { [TYPE]: 'IMAGE' } } },
      { label: 'VIDEO', query: { term: { [TYPE]: 'VIDEO' } } },
    ],
    // Partition all docs; failing = group − (group ∧ displayable):
    //   IMAGE → fails on missing/blocked new_nas_image_url
    //   VIDEO → fails on missing/blocked ad_video
    //   OTHER → always displayable → failing 0 (partition check)
    failureGroups: [
      { key: 'IMAGE_BAD_IMAGE', label: 'IMAGE ad with missing/blocked new_nas_image_url', query: { term: { [TYPE]: 'IMAGE' } } },
      { key: 'VIDEO_BAD_VIDEO', label: 'VIDEO ad with missing/blocked ad_video', query: { term: { [TYPE]: 'VIDEO' } } },
      { key: 'OTHER_DISPLAYABLE', label: 'Other types — should all be displayable', query: { bool: { must_not: [{ terms: { [TYPE]: MEDIA_TYPES } }] } } },
    ],
  },
  sql: {
    dbId: 2,
    database: process.env.LINKEDIN_DATABASE || 'pasdev_linkedin',
    mainTable: 'linkedin_ad',
    mediaTable: 'linkedin_ad_variants',
    fkColumn: 'linkedin_ad_id',
    contentColumn: 'image_url',
    mediaRequiredTypes: ['IMAGE', 'VIDEO'], // other linkedin types have no media by design → healthy
    goodMediaExpr: nasGoodMediaExpr('image_url'), // allowlist of real NAS prefixes, not a blocklist
    unusableDesc: 'missing / not a real NAS media path (legacy pasimages/pasvideos, test/asset paths, raw CDN, default, null)',
  },
});
