# Market Platform ES Kibana Check

This runbook tests the current market-platform lookup behavior in Elasticsearch 6.8.

## Important result contract

The current AnalyticsModal detection is substring-based. Values such as `_branch_match_id`, `branches`, and `branchen` can therefore match the `branch` platform value.

Because that behavior must be preserved without changing insertion or mappings, the production lookup intentionally uses wildcard queries on the analyzed URL fields. Do not replace them with `match`, `match_phrase`, `prefix`, or `multi_match`: those queries can undercount URL substrings.

The only safe query-only optimization is to:

- keep the wildcard on the direct analyzed text field;
- never use the high-cardinality URL `.keyword` field for this lookup;
- query only the URL fields required by that network;
- keep the clauses in `bool.filter`.

Replace an index below with the actual production `db.elastic.indexName` if configuration overrides the default. Use a real value such as `branch`, `doubleclick`, `demdex.net`, or `hubs.ly`.

## Query shape

For one selected platform value, the application emits one wildcard clause per URL field:

```json
{
  "bool": {
    "should": [
      {
        "wildcard": {
          "redirect_urls": {
            "value": "*branch*"
          }
        }
      },
      {
        "wildcard": {
          "destination_url": {
            "value": "*branch*"
          }
        }
      }
    ],
    "minimum_should_match": 1
  }
}
```

Multiple selected platform values add more wildcard clauses to the same `should` array and remain OR-ed.

## Facebook

```http
GET search_mix/_count
{
  "query": {
    "bool": {
      "filter": [
        {
          "bool": {
            "should": [
              { "wildcard": { "facebook_ad_url.url": { "value": "*branch*" } } },
              { "wildcard": { "facebook_ad_url.url_destination": { "value": "*branch*" } } },
              { "wildcard": { "facebook_ad_outgoing_links.source_url": { "value": "*branch*" } } },
              { "wildcard": { "facebook_ad_outgoing_links.redirect_url": { "value": "*branch*" } } },
              { "wildcard": { "facebook_ad_outgoing_links.final_url": { "value": "*branch*" } } },
              { "wildcard": { "facebook_ad_url.url_redirects": { "value": "*branch*" } } },
              { "wildcard": { "facebook_ad_meta_data.destination_url": { "value": "*branch*" } } }
            ],
            "minimum_should_match": 1
          }
        }
      ]
    }
  }
}
```

## Instagram

```http
GET instagram_search_mix/_count
{
  "query": {
    "bool": {
      "filter": [
        {
          "bool": {
            "should": [
              { "wildcard": { "instagram_ad_url.url": { "value": "*branch*" } } },
              { "wildcard": { "instagram_ad_url.url_destination": { "value": "*branch*" } } },
              { "wildcard": { "instagram_ad_outgoing_links.source_url": { "value": "*branch*" } } },
              { "wildcard": { "instagram_ad_outgoing_links.redirect_url": { "value": "*branch*" } } },
              { "wildcard": { "instagram_ad_outgoing_links.final_url": { "value": "*branch*" } } },
              { "wildcard": { "instagram_ad_url.url_redirects": { "value": "*branch*" } } },
              { "wildcard": { "instagram_ad_meta_data.destination_url": { "value": "*branch*" } } }
            ],
            "minimum_should_match": 1
          }
        }
      ]
    }
  }
}
```

## Native

```http
GET native_search_mix_v2/_count
{
  "query": {
    "bool": {
      "filter": [
        {
          "bool": {
            "should": [
              { "wildcard": { "native_ad_meta_data.redirect_url": { "value": "*branch*" } } },
              { "wildcard": { "native_ad_url.url_destination": { "value": "*branch*" } } },
              { "wildcard": { "native_ad_outgoing_links.source_url": { "value": "*branch*" } } },
              { "wildcard": { "native_ad_outgoing_links.redirect_url": { "value": "*branch*" } } },
              { "wildcard": { "native_ad_outgoing_links.final_url": { "value": "*branch*" } } },
              { "wildcard": { "native_ad_url.url_redirects": { "value": "*branch*" } } },
              { "wildcard": { "native_ad_meta_data.destination_url": { "value": "*branch*" } } }
            ],
            "minimum_should_match": 1
          }
        }
      ]
    }
  }
}
```

## GDN

```http
GET gdn_search_mix_v2/_count
{
  "query": {
    "bool": {
      "filter": [
        {
          "bool": {
            "should": [
              { "wildcard": { "gdn_ad_url.url": { "value": "*branch*" } } },
              { "wildcard": { "gdn_ad_url.url_destination": { "value": "*branch*" } } },
              { "wildcard": { "gdn_ad_url.url_redirects": { "value": "*branch*" } } },
              { "wildcard": { "gdn_ad_outgoing_links.source_url": { "value": "*branch*" } } },
              { "wildcard": { "gdn_ad_outgoing_links.redirect_url": { "value": "*branch*" } } },
              { "wildcard": { "gdn_ad_outgoing_links.final_url": { "value": "*branch*" } } },
              { "wildcard": { "gdn_ad_meta_data.destination_url": { "value": "*branch*" } } },
              { "wildcard": { "gdn_ad_meta_data.redirect_url": { "value": "*branch*" } } }
            ],
            "minimum_should_match": 1
          }
        }
      ]
    }
  }
}
```

