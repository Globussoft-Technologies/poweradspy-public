import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);

const { ImageHashClient, OUTCOME } = require("../../../src/compliance/imagematch/client");

const SSCD = "460e931b54bbbb9667c97c9459eed7c8f2439b62c259c021fefb559058f57304";
const SHA = "9eb9b1214da4030211116f15ee67c6afafc2ccfc697a47c5de8ad5c0a833ce11";
const KEY = "test-key-should-never-be-logged";

const config = (over = {}) => ({
  baseUrl: "https://hash.example.test", apiKey: KEY, timeoutMs: 5000, concurrency: 2, retries: 2, retryDelayMs: 10, ...over,
});
const ok200 = () => ({ status: 200, data: { sscd_hash: SSCD, sha256: SHA } });
const noSleep = () => Promise.resolve();

function make(responses, over = {}) {
  const calls = [];
  const queue = Array.isArray(responses) ? [...responses] : null;
  const http = {
    request: vi.fn(async (opts) => {
      calls.push(opts);
      // A real transport reads the uploaded file to the end; do the same so no file stays open.
      if (opts.data && typeof opts.data.resume === "function") {
        opts.data.resume();
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const next = queue ? (queue.length > 1 ? queue.shift() : queue[0]) : responses(opts);
      if (next instanceof Error) throw next;
      return next;
    }),
  };
  const logs = [];
  const log = { info: (...a) => logs.push(["info", a]), warn: (...a) => logs.push(["warn", a]), error: (...a) => logs.push(["error", a]) };
  const client = new ImageHashClient({ config: config(over), http, log, sleep: noSleep });
  return { client, http, calls, logs };
}

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "imagematch-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("imagematch/client > hashUrl", () => {
  it("posts the image_url with the key and returns the parsed hashes", async () => {
    const { client, calls } = make([ok200()]);
    const out = await client.hashUrl("https://media.example.com/a/b.jpg");
    expect(out).toMatchObject({ ok: true, outcome: "ok", sscdHash: SSCD, sha256: SHA });
    expect(out.words).toBeInstanceOf(Uint32Array);
    expect(out.words.length).toBe(8);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST", url: "https://hash.example.test/v1/hash-url", data: { image_url: "https://media.example.com/a/b.jpg" },
      params: { embedding: false },
    });
    expect(calls[0].headers["X-API-Key"]).toBe(KEY);
  });

  it("lowercases and trims the hashes in the answer", async () => {
    const { client } = make([{ status: 200, data: { sscd_hash: ` ${SSCD.toUpperCase()} `, sha256: SHA.toUpperCase() } }]);
    expect(await client.hashUrl("https://x.test/a.jpg")).toMatchObject({ ok: true, sscdHash: SSCD, sha256: SHA });
  });

  it("does not call the service for an empty or too long URL", async () => {
    const { client, http } = make([ok200()]);
    for (const bad of [undefined, null, "", "   ", 5, `https://x.test/${"a".repeat(2100)}`]) {
      expect(await client.hashUrl(bad)).toMatchObject({ ok: false, outcome: OUTCOME.SKIP });
    }
    expect(http.request).not.toHaveBeenCalled();
  });

  it("works with a base URL that ends in a slash", async () => {
    const { client, calls } = make([ok200()], { baseUrl: "https://hash.example.test///" });
    await client.hashUrl("https://x.test/a.jpg");
    expect(calls[0].url).toBe("https://hash.example.test/v1/hash-url");
  });
});

