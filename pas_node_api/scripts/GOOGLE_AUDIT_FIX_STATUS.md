# Google Search Index — Audit Fix Status

**What we're doing:** rebuilding the Google search index (`google_ads_data` →
`google_ads_data_v2`) on the new server with an **optimized mapping**, migrated
with a **safe, resumable** tool (read-only on the source; idempotent writes —
nothing is double-written or deleted). This is mapped against the
`GOOGLE_DATA_AUDIT_2026-06-24` findings below.

| # | Audit finding | Status with this rebuild | Notes |
|---|---|---|---|
| **3** | Keyword search broken ("online casino" → 0 results) **and very slow (~11s)** | ✅ **Fixed** | New mapping drops the edge-ngram analyzer → correct matches + much faster queries |
| **5** | ~8.6M duplicate documents | ✅ **Fixed** | Migration writes one doc per ad id, so duplicates collapse automatically |
| **6** | ~106k empty / malformed documents | ✅ **Fixed** | Migrator skips empty docs — they won't exist in the new index |
| 2 | `language_id = 0` on all ads | ⚠️ **By design (unchanged)** | Intentional — the translation/language service is offline; kept as 0/null per the earlier decision |
| 4 | `days_running` frozen | ◻️ **Forward-only** | New ads compute it correctly going forward; correcting old values needs a separate backfill (only if history matters) |
| 1 | ~44M ads in the DB but not in the search index | ◻️ **Separate task** | Needs a MySQL→Elasticsearch backfill **plus a retention-vs-backlog decision**; not part of this index rebuild |

## Summary
This rebuild fixes the **three index-quality problems**:
- **#3 — the broken & slow keyword search (the biggest user-facing issue),**
- **#5 — duplicate documents,**
- **#6 — empty/malformed documents.**

The remaining three are **separate**: **#2** is intentional, **#4** is forward-only,
and **#1** needs a decision plus a different job (DB→search backfill).

## Safety & rollback
- The **old index stays untouched** on the old server throughout — instant fallback.
- The migration is **resumable** (a crash/restart continues, never restarts) and
  **idempotent** (re-runs can't create duplicates).
- We **switch search to the new index only after verification**, and keep the old
  one until it has soaked.
