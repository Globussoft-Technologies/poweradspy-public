'use strict';

/**
 * Return the hostname from the last literal HTTP(S) URL in a value.
 * Tracking URLs can wrap the final landing URL after a query string, so parsing
 * the whole value would incorrectly return the tracking host.
 */
function getLastUrlHostname(value) {
  if (value === undefined || value === null || String(value).trim() === '') return '';

  const raw = String(value).trim();
  if (/^(?:null|undefined)$/i.test(raw)) return '';
  const protocols = [...raw.matchAll(/https?:\/\//ig)];
  const lastUrl = protocols.length ? raw.slice(protocols[protocols.length - 1].index) : raw;
  const candidate = /^https?:\/\//i.test(lastUrl) ? lastUrl : `http://${lastUrl}`;

  try {
    return new URL(candidate).hostname || '';
  } catch (_) {
    return '';
  }
}

module.exports = { getLastUrlHostname };