describe("imagematch/client > outcomes", () => {
  it("413 and 422 mean this image cannot be hashed: skip, no retry, with the service's reason", async () => {
    for (const [status, data] of [[413, {}], [422, { detail: "image is smaller than 32x32" }], [422, { detail: [{ msg: "bad image", loc: [], type: "x" }] }], [422, undefined]]) {
      const { client, http } = make([{ status, data }]);
      const out = await client.hashUrl("https://x.test/a.jpg");
      expect(out).toMatchObject({ ok: false, outcome: OUTCOME.SKIP, status });
      expect(out.reason.length).toBeGreaterThan(0);
      expect(http.request).toHaveBeenCalledTimes(1);
    }
    const { client } = make([{ status: 422, data: { detail: "image is smaller than 32x32" } }]);
    expect((await client.hashUrl("https://x.test/a.jpg")).reason).toBe("image is smaller than 32x32");
  });

  it("401 and 403 mean the key is wrong: unauthorized, no retry", async () => {
    for (const status of [401, 403]) {
      const { client, http } = make([{ status, data: { detail: "bad key" } }]);
      expect(await client.hashUrl("https://x.test/a.jpg")).toMatchObject({ ok: false, outcome: OUTCOME.UNAUTHORIZED, status });
      expect(http.request).toHaveBeenCalledTimes(1);
    }
  });

  it("another 4xx is rejected, without a retry", async () => {
    const { client, http } = make([{ status: 404, data: {} }]);
    expect(await client.hashUrl("https://x.test/a.jpg")).toMatchObject({ ok: false, outcome: OUTCOME.REJECTED, status: 404 });
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  it("5xx, 429 and network errors are retried, and a later success is returned", async () => {
    const timeout = Object.assign(new Error("timeout of 5000ms exceeded"), { code: "ECONNABORTED" });
    const { client, http } = make([{ status: 503, data: {} }, timeout, { status: 429, data: {} }, ok200()], { retries: 3 });
    expect(await client.hashUrl("https://x.test/a.jpg")).toMatchObject({ ok: true });
    expect(http.request).toHaveBeenCalledTimes(4);
  });

  it("gives up after the configured retries with 'unavailable'", async () => {
    const { client, http, logs } = make([{ status: 502, data: {} }], { retries: 2 });
    const out = await client.hashUrl("https://x.test/a.jpg");
    expect(out).toMatchObject({ ok: false, outcome: OUTCOME.UNAVAILABLE, status: 502 });
    expect(http.request).toHaveBeenCalledTimes(3); // first try + 2 retries
    expect(logs.some(([level]) => level === "warn")).toBe(true);
  });

  it("with retries 0 makes a single attempt", async () => {
    const { client, http } = make([{ status: 500, data: {} }], { retries: 0 });
    expect(await client.hashUrl("https://x.test/a.jpg")).toMatchObject({ outcome: OUTCOME.UNAVAILABLE });
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  it("waits longer after each failed attempt", async () => {
    const delays = [];
    const http = { request: vi.fn(async () => ({ status: 500, data: {} })) };
    const client = new ImageHashClient({ config: config({ retries: 3, retryDelayMs: 100 }), http, sleep: async (ms) => { delays.push(ms); } });
    await client.hashUrl("https://x.test/a.jpg");
    expect(delays).toEqual([100, 200, 400]);
  });

  it("a 200 without valid hashes is a bad_response and is not retried", async () => {
    for (const data of [{}, { sscd_hash: "abc", sha256: SHA }, { sscd_hash: SSCD }, { sscd_hash: SSCD, sha256: "zz" }, null, "text"]) {
      const { client, http } = make([{ status: 200, data }]);
      expect(await client.hashUrl("https://x.test/a.jpg")).toMatchObject({ ok: false, outcome: OUTCOME.BAD_RESPONSE });
      expect(http.request).toHaveBeenCalledTimes(1);
    }
  });

  it("is not_configured, with no request, when the base URL or key is missing", async () => {
    for (const over of [{ baseUrl: "" }, { apiKey: "" }, { baseUrl: undefined }]) {
      const { client, http } = make([ok200()], over);
      expect(client.isConfigured()).toBe(false);
      expect(await client.hashUrl("https://x.test/a.jpg")).toMatchObject({ ok: false, outcome: OUTCOME.NOT_CONFIGURED });
      expect(await client.hashFile(path.join(dir, "a.jpg"))).toMatchObject({ ok: false, outcome: OUTCOME.NOT_CONFIGURED });
      expect(http.request).not.toHaveBeenCalled();
    }
  });

  it("never throws, even if the transport throws something that is not an Error", async () => {
    const http = { request: vi.fn(async () => { throw "boom"; }) }; // eslint-disable-line no-throw-literal
    const client = new ImageHashClient({ config: config({ retries: 1 }), http, sleep: noSleep });
    await expect(client.hashUrl("https://x.test/a.jpg")).resolves.toMatchObject({ ok: false, outcome: OUTCOME.UNAVAILABLE });
  });

  it("never puts the API key in a log line", async () => {
    const { client, logs } = make([{ status: 500, data: { detail: "x" } }], { retries: 1 });
    await client.hashUrl("https://x.test/a.jpg");
    expect(JSON.stringify(logs)).not.toContain(KEY);
  });
});

describe("imagematch/client > hashFile", () => {
  it("uploads the file as multipart with the key and returns the hashes", async () => {
    const file = path.join(dir, "a.jpg");
    fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    const { client, calls } = make([ok200()]);
    expect(await client.hashFile(file)).toMatchObject({ ok: true, sscdHash: SSCD, sha256: SHA });
    expect(calls[0].url).toBe("https://hash.example.test/v1/hash");
    expect(calls[0].headers["X-API-Key"]).toBe(KEY);
    expect(calls[0].headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    expect(calls[0].data).toBeTruthy();
  });

  it("builds a new form for each attempt, so a retry can read the file again", async () => {
    const file = path.join(dir, "a.jpg");
    fs.writeFileSync(file, "abc");
    const { client, calls } = make([{ status: 500, data: {} }, ok200()]);
    expect(await client.hashFile(file)).toMatchObject({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[0].data).not.toBe(calls[1].data);
  });

  it("skips, without a request, a missing file, an empty file, and a file over the size limit", async () => {
    const empty = path.join(dir, "empty.jpg"); fs.writeFileSync(empty, "");
    const big = path.join(dir, "big.jpg"); fs.writeFileSync(big, Buffer.alloc(2048));
    const { client, http } = make([ok200()], { maxFileBytes: 1024 });
    expect(await client.hashFile(path.join(dir, "nope.jpg"))).toMatchObject({ ok: false, outcome: OUTCOME.SKIP });
    expect(await client.hashFile(empty)).toMatchObject({ ok: false, outcome: OUTCOME.SKIP });
    expect(await client.hashFile(big)).toMatchObject({ ok: false, outcome: OUTCOME.SKIP });
    for (const bad of [undefined, null, "", 5]) expect(await client.hashFile(bad)).toMatchObject({ ok: false, outcome: OUTCOME.SKIP });
    expect(http.request).not.toHaveBeenCalled();
  });
});

describe("imagematch/client > concurrency", () => {
  it("never has more calls in flight than the configured limit, and finishes them all", async () => {
    let inFlight = 0;
    let peak = 0;
    const http = {
      request: vi.fn(async () => {
        inFlight += 1; peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return ok200();
      }),
    };
    const client = new ImageHashClient({ config: config({ concurrency: 3 }), http, sleep: noSleep });
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => client.hashUrl(`https://x.test/${i}.jpg`)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
    expect(client.active).toBe(0);
    expect(client.waiting).toHaveLength(0);
  });

  it("frees its slot after a failure, so later calls are not blocked", async () => {
    const http = { request: vi.fn(async () => ({ status: 500, data: {} })) };
    const client = new ImageHashClient({ config: config({ concurrency: 1, retries: 0 }), http, sleep: noSleep });
    for (let i = 0; i < 5; i += 1) await client.hashUrl("https://x.test/a.jpg");
    expect(client.active).toBe(0);
  });
});

describe("imagematch/client > health", () => {
  it("reports the service's hash version and bits", async () => {
    const { client, calls } = make([{ status: 200, data: { status: "ready", hash_version: "sscd-simhash-v1", hash_bits: 256 } }]);
    expect(await client.health()).toEqual({ ok: true, ready: true, hashVersion: "sscd-simhash-v1", hashBits: 256 });
    expect(calls[0]).toMatchObject({ method: "GET", url: "https://hash.example.test/health" });
  });

  it("is not ok on an error status, a thrown error, or no base URL", async () => {
    const bad = { ok: false, ready: false, hashVersion: null, hashBits: null };
    expect(await make([{ status: 500, data: {} }]).client.health()).toEqual(bad);
    expect(await make([new Error("down")]).client.health()).toEqual(bad);
    expect(await make([ok200()], { baseUrl: "" }).client.health()).toEqual(bad);
  });

  it("is ready=false when the service says it is not ready", async () => {
    const { client } = make([{ status: 200, data: { status: "loading", hash_version: "sscd-simhash-v1", hash_bits: 256 } }]);
    expect(await client.health()).toMatchObject({ ok: true, ready: false });
  });
});

describe("imagematch/client > adapting the number of calls at once (only with maxConcurrency)", () => {
  const SLOW = () => new Promise((resolve) => setTimeout(resolve, 1));
  function adaptive(over, handler) {
    let active = 0; let peak = 0;
    const http = { request: vi.fn(async () => { active += 1; peak = Math.max(peak, active); await SLOW(); active -= 1; return handler(); }) };
    const logs = [];
    const client = new ImageHashClient({ config: config({ retries: 0, ...over }), http, sleep: noSleep, log: { info: (...a) => logs.push(a), warn() {}, error() {} } });
    return { client, peak: () => peak, logs };
  }
  const burst = (client, n) => Promise.all(Array.from({ length: n }, (_, i) => client.hashUrl(`https://m.example.com/${i}.jpg`)));

  it("is off by default: never more than `concurrency` at once, whatever the service answers", async () => {
    const t = adaptive({ concurrency: 2 }, ok200);
    await burst(t.client, 60);
    expect(t.peak()).toBe(2);
    expect(t.client.cap()).toBe(2);
    const down = adaptive({ concurrency: 4 }, () => ({ status: 503, data: {} }));
    await burst(down.client, 10);
    expect(down.client.cap()).toBe(4); // not adapting: it does not back off either
  });

  it("adds one call at once after 20 answers in a row, never above maxConcurrency", async () => {
    const t = adaptive({ concurrency: 2, maxConcurrency: 4 }, ok200);
    expect(t.client.cap()).toBe(2);
    await burst(t.client, 20);
    expect(t.client.cap()).toBe(3);
    await burst(t.client, 200);
    expect(t.client.cap()).toBe(4);
    await burst(t.client, 60);
    expect(t.client.cap()).toBe(4);
    expect(t.peak()).toBeLessThanOrEqual(4);
    expect(t.logs.some((l) => l[0] === "image hashing: calls at once changed")).toBe(true);
  });

  it("halves the number when the service is overloaded (429, 5xx), never below 1, and builds up again", async () => {
    let status = 200;
    const t = adaptive({ concurrency: 4, maxConcurrency: 8 }, () => (status === 200 ? ok200() : { status, data: {} }));
    await burst(t.client, 80);
    expect(t.client.cap()).toBeGreaterThan(4);
    status = 429;
    await burst(t.client, 1);
    const reduced = t.client.cap();
    expect(reduced).toBeLessThan(5);
    status = 503;
    await burst(t.client, 6);
    expect(t.client.cap()).toBe(1);
    status = 200;
    await burst(t.client, 25);
    expect(t.client.cap()).toBe(2);
  });

  it("an image the service cannot process (413, 422) is not a sign of overload", async () => {
    const t = adaptive({ concurrency: 4, maxConcurrency: 8 }, () => ({ status: 422, data: { detail: "too small" } }));
    await burst(t.client, 30);
    expect(t.client.cap()).toBe(4);
  });

  it("calls waiting when the number goes up are released at once", async () => {
    const t = adaptive({ concurrency: 1, maxConcurrency: 3 }, ok200);
    const results = await burst(t.client, 45);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(t.client.active).toBe(0);
    expect(t.client.waiting).toHaveLength(0);
  });
});
