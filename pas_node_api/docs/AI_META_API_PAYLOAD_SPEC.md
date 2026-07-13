# AI-Meta API — Payload Spec (for the DS enrichment pipeline)

**Version:** v1.6 · **Date:** 2026-07-13 · **Owner:** Anij Burnwal (backend)
**Audience:** the Data-Science team producing `ai_meta` from `ai_meta_classify.py`
**Companion docs (backend):** `AI_META_API_IMPLEMENTATION.md` · `AI_META_ES_MAPPING_RUNBOOK.md` · `AI_META_SQL_STORAGE.md`

This is the **contract** for what you send to the AI-Meta endpoint and what you get back. If a payload
doesn't match this spec the request is rejected (`400`) with a per-field error list — so please validate
against this before sending.

---

## 0. What changed in v1.6 (READ THIS)

**The category classification now lives entirely inside the `ai_meta` object.** Previously the category
name + ids were sent as *top-level* fields on the old classification POST (`newCatInsertion`). Going forward:

- Put `category`, `category_id`, `sub_category`, `subcategory_id` **inside `ai_meta`** (see §3.6).
- **Send the ids, not just the names.** `category_id` (4 chars) and `subcategory_id` (8 chars) are
  required whenever you send the corresponding name. The backend needs them to (a) maintain the shared
  **category taxonomy index** and (b) write the flat category codes the ad feed reads. A name alone is
  **not** enough and will be rejected.
- Use the **dedicated endpoint** `POST /api/v1/common/ai-meta` (§1). It now does everything: stores the AI
  labels, assigns the category, updates the taxonomy, and persists to SQL — all from one payload.

Changelog: `product_type`→`offering_type` (v1.4) · `reason`→`roa` (v1.4) · `caption` added (v1.4) ·
`colors` became a fixed hex palette (v1.2) · removed `object`/`language`/`ocr`/`brand_logos`/`status`
(v1.2–1.4) and `brand`/`celebrity` (v1.5) · **category `+ids` moved into `ai_meta` (v1.6)**.

---

## 1. Endpoint

```
POST /api/v1/common/ai-meta
Content-Type: application/json
```

Internal service (no auth token). One ad per request.