## Reddit

```http
GET reddit_search_mix/_count
{
  "query": {
    "bool": {
      "filter": [
        {
          "bool": {
            "should": [
              { "wildcard": { "reddit_ad_url.url": { "value": "*branch*" } } },
              { "wildcard": { "reddit_ad_url.url_destination": { "value": "*branch*" } } },
              { "wildcard": { "reddit_ad_outgoing_links.source_url": { "value": "*branch*" } } },
              { "wildcard": { "reddit_ad_outgoing_links.redirect_url": { "value": "*branch*" } } },
              { "wildcard": { "reddit_ad_outgoing_links.final_url": { "value": "*branch*" } } },
              { "wildcard": { "reddit_ad_url.url_redirects": { "value": "*branch*" } } },
              { "wildcard": { "reddit_ad_meta_data.destination_url": { "value": "*branch*" } } }
            ],
            "minimum_should_match": 1
          }
        }
      ]
    }
  }
}
```

## Quora

```http
GET quora_search_mix/_count
{
  "query": {
    "bool": {
      "filter": [
        {
          "bool": {
            "should": [
              { "wildcard": { "quora_ad_url.url": { "value": "*branch*" } } },
              { "wildcard": { "quora_ad_url.url_destination": { "value": "*branch*" } } },
              { "wildcard": { "quora_ad_outgoing_links.source_url": { "value": "*branch*" } } },
              { "wildcard": { "quora_ad_outgoing_links.redirect_url": { "value": "*branch*" } } },
              { "wildcard": { "quora_ad_outgoing_links.final_url": { "value": "*branch*" } } },
              { "wildcard": { "quora_ad_url.url_redirects": { "value": "*branch*" } } },
              { "wildcard": { "quora_ad_meta_data.destination_url": { "value": "*branch*" } } }
            ],
            "minimum_should_match": 1
          }
        }
      ]
    }
  }
}
```

## Pinterest

```http
GET pinterest_search_mix/_count
{
  "query": {
    "bool": {
      "filter": [
        {
          "bool": {
            "should": [
              { "wildcard": { "pinterest_ad_url.url": { "value": "*branch*" } } },
              { "wildcard": { "pinterest_ad_url.url_destination": { "value": "*branch*" } } },
              { "wildcard": { "pinterest_ad_outgoing_links.source_url": { "value": "*branch*" } } },
              { "wildcard": { "pinterest_ad_outgoing_links.redirect_url": { "value": "*branch*" } } },
              { "wildcard": { "pinterest_ad_outgoing_links.final_url": { "value": "*branch*" } } },
              { "wildcard": { "pinterest_ad_url.url_redirects": { "value": "*branch*" } } },
              { "wildcard": { "pinterest_ad_meta_data.destination_url": { "value": "*branch*" } } }
            ],
            "minimum_should_match": 1
          }
        }
      ]
    }
  }
}
```

## LinkedIn

```http
GET linkedin_ads_data/_count
{
  "query": {
    "bool": {
      "filter": [
        {
          "bool": {
            "should": [
              { "wildcard": { "redirect_urls": { "value": "*branch*" } } },
              { "wildcard": { "destination_url": { "value": "*branch*" } } }
            ],
            "minimum_should_match": 1
          }
        }
      ]
    }
  }
}
```

## YouTube

```http
GET youtube_ads_data/_count
{
  "query": {
    "bool": {
      "filter": [
        {
          "bool": {
            "should": [
              { "wildcard": { "redirect_urls": { "value": "*branch*" } } },
              { "wildcard": { "destination_url": { "value": "*branch*" } } }
            ],
            "minimum_should_match": 1
          }
        }
      ]
    }
  }
}
```

## YouTube DISPLAY/IMAGE ads merged into GDN

The GDN listing reads these documents from `youtube_ads_data` and applies the display-media gates below:

```http
GET youtube_ads_data/_count
{
  "query": {
    "bool": {
      "filter": [
        { "terms": { "ad_type.keyword": ["DISPLAY", "IMAGE"] } },
        { "exists": { "field": "new_nas_image_url" } },
        {
          "bool": {
            "should": [
              { "wildcard": { "redirect_urls": { "value": "*branch*" } } },
              { "wildcard": { "destination_url": { "value": "*branch*" } } }
            ],
            "minimum_should_match": 1
          }
        }
      ],
      "must_not": [
        { "wildcard": { "new_nas_image_url.keyword": { "value": "*pasvideo*" } } },
        { "wildcard": { "new_nas_image_url.keyword": { "value": "*pasimage*" } } },
        { "wildcard": { "new_nas_image_url.keyword": { "value": "*bydefault*" } } }
      ]
    }
  }
}
```

