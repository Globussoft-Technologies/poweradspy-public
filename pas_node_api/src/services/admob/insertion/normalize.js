'use strict';

function nullable(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function mysqlDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = typeof value === 'number' || /^\d+$/.test(String(value))
    ? new Date(Number(value) * (Number(value) < 100000000000 ? 1000 : 1))
    : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

// mob_ads has always stored ad_position/ad_sub_position as UPPERCASE
// ('TOP', 'BOTTOM', 'MIDDLE') and ad_image_size as 'WIDTHxHEIGHT' joined by
// '*' with no spaces — sduiService's filter-option queries rely on that
// consistency to GROUP BY the raw column directly (no LOWER/TRIM) so MySQL
// can satisfy the grouping straight from an index instead of a temp table.
// Coercing to that same canonical form here, once, keeps every future insert
// matching what's already on disk instead of relying on the upstream payload
// happening to arrive pre-normalized.
function canonicalPosition(value) {
  const text = nullable(value);
  return text ? text.toUpperCase() : null;
}

function canonicalImageSize(value) {
  const text = nullable(value);
  if (!text) return null;
  return text.replace(/×/g, 'x').replace(/\*/g, 'x').replace(/\s+/g, '').replace(/x/g, '*');
}

function normalizeAdmobPayload(payload) {
  const destinationUrl = nullable(payload.destination_url);
  let destinationHost = null;
  try { destinationHost = destinationUrl ? new URL(destinationUrl).hostname.toLowerCase() : null; } catch { /* validated earlier */ }

  return {
    ad_id: String(payload.ad_id).trim(),
    ad_image_size: canonicalImageSize(payload.ad_image_size),
    ad_number_position: payload.ad_number_position === null || payload.ad_number_position === undefined || payload.ad_number_position === '' ? null : Number(payload.ad_number_position),
    ad_position: canonicalPosition(payload.ad_position),
    ad_sub_position: canonicalPosition(payload.ad_sub_position),
    ad_text: nullable(payload.ad_text),
    ad_title: nullable(payload.ad_title),
    ad_url: nullable(payload.ad_url),
    city: nullable(payload.city),
    country: payload.country.map((value) => String(value).trim()),
    destination_url: destinationUrl,
    destination_host: destinationHost,
    first_seen: mysqlDate(payload.first_seen),
    image_url_original: nullable(payload.image_url_original),
    ip_address: nullable(payload.ip_address),
    last_seen: mysqlDate(payload.last_seen),
    network: 'mob-network',
    sub_network: nullable(payload.sub_network),
    newsfeed_description: nullable(payload.newsfeed_description),
    placement_url: nullable(payload.placement_url),
    platform: 19,
    post_date: mysqlDate(payload.post_date),
    post_owner: nullable(payload.post_owner),
    post_owner_image: nullable(payload.post_owner_image),
    redirect_url: nullable(payload.redirect_url),
    source: String(payload.source).trim().toLowerCase(),
    session_id: String(payload.session_id || '').trim(),
    state: nullable(payload.state),
    system_id: String(payload.system_id).trim(),
    target_site: nullable(payload.target_site),
    type: String(payload.type).trim().toUpperCase(),
    version: nullable(payload.version),
    source_app: String(payload.source_app).trim(),
    source_app_pkg: nullable(payload.source_app_pkg) || '',
  };
}

module.exports = { mysqlDate, normalizeAdmobPayload };
