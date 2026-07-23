require('dotenv').config()
const fs = require("fs");
const country_with_colors = require("../utils/country_with_colors.json")
const country_with_iso = require("../utils/country_with_iso.json")
const searchAllInstances = require("../es-connections/connection");


const ES_DATA = {
    facebook : {lastseen:'facebook_ad.last_seen',country:'country_only.country',es_id:0,index : process.env.FB_INDEX},
    instagram : {lastseen:"instagram_ad.last_seen",country:"instagram_country_only.country",es_id:3,index:process.env.INSTA_INDEX},
    // Migrated off the legacy nested google_text_search_mix to the flat
    // google_ads_data_v2 index. Its country field is already a `keyword` (no
    // `.keyword` subfield), so flag it to skip the `.keyword` suffix below.
    google : {lastseen:"last_seen",country:"country",countryIsKeyword:true,es_id:4,index:process.env.GT_INDEX || 'google_ads_data_v2'},
    quora : {lastseen:"quora_ad.last_seen",country:"quora_country_only.country",es_id:2,index:process.env.QUORA_INDEX},  
    native : {lastseen:"native_ad.last_seen",country:"native_country_only.country",es_id:1,index:process.env.NATIVE_INDEX},  
    gdn : {lastseen:"gdn_ad.last_seen",country:"gdn_country_only.country",es_id:2,index:process.env.GDN_INDEX},  
    pinterest : {lastseen:"pinterest_ad.last_seen",country:"pinterest_country_only.country",es_id:2,index:process.env.PINT_INDEX},  
    reddit : {lastseen:"reddit_ad.last_seen",country:"reddit_country_only.country",es_id:1,index:process.env.REDDIT_INDEX},  
    bing : {lastseen:"bing_text_ad.last_seen",country:"bing_text_country_only.country",es_id:0,index:process.env.BING_INDEX},  
    linkedin : {lastseen:"last_seen",country:"countries",es_id:1,index:process.env.LINKEDIN_INDEX},
    youtube : {lastseen:"last_seen", country:"countries",es_id:0, index:process.env.YT_INDEX}  
}

const countryStatsWithFilter = async (req, res) => {
    
  try {
    const { country, range, search_after,network } = req.body;
    let query = {};
    let responseType = "count";
 if(!network || !ES_DATA[network]) return res.status(400).json({message:"Please provide valid network"})
    // Country agg field: most networks store country as `text` with a
    // `.keyword` subfield, but some indices (e.g. google_ads_data_v2) store it as
    // a `keyword` directly — those set `countryIsKeyword` so we don't append
    // a non-existent `.keyword` subfield.
    const countryAggField = ES_DATA[network]['countryIsKeyword']
      ? ES_DATA[network]['country']
      : `${ES_DATA[network]['country']}.keyword`;
    if (!country && !range) {
      query = {
        size: 0,
        aggs: {
          countries_count: {
            composite: {
              size: 1000,
              sources: [
                {
                  country: { terms: { field: countryAggField } },
                },
              ],
            },
          },
        },
      };
      responseType = "agg";
      if (search_after) {
        query.aggs.countries_count.composite["after"] = {
          country: search_after,
        };
      }
    } else if (country && !range) {
      query = {
        query: {
          bool: { must: [{ match: { [ES_DATA[network]['country']]: country } }] },
        },
      };
    } else if (!country && range) {
      query = {
        size: 0,
        query: {
          range: {
            [ES_DATA[network]['lastseen']]: {
              gte: network === 'youtube' || network === 'linkedin' ? dateToEpoch(range.from,"start") :`${range.from} 00:00:00`,
              lte:network === 'youtube' || network === 'linkedin' ? dateToEpoch(range.to,"end") :`${range.to} 23:59:59`,
              format: network === 'youtube' || network === 'linkedin' ? "epoch_second" : "yyyy-MM-dd HH:mm:ss",
            },
          },
        },
        aggs: {
          countries_count: {
            composite: {
              size: 1000,
              sources: [
                {
                  country: { terms: { field: countryAggField } },
                },
              ],
            },
          },
        },
      };
      responseType = "agg";
      if (search_after) {
        query.aggs.countries_count.composite["after"] = {
          country: search_after,
        };
      }
    } else {
      // Reached only when (country && range) — the preceding three branches
      // exhaust every other combination of country/range truthiness.
      query = {
        query: {
          bool: {
            must: [
              { match: { [ES_DATA[network]['country']]: country } },
              {
                range: {
                    [ES_DATA[network]['lastseen']]: {
                    gte:network === 'youtube' || network === 'linkedin' ? dateToEpoch(range.from,"start") :`${range.from} 00:00:00`,
                    lte: network === 'youtube' || network === 'linkedin' ? dateToEpoch(range.to,"end") :`${range.to} 23:59:59`,
                    format: network === 'youtube' || network === 'linkedin' ? "epoch_second" : "yyyy-MM-dd HH:mm:ss",
                  },
                },
              },
            ],
          },
        },
      };
    }

    const countryCount = await searchAllInstances(
        ES_DATA[network]['index'],
      query,
      ES_DATA[network]['es_id'],
      responseType
    );
    const analytics =
      countryCount?.type === "agg"
        ? {
            type: countryCount?.type,
            total: countryCount?.data?.hits?.total,
            data: countryCount?.data?.aggregations?.countries_count.buckets.map(
              (e) => {
                return { country: e?.key?.country, count: e?.doc_count };
              }
            ),
            search_after:
              countryCount?.data?.aggregations?.countries_count.after_key,
          }
        : {
            type: countryCount?.type,
            total: countryCount?.data,
            data: [],
            search_after: null,
          };
          if(analytics.data.length > 0){
            return res.status(200).json(processAnalytics(country_with_iso, country_with_colors, analytics));
          }
    return res.status(200).json(analytics);
  } catch (error) {
    console.error("Error fetching country stats:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

function dateToEpoch(dateString, type = 'start') {
    const date = new Date(dateString);

    if (type === 'start') {
        date.setHours(0, 0, 0, 0);
    } else {
        // type === 'end' — the only other value any call site passes.
        date.setHours(23, 59, 59, 999);
    }

    return Math.floor(date.getTime() / 1000);
}

function processAnalytics(isoFile, colorFile, analyticFile) {
  const countryIso = isoFile;
  const countryColors = colorFile;
  const analytics = analyticFile;

  const result = {
      type: analytics.type,
      total: analytics.total,
      data: []
  };

  for (const entry of analytics.data) {
      const countryName = entry.country.trim();
      if (countryName && countryName.length > 2 && /^[A-Za-z ]+$/.test(countryName)) {
          const code = Object.keys(countryIso).find(key => countryIso[key]?.toLowerCase() === countryName?.toLowerCase());
          if (code && countryColors[code]) {
              result.data.push({ ...entry, code, color: countryColors[code].color });
          }
      }
  }
result["search_after"] = analyticFile?.search_after
  return result;
}

module.exports = { countryStatsWithFilter };
