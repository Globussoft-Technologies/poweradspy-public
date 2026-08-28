# Search-time crawl-status popups + first-ad push — Design Manifest

> Companion to `TODAYS_SEARCHES_INDICATOR_MANIFEST.md` and `KEYWORD_AD_NOTIFICATION_MANIFEST.md`.
> Documents the requested behavior at the moment a user submits a keyword/advertiser/domain
> search: which message they see depending on whether cached ads exist, and when a push
> notification fires as new ads are found.
>
> **Status: IMPLEMENTED AND VERIFIED.** Parts A/B (frontend banner) and Part C (first-ad
> push) are both live in the codebase. Part C has been tested end-to-end against real dev
> Mongo/SQL/ES, and — as of this session — against **real Firebase credentials**, including
> an actual push delivered to a real device. See §5 for what was found during that testing
> and §6 for the current known gaps.

---

## 1. Requirement (as given)

When a user searches a keyword / advertiser / domain:

1. **No ads currently indexed** → tell them we're crawling now, ads should be ready in
   **15–20 minutes**.
2. **Old/cached ads already exist** → tell them the crawler is still running in the
   background to fetch anything new, and they'll be notified.
3. **The moment at least one new ad is inserted** (same day) → send a **push notification**
   to that specific user.

---

## 2. Part A/B — as actually implemented (App.jsx)

Both messages ended up going through a few iterations during the session (toast → a
dedicated modal popup with an OK button → back to toast) before landing on the final shape
below. Both live in the same place: [App.jsx](../../new-ui-react/src/App.jsx), inside
`saveKeywordSearch(...).then(...)`, right after the `adsFound` check:

```js
}).then((res) => {
  if (res?.data?.status === 'skip') return;
  // Update the SAME top "search underway" banner (source: 'search', fired at
  // submit time in handleSearch) in place, rather than spawning a second toast.
  // durationMs: null — stays up until the user clears the keyword (handleSearch
  // dismisses source:'search' toasts on an empty query) or starts a new search.
  if (!adsFound) {
    showToast(
      "No ads yet for this — we're crawling now. Usually ready in 15–20 min; " +
      "we'll notify you the moment new ads come in.",
      'notice',
      null,
      'top',
      'search',
    );
  } else {
    showToast(
      "Showing what we have — our crawler is still checking for new ads. " +
      "We'll notify you if anything new shows up.",
      'notice',
      null,
      'top',
      'search',
    );
  }
}).catch(() => {});
```

Differences from the original design in this doc's earlier draft:

- **`type: 'notice'`, not `'success'`** — a new toast type added specifically for this
  (static `Info` icon, no spinner), distinct from `'info'` (which keeps the spinner, used
  only for the genuinely-in-progress submit-time banner) and `'success'`/`'error'`.
- **`durationMs: null`** (persists) instead of a fixed 5–6s — the message stays up until
  the user clears the search box or starts a new one, rather than auto-hiding.
