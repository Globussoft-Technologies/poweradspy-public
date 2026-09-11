import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  backfillCountryNetwork,
  DRY_RUN_STATE_FILE,
  esPageQuery,
  loadSqlRows,
  NETWORK_CONFIGS,
  parseArgs,
} = require('../../scripts/backfill-facebook-instagram-country-es-resumable');

describe('resumable Facebook/Instagram country ES backfill', () => {
  it('keeps ES and SQL batch sizes independently configurable', () => {
    expect(parseArgs([])).toMatchObject({
      apply: false,
      networks: ['facebook', 'instagram'],
      esBatchSize: 500,
      sqlBatchSize: 250,
      stateFile: DRY_RUN_STATE_FILE,
    });
    expect(parseArgs(['--apply', '--network=facebook', '--es-batch-size=100', '--sql-batch-size=25'])).toMatchObject({
      apply: true,
      networks: ['facebook'],
      esBatchSize: 100,
      sqlBatchSize: 25,
    });
  });

  it('sorts newest-to-oldest and uses search_after when resuming', () => {
    const body = esPageQuery(NETWORK_CONFIGS.facebook, 100, ['2026-09-01T00:00:00.000Z', 123]);
    expect(body.size).toBe(100);
    expect(body.search_after).toEqual(['2026-09-01T00:00:00.000Z', 123]);
    expect(body.sort).toEqual([
      { 'facebook_ad.last_seen': { order: 'desc', missing: '_last' } },
      { 'facebook_ad.id': { order: 'asc' } },
    ]);
    expect(body.track_total_hits).toBe(false);
    expect(body._source).toEqual(['facebook_ad.id', 'facebook_ad.last_seen', 'country_only.country']);
  });

  it('uses the *_only SQL relation first and falls back only for IDs without country data', async () => {
    const sql = {
      query: vi.fn(async (query) => {
        if (/facebook_ad_countries_only/.test(query)) {
          return [
            { ad_id: 1, last_seen: '2026-01-02', country_csv: null },
            { ad_id: 2, last_seen: '2026-01-01', country_csv: 'Canada' },
          ];
        }
        if (/facebook_ad_countries/.test(query) && !/facebook_ad_countries_only/.test(query)) return [{ ad_id: 1, last_seen: '2026-01-02', country_csv: 'France' }];
        return [];
      }),
    };

    const rows = await loadSqlRows(sql, NETWORK_CONFIGS.facebook, ['1', '2']);
    expect(rows.get('1').country_csv).toBe('France');
    expect(rows.get('2').country_csv).toBe('Canada');
    expect(sql.query).toHaveBeenCalledTimes(2);
    expect(sql.query.mock.calls[1][1]).toEqual(['1']);
  });

  it('updates only drifted documents and checkpoints after the page succeeds', async () => {
    const search = vi.fn()
      .mockResolvedValueOnce({ body: { hits: { hits: [
        { _id: 'es-1', sort: ['2026-09-02T00:00:00.000Z', 1], _source: { 'facebook_ad.id': 1, 'facebook_ad.last_seen': '2026-09-02', 'country_only.country': ['France'] } },
        { _id: 'es-2', sort: ['2026-09-01T00:00:00.000Z', 2], _source: { 'facebook_ad.id': 2, 'facebook_ad.last_seen': '2026-09-01', 'country_only.country': ['Germany'] } },
      ] } } })
      .mockResolvedValueOnce({ body: { hits: { hits: [] } } });
    const sql = {
      query: vi.fn(async (query) => {
        if (/facebook_ad_countries_only/.test(query)) return [
          { ad_id: 1, last_seen: '2026-09-02', country_csv: 'Canada' },
          { ad_id: 2, last_seen: '2026-09-01', country_csv: 'Germany' },
        ];
        return [];
      }),
    };
    const elastic = {
      indexName: 'search_mix',
      esMajor: 6,
      client: {
        search,
        bulk: vi.fn().mockResolvedValue({ body: { items: [{ update: { status: 200 } }] } }),
      },
    };
    const saveCheckpoint = vi.fn();

    const summary = await backfillCountryNetwork({
      sql,
      elastic,
      network: 'facebook',
      apply: true,
      esBatchSize: 2,
      sqlBatchSize: 2,
      saveCheckpoint,
      log: () => {},
    });

    expect(summary.countryDriftedDocuments).toBe(1);
    expect(summary.countryInSync).toBe(1);
    expect(summary.esDocumentsUpdated).toBe(1);
    expect(elastic.client.bulk).toHaveBeenCalledWith({
      body: [
        { update: { _index: 'search_mix', _id: 'es-1', _type: 'doc' } },
        { doc: { 'country_only.country': ['Canada'] } },
      ],
      refresh: false,
    });
    expect(saveCheckpoint).toHaveBeenLastCalledWith('facebook', expect.objectContaining({
      done: true,
      cursor: ['2026-09-01T00:00:00.000Z', 2],
    }));
  });
});
