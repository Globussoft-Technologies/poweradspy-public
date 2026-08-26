'use strict';

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value).replace(' ', 'T') + (String(value).includes('T') ? '' : 'Z'));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function daysRunning(firstSeen, lastSeen) {
  if (!firstSeen || !lastSeen) return null;
  const start = new Date(firstSeen);
  const end = new Date(lastSeen);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  // Diff calendar dates, not raw timestamps — otherwise a same-day ad seen
  // hours apart (e.g. 08:00 and 23:00) rounds up to "2 days" even though
  // first_seen and last_seen fall on the same date.
  const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.max(1, Math.round((endDay - startDay) / 86400000) + 1);
}

function asArray(value) {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
      if (parsed !== null && parsed !== undefined) return [parsed];
    } catch {
      return value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    }
  }
  return [value];
}

function flattenTextArray(value) {
  return asArray(value)
    .flatMap((item) => {
      if (item === null || item === undefined) return [];
      if (typeof item === 'string') return [item];
      if (typeof item === 'object') {
        const candidate = item.text || item.label || item.title || item.href || item.url || item.phone || item.value;
        if (candidate !== undefined && candidate !== null && candidate !== '') {
          return [String(candidate)];
        }
        try {
          return [JSON.stringify(item)];
        } catch {
          return [];
        }
      }
      return [String(item)];
    })
    .map((item) => item.trim())
    .filter(Boolean);
}

function asObject(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function asObjectArray(value) {
  return asArray(value).flatMap((item) => {
    const parsed = asObject(item);
    if (parsed) return [parsed];
    if (item && typeof item === 'object' && !Array.isArray(item)) return [item];
    return [];
  });
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
  // Only apps this ad was actually observed/scanned in (mob_ad_source_apps)
  // count as a source app. `lander_source_app` just records which app the
  // lander crawler happened to be running in when it captured the
  // screenshot/URL — it does not mean the ad appeared there, so it must
  // never be added to this list (was previously inflating the count/name
  // list with an app the ad was never actually seen in).
  const sourceAppNames = sourceApps.map((row) => row.name);
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
    redirect_status: ad.redirect_status === null || ad.redirect_status === undefined ? null : Number(ad.redirect_status),
    first_seen: iso(ad.first_seen),
    last_seen: iso(ad.last_seen),
    days_running: runningDays,
    occurrence_count: occurrenceCount,
    lead_score: occurrenceCount * (runningDays || 0),
    // "Poster Intelligence" score — occurrences + active days, kept separate
    // from lead_score (which multiplies the same two numbers for the
    // "Top-Converting Rank Engine" instead).
    poster_intelligence_score: occurrenceCount + (runningDays || 0),
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
    lander_status: ad.lander_status === null || ad.lander_status === undefined ? null : Number(ad.lander_status),
    lander_platform: ad.lander_platform === null || ad.lander_platform === undefined ? null : Number(ad.lander_platform),
    lander_destination_url: ad.lander_destination_url,
    lander_html_path: ad.lander_html_path,
    lander_screen_shot: ad.lander_screen_shot,
    lander_domain_registered_date: iso(ad.lander_domain_registered_date),
    lander_domain_age: ad.lander_domain_age === null || ad.lander_domain_age === undefined ? null : Number(ad.lander_domain_age),
    country_iso: asArray(ad.country_iso_json),
    outgoing_url: asObjectArray(ad.outgoing_url_json).map((row) => ({
      start_url: row.start_url ?? null,
      redirect_urls: asArray(row.redirect_urls),
      destination_url: row.destination_url ?? null,
    })),
    redirects: asArray(ad.redirects_json),
    campaign_id: ad.campaign_id,
    whatsapp_rotator_detected: Boolean(Number(ad.whatsapp_rotator_detected)),
    whatsapp_rotator_count: ad.whatsapp_rotator_count === null || ad.whatsapp_rotator_count === undefined ? 0 : Number(ad.whatsapp_rotator_count),
    lead_campaign_tag: ad.lead_campaign_tag,
    whatsapp: asObjectArray(ad.whatsapp_json).map((row) => ({
      domain: row.domain ?? null,
      phone: row.phone ?? null,
      button: row.button ?? null,
      message: row.message ?? null,
      first_detected: iso(row.first_detected),
      last_detected: iso(row.last_detected),
      state: row.state ?? null,
      city: row.city ?? null,
      country: row.country ?? null,
      url: row.url ?? null,
    })),
    created: iso(ad.lander_created),
    updated: iso(ad.lander_updated),
    country: ad.countries.map((row) => row.name),
    state: ad.states.map((row) => row.name),
    sub_network: ad.sub_networks.map((row) => row.name),
    source_app: sourceAppNames,
    source_app_pkg: sourceApps.map((row) => row.package),
    // Number of distinct source apps this ad is linked to — not a sum of
    // appearance counts (that's a different, per-app strength metric shown
    // alongside each app's name instead).
    source_app_count: sourceApps.length,
    country_details: details(ad.countries),
    state_details: details(ad.states),
    sub_network_details: details(ad.sub_networks),
    source_app_details: sourceApps,
    indexed_at: new Date().toISOString(),
  };
}

module.exports = { buildAdmobDocument };
