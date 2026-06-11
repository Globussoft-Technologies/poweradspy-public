import { Client } from "@elastic/elasticsearch";
import config from "config";

// For dev/prod
export const client = new Client({
  node:config.get("elasticsearch_url"),
  auth: {
    username: config.get("elasticsearch_username"),
    password: config.get("elasticsearch_password"),
  },
});

// For local
// export const client = new Client({
//   node:config.get("elasticsearch_url")
// });

import logger from "../resources/logs/logger.log.js";

// Creating index
export async function createIndex() {
  try {
    const indexName = "tiktok_ads";

    const body = {
      settings: {
        number_of_shards: 5,
        number_of_replicas: 1,
        analysis: {
          analyzer: {
            custom_analyzer: {
              type: "custom",
              tokenizer: "whitespace",
              char_filter: [],
              filter: [
                "preserve_special_chars",
                "autocomplete",
                "lowercase",
                "french_stop",
                "german_stop",
                "spanish_stop",
                "russian_stop",
                "french_keywords",
                "spanish_keywords",
                "russian_keywords",
                "german_keywords",
                "french_stemmer",
                "spanish_stemmer",
                "german_stemmer",
                "russian_stemmer",
              ],
            },
          },
          filter: {
            french_stop: {
              type: "stop",
              stopwords: "_french_",
            },
            german_stop: {
              type: "stop",
              stopwords: "_german_",
            },
            spanish_stop: {
              type: "stop",
              stopwords: "_spanish_",
            },
            russian_stop: {
              type: "stop",
              stopwords: "_russian_",
            },
            french_keywords: {
              type: "keyword_marker",
              keywords: ["Exemple"],
            },
            spanish_keywords: {
              type: "keyword_marker",
              keywords: ["ejemplo"],
            },
            russian_keywords: {
              type: "keyword_marker",
              keywords: ["пример"],
            },
            german_keywords: {
              type: "keyword_marker",
              keywords: ["Beispiel"],
            },
            french_stemmer: {
              type: "stemmer",
              language: "french",
            },
            spanish_stemmer: {
              type: "stemmer",
              language: "light_spanish",
            },
            german_stemmer: {
              type: "stemmer",
              language: "light_german",
            },
            russian_stemmer: {
              type: "stemmer",
              language: "russian",
            },
            preserve_special_chars: {
              type: "pattern_replace",
              pattern: "([^a-zA-Z0-9_.!? ])",
              replacement: "$1",
            },
            autocomplete: {
              type: "edge_ngram",
              min_gram: 1,
              max_gram: 20,
            },
          },
          normalizer: {
            lowercase_normalizer: {
              type: "custom",
              filter: ["lowercase"],
            },
          },
        },
      },
      mappings: {
        dynamic: true,
        dynamic_templates: [
          {
            new_field_creation: {
              match_mapping_type: "string",
              mapping: {
                type: "text",
                analyzer: "custom_analyzer",
                fields: {
                  keyword: {
                    type: "keyword",
                    normalizer: "lowercase_normalizer",
                  },
                },
              },
            },
          },
        ],
        properties: {
          ad_id: { type: "keyword" },
          type: { type: "keyword", normalizer: "lowercase_normalizer" },
          first_seen: { type: "date", format: "yyyy-MM-dd HH:mm:ss" },
          last_seen: { type: "date", format: "yyyy-MM-dd HH:mm:ss" },
          post_owner: { type: "keyword", normalizer: "lowercase_normalizer" },
          countries: { type: "keyword", normalizer: "lowercase_normalizer" },
          gender: {
            type: "object",
            dynamic: true,
            properties: {
              "*": {
                properties: {
                  male: { type: "integer" },
                  female: { type: "integer" },
                  unknown: { type: "integer" },
                },
              },
            },
          },
          age: {
            type: "object",
            dynamic: true,
            properties: {
              "*": {
                properties: {
                  "13-17": { type: "integer" },
                  "18-24": { type: "integer" },
                  "25-34": { type: "integer" },
                  "35-44": { type: "integer" },
                  "45-54": { type: "integer" },
                  "55+": { type: "integer" },
                },
              },
            },
          },
          ad_title: {
            type: "text",
            analyzer: "custom_analyzer",
            fields: {
              keyword: {
                type: "keyword",
                normalizer: "lowercase_normalizer",
              },
            },
          },

          platform: { type: "keyword", normalizer: "lowercase_normalizer" },
          destination_url: {
            type: "text",
            analyzer: "custom_analyzer",
          },
          video_url: { type: "text", analyzer: "custom_analyzer" },
          likes: { type: "integer" },
          comments: { type: "integer" },
          shares: { type: "integer" },
          source: { type: "text", analyzer: "custom_analyzer" },
          language: { type: "keyword", normalizer: "lowercase_normalizer" },
          ctr: { type: "float" },
          interest: { type: "keyword", normalizer: "lowercase_normalizer" },
          min_target_users: { type: "integer" },
          max_target_users: { type: "integer" },
          target_keywords: {
            type: "keyword",
            normalizer: "lowercase_normalizer",
          },
          affiliate_data: {
            type: "keyword",
            normalizer: "lowercase_normalizer",
          },
          built_with: { type: "keyword", normalizer: "lowercase_normalizer" },
          built_with_analytics_tracking: {
            type: "keyword",
            normalizer: "lowercase_normalizer",
          },
          popularity: { type: "integer" },
          impression: { type: "integer" },
          registered_date: { type: "date", format: "yyyy-MM-dd HH:mm:ss" },
          landerStatus: { type: "integer" },
          sql_id: { type: "integer" },
          post_owner_id: { type: "integer" },
          library_url: { type: "text", analyzer: "custom_analyzer" },
          landerData: {
            type: "nested",
            dynamic: true,
            properties: {},
          },
          remain_graph: {
            type: "nested",
            dynamic: true,
            properties: {},
          },
          conversion_graph: {
            type: "nested",
            dynamic: true,
            properties: {},
          },
          clicks_graph: {
            type: "nested",
            dynamic: true,
            properties: {},
          },
          cvr_graph: {
            type: "nested",
            dynamic: true,
            properties: {},
          },
          ctr_graph: {
            type: "nested",
            dynamic: true,
            properties: {},
          },
          budget: { type: "keyword", normalizer: "lowercase_normalizer" },
          industry: { type: "keyword", normalizer: "lowercase_normalizer" },
        },
      },
    };

    const response = await client.indices.create({
      index: indexName,
      body,
    });
    logger.info("Index created:", response);
    // console.log("Index created:", response);
  } catch (error) {
    logger.error("Error creating index:", error);
    // console.error("Error creating index:", error);
  }
}

