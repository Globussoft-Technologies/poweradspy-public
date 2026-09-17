import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getLastUrlHostname } = require('../../../../src/services/common/helpers/urlDomain');
const { extractDomain } = require('../../../../src/services/youtube/landers/transforms');

const doubleClickUrl = 'https://ad.doubleclick.net/ddm/trackclk/N5506;acs_info=foo?https://turbotax.intuit.com/lp/byp/1495/?cid=123';

describe('YouTube nested destination URL domain extraction', () => {
  it('uses the hostname from the last embedded HTTP(S) URL', () => {
    expect(getLastUrlHostname(doubleClickUrl)).toBe('turbotax.intuit.com');
  });

  it('keeps the lander domain value registrable', () => {
    expect(extractDomain(doubleClickUrl)).toBe('intuit.com');
  });

  it('keeps normal single-URL handling', () => {
    expect(getLastUrlHostname('https://www.example.com/path')).toBe('www.example.com');
    expect(extractDomain('https://www.example.com/path')).toBe('example.com');
  });

  it('does not turn null-like values into a hostname', () => {
    expect(getLastUrlHostname('null')).toBe('');
    expect(getLastUrlHostname('undefined')).toBe('');
  });
});
