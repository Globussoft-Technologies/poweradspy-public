'use strict';

/**
 * Lazy-loaded ISO language code → name lookup.
 * Loaded once from the `languages` SQL table on first call,
 * then cached in-process forever.
 *
 * Table schema expected: { iso: 'EN', name: 'English' }
 * lang_detect in ES stores lowercase codes e.g. 'en', 'fr'
 * so we normalise to uppercase before lookup.
 */

let _map = null;      // Map<string, string>  e.g. 'EN' → 'English'
let _loading = null;  // in-flight Promise so concurrent calls don't double-query

async function getLanguageMap(sqlDb) {
  if (_map) return _map;

  if (_loading) return _loading;

  _loading = (async () => {
    try {
      const rows = await sqlDb.query('SELECT iso, name FROM languages WHERE iso IS NOT NULL');
      _map = new Map(rows.map(r => [String(r.iso).toUpperCase(), r.name]));
    } catch (err) {
      // If SQL fails, return empty map — language field just stays as-is
      _map = new Map();
    }
    _loading = null;
    return _map;
  })();

  return _loading;
}

/**
 * Resolve a lang_detect code (e.g. 'en') to a language name (e.g. 'English').
 * Falls back to the raw code if not found in the map.
 */
function resolveLanguageName(map, code) {
  if (!code) return null;
  return map.get(String(code).toUpperCase()) || code;
}

module.exports = { getLanguageMap, resolveLanguageName };