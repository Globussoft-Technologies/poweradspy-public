/**
 * Displayable-media filters per network.
 *
 * Mirrors the always-applied clauses each network's SearchMix/Search
 * QueryBuilder pushes into its top-level bool â€” `EXTRA_CONDITION` plus any
 * inline `buckets.must_not.push(...)` / `buckets.filter.push(...)` calls
 * inside `build()` that aren't gated on user input.
 *
 * The competitor counts must match what the user sees in pas_node_api's
 * search UI, so this file is kept in lockstep with:
 *   pas_node_api/src/services/common/helpers/displayableMediaFilters.js
 *
 * Source of truth for each entry:
 *   pas_node_api/src/services/<network>/builders/*QueryBuilder.js â€” the
 *   `build()` method (look for buckets.filter.push / buckets.must_not.push
 *   that aren't behind an `if` on user input).
 */

const FACEBOOK = [
  {
    bool: {
      should: [
        {
          bool: {
            filter: [
              { term: { 'facebook_ad.type.keyword': 'IMAGE' } },
              { exists: { field: 'new_nas_image_url' } },
            ],
            must_not: [
              { wildcard: { 'new_nas_image_url.keyword': { value: '*DefaultImage*' } } },
            ],
          },
        },
        {
          bool: {
            filter: [
              { term: { 'facebook_ad.type.keyword': 'VIDEO' } },
              { exists: { field: 'Thumbnail' } },
            ],
            must_not: [
              { wildcard: { 'Thumbnail.keyword': { value: '*DefaultImage*' } } },
            ],
          },
        },
        {
          bool: {
            must_not: [
              { terms: { 'facebook_ad.type.keyword': ['IMAGE', 'VIDEO'] } },
            ],
            filter: [
              {
                bool: {
                  should: [
                    { exists: { field: 'new_nas_image_url' } },
                    { exists: { field: 'othermedia' } },
                  ],
                  minimum_should_match: 1,
                },
              },
            ],
            must_not: [
              { wildcard: { 'new_nas_image_url.keyword': { value: '*DefaultImage*' } } },
              { wildcard: { 'othermedia.keyword': { value: '*DefaultImage*' } } },
            ],
          },
        },
      ],
      minimum_should_match: 1,
    },
  },
];

const INSTAGRAM = [
  {
    bool: {
      should: [
        {
          bool: {
            filter: [
              { terms: { 'instagram_ad.type.keyword': ['IMAGE', 'STORIES'] } },
              { exists: { field: 'new_nas_image_url' } },
            ],
            must_not: [
              { wildcard: { 'new_nas_image_url.keyword': { value: '*DefaultImage*' } } },
            ],
          },
        },
        {
          bool: {
            filter: [
              { term: { 'instagram_ad.type.keyword': 'VIDEO' } },
              { exists: { field: 'thumbnail' } },
            ],
            must_not: [
              { wildcard: { 'thumbnail.keyword': { value: '*DefaultImage*' } } },
            ],
          },
        },
        {
          bool: {
            must_not: [
              { terms: { 'instagram_ad.type.keyword': ['IMAGE', 'VIDEO', 'STORIES'] } },
            ],
            filter: [
              {
                bool: {
                  should: [
                    { exists: { field: 'new_nas_image_url' } },
                    { exists: { field: 'othermedia' } },
                  ],
                  minimum_should_match: 1,
                },
              },
            ],
            must_not: [
              { wildcard: { 'new_nas_image_url.keyword': { value: '*DefaultImage*' } } },
              { wildcard: { 'othermedia.keyword': { value: '*DefaultImage*' } } },
            ],
          },
        },
      ],
      minimum_should_match: 1,
    },
  },
];