// To check if index exists
export async function indexExists() {
  try {
    const exists = await client.indices.exists({
      index: "tiktok_ads",
    });
    if (exists) {
      return true;
    } else {
      return false;
    }
  } catch (error) {
    logger.error("Error checking index:", error);
    return false;
  }
}

export async function searchDoc(field, value) {
  try {
    const body = await client.search({
      index: "tiktok_ads",
      body: {
        query: {
          term: {
            [field]: value,
          },
        },
      },
    });
    if (body.hits.total.value === 0) {
      return null;
    }

    return body.hits.hits[0]?._source;
  } catch (error) {
    logger.error("Error fetching document:", error);
    // console.error("Error fetching document:", error);
    throw new Error("Error fetching document into Elasticsearch")
  }
}

export async function insertData(data) {
  try {
    const currentTime = new Date().toISOString();

    const body = await client.update({
      index: "tiktok_ads",
      id: data?.ad_id,
      doc: {
        ...data,
        updatedAt: currentTime,
      },
      upsert: {
        ...data,
        createdAt: currentTime,
        updatedAt: currentTime,
      }
    });
    return body;
  } catch (error) {
    logger.error("Error inserting data:", error);
    // console.error("Error inserting data:", error);
    throw new Error("Failed to insert data into Elasticsearch");
  }
}

export async function updateDocument(field, value, updatedFields) {
  try {
    const currentTimestamp = new Date().toISOString();

    updatedFields.updatedAt = currentTimestamp;

    const scriptSource = Object.entries(updatedFields)
      .map(([key]) => `ctx._source.${key} = params.${key}`)
      .join("; ");

    const body = await client.updateByQuery({
      index: "tiktok_ads",
      body: {
        query: {
          term: {
            [field]: value,
          },
        },
        script: {
          source: scriptSource,
          params: updatedFields,
        },
      },
    });
    return body;
  } catch (error) {
    logger.error("Error updating data:", error);
    throw new Error("Failed to insert data into Elasticsearch");
  }
}

