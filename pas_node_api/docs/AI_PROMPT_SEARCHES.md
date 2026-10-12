# AI Prompt Searches (MongoDB)

Every search run from the AI prompt box ("Describe what you're looking for…") is stored in MongoDB as well as in the Elasticsearch `user_activities` index.

## Where

| | |
|---|---|
| Connection | `networks.user_activity.database.mongo` (`src/config/networks.js`, env `UA_MONGO_URI` / `UA_MONGO_DATABASE`) |
| Database (dev) | `pasdev_competitor` |
| Collection | `ai_prompt_searches` |
| Written by | `saveAiPromptSearch()` in `src/services/frontend_user_activity/controllers/userActivityController.js` |
| Retention | One year — TTL index `created_at_ttl_1y` on `created_at`, 365 days |

## When a document is written

On `POST /api/v1/frontend_user_activity/user-activity` with `method: getAds`, right after the Elasticsearch insert, **only when the record is an AI search** (`dashboard.ai_search: "true"`, i.e. the frontend sent a non-empty `ai_prompt`).

- One document per AI search: the frontend logs only the final search that loads the results, not the AI search's tier probes (`fetchAds` in `new-ui-react/src/services/api.js`).
- Filter or sort changes the user makes on top of AI results are logged with the same prompt, so they create further documents.
- The write is fire-and-forget. If MongoDB is unavailable or the insert fails, a warning is logged and the Elasticsearch activity and the API response are unaffected.

## Document shape

```js
{
  _id: ObjectId,
  user_id: "72688",
  email: "user@example.com",
  country: "India",                       // user's current country
  prompt: "Find ads promoting mobile app installs.",
  network: "All",                         // or "facebook,admob", "Chatgpt", …
  filters_applied: {                      // filters the search ran with
    ai_intent: ["app_install"],
    ai_analysed_only: "true",
    countries: ["India"]
  },
  filter_type: "filter_only",             // filter_only / search_only / search_and_filter
  ads_count: 719,
  ads_count_reason: "ok",                 // see ADS_COUNT_REASONS in api.js
  created_at: ISODate("2026-10-12T06:02:31Z")
}
```

`filters_applied` holds every field of the activity record except the ones stored at the top level (user, network, dates, counts, prompt). The `dashboard.` / `filter.` / `search.` / `search_by.` / `sort_by.` / `lander.` prefixes are removed and any remaining dots become `_`, because dotted keys are awkward to query in MongoDB. Example: `dashboard.ai_intent` → `ai_intent`, `filter.countries` → `countries`.

## One-year retention

Nothing to run manually. On the first AI prompt save after the API starts, `ensureAiPromptTtlIndex()` creates index `created_at_ttl_1y` on `{ created_at: 1 }` with `expireAfterSeconds: 31536000` (a no-op if it already exists). MongoDB's TTL monitor runs about once a minute and deletes documents whose `created_at` is older than 365 days.

If the index can't be created (e.g. the Mongo user lacks the permission), a warning is logged, the document is still saved, and the API retries on the next save.

## Example queries

```js
// AI searches in the last 7 days, newest first
db.ai_prompt_searches.find({ created_at: { $gte: new Date(Date.now() - 7 * 864e5) } }).sort({ created_at: -1 })

// Prompts that returned no ads
db.ai_prompt_searches.find({ ads_count: 0 })

// Most-used prompts
db.ai_prompt_searches.aggregate([{ $group: { _id: "$prompt", count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 20 }])
```
