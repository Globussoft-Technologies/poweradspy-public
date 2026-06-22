'use strict';

/**
 * LinkedIn landers — insert_html_lander validation.
 *
 * Same shape as youtube/landers/validate.js. Faithful port of the Laravel validator in
 * api_linkedin BlackhatController@inserHtmlContentToDB:
 *   required: ad_id, country_iso, destinations, html_path, screen_shot, html_content, status
 *   present|nullable: domain_registered_date
 *   crawled_by: required|in:.net,python
 *
 * Returns the first error message (string), or null when valid.
 */

// html_path & domain_registered_date are OPTIONAL (may be omitted or null).
const REQUIRED = ['ad_id', 'country_iso', 'destinations', 'screen_shot', 'html_content', 'status'];
const PRESENT = [];

function validate(v) {
  if (v === null || typeof v !== 'object') return 'The insert data is invalid.';
  for (const k of REQUIRED) {
    if (v[k] === undefined || v[k] === null || v[k] === '') return `The ${k} field is required.`;
  }
  for (const k of PRESENT) {
    if (!(k in v)) return `The ${k} field must be present.`;
  }
  if (v.crawled_by !== '.net' && v.crawled_by !== 'python') return 'The selected crawled by is invalid.';
  return null;
}

module.exports = { validate };
