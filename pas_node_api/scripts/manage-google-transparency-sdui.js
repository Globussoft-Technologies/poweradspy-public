'use strict';

/**
 * Add or rollback the Google Transparency sidebar SDUI document in MongoDB.
 *
 * Apply:
 *   node scripts/manage-google-transparency-sdui.js --apply
 *
 * Rollback:
 *   node scripts/manage-google-transparency-sdui.js --rollback
 *
 * Status (read-only):
 *   node scripts/manage-google-transparency-sdui.js --status
 */

const { getDB, closeDB } = require('../src/services/sdui/db');
const seedDocuments = require('../src/services/sdui/seed/sduiConfig.json');

const TARGET_ID = 'google_transparency';
const BACKUP_ID = 'google_transparency_sdui_v1';
const BACKUP_COLLECTION = 'sdui_migration_backups';
const targetSpec = seedDocuments.find((doc) => doc._id === TARGET_ID);

if (!targetSpec) {
  throw new Error(`Seed document '${TARGET_ID}' is missing`);
}

async function readState(db) {
  const collection = db.collection('sdui_config');
  const [target, platforms, backup] = await Promise.all([
    collection.findOne({ _id: TARGET_ID }),
    collection.findOne({ _id: 'platforms' }),
    db.collection(BACKUP_COLLECTION).findOne({ _id: BACKUP_ID }),
  ]);
  const platformFilter = platforms?.filters?.find(
    (filter) => filter._id === 'platform_selector',
  );
  return {
    target,
    platforms,
    googleMatrix: platformFilter?.platform_filter_matrix?.google || [],
    backup,
  };
}

async function apply(db) {
  const before = await readState(db);
  if (!before.platforms) throw new Error("SDUI 'platforms' document not found");

  await db.collection(BACKUP_COLLECTION).updateOne(
    { _id: BACKUP_ID },
    {
      $setOnInsert: {
        created_at: new Date(),
        target_existed: Boolean(before.target),
        target_document: before.target || null,
        google_platform_matrix: before.googleMatrix,
      },
      $set: { last_apply_at: new Date() },
    },
    { upsert: true },
  );

  const now = new Date();
  await db.collection('sdui_config').replaceOne(
    { _id: TARGET_ID },
    { ...targetSpec, updated_at: now },
    { upsert: true },
  );
  await db.collection('sdui_config').updateOne(
    { _id: 'platforms' },
    { $addToSet: { 'filters.$[filter].platform_filter_matrix.google': TARGET_ID } },
    { arrayFilters: [{ 'filter._id': 'platform_selector' }] },
  );

  console.log('Google Transparency SDUI filter applied.');
  console.log('Mongo collection: sdui_config');
  console.log(`Document: ${TARGET_ID}`);
  console.log('Google matrix entry added.');
}

async function rollback(db) {
  const state = await readState(db);
  if (!state.backup) {
    throw new Error(`Backup '${BACKUP_ID}' not found; rollback is not safe`);
  }

  const collection = db.collection('sdui_config');
  if (state.backup.target_existed && state.backup.target_document) {
    await collection.replaceOne(
      { _id: TARGET_ID },
      state.backup.target_document,
      { upsert: true },
    );
  } else {
    await collection.deleteOne({ _id: TARGET_ID });
  }

  await collection.updateOne(
    { _id: 'platforms' },
    {
      $set: {
        'filters.$[filter].platform_filter_matrix.google':
          state.backup.google_platform_matrix || [],
      },
    },
    { arrayFilters: [{ 'filter._id': 'platform_selector' }] },
  );
  await db.collection(BACKUP_COLLECTION).updateOne(
    { _id: BACKUP_ID },
    { $set: { last_rollback_at: new Date() } },
  );

  console.log('Google Transparency SDUI filter rolled back.');
}

async function status(db) {
  const state = await readState(db);
  console.log(JSON.stringify({
    document_present: Boolean(state.target),
    google_matrix_enabled: state.googleMatrix.includes(TARGET_ID),
    backup_present: Boolean(state.backup),
    filters: state.target?.filters?.map((filter) => ({
      id: filter._id,
      type: filter.type,
      depends_on: filter.depends_on || null,
      options: filter.options?.map((option) => option.value) || [],
    })) || [],
  }, null, 2));
}

async function main() {
  const mode = process.argv.includes('--apply')
    ? 'apply'
    : process.argv.includes('--rollback')
      ? 'rollback'
      : 'status';
  const db = await getDB();
  if (mode === 'apply') await apply(db);
  else if (mode === 'rollback') await rollback(db);
  else await status(db);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    })
    .finally(() => closeDB());
}

module.exports = { apply, rollback, status, readState };
