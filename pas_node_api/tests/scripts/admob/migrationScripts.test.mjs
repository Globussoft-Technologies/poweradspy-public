import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const sqlMigration = require('../../../scripts/admob/migrate-lander-fields');
const esMapping = require('../../../scripts/admob/apply-es-mapping');

const fragment = JSON.parse(readFileSync(
  new URL('../../../scripts/admob/mob_search_mix_fields.mapping.json', import.meta.url),
  'utf8'
));

describe('AdMob lander migration scripts', () => {
  it('keeps the AdMob ES fragment focused on the finalized lander fields', () => {
    expect(fragment.properties.redirect_status).toMatchObject({ type: 'byte' });
    expect(fragment.properties.lander_status).toMatchObject({ type: 'byte' });
    expect(fragment.properties.lander_platform).toMatchObject({ type: 'short' });
    expect(fragment.properties.outgoing_url).toMatchObject({ type: 'nested' });
    expect(fragment.properties.whatsapp).toMatchObject({ type: 'nested' });
    expect(fragment.properties.lead_campaign_tag).toMatchObject({
      type: 'keyword',
      normalizer: 'mob_lowercase',
    });
    expect(fragment.properties).not.toHaveProperty('source_website');
    expect(fragment.properties).not.toHaveProperty('whatsapp_details');
  });

  it('builds the finalized lander table create SQL', () => {
    const ddl = sqlMigration.buildLanderCreateTableSql();
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS `mob_ad_lander_content`');
    expect(ddl).toContain('`platform` SMALLINT UNSIGNED NULL');
    expect(ddl).toContain('`lander_status` TINYINT UNSIGNED NOT NULL DEFAULT 1');
    expect(ddl).toContain('`source_app` VARCHAR(255) NULL');
    expect(ddl).toContain('`whatsapp_json` LONGTEXT NULL');
    expect(ddl).toContain('`whatsapp_rotator_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0');
    expect(ddl).toContain('`created` DATETIME(3) NULL');
    expect(ddl).toContain('`updated` DATETIME(3) NULL');
    expect(ddl).toContain('KEY `idx_mob_ad_lander_content_updated` (`updated`, `ad_id`)');
    expect(ddl).toContain('KEY `idx_mob_ad_lander_content_campaign_id` (`campaign_id`)');
    expect(ddl).toContain('FOREIGN KEY (`ad_id`) REFERENCES `mob_ads` (`id`) ON DELETE CASCADE');
    expect(ddl).not.toContain('`crawled_by`');
    expect(ddl).not.toContain('`source_website`');
    expect(ddl).not.toContain('`whatsapp_details_json`');
    expect(ddl).not.toContain('`raw_payload_json`');
  });

  it('builds the daily AdMob lander claims table create SQL', () => {
    const ddl = sqlMigration.buildClaimsCreateTableSql();
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS `mob_ad_lander_claims`');
    expect(ddl).toContain('`process_date` DATE NOT NULL');
    expect(ddl).toContain('`scraper_name` VARCHAR(255) NOT NULL');
    expect(ddl).toContain('`requested_status` TINYINT UNSIGNED NOT NULL DEFAULT 0');
    expect(ddl).toContain('`completed_at` DATETIME(3) NULL');
    expect(ddl).toContain('PRIMARY KEY (`ad_id`, `process_date`)');
    expect(ddl).toContain('KEY `idx_mob_ad_lander_claims_queue` (`process_date`, `requested_status`, `claimed_at`, `ad_id`)');
    expect(ddl).toContain('KEY `idx_mob_ad_lander_claims_scraper` (`scraper_name`, `process_date`, `claimed_at`)');
  });

  it('normalizes legacy WhatsApp detail rows by renaming path to url', () => {
    const normalized = sqlMigration.normalizeWhatsappDetailsJson(JSON.stringify([
      {
        domain: 'wa.link',
        path: 'https://wa.link/reddylive2',
        phone: '918810993624',
      },
    ]));

    expect(normalized.changed).toBe(true);
    expect(JSON.parse(normalized.value)).toEqual([
      {
        domain: 'wa.link',
        phone: '918810993624',
        button: null,
        message: null,
        first_detected: null,
        last_detected: null,
        state: null,
        city: null,
        country: null,
        url: 'https://wa.link/reddylive2',
      },
    ]);
  });

  it('plans to drop deprecated lander-only columns during strict cleanup', () => {
    const statements = sqlMigration.buildObsoleteLanderDropStatements(new Set([
      'ad_id',
      'source_website',
      'whatsapp_details_json',
      'whatsapp_rotator_phone_count',
      'raw_payload_json',
    ]));

    expect(statements).toEqual([
      'ALTER TABLE `mob_ad_lander_content` DROP COLUMN `source_website`',
      'ALTER TABLE `mob_ad_lander_content` DROP COLUMN `whatsapp_rotator_phone_count`',
      'ALTER TABLE `mob_ad_lander_content` DROP COLUMN `whatsapp_details_json`',
      'ALTER TABLE `mob_ad_lander_content` DROP COLUMN `raw_payload_json`',
    ]);
  });

  it('plans a redirect_status add when the column is missing', () => {
    const statements = sqlMigration.buildRedirectStatusStatements(null);
    expect(statements[0]).toContain('ADD COLUMN `redirect_status` TINYINT UNSIGNED NOT NULL DEFAULT 0');
    expect(statements[1]).toContain('ADD KEY `idx_mob_ads_redirect_status`');
  });

  it('plans claim-table additive fixes when queue indexes are missing', () => {
    const statements = sqlMigration.buildClaimsAlterStatements(
      new Set(['ad_id', 'process_date', 'scraper_name']),
      new Set(['PRIMARY'])
    );

    expect(statements[0]).toContain('ALTER TABLE `mob_ad_lander_claims`');
    expect(statements[0]).toContain('ADD COLUMN `requested_status` TINYINT UNSIGNED NOT NULL DEFAULT 0');
    expect(statements[0]).toContain('ADD KEY `idx_mob_ad_lander_claims_queue` (`process_date`, `requested_status`, `claimed_at`, `ad_id`)');
  });

  it('treats the current redirect_status column as already migrated', () => {
    const current = {
      DATA_TYPE: 'tinyint',
      COLUMN_TYPE: 'tinyint(3) unsigned',
      IS_NULLABLE: 'NO',
      COLUMN_DEFAULT: '0',
    };
    expect(sqlMigration.redirectStatusMatches(current)).toBe(true);
  });

  it('detects whether the ES mapping patch still has work to do', () => {
    const current = {
      redirect_status: { type: 'byte' },
      lander_status: { type: 'byte' },
    };
    const patch = esMapping.buildMappingPatch(current);

    expect(patch.skipped).toEqual(expect.arrayContaining(['redirect_status', 'lander_status']));
    expect(patch.body.properties).toEqual(expect.objectContaining({
      lander_platform: { type: 'short' },
      lander_destination_url: { type: 'keyword', index: false },
      country_iso: { type: 'keyword', normalizer: 'mob_lowercase' },
      outgoing_url: {
        type: 'nested',
        properties: {
          start_url: { type: 'keyword', index: false },
          redirect_urls: { type: 'keyword', index: false },
          destination_url: { type: 'keyword', index: false },
        },
      },
      redirects: { type: 'keyword', index: false },
      campaign_id: { type: 'keyword' },
      whatsapp_rotator_detected: { type: 'boolean' },
      whatsapp_rotator_count: { type: 'long' },
      lead_campaign_tag: { type: 'keyword', normalizer: 'mob_lowercase' },
      whatsapp: {
        type: 'nested',
        properties: {
          domain: { type: 'keyword', normalizer: 'mob_lowercase' },
          phone: { type: 'keyword' },
          button: { type: 'text' },
          message: { type: 'text' },
          first_detected: { type: 'date' },
          last_detected: { type: 'date' },
          state: { type: 'keyword', normalizer: 'mob_lowercase' },
          city: { type: 'keyword', normalizer: 'mob_lowercase' },
          country: { type: 'keyword', normalizer: 'mob_lowercase' },
          url: { type: 'keyword', index: false },
        },
      },
      created: { type: 'date' },
      updated: { type: 'date' },
    }));
    expect(patch.body.properties).not.toHaveProperty('source_website');
    expect(patch.body.properties).not.toHaveProperty('whatsapp_details');
  });
});
