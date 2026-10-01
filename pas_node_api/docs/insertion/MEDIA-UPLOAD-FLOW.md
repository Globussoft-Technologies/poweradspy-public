# How insertion uploads media now (issues fixed + flow)

Redesigned 2026-06-26. Goal: **fast inserts at 400k+/day, no data loss, no fake paths, no disk-fill outage.**
All changes are in the shared layer (`src/insertion/helpers/`), so every network gets them at once.

## What was fixed and how it works now

| # | Issue (before) | How it's handled now |
|---|---|---|
| 1 | **Upload transport** — SFTP-only was timing out / connections failing under load | **HTTP-first chain** `["httpOrigin","sftp"]`: upload to the **non-Cloudflare origin** `http://125.16.67.186:8119/{bucket}/upload` first (fast — 183 MB in ~50 s), **auto-fall back to SFTP** if HTTP fails. Config-driven, no redeploy to switch. |
| 2 | **Cloudflare ~100 MB cap** — `media.globussoft.com` 413'd large video → never uploaded | `httpOrigin` hits the **origin IP directly (no Cloudflare)** → no body cap; 800 MB video uploads fine. (`http`/Cloudflare kept as a fallback option.) |
| 3 | **Insert was slow** — video file downloaded **and** uploaded inside the request (~40 s+) | **Video is fully off-request.** Insert commits ad + thumbnail and **responds in ms**; video handled entirely in the background. Only the small image/thumbnail uploads in-request. |
| 4 | **"Fake" paths** — a predicted `nas_video_url` was stored even if the video never downloaded | **Never-fake:** `nas_video_url` is written **only after** the bytes are secured. If the download fails, the field stays empty (ad keeps its thumbnail). |
| 5 | **~20% of video = DefaultImage** — download was one-shot, no retry | **Durable video download-queue** (`data/nas-video-pending/`): persisted on insert, retried with backoff while the URL is fresh, survives a crash/restart. Plus per-download retries. |
| 6 | **Server crashed (disk full)** — `nas-pending` grew to 34 GB | **Hard 10 GB cap** (`pendingMaxGB`) — new items dropped (logged) before the disk can fill. |
| 7 | **Memory blow-up** — each download buffered the whole file in RAM (800 MB × concurrency → OOM) | Downloads now **stream straight to disk** — constant memory regardless of file size. |
| 8 | **Lost media on transient failures** | Two **durable on-disk queues** (download → upload), self-healing via a 1-min cron; bytes kept (source URLs expire, so we never re-download). |
| 9 | **Protected/expiring video URLs failing** | Network-appropriate **Referer** + real browser **User-Agent** (was a hard-coded quora Referer for every network); download **triggered immediately** on insert (URL freshest); 401/403/410 logged with host so we can see expiry/protection patterns. |
| 10 | **Timeouts not tunable** | All in `config.insertion.nas.*` (see below): in-request `15 s` vs **background upload `30 min`**, download retries, etc. |
| 11 | **Re-seen ad with `DefaultImage`** wasn't being fixed | On re-seen (UPDATE): if the stored image/thumbnail OR video is missing/`DefaultImage`, the media is **re-attempted**; if it's already good, **only stats update — no re-download** (saves writes). |
| 12 | **Couldn't tell why a given ad's image didn't store** | Dedicated **`logs/nas-media-<date>.log`** (2-day rotation) — one JSON line per failure, keyed by `adId` (stage + reason + host). `grep` the ad id to see exactly what failed. No SQL schema change anywhere. |

## Re-seen ads (UPDATE) — re-upload only when broken

When the same ad comes again:
- **Image/thumbnail** missing or `DefaultImage` → re-download + re-upload (SQL `image_url` + ES). Already good → skipped.
- **Video** missing or `DefaultImage.mp4` → re-attempt via the background download-queue (worker re-downloads → writes `nas_video_url` to ES). Already good → skipped.
- Everything else → just **stats** (analytics / hits / last_seen). No media work, no wasted writes.

`nas_video_url` stays **ES-only — NO SQL schema change**. The re-seen video gate reads the old ES doc's carry-over (`carryOver.nas_video_url`, no extra query). Crash-safety does NOT depend on ES: the download-job is on disk (`data/nas-video-pending/`) and **resumes on restart** until the bytes are secured and the path written.

### Google Transparency VIDEO thumbnail

Platform 18 payload `thumbnail` is IMAGE media, not VIDEO media. It uploads
in-request through `uploadThumbnail` to `gt/thumbnail`; the NAS path is stored
in `google_text_ad_variants.image_url` and ES `thumbnail`. The incoming source
URL is used only for upload and is not persisted.

