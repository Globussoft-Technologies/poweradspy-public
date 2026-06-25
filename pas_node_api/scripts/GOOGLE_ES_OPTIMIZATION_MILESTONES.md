# Google ES (`google_ads_data`) — Optimization Milestones

Goal: a **fast + relevant** mapping for `google_ads_data` (~206M docs, ES 6.8) that
(1) kills the query slowness, (2) fixes the keyword-search relevance bug
("hair"→"Haier"), and (3) doesn't disturb the live insert/search flow.

Root cause (confirmed in code): the content fields `text / title /
newsfeed_description / news_feed_description` are mapped with an **edge_ngram
(min_gram=1) analyzer**. That bloats the index (slow) and over-matches at search
time. The current query-only "longest-token" workaround
(`GoogleSearchQueryBuilder._getKeywordEnv`) is a fragile patch on a bloated index.

---

## M0 — Diagnostic (READ-ONLY, no risk) ← we are here
**Do:** run `scripts/google-es-mapping-diagnostic.js` on prod (BE-08) and send back
`scripts/google-es-mapping-diagnostic.json`.
**Gives:** current mapping + analyzer settings, index size/segments/shards,
per-field cardinality + top values (keyword-vs-text decisions), fill-rates,
sample docs, and **baseline query timings** (the slow numbers we must beat).
**Approval:** none (read-only).

## M1 — Design the v2 mapping + settings (offline, no prod touch)
**Do:** from the M0 report, finalize `google_ads_data_v2`:
- Content fields → clean analyzer (whole-word match + `match_phrase`), **NO
  edge_ngram**, plus a `.kw` keyword sub-field for exact. → fixes relevance +
  shrinks the index.
- Exact-code/filter fields (`type, ad_position, ad_sub_position, source, status,
  platform, country(+normalizer), state, city, lang_detect, target_keyword,
  built_with, built_with_analytics_tracking, affiliate_data, id, ad_id`) →
  `keyword` → fast `term`/`terms` filters (lets us drop the token-resolver hack).
- Dates (`last_seen, first_seen, post_date, domain_registered_date`) → `date`
  with the stored format; numerics → `integer/long`; `id` aggregatable (collapse +
  cardinality).
- URL/wildcard fields → `keyword`; prefer matching the existing `domain` keyword
  over `*wildcard*` where possible.
- Rarely/never-searched stored fields → `index:false` to save space/speed.
- Index settings: right shard count for ~the new (smaller) size, `refresh_interval`
  tuned for reindex, then back to serving value.
**Deliverable:** the exact `PUT google_ads_data_v2` mapping+settings JSON +
the (small) `GoogleSearchQueryBuilder` simplification diff.
**Approval:** review the proposed mapping.

## M2 — Build v2 on staging + prove relevance/speed
**Do:** create `google_ads_data_v2` on staging, reindex a sample (or point a
staging build at it), run the regression set: the relevance cases that broke
("hair fall solutions", "online casino", "hubspot", "car insurance") **must not
regress**, and the M0 slow queries must get faster. Smoke the insert path against
v2.
**Approval:** none beyond staging access.

## M3 — Reindex prod into v2  *(HEAVY — needs approval + window)*
**Do:** `PUT google_ads_data_v2` (final mapping) → **sliced async `_reindex`**
from the live index → then a **`last_seen` catch-up** pass for docs written
during the reindow. Take an **ES snapshot first**.
**Approval:** YES — reindex of a 206M-doc live index; pick a low-traffic window.

## M4 — Cut over (read-flip → verify → swap)  *(IRREVERSIBLE step here)*
**Do:** flip reads to v2 via env/alias first and parity-check counts/spot-checks;
then **alias-swap** `google_ads_data` → v2; deploy the `GoogleSearchQueryBuilder`
simplification. **Rollback = env/alias flip back + snapshot restore.**
The irreversible step is deleting the old index — do that only after soak.
**Approval:** YES — sign-off on the swap + old-index deletion.

## M5 — Cleanup + close the audit items
**Do:** after soak, delete the old index; one-time **dedup** of the ~8.6M
duplicate docs and **delete** the ~106k empty docs (the live-insert dup-prevention
fix is already in `metaAdsPipeline.js`, so these don't regrow); decide the 44M
DB↔ES gap (retention vs catch-up reindex).
**Approval:** YES — irreversible deletes (snapshot first).

---

### Order / dependency
M0 → M1 → M2 can proceed now (no prod risk). M3/M4/M5 are gated on sign-off and a
low-traffic window. The insert-path duplicate fix is independent and can ship any
time.