**Body (top level):**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ad_id` | string / number | ✅ | The ad's **public** id (same id you read from `getDescriptionDetails`). |
| `network` | string | ✅ | One of: `facebook`, `instagram`, `youtube`, `gdn`, `google`, `native`, `linkedin`, `reddit`, `quora`, `pinterest`, `tiktok`. |
| `ai_meta` | object | ✅ | The enrichment object — see §3. |

Unknown top-level keys are ignored.

---

## 2. `ai_meta` at a glance

| Field | Type | Required | Constraint |
|---|---|---|---|
| `ad_type` | string (enum) | ✅ | one of §4.1 |
| `intent` | string[] (enum) | ✅ | 1–5 items from §4.2, no dupes |
| `hook` | string[] (enum) | ✅ | 1–5 items from §4.3, no dupes |
| `offering_type` | string (enum) | ✅ | `product` \| `service` \| `both` |
| `offering` | string | — | ≤200 chars; omit if empty |
| `caption` | string | — | ≤200 chars; plain description of the image; omit if empty |
| `offers` | object[] | — | 1–3 items; see §3.4; omit entirely if no offer |
| `roa` | object | — | per-field reasoning; see §3.5; omit if all empty |
| `colors` | string[] (hex) | — | 0–3 items from the §4.5 palette, most-dominant first |
| `category` | string | — | category **name**, ≥5 chars — see §3.6 |
| `category_id` | string | —¹ | exactly **4** chars — required with `category` |
| `sub_category` | string | — | sub-category **name**, ≥2 chars — see §3.6 |
| `subcategory_id` | string | —¹ | exactly **8** chars, prefixed by `category_id` — required with `sub_category` |

¹ Conditionally required — see the pairing rules in §3.6. The **whole category group is optional**: omit
all four when the ad is uncategorized.

The 4 core fields (`ad_type`, `intent`, `hook`, `offering_type`) are **always required** — there is no
"partial"/"failed" payload. If the model can't decide, use the enum's `other` member rather than omitting.

---

## 3. Field details

### 3.1 `ad_type` (required)
A single value from §4.1. Use `other` if none fit.

### 3.2 `intent` / `hook` (required arrays)
1–5 values each, from §4.2 / §4.3. Order = your confidence order (most relevant first). No duplicates.

### 3.3 `offering` / `caption` (optional free text, ≤200)
- `offering` — what is being sold, in a few words (e.g. `"project management software"`).
- `caption` — a plain description of **what's visually in the image**, independent of the ad's text.
  (This has caught real image/text mismatches — e.g. text said "Grammarly" but the image was a Walmart
  banner.) Omit (don't send `""`) when empty.

### 3.4 `offers` (optional array, 1–3)
Each item: `{ "type": <enum §4.4>, "value": <number|null> }`.
- `value` is a number **only** for `percentage_discount` (0–100) and `flat_discount` (≥0).
- For **every other** offer type, `value` **must be `null`**.
- Omit the whole `offers` key when there is no offer (don't send `[]`).

### 3.5 `roa` (optional object — reasoning-of-action)
Per-field justification, keys: `intent`, `hook`, `offering_type`, `offering` — each a string ≤200. Empty
sub-fields are dropped; if all four are empty the whole object is dropped. Self-explaining fallbacks are
fine (e.g. `"No clear hook; defaulted to 'other'."`).

### 3.6 Category classification group (`category` / `category_id` / `sub_category` / `subcategory_id`)

**This is the v1.6 change.** Send the category the ad belongs to, **with its ids**:

- **`category`** — the category *name*, ≥5 chars (e.g. `"Retail"`).
- **`category_id`** — its stable **4-character** code (e.g. `"1234"`).
- **`sub_category`** — the sub-category *name*, ≥2 chars (optional).
- **`subcategory_id`** — its **8-character** code, and it **must start with** `category_id`
  (e.g. `category_id: "1234"` → `subcategory_id: "12340001"`).

**Pairing rules (all enforced):**
- `category` and `category_id` travel together — send both or neither.
- `sub_category` and `subcategory_id` travel together — send both or neither.
- A `sub_category` requires a parent `category`.
- If a name/id pair fails validation, **neither** half is stored (no half-pairs).
- Omit the entire group for an uncategorized ad.

**Why the ids matter (what the backend does with them):**
- `category_id`/`subcategory_id` are written as the **flat codes on the ad document** that the ad feed and
  filters read.
- They key the shared **master `category` taxonomy index** (the category dropdown: name ↔ 4-char id, with
  its sub-categories). A name alone can't maintain that index — hence ids are required.
- The category **name** is what maps to the SQL category store (see §5).

---

## 4. Enumerations

### 4.1 `ad_type` (16)
`testimonial`, `ugc`, `before_after`, `demonstration`, `comparison`, `problem_solution`, `explainer`,
`listicle`, `promotional`, `lifestyle`, `educational`, `announcement`, `storytelling`, `carousel`, `meme`,
`other`

### 4.2 `intent` (11)
`awareness`, `consideration`, `conversion`, `lead_generation`, `traffic`, `app_install`, `engagement`,
`retargeting`, `community_building`, `recruitment`, `other`

### 4.3 `hook` (16)
`scarcity`, `urgency`, `social_proof`, `authority`, `fear`, `curiosity`, `discount`, `pain_point`,
`aspiration`, `transformation`, `convenience`, `novelty`, `fomo`, `comparison`, `emotion`, `other`

### 4.4 `offers[].type` (13)
`percentage_discount`, `flat_discount`, `free_trial`, `free_shipping`, `buy_one_get_one`, `bundle_offer`,
`coupon`, `cashback`, `financing`, `consultation`, `demo`, `limited_time_offer`, `other`
(only `percentage_discount` and `flat_discount` carry a numeric `value`; all others → `value: null`.)

### 4.5 `colors` — fixed 16-value HEX palette
Snap each dominant image color to the nearest of these; send 0–3, most-dominant first. Matched
case-insensitively, stored uppercase. Named words (`"blue"`) and off-palette hex are rejected.

```
#000000  #FFFFFF  #808080  #C0C0C0  #E03131  #F76707  #F2CC0C  #2F9E44
#0CA678  #1971C2  #1E3A5F  #7048E8  #E64980  #8B5E34  #C9A227  #E8D8B0
```

### 4.6 `offering_type` (3)
`product`, `service`, `both`

---

## 5. What the backend does with your payload

On a valid request the backend, for the given ad:

1. **Stores the whole `ai_meta` object** on the ad's search document (ES `ai` field) — replaced wholesale
   each write (re-sending overwrites; stale fields from older shapes are dropped).
2. **If a category is present:** assigns it to the ad — writes the dotted `${network}.category` /
   `${network}.subCategory` **names** and the flat `category_id` / `subCategory_id` **codes** on the ad doc,
   and upserts the shared **master `category` taxonomy index** using your ids.
3. **Persists a durable copy to SQL** (`<net>_ad_ai_meta`), and syncs the category **name** to the network's
   SQL category store (`<net>_ad.category_id`) where one exists.
   - ⚠️ Only 7 networks have a SQL category store (facebook, instagram, youtube, native, linkedin, reddit,
     quora). For **gdn, google, pinterest, tiktok** the category is stored in ES only — this is a backend
     detail and needs nothing from you.

You don't need to send anything differently per network — the same payload works everywhere.

---

## 6. Responses

### 6.1 `200 OK`
```json
{
  "success": true,
  "ad_id": "531218",
  "message": "AI-Meta labels stored successfully",
  "stored_fields": ["ad_type","intent","hook","offering_type","offering","caption","roa","colors","category","category_id","sub_category","subcategory_id"],
  "category_sync": { "taxonomy": "New category and subcategory inserted successfully", "mirrored": true },
  "sql": { "sql_status": "stored", "sql_ad_row_id": 42, "category_synced": true }
}
```
- `category_sync` is present only when a category was sent. `taxonomy` echoes the master-index outcome (or
  `"conflict"`/`"error"` — non-fatal, the AI labels are still stored). `mirrored` = flat codes written to
  the ad doc.
- `sql` reports the durable write. `category_synced` is `false` on the 4 networks without a SQL category
  store — expected, not an error.

### 6.2 `400 Validation error`
```json
{
  "success": false,
  "ad_id": "531218",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "field": "ai_meta.category_id", "message": "category_id is required when category is present" },
      { "field": "ai_meta.colors[0]", "message": "'blue' is not in the allowed hex palette" }
    ]
  }
}
```
Every failing field is listed — fix all and resend.

### 6.3 `404 Ad not found`
```json
{ "success": false, "ad_id": "531218", "error": { "code": "AD_NOT_FOUND", "message": "Ad with id '531218' does not exist" } }
```
The ad id isn't in that network's index. Check `network`/`ad_id`.

### 6.4 `503` — the network's search backend is temporarily unavailable. Safe to retry.

---

## 7. Full example request

```json
{
  "ad_id": "531218",
  "network": "facebook",
  "ai_meta": {
    "ad_type": "promotional",
    "intent": ["conversion", "awareness"],
    "hook": ["urgency", "social_proof"],
    "offering_type": "product",
    "offering": "printer parts",
    "caption": "A hand holding printer parts against a white background.",
    "offers": [{ "type": "percentage_discount", "value": 20 }],
    "roa": {
      "intent": "The 'Shop now' button is a conversion CTA.",
      "hook": "'Only today' signals urgency.",
      "offering_type": "The copy names a physical product.",
      "offering": "'printer parts' specifies the product."
    },
    "colors": ["#FFFFFF", "#C9A227"],
    "category": "Retail",
    "category_id": "1234",
    "sub_category": "Specialty Stores",
    "subcategory_id": "12340001"
  }
}
```

An uncategorized ad simply omits the four category fields; everything else is unchanged.

---

## 8. Quick checklist before you send

- [ ] `ad_id` + `network` at the top level; everything else inside `ai_meta`.
- [ ] All 4 core fields present (`ad_type`, `intent`, `hook`, `offering_type`).
- [ ] `intent`/`hook`: 1–5 enum values, no dupes.
- [ ] `colors`: 0–3 from the hex palette (not names).
- [ ] `offers[].value`: number only for %/flat discount, else `null`; no empty `offers: []`.
- [ ] Empty free-text (`offering`/`caption`/`roa.*`) omitted, not `""`.
- [ ] **Category: send the name AND its id** — `category`+`category_id` (4), and if sub-categorizing,
      `sub_category`+`subcategory_id` (8, starting with `category_id`). Or omit all four.
