'use strict';

const INVALID_POST_OWNER_VALUES = new Set(['na', 'n/a', 'none', 'null', 'undefined']);

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

function toTextArray(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap((item) => toTextArray(item));
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return toTextArray(parsed);
    } catch {
      return [value.trim()];
    }
  }
  if (typeof value === 'object') {
    const candidate = value.text || value.label || value.title || value.href || value.url || value.phone || value.value;
    if (candidate !== undefined && candidate !== null && candidate !== '') {
      return [String(candidate).trim()];
    }
    try {
      return [JSON.stringify(value)];
    } catch {
      return [];
    }
  }
  return [String(value).trim()];
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

function toObjectArray(value) {
  return toArray(value).flatMap((item) => {
    const parsed = toObject(item);
    if (parsed) return [parsed];
    if (item && typeof item === 'object' && !Array.isArray(item)) return [item];
    return [];
  });
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

function toDateTime(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizePostOwner(value) {
  if (typeof value !== 'string') return null;
  const text = nullable(value);
  if (!text) return null;
  return INVALID_POST_OWNER_VALUES.has(text.toLowerCase()) ? null : text;
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

function mergeTextArrays(...values) {
  const seen = new Set();
  const merged = [];

  for (const value of values) {
    for (const item of toTextArray(value)) {
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

function isAbsoluteUrl(value) {
  try {
    new URL(String(value));
    return true;
  } catch {
    return false;
  }
}

function extractMarkdownUrl(value) {
  const text = nullable(value);
  if (!text) return null;

  const match = text.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (!match) return null;

  const candidates = [match[2], match[1]];
  for (const candidate of candidates) {
    const normalized = nullable(candidate);
    if (normalized && isAbsoluteUrl(normalized)) {
      return normalized;
    }
  }

  return null;
}

function normalizeDomainHost(value) {
  const text = nullable(value);
  if (!text) return null;

  if (isAbsoluteUrl(text)) {
    try {
      return new URL(text).host;
    } catch {
      return text;
    }
  }

  return text
    .replace(/^https?:\/\//i, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function normalizeWhatsappUrl(value, domain) {
  const raw = nullable(value);
  if (!raw) return null;

  const directUrl = extractMarkdownUrl(raw) || raw;
  if (isAbsoluteUrl(directUrl)) {
    return directUrl;
  }

  const host = normalizeDomainHost(domain);
  if (!host) {
    return directUrl;
  }

  const trimmed = directUrl.trim();
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(trimmed)) {
    return `https://${trimmed.replace(/^\/+/, '')}`;
  }

  if (/^[/?#]/.test(trimmed)) {
    return `https://${host}${trimmed}`;
  }

  if (!/\s/.test(trimmed)) {
    return `https://${host}/${trimmed.replace(/^\/+/, '')}`;
  }

  return trimmed;
}

function normalizeWhatsappEntry(entry) {
  const domain = firstText(entry.domain, entry.host);
  const phone = firstText(entry.phone, entry.phone_number, entry.msisdn);
  const button = firstText(entry.button, entry.label, entry.title);
  const message = firstText(entry.message, entry.text, entry.prefilled_text);
  const firstDetected = firstText(entry.first_detected, entry.fisrt_detected);
  const lastDetected = firstText(entry.last_detected, entry.lastDetected);
  const state = firstText(entry.state);
  const city = firstText(entry.city);
  const country = firstText(entry.country, entry.countrty, entry.country_code);
  // DS historically used `path` for the final WhatsApp URL and sometimes sends
  // markdown-wrapped links or path-only fragments. Store one stable `url`.
  const url = normalizeWhatsappUrl(
    firstText(entry.url, entry.href, entry.link, entry.path, entry.pathname, entry.route),
    domain
  );

  const normalized = {
    domain,
    phone,
    button,
    message,
    first_detected: firstDetected,
    last_detected: lastDetected,
    state,
    city,
    country,
  };

  if (url) normalized.url = url;
  return normalized;
}

function normalizeLanderPayload(payload) {
  const currentDateTime = toDateTime(new Date());
  const countryIso = toStringArray(payload.country_iso ?? payload.countryIso);
  const outgoingUrls = toArray(payload.outgoing_url ?? payload.outgoingUrls);
  const redirects = toArray(payload.redirects);
  const whatsappEntries = toObjectArray(payload.whatsapp);
  const normalizedWhatsappEntries = whatsappEntries.map(normalizeWhatsappEntry).filter((entry) => Object.values(entry).some((value) => value !== null && value !== undefined && value !== ''));
  const uniquePhoneNumbers = [...new Set(
    normalizedWhatsappEntries
      .map((entry) => nullable(entry.phone))
      .filter(Boolean)
  )];
  const rotatorCount = uniquePhoneNumbers.length;
  const rotatorSignal = rotatorCount > 1;
  const campaignId = firstText(payload.campaign_id, payload.campaignId);
  const leadCampaignTag = nullable(
    payload.lead_campaign_tag
      ?? payload.campaign_tag
      ?? payload.tracking_tag
      ?? (rotatorSignal ? 'high-volume-lead-campaign' : null)
  );
  const created = toDateTime(payload.created ?? payload.updated) || currentDateTime;
  const updated = toDateTime(payload.updated ?? payload.created) || currentDateTime;

  const landerStatus = Number.isFinite(Number(payload.status ?? payload.lander_status))
    ? Number(payload.status ?? payload.lander_status)
    : 1;

  return {
    ad_id: String(payload.ad_id || '').trim(),
    platform: toNumber(payload.platform),
    lander_status: landerStatus,
    // Keep this field defensive even though insert_html_content validates it
    // earlier, so any future direct caller cannot stringify junk objects into
    // a real post owner accidentally.
    post_owner: normalizePostOwner(payload.post_owner ?? payload.postOwner),
    destinations: nullable(payload.destinations ?? payload.destination_url ?? payload.destinationUrl),
    html_path: nullable(payload.html_path),
    screen_shot: nullable(payload.screen_shot ?? payload.screenshot_url),
    html_content: payload.html_content ?? payload.html ?? null,
    domain_registered_date: toDateOnly(payload.domain_registered_date),
    domain_age: toNumber(payload.domain_age),
    country_iso_json: toJsonText(countryIso),
    outgoing_url_json: toJsonText(outgoingUrls),
    redirects_json: toJsonText(redirects),
    whatsapp_json: toJsonText(normalizedWhatsappEntries),
    campaign_id: campaignId,
    whatsapp_rotator_detected: rotatorSignal,
    whatsapp_rotator_count: rotatorCount,
    lead_campaign_tag: leadCampaignTag,
    created,
    updated,
  };
}

module.exports = {
  normalizeLanderPayload,
  nullable,
  toArray,
  toDateOnly,
  toDateTime,
  toJsonText,
  toNumber,
  toObject,
  toStringArray,
};
