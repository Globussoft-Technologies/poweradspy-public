/**
 * Reddit Unhealthy-Ads Audit — interactive CLI.
 *
 *     cd admin_panel_backend
 *     node diagnostics/reddit-ads-audit.js
 *
 * Thin config wrapper over diagnostics/lib/ads-audit-core.js (the shared engine).
 * READ-ONLY; delete is hard-disabled in the core. See that file for flags
 * (--run / --samples / --timeout / --noDup / --dupPageSize).
 *
 * Reddit specifics (verified against pas_node_api reddit adSearchController + insertion):
 *   • ES index / es_id   : REDDIT_INDEX (reddit_search_mix) on es_id 1 (DEV forces 0).
 *                          doc id = reddit_ad.id (search does NOT collapse). type = reddit_ad.type.
 *   • Displayable filter : IMAGE needs new_nas_image_url (exists-only); VIDEO needs `Thumbnail`
 *                          (capital T) exists AND not a blocked path (pasvideo/pasimage/bydefault);
 *                          other types pass. VIDEO's blocked-value rule → subtract-displayable.
 *   • SQL media model    : both IMAGE and VIDEO store their NAS media (image / video thumbnail)
 *                          in reddit_ad_variants.image_url (set on upload, else NULL). One column
 *                          covers both → mediaRequiredTypes IMAGE/VIDEO; exclude default/legacy
 *                          paths. (reddit_ad_image_video is carousel-only, NOT the media source.)
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { runAuditCli } = require('./lib/ads-audit-core');
const { getDisplayableMediaFilter } = require('../utils/displayable-media-filters');
const { nasGoodMediaExpr } = require('./lib/media-good-expr');

const TYPE = 'reddit_ad.type.keyword';
const MEDIA_TYPES = ['IMAGE', 'VIDEO'];

runAuditCli({
  network: 'reddit',
  reportPrefix: 'reddit-audit',
  es: {
    index: process.env.REDDIT_INDEX || 'reddit_search_mix',
    esId: 1,
    idField: 'reddit_ad.id',
    displayableFilter: getDisplayableMediaFilter('reddit'),
    backfillFields: { IMAGE: 'new_nas_image_url', VIDEO: 'Thumbnail' }, // both from SQL reddit_ad_variants.image_url
    sampleSource: ['reddit_ad.id', 'reddit_ad.type', 'reddit_ad.last_seen', 'new_nas_image_url', 'Thumbnail'],
    typeBuckets: [
      { label: 'IMAGE', query: { term: { [TYPE]: 'IMAGE' } } },
      { label: 'VIDEO', query: { term: { [TYPE]: 'VIDEO' } } },
    ],
    // Partition all docs; failing = group − (group ∧ displayable):
    //   IMAGE → fails on missing new_nas_image_url
    //   VIDEO → fails on missing/blocked Thumbnail
    //   OTHER → always displayable → failing 0 (partition check)
    failureGroups: [
      { key: 'IMAGE_NO_IMAGE', label: 'IMAGE ad with no new_nas_image_url', query: { term: { [TYPE]: 'IMAGE' } } },
      { key: 'VIDEO_BAD_THUMB', label: 'VIDEO ad with missing/blocked Thumbnail', query: { term: { [TYPE]: 'VIDEO' } } },
      { key: 'OTHER_DISPLAYABLE', label: 'Other types — should all be displayable', query: { bool: { must_not: [{ terms: { [TYPE]: MEDIA_TYPES } }] } } },
    ],
  },
  sql: {
    dbId: 4,
    database: process.env.REDDIT_DATABASE || 'pasdev_reddit',
    mainTable: 'reddit_ad',
    mediaTable: 'reddit_ad_variants',
    fkColumn: 'reddit_ad_id',
    contentColumn: 'image_url',
    mediaRequiredTypes: ['IMAGE', 'VIDEO'],
    goodMediaExpr: nasGoodMediaExpr('image_url'), // allowlist of real NAS prefixes, not a blocklist
    unusableDesc: 'missing / not a real NAS media path (legacy pasimages/pasvideos, test/asset paths, raw CDN, default, null)',
  },
});
