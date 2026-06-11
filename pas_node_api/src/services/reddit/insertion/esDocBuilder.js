'use strict';

/**
 * Reddit insertion — Elasticsearch document builder.
 * Builds search_mix documents from joined ad rows.
 */

const ES_DATE_FIELDS = {
  post_date: 'yyyy-MM-dd HH:mm:ss',
  first_seen: 'yyyy-MM-dd HH:mm:ss',
  last_seen: 'yyyy-MM-dd HH:mm:ss',
  created_date: 'iso',
  domain_registered_date: 'yyyy-MM-dd',
};

const CARRY_OVER_KEYS = [
  'reddit_ad_id', 'reddit_ad_image_video', 'reddit_ad_domain', 'reddit_ad_variants',
  'reddit_call_to_action', 'reddit_country', 'reddit_user', 'reddit_ad_meta_data',
  'reddit_ad_post_owners', 'reddit_ad_analytics', 'reddit_ad_translation',
];

function coerceEsDate(value, format) {
  if (!value) return null;
  if (value instanceof Date) value = value.toISOString().split('T')[0] + ' ' + value.toTimeString().split(' ')[0];
  const s = String(value).trim();
  if (!s) return null;
  if (format === 'iso') return s;
  if (format === 'yyyy-MM-dd') {
    const d = new Date(s);
    const pad = (n) => String(n).padStart(2, '0');
    if (isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  // yyyy-MM-dd HH:mm:ss
  if (s.includes('T')) {
    const [datePart, timePart] = s.split('T');
    return `${datePart} ${timePart.split('.')[0]}`;
  }
  return s;
}

function buildSearchMixDoc(joinedAd) {
  const body = {};

  // Main ad fields
  body.reddit_ad = {
    id: joinedAd.id,
    ad_id: joinedAd.ad_id,
    platform: joinedAd.platform,
    type: joinedAd.type,
    post_date: coerceEsDate(joinedAd.post_date, ES_DATE_FIELDS.post_date),
    first_seen: coerceEsDate(joinedAd.first_seen, ES_DATE_FIELDS.first_seen),
    last_seen: coerceEsDate(joinedAd.last_seen, ES_DATE_FIELDS.last_seen),
    created_date: coerceEsDate(joinedAd.created_date, ES_DATE_FIELDS.created_date),
    ad_position: joinedAd.ad_position,
    source: joinedAd.source,
  };

  // Post owner fields
  if (joinedAd.post_owner_name) {
    body.reddit_ad_post_owners = {
      post_owner_name: joinedAd.post_owner_name,
      post_owner_lower: joinedAd.post_owner_lower,
      post_owner_image: joinedAd.post_owner_image,
    };
  }

  // Variant fields
  if (joinedAd.title || joinedAd.text) {
    body.reddit_ad_variants = {
      title: joinedAd.title,
      text: joinedAd.text,
      newsfeed_description: joinedAd.newsfeed_description,
      image_url: joinedAd.image_url,
      image_url_original: joinedAd.image_url_original,
      image_object: joinedAd.image_object,
    };
  }

  // NAS image path (new format from media uploads)
  if (joinedAd.image_url && joinedAd.image_url.startsWith('/pas-')) {
    body.new_nas_image_url = joinedAd.image_url;
    // For VIDEO ads, also set Thumbnail field for search query compatibility
    if (joinedAd.type === 'VIDEO') {
      body.Thumbnail = joinedAd.image_url;
    }
  }

  // Domain fields
  if (joinedAd.domain) {
    body.reddit_ad_domain = {
      domain: joinedAd.domain,
      domain_registered_date: coerceEsDate(joinedAd.domain_registered_date, ES_DATE_FIELDS.domain_registered_date),
    };
  }

  // CTA
  if (joinedAd.call_to_action) {
    body.reddit_call_to_action = {
      call_to_action: joinedAd.call_to_action,
    };
  }

  // Country
  if (joinedAd.country_row) {
    body.reddit_country = {
      country: joinedAd.country_row,
    };
  }

  // User
  if (joinedAd.gender) {
    body.reddit_user = {
      Gender: joinedAd.gender,
    };
  }

  // Meta data
  if (joinedAd.destination_url) {
    body.reddit_ad_meta_data = {
      destination_url: joinedAd.destination_url,
      built_with: joinedAd.built_with,
      built_with_analytics_tracking: joinedAd.built_with_analytics_tracking,
    };
  }

  // Carousel
  if (joinedAd.ad_image_video) {
    try {
      body.reddit_ad_image_video = {
        othermedia: typeof joinedAd.ad_image_video === 'string'
          ? JSON.parse(joinedAd.ad_image_video)
          : joinedAd.ad_image_video,
      };
    } catch { /* ignore */ }
  }

  // Language
  if (joinedAd.iso) {
    body.reddit_ad.language_iso = joinedAd.iso;
  }

  return { index: 'reddit_search_mix', body };
}

function searchIdQuery(adId) {
  return {
    query: {
      term: {
        'reddit_ad.id': adId,
      },
    },
  };
}

function firstHitId(hits) {
  return hits?.hits?.[0]?._id ?? null;
}

function extractCarryOver(body, keys = CARRY_OVER_KEYS) {
  const result = {};
  keys.forEach(k => {
    if (body[k] !== undefined) result[k] = body[k];
  });
  return result;
}

module.exports = {
  buildSearchMixDoc, searchIdQuery, firstHitId, extractCarryOver,
  ES_DATE_FIELDS, CARRY_OVER_KEYS,
};
