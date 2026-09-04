# Search-time crawl-status banner + first-ad push — Design Manifest

> Companion to `TODAYS_SEARCHES_INDICATOR_MANIFEST.md` and `KEYWORD_AD_NOTIFICATION_MANIFEST.md`.
> Documents the requested behavior at the moment a user submits a keyword/advertiser/domain
> search: which message they see depending on whether cached ads exist, and when a push
> notification fires as new ads are found.
>
> **Status: IMPLEMENTED AND VERIFIED.** Part A/B (the frontend banner) is a fully derived
> value now, not stored toast state — see §2 for why that rewrite happened. Part C (first-ad
> push) went through two earlier architectures (documented in §3 for history) before landing
> on its final shape: a per-claim watcher spawned the moment a scraper claims a term, fully
> independent of the 20-ad bell. Both parts verified end-to-end against real dev
> Mongo/SQL/ES and **real Firebase credentials**, including actual pushes delivered to a real
> device. See §5 for what testing found (including two real-data incidents caught and
> reverted) and §6 for current known gaps.

---

## 1. Requirement (as given)

When a user searches a keyword / advertiser / domain:

1. **No ads currently indexed** → tell them we're crawling now, ads should be ready in
   **15–20 minutes**.
2. **Old/cached ads already exist** → tell them the crawler is still running in the
   background to fetch anything new, and they'll be notified.
3. **The moment at least one new ad is inserted** (same day) → send a **push notification**
   to that specific user, checked continuously from the moment the scraper takes the term
   until it finishes.

---

## 2. Part A/B — frontend crawl-status banner, as actually implemented (App.jsx)

**Final shape: a fully derived value, not stored toast state.** The banner went through
several rounds of imperative `setToast(...)` calls (submit-time spinner → async
`saveKeywordSearch().then()` callback → a couple of reactive-sync effects added to chase
races between them) before all of that was retired. Entry points that fire several other
state changes ahead of the search itself in the same click — Market Trends' `onDrill`,
Projects' competitor platform clicks — kept losing the race: the banner would get stuck on
the "underway" spinner even with real results already on screen, or fail to show at all if
its one triggering `showToast()` call got lost. Deriving both visibility and content at
render time from state that's already reliable removed the race entirely instead of chasing
each new instance of it.

The current implementation, in [App.jsx](../../new-ui-react/src/App.jsx):

```js
const searchBannerVisible = hasActiveSearchQuery && onAdsDashboardPage && !adDetailModalOpen && !selectedAdForAnalytics;
const searchBannerLoading = ads.length === 0 && loadingMore;
const searchBannerMessage = ads.length > 0
  ? "Showing what we have — our crawler is still checking for new ads. We'll notify you if anything new shows up."
  : searchBannerLoading
    ? `Your ${searchBannerLabel} search is underway. We're scanning for the newest matching ads.`
    : "No ads yet for this — we're crawling now. Usually ready in 15–20 min; we'll notify you the moment new ads come in.";