- **`position: 'top'`, `source: 'search'`** instead of a separate bottom toast — this
  updates the *same* banner already shown at submit time ("Your keyword search is
  underway...", fired in `handleSearch`) rather than stacking a second one.
- **Clearing the query now dismisses the banner** — `handleSearch` (same file) added:
  ```js
  if (!trimmedQuery) {
    hideToastAfter("search", 0);
  }
  ```
  covers both the "×" clear button and backspacing to empty, since both route through
  `onSearch("", ...)`.

A dedicated modal (`crawlNoticePopup` state + an OK-button dialog) was built and then
explicitly reverted back to this toast approach per direct feedback mid-session — mentioned
here only so a future reader doesn't go looking for it.

---

## 3. Part C — first-ad push, as implemented

Matches the original design closely (§4 of the earlier draft) — reusing the existing 15-min
cron/poll rather than a new one, independent of the 20-ad bell threshold. Implemented in
[keywordAdNotificationController.js](../src/services/common/controllers/keywordAdNotificationController.js):

- `isAdFoundPushedToday(doc, user, net, today)` — dedup check against the source doc's
  `adFoundPushed[]` array (sibling to the existing `notifyDismissed[]`).
- `sendFirstAdPushSafe(source, doc, user, net, today)` — looks up the user's FCM token from
  `am_user_action.fcm_token` (SQL), sends via `firebaseService.sendNotification(...)`, marks
  the dedup array on success only (a failed send — no token, dead token, FCM error — retries
  next tick since nothing gets marked).
- Wired into both `runKeywordAdNotificationScan()` (15-min cron) and
  `runUserKeywordAdScan()` (bell's per-user poll), right after `adsCount` is computed and
  *before* the existing `if (adsCount < threshold) continue;` line — so it fires
  independently of, and earlier than, the 20-ad bell notification.
- Config: `config.keywordSearch.notify.firstAdPushEnabled` (default `true`), now also
  explicitly present in `config.json` (not just the code default), with its own
  `_firstAdPushEnabled_description`.

---

## 4. Notification branding (icon)

The push payload and both service workers already referenced a themed icon path
(`/assets/imgs/icon-192x192.webp`) — [FirebaseService.js](../src/services/FirebaseService.js)
(send side), [usePushNotifications.js](../../new-ui-react/src/hooks/usePushNotifications.js)
and [firebase-messaging-sw.js](../../new-ui-react/public/firebase-messaging-sw.js) (display
side) all point at the same file. The file itself didn't exist in the repo until this
session — `public/assets/imgs/` was created and populated with the current PowerAdSpy logo
(`src/assets/poweradspy-logo.webp` — the up-to-date one; `poweradspy-logo.png` in the same
folder turned out to be a stale asset with an old tagline and was **not** used). Kept as
`.webp` (not converted to `.png`) per explicit direction — a WebP file mislabeled with a
`.png` extension would risk the browser failing to decode it, since static file servers
typically set `Content-Type` from the extension, not the actual bytes.

`public/service-worker.js` also references this same icon path but is **dead code** — grepped
the whole frontend for any `navigator.serviceWorker.register(...)` call targeting it and found
none; the only registered service worker is `firebase-messaging-sw.js`. Updated its icon
references too for consistency, but it isn't part of the live push pipeline.

---

## 5. What testing found (worth keeping)

1. **A real bug, caught by testing, not by review**: the first version of `sendFirstAdPushSafe`
   worked in isolation but failed on a second scan run — `adFoundPushed` was being silently
   stripped by both scan functions' Mongo `find()` projections (explicit inclusion lists that
   didn't name the new field), so the dedup check always read `undefined` and re-sent every
   tick. Fixed by adding `adFoundPushed: 1` to both projections. Caught by an end-to-end test
   against real dev Mongo (insert → run scan twice → assert exactly one send), not by
   inspection.
2. **Verified independence from the bell**: tested with `adsCount = 25` (over the 20-ad
   threshold) — confirms the first-ad push fires *and* the bell's `keyword_ad_notifications`
   doc still gets created correctly; neither interferes with the other.
3. **Real credentials, real send**: `pas_node_api/firebase-credentials.json` was added this
   session (service account for `poweradspy-firebase-prod-dea66`). Verified live — a real
   OAuth2 token exchange with Google succeeded, and a real push was sent via
   `firebaseService.sendNotification()` to a real registered token in dev's `am_user_action`
   table, confirmed received on a real device.

---

## 6. Known gaps

- **Local frontend Firebase config is still missing.** `new-ui-react/.env` has none of the
  `VITE_FIREBASE_*` keys or `VITE_FIREBASE_VAPID_KEY`, so a browser running the local dev
  server cannot register its own FCM token yet (`isFirebaseConfigured` is `false`,
  `usePushNotifications.js` bails out before ever prompting for permission). The backend send
  path is fully verified regardless — this only blocks getting a *new* token from a local
  browser. 77 of 259 rows in dev's `am_user_action` already have a real token from some other
  environment, so backend-side testing has not been blocked by this.
- Same overlap note as the other two manifests in this folder: `TODAYS_SEARCHES_INDICATOR_MANIFEST.md`'s
  "Today's Searches" button and this doc's crawl-status messaging both touch the post-search
  UX — still worth reconciling into one coherent feature rather than three separate ones,
  if/when the "Today's Searches" piece gets built.
- `"Yem"` truncation and a handful of other data-quality items are LinkedIn-country-specific,
  tracked separately (not in this doc).
