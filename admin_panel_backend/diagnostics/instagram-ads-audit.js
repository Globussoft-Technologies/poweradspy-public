/**
 * Instagram Unhealthy-Ads Audit — interactive CLI.
 *
 *     cd admin_panel_backend
 *     node diagnostics/instagram-ads-audit.js
 *
 * Thin config wrapper over diagnostics/lib/ads-audit-core.js (the shared engine,
 * generalized from the facebook audit). READ-ONLY; delete is hard-disabled in the
 * core. See that file for flags (--run / --samples / --timeout / --noDup / --dupPageSize).
 *
 * Instagram specifics (verified against pas_node_api instagram adSearchController):
 *   • ES id field        : instagram_ad.id  (search does NOT collapse → a duplicate
 *                          would actually render as a dupe card)
 *   • ES index / es_id   : INSTA_INDEX on es_id 3 (DEV forces es_id 0)
 *   • Types              : IMAGE, VIDEO, STORIES. Displayable = IMAGE/STORIES need
 *                          new_nas_image_url, VIDEO needs `thumbnail` (lowercase).
 *   • SQL media model    : instagram_ad_image_video.ad_image_video (FK instagram_ad_id)
 *                          — structurally identical to facebook_ad_image_video.
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { runAuditCli } = require('./lib/ads-audit-core');
const { getDisplayableMediaFilter } = require('../utils/displayable-media-filters');
const { nasGoodMediaExpr } = require('./lib/media-good-expr');

const TYPE = 'instagram_ad.type.keyword';

runAuditCli({
  network: 'instagram',
  reportPrefix: 'instagram-audit',
  es: {
    index: process.env.INSTA_INDEX || 'instagram_search_mix',
    esId: 3,
    idField: 'instagram_ad.id',
    displayableFilter: getDisplayableMediaFilter('instagram'),
    // Backfill target: the ES field the displayable filter checks per type. A
    // non-displayable ad with a GOOD SQL image_url can be flipped by writing it here.
    backfillFields: { IMAGE: 'new_nas_image_url', STORIES: 'new_nas_image_url', VIDEO: 'thumbnail' },
    sampleSource: [
      'instagram_ad.id', 'instagram_ad.type', 'instagram_ad.last_seen',
      'new_nas_image_url', 'thumbnail', 'instagram_ad_url.url',
    ],
    typeBuckets: [
      { label: 'IMAGE',   query: { term: { [TYPE]: 'IMAGE' } } },
      { label: 'VIDEO',   query: { term: { [TYPE]: 'VIDEO' } } },
      { label: 'STORIES', query: { term: { [TYPE]: 'STORIES' } } },
    ],
    // Negation of each displayable branch — the two ways an Instagram ad fails.
    mediaFactors: [
      {
        key: 'IMAGE_STORIES_NO_IMAGE',
        label: 'IMAGE/STORIES ad with no new_nas_image_url',
        query: { bool: { filter: [{ terms: { [TYPE]: ['IMAGE', 'STORIES'] } }], must_not: [{ exists: { field: 'new_nas_image_url' } }] } },
      },
      {
        key: 'VIDEO_NO_THUMBNAIL',
        label: 'VIDEO ad with no thumbnail',
        query: { bool: { filter: [{ term: { [TYPE]: 'VIDEO' } }], must_not: [{ exists: { field: 'thumbnail' } }] } },
      },
    ],
  },
  sql: {
    dbId: 8,
    database: process.env.INSTA_DATABASE || 'pasdev_instagram',
    mainTable: 'instagram_ad',
    // Media source-of-truth is the VARIANT image — that's what ES new_nas_image_url
    // (IMAGE/STORIES) and thumbnail (VIDEO) are derived from at insert
    // (updateVariantByAdId({ image_url }) → new_nas_image_url = its NAS path).
    // NOT instagram_ad_image_video: that's the sparse carousel/"otherMedia" field
    // (~91% of ads have no row there), so it wildly over-reported missing media.
    mediaTable: 'instagram_ad_variants',
    fkColumn: 'instagram_ad_id',
    contentColumn: 'image_url',
    mediaRequiredTypes: ['IMAGE', 'VIDEO', 'STORIES'], // other types pass the ES filter → healthy
    // Good = a real NAS media path (allowlist), not just "not a known-bad string".
    goodMediaExpr: nasGoodMediaExpr('image_url'),
    unusableDesc: 'missing / not a real NAS media path (legacy pasimages, test/asset paths, raw CDN, default, null)',
  },
});
