# AI Recreate + MySpace (image generation) — Implementation Manifest

> **Status as of 2026-10-09: backend AND frontend both built.** Backend is
> LIVE-TESTED end-to-end against real infrastructure (real Mongo, a real source ad
> resolved from a real ES index, and the real external Ad Studio API — a live
> image was actually generated during testing). Frontend (`new-ui-react`) compiles
> cleanly (`npm run build` passes) and is wired into every real screen from the
> reference mockup, but has **not** been visually exercised in a running browser —
> no browser was available in this environment. See §9 for exactly what that does
> and doesn't cover.
>
> **Update 2026-10-13: credits are now real, per-plan, and aMember-driven.** The
> `defaultCredits` placeholder is gone. Allowance per plan, refresh interval, trial
> handling and top-up packs all live in `config.json` → `imageGen.credits` /
> `imageGen.topup`. **§14 is the single reference for every credit/top-up knob and
> the aMember setup** — the older sections below describe the original build and are
> kept for history; where they disagree with §14, §14 wins.

## 0. What this is

A customer clicks **Recreate** on an existing ad in the Ads Library, picks an
aspect ratio, and the backend generates a new AI image from that ad's creative via
the external **Ad Studio** API, consuming **credits** from a per-user balance.
Generated images are listed later in a **MySpace** gallery, with a **Profile ›
Credits** balance page. Reference mockup:
`PowerAdSpy — AI Recreate & MySpace.html` (15 named screens/states — Ads Library
entry point, Credits dropdown, Aspect-ratio dropdown, Recreate
Empty/Filled/Generating/Done/Failed/No-credits, Notifications dropdown, MySpace
grid + detail drawer + empty state + date-range picker, Profile › Credits).

Ad Studio's real contract: `AD_STUDIO_API_CONTRACT.md` — base
`https://ace-adsgpt.poweradspy.ai`, no auth header (server-to-server trust,
confirmed by product). `POST /api/v1/images/` returns a `job_id` (202 Accepted);
`GET /api/v1/jobs/{job_id}` polls to `succeeded`/`failed`/`cancelled`.

## 1. Explicit constraints this round (do not relitigate)

- **Config-driven, nothing hardcoded** — every tunable lives in `config.json`'s
  `imageGen` section, read through `src/config/index.js` (CONFIG_RULES.md's rule:
  only that module reads config.json directly).
- **Self-contained folder**, `src/services/imageGen/`, mirrors the `chatgptads`
  shape exactly (built earlier this cycle) — no existing service touched.
- **No Plan Control / capability gating yet** — product will decide later.
  `authMiddleware` (the same customer JWT middleware every other customer route
  uses) is the only gate today.
- ~~Credit top-up / aMember-plan linking is explicitly future work.~~ **Done
  2026-10-13 — see §14.** (Originally `defaultCredits` was a flat placeholder
  grant; it has been removed.)
- **No Redis.** `node-cache` (in-process, TTL) throttles the upstream job-status
  poll — not a queue, not shared across processes. Explicit instruction.
- **MongoDB only** for this feature's own storage (overrides the SQL-based
  Saved/Hidden-Ads precedent found during research — explicit instruction).
- **No NAS mirroring** — Ad Studio's own returned image URL is stored directly
  (documented as a permanent link).

## 2. Why there's no local job queue

Ad Studio's generate endpoint is already async (job_id + poll). Our backend's job
is: submit fast → store a Mongo job doc mirroring the upstream job_id → resolve
status **lazily**, triggered by the client's own poll, with a `node-cache` TTL
(`imageGen.adStudio.pollCacheTtlMs`, default 3s) in front of the upstream call so
rapid re-polls from one tab don't hammer Ad Studio. A light safety-net cron
(`imageGenStuckJobSweep`) catches a job whose tab closed mid-generation. This is
lighter and has fewer failure points than a local queue would.

## 3. Files

```
src/services/imageGen/
  config.js                       → re-exports config.imageGen (real reader lives in src/config/index.js)
  repository.js                   → all Mongo reads/writes (imagegen_jobs/credits/credit_ledger) + index setup
  validate.js                     → POST /recreate request validation
  helpers/adStudioClient.js       → generateImage() / getJob() — the 2 real Ad Studio calls
  helpers/adResolver.js           → {network, ad_id} -> real creative URL, server-side only (never trusts client URLs)
  helpers/statusCache.js          → node-cache wrapper, TTL = imageGen.adStudio.pollCacheTtlMs
  helpers/creditsLedger.js        → reserve/finalizeDebit/refund, each paired with a ledger entry (syncs credits with aMember before reserving)
  helpers/creditPlan.js           → (§14) aMember access/invoices → active plan, trial/recurring state, allowance, refresh/end dates; applies cycles
  helpers/topups.js               → (§14) top-up pack pricing + crediting paid aMember top-ups exactly once
  helpers/responses.js            → {code,status,message,data} envelope helpers (self-contained, not importing insertion's)
  controllers/recreateController.js
  controllers/jobsController.js   → getJobStatus (poll) + listMySpace; exports refreshFromUpstream (shared with the cron)
  controllers/creditsController.js        → GET /credits, POST /credits/sync (§14)
  controllers/creditsHistoryController.js → GET /credits/history[.csv] (Profile › Credits table)
  routes/imageGenRoutes.js        → auto-mounted by ServiceRegistry at /api/v1/imageGen (no extra registration)
  jobs/imageGenStuckJobSweep.js   → safety-net cron, registered in src/jobs/cronManager.js REGISTRY
docs/imageGen/MANIFEST.md         → this file
```

Config added: `config.json`'s top-level `imageGen` section +
`src/config/index.js`'s `imageGen` block (same pattern as `intelligence`/
`keywordExplorer`) + `src/config/networks.js`'s `imageGen` entry (Mongo-only,
`sql.enabled:false`, `elastic.enabled:false` — added purely to reuse
`DatabaseManager`/`ServiceRegistry`'s existing connection-bootstrap mechanism, the
same one `chatgptads` uses — `imageGen` is **not** an ad network).

## 4. Mongo schema (`pas_dev`/`pas_competitors` shared dev DB — see §6)

- **`imagegen_jobs`** — one doc per Recreate request. `user_id`,
  `source{network, ad_id, image_url}` (the RESOLVED absolute URL, not the raw NAS
  relative path), `request{prompt, aspect_ratio, model, resolution, watermark}`,
  `upstream{job_id, status, submitted_at, last_polled_at}`, `status` (our mirrored
  status: queued/running/succeeded/failed/cancelled), `result` (Ad Studio's raw
  `images[]`/`model`/`time_taken_s`, null until done), `error{error_code, message,
  user_message}`, `credit{cost, reserved_at, finalized_at, refunded}`,
  `created_at`, `updated_at`.
  Indexes: `{user_id:1, created_at:-1}` (MySpace pagination), `{status:1,
  updated_at:1}` (stuck-job sweep), `{'upstream.job_id':1}` (unique, sparse).
- **`imagegen_credits`** — `{_id: user_id, cycle_balance, topup_balance, balance,
  cycle_key, cycle_meta, created_at, updated_at}` (two buckets since 2026-10-13 —
  see §14.4). Reservation is atomic per bucket:
  `findOneAndUpdate({_id, cycle_balance:{$gte:cost}}, {$inc:{cycle_balance:-cost, balance:-cost}})`,
  then the same on `topup_balance` if plan credits are exhausted.
- **`imagegen_credit_ledger`** — append-only: `{user_id, delta, reason:
  'reserve'|'finalize_debit'|'refund'|'allocation'|'topup', ref_job_id, meta,
  balance_after, created_at}`.
- **`imagegen_topup_grants`** — one doc per credited aMember top-up purchase,
  `_id: "access:<aMember access_id>"` (unique — this is what makes crediting
  exactly-once). See §14.6.

## 5. Request flow (as actually tested, see §7)

1. `POST /recreate` `{network, ad_id, aspect_ratio, prompt?, watermark?}` →
   validate → resolve the ad's real creative URL server-side (`adResolver.js`,
   covers facebook/instagram/chatgptads/reddit today, see §8) → atomically reserve credit
   (insufficient → `402 no_credits`, screen 3f) → call Ad Studio → store the job
   doc → `202 {job_id, status:'queued'|'running', balance}` (screen 3c fires
   immediately).
