import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  mappingProperties,
  mappingForExisting,
} = require('../../../../scripts/apply-google-transparency-es-mapping');

const fragment = JSON.parse(readFileSync(
  new URL('../../../../scripts/google_transparency_es_fields.mapping.json', import.meta.url),
  'utf8'
));

describe('Google Transparency ES mapping', () => {
  it('maps country delivery as searchable nested dates and impression bounds', () => {
    const details = fragment.properties.country_details;
    expect(details.type).toBe('nested');
    expect(details.properties.first_seen).toMatchObject({ type: 'date', format: 'strict_date_optional_time' });
    expect(details.properties.last_seen).toMatchObject({ type: 'date', format: 'strict_date_optional_time' });
    expect(details.properties.times_shown.properties.min.type).toBe('long');
    expect(details.properties.times_shown.properties.max.type).toBe('long');
  });

  it('does not add system/version duplicates to the Transparency mapping', () => {
    expect(fragment.properties).not.toHaveProperty('system_id');
    expect(fragment.properties).not.toHaveProperty('contract_version');
    expect(fragment.properties).not.toHaveProperty('network');
  });

  it('stores NAS other-multimedia paths under the public contract field', () => {
    expect(fragment.properties.othermultimedia).toMatchObject({
      type: 'keyword',
      index: false,
    });
    expect(fragment.properties).not.toHaveProperty('nas_othermultimedia');
  });

  it('reads typed ES6 and typeless ES7 mapping responses', () => {
    expect(mappingProperties({
      idx: { mappings: { doc: { properties: { id: { type: 'long' } } } } },
    }, 'idx')).toHaveProperty('id.type', 'long');
    expect(mappingProperties({
      body: { idx: { mappings: { properties: { id: { type: 'long' } } } } },
    }, 'idx')).toHaveProperty('id.type', 'long');
  });

  it('does not create a separate NAS-prefixed multimedia field', () => {
    const prepared = mappingForExisting({
      nas_othermultimedia: { properties: { nas_path: { type: 'text' } } },
    });
    expect(prepared.skipped).toEqual([]);
    expect(prepared.body.properties).not.toHaveProperty('nas_othermultimedia');
  });
});
