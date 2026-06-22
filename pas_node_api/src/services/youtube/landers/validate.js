'use strict';

/**
 * YouTube landers — insert_html_content validation.
 *
 * Faithful port of the Laravel validator in BlackhatControllerYoutube@inserHtmlContentToDB:
 *   required: ad_id, destinations, screen_shot, status, crawled_by(in .net,python)
 *   present|nullable: country_iso, html_path, html_content, domain_registered_date
 *
 * Returns the first error message (string), or null when valid.
 */

// html_path & domain_registered_date are OPTIONAL (may be omitted or null).
const REQUIRED = ['ad_id', 'destinations', 'screen_shot', 'status'];
const PRESENT = ['country_iso', 'html_content'];

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
