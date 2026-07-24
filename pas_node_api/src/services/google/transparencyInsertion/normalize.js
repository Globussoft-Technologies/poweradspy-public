'use strict';

const UNKNOWN_POST_DATE_SQL = '1000-01-01 00:00:00';

const pad2 = (value) => String(value).padStart(2, '0');

function mysqlDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return [
      value.getFullYear(),
      pad2(value.getMonth() + 1),
      pad2(value.getDate()),
    ].join('-') + ' ' + [
      pad2(value.getHours()),
      pad2(value.getMinutes()),
      pad2(value.getSeconds()),
    ].join(':');
  }
  const sqlLiteral = String(value).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  if (sqlLiteral) return `${sqlLiteral[1]} ${sqlLiteral[2]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function daysRunning(firstSeen, lastSeen) {
  if (!firstSeen || !lastSeen) return 1;
  const diff = new Date(lastSeen).getTime() - new Date(firstSeen).getTime();
  return diff >= 86400000 ? Math.floor(diff / 86400000) + 1 : 1;
}

function extractDomain(value) {
  if (!value) return null;
  try { return new URL(value).hostname.replace(/^www\./i, '').toLowerCase(); }
  catch { return null; }
}

function normalizeTransparencyPayload(payload) {
  const receivedAt = new Date().toISOString();
  const firstSeen = payload.first_seen || payload.post_date || payload.last_seen || receivedAt;
  const lastSeen = payload.last_seen || receivedAt;
  const country = Array.isArray(payload.country) ? payload.country : [];
  const countryDetails = Array.isArray(payload.country_details) ? payload.country_details : [];
  const othermultimedia = Array.isArray(payload.othermultimedia) ? payload.othermultimedia : [];
  const suppliedPostDateSql = mysqlDateTime(payload.post_date);
  return {
    ...payload,
    advertiser_id: payload.advertiser_id ?? null,
    ad_url: payload.ad_url ?? null,
    post_owner: payload.post_owner == null ? null : String(payload.post_owner).trim(),
    post_owner_image: payload.post_owner_image ?? null,
    ad_title: payload.ad_title ?? null,
    ad_text: payload.ad_text ?? null,
    image_url_original: payload.image_url_original ?? null,
    video_url_original: payload.video_url_original ?? null,
    destination_url: payload.destination_url ?? null,
    redirect_url: payload.redirect_url ?? null,
    region_code: payload.region_code ?? null,
    type: payload.type ?? 'TEXT',
    impressions: payload.impressions ?? null,
    network: payload.network ?? 'google',
    subnetwork: payload.subnetwork ?? null,
    adPosition: 'FEED',
    source: payload.source ?? 'desktop',
    platform: payload.platform ?? 18,
    system_id: payload.system_id == null ? '' : String(payload.system_id).trim(),
    version: payload.version ?? '3.2.0',
    country,
    country_details: countryDetails,
    othermultimedia,
    hasPayloadFirstSeen: payload.first_seen != null,
    hasPayloadLastSeen: payload.last_seen != null,
    hasPayloadPostDate: payload.post_date != null,
    firstSeenSql: mysqlDateTime(firstSeen),
    lastSeenSql: mysqlDateTime(lastSeen),
    postDateSql: suppliedPostDateSql || UNKNOWN_POST_DATE_SQL,
    postDateEs: suppliedPostDateSql,
    daysRunning: daysRunning(firstSeen, lastSeen),
    domain: extractDomain(payload.destination_url),
    countryDetailsSql: countryDetails.map((detail, ordinal) => ({
      ...detail,
      ordinal,
      firstSeenSql: mysqlDateTime(detail.first_seen),
      lastSeenSql: mysqlDateTime(detail.last_seen),
    })),
  };
}

module.exports = {
  normalizeTransparencyPayload,
  mysqlDateTime,
  daysRunning,
  extractDomain,
  UNKNOWN_POST_DATE_SQL,
};
