# AdMob migration scripts

These scripts patch or rebuild the AdMob storage in a dry-run-first way.

## 1. `migrate-lander-fields.js`

Adds the new lander fields to the live MySQL schema:

- `mob_ads.redirect_status`
- `mob_ad_lander_content` and its new payload columns
- `mob_ad_lander_claims` for same-day scraper pickup locking

```bash
node scripts/admob/migrate-lander-fields.js
node scripts/admob/migrate-lander-fields.js --commit
node scripts/admob/migrate-lander-fields.js --drop-obsolete --commit
```

`--drop-obsolete` is the strict AdMob cleanup mode. It rewrites existing
lander rows into the finalized AdMob lander contract by:

- backfilling `platform`, `source_app`, `created`, and `updated`
- normalizing legacy WhatsApp evidence into `whatsapp_json`
- renaming legacy nested `path` values to stored `url`
- recomputing PAS-maintained rotator fields
- creating the daily claim table used by `get_ads_for_blackhat`
- dropping obsolete lander-only columns after backfill

## 2. `apply-es-mapping.js`

Applies the additive Elasticsearch mapping patch for the AdMob lander fields.
It reads the fields-only fragment in `mob_search_mix_fields.mapping.json` and
uses `PUT _mapping` on the live `mob_search_mix` index.

```bash
node scripts/admob/apply-es-mapping.js
node scripts/admob/apply-es-mapping.js --commit
```

## 3. `rebuild-search-index.js`

Recreates the AdMob `mob_search_mix` index from the checked-in full mapping and
repopulates it from SQL. Use this when a lander field must be removed from the
live ES mapping, because `PUT _mapping` cannot delete existing fields.

```bash
node scripts/admob/rebuild-search-index.js
node scripts/admob/rebuild-search-index.js --commit
```

## Files

- `mobdb.schema.sql` is the full base schema for new installs.
- `mob_search_mix.mapping.json` is the full base mapping for new installs.
- `mob_search_mix_fields.mapping.json` is the additive patch used by the live ES migration.
