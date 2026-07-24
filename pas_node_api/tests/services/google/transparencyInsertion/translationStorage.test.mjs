import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  ensureLanguage,
  insertAd,
  updateAd,
  upsertTranslation,
  upsertMeta,
} = require('../../../../src/services/google/transparencyInsertion/repository');

describe('Google Transparency language and translation SQL', () => {
  it('resolves an existing detected language case-insensitively', async () => {
    const calls = [];
    const exec = {
      query: async (sql, params) => {
        calls.push([sql, params]);
        return [{ id: 7 }];
      },
    };
    await expect(ensureLanguage(exec, 'de-DE', 'German')).resolves.toBe(7);
    expect(calls).toEqual([
      ['SELECT id FROM languages WHERE iso = ? LIMIT 1', ['DE']],
    ]);
  });

  it('creates a missing detected language', async () => {
    let call = 0;
    const exec = {
      query: async () => (++call === 1 ? [] : { insertId: 9 }),
    };
    await expect(ensureLanguage(exec, 'fr', 'French')).resolves.toBe(9);
  });

  it('upserts translated copy in google_ad_translation', async () => {
    const calls = [];
    const exec = {
      query: async (sql, params) => {
        calls.push([sql, params]);
        return calls.length === 1 ? [{ google_ad_id: 42 }] : { affectedRows: 1 };
      },
    };
    await upsertTranslation(exec, 42, {
      text: 'Translated text',
      title: 'Translated title',
      newsfeed_description: 'Translated description',
    });
    expect(calls[1][0]).toContain('UPDATE google_ad_translation');
    expect(calls[1][1]).toEqual([
      'Translated text',
      'Translated title',
      'Translated description',
      42,
    ]);
  });

  it('writes empty strings instead of null into live NOT NULL translation columns', async () => {
    const calls = [];
    const exec = {
      query: async (sql, params) => {
        calls.push([sql, params]);
        return calls.length === 1 ? [] : { insertId: 42 };
      },
    };
    await upsertTranslation(exec, 42, {
      text: null,
      title: null,
      newsfeed_description: null,
    });
    expect(calls[1][1]).toEqual([42, '', '', '']);
  });

  it('sets every live NOT NULL metadata counter explicitly', async () => {
    const calls = [];
    const exec = {
      query: async (sql, params) => {
        calls.push([sql, params]);
        return calls.length === 1 ? [] : { insertId: 1 };
      },
    };
    await upsertMeta(exec, 42, {
      firstSeenSql: '2026-01-01 00:00:00',
      lastSeenSql: '2026-01-02 00:00:00',
      version: '3.2.0',
      destination_url: null,
    });
    expect(calls[1][0]).toContain('destination_scraper_status');
    expect(calls[1][0]).toContain('affiliate_network_id');
    expect((calls[1][0].match(/\?/g) || []).length).toBe(calls[1][1].length);
  });

  it('keeps insert/update SQL placeholder counts aligned with language_id', async () => {
    const data = {
      ad_id: 'CR1', languageId: 7, languageShouldUpdate: true, type: 'TEXT', subnetwork: 'SEARCH',
      adPosition: 'FEED', postDateSql: '1000-01-01 00:00:00',
      lastSeenSql: '2026-01-02 00:00:00', hasPayloadFirstSeen: true,
      daysRunning: 2, source: 'desktop', system_id: 'worker',
      domainId: null, countryId: 0, countryOnlyId: 0, postOwnerId: 11,
    };
    const exec = {
      query: async (sql, params) => {
        expect((sql.match(/\?/g) || []).length).toBe(params.length);
        return { insertId: 42, affectedRows: 1 };
      },
    };
    await expect(insertAd(exec, data)).resolves.toBe(42);
    await expect(updateAd(exec, 42, data)).resolves.toBeUndefined();
  });

  it('clears language_id only for a successful empty translation result', async () => {
    const updateCalls = [];
    const exec = {
      query: async (sql, params) => {
        updateCalls.push([sql, params]);
        return { affectedRows: 1 };
      },
    };
    const data = {
      type: 'TEXT',
      adPosition: 'FEED',
      postDateSql: '1000-01-01 00:00:00',
      firstSeenSql: '2026-01-01 00:00:00',
      lastSeenSql: '2026-01-02 00:00:00',
      hasPayloadFirstSeen: false,
      daysRunning: 2,
      source: 'desktop',
      system_id: 'worker',
      domainId: null,
      languageId: 0,
      languageShouldUpdate: true,
      countryId: 0,
      countryOnlyId: 0,
      postOwnerId: 11,
    };

    await updateAd(exec, 42, data);

    expect(updateCalls[0][0]).toContain(
      'language_id = CASE WHEN ? = 1 THEN ? ELSE language_id END'
    );
    expect(updateCalls[0][1][12]).toBe(1);
    expect(updateCalls[0][1][13]).toBe(0);
  });
});
