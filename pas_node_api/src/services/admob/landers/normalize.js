'use strict';

function nullable(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function toArray(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
      if (parsed !== undefined && parsed !== null) return [parsed];
    } catch {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [value];
}

function toStringArray(value) {
  return toArray(value)
    .flatMap((item) => {
      if (item === undefined || item === null) return [];
      if (typeof item === 'string') return [item.trim()];
      if (typeof item === 'object') {
        const candidate = item.text || item.label || item.title || item.href || item.url || item.phone || item.value;
        if (candidate !== undefined && candidate !== null && candidate !== '') {
          return [String(candidate).trim()];
        }
        try {
          return [JSON.stringify(item)];
        } catch {
          return [];
        }
      }
      return [String(item).trim()];
    })
    .filter(Boolean);
}

function toObject(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function toJsonText(value) {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function toDateOnly(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toBoolean(value) {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function mergeStringArrays(...values) {
  const seen = new Set();
  const merged = [];

  for (const value of values) {
    for (const item of toStringArray(value)) {
      const text = String(item).trim();
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(text);
    }
  }

  return merged;
}

function firstText(...values) {
  for (const value of values) {
    const text = nullable(value);
    if (text) return text;
  }
  return null;
}

function normalizeLanderPayload(payload) {
  const countryIso = toStringArray(payload.country_iso ?? payload.countryIso);
  const sourceParameters = toObject(payload.source_parameters ?? payload.sourceParameters);
  const whatsapp = toObject(payload.whatsapp);
  const whatsappParameters = toObject(payload.whatsapp_parameters ?? payload.whatsappParameters ?? whatsapp?.parameters);
  const location = toObject(payload.location);
  const comparison = toObject(payload.comparison);

  // DS can send the WhatsApp evidence as either a flat contract or a nested
  // `whatsapp` object. We keep both shapes compatible so the lander API can
  // store the evidence without forcing the producer to reshape it first.
  const whatsappUrl = firstText(payload.whatsapp_url, payload.whatsappUrl, whatsapp?.url, whatsapp?.href);
  const whatsappDomain = firstText(payload.whatsapp_domain, whatsapp?.domain);
  const whatsappPath = firstText(payload.whatsapp_path, whatsapp?.path);
  const whatsappPhone = firstText(payload.whatsapp_phone, whatsapp?.phone, whatsappParameters?.phone);
  const whatsappMessage = firstText(payload.whatsapp_message, whatsapp?.message, whatsappParameters?.text);
  const sourceWebsite = firstText(payload.source_website, payload.sourceWebsite);
  const campaignId = firstText(payload.campaign_id, payload.campaignId, sourceParameters?.gad_campaignid);

  const whatsappLinks = mergeStringArrays(payload.whatsapp_links ?? payload.whatsappUrls, whatsappUrl);
  const whatsappTexts = mergeStringArrays(
    payload.whatsapp_texts ?? payload.whatsappTexts ?? payload.prefilled_texts ?? payload.prefilledTexts,
    whatsappMessage,
    whatsappParameters?.text
  );
  const phoneNumbers = mergeStringArrays(payload.phone_numbers ?? payload.phoneNumbers, whatsappPhone, whatsappParameters?.phone);
  const contactButtons = toArray(payload.contact_buttons ?? payload.contactButtons);
  const flattenedButtons = toStringArray(contactButtons);
  const outgoingUrls = toArray(payload.outgoing_url ?? payload.outgoingUrls);
  const redirects = toArray(payload.redirects);
  // Rotator detection must be an explicit DS signal. The comparison object is
  // still stored verbatim for audit, but it is not a reliable rotator detector
  // because it only compares one scrape with and without VPN.
  const rotatorSignal = payload.whatsapp_rotator_detected ?? payload.high_volume_lead_campaign;
  const rotatorPhoneCount = toNumber(payload.whatsapp_rotator_phone_count ?? payload.rotator_phone_count);
  const locationWithoutVpn = toObject(payload.location_without_vpn ?? location?.without_vpn);
  const locationWithVpn = toObject(payload.location_with_vpn ?? location?.with_vpn);

  return {
    ad_id: String(payload.ad_id || '').trim(),
    lander_status: Number.isFinite(Number(payload.status)) ? Number(payload.status) : 0,
    crawled_by: nullable(payload.crawled_by),
    destinations: nullable(payload.destinations ?? payload.destination_url ?? payload.destinationUrl),
    html_path: nullable(payload.html_path),
    screen_shot: nullable(payload.screen_shot ?? payload.screenshot_url),
    html_content: payload.html_content ?? payload.html ?? null,
    domain_registered_date: toDateOnly(payload.domain_registered_date),
    domain_age: toNumber(payload.domain_age),
    country_iso_json: toJsonText(countryIso),
    outgoing_url_json: toJsonText(outgoingUrls),
    redirects_json: toJsonText(redirects),
    ad_category: nullable(payload.ad_category),
    source_website: sourceWebsite,
    source_parameters_json: toJsonText(sourceParameters),
    whatsapp_url: whatsappUrl,
    whatsapp_domain: whatsappDomain,
    whatsapp_path: whatsappPath,
    whatsapp_phone: whatsappPhone,
    whatsapp_message: whatsappMessage,
    whatsapp_parameters_json: toJsonText(whatsappParameters),
    campaign_id: campaignId,
    location_without_vpn_json: toJsonText(locationWithoutVpn),
    location_with_vpn_json: toJsonText(locationWithVpn),
    comparison_json: toJsonText(comparison),
    whatsapp_links_json: toJsonText(whatsappLinks),
    whatsapp_texts_json: toJsonText(whatsappTexts),
    phone_numbers_json: toJsonText(phoneNumbers),
    contact_buttons_json: toJsonText(contactButtons),
    contact_button_count: flattenedButtons.length,
    whatsapp_rotator_detected: toBoolean(rotatorSignal),
    whatsapp_rotator_phone_count: rotatorPhoneCount ?? 0,
    lead_campaign_tag: nullable(payload.lead_campaign_tag ?? payload.campaign_tag ?? payload.tracking_tag),
    raw_payload_json: toJsonText(payload),
  };
}

module.exports = {
  normalizeLanderPayload,
  nullable,
  toArray,
  toBoolean,
  toDateOnly,
  toJsonText,
  toNumber,
  toObject,
  toStringArray,
};
