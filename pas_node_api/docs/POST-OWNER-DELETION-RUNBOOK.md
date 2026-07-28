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

## Scope boundaries

- The post-owner dimension row itself is retained; it may be shared by metadata
  or user preferences. All matching ads and their existing cascade-owned child
  rows are deleted.
- NAS media files are not deleted because this codebase has no safe NAS delete
  contract. Their database and Elasticsearch references are removed.
- This script does not call the public search API. It connects directly using
  the deployed server's per-network database configuration.
