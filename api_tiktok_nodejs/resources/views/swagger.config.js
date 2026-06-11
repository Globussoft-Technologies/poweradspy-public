import swaggerAutogen from "swagger-autogen";
const swagger = swaggerAutogen();
import config from "config";

const doc = {
  info: {
    version: "1.0",
    title: "TikTok APIs",
    description: "Tiktok API Documentation",
  },
  host: config.get("swagger_host_url"),
  basePath: "/",
  schemes: ["http", "https"],
  consumes: ["application/json", "application/x-www-form-urlencoded"],
  produces: ["application/json"],
  tags: [],

  definitions: {
    Create: {
      ad_id: "7179559036886466567",
      ad_title: "43% OFF!",
      video_id: "v12025gd0000cnuio0fog65lheum455g",
      video_url:
        "https://contents.poweradspy.com/pasvideos/reddit/t3_1b3snpp.mp4",
      video_duration: 14.067,
      video_cover:
        "https://p16-sign-va.tiktokcdn.com/tos-maliva-p-0068c799-us/oY3wIkEDMFfHErhAWLS6EKWQArFX3rAfrBCBeA~tplv-noop.image?x-expires=1713291452&x-signature=uYss%2B1d0rvjVpSKyL9hHoumMfkU%3D",
      library_url:
        "https://ads.tiktok.com/business/creativecenter/topads/7179559036886466562/pc/en?countryCode=US&period=30",
      post_owner: "TOYMAKES100",
      destination_url:
        "https://toymakes.com/products/bubble-gun?utm_campaign=tiktok_ads_b7310716-1bfa-4dcd-87af-b928a3726d12&utm_medium=video_ad&utm_source=tiktok",
      likes: 36881,
      comments: 345,
      shares: 1231,
      countries: [
        "PL",
        "EG",
        "SA",
        "ZA",
        "TR",
        "AE",
        "US",
        "CA",
        "DE",
        "IT",
        "NL",
        "PT",
        "DK",
        "GR",
        "FR",
        "IE",
        "ES",
        "GB",
        "CZ",
        "BE",
        "CH",
        "TH",
        "AT",
        "KW",
        "RO",
        "SE",
        "MA",
        "HU",
        "ID",
        "KR",
        "QA",
        "FI",
        "NO",
        "MY",
        "AU",
        "MX",
        "PK",
      ],
      cost: 1,
      ctr: 0.03,
      source: "TikTok Ads Manager",
      objectives: ["Product Sales", "Traffic", "Conversion", "Lead Generation"],
      target_keywords: [
        "gatling bubble machine",
        "swipe left to see",
        "free shipping this week only",
        "bazooka bubble gun",
        "get yours 50% off",
      ],
      type: "VIDEO",
      platform: "12",
      first_seen: "1676831400",
      last_seen: "1678127400",
      unique_users: "8K",
      target_users: "24.3M",
      ad_paid_for: "DANTES Pro Boxing Gear",
      post_owner_location: "Netherlands",
      audience: "No",
      interest: "No",
      video_interection: "No",
      creator_interactions: "No",
      gender: {
        Belgium: ["1", "1", "1"],
        Netherlands: ["1", "1", "1"],
        chennai: ["1"],
      },
      age: {
        Belgium: ["1", "1", "1", "1", "1"],
        Netherlands: ["0", "1", "1", "1", "1", "1"],
        Chennai: ["0", "1", "1", "1", "1", "1"],
      },
      country_users: {
        Belgium: "6K",
        Netherlands: "0-1K",
      },
      budget: "Medium",
      industry: "Product Sales & marketing services",
      top_ctr: "6%",
      top_cvr: "5%",
      top_clicks: "5%",
      top_conversion: "2.5%",
      top_remains: "4%",
      ctr_graph: [
        {
          second: 0,
          value: 0.11466125240435991,
        },
        {
          second: 1,
          value: 0.2412908741184014,
        },
        {
          second: 2,
          value: 0.22611669160076941,
        },
        {
          second: 3,
          value: 0.1207522974994657,
        },
        {
          second: 4,
          value: 0.11027997435349433,
        },
        {
          second: 5,
          value: 0.11476811284462492,
        },
        {
          second: 6,
          value: 0.29215644368454796,
        },
        {
          second: 7,
          value: 0.5,
        },
        {
          second: 8,
          value: 0.49326779226330414,
        },
        {
          second: 9,
          value: 0.4496687326351785,
        },
        {
          second: 10,
          value: 0.3022013250694593,
        },
        {
          second: 11,
          value: 0.21649925197691816,
        },
        {
          second: 12,
          value: 0.10215332727980282,
        },
        {
          second: 13,
          value: 0.16584511609806718,
        },
        {
          second: 14,
          value: 1,
        },
      ],
      cvr_graph: [
        {
          second: 0,
          value: 0.16406249999999997,
        },
        {
          second: 1,
          value: 0.1484375,
        },
        {
          second: 2,
          value: 0.1796875,
        },
        {
          second: 3,
          value: 0.109375,
        },
        {
          second: 4,
          value: 0.1171875,
        },
        {
          second: 5,
          value: 0.10156249999999999,
        },
        {
          second: 6,
          value: 0.3125,
        },
        {
          second: 7,
          value: 0.3984375,
        },
        {
          second: 8,
          value: 0.5,
        },
        {
          second: 9,
          value: 0.421875,
        },
        {
          second: 10,
          value: 0.34375,
        },
        {
          second: 11,
          value: 0.234375,
        },
        {
          second: 12,
          value: 0.1191135734072022,
        },
        {
          second: 13,
          value: 0.23268698060941825,
        },
        {
          second: 14,
          value: 1,
        },
      ],
      clicks_graph: [
        {
          second: 0,
          value: 0.22448802499132245,
        },
        {
          second: 1,
          value: 0.32480041652204095,
        },
        {
          second: 2,
          value: 0.22474835126692122,
        },
        {
          second: 3,
          value: 0.10855605692467893,
        },
        {
          second: 4,
          value: 0.09250260326275599,
        },
        {
          second: 5,
          value: 0.08859770912877474,
        },
        {
          second: 6,
          value: 0.17788962165914612,
        },
        {
          second: 7,
          value: 0.2552933009371746,
        },
        {
          second: 8,
          value: 0.2326449149600833,
        },
        {
          second: 9,
          value: 0.2032280458174245,
        },
        {
          second: 10,
          value: 0.1333738285317598,
        },
        {
          second: 11,
          value: 0.09337035751475183,
        },
        {
          second: 12,
          value: 0.13484901076015274,
        },
        {
          second: 13,
          value: 0.18977785491148907,
        },
        {
          second: 14,
          value: 1,
        },
      ],
      conversion_graph: [
        {
          second: 0,
          value: 0.37777777777777777,
        },
        {
          second: 1,
          value: 0.23703703703703705,
        },
        {
          second: 2,
          value: 0.2074074074074074,
        },
        {
          second: 3,
          value: 0.1111111111111111,
        },
        {
          second: 4,
          value: 0.11851851851851852,
        },
        {
          second: 5,
          value: 0.08888888888888889,
        },
        {
          second: 6,
          value: 0.2222222222222222,
        },
        {
          second: 7,
          value: 0.23703703703703705,
        },
        {
          second: 8,
          value: 0.2740740740740741,
        },
        {
          second: 9,
          value: 0.2222222222222222,
        },
        {
          second: 10,
          value: 0.17777777777777778,
        },
        {
          second: 11,
          value: 0.11851851851851852,
        },
        {
          second: 12,
          value: 0.15555555555555556,
        },
        {
          second: 13,
          value: 0.26666666666666666,
        },
        {
          second: 14,
          value: 1,
        },
      ],
      remain_graph: [
        {
          second: 0,
          value: 0.11466125240435991,
        },
        {
          second: 1,
          value: 0.2412908741184014,
        },
        {
          second: 2,
          value: 0.22611669160076941,
        },
        {
          second: 3,
          value: 0.1207522974994657,
        },
        {
          second: 4,
          value: 0.11027997435349433,
        },
        {
          second: 5,
          value: 0.11476811284462492,
        },
        {
          second: 6,
          value: 0.29215644368454796,
        },
        {
          second: 7,
          value: 0.5,
        },
        {
          second: 8,
          value: 0.49326779226330414,
        },
        {
          second: 9,
          value: 0.4496687326351785,
        },
        {
          second: 10,
          value: 0.3022013250694593,
        },
        {
          second: 11,
          value: 0.21649925197691816,
        },
        {
          second: 12,
          value: 0.10215332727980282,
        },
        {
          second: 13,
          value: 0.16584511609806718,
        },
        {
          second: 14,
          value: 1,
        },
      ],
      city: "Bengaluru",
      state: "Karnataka",
    },

    Update: {
      ad_id: "7179559036886466567",
      ad_title: "43% OFF!",
      video_id: "v12025gd0000cnuio0fog65lheum455g",
      video_url:
        "https://v16m-default.akamaized.net/545149f468286c6f41dee58349bb97de/66479fad/video/tos/maliva/tos-maliva-ve-0068c799-us/oQNBiAhXrC5oi326IQEqiPKDp9fCyEA9IBgIwY/?a=0&bti=NTU4QDM1NGA%3D&ch=0&cr=0&dr=0&lr=tiktok_business&cd=0%7C0%7C0%7C0&cv=1&br=1642&bt=821&cs=0&ds=3&ft=.cwOVInz7ThI7rzrXq8Zmo&mime_type=video_mp4&qs=0&rc=ODc7Mzc4aGdlOmZmO2VpN0BpMzU5eXM5cjZpcTMzZzczNEBhMWJiY2MuNTAxMjMyMTZfYSMyLmBfMmQ0YHFgLS1kMS9zcw%3D%3D&vvpl=1&l=202405171218389510022983900B821EB7&btag=e00088000",
      video_duration: 14.067,
      video_cover:
        "https://p16-sign-va.tiktokcdn.com/tos-maliva-p-0068c799-us/oY3wIkEDMFfHErhAWLS6EKWQArFX3rAfrBCBeA~tplv-noop.image?x-expires=1713291452&x-signature=uYss%2B1d0rvjVpSKyL9hHoumMfkU%3D",
      library_url:
        "https://ads.tiktok.com/business/creativecenter/topads/7179559036886466562/pc/en?countryCode=US&period=30",
      post_owner: "TOYMAKES100",
      destination_url:
        "https://toymakes.com/products/bubble-gun?utm_campaign=tiktok_ads_b7310716-1bfa-4dcd-87af-b928a3726d12&utm_medium=video_ad&utm_source=tiktok",
      likes: 36881,
      comments: 345,
      shares: 1231,
      countries: [
        "PL",
        "EG",
        "SA",
        "ZA",
        "TR",
        "AE",
        "US",
        "CA",
        "DE",
        "IT",
        "NL",
        "PT",
        "DK",
        "GR",
        "FR",
        "IE",
        "ES",
        "GB",
        "CZ",
        "BE",
        "CH",
        "TH",
        "AT",
        "KW",
        "RO",
        "SE",
        "MA",
        "HU",
        "ID",
        "KR",
        "QA",
        "FI",
        "NO",
        "MY",
        "AU",
        "MX",
        "PK",
      ],
      cost: 1,
      ctr: 0.03,
      source: "TikTok Ads Manager",
      objectives: ["Product Sales", "Traffic", "Conversion", "Lead Generation"],
      target_keywords: [
        "gatling bubble machine",
        "swipe left to see",
        "free shipping this week only",
        "bazooka bubble gun",
        "get yours 50% off",
      ],
      type: "VIDEO",
      platform: "12",
      first_seen: "1676831400",
      last_seen: "1678127400",
      unique_users: "8K",
      target_users: "24.3M",
      ad_paid_for: "DANTES Pro Boxing Gear",
      post_owner_location: "Netherlands",
      audience: "No",
      interest: "No",
      video_interection: "No",
      creator_interactions: "No",
      gender: {
        Belgium: ["1", "1", "1"],
        Netherlands: ["1", "1", "1"],
        chennai: ["1"],
      },
      age: {
        Belgium: ["1", "1", "1", "1", "1"],
        Netherlands: ["0", "1", "1", "1", "1", "1"],
        Chennai: ["0", "1", "1", "1", "1", "1"],
      },
      country_users: {
        Belgium: "6K",
        Netherlands: "0-1K",
      },
      budget: "Medium",
      top_ctr: "6%",
      top_cvr: "5%",
      top_clicks: "5%",
      top_conversion: "2.5%",
      top_remains: "4%",
      ctr_graph: [
        {
          second: 0,
          value: 0.11466125240435991,
        },
        {
          second: 1,
          value: 0.2412908741184014,
        },
        {
          second: 2,
          value: 0.22611669160076941,
        },
        {
          second: 3,
          value: 0.1207522974994657,
        },
        {
          second: 4,
          value: 0.11027997435349433,
        },
        {
          second: 5,
          value: 0.11476811284462492,
        },
        {
          second: 6,
          value: 0.29215644368454796,
        },
        {
          second: 7,
          value: 0.5,
        },
        {
          second: 8,
          value: 0.49326779226330414,
        },
        {
          second: 9,
          value: 0.4496687326351785,
        },
        {
          second: 10,
          value: 0.3022013250694593,
        },
        {
          second: 11,
          value: 0.21649925197691816,
        },
        {
          second: 12,
          value: 0.10215332727980282,
        },
        {
          second: 13,
          value: 0.16584511609806718,
        },
        {
          second: 14,
          value: 1,
        },
      ],
      cvr_graph: [
        {
          second: 0,
          value: 0.16406249999999997,
        },
        {
          second: 1,
          value: 0.1484375,
        },
        {
          second: 2,
          value: 0.1796875,
        },
        {
          second: 3,
          value: 0.109375,
        },
        {
          second: 4,
          value: 0.1171875,
        },
        {
          second: 5,
          value: 0.10156249999999999,
        },
        {
          second: 6,
          value: 0.3125,
        },
        {
          second: 7,
          value: 0.3984375,
        },
        {
          second: 8,
          value: 0.5,
        },
        {
          second: 9,
          value: 0.421875,
        },
        {
          second: 10,
          value: 0.34375,
        },
        {
          second: 11,
          value: 0.234375,
        },
        {
          second: 12,
          value: 0.1191135734072022,
        },
        {
          second: 13,
          value: 0.23268698060941825,
        },
        {
          second: 14,
          value: 1,
        },
      ],
      clicks_graph: [
        {
          second: 0,
          value: 0.22448802499132245,
        },
        {
          second: 1,
          value: 0.32480041652204095,
        },
        {
          second: 2,
          value: 0.22474835126692122,
        },
        {
          second: 3,
          value: 0.10855605692467893,
        },
        {
          second: 4,
          value: 0.09250260326275599,
        },
        {
          second: 5,
          value: 0.08859770912877474,
        },
        {
          second: 6,
          value: 0.17788962165914612,
        },
        {
          second: 7,
          value: 0.2552933009371746,
        },
        {
          second: 8,
          value: 0.2326449149600833,
        },
        {
          second: 9,
          value: 0.2032280458174245,
        },
        {
          second: 10,
          value: 0.1333738285317598,
        },
        {
          second: 11,
          value: 0.09337035751475183,
        },
        {
          second: 12,
          value: 0.13484901076015274,
        },
        {
          second: 13,
          value: 0.18977785491148907,
        },
        {
          second: 14,
          value: 1,
        },
      ],
      conversion_graph: [
        {
          second: 0,
          value: 0.37777777777777777,
        },
        {
          second: 1,
          value: 0.23703703703703705,
        },
        {
          second: 2,
          value: 0.2074074074074074,
        },
        {
          second: 3,
          value: 0.1111111111111111,
        },
        {
          second: 4,
          value: 0.11851851851851852,
        },
        {
          second: 5,
          value: 0.08888888888888889,
        },
        {
          second: 6,
          value: 0.2222222222222222,
        },
        {
          second: 7,
          value: 0.23703703703703705,
        },
        {
          second: 8,
          value: 0.2740740740740741,
        },
        {
          second: 9,
          value: 0.2222222222222222,
        },
        {
          second: 10,
          value: 0.17777777777777778,
        },
        {
          second: 11,
          value: 0.11851851851851852,
        },
        {
          second: 12,
          value: 0.15555555555555556,
        },
        {
          second: 13,
          value: 0.26666666666666666,
        },
        {
          second: 14,
          value: 1,
        },
      ],
      remain_graph: [
        {
          second: 0,
          value: 0.11466125240435991,
        },
        {
          second: 1,
          value: 0.2412908741184014,
        },
        {
          second: 2,
          value: 0.22611669160076941,
        },
        {
          second: 3,
          value: 0.1207522974994657,
        },
        {
          second: 4,
          value: 0.11027997435349433,
        },
        {
          second: 5,
          value: 0.11476811284462492,
        },
        {
          second: 6,
          value: 0.29215644368454796,
        },
        {
          second: 7,
          value: 0.5,
        },
        {
          second: 8,
          value: 0.49326779226330414,
        },
        {
          second: 9,
          value: 0.4496687326351785,
        },
        {
          second: 10,
          value: 0.3022013250694593,
        },
        {
          second: 11,
          value: 0.21649925197691816,
        },
        {
          second: 12,
          value: 0.10215332727980282,
        },
        {
          second: 13,
          value: 0.16584511609806718,
        },
        {
          second: 14,
          value: 1,
        },
      ],
      city: "Bengaluru",
      state: "Karnataka",
    },
    UpdateVideoCover:{
        ad_id:7,
        video_cover:"https://p19-cc-sign-sg.tiktokcdn.com/v0201/v10033g50000crseau7og65pq3nb3uhg/1575517216/249~tplv-yenboaefse-image.jpeg?lk3s=317596d8&x-expires=1730357869&x-signature=Wi7nBgDn13XLeP26sYiYtiwU6Ss%3D&quot"
    },
    getVideoUrl :{
        ad_url:"https://ads.tiktok.com/business/creativecenter/topads/7179559036886466562/pc/en?countryCode=US&period=30"
    },
    FilterDetails: {
      ad_title: ["Fun ads", "cinematic ads"],
      type: ["Vide0", "Image", "Gif"],
      countries: ["India", "United states", "Itali"],
      category: ["Entertainment", "Education"],
      genders: ["Male", "Female"],
      first_seen: {
        startDate: "2022-03-11",
        endDate: "2022-03-21",
      },
      last_seen: {
        startDate: "2022-03-11",
        endDate: "2022-03-21",
      },
      AdsPostedDate: {
        startDate: "2022-03-11",
        endDate: "2022-03-21",
      },
      Objects: ["Cars", "Bikes", "Apples"],
      brandlogo: ["Accenture", "Wipro", "Amazon"],
      celebrity: ["Aamirkan", "Darshan"],
      keyword: "unused info",
      likes: {
        min: 0,
        max: 100,
      },
      shares: {
        min: 0,
        max: 100,
      },
      comments: {
        min: 0,
        max: 100,
      },
      target_users: {
        min: 0,
        max: 2000,
      },
      target_keywords: ["Fashion", "Trends"],
      platform: [1, 2, 3],
      objectives: ["Awareness", "Engagement"],
      interest: ["Fashion", "Games"],
      gender: {
        male: 1,
        female: 1,
        unknown: 0,
      },
      ages: {
        "13-17": 1,
        "18-24": 0,
        "25-34": 0,
        "35-44": 0,
        "45-54": 0,
      },
    },
    LCS: {
      id: "1",
      likes: 1,
      comments: 2,
      shares: 3,
    },

    Search_Filter: {
      keyword: "",
      advertiser: "",
      likes: {
        min: "0",
        max: "",
      },
      domain: "",

      comments: {
        min: 0,
        max: "",
      },
      shares: {
        min: 0,
        max: "",
      },
      popularity: {
        min: 0,
        max: "",
      },
      impression: {
        min: 0,
        max: "",
      },
      country: [],
      adSeen: "ALL", //by default ALL
      adSeenStartDate: "",
      adSeenEndDate: "",
      domainReg: "ALL", //by default ALL
      domainRegStartDate: "",
      domainRegEndDate: "",
      sortBy: "Newest", //by default Newest
      gender: "",
      age: "",
      budget:"",
      language: [],
      skip: 0,
      limit: 20,
    },
    getAdsCount:{
        keyword:"",
        domain:"",
        advertiser:""
    },
    LanderData: {
      ad_id: 2,
      redirects: [],
      outgoing_url: [],
      destinations:
        "https: //www.facebook.com/login/?next=https%3A%2F%2Fwww.facebook.com%2Fads%2Fig_redirect%2F%3Fd%3DAd-d3JihP4vR6F7nZZMz59LASHQGySZmcBTjNnKfzgp4RnOfb6eHUgri_iyIuSAlDN6059vGuQSEcdemLH6fFwNcmwKpKvxn2pfh2aspVKrpIOLBEYPplx_VFxFtbJU1X-2Q7aQs8n_BOpHr1llEjAJCJd7Pj70_5vSMvht-FeJfJjuPYGGsUZUjb7b9nKRjGCkXl7yPlHQAyhw37PEOAoadKh912trA2LMQ6hwIRa6tVRVkIdKbkFNxBZP2cR9FZCI0ogfrnmdGfQj_1ZNcpwrdRgvMgH-e2-csxFPAPqRHlRep4v2LW6o4SrFNJUYdzjJeWnEEdxceTgPbHC5lU8T2Dnvkyjtz4kO1gfBU8WIJimscVbGk5Ch3KI0z2fl6dZdRYNAxR6jB1b6suXDLpcJmJzSzvnUQtDqhNInmVw9uyVMceHE_8nOKZ6RUCLSo4HE%26a%3D1%26hash%3DAd_mudXXi4mYn8mvlDM",
      country_iso: "us",
      html_path: "29505117_us_2_1711557898.zip",
      html_content:
        "Facebook Email or phone Password Forgot account? Create new account You’re Temporarily Blocked You’re Temporarily Blocked It looks like you were misusing this feature by going too fast. You’ve been temporarily blocked from using it. English (US) Español Français (France) 中文(简体) العربية Português (Brasil) Italiano 한국어 Deutsch हिन्दी 日本語 Sign Up Log In Messenger Facebook Lite Video Places Games Marketplace Meta Pay Meta Store Meta Quest Imagine with Meta AI Instagram Threads Fundraisers Services Voting Information Center Privacy Policy Privacy Center Groups About Create ad Create Page Developers Careers Cookies Ad choices Terms Help Contact Uploading & Non-Users Settings Activity log Meta © 2024",
      screen_shot: "29505117_us_2_1711557897.png",
      status: 2,
      domain_age: 1,
      domain_registered_date: "1997-03-29",
      IsDataCenterProxy: 1,
      crawled_by: "python",
      ad_category: [],
    },
    Ads_Location: {
      ad_id: "123",
      countries: [
        "PL",
        "EG",
        "SA",
        "ZA",
        "TR",
        "AE",
        "US",
        "CA",
        "DE",
        "IT",
        "NL",
        "PT",
        "DK",
        "GR",
        "FR",
        "IE",
        "ES",
        "GB",
        "CZ",
        "BE",
        "CH",
        "TH",
        "AT",
        "KW",
        "RO",
        "SE",
        "MA",
        "HU",
        "ID",
        "KR",
        "QA",
        "FI",
        "NO",
        "MY",
        "AU",
        "MX",
        "PK",
      ],
      state: "Karnataka",
      city: "Bengaluru",
    },
    CountryAge: {
      ad_id: 12,
      country_name: "Netherlands",
      age_details: {
        Belgium: ["0", "1", "1", "1", "1", "1"],
        Netherlands: ["0", "1", "1", "1", "1", "1"],
      },
    },
    CreateCountry: {
      iso: "US",
      name: "United States",
      nicename: "USA",
      iso3: "USA",
      numcode: 840,
      phonecode: 1,
    },
    CreateUserAction: {
      amember_id:"10",
      user_name:"arun",
      amember_email:"arun@globussoft.in",
      userSubscription:"69",
      ad_count:20,
      month_count:20,
      date:"",
      start_date:"",
      end_date:""
  },
    AddKeywords: {
      keywords:["samsung","hand bag"]
    },
    CountryGender: {
      ad_id: 12,
      gender_details: {
        Belgium: ["1", "1", "1"],
        Netherlands: ["1", "1", "1"],
      },
    },
    Hide_favourite_Ads_API: {
      user_id: 456889,
      ad_id: "12356",
      post_owner_id: "26",
      type: 2,
      status: 0,
      platform: "tiktok",
    },
    Hide_Fav_GET_API:{
        type:3,
        user_id:123
    },
    Hide_favourite_Ads: {
      user_id: 456,
      ad_id: 12,
      post_owner_id: 25,
      type: "Video",
      status: 1,
      is_notified: "NO",
      is_requested: "NO",
      lcs_status: "NO",
    },
    Keyword_notification: {
      user_id: 6,
      name: "arun",
      email: "arun@gmail.com",
      keyword: "laptops",
      duration: 1,
      type: 2,
    },
    Keyword_notification_Get_Keywords:{
     user_id:1
    },
    MetaData_Create: {
      ad_id: "abc123",
      video_url: "https://example.com/video.mp4",
      video_duration: "00:02:30",
      video_cover: "https://example.com/cover.jpg",
      platform: 12,
      destination_url: "https://example.com/landing",
      source: "Organic",
      cost: 50.25,
      ctr: 0.05,
      library_url: "https://example.com/library",
      ad_paid_for: "Promotion",
      audience: "Young adults",
      interest: "Fashion",
      video_interection: "NO",
      creator_interactions: "NO",
      published_countries_count: 10,
      target_users: "24.3M",
      top_clicks: "5%",
      objectives: ["Awareness", "Engagement"],
      target_keywords: ["Fashion", "Trends"],
      top_ctr: "6%",
      ctr_graph: [
        {
          second: 0,
          value: 0.11466125240435991,
        },
      ],
      top_cvr: "6%",
      cvr_graph: [{ second: 8, value: 56 }],
      clicks_graph: [{ second: 8, value: 56 }],
      top_conversion: "2%",
      conversion_graph: [{ second: 8, value: 56 }],
      top_remains: "5%",
      remain_graph: [{ second: 8, value: 56 }],
      affiliate_status: "5",
      affiliate_data: "word",
      built_with_status: "6",
      built_with_data: "word press",
      built_with_analytics_tracking: "6",
    },
    PostOwnerCreate: {
      post_owner: "arunkumar",
      ads_count: "123",
    },
    PostOwnerUpdate: {
      post_owner: "kumar",
      ads_count: "123",
    },
    AddUserRequest: {
      user_id: 1,
      name:"arun",
      email:"arun@gmail.com",
      user_type: 0,
      keywords: "google",
      advertiser: "gom.com",
      url: "http//:www.idon'tknow.com",
      country: "India",
    },
    GetUserRequest:{
     user_id :1
    },
    GetAdsCountList:{
        adSeen:"",
        adSeenStartDate:"27/12/2024",
        adSeenEndDate:"27/12/2024"
    },
    Variants_Create: {
      ad_id: "1",
      ad_title: "Dummy Ad 1",
      newsfeed_description: "A dummy description for the newsfeed.",
      video_url_original:
        "https://v16m-default.akamaized.net/857e027200fd0d4db2c469ac653293e3/661ec0bc/video/tos/maliva/tos-maliva-ve-0068c799-us/oAQE9FLFSCGKHrDTIfZ2ZkgAEsL3WfrBEfwArB/?a=0&bti=NTU4QDM1NGA%3D&ch=0&cr=0&dr=0&lr=tiktok_business&cd=0%7C0%7C0%7C0&cv=1&br=3730&bt=1865&cs=0&ds=3&ft=.cwOVInz7ThH-bcrXq8Zmo&mime_type=video_mp4&qs=0&rc=ZDZpNmY1NGRpNWk6Njo7NUBpajhwaG85cjNscTMzZzgzNEA2MTFjLjBiNTAxM2MxXjYyYSMyMXJlMmRjbHJgLS1kLy9zcw%3D%3D&vvpl=1&l=021713269838788fe80000000000000786147fffee32ed3f67fb1&btag=e00088000",
      video_url:
        "https://v16m-default.akamaized.net/857e027200fd0d4db2c469ac653293e3/661ec0bc/video/tos/maliva/tos-maliva-ve-0068c799-us/oAQE9FLFSCGKHrDTIfZ2ZkgAEsL3WfrBEfwArB/?a=0&bti=NTU4QDM1NGA%3D&ch=0&cr=0&dr=0&lr=tiktok_business&cd=0%7C0%7C0%7C0&cv=1&br=3730&bt=1865&cs=0&ds=3&ft=.cwOVInz7ThH-bcrXq8Zmo&mime_type=video_mp4&qs=0&rc=ZDZpNmY1NGRpNWk6Njo7NUBpajhwaG85cjNscTMzZzgzNEA2MTFjLjBiNTAxM2MxXjYyYSMyMXJlMmRjbHJgLS1kLy9zcw%3D%3D&vvpl=1&l=021713269838788fe80000000000000786147fffee32ed3f67fb1&btag=e00088000",
    },
    built_with: {
      id: "22",
      built_with: "shoppify",
      built_with_cms: "",
      built_with_analytics_tracking: "",
      affiliate_data: "",
      status: "3",
    },
    Login:{
      username: "username",
      password: "password"
    },
    UserDetails: {
      token: "token"
    }
  },
  securityDefinitions: {
    BearerAuth: {
      type: 'apiKey',
      name: 'authorization',
      in: 'header',
      description: 'Enter your bearer token in the format **Bearer <token>**',
    },
  },
  security: [
    {
      BearerAuth: [],
    },
  ],
};

const outputFile = "./resources/views/swagger-api-view.json";
const endpointsFiles = ["./resources/routes/public.routes.js"];

/* NOTE: if you use the express Router, you must pass in the
   'endpointsFiles' only the root file where the route starts,
   such as: index.js, app.js, routes.js, ... */

await swagger(outputFile, endpointsFiles, doc);
