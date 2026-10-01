'use strict';

/**
 * chatgpt_search_mix column template.
 *
 * Unlike facebook's esColumns.js (dotted "table.field" entries, because of how the old PHP
 * body-builder worked), these are FLAT — matching chatgpt_search_mix.mapping.json's
 * deliberately flat field-name design (see MANIFEST.md §4: avoids the whole
 * dotted-key-vs-nested-object ambiguity class of bug seen elsewhere in this codebase).
 * Each entry here is both the `getJoinedAd` row property name AND the final ES field name —
 * no rewriting needed in esDocBuilder.js.
 */
const CHATGPTADS_COLUMNS = [
  'id', 'ad_id', 'uid', 'type', 'platform', 'network', 'ad_position', 'country', 'domain',
  'version', 'post_date', 'first_seen', 'last_seen', 'days_running', 'hits', 'status',
  'destination_url', 'ad_title', 'ad_text', 'newsfeed_description',
  'post_owner_name', 'post_owner_lower',
  'html', // synthetic — see esDocBuilder.js
];

module.exports = { CHATGPTADS_COLUMNS };