export async function searchDocs(field, value) {
  try {
    const response = await client.search({
      index: "tiktok_ads",
      body: {
        query: {
          wildcard: {
            [field]: {
              value: `*${value}*`,
            },
          },
        },
      },
    });

    return response.hits.hits.map((hit) => hit._source);
  } catch (error) {
    logger.error("Error searching index document:", error);
    // console.error("Error searching index document:", error);
    return error;
  }
}

export async function deleteDoc(field, value) {
  try {
    const response = await client.deleteByQuery({
      index: "tiktok_ads",
      body: {
        query: {
          term: {
            [field]: value,
          },
        },
      },
    });
    return response;
  } catch (error) {
    logger.error("Error deleting document:", error);
    // console.error("Error deleting document:", error);
    throw new Error(error);
  }
}
export async function getAdsES(skip, limit) {
  try {
    const result = await client.search({
      index: "tiktok_ads",
      body: {
        from: skip,
        size: limit,
        query: {
          match_all: {},
        },
      },
    });
    return result.hits.hits.map((hit) => hit._source);
  } catch (error) {
    logger.error("Error fetching ads:", error);
    return false;
  }
}
export async function deleteAllIndexDoc() {
  try {
    const response = await client.deleteByQuery({
      index: "tiktok_ads",
      body: {
        query: {
          match_all: {},
        },
      },
    });
    return response;
  } catch (error) {
    // console.error("Error deleting all documents:", error);
    return false;
  }
}

