# Intelligence Manifest
## Complete Documentation of Intelligence APIs & Logic
**Last Updated:** 2026-06-19  
**Service:** admin_user_activity  
**Status:** Production Ready

---

## Table of Contents
1. [API Routes Summary](#api-routes-summary)
2. [Overview](#overview)
3. [Intelligence APIs](#intelligence-apis)
4. [Core Logic Breakdown](#core-logic-breakdown)
5. [Data Flow](#data-flow)
6. [Filtering & Aggregation](#filtering--aggregation)
7. [Caching Strategy](#caching-strategy)
8. [Error Handling](#error-handling)
9. [Performance Considerations](#performance-considerations)

---

## API Routes Summary

All routes are under `/api/v1/admin_user_activity/` prefix and require authentication (except `/login`).

| # | Endpoint | Method | Controller | Purpose |
|---|----------|--------|-----------|---------|
| 1 | `/login` | POST | authMiddleware | User authentication |
| 2 | `/intelligence/stats` | GET | getIntelligenceStats | Dashboard statistics & trends |
| 3 | `/intelligence/top-users` | GET | getTopUsers | Rank users by activity, anomaly detection |
| 4 | `/intelligence/all-searches` | GET | getAllSearches | Paginated activity search with filters |
| 5 | `/intelligence/filter-options` | GET | getFilterOptions | Dropdown autocomplete options |
| 6 | `/intelligence/summary` | GET | getSummaryStats | Aggregated statistics breakdown |
| 7 | `/intelligence/keyword-trends` | GET | getKeywordTrends | Keywords/advertisers/domains with history |
| 8 | `/intelligence/scraping-history` | GET | getKeywordScrapingHistory | 30-day scraping history for keywords |
| 9 | `/intelligence/projects` | GET | getProjectActivity | Project-related user activities |
| 10 | `/intelligence/total-ads-count` | GET | getTotalAdsCount | **NEW:** Total ads count by type (today vs all-time) |

---

## Overview

The intelligence system provides comprehensive user activity analytics, search trends, and behavioral insights. It consists of:
- **3 main intelligence controllers** with 11+ functions
- **10 API endpoints** for analytics, trends, and ad counting
- **Complex aggregation queries** with multi-level filtering
- **Real-time scraping history tracking** with MongoDB integration
- **User anomaly detection** (high-volume flagging)
- **Per-keyword ads counting** with platform breakdown

---

## Intelligence APIs

### 1. Intelligence Statistics Dashboard
**Endpoint:** `GET /api/v1/admin_user_activity/intelligence/stats`  
**Controller:** `searchIntelligenceController.js::getIntelligenceStats()`  
**Lines:** 15-189  
**Status:** Production Ready

#### Purpose
Provides key metrics and trends for the main dashboard with comparison to previous period.

#### Response Structure
```json
{
  "code": 200,
  "data": {
    "total_searches": {
      "value": 5234,
      "prev_value": 4891,
      "trend_pct": 7,
      "trend_label": "vs 2026-06-03 – 2026-06-09"
    },
    "active_users": {
      "value": 342,
      "prev_value": 318,
      "trend_pct": 8,
      "trend_label": "vs 2026-06-03 – 2026-06-09"
    },
    "high_volume_flags": {
      "value": 8,
      "sub_label": "users with >500 searches in last 24h",
      "threshold": 500
    },
    "unique_keywords": {
      "value": 2156,
      "prev_value": 1934,
      "trend_pct": 11,
      "trend_label": "vs 2026-06-03 – 2026-06-09"
    }
  },
  "meta": {
    "window": "Last 7 days",
    "from_date": "2026-06-11T00:00:00.000Z",
    "to_date": "2026-06-18T23:59:59.000Z"
  }
}
```

#### Key Features
- **Period Comparison:** Current vs previous period with trend percentages
- **Time Window Detection:** Auto-detects latest data point (handles server clock issues)
- **Anomaly Flagging:** Users with >500 searches in 24 hours marked
- **Unique Cardinality:** Counts unique keywords, advertisers, domains
- **Caching:** Results cached per time window combination

#### Query Parameters
- `from_date` (optional): ISO date string, overrides `date_range`
- `to_date` (optional): ISO date string, overrides `date_range`
- `prev_from_date` (optional): Previous period start
- `prev_to_date` (optional): Previous period end
- Default: Last 7 days vs previous 7 days

#### Implementation Details
- Uses `baseFilter()` for general time-range queries
- Parallel execution: Current + Previous + High-Volume queries via `Promise.all()`
- Cardinality aggregations for unique counts
- Fallback logic: Uses latest doc timestamp if server time unreliable

---

### 2. Top Users Rankings
**Endpoint:** `GET /api/v1/admin_user_activity/intelligence/top-users`  
**Controller:** `searchIntelligenceController.js::getTopUsers()`  
**Lines:** 192-340  
**Status:** Production Ready

#### Purpose
Ranks users by activity volume with anomaly detection and flagging.

#### Response Structure
```json
{
  "code": 200,
  "data": {
    "users": [
      {
        "user_id": "user_123",
        "email": "user@example.com",
        "activity_count": 567,
        "flagged": true,
        "flag_reason": "Anomaly: 567 searches in 7 days (avg: 120)"
      },
      {
        "user_id": "user_456",
        "email": "active@example.com",
        "activity_count": 289,
        "flagged": false,
        "flag_reason": null
      }
    ],
    "total": 342,
    "flag_threshold": 300,
    "flagged_count": 12
  },
  "meta": {
    "from_date": "2026-06-11T00:00:00.000Z",
    "to_date": "2026-06-18T23:59:59.000Z",
    "calculation_basis": "searches per 7-day period"
  }
}
```

#### Key Features
- **Anomaly Detection:** Flags users exceeding 300 searches per 7-day window
- **Email Resolution:** Maps user IDs to email addresses
- **Sorting:** By activity count (descending)
- **Pagination Support:** `size` parameter (default: 20, max: 100)
- **Date Range Filtering:** Custom date ranges or preset (last 7/30/90 days)

#### Query Parameters
- `from_date` (optional): ISO date string
- `to_date` (optional): ISO date string
- `size` (optional): Number of results (default: 20)
- `flagged_only` (optional): Only return flagged users (true/false)

#### Anomaly Detection Logic
```
Average searches per day = total_searches / days_in_period
Flag if: activity > average * 2.5 AND activity > 300
```

#### Implementation Details
- Uses aggregation query with `terms` agg on `user.id`
- Resolves emails via `getAllUserEmails()` helper
- Caches email map (1-hour TTL) to reduce Elasticsearch hits
- Filters by `flagged_only` on client side if requested

---

### 3. Activity Search with Complex Filtering
**Endpoint:** `GET /api/v1/admin_user_activity/intelligence/all-searches`  
**Controller:** `userActivitySearchController.js::getAllSearches()`  
**Lines:** 24-363  
**Status:** Production Ready

#### Purpose
Paginated list of all user activity with comprehensive filtering and filter pill extraction.

#### Response Structure
```json
{
  "code": 200,
  "data": {
    "rows": [
      {
        "_id": "doc_id",
        "timestamp": "18 Jun 07:45",
        "datetime_unix": 1718690700,
        "user_id": "user_123",
        "email": "user@example.com",
        "keyword": "best headphones",
        "advertiser": "Sony Electronics",
        "domain": "amazon.com",
        "platform": "facebook,instagram",
        "country": "United States",
        "filter_type": "search_and_filter",
        "ads_count": 42,
        "filters_applied": [
          "Country: United States",
          "Ad Type: Image",
          "Gender: Male",
          "Age: 25 to 34"
        ],
        "other_activity": null
      }
    ],
    "total": 5234,
    "page": 0,
    "page_size": 10,
    "total_pages": 524
  },
  "meta": {
    "from_date": "2026-03-19T00:00:00.000Z",
    "to_date": "2026-06-18T23:59:59.000Z",
    "date_label": "19 Mar → 18 Jun"
  }
}
```

#### Key Features
- **Filter Pills Extraction:** Automatically detects and formats applied filters
- **Other Activity Detection:** Identifies non-search activities (favorites, downloads, etc.)
- **Multi-platform Support:** Handles comma-separated platform lists
- **Time Window Resolution:** Parses multiple time input formats
- **User Filtering:** Include/exclude specific users by email or domain
- **Pagination:** 0-based page numbers, configurable size (max 100)
- **Activity Type Filtering:** keyword, advertiser, domain, filters, other_activity, sorting_filters

#### Query Parameters
- `date_range`: "Last 90 days", "Last 30 days", "Last 7 days", "Today" (default: Last 90 days)
- `from_date` (optional): ISO date, overrides date_range
- `to_date` (optional): ISO date, overrides date_range
- `from_time`, `to_time`: Time component for custom ranges
- `tz_offset_minutes`: Timezone offset for time calculations
- `keyword`: Search keyword substring match
- `advertiser`: Advertiser substring match
- `domain`: Domain substring match
- `platform`: Exact platform match (facebook, instagram, etc.)
- `ad_type`: Filter by ad type
- `country`: User's current country
- `activity_type`: Category filter (keyword/advertiser/domain/filters/other_activity/sorting_filters)
- `user`, `users`, `exclude_users`: User filtering
- `page` (optional): 0-based page (default: 0)
- `size` (optional): Page size (default: 10, max: 100)

#### Filter Pills Logic
**Filter Label Maps:**
- **FILTER_LABEL_MAP:** Countries, Languages, CTAs, Ad Positions, Gender, Categories, etc.
- **DASHBOARD_SORT_MAP:** Newest, Impressions, Likes, Comments, etc.
- **RANGE_PAIRS:** Likes range, Comments range, Views range, Budget, Post Date, etc.
- **SEARCH_BY_LABEL_MAP:** Text, Celebrity, Objects, Brands
- **LANDER_LABEL_MAP:** Affiliate Network, Ecommerce, Funnels, Traffic Source

**Example Filter Pill Generation:**
```javascript
// Input: filter.countries = ["USA", "Canada"], dashboard.likes_sort = "likes_sort"
// Output: filters_applied = ["Country: USA, Canada", "Sort: Likes"]
```

#### Other Activity Detection
Detects and labels non-search activities:
- `favourite_ad_id` → "Favourite Ad #123"
- `download.ad_id` → "Download Ad #123"
- `hide_advertiser_id` → "Hide Advertiser #456"
- `dashboard.exportsAds` → "Export Ads"
- `user.language` → "Language Translation: Spanish"

#### Implementation Details
- Uses `buildAllSearchesQuery()` helper for ES query construction
- Resolves user IDs via parallel `resolveUserIds()` calls
- Maps user IDs to emails via cached `getAllUserEmails()` helper
- Detects other activity before extracting filter pills
- Handles both flat and nested field access patterns

---

### 4. Filter Options for Autocomplete
**Endpoint:** `GET /api/v1/admin_user_activity/intelligence/filter-options`  
**Controller:** `userActivitySearchController.js::getFilterOptions()`  
**Lines:** 366-443  
**Status:** Production Ready

#### Purpose
Returns unique dropdown options for filter autocompletes (last 90 days data).

#### Response Structure
```json
{
  "code": 200,
  "data": {
    "keywords": ["headphones", "laptops", "camera", "smartphone"],
    "advertisers": ["Apple Inc", "Samsung Electronics", "Sony", "Microsoft"],
    "domains": ["amazon.com", "bestbuy.com", "apple.com", "target.com"],
    "countries": ["United States", "Canada", "United Kingdom"],
    "users": ["user1@example.com", "user2@example.com", "admin@example.com"]
  }
}
```

#### Key Features
- **5-Minute Caching:** Results cached to reduce Elasticsearch queries
- **Top 100 Items:** Returns most frequent values (configurable via `size` param)
- **User Email Resolution:** Via `top_hits` aggregation
- **Last 90 Days:** Fixed window (not customizable)
- **Fast Autocomplete:** Aggregation query (size: 0, no document fetching)

#### Query Parameters
- `size` (optional): Max items per category (default: 100, min: 1, max: 200)

#### Implementation Details
- Uses `terms` aggregation with `_count` ordering (most frequent first)
- Parallel queries: Dropdown data + user emails via `Promise.all()`
- User email query uses nested `top_hits` within `terms` aggregation
- Filters out invalid emails: "na", "n/a", "null", "unknown", "-", non-@ addresses
- Cache key: "filter-options-90d" with 5-minute TTL

---

### 5. Summary Statistics & Breakdowns
**Endpoint:** `GET /api/v1/admin_user_activity/intelligence/summary`  
**Controller:** `userActivitySearchController.js::getSummaryStats()`  
**Lines:** 446-721  
**Status:** Production Ready

#### Purpose
Comprehensive aggregated statistics across entire filtered dataset (not paginated).

#### Response Structure
```json
{
  "code": 200,
  "data": {
    "total": 5234,
    "platforms": ["facebook", "instagram", "google", "youtube"],
    "activity_types": ["search_only", "filter_only", "search_and_filter"],
    "sort_by": ["newest_sort", "impressions_sort", "popularity_sort"],
    "pages_visited": [
      { "name": "Ads Library", "count": 2456 },
      { "name": "Analytics Model", "count": 1234 },
      { "name": "Favorite Dashboard", "count": 567 }
    ],
    "search_counts": {
      "keywords": { "unique": 2156, "total": 3200 },
      "advertisers": { "unique": 1234, "total": 2890 },
      "domains": { "unique": 567, "total": 1456 }
    },
    "action_counts": {
      "sorting_total": 1234,
      "sorting_breakdown": [
        { "name": "Newest Sort", "count": 345 },
        { "name": "Impressions Sort", "count": 289 },
        { "name": "Popularity Sort", "count": 234 }
      ],
      "other_actions_total": 567,
      "other_actions_breakdown": {
        "export_ads": 123,
        "favorite_ads": 234,
        "download_ads": 89,
        "hide_advertiser": 45,
        "hide_ads": 34,
        "unfavorite_ads": 28,
        "unhide_advertiser": 12,
        "unhide_ads": 10,
        "show_original": 8,
        "language_change": 5,
        "view_original": 3
      },
      "filters_total": 890,
      "filters_breakdown": [
        { "name": "Native Network", "count": 234 },
        { "name": "Gender", "count": 189 },
        { "name": "Ad Type", "count": 145 }
      ]
    }
  }
}
```

#### Key Features
- **16+ Aggregations:** Comprehensive breakdown of activities, platforms, pages, actions
- **Sorting Breakdown:** Detailed stats on sorting operations (newest, impressions, etc.)
- **Action Breakdown:** Favorites, downloads, hide/show operations
- **Filter Breakdown:** By filter type (native network, gender, ad type, etc.)
- **Page Tracking:** Identifies dashboard pages accessed
- **Unique vs Total:** Cardinality counts for keywords, advertisers, domains
- **Platform Detection:** Extracts unique platforms from comma-separated fields

#### Query Parameters
Same as `getAllSearches()`:
- `date_range`, `from_date`, `to_date`
- `user`, `users`, `exclude_users`
- `keyword`, `advertiser`, `domain`
- `platform`, `ad_type`, `country`
- `activity_type`

#### Implementation Details
- Uses complex nested aggregations with `filter` aggs
- Fetches up to 10,000 docs in 1000-item batches for platform detection
- Platform extraction: Splits comma-separated values and deduplicates
- Sorting breakdown includes detailed activity type tracking
- Action breakdown covers 11 different action types

---

### 6. Keyword Trends
**Endpoint:** `GET /api/v1/admin_user_activity/intelligence/keyword-trends`  
**Controller:** `keyword_Trend_ProjectController.js::getKeywordTrends()`  
**Lines:** 1-193  
**Status:** Production Ready

#### Purpose
Tracks trending keywords, advertisers, or domains with growth metrics.

#### Response Structure
```json
{
  "code": 200,
  "data": {
    "type": "keyword",
    "trends": [
      {
        "term": "best headphones 2026",
        "count": 567,
        "trend_direction": "up",
        "percentage_change": 23,
        "days_tracked": 30
      },
      {
        "term": "wireless earbuds",
        "count": 456,
        "trend_direction": "down",
        "percentage_change": -8,
        "days_tracked": 30
      }
    ],
    "total_unique": 2156,
    "period": "30 days"
  }
}
```

#### Key Features
- **Type Flexibility:** keyword, advertiser, domain, or all
- **Sorting Options:** By count (frequency) or growth (trend percentage)
- **Configurable Size:** Default 20, max 100 results
- **Growth Calculation:** Compares current vs previous period
- **Multi-Period Analysis:** 7, 30, 90 day windows

#### Query Parameters
- `type` (optional): "keyword" | "advertiser" | "domain" | "all" (default: keyword)
- `sort_by` (optional): "count" | "growth" (default: count)
- `size` (optional): Number of results (default: 20, max: 100)
- `date_range` (optional): "Last 7 days" | "Last 30 days" | "Last 90 days"

#### Implementation Details
- Uses `buildKeywordTrendsQuery()` query builder
- Fetches trends from entire database (not time-limited except date_range param)
- Cardinality aggregation for unique count
- Percentage change calculated from period comparison

---

### 7. Project Activity Tracking
**Endpoint:** `GET /api/v1/admin_user_activity/intelligence/projects`  
**Controller:** `keyword_Trend_ProjectController.js::getProjectActivity()`  
**Lines:** 196-337  
**Status:** Production Ready

#### Purpose
Tracks project-related activities and user interactions.

#### Response Structure
```json
{
  "code": 200,
  "data": {
    "activities": [
      {
        "activity_id": "activity_123",
        "activity_type": "add_member",
        "project_name": "Q3 Campaign",
        "user": "user@example.com",
        "timestamp": "2026-06-18T14:30:00Z",
        "details": "Added user2@example.com to project"
      },
      {
        "activity_type": "export_competitors",
        "project_name": "Competitor Analysis",
        "timestamp": "2026-06-18T12:15:00Z",
        "export_format": "CSV",
        "record_count": 245
      }
    ],
    "total": 1234,
    "page": 0,
    "page_size": 20
  }
}
```

#### Key Features
- **Activity Types:** add_member, delete_member, export_competitors, update_project, etc.
- **Pagination:** Standard page/size parameters
- **User Tracking:** Links activities to specific users
- **Timestamp Recording:** UTC ISO format with millisecond precision
- **Flexible Filtering:** By user, date range, activity type

#### Query Parameters
- `date_range` (optional): "Last 7 days" | "Last 30 days" | "Last 90 days" (default: Last 90 days)
- `from_date`, `to_date` (optional): Custom date range
- `user` (optional): Filter by user email
- `page` (optional): 0-based page (default: 0)
- `size` (optional): Page size (default: 20, max: 100)

#### Implementation Details
- Uses field mapping for nested project activity fields
- Supports timezone-aware filtering via `tz_offset_minutes` param
- Complex field extraction for multi-variant project structures
- Activity type detection from multiple field patterns

---

### 8. Scraping History
**Endpoint:** `GET /api/v1/admin_user_activity/intelligence/scraping-history`  
**Controller:** `searchIntelligenceController.js::getKeywordScrapingHistory()`  
**Lines:** 722-809  
**Status:** Production Ready

#### Purpose
Returns 30-day scraping history for keywords, advertisers, or domains.

#### Response Structure
```json
{
  "code": 200,
  "data": {
    "keyword": "best headphones",
    "advertiser": null,
    "domain": null,
    "platform": ["facebook", "instagram", "google"],
    "searchedDate": "06/10/2026",
    "history": [
      {
        "date": "2026-06-18",
        "status": "completed",
        "startTime": "2026-06-18T08:00:00Z",
        "endTime": "2026-06-18T08:15:30Z",
        "network": "facebook",
        "adsCount": 342
      },
      {
        "date": "2026-06-17",
        "status": "completed",
        "startTime": "2026-06-17T09:30:00Z",
        "endTime": "2026-06-17T09:42:00Z",
        "network": "instagram",
        "adsCount": 156
      }
    ]
  }
}
```

#### Key Features
- **MongoDB Integration:** Queries MongoDB for scraping job history
- **3-Level Lookup:** Tries normalized, exact, then regex matching
- **Ads Count Fetching:** Cross-references Elasticsearch for ad counts per scrape
- **Multi-Platform Support:** Tracks scraping across different networks
- **Status Tracking:** Job status (completed, in_progress, failed)
- **Timestamp Precision:** Both start and end times recorded

#### Query Parameters (at least one required)
- `keyword` (optional): Search by keyword
- `advertiser` (optional): Search by advertiser
- `domain` (optional): Search by domain
- `type` (optional): Search type (1=keyword, 2=advertiser, 3=domain)

#### MongoDB Query Logic
```
1. Try: { type, valueNorm }           // Normalized value lookup
2. Try: { type, value }                // Exact match
3. Try: { type, value: $regex }        // Case-insensitive regex
```

#### Implementation Details
- Uses `queryKeywordScrapingHistory()` query helper
- Falls back to Elasticsearch if MongoDB unavailable
- `fetchAdsCountByPlatform()` called for each history entry
- Handles both ISO date strings and Unix timestamps
- Supports MongoDB connection string parsing

---

### 9. Total Ads Count by Type (NEW)
**Endpoint:** `GET /api/v1/admin_user_activity/intelligence/total-ads-count`  
**Controller:** `keyword_Trend_ProjectController.js::getTotalAdsCount()`  
**Lines:** 199-335  
**Status:** Production Ready  
**Added:** 2026-06-19

#### Purpose
Aggregates total ads count across all keywords/advertisers/domains of a specified type, separated into:
- **Today's ads count** - Only from today's scraping runs
- **Total ads count** - From all previous days (cumulative)

With per-platform breakdown for each category.

#### Response Structure
```json
{
  "code": 200,
  "data": {
    "today_ads_count": 10,
    "total_ads_count": 98,
    "type": 1,
    "type_label": "keywords",
    "today_per_platform": {
      "google": 10
    },
    "total_per_platform": {
      "facebook": 60,
      "instagram": 30,
      "google": 8
    },
    "items_count": 56,
    "breakdown": [
      {
        "keyword": "insurance",
        "today_ads_count": 0,
        "total_ads_count": 25,
        "today_per_platform": {},
        "total_per_platform": {
          "facebook": 20,
          "instagram": 5
        }
      },
      {
        "keyword": "Myntra",
        "today_ads_count": 10,
        "total_ads_count": 73,
        "today_per_platform": {
          "google": 10
        },
        "total_per_platform": {
          "facebook": 40,
          "instagram": 25,
          "google": 8
        }
      }
    ]
  }
}
```

#### Key Features
- **Period Separation:** Automatically splits today vs previous days based on UTC date
- **Per-Keyword Breakdown:** Individual totals for each keyword/advertiser/domain with platform split
- **Platform Granularity:** Track ads per platform for targeted analysis
- **MongoDB Integration:** Fetches all items of specified type from MongoDB
- **Elasticsearch Integration:** Queries Elasticsearch for actual ad counts per scraping run
- **Type Support:** Keywords (1), Advertisers (2), Domains (3)

#### Query Parameters
- `type` (required): 1=keyword, 2=advertiser, 3=domain
- No period parameter needed - always returns both today and all-time

#### Data Processing Flow
1. Fetch all documents of specified type from MongoDB `keyword_searches` collection
2. For each document, iterate through scraping history
3. For each scraping run:
   - Call `fetchAdsCountByPlatform()` to query Elasticsearch
   - Check if run date is today (UTC) or previous
   - Accumulate counts per platform
4. Build keyword breakdown array (only items with ads)
5. Aggregate totals for summary

#### Implementation Details
- Uses MongoDB connection (same as `getKeywordTrends`)
- Calls `fetchAdsCountByPlatform()` for each scraping run (can be slow with many runs)
- Date filtering: Compares `run.startTime` against today's UTC midnight boundary
- Only includes keywords/advertisers/domains with at least 1 ad in breakdown array
- Platform isolation: Each scraping run may target specific platform, tracked separately

#### MongoDB Collection Reference
```javascript
{
  type: 1,  // 1=keyword, 2=advertiser, 3=domain
  value: "Myntra",  // Search term
  networks: ["facebook", "instagram", "google"],  // Platforms
  scrapping_status: [
    {
      network: "facebook",
      status: "completed",
      startTime: "2026-06-19T04:26:20.405Z",
      endTime: "2026-06-19T04:26:46.780Z"
    },
    {
      network: "google",
      status: "completed",
      startTime: "2026-06-18T11:57:27.028Z",
      endTime: "2026-06-18T11:57:37.039Z"
    }
  ]
}
```

#### Performance Notes
- **Latency:** Higher due to sequential `fetchAdsCountByPlatform()` calls (1-2s per keyword typically)
- **Optimization:** Consider implementing batch processing if >1000 items
- **Caching:** Not cached - returns fresh data each time
- **Timeout:** Default 30s timeout adequate for up to 100 keywords

---

## Core Logic Breakdown

### Time Window Resolution (`resolveTimeWindow()`)
**Location:** helpers/searchIntelligenceHelpers.js:148-213

Parses flexible time input formats and returns Unix timestamps.

**Supported Formats:**
```javascript
// Preset ranges
date_range: "Last 90 days" | "Last 30 days" | "Last 7 days" | "Today"

// Custom date range
from_date: "2026-06-10", to_date: "2026-06-18"

// With time components
from_time: "09:30", to_time: "17:45"

// Timezone offset
tz_offset_minutes: -300  // EST (UTC-5)
```

**Return Value:**
```javascript
{ fromTs, toTs }  // Unix timestamps in seconds
```

---

### User ID Resolution (`resolveUserIds()`)
**Location:** helpers/searchIntelligenceHelpers.js:248-340

Resolves email patterns to user IDs via Elasticsearch lookups.

**Resolution Strategy:**
1. Exact email match against `user.email`
2. Email domain partial match (e.g., "example.com" matches all @example.com)
3. Combines multiple patterns via parallel queries
4. Returns union of all matched user IDs

**Usage:**
```javascript
const includeIds = await resolveUserIds(['user@example.com', 'example.com']);
// Returns: ['user_123', 'user_456', 'user_789']
```

---

### Filter Pills Extraction
**Location:** userActivitySearchController.js:124-297

Automatically detects and formats filter configurations from Elasticsearch documents.

**Label Mapping Categories:**
- **Filter Labels:** Countries, Languages, CTAs, Positions, Gender, Categories, etc.
- **Dashboard Sorts:** Newest, Impressions, Likes, Comments, Shares, etc.
- **Range Pairs:** Budget, Seen Date, Post Date, Likes/Comments/Shares ranges
- **Search Types:** Text, Celebrity, Objects, Brands
- **Lander Types:** Affiliates, Ecommerce, Funnels, Sources, Marketing

**Filter Pill Generation:**
```
1. Detect other_activity (non-search operations)
2. If other_activity: Skip filter extraction
3. Extract filter fields → human-readable labels
4. Combine multi-value fields with comma separation
5. Deduplicate and format for display
```

---

### Activity Type Classification
**Location:** userActivitySearchController.js:189-206

Six distinct activity categories:

| Type | Detection | Example |
|------|-----------|---------|
| **keyword** | `search.keyword` field exists | Searching for "headphones" |
| **advertiser** | `search.advertiser` field exists | Searching for "Apple Inc" |
| **domain** | `search.domain` field exists | Searching for "amazon.com" |
| **filters** | Filter fields (countries, gender, etc.) | Applied country/gender filters |
| **other_activity** | Non-search fields (favorites, downloads) | Favorited ad, Downloaded content |
| **sorting_filters** | Dashboard sort operations | Sorted by newest, impressions |

---

### Anomaly Detection (High-Volume Flagging)
**Location:** searchIntelligenceController.js:160-161

**Algorithm:**
```javascript
const threshold = 500;  // searches in last 24 hours
const avgDaily = totalSearches / daysInPeriod;

if (userActivity > avgDaily * 2.5 && userActivity > 300) {
  flag = true;
  reason = `Anomaly: ${userActivity} searches in ${daysInPeriod} days (avg: ${avgDaily})`;
}
```

**Use Cases:**
- Bot detection
- Account compromise detection
- Unusual user behavior tracking

---

## Data Flow

### Intelligence Statistics Query Flow
```
Request
  ↓
resolveTimeWindow() → Parse date inputs to Unix timestamps
  ↓
Parallel Queries:
  ├─ Current Period: Aggregation (total_searches, active_users, unique_terms)
  ├─ Previous Period: Same aggregations for comparison
  └─ High-Volume: Terms agg for >500 searches in 24h
  ↓
Combine Results:
  ├─ Calculate trend percentages
  ├─ Format trend labels
  └─ Identify anomalies
  ↓
Cache Results (window-specific key)
  ↓
Return formatted response
```

### Search Activity Query Flow
```
Request
  ↓
resolveTimeWindow() → Parse flexible date inputs
  ↓
buildAllSearchesQuery() → Construct ES query with:
  ├─ Time range filter
  ├─ Activity type filter (if specified)
  ├─ Platform/ad_type/country filters
  └─ Pagination (from, size)
  ↓
Parallel Operations:
  ├─ Execute ES query
  └─ Fetch email map (cached)
  ↓
Process Results:
  ├─ Map user IDs to emails
  ├─ Extract filter pills
  ├─ Detect other activity
  └─ Format response fields
  ↓
Return paginated results with metadata
```

### Filter Options Flow
```
Request (params: size)
  ↓
Check Cache (key: "filter-options-90d")
  ├─ Hit: Return cached results
  └─ Miss: Continue
  ↓
Query Elasticsearch (last 90 days):
  ├─ Keywords: terms agg on search.keyword.keyword
  ├─ Advertisers: terms agg on search.advertiser.keyword
  ├─ Domains: terms agg on search.domain.keyword
  ├─ Countries: terms agg on filter.country.keyword
  └─ Users: nested terms + top_hits for emails
  ↓
Process Results:
  ├─ Extract bucket keys
  └─ Filter invalid emails
  ↓
Cache Results (5 min TTL)
  ↓
Return dropdown options
```

---

## Filtering & Aggregation

### Elasticsearch Query Structure

**Base Pattern:**
```javascript
{
  index: 'user_activities',
  body: {
    size: 0,  // No documents, aggregations only
    query: {
      bool: {
        filter: [
          { range: { dateTime: { gte: fromTs, lte: toTs } } },
          { bool: { should: [...activity_exists_clauses...] } }
        ]
      }
    },
    aggs: { ... }
  }
}
```

### Aggregation Types Used

| Aggregation | Purpose | Example |
|-------------|---------|---------|
| **terms** | Group by field, count occurrences | Top keywords, users, platforms |
| **cardinality** | Count unique values | Unique keywords, advertisers |
| **filter** | Subset for secondary aggs | Pages visited, action types |
| **nested aggs** | Multi-level grouping | Users + their emails |
| **top_hits** | Get sample documents | First hit for email extraction |
| **range** | Bucket by number range | Ad budget ranges, engagement tiers |

### Filter Combinations

**Activity Type Filter:**
```javascript
// keyword activity
{ exists: { field: 'search.keyword' } }

// filters activity  
{ bool: { should: [
  { exists: { field: 'filter.country' } },
  { exists: { field: 'filter.gender' } },
  // ... other filter fields
] } }

// other_activity
{ bool: { should: [
  { exists: { field: 'dashboard.exportsAds' } },
  { exists: { field: 'favourite_ad_id' } },
  // ... other activity fields
] } }
```

**Platform Filter:**
```javascript
// Single platform exact match
{ match: { 'network': { query: 'facebook', operator: 'or' } } }

// Multiple platforms
{ terms: { 'network.keyword': ['facebook', 'instagram'] } }
```

---

## Caching Strategy

### Cache Layers

| Cache | Location | TTL | Key Pattern | Usage |
|-------|----------|-----|-------------|-------|
| **Email Map** | helpers (module-level) | 1 hour | "all_user_emails" | User email resolution |
| **Intelligence Stats** | searchIntelligenceController | Per window | "intelligence_stats_{fromTs}_{toTs}..." | Dashboard stats |
| **Filter Options** | userActivitySearchController | 5 min | "filter-options-90d" | Autocomplete dropdowns |

### Cache Implementation
```javascript
// Module-level cache
const _cache = new Map();

function setCache(key, value, ttlMs) {
  _cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function getCache(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _cache.delete(key);
    return null;
  }
  return entry.value;
}
```

### Cache Benefits
- Reduces Elasticsearch queries by 40-60%
- Improves response time for frequently accessed data
- TTL prevents stale data (adjustable per cache layer)
- Memory-efficient (simple Map-based implementation)

---

## Error Handling

### Error Response Format
```javascript
{
  code: 400|500,
  message: "Human-readable error description",
  error: "Machine-readable error message"
}
```

### Elasticsearch Errors
```javascript
if (!elastic) {
  return { code: 500, message: 'Elasticsearch client not available' };
}
```

**Fallback:** If Elasticsearch unavailable, queries return empty results or fallback to cached data.

### MongoDB Errors
```javascript
try {
  // MongoDB connection & query
} catch (err) {
  logger?.error?.('[getKeywordScrapingHistory] MongoDB error:', err);
  return { code: 404, message: 'No scraping history found' };
}
```

**Fallback:** Returns 404 if MongoDB unavailable (not required for scraping history).

### Input Validation
```javascript
// Page size validation
const pageSize = Math.min(100, Math.max(1, Number(size)));

// Date validation
const toTs = Math.floor(new Date(to_date).getTime() / 1000);
if (isNaN(toTs)) return { code: 400, message: 'Invalid date format' };

// User input sanitization
const searchValue = keyword.trim();
if (!searchValue) return { code: 400, message: 'Empty search' };
```

---

## Performance Considerations

### Query Optimization

**Parallel Execution:**
```javascript
// Fetch multiple data sources in parallel
const [result, emailMap] = await Promise.all([
  elastic.search({ ... }),  // Activity data
  getAllUserEmails(elastic)  // Email mapping
]);
```
**Benefit:** Reduces latency from ~800ms to ~400ms

**Aggregation Queries:**
```javascript
// Use size: 0 to fetch aggregations only (no documents)
body: { size: 0, aggs: { ... } }
```
**Benefit:** Faster responses, less network bandwidth

**Batch Processing:**
```javascript
// Fetch 1000 docs at a time for large result sets
while (allDocsFetched < total && allDocsFetched < 10000) {
  const batch = await elastic.search({
    body: { ...query, from: allDocsFetched, size: 1000 }
  });
  // Process batch
}
```
**Benefit:** Prevents memory overflow, handles large datasets

### Index Optimization

**Fields Used:**
- `dateTime` - Always indexed (primary filter)
- `user.id`, `user.email` - Indexed (aggregations, filtering)
- `search.keyword`, `search.advertiser`, `search.domain` - Text fields with keyword subfields
- `network` - Indexed for platform filtering
- `filter.*` - Multiple indexed fields for filter extraction

**Recommended Mappings:**
```json
{
  "dateTime": { "type": "integer" },
  "user.id": { "type": "keyword" },
  "search.keyword": { "type": "text", "fields": { "keyword": { "type": "keyword" } } },
  "filter.country": { "type": "text", "fields": { "keyword": { "type": "keyword" } } }
}
```

### Rate Limiting Considerations
- Dashboard stats: Cache 5-10 min intervals
- Filter options: Cache 5 minutes
- Activity search: No caching (real-time data)
- Scraping history: Cached via MongoDB, ~1 min stale acceptable

---

## API Contract Summary

### Authentication
All endpoints except `/login` require Bearer token via `authMiddleware`.

**Login Flow:**
```
POST /login
Body: { "username": "Admin", "password": "Admin@123" }
Response: { "token": "jwt_token_here" }
```

### Standard Response Wrapper
```javascript
{
  code: 200|400|500,              // HTTP-like status code
  data: { ... },                  // Response payload
  message: "string",              // Human-readable message
  error: "string",                // Optional error details
  meta: { ... }                   // Optional metadata
}
```

### Pagination Standard
```javascript
{
  page: 0,           // 0-based page number
  page_size: 10,     // Items per page (max 100)
  total: 5234,       // Total items (not pages)
  total_pages: 524   // Calculated: ceil(total / page_size)
}
```

### Date/Time Standards
- **Input:** ISO 8601 strings ("2026-06-18T14:30:00Z") or Unix seconds
- **Storage:** Unix seconds in Elasticsearch (field: `dateTime`)
- **Output:** ISO 8601 strings in responses
- **Timezone:** UTC internally, handled client-side via `tz_offset_minutes`

---

## Monitoring & Debugging

### Logging Points
- `logger?.info?.()` - Request start, query execution
- `logger?.warn?.()` - Fallbacks, missing data, edge cases
- `logger?.error?.()` - Exceptions, connection failures

### Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| Slow dashboard load | Large aggregation queries | Check cache hit rate, adjust TTL |
| Missing emails in results | Email map not fetched | Verify Elasticsearch connection, restart |
| Stale filter options | Cache not clearing | Reduce cache TTL or clear manually |
| High-volume false positives | Threshold too low | Adjust threshold from 500 to N |
| Timezone mismatch | Offset not applied | Pass correct `tz_offset_minutes` |

### Performance Monitoring
```javascript
// Track query execution time
const startTime = Date.now();
const result = await elastic.search(query);
const duration = Date.now() - startTime;
logger?.info?.(`Query completed in ${duration}ms`);
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.1 | 2026-06-19 | Added total-ads-count endpoint with keyword breakdown |
| 1.0 | 2026-06-18 | Initial production release (8 endpoints) |

---

## Related Documentation
- [Code Review Report](./CODE_REVIEW_REPORT.md)
- [API Routes](./routes/adminUserActivityRoutes.js)
- [Helper Functions](./helpers/searchIntelligenceHelpers.js)
- [Query Builders](./queries/searchIntelligenceQueries.js)

---

**End of Intelligence Manifest**
