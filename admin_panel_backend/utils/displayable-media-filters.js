'use strict';

/**
 * Displayable-media filters per network — mirror of
 *   pas_node_api/src/services/common/helpers/displayableMediaFilters.js
 *
 * Reproduces the always-applied clauses each network's SearchMix/Search
 * QueryBuilder in pas_node_api pushes into its top-level bool — EXTRA_CONDITION
 * plus any inline must_not/filter pushes inside `build()` that aren't gated on
 * user input.
 *
 * Returns an ARRAY of ES clauses (or null). Drop the array into a top-level
 * `bool.filter: [...]` and you get the same effective filter the frontend
 * applies.
 *
 * Keep this file IN SYNC with the pas_node_api mirror whenever a builder's
 * always-applied clauses change. The two repos deploy separately so we can't
 * share code directly.
 */

const FACEBOOK = [
  {
    bool: {
      should: [
        { bool: {
          filter: [
            { term:   { 'facebook_ad.type.keyword': 'IMAGE' } },
            { exists: { field: 'new_nas_image_url' } },
          ],
          must_not: [
            { wildcard: { 'new_nas_image_url.keyword': { value: '*DefaultImage*' } } },
          ],
        } },
        { bool: {
          filter: [
            { term:   { 'facebook_ad.type.keyword': 'VIDEO' } },
            { exists: { field: 'Thumbnail' } },
          ],
          must_not: [
            { wildcard: { 'Thumbnail.keyword': { value: '*DefaultImage*' } } },
          ],
        } },
        { bool: {
          must_not: [
            { terms: { 'facebook_ad.type.keyword': ['IMAGE', 'VIDEO'] } },
          ],
          filter: [
            { bool: {
              should: [
                { exists: { field: 'new_nas_image_url' } },
                { exists: { field: 'othermedia' } },
              ],
              minimum_should_match: 1,
            } },
          ],
          must_not: [
            { wildcard: { 'new_nas_image_url.keyword': { value: '*DefaultImage*' } } },
            { wildcard: { 'othermedia.keyword': { value: '*DefaultImage*' } } },
          ],
        } },
      ],
      minimum_should_match: 1,
    },
  },
];

const INSTAGRAM = [
  {
    bool: {
      should: [
        { bool: {
          filter: [
            { terms:  { 'instagram_ad.type.keyword': ['IMAGE', 'STORIES'] } },
            { exists: { field: 'new_nas_image_url' } },
          ],
          must_not: [
            { wildcard: { 'new_nas_image_url.keyword': { value: '*DefaultImage*' } } },
          ],
        } },
        { bool: {
          filter: [
            { term:   { 'instagram_ad.type.keyword': 'VIDEO' } },
            { exists: { field: 'thumbnail' } },
          ],
          must_not: [
            { wildcard: { 'thumbnail.keyword': { value: '*DefaultImage*' } } },
          ],
        } },
        { bool: {
          must_not: [
            { terms: { 'instagram_ad.type.keyword': ['IMAGE', 'VIDEO', 'STORIES'] } },
          ],
          filter: [
            { bool: {
              should: [
                { exists: { field: 'new_nas_image_url' } },
                { exists: { field: 'othermedia' } },
              ],
              minimum_should_match: 1,
            } },
          ],
          must_not: [
            { wildcard: { 'new_nas_image_url.keyword': { value: '*DefaultImage*' } } },
            { wildcard: { 'othermedia.keyword': { value: '*DefaultImage*' } } },
          ],
        } },
      ],
      minimum_should_match: 1,
    },
  },
];

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
  bing:      null,
};

function getDisplayableMediaFilter(network) {
  return FILTERS[network] || null;
}

module.exports = { getDisplayableMediaFilter };
