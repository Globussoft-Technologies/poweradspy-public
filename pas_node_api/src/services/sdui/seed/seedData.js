'use strict';

// ── SDUI config — hardcoded arrangement ──────────────────────────────────────
// The full, correct arrangement of every SDUI config document (searchbar +
// navbar + sidebar) lives in ./sduiConfig.json. It is the single source of
// truth for the seeded spec — ranks, options, values, and platform
// applicability. Edit that JSON to change the arrangement.
//
// Note on `category`: its options are also synced dynamically at runtime via
// POST /internal/category/sync. The seeder preserves any existing options on
// re-seed (see seeder.js), so the values hardcoded here are only used on a
// fresh database that has never been synced.
const documents = require('./sduiConfig.json');

/**
 * Build all SDUI config documents.
 * Returns a deep clone so the seeder can safely mutate the result
 * (e.g. restore dynamically-synced category options) without corrupting the
 * cached require() copy on subsequent calls.
 */
function buildSDUIDocuments() {
  return JSON.parse(JSON.stringify(documents));
}

module.exports = { buildSDUIDocuments };
