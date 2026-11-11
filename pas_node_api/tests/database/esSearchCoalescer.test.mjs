import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createSearchCoalescer } = require('../../src/database/esSearchCoalescer');

const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('esSearchCoalescer', () => {
  it('runs identical in-flight searches once and gives every caller the same data', async () => {
    const d = deferred();
    const raw = vi.fn(() => d.promise);
    const search = createSearchCoalescer(raw);
    const params = { index: 'search_mix', body: { query: { match_all: {} }, size: 9 } };

    const a = search(params);
    const b = search({ index: 'search_mix', body: { query: { match_all: {} }, size: 9 } });
    d.resolve({ body: { hits: { total: 2, hits: [{ _id: '1' }, { _id: '2' }] } }, statusCode: 200, headers: {}, meta: { connection: { fn() {} } } });

    const [ra, rb] = await Promise.all([a, b]);
    expect(raw).toHaveBeenCalledTimes(1);
    expect(ra.body).toEqual(rb.body);
    expect(ra.body.hits.hits.map((h) => h._id)).toEqual(['1', '2']);
    expect(search.stats()).toMatchObject({ started: 1, shared: 1, inFlight: 0 });
  });

  it('gives shared callers separate copies so one request cannot mutate another', async () => {
    const raw = vi.fn(async () => ({ body: { hits: { hits: [{ _source: { x: 1 } }] } }, statusCode: 200, headers: {} }));
    const search = createSearchCoalescer(raw);
    const p = { index: 'i', body: { size: 1 } };
    const [a, b] = await Promise.all([search(p), search(p)]);
    a.body.hits.hits[0]._source.x = 99;
    expect(b.body.hits.hits[0]._source.x).toBe(1);
  });

  it('never caches: a search after the first one finished goes to ES again', async () => {
    let n = 0;
    const raw = vi.fn(async () => ({ body: { n: ++n }, statusCode: 200, headers: {} }));
    const search = createSearchCoalescer(raw);
    const p = { index: 'i', body: { size: 1 } };
    expect((await search(p)).body.n).toBe(1);
    expect((await search(p)).body.n).toBe(2);
    expect(raw).toHaveBeenCalledTimes(2);
  });

  it('does not share different bodies, transport options or scroll searches', async () => {
    const raw = vi.fn(async (params) => ({ body: { size: params.body.size }, statusCode: 200, headers: {} }));
    const search = createSearchCoalescer(raw);
    await Promise.all([
      search({ index: 'i', body: { size: 1 } }),
      search({ index: 'i', body: { size: 2 } }),
      search({ index: 'i', body: { size: 1 } }, { requestTimeout: 5000 }),
      search({ index: 'i', scroll: '1m', body: { size: 1 } }),
    ]);
    // first + different body + with options + scroll
    expect(raw).toHaveBeenCalledTimes(4);
  });

  it('passes an ES error to every waiting caller and then allows a fresh try', async () => {
    const d = deferred();
    const raw = vi.fn().mockReturnValueOnce(d.promise).mockResolvedValue({ body: { ok: true }, statusCode: 200, headers: {} });
    const search = createSearchCoalescer(raw);
    const p = { index: 'i', body: { size: 1 } };
    const a = search(p); const b = search(p);
    d.reject(new Error('timeout'));
    await expect(a).rejects.toThrow('timeout');
    await expect(b).rejects.toThrow('timeout');
    expect((await search(p)).body.ok).toBe(true);
  });
});
