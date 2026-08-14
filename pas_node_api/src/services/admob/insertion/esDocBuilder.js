'use strict';

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value).replace(' ', 'T') + (String(value).includes('T') ? '' : 'Z'));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function daysRunning(firstSeen, lastSeen) {
  if (!firstSeen || !lastSeen) return null;
  const start = Date.parse(firstSeen);
  const end = Date.parse(lastSeen);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(1, Math.ceil((end - start) / 86400000) + 1);
}

function details(rows) {
  return rows.map((row) => ({
    name: row.name,
    appearance_count: Number(row.appearance_count),
    first_seen: iso(row.first_seen),
    last_seen: iso(row.last_seen),
  }));
}

function buildAdmobDocument(ad) {
  const sourceApps = ad.source_apps.map((row) => ({
    name: row.name,
    package: row.package || '',
    appearance_count: Number(row.appearance_count),
    first_seen: iso(row.first_seen),
    last_seen: iso(row.last_seen),
  }));
  const runningDays = daysRunning(ad.first_seen, ad.last_seen);
  const occurrenceCount = Number(ad.occurrence_count || 0);
  return {
    id: Number(ad.id),
    ad_id: ad.ad_id,
    post_owner_id: ad.post_owner_id ? Number(ad.post_owner_id) : null,
    post_owner: ad.post_owner,
    post_owner_image: ad.post_owner_image,
    type: ad.type,
    platform: Number(ad.platform),
    network: ad.network,
    source: ad.source,
    ad_title: ad.ad_title,
    ad_text: ad.ad_text,
    newsfeed_description: ad.newsfeed_description,
    ad_image_size: ad.ad_image_size,
    ad_number_position: ad.ad_number_position === null ? null : Number(ad.ad_number_position),
    ad_position: ad.ad_position,
    ad_sub_position: ad.ad_sub_position,
    city: ad.city,
    ip_address: ad.ip_address,
    first_seen: iso(ad.first_seen),
    last_seen: iso(ad.last_seen),
    days_running: runningDays,
    occurrence_count: occurrenceCount,
    lead_score: occurrenceCount * (runningDays || 0),
    post_date: iso(ad.post_date),
    system_id: ad.system_id,
    version: ad.version,
    status: Number(ad.status),
    ad_url: ad.ad_url,
    destination_url: ad.destination_url,
    redirect_url: ad.redirect_url,
    placement_url: ad.placement_url,
    target_site: ad.target_site,
    destination_host: ad.destination_host,
    image_url_original: ad.image_url_original,
    image_url: ad.image_url,
    country: ad.countries.map((row) => row.name),
    state: ad.states.map((row) => row.name),
    sub_network: ad.sub_networks.map((row) => row.name),
    source_app: sourceApps.map((row) => row.name),
    source_app_pkg: sourceApps.map((row) => row.package),
    source_app_count: sourceApps.reduce((sum, row) => sum + row.appearance_count, 0),
    country_details: details(ad.countries),
    state_details: details(ad.states),
    sub_network_details: details(ad.sub_networks),
    source_app_details: sourceApps,
    indexed_at: new Date().toISOString(),
  };
}

module.exports = { buildAdmobDocument };