2. `GET /jobs/:id` → terminal in Mongo already → return as-is. Otherwise: cache
   hit → use cached upstream result; cache miss → call Ad Studio's `GET
   /jobs/{id}`, cache it, apply the transition (succeeded → store result +
   finalize-debit ledger line; failed/cancelled → refund + store error), persist,
   return. A transient upstream check failure returns the last known LOCAL state
   rather than erroring the poll.
3. `GET /jobs` → MySpace list, paginated (`limit`/`cursor`), filterable by
   `status`/`from`/`to` (date range — screen 5's custom range picker).
4. `GET /credits` → syncs with aMember (cached), then returns balance, plan
   allowance, next refresh / end date, top-up packs and recent ledger (screens 2
   and 8). `POST /credits/sync` does the same bypassing the cache. See §14.
5. `imageGenStuckJobSweep` cron (`config.json` `crons.jobs.imageGenStuckJobSweep`,
   default every 5 min) — finds `status in (queued,running)` older than
   `stuckJobTimeoutMinutes` (default 15), runs the SAME `refreshFromUpstream()` the
   poll endpoint uses (shared function, no duplicated transition logic).

## 6. A real pre-existing bug found and fixed along the way

`cronManager.js`'s `initConfigCrons()` only ever reads `config.crons.jobs.*`, but
**`admobEsOutbox`** (pre-existing) and **`chatgptadsEsOutbox`** (added in the prior
work cycle) were both sitting as **top-level `config.json` keys**, not nested
under `crons.jobs` — meaning neither cron was ever actually scheduled at real
server startup, despite both looking fully configured. Confirmed via a live dry
run of `initConfigCrons()` before and after: both now show `✓ cron "..."
scheduled` where before they weren't in the loop at all. Fixed by moving both into
`crons.jobs` alongside the new `imageGenStuckJobSweep` entry — no REGISTRY changes
needed, those were already correct.

## 7. What was actually live-tested (not just unit-level)

- Real Ad Studio call end to end: submitted a real prompt, polled to `succeeded`
  in ~14-16s, got back a real generated image URL.
- Full controller chain: `recreate` → poll `getJobStatus` to `succeeded` →
  `getCredits` (balance correctly debited exactly once, ledger has both lines) →
  `listMySpace` (job appears, full result embedded).
- `adResolver`'s relative-NAS-path bug: the raw ES field value is a relative
  `/pas-dev/stream/...` path — Ad Studio can't fetch that. Found live (first
  attempt returned an Ad Studio error because the "image" wasn't reachable — caught
  before that even happened, by inspecting the resolver's own output first).
  Fixed by piping every resolver's result through `resolveMediaUrl()`
  (`src/insertion/helpers/nasClient.js`, the same helper every other network
  already uses for this) in `resolveAdCreative()`'s shared wrapper.
- Insufficient-credit path: balance forced to 0, confirmed `402`, confirmed
  balance stays exactly 0 (no partial debit).
- Unsupported network: confirmed a clear 422, not a crash.
- Stuck-job sweep: manually backdated a `queued` doc with a fake upstream job_id,
  ran the cron function directly, confirmed it picks up the row and calls
  `refreshFromUpstream` without crashing on the (expected) not-found upstream
  response.
- All test data (Mongo docs, the SQL/ES/NAS source test ad in `chatgptads`)
  cleaned up afterward — 0 residual rows in every `imagegen_*` collection.
- `ServiceRegistry` auto-mount confirmed the same way as `chatgptads`: direct
  `require()` + router-build smoke test, all 4 routes present
  (`/recreate`, `/jobs/:id`, `/jobs`, `/credits`).

## 8. Open items for whoever continues this

1. **`adResolver.js` covers every network** (2026-10-13). Dedicated resolvers:
   facebook, instagram, chatgptads, reddit. All others (google incl. Transparency,
   gdn, pinterest, linkedin, youtube, quora, tiktok, native, admob) go through
   `resolveGeneric`: it calls that network's own single-ad lookup
   (`<network>/controllers/getAdsByAdvertiserController` — the one "View original
   ad" uses) and picks the creative with the ad card's field order
   (`video_cover → image_video_url → image_url_original → image_url`, skipping
   `DefaultImage` and video files). A dedicated resolver that finds no image falls
   back to the generic path too (older FB/IG ads without a NAS copy in ES).
   Verified on dev data: google, gdn, pinterest, linkedin, youtube, quora, native,
   admob, reddit, facebook, instagram. **tiktok not verifiable locally** (its ES
   isn't reachable from dev) — check on staging.
2. **Frontend IS now built** (see §9) but never visually exercised in a running
   browser — no browser was available in this environment. Open the app and
   click through the real flow before considering this screen set done.
3. ~~`defaultCredits` is a flat placeholder~~ — **resolved 2026-10-13**, real
   per-plan allocation + aMember top-ups, see §14. Remaining open items for that
   piece are listed in §14.10.
4. **Plan Control / capability gating** — not wired. Every authenticated user can
   call this today, gated only by credits.
5. **Ad Studio's `recommend-templates` endpoint (brand template recommendations)
   is not used.** No screen in the reference mockup maps to it this round;
   available if a future onboarding/template feature needs it.
6. **`resolution` field** (Ad Studio supports `1K`/`2K`/`4K`) is not yet exposed in
   the request contract or UI — not mentioned in the reference mockup's screens,
   can be added to `validate.js`/`recreateController.js` trivially if needed.

## 9. Frontend (`new-ui-react`) — built this round, NOT visually tested

Matches the reference mockup's real screen set (Ads Library entry, Credits
dropdown, Aspect-ratio picker, Recreate Empty/Filled/Generating/Done/Failed/
No-credits, MySpace grid/detail-drawer/empty-state/date-range, Profile ›
Credits). `npm run build` passes cleanly — no syntax/import errors — but nothing
was clicked through in an actual browser; this environment had none available.

**New files:**
- `src/hooks/useImageGenJobPoll.js` — polls a job every 2.5s, stops on a
  terminal status. Adapted from `useSDUIPolling.js`'s ref-based idiom (that hook
  polls forever; this one has a natural stop condition, closer to the backend's
  own poll-until-terminal design).
- `src/components/modals/RecreateModal.jsx` — the full 3a→3f state machine in
  one component, mirroring `CampaignModal.jsx`'s parent-owns-state shape.
- `src/components/myspace/MySpacePage.jsx` + `GeneratedImageDetailDrawer.jsx` —
  deliberately a LIGHTER build than `SavedAdsPage.jsx`, not a copy of it: MySpace
  has no platform tabs, no SDUI filtering, no favourite/hide semantics — none of
  that applies to a list of your own generated images. Reuses `Masonry.jsx` (the
  generic grid primitive) with a new, simple `GeneratedImageCard`, not
  `MasonryCard.jsx` (which is ad-specific).
- `src/components/layout/CreditsDropdown.jsx` + `src/components/credits/CreditsPage.jsx`
  — balance + ledger, mirrors `NotificationPopup.jsx`'s popup shape for the
  dropdown; the full page is new (no existing "Profile" page to extend — grepped
  `App.jsx`, zero hits).

**Edited (all shared, heavily-used files — see verification note below):**
- `src/services/api.js` — `recreateImage`/`getImageGenJob`/`listMySpace`/
  `getImageGenCredits`, exact fetch/`checkFor401`/Bearer-token shape as every
  other call in the file.
- `src/store/uiSlice.js` — `showMySpacePage`/`showCreditsPage` state +
  setters, copied from `showSavedAdsPage`'s exact shape.
- `src/App.jsx` — both pathname-sync effects extended with `/my-space` and
  `/profile/credits`; two new ternary branches render `<MySpacePage/>`/
  `<CreditsPage/>`; `<RecreateModal/>` rendered once with `recreateModalAd`
  state; `handleToggleMySpacePage`/`handleShowCreditsPage` added alongside the
  existing `handleToggleSavedAdsPage`.
- **Found a real routing fact while wiring this, not a bug**: the main Ads
  Library grid does NOT render `AdCard.jsx` — it renders `MasonryCard.jsx`
  (a separate, standalone card implementation). `AdCard.jsx` is only used on
  the public Guest preview page (`GuestPage.jsx`). The "Recreate" menu item was
  added to `AdCard.jsx` first (harmless — guests hit the auth check if they
  somehow trigger it) but the one that actually matters is in
  `MasonryCard.jsx`'s existing hide/unhide portal menu, which is what
  `AdGrid.jsx` and `SavedAdsPage.jsx` both really render. `onRecreate` threads
  through `AdGrid.jsx` → `MasonryCard.jsx` and `SavedAdsPage.jsx` →
  `MasonryCard.jsx` from the same `App.jsx` state.
- `src/components/layout/Header.jsx` — credits indicator button + dropdown,
  exact click-toggle + outside-click-`useEffect` pattern as the notification
  bell (`notifOpen`/`notifRef` → `creditsOpen`/`creditsRef`).
- `src/components/layout/Sidebar.jsx` (desktop nav) + `BottomNav.jsx` (mobile) —
  MySpace entry. On `BottomNav.jsx` specifically, it went into the existing
  "More" overflow panel (where Market Trends/Keywords Explorer/Chat already
  live) rather than the main tab row, which is already tight on mobile
  (Library/Projects/Saved/Filters/More).

**Before considering this done:**
1. Run the dev server, log in, and click through the real flow end to end — the
   backend is live, so a real Recreate click should produce a real result.
2. Specifically check: the Recreate menu item appears and works from BOTH the
   main Ads Library grid and the Saved/Hidden page; the credits indicator
   updates after a generation; MySpace's date-range filter actually filters;
   the detail drawer opens/closes correctly; the no-credits (3f) and failed
   (3e) states are reachable (force them by draining a test account's balance /
   killing network mid-request) and look right, not just "don't crash."
3. `BottomNav.jsx`'s "More" panel and `Sidebar.jsx` were both edited — confirm
   Market Trends, Keywords Explorer, and Chat still open correctly (shared
   files, easy to regress silently).

## 10. Second frontend round — hover icon, routing-bug fix, global credits
    context, MySpace delete, credits/notifications redesign

Continuation of §9, driven by a pasted Hinglish/English UX spec plus two
reference screenshots (credits popover, notifications dropdown) to match
exactly. User explicitly confirmed: keep calling the real `/api/v1/imageGen/*`
endpoints — the spec's own endpoint names (`/api/ai/recreate` etc.) were
generic placeholders, not a request to change the backend.

**Backend:**
- `DELETE /api/v1/imageGen/jobs/:id` (`jobsController.deleteMySpaceJob` +
  `repository.deleteJob`, scoped to `user_id`) — removes a MySpace row. Gallery
  removal only: does NOT refund the credit (generation already happened and was
  paid for) and does not touch NAS (Ad Studio's own URL is never mirrored).
- *(Superseded 2026-10-13 — `monthlyQuota`/`planLabel` were removed; the same
  response fields are now computed from the user's real aMember plan, see §14.)*
  `creditsController.js` / `config/index.js` — two new **optional, off-by-default**
  config knobs: `imageGen.monthlyQuota` (null) and `imageGen.planLabel` (null).
  When unset (the default — real per-plan allocation is still deferred, see §8.3),
  `getCredits` returns `monthly_quota`/`used_this_cycle`/`cycle_resets_at`/
  `plan_label` all as `null` and the frontend hides the quota progress bar/
  refresh-date card entirely rather than showing fabricated numbers. When an
  admin does set a quota, `cycle_resets_at` is approximated as the 1st of next
  month (UTC) — there's no real billing-cycle anchor yet, this is a placeholder
  shape for when one exists.

**Frontend — routing bug fix:** `handleNavPageChange` and 6 other call sites in
`App.jsx` only ever cleared `showSavedAdsPage`, never the newer `showMySpacePage`/
`showCreditsPage` flags, so leaving MySpace via most nav actions left
`showMySpacePage` stuck `true` — the state→URL sync effect then force-navigated
back to `/my-space` even after other code called `navigate('/')`. Fixed with one
shared `exitSpecialPages()` helper (clears all three flags) used everywhere a
special page is exited, plus `showMySpacePage`/`showCreditsPage` added to the
redux-persist blacklist in `store.js` (they're already restored correctly from
the URL on load — persisting them too was the direct enabler of the bug).

**Frontend — global credits context:** `src/hooks/useImageGenCredits.jsx`
(new) — a `ImageGenCreditsContext`/Provider mounted in `main.jsx` inside
`AuthProvider`, outside `ThemeProvider`. One shared balance read/written by the
header indicator, every ad card's Recreate button, and `RecreateModal`'s
optimistic decrement/restore — a successful Recreate updates the header
immediately, not just the next time the dropdown happens to be opened.

**Frontend — Recreate entry points:**
- `MasonryCard.jsx` (the card the Ads Library grid ACTUALLY renders, confirmed
  in §9 — not `AdCard.jsx`) — a hover-visible Sparkles icon button in the
  existing hover action strip (between Save and Download), disabled + "No
  credits left" tooltip at balance 0. The earlier round's redundant kebab-menu
  "Recreate" item was removed to avoid duplicate UI.
- `AdDetailModal.jsx` — a primary "Recreate" button next to "Analytics",
  same disabled-at-zero treatment.
- `AdGrid.jsx`/`SavedAdsPage.jsx` — `onRecreate` threaded through to both their
  `MasonryCard`/`AdDetailModal` render calls.

**Frontend — MySpace (`MySpacePage.jsx`, full rewrite):**
- Skeleton-card masonry grid while loading (replaces the old plain `Loader2`
  spinner), same shimmer treatment as `SavedAdsPage.jsx`'s own skeleton.
- Delete button on each card (hover strip) and via the detail drawer, wired to
  `deleteImageGenJob()` — optimistic local removal, restores the list on
  failure.
- "Original ad" link (`ExternalLink` icon) built from `item.source.network`/
  `ad_id` via the same `${VITE_SHARE_URL}/<network>/landing/ad_id/<id>` deep
  link shape used elsewhere, shown only when both fields are present.
- Download action added directly on the card (previously only in the drawer).

**Frontend — credits popover + header pill, redesigned to match a reference
screenshot exactly (`CreditsDropdown.jsx`, `Header.jsx`):**
- Header pill: sparkle icon + "`{balance} credits`" + chevron, violet-accented
  (`#7c3aed`, consistent with the AI-search/Recreate accent already used
  elsewhere), replacing the old plain Coins-icon + number.
- Popover: "IMAGE CREDITS" label + optional plan badge, large balance + "credits
  left", "You can create N more images", optional quota progress bar + "X of Y
  used this cycle" + optional refresh-date card (all gated on the optional
  backend fields above — gracefully omitted when unset), "Go to MySpace" +
  "Upgrade plan" buttons (the latter opens the existing `PricingModal` via a new
  `onUpgradeClick` prop threaded `App.jsx` → `Header.jsx` → `CreditsDropdown`).
- Closes on outside click (existing), Esc keydown (new), and route change (new
  `useLocation` effect in `Header.jsx`) — all three were explicit spec asks.

**Frontend — notifications popover redesign (`NotificationPopup.jsx`,
`useNotifications.js`), to match a reference screenshot's layout:**
- Added All/Unread tabs and Today/Yesterday/date-grouped sections.
- **Important limitation, by design, not an oversight**: the backend's
  `fetchNotifications` only ever returns UNREAD search-alert notifications
  (`is_view=0`) — there is no "notification history" endpoint. `useNotifications.js`
  now also accumulates a session-local `allNotifications` list (upsert by id,
  capped at 100, `read` flag flipped by `markRead`/`markAllRead`) so the All tab
  is genuinely different from Unread instead of being a fake/non-functional
  toggle — but it only ever contains what this browser tab has actually seen
  this session, not real server-side history.
- The reference screenshot's AI-Recreate-specific notification rows ("Your
  recreated ad is ready", "Generation failed — credit refunded") were
  **deliberately not added** — there is no backend event/persistence for
  job-completion notifications yet (this popover is still wired to the
  pre-existing keyword/advertiser/domain search-alert feed only). Wiring real
  Recreate-completion notifications would need a new notification type +
  persistence on the `imageGen` job-transition path (`jobsController.js`'s
  `refreshFromUpstream` and the stuck-job sweep) — not started, flagged here for
  whoever picks this up next.

`npm run build` passes cleanly after all of the above (same caveat as §9: not
visually exercised in a real browser in this environment).

## 11. Third frontend round — RecreateModal rebuilt to match the reference
    mockup's "3a · Recreate — Empty" screen exactly, product-image upload added

The original RecreateModal.jsx (aspect-ratio grid + optional prompt only) was a
simplified stand-in. This round rebuilds it to match the reference screen
pixel-for-pixel in layout: a two-column modal (reference ad + advertiser on the
left, upload/form on the right), and wires every piece that's real:

- **New: `POST /api/v1/imageGen/upload`** (`uploadController.js`,
  `routes/imageGenRoutes.js`) — multer disk-storage upload (same pattern as
  `services/common/routes/commonRoutes.js`'s synthetic-keyword CSV upload),
  10MB limit (config-driven: `imageGen.productImageMaxUploadMb` /
  `IMAGEGEN_PRODUCT_IMAGE_MAX_MB`), JPG/PNG/WEBP only. Stores to NAS via the
  SAME `storeInNas()` every crawler pipeline uses (`insertion/helpers/nasClient.js`),
  under a new `PRODUCT` subfolder + `imagegen` NAS key prefix — reused
  infrastructure, not a new upload stack. Returns `{ url }` (via
  `resolveMediaUrl()`), which the frontend feeds into `/recreate`.
- **`recreateController.js` / `validate.js`** — accept optional
  `product_image_url`, `extra_image_urls` (array, max 3), `brand_website`.
  `image_urls` sent to Ad Studio is now `[referenceAdImage, productImage,
  ...extraImages]` — Ad Studio's `generateImage()` already accepted an array
  (`adStudioClient.js`), this just actually uses it for more than one image for
  the first time. `brand_website`, when present, is appended as a line of
  context onto the prompt (no separate Ad Studio field for it exists). All
  three are also persisted on the job's `request` doc for the record.
- **`RecreateModal.jsx`** full rewrite — upload dropzone (drag & drop + click,
  client-side type/size validation before upload, live preview + spinner +
  remove), brand website input, prompt textarea with a real 1000-char counter
  and a real "N/3 images" extra-reference-image attach control (reuses the same
  upload endpoint), 4 quick-prompt chips that append canned text locally (no
  backend), an aspect-ratio dropdown whose "Original" entry is a REAL measured
  value (loads the reference ad's own image, computes its W/H ratio, snaps to
  the nearest supported ratio — not a guess), and a footer that disables
  Generate until the product image has actually finished uploading.
- §10's "Enhance" note is now superseded by §12 below — it's been built for
  real this round, not left out.

`npm run build` passes cleanly. Still not visually exercised in a real browser.

## 12. Fourth frontend round — Prompt box rebuilt to an exact design spec,
    "Enhance" wired to a real Claude call, 3c (Generating) rebuilt

Driven by a literal CSS/structure spec for the Prompt field (exact hex colors,
radii, shadows — see RecreateModal.jsx's inline `<style>` block, classes
prefixed `rcp-` to avoid collisions with the app's large global stylesheet) and
a detailed spec for the 3c "Generating" screen. Explicit instruction this
round: do not touch the Product image / Brand website / Aspect ratio fields
themselves, only the Prompt box, the footer copy, and the 3c layout swap.

**New: a real "Enhance" endpoint** (§10 previously left this out for lack of
an LLM client — now built):
- `POST /api/v1/imageGen/recreate/enhance` (`enhanceController.js` +
  `helpers/promptEnhancer.js`) — calls Anthropic's Messages API directly over
  axios (no new SDK dependency, same raw-HTTP-client pattern as
  `adStudioClient.js`) to rewrite the user's draft prompt into a fuller one.
  Config-gated (`imageGen.promptEnhancer` in `config/index.js`): **inert
  without an API key** — `IMAGEGEN_ENHANCE_API_KEY` env, falling back to
  `ANTHROPIC_API_KEY` if set, otherwise the controller returns a clean 503
  ("not configured") rather than faking a rewrite. A small per-user
  `node-cache` cooldown (3s) guards against a double-click firing two paid
  upstream calls.
- **Not live-tested against the real Anthropic API** — no API key was
  available in this environment. Route wiring, config fallback, and the 503
  "not configured" path were verified; the actual rewrite call itself needs a
  real key to exercise.

**`RecreateModal.jsx` — Prompt box rebuild:**
- Structure now matches the spec exactly: attached-image chips (`.rcp-att`)
  live *inside* the bordered box, above the textarea — present only once at
  least one image is attached — followed by the auto-growing textarea
  (`.rcp-tat`, resizes to its content via a ref + scrollHeight effect) and a
  toolbar row (`.rcp-tab`) with the add-reference circle button, the "N/3
  images" count, the live "N/1000" char counter, and the (now real) Enhance
  button.
- `.rcp-ta` gets a `filled` class (persistent highlighted border, matching
  `:focus-within`'s look) whenever the prompt has text or an image attached —
  not just while the textarea is actually focused.
- The quick-prompt chip row (`.rcp-sugg`) now hides as soon as the prompt
  textarea has text and reappears when it's cleared, rather than always
  showing.
- Enhance calls the new endpoint and replaces the textarea's content with the
  rewritten prompt; shows a spinner while in flight; a 503/429/other error
  surfaces via the existing toast instead of silently doing nothing.
- Footer hint swaps from "Add a product image to continue" to "Saved to
  MySpace automatically" once the product image finishes uploading.

**3c (Generating) rebuild**, also spec-driven:
- Two columns: the same reference-ad card used in 3a/3b (extracted into a
  shared `referenceAdCard`/`advertiserRow` so both states can never drift out
  of sync with each other) on the left; a shimmer-background loading card on
  the right (spin ring, "Generating your ad…", the "usually takes 15–40
  seconds… we'll notify you" copy, and a CSS-animated progress bar that eases
  toward ~92% over 25s — a reassurance affordance, not a real progress
  percentage, since the actual Ad Studio job has no granular progress to
  report).
- A "locked inputs" summary row below it (lock icon + chips: product image
  thumbnail+filename, brand website, prompt text, reference-image count,
  aspect ratio) — each chip only renders when that field actually has a
  value, so nothing fabricated is shown.
- Header subtitle and modal width both now react to the generating state too
  (wider 2-column layout, "Generating your version…" subtitle).
- New dedicated 3c footer: "1 credit in use · refunded automatically if it
  fails", a working **Close** button, and a disabled "Generating…" button.
  Confirmed (by reading `App.jsx`'s render call, not guessed): `RecreateModal`
  is always mounted — `isOpen` only toggles its returned body, it never
  unmounts — so **closing during 3c does NOT cancel the poll**: `jobId` state
  and `useImageGenJobPoll` keep running, and the success/failure toast still
  fires when the job lands. This already held before this round; 3c just
  didn't expose a Close button to use it. One real limitation, not fixed this
  round: opening a *different* ad's Recreate modal before the first job
  finishes resets this component's state (including `jobId`), so that
  earlier job's completion toast is lost (the job itself still finishes
  server-side and the image still lands in MySpace — only the in-app toast is
  lost). Fixing that needs a small global "active jobs" tracker outside this
  modal; out of scope for this round's literal ask.

**Files touched this round:** `pas_node_api/src/config/index.js`,
`pas_node_api/src/services/imageGen/helpers/promptEnhancer.js` (new),
`pas_node_api/src/services/imageGen/controllers/enhanceController.js` (new),
`pas_node_api/src/services/imageGen/routes/imageGenRoutes.js`,
`new-ui-react/src/services/api.js`,
`new-ui-react/src/components/modals/RecreateModal.jsx`. Product
image/Brand website/Aspect ratio sections were left untouched as instructed.

`npm run build` passes cleanly.

## 13. Fifth frontend round — RecreateModal rebuilt to the full `recreate-full-spec.md`
    state machine (near-total rewrite of RecreateModal.jsx, no backend changes)

Driven by a complete design spec covering all 7 views as one state machine
(idle/generating/done/failed, with 3f "no credits" as a derived banner rather
than a dead-end screen). This round touches **only**
`new-ui-react/src/components/modals/RecreateModal.jsx` (plus one line in
`App.jsx` to pass a new `onUpgrade` prop) — no backend files changed.

**State machine changes:**
- **3f (no credits) is no longer a separate screen.** It's now a banner
  (`.rcp-warn`) rendered inside the still-editable form whenever
  `balance <= 0`, with real "X of Y used · refreshes on {date}" numbers
  fetched from `GET /credits` (no new endpoint — reused `getImageGenCredits()`
  with the already-existing `monthly_quota`/`used_this_cycle`/
  `cycle_resets_at` fields from §12's credits-popover work) and an "Upgrade
  plan" button wired to the same `PricingModal` flow `CreditsDropdown.jsx`
  already uses (`dispatch(openModal('isPricingModalOpen'))` — the spec's own
  `/profile/credits` doesn't exist as a route in this app, so this reuses the
  real, working upgrade entry point instead of inventing one).
- **3d (Done) and 3e (Failed) are now full two-column result layouts**
  (previously centered single-column dead-ends): reference ad on the left,
  generated image / error card on the right, a "locked inputs" summary chip
  row below, and state-specific footers (Download + Regenerate + Open in
  MySpace / Cancel + Try again).
- **Failed state now has two distinct actions**, not one: "Try again"
  (`handleTryAgain`, resubmits the same stored inputs — a real new generation,
  spends another credit) vs "Edit inputs" (`handleEditInputs`, returns to the
  form with inputs intact, no resubmission). "Regenerate (1 credit)" on the
  Done screen is the same resubmit path.
- Fixed a real latent bug surfaced by adding retry/regenerate: the
  terminal-status toast was guarded by a ref that, once set, would silently
  suppress the toast for every *subsequent* job in the same modal session.
  Now reset to `false` right before each new `recreateImage()` call.
- `durationSec` ("Generated in N seconds") is computed client-side from the
  job's real `created_at`/`updated_at` timestamps — not a fabricated number,
  and no backend change needed since those fields were already in
  `serializeJob()`'s response.
- Aspect-ratio dropdown rebuilt with the spec's exact per-ratio icon sizes
  (1:1 special-cased to 16×16, every other ratio's longest side 18px),
  per-ratio hint text ("Square · Feed", "Stories · Reels", etc. — any
  backend-configured ratio not in the spec's hint table, e.g. 5:4/21:9, still
  renders, just without a hint, so a real supported ratio is never hidden),
  a divider after "Original", and real keyboard support (↑/↓ moves focus,
  Enter selects, Escape closes, `role="listbox"`/`"option"`/`aria-selected`).

**Root cause found for the typography bugs this spec was partly reacting to**:
`index.css` has a deliberate, documented, light-mode-only rule —
`body { font-weight: 600; }` (its own comment: "User-spec: light mode reads
heavier... elements with explicit font-{bold,medium,light,normal} keep their
override.") Since `font-weight` inherits, every element in this modal that
didn't explicitly set its own weight was quietly inheriting 600 instead of
the intended 400. Fixed by scoping `font-weight: 400` + `.rcp-m *
{ font-weight: inherit }` on the modal root (`.rcp-m`), which re-anchors
inheritance to 400 for everything inside the modal without touching the
app-wide light-mode rule itself (that rule is intentional elsewhere, not a
bug — it's just wrong for this modal's own exact-weight spec).

**Not built (same honest-gap posture as earlier rounds):**
- "Open in MySpace" navigates to MySpace generally — the spec's
  `?image=<id>` deep-link to pre-select that specific generated image isn't
  built; `MySpacePage.jsx` doesn't read a selection query param yet.
- SSE/WebSocket polling — spec explicitly allowed polling as an alternative
  ("poll every 2s, or SSE/WebSocket"); the existing 2.5s poll
  (`useImageGenJobPoll.js`) already satisfies this, left as-is.
- Real upstream `progress` percentage — Ad Studio's job-status response has
  no granular progress field; the progress bar stays the same honest
  time-based CSS approximation from §12, not a fabricated number.

`npm run build` passes cleanly. Not visually exercised in a real browser (same
caveat as every prior round — no browser available in this environment).

## 14. Credits & top-ups — per-plan, aMember-driven (2026-10-13)

**This section is the reference for every credit/top-up setting.** Everything
below is controlled from `config.json` → `imageGen.credits` and
`imageGen.topup`; no plan ID, credit amount, price or interval is hardcoded.
A backend restart is needed after editing `config.json`.

### 14.1 Where the code lives

| File | Job |
|---|---|
| `helpers/creditPlan.js` | Reads the user's aMember access + invoices, decides active plan / trial / recurring / term end, computes allowance + refresh date, starts a new cycle when due |
| `helpers/topups.js` | Prices packs from config, credits paid aMember top-ups exactly once |
| `helpers/creditsLedger.js` | Reserve (syncs first) / refund — plan credits spent before top-ups |
| `controllers/creditsController.js` | `GET /credits`, `POST /credits/sync` |
| `repository.js` | `applyCycle`, `reserveCredit`, `refundCredit`, `grantTopup`, `setCycleMeta` |
| `src/auth/amemberAuth.js` | `fetchAmemberSubscription()` (read-only) + login fix that ignores top-up products (§14.6) |
| Frontend | `profile/tabs/CreditsTab.jsx`, `profile/BuyTopUpModal.jsx`, `layout/CreditsDropdown.jsx` |

aMember is **read-only** from this app — nothing is ever written to aMember.

### 14.2 `imageGen.credits` — config reference

**Pricing decision (2026-10-13, product):** 10% of what the user pays goes to
image generation, at **$0.132 per credit** (1 credit = 1 image). Same rule for 2026
and legacy plans. Source PM doc: "PowerAdSpy — Image Generation Credits by Plan"
(its $0.07 cost assumption was replaced by $0.132).

#### How a user's plan credits are calculated

```
credits = price × formula.budgetPercent% ÷ formula.costPerCreditUsd   → rounded to formula.roundTo
```

| Situation | Price used | Given |
|---|---|---|
| Monthly plan (2026 or legacy) | What the user actually pays per month — read from their aMember invoice (`second_total`, or `first_total` for a one-off) | Every `refreshEvery` (monthly) |
| Yearly plan | The **undiscounted** yearly list price (fairer than the heavily discounted yearly charge): 2026 = `pricing.planPrices` yearly `amount`; legacy = `listPrices` monthly × 12 | Whole year **upfront**, refreshed once a year on the purchase anniversary (`yearly.upfront: true`) |
| Trial ($1 Basic / $7 others) | The trial amount actually charged (`first_total`) | Once for the trial, never below `trial.minCredits` (10) |
| Admin-granted access (no invoice), free/0 invoice, non-USD invoice | `listPrices` (2026 from `pricing.planPrices`) | As above by billing cycle |
| custom / enterprise | Their invoice amount (no list price) — admin grants need an override | — |
| Override set (`byPlanId` / `byFamily`, `trial.byPlanId` / `trial.byFamily`) | Ignored — the fixed number is used | Per refresh period (per year for yearly) |

Full per-plan table with every calculation step (monthly, yearly, trial, legacy
and 2026): **`docs/imageGen/CREDITS_BY_PLAN.md`**. Summary with today's config:

| Plan | Monthly | Yearly (upfront, undiscounted) |
|---|---|---|
| 2026 Basic ($69 / $828) | 50 | 630 |
| 2026 Standard ($99 / $1,188) | 80 | 900 |
| 2026 Platinum ($279 / $3,348) | 210 | 2,540 |
| 2026 Palladium ($399 / $4,788) | 300 | 3,630 |
| Legacy Basic $69 | 50 | 630 |
| Legacy Standard $129 | 100 | 1,170 |
| Legacy Premium $179 | 140 | 1,630 |
| Legacy Platinum $279 | 210 | 2,540 |
| Legacy Titanium $349 | 260 | 3,170 |
| Legacy Palladium $399 | 300 | 3,630 |
| Trial $1 / $7 | 10 (minimum; formula gives 0 / 10) | — |

A legacy user on a held/discounted price gets credits for what they really pay
(e.g. Palladium held at $199/mo → 150).

#### Config keys

| Key | Type / default | What it controls |
|---|---|---|
| `formula.costPerCreditUsd` | number, `0.132` | What one credit (one image) costs |
| `formula.budgetPercent` | number, `10` | Share of the plan price that becomes credits |
| `formula.roundTo` | integer, `10` | Round credits to the nearest N |
| `yearly.upfront` | boolean, `true` | Yearly plans: whole year at once (refresh yearly). `false` = yearly credits ÷ 12 every `refreshEvery` |
| `listPrices.<familyId>` | `{ monthly, yearly? }` USD | Undiscounted list prices (legacy families; 2026 read from `pricing.planPrices` unless listed here). Missing yearly = monthly × 12 |
| `refreshEvery.unit` / `.count` | `"day"`/`"week"`/`"month"`/`"year"`, default 1 month | Refresh period for non-yearly plans. The formula is per month — other periods are scaled (week = monthly × 7/30.4) |
| `byPlanId.<planId>` / `byFamily.<familyId>` | integer | **Fixed override** of the formula, per refresh period (per year for yearly-upfront). byPlanId wins over byFamily. Family IDs in §14.3 |
| `trial.minCredits` | integer, `10` | Floor for trial credits |
| `trial.byPlanId` / `trial.byFamily` | integer | Fixed trial credits overriding the formula |
| `trial.planIds` | array of product IDs | Extra products always treated as trials (beyond family trial variants 52–57) |
| `trial.maxTrialDays` | integer, `14` | Invoice first period `Nd` with N ≤ this, followed by a second period, = trial |
| `noPlanCredits` | integer, `0` | Plan credits with no active plan (expired/cancelled) |
| `unknownPlanCredits` | integer, `0` | Credits when no price can be found (unknown product, admin-granted custom plan) |
| `amemberCacheSeconds` | integer, `300` | How long one user's aMember lookup is reused. `POST /credits/sync` bypasses it |

A config change applies from each user's **next** refresh (the current period
keeps the amount it started with). The Credits tab's plan details update on the
next aMember sync.

### 14.3 Plan families (the keys used in `byFamily`)

| familyId | Plan IDs (variant) |
|---|---|
| `free` | 20 |
| `basic-legacy` | 52 trial, 59 monthly, 64/25 yearly, 2,5,9,14,15,40 legacy |
| `standard-legacy` | 53 trial, 58 monthly, 65/26 yearly, 3,6,10,13,16,41 legacy |
| `premium-legacy` | 54 trial, 60 monthly, 66/27 yearly, 4,7,11,12,17,19,42 legacy |
| `platinum-legacy` | 55 trial, 61 monthly, 67/28 yearly, 22,34,23,24,37,43 legacy |
| `titanium-legacy` | 56 trial, 62 monthly, 68 yearly, 29,35,44,31 legacy |
| `palladium-legacy` | 57 trial, 63 monthly, 69 yearly, 32,36,30,39,45 legacy |
| `custom` | 33, 46, 70 |
| `enterprise` | 71 |
| `basic-2026` / `standard-2026` / `platinum-2026` / `palladium-2026` | 72/76, 73/77, 74/78, 75/79 (monthly/yearly — IDs come from `pricing.planIds`) |

Snapshot as of 2026-10-13 from `src/services/planControl/engine/planFamilies.js`.
The code always reads the live family list, so a plan ID added to a family
automatically gets that family's credits.

### 14.4 Two buckets — what a refresh does

- `cycle_balance` — **plan credits**. At each new period it is **reset** to the
  allowance (no rollover).
- `topup_balance` — **purchased credits**. A refresh never resets, adds to, or
  expires them. Example: allowance 100, user bought 100 top-up credits and used 30
  plan credits → after refresh: plan 100, top-up 100.
- `balance` = `cycle_balance + topup_balance` (what the header shows).
- Spending order: plan credits first, then top-ups. A failed/cancelled generation
  is refunded to the bucket it came from (`job.credit.bucket`).
- A new period starts when `cycle_key` changes. The key includes the plan ID, so
  an **upgrade/downgrade mid-period immediately resets plan credits to the new
  plan's allowance** (top-ups untouched).
- Every period start writes an `allocation` ledger line ("Plan allocation · N
  credits" / "Trial allocation · N credits" in credit history).

### 14.5 How the plan and dates are decided (from aMember)

1. Fetch `users?_filter[user_id]=X&_nested[]=invoices&_nested[]=access` (read-only).
2. **Active plan** = access records active today (`begin_date ≤ today ≤ expire_date`),
   excluding top-up products and unknown products (unless in `byPlanId`). If
   several, the highest tier wins, then the latest expiry. Admin-granted access
   (no invoice) counts like any other.
3. **Term** = that access record merged with contiguous records of the same
   product (recurring rebills add a new record each period).
4. **Recurring** = the access record's invoice has aMember status `2` (Recurring
   Active). No invoice, or any other status → not recurring.
5. **Trial** = the invoice's first period is `Nd` (N ≤ `maxTrialDays`) followed by a
   second period and today is still inside it; or the product is a trial variant
   (52–57) / in `trial.planIds`.
6. Periods are anchored to when the **paid** part of the term began (after the
   trial, if any).

| Situation | `cycle_kind` | Credits | Shown to user |
|---|---|---|---|
| Trial, will convert (recurring) | `trial` | trial credits | Next refresh = rebill date (trial end), then the paid plan's allowance |
| Trial, won't convert | `trial_ending` | trial credits | "Trial ends <date>", no refresh |
| Recurring monthly/yearly | `recurring` | plan allowance | Next refresh every period |
| Not recurring, term longer than one period (yearly, lifetime/admin grant) | `fixed` | plan allowance | Next refresh every period + "Plan ends <date>" |
| Not recurring, term ends before next period (one-off monthly) | `ending` | plan allowance | "Plan ends <date>", no refresh |
| No active plan | `none` | `noPlanCredits` | Top-ups still usable |

Examples from the dry run on 2026-10-13 (monthly refresh):

- Real user 72508, admin-granted legacy Palladium (69) 2025-04-23 → 2037-12-31 →
  `fixed`, 200 credits, refreshes on the 23rd, plan ends 31 Dec 2037.
- 3-day trial on Standard 2026 (73) started 2026-10-11, recurring → `trial`,
  10 credits, next refresh 2026-10-14; after conversion → `recurring`, 50
  credits, anchored to 10-14.
- Same trial, cancelled → `trial_ending`, ends 2026-10-13.
- Yearly one-off legacy Palladium bought 2026-03-14 → `fixed`, refreshes on the
  14th each month until 2027-03-13.
- Monthly one-off bought 2026-09-25 → `ending`, ends 2026-10-24.

If aMember can't be reached, **nothing is reset** — the last known balance and
plan details (`cycle_meta`) are returned with `stale: true`.

### 14.6 `imageGen.topup` — config reference

| Key | Type / default | What it controls |
|---|---|---|
| `enabled` | boolean, `true` | Show/allow top-ups |
| `currency` / `currencySymbol` | `"USD"` / `"$"` | Display only — the real charge is whatever the aMember product costs |
| `pricePerCredit` | number | Displayed pack price = `credits × pricePerCredit` |
| `packs[].credits` | integer | Credits granted per purchase (× aMember access `qty`) |
| `packs[].amemberProductId` | integer or `null` | The aMember product sold for this pack. `null` → shown as "Unavailable" |
| `packs[].discountPercent` | 0–100 | Displayed price = base × (1 − discount/100); original shown struck through |
| `packs[].checkoutUrl` | string, optional | Per-pack checkout link, overrides the shared one |
| `checkoutUrl` | string | Shared checkout link; `{productId}` is replaced with the pack's product ID |

Current pricing (2026-10-13): `pricePerCredit: 0.132`, no discounts → 100 credits
= $13.20, 500 = $66.00, 1000 = $132.00. When a `discountPercent` is set on a pack
later, the displayed price is recalculated automatically (original shown struck
through). **Each aMember product's real price must be set to the same number** —
the app can't verify it.

**How a purchase gets credited:** "Continue to payment" opens the pack's aMember
checkout in a new tab. aMember takes payment and creates an **access record** for
that product on the user's account (invoice and receipt stay in aMember). When the
user returns to the tab, the modal calls `POST /credits/sync`; every credits load
and every reserve also checks. Each top-up access record is credited **exactly
once** (`imagegen_topup_grants`, `_id = "access:<access_id>"`), so restarts or
repeated syncs can't double-credit. No aMember webhook is needed.

**Credited only when paid, taken back on refund** (`syncTopups` in
`helpers/topups.js`). An access record alone isn't trusted. aMember is also read
for the user's payments and refunds (`invoice-payments` + `invoice-refunds`,
filtered by `user_id`, read-only — `fetchAmemberPaymentsAndRefunds` in
`amemberAuth.js`), and both are matched to the access record's `invoice_id`:

| aMember state of the top-up invoice | What happens |
|---|---|
| No payment record yet (pending / failed / abandoned checkout) | Not credited; re-checked on every later sync, credited as soon as the payment appears |
| Paid | Credited once; `paid_amount` stored on the grant |
| Refunded (or charged back) before we ever credited it | Never credited |
| Partly refunded after crediting | The same share of the pack is removed (e.g. half the money back → 50 of 100 credits), rounded up |
| Fully refunded / charged back after crediting | All remaining pack credits are removed; grant `status: "reversed"` |
| Access added by an admin by hand (no invoice) | Treated as a gift and credited; if the admin later deletes that access, the credits are removed |
| aMember payments/refunds can't be read | Nothing is credited or removed this time; the next sync retries |

Removal takes credits only from the **top-up bucket** and never pushes it below 0.
Credits the user already spent can't be taken back. The ledger line
(`reason: "topup_reversed"`, `delta = -removed`) records
`meta.{reversed, removed, unrecovered, invoice_id, access_id}`, so any shortfall is
visible. Credit history shows it as "Top-up refunded · N credits removed (M already
used)". Reversals are exactly-once: the grant's `reversed_credits` is advanced with
a conditional update before any credits move. Payments/refunds are fetched only for
users who have top-up access records or open grants, and they are cached per user
for `credits.amemberCacheSeconds`. `POST /credits/sync` bypasses that cache.

**Login fix (important):** login (`amemberAuth.js`) picks the user's plan as the
**highest** product ID they hold. Top-up products will have IDs above every plan,
so they are removed from `subscriptions` before any plan logic — buying a top-up
never changes the user's plan or trips the custom-plan path (which would lock all
platforms). The list comes from `imageGen.topup.packs[].amemberProductId`, so
**always add a new top-up product's ID to config before selling it.**

### 14.7 aMember settings for top-ups

**Which aMember:** the one in `config.json` → `amember.apiUrl` (currently
`https://app-dev.poweradspy.com/amember/api/`). Products and the checkout form
MUST be created in that same aMember — the backend reads purchases from it, so a
product created in a different aMember would be paid for but never credited.
`imageGen.topup.checkoutUrl` must point at the same host.

**Only additions — nothing existing in aMember is changed.** No existing product,
billing plan, category, form, user, invoice or payment-system setting is edited.

#### Settings to create

| # | Where in aMember admin | Setting |
|---|---|---|
| 1 | Products → Manage Categories | New category **"AI Credit Top-ups"** — holds only the top-up products, kept apart from subscription plans |
| 2 | Products → Manage Products → Add | **AI Credits – 100 credits** — price **$13.20 USD**, one-time payment (no rebill / rebill_times 0), access period lifetime (or long, e.g. 10 years), category "AI Credit Top-ups" only |
| 3 | Products → Manage Products → Add | **AI Credits – 500 credits** — price **$66.00 USD**, same billing/access/category as above |
| 4 | Products → Manage Products → Add | **AI Credits – 1000 credits** — price **$132.00 USD**, same billing/access/category as above |
| 5 | Products (each of 2–4) | Not shown on the new-user signup / pricing pages where subscription plans are sold; purchasable by logged-in members only |
| 6 | Configuration → Forms Editor | New member form (the "Renew / Add Subscription" type, NOT new-user registration), code **`topup`**, title "Buy AI credit top-up", Product brick = only the 3 AI Credits products, Payment System brick = the same payment systems the existing paid plans use, no account fields |
| 7 | Browser test (no payment) | Confirm a link opens the form with one pack pre-selected — tried in order: `…/amember/signup/topup?product_id_page-0[]=<product_id>`, the same with the billing plan ID, or aMember's own "link" for the form/product. If none pre-selects, 3 separate forms `topup100`, `topup500`, `topup1000` (one product each) |

Why each setting matters:
- **One-time, not recurring** — a top-up is a single purchase; a rebill would keep
  charging the user every period.
- **Price = displayed price** — the app shows `credits × pricePerCredit − discount`
  (100 → $13.20, 500 → $66.00, 1000 → $132.00 with `pricePerCredit 0.132` and no
  discounts); aMember charges the product price. They must match — if a
  `discountPercent` is added later, change that product's aMember price too.
- **Access period doesn't matter** — the backend only checks that the access record
  exists (`helpers/topups.js`); top-up credits never expire on our side.
- **Separate category, not on the plans signup page** — so nobody buys a credit
  pack thinking it's a plan, and plan pages stay unchanged.
- **Member form, not registration form** — the buyer is already logged in, so the
  purchase lands on their existing aMember account (that's how we match it to the
  user).

#### After aMember setup — app config

1. `imageGen.topup.packs[].amemberProductId` = each product's ID (matching the
   credits). **Do this before selling** — until a top-up product ID is in config,
   the login logic would treat a bought pack as the user's plan (§14.6).
2. `imageGen.topup.checkoutUrl` = the working link format with `{productId}` /
   `{billingPlanId}` where the IDs go — or each pack's own `checkoutUrl` if separate
   forms were needed. If a product's billing plan ID differs from its product ID
   (check the radio `value` in the form's HTML), set that pack's
   `amemberBillingPlanId`.
3. Restart the backend.
4. Test: buy the cheapest pack with a test account, return to the PowerAdSpy tab →
   credits appear and "Top-up pack · N credits" shows in credit history.
5. Refund test: refund that invoice in aMember admin (Payments → the invoice →
   Refund) → reopen Profile › Credits → the 100 credits are gone and "Top-up
   refunded · 100 credits removed" shows in credit history.

#### Recorded setup (fill in once done)

| Item | Value |
|---|---|
| aMember instance | _pending_ |
| Category | _pending_ |
| 100 credits → product_id / billing_plan_id / price | _pending_ |
| 500 credits → product_id / billing_plan_id / price | _pending_ |
| 1000 credits → product_id / billing_plan_id / price | _pending_ |
| Payment systems attached | _pending_ |
| Form code(s) and URL(s) | _pending_ |
| Working pre-select link format | `…/amember/signup/topup?product_id_page-0[]=<product_id>-<billing_plan_id>` — the value must equal the form's radio value (e.g. `81-81`); `=81` alone silently falls back to the first pack. Config: `checkoutUrl` with `{productId}-{billingPlanId}`, per-pack `amemberBillingPlanId` (defaults to the product ID). Verified on app-dev 2026-10-13 |
| Set up by / date | _pending_ |

The prompt used to have Claude in Chrome do steps 1–7 is the same as these
settings; its report (product IDs, form URL, working link format) goes in the
table above.

### 14.8 API

- `GET /api/v1/imageGen/credits` → `balance`, `cycle_balance`, `topup_balance`,
  `monthly_quota` (= allowance per period), `used_this_cycle`, `cycle_resets_at`
  (next refresh date), `ends_on` (term/trial last day), `cycle_kind`, `is_trial`,
  `recurring`, `plan_label` (e.g. "Palladium (Legacy)", "Basic · Trial"), `stale`,
  `topup{enabled, currency, currency_symbol, packs[]}`, `ledger[]`.
- `POST /api/v1/imageGen/credits/sync` → same response, aMember re-read now.
- `GET /api/v1/imageGen/credits/history?type=all|used|refunded|allocated` —
  `allocated` = ledger reasons `allocation` + `topup` + `topup_reversed`.

### 14.9 Common changes (recipes)

| Want | Edit |
|---|---|
| Credit cost changes (e.g. model price) | `credits.formula.costPerCreditUsd` — every plan recalculates |
| Give 15% instead of 10% of the plan price | `credits.formula.budgetPercent = 15` |
| No rounding | `credits.formula.roundTo = 1` |
| Yearly users get credits monthly instead of upfront | `credits.yearly.upfront = false` |
| Basic 2026 gets a custom 75 (ignore formula) | `credits.byFamily["basic-2026"] = 75` |
| One specific product gets 500 | `credits.byPlanId["69"] = 500` |
| Legacy price list changes | `credits.listPrices["standard-legacy"] = {monthly: 129}` |
| Refresh weekly / every 2 weeks / daily (non-yearly) | `credits.refreshEvery` = `{unit:"week",count:1}` / `{unit:"week",count:2}` / `{unit:"day",count:1}` |
| Every trial at least 25 | `credits.trial.minCredits = 25` |
| Basic trial gets a custom 15 | `credits.trial.byFamily["basic-2026"] = 15` (or `trial.byPlanId["72"] = 15`) |
| Expired users still get 5 | `credits.noPlanCredits = 5` |
| Change top-up price | `topup.pricePerCredit` **and** each aMember product's price |
| Add a 2000-credit pack | Create the aMember product, then add `{credits:2000, amemberProductId:<id>, discountPercent:25}` to `topup.packs` |
| Switch currency to INR | `topup.currency = "INR"`, `topup.currencySymbol = "₹"`, adjust `pricePerCredit`, price the aMember products in INR |
| Disable top-ups | `topup.enabled = false` |

### 14.10 Caveats / open items

- **First load after deploy resets old balances:** the old flat 20-credit
  placeholder balance is replaced by each user's plan allowance.
- **Refunds remove only unspent top-up credits** (§14.6). If the user spent them
  before the refund, the shortfall is recorded in the ledger (`meta.unrecovered`),
  not charged against plan credits. A refund is picked up on the user's next
  credits load or reserve, not pushed by aMember.
- **Refunds must be recorded in aMember** (refund/chargeback entries on the
  invoice). A refund made only in the payment gateway that never reaches aMember
  can't be seen.
- **Mid-period plan change resets plan credits** to the new plan's allowance
  (§14.4) — intended, but a downgrade also refills.
- **Displayed vs charged price** stay in sync only if config and aMember are
  updated together.
- **Checkout URL syntax** must be confirmed in aMember (§14.7 step 3).
- **Freshness:** the frontend (`useImageGenCredits`) calls `POST /credits/sync`
  (bypasses the aMember cache) on every page load — in parallel with
  `GET /access` — and again whenever the user returns to the tab (≤ once/30s).
  So a top-up or plan change made in aMember (checkout, or an invoice added by
  hand in aMember admin) shows on reload / tab focus. Other reads use the
  `amemberCacheSeconds` cache. The header paints the last known balance from
  localStorage instantly, then replaces it with the live value (~0.3–0.5s).
- **A hand-added top-up invoice needs a payment record** in aMember (admin:
  add the invoice *with* a payment, or "mark paid"). An invoice with no payment
  is treated as unpaid and not credited (§14.6).

### 14.11 Testing without touching the database

`computePlan` is pure (no writes). From `pas_node_api/`:

```
node -e "const {computePlan}=require('./src/services/imageGen/helpers/creditPlan'); const {fetchAmemberSubscription}=require('./src/auth/amemberAuth'); fetchAmemberSubscription(72508).then(s=>console.log(computePlan(s)))"
```

Pass a hand-built `{access, invoices}` object and a `Date` as the second argument
to test any scenario.

## 15. Feature on/off + per-user rollout (2026-10-13)

Two keys in `config.json` → `imageGen` control who gets the **whole** AI Recreate
feature set:

| `enabled` | `allowedUserIds` | Result |
|---|---|---|
| `false` | anything | Nobody |
| `true` | `[]` | Everyone |
| `true` | `[72508, 1234]` | Only those aMember user IDs |

A user without access sees no trace of the feature:

- **UI hidden:** Recreate buttons (masonry cards, list cards, ad detail modal,
  saved ads), the Recreate modal, MySpace nav item (sidebar + mobile bottom nav),
  header credits pill + dropdown, "Profile" user-menu item, imageGen notifications
  in the bell (not even polled).
- **Frontend routes:** `/myspace`, `/my-space` and `/profile/*` redirect to `/`
  (replace — Back doesn't return there). The redirect waits for the access answer,
  so a user who does have access is never kicked out on a hard reload.
- **API:** every `/api/v1/imageGen/*` and `/api/v1/profile/*` route returns **404
  "Not found."** (`helpers/access.js` → `requireImageGenAccess`, after
  `authMiddleware`). The one exception is `GET /api/v1/imageGen/access` →
  `{ enabled: true|false }`, which the frontend reads once per login.

Where it lives: `src/services/imageGen/helpers/access.js` (rule +
middleware), `src/config/index.js` (`imageGen.allowedUserIds` parsing — array or
comma-separated `IMAGEGEN_ALLOWED_USER_IDS` env), frontend
`hooks/useImageGenCredits.jsx` (`enabled` / `accessResolved`, the single frontend
switch) used by `App.jsx`, `Header.jsx`, `useImageGenNotifications.js`; `Sidebar.jsx`
and `BottomNav.jsx` show MySpace only when `App.jsx` passes `onShowMySpacePage`.

Notes:
- Turning it off keeps all data (jobs, credits, ledger, top-up grants); turning
  it back on restores everything as it was.
- Background crons (stuck-job sweep, NAS cleanup) keep running regardless — they
  only finish work already started.
- Changes need a backend restart; users pick them up on their next page load.
- Profile's notification preferences (incl. "Keyword search results") are part of
  this feature set, so users without access can't change them — their
  preferences keep defaulting to on.

## 16. Data layout, lifetime and per-user tools (2026-10-13)

### 16.1 Collections — one user's data is one indexed query per collection

| Collection | Key | What | Kept for |
|---|---|---|---|
| `imagegen_credits` | `_id = user_id` | Balances (plan + top-up) and current plan details | Forever (1 doc/user) |
| `imagegen_jobs` | `user_id` | One doc per Recreate | Succeeded: until the user deletes it from MySpace. Failed/cancelled: `retention.failedJobsDays` |
| `imagegen_credit_ledger` | `user_id` | Credit history (reserve, refund, allocation, topup) | `retention.ledgerDays` |
| `imagegen_notifications` | `user_id` | Bell entries for finished jobs | `notificationsUnreadDays` / `notificationsReadDays`, max `notificationsMaxPerUser` per user |
| `imagegen_topup_grants` | `user_id` | One doc per credited aMember top-up (stops double-crediting) | Forever (tiny) |
| `imagegen_nas_deletions` | `user_id`, `url` | Queue of uploaded images to delete from NAS | Removed when done; failed ones `failedNasDeletionDays` |
| `profile_users` (profile DB) | `_id = user_id` | Profile fields + notification preferences | Forever (1 doc/user) |

Every collection has a `{user_id, created_at}` index (or uses `_id`), so per-user
reads and caps stay fast no matter how many users or rows exist.

**Development note:** in development `src/config/networks.js` (`netVal`) points
every service at the shared dev database (`pas_competitors`), so these collections
sit next to the competitor-analysis ones there. In production they live in their
own databases (`pas_imagegen`, `pas_profile`). That's the codebase-wide dev
convention, not a bug in this feature.

### 16.2 Lifetime — `config.json` → `imageGen.retention`

| Key | Default | Effect |
|---|---|---|
| `notificationsMaxPerUser` | 50 | Older notifications beyond this are deleted as new ones arrive |
| `notificationsUnreadDays` | 30 | A notification is deleted N days after it was created... |
| `notificationsReadDays` | 7 | ...or N days after it was read, whichever comes first |
| `failedJobsDays` | 30 | Failed/cancelled generations disappear this long after failing |
| `ledgerDays` | 365 | Credit-history rows older than this are deleted (balances unaffected) |
| `failedNasDeletionDays` | 30 | Permanently-failed NAS cleanup rows kept this long |

`null` = keep forever. Mechanism: the doc gets an `expire_at` date when it's
written (or when it fails / is read) and a MongoDB TTL index on `expire_at`
deletes it — Mongo does the work (checks every ~60s), the app never scans for old
data. Never expired: succeeded jobs, balances, top-up records, profile.

Also removed: the zero-value `finalize_debit` ledger row that used to be written
for every successful generation (the `reserve` row already records the charge).

Changing a value applies to newly written docs after a restart. To apply it to
existing docs too, run `--apply-retention` (below).

### 16.3 `scripts/imagegen-user-data.js`

Run from `pas_node_api/`:

| Command | Does |
|---|---|
| `node scripts/imagegen-user-data.js 72508` | Read-only summary of everything for one user: balances, plan, profile, counts per status/reason, how many docs are set to expire |
| `node scripts/imagegen-user-data.js 72508 --full` | Same, with every document |
| `node scripts/imagegen-user-data.js 72508 --purge --yes` | **Deletes** all of that user's AI Recreate data in every collection above (NAS files are not touched) — for cleaning up dev/test users |
| `node scripts/imagegen-user-data.js --apply-retention` | Applies current `imageGen.retention` to existing docs (sets/removes `expire_at`), deletes old `finalize_debit` rows, enforces the per-user notification cap, makes sure TTL indexes exist |
