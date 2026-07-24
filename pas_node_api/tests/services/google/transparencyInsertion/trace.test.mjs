import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compact, createTransparencyTrace } = require(
  '../../../../src/services/google/transparencyInsertion/trace'
);

describe('Google Transparency debug trace', () => {
  it('writes a numbered ad-scoped structured trace line', () => {
    const log = { info: vi.fn() };
    const trace = createTransparencyTrace(
      log,
      { ad_id: 'CR123' },
      { requestId: 'req-1', index: 2 }
    );

    trace('TRANSLATION_API_SUCCEEDED', {
      detected_language: 'en',
      translated_text: 'Translated',
    });

    expect(log.info).toHaveBeenCalledOnce();
    expect(log.info.mock.calls[0][0]).toContain('[GT18 TRACE 01]');
    expect(log.info.mock.calls[0][0]).toContain('"ad_id":"CR123"');
    expect(log.info.mock.calls[0][0]).toContain('"detected_language":"en"');
  });

  it('redacts credential-shaped keys and truncates oversized values', () => {
    const out = compact({
      token: 'do-not-log',
      password: 'do-not-log',
      text: 'x'.repeat(900),
    });
    expect(out).not.toHaveProperty('token');
    expect(out).not.toHaveProperty('password');
    expect(out.text).toContain('[truncated]');
  });
});
