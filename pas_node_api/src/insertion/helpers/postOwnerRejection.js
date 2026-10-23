'use strict';

const networks = require('../../config/networks');
const { rejected } = require('./responses');

function normalizePostOwnerName(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function getRejectedPostOwnerNames(network) {
  const names = networks[network]?.insertion?.rejectedPostOwnerNames;
  return Array.isArray(names) ? names : [];
}

function rejectConfiguredPostOwner(ad, network) {
  if (!network || !ad || typeof ad !== 'object') return null;

  const owner = ad.post_owner ?? ad.post_owner_name;
  const normalizedOwner = normalizePostOwnerName(owner);
  if (!normalizedOwner) return null;

  const blocked = getRejectedPostOwnerNames(network)
    .some((name) => normalizePostOwnerName(name) === normalizedOwner);
  if (!blocked) return null;

  return rejected(422, 'Ad rejected because its post owner is blocked for this network.', {
    field: 'post_owner',
    hint: `Remove "${String(owner).trim()}" from networks.${network}.insertion.rejectedPostOwnerNames only if this advertiser should be allowed.`,
  });
}

// ── Keyword / domain deny-lists ─────────────────────────────────────────────
// Configured per network (networks.<n>.insertion.rejectedKeywords / rejectedDomains)
// and globally for every network (root insertion.rejectedKeywords / rejectedDomains).

// Field classification for the keyword/domain checks. The exact names below are
// the payload fields the insertion code of every network actually reads
// (services/*/insertion — facebook, instagram, gdn, youtube, google, native,
// linkedin, reddit, quora, pinterest, chatgptads, admob). Unknown/new fields
// fall back to whole-word matching on the name's "_"-separated parts.
//   text  → keyword check
//   url   → keyword check + domain check
//   media → never scanned (CDN/NAS file names would cause false matches)
//   meta  → never scanned (ids, dates, counts, crawler inputs, user comments)
const TEXT_FIELDS = new Set([
  'ad_text', 'ad_title', 'title', 'text', 'description', 'newsfeed_description', 'news_feed_description',
  'text_image_title', 'call_to_action', 'post_owner', 'post_owner_name', 'display_link', 'image_ocr',
  'image_brand_logo', 'image_celebrity', 'image_object', 'page_details', 'page_category', 'ad_category',
  'category_name', 'affiliate_data', 'built_with', 'built_with_analytics_tracking', 'lead_campaign_tag',
  'localization_en', 'localization_fr', 'localization_pt', 'localization_ar', 'html_whitehat_lander_text',
]);
const URL_FIELDS = new Set([
  'destination_url', 'ad_url', 'initial_url', 'redirect_url', 'final_url', 'url_destination', 'url_redirects',
  'redirect_urls', 'redirects_json', 'outgoing_url_json', 'tracker_url', 'target_site', 'placement_url',
  'gdn_placement_url', 'meta_ad_url', 'destination_host', 'lander_domain', 'source_url', 'target_page',
  'channal_url', 'domain', 'url', 'website', 'landing_url', 'lander_url',
]);
const MEDIA_FIELDS = new Set([
  'image_video_url', 'image_url', 'image_url_original', 'post_owner_image', 'original_post_owner_image',
  'thumbnail_url', 'new_nas_image_url', 'nas_video_url', 'nas_path', 'nas_url', 'video_url', 'video_url_original',
  'drive_video_url', 'ad_image', 'ad_image_video', 'ad_video', 'other_multimedia', 'other_multimedia_list',
  'othermedia_list', 'screen_shot', 's3_path', 'aws_url', 'html_path', 'g_temp_url', 'video_cover', 'carousel_media',
]);
const META_FIELDS = new Set([
  'target_keyword', 'keywords_used', 'negative_keywords_used', 'comment', 'comments', 'comment_data', 'comments_data',
  'user_request_value', 'pinner_list_types', 'postal_codes', 'country_iso_json', 'reach_count_by_country',
  'whatsapp_json', 'ad_run_platforms', 'sub_networks', 'all_countries',
  'domain_registered_date', 'lander_status', 'lander_platform', 'lander_domain_age', 'redirect_status',
  'days_running', 'ad_ranking', 'whatsapp_rotator_detected', 'whatsapp_rotator_count', 'ad_image_size',
]);
const TEXT_PART = /^(text|texts|title|titles|description|desc|headline|caption|body|message|copy)$/;
const MEDIA_PART = /^(image|images|img|video|videos|thumb|thumbnail|thumbnails|media|multimedia|avatar|logo|picture|photo|photos|cover|screenshot|nas|s3|aws|carousel)$/;
const URL_PART = /^(url|urls|uri|href|domain|domains|host|link|links|lander|landing|destination|website|site|redirect|redirects)$/;
const META_PART = /^(id|ids|date|dates|time|at|seen|count|counts|low|high|age|version|platform|platforms|session|ip|country|countries|city|state|language|lang|position|size|status|type|uid|likes|share|shares|impressions|reach|keyword|keywords|comment|comments|source|app|pkg|network|system|running|ranking|rank|detected|score|rate|flag|registered)$/;

/** text | url | media | meta for one field name. */
function fieldKind(key) {
  const k = String(key || '').toLowerCase();
  if (MEDIA_FIELDS.has(k)) return 'media';
  if (URL_FIELDS.has(k)) return 'url';
  if (TEXT_FIELDS.has(k)) return 'text';
  if (META_FIELDS.has(k)) return 'meta';
  const parts = k.split(/[^a-z0-9]+/).filter(Boolean);
  // Order matters: explicit text words first ("social_media_text" is text), then
  // media, then metadata (dates/status/ids beat "domain"/"lander"), then URL.
  if (parts.some((p) => TEXT_PART.test(p))) return 'text';
  if (parts.some((p) => MEDIA_PART.test(p))) return 'media';
  if (parts.some((p) => META_PART.test(p))) return 'meta';
  if (parts.some((p) => URL_PART.test(p))) return 'url';
  return 'text';
}

function readGlobalInsertionList(key) {
  try {
    // Lazy: config/index.js requires networks.js, which requires this module's caller chain.
    // eslint-disable-next-line global-require
    const raw = require('../../config').getRawFileConfig?.()?.insertion?.[key];
    return Array.isArray(raw) ? raw.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim()) : [];
  } catch {
    return [];
  }
}