Therefore `{ "image": true, "video": false }` still stores the thumbnail but
does not download, upload, or queue the video. `{ "image": false }` disables
the thumbnail as well. A valid existing thumbnail path is reused on update.

Platform-18 validation runs before SQL/NAS work: `type=VIDEO` requires an
absolute HTTP(S) `thumbnail`, while `type=IMAGE` requires an absolute HTTP(S)
`image_url_original`. Missing, null, empty, relative, or malformed required
media URLs reject that payload item with HTTP/result code `422` and the exact
field name. `type=TEXT` may use a nullable `image_url_original`, but it must
provide at least one non-empty `ad_title`, non-empty `ad_text`, or valid
`image_url_original`.

## Diagnostics — per-ad-id NAS log (2-day rotation)

Every media store **failure / defer** writes one JSON line, keyed by `adId`, to **`logs/nas-media-<date>.log`** (retention `config.insertion.nas.logMaxDays`, default `2d`). So to find *why a specific ad's image didn't store*:
```
grep '"adId":"<AD_ID>"' logs/nas-media-*.log
```
Each line has `adId, network, type (IMAGE/THUMBNAIL/VIDEO/…), stage (download/upload/video-download), reason, host`. Example:
```json
{"adId":"38517231","network":"facebook","type":"IMAGE","stage":"download","reason":"source download failed (expired/blocked URL?)","host":"video.fbcdn.net"}
```
Logged at: source download fail (expired/blocked URL), upload chain exhausted, temp file missing, video-download give-up.

## The flow now

```
INSERT (video ad)
  ├─ download THUMBNAIL only (gate) → upload in-request
  ├─ commit ad + thumbnail
  ├─ enqueue video download-job (disk)  ── nas_video_url left UNSET (never fake)
  └─ RESPOND in ms
                                   │ (immediately + every 1 min, background cron)
  sweepVideoDownloads ────────────┘
  ├─ download video (streamed, while URL fresh)
  ├─ storeInNas('VIDEO') → secure bytes in UPLOAD queue → deterministic path (now guaranteed)
  └─ write REAL nas_video_url onto the ES doc
                                   │
  sweepPending ────────────────────┘
  └─ upload secured bytes to NAS:  httpOrigin → (on failure) sftp
```

IMAGE ads: download image (streamed) → upload via the chain **in-request** → respond.

## Retries — how many HTTP attempts before SFTP

| Stage | HTTP attempts | Then |
|---|---|---|
| **In-request** (images), `nasClient.storeInNas` | **2** attempts (`UPLOAD_MAX_ATTEMPTS`, 300 ms backoff; 2nd only on a retryable 5xx/timeout — `408/425/429/500/502/503/504`) | switch to **SFTP** (1 attempt); if that fails too → defer to the upload queue |
| **Background** (video), `nasUploadQueue.sweepPending` | **1** httpOrigin attempt **per sweep** | **SFTP** (1 attempt) same sweep; whole job reschedules with backoff up to **50** sweeps, then `failed/` |
| **Download** (`downloadToTemp`) | **3** attempts (`downloadRetries`, 300 ms backoff, on retryable status / timeout) | give up (job reschedules for a later sweep) |

A **non-retryable** HTTP status (e.g. 400/404) skips straight to the next transport — no wasted retries.

## config.json changes (`insertion.nas`)

| Key | New value | What it does |
|---|---|---|
| `store` | `{ "image": true, "video": true }` | master ON/OFF per type. **`video:false`** → ad video never downloaded/uploaded/queued (no file in either queue); thumbnails still store, including Google Transparency `thumbnail`. `image:false` → skip images/thumbnails/postowner/carousel too. Stops video cleanly when the source CDN blocks this box's IP. |
| `uploadTransport` | `["httpOrigin","sftp"]` | ordered fallback chain for ALL media (image + video) |
| `originUrl` | `http://125.16.67.186:8119` | direct-IP HTTP base (no Cloudflare, no body cap) |
| `uploadTimeoutMs` | `15000` | per-attempt timeout for an **in-request** (image) upload |
| `queueUploadTimeoutMs` | `1800000` | per-attempt timeout for a **background** (video) upload — **30 min** |
| `pendingMaxGB` | `10` | hard cap on the upload queue dir (`data/nas-pending/`) |
| `downloadRetries` | `3` | download attempts before giving up |
| `logMaxDays` | `"2d"` | retention for the per-ad-id NAS diagnostics log (`logs/nas-media-<date>.log`) |

