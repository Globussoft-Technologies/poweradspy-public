import { describe, expect, it, vi } from 'vitest';
import { dedupeInFlight } from '../../src/utils/requestDeduper';

describe('requestDeduper', () => {
  it('shares one operation between concurrent callers and clears after success', async () => {
    let release;
    const operation = vi.fn(() => new Promise((resolve) => { release = resolve; }));

    const first = dedupeInFlight('same-read', operation);
    const second = dedupeInFlight('same-read', operation);
    await Promise.resolve();

    expect(operation).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    release({ ok: true });
    await expect(first).resolves.toEqual({ ok: true });

    await dedupeInFlight('same-read', operation.mockResolvedValueOnce({ ok: 'fresh' }));
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('clears a failed operation so a later caller can retry', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce('recovered');

    await expect(dedupeInFlight('retryable-read', operation)).rejects.toThrow('temporary');
    await expect(dedupeInFlight('retryable-read', operation)).resolves.toBe('recovered');
    expect(operation).toHaveBeenCalledTimes(2);
  });
});

