'use strict';

/**
 * Displayable-media filters per network.
 *
 * Mirrors the always-applied clauses each network's SearchMix/Search
 * QueryBuilder pushes into its top-level bool — `EXTRA_CONDITION` plus any
 * inline `buckets.must_not.push(...)` / `buckets.filter.push(...)` calls
 * inside `build()` that aren't gated on user input.
 *
 * The new-ui-react frontend always applies these, so any count that should
 * match what the user sees in new-ui-react MUST apply the same clauses.
 *
 * Returns an ARRAY of ES clauses (or null if a network has none). Drop the
 * array into a top-level `bool.filter: [...]` and you get the same effective
 * filter the frontend applies. Clauses containing `must_not` inside a `bool`
 * still work in filter context because they don't contribute to score.
 *
 * If a network's clauses change in its builder, update this file AND the
 * mirror file at:
 *   admin_panel_backend/utils/displayable-media-filters.js
 *
 * Source of truth for each entry:
 *   pas_node_api/src/services/<network>/builders/*QueryBuilder.js — the
 *   `build()` method (look for buckets.filter.push / buckets.must_not.push
 *   that aren't behind an `if` on user input).
 */

// ─── Facebook ───────────────────────────────────────────────────────────
const FACEBOOK = [
  {
    bool: {
      should: [
        { bool: { filter: [
          { term:   { 'facebook_ad.type.keyword': 'IMAGE' } },
          { exists: { field: 'new_nas_image_url' } },
        ] } },
        { bool: { filter: [
          { term:   { 'facebook_ad.type.keyword': 'VIDEO' } },
          { exists: { field: 'Thumbnail' } },
        ] } },
        { bool: { must_not: [
          { terms: { 'facebook_ad.type.keyword': ['IMAGE', 'VIDEO'] } },
        ] } },
      ],
      minimum_should_match: 1,
    },
  },
];

// ─── Instagram ──────────────────────────────────────────────────────────
const INSTAGRAM = [
  {
    bool: {
      should: [
        { bool: { filter: [
          { terms:  { 'instagram_ad.type.keyword': ['IMAGE', 'STORIES'] } },
          { exists: { field: 'new_nas_image_url' } },
        ] } },
        { bool: { filter: [
          { term:   { 'instagram_ad.type.keyword': 'VIDEO' } },
          { exists: { field: 'thumbnail' } },
        ] } },
        { bool: { must_not: [
          { terms: { 'instagram_ad.type.keyword': ['IMAGE', 'VIDEO', 'STORIES'] } },
        ] } },
      ],
      minimum_should_match: 1,
    },
  },
];

// ─── LinkedIn ───────────────────────────────────────────────────────────
const LINKEDIN = [
  {
    bool: {
      should: [
        { bool: {
          filter: [
            { term:   { 'ad_type.keyword': 'IMAGE' } },
            { exists: { field: 'new_nas_image_url' } },
          ],
          must_not: [
            { wildcard: { 'new_nas_image_url.keyword': { value: '*DefaultImage*' } } },
            { wildcard: { 'new_nas_image_url.keyword': { value: '*pasimage*' } } },
            { wildcard: { 'new_nas_image_url.keyword': { value: '*bydefault*' } } },
          ],
        } },
        { bool: {
          filter: [
            { term:   { 'ad_type.keyword': 'VIDEO' } },
            { exists: { field: 'ad_video' } },
          ],
          must_not: [
            { wildcard: { 'ad_video.keyword': { value: '*pasvideo*' } } },
            { wildcard: { 'ad_video.keyword': { value: '*pasimage*' } } },
            { wildcard: { 'ad_video.keyword': { value: '*bydefault*' } } },
            { wildcard: { 'new_nas_image_url.keyword': { value: '*DefaultImage*' } } },
          ],
        } },
        { bool: { must_not: [
          { terms: { 'ad_type.keyword': ['IMAGE', 'VIDEO'] } },
        ] } },
      ],
      minimum_should_match: 1,
    },
  },
];

