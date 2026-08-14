import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  DOMAIN_DATE_DEFAULTS,
  deleteTaskResult,
  installedPackageVersion,
  mappingFieldNames,
  parseArgs,
  redactSensitive,
  resolvedDomainDateConfig,
  toNodes,
  validateCompletedUpdate,
} = require('../../scripts/verify-domain-date-production-readiness');

describe('domain-date production readiness script', () => {
  it('defaults to the safe Google zero-match task check', () => {
    expect(parseArgs([])).toMatchObject({
      active: false,
      networks: ['google'],
      readOnly: false,
      strict: false,
      timeoutMs: 60000,
    });
  });

  it('supports all networks and rejects conflicting safety modes', () => {
    const options = parseArgs(['--all', '--active', '--strict', '--timeout-ms', '90000']);
    expect(options.active).toBe(true);
    expect(options.strict).toBe(true);
    expect(options.networks).toHaveLength(10);
    expect(options.networks).toContain('google');
    expect(() => parseArgs(['--active', '--read-only'])).toThrow();
    expect(() => parseArgs(['--network', 'tiktok'])).toThrow('Unsupported domain network');
  });

  it('uses reviewed defaults when the not-yet-deployed config block is absent', () => {
    expect(resolvedDomainDateConfig({}, {})).toEqual(DOMAIN_DATE_DEFAULTS);
    expect(resolvedDomainDateConfig(
      { domainDateUpdate: { esSyncMaxAds: 0, esRequestsPerSecond: 100 } },
      {},
    )).toMatchObject({ esSyncMaxAds: 0, esRequestsPerSecond: 100 });
  });

  it('redacts credentials from connection errors before reporting them', () => {
    const message = redactSensitive('failed https://elastic:secret@example.test username=elastic password="secret"');
    expect(message).not.toContain('secret');
    expect(message).not.toContain('username=elastic');
    expect(message).toContain('[REDACTED]');
  });

  it('reads versions from packages that restrict package.json exports', () => {
    expect(installedPackageVersion('@elastic/elasticsearch')).toMatch(/^7\./);
    expect(installedPackageVersion('mysql2')).toMatch(/^3\./);
  });

  it('normalizes the same comma, whitespace, and array ES node forms as the API', () => {
    expect(toNodes('https://es-1:9200/, https://es-2:9200 https://es-3:9200/')).toEqual([
      'https://es-1:9200',
      'https://es-2:9200',
      'https://es-3:9200',
    ]);
    expect(toNodes(['https://es-1:9200/', '', 'https://es-2:9200'])).toEqual([
      'https://es-1:9200',
      'https://es-2:9200',
    ]);
  });

  it.each([
    [6, { index: '.tasks', type: 'task', id: 'node-1:123' }],
    [8, { index: '.tasks', id: 'node-1:123' }],
  ])('uses the version-aware ES %i task-result cleanup request', async (esMajor, expected) => {
    const client = { delete: vi.fn(async () => ({})) };
    const reporter = { pass: vi.fn(), warn: vi.fn() };

    await deleteTaskResult(
      client,
      'node-1:123',
      esMajor,
      { esRequestTimeoutMs: 10000 },
      reporter,
      'google/elasticsearch',
    );

    expect(client.delete).toHaveBeenCalledWith(expected, {
      requestTimeout: 10000,
      maxRetries: 0,
    });
    expect(reporter.pass).toHaveBeenCalledOnce();
    expect(reporter.warn).not.toHaveBeenCalled();
  });

  it('finds required fields in ES 6 typed and ES 8 typeless mappings', () => {
    const es6Fields = mappingFieldNames({ body: {
      search_mix: {
        mappings: {
          doc: {
            properties: {
              facebook_ad: { properties: { id: { type: 'long' } } },
              facebook_ad_domains: { properties: { domain_registered_date: { type: 'date' } } },
            },
          },
        },
      },
    } }, 'search_mix');
    const es8Fields = mappingFieldNames({ body: {
      google_ads: {
        mappings: {
          properties: {
            ad_id: { type: 'keyword' },
            domain_registered_date: { type: 'date' },
          },
        },
      },
    } }, 'google_ads');

    expect(es6Fields).toContain('facebook_ad.id');
    expect(es6Fields).toContain('facebook_ad_domains.domain_registered_date');
    expect(es8Fields).toContain('ad_id');
    expect(es8Fields).toContain('domain_registered_date');
  });

  it('accepts a complete result and rejects every partial-failure signal', () => {
    const valid = {
      completed: true,
      response: {
        total: 1,
        updated: 1,
        noops: 0,
        timed_out: false,
        version_conflicts: 0,
        failures: [],
      },
    };
    expect(validateCompletedUpdate(valid, { updated: 1, noops: 0 })).toBe(valid.response);
    expect(() => validateCompletedUpdate({ ...valid, completed: false })).toThrow('not complete');
    expect(() => validateCompletedUpdate({ completed: true })).toThrow('without a response');
    expect(() => validateCompletedUpdate({
      completed: true,
      response: { ...valid.response, timed_out: true },
    })).toThrow('timed out');
    expect(() => validateCompletedUpdate({
      completed: true,
      response: { ...valid.response, version_conflicts: 1 },
    })).toThrow('version conflict');
    expect(() => validateCompletedUpdate({
      completed: true,
      response: { ...valid.response, failures: [{ cause: { reason: 'mapping error' } }] },
    })).toThrow('item failure');
    expect(() => validateCompletedUpdate({
      completed: true,
      response: { total: 1, updated: 1 },
    })).toThrow('missing total/updated/noops');
  });
});