export async function searchFilterAds(payload) {
  try {
    let {
      domain,
      advertiser,
      keyword,
      likes,
      comments,
      shares,
      popularity,
      impression,
      countryName,
      adSeen,
      adSeenStartDate,
      adSeenEndDate,
      domainReg,
      domainRegStartDate,
      domainRegEndDate,
      postDate,
      postStartDate,
      postEndDate,
      sortOrder,
      gender,
      age,
      industry,
      ctr,
      budget,
      language,
      skip,
      limit,
    } = payload;
  
    let minLikes = likes?.min || 0;
    let maxLikes = likes?.max || 10000000;
    let minComments = comments?.min || 0;
    let maxComments = comments?.max || 1000000;
    let minShares = shares?.min || 0;
    let maxShares = shares?.max || 1000000;
    let minPoularityRange = popularity?.min || 0;
    let maxPopularityRange = popularity?.max || 100;
    let minImpression = impression?.min || 0;
    let maxImpression = impression?.max || 10000000;
    let minCTR = (ctr?.min || 0)/100
    let maxCTR = ctr?.max ? (ctr?.max /100) : 100000000;

    let query = { bool: { must: [], should: [] } };
    const shouldFilters = [];
    let minimumShouldMatch = 1;

    if (keyword) {
      shouldFilters.push({
        bool: {
          should: [
            {
              wildcard: {
                "ad_title.keyword": {
                  value: `*${keyword.toLowerCase()}*`,
                },
              },
            },
            {
              wildcard: {
                industry: {
                  value: `*${keyword.toLowerCase()}*`,
                },
              },
            },
            {
              wildcard: {
                post_owner: {
                  value: `*${keyword.toLowerCase()}*`,
                },
              },
            },
            {
              wildcard: {
                target_keywords: {
                  value: `*${keyword.toLowerCase()}*`,
                },
              },
            },
          ],
          minimum_should_match: 1,
        },
      });
    }

    if (advertiser)
      shouldFilters.push({
        term: {
          post_owner: {
            value: `${advertiser.toLowerCase()}`,
          },
        },
      });

    if (domain) {
      shouldFilters.push({
        bool: {
          must: [
            {
             query_string: {
              default_field: "destination_url",
              query: `*${domain}*`
            }
          }
        ]
        }
      });
    }
    if (industry && industry.length>0 && industry != null && industry != undefined) {
      shouldFilters.push({
        terms: {
          industry: industry, 
        },
      });
    }

    if (gender?.length>0) {
      const genders = gender.map(gender => ({
        term: { [`gender.gender_details.${gender}`]: "1" }
      }));
      shouldFilters.push({
        bool: {
          should : genders,
          minimum_should_match: 1,
        },
      });
    }
    
    if (budget?.length>0) {
      shouldFilters.push({
        terms: {
          budget: budget 
        }
      });
    }
    
    if (age?.length>0 ) {
      const ageFilter = age.map(age => {
        if (age === "Above 55") {
          return { term: { "age.age_details.55+": "1" } };
        }
        return { term: { [`age.age_details.${age}`]: "1" } };
      });
      shouldFilters.push({
        bool: {
          should:ageFilter ,
          minimum_should_match: 1,
        },
      });
    } 

    if (language && language.length>0 && language != null && language != undefined) {
      shouldFilters.push({
        terms: {
          language: language, 
        },
      });
    }
    
    if (countryName && countryName.length>0 && countryName != null && countryName != undefined) {
      shouldFilters.push({
        terms: {
          countries: countryName,
        },
      });
    }

    if (likes) {
      shouldFilters.push({
        range: {
          likes: {
            gte: minLikes,
            lte: maxLikes,
          },
        },
      });
    }

    if (comments) {
      shouldFilters.push({
        range: {
          comments: {
            gte: minComments,
            lte: maxComments,
          },
        },
      });
    }

    if (shares) {
      shouldFilters.push({
        range: {
          shares: {
            gte: minShares,
            lte: maxShares,
          },
        },
      });
    }

    if (popularity) {
      shouldFilters.push({
        range: {
          popularity: {
            gte: minPoularityRange,
            lte: maxPopularityRange,
          },
        },
      });
    }

    if (impression) {
      shouldFilters.push({
        range: {
          impression: {
            gte: minImpression,
            lte: maxImpression,
          },
        },
      });
    }

    if (ctr) {
      shouldFilters.push({
        range: {
          ctr: {
            gte: minCTR,
            lte: maxCTR,
          },
        },
      });
    }

    let startOfDay, endOfDay;
    if (adSeenStartDate && adSeenEndDate) {
      let [startDay, startMonth, startYear] = adSeenStartDate.split("/");
      let [endDay, endMonth, endYear] = adSeenEndDate.split("/");

       startOfDay = new Date(`${startYear}-${startMonth}-${startDay}T00:00:00Z`);
       endOfDay = new Date(`${endYear}-${endMonth}-${endDay}T23:59:59Z`);
    }

    if (adSeen == "ALL") {
    } else {
      shouldFilters.push({
        range: {
          updatedAt: {
            gte: startOfDay,
            lte: endOfDay,
            format: "strict_date_optional_time",
          },
        },
      });
    }
    let startOfPostDay, endOfPostDay;
    if (postStartDate && postEndDate) {
      let [startDay, startMonth, startYear] = postStartDate.split("/");
      let [endDay, endMonth, endYear] = postEndDate.split("/");

      startOfPostDay = new Date(startYear, startMonth - 1, startDay);
      endOfPostDay = new Date(endYear, endMonth - 1, endDay);
    }

    if (postDate == "ALL") {
    } else {
      startOfPostDay.setHours(0, 0, 0, 0);
      endOfPostDay.setHours(23, 59, 59, 999);

      shouldFilters.push({
        range: {
          first_seen: {
            gte: startOfPostDay.toISOString(),
            lte: endOfPostDay.toISOString(),
            format: "strict_date_optional_time",
          },
        },
      });
    }

    let startOfRegDay, endOfRegDay;
    if (domainRegStartDate && domainRegEndDate) {
      let [startDay, startMonth, startYear] = domainRegStartDate.split("/");
      let [endDay, endMonth, endYear] = domainRegEndDate.split("/");

      startOfRegDay = new Date(startYear, startMonth - 1, startDay);
      endOfRegDay = new Date(endYear, endMonth - 1, endDay);
    }

    if (domainReg == "ALL") {
    } else {
      startOfRegDay.setHours(0, 0, 0, 0);
      endOfRegDay.setHours(23, 59, 59, 999);

      shouldFilters.push({
        range: {
          domain_registered_date: {
            gte: startOfRegDay.toISOString(),
            lte: endOfRegDay.toISOString(),
            format: "strict_date_optional_time",
          },
        },
      });
    }

    // console.log(shouldFilters);
    if (shouldFilters.length > 0) {
      minimumShouldMatch = shouldFilters.length;
    }

    if (shouldFilters.length > 0) {
      query.bool.must.push({
        bool: {
          should: shouldFilters,
          minimum_should_match: minimumShouldMatch,
        },
      });
    }

    // console.log("Query:", JSON.stringify(query, null, 2));

    query.bool.should.push({ match_all: {} });

    const response = await client.search({
      index: "tiktok_ads",
      body: {
        query,
        from: skip,
        size: limit,
        sort: [
          {
            [sortOrder]: { order: "desc" },
          },
        ],
        _source: [
          "sql_id",
          "likes",
          "comments",
          "shares",
          "ctr",
          "popularity",
          "impression",
          "ad_title",
          "video_url",
          "video_cover",
          "post_owner_id",
          "library_url",
          "ctr",
          "industry",
          "post_owner",
          "last_seen",
          "budget"
        ],
        track_total_hits: true,
        aggs: {
          total_ads: {
            cardinality: {
              field: "sql_id" 
            }
          }
        },
        collapse: {
          field: "sql_id"
        },
      },
    });

    const totalAds = response.hits.total.value;
    const searchFilterAds = response.aggregations.total_ads.value;
    const ads = response.hits.hits.map((hit) => hit._source);

    return { totalAds, ads,searchFilterAds  };
  } catch (error) {
    logger.error("Error searching with pagination and sorting:", error);
    // console.error("Error searching with pagination and sorting:", error);
    return false;
  }
}