// ─── YouTube ────────────────────────────────────────────────────────────
// Has TWO always-applied filters:
//   1. EXTRA_CONDITION (displayable-media gate)
//   2. exclude ads with empty ad_type (line 394 of the builder)
const YOUTUBE = [
  {
    bool: {
      should: [
        { bool: {
          filter: [
            { terms:  { 'ad_type.keyword': ['VIDEO', 'DISCOVERY'] } },
            { exists: { field: 'thumbnail_url' } },
          ],
          must_not: [
            { wildcard: { 'thumbnail_url.keyword': { value: '*pasvideo*' } } },
            { wildcard: { 'thumbnail_url.keyword': { value: '*pasimage*' } } },
            { wildcard: { 'thumbnail_url.keyword': { value: '*bydefault*' } } },
            { wildcard: { 'thumbnail_url.keyword': { value: '*DefaultImage*' } } },
          ],
        } },
        { bool: {
          filter: [
            { exists: { field: 'new_nas_image_url' } },
          ],
          must_not: [
            { terms:    { 'ad_type.keyword': ['VIDEO', 'DISCOVERY'] } },
            { wildcard: { 'new_nas_image_url.keyword': { value: '*pasvideo*' } } },
            { wildcard: { 'new_nas_image_url.keyword': { value: '*pasimage*' } } },
            { wildcard: { 'new_nas_image_url.keyword': { value: '*bydefault*' } } },
          ],
        } },
      ],
      minimum_should_match: 1,
    },
  },
  { bool: { must_not: [{ term: { 'ad_type.keyword': '' } }] } },
];

// ─── Google ─────────────────────────────────────────────────────────────
// Has TWO always-applied must_not clauses:
//   1. IMAGE_MUST_NOT — exclude IMAGE ads without new_nas_image_url
//   2. exclude ORGANIC SEARCH (applies whenever no type filter is set, which
//      for the lifetime-total endpoint is always)
const GOOGLE = [
  {
    bool: {
      must_not: [
        {
          bool: {
            filter: [
              { term: { type: 'IMAGE' } },
              {
                bool: {
                  should: [
                    { bool: { must_not: [{ exists: { field: 'new_nas_image_url' } }] } },
                    { term: { 'new_nas_image_url.keyword': '' } },
                  ],
                  minimum_should_match: 1,
                },
              },
            ],
          },
        },
        { match_phrase: { type: 'ORGANIC SEARCH' } },
      ],
    },
  },
];

// ─── GDN ────────────────────────────────────────────────────────────────
const GDN = [
  {
    bool: {
      should: [
        { bool: { filter: [
          { bool: {
            should: [
              { term: { 'gdn_ad.type.keyword': 'IMAGE' } },
              { term: { 'gdn_ad.type.keyword': '' } },
            ],
            minimum_should_match: 1,
          } },
          { exists: { field: 'new_nas_image_url' } },
        ] } },
        { bool: { must_not: [
          { bool: {
            should: [
              { term: { 'gdn_ad.type.keyword': 'IMAGE' } },
              { term: { 'gdn_ad.type.keyword': '' } },
            ],
            minimum_should_match: 1,
          } },
        ] } },
      ],
      minimum_should_match: 1,
    },
  },
];

// ─── Pinterest ──────────────────────────────────────────────────────────
const PINTEREST = [
  {
    bool: {
      should: [
        { bool: { filter: [
          { term:   { 'pinterest_ad.type.keyword': 'IMAGE' } },
          { exists: { field: 'new_nas_image_url' } },
        ] } },
        { bool: { filter: [
          { term:   { 'pinterest_ad.type.keyword': 'VIDEO' } },
          { exists: { field: 'thumbnail' } },
        ] } },
        { bool: { must_not: [
          { terms: { 'pinterest_ad.type.keyword': ['IMAGE', 'VIDEO'] } },
        ] } },
      ],
      minimum_should_match: 1,
    },
  },
];