const LINKEDIN = [
  {
    bool: {
      should: [
        {
          bool: {
            filter: [
              { term: { 'ad_type.keyword': 'IMAGE' } },
              { exists: { field: 'new_nas_image_url' } },
            ],
            must_not: [
              { wildcard: { 'new_nas_image_url.keyword': { value: '*DefaultImage*' } } },
              { wildcard: { 'new_nas_image_url.keyword': { value: '*pasimage*' } } },
              { wildcard: { 'new_nas_image_url.keyword': { value: '*bydefault*' } } },
            ],
          },
        },
        {
          bool: {
            filter: [
              { term: { 'ad_type.keyword': 'VIDEO' } },
              { exists: { field: 'ad_video' } },
            ],
            must_not: [
              { wildcard: { 'ad_video.keyword': { value: '*pasvideo*' } } },
              { wildcard: { 'ad_video.keyword': { value: '*pasimage*' } } },
              { wildcard: { 'ad_video.keyword': { value: '*bydefault*' } } },
              { wildcard: { 'new_nas_image_url.keyword': { value: '*DefaultImage*' } } },
            ],
          },
        },
        {
          bool: {
            must_not: [
              { terms: { 'ad_type.keyword': ['IMAGE', 'VIDEO'] } },
            ],
          },
        },
      ],
      minimum_should_match: 1,
    },
  },
];

const YOUTUBE = [
  {
    bool: {
      should: [
        {
          bool: {
            filter: [
              { terms: { 'ad_type.keyword': ['VIDEO', 'DISCOVERY'] } },
              { exists: { field: 'thumbnail_url' } },
            ],
            must_not: [
              { wildcard: { 'thumbnail_url.keyword': { value: '*pasvideo*' } } },
              { wildcard: { 'thumbnail_url.keyword': { value: '*pasimage*' } } },
              { wildcard: { 'thumbnail_url.keyword': { value: '*bydefault*' } } },
              { wildcard: { 'thumbnail_url.keyword': { value: '*DefaultImage*' } } },
            ],
          },
        },
        {
          bool: {
            filter: [
              { exists: { field: 'new_nas_image_url' } },
            ],
            must_not: [
              { terms: { 'ad_type.keyword': ['VIDEO', 'DISCOVERY'] } },
              { wildcard: { 'new_nas_image_url.keyword': { value: '*pasvideo*' } } },
              { wildcard: { 'new_nas_image_url.keyword': { value: '*pasimage*' } } },
              { wildcard: { 'new_nas_image_url.keyword': { value: '*bydefault*' } } },
            ],
          },
        },
      ],
      minimum_should_match: 1,
    },
  },
  {
    bool: {
      must_not: [
        { terms: { 'ad_type.keyword': ['', 'DISPLAY'] } },
      ],
    },
  },
];

// YouTube DISPLAY/IMAGE ads are surfaced under GDN (read-path merge in
// pas_node_api gdn/helpers/youtubeDisplayMerge.js). The website's GDN "Total
// Ads" = gdn count + this youtube-side count, so the GDN total here must add it
// (run against the YOUTUBE index, not gdn). Mirrors getYoutubeDisplayHits'
// unfiltered clause set + youtubeDisplayMerge.BLOCKED_MEDIA.
export const YOUTUBE_DISPLAY_UNDER_GDN = [
  {
    bool: {
      filter: [
        { terms: { 'ad_type.keyword': ['DISPLAY', 'IMAGE'] } },
        { exists: { field: 'new_nas_image_url' } },
      ],
      must_not: [
        { wildcard: { 'new_nas_image_url.keyword': { value: '*pasvideo*' } } },
        { wildcard: { 'new_nas_image_url.keyword': { value: '*pasimage*' } } },
        { wildcard: { 'new_nas_image_url.keyword': { value: '*bydefault*' } } },
      ],
    },
  },
];

const GOOGLE = [
  {
    bool: {
      must_not: [
        {
          bool: {
            filter: [
              { term: { type: 'image' } },
              {
                bool: {
                  should: [
                    { bool: { must_not: [{ exists: { field: 'new_nas_image_url' } }] } },
                    { term: { new_nas_image_url: '' } },
                  ],
                  minimum_should_match: 1,
                },
              },
            ],
            must_not: [
              { term: { platform: 18 } },
            ],
          },
        },
        { term: { type: 'organic search' } },
      ],
    },
  },
];

const GDN = [
  {
    bool: {
      should: [
        {
          bool: {
            filter: [
              {
                bool: {
                  should: [
                    { term: { 'gdn_ad.type.keyword': 'IMAGE' } },
                    { term: { 'gdn_ad.type.keyword': '' } },
                  ],
                  minimum_should_match: 1,
                },
              },
              { exists: { field: 'new_nas_image_url' } },
            ],
          },
        },
        {
          bool: {
            must_not: [
              {
                bool: {
                  should: [
                    { term: { 'gdn_ad.type.keyword': 'IMAGE' } },
                    { term: { 'gdn_ad.type.keyword': '' } },
                  ],
                  minimum_should_match: 1,
                },
              },
            ],
          },
        },
      ],
      minimum_should_match: 1,
    },
  },
];

