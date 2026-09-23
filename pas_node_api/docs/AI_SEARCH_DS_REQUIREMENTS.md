# AI Search DS Requirements

## Purpose

This document records the DS-side requirements identified while validating the
AI Search bug list. It is intentionally separate from the PAS implementation
notes: PAS can preserve, map, validate, and explain planner output, but it
cannot safely reconstruct missing intent from the original prompt.

## Ownership Boundary

### DS planner owns

- Extracting the complete subject, niche, brand, advertiser, platform, format,
  country, date, metric, CTA, and AI filter intent from the prompt.
- Mapping recognizable topics to the configured category taxonomy when a safe
  taxonomy match exists.
- Distinguishing numeric comparisons from vocabulary values. For example,
  `more than 10k likes` must produce a likes lower bound and must not produce a
  `More` CTA.
- Supporting the agreed prompt languages, or returning an explicit unsupported
  language/planner outcome instead of an empty or unchanged response.
- Ranking inferred filters and returning fallback tiers that progressively relax
  lower-confidence constraints when the most-specific tier has no results.

### PAS frontend/backend owns

- Preserving the complete `planning` object and each payload item unchanged.
- Mapping only supported `args`/`full_payload` fields into the existing SDUI
  state and Common Ads Search request.
- Keeping `planning` metadata out of Common Ads Search.
- Never manufacturing a keyword from the raw prompt, consumed phrases,
  unsupported operations, or UI labels.
- Showing a capability notice when DS reports unsupported or unmapped work.
- Probing DS fallback tiers using displayable ad records, not only backend
  totals, and committing the first tier that returns usable ads.

## Required Planning Contract

Every payload item should keep its structured arguments beside the complete
planning metadata:

```json
{
  "label": "initial",
  "args": {
    "keyword": "shoe",
    "likes": { "min": 500 }
  },
  "full_payload": {},
  "planning": {
    "search_term_role": "subject",
    "consumed_phrases": ["more than 500 likes"],
    "unsupported": [],
    "quick_filter": "",
    "date_filter": {
      "field": "last_seen",
      "preset": "last_7_days"
    }
  }
}
```

The planner must not put a phrase into `keyword` when its role is
`instruction`, `unsupported`, or `ambiguous`. A subject that remains after
structured phrases are consumed should be returned explicitly as `keyword`,
`advertiser`, or `domain`.

## Required Behaviors

### Subject and brand preservation

- `Facebook video ads for weight loss in the US` must retain `weight loss` as
  a subject keyword or map it to the matching category, in addition to the
  platform, country, and ad type.
- `Nike YouTube ads with Shop Now CTA from the last 30 days with more than 10k
  likes` must retain `Nike` as an advertiser or subject keyword.
- `Find ads promoting mobile app installs` must map the intent to
  `app_install`, but must not select the visible App Install Quick Filter
  unless `planning.quick_filter` explicitly contains `app_install`.

### Numeric and instruction parsing

- `more than 10k likes` -> `likes.min = 10000`.
- `below 4.5k likes` -> `likes.max = 4500`.
- `between 500 and 2,000 likes` -> inclusive likes range `500..2000`.
- `highest impressions` -> impressions descending sort when supported.
- `highest views` -> no `keyword = view`; return a structured unsupported item
  if views sorting is unavailable.

### Date dimensions

Use `planning.date_filter` and do not convert date phrases into keywords:

- `posted` or `published` -> `field = post_date`.
- `first seen` or `discovered` -> `field = first_seen`.
- `last seen` or `last active` -> `field = last_seen`.
- Generic phrases such as `from last week` -> `field = last_seen`.
- Recognized relative ranges use `preset`; custom ranges use inclusive
  `start_date` and `end_date` in `YYYY-MM-DD` format.

### Unsupported and partial requests

- If an instruction cannot be executed, return an item in
  `planning.unsupported` with `operation`, `field`, and a user-facing
  `reason`.
- If a prompt contains both supported and unsupported parts, retain the
  supported subject/filter in `args` and report only the unsupported part in
  `planning.unsupported`.
- If no independent subject or supported filter remains, return an explicit
  unsupported/ambiguous outcome. Do not return a platform-only payload that
  would cause a broad default search.
- If a field cannot be represented by the current PAS contract, include it in
  planning metadata rather than silently dropping it.

### Fallback tiers

For prompts that infer several filters, return ordered tiers when possible:

1. Most-specific interpretation.
2. Same subject and high-confidence filters with lower-confidence constraints
   removed.
3. Subject/platform-only interpretation where appropriate.

Each tier should carry expectations or equivalent metadata when available so
the frontend can verify that the selected tier still represents the prompt.

## Acceptance Prompts

The following cases should be checked against the DS response before release:

| Prompt | Required result |
|---|---|
| `Facebook video ads for weight loss in the US` | Topic retained; Facebook, US, and video retained; no unrelated broad result. |
| `Nike YouTube ads with Shop Now CTA from the last 30 days with more than 10k likes` | Nike retained; Shop Now only; likes minimum 10000; last-seen date unless explicitly posted wording is used. |
| `TikTok ads targeting women aged 25-34 with urgency hooks and red and black colors` | Supported TikTok, urgency, and colors retained; unsupported gender/age reported clearly if unavailable. |
| `Show me ads for weight-loss products` | Topic/category and offering intent retained; no redundant visible Quick Filter unless explicitly requested. |
| `Show me ads with highest views` | No `view` keyword; structured unsupported capability metadata. |
| `Show me ads posted in the last 30 days` | `date_filter.field = post_date`, `preset = last_30_days`, no keyword. |
| `Show me ads from the last 45 days` | `date_filter.field = last_seen`, custom inclusive dates, no keyword. |
| `asdkjh qwe zzzz 12345 !!!` | Ambiguous/unsupported outcome; no platform-only or default search payload. |

## Non-functional Requirements

- Keep payload generation within the agreed planner timeout and return a
  deterministic error/outcome on timeout or upstream failure.
- Do not return null placeholder payload items as successful tiers.
- Keep `planning` JSON-serializable and stable across the async init/poll
  response path.
- Do not silently rewrite a legacy value such as `other` into an unrelated
  classification. Apply the nullable/reclassification policy from the AI-Meta
  payload contract.

