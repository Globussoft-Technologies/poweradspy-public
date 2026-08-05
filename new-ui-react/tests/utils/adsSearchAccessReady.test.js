import { describe, expect, it } from 'vitest';
import { isAdsSearchAccessReady } from '../../src/utils/planEntitlement';

describe('isAdsSearchAccessReady', () => {
  it('fails closed while authenticated network access is unresolved', () => {
    expect(isAdsSearchAccessReady(true, false, null)).toBe(false);
  });

  it('accepts both explicit allowed and explicit deny-all decisions', () => {
    expect(isAdsSearchAccessReady(true, false, ['facebook'])).toBe(true);
    expect(isAdsSearchAccessReady(true, false, [])).toBe(true);
  });

  it('does not block guest/public search bootstrap', () => {
    expect(isAdsSearchAccessReady(false, false, null)).toBe(true);
    expect(isAdsSearchAccessReady(true, true, null)).toBe(true);
  });
});
