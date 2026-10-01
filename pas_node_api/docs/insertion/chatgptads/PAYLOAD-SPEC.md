# ChatGPT Ads (platform 21) — Insertion Payload Spec

This is the contract for whoever sends ad data into the ChatGPT Ads insertion API
(`POST /api/v1/chatgptads/insertion/adsData`). Send exactly this shape — a single ad object,
or an array of ad objects for a batch (`{ "ads": [ ... ] }` or a bare JSON array both work).

## Complete sample payload

```json
{
  "ad_text": "For long sitting in an ergonomic office chair, here is a back-support option.",
  "type": "IMAGE",
  "image_url_original": "https://example-cdn.com/ads/chair-ad.jpg",
  "image_video_url": "https://example-cdn.com/ads/chair-ad.jpg",
  "ad_title": "Make Every Chair More Comfortable",
  "post_owner": "Leeford Ortho",
  "post_owner_image": "https://example-cdn.com/logos/leeford-ortho.png",
  "newsfeed_description": "Add lower back support to your everyday chair for better comfort while you sit.",
  "news_feed_description": "Add lower back support to your everyday chair for better comfort while you sit.",
  "destination_url": "https://leeford.example.com/landing?utm_source=chatgpt",
  "ad_id": "123456789012",
  "platform": "21",
  "country": "India",
  "ad_position": "conversational_bottom",
  "first_seen": 1790748655853,
  "last_seen": 1790748655853,
  "version": "1.0.0",
  "uid": "ext-record-abc123",
  "network": "chatgpt"
}
```

## Field reference

| Field | Required? | Type | Notes |
|---|---|---|---|
| `type` | **Required** | string, exactly `"IMAGE"` or `"VIDEO"` | Decides which media fields are gated — see below. |
| `ad_id` | **Required** | string | The unique ad identifier from your side. Same `ad_id` sent again = this ad gets **updated**, not duplicated. |
| `platform` | **Required** | string | Always send `"21"` — this is the fixed platform number for ChatGPT Ads. Any other value is accepted but ignored; the system always stores `21`. |
| `post_owner` | **Required** | string | The advertiser/brand name. Ads from the same `post_owner` (case/whitespace-insensitive match) are grouped together. |
| `first_seen` | **Required** | integer, epoch **milliseconds** | When this ad was first observed. |
| `last_seen` | **Required** | integer, epoch **milliseconds** | When this ad was most recently observed. Resend the same ad with an updated `last_seen` to "bump" it. |
| `ad_title` | Optional | string or `null` | |
| `ad_text` | Optional | string or `null` | |
| `newsfeed_description` | Optional | string or `null` | See "duplicate field" note below. |
| `news_feed_description` | Optional | string or `null` | Same value as `newsfeed_description` — see note below. |
| `destination_url` | Optional | string (URL) or `null` | Where the ad links to. Used to derive the advertiser's domain. |
| `ad_position` | Optional | string or `null` | ChatGPT-native placement, e.g. `"conversational_bottom"`. Free-form — not a fixed enum. |
| `country` | Optional | string **or array of strings** | Either `"India"` or `["India","USA"]`. If the same ad is later re-sent with a different/additional country, it is **appended** to the ones already recorded — nothing is overwritten. Sending the same country again just updates its "last seen" count, it does not create a duplicate. |
| `version` | Optional | string or `null` | Your crawler/extension version, e.g. `"1.0.0"`. For traceability only. |
| `uid` | Optional | string or `null` | Your own internal record id (e.g. extension-side id). Stored for traceability/debugging only — does not affect anything functionally. |
| `post_owner_image` | Optional | string (URL) or `null` | Advertiser logo/avatar. |
| `image_url_original` | Required **for `type:"IMAGE"`**, optional otherwise | string (URL) | The ad's image. |
| `image_video_url` | Same field as `image_url_original`, either name works | string (URL) | If both are sent, `image_video_url` wins. Send the image under **one** of these two keys. |
| `other_multimedia` | Optional | array of URLs | Carousel images, if this ad has more than one image. ⚠️ **Shape not yet confirmed against a real payload** — see warning below. |
| `network` | Optional | string | Purely descriptive (e.g. `"chatgpt"`) — has no effect on routing or storage keys. Safe to always send `"chatgpt"` or omit it. |

### `type: "VIDEO"` — additional fields

| Field | Required? | Notes |
|---|---|---|
| `image_video_url` / `image_url_original` | **Required** | The video file URL (same two field names as above). |
| `thumbnail_url` | **Required** | A still-image thumbnail for the video. **If this is missing, the ad is rejected.** If the video URL turns out to be broken/expired but the thumbnail is fine, the ad is still **accepted** (the video is fetched in the background and retried later; a broken video link alone does not cause a rejection). |

> ⚠️ **`thumbnail_url` and `other_multimedia` field names are not yet confirmed against a
> real VIDEO or carousel payload** — no such sample has been seen yet. They are currently
> assumed to match Facebook's naming. If your actual payload uses different field names for
> the video thumbnail or carousel images, tell us before sending real VIDEO/carousel traffic,
> so the field mapping can be corrected.

### The `newsfeed_description` / `news_feed_description` duplicate

Today's real sample payload sends **both** spellings with the identical value. The system
only stores one canonical copy (preferring `newsfeed_description`). You can send either one,
or both with the same value (as today) — just don't send two *different* values in the two
fields, since only one will be kept.

### What happens if a required field is missing

The request is rejected with an HTTP 422/400 and a JSON body like:

```json
{ "code": 422, "status": "rejected", "message": "The ad_title field is required.", ... }
```

Nothing is saved when a request is rejected — not partially, not as a draft.

## Authenticating requests

Every request needs a header that proves it came from you.

- **Insert/update** (`POST /insertion/adsData`): header `x-signature` = `HMAC-SHA256(secret, raw_request_body)`, hex-encoded. The signature is computed over the **exact bytes** of the JSON body you send — pretty-printing or re-ordering keys after signing will break it.
- **Delete** (`POST /insertion/delete`): header `x-delete-token` = the shared delete token (ask the API owner for the current value — it's a plain shared secret, not a per-request signature). Body: `{ "ad_id": "..." }` or `{ "id": <internal id> }`.

Ask the API owner for the current `x-signature` secret and `x-delete-token` value — they are
environment-specific (dev vs prod) and not included in this doc on purpose.

## What you get back

A successful insert returns:
```json
{ "code": 200, "status": "ok", "message": "Ad inserted successfully", "data": { "id": 42 } }
```
A successful update returns:
```json
{ "code": 200, "status": "ok", "message": "Ad already present — existing data updated (id 42)", "data": { "id": 42 } }
```
`data.id` is our internal numeric id for the ad — different from your own `ad_id`. Keep your
`ad_id` as your reference; you generally won't need our internal id unless calling delete by
`id` instead of `ad_id`.

## What does NOT get updated on a re-send

If you send the same `ad_id` again with a **changed** `ad_title`/`ad_text`/`newsfeed_description`,
those changed values are **not** written over the original copy already stored — only
`last_seen`, the view/sighting count, and country are updated on a re-send. If your ad copy
can genuinely change over time for the same `ad_id`, flag this to the API owner — right now
the system assumes an ad's copy is fixed at first-seen time.