// ─── Quora ──────────────────────────────────────────────────────────────
const QUORA = [
  {
    bool: {
      should: [
        { bool: { filter: [
          { term:   { 'quora_ad.type.keyword': 'IMAGE' } },
          { exists: { field: 'new_nas_image_url' } },
        ] } },
        { bool: { filter: [
          { term:   { 'quora_ad.type.keyword': 'VIDEO' } },
          { exists: { field: 'new_nas_image_url' } },
          { exists: { field: 'thumbnail' } },
        ] } },
        { bool: { must_not: [
          { terms: { 'quora_ad.type.keyword': ['IMAGE', 'VIDEO'] } },
        ] } },
      ],
      minimum_should_match: 1,
    },
  },
];

// ─── Reddit ─────────────────────────────────────────────────────────────
const REDDIT = [
  {
    bool: {
      should: [
        { bool: { filter: [
          { term:   { 'reddit_ad.type.keyword': 'IMAGE' } },
          { exists: { field: 'new_nas_image_url' } },
        ] } },
        { bool: {
          filter: [
            { term:   { 'reddit_ad.type.keyword': 'VIDEO' } },
            { exists: { field: 'Thumbnail' } },
          ],
          must_not: [
            { wildcard: { 'Thumbnail.keyword': { value: '*pasvideo*' } } },
            { wildcard: { 'Thumbnail.keyword': { value: '*pasimage*' } } },
            { wildcard: { 'Thumbnail.keyword': { value: '*bydefault*' } } },
          ],
        } },
        { bool: { must_not: [
          { terms: { 'reddit_ad.type.keyword': ['IMAGE', 'VIDEO'] } },
        ] } },
      ],
      minimum_should_match: 1,
    },
  },
];

// ─── Native ─────────────────────────────────────────────────────────────
const NATIVE = [
  {
    bool: {
      should: [
        { bool: { filter: [
          { terms:  { 'native_ad.type.keyword': ['IMAGE', 'VIDEO'] } },
          { exists: { field: 'native_ad.nas_url' } },
        ] } },
        { bool: { must_not: [
          { terms: { 'native_ad.type.keyword': ['IMAGE', 'VIDEO'] } },
        ] } },
      ],
      minimum_should_match: 1,
    },
  },
];

// ─── TikTok ─────────────────────────────────────────────────────────────
// Displayable-media gate: require video_cover to exist and exclude legacy
// placeholder paths on both video_cover and video_url.
const TIKTOK = [
  {
    bool: {
      filter: [{ exists: { field: 'video_cover' } }],
      must_not: [
        { wildcard: { 'video_cover.keyword': { value: '*pasvideo*' } } },
        { wildcard: { 'video_cover.keyword': { value: '*pasimage*' } } },
        { wildcard: { 'video_cover.keyword': { value: '*bydefault*' } } },
        { wildcard: { video_url:   { value: '*pasvideo*' } } },
        { wildcard: { video_url:   { value: '*pasimage*' } } },
        { wildcard: { video_url:   { value: '*bydefault*' } } },
      ],
    },
  },
];

const FILTERS = {
  facebook:  FACEBOOK,
  instagram: INSTAGRAM,
  linkedin:  LINKEDIN,
  youtube:   YOUTUBE,
  google:    GOOGLE,
  gdn:       GDN,
  pinterest: PINTEREST,
  quora:     QUORA,
  reddit:    REDDIT,
  native:    NATIVE,
  tiktok:    TIKTOK,
  // No builder / no displayable filter:
  bing:      null,
};

/**
 * Return the array of displayable-media filter clauses for a network, or
 * null if the network has none. Clauses are intended to be appended to a
 * top-level `bool.filter: [...]`.
 *
 * @param {string} network - network slug, lowercased
 * @returns {Array|null}
 */
function getDisplayableMediaFilter(network) {
  return FILTERS[network] || null;
}

module.exports = { getDisplayableMediaFilter };
