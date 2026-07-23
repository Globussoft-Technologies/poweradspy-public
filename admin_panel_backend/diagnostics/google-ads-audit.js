/**
 * Google Unhealthy-Ads Audit — interactive CLI.
 *
 *     cd admin_panel_backend
 *     node diagnostics/google-ads-audit.js
 *
 * Thin config wrapper over diagnostics/lib/ads-audit-core.js (the shared engine).
 * READ-ONLY; delete is hard-disabled in the core. See that file for flags
 * (--run / --samples / --timeout / --noDup / --dupPageSize).
 *
 * Google specifics (verified against pas_node_api google adSearchController + insertion):
 *   • ES index / es_id   : GT_INDEX (google_ads_data_v2) on es_id 4 (DEV forces 0).
 *                          FLAT index — doc id field is `id` (the COLLAPSE field, so
 *                          the search inflates hits.total with duplicates and uses a
 *                          cardinality agg). The dup scan groups by `id`. Type = `type`.
 *   • Displayable filter : non-displayable = (type=IMAGE with missing/empty
 *                          new_nas_image_url) OR (type=ORGANIC SEARCH). Exists/non-empty
 *                          only (no blocked-value wildcards). Failure breakdown uses the
 *                          subtract-displayable model so it sums exactly.
 *   • Types              : exactly IMAGE, TEXT, ORGANIC SEARCH (insertion validate.js).
 *   • SQL media model    : Google is mostly TEXT (no image by design). Only IMAGE ads
 *                          carry media → mediaRequiredTypes = ['IMAGE']; TEXT/ORGANIC are
 *                          counted healthy. Image lives in google_text_ad_variants.image_url
 *                          (NAS path; placeholders /bydefault_ads.jpg, /DefaultImage.jpg) —
 *                          NOT a <net>_ad_image_video table. Cross-check: SQL IMAGE-unhealthy
 *                          ≈ the ES IMAGE failure group (ORGANIC SEARCH is an ES category
 *                          exclusion, not a SQL media defect, so it's not in the SQL number).
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { runAuditCli } = require('./lib/ads-audit-core');
const { getDisplayableMediaFilter } = require('../utils/displayable-media-filters');
const { nasGoodMediaExpr } = require('./lib/media-good-expr');

// Mirror the displayable filter's exact type predicates (works whether `type` is
// keyword or text): IMAGE via term, ORGANIC SEARCH via match_phrase (it has a space).
const Q_IMAGE = { term: { type: 'IMAGE' } };
const Q_ORGANIC = { match_phrase: { type: 'ORGANIC SEARCH' } };
const Q_TEXT = { term: { type: 'TEXT' } };

runAuditCli({
  network: 'google',
  reportPrefix: 'google-audit',
  es: {
    index: process.env.GT_INDEX || 'google_ads_data_v2',
    esId: 4,
    idField: 'id',
    displayableFilter: getDisplayableMediaFilter('google'),
    backfillFields: { IMAGE: 'new_nas_image_url' }, // only IMAGE gates on media (TEXT/ORGANIC have none)
    sampleSource: ['id', 'type', 'last_seen', 'new_nas_image_url'],
    typeBuckets: [
      { label: 'IMAGE',          query: Q_IMAGE },
      { label: 'TEXT',           query: Q_TEXT },
      { label: 'ORGANIC SEARCH', query: Q_ORGANIC },
    ],
    // Disjoint groups partitioning ALL docs. failing = group − (group ∧ displayable):
    //   IMAGE   → fails when new_nas_image_url is missing/empty
    //   ORGANIC → always non-displayable (excluded by the filter)
    //   OTHER (TEXT, …) → always displayable → failing 0 (partition check)
    failureGroups: [
      { key: 'IMAGE_NO_IMAGE',  label: 'IMAGE ad with missing/empty new_nas_image_url', query: Q_IMAGE },
      { key: 'ORGANIC_SEARCH',  label: 'ORGANIC SEARCH (excluded — not a paid ad)',     query: Q_ORGANIC },
      { key: 'OTHER_DISPLAYABLE', label: 'Other types (TEXT, …) — should all be displayable',
        query: { bool: { must_not: [Q_IMAGE, Q_ORGANIC] } } },
    ],
  },
  sql: {
    dbId: 9,
    database: process.env.GT_DATABASE || 'pasdev_gtext',
    mainTable: 'google_text_ad',
    // Google image media is the variant's image_url (NAS path), only for IMAGE ads.
    mediaTable: 'google_text_ad_variants',
    fkColumn: 'google_text_ad_id',
    contentColumn: 'image_url',
    mediaRequiredTypes: ['IMAGE'], // TEXT / ORGANIC SEARCH have no image by design → healthy
    // "Good" = a real NAS image. Most google IMAGE ads carry only a LEGACY
    // `pasimages/gtext/ads/...` path (the UI hides it; it has no ES new_nas_image_url),
    // so excluding pasimage/pasvideo is essential — without it the legacy paths would
    // wrongly count as healthy. Verified: with these exclusions, SQL IMAGE-unhealthy
    // (~5,440) matches the ES IMAGE failure group (5,442).
    goodMediaExpr: nasGoodMediaExpr('image_url'), // allowlist of real NAS prefixes, not a blocklist
    unusableDesc: 'missing / not a real NAS media path (legacy pasimages, test/asset paths, raw CDN, default, null)',
  },
});
