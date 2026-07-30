'use strict';

/**
 * ONE-TIME MIGRATION: Replace the Ecommerce Platform filter options in the
 * live SDUI config with the values that actually exist in the ad data.
 *
 * This script ONLY rewrites `ecommerce_platform_filter.options` — it does NOT
 * drop or re-seed anything. Safe to run on a live database.
 *
 * Bug it fixes: the seeded option list carried three values the crawler never
 * produces (`opencart`, `salesforce_commerce`, `custom`) and was missing three
 * it does (`demandware`, `volusion`, `_3dcart`). Ads whose Ad Analytics page
 * showed e.g. "Volusion" therefore had no option to filter by — searching
 * "Volusion" in the sidebar returned nothing, because that search box filters
 * the SDUI option list client-side (see FilterCheckboxList.jsx).
 *
 * The values below are the complete distinct set of the ecommerce-platform
 * field across all ten networks' indices (verified 2026-07-30 on the dev ES:
 * `*_ad_meta_data.built_with` for facebook/instagram/gdn/native/pinterest/
 * quora/reddit, flat `ecommerce_platform` for youtube/linkedin, and
 * `built_with` for google). Lowercase is safe everywhere: the seven
 * `*_search_mix` indices plus youtube/linkedin query it with `match` on an
 * analyzed `text` field, and google's `built_with` is a `keyword` with a
 * `lowercase_normalizer`.
 *
 * NOTE on `_3dcart`: the leading underscore is REQUIRED. The stored value is
 * `_3DCart` and the standard analyzer keeps the underscore (UAX#29 treats it
 * as ExtendNumLet), so the token is `_3dcart` — a plain `3dcart` matches
 * 0 docs on every network.
 *
 * Usage:  node src/services/sdui/seed/migrate_fix_ecommerce_platform_options.js
 */

const { getDB, closeDB } = require('../db');

const ECOMMERCE_PLATFORM_OPTIONS = [
  { _id: 'ep_shopify',     label: 'Shopify',     value: 'shopify' },
  { _id: 'ep_woocommerce', label: 'WooCommerce', value: 'woocommerce' },
  { _id: 'ep_wix',         label: 'Wix',         value: 'wix' },
  { _id: 'ep_magento',     label: 'Magento',     value: 'magento' },
  { _id: 'ep_squarespace', label: 'Squarespace', value: 'squarespace' },
  { _id: 'ep_demandware',  label: 'Demandware',  value: 'demandware' },
  { _id: 'ep_bigcommerce', label: 'BigCommerce', value: 'bigcommerce' },
  { _id: 'ep_volusion',    label: 'Volusion',    value: 'volusion' },
  { _id: 'ep_3dcart',      label: '3dCart',      value: '_3dcart' },
  { _id: 'ep_prestashop',  label: 'PrestaShop',  value: 'prestashop' },
].map((o, i) => ({
  ...o,
  filter_id: 'ecommerce_platform_filter',
  rank: i + 1,
  selected_by_default: false,
  platform_applicability: 'all',
}));

async function migrate() {
  const db = await getDB();
  const col = db.collection('sdui_config');

  console.log('\n🚀 Fixing Ecommerce Platform filter options...\n');

  const doc = await col.findOne({ _id: 'ecommerce_platform' });
  if (!doc) {
    console.log('  ❌ ecommerce_platform doc NOT found — nothing to migrate');
    return;
  }

  const filterIdx = (doc.filters || []).findIndex(
    f => f._id === 'ecommerce_platform_filter'
  );
  if (filterIdx === -1) {
    console.log('  ❌ ecommerce_platform_filter NOT found in doc — skipped');
    return;
  }

  const before = (doc.filters[filterIdx].options || []).map(o => o.value);
  const after = ECOMMERCE_PLATFORM_OPTIONS.map(o => o.value);
  console.log(`  before: ${before.join(', ') || '(none)'}`);
  console.log(`  after:  ${after.join(', ')}`);

  const removed = before.filter(v => !after.includes(v));
  const added = after.filter(v => !before.includes(v));
  console.log(`  removed (no such value in any index): ${removed.join(', ') || '(none)'}`);
  console.log(`  added (present in the data):          ${added.join(', ') || '(none)'}`);

  const res = await col.updateOne(
    { _id: 'ecommerce_platform' },
    { $set: { [`filters.${filterIdx}.options`]: ECOMMERCE_PLATFORM_OPTIONS } }
  );

  if (res.modifiedCount > 0) {
    console.log(`\n  ✅ options replaced (${ECOMMERCE_PLATFORM_OPTIONS.length} values)`);
  } else {
    console.log('\n  ⚠️  options already up to date — nothing changed');
  }

  console.log('\n🎉 Ecommerce Platform options migration complete!\n');
}

// Run if called directly
if (require.main === module) {
  migrate()
    .then(() => closeDB())
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Migration failed:', err.message);
      closeDB().then(() => process.exit(1));
    });
} else {
  module.exports = { migrate, ECOMMERCE_PLATFORM_OPTIONS };
}
