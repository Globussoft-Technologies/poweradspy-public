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
  it('keeps the AdMob ES fragment focused on the new lander fields', () => {
    expect(fragment.properties.redirect_status).toMatchObject({ type: 'byte' });
    expect(fragment.properties.lander_status).toMatchObject({ type: 'byte' });
    expect(fragment.properties.lead_campaign_tag).toMatchObject({
      type: 'keyword',
      normalizer: 'mob_lowercase',
    });
    expect(fragment.properties).not.toHaveProperty('ad_id');
    expect(fragment.properties).not.toHaveProperty('system_id');
  });

  it('builds the live lander table create SQL with the new payload columns', () => {
    const ddl = sqlMigration.buildLanderCreateTableSql();
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS `mob_ad_lander_content`');
    expect(ddl).toContain('`whatsapp_rotator_detected` TINYINT(1) NOT NULL DEFAULT 0');
    expect(ddl).toContain('`source_website` VARCHAR(2048) NULL');
    expect(ddl).toContain('`whatsapp_parameters_json` LONGTEXT NULL');
    expect(ddl).toContain('`campaign_id` VARCHAR(255) NULL');
    expect(ddl).toContain('KEY `idx_mob_ad_lander_content_campaign_id` (`campaign_id`)');
    expect(ddl).toContain('`raw_payload_json` LONGTEXT NULL');
    expect(ddl).toContain('FOREIGN KEY (`ad_id`) REFERENCES `mob_ads` (`id`) ON DELETE CASCADE');
  });

  it('plans a redirect_status add when the column is missing', () => {
    const statements = sqlMigration.buildRedirectStatusStatements(null);
    expect(statements[0]).toContain('ADD COLUMN `redirect_status` TINYINT UNSIGNED NOT NULL DEFAULT 0');
    expect(statements[1]).toContain('ADD KEY `idx_mob_ads_redirect_status`');
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
    expect(patch.body.properties).toEqual({
      lander_crawled_by: { type: 'keyword', normalizer: 'mob_lowercase' },
      lander_destination_url: { type: 'keyword', index: false },
      lander_html_path: { type: 'keyword', index: false },
      lander_screen_shot: { type: 'keyword', index: false },
      lander_domain_registered_date: { type: 'date' },
      lander_domain_age: { type: 'short' },
      country_iso: { type: 'keyword', normalizer: 'mob_lowercase' },
      source_website: { type: 'keyword', index: false },
      source_parameters: {
        type: 'object',
        properties: {
          gad_source: { type: 'keyword' },
          gad_campaignid: { type: 'keyword' },
          gclid: { type: 'keyword' },
        },
      },
      whatsapp_url: { type: 'keyword', index: false },
      whatsapp_domain: { type: 'keyword', normalizer: 'mob_lowercase' },
      whatsapp_path: { type: 'keyword', index: false },
      whatsapp_phone: { type: 'keyword' },
      whatsapp_message: { type: 'text' },
      whatsapp_parameters: {
        type: 'object',
        properties: {
          phone: { type: 'keyword' },
          text: { type: 'text' },
          type: { type: 'keyword', normalizer: 'mob_lowercase' },
          app_absent: { type: 'keyword' },
        },
      },
      campaign_id: { type: 'keyword' },
      location_without_vpn: {
        type: 'object',
        properties: {
          ip: { type: 'ip', ignore_malformed: true },
          country: { type: 'keyword', normalizer: 'mob_lowercase' },
          country_code: { type: 'keyword', normalizer: 'mob_lowercase' },
          region: { type: 'keyword', normalizer: 'mob_lowercase' },
          region_code: { type: 'keyword', normalizer: 'mob_lowercase' },
          city: { type: 'keyword', normalizer: 'mob_lowercase' },
          zipcode: { type: 'keyword' },
          latitude: { type: 'keyword' },
          longitude: { type: 'keyword' },
        },
      },
      location_with_vpn: {
        type: 'object',
        properties: {
          ip: { type: 'ip', ignore_malformed: true },
          country: { type: 'keyword', normalizer: 'mob_lowercase' },
          country_code: { type: 'keyword', normalizer: 'mob_lowercase' },
          region: { type: 'keyword', normalizer: 'mob_lowercase' },
          region_code: { type: 'keyword', normalizer: 'mob_lowercase' },
          city: { type: 'keyword', normalizer: 'mob_lowercase' },
          zipcode: { type: 'keyword' },
          latitude: { type: 'keyword' },
          longitude: { type: 'keyword' },
        },
      },
      comparison: {
        type: 'object',
        properties: {
          location_changed: { type: 'boolean' },
          country_changed: { type: 'boolean' },
          city_changed: { type: 'boolean' },
          zipcode_changed: { type: 'boolean' },
          whatsapp_data_changed: { type: 'boolean' },
          campaign_id_changed: { type: 'boolean' },
        },
      },
      whatsapp_links: { type: 'keyword', normalizer: 'mob_lowercase' },
      whatsapp_prefilled_texts: { type: 'text' },
      phone_numbers: { type: 'keyword' },
      contact_buttons: { type: 'text' },
      contact_button_count: { type: 'long' },
      whatsapp_rotator_detected: { type: 'boolean' },
      whatsapp_rotator_phone_count: { type: 'long' },
      lead_campaign_tag: { type: 'keyword', normalizer: 'mob_lowercase' },
      lander_ad_category: { type: 'keyword', normalizer: 'mob_lowercase' },
    });
  });
});
