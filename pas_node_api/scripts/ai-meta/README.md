# AI-Meta apply scripts

One-off maintenance scripts that provision the storage the AI-Meta write path needs
(spec **v1.6** — see `docs/AI_META_API_PAYLOAD_SPEC.md`, `docs/AI_META_SQL_STORAGE.md`,
`docs/AI_META_ES_MAPPING_RUNBOOK.md`). Connection details + per-network schema/index
names are read from `config.json` (`databases.sql`, `databases.elastic`,
`databases.elastic_tiktok`, and `networks.<net>.*`).

All three are **idempotent** and default to a **safe/dry-run** mode. Nothing here modifies
existing ad data except the explicit, flagged cutover in `reindex-ai-mapping.js --swap`.

## 1. `apply-sql-tables.js` — create `<net>_ad_ai_meta`
```
node scripts/ai-meta/apply-sql-tables.js                 # dry-run (prints DDL)
node scripts/ai-meta/apply-sql-tables.js --commit        # create all 11
node scripts/ai-meta/apply-sql-tables.js --only=facebook,native --commit
```
`CREATE TABLE IF NOT EXISTS` per network — never drops/alters, safe to re-run. FK →
`<net>_ad(id)` `ON DELETE CASCADE` (FK column type matches the parent: `INT UNSIGNED`
for all, signed `INT` for tiktok). 17 columns incl. `category_id`/`subcategory_id` and
`caption TEXT`.

## 2. `apply-es-mapping.js` — add the `ai` mapping to each live index
```
node scripts/ai-meta/apply-es-mapping.js                 # dry-run (prints PUT body)
node scripts/ai-meta/apply-es-mapping.js --commit        # apply to all 11
node scripts/ai-meta/apply-es-mapping.js --only=tiktok --commit
```
Additive `PUT <index>/_mapping` only — never creates an index, never reindexes, never
deletes. Detects ES major (6 typed `/doc` vs 7+/8 typeless) and resolves the per-network
index + cluster the same way the app does. If an index has a pre-existing incompatible
`ai` mapping, ES rejects the PUT with a 400 and the script reports it (data untouched) —
that index then needs script 3.

## 3. `reindex-ai-mapping.js` — fix indices that already had a stale `ai` mapping
Only needed for indices where a pre-v1.5 prototype doc had already dynamically mapped
`ai.*` as `text` (ES can't change a field's base type in place). Two phases:
```
node scripts/ai-meta/reindex-ai-mapping.js --only=instagram          # phase 1: reindex only (non-destructive)
node scripts/ai-meta/reindex-ai-mapping.js --only=instagram --swap   # phase 2: cut over (DESTRUCTIVE)
```
Phase 1 creates `<name>_v2` with the correct v1.6 mapping and reindexes into it while
running `ctx._source.remove('ai')` (drops the stale ai; every other field copied
verbatim); source untouched. Phase 2 re-checks `source==v2` counts, then deletes the old
concrete index and aliases `<name> → <name>_v2` so the app keeps using the same name.

## 4. `finalize-concrete-names.js` — convert an alias'd index back to a concrete index
After script 3, `<name>` is an alias → `<name>_v2`. This makes `<name>` a plain concrete
index again (uniform with the other networks). ES 6.8 has no rename/clone, so it frees the
name and reindexes `<name>_v2` back into a fresh concrete `<name>` (correct v1.6 mapping),
then drops `<name>_v2`.
```
node scripts/ai-meta/finalize-concrete-names.js --only=instagram           # dry-run
node scripts/ai-meta/finalize-concrete-names.js --only=instagram --commit  # canary
node scripts/ai-meta/finalize-concrete-names.js --only=facebook,gdn --commit
```
Reindex uses `op_type: create` (an app write into the new index during the brief window is
not clobbered); on any failure it restores the alias `<name>` → `<name>_v2`; `<name>_v2` is
deleted only after the new count is verified. Brief per-index window while the name
repopulates — run during low ingestion.

## Applied state (dev cluster, 2026-07-13) — ALL CONCRETE, UNIFORM

| network | SQL table | ES index (concrete) | ES mapping |
|---|---|---|---|
| all 10 main-cluster nets | ✅ | `search_mix`, `instagram_search_mix`, `gdn_search_mix`, `youtube_ads_data`, `google_ads_data`, `native_search_mix`, `linkedin_ads_data`, `reddit_search_mix`, `quora_search_mix`, `pinterest_search_mix` | ✅ v1.6 |
| tiktok | ✅ | `tiktok_ads` (ES8 cluster) | ✅ v1.6 |

All 11 are **plain concrete indices** (no aliases, no `_v2` leftovers), verified with the
correct v1.6 `ai` mapping. facebook/instagram/gdn each had one stale v1.1 prototype `ai`
doc (`product_type`/`brand`/`status`) that had forced a `text` mapping; they were reindexed
(script 3, stale `ai` dropped, all real docs preserved + count-verified) and then finalized
back to their original concrete names (script 4). The app reads/writes the same index names
throughout.

> **Prod rollout:** run scripts **1 & 2** against the prod env's `config.json`. Only if
> script 2 reports a 400 mapping conflict on an index (a pre-existing `ai` mapping), run
> **3** (reindex) then **4** (finalize) for that index. Take schema/index names from the
> target env's config (they differ from dev's `pasdev_*`), and prefer a low-ingestion
> window for 3 & 4.