export async function getAdsLander(indexName) {
  try {
    const response = await client.search({
      index: indexName,
      body: {
        _source: ["destination_url", "countries", "sql_id"],
        query: {
          term: {
            landerStatus: 0,
          },
        },
      },
      size: 10,
    });

    return response.hits.hits.map((hit) => {
      const { sql_id, ...rest } = hit._source;
      return {
        ad_id: sql_id,
        ...rest,
      };
    });
  } catch (error) {
    logger.error("Error searching index document:", error);
    // console.error("Error searching index document:", error);
    return error;
  }
}

export async function getHideFavAds(ids) {
  const HideFavAds = [];

  try {
    for (const idObj of ids) {
      const { sql_id, type } = idObj;
      const response = await client.search({
        index: "tiktok_ads",
        body: {
          query: {
            term: {
              sql_id: sql_id,
            },
          },
          _source: [
            "sql_id",
            "likes",
            "comments",
            "shares",
            "ctr",
            "popularity",
            "impression",
            "ad_title",
            "video_url",
            "video_cover",
            "post_owner_id",
            "library_url",
            "ctr",
            "industry",
            "post_owner",
            "last_seen",
            "budget"
          ],
        },
      });

      const fetchedAds = response.hits.hits.map((hit) => ({
        ...hit._source,
        type: type,
      }));
      HideFavAds.push(...fetchedAds);
    }

    return HideFavAds;
  } catch (error) {
   
  }

}

//get ads count
export async function getAdsCount(payload) {
  try {
    let { domain, keyword, advertiser } = payload;
    const shouldFilters = [];

    if (keyword) {
      shouldFilters.push({
        bool: {
          should: [
            {
              wildcard: {
                ad_title: {
                  value: `*${keyword.toLowerCase()}*`,
                },
              },
            },
            {
              wildcard: {
                post_owner: {
                  value: `*${keyword.toLowerCase()}*`,
                },
              },
            },
            {
              wildcard: {
                target_keywords: {
                  value: `*${keyword.toLowerCase()}*`,
                },
              },
            },
          ],
          minimum_should_match: 1,
        },
      });
    }

    if (advertiser) {
      shouldFilters.push({
        wildcard: {
          post_owner: {
            value: `*${advertiser.toLowerCase()}*`,
          },
        },
      });
    }

    if (domain) {
      shouldFilters.push({
        wildcard: {
          destination_url: {
            value: `*${domain.toLowerCase()}*`,
          },
        },
      });
    }

    const query = {
      bool: {
        should: shouldFilters,
        minimum_should_match: 1,
      },
    };

    const { count } = await client.count({
      index: 'tiktok_ads',
      body: {
        query: query,
      },
    });

    if (count > 0) {
      return count;
    } else {
      return 0;
    }
  } catch (error) {
    return 0;
  }
}