Existing keys unchanged: `mediaUrl`, `mediaUploadPath`, `mediaToken`, `bucket`, `verifyTls`, `timeoutMs`, `sftp*`.
Every key also reads from an env var (`NAS_TRANSPORT_CHAIN`, `NAS_ORIGIN_URL`, `NAS_PENDING_MAX_GB`, `NAS_QUEUE_UPLOAD_TIMEOUT_MS`, `NAS_DOWNLOAD_RETRIES`, …) when blank in config.json.

> **Per environment:** on prod set `bucket: "pas-prod"` and the prod `originUrl` + SFTP creds (via env). Requires `ssh2-sftp-client` installed.

## Protected / expiring video URLs (fbcdn etc.)

Ad video URLs in the payload are usually **signed + short-lived** (e.g. fbcdn `oe=`/`oh=` tokens). To maximise successful downloads:
- **Browser User-Agent + network-appropriate Referer** (facebook→facebook.com, instagram→instagram.com, quora→quora.com, …; fallback = the URL's own origin). This fixes signed CDNs that 403 a wrong/missing Referer.
- **Download immediately** on insert (`setImmediate` wake of the sweeper) so the URL is fetched while freshest, not up to 60 s later.
- **Follows redirects** (up to 5) and accepts `video/*`.
- A `401/403/410` is logged with the host (it means the URL is protected or already **expired** — retrying the same URL can't recover it; only a fresh re-send of the ad can).

## Troubleshooting the NAS log

**`video could not be queued (no ext / queue full)`** (stage `upload`, type `VIDEO`) — `data/nas-pending/` hit the **10 GB cap** (`pendingMaxGB`) or disk <3 GB free, so the bytes couldn't be buffered. Means **uploads to NAS aren't draining**. Check, in order:
1. **`bucket` must be `pas-prod` on prod** (config.json ships `pas-dev`!) — set `bucket: "pas-prod"` (or `""` to derive from env). A wrong bucket makes uploads land/forbidden in the wrong place.
2. Upload endpoint reachable from the prod box: `curl -F key=test/x -F file=@somefile http://125.16.67.186:8119/pas-prod/upload` → expect `{"ok":true,...}`. If not, SFTP must be reachable (creds + `ssh2-sftp-client` installed).
3. `du -sh data/nas-pending` — if ~10 GB it's capped; it clears as the sweep uploads. Raise `pendingMaxGB` only as a temporary buffer.

> The background worker now uploads video **inline** (download→upload→free), so only genuine upload *failures* buffer in `nas-pending` — this error should disappear once uploads succeed.

**`source download failed (expired/blocked URL?)`** (stage `download`, host `*.fbcdn.net`) — the source media URL was **expired or blocked** (signed fbcdn token died, or 403). Usually a **freshness** problem: the URL expired between scrape and insert. Correlate the HTTP status in `combined-<date>.log` (`media download failed (non-200)`): `403/410` = expired/blocked (not recoverable for that URL — only a fresh re-send of the ad fixes it); a timeout = slow source. DefaultImage is stored; the re-seen gate re-attempts when a fresh URL arrives.

Files: `mediaUpload.js` (download), `nasClient.js` + `nasHttpUpload.js` + `nasSftpPool.js` (upload chain),
`nasUploadQueue.js` (upload queue + cap), `nasDownloadQueue.js` (video download queue + ES write-back),
`jobs/nasUploadRetryCron.js` (1-min sweeps).

## Manual recovery: upload both pending and failed

The normal cron processes due JSON/blob pairs directly inside `data/nas-pending/`. After 50 failed
attempts it moves both files into `data/nas-pending/failed/`, where the cron intentionally leaves
them for manual recovery.

From the `pas_node_api` directory, first validate both directories without changing files:

```bash
npm run nas:upload-pending -- \
  --pending-dir /home/poweradspy-backend-ftp/pas_node_api/data/nas-pending \
  --dry-run
```

Then force-upload every valid pair from both `nas-pending/` and `nas-pending/failed/`:

```bash
npm run nas:upload-pending -- \
  --pending-dir /home/poweradspy-backend-ftp/pas_node_api/data/nas-pending \
  --concurrency 5
```

This command ignores `nextAttemptAt` and the 50-attempt limit. It uses each JSON sidecar's recorded
transport chain and current NAS configuration. A JSON sidecar and its blob are deleted only after a
confirmed upload; failed, malformed, or incomplete pairs remain in place and make the command exit
non-zero. On production, verify that the resolved bucket is `pas-prod` and that the HTTP-origin
and/or SFTP credentials are configured before running the real upload.