```

- **`hasActiveSearchQuery`** (`ui.searchQuery` non-empty) is the load-bearing gate — the
  banner *cannot* render without a live search, regardless of how it got cleared. This
  replaced a whack-a-mole of individually adding `hideToastAfter("search", 0)` calls at every
  place the search box could be cleared (the "×" button, "Clear all filters", account/network
  switch, AI search reset, ...) — three separate rounds of bug reports each found one more
  bypass point, so the fix stopped being "find the next missed call site" and became "make
  the banner's existence structurally depend on the query, not on any of them."
- **`onAdsDashboardPage`** (`ui.activePage === 'ads' && !ui.showSavedAdsPage`) hides the
  banner while on another top-level page and lets it reappear automatically on return — a
  render-gate, not a dismiss, so no state is lost by navigating away.
- **`adDetailModalOpen` / `selectedAdForAnalytics`** hide it while an ad detail or analytics
  modal covers the page, same non-destructive render-gate pattern.
- **`loadingMore`** (existing pagination-loading state) drives the spinner vs. settled text
  — checked *after* `ads.length` so scrolling for more pages of an already-showing search
  doesn't flash the "underway" spinner back on. The reset effect that clears `ads` to `[]` on
  a new search/filter context also sets `loadingMore = true` in the same tick (not waiting for
  the debounced fetch to actually start ~120ms later) — without that, there was a real gap
  where the banner would read "No ads yet" for a moment before flipping to the correct
  "underway" spinner.
- **Every `handleSearch` call now shows the banner**, not just the header search box. The
  banner used to be opt-in via an `options.showScraperToast` flag that only the header's
  `onSearch` ever passed — every other entry point (Market Trends, Projects, Keyword
  Explorer, Saved/Hidden Ads, an ad card's "search this advertiser", `?advertiser=`/
  `?keyword=` deep links) silently never showed it. Removed the opt-in; `handleSearch` shows
  it for any non-empty query, from any caller.

A dedicated modal (`crawlNoticePopup` state + an OK-button dialog) was built earlier in the
session and explicitly reverted back to a toast/banner approach per direct feedback —
mentioned here only so a future reader doesn't go looking for it.

---

## 3. Part C — first-ad push, as actually implemented

**Final architecture: a per-claim watcher, not a cron.** Two earlier architectures were built
and verified working before landing here — both are documented below since the reasoning for
moving past each one is worth keeping.

### 3.1 Where it lives now

Hooked into `scraperWork()` — `POST /keyword-search/work`
([keywordSearchController.js](../src/services/common/controllers/keywordSearchController.js)),
the endpoint scrapers call to claim work. The moment a batch is claimed, one watcher is
spawned per claimed item (fire-and-forget — never awaited, so it can't delay the scraper's
response):

```js
if (config.keywordSearch.notify?.enabled !== false && config.keywordSearch.notify?.firstAdPushEnabled !== false) {
  for (const item of claimed) {
    startFirstAdPushWatcher(item);
  }
}
```

Gated explicitly at this call site (not just inside the watcher itself) so that with the
feature off, claiming does zero extra work per item — no function call, no ES/Mongo/MySQL
touched at all, matching "if disabled, skip this step entirely."

`startFirstAdPushWatcher({ docId, scrapeId, type, value, network })`
([keywordAdNotificationController.js](../src/services/common/controllers/keywordAdNotificationController.js)):

1. Waits **3 seconds** (fixed, not configurable — the ask was specifically "3s once, then
   every N minutes").
2. Checks Elasticsearch for the current ad count (uncached — bypasses the existing 5-min
   `getAdsCountCached` cache, since a watcher's whole point is a fresh read every tick).
3. **Ads found (≥1)**: sends the push to every searcher not yet pushed today for this
   (term, network), marks the dedup flag, **stops** — no more checks for this claim.
4. **Still 0**: looks up whether the specific session (by `scrapeId`) is still `'scrapping'`.
   Closed → stop, nothing left to check. Still open → wait
   `config.keywordSearch.notify.firstAdPushCheckIntervalSec` (default `300` = 5 min) and
   repeat from step 2.

No cross-worker/cross-host coordination needed (unlike every cron in this codebase, which
needs a MySQL named lock to avoid every PM2 worker running the same job) — each watcher only
ever runs in the same process that served the claim it belongs to, so there's nothing for two
workers to duplicate.

**Accepted trade-off**: lives entirely in memory. If this process restarts mid-scrape (a
deploy, a crash, a PM2 worker recycle), an in-flight watcher is lost and that specific claim
won't be checked again this run, even if ads do land for it later. Explicitly decided against
a safety net for this (see §3.4) in favor of simplicity — this is a deliberate choice, not an
oversight.

Config (`config.keywordSearch.notify`): `firstAdPushEnabled` (default `true`, shared with the
now-removed bell-scan usage — see §3.3) and `firstAdPushCheckIntervalSec` (default `300`).

### 3.2 Architecture 1 (original design) — reused the 15-min cron/poll directly

The very first implementation hooked the push into the existing `runKeywordAdNotificationScan`
(15-min cron) and `runUserKeywordAdScan` (60s per-user poll): right after each function
computed `adsCount` for a (term, network), `if (adsCount >= 1)` it sent the push, using the
exact same threshold-check machinery already in place for the 20-ad bell. Simple, no new
infrastructure, and it worked — but the check cadence was tied to the bell's cadence, meaning
up to 15 minutes of lag for a user without the app open. A mid-scrape fix was also needed
here: both scan functions' doc-selection query originally excluded any term still
`status: 'scrapping'`, so a term whose session hadn't yet closed was invisible to the scan
entirely — confirmed with a real claimed-but-open session before broadening the query to
`{ scrapping_status: { $elemMatch: { date: today } } }` (any status today, not just
completed/failed).

### 3.3 Architecture 2 (intermediate) — a dedicated fast-scan cron

To close the 15-min gap without touching the bell's own cadence, a second, tighter interval
job was built: `runFirstAdPushFastScan()` + `firstAdPushFastScanCron.js`, ticking every
~20s (`firstAdFastPollSec`) but scoped to a much smaller set — only docs with a currently-open
session, only networks with a not-yet-pushed user — so it stayed cheap at that cadence, using
the same `isEsUnderStress()`/`withLimit()` cross-process ES guard every other consumer in this
app already shares. Verified working end-to-end (0-ads → found → dedup → session-closes
scenarios all passed against real dev infra) before being explicitly reverted by direct
request in favor of the per-claim watcher (§3.1) — a periodic *global* scan checking
"what's currently open" is a fundamentally different shape than a watcher tied to the
*specific* claim event that started the scrape, and the latter was the actual ask. All of
that cron's files/config keys were removed when the watcher replaced it.

### 3.4 Separated from the 20-ad bell entirely

The bell-threshold logic (`if (adsCount < threshold) continue; ... upsert into
keyword_ad_notifications`) still lives in `runKeywordAdNotificationScan`/
`runUserKeywordAdScan` exactly as before — but the first-ad-push branch that used to sit next
to it (Architecture 1, §3.2) was removed once the watcher became the sole sender. Confirmed by
grep that no shared config flag or control-flow branch remains between the two features — the
only thing still shared is two small helper functions (`sendFirstAdPushSafe`,
`isAdFoundPushedToday`), pure code reuse for "how to send + dedup a push," not a functional
coupling. One incidental effect of the removal, called out explicitly rather than left
implicit: those scan/poll functions were *also*, by accident, providing a partial safety net
for the §3.1 restart-loss trade-off (they'd eventually re-check any term scraped today
regardless of whether its watcher survived a restart). Removing the old push logic from them
removed that incidental coverage too — the restart-loss gap is now uncushioned, matching what
was explicitly asked for.

---

## 4. Notification branding (icon)

**Current state**: every reference — [FirebaseService.js](../src/services/FirebaseService.js)
(send side), [usePushNotifications.js](../../new-ui-react/src/hooks/usePushNotifications.js),
[firebase-messaging-sw.js](../../new-ui-react/public/firebase-messaging-sw.js), and
`public/service-worker.js` (dead code — no `navigator.serviceWorker.register(...)` call
targets it anywhere in the frontend, confirmed by grep; kept in sync for consistency only)
— points at **`/assets/favicon.png`**, backed by a direct, unmodified copy of
`src/assets/favicon.png` placed at `public/assets/favicon.png`. Same file, same path
convention, applied across three separate systems that all send push via the same Firebase
project: `new-ui-react`, `api_youtube`, and the legacy PHP backend at `power-ad-spy-tool/api`
(a local working copy — needs its own deploy to take effect there).

The original path (`/assets/imgs/icon-192x192.png` / `.webp`) never had a backing file at
all in any of these three, which is why every notification showed a blank/default icon
before this. That path went through several iterations before landing here — the full
PowerAdSpy wordmark logo (illegible when squeezed into a small circular slot), then a
hand-cropped square "AD" badge mark (cut from the wordmark via Windows' built-in .NET
`System.Drawing`, no new dependency), before the final direction to just use `favicon.png`
(the blue lightning-bolt/speech-bubble mark) as-is, unmodified — matching what a fourth,
unrelated legacy system (`power-ad-spy-tool/web`, a *different* Firebase project entirely —
see below) already shows in production.

**A fourth, separate push-sending system was found**: `power-ad-spy-tool/web`
(`public/assets/js/firebase-conf.js` + `firebase-messaging-sw.js`) — an older Laravel
frontend on a **different Firebase project** (`poweradspy-firebase-prod`, no suffix,
Firebase SDK v8 compat API) from the one this session's work uses
(`poweradspy-firebase-prod-dea66`). This is what actually produces the "Lander Data
Retrieval Failed"-style notifications seen live on `app-dev.poweradspy.com` — a
completely separate codebase, not something this manifest's feature touches. Two things
copied from reading it, not yet applied to our implementation:
- `requireInteraction: true` in its `showNotification()` options — keeps the notification
  on screen until dismissed, instead of Chrome's default auto-dismiss after a few
  seconds. Not currently set anywhere in our `firebase-messaging-sw.js`/
  `usePushNotifications.js`.
- Per-action icons on the Open/Close buttons (`/assets/imgs/open.png` / `cancel.png`).
  Ours currently sends text-only actions.

---

## 5. What testing found (worth keeping)

1. **A real bug in the ORIGINAL (§3.2) implementation, caught by testing, not by review**:
   `adFoundPushed` was being silently stripped by both scan functions' Mongo `find()`
   projections (explicit inclusion lists that didn't name the new field), so the dedup check
   always read `undefined` and re-sent every tick. Fixed by adding `adFoundPushed: 1` to both
   projections — this class of bug no longer applies to the current architecture, since the
   watcher does its own `findOne` with an explicit projection.
2. **Mid-scrape trigger, confirmed both broken and fixed with the same test** (§3.2): before
   the fix, a synthetic doc with an open (`status: 'scrapping'`) session and ES already
   showing 1 matching ad produced `scanned: 0, push sent: 0`. After broadening the
   doc-selection query, the identical setup produced `scanned: 1, push sent: 1`.
3. **Real credentials, real send**: `pas_node_api/firebase-credentials.json` (service account
   for `poweradspy-firebase-prod-dea66`) verified live — a real OAuth2 token exchange with
   Google succeeded, and a real push was sent via `firebaseService.sendNotification()` to a
   real registered token, confirmed received on a real device.
4. **Final watcher (§3.1) lifecycle verified against real dev Mongo/ES/SQL/Firebase**
   (`tests/firstAdPushWatcher.manual.js`, using real short timers, ES/SQL/Firebase
   intercepted): 0 ads at the first check → ads land before the second → exactly one push,
   dedup marker written, no further sends on later ticks. Session closes with 0 ads → watcher
   stops cleanly, nothing sent. `firstAdPushEnabled: false` → watcher never checks or sends
   at all, even with ads already present at the very first check.
5. **Two real-data incidents, both caught by the tests' own assertions and fully reverted —
   worth keeping as a cautionary note on mock scoping in a shared dev DB**:
   - An ES-count mock scoped only by *network name* (not by the actual query content)
     intercepted a concurrently-active real search ("Coca-Cola") during a fast-scan test run,
     writing a real, bogus `adFoundPushed` entry for a real user. Caught immediately by
     `scanned` being `2` instead of the expected `1`; reverted by pulling the specific bogus
     array entry; fix was scoping every mock (ES, SQL, Firebase) to match on the actual
     synthetic test value/userId/token, never just the network/table name.
   - A test of the config-gate wiring drove a real claim through the actual
     `POST /keyword-search/work` endpoint, which draws from the real, shared, populated claim
     pool — it claimed two real production terms ("Dell", "lenovo") under fake scraper
     owner names, leaving them stuck in `status: 'scrapping'` (no real scraper would ever
     report back to close a session it didn't open). Caught by the test's own failing
     assertions ("claimed the right term" — it hadn't); reverted both docs to their exact
     prior `scrapping_status`/`networkState` state; the test itself was deleted and replaced
     with one that only ever calls `startFirstAdPushWatcher` directly, addressed purely by
     `_id`, never through the real claim endpoint.
6. **Confirmed independence from the 20-ad bell, after §3.4's removal**: grep-verified no
   shared config flag or control-flow branch remains between the two features — see §3.4 for
   the specifics.

---

## 6. Known gaps

- **Restart-loss trade-off, explicitly accepted (§3.1, §3.4)**: an in-flight watcher for a
  term mid-scrape is lost if this process restarts, and — since the old scan/poll's
  incidental catch-all was removed along with its push logic — nothing else picks up the
  slack. A term whose watcher was lost this way gets no first-ad push for that scrape.
- **Production-scale concurrent-watcher count is unverified.** Each watcher is cheap
  individually (one indexed Mongo lookup + a gated ES count, at most every 3s then every 5
  min), but there's no explicit cap on how many can exist at once — bounded only by how many
  terms are actually mid-scrape in real traffic, which hasn't been measured. Recommended
  before a full production rollout: a canary (single network or low-traffic period) with
  memory and the `first-ad push watcher tick failed` log line watched for a day.
- **Local frontend Firebase config is still missing.** `new-ui-react/.env` has none of the
  `VITE_FIREBASE_*` keys or `VITE_FIREBASE_VAPID_KEY`, so a browser running the local dev
  server cannot register its own FCM token yet. The backend send path is fully verified
  regardless — this only blocks getting a *new* token from a local browser.
- Same overlap note as the other two manifests in this folder: `TODAYS_SEARCHES_INDICATOR_MANIFEST.md`'s
  "Today's Searches" button and this doc's crawl-status messaging both touch the post-search
  UX — still worth reconciling into one coherent feature rather than three separate ones,
  if/when the "Today's Searches" piece gets built.
- **Not yet applied**: `requireInteraction: true` and per-action button icons, found while
  reading the unrelated `power-ad-spy-tool/web` system (§4) — offered, not yet actioned.
