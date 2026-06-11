import swaggerAutogen from "swagger-autogen";
const swagger = swaggerAutogen();
import config from "config";

const doc = {
  info: {
    version: "1.0",
    title: "Competitor Analysis APIs",
    description: "Competitor Analysis API Documentation",
  },
  host: config.get("SWAGGER_HOST_URL"),
  basePath: "/",
  schemes: ["http", "https"],
  consumes: ["application/json", "application/x-www-form-urlencoded"],
  produces: ["application/json"],
  tags: [],

  definitions: {
    Create: {
      amember_id: 12345,
      plan_id: 987,
      plan_expiry_date: "2029-12-22",
      company_name: "Puma",
      email: "ankitb@gmail.com",
      url: "https://www.instagram.com",
      phone_number: "6000349300",
      userName: "user12345",
    },
    CompetitorsRequest: {
      user_id: "6811f4b60db5fdde3a8a2de4",
      project_name: "Poweradspy Project",
      advertiser: ["advertiser1", "advertiser2"],
      brand_url: "instagram.com/example_user",
      competitor_details: [
        {
          competitor_name: "competitor1",
          competitor_url: "https://www.example.com",
        },
        {
          competitor_name: "competitor2",
          competitor_url: "https://testsite.org",
        },
        {
          competitor_name: "competitor3",
          competitor_url: "https://dummydata.net/api/v1/info",
        },
        {
          competitor_name: "competitor4",
          competitor_url: "https://mycompany.mockserver.io/login",
        },
      ],
      country: ["India", "United States", "Germany"],  
      category: ["Retail", "Travel and Tourism"]   
    },
    FetchCompetitors: {
      advertiser: ["Poweradspy"],
    },
    getCompetitorsCount: {
      competitors: "amazon",
    },
    "get-ads-count": {
      competitorName: "amazon",
    },
    CheckBrand: {
      user_id: "68242d3dcd6d2d458eebdb8e",
      brand: "UBER",
    },
    CreateBackLink: {
      domain_name: "example.com",
      referring_page: "https://referrer.com/page",
      dr: 72,
      url: "https://example.com/some-page",
      domain_traffic: 10000,
      referring_domains: ["site3.com", "site2.com"],
      linked_domains: ["linked1.com", "linked2.com"],
      external_links: ["https://external.com"],
      page_traffic: 200,
      anchor_and_target_url: null,
      date: "2025-05-29T00:00:00.000Z",
      similar: true,
      inspect: false,
    },
    Createorganicsearch: {
      domain_name: "shopnow.com",
      keyword: "wireless earbuds",
      is_transactional: true,
      sf: 3,
      volume: 29000,
      kd: 45,
      cpc: 1.85,
      traffic: 3500,
      best_position_diff: -1,
      sum_paid_traffic: 2200,
      best_positon: 2,
      best_postion_url: "https://shopnow.com/products/wireless-earbuds",
    },
    Createpaidsearch: {
      domain_name: "example.com",
      keywords: "best running shoes",
      url: "https://example.com/running-shoes",
      external_links: [
        "https://affiliate.com/track",
        "https://othersite.com/links",
      ],
      top_keyword_volume: 19000,
      kd: 30,
      cpc: 1.25,
      paid_org_ratio: 0.65,
      value: 5800,
      sum_traffic: 2400,
      top_keyword_best_positon: 2,
    },
    UpdateMonitoring: {
      competitor_request_id: "6825d98f7bebb96925947cf3",
      competitor_id: "6825d98f7bebb96925947cf1",
      status: "0",
    },
    updateCompetitors: {
      user_id: "6811f4b60db5fdde3a8a2de4",
      advertiser: ["amazon"],
      brand_url: "amazon.com",
      competitor_details: [
        {
          competitor_name: "nike",
          competitor_url: "nike.com",
        },
        {
          competitor_name: "adidas",
          competitor_url: "adidas.com",
        },
        {
          competitor_name: "puma",
          competitor_url: "puma.com",
        },
      ],
    },
    updateAdvertiser: {
      user_id: "68242d3dcd6d2d458eebdb8e",
      advertiser: ["amazan"],
      newadvertiser: "amazon",
    },
    getOrganicSearches: {
      domain_name: "shopnow.com",
      keyword: "",
      best_position_url: "",
      skip: 0,
      limit: 1,
    },
    getBackLinks: {
      domain_name: "example.com",
      referring_page: "",
      referring_domains: "",
      skip: 0,
      limit: 1,
    },
    getPaidSearches: {
      domain_name: "example.com",
      keywords: "run",
      external_links: "aff",
      skip: 0,
      limit: 1,
    },
    userProject: {
      user_id: "68242d3dcd6d2d458eebdb8e",
    },
    projectcompeitetor: {
      project_name: "uber",
    },
    getLCS: {
      competitors: "Amazon",
    },
    getAvgBudget: {
      competitors: "Amazon",
    },
    getCategory: {
      platform: "facebook",
    },
    emailController: {
      to: "user@globussoft.in",
      code: {
        competitor_name: ["nike", "puma"],
        data: {
          facebook_count: [25, 20],
          instagram_count: [58, 85],
          google_count: [75, 52],
        },
      },
      name: "user",
    },
    unsubscribeRequest: {
      email: "yourmail@globussoft.in",
    },
    filterDetails: {
      user_id: "68242d3dcd6d2d458eebdb8e",
      userName: "",
      brandName: ["uber"],
    },
  },
  securityDefinitions: {
    BearerAuth: {
      type: "apiKey",
      name: "authorization",
      in: "header",
      description: "Enter your bearer token in the format **Bearer <token>**",
    },
  },
  security: [
    {
      BearerAuth: [],
    },
  ],
};

const outputFile = "./resources/views/swagger-api-view.json";
const endpointsFiles = ["./server.js"];

/* NOTE: if you use the express Router, you must pass in the
   'endpointsFiles' only the root file where the route starts,
   such as: index.js, app.js, routes.js, ... */

await swagger(outputFile, endpointsFiles, doc);