const PINTEREST = [
  {
    bool: {
      should: [
        {
          bool: {
            filter: [
              { term: { 'pinterest_ad.type.keyword': 'IMAGE' } },
              { exists: { field: 'new_nas_image_url' } },
            ],
          },
        },
        {
          bool: {
            filter: [
              { term: { 'pinterest_ad.type.keyword': 'VIDEO' } },
              { exists: { field: 'thumbnail' } },
            ],
          },
        },
        {
          bool: {
            must_not: [
              { terms: { 'pinterest_ad.type.keyword': ['IMAGE', 'VIDEO'] } },
            ],
          },
        },
      ],
      minimum_should_match: 1,
    },
  },
];

const QUORA = [
  {
    bool: {
      should: [
        {
          bool: {
            filter: [
              { term: { 'quora_ad.type.keyword': 'IMAGE' } },
              { exists: { field: 'new_nas_image_url' } },
            ],
          },
        },
        {
          bool: {
            filter: [
              { term: { 'quora_ad.type.keyword': 'VIDEO' } },
              { exists: { field: 'new_nas_image_url' } },
              { exists: { field: 'thumbnail' } },
            ],
          },
        },
        {
          bool: {
            must_not: [
              { terms: { 'quora_ad.type.keyword': ['IMAGE', 'VIDEO'] } },
            ],
          },
        },
      ],
      minimum_should_match: 1,
    },
  },
];

const REDDIT = [
  {
    bool: {
      should: [
        {
          bool: {
            filter: [
              { term: { 'reddit_ad.type.keyword': 'IMAGE' } },
              { exists: { field: 'new_nas_image_url' } },
            ],
          },
        },
        {
          bool: {
            filter: [
              { term: { 'reddit_ad.type.keyword': 'VIDEO' } },
              { exists: { field: 'Thumbnail' } },
            ],
            must_not: [
              { wildcard: { 'Thumbnail.keyword': { value: '*pasvideo*' } } },
              { wildcard: { 'Thumbnail.keyword': { value: '*pasimage*' } } },
              { wildcard: { 'Thumbnail.keyword': { value: '*bydefault*' } } },
            ],
          },
        },
        {
          bool: {
            must_not: [
              { terms: { 'reddit_ad.type.keyword': ['IMAGE', 'VIDEO'] } },
            ],
          },
        },
      ],
      minimum_should_match: 1,
    },
  },
];

const NATIVE = [
  {
    bool: {
      should: [
        {
          bool: {
            filter: [
              { terms: { 'native_ad.type.keyword': ['IMAGE', 'VIDEO'] } },
              { exists: { field: 'native_ad.nas_url' } },
            ],
          },
        },
        {
          bool: {
            must_not: [
              { terms: { 'native_ad.type.keyword': ['IMAGE', 'VIDEO'] } },
            ],
          },
        },
      ],
      minimum_should_match: 1,
    },
  },
];

const TIKTOK = [
  {
    bool: {
      filter: [{ exists: { field: 'video_cover' } }],
      must_not: [
        { wildcard: { 'video_cover.keyword': { value: '*pasvideo*' } } },
        { wildcard: { 'video_cover.keyword': { value: '*pasimage*' } } },
        { wildcard: { 'video_cover.keyword': { value: '*bydefault*' } } },
        { wildcard: { video_url: { value: '*pasvideo*' } } },
        { wildcard: { video_url: { value: '*pasimage*' } } },
        { wildcard: { video_url: { value: '*bydefault*' } } },
      ],
    },
  },
];

const FILTERS = {
  facebook: FACEBOOK,
  instagram: INSTAGRAM,
  linkedin: LINKEDIN,
  youtube: YOUTUBE,
  google: GOOGLE,
  gdn: GDN,
  pinterest: PINTEREST,
  quora: QUORA,
  reddit: REDDIT,
  native: NATIVE,
  tiktok: TIKTOK,
  bing: null,
};

export function getDisplayableMediaFilter(network) {
  return FILTERS[network] || null;
}
