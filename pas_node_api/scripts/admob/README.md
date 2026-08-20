# AdMob migration scripts

These scripts patch the live AdMob schema in place without touching legacy data.
They follow the same dry-run-first pattern used by the AI-Meta maintenance tools.

## 1. `migrate-lander-fields.js`

Adds the new lander fields to the live MySQL schema:

- `mob_ads.redirect_status`
- `mob_ad_lander_content` and its new payload columns

```bash
node scripts/admob/migrate-lander-fields.js
node scripts/admob/migrate-lander-fields.js --commit
```

## 2. `apply-es-mapping.js`

Applies the additive Elasticsearch mapping patch for the AdMob lander fields.
It reads the fields-only fragment in `mob_search_mix_fields.mapping.json` and
uses `PUT _mapping` on the live `mob_search_mix` index.

```bash
node scripts/admob/apply-es-mapping.js
node scripts/admob/apply-es-mapping.js --commit
```

## Files

- `mobdb.schema.sql` is the full base schema for new installs.
- `mob_search_mix.mapping.json` is the full base mapping for new installs.
- `mob_search_mix_fields.mapping.json` is the additive patch used by the live ES migration.
