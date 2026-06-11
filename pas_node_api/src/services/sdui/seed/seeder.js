'use strict';

const { getDB } = require('../db');
const { buildSDUIDocuments } = require('./seedData');
const logger = require('../../../logger');

const log = logger.createChild('sdui-seeder');

/**
 * Seed the pas_ui database with SDUI config documents.
 * Drops and re-seeds sdui_config so the spec is the single source of truth.
 * All filter configuration is embedded inside sdui_config documents.
 */
async function seedDatabase() {
  const db = await getDB();

  // Preserve dynamically-synced category options before drop.
  // These are written by the /internal/category/sync endpoint whenever
  // the GDN existQuery inserts/updates the master category ES index.
  let preservedCategoryOptions = [];
  try {
    const existingCatDoc = await db.collection('sdui_config').findOne({ _id: 'category' });
    if (existingCatDoc?.filters?.[0]?.options?.length > 0) {
      preservedCategoryOptions = existingCatDoc.filters[0].options;
    }
  } catch (_) {}

  // ── Seed SDUI config (always drop + re-seed) ──────────────────────────────
  await db.collection('sdui_config').drop().catch(() => {}); // ignore if not exists
  const docs = buildSDUIDocuments();

  // Restore preserved category options so a server restart never wipes them
  if (preservedCategoryOptions.length > 0) {
    const catDoc = docs.find(d => d._id === 'category');
    if (catDoc?.filters?.[0]) {
      catDoc.filters[0].options = preservedCategoryOptions;
    }
  }

  await db.collection('sdui_config').insertMany(docs);
  log.info(`sdui_config seeded: ${docs.length} documents`);
}

module.exports = { seedDatabase };