The three `must_not` wildcards are media-placeholder exclusions, not market-platform matching.

## Google

Google uses a clean keyword `domain` field. Its market-platform lookup remains a single domain wildcard because the platform value is a substring such as `doubleclick` inside `ad.doubleclick.net`.

```http
GET google_ads_data_v2/_count
{
  "query": {
    "bool": {
      "filter": [
        {
          "bool": {
            "should": [
              { "wildcard": { "domain": { "value": "*branch*" } } }
            ],
            "minimum_should_match": 1
          }
        }
      ]
    }
  }
}
```

## Inspect matching documents

Change any `/_count` endpoint to `/_search`, add `size`, and request the relevant URL fields. Example:

```http
GET youtube_ads_data/_search
{
  "size": 10,
  "track_total_hits": true,
  "_source": ["ad_id", "redirect_urls", "destination_url", "last_seen"],
  "query": {
    "bool": {
      "filter": [
        {
          "bool": {
            "should": [
              { "wildcard": { "redirect_urls": { "value": "*branch*" } } },
              { "wildcard": { "destination_url": { "value": "*branch*" } } }
            ],
            "minimum_should_match": 1
          }
        }
      ]
    }
  }
}
```

Verify that the matching URL contains the platform marker. This also exposes false positives caused by broad values such as `branchen`.

## Efficiency comparison

### 1. Baseline

Run the relevant `/_count` query two or three times sequentially and record:

- `count`
- `took`
- index and platform value
- whether the result is warm-cache or first-run

### 2. Profile the current wildcard query once

Use the same query with `/_search`, `size: 0`, and `profile: true`:

```http
GET youtube_ads_data/_search
{
  "size": 0,
  "track_total_hits": true,
  "profile": true,
  "query": {
    "bool": {
      "filter": [
        {
          "bool": {
            "should": [
              { "wildcard": { "redirect_urls": { "value": "*branch*" } } },
              { "wildcard": { "destination_url": { "value": "*branch*" } } }
            ],
            "minimum_should_match": 1
          }
        }
      ]
    }
  }
}
```

Record `took` and `profile.shards[].searches[].query[].time_in_nanos`. Run this only once or twice in production because profiling adds overhead.

### 3. Optional constant-score rewrite experiment

The query already runs under `bool.filter`, so scoring is not needed. Elasticsearch supports wildcard rewrite methods; test this variant on one network before changing code:

```json
{
  "wildcard": {
    "destination_url": {
      "value": "*branch*",
      "rewrite": "constant_score"
    }
  }
}
```

Adopt it only if the count is identical and the profiled query time is lower. Do not use `constant_score_blended` because this cluster runs Elasticsearch 6.8.

### 4. Compare safely

Run the normal wildcard query and the rewrite variant:

- on the same index;
- with the same platform value;
- with the same fields and `size`;
- sequentially, never in parallel;
- preferably during a low-traffic window.

The result count must remain identical. A faster but lower count is not an optimization; it is a behavior change.

## Why the phrase query is not a valid control

This query is useful only to measure false negatives:

```http
GET youtube_ads_data/_count
{
  "query": {
    "multi_match": {
      "query": "branch",
      "type": "phrase",
      "fields": ["redirect_urls", "destination_url"]
    }
  }
}
```

Do not compare its lower count as an equivalent result. It misses substrings such as `_branch_match_id`, `branches`, and `branchen` depending on the field analyzer.

## Mapping and analyzer checks

Check one representative field per index:

```http
GET youtube_ads_data/_mapping/field/redirect_urls
GET youtube_ads_data/_mapping/field/destination_url
```

The current YouTube fields are `text` fields with a `.keyword` sub-field. The lookup intentionally targets the direct text field. Do not switch it to `.keyword`: that searches complete URL values and can be more expensive and less consistent with the current substring behavior.

Inspect tokenization when diagnosing a count difference:

```http
GET youtube_ads_data/_analyze
{
  "field": "destination_url",
  "text": "https://www.headspace.com/page?_branch_match_id=123&campaign=branches"
}
```

## Optional node observation

If permitted, capture one node-stat snapshot before and after the controlled test:

```http
GET _nodes/stats/os,indices/search
```

Compare `os.cpu.percent`, `indices.search.query_total`, and `indices.search.query_time_in_millis`. This is not an isolated benchmark because normal production traffic continues concurrently.

## References

- [Elasticsearch wildcard query](https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-wildcard-query)
- [Elasticsearch 6.8 compound queries](https://www.elastic.co/guide/en/elasticsearch/client/java-api/6.8/java-compound-queries.html)