function getRejectedKeywords(network) {
  const own = networks[network]?.insertion?.rejectedKeywords;
  return [...(Array.isArray(own) ? own : []), ...readGlobalInsertionList('rejectedKeywords')];
}

function getRejectedDomains(network) {
  const own = networks[network]?.insertion?.rejectedDomains;
  return [...(Array.isArray(own) ? own : []), ...readGlobalInsertionList('rejectedDomains')];
}

/**
 * Every string field of the ad as [path, value, kind]. Nested values inherit the
 * parent's kind when the parent is media/meta/url (e.g. anything inside
 * other_multimedia stays media); a text parent lets the child's own name decide.
 */
function stringFields(ad, depth = 0, parentPath = '', parentKind = 'text', out = []) {
  if (!ad || typeof ad !== 'object' || depth > 4) return out;
  for (const [key, value] of Object.entries(ad)) {
    const own = Array.isArray(ad) ? 'inherit' : fieldKind(key);
    const kind = parentKind !== 'text' ? parentKind : (own === 'inherit' ? parentKind : own);
    const path = parentPath ? `${parentPath}.${key}` : key;
    if (typeof value === 'string') out.push([path, value, kind]);
    else if (value && typeof value === 'object') stringFields(value, depth + 1, path, kind, out);
  }
  return out;
}

function normalizeText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word / whole-phrase, case-insensitive ("tree" matches "Twinkling Tree", not "street"). */
function keywordPattern(keyword) {
  const words = normalizeText(keyword).split(' ').map(escapeRegex).join('\\s+');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${words}(?=$|[^\\p{L}\\p{N}])`, 'iu');
}

/** Domain words: protocol / "www." / path dropped, lower-case ("https://www.Foo.com/x" → "foo.com"). */
function normalizeDomain(value) {
  return normalizeText(value)
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

function rejectConfiguredKeyword(ad, network) {
  if (!network || !ad || typeof ad !== 'object') return null;
  const keywords = getRejectedKeywords(network).filter((k) => normalizeText(k));
  if (!keywords.length) return null;
  // Keywords: ad text + URL fields (never media or metadata).
  const fields = stringFields(ad).filter(([, , kind]) => kind === 'text' || kind === 'url');
  for (const keyword of keywords) {
    const re = keywordPattern(keyword);
    const hit = fields.find(([, value]) => re.test(normalizeText(value)));
    if (hit) {
      return rejected(422, 'Ad rejected because it contains a blocked keyword for this network.', {
        field: hit[0],
        keyword,
        hint: `Remove "${keyword}" from networks.${network}.insertion.rejectedKeywords (or the global insertion.rejectedKeywords) only if these ads should be allowed.`,
      });
    }
  }
  return null;
}

function rejectConfiguredDomain(ad, network) {
  if (!network || !ad || typeof ad !== 'object') return null;
  const domains = getRejectedDomains(network).map(normalizeDomain).filter(Boolean);
  if (!domains.length) return null;
  // Domains: URL/domain fields only.
  const fields = stringFields(ad).filter(([, , kind]) => kind === 'url');
  for (const domain of domains) {
    const hit = fields.find(([, value]) => normalizeText(value).includes(domain));
    if (hit) {
      return rejected(422, 'Ad rejected because its URL/domain contains a blocked domain for this network.', {
        field: hit[0],
        domain,
        hint: `Remove "${domain}" from networks.${network}.insertion.rejectedDomains (or the global insertion.rejectedDomains) only if these ads should be allowed.`,
      });
    }
  }
  return null;
}

/** All insertion deny-lists in order: post owner → keyword → domain. Null = allowed. */
function rejectConfiguredAd(ad, network) {
  return rejectConfiguredPostOwner(ad, network)
    || rejectConfiguredKeyword(ad, network)
    || rejectConfiguredDomain(ad, network);
}

module.exports = {
  normalizePostOwnerName,
  getRejectedPostOwnerNames,
  rejectConfiguredPostOwner,
  getRejectedKeywords,
  getRejectedDomains,
  rejectConfiguredKeyword,
  rejectConfiguredDomain,
  rejectConfiguredAd,
  fieldKind,
};
