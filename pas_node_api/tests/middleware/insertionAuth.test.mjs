import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const config = require('../../src/config');
const { insertionAuth, hasPlatformBypass } = require('../../src/middleware/insertionAuth');

const original = { ...config.insertion };

function response() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('insertionAuth', () => {
  beforeEach(() => {
    config.insertion.signatureHeader = 'x-signature';
    config.insertion.secretKey = 'test-secret';
    config.insertion.allowPlatformBypass = '18';
  });

  afterEach(() => {
    Object.assign(config.insertion, original);
  });

  it('bypasses an unsigned single platform-18 payload', () => {
    const next = vi.fn();
    insertionAuth(
      { headers: {}, body: { platform: 18 }, id: 'request-1' },
      response(),
      next
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('supports arrays and ads wrappers when every item is platform 18', () => {
    expect(hasPlatformBypass([{ platform: 18 }, { platform: '18' }], '18')).toBe(true);
    expect(hasPlatformBypass({ ads: [{ platform: 18 }] }, '18')).toBe(true);
    expect(hasPlatformBypass([{ platform: 18 }, { platform: 10 }], '18')).toBe(false);
  });

  it('supports a configured bypass list without dropping the legacy platform', () => {
    expect(hasPlatformBypass({ platform: 12 }, ['12', '18'])).toBe(true);
    expect(hasPlatformBypass({ platform: 18 }, ['12', '18'])).toBe(true);
    expect(hasPlatformBypass({ platform: 10 }, ['12', '18'])).toBe(false);
  });

  it('accepts a valid signature over the exact raw body', () => {
    const rawBody = Buffer.from('{"platform":10}', 'utf8');
    const signature = crypto.createHmac('sha256', 'test-secret').update(rawBody).digest('hex');
    const next = vi.fn();
    insertionAuth(
      { headers: { 'x-signature': signature }, body: { platform: 10 }, rawBody, id: 'request-2' },
      response(),
      next
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects a supplied invalid signature even for the bypass platform', () => {
    const res = response();
    const next = vi.fn();
    insertionAuth(
      { headers: { 'x-signature': 'bad-signature' }, body: { platform: 18 }, id: 'request-3' },
      res,
      next
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Invalid x-signature'),
    }));
  });

  it('rejects an unsigned mixed-platform batch', () => {
    const res = response();
    const next = vi.fn();
    insertionAuth(
      { headers: {}, body: [{ platform: 18 }, { platform: 10 }], id: 'request-4' },
      res,
      next
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