export async function getCountries(field) {
  try {
    const result = await client.search({
      index: "tiktok_ads",
      size: 0,
      body: {
        aggs: {
          industy_aggregation: {
            terms: {
              field,
              size: 100,
            },
          },
        },
      },
    });

    return result?.aggregations?.industy_aggregation?.buckets
  } catch (error) {
    logger.error(error);
    throw new Error(error);
  }
}

export async function getAllESAdId(skip, limit) {
  try {
    const result = await client.search({
      index: "tiktok_ads",
      body: {
        query: {
          match_all: {},
        },
        _source: ["ad_id"],
        from: skip, 
        size: limit
      },
    });
    return result.hits.hits.map((hit) => hit._source.ad_id);

  } catch (error) {
    logger.error("Error fetching ads:", error);
    throw new Error(error);
  }
}

export async function getAdsCountList(payload) {
  try {
    const {adSeen,range}= payload
    let queryFilter = { match_all: {} };

    if (adSeen !== "ALL") {
      const startDate = new Date(`${range?.from}T00:00:00.000Z`).toISOString();
      const endDate = new Date(`${range?.to}T23:59:59.999Z`).toISOString();

      queryFilter = {
        range: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          }
        }
      };
    }
    const response = await client.search({
      index: "tiktok_ads",
      size: 0,
      body: {
        query: queryFilter,
        aggs: {
          total_count: {
            global: {},
            aggs: {
              count: { value_count: { field: "platform" } }
            }
          },
          range_count: {
            filter: { range: { createdAt: queryFilter.range.createdAt } }
          },
          platform_counts: {
            terms: { field: "platform", include: ["3", "10", "12"] }
          }
        }
      }
    });

    let responseData = [];
    if(response?.aggregations){ 
    const platformBuckets = response?.aggregations?.platform_counts?.buckets || [];

      // Add platform-wise counts
      platformBuckets?.forEach(bucket => {
        responseData.push({
          platform: bucket.key,
          total_ads: bucket.doc_count
        });
      });
      
      // Add range total count
      responseData?.push({
        platform: "range_total",
        total_ads: response?.aggregations?.range_count?.doc_count || 0
      });
      
      // Add total count 
      responseData?.push({
        platform: "Total",
        total_ads: response?.aggregations?.total_count?.count?.value || 0
      });
      return responseData;
    } else { return []}
   
  } catch (error) {
    logger.error("Error fetching log file", error);
    return error;
  }
}

export async function getAdsCountGraphList() {
  try {
    let queryFilter = { match_all: {} };
    const response = await client.search({
      index: "tiktok_ads",
      size: 0,
      body: {
        query: {
          bool: {
            filter: [
              {
                range: {
                  createdAt: {
                    gte: "now-5M/M",
                    lte: "now/M"
                  }
                }
              }
            ]
          }
        }, 
        aggs: {
          platform_counts: {
            terms: { field: "platform", include: ["3", "10", "12"]},
            aggs: {
              monthly_data: {
                date_histogram: {
                  field: "createdAt",
                  calendar_interval: "month",
                  format: "yyyy-MM",
                  extended_bounds: {
                    min: "now-5M/M",
                    max: "now/M"
                  }
                }
              }
            }
          },
          total_data: {
            date_histogram: {
              field: "createdAt",
              calendar_interval: "month",
              format: "yyyy-MM",
              extended_bounds: {
                min: "now-5M/M",
                max: "now/M"
              }
            }
          }
        }
      }
    });
    
    let responseData = [];
    if(response?.aggregations){
      const platformBuckets = response?.aggregations?.platform_counts?.buckets || [];
      const totalBuckets = response?.aggregations?.total_data?.buckets || [];
      
      platformBuckets?.forEach(bucket => {
        responseData.push({
          platform: bucket?.key,
          data: bucket?.monthly_data?.buckets?.map(month => month?.doc_count)
        });
      });
      
      // Process total count data
      responseData?.push({
        platform: "Total",
        data: totalBuckets?.map(month => month?.doc_count)
      });
      
      return responseData 
    } else { return []}
  } catch (error) {
    logger.error("Error fetching log file", error);
    return error;
  }
}

