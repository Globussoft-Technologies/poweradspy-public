# Exact post-owner production deletion

Script: `scripts/delete-post-owner-ads.js`

The script removes every ad whose post-owner name exactly matches the supplied
name across Facebook, Instagram, GDN, YouTube, Google, Native, LinkedIn, Reddit,
Quora, Pinterest, and TikTok.

For the first ten networks it reuses the existing transactional SQL cascade
delete pipeline and removes/verifies Elasticsearch documents. TikTok is
read-only in this API, so its authoritative ad documents are removed directly
from its Elasticsearch 8 index; matching TikTok analytics and user
hide/favourite rows are removed from SQL.

Matching is case-insensitive and normalized. It is never a substring or
wildcard deletion. `TwinklingTree` does not match `TwinklingTree Store`.

## Safety sequence

Run all commands from `pas_node_api`.

1. Prevent the ten Node insertion networks from accepting this owner again:

   ```json
   "insertion": {
     "enabled": true,
     "rejectedPostOwnerNames": ["TwinklingTree"]
   }
   ```

   Add the name under each applicable
   `networks.<network>.insertion.rejectedPostOwnerNames`, deploy the config, and
   restart the Node workers. TikTok ingestion is external to this repository,
   so its upstream ingester must be blocked separately if it can recreate the
   document.

2. Run the read-only dry-run:

   ```powershell
   node scripts/delete-post-owner-ads.js --post-owner "TwinklingTree"
   ```

   It prints the resolved SQL database, Elasticsearch index, exact SQL ad count,
   and exact Elasticsearch ad count per network. It performs no writes.

3. Use counts from that latest dry-run—not an older UI screenshot—in the apply
   command:

   ```powershell
   node scripts/delete-post-owner-ads.js `
     --post-owner "TwinklingTree" `
     --apply `
     --confirm "DELETE_POST_OWNER_ADS:TwinklingTree" `
     --expected-counts "facebook=221,instagram=2238,gdn=0,youtube=9,google=23,native=0,linkedin=0,reddit=0,quora=0,pinterest=0,tiktok=1"
   ```

   The command refuses to write unless:

   - `config.server.nodeEnv` is exactly `production`;
   - every selected SQL and Elasticsearch connection succeeds;
   - every expected Elasticsearch count equals the fresh preflight count;
   - SQL and Elasticsearch counts agree for the normalized SQL networks;
   - the owner is already present in every selected insertion network's reject
     list;
   - the confirmation phrase exactly includes the supplied owner name.

If a reviewed SQL/Elasticsearch difference is legitimate, add
`--allow-count-mismatch`. Do not use that option merely to bypass an unexplained
difference.

The operation is fail-fast and rerunnable. After each network it verifies that
zero matching SQL ads and zero matching Elasticsearch documents remain. A
successful apply writes a JSON audit report under
`data/post-owner-deletion-reports/`.

## Keyword / search-API matching

Use this to delete exactly what the public search API returns for a search.

```powershell
# dry-run (read-only)
node scripts/delete-post-owner-ads.js --keyword "car insurance" --exact-search
node scripts/delete-post-owner-ads.js --post-owner "TwinklingTree" --match search-api --exact-search

# apply — the dry-run prints the exact --confirm and --expected-counts to use
node scripts/delete-post-owner-ads.js --keyword "car insurance" --exact-search --apply `
  --confirm "DELETE_KEYWORD_ADS:car insurance" `
  --expected-counts "facebook=9,instagram=8,gdn=4,youtube=169,..."
```

- `--keyword` always uses search-API matching. `--post-owner` keeps the strict
  exact-owner matching above unless `--match search-api` is given.
- `--exact-search` sends `exact_search=1`, the same as the UI's precise search.
  Without it the search API's broad matching is used, so review counts carefully.
- How it matches: the script calls each network's real `searchAds` controller,
  records the Elasticsearch query it builds (without running it), then pages
  through every hit with that same query (scroll). Nothing is re-implemented, so
  the delete set is what users see in search.
- The dry-run prints `searchApiTotal` (the real controller's total) next to the
  script's `esExactAds` so they can be compared.
- GDN: the GDN search also shows YouTube DISPLAY ads (YouTube's own search hides
  them). Those are deleted under `youtube` with YouTube's pipeline, so GDN's
  `searchApiTotal` is larger than its `esExactAds`. Ads that appear in both
  searches are counted and deleted once.
- `--max-ads <n>` (default 10000) refuses a network with more matches.
- Confirmation phrases: `DELETE_KEYWORD_ADS:<keyword>`,
  `DELETE_POST_OWNER_ADS:<owner>`, both together `DELETE_SEARCH_ADS:<owner>+<keyword>`.
- Keyword-only deletes do not require an insertion reject-list entry; crawlers
  can re-insert matching ads later.
- A network that fails preflight shows its `error` in the dry-run table, and
  `--apply` refuses until it passes or is left out with `--networks`.

## NAS media

On by default (`--skip-nas` turns it off). After a network's ads are deleted and
verified, every NAS file those ads referenced is deleted: ad image, video,
thumbnail, carousel media and the post-owner image. It uses the existing
`nasClient.deleteFromNas` (HTTP `DELETE` on the NAS origin with the media token,
SFTP fallback, 404 = already gone).

A file is deleted only when:

- it is in the configured NAS bucket (`/<bucket>/stream/...` or the legacy
  `/PowerAdspy...` prefix) — external CDN URLs are never touched;
- no remaining ad in that network's index still references it (a shared image,
  or an owner logo used by ads that are not being deleted, is kept).

Files:

- dry-run: `data/post-owner-deletion-reports/<time>_<search>_nas-plan.jsonl` —
  every file that would be deleted (`action: delete`) or kept (`action: keep`,
  with the reason);
- apply: `..._nas-not-deleted.jsonl` — every file that was NOT deleted with its
  reason (`still-referenced-by-another-ad`, `other-bucket:<b>`,
  `not-a-managed-nas-path`, `nas-delete-failed-or-not-configured`); the JSON
  report lists the deleted paths.

## Scope boundaries

- The post-owner dimension row itself is retained; it may be shared by metadata
  or user preferences. All matching ads and their existing cascade-owned child
  rows are deleted.
- This script does not call the public search API over HTTP. It loads the same
  search controllers in-process and connects directly using the deployed
  server's per-network database configuration.
