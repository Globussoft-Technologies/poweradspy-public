'use strict';


/**
 * ONE-TIME MIGRATION: Add TikTok platform to existing SDUI config in MongoDB.
 * 
 * This script ONLY adds TikTok — it does NOT drop or re-seed anything.
 * Safe to run on a live database with existing data.
 * 
 * What it does:
 *   1. Adds 'tiktok' to platform_filter_matrix in the 'platforms' navbar doc
 *   2. Adds TikTok option to the platform_selector filter options
 *   3. Adds 'tiktok' to platform_applicability for Image & Video ad types
 * 
 * Usage:  node src/services/sdui/seed/migrate_add_tiktok.js
 */

const { getDB, closeDB } = require('../db');


const TIKTOK_PLATFORM_OPTION = {
  _id: 'tt',
  filter_id: 'platform_selector',
  label: 'TT',
  value: 'tiktok',
  rank: 11,
  selected_by_default: true,
  icon_url: 'https://img.icons8.com/?size=100&id=118640&format=png',
  icon_type: 'url',
};

const TIKTOK_FILTER_MATRIX = [
  'category', 'engagement', 'cta', 'ad_type', 'language',
  'country', 'state', 'city', 'ecommerce_platform', 'funnel',
  'marketing_platform', 'source', 'affiliate_network', 'search_by_image',
];

async function migrate() {
  const db = await getDB();
  const col = db.collection('sdui_config');

  console.log('\n🚀 Starting TikTok migration...\n');

  // ──────────────────────────────────────────────────────────────
  // 1. Add tiktok to the platform_filter_matrix in 'platforms' doc
  // ──────────────────────────────────────────────────────────────
  const pfmResult = await col.updateOne(
    { _id: 'platforms' },
    { $set: { 'filters.0.platform_filter_matrix.tiktok': TIKTOK_FILTER_MATRIX } }
  );
  if (pfmResult.modifiedCount > 0) {
    console.log('  ✅ [1/4] platform_filter_matrix.tiktok added');
  } else if (pfmResult.matchedCount > 0) {
    console.log('  ⚠️  [1/4] platforms doc found but not modified (tiktok may already exist)');
  } else {
    console.log('  ❌ [1/4] platforms doc NOT found — skipped');
  }

  // ──────────────────────────────────────────────────────────────
  // 2. Add TikTok option to platform_selector filter options
  //    (only if 'tt' option doesn't already exist)
  // ──────────────────────────────────────────────────────────────
  const optResult = await col.updateOne(
    {
      _id: 'platforms',
      'filters.0.options._id': { $ne: 'tt' },  // guard: don't add if already there
    },
    { $push: { 'filters.0.options': TIKTOK_PLATFORM_OPTION } }
  );
  if (optResult.modifiedCount > 0) {
    console.log('  ✅ [2/4] TikTok option (tt) added to platform_selector');
  } else {
    console.log('  ⚠️  [2/4] TikTok option already exists or platforms doc not found — skipped');
  }

  // ──────────────────────────────────────────────────────────────
  // 3. Add 'tiktok' to Image ad type platform_applicability
  //    (only if not already present)
  // ──────────────────────────────────────────────────────────────
  const imgResult = await col.updateOne(
    {
      _id: 'ad_type',
      'filters.options': {
        $elemMatch: { _id: 'at_image', platform_applicability: { $nin: ['tiktok'] } }
      }
    },
    { $addToSet: { 'filters.$[f].options.$[o].platform_applicability': 'tiktok' } },
    {
      arrayFilters: [
        { 'f._id': 'ad_types' },
        { 'o._id': 'at_image' },
      ]
    }
  );
  if (imgResult.modifiedCount > 0) {
    console.log('  ✅ [3/4] tiktok added to Image ad type platform_applicability');
  } else {
    console.log('  ⚠️  [3/4] Image ad type already has tiktok or doc not found — skipped');
  }

  // ──────────────────────────────────────────────────────────────
  // 4. Add 'tiktok' to Video ad type platform_applicability
  //    (only if not already present)
  // ──────────────────────────────────────────────────────────────
  const vidResult = await col.updateOne(
    {
      _id: 'ad_type',
      'filters.options': {
        $elemMatch: { _id: 'at_video', platform_applicability: { $nin: ['tiktok'] } }
      }
    },
    { $addToSet: { 'filters.$[f].options.$[o].platform_applicability': 'tiktok' } },
    {
      arrayFilters: [
        { 'f._id': 'ad_types' },
        { 'o._id': 'at_video' },
      ]
    }
  );
  if (vidResult.modifiedCount > 0) {
    console.log('  ✅ [4/4] tiktok added to Video ad type platform_applicability');
  } else {
    console.log('  ⚠️  [4/4] Video ad type already has tiktok or doc not found — skipped');
  }

  console.log('\n🎉 TikTok migration complete!\n');
}

// Run if called directly: node migrate_add_tiktok.js
if (require.main === module) {
  migrate()
    .then(() => closeDB())
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Migration failed:', err.message);
      closeDB().then(() => process.exit(1));
    });
} else {
  module.exports = { migrate };
}