//this function is used to get the updates of the ads
export async function getUpdates() {
  try {
    const start = Date.now();
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    const todayStart = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    )).toISOString();
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

   const yesterdayStart = new Date(Date.UTC(
   yesterday.getUTCFullYear(),
   yesterday.getUTCMonth(),
   yesterday.getUTCDate()
   )).toISOString();

    const yesterdayDate = yesterdayStart?.split('T')[0]; 
    const nowISO = now.toISOString();

    const response = await client.search({
      index: "tiktok_ads",
      size: 0,
      body: {
        query: { match_all: {} },
        aggs: {
          total_count: {
            value_count: { field: "platform" }
          },
          range_yesterday: {
            filter: {
              range: {
                createdAt: { gte: yesterdayStart, lt: todayStart }
              }
            },
            aggs: {
              platform_counts_yesterday: {
                terms: {
                  field: "platform",
                  include: ["3", "10", "12"]
                }
              }
            }
          },
          range_today: {
            filter: {
              range: {
                createdAt: { gte: todayStart, lt: nowISO }
              }
            }
          },
          range_total_yesterday: {  
            filter: {
              range: {
                updatedAt: { gte: yesterdayStart, lt: todayStart }
              }
            }
          }
        }
      }
    });

    const aggregations = response?.aggregations;
    const totalAds = aggregations?.total_count?.value;
    const yesterdayAds = aggregations?.range_yesterday?.doc_count;
    const todayAds = aggregations?.range_today?.doc_count;
    const buckets = aggregations?.range_yesterday?.platform_counts_yesterday?.buckets || [];
    const totalYesterDaysAds = aggregations?.range_total_yesterday?.doc_count;

    const platformNameMap = {
      '3': 'User Plugin',
      '10': 'Scroll Plugin',
      '12': 'Python'
    };
    
    const countMap = buckets.reduce((acc, bucket) => {
      acc[bucket?.key] = bucket?.doc_count;
      return acc;
    }, {});
    

    const newAdsPerPlatform = Object.entries(platformNameMap)
      .map(([key, name]) => `${name} (${key}): ${countMap[key] || 0}`)
      .join("\n        ");
    
  
    const output = `
Tiktok - ${todayStr}
—————————————————————————
Total Ads: ${totalAds}
—————————————————————————
Yesterday Total Ads (${yesterdayDate}): ${totalYesterDaysAds}
—————————————————————————
Yesterday Ads (${yesterdayDate}): ${yesterdayAds}
—————————————————————————
Today Ads (${todayStr}): ${todayAds}
—————————————————————————

New Ads per Platform - ${yesterdayDate}
        ${newAdsPerPlatform}

—————————————————————————
New Ads based on Type - ${yesterdayDate}
        VIDEO: ${yesterdayAds}

New Ads based on Position - ${yesterdayDate}
        FEED: ${yesterdayAds}

New Ads based on Source - ${yesterdayDate}
        desktop: ${yesterdayAds}

—————————————————————————
Time Taken: ${Date.now() - start}ms
`;

    return output;
  } catch (error) {
    // console.error("getUpdates error:", error);
    logger.error("Error fetching log file", error);
    return error;
  }
}

//function to get the country map details 
export async function getAdsCountCountryList(range) {
try {
  const response = await client.search({
    index: "tiktok_ads",
    size: 0,
    body: {
      query: {
        range: {
          createdAt: {
            gte: range?.from, 
            lte: range?.to, 
            format: "strict_date_optional_time"
          }
        }
      },
      aggs: {
        country_count: {
          terms: {
            field: "countries", 
          }
        }
      }
    }
  });
  
  const totalCount = response?.hits?.total?.value || 0;
  const data = response?.aggregations?.country_count?.buckets?.map(bucket => ({
    country: bucket?.key?.toUpperCase(),
    count: bucket?.doc_count
  }));
  
  data?.unshift({ country: "ALL", count: totalCount });
  return data  
} catch (error) {
  logger.error("Error fetching log file", error);
  return error;
}
}